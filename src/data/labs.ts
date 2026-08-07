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
  /** shown on the all-green completion panel */
  completion: { title: string; next: string }
  brief: string[]
}

export const FORGE_LABS: ForgeLab[] = [
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
    completion: {
      title: 'all six green — you built a real allocator.',
      next: 'next: T2.L7 reads the actual vLLM paper — you now know why its block manager coalesces.',
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
    completion: {
      title: 'all six green — you built PagedAttention\u2019s memory manager.',
      next: 'next: T5.L6\u2019s continuous batcher decides who gets your blocks and when — the scheduler above your manager.',
    },
    checks: [
      { id: 'paging', label: 'block-table math and translation' },
      { id: 'capacity', label: 'pool exhaustion is atomic; freed blocks return' },
      { id: 'fork_shares', label: 'fork shares blocks via refcounts (zero-copy)' },
      { id: 'cow', label: 'copy-on-write on append to shared tail' },
      { id: 'free_refcount', label: 'refcounted free — shared blocks survive until the last owner' },
      { id: 'gauntlet', label: '2000-op churn: block conservation after every op' },
    ],
    brief: [
      'Lab 01 was malloc. This is the page table on top of it — the exact system from T5.L5. You get a fixed pool of physical KV blocks; sequences see a private, contiguous view through a block table; fork() shares everything via refcounts; appending to a shared tail block triggers copy-on-write. Every idea is 1979 virtual memory, reincarnated for HBM.',
      'The semantics are vLLM v0\u2019s BlockManager: fork copies the table and bumps refcounts (beam search and parallel sampling do this thousands of times per second); a shared block is read-only; frees return a block only when its last owner dies. The discipline that separates prototypes from production: every fallible operation is all-or-nothing — a half-applied allocation is how engines corrupt themselves mid-request.',
      'The gauntlet is the teacher: 2000 mixed allocate/append/fork/free ops, checking block conservation — free + referenced = total — after every single op. Underflow a refcount and blocks leak until the pool starves. Double-free and conservation breaks instantly. This is the bug class that takes down serving fleets at 3 AM, caught in a browser tab.',
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
    completion: {
      title: 'all six green — you built the tokenizer front door.',
      next: 'next: production tokenizers are this algorithm + a Rust core for speed — HF tokenizers is exactly that, and T5.L2\u2019s toy Python just became real.',
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
    completion: {
      title: 'all six green — and the race fuzzer has nothing on you.',
      next: 'next: this ring is the intake of every scheduler — T5.L6\u2019s continuous batcher pops from exactly this shape, and lab 06 puts yours there.',
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
    lessonId: 't3.l5',
    minutes: 120,
    zip: '/labs/toy-executor.zip',
    artifact: 'target/wasm32-unknown-unknown/release/toy_executor.wasm',
    editFile: 'src/executor.rs',
    completion: {
      title: 'all six green — you built the state machine under async.',
      next: 'next: T3.L4\u2019s tokio is this executor × work-stealing × epoll — and the checks\u2019 ping-pong waker pattern is every reactor you will ever read.',
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
    hook: 'The admission policy for a continuous-batching engine, graded on goodput under SLO across four deterministic traffic scenarios — burst, whale convoy, starvation stream, and a 400-request fleet trace.',
    trackId: 't5',
    lessonId: 't5.l6',
    minutes: 150,
    zip: '/labs/batching-scheduler.zip',
    artifact: 'target/wasm32-unknown-unknown/release/batching_scheduler.wasm',
    editFile: 'src/scheduler.rs',
    completion: {
      title: 'all six green — you hold the admission valve of an inference engine.',
      next: 'next: you\u2019ve built allocator → block manager → tokenizer → queue → executor → scheduler. T5.L9 reads the four production stacks; you\u2019ll recognize every moving part.',
    },
    checks: [
      { id: 'runs_clean', label: 'legal moves only; light load completes' },
      { id: 'slo_light', label: 'goodput ≥ 95% on light load' },
      { id: 'burst', label: 'burst absorption: goodput ≥ 90%' },
      { id: 'convoy', label: 'convoy: shorts survive the whale (≥ 85 of 89 SLO-met)' },
      { id: 'starvation', label: 'aging: 3 longs complete under an endless short stream' },
      { id: 'goodput_score', label: 'fleet trace: goodput ≥ 55% of 400 requests' },
    ],
    brief: [
      'Every previous lab built a component. This one is the brain: once per iteration you decide who runs, who waits, who gets preempted — and you are graded the way the industry grades: goodput under SLO. A request only counts if it completes with TTFT inside the bound. Raw throughput is not the metric.',
      'The simulator is small but honest: prefill costs prompt/128 iterations, decode appends one token per iteration, memory is resident prompt + decoded against a hard cap — and decode GROWS, so a house that\u2019s full at admission thrashes mid-flight. The engine auto-preempts the newest sequence when that happens (vLLM\u2019s recompute mode). You don\u2019t see output lengths. Production doesn\u2019t either.',
      'The four scenarios are the four canonical failures: a 48-request burst (admission control), an 8192-token whale landing with 88 shorts (the convoy — plain FCFS meets 54 of 89 SLOs), three longs inside an endless short stream (pure smallest-first starves them — aging is the fix), and a 400-request fleet trace at 1.2× offered load where goodput IS the policy (FCFS 10%, the reference shape 62.5%). The simulator is pub — examples/calibrate.rs lets you race FCFS and SJF baselines against your own.',
    ],
  },
]
