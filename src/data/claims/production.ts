import type { Claim } from './schema'

const VLLM_CACHE_CONFIG = {
  url: 'https://raw.githubusercontent.com/vllm-project/vllm/main/vllm/config/cache.py',
  title: 'vLLM source: vllm/config/cache.py (CacheConfig)',
}
const VLLM_OPTIMIZATION = {
  url: 'https://docs.vllm.ai/en/latest/configuration/optimization/',
  title: 'vLLM docs: Optimization and Tuning (Preemption)',
}
const GLIBC_MALLOPT = {
  url: 'https://man7.org/linux/man-pages/man3/mallopt.3.html',
  title: 'mallopt(3), Linux man-pages',
}
const GLIBC_INTERNALS = {
  url: 'https://sourceware.org/glibc/wiki/MallocInternals',
  title: 'glibc wiki: MallocInternals',
}
const JEMALLOC_MAN = {
  url: 'https://jemalloc.net/jemalloc.3.html',
  title: 'jemalloc(3) manual page',
}

/**
 * What the In-production card shows (PLAN-100X §11.4): the dials the block-placement play turns, as real
 * allocators set them. Each quote was copied from the page opened on 2026-10-05. The vLLM claims are
 * `status` (60 days) because its defaults move between releases; glibc and jemalloc are `spec`.
 */
export const PRODUCTION_CLAIMS: Claim[] = [
  {
    id: 'production.vllm.block-size',
    kind: 'status',
    value: 16,
    unit: 'tokens/block',
    label: 'vLLM default KV cache block size',
    source: { ...VLLM_CACHE_CONFIG, quote: 'DEFAULT_BLOCK_SIZE: ClassVar[int] = 16', row: 'CacheConfig.DEFAULT_BLOCK_SIZE' },
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary: 'When --block-size is not given. Hybrid and Mamba models track their own block sizes (mamba_block_size).',
  },
  {
    id: 'production.vllm.v1-preemption',
    kind: 'status',
    value: 'recompute',
    label: 'vLLM V1 default preemption mode',
    source: {
      ...VLLM_OPTIMIZATION,
      quote: 'In vLLM V1, the default preemption mode is RECOMPUTE rather than SWAP, as recomputation has lower overhead in the V1 architecture.',
      row: 'Preemption',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 60,
    boundary: 'V1 engine: a preempted request is recomputed, not swapped to CPU.',
  },
  {
    id: 'production.glibc.mmap-threshold',
    kind: 'spec',
    value: 131072,
    unit: 'bytes',
    label: 'glibc malloc initial mmap threshold (128 KiB)',
    source: {
      ...GLIBC_MALLOPT,
      quote: 'Balancing these factors leads to a default setting of 128*1024 for the M_MMAP_THRESHOLD parameter.',
      row: 'M_MMAP_THRESHOLD',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: 'The starting value. glibc raises it dynamically as larger mmapped blocks are freed, unless M_MMAP_THRESHOLD is set.',
  },
  {
    id: 'production.glibc.bins',
    kind: 'spec',
    value: 'fast, unsorted, small, large',
    label: 'glibc malloc free-chunk bin kinds',
    source: {
      ...GLIBC_INTERNALS,
      quote: 'The normal bins are divided into "small" bins, where each chunk is the same size, and "large" bins, where chunks are a range of sizes.',
      row: 'Arenas > bins',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: 'Per arena, with a per-thread cache (tcache) in front. Fastbins do not coalesce; small and large bins do.',
  },
  {
    id: 'production.jemalloc.classes-per-doubling',
    kind: 'spec',
    value: 4,
    unit: 'classes per doubling',
    label: 'jemalloc size classes per doubling in size',
    source: {
      ...JEMALLOC_MAN,
      quote: 'there are four size classes for each doubling in size',
      row: 'Size classes',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: 'Classes that are multiples of the quantum; tiny requests round up to a power of two.',
  },
  {
    id: 'production.jemalloc.max-internal-frag',
    kind: 'spec',
    value: 20,
    unit: '%',
    label: 'jemalloc internal fragmentation bound from size-class spacing',
    source: {
      ...JEMALLOC_MAN,
      quote: 'limits internal fragmentation to approximately 20% for all but the smallest size classes',
      row: 'Size classes',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: 'Rounding waste only, not slab or extent overhead.',
  },
  {
    id: 'production.jemalloc.small-classes',
    kind: 'spec',
    value: '8, 16, 32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256',
    unit: 'bytes',
    label: 'jemalloc smallest size classes on 64-bit',
    source: {
      ...JEMALLOC_MAN,
      quote: 'lg [8] 16 [16, 32, 48, 64, 80, 96, 112, 128] 32 [160, 192, 224, 256]',
      row: 'Table 1. Size classes > Small',
    },
    verifiedAt: '2026-10-05',
    ttlDays: 365,
    boundary: '64-bit, 16-byte quantum, 4 KiB pages; the table continues to 14 KiB.',
  },
]
