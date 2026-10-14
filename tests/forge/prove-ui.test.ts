/**
 * Prove-it v2 on ForgeLab (docs/specs/wave-3.md §7.4, task 3b-04): `ProveFromModule` mounted in the small DOM
 * (tests/dom/mini-dom.ts) against fake modules (tests/forge/fixtures.ts) and an in-memory record of what the ledger
 * would be handed. They assert on the DOM, focus, `aria-live` regions and the `ProveResult` written, never on source
 * text. The panel's env (worker, ledger, clock) is injected, as the component documents.
 *
 * Browser checks (axe at 360, 320 and 1280 px; a real wasm through ForgeLab) are the a11y harness's and Playwright's.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import ProveFromModule, { type ProveFromModuleProps } from '../../src/components/forge/ProveFromModule'
import bundle from '../../src/data/forge/kv-block-manager'
import { FREE_AFTER, TRANSLATE } from '../../src/data/forge/kv-block-manager/prove2'
import type { ForgeBundle, ProveV2Template } from '../../src/data/forge/types'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS } from '../../src/data/labs'
import { planQuestion, readAnswer } from '../../src/lib/forge/prove2'
import { formatValue } from '../../src/lib/forge/prove-return'
import type { PanelEnv } from '../../src/lib/forge/prove-return'
import type { Prove2Attempt } from '../../src/lib/forge/prove2'
import type { LabRunReport } from '../../src/lib/forge/types'
import type { ProveResult } from '../../src/lib/ledger/types'
import { installDom, MiniEvent, type DomKit, type MiniElement, type Mounted } from '../dom/mini-dom'
import { fakeBlockManager, fakeBridge, Spin, trap } from './fixtures'

const lab = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
const SHA = 'ab'.repeat(32)
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer
const green: LabRunReport = {
  lab: lab.id,
  reference: false,
  abi: 2,
  version: 3,
  seeds: 'fresh',
  ms: 3,
  checks: lab.checks.map((c) => ({ id: c.id, label: c.label, status: 'pass', msg: '' })),
}
const failing: LabRunReport = { ...green, checks: green.checks.map((c, i) => (i === 0 ? { ...c, status: 'fail' as const } : c)) }
const SEED = 3

/** What a correct manager replies to the seed-3 `free-after` trace: the truth a right answer equals. */
async function truthOf(t: ProveV2Template, seed: number, make = fakeBlockManager()): Promise<number | number[]> {
  const plan = planQuestion(t, seed)
  return t.read(await fakeBridge(make).run(new ArrayBuffer(0), plan.calls))
}

interface Rig {
  env: PanelEnv
  recorded: ProveResult[]
  runs: string[][]
  clock: { t: number }
}

function rig(over: Partial<PanelEnv> = {}, make = fakeBlockManager(), history: Prove2Attempt[] = []): Rig {
  const bridge = fakeBridge(make)
  const recorded: ProveResult[] = []
  const clock = { t: Date.parse('2026-10-04T09:00:00.000Z') }
  const env: PanelEnv = {
    run: bridge.run,
    record: (r) => void recorded.push(r),
    now: () => clock.t,
    hash: async () => SHA,
    seed: () => SEED,
    history: async () => history,
    ...over,
  }
  return { env, recorded, runs: bridge.runs, clock }
}

describe('ProveFromModule: Close your agent', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  const props = (r: Rig, over: Partial<ProveFromModuleProps> = {}): ProveFromModuleProps => ({ lab, bundle, bytes, report: green, credit: 'unseen', env: r.env, ...over })
  const open = async (r: Rig, over: Partial<ProveFromModuleProps> = {}): Promise<Mounted> => {
    const page = await dom.mount(createElement(ProveFromModule, props(r, over)))
    await dom.until(() => page.container.querySelector('[data-prove-answer]') !== null)
    return page
  }
  const q = (page: Mounted, sel: string) => page.container.querySelector(sel) as MiniElement
  const type = async (el: MiniElement, value: string) =>
    dom.act(() => {
      el.value = value
      el.dispatchEvent(new MiniEvent('input', { bubbles: true }))
    })
  const run = async (page: Mounted) => dom.press(q(page, '[data-prove-run]'))
  const verdictText = (page: Mounted) => q(page, '[data-prove-verdict]').textContent
  const answerAndRun = async (page: Mounted, value: string) => {
    await type(q(page, '[data-prove-answer]'), value)
    await run(page)
    await dom.until(() => verdictText(page) !== '')
  }

  test('after an unseen-seed green it draws the next template on the fresh seed and tells the trace in words', async () => {
    const r = rig()
    const page = await open(r)
    const plan = planQuestion(FREE_AFTER, SEED)
    expect(q(page, '[data-prove-v2]').getAttribute('data-qid')).toBe('free-after')
    const lines = q(page, '[data-prove-story]').querySelectorAll('li')
    expect(lines.map((li) => li.textContent.replace(/^\d+\.\s*/, ''))).toEqual(plan.story)
    // the question is asked of the learner, labelled, and nothing has run yet
    const input = q(page, '[data-prove-answer]')
    const label = page.container.querySelector(`label[for="${input.getAttribute('id')}"]`)
    expect(label?.textContent).toContain('How many blocks are free')
    expect(r.runs).toHaveLength(0)
    expect(r.recorded).toHaveLength(0)
    expect(page.container.textContent).toContain('calibration, not a test')
    await page.unmount()
  })

  test('the verdict and the input message are aria-live regions that are mounted before they have anything to say', async () => {
    const page = await open(rig())
    for (const sel of ['[data-prove-verdict]', '[data-prove-message]']) {
      const el = q(page, sel)
      expect(el.getAttribute('aria-live')).toBe('polite')
      expect(el.getAttribute('role')).toBe('status')
      expect(el.textContent).toBe('')
    }
    await page.unmount()
  })

  test('a right answer on the module just graded is recorded as proved, with the hash, the seed and the module’s own actual', async () => {
    const r = rig()
    const truth = await truthOf(FREE_AFTER, SEED)
    const page = await open(r)
    await answerAndRun(page, String(truth))
    expect(r.runs).toHaveLength(1)
    expect(r.recorded).toHaveLength(1)
    expect(r.recorded[0]).toMatchObject({
      labId: lab.id,
      ok: true,
      score: 1,
      provenance: 'proved',
      wasmSha256: SHA,
      seed: SEED,
      data: { v: 2, qid: 'free-after', answer: truth, actual: truth },
    })
    expect(r.recorded[0].data).not.toHaveProperty('return')
    expect(verdictText(page)).toContain(`Right: your module replied ${truth}.`)
    expect(verdictText(page)).toContain('Saved as proved')
    await page.unmount()
  })

  test('a miss shows your module’s actual reply beside your prediction, and when the next credited attempt opens', async () => {
    const r = rig()
    const truth = (await truthOf(FREE_AFTER, SEED)) as number
    const page = await open(r)
    await answerAndRun(page, String(truth + 1))
    expect(r.recorded[0]).toMatchObject({ ok: false, score: 0, provenance: 'practice', data: { answer: truth + 1, actual: truth } })
    const text = verdictText(page)
    expect(text).toContain(`you said ${truth + 1}, and your module replied ${truth}`)
    expect(text).toContain('Saved as a credited miss')
    expect(text).toContain('The next credited attempt opens in 24 h')
    await page.unmount()
  })

  test('after a credited miss the next question says its attempt is practice and when a credited one opens; it is recorded as practice, even when right', async () => {
    const r = rig()
    const page = await open(r)
    await answerAndRun(page, '0') // free-after: a miss (the truth is never 0 here)
    const next = q(page, '[data-prove-next]')
    expect(next).not.toBeNull()
    // focus follows the pressed button, which unmounted, to the next step
    expect(dom.document.activeElement).toBe(next)
    await dom.press(next)
    await dom.until(() => q(page, '[data-prove-v2]')?.getAttribute('data-qid') === 'translate')
    expect(q(page, '[data-prove-note]').textContent).toContain('A credited attempt opens in 24 h')
    expect(q(page, '[data-prove-note]').textContent).toContain('practice')
    const truth = await truthOf(TRANSLATE, SEED)
    await answerAndRun(page, String(truth))
    expect(r.recorded).toHaveLength(2)
    expect(r.recorded[1]).toMatchObject({ ok: true, provenance: 'practice' })
    expect(verdictText(page)).toContain('Saved as practice: a credited attempt is still waiting out its 24 h.')
    await page.unmount()
  })

  test('input that is not an answer gets readAnswer’s message in an aria-live region, keeps the input, and runs and records nothing', async () => {
    const r = rig()
    const page = await open(r)
    const input = q(page, '[data-prove-answer]')
    await type(input, 'about six')
    await run(page)
    const msg = readAnswer('about six', 'number')
    expect(msg.ok).toBe(false)
    expect(q(page, '[data-prove-message]').textContent).toBe(msg.ok ? '' : msg.message)
    expect(input.value).toBe('about six')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toContain(q(page, '[data-prove-message]').getAttribute('id') ?? '?')
    expect(dom.document.activeElement).toBe(input)
    expect(r.runs).toHaveLength(0)
    expect(r.recorded).toHaveLength(0)
    // a corrected answer clears the message and runs
    await type(input, '6')
    await run(page)
    await dom.until(() => verdictText(page) !== '')
    expect(q(page, '[data-prove-message]').textContent).toBe('')
    expect(r.recorded).toHaveLength(1)
    await page.unmount()
  })

  test('an empty answer is not an answer either', async () => {
    const r = rig()
    const page = await open(r)
    await run(page)
    expect(q(page, '[data-prove-message]').textContent).toBe('Type one number, such as 12 or 2.5.')
    expect(r.recorded).toHaveLength(0)
    await page.unmount()
  })

  describe('an ids template: the empty list is `none`', () => {
    const IDS: ProveV2Template = {
      id: 'preempt',
      kcs: [KC.blockRefcounts],
      bug: 'preempting the oldest instead of the newest',
      make: () => ({ calls: ['preempted'], story: ['Run a step with no memory pressure.'], ask: 'Which requests are preempted, in order?', answer: 'ids' }),
      read: (replies) => (replies[0] === 'none' ? [] : replies[0].split(',').map(Number)),
    }
    const idsBundle: ForgeBundle = { ...bundle, prove2: { templates: [IDS] } }
    const reply = (text: string) => rig({ run: async () => [text] })

    test('`none` is accepted and equals a module that replies none', async () => {
      const r = reply('none')
      const page = await open(r, { bundle: idsBundle })
      expect(q(page, '[data-prove-answer]').getAttribute('inputmode')).toBe('text')
      await answerAndRun(page, 'none')
      expect(r.recorded[0]).toMatchObject({ ok: true, provenance: 'proved', data: { answer: [], actual: [] } })
      expect(verdictText(page)).toContain('Right: your module replied none.')
      await page.unmount()
    })

    test('ids in order are read and compared in order', async () => {
      const r = reply('7,3,1')
      const page = await open(r, { bundle: idsBundle })
      await answerAndRun(page, '3, 7, 1')
      expect(r.recorded[0]).toMatchObject({ ok: false, data: { answer: [3, 7, 1], actual: [7, 3, 1] } })
      expect(verdictText(page)).toContain('you said 3, 7, 1, and your module replied 7, 3, 1')
      await page.unmount()
    })

    test('signs, decimals and letters get the ids message, and nothing is recorded', async () => {
      const r = reply('1')
      const page = await open(r, { bundle: idsBundle })
      await type(q(page, '[data-prove-answer]'), '1, -2')
      await run(page)
      const m = readAnswer('1, -2', 'ids')
      expect(q(page, '[data-prove-message]').textContent).toBe(m.ok ? '' : m.message)
      expect(r.recorded).toHaveLength(0)
      await page.unmount()
    })
  })

  test('a module that traps is a wrong answer with the failure shown, recorded without an actual', async () => {
    const r = rig({}, () => () => trap('index out of bounds'))
    const page = await open(r)
    await answerAndRun(page, '5')
    expect(r.recorded[0]).toMatchObject({ ok: false, provenance: 'practice', data: { answer: 5, actual: null } })
    expect(q(page, '[data-prove-verdict]').getAttribute('data-tone')).toBe('failed')
    expect(verdictText(page)).toContain('Your module did not answer the calls')
    await page.unmount()
  })

  test('a module that spins past the budget is a timeout, shown the same way', async () => {
    const r = rig({}, () => () => {
      throw new Spin()
    })
    const page = await open(r)
    await answerAndRun(page, '5')
    expect(r.recorded[0]).toMatchObject({ ok: false, data: { actual: null } })
    expect(verdictText(page)).toContain('so the grader stopped it')
    expect(verdictText(page)).not.toContain('..')
    await page.unmount()
  })

  test('a refused module (no bridge, a reference build) is reported and nothing is recorded', async () => {
    const { LabAbiError } = await import('../../src/lib/wasm-lab')
    const r = rig({
      run: async () => {
        throw new LabAbiError('this module has no ks_invoke bridge')
      },
    })
    const page = await open(r)
    await answerAndRun(page, '5')
    expect(verdictText(page)).toContain('this module has no ks_invoke bridge')
    expect(verdictText(page)).toContain('Nothing was recorded.')
    expect(r.recorded).toHaveLength(0)
    await page.unmount()
  })

  test('by default the module is named by the sha256 of its bytes, which is what proved records', async () => {
    const r = rig({ hash: undefined })
    const truth = await truthOf(FREE_AFTER, SEED)
    const page = await open(r)
    await answerAndRun(page, String(truth))
    expect(r.recorded[0].provenance).toBe('proved')
    expect(r.recorded[0].wasmSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(r.recorded[0].wasmSha256).not.toBe(SHA)
    await page.unmount()
  })

  test('a lab-green run opens nothing but a locked line; a reference build and a lab without templates render nothing', async () => {
    const r = rig()
    const green2 = await dom.mount(createElement(ProveFromModule, props(r, { credit: 'lab-green' })))
    expect(green2.container.querySelector('[data-prove2="locked"]')).not.toBeNull()
    expect(green2.container.querySelector('[data-prove-answer]')).toBeNull()
    await green2.unmount()

    const partial = await dom.mount(createElement(ProveFromModule, props(r, { report: failing })))
    expect(partial.container.querySelector('[data-prove2="locked"]')).not.toBeNull()
    await partial.unmount()

    const reference = await dom.mount(createElement(ProveFromModule, props(r, { credit: null })))
    expect(reference.container.innerHTML).toBe('')
    await reference.unmount()

    const v1Only = await dom.mount(createElement(ProveFromModule, props(r, { bundle: { ...bundle, prove2: undefined } })))
    expect(v1Only.container.innerHTML).toBe('')
    await v1Only.unmount()
  })

  test('a new module resets the panel: the question is drawn again for the new bytes', async () => {
    const r = rig()
    const page = await open(r)
    const input = q(page, '[data-prove-answer]')
    await type(input, '4')
    await page.render(createElement(ProveFromModule, props(r, { bytes: new Uint8Array([9, 9, 9]).buffer })))
    await dom.until(() => q(page, '[data-prove-answer]') !== null && q(page, '[data-prove-answer]').value === '')
    expect(q(page, '[data-prove-answer]').value).toBe('')
    await page.unmount()
  })

  test('a past credited miss still waiting out its 24 h is told before the first attempt', async () => {
    const r = rig({}, fakeBlockManager(), [{ at: '2026-10-04T03:00:00.000Z', qid: 'translate', right: false }])
    const page = await open(r)
    // translate was served, so free-after (never served) comes first; the wait is 18 h from 09:00
    expect(q(page, '[data-prove-note]').textContent).toContain('A credited attempt opens in 18 h')
    await page.unmount()
  })

  test('formatValue prints a number, ids, an empty list and a failed module', () => {
    expect(formatValue(6)).toBe('6')
    expect(formatValue([3, 7, 1])).toBe('3, 7, 1')
    expect(formatValue([])).toBe('none')
    expect(formatValue(null)).toBe('nothing')
  })
})
