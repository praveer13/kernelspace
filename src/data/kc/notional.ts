/**
 * Notional-machine cards (docs/specs/wave-1.md §4.8; PLAN-100X V4; Fincher et al. 2020).
 *
 * One per track (R and T0-T2 in Wave 1; T3-T7 in wave-2.md §4.3, task 2a-11): the simplified machine a
 * learner should be able to run in their head, its rules, and what it deliberately leaves out. Each
 * machine hands the next one what it ignores (T4 leaves links to T5 and T6, T5 leaves parallelism to T6).
 * Track.tsx renders the card above the lesson list (task B25). Each card has 3-6 rules and 2-4 ignores
 * (verify-kc).
 */

import type { NotionalMachine } from '@/lib/kc/types'

export const NOTIONAL_MACHINES: readonly NotionalMachine[] = [
  {
    track: 'r',
    title: 'The ownership machine',
    rules: [
      'Every value has exactly one owner, a binding; when the owner goes out of scope the value is dropped, exactly once.',
      'Assigning or passing a value moves ownership and retires the old binding, unless the type is Copy and is duplicated instead.',
      'A value may be borrowed by many shared references (&T) or by one mutable reference (&mut T) at a time, never both.',
      'No reference may outlive the value it points to; lifetimes are the names the compiler gives those spans.',
      'Shared ownership (Rc, Arc) and mutation through a shared reference (Cell, RefCell, Mutex) are library types that move these checks to run time.',
    ],
    ignores: [
      'How the compiler proves the rules: the machine states what is allowed, not how the borrow checker searches.',
      'unsafe code and raw pointers, which step outside the rules on the author\'s word.',
      'Where values live in memory: the stack and the heap belong to the T1 machine.',
    ],
  },
  {
    track: 't0',
    title: 'The memory-hierarchy machine',
    rules: [
      'Memory is one long array of bytes, but the CPU moves it in 64-byte cache lines, never a byte at a time.',
      'Every access asks the nearest cache first; a miss falls to the next level, bigger and slower, down to DRAM about a hundred times slower than L1.',
      'A fetched line stays until something evicts it, so bytes near or recently used are nearly free to touch again.',
      'A steady stride lets the prefetcher fetch lines before you ask; a random or huge stride pays the full trip every time.',
      'Two cores writing the same line take turns owning it, even when they write different bytes.',
    ],
    ignores: [
      'Virtual addresses and the TLB: every address here is already physical (the T2 machine adds translation).',
      'Out-of-order execution, branch prediction and SIMD: the machine performs one access at a time.',
      'Exact cache sizes, associativity and replacement policy.',
    ],
  },
  {
    track: 't1',
    title: 'Bytes, frames and a heap',
    rules: [
      'Memory is numbered bytes; a pointer is an address, and adding 1 to a typed pointer advances by the size of its type.',
      'Each call pushes a frame (return address, saved registers, locals) and each return pops it: last in, first out.',
      'Anything that must outlive its frame lives on the heap, which an allocator carves from a slab and tracks with a free list.',
      'malloc splits a free block to fit a request; free returns the block and coalesces it with free neighbours.',
      'Nothing checks a pointer before use: a stale or out-of-range address reads whatever bytes live there now, unless its page is unmapped and the CPU faults.',
    ],
    ignores: [
      'Virtual memory: addresses are treated as mapped and physical (the T2 machine adds the page table).',
      'Threads: one stack and one heap user, so there are no races.',
      'Registers and compiler optimisation: every local lives in its frame.',
    ],
  },
  {
    track: 't2',
    title: 'The OS machine',
    rules: [
      'A process is an address space plus one or more threads; its threads share the heap and each owns a stack and registers.',
      'Every address a program uses is virtual: the MMU translates it page by page through a page table, and the TLB caches recent translations.',
      'Touching a page that is not mapped traps to the kernel, which maps it in, copies it for a copy-on-write write, or kills the process for an illegal access.',
      'When physical frames run out, an eviction policy picks a victim to write back or drop; a working set larger than memory thrashes.',
      'A scheduler gives each core to one runnable thread for a time slice; a switch saves one thread\'s registers and loads another\'s.',
      'Admission control decides which work may enter at all, so overload waits in a queue instead of thrashing.',
    ],
    ignores: [
      'Interrupts, device drivers and the file system.',
      'NUMA, huge pages and multi-socket effects.',
      'The cache and TLB damage of a switch is counted as a cost, not simulated.',
    ],
  },
  {
    track: 't3',
    title: 'The Rust runtime',
    rules: [
      'A program runs as OS threads, and each thread may run many async tasks; a task is a future that an executor polls until it is Ready.',
      'A value may move to another thread only if its type is Send, and be shared by reference across threads only if it is Sync; the compiler derives both from the type\'s parts.',
      'State shared across threads lives behind Arc, and mutation behind a Mutex, an atomic or a channel; Rc and RefCell stay on one thread.',
      'Polling runs a future until it finishes or must wait; to wait it returns Pending and leaves a waker with whatever will make progress.',
      'A wake puts the task back on the executor\'s run queue; a task that nothing wakes is never polled again.',
      'Code that blocks its thread inside a task stalls every task on that thread, so blocking work gets a thread of its own.',
    ],
    ignores: [
      'How the compiler lays out a future\'s state machine, and pinning beyond "a polled future must not move".',
      'Work stealing, timers and the I/O reactor of a production runtime: this executor is one queue.',
      'Memory ordering inside locks and atomics, which the R and T2 machines cover.',
    ],
  },
  {
    track: 't4',
    title: 'The GPU',
    rules: [
      'A GPU is dozens of streaming multiprocessors (SMs); each runs warps of 32 threads that execute one instruction together.',
      'An SM keeps many warps resident and issues from whichever is ready, so other warps\' work hides memory latency, not a deep cache.',
      'Memory is a ladder: registers and shared memory inside each SM, an L2 shared by every SM, then HBM, each tier bigger and slower than the last.',
      'A warp\'s 32 loads merge into a few transactions when they touch neighbouring addresses; scattered addresses pay a transaction each.',
      'A kernel runs under the lower of two roofs: peak FLOP/s, or HBM bandwidth times its arithmetic intensity (FLOPs per byte moved).',
      'Reusing data from the fast tiers (tiling) raises arithmetic intensity, the only way off the bandwidth roof.',
    ],
    ignores: [
      'Clock speeds and power limits: peak FLOP/s and bandwidth are fixed numbers.',
      'How the warp scheduler chooses among ready warps, and instruction latencies beyond "memory is slow".',
      'Links between GPUs: there is one GPU here (the T5 and T6 machines add NVLink and the network).',
    ],
  },
  {
    track: 't5',
    title: 'The serving engine',
    rules: [
      'A request arrives as text; the tokenizer turns it into token ids, and every later cost is counted in tokens.',
      'Each iteration the scheduler builds the batch: running requests that need one more token, plus waiting ones it can admit.',
      'Admission asks the block manager for KV blocks, the prompt\'s now and headroom for decode; when blocks run out a request waits or is preempted.',
      'The block manager maps each request\'s tokens to fixed-size KV blocks through a block table, and shares a cached prefix\'s blocks by refcount.',
      'One model step runs prefill for new prompts and one decode token for every running request, reading the weights once for the whole batch.',
      'The detokenizer streams each new token back; a request that finishes frees its blocks before the next iteration.',
    ],
    ignores: [
      'The arithmetic inside the model step: attention and the MLP are one box with a cost, priced by the T4 machine.',
      'More than one GPU: the engine is one replica on one device until the T6 machine splits it.',
      'Sampling: the next token simply appears.',
    ],
  },
  {
    track: 't6',
    title: 'The fleet of GPUs',
    rules: [
      'A model too big or too busy for one GPU is split along axes: tensor (inside a layer), pipeline (across layers), expert, context (along the sequence) and data (whole replicas).',
      'Each axis brings its own traffic: tensor parallelism all-reduces every layer, expert parallelism sends tokens to their experts and back, data parallelism sends nothing while serving.',
      'Links form a ladder, HBM inside a GPU, NVLink inside a domain, the network between nodes, each much slower than the last; the chattiest axis gets the fastest link.',
      'In an MoE layer a router sends each token to a few experts, and the layer ends when the busiest expert\'s GPU does, so balance sets the pace.',
      'Each GPU holds its shard of the weights plus the KV cache of its requests; what is left after the weights decides the batch.',
      'Phases can run on separate fleets (encode, prefill, decode), joined by KV transfers the network must carry.',
    ],
    ignores: [
      'How collectives are implemented: an all-reduce or all-to-all costs its bytes over the slowest link it crosses.',
      'Failures and stragglers other than expert imbalance, which the T7 machine and the incidents take on.',
      'Training: the weights stay fixed, except when an RL trainer pushes a new version.',
    ],
  },
  {
    track: 't7',
    title: 'The business',
    rules: [
      'Only requests that meet the SLO count: goodput is SLO-meeting work per second, and the rest is cost without revenue.',
      'Cost is GPU-hours: dollars per million tokens is the GPUs\' hourly price divided by the good tokens they deliver in that hour.',
      'A deployment has a frontier of operating points trading tok/s per GPU against tok/s per user; batch size slides along it, while hardware, precision and algorithms move it.',
      'The SLO picks the operating point: the most tok/s per GPU whose tok/s per user still meets it.',
      'Load changes faster than capacity arrives, so a fleet keeps headroom and a planner scales on leading signals such as queue age.',
      'When capacity cannot arrive in time, the fleet queues, sheds or degrades on purpose rather than missing every SLO at once.',
    ],
    ignores: [
      'Price negotiation, reserved-capacity discounts and contracts: a GPU-hour has one price.',
      'Revenue beyond price times tokens: no product value, churn or competition.',
      'Facility costs: power and depreciation are folded into the hourly price, and power appears only as a cap on the fleet.',
    ],
  },
]
