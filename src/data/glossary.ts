/**
 * The glossary pairs: OS concept and its LLM-serving twin (glossary.md §3, the content source of truth).
 * Split out of the Glossary page so the ⌘K index build (scripts/build-search-index.ts) can read them
 * without importing the page and its animation library.
 */

export interface Pair {
  slug: string
  os: string
  osDef: string
  llm: string
  llmDef: string
  why: string
  taught: string
  /** lesson deep link, e.g. `t2.l2` */
  lesson: string
  tracks: string[]
  formula?: string
  syn: string[]
}

const P = (
  slug: string,
  os: string,
  osDef: string,
  llm: string,
  llmDef: string,
  why: string,
  taught: string,
  lesson: string,
  tracks: string[],
  syn: string[],
  formula?: string,
): Pair => ({ slug, os, osDef, llm, llmDef, why, taught, lesson, tracks, syn, formula })

export const PAIRS: Pair[] = [
  P('page', 'Page', 'Fixed-size chunk of virtual memory (4 KiB).', 'KV token block (16 tok)', 'Fixed-size chunk of a sequence\u2019s KV cache.', 'Both turn variable-length memory demand into uniform allocation units — the unit size trades a little internal waste for zero external fragmentation.', 'T2.L2 → T5.L5', 't2.l2', ['t2', 't5'], ['block', 'chunk', 'memory unit']),
  P('page-table', 'Page table', 'Per-process map: virtual page → physical frame.', 'Block table', 'Per-sequence map: logical KV block → physical HBM block.', 'PagedAttention is demand paging: the block table is the page table, and every decode step is an address translation.', 'T2.L2 → T5.L5', 't5.l5', ['t2', 't5'], ['pagedattention', 'vllm', 'address translation'], 'logical → physical'),
  P('tlb', 'TLB', 'Tiny cache of recent page-table entries.', 'Block-table lookup cache', 'Hot path that keeps block lookups off the critical path.', 'Translation is on every access, so both systems cache the translation itself — a hit costs ~1 cycle, a miss costs a walk.', 'T2.L2 → T5.L5', 't2.l2', ['t2', 't5'], ['translation lookaside buffer', 'cache']),
  P('page-fault', 'Page fault', 'Access to a non-resident page traps to the OS.', 'KV block miss + fetch', 'A needed block is not in HBM — fetch or recompute it.', 'The trap is expensive but invisible to the caller; both systems hide the fetch behind a fault handler and resume.', 'T2.L2', 't2.l2', ['t2'], ['fault', 'miss', 'trap']),
  P('swap', 'Swap space', 'Disk backing store for evicted pages.', 'KV cache offload to CPU DRAM', 'Cold KV blocks spilled out of HBM.', 'When the fast tier fills, both push cold state to a slower tier and pay bandwidth to get it back — capacity beats recompute until it doesn\u2019t.', 'T2.L3 → T5.L5', 't2.l3', ['t2', 't5'], ['offload', 'spill', 'disk', 'dram']),
  P('eviction-lru', 'Eviction (LRU)', 'Drop the least-recently-used page under pressure.', 'KV prefix eviction / recompute', 'Drop cold prefixes; recompute on demand.', 'LRU is a bet that past use predicts future use; when it\u2019s wrong, both systems thrash — re-fetching what they just dropped.', 'T2.L3', 't2.l3', ['t2'], ['lru', 'thrashing', 'replacement']),
  P('copy-on-write', 'Copy-on-write', 'Shared pages, copied only on mutation.', 'Prefix sharing across sequences', 'Shared prompt blocks, refcounted across requests.', 'Fork and parallel sampling are the same trick: share the read-only prefix, branch lazily, pay for memory only at divergence.', 'T2.L2 → T5.L5', 't5.l5', ['t2', 't5'], ['cow', 'fork', 'prefix', 'sharing', 'beam']),
  P('malloc', 'malloc / free list', 'General-purpose heap allocator.', 'KV block allocator (vLLM)', 'Free-list allocator over fixed KV blocks.', 'You built this in T1: a free list, alloc/free in O(1), no compaction — because the blocks are uniform, the allocator never fragments.', 'T1.L3', 't1.l3', ['t1'], ['allocator', 'heap', 'free list', 'vllm']),
  P('external-fragmentation', 'External fragmentation', 'Free memory stranded in unusably small holes.', 'Reserved-context waste in naive KV', 'HBM stranded in worst-case reservations.', 'Reserving max-context per request strands 60–80% of HBM — the same death as a fragmented heap, just measured in gigabytes.', 'T1.L4 → T5.L5', 't1.l4', ['t1', 't5'], ['fragmentation', 'waste', 'reservation']),
  P('fixed-size-pages', 'Fixed-size pages', 'Uniform pages: some internal waste, no holes.', 'Fixed token blocks (<4% waste)', 'Uniform 16-token blocks cap waste at the tail.', 'Internal fragmentation is bounded and cheap; external fragmentation is unbounded and fatal. Both systems choose the bounded evil.', 'T1.L4 → T5.L5', 't5.l5', ['t1', 't5'], ['internal fragmentation', 'uniform', 'block size']),
  P('process', 'Process', 'An address space + resources under one identity.', 'Request / sequence', 'A prompt, its KV state, and its stream.', 'The unit of ownership: each gets isolated state, an id, and a lifecycle the scheduler manages independently.', 'T2.L1', 't2.l1', ['t2'], ['request', 'sequence', 'isolation']),
  P('thread', 'Thread', 'Independent execution within a process.', 'Sequence in a batch', 'Independent generation within an engine step.', 'Threads share an address space; batched sequences share the GPU\u2019s weights — parallel work amortizing one big resource.', 'T2.L1', 't2.l1', ['t2'], ['sequence', 'parallel', 'batch']),
  P('context-switch', 'Context switch', 'Save/restore state to run another process.', 'Iteration-level preemption', 'Free a sequence\u2019s KV mid-generation and recompute it on resume (V1; V0 could swap it to CPU).', 'Both pause work to keep the machine fair and full — and both pay for it in state movement, so both minimize how often it happens.', 'T2.L1 → T5.L7', 't5.l7', ['t2', 't5'], ['preemption', 'swap', 'scheduling']),
  P('scheduler', 'Scheduler / runqueue', 'Picks who runs next, every tick.', 'Continuous batcher', 'Admits and evicts sequences every iteration.', 'The runqueue is the batch: admission at iteration boundaries keeps the GPU exactly as full as the ready queue allows.', 'T2.L4 → T5.L7', 't5.l7', ['t2', 't5'], ['continuous batching', 'runqueue', 'orca', 'vllm']),
  P('admission-control', 'Admission control', 'Refuse work the system can\u2019t serve well.', 'Max-batch / max-tokens gating', 'Cap batch size and total KV tokens.', 'Saying no early is how both protect latency SLOs — overload admitted is throughput lost, not gained.', 'T2.L4 → T5.L7', 't5.l7', ['t2', 't5'], ['max batch', 'overload', 'slo', 'backpressure']),
  P('priority-inversion', 'Priority inversion', 'A low-priority task blocks a high-priority one.', 'Long-prompt head-of-line blocking', 'One giant prefill stalls every decode behind it.', 'An unbounded work unit starves everyone queued behind it; the fix in both worlds is to bound or split the unit.', 'T2.L4 → T5.L8', 't2.l4', ['t2', 't5'], ['head of line', 'hol blocking', 'starvation', 'prefill']),
  P('time-slicing', 'Time-slicing', 'Bound a task\u2019s run so others get the CPU.', 'Chunked prefill (SARATHI)', 'Split prefill into fixed-size chunks.', 'Long prefills are sliced so decode steps interleave every iteration — exactly the quantum a preemptive scheduler enforces.', 'T2.L4 → T5.L8', 't5.l8', ['t2', 't5'], ['sarathi', 'chunked prefill', 'quantum', 'fairness']),
  P('mutex-atomics', 'Mutex / atomics', 'Serialize access to shared state.', 'Kernel reductions & stream sync', 'Serialize GPU work where order matters.', 'Some operations must be atomic to be correct — but every serialization point is a stall, so both design to minimize shared state.', 'T2.L5 → T4', 't2.l5', ['t2', 't4'], ['lock', 'atomic', 'sync', 'reduction', 'barrier']),
  P('lock-free-queue', 'Lock-free queue', 'Wait-free handoff between producers/consumers.', 'Dynamo\u2019s Rust message plane (NATS)', 'Lock-free handoff between prefill and decode workers.', 'Disaggregated serving moves tokens between processes, not threads — the same lock-free discipline, one address space wider.', 'T2.L5 → T3.L6', 't2.l5', ['t2', 't3'], ['nats', 'dynamo', 'mpmc', 'ring buffer', 'rust']),
  P('epoll', 'epoll / io_uring', 'One thread, ten thousand ready sockets.', 'Async token streaming backpressure', 'One server, ten thousand open token streams.', 'Scale by reacting to readiness, not by polling: SSE token streams are just another event loop with a slow consumer at the end.', 'T2.L6 → T3.L6', 't2.l6', ['t2', 't3'], ['async', 'io', 'sse', 'streaming', 'event loop']),
  P('cache-line', 'Cache line (64B)', 'Memory moves in 64-byte bursts, not bytes.', 'Coalesced HBM access / tiling', 'HBM moves in wide bursts, not scalars.', 'The hardware fetches a neighborhood whether you want it or not — layouts that match the burst get the bytes for free.', 'T0.L4 → T4.L6', 't0.l4', ['t0', 't4'], ['coalescing', 'hbm', 'burst', 'bandwidth']),
  P('cache-blocking', 'Cache blocking', 'Tile loops so working data stays in cache.', 'FlashAttention tiling', 'Tile attention so blocks stay in SRAM.', 'FlashAttention is a loop-tiling optimization: keep Q/K/V tiles on-chip, never materialize the N×N matrix in HBM.', 'T0.L3 → T4.L6', 't4.l6', ['t0', 't4'], ['flashattention', 'tiling', 'sram', 'locality']),
  P('gc-pause', 'GC pause', 'The world stops while the heap is walked.', 'Synchronous host↔device copies', 'The stream stalls while bytes cross PCIe.', 'Both are stop-the-world taxes for moving memory — the fix is the same too: do it less, do it in bulk, do it off the critical path.', 'T0.L5 → T5.L3', 't0.l5', ['t0', 't5'], ['pcie', 'stall', 'copy', 'latency']),
  P('jit-warmup', 'JIT warmup', 'Slow first runs while the compiler learns.', 'CUDA graph capture / warmup', 'Slow first runs while kernels are captured.', 'Peak throughput is earned after a warmup phase — record the work once, then replay it at machine speed forever.', 'T0.L5 → T5.L10', 't0.l5', ['t0', 't5'], ['cuda graph', 'compile', 'warmup', 'replay']),
]
