/**
 * Cold-check summaries for /me (wave-3.md §12.3). A cold check is a Today `probe` slot: a KC the learner has not
 * met for a while, asked without warning, with `data.sinceDays` the whole days since they last met it
 * (today.ts `itemResponseOf`). This module counts them at two ages, 7 days or more and 30 days or more, overall
 * and by track, each with n, accuracy and a Wilson 95 % interval. Pure: `now` is a parameter.
 *
 * - Only Today's probes count (`src: 'today'`); Wave 0b's lesson cold checks (`src: 'cold'`) are not slots.
 * - An assisted probe is not retrieval and is left out, as ROOT leaves it out (economy.ts `selectColdChecks`).
 * - A probe counts once overall, and once in each track its KCs belong to; a probe whose KCs nothing resolves
 *   counts overall only.
 * - Events dated after `now` count once their day comes; a duplicate id counts once.
 */

import type { TrackId } from '@/data/lessons/types'
import type { KcId } from '@/lib/kc/types'
import type { LedgerEvent, LocalDay } from '@/lib/ledger/types'
import type { CardsContent } from './cards'
import type { Proportion } from './outcomes'
import { asOf, proportionOf } from './vrk'

/** The two ages a cold check is reported at, in days since the KC was last met. */
export const COLD_MIN_DAYS = 7
export const COLD_LONG_DAYS = 30
/** Checks below which /me shows "not enough data" for a track (§12.5). */
export const COLD_TRACK_MIN_N = 10

/** Tracks in curriculum order; a track the graph does not know sorts after them. */
const TRACK_ORDER: readonly TrackId[] = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']

export interface ColdCheckRow {
  /** null for the overall row. */
  track: TrackId | null
  /** Cold checks at 7 days or more. */
  d7: Proportion
  /** Cold checks at 30 days or more (a subset of `d7`). */
  d30: Proportion
}

export interface ColdCheckSummary {
  overall: ColdCheckRow
  /** Tracks with at least one cold check, in curriculum order. */
  tracks: ColdCheckRow[]
}

const dataOf = (e: LedgerEvent): Record<string, unknown> => {
  const d = (e as { data?: unknown }).data
  return typeof d === 'object' && d !== null && !Array.isArray(d) ? (d as Record<string, unknown>) : {}
}

/** The days since a Today cold check's KC was last met, or null when `e` is not an unassisted Today probe. */
export function coldCheckAge(e: LedgerEvent): number | null {
  if (e.kind !== 'probe') return null
  const d = dataOf(e)
  if (d.src !== 'today' || typeof d.sinceDays !== 'number' || !Number.isFinite(d.sinceDays)) return null
  if ((e as { provenance?: string }).provenance === 'assisted') return null
  return d.sinceDays
}

/** A KC's track: the graph's record, else the id's prefix (`t5.kv-bytes` → `t5`). */
function trackResolver(content: Pick<CardsContent, 'kcs'>): (kc: KcId) => TrackId {
  const byId = new Map<KcId, TrackId>(content.kcs.map((k) => [k.id, k.track]))
  return (kc) => byId.get(kc) ?? (kc.split('.')[0] as TrackId)
}

const trackRank = (t: TrackId): number => {
  const i = TRACK_ORDER.indexOf(t)
  return i < 0 ? TRACK_ORDER.length : i
}

interface Tally {
  n7: number
  ok7: number
  n30: number
  ok30: number
}

const rowOf = (track: TrackId | null, t: Tally): ColdCheckRow => ({ track, d7: proportionOf(t.ok7, t.n7), d30: proportionOf(t.ok30, t.n30) })

/** Today's cold checks as of `now`, overall and by track, at 7 days or more and at 30 days or more (§12.3). */
export function selectColdCheckSummary(
  events: Iterable<LedgerEvent>,
  content: Pick<CardsContent, 'kcs' | 'resolve'>,
  now: LocalDay,
): ColdCheckSummary {
  const trackOf = trackResolver(content)
  const overall: Tally = { n7: 0, ok7: 0, n30: 0, ok30: 0 }
  const byTrack = new Map<TrackId, Tally>()
  const add = (t: Tally, age: number, ok: boolean): void => {
    t.n7 += 1
    if (ok) t.ok7 += 1
    if (age < COLD_LONG_DAYS) return
    t.n30 += 1
    if (ok) t.ok30 += 1
  }
  for (const e of asOf(events, now)) {
    const age = coldCheckAge(e)
    if (age === null || age < COLD_MIN_DAYS) continue
    const ok = (e as { ok?: boolean }).ok === true
    add(overall, age, ok)
    for (const track of new Set(content.resolve(e).map(trackOf))) {
      const t = byTrack.get(track) ?? { n7: 0, ok7: 0, n30: 0, ok30: 0 }
      add(t, age, ok)
      byTrack.set(track, t)
    }
  }
  const tracks = [...byTrack.keys()].sort((a, b) => trackRank(a) - trackRank(b) || (a < b ? -1 : a > b ? 1 : 0))
  return { overall: rowOf(null, overall), tracks: tracks.map((t) => rowOf(t, byTrack.get(t) as Tally)) }
}
