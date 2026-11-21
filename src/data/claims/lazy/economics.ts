import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the economics claims (t7 lane: load generators, Meta and MLPerf status, DeepSeek day-six benchmark, H100 and DeepSeek prices). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const ECONOMICS_CLAIMS: Claim[] = []

registerClaims(ECONOMICS_CLAIMS)
