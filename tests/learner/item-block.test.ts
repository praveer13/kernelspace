import { describe, expect, test } from 'bun:test'
import type { ItemBlock } from '../../src/data/lessons/types'
import { seedFor } from '../../src/lib/items/core'
import { correctResponse } from '../../src/lib/items/grade'
import { gradeItem, resultFor, type ItemResult } from '../../src/lib/items/play'
import { levelFor } from '../../src/lib/items/staircase'
import type { Instance, Level, PlayableItem, Response } from '../../src/lib/items/types'
import { validateEvent } from '../../src/lib/ledger/codec'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import {
  ITEM_COUNT,
  PREDICT_FACTOR,
  blockEventOf,
  blockGrp,
  blockNeeds,
  familyPrefix,
  itemBlockKcs,
  lessonItemResponse,
  makeAt,
  planItem,
  predictGen,
  predictInstance,
  predictLine,
  predictResponse,
  progressText,
  readBlock,
  seenKeys,
  variantsOf,
  wantsPredict,
  type BlockAt,
  type BlockEvent,
} from '../../src/lib/learner/item-block'
import { PRE_NSEC, expertFor, type PreDeps } from '../../src/lib/learner/prequestions'
import gen from '../items/fixture-family'

/* The fixture family answers in every kind: bytes-per-token is numeric, capacity an estimate, which-plane a choice. */

const BLOCK: ItemBlock = { type: 'item', title: 'Price it with new numbers', family: 'demo', variants: ['bytes-per-token', 'capacity', 'which-plane'] }
const AT: BlockAt = { lessonId: 't5.l2', blockIndex: 7, family: 'demo', count: 3 }
const CTX = { lessonId: AT.lessonId, blockIndex: AT.blockIndex }
const BASE = 0x1234abcd

const T = (n: number) => new Date(Date.UTC(2026, 9, 5, 9, 0, 0) + n * 1000).toISOString()

/** What the façade stamps around an `ItemResponse`, so the codec can judge it. */
function stamp(r: ItemResponse, n: number): LedgerEvent {
  const at = T(n)
  return { id: `e${n}`, v: 1, at, tz: 0, day: at.slice(0, 10), dev: 'd', provenance: 'practice', ...r } as unknown as LedgerEvent
}

/** A learner's answer to an instance, graded the way the card grades it. */
function answer(inst: Instance, response: Response, extra: { seed?: number; ms?: number } = {}): ItemResult {
  const item: PlayableItem = { source: 'gen', inst }
  const grade = gradeItem(item, response, gen)
  return resultFor(item, response, grade, { seed: extra.seed ?? inst.seed, ms: extra.ms ?? 4000 })
}

const right = (inst: Instance): ItemResult => answer(inst, correctResponse(inst))

/** The wrong answer: for numbers, ten times the truth (no ratio rule of the fixture family sits there); for a choice, a wrong option. */
function wrong(inst: Instance): ItemResult {
  const a = inst.answer
  if (a.kind === 'choice') return answer(inst, { kind: 'choice', picks: [a.options.find((o) => !a.correct.includes(o.id))?.id ?? ''] })
  if (a.kind === 'numeric') return answer(inst, { kind: 'numeric', value: a.truth * 37, unit: a.unit })
  return answer(inst, { kind: 'estimate', value: a.truth * 37 })
}

interface Sim {
  events: LedgerEvent[]
  n: number
}

/** Writes an answered item the way the component does and returns the stamped event. */
function writeItem(sim: Sim, inst: Instance, r: ItemResult): void {
  const item: PlayableItem = { source: 'gen', inst }
  const w = lessonItemResponse(r, item, CTX, seenKeys(sim.events))
  sim.n += 1
  sim.events.push(stamp(w, sim.n))
}

describe('the block', () => {
  test('count defaults to three and never drops below one', () => {
    expect(ITEM_COUNT).toBe(3)
    expect(blockNeeds(BLOCK)).toBe(3)
    expect(blockNeeds({ count: 5 })).toBe(5)
    expect(blockNeeds({ count: 0 })).toBe(1)
    expect(blockNeeds({ count: 2.9 })).toBe(2)
  })

  test('a prediction opens the block unless it says predict false', () => {
    expect(wantsPredict(BLOCK)).toBe(true)
    expect(wantsPredict({ ...BLOCK, predict: true })).toBe(true)
    expect(wantsPredict({ ...BLOCK, predict: false })).toBe(false)
  })

  test('the ledger group is <lessonId>#<blockIndex> and the family prefix is the ref grammar', () => {
    expect(blockGrp('t7.l1', 4)).toBe('t7.l1#4')
    expect(familyPrefix('goodput')).toBe('gen:goodput/')
  })

  test('variants the family lacks are dropped, and the block KCs are the union of the rest', () => {
    const odd: ItemBlock = { ...BLOCK, variants: ['capacity', 'nope', 'bytes-per-token'] }
    expect(variantsOf(gen, odd).map((v) => v.id)).toEqual(['capacity', 'bytes-per-token'])
    expect(itemBlockKcs(gen, odd)).toEqual(['t5.kv-capacity', 't5.kv-bytes-per-token'])
  })

  test('progress reads 2/3, then 3/3 · done, and never above the count', () => {
    expect(progressText(0, 3)).toBe('0/3')
    expect(progressText(2, 3)).toBe('2/3')
    expect(progressText(3, 3)).toBe('3/3 · done')
    expect(progressText(5, 3)).toBe('3/3 · done')
  })
})

describe('planning: fresh seeds at the staircase level', () => {
  test('the variants come round-robin and the plan is deterministic', () => {
    const ids = [0, 1, 2, 3, 4].map((i) => planItem(gen, BLOCK, [], BASE, i)?.inst.variant)
    expect(ids).toEqual(['bytes-per-token', 'capacity', 'which-plane', 'bytes-per-token', 'capacity'])
    expect(planItem(gen, BLOCK, [], BASE, 2)).toEqual(planItem(gen, BLOCK, [], BASE, 2))
    expect(planItem(gen, BLOCK, [], BASE, 0)?.inst.seed).toBe(seedFor(BASE, 0))
  })

  test('the first exposure is at the start level of the staircase', () => {
    expect(planItem(gen, BLOCK, [], BASE, 0)?.inst.level).toBe(1)
  })

  test('a seed the learner has met is skipped, so every item is unseen', () => {
    const first = planItem(gen, BLOCK, [], BASE, 0)
    expect(first).not.toBeNull()
    if (!first) return
    // the learner met seedFor(BASE, 0) on this variant and level in an earlier visit
    const met: BlockEvent = {
      kind: 'item',
      ref: `gen:demo/${first.inst.variant}`,
      at: T(1),
      ok: true,
      seed: first.inst.seed,
      data: { src: 'lesson', level: first.inst.level, kcs: first.inst.kcs },
    }
    const again = planItem(gen, BLOCK, [met], BASE, 0)
    expect(again?.inst.seed).toBe(seedFor(BASE, 1))
    expect(again?.inst.seed).not.toBe(first.inst.seed)
  })

  test('three correct in a row at a level raise it, a miss lowers it, read from the ledger the block wrote', () => {
    const sim: Sim = { events: [], n: 0 }
    const oneKc = { ...BLOCK, variants: ['bytes-per-token'] }
    for (let i = 0; i < 3; i++) {
      const p = planItem(gen, oneKc, sim.events, BASE, i)
      expect(p?.inst.level).toBe(1)
      if (p) writeItem(sim, p.inst, right(p.inst))
    }
    const up = planItem(gen, oneKc, sim.events, BASE, 3)
    expect(up?.inst.level).toBe(2)
    if (up) writeItem(sim, up.inst, wrong(up.inst))
    expect(planItem(gen, oneKc, sim.events, BASE, 4)?.inst.level).toBe(1)
    expect(levelFor(sim.events as never, 't5.kv-bytes-per-token', 'demo')).toBe(1)
  })

  test('a level the variant does not teach snaps to the nearest one it does', () => {
    // `capacity` teaches levels 1-3 only: a staircase at 0 is served at 1
    const sim: Sim = { events: [], n: 0 }
    const p = planItem(gen, { variants: ['capacity'] }, sim.events, BASE, 0)
    expect(p?.inst.level).toBe(1)
    const m = makeAt(gen, 'capacity', 0, 5)
    expect(m?.inst.level).toBe(1)
    expect(makeAt(gen, 'no-such-variant', 1, 5)).toBeNull()
  })

  test('a block whose variants the family lacks plans nothing', () => {
    expect(planItem(gen, { variants: ['nope'] }, [], BASE, 0)).toBeNull()
  })
})

describe('the prediction', () => {
  const numeric = () => gen.make(11, 2 as Level, 'bytes-per-token')
  const estimate = () => gen.make(11, 2 as Level, 'capacity')
  const choice = () => gen.make(11, 2 as Level, 'which-plane')

  test('a numeric answer becomes an estimate with a 90 % range, and no worked steps show', () => {
    // the fixture family has no worked steps of its own: give the level-0 instance two
    const made = gen.make(11, 0 as Level, 'bytes-per-token')
    const inst: Instance = { ...made, prompt: { ...made.prompt, worked: [{ text: [{ t: 'text', text: 'Count the planes.' }] }, { text: [{ t: 'text', text: 'Multiply.' }], result: { value: 2, unit: 'B' } }] } }
    expect(inst.prompt.worked).toHaveLength(2)
    const p = predictInstance(inst)
    expect(p.prompt.worked).toBeUndefined()
    expect(p.prompt.stem).toEqual(inst.prompt.stem)
    expect(p.nsec).toBe(PRE_NSEC)
    expect(p.answer.kind).toBe('estimate')
    if (p.answer.kind === 'estimate' && inst.answer.kind === 'numeric') {
      expect(p.answer.truth).toBe(inst.answer.truth)
      expect(p.answer.unit).toBe(inst.answer.unit)
      expect(p.answer.okWithinFactor).toBe(PREDICT_FACTOR)
      expect(p.answer.interval).toBe(true)
    }
  })

  test('an estimate and a choice keep their answers', () => {
    expect(predictInstance(estimate()).answer).toEqual(estimate().answer)
    expect(predictInstance(choice()).answer).toEqual(choice().answer)
  })

  test('a numeric prediction is scored as an estimate: within a factor of two is ok, ten times is not', () => {
    const inst = predictInstance(numeric())
    if (inst.answer.kind !== 'estimate') throw new Error('expected an estimate')
    const g = predictGen(gen)
    const item: PlayableItem = { source: 'gen', inst }
    expect(gradeItem(item, { kind: 'estimate', value: inst.answer.truth * 1.8 }, g).ok).toBe(true)
    const off = gradeItem(item, { kind: 'estimate', value: inst.answer.truth * 10 }, g)
    expect(off.ok).toBe(false)
    expect(off.score).toBeLessThan(1)
    expect(g.solution(inst)).toEqual([])
  })

  test('the numeric prediction is a predict event on the instance, src lesson, with the block group', () => {
    const inst = predictInstance(numeric())
    if (inst.answer.kind !== 'estimate') throw new Error('expected an estimate')
    const r = answer(inst, { kind: 'estimate', value: inst.answer.truth * 1.5, lo: inst.answer.truth, hi: inst.answer.truth * 2 }, { ms: 8000 })
    const w = predictResponse(inst, r, CTX)
    expect(w.kind).toBe('predict')
    expect(w.ref).toBe('gen:demo/bytes-per-token')
    expect(w.ok).toBe(true)
    expect(w.seed).toBe(inst.seed)
    expect(w.data).toMatchObject({
      src: 'lesson',
      unit: inst.answer.unit,
      truth: inst.answer.truth,
      value: inst.answer.truth * 1.5,
      lo: inst.answer.truth,
      hi: inst.answer.truth * 2,
      hit: true,
      nsec: PRE_NSEC,
      grp: 't5.l2#7',
      lessonId: 't5.l2',
      level: 2,
      variant: 'bytes-per-token',
    })
    expect((w.data as { kcs: string[] }).kcs).toEqual(['t5.kv-bytes-per-token'])
    expect(validateEvent(stamp(w, 1)).ok).toBe(true)
  })

  test('a pick is a predict event too: the authored option index, the keyed index and the unit "option"', () => {
    const inst = predictInstance(choice())
    if (inst.answer.kind !== 'choice') throw new Error('expected a choice')
    const a = inst.answer
    const keyed = a.options.findIndex((o) => o.id === a.correct[0])
    const wrongId = a.options.find((o) => !a.correct.includes(o.id))?.id ?? ''
    const hit = predictResponse(inst, answer(inst, { kind: 'choice', picks: [...a.correct] }), CTX)
    expect(hit.ok).toBe(true)
    expect(hit.data).toMatchObject({ src: 'lesson', unit: 'option', value: keyed, truth: keyed })
    const miss = predictResponse(inst, answer(inst, { kind: 'choice', picks: [wrongId] }), CTX)
    expect(miss.ok).toBe(false)
    expect(miss.data).toMatchObject({ unit: 'option', truth: keyed, value: a.options.findIndex((o) => o.id === wrongId) })
    expect(validateEvent(stamp(hit, 1)).ok).toBe(true)
    expect(validateEvent(stamp(miss, 2)).ok).toBe(true)
  })

  test('a prediction is never an item: it does not move the staircase or make an instance "seen"', () => {
    const inst = predictInstance(numeric())
    if (inst.answer.kind !== 'estimate') throw new Error('expected an estimate')
    const w = predictResponse(inst, answer(inst, { kind: 'estimate', value: inst.answer.truth }), CTX)
    const evs = [blockEventOf(w, T(1), 'local:1')]
    expect(seenKeys(evs).size).toBe(0)
    expect(levelFor(evs as never, 't5.kv-bytes-per-token', 'demo')).toBe(1)
  })

  test('the saved prediction reads back as a line', () => {
    expect(predictLine({ variant: 'v', seed: 1, ok: true, value: 480, truth: 512, unit: 'tok/s' })).toBe('You predicted 480 tok/s; the answer was 512 tok/s.')
    expect(predictLine({ variant: 'v', seed: 1, ok: true, value: 1, truth: 1, unit: 'option' })).toContain('was right')
    expect(predictLine({ variant: 'v', seed: 1, ok: false, value: 0, truth: 1, unit: 'option' })).toContain('not the keyed one')
  })
})

describe('the answers: src lesson, fresh seeds, Today\'s mapping', () => {
  test('an answer is an item on the instance, src lesson, with lessonId and the block group, no Today slot', () => {
    const p = planItem(gen, BLOCK, [], BASE, 0)
    if (!p) throw new Error('no plan')
    const item: PlayableItem = { source: 'gen', inst: p.inst }
    const w = lessonItemResponse(right(p.inst), item, CTX, new Set())
    expect(w.kind).toBe('item')
    expect(w.ref).toBe(`gen:demo/${p.inst.variant}`)
    expect(w.provenance).toBe('unseen')
    expect(w.ok).toBe(true)
    expect(w.seed).toBe(p.inst.seed)
    expect(w.data).toMatchObject({ src: 'lesson', lessonId: 't5.l2', grp: 't5.l2#7', level: p.inst.level, variant: p.inst.variant, kcs: p.inst.kcs })
    const data = w.data as Record<string, unknown>
    expect('slot' in data).toBe(false)
    expect('of' in data).toBe(false)
    expect('reason' in data).toBe(false)
    expect(typeof data.nsec).toBe('number')
    expect(validateEvent(stamp(w, 1)).ok).toBe(true)
  })

  test('an instance the learner has met is practice, not unseen', () => {
    const p = planItem(gen, BLOCK, [], BASE, 0)
    if (!p) throw new Error('no plan')
    const item: PlayableItem = { source: 'gen', inst: p.inst }
    const seen = new Set([`gen:demo/${p.inst.variant}@${p.inst.level}:${p.inst.seed}`])
    expect(lessonItemResponse(right(p.inst), item, CTX, seen).provenance).toBe('practice')
  })

  test('every answer kind writes an event the codec accepts', () => {
    for (const variant of ['bytes-per-token', 'capacity', 'which-plane']) {
      const inst = gen.make(3, 1 as Level, variant)
      const item: PlayableItem = { source: 'gen', inst }
      expect(validateEvent(stamp(lessonItemResponse(right(inst), item, CTX, new Set()), 1)).ok).toBe(true)
      expect(validateEvent(stamp(lessonItemResponse(wrong(inst), item, CTX, new Set()), 2)).ok).toBe(true)
    }
  })
})

describe('the block read back from events', () => {
  test('an empty ledger is not predicted, not served, not done', () => {
    const s = readBlock([], AT)
    expect(s).toEqual({ predict: null, served: [], passes: 0, done: false, pending: null })
  })

  test('predict, then three correct on distinct seeds, is done, and a reload (the stamped events alone) says so', () => {
    const sim: Sim = { events: [], n: 0 }
    const first = planItem(gen, BLOCK, sim.events, BASE, 0)
    if (!first) throw new Error('no plan')
    const pi = predictInstance(first.inst)
    sim.n += 1
    sim.events.push(stamp(predictResponse(pi, answer(pi, correctResponse(pi)), CTX), sim.n))
    // reloaded after the prediction: the same first instance is pending, nothing is served
    const mid = readBlock(sim.events, AT)
    expect(mid.predict).toMatchObject({ variant: first.inst.variant, seed: first.inst.seed })
    expect(mid.pending).toEqual({ variant: first.inst.variant, level: first.inst.level, seed: first.inst.seed })
    expect(mid.served).toEqual([])
    expect(mid.done).toBe(false)
    expect(makeAt(gen, mid.pending?.variant ?? '', mid.pending?.level, mid.pending?.seed ?? 0)?.inst).toEqual(first.inst)

    writeItem(sim, first.inst, right(first.inst))
    expect(readBlock(sim.events, AT).pending).toBeNull()
    expect(readBlock(sim.events, AT).passes).toBe(1)
    for (let i = 1; i < 3; i++) {
      const p = planItem(gen, BLOCK, sim.events, BASE, i)
      if (!p) throw new Error('no plan')
      writeItem(sim, p.inst, right(p.inst))
    }
    const done = readBlock(sim.events, AT)
    expect(done.passes).toBe(3)
    expect(done.done).toBe(true)
    expect(new Set(done.served.map((x) => x.seed)).size).toBe(3)
    expect(progressText(done.passes, AT.count)).toBe('3/3 · done')
    // every item the block served was on a fresh instance
    expect(sim.events.filter((e) => e.kind === 'item').map((e) => e.provenance)).toEqual(['unseen', 'unseen', 'unseen'])
  })

  test('a first instance swapped for new numbers is not pending once anything else is answered', () => {
    const sim: Sim = { events: [], n: 0 }
    const first = planItem(gen, BLOCK, sim.events, BASE, 0)
    if (!first) throw new Error('no plan')
    const pi = predictInstance(first.inst)
    sim.n += 1
    sim.events.push(stamp(predictResponse(pi, answer(pi, correctResponse(pi)), CTX), sim.n))
    expect(readBlock(sim.events, AT).pending).not.toBeNull()
    const other = planItem(gen, BLOCK, sim.events, BASE, 1)
    if (!other) throw new Error('no plan')
    writeItem(sim, other.inst, right(other.inst))
    const s = readBlock(sim.events, AT)
    expect(s.pending).toBeNull()
    expect(s.predict).not.toBeNull()
  })

  test('a miss does not count, and the same instance answered twice counts once', () => {
    const sim: Sim = { events: [], n: 0 }
    const p = planItem(gen, BLOCK, sim.events, BASE, 0)
    if (!p) throw new Error('no plan')
    writeItem(sim, p.inst, wrong(p.inst))
    expect(readBlock(sim.events, AT).passes).toBe(0)
    writeItem(sim, p.inst, right(p.inst))
    writeItem(sim, p.inst, right(p.inst))
    const s = readBlock(sim.events, AT)
    expect(s.served).toHaveLength(3)
    expect(s.passes).toBe(1)
    expect(s.done).toBe(false)
  })

  test('nothing locks: after done, more numbers are planned and answered, and it stays done', () => {
    const sim: Sim = { events: [], n: 0 }
    for (let i = 0; i < 3; i++) {
      const p = planItem(gen, BLOCK, sim.events, BASE, i)
      if (!p) throw new Error('no plan')
      writeItem(sim, p.inst, right(p.inst))
    }
    expect(readBlock(sim.events, AT).done).toBe(true)
    const more = planItem(gen, BLOCK, sim.events, BASE, 3)
    expect(more).not.toBeNull()
    if (!more) return
    writeItem(sim, more.inst, wrong(more.inst))
    const s = readBlock(sim.events, AT)
    expect(s.served).toHaveLength(4)
    expect(s.done).toBe(true)
  })

  test('another block, another lesson and Today\'s own items are not this block\'s', () => {
    const sim: Sim = { events: [], n: 0 }
    const p = planItem(gen, BLOCK, sim.events, BASE, 0)
    if (!p) throw new Error('no plan')
    const item: PlayableItem = { source: 'gen', inst: p.inst }
    const mine = lessonItemResponse(right(p.inst), item, CTX, new Set())
    const other = lessonItemResponse(right(p.inst), item, { lessonId: 't5.l2', blockIndex: 8 }, new Set())
    const elsewhere = lessonItemResponse(right(p.inst), item, { lessonId: 't5.l3', blockIndex: 7 }, new Set())
    const today: ItemResponse = { ...mine, data: { ...(mine.data as object), src: 'today', grp: 't5.l2#7' } as ItemResponse['data'] }
    sim.events.push(stamp(other, 1), stamp(elsewhere, 2), stamp(today, 3))
    expect(readBlock(sim.events, AT).served).toEqual([])
    sim.events.push(stamp(mine, 4))
    expect(readBlock(sim.events, AT).served).toHaveLength(1)
  })

  test('the read does not depend on the order events arrive in (a merge may deliver them any way)', () => {
    const sim: Sim = { events: [], n: 0 }
    for (let i = 0; i < 3; i++) {
      const p = planItem(gen, BLOCK, sim.events, BASE, i)
      if (!p) throw new Error('no plan')
      writeItem(sim, p.inst, i === 1 ? wrong(p.inst) : right(p.inst))
    }
    expect(readBlock([...sim.events].reverse(), AT)).toEqual(readBlock(sim.events, AT))
  })

  test('events the page keeps locally read like the ledger\'s own', () => {
    const p = planItem(gen, BLOCK, [], BASE, 0)
    if (!p) throw new Error('no plan')
    const item: PlayableItem = { source: 'gen', inst: p.inst }
    const w = lessonItemResponse(right(p.inst), item, CTX, new Set())
    const s = readBlock([blockEventOf(w, T(1), 'local:1')], AT)
    expect(s.passes).toBe(1)
    expect(s.served[0]).toMatchObject({ variant: p.inst.variant, seed: p.inst.seed, ok: true })
  })

  test('a count of one finishes on the first correct answer', () => {
    const sim: Sim = { events: [], n: 0 }
    const p = planItem(gen, BLOCK, [], BASE, 0)
    if (!p) throw new Error('no plan')
    writeItem(sim, p.inst, right(p.inst))
    expect(readBlock(sim.events, { ...AT, count: 1 }).done).toBe(true)
  })
})

describe('the expert skip', () => {
  const deps = (solid: string[]): PreDeps => ({
    events: async () => [],
    working: { 'placement:result': { solidKcs: solid } as never },
    today: '2026-10-05',
  })

  test('every block KC solid skips the block; one short of it does not', async () => {
    const kcs = itemBlockKcs(gen, BLOCK)
    expect(kcs.length).toBeGreaterThan(1)
    expect(await expertFor(kcs, deps(kcs))).toBe(true)
    expect(await expertFor(kcs, deps(kcs.slice(1)))).toBe(false)
  })

  test('a block with no KCs is never skipped', async () => {
    expect(await expertFor(itemBlockKcs(gen, { variants: ['nope'] }), deps([]))).toBe(false)
  })
})
