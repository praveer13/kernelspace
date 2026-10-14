/**
 * Lab 03 (bpe-tokenizer) as a Forge bundle (docs/specs/wave-2.md §13.3): PRIMM with an in-browser BPE reference
 * (src/lib/world/bpe.ts), a hint ladder for the six required checks, a bottom-out walkthrough and six Prove-it
 * questions, behind the lab-neutral `ForgeBundle` contract. `src/data/forge/index.ts` finds this directory by itself.
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
  walkthrough: (checkId, trace) => walkthroughFor(checkId, trace),
  discussionsLabel: DEFAULT_LABEL,
}

export default bundle
