/**
 * Lab 08 (xgrammar-lite) as a Forge bundle (docs/specs/wave-3.md §8.2, task 3b-14): PRIMM around the crate's own
 * `probe` replayed one frame per grammar step, a hint ladder of R0 to R2 for the six required checks (`fade: 'r2'`, then
 * the packet), and six Prove-it v1 questions, behind the lab-neutral `ForgeBundle` contract.
 * `src/data/forge/index.ts` finds this directory by itself.
 *
 * There is no `prove2` and no walkthrough: the lab's bridge answers `probe` only (wave-3.md §7.2), and a faded ladder
 * has no bottom-out.
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
