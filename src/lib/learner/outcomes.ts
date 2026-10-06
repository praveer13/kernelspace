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
 */

import { SYSTEMS_FORGE_LABS } from '@/data/labs'
import { KCS } from '@/data/kc'
import type { Kc } from '@/lib/kc/types'
import { compareEvents } from '@/lib/ledger/merge'
import { dayOf } from '@/lib/ledger/time'
import type { IsoInstant, LedgerEvent, LocalDay, WorkingKey, WorkingRecord } from '@/lib/ledger/types'
import { wilson } from './calibration'
import { deriveCardsDetailed, type CardsContent, type CardsExtra, type CardsPlan, type FirstReview } from './cards'
import { weekStartOf } from './planner'
import { sessionSpanMs } from './today'
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
