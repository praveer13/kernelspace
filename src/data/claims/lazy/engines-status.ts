import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the engine status claims (t5 lane: TensorRT-LLM, SGLang hardware, llm-d and vLLM speculative decoding). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const ENGINES_STATUS_CLAIMS: Claim[] = []

registerClaims(ENGINES_STATUS_CLAIMS)
