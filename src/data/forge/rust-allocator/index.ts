/**
 * Lab 01 as a Forge bundle (docs/specs/wave-2.md §13.1): the data Wave 1 authored for PRIMM, the hint ladder and
 * Prove-it, gathered behind the lab-neutral `ForgeBundle` contract. Nothing here is new content; the lab's own
 * modules (`primm.ts`, `ladder.ts`, `prove.ts`) keep their exports, and `verify-items` still reads `PRIMM_MC_ITEMS`
 * from `primm.ts`.
 */

import type { ForgeBundle } from '../types'
import { DEFAULT_LABEL, LADDER, LADDER_CHECK_IDS, LAB_ID, walkthroughFor } from './ladder'
import { PRIMM_ITEMS, PRIMM_STEPS, RUN_SPEC, STAGES } from './primm'
import { PROVE_QUESTIONS } from './prove'

const bundle: ForgeBundle = {
  labId: LAB_ID,
  stages: [...STAGES],
  primm: { items: [...PRIMM_ITEMS], steps: [...PRIMM_STEPS], run: RUN_SPEC },
  ladder: LADDER_CHECK_IDS.map((id) => LADDER[id]),
  prove: [...PROVE_QUESTIONS],
  walkthrough: (checkId, trace) => walkthroughFor(checkId, trace.length > 0 ? trace.join('\n') : undefined),
  discussionsLabel: DEFAULT_LABEL,
}

export default bundle
