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
        },
        {
          os: 'NULL dereference → SIGSEGV',
          osLine: 'Unmapped address, MMU page fault, kernel kills the process.',
          llm: 'invalid block id → CUDA fault',
          llmLine: 'A corrupt block table faults on-device; the serving process dies just as dead.',
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
      title: 'Memory grid: dereference, arithmetic, segfault',
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
          options: ['0x1003', '0x100C', '0x1018', 'It depends on the OS'],
          correct: [2],
          explanation:
            'Pointer arithmetic scales by the pointee size: 3 × 8 bytes = 24 = 0x18. This single rule is how array indexing, struct walking, and KV-block addressing all work.',
        },
        {
          q: 'Dereferencing NULL crashes your process because…',
          options: [
            'The C runtime checks every pointer against NULL',
            'Address 0 is left unmapped by the OS; the MMU page-faults and the kernel delivers SIGSEGV',
            'The CPU has a special NULL-detection register',
            'The compiler inserts a null check before every load',
          ],
          correct: [1],
          explanation:
            'No language-level check happens. The first page is deliberately unmapped, so the hardware faults and the OS kills the process. A segfault is a kernel verdict about an address-space violation.',
        },
        {
          q: 'Why is reading one element past an array more dangerous than crashing?',
          options: [
            'It isn\'t — it always crashes immediately',
            'The memory is often mapped and stale, so the program continues with silently corrupted data',
            'It always corrupts the heap allocator immediately',
            'The TLB caches the fault',
          ],
          correct: [1],
          explanation:
            'Undefined behavior\'s worst case is not the crash — it is the plausible garbage. Adjacent stack/heap bytes are usually mapped, so you read stale data and keep going. ASan exists to convert this into an immediate, loud failure.',
        },
        {
          q: 'Java references differ from C pointers in all of the following EXCEPT:',
          options: [
            'References forbid arithmetic',
            'References are automatically dereferenced',
            'References are guaranteed non-null by the type system',
            'References are managed addresses the runtime can relocate (compaction)',
          ],
          correct: [2],
          explanation:
            'Java references can absolutely be null — NPE is the polite segfault, checked by the runtime instead of the MMU. What you lose vs C is arithmetic and control; what you keep is the concept: a managed address.',
        },
      ],
    },
  ],
}

export default lesson
