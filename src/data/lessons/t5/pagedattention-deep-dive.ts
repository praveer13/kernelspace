import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l5',
  slug: 'pagedattention-deep-dive',
  trackId: 't5',
  index: 5,
  title: 'PagedAttention Deep Dive',
  minutes: 25,
  hook: 'Block tables, copy-on-write prefix sharing, near-zero waste — inside the memory manager that made vLLM famous.',
  exercise: 'sim',
  simId: 'sim-kv',
  blocks: [
    {
      type: 'prose',
      md: `You passed the T2 exam, so you already *recognize* PagedAttention. This lesson is the owner's manual: the actual data structures, the allocation lifecycle of a sequence, how prefix caching falls out of refcounted blocks, what the CUDA kernel pays for indirection, and where the design's limits are. T2.L7 taught you *that* it's paging; T5.L5 teaches you *how* — enough to read vLLM's \`block_manager\` source without a guide.`,
    },
    {
      type: 'prose',
      md: `## The data structures, concretely

The block manager splits GPU KV memory into fixed-size **blocks** — default 16 tokens per block. Using T5.L4's 8B model (128 KB/token… wait, per-block bytes = 16 × 128 KB = 2 MB per block), a pool of N blocks is the entire serving capacity. Two structures run the show:

- **The free-block queue** — exactly your T1.L3 free list, minus the fit search (all blocks identical): \`alloc()\` pops, \`free()\` pushes, O(1), no fragmentation between blocks ever.
- **Per-sequence block tables** — a growable array of physical block ids: logical block \`i\` (tokens \`16i..16i+15\`) lives in physical block \`table[i]\`. The attention kernel translates per block as it reads — the MMU walk, one level deep.

Blocks also carry a **refcount** for sharing. When refcount hits zero, the block returns to the free queue. That refcount is the entire machinery behind the features that made vLLM a product.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — two sequences sharing a prompt prefix, block by block',
      height: 54,
      nodes: [
        { id: 'seqA', x: 2, y: 6, w: 24, h: 9, label: 'seq A block table', sub: '[7, 3, 12, 9]' },
        { id: 'seqB', x: 2, y: 20, w: 24, h: 9, label: 'seq B block table', sub: '[7, 3, 12, 21]' },
        { id: 'b7', x: 38, y: 2, w: 18, h: 8, label: 'block 7', sub: 'ref=2 · prompt', color: '#22D3EE' },
        { id: 'b3', x: 38, y: 13, w: 18, h: 8, label: 'block 3', sub: 'ref=2 · prompt', color: '#22D3EE' },
        { id: 'b12', x: 38, y: 24, w: 18, h: 8, label: 'block 12', sub: 'ref=2 · prompt', color: '#22D3EE' },
        { id: 'b9', x: 38, y: 35, w: 18, h: 8, label: 'block 9', sub: 'ref=1 · A only', color: '#FB7185' },
        { id: 'b21', x: 38, y: 46, w: 18, h: 8, label: 'block 21', sub: 'ref=1 · B only', color: '#FB7185' },
        { id: 'free', x: 70, y: 20, w: 24, h: 12, label: 'free queue', sub: '[1,2,4,5,6,8,…]', color: '#3EF2A4' },
      ],
      edges: [
        { from: 'seqA', to: 'b7' },
        { from: 'seqB', to: 'b7' },
        { from: 'seqA', to: 'b9' },
        { from: 'seqB', to: 'b21' },
        { from: 'b9', to: 'free' },
      ],
      steps: [
        { caption: 'Both sequences begin with the same 48-token prompt: three full blocks. Instead of two copies, the manager maps BOTH tables to the same physical blocks with refcount=2. Memory for the prefix: paid once.', active: ['seqA', 'seqB', 'b7', 'b3', 'b12'], edges: ['seqA->b7', 'seqB->b7'] },
        { caption: 'Generations diverge. A\'s next tokens land in a fresh block 9 (ref=1); B\'s in block 21. Sharing costs nothing until someone WRITES a shared block…', active: ['b9', 'b21'], edges: ['seqA->b9', 'seqB->b21'] },
        { caption: '…e.g. beam search forks INSIDE a full block: the writer triggers copy-on-write — allocate a new block, copy 16 tokens of KV, update the table, decrement the source refcount. The fork() trick from T2.L2, per block.', active: ['b12'] },
        { caption: 'Sequence A finishes: decrement all its blocks\' refcounts; ref=0 blocks rejoin the free queue in O(1). No compaction, no fragmentation — the T1.L4 fixed-block maneuver, live in production.', active: ['free'], edges: ['b9->free'] },
      ],
    },
    {
      type: 'prose',
      md: `## The allocation lifecycle, end to end

Watch one request through the manager:

1. **Prefill:** prompt token count \`p\` → need \`⌈p/16⌉\` blocks. The scheduler admits only if the free queue can cover it (admission control, T2.L4 — otherwise the request waits). A cached prefix (below) may make most of those blocks *already mapped*: refcount bumps instead of allocations.
2. **Decode:** each new token appends to the tail block. Every 16th token, the tail fills: allocate one fresh block, append its id to the table. Amortized allocation cost per token: ~zero — this is why fixed blocks beat per-token bookkeeping.
3. **Finish/preempt:** decrement refcounts along the table; zero-ref blocks return to the free queue. Preemption (T2.L3) swaps the blocks to CPU RAM or drops them for recompute; the block table makes either operation a metadata update, not a memory defrag.

**Prefix caching** is then almost free as a feature: hash the *token blocks* of common prefixes; a hit maps the cached physical blocks into the new sequence's table with refcount+1. Your 2k-token system prompt is stored once and shared by every request — a 100× memory multiplier at 100 concurrent users, from the same refcount byte.`,
    },
    {
      type: 'code',
      filename: 'block_manager.py — the manager in 40 lines (simplified vLLM)',
      lang: 'python',
      code: `BLOCK = 16                      # tokens per block (vLLM default)

class BlockManager:
    def __init__(self, num_blocks: int):
        self.free: list[int] = list(range(num_blocks))
        self.refcount = [0] * num_blocks
        self.cache: dict[bytes, int] = {}   # token-block hash -> phys block

    def alloc(self) -> int:
        if not self.free:
            raise OutOfBlocks              # → scheduler preempts (swap/recompute)
        b = self.free.pop()
        self.refcount[b] = 1
        return b

    def share(self, b: int) -> int:         # prefix hit / beam fork
        self.refcount[b] += 1
        return b

    def free_block(self, b: int) -> None:
        self.refcount[b] -= 1
        if self.refcount[b] == 0:
            self.cache = {k: v for k, v in self.cache.items() if v != b}
            self.free.append(b)             # O(1), no fragmentation, ever

    def append_token(self, table: list[int], pos: int) -> None:
        if pos % BLOCK == 0:                # tail full → one new block
            table.append(self.alloc())
        # else: write into table[-1] at slot pos % BLOCK — zero bookkeeping`,
      chips: ['16-token blocks', 'O(1) alloc/free', 'refcounted sharing'],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is your **copy-on-write filesystem** — ZFS/Btrfs share *blocks* across snapshots with refcounts, diverge on write, and never defrag because extents are fixed-size. It's also your **Java string dedup / shared immutable DTOs** with reference counting, and your **Redis maxmemory** with a perfect free list. The vLLM authors' genius was recognizing that the KV cache is a *storage workload* — and reaching for fifty years of storage-engineering answers.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `The design has real edges. **Block size is a trade:** 16 tokens balances internal waste (bigger blocks → fatter tails) against metadata and kernel efficiency (smaller blocks → longer tables, more translation overhead per token). **Sharing is token-block granular:** a one-token shift in the prefix misaligns every block and shares nothing (the T5.L2 tokenizer footgun returns). **And the free queue is the capacity truth:** dashboards that track "GPU memory %" instead of *free blocks* lie to you during traffic spikes.`,
    },
    {
      type: 'prose',
      md: `## What the indirection costs — and buys

The PagedAttention kernel reads K/V through the block table: per block, one extra table lookup and a non-contiguous gather. Measured overhead: a few percent on attention time — and attention is a minority of decode time (the MLP dominates, T5.L1). What it buys, from the paper and every deployment since: waste from 60–80% → **<4%**, batch sizes 2–4× larger on the same GPU, prefix sharing as a free side effect, and preemption as a metadata operation. In the simulator you'll operate the manager itself: allocate, share, fork with COW, preempt, and watch the free-block count — the single most instructive dial in LLM serving.`,
    },
    {
      type: 'exercise',
      simId: 'sim-kv',
      title: 'Block-table explorer',
      tasks: [
        'Run two requests sharing a 48-token prompt: verify prefix blocks show refcount=2 and memory is paid once.',
        'Fork a beam inside a full block: watch the COW allocate one block and copy 16 tokens of KV.',
        'Drive the free queue to zero: trigger preemption — compare swap-to-CPU vs recompute on TTFT.',
        'Sweep block size 4 → 64: plot tail waste vs table overhead; locate why 16 is the default.',
      ],
      note: `You have now operated the exact machinery from the SOSP paper: free list (T1), paging (T2.L2), COW sharing (T2.L2), eviction/preemption (T2.L3), admission control (T2.L4) — one Python class\'s worth of logic that doubled the industry\'s effective GPU capacity.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Prefix caching in vLLM is implemented as…',
          options: [
            'A separate CPU-side memcached tier',
            'Hashing token blocks and mapping the cached physical blocks into the new sequence\'s block table with refcount+1 — one copy, shared by all',
            'Recomputing the prompt at FP8',
            'Concatenating the prompts into one sequence',
          ],
          correct: [1],
          explanation:
            'Refcounted block sharing makes prefix caching nearly free: no copy, no special path — the same COW machinery as beam forks. This is why "the block table" is the whole design.',
        },
        {
          q: 'The block size (default 16 tokens) trades off…',
          options: [
            'Model quality vs speed',
            'Internal waste in the tail block (bigger = more) against table length and kernel translation overhead (smaller = more)',
            'GPU count vs PCIe bandwidth',
            'Vocabulary size vs context length',
          ],
          correct: [1],
          explanation:
            'The classic fixed-block pricing from T1.L4: waste lives in the tail, metadata lives in the table. 16 is the measured sweet spot — and the T1.L4 simulator predicted it.',
        },
        {
          q: 'When the free-block queue empties during decode, vLLM…',
          options: [
            'Crashes with OOM',
            'Preempts victim sequences — swap their blocks to CPU RAM or drop them for recompute — then admits/resumes by priority',
            'Pauses all generation permanently',
            'Allocates from the CPU transparently at full speed',
          ],
          correct: [1],
          explanation:
            'Admission control + eviction, T2.L3 verbatim. The block table makes preemption a metadata operation; swap vs recompute mirrors anonymous vs file-backed pages.',
        },
        {
          q: 'The PagedAttention kernel\'s block-table indirection is affordable because…',
          options: [
            'GPUs ignore indirection',
            'The few-percent attention overhead is dwarfed by the 2–4× batch-size gain from reclaiming 60–80% wasted KV memory — and attention is a minority of decode time anyway',
            'The block table fits in registers',
            'Indirection is removed at compile time',
          ],
          correct: [1],
          explanation:
            'The MLP dominates decode FLOPs, and memory capacity was the binding constraint. A few percent of kernel time for double-digit capacity gains is the best trade in the field since the MMU.',
        },
      ],
    },
  ],
}

export default lesson
