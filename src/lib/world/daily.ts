/**
 * world/daily — the Fleet Daily as pure data (docs/specs/wave-2.md §9.7, task 2b-19).
 *
 * Page-safe and deterministic: it imports only the incident catalogs (world/incident-spec, which imports
 * nothing from fleet-model.ts) and types, never `Date`, so the Daily page and its Today card read the day's
 * number, the share string, the flow's state and a probe's readings as tables without pulling the engine in.
 * The page supplies today's local date (`localDateKey`); everything below takes it as a string.
 *
 * WHAT IS HERE
 *   - The Daily's identity: `DAILY_EPOCH`, `dailyNumber(date)` (local days since the epoch, plus one),
 *     `dailySource(date)` and `dailyIncident(date)` (= `generateIncident('daily', date)`).
 *   - The flow's state (`FlowState`) and its transitions. Alert, Hypothesis, ProbeBar, FixMenu and Debrief
 *     (src/components/daily) take the incident session and an `IncidentSource` as props and never read the
 *     Daily's date, so Act IV's drills (2b-17) play the same flow with `{ns: 'drill', key}` and these
 *     transitions.
 *   - `readingView`: a probe's readings as sparkline series plus the table every sparkline is described by.
 *   - `shareString`, and `dailyResult` / `recordDaily`, which write the one `incident` event per date.
 *   - Your engine (§9.7, §10): `dailyBoxes` says which of the four boxes the Daily ran on are yours, `dailySlotBytes`
 *     hands their bytes to the incident session, and `boxLines` / `engineLine` / `engineNote` say it in words.
 *
 * RECORDING (§9.7). `recordIncident` runs for the first completed attempt on a date only. The ledger already
 * knows (`aggregate.incidents[ref].n`), so a replay, a second tab or a reload cannot write a second event:
 * replays are practice and write nothing. The Daily's seed is public, so the façade grades the event
 * `practice`.
 */

import { KC } from '@/data/kc/ids'
import { ENGINE_SLOTS } from '@/lib/engine/catalog'
import type { EngineSlot, IncidentData, IncidentRef, IncidentResult } from '@/lib/ledger/types'
import { hash32, shuffledOrder } from '@/lib/rng'
import type { MirrorTable } from '@/lib/sims/types'
import type { FleetSlotBytes } from '@/workers/fleet-protocol'
import {
  CATEGORY_LABELS,
  FAULT_LABELS,
  FIX_IDS,
  INCIDENT_FAULTS,
  PROBES,
  burnPercent,
  generateIncident,
  streetlightFlags,
  type Category,
  type FixId,
  type Hypothesis,
  type IncidentFault,
  type IncidentNs,
  type IncidentSpec,
  type Observation,
  type ProbeId,
  type ProbeReadings,
} from './incident-spec'

/* ------------------------------------------------------------------ */
/* Identity                                                             */
/* ------------------------------------------------------------------ */

/**
 * The first day the Daily ships: it is Daily #1. The owner moves it to the real ship date before release
 * (it changes the numbers in everyone's share strings, so it moves once).
 */
export const DAILY_EPOCH = '2026-10-13'

/** About how long the Daily takes, for the Today card. */
export const DAILY_MINUTES = 8

/** What an incident is generated from: `generateIncident(ns, key)`. A drill's key is its fresh seed's hex, the Daily's is its date. */
export interface IncidentSource {
  ns: IncidentNs
  key: string
}

export interface CivilDate {
  y: number
  m: number
  d: number
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
const monthDays = (y: number, m: number) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]

/** `YYYY-MM-DD` as numbers, or `null` when it is not a real calendar date. */
export function parseLocalDate(date: string): CivilDate | null {
  const found = DATE_RE.exec(date)
  if (!found) return null
  const y = Number(found[1])
  const m = Number(found[2])
  const d = Number(found[3])
  return m >= 1 && m <= 12 && d >= 1 && d <= monthDays(y, m) ? { y, m, d } : null
}

/** Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's days_from_civil): calendar arithmetic with no `Date`, so no time zone or DST. */
export function daysFromCivil({ y, m, d }: CivilDate): number {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** Local days from `from` to `date` (negative before it), or `null` for a malformed date. */
export function daysBetween(from: string, date: string): number | null {
  const a = parseLocalDate(from)
  const b = parseLocalDate(date)
  return a && b ? daysFromCivil(b) - daysFromCivil(a) : null
}

/** The Daily's number: local days since `DAILY_EPOCH`, plus one. A date before the epoch (a device clock set back) is #1. */
export function dailyNumber(date: string, epoch: string = DAILY_EPOCH): number {
  const days = daysBetween(epoch, date)
  return days === null ? 1 : Math.max(1, days + 1)
}

export const dailySource = (date: string): IncidentSource => ({ ns: 'daily', key: date })

/** One incident per local date, the same for everybody on that date (§9.7). */
export const dailyIncident = (date: string): IncidentSpec => generateIncident('daily', date)

export const dailyRef = (date: string): IncidentRef => `inc:daily/${date}`

/** "Fleet Daily #47" for the Daily, "Drill" for a drill: the heading of the flow's first card. */
export function sourceTitle(source: IncidentSource): string {
  if (source.ns === 'daily') return `Fleet Daily #${dailyNumber(source.key)}`
  if (source.ns === 'drill') return 'Incident drill'
  return source.ns === 'team' ? 'Team incident' : 'Incident'
}

/* ------------------------------------------------------------------ */
/* The flow                                                             */
/* ------------------------------------------------------------------ */

/**
 * How the flow components run a session command: the page marks the flow busy while it is in flight, turns a
 * failure (a timeout, a trapped module) into its error card and resolves `null`, so a component only handles
 * the success.
 */
export type FlowRun = <T>(command: () => Promise<T>) => Promise<T | null>

/** What happened at one step of the clock log. */
export type FlowEntry =
  | { kind: 'probe'; probe: ProbeId; minute: number; category: Category; readings: ProbeReadings }
  | { kind: 'fix'; fix: FixId; minute: number; effective: boolean }
  | { kind: 'wait'; minute: number }

export interface FlowState {
  /** the clock minute the alert fired */
  alert: number
  /** the last minute the incident may run to */
  limit: number
  /** the clock now (absolute minutes) */
  clock: number
  /** the hypothesis held now; `null` until the first is logged, and no probe opens before that */
  hypothesis: Hypothesis | null
  /** the hypothesis held when the first fix (right or wrong) went in: the one scored, set once and then locked; `null` before any fix */
  hypothesisAtFix: Hypothesis | null
  log: FlowEntry[]
  ended: boolean
  /** the right fix has gone in */
  fixed: boolean
}

export const startFlow = (alert: number, limit: number): FlowState => ({ alert, limit, clock: alert, hypothesis: null, hypothesisAtFix: null, log: [], ended: false, fixed: false })

/** A revision is refused once a fix has gone in: the hypothesis held at the first fix is the one scored. */
export const withHypothesis = (s: FlowState, hypothesis: Hypothesis): FlowState => (s.hypothesisAtFix === null ? { ...s, hypothesis } : s)

export function withProbe(s: FlowState, probe: ProbeId, reply: { minute: number; category: Category; readings: ProbeReadings; ended: boolean }): FlowState {
  const entry: FlowEntry = { kind: 'probe', probe, minute: reply.minute, category: reply.category, readings: reply.readings }
  return { ...s, clock: reply.minute, log: [...s.log, entry], ended: reply.ended }
}

export function withFix(s: FlowState, fix: FixId, reply: { minute: number; effective: boolean; ended: boolean }): FlowState {
  const entry: FlowEntry = { kind: 'fix', fix, minute: reply.minute, effective: reply.effective }
  const first = s.log.every((e) => e.kind !== 'fix')
  return { ...s, clock: reply.minute, log: [...s.log, entry], ended: reply.ended, fixed: s.fixed || reply.effective, hypothesisAtFix: first ? s.hypothesis : s.hypothesisAtFix }
}

export function withWait(s: FlowState, reply: { minute: number; ended: boolean }): FlowState {
  return { ...s, clock: reply.minute, log: [...s.log, { kind: 'wait', minute: reply.minute }], ended: reply.ended }
}

/** Incident minutes since the alert. */
export const elapsed = (s: Pick<FlowState, 'clock' | 'alert'>): number => s.clock - s.alert

/** The probes taken, in order. */
export const probesTaken = (s: Pick<FlowState, 'log'>): ProbeId[] => s.log.flatMap((e) => (e.kind === 'probe' ? [e.probe] : []))

/** The categories seen so far, in order (what Streetlight and the expert read). */
export const observationsOf = (s: Pick<FlowState, 'log'>): Observation[] => s.log.flatMap((e) => (e.kind === 'probe' ? [{ probe: e.probe, category: e.category }] : []))

/** For each probe taken, whether it was Streetlight given what had been seen before it (the debrief names these). */
export const streetlightOf = (s: Pick<FlowState, 'log'>): boolean[] => streetlightFlags(observationsOf(s))

/** "+12 min" or "−3 min": a clock minute against the alert. */
export function sinceAlert(minute: number, alert: number): string {
  const d = minute - alert
  return `${d < 0 ? '−' : '+'}${Math.abs(d)} min`
}

/* ------------------------------------------------------------------ */
/* Readings as tables and sparklines                                    */
/* ------------------------------------------------------------------ */

export interface ReadingSeries {
  label: string
  values: number[]
  /** per minute, whether the worker was down (the value plots as 0 and the table reads "—") */
  down?: boolean[]
}

/** A probe's readings for the screen: facts as sentences, series as sparklines, and the tables that describe them. */
export interface ReadingView {
  probe: ProbeId
  title: string
  /** one sentence per fact that is not a series ("configured drain: 6 per tick") */
  facts: string[]
  series: ReadingSeries[]
  /** the first table has one row per minute and one column per series; a latency reading adds the split by prompt length */
  tables: MirrorTable[]
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100
const count = (n: number) => Math.round(n)

/** A per-worker series with `null` (worker down) plotted as 0. */
const perWorker = (label: string, rows: readonly (readonly (number | null)[])[], map: (n: number) => number = round2): ReadingSeries[] =>
  rows.map((values, w) => ({
    label: `${label} · w${w}`,
    values: values.map((v) => (v === null ? 0 : map(v))),
    down: values.map((v) => v === null),
  }))

/** The table of a reading: a row per minute (against the alert), a column per series; a down worker reads "—". */
function minuteTable(caption: string, window: { from: number; to: number }, alert: number, series: readonly ReadingSeries[]): MirrorTable {
  const minutes = Math.max(0, window.to - window.from)
  return {
    caption,
    columns: ['minute', ...series.map((s) => s.label)],
    rows: Array.from({ length: minutes }, (_, i) => [
      sinceAlert(window.from + i + 1, alert),
      ...series.map((s) => (s.down?.[i] ? '—' : (s.values[i] ?? '—'))),
    ]),
  }
}

/**
 * A probe's readings as the Daily shows them. `alert` is the alert's clock minute: row labels read against it,
 * and a minute is named by the clock at its end (the row for window minute `from` is `from + 1`).
 */
export function readingView(readings: ProbeReadings, alert: number): ReadingView {
  const title = PROBES[readings.probe].label
  const w = readings.window
  const caption = (what: string) => `${title}: ${what}, last ${w.to - w.from} incident minutes`
  switch (readings.probe) {
    case 'intake': {
      const series = [...perWorker('queued', readings.depth), { label: 'shed', values: readings.shed }]
      return {
        probe: 'intake',
        title,
        facts: [
          `Drain now: ${readings.drainPerTick.map((d, i) => `w${i} ${d === null ? 'down' : round2(d)}`).join(', ')} requests per tick (configured ${readings.configuredDrain}).`,
          `Each intake holds at most ${readings.capacity} requests.`,
        ],
        series,
        tables: [minuteTable(caption('queued requests and requests shed'), w, alert, series)],
      }
    }
    case 'admission': {
      const series = [...perWorker('waiting', readings.waiting), ...perWorker('admitted per iteration', readings.admittedPerIter)]
      return {
        probe: 'admission',
        title,
        facts: [`The scheduler budgets ${readings.headroom} tokens of decode headroom per running request.`],
        series,
        tables: [minuteTable(caption('the scheduler waiting list and admissions'), w, alert, series)],
      }
    }
    case 'kv': {
      const series = [
        ...perWorker('free %', readings.free, (n) => round1(n * 100)),
        { label: 'preempts', values: readings.preempts },
        { label: 'capacity misses', values: readings.capMisses },
      ]
      return {
        probe: 'kv',
        title,
        facts: [`Each worker's pool is configured for ${readings.blocks} blocks.`],
        series,
        tables: [minuteTable(caption('free KV share, auto-preempts and refused admissions'), w, alert, series)],
      }
    }
    case 'workers': {
      const up = readings.up.map((row) => row.map((v) => (v ? 1 : 0)))
      const series = [...perWorker('up', up, count), ...perWorker('iterations', readings.iterations, count)]
      return {
        probe: 'workers',
        title,
        facts: [`A healthy worker runs ${readings.ticksPerMinute} scheduler iterations a minute.`],
        series,
        tables: [minuteTable(caption('liveness (1 up, 0 down) and scheduler iterations'), w, alert, series)],
      }
    }
    case 'latency': {
      const series = [
        { label: 'TTFT p95', values: readings.ttftP95 },
        { label: 'TPOT p95', values: readings.tpotP95 },
      ]
      const split: MirrorTable = {
        caption: `${title}: p95 split by prompt length and tenant over the window`,
        columns: ['prompt', 'tenant', 'requests', 'TTFT p95', 'TPOT p95'],
        rows: readings.split.map((b) => [b.band === 'long' ? `long (≥ ${readings.longPrompt} tokens)` : 'short', b.tenant, b.n, b.ttftP95, b.tpotP95]),
      }
      return {
        probe: 'latency',
        title,
        facts: [`The objective is TTFT ${readings.slo.ttft} and TPOT ${readings.slo.tpot} ticks, p95.`],
        series,
        tables: [minuteTable(caption('TTFT and TPOT p95'), w, alert, series), split],
      }
    }
    case 'errors': {
      const series = [
        { label: 'shed', values: readings.shed },
        { label: 'lost in flight', values: readings.lost },
      ]
      return {
        probe: 'errors',
        title,
        facts: [],
        series,
        tables: [minuteTable(caption('requests shed and requests lost in flight'), w, alert, series)],
      }
    }
  }
}

/** The headline of a reading: its category in words. */
export const readingHeadline = (probe: ProbeId, category: Category): string => `${PROBES[probe].label}: ${CATEGORY_LABELS[category]}`

/* ------------------------------------------------------------------ */
/* Your engine                                                          */
/* ------------------------------------------------------------------ */

/**
 * The four boxes the Daily's incident session can run on yours (§9.5, §9.7): the scheduler, the block manager and
 * the intake queue drive every worker of the cluster, and the prefix router is loaded and checked there.
 */
export const DAILY_BOXES: readonly EngineSlot[] = ['scheduler', 'block-manager', 'intake', 'prefix-router']

/** What the Daily needs to know of an installed module: its hash, its lab and its bytes (`null` when this device does not hold them). */
export interface InstalledBox {
  sha256: string
  labId: string
  bytes: ArrayBuffer | null
}

export type InstalledBoxes = Partial<Record<EngineSlot, InstalledBox | undefined>>

/** One of the four boxes in one run of the Daily. */
export interface DailyBox {
  slot: EngineSlot
  /** "block manager" */
  label: string
  /** a module of yours ran in this box */
  own: boolean
  labId?: string
  sha256?: string
  /** installed, but the bytes are not on this device (an import without them), so the reference ran */
  missing?: boolean
}

/**
 * The four boxes of a run. A box is yours when a module is installed in the slot and its bytes are here;
 * `reference` plays the whole Daily on the reference engine (the fallback after a module fails, and a
 * learner's choice for a practice replay).
 */
export function dailyBoxes(installed: InstalledBoxes, reference = false): DailyBox[] {
  return DAILY_BOXES.map((slot) => {
    const label = ENGINE_SLOTS[slot].label
    const m = installed[slot]
    if (!m || reference) return { slot, label, own: false }
    if (m.bytes === null) return { slot, label, own: false, labId: m.labId, sha256: m.sha256, missing: true }
    return { slot, label, own: true, labId: m.labId, sha256: m.sha256 }
  })
}

/** The bytes the incident session opens with: a box that is not yours is `null`, which runs the reference driver. */
export function dailySlotBytes(installed: InstalledBoxes, reference = false): FleetSlotBytes {
  const bytes = (slot: EngineSlot): ArrayBuffer | null => (reference ? null : (installed[slot]?.bytes ?? null))
  return { sched: bytes('scheduler'), mgr: bytes('block-manager'), queue: bytes('intake'), router: bytes('prefix-router') }
}

export const ownBoxes = (boxes: readonly DailyBox[]): DailyBox[] => boxes.filter((b) => b.own)

/** The hashes of the modules that ran, for the `incident` event's `components` (local only, redacted in donations). */
export const boxHashes = (boxes: readonly DailyBox[]): string[] => ownBoxes(boxes).map((b) => b.sha256 as string)

/** How many of the four boxes are installed, for the Today card; `slots` is the working record `engine:slots`. */
export const installedBoxCount = (slots: Partial<Record<EngineSlot, unknown>>): number => DAILY_BOXES.filter((s) => slots[s] !== undefined).length

/** "your engine: 2 of 4 boxes", for the Today card and the page header. */
export const engineLine = (own: number): string => `your engine: ${own} of ${DAILY_BOXES.length} boxes`

/** First eight hex digits of a content hash, as the schematic and the install panel show it. */
const shortSha = (sha: string): string => sha.slice(0, 8)

/** One line per box for the debrief: whose it was, and which module when it was yours. */
export function boxLines(boxes: readonly DailyBox[]): string[] {
  return boxes.map((b) => {
    if (b.own) return `${b.label}: yours (${b.labId}, ${shortSha(b.sha256 as string)})`
    if (b.missing) return `${b.label}: reference (your installed module's bytes are not on this device)`
    return `${b.label}: reference`
  })
}

/**
 * What the debrief says about the engine the incident ran on. A run with a box of yours says the expert played the
 * same boxes (W11); a prefix router of yours is loaded and checked, but the incident cluster routes by shortest queue.
 */
export function engineNote(boxes: readonly DailyBox[]): string {
  const own = ownBoxes(boxes)
  if (own.length === 0) return 'This Daily ran on the reference engine. Install a scheduler, block manager, intake queue or prefix router from the Forge, and the next one runs on yours.'
  const names = own.map((b) => b.label)
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  const router = own.some((b) => b.slot === 'prefix-router') ? ' Your prefix router was loaded and checked on every worker; incident clusters route by shortest queue, so it did not choose any route.' : ''
  return `Your ${list} ran this incident. The expert played it on the same boxes, so a slower module costs both of you the same.${router}`
}

/* ------------------------------------------------------------------ */
/* The share string                                                     */
/* ------------------------------------------------------------------ */

/**
 * `KS-Daily #47 · 3 probes · burn 18%`, plus ` · on my engine` when a box of yours ran (§9.7, 2b-21). It carries no
 * hashes, seeds or component names. Burn is the share of the 30 burn-minute budget, rounded.
 */
export function shareString(n: number, probes: number, burn: number, onMyEngine = false): string {
  return `KS-Daily #${n} · ${probes} ${probes === 1 ? 'probe' : 'probes'} · burn ${burnPercent(burn)}%${onMyEngine ? ' · on my engine' : ''}`
}

/** One decimal, for "11.2 burn-minutes". */
export const burnMinutes = (burn: number): string => String(round1(burn))

/* ------------------------------------------------------------------ */
/* The ledger event                                                     */
/* ------------------------------------------------------------------ */

const FAULT_KC: Record<IncidentFault, string> = {
  'pool-shrink': KC.kvCapacity,
  'drain-stall': KC.admissionScheduling,
  'node-death': KC.capacityPlanning,
  'tenant-burst': KC.prefillDecodeInterference,
}

export const KC_NAMES: Record<string, string> = {
  [KC.incidentDiagnosis]: 'Incident diagnosis',
  [KC.kvCapacity]: 'KV capacity',
  [KC.admissionScheduling]: 'Admission scheduling',
  [KC.capacityPlanning]: 'Capacity planning',
  [KC.prefillDecodeInterference]: 'Prefill–decode interference',
}

/** The KCs an incident trains: the diagnosis skill, then the KC its fault belongs to (§9.6). */
export const kcsFor = (fault: IncidentFault): string[] => [KC.incidentDiagnosis, FAULT_KC[fault]]

/** What `finish` reports that the event needs (a structural slice of the fleet protocol's `IncidentFinish`). */
export interface FinishedIncident {
  fault: IncidentFault
  severity: 1 | 2 | 3
  firstHypothesis?: Hypothesis
  hypothesis?: Hypothesis
  probes: ProbeId[]
  fix?: FixId
  diagnosed: boolean
  fixed: boolean
  burn: number
  expertBurn: number
  streetlight: number
}

/** The Daily's `incident` event for `date`; `components` are the hashes of the modules of yours that ran (`boxHashes`). */
export function dailyResult(date: string, spec: IncidentSpec, done: FinishedIncident, components: string[] = []): IncidentResult {
  const data: IncidentData = {
    v: 1,
    src: 'daily',
    fault: done.fault,
    severity: done.severity,
    ...(done.firstHypothesis === undefined ? {} : { firstHypothesis: done.firstHypothesis }),
    ...(done.hypothesis === undefined ? {} : { hypothesis: done.hypothesis }),
    probes: done.probes,
    ...(done.fix === undefined ? {} : { fix: done.fix }),
    diagnosed: done.diagnosed,
    fixed: done.fixed,
    burn: done.burn,
    expertBurn: done.expertBurn,
    streetlight: done.streetlight,
    components,
    date,
    kcs: kcsFor(done.fault),
  }
  return { ref: dailyRef(date), seed: spec.seed, data }
}

/** The slice of the progress store `recordDaily` reads and writes. */
export interface DailyStore {
  getState(): {
    aggregate: { incidents: Record<string, { n: number } | undefined> }
    recordIncident(r: IncidentResult): void
  }
}

/** Whether the ledger already holds an attempt at `date`'s Daily: a replay is practice. */
export const dailyPlayed = (store: DailyStore, date: string): boolean => (store.getState().aggregate.incidents[dailyRef(date)]?.n ?? 0) > 0

/**
 * Write the Daily's one event for `date`: the first completed attempt. Returns whether it wrote. Any later
 * attempt, in this tab, another tab or after a reload, writes nothing.
 */
export function recordDaily(store: DailyStore, date: string, spec: IncidentSpec, done: FinishedIncident, components: string[] = []): boolean {
  if (dailyPlayed(store, date)) return false
  store.getState().recordIncident(dailyResult(date, spec, done, components))
  return true
}

/** The fault menu the hypothesis step shows: the catalog faults in order, then "unsure". */
export const HYPOTHESIS_OPTIONS: readonly { id: Hypothesis; label: string }[] = [
  ...INCIDENT_FAULTS.map((id) => ({ id, label: FAULT_LABELS[id] })),
  { id: 'unsure', label: 'Unsure' },
]

/**
 * The order the two menus show for one incident: the four faults and the four fixes, each shuffled from the incident's
 * own seed and a stream of its own, so position says nothing about the fault (a drill's seed is fresh, so a
 * position learned on one drill is worth nothing on the next). "Unsure" stays last. The same incident always
 * shows the same order, so a replay and a reload do not move the buttons.
 */
export interface MenuOrder {
  hypotheses: readonly { id: Hypothesis; label: string }[]
  fixes: readonly FixId[]
}

export function menuOrderFor(spec: Pick<IncidentSpec, 'seed'>): MenuOrder {
  const faults = shuffledOrder(INCIDENT_FAULTS.length, hash32(`menu:hypothesis:${spec.seed}`)).map((i) => HYPOTHESIS_OPTIONS[i])
  const fixes = shuffledOrder(FIX_IDS.length, hash32(`menu:fix:${spec.seed}`)).map((i) => FIX_IDS[i])
  return { hypotheses: [...faults, HYPOTHESIS_OPTIONS[HYPOTHESIS_OPTIONS.length - 1]], fixes }
}
