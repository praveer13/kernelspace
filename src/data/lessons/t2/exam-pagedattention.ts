import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't2.l7',
  slug: 'exam-pagedattention',
  trackId: 't2',
  index: 7,
  title: 'EXAM: Read the PagedAttention Paper',
  minutes: 45,
  hook: 'A guided walkthrough mapping every idea in the vLLM paper to an OS concept you now own. Completion requires 80%+ on the exam quiz.',
  exercise: 'read+quiz',
  exam: true,
  blocks: [
    {
      type: 'prose',
      md: `This is the T2 exam, and it is not a test of memory — it is a test of *translation*. You are going to read the paper that kicked off modern LLM serving, **"Efficient Memory Management for Large Language Model Serving with PagedAttention"** (Kwon et al., SOSP 2023), the way a systems engineer reads it: every section mapped to an OS primitive you learned in this track. You will not need any ML background beyond one idea (the KV cache), which the paper itself introduces and which T5 will dissect fully.

The exam rule: the lesson's *Mark complete* unlocks only at **80% or better** on the quiz at the end. Take the guided read seriously and the quiz will feel like a formality.`,
    },
    {
      type: 'prose',
      md: `## §1–2: The problem, in OS vocabulary

The paper's motivation, translated: a transformer's **KV cache** — the per-token key/value tensors needed for attention — grows linearly with sequence length and is *enormous*: for a 13B model, a single 2k-token sequence's cache is ~1.6 GB. Existing engines (2022–2023: FasterTransformer, Orca) stored each sequence's cache in **one contiguous GPU buffer, pre-allocated for the maximum possible length**.

You already know this bug — you built it in T1. Contiguous, worst-case, per-client reservation produces: **internal fragmentation** (a 300-token generation reserving space for 4096 tokens wastes 93% of the reservation), **external fragmentation** (variable-size segments that can't be reused across sequences), and **duplication** (parallel samples / beam search re-copying the shared prompt). The paper measures **60–80% of KV memory wasted** in these systems. Their phrase is different, but the diagnosis is a T1.L4 fragmentation report.`,
    },
    {
      type: 'callout',
      variant: 'isomorphism',
      md: `Read the paper's Figure 2 (memory waste breakdown) next to your T1 fragmentation simulator output: "reserved-but-unused" is internal fragmentation from worst-case allocation; "unusable gaps" is external fragmentation from variable sizes. The paper never says "allocator," but §2 is an allocator autopsy.`,
    },
    {
      type: 'prose',
      md: `## §3: PagedAttention — paging, verbatim

The fix, section 3: partition each sequence's KV cache into **blocks** of a fixed number of tokens (default 16). Blocks live anywhere in GPU memory; each sequence keeps a **block table** mapping its logical blocks to physical blocks; the attention kernel reads keys/values *through* the block table.

Now translate with T2.L2: blocks are **pages**; physical blocks are **frames**; the block table is a **page table** (one level, since sequences are small); the attention kernel walking it is the **MMU** doing translation. Every property follows for free, exactly as in 1962:

- **Fixed-size blocks ⇒ no external fragmentation.** Any free block fits any sequence (T1.L4's fixed-block maneuver).
- **Waste is bounded to the tail block**: ≤15 tokens per sequence. The paper reports **<4% waste** — bounded internal fragmentation by construction.
- **Growth is lazy**: blocks are allocated on demand as tokens generate, like demand paging — no more worst-case reservation.
- **Sharing is block-granular**: two sequences with a common prefix (the system prompt, parallel samples, beam branches) *share physical blocks*, reference-counted. When one branch writes to a shared block, it is copied — **copy-on-write**, the fork() trick from T2.L2, with the same refcounts.`,
    },
    {
      type: 'isomorphism',
      title: 'the paper, mapped',
      pairs: [
        {
          os: 'page / frame',
          osLine: 'Fixed 4 KB units of virtual/physical memory; any frame backs any page.',
          llm: 'KV block',
          llmLine: 'Fixed 16-token units of logical/physical KV; any physical block serves any sequence.',
          breaks: 'A page is sized by hardware (4 KB) and backs bytes; a KV block is a software choice (16 tokens) whose byte size depends on the model\'s layers, heads and dtype.',
        },
        {
          os: 'page table + MMU',
          osLine: 'Per-process indirection; hardware translates on every access.',
          llm: 'block table + kernel',
          llmLine: 'Per-sequence indirection; the PagedAttention CUDA kernel translates per block.',
          breaks: 'Hardware translation is transparent to the program; here the attention kernel itself was rewritten to chase block pointers, a cost the MMU never imposes on code.',
        },
        {
          os: 'fork() + COW',
          osLine: 'Children share frames read-only; writes copy the touched frame.',
          llm: 'beam/sample sharing',
          llmLine: 'Branches share prompt blocks read-only; diverging writes copy one block.',
          breaks: 'fork() clones a whole address space; branches here share only prefix blocks, and the sharing is bookkeeping by vLLM\'s block manager, not a kernel mechanism.',
        },
        {
          os: 'swap + eviction',
          osLine: 'Cold frames to disk under pressure; refault on access.',
          llm: 'preemption: swap / recompute',
          llmLine: 'Victim sequences\' blocks to CPU RAM (the paper) — or discarded and recomputed on resume (all V1 does).',
          breaks: 'Swap targets are about 100 µs and page-granular; KV blocks cross PCIe in bulk, and recompute is an option only because prefill can regenerate the dropped state.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## §4: Scheduling — the T2.L4 layer

Memory management is half the paper; the other half is a **scheduler**, and you own this too. vLLM batches at *iteration* granularity (continuous batching — T5.L7 goes deep) and must decide: which waiting sequences to **admit** (is there enough free block space?), and which running sequences to **preempt** when blocks run out.

On preemption the paper evaluates two policies that should give you déjà vu: **swapping** (copy the victim's blocks to CPU RAM, copy back on resume — the OS's swap-to-disk, with host RAM, over PCIe, as the disk) and **recomputation** (drop the blocks, re-run prefill on resume — the OS's drop-and-reread of file-backed pages). It even models the trade the same way: swap costs bandwidth, recompute costs compute, and the right choice depends on sequence length and load. (That is the 2023 paper's menu: vLLM V1 later kept only recomputation.) Admission is FCFS; preemption is last-in-first-out among the running set. It is a timesharing system: the GPU is the CPU, the iteration is the quantum, and HBM is the RAM.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `If you've operated a JVM under memory pressure you already feel §4 in your bones: admission control = "don't start what you can't heap," swapping = the OS paging cold heap out to disk, which is literally what the paper's swap policy does with host RAM, over PCIe, as the disk. The cleanest analogy is your database: buffer pool (HBM) too small for the working set (KV demand), so pages spill — and the DBA answer is never a better eviction policy, it's admission control and more RAM. The paper's throughput curves are that DBA lesson at 2 TB/s.`,
    },
    {
      type: 'prose',
      md: `## §5–6: The kernel and the numbers

One level down: the paper contributes a CUDA kernel that performs attention *through* the block table — gathering K/V from scattered physical blocks instead of assuming contiguity. That indirection costs something (block-table lookups, non-unit strides), and the paper's engineering is keeping that cost near zero against a **2–4× throughput** win from fitting 2–4× more sequences per GPU. Headline results (A100, OPT/LLaMA models, real traces): vLLM delivers up to **~24× FasterTransformer and ~3.5× Orca** in throughput, and — the number that sold the field — it serves the same traffic on a fraction of the GPUs by reclaiming the 60–80% wasted KV memory.

Also note §5's distributed bits: for models spanning GPUs, the block manager is replicated per worker and the scheduler broadcasts block tables — a shared-nothing page-table-per-process design, consistent with everything above.`,
    },
    {
      type: 'deepdive',
      title: 'Why one level of block table, not four?',
      md: `T2.L2's 4-level radix tree exists because a 48-bit address space is astronomically sparse. A sequence is small (≤ ~1M tokens → ≤ 65k blocks), so a **flat array** block table is tiny (65k × 8 B = 512 KB worst case) and translation is a single indexed load. Design rule from both worlds: match the table depth to the sparsity of the space. Later systems (e.g. some TGI/TRT-LLM modes) use the same flat scheme; the radix tree returns when the "address space" is a whole cluster's KV pool — see T5.L9 on Mooncake's distributed KV.`,
    },
    {
      type: 'prose',
      md: `## Exam briefing

You are ready for the checkpoint when you can answer, without notes: What three wastes does §2 diagnose, and what are their allocator names? Why do fixed-size blocks eliminate external fragmentation but not internal? Walk the fork()/COW mapping for beam search. Contrast swap vs recompute preemption with the OS analog. Why does the block-table indirection cost so little compared to what it buys? The quiz is five questions and needs 80%. Then T3: Rust — the language the next generation of this stack is written in.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The three KV-memory wastes the paper diagnoses in prior systems map to which allocator phenomena?',
          options: [
            'Memory leaks from unfreed sequences, data races on shared KV tensors, and deadlocks between the scheduler and the allocator',
            'Internal fragmentation from worst-case reservation, external fragmentation from variable segments, and duplicated prefixes',
            'Thrashing from preemption storms, false sharing between attention heads, and TLB misses on every block-table lookup in the kernel',
            'Stack overflow from long prompts, heap overflow from long outputs, and double frees when a sequence is preempted',
          ],
          correct: [1],
          explanation:
            'Reserved-but-unused slots are internal fragmentation; unusable gaps between variable-size segments are external; re-copied prompts for parallel samples are duplication that page-style sharing eliminates. §2 is an allocator autopsy.',
          why: [
            'Misconception: the waste is leaked memory. The 60–80% is memory that is reserved or stranded, not lost: sequences free their KV on completion, and nothing here is a race or deadlock.',
            'Right: slots reserved for worst-case length but unused are internal fragmentation, gaps between variable-size segments are external, and re-copied shared prompts are duplication.',
            'Misconception: the waste is runtime pathology. Thrashing, false sharing and TLB misses are performance effects of access patterns; the paper measures allocation waste in how KV cache is laid out.',
            'Misconception: memory-safety bugs. Overflows and double frees are correctness defects; the paper diagnoses well-behaved allocators that simply waste space through reservation and layout.',
          ],
        },
        {
          q: 'PagedAttention bounds KV waste to <4% primarily because…',
          options: [
            'Compressing KV tensors to FP8 shrinks every reservation, so the unused part of each reservation shrinks with it',
            'Fixed-size token blocks rule out external fragmentation and cap internal waste at the partly filled tail block of each sequence',
            'Evicting cold sequences to CPU RAM frees their blocks quickly, so reserved-but-idle memory never accumulates on the GPU at all',
            'Sharing weights across GPUs with tensor parallelism leaves more HBM free for KV, which reduces the waste fraction directly',
          ],
          correct: [1],
          explanation:
            'The fixed-block maneuver from T1.L4: any free block fits any sequence (no external fragmentation), and waste is ≤ block_size−1 tokens in the tail — the same physics as OS page frames.',
          why: [
            'Misconception: compression fixes waste. FP8 shrinks the bytes per token, but a worst-case reservation shrinks proportionally; the unused fraction stays the same, and PagedAttention does not require it.',
            'Right: any free block fits any sequence, so no gaps are stranded, and each sequence wastes at most the unfilled part of one block (up to 15 tokens at block size 16).',
            'Misconception: eviction does the work. Offload helps under pressure, but waste comes from how memory is reserved and laid out; the <4% figure holds without any swapping.',
            'Misconception: more free HBM means less waste. Extra headroom is capacity, not efficiency; the waste fraction is defined by the allocation scheme, and weights sit in a separate region.',
          ],
        },
        {
          q: 'Beam search / parallel sampling in vLLM shares memory exactly like…',
          options: [
            'A RAID mirror: each branch writes its own copy of every block in parallel so that one failed branch cannot corrupt another',
            'Unix fork with copy-on-write: branches share the prompt\'s physical blocks via refcounts, and a diverging write copies one block',
            'An mmap\'d read-only file: branches map the same prompt blocks and may never write to them, so nothing is ever copied or duplicated',
            'A lock-protected shared queue: branches take turns appending their tokens to one common buffer so that only one writes at a time',
          ],
          correct: [1],
          explanation:
            'Shared blocks are read-only across branches; when one branch generates into a shared block, the manager copies it (COW) and decrements the source refcount. The paper\'s Figure 4 is the fork() diagram.',
          why: [
            'Misconception: mirroring. RAID duplicates everything for fault tolerance, which is the duplication waste PagedAttention removes; branches share blocks until they diverge.',
            'Right: branches reference the same physical prompt blocks with a refcount. When one generates into a shared block, the manager copies just that block, as fork() COW copies a page.',
            'Misconception: read-only sharing. Branches do write, since each appends its own tokens; a read-only mapping would forbid that, so a COW copy is needed on divergence.',
            'Misconception: serialised appends. Branches generate different tokens concurrently and each owns its own continuation; a single shared buffer would mix their outputs.',
          ],
        },
        {
          q: 'The swap-vs-recompute preemption debate in §4 mirrors the OS choice between…',
          options: [
            'Eager versus lazy page allocation: reserve all frames at process start, or fault each page in on its first touch only',
            'Swapping anonymous pages to disk versus dropping clean file-backed pages for later re-read: bandwidth versus recompute',
            'Huge pages versus base pages: fewer, larger blocks to move at once versus finer blocks that waste less memory per allocation',
            'Round-robin versus priority scheduling: rotate every sequence through the batch fairly, or always favour the most important one',
          ],
          correct: [1],
          explanation:
            'Swapping KV to CPU RAM costs PCIe bandwidth but preserves state; recomputation frees HBM but repays prefill FLOPs. The OS makes the identical call for anonymous vs file-backed pages.',
          why: [
            'Misconception: it is an allocation-timing choice. Eager versus lazy allocation decides when memory is granted; §4 is about restoring state after memory was taken away.',
            'Right: a clean file-backed page can be dropped and re-read; an anonymous page must be written out to be preserved. KV swap pays bandwidth and recompute pays FLOPs, the same trade.',
            'Misconception: it is a page-size choice. Huge versus base pages trade TLB reach for internal waste; §4 keeps the block size fixed and chooses how to treat a victim sequence.',
            'Misconception: it is a scheduling-policy choice. Round-robin versus priority picks who runs next; swap versus recompute is how the evicted sequence\'s state is restored afterwards.',
          ],
        },
        {
          q: 'Why does the block-table indirection cost so little relative to its benefit?',
          options: [
            'The block table is pinned in L1 cache for the whole kernel launch, so every lookup costs a single cycle and adds no stall',
            'The extra index loads are small next to the 2–4× larger batch from reclaimed memory, since decode is memory-bound, not compute-bound',
            'CUDA overlaps each block lookup with tensor-core math, so the extra loads are fully hidden and add no measurable time',
            'The GPU\'s hardware MMU performs the block translation as part of normal addressing, so software pays nothing for it',
          ],
          correct: [1],
          explanation:
            'Decode is memory-capacity- and bandwidth-bound: reclaiming 60–80% of KV space multiplies batch size, which multiplies throughput. A few extra index loads per block are noise against that win — the MMU trade, reprised.',
          why: [
            'Misconception: the table is free to read. It is a normal global-memory structure, small enough to cache well but not pinned, and each lookup is a real load rather than a one-cycle event.',
            'Right: decode is limited by KV capacity and bandwidth, so reclaiming 60–80% of KV space grows the batch and throughput. A few index loads per block are small against that win.',
            'Misconception: the cost is fully hidden. Overlap helps some, but the lookups are real work in a bandwidth-bound kernel; the case rests on the throughput gain exceeding the overhead.',
            'Misconception: hardware does the translation. The GPU\'s MMU maps virtual to physical for the whole allocation; the block table is a software indirection the attention kernel walks itself.',
          ],
        },
      ],
    },
  ],
}

export default lesson
