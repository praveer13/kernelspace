import { registerClaims } from '../registry'
import { SGLANG_PIN, VLLM_PIN } from '../engines'
import type { Claim } from '../schema'

/**
 * The two production twins' pinned facts (spec wave-3 §4.4 and §9, 3a-08): the lab 07 twin reads SGLang's radix-tree
 * core, the lab 06 twin vLLM's scheduler. Both are `status` claims pinned to the release the In-production claims
 * use (engines.ts), with ttlDays 60, so the twin shows "stale since" when the engines move. Quotes were copied from
 * the files at those refs on 2026-10-14.
 */
const SGLANG_ENVIRON = {
  url: `https://raw.githubusercontent.com/${SGLANG_PIN.repo}/${SGLANG_PIN.ref}/python/sglang/srt/environ.py`,
  title: 'SGLang v0.5.21 source: srt/environ.py (SGLANG_UNIFIED_RADIX_TREE_CORE_BACKEND)',
}
const VLLM_SCHEDULER = {
  url: `https://raw.githubusercontent.com/${VLLM_PIN.repo}/${VLLM_PIN.ref}/vllm/v1/core/sched/scheduler.py`,
  title: 'vLLM v0.31.0 source: vllm/v1/core/sched/scheduler.py (Scheduler.schedule)',
}

export const TWIN_CLAIMS: Claim[] = [
  {
    id: 'twin.sglang.treecore',
    kind: 'status',
    value: 'rust',
    label: 'SGLang radix-tree core default',
    source: { ...SGLANG_ENVIRON, quote: 'SGLANG_UNIFIED_RADIX_TREE_CORE_BACKEND = EnvStr("rust")', row: 'envs.SGLANG_UNIFIED_RADIX_TREE_CORE_BACKEND' },
    pin: SGLANG_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'The Rust TreeCore became the default with sgl-project/sglang PR #39627, merged 2026-09-29. The registry falls back to the Python core when its checks fail (Linux only, a supported PyTorch, a supported device, a toolchain or the bundled extension).',
  },
  {
    id: 'twin.vllm.scheduler',
    kind: 'status',
    value: 'no prefill or decode phase',
    label: 'vLLM v1 scheduler: one loop for every request',
    source: {
      ...VLLM_SCHEDULER,
      quote: 'There\'s no "decoding phase" nor "prefill phase" in the scheduler.',
      row: 'Scheduler.schedule (NOTE on the scheduling algorithm)',
    },
    pin: VLLM_PIN,
    verifiedAt: '2026-10-14',
    ttlDays: 60,
    boundary:
      'Each request has a count of computed tokens that catches up with its tokens to compute; schedule() spends one token budget per step across running and waiting requests, so chunked prefill, prefix caching and speculative decoding fall out of one rule.',
  },
]

registerClaims(TWIN_CLAIMS)
