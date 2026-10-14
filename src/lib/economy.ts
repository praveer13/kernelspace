/**
 * XP, rings and the local-day key. Pure (no zustand, no DOM), so the ledger core can use them under
 * `bun test`. `progress.ts` re-exports the names it always did, so imports from `@/lib/progress` keep
 * working unchanged.
 *
 * Economy v2 (wave-1.md §8.4–8.5): 1 XP = 1 nominal minute of graded work, each fact paid once, so XP is a
 * function of the fact set and the per-day item seconds and never of event order. Ranks are rings derived
 * from the ledger, no longer XP thresholds.
 */

import {
  CAPSTONE_STEP_MINUTES,
  FLEET_ACT_MINUTES,
  FLEET_RUN_MINUTES,
  INCIDENT_MINUTES,
  LABS,
  PLAY_MINUTES,
  RING0_LABS,
  RING0_LESSONS,
  RING1_LABS,
  RING1_LESSONS,
  RING1_R_LABS,
  RING2_LAB,
  RING2_LESSONS,
  RING2_R_LABS,
  ROOT_ACTS,
  ROOT_COLD,
  ROOT_DAILIES,
  ROOT_FLEET_RUNS,
  ROOT_LAB,
  ROOT_LESSONS,
  SPIRAL_LESSONS,
} from './economy-table'
import type { Aggregate, LedgerEvent } from './ledger/types'

/** Nominal minutes of the facts that pay a flat price (§8.4). */
export const MINUTES = {
  /** `quiz-pass:` of a ticket, checkpoint or test-out. */
  quiz: 3,
  /** `quiz-pass:` of a spiral checkpoint (`SPIRAL_LESSONS`: t2.l7 and the five track-end spirals). */
  spiral: 8,
  /** `simo:`, an outcome-graded sim task. */
  simOutcome: 3,
  /** `prove:`. */
  prove: 5,
  boot: 10,
  placement: 10,
  /** Item minutes (`item`/`probe`/`predict`) stop paying after this many per local day. */
  itemDayCap: 30,
} as const

/**
 * Kept with the same keys as v1, now holding v2 nominal values, so labels written against it compile while
 * their pages move to the table. `lab` is a whole lab's nominal minutes in general (lab 01: 90); the
 * per-lab and per-step numbers come from `economy-table.ts`.
 */
export const XP = {
  lesson: 0,
  quiz: MINUTES.quiz,
  exercise: 0,
  capstoneStep: 20,
  lab: 90,
  fleetWeekAct: 30,
} as const

/** Flat price per fact prefix. Prefixes priced from the table (`labc`, `play`, `fw`, `cap`, `inc`, `fleet`) are in `factMinutes`. */
export const FACT_UNITS = {
  lesson: XP.lesson,
  exercise: XP.exercise,
  sim: 0, // the legacy sim-task fact: a toggle, 0 XP
  'quiz-pass': MINUTES.quiz,
  simo: MINUTES.simOutcome,
  prove: MINUTES.prove,
  boot: MINUTES.boot,
  placement: MINUTES.placement,
} as const satisfies Record<string, number>

/** Where XP came from. The split is reported (§8.4: labs and practice carry at least 70 %). */
export type XpSource = 'labs' | 'practice' | 'tickets' | 'fleet' | 'capstone' | 'onboarding'

export const XP_SOURCES: readonly XpSource[] = ['labs', 'practice', 'tickets', 'fleet', 'capstone', 'onboarding']

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined

/** A fact split at its first colon; `boot` and `placement` have no tail. */
function splitFact(fact: string): { prefix: string; tail: string } {
  const colon = fact.indexOf(':')
  return colon < 0 ? { prefix: fact, tail: '' } : { prefix: fact.slice(0, colon), tail: fact.slice(colon + 1) }
}

/** Nominal minutes of one fact, and the source it counts under. Unknown facts, labs, checks and steps pay 0. */
function price(fact: string): { minutes: number; source: XpSource } | null {
  const { prefix, tail } = splitFact(fact)
  switch (prefix) {
    case 'quiz-pass':
      return { minutes: SPIRAL_LESSONS.includes(tail) ? MINUTES.spiral : MINUTES.quiz, source: 'tickets' }
    case 'labc': {
      const slash = tail.indexOf('/')
      const lab = slash < 0 ? undefined : own(LABS, tail.slice(0, slash))
      // Only a required check pays: an optional one or an unknown lab is a different kind of evidence.
      if (!lab || !lab.checks.includes(tail.slice(slash + 1))) return null
      return { minutes: lab.minutes / lab.checks.length, source: 'labs' }
    }
    case 'simo':
      return { minutes: MINUTES.simOutcome, source: 'practice' }
    case 'play': {
      const minutes = own(PLAY_MINUTES, tail)
      return minutes === undefined ? null : { minutes, source: 'practice' }
    }
    case 'prove':
      return { minutes: MINUTES.prove, source: 'practice' }
    case 'fw': {
      const minutes = own(FLEET_ACT_MINUTES, tail)
      return minutes === undefined ? null : { minutes, source: 'fleet' }
    }
    case 'inc': {
      // `inc:daily/<date>` and `inc:drill/<fault>`: the first segment prices it.
      const minutes = own(INCIDENT_MINUTES, tail.slice(0, Math.max(0, tail.indexOf('/'))))
      return minutes === undefined ? null : { minutes, source: 'fleet' }
    }
    case 'fleet':
      return tail === '' ? null : { minutes: FLEET_RUN_MINUTES, source: 'fleet' }
    case 'cap': {
      const minutes = own(CAPSTONE_STEP_MINUTES, tail)
      return minutes === undefined ? null : { minutes, source: 'capstone' }
    }
    case 'boot':
      return tail === '' ? { minutes: MINUTES.boot, source: 'onboarding' } : null
    case 'placement':
      return tail === '' ? { minutes: MINUTES.placement, source: 'onboarding' } : null
    default:
      return null // lesson:, exercise:, the legacy sim: and anything unknown: clicks and toggles
  }
}

/** The nominal minutes one fact pays. */
export function factMinutes(fact: string): number {
  return price(fact)?.minutes ?? 0
}

/**
 * A whole lab's nominal XP: its `minutes`, paid across its required checks (§8.4). Pages label a lab with this
 * instead of a local number. 0 for an unknown lab.
 */
export function labXp(labId: string): number {
  return own(LABS, labId)?.minutes ?? 0
}

/** What one required check of a lab pays the first time any run passes it: `labXp ÷ required checks`. */
export function labCheckXp(labId: string): number {
  const lab = own(LABS, labId)
  return lab === undefined || lab.checks.length === 0 ? 0 : lab.minutes / lab.checks.length
}

/**
 * XP by source for an aggregate. Each source is a whole number. Within a source the minutes are summed
 * as integer millionths first, so the sum cannot depend on the order the facts were folded in, and are
 * rounded once at the end.
 */
export function xpBySource(agg: Pick<Aggregate, 'facts' | 'itemSec'>): Record<XpSource, number> {
  const micro: Record<XpSource, number> = { labs: 0, practice: 0, tickets: 0, fleet: 0, capstone: 0, onboarding: 0 }
  for (const fact of Object.keys(agg.facts)) {
    const p = price(fact)
    if (p) micro[p.source] += Math.round(p.minutes * 1e6)
  }
  // Graded items pay their nominal seconds, at most `itemDayCap` minutes per local day.
  const capSec = MINUTES.itemDayCap * 60
  let itemSec = 0
  for (const sec of Object.values(agg.itemSec)) itemSec += Math.min(Math.max(sec, 0), capSec)
  micro.practice += Math.round((itemSec / 60) * 1e6)

  const out = { ...micro }
  for (const source of XP_SOURCES) out[source] = Math.round(micro[source] / 1e6)
  return out
}

/** Total XP: the sum of `xpBySource`, so the split always adds up to the headline number. */
export function xpOf(agg: Pick<Aggregate, 'facts' | 'itemSec'>): number {
  const by = xpBySource(agg)
  return XP_SOURCES.reduce((sum, source) => sum + by[source], 0)
}

/* ------------------------------------------------------------------ */
/* Rings                                                               */
/* ------------------------------------------------------------------ */

/** Outermost first. A ring is earned from the ledger and never revoked or gated (W8). */
export type RingName = 'RING 3' | 'RING 2' | 'RING 1' | 'RING 0' | 'ROOT'

export const RING_NAMES: readonly RingName[] = ['RING 3', 'RING 2', 'RING 1', 'RING 0', 'ROOT']

export interface Ring2Status {
  earned: boolean
  /** R1–R5 with every required check passed on seeds drawn at grade time. */
  rDrills: { done: number; total: number; missing: string[] }
  /** Lab 01 likewise. `checks` counts its required checks. */
  lab01: { done: boolean; checks: { done: number; total: number } }
  /** T0–T2 lessons passed (*done*), at any provenance. A lesson that was only *read* does not count. */
  tickets: { done: number; total: number; missing: string[] }
}

/** One line of a checklist: `done` of `total` things, and the ids still open, in table order. */
export interface Part {
  done: number
  total: number
  missing: string[]
}

export interface Ring1Status {
  earned: boolean
  /** R6–R10 with every required check passed on unseen seeds. */
  rDrills: Part
  /** Labs 04 and 05 likewise. */
  labs: Part
  /** T3 and T4 lessons *done*. */
  tickets: Part
}

export interface Ring0Status {
  earned: boolean
  /** Labs 02, 03, 06 and 07 likewise. */
  labs: Part
  /** T5 lessons *done*. */
  tickets: Part
}

/** The achievement id (`ach:root-cold`) that records the first time ROOT's cold-check bar was met, so a merge cannot revoke it. */
export const ROOT_COLD_ACHIEVEMENT = 'root-cold'

/** Today `probe`s on a KC last exposed at least `ROOT_COLD.days` earlier (`selectColdChecks`). */
export interface ColdChecks {
  n: number
  correct: number
  /** The bar (`ROOT_COLD.n` checks, `ROOT_COLD.rate` right) was met at some point in time order, or its first time is recorded (`ROOT_COLD_ACHIEVEMENT`), so a miss never takes ROOT away. */
  met: boolean
}

export interface RootStatus {
  earned: boolean
  /** Lab 08 on unseen seeds. */
  lab08: { done: boolean; checks: { done: number; total: number } }
  /** Fleet Week acts I and II with own modules on unseen seeds; `missing` holds `act1` and `act2`. */
  fleetRuns: Part
  /** Fleet Week acts passed (`engine`, `fleet`, `business`). */
  acts: Part
  /** Distinct local dates with a solved Fleet Daily; `done` may exceed `total`. */
  daily: { done: number; total: number }
  /** T6 and T7 lessons *done*. */
  tickets: Part
  cold: ColdChecks & { needN: number; needRate: number }
}

export interface Rings {
  /** The highest ring earned, else RING 3. */
  rank: RingName
  /** Every ring earned, outermost first; always includes RING 3. Each ring stands on its own criteria. */
  earned: RingName[]
  ring2: Ring2Status
  ring1: Ring1Status
  ring0: Ring0Status
  root: RootStatus
}

/** Required checks of `labId` that are not in `agg.labs[labId].unseen`. A lab missing from the table is never done. */
function unseenGaps(agg: Pick<Aggregate, 'labs'>, labId: string): { total: number; missing: number } {
  const required = own(LABS, labId)?.checks
  if (!required) return { total: 1, missing: 1 }
  const unseen = Object.hasOwn(agg.labs, labId) ? agg.labs[labId].unseen : {}
  return { total: required.length, missing: required.filter((c) => !Object.hasOwn(unseen, c)).length }
}

const partOf = (ids: readonly string[], has: (id: string) => boolean): Part => {
  const missing = ids.filter((id) => !has(id))
  return { done: ids.length - missing.length, total: ids.length, missing }
}

/** The labs of `ids` whose required checks are all in `unseen`. */
const labsPart = (agg: Pick<Aggregate, 'labs'>, ids: readonly string[]): Part => partOf(ids, (id) => unseenGaps(agg, id).missing === 0)

/** The lessons of `ids` that were passed (ticket, spiral, test-out or checkpoint); a lesson only *read* is not. */
const lessonsPart = (agg: Pick<Aggregate, 'lessons'>, ids: readonly string[]): Part =>
  partOf(ids, (id) => Object.hasOwn(agg.lessons, id) && agg.lessons[id].passedAt !== undefined)

const complete = (p: Part): boolean => p.missing.length === 0

/** Events oldest first, ties by id, so a replay does not depend on the order a merge delivered them. */
const inOrder = (a: LedgerEvent, b: LedgerEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * ROOT's cold checks (§6.4): Today `probe` events whose `data.sinceDays` is at least 30 (Today writes the gap
 * since the KC was last exposed on the event), not assisted. They need the events, which the aggregate does not
 * keep, so only a page that has read the ledger can pass the result to `selectRings`. `met` says the bar was
 * reached at some point in time order, so appended events never lower it and a later miss is no revocation (W8).
 * A merge can insert earlier misses from another device, though, and that moves the prefix where the bar was
 * reached; so the first time the bar is met is recorded as the `ach:root-cold` achievement (the earliest one
 * wins, as for every achievement), and once it is in the ledger `met` holds in any merge.
 */
export function selectColdChecks(events: Iterable<LedgerEvent>): ColdChecks {
  const seen = new Set<string>()
  const probes: LedgerEvent[] = []
  let recorded = false
  for (const e of events) {
    if (e.kind === 'achievement' && e.ref === `ach:${ROOT_COLD_ACHIEVEMENT}`) recorded = true
    if (e.kind !== 'probe' || seen.has(e.id)) continue
    const data = (e as { data?: unknown }).data
    if (typeof data !== 'object' || data === null || Array.isArray(data)) continue
    const d = data as Record<string, unknown>
    if (d.src !== 'today' || typeof d.sinceDays !== 'number' || d.sinceDays < ROOT_COLD.days) continue
    if ((e as { provenance?: string }).provenance === 'assisted') continue
    seen.add(e.id)
    probes.push(e)
  }
  probes.sort(inOrder)
  let correct = 0
  let met = false
  probes.forEach((e, i) => {
    if ((e as { ok?: boolean }).ok === true) correct += 1
    // compare as a ratio with a hair of slack: 0.8 is not exact in binary
    if (i + 1 >= ROOT_COLD.n && correct / (i + 1) >= ROOT_COLD.rate - 1e-9) met = true
  })
  return { n: probes.length, correct, met: met || recorded }
}

/**
 * The rings of a ledger (§8.5; wave-2.md §6.4). Light and sync, so the entry chunk can call it. Every ring
 * stands on its own criteria and none gates anything; every input is monotone in the event set (earliest pass,
 * union of checks, a count of distinct dates), so a ring is never revoked by anything the learner does.
 *
 * - RING 2: R1–R5 and lab 01 on unseen seeds, all 19 T0–T2 lessons *done*.
 * - RING 1: R6–R10, labs 04 and 05 on unseen seeds, all T3 and T4 lessons *done*.
 * - RING 0: labs 02, 03, 06 and 07 on unseen seeds, all T5 lessons *done*.
 * - ROOT: lab 08; Fleet Week acts I and II on unseen seeds with own modules; the three Fleet Week acts
 *   passed; 5 Daily incidents; all T6 and T7 lessons *done*; and the cold-check bar.
 *
 * `cold` is `selectColdChecks(events)`. The shell's chip reads the snapshot only and passes none, so it names
 * ROOT only for a caller that has read the ledger's cold checks; without them ROOT is not earned.
 */
export function selectRings(
  agg: Pick<Aggregate, 'labs' | 'lessons' | 'fleetWeek' | 'fleetRuns' | 'dailyDays'>,
  cold?: ColdChecks,
): Rings {
  const rMissing = RING2_R_LABS.filter((id) => unseenGaps(agg, id).missing > 0)
  const gaps = unseenGaps(agg, RING2_LAB)
  const ticketsMissing = RING2_LESSONS.filter(
    (id) => !(Object.hasOwn(agg.lessons, id) && agg.lessons[id].passedAt !== undefined),
  )
  const ring2: Ring2Status = {
    earned: rMissing.length === 0 && gaps.missing === 0 && ticketsMissing.length === 0,
    rDrills: { done: RING2_R_LABS.length - rMissing.length, total: RING2_R_LABS.length, missing: rMissing },
    lab01: { done: gaps.missing === 0, checks: { done: gaps.total - gaps.missing, total: gaps.total } },
    tickets: { done: RING2_LESSONS.length - ticketsMissing.length, total: RING2_LESSONS.length, missing: ticketsMissing },
  }

  const r1 = { rDrills: labsPart(agg, RING1_R_LABS), labs: labsPart(agg, RING1_LABS), tickets: lessonsPart(agg, RING1_LESSONS) }
  const ring1: Ring1Status = { earned: complete(r1.rDrills) && complete(r1.labs) && complete(r1.tickets), ...r1 }

  const r0 = { labs: labsPart(agg, RING0_LABS), tickets: lessonsPart(agg, RING0_LESSONS) }
  const ring0: Ring0Status = { earned: complete(r0.labs) && complete(r0.tickets), ...r0 }

  const lab08 = unseenGaps(agg, ROOT_LAB)
  const rt = {
    lab08: { done: lab08.missing === 0, checks: { done: lab08.total - lab08.missing, total: lab08.total } },
    fleetRuns: partOf(ROOT_FLEET_RUNS, (id) => Object.hasOwn(agg.fleetRuns, id) && agg.fleetRuns[id].unseenOk === true),
    acts: partOf(ROOT_ACTS, (id) => Object.hasOwn(agg.fleetWeek.acts, id)),
    daily: { done: Object.keys(agg.dailyDays).length, total: ROOT_DAILIES },
    tickets: lessonsPart(agg, ROOT_LESSONS),
    cold: { n: cold?.n ?? 0, correct: cold?.correct ?? 0, met: cold?.met ?? false, needN: ROOT_COLD.n, needRate: ROOT_COLD.rate },
  }
  const root: RootStatus = {
    earned:
      rt.lab08.done && complete(rt.fleetRuns) && complete(rt.acts) && rt.daily.done >= rt.daily.total && complete(rt.tickets) && rt.cold.met,
    ...rt,
  }

  const earned: RingName[] = ['RING 3']
  if (ring2.earned) earned.push('RING 2')
  if (ring1.earned) earned.push('RING 1')
  if (ring0.earned) earned.push('RING 0')
  if (root.earned) earned.push('ROOT')
  return { rank: earned[earned.length - 1], earned, ring2, ring1, ring0, root }
}

/** YYYY-MM-DD from the learner's LOCAL calendar fields (not UTC), so a day rolls over at their midnight. */
export function localDateKey(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
