/**
 * The 30-day return (docs/specs/wave-3.md §7.5, task 3b-04): which labs are due, which question comes back, what the
 * ledger is handed, and the Today card mounted in the small DOM (tests/dom/mini-dom.ts) with a fake module and an
 * in-memory record of the writes. The card is lazy, so /today's static closure is `verify:bundle`'s to print.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import ProveReturnCard, { type ProveReturnCardProps } from '../../src/components/learner/ProveReturnCard'
import { loadForgeBundle } from '../../src/data/forge'
import bpe from '../../src/data/forge/bpe-tokenizer'
import { followUpRef as bpeRef } from '../../src/data/forge/bpe-tokenizer/prove'
import kv from '../../src/data/forge/kv-block-manager'
import { followUpRef as kvRef, PROVE_QUESTIONS } from '../../src/data/forge/kv-block-manager/prove'
import { FREE_AFTER } from '../../src/data/forge/kv-block-manager/prove2'
import { followUpRef as allocRef } from '../../src/data/forge/rust-allocator/prove'
import { FORGE_LABS } from '../../src/data/labs'
import { attemptsOf, firstProve, planQuestion } from '../../src/lib/forge/prove2'
import type { ProveEventLike } from '../../src/lib/forge/prove2'
import { dueReturns, followUpRefFor, followUpResponse, labRefNo, pickFollowUp, planReturn, returnAnswered } from '../../src/lib/forge/prove-return'
import type { ReturnEnv } from '../../src/lib/forge/prove-return'
import { validateEvent } from '../../src/lib/ledger/codec'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import type { ItemResponse, ProveData, ProveResult } from '../../src/lib/ledger/types'
import { installDom, MiniEvent, type DomKit, type MiniElement, type Mounted } from '../dom/mini-dom'
import { fakeBlockManager, fakeBridge } from '../forge/fixtures'
import { makeProfile, startTab } from '../ledger/env'

const SHA = 'cd'.repeat(32)
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer
const TODAY = '2026-11-04'
const FIRST = '2026-10-04' // 31 local days before TODAY

const at = (day: string, hour = 10): string => `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`

const v1Prove = (day: string, qids: string[], self: number[], lab = 'kv-block-manager'): ProveEventLike => ({
  kind: 'prove',
  ref: `prove:${lab}`,
  at: at(day),
  day,
  data: { v: 1, qids, self },
})
const v2Prove = (day: string, over: Record<string, unknown> = {}, lab = 'kv-block-manager'): ProveEventLike => ({
  kind: 'prove',
  ref: `prove:${lab}`,
  at: at(day),
  day,
  data: { v: 2, qid: 'free-after', kcs: [], answer: 1, actual: 2, calls: 5, ...over },
})
const labRun = (day: string, lab = 'kv-block-manager'): ProveEventLike => ({ kind: 'lab-check', ref: `lab:${lab}`, at: at(day, 9), day, provenance: 'unseen', wasmSha256: SHA })

describe('the follow-up ref of a v1 question', () => {
  test('is the one each lab’s own followUpRef gives, and a valid item ref', () => {
    expect(labRefNo('rust-allocator')).toBe('lab01')
    expect(labRefNo('kv-block-manager')).toBe('lab02')
    expect(labRefNo('bpe-tokenizer')).toBe('lab03')
    expect(followUpRefFor('rust-allocator', 'q')).toBe(allocRef('q'))
    expect(followUpRefFor('kv-block-manager', 'cow-trigger')).toBe(kvRef('cow-trigger'))
    expect(followUpRefFor('bpe-tokenizer', 'q')).toBe(bpeRef('q'))
    for (const q of PROVE_QUESTIONS) expect(refMatchesKind('item', followUpRefFor('kv-block-manager', q.id)!)).toBe(true)
  })

  test('every systems lab has a number, the Rust Zero labs and unknown ids none', () => {
    const systems = FORGE_LABS.filter((l) => !l.id.startsWith('rust-zero'))
    expect(systems.length).toBeGreaterThanOrEqual(8)
    expect(new Set(systems.map((l) => labRefNo(l.id))).size).toBe(systems.length)
    expect(labRefNo('rust-zero-r1')).toBeUndefined()
    expect(labRefNo('no-such-lab')).toBeUndefined()
    expect(followUpRefFor('no-such-lab', 'q')).toBeUndefined()
  })
})

describe('which labs are due', () => {
  test('30 local days after the first prove event, v1 or v2, and not a day before', () => {
    expect(dueReturns([v1Prove('2026-10-05', ['a'], [1])], '2026-11-03')).toEqual([])
    const due = dueReturns([v1Prove('2026-10-05', ['a'], [1])], '2026-11-04')
    expect(due).toMatchObject([{ labId: 'kv-block-manager', firstDay: '2026-10-05', dueDay: '2026-11-04', overdueDays: 0 }])
    // a v2 miss is a prove event as well, and the first one counts
    expect(dueReturns([v2Prove('2026-10-05')], '2026-11-04')).toHaveLength(1)
    expect(dueReturns([v1Prove('2026-10-20', ['a'], [1]), v2Prove('2026-10-05')], '2026-11-04')).toMatchObject([{ firstDay: '2026-10-05' }])
  })

  test('a lab whose return was answered, as a v2 prove event or a follow-up item, does not come again', () => {
    const v2Return = v2Prove('2026-11-04', { return: true })
    const itemReturn: ProveEventLike = { kind: 'item', ref: kvRef('cow-trigger'), at: at('2026-11-04'), day: '2026-11-04', data: { src: 'today', return: true } }
    const base = [v1Prove(FIRST, ['a'], [1])]
    expect(dueReturns(base, TODAY)).toHaveLength(1)
    expect(dueReturns([...base, v2Return], TODAY)).toEqual([])
    expect(dueReturns([...base, itemReturn], TODAY)).toEqual([])
    expect(returnAnswered([...base, itemReturn], 'kv-block-manager')).toBe(true)
    expect(returnAnswered([...base, itemReturn], 'bpe-tokenizer')).toBe(false)
    // an item of the lab that is not a return (an ordinary answer to the same ref) does not count
    const plain: ProveEventLike = { ...itemReturn, data: { src: 'today' } }
    expect(dueReturns([...base, plain], TODAY)).toHaveLength(1)
  })

  test('the most overdue lab is first; labs without a bundle-able id and malformed events are ignored', () => {
    const events = [v1Prove('2026-10-01', ['a'], [1], 'bpe-tokenizer'), v1Prove(FIRST, ['a'], [1]), v1Prove('2026-09-01', ['a'], [1], 'no-such-lab'), { kind: 'prove', ref: 'prove:', at: 'x', day: 'soon' }]
    expect(dueReturns(events, TODAY).map((d) => d.labId)).toEqual(['bpe-tokenizer', 'kv-block-manager'])
    expect(dueReturns(events, TODAY, ['kv-block-manager']).map((d) => d.labId)).toEqual(['kv-block-manager'])
  })

  test('firstProve reads the earliest event, which the due day is counted from', () => {
    expect(firstProve([v2Prove('2026-10-09'), v1Prove('2026-10-02', ['a'], [1])], 'kv-block-manager')?.day).toBe('2026-10-02')
  })
})

describe('which question comes back', () => {
  const pool = PROVE_QUESTIONS

  test('v1: from the first attempt’s questions, the ones graded "not yet" first', () => {
    const ids = pool.slice(0, 3).map((q) => q.id)
    const events = [v1Prove(FIRST, ids, [1, 0, 1]), v1Prove('2026-10-06', pool.slice(3, 6).map((q) => q.id), [0, 0, 0])]
    for (let seed = 0; seed < 12; seed++) expect(pickFollowUp(events, 'kv-block-manager', pool, seed)?.id).toBe(ids[1])
    // all "got it": any of the three
    const got = new Set([0, 1, 2, 3, 4, 5].map((s) => pickFollowUp([v1Prove(FIRST, ids, [1, 1, 1])], 'kv-block-manager', pool, s)?.id))
    expect([...got].every((id) => ids.includes(id!))).toBe(true)
    expect(got.size).toBeGreaterThan(1)
  })

  test('v1: a lab whose first prove event was v2 draws from the whole pool, and an empty pool draws nothing', () => {
    expect(pool.some((q) => q.id === pickFollowUp([v2Prove(FIRST)], 'kv-block-manager', pool, 4)?.id)).toBe(true)
    expect(pickFollowUp([v2Prove(FIRST)], 'kv-block-manager', [], 4)).toBeUndefined()
    // questions the bundle no longer has are skipped
    expect(pickFollowUp([v1Prove(FIRST, ['gone'], [0])], 'kv-block-manager', pool, 1)).toBeDefined()
  })

  test('v2 when the component is installed with its bytes and the bundle has templates; v1 otherwise', () => {
    const base = { labId: 'kv-block-manager', prove2: kv.prove2!.templates, prove: kv.prove, events: [v1Prove(FIRST, ['a'], [1])], seed: 3 }
    const v2 = planReturn({ ...base, installed: { sha256: SHA, bytes } })
    expect(v2).toMatchObject({ kind: 'v2', labId: 'kv-block-manager', installed: { sha256: SHA } })
    expect(v2?.kind === 'v2' && v2.plan).toEqual(planQuestion(FREE_AFTER, 3))
    expect(planReturn({ ...base, installed: null })?.kind).toBe('v1')
    // the hash is known but the bytes are not on this device (an import): v1
    expect(planReturn({ ...base, installed: { sha256: SHA, bytes: null } })?.kind).toBe('v1')
    expect(planReturn({ ...base, prove2: undefined, installed: { sha256: SHA, bytes } })?.kind).toBe('v1')
    const v1 = planReturn({ ...base, installed: null })
    expect(v1?.kind === 'v1' && v1.ref).toMatch(/^item:lab02\.prove\./)
  })

  test('v2 rotates: the template served longest ago, fresh seed each time', () => {
    const events = [v2Prove(FIRST, { qid: 'free-after' })]
    const plan = planReturn({ labId: 'kv-block-manager', prove2: kv.prove2!.templates, prove: kv.prove, events, installed: { sha256: SHA, bytes }, seed: 9 })
    expect(plan?.kind === 'v2' && plan.template.id).toBe('translate')
    expect(plan?.kind === 'v2' && plan.plan.seed).toBe(9)
    expect(plan?.kind === 'v2' && plan.history).toEqual(attemptsOf(events, 'kv-block-manager'))
  })

  test('a bundle with neither templates nor questions has nothing to ask', () => {
    expect(planReturn({ labId: 'kv-block-manager', prove2: undefined, prove: [], events: [], installed: null, seed: 1 })).toBeUndefined()
    expect(planReturn({ labId: 'no-such-lab', prove2: undefined, prove: kv.prove, events: [], installed: null, seed: 1 })).toBeUndefined()
  })
})

describe('the follow-up item the ledger is handed', () => {
  const q = PROVE_QUESTIONS[0]
  const ref = kvRef(q.id)

  test('two of three ideas is a pass; the text is never in it; it is practice with data.return', () => {
    const pass: ItemResponse = followUpResponse({ ref, question: q, ideas: [true, false, true], ms: 41_200.4 })
    expect(pass).toMatchObject({ kind: 'item', ref, ok: true, score: 1, provenance: 'practice', ms: 41_200, data: { src: 'today', ideas: [0, 2], return: true, nsec: 90 } })
    expect(pass.data).toMatchObject({ kcs: [...q.kcs] })
    expect(JSON.stringify(pass)).not.toContain('your answer')
    expect(followUpResponse({ ref, question: q, ideas: [false, true, false] })).toMatchObject({ ok: false, score: 0, data: { ideas: [1] } })
    expect(followUpResponse({ ref, question: q, ideas: [false, false, false] }).data).toMatchObject({ ideas: [] })
  })

  test('the ledger takes it, and a v2 return, and neither lab is due again', async () => {
    const tab = startTab(makeProfile())
    const first = v1Prove(FIRST, ['free-shared'], [0])
    expect(dueReturns([first], TODAY)).toHaveLength(1)
    tab.progress.getState().recordItems([followUpResponse({ ref, question: q, ideas: [true, true, false] })])
    const v2: ProveResult = {
      labId: 'bpe-tokenizer',
      score: 1,
      ok: true,
      provenance: 'practice',
      data: { v: 2, qid: 'merge', kcs: [], answer: 3, actual: 3, calls: 4, return: true } as ProveData,
    }
    tab.progress.getState().recordProve(v2)
    await tab.progress.controls.flush()
    const stored = (await (await tab.engine()).events()) as unknown as ProveEventLike[]
    const item = stored.find((e) => e.kind === 'item')
    const prove = stored.find((e) => e.kind === 'prove')
    expect(item).toMatchObject({ ref, data: { return: true, ideas: [0, 1], src: 'today' } })
    expect(prove).toMatchObject({ ref: 'prove:bpe-tokenizer', data: { v: 2, return: true } })
    for (const e of stored) expect(validateEvent(e)).toMatchObject({ ok: true })
    expect(returnAnswered([first, ...stored], 'kv-block-manager')).toBe(true)
    expect(dueReturns([first, ...stored], TODAY)).toEqual([])
  })
})

/* ------------------------------ the card ------------------------------ */

describe('ProveReturnCard on Today', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  interface Rig {
    env: ReturnEnv
    proves: ProveResult[]
    items: ItemResponse[][]
    runs: string[][]
  }
  function rig(events: ProveEventLike[], over: Partial<ReturnEnv> = {}, installed = true): Rig {
    const bridge = fakeBridge(fakeBlockManager())
    const proves: ProveResult[] = []
    const items: ItemResponse[][] = []
    let t = Date.parse(`${TODAY}T09:00:00.000Z`)
    const env: ReturnEnv = {
      run: bridge.run,
      record: (r) => void proves.push(r),
      now: () => t++,
      hash: async () => SHA,
      seed: () => 3,
      today: () => TODAY,
      events: async () => events,
      bundle: (id) => loadForgeBundle(id).catch(() => undefined),
      installed: async () => (installed ? { sha256: SHA, bytes } : null),
      recordItems: (i) => void items.push(i),
      ...over,
    }
    return { env, proves, items, runs: bridge.runs }
  }
  const open = async (r: Rig, variant: ProveReturnCardProps['variant'] = 'done'): Promise<Mounted> =>
    dom.mount(createElement(ProveReturnCard, { variant, env: r.env }))
  const q = (page: Mounted, sel: string) => page.container.querySelector(sel) as MiniElement
  const type = (el: MiniElement, value: string) =>
    dom.act(() => {
      el.value = value
      el.dispatchEvent(new MiniEvent('input', { bubbles: true }))
    })
  const settle = async (page: Mounted, sel: string) => dom.until(() => q(page, sel) !== null)

  test('nothing due: nothing is shown, so Today is not blocked or padded', async () => {
    const page = await open(rig([v1Prove('2026-10-20', ['a'], [1])]))
    await dom.act(() => new Promise((r) => setTimeout(r, 30)))
    expect(page.container.innerHTML).toBe('')
    await page.unmount()
    const none = await open(rig([]))
    await dom.act(() => new Promise((r) => setTimeout(r, 30)))
    expect(none.container.innerHTML).toBe('')
    await none.unmount()
  })

  /** What the card asked for: `events` is its own cheap read (once), anything more means the body chunk loaded and searched. */
  function counted(events: ProveEventLike[], over: Partial<ReturnEnv> = {}) {
    const calls = { events: 0, bundle: 0, installed: 0 }
    const r = rig(events, {
      events: async () => (calls.events++, events),
      bundle: async (id) => (calls.bundle++, loadForgeBundle(id).catch(() => undefined)),
      installed: async () => (calls.installed++, null),
      ...over,
    })
    return { r, calls }
  }

  test('an answered return loads nothing: the cheap check reads the events once and the body chunk and its due-lab search never run', async () => {
    // the first prove is 31 days old, so a check that only looks at age would load the body; the return was answered, so this one does not
    const answered = counted([v1Prove(FIRST, ['a'], [1]), v2Prove(TODAY, { return: true })])
    const page = await open(answered.r)
    await dom.act(() => new Promise((r) => setTimeout(r, 60)))
    expect(page.container.innerHTML).toBe('')
    expect(answered.calls).toEqual({ events: 1, bundle: 0, installed: 0 })
    await page.unmount()
    // control: the same ledger without the return does load it (the body reads the events again and asks for the bundle)
    const open1 = counted([v1Prove(FIRST, ['a'], [1])])
    const due = await open(open1.r)
    await settle(due, '[data-prove-return]')
    expect(open1.calls.events).toBeGreaterThan(1)
    expect(open1.calls.bundle).toBeGreaterThan(0)
    await due.unmount()
  })

  test('one lab answered and another not: the unanswered one still loads the card; the order of the events does not matter', async () => {
    const events = [v1Prove('2026-10-01', ['a'], [1], 'bpe-tokenizer'), v2Prove('2026-11-03', { return: true }, 'bpe-tokenizer'), v1Prove(FIRST, ['a'], [1])]
    for (const ordered of [events, [...events].reverse()]) {
      const { r, calls } = counted(ordered, { bundle: async (id) => (id === 'kv-block-manager' ? kv : undefined) })
      const page = await open(r)
      await settle(page, '[data-prove-return]')
      expect(q(page, '[data-prove-return]').getAttribute('data-lab')).toBe('kv-block-manager')
      expect(calls.events).toBeGreaterThan(1)
      await page.unmount()
    }
  })

  test('the return is counted from the first prove, not from a later one; a fresh re-prove of an old lab does not hide a due return', async () => {
    const { r, calls } = counted([v1Prove(FIRST, ['a'], [1]), v1Prove('2026-11-03', ['a'], [1])])
    const page = await open(r)
    await settle(page, '[data-prove-return]')
    expect(calls.events).toBeGreaterThan(1)
    await page.unmount()
  })

  test('a return answered as a v1 follow-up item is not a prove event: the card loads the body, which finds nothing to ask and shows nothing', async () => {
    const itemReturn: ProveEventLike = { kind: 'item', ref: kvRef('cow-trigger'), at: at(TODAY), day: TODAY, data: { src: 'today', return: true } }
    const { r, calls } = counted([v1Prove(FIRST, ['a'], [1]), itemReturn])
    const page = await open(r)
    await dom.until(() => calls.events > 1)
    await dom.act(() => new Promise((res) => setTimeout(res, 30)))
    expect(page.container.innerHTML).toBe('')
    await page.unmount()
  })

  test('v1: a follow-up question, the model answer after your own, then the ticks, recorded as a return item', async () => {
    const ids = PROVE_QUESTIONS.slice(0, 3).map((x) => x.id)
    const r = rig([v1Prove(FIRST, ids, [1, 0, 1])], {}, false)
    const page = await open(r, 'empty')
    await settle(page, '[data-prove-return-v1]')
    const card = q(page, '[data-prove-return]')
    expect(card.getAttribute('data-prove-return')).toBe('empty')
    expect(card.getAttribute('data-kind')).toBe('v1')
    expect(card.getAttribute('aria-labelledby')).toBe('prove-return-empty')
    expect(page.container.querySelector('#prove-return-empty')?.textContent).toContain('Lab 02')
    // the question served is the one graded "not yet"
    expect(q(page, '[data-prove-return-v1]').getAttribute('data-prove-return-v1')).toBe(ids[1])
    expect(q(page, '[data-ks-model]')).toBeNull()
    await type(q(page, 'textarea'), 'It copies the table and bumps the refcounts.')
    await dom.press(q(page, '[data-ks-reveal]'))
    expect(dom.document.activeElement).toBe(q(page, '[data-ks-model]'))
    // save is offered once the answer is out; two ticked ideas pass
    const boxes = page.container.querySelectorAll('[data-ks-idea]')
    expect(boxes).toHaveLength(3)
    for (const i of [0, 2]) await dom.act(() => boxes[i].dispatchEvent(new MiniEvent('click', { bubbles: true, cancelable: true })))
    await dom.press(q(page, '[data-prove-return-save]'))
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toHaveLength(1)
    expect(r.items[0][0]).toMatchObject({ kind: 'item', ref: kvRef(ids[1]), provenance: 'practice', data: { return: true, src: 'today' } })
    expect(r.items[0][0].data).not.toHaveProperty('text')
    expect(r.proves).toHaveLength(0)
    expect(q(page, '[data-prove-return-saved]').textContent).toContain('Saved: you covered')
    // the live region was mounted before the line, and the skip button is gone once answered
    expect(q(page, '[data-prove-return-saved]').closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite')
    expect(q(page, '[data-prove-return-skip]')).toBeNull()
    await page.unmount()
  })

  test('v2: the installed module answers a fresh seed; a right answer is recorded as a proved return', async () => {
    const r = rig([v1Prove(FIRST, ['a'], [1]), labRun(FIRST)])
    const page = await open(r)
    await settle(page, '[data-prove-answer]')
    expect(q(page, '[data-prove-return]').getAttribute('data-kind')).toBe('v2')
    expect(q(page, '[data-prove-v2]').getAttribute('data-qid')).toBe('free-after')
    expect(r.runs).toHaveLength(0)
    const plan = planQuestion(FREE_AFTER, 3)
    const truth = FREE_AFTER.read(await fakeBridge(fakeBlockManager()).run(bytes, plan.calls))
    await type(q(page, '[data-prove-answer]'), String(truth))
    await dom.press(q(page, '[data-prove-run]'))
    await dom.until(() => q(page, '[data-prove-verdict]').textContent !== '')
    expect(r.runs).toEqual([plan.calls])
    expect(r.proves).toHaveLength(1)
    expect(r.proves[0]).toMatchObject({
      labId: 'kv-block-manager',
      ok: true,
      provenance: 'proved',
      wasmSha256: SHA,
      seed: 3,
      data: { v: 2, qid: 'free-after', answer: truth, actual: truth, return: true },
    })
    expect(r.items).toHaveLength(0)
    // focus moved to the result, which the live region sits in
    expect(dom.document.activeElement).toBe(q(page, '[data-prove-result]'))
    expect(q(page, '[data-prove-verdict]').getAttribute('aria-live')).toBe('polite')
    await page.unmount()
  })

  test('v2: a miss shows your module’s reply and starts no wait', async () => {
    const r = rig([v1Prove(FIRST, ['a'], [1])])
    const page = await open(r)
    await settle(page, '[data-prove-answer]')
    const plan = planQuestion(FREE_AFTER, 3)
    const truth = FREE_AFTER.read(await fakeBridge(fakeBlockManager()).run(bytes, plan.calls)) as number
    await type(q(page, '[data-prove-answer]'), String(truth + 2))
    await dom.press(q(page, '[data-prove-run]'))
    await dom.until(() => q(page, '[data-prove-verdict]').textContent !== '')
    const text = q(page, '[data-prove-verdict]').textContent
    expect(text).toContain(`your module replied ${truth}`)
    expect(text).toContain('starts no wait')
    expect(text).toContain('Saved as a miss.')
    expect(text).not.toContain('credited')
    expect(text).not.toContain('opens in')
    expect(r.proves[0]).toMatchObject({ ok: false, provenance: 'practice', data: { return: true, answer: truth + 2, actual: truth } })
    await page.unmount()
  })

  test('v2: text that is not an answer gets the message and records nothing', async () => {
    const r = rig([v1Prove(FIRST, ['a'], [1])])
    const page = await open(r)
    await settle(page, '[data-prove-answer]')
    await type(q(page, '[data-prove-answer]'), 'six')
    await dom.press(q(page, '[data-prove-run]'))
    expect(q(page, '[data-prove-message]').textContent).toBe('Type one number, such as 12 or 2.5.')
    expect(r.proves).toHaveLength(0)
    expect(r.runs).toHaveLength(0)
    await page.unmount()
  })

  test('“Not today” hides the card for the visit and writes nothing', async () => {
    const r = rig([v1Prove(FIRST, ['a'], [1])])
    const page = await open(r)
    await settle(page, '[data-prove-return-skip]')
    await dom.press(q(page, '[data-prove-return-skip]'))
    expect(page.container.innerHTML).toBe('')
    expect(r.proves).toHaveLength(0)
    expect(r.items).toHaveLength(0)
    await page.unmount()
  })

  test('a lab whose bundle cannot be loaded is passed over for the next one', async () => {
    const events = [v1Prove('2026-09-01', ['a'], [1], 'bpe-tokenizer'), v1Prove(FIRST, ['a'], [1])]
    const r = rig(events, { bundle: async (id) => (id === 'bpe-tokenizer' ? undefined : kv) }, false)
    const page = await open(r)
    await settle(page, '[data-prove-return]')
    expect(q(page, '[data-prove-return]').getAttribute('data-lab')).toBe('kv-block-manager')
    await page.unmount()
    const bpeFirst = rig(events, { bundle: async (id) => (id === 'bpe-tokenizer' ? bpe : kv) }, false)
    const again = await open(bpeFirst)
    await settle(again, '[data-prove-return]')
    expect(q(again, '[data-prove-return]').getAttribute('data-lab')).toBe('bpe-tokenizer')
    await again.unmount()
  })
})
