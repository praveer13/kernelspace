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
            'GPUs have more cache',
            'CPUs spend transistors minimizing single-stream latency (OoO, speculation); GPUs spend them maximizing throughput (many simple in-order lanes)',
            'GPUs run at higher clock speeds',
            'CPUs cannot do floating point',
          ],
          correct: [1],
          explanation:
            'Everything else — caches, branch predictors, warp schedulers — follows from that allocation decision. Latency machine vs throughput machine.',
        },
        {
          q: 'Warp divergence means…',
          options: [
            'Warps migrating between SMs',
            'Lanes of a warp taking different branches, so the hardware serializes the paths with lanes masked off — throughput collapses toward the slowest path',
            'A warp exceeding its time slice',
            'Threads diverging to different GPUs',
          ],
          correct: [1],
          explanation:
            'SIMT issues one instruction per warp. Branchy code executes BOTH sides with partial masks. Uniform control flow is the GPU programmer\'s first commandment.',
        },
        {
          q: 'GPUs hide HBM latency primarily by…',
          options: [
            'Branch prediction',
            'Huge L1 caches',
            'Keeping many warps resident per SM and switching to a ready warp at zero cost whenever one stalls on memory (occupancy)',
            'Higher memory clock speeds',
          ],
          correct: [2],
          explanation:
            'No speculation — oversubscription. Warp state lives in registers, so switching is free; with enough resident warps someone is always ready. The catch: you need thousands of independent threads of work.',
        },
        {
          q: 'Decode (single-token generation) underuses GPU compute because…',
          options: [
            'Transformers are too branchy',
            'Each step is a small matvec that re-reads all weights from HBM — bandwidth-bound with ALUs mostly idle, a latency problem on a throughput machine',
            'CUDA forbids batch 1',
            'The KV cache is too small',
          ],
          correct: [1],
          explanation:
            'FLOPs per byte is tiny during decode, so the roofline puts you on the bandwidth slope (T4.L3). Batching and speculative decoding exist to raise arithmetic intensity back toward the compute roof.',
        },
      ],
    },
  ],
}

export default lesson
