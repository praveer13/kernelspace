/**
 * The item block's pure side (docs/specs/wave-2.md §5.2; task 2a-12): what a lesson's `item` block needs that is
 * not a pixel. The component (src/components/blocks/ItemBlock.tsx) only draws it and writes the ledger.
 *
 * - **Predict first.** The first instance is shown without its worked steps and the learner commits an
 *   estimate (a numeric answer becomes a log-scored estimate with an optional 90 % range) or a pick. It is one
 *   `predict gen:<family>/<variant>` event, `src: 'lesson'`. A pick is stored as the authored option index
 *   (`value`, with `truth` the keyed one and `unit: 'option'`), so the event stays a number the codec accepts.
 * - **Practice.** Item `i` is drawn on a fresh seed (`seedFor(sessionSeed, i)`, skipping any instance the learner
 *   has met) at the staircase level of the variant's KC, and recorded as `item gen:...` with `src: 'lesson'`,
 *   `lessonId` and `grp` = `<lessonId>#<blockIndex>`; provenance is `unseen` because the seed is fresh.
 * - **Done** after `count` correct answers on distinct instances. Nothing locks: more numbers are always drawn.
 * - **Restored from events.** `readBlock` rebuilds the block (prediction, answers, passes, an unanswered first
 *   instance) from the ledger, so a reload shows "3/3 · done" and never asks the prediction twice.
 *
 * Pure: no DOM, no clock, no randomness; the caller passes the session seed and the time of local events.
 */

import type { ItemBlock } from '@/data/lessons/types'
import { seedFor } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { ItemResult } from '@/lib/items/play'
import { levelFor, type StairEvent } from '@/lib/items/staircase'
import type { AnswerSpec, Gen, Instance, Level, PlayableItem, VariantSpec } from '@/lib/items/types'
import { formatNumber } from '@/lib/items/units'
import type { KcId } from '@/lib/kc/types'
import type { ItemData, ItemResponse } from '@/lib/ledger/types'
import { PRE_NSEC } from './prequestions'
import { instanceKey, itemResponseOf } from './today'

/** Correct answers that finish a block unless it says otherwise. */
export const ITEM_COUNT = 3
/** A numeric prediction is graded as an estimate, ok within this factor of the truth (Wave 1 §5.2). */
export const PREDICT_FACTOR = 2
/** The codec rejects an item with more KCs than this (spec §3.2). */
const MAX_KCS = 6
/** Seeds tried before a plan gives up (a family that cannot make an instance on any of them is broken). */
const MAX_TRIES = 32

/* ------------------------------ the block ------------------------------ */

/** Correct answers on distinct instances that finish the block. */
export const blockNeeds = (block: Pick<ItemBlock, 'count'>): number => Math.max(1, Math.floor(block.count ?? ITEM_COUNT))

/** A prediction opens the block unless it says `predict: false`. */
export const wantsPredict = (block: Pick<ItemBlock, 'predict'>): boolean => block.predict !== false

/** `data.grp` of every event of one block. */
export const blockGrp = (lessonId: string, blockIndex: number): string => `${lessonId}#${blockIndex}`

/** The ledger ref prefix of a family's items: the history the staircase and the fresh-seed check read. */
export const familyPrefix = (family: string): string => `gen:${family}/`

/** The block's variants that the family offers, in the block's order. */
export function variantsOf(gen: Pick<Gen, 'variants'>, block: Pick<ItemBlock, 'variants'>): VariantSpec[] {
  return block.variants.flatMap((id) => gen.variants.filter((v) => v.id === id))
}

/** Every KC the block's variants teach, de-duplicated in order: the expert skip needs a solid card for each. */
export function itemBlockKcs(gen: Pick<Gen, 'variants'>, block: Pick<ItemBlock, 'variants'>): KcId[] {
  return [...new Set(variantsOf(gen, block).flatMap((v) => v.kcs))]
}

/* ------------------------------ reading the ledger ------------------------------ */

/** What the block reads of a ledger event, so loaded events and the ones just answered share one shape. */
export interface BlockEvent {
  id?: string
  kind: string
  ref: string
  at: string
  ok?: boolean
  seed?: number
  data?: unknown
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const variantOf = (ref: string): string => ref.slice(ref.indexOf('/') + 1)
const levelOf = (data: Record<string, unknown>): number | undefined => (typeof data.level === 'number' ? data.level : undefined)
const byTime = (a: BlockEvent, b: BlockEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0)

/** The block's own event, as the ledger holds it once written, for the page to keep until it reloads. */
export const blockEventOf = (r: ItemResponse, at: string, id: string): BlockEvent => ({
  id,
  kind: r.kind,
  ref: r.ref,
  at,
  ok: r.ok,
  ...(r.seed === undefined ? {} : { seed: r.seed }),
  data: r.data,
})

/** Every generated instance already served in any session, from `item` and `probe` events (the `unseen` rule of Today). */
export function seenKeys(events: readonly BlockEvent[]): Set<string> {
  const seen = new Set<string>()
  for (const e of events) {
    if ((e.kind !== 'item' && e.kind !== 'probe') || !e.ref.startsWith('gen:') || typeof e.seed !== 'number') continue
    seen.add(instanceKey(e.ref, levelOf(rec(e.data)), e.seed))
  }
  return seen
}

/** One answered item of this block. */
export interface Served {
  variant: string
  level?: number
  seed: number
  ok: boolean
  /** `instanceKey`: what makes two answers the same instance. */
  key: string
}

/** The block's prediction, as saved. */
export interface PredictRecord {
  variant: string
  level?: number
  seed: number
  ok: boolean
  value: number
  truth: number
  unit: string
}

/** The first instance, predicted but nothing answered yet: a reload shows the same numbers. */
export interface Pending {
  variant: string
  level: number | undefined
  seed: number
}

export interface BlockState {
  predict: PredictRecord | null
  /** Answers in the order they were given. */
  served: Served[]
  /** Distinct instances answered correctly. */
  passes: number
  done: boolean
  pending: Pending | null
}

export interface BlockAt {
  lessonId: string
  blockIndex: number
  family: string
  count: number
}

/** The block's state from the events that carry its `grp`: its prediction, its answers, how many passes, what is pending. */
export function readBlock(events: readonly BlockEvent[], at: BlockAt): BlockState {
  const grp = blockGrp(at.lessonId, at.blockIndex)
  const prefix = familyPrefix(at.family)
  const mine = events
    .filter((e) => e.ref.startsWith(prefix) && rec(e.data).src === 'lesson' && rec(e.data).grp === grp && typeof e.seed === 'number')
    .sort(byTime)
  const served: Served[] = []
  let predict: PredictRecord | null = null
  for (const e of mine) {
    const d = rec(e.data)
    const level = levelOf(d)
    const seed = e.seed as number
    if (e.kind === 'item') {
      served.push({ variant: variantOf(e.ref), seed, ok: e.ok === true, key: instanceKey(e.ref, level, seed), ...(level === undefined ? {} : { level }) })
    } else if (e.kind === 'predict' && predict === null && typeof d.value === 'number' && typeof d.truth === 'number') {
      predict = { variant: variantOf(e.ref), seed, ok: e.ok === true, value: d.value, truth: d.truth, unit: typeof d.unit === 'string' ? d.unit : '', ...(level === undefined ? {} : { level }) }
    }
  }
  const passes = new Set(served.filter((s) => s.ok).map((s) => s.key)).size
  const p = predict as PredictRecord | null
  // pending only until the learner has answered anything: a first instance swapped away for new numbers stays gone
  const pending = p && served.length === 0 ? { variant: p.variant, level: p.level, seed: p.seed } : null
  return { predict: p, served, passes, done: passes >= at.count, pending }
}

/** "2/3" and, once finished, "3/3 · done". */
export const progressText = (passes: number, count: number): string => `${Math.min(passes, count)}/${count}${passes >= count ? ' · done' : ''}`

/** What the saved prediction says once the answer is known. */
export function predictLine(p: PredictRecord): string {
  if (p.unit === 'option') return p.ok ? 'Your first pick, before the steps, was right.' : 'Your first pick, before the steps, was not the keyed one.'
  const unit = p.unit ? ` ${p.unit}` : ''
  return `You predicted ${formatNumber(p.value)}${unit}; the answer was ${formatNumber(p.truth)}${unit}.`
}

/* ------------------------------ planning ------------------------------ */

/** One instance to show, and the KC whose staircase chose its level. */
export interface Planned {
  inst: Instance
  kc: KcId
}

/** The level of `offered` nearest to `want` (the lower one on a tie): a variant may teach only some levels. */
function snapLevel(offered: readonly Level[], want: Level): Level | null {
  if (offered.length === 0) return null
  return [...offered].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0]
}

const stairOf = (events: readonly BlockEvent[]): StairEvent[] =>
  events.flatMap((e) => {
    const kcs = rec(e.data).kcs
    return e.kind === 'item' || e.kind === 'probe'
      ? [{ ...(e.id === undefined ? {} : { id: e.id }), kind: e.kind, ref: e.ref, at: e.at, ...(e.ok === undefined ? {} : { ok: e.ok }), data: { kcs: Array.isArray(kcs) ? kcs.filter((k): k is string => typeof k === 'string') : [] } }]
      : []
  })

/** An instance of a variant at a level on a seed, or null when the family cannot make it. */
export function makeAt(gen: Gen, variant: string, level: number | undefined, seed: number): Planned | null {
  const spec = gen.variants.find((v) => v.id === variant)
  if (!spec) return null
  const at = snapLevel(spec.levels, (level ?? 1) as Level)
  if (at === null) return null
  try {
    return { inst: gen.make(seed >>> 0, at, variant), kc: spec.kcs[0] }
  } catch {
    return null
  }
}

/**
 * Item number `draw` of the block: the variant by round-robin, the level from the staircase of the variant's first
 * KC in this family, the seed from `seedFor(sessionSeed, draw)` moved on until the instance is one the learner has
 * not met. `events` holds the family's history, this visit's answers included. Null when nothing can be made.
 */
export function planItem(gen: Gen, block: Pick<ItemBlock, 'variants'>, events: readonly BlockEvent[], sessionSeed: number, draw: number): Planned | null {
  const variants = variantsOf(gen, block)
  if (variants.length === 0) return null
  const variant = variants[draw % variants.length]
  const kc = variant.kcs[0]
  const level = snapLevel(variant.levels, levelFor(stairOf(events), kc, gen.id))
  if (level === null) return null
  const seen = seenKeys(events)
  const ref = `gen:${gen.id}/${variant.id}`
  let fallback: Planned | null = null
  for (let j = 0; j < MAX_TRIES; j++) {
    const seed = seedFor(sessionSeed, draw + j)
    const planned = makeAt(gen, variant.id, level, seed)
    if (planned === null) continue
    if (!seen.has(instanceKey(ref, planned.inst.level, seed))) return planned
    fallback ??= planned
  }
  return fallback
}

/* ------------------------------ the prediction ------------------------------ */

/**
 * The first instance as a prediction: no worked steps (they would hand over the answer), and a numeric answer
 * becomes an estimate within a factor of `PREDICT_FACTOR` with an optional 90 % range. An estimate or a choice
 * stays as it is. Sized like a prequestion.
 */
export function predictInstance(inst: Instance): Instance {
  const a: AnswerSpec = inst.answer
  const answer: AnswerSpec = a.kind === 'numeric' ? { kind: 'estimate', truth: a.truth, unit: a.unit, okWithinFactor: PREDICT_FACTOR, interval: true } : a
  return {
    ...inst,
    prompt: { stem: inst.prompt.stem, ...(inst.prompt.givens ? { givens: inst.prompt.givens } : {}) },
    answer,
    nsec: PRE_NSEC,
  }
}

/** The checker for a prediction: the shared grading with the family's ratio rules, and no solution to show. */
export const predictGen = (gen: Gen): Gen => ({ ...gen, grade: (inst, response) => gradeResponse(inst, response, gen.ratioRules), solution: () => [] })

export interface BlockCtx {
  lessonId: string
  blockIndex: number
}

/** The ledger write for the prediction (`predict gen:<family>/<variant>`, `src: 'lesson'`). */
export function predictResponse(inst: Instance, r: ItemResult, ctx: BlockCtx): ItemResponse {
  const a = inst.answer
  let value: number
  let truth: number
  let unit: string
  if (a.kind === 'choice') {
    const picked = r.response.kind === 'choice' ? r.response.picks[0] : undefined
    value = a.options.findIndex((o) => o.id === picked)
    truth = a.options.findIndex((o) => o.id === a.correct[0])
    unit = 'option'
  } else {
    value = r.response.kind === 'estimate' || r.response.kind === 'numeric' ? r.response.value : 0
    truth = a.truth
    unit = a.unit
  }
  const range = r.response.kind === 'estimate' && r.response.lo !== undefined && r.response.hi !== undefined ? { lo: r.response.lo, hi: r.response.hi } : null
  return {
    kind: 'predict',
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    data: {
      src: 'lesson',
      value,
      unit,
      truth,
      kcs: r.kcs.slice(0, MAX_KCS),
      nsec: PRE_NSEC,
      grp: blockGrp(ctx.lessonId, ctx.blockIndex),
      lessonId: ctx.lessonId,
      ...(r.level === undefined ? {} : { level: r.level }),
      ...(r.variant === undefined ? {} : { variant: r.variant }),
      ...(range ?? {}),
      ...(r.grade.interval ? { hit: r.grade.interval.hit } : {}),
      ...(r.grade.diagnosis ? { miss: r.grade.diagnosis.id } : {}),
    },
  }
}

/* ------------------------------ practice ------------------------------ */

/**
 * The ledger write for one answered item: Today's `itemResponseOf` (one mapping from a result to an event, so the
 * block and Today never disagree about `value`, `picks` or `miss`) with the block's identity instead of a
 * session slot: `src: 'lesson'`, `lessonId`, `grp` = `<lessonId>#<blockIndex>`.
 */
export function lessonItemResponse(result: ItemResult, item: PlayableItem, ctx: BlockCtx, seen: ReadonlySet<string>): ItemResponse {
  const grp = blockGrp(ctx.lessonId, ctx.blockIndex)
  const base = itemResponseOf(result, item, { grp, slot: 0, of: 1, reason: 'extra', src: 'practice' }, seen)
  const data: ItemData = { ...(base.data as ItemData), src: 'lesson', lessonId: ctx.lessonId }
  delete data.slot
  delete data.of
  delete data.reason
  return { ...base, data }
}
