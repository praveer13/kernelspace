import { describe, expect, test } from 'bun:test'
import type { DiagramPredict, Prequestion } from '../../src/data/lessons/types'
import { BOOT_KCS } from '../../src/data/kc'
import { gradeItem, resultFor } from '../../src/lib/items/play'
import { diagramPredictRev, prequestionRev } from '../../src/lib/kc/resolve'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import {
  EXPERT_RECALL,
  PRE_GEN,
  PRE_NSEC,
  activePredict,
  blockKcs,
  captionVisible,
  depsFrom,
  diaRef,
  diaResponse,
  diagramPickOk,
  diagramSeed,
  eventsOf,
  expertFor,
  isExpert,
  maxStep,
  placementSolid,
  preRef,
  preResponse,
  prequestionItem,
  promptVisible,
  revealFor,
  savedGuesses,
  savedPrediction,
  scrolledPast,
  type PreDeps,
} from '../../src/lib/learner/prequestions'
import { shuffledOrder } from '../../src/lib/rng'

const CHOICE: Prequestion = {
  kind: 'choice',
  q: 'A free list holds two adjacent 16-byte holes. What does a request for 32 bytes get?',
  options: ['A hole, because the two merge', 'Nothing, because the holes are separate', 'A hole of 16 bytes'],
  correct: [0],
  why: ['Coalescing merges neighbours, so 32 bytes fit.', 'Only if nobody merges them.', '16 bytes is too small for 32.'],
  revealAt: 'Coalescing',
  kcs: ['t1.coalesce', 't1.free-list'],
}

const NUMERIC: Prequestion = {
  kind: 'numeric',
  q: 'How many bytes does one token of KV cache take?',
  unit: 'KiB',
  truth: 128,
  okWithinFactor: 2,
  revealAt: 'The cache',
  kcs: ['t1.kv'],
  claims: [],
}

const DIA: DiagramPredict = {
  step: 2,
  prompt: 'What happens to the stack pointer on the call?',
  options: ['It moves down', 'It stays', 'It moves up', 'It resets'],
  correct: [0],
  why: ['The stack grows down on this machine.', 'A call pushes a frame.', 'Up is the heap.', 'Nothing resets it.'],
  kcs: ['t0.stack'],
}

const T = (n: number) => `2026-10-0${n}T09:00:00.000Z`

/** What the façade stamps around an `ItemResponse`. */
function stamp(r: ItemResponse, n = 1, id = `e${n}`): LedgerEvent {
  const at = T(n)
  return { id, v: 1, at, tz: 0, day: at.slice(0, 10), dev: 'd', provenance: 'practice', ...r } as unknown as LedgerEvent
}

function answerChoice(picks: number[]) {
  const item = prequestionItem('t1.l4', 0, CHOICE)
  const g = gradeItem(item, { kind: 'choice', picks: picks.map(String) })
  return resultFor(item, { kind: 'choice', picks: picks.map(String) }, g, { seed: 7, ms: 4200.4, conf: 'think' })
}

function answerNumber(value: number) {
  const item = prequestionItem('t1.l4', 1, NUMERIC)
  const g = gradeItem(item, { kind: 'estimate', value }, PRE_GEN)
  return resultFor(item, { kind: 'estimate', value }, g, { seed: 9, ms: 9000 })
}

describe('refs and the ledger writes (spec §3.2, §9)', () => {
  test('refs follow the grammar', () => {
    expect(preRef('t1.l4', 0)).toBe('pre:t1.l4#0')
    expect(diaRef('t1.l3', 5)).toBe('dia:t1.l3#5')
  })

  test('a choice guess is an `item` on pre:, src pre, with the authored rev, kcs and nsec 20', () => {
    const w = preResponse('t1.l4', 0, CHOICE, answerChoice([0]))
    expect(w.kind).toBe('item')
    expect(w.ref).toBe('pre:t1.l4#0')
    expect(w.rev).toBe(prequestionRev(CHOICE))
    expect(w.ok).toBe(true)
    expect(w.conf).toBe('think')
    expect(w.data).toMatchObject({ src: 'pre', pick: [0], lessonId: 't1.l4', kcs: ['t1.coalesce', 't1.free-list'], nsec: PRE_NSEC })
    expect(PRE_NSEC).toBe(20)
    expect(validateEvent(stamp(w)).ok).toBe(true)
  })

  test('a numeric guess is a `predict` on pre:, carrying the typed number, unit and truth', () => {
    const w = preResponse('t1.l4', 1, NUMERIC, answerNumber(100))
    expect(w.kind).toBe('predict')
    expect(w.ref).toBe('pre:t1.l4#1')
    expect(w.rev).toBe(prequestionRev(NUMERIC))
    expect(w.ok).toBe(true)
    expect(w.data).toMatchObject({ value: 100, unit: 'KiB', truth: 128, src: 'pre', kcs: ['t1.kv'], nsec: 20 })
    expect(validateEvent(stamp(w)).ok).toBe(true)
  })

  test('a wrong numeric guess is graded at answer time, not hidden', () => {
    const w = preResponse('t1.l4', 1, NUMERIC, answerNumber(4))
    expect(w.ok).toBe(false)
    expect(w.score).toBeLessThan(1)
  })

  test('more than six KCs is cut to six so the codec accepts the event', () => {
    const wide: Prequestion = { ...CHOICE, kcs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }
    const w = preResponse('t1.l4', 0, wide, answerChoice([0]))
    expect((w.data as { kcs: string[] }).kcs).toHaveLength(6)
    expect(validateEvent(stamp(w)).ok).toBe(true)
  })

  test('a diagram prediction is an `item` on dia:, src diagram, with kcs and nsec', () => {
    const w = diaResponse('t0.l2', 3, DIA, 0, { ms: 3100.6, seed: 5 })
    expect(w.kind).toBe('item')
    expect(w.ref).toBe('dia:t0.l2#3')
    expect(w.rev).toBe(diagramPredictRev(DIA))
    expect(w.ok).toBe(true)
    expect(w.score).toBe(1)
    expect(w.ms).toBe(3101)
    expect(w.data).toMatchObject({ src: 'diagram', pick: [0], lessonId: 't0.l2', kcs: ['t0.stack'], nsec: 20 })
    expect(validateEvent(stamp(w)).ok).toBe(true)
    const miss = diaResponse('t0.l2', 3, DIA, 2)
    expect(miss.ok).toBe(false)
    expect(miss.score).toBe(0)
    expect(validateEvent(stamp(miss)).ok).toBe(true)
  })

  test('the prequestion player item keeps authored indices as option ids', () => {
    const item = prequestionItem('t1.l4', 0, CHOICE)
    expect(item.source).toBe('item')
    const num = prequestionItem('t1.l4', 1, NUMERIC)
    expect(num.source).toBe('gen')
    if (num.source === 'gen') {
      expect(num.inst.answer).toMatchObject({ kind: 'estimate', truth: 128, unit: 'KiB', okWithinFactor: 2 })
      expect(num.inst.nsec).toBe(20)
      expect(num.inst.kcs).toEqual(['t1.kv'])
    }
  })
})

describe('saved guesses (a reload keeps the answers)', () => {
  const choice = stamp(preResponse('t1.l4', 0, CHOICE, answerChoice([1])), 1, 'a')
  const numeric = stamp(preResponse('t1.l4', 1, NUMERIC, answerNumber(100)), 1, 'b')

  test('reads the pick, the value and the confidence back', () => {
    const [c, n] = savedGuesses([choice, numeric], 't1.l4', [CHOICE, NUMERIC])
    expect(c).toEqual({ ok: false, pick: [1], conf: 'think' })
    expect(n).toEqual({ ok: true, value: 100 })
  })

  test('an unanswered guess is null; another lesson or index does not leak in', () => {
    expect(savedGuesses([choice], 't1.l4', [CHOICE, NUMERIC])).toEqual([{ ok: false, pick: [1], conf: 'think' }, null])
    expect(savedGuesses([choice], 't1.l5', [CHOICE])).toEqual([null])
  })

  test('the first answer is the honest one', () => {
    const later = stamp(preResponse('t1.l4', 0, CHOICE, answerChoice([0])), 3, 'c')
    const [c] = savedGuesses([later, choice], 't1.l4', [CHOICE])
    expect(c?.pick).toEqual([1])
  })

  test('an edited prequestion reads as unanswered', () => {
    const edited: Prequestion = { ...CHOICE, q: `${CHOICE.q} (reworded)` }
    expect(savedGuesses([choice], 't1.l4', [edited])).toEqual([null])
  })

  test('a diagram prediction is found by its rev and block index', () => {
    const e = stamp(diaResponse('t0.l2', 3, DIA, 2))
    expect(savedPrediction([e], 't0.l2', 3, DIA)).toEqual({ ok: false, pick: [2] })
    expect(savedPrediction([e], 't0.l2', 4, DIA)).toBeNull()
    expect(savedPrediction([e], 't0.l2', 3, { ...DIA, prompt: 'Changed?' })).toBeNull()
  })

  test('eventsOf filters on the lesson prefix of the right namespace', async () => {
    const seen: unknown[] = []
    const deps: PreDeps = { events: async (f) => (seen.push(f), []), working: {}, today: '2026-10-05' }
    await eventsOf(deps, 'pre', 't1.l4')
    await eventsOf(deps, 'dia', 't0.l2')
    expect(seen).toEqual([{ refPrefix: 'pre:t1.l4#' }, { refPrefix: 'dia:t0.l2#' }])
  })
})

describe('the reveal (spec §9.1): said, truth, because', () => {
  test('a wrong choice names the pick, the key and the why of each', () => {
    const r = revealFor(CHOICE, { ok: false, pick: [1] })
    expect(r.said).toBe('Nothing, because the holes are separate')
    expect(r.truth).toBe('A hole, because the two merge')
    expect(r.ok).toBe(false)
    expect(r.because).toEqual(['Coalescing merges neighbours, so 32 bytes fit.'])
    expect(r.slip).toEqual(['Only if nobody merges them.'])
  })

  test('a right choice has no slip', () => {
    const r = revealFor(CHOICE, { ok: true, pick: [0] })
    expect(r.ok).toBe(true)
    expect(r.slip).toEqual([])
    expect(r.said).toBe(r.truth)
  })

  test('a numeric reveal shows both numbers with the unit and how far off a miss was', () => {
    const miss = revealFor(NUMERIC, { ok: false, value: 8 })
    expect(miss.said).toBe('8 KiB')
    expect(miss.truth).toBe('128 KiB')
    expect(miss.off).toBe('16×')
    const hit = revealFor(NUMERIC, { ok: true, value: 100 })
    expect(hit.off).toBeUndefined()
    expect(hit.because).toEqual([])
  })

  test('a missing value reads as nothing, never NaN', () => {
    expect(revealFor(NUMERIC, { ok: false }).said).toBe('nothing')
    expect(revealFor(CHOICE, { ok: false }).said).toBe('nothing')
  })

  test('scrolledPast: only a heading whose bottom edge is above the viewport has been read past', () => {
    expect(scrolledPast({ bottom: -1 })).toBe(true)
    expect(scrolledPast({ bottom: 0 })).toBe(false)
    expect(scrolledPast({ bottom: 300 })).toBe(false)
    expect(scrolledPast({ bottom: 5000 })).toBe(false)
  })
})

describe('the diagram gate (spec §9.2)', () => {
  const four = { steps: [{}, {}, {}, {}, {}], predictAt: DIA }

  test('a gate needs a step with one before it, a step inside the diagram and answerable options', () => {
    expect(activePredict(four)).toBe(DIA)
    expect(activePredict({ steps: four.steps })).toBeNull()
    expect(activePredict({ steps: four.steps, predictAt: { ...DIA, step: 0 } })).toBeNull()
    expect(activePredict({ steps: four.steps, predictAt: { ...DIA, step: 5 } })).toBeNull()
    expect(activePredict({ steps: four.steps, predictAt: { ...DIA, step: 1.5 } })).toBeNull()
    expect(activePredict({ steps: four.steps, predictAt: { ...DIA, options: ['only one'] } })).toBeNull()
    expect(activePredict({ steps: four.steps, predictAt: { ...DIA, correct: [] } })).toBeNull()
  })

  test('stepping stops one short of the gated step until a choice is committed', () => {
    expect(maxStep(5, DIA, false)).toBe(1)
    expect(maxStep(5, DIA, true)).toBe(4)
    expect(maxStep(5, null, false)).toBe(4)
    expect(maxStep(0, null, false)).toBe(0)
  })

  test('captions of the gated step and every later one stay hidden until the commit', () => {
    const shown = [0, 1, 2, 3, 4].map((i) => captionVisible(i, DIA, false))
    expect(shown).toEqual([true, true, false, false, false])
    expect([0, 1, 2, 3, 4].every((i) => captionVisible(i, DIA, true))).toBe(true)
    expect(captionVisible(3, null, false)).toBe(true)
  })

  test('the prompt shows on the step before the gated one, and only until the commit', () => {
    expect(promptVisible(1, DIA, false)).toBe(true)
    expect(promptVisible(0, DIA, false)).toBe(false)
    expect(promptVisible(2, DIA, false)).toBe(false)
    expect(promptVisible(1, DIA, true)).toBe(false)
    expect(promptVisible(1, null, false)).toBe(false)
  })

  test('the option order is stable per diagram, a permutation, and keyed by authored index', () => {
    const seed = diagramSeed('t0.l2', 3)
    expect(diagramSeed('t0.l2', 3)).toBe(seed)
    expect(diagramSeed('t0.l2', 4)).not.toBe(seed)
    const order = shuffledOrder(DIA.options.length, seed)
    expect([...order].sort()).toEqual([0, 1, 2, 3])
    expect(diagramPickOk(DIA, 0)).toBe(true)
    expect(diagramPickOk(DIA, 3)).toBe(false)
  })
})

describe('the expert skip (spec §9.1)', () => {
  test('every KC solid or recalled at 0.9 or better, and never with no KCs', () => {
    const recall = (m: Record<string, number>) => (kc: string) => m[kc] ?? null
    expect(isExpert(['a', 'b'], recall({ a: 0.95, b: EXPERT_RECALL }), new Set())).toBe(true)
    expect(isExpert(['a', 'b'], recall({ a: 0.95, b: 0.89 }), new Set())).toBe(false)
    expect(isExpert(['a', 'b'], recall({ a: 0.95 }), new Set())).toBe(false)
    expect(isExpert(['a', 'b'], recall({ a: 0.95 }), new Set(['b']))).toBe(true)
    expect(isExpert([], recall({}), new Set(['a']))).toBe(false)
  })

  test('blockKcs de-duplicates in order', () => {
    expect(blockKcs([CHOICE, { kcs: ['t1.kv', 't1.coalesce'] }])).toEqual(['t1.coalesce', 't1.free-list', 't1.kv'])
  })

  test('placement:result is read defensively', () => {
    expect([...placementSolid({ solidKcs: ['a', 'b'], other: 1 })]).toEqual(['a', 'b'])
    expect([...placementSolid({ solidKcs: ['a', 3, null] })]).toEqual(['a'])
    expect(placementSolid(undefined).size).toBe(0)
    expect(placementSolid({ solidKcs: 'a' }).size).toBe(0)
    expect(placementSolid([1] as never).size).toBe(0)
  })

  const deps = (over: Partial<PreDeps>): PreDeps => ({ events: async () => [], working: {}, today: '2026-10-05', ...over })

  test('expertFor: placement-solid KCs skip without reading the ledger', async () => {
    let read = false
    const solid = { 'placement:result': { solidKcs: ['x', 'y'] } } as PreDeps['working']
    const yes = await expertFor(['x', 'y'], deps({ working: solid, events: async () => ((read = true), []) }))
    expect(yes).toBe(true)
    expect(read).toBe(false)
  })

  test('expertFor: a fresh learner is asked, and a block with no KCs is never skipped', async () => {
    expect(await expertFor([BOOT_KCS[0]], deps({}))).toBe(false)
    expect(await expertFor([], deps({}))).toBe(false)
  })

  test('expertFor: a KC whose card was just earned is known, then fades with time', async () => {
    const boot = { id: 'b', v: 1, kind: 'complete', ref: 'boot', at: T(1), tz: 0, day: '2026-10-01', dev: 'd' } as unknown as LedgerEvent
    const kcs = [BOOT_KCS[0]]
    expect(await expertFor(kcs, deps({ events: async () => [boot], today: '2026-10-01' }))).toBe(true)
    expect(await expertFor(kcs, deps({ events: async () => [boot], today: '2027-10-01' }))).toBe(false)
  })

  test('expertFor: a ledger that cannot be read means the block asks', async () => {
    const boom = deps({
      events: async () => {
        throw new Error('idb closed')
      },
    })
    expect(await expertFor([BOOT_KCS[0]], boom)).toBe(false)
  })

  test('a skip writes nothing: the helpers never touch the ledger themselves', async () => {
    const writes: unknown[] = []
    const store = {
      controls: { engine: async () => ({ events: async () => [] as LedgerEvent[] }) },
      getState: () => ({ working: {}, recordItems: (x: unknown) => writes.push(x) }),
    }
    const d = depsFrom(store, new Date('2026-10-05T12:00:00Z'))
    expect(d.today).toBe('2026-10-05')
    await expertFor(['a'], d)
    expect(writes).toEqual([])
  })
})
