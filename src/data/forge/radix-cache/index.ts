/**
 * Lab 07 (radix-cache) as a Forge bundle (docs/specs/wave-3.md §8.2): PRIMM on the page's own radix tree
 * (src/lib/world/radix.ts), a faded hint ladder (R0 to R2, then the packet) for the six required checks, six Prove-it
 * questions and two Prove-it v2 templates (§7.2), behind the lab-neutral `ForgeBundle` contract. `primm.ts` exports
 * `PRIMM_MC_ITEMS` for the item gates, as the other labs' do. `src/data/forge/index.ts` finds this directory by itself.
 *
 * There is no walkthrough, so the page offers no bottom-out for this lab, and the ladder stops at R2 (`fade`).
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
