/**
 * Exit instrumentation (docs/specs/wave-1.md §17, task C19): the four Wave 1 gates that need partner
 * data, as pure selectors over exported ledgers.
 *
 *   G1  loop completion   prequestions → play → lab 01 stage 4 → unseen-seed pass → Today
 *   G2  first-review recall within ±10 points of predicted (n ≥ 100, interval reported)
 *   G3  7-day cold check, pooled accuracy of Today `probe` slots (n ≥ 50, Wilson interval, reported)
 *   G7  median Today session ≤ 12 minutes (over every session, as §17 defines it; the completed-only median is reported beside it)
 *
 * Everything is derived from the Evidence Ledger (events, plus the working records cards read). Nothing is
 * stored, nothing is sent: `scripts/partner-report.ts` runs these locally over exports a partner donated.
 * One ledger is one partner, so pooled functions take a list of ledgers and sum per ledger; event ids are
 * never compared across ledgers.
 *
 * Partners donate exports with week-level dates and no free text. `stripFreeText` removes what text a
 * ledger can hold (`explain`, `boot:value`, constructed-response text) before anything is counted, and no
 * selector here reads it.
 *
 * Wave 2 (docs/specs/wave-2.md §20, task 2a-21) extends this file at the end with the field-gate selectors
 * (`selectRetention30` … `selectDailyStats`), the §23.2 field-gate table (`buildFieldReport`) and its text.
 * They read `PartnerLedger`s, which come from a full export or from a redacted donation (redact.ts
 * `ledgerOfDonation`), and use only what both carry.
 */

import { SYSTEMS_FORGE_LABS } from '@/data/labs'
import { KCS } from '@/data/kc'
import type { Kc } from '@/lib/kc/types'
import { compareEvents } from '@/lib/ledger/merge'
import { dayOf } from '@/lib/ledger/time'
import type { IsoInstant, LedgerEvent, LocalDay, WorkingKey, WorkingRecord } from '@/lib/ledger/types'
import { wilson } from './calibration'
import { DEFAULT_SLO, deriveCardsDetailed, type CardsContent, type CardsExtra, type CardsPlan, type FirstReview } from './cards'
import { weekStartOf } from './planner'
import { daysBetween } from './reentry'
import { instanceKey, sessionSpanMs } from './today'
import type { FirstReviewCalibration } from './types'

/* ------------------------------------------------------------------ */
/* Bars                                                                */
/* ------------------------------------------------------------------ */

/** G1: partners that complete the loop. */
export const G1_MIN_PARTNERS = 5
/** G2: first reviews pooled, and how far predicted may sit from observed. */
export const G2_MIN_N = 100
export const G2_MAX_GAP = 0.1
/** G3: cold checks pooled, and the age that makes a probe a 7-day check. */
export const G3_MIN_N = 50
export const G3_MIN_DAYS = 7
/** G7: the median Today session, in minutes. */
export const G7_MAX_MINUTES = 12

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Ledger = readonly LedgerEvent[]
type Rec = Record<string, unknown>

const dataOf = (e: LedgerEvent): Rec => {
  const d = (e as { data?: unknown }).data
  return typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Rec) : {}
}

const sorted = (events: Ledger): LedgerEvent[] => [...events].sort(compareEvents)

const isAnswer = (e: LedgerEvent): boolean => e.kind === 'item' || e.kind === 'probe'

const srcOf = (e: LedgerEvent): unknown => dataOf(e).src

const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** The last local day any event of the ledger carries: "now" for replaying cards. */
const lastDay = (events: Ledger): LocalDay | null => events.reduce<LocalDay | null>((m, e) => (m === null || e.day > m ? e.day : m), null)

/* ------------------------------------------------------------------ */
/* Stripping free text                                                 */
/* ------------------------------------------------------------------ */

/**
 * The working records a report may read: the week plan and placement result that cards replay from, and the
 * Today preferences. Everything else is dropped, `boot:value` (Boot's free-text answer) and `fw:doc` among it.
 */
const KEPT_WORKING: ReadonlySet<WorkingKey> = new Set<WorkingKey>(['boot:week', 'placement:result', 'today:prefs'])

/** The only `data` fields a constructed-response event keeps: structure, never what the learner wrote. */
const CR_KEPT: ReadonlySet<string> = new Set(['src', 'grp', 'lessonId', 'form', 'reason', 'slot', 'of', 'kcs', 'nsec', 'ideas', 'level', 'sinceDays'])

export interface Stripped {
  events: LedgerEvent[]
  working: WorkingRecord[]
  /** What was removed, so the report can say it did. */
  removed: { explain: number; bootValue: number; crText: number; otherWorking: number }
}

/**
 * A copy of a ledger with its free text removed, before any selector sees it: `data.explain` on any event
 * (sim-task one-line explanations), every `cr:` event's `data` fields beyond structure, and every working
 * record outside `KEPT_WORKING` (`boot:value` among them). The input is not modified.
 */
export function stripFreeText(input: { events: Ledger; working?: readonly WorkingRecord[] }): Stripped {
  const removed = { explain: 0, bootValue: 0, crText: 0, otherWorking: 0 }
  const events = input.events.map((e) => {
    const raw = (e as { data?: unknown }).data
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return e
    const data = raw as Rec
    if (e.ref.startsWith('cr:')) {
      const kept: Rec = {}
      let dropped = false
      for (const [k, v] of Object.entries(data)) {
        if (CR_KEPT.has(k)) kept[k] = v
        else dropped = true
      }
      if (dropped) removed.crText += 1
      return dropped ? ({ ...e, data: kept } as LedgerEvent) : e
    }
    if ('explain' in data) {
      removed.explain += 1
      const rest: Rec = {}
      for (const [k, v] of Object.entries(data)) if (k !== 'explain') rest[k] = v
      return { ...e, data: rest } as LedgerEvent
    }
    return e
  })
  const working: WorkingRecord[] = []
  for (const r of input.working ?? []) {
    if (KEPT_WORKING.has(r.key)) working.push(r)
    else if (r.key === 'boot:value') removed.bootValue += 1
    else removed.otherWorking += 1
  }
  return { events, working, removed }
}

/* ------------------------------------------------------------------ */
/* G1: the loop                                                        */
/* ------------------------------------------------------------------ */

/** What the block-placement loop is made of; every id here is a fact about shipped content. */
export interface LoopSpec {
  /** Prequestion refs start with this (`pre:t1.l4#0`). */
  prequestionPrefix: string
  playRef: string
  labRef: string
  /** The lab 01 stage whose `lab-check` event ends the build. */
  stage: number
  /** Lab 01's required checks: every one must pass on seeds drawn at grade time. */
  requiredChecks: readonly string[]
  /** KCs of the `frag` generator family (Kc.gen). */
  fragKcs: ReadonlySet<string>
  /** A `gen:frag/…` ref is the family itself, so it counts even when the event carries no KC tag. */
  fragRefPrefix: string
}

/** The shipped loop: T1.L4's prequestions, the block-placement play, lab 01 and the `frag` family. */
export function loopSpec(kcs: readonly Kc[] = KCS, labs = SYSTEMS_FORGE_LABS): LoopSpec {
  const lab = labs.find((l) => l.id === 'rust-allocator')
  if (!lab) throw new Error('rust-allocator is missing from SYSTEMS_FORGE_LABS')
  return {
    prequestionPrefix: 'pre:t1.l4#',
    playRef: 'play:block-placement',
    labRef: 'lab:rust-allocator',
    stage: 4,
    requiredChecks: lab.checks.filter((c) => c.optional !== true).map((c) => c.id),
    fragKcs: new Set(kcs.filter((k) => k.gen?.includes('frag')).map((k) => k.id)),
    fragRefPrefix: 'gen:frag/',
  }
}

/** The five links of G1, in order. */
export const LOOP_STEPS = ['prequestion', 'play', 'stage', 'unseen', 'today'] as const
export type LoopStep = (typeof LOOP_STEPS)[number]

export interface LoopCompletion {
  complete: boolean
  /** Links reached, 0-5. A learner who stopped at the play has `reached = 2`. */
  reached: number
  /** The instant each reached link was met; null for links not reached. */
  at: Record<LoopStep, IsoInstant | null>
}

/**
 * G1 (spec §17) for one ledger. The links must happen in time order, each at the first opportunity after
 * the one before, which finds the loop whenever the ledger holds one:
 *
 *   1. a `pre:t1.l4#*` event;
 *   2. an `ok` `play:block-placement` event of phase play;
 *   3. a `lab-check` on lab 01 reporting stage 4;
 *   4. every required lab 01 check passed on seeds drawn at grade time, counting only runs from step 3 on
 *      (the aggregate's `unseen` rule: provenance `unseen`, and `fresh` or no seed). The run of step 3 may
 *      itself finish this link;
 *   5. a Today session item (not "keep going") of the `frag` family after that run.
 *
 * Events order by (`at`, `id`), as the ledger does.
 */
export function selectLoopCompletion(events: Ledger, spec: LoopSpec = loopSpec()): LoopCompletion {
  const at: Record<LoopStep, IsoInstant | null> = { prequestion: null, play: null, stage: null, unseen: null, today: null }
  let reached = 0
  const passed = new Set<string>()
  const need = new Set(spec.requiredChecks)
  for (const e of sorted(events)) {
    const d = dataOf(e)
    if (reached === 0) {
      if ((e.kind === 'item' || e.kind === 'predict') && e.ref.startsWith(spec.prequestionPrefix)) {
        at.prequestion = e.at
        reached = 1
      }
      continue
    }
    if (reached === 1) {
      if (e.kind === 'play' && e.ref === spec.playRef && (e as { ok?: boolean }).ok === true && d.phase === 'play') {
        at.play = e.at
        reached = 2
      }
      continue
    }
    if (reached === 2) {
      if (e.kind === 'lab-check' && e.ref === spec.labRef && typeof d.stage === 'number' && d.stage >= spec.stage) {
        at.stage = e.at
        reached = 3
      }
      // falls through to step 4 for the same event: one run can reach the stage and pass on fresh seeds
    }
    if (reached === 3) {
      if (e.kind === 'lab-check' && e.ref === spec.labRef && (e as { provenance?: string }).provenance === 'unseen' && Array.isArray(d.checks)) {
        for (const c of d.checks as unknown[]) {
          const k = typeof c === 'object' && c !== null ? (c as Rec) : {}
          if (typeof k.id === 'string' && k.status === 'pass' && (k.fresh === true || k.seed === undefined)) passed.add(k.id)
        }
        if ([...need].every((id) => passed.has(id))) {
          at.unseen = e.at
          reached = 4
        }
      }
      continue
    }
    if (reached === 4 && isAnswer(e) && srcOf(e) === 'today' && d.reason !== 'extra') {
      const tagged = Array.isArray(d.kcs) && (d.kcs as unknown[]).some((k) => typeof k === 'string' && spec.fragKcs.has(k))
      if (tagged || e.ref.startsWith(spec.fragRefPrefix)) {
        at.today = e.at
        reached = 5
        break
      }
    }
  }
  return { complete: reached === LOOP_STEPS.length, reached, at }
}

export interface LoopTally {
  partners: number
  complete: number
  /** Partners that reached each link, in `LOOP_STEPS` order (a funnel: never increasing). */
  funnel: number[]
  /** G1: `pass` once `G1_MIN_PARTNERS` completed the loop. */
  status: 'pass' | 'short'
}

/** G1 over donated ledgers: how many completed the loop, and where the others stopped. */
export function tallyLoopCompletion(ledgers: readonly Ledger[], spec: LoopSpec = loopSpec()): LoopTally {
  const funnel = LOOP_STEPS.map(() => 0)
  let complete = 0
  for (const events of ledgers) {
    const r = selectLoopCompletion(events, spec)
    for (let i = 0; i < r.reached; i++) funnel[i] += 1
    if (r.complete) complete += 1
  }
  return { partners: ledgers.length, complete, funnel, status: complete >= G1_MIN_PARTNERS ? 'pass' : 'short' }
}

/* ------------------------------------------------------------------ */
/* G2: first-review calibration                                        */
/* ------------------------------------------------------------------ */

/** One donated ledger with the working records cards replay from. */
export interface PartnerLedger {
  events: Ledger
  /** `boot:week`, normalized (planner.ts `normalizeWeekPlan`). */
  plan?: CardsPlan | null
  /** `placement:result`'s solid KCs (summary.ts `placementOf`). */
  placement?: CardsExtra['placement']
}

export interface FirstReviewGate extends FirstReviewCalibration {
  ledgers: number
  /** |meanPredicted − observed|; null with no first review. */
  gap: number | null
  /** `pass` needs n ≥ `G2_MIN_N` and a gap of at most `G2_MAX_GAP`; with fewer reviews it is `insufficient`. */
  status: 'pass' | 'fail' | 'insufficient'
}

/** Every ledger's first spaced reviews, by the same replay Today and /progress use (cards.ts). */
export function firstReviewsOf(ledger: PartnerLedger, content: CardsContent): FirstReview[] {
  const now = lastDay(ledger.events)
  if (now === null) return []
  return deriveCardsDetailed(ledger.events, content, now, ledger.plan, { placement: ledger.placement }).firstReviews
}

/**
 * G2 (spec §17): predicted against observed recall over every partner's first spaced reviews, pooled. The
 * replay is per ledger (each learner has their own offset and cards); the reviews are then counted together.
 */
export function selectFirstReviewGate(ledgers: readonly PartnerLedger[], content: CardsContent): FirstReviewGate {
  const reviews = ledgers.flatMap((l) => firstReviewsOf(l, content))
  const n = reviews.length
  if (n === 0) return { n, meanPredicted: null, observed: null, ci95: null, ledgers: ledgers.length, gap: null, status: 'insufficient' }
  const right = reviews.filter((r) => r.ok).length
  const w = wilson(right, n)
  const meanPredicted = reviews.reduce((s, r) => s + r.predicted, 0) / n
  const observed = right / n
  const gap = Math.abs(meanPredicted - observed)
  const status = n < G2_MIN_N ? 'insufficient' : gap <= G2_MAX_GAP ? 'pass' : 'fail'
  return { n, meanPredicted, observed, ci95: [w.lo, w.hi], ledgers: ledgers.length, gap, status }
}

/* ------------------------------------------------------------------ */
/* G3: the 7-day cold check                                            */
/* ------------------------------------------------------------------ */

export interface ProbeAccuracy {
  n: number
  correct: number
  accuracy: number | null
  /** Wilson 95 % interval; null with no probe. */
  ci95: [number, number] | null
  /** Reported, not gated: the pre-registered bar comes in Wave 2. `insufficient` below `G3_MIN_N`. */
  status: 'reported' | 'insufficient'
}

/** A Today cold check on a KC last met at least `minDays` ago. Wave 0b's lesson cold checks (`src: 'cold'`) are not Today slots. */
export function isTodayProbe(e: LedgerEvent, minDays = G3_MIN_DAYS): boolean {
  if (e.kind !== 'probe' || srcOf(e) !== 'today') return false
  const since = dataOf(e).sinceDays
  return typeof since === 'number' && since >= minDays
}

/** G3 (spec §17): pooled accuracy of Today `probe` slots with `sinceDays ≥ 7`. */
export function selectProbeAccuracy(ledgers: readonly Ledger[], minDays = G3_MIN_DAYS): ProbeAccuracy {
  let n = 0
  let correct = 0
  for (const events of ledgers) {
    for (const e of events) {
      if (!isTodayProbe(e, minDays)) continue
      n += 1
      if ((e as { ok?: boolean }).ok === true) correct += 1
    }
  }
  if (n === 0) return { n, correct, accuracy: null, ci95: null, status: 'insufficient' }
  const w = wilson(correct, n)
  return { n, correct, accuracy: correct / n, ci95: [w.lo, w.hi], status: n >= G3_MIN_N ? 'reported' : 'insufficient' }
}

/* ------------------------------------------------------------------ */
/* G7: Today duration                                                  */
/* ------------------------------------------------------------------ */

export interface TodaySession {
  /** `data.grp`: the session id. */
  grp: string
  items: number
  /** The session length the composer wrote, when events carry it. */
  of: number | null
  /** The last slot was answered (`slot` reached `of − 1`, spec §6.7). */
  completed: boolean
  /** Last item's `at` − first item's `at` + last item's `ms`, in milliseconds. */
  spanMs: number
}

/**
 * The Today sessions of one ledger: its `src: 'today'` answers grouped by `grp`. A group made only of
 * "keep going" items (`reason: 'extra'`) is practice after a session, not a session.
 */
export function selectTodaySessions(events: Ledger): TodaySession[] {
  const groups = new Map<string, LedgerEvent[]>()
  for (const e of sorted(events)) {
    if (!isAnswer(e) || srcOf(e) !== 'today') continue
    const grp = dataOf(e).grp
    if (typeof grp !== 'string' || grp === '') continue
    const list = groups.get(grp)
    if (list) list.push(e)
    else groups.set(grp, [e])
  }
  const out: TodaySession[] = []
  for (const [grp, items] of groups) {
    if (items.every((e) => dataOf(e).reason === 'extra')) continue
    const spanMs = sessionSpanMs(items, grp)
    if (spanMs === null || !Number.isFinite(spanMs)) continue
    let of: number | null = null
    let maxSlot = -1
    for (const e of items) {
      const d = dataOf(e)
      if (typeof d.of === 'number' && d.of >= 1) of = Math.max(of ?? 0, d.of)
      if (typeof d.slot === 'number') maxSlot = Math.max(maxSlot, d.slot)
    }
    out.push({ grp, items: items.length, of, completed: of !== null && maxSlot >= of - 1, spanMs })
  }
  return out
}

export interface TodayDuration {
  sessions: number
  completed: number
  /** Median minutes over completed sessions only, reported beside the gate's median. */
  medianMinutes: number | null
  /** Median minutes over every Today session, as §17 defines G7: this one is gated. */
  medianAllMinutes: number | null
  /** `pass` at an all-session median of at most `G7_MAX_MINUTES`; `insufficient` with no session. */
  status: 'pass' | 'fail' | 'insufficient'
}

/** G7 (spec §17): the median over every partner Today session, pooled over ledgers; the completed-only median rides along. */
export function selectTodayDuration(ledgers: readonly Ledger[]): TodayDuration {
  const all = ledgers.flatMap((events) => selectTodaySessions(events))
  const done = all.filter((s) => s.completed)
  const medianMinutes = median(done.map((s) => s.spanMs / 60_000))
  const medianAllMinutes = median(all.map((s) => s.spanMs / 60_000))
  const status = medianAllMinutes === null ? 'insufficient' : medianAllMinutes <= G7_MAX_MINUTES ? 'pass' : 'fail'
  return { sessions: all.length, completed: done.length, medianMinutes, medianAllMinutes, status }
}

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

export interface ExportRow {
  /** "#1": partners are never named in a report. */
  label: string
  /** Monday of the week the export was made, by the learner's local day (week-level, like every date a partner donates). */
  week: LocalDay
  events: number
  loop: LoopCompletion
  sessions: number
}

export interface OutcomeReport {
  g1: LoopTally
  g2: FirstReviewGate
  g3: ProbeAccuracy
  g7: TodayDuration
  rows: ExportRow[]
}

export interface DonatedLedger extends PartnerLedger {
  /** `exportedAt` of the file. */
  exportedAt: IsoInstant
}

/**
 * The learner's local day of the export: `exportedAt` shifted by the offset of the ledger's latest event (its
 * `tz`, minutes east of UTC). The UTC date would put a Sunday-evening export from a western zone in next week.
 * A ledger with no event has no offset to read, so it falls back to UTC.
 */
function exportDay(l: DonatedLedger): LocalDay {
  const latest = l.events.reduce<LedgerEvent | null>((m, e) => (m === null || compareEvents(e, m) > 0 ? e : m), null)
  return dayOf(l.exportedAt, latest?.tz ?? 0)
}

/** All four gates over donated (and already stripped) ledgers. */
export function buildOutcomeReport(ledgers: readonly DonatedLedger[], content: CardsContent, spec: LoopSpec = loopSpec()): OutcomeReport {
  const events = ledgers.map((l) => l.events)
  return {
    g1: tallyLoopCompletion(events, spec),
    g2: selectFirstReviewGate(ledgers, content),
    g3: selectProbeAccuracy(events),
    g7: selectTodayDuration(events),
    rows: ledgers.map((l, i) => ({
      label: `#${i + 1}`,
      week: weekStartOf(exportDay(l)),
      events: l.events.length,
      loop: selectLoopCompletion(l.events, spec),
      sessions: selectTodaySessions(l.events).length,
    })),
  }
}

const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)} %`)
const interval = (ci: readonly [number, number] | null): string => (ci === null ? '' : `, 95 % interval ${pct(ci[0])} to ${pct(ci[1])}`)
const mins = (x: number | null): string => (x === null ? 'n/a' : `${x.toFixed(1)} min`)

/** The report as text: one block per gate, then one line per export. */
export function formatOutcomeReport(r: OutcomeReport): string {
  const { g1, g2, g3, g7 } = r
  const funnel = LOOP_STEPS.map((s, i) => `${s} ${g1.funnel[i]}`).join(' → ')
  const lines = [
    `Wave 1 exit report over ${g1.partners} ${g1.partners === 1 ? 'export' : 'exports'}`,
    '',
    `G1  loop completion   ${g1.complete} of ${G1_MIN_PARTNERS} needed → ${g1.status === 'pass' ? 'PASS' : 'SHORT'}`,
    `      reached: ${funnel}`,
    `G2  first-review recall   n = ${g2.n} (needs ${G2_MIN_N}), predicted ${pct(g2.meanPredicted)}, observed ${pct(g2.observed)}${interval(g2.ci95)}`,
    `      gap ${g2.gap === null ? 'n/a' : `${(g2.gap * 100).toFixed(1)} points`} (bar ${G2_MAX_GAP * 100}) → ${g2.status.toUpperCase()}`,
    `G3  7-day cold check   n = ${g3.n} (needs ${G3_MIN_N}), accuracy ${pct(g3.accuracy)}${interval(g3.ci95)} → ${g3.status.toUpperCase()} (reported, no bar yet)`,
    `G7  Today duration   median ${mins(g7.medianAllMinutes)} over all ${g7.sessions} sessions, finished or not (bar ${G7_MAX_MINUTES} min) → ${g7.status.toUpperCase()}`,
    `      completed only: median ${mins(g7.medianMinutes)} over ${g7.completed} sessions`,
    '',
    'exports (week-level dates only)',
    ...r.rows.map((x) => `  ${x.label}  week of ${x.week}  ${x.events} events  loop ${x.loop.reached}/${LOOP_STEPS.length}${x.loop.complete ? ' complete' : ''}  ${x.sessions} Today sessions`),
  ]
  return lines.join('\n')
}

/* ================================================================== */
/* Wave 2 field gates (docs/specs/wave-2.md §20, §23.2; task 2a-21)    */
/* ================================================================== */

/** F1: the pooled 30-day recall gate. */
export const RETENTION_MIN_DAYS = 30
export const RETENTION_MIN_N = 140
export const RETENTION_MIN_SPAN_DAYS = 35
/** Partners a gate needs before it may pass: F1's five and F2's n ≥ 5, held for every gate that counts partners. */
export const FIELD_MIN_PARTNERS = 5
/** F2: the median days from Boot to the first T lesson. */
export const BOOT_MAX_DAYS = 3
/** F4: the median Today session, in minutes (PLAN §9). */
export const TODAY_MAX_MINUTES = 15
/** F5: the exit ticket's median minutes, and the share passed within two tries. */
export const TICKET_MAX_MINUTES = 4
export const TICKET_MIN_PASS = 0.7
export const TICKET_TRIES = 2
/** F6: the share of lab greens followed by a Prove-it attempt. */
export const PROVE_MIN_RATE = 0.6
/** F7: the share of solid placement KCs confirmed at day 7. */
export const CONFIRM7_MIN_RATE = 0.85

export interface Proportion {
  n: number
  correct: number
  rate: number | null
  /** Wilson 95 % interval; null with no trial. */
  ci95: [number, number] | null
}

function proportion(correct: number, n: number): Proportion {
  if (n === 0) return { n, correct, rate: null, ci95: null }
  const w = wilson(correct, n)
  return { n, correct, rate: correct / n, ci95: [w.lo, w.hi] }
}

const lessonIdOf = (ref: string): string | null => (ref.startsWith('lesson:') ? ref.slice('lesson:'.length) : null)
const isOk = (e: LedgerEvent): boolean => (e as { ok?: boolean }).ok === true
const msOf = (e: LedgerEvent): number | null => {
  const ms = (e as { ms?: unknown }).ms
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null
}
/** The probe count of an incident: the array a full ledger holds, or the count a donation holds. */
const probeCountOf = (e: LedgerEvent): number => {
  const p = dataOf(e).probes
  return Array.isArray(p) ? p.length : typeof p === 'number' && Number.isFinite(p) ? p : 0
}
const kcsOf = (e: LedgerEvent): string[] => {
  const k = dataOf(e).kcs
  return Array.isArray(k) ? k.filter((x): x is string => typeof x === 'string') : []
}

/** Whole local days from a ledger's first event to its last; 0 for an empty one. */
function spanDaysOf(events: Ledger): number {
  let lo: LocalDay | null = null
  for (const e of events) if (lo === null || e.day < lo) lo = e.day
  const hi = lastDay(events)
  return lo === null || hi === null ? 0 : daysBetween(lo, hi)
}

/* ------------------------------------------------------------------ */
/* F1: selectRetention30                                               */
/* ------------------------------------------------------------------ */

export interface RetentionLearner {
  n: number
  correct: number
  spanDays: number
}

export interface Retention30 extends Proportion {
  /** Mean SLO of the plans in force, weighted by the checks each plan's learner contributed; null with no check. */
  meanSlo: number | null
  /** Partners with at least one check. */
  partners: number
  /** Ledgers left out because their span is under `minSpanDays`. */
  excluded: number
  /** One row per ledger that was counted, in input order. */
  perLearner: RetentionLearner[]
  /** Lowest, median and highest per-learner recall among partners with a check; null with none. The Wilson interval treats checks as independent, so this is its honest companion. */
  spread: { min: number; median: number; max: number } | null
}

/**
 * F1 (spec §20.1): graded Today `item` and `probe` answers on a carded KC, at least `minDays` local days after
 * the card was created, not `assisted`, and on a fresh seed when the item is generated.
 *
 * - The card is the one the replay of cards.ts gives (creation day included), as of the ledger's last day.
 * - Keep-going items (`reason: 'extra'`) are left out: they are KCs that were not due, practiced soon after their
 *   last review, so they would flatter recall against the SLO.
 * - A generated item is fresh when its `(ref, level, seed)` was not served earlier in the ledger. A donation
 *   carries no seed, so it counts every generated answer: Today draws each on a seed the learner has not met.
 * - An event counts once, however many of its KCs qualify.
 * - `minSpanDays` leaves out ledgers shorter than that (F1 asks 35 days of every contributing learner).
 */
export function selectRetention30(
  ledgers: readonly PartnerLedger[],
  content: CardsContent,
  opts: { minDays?: number; minSpanDays?: number } = {},
): Retention30 {
  const minDays = opts.minDays ?? RETENTION_MIN_DAYS
  const minSpan = opts.minSpanDays ?? 0
  const perLearner: RetentionLearner[] = []
  let n = 0
  let correct = 0
  let sloSum = 0
  let excluded = 0
  for (const l of ledgers) {
    const last = lastDay(l.events)
    if (last === null) continue
    const spanDays = spanDaysOf(l.events)
    if (spanDays < minSpan) {
      excluded += 1
      continue
    }
    const { set } = deriveCardsDetailed(l.events, content, last, l.plan, { placement: l.placement })
    const slo = l.plan?.slo ?? DEFAULT_SLO
    const seen = new Set<string>()
    let ln = 0
    let lc = 0
    for (const e of sorted(l.events)) {
      if (!isAnswer(e)) continue
      const seed = (e as { seed?: unknown }).seed
      let fresh = true
      if (e.ref.startsWith('gen:') && typeof seed === 'number') {
        const key = instanceKey(e.ref, dataOf(e).level as number | undefined, seed)
        fresh = !seen.has(key)
        seen.add(key)
      }
      if (srcOf(e) !== 'today' || dataOf(e).reason === 'extra' || (e as { provenance?: string }).provenance === 'assisted' || !fresh) continue
      const old = content.resolve(e).some((kc) => {
        const card = set.cards[kc]
        return card !== undefined && daysBetween(card.createdDay, e.day) >= minDays
      })
      if (!old) continue
      ln += 1
      if (isOk(e)) lc += 1
    }
    perLearner.push({ n: ln, correct: lc, spanDays })
    n += ln
    correct += lc
    sloSum += slo * ln
  }
  const rates = perLearner.filter((r) => r.n > 0).map((r) => r.correct / r.n)
  const ascending = [...rates].sort((a, b) => a - b)
  return {
    ...proportion(correct, n),
    meanSlo: n === 0 ? null : sloSum / n,
    partners: rates.length,
    excluded,
    perLearner,
    spread: rates.length === 0 ? null : { min: ascending[0], median: median(rates) as number, max: ascending[ascending.length - 1] },
  }
}

/* ------------------------------------------------------------------ */
/* F2: selectBootToFirstT                                              */
/* ------------------------------------------------------------------ */

export interface BootToFirstT {
  /** Partners that completed Boot. */
  booted: number
  /** Of those, partners that have visited a T lesson since: the sample. */
  n: number
  /** Days per partner in the sample, ascending. */
  days: number[]
  median: number | null
  /** How many partners took each number of days, ascending. */
  distribution: { days: number; count: number }[]
}

const T_LESSON = /^lesson:t\d+\./

/** F2 (spec §20.1): whole local days from `complete boot` to the first `visit` of a `t*` lesson after it. A partner who has not yet visited one is in `booted`, not in the sample. */
export function selectBootToFirstT(ledgers: readonly Ledger[]): BootToFirstT {
  const days: number[] = []
  let booted = 0
  for (const events of ledgers) {
    let boot: LedgerEvent | null = null
    for (const e of sorted(events)) {
      if (boot === null) {
        if (e.kind === 'complete' && e.ref === 'boot') {
          boot = e
          booted += 1
        }
      } else if (e.kind === 'visit' && T_LESSON.test(e.ref)) {
        days.push(Math.max(0, daysBetween(boot.day, e.day)))
        break
      }
    }
  }
  days.sort((a, b) => a - b)
  const counts = new Map<number, number>()
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1)
  return { booted, n: days.length, days, median: median(days), distribution: [...counts].map(([d, count]) => ({ days: d, count })) }
}

/* ------------------------------------------------------------------ */
/* F3: selectPlacementLanding                                          */
/* ------------------------------------------------------------------ */

export interface PlacementLanding {
  /** `complete placement` events across the ledgers. */
  placements: number
  /** Of those, how many were followed by a lesson visit: the sample. */
  n: number
  /** Landings on `r.l1`. */
  onR1: number
  /** Partners with a placement that has a landing, and the ones among them with a landing on `r.l1`. */
  partners: number
  partnersOnR1: number
  /** The first lesson of each landing, in input order. */
  lessons: string[]
}

/**
 * F3 (spec §20.1): for each `complete placement`, the lesson of the first `visit` after it. A learner who had
 * already touched that lesson the same day writes no visit (older clients, or a lesson reached by another
 * event first), so the first event on any `lesson:` ref after the placement counts as the landing too.
 */
export function selectPlacementLanding(ledgers: readonly Ledger[]): PlacementLanding {
  const lessons: string[] = []
  let placements = 0
  let partners = 0
  let partnersOnR1 = 0
  for (const events of ledgers) {
    const list = sorted(events)
    let landed = 0
    let r1 = 0
    list.forEach((e, i) => {
      if (e.kind !== 'complete' || e.ref !== 'placement') return
      placements += 1
      for (let j = i + 1; j < list.length; j++) {
        const id = lessonIdOf(list[j].ref)
        if (id === null) continue
        lessons.push(id)
        landed += 1
        if (id === 'r.l1') r1 += 1
        break
      }
    })
    if (landed > 0) partners += 1
    if (r1 > 0) partnersOnR1 += 1
  }
  return { placements, n: lessons.length, onR1: lessons.filter((l) => l === 'r.l1').length, partners, partnersOnR1, lessons }
}

/* ------------------------------------------------------------------ */
/* F7: selectPlacementConfirm7                                         */
/* ------------------------------------------------------------------ */

export interface PlacementConfirm7 extends Proportion {
  /** Solid placement KCs across the ledgers, confirmed or not (`n` of them have been asked). */
  solid: number
  partners: number
}

/**
 * K3 (spec §20.1): of the solid placement KCs, the share answered right at their day-7 confirmation review
 * (a Today `item` or `probe` with `reason: 'confirm'`). The first confirmation answer of a KC is the one that
 * counts; a KC not yet asked about is in `solid` but not in `n`.
 */
export function selectPlacementConfirm7(ledgers: readonly PartnerLedger[]): PlacementConfirm7 {
  let n = 0
  let correct = 0
  let solid = 0
  let partners = 0
  for (const l of ledgers) {
    const set = new Set(l.placement?.solidKcs ?? [])
    solid += set.size
    const asked = new Set<string>()
    for (const e of sorted(l.events)) {
      if (!isAnswer(e) || srcOf(e) !== 'today' || dataOf(e).reason !== 'confirm') continue
      for (const kc of kcsOf(e)) {
        if (!set.has(kc) || asked.has(kc)) continue
        asked.add(kc)
        n += 1
        if (isOk(e)) correct += 1
      }
    }
    if (asked.size > 0) partners += 1
  }
  return { ...proportion(correct, n), solid, partners }
}

/* ------------------------------------------------------------------ */
/* F5: selectTicketStats                                               */
/* ------------------------------------------------------------------ */

export interface TicketStats extends Proportion {
  /** Ticket attempts (`quiz` events of form `ticket`). */
  attempts: number
  /** Median minutes of an attempt that has a time; null with none. */
  medianMinutes: number | null
  /** Lessons with a ticket attempt. */
  tickets: number
  /** Tickets that are settled: passed within `TICKET_TRIES` tries, or tried that often. `n` counts these and `correct` the ones passed. */
  settled: number
  partners: number
}

/**
 * F5 (spec §20.1): the exit ticket's keep-or-kill numbers. An attempt is a `quiz` summary of form `ticket`
 * (its `ok` is the ticket's pass rule). Its minutes are the summary's own `ms`, else the answer times of the
 * attempt's items. A ticket is passed within two tries when one of its first two attempts is `ok`; a ticket
 * with one failed attempt is still open and in neither count.
 */
export function selectTicketStats(ledgers: readonly Ledger[]): TicketStats {
  const minutes: number[] = []
  let attempts = 0
  let tickets = 0
  let settled = 0
  let passed = 0
  let partners = 0
  for (const events of ledgers) {
    const list = sorted(events)
    const itemMs = new Map<string, number>()
    for (const e of list) {
      const grp = dataOf(e).grp
      const ms = msOf(e)
      if (e.kind === 'item' && srcOf(e) === 'ticket' && typeof grp === 'string' && ms !== null) itemMs.set(grp, (itemMs.get(grp) ?? 0) + ms)
    }
    const byLesson = new Map<string, LedgerEvent[]>()
    for (const e of list) {
      if (e.kind !== 'quiz' || dataOf(e).form !== 'ticket') continue
      const tries = byLesson.get(e.ref)
      if (tries) tries.push(e)
      else byLesson.set(e.ref, [e])
    }
    for (const tries of byLesson.values()) {
      tickets += 1
      attempts += tries.length
      for (const e of tries) {
        const grp = dataOf(e).grp
        const ms = msOf(e) ?? (typeof grp === 'string' ? (itemMs.get(grp) ?? null) : null)
        if (ms !== null && ms > 0) minutes.push(ms / 60_000)
      }
      const within = tries.slice(0, TICKET_TRIES).some(isOk)
      if (within || tries.length >= TICKET_TRIES) {
        settled += 1
        if (within) passed += 1
      }
    }
    if (byLesson.size > 0) partners += 1
  }
  return { ...proportion(passed, settled), attempts, medianMinutes: median(minutes), tickets, settled, partners }
}

/* ------------------------------------------------------------------ */
/* F4: selectTodayStats                                                */
/* ------------------------------------------------------------------ */

export interface TodayStats {
  sessions: number
  completed: number
  /** Median minutes over every session (C19's span rule; a donation counts answer time only), and over completed ones. */
  medianMinutes: number | null
  medianCompletedMinutes: number | null
  /** Partners with at least one session. */
  partners: number
}

/** F4 (spec §20.1): the median Today session, by the span rule of `selectTodaySessions`. */
export function selectTodayStats(ledgers: readonly Ledger[]): TodayStats {
  const per = ledgers.map((events) => selectTodaySessions(events))
  const all = per.flat()
  const done = all.filter((s) => s.completed)
  return {
    sessions: all.length,
    completed: done.length,
    medianMinutes: median(all.map((s) => s.spanMs / 60_000)),
    medianCompletedMinutes: median(done.map((s) => s.spanMs / 60_000)),
    partners: per.filter((s) => s.length > 0).length,
  }
}

/* ------------------------------------------------------------------ */
/* F6: selectProveRate                                                 */
/* ------------------------------------------------------------------ */

export interface ProveRate extends Proportion {
  partners: number
}

/**
 * F6 (spec §20.1): of the labs a learner got green (a lab's first `ok` `lab-check`), how many were followed by
 * a Prove-it attempt (a `prove:<lab>` event after that run). `n` counts greens and `correct` the attempted ones.
 */
export function selectProveRate(ledgers: readonly Ledger[]): ProveRate {
  let greens = 0
  let attempted = 0
  let partners = 0
  for (const events of ledgers) {
    const green = new Map<string, boolean>()
    for (const e of sorted(events)) {
      if (e.kind === 'lab-check' && isOk(e) && e.ref.startsWith('lab:')) {
        const lab = e.ref.slice('lab:'.length)
        if (!green.has(lab)) green.set(lab, false)
      } else if (e.kind === 'prove' && e.ref.startsWith('prove:')) {
        const lab = e.ref.slice('prove:'.length)
        if (green.get(lab) === false) green.set(lab, true)
      }
    }
    greens += green.size
    for (const done of green.values()) if (done) attempted += 1
    if (green.size > 0) partners += 1
  }
  return { ...proportion(attempted, greens), partners }
}

/* ------------------------------------------------------------------ */
/* selectDailyStats                                                    */
/* ------------------------------------------------------------------ */

export interface DailyStats {
  /** Dailies played: distinct `inc:daily/*` refs. */
  played: number
  /** Of those, fixed in time (the first event on the ref has `fixed`). */
  completed: number
  /** Median of burn ÷ expert burn over completed Dailies whose expert burn is above zero; null with none. */
  medianBurnRatio: number | null
  /** Zero-information probes over all probes of the Dailies played: `n` counts probes, `correct` the Streetlight ones. */
  streetlight: Proportion
  partners: number
}

/** The Fleet Daily (spec §20.1), by each Daily's first event: later events on the same date are reruns. */
export function selectDailyStats(ledgers: readonly Ledger[]): DailyStats {
  let played = 0
  let completed = 0
  let probes = 0
  let lights = 0
  let partners = 0
  const ratios: number[] = []
  for (const events of ledgers) {
    const seen = new Set<string>()
    for (const e of sorted(events)) {
      if (e.kind !== 'incident' || !e.ref.startsWith('inc:daily/') || seen.has(e.ref)) continue
      seen.add(e.ref)
      const d = dataOf(e)
      played += 1
      probes += probeCountOf(e)
      if (typeof d.streetlight === 'number') lights += d.streetlight
      if (d.fixed === true) {
        completed += 1
        if (typeof d.burn === 'number' && typeof d.expertBurn === 'number' && d.expertBurn > 0) ratios.push(d.burn / d.expertBurn)
      }
    }
    if (seen.size > 0) partners += 1
  }
  return { played, completed, medianBurnRatio: median(ratios), streetlight: proportion(Math.min(lights, probes), probes), partners }
}

/* ------------------------------------------------------------------ */
/* The field-gate table (§23.2)                                        */
/* ------------------------------------------------------------------ */

/** `insufficient` prints "not enough data" and is never a pass; `owner` is a gate the exports cannot measure. */
export type FieldStatus = 'pass' | 'fail' | 'insufficient' | 'reported' | 'owner'

export interface FieldGate {
  id: 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9'
  /** The gate's name, as §23.2 words it. */
  label: string
  status: FieldStatus
  /** The sample the verdict rests on, and how many partners contributed to it. */
  n: number
  partners: number
  /** The measurement, with its interval where it is a proportion. */
  detail: string
}

/** The keep-or-kill rules of F4 to F6 (PLAN §9) and what the default is when the data is too thin. */
export interface KeepOrKill {
  id: 'F4' | 'F5' | 'F6'
  label: string
  verdict: 'keep' | 'kill' | 'underpowered'
  /** What to do instead when `underpowered` (the spec's default). */
  fallback: string
}

export interface FieldReport {
  partners: number
  retention: Retention30
  boot: BootToFirstT
  landing: PlacementLanding
  confirm: PlacementConfirm7
  tickets: TicketStats
  today: TodayStats
  prove: ProveRate
  daily: DailyStats
  gates: FieldGate[]
  keepOrKill: KeepOrKill[]
}

const fmtPct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)} %`)
const fmtCi = (p: Proportion): string => (p.ci95 === null ? '' : `, 95 % interval ${fmtPct(p.ci95[0])} to ${fmtPct(p.ci95[1])}`)
const fmtNum = (x: number | null, unit = ''): string => (x === null ? 'n/a' : `${Number.isInteger(x) ? x : x.toFixed(1)}${unit}`)
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const thin = (n: number, partners: number): string => `not enough data (n = ${n}, ${plural(partners, 'partner')}; needs ${FIELD_MIN_PARTNERS} partners)`
const enough = (partners: number, n: number): boolean => n > 0 && partners >= FIELD_MIN_PARTNERS

/** Every selector over the partners' ledgers, then F1 to F9 and the three keep-or-kill lines. One ledger is one partner. */
export function buildFieldReport(ledgers: readonly PartnerLedger[], content: CardsContent): FieldReport {
  const events = ledgers.map((l) => l.events)
  const retention = selectRetention30(ledgers, content, { minSpanDays: RETENTION_MIN_SPAN_DAYS })
  const boot = selectBootToFirstT(events)
  const landing = selectPlacementLanding(events)
  const confirm = selectPlacementConfirm7(ledgers)
  const tickets = selectTicketStats(events)
  const today = selectTodayStats(events)
  const prove = selectProveRate(events)
  const daily = selectDailyStats(events)

  // F1: n ≥ 140 checks from ≥ 5 partners, and the interval holds the mean SLO.
  const slo = retention.meanSlo
  const f1Enough = retention.n >= RETENTION_MIN_N && retention.partners >= FIELD_MIN_PARTNERS
  const f1Within = retention.ci95 !== null && slo !== null && retention.ci95[0] <= slo && slo <= retention.ci95[1]
  const f1Side = retention.ci95 === null || slo === null ? '' : slo < retention.ci95[0] ? ', interval above the SLO' : slo > retention.ci95[1] ? ', interval below the SLO' : ''
  const spread = retention.spread ? `; per-learner recall ${fmtPct(retention.spread.min)} / ${fmtPct(retention.spread.median)} / ${fmtPct(retention.spread.max)} (low / median / high)` : ''
  const f1: FieldGate = {
    id: 'F1',
    label: '30-day recall within the SLO interval',
    status: f1Enough ? (f1Within ? 'pass' : 'fail') : 'insufficient',
    n: retention.n,
    partners: retention.partners,
    detail: f1Enough
      ? `recall ${fmtPct(retention.rate)}${fmtCi(retention)}, mean SLO ${fmtPct(slo)}${f1Side}${spread}`
      : `not enough data (n = ${retention.n} of ${RETENTION_MIN_N} checks, ${retention.partners} of ${FIELD_MIN_PARTNERS} partners${retention.excluded > 0 ? `, ${plural(retention.excluded, 'ledger')} left out for a span under ${RETENTION_MIN_SPAN_DAYS} days` : ''})`,
  }

  // F2: the median over at least five partners.
  const f2: FieldGate = {
    id: 'F2',
    label: 'Boot to first T lesson in at most 3 days',
    status: boot.n < FIELD_MIN_PARTNERS ? 'insufficient' : (boot.median as number) <= BOOT_MAX_DAYS ? 'pass' : 'fail',
    n: boot.n,
    partners: boot.n,
    detail:
      boot.n >= FIELD_MIN_PARTNERS
        ? `median ${fmtNum(boot.median, ' days')} (bar ${BOOT_MAX_DAYS}); distribution ${boot.distribution.map((d) => `${d.days}d × ${d.count}`).join(', ')}; ${boot.booted - boot.n} booted with no T lesson yet`
        : `not enough data (n = ${boot.n} ${boot.n === 1 ? 'partner' : 'partners'} with a first T lesson, ${boot.booted} booted; needs ${FIELD_MIN_PARTNERS})`,
  }

  // F3: one landing on r.l1 fails at any n; a pass needs the partner bar.
  const f3: FieldGate = {
    id: 'F3',
    label: 'nobody placed lands on R.L1',
    status: landing.onR1 > 0 ? 'fail' : landing.partners >= FIELD_MIN_PARTNERS ? 'pass' : 'insufficient',
    n: landing.n,
    partners: landing.partners,
    detail:
      landing.onR1 > 0 || landing.partners >= FIELD_MIN_PARTNERS
        ? `${landing.onR1} of ${landing.n} placements landed on r.l1 (${plural(landing.partnersOnR1, 'partner')})${fmtCi(proportion(landing.onR1, landing.n))}`
        : `not enough data (n = ${landing.n} placements with a first lesson, ${plural(landing.partners, 'partner')}; needs ${FIELD_MIN_PARTNERS}); ${landing.onR1} on r.l1 so far`,
  }

  // F4: the Today median and F1 together.
  const f4Data = enough(today.partners, today.sessions)
  const f4: FieldGate = {
    id: 'F4',
    label: 'Today keep-or-kill',
    status: !f4Data || f1.status === 'insufficient' ? 'insufficient' : (today.medianMinutes as number) <= TODAY_MAX_MINUTES && f1.status === 'pass' ? 'pass' : 'fail',
    n: today.sessions,
    partners: today.partners,
    detail: f4Data
      ? `median session ${fmtNum(today.medianMinutes, ' min')} over ${today.sessions} sessions (bar ${TODAY_MAX_MINUTES}), completed only ${fmtNum(today.medianCompletedMinutes, ' min')}; F1 ${STATUS_LABEL[f1.status]}`
      : thin(today.sessions, today.partners),
  }

  // F5: the median ticket minutes and the pass share.
  const f5Data = enough(tickets.partners, tickets.attempts)
  const f5: FieldGate = {
    id: 'F5',
    label: 'Exit-ticket keep-or-kill',
    status: !f5Data ? 'insufficient' : (tickets.medianMinutes ?? Infinity) <= TICKET_MAX_MINUTES && (tickets.rate ?? 0) >= TICKET_MIN_PASS ? 'pass' : 'fail',
    n: tickets.attempts,
    partners: tickets.partners,
    detail: f5Data
      ? `median ${fmtNum(tickets.medianMinutes, ' min')} (bar ${TICKET_MAX_MINUTES}); ${tickets.correct} of ${tickets.settled} settled tickets passed within ${TICKET_TRIES} tries = ${fmtPct(tickets.rate)}${fmtCi(tickets)} (bar ${TICKET_MIN_PASS * 100} %)`
      : thin(tickets.attempts, tickets.partners),
  }

  // F6
  const f6Data = enough(prove.partners, prove.n)
  const f6: FieldGate = {
    id: 'F6',
    label: 'Prove-it keep-or-kill',
    status: !f6Data ? 'insufficient' : (prove.rate ?? 0) >= PROVE_MIN_RATE ? 'pass' : 'fail',
    n: prove.n,
    partners: prove.partners,
    detail: f6Data
      ? `${prove.correct} of ${prove.n} lab greens followed by a Prove-it attempt = ${fmtPct(prove.rate)}${fmtCi(prove)} (bar ${PROVE_MIN_RATE * 100} %)`
      : thin(prove.n, prove.partners),
  }

  // F7: reported, not gated.
  const f7Data = enough(confirm.partners, confirm.n)
  const f7: FieldGate = {
    id: 'F7',
    label: 'K3: placements confirmed at day 7 (reported)',
    status: f7Data ? 'reported' : 'insufficient',
    n: confirm.n,
    partners: confirm.partners,
    detail: f7Data
      ? `${confirm.correct} of ${confirm.n} solid KCs right at their confirmation = ${fmtPct(confirm.rate)}${fmtCi(confirm)} (target ${CONFIRM7_MIN_RATE * 100} %; ${confirm.solid} solid KCs placed)`
      : thin(confirm.n, confirm.partners),
  }

  const f8: FieldGate = { id: 'F8', label: "queue gating: Wave 2's review queue under 10 h", status: 'owner', n: 0, partners: 0, detail: 'the owner sums the open Wave 2 tasks; exports cannot measure it' }
  const f9: FieldGate = { id: 'F9', label: 'accessibility: VoiceOver and NVDA passes', status: 'owner', n: 0, partners: 0, detail: 'the owner records them; exports cannot measure them' }

  const verdict = (g: FieldGate): KeepOrKill['verdict'] => (g.status === 'insufficient' ? 'underpowered' : g.status === 'pass' ? 'keep' : 'kill')
  const keepOrKill: KeepOrKill[] = [
    { id: 'F4', label: 'Today', verdict: verdict(f4), fallback: 'fewer new cards, SLO 0.85' },
    { id: 'F5', label: 'exit ticket', verdict: verdict(f5), fallback: '2 items' },
    { id: 'F6', label: 'Prove-it', verdict: verdict(f6), fallback: '1 question' },
  ]

  return { partners: ledgers.length, retention, boot, landing, confirm, tickets, today, prove, daily, gates: [f1, f2, f3, f4, f5, f6, f7, f8, f9], keepOrKill }
}

const STATUS_LABEL: Record<FieldStatus, string> = { pass: 'PASS', fail: 'FAIL', insufficient: 'NOT ENOUGH DATA', reported: 'REPORTED', owner: 'OWNER' }

/** The report as text: the field-gate table, the keep-or-kill lines and the Fleet Daily. */
export function formatFieldReport(r: FieldReport): string {
  const d = r.daily
  const lines = [
    `Wave 2 field gates over ${plural(r.partners, 'export')} (one per partner; day offsets only, no calendar dates)`,
    '',
    ...r.gates.flatMap((g) => [
      `${g.id}  ${g.label} → ${STATUS_LABEL[g.status]}`,
      `      ${g.status === 'owner' || g.status === 'insufficient' ? '' : `n = ${g.n}, ${plural(g.partners, 'partner')}: `}${g.detail}`,
    ]),
    '',
    'keep-or-kill',
    ...r.keepOrKill.map((k) => `  ${k.label}: ${k.verdict === 'underpowered' ? `UNDERPOWERED, default: ${k.fallback}` : k.verdict.toUpperCase()}`),
    '',
    d.played === 0
      ? 'Fleet Daily: not enough data (n = 0 Dailies)'
      : `Fleet Daily: ${d.completed} of ${d.played} completed (${plural(d.partners, 'partner')}), median burn ÷ expert burn ${fmtNum(d.medianBurnRatio)}, Streetlight ${d.streetlight.correct} of ${d.streetlight.n} probes = ${fmtPct(d.streetlight.rate)}${fmtCi(d.streetlight)}`,
  ]
  return lines.join('\n')
}
