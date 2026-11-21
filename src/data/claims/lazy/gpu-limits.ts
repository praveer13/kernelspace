import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the GPU hardware-limit claims (t4 lane: CUDA and H100 SXM warp limits). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const GPU_LIMITS_CLAIMS: Claim[] = []

registerClaims(GPU_LIMITS_CLAIMS)
