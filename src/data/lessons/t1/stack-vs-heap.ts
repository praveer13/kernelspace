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
- **Memory leak** — heap block never freed; RSS climbs until the OOM killer picks you.`,
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
      machine: 'frames',
      title: 'Frame visualizer: grow, call, return, overflow',
      tasks: [
        'Step through `main → add → add` and watch rsp slide; note each frame\'s exact byte layout.',
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
            'A system call into the kernel, growing the process\'s stack mapping',
            'One subtract instruction on the stack pointer, about a cycle',
            'A search of the free list, looking for a block that is large enough',
            'A page fault on each call, with lazily mapped pages of the stack',
          ],
          correct: [1],
          explanation:
            'The stack allocator is literally `sub rsp, 64`. No bookkeeping, no headers, no fragmentation — the price is strict LIFO discipline. (Cold-stack page faults exist but are a one-time cost per new page.)',
          why: [
            'Treats stack growth as a syscall. The stack is already mapped, and the kernel only steps in when a new page is touched for the first time.',
            'Right: the frame is made by `sub rsp, 64`. There are no headers or searches, and the price is that frees must happen in strict LIFO order.',
            'Describes the heap. The stack has no free list or fit search; locals are placed by moving one register.',
            'Lazy mapping means a fault only on first touch of a new page, once. Reused stack pages are already resident, so ordinary calls take no fault.',
          ],
        },
        {
          q: 'The `call` instruction on x86-64 does exactly two things:',
          options: [
            'Saves the general-purpose registers to the stack, then jumps to the target',
            'Pushes the return address onto the stack, then jumps to the target',
            'Allocates the callee\'s stack frame for locals, then jumps to the target',
            'Switches to kernel mode for the setup, then jumps to the target',
          ],
          correct: [1],
          explanation:
            'call = push rip + jmp. Frame setup (saving rbp, moving rsp) is done by the callee prologue per the ABI — and modern compilers often skip the frame pointer entirely.',
          why: [
            'Saving registers is a software convention. The ABI splits it between caller and callee, and the call instruction itself saves only the return address.',
            'Right: call pushes the address of the next instruction, then jumps. ret later pops it back into rip.',
            'Frame setup belongs to the callee prologue, which subtracts from rsp and may save rbp. The call instruction itself does neither.',
            'An ordinary call stays in user mode. Entering the kernel takes a separate instruction such as syscall, which is far more expensive.',
          ],
        },
        {
          q: 'Returning the address of a local variable is catastrophic because…',
          options: [
            'Locals live in write-protected memory, with any write through the pointer faulting',
            'The stack frame is zeroed on return, with the pointer reading back as zeros',
            'The memory gets reused by later calls, with the pointer aliasing another frame',
            'Restoring the stack pointer unmaps the old frame, with any later access trapping',
          ],
          correct: [2],
          explanation:
            'Nothing is zeroed; the region below rsp is simply fair game for the next call. The returned pointer then reads/writes whatever frame lands there next — the classic use-after-return bug that Rust\'s borrow checker makes unrepresentable.',
          why: [
            'Locals sit in ordinary writable stack memory. Writes through the dangling pointer succeed, which is exactly why the bug stays silent.',
            'Nothing clears the frame on return; the bytes stay until overwritten. Reading may even look right at first, which makes the bug harder to notice.',
            'Right: the region below rsp is free for the next call, so the pointer ends up reading and writing some unrelated later frame.',
            'The CPU does not track frames. Moving rsp changes no page permissions, so the old addresses stay mapped and accessible with no fault.',
          ],
        },
        {
          q: 'A JVM thread stack and the GC heap differ fundamentally in that…',
          options: [
            'Frames hold primitives and references, with the objects themselves living on the heap',
            'The heap is private to each thread, with the stack shared by the threads of the process',
            'Stack memory bypasses the caches, making it slower to access than the heap',
            'The heap is managed last-in first-out, with objects freed in reverse allocation order',
          ],
          correct: [0],
          explanation:
            'Java frames hold primitives and object references; the objects themselves are heap-allocated and GC-tracked. Escape analysis occasionally scalar-replaces a non-escaping object — the exception that proves the lifetime rule.',
          why: [
            'Right: a frame holds primitives and references, while the objects they point to are heap-allocated and GC-tracked. Escape analysis can scalar-replace an object that never escapes.',
            'Backwards. Each thread has its own stack, and the heap is shared across threads, which is why heap objects need synchronization.',
            'Stack memory goes through the CPU caches like any other, and it is usually the hottest memory in the program, so it is not slower.',
            'LIFO is the stack\'s discipline. The GC heap frees objects in any order, whenever they become unreachable.',
          ],
        },
      ],
    },
  ],
}

export default lesson
