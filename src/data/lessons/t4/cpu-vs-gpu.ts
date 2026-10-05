import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't4.l1',
  slug: 'cpu-vs-gpu',
  trackId: 't4',
  index: 1,
  title: 'CPU vs GPU: Latency vs Throughput Machines',
  minutes: 20,
  hook: 'SIMT, warps, and the factory floor: why the GPU wastes no silicon on making ONE thing fast — and why that\'s perfect for matmul.',
  exercise: 'sim',
  simId: 'sim-roofline',
  blocks: [
    {
      type: 'prose',
      md: `A modern CPU core is a masterpiece of latency engineering: multi-issue out-of-order execution, branch prediction, speculative execution, huge caches — billions of transistors spent so that **one** instruction stream finishes sooner. A GPU takes the same transistor budget and spends almost none of it on latency. Instead: thousands of simple in-order lanes, tiny caches, and a scheduling philosophy that hides memory latency by *switching to other work* rather than predicting around it.

One sentence to carry through the whole track: **a CPU minimizes the latency of one task; a GPU maximizes the throughput of many.** Every architectural difference — and every reason LLM inference lives on GPUs — follows from that sentence.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '8–32', label: 'CPU cores', hint: 'Heavyweight, out-of-order, ~5 GHz, each a latency-optimized scalpel.' },
        { value: '132', label: 'SMs (H100)', hint: 'Streaming multiprocessors — each with 128 FP32 lanes, in-order.' },
        { value: '~16k', label: 'FP32 lanes (H100)', hint: 'Raw parallel width: thousands of simple ALUs instead of a few smart ones.' },
        { value: '32', label: 'threads per warp', hint: 'SIMT: one instruction issued across 32 lanes, lockstep.' },
      ],
    },
    {
      type: 'prose',
      md: `## SIMT and the warp: one instruction, 32 lanes

NVIDIA's execution model is **SIMT** — single instruction, multiple threads. You write code *as if* each thread were independent; the hardware bundles 32 threads into a **warp** and issues one instruction per cycle for the whole warp, each lane working on different data (SIMD with a thread abstraction). The consequences are immediate:

- **Divergence is punished.** If lanes of a warp take different branches, the hardware *serializes* the paths: both sides execute, each with half (or fewer) the lanes active. An \`if\` in GPU code is not free — it's a fork in the assembly line.
- **Memory access is warp-wide.** When lane 0..31 load consecutive addresses, the hardware *coalesces* them into one big transaction (T4.L4 is all about this). When they scatter, one instruction becomes 32 transactions. Your T0.L3 stride intuition applies directly — warps love unit stride.
- **Occupancy is the latency strategy.** With no branch prediction or speculation, a stalled warp (waiting on HBM) is simply *swapped out* for a resident warp with work ready — thousands of warps per SM make this cheap. The GPU doesn't avoid latency; it **over-subscribes** until latency stops mattering. This is the same trick as your I/O-bound thread pool, hardware-ized.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — the factory floor: warp scheduling hides HBM latency',
      height: 50,
      nodes: [
        { id: 'sm', x: 4, y: 6, w: 24, h: 38, label: 'SM', sub: 'warp scheduler' },
        { id: 'w0', x: 36, y: 4, w: 26, h: 8, label: 'warp 0 · executing', sub: '32 lanes busy', color: '#A78BFA' },
        { id: 'w1', x: 36, y: 16, w: 26, h: 8, label: 'warp 1 · waiting', sub: 'HBM ~400–800 cyc' },
        { id: 'w2', x: 36, y: 28, w: 26, h: 8, label: 'warp 2 · ready', sub: 'operands in registers' },
        { id: 'w3', x: 36, y: 40, w: 26, h: 8, label: 'warp 3 · ready', sub: '' },
        { id: 'hbm', x: 72, y: 16, w: 24, h: 14, label: 'HBM', sub: '3.35 TB/s', color: '#3EF2A4' },
      ],
      edges: [
        { from: 'sm', to: 'w0', label: 'issue' },
        { from: 'w1', to: 'hbm', label: 'load' },
        { from: 'sm', to: 'w2', label: 'switch (free)' },
      ],
      steps: [
        { caption: 'Warp 0 executes. Each SM can host dozens of warps; the scheduler picks a READY one every cycle — zero-cost switching because all state lives in registers already.', active: ['sm', 'w0'], edges: ['sm->w0'] },
        { caption: 'Warp 0 issues a load and stalls: HBM latency is ~400–800 cycles. On a CPU this would bubble the pipeline; here the scheduler simply switches to warp 2.', active: ['w1', 'hbm'], edges: ['w1->hbm', 'sm->w2'] },
        { caption: 'While warps rotate, HBM streams at full bandwidth. Utilization stays high WITHOUT speculation — the price is needing thousands of independent threads (parallel work) to keep the rotation full. That is why GPUs starve on serial workloads and feast on matmuls.', active: ['w2', 'w3', 'hbm'] },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You already run this trade-off: a **CPU core is a senior engineer** — brilliant at ambiguous serial work, terrible at being cloned 16,000 times. A **warp is a 32-person assembly line** — every worker does the same motion on different parts; if one worker needs a different motion (divergence), the line pauses for it. And **occupancy is your I/O-bound thread pool rule** — "threads must outnumber cores so a blocked thread never idles the core" — except the GPU does it in silicon with register files instead of the kernel scheduler.`,
    },
    {
      type: 'prose',
      md: `## Why LLMs live here

A transformer forward pass is, numerically, a sequence of enormous matrix multiplications and elementwise ops: millions of *independent* multiply-accumulates with identical control flow. That is the GPU's native diet — no divergence, streams of coalesced loads, endless warps to rotate. The CPU's genius (predicting the unpredictable) buys nothing on a matmul, and its small lane count caps it at ~1/50th the FLOPs.

But the asymmetry cuts both ways, and it explains serving economics: **prefill** (one big parallel matmul over the prompt) saturates a GPU like a dream; **decode** (one token at a time, tiny matvec per step, weights re-read from HBM each step) uses the ALUs pathetically — it is bandwidth-bound, exactly as T0.L1 previewed. The GPU is a throughput machine; decode gives it a latency-shaped problem. Everything clever in T5 — batching, speculative decoding, quantization — is an attempt to re-shape decode back into throughput work.`,
    },
    {
      type: 'exercise',
      simId: 'sim-roofline',
      machine: 'cpu-gpu',
      title: 'Latency machine vs throughput machine',
      taskIds: ['t-cpu-serial', 't-gpu-map', 't-gpu-divergence', 't-roof-occupancy'],
      config: { m: 'H100', accessPattern: 'coalesced', warps: 16, registers: 32 },
      tasks: [
        'Run the serial dependency chain on the CPU model vs GPU model: watch the CPU win by 50× (latency wins).',
        'Run the elementwise map over 64M floats: watch the GPU win by 50× (throughput wins).',
        'Introduce divergent branches into the GPU kernel: observe serialized paths cutting throughput.',
        'Vary warp count per SM (occupancy): find the point where HBM latency stops being hideable.',
      ],
      note: `Two wins, one rule: match the machine to the problem shape. Serial/branchy → CPU; parallel/uniform → GPU; and "parallel but tiny per step" (decode) → the GPU's weakness, which the whole of T5 works around.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The fundamental CPU vs GPU design difference is…',
          options: [
            'GPUs give each lane a much larger cache and avoid memory stalls without needing any other latency tricks',
            'CPUs spend transistors on single-thread latency while GPUs spend them on many simple in-order lanes',
            'GPUs run at higher clock speeds and finish a single instruction stream sooner than a CPU core',
            'CPUs lack wide floating-point hardware, so dense linear algebra needs a GPU to reach useful speed',
          ],
          correct: [1],
          explanation:
            'Everything else — caches, branch predictors, warp schedulers — follows from that allocation decision. Latency machine vs throughput machine.',
          why: [
            'GPU caches are tiny per lane. The GPU answer to memory latency is to run other warps while one waits, not to keep data close to a single stream.',
            'Right: the CPU spends its transistor budget on finishing one instruction stream sooner, the GPU on width. Caches, predictors and warp schedulers all follow from that split.',
            'GPU clocks sit below typical CPU clocks, so one GPU lane is slower on a single stream. It wins by running thousands of lanes at once.',
            'CPUs have SIMD vector units and run floating point fine. They have far fewer lanes, so their throughput on dense matmul is much lower.',
          ],
        },
        {
          q: 'Warp divergence means…',
          options: [
            'A warp overrunning its scheduler time slice and being preempted by another warp on the multiprocessor',
            'Lanes of a warp reading scattered addresses and splitting one load into many memory transactions',
            'Lanes of one warp taking different branches and running the paths in turn with idle lanes masked off',
            'Warps of one block finishing at different times and leaving the block waiting at a barrier',
          ],
          correct: [2],
          explanation:
            'SIMT issues one instruction per warp. Branchy code executes BOTH sides with partial masks. Uniform control flow is the GPU programmer\'s first commandment.',
          why: [
            'GPU warps are not time-sliced like OS threads. A warp stays resident on its SM until it finishes, and divergence concerns branches inside a warp.',
            'That is an uncoalesced access, a memory-system problem. Divergence is about control flow: lanes of one warp choosing different branches.',
            'Right: one instruction is issued per warp, so each side of a branch runs in turn with the other lanes masked off. Throughput falls toward the serialized total.',
            'That is barrier skew between warps, a different cost. Divergence happens inside one warp, whose lanes share one instruction stream and cannot take separate paths at once.',
          ],
        },
        {
          q: 'GPUs hide HBM latency primarily by…',
          options: [
            'Speculating past each load with branch prediction and issuing down the likely path',
            'Large first-level caches that turn most loads into hits and keep warps from stalling for long',
            'Keeping many warps resident and switching to a ready one for free whenever another stalls',
            'Clocking the memory faster than the cores and returning each load before the next instruction issues',
          ],
          correct: [2],
          explanation:
            'No speculation — oversubscription. Warp state lives in registers, so switching is free; with enough resident warps someone is always ready. The catch: you need thousands of independent threads of work.',
          why: [
            'That is the CPU strategy. GPU cores are in-order with no branch prediction or speculation; they cover latency by running other warps instead.',
            'L1 is small next to the weights and KV a decode step streams from HBM, and those mostly miss. Latency is covered by switching warps, not by hits.',
            'Right: warp state sits in registers, so the scheduler swaps in a ready warp every cycle at no cost. With enough resident warps, someone always has work.',
            'HBM latency stays at hundreds of cycles whatever the memory clock. A faster clock raises bandwidth; it cannot make a load return before the next instruction.',
          ],
        },
        {
          q: 'Decode (single-token generation) underuses GPU compute because…',
          options: [
            'Transformer layers are too branchy and warp divergence leaves most lanes masked off in single-token steps',
            'Each step is a matrix-vector product that rereads the weights from memory and bandwidth sets the speed',
            'One token gives too few threads to fill the multiprocessors and kernel launch overhead dominates each step',
            'The key-value cache is too small at batch size one to keep the tensor cores busy during attention',
          ],
          correct: [1],
          explanation:
            'FLOPs per byte is tiny during decode, so the roofline puts you on the bandwidth slope (T4.L3). Batching and speculative decoding exist to raise arithmetic intensity back toward the compute roof.',
          why: [
            'Transformer layers have uniform control flow: matmuls and elementwise ops. Divergence is not the problem; the ALUs idle while waiting for weights.',
            'Right: at batch 1 each weight is read once for about two FLOPs, so arithmetic intensity is near 1 and HBM bandwidth caps tokens per second.',
            'Launch cost is microseconds, while streaming the weights takes milliseconds per token. Overhead is real but secondary to the bandwidth wall.',
            'At short contexts the KV read is the smaller one. The weight read dominates, and the tensor cores wait on weights, not on attention.',
          ],
        },
      ],
    },
  ],
}

export default lesson
