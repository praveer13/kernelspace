import type { Lesson } from '../types'
import { claimNumber } from '../claims'

/**
 * DeepSeek's day six (open-infra index) and the prices its page and DeepSeek's price list give, read from the claims snapshot.
 * Every figure the arithmetic below prints is computed from these, so the lesson cannot print a ratio its own totals do not give
 * (tests/claims/k0-c3-unit-economics.test.ts recomputes the same lines from the registry).
 */
const day6 = {
  cost: claimNumber('bench.deepseek-day6.daily-cost'),
  revenue: claimNumber('bench.deepseek-day6.theoretical-revenue'),
  nodes: claimNumber('bench.deepseek-day6.avg-nodes'),
  inTokens: claimNumber('bench.deepseek-day6.input-tokens'),
  hitTokens: claimNumber('bench.deepseek-day6.cache-hit-tokens'),
  hitRate: claimNumber('bench.deepseek-day6.cache-hit-rate'),
  outTokens: claimNumber('bench.deepseek-day6.output-tokens'),
  gpuHour: claimNumber('price.deepseek.h800-hourly-assumption'),
  hitPrice: claimNumber('price.deepseek.r1-input-cache-hit'),
  missPrice: claimNumber('price.deepseek.r1-input-cache-miss'),
  outPrice: claimNumber('price.deepseek.r1-output'),
}
const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`
const hitRevenue = (day6.hitTokens * day6.hitPrice) / 1e6
const inputRevenue = hitRevenue + ((day6.inTokens - day6.hitTokens) * day6.missPrice) / 1e6
/** The share of the day's input revenue that cache-hit tokens brought in, as a whole percent. */
const hitShare = Math.round((hitRevenue / inputRevenue) * 100)
const grossMargin = (1 - day6.cost / day6.revenue) * 100
const flagshipPeak = claimNumber('price.deepseek.v4-pro-output-peak')
const flagshipOffPeak = claimNumber('price.deepseek.v4-pro-output-offpeak')
const medianNow = claimNumber('price.h100.median-2026-11')
/** SGLang's per-decode-node output rate (their blog) and the node-day cost of eight GPUs at a given GPU-hour price, per million output tokens. */
const sglangTokPerNodeDay = 22.3e3 * 86_400
const perMtok = (gpuHour: number) => ((gpuHour * 8 * 24) / sglangTokPerNodeDay) * 1e6

const lesson: Lesson = {
  id: 't7.l4',
  slug: 'unit-economics',
  trackId: 't7',
  index: 4,
  title: 'Unit Economics: $/Mtok, tok/MW, and the 545% Margin Day',
  minutes: 30,
  hook: 'DeepSeek published a full day of production arithmetic: 226 nodes, $87k cost, 608B input tokens, a 545% theoretical cost profit margin (profit over cost, at list prices). Reproduce it from first principles, and you can price any serving business on a napkin.',
  exercise: 'read+quiz',
  verifiedAt: '2026-10',
  blocks: [
    {
      type: 'prose',
      md: `Every previous lesson had a price tag; this one reads it. The units:

- **$/Mtok** — cost per million tokens (input and output priced separately; outputs cost ~3–5× inputs because decode is serial and cache-hit input is nearly free).
- **tok/s/$** and **tok/MW** — throughput per dollar and per megawatt. The second is the datacenter's real constraint: power, not GPUs, is what you can't buy more of this decade. NVIDIA's own pitch is a vendor claim at one stated interactivity point: Vera Rubin NVL72 plus LPX "up to 35x higher TPS per megawatt at 400 TPS per user" versus GB200 NVL72, to be decomposed, not recited. The measured counterpoint is InferenceMAX's ~8× tokens per MW for a GB200 NVL72 over a single-node H200 on DeepSeek-R1 at 30 tok/s/user.
- **Cost stack** — GPU-hours (dominant: an H100 rents on demand at a median $3.49 per GPU-hour across 41 providers on 2026-10-04 per [GetDeploying](https://getdeploying.com/reference/cloud-gpu/nvidia-h100), a dated price that moves daily; ~$0.7–1/hr amortized owned), power+cooling (~15–25% on top), CPU/network/storage (~10%), people (you don't price in yet).

Reproduce DeepSeek's day (open-infra index, Feb 2025): **${day6.nodes} nodes avg (8×H800 each), peak 278** → ${(day6.nodes * 8).toLocaleString('en-US')} GPUs avg × $${day6.gpuHour}/GPU/hr × 24 h = **${usd(day6.cost)} cost** (the $${day6.gpuHour} is DeepSeek's stated leasing assumption). Served **${day6.inTokens / 1e9}B input tokens** (${day6.hitRate}% KV-cache hit) and **${day6.outTokens / 1e9}B output tokens**. R1 list prices: $${day6.hitPrice}/M input hit, $${day6.missPrice}/M input miss, $${day6.outPrice}/M output → revenue ≈ ${usd(day6.revenue)} (DeepSeek's own total; the token counts are rounded). What DeepSeek calls a **cost profit margin of 545%** is profit over cost: (${usd(day6.revenue)} − ${usd(day6.cost)}) ÷ ${usd(day6.cost)} = 5.45, so price is about 6.45× cost. The same totals as a gross margin, 1 − cost ÷ revenue, are **${grossMargin.toFixed(1)}%**. Both are *list-price theoretical*: DeepSeek says actual revenue was substantially lower (V3 is priced below R1, web and app are free, off-peak discounts apply). The point is the shape.`,
    },
    {
      type: 'prose',
      md: `## The napkin model that prices anything

One line per direction:
- **Cost per useful token ≈ (GPU-hours × $/hr) ÷ tokens delivered within SLO.** Those tokens = goodput × time — which is why T7.L1's objective function is also the cost function. Output from requests that miss their latency targets costs GPU-hours but does not count as a useful token. Utilization below SLO collapse is the whole game: an idle GPU bills the same as a full one.
- **Price is revenue per token, and two relations tie it to cost.** A *markup* gives price = cost × (1 + markup); a *gross margin* m gives price = cost ÷ (1 − m). DeepSeek's 545% is a markup (price ≈ 6.45× cost), which is the same day as a gross margin of ${grossMargin.toFixed(1)}%; this lesson says "margin" only with its form named. Units stay explicit: price and cost in $/Mtok, a GPU's rent C in $/GPU-hour, throughput in tok/s. To earn gross margin m at price P ($/Mtok), each GPU must deliver at least tok/s = C × 10⁶ ÷ (3,600 × P × (1 − m)) inside its SLO: at C = $2, P = $0.60 and m = 50%, that is 2 × 10⁶ ÷ (3,600 × 0.60 × 0.5) ≈ **1,850 tok/s per GPU**. Then read where your operating point on the T7.L3 frontier sits against it.

Worked example, SGLang's DeepSeek reproduction (T6.L2): their blog reports 22.3k output tok/s per node on 8×H100 nodes, measured on 9 decode nodes with the prefill side assumed unlimited. Per node-day: 22.3e3 × 86400 = 1.93G output tokens. At $2/GPU/hr × 8 GPUs × 24 = $384/node-day → **$${perMtok(2).toFixed(2)}/M output tokens** (their published estimate matches). That is one decode node priced alone, at the throughput end of the frontier: the same blog lists TTFT of 2–5 seconds and ITL of about 100 ms (ten tokens a second per user) as the limit of that operating point, so $0.20 is not a cost per token inside a tight SLO. The same node-day at the November 2026 median H100 rent in this course's claims table, $${medianNow.toFixed(2)} per GPU-hour (its source and reading date are listed there), is 8 × ${medianNow.toFixed(2)} × 24 = $${(medianNow * 8 * 24).toFixed(2)}, or **$${perMtok(medianNow).toFixed(2)}/M**: the same tokens at nearly twice the cost, because the rent is the input that moved.

Against R1's $${day6.outPrice}/M list price, that gap is the whole story of the 2025 margin. No source gives a fixed fall in API prices that this arithmetic explains, so read no "x% a year" into it. What is sourced is narrower. Epoch AI's March 2025 data insight measures the price of *reaching a fixed benchmark score* falling between 9× and 900× per year depending on the milestone, and notes that the fastest drops were in the latest year, so they may not persist. That is the price of a capability, not any one model's list price: DeepSeek's own flagship, deepseek-v4-pro, lists $${flagshipPeak} per million output tokens at peak hours and $${flagshipOffPeak} off-peak, against R1's $${day6.outPrice}.

As a formula: **$/Mtok = ($/GPU-hour × GPUs) ÷ (tok/s × 3,600) × 10⁶**, with tok/s counted within the SLO you set. A hypothetical 8-GPU node at $2 per GPU-hour that delivers 20,000 tok/s costs 16 ÷ 72,000,000 × 10⁶ = **$0.22/Mtok**. Run it backwards for a price target: the node needs ($/hour ÷ target $/Mtok) × 10⁶ ÷ 3,600 tok/s, so $0.10/Mtok asks for 16 ÷ 0.10 × 10⁶ ÷ 3,600 ≈ **44,400 tok/s**. Tokens per megawatt divides the same throughput by power instead of price: a hypothetical rack drawing 0.12 MW that delivers 600,000 tok/s makes **5,000,000 tok/s per MW**.

## The levers, priced

Every T5/T6 technique restated as a unit-economics lever: **caching** (DeepSeek's ${day6.hitRate}% hit: over half the input tokens billed at $${day6.hitPrice}/M instead of $${day6.missPrice}/M, and their prefill never run), **batching** (amortize weights), **quantization** (fewer bytes per token → more tokens per GPU-hour; NVFP4 is ~1.8× fewer bytes than FP8, not 2×, T6.L5), **wide EP** (5× output throughput, T6.L2), **disaggregation** (right-sized phase fleets, T6.L3), **MTP** (2–3× interactivity at the same fleet, T6.L6). Hardware generations enter through tok/s/$ and tok/MW — vendor multipliers like the 35× above are claims at one operating point, and T7.L3's regional caveat applies.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '$87k / $562k', label: 'DeepSeek cost vs list-price revenue, one day', hint: `Feb 2025, open-infra index. A 545% cost profit margin: profit over cost, or ${grossMargin.toFixed(1)}% of revenue.` },
        { value: `${day6.hitRate}%`, label: 'KV-cache hit rate', hint: `More than half of input tokens billed at $${day6.hitPrice}/M, not $${day6.missPrice}/M: about ${hitShare}% of input revenue. Caching is a P&L line.` },
        { value: '$0.20/M', label: 'output tokens, SGLang 96×H100', hint: `One decode node at $2/GPU-hr, TTFT 2–5 s and ITL about 100 ms, vs $${day6.outPrice}/M list price.` },
        { value: '9×–900×', label: 'price fall per year to reach a fixed benchmark score', hint: 'Epoch AI, Mar 2025: the price of a capability, not of one model. DeepSeek\'s flagship now lists a higher peak output price than R1.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is your **cloud cost review, one layer down**: reserved vs on-demand is GPU-own vs rent; "right-size the fleet" is T6.L3's disaggregation; "the cache hit rate is a cost line" is your CDN bill's logic — DeepSeek's ${day6.hitRate}% hit rate brought in about ${hitShare}% of its list-price input revenue, and its larger effect is the prefill compute it never ran. And tok/MW is your datacenter PUE conversation: at fleet scale, the power bill is the capacity plan.`,
    },
    {
      type: 'item',
      title: 'Price it with new numbers',
      family: 'cost',
      variants: ['per-mtok', 'required-tps'],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'DeepSeek\'s 545% margin day rested primarily on…',
          options: [
            'An accelerator cost basis far below the market rate, with almost any traffic volume producing a large margin',
            'Systems levers such as wide expert-parallel goodput, a high cache-hit share and output pricing',
            'Serving a small model, with each token needing few operations and margin coming from model size',
            'Free or subsidized electricity, with power being the dominant cost line in a serving business',
          ],
          correct: [1],
          explanation:
            'Decompose it: EP144 decode throughput (T6.L2) produced the tokens; the cache billed over half the input tokens at about a quarter of the miss price (about a quarter of input revenue); output pricing was most of the rest. Every margin in this business is a stack of systems levers.',
          why: [
            'The cost was GPU-hours at a stated $2 per GPU-hour assumption. Same cost with lower goodput or no caching would have earned far less revenue, so price alone does not explain it.',
            'Right: EP decode throughput produced the tokens, caching billed over half the input tokens at about a quarter of the miss price, and output pricing was most of the list revenue. It is a list-price theoretical figure; the shape is the point.',
            'R1 is a large sparse MoE model, not a small one. Its economy came from serving that sparsity at scale with wide EP and caching, not from model size.',
            'The day\'s cost was GPU-hours only. Power and cooling are a smaller add-on to GPU-hours in the cost stack, so electricity could not carry the margin.',
          ],
          kcs: ['t7.cost-per-mtok', 't6.ep-economics'],
          miss: ['t7.margin-is-cheap-gpus', '', 't7.margin-is-small-model', 't7.margin-is-free-power'],
        },
        {
          q: 'Why are output tokens priced 3–5× input tokens?',
          options: [
            'Users value generated text more than prompts, and providers price on perceived value rather than cost',
            'Outputs are shorter than prompts, and per-request overhead spread over fewer tokens makes each one costlier',
            'Decode is serial and bandwidth-bound while input is parallel and cached, and outputs carry the marginal cost',
            'Providers recover prefill compute through output pricing, and the price includes processing the whole prompt',
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
          kcs: ['t7.output-token-premium'],
          miss: ['t7.output-price-is-value', 't7.output-price-is-overhead', '', 't7.output-price-recovers-prefill'],
        },
        {
          q: 'tok/MW matters because…',
          options: [
            'Operators publish energy efficiency to meet sustainability goals, and power does not limit capacity',
            'A site\'s power envelope is fixed, and tokens per megawatt turns each generation into sellable output',
            'Electricity is the largest line in the cost stack, and it dominates the bill ahead of accelerator rental',
            'It tracks tokens per dollar exactly, and the two metrics rank each hardware generation the same way',
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
          kcs: ['t7.tokens-per-megawatt'],
          miss: ['t7.tokmw-is-reputation', '', 't7.power-is-largest-cost', 't7.tokmw-equals-tokens-per-dollar'],
        },
        {
          q: 'At a fixed hourly rate, an engine\'s cost per token is driven most directly by…',
          options: [
            'The number of chips in the fleet, with each added chip raising the hourly bill and the cost of each token',
            'Goodput per billed chip hour, meaning tokens delivered within the latency target per hour',
            'The peak utilization reached in the busiest minute, which shows how efficiently the silicon can be used',
            'The chip\'s hourly rate, with a rented or amortized card costing the same per hour regardless of what it runs',
          ],
          correct: [1],
          explanation:
            'Cost per useful token = (GPU-hours × rate) ÷ tokens delivered within SLO, which is goodput × time. Idle and SLO-collapsed GPUs bill the same as productive ones. T7.L1\'s objective function is the cost function; the T7.L3 frontier is where you choose it.',
          why: [
            'Fleet size raises cost and tokens together, so cost per token stays flat if each GPU is equally productive. What changes it is tokens per GPU-hour, not the count.',
            'Right: cost per useful token is GPU-hours times rate, divided by the tokens delivered within the SLO, which is goodput times time. Idle or SLO-collapsed GPUs bill the same as productive ones.',
            'You pay for every billed hour, not the best minute. A fleet that peaks briefly and idles the rest of the day still has a high cost per token.',
            'The stem holds the rate fixed, so it cannot be what moves cost per token. Two fleets billed at the same rate can still differ many-fold through goodput, which is the lever engineering controls.',
          ],
          kcs: ['t7.cost-per-mtok'],
          miss: ['t7.cost-is-chip-count', '', 't7.cost-is-peak-utilization', 't7.cost-is-hourly-rate'],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Do the arithmetic yourself',
      md: `The skill being certified: given a model's per-token KV bytes (T5.L4/T6.L1), a hardware point (T6.L5), and an operating point on the frontier (T7.L3), produce $/Mtok and required goodput for a target margin — in a meeting, on a napkin. DeepSeek's open-infra page, SGLang's $0.20/M estimate, and the TCO dashboards on InferenceX (formerly InferenceMAX) are your answer keys. If you can reproduce all three from first principles, you have the job already.`,
    },
  ],
  kcs: ['t7.cost-per-mtok', 't7.output-token-premium', 't7.tokens-per-megawatt'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Reproduce a $/Mtok figure for one node: which inputs do you need, and which one do people forget?',
        model:
          'You need the node\'s dollars per hour (price per GPU-hour times GPUs) and its tokens per second. Multiply tokens per second by 3,600 for tokens per hour, divide, and scale to millions. The forgotten input is the SLO: count only tokens delivered within it, because idle or SLO-missing GPU-hours bill the same.',
        ideas: [
          'Dollars per hour of the node: price per GPU-hour times the GPUs in it',
          'Tokens per second times 3,600 gives tokens per hour; divide and scale to millions',
          'Count only tokens delivered within the SLO, since idle or missed GPU-hours still bill',
        ],
        kcs: ['t7.cost-per-mtok'],
      },
      {
        prompt: 'Why are output tokens priced several times input tokens, and why does tokens per megawatt matter to a datacenter?',
        model:
          'Prefill is parallel, batched and often cached, so input is cheap. Decode is one serial, bandwidth-bound pass per token, so output carries the cost and the margin. A site\'s megawatts are fixed and cannot simply be bought, so tokens per megawatt turns each hardware generation into sellable output.',
        ideas: [
          'Prefill is parallel, batched and often cached, so input tokens are cheap',
          'Decode is one serial, bandwidth-bound pass per token, so output carries the cost',
          'A site\'s megawatts are fixed, so tokens per megawatt turns hardware into sellable output',
        ],
        kcs: ['t7.output-token-premium', 't7.tokens-per-megawatt'],
      },
    ],
  },
}

export default lesson
