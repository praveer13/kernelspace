import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't4.l2',
  slug: 'gpu-memory',
  trackId: 't4',
  index: 2,
  title: 'GPU Memory Hierarchy',
  minutes: 20,
  hook: 'HBM, L2, shared memory/SRAM, registers — the steeper ladder that every serious kernel climbs, and where the KV cache lives.',
  exercise: 'sim',
  simId: 'sim-roofline',
  blocks: [
    {
      type: 'prose',
      md: `T0 gave you the CPU ladder: registers → L1 → L2 → L3 → DRAM, with ~0.5 ns at the top and ~100 ns at the bottom. The GPU has the same ladder — **steeper at every step**. More compute to feed, more bandwidth needed, more explicit programmer control. The deep difference from CPUs: the fastest tier you actually *manage* — **shared memory** — is a programmer-addressable scratchpad, not a hardware-managed cache. GPU performance work is, in large part, the art of staging data through that scratchpad by hand.

This lesson is the map. T4.L3 (roofline) prices it; T4.L6 (tiling) weaponizes it.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '256 KB', label: 'registers / SM', hint: '64K × 32-bit registers per SM on H100 — the fastest memory on the chip.' },
        { value: '228 KB', label: 'shared mem / SM', hint: 'Programmer-managed SRAM per SM (H100); ~20–30× faster than HBM; block-scoped.' },
        { value: '~50 MB', label: 'L2 (H100)', hint: 'Shared across SMs; the KV cache\'s second home.' },
        { value: '80 GB · 3.35 TB/s', label: 'HBM3 (H100)', hint: 'Where weights and KV cache live; the wall decode runs into.' },
      ],
    },
    {
      type: 'prose',
      md: `## The ladder, tier by tier

**Registers** (~256 KB per SM, 64K 32-bit registers): per-thread, zero-latency-ish, allocated at compile time. Run out and the compiler *spills* to local memory — which is secretly HBM, so spills are silent bandwidth leaks. (T1's stack, but the spill goes to the slow tier.)

**Shared memory / SRAM** (~228 KB per SM on H100, configurable split with L1): the signature GPU feature. A block of threads (up to 1024) shares this scratchpad *explicitly*: the kernel loads a tile from HBM into shared memory, synchronizes the block, then computes from SRAM at ~20–30× HBM's per-SM bandwidth. Every fast kernel you've heard of — tiled matmul, FlashAttention — is a choreography of this staging.

**L2** (~50 MB, shared across the whole GPU): the mediator between SMs and HBM, and deeply relevant to serving: hot KV blocks and hot weights can live here between steps.

**HBM** (80 GB at 3.35 TB/s on H100): stacked DRAM sitting on the same package as the die — 5× the bandwidth of server DDR, at datacenter prices. This is where a 70B model's weights (140 GB in FP16 → 2 GPUs) and every sequence's KV cache live. When T5 says "the KV cache dominates HBM," this is the number being dominated.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — the steep ladder: per-SM tiers vs shared tiers',
      height: 52,
      nodes: [
        { id: 'sm0', x: 2, y: 6, w: 20, h: 12, label: 'SM 0', sub: 'reg 256KB · smem 228KB' },
        { id: 'sm1', x: 2, y: 24, w: 20, h: 12, label: 'SM 1', sub: 'reg 256KB · smem 228KB' },
        { id: 'sm2', x: 2, y: 42, w: 20, h: 12, label: 'SM …131', sub: '×132 total' },
        { id: 'l2', x: 34, y: 20, w: 24, h: 14, label: 'L2 · ~50 MB', sub: 'shared, all SMs', color: '#A78BFA' },
        { id: 'hbm', x: 70, y: 20, w: 26, h: 14, label: 'HBM · 80 GB', sub: '3.35 TB/s', color: '#3EF2A4' },
        { id: 'cpu', x: 70, y: 42, w: 26, h: 10, label: 'CPU RAM (PCIe)', sub: '~64 GB/s · the offload tier', color: '#FFB224' },
      ],
      edges: [
        { from: 'sm0', to: 'l2' },
        { from: 'sm1', to: 'l2' },
        { from: 'sm2', to: 'l2' },
        { from: 'l2', to: 'hbm' },
        { from: 'hbm', to: 'cpu' },
      ],
      steps: [
        { caption: 'Each SM owns registers and shared memory outright — other SMs can\'t see them. Fast because local; small because SRAM.', active: ['sm0', 'sm1', 'sm2'] },
        { caption: 'L2 sits between every SM and HBM: hot weights/KV blocks get second chances here. Cross-SM communication (atomics, block cooperation) also flows through it.', active: ['l2'], edges: ['sm0->l2', 'l2->hbm'] },
        { caption: 'HBM: the 80 GB main stage. Weights stream from here every forward pass; the KV cache grows here every decode step. 3.35 TB/s sounds like a lot until 16 GB of weights must move per token.', active: ['hbm'], edges: ['l2->hbm'] },
        { caption: 'Below HBM, the cliff: CPU RAM over PCIe at ~64 GB/s — 50× slower. This is where KV offload and model streaming go, and V0 could use it as a swap tier for preempted sequences (V1 recomputes instead; T2.L3). Offload decisions are expensive.', active: ['cpu'], edges: ['hbm->cpu'] },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Map it to what you know: **registers ≈ CPU registers**, **shared memory ≈ an L1 you manage yourself** (imagine if Java made you evict/populate L1 by hand — annoying, but *predictable*: no mystery evictions mid-kernel), **L2 ≈ L3**, **HBM ≈ DRAM**, **CPU RAM over PCIe ≈ swap** (complete with the 50× cliff). The CUDA programming model is "the memory hierarchy, but the fast tiers are your explicit responsibility." Data-parallel people: this is also why Spark shuffle vs broadcast decisions look the way they do — small hot data belongs in the fast, local tier, by hand.`,
    },
    {
      type: 'prose',
      md: `## Why capacity is the serving bottleneck

One arithmetic preview of T5 (full math in T5.L4). A 70B FP16 model: **140 GB of weights** — already 2 GPUs before a single request. Per request, the KV cache grows \`2 × layers × kv_width × bytes\` per token. Take a 70B-class model with full multi-head attention (80 layers, 8192 wide, no GQA): that's **~2.6 MB per token in FP16** — a 4k-token conversation eats ~10 GB. Ten such conversations and an 80 GB H100 is *full of cache*, weights elsewhere. Real Llama-3-70B uses GQA with 8 KV heads (1024 wide), which cuts this 8× to **320 KB per token** (T5.L4); the bottleneck is the same, only the headcount of conversations moves. Capacity, not compute, caps concurrent requests; bandwidth, not FLOPs, caps tokens/s. The GPU memory hierarchy isn't background knowledge for serving — it **is** serving.`,
    },
    {
      type: 'exercise',
      simId: 'sim-roofline',
      machine: 'roofline',
      title: 'Tier probe: where does your data live?',
      tasks: [
        'Run a kernel reading 4 KB per block from shared memory vs direct from HBM: measure about 6× on H100 (the ratio varies with the selected GPU\'s HBM bandwidth).',
        'Force register spilling (raise per-thread arrays); watch effective bandwidth collapse to HBM speeds.',
        'Sweep working-set size across 228 KB / 50 MB / 80 GB: find the L2 and HBM cliffs.',
        'Measure a PCIe transfer (CPU→GPU) and compare with HBM streaming: the 50× offload cliff.',
      ],
      note: `The cliffs you measured are the design constraints of every kernel and every serving system: fast tiers are small and local; the big tier is shared and far; below it, the PCIe abyss. Tiling (T4.L6) exists to keep working sets in the top of this ladder.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Shared memory on a GPU differs from a CPU L1 cache in that…',
          options: [
            'It behaves like a slower, larger L1, filled and evicted by the hardware as threads touch addresses',
            'It is programmer-managed: the kernel stages tiles in and out explicitly, scoped to one block',
            'It is one pool visible to every SM, so blocks on different SMs can exchange data through it in a kernel',
            'It holds read-only data such as constants and instructions, which the hardware prefetches before launch',
          ],
          correct: [1],
          explanation:
            'An addressable scratchpad, not a cache: you control what lives there and when. That predictability is what makes tiled matmul and FlashAttention\'s choreography possible.',
          why: [
            'Shared memory is on-chip SRAM with L1-class latency, not a slower cache, and nothing fills it automatically. Only the kernel\'s own stores put data there.',
            'Right: it is an addressable scratchpad. The kernel decides what to stage and when, it is visible to one block, and no hardware eviction surprises it mid-kernel.',
            'Shared memory is per SM and scoped to a block. Other SMs cannot see it, so cross-block exchange goes through L2 and global memory.',
            'Constants live in a separate constant space and instructions in their own cache. Shared memory is general read-write scratch for one block.',
          ],
        },
        {
          q: 'Register spilling is dangerous to kernel performance because…',
          options: [
            'The compiler aborts with a register-allocation error, so the kernel never launches and the problem is caught early',
            'Spilled values go to local memory, which is backed by device memory, so a fall off the fastest tier silently costs bandwidth',
            'Spilled values move into shared memory, which is slower than registers but still on-chip, so the cost stays small',
            'Each spilled register halves the number of warps that fit on an SM, so latency hiding collapses first',
          ],
          correct: [1],
          explanation:
            'Per-thread arrays or too many live values overflow the 255-register budget; the overflow silently lands in local memory, which lives in device memory. Compiler warnings about spills are bandwidth warnings.',
          why: [
            'Spilling is not an error. The compiler succeeds silently, and only verbose compiler statistics or a profiler show the extra loads and stores.',
            'Right: spills land in local memory, which sits in device memory and is reached through L1 and L2. The kernel falls off the fastest tier with no error.',
            'Spills go to local memory in device memory, not to the shared-memory scratchpad. Hits in L1 or L2 can be cheap, but heavy spilling still adds traffic.',
            'Spilling trades registers for memory traffic; if anything it lets more warps fit. The cost is extra loads and stores, not lost residency.',
          ],
        },
        {
          q: 'For a 70B FP16 model with full multi-head attention (no GQA), the first-order capacity problem on 80 GB GPUs is…',
          options: [
            'The roughly 50 MB L2 cannot hold the weights, so each step thrashes it and compute caps how many requests run',
            'Weights need two GPUs, and each 4k-token KV cache adds ~10 GB, so capacity caps concurrency',
            'Tokenization and sampling run on the CPU, so the host becomes the limit long before GPU memory fills up',
            'Tensor cores compute in FP32, so the FP16 weights are upcast and double their footprint before any request',
          ],
          correct: [1],
          explanation:
            'Weights alone exceed one HBM; KV caches (~2.6 MB/token for MHA; Llama-3-70B\'s GQA is 8× smaller at 320 KB/token) consume the rest. This arithmetic is why quantization, multi-GPU parallelism, and KV paging are survival features, not optimizations.',
          why: [
            'Weights are never required to fit in L2; they stream from HBM each step. The binding limit is HBM capacity for weights plus KV caches.',
            'Right: 140 GB of FP16 weights already exceed one 80 GB GPU, and every active 4k-token sequence adds about 10 GB of KV. Capacity, not compute, caps concurrency.',
            'Host-side work per token is small. The 140 GB weight footprint exceeds one GPU before the first request arrives, so GPU memory binds first.',
            'H100 tensor cores take FP16 and BF16 inputs directly and accumulate at higher precision. Weights stay two bytes each; the 140 GB is the problem.',
          ],
        },
        {
          q: 'CPU RAM plays which role in the GPU serving stack?',
          options: [
            'A warm tier just under HBM that the GPU reads at near-HBM speed, so offloading KV blocks is nearly free',
            'The offload tier: about 50× lower bandwidth over PCIe, so offloaded KV blocks and streamed weights cost time',
            'A staging area for loading the checkpoint at startup; once weights sit in HBM, serving never touches it again',
            'The backing store for register spills, so spilled values land in host RAM and return at PCIe speed',
          ],
          correct: [1],
          explanation:
            'The hierarchy extends one more level down: HBM → PCIe → host RAM. V0\'s optional swap path was the OS swap story (T2.L3) running on this cliff; V1 recomputes instead, but KV offload and weight streaming still pay it — usable, but priced.',
          why: [
            'Host RAM sits across PCIe at about 64 GB/s against 3.35 TB/s for HBM, roughly 50 times slower. Offload works but is never free.',
            'Right: host RAM is the tier below HBM, reached over PCIe at roughly 50 times less bandwidth. KV offload and weight streaming use it and pay that price.',
            'Engines can also use host RAM during serving, for KV offload and weight streaming, accepting the PCIe cost. It is more than a load-time buffer.',
            'Register spills go to local memory in device memory through L1 and L2. The GPU never pages registers across PCIe into host RAM.',
          ],
        },
      ],
    },
  ],
}

export default lesson
