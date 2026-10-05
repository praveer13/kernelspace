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

Here is the systems bill, and it is paid in *network*, not FLOPs. With more experts than one GPU holds, each expert lives on a specific device. After the router decides, **every token must be physically moved to the GPUs hosting its k experts**, computed there, and moved back. Per layer, per batch: a **dispatch** all-to-all (tokens → expert devices) and a **combine** all-to-all (results → home devices). A 256-expert model at expert parallelism 144 (EP144, DeepSeek's decode config) runs this across 144 GPUs — twice per MoE layer. DeepSeek-V3 has 61 layers, but the first 3 are dense FFNs with no router, so that is 58 MoE layers and 2 × 58 = 116 all-to-alls per forward pass.

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
        { value: '2 × 58', label: 'all-to-alls per forward', hint: 'Dispatch + combine, every MoE layer (58 of 61; the first 3 are dense). MoE inference is a network workload.' },
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
            'A much smaller total parameter count, so the whole model fits on fewer GPUs and costs less to store',
            'Only the top-k experts run per token, so active parameters (~37B of 671B) shrink while capacity stays large',
            'The router replaces most attention layers with a cheap lookup, so the quadratic attention cost drops on long prompts',
            'Expert FFNs tolerate FP4 better than dense FFNs, so the same quality is reached with far fewer bits per weight',
          ],
          correct: [1],
          explanation:
            'Decode is bandwidth-bound (T4): tokens/s ≈ BW ÷ bytes-per-token. MoE cuts the FFN bytes by ~k/N while keeping dense-level quality. The total parameter count is LARGER — capacity gets worse while per-token cost gets better. That trade is the whole point.',
          why: [
            'Backwards: an MoE has more total parameters than a dense model of similar quality (671B here). Capacity grows; the win is that only ~37B are active per token.',
            'Right: only k of N experts run per token, so active parameters and FFN weight reads per token fall. Decode is bandwidth-bound, so tokens/s rises while capacity stays large.',
            'The router is a tiny scoring layer in front of the expert FFNs. Attention is unchanged, so its cost still grows with context length and KV size.',
            'Quantization is orthogonal to routing. Experts and dense FFNs are quantized with the same methods; MoE saves by running fewer weights per token, not by using fewer bits.',
          ],
        },
        {
          q: 'The all-to-all problem refers to…',
          options: [
            'Copying expert weights between GPUs whenever the router\'s statistics change, which stalls decode during each rebalance',
            'Moving tokens to their experts\' GPUs and the results back, twice per MoE layer, so cost grows with layers',
            'Broadcasting the full matrix of router scores to every device so each GPU can pick top-k experts for all tokens itself',
            'Exchanging gradients across every data-parallel replica after each step, which is why MoE needs a faster fabric than dense models',
          ],
          correct: [1],
          explanation:
            'Dispatch (tokens → experts) and combine (results → home), every MoE layer. At EP144 this spans 144 devices; latency floor = 2 × round-trip × layers. It is why MoE serving is a networking discipline, not a kernel one.',
          why: [
            'Weights stay put between rare rebalances. The per-forward cost is moving token activations to the experts\' GPUs, which happens every layer; weight migration is occasional and off the hot path.',
            'Right: dispatch sends tokens to expert devices and combine returns results, per MoE layer. In DeepSeek-V3 that is 2 × 58 = 116 all-to-alls per forward pass, a network cost.',
            'Router scores are tiny, and each token\'s top-k is computed on its home GPU. The heavy traffic is the token hidden states that follow the decision, not the scores.',
            'Gradient exchange is a training collective. The all-to-all in question runs in every inference forward pass too, moving activations, which is why serving MoE is a networking problem.',
          ],
        },
        {
          q: 'MLA\'s contribution to serving economics is…',
          options: [
            'Fused attention kernels that read the KV cache faster, so each decode step finishes sooner for the same cache size',
            'One shared low-rank latent per token (~70 KB vs 320 KB for Llama-3-70B), so big batches and long contexts fit in far less cache',
            'A learned gate that skips low-scoring attention heads for each token, cutting both the attention FLOPs and the number of K/V bytes cached',
            'Storing the KV cache in FP8 instead of BF16, which halves the bytes per token but leaves the per-head layout unchanged',
          ],
          correct: [1],
          explanation:
            'MLA caches one low-rank latent vector per token instead of per-head K/V. It shrinks the cache 4.6×, which is what lets the decode fleet hold the giant uniform batches MoE wants. Cache bytes/token is the first number to ask about any new model.',
          why: [
            'MLA changes what is cached, not how fast it is read. Faster kernels do not shrink KV bytes per token, so they do not raise how many sequences fit in HBM.',
            'Right: the ~576-element latent is cached per layer (576 × 2 B ≈ 1.15 KB), so 61 layers give ≈ 70 KB per token, about 4.6× less than Llama-3-70B, and much bigger batches fit.',
            'MLA skips no heads. It keeps all of them and rebuilds each head\'s K and V from the shared latent with up-projections; the saving is stored bytes, not skipped compute.',
            'FP8 KV is a precision change that halves bytes. MLA changes the cached object itself to a low-rank latent, and the two choices are independent of each other.',
          ],
        },
        {
          q: 'A "hot expert" hurts because…',
          options: [
            'Its GPU runs out of HBM for KV cache, so requests are preempted and the effective batch shrinks for every expert',
            'Routing collapse sets in, so the router starts sending every token to it regardless of what the token contains',
            'Its GPU becomes the straggler at the combine barrier, so every other device waits, like one hot shard setting a fan-out p99',
            'Replicating a hot expert onto second GPUs duplicates its weights and eats the HBM the batch\'s KV cache needed',
          ],
          correct: [2],
          explanation:
            'The combine is a barrier: slowest expert sets the layer time. Load balance across experts is therefore the central scheduling objective of MoE serving — hence EPLB (T6.L2) and giant batches (uniformity through statistics).',
          why: [
            'Load skew changes how many tokens an expert processes, not how much memory it holds. Expert weights are fixed in size; the harm is waiting at the barrier.',
            'Routing collapse is a training failure. At inference a hot expert is a popularity skew over real traffic; the router still discriminates by content, and the layer is simply slowed.',
            'Right: the combine is a barrier, so the slowest expert sets layer time. The overloaded GPU is the straggler and the other devices idle, like one hot shard in a fan-out.',
            'Replication is the remedy (EPLB), not the harm. It costs some HBM, but it is done because an unbalanced expert already stalls the whole layer at the barrier.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'DeepSeek-V3 as the reference architecture',
      md: `Keep one concrete instance in your head for the rest of T6: **61 layers (3 dense + 58 MoE), hidden 7168, 256 routed experts (top-8) + 1 shared, MLA with 576-dim latent KV**. Production config (DeepSeek open-infra week, Feb 2025): prefill on EP32 with DP32, decode on EP144 with DP144, FP8 for matmul/dispatch, BF16 for MLA/combine. Published cost day: 226–278 H800 nodes serving 608B input / 168B output tokens, 56.3% KV-cache hit rate, $87k cost vs $562k theoretical revenue — the 545% margin T7.L4 dissects. Every lesson in this track generalizes from this one build.`,
    },
  ],
}

export default lesson
