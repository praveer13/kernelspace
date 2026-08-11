import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l1',
  slug: 'moe-anatomy',
  trackId: 't6',
  index: 1,
  title: 'The MoE Anatomy: Experts, Routers, and the All-to-All',
  minutes: 30,
  hook: 'DeepSeek-V3 has 256 experts and uses 8 per token. That one design decision changes every system you have learned so far — the memory math, the batching, the network, the scheduler. This is why T6 exists.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `Everything before this track assumed a dense model: every token touches every parameter, so every token costs the same weight-read (T4's roofline arithmetic). Mixture-of-Experts breaks that symmetry. The FFN layer — roughly two-thirds of a transformer's parameters — is replaced by **N parallel expert FFNs plus a tiny router network**. Each token, the router scores all N experts and sends the token to the top-k (DeepSeek-V3: N=256 routed experts + 1 shared, k=8). Total parameters: 671B. Parameters touched per token: ~37B.

The deal: dense-model quality at a fraction of the per-token weight bandwidth. T4's decode economics — tokens/s ≈ bandwidth ÷ bytes-per-token — suddenly divides by ~18 for the FFN part. That is why every frontier open model of 2025-2026 is an MoE (DeepSeek V3/R1, Kimi K2, Qwen3, Mixtral's descendants, gpt-oss).`,
    },
    {
      type: 'prose',
      md: `## What the router costs you: the all-to-all

Here is the systems bill, and it is paid in *network*, not FLOPs. With more experts than one GPU holds, each expert lives on a specific device. After the router decides, **every token must be physically moved to the GPUs hosting its k experts**, computed there, and moved back. Per layer, per batch: a **dispatch** all-to-all (tokens → expert devices) and a **combine** all-to-all (results → home devices). A 256-expert model at expert parallelism 144 (EP144, DeepSeek's decode config) runs this across 144 GPUs — twice per layer, 61 layers.

This is why MoE serving is a *scheduling and networking* discipline:
- **Load balance is the whole game.** If 30% of tokens pick expert #7, expert #7's GPU is the straggler and 143 others wait at the combine barrier. Hot experts are the NCCL stall of T0.L6 writ large.
- **The batch is the load balancer's only material.** More tokens per forward = more uniform expert utilization = better GPU occupancy. MoE *demands* big batches — the exact opposite of low-latency small-batch serving, and the tension T6.L2 resolves.
- **Latency floor = network round-trip × 2 × layers.** On NVLink this is tens of microseconds; on RDMA it dominates. Topology stops being trivia and starts being the price list.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '671B / 37B', label: 'DeepSeek-V3 params: total / per-token', hint: 'MoE buys ~18× fewer weight bytes per token for the FFN path.' },
        { value: '256 + 1', label: 'routed experts + shared', hint: 'Top-8 of 256 chosen per token by the router; the shared expert always runs.' },
        { value: '2 × 61', label: 'all-to-alls per forward', hint: 'Dispatch + combine, every layer. MoE inference is a network workload.' },
        { value: 'EP144', label: 'DeepSeek decode EP width', hint: 'Experts spread across 144 GPUs in production decode (Feb 2025).' },
      ],
    },
    {
      type: 'prose',
      md: `## MLA: the other half of the DeepSeek trick

T5.L4 taught you KV bytes/token = 2 × layers × kv_dim × bytes, and Llama-3-70B's 320 KB/token. DeepSeek's **Multi-head Latent Attention (MLA)** rewrites that line: instead of caching per-head K and V, the model stores one shared low-rank **latent vector** per token (~576 elements) and reconstructs per-head K/V on the fly with small up-projection matrices. KV cache per token: **~70 KB (BF16)** — 4.6× smaller than Llama-3-70B, ~7× smaller than full MHA.

Run T5.L4's arithmetic again with 70 KB: the "cache is the payload" conclusion intensifies *less*, long context gets 4.6× cheaper, and the EP144 decode fleet can hold the giant batches that expert load-balancing requires. MLA is not an optimization bolted onto MoE — it is what *enables* the batch sizes MoE wants. When you design a serving stack, per-token KV bytes is the first number you ask for, and "what attention variant?" is why you had to ask.`,
    },
    {
      type: 'isomorphism',
      title: 'MoE ≡ your microservice fleet',
      pairs: [
        {
          os: 'one monolith: every request runs every code path',
          osLine: 'Dense model: every token reads every weight.',
          llm: 'N sharded services behind a router',
          llmLine: 'MoE: a router sends each token to top-k specialist experts.',
        },
        {
          os: 'hot partition → fleet-wide straggler',
          osLine: 'One overloaded shard makes every fan-out request miss its p99.',
          llm: 'hot expert → combine-barrier stall',
          llmLine: 'One popular expert makes the whole batch wait at the all-to-all.',
        },
        {
          os: 'session affinity for cache locality',
          osLine: 'Sticky routing so the same user lands on the warm shard.',
          llm: 'EP-aware batching / EPLB',
          llmLine: 'Shape traffic so experts stay balanced and tokens travel less.',
        },
      ],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The core inference-economic win of MoE is…',
          options: [
            'Fewer total parameters to store',
            'Per-token weight bandwidth drops ~k/N — decode reads only the routed experts\' weights, not the full model',
            'The router makes attention cheaper',
            'Experts quantize better than dense FFNs',
          ],
          correct: [1],
          explanation:
            'Decode is bandwidth-bound (T4): tokens/s ≈ BW ÷ bytes-per-token. MoE cuts the FFN bytes by ~k/N while keeping dense-level quality. The total parameter count is LARGER — capacity gets worse while per-token cost gets better. That trade is the whole point.',
        },
        {
          q: 'The all-to-all problem refers to…',
          options: [
            'Copying weights between GPUs at load time',
            'Moving tokens to expert devices and back, twice per layer — a network cost that scales with layers × batch',
            'Broadcasting the router\'s scores',
            'Gradient exchange during training',
          ],
          correct: [1],
          explanation:
            'Dispatch (tokens → experts) and combine (results → home), every layer. At EP144 this spans 144 devices; latency floor = 2 × round-trip × layers. It is why MoE serving is a networking discipline, not a kernel one.',
        },
        {
          q: 'MLA\'s contribution to serving economics is…',
          options: [
            'Faster attention kernels',
            '~4.6× smaller KV per token (70 KB vs 320 KB for Llama-3-70B), enabling the giant batches expert load-balancing needs and cheaper long context',
            'Better router accuracy',
            'FP8 compatibility',
          ],
          correct: [1],
          explanation:
            'MLA caches one low-rank latent vector per token instead of per-head K/V. It shrinks the cache 4.6×, which is what lets the decode fleet hold the giant uniform batches MoE wants. Cache bytes/token is the first number to ask about any new model.',
        },
        {
          q: 'A "hot expert" hurts because…',
          options: [
            'It quantizes poorly',
            'It gets replicated',
            'Its GPU becomes the batch\'s straggler at the combine barrier — every other device waits, exactly like a hot shard in a microservice fleet',
            'The router degrades',
          ],
          correct: [2],
          explanation:
            'The combine is a barrier: slowest expert sets the layer time. Load balance across experts is therefore the central scheduling objective of MoE serving — hence EPLB (T6.L2) and giant batches (uniformity through statistics).',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'DeepSeek-V3 as the reference architecture',
      md: `Keep one concrete instance in your head for the rest of T6: **61 layers, hidden 7168, 256 routed experts (top-8) + 1 shared, MLA with 576-dim latent KV**. Production config (DeepSeek open-infra week, Feb 2025): prefill on EP32 with DP32, decode on EP144 with DP144, FP8 for matmul/dispatch, BF16 for MLA/combine. Published cost day: 226–278 H800 nodes serving 608B input / 168B output tokens, 56.3% KV-cache hit rate, $87k cost vs $562k theoretical revenue — the 545% margin T7.L4 dissects. Every lesson in this track generalizes from this one build.`,
    },
  ],
}

export default lesson
