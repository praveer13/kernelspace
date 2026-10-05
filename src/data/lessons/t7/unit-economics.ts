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
- **Cost stack** — GPU-hours (dominant: an H100 rents on demand at a median $3.49 per GPU-hour across 41 providers on 2026-10-04 per [GetDeploying](https://getdeploying.com/reference/cloud-gpu/nvidia-h100), a dated price that moves daily; ~$0.7–1/hr amortized owned), power+cooling (~15–25% on top), CPU/network/storage (~10%), people (you don't price in yet).

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
            'A GPU cost basis far below the market rate, so almost any traffic volume would have produced a large margin',
            'Wide-EP goodput, a 56.3% cache-hit input share and output pricing: the systems levers are the margin',
            'Serving a small model, so each token needed few FLOPs and margin came from model size, not design',
            'Free or subsidized electricity, since power is the dominant cost line in a serving business',
          ],
          correct: [1],
          explanation:
            'Decompose it: EP144 decode throughput (T6.L2) produced the tokens; the cache made half the input nearly free; $2.19/M output pricing did the rest. Every margin in this business is a stack of systems levers.',
          why: [
            'The cost was GPU-hours at a stated $2 per GPU-hour assumption. Same cost with lower goodput or no caching would have earned far less revenue, so price alone does not explain it.',
            'Right: EP decode throughput produced the tokens, caching made over half the input nearly free, and output pricing did the rest. It is a list-price theoretical figure; the shape is the point.',
            'R1 is a large sparse MoE model, not a small one. Its economy came from serving that sparsity at scale with wide EP and caching, not from model size.',
            'The day\'s cost was GPU-hours only. Power and cooling are a smaller add-on to GPU-hours in the cost stack, so electricity could not carry the margin.',
          ],
        },
        {
          q: 'Why are output tokens priced 3–5× input tokens?',
          options: [
            'Users value generated text more than prompts, so providers price on perceived value rather than cost',
            'Outputs are shorter than prompts, so per-request overhead is spread over fewer tokens and each one costs more',
            'Decode is serial and bandwidth-bound while input is parallel and cached, so outputs carry the marginal cost',
            'Providers recover prefill compute through output pricing, so the price includes processing the whole prompt',
          ],
          correct: [2],
          explanation:
            'Prefill is parallel, cached, and cheap; decode is per-token serial bandwidth. The price follows the physics: outputs are where the cost lives, so they\'re where the margin lives too.',
          why: [
            'Prices track cost structure. Decode steps are expensive because each token needs a serial pass reading all weights, which is where the margin has to come from.',
            'Per-request overhead is small, and the gap persists for reasoning workloads with very long outputs. The difference comes from per-token physics, not from amortization.',
            'Right: prefill is parallel, batched and frequently cached, so input is cheap. Decode is one serial, bandwidth-bound pass per token, so outputs are where cost and margin live.',
            'Prefill is billed directly on input tokens, at a low rate precisely because it batches efficiently. Output pricing is not a vehicle for recovering it.',
          ],
        },
        {
          q: 'tok/MW matters because…',
          options: [
            'Operators publish energy efficiency to meet sustainability goals, not because power limits capacity',
            'A site\'s power envelope is fixed, so tokens per megawatt converts each hardware generation into what the site can sell',
            'Electricity is the largest line in the cost stack, ahead of GPU-hours, so it dominates the bill',
            'It tracks tok/s/$ exactly, since a lower-power GPU is also cheaper to buy and the two rank hardware the same',
          ],
          correct: [1],
          explanation:
            'You can\'t order more megawatts this decade. Throughput per megawatt converts hardware generations directly into site economics — it\'s NVIDIA\'s literal headline metric for a reason.',
          why: [
            'Reputation is a side effect. The binding reason is that megawatts at a site cannot simply be bought, so efficiency decides how much capacity the site holds.',
            'Right: you cannot order more megawatts this decade, so capacity planning is energy planning. Throughput per megawatt turns hardware generations directly into site economics.',
            'GPU-hours dominate the cost stack and power plus cooling sits on top as a smaller share. Power matters as a hard capacity limit, not as the largest invoice.',
            'Price and power are set separately, and a more power-efficient chip can cost more. tok/s/$ and tok/MW can rank the same hardware differently, which is why both are tracked.',
          ],
        },
        {
          q: 'An engine\'s cost per token is driven most directly by…',
          options: [
            'The number of GPUs in the fleet, since every added GPU raises the hourly bill and so the cost of every token',
            'Goodput per billed GPU-hour: tokens delivered within SLO per hour, since idle GPUs bill like busy ones',
            'The peak utilization reached in the busiest minute, since it shows how efficiently the silicon can be used',
            'The GPU\'s hourly rate, since a rented or amortized card costs the same per hour whatever workload it runs',
          ],
          correct: [1],
          explanation:
            'Cost/token = (GPU-hours × rate) ÷ tokens produced, and tokens produced IS goodput. T7.L1\'s objective function is the cost function; the T7.L3 frontier is where you choose it.',
          why: [
            'Fleet size raises cost and tokens together, so cost per token stays flat if each GPU is equally productive. What changes it is tokens per GPU-hour, not the count.',
            'Right: cost per token is GPU-hours times rate, divided by tokens produced, and tokens produced is goodput. Idle or SLO-collapsed GPUs bill the same as productive ones.',
            'You pay for every billed hour, not the best minute. A fleet that peaks briefly and idles the rest of the day still has a high cost per token.',
            'The rate is the numerator and matters, but two fleets at the same rate can differ many-fold in cost per token through goodput. Goodput is the lever engineering controls.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Do the arithmetic yourself',
      md: `The skill being certified: given a model's per-token KV bytes (T5.L4/T6.L1), a hardware point (T6.L5), and an operating point on the frontier (T7.L3), produce $/Mtok and required goodput for a target margin — in a meeting, on a napkin. DeepSeek's open-infra page, SGLang's $0.20/M estimate, and the TCO dashboards on InferenceX (formerly InferenceMAX) are your answer keys. If you can reproduce all three from first principles, you have the job already.`,
    },
  ],
}

export default lesson
