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
  kcs: ['t5.block-tables', 't5.block-refcounts', 't5.kv-copy-on-write'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'A sequence has 100 tokens and the block size is 16. How many blocks does it hold, how much of the last block is empty, and how is token 37 found?',
        model:
          '100 tokens need ceil(100 / 16) = 7 blocks. The last holds 4 tokens, so 12 slots are empty. Token 37 is logical block 2 (37 / 16) at offset 5 (37 mod 16). The block table maps logical block 2 to a physical block id, and the kernel reads that block at offset 5.',
        ideas: [
          'Seven blocks, with 12 empty slots in the last one',
          'Token 37 is logical block 2, offset 5',
          'The block table maps the logical block to a physical block id',
        ],
        kcs: ['t5.block-tables'],
      },
      {
        prompt: 'Two sequences share a block. Explain what copy-on-write does when one of them appends a token to it, and why it must not write in place.',
        model:
          'A shared block has refcount 2 and is read-only. Writing in place would change tokens the other sequence still reads. So the writer allocates a new block, copies the existing KV into it, appends to the copy, updates its own table and drops one reference on the original. Fork itself copies nothing.',
        ideas: [
          'A block with refcount above 1 is read-only',
          'The writer allocates a new block, copies the KV and appends to the copy',
          'Fork copies nothing; the copy happens on the first write',
        ],
        kcs: ['t5.kv-copy-on-write', 't5.block-refcounts'],
      },
    ],
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'choice',
          q: 'Two requests start with the same 48-token system prompt, and the block size is 16 tokens. How does a paged KV manager store that shared prefix?',
          options: [
            'Twice, once per request, since each sequence needs memory of its own to append into safely',
            'Once, in three blocks that both block tables point at, since the keys and values are identical',
            'Once, in one contiguous region, since the manager places both requests next to the shared prompt',
            'Once, in a single block of 48 tokens, since a block grows to fit whatever prefix is shared',
          ],
          correct: [1],
          why: [
            'Appending goes into each sequence\'s own tail blocks. The prefix blocks are identical and read-only, so there is nothing to protect by copying them.',
            'Right: 48 tokens fill three 16-token blocks, and both block tables map to the same physical blocks with refcount 2. The prefix is paid for once.',
            'Paging exists so that sequences need no contiguous placement. A block table can point anywhere in the pool, so nothing has to sit next to anything.',
            'Blocks have a fixed size, 16 tokens by default. A longer prefix takes more blocks; it never makes a block bigger.',
          ],
          revealAt: 'The data structures, concretely',
          kcs: ['t5.block-tables'],
        },
        {
          kind: 'choice',
          q: 'A block shared by two sequences has refcount 2. One of the sequences finishes and releases its blocks. What happens to that shared block?',
          options: [
            'It returns to the free queue at once, since the finished sequence listed it in its table',
            'It stays out of the free queue, since one owner still holds it and the count has dropped by one',
            'It stays reserved for good, since a block that was ever shared is kept for the prefix cache',
            'It returns to the free queue after a timer, since shared blocks are reclaimed at fixed intervals',
          ],
          correct: [1],
          why: [
            'A block returns only when nobody points at it. The other sequence still reads it, so freeing it would corrupt that sequence.',
            'Right: releasing drops the count from 2 to 1, and the block returns to the free queue only when its last owner drops it and the count reaches zero.',
            'Sharing does not reserve a block. Once its refcount reaches zero it joins the free queue, still hashed and evictable, and is reused when the pool needs it.',
            'The manager does no timed reclaiming. Refcounts reach zero exactly when the last owner releases, and that moment is the only trigger.',
          ],
          revealAt: 'The allocation lifecycle, end to end',
          kcs: ['t5.block-refcounts'],
        },
      ],
    },
    {
      type: 'prose',
      md: `You passed the T2 exam, so you already *recognize* PagedAttention. This lesson is the owner's manual: the actual data structures, the allocation lifecycle of a sequence, how prefix caching falls out of refcounted blocks, what the CUDA kernel pays for indirection, and where the design's limits are. T2.L7 taught you *that* it's paging; T5.L5 teaches you *how* — enough to read vLLM's V1 KV-cache manager (\`vllm/v1/core\`) without a guide.`,
    },
    {
      type: 'prose',
      md: `## The data structures, concretely

The block manager splits GPU KV memory into fixed-size **blocks** — default 16 tokens per block. Using T5.L4's 8B model (128 KiB of KV per token, so one block holds 16 × 128 KiB = 2 MiB), a pool of N blocks is the entire serving capacity. Two structures run the show:

- **The free-block queue** — your T1.L3 free list, minus the fit search (all blocks identical), kept in eviction order: \`alloc()\` pops the head, \`free()\` pushes the tail, O(1), no fragmentation between blocks ever.
- **Per-sequence block tables** — a growable array of physical block ids: logical block \`i\` (tokens \`16i..16i+15\`) lives in physical block \`table[i]\`. The attention kernel translates per block as it reads — the MMU walk, one level deep.

Blocks also carry a **refcount** for sharing. When refcount hits zero, the block joins the free queue, but it is *not* erased: its contents and its hash stay valid, so it remains in the prefix cache as an **evictable** block until \`alloc()\` pops it for something new. A prefix hit on a refcount-0 block pulls it back out of the queue. That refcount is the entire machinery behind the features that made vLLM a product.`,
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
        { caption: 'Sequence A finishes: decrement all its blocks\' refcounts; ref=0 blocks join the free queue in O(1) but stay cached, evictable and reusable on a prefix hit until reallocated. No compaction, no fragmentation — the T1.L4 fixed-block maneuver, live in production.', active: ['free'], edges: ['b9->free'] },
      ],
      predictAt: {
        step: 2,
        prompt: 'A beam forks inside a shared block, and one beam now needs to write a new token into it. What does the manager do with that block?',
        options: [
          'It writes in place, since both beams hold the same tokens up to the fork and the write looks harmless',
          'It gives the writing beam a private copy, since a shared block must not change under its other owner',
          'It pauses the other beam, since a shared block allows one writer at a time and the other waits its turn',
          'It frees the block for both beams, since a block that has to change can no longer be shared by anyone at all',
        ],
        correct: [1],
        why: [
          'The write would also change what the other beam reads, because both tables point at the same physical block. A block with refcount above 1 is read-only.',
          'Right: copy-on-write allocates one block, copies the existing KV, updates the writer\'s table and drops a reference on the original. The other beam never notices.',
          'Nothing is paused. Beams run in the same step, and the copy gives the writer a private block so no ownership has to be taken from the other.',
          'Freeing a block that another beam still reads would corrupt that beam. The original stays in place for its remaining owner.',
        ],
        kcs: ['t5.kv-copy-on-write', 't5.block-refcounts'],
      },
    },
    {
      type: 'prose',
      md: `## The allocation lifecycle, end to end

Watch one request through the manager:

1. **Prefill:** prompt token count \`p\` → need \`⌈p/16⌉\` blocks. The scheduler admits only if the free queue can cover it (admission control, T2.L4 — otherwise the request waits). A cached prefix (below) may make most of those blocks *already mapped*: refcount bumps instead of allocations.
2. **Decode:** each new token appends to the tail block. Every 16th token, the tail fills: allocate one fresh block, append its id to the table. Amortized allocation cost per token: ~zero — this is why fixed blocks beat per-token bookkeeping.
3. **Finish/preempt:** decrement refcounts along the table; zero-ref blocks join the free queue, still cached and evictable. When the queue runs dry, the V1 scheduler preempts a victim by freeing its blocks and **recomputing** its prefill later (V1 dropped the CPU swap path; the old V0 engine could also swap blocks to CPU RAM, T2.L3); the block table makes this a metadata update, not a memory defrag. If the victim's blocks are still cached when it resumes, the recompute is mostly prefix hits.

**Prefix caching** is then almost free as a feature: hash the *token blocks* of common prefixes; a hit maps the cached physical blocks into the new sequence's table with refcount+1. Your 2k-token system prompt is stored once and shared by every request — a 100× memory multiplier at 100 concurrent users, from the same refcount byte. Because freed blocks stay hashed, it also survives the gaps between requests: the cache only forgets a block when it is *evicted* (popped off the free queue head to serve a new allocation), oldest first.`,
    },
    {
      type: 'code',
      filename: 'block_manager.py — the manager in 40 lines (simplified vLLM V1)',
      lang: 'python',
      code: `from collections import OrderedDict

BLOCK = 16                      # tokens per block (vLLM default)

class BlockManager:
    def __init__(self, num_blocks: int):
        self.free = OrderedDict.fromkeys(range(num_blocks))  # eviction order: head first
        self.refcount = [0] * num_blocks
        self.key: list[bytes | None] = [None] * num_blocks   # phys block -> its hash
        self.cache: dict[bytes, int] = {}   # token-block hash -> phys block

    def alloc(self) -> int:
        if not self.free:
            raise OutOfBlocks              # → scheduler preempts (V1: recompute)
        b, _ = self.free.popitem(last=False)
        if self.key[b] is not None:         # evict: only now is the cached data forgotten
            del self.cache[self.key[b]]
            self.key[b] = None
        self.refcount[b] = 1
        return b

    def share(self, b: int) -> int:         # prefix hit / beam fork
        if self.refcount[b] == 0:
            del self.free[b]                # revive a cached-but-free block
        self.refcount[b] += 1
        return b

    def free_block(self, b: int) -> None:
        self.refcount[b] -= 1
        if self.refcount[b] == 0:
            self.free[b] = None             # O(1), evictable, still in self.cache

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

The PagedAttention kernel reads K/V through the block table: per block, one extra table lookup and a non-contiguous gather. Measured overhead: the paper reports **20–26% higher attention-kernel latency** than FasterTransformer (table lookups, extra branches) — a real cost, not a rounding error. It is repaid because attention is only one part of a decode step and the memory it frees allows much larger batches. What it buys, from the paper and every deployment since: waste from 60–80% → **<4%**, batch sizes 2–4× larger on the same GPU, prefix sharing as a free side effect, and preemption as a metadata operation. In the simulator you'll operate the manager itself: allocate, share, fork with COW, preempt, and watch the free-block count — the single most instructive dial in LLM serving.`,
    },
    {
      type: 'exercise',
      simId: 'sim-kv',
      machine: 'blocks',
      title: 'Block-table explorer',
      taskIds: ['t-blk-share', 't-blk-cow', 't-blk-preempt', 't-blk-sweep'],
      tasks: [
        'Run two requests sharing a 48-token prompt: verify prefix blocks show refcount=2 and memory is paid once.',
        'Fork a beam inside a full block: watch the COW allocate one block and copy 16 tokens of KV.',
        'Drive the free queue to zero: trigger preemption — compare swap-to-CPU (the V0 option) vs recompute (all V1 does) on TTFT.',
        'Sweep block size 4 → 64: plot tail waste vs table overhead; locate why 16 is the default.',
      ],
      note: `You have now operated the exact machinery from the SOSP paper: free list (T1), paging (T2.L2), COW sharing (T2.L2), eviction/preemption (T2.L3), admission control (T2.L4) — one Python class's worth of logic that doubled the industry's effective GPU capacity.`,
    },
    {
      type: 'prose',
      md: `**Build this:** [lab 02, stage 1 is a 2-minute win](/forge/kv-block-manager). You write this block manager in Rust: block tables, fork with refcounts, copy-on-write, and a 2,000-operation churn that checks block conservation after every step. Stage 1 (\`paging\`) is the block-table arithmetic from this lesson, translating a token position to a block and an offset.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Prefix caching in vLLM is implemented as…',
          options: [
            'Copying the cached prompt\'s key and value tensors into freshly allocated blocks on a hit, giving each request a private copy',
            'Hashing token blocks chained to the blocks before them, and mapping matching cached physical blocks into the new sequence\'s table',
            'Keeping finished blocks in a host-side key-value store in host memory, and fetching them back over the bus when a matching request arrives',
            'Merging requests that share a system prompt into one long shared sequence, and splitting the outputs afterwards',
          ],
          correct: [1],
          kcs: ['t5.block-refcounts', 't5.block-tables'],
          explanation:
            'Refcounted block sharing makes prefix caching nearly free: no copy, no special path, the same machinery as beam forks. This is why "the block table" is the whole design.',
          why: [
            'Copying would cost bandwidth and give every request its own memory, which is the duplication prefix caching removes. Matching blocks are mapped in place and shared.',
            'Right: a hit maps the existing physical blocks into the new block table and bumps refcounts, so the prefix is stored once and shared by every request.',
            'The default V1 prefix cache lives in GPU memory: freed blocks stay hashed in HBM until reallocated. A CPU tier is an optional add-on, not the mechanism.',
            'Requests stay separate sequences with their own outputs and block tables. Sharing happens at the block level, not by concatenating different requests.',
          ],
        },
        {
          q: 'The block size (default 16 tokens) trades off…',
          options: [
            'Model quality, against kernel speed from fewer lookups as larger blocks coarsen attention',
            'Internal waste in the half-empty tail block, against table length and lookup overhead in the kernel',
            'External fragmentation between blocks, against allocation time spent finding a free slot in the pool',
            'Transfer cost between devices, against how many blocks the pool can hold and thereby concurrency',
          ],
          correct: [1],
          kcs: ['t5.block-tables'],
          explanation:
            'The classic fixed-block pricing from T1.L4: waste lives in the tail, metadata lives in the table. 16 is the default because it is large enough to use the GPU efficiently and small enough to avoid much internal fragmentation.',
          why: [
            'Block size is purely a storage layout. Attention still covers every cached token exactly, so output is identical at any block size.',
            'Right: on average half the last block is empty, so larger blocks waste more; smaller blocks mean longer tables and more per-block translation in the kernel.',
            'Identical-size blocks cannot leave holes, so external fragmentation is zero, and alloc() pops the free-queue head in O(1). The cost sits in the tail and the table.',
            'Tensor-parallel GPUs each hold their own slice of the KV heads; blocks are not shipped between GPUs during decode, so block size does not set a transfer cost.',
          ],
        },
        {
          q: 'In the current V1 engine, when the free-block queue empties during decode, vLLM…',
          options: [
            'Swaps the lowest-priority sequence\'s blocks to host memory over the bus, and restores them when memory frees up',
            'Preempts a running sequence once no cached free block is left to reallocate, freeing its blocks and recomputing it on resume',
            'Spills new tokens\' key and value tensors into pinned host memory, and decode continues at lower bandwidth with no scheduler action',
            'Raises an out-of-memory error for the whole engine, and aborts the in-flight requests with no scheduler recovery',
          ],
          correct: [1],
          kcs: ['t5.block-tables', 't5.kv-capacity'],
          explanation:
            'Admission control plus eviction, T2.L3 verbatim. The block table makes preemption a metadata operation; V1 always recomputes (V0 could also swap), like dropping file-backed pages rather than writing them out.',
          why: [
            'Swap to CPU was the V0 option. V1 dropped it: a preempted sequence loses its blocks and recomputes its prefill on resume, trading compute for PCIe traffic.',
            'Right: cached free blocks are evicted before anything else, so an empty queue means preempting a victim, freeing its blocks and recomputing it later, often through prefix hits.',
            'Attention kernels read KV from GPU memory. There is no transparent CPU fallback, and slower-bandwidth spill would break the decode loop; the scheduler must free blocks instead.',
            'Blocks are pooled and returned to the free queue on completion or preemption. Running out triggers the scheduler, not a crash, so one sequence waits instead of the engine failing.',
          ],
        },
        {
          q: 'The PagedAttention kernel\'s block-table indirection is affordable because…',
          options: [
            'Modern GPUs resolve the block-table lookup in hardware like a translation cache, and the indirection adds no measurable cost',
            'The kernel runs measurably slower than a contiguous one, and the reclaimed memory grows batches enough to lift throughput',
            'The kernel first gathers the blocks into one contiguous buffer, and attention then runs on contiguous memory at the price of one copy',
            'The table is small enough to live in registers, and lookups stay out of memory while the kernel matches a contiguous-cache kernel',
          ],
          correct: [1],
          kcs: ['t5.block-tables'],
          explanation:
            'Indirection has a real kernel cost, 20-26% higher attention latency than FasterTransformer in the paper. It is repaid because 60-80% of KV memory had been wasted: reclaiming it grows batches and gives 2-4x higher end-to-end throughput than FasterTransformer and Orca.',
          why: [
            'No hardware TLB exists for this lookup: the kernel reads the table and branches in software. That is the source of its measured overhead, which is not zero.',
            'Right: the paper measured 20-26% higher attention-kernel latency, but attention is only part of a step and the memory saved allows larger batches, giving 2-4x higher throughput.',
            'PagedAttention reads blocks in place. Gathering them into a buffer first would add a full pass over the cache, defeating the purpose of paging.',
            'Tables are small but are read from memory per sequence, not held in registers, and the block gather still adds latency. The paper reports a measurable slowdown, not parity.',
          ],
        },
      ],
    },
  ],
}

export default lesson
