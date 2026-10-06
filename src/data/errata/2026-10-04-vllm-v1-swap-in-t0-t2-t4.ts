import type { Erratum } from './schema'

export default {
  id: '2026-10-04-vllm-v1-swap-in-t0-t2-t4',
  date: '2026-10-04',
  kind: 'error',
  lessons: ['t0.l1', 't0.l2', 't2.l3', 't2.l7', 't4.l2'],
  title: 'vLLM V1 preemption is recompute-only; swap-to-CPU was V0 and the paper',
  before:
    'vLLM preempts by swapping KV to CPU RAM: "the swap tier for preempted sequences", "vLLM swap KV cache the same way", and a quiz key naming swap-vs-recompute as vLLM\'s current choice.',
  after:
    'V1 frees the victim\'s blocks and recomputes the sequence on resume; prefix-cache hits or engine KV offload can shorten that. Swap to CPU RAM is the V0 and PagedAttention-paper (SOSP \'23 §4) option.',
  why: 'The scheduler sets num_computed_tokens to 0 on preemption, so a preemption storm burns prefill FLOPs, not PCIe bandwidth. The swap-versus-recompute trade-off is still worth knowing; it is just history now.',
  source: {
    url: 'https://github.com/vllm-project/vllm/blob/main/vllm/v1/core/sched/scheduler.py',
    title: 'vLLM scheduler.py, _preempt_request (frees blocks, num_computed_tokens = 0)',
  },
  items: [
    {
      q: 'vLLM V1 runs out of free KV blocks and preempts a running sequence. What does it do with it?',
      options: [
        'Copies its blocks to host memory and copies them back on resume',
        'Frees its blocks and resets num_computed_tokens to recompute',
        'Parks the sequence with its blocks pinned until another one finishes',
        'Aborts the request and returns an out-of-memory error to the client',
      ],
      correct: [1],
      why: [
        'That was the V0 and PagedAttention-paper swap option. V1 does not copy blocks to host memory.',
        'Right: the scheduler frees the victim blocks and sets num_computed_tokens to 0, so a preemption storm burns prefill FLOPs, not PCIe bandwidth.',
        'Pinning the blocks would keep the memory the scheduler needs. Preemption exists to give blocks back.',
        'Preemption is not failure. The request stays queued and is recomputed when memory frees up.',
      ],
    },
  ],
} satisfies Erratum
