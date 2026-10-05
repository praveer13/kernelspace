import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l3',
  slug: 'prefill-vs-decode',
  trackId: 't5',
  index: 3,
  title: 'Inference vs Training; Prefill vs Decode',
  minutes: 20,
  hook: 'TTFT vs ITL — the two phases, the metrics that run the business, and why goodput is the only number that matters.',
  exercise: 'quiz',
  blocks: [
    {
      type: 'prose',
      md: `Training is a throughput problem: giant batches, backprop, days of saturated compute, no humans waiting. Inference is a **latency** business wrapped around a **throughput** business: a user is staring at a spinner (latency) while the provider counts tokens per GPU-hour (margin). Every design decision in serving is a negotiation between those two masters.

Within inference there are exactly two phases, and T4.L3 already classified them physically: **prefill** — process the prompt in one parallel pass, fill the KV cache, emit the first token — and **decode** — the autoregressive loop, one token per step. Two phases, two roofline regimes, two metrics, two SLAs. This lesson makes the economics precise.`,
    },
    {
      type: 'prose',
      md: `## The metrics, defined properly

- **TTFT (time to first token):** from request arrival to the first generated token. Driven by queue time + prefill compute (∝ prompt tokens, compute-bound) + any KV transfers (disaggregated setups, T5.L9). The user's "is it alive?" signal.
- **ITL / TPOT (inter-token latency / time per output token):** the decode loop's period per token — bandwidth-bound (∝ weight+KV bytes ÷ bandwidth, divided by batch efficiency). The user's "is it fast?" signal: streaming feels instant below ~50–80 ms/token and broken above ~200 ms.
- **Throughput:** tokens/s aggregate (the provider's margin) and its normalized form, **tok/s/GPU** or **tok/s/$**.
- **Goodput:** throughput *subject to SLOs* — e.g., requests/s with TTFT < 2 s and ITL < 100 ms. **The only honest capacity metric**: raw throughput numbers hide the latency collapse that produced them.

The phase split explains the product shape of every serving API you've used: why "time to first token" and "tokens per second" are reported separately, why long prompts are priced and limited differently from long generations, and why a 100k-token document takes seconds to *start* answering but then streams at a steady clip.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '∝ prompt × params', label: 'TTFT driver', hint: 'Prefill FLOPs scale with prompt length — compute-bound, tensor cores busy.' },
        { value: '∝ bytes/token', label: 'ITL driver', hint: 'Weight + KV reads per step ÷ HBM bandwidth — the roofline slope.' },
        { value: '<100 ms', label: 'ITL comfort', hint: 'Streaming feels responsive; human reading speed is ~50 ms/token.' },
        { value: 'goodput', label: 'the real KPI', hint: 'Throughput within SLO. Everything else is marketing.' },
      ],
    },
    {
      type: 'prose',
      md: `## The tension: batching buys throughput, costs latency

The provider's lever is batching (T4.L3: amortize weight reads across N sequences). But batching couples TTFT and ITL into a seesaw. Bigger decode batches: better utilization, cheaper tokens — and slower per-token time, because more KV cache is read per step and queues deepen. Every engine therefore runs an explicit trade: how much latency do we sell for throughput? The answers have names you'll meet in T5.L7–L8: **continuous batching** (fill the batch opportunistically, every iteration), **chunked prefill** (slice long prefills into decode-sized chunks so a 100k-token prompt doesn't stall everyone's ITL), and **disaggregation** (put prefill and decode on *different GPUs* entirely, because they want different batching and hardware).

Notice what just happened: a *systems scheduling* question (T2.L4) fell out of a physics classification (T4.L3) and became the product's SLA. That pipeline — physics → scheduler → SLA — is the whole field in one sentence.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You run this exact split in every web service: **prefill is the cold-start/DB query** (one expensive bounded operation before the first byte — compute-bound), **decode is the streaming response** (per-chunk cost dominated by I/O, here HBM instead of network). TTFT is your TTFB; ITL is your chunk period; and "goodput within SLO" is your p99-gated capacity planning. The seesaw is your thread-pool tuning: bigger pools (batches) raise throughput until queueing latency eats the gain. Same curve, hotter metal.`,
    },
    {
      type: 'callout',
      variant: 'info',
      md: `A quick estimation kit. TTFT ≈ queue + (prompt_tokens × 2 × params) / effective_FLOPs. ITL ≈ (weight_bytes + KV_bytes_per_token × batch) / bandwidth / batch … i.e., per-token time stays ~flat while throughput × batch — until the compute roof interrupts. These two lines get you within ~2× of any real system, which is enough to kill bad capacity plans in the meeting room instead of the postmortem.`,
    },
    {
      type: 'prose',
      md: `## Why inference is *not* "training, but smaller"

Three structural differences worth stating once. **(1) No backward pass:** inference is ~1/3 the FLOPs per token of training and needs no optimizer state or activations stored for backprop — but it *does* need the KV cache, which training never keeps. **(2) Latency binds:** training has no per-request SLO; inference's economics are SLO-shaped, which is why scheduling (T5.L7) is a first-class research area. **(3) Autoregression:** training sees all tokens at once (fully parallel); decode is inherently serial per sequence — the loop cannot be parallelized away, only made cheaper per step (quantization), amortized (batching), or shortened (speculative decoding). Keep these three and you'll never be confused by "just throw more GPUs at it" arguments again.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'TTFT and ITL are dominated by different physics because…',
          options: [
            'Prefill is limited by HBM bandwidth because the whole prompt must be loaded, while decode is limited by FLOPs because it runs the full model every token',
            'Prefill runs the prompt in parallel and is limited by tensor-core FLOPs, while each decode step reads weights and KV from HBM and is bandwidth-limited',
            'TTFT is almost entirely network and queue delay, so it is a deployment problem, and only ITL is governed by GPU physics such as compute and bandwidth limits',
            'Both phases are bandwidth-bound; they differ only in that prefill reads the prompt tokens and decode reads the generated ones one at a time',
          ],
          correct: [1],
          explanation:
            'Two roofline regimes: prefill sits at the compute roof, decode on the bandwidth slope. Hence separate metrics, separate optimizations, and increasingly separate GPUs (disaggregation).',
          why: [
            'This swaps the regimes. A long prompt gives each weight read thousands of tokens of math, so prefill is compute-bound; decode reuses each weight read for one token per sequence.',
            'Right: prefill amortizes each weight read over every prompt token and saturates the tensor cores, while decode does about one FLOP per byte moved and waits on HBM.',
            'Queueing and network add to TTFT, but prefill compute scales with prompt length and often dominates for long prompts. It is the same GPU roofline, not outside it.',
            'Decode is bandwidth-bound, but prefill is not: with thousands of prompt tokens per weight read, the arithmetic intensity is high enough that FLOPs set the limit.',
          ],
        },
        {
          q: 'Goodput is defined as…',
          options: [
            'Tokens per second per GPU at the largest batch memory allows, the ceiling that SLOs can approach but never exceed',
            'Throughput subject to SLO constraints, such as TTFT under 2 s and ITL under 100 ms, the honest capacity metric',
            'The fraction of GPU time spent in tensor-core math instead of waiting on memory, usually reported as MFU',
            'The share of requests that finish with a 200 status and a complete response, whatever their latency',
          ],
          correct: [1],
          explanation:
            'Raw throughput can always be bought by sacrificing latency; goodput measures what you can serve while keeping the user-facing promises. Capacity reviews should speak goodput.',
          why: [
            'Peak throughput is exactly the number that hides latency collapse: at the largest batch, ITL and TTFT usually break their SLOs. Goodput is what remains once they must hold.',
            'Right: goodput counts only the work delivered within the latency targets. Raising throughput by letting latency blow past the SLO adds nothing to it.',
            'That is utilization (MFU). A GPU can be highly utilized and still miss every latency target, so it says nothing about how much traffic is served within SLO.',
            'That is availability or success rate. A request that returns 200 after 30 seconds counts as a success there but is outside the SLO, so goodput excludes it.',
          ],
        },
        {
          q: 'The batching seesaw between TTFT/ITL and throughput exists because…',
          options: [
            'Larger batches must be padded to the longest sequence, so padding work grows with batch size, wastes compute on pad tokens, and slows every step',
            'Larger batches amortize each weight read over more sequences, raising throughput, but read more KV per step and deepen queues, raising per-token latency',
            'Batching runs the sequences in a batch one after another, so later sequences wait for earlier ones to finish generating and latency grows with batch size',
            'GPUs lower their clocks at sustained high utilization, so bigger batches run on throttled silicon, every step slows, and the extra work stops paying for itself',
          ],
          correct: [1],
          explanation:
            'Same trade as thread-pool sizing: utilization rises with concurrency until queueing and per-step work eat the latency budget. Engines pick a point on the curve; SLOs pick it for you.',
          why: [
            'Modern engines schedule per iteration and pack tokens without padding to a common length. Padding is not what slows large batches; extra KV reads and queueing are.',
            'Right: one weight read now serves more sequences, but each step also streams every sequence\'s KV and requests wait longer to be admitted, so per-token time rises.',
            'Sequences in a batch advance together, one token per step. Nobody waits for another sequence to finish generating; they share each step.',
            'Thermal throttling can happen but does not set the seesaw. The curve appears at constant clocks, from KV bytes per step and queue depth.',
          ],
        },
        {
          q: 'Decode cannot simply be "parallelized away" like training because…',
          options: [
            'Training spreads one step over thousands of GPUs, but a serving fleet is far smaller and simply has too few devices to spread a single token across the whole model',
            'Autoregression is serial and token t+1 needs token t, which leaves only cheaper steps by quantization, amortized steps by batching, or fewer steps by speculation',
            'Softmax over the context needs a global max and sum, forcing a serial pass over positions, which training sidesteps with a parallel approximation',
            'The KV cache must be appended in order, and thread blocks cannot write to HBM concurrently, so each step must finish writing before the next',
          ],
          correct: [1],
          explanation:
            'Training sees the full sequence in parallel; inference must generate it in order. Every decode optimization is one of those three shapes, a useful taxonomy for reading new papers.',
          why: [
            'More devices speed up the work inside one token (tensor parallelism) but cannot start token t+1 before token t exists. The dependency, not the device count, is the limit.',
            'Right: the next input is the previous output, so one sequence cannot be spread across steps. Steps can be made cheaper, shared across sequences, or reduced in number.',
            'Softmax reduces in parallel with the same kernels in training and inference. Nothing about it is sequential across positions or approximated in training.',
            'GPUs write to HBM from many thread blocks at once, and each step appends only one token\'s K/V per layer. Write ordering is not what serializes decode.',
          ],
        },
      ],
    },
  ],
}

export default lesson
