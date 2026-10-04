import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't1.l2',
  slug: 'pointers',
  trackId: 't1',
  index: 2,
  title: 'Pointers & Manual Memory',
  minutes: 25,
  hook: 'The memory-grid visualizer: dereference, address arithmetic, and cause a real segfault — safely.',
  exercise: 'sim',
  simId: 'sim-memory',
  blocks: [
    {
      type: 'prose',
      md: `A pointer is a number. Not a magic reference, not an object — an integer that names a byte in memory. On a 64-bit machine it is a 64-bit integer, and \`0x7ffc_9a3e_41b0\` means "the byte at this address." Everything else — arrays, strings, structs, objects, vtables, closures, the \`this\` you use daily — is a convention built on that one idea. Languages differ only in whether they let you *see* the number.

C shows you everything, including the ways to hurt yourself. This lesson puts you in front of a live memory grid: you will dereference, do pointer arithmetic, walk past the end of an array, and finally dereference \`NULL\` to watch the segfault happen in a sandbox. The goal is not to make you a C programmer; it is to make "address" a physical object in your imagination, because every allocator, page table, and KV-cache block table from here on is pointer arithmetic with better PR.`,
    },
    {
      type: 'prose',
      md: `## The four operations — that's all of it

Everything you can do with a pointer is one of four operations:

1. **Take an address**: \`&x\` — "where does x live?" Produces a pointer.
2. **Dereference**: \`*p\` — "go to that address and read/write what's there." Consumes a pointer.
3. **Arithmetic**: \`p + i\` — advance by \`i * sizeof(*p)\` bytes. This is how arrays work: \`a[i]\` is *defined* as \`*(a + i)\`.
4. **Compare**: equality, ordering. (Mostly for sentinel checks like \`p == NULL\`.)

That third one deserves a pause. In C, \`p + 1\` does not add 1 to the address — it adds **the size of the pointed-to type**. A \`double *\` advances 8 bytes; a \`struct Request *\` advances 32. Array indexing, struct field access, and iteration are all this one rule wearing different clothes. When T5 says "KV cache block 17 starts at offset \`17 × block_size\`," you will recognize the exact same arithmetic.`,
    },
    {
      type: 'code',
      filename: 'pointers.c — the whole language feature in 20 lines',
      lang: 'c',
      code: `#include <stdio.h>

int main(void) {
    long vals[4] = {10, 20, 30, 40};   // 32 contiguous bytes on the stack
    long *p = &vals[0];                // p holds vals' address (an integer!)

    printf("%ld\\n", *p);              // 10  — dereference: read the pointee
    printf("%ld\\n", *(p + 2));        // 30  — +2 means +2 * sizeof(long) = +16 B
    printf("%ld\\n", p[3]);            // 40  — p[i] is *defined as* *(p + i)

    long *q = p + 4;                   // one past the end: legal to FORM…
    // printf("%ld\\n", *q);           // …illegal to READ. Undefined behavior.

    p = NULL;                          // the sentinel: address 0, unmapped
    // *p = 5;                         // SIGSEGV — the kernel kills the process
    return 0;
}`,
      highlightLines: [9, 13, 16],
      chips: ['& takes address', '* dereferences', 'a[i] ≡ *(a+i)', 'NULL = 0x0'],
    },
    {
      type: 'prose',
      md: `## The segfault, demystified forever

When you dereference \`NULL\` — address zero — nothing "in C" happens at all. Your program faithfully executes a load from address 0. It is the **operating system** that objects: the first page of every process's address space is deliberately left **unmapped**, so the MMU (memory management unit) raises a page fault, the kernel inspects it, decides there is no legitimate mapping, and delivers **SIGSEGV**. "Segmentation fault (core dumped)" is a *kernel message about a memory-mapping violation*, not a language error. You will see the full machinery — page tables, the MMU, fault handling — in T2. For now, keep the causal chain: **bad address → MMU fault → kernel → signal → death.**

The same mechanism, mapped to different outcomes, also powers: guard pages that catch stack overflow, \`mmap\` lazily committing memory, copy-on-write after \`fork()\`, and — no surprise — the fault-and-retry patterns inside GPU memory managers. Segfaults are not the enemy of systems programming. They are its smoke detector.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Java and Python give you pointers with the dangerous bits filed off: a **reference** is a pointer the runtime owns. It dereferences automatically, forbids arithmetic, and guarantees non-null-or-NPE. The JVM even uses **compressed oops** — 32-bit pointers on a 64-bit heap — to save cache space, which tells you how much pointer *traffic* matters. When you got a NullPointerException, you were segfaulting politely: same null address, but the runtime checks instead of the MMU.`,
    },
    {
      type: 'callout',
      variant: 'segfault',
      title: 'COMMON MISCONCEPTION',
      md: `"Undefined behavior means it might crash." Worse: it might *work* — today, on this compiler, at -O0 — and corrupt data silently at -O2 next quarter. Reading past an array often returns plausible garbage because the memory is mapped and stale. The segfault is the *lucky* outcome; silent corruption is the expensive one. Sanitizers (ASan) exist to make the unlucky case loud.`,
    },
    {
      type: 'isomorphism',
      title: 'pointers all the way down',
      pairs: [
        {
          os: 'pointer + offset arithmetic',
          osLine: 'a[i] ≡ *(a+i): address = base + index × size. Hardware-checked by the MMU.',
          llm: 'KV block table entry',
          llmLine: 'token t\'s KV lives at block_table[t/B] + (t%B) × stride — same arithmetic, GPU side.',
          breaks: 'A pointer add stays inside one flat address range, but the block table adds a lookup so neighboring tokens in different blocks are not adjacent, and the table index itself has no check at all, not even page-level protection.',
        },
        {
          os: 'NULL dereference → SIGSEGV',
          osLine: 'Unmapped address, MMU page fault, kernel kills the process.',
          llm: 'invalid block id → CUDA fault',
          llmLine: 'A corrupt block table faults on-device; the serving process dies just as dead.',
          breaks: 'NULL is deterministically unmapped, but a stale or off-by-one block id can still land inside the preallocated KV pool and silently read another sequence\'s data instead of faulting.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## Manual memory: the ownership question

Once you can address memory, someone must answer: **whose job is it to free this, and how do we know it's safe?** C's answer is "the programmer remembers" — the source of roughly 70% of serious CVEs (Microsoft and Google's own numbers, from their C/C++ codebases). The garbage collector's answer is "the runtime tracks reachability." Rust's answer — you will meet it properly at the end of this track — is "the compiler proves, at build time, that every allocation has exactly one owner and dies exactly once."

Notice that all three answers address the *same* question. Manual memory management is not about \`free()\`; it is about **lifetimes**. And in LLM serving, the most expensive lifetime question of all is: *which sequence's KV cache may be reused, and when?* Keep your pointer fingers warmed up in the simulator; the allocator lesson is next.`,
    },
    {
      type: 'exercise',
      simId: 'sim-memory',
      machine: 'pointer',
      title: 'Pointer lab: arithmetic, indirection, and faults',
      tasks: [
        'Allocate `long vals[4]` on the grid; read `*(p+2)` and confirm it lands exactly 16 bytes along.',
        'Build a two-level pointer (`long **pp`) and follow both hops on the grid.',
        'Walk one element past the array; inspect the stale bytes you read (mapped ≠ valid).',
        'Dereference `NULL` and read the fault path: MMU → kernel → SIGSEGV → core dumped.',
      ],
      note: `The grid makes the key point visible: memory is a flat array of bytes, and a pointer is just an index into it. The two-hop chase (pp → p → value) is exactly how page tables and block tables work — one indirection resolving to another. And the NULL crash was the *hardware* catching you: the OS left page 0 unmapped precisely so that mistake is loud instead of silent.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'If `double *p` holds address 0x1000, what address does `p + 3` hold?',
          options: ['0x1003', '0x100C', '0x1018', '0x10C0'],
          correct: [2],
          explanation:
            'Pointer arithmetic scales by the pointee size: 3 × 8 bytes = 24 = 0x18. This single rule is how array indexing, struct walking, and KV-block addressing all work.',
          why: [
            'Adds 3 raw bytes, ignoring the pointee type. C scales pointer arithmetic by sizeof(*p), so p + 3 skips three whole doubles, not three bytes.',
            'Scales by 4 bytes, as for an int or float: 3 × 4 = 12 = 0xC. A double is 8 bytes, so the offset is larger.',
            'Right: p + 3 advances three elements of 8 bytes each, so 3 × 8 = 24 = 0x18, giving 0x1018.',
            'Scales by 64 as if a double were 64 bits: 3 × 64 = 192 = 0xC0. The scale factor is in bytes, and a 64-bit double is 8 bytes.',
          ],
        },
        {
          q: 'Dereferencing NULL crashes your process because…',
          options: [
            'The C runtime tracks live pointers and aborts when a NULL one is used',
            'Address 0 is left unmapped by the OS; the MMU faults and the kernel delivers SIGSEGV',
            'The CPU reserves address 0 in hardware and traps on any access to it',
            'The compiler inserts a null check before every load and aborts the process when it fails',
          ],
          correct: [1],
          explanation:
            'No language-level check happens. The first page is deliberately unmapped, so the hardware faults and the OS kills the process. A segfault is a kernel verdict about an address-space violation.',
          why: [
            'No such runtime bookkeeping exists. libc does not track pointers, and C performs no check when you dereference; the fault happens in hardware.',
            'Right: the OS leaves the first page unmapped, so the MMU cannot translate address 0 and raises a page fault. The kernel turns it into SIGSEGV.',
            'The CPU has no special rule for address 0. It faults only because the page is not mapped; on some embedded systems address 0 is valid memory.',
            'C compilers emit no implicit null checks. Sanitizers such as UBSan can add them on request, but a normal build just emits the load.',
          ],
        },
        {
          q: 'Why is reading one element past an array more dangerous than crashing?',
          options: [
            'It is not more dangerous; C checks every array bound, so reading past the end always crashes at once',
            'Neighboring memory is usually mapped, so the program keeps running on silently wrong data',
            'The read always damages the allocator metadata, so the whole heap is corrupted at that moment',
            'The TLB caches the failed lookup, so later accesses to that address keep faulting',
          ],
          correct: [1],
          explanation:
            'Undefined behavior\'s worst case is not the crash — it is the plausible garbage. Adjacent stack/heap bytes are usually mapped, so you read stale data and keep going. ASan exists to convert this into an immediate, loud failure.',
          why: [
            'Assumes bounds violations are always detected. C has no bounds check; the MMU faults only when a whole page is unmapped, which one element past the end rarely is.',
            'Right: neighboring bytes sit in a mapped page, so the read succeeds with stale or unrelated data. No signal fires, and the program carries on with wrong values.',
            'Mixes up reads and writes. A read does not modify anything, so it cannot damage allocator metadata; corruption comes from writing past the end.',
            'Wrong about the TLB. It caches successful translations, and the adjacent address usually has one already, so there is no fault to cache.',
          ],
        },
        {
          q: 'Which statement is true of both a Java reference and a C pointer?',
          options: [
            'It supports arithmetic, so adding an offset reaches the neighboring object',
            'It is dereferenced implicitly, with no explicit dereference operator needed',
            'It can be null, and using it that way fails at run time (NPE or SIGSEGV)',
            'It holds a fixed address, because the target never moves while the program runs',
          ],
          correct: [2],
          explanation:
            'Java references can absolutely be null — NPE is the polite segfault, checked by the runtime instead of the MMU. What you lose vs C is arithmetic and control; what you keep is the concept: a managed address.',
          why: [
            'True only for C. Java forbids arithmetic on references, which is part of what makes them safe and lets the runtime track every object.',
            'True only for Java. C needs an explicit * or -> to dereference a pointer; Java applies the dereference automatically on field access.',
            'Right: both can hold null, and using one fails loudly. Java throws NullPointerException from a runtime check; C faults in the MMU and raises SIGSEGV.',
            'True only for C. A compacting JVM collector may move objects and rewrite references, which it can do because references are managed addresses.',
          ],
        },
      ],
    },
  ],
}

export default lesson
