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
    label: "PagedAttention paper (SOSP 2023): the block size it chose (its default then)",
    source: {
      url: 'https://arxiv.org/pdf/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1)',
      quote: 'Accordingly, vLLM sets its default block size as 16.',
      row: 'Section 7.2, Impact of block size',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 365,
    boundary:
      "The 2023 paper's choice after a sweep in which 16 to 128 did best on ShareGPT and 16 or 32 on Alpaca. production.vllm.block-size is the engine's default at its pinned release.",
  },
  {
    id: 'serving.pagedattention.fig2-vllm-token-states',
    kind: 'benchmark',
    value: 96.3,
    unit: '% of KV cache memory',
    label: "PagedAttention paper (SOSP 2023), Figure 2: share of vLLM's KV cache memory holding token states",
    source: {
      url: 'https://arxiv.org/html/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1), Figure 2',
      quote: 'Average percentage of memory wastes in different LLM serving systems during the experiment in §6.2.',
      row: 'Figure 2 (Section 1), the vLLM bar: its Token states segment is labelled 96.3',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 180,
    boundary:
      'An average over one experiment (§6.2, basic sampling), not a bound for every workload. The bar\'s other segments (Reservation, Internal frag., External frag. & Others) carry no labels. The text gives no waste figure for vLLM; its words are "near-zero waste".',
  },
  // K0-FIX4: the paper's headline throughput, its largest request-rate figure, and the measured cost of the block-table
  // indirection. t2.l7 had typed "~24× FasterTransformer and ~3.5× Orca", which the paper does not say.
  {
    id: 'serving.pagedattention.throughput-gain-low',
    kind: 'benchmark',
    value: 2,
    unit: '× throughput',
    label: 'PagedAttention paper (SOSP 2023): throughput gain over FasterTransformer and Orca at the same latency, low end',
    source: {
      url: 'https://arxiv.org/html/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1), abstract',
      quote:
        'Our evaluations show that vLLM improves the throughput of popular LLMs by 2-4× with the same level of latency compared to the state-of-the-art systems, such as FasterTransformer and Orca.',
      row: 'Abstract',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 180,
    boundary:
      "The paper's 2023 evaluation (§6: OPT and LLaMA models on A100 GPUs, workloads synthesized from ShareGPT and Alpaca) against FasterTransformer and Orca; not a gain over any engine today.",
  },
  {
    id: 'serving.pagedattention.throughput-gain-high',
    kind: 'benchmark',
    value: 4,
    unit: '× throughput',
    label: 'PagedAttention paper (SOSP 2023): throughput gain over FasterTransformer and Orca at the same latency, high end',
    source: {
      url: 'https://arxiv.org/html/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1), abstract',
      quote:
        'Our evaluations show that vLLM improves the throughput of popular LLMs by 2-4× with the same level of latency compared to the state-of-the-art systems, such as FasterTransformer and Orca.',
      row: 'Abstract',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 180,
    boundary: 'The other end of the range in serving.pagedattention.throughput-gain-low.',
  },
  {
    id: 'serving.pagedattention.ft-request-rate',
    kind: 'benchmark',
    value: 22,
    unit: '× request rate',
    label: "PagedAttention paper (SOSP 2023): vLLM's highest sustained request rate against FasterTransformer, at similar latency",
    source: {
      url: 'https://arxiv.org/html/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1), Section 6.2',
      quote:
        'Compared to FasterTransformer, vLLM can sustain up to 22× higher request rates, as FasterTransformer does not utilize a fine-grained scheduling mechanism and inefficiently manages the memory like Orca (Max).',
      row: 'Section 6.2, Basic Sampling',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 180,
    boundary:
      "An upper end ('up to') over the §6.2 basic-sampling runs. The paper gives two causes, scheduling as well as memory, so it is not a measure of paging alone.",
  },
  {
    id: 'serving.pagedattention.kernel-overhead-low',
    kind: 'benchmark',
    value: 20,
    unit: '% attention-kernel latency',
    label: "PagedAttention paper (SOSP 2023): the block-table kernel's extra attention latency over FasterTransformer's kernel, low end",
    source: {
      url: 'https://arxiv.org/html/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1), Section 7.1',
      quote: 'As shown in Fig. 18(a), this leads to 20–26% higher attention kernel latency, compared to the highly-optimized FasterTransformer implementation.',
      row: 'Section 7.1, Kernel Microbenchmark',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 180,
    boundary:
      'The attention kernel alone, in a microbenchmark; the paper adds that the overhead "only affects the attention operator but not the other operators in the model, such as Linear".',
  },
  {
    id: 'serving.pagedattention.kernel-overhead-high',
    kind: 'benchmark',
    value: 26,
    unit: '% attention-kernel latency',
    label: "PagedAttention paper (SOSP 2023): the block-table kernel's extra attention latency over FasterTransformer's kernel, high end",
    source: {
      url: 'https://arxiv.org/html/2309.06180v1',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention (arXiv 2309.06180v1), Section 7.1',
      quote: 'As shown in Fig. 18(a), this leads to 20–26% higher attention kernel latency, compared to the highly-optimized FasterTransformer implementation.',
      row: 'Section 7.1, Kernel Microbenchmark',
    },
    verifiedAt: '2026-11-21',
    ttlDays: 180,
    boundary: 'The other end of the range in serving.pagedattention.kernel-overhead-low.',
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
