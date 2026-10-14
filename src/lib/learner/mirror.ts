/**
 * The Mirror's figures for /me (wave-3.md §12.5, task 3b-06b): VRK₃₀, Today's cold checks by track, calibration with
 * the learned optimism offset, and the competence statements, each from 3a-17's pure selector and all "as of" one day.
 * Pure except `loadMirrorInput`, which reads the ledger and the content on demand so /me's first load stays light.
 *
 * Every figure carries its n, and `enough` says whether n reaches the figure's minimum (§12.5): 5 checked KCs for
 * VRK₃₀'s share, 10 cold checks for a track (or the overall row), 20 rated answers for calibration, 20 first reviews
 * for a learned offset. Below it the page prints "not enough data (n = …)" and no rate, so a small sample is never
 * read as a result. This module imports no lesson content; `loadMirrorInput` fetches it with a dynamic import.
 */

import type { Json, LedgerEvent, LocalDay } from '@/lib/ledger/types'
import { CALIBRATION_MIN_N, selectCalibration, type Calibration } from './calibration'
import { OFFSET_MIN_N, cardsContent, selectOptimismOffset, type CardsContent, type CardsExtra, type CardsPlan, type OptimismOffset } from './cards'
import { COLD_TRACK_MIN_N, selectColdCheckSummary, type ColdCheckSummary } from './cold-checks'
import { competenceEvidence, selectCompetence, type CompetenceStatement } from './competence'
import type { Proportion } from './outcomes'
import { VRK_SHARE_MIN_N, asOf, selectVrk30, type Vrk30 } from './vrk'

export { CALIBRATION_MIN_N, COLD_TRACK_MIN_N, OFFSET_MIN_N, VRK_SHARE_MIN_N }

/** What the Mirror reads: the ledger, the content, and the day the figures are as of. */
export interface MirrorInput {
  events: readonly LedgerEvent[]
  content: CardsContent
  now: LocalDay
  /** The week plan and the placement result, which cards read (cards.ts `deriveCards`). */
  plan?: CardsPlan | null
  extra?: CardsExtra
}

export interface Mirror {
  now: LocalDay
  vrk: Vrk30
  cold: ColdCheckSummary
  calibration: Calibration
  offset: OptimismOffset
  /** Statements shown (the rule of §12.4 holds), in the KC graph's order. */
  competence: CompetenceStatement[]
  /** KCs with credited fresh evidence whose statement is not earned yet. */
  competenceUnmet: number
}

/** Every Mirror figure as of `now`. Duplicate ids collapse and later days wait for their day, whichever order they came in. */
export function buildMirror(input: MirrorInput): Mirror {
  const { content, now, plan, extra } = input
  const events = asOf(input.events, now)
  return {
    now,
    vrk: selectVrk30(events, content, now, plan, extra),
    cold: selectColdCheckSummary(events, content, now),
    calibration: selectCalibration(events),
    offset: selectOptimismOffset(events, content, now, plan, extra),
    competence: selectCompetence(events, content, now),
    competenceUnmet: competenceEvidence(events, content, now).filter((x) => !x.met).length,
  }
}

/* ------------------------------------------------------------------ */
/* Minimums and wording                                                */
/* ------------------------------------------------------------------ */

/** Whether n reaches a figure's minimum. */
export const enough = (n: number, min: number): boolean => n >= min

/** "not enough data (n = 3, needs 10)": what a figure says below its minimum. */
export const notEnough = (n: number, min: number, unit: string): string => `not enough data (n = ${n} ${unit}, needs ${min})`

/** A rate as a whole-number percentage. */
export const pct = (x: number): string => `${Math.round(x * 100)} %`

/** "75 % (95 % interval 30 % to 95 %)"; an empty string with no trial. */
export function rateText(p: Proportion): string {
  if (p.rate === null || p.ci95 === null) return ''
  return `${pct(p.rate)} (95 % interval ${pct(p.ci95[0])} to ${pct(p.ci95[1])})`
}

/** "3 of 4 right, 75 % (95 % interval …), n = 4", or the not-enough line when n is below `min`. */
export function proportionText(p: Proportion, min: number, unit: string, word = 'right'): string {
  if (!enough(p.n, min) || p.rate === null) return notEnough(p.n, min, unit)
  return `${p.correct} of ${p.n} ${word}, ${rateText(p)}, n = ${p.n}`
}

/** "2 months", "1 month". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Whole-number or one-decimal count per month: 2, 2.5. */
export const perMonth = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1))

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/** The raw working records the cards read. */
export interface MirrorWorking {
  week?: Json | undefined
  placement?: Json | undefined
}

/**
 * Read the ledger and the content, then the day. The ledger engine, the lesson corpus and the review model load
 * on demand (as `loadSummary` does), so none of them is in /me's static closure.
 */
export async function loadMirrorInput(working: MirrorWorking, at: Date = new Date()): Promise<MirrorInput> {
  const [{ getLedgerClient }, { loadTodayContent }, { normalizeWeekPlan }, { localDayOf, placementOf }] = await Promise.all([
    import('@/lib/ledger/client'),
    import('@/lib/learner/today'),
    import('@/lib/learner/planner'),
    import('@/lib/learner/summary'),
  ])
  const [client, today] = await Promise.all([getLedgerClient(), loadTodayContent()])
  return {
    events: await client.events(),
    content: cardsContent({ kcs: today.kcs, lessons: today.lessons, bootKcs: today.bootKcs, resolve: today.resolve }),
    now: localDayOf(at),
    plan: normalizeWeekPlan(working.week),
    extra: { placement: placementOf(working.placement) },
  }
}
