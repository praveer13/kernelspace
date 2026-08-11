import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't7.l4',
  slug: 'unit-economics',
  trackId: 't7',
  index: 4,
  title: 'Unit Economics: $/Mtok, tok/MW, and the 545% Margin Day',
  minutes: 30,
  hook: 'DeepSeek published a full day of production arithmetic: 226 nodes, $87k cost, 608B input tokens, 545% theoretical margin. Reproduce it from first principles, and you can price any serving business on a napkin.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `Every previous lesson had a price tag; this one reads it. The units:

- **$/Mtok** — cost per million tokens (input and output priced separately; outputs cost ~3–5× inputs because decode is serial and cache-hit input is nearly free).
- **tok/s/$** and **tok/MW** — throughput per dollar and per megawatt. The second is the datacenter's real constraint: power, not GPUs, is what you can't buy more of this decade. NVIDIA's Blackwell pitch is literally "10× tokens per megawatt for MoE."
- **Cost stack** — GPU-hours (dominant: a H100-class GPU is $2–3/hr rented, ~$0.7–1/hr amortized owned), power+cooling (~15–25% on top), CPU/network/storage (~10%), people (you don't price in yet).

Reproduce DeepSeek's day (open-infra index, Feb 2025): **226.75 nodes avg (8×H800 each), peak 278** → 1,814 GPUs avg × $2/GPU/hr × 24 h = **$87,072 cost**. Served **608B input tokens** (56.3% KV-cache hit) and **168B output tokens**. R1 list prices: $0.14/M input hit, $0.55/M input miss, $2.19/M output → revenue = 608e9×(0.563×0.14 + 0.437×0.55)/1e6 + 168e9×2.19/1e6 = $562,027. Margin: **545%** — before noting this is *list-price theoretical* (real revenue was lower; the point is the shape).`,
    },
    {
      type: 'prose',
      md: `## The napkin model that prices anything

One line per direction:
- **Cost/token ≈ (GPU-hours × $/hr) ÷ tokens produced.** Tokens produced = goodput × time — which is why T7.L1's objective function is also the cost function. Utilization below SLO collapse is the whole game: an idle GPU bills the same as a full one.
- **Revenue/token ≈ price × (1 + margin target).** Then solve for the goodput you must sustain: required tok/s/GPU = (price-adjusted cost) ÷ (tokens/GPU/s at your operating point on the T7.L3 frontier).

Worked example, SGLang's DeepSeek reproduction (T6.L2): 96×H100, 22.3k output tok/s/node → per node-day: 22.3e3 × 86400 = 1.93G output tokens. At $2/GPU/hr × 8 GPUs × 24 = $384/node-day → **$0.20/M output tokens** (their published estimate matches). At R1's $2.19/M price, the margin is the whole story of 2025 inference economics — and why API prices then fell ~80% in a year: competition found the same arithmetic.

## The levers, priced

Every T5/T6 technique restated as a unit-economics lever: **caching** (DeepSeek's 56.3% hit → nearly-free input half), **batching** (amortize weights), **quantization** (halve bytes → halve the denominator — FP4, T6.L5), **wide EP** (5× output throughput, T6.L2), **disaggregation** (right-sized phase fleets, T6.L3), **MTP** (2–3× interactivity at the same fleet, T6.L6). Hardware generations enter through tok/s/$ and tok/MW — Blackwell's ~15× cost-per-token claim vs prior gen at low interactivity (T7.L3's regional caveat applies).`,
    },
    {
      type: 'statline',
      stats: [
        { value: '$87k / $562k', label: 'DeepSeek cost vs list-price revenue, one day', hint: 'Feb 2025, open-infra index. The 545% margin day.' },
        { value: '56.3%', label: 'KV-cache hit rate', hint: 'More than half of input tokens served nearly free. Caching is a P&L line.' },
        { value: '$0.20/M', label: 'output tokens, SGLang 96×H100', hint: 'The reproduction\'s computed unit cost — vs $2.19/M list price.' },
        { value: '~80%', label: 'API price fall, 2025→26', hint: 'Everyone found the same arithmetic. Margin compression as curriculum.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is your **cloud cost review, one layer down**: reserved vs on-demand is GPU-own vs rent; "right-size the fleet" is T6.L3's disaggregation; "the cache hit rate is a cost line" is your CDN bill's logic — DeepSeek's 56.3% hit rate paid for more than half the input margin. And tok/MW is your datacenter PUE conversation: at fleet scale, the power bill is the capacity plan.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'DeepSeek\'s 545% margin day rested primarily on…',
          options: [
            'Cheap GPUs',
            'Wide-EP goodput + 56.3% cache-hit input + output-token pricing power — the levers ARE the margin',
            'Free electricity',
            'Small models',
          ],
          correct: [1],
          explanation:
            'Decompose it: EP144 decode throughput (T6.L2) produced the tokens; the cache made half the input nearly free; $2.19/M output pricing did the rest. Every margin in this business is a stack of systems levers.',
        },
        {
          q: 'Why are output tokens priced 3–5× input tokens?',
          options: [
            'Greed',
            'Decode is serial and bandwidth-bound while input is increasingly cache-served — outputs carry the marginal cost',
            'Inputs are small',
            'Regulation',
          ],
          correct: [1],
          explanation:
            'Prefill is parallel, cached, and cheap; decode is per-token serial bandwidth. The price follows the physics: outputs are where the cost lives, so they\'re where the margin lives too.',
        },
        {
          q: 'tok/MW matters because…',
          options: [
            'It is greener',
            'Power, not GPUs, is the binding constraint at datacenter scale — the capacity plan is an energy plan, and Blackwell-class gains (10× tok/MW MoE) change what a site is worth',
            'GPUs are free',
            'It looks good in slides',
          ],
          correct: [1],
          explanation:
            'You can\'t order more megawatts this decade. Throughput per megawatt converts hardware generations directly into site economics — it\'s NVIDIA\'s literal headline metric for a reason.',
        },
        {
          q: 'An engine\'s cost per token is driven most directly by…',
          options: [
            'The logo',
            'Goodput under SLO ÷ GPU-hours billed — utilization at the operating point; idle and SLO-collapsed GPUs bill identically',
            'The number of GPUs',
            'The frontend framework',
          ],
          correct: [1],
          explanation:
            'Cost/token = (GPU-hours × rate) ÷ tokens produced, and tokens produced IS goodput. T7.L1\'s objective function is the cost function; the T7.L3 frontier is where you choose it.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Do the arithmetic yourself',
      md: `The skill being certified: given a model's per-token KV bytes (T5.L4/T6.L1), a hardware point (T6.L5), and an operating point on the frontier (T7.L3), produce $/Mtok and required goodput for a target margin — in a meeting, on a napkin. DeepSeek's open-infra page, SGLang's $0.20/M estimate, and InferenceMAX's TCO dashboards are your answer keys. If you can reproduce all three from first principles, you have the job already.`,
    },
  ],
}

export default lesson
