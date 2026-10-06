/**
 * The Capstone sandbox protocol (spec wave-1 §14.1), end to end under Bun:
 * page client (CapstoneSandbox) → the real public/capstone-sandbox.js in a fake
 * frame → a fake worker running the real worker logic (serveOneJob + runStepJob).
 * Every hop clones its message, as postMessage would. Timers run at 1/10 speed.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { MIN_SPEEDUP, STEP5_REFERENCE_SOLUTION } from '../../src/lib/capstone-checks'
import { STEPS, runStepJob, type StepRunReply } from '../../src/lib/capstone/steps'
import {
  BOOT_DEADLINE_MS,
  CapstoneSandbox,
  FRAME_DEADLINE_MS,
  JOB_BUDGET_MS,
  LOCKDOWN_NAMES,
  TAG,
  WorkerRelay,
  lockdown,
  serveOneJob,
  type FrameHandle,
  type Timers,
  type WorkerLike,
  type WorkerScope,
} from '../../src/lib/capstone/sandbox'

const FRAME_JS = readFileSync(new URL('../../public/capstone-sandbox.js', import.meta.url), 'utf8')
const BUNDLE = '/* the built capstone.worker bundle */'
const SCALE = 10
const fast = (ms: number) => ms / SCALE
const timers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, fast(ms)),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}
const later = (fn: () => void) => setTimeout(fn, 0)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const solution = (id: string) => STEPS.find((s) => s.id === id)!.solution!

/* ------------------------------------------------------------------ */
/* A fake dedicated worker running the real worker-side code           */
/* ------------------------------------------------------------------ */

interface FakeWorkerOpts {
  /** code containing this never answers, like `while(true){}` */
  hangOn?: string
  /** globals the lockdown fails to remove */
  stubborn?: string[]
}

class FakeWorker implements WorkerLike {
  static spawned = 0
  static live = 0
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  terminated = false
  private scope: WorkerScope & Record<string, unknown>

  constructor(opts: FakeWorkerOpts = {}) {
    FakeWorker.spawned++
    FakeWorker.live++
    const scope: WorkerScope & Record<string, unknown> = {
      onmessage: null,
      postMessage: (msg) => later(() => !this.terminated && this.onmessage?.({ data: structuredClone(msg) })),
      indexedDB: {},
      BroadcastChannel: class {},
      fetch: () => {},
    }
    for (const name of opts.stubborn ?? []) Object.defineProperty(scope, name, { value: {}, writable: false, configurable: false })
    this.scope = scope
    later(() =>
      serveOneJob(scope, (stepId, code) => {
        if (opts.hangOn && code.includes(opts.hangOn)) throw new Hang()
        return runStepJob(stepId, code)
      }),
    )
  }

  postMessage(msg: unknown) {
    later(() => {
      if (this.terminated) return
      try {
        this.scope.onmessage?.({ data: structuredClone(msg) })
      } catch (e) {
        if (!(e instanceof Hang)) throw e // a hung job simply never answers
      }
    })
  }

  terminate() {
    if (!this.terminated) FakeWorker.live--
    this.terminated = true
  }
}
class Hang extends Error {}

/* ------------------------------------------------------------------ */
/* A fake frame hosting the real public/capstone-sandbox.js            */
/* ------------------------------------------------------------------ */

type Listener = (ev: { source: unknown; data: unknown }) => void

interface Page {
  win: { postMessage(msg: unknown, origin: string): void }
  listeners: Set<(source: unknown, data: unknown) => void>
  /** deliver a message to the page as if `source` posted it */
  deliver(source: unknown, data: unknown): void
  frames: FrameHandle[]
}

function makePage(): Page {
  const listeners = new Set<(source: unknown, data: unknown) => void>()
  const page: Page = {
    win: { postMessage: () => {} },
    listeners,
    deliver: (source, data) => later(() => listeners.forEach((fn) => fn(source, structuredClone(data)))),
    frames: [],
  }
  return page
}

interface FrameOpts {
  /** the frame's script never runs (blocked, or a browser that refuses) */
  silent?: boolean
  /** the Blob worker cannot be created in an opaque origin */
  noBlobWorker?: boolean
  /** the frame stops answering jobs */
  deaf?: boolean
  worker?: FakeWorkerOpts
  /** what `init` delivered, for assertions */
  seen?: string[]
}

function mountFakeFrame(page: Page, opts: FrameOpts = {}): FrameHandle {
  const listeners: Listener[] = []
  const blobs = new Map<string, string>()
  const frameWin = {
    parent: page.win,
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
  }
  // the frame's window.parent.postMessage lands in the page's listeners with source = this frame
  const parentProxy = { postMessage: (msg: unknown) => page.deliver(frameWin, msg) }
  frameWin.parent = parentProxy as Page['win']
  const handle: FrameHandle = {
    window: frameWin,
    post: (msg) => {
      if (opts.deaf && msg.type === 'job') return
      later(() => listeners.forEach((fn) => fn({ source: parentProxy, data: structuredClone(msg) })))
    },
    destroy: () => {
      listeners.length = 0
    },
  }
  if (!opts.silent) {
    const FrameWorker = function (url: string) {
      if (opts.noBlobWorker) throw new Error('SecurityError: workers are not allowed here')
      opts.seen?.push(blobs.get(url) ?? '')
      return new FakeWorker(opts.worker)
    }
    const URLs = {
      createObjectURL: (b: { text: string }) => {
        const url = `blob:null/${blobs.size}`
        blobs.set(url, b.text)
        return url
      },
    }
    const Blob = function (parts: string[]) {
      return { text: parts.join('') }
    }
    new Function('window', 'Worker', 'URL', 'Blob', 'setTimeout', 'clearTimeout', FRAME_JS)(
      frameWin,
      FrameWorker,
      URLs,
      Blob,
      timers.setTimeout,
      timers.clearTimeout,
    )
  }
  page.frames.push(handle)
  return handle
}

let nonces = 0
function makeSandbox(page: Page, frame: FrameOpts | null, worker: FakeWorkerOpts = {}, workerOnly = false) {
  return new CapstoneSandbox({
    workerOnly,
    mountFrame: () => (frame ? mountFakeFrame(page, frame) : null),
    listen: (fn) => {
      page.listeners.add(fn)
      return () => page.listeners.delete(fn)
    },
    workerSource: async () => BUNDLE,
    spawnWorker: () => new FakeWorker(worker),
    nonce: () => `n${++nonces}`,
    timers,
  })
}

/* ------------------------------------------------------------------ */

describe('runStepJob, the worker job', () => {
  test('every shown solution passes, and replies survive structured clone', () => {
    for (const step of STEPS) {
      if (!step.solution) continue
      const reply = runStepJob(step.id, step.solution)
      expect(reply.error).toBeNull()
      expect(Object.keys(reply.results).sort()).toEqual(step.checks.map((c) => c.id).sort())
      expect(Object.values(reply.results).every((r) => r.pass)).toBe(true)
      expect(structuredClone(reply)).toEqual(reply)
    }
  })

  test("step 5 reports the learner's own speedup", () => {
    const reply = runStepJob('kv-cache', STEP5_REFERENCE_SOLUTION)
    expect(Object.values(reply.results).every((r) => r.pass)).toBe(true)
    expect(reply.metrics.speedup).toBeGreaterThanOrEqual(MIN_SPEEDUP)
  })

  test('a syntax error or a hostile throw becomes data, not a crash', () => {
    expect(runStepJob('tokenize', 'return {').error).toBeString()
    const evil = runStepJob('tokenize', 'throw { toString() { throw new Error("nope") } }')
    expect(evil.error).toBe('threw a value that cannot be printed')
    expect(runStepJob('nope', '').error).toContain('unknown step')
  })
})

describe('lockdown', () => {
  test('removes names from the scope and its prototype chain, then pins them', () => {
    class Proto {
      get indexedDB() {
        return 'db'
      }
      fetch() {
        return 'net'
      }
    }
    const scope = Object.assign(new Proto(), { BroadcastChannel: class {}, keep: 1 }) as unknown as Record<string, unknown>
    expect(lockdown(scope, ['indexedDB', 'fetch', 'BroadcastChannel'])).toEqual([])
    expect(scope.indexedDB).toBeUndefined()
    expect(scope.fetch).toBeUndefined()
    expect(scope.BroadcastChannel).toBeUndefined()
    expect((Object.getPrototypeOf(scope) as Record<string, unknown>).indexedDB).toBeUndefined()
    expect(scope.keep).toBe(1)
    expect(() => (scope.indexedDB = 'again')).toThrow() // learner code runs in strict mode
    expect(scope.indexedDB).toBeUndefined()
  })

  test('reports what it could not remove', () => {
    const scope = {}
    Object.defineProperty(scope, 'indexedDB', { value: 'db', configurable: false })
    expect(lockdown(scope, ['indexedDB'])).toEqual(['indexedDB'])
  })

  test('covers storage, the network and other contexts', () => {
    for (const n of ['indexedDB', 'caches', 'BroadcastChannel', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'postMessage'])
      expect(LOCKDOWN_NAMES).toContain(n as (typeof LOCKDOWN_NAMES)[number])
  })
})

describe('serveOneJob, the worker entry', () => {
  test('locks the scope before any job, answers one job, ignores the rest', async () => {
    const out: unknown[] = []
    const scope = {
      onmessage: null,
      postMessage: (m: unknown) => out.push(m),
      indexedDB: {},
    } as WorkerScope & Record<string, unknown>
    let sawPost: unknown = 'unset'
    serveOneJob(scope, (stepId, code) => {
      sawPost = scope.postMessage // what learner code would find
      return runStepJob(stepId, code)
    })
    expect(out[0]).toEqual({ type: 'ready', exposed: [] })
    expect(scope.indexedDB).toBeUndefined()
    scope.onmessage!({ data: { type: 'job', stepId: 'tokenize', code: solution('tokenize') } })
    scope.onmessage!({ data: { type: 'job', stepId: 'tokenize', code: 'return {}' } })
    expect(sawPost).toBeUndefined()
    expect(out).toHaveLength(2)
    const done = out[1] as { type: string; reply: StepRunReply }
    expect(done.type).toBe('done')
    expect(Object.values(done.reply.results).every((r) => r.pass)).toBe(true)
  })
})

describe('WorkerRelay (worker-only fallback)', () => {
  test('one fresh worker per job, and a hung job is cut at the budget', async () => {
    FakeWorker.spawned = 0
    const relay = new WorkerRelay(() => new FakeWorker({ hangOn: 'while(true)' }), JOB_BUDGET_MS, timers)
    expect(await relay.boot()).toEqual([])
    const ok = await relay.run('tokenize', solution('tokenize'))
    expect(ok.kind).toBe('reply')
    const t0 = performance.now()
    const hung = await relay.run('tokenize', 'while(true){}')
    expect(hung.kind).toBe('timeout')
    expect(performance.now() - t0).toBeLessThan(fast(JOB_BUDGET_MS) + 100)
    expect(FakeWorker.spawned).toBe(3) // two jobs plus the next warm worker
    relay.dispose()
  })
})

describe('CapstoneSandbox through the real frame script', () => {
  test('round-trips a job: hello → init with the bundle → ready → job → result', async () => {
    const page = makePage()
    const seen: string[] = []
    const sb = makeSandbox(page, { seen })
    expect(await sb.start()).toBe('frame')
    expect(seen).toEqual([BUNDLE])
    const out = await sb.run('tokenize', solution('tokenize'))
    expect(out.kind).toBe('reply')
    if (out.kind !== 'reply') return
    expect(out.mode).toBe('frame')
    expect(Object.values(out.reply.results).every((r) => r.pass)).toBe(true)
    const bad = await sb.run('tokenize', STEPS[0].template)
    expect(bad.kind === 'reply' && bad.reply.results.todos.pass).toBe(false)
    sb.dispose()
  })

  test('ignores results from any other source, and stale nonces', async () => {
    const page = makePage()
    const sb = makeSandbox(page, {})
    await sb.start()
    const frame = page.frames[0]
    const forged: StepRunReply = { stepId: 'tokenize', error: null, results: { todos: { pass: true, msg: 'ok' } }, metrics: {} }
    const running = sb.run('tokenize', STEPS[0].template)
    // an impostor window with the right nonce, and the right window with a wrong nonce
    for (let n = 0; n <= nonces + 1; n++) {
      page.deliver({}, { tag: TAG, type: 'result', nonce: `n${n}`, reply: forged })
      page.deliver(frame.window, { tag: TAG, type: 'result', nonce: `stale${n}`, reply: forged })
    }
    const out = await running
    expect(out.kind === 'reply' && out.reply.results.todos.pass).toBe(false)
    sb.dispose()
  })

  test('a while(true) ends at the budget, and the next job still runs', async () => {
    const page = makePage()
    const sb = makeSandbox(page, { worker: { hangOn: 'while(true)' } })
    await sb.start()
    const t0 = performance.now()
    const out = await sb.run('tokenize', 'while(true){}')
    const ms = performance.now() - t0
    expect(out).toEqual({ kind: 'timeout', mode: 'frame', budgetMs: JOB_BUDGET_MS })
    // the frame's budget fires before the page's deadline
    expect(ms).toBeLessThan(fast(FRAME_DEADLINE_MS))
    const next = await sb.run('tokenize', solution('tokenize'))
    expect(next.kind).toBe('reply')
    sb.dispose()
  })

  test('a frame that stops answering is replaced', async () => {
    const page = makePage()
    let mounts = 0
    const sb = new CapstoneSandbox({
      mountFrame: () => mountFakeFrame(page, { deaf: ++mounts === 1 }),
      listen: (fn) => {
        page.listeners.add(fn)
        return () => page.listeners.delete(fn)
      },
      workerSource: async () => BUNDLE,
      spawnWorker: () => new FakeWorker(),
      nonce: () => `n${++nonces}`,
      timers,
    })
    const out = await sb.run('tokenize', solution('tokenize'))
    expect(out.kind).toBe('timeout')
    const again = await sb.run('tokenize', solution('tokenize'))
    expect(again.kind === 'reply' && again.mode).toBe('frame')
    expect(mounts).toBe(2)
    sb.dispose()
  })
})

describe('fallback: sandbox: worker only (owner answer O9)', () => {
  test('a frame that cannot host a Blob worker says so, and the page falls back', async () => {
    const page = makePage()
    const sb = makeSandbox(page, { noBlobWorker: true })
    expect(await sb.start()).toBe('worker')
    const out = await sb.run('tokenize', solution('tokenize'))
    expect(out.kind === 'reply' && out.mode).toBe('worker')
    sb.dispose()
  })

  test('a frame whose script never runs falls back after the boot deadline', async () => {
    const page = makePage()
    const sb = makeSandbox(page, { silent: true })
    const t0 = performance.now()
    expect(await sb.start()).toBe('worker')
    expect(performance.now() - t0).toBeGreaterThanOrEqual(fast(BOOT_DEADLINE_MS) - 5)
    sb.dispose()
  })

  test('worker only still cuts a while(true) at the budget', async () => {
    const page = makePage()
    const sb = makeSandbox(page, null, { hangOn: 'while(true)' }, true)
    expect(await sb.start()).toBe('worker')
    const out = await sb.run('tokenize', 'while(true){}')
    expect(out).toEqual({ kind: 'timeout', mode: 'worker', budgetMs: JOB_BUDGET_MS })
    sb.dispose()
  })

  test('refuses to run when the lockdown leaves storage reachable', async () => {
    const page = makePage()
    const sb = makeSandbox(page, null, { stubborn: ['indexedDB'] }, true)
    const out = await sb.run('tokenize', solution('tokenize'))
    expect(out.kind).toBe('unavailable')
    if (out.kind === 'unavailable') expect(out.reason).toContain('indexedDB')
    sb.dispose()
  })

  test('dispose leaves no worker running', async () => {
    FakeWorker.live = 0
    const page = makePage()
    const sb = makeSandbox(page, null, {}, true)
    await sb.run('tokenize', solution('tokenize'))
    sb.dispose()
    await sleep(5)
    expect(FakeWorker.live).toBe(0)
  })
})

describe('meta CSP (§14.2)', () => {
  test('build only, wasm-unsafe-eval without unsafe-eval, injected right after the charset', async () => {
    const { default: config, CSP } = await import('../../vite.config')
    const plugins = (config as { plugins: unknown[] }).plugins.flat() as {
      name?: string
      apply?: string
      transformIndexHtml?: { handler: (html: string) => string }
    }[]
    const plugin = plugins.find((p) => p?.name === 'kernelspace-meta-csp')!
    expect(plugin.apply).toBe('build')
    const directives = Object.fromEntries(CSP.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]))
    expect(directives['script-src']).toContain("'wasm-unsafe-eval'")
    expect(directives['script-src']).not.toContain("'unsafe-eval'")
    expect(directives['script-src']).not.toContain("'unsafe-inline'")
    expect(directives['worker-src']).toEqual(["'self'", 'blob:'])
    expect(directives['frame-src']).toContain("'self'")
    const handler = plugin.transformIndexHtml!.handler
    const html = handler(readFileSync(new URL('../../index.html', import.meta.url), 'utf8'))
    expect(html.slice(0, html.indexOf('<script'))).toMatch(
      /<meta charset="UTF-8" \/>\n\s*<meta http-equiv="Content-Security-Policy" content="default-src 'self'/,
    )
    expect(() => handler('<html><head></head></html>')).toThrow()
  })
})
