/**
 * The redacted partner donation (docs/specs/wave-2.md §20.2, decision D20, task 2a-21).
 *
 * A partner donates an export that carries no content: `redactForPartner` copies a whitelist of fields and
 * nothing else, so a field nobody thought of cannot leak. Per event it keeps `kind`, `ref`, `score`, `ok`,
 * `conf`, `provenance`, `ms` (rounded to seconds) and a `dayOffset`, the whole local days since the learner's
 * first event. From `data` it keeps the structural fields in `DATA_KEYS`. Of the working records it keeps the
 * week plan's SLO and nothing else.
 *
 * Wave 3 (docs/specs/wave-3.md §15.2, task 3c-03) adds what its selectors read: `sinceDays`; the form identity
 * (`formId`, `formSet`, `formSlot`, and on a form item the form's `track`, one of the KC graph's nine track ids); a
 * play's per-level results and metric; a Prove-it v2 attempt's template, return flag and call count (never its `answer`
 * or `actual`); a Fleet Week act's receipt counts and rubric; a `miss` only when it is a `confuse.<kcId>` id (every
 * other misconception id still goes); and the `value` and `truth` of numeric items, numbers only and never on an event
 * of provenance `field`, so a learner's own GPU or device measurements stay on the device.
 *
 * A `field` event (a field lab's reading, the real-engine run's `predict` and `item`) keeps one bit and nothing else
 * (`fieldOnly`): its `kind`, `ref`, `dayOffset`, `provenance`, `ok` and `data.src`. Its `score` goes too, because a field
 * item's score is 1 − |log10(value ÷ prediction)| and the prediction is public, so a kept score gave the measurement back
 * up to the sign of the ratio; and so does every other field, so no number a later writer adds can carry the reading out.
 *
 * What goes: free text (explanations, constructed responses, `boot:value`, `fw:doc`, pasted configs), seeds,
 * wasm and component hashes, device ids, event ids, calendar dates and times of day, components, capstone
 * drafts, `profile:background`, `fw:runs`. Refs that name a date (`inc:daily/<date>`, `inc:team/<code>/<date>`) are
 * rewritten to a day offset, and a string that looks like a date or a hash is dropped wherever it sits (`safeToken`).
 *
 * One addition rides on the whitelist: the last `complete placement` event carries the placement's solid KC ids
 * as `data.kcs`. Cards replay from that working record (`placement:result`, which is not kept), and a KC id is
 * curriculum content, not the learner's.
 *
 * `ledgerOfDonation` is the way back for the partner report: it gives a donation synthetic ids, days and
 * instants, so every selector in outcomes.ts reads a donation and a full export the same way. Instants are
 * synthetic: within a day, an event starts when the answer times of the events before it have run out, so a
 * session's length from a donation is the time spent answering, never the pauses between answers.
 *
 * Pure: no clock, no storage.
 */

import { MAX_PROVE_CALLS, RUBRIC_KEYS } from '@/lib/ledger/constants'
import type { ExportV3, Json, LedgerEvent, LocalDay, WorkingRecord } from '@/lib/ledger/types'
import { compareEvents } from '@/lib/ledger/merge'
import type { CardsPlan } from './cards'
import { addDays, daysBetween } from './reentry'

/* ------------------------------------------------------------------ */
/* The whitelist                                                       */
/* ------------------------------------------------------------------ */

export const DONATION_FORMAT = 'kernelspace-donation'
export const DONATION_VERSION = 1

/** The event fields a donation keeps, besides `data`. */
export const EVENT_KEYS = ['kind', 'ref', 'score', 'ok', 'conf', 'provenance', 'ms', 'dayOffset'] as const

/** All a donation keeps of an event of provenance `field`: `ok` is the one bit of how the reading compared with its prediction. */
export const FIELD_EVENT_KEYS = ['kind', 'ref', 'ok', 'provenance', 'dayOffset'] as const
/** All it keeps of that event's `data`: `src` (`practice`), which keeps the reading out of the surface table's lessons row (outcomes.ts `surfaceOf`). */
export const FIELD_DATA_KEYS = ['src'] as const

/**
 * The Wave 3 fields (§15.2). Each has its own shape check (`redactStructure`), because a value of the wrong shape under a
 * whitelisted name is as dangerous as a field nobody listed.
 */
const STRUCTURE_KEYS = ['sinceDays', 'formId', 'formSet', 'formSlot', 'track', 'levels', 'metric', 'qid', 'return', 'calls', 'receipts', 'rubric', 'miss', 'value', 'truth'] as const

/** The `data` fields a donation keeps (§20.2, §15.2). `grp` is re-numbered, and `probes` becomes the probe count. */
export const DATA_KEYS = [
  'src',
  'kcs',
  'form',
  'grp',
  'slot',
  'of',
  'level',
  'variant',
  'phase',
  'reason',
  'fault',
  'severity',
  'diagnosed',
  'fixed',
  'burn',
  'expertBurn',
  'streetlight',
  'probes',
  'arm',
  'via',
  ...STRUCTURE_KEYS,
] as const

export type DonationDataKey = (typeof DATA_KEYS)[number]

/** A donated event. `grp` is a number (1, 2, …) in order of first appearance; `probes` is a count. */
export interface DonatedEvent {
  kind: string
  ref: string
  dayOffset: number
  score?: number
  ok?: boolean
  conf?: string
  provenance?: string
  /** Milliseconds, rounded to whole seconds. */
  ms?: number
  data?: Partial<Record<DonationDataKey, Json>>
}

export interface Donation {
  format: typeof DONATION_FORMAT
  version: typeof DONATION_VERSION
  /** The week plan's SLO, when the learner set a week. */
  plan?: { slo: 0.85 | 0.9 }
  /** In ledger order: (`at`, `id`). */
  events: DonatedEvent[]
}

/* ------------------------------------------------------------------ */
/* Redaction                                                           */
/* ------------------------------------------------------------------ */

type Rec = Record<string, unknown>

const DATE_RE = /\d{4}-\d{2}-\d{2}/g
const LONG_HEX_RE = /[0-9a-fA-F]{32,}/
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

/** A short identifier-like string with no date and no hash in it: a source, a variant, a KC id. Anything else is not kept. */
function safeToken(v: unknown): string | null {
  if (typeof v !== 'string' || !TOKEN_RE.test(v)) return null
  return /\d{4}-\d{2}-\d{2}/.test(v) || LONG_HEX_RE.test(v) ? null : v
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const asRec = (v: unknown): Rec => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {})

/**
 * A ref with its calendar dates turned into day offsets from `first`: `inc:daily/2027-05-03` becomes
 * `inc:daily/d12`. A team code is dropped (`inc:team/-/d12`), and a run of 32 or more hex digits (a hash) is
 * blanked, though no ref grammar carries one.
 */
function scrubRef(ref: string, first: LocalDay): string {
  const offsetOf = (date: string): string => `d${daysBetween(first, date)}`
  const team = /^inc:team\/[^/]*\/(\d{4}-\d{2}-\d{2})$/.exec(ref)
  const scrubbed = team ? `inc:team/-/${offsetOf(team[1])}` : ref.replace(DATE_RE, offsetOf)
  return scrubbed.replace(/[0-9a-fA-F]{32,}/g, 'x')
}

/** A `miss` id that names a confusion between KCs (wave-3.md §11.2): `confuse.` and a KC id, `<track>.<slug>`. Every other misconception id stays out of a donation. */
const CONFUSE_RE = /^confuse\.[a-z][a-z0-9]*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/

const RECEIPT_KEYS = ['cited', 'verified', 'uncited'] as const
const MAX_LEVELS = 8
const MAX_RECEIPT_COUNT = 10_000
const MAX_FORM_SLOT = 11

/**
 * The tracks a form item's `track` may name: the KC graph's tracks (`Kc.track`), a fixed list so that the donation does not
 * load the graph; redact.test.ts holds it to the graph. Any other string under `track` stays on the device.
 */
export const DONATION_TRACKS: readonly string[] = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']

const nonNegInt = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max

/**
 * The Wave 3 fields of `d` (§15.2), each held to its own shape or left out. `provenance` is the event's: a numeric
 * answer (`value`) and the truth it was graded against (`truth`) are kept on any event but a `field` one, so a learner's
 * own GPU or device measurements never leave the device.
 */
function redactStructure(d: Rec, provenance: unknown): Partial<Record<DonationDataKey, Json>> {
  const out: Partial<Record<DonationDataKey, Json>> = {}
  if (finite(d.sinceDays) && d.sinceDays >= 0) out.sinceDays = Math.round(d.sinceDays)
  if (d.formId === 'A' || d.formId === 'B' || d.formId === 'C') out.formId = d.formId
  if (d.formSet === 0 || d.formSet === 1 || d.formSet === 2) out.formSet = d.formSet
  if (nonNegInt(d.formSlot, MAX_FORM_SLOT)) out.formSlot = d.formSlot
  // the form's track, so the report counts a slot under the track whose form it is, not the track its KCs mostly name (B2)
  if (d.src === 'form' && typeof d.track === 'string' && DONATION_TRACKS.includes(d.track)) out.track = d.track
  if (Array.isArray(d.levels)) {
    const levels: Json[] = []
    for (const raw of d.levels.slice(0, MAX_LEVELS)) {
      const l = asRec(raw)
      const id = safeToken(l.id)
      if (id === null || typeof l.ok !== 'boolean') continue
      levels.push({ id, ok: l.ok, ...(l.view === '2d' || l.view === '3d' ? { view: l.view } : {}) })
    }
    if (levels.length > 0) out.levels = levels
  }
  const metric = asRec(d.metric)
  const metricName = safeToken(metric.name)
  if (metricName !== null && finite(metric.mine) && metric.mine >= 0 && finite(metric.ghost) && metric.ghost >= 0) {
    out.metric = { name: metricName, mine: metric.mine, ghost: metric.ghost }
  }
  const qid = safeToken(d.qid)
  if (qid !== null) out.qid = qid
  if (d.return === true) out.return = true
  if (nonNegInt(d.calls, MAX_PROVE_CALLS) && d.calls >= 1) out.calls = d.calls
  const receipts = asRec(d.receipts)
  if (RECEIPT_KEYS.every((k) => nonNegInt(receipts[k], MAX_RECEIPT_COUNT))) {
    out.receipts = { cited: receipts.cited as number, verified: receipts.verified as number, uncited: receipts.uncited as number }
  }
  const rubric = asRec(d.rubric)
  if (RUBRIC_KEYS.every((k) => nonNegInt(rubric[k], 3))) {
    out.rubric = { capacity: rubric.capacity as number, slo: rubric.slo as number, cost: rubric.cost as number, failure: rubric.failure as number }
  }
  if (typeof d.miss === 'string' && CONFUSE_RE.test(d.miss) && safeToken(d.miss) !== null) out.miss = d.miss
  if (provenance !== 'field') {
    if (finite(d.value)) out.value = d.value
    if (finite(d.truth)) out.truth = d.truth
  }
  return out
}

/**
 * A `field` event as a donation keeps it: the ref and the day, and `ok`, the one bit of how the reading compared with its
 * prediction. No `score` (with the public prediction it gives the reading back up to the sign of the ratio), no `ms` or
 * `conf`, and of `data` only `src`. No selector reads a field event's score (outcomes.ts reads no event's), and
 * `creditOf('field')` is 0, so nothing the report prints changes.
 */
function fieldOnly(e: { kind: string; ref: string; dayOffset: number; ok?: unknown; data?: unknown }): DonatedEvent {
  const kept: DonatedEvent = { kind: e.kind, ref: e.ref, dayOffset: e.dayOffset }
  if (typeof e.ok === 'boolean') kept.ok = e.ok
  kept.provenance = 'field'
  const src = safeToken(asRec(e.data).src)
  if (src !== null) kept.data = { src }
  return kept
}

/** One `data` object through the whitelist. `grpId` numbers attempt groups across the whole donation. */
function redactData(raw: unknown, provenance: unknown, grpId: (grp: string) => number): DonatedEvent['data'] | undefined {
  const d = asRec(raw)
  const out: Partial<Record<DonationDataKey, Json>> = { ...redactStructure(d, provenance) }
  for (const key of ['src', 'form', 'variant', 'phase', 'reason', 'fault', 'arm', 'via'] as const) {
    const t = safeToken(d[key])
    if (t !== null) out[key] = t
  }
  for (const key of ['slot', 'of', 'level', 'severity', 'streetlight', 'burn', 'expertBurn'] as const) {
    if (finite(d[key]) && d[key] >= 0) out[key] = d[key]
  }
  for (const key of ['diagnosed', 'fixed'] as const) {
    if (typeof d[key] === 'boolean') out[key] = d[key]
  }
  if (Array.isArray(d.kcs)) {
    const kcs = d.kcs.map(safeToken).filter((k): k is string => k !== null)
    if (kcs.length > 0) out.kcs = kcs.slice(0, 12)
  }
  if (typeof d.grp === 'string' && d.grp !== '') out.grp = grpId(d.grp)
  if (Array.isArray(d.probes)) out.probes = d.probes.length
  else if (finite(d.probes) && d.probes >= 0) out.probes = Math.floor(d.probes)
  return Object.keys(out).length > 0 ? out : undefined
}

/** The placement walk's solid KCs, from the working record the cards replay reads. Only KC-id-shaped strings pass. */
function solidKcsOf(working: readonly WorkingRecord[]): string[] {
  const value = working.find((r) => r.key === 'placement:result')?.value
  const solid = asRec(value).solidKcs
  return Array.isArray(solid) ? solid.map(safeToken).filter((k): k is string => k !== null) : []
}

/** The week plan's SLO, the one working field a donation keeps. */
function sloOf(working: readonly WorkingRecord[]): 0.85 | 0.9 | undefined {
  const value = working.find((r) => r.key === 'boot:week')?.value
  const slo = asRec(value).slo
  return slo === 0.85 ? 0.85 : slo === 0.9 ? 0.9 : undefined
}

/**
 * The donation of an export: the whitelist of §20.2 with day offsets and nothing else. The input is not
 * modified. An export with no event gives a donation with no event.
 */
export function redactForPartner(input: Pick<ExportV3, 'events' | 'working'>): Donation {
  const events = [...input.events].sort(compareEvents)
  const first = events.reduce<LocalDay | null>((m, e) => (m === null || e.day < m ? e.day : m), null)
  const groups = new Map<string, number>()
  const grpId = (grp: string): number => {
    let n = groups.get(grp)
    if (n === undefined) {
      n = groups.size + 1
      groups.set(grp, n)
    }
    return n
  }
  let lastPlacement = -1
  events.forEach((e, i) => {
    if (e.kind === 'complete' && e.ref === 'placement') lastPlacement = i
  })
  const solid = solidKcsOf(input.working)

  const out: DonatedEvent[] = events.map((e, i) => {
    const r = e as unknown as Rec
    const base = first as LocalDay
    const kept: DonatedEvent = { kind: e.kind, ref: scrubRef(e.ref, base), dayOffset: daysBetween(base, e.day) }
    if (r.provenance === 'field') return fieldOnly({ ...kept, ok: r.ok, data: r.data })
    if (finite(r.score)) kept.score = r.score
    if (typeof r.ok === 'boolean') kept.ok = r.ok
    const conf = safeToken(r.conf)
    if (conf !== null) kept.conf = conf
    const provenance = safeToken(r.provenance)
    if (provenance !== null) kept.provenance = provenance
    if (finite(r.ms) && r.ms >= 0) kept.ms = Math.round(r.ms / 1000) * 1000
    const data = redactData(r.data, r.provenance, grpId) ?? {}
    if (i === lastPlacement && solid.length > 0) data.kcs = solid.slice(0, 200)
    if (Object.keys(data).length > 0) kept.data = data
    return kept
  })

  const slo = sloOf(input.working)
  return { format: DONATION_FORMAT, version: DONATION_VERSION, ...(slo === undefined ? {} : { plan: { slo } }), events: out }
}

/** What the preview says a donation holds: counts only. */
export interface DonationSummary {
  events: number
  /** Whole days from the first event to the last. */
  days: number
  kinds: { kind: string; count: number }[]
}

export function summarizeDonation(d: Donation): DonationSummary {
  const kinds = new Map<string, number>()
  let days = 0
  for (const e of d.events) {
    kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
    if (e.dayOffset > days) days = e.dayOffset
  }
  return {
    events: d.events.length,
    days,
    kinds: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1)),
  }
}

/* ------------------------------------------------------------------ */
/* Reading a donation                                                  */
/* ------------------------------------------------------------------ */

export type ParsedDonation = { ok: true; donation: Donation } | { ok: false; error: string }

/** Is `text` a donation (as opposed to a full export)? Cheap: the format marker only. */
export function isDonationText(text: string): boolean {
  try {
    return asRec(JSON.parse(text)).format === DONATION_FORMAT
  } catch {
    return false
  }
}

/** Parse and shape-check a donation. It keeps only what the whitelist allows, so a hand-edited file cannot smuggle a field in. */
export function parseDonation(text: string): ParsedDonation {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: "this file isn't valid JSON" }
  }
  const file = asRec(raw)
  if (file.format !== DONATION_FORMAT) return { ok: false, error: "this file isn't a kernelspace donation" }
  if (file.version !== DONATION_VERSION) return { ok: false, error: 'this donation is from a newer version of kernelspace' }
  if (!Array.isArray(file.events)) return { ok: false, error: 'this donation has no event list' }
  const events: DonatedEvent[] = []
  for (const item of file.events) {
    const e = asRec(item)
    if (typeof e.kind !== 'string' || typeof e.ref !== 'string' || !finite(e.dayOffset) || !Number.isInteger(e.dayOffset)) {
      return { ok: false, error: 'this donation is damaged: an event is missing its kind, ref or dayOffset' }
    }
    // a hand-edited file cannot put a number back on a field event either
    if (e.provenance === 'field') {
      events.push(fieldOnly({ kind: e.kind, ref: e.ref, dayOffset: e.dayOffset, ok: e.ok, data: e.data }))
      continue
    }
    const kept: DonatedEvent = { kind: e.kind, ref: e.ref, dayOffset: e.dayOffset }
    if (finite(e.score)) kept.score = e.score
    if (typeof e.ok === 'boolean') kept.ok = e.ok
    if (typeof e.conf === 'string') kept.conf = e.conf
    if (typeof e.provenance === 'string') kept.provenance = e.provenance
    if (finite(e.ms)) kept.ms = e.ms
    const d = asRec(e.data)
    const data: Partial<Record<DonationDataKey, Json>> = {}
    for (const key of DATA_KEYS) if (d[key] !== undefined && !(STRUCTURE_KEYS as readonly string[]).includes(key)) data[key] = d[key] as Json
    // the Wave 3 fields meet their shape checks again, so a hand-edited file cannot put a miss id or a number where it does not belong
    Object.assign(data, redactStructure(d, kept.provenance))
    if (Object.keys(data).length > 0) kept.data = data
    events.push(kept)
  }
  const slo = asRec(file.plan).slo
  return {
    ok: true,
    donation: { format: DONATION_FORMAT, version: DONATION_VERSION, ...(slo === 0.85 || slo === 0.9 ? { plan: { slo } } : {}), events },
  }
}

/** Day zero of the synthetic calendar a donation is replayed on. It is not the learner's: only the offsets mean anything. */
export const DONATION_DAY_ZERO: LocalDay = '2000-01-01'
const DAY_MS = 86_400_000

/** What the selectors of outcomes.ts take: events, and the two working records cards replay from. */
export interface DonationLedger {
  events: LedgerEvent[]
  plan: CardsPlan | null
  placement: { solidKcs: string[] } | null
}

/**
 * A donation as ledger events on the synthetic calendar: ids in file order, `day` from the offset, `at` so that
 * file order is ledger order and a day's events follow each other by their answer times (never into the next
 * day), and `data.grp` as `g<n>`. The placement's solid KCs come back from the last `complete placement`.
 */
export function ledgerOfDonation(d: Donation): DonationLedger {
  const zero = Date.parse(`${DONATION_DAY_ZERO}T00:00:00.000Z`)
  let clock = Number.NEGATIVE_INFINITY
  let lastPlacement: DonatedEvent | null = null
  const events = d.events.map((e, i): LedgerEvent => {
    const dayStart = zero + e.dayOffset * DAY_MS
    clock = Math.max(clock, dayStart)
    const at = new Date(clock).toISOString()
    clock = Math.min(clock + (e.ms ?? 0), Math.max(clock, dayStart + DAY_MS - 1000))
    if (e.kind === 'complete' && e.ref === 'placement') lastPlacement = e
    const data = e.data === undefined ? undefined : { ...e.data, ...(e.data.grp === undefined ? {} : { grp: `g${String(e.data.grp)}` }) }
    return {
      kind: e.kind,
      ref: e.ref,
      ...(e.score === undefined ? {} : { score: e.score }),
      ...(e.ok === undefined ? {} : { ok: e.ok }),
      ...(e.conf === undefined ? {} : { conf: e.conf }),
      ...(e.provenance === undefined ? {} : { provenance: e.provenance }),
      ...(e.ms === undefined ? {} : { ms: e.ms }),
      id: `d${String(i).padStart(8, '0')}`,
      v: 1,
      at,
      tz: 0,
      day: addDays(DONATION_DAY_ZERO, e.dayOffset),
      dev: 'donor',
      ...(data === undefined ? {} : { data }),
    } as unknown as LedgerEvent
  })
  const kcs = (lastPlacement as DonatedEvent | null)?.data?.kcs
  return {
    events,
    plan: d.plan ? { slo: d.plan.slo } : null,
    placement: Array.isArray(kcs) ? { solidKcs: kcs.filter((k): k is string => typeof k === 'string') } : null,
  }
}
