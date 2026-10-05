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
  LABS,
  PLAY_MINUTES,
  RING2_LAB,
  RING2_LESSONS,
  RING2_R_LABS,
  SPIRAL_LESSONS,
} from './economy-table'
import type { Aggregate } from './ledger/types'

/** Nominal minutes of the facts that pay a flat price (§8.4). */
export const MINUTES = {
  /** `quiz-pass:` of a ticket, checkpoint or test-out. */
  quiz: 3,
  /** `quiz-pass:` of a spiral checkpoint (t2.l7). */
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

/** Flat price per fact prefix. Prefixes priced from the table (`labc`, `play`, `fw`, `cap`) are in `factMinutes`. */
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

/** Rings whose criteria arrive in Wave 2–3: defined by name, earned by nobody yet. */
export const RINGS_PENDING: readonly RingName[] = ['RING 1', 'RING 0', 'ROOT']

export interface Ring2Status {
  earned: boolean
  /** R1–R5 with every required check passed on seeds drawn at grade time. */
  rDrills: { done: number; total: number; missing: string[] }
  /** Lab 01 likewise. `checks` counts its required checks. */
  lab01: { done: boolean; checks: { done: number; total: number } }
  /** T0–T2 lessons passed (*done*), at any provenance. A lesson that was only *read* does not count. */
  tickets: { done: number; total: number; missing: string[] }
}

export interface Rings {
  /** The highest ring earned, else RING 3. */
  rank: RingName
  /** Every ring earned, outermost first; always includes RING 3. */
  earned: RingName[]
  ring2: Ring2Status
}

/** Required checks of `labId` that are not in `agg.labs[labId].unseen`. A lab missing from the table is never done. */
function unseenGaps(agg: Pick<Aggregate, 'labs'>, labId: string): { total: number; missing: number } {
  const required = own(LABS, labId)?.checks
  if (!required) return { total: 1, missing: 1 }
  const unseen = Object.hasOwn(agg.labs, labId) ? agg.labs[labId].unseen : {}
  return { total: required.length, missing: required.filter((c) => !Object.hasOwn(unseen, c)).length }
}

/**
 * The rings of a ledger (§8.5). Light and sync, so the entry chunk can call it. RING 2 needs R1–R5 and
 * lab 01 on unseen seeds plus all 19 T0–T2 lessons *done*. Every input is monotone in the event set
 * (earliest pass, union of checks), so a ring is never revoked by anything the learner does.
 */
export function selectRings(agg: Pick<Aggregate, 'labs' | 'lessons'>): Rings {
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
  // RING 1, RING 0 and ROOT are never earned until their criteria exist.
  const earned: RingName[] = ring2.earned ? ['RING 3', 'RING 2'] : ['RING 3']
  return { rank: earned[earned.length - 1], earned, ring2 }
}

/* ------------------------------------------------------------------ */
/* Legacy rank helpers                                                  */
/* ------------------------------------------------------------------ */

export interface Rank {
  name: string
  minXp: number
}

/**
 * @deprecated XP no longer decides rank (§8.5: use `selectRings(agg).rank`). Kept only so pages that still
 * call `rankForXp`/`nextRank` compile until Home, Progress, Navbar and Curriculum move to rings (B26); with
 * XP counting minutes these thresholds are not a ring. Delete with the last caller.
 */
export const RANKS: Rank[] = [
  { name: 'ROOT', minXp: 5000 },
  { name: 'RING 0', minXp: 3000 },
  { name: 'RING 1', minXp: 1500 },
  { name: 'RING 2', minXp: 500 },
  { name: 'RING 3', minXp: 0 },
]

/** @deprecated see `RANKS`. */
export function rankForXp(xp: number): Rank {
  return RANKS.find((r) => xp >= r.minXp) ?? RANKS[RANKS.length - 1]
}

/** @deprecated see `RANKS`. */
export function nextRank(xp: number): Rank | null {
  const sorted = [...RANKS].sort((a, b) => a.minXp - b.minXp)
  return sorted.find((r) => r.minXp > xp) ?? null
}

/** YYYY-MM-DD from the learner's LOCAL calendar fields (not UTC), so a day rolls over at their midnight. */
export function localDateKey(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
