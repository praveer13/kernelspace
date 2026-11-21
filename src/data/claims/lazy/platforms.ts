import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the platform status claims (t3 lane: Dynamo transport, Chromium, Android and WASI). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const PLATFORMS_CLAIMS: Claim[] = []

registerClaims(PLATFORMS_CLAIMS)
