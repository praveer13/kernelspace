/**
 * The shape of a field lab (docs/specs/wave-3.md §16.5, task 3s-07) and the pure rules around it: the cost, the verdict
 * on a reading, and the ledger event a reading becomes.
 *
 * A field lab is optional work on a GPU the learner owns or rents. It shows pinned commands (claims), a prediction
 * worked from the claims Boot already uses, and what the run should cost at the dated H100 rental price. A reading the
 * learner types in is written as `item:field.<lab>.<metric>` with src `practice` and provenance `field`: weight 0 in
 * every selector (provenance.ts), and a donation keeps only its `ok` (redact.ts `fieldOnly`), so the number stays on the
 * device. Its `score` goes too: the score is 1 − |log10(value ÷ prediction)| and the prediction is the page's, public, so
 * a donated score would give the reading back up to the sign of the ratio. Nothing here fetches, posts or beacons.
 */

import { claimNumber, getClaim } from '@/data/claims'
import '@/data/claims/lazy/field'
import { rev32 } from '@/lib/ledger/stable'
import type { ItemRef, ItemResponse } from '@/lib/ledger/types'

/**
 * The five claims Boot's story rests on (`BOOT_CLAIMS`, src/lib/boot/model.ts) and the two scenario constants it adds.
 * Read here instead of imported from Boot: both pages are their own lazy chunks, and a module they share is cut out into a
 * third chunk that /boot would then load beside its own (+0.3 KB on /boot's closure, measured). tests/forge/field-labs.test.ts
 * holds every figure below equal to Boot's.
 */
export const BOOT_CLAIM_IDS = {
  bandwidth: 'hw.h100-sxm.hbm-bw',
  capacity: 'hw.h100-sxm.hbm-capacity',
  flops: 'hw.h100-sxm.bf16-dense',
  params: 'model.llama3-8b.params',
  kvPerToken: 'model.llama3-8b.kv-bytes-per-token',
} as const
/** 2 bytes per BF16 weight, and Boot's chat of 4,096 tokens: scenario constants, not claims. */
export const BYTES_PER_WEIGHT = 2
export const CHAT_TOKENS = 4096

/** The claims' numbers in base units, as Boot's `bootInputs` reads them. */
export interface FieldInputs {
  /** bytes per second */
  bandwidth: number
  /** bytes */
  capacity: number
  /** FLOP per second */
  flops: number
  /** parameters */
  params: number
  /** bytes of KV cache per token of one sequence */
  kvPerToken: number
}

export function fieldInputs(): FieldInputs {
  return {
    bandwidth: claimNumber(BOOT_CLAIM_IDS.bandwidth, 1e12),
    capacity: claimNumber(BOOT_CLAIM_IDS.capacity, 1e9),
    flops: claimNumber(BOOT_CLAIM_IDS.flops, 1e12),
    params: claimNumber(BOOT_CLAIM_IDS.params, 1e9),
    kvPerToken: claimNumber(BOOT_CLAIM_IDS.kvPerToken),
  }
}

/** Boot's step-1 rule (`gradeWithin2x`): right within 2× either way, the score falling off a decade at a time. */
export function gradeWithin2x(value: number, truth: number): { ok: boolean; score: number } {
  if (!(value > 0) || !Number.isFinite(value)) return { ok: false, score: 0 }
  const r = value / truth
  return { ok: Math.abs(Math.log2(r)) <= 1, score: Math.max(0, 1 - Math.abs(Math.log10(r))) }
}

/** The spec's ceiling on one lab: "≤ 1.5 GPU-hours (≈ $5 at the H100 median)". */
export const MAX_GPU_HOURS = 1.5

/** The dated H100 rental price the cost is worked at. The spec writes $3.39; the registry's median has moved (prices.ts). */
export const PRICE_CLAIM = 'price.h100.median'

/** What a lab's budget costs in whole cents: GPU-hours × the median in cents, rounded half up (1.5 × 349 = 523.5 → 524). */
export function costCents(hours: number = MAX_GPU_HOURS): number {
  return Math.round(hours * Math.round(claimNumber(PRICE_CLAIM) * 100))
}

/** "$5.24". */
export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/** One line the learner follows: a pinned command, and the pinned line of its output to read. */
export interface FieldStep {
  id: string
  title: string
  /** The claim whose `value` is the command, as typed. */
  claim: string
  /** What it does and what to watch for. */
  note: string
  /** The claim that pins the line of output to read, when the step has one. */
  reads?: string
}

/** A number the page works out from claims: the prediction and the steps toward it. */
export interface DerivedRow {
  id: string
  label: string
  value: number
  unit: string
  /** In words and symbols, e.g. "HBM bandwidth ÷ weight bytes". */
  formula: string
  /** The claim ids the formula reads. */
  from: string[]
  /** Scenario constants the formula also reads, which are not claims. */
  scenario?: string
}

/**
 * How a reading is judged against its prediction. A `ceiling` is a bound the run cannot honestly beat (a roofline
 * with nothing but weights, KV and the math on it): a reading above it means a setup mismatch, and one well under it
 * is overhead the roofline does not count. An `estimate` is a figure the run should land near.
 */
export type PredictionKind = 'ceiling' | 'estimate'

export interface FieldMetric {
  /** The last segment of the ref: `item:field.<lab>.<metric>`. */
  id: string
  label: string
  /** The unit of the recorded value. */
  unit: string
  /** The row of the lab's `rows` that is the prediction. */
  predicted: string
  kind: PredictionKind
  /** What the learner types: the number the tool prints, and how it becomes the recorded value. */
  entry: {
    label: string
    unit: string
    /** Where on the screen it appears. */
    hint: string
    /** The claim that pins that line. */
    reads: string
    /** The recorded value from the typed number (tok/s from TPOT in ms, say). */
    toValue: (typed: number) => number
    /** The conversion in words, shown under the field when it is not the identity. */
    conversion?: string
  }
  /** What to look at when the reading lands well under, near or above the prediction. */
  below: string
  near: string
  above: string
}

export interface FieldLab {
  /** The middle segment of the ref, and the key of the lab on the page. */
  id: string
  title: string
  /** The lesson the lab follows. */
  after: { lesson: string; title: string }
  blurb: string
  /** The budget the lab stays inside, in GPU-hours. */
  gpuHours: number
  steps: FieldStep[]
  rows: DerivedRow[]
  metrics: FieldMetric[]
  /** What this lab does not measure, in plain words. */
  limits: string[]
  /** Who ran the pinned commands on a GPU, and when. Null until the owner (or a partner) has; the page says so while it is. */
  ranBy: string | null
}

/** The ref of one reading. */
export const fieldRef = (lab: string, metric: string): ItemRef => `item:field.${lab}.${metric}` as ItemRef

/** The claims a lab reads, in order and without repeats: its steps' commands and readings, the rows' inputs and the price. */
export function labClaimIds(lab: FieldLab): string[] {
  const ids = [
    ...lab.steps.flatMap((s) => [s.claim, ...(s.reads ? [s.reads] : [])]),
    ...lab.metrics.map((m) => m.entry.reads),
    ...lab.rows.flatMap((r) => r.from),
    PRICE_CLAIM,
  ]
  return ids.filter((id, i) => ids.indexOf(id) === i)
}

/** The row a metric is predicted by. */
export function predictedRow(lab: FieldLab, metric: FieldMetric): DerivedRow {
  const row = lab.rows.find((r) => r.id === metric.predicted)
  if (!row) throw new Error(`field lab ${lab.id}: metric ${metric.id} names no row ${metric.predicted}`)
  return row
}

/** "1,234", "1 234" and "1234.5" read as numbers; anything else, and anything not above zero, is null. */
export function parseReading(text: string): number | null {
  const t = text.trim().replace(/[,\s_]/g, '')
  if (t === '' || !/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

export type Band = 'below' | 'near' | 'above'

export interface Verdict {
  /** Reading ÷ prediction. */
  ratio: number
  band: Band
  /** Within 2× either way, Boot's step-1 rule (`gradeWithin2x`). */
  ok: boolean
  score: number
  /** One sentence for the learner: the ratio, then where to look. */
  text: string
}

/** The share either side of the prediction that counts as near: 5 % above a ceiling, 10 % either way of an estimate. */
const NEAR = { ceiling: [0.5, 1.05], estimate: [0.9, 1.1] } as const

const times = (r: number): string => `${r < 0.1 ? r.toFixed(3) : r.toFixed(2)}×`

export function verdictFor(metric: FieldMetric, recorded: number, predicted: number): Verdict {
  const ratio = recorded / predicted
  const [lo, hi] = NEAR[metric.kind]
  const band: Band = ratio < lo ? 'below' : ratio > hi ? 'above' : 'near'
  const { ok, score } = gradeWithin2x(recorded, predicted)
  const lead = `Your ${metric.label} is ${times(ratio)} the prediction.`
  const text = `${lead} ${band === 'below' ? metric.below : band === 'near' ? metric.near : metric.above}`
  return { ratio, band, ok, score, text }
}

const sig3 = (n: number): number => Number(n.toPrecision(3))

/** A fingerprint of what the reading was judged against, so a changed prediction or claim shows as a new `rev` (spec §4.5). */
export function fieldRev(lab: FieldLab, metric: FieldMetric): string {
  return rev32({
    lab: lab.id,
    metric: metric.id,
    predicted: sig3(predictedRow(lab, metric).value),
    claims: labClaimIds(lab).map((id) => `${id}@${getClaim(id).verifiedAt}`),
  })
}

/**
 * The ledger event for one reading (spec §16.5, §3.2): an `item` on `item:field.<lab>.<metric>`, src `practice`,
 * provenance `field`, the recorded value and the prediction it was judged against. A donation keeps its ref, its day, `ok`
 * and `src`, and nothing else (redact.ts `fieldOnly`). No KCs, so no KC is credited, and
 * `nsec` 0, because the minutes on a rented GPU are not minutes of study. `typed` is the number as the tool printed it
 * and `unit` the recorded value's unit.
 */
export function fieldResponse(lab: FieldLab, metric: FieldMetric, typed: number): ItemResponse {
  const recorded = metric.entry.toValue(typed)
  const predicted = predictedRow(lab, metric).value
  const { ok, score } = gradeWithin2x(recorded, predicted)
  return {
    kind: 'item',
    ref: fieldRef(lab.id, metric.id),
    rev: fieldRev(lab, metric),
    score,
    ok,
    provenance: 'field',
    data: { src: 'practice', value: recorded, truth: predicted, unit: metric.unit, nsec: 0 },
  }
}
