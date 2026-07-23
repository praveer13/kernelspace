import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't1.l3',
  slug: 'toy-allocator',
  trackId: 't1',
  index: 3,
  title: 'How malloc Works: Build a Toy Allocator',
  minutes: 35,
  hook: 'Free lists, splitting, coalescing — the highest-ROI exercise in the course: KV-cache managers are fancy allocators.',
  exercise: 'sim',
  simId: 'sim-allocator',
  blocks: [
    {
      type: 'prose',
      md: `Every heap allocation you have ever made — every Java object, every Python list, every \`malloc\` — was served by a piece of code with exactly the same job description: *given a big slab of memory, hand out variable-size pieces, take them back in any order, and do not waste too much or take too long.* That code is the **allocator**, and in this lesson you will build a working one in about 60 lines of C.

This is the highest-ROI lesson in the course, so be present for it. The allocator you are about to write — a free list with block headers, splitting, and coalescing — is not a toy version of some distant production system. It **is** the production design, miniaturized. glibc's malloc is this plus per-thread caches and size classes. jemalloc is this plus arenas. And the KV-cache manager in vLLM is this with GPU blocks instead of bytes: same split, same coalesce, same fragmentation physics, same policy questions.`,
    },
    {
      type: 'prose',
      md: `## The contract and the slab

\`malloc(n)\` promises: return a pointer to at least \`n\` bytes of usable, suitably aligned memory; \`free(p)\` takes it back. Where does the memory come from? The allocator asks the OS for big slabs up front (historically \`sbrk\`, today \`mmap\`), then **sub-allocates** from them. The kernel deals in pages (4 KB); the allocator deals in bytes. Everything between those two granularities is the allocator's problem.

The core data structure of our design — and of K&R's classic — is the **explicit free list**: every block, used or free, carries a small header recording its size and status; free blocks additionally thread a pointer to the next free block. Allocation walks the list for a fit; freeing puts the block back.`,
    },
    {
      type: 'code',
      filename: 'toymalloc.c — a real allocator in 60 lines',
      lang: 'c',
      code: `#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <sys/mman.h>

#define ARENA (1u << 20)            /* 1 MiB slab from the OS */
#define ALIGN 16                    /* every block 16-byte aligned */

typedef struct Block {
    size_t size;                  /* payload bytes */
    int free;                     /* 1 = free, 0 = in use */
    struct Block *next_free;      /* next free block (valid when free) */
} Block;                          /* header: 16 bytes on x86-64 */

static char arena[ARENA];
static Block *free_list = NULL;

static size_t align16(size_t n) { return (n + 15) & ~(size_t)15; }

void toy_init(void) {             /* start: one big free block */
    free_list = (Block *)arena;
    free_list->size = ARENA - sizeof(Block);
    free_list->free = 1;
    free_list->next_free = NULL;
}

void *toy_malloc(size_t n) {
    size_t want = align16(n);
    Block **prev = &free_list;
    for (Block *b = free_list; b; b = b->next_free) {
        if (b->free && b->size >= want) {
            if (b->size >= want + sizeof(Block) + ALIGN) {
                /* SPLIT: carve a new free block out of the tail */
                Block *rest = (Block *)((char *)(b + 1) + want);
                rest->size = b->size - want - sizeof(Block);
                rest->free = 1;
                rest->next_free = b->next_free;
                b->size = want;
                *prev = rest;
            } else {
                *prev = b->next_free;     /* whole block, no split */
            }
            b->free = 0;
            b->next_free = NULL;
            return (void *)(b + 1);       /* payload starts after header */
        }
        prev = &b->next_free;
    }
    return NULL;                          /* out of memory */
}

void toy_free(void *p) {
    if (!p) return;
    Block *b = ((Block *)p) - 1;          /* header sits just before payload */
    b->free = 1;
    b->next_free = free_list;             /* push onto free list (LIFO) */
    free_list = b;
    /* coalescing (merge with adjacent free blocks) — see fig 1 */
}`,
      highlightLines: [27, 31, 45, 55],
      chips: ['16 B header', 'first-fit', 'split + coalesce', '0 syscalls per alloc'],
    },
    {
      type: 'prose',
      md: `## The two operations that matter

Look past the pointer plumbing; the algorithm is two ideas.

**Splitting.** A free block bigger than the request is divided: the head becomes your allocation, the tail becomes a smaller free block. Without splitting, the first \`malloc(8)\` would consume the entire megabyte. With splitting, big free ranges are gradually whittled down — which creates the next problem.

**Coalescing.** Freeing a block can leave it adjacent to other free blocks: three 16-byte crumbs in a row are useless for a 1 KB request, but *merged* they are fine. Coalescing walks the neighbors and fuses them back into one big block. The classic implementation is the **boundary tag** (Knuth): store the size at both ends of each block so the previous neighbor can be found in O(1). Our toy skipped the prev-pointer for clarity — the simulator shows full coalescing.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — split on alloc, coalesce on free',
      height: 56,
      nodes: [
        { id: 'a', x: 4, y: 8, w: 60, h: 8, label: 'FREE 1 MiB', sub: 'the initial slab' },
        { id: 'b1', x: 4, y: 24, w: 12, h: 8, label: 'used 4 KB', color: '#FB7185' },
        { id: 'b2', x: 18, y: 24, w: 46, h: 8, label: 'FREE ~1 MiB', sub: 'tail after split' },
        { id: 'c1', x: 4, y: 40, w: 12, h: 8, label: 'used 4 KB', color: '#FB7185' },
        { id: 'c2', x: 18, y: 40, w: 8, h: 8, label: 'used 1 KB', color: '#FB7185' },
        { id: 'c3', x: 28, y: 40, w: 6, h: 8, label: 'free', color: '#34D399' },
        { id: 'c4', x: 36, y: 40, w: 5, h: 8, label: 'free', color: '#34D399' },
        { id: 'c5', x: 43, y: 40, w: 21, h: 8, label: 'free (rest)', color: '#34D399' },
      ],
      edges: [
        { from: 'a', to: 'b2', label: 'split' },
        { from: 'c3', to: 'c4', label: 'coalesce' },
      ],
      steps: [
        { caption: 'Startup: the whole slab is ONE free block. free_list = [1 MiB]. Any request fits; the only question is how much to give away.', active: ['a'] },
        { caption: 'malloc(4 KB): first-fit finds the big block and SPLITS it — 4 KB handed out, ~1 MiB tail stays free. Note the 16-byte header charged to every block (internal bookkeeping overhead).', active: ['b1', 'b2'], edges: ['a->b2'] },
        { caption: 'After many alloc/free cycles: the slab is a mosaic of used and free pieces. Two adjacent free crumbs (c3, c4) individually can\'t serve a 4 KB request even though their bytes are contiguous.', active: ['c1', 'c2', 'c3', 'c4', 'c5'] },
        { caption: 'COALESCE: on free, merge with free neighbors into one bigger block. Crumbs become usable ranges again. Skip coalescing and the heap degenerates into gravel — external fragmentation wins.', active: ['c3', 'c4'], edges: ['c3->c4'] },
      ],
    },
    {
      type: 'prose',
      md: `## Placement policy is a research field in one function

Where the toy walks first-fit from the head, production allocators obsess over *which* free block to choose, because the policy steers fragmentation:

- **First fit** — take the first block that fits. Fast; leaves crumbs at the front of the list.
- **Next fit** — resume the search where the last one stopped. Spreads the wear; benchmarks like it.
- **Best fit** — take the smallest sufficient block. Sounds optimal; actually breeds tiny, unusable slivers.
- **Segregated fit (size classes)** — separate free lists per size bucket (8, 16, 24…512 B, then powers of two). This is what jemalloc/tcmalloc/glibc actually do: O(1) lookup, bounded waste, and the direct ancestor of the **slab allocator** and of vLLM's fixed-size KV blocks.

Add the real world's finishing touches and you have glibc malloc: per-thread arenas to avoid lock contention, a fast path for tiny blocks (tcache), \`mmap\` for huge ones, and coalescing at free time. Same skeleton, more engineering.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You have met these policies before, disguised. A **JVM's** copying GC sidesteps the free list entirely by compacting (lesson T0.L5) — allocation stays a pointer bump because reclamation re-creates one huge free range. A **database buffer pool** is segregated fit taken to the extreme: every "block" is exactly one page (8 KB), so fit-search is O(1) and external fragmentation is *impossible*. Hold that thought — it is the entire PagedAttention trick.`,
    },
    {
      type: 'isomorphism',
      title: 'malloc ≡ KV-cache manager',
      pairs: [
        {
          os: 'malloc(n) / free(p)',
          osLine: 'Variable-size blocks from a slab; headers track size; free list for reuse.',
          llm: 'KV block allocation',
          llmLine: 'Fixed-size token blocks from HBM; a block table per sequence; a free-block queue.',
        },
        {
          os: 'split + coalesce',
          osLine: 'Divide big free ranges, merge adjacent ones — fights external fragmentation.',
          llm: 'block append & COW fork',
          llmLine: 'Sequences append blocks as they grow; beam search forks share blocks copy-on-write.',
        },
        {
          os: 'size classes / slab',
          osLine: 'Standard sizes → O(1) fit, bounded internal waste.',
          llm: 'fixed 16-token blocks',
          llmLine: 'Waste capped at <4% — one partly-filled tail block per sequence.',
        },
      ],
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Our toy has the three classic allocator bugs on display: no double-free detection (\`free\` twice → the block enters the list twice → the same memory gets handed out twice → two owners, silent corruption), no overflow guard on \`n\`, and headers sitting one memcpy-overrun away from corruption. Production allocators add canaries, quarantines, and per-thread caches. Rust removes the entire bug class by construction — T3.`,
    },
    {
      type: 'prose',
      md: `## From bytes to blocks

Step back and name what you built: a system that multiplexes a fixed resource among variable, unpredictable consumers, with no central knowledge of future demand. That is not "a data structure problem" — that is *the* resource-management problem, and it recurs at every layer of this course: the OS paging physical RAM (T2), the GPU driver managing HBM (T4), and vLLM managing KV cache (T5). In the simulator you will drive your own allocator through adversarial workload traces — then, in lesson 4, measure exactly how badly it can fragment.`,
    },
    {
      type: 'exercise',
      simId: 'sim-allocator',
      title: 'Toy allocator: split, coalesce, survive the trace',
      tasks: [
        'Run `reset → malloc(64 B) → malloc(16 B)` by hand; predict each split before you step.',
        'Free the middle block of three, then the neighbors; watch coalescing fuse the range.',
        'Replay the deterministic alternating trace for 1,000 ops and inspect the fragmentation sparkline.',
        'Replay that exact trace under first-fit, next-fit, and best-fit; rank their final ratio and failures.',
        'Use the unsafe inspector to double-free a block and watch two owners receive the same address.',
      ],
      note: `What you just operated is the reference design. glibc malloc = this + per-thread arenas + size classes. vLLM's KV manager = this with **one** size class (fixed blocks), which deletes the fit-search and most fragmentation in one move — the lesson T1.L4 and T5.L5 both build on.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'In a free-list allocator, what does "splitting" do?',
          options: [
            'Divides the heap between two threads',
            'Cuts a too-large free block into an allocation plus a smaller free remainder',
            'Splits large allocations across two non-adjacent blocks',
            'Separates the header from the payload',
          ],
          correct: [1],
          explanation:
            'Splitting is what lets one big slab serve many small allocations: carve the request off the head, leave the tail on the free list. Without it the first small malloc would consume the whole arena.',
        },
        {
          q: 'Without coalescing, a long-running heap tends to…',
          options: [
            'Run faster over time',
            'Degenerate into many small non-adjacent free blocks that individually cannot serve larger requests (external fragmentation)',
            'Leak kernel memory',
            'Exhaust virtual address space immediately',
          ],
          correct: [1],
          explanation:
            'Freeing without merging leaves gravel: plenty of total free bytes, no contiguous range big enough. Coalescing (e.g. Knuth boundary tags for O(1) neighbor lookup) re-fuses adjacent free blocks on every free.',
        },
        {
          q: 'Why do jemalloc/tcmalloc/glibc use segregated size classes?',
          options: [
            'To make free() asynchronous',
            'O(1) fit search, bounded internal waste, and drastically reduced fragmentation vs one global free list',
            'To avoid using headers entirely',
            'To allow allocations larger than one page',
          ],
          correct: [1],
          explanation:
            'Per-size free lists turn "find a fit" into a constant-time pop and bound the slack per class. It is the same design move as the kernel\'s slab allocator — and as vLLM\'s decision to make every KV block identical.',
        },
        {
          q: 'A double-free in a free-list allocator is catastrophic because…',
          options: [
            'It always segfaults instantly',
            'The block enters the free list twice, so two future mallocs receive the same memory with two independent owners',
            'It deletes the free list',
            'It triggers an immediate OOM kill',
          ],
          correct: [1],
          explanation:
            'Aliased ownership is silent: both "owners" write through their pointer, corrupting each other\'s data. Modern allocators quarantine frees and check tcache counts; safe languages eliminate the possibility outright.',
        },
        {
          q: 'The strongest structural similarity between your toy allocator and vLLM\'s KV manager is…',
          options: [
            'Both use mmap',
            'A slab is sub-allocated to consumers with unpredictable lifetimes, and a free structure recycles it — vLLM just uses fixed-size blocks',
            'Both run in kernel space',
            'Both require garbage collection',
          ],
          correct: [1],
          explanation:
            'Same multiplexing problem, same recycle loop. vLLM\'s insight was to pick ONE block size (16 tokens by default), turning the fit-search into O(1) and bounding waste to the tail block — fragmentation physics you will quantify next lesson.',
        },
      ],
    },
  ],
}

export default lesson
