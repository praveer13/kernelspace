import { registerClaims } from '../registry'
import type { Claim } from '../schema'

/**
 * Wave 0 lazy group: the engine status claims (t5 lane: TensorRT-LLM, SGLang hardware, llm-d and vLLM speculative decoding). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const ENGINES_STATUS_CLAIMS: Claim[] = [
  {
    id: 'status.vllm.speculative-methods',
    kind: 'status',
    value: 'EAGLE, MTP, draft, n-gram, suffix',
    label: 'vLLM spec-decode methods',
    source: {
      url: 'https://raw.githubusercontent.com/vllm-project/vllm/v0.34.0/docs/features/speculative_decoding/README.md',
      title: 'vLLM v0.34.0 docs: Speculative Decoding',
      quote:
        'Model-based methods such as EAGLE, MTP and draft models provide the best latency reduction, while simpler methods such as n-gram and suffix decoding provide modest speedups without increasing workload during peak traffic.',
      row: 'docs/features/speculative_decoding/README.md, line 9',
    },
    pin: { repo: 'vllm-project/vllm', ref: 'v0.34.0' },
    verifiedAt: '2026-11-22',
    ttlDays: 60,
    boundary:
      'The page also lists LiLiCorr, hidden-state extraction, custom speculators and the dflash and dspark drafters (its `method` row names draft_model, ngram, suffix, mtp, eagle3 and dflash as common values); the claim names the methods the lesson teaches. Medusa and the MLP speculator were removed in the v0.33.0 series (release notes of v0.33.0rc3, published 2026-11-02: "Medusa and the MLP speculator were removed (#61701)"). The same page says the standard rejection sampler is "theoretically lossless up to the precision limits of hardware numerics" and that FLy "deliberately relaxes verification and is not distribution preserving".',
  },
]

registerClaims(ENGINES_STATUS_CLAIMS)
