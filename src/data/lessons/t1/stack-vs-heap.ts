import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't1.l1',
  slug: 'stack-vs-heap',
  trackId: 't1',
  index: 1,
  title: 'Stack vs Heap: Anatomy of a Function Call',
  minutes: 20,
  hook: 'Stack frames, calling conventions, drawn live — what a function call really is, byte by byte.',
  exercise: 'sim',
  simId: 'sim-memory',
  blocks: [
    {
      type: 'prose',
      md: `You have called functions a million times. Here is what actually happens, at the level of registers and bytes: the caller places arguments in agreed-upon registers, executes a \`call\` instruction that **pushes the return address onto the stack**, and jumps. The callee pushes the old frame pointer, moves the stack pointer down to reserve space for locals, does its work, restores everything, and executes \`ret\` — which pops the return address and jumps back. That entire ceremony typically costs **2–5 nanoseconds**. No allocation, no bookkeeping, no runtime. Just a pointer sliding down and back up.

This lesson draws that ceremony live. By the end you will be able to sketch any call's memory layout from cold, and — more importantly for a serving engineer — you will understand why "stack vs heap" is really a question about *who owns the bytes and for how long*.`,
    },
    {
      type: 'prose',
      md: `## The stack: memory with a discipline

The call stack is a contiguous region of memory (typically 1–8 MB per thread, set at thread creation) plus one register, the **stack pointer** (\`rsp\` on x86-64). "Allocating" on the stack means subtracting from that pointer. "Freeing" means adding back. That is the entire allocator: **one instruction, zero fragmentation, perfect cache warmth** — the last few KB of stack are almost always resident in L1.

The price for this perfection is a strict contract: **last in, first out.** Memory dies in exactly the reverse order it was born. That is perfect for function calls — a callee cannot outlive its caller — and useless for anything that must escape: return a pointer to a local and you have built a time bomb. The compiler will not stop you in C. (In Rust it physically cannot happen — T3's borrow checker is, at heart, a compile-time proof that nothing outlives its stack frame.)`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — main() calls add(): one frame slides down, then back',
      height: 56,
      nodes: [
        { id: 'high', x: 6, y: 3, w: 34, h: 7, label: 'high addresses', sub: 'stack bottom (main)' },
        { id: 'main', x: 6, y: 13, w: 34, h: 9, label: "main's frame", sub: 'locals · saved regs' },
        { id: 'ret', x: 6, y: 24, w: 34, h: 7, label: 'return address', sub: 'pushed by call' },
        { id: 'add', x: 6, y: 33, w: 34, h: 9, label: "add's frame", sub: 'args spilled · locals' },
        { id: 'rsp', x: 6, y: 44, w: 34, h: 7, label: 'rsp →', sub: 'stack pointer (grows down)' },
        { id: 'regs', x: 52, y: 13, w: 20, h: 12, label: 'registers', sub: 'rdi, rsi = args' },
        { id: 'heap', x: 52, y: 33, w: 20, h: 12, label: 'heap', sub: 'malloc country', color: '#FFB224' },
        { id: 'code', x: 80, y: 13, w: 17, h: 12, label: '.text', sub: 'instructions' },
      ],
      edges: [
        { from: 'main', to: 'ret', label: 'call' },
        { from: 'ret', to: 'add' },
        { from: 'add', to: 'rsp' },
      ],
      steps: [
        { caption: 'main is running; rsp points just below its frame. Arguments go into registers rdi/rsi per the System V ABI — the "calling convention" both sides compiled against.', active: ['main', 'regs'] },
        { caption: 'The call instruction pushes the return address (the next instruction after the call site) and jumps to add. One push, one jump — that is the whole "function call" so far.', active: ['ret'], edges: ['main->ret'] },
        { caption: 'add sets up its frame: saves the old frame pointer, moves rsp down to reserve locals. Allocation cost: one subtract. No free list, no header, no GC — ever.', active: ['add', 'rsp'], edges: ['ret->add', 'add->rsp'] },
        { caption: 'ret pops the return address and jumps back. add\'s frame is instantly "gone" — not zeroed, just abandoned below rsp, ready to be overwritten by the next call.', active: ['main'], edges: [] },
        { caption: 'Meanwhile the heap is a separate region where lifetimes are manual (C) or owned (Rust) — bytes that may outlive any frame, at the price of real allocation machinery. Next two lessons.', active: ['heap'] },
      ],
    },
    {
      type: 'code',
      filename: 'frame.c — one call, annotated',
      tabs: [
        {
          label: 'C',
          lang: 'c',
          code: `long add(long a, long b) {      // args arrive in rdi, rsi
    long c = a + b;             // 'c' lives at [rsp+0] — 8 bytes, 1 subtract
    return c;                   // result leaves in rax; ret pops return addr
}

int main(void) {
    long x = add(40, 2);        // call: push rip, jmp add  (~2–5 ns total)
    return (int)x;
}`,
        },
        {
          label: 'Java',
          lang: 'java',
          code: `// The JVM has the same two worlds, renamed:
//  - each thread gets a JVM stack of frames (locals + operand stack)
//  - objects live on the GC heap, ALWAYS (you cannot stack-allocate)
long add(long a, long b) {       // 'a','b','c' are stack slots — primitives
    long c = a + b;
    return c;
}
// Long c = a + b;  ← boxed: heap object, header + pointer, GC-tracked.
// That one character is the difference between 0 and 2 allocations.`,
        },
        {
          label: 'Python',
          lang: 'python',
          code: `def add(a, b):
    c = a + b          # c is a NAME bound to a heap PyLong object.
    return c           # The frame is also a heap object in CPython!
# CPython allocates a PyFrameObject per call — one reason Python
# function calls cost ~100 ns vs C's ~2 ns. (3.11+ fixed much of this
# with lightweight frames. The heap tax is real and measurable.)`,
        },
      ],
      chips: ['System V ABI', '1 subtract = alloc', 'frame = LIFO only'],
    },
    {
      type: 'prose',
      md: `## The heap: memory without a curfew

Anything that must outlive its creator — a request object passed between stages, a connection's read buffer, a tokenizer's vocab — goes to the **heap**: a big region where blocks are allocated and freed *in any order*. That freedom is the entire point, and the entire cost. Now someone must track which ranges are free, find a good one fast, split it if it is too big, merge it back when neighbors free up, and not lose track even when a program runs for months. That someone is the **allocator**, and building one is lesson 3 of this track.

The stack/heap split also explains three errors every C programmer meets:

- **Stack overflow** — recursion deeper than the 1–8 MB region; the stack pointer walks off the end into a guard page and the OS kills you (the namesake of the website).
- **Use-after-return** — returning \`&local\`: the memory is silently reused by the next call. UB, heisenbugs, CVEs.
- **Memory leak** — heap block freed never; RSS climbs until the OOM killer picks you.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `If the stack is a **stack of plates** — last on, first off, zero search — the heap is a **parking garage**: any car, any slot, any duration, and someone has to run the ledger of free spaces. JVM note: the JIT's escape analysis sometimes *stack-allocates* Java objects that provably don't escape a method — proof that the stack/heap distinction is about lifetimes, not languages.`,
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'COMMON MISCONCEPTION',
      md: `"Stack allocation is fast because the stack is special hardware." No — it's the same DRAM. It's fast because the allocator is one instruction and the top of stack is already in L1 cache. The speed comes from the *discipline* (LIFO), not the silicon. Any allocator that can guarantee LIFO gets the same speed — see arena allocators, T1.L3.`,
    },
    {
      type: 'prose',
      md: `## Why a serving engineer cares

Decode loops are frame-shy for a reason: the hot path of an inference engine pre-allocates everything — KV blocks, sampling buffers, token queues — precisely so the per-token loop never hits a general allocator. And when vLLM needs per-sequence metadata, it reaches for block tables (fixed layout, trivially allocatable) rather than per-token bookkeeping. Stack discipline, applied to GPU memory: allocate like the stack when you can, manage like the heap when you must, and never confuse the two. The exercise below lets you grow frames, blow the stack, and watch the guard page fire — safely.`,
    },
    {
      type: 'exercise',
      simId: 'sim-memory',
      title: 'Frame visualizer: grow, call, return, overflow',
      tasks: [
        'Step through \`main → add → add\` and watch rsp slide; note each frame\'s exact byte layout.',
        'Return a pointer to a local, then make another call — watch the "dangling" bytes get overwritten.',
        'Recursion depth 1,000,000: find the guard page and read the SIGSEGV the kernel sends.',
        'Compare the same call in the heap view: what would malloc have cost for the same 8 bytes?',
      ],
      note: `Three takeaways: (1) a call is ~2–5 ns of pointer arithmetic, (2) "freed" stack memory is not erased — it is *reused*, which is why dangling pointers to locals corrupt the next call, (3) the guard page is the OS (T2) turning your overflow into a clean segfault instead of silent corruption.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Allocating 64 bytes of stack space for locals costs, on x86-64…',
          options: [
            'A call into the OS kernel',
            'One subtract instruction on the stack pointer (~1 cycle)',
            'A search of the free list',
            'A page fault if the stack is cold',
          ],
          correct: [1],
          explanation:
            'The stack allocator is literally `sub rsp, 64`. No bookkeeping, no headers, no fragmentation — the price is strict LIFO discipline. (Cold-stack page faults exist but are a one-time cost per new page.)',
        },
        {
          q: 'The `call` instruction on x86-64 does exactly two things:',
          options: [
            'Saves all registers, then jumps',
            'Pushes the return address onto the stack, then jumps to the target',
            'Allocates a stack frame, then jumps',
            'Switches to kernel mode, then jumps',
          ],
          correct: [1],
          explanation:
            'call = push rip + jmp. Frame setup (saving rbp, moving rsp) is done by the callee prologue per the ABI — and modern compilers often skip the frame pointer entirely.',
        },
        {
          q: 'Returning the address of a local variable is catastrophic because…',
          options: [
            'Locals live in read-only memory',
            'The stack memory is zeroed on return, corrupting the data',
            'The memory is instantly reused by subsequent calls — the pointer aliases unrelated future frames',
            'The compiler always rejects it at build time',
          ],
          correct: [2],
          explanation:
            'Nothing is zeroed; the region below rsp is simply fair game for the next call. The returned pointer then reads/writes whatever frame lands there next — the classic use-after-return bug that Rust\'s borrow checker makes unrepresentable.',
        },
        {
          q: 'A JVM thread stack and the GC heap differ fundamentally in that…',
          options: [
            'The stack holds primitives and references; objects always live on the heap (modulo JIT escape analysis)',
            'The heap is per-thread while the stack is shared',
            'Stack memory is never cached',
            'The heap uses LIFO discipline',
          ],
          correct: [0],
          explanation:
            'Java frames hold primitives and object references; the objects themselves are heap-allocated and GC-tracked. Escape analysis occasionally scalar-replaces a non-escaping object — the exception that proves the lifetime rule.',
        },
      ],
    },
  ],
}

export default lesson
