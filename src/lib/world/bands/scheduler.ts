import { SCHED_PRACTICE_MINUTE_SEED, checkSchedBand, parseSchedSource, practiceMinute, type SchedBandCheck } from '../sched-traces'
import type { BandRead, BandResult } from './types'

/**
 * The §8.2 check's result as a band result. `ok` needs the band's verdict and every one of the five rules (wave-2
 * D33: the practice minute is in band on all five, never rules 1 and 4 alone); `detail` is the line verify-plays prints.
 */
export function schedBandResult(band: SchedBandCheck): BandResult {
  const missed = band.rules.flatMap((ok, i) => (ok ? [] : [i + 1]))
  const detail =
    `practice minute (seed ${SCHED_PRACTICE_MINUTE_SEED}): the reference serves ${band.ghost.met} of ${band.ghost.total} within the SLO in ${band.ghost.turns} turns, FCFS ${band.fcfs.met}, ` +
    `${band.greedy.autoPreempts} auto-preempt${band.greedy.autoPreempts === 1 ? '' : 's'} without headroom, longest prompt ${band.longestPrompt}; ` +
    (missed.length === 0 ? 'in band on all five rules' : `outside the §8.2 band on rule${missed.length === 1 ? '' : 's'} ${missed.join(', ')} (${band.violations.join('; ')})`)
  return { ok: band.inBand && missed.length === 0, detail }
}

/** The scheduler's practice band: the pinned practice minute, drawn from the two committed BurstGPT artifacts. */
export async function band(read: BandRead): Promise<BandResult> {
  const source = await parseSchedSource(
    JSON.parse(await read('public/traces/burstgpt-v2-busiest-minute.json')),
    JSON.parse(await read('public/traces/burstgpt-v2-busiest-hour.json')),
  )
  return schedBandResult(checkSchedBand(practiceMinute(source)))
}
