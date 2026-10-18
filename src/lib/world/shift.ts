/**
 * world/shift — the On-Call pilot's shift mode of the Daily (docs/specs/wave-3.md §16.6, task 3s-08).
 *
 * `/daily?shift=3` plays three incidents in a row. This is the pilot, not the On-Call shift (D23): the shift itself is
 * a Wave 4 item, gated on the Fleet Daily's keep-or-kill, and the pilot only gives the owner something to run a
 * think-aloud session on (docs/oncall/pilot.md). Page-safe and deterministic, like world/daily: it imports the incident
 * catalogs and types, never `Date`, a clock or storage.
 *
 * WHAT IS HERE
 *   - The shift's identity: `shiftSeed(date)` is one seed per local date, and `shiftIncidents(date)` draws the three
 *     incidents' seeds from it in order. Each incident is generated in the drill namespace (`generateIncident('drill',
 *     key)`, the key a seed's eight hex digits, as Act IV's drills spell it), so the page plays the Daily's flow on it.
 *     The same date gives everybody the same shift, which is what lets the owner compare sessions. The three faults are
 *     drawn independently: a shift that never repeated a fault would let the learner rule the third one out by
 *     elimination, and a handoff note that named which faults were gone would give the next fault away.
 *   - The handoff note (`handoffNote`) and the summary after the third incident (`shiftSummary`), in `shift-note`: pure
 *     functions of what the debrief already showed. They are shown on the page and held in its memory, never written:
 *     nothing here touches the ledger, a working key or browser storage, and the recorded event carries no text from
 *     them (tests/world/shift.test.ts checks both). They sit in a module of their own because Act IV's drills import
 *     this one only for `recordShift`, and a shared module is one chunk that every importer downloads whole.
 *   - The record (`shiftResult`, `recordShift`): one `incident` event per incident per date, graded practice.
 *
 * WHY THE EVENT IS A TEAM-GRAMMAR REF. The ledger contract adds no ref grammar in Wave 3 (D4) and `codec.ts` holds
 * `data.src` to the ref's source. A `drill` event is graded `unseen` by the façade and sets the `inc:drill/<fault>` fact
 * that Act IV and the economy read; a `daily` one is what `dailyPlayed`, the Today card and the F3 selector
 * (`selectDailyVsOther`) count. A shift's seeds are public (a function of the date), so neither is right: its events
 * would stand as unseen evidence or as extra Dailies in the keep-or-kill comparison. The team grammar
 * (`inc:team/<code>/<date>`) is graded practice, sets no fact, pays nothing (`economy.ts` prices `daily` and `drill`
 * only) and is not read by F3, so each incident writes `inc:team/shift-<k>/<date>`.
 *
 * RECORDING. Like the Daily, the first completed attempt at an incident of a date writes its event and a replay writes
 * nothing; the ledger already knows (`aggregate.incidents[ref].n`), so a second tab or a reload cannot write twice.
 */

import type { IncidentData, IncidentRef, IncidentResult } from '@/lib/ledger/types'
import { hash32, splitmix32u } from '@/lib/rng'
import { INCIDENT_MAX_MS, dailyResult, recordedMs, type FinishedIncident, type IncidentSource } from './daily'
import { generateIncident, type IncidentSpec } from './incident-spec'

/** The shift's length: `?shift=3` is the only value that turns it on. */
export const SHIFT_LENGTH = 3

/** Whether a `?shift=` value asks for the shift. Anything else (absent, `0`, `2`, `3x`) is the ordinary Daily. */
export const shiftRequested = (raw: string | null): boolean => raw === String(SHIFT_LENGTH)

/** The shift's one seed, for a local date. A namespace of its own, so it shares no stream with the Daily's incident. */
export const shiftSeed = (date: string): number => hash32(`shift:${date}`)

/** A drill's seed as the incident's key: eight hex digits (Act IV's `drillKey`, repeated here so the Daily page does not load Fleet Week). */
export const seedKey = (seed: number): string => (seed >>> 0).toString(16).padStart(8, '0')

/** One incident of the shift. */
export interface ShiftIncident {
  /** 0-based position in the shift */
  index: number
  seed: number
  source: IncidentSource
  spec: IncidentSpec
  /** the ledger ref its event is written under */
  ref: IncidentRef
}

export const shiftRef = (date: string, index: number): IncidentRef => `inc:team/shift-${index + 1}/${date}`

/** The shift of `date`: `SHIFT_LENGTH` incidents, their seeds the first draws of the shift seed's stream. */
export function shiftIncidents(date: string): ShiftIncident[] {
  const next = splitmix32u(shiftSeed(date))
  return Array.from({ length: SHIFT_LENGTH }, (_, index) => {
    const seed = next()
    const source: IncidentSource = { ns: 'drill', key: seedKey(seed) }
    return { index, seed, source, spec: generateIncident(source.ns, source.key), ref: shiftRef(date, index) }
  })
}

/* ------------------------------------------------------------------ */
/* What a note reads (the notes are in shift-note)                      */
/* ------------------------------------------------------------------ */

/** What a finished incident reports that the note reads (a structural slice of the fleet protocol's `IncidentFinish`). */
export interface ShiftFacts extends FinishedIncident {
  alert: number
  /** the clock minute the incident ended */
  end: number
  recovered: boolean
}

/** A note: a heading and one sentence a line. */
export interface ShiftNote {
  heading: string
  lines: string[]
}

/**
 * Which suspect the learner held, as a debrief scores it: `fault` (the suspect was the fault), `wrong` (a suspect that was
 * not), or `none` (nobody: no hypothesis was logged, or the answer was "unsure"). `diagnosed` alone cannot tell the last
 * two apart, and `hypothesis` is the one held when the first fix went in (incident-sim `outcome`), so it is read first.
 * It sits here, not in `shift-note`, because Interview mode's debrief line reads it too and must not load the notes.
 */
export function suspectHeld(done: Pick<ShiftFacts, 'diagnosed' | 'hypothesis'>): 'fault' | 'wrong' | 'none' {
  if (done.hypothesis === undefined || done.hypothesis === 'unsure') return 'none'
  return done.diagnosed ? 'fault' : 'wrong'
}

/* ------------------------------------------------------------------ */
/* The ledger event                                                     */
/* ------------------------------------------------------------------ */

/**
 * The shift incident's `incident` event: the Daily's data (`dailyResult`: the outcome, the incident's KCs, no
 * components) under the team ref and `src`, with the date of the shift. The seed is the incident's own, public. `ms` is the
 * attempt's visible time from the alert to the end of the flow, capped at `INCIDENT_MAX_MS`.
 */
export function shiftResult(date: string, incident: ShiftIncident, done: FinishedIncident, ms?: number): IncidentResult {
  const base = dailyResult(date, incident.spec, done, [], ms)
  const data: IncidentData = { ...base.data, src: 'team' }
  const time = recordedMs(ms, INCIDENT_MAX_MS)
  return { ref: incident.ref, seed: incident.seed, ...(time === undefined ? {} : { ms: time }), data }
}

/** The slice of the progress store `recordShift` reads and writes. */
export interface ShiftStore {
  getState(): {
    aggregate: { incidents: Record<string, { n: number } | undefined> }
    recordIncident(r: IncidentResult): void
  }
}

/** Whether the ledger already holds an attempt at this incident of the shift. */
export const shiftPlayed = (store: ShiftStore, incident: Pick<ShiftIncident, 'ref'>): boolean => (store.getState().aggregate.incidents[incident.ref]?.n ?? 0) > 0

/** Write the incident's one event for `date`: the first completed attempt. Returns whether it wrote; a replay writes nothing. */
export function recordShift(store: ShiftStore, date: string, incident: ShiftIncident, done: FinishedIncident, ms?: number): boolean {
  if (shiftPlayed(store, incident)) return false
  store.getState().recordIncident(shiftResult(date, incident, done, ms))
  return true
}
