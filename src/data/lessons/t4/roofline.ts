import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't4.l3',
  slug: 'roofline',
  trackId: 't4',
  index: 3,
  title: 'The Roofline Model',
  minutes: 40,
  hook: 'Arithmetic intensity in, bound classification out: why decode is bandwidth-bound, prefill is compute-bound, and how to prove it in 4 lines of math.',
  exercise: 'sim',
  simId: 'sim-roofline',
  kcs: ['t4.bound-classification', 't4.ridge-point', 't4.decode-bandwidth'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Compute a chip\'s ridge point from its datasheet, and say what it tells you about a kernel.',
        model:
          'The ridge point is peak FLOP/s divided by memory bandwidth. An H100 at FP16 gives about 990 TFLOP/s over 3.35 TB/s, near 295 FLOP per byte. A kernel whose arithmetic intensity is below that is bandwidth-bound, and one above it is compute-bound.',
        ideas: [
          'Ridge point = peak FLOP/s divided by memory bandwidth',
          'For an H100 at FP16, about 990 TFLOP/s over 3.35 TB/s is near 295 FLOP per byte',
          'Intensity below the ridge means bandwidth-bound; above it, compute-bound',
        ],
        kcs: ['t4.ridge-point', 't4.bound-classification'],
      },
      {
        prompt: 'Explain why batch-1 decode sits far below the ridge, and what batching does about it.',
        model:
          'Each token re-reads every weight for about two FLOPs per parameter, so intensity is near one FLOP per byte, hundreds of times below the ridge, and speed is bandwidth divided by weight bytes. A batch of N sequences shares one weight read, so intensity rises about N-fold toward the ridge.',
        ideas: [
          'Each token re-reads all the weights for about two FLOPs per parameter, so intensity is near one',
          'Speed is memory bandwidth divided by weight bytes, with compute idle',
          'A batch of N shares one weight read, so intensity rises about N-fold toward the ridge',
        ],
        kcs: ['t4.decode-bandwidth'],
      },
    ],
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'numeric',
          q: 'An H100 peaks near 990 TFLOP/s at FP16 and moves 3.35 TB/s from HBM. Divide one by the other: what arithmetic intensity is its ridge point?',
          unit: 'FLOP/byte',
          truth: 295,
          okWithinFactor: 1.15,
          revealAt: 'The three numbers and one division',
          kcs: ['t4.ridge-point', 't4.bound-classification'],
          claims: ['hw.h100-sxm.bf16-dense', 'hw.h100-sxm.hbm-bw'],
        },
        {
          kind: 'choice',
          q: 'An H100 decodes a batch of 16 sequences and the step is bandwidth-bound. The batch grows to 32. What happens to the tokens per second each user gets?',
          options: [
            'It roughly doubles, with twice as many sequences meaning twice the work done per user each step',
            'It stays roughly the same, with each step still reading the weights once for the whole batch',
            'It roughly halves, with the users now sharing one memory bandwidth in equal parts',
          ],
          correct: [1],
          why: [
            'Batching serves more users per step; it does not make a step shorter. The step is set by reading the weights, which costs the same for 16 or 32 sequences, so each user\'s rate stays put.',
            'Right: the weights are read once per step whatever the batch, so a bandwidth-bound step takes about the same time and each user still gets a token per step. Total throughput doubles.',
            'The weights are shared, not divided: one read feeds every sequence. Only the KV cache grows with the batch, and at ordinary context lengths it is the smaller read, so each user loses little.',
          ],
          revealAt: 'The two case studies that run T5',
          kcs: ['t4.decode-bandwidth'],
        },
      ],
    },
    {
      type: 'prose',
      md: `"Is this kernel compute-bound or memory-bound?" is the most useful question in performance engineering, and most engineers answer it by vibes. The **roofline model** answers it with arithmetic: two hardware numbers, one workload number, one division. It's the single most-used analysis in GPU work, the reason T0.L1 could claim "decode is bandwidth-bound" with a straight face — and after this lesson you will be able to classify any workload on any chip in about a minute, on a napkin.

The model (Williams, Waterman, Patterson, 2009): a kernel's performance is limited by whichever runs out first — the chip's peak **compute** or its peak **memory bandwidth**. Plot both limits against **arithmetic intensity** (FLOPs per byte moved) and you get a roof-shaped ceiling: a sloped bandwidth wall on the left, a flat compute ceiling on the right.`,
    },
    {
      type: 'prose',
      md: `## The three numbers and one division

**Arithmetic intensity (AI)** = \`FLOPs executed / bytes moved from DRAM\`. It is a property of the *kernel and its data layout*, not of the chip. The **ridge point** of the machine is \`peak_FLOPs / peak_bandwidth\` — the AI at which the two limits meet. On an H100 in FP16: \`~990 TFLOPS / 3.35 TB/s ≈ 295 FLOP/byte\`. (For FP8: ~2× that.)

- \`AI < ridge\` → **bandwidth-bound**: attainable performance = \`AI × bandwidth\`. More FLOPs won't help; *fewer bytes or more bytes/second* will.
- \`AI > ridge\` → **compute-bound**: attainable = \`peak FLOPs\`. Bandwidth is irrelevant; better math (tensor cores, lower precision) is the only lever.

\`\`\`text
attainable_perf = min( peak_FLOPs , AI × peak_bandwidth )
\`\`\`

That's the whole model. The craft is computing AI honestly — the bytes are *moved* bytes (cache misses, not loads), which is why tiling (T4.L6) raises AI and why the roofline is really a *cache-efficiency* model in disguise.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — the roof: bandwidth slope meets compute ceiling',
      height: 54,
      nodes: [
        { id: 'slope', x: 2, y: 30, w: 40, h: 8, label: 'perf = AI × BW', sub: 'memory-bound region', color: '#5CA8FF' },
        { id: 'roof', x: 56, y: 6, w: 40, h: 8, label: 'perf = peak FLOPs', sub: 'compute-bound region', color: '#A78BFA' },
        { id: 'ridge', x: 44, y: 16, w: 12, h: 10, label: 'ridge', sub: '~295 F/B', color: '#3EF2A4' },
        { id: 'decode', x: 6, y: 44, w: 26, h: 8, label: 'decode · AI ≈ 0.5–4', sub: 'bandwidth wall', color: '#FB7185' },
        { id: 'prefill', x: 64, y: 44, w: 30, h: 8, label: 'prefill/matmul · AI ≈ 100+', sub: 'at the compute roof', color: '#3EF2A4' },
      ],
      edges: [
        { from: 'slope', to: 'ridge' },
        { from: 'ridge', to: 'roof' },
        { from: 'decode', to: 'slope' },
        { from: 'prefill', to: 'roof' },
      ],
      steps: [
        { caption: 'Left of the ridge, the bandwidth slope rules: performance is AI × 3.35 TB/s, period. The ALUs are starved.', active: ['slope'] },
        { caption: 'Right of the ridge, the flat roof: you\'re doing enough math per byte that FLOPs, not bandwidth, are the binding constraint.', active: ['roof'] },
        { caption: 'DECODE lives far left: generating a token re-reads all weights (~16 GB for 8B FP16) for only ~2 FLOPs/param/token at batch 1 → AI ≈ 0.5–4. Hard against the bandwidth wall: ~5 ms/token is physics, not engineering.', active: ['decode'] },
        { caption: 'PREFILL and big-batch matmul live at the roof: each weight participates in hundreds of MACs (batch × seq), AI ≈ 100–1000+. This is why prefill and decode have different economics, metrics (TTFT vs ITL), and optimizations.', active: ['prefill'] },
      ],
      predictAt: {
        step: 2,
        prompt: 'Batch-1 decode of an 8B FP16 model re-reads about 16 GB of weights for each token, doing about 16 GFLOP of math. Where does it land on the roofline?',
        options: [
          'Far left on the bandwidth slope, hundreds of times below the ridge, with compute units mostly idle',
          'Just left of the ridge, nearly balanced, with a little more batching enough to make it compute-bound',
          'At the compute roof, with the dense matrix math of each layer keeping the tensor cores busy',
          'Far right of the ridge, with each weight read once and then reused for the tokens that follow',
        ],
        correct: [0],
        why: [
          'Right: 16 GFLOP over 16 GB is about 1 FLOP per byte, against a ridge near 295, so decode sits about 300 times to the left. The memory system, not the ALUs, sets the speed.',
          'Near-balanced would need around 300 FLOP per byte. Decode does about 1, two orders of magnitude from the ridge, and a little batching cannot close that gap.',
          'Dense matrix math reaches the roof only when each weight serves many tokens, as in prefill. At batch 1 each weight serves one token, so the roof is out of reach.',
          'Weights are re-read from HBM for every token generated, and 16 GB does not stay in any cache. Reuse across tokens exists only when tokens are batched together.',
        ],
        kcs: ['t4.decode-bandwidth', 't4.bound-classification'],
      },
    },
    {
      type: 'statline',
      stats: [
        { value: '~295 F/B', label: 'H100 ridge (FP16)', hint: '990 TFLOPS ÷ 3.35 TB/s. Below this AI you are buying bandwidth; above it, math.' },
        { value: '≈1 FLOP/B', label: 'decode AI @ b=1', hint: '2 FLOPs per parameter per token ÷ 2 bytes per FP16 weight. The wall.' },
        { value: '~1000+', label: 'big matmul AI', hint: 'Each weight reused batch×seq times — deep compute territory.' },
        { value: '×N', label: 'batch lever', hint: 'Batching N sequences multiplies decode AI by N — weights amortized across the batch.' },
      ],
    },
    {
      type: 'prose',
      md: `## The two case studies that run T5

**Decode, batch 1, 8B FP16 model.** Per token: \`~2 FLOPs × 8e9 params = 16 GFLOPs\` of math against \`~16 GB\` of weight reads (plus KV). AI ≈ 1 FLOP/byte — *300× below* the ridge. Attainable rate = \`3.35 TB/s ÷ 16 GB ≈ 200 tokens/s\` — the ALUs could do the math in microseconds; the memory system takes 5 ms. **This is the entire economics of chat inference.** And now the levers announce themselves: **batching** (N sequences share each weight read → AI × N → the single most important throughput lever), **quantization** (FP8/INT4 cuts bytes per weight 2–4× → directly multiplies the rate, T4.L7), **speculative decoding** (verify K drafted tokens per weight read → AI × K, T5.L8).

**Prefill.** Processing a 2k-token prompt: each weight participates in \`2 × seq_len\` FLOPs (once per token position), so AI ≈ seq_len × (params/bytes) ≈ thousands — far right of the ridge. Prefill is **compute-bound**: it saturates tensor cores beautifully, and its time (TTFT) scales with FLOPs, not bytes. This is also why **chunked prefill** (mixing prefill chunks into decode batches) is a throughput optimization: it backfills the decode batch's idle ALUs with compute-bound work. Different roof, different medicine.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The roofline is your **Little's Law moment** — the simple queueing formula that answers "why is the system slow: arrivals or service time?" in one division. AI plays the role of utilization: below the ridge, the system is I/O-bound (your classic "the DB is the bottleneck" service); above it, CPU-bound. And like Little's Law, the roofline won't tell you *how* to fix it — it tells you which half of the machine to stop optimizing. That alone kills half the bad ideas in any perf review.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Three honesty checks before quoting a roofline. **(1)** Count *DRAM* bytes, not logical loads — L2 hits change the denominator (tiling's entire purpose). **(2)** Use the *right* peak: vendor TFLOPs assume tensor-core MMA with perfect pipelining; your kernel's real ceiling may be 60% of that. **(3)** The model ignores latency: at small sizes, kernels are *latency/occupancy-bound* below both roofs (launch overheads, too few warps — T4.L4). Roofline classifies regimes; it doesn't model everything.`,
    },
    {
      type: 'prose',
      md: `## The graded pass: Fleet kernels on a B200

Architecture knowledge becomes performance engineering only when you write the numbers down **before** touching the implementation. The playground gives you the Fleet engine's kernel table, but the two columns that matter, arithmetic intensity and the binding roof, are yours to work out.

The B200 worksheet uses one GPU at dense FP16: **2.25 PFLOP/s** and **8 TB/s HBM3e**, derived from NVIDIA's eight-GPU [HGX B200 compute specification](https://www.nvidia.com/en-us/data-center/hgx/) and [DGX B200 memory-bandwidth specification](https://www.nvidia.com/en-us/data-center/dgx-b200/). Your first check is therefore the machine ridge; do the division rather than trusting this paragraph.

| Fleet kernel | Work | HBM traffic | You predict |
|---|---:|---:|---|
| router scoring | 0.12 GFLOPs | 0.08 GB | AI, then the side of the ridge |
| 70B decode, batch 32 | 4,480 GFLOPs | 140 GB | AI, then the side of the ridge |
| paged attention | 2,048 GFLOPs | 8 GB | AI, then the side of the ridge |
| 70B prefill, 512 tokens | 71,680 GFLOPs | 140 GB | AI, then the side of the ridge |

The units are deliberately paired: \`GFLOPs / GB = FLOPs / byte\`. Predict each row's intensity as a number in the task panel, then press \`place … on B200\` to plot the kernel on the B200 roofline, and name the side of the ridge it lands on in the explain step. A regime label without the numeric AI is not a prediction. Notice the near-ridge case: being "a lot of math" is not the same as being compute-bound.`,
    },
    {
      type: 'callout',
      variant: 'info',
      md: `Use the order a performance review expects: **hypothesis → model → measure → explain**. First predict the roof from FLOPs and DRAM bytes. Then measure the real kernel. If the point lands far below its predicted ceiling, investigate occupancy, launch latency, synchronization, or uncoalesced traffic; do not silently rewrite the model after seeing the result.`,
    },
    {
      type: 'prose',
      md: `## In the playground

The simulator is a live roofline: predict and place each row of the B200 table, then sweep batch size and precision and watch decode slide along the bandwidth slope while prefill pins itself to the roof. Compute each workload's AI yourself first — the point is to leave with the napkin skill, not the chart.`,
    },
    {
      type: 'exercise',
      simId: 'sim-roofline',
      machine: 'roofline',
      title: 'Roofline playground',
      taskIds: [
        'roof.ridge',
        'roof.fleet-router',
        'roof.fleet-decode',
        'roof.fleet-paged-attn',
        'roof.fleet-prefill',
        'roof.decode-bound',
        'roof.batch-to-ridge',
        'roof.fp8-ridge',
      ],
      config: { m: 'H100', dtype: 'fp16', batch: 1 },
      tasks: [
        'Predict the B200 FP16 ridge from its datasheet numbers (2.25 PFLOP/s, 8 TB/s), then pick B200 in the simulator and compare. Submit the number, not a regime label.',
        'Predict the arithmetic intensity of each of the four Fleet kernel rows from its GFLOP and GB, then place each on the B200 and say which side of the ridge it lands on.',
        'Predict whether decode at batch 1 on the H100 is bandwidth-bound or compute-bound, then plot decode and read the result off the chart.',
        'Predict which batch size first lifts decode to the ridge on the H100 at FP16, then sweep the batch slider and find the knee.',
        'Predict the H100 ridge at the FP8 ceiling, then switch the precision ceiling and compare; try INT4 and note the decode rate multiplies.',
        'Plot prefill (seq 2048) and confirm it sits at the compute roof; explain TTFT in FLOPs terms.',
      ],
      note: `You have now derived, from two hardware numbers, why batching is the king lever, why quantization is a bandwidth multiplier, why prefill and decode need different metrics, and where chunked prefill comes from. T5 assumes you can do this arithmetic in your head.`,
    },
    {
      type: 'field-note',
      title: 'Taming the Throughput–Latency Tradeoff with Sarathi-Serve',
      source: 'Agrawal et al.',
      href: 'https://arxiv.org/abs/2403.02310',
      published: "OSDI '24",
      verified: '2026-08',
      md: `Sarathi-Serve turns the roofline into a scheduler. A large prefill chunk can occupy the compute roof while many one-token decodes contribute little marginal work; chunking controls how long that compute-heavy guest stalls inter-token latency. Read its decode-maximal batches as a resource-packing argument: arithmetic intensity explains why the combination is efficient, while tail-SLO measurements decide how large a chunk is safe.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Arithmetic intensity is defined as…',
          options: [
            'Peak FLOPs per second divided by peak bytes per second for the chip and a fixed number per part',
            'FLOPs executed per byte moved from main memory and set by the kernel and its data layout',
            'FLOPs executed per byte the kernel loads and counting each load whether it hits cache or goes to memory',
            'Floating-point instructions issued per clock cycle on one multiprocessor as a measure of how busy the arithmetic units are',
          ],
          correct: [1],
          explanation:
            'AI measures reuse: how much math each fetched byte supports. High AI amortizes the memory system; low AI starves the ALUs. It\'s computed against actual DRAM traffic, so caches/tiling raise it.',
          why: [
            'That is the ridge point, a property of the machine. AI belongs to the kernel; the ridge is the AI at which the two limits meet.',
            'Right: AI divides the work done by the bytes actually moved from DRAM. It depends on the kernel and its layout, not on the chip.',
            'Logical loads overstate traffic. AI counts bytes that reach DRAM, so cache hits change the denominator, which is why tiling raises AI.',
            'That is an issue rate or utilization, which has time in it. AI divides work by data moved and has no clock term.',
          ],
          kcs: ['t4.bound-classification'],
        },
        {
          q: 'On an H100 (~990 FP16 TFLOPS, 3.35 TB/s), a kernel with AI = 1 FLOP/byte is…',
          options: [
            'Compute-bound, with tensor cores running at the 990 TFLOP/s peak however many bytes the kernel moves',
            'Bandwidth-bound, with attainable performance near 3.35 TFLOP/s and the compute units sitting idle',
            'Latency-bound, with 1 FLOP per byte leaving too little math to cover the delay of each load',
            'Near the ridge, which sits at about 1 FLOP per byte on any modern GPU and balances compute against bandwidth',
          ],
          correct: [1],
          explanation:
            'The ridge is ~295 F/B; AI=1 is 300× left of it. Performance is the bandwidth slope: AI × BW. This is batch-1 decode — the physics floor behind the 5 ms/token number.',
          why: [
            'Peak applies only above the ridge, near 295 FLOP/byte. Below it attainable performance is AI × bandwidth, and AI = 1 is far below.',
            'Right: the ridge is about 295 FLOP/byte, so AI = 1 sits far left on the slope. Attainable is AI × bandwidth, a fraction of one percent of peak.',
            'The roofline classifies by AI against the ridge, and 1 is far left: bandwidth. Latency effects such as too few warps sit under both roofs and are separate.',
            'The ridge is peak FLOPs over peak bandwidth, about 295 FLOP/byte at FP16 on this H100. One FLOP per byte is about 300 times to the left.',
          ],
          kcs: ['t4.bound-classification', 't4.ridge-point'],
        },
        {
          q: 'Why does batching multiply decode throughput (up to a point)?',
          options: [
            'Attention keys are shared across the batch and that shrinks the bytes of key-value cache moved per token',
            'Each weight read from memory serves N sequences and that raises intensity N-fold along the slope',
            'Batching removes per-token kernel launches and launch overhead is what keeps decode below the compute roof',
            'Larger batches raise the usable memory bandwidth and more concurrent requests keep more channels busy',
          ],
          correct: [1],
          explanation:
            'Weights dominate decode bytes; serving N sequences per weight read raises AI by N. The "knee" arrives when AI crosses the ridge and you become compute-bound — the batch-size sweet spot every engine hunts.',
          why: [
            'Every sequence has its own KV cache, so KV bytes grow with batch size. The gain comes from weights, which the whole batch reads together once.',
            'Right: weights dominate decode bytes, and one read now feeds N sequences. FLOPs grow N-fold on the same bytes, so AI rises N-fold.',
            'Launch overhead is a small fixed cost next to weight reads. The large effect is amortizing the weight read across sequences, which raises AI.',
            'Peak bandwidth is a hardware limit near 3.35 TB/s. Batching does not raise it; it extracts more FLOPs from each byte that moves.',
          ],
          kcs: ['t4.decode-bandwidth'],
        },
        {
          q: 'A B200 has 2.25 PFLOP/s dense FP16 compute and 8 TB/s HBM bandwidth. A kernel with AI = 256 FLOP/byte is…',
          options: [
            'Compute-bound with 256 FLOP/byte well above what decode or router kernels reach',
            'Bandwidth-bound with a ridge near 281 FLOP/byte and 256 still on the slope below it',
            'At the ridge with 256 within about 10% of 281 FLOP/byte and too close for the model to separate',
            'Unclassifiable at 256 FLOP/byte without a timed run showing which limit the kernel hit',
          ],
          correct: [1],
          explanation:
            'The machine ridge is 2,250 TFLOP/s ÷ 8 TB/s = 281.25 FLOP/byte. Classification is a comparison, not a vibe: 256 < 281.25, so bandwidth is still the modeled ceiling.',
          why: [
            'Large in absolute terms is not the test. The ridge is 2,250 TFLOP/s over 8 TB/s, about 281 FLOP/byte, and 256 is below it.',
            'Right: the ridge is 2,250 / 8 = 281.25 FLOP/byte, and 256 is under it, so the bandwidth term is the smaller one in the min().',
            'The model is a strict comparison. Below the ridge, AI × bandwidth is the smaller term, so the modeled ceiling is bandwidth even when close.',
            'The roofline is a prediction from FLOPs and DRAM bytes made before any run. Measurement then tests it; it is not needed to classify.',
          ],
          kcs: ['t4.ridge-point', 't4.bound-classification'],
        },
        {
          q: 'Prefill is compute-bound while decode is bandwidth-bound because…',
          options: [
            'Prefill multiplies larger weight matrices than decode and larger matrices carry more FLOPs per byte at any token count',
            'Prefill reuses each weight across the prompt and grows intensity with length while decode rereads it per token',
            'Decode runs on a separate disaggregated pool of slower devices and that hardware gap pushes it left of the ridge',
            'Prefill skips the key-value cache write and that removes the memory traffic that keeps decode below the roof',
          ],
          correct: [1],
          explanation:
            'Same weights, different reuse. The roofline classifies them into different regimes — hence TTFT (compute-limited) vs ITL (bandwidth-limited) metrics and different optimization playbooks (chunked prefill vs quantization/speculation).',
          why: [
            'The weight matrices are the same size in both phases. What differs is how many token positions share each weight read: many in prefill, one in decode.',
            'Right: same weights, different reuse. In prefill each weight serves every prompt position, so AI grows with sequence length; at batch 1, decode reads them all for one token.',
            'Disaggregation can split phases across GPUs, but the regimes come from reuse, not hardware. One chip is compute-bound in prefill and bandwidth-bound in decode.',
            'Prefill does write the KV cache for the whole prompt. KV traffic is minor; the dominant effect is weight reuse across positions.',
          ],
          kcs: ['t4.bound-classification', 't4.decode-bandwidth'],
        },
      ],
    },
  ],
}

export default lesson
