/**
 * Forge labs — local-only Rust labs (PLAN.md §3.1, Appendix B "local-only").
 *
 * The student edits one file in the template crate, proves it with
 * `cargo test`, builds a wasm32-unknown-unknown module, and drops it onto
 * /forge/:labId — the site runs the module's own self-check suite
 * (src/lib/wasm-lab.ts) and records completion. No server, no account.
 */

import type { TrackId } from '@/data/lessons/types'

export interface ForgeLabCheck {
  id: string
  label: string
  /** Advanced extension that is reported but does not gate lab completion. */
  optional?: boolean
}

export interface ForgeLab {
  id: string
  index: number
  title: string
  hook: string
  trackId: TrackId
  /** lesson this lab deepens */
  lessonId: string
  minutes: number
  /** expected check ids/labels — rendered before the run, matched after */
  checks: ForgeLabCheck[]
  /** public/ path of the downloadable template zip */
  zip: string
  /** wasm artifact the student drops, relative to crate root */
  artifact: string
  /** the crate file the student edits */
  editFile: string
  /** directory entered from the extracted workspace root; defaults to id */
  crateDir?: string
  /** Rust Zero lessons expected before a systems lab */
  readiness?: {
    label: string
    lessonIds: string[]
    required?: boolean
  }
  /** shown on the all-green completion panel */
  completion: { title: string; next: string }
  /** measurement follow-through shown only after all checks pass */
  profile?: { command: string; question: string }
  brief: string[]
}

export const RUST_ZERO_LABS: ForgeLab[] = [
  {
    id: 'rust-zero-r1',
    index: 1,
    title: 'Bindings & Expressions',
    hook: 'Six tiny functions for mutability, shadowing, conversions, block values, branches, and destructuring.',
    trackId: 'r',
    lessonId: 'r.l1',
    minutes: 20,
    zip: '/labs/rust-zero-r1.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r1.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r1-bindings',
    completion: {
      title: 'six green — Rust syntax has stopped being scenery.',
      next: 'next: R2 turns the same expression model into functions, loops, and match.',
    },
    checks: [
      { id: 'mut_accumulate', label: 'mutable accumulation' },
      { id: 'shadow_convert', label: 'shadow a value into a new type' },
      { id: 'typed_average', label: 'explicit numeric conversion' },
      { id: 'block_value', label: 'return a block expression' },
      { id: 'branch_value', label: 'if as a value' },
      { id: 'destructure', label: 'tuple destructuring' },
    ],
    brief: [
      'This is rustlings in the same harness as the systems Forge: six single-purpose functions, each small enough that the compiler message is the lesson. Replace the todo bodies in src/exercises.rs; do not change the signatures.',
      'The checks establish the syntax every later crate assumes: immutable-by-default bindings, deliberate mutability, shadowing, typed arithmetic, and expression-valued blocks.',
    ],
  },
  {
    id: 'rust-zero-r2',
    index: 2,
    title: 'Functions & Control Flow',
    hook: 'Pure logic drills for typed functions, ranges, while, loop values, exhaustive match, and guards.',
    trackId: 'r',
    lessonId: 'r.l2',
    minutes: 20,
    zip: '/labs/rust-zero-r2.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r2.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r2-control-flow',
    completion: {
      title: 'six green — ordinary control flow is now ordinary Rust.',
      next: 'next: R3 adds the rule that changes how values cross those function boundaries.',
    },
    checks: [
      { id: 'branch_expression', label: 'if/else expression' },
      { id: 'range_sum', label: 'for over a half-open range' },
      { id: 'while_search', label: 'condition-driven search' },
      { id: 'loop_value', label: 'break with a value' },
      { id: 'tuple_match', label: 'exhaustive tuple match' },
      { id: 'guarded_match', label: 'match arm guard' },
    ],
    brief: [
      'These functions use only Copy values, so ownership cannot distract from syntax. Make each branch return the declared type and let exhaustiveness errors point out any state you forgot.',
      'A solution should be boring: no allocation, no recursion, and no unsafe. The goal is fluency with the shapes, not cleverness.',
    ],
  },
  {
    id: 'rust-zero-r3',
    index: 3,
    title: 'Ownership & Moves',
    hook: 'Repair move boundaries, return ownership, clone only when required, and move fields without leaving holes.',
    trackId: 'r',
    lessonId: 'r.l3',
    minutes: 28,
    zip: '/labs/rust-zero-r3.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r3.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r3-ownership',
    completion: {
      title: 'six green — you can follow the single drop obligation.',
      next: 'next: R4 lends values across functions without transferring that obligation.',
    },
    checks: [
      { id: 'copy_scalar', label: 'distinguish Copy from move' },
      { id: 'return_ownership', label: 'consume and return an owned String' },
      { id: 'clone_independent', label: 'clone only for independent buffers' },
      { id: 'consume_vec', label: 'consume a Vec into a result' },
      { id: 'option_take', label: 'move a value out through Option::take' },
      { id: 'replace_field', label: 'replace and return an owned field' },
    ],
    brief: [
      'Each function asks who owns the value after the call. Follow the signatures rather than adding clone until rustc goes quiet.',
      'The final two exercises use Option::take and mem::replace: standard ways to move a field while immediately leaving a valid value behind.',
    ],
  },
  {
    id: 'rust-zero-r4',
    index: 4,
    title: 'Borrowing & Slices',
    hook: 'Shared and exclusive references, zero-copy slices, split borrows, and a subslice returned safely.',
    trackId: 'r',
    lessonId: 'r.l4',
    minutes: 30,
    zip: '/labs/rust-zero-r4.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r4.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r4-borrowing',
    completion: {
      title: 'six green — many readers or one writer is now muscle memory.',
      next: 'next: R5 uses those references inside real domain types and fallible APIs.',
    },
    checks: [
      { id: 'slice_sum', label: 'read through a shared slice' },
      { id: 'mutate_slice', label: 'update through a mutable slice' },
      { id: 'split_mut', label: 'mutate disjoint halves safely' },
      { id: 'str_view', label: 'accept a borrowed string view' },
      { id: 'borrow_then_mutate', label: 'end a read before mutation' },
      { id: 'subslice', label: 'return a slice tied to the input' },
    ],
    brief: [
      'Solve every exercise without cloning. The APIs deliberately accept slices rather than concrete Vec or String owners.',
      'When a borrow conflicts, find the last use of the reference. Shrinking that live range or splitting the data is usually the real repair.',
    ],
  },
  {
    id: 'rust-zero-r5',
    index: 5,
    title: 'Modeling & Errors',
    hook: 'Struct methods, enum state, Option lookup, Result validation, question-mark propagation, and nested match.',
    trackId: 'r',
    lessonId: 'r.l5',
    minutes: 30,
    zip: '/labs/rust-zero-r5.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r5.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r5-modeling',
    completion: {
      title: 'six green — invalid and fallible states are visible in your types.',
      next: 'next: R6 fills those models with Vec, HashMap, closures, and iterator pipelines.',
    },
    checks: [
      { id: 'block_method', label: 'derive a value through a struct method' },
      { id: 'state_match', label: 'exhaustively match an enum state' },
      { id: 'option_lookup', label: 'return optional lookup state' },
      { id: 'result_validate', label: 'validate with a typed error' },
      { id: 'question_mark', label: 'propagate parse failure with ?' },
      { id: 'nested_match', label: 'match Option containing an enum' },
    ],
    brief: [
      'This set introduces the type shapes used by the allocator and KV block manager. Absence and recoverable failure must remain explicit all the way to the caller.',
      'Complete R1 through R5 before systems lab 01; together they cover every Rust construct its free-list implementation requires.',
    ],
  },
  {
    id: 'rust-zero-r6',
    index: 6,
    title: 'Collections & Iterators',
    hook: 'Vec transforms, stable sorting, HashMap entry APIs, closure capture, and a full map/filter/fold pipeline.',
    trackId: 'r',
    lessonId: 'r.l6',
    minutes: 30,
    zip: '/labs/rust-zero-r6.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r6.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r6-collections',
    completion: {
      title: 'six green — the Forge data paths are now familiar.',
      next: 'next: R7 chooses explicit heap and shared-ownership policies.',
    },
    checks: [
      { id: 'filter_vec', label: 'filter owned values into a Vec' },
      { id: 'stable_sort', label: 'stable key-based ordering' },
      { id: 'frequency_map', label: 'count values with HashMap::entry' },
      { id: 'grouped_sum', label: 'accumulate values by key' },
      { id: 'closure_capture', label: 'capture a threshold in a closure' },
      { id: 'iterator_pipeline', label: 'compose map, filter, and fold' },
    ],
    brief: [
      'The iterator type tells you whether values are borrowed, mutably borrowed, or consumed. Make that choice first; most closure diagnostics become straightforward afterward.',
      'These exact shapes recur in tokenizer lab 03 and scheduler lab 06: ranked data, frequency maps, grouping, filtering, and deterministic ordering.',
    ],
  },
  {
    id: 'rust-zero-r7',
    index: 7,
    title: 'Box, Rc & Arc',
    hook: 'Build recursive ownership, observe reference counts, break cycles with Weak, and share immutable data across threads.',
    trackId: 'r',
    lessonId: 'r.l7',
    minutes: 30,
    zip: '/labs/rust-zero-r7.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r7.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r7-smart-pointers',
    completion: {
      title: 'six green — pointer types now read as ownership policies.',
      next: 'next: R8 adds controlled mutation behind shared access.',
    },
    checks: [
      { id: 'boxed_list', label: 'own a recursive tail through Box' },
      { id: 'rc_counts', label: 'track Rc strong owners' },
      { id: 'weak_edge', label: 'hold a non-owning Weak edge' },
      { id: 'arc_share', label: 'share immutable data with Arc' },
      { id: 'handle_clone', label: 'clone a handle, not its payload' },
      { id: 'unwrap_unique', label: 'recover a uniquely owned Arc value' },
    ],
    brief: [
      'Every exercise asks for the smallest ownership policy that works. Rc and Arc cloning must share one allocation, not deep-copy its payload.',
      'KV manager lab 02 needs reference-count reasoning; executor lab 05 needs Arc-based shared ownership. This drill is their common ramp.',
    ],
  },
  {
    id: 'rust-zero-r8',
    index: 8,
    title: 'Interior Mutability',
    hook: 'Cell counters, RefCell borrow guards, non-panicking conflict detection, scoped repairs, and Mutex updates.',
    trackId: 'r',
    lessonId: 'r.l8',
    minutes: 32,
    zip: '/labs/rust-zero-r8.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r8.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r8-interior-mutability',
    completion: {
      title: 'six green — shared mutation has an explicit enforcement mechanism.',
      next: 'next: R9 makes reference validity relationships explicit in APIs and structs.',
    },
    checks: [
      { id: 'cell_counter', label: 'update a Copy counter through Cell' },
      { id: 'refcell_log', label: 'mutate a log behind RefCell' },
      { id: 'conflict_detection', label: 'detect a borrow conflict without panic' },
      { id: 'scoped_borrow', label: 'drop a read guard before a write' },
      { id: 'mutex_update', label: 'update state through a MutexGuard' },
      { id: 'lock_scope', label: 'release a guard before the next lock' },
    ],
    brief: [
      'The harness deliberately creates the RefCell already-borrowed shape, but the target function must report or avoid the conflict rather than panic.',
      'Guard lifetime is the unifying idea: a Ref, RefMut, or MutexGuard enforces access until it drops. Scope it to the work that truly needs protection.',
    ],
  },
  {
    id: 'rust-zero-r9',
    index: 9,
    title: 'Lifetime Contracts',
    hook: 'Borrowed returns, the exact Block lifetime shape from T3, unrelated inputs, and the boundary where ownership is required.',
    trackId: 'r',
    lessonId: 'r.l9',
    minutes: 30,
    zip: '/labs/rust-zero-r9.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r9.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r9-lifetimes',
    completion: {
      title: 'six green — lifetime syntax now describes contracts, not incantations.',
      next: 'next: R10 closes the ramp with the ordering protocol required by lock-free code.',
    },
    checks: [
      { id: 'first_word', label: 'return a view borrowed from one input' },
      { id: 'choose_longer', label: 'relate a return to two inputs' },
      { id: 'borrowed_block', label: 'store a token slice in Block' },
      { id: 'separate_lifetimes', label: 'keep unrelated borrows independent' },
      { id: 'owned_escape', label: 'return owned data across a lifetime boundary' },
      { id: 'subslice_contract', label: 'return a bounded subslice' },
    ],
    brief: [
      'Annotations must describe where a returned or stored reference came from. They cannot extend the underlying value, so one exercise intentionally requires an owned return.',
      'The borrowed Block is the exact form introduced again in T3.L1. Here you compile it, construct it, and prove it cannot outlive its token storage.',
    ],
  },
  {
    id: 'rust-zero-r10',
    index: 10,
    title: 'Atomics & Orderings',
    hook: 'Relaxed tickets, Release/Acquire publication, CAS, fetch-update, and the protocol behind a minimal spin lock.',
    trackId: 'r',
    lessonId: 'r.l10',
    minutes: 40,
    zip: '/labs/rust-zero-r10.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_zero_r10.wasm',
    editFile: 'src/exercises.rs',
    crateDir: 'rust-zero/r10-atomics',
    completion: {
      title: 'six green — you can name the happens-before edge.',
      next: 'next: MPMC queue lab 04 is unlocked; its cursor and slot protocol uses this vocabulary directly.',
    },
    checks: [
      { id: 'relaxed_ticket', label: 'allocate ids with a Relaxed fetch-add' },
      { id: 'publish_consume', label: 'pair Release publication with Acquire observation' },
      { id: 'compare_exchange', label: 'claim a state with CAS' },
      { id: 'fetch_update', label: 'perform conditional atomic update' },
      { id: 'spin_lock', label: 'Acquire a flag and Release it' },
      { id: 'ordering_choice', label: 'classify counter vs publication orderings' },
    ],
    brief: [
      'The checks can verify outcomes; the source signatures and tests also inspect the ordering choices. Write the protocol down: Relaxed for an independent ticket, Release to publish, Acquire to observe.',
      'R10 is required readiness for MPMC queue lab 04. Do not start the lock-free queue until compare-exchange failure and success orderings make sense.',
    ],
  },
]

export const SYSTEMS_FORGE_LABS: ForgeLab[] = [
  {
    id: 'rust-allocator',
    index: 1,
    title: 'The Allocator, For Real',
    hook: 'The T1 toy allocator, but in actual Rust — split, coalesce, align, reuse — graded by a 3000-op fragmentation gauntlet.',
    trackId: 't1',
    lessonId: 't1.l3',
    minutes: 90,
    zip: '/labs/rust-allocator.zip',
    artifact: 'target/wasm32-unknown-unknown/release/rust_allocator.wasm',
    editFile: 'src/allocator.rs',
    readiness: {
      label: 'readiness · R1–R5',
      lessonIds: ['r.l1', 'r.l2', 'r.l3', 'r.l4', 'r.l5'],
    },
    completion: {
      title: 'all six green — you built a real allocator.',
      next: 'next: T2.L7 reads the actual vLLM paper — you now know why its block manager coalesces.',
    },
    profile: {
      command: 'cargo flamegraph --test allocator_tests',
      question: 'Is the widest self-time in free-list search, insertion, or coalescing — and should it be?',
    },
    checks: [
      { id: 'boot', label: 'constructs and serves a first allocation' },
      { id: 'align', label: 'returned offsets respect alignment (1–256)' },
      { id: 'no_overlap', label: 'live allocations never overlap' },
      { id: 'coalesce', label: 'adjacent free blocks coalesce' },
      { id: 'reuse', label: 'freed blocks are reused' },
      { id: 'fragmentation', label: '3000-op churn at ~45% occupancy: zero failures' },
    ],
    brief: [
      'In T1.L3 you split and coalesced blocks in a browser sim. Now do it in Rust, for real: one 1 MiB heap, an address-ordered free list, first-fit with alignment, coalescing on free. Sixty lines that malloc would recognize.',
      'This is not busywork in a costume. vLLM\u2019s KV-cache block manager — the thing T5.L5 is about — is this exact design problem: a fixed backing store, adversarial allocation sizes, fragmentation as the failure mode. The allocator you write here is the block manager\u2019s ancestor; the paged block manager (lab 02) is its descendant.',
      'The harness is the teacher: six checks, deterministic, identical in `cargo test` and on this page. The last one is the lesson — 3000 mixed ops at ~45% occupancy. A bump allocator dies. A coalescing free-list walks through. That gap is why real allocators coalesce.',
    ],
  },
  {
    id: 'kv-block-manager',
    index: 2,
    title: 'PagedAttention, From the Inside',
    hook: 'vLLM\u2019s block manager in Rust: block tables, fork() with refcounts, copy-on-write — plus a 2000-op churn gauntlet that hunts leaks.',
    trackId: 't5',
    lessonId: 't5.l5',
    minutes: 120,
    zip: '/labs/kv-block-manager.zip',
    artifact: 'target/wasm32-unknown-unknown/release/kv_block_manager.wasm',
    editFile: 'src/manager.rs',
    readiness: {
      label: 'readiness · R5–R7',
      lessonIds: ['r.l5', 'r.l6', 'r.l7'],
    },
    completion: {
      title: 'all six green — you built PagedAttention\u2019s memory manager.',
      next: 'next: T5.L6 turns those refcounted blocks into a reusable prefix cache.',
    },
    profile: {
      command: 'cargo flamegraph --test manager_tests',
      question: 'Does churn spend its samples translating tables, maintaining refcounts, or scanning capacity?',
    },
    checks: [
      { id: 'paging', label: 'block-table math and translation' },
      { id: 'capacity', label: 'pool exhaustion is atomic; freed blocks return' },
      { id: 'fork_shares', label: 'fork shares blocks via refcounts (zero-copy)' },
      { id: 'cow', label: 'copy-on-write on append to shared tail' },
      { id: 'free_refcount', label: 'refcounted free — shared blocks survive until the last owner' },
      { id: 'gauntlet', label: '2000-op churn: block conservation after every op' },
      {
        id: 'adapter_unified_paging',
        label: 'advanced: adapter weights share the paged KV pool',
        optional: true,
      },
    ],
    brief: [
      'Lab 01 was malloc. This is the page table on top of it — the exact system from T5.L5. You get a fixed pool of physical KV blocks; sequences see a private, contiguous view through a block table; fork() shares everything via refcounts; appending to a shared tail block triggers copy-on-write. Every idea is 1979 virtual memory, reincarnated for HBM.',
      'The semantics are vLLM v0\u2019s BlockManager: fork copies the table and bumps refcounts (beam search and parallel sampling do this thousands of times per second); a shared block is read-only; frees return a block only when its last owner dies. The discipline that separates prototypes from production: every fallible operation is all-or-nothing — a half-applied allocation is how engines corrupt themselves mid-request.',
      'The gauntlet is the teacher: 2000 mixed allocate/append/fork/free ops, checking block conservation — free + referenced = total — after every single op. Underflow a refcount and blocks leak until the pool starves. Double-free and conservation breaks instantly. This is the bug class that takes down serving fleets at 3 AM, caught in a browser tab.',
      'Optional after T6.L9: extend the same pool to page LoRA adapter weights. The seventh advanced check is visible in terminal and browser but never blocks the original six-check completion; its fail-closed stub makes that contract explicit.',
    ],
  },
  {
    id: 'bpe-tokenizer',
    index: 3,
    title: 'The Front Door',
    hook: 'Byte-level BPE in Rust — lowest-rank-first merges, byte-perfect UTF-8 roundtrip, and an exact-id contract check against a trained table.',
    trackId: 't5',
    lessonId: 't5.l2',
    minutes: 90,
    zip: '/labs/bpe-tokenizer.zip',
    artifact: 'target/wasm32-unknown-unknown/release/bpe_tokenizer.wasm',
    editFile: 'src/tokenizer.rs',
    readiness: {
      label: 'readiness · R5–R6',
      lessonIds: ['r.l5', 'r.l6'],
    },
    completion: {
      title: 'all six green — you built the tokenizer front door.',
      next: 'next: production tokenizers are this algorithm + a Rust core for speed — HF tokenizers is exactly that, and T5.L2\u2019s toy Python just became real.',
    },
    profile: {
      command: 'cargo flamegraph --test tokenizer_tests',
      question: 'Is merge selection doing useful comparison work, or paying avoidable allocation and copy tax?',
    },
    checks: [
      { id: 'bytes_are_ids', label: 'base vocab: byte b ↔ id b' },
      { id: 'merge_priority', label: 'lowest-rank pair merges first (not leftmost)' },
      { id: 'leftmost_nonoverlap', label: 'repeated pairs merge left-to-right, non-overlapping' },
      { id: 'roundtrip', label: 'decode∘encode is identity over UTF-8' },
      { id: 'robust_decode', label: 'unknown ids decode to U+FFFD, empty stays empty' },
      { id: 'contract', label: 'exact ids on unseen text (the model\u2019s contract)' },
    ],
    brief: [
      'Before anything is a tensor, it is bytes — and the tokenizer decides which ids those bytes become. That mapping is not a convenience; it is the model\u2019s contract. A tokenizer that merges in the wrong order still produces plausible text. It just silently poisons every request, which is why this lab\u2019s final check demands bit-exact ids against a trained table.',
      'Byte-level BPE (GPT-2 style) is disarmingly small: ids 0–255 are raw bytes; a ranked merge table fuses adjacent pairs, lowest rank first, left-to-right non-overlapping, until nothing merges. Two subtleties separate toy implementations from correct ones — rank beats position (check 2 is the trap), and byte-level operation is what makes roundtrip over emoji and CJK a free property rather than a feature.',
      'The harness trains a 48-merge table on a fixed corpus at check time, so later merges reference earlier merge ids — like real tables. You only implement the application side, which is exactly the part serving engines run: HF tokenizers is this algorithm with a Rust core. You are writing the same file.',
    ],
  },
  {
    id: 'mpmc-queue',
    index: 4,
    title: 'The Intake Ring',
    hook: 'Vyukov\u2019s bounded MPMC queue — per-slot sequence numbers, CAS cursors, honest backpressure — then a 4×4 threaded race fuzzer on 100k items.',
    trackId: 't2',
    lessonId: 't2.l5',
    minutes: 120,
    zip: '/labs/mpmc-queue.zip',
    artifact: 'target/wasm32-unknown-unknown/release/mpmc_queue.wasm',
    editFile: 'src/queue.rs',
    readiness: {
      label: 'required · R10',
      lessonIds: ['r.l10'],
      required: true,
    },
    completion: {
      title: 'all six green — and the race fuzzer has nothing on you.',
      next: 'next: this ring is the intake of every scheduler — T5.L7\u2019s continuous batcher pops from exactly this shape, and lab 06 puts yours there.',
    },
    profile: {
      command: 'cargo flamegraph --test queue_tests',
      question: 'Under the native race test, is time in useful queue work, CAS retry, or thread parking?',
    },
    checks: [
      { id: 'fifo', label: 'strict FIFO order' },
      { id: 'backpressure', label: 'full ring returns Err(v); freed slots recycle' },
      { id: 'wraparound', label: '1000 cycles through a 4-slot ring' },
      { id: 'model_gauntlet', label: '3000 random ops vs a reference model' },
      { id: 'slot_conservation', label: 'fill/drain × 100: every slot returns every time' },
      { id: 'burst_model', label: 'bursty traffic vs the model (2000 ops)' },
    ],
    brief: [
      'Between the router and the scheduler of every serving engine sits a bounded multi-producer multi-consumer queue. io_uring\u2019s submission ring is one; your LMAX Disruptor is one. This lab is the canonical design — Vyukov\u2019s MPMC: per-slot sequence numbers solve the full-vs-empty ambiguity, two CAS cursors claim slots, no lock anywhere.',
      'The API carries the lesson: push returns Err(v) — handing the value BACK — when full. That is backpressure as a type signature: the engine never silently drops a request, the caller decides to retry or shed. And the methods take &self, because the queue is shared; all mutable state lives in atomics, and the memory orderings are the whole game.',
      'The six browser checks are semantic (wasm is single-threaded: FIFO, backpressure, wraparound, 5000 model-shadowed ops). The real race fuzzer is native-only — cargo test adds a 4-producer/4-consumer 100k-item stress with count+sum+xor conservation. A wrong Release/Acquire passes the browser and dies there. Run it ten times.',
    ],
  },
  {
    id: 'toy-executor',
    index: 5,
    title: 'Async, Demystified',
    hook: 'A real executor: spawn, take/poll/restore, FIFO wakes, block_on — the waker vtable is given, the state machine is yours. After this, tokio is an engineering detail.',
    trackId: 't3',
    lessonId: 't3.l4',
    minutes: 120,
    zip: '/labs/toy-executor.zip',
    artifact: 'target/wasm32-unknown-unknown/release/toy_executor.wasm',
    editFile: 'src/executor.rs',
    readiness: {
      label: 'readiness · R7–R8',
      lessonIds: ['r.l7', 'r.l8'],
    },
    completion: {
      title: 'all six green — you built the state machine under async.',
      next: 'next: T3.L4\u2019s tokio is this executor × work-stealing × epoll — and the checks\u2019 ping-pong waker pattern is every reactor you will ever read.',
    },
    profile: {
      command: 'cargo flamegraph --test executor_tests',
      question: 'Do the widest frames perform polling and wakes, or repeatedly borrow and scan the ready queue?',
    },
    checks: [
      { id: 'block_on', label: 'block_on returns values, through yields' },
      { id: 'fifo_poll', label: 'spawn order, then FIFO wake order' },
      { id: 'pending_repoll', label: 'Pending tasks re-polled only via wake (exactly 4 polls)' },
      { id: 'ping_pong', label: 'cross-task wakeup ×100 via stored wakers' },
      { id: 'many_tasks', label: '1000 tasks: exactly 3000 polls, zero lost' },
      { id: 'nested_spawn', label: 'tasks spawning tasks mid-run' },
    ],
    brief: [
      'Every async runtime is three ideas: a queue of woken tasks, a waker that re-queues, and a poll loop that takes a future out and puts it back only if it\u2019s Pending. The unsafe RawWaker vtable is plumbing that can\u2019t fail interestingly, so the harness ships it. What\u2019s left — the part that IS the lesson — is yours: spawn, run, block_on.',
      'The checks are the reactor contract made executable: Pending-without-wake is never re-polled (one check counts polls to prove your executor isn\u2019t busy-spinning), wakes are FIFO, Ready futures are dropped and never re-polled, and spawn must work from inside a poll. Two tasks ping-ponging 100 times through stored wakers is exactly the shape of a socket reactor — you\u2019ll recognize it in every codebase forever.',
      'One trap is documented in the template because the reference solution fell into it during development: `while let Some(t) = queue.borrow_mut().pop_front()` holds the RefMut across the whole loop body — the first wake inside poll panics with RefCell already borrowed. You\u2019re welcome.',
    ],
  },
  {
    id: 'batching-scheduler',
    index: 6,
    title: 'Goodput or Nothing',
    hook: 'The admission policy for a continuous-batching engine, graded on goodput under SLO across synthetic overloads, a recorded BurstGPT slice, and a licensed-safe LMSYS aggregate shape.',
    trackId: 't5',
    lessonId: 't5.l7',
    minutes: 150,
    zip: '/labs/batching-scheduler.zip',
    artifact: 'target/wasm32-unknown-unknown/release/batching_scheduler.wasm',
    editFile: 'src/scheduler.rs',
    readiness: {
      label: 'readiness · R5–R6',
      lessonIds: ['r.l5', 'r.l6'],
    },
    completion: {
      title: 'all six green — you hold the admission valve of an inference engine.',
      next: 'next: you\u2019ve built allocator → block manager → tokenizer → queue → executor → scheduler. T5.L10 reads the four production stacks; you\u2019ll recognize every moving part.',
    },
    profile: {
      command: 'cargo flamegraph --example calibrate',
      question: 'Across all policies, is the scheduler spending time ranking candidates or simulating the engine around it?',
    },
    checks: [
      { id: 'runs_clean', label: 'legal moves only; light load completes' },
      { id: 'slo_light', label: 'goodput ≥ 95% on light load' },
      { id: 'burst', label: 'burst absorption: goodput ≥ 90%' },
      { id: 'convoy', label: 'convoy: shorts survive the whale (≥ 85 of 89 SLO-met)' },
      { id: 'starvation', label: 'aging: 3 longs complete under an endless short stream' },
      { id: 'goodput_score', label: 'three replay traces clear calibrated goodput floors' },
    ],
    brief: [
      'Every previous lab built a component. This one is the brain: once per iteration you decide who runs, who waits, who gets preempted — and you are graded the way the industry grades: goodput under SLO. A request only counts if it completes with TTFT inside the bound. Raw throughput is not the metric.',
      'The simulator is small but honest: prefill costs prompt/128 iterations, decode appends one token per iteration, memory is resident prompt + decoded against a hard cap — and decode GROWS, so a house that\u2019s full at admission thrashes mid-flight. The engine auto-preempts the newest sequence when that happens (vLLM\u2019s recompute mode). You don\u2019t see output lengths. Production doesn\u2019t either.',
      'The canonical failures remain: burst admission, whale convoy, starvation, and overload. The final score now adds the recorded BurstGPT v2 busiest-hour slice and a response-heavy LMSYS shape built only from published aggregate means (no gated rows are redistributed). The simulator is pub — examples/calibrate.rs races FCFS and SJF, and `--mine` prints your exact three-trace leaderboard score.',
    ],
  },
  {
    id: 'radix-cache',
    index: 7,
    title: 'The Prefix Is the Product',
    hook: 'Automatic prefix caching in Rust: longest-token-prefix lookup, refcounted block sharing, partial-tail CoW, leaf LRU, and a chat-trace hit-rate floor.',
    trackId: 't5',
    lessonId: 't5.l6',
    minutes: 150,
    zip: '/labs/radix-cache.zip',
    artifact: 'target/wasm32-unknown-unknown/release/radix_cache.wasm',
    editFile: 'src/cache.rs',
    readiness: {
      label: 'readiness · R5–R7 + lab 02',
      lessonIds: ['r.l5', 'r.l6', 'r.l7'],
    },
    completion: {
      title: 'all six green — your cache turns repeated context into free prefill.',
      next: 'next: open Fleet cluster mode and watch prefix affinity convert your cache invariant into KV-hit rate and TTFT.',
    },
    profile: {
      command: 'cargo flamegraph --test cache_tests',
      question: 'On the chat replay, does prefix matching dominate, or does eviction and refcount bookkeeping steal the profile?',
    },
    checks: [
      { id: 'exact_match', label: 'exact-match hit returns the full cached block table' },
      { id: 'longest_prefix', label: 'longest cached ancestor wins' },
      { id: 'eviction_order', label: 'leaf LRU respects recency and live pins' },
      { id: 'block_conservation', label: '2000-op churn conserves every physical block' },
      { id: 'cow_divergence', label: 'divergent writer copy-on-writes a shared partial tail' },
      { id: 'chat_hit_rate', label: 'shared-system chat replay clears the KV-hit floor' },
    ],
    brief: [
      'Lab 02 gave every sequence a private block table. This lab builds the cache above it: token-id paths name deterministic KV, the longest cached ancestor skips prefill, and complete prefix blocks become canonical shared state. The harness imports lab 02’s refcounted allocator so you work only on the radix policy.',
      'Insertion receives the temporary block table produced by prefill. Reuse canonical blocks for every complete shared block, retain the table the cache owns, and keep a divergent partial tail private — copy-on-write in cache form. Exact duplicates are touches, not extra entries.',
      'Memory pressure is where the data structure becomes a system. Evict the least-recently-used unpinned terminal leaf; internal prefixes still have descendants, and externally referenced blocks still have live work. The last two checks run 2,000 churn operations and a 240-request system-prompt-heavy replay: conservation and hit rate, not a pretty trie dump, are the production contract.',
    ],
  },
  {
    id: 'xgrammar-lite',
    index: 8,
    title: 'The Token Mask Is the Grammar',
    hook: 'Compile JSON Schema into a pushdown matcher, then mask whole BPE tokens — including tokens that cross several JSON states — with measured cache reuse and overhead.',
    trackId: 't6',
    lessonId: 't6.l8',
    minutes: 180,
    zip: '/labs/xgrammar-lite.zip',
    artifact: 'target/wasm32-unknown-unknown/release/xgrammar_lite.wasm',
    editFile: 'src/grammar.rs',
    readiness: {
      label: 'readiness · R5–R6 + lab 03',
      lessonIds: ['r.l5', 'r.l6'],
    },
    completion: {
      title: 'all six green — your sampler can now make invalid JSON unreachable.',
      next: 'next: T6.L8 connects the matcher to agent tool calls; T6.L9 makes many tenant adapters share the same base-model batch.',
    },
    profile: {
      command: 'cargo test --release mask_overhead -- --nocapture',
      question: 'Does mask time scale with total vocabulary bytes, active pushdown states, or avoidable matcher cloning?',
    },
    checks: [
      { id: 'schema_compile', label: 'JSON Schema lowers to a finite pushdown program' },
      { id: 'valid_acceptance', label: 'valid nested JSON is accepted across token boundaries' },
      { id: 'earliest_rejection', label: 'invalid output rejects at the earliest byte' },
      { id: 'token_mask', label: 'mask validates whole BPE tokens, not first characters' },
      { id: 'mask_overhead', label: '512-token mask stays in the microsecond regime' },
      { id: 'compile_cache', label: 'semantic grammar cache reuses compiled programs' },
    ],
    brief: [
      'Structured generation is not “validate JSON afterward.” The sampler must make every illegal next token impossible. You receive a harness-owned parser for canonical objects, strings and enums, bounded integers, booleans, and bounded arrays. Your file lowers that recursive schema into a pushdown machine and keeps the incremental state needed at every decode step.',
      'Lab 03 matters here: a model token is an arbitrary byte string, not one grammar character. One token can contain `"tool","count":7}` and traverse a string terminal, comma, property name, integer, and closing brace. Conversely, a token can start legally and end in garbage. Check 4 is constructed so a first-character mask fails both ways.',
      'The production seam is latency. Every decode step asks for a vocabulary mask, and agent traffic repeats schemas across requests. The final checks measure a 512-token mask in the native harness and require semantically identical schema source to return the same cached compiled program. XGrammar’s core lesson is the co-design: compile the static language once, keep the dynamic stack tiny, and apply a token mask beside the sampler.',
    ],
  },
]

export const FORGE_LABS: ForgeLab[] = [...RUST_ZERO_LABS, ...SYSTEMS_FORGE_LABS]
