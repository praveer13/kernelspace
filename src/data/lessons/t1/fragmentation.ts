import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't1.l4',
  slug: 'fragmentation',
  trackId: 't1',
  index: 4,
  title: 'Fragmentation: Internal vs External',
  minutes: 20,
  hook: 'Why fixed-size blocks win — the physics that foreshadows PagedAttention\'s entire design.',
  exercise: 'sim',
  simId: 'sim-allocator',
  blocks: [
    {
      type: 'prose',
      md: `Your allocator from lesson 3 had a quiet enemy. It never crashes, never leaks a byte you can point at — it just slowly makes memory *unusable*. A heap can report 60% free and still fail a 1 MB allocation, the way a parking lot can have 60 free spaces and nowhere to park a bus. That enemy is **fragmentation**, and it comes in exactly two species. Every memory system you will ever operate — malloc heaps, JVMs, OS page frames, GPU KV caches — chooses its poison between them.

This lesson gives you both species, their measurements, and the one design move that changes the game entirely: **make every block the same size.** That move trades external fragmentation for bounded internal waste, and it is the seed from which PagedAttention grows in T5.`,
    },
    {
      type: 'prose',
      md: `## Internal fragmentation: waste inside the box

**Internal fragmentation** is memory you *allocated* but the customer never uses. Sources: alignment padding (rounding 33 bytes to 48), size-class rounding (a 9 KB request landing in a 16 KB slab), block headers, and fixed-structure slack. The waste is *inside* the allocation — invisible to the free list, unrecoverable until free.

The accounting is easy: \`internal_waste = Σ(given − requested)\`. Size-class allocators bound it by design — with power-of-two classes the worst case is just under 50% (a 5-byte request in an 8-byte slot is fine; a 1025-byte request in a 2048 slot is not), which is why real systems use *denser* classes for small sizes (8, 16, 24, 32, 48, 64…) and sparser ones for large.`,
    },
    {
      type: 'prose',
      md: `## External fragmentation: waste between the boxes

**External fragmentation** is free memory that exists but is *unusable* — scattered in pieces too small or non-contiguous for the next request. It is a property of the *sequence* of allocations and frees, not of any single block. Two traces with identical live bytes can have wildly different largest-allocatable sizes.

The metric that matters is: \`largest_free_block / total_free\`. When that ratio collapses toward zero, your heap is gravel. And here is the uncomfortable theorem: for variable-size allocation with arbitrary lifetimes, **no policy eliminates external fragmentation** — not best fit, not first fit, not anything. Policies only steer how fast it accumulates. (There are classic worst-case results: for any online policy, adversarial traces exist that force waste proportional to the log of the size ratio. The adversary in production is just… your traffic.)`,
    },
    {
      type: 'statline',
      stats: [
        { value: '<4%', label: 'vLLM KV waste', hint: 'Fixed 16-token blocks: waste is the tail block only — the vLLM paper\'s headline number.' },
        { value: '60%+', label: 'pre-vLLM waste', hint: 'Contiguous per-sequence KV reservation: over-booking + fragmentation before PagedAttention.' },
        { value: '~50%', label: 'pow2 worst case', hint: 'Power-of-two size classes bound internal waste below 50% — by construction.' },
        { value: '0', label: 'external frag (fixed)', hint: 'One block size ⇒ any free block fits any request. External fragmentation cannot exist.' },
      ],
    },
    {
      type: 'diagram',
      caption: 'fig 1 — same free bytes, different usability',
      height: 50,
      nodes: [
        { id: 'h1', x: 4, y: 6, w: 14, h: 8, label: 'used', color: '#FB7185' },
        { id: 'h2', x: 20, y: 6, w: 8, h: 8, label: 'free 2K', color: '#34D399' },
        { id: 'h3', x: 30, y: 6, w: 14, h: 8, label: 'used', color: '#FB7185' },
        { id: 'h4', x: 46, y: 6, w: 6, h: 8, label: 'free 1K', color: '#34D399' },
        { id: 'h5', x: 54, y: 6, w: 16, h: 8, label: 'used', color: '#FB7185' },
        { id: 'h6', x: 72, y: 6, w: 10, h: 8, label: 'free 3K', color: '#34D399' },
        { id: 'req', x: 20, y: 22, w: 44, h: 8, label: 'malloc(6K) → FAILS', sub: '6K free, but nowhere contiguous', color: '#FFB224' },
        { id: 'f1', x: 4, y: 38, w: 10, h: 8, label: 'blk', color: '#FB7185' },
        { id: 'f2', x: 16, y: 38, w: 10, h: 8, label: 'free', color: '#34D399' },
        { id: 'f3', x: 28, y: 38, w: 10, h: 8, label: 'blk', color: '#FB7185' },
        { id: 'f4', x: 40, y: 38, w: 10, h: 8, label: 'free', color: '#34D399' },
        { id: 'f5', x: 52, y: 38, w: 10, h: 8, label: 'free', color: '#34D399' },
        { id: 'f6', x: 64, y: 38, w: 10, h: 8, label: 'blk', color: '#FB7185' },
        { id: 'f7', x: 76, y: 38, w: 10, h: 8, label: 'free', color: '#34D399' },
      ],
      edges: [],
      steps: [
        { caption: 'A variable-size heap after a rough trace: 6K free in three holes (2K + 1K + 3K). Plenty free — nothing usable for the next 6K request.', active: ['h2', 'h4', 'h6'] },
        { caption: 'malloc(6K) fails at 30% heap utilization. That is external fragmentation: the waste is BETWEEN the boxes, a property of the trace, not of any block.', active: ['req'] },
        { caption: 'Now the same workload on FIXED-size blocks: any free block fits any request, by definition. External fragmentation is not reduced — it is logically impossible.', active: ['f2', 'f4', 'f5', 'f7'] },
        { caption: 'The cost moved inside the box: the last block of each allocation is partly empty (internal waste). Choose the block size and you choose the bound. This trade IS PagedAttention.', active: ['f1', 'f3'] },
      ],
    },
    {
      type: 'prose',
      md: `## The fixed-block maneuver

So: variable sizes give you external fragmentation you cannot fully control; fixed sizes give you bounded internal waste you *can*. Systems that must run for months without a heap restart almost always move toward fixed or few-size designs:

- **OS page frames** — RAM is managed as 4 KiB frames. Any free frame can back any allocation. External fragmentation of physical memory: zero. Internal: up to one page per mapping. (T2.)
- **Slab/slab-like allocators** — one object size per cache; freeing is O(1); the slab *is* a fixed-block design.
- **Database buffer pools** — everything is an 8 KB page, full stop.
- **vLLM KV blocks** — every block holds the same number of tokens (default 16). A 300-token sequence needs ⌈300/16⌉ = 19 blocks; waste is at most 15 tokens of KV in the tail, under 4% in practice. Before this, engines reserved *contiguous* KV per sequence sized to max length: 60%+ of HBM stranded. The fixed-block maneuver is the entire reason vLLM could serve ~2–4× more requests on the same GPU.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The JVM chose differently and it's instructive: a **compacting** GC periodically *relocates* live objects to crush external fragmentation — compaction is "defrag the heap," paid for with pauses or barriers (ZGC). Relocation is an option only when you own every pointer. C allocators can't move blocks (raw pointers pin them); neither can GPU kernels with device pointers baked in — so those worlds choose fixed blocks instead of compaction. Two escapes from the same trap: **move the data, or standardize the box.**`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Fixed blocks are not a free lunch — they are a *priced* lunch. Internal waste scales with block size; too-large blocks strand memory in tails, too-small blocks multiply metadata (block tables grow; vLLM's 16-token default is a balance, not a proven optimum: the PagedAttention paper's sweep found 16 to 128 tokens best on ShareGPT). And fixed-block systems still fragment at the *next layer up*: an OS with 4 KiB frames fragments huge (2 MiB) pages; vLLM fragments nothing at token level but still schedules whole sequences. Fragmentation is never destroyed — it is relocated to a layer where you can afford it.`,
    },
    {
      type: 'prose',
      md: `## Measuring it in the wild

In the exercise you will run adversarial traces against your toy allocator and watch \`largest_free / total_free\` decay in real time — then flip on fixed-block mode and watch external fragmentation flatline while internal waste ticks up to its bound. When you can predict both curves before running them, you own this lesson — and you have the exact mental model needed for the vLLM paper's §3–§4 later on.`,
    },
    {
      type: 'exercise',
      simId: 'sim-allocator',
      title: 'Fragmentation lab: gravel vs fixed blocks',
      tasks: [
        'Run the alternating-size preset on the variable allocator; plot largest_free/total_free over 1,000 ops.',
        'Run the 5,000-op adversarial preset and identify failures that occur while free bytes remain.',
        'Switch to fixed blocks; rerun and confirm external fragmentation stays structurally zero.',
        'Sweep block size 16 B → 256 B; compare the reported internal waste and metadata overhead to locate the knee.',
      ],
      note: `You have now run the experiment the vLLM authors effectively ran against KV caches: contiguous/variable reservation strands most of the resource; fixed blocks strand a bounded sliver. **Block size is the only knob, and it prices waste against metadata** — remember this when T5 debates 16 vs 32 tokens per block.`,
    },
    {
      type: 'field-note',
      title: 'Efficient Memory Management for Large Language Model Serving with PagedAttention',
      source: 'Kwon et al.',
      href: 'https://arxiv.org/abs/2309.06180',
      published: "SOSP '23",
      verified: '2026-08',
      md: `This is the payoff paper for fragmentation. Ignore the attention equations on the first pass and audit the allocator: variable-length KV grows one token at a time, contiguous reservation strands capacity, fixed blocks cap internal waste, block tables restore a contiguous logical view, and reference counts make fork and copy-on-write cheap. Lab 02 is the paper's memory invariant reduced to one Rust file.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A heap is 60% free, but a 1 MB allocation fails. This is…',
          options: [
            'Internal fragmentation, wasted space hidden inside blocks that are already allocated to callers',
            'External fragmentation: free memory is scattered in pieces too small for the request',
            'A memory leak, where unreachable blocks were never returned to the allocator',
            'Heap corruption, where overwritten block headers make the allocator ignore large free blocks',
          ],
          correct: [1],
          explanation:
            'The free bytes exist but not as one contiguous range. External fragmentation is a property of the alloc/free trace; the metric to watch is largest_free_block / total_free.',
          why: [
            'Mixes up the two kinds. Internal waste sits inside blocks that are in use, so it cannot show up as free memory; here the free bytes exist but are scattered.',
            'Right: 60% free in total, but no single contiguous range reaches 1 MB. The metric to track is largest_free_block divided by total_free.',
            'A leak means memory is held but unreachable, which would show as less free memory, not more. Here the free space is real and reusable, just fragmented.',
            'Nothing here suggests damaged metadata. A healthy allocator with intact headers fails the same way when the free ranges are too small and scattered.',
          ],
        },
        {
          q: 'Rounding a 33-byte request up to a 48-byte block is an example of…',
          options: [
            'External fragmentation, since the 15 leftover bytes can never be reused by any other caller',
            'Internal fragmentation: bytes allocated but unused inside the block',
            'Coalescing, because the allocator merged the request with a neighboring free block',
            'Splitting, because the allocator carved a 48-byte block out of a larger free one',
          ],
          correct: [1],
          explanation:
            'The waste lives inside the allocation itself: alignment and size-class rounding. It is bounded by design (power-of-two classes cap it under 50%) and recovered only on free.',
          why: [
            'Reverses the definition. External fragmentation is free space outside any allocation; these 15 bytes belong to an allocated block, so they are internal.',
            'Right: the 15 spare bytes are part of the allocation, unusable by anyone else until it is freed. Alignment and size-class rounding create exactly this.',
            'Coalescing merges adjacent free blocks on free. Nothing is freed or merged here; the request is simply rounded up when the block is chosen.',
            'Splitting may happen to produce the block, but it divides a free block. The 15 wasted bytes come from rounding, which is a separate effect.',
          ],
        },
        {
          q: 'Why do fixed-size-block designs eliminate external fragmentation?',
          options: [
            'They eliminate external holes by coalescing more aggressively on every free, so adjacent holes never persist',
            'They compact live block contents periodically, as ZGC does, to squeeze the holes out',
            'Every free block is identical, so any free block satisfies any request',
            'They place each block in sorted order, so free blocks always end up adjacent',
          ],
          correct: [2],
          explanation:
            'External fragmentation requires heterogeneity: holes that don\'t fit requests. One block size makes every hole exactly the right shape. The waste is moved inside blocks as bounded internal fragmentation.',
          why: [
            'Merging is not the mechanism. Fixed blocks need no merging at all, because a free block is always the right size for the next request.',
            'Fixed-block systems never move data. PagedAttention blocks stay put and a block table points to them; compaction is the managed-runtime route, not this one.',
            'Right: with one block size, every hole is exactly the right shape. Free blocks can be scattered anywhere and still be fully usable, so no unusable space forms.',
            'Placement order is not what matters. Blocks are freed in any order and stay scattered, yet each free block still serves any request.',
          ],
        },
        {
          q: 'Why can\'t a C allocator fix external fragmentation by compacting like a JVM GC?',
          options: [
            'Compaction by a JVM-style collector requires a JIT-compiled runtime with profiling data, and the C allocator is compiled ahead of time',
            'Moving a block means updating every pointer to it, which the allocator cannot find in C code',
            'A C heap is typically too large to copy without stalling the whole process for seconds',
            'The OS forbids moving heap memory once the allocator has handed it out to a running program',
          ],
          correct: [1],
          explanation:
            'Relocation needs ownership of all references. GCs have it (they trace roots); malloc sees only untyped addresses. Two escapes from fragmentation: move the data (managed runtimes) or standardize the box (fixed blocks).',
          why: [
            'Blames the compilation model. A GC can compact in an ahead-of-time compiled runtime too; what matters is knowing where every reference is, not how code was compiled.',
            'Right: a copy is only safe if every pointer to it is rewritten. GCs trace their roots and know them all; malloc sees only untyped addresses scattered through user code.',
            'Size is not the obstacle. Compacting collectors copy heaps of many gigabytes; the barrier for C is that it cannot find and fix the pointers, not copy cost.',
            'The OS does not restrict this. A process can memcpy its own heap memory freely; the trouble is that nobody can update the program\'s pointers to the old address.',
          ],
        },
        {
          q: 'vLLM\'s reported <4% KV-cache waste comes primarily from…',
          options: [
            'Compressing the KV tensors to FP8, which halves the bytes each token needs for its keys and values',
            'Fixed-size token blocks, so waste is only the partly filled tail block of each sequence',
            'Evicting idle sequences to CPU RAM, which frees the GPU blocks stranded by waiting requests',
            'Sharing one copy of the model weights across all concurrent requests',
          ],
          correct: [1],
          explanation:
            'The vLLM paper\'s headline: paging KV into fixed blocks caps waste at the tail (≤ block_size−1 tokens per sequence) — versus 60%+ stranded by contiguous max-length reservation before PagedAttention.',
          why: [
            'Quantization shrinks bytes per token but not the reserved-but-unused share. A contiguous max-length reservation wastes the same fraction whatever the precision.',
            'Right: blocks are allocated on demand, so the only unused space is the unfilled tail block, at most block_size minus 1 tokens per sequence.',
            'Offloading is a different technique that frees memory under pressure. It does not change how much of an active sequence\'s reservation sits unused.',
            'Weights are already shared across requests and live outside the KV cache, so sharing them has no effect on how much KV memory is wasted.',
          ],
        },
      ],
    },
  ],
}

export default lesson
