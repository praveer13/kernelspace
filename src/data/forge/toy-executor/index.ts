/**
 * Lab 05 (toy-executor) as a Forge bundle (docs/specs/wave-3.md §8.2): PRIMM around the reference executor's
 * committed seed-7 probe run, a faded hint ladder (R0 to R2, then the packet) for the six required checks, and six
 * Prove-it v1 questions, behind the lab-neutral `ForgeBundle` contract. `primm.ts` exports `PRIMM_MC_ITEMS` for the
 * item gates. There is no `prove2` (the bridge answers `probe` only, §7.2) and no walkthrough, so the page offers no
 * bottom-out for this lab. `src/data/forge/index.ts` finds this directory by itself.
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
  fade: 'r2',
}

export default bundle
