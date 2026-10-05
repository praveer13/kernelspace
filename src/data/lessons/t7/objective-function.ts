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
  verifiedAt: '2026-10',
  blocks: [
    {
      type: 'prose',
      md: `T5.L3 defined the metrics; this track operationalizes them. The serving business has exactly one objective function: **goodput — requests per second (or tokens per second) delivered within SLO**. Not throughput. Not utilization. Requests that meet their latency contract, per unit of cost. Everything in T7 is this function's derivatives.

Why the distinction is not pedantry: as batch grows, throughput rises and then flattens against the compute and bandwidth roofs, while latency keeps rising — bigger batches stretch every step and deepen the queue, and past the knee the p99 goes vertical. Completions crawl even as the batch gets enormous. Raw "tok/s" benchmarks are taken *at* the vertical part, where every user has already left. Goodput forces the honest question: at what concurrency does the system stop meeting TTFT/TPOT — and what does that point cost?`,
    },
    {
      type: 'prose',
      md: `## The metrics, hardened

- **TTFT** (arrival → first token): queue + prefill (+ KV transfer when disaggregated). The "is it alive" signal. Production SLOs: Meta's app targets **<350 ms**; typical chat SLOs 0.5–2 s depending on prompt class.
- **TPOT/ITL** (per-token decode period): bandwidth ÷ (weight+KV bytes), divided by batch efficiency. The "is it fast" signal. Meta targets **<25 ms TTIT**; chat comfort is <50–80 ms.
- **E2E latency** and its percentiles: what the user feels; **p50 for design, p95/p99 for contracts**. Never one number.
- **Goodput**: throughput *subject to* the above — e.g. req/s with TTFT < 2 s AND TPOT < 100 ms. Capacity planning's only honest input.
- **Interactivity** (tok/s/user) vs **throughput** (tok/s/GPU): the two ends of the dial T7.L3 turns. Benchmarks that don't name which end they're showing are marketing.

The engine's control loop, one line: **batching puts throughput and latency on a seesaw (bigger batches buy tokens per second and cost TTFT and TPOT), and the SLO picks the operating point.** Your lab-06 scheduler is that sentence made executable — you implemented admission policy against this exact objective function.`,
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
            'Total tokens per second the engine emits across its whole request stream, measured at saturation',
            'Throughput restricted to requests that meet their latency contract, per unit of cost',
            'The fraction of device time spent in useful kernels, reported as a utilization percentage',
            'Requests per second that finish with a success status, whatever latency they took',
          ],
          correct: [1],
          explanation:
            'Raw throughput hides the latency collapse that produced it. Goodput counts only what meets TTFT/TPOT bounds — the only honest capacity metric, and the only one the business should see.',
          why: [
            'Describes plain throughput. It also counts tokens from requests that blew their latency target, so it keeps climbing past the point where users give up. Goodput removes those.',
            'Right: a request only counts if it meets its latency contract. That makes goodput the one honest capacity metric, and it is stated per unit of cost.',
            'Utilization measures busy hardware, not outcomes. A GPU kept saturated by a deep queue is fully utilized while delivering almost no requests inside the SLO.',
            'Success status says nothing about timing. A 200 that arrives after the TTFT or TPOT budget has been blown is a failure from the user\'s side and is not goodput.',
          ],
        },
        {
          q: 'A vendor page shows "10,000 tok/s" with no latency numbers. The right reaction is…',
          options: [
            'Credible for current hardware, and peak tokens per second is what capacity plans are built on',
            'Uninformative without latency figures, likely taken past the knee where goodput collapses',
            'Usable after dividing by the chip count, turning it into a figure comparable across vendors',
            'Trustworthy once the page names the model, and decode speed follows from the parameter count',
          ],
          correct: [1],
          explanation:
            'Throughput flattens as batch size grows; latency blows up past the knee. Unaccompanied throughput numbers are taken at the knee you would never operate at. Ask: at what concurrency, at what TTFT/TPOT?',
          why: [
            'Peak tok/s is the number capacity plans must not use. Throughput flattens as batch grows while latency climbs steeply past the knee, so the peak sits where users already see unusable delays.',
            'Right: throughput flattens as batch grows while latency blows up past the knee. A figure with no TTFT or TPOT likely comes from the vertical part of the curve, so ask at what concurrency.',
            'Dividing by GPU count changes the unit, not the missing context. Per-GPU throughput is still undefined without the latency it was reached at, so vendors remain incomparable.',
            'Naming the model fixes one variable only. The same model gives very different tok/s at batch 1 and batch 256, so the operating point still decides the number.',
          ],
        },
        {
          q: 'Throughput and latency sit on a seesaw: tokens per second per GPU rise with load while TTFT and TPOT rise too. The coupling comes from…',
          options: [
            'The tokenizer, whose per-request host time delays the first token and each later token',
            'Collective communication, whose fixed per-step latency gets added to prefill and to each decode step',
            'Batching, which grows throughput by amortizing weight reads while queues and decode steps lengthen',
            'Quantization, which trades answer quality for speed rather than trading latency for throughput',
          ],
          correct: [2],
          explanation:
            'Batch size is the dial between throughput and latency; the SLO picks the operating point. This is why "goodput" is a curve, not a number — and why your lab-06 policy exists.',
          why: [
            'Tokenization is small CPU work that delays only TTFT, once per request, not every later token. It cannot create a seesaw, which needs throughput to improve while latency worsens.',
            'A fixed per-step collective cost raises both latencies together, so it is overhead, not a tradeoff. The seesaw comes from a knob that buys throughput at latency\'s expense.',
            'Right: batch size is the dial. Larger batches amortize weight reads and raise throughput, but they queue requests longer and stretch each step, so TTFT and TPOT rise as cost per token falls.',
            'Quantization trades accuracy, not throughput against latency. Fewer weight bytes speed decode and low-precision math (FP8, FP4) speeds prefill, so it moves the frontier outward instead of along it.',
          ],
        },
        {
          q: 'Why design at p50 but contract at p95?',
          options: [
            'The median is stable with few samples while the tail is too noisy to design with, and noise decides',
            'The median sizes for the typical user while the tail is promised, and one number cannot do both',
            'The slowest requests come mostly from client networks and say nothing about the engine, and are excluded',
            'The median and the tail move together, and a system that meets one target will also meet the other',
          ],
          correct: [1],
          explanation:
            'Averages and tails answer different questions: design for the typical user, promise for the unlucky one. Systems that fail tails look great at the median — see the convoy lessons of T2 and lab 06.',
          why: [
            'Sample noise is solved with more requests per load step (hundreds, per T7.L2), not by ignoring the tail. The contract binds on the tail regardless of how noisy it is to measure.',
            'Right: the median describes the typical experience and sizes the system. The tail is what the least lucky user is promised, so contracts bind there. One number answers only one question.',
            'In LLM serving the tail is mostly the engine\'s own doing: queueing, preemption and long prompts. The convoy effects of T2 and lab 06 live exactly in that slowest slice.',
            'They diverge sharply near the knee: the median can look healthy while the tail snaps. A system that passes at p50 can still miss p95 by a wide margin.',
          ],
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
