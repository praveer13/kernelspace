/**
 * The placement walk (docs/specs/wave-1.md §7.1; task B21): the solid and missed rules, the 20-item cap,
 * determinism per seed, what a blind learner (always B, always the longest option) gets, the misconceptions
 * the walk records, and the write through the real façade (`completePlacement`), including the day-7
 * confirmation on the cards it earns and what the result does to the path plan.
 */
import { afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import CurriculumPage from '../../src/pages/Curriculum'
import { useProgress } from '../../src/lib/progress'
import { KCS, kcById, THRESHOLD_KCS, RUST_ANCHOR_KC } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import { R_ANCHORS } from '../../src/data/placement/anchors'
import { gradeItem, playView, resultFor, type PlayResponse, type PlayView } from '../../src/lib/items/play'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Gen, PlayableItem } from '../../src/lib/items/types'
import type { KcId } from '../../src/lib/kc/types'
import { deriveCards } from '../../src/lib/learner/cards'
import { cachedPathPlan, PATHS, type PathGraph } from '../../src/lib/learner/paths'
import {
  BLIND_MIN_CHOICES,
  MAX_ITEMS,
  MAX_ITEMS_PER_KC,
  PROBES,
  advance,
  answerOf,
  authoredIndex,
  blindPattern,
  canSkipAnchor,
  currentLesson,
  finishWalk,
  levelOfItem,
  placementJson,
  readPlacement,
  record,
  skipAnchor,
  skippedAnswer,
  startWalk,
  verdictOf,
  walkProgress,
  type KcVerdict,
  type Step,
  type WalkAnswer,
  type WalkContent,
  type WalkOutcome,
  type WalkState,
} from '../../src/lib/learner/placement'
import { addDays } from '../../src/lib/learner/reentry'
import { makeGenPool } from '../../src/lib/learner/ticket'
import type { Confidence, LearningPath } from '../../src/lib/ledger/types'
import { splitmix32 } from '../../src/lib/rng'
import { makeProfile, startTab } from '../ledger/env'
import { CONTENT } from './ledger-gen'

/* ------------------------------ real content ------------------------------ */

let gens: Map<string, Gen>
let real: WalkContent
beforeAll(async () => {
  gens = new Map((await loadAllFamilies()).map((g) => [g.id, g]))
  real = {
    pool: makeGenPool(gens, (kc) => kcById(kc)?.gen ?? []),
    authored: authoredIndex(ALL_LESSONS, R_ANCHORS),
  }
})

const trackOf = (kc: KcId) => kcById(kc)?.track ?? 't0'
const NOW = '2026-10-05T09:00:00.000Z'

/* ------------------------------ learners ------------------------------ */

/** What a simulated learner does with one item: an answer with a confidence, or a skip. */
type Move = { response: PlayResponse; conf?: Confidence } | 'skip'
type Learner = (view: PlayView, step: Step) => Move

/** Knows every answer, and says so. */
const correctResponse = (view: PlayView): PlayResponse => {
  switch (view.kind) {
    case 'choice':
      return { kind: 'choice', picks: [...view.correct] }
    case 'numeric':
      return { kind: 'numeric', value: view.answer.truth, unit: view.answer.unit }
    case 'estimate':
      return { kind: 'estimate', value: view.answer.truth }
    case 'cr':
      return { kind: 'cr', text: '', ideas: [true, true, true] }
  }
}

/** A wrong answer of the kind a blind learner gives: a number that is never the truth, else the option at `at`. */
const blind = (view: PlayView, pick: (options: { id: string; text: string }[]) => string): PlayResponse => {
  switch (view.kind) {
    case 'choice':
      return { kind: 'choice', picks: [pick(view.options)] }
    case 'numeric':
      return { kind: 'numeric', value: 0, unit: view.answer.unit }
    case 'estimate':
      return { kind: 'estimate', value: 1 }
    case 'cr':
      return { kind: 'cr', text: '', ideas: [false, false, false] }
  }
}

/** Wrong on purpose: the first option that is not a key, or a number that is not the truth. */
const wrongResponse = (view: PlayView): PlayResponse =>
  blind(view, (o) => (view.kind === 'choice' ? (o.find((x) => !view.correct.includes(x.id)) ?? o[0]).id : o[0].id))

const expert: Learner = (v) => ({ response: correctResponse(v), conf: 'sure' })
const alwaysB: Learner = (v) => ({ response: blind(v, (o) => o[1].id) })
const longest = (o: { id: string; text: string }[]) => o.reduce((best, x) => (x.text.length > best.text.length ? x : best), o[0]).id
const alwaysLongest: Learner = (v) => ({ response: blind(v, longest) })
/** Right with probability p (a knowing answer), else a wrong pick at random: a learner who knows some of it. */
const partial =
  (p: number, seed: number): Learner =>
  (v, step) => {
    const rnd = splitmix32(seed ^ (step.ordinal * 7919))
    return rnd() < p ? expert(v, step) : { response: blind(v, (o) => o[Math.floor(rnd() * o.length)].id), conf: rnd() < 0.5 ? 'sure' : 'think' }
  }

interface Walked {
  state: WalkState
  outcome: WalkOutcome
  steps: Step[]
}

/** Drives the walk exactly as the component does: advance, show, grade, record, repeat. */
function drive(content: WalkContent, learner: Learner, seed: number, path: LearningPath = 'full-ramp', opts: { skipAnchor?: boolean } = {}): Walked {
  let state = startWalk(path, seed)
  const steps: Step[] = []
  for (let guard = 0; guard < 100; guard++) {
    const next = advance(state, content)
    state = next.state
    if (opts.skipAnchor && next.step?.kc === RUST_ANCHOR_KC) {
      const skipped = skipAnchor(state)
      if (skipped !== state) {
        state = skipped
        continue
      }
    }
    if (!next.step) break
    const { step } = next
    steps.push(step)
    const move = learner(playView(step.item, step.seed), step)
    if (move === 'skip') {
      state = record(state, step, skippedAnswer(step.item))
      continue
    }
    const gen = step.item.source === 'gen' ? gens.get(step.item.inst.family) : undefined
    const grade = gradeItem(step.item, move.response, gen)
    const result = resultFor(step.item, move.response, grade, { seed: step.seed, ms: 1000, ...(move.conf ? { conf: move.conf } : {}) })
    state = record(state, step, answerOf(step.item, result))
  }
  return { state, outcome: finishWalk(state, trackOf, NOW), steps }
}

/** What the learner was shown: the KC, the level, the seed, and the options in display order. */
const shown = (s: Step) => {
  const v = playView(s.item, s.seed)
  return [s.kc, s.level, s.seed, v.kind === 'choice' ? v.options.map((o) => o.id).join('') : v.ref]
}

const SEEDS = Array.from({ length: 250 }, (_, i) => i * 7919 + 1)

/* ------------------------------ the rules ------------------------------ */

const a = (ok: boolean, conf?: Confidence): Pick<WalkAnswer, 'ok' | 'conf'> => ({ ok, ...(conf ? { conf } : {}) })

describe('solid and missed', () => {
  const cases: [string, Pick<WalkAnswer, 'ok' | 'conf'>[], KcVerdict | null][] = [
    ['nothing asked yet', [], null],
    ['a wrong first answer is missed', [a(false)], 'missed'],
    ['a wrong answer given with confidence is missed too', [a(false, 'sure')], 'missed'],
    ['a right answer wants its confirmation', [a(true)], null],
    ['right, then right: solid', [a(true), a(true)], 'solid'],
    ['a right guess, then right: solid', [a(true, 'guess'), a(true)], 'solid'],
    ['a right guess, then wrong: missed', [a(true, 'guess'), a(false)], 'missed'],
    ['a right think, then wrong: a conflict, one more item', [a(true, 'think'), a(false)], null],
    ['an unrated right, then wrong: a conflict, one more item', [a(true), a(false)], null],
    ['conflict, tie-break right: two of three, solid', [a(true, 'sure'), a(false), a(true)], 'solid'],
    ['conflict, tie-break wrong: missed', [a(true, 'sure'), a(false), a(false)], 'missed'],
  ]
  for (const [name, answers, want] of cases) test(name, () => expect(verdictOf(answers)).toBe(want))

  test('the level of each item: independent, a harder confirmation (an easier one after a guess), then the tie-break', () => {
    expect(levelOfItem(0, [])).toBe(2)
    expect(levelOfItem(1, [a(true, 'sure')])).toBe(3)
    expect(levelOfItem(1, [a(true)])).toBe(3)
    expect(levelOfItem(1, [a(true, 'guess')])).toBe(2)
    expect(levelOfItem(2, [a(true, 'sure'), a(false)])).toBe(2)
  })

  test('the walk asks a confirmation at level 3 after a confident answer, and at level 2 after a guess', () => {
    for (const [conf, level] of [['sure', 3], ['guess', 2]] as const) {
      const w = drive(real, (v) => ({ response: correctResponse(v), conf }), 11)
      const second = w.steps.filter((s) => s.n === 1)
      expect(second.length).toBeGreaterThan(0)
      for (const s of second) expect(s.level).toBe(level)
      for (const s of w.steps.filter((x) => x.n === 0)) expect(s.level).toBe(2)
    }
  })

  test('a skipped item is a miss that names nothing', () => {
    const w = drive(real, () => 'skip', 5)
    expect(Object.values(w.state.verdicts).every((v) => v === 'missed')).toBe(true)
    expect(w.outcome.result.misconceptions).toEqual([])
    expect(w.outcome.result.solidKcs).toEqual([])
    expect(w.outcome.result.entryTrack).toBe('t0')
    expect(w.outcome.pattern).toBeNull()
    expect(w.state.asked).toBe(PROBES.length)
  })
})

/* ------------------------------ the walk on the real content ------------------------------ */

describe('the walk', () => {
  test('probes the six threshold KCs in curriculum order, then the Rust anchor', () => {
    expect([...PROBES]).toEqual([...THRESHOLD_KCS, RUST_ANCHOR_KC])
    const order = drive(real, expert, 3).steps.map((s) => s.kc)
    const firsts = [...new Set(order)]
    expect(firsts).toEqual([...PROBES])
    // each KC's items are asked together
    expect(order.join(' ')).toBe([...order].sort((x, y) => PROBES.indexOf(x) - PROBES.indexOf(y)).join(' '))
  })

  test('an expert is solid everywhere in two items a KC, and is placed at T5 with R as test-outs', () => {
    const { outcome, state } = drive(real, expert, 3)
    expect(state.asked).toBe(2 * PROBES.length)
    expect(outcome.result).toMatchObject({ v: 1, at: NOW, entryTrack: 't5', missedKcs: [], rustAnchor: 'solid', items: 14 })
    expect(outcome.result.solidKcs).toEqual([...PROBES])
    expect(outcome.pattern).toBeNull()
  })

  test('the generated KCs get generated items, the others checkpoint items, and the anchor its own items', () => {
    const { steps } = drive(real, expert, 3)
    const by = (kc: KcId) => steps.filter((s) => s.kc === kc).map((s) => s.item.source)
    for (const kc of ['t1.external-frag', 't4.bound-classification', 't5.kv-bytes-per-token']) {
      expect(by(kc)).toEqual(['gen', 'gen'])
    }
    for (const kc of ['t0.locality', 't2.address-translation', 't2.admission-scheduling']) {
      for (const s of by(kc)) expect(['quiz', 'item']).toContain(s)
    }
    for (const s of steps.filter((x) => x.kc === RUST_ANCHOR_KC)) {
      expect(s.item.source).toBe('item')
      expect(s.item.source === 'item' && s.item.item.id.startsWith('r.anchor.')).toBe(true)
    }
  })

  test('every item is on its KC, and no item is asked twice', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const { steps } = drive(real, partial(0.7, seed), seed)
      // a generated item is its instance (the same variant may be asked again, on other numbers or at another level)
      const ids = steps.map((s) => (s.item.source === 'gen' ? s.item.inst.rev : playView(s.item, s.seed).ref))
      expect(new Set(ids).size).toBe(ids.length)
      for (const s of steps) {
        const kcs = s.item.source === 'gen' ? s.item.inst.kcs : s.item.source === 'quiz' ? s.item.kcs : s.item.source === 'item' ? s.item.item.kcs : []
        expect(kcs).toContain(s.kc)
      }
    }
  })

  test('items the learner has already answered come last', () => {
    const quizRefs = new Set(real.authored('t0.locality').map((it) => playView(it, 1).ref))
    const keep = [...quizRefs].slice(-1)
    const answered = new Set([...quizRefs].filter((r) => !keep.includes(r)))
    const first = advance(startWalk('full-ramp', 9), { ...real, answered }).step
    expect(first && playView(first.item, first.seed).ref).toBe(keep[0])
  })

  test('a KC with one right answer and no item to confirm it is missed; so is a KC with no item at all', () => {
    const lone: WalkContent = { ...real, authored: (kc) => (kc === 't0.locality' ? real.authored(kc).slice(0, 1) : kc === 't2.address-translation' ? [] : real.authored(kc)) }
    const { outcome } = drive(lone, expert, 4)
    expect(outcome.result.missedKcs).toEqual(expect.arrayContaining(['t0.locality', 't2.address-translation']))
    expect(outcome.result.solidKcs).not.toContain('t2.address-translation')
    expect(outcome.result.entryTrack).toBe('t0')
  })

  test('a probe KC that gets no item has an explicit verdict, and entryTrack cannot skip past it', () => {
    const bare = 't2.address-translation'
    expect(real.pool.families(bare)).toEqual([])
    const empty: WalkContent = { ...real, authored: (kc) => (kc === bare ? [] : real.authored(kc)) }
    for (const seed of [1, 4, 9]) {
      const w = drive(empty, expert, seed)
      expect(w.state.verdicts[bare]).toBe('missed')
      expect(w.state.answers[bare]).toBeUndefined()
      // every other threshold KC is solid, so the unasked one is the only thing that can hold the entry back
      for (const kc of THRESHOLD_KCS.filter((k) => k !== bare)) expect(w.state.verdicts[kc]).toBe('solid')
      expect(w.outcome.result.missedKcs).toEqual([bare])
      expect(w.outcome.result.entryTrack).toBe(trackOf(bare))
      expect(w.outcome.result.entryTrack).not.toBe('t5')
    }
  })

  test('canSkipAnchor holds only while skipAnchor can act: optional path, anchor still a probe, no answer yet', () => {
    const fresh = startWalk('serving-first', 5)
    expect(canSkipAnchor(fresh)).toBe(true)
    expect(canSkipAnchor(startWalk('full-ramp', 5))).toBe(false)
    expect(canSkipAnchor(skipAnchor(fresh))).toBe(false)
    const asked = { ...fresh, answers: { [RUST_ANCHOR_KC]: [{ ref: 'item:x', from: 'x', ok: true, skipped: false }] } }
    expect(canSkipAnchor(asked)).toBe(false)
    expect(skipAnchor(asked)).toBe(asked)
  })

  test('the Rust anchor is optional on serving-first only: skipping it reads as skipped, and R lessons become test-outs', () => {
    const w = drive(real, expert, 3, 'serving-first', { skipAnchor: true })
    expect(w.outcome.result.rustAnchor).toBe('skipped')
    expect(w.state.asked).toBe(2 * THRESHOLD_KCS.length)
    expect(w.outcome.result.solidKcs).toEqual([...THRESHOLD_KCS])
    // not optional elsewhere: skipAnchor leaves the state alone
    const full = startWalk('full-ramp', 3)
    expect(skipAnchor(full)).toBe(full)
    const rust = drive(real, expert, 3, 'rust-systems', { skipAnchor: true })
    expect(rust.outcome.result.rustAnchor).toBe('solid')
  })

  test('progress counts topics, items and nominal minutes within the cap', () => {
    const start = walkProgress(startWalk('full-ramp', 1))
    expect(start).toMatchObject({ topic: 1, topics: 7, asked: 0, expected: 14 })
    expect(start.minutes).toBeGreaterThan(0)
    expect(start.minutes).toBeLessThanOrEqual(15)
    const done = drive(real, expert, 1).state
    expect(walkProgress(done)).toMatchObject({ topic: 7, asked: 14, expected: 0, minutes: 0 })
  })
})

/* ------------------------------ at most 20 items, deterministic ------------------------------ */

describe('the item cap', () => {
  test('every kind of learner, every seed, every path: at most 20 items', () => {
    const learners: Learner[] = [expert, alwaysB, alwaysLongest, () => 'skip']
    for (const seed of SEEDS) {
      for (const path of PATHS) {
        const l = [...learners, partial(0.3, seed), partial(0.6, seed), partial(0.85, seed)]
        for (const learner of l) {
          const w = drive(real, learner, seed, path)
          expect(w.state.asked).toBeLessThanOrEqual(MAX_ITEMS)
          expect(w.outcome.result.items).toBe(w.state.asked)
          expect(w.state.at).toBe(w.state.probes.length)
        }
      }
    }
  })

  test('the worst case, confident right then wrong then right on every KC with items to spare, stops at exactly 20', () => {
    const q = (n: number): QuizQuestion => ({ q: `Item ${n}?`, options: ['key', 'a', 'b', 'c'], correct: [0], why: ['k', 'a', 'b', 'c'] })
    const rich: WalkContent = {
      pool: { families: () => [], make: () => null },
      authored: (kc) => Array.from({ length: 6 }, (_, i) => ({ source: 'quiz', lessonId: `x.${kc}.${i}`, qi: 0, q: q(i), kcs: [kc] }) as PlayableItem),
    }
    // right (sure), wrong, right: each KC would take 3 items; the cap leaves the last KC two
    const learner: Learner = (v, step) => (step.n === 1 ? { response: { kind: 'choice', picks: [v.options.find((o) => !v.correct.includes(o.id))?.id ?? ''] }, conf: 'sure' } : { response: correctResponse(v), conf: 'sure' })
    const w = drive(rich, learner, 21)
    expect(w.state.asked).toBe(MAX_ITEMS)
    const per = PROBES.map((kc) => w.state.answers[kc]?.length ?? 0)
    expect(per.slice(0, 6)).toEqual([3, 3, 3, 3, 3, 3])
    expect(per[6]).toBe(2)
    expect(Math.max(...per)).toBeLessThanOrEqual(MAX_ITEMS_PER_KC)
    for (const kc of PROBES.slice(0, 6)) expect(w.state.verdicts[kc]).toBe('solid')
    expect(w.state.verdicts[RUST_ANCHOR_KC]).toBe('missed')
  })

  test('the same seed and answers give the same walk, item for item; another seed shows another order', () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const one = drive(real, partial(0.6, seed), seed)
      const two = drive(real, partial(0.6, seed), seed)
      expect(two.state).toEqual(one.state)
      expect(two.outcome).toEqual(one.outcome)
      expect(two.steps.map(shown)).toEqual(one.steps.map(shown))
    }
    const orders = new Set(
      SEEDS.slice(0, 30).map((seed) => {
        const s = drive(real, expert, seed).steps.find((x) => x.item.source === 'quiz' || x.item.source === 'item')
        const v = s && playView(s.item, s.seed)
        return v?.kind === 'choice' ? v.options.map((o) => o.id).join('') : ''
      }),
    )
    expect(orders.size).toBeGreaterThan(5)
  })
})

/* ------------------------------ a blind learner ------------------------------ */

describe('an always-B or always-longest learner', () => {
  const learners: [string, Learner][] = [
    ['always B', alwaysB],
    ['always the longest option', alwaysLongest],
  ]
  for (const [name, learner] of learners) {
    test(`${name} places no further than T0, on every seed and every path`, () => {
      let flagged = 0
      for (const seed of SEEDS) {
        for (const path of PATHS) {
          const { outcome } = drive(real, learner, seed, path)
          expect(outcome.result.entryTrack).toBe('t0')
          if (outcome.pattern) {
            flagged += 1
            expect(outcome.result.solidKcs).toEqual([])
          }
        }
      }
      // the pattern guard is what holds the line on the seeds where the shuffle lets the blind pick land twice
      console.log(`${name}: ${flagged} of ${SEEDS.length * PATHS.length} walks read as a blind pattern`)
    })
  }

  test('a walk that kept hitting by luck is still read: every pick in one position, or every pick the longest', () => {
    const picks = (state: Partial<WalkAnswer>[]): WalkState => ({ ...startWalk('full-ramp', 1), answers: { 't0.locality': state.map((s, i) => ({ ref: `r${i}`, from: 'x', ok: true, skipped: false, ...s })) } })
    expect(blindPattern(picks([{ pos: 1 }, { pos: 1 }, { pos: 1 }, { pos: 1 }]))).toBe('position')
    expect(blindPattern(picks([{ pos: 1 }, { pos: 1 }, { pos: 1 }]))).toBeNull()
    expect(blindPattern(picks([{ pos: 0, longest: true }, { pos: 2, longest: true }, { pos: 1, longest: true }, { pos: 3, longest: true }]))).toBe('length')
    expect(blindPattern(picks([{ pos: 0, longest: true }, { pos: 2, longest: true }, { pos: 1, longest: false }, { pos: 3, longest: true }]))).toBeNull()
    // a skipped item and a numeric answer are not picks
    expect(blindPattern(picks([{ pos: 1 }, { pos: 1 }, {}, { pos: 1 }, { pos: 1 }, { pos: 1 }]))).toBe('position')
    expect(BLIND_MIN_CHOICES).toBe(4)
  })

  test('a flagged walk reports T0, nothing solid, and every judged KC as missed (their lessons stay in the plan)', () => {
    const state: WalkState = {
      ...startWalk('full-ramp', 1),
      at: PROBES.length,
      asked: 8,
      verdicts: { 't0.locality': 'solid', 't1.external-frag': 'solid', [RUST_ANCHOR_KC]: 'solid' },
      answers: { 't0.locality': [1, 1, 1, 1].map((pos, i) => ({ ref: `r${i}`, from: 'x', ok: true, skipped: false, pos })) },
    }
    const { result, pattern } = finishWalk(state, trackOf, NOW)
    expect(pattern).toBe('position')
    expect(result).toMatchObject({ entryTrack: 't0', solidKcs: [], missedKcs: ['t0.locality', 't1.external-frag', RUST_ANCHOR_KC], rustAnchor: 'missed' })
  })

  test('an honest learner who knows some of it is not flagged', () => {
    let flagged = 0
    for (const seed of SEEDS.slice(0, 100)) if (drive(real, partial(0.8, seed), seed).outcome.pattern) flagged += 1
    expect(flagged).toBeLessThanOrEqual(1)
  })
})

/* ------------------------------ entry track ------------------------------ */

describe('the entry track', () => {
  /** An expert who is wrong on exactly the KCs in `miss`. */
  const missing =
    (miss: readonly KcId[]): Learner =>
    (v, step) =>
      miss.includes(step.kc) ? { response: wrongResponse(v), conf: 'sure' } : expert(v, step)

  test('the track of the first missed core KC in curriculum order', () => {
    const cases: [KcId[], string][] = [
      [['t0.locality'], 't0'],
      [['t1.external-frag'], 't1'],
      [['t2.address-translation'], 't2'],
      [['t2.admission-scheduling'], 't2'],
      [['t4.bound-classification'], 't4'],
      [['t5.kv-bytes-per-token'], 't5'],
      [['t4.bound-classification', 't2.admission-scheduling', 't5.kv-bytes-per-token'], 't2'],
    ]
    for (const [miss, want] of cases) {
      const { outcome } = drive(real, missing(miss), 8)
      expect(outcome.result.entryTrack).toBe(want)
      expect(outcome.result.missedKcs).toEqual(PROBES.filter((kc) => miss.includes(kc)))
    }
  })

  test('only the anchor missed: every core KC is solid, so T5, and the anchor brings R back', () => {
    const { outcome } = drive(real, missing([RUST_ANCHOR_KC]), 8)
    expect(outcome.result).toMatchObject({ entryTrack: 't5', rustAnchor: 'missed', missedKcs: [RUST_ANCHOR_KC] })
  })
})

/* ------------------------------ misconceptions ------------------------------ */

describe('misconceptions', () => {
  const lure: QuizQuestion = {
    q: 'Which scheduler does Linux use for ordinary tasks?',
    options: ['EEVDF', 'CFS, still', 'O(1)', 'FIFO only'],
    correct: [0],
    why: ['Right: EEVDF replaced CFS in Linux 6.6.', 'CFS was replaced in 6.6.', 'The O(1) scheduler is long gone.', 'FIFO is one class, not the default.'],
    miss: ['', 't2.cfs-current', 't2.o1-current', ''],
  }
  const items = (kc: KcId, n: number): PlayableItem[] =>
    Array.from({ length: n }, (_, i) => ({ source: 'quiz', lessonId: `x.${kc}.${i}`, qi: 0, q: { ...lure, q: `${lure.q} (${i})` }, kcs: [kc] }))
  const fixture: WalkContent = { pool: { families: () => [], make: () => null }, authored: (kc) => items(kc, 4) }
  const pickMiss = (id: string): Learner => (v) => ({ response: { kind: 'choice', picks: [v.kind === 'choice' ? (v.options.find((o) => o.miss === id)?.id ?? v.options[0].id) : ''] }, conf: 'sure' })

  test('a lure that carries a misconception id is recorded, once, in the order met, with its sentence', () => {
    const lureOrder: Learner = (v, step) => (v.kind === 'choice' ? pickMiss(step.kc === 't0.locality' ? 't2.o1-current' : 't2.cfs-current')(v, step) : expert(v, step))
    const { outcome } = drive(fixture, lureOrder, 6)
    expect(outcome.result.misconceptions).toEqual(['t2.o1-current', 't2.cfs-current'])
    expect(outcome.slips.map((s) => s.id)).toEqual(['t2.o1-current', 't2.cfs-current'])
    expect(outcome.slips[1].message).toBe('CFS was replaced in 6.6.')
    expect(outcome.result.missedKcs).toEqual([...PROBES])
  })

  test('a right answer names nothing, and a wrong pick on an option with no id names nothing', () => {
    expect(drive(fixture, expert, 6).outcome.result.misconceptions).toEqual([])
    const noId = drive(fixture, (v) => ({ response: { kind: 'choice', picks: [v.kind === 'choice' ? (v.options.find((o) => o.text === 'FIFO only')?.id ?? '') : ''] } }), 6)
    expect(noId.outcome.result.misconceptions).toEqual([])
  })

  test('a wrong number on a generated item names its slip (a ratio diagnosis)', () => {
    // a thousand times the truth is the kilo slip the shared rules know
    const kilo: Learner = (v, step) =>
      v.kind === 'numeric' ? { response: { kind: 'numeric', value: v.answer.truth * 1000, unit: v.answer.unit }, conf: 'sure' } : expert(v, step)
    let named = 0
    for (const seed of SEEDS.slice(0, 40)) {
      const { outcome } = drive(real, kilo, seed)
      if (outcome.result.misconceptions.length > 0) named += 1
      for (const id of outcome.result.misconceptions) expect(id).toMatch(/^[a-z0-9]+\.[a-z0-9-]+$/)
    }
    expect(named).toBeGreaterThan(0)
  })
})

/* ------------------------------ the result, stored ------------------------------ */

describe('the stored result', () => {
  test('it survives JSON, and a damaged record reads as no placement', () => {
    const { outcome } = drive(real, partial(0.7, 5), 5)
    const stored = JSON.parse(JSON.stringify(placementJson(outcome.result)))
    expect(readPlacement(stored)).toEqual(outcome.result)
    expect(readPlacement(undefined)).toBeNull()
    expect(readPlacement(null)).toBeNull()
    expect(readPlacement([])).toBeNull()
    expect(readPlacement({ ...stored, v: 2 })).toBeNull()
    expect(readPlacement({ ...stored, entryTrack: 't9' })).toBeNull()
    expect(readPlacement({ ...stored, solidKcs: [1] })).toBeNull()
    expect(readPlacement({ ...stored, rustAnchor: 'maybe' })).toBeNull()
    expect(readPlacement({ ...stored, items: '14' })).toBeNull()
  })

  test('completePlacement stores it, and each solid KC earns a card whose confirmation is due 7 days after creation', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    const { outcome } = drive(real, expert, 3)
    getState().completePlacement(placementJson(outcome.result))
    expect(getState().completions.placement).toBeDefined()
    expect(readPlacement(getState().working['placement:result'])).toEqual(outcome.result)
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'complete' && e.ref === 'placement')).toHaveLength(1)
    // the walk wrote no item events: the result is the record
    expect(events.filter((e) => e.kind === 'item')).toHaveLength(0)

    const day = events[0].day
    const placement = readPlacement(getState().working['placement:result'])
    const solid = new Set(outcome.result.solidKcs)
    // the creation cap (1.2 a day, burst 3) lets some wait; they are created later, still with their own +7
    for (const later of [day, addDays(day, 5), addDays(day, 14)]) {
      const set = deriveCards(events, CONTENT, later, null, { placement })
      const made = Object.values(set.cards)
      expect(made.length).toBeGreaterThanOrEqual(3)
      for (const c of made) {
        expect(solid.has(c.kc)).toBe(true)
        expect(c.origin).toBe('placement')
        expect(c.confirmDay).toBe(addDays(c.createdDay, 7))
      }
      expect(made.length + set.pending.length).toBe(solid.size)
    }
    const fortnight = deriveCards(events, CONTENT, addDays(day, 14), null, { placement })
    expect(Object.keys(fortnight.cards).sort()).toEqual([...solid].sort())
  })

  test('a miss earns no card, and a second walk replaces the first result', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().completePlacement(placementJson(drive(real, () => 'skip', 2).outcome.result))
    getState().completePlacement(placementJson(drive(real, expert, 2).outcome.result))
    expect(readPlacement(getState().working['placement:result'])?.entryTrack).toBe('t5')
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    const placement = readPlacement(getState().working['placement:result'])
    const set = deriveCards(events, CONTENT, events[0].day, null, { placement })
    for (const c of Object.values(set.cards)) expect(c.origin).toBe('placement')
  })
})

/* ------------------------------ what the result does to the path ------------------------------ */

describe('the result in the path plan', () => {
  const GRAPH: PathGraph = { kcs: KCS, lessons: ALL_LESSONS, labs: [] }
  const none = () => undefined

  test('"current" is the first lesson of the plan that is neither done nor read', () => {
    const plan = cachedPathPlan('full-ramp', GRAPH)
    expect(currentLesson(plan, none)).toBe(plan.lessons[0])
    const status = (id: string) => (id === plan.lessons[0] ? 'done' : id === plan.lessons[1] ? 'read' : id === plan.lessons[2] ? 'reading' : undefined)
    expect(currentLesson(plan, status)).toBe(plan.lessons[2])
    expect(currentLesson(plan, () => 'done')).toBeNull()
    expect(currentLesson(plan, () => 'read')).toBeNull()
  })

  test('a placed learner starts at the entry track, and is never sent to R.L1 unless the anchor was missed', () => {
    const missing = (miss: readonly KcId[]): Learner => (v, step) => (miss.includes(step.kc) ? { response: wrongResponse(v), conf: 'sure' } : expert(v, step))
    for (const path of PATHS) {
      for (const miss of [[], ['t1.external-frag'], ['t2.address-translation'], ['t4.bound-classification', RUST_ANCHOR_KC], [RUST_ANCHOR_KC]]) {
        const { outcome } = drive(real, missing(miss), 12, path)
        const plan = cachedPathPlan(path, GRAPH, outcome.result)
        const first = currentLesson(plan, none)
        if (outcome.result.rustAnchor !== 'missed') {
          expect(plan.lessons).not.toContain('r.l1')
          expect(first).not.toBe('r.l1')
          if (path !== 'serving-first') expect(plan.testOut).toContain('r.l1')
          if (first) expect(trackOf0(first)).not.toBe('r')
        }
      }
    }
  })

  test('a blind learner is placed at the start of the plan with their judged KCs kept', () => {
    const { outcome } = drive(real, alwaysB, 3)
    const plan = cachedPathPlan('full-ramp', GRAPH, outcome.result)
    expect(outcome.result.entryTrack).toBe('t0')
    expect(plan.lessons).toContain('t0.l1')
  })
})

const trackOf0 = (lessonId: string) => lessonId.split('.')[0]

/* ------------------------------ the Curriculum page ------------------------------ */

describe('the Curriculum page', () => {
  const render = (url = '/curriculum') => renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(CurriculumPage)))
  // A server render reads the store's *initial* state (zustand's getServerSnapshot), which setState never touches:
  // so the test sets the learner's progress on that object, and puts it back after each test.
  const initial = useProgress.getInitialState()
  const original = { lessons: initial.lessons, working: initial.working }
  const learner = (over: { lessons?: unknown; working?: unknown }) => Object.assign(initial, over)
  afterEach(() => Object.assign(initial, original))
  const GRAPH: PathGraph = { kcs: KCS, lessons: ALL_LESSONS, labs: [] }
  /** The opening tag of the row marked current. */
  const currentRow = (html: string) => {
    const at = html.indexOf('aria-current="true"')
    return html.slice(html.lastIndexOf('<a ', at), html.indexOf('>', at))
  }

  test('the 8-item modal is gone: the page offers the walk, with its size', () => {
    const html = render()
    expect(html).not.toContain('placement check')
    expect(html).toContain('take the placement walk')
    expect(html).toContain('up to 20 items, about 15 min')
    // closed until asked for
    expect(html).not.toContain('id="placement-walk"')
  })

  test('the legend names the read state, and a fresh learner is told which lesson the plan starts with', () => {
    const html = render()
    expect(html).toContain('read, not passed')
    expect(html).toContain(`Start at ${cachedPathPlan('full-ramp', GRAPH).lessons[0].toUpperCase()}.`)
    expect(html).not.toContain('aria-current="true"')
  })

  test('"current" is the plan\'s first lesson that is neither done nor read, and a read lesson says so', () => {
    const plan = cachedPathPlan('full-ramp', GRAPH)
    const [first, second, third] = plan.lessons
    const entry = (id: string, status: string) => [id, { status }] as const
    // the first lesson is read and the second done, so the third is current, in the same (open) track as the read one
    learner({ lessons: Object.fromEntries([entry(first, 'read'), entry(second, 'done')]) })
    const html = render()
    // the open track layer holds the current lesson's row, and only one row is current
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(currentRow(html)).toContain(`href="/lesson/${third}"`)
    expect(trackOf0(first)).toBe(trackOf0(third))
    expect(html).toContain('1 read')
    expect(html).toContain('read, not passed: its check is still open')
    // percentages count done lessons only (O4)
    expect(html).toContain('>1<')
  })

  test('a placement is shown on the page, and an anchor found solid turns R into test-outs', () => {
    const { outcome } = drive(real, expert, 3)
    learner({ working: { ...original.working, 'placement:result': placementJson(outcome.result) } })
    const plan = cachedPathPlan('full-ramp', GRAPH, outcome.result)
    const html = render()
    expect(plan.lessons[0]).toBe('t5.l1')
    expect(plan.testOut).toContain('r.l1')
    expect(html).toContain('Your placement started you at T5')
    expect(html).toContain('7 solid')
    expect(html).toContain('retake the placement walk')
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(currentRow(html)).toContain('href="/lesson/t5.l1"')
  })
})
