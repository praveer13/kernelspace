import { PLAY_PRACTICE_SEED, checkPlacementBand, makePlacementTrace } from '../traces'
import type { BandResult } from './types'

/** Block placement's practice band: the pinned practice seed is in band; it reads no file. */
export async function band(): Promise<BandResult> {
  const check = checkPlacementBand(makePlacementTrace(PLAY_PRACTICE_SEED))
  return { ok: check.inBand, detail: `practice seed ${PLAY_PRACTICE_SEED} ${check.inBand ? 'is in band' : 'is outside the band'}` }
}
