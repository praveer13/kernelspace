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
  verifiedAt: '2026-10',
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
      type: 'item',
      title: 'Bytes read per step, bytes resident',
      family: 'memory',
      variants: ['active-bytes'],
    },
    // P4 protégé block (wave-3.md §16.9, task 3s-12). The misconception: an MoE needs memory only for its active parameters.
    // The evidence: PLAN-100X §4 gives every lure a misconception id, and this one is the memory family's
    // `memory.active-for-total` ("You counted only the active parameters"), the slip t6.l1 warns about; the frontier models
    // the evidence lists are all total/active pairs (serving-landscape.md F5: Kimi K3 2.8T/104B, gpt-oss-120b 117B/5.1B).
    // The numbers are claims model.deepseek-v3.total-params (671) and model.deepseek-v3.active-params (37), one byte per FP8 weight.
    // The family item that proves the fix: memory/active-bytes, the block just above, whose `resident` ask has that lure.
    // It sits after the item block so the item keeps its block index (its done state is keyed `t6.l1#<blockIndex>`).
    {
      type: 'protege',
      title: 'Sam explains what an MoE holds in memory',
      setup: 'Sam is sizing a DeepSeek-V3 deployment and drafted this for the capacity review.',
      sentences: [
        'DeepSeek-V3 has 671B parameters in all, and about 37B of them are used for each token.',
        'The router sends each token to 8 of its 256 routed experts, and the shared expert runs for every token.',
        'At FP8, one token\'s decode step reads about 37 GB of weights, which is why an MoE decodes fast for its size.',
        'So the deployment needs HBM for about 37 GB of weights, since the other experts sit idle for that token.',
        'Under expert parallelism each expert lives on one GPU, so tokens travel to their experts and back in two all-to-alls per MoE layer.',
      ],
      falseAt: 3,
      find: {
        offer: [0, 2, 3, 4],
        why: [
          'True: 671B in all and about 37B active per token are DeepSeek-V3\'s published figures.',
          'True: at one byte per FP8 weight, the 37B active parameters are about 37 GB read for one token, against 671 GB for a dense model of the same size.',
          'False: the next token may route to any expert, so every one of the 671B parameters stays resident, about 671 GB at FP8. Active parameters set the bytes a step reads, not the bytes the deployment holds.',
          'True: a dispatch and a combine all-to-all per MoE layer move each token to its experts and its results back.',
        ],
      },
      tag: {
        q: 'Which mistaken idea sits behind the false sentence?',
        options: [
          'Counting the dense layers as MoE layers in the all-to-all count',
          'Treating an FP8 weight as two bytes in place of one',
          'Sizing memory by the active parameters in place of the total',
          'Believing the shared expert runs only when the router picks it',
        ],
        correct: [2],
        why: [
          'A real mix-up, but not this one: sentence 5 says per MoE layer, which leaves the 3 dense layers out, and sentence 4 is about memory.',
          'Not this one: sentence 3 counts one byte per FP8 weight, which is right, and sentence 4 keeps the same rate.',
          'Right: the active count is per token, and the tokens of a batch, and the next step, pick other experts. Memory has to hold the total.',
          'Not this one: sentence 2 says the shared expert runs for every token, and sentence 4 is about the routed ones.',
        ],
      },
      fix: {
        q: 'Which sentence should replace sentence 4?',
        options: [
          'So the deployment holds about 37 GB in HBM and pulls in other experts from host memory as tokens need them.',
          'So the deployment holds about 296 GB, the 37B active parameters times the 8 experts each token visits.',
          'So the deployment holds about 74 GB, two bytes for each of the 37B active parameters at FP8.',
          'So the deployment holds about 671 GB of weights in HBM, since the next token may route to any expert.',
        ],
        correct: [3],
        why: [
          'Wrong: an expert pulled over PCIe when a token routes to it takes far longer than the step it serves, so the capacity review has to count every expert as resident.',
          'Wrong: the 37B already counts the 8 routed experts a token visits, so multiplying by 8 counts them again, and it still leaves out the experts no token picked.',
          'Wrong: FP8 is one byte per weight, and the total, not the active count, is what has to be resident.',
          'Right: 671B parameters at one byte each is about 671 GB, which has to stay resident. The item just above asks both numbers on fresh models: the bytes a step reads and the bytes that must stay resident.',
        ],
      },
      kcs: ['t6.moe-active-params'],
    },
    {
      type: 'prose',
      md: `## MLA: the other half of the DeepSeek trick

T5.L4 taught you KV bytes/token = 2 × layers × kv_dim × bytes, and Llama-3-70B's 327,680 B/token (320 KiB). DeepSeek's **Multi-head Latent Attention (MLA)** rewrites that line: instead of caching per-head K and V, the model stores one shared low-rank **latent vector** per token *per layer* (~576 elements: a 512-dim compressed latent plus a 64-dim RoPE key) and reconstructs per-head K/V on the fly with small up-projection matrices. KV cache per token: 576 × 2 B (BF16) = 1,152 B per layer × 61 layers = **70,272 B (≈68.6 KiB)**, against 327,680 B (320 KiB) for Llama-3-70B — about 4.7× smaller. The "×smaller than MHA" figure needs a baseline: the same 70B with full MHA (64 KV heads, 2 × 80 × 8192 × 2 B = 2,621,440 B per token) would be ≈37× bigger than MLA's 70,272 B.

Run T5.L4's arithmetic again with 70,272 B per token: the "cache is the payload" conclusion intensifies *less*, long context gets ~4.7× cheaper than Llama-3-70B, and the EP144 decode fleet can hold the giant batches that expert load-balancing requires. MLA is not an optimization bolted onto MoE — it is what *enables* the batch sizes MoE wants. When you design a serving stack, per-token KV bytes is the first number you ask for, and "what attention variant?" is why you had to ask.`,
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
          breaks: 'A service router picks a shard once per request; the MoE router picks the top-k experts for each token at each MoE layer, and under expert parallelism each pick is a network trip (a dispatch and a combine all-to-all, 2 × 58 = 116 per forward pass in DeepSeek-V3).',
        },
        {
          os: 'hot partition → fleet-wide straggler',
          osLine: 'One overloaded shard makes every fan-out request miss its p99.',
          llm: 'hot expert → combine-barrier stall',
          llmLine: 'One popular expert makes the whole batch wait at the all-to-all.',
          breaks: 'A hot service shard can be hedged, retried elsewhere or split by key; a token\'s experts are fixed by the router and each lives on one GPU, so the remedies are bigger batches or EPLB copies of the hot expert, which cost HBM.',
        },
        {
          os: 'session affinity for cache locality',
          osLine: 'Sticky routing so the same user lands on the warm shard.',
          llm: 'EP-aware batching / EPLB',
          llmLine: 'Shape traffic so experts stay balanced and tokens travel less.',
          breaks: 'Session affinity trades balance for locality by pinning a user to one warm shard; EPLB trades memory for balance, copying hot experts onto more GPUs and packing the copies evenly, while the router still decides where each token goes.',
        },
      ],
      principle:
        'A fan-out runs at the speed of its slowest branch. In MoE the router decides per token, the network carries each decision, and the finish time of a layer follows the busiest GPU, not the average.',
      breakItem: {
        q: 'MoE is mapped onto a fleet of sharded services. Where does that mapping break?',
        options: [
          'A hot shard delays the whole fan-out request, and a hot expert delays the whole layer while other GPUs wait at the barrier',
          'A front-end router splits traffic so each shard sees part of it, and the MoE router splits tokens so each expert sees part of them',
          'A service router chooses one shard per request, and the MoE router chooses its top-k experts for each token at each MoE layer',
          'Sticky routing keeps related requests near their warm state, and EP-aware batching keeps tokens near the experts serving them',
        ],
        correct: [2],
        why: [
          'This holds on both sides: a fan-out finishes when its slowest branch does, whether that is a hot shard or the GPU holding a hot expert. The pair says exactly this, so it is not where the analogy stops.',
          'This holds on both sides: a router in front gives each shard, or each expert, a share of the work. The analogy agrees here; the difference is how often the router decides.',
          'Right: a service router decides once per request, while the MoE router decides for each token at each MoE layer, and under expert parallelism each decision costs a dispatch and a combine all-to-all. That is 2 × 58 = 116 trips per forward pass in DeepSeek-V3.',
          'This holds on both sides: placing related work near the state or the experts it needs saves traffic. The pair claims this, so it is a match; EPLB differs in its goal, which is balance.',
        ],
      },
      kcs: ['t6.moe-active-params', 't6.all-to-all'],
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The core inference-economic win of MoE is…',
          options: [
            'Shrinking the total parameter count a lot, letting the whole model fit on fewer GPUs and cost less to store and serve',
            'Running a small top-k subset of experts for each token, leaving active parameters far below the total capacity',
            'Replacing most attention layers with a cheap router lookup, cutting the quadratic attention cost on long prompts',
            'Quantizing expert FFNs harder than dense ones, reaching the same quality with far fewer bits per weight',
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
          kcs: ['t6.moe-active-params'],
        },
        {
          q: 'The all-to-all problem refers to…',
          options: [
            'Copying expert weights between GPUs after each router rebalance, stalling decode every time one happens',
            'Sending tokens to their experts\' GPUs and the results back twice per layer, adding network cost as depth grows',
            'Broadcasting the full router score matrix to each device, letting each GPU pick top-k experts for any token',
            'Exchanging gradients across data-parallel replicas after each step, demanding a faster fabric than dense models',
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
          kcs: ['t6.all-to-all'],
        },
        {
          q: 'MLA\'s contribution to serving economics is…',
          options: [
            'Fusing attention kernels to read the KV cache faster, finishing each decode step sooner at equal cache size',
            'Caching one shared low-rank latent per layer, shrinking the KV cache and letting far bigger batches fit',
            'Skipping low-scoring attention heads with a learned gate, cutting both the attention math and the KV bytes',
            'Storing the KV cache at lower precision, halving bytes per token while the cache layout stays unchanged',
          ],
          correct: [1],
          explanation:
            'MLA caches one low-rank latent vector per token per layer (512 compressed dims plus a 64-dim RoPE key) instead of per-head K/V. It shrinks the cache ~4.7× against Llama-3-70B, which is what lets the decode fleet hold the giant uniform batches MoE wants. Cache bytes/token is the first number to ask about any new model.',
          why: [
            'MLA changes what is cached, not how fast it is read. Faster kernels do not shrink KV bytes per token, so they do not raise how many sequences fit in HBM.',
            'Right: the ~576-element latent is cached per layer (576 × 2 B = 1,152 B), so 61 layers give 70,272 B per token, about 4.7× less than Llama-3-70B\'s 327,680 B, and much bigger batches fit.',
            'MLA skips no heads. It keeps all of them and rebuilds each head\'s K and V from the shared latent with up-projections; the saving is stored bytes, not skipped compute.',
            'FP8 KV is a precision change that halves bytes. MLA changes the cached object itself to a low-rank latent, and the two choices are independent of each other.',
          ],
          kcs: ['t5.attention-variants', 't5.kv-bytes-per-token'],
        },
        {
          q: 'A "hot expert" hurts because…',
          options: [
            'Its GPU runs out of memory for the cache, leaving requests preempted and each expert\'s batch smaller',
            'Routing collapses toward it as other experts go cold, leaving the router to send tokens there regardless of content',
            'Its GPU becomes the straggler at the combine barrier, leaving the other devices waiting on the slowest expert',
            'Replicating it onto a second GPU duplicates its weights, eating the memory the batch needed for cache',
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
          kcs: ['t6.all-to-all'],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'DeepSeek-V3 as the reference architecture',
      md: `Keep one concrete instance in your head for the rest of T6: **61 layers (3 dense + 58 MoE), hidden 7168, 256 routed experts (top-8) + 1 shared, MLA with 576-dim latent KV**. Production config (DeepSeek open-infra week, Feb 2025): prefill on EP32 with DP32, decode on EP144 with DP144, FP8 for matmul/dispatch, BF16 for MLA/combine. Published cost day: 226–278 H800 nodes serving 608B input / 168B output tokens, 56.3% KV-cache hit rate, $87k cost vs $562k theoretical revenue — the 545% margin T7.L4 dissects. Every lesson in this track generalizes from this one build.`,
    },
  ],
  kcs: ['t6.moe-active-params', 't6.all-to-all'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt:
          'A 256-expert MoE reads far fewer weight bytes per decode step than its total size. Why, and why does that not shrink the memory you must provision?',
        model:
          'Each token runs only its top-k experts (DeepSeek-V3: 8 of 256, plus one shared), so about 37B of 671B parameters are active and only those bytes are read per step. But any token may route to any expert, so every expert stays resident: bandwidth follows active parameters, capacity follows total.',
        ideas: [
          'Only the top-k experts run per token, so active parameters (about 37B of 671B) set the bytes read per step',
          'Any token can route to any expert, so all experts stay resident and capacity follows total parameters',
          'Decode speed follows active bytes while the memory bill follows total bytes',
        ],
        kcs: ['t6.moe-active-params'],
      },
      {
        prompt:
          'Why does one popular expert slow a whole MoE layer spread across 144 GPUs, and what is one remedy?',
        model:
          'Each MoE layer ends in a combine all-to-all, which is a barrier: no GPU continues until every result is back. A popular expert\'s GPU receives the most tokens and finishes last, so the other 143 wait. Bigger batches even out the load statistically, and replicating hot experts (EPLB) balances it directly.',
        ideas: [
          'The combine all-to-all is a barrier, so the slowest GPU sets the layer time',
          'A popular expert\'s GPU gets the most tokens and finishes last while the others idle',
          'Remedy: bigger batches, or replicating hot experts (EPLB)',
        ],
        kcs: ['t6.all-to-all'],
      },
    ],
  },
}

export default lesson
