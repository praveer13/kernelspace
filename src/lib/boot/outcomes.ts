/**
 * K4 Boot outcomes (docs/specs/ledger-v3.md §12.4): the activation lever "finish Boot with at least 3
 * correct (of 5 graded) and return for a second graded session within 7 days", plus the first-success
 * time behind the K4 metric "every partner's first-success time, median <= 4 min".
 *
 * Pure over ledger events. Only the first Boot session counts: a replay never changes the numbers.
 */

import type { BootOutcome, IsoInstant, LedgerEvent } from '@/lib/ledger/types'

const WEEK_MS = 7 * 86_400_000

const ms = (at: IsoInstant): number => Date.parse(at)

const isBootRef = (ref: string): boolean => ref === 'boot' || ref.startsWith('boot:')

/** The graded Boot steps: a committed prediction or an answered item on a `boot:<step>` ref. */
const isBootGraded = (e: LedgerEvent): e is Extract<LedgerEvent, { score: number }> =>
  (e.kind === 'predict' || e.kind === 'item') && e.ref.startsWith('boot:')

const byTime = (a: LedgerEvent, b: LedgerEvent): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

export interface BootOutcomeOptions {
  /**
   * The instant to judge the 7-day window against. Without it, `returnedWithin7Days` is `true` once a
   * return is seen and `null` otherwise, because "not yet" cannot be told from "never".
   */
  now?: IsoInstant
}

/**
 * - The session ends at the earliest `complete boot` (or never). It starts at the last `visit boot` at or
 *   before the first graded Boot event, so a learner who bounced and came back days later is not timed
 *   across the idle gap (the page writes a `visit boot` on every mount until Boot is complete).
 * - Each graded step counts once, by its first answer in the session.
 * - `firstSuccessMs` and `totalMs` prefer the figures the page wrote on `complete boot` (its own run
 *   clock); without them they run from the session start to the first correct step and to completion.
 * - A return is a graded event outside Boot on a later local day, at most 7 days after completion.
 */
export function selectBootOutcome(events: Iterable<LedgerEvent>, opts: BootOutcomeOptions = {}): BootOutcome {
  const boot = [...events].filter((e) => isBootRef(e.ref)).sort(byTime)
  const none: BootOutcome = {
    completedAt: null,
    correct: 0,
    graded: 0,
    firstSuccessMs: null,
    totalMs: null,
    returnedWithin7Days: null,
  }
  if (boot.length === 0) return none

  const done = boot.find((e) => e.kind === 'complete' && e.ref === 'boot')
  const inSession = (e: LedgerEvent): boolean => done === undefined || e.at <= done.at

  const steps = new Map<string, Extract<LedgerEvent, { score: number }>>()
  for (const e of boot) {
    if (isBootGraded(e) && inSession(e) && !steps.has(e.ref)) steps.set(e.ref, e)
  }
  const answered = [...steps.values()]
  const firstOk = answered.find((e) => e.ok)

  const firstGraded = boot.find((e) => isBootGraded(e))
  const visits = boot.filter((e) => e.kind === 'visit' && e.ref === 'boot' && (firstGraded === undefined || e.at <= firstGraded.at))
  const start = visits.length > 0 ? visits[visits.length - 1] : boot[0]
  const own: Record<string, unknown> | undefined = done?.kind === 'complete' ? done.data : undefined
  const reported = (key: 'firstSuccessMs' | 'totalMs'): number | null => {
    const v = own?.[key]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
  }

  const completedAt = done?.at ?? null
  return {
    completedAt,
    correct: answered.filter((e) => e.ok).length,
    graded: answered.length,
    firstSuccessMs: firstOk ? (reported('firstSuccessMs') ?? Math.max(0, ms(firstOk.at) - ms(start.at))) : null,
    totalMs: completedAt ? (reported('totalMs') ?? Math.max(0, ms(completedAt) - ms(start.at))) : null,
    returnedWithin7Days: completedAt ? returned(events, done!, opts.now) : null,
  }
}

function returned(events: Iterable<LedgerEvent>, done: LedgerEvent, now?: IsoInstant): boolean | null {
  const deadline = ms(done.at) + WEEK_MS
  for (const e of events) {
    if (isBootRef(e.ref) || !('score' in e) || typeof e.score !== 'number') continue
    if (e.day > done.day && ms(e.at) <= deadline) return true
  }
  return now !== undefined && ms(now) > deadline ? false : null
}

/** The K4 activation lever: at least 3 correct of the 5 graded, and back for a graded session within a week. */
export const isActivated = (o: BootOutcome): boolean => o.completedAt !== null && o.correct >= 3 && o.returnedWithin7Days === true
