import { EPLB_PRACTICE_SEED, checkEplbBand, makeLoads, practiceLoads, times } from '../eplb'
import type { BandResult } from './types'

/** Candidates the acceptance rate is measured on: 0 to 999. */
export const ACCEPTANCE_CANDIDATES = 1000
/** The band must accept at least this share of candidates, per mille (wave-3.md §5.2: ≥ 20 %). */
export const MIN_ACCEPTANCE_PERMILLE = 200

/** In-band candidates among 0 … n − 1, per mille. */
export function eplbAcceptancePermille(n = ACCEPTANCE_CANDIDATES): number {
  let k = 0
  for (let c = 0; c < n; c++) if (checkEplbBand(makeLoads(c)).inBand) k++
  return Math.round((k * 1000) / n)
}

/** The band's result from the practice load's check and the acceptance rate: both must hold. */
export function eplbBandResult(check: ReturnType<typeof checkEplbBand>, acceptancePermille: number): BandResult {
  const accepted = acceptancePermille >= MIN_ACCEPTANCE_PERMILLE
  const facts = `hottest expert ${check.hottest} ‰, round robin without replicas ${times(check.roundRobin)}×, the reference ${times(check.ghost)}×`
  const where = check.inBand ? `practice load (seed ${EPLB_PRACTICE_SEED}) is in band: ${facts}` : `practice load (seed ${EPLB_PRACTICE_SEED}) is outside the band (${check.violations.join('; ')})`
  const rate = `acceptance ${(acceptancePermille / 10).toFixed(1)} % of candidates 0–${ACCEPTANCE_CANDIDATES - 1}${accepted ? '' : `, below ${MIN_ACCEPTANCE_PERMILLE / 10} %`}`
  return { ok: check.inBand && accepted, detail: `${where}; ${rate}` }
}

/** The EPLB play's practice band: the pinned practice load is in band, and the band accepts ≥ 20 % of draws. It reads no file. */
export async function band(): Promise<BandResult> {
  return eplbBandResult(checkEplbBand(practiceLoads()), eplbAcceptancePermille())
}
