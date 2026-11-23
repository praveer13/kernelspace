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
    id: 'status.dynamo.release',
    kind: 'status',
    value: 'v1.6.2',
    label: 'The newest Dynamo release (the releases page marks it Latest)',
    source: {
      url: 'https://github.com/ai-dynamo/dynamo/releases/tag/v1.6.2',
      title: 'NVIDIA Dynamo v1.6.2 release notes',
      quote: 'Dynamo v1.6.2 is a patch release on top of v1.6.1',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'github.com/ai-dynamo/dynamo/releases/latest showed v1.6.2 labelled Latest, released 05 Nov 22:11 (2026-11-05), on the read date. A newer release makes this stale; it says nothing about which release a deployment runs.',
    pin: { repo: 'ai-dynamo/dynamo', ref: 'v1.6.2' },
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
  {
    id: 'status.deepseek.production-drafter',
    kind: 'status',
    value: 'MTP-1 (one draft token per step), superseded by DSpark',
    label: "DeepSeek's production speculative drafter before DSpark, and why it was kept at one token",
    source: {
      url: 'https://arxiv.org/html/2607.05147',
      title: 'DSpark: Confidence-Scheduled Speculative Decoding with Semi-Autoregressive Generation (arXiv 2607.05147), section 5.4',
      quote:
        'This single-token setup was historically maintained in production because deploying a static multi-token drafter (e.g., MTP-3/5) strictly degrades aggregate throughput under high concurrency due to excessive verification overhead.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'The paper says "MTP-1 represents the former production setup, having been superseded by DSpark two weeks following the DeepSeek-V4-preview release", and names the V4-Flash and V4-Pro (preview) serving engines, not DeepSeek-R1. It is the authors\' statement about their own deployment, not a measurement the course can repeat.',
  },
  {
    id: 'status.deepseek.trtllm-mtp-depth',
    kind: 'status',
    value: 'three MTP layers, for single-concurrency DeepSeek-R1 on 8xB200',
    label: "NVIDIA TensorRT-LLM's MTP depth for the DeepSeek-R1 min-latency recipe",
    source: {
      url: 'https://nvidia.github.io/TensorRT-LLM/blogs/tech_blog/blog1_Pushing_Latency_Boundaries_Optimizing_DeepSeek-R1_Performance_on_NVIDIA_B200_GPUs.html',
      title: 'Pushing Latency Boundaries: Optimizing DeepSeek-R1 Performance on NVIDIA B200 GPUs (TensorRT LLM tech blog), MTP section',
      quote: 'Based on our exploration, 3x MTP layers configuration demonstrates optimal performance.',
    },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'The blog frames its setting as "single concurrency (min-latency scenario)" on 8xB200; its own table shows MTP 3 narrowly ahead of MTP 2 and MTP 4. It says nothing about high-concurrency serving or about what DeepSeek runs.',
  },
]

registerClaims(LANDSCAPE_T6_CLAIMS)
