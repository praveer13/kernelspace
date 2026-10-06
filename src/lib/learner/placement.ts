/**
 * The placement walk (docs/specs/wave-1.md §7.1; PLAN-100X K3): which KCs a learner already has, found in
 * at most 20 items. It replaces the 8-item modal, whose key was B in 7 of 8 questions. Pure and
 * deterministic per seed (verify-determinism lints this file): the clock is a parameter, randomness is the
 * seed, and generated items come through an injected `TicketPool`, so the generator families (which load
 * lazily) and the ledger stay outside this module.
 *
 * The walk probes `THRESHOLD_KCS` in curriculum order, then the Rust anchor (optional and last on
 * `serving-first`). Per KC:
 *   - one independent item (level 2);
 *   - a right answer gets a confirmation: level 3 (a changed surface) after a confident answer, level 2
 *     (a second look, not a harder one) after a *guess*;
 *   - two right is **solid**; a wrong answer is **missed**, and so is a right guess followed by a wrong
 *     confirmation (a guess is weak evidence);
 *   - a confident right followed by a wrong confirmation is a conflict: one tie-break item (level 2)
 *     decides it, two right out of three being solid. That is the only path to a third item.
 *   - at most 3 items per KC, and at most 20 in all: a KC's extra item is asked only while every KC still
 *     to come keeps its first. With two items per KC the walk is 14 items long.
 * An item the learner skips ("not sure") is a miss that names no misconception.
 *
 * Items are generated where a family covers the KC (frag, roofline, kv); otherwise checkpoint and spiral
 * items tagged with the KC that the learner has not yet answered. The anchor uses `item:r.anchor.*`.
 *
 * **Guessing.** A walk of mostly multiple-choice items is exposed to a blind strategy (always B, always the
 * longest option). The options are shuffled per seed and the generated KCs ask for numbers, so a blind
 * learner rarely reaches two right on a KC, but "rarely" is not "never". When every multiple-choice pick of
 * the walk (at least `BLIND_MIN_CHOICES` of them) sits in one display position, or every one is a longest
 * option, the picks say nothing about what the learner knows: the result is the start of the ramp (T0, no
 * solid KC), and `finishWalk` reports the pattern so the page can say so. Nothing locks (W8): every lesson
 * still has its test-out.
 *
 * The walk records no `item` events: its result is `complete placement` plus the working record
 * `placement:result`, and the solid KCs earn cards with a day-7 `confirmDay` from that (§6.2). Items
 * written one by one would also pay item minutes on top of the flat placement price (§8.4).
 */

import type { TrackId } from '@/data/lessons/types'
import { RUST_ANCHOR_KC, THRESHOLD_KCS } from '@/data/kc/ids'
import { seedFor } from '@/lib/items/core'
import { kcsFor, playView, refFor, type ItemResult } from '@/lib/items/play'
import type { AuthoredItem, Level, PlayableItem } from '@/lib/items/types'
import type { KcId } from '@/lib/kc/types'
import type { Confidence, IsoInstant, Json, JsonObject, LearningPath } from '@/lib/ledger/types'
import { hash32 } from '@/lib/rng'
import type { TicketLesson, TicketPool } from './ticket'
import type { PathPlan, PlacementResult } from './types'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** The walk never asks more than this (spec §7.1). */
export const MAX_ITEMS = 20
/** Items on one KC, at most. */
export const MAX_ITEMS_PER_KC = 3
/** Multiple-choice picks needed before a one-position or all-longest pattern is read as blind. */
export const BLIND_MIN_CHOICES = 4
/** The walk's nominal time per item: 20 items are "about 15 minutes". */
export const SECONDS_PER_ITEM = 45
/** Instances tried on fresh seeds before a family is given up on (a variant already asked is skipped). */
const GEN_TRIES = 12

/** The probes in order: the six threshold KCs, then the Rust anchor. */
export const PROBES: readonly KcId[] = [...THRESHOLD_KCS, RUST_ANCHOR_KC]

/** On `serving-first` the anchor is optional (R arrives as reading items only there). */
export const anchorOptional = (path: LearningPath): boolean => path === 'serving-first'

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type KcVerdict = 'solid' | 'missed'

/** What the walk keeps of one answer. */
export interface WalkAnswer {
  /** The item's ledger ref (`gen:<family>/<variant>`, `quiz:<lesson>#<qi>`, `item:<id>`). */
  ref: string
  /** Where it came from (a lesson id, or the authored item's id): a confirmation prefers a different one. */
  from: string
  ok: boolean
  /** "Not sure": counted as a miss, and not as a pick. */
  skipped: boolean
  conf?: Confidence
  /** Display position of the picked option (0-based). Single-pick multiple-choice items only. */
  pos?: number
  /** The pick was a longest option (ties count). Same items as `pos`. */
  longest?: boolean
  /** The misconception a wrong answer named: a lure's id, or a ratio diagnosis. */
  miss?: { id: string; message: string }
}

/** JSON-safe, so a test (or a future resume) can store and replay it. */
export interface WalkState {
  v: 1
  seed: number
  path: LearningPath
  probes: KcId[]
  /** Index into `probes` of the KC being asked; `probes.length` when the walk is over. */
  at: number
  answers: Record<KcId, WalkAnswer[]>
  verdicts: Record<KcId, KcVerdict>
  /** Items asked so far. */
  asked: number
}

export function startWalk(path: LearningPath, seed: number): WalkState {
  return { v: 1, seed: seed >>> 0, path, probes: [...PROBES], at: 0, answers: {}, verdicts: {}, asked: 0 }
}

/** Whether `skipAnchor` can still act: the anchor is optional on this path, still a probe, and not yet answered. */
export function canSkipAnchor(state: WalkState): boolean {
  return anchorOptional(state.path) && state.probes.includes(RUST_ANCHOR_KC) && !state.answers[RUST_ANCHOR_KC]?.length
}

/**
 * Drops the Rust anchor (`serving-first` only: elsewhere the anchor decides whether R is lessons or
 * test-outs, so it is not optional). Returns the state unchanged when the anchor is not optional or
 * already asked (`canSkipAnchor`).
 */
export function skipAnchor(state: WalkState): WalkState {
  if (!canSkipAnchor(state)) return state
  const probes = state.probes.filter((kc) => kc !== RUST_ANCHOR_KC)
  return { ...state, probes, at: Math.min(state.at, probes.length) }
}

/* ------------------------------------------------------------------ */
/* The rules                                                           */
/* ------------------------------------------------------------------ */

/** The KC's verdict from its answers so far, or null while the walk must ask more. */
export function verdictOf(answers: readonly Pick<WalkAnswer, 'ok' | 'conf'>[]): KcVerdict | null {
  const [a, b, c] = answers
  if (!a) return null
  if (!a.ok) return 'missed'
  if (!b) return null
  if (b.ok) return 'solid'
  // right, then wrong: a guess was luck; a confident answer is a conflict, and the third item breaks the tie
  if (a.conf === 'guess') return 'missed'
  if (!c) return null
  return c.ok ? 'solid' : 'missed'
}

/** The level of a KC's `n`-th item (0-based): independent, then a confirmation, then the tie-break. */
export function levelOfItem(n: number, answers: readonly Pick<WalkAnswer, 'conf'>[]): Level {
  if (n === 1) return answers[0]?.conf === 'guess' ? 2 : 3
  return 2
}

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

export interface WalkContent {
  /** Generator families by KC and one instance on a seed (`makeGenPool`). */
  pool: TicketPool
  /** Checkpoint, spiral and anchor items tagged with the KC, in authored order (`authoredIndex`). */
  authored(kc: KcId): readonly PlayableItem[]
  /** Refs the learner has already answered (`quiz:` and `item:` events): such items are asked last. */
  answered?: ReadonlySet<string>
}

/** Every authored item by KC: checkpoint questions (tagged, else the lesson's KCs), spiral items, and extras such as the anchors. */
export function authoredIndex(lessons: readonly TicketLesson[], extra: readonly AuthoredItem[] = []): (kc: KcId) => PlayableItem[] {
  const by = new Map<KcId, PlayableItem[]>()
  const put = (kcs: readonly KcId[], item: PlayableItem) => {
    for (const kc of new Set(kcs)) by.set(kc, [...(by.get(kc) ?? []), item])
  }
  for (const lesson of lessons) {
    let qi = 0
    for (const block of lesson.blocks) {
      if (block.type !== 'quiz') continue
      for (const q of block.questions) {
        const kcs = q.kcs && q.kcs.length > 0 ? [...q.kcs] : [...(lesson.kcs ?? [])]
        put(kcs, { source: 'quiz', lessonId: lesson.id, qi: qi++, q, kcs })
      }
    }
    for (const item of lesson.ticket?.spiral ?? []) put(item.kcs, { source: 'item', item })
  }
  for (const item of extra) put(item.kcs, { source: 'item', item })
  return (kc) => by.get(kc) ?? []
}

/** Where an item comes from, for "a changed surface": its lesson, or its own id. */
function fromOf(item: PlayableItem): string {
  switch (item.source) {
    case 'gen':
      return item.inst.family
    case 'quiz':
    case 'cr':
      return item.lessonId
    case 'item':
      return item.item.id
  }
}

/** Lexicographic order over small number tuples. */
const byKey =
  <T>(key: (x: T) => number[]) =>
  (a: T, b: T): number => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return 0
  }

/* ------------------------------------------------------------------ */
/* Stepping                                                            */
/* ------------------------------------------------------------------ */

/** The item to show now. */
export interface Step {
  kc: KcId
  /** 0-based index among this KC's items. */
  n: number
  level: Level
  item: PlayableItem
  /** Orders the options (pass it to the item player and to `answerOf`). */
  seed: number
  /** 1-based position in the walk. */
  ordinal: number
}

const usedRefs = (s: WalkState): Set<string> => new Set(Object.values(s.answers).flatMap((as) => as.map((a) => a.ref)))

function genItem(s: WalkState, kc: KcId, level: Level, content: WalkContent, used: ReadonlySet<string>): PlayableItem | null {
  const families = content.pool.families(kc)
  if (families.length === 0) return null
  let last: PlayableItem | null = null
  for (let t = 0; t < GEN_TRIES; t++) {
    const seed = seedFor(s.seed, 100 + s.asked * GEN_TRIES + t)
    const item = content.pool.make(families[seed % families.length], kc, level, seed)
    if (!item) continue
    last = item
    // a second look at a KC is a different variant when the family has one
    if (!used.has(refFor(item))) return item
  }
  return last
}

function authoredItem(s: WalkState, kc: KcId, n: number, level: Level, content: WalkContent, used: ReadonlySet<string>): PlayableItem | null {
  const answers = s.answers[kc] ?? []
  const seen = new Set(answers.map((a) => a.from))
  const answered = content.answered ?? new Set<string>()
  const cands = content.authored(kc).filter((it) => !used.has(refFor(it)))
  cands.sort(
    byKey((it) => [
      answered.has(refFor(it)) ? 1 : 0,
      // an independent item tests this KC alone; a confirmation changes the surface (another lesson)
      level === 3 ? (seen.has(fromOf(it)) ? 1 : 0) : kcsFor(it).length === 1 ? 0 : 1,
      hash32(`${s.seed}:${kc}:${n}:${refFor(it)}`),
    ]),
  )
  return cands[0] ?? null
}

function stepFor(s: WalkState, kc: KcId, n: number, content: WalkContent): Step | null {
  const level = levelOfItem(n, s.answers[kc] ?? [])
  const used = usedRefs(s)
  const item = genItem(s, kc, level, content, used) ?? authoredItem(s, kc, n, level, content, used)
  return item ? { kc, n, level, item, seed: seedFor(s.seed, s.asked), ordinal: s.asked + 1 } : null
}

/**
 * Settles every KC whose answers already decide it, and returns the next item to ask, or `step: null` when
 * the walk is over. A KC with nothing left to ask is judged on what it has: a KC with one right answer and
 * no confirmation item is missed (the learner has not shown it twice), and so is a KC with no item at all
 * (nothing was shown, so `entryTrack` cannot skip past it). Pure: the same state and content give the same step.
 */
export function advance(state: WalkState, content: WalkContent): { state: WalkState; step: Step | null } {
  let s = state
  while (s.at < s.probes.length) {
    const kc = s.probes[s.at]
    const answers = s.answers[kc] ?? []
    let verdict = verdictOf(answers)
    if (verdict === null) {
      // keep one item in hand for every KC still to come, so the walk never passes MAX_ITEMS
      const room = answers.length < MAX_ITEMS_PER_KC && s.asked + 1 + (s.probes.length - s.at - 1) <= MAX_ITEMS
      const step = room ? stepFor(s, kc, answers.length, content) : null
      if (step) return { state: s, step }
      verdict = 'missed'
    }
    s = { ...s, at: s.at + 1, verdicts: { ...s.verdicts, [kc]: verdict } }
  }
  return { state: s, step: null }
}

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

function appendAnswer(state: WalkState, kc: KcId, answer: WalkAnswer): WalkState {
  return { ...state, asked: state.asked + 1, answers: { ...state.answers, [kc]: [...(state.answers[kc] ?? []), answer] } }
}

/** What the walk keeps of a graded item: the verdict, the confidence, where the pick sat, and the slip it named. */
export function answerOf(item: PlayableItem, result: Pick<ItemResult, 'ok' | 'conf' | 'seed' | 'response' | 'grade'>): WalkAnswer {
  const view = playView(item, result.seed)
  const answer: WalkAnswer = { ref: view.ref, from: fromOf(item), ok: result.ok, skipped: false }
  if (result.conf) answer.conf = result.conf
  const r = result.response
  if (view.kind === 'choice' && r.kind === 'choice' && r.picks.length === 1) {
    const pos = view.options.findIndex((o) => o.id === r.picks[0])
    if (pos >= 0) {
      answer.pos = pos
      const len = view.options[pos].text.length
      answer.longest = view.options.every((o) => o.text.length <= len)
    }
  }
  const d = result.grade.diagnosis
  if (!result.ok && d) answer.miss = { id: d.id, message: d.message }
  return answer
}

/** "Not sure": a miss that names no misconception and no pick. */
export function skippedAnswer(item: PlayableItem): WalkAnswer {
  return { ref: refFor(item), from: fromOf(item), ok: false, skipped: true }
}

/** Records the answer to `step` (the walk's current item). */
export function record(state: WalkState, step: Pick<Step, 'kc'>, answer: WalkAnswer): WalkState {
  return appendAnswer(state, step.kc, answer)
}

/* ------------------------------------------------------------------ */
/* The result                                                          */
/* ------------------------------------------------------------------ */

export type BlindPattern = 'position' | 'length'

/** A blind strategy in the multiple-choice picks of the walk, or null. Skipped items are not picks. */
export function blindPattern(state: WalkState): BlindPattern | null {
  const picks = Object.values(state.answers)
    .flat()
    .filter((a) => a.pos !== undefined)
  if (picks.length < BLIND_MIN_CHOICES) return null
  if (picks.every((a) => a.pos === picks[0].pos)) return 'position'
  if (picks.every((a) => a.longest === true)) return 'length'
  return null
}

export interface WalkOutcome {
  result: PlacementResult
  /** Set when the picks followed a blind pattern: `result` is then the start of the ramp, not a reading. */
  pattern: BlindPattern | null
  /** Each misconception once, in the order the walk met it, with the sentence the lure carries. */
  slips: { id: string; message: string }[]
}

/**
 * The result of a finished walk (`advance` returned no step). `entryTrack` is the track of the first missed
 * core KC in curriculum order, and T5 when every core KC is solid. A blind pattern makes it T0 with nothing
 * solid: what the learner picked by position says nothing about what they know, so each KC the walk judged
 * is missed (which also keeps that KC's lessons in the plan).
 */
export function finishWalk(state: WalkState, trackOf: (kc: KcId) => TrackId, now: IsoInstant): WalkOutcome {
  const pattern = blindPattern(state)
  const verdict = (kc: KcId): KcVerdict | undefined => (pattern && state.verdicts[kc] ? 'missed' : state.verdicts[kc])
  const solidKcs = state.probes.filter((kc) => verdict(kc) === 'solid')
  const missedKcs = state.probes.filter((kc) => verdict(kc) === 'missed')

  const firstMissed = THRESHOLD_KCS.find((kc) => verdict(kc) === 'missed')
  const entryTrack: TrackId = pattern ? 't0' : firstMissed ? trackOf(firstMissed) : 't5'
  const anchor = verdict(RUST_ANCHOR_KC)

  const slips = new Map<string, string>()
  for (const kc of state.probes) for (const a of state.answers[kc] ?? []) if (a.miss && !slips.has(a.miss.id)) slips.set(a.miss.id, a.miss.message)

  return {
    result: {
      v: 1,
      at: now,
      entryTrack,
      solidKcs,
      missedKcs,
      misconceptions: [...slips.keys()],
      rustAnchor: anchor ?? 'skipped',
      items: state.asked,
    },
    pattern,
    slips: [...slips].map(([id, message]) => ({ id, message })),
  }
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export interface WalkProgress {
  /** 1-based topic being asked, and how many there are. */
  topic: number
  topics: number
  /** Items asked so far. */
  asked: number
  /** Items still to come, as expected (two per KC left), within the cap. */
  expected: number
  /** Nominal minutes left, rounded up. */
  minutes: number
}

export function walkProgress(state: WalkState): WalkProgress {
  const topics = state.probes.length
  const left = topics - state.at
  const here = state.answers[state.probes[state.at]]?.length ?? 0
  const expected = Math.max(0, Math.min(MAX_ITEMS - state.asked, left * 2 - here))
  return {
    topic: Math.min(state.at + 1, topics),
    topics,
    asked: state.asked,
    expected,
    minutes: Math.ceil((expected * SECONDS_PER_ITEM) / 60),
  }
}

/* ------------------------------------------------------------------ */
/* Storage and the Curriculum's marker                                 */
/* ------------------------------------------------------------------ */

const TRACK_IDS: readonly string[] = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']
const ANCHOR_STATES: readonly string[] = ['solid', 'missed', 'skipped']
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** The `placement:result` working record's value: a `PlacementResult` is JSON-safe field by field. */
export function placementJson(r: PlacementResult): JsonObject {
  return {
    v: r.v,
    at: r.at,
    entryTrack: r.entryTrack,
    solidKcs: [...r.solidKcs],
    missedKcs: [...r.missedKcs],
    misconceptions: [...r.misconceptions],
    rustAnchor: r.rustAnchor,
    items: r.items,
  }
}

/** A stored result, read defensively (a working record is JSON from any bundle): null for anything else. */
export function readPlacement(value: Json | undefined): PlacementResult | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const r = value as Record<string, unknown>
  if (r.v !== 1 || typeof r.at !== 'string' || typeof r.entryTrack !== 'string' || !TRACK_IDS.includes(r.entryTrack)) return null
  if (!isStrings(r.solidKcs) || !isStrings(r.missedKcs) || !isStrings(r.misconceptions)) return null
  if (typeof r.rustAnchor !== 'string' || !ANCHOR_STATES.includes(r.rustAnchor) || typeof r.items !== 'number') return null
  return {
    v: 1,
    at: r.at,
    entryTrack: r.entryTrack as TrackId,
    solidKcs: [...r.solidKcs],
    missedKcs: [...r.missedKcs],
    misconceptions: [...r.misconceptions],
    rustAnchor: r.rustAnchor as PlacementResult['rustAnchor'],
    items: r.items,
  }
}

/**
 * The Curriculum's "current" lesson (§7.3): the first lesson of the path plan that is neither done nor
 * read. A lesson only read is behind the learner for navigation (D6); it is still not passed, which the
 * page says beside it. Null when the plan is finished.
 */
export function currentLesson(plan: Pick<PathPlan, 'lessons'>, status: (lessonId: string) => string | undefined): string | null {
  return plan.lessons.find((id) => status(id) !== 'done' && status(id) !== 'read') ?? null
}
