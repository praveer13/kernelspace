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
  kcs: ['t1.pointers', 't1.memory-errors'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Walk through what happens, from the CPU to the process dying, when C code dereferences NULL.',
        model:
          'The CPU issues a load from address 0. The first page of the address space is deliberately left unmapped, so the MMU cannot translate it and raises a page fault. The kernel finds no valid mapping and sends the process SIGSEGV, which kills it. C itself performed no check.',
        ideas: [
          'Address 0 lies in a page the OS left unmapped on purpose',
          'The MMU faults and the kernel finds no valid mapping',
          'The kernel delivers SIGSEGV, and C added no check of its own',
        ],
        kcs: ['t1.memory-errors'],
      },
      {
        prompt: 'For `long *p` at the start of an array, explain what `p + 2` and `p[2]` mean and how they relate.',
        model:
          '`p + 2` is the address two elements along: p plus 2 times sizeof(long), which is 16 bytes. `p[2]` is defined as `*(p + 2)`, the value stored at that address. Pointer arithmetic scales by the pointee size, so stepping and indexing are one rule.',
        ideas: [
          'p + 2 adds 2 times sizeof(long), 16 bytes and not 2 bytes',
          'p[2] is defined as *(p + 2), the value at that address',
          'One scaling rule underlies both indexing and stepping',
        ],
        kcs: ['t1.pointers'],
      },
    ],
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'In C, what does `p[3]` mean for any pointer `p`?',
          options: [
            'A bounds-checked read of the fourth element, failing if the array ends',
            'The address of the fourth element, a pointer and not the value stored there',
            'The value stored three elements past the one p points to, read from memory',
            'A call to a library routine that looks the index up in a table of slots',
          ],
          correct: [2],
          why: [
            'C does no bounds check on indexing. Reading past the end is undefined behavior, not an error the language reports.',
            'That describes p + 3. The brackets also dereference, so p[3] is the value at that address and not the address itself.',
            'Right: p[i] is defined as *(p + i). The index is scaled by the element size, and the result is the value stored there.',
            'Indexing is plain arithmetic plus a load. No library routine or table is involved, and the compiler emits the address math inline.',
          ],
          revealAt: 'The four operations — that\'s all of it',
          kcs: ['t1.pointers'],
        },
        {
          kind: 'choice',
          q: 'A C program dereferences NULL. Which component first notices the problem?',
          options: [
            'The memory-management hardware, which has no mapping to translate address zero',
            'The C compiler, which inserted a check on the pointer before each load of memory',
            'The C library, which keeps a table of every pointer that is still valid',
            'The linker, which reserved address zero as unusable when it laid out the program',
          ],
          correct: [0],
          why: [
            'Right: the OS leaves the first page unmapped, so the MMU cannot translate address zero and raises a fault for the kernel to handle.',
            'Normal builds emit a bare load with no inserted check. Sanitizers can add checks on request, but they are not the default.',
            'The C library does not track pointers. It has no table of valid addresses, so it cannot see the bad load coming.',
            'The linker lays out sections but does not guard address zero. The protection comes from an unmapped page, set up by the OS.',
          ],
          revealAt: 'The segfault, demystified forever',
          kcs: ['t1.memory-errors'],
        },
      ],
    },
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
          kcs: ['t1.pointers'],
        },
        {
          q: 'Dereferencing NULL crashes your process because…',
          options: [
            'The C runtime tracks live pointers, aborting when a NULL pointer is used at address 0',
            'Address 0 is left unmapped by the OS, with the MMU faulting and the kernel delivering SIGSEGV',
            'The CPU reserves address 0 in hardware, trapping on any access to it',
            'The compiler inserts a NULL check before each load, aborting the process when address 0 is hit',
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
          kcs: ['t1.memory-errors'],
        },
        {
          q: 'Why is reading one element past an array more dangerous than crashing?',
          options: [
            'It is not more dangerous, with C checking each array bound and the OS ending the program at once',
            'Neighboring memory is usually mapped by the OS, leaving the program running on silently wrong data',
            'The read damages the allocator\'s metadata, corrupting the heap that the OS handed out to the program',
            'The TLB caches the failed lookup, leaving later accesses to that address faulting',
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
          kcs: ['t1.memory-errors'],
        },
        {
          q: 'Which statement is true of both a Java reference and a C pointer?',
          options: [
            'It supports arithmetic, with an added offset reaching the neighboring object in RAM',
            'It is dereferenced implicitly, with no dereference operator needed on field access in the JVM',
            'It can be null, with use of a null value failing at run time as an NPE or SIGSEGV',
            'It holds a fixed address, with the target staying put under the OS for the program\'s lifetime',
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
          kcs: ['t1.pointers', 't1.memory-errors'],
        },
      ],
    },
  ],
}

export default lesson
