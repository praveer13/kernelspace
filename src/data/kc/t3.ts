/**
 * T3 (Rust for systems) KCs (docs/specs/wave-2.md §4.1-4.4; task 2a-11): 2-3 per lesson, seeded from each
 * lesson's H2s and checkpoint items (`bun scripts/kc/seed-candidates.ts t3`).
 *
 * T3 adds to R what a runtime needs: shared graphs, zero-copy buffers, Send/Sync, an executor, a sandbox and
 * the data-plane argument. Most edges point back into R and T2, which is the braid: t3.l1 recalls
 * r.ownership-moves, r.borrow-rules and r.lifetimes by retrieval (§17.4), so its own KCs are what T3 adds.
 *
 * `t3.unsafe-boundaries` is the T-side pairing edge for `r.analyzer-limits` (r.l4, §4.2): unsafe is what a
 * programmer writes where the analyzer's limits bite.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T3_KCS: readonly Kc[] = [
  /* ---- t3.l1 ---- */
  {
    id: 't3.cyclic-structures',
    title: 'Graphs without leaks',
    can: 'You can build a graph from an arena with index handles, or Rc with Weak back-edges, and say why a strong cycle leaks.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l1'],
    requires: ['r.smart-pointers', 'r.closures-collections'],
    since,
  },
  {
    id: 't3.shared-state-cost',
    title: 'Rc<RefCell<T>> versus Arc<Mutex<T>>',
    can: 'You can choose Rc<RefCell<T>> or Arc<Mutex<T>> for shared state, and say what each checks at run time and costs.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l1'],
    requires: ['r.interior-mutability'],
    since,
  },

  /* ---- t3.l2 ---- */
  {
    id: 't3.zero-copy-buffers',
    title: 'Zero-copy buffers',
    can: 'You can share one byte buffer through slices or refcounted views like bytes::Bytes instead of copying it.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l2'],
    requires: ['r.slices', 'r.smart-pointers'],
    since,
  },
  {
    id: KC.unsafeBoundaries,
    title: 'Unsafe boundaries',
    can: 'You can say what an unsafe block promises, keep it small behind a safe API, and name the invariants it relies on.',
    track: 't3',
    kind: 'concept',
    // t3.l7 weighs unsafe surface area when it picks Rust, Zig or C
    lessons: ['t3.l2', 't3.l7'],
    requires: [KC.analyzerLimits, 'r.slices'],
    since,
  },

  /* ---- t3.l3 ---- */
  {
    id: 't3.send-sync',
    title: 'Send and Sync',
    can: 'You can tell whether a type is Send or Sync from its parts, and why Rc is neither but Arc<Mutex<T>> is both for T: Send.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l3'],
    requires: ['t3.shared-state-cost', 't2.process-thread'],
    since,
  },
  {
    id: 't3.concurrency-architecture',
    title: 'Channels, locks or atomics',
    can: 'You can pick message passing, a lock or atomics for a workload from how much state its threads share and contend on.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l3'],
    requires: ['t3.send-sync', 't2.mutex-atomics'],
    since,
  },

  /* ---- t3.l4: the toy executor (lab 05) ---- */
  {
    id: 't3.futures-state-machines',
    title: 'Futures as state machines',
    can: 'You can read an async fn as a state machine that poll advances, returning Pending at each await that cannot finish.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l4'],
    requires: ['t2.async-tasks'],
    // who makes progress: poll runs the future, the waker only reschedules it (the usual slip runs them together)
    confusable: ['t3.wakers-executor'],
    since,
  },
  {
    id: 't3.wakers-executor',
    title: 'Wakers and the executor loop',
    can: 'You can trace how a waker requeues a pending task on an executor, and why a task that never arranges a wake hangs.',
    track: 't3',
    kind: 'skill',
    lessons: ['t3.l4'],
    requires: ['t3.futures-state-machines', 't3.send-sync'],
    confusable: ['t3.futures-state-machines'],
    since,
  },

  /* ---- t3.l5 ---- */
  {
    id: 't3.wasm-sandbox',
    title: 'The Wasm sandbox',
    can: 'You can say what a Wasm module can touch (its own linear memory and its imports) and why untrusted code runs safely.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l5'],
    requires: ['t1.memory-errors'],
    since,
  },
  {
    id: 't3.wasm-boundary-cost',
    title: 'The JS-Wasm boundary',
    can: 'You can predict when Wasm beats JavaScript, and when copying data across the boundary eats the gain.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l5'],
    requires: ['t3.wasm-sandbox', 't0.runtime-costs'],
    since,
  },

  /* ---- t3.l6 ---- */
  {
    id: 't3.data-plane-requirements',
    title: 'Data plane versus control plane',
    can: 'You can split a serving system into a latency-critical data plane and a control plane, and pick a language for each.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l6', 't3.l7'],
    requires: ['t0.runtime-costs', 't3.wakers-executor'],
    since,
  },
  {
    id: 't3.backpressure',
    title: 'Backpressure through bounded queues',
    can: 'You can use bounded channels so overload pushes back on producers and waits upstream instead of exhausting memory.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l6'],
    requires: ['t3.concurrency-architecture', 't2.admission-scheduling'],
    since,
  },

  /* ---- t3.l7 (the T3 spiral) ---- */
  {
    id: 't3.language-choice',
    title: 'Choosing Rust, Zig or C',
    can: 'You can choose Rust, Zig or C for a component from its failure cost, ecosystem gravity and the code it must call.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l7'],
    requires: ['t3.data-plane-requirements', KC.unsafeBoundaries],
    since,
  },
]
