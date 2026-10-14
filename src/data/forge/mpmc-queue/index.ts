/**
 * Lab 04 (mpmc-queue) as a Forge bundle (docs/specs/wave-3.md §8.2): PRIMM on the Fleet's reference queue, a faded hint
 * ladder (R0 to R2 for the six required checks, then the packet), six Prove-it questions and three Prove-it v2
 * templates (§7.2), behind the lab-neutral `ForgeBundle` contract. `primm.ts` exports `PRIMM_MC_ITEMS` for the item
 * gates, as lab 01's does.
 *
 * There is no walkthrough, and the ladder stops at R2 (`fade: 'r2'`), so the page offers no bottom-out for this lab.
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
