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
  {
    id: 'status.deepep.api',
    kind: 'status',
    value: 'one EPBuffer interface for high-throughput and low-latency EP; V1 removed',
    label: 'DeepEP expert-parallel API (V2 unified it, V2.5 removed V1)',
    source: {
      url: 'https://github.com/deepseek-ai/DeepEP/blob/f6aa38fe06cd4a0489e7730365d4e0114970a2f3/README.md',
      title: 'DeepEP README (News and New features)',
      quote: 'High-throughput and low-latency APIs unified into a single `EPBuffer` interface, with an expanded layout for grouped expert GEMMs',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'Read in the README at a commit, because the repository publishes no release after v1.2.1 (2025-09-16). The README says "Fully remove V1" under V2.5 and gives no date for V2 or V2.5, so none is stated here. v1.2.1 still describes two kernel sets: "high-throughput and low-latency all-to-all GPU kernels", with low-latency kernels "with pure RDMA".',
    pin: { repo: 'deepseek-ai/DeepEP', ref: 'f6aa38fe06cd4a0489e7730365d4e0114970a2f3' },
  },
]

registerClaims(LANDSCAPE_T6_CLAIMS)
