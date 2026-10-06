/**
 * T2 (OS and concurrency) KCs: processes, page tables and a run queue (docs/specs/wave-1.md §4.9).
 *
 * Pairing edges into R (§4.3): `t2.process-thread` requires `r.closures-collections` (r.l6: a thread
 * runs a move closure, so what it may touch is what it captured), `t2.copy-on-write` requires
 * `r.smart-pointers` (r.l7: Rc::make_mut is copy-on-write over a reference count, as are vLLM's shared
 * blocks), `t2.mutex-atomics` requires `r.interior-mutability` (r.l8: Mutex<T> hands out &mut through
 * a guard), `t2.async-tasks` requires `r.lifetimes` (r.l9: tokio::spawn takes an `async move` block
 * because a task must own what it holds), and `t2.aba` requires `r.compare-exchange` (r.l10).
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T2_KCS: readonly Kc[] = [
  /* ---- t2.l1 ---- */
  {
    id: 't2.process-thread',
    title: 'Processes and threads',
    can: 'You can say what the threads of one process share (address space, heap) and what each owns (stack, registers).',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l1'],
    requires: ['t1.stack-vs-heap', 'r.closures-collections'],
    since,
  },
  {
    id: 't2.context-switch',
    title: 'Context-switch cost',
    can: 'You can estimate the direct cost of a context switch, and name its larger hidden cost: cold caches and TLB.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l1', 't2.l6'],
    requires: ['t2.process-thread', KC.locality],
    since,
  },

  /* ---- t2.l2 ---- */
  {
    id: KC.addressTranslation,
    title: 'Address translation',
    can: 'You can walk a virtual address through a page table to a physical frame, by hand.',
    track: 't2',
    kind: 'procedure',
    lessons: ['t2.l2', 't2.l7'],
    requires: ['t1.pointers'],
    confusable: ['t2.pagedattention-as-paging'],
    threshold: 'core',
    since,
  },
  {
    id: 't2.tlb',
    title: 'The TLB',
    can: 'You can say what a TLB caches, and estimate what a miss costs in page-walk memory accesses.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l2'],
    requires: [KC.addressTranslation, KC.locality],
    since,
  },
  {
    id: 't2.page-faults',
    title: 'Page faults',
    can: 'You can tell a minor fault, a major fault and a segfault apart, and say what the kernel does for each.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l2'],
    requires: [KC.addressTranslation],
    since,
  },
  {
    id: 't2.copy-on-write',
    title: 'Copy-on-write sharing',
    can: 'You can explain how fork and beam search share pages or blocks by reference count until the first write.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l2', 't2.l7'],
    requires: ['t2.page-faults', 'r.smart-pointers'],
    since,
  },

  /* ---- t2.l3 ---- */
  {
    id: 't2.eviction-policies',
    title: 'Eviction policies',
    can: 'You can compare LRU, Clock and LFU on a trace, and say why kernels approximate LRU instead of running it.',
    track: 't2',
    kind: 'procedure',
    lessons: ['t2.l3'],
    requires: ['t2.page-faults', KC.locality],
    confusable: ['t2.swap-vs-recompute'],
    since,
  },
  {
    id: 't2.thrashing',
    title: 'Thrashing',
    can: 'You can recognise thrashing (a working set larger than memory) and fix it by admitting less work.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l3'],
    requires: ['t2.eviction-policies'],
    since,
  },
  {
    id: 't2.swap-vs-recompute',
    title: 'Swap versus recompute',
    can: 'You can choose between swapping a victim\'s state out and recomputing it, and say which one vLLM V1 kept.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l3', 't2.l7'],
    requires: ['t2.eviction-policies'],
    // eviction picks the victim; swap-or-recompute decides what happens to its state
    confusable: ['t2.eviction-policies'],
    claims: ['production.vllm.v1-preemption'],
    since,
  },

  /* ---- t2.l4 ---- */
  {
    id: 't2.sched-policies',
    title: 'Scheduling policies',
    can: 'You can predict how FIFO, round robin and EEVDF treat short and long jobs, including the convoy effect.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l4'],
    requires: ['t2.context-switch'],
    since,
  },
  {
    id: KC.admissionScheduling,
    title: 'Admission control',
    can: 'You can explain why a scheduler must queue or refuse work under overload, and why continuous batching is admission.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l4', 't2.l3', 't2.l7'],
    requires: ['t2.sched-policies', 't2.thrashing'],
    threshold: 'core',
    since,
  },
  {
    id: 't2.priority-inversion',
    title: 'Priority inversion',
    can: 'You can trace how a low-priority lock holder blocks a high-priority waiter, and name priority inheritance.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l4'],
    requires: ['t2.sched-policies'],
    since,
  },

  /* ---- t2.l5 ---- */
  {
    id: 't2.mutex-atomics',
    title: 'Mutex, atomic or lock-free',
    can: 'You can choose a mutex, an atomic or a lock-free queue for shared state, and defend the choice.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l5'],
    requires: ['t2.process-thread', 't0.cache-lines', 'r.interior-mutability'],
    confusable: ['r.atomics-ordering'],
    since,
  },
  {
    id: 't2.aba',
    title: 'Lock-free queues and ABA',
    can: 'You can explain how ABA fools a compare-and-swap, and name a fix such as a tagged pointer.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l5'],
    requires: ['t2.mutex-atomics', 'r.compare-exchange'],
    since,
  },

  /* ---- t2.l6 ---- */
  {
    id: 't2.async-io',
    title: 'Readiness versus completion I/O',
    can: 'You can say what epoll and io_uring each change about waiting for I/O, and why one thread can serve 10k sockets.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l6'],
    requires: ['t2.context-switch'],
    since,
  },
  {
    id: 't2.async-tasks',
    title: 'Async tasks and blocking',
    can: 'You can say why a suspended task costs hundreds of bytes, and why one blocking call stalls its whole thread.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l6'],
    requires: ['t2.async-io', 'r.lifetimes'],
    since,
  },

  /* ---- t2.l7 ---- */
  {
    id: 't2.pagedattention-as-paging',
    title: 'PagedAttention as paging',
    can: 'You can map PagedAttention onto paging: KV blocks are pages, block tables are page tables.',
    track: 't2',
    kind: 'concept',
    lessons: ['t2.l7', 't5.l5'],
    requires: [KC.addressTranslation, KC.fixedBlocks],
    contains: [KC.addressTranslation],
    confusable: [KC.addressTranslation],
    claims: ['production.vllm.block-size'],
    since,
  },
]
