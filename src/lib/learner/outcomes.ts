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
 *
 * Wave 3 (docs/specs/wave-3.md §15, §18.2, task 3c-03) adds, at the end, the selectors of §15.1 (`selectSurfaceMinutes`
 * … `selectReceiptStats`), the pre-registered rules they decide under (docs/prereg/hint-ladders.md, fleet-daily.md) and
 * the F1 to F12 table (`buildWave3Report`). Wave 2's F1 to F9 are a different list and stay (`buildFieldReport`).
 */

import { SYSTEMS_FORGE_LABS } from '@/data/labs'
import { KCS } from '@/data/kc'
import { KC } from '@/data/kc/ids'
import type { Kc } from '@/lib/kc/types'
import { RUBRIC_KEYS } from '@/lib/ledger/constants'
import { compareEvents } from '@/lib/ledger/merge'
import { parseHintRef } from '@/lib/ledger/refs'
import { dayOf } from '@/lib/ledger/time'
import type { IsoInstant, LedgerEvent, LocalDay, WorkingKey, WorkingRecord } from '@/lib/ledger/types'
import { hash32, splitmix32 } from '@/lib/rng'
import { wilson } from './calibration'
import { DEFAULT_SLO, deriveCardsDetailed, type CardsContent, type CardsExtra, type CardsPlan, type FirstReview } from './cards'
import { RANDOMIZED_LABS } from './experiments'
import { FORM_SLOTS, type FormId } from './forms'
import { weekStartOf } from './planner'
import { proportionOf, type Proportion } from './proportion'
import { daysBetween } from './reentry'
import { instanceKey, sessionSpanMs } from './today'
import type { FirstReviewCalibration } from './types'
import { selectVrk30 } from './vrk'

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

/** A count with its Wilson 95 % interval (proportion.ts, which vrk.ts and forms.ts share with this file). */
export type { Proportion }
const proportion = proportionOf

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
  /** F1 to F9 are Wave 2's gates (§23.2), F1 to F12 Wave 3's (wave-3.md §18.2): two tables, one row type. */
  id: 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9' | 'F10' | 'F11' | 'F12'
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
  id: 'F2' | 'F3' | 'F4' | 'F5' | 'F6'
  label: string
  /** `unsigned`: the rule is pre-registered and the owner has not signed it, so the data is not read (Wave 3's F2 and F3). */
  verdict: 'keep' | 'kill' | 'underpowered' | 'unsigned'
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

// 'NOT MET', not 'FAIL': a bar not met sends the feature to its pre-registered default (F4's drop, F5's one question), which is a
// decision, not a defect.
const STATUS_LABEL: Record<FieldStatus, string> = { pass: 'PASS', fail: 'NOT MET', insufficient: 'NOT ENOUGH DATA', reported: 'REPORTED', owner: 'OWNER' }

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

/* ================================================================== */
/* Wave 3 field gates (docs/specs/wave-3.md §15, §18.2; task 3c-03)    */
/* ================================================================== */

/*
 * The gates F1 to F12 of §18.2 are a different list from Wave 2's F1 to F9 above (`buildFieldReport`), which stays for
 * `--wave2`. Nothing here is a pass without its n and its partners: below a gate's minimum the table prints "not enough
 * data", and a gate that reads a pre-registration is not read until the owner has signed it (§18.2 F2 and F3, PLAN §9).
 */

/** Bootstrap resamples (docs/prereg/hint-ladders.md §4: 10,000 over learners). */
export const BOOTSTRAP_RESAMPLES = 10_000
/** F2: the non-inferiority margin, in accuracy (5 points), and the learners the pre-registration's power calculation needs. */
export const HINT_MARGIN = 0.05
export const HINT_MIN_LEARNERS = 126
/**
 * F2: a cold check counts 25 to 45 days after the lab's first all-green run (its first `lab-check` with `ok`), for every
 * ledger, as the owner signed it (docs/prereg/hint-ladders.md §3 and §7): a donation keeps no per-check detail, so the
 * lab's run is the anchor every ledger can show, and the arms, randomized per check within a lab, share it alike.
 */
export const HINT_WINDOW_DAYS: readonly [number, number] = [25, 45]
/** F3: the margin, the learners with an eligible check in both groups that the power calculation needs (docs/prereg/fleet-daily.md §4), and the age of a check. */
export const DAILY_MARGIN = 0.05
export const DAILY_MIN_LEARNERS = 197
export const DAILY_MIN_DAYS = 30
/** F6: P3's three KCs (§15.1), the checks and the misses a reading needs, and the age of a check. */
export const DISCRIMINATION_KCS: readonly string[] = ['t2.address-translation', 't5.block-tables', 't5.prefix-cache-keys']
export const DISCRIMINATION_MIN_DAYS = 30
export const DISCRIMINATION_MIN_N = 30
export const DISCRIMINATION_MIN_MISSES = 10
/** F7: answers a reading needs, and the age of an answer after a learner's cube play. */
export const CUBE_MIN_N = 30
export const CUBE_MIN_DAYS = 30
/** F8: K5's bar, C ÷ B at least 0.8, and the learners with both forms a track needs. */
export const FORMS_MIN_RATIO = 0.8
export const FORMS_MIN_LEARNERS = FIELD_MIN_PARTNERS
/** F1 and F9 and F10: partners a descriptive row needs. */
export const SURFACE_MIN_PARTNERS = FIELD_MIN_PARTNERS
/** PLAN §4.D: "~4 h/week". */
export const PLANNED_WEEKLY_MINUTES = 240

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

/**
 * `resamples` statistics of `items` resampled with replacement (a bootstrap over whatever the items are: learners,
 * partners), ascending. `stat` may return null for a resample it cannot compute. Seeded, so a report is reproducible.
 */
export function bootstrapDraws<T>(items: readonly T[], stat: (sample: readonly T[]) => number | null, seed: number, resamples = BOOTSTRAP_RESAMPLES): number[] {
  const out: number[] = []
  if (items.length === 0) return out
  const next = splitmix32(seed)
  const sample: T[] = new Array<T>(items.length)
  for (let r = 0; r < resamples; r++) {
    for (let i = 0; i < items.length; i++) sample[i] = items[Math.floor(next() * items.length)]
    const v = stat(sample)
    if (v !== null && Number.isFinite(v)) out.push(v)
  }
  return out.sort((a, b) => a - b)
}

/** The `p`-quantile (0 to 1) of an ascending list, by linear interpolation; null for an empty list. */
export function percentile(ascending: readonly number[], p: number): number | null {
  if (ascending.length === 0) return null
  const at = (ascending.length - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return ascending[lo] + (ascending[hi] - ascending[lo]) * (at - lo)
}

const meanOf = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length)

/** The two-sided 95 % percentile interval of bootstrap draws. */
function interval95(draws: readonly number[]): [number, number] | null {
  const lo = percentile(draws, 0.025)
  const hi = percentile(draws, 0.975)
  return lo === null || hi === null ? null : [lo, hi]
}

/** A mean over learners with its bootstrap bounds: `lower` and `upper` are one-sided 97.5 % bounds, `ci95` the two-sided interval. */
export interface MeanDifference {
  n: number
  mean: number | null
  lower: number | null
  upper: number | null
  ci95: [number, number] | null
}

function meanDifference(values: readonly number[], seed: number): MeanDifference {
  if (values.length === 0) return { n: 0, mean: null, lower: null, upper: null, ci95: null }
  const draws = bootstrapDraws(values, meanOf, seed)
  return { n: values.length, mean: meanOf(values), lower: percentile(draws, 0.025), upper: percentile(draws, 0.975), ci95: interval95(draws) }
}

const spreadOf = (xs: readonly number[]): { min: number; q1: number; median: number; q3: number; max: number } | null => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length === 0 ? null : { min: s[0], q1: percentile(s, 0.25) as number, median: percentile(s, 0.5) as number, q3: percentile(s, 0.75) as number, max: s[s.length - 1] }
}

const isAssisted = (e: LedgerEvent): boolean => (e as { provenance?: string }).provenance === 'assisted'
const provenanceOf = (e: LedgerEvent): string | undefined => (e as { provenance?: string }).provenance
/** A graded answer: an `item` or `probe` with an `ok` verdict. */
const isGradedAnswer = (e: LedgerEvent): boolean => isAnswer(e) && typeof (e as { ok?: unknown }).ok === 'boolean'

/** Every selector below reads the cards of a ledger as of its last day, as `selectRetention30` does. */
function cardsOf(l: PartnerLedger, content: CardsContent) {
  const last = lastDay(l.events)
  return last === null ? null : deriveCardsDetailed(l.events, content, last, l.plan, { placement: l.placement }).set.cards
}

/* ------------------------------------------------------------------ */
/* F1: selectSurfaceMinutes (the journey re-cut, D22)                  */
/* ------------------------------------------------------------------ */

export const SURFACES = ['today', 'lessons', 'plays', 'labs', 'daily', 'fleet-week', 'me'] as const
export type Surface = (typeof SURFACES)[number]

/**
 * The surface an event's time belongs to, or null for time the table leaves out (Boot, the placement walk, the Capstone).
 *
 * - **today**: Today sessions and the empty state's "new numbers" (`src` `today`, or `practice` on a generated item);
 * - **lessons**: every other answered item (quizzes, tickets, prequestions, diagrams, item blocks, cold checks, change
 *   cards), the `quiz` summary of a lesson quiz or ticket, sim tasks and lesson exercises. A lesson QuizBlock's items carry
 *   no `ms` and its summary holds the attempt's time (`recordQuizAttempt`), while a ticket's items carry their own and its
 *   summary repeats their sum (`recordTicket`), so `weeklyMs` counts a summary only when no item of its attempt has time;
 * - **plays**: `play` events and items made inside a play;
 * - **labs**: `lab-check` and `prove`;
 * - **daily**: the Fleet Daily's `incident` event, whose `ms` is the attempt's visible time from the alert to the debrief
 *   (`dailyResult`), and team incidents. An item with `src` `daily` would count here too, but no surface writes one;
 * - **fleet-week**: Fleet Week acts, engine runs and Act IV's drills: a run's `ms` is its visible wall time
 *   (`fleetRunFor`), a drill's its alert to its debrief (`drillResult`), and an act's the page's visible time that no
 *   run or drill of the visit holds, up to the pass (`completeFleetWeekAct`), so the act never counts a run's or a
 *   drill's second again. A run and a drill can overlap, though: an Act I or II run started during a drill is in both
 *   `ms`, because each claims its own visible time, and that rare overlap counts twice (`SURFACE_FOOTNOTE` says so);
 * - **me**: the track forms, which /me runs.
 *
 * Daily and Fleet Week time counts only while the page is visible, and each event is capped (`INCIDENT_MAX_MS`,
 * `FLEET_RUN_MAX_MS`, `FLEET_ACT_MAX_MS`), so a tab left open does not log hours. Events written before EF1 carry no
 * `ms` there and add none.
 */
export function surfaceOf(e: LedgerEvent): Surface | null {
  const src = srcOf(e)
  switch (e.kind) {
    case 'item':
    case 'probe':
    case 'predict':
      if (src === 'today') return 'today'
      if (src === 'practice') return e.ref.startsWith('gen:') ? 'today' : null
      if (src === 'daily') return 'daily'
      if (src === 'form') return 'me'
      if (src === 'play') return 'plays'
      if (src === 'boot' || src === 'placement') return null
      return 'lessons'
    case 'quiz':
    case 'sim-task':
    case 'exercise':
      return 'lessons'
    case 'play':
      return 'plays'
    case 'lab-check':
    case 'prove':
      return 'labs'
    case 'incident':
      return e.ref.startsWith('inc:drill/') ? 'fleet-week' : 'daily'
    case 'fleet-run':
    case 'fleet-act':
      return 'fleet-week'
    default:
      return null
  }
}

/** One row of PLAN §4.D's cadence table: the journey weeks it covers and the surfaces its "Surfaces" and "Features" columns name. */
export interface CadenceRow {
  /** First and last journey week (1-based, from the partner's first event). */
  weeks: readonly [number, number]
  /** §4.D's text. */
  planned: string
  /** The surfaces that text names. */
  surfaces: readonly Surface[]
}

/** PLAN §4.D, as written at Wave 3: the owner re-cuts it from the table this report prints beside it. */
export const CADENCE: readonly CadenceRow[] = [
  { weeks: [1, 1], planned: 'Boot → Today; R.L1 ⇄ T0.L1', surfaces: ['today', 'lessons'] },
  { weeks: [2, 3], planned: 'R.L2–3 ⇄ T0.L2–4; compile bank', surfaces: ['lessons', 'today'] },
  { weeks: [4, 5], planned: 'T1.L1–4; placement play', surfaces: ['lessons', 'plays'] },
  { weeks: [6, 7], planned: 'lab 01 stages', surfaces: ['labs'] },
  { weeks: [8, 11], planned: 'T2; lab 04; R.L7–10', surfaces: ['lessons', 'labs'] },
  { weeks: [12, 15], planned: 'T3, lab 05; T4 (Tiling Cube)', surfaces: ['lessons', 'labs', 'plays'] },
  { weeks: [16, 19], planned: 'T5.L1–7; Capstone Zero; lab 06', surfaces: ['lessons', 'labs'] },
  { weeks: [20, 23], planned: 'T5.L8–10, T6; labs 02, 03, 07, 08; Daily', surfaces: ['lessons', 'labs', 'daily'] },
  { weeks: [24, 26], planned: 'T7; Fleet Week on own components', surfaces: ['lessons', 'fleet-week'] },
]

type SurfaceRecord = Record<Surface, number>
const zeroSurfaces = (): SurfaceRecord => ({ today: 0, lessons: 0, plays: 0, labs: 0, daily: 0, 'fleet-week': 0, me: 0 })

/**
 * Milliseconds per calendar week (Monday's local day) and surface for one ledger. A Today session is its span by C19's
 * rule (`sessionSpanMs`: the last item's `at` minus the first item's `at`, plus the last item's `ms`), counted on the day
 * of its first item; any other time is the sum of its events' `ms`, which a donation rounds to seconds. An event with no
 * `ms` adds none, and a `quiz` summary adds none when an answer of its attempt (the same `grp`) has its own, so a ticket's
 * time is counted once and a lesson quiz's, which only its summary holds, is counted.
 */
function weeklyMs(events: Ledger): Map<LocalDay, SurfaceRecord> {
  const weeks = new Map<LocalDay, SurfaceRecord>()
  const timedAttempts = new Set<string>()
  for (const e of events) {
    const grp = dataOf(e).grp
    if (isAnswer(e) && msOf(e) !== null && typeof grp === 'string' && grp !== '') timedAttempts.add(grp)
  }
  const add = (day: LocalDay, surface: Surface, ms: number) => {
    const week = weekStartOf(day)
    const row = weeks.get(week) ?? zeroSurfaces()
    row[surface] += ms
    weeks.set(week, row)
  }
  const sessions = new Map<string, LedgerEvent[]>()
  for (const e of sorted(events)) {
    const surface = surfaceOf(e)
    if (surface === null) continue
    const grp = dataOf(e).grp
    if (surface === 'today' && srcOf(e) === 'today' && isAnswer(e) && typeof grp === 'string' && grp !== '') {
      const list = sessions.get(grp)
      if (list) list.push(e)
      else sessions.set(grp, [e])
      continue
    }
    if (e.kind === 'quiz' && typeof grp === 'string' && timedAttempts.has(grp)) continue
    const ms = msOf(e)
    if (ms !== null) add(e.day, surface, ms)
  }
  for (const [grp, items] of sessions) {
    const span = sessionSpanMs(items, grp)
    if (span !== null && Number.isFinite(span) && span > 0) add(items[0].day, 'today', span)
  }
  return weeks
}

export interface SurfaceStat {
  /** Median over the partners with any time on the surface or not: every partner with time counts, a surface they never used is 0. */
  median: number | null
  ci95: [number, number] | null
  /** Partners who spent any time on it. */
  partners: number
}

export interface SurfaceStage {
  row: CadenceRow
  /** Partners with an active week in the row's journey weeks. */
  partners: number
  /** Median over those partners of their minutes per active week in those weeks, by surface; null with none. */
  medians: SurfaceRecord | null
}

export interface SurfaceMinutes {
  /** Partners with any recorded time. */
  partners: number
  plannedWeeklyMinutes: number
  total: SurfaceStat
  surfaces: Record<Surface, SurfaceStat>
  stages: SurfaceStage[]
}

/**
 * F1 / D22: active minutes per surface per week. A partner's week is *active* when it holds any recorded time; their
 * minutes per week on a surface are their total there over their active weeks (a surface they never opened counts 0).
 * Across partners the table gives the median with a bootstrap interval over partners. Each stage row of PLAN §4.D then
 * reads the partners' own journey weeks (week 1 is the week of their first event) in that row's range, so the owner can
 * set what partners did in weeks 4 to 5 beside what the row planned.
 */
export function selectSurfaceMinutes(ledgers: readonly Ledger[]): SurfaceMinutes {
  interface Partner {
    perWeek: SurfaceRecord
    total: number
    byJourneyWeek: Map<number, SurfaceRecord>
  }
  const partners: Partner[] = []
  for (const events of ledgers) {
    const weeks = weeklyMs(events)
    const active = [...weeks].filter(([, r]) => SURFACES.some((s) => r[s] > 0))
    if (active.length === 0) continue
    const first = events.reduce<LocalDay | null>((m, e) => (m === null || e.day < m ? e.day : m), null) as LocalDay
    const firstWeek = weekStartOf(first)
    const sum = zeroSurfaces()
    const byJourneyWeek = new Map<number, SurfaceRecord>()
    for (const [week, r] of active) {
      for (const s of SURFACES) sum[s] += r[s]
      byJourneyWeek.set(Math.floor(daysBetween(firstWeek, week) / 7) + 1, r)
    }
    const perWeek = zeroSurfaces()
    for (const s of SURFACES) perWeek[s] = sum[s] / active.length / 60_000
    partners.push({ perWeek, total: SURFACES.reduce((n, s) => n + perWeek[s], 0), byJourneyWeek })
  }
  const stat = (values: readonly number[], seed: number): SurfaceStat => ({
    median: median(values),
    ci95: interval95(bootstrapDraws(values, median, seed)),
    partners: values.filter((v) => v > 0).length,
  })
  const surfaces = {} as Record<Surface, SurfaceStat>
  for (const s of SURFACES) surfaces[s] = stat(partners.map((p) => p.perWeek[s]), hash32(`surface:${s}`))
  const stages = CADENCE.map((row): SurfaceStage => {
    const inRow = partners.flatMap((p) => {
      const weeks = [...p.byJourneyWeek].filter(([w]) => w >= row.weeks[0] && w <= row.weeks[1]).map(([, r]) => r)
      if (weeks.length === 0) return []
      const mean = zeroSurfaces()
      for (const s of SURFACES) mean[s] = weeks.reduce((n, r) => n + r[s], 0) / weeks.length / 60_000
      return [mean]
    })
    if (inRow.length === 0) return { row, partners: 0, medians: null }
    const medians = zeroSurfaces()
    for (const s of SURFACES) medians[s] = median(inRow.map((r) => r[s])) as number
    return { row, partners: inRow.length, medians }
  })
  return { partners: partners.length, plannedWeeklyMinutes: PLANNED_WEEKLY_MINUTES, total: stat(partners.map((p) => p.total), hash32('surface:total')), surfaces, stages }
}

/* ------------------------------------------------------------------ */
/* F2: selectHintArms                                                  */
/* ------------------------------------------------------------------ */

export interface HintArms {
  /** Learners with an analysable check in each arm: the sample of the decision. */
  learners: number
  /** Learners with any analysable check. */
  partners: number
  /** Analysable checks (a check asked for help, one recorded arm, a cold check 25 to 45 days after its lab's first all-green run). */
  checks: { ladder: number; packet: number }
  /** Checks with both arms recorded (dropped, prereg §2) and checks helped by an ack with no arm (excluded, prereg §6.3). */
  both: number
  unarmed: number
  /** The learner-level mean of ladder − packet accuracy, in [−1, 1], with its one-sided 97.5 % bootstrap bounds (10,000 resamples over learners). */
  diff: MeanDifference
  required: number
  /**
   * docs/prereg/hint-ladders.md §4, the whole rule: `keep` when the lower bound is above −5 points and the upper bound is
   * not below 0; `cut` (R0 to R2 only) when the lower bound is not above −5 points (`because: 'margin'`) or the upper bound
   * is below 0, the packet arm clearly better (`because: 'packet-better'`); `underpowered` with fewer learners than
   * `required` (the same default as a cut).
   */
  verdict: 'keep' | 'cut' | 'underpowered'
  /** Why a `cut` is one: the margin is not met, or (with the margin met) the packet arm is clearly better. Null otherwise. */
  because: 'margin' | 'packet-better' | null
}

/**
 * The pre-registered decision on a powered difference (docs/prereg/hint-ladders.md §4): keep the ladder if the one-sided
 * 97.5 % lower bound of d is above −`HINT_MARGIN`; cut it to R0 to R2 if it is not, and also if the upper bound is below 0
 * ("the packet arm is clearly better"), which can happen with the margin met: 18 of 600 learners at d = −1 and the rest at 0
 * give d = −3 points with bounds −4.3 and −1.7 (outcomes.test.ts).
 */
export function hintVerdict(diff: MeanDifference, required = HINT_MIN_LEARNERS): Pick<HintArms, 'verdict' | 'because'> {
  if (diff.n < required || diff.lower === null || diff.upper === null) return { verdict: 'underpowered', because: null }
  if (diff.lower <= -HINT_MARGIN) return { verdict: 'cut', because: 'margin' }
  if (diff.upper < 0) return { verdict: 'cut', because: 'packet-better' }
  return { verdict: 'keep', because: null }
}

/**
 * H3's keep-or-kill, as `docs/prereg/hint-ladders.md` pre-registers it: for each check of the randomized labs that the
 * learner asked help on, the arm recorded on its `hint:` and `packet:` acks; the outcome is the learner's first cold check
 * (a generated `probe`) on the check's generator-covered KCs 25 to 45 days after the lab's first all-green run (its first
 * `lab-check` with `ok`); the unit is the learner, d = mean(ladder checks) − mean(packet checks). The window starts at the
 * lab's run for every ledger, a full export's per-check detail included, as the signed pre-registration says (§3): a
 * check that passed in an earlier red run, or only in a later one, still counts from the lab's first all-green run, so a
 * full export and its donation read the same.
 */
export function selectHintArms(
  ledgers: readonly PartnerLedger[],
  content: CardsContent,
  opts: { labs?: typeof SYSTEMS_FORGE_LABS; kcs?: readonly Kc[] } = {},
): HintArms {
  const labs = (opts.labs ?? SYSTEMS_FORGE_LABS).filter((l) => RANDOMIZED_LABS.includes(l.id))
  const covered = new Set((opts.kcs ?? KCS).filter((k) => (k.gen?.length ?? 0) > 0).map((k) => k.id))
  const ds: number[] = []
  let partners = 0
  let both = 0
  let unarmed = 0
  const checks = { ladder: 0, packet: 0 }
  for (const l of ledgers) {
    const list = sorted(l.events)
    const arms = new Map<string, Set<string>>()
    const noArm = new Set<string>()
    const labGreen = new Map<string, LocalDay>()
    for (const e of list) {
      if (e.kind === 'ack') {
        const hint = parseHintRef(e.ref)
        const packet = e.ref.startsWith('packet:lab/') ? e.ref.slice('packet:lab/'.length).split('/') : null
        const key = hint ? `${hint.labId}/${hint.checkId}` : packet && packet.length === 2 ? `${packet[0]}/${packet[1]}` : null
        if (key === null) continue
        const arm = dataOf(e).arm
        if (arm === 'ladder' || arm === 'packet') arms.set(key, (arms.get(key) ?? new Set()).add(arm))
        else noArm.add(key)
      } else if (e.kind === 'lab-check' && e.ref.startsWith('lab:')) {
        const lab = e.ref.slice('lab:'.length)
        if (isOk(e) && !labGreen.has(lab)) labGreen.set(lab, e.day)
      }
    }
    const outcomes: Record<'ladder' | 'packet', number[]> = { ladder: [], packet: [] }
    for (const lab of labs) {
      for (const check of lab.checks) {
        const key = `${lab.id}/${check.id}`
        const recorded = arms.get(key)
        if (recorded === undefined && !noArm.has(key)) continue
        if (noArm.has(key)) {
          unarmed += 1
          continue
        }
        if ((recorded as Set<string>).size > 1) {
          both += 1
          continue
        }
        const green = labGreen.get(lab.id)
        const wanted = new Set((check.kcs ?? []).filter((kc) => covered.has(kc)))
        if (green === undefined || wanted.size === 0) continue
        const cold = list.find((e) => {
          if (e.kind !== 'probe' || !e.ref.startsWith('gen:') || !isGradedAnswer(e) || isAssisted(e)) return false
          const gap = daysBetween(green, e.day)
          return gap >= HINT_WINDOW_DAYS[0] && gap <= HINT_WINDOW_DAYS[1] && content.resolve(e).some((kc) => wanted.has(kc))
        })
        if (cold === undefined) continue
        const arm = [...(recorded as Set<string>)][0] as 'ladder' | 'packet'
        outcomes[arm].push(isOk(cold) ? 1 : 0)
        checks[arm] += 1
      }
    }
    if (outcomes.ladder.length + outcomes.packet.length > 0) partners += 1
    if (outcomes.ladder.length > 0 && outcomes.packet.length > 0) ds.push((meanOf(outcomes.ladder) as number) - (meanOf(outcomes.packet) as number))
  }
  const diff = meanDifference(ds, hash32('hint-ladders'))
  return { learners: diff.n, partners, checks, both, unarmed, diff, required: HINT_MIN_LEARNERS, ...hintVerdict(diff) }
}

/* ------------------------------------------------------------------ */
/* F3: selectDailyVsOther                                              */
/* ------------------------------------------------------------------ */

export interface DailyVsOther {
  /** Learners with an eligible check in both groups: the sample of the decision. */
  learners: number
  /** Learners with any eligible check. */
  partners: number
  /** Eligible checks of KCs the learner had met in a Daily, and of those they had not. */
  daily: Proportion
  other: Proportion
  /** The learner-level mean of daily − other accuracy, with its one-sided 97.5 % bootstrap bounds (10,000 resamples over learners). */
  diff: MeanDifference
  required: number
  /** `keep`: enough learners and the one-sided 97.5 % lower bound above −5 points. `kill`: enough learners and it is not (weekly, no On-Call). `underpowered`: too few learners (the same default). */
  verdict: 'keep' | 'kill' | 'underpowered'
}

/**
 * The Fleet Daily's keep-or-kill (PLAN §9), under `docs/prereg/fleet-daily.md` and read only after the owner signs it
 * (`buildWave3Report` does not call it before). An eligible check is a graded `sig`-family answer on an unseen seed
 * (provenance `unseen`, not assisted) on a KC the signature items serve other than the diagnosis skill itself, at least
 * `DAILY_MIN_DAYS` local days after that KC's card was created. It is a *Daily* check when the learner had played a Daily
 * that trained the KC (an `inc:daily/` event carrying it in `kcs`) before the answer, and an *other* check otherwise. The
 * skill `t7.incident-diagnosis` is in every Daily, so it has no contrast and is left out.
 */
export function selectDailyVsOther(ledgers: readonly PartnerLedger[], content: CardsContent): DailyVsOther {
  const sig = new Set(content.kcs.filter((k) => k.gen?.includes('sig') && k.id !== KC.incidentDiagnosis).map((k) => k.id))
  const counts = { daily: { n: 0, correct: 0 }, other: { n: 0, correct: 0 } }
  const ds: number[] = []
  let partners = 0
  for (const l of ledgers) {
    const cards = cardsOf(l, content)
    if (cards === null) continue
    const met = new Set<string>()
    const mine = { daily: { n: 0, correct: 0 }, other: { n: 0, correct: 0 } }
    for (const e of sorted(l.events)) {
      if (e.kind === 'incident' && e.ref.startsWith('inc:daily/')) {
        for (const kc of kcsOf(e)) met.add(kc)
        continue
      }
      if (!isGradedAnswer(e) || !e.ref.startsWith('gen:sig/') || provenanceOf(e) !== 'unseen') continue
      for (const kc of content.resolve(e)) {
        const card = Object.hasOwn(cards, kc) ? cards[kc] : undefined
        if (!sig.has(kc) || !card || daysBetween(card.createdDay, e.day) < DAILY_MIN_DAYS) continue
        const group = met.has(kc) ? mine.daily : mine.other
        group.n += 1
        if (isOk(e)) group.correct += 1
      }
    }
    for (const g of ['daily', 'other'] as const) {
      counts[g].n += mine[g].n
      counts[g].correct += mine[g].correct
    }
    if (mine.daily.n + mine.other.n > 0) partners += 1
    if (mine.daily.n > 0 && mine.other.n > 0) ds.push(mine.daily.correct / mine.daily.n - mine.other.correct / mine.other.n)
  }
  const diff = meanDifference(ds, hash32('fleet-daily'))
  const verdict: DailyVsOther['verdict'] = diff.n < DAILY_MIN_LEARNERS ? 'underpowered' : (diff.lower as number) > -DAILY_MARGIN ? 'keep' : 'kill'
  return { learners: diff.n, partners, daily: proportion(counts.daily.correct, counts.daily.n), other: proportion(counts.other.correct, counts.other.n), diff, required: DAILY_MIN_LEARNERS, verdict }
}

/* ------------------------------------------------------------------ */
/* F5: selectProveV2 and F10: selectProvedInUse                        */
/* ------------------------------------------------------------------ */

const isProveV2 = (e: LedgerEvent): boolean => {
  const d = dataOf(e)
  return d.v === 2 || typeof d.qid === 'string'
}

export interface ProveV2 {
  /** `n` unseen-seed greens on labs with a v2 bundle, `correct` of them followed by a v2 attempt (H4's bar: 60 %). */
  attempted: Proportion & { partners: number }
  /** `n` first v2 attempts after such a green, `correct` of them `proved`. */
  proved: Proportion
  /** v2 attempts in all, retries included. */
  attempts: number
}

/**
 * H4's keep-or-kill and `proved` (§15.1): of the labs with a Prove-it v2 bundle (`v2Labs`) that a learner turned green on
 * an unseen seed (their first `ok` `lab-check` of provenance `unseen`), how many were followed by a v2 attempt (a `prove`
 * event with `v: 2`, or with a `qid`, which a donation keeps instead), and how many of the first attempts were `proved`.
 */
export function selectProveV2(ledgers: readonly Ledger[], v2Labs: ReadonlySet<string>): ProveV2 {
  let greens = 0
  let attempted = 0
  let first = 0
  let proved = 0
  let attempts = 0
  let partners = 0
  for (const events of ledgers) {
    const green = new Map<string, boolean>()
    for (const e of sorted(events)) {
      if (e.kind === 'lab-check' && e.ref.startsWith('lab:') && isOk(e) && provenanceOf(e) === 'unseen') {
        const lab = e.ref.slice('lab:'.length)
        if (v2Labs.has(lab) && !green.has(lab)) green.set(lab, false)
      } else if (e.kind === 'prove' && e.ref.startsWith('prove:') && isProveV2(e)) {
        const lab = e.ref.slice('prove:'.length)
        if (!green.has(lab)) continue
        attempts += 1
        if (green.get(lab) === false) {
          green.set(lab, true)
          first += 1
          if (isOk(e) && provenanceOf(e) === 'proved') proved += 1
        }
      }
    }
    greens += green.size
    for (const done of green.values()) if (done) attempted += 1
    if (green.size > 0) partners += 1
  }
  return { attempted: { ...proportion(attempted, greens), partners }, proved: proportion(proved, first), attempts }
}

/**
 * F5's keep-or-kill, the owner's rule for H4's "at least 60 % of greens attempted" (§18.2 F5): keep Prove-it v2 only when
 * the lower bound of the attempted share's Wilson 95 % interval is at least `PROVE_MIN_RATE`, so a share of 0.70 keeps it
 * at n = 200 (lower bound 63.3 %) and not at n = 10 (39.7 %). Anything else, a share below the bar or one too thin to
 * show it, gets the underpowered default, one question (PLAN §9). The same five partners as every gate are needed first.
 */
export function proveV2Verdict(attempted: ProveV2['attempted']): 'keep' | 'underpowered' {
  if (!enough(attempted.partners, attempted.n) || attempted.ci95 === null) return 'underpowered'
  return attempted.ci95[0] >= PROVE_MIN_RATE ? 'keep' : 'underpowered'
}

export interface ProvedInUse extends Proportion {
  /** `n` partners with any event, `correct` of them with at least one `proved` lab. */
  labs: number
}

/** F10: the share of partners with at least one `proved` lab (an `ok` `prove` event of provenance `proved`), and how many labs that is in all. Descriptive. */
export function selectProvedInUse(ledgers: readonly Ledger[]): ProvedInUse {
  let n = 0
  let withProved = 0
  let labs = 0
  for (const events of ledgers) {
    if (events.length === 0) continue
    n += 1
    const mine = new Set<string>()
    for (const e of events) if (e.kind === 'prove' && isOk(e) && provenanceOf(e) === 'proved') mine.add(e.ref)
    if (mine.size > 0) withProved += 1
    labs += mine.size
  }
  return { ...proportion(withProved, n), labs }
}

/* ------------------------------------------------------------------ */
/* F6: selectDiscrimination30                                          */
/* ------------------------------------------------------------------ */

export interface Discrimination30 {
  /** 30-day accuracy on items of the three KCs (§15.1). */
  accuracy: Proportion
  partners: number
  /** The `confuse.<other KC>` lures the lesson content holds for these KCs; 0 means the share has nothing to read. */
  lures: number
  /** Misses among those items, and the share of them that name a confusion with another of the three KCs: a null rate unless `confusionStatus` is `ok`. */
  misses: number
  /**
   * Misses left out of `misses` and the share: lesson QuizBlock answers (`src` `quiz`) written before EF1, which kept the
   * pick but never the picked lure's misconception id, so they could not be read as a confusion or as not one.
   */
  unattributed: number
  confusion: Proportion
  /** Why the confusion share is not read, or `ok`. */
  confusionStatus: 'ok' | 'no-lures' | 'few-misses'
}

/** A lesson as `discriminationLures` reads it: quiz blocks whose questions carry `kcs` and `miss` ids. */
export interface LureLesson {
  blocks: readonly { type: string; questions?: readonly { kcs?: readonly string[]; miss?: readonly string[] }[] }[]
}

/**
 * The `confuse.<kcId>` lures a lesson set holds, per P3 KC (§11.2): on each quiz question that assesses one of the three
 * KCs, a lure whose miss id names another of the three. A KC with 2 or more can have its confusion share read (3c-03's
 * test requires it of all three).
 */
export function discriminationLures(lessons: readonly LureLesson[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(DISCRIMINATION_KCS.map((k) => [k, 0]))
  for (const lesson of lessons) {
    for (const block of lesson.blocks) {
      if (block.type !== 'quiz') continue
      for (const q of block.questions ?? []) {
        const mine = (q.kcs ?? []).filter((k) => DISCRIMINATION_KCS.includes(k))
        for (const miss of q.miss ?? []) {
          const named = miss.startsWith('confuse.') ? miss.slice('confuse.'.length) : null
          if (named === null || !DISCRIMINATION_KCS.includes(named)) continue
          for (const kc of mine) if (kc !== named) out[kc] += 1
        }
      }
    }
  }
  return out
}

/**
 * Whether a miss can be read for a confusion. Every source records the picked lure's misconception id (`miss`) on a miss
 * when it has one, except lesson QuizBlock answers (`src` `quiz`) written before EF1. Since EF1 those carry their place in
 * the attempt (`slot` of `of`) beside the id, and that marks them: a donation drops every miss id that is not
 * `confuse.<kc>` (redact.ts), so on a donation the id alone cannot tell an old miss from a new one on another lure.
 */
function missReadable(e: LedgerEvent): boolean {
  if (srcOf(e) !== 'quiz') return true
  const d = dataOf(e)
  return (typeof d.miss === 'string' && d.miss !== '') || typeof d.of === 'number'
}

/**
 * P3's metric (§15.1): graded answers (not assisted) on `t2.address-translation`, `t5.block-tables` and
 * `t5.prefix-cache-keys` at least 30 local days after the KC's card was created, with the confusion share: misses whose id
 * is `confuse.<one of the other two KCs>`, over all misses. An answer counts once. The share is `no-lures` ("not enough
 * data", never 0) when the content holds no such lure (`opts.lures`, from `discriminationLures`; none given is none), and
 * `few-misses` below `DISCRIMINATION_MIN_MISSES`. A lesson QuizBlock miss written before EF1 counts in the accuracy but
 * not in the share (`unattributed`): it kept no lure id, so it could never be a confusion.
 */
export function selectDiscrimination30(ledgers: readonly PartnerLedger[], content: CardsContent, opts: { lures?: Readonly<Record<string, number>> } = {}): Discrimination30 {
  const lures = Object.values(opts.lures ?? {}).reduce((n, x) => n + x, 0)
  let n = 0
  let correct = 0
  let misses = 0
  let unattributed = 0
  let confusions = 0
  let partners = 0
  for (const l of ledgers) {
    const cards = cardsOf(l, content)
    if (cards === null) continue
    let mine = 0
    for (const e of sorted(l.events)) {
      if (!isGradedAnswer(e) || isAssisted(e)) continue
      const kcs = content.resolve(e).filter((kc) => DISCRIMINATION_KCS.includes(kc) && Object.hasOwn(cards, kc) && daysBetween(cards[kc].createdDay, e.day) >= DISCRIMINATION_MIN_DAYS)
      if (kcs.length === 0) continue
      mine += 1
      n += 1
      if (isOk(e)) {
        correct += 1
        continue
      }
      if (!missReadable(e)) {
        unattributed += 1
        continue
      }
      misses += 1
      const miss = dataOf(e).miss
      const named = typeof miss === 'string' && miss.startsWith('confuse.') ? miss.slice('confuse.'.length) : null
      if (named !== null && DISCRIMINATION_KCS.includes(named) && kcs.some((kc) => kc !== named)) confusions += 1
    }
    if (mine > 0) partners += 1
  }
  const confusionStatus: Discrimination30['confusionStatus'] = lures === 0 ? 'no-lures' : misses < DISCRIMINATION_MIN_MISSES ? 'few-misses' : 'ok'
  // below its minimum the share is a null rate, which the table prints as "not enough data", never as 0
  return { accuracy: proportion(correct, n), partners, lures, misses, unattributed, confusion: confusionStatus === 'ok' ? proportion(confusions, misses) : proportion(0, 0), confusionStatus }
}

/* ------------------------------------------------------------------ */
/* F7: selectCubeError30                                               */
/* ------------------------------------------------------------------ */

export interface CubeError30 {
  n: number
  partners: number
  /** Median of |log₁₀(answer ÷ truth)|, pooled over answers; 0.301 is a factor of two. Null with none. */
  median: number | null
  /** Bootstrap interval over learners; null with fewer than two. */
  ci95: [number, number] | null
}

const isCubeItem = (ref: string): boolean => (ref.startsWith('gen:tiling/') && ref !== 'gen:tiling/qblock-ai') || ref === 'gen:roofline/tile-ai'

/**
 * W7's metric (§15.1): the median |log₁₀(answer ÷ truth)| over a learner's `tiling` and `roofline/tile-ai` answers on an
 * unseen seed, outside the cube (not `src` `play`), at least 30 local days after the learner's first `play:tiling-cube`
 * event. `value` and `truth` are what a donation keeps for numeric items (§15.2); an answer or a truth that is not above
 * zero has no log and is left out. `tiling/qblock-ai` is left out too: its score-matrix question takes byte units, and a
 * donation keeps no unit to bring the answer to the truth's.
 */
export function selectCubeError30(ledgers: readonly Ledger[]): CubeError30 {
  const perLearner: number[][] = []
  for (const events of ledgers) {
    const list = sorted(events)
    const cube = list.find((e) => e.kind === 'play' && e.ref === 'play:tiling-cube')
    if (cube === undefined) continue
    const errors: number[] = []
    for (const e of list) {
      if (!isGradedAnswer(e) || !isCubeItem(e.ref) || provenanceOf(e) !== 'unseen' || srcOf(e) === 'play' || daysBetween(cube.day, e.day) < CUBE_MIN_DAYS) continue
      const d = dataOf(e)
      if (typeof d.value === 'number' && typeof d.truth === 'number' && Number.isFinite(d.value) && Number.isFinite(d.truth) && d.value > 0 && d.truth > 0) {
        errors.push(Math.abs(Math.log10(d.value / d.truth)))
      }
    }
    if (errors.length > 0) perLearner.push(errors)
  }
  const pooled = perLearner.flat()
  const ci95 = perLearner.length < 2 ? null : interval95(bootstrapDraws(perLearner, (s) => median(s.flat()), hash32('cube-error')))
  return { n: pooled.length, partners: perLearner.length, median: median(pooled), ci95 }
}

/* ------------------------------------------------------------------ */
/* F8: selectFormsGain                                                 */
/* ------------------------------------------------------------------ */

export interface TrackGain {
  track: string
  /** Learners with the form complete (12 slots answered), by form, and their pooled accuracy. */
  forms: Record<FormId, Proportion>
  /** B − A over learners with both forms, in accuracy; the interval is a bootstrap over learners. */
  bMinusA: MeanDifference
  /** C ÷ B over learners with both forms: the mean C accuracy over the mean B accuracy, the interval a bootstrap over learners. */
  cOverB: { n: number; ratio: number | null; ci95: [number, number] | null }
  /** `pass`: the interval's lower end is at least `FORMS_MIN_RATIO`. `fail`: its upper end is below it. `reported`: it holds 0.8. `insufficient`: fewer than `FORMS_MIN_LEARNERS` learners with B and C. */
  status: 'pass' | 'fail' | 'reported' | 'insufficient'
}

export interface FormsGain {
  tracks: TrackGain[]
  /** Learners with a form item. */
  partners: number
}

/**
 * The track of a form item without a recorded `track`: the most common track prefix of its `kcs` (a KC id's text before
 * the first dot), the first one on a tie. Only a fallback: T5's forms draw 3 of their 12 slots from the `sig` family,
 * whose items carry ['t7.incident-diagnosis', 't5.prefill-decode-interference'], and a T7 slot on t7.incident-diagnosis
 * can carry the same pair, so no rule over `kcs` alone tells the two tracks apart.
 */
function trackOfKcs(kcs: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const kc of kcs) {
    const dot = kc.indexOf('.')
    if (dot > 0) counts.set(kc.slice(0, dot), (counts.get(kc.slice(0, dot)) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [track, n] of counts) if (best === null || n > (counts.get(best) as number)) best = track
  return best
}

/**
 * K5's opt-in metric (§15.1): per track, the learner's three forms by `formId`, the first answer to each of the 12 slots
 * counting. A form item's track is the `track` it was recorded with (the codec requires one on every form item, and a
 * donation keeps it when it is one of the graph's tracks); only an event without one falls back to its `kcs`
 * (`trackOfKcs`). Only a complete form has an accuracy. B − A and C ÷ B are over the learners who have both forms; the
 * intervals are 10,000-resample bootstraps over those learners.
 */
export function selectFormsGain(ledgers: readonly Ledger[]): FormsGain {
  const pooled = new Map<string, Record<FormId, { n: number; correct: number }>>()
  const learners = new Map<string, Partial<Record<FormId, number>>[]>()
  let partners = 0
  for (const events of ledgers) {
    const slots = new Map<string, Map<number, boolean>>()
    for (const e of sorted(events)) {
      if (e.kind !== 'item' || srcOf(e) !== 'form') continue
      const d = dataOf(e)
      const slot = d.formSlot
      const track = typeof d.track === 'string' && d.track !== '' ? d.track : trackOfKcs(kcsOf(e))
      if ((d.formId !== 'A' && d.formId !== 'B' && d.formId !== 'C') || track === null || !Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= FORM_SLOTS) continue
      // the form id first: it is one letter, and a full export's track may hold any character
      const key = `${d.formId}/${track}`
      const mine = slots.get(key) ?? new Map<number, boolean>()
      if (!mine.has(slot as number)) mine.set(slot as number, isOk(e))
      slots.set(key, mine)
    }
    if (slots.size > 0) partners += 1
    const byTrack = new Map<string, Partial<Record<FormId, number>>>()
    for (const [key, answers] of slots) {
      if (answers.size < FORM_SLOTS) continue
      const id = key[0] as FormId
      const track = key.slice(2)
      const right = [...answers.values()].filter(Boolean).length
      byTrack.set(track, { ...byTrack.get(track), [id]: right / FORM_SLOTS })
      const p = pooled.get(track) ?? { A: { n: 0, correct: 0 }, B: { n: 0, correct: 0 }, C: { n: 0, correct: 0 } }
      p[id].n += FORM_SLOTS
      p[id].correct += right
      pooled.set(track, p)
    }
    for (const [track, forms] of byTrack) learners.set(track, [...(learners.get(track) ?? []), forms])
  }
  const tracks = [...pooled.keys()].sort().map((track): TrackGain => {
    const mine = learners.get(track) ?? []
    const p = pooled.get(track) as Record<FormId, { n: number; correct: number }>
    const ab = mine.filter((f) => f.A !== undefined && f.B !== undefined).map((f) => (f.B as number) - (f.A as number))
    const bc = mine.filter((f) => f.B !== undefined && f.C !== undefined).map((f) => ({ b: f.B as number, c: f.C as number }))
    const ratio = (s: readonly { b: number; c: number }[]): number | null => {
      const b = meanOf(s.map((x) => x.b))
      const c = meanOf(s.map((x) => x.c))
      return b === null || c === null || b === 0 ? null : c / b
    }
    const ci95 = bc.length < 2 ? null : interval95(bootstrapDraws(bc, ratio, hash32(`forms:${track}`)))
    const point = ratio(bc)
    const status: TrackGain['status'] =
      bc.length < FORMS_MIN_LEARNERS || ci95 === null || point === null ? 'insufficient' : ci95[0] >= FORMS_MIN_RATIO ? 'pass' : ci95[1] < FORMS_MIN_RATIO ? 'fail' : 'reported'
    return {
      track,
      forms: { A: proportion(p.A.correct, p.A.n), B: proportion(p.B.correct, p.B.n), C: proportion(p.C.correct, p.C.n) },
      bMinusA: meanDifference(ab, hash32(`forms-b-a:${track}`)),
      cOverB: { n: bc.length, ratio: point, ci95 },
      status,
    }
  })
  return { tracks, partners }
}

/* ------------------------------------------------------------------ */
/* F9: selectVrk30Spread                                               */
/* ------------------------------------------------------------------ */

export interface Vrk30Spread {
  /** Partners with any event, whose VRK₃₀ is read. */
  partners: number
  /** Of those, partners with at least one checked KC. */
  checked: number
  /** Retained KCs per partner: min, quartiles, median, max. */
  retained: ReturnType<typeof spreadOf>
  /** Retained KCs per active study-month, over partners with an active month. */
  perMonth: ReturnType<typeof spreadOf>
  /** The share of checked KCs retained, over partners with a checked KC. */
  share: ReturnType<typeof spreadOf>
  /**
   * The 95 % percentile-bootstrap interval of each spread's median, over partners (10,000 resamples, seeded, so the same
   * exports give the same interval); null with no partner. A reading of where the middle partner sits, not a pass.
   */
  medianCi95: { retained: [number, number] | null; perMonth: [number, number] | null; share: [number, number] | null }
}

/**
 * VRK₃₀ across partners (§15.1, F9): `selectVrk30` per ledger as of its last day, then the spread. Reported as "among n
 * partners (self-selected)" and never as a pass.
 */
export function selectVrk30Spread(ledgers: readonly PartnerLedger[], content: CardsContent): Vrk30Spread {
  const rows = ledgers.flatMap((l) => {
    const now = lastDay(l.events)
    return now === null ? [] : [selectVrk30(l.events, content, now, l.plan, { placement: l.placement })]
  })
  const withChecks = rows.filter((r) => r.checked.length > 0)
  const retained = rows.map((r) => r.retained.length)
  const perMonth = rows.flatMap((r) => (r.perActiveMonth === null ? [] : [r.perActiveMonth]))
  const share = withChecks.map((r) => r.share.rate as number)
  const ciOfMedian = (xs: readonly number[], name: string) => interval95(bootstrapDraws(xs, median, hash32(`vrk30:${name}`)))
  return {
    partners: rows.length,
    checked: withChecks.length,
    retained: spreadOf(retained),
    perMonth: spreadOf(perMonth),
    share: spreadOf(share),
    medianCi95: { retained: ciOfMedian(retained, 'retained'), perMonth: ciOfMedian(perMonth, 'per-month'), share: ciOfMedian(share, 'share') },
  }
}

/* ------------------------------------------------------------------ */
/* selectReceiptStats                                                  */
/* ------------------------------------------------------------------ */

export const FLEET_ACTS = ['engine', 'fleet', 'business'] as const
export type FleetAct = (typeof FLEET_ACTS)[number]

export interface ReceiptStats {
  partners: number
  /** Per act: acts counted (each learner's latest event on the act), receipts cited, verified, and figures left uncited. */
  acts: Record<FleetAct, { acts: number; cited: number; verified: number; uncited: number }>
  /** Verified over cited, all acts. */
  verified: Proportion
  /** Self-review scores 0 to 3, counted per rubric line: `rubric.capacity[2]` is the acts that scored themselves 2 on capacity. Never a grade. */
  rubric: Record<(typeof RUBRIC_KEYS)[number], [number, number, number, number]>
  rubricActs: number
}

const countOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)

/** Receipts cited and verified per act, uncited figures, and the distribution of the rubric self-scores (§15.1). Each learner's latest event on an act counts. */
export function selectReceiptStats(ledgers: readonly Ledger[]): ReceiptStats {
  const acts = Object.fromEntries(FLEET_ACTS.map((a) => [a, { acts: 0, cited: 0, verified: 0, uncited: 0 }])) as ReceiptStats['acts']
  const rubric = Object.fromEntries(RUBRIC_KEYS.map((k) => [k, [0, 0, 0, 0]])) as unknown as ReceiptStats['rubric']
  let rubricActs = 0
  let partners = 0
  for (const events of ledgers) {
    const latest = new Map<FleetAct, LedgerEvent>()
    for (const e of sorted(events)) {
      const act = e.ref.startsWith('fw:') ? e.ref.slice('fw:'.length) : null
      if (e.kind === 'fleet-act' && (FLEET_ACTS as readonly string[]).includes(act as string)) latest.set(act as FleetAct, e)
    }
    let any = false
    for (const [act, e] of latest) {
      const d = dataOf(e)
      const r = (typeof d.receipts === 'object' && d.receipts !== null ? d.receipts : {}) as Rec
      const cited = countOf(r.cited)
      const verified = countOf(r.verified)
      const uncited = countOf(r.uncited)
      if (cited !== null && verified !== null && uncited !== null) {
        acts[act].acts += 1
        acts[act].cited += cited
        acts[act].verified += verified
        acts[act].uncited += uncited
        any = true
      }
      const s = (typeof d.rubric === 'object' && d.rubric !== null ? d.rubric : {}) as Rec
      if (RUBRIC_KEYS.every((k) => countOf(s[k]) !== null && (s[k] as number) <= 3)) {
        rubricActs += 1
        for (const k of RUBRIC_KEYS) rubric[k][s[k] as 0 | 1 | 2 | 3] += 1
        any = true
      }
    }
    if (any) partners += 1
  }
  const cited = FLEET_ACTS.reduce((n, a) => n + acts[a].cited, 0)
  const verified = FLEET_ACTS.reduce((n, a) => n + acts[a].verified, 0)
  return { partners, acts, verified: proportion(Math.min(verified, cited), cited), rubric, rubricActs }
}

/* ------------------------------------------------------------------ */
/* Pre-registrations and the watcher                                   */
/* ------------------------------------------------------------------ */

/**
 * Whether a pre-registration under `docs/prereg/` carries the owner's signature: a `Signed:` line with a name and an ISO
 * date (`docs/prereg/watcher.md`, `fleet-daily.md`), or a sign-off table with both the Owner and the Date signed filled
 * in (`hint-ladders.md`). The pending text of an unsigned file is neither.
 */
export function isPreregSigned(text: string): boolean {
  if (/^Signed:\s*\S.*\d{4}-\d{2}-\d{2}/m.test(text)) return true
  const cell = (label: string): string => new RegExp(`^\\|\\s*${label}\\s*\\|([^|]*)\\|`, 'mi').exec(text)?.[1].trim() ?? ''
  return cell('Owner') !== '' && /\d{4}-\d{2}-\d{2}/.test(cell('Date signed'))
}

/** §14's rule, read from the files: `unsigned` (docs/prereg/watcher.md), `unrated` (no independent rating or report), or the report's outcome. */
export type WatcherState = 'unsigned' | 'unrated' | 'keep' | 'drop' | 'underpowered'

/* ------------------------------------------------------------------ */
/* The field-gate table, F1 to F12 (§18.2)                             */
/* ------------------------------------------------------------------ */

export interface Wave3Inputs {
  cards: CardsContent
  /** `discriminationLures` over the lesson content; none given means the content holds none. */
  lures?: Readonly<Record<string, number>>
  /** The labs that ship a Prove-it v2 bundle (`prove2`). */
  v2Labs?: ReadonlySet<string>
  /** Whether the owner signed `docs/prereg/hint-ladders.md` and `docs/prereg/fleet-daily.md`; unsigned means the arms and the Daily are not read. */
  signed?: { hintLadders: boolean; fleetDaily: boolean }
  watcher?: WatcherState
}

export interface Wave3Report {
  partners: number
  surface: SurfaceMinutes
  /** Null while docs/prereg/hint-ladders.md is unsigned. */
  hint: HintArms | null
  /** Null while docs/prereg/fleet-daily.md is unsigned. */
  daily: DailyVsOther | null
  proveV2: ProveV2
  provedInUse: ProvedInUse
  discrimination: Discrimination30
  cube: CubeError30
  forms: FormsGain
  vrk: Vrk30Spread
  receipts: ReceiptStats
  watcher: WatcherState
  gates: FieldGate[]
  keepOrKill: KeepOrKill[]
}

const points = (x: number | null): string => (x === null ? 'n/a' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} points`)
const pointsCi = (d: MeanDifference): string => (d.ci95 === null ? '' : `, 95 % interval ${points(d.ci95[0])} to ${points(d.ci95[1])}`)
const range = (s: ReturnType<typeof spreadOf>, unit = ''): string => (s === null ? 'n/a' : `${fmtNum(s.min, unit)} / ${fmtNum(s.median, unit)} / ${fmtNum(s.max, unit)} (min / median / max)`)
const medianCi = (ci: [number, number] | null, unit = ''): string => (ci === null ? '' : `, the median's 95 % bootstrap interval ${fmtNum(ci[0], unit)} to ${fmtNum(ci[1], unit)}`)
const minutes = (x: number | null): string => (x === null ? 'n/a' : `${x.toFixed(0)} min`)

/** Every selector over the partners' ledgers, then F1 to F12 and the keep-or-kill lines. One ledger is one partner. */
export function buildWave3Report(ledgers: readonly PartnerLedger[], inputs: Wave3Inputs): Wave3Report {
  const { cards } = inputs
  const events = ledgers.map((l) => l.events)
  const signed = inputs.signed ?? { hintLadders: false, fleetDaily: false }
  const watcher = inputs.watcher ?? 'unsigned'
  const surface = selectSurfaceMinutes(events)
  const hint = signed.hintLadders ? selectHintArms(ledgers, cards) : null
  const daily = signed.fleetDaily ? selectDailyVsOther(ledgers, cards) : null
  const proveV2 = selectProveV2(events, inputs.v2Labs ?? new Set())
  const provedInUse = selectProvedInUse(events)
  const discrimination = selectDiscrimination30(ledgers, cards, { lures: inputs.lures })
  const cube = selectCubeError30(events)
  const forms = selectFormsGain(events)
  const vrk = selectVrk30Spread(ledgers, cards)
  const receipts = selectReceiptStats(events)

  // F1: descriptive, from five partners.
  const f1Data = surface.partners >= SURFACE_MIN_PARTNERS
  const f1: FieldGate = {
    id: 'F1',
    label: 'the journey re-cut: minutes per surface per week',
    status: f1Data ? 'reported' : 'insufficient',
    n: surface.partners,
    partners: surface.partners,
    detail: f1Data
      ? `median ${minutes(surface.total.median)} a week${surface.total.ci95 ? ` (95 % interval ${minutes(surface.total.ci95[0])} to ${minutes(surface.total.ci95[1])})` : ''} against PLAN §4.D's about ${surface.plannedWeeklyMinutes}; ${SURFACES.map((s) => `${s} ${minutes(surface.surfaces[s].median)}`).join(', ')}; the table below is the re-cut`
      : thin(surface.partners, surface.partners),
  }

  // F2: the pre-registered non-inferiority rule; not read while unsigned.
  const f2: FieldGate = !hint
    ? { id: 'F2', label: 'hint ladders keep-or-kill', status: 'owner', n: 0, partners: 0, detail: 'docs/prereg/hint-ladders.md is not signed: the arms are not read until the owner signs it' }
    : {
        id: 'F2',
        label: 'hint ladders keep-or-kill',
        status: hint.verdict === 'underpowered' ? 'insufficient' : hint.verdict === 'keep' ? 'pass' : 'fail',
        n: hint.learners,
        partners: hint.partners,
        detail:
          hint.verdict === 'underpowered'
            ? `not enough data (n = ${hint.learners} of ${hint.required} learners with a cold check in both arms, ${plural(hint.partners, 'partner')}; ${hint.checks.ladder} ladder and ${hint.checks.packet} packet checks)`
            : `ladder − packet ${points(hint.diff.mean)}, one-sided 97.5 % bootstrap bound ${points(hint.diff.lower)} against −${HINT_MARGIN * 100} points${pointsCi(hint.diff)}${hint.because === 'packet-better' ? '; the upper bound is below 0, so the packet arm is clearly better and the ladder is cut (prereg §4)' : ''}; ${hint.both} checks with both arms dropped, ${hint.unarmed} unarmed excluded`,
      }

  // F3: the Daily's pre-registered comparison; not read while unsigned.
  const f3: FieldGate = !daily
    ? { id: 'F3', label: 'Fleet Daily keep-or-kill', status: 'owner', n: 0, partners: 0, detail: 'docs/prereg/fleet-daily.md is not signed: the Daily is not compared until the owner signs it' }
    : {
        id: 'F3',
        label: 'Fleet Daily keep-or-kill',
        status: daily.verdict === 'underpowered' ? 'insufficient' : daily.verdict === 'keep' ? 'pass' : 'fail',
        n: daily.learners,
        partners: daily.partners,
        detail:
          daily.verdict === 'underpowered'
            ? `not enough data (n = ${daily.learners} of ${daily.required} learners with a 30-day sig check on a Daily KC and on another, ${plural(daily.partners, 'partner')}; ${daily.daily.n} Daily and ${daily.other.n} other checks)`
            : `Daily KCs ${fmtPct(daily.daily.rate)}${fmtCi(daily.daily)} (n = ${daily.daily.n}) against other KCs ${fmtPct(daily.other.rate)}${fmtCi(daily.other)} (n = ${daily.other.n}); learner-level difference ${points(daily.diff.mean)}, one-sided 97.5 % bootstrap bound ${points(daily.diff.lower)} against −${DAILY_MARGIN * 100} points${pointsCi(daily.diff)}`,
      }

  // F4: §14's rule, from the files.
  const f4: FieldGate =
    watcher === 'keep' || watcher === 'drop' || watcher === 'underpowered'
      ? {
          id: 'F4',
          label: 'the watcher',
          status: watcher === 'keep' ? 'pass' : watcher === 'drop' ? 'fail' : 'insufficient',
          n: 0,
          partners: 0,
          detail: `docs/backtest/report.json says ${watcher}${watcher === 'keep' ? ': the digest is built (3c-04)' : watcher === 'drop' ? ': the manual scan stays' : ': the manual scan stays and the backtest repeats on a second 8-week window'}`,
        }
      : {
          id: 'F4',
          label: 'the watcher',
          status: 'owner',
          n: 0,
          partners: 0,
          detail: `not decided: ${watcher === 'unsigned' ? 'docs/prereg/watcher.md is not signed' : 'no independent rating and report.json yet'}; the manual scan stays`,
        }

  // F5: H4's bar, the share of unseen greens on v2 labs followed by an attempt, kept only on its Wilson lower bound.
  const pa = proveV2.attempted
  const f5Data = enough(pa.partners, pa.n)
  const f5Verdict = proveV2Verdict(pa)
  // n, the share and both bounds, printed whatever the verdict
  const f5Share = `${pa.correct} of ${pa.n} unseen-seed greens followed by a v2 attempt = ${fmtPct(pa.rate)}${pa.ci95 ? `, Wilson 95 % interval ${fmtPct(pa.ci95[0])} to ${fmtPct(pa.ci95[1])}` : ''}`
  const f5Rule = `kept only if the lower bound is at least ${PROVE_MIN_RATE * 100} %`
  const f5: FieldGate = {
    id: 'F5',
    label: 'Prove-it v2 keep-or-kill',
    status: !f5Data ? 'insufficient' : f5Verdict === 'keep' ? 'pass' : 'fail',
    n: pa.n,
    partners: pa.partners,
    detail: f5Data
      ? `${f5Share}; ${f5Rule}: ${f5Verdict === 'keep' ? 'kept' : 'not kept, so the underpowered default, 1 question (PLAN §9)'}; ${proveV2.proved.correct} of ${proveV2.proved.n} first attempts proved${proveV2.proved.n > 0 ? `${fmtCi(proveV2.proved)}` : ''}`
      : `${thin(pa.n, pa.partners)}${pa.n > 0 ? `; ${f5Share}` : ''}`,
  }

  // F6: reported, from enough checks, enough misses and at least one tagged lure.
  const d = discrimination
  const f6Data = enough(d.partners, d.accuracy.n) && d.accuracy.n >= DISCRIMINATION_MIN_N && d.confusionStatus === 'ok'
  // lesson quiz misses from before EF1 kept no lure id: the share leaves them out and says so
  const f6Unattributed = d.unattributed > 0 ? `; ${plural(d.unattributed, 'lesson quiz miss', 'lesson quiz misses')} from before quizzes recorded the lure left out of the share` : ''
  const f6: FieldGate = {
    id: 'F6',
    label: 'P3: 30-day discrimination on paging, PagedAttention and the radix cache',
    status: f6Data ? 'reported' : 'insufficient',
    n: d.accuracy.n,
    partners: d.partners,
    detail: f6Data
      ? `accuracy ${d.accuracy.correct} of ${d.accuracy.n} = ${fmtPct(d.accuracy.rate)}${fmtCi(d.accuracy)}; confusion share ${d.confusion.correct} of ${d.misses} misses = ${fmtPct(d.confusion.rate)}${fmtCi(d.confusion)}${f6Unattributed}`
      : `not enough data (n = ${d.accuracy.n} of ${DISCRIMINATION_MIN_N} checks, ${plural(d.partners, 'partner')}; confusion share: ${d.confusionStatus === 'no-lures' ? 'the lesson content holds no tagged lure' : d.confusionStatus === 'few-misses' ? `${d.misses} of ${DISCRIMINATION_MIN_MISSES} misses` : `${d.misses} misses, ${d.lures} tagged lures`}${f6Unattributed})`,
  }

  // F7: reported, from 30 answers and five partners.
  const f7Data = cube.n >= CUBE_MIN_N && cube.partners >= FIELD_MIN_PARTNERS
  const f7: FieldGate = {
    id: 'F7',
    label: "W7: 30-day fresh-item error after the cube",
    status: f7Data ? 'reported' : 'insufficient',
    n: cube.n,
    partners: cube.partners,
    detail: f7Data
      ? `median |log10(answer ÷ truth)| = ${cube.median === null ? 'n/a' : cube.median.toFixed(3)} (a factor of ${cube.median === null ? 'n/a' : (10 ** cube.median).toFixed(2)})${cube.ci95 ? `, 95 % interval ${cube.ci95[0].toFixed(3)} to ${cube.ci95[1].toFixed(3)}` : ''}`
      : `not enough data (n = ${cube.n} of ${CUBE_MIN_N} answers, ${plural(cube.partners, 'partner')}; needs ${FIELD_MIN_PARTNERS} partners)`,
  }

  // F8: per track, C ÷ B against 0.8 with the bootstrap interval.
  const f8Tracks = forms.tracks.filter((t) => t.status !== 'insufficient')
  const f8: FieldGate = {
    id: 'F8',
    label: 'K5: C ÷ B at least 0.8, per track, among opt-in partners',
    status: f8Tracks.length === 0 ? 'insufficient' : f8Tracks.some((t) => t.status === 'fail') ? 'fail' : f8Tracks.every((t) => t.status === 'pass') ? 'pass' : 'reported',
    n: forms.tracks.reduce((n, t) => Math.max(n, t.cOverB.n), 0),
    partners: forms.partners,
    detail:
      f8Tracks.length === 0
        ? `not enough data (${forms.tracks.length === 0 ? 'no track form answered' : `no track has ${FORMS_MIN_LEARNERS} learners with both B and C`}, ${plural(forms.partners, 'partner')})`
        : f8Tracks.map((t) => `${t.track}: C ÷ B ${t.cOverB.ratio === null ? 'n/a' : t.cOverB.ratio.toFixed(2)}${t.cOverB.ci95 ? ` (95 % interval ${t.cOverB.ci95[0].toFixed(2)} to ${t.cOverB.ci95[1].toFixed(2)})` : ''} over ${plural(t.cOverB.n, 'learner')}, B − A ${points(t.bMinusA.mean)}`).join('; '),
  }

  // F9: reported as "among n partners", never as a pass.
  const f9Data = vrk.partners >= FIELD_MIN_PARTNERS
  const f9: FieldGate = {
    id: 'F9',
    label: 'VRK₃₀ (the north star), among partners (self-selected)',
    status: f9Data ? 'reported' : 'insufficient',
    n: vrk.partners,
    partners: vrk.partners,
    detail: f9Data
      ? `among ${vrk.partners} partners (self-selected), ${vrk.checked} with a checked KC: retained KCs ${range(vrk.retained)}${medianCi(vrk.medianCi95.retained)}${vrk.perMonth ? `; per active study-month ${range(vrk.perMonth)}${medianCi(vrk.medianCi95.perMonth)}` : ''}; a reading, never a pass`
      : thin(vrk.partners, vrk.partners),
  }

  // F10: descriptive.
  const f10Data = provedInUse.n >= FIELD_MIN_PARTNERS
  const f10: FieldGate = {
    id: 'F10',
    label: '`proved` in use: partners with at least one proved lab',
    status: f10Data ? 'reported' : 'insufficient',
    n: provedInUse.n,
    partners: provedInUse.n,
    detail: f10Data ? `${provedInUse.correct} of ${provedInUse.n} partners = ${fmtPct(provedInUse.rate)}${fmtCi(provedInUse)}; ${plural(provedInUse.labs, 'proved lab')} in all` : thin(provedInUse.n, provedInUse.n),
  }

  const f11: FieldGate = { id: 'F11', label: "queue gating: Wave 3's review queue under 10 h", status: 'owner', n: 0, partners: 0, detail: 'the owner sums the open tasks at PLAN §8\'s rates; exports cannot measure it' }
  const f12: FieldGate = { id: 'F12', label: 'accessibility: VoiceOver and NVDA passes', status: 'owner', n: 0, partners: 0, detail: 'the owner records them in docs/a11y/wave-3-screen-readers.md; exports cannot measure them' }

  const verdict = (g: FieldGate): KeepOrKill['verdict'] => (g.status === 'owner' ? 'unsigned' : g.status === 'insufficient' ? 'underpowered' : g.status === 'pass' ? 'keep' : 'kill')
  const keepOrKill: KeepOrKill[] = [
    { id: 'F2', label: 'hint ladders', verdict: verdict(f2), fallback: 'R0 to R2 only' },
    { id: 'F3', label: 'Fleet Daily', verdict: verdict(f3), fallback: 'weekly, no On-Call' },
    // the owner's rule: below the bar is the underpowered default too, never a kill
    { id: 'F5', label: 'Prove-it v2', verdict: f5Verdict, fallback: '1 question' },
  ]

  return {
    partners: ledgers.length,
    surface,
    hint,
    daily,
    proveV2,
    provedInUse,
    discrimination,
    cube,
    forms,
    vrk,
    receipts,
    watcher,
    gates: [f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12],
    keepOrKill,
  }
}

const cell = (x: number | null): string => (x === null ? 'n/a' : x >= 10 ? x.toFixed(0) : x.toFixed(1))

/**
 * What the re-cut's minutes are (G5 and G6 of the 3c review, round 3): since EF1 the Daily and Act IV's drills count from
 * the alert to the debrief, and a Fleet Week act the page's visible time up to its pass, capped (`surfaceOf`). Work that
 * overlaps on /week counts twice: each event claims its own visible time, so an Act I or II run started during a drill is
 * in the run's `ms` and in the drill's. That is rare, and the table says so rather than claiming intervals.
 */
export const SURFACE_FOOTNOTE: readonly string[] = [
  '  minutes: Today sessions by C19\'s span rule; lesson, play, lab and /me answers and runs by their recorded times; the',
  '  Daily and Act IV drills from the alert to the debrief; a Fleet Week act the page\'s visible time up to its pass that',
  '  no run or drill holds. Daily and Fleet Week time counts only while the page is visible, capped per event. Overlapping',
  '  work on /week counts twice (an Act I or II run started during a drill is in both). A donation rounds each to a second',
]

/** The Wave 3 report as text: the gate table, the keep-or-kill lines, the journey re-cut beside PLAN §4.D, and the receipts. */
export function formatWave3Report(r: Wave3Report): string {
  const s = r.surface
  const stages = s.stages.map((st) => {
    const weeks = st.row.weeks[0] === st.row.weeks[1] ? `${st.row.weeks[0]}` : `${st.row.weeks[0]}–${st.row.weeks[1]}`
    const head = `  weeks ${weeks.padEnd(5)} ${plural(st.partners, 'partner').padEnd(10)}`
    const planned = `planned: ${st.row.planned} [${st.row.surfaces.join(', ')}]`
    if (st.medians === null || st.partners < SURFACE_MIN_PARTNERS) return [`${head} not enough data (n = ${st.partners}; needs ${SURFACE_MIN_PARTNERS} partners)`, `      ${planned}`]
    return [`${head} ${SURFACES.map((x) => `${x} ${cell((st.medians as SurfaceRecord)[x])}`).join('  ')}`, `      ${planned}`]
  })
  const ra = r.receipts
  const lines = [
    `Wave 3 field gates over ${plural(r.partners, 'export')} (one per partner; day offsets only, no calendar dates)`,
    '',
    ...r.gates.flatMap((g) => [
      `${g.id}  ${g.label} → ${STATUS_LABEL[g.status]}`,
      `      ${g.status === 'owner' || g.status === 'insufficient' ? '' : `n = ${g.n}, ${plural(g.partners, 'partner')}: `}${g.detail}`,
    ]),
    '',
    'keep-or-kill',
    ...r.keepOrKill.map(
      (k) => `  ${k.label}: ${k.verdict === 'unsigned' ? `NOT READ, the pre-registration is unsigned; default: ${k.fallback}` : k.verdict === 'underpowered' ? `UNDERPOWERED, default: ${k.fallback}` : k.verdict === 'keep' ? 'KEEP' : `KILL, default: ${k.fallback}`}`,
    ),
    '',
    'the journey re-cut (F1): active minutes per week, median over partners, beside PLAN §4.D',
    s.partners < SURFACE_MIN_PARTNERS
      ? `  not enough data (n = ${s.partners} partners with recorded time; needs ${SURFACE_MIN_PARTNERS})`
      : `  all weeks (planned about ${s.plannedWeeklyMinutes} min a week): ${SURFACES.map((x) => `${x} ${cell(s.surfaces[x].median)}`).join('  ')}  | total ${cell(s.total.median)}`,
    ...stages.flat(),
    ...SURFACE_FOOTNOTE,
    '',
    ra.partners === 0
      ? 'Fleet Week receipts: not enough data (n = 0 acts with receipts)'
      : `Fleet Week receipts (${plural(ra.partners, 'partner')}): ${FLEET_ACTS.map((a) => `${a} ${ra.acts[a].verified} of ${ra.acts[a].cited} verified, ${ra.acts[a].uncited} uncited (${plural(ra.acts[a].acts, 'act')})`).join('; ')}; rubric self-scores (0 / 1 / 2 / 3) over ${plural(ra.rubricActs, 'act')}: ${RUBRIC_KEYS.map((k) => `${k} ${ra.rubric[k].join(' / ')}`).join(', ')}`,
  ]
  return lines.join('\n')
}
