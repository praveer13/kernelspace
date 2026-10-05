/**
 * The learner model of Wave 1 (K2 Today, K3 placement and Up Next, V5 tickets): shared types
 * (docs/specs/wave-1.md §6-§8).
 *
 * Types only. Everything here is DERIVED from the ledger (and static content) by pure functions;
 * nothing is stored except where the spec names a working record.
 */

import type { TrackId } from '@/data/lessons/types'
import type { Level, PlayableItem } from '@/lib/items/types'
import type { KcId } from '@/lib/kc/types'
import type { IsoInstant, LearningPath, LocalDay, TicketForm } from '@/lib/ledger/types'

export type { TicketForm }

/* ------------------------------------------------------------------ */
/* FSRS-6 cards (spec §6.1-§6.2)                                       */
/* ------------------------------------------------------------------ */

/** FSRS grade: Again, Hard, Good, Easy. */
export type Rating = 1 | 2 | 3 | 4

/** FSRS-6 memory state. `stability` in days (the interval at which R = 0.9), `difficulty` in [1, 10]. */
export interface MemoryState {
  stability: number
  difficulty: number
}

export type CardOrigin = 'ticket' | 'testout' | 'placement' | 'boot'

/** One card per KC. Created by the creation rule (spec §6.2), never by lesson access. */
export interface Card {
  kc: KcId
  origin: CardOrigin
  /** Local day the card entered the queue (after the ≤ 1.2/day cap). */
  createdDay: LocalDay
  /** null until the first review after creation. */
  memory: MemoryState | null
  lastReviewDay: LocalDay | null
  reps: number
  lapses: number
  /** First local day on which predicted recall falls below the learner's scheduling target. */
  dueDay: LocalDay
  /** A sure-and-wrong answer since the last success: served before every other due card. */
  priority: boolean
  /** Test-out and placement cards: a confirmation review is due on this day (creation + 7). */
  confirmDay?: LocalDay
}

export interface CardSet {
  cards: Record<KcId, Card>
  /** KCs that earned a card but wait for the creation cap, in creation priority order. */
  pending: KcId[]
  /** The optimism offset in force (spec §6.2). */
  offset: number
  /** Creation is paused because due work exceeds two sessions (debt mode). */
  paused: boolean
}

/** Predicted vs observed recall on first reviews (the Wave 1 exit gate, spec §17). */
export interface FirstReviewCalibration {
  n: number
  meanPredicted: number | null
  observed: number | null
  /** Wilson 95 % interval on `observed`. */
  ci95: [number, number] | null
}

/* ------------------------------------------------------------------ */
/* Today: composer and planner (spec §6.3-§6.5)                         */
/* ------------------------------------------------------------------ */

export type SessionMode = 'normal' | 'debt' | 'reentry'

export type SlotReason =
  /** sure-and-wrong since the last success */
  | 'priority'
  /** a due threshold KC */
  | 'threshold'
  | 'due'
  /** test-out or placement confirmation at day 7 */
  | 'confirm'
  /** a cold check: a KC learned ≥ 7 days ago that is not due (measurement, still a review) */
  | 'probe'
  /** "keep going" practice after the plan is done */
  | 'extra'

export interface SessionSlot {
  kc: KcId
  item: PlayableItem
  level?: Level
  reason: SlotReason
}

export interface SessionPlan {
  /** Fresh UUID per session; becomes every item event's `data.grp`. */
  id: string
  day: LocalDay
  mode: SessionMode
  slots: SessionSlot[]
  estMinutes: number
  /** "recall SLO 0.90 · error budget 4 cards · refresh due". Never rendered as an overdue count in re-entry. */
  budget: { slo: number; allowed: number; belowSlo: number }
}

export type DayKind = 'phone' | 'laptop' | 'rest'

export interface PlannerDay {
  day: LocalDay
  kind: DayKind
  targetMinutes: number
  /** Nominal graded minutes earned that day (the XP of that day, spec §8.4). */
  doneMinutes: number
}

export interface WeekStatus {
  /** Local day the week starts (Monday). */
  weekStart: LocalDay
  targetMinutes: number
  doneMinutes: number
  days: PlannerDay[]
  /** null while the week is still running. */
  met: boolean | null
}

/* ------------------------------------------------------------------ */
/* K3: placement and Up Next (spec §7)                                  */
/* ------------------------------------------------------------------ */

/** Stored as the working record `placement:result` (JSON-safe). */
export interface PlacementResult {
  v: 1
  at: IsoInstant
  entryTrack: TrackId
  solidKcs: KcId[]
  missedKcs: KcId[]
  /** Misconception ids of the lures picked (e.g. `t2.cfs-current`). */
  misconceptions: string[]
  rustAnchor: 'solid' | 'missed' | 'skipped'
  items: number
}

export type RecommendationKind = 'boot' | 'today' | 'lesson' | 'lab' | 'play' | 'placement' | 'week'

/** The one Up Next (K3): where to go and a one-line why. */
export interface Recommendation {
  kind: RecommendationKind
  /** Lesson id, lab id, play id, or '' */
  ref: string
  /** Route to open. */
  to: string
  title: string
  /** ≤ 90 characters, e.g. "T1.L4 needs split and coalesce from T1.L3 first". */
  why: string
  minutes: number
}

/** The ordered lesson sequence a path implies (braided for the full ramp). */
export interface PathPlan {
  path: LearningPath
  lessons: string[]
  /** Lab ids placed after their host lesson, as `lab:<id>` entries in `steps`. */
  steps: string[]
}

/* ------------------------------------------------------------------ */
/* V5: exit tickets, spiral checkpoints and test-out (spec §8)          */
/* ------------------------------------------------------------------ */

export interface TicketPlan {
  lessonId: string
  form: TicketForm
  /** Drives item choice and every generated item's seed. */
  seed: number
  items: PlayableItem[]
  /** Index of the non-MCQ item (generated numeric/estimate or a constructed response). */
  nonMcqIndex: number
  /** Ticket and test-out: ≥ 2 of 3 with the non-MCQ correct. Spiral: ≥ 6 of 8 with ≥ 1 non-MCQ correct. */
  passRule: { minCorrect: number; requireNonMcq: boolean }
}
