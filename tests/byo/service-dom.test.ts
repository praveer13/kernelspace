/**
 * The bring-your-own-service page mounted (docs/specs/wave-3.md §16.8, §17.4; task 3s-10, fix TF4): /capstone/service is
 * rendered in a small DOM (tests/dom/mini-dom.ts) with the fleet worker stood in by the real fleet host in-process. The
 * tests drive it as a learner does (pick a file, paste a config, type a number, press Run) and read the DOM: the stale-price
 * notice, each error state, and the run's lifecycle (start, form locked, results, the download offered, and nothing sent to
 * the network or written to browser storage or the ledger, which keeps its events in localStorage and IndexedDB). What a
 * browser alone answers (real layout, axe, the real worker) is the a11y harness's and Playwright's.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { createFleetHost } from '../../src/lib/fleet-host'
import type { FleetWorkerLike } from '../../src/lib/fleet-session'
import type { FleetReply, FleetRequest } from '../../src/workers/fleet-protocol'
import { MAX_FILE_BYTES, SUMMARY_FILE } from '../../src/lib/byo-service'
import ServiceCapstone from '../../src/pages/ServiceCapstone'
import { installDom, MiniElement, MiniEvent, type DomKit, type Mounted } from '../dom/mini-dom'

/* ----------------------------- fixtures ----------------------------- */

const LLAMA = JSON.stringify({ num_hidden_layers: 32, num_attention_heads: 32, num_key_value_heads: 8, head_dim: 128, hidden_size: 4096 })

/** A CSV of n requests, one every 0.5 s: a function of the row only. */
function makeCsv(n: number): string {
  const rows = ['arrival_s,prompt_tokens,output_tokens']
  for (let i = 0; i < n; i++) rows.push(`${(i * 0.5).toFixed(1)},${200 + ((i * 37) % 9) * 100},${20 + ((i * 11) % 9) * 10}`)
  return rows.join('\n') + '\n'
}

/** The local calendar day, as the page reads it. */
function localDay(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The real fleet host behind an in-process worker, as `new Worker(...)` returns it. `gate` holds every reply back until it
 * resolves, so a test can look at the page mid-run; `script` replaces the host.
 */
let gate: Promise<void> | null = null
let script: ((req: FleetRequest, emit: (r: FleetReply) => void) => void) | null = null
const spawned: FakeWorker[] = []
class FakeWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  terminated = false
  private readonly host = createFleetHost()
  constructor() {
    spawned.push(this)
    queueMicrotask(() => this.deliver({ type: 'boot' }))
  }
  private deliver(reply: FleetReply) {
    if (!this.terminated) this.onmessage?.({ data: reply })
  }
  postMessage(msg: FleetRequest) {
    if (this.terminated) return
    const go = () => {
      if (this.terminated) return
      if (script) script(msg, (r) => this.deliver(r))
      else void this.host.handle(msg, (r) => this.deliver(r))
    }
    setTimeout(() => (gate ? void gate.then(go) : go()), 0)
  }
  terminate() {
    this.terminated = true
  }
}

/* ------------------------------ the page ------------------------------ */

const g = globalThis as Record<string, unknown>
let dom: DomKit
let page: Mounted
const touched: string[] = []
const saved = new Map<string, PropertyDescriptor | undefined>()
const downloads: Array<{ href: string; download: string }> = []
const blobs: Blob[] = []

/** Replaces a global with a getter that records the touch and answers nothing. */
function trap(name: string): void {
  saved.set(name, Object.getOwnPropertyDescriptor(g, name))
  Object.defineProperty(g, name, {
    configurable: true,
    get: () => {
      touched.push(name)
      return undefined
    },
  })
}
function setGlobal(name: string, value: unknown): void {
  saved.set(name, Object.getOwnPropertyDescriptor(g, name))
  Object.defineProperty(g, name, { configurable: true, writable: true, value })
}

beforeAll(async () => {
  dom = await installDom()
  // the small DOM has no model of a <select>'s options, and React reads `select.options` to mark the chosen one
  Object.defineProperty(MiniElement.prototype, 'options', {
    configurable: true,
    get(this: MiniElement) {
      return this.localName === 'select' ? this.querySelectorAll('option') : undefined
    },
  })
})
afterAll(async () => {
  delete (MiniElement.prototype as unknown as Record<string, unknown>).options
  await dom.uninstall()
})

beforeEach(async () => {
  touched.length = 0
  downloads.length = 0
  blobs.length = 0
  spawned.length = 0
  gate = null
  script = null
  // the network, browser storage and the ledger's stores are trapped from before the page mounts until it is gone
  for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB']) trap(n)
  setGlobal('Worker', function Worker() {
    return new FakeWorker()
  })
  const urls = URL
  saved.set('URL.createObjectURL', Object.getOwnPropertyDescriptor(urls, 'createObjectURL'))
  saved.set('URL.revokeObjectURL', Object.getOwnPropertyDescriptor(urls, 'revokeObjectURL'))
  Object.defineProperty(urls, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (b: Blob) => {
      blobs.push(b)
      return `blob:test/${blobs.length}`
    },
  })
  Object.defineProperty(urls, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
  // an anchor clicked in the page is a download started: record where it points and what it is called
  dom.document.addEventListener('click', onClick)
  page = await dom.mount(createElement(MemoryRouter, null, createElement(ServiceCapstone)))
})

function onClick(e: MiniEvent) {
  const link = e.target as (MiniElement & { download?: string; href?: string }) | null
  if (link && link.localName === 'a' && link.download) downloads.push({ href: link.href ?? '', download: link.download })
}

afterEach(async () => {
  await page.unmount()
  dom.document.removeEventListener('click', onClick)
  for (const [name, d] of saved) {
    const owner = name.startsWith('URL.') ? URL : g
    const key = name.startsWith('URL.') ? name.slice(4) : name
    if (d) Object.defineProperty(owner, key, d)
    else delete (owner as Record<string, unknown>)[key]
  }
  saved.clear()
})

/* ------------------------------- helpers ------------------------------- */

const $ = (sel: string): MiniElement | null => page.container.querySelector(sel)
const must = (sel: string): MiniElement => {
  const el = $(sel)
  if (!el) throw new Error(`no element for ${sel}`)
  return el
}

async function type(sel: string, value: string): Promise<void> {
  const el = must(sel)
  await dom.act(() => {
    el.value = value
    el.dispatchEvent(new MiniEvent('input', { bubbles: true }))
  })
}

async function pickFile(sel: string, file: File): Promise<void> {
  const el = must(sel)
  await dom.act(() => {
    Object.defineProperty(el, 'files', { configurable: true, value: [file] })
    el.dispatchEvent(new MiniEvent('change', { bubbles: true }))
  })
  // the page reads the file, then sets its state
  await dom.until(() => true)
}

const csvFile = (body: string, name = 'mine.csv') => new File([body], name, { type: 'text/csv' })

/** Everything on the page a learner can type into or pick from, but the run's own buttons. */
const controls = (): MiniElement[] => page.container.querySelectorAll('input, textarea, select')

/** A trace, a config and the weights: the form can run. */
async function fillForm(rows = 60): Promise<void> {
  await pickFile('#byo-trace', csvFile(makeCsv(rows)))
  await type('#byo-config', LLAMA)
  await type('#byo-weights', '16')
}

const runButton = (): MiniElement => must('[data-action="run"]')

/* -------------------------------- tests -------------------------------- */

describe('the page opens empty and says what it needs', () => {
  test('a form with nothing in it: the run is off, and the page names the next thing', () => {
    expect(must('h1').textContent).toBe('Your service, on your device')
    expect(runButton().disabled).toBe(true)
    expect(must('[data-needs]').textContent).toBe('Pick a trace to run.')
    expect($('[data-result="kv"]')).toBeNull()
    expect($('[data-result="run"]')).toBeNull()
    expect(controls().every((c) => !c.disabled)).toBe(true)
  })

  test('each card heading is a size the config has (h4), never text-h5', () => {
    const headings = page.container.querySelectorAll('legend, h2')
    expect(headings.length).toBeGreaterThanOrEqual(5)
    for (const h of headings) {
      expect(h.className, h.textContent ?? '').toContain('text-h4')
      expect(h.className).not.toContain('text-h5')
    }
  })

  test('a trace and a config bring KV per token; the weights bring the pool and the run', async () => {
    await pickFile('#byo-trace', csvFile(makeCsv(60)))
    expect(must('[data-ok="trace"]').textContent).toContain('60 requests')
    expect(must('[data-needs]').textContent).toBe('Add a model config to run.')
    await type('#byo-config', LLAMA)
    expect(must('[data-ok="config"]').textContent).toContain('32 layers')
    expect($('[data-result="kv"]')).not.toBeNull()
    expect(must('[data-needs]').textContent).toBe('Fix the fields marked above to run.')
    await type('#byo-weights', '16')
    expect(must('[data-pool]').textContent).toContain('blocks of 16 tokens')
    expect(runButton().disabled).toBe(false)
    expect($('[data-needs]')).toBeNull()
  })
})

describe('the stale-price notice', () => {
  test('a price read today says nothing; one read long ago says how old it is and that the atlas calls it stale', async () => {
    await type('#byo-price-date', localDay())
    expect($('[data-stale-price]')).toBeNull()
    await type('#byo-price-date', '2000-01-01')
    const notice = must('[data-stale-price]').textContent ?? ''
    expect(notice).toMatch(/This price is [\d,]+ days old/)
    expect(notice).toContain('older than 90 days')
    await type('#byo-price-date', localDay())
    expect($('[data-stale-price]')).toBeNull()
  })

  test('a date that is not a date, or is in the future, is a field error and not a notice', async () => {
    await type('#byo-price-date', 'last week')
    expect($('[data-stale-price]')).toBeNull()
    expect(must('#byo-price-date-error').textContent).toContain('YYYY-MM-DD')
    expect(must('#byo-price-date').getAttribute('aria-invalid')).toBe('true')
    await type('#byo-price-date', '2999-01-01')
    expect(must('#byo-price-date-error').textContent).toContain('not in the future')
  })
})

describe('each error state is named where the learner is looking', () => {
  test('a CSV with a bad line: the trace error names the file and the CSV line', async () => {
    await pickFile('#byo-trace', csvFile('arrival_s,p,o\n0,5,5\n1,5.5,5\n', 'bad.csv'))
    const e = must('[data-error="trace"]').textContent ?? ''
    expect(e).toContain('bad.csv')
    expect(e).toContain('line 3: p must be a whole number')
    expect($('[data-ok="trace"]')).toBeNull()
  })

  test('a CSV spanning more than 10,000,000 ticks is refused with its own line, not the parser\'s index', async () => {
    // line 2 is the earliest; line 3 arrives 10,000,001 ticks (500,000.05 s) after it, and the run would use 2 rows
    await pickFile('#byo-trace', csvFile('t,p,o\n0,5,5\n10000001,5,5\n', 'long.csv'))
    const e = must('[data-error="trace"]').textContent ?? ''
    expect(e).toContain('line 3')
    expect(e).toContain('10,000,000 ticks')
    expect(e).toContain('500,000 s')
    expect(e).not.toContain('trace request')
  })

  test('a file that is not a trace, and a trace over the size limit', async () => {
    await pickFile('#byo-trace', new File(['hello'], 'notes.txt'))
    expect(must('[data-error="trace"]').textContent).toContain('.json trace or a .csv')
    await pickFile('#byo-trace', new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'huge.csv'))
    expect(must('[data-error="trace"]').textContent).toContain('the page reads files up to 8 MiB')
  })

  test('a config that is not JSON, and a config file over the size limit', async () => {
    await type('#byo-config', 'not json at all')
    expect(must('[data-error="config"]').textContent).toBeTruthy()
    expect(must('#byo-config').getAttribute('aria-invalid')).toBe('true')
    expect($('[data-ok="config"]')).toBeNull()
    await pickFile('#byo-config-file', new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big-config.json'))
    expect(must('[data-error="config"]').textContent).toContain('big-config.json: ')
    expect(must('[data-error="config"]').textContent).toContain('up to 8 MiB')
    expect((must('#byo-config') as MiniElement).value).toBe('')
  })

  test('a setting out of range is marked on its field, and the run stays off', async () => {
    await fillForm()
    expect(runButton().disabled).toBe(false)
    await type('#byo-gpus', '0')
    expect(must('#byo-gpus-error').textContent).toBeTruthy()
    expect(must('#byo-gpus').getAttribute('aria-invalid')).toBe('true')
    expect(must('#byo-gpus').getAttribute('aria-describedby')).toContain('byo-gpus-error')
    expect(runButton().disabled).toBe(true)
    expect(must('[data-needs]').textContent).toBe('Fix the fields marked above to run.')
  })

  test('weights that leave no cache are a pool problem, named under the form', async () => {
    await fillForm()
    await type('#byo-weights', '72')
    expect(must('[data-error="pool"]').textContent).toContain('leave no room')
    expect($('[data-pool]')).toBeNull()
    expect(runButton().disabled).toBe(true)
    expect(must('[data-needs]').textContent).toBe('Fix the cache problem above to run.')
  })

  test('a worker that fails is an alert with its title and detail, the form is open again, and nothing is shown as a result', async () => {
    await fillForm()
    script = (req, emit) => {
      if (req.cmd === 'open') emit({ type: 'failed', id: req.id, kind: 'error', message: 'the fleet worker fell over' })
    }
    await dom.press(runButton())
    await dom.until(() => $('[data-error="run"]') !== null)
    const alert = must('[data-error="run"]')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toContain('the run failed')
    expect(alert.textContent).toContain('the fleet worker fell over')
    expect($('[data-result="run"]')).toBeNull()
    expect(controls().every((c) => !c.disabled)).toBe(true)
    expect(runButton().disabled).toBe(false)
    expect(must('[role="status"]').textContent).toBe('The run failed: the run failed.')
  })
})

describe('the run: start, a locked form, results, the download', () => {
  test('pressing Run locks every input until the results land, and the results describe the form', async () => {
    await fillForm()
    await type('#byo-slo', '1500')
    let release!: () => void
    gate = new Promise<void>((r) => (release = r))

    await dom.press(runButton())
    await dom.until(() => $('[data-running]') !== null)
    // started: one worker, the form locked, Run off, Cancel on offer, no results yet
    expect(spawned).toHaveLength(1)
    const locked = controls()
    expect(locked.length).toBeGreaterThanOrEqual(11)
    for (const c of locked) expect(c.disabled, c.id).toBe(true)
    expect(runButton().disabled).toBe(true)
    expect(page.container.querySelectorAll('button').some((b) => b.textContent === 'Cancel')).toBe(true)
    expect(must('[data-running]').textContent).toContain('The form is locked')
    expect($('[data-needs]')).toBeNull()
    expect($('[data-result="run"]')).toBeNull()
    expect(must('[role="status"]').textContent).toBe('Running the sample in the fleet worker.')
    // the values are still what the learner gave
    expect(must('#byo-slo').value).toBe('1500')
    expect(must('#byo-weights').value).toBe('16')

    release()
    await dom.until(() => $('[data-result="run"]') !== null)
    // results: the form is open again, the run is over, and the numbers are for the settings the form holds
    for (const c of controls()) expect(c.disabled, c.id).toBe(false)
    expect($('[data-running]')).toBeNull()
    const results = must('[data-result="run"]').textContent ?? ''
    expect(results).toContain('Requests served')
    expect(results).toContain('60 of 60')
    expect(results).toContain('First token inside 1,500 ms')
    expect(results).toContain(`Cost at $${Number(must('#byo-price').value).toPrecision(3).replace(/\.?0+$/, '')} per GPU-hour`)
    expect(results).toContain(`read ${must('#byo-price-date').value}`)
    expect(must('[data-per-mtok]').textContent).toMatch(/\$[\d.]+ per million tokens/)
    expect(must('[role="status"]').textContent).toContain('The run finished: 60 of 60 requests served')
    expect(spawned[0].terminated).toBe(true)
  })

  test('the download is offered with the results, and is the summary file with the same numbers', async () => {
    await fillForm()
    expect($('[data-action="download"]')).toBeNull()
    await dom.press(runButton())
    await dom.until(() => $('[data-action="download"]') !== null)
    await dom.press(must('[data-action="download"]'))
    expect(blobs).toHaveLength(1)
    expect(downloads).toEqual([{ href: 'blob:test/1', download: SUMMARY_FILE }])
    const summary = JSON.parse(await blobs[0].text())
    expect(summary.kind).toBe('kernelspace.service-capstone')
    expect(summary.trace.sampledRequests).toBe(60)
    expect(summary.batching.completed).toBe(60)
    expect(summary.hardware.weightsGb).toBe(16)
    expect(summary.batching.maxRunning).toBe(64)
    expect(summary.cost.priceDate).toBe(must('#byo-price-date').value)
    expect(summary.cost.perMtok).toBeGreaterThan(0)
    expect(JSON.stringify(summary)).not.toContain('num_hidden_layers')
  })

  test('editing a field after the results retires them, and the next run starts from the form', async () => {
    await fillForm()
    await dom.press(runButton())
    await dom.until(() => $('[data-result="run"]') !== null)
    await type('#byo-running', '32')
    expect($('[data-result="run"]')).toBeNull()
    expect($('[data-action="download"]')).toBeNull()
    expect(runButton().disabled).toBe(false)
    await dom.press(runButton())
    await dom.until(() => $('[data-result="run"]') !== null)
    expect(spawned).toHaveLength(2)
  })

  test('Cancel stops the worker, opens the form and leaves no results', async () => {
    await fillForm()
    let release!: () => void
    gate = new Promise<void>((r) => (release = r))
    await dom.press(runButton())
    await dom.until(() => $('[data-running]') !== null)
    const cancel = page.container.querySelectorAll('button').find((b) => b.textContent === 'Cancel')!
    await dom.press(cancel)
    // the run checks the signal between steps, so the worker stops when the step in flight (at most 2 s) comes back
    expect($('[data-running]')).not.toBeNull()
    release()
    await dom.until(() => $('[data-running]') === null)
    expect(spawned[0].terminated).toBe(true)
    expect($('[data-result="run"]')).toBeNull()
    expect($('[data-error="run"]')).toBeNull()
    for (const c of controls()) expect(c.disabled, c.id).toBe(false)
    expect(must('[role="status"]').textContent).toBe('The run was cancelled.')
  })

  test('leaving the page mid-run stops the worker', async () => {
    await fillForm()
    let release!: () => void
    gate = new Promise<void>((r) => (release = r))
    await dom.press(runButton())
    await dom.until(() => $('[data-running]') !== null)
    await page.unmount()
    // as with Cancel, the worker stops when the step in flight comes back
    release()
    await dom.until(() => spawned[0].terminated)
    expect(spawned[0].terminated).toBe(true)
  })

  test('start to finish, nothing went to the network and nothing was written to browser storage or the ledger', async () => {
    await fillForm()
    await dom.press(runButton())
    await dom.until(() => $('[data-action="download"]') !== null)
    await dom.press(must('[data-action="download"]'))
    // fetch, XMLHttpRequest, WebSocket, localStorage, sessionStorage and indexedDB were trapped before the page mounted
    expect(touched).toEqual([])
  })
})
