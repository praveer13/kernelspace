import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the GPU hardware-limit claims (t4 lane: CUDA and H100 SXM warp limits). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const GPU_LIMITS_CLAIMS: Claim[] = [
  {
    id: 'hw.cuda.coalesce-transaction-bytes',
    kind: 'spec',
    value: 32,
    unit: 'B',
    label: 'Bytes in one coalesced global-memory transaction',
    source: {
      url: 'https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html',
      title: 'CUDA C++ Best Practices Guide, 10.2.1 Coalesced Access to Global Memory',
      quote:
        'the concurrent accesses of the threads of a warp will coalesce into a number of transactions equal to the number of 32-byte transactions necessary to service all of the threads of the warp.',
      row: 'Best Practices Guide > Coalesced Access to Global Memory',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 365,
    boundary:
      'Compute capability 6.0 and later (the H100 is 9.0). Devices of compute capability 5.2 with L1 caching enabled counted 128-byte aligned segments instead.',
  },
]

registerClaims(GPU_LIMITS_CLAIMS)
