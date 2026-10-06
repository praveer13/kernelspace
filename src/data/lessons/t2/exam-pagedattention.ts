import type { AuthoredItem } from '@/lib/items/types'
import type { Lesson } from '../types'

/**
 * Spiral items (spec §8.6): authored questions on earlier T0-T2 KCs, drawn by the t2.l7 checkpoint beside the
 * generated `frag` item. Refs are `item:<id>`; each option's `miss` names the slip it encodes.
 */
const SPIRAL: AuthoredItem[] = [
  {
    id: 't2.spiral.row-walk',
    kcs: ['t0.locality', 't0.stride-traversal'],
    q: {
      q: 'Summing a large row-major matrix is much faster row by row than column by column because…',
      options: [
        'Rows sit in the faster banks of DRAM, while columns are spread over slower banks that take longer to open',
        'Row walks stay inside one TLB entry for the whole matrix, while a column walk cannot be translated by the TLB at all',
        'Each cache line a row walk fetches serves the next several reads, while a column walk lands on a new line each time',
        'The compiler vectorises row loops, while column loops are forced onto scalar instructions that run far below peak speed',
      ],
      correct: [2],
      explanation:
        'Locality: a row walk reuses each fetched 64-byte line for up to 16 four-byte reads, and a column walk reuses none of it. The gap is the memory system, not the loop.',
      why: [
        'Misconception: DRAM has fast and slow regions by row. Every address costs about the same to reach; what differs is how many reads each fetched line serves.',
        'Misconception: the TLB is the whole gap. A column walk adds TLB misses, but translations are cached for any access pattern; the dominant cost is refetching cache lines from DRAM.',
        'Right: memory moves in whole lines, so sequential reads reuse the line already fetched. A stride of one row jumps to a new line on every read, and the lines are evicted before they are reused.',
        'Misconception: it is a compiler effect. Vectorisation helps row loops, but the same scalar code is still several times slower by column, so the gap comes from the memory system, not the instruction mix.',
      ],
      miss: ['t2.stride-gap-is-dram-region', 't2.stride-gap-is-tlb', '', 't2.stride-gap-is-compiler'],
    },
  },
  {
    id: 't2.spiral.counter-line',
    kcs: ['t0.false-sharing', 't0.cache-lines'],
    q: {
      q: 'Two threads each increment their own counter, and the two counters sit side by side in one struct. Adding the second thread slows both down. The likely cause is…',
      options: [
        'Both counters sit behind one lock word, so the threads queue on that lock even though their data never overlaps',
        'The two cores share one register file, so every increment has to save and restore state before the other can run',
        'Neighbouring addresses share one TLB entry, so each increment forces a page walk that the other core must wait for',
        'The counters share one cache line, so each write invalidates the other core\'s copy and the line ping-pongs',
      ],
      correct: [3],
      explanation:
        'False sharing: coherence works on whole 64-byte lines, so two independent counters on one line behave like one contended variable. Pad each hot field onto its own line.',
      why: [
        'Misconception: there must be a lock. The code uses none; the slowdown is hardware coherence traffic on a shared line, which a lock-free counter suffers equally.',
        'Misconception: cores share registers. Each core has its own register file; a context switch is what saves and restores registers, and these threads each own a core.',
        'Misconception: the TLB is shared. TLBs are per core, and one entry covers a whole 4 KiB page of translations; two counters on one page are never the bottleneck.',
        'Right: the cores never touch the same variable, but they do touch the same 64-byte line. Each write takes the line exclusive and invalidates the other copy, so it ping-pongs. Padding each counter onto its own line fixes it.',
      ],
      miss: ['t0.false-sharing-is-a-lock', 't0.false-sharing-is-registers', 't0.false-sharing-is-the-tlb', ''],
    },
  },
  {
    id: 't2.spiral.round-up',
    kcs: ['t1.internal-frag'],
    q: {
      q: 'An allocator rounds every request up to a multiple of 64 bytes. What is wasted inside the block handed out for a 100-byte request?',
      options: [
        'The remainder of 100 divided by 64, which is 36 bytes carried into the next block',
        'The unused tail of the 128-byte block that was handed out, which is 28 bytes of slack',
        'One whole rounding unit of 64 bytes, which is added as padding to each request',
        'Nothing at all, because rounding moves the block\'s address but not the size handed out',
      ],
      correct: [1],
      explanation:
        'Internal fragmentation is the gap between the size asked for and the block handed out: 128 minus 100 is 28 bytes.',
      why: [
        'Misconception: the waste is the remainder. 100 mod 64 is 36, which is how far the request reaches into its second unit, not how much of that unit is left over.',
        'Right: 100 rounds up to 128, so 28 bytes inside the block are reserved but unused. That slack is internal fragmentation.',
        'Misconception: padding is a full unit. Only the gap up to the next multiple is wasted, so it is always less than 64 bytes.',
        'Misconception: rounding is free. The allocator hands out the rounded size, so the extra bytes are reserved for the caller and cannot serve anyone else.',
      ],
      miss: ['t1.rounding-remainder-slip', '', 't1.padding-is-a-full-unit', 't1.rounding-is-free'],
    },
  },
  {
    id: 't2.spiral.dead-frame',
    kcs: ['t1.stack-vs-heap'],
    q: {
      q: 'A function returns a pointer to one of its local arrays, and the caller reads through it after the call. What is that pointer?',
      options: [
        'A pointer into a dead stack frame that is still mapped, whose bytes the next call is free to overwrite',
        'A pointer to heap memory that was freed once, which stays safe to read until the allocator reuses it',
        'A valid pointer, because locals are zeroed on return and the caller reads a clean array of zeros',
        'A null pointer, because the compiler clears the address of every local when its frame is popped',
      ],
      correct: [0],
      explanation:
        'A pointer to a local outlives its frame: the bytes may survive for a while, but they no longer belong to anyone, so reads are unreliable and writes corrupt later calls.',
      why: [
        'Right: locals live in the frame, and the frame is gone after return. The memory is still mapped, so the read does not crash, but the next call can overwrite it and the caller sees garbage.',
        'Misconception: locals live on the heap. A plain local array is on the stack, and its lifetime ends with the call, not with a free.',
        'Misconception: frames are zeroed on return. Nothing clears them; stale bytes stay until another call overwrites them, which is why the bug comes and goes.',
        'Misconception: the compiler nulls dangling pointers. It does not track them, and the returned address is a real stack address that no longer belongs to a live frame.',
      ],
      miss: ['', 't1.local-lives-on-the-heap', 't1.frames-are-zeroed', 't1.dangling-becomes-null'],
    },
  },
  {
    id: 't2.spiral.offset-bits',
    kcs: ['t2.address-translation'],
    q: {
      q: 'On a system with 4 KiB pages, what does translation do with the low 12 bits of a virtual address?',
      options: [
        'Looks them up in the TLB first, because they name the page and the upper bits give the byte inside it',
        'Passes them through unchanged, because the offset inside a page equals the offset inside its frame',
        'Splits them across the table levels, because each level takes a share of the offset',
        'Replaces them with the frame number, because a physical address carries no offset inside the page',
      ],
      correct: [1],
      explanation:
        'Translation maps the page number to a frame number; the 12-bit offset passes through, so frame number and offset together form the physical address.',
      why: [
        'Misconception: the roles are swapped. The upper bits are the page number that the TLB and tables translate; the low 12 bits are the offset inside the page.',
        'Right: a page and its frame are the same size, so the byte offset needs no translation. Only the page number is looked up, and the frame number is joined to the unchanged offset.',
        'Misconception: the offset indexes the tables. The levels consume the upper 36 bits, nine at a time; the offset bypasses the walk entirely.',
        'Misconception: the frame number replaces the offset. It replaces the page number, and the offset is appended to it to form the physical address.',
      ],
      miss: ['t2.offset-is-the-page-number', '', 't2.offset-indexes-the-tables', 't2.frame-replaces-the-offset'],
    },
  },
  {
    id: 't2.spiral.fault-cost',
    kcs: ['t2.page-faults'],
    q: {
      q: 'Which of these events costs on the order of 100 µs because the process must wait for a storage device?',
      options: [
        'A minor fault on the first touch of a malloc\'d page, which maps a zeroed frame and retries the access at once',
        'A TLB miss on a resident page, which walks the page table in hardware and caches the translation it finds',
        'A major fault that reads a swapped-out page back from the SSD before the access can be retried',
        'A copy-on-write fault after fork, which duplicates one 4 KiB frame within RAM and then retries the write',
      ],
      correct: [2],
      explanation:
        'Only a major fault waits on a device. Minor faults, COW faults and TLB misses are all served from RAM, in microseconds or less.',
      why: [
        'Misconception: any fault waits on a device. A minor fault needs no I/O: the kernel maps a zeroed frame in about 1 to 10 microseconds and the instruction retries.',
        'Misconception: a TLB miss reaches storage. The page is resident, so the hardware walk reads a few table entries from RAM or cache in tens of nanoseconds.',
        'Right: the page is not in RAM, so the kernel must read it from the device while the process sleeps. That wait of about 100 microseconds is what separates a major fault from a minor one.',
        'Misconception: copy-on-write waits on a device. The copy is one memcpy within RAM, so the fault costs microseconds, not storage latency.',
      ],
      miss: ['t2.minor-fault-waits-on-disk', 't2.tlb-miss-reaches-storage', '', 't2.cow-fault-waits-on-disk'],
    },
  },
  {
    id: 't2.spiral.overload',
    kcs: ['t2.admission-scheduling', 't2.sched-policies'],
    q: {
      q: 'A service queues every request it receives, and traffic doubles past capacity. Which change best protects latency for the requests it does accept?',
      options: [
        'Add worker threads beyond the core count, so more of the waiting requests can run at the same time',
        'Shorten the time slice, so every queued request gets a little CPU and none of them has to wait for very long',
        'Raise the priority of the oldest requests, so the ones waiting longest are served ahead of new arrivals',
        'Turn away the excess before it joins the run set, so the admitted requests still meet their deadlines',
      ],
      correct: [3],
      explanation:
        'Past capacity no ordering or slicing creates throughput; only refusing work early keeps latency bounded for the work you accept.',
      why: [
        'Misconception: more threads add capacity. The cores are already saturated, so extra threads only add switching and cache cost, and every request gets slower.',
        'Misconception: a shorter slice shares the pain fairly. Past capacity every request still needs the same total CPU, so all of them finish late and switching overhead grows.',
        'Misconception: priority fixes overload. Reordering a queue that grows without bound only chooses who is late; it creates no capacity.',
        'Right: admission control rejects or defers work early and cheaply, so the queue stays bounded and admitted requests meet their deadlines. It is the same job as the KV-block check in continuous batching.',
      ],
      miss: ['t2.threads-fix-overload', 't2.short-slice-fixes-overload', 't2.priority-fixes-overload', ''],
    },
  },
  {
    id: 't2.spiral.shared-state',
    kcs: ['t2.mutex-atomics'],
    q: {
      q: 'Which shared state fits a single atomic fetch-add better than a mutex?',
      options: [
        'An account balance and its audit log, which must always change together or not at all',
        'A request counter that many threads increment together, where only the final running total matters',
        'A linked list whose nodes are inserted and removed, where each update touches several pointers',
        'A cache map from keys to values, where lookups and inserts must see one consistent table',
      ],
      correct: [1],
      explanation:
        'Use an atomic when the whole invariant lives in one word; use a mutex when several fields or pointers must change together.',
      why: [
        'Misconception: two fields can be atomic one at a time. Each atomic op covers one word, so another thread can see the balance changed but the log not, which a mutex prevents.',
        'Right: the state is one word and the update is one indivisible add, so a fetch-add is enough. No other field has to change with it, so no mutex is needed.',
        'Misconception: pointer edits are atomic as a group. An insert changes several pointers, and a single atomic cannot make them appear together, so it needs a mutex or a careful lock-free design.',
        'Misconception: a map is one word. A table has many slots and a size that must stay consistent, so concurrent inserts need a lock or a purpose-built concurrent map.',
      ],
      miss: ['t2.atomic-covers-two-fields', '', 't2.atomic-covers-list-edits', 't2.atomic-covers-a-table'],
    },
  },
]

const lesson: Lesson = {
  id: 't2.l7',
  slug: 'exam-pagedattention',
  trackId: 't2',
  index: 7,
  title: 'EXAM: Read the PagedAttention Paper',
  minutes: 45,
  hook: 'A guided walkthrough mapping every idea in the vLLM paper to an OS concept you now own, then a spiral checkpoint across the whole track: 6 of 8 right, with one written or computed answer.',
  exercise: 'read+quiz',
  exam: true,
  blocks: [
    {
      type: 'prose',
      md: `This is the T2 spiral checkpoint (the track's exam), and it is not a test of memory — it is a test of *translation*. You are going to read the paper that kicked off modern LLM serving, **"Efficient Memory Management for Large Language Model Serving with PagedAttention"** (Kwon et al., SOSP 2023), the way a systems engineer reads it: every section mapped to an OS primitive you learned in this track. You will not need any ML background beyond one idea (the KV cache), which the paper itself introduces and which T5 will dissect fully.

The checkpoint rule: eight items, **six right**, with at least one written or computed answer among them. Four items are about this lesson; four come back to earlier T0–T2 ideas, because a translation only works if the original is still in your head. Nothing locks: a miss offers fresh numbers, or you can carry on and return. Take the guided read seriously and the items will feel like a formality.`,
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
          osLine: 'Fixed 4 KiB units of virtual/physical memory; any frame backs any page.',
          llm: 'KV block',
          llmLine: 'Fixed 16-token units of logical/physical KV; any physical block serves any sequence.',
          breaks: 'A page is sized by hardware (4 KiB) and backs bytes; a KV block is a software choice (16 tokens) whose byte size depends on the model\'s layers, heads and dtype.',
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
      md: `T2.L2's 4-level radix tree exists because a 48-bit address space is astronomically sparse. A sequence is small (≤ ~1M tokens → ≤ 65k blocks), so a **flat array** block table is tiny (65k × 8 B = 512 KiB worst case) and translation is a single indexed load. Design rule from both worlds: match the table depth to the sparsity of the space. Later systems (e.g. some TGI/TRT-LLM modes) use the same flat scheme; the radix tree returns when the "address space" is a whole cluster's KV pool — see T5.L9 on Mooncake's distributed KV.`,
    },
    {
      type: 'prose',
      md: `## Checkpoint briefing

You are ready for the checkpoint when you can answer, without notes: What three wastes does §2 diagnose, and what are their allocator names? Why do fixed-size blocks eliminate external fragmentation but not internal? Walk the fork()/COW mapping for beam search. Contrast swap vs recompute preemption with the OS analog. Why does the block-table indirection cost so little compared to what it buys? The checkpoint draws on the questions below, a written answer, and four items from earlier lessons, and it needs six of eight with a written or computed answer among them. Then T3: Rust — the language the next generation of this stack is written in.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The three KV-memory wastes the paper diagnoses in prior systems map to which allocator phenomena?',
          options: [
            'Memory leaks from unfreed sequences, data races on shared KV tensors, and deadlocks between the scheduler and the KV allocator under load',
            'Internal fragmentation from worst-case reservation, external fragmentation from variable segments, and duplicated KV prefixes',
            'Thrashing from preemption storms, false sharing between attention heads, and TLB misses on block-table lookups in the kernel',
            'Stack overflow from long prompts, heap overflow from long outputs, and double frees of KV blocks when the scheduler preempts a sequence',
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
          kcs: ['t2.pagedattention-as-paging', 't1.external-frag'],
          miss: ['t2.waste-is-leaks', '', 't2.waste-is-runtime-pathology', 't2.waste-is-memory-safety'],
        },
        {
          q: 'PagedAttention bounds KV waste to <4% primarily because…',
          options: [
            'Compressing KV tensors to a lower precision shrinks each reservation, with the unused part shrinking along with it',
            'Fixed-size KV token blocks remove external fragmentation, with internal waste capped at the tail block of each sequence',
            'Evicting cold sequences to CPU RAM frees their blocks quickly, with reserved-but-idle memory not accumulating on the GPU',
            'Sharing weights across GPUs with tensor parallelism leaves more HBM free for KV, reducing the waste fraction directly',
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
          kcs: ['t2.pagedattention-as-paging', 't1.fixed-blocks'],
          miss: ['t2.compression-fixes-waste', '', 't2.eviction-fixes-waste', 't2.free-hbm-is-less-waste'],
        },
        {
          q: 'Beam search / parallel sampling in vLLM shares memory exactly like…',
          options: [
            'A RAID mirror, with each branch writing its own copy of each KV block in parallel to isolate branch failures',
            'Unix fork with copy-on-write, with branches sharing the prompt\'s KV blocks via refcounts and copying on write',
            'An mmap\'d write-protected file, with branches mapping the same prompt KV blocks and forbidden to write to them at any time',
            'A lock-protected shared queue, with branches taking turns appending their tokens to one common KV buffer at a time',
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
          kcs: ['t2.copy-on-write', 't2.pagedattention-as-paging'],
          miss: ['t2.sharing-is-mirroring', '', 't2.sharing-is-readonly', 't2.sharing-is-serialised-appends'],
        },
        {
          q: 'The swap-vs-recompute preemption debate in §4 mirrors the OS choice between…',
          options: [
            'Eager versus lazy page allocation, reserving the frames at process start against faulting each page in on its first touch',
            'Swapping anonymous pages to disk versus dropping clean file-backed pages for a later re-read, trading bandwidth against recompute',
            'Huge pages versus base pages, with fewer larger blocks to move at once against finer blocks that waste less memory',
            'Round-robin versus priority scheduling, rotating each sequence through the batch fairly against favoring the single most important one',
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
          kcs: ['t2.swap-vs-recompute'],
          miss: ['t2.swap-recompute-is-allocation-timing', '', 't2.swap-recompute-is-page-size', 't2.swap-recompute-is-sched-class'],
        },
        {
          q: 'Why does the block-table indirection cost so little relative to its benefit?',
          options: [
            'The block table is pinned in the GPU cache for the whole kernel launch, with each lookup costing a single cycle and no stall',
            'The extra index loads are small next to the much larger batch from reclaimed memory, with GPU decode memory-bound rather than compute-bound',
            'CUDA overlaps each block lookup with tensor-core math, with the extra loads hidden and adding no measurable time',
            'The GPU\'s hardware MMU performs the block translation as part of normal addressing, with software paying nothing for it',
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
          kcs: ['t2.pagedattention-as-paging', 't2.address-translation'],
          miss: ['t2.block-table-pinned', '', 't2.lookup-fully-hidden', 't2.gpu-mmu-translates'],
        },
      ],
    },
  ],
  kcs: ['t2.pagedattention-as-paging', 't2.copy-on-write', 't2.swap-vs-recompute'],
  ticket: {
    form: 'spiral',
    cr: [
      {
        prompt:
          'Map PagedAttention onto the OS: name the correspondences for blocks, the block table, and beam-search sharing.',
        model:
          'KV blocks are pages and physical blocks are frames. The block table is a per-sequence page table that the attention kernel walks. Fixed-size blocks mean no external fragmentation and at most one partly filled block of waste per sequence. Beam branches share prompt blocks by reference count and copy a block when one writes, as fork does.',
        ideas: [
          'KV block is a page and a frame; the block table is a page table that the kernel walks',
          'Fixed-size blocks mean no external fragmentation, and waste is bounded to the tail block',
          'Branches share prefix blocks by reference count and copy on write, as fork() does',
        ],
        kcs: ['t2.pagedattention-as-paging', 't2.copy-on-write'],
      },
      {
        prompt:
          'When vLLM runs out of KV blocks, what does it do to a running sequence, and which OS decision does that mirror?',
        model:
          'It preempts a victim, the last sequence to arrive, and takes its blocks back. The 2023 paper offers two ways: swap the blocks to CPU RAM over PCIe, or drop them and recompute the prefill on resume. V1 keeps only recompute. This mirrors swapping an anonymous page out versus dropping a re-readable file-backed page.',
        ideas: [
          'Preempt a victim (the last to arrive) and take its blocks back',
          'Swap costs PCIe bandwidth, recompute costs prefill FLOPs, and V1 keeps only recompute',
          'Same trade as swapping anonymous pages versus dropping re-readable file-backed pages',
        ],
        kcs: ['t2.swap-vs-recompute'],
      },
    ],
    spiral: SPIRAL,
  },
}

export default lesson
