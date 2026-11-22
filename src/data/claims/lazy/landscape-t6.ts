import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the landscape claims for lesson t6 (landscape lane: Dynamo KVBM and release, DeepEP and DeepSeek status). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const LANDSCAPE_T6_CLAIMS: Claim[] = [
  {
    id: 'status.dynamo.kvbm.removal-target',
    kind: 'status',
    value: 'v1.7.0',
    label: 'Dynamo release that KVBM (KV Block Manager) is targeted for removal in',
    source: {
      url: 'https://github.com/ai-dynamo/dynamo/releases/tag/v1.5.0',
      title: 'NVIDIA Dynamo v1.5.0 release notes (Breaking Changes: Deprecated and Removed)',
      quote: 'KVBM (KV Block Manager) is deprecated in v1.5.0 and removal is targeted for v1.7.0',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'A target in the v1.5.0 notes, not a removal. Dynamo v1.6.0 (2026-10-22) and v1.6.2 (2026-11-05) still ship KVBM; the README feature matrix at both tags still lists it. v1.7.0 exists only as dev snapshots on 2026-11-21.',
    pin: { repo: 'ai-dynamo/dynamo', ref: 'v1.5.0' },
  },
]

registerClaims(LANDSCAPE_T6_CLAIMS)
