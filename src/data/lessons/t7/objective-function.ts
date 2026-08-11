import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't7.l1',
  slug: 'objective-function',
  trackId: 't7',
  index: 1,
  title: 'The Objective Function: Goodput, SLOs, and Honest Metrics',
  minutes: 20,
  hook: 'Every previous track optimized something. This track defines the thing. One number the business understands, one curve the engineers argue with, and the reason "10,000 tok/s" on a benchmark page means nothing.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T5.L3 defined the metrics; this track operationalizes them. The serving business has exactly one objective function: **goodput — requests per second (or tokens per second) delivered within SLO**. Not throughput. Not utilization. Requests that meet their latency contract, per unit of cost. Everything in T7 is this function's derivatives.

Why the distinction is not pedantry: throughput curves are monotonic — more batch, more tokens, always. Latency curves are not — more batch, more queueing, and past the knee the p99 goes vertical. Raw "tok/s" benchmarks are taken *at* the vertical part, where every user has already left. Goodput forces the honest question: at what concurrency does the system stop meeting TTFT/TPOT — and what does that point cost?`,
    },
    {
      type: 'prose',
      md: `## The metrics, hardened

- **TTFT** (arrival → first token): queue + prefill (+ KV transfer when disaggregated). The "is it alive" signal. Production SLOs: Meta's app targets **<350 ms**; typical chat SLOs 0.5–2 s depending on prompt class.
- **TPOT/ITL** (per-token decode period): bandwidth ÷ (weight+KV bytes), divided by batch efficiency. The "is it fast" signal. Meta targets **<25 ms TTIT**; chat comfort is <50–80 ms.
- **E2E latency** and its percentiles: what the user feels; **p50 for design, p95/p99 for contracts**. Never one number.
- **Goodput**: throughput *subject to* the above — e.g. req/s with TTFT < 2 s AND TPOT < 100 ms. Capacity planning's only honest input.
- **Interactivity** (tok/s/user) vs **throughput** (tok/s/GPU): the two ends of the dial T7.L3 turns. Benchmarks that don't name which end they're showing are marketing.

The engine's control loop, one line: **batching couples TTFT and TPOT into a seesaw, and the SLO picks the operating point.** Your lab-06 scheduler is that sentence made executable — you implemented admission policy against this exact objective function.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '<350 ms', label: 'Meta TTFT SLO', hint: 'Production app target (Oct 2025 writeup).' },
        { value: '<25 ms', label: 'Meta TTIT SLO', hint: 'Per-token interactivity target — decode loop latency budget.' },
        { value: 'p95', label: 'the honest percentile', hint: 'Design at p50, contract at p95. Never one number.' },
        { value: 'goodput', label: 'the objective', hint: 'Requests within SLO per unit cost. Everything else is a proxy.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You've run this objective function before: it's **"QPS at p99 < 200 ms" from every capacity review you've sat in** — with one twist. Your web service degraded gracefully (everyone gets slightly slower); an inference engine has a *cliff* — admission denied is a 429, and memory pressure triggers preemption, so the tail doesn't stretch, it snaps. The metric discipline is identical; the failure geometry is sharper.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Goodput is defined as…',
          options: [
            'Total tokens/s',
            'Throughput subject to SLO constraints — requests (or tokens) delivered within the latency contract, per unit cost',
            'GPU utilization',
            'Requests that return 200 OK',
          ],
          correct: [1],
          explanation:
            'Raw throughput hides the latency collapse that produced it. Goodput counts only what meets TTFT/TPOT bounds — the only honest capacity metric, and the only one the business should see.',
        },
        {
          q: 'A vendor page shows "10,000 tok/s" with no latency numbers. The right reaction is…',
          options: [
            'Impressive',
            'Meaningless: throughput at the vertical part of the latency curve, where every user has already left — ask for the goodput curve instead',
            'Buy two',
            'It must be an MoE',
          ],
          correct: [1],
          explanation:
            'Throughput is monotonic in batch size; latency is not. Unaccompanied throughput numbers are taken at the knee you would never operate at. Ask: at what concurrency, at what TTFT/TPOT?',
        },
        {
          q: 'TTFT and TPOT are coupled into a seesaw by…',
          options: [
            'The tokenizer',
            'Batching: bigger batches amortize weight reads (cheaper tokens, better throughput) but slow per-token time and deepen queues (worse TTFT/TPOT)',
            'NCCL',
            'Quantization',
          ],
          correct: [1],
          explanation:
            'The batch size is the dial between the two; the SLO picks the operating point. This is why "goodput" is a curve, not a number — and why your lab-06 policy exists.',
        },
        {
          q: 'Why design at p50 but contract at p95?',
          options: [
            'p50 is for marketing',
            'The median guides design (typical experience), the tail binds contracts (what the least lucky user is promised) — one number can\'t do both jobs',
            'p95 is easier to compute',
            'Regulations require it',
          ],
          correct: [1],
          explanation:
            'Averages and tails answer different questions: design for the typical user, promise for the unlucky one. Systems that fail tails look great at the median — see the convoy lessons of T2 and lab 06.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'The Fleet as the measuring instrument',
      md: `Open /fleet. The scoreboard you have been racing is this lesson: goodput at SLO 40, with TTFT p95 beside it. Your scheduler's 62.5% (or better) vs FCFS's 10% is not a game score — it is the objective function evaluated on two policies. T7.L2 is about doing this measurement rigorously on real engines; T7.L3 is about where on the seesaw to sit; T7.L4 is about what the seat costs.`,
    },
  ],
}

export default lesson
