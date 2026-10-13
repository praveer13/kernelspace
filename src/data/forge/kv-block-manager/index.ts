/**
 * Lab 02 (kv-block-manager) as a Forge bundle (docs/specs/wave-2.md §13.2): PRIMM on the Fleet's reference block
 * manager, the hint ladder for the six required checks, and six Prove-it questions, behind the lab-neutral
 * `ForgeBundle` contract. `primm.ts` exports `PRIMM_MC_ITEMS` for the item gates, as lab 01's does.
 *
 * There is no walkthrough yet, so the ladder ends at R4 and the page offers no bottom-out for this lab.
 */

import type { ForgeBundle } from '../types'
import { DISCUSSIONS_LABEL, LADDER, LADDER_CHECK_IDS, LAB_ID } from './ladder'
import { PRIMM_ITEMS, PRIMM_STEPS, RUN_SPEC, STAGES } from './primm'
import { PROVE_QUESTIONS } from './prove'

const bundle: ForgeBundle = {
  labId: LAB_ID,
  stages: [...STAGES],
  primm: { items: [...PRIMM_ITEMS], steps: [...PRIMM_STEPS], run: RUN_SPEC },
  ladder: LADDER_CHECK_IDS.map((id) => LADDER[id]),
  prove: [...PROVE_QUESTIONS],
  discussionsLabel: DISCUSSIONS_LABEL,
}

export default bundle
