import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't2.l2',
  slug: 'virtual-memory',
  trackId: 't2',
  index: 2,
  title: 'Virtual Memory, Deeply',
  minutes: 30,
  hook: 'Page tables, TLB, page faults, mmap — walk an address translation yourself in the simulator, then never fear the vLLM paper\'s block tables.',
  exercise: 'sim',
  simId: 'sim-vm',
  blocks: [
    {
      type: 'prose',
      md: `Every address your program has ever used is a lie. The \`0x7ffc…\` from T1 is a **virtual address** — a name that means nothing to the DRAM chips. Between your load instruction and the physical byte stands the memory management unit (MMU), translating every single access through a per-process data structure called the **page table**. This indirection, invented in 1962 (the Manchester Atlas), is what lets 200 processes share one RAM, lets each believe it owns a flat private address space, and lets the OS overcommit, swap, mmap files, and kill segfaulting processes cleanly.

It is also, not coincidentally, the exact design vLLM copied for KV-cache management. Learn it here once; recognize it in T5 forever.`,
    },
    {
      type: 'prose',
      md: `## Translation: pages, frames, and the walk

Virtual and physical memory are both cut into fixed-size chunks: **pages** (virtual, 4 KB typically) and **frames** (physical, same size). The page table maps *page number → frame number*; the offset within the page passes through unchanged. A 48-bit virtual address on x86-64 is really \`[VPN 36 bits | offset 12 bits]\`, and translation is: look up the VPN, get a frame, keep the offset.

One table can't hold 2³⁶ entries per process — that's 512 GB of metadata. So x86-64 uses a **4-level radix tree**: each level is a 4 KB page of 512 8-byte entries, and the walk descends \`PML4 → PDPT → PD → PT → data\`. Entries are allocated lazily, so a process pays page-table memory only for regions it actually maps. The register \`CR3\` points at the root; a context switch to another process means loading a different \`CR3\`.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — four levels of indirection turn one VPN into one frame',
      height: 58,
      nodes: [
        { id: 'va', x: 2, y: 4, w: 26, h: 9, label: 'virtual addr', sub: 'VPN | offset (12b)' },
        { id: 'pml4', x: 8, y: 22, w: 18, h: 8, label: 'PML4', sub: '512 entries' },
        { id: 'pdpt', x: 30, y: 34, w: 18, h: 8, label: 'PDPT', sub: '512 entries' },
        { id: 'pd', x: 52, y: 44, w: 18, h: 8, label: 'PD', sub: '512 entries' },
        { id: 'pt', x: 74, y: 34, w: 18, h: 8, label: 'PT', sub: '512 entries' },
        { id: 'frame', x: 74, y: 6, w: 22, h: 9, label: 'physical frame', sub: '+ offset → byte', color: '#3EF2A4' },
        { id: 'cr3', x: 36, y: 4, w: 16, h: 8, label: 'CR3 reg', sub: 'root ptr', color: '#FFB224' },
      ],
      edges: [
        { from: 'va', to: 'pml4' },
        { from: 'cr3', to: 'pml4' },
        { from: 'pml4', to: 'pdpt' },
        { from: 'pdpt', to: 'pd' },
        { from: 'pd', to: 'pt' },
        { from: 'pt', to: 'frame' },
      ],
      steps: [
        { caption: 'A load executes with a virtual address. The top 9 bits of the VPN index the PML4 (root found via CR3); each entry points to the next-level table.', active: ['va', 'cr3', 'pml4'], edges: ['va->pml4', 'cr3->pml4'] },
        { caption: 'Descend PDPT → PD → PT, 9 bits at a time. Sparse address spaces stay cheap: unmapped subtrees simply don\'t exist.', active: ['pdpt', 'pd'], edges: ['pml4->pdpt', 'pdpt->pd'] },
        { caption: 'The PT entry yields the physical frame number plus permission bits (read/write/exec, user/kernel, present). Concatenate frame + offset: the real byte.', active: ['pt', 'frame'], edges: ['pt->frame'] },
        { caption: 'If the present bit is 0 → PAGE FAULT: the CPU traps, the OS decides (lazy alloc? swap-in? illegal?) and either fixes the mapping and retries, or delivers SIGSEGV.', active: ['va'] },
      ],
    },
    {
      type: 'prose',
      md: `## The TLB: caching the answer

Notice the horror: a 4-level walk is **four extra memory reads per memory access**. Unmitigated, virtual memory would quarter your effective bandwidth. The mitigation is the **TLB** (translation lookaside buffer): a small, fast cache of recent VPN→frame translations — tens to a few thousand entries, ~1 cycle lookup. TLB hit: translation is free. TLB miss: the walk (hardware "page walker" does it, ~10–100 ns) and the entry is cached.

TLB reach matters: \`entries × page_size\`. With 1536 L2-TLB entries and 4 KB pages, that's 6 MB — smaller than your matrix from T0.L3, which is why that column walk thrashed *both* the data caches and the TLB. This is also the entire case for **huge pages** (2 MB/1 GB): same TLB, 512× the reach per entry. Databases and JVMs use \`-XX:+UseLargePages\`; GPU runtimes allocate HBM in huge pages for the same reason.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~1 cyc', label: 'TLB hit', hint: 'Translation disappears into the pipeline.' },
        { value: '~20–100 ns', label: 'TLB miss walk', hint: 'Hardware walks 4 levels; caches help but it stings.' },
        { value: '~1–10 µs', label: 'minor fault', hint: 'Page not present, no I/O (lazy alloc, COW) — kernel fixes and retries.' },
        { value: '~100 µs+', label: 'major fault', hint: 'Swap-in from SSD. The process sleeps; latency budget dies.' },
      ],
    },
    {
      type: 'prose',
      md: `## Page faults are a mechanism, not an error

You met SIGSEGV in T1 — an *invalid* fault. But most page faults are legitimate requests the kernel fulfills:

- **Lazy allocation**: \`malloc\` reserves virtual range; frames appear only on first touch, via fault. (Your 1 GiB \`new byte[]\` in Java "succeeds" instantly for this reason.)
- **Copy-on-write**: after \`fork()\`, parent and child share frames read-only; the first *write* faults, and the kernel copies just that page. Redis BGSAVE and Python multiprocessing both lean on COW.
- **mmap**: map a file (or device memory) into the address space; reads fault pages in from disk on demand. Zero-copy I/O, shared libraries, and model-weight loading all ride on it.
- **Swap**: under pressure, cold frames are written to disk and marked not-present; the next touch faults them back. T2.L3 is entirely about the policy here.

Hold the pattern: **trap → kernel inspects → fix mapping → transparent retry.** The hardware/software contract at its most elegant.`,
    },
    {
      type: 'isomorphism',
      title: 'virtual memory ≡ PagedAttention (the exam is lesson 7)',
      pairs: [
        {
          os: 'page table',
          osLine: 'Per-process map: virtual page → physical frame. Lazy, sparse, shared.',
          llm: 'block table',
          llmLine: 'Per-sequence map: logical token block → physical KV block. Lazy, shared.',
        },
        {
          os: 'copy-on-write fork',
          osLine: 'Parent/child share frames until one writes; then copy just that page.',
          llm: 'prefix sharing / beam fork',
          llmLine: 'Sequences share prompt blocks; a diverging branch copies only the block it writes.',
        },
        {
          os: 'swap to disk',
          osLine: 'Cold frames evicted under pressure; faulted back on touch.',
          llm: 'KV offload to CPU RAM',
          llmLine: 'Cold sequences\' blocks evicted from HBM; reloaded or recomputed on resume.',
        },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The JVM is a heavy virtual-memory user: the heap is one big lazily-committed \`mmap\` region (committed on touch — that's why \`-Xms\` and \`-Xmx\` matter for latency), ZGC's **colored pointers** literally store GC metadata in address bits the MMU ignores, and humongous allocations go straight to huge pages. If you've ever puzzled over VIRT vs RES in \`top\`: VIRT is the virtual address space (cheap, sparse), RES is the frames actually backed. You were reading a page table summary.`,
    },
    {
      type: 'prose',
      md: `## In the simulator

You will perform translations by hand: pick a virtual address, walk the four levels, hit and miss the TLB, trigger minor and major faults, and watch CR3 switch between two processes sharing one library via COW. When T2.L7 hands you the vLLM paper and it says "the block table maps logical blocks to physical blocks," your reaction will be a shrug: *of course it does.*`,
    },
    {
      type: 'exercise',
      simId: 'sim-vm',
      machine: 'walk4',
      title: 'Translation walk: VPN → frame, faults included',
      tasks: [
        'Translate `0x7f3a_b2c4_1000` by hand through all four levels; verify frame + offset.',
        'Prime the TLB, then re-translate: count the memory reads saved (4 → 0).',
        'Touch a lazily-allocated page: watch the minor fault install a frame with zero I/O.',
        'Fork the process and write one page: watch COW copy exactly that page.',
        'Fill physical memory and force a swap-out; time the major fault on re-access.',
      ],
      note: `Everything on screen was the 1962 design working as intended: indirection for isolation, laziness for efficiency, faults as the control flow. The block-table walk in the PagedAttention paper is this diagram with "tokens" for "bytes" — you are now officially overqualified to read it.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'A 4-level page walk on x86-64 exists because…',
          options: [
            'Four levels are required by DDR5 timing',
            'A flat table for a 48-bit address space would need ~512 GB of entries per process; the radix tree is sparse — you only pay for mapped regions',
            'The TLB can only hold 4 entries',
            'It makes context switches cheaper',
          ],
          correct: [1],
          explanation:
            '2^36 pages × 8 B entries is untenable flat. The tree allocates lower levels on demand, so sparse address spaces cost a few KB of page tables. CR3 points at the root; the walk consumes the VPN 9 bits at a time.',
        },
        {
          q: 'The TLB\'s job is to…',
          options: [
            'Cache data bytes from DRAM',
            'Cache recent VPN→frame translations so most accesses skip the 4-level walk',
            'Buffer writes to disk',
            'Hold page-fault handlers',
          ],
          correct: [1],
          explanation:
            'Without it every load would cost 4 extra memory reads. With ~1k entries at 4 KB pages, TLB reach is a few MB — which is why huge pages (2 MB/1 GB) multiply reach 512× and why wide-stride access patterns thrash it.',
        },
        {
          q: 'Which of these is NOT a legitimate, non-error page fault?',
          options: [
            'First touch of a lazily allocated malloc region',
            'A write to a shared copy-on-write page after fork()',
            'A dereference of address 0x0',
            'First read of an mmap\'d file page',
          ],
          correct: [2],
          explanation:
            'NULL lives in a deliberately unmapped page — the kernel has no legitimate fix, so it delivers SIGSEGV. The others are the VM system working as designed: trap, fix the mapping, retry transparently.',
        },
        {
          q: 'Copy-on-write after fork() means…',
          options: [
            'The child gets a full private copy of all memory immediately',
            'Parent and child share frames read-only; only written pages are actually copied, at fault time',
            'All writes go to disk first',
            'The parent is suspended until the child exits',
          ],
          correct: [1],
          explanation:
            'COW makes fork() nearly free and keeps memory shared until it diverges. It is also exactly how vLLM forks a beam-search branch or shares a prompt prefix: same blocks, copy only the block being written.',
        },
      ],
    },
  ],
}

export default lesson
