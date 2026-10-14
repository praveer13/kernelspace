/**
 * Lab 06's race against the reference (docs/specs/wave-3.md §8.3, task 3b-09): RING 0's "within 3 points", W1's Code stage.
 *
 * After a run of batching-scheduler whose every required check passed on seeds drawn at grade time, the learner may race
 * the reference: Act I's job with only their scheduler in the engine, on a graded seed drawn from entropy drawn now. The
 * run is recorded as a `fleet-run` event of mode `engine` with exactly one component, which is what the fold credits to
 * `labFleetOk` when the goodput is within 3 points of the reference (`fleetRunOk`, `ledger/fold.ts`). Then the bestiary
 * (`world/bestiary.ts`) runs its twelve policies on the SAME entropy, so the same trace, and the panel can place the
 * learner's goodput among them.
 *
 * This file holds the pure parts and the orchestration; the sim worker, the clock and the ledger are injected
 * (`RaceDeps`), so tests drive a race with a fake scheduler module and the ledger of a memory profile.
 */

import { checkInstall } from '@/lib/engine/store'
import type { Credit } from '@/lib/forge/run'
import type { LabRunReport } from '@/lib/forge/types'
import type { ActResult } from '@/lib/fleet-week'
import { fleetRunOk } from '@/lib/ledger/fold'
import type { FleetRunResult } from '@/lib/ledger/types'
import type { MirrorTable } from '@/lib/sims/types'
import { placement, specLabel, type BestiaryResult, type BestiaryRow } from '@/lib/world/bestiary'
import type { BestiaryJob, SimJob, SimRequestJob, SimResults } from '@/workers/sim-protocol'

/** The only lab with a race. */
export const RACE_LAB = 'batching-scheduler'

/** The bar, in goodput points: Act I's, RING 0's and the fold's (`fleetRunOk`). */
export const RACE_BAR_POINTS = 3

/**
 * Whether `RaceReference` offers the race for this run: lab 06, a module that passed every required check on fresh seeds
 * in this very run (`checkInstall`, the same bar as installing it) and the credit ForgeLab gave it. A run with a red
 * required check gets no race and no message: the lab page is already telling the learner what to fix.
 */
export function raceOffered(labId: string, report: LabRunReport, credit: Credit): boolean {
  return labId === RACE_LAB && credit === 'unseen' && checkInstall('scheduler', report).ok
}

/** Act I's job with only the learner's scheduler: the block manager and the intake queue are the reference's. */
export function raceJob(bytes: ArrayBuffer): Extract<SimJob, { kind: 'act1' }> {
  return { kind: 'act1', modules: { sched: bytes, mgr: null, queue: null } }
}

/** The bestiary job; it takes the race's entropy, so both draw the same graded seed. */
export const BESTIARY_JOB: BestiaryJob = { kind: 'bestiary' }

/** The `fleet-run` event of a race, or null when the result carries no numbers or no graded seed (the codec wants both). */
export function raceRunResult(result: ActResult, sha256: string): FleetRunResult | null {
  if (!result.run || result.seed === undefined || result.seed === null) return null
  const { goodput, refGoodput, ttftP95 } = result.run
  return {
    seed: result.seed,
    data: {
      v: 1,
      mode: 'engine',
      components: [{ slot: 'scheduler', labId: RACE_LAB, sha256 }],
      seeds: 'fresh',
      goodput,
      refGoodput,
      ...(ttftP95 === undefined ? {} : { ttftP95 }),
    },
  }
}

/** The injected edges of a race. */
export interface RaceDeps {
  /** The sim worker (`runSimWithEntropy`): the result and the entropy it ran on. */
  run<K extends SimRequestJob['kind']>(job: Extract<SimRequestJob, { kind: K }>, onProgress?: (fraction: number) => void, entropy?: number): Promise<{ result: SimResults[K]; entropy: number }>
  /** The ledger façade's `recordFleetRun`. */
  record(run: FleetRunResult): void
  /** sha256 of the module bytes, hex. */
  sha256(bytes: ArrayBuffer): Promise<string>
}

export interface RaceOutcome {
  /** Your goodput and the reference's on the graded seed, in percent. */
  goodput: number
  refGoodput: number
  /** Within `RACE_BAR_POINTS` of the reference: the fold sets `labFleetOk` from an `ok` unseen engine run. */
  within: boolean
  seed: number | null
  /** The entropy the race drew; the bestiary ran on it too. */
  entropy: number
  /** The ledger got the `fleet-run` event. */
  recorded: boolean
  /** The act's own detail line (the gap, or that the engine held). */
  detail: string
  ttftP95?: number
  /** Null when the bestiary job failed; `bestiaryError` says why. */
  bestiary: BestiaryResult | null
  bestiaryError: string | null
}

/**
 * Race: Act I with only your scheduler on a graded seed drawn now, recorded; then the twelve policies on the same entropy.
 * A failure of the race itself (a trapping or spinning module) rejects, as the Fleet Week page's runs do and with the
 * same error text, before anything is recorded. A failure of the bestiary leaves the race standing.
 */
export async function runRace(bytes: ArrayBuffer, deps: RaceDeps, onProgress?: (fraction: number) => void): Promise<RaceOutcome> {
  // the race is the first 70 % of the bar, the bestiary the rest
  const { result, entropy } = await deps.run(raceJob(bytes), onProgress && ((f) => onProgress(f * 0.7)))
  if (!result.run) throw new Error('the race returned no numbers')
  let recorded = false
  try {
    const run = raceRunResult(result, await deps.sha256(bytes))
    if (run) {
      deps.record(run)
      recorded = true
    }
  } catch {
    // the race on screen stands; only the ledger event is lost (as Fleet Week's runs)
  }
  const { goodput, refGoodput, ttftP95 } = result.run
  const outcome: RaceOutcome = {
    goodput,
    refGoodput,
    within: fleetRunOk({ goodput, refGoodput }),
    seed: result.seed ?? null,
    entropy,
    recorded,
    detail: result.detail,
    ...(ttftP95 === undefined ? {} : { ttftP95 }),
    bestiary: null,
    bestiaryError: null,
  }
  try {
    const { result: bestiary } = await deps.run(BESTIARY_JOB, onProgress && ((f) => onProgress(0.7 + f * 0.3)), entropy)
    outcome.bestiary = bestiary
  } catch (e) {
    outcome.bestiaryError = e instanceof Error ? e.message : String(e)
  }
  return outcome
}

/* ------------------------------ the histogram ------------------------------ */

/** Width of a histogram bin, in goodput points. */
export const BIN_POINTS = 5

export interface HistogramBin {
  /** `[lo, hi)` in percent. */
  lo: number
  hi: number
  /** The policies in the bin, best goodput last (they stack from the axis up). */
  rows: BestiaryRow[]
  /** Your goodput falls in this bin. */
  mine: boolean
}

/**
 * The twelve goodputs in bins of 5 points, wide enough to hold yours, as a dot histogram: each policy is one dot, so a
 * reader counts policies rather than reading a height. The bin range is a whole number of bins from the lowest to the
 * highest of the twelve and yours.
 */
export function histogramBins(rows: readonly BestiaryRow[], mine: number): HistogramBin[] {
  const all = [...rows.map((r) => r.goodput), mine]
  const lo = Math.floor(Math.min(...all) / BIN_POINTS) * BIN_POINTS
  const hi = (Math.floor(Math.max(...all) / BIN_POINTS) + 1) * BIN_POINTS
  const bins: HistogramBin[] = []
  for (let b = lo; b < hi; b += BIN_POINTS) {
    const inBin = (g: number) => g >= b && g < b + BIN_POINTS
    bins.push({ lo: b, hi: b + BIN_POINTS, rows: rows.filter((r) => inBin(r.goodput)).sort((a, c) => a.goodput - c.goodput), mine: inBin(mine) })
  }
  return bins
}

/** One sentence on where `goodput` falls among the policies, for the chart's label and the live region. */
export function placementSentence(goodput: number, rows: readonly Pick<BestiaryRow, 'goodput'>[]): string {
  const { below, tied, above } = placement(goodput, rows)
  const n = rows.length
  if (above === 0 && tied === 0) return `Your ${goodput}% is above all ${n} policies.`
  if (below === 0 && tied === 0) return `Your ${goodput}% is below all ${n} policies.`
  const level = tied > 0 ? `, level with ${tied}` : ''
  return `Your ${goodput}% is above ${below} of the ${n} policies${level}, below ${above}.`
}

export const BESTIARY_TABLE_ID = 'race-bestiary-table'

/** The table that mirrors the chart: one row per policy and yours, best goodput first. */
export function bestiaryTable(goodput: number, rows: readonly BestiaryRow[]): MirrorTable {
  const entries: { key: string; name: string; dials: string; goodput: number }[] = [
    ...rows.map((r) => ({ key: r.id.slice(1), name: r.name, dials: specLabel(r.spec), goodput: r.goodput })),
    { key: 'you', name: 'your scheduler', dials: 'your code', goodput },
  ].sort((a, b) => b.goodput - a.goodput)
  return {
    caption: 'Goodput of the twelve policies and your scheduler on the race’s graded seed, best first',
    columns: ['Policy', 'Dials', 'Goodput (%)'],
    rows: entries.map((e) => [e.key === 'you' ? e.name : `${e.key}. ${e.name}`, e.dials, e.goodput.toFixed(1)]),
    announce: placementSentence(goodput, rows),
  }
}
