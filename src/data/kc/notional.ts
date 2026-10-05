/**
 * Notional-machine cards (docs/specs/wave-1.md §4.8; PLAN-100X V4; Fincher et al. 2020).
 *
 * One per Wave 1 track: the simplified machine a learner should be able to run in their head, its
 * rules, and what it deliberately leaves out. Track.tsx renders the card above the lesson list
 * (task B25) and ⌘K indexes it (B24). Each card has 3-6 rules and 2-4 ignores (verify-kc).
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
]
