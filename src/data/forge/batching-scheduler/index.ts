/**
 * Lab 06 (batching-scheduler) as a Forge bundle (docs/specs/wave-3.md §8.2, task 3b-12): PRIMM on the Fleet's engine
 * with its reference scheduler, a faded hint ladder (R0 to R2, then the packet) for the six required checks, six
 * Prove-it questions and three Prove-it v2 templates (§7.2), behind the lab-neutral `ForgeBundle` contract. `primm.ts`
 * exports `PRIMM_MC_ITEMS` for the item gates, as labs 01 and 02 do.
 *
 * `fade: 'r2'` is the whole difference from lab 02's shape: no R3, no R4 and no bottom-out walkthrough. Lab 06's race
 * and bestiary (§8.3) are 3b-09's, and live beside this bundle, not in it.
 */

import type { ForgeBundle } from '../types'
import { DISCUSSIONS_LABEL, LADDER, LADDER_CHECK_IDS, LAB_ID } from './ladder'
import { PRIMM_ITEMS, PRIMM_STEPS, RUN_SPEC, STAGES } from './primm'
import { PROVE_QUESTIONS } from './prove'
import { PROVE2 } from './prove2'

const bundle: ForgeBundle = {
  labId: LAB_ID,
  stages: [...STAGES],
  primm: { items: [...PRIMM_ITEMS], steps: [...PRIMM_STEPS], run: RUN_SPEC },
  ladder: LADDER_CHECK_IDS.map((id) => LADDER[id]),
  prove: [...PROVE_QUESTIONS],
  discussionsLabel: DISCUSSIONS_LABEL,
  fade: 'r2',
  prove2: PROVE2,
}

export default bundle
