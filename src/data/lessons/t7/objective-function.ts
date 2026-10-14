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
      md: `T5.L3 defined the metrics; this track operationalizes them. The serving business has exactly one objective function: **goodput — requests per second (or tokens per second) delivered within SLO**, which you divide by cost (per GPU-hour) to compare fleets. Not throughput. Not utilization. Requests that meet their latency contract. Everything in T7 is this function's derivatives.

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
        { value: 'goodput', label: 'the objective', hint: 'Requests within SLO per second; divide by cost to compare fleets. Everything else is a proxy.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `You've run this objective function before: it's **"QPS at p99 < 200 ms" from every capacity review you've sat in** — with one twist. Your web service degraded gracefully (everyone gets slightly slower); an inference engine has a *cliff* — admission denied is a 429, and memory pressure triggers preemption, so the tail doesn't stretch, it snaps. The metric discipline is identical; the failure geometry is sharper.`,
    },
    {
      type: 'prose',
      md: `## Counting goodput, and the error budget it spends

Counting goodput is mechanical: for every request in a window, check **both** bounds, count the requests that pass both, and divide by the window's length. Take a hypothetical 10 s window with 40 requests, where 31 meet TTFT < 2 s, 34 meet TPOT < 100 ms and 29 meet both. Goodput is 29 ÷ 10 = **2.9 req/s**. Counting only the TTFT bound claims 3.1 req/s, and counting every request claims 4.0.

An SLO is also a budget. A **99% SLO** lets 1 request in 100 miss, and that 1% is the **error budget**: over a hypothetical 1,000,000 requests in a month it is 10,000 misses, spent on deploys, spikes and incidents. What matters day to day is the **burn rate**, the observed miss fraction divided by the budgeted one. If 4% of requests miss against a 1% budget, the burn rate is 4 and a 30-day budget is gone in 30 ÷ 4 = 7.5 days. A burn rate of 1 spends it exactly on schedule. Alert on the burn rate over a window, not on one bad minute.`,
    },
    {
      type: 'item',
      title: 'Count what met the SLO',
      family: 'goodput',
      variants: ['slo-count', 'goodput-rate'],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Goodput is defined as…',
          options: [
            'Total tokens per second the engine emits across its whole request stream, measured at saturation',
            'Throughput within the first-token and inter-token latency targets, the honest capacity metric',
            'The fraction of device time spent in useful kernels instead of idle, reported as a utilization percentage',
            'Requests per second that finish with a success status, regardless of the latency they took',
          ],
          correct: [1],
          explanation:
            'Raw throughput hides the latency collapse that produced it. Goodput counts only what meets TTFT/TPOT bounds — the only honest capacity metric, and the only one the business should see.',
          why: [
            'Describes plain throughput. It also counts tokens from requests that blew their latency target, so it keeps climbing past the point where users give up. Goodput removes those.',
            'Right: a request only counts if it meets its latency targets. That makes goodput the one honest capacity metric; divide it by cost to compare fleets.',
            'Utilization measures busy hardware, not outcomes. A GPU kept saturated by a deep queue is fully utilized while delivering almost no requests inside the SLO.',
            'Success status says nothing about timing. A 200 that arrives after the TTFT or TPOT budget has been blown is a failure from the user\'s side and is not goodput.',
          ],
          kcs: ['t7.goodput'],
          miss: ['t7.goodput-is-throughput', '', 't7.goodput-is-utilization', 't7.goodput-is-success-rate'],
        },
        {
          q: 'A vendor page shows "10,000 tok/s" with no latency numbers. The right reaction is…',
          options: [
            'Credible for current hardware, since peak tokens per second is the figure capacity plans are built on',
            'Uninformative without any latency figures, likely taken well past the knee where goodput collapses',
            'Usable after dividing by the chip count, turning it into a figure comparable across vendors',
            'Trustworthy once the page names the model, since decode speed follows from the parameter count',
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
          kcs: ['t7.goodput', 't7.tail-percentiles'],
          miss: ['t7.peak-toks-is-capacity', '', 't7.per-gpu-fixes-missing-latency', 't7.model-name-fixes-toks'],
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
          kcs: ['t7.goodput', 't5.batching-throughput'],
          miss: ['t7.seesaw-is-tokenizer', 't7.seesaw-is-collectives', '', 't7.seesaw-is-quantization'],
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
          kcs: ['t7.tail-percentiles'],
          miss: ['t7.tail-too-noisy', '', 't7.tail-is-client-network', 't7.median-tracks-tail'],
        },
        {
          q: 'A service has a 99% SLO over 30 days, and 4% of its requests have missed the SLO since the window opened. The budget lasts about…',
          options: [
            'Seven and a half days: 4% missing against a 1% budget is a burn rate of 4, so the 30 days shrink to a quarter',
            'Ten days: only the 3% above the allowed 1% counts against the budget, so it is used up at three times the pace',
            'Thirty days: the SLO is judged once when the window closes, and a bad stretch can still be paid back by then',
            'A hundred and twenty days: a miss rate four times the budget stretches the window by that same factor of four',
          ],
          correct: [0],
          explanation:
            'Burn rate is the observed miss fraction divided by the budgeted one: 4% ÷ 1% = 4. Time to exhaustion is the window divided by the burn rate: 30 ÷ 4 = 7.5 days. A burn rate above 1 shortens the budget; it never stretches it.',
          why: [
            'Right: the burn rate is 4% ÷ 1% = 4, and a budget spent four times too fast lasts 30 ÷ 4 = 7.5 days. A burn rate of 1 would last exactly the 30 days.',
            'Subtracting the allowance undercounts the burn. The allowed 1% of misses is the budget itself, so all of the 4% spends it, at four times the budgeted rate rather than three.',
            'Budgets are spent as the misses happen, and a rolling window keeps counting them. Nothing is repaid at the end, so a burn rate of 4 is an alarm from the first day.',
            'The factor runs the other way. A miss rate above the budgeted one uses the budget up faster, so dividing the window by the burn rate shortens it, never stretches it.',
          ],
          kcs: ['t7.slo-error-budget'],
          miss: ['', 't7.burn-is-excess-over-budget', 't7.budget-judged-at-window-end', 't7.burn-rate-inverted'],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'The Fleet as the measuring instrument',
      md: `Open /fleet. The scoreboard you have been racing is this lesson: goodput at SLO 40, with TTFT p95 beside it. Your scheduler's 62.5% (or better) vs FCFS's 10% is not a game score — it is the objective function evaluated on two policies. T7.L2 is about doing this measurement rigorously on real engines; T7.L3 is about where on the seesaw to sit; T7.L4 is about what the seat costs.`,
    },
  ],
  kcs: ['t7.goodput', 't7.slo-error-budget', 't7.tail-percentiles'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'A vendor page says "10,000 tok/s". Name what you would ask before believing it, and why goodput is the better headline.',
        model:
          'Ask at what concurrency and lengths it was measured, because throughput flattens while latency climbs past the knee. Ask which TTFT and TPOT percentile it met. Goodput counts only requests inside the SLO, so divided by GPU-hours it compares fleets; raw tok/s does not.',
        ideas: [
          'At what concurrency and lengths: throughput flattens while latency climbs past the knee',
          'Which TTFT and TPOT percentile it met: a contract binds at p95, and goodput counts only requests inside the SLO',
          'Goodput per GPU-hour compares fleets; raw tokens per second does not',
        ],
        kcs: ['t7.goodput', 't7.tail-percentiles'],
      },
      {
        prompt: 'A 99% SLO covers 1,000,000 requests this month. Give the error budget, and say how long a 30-day budget lasts at a 3% miss rate.',
        model:
          'The budget is the 1% allowed to miss: 10,000 requests. A 3% miss rate against 1% is a burn rate of 3, so a 30-day budget lasts 30 ÷ 3 = 10 days. A burn rate of 1 spends it exactly on schedule, so alert on burn rate over a window, not on one bad minute.',
        ideas: [
          'The budget is the share allowed to miss: 1% of 1,000,000 is 10,000 requests',
          'Burn rate is the observed miss fraction divided by the budgeted one: 3% ÷ 1% = 3',
          'Time to exhaustion is the window divided by the burn rate: 30 ÷ 3 = 10 days',
        ],
        kcs: ['t7.slo-error-budget'],
      },
    ],
  },
}

export default lesson
