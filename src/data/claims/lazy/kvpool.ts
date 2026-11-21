import { registerClaims } from '../registry'
import type { Claim } from '../schema'
import { VLLM_PIN } from '../engines'

const VLLM_CACHE_CONFIG = {
  url: `https://raw.githubusercontent.com/${VLLM_PIN.repo}/${VLLM_PIN.ref}/vllm/config/cache.py`,
  title: `vLLM ${VLLM_PIN.ref} source: vllm/config/cache.py (CacheConfig)`,
}

/**
 * Wave 0 lazy group: the KV-cache pool claims (registry lane: the paged-attention and extensible-KV-cache pins). Empty until the lane that owns it adds its claims here, under the ids its
 * line in `LAZY_GROUP_HOMES` (`homes.ts`) names. The group is registered once by K0-D0, so no two lanes edit `all.ts`
 * or `homes.ts`. A lane adds claims only to this file.
 */
export const KVPOOL_CLAIMS: Claim[] = [
  {
    id: 'serving.pagedattention.paper-block-size',
    kind: 'spec',
    value: 16,
    unit: 'tokens/block',
    label: "PagedAttention paper (SOSP 2023): vLLM's default block size",
    source: {
      url: 'https://arxiv.org/pdf/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1)',
      quote: 'Accordingly, vLLM sets its default block size as 16.',
      row: 'Section 7.2, Impact of block size',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 365,
    boundary:
      "The 2023 paper's choice after a sweep in which 16 to 128 did best on ShareGPT and 16 or 32 on Alpaca. production.vllm.block-size is the engine's default today.",
  },
  {
    id: 'production.vllm.extensible-kv-cache',
    kind: 'status',
    value: 'on',
    label: 'vLLM extensible KV cache (reserve the address range, commit physical pages after warmup)',
    source: {
      ...VLLM_CACHE_CONFIG,
      quote:
        'Reserve the KV cache address range with device virtual memory and commit physical pages after warmup, so the cache is sized from the memory actually free after CUDA graph capture rather than from a profiling estimate.',
      row: 'CacheConfig.enable_extensible_kv_cache',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'When enable_extensible_kv_cache is not given: on for CUDA and ROCm unless kv_cache_memory_bytes is set (or NIXL on device memory has no IMEX channel); where the driver lacks virtual-memory support it falls back to estimate-based sizing.',
  },
  {
    id: 'production.vllm.gpu-memory-utilization',
    kind: 'status',
    value: 1.0,
    label: 'vLLM gpu_memory_utilization default with the extensible KV cache',
    source: {
      ...VLLM_CACHE_CONFIG,
      quote: 'If unspecified, 1.0 with the extensible KV cache (sized from measured memory) and 0.92 otherwise; see `resolved_gpu_memory_utilization`.',
      row: 'CacheConfig.gpu_memory_utilization',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-11-21',
    ttlDays: 60,
    boundary:
      'When --gpu-memory-utilization is not given and the extensible KV cache is on. With it off, or with the flag set, the value is 0.92 (DEFAULT_GPU_MEMORY_UTILIZATION) or the flag.',
  },
]

registerClaims(KVPOOL_CLAIMS)
