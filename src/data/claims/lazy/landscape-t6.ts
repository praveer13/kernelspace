import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the landscape claims for lesson t6 (landscape lane: Dynamo KVBM and release, DeepEP and DeepSeek status). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const LANDSCAPE_T6_CLAIMS: Claim[] = []

registerClaims(LANDSCAPE_T6_CLAIMS)
