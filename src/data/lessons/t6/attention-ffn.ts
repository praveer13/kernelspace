import type { Lesson } from '../types'

/**
 * t6.l12 (docs/specs/wave-3.md §16.2, task 3s-03): attention-FFN disaggregation. Read after t6.l9 and before the
 * t6.l10 spiral; t6.l11 is reserved for a later lesson (PLAN-100X §9), so the id skips it. The statline's figures are
 * the lazy claims `bench.step3.afd-decode`, `bench.step3.dsv3-decode` and `bench.megascale-infer.per-gpu`
 * (claims/lazy/serving3.ts); every other number is the papers' own (Step-3 arXiv 2507.19427v1, MegaScale-Infer arXiv
 * 2504.02263v4) or worked from them in the text.
 */
const lesson: Lesson = {
  id: 't6.l12',
  slug: 'attention-ffn',
  trackId: 't6',
  index: 12,
  title: 'Attention–FFN Disaggregation: Splitting Inside the Layer',
  minutes: 30,
  hook: 'P/D disaggregation split a request in time. Attention–FFN disaggregation splits every decode layer in space: attention keeps the KV cache, the experts get their own GPUs, and micro-batches cross the network twice per layer.',
  exercise: 'read+quiz',
  verifiedAt: '2026-10',
  blocks: [
    {
      type: 'prose',
      md: `T5.L9 split prefill from decode, and T6.L3 added an encode fleet in front. Both cut a request into phases that run one after another. **Attention–FFN disaggregation (AFD)** cuts somewhere new: inside each decode layer. Attention runs on one pool of GPUs, the FFN (for an MoE model, the experts) on another, and every layer of every decode step hands the hidden states across and back.

The reason is that the two halves of a decode layer want different machines:

- **Attention** reads each sequence's own KV cache. Nothing is shared between sequences, so a bigger batch does not amortise those bytes. It is bound by HBM bandwidth and capacity, and its cost grows with context length.
- **The FFN** reads weights that every token shares, so batching amortises them. A dense FFN gets the whole batch. An MoE layer splits the batch among its experts: each expert sees about batch × top-k ÷ experts tokens.

That split is what starves MoE decode. MegaScale-Infer's own example: an A100 needs about 312 TFLOPS ÷ 2 TB/s = 156 tokens per weight read to be compute-bound. A batch of 156 on a top-2-of-8 model gives each expert 156 × 2 ÷ 8 = 39 tokens, so the experts run at about 39 ÷ 156 = 25 % of peak. More sequences per GPU would help, but each one also brings its KV cache, and HBM runs out first.`,
    },
    {
      type: 'prose',
      md: `## Pool the tokens, not the cache

AFD runs attention data-parallel on many GPUs, each holding its own sequences and their KV. Their tokens all go to a small pool of FFN GPUs, which see the **sum** of the attention side's batches. The FFN pool is sized to compute; the attention pool is sized to memory. Neither has to compromise for the other, and each can use different hardware: MegaScale-Infer put attention on memory-rich H20s and experts on compute-rich L40S, and NVIDIA's [Vera Rubin platform](https://developer.nvidia.com/blog/inside-nvidia-groq-3-lpx-the-low-latency-inference-accelerator-for-the-nvidia-vera-rubin-platform/) runs attention and KV on Rubin GPUs while Groq 3 LPX runs the FFN and MoE layers.

Two papers report what the split bought, each on its own hardware and each against its own baseline:`,
    },
    {
      type: 'statline',
      stats: [
        {
          value: '4,039 tok/s/GPU',
          label: 'Step-3 decode, 50 ms TPOT',
          hint: 'Claim bench.step3.afd-decode: Hopper, FP8, 4K context, no MTP, 32 GPUs; the peak minute (3,910 long-term). arXiv 2507.19427v1.',
        },
        {
          value: '2,324 tok/s/GPU',
          label: 'DeepSeek-V3, same setup',
          hint: 'Claim bench.step3.dsv3-decode: DeepSeek\'s published profile with expert parallelism on 128 H800s, as the Step-3 paper cites it.',
        },
        {
          value: 'up to 1.90×',
          label: 'MegaScale-Infer per GPU',
          hint: 'Claim bench.megascale-infer.per-gpu: the 317B Scaled-MoE on Ampere, BF16, at a 150 ms time-between-tokens target, against TensorRT-LLM. arXiv 2504.02263v4.',
        },
      ],
    },
    {
      type: 'prose',
      md: `## The ping-pong pipeline

A token cannot skip ahead: it needs layer *n*'s attention, then layer *n*'s experts, then layer *n + 1*'s attention. With one batch, the FFN pool idles while attention runs, attention idles while the experts run, and both idle while the hidden states cross the network. The fix is T6.L2's dual-batch overlap, stretched across two pools: split the batch into **micro-batches** and keep them in flight, so one computes on each side while another is on the wire.

How many are enough? MegaScale-Infer derives it. Let T_f be one micro-batch's compute time on the slower side and T_c one crossing. Both sides stay busy when m × T_f ≥ 2 × (T_f + T_c), so m ≥ 2 × (1 + T_c ÷ T_f). A fast fabric (T_c under half of T_f) needs 3 micro-batches; a slower one needs 4. Two never suffice, since every micro-batch spends time on the wire in both directions.

The pipeline raises throughput. It does not make a token faster: each micro-batch still waits for its own two crossings in every layer, and MegaScale-Infer notes that the pipeline can even add latency. That is why the papers state their SLOs, and why Step-3 budgets them. At a 50 ms time per output token (TPOT) with a three-stage pipeline (attention, the network, the FFN), each stage gets 50 ÷ 3 ≈ 16.6 ms per token step, and over Step-3's 61 layers that is 16.6 ÷ 61 ≈ 272 µs per layer for every stage, the network crossing included.`,
    },
    {
      type: 'prose',
      md: `## Sizing the two pools

Step-3 serves a 4K average context with **2A2F**: two attention instances and two FFN instances, 32 GPUs. It runs 6,144 sequences as three micro-batches of 2,048. As a check on the claim: 6,144 sequences each emitting a token every 50 ms is 122,880 tok/s, or 3,840 per GPU; the reported 3,910 average and 4,039 peak minute need steps a little under 50 ms at that batch.

Longer context changes one side only. At 8K each sequence's attention reads twice the KV, so Step-3 doubles the attention instances and leaves the FFN alone: **4A2F**, 48 GPUs, the same 6,144 sequences, the same per-step work for the experts and the same network traffic. Total throughput stays put, so per-GPU throughput falls to about 4,039 × 4 ÷ 6 ≈ 2,690 (the paper measured 2,643). At 32K the same rule gives 16A2F and about 4,039 × 4 ÷ 18 ≈ 900.

That is T6.L3's sizing rule again: give each pool workers in proportion to the work it does. There it sized prefill against decode, and the items below practise it on fresh numbers before you size attention against the FFN.`,
    },
    {
      type: 'item',
      title: 'Size a split with new numbers',
      family: 'prefill',
      variants: ['pd-ratio'],
    },
    {
      type: 'isomorphism',
      title: 'AFD ≡ compute/storage separation in databases',
      pairs: [
        {
          os: 'storage tier',
          osLine: 'Holds the data; sized on capacity and bandwidth (Aurora\'s storage fleet, Snowflake\'s object store).',
          llm: 'attention pool',
          llmLine: 'Holds each sequence\'s KV cache; sized on HBM capacity and bandwidth, and grown as context grows.',
          breaks: 'A storage tier hands pages to the compute that asked for them; the attention pool keeps its KV where it is and runs attention there, so the state stays put and the work comes to it.',
        },
        {
          os: 'compute warehouses',
          osLine: 'Stateless query workers sized on CPU, added or removed without moving data.',
          llm: 'FFN / expert pool',
          llmLine: 'Holds weights and no per-request state; sized on FLOPs once enough tokens are pooled.',
          breaks: 'A warehouse runs whole queries on its own schedule; the FFN pool is a stage of every layer of every decode step, so its time per micro-batch must match the attention side\'s or one of them idles.',
        },
        {
          os: 'double buffering',
          osLine: 'Fill one buffer while the other drains, so I/O hides under compute.',
          llm: 'ping-pong micro-batches',
          llmLine: 'Micro-batches alternate between the pools, so one computes on each side while another crosses the network.',
          breaks: 'Two buffers hide one transfer; a micro-batch crosses twice per layer, so the pipeline needs at least three in flight (four on a slower fabric), and it adds latency to each token while it raises throughput.',
        },
      ],
      principle:
        'Separate the state-bound tier from the compute-bound one and scale each on its own bottleneck. Databases carry over, but AFD moves small per-token activations twice per layer, so fabric latency sits on every token\'s path.',
      breakItem: {
        q: 'Attention–FFN disaggregation is mapped onto compute/storage separation in databases. Where does that mapping break?',
        options: [
          'The two tiers grow apart, and longer contexts add attention GPUs while the FFN pool keeps the same number of GPUs as before',
          'The stateful tier is sized on capacity and bandwidth, and the attention GPUs are sized on their KV cache and HBM bandwidth',
          'A query pulls pages over the network to compute, and AFD keeps KV and weights in place and sends activations each layer',
          'Stateless compute can serve many clients at once, and one FFN GPU serves the tokens pooled from several attention GPUs',
        ],
        correct: [2],
        why: [
          'This holds on both sides: storage and compute scale independently, and Step-3 adds attention instances for longer context (2A2F to 4A2F) without touching the FFN. That is the analogy working.',
          'This holds on both sides: the tier that keeps the state is sized on how much it holds and how fast it reads it. The pairs claim exactly this, so it is not a break.',
          'Right: a database moves data to the compute that needs it. AFD never moves the KV cache or the expert weights; it moves each token\'s hidden state to them and back, twice per layer, so latency per hop matters more than bulk bandwidth.',
          'This holds on both sides: a stateless tier is shared by many callers, and the FFN pool sees the sum of the attention pool\'s batches, which is the point of the split.',
        ],
      },
      kcs: ['t6.attention-ffn-split'],
    },
    {
      type: 'prose',
      md: `## When the hop eats the gain

Every layer of every decode step now crosses the network twice: Step-3 sends FP8 hidden states to the FFN pool and gets BF16 results back. That per-layer, per-token activation exchange needs a very low-latency fabric. Step-3 wrote its own GPUDirect RDMA library (StepMesh) to meet its 272 µs per-layer budget without giving any of the GPU's SMs to communication, and MegaScale-Infer wrote an M2N library that it measured at 68.2 % lower latency than NCCL. The split pays off for **MoE decode at scale**, where the experts are starved for tokens. It does not pay for a small dense model: its FFN already sees the whole batch, and a GPU or an NVLink node that runs both halves needs no network hop at all.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Why does MoE decode gain from putting attention and the experts on separate GPUs?',
          options: [
            'Decode attention is compute-bound, and moving it off the expert GPUs frees their tensor cores for the attention math',
            'Expert weights cannot sit beside a KV cache, and splitting the layer is what lets an MoE model load onto its GPUs',
            'Each expert gets a small slice of a GPU\'s tokens, and pooling many attention GPUs\' tokens fills each expert\'s batch',
            'Splitting removes the all-to-all from every layer, and tokens no longer cross the network between the two halves',
          ],
          correct: [2],
          explanation:
            'MoE splits the batch among experts, so each expert reads its weights for a few tokens and stays memory-bound. Attention cannot take a bigger batch because every sequence brings its own KV. A small FFN pool fed by many attention GPUs sees their summed batch.',
          why: [
            'Decode attention reads each sequence\'s own KV cache and is bound by memory bandwidth, not FLOPs. The split helps the FFN side, whose shared weights can be amortised over a pooled batch.',
            'Capacity is what wide expert parallelism (T6.L2) already solves by spreading experts over many GPUs. Both papers report the gain as throughput per GPU, from fuller expert batches, not as a model that now fits.',
            'Right: with top-k of E experts each expert sees about batch × k ÷ E tokens, too few to be compute-bound. Many attention GPUs feeding a few FFN GPUs give each expert the sum of their tokens.',
            'AFD keeps the exchange and makes it a network hop: hidden states go to the FFN pool and back in every layer. It hides that traffic under compute with micro-batches; it does not remove it.',
          ],
          kcs: ['t6.attention-ffn-split'],
          miss: ['t6.decode-attention-compute-bound', 't6.afd-is-for-capacity', '', 't6.afd-removes-the-exchange'],
        },
        {
          q: 'MegaScale-Infer splits each batch into micro-batches that alternate between the attention and FFN GPUs. What does that buy, and what does it cost?',
          options: [
            'Each token\'s step gets faster as the hops overlap, and the GPUs need fewer of them to serve the same traffic',
            'Both pools keep computing while other micro-batches cross the wire, and a token\'s own step gets no faster',
            'Two micro-batches keep both pools busy, as with a double buffer, and a third one adds overhead to each step',
            'The micro-batches stay inside one node, and the FFN pool no longer waits on the network between the layers',
          ],
          correct: [1],
          explanation:
            'Micro-batches fill the idle gaps: while one is on the wire, another computes on each side. Throughput rises, but each micro-batch still makes its own two crossings per layer, so per-token latency does not drop and can grow.',
          why: [
            'Overlap hides the hops from the GPUs, not from the token: each micro-batch still waits for its own two crossings in every layer. MegaScale-Infer notes the pipeline does not cut, and may add, per-token latency.',
            'Right: with enough micro-batches in flight each pool always has one to compute while others cross the network, so utilisation and throughput rise. Each token still waits for its own crossings.',
            'A micro-batch crosses twice per layer, so the paper\'s condition m ≥ 2 × (1 + T_c ÷ T_f) needs at least 3 on a fast fabric and 4 on a slower one. Two leave a pool idle while both are on the wire.',
            'The pools are separate GPUs, usually separate nodes, so every layer crosses the network. The micro-batches hide that crossing under compute; they do not avoid it.',
          ],
          kcs: ['t6.attention-ffn-split', 't6.comm-overlap'],
          miss: ['t6.pingpong-cuts-latency', '', 't6.two-microbatches-suffice', 't6.pingpong-avoids-network'],
        },
        {
          q: 'Step-3 serves a 4K context with 2 attention and 2 FFN instances of 8 GPUs at 4,039 tok/s per GPU. At 8K, attention reads twice the KV per sequence. Keeping the batch and the SLO, which deployment does the paper choose?',
          options: [
            '4 attention and 2 FFN instances, 48 GPUs, about 2,690 tok/s per GPU',
            '2 attention and 4 FFN instances, 48 GPUs in all, about 2,690 tok/s per GPU',
            '4 attention and 4 FFN instances, 64 GPUs, about 2,020 tok/s on each GPU',
            'The same 2 and 2 instances on 32 GPUs, about 2,020 tok/s per GPU',
          ],
          correct: [0],
          explanation:
            'Only attention\'s work grew, so only the attention pool grows: 4A2F. The batch, the experts\' work and the total throughput stay the same, spread over 48 GPUs instead of 32: 4,039 × 32 ÷ 48 ≈ 2,690 (measured 2,643).',
          why: [
            'Right: doubling the KV read per sequence doubles attention\'s work, so Step-3 doubles the attention instances and keeps the FFN. Total throughput holds, so per GPU it is 4,039 × 4 ÷ 6 ≈ 2,690.',
            'The FFN\'s work depends on the batch and the model, not the context: each token still visits the same experts. Growing the FFN pool leaves the slower attention side as the bottleneck.',
            'Doubling the FFN pool too adds 16 GPUs that do no extra work: the experts\' load did not change. Total throughput is the same, now spread over 64 GPUs, 4,039 × 32 ÷ 64 ≈ 2,020 per GPU.',
            'Keeping 2A2F means each attention step takes twice as long, so the SLO forces a smaller batch, and the experts lose the pooled tokens the split exists to give them. The paper scales attention instead.',
          ],
          kcs: ['t6.attention-ffn-split', 't6.epd-phases'],
          miss: ['', 't6.scale-ffn-for-context', 't6.scale-both-pools', 't6.keep-pools-halve-batch'],
        },
        {
          q: 'Which deployment is least likely to gain from attention–FFN disaggregation?',
          options: [
            'A large sparse MoE model in decode at high load, where each expert sees few tokens from any one GPU',
            'A fleet whose context lengths keep growing, where attention needs more GPUs while the expert pool does not',
            'A cluster with memory-rich GPUs and compute-rich GPUs, where each pool can take the hardware it suits',
            'A small dense model on a single node of GPUs, where its feed-forward layers already see the whole batch',
          ],
          correct: [3],
          explanation:
            'AFD pays a network hop twice per layer to give starved experts a pooled batch. A dense FFN is not starved, and one node can run both halves over NVLink, so the hop is cost without gain.',
          why: [
            'This is the case AFD was built for: MoE sparsity leaves each expert few tokens, and pooling the attention side\'s batches makes the experts compute-bound again.',
            'Decoupled scaling is one of AFD\'s gains: Step-3 adds attention instances for longer contexts (2A2F to 4A2F) and leaves the FFN pool as it is.',
            'Heterogeneous hardware is one of AFD\'s gains: MegaScale-Infer ran attention on memory-rich H20s and experts on compute-rich L40S, each pool on the hardware that fits its bottleneck.',
            'Right: a dense FFN already gets the full batch, so there is no starved expert to feed, and a network hop per layer only adds latency to every token.',
          ],
          kcs: ['t6.attention-ffn-split'],
          miss: ['t6.afd-hurts-sparse-moe', 't6.afd-cannot-scale-with-context', 't6.afd-needs-identical-gpus', ''],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'Read the SLO before the speedup',
      md: `The two headline numbers are not one comparison. MegaScale-Infer's 1.90× is decode throughput per GPU for its 317B Scaled-MoE on 80 GB Ampere GPUs in BF16, at a **150 ms** time-between-tokens target, against TensorRT-LLM (7.11× against vLLM; 1.28× over TensorRT-LLM on Mixtral 8x22B). Step-3's 4,039 is a **peak minute** at a **50 ms** TPOT on Hopper with FP8 and 4K context; its long-run average is 3,910, and its DeepSeek-V3 line (2,324) is DeepSeek's own published profile, not a run StepFun made. The Step-3 paper itself points at the gap: a 150 ms token is too slow for chat. A looser latency target lets a system run bigger batches and deeper pipelines, so before you compare two disaggregation results, line up the SLO, the precision, the context length and whose run the baseline was.`,
    },
  ],
  kcs: ['t6.attention-ffn-split', 't6.epd-phases'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Why does an MoE model\'s FFN run below its compute limit in decode, and how does attention–FFN disaggregation fix it?',
        model:
          'Each expert sees about batch × top-k ÷ experts tokens, too few to amortise its weight reads, and attention cannot take a bigger batch because every sequence brings its own KV cache. AFD runs attention on many GPUs and sends all their tokens to a few FFN GPUs, which see the summed batch and become compute-bound.',
        ideas: [
          'Sparsity splits the batch: each expert sees about batch × top-k ÷ experts tokens',
          'The batch per GPU cannot just grow, since every sequence brings its own KV cache',
          'Many attention GPUs feed a few FFN GPUs, which see the summed batch',
        ],
        kcs: ['t6.attention-ffn-split'],
      },
      {
        prompt: 'Step-3 runs 2 attention and 2 FFN instances at 4K context. What does it change at 8K, and why does per-GPU throughput fall?',
        model:
          'At 8K each sequence\'s attention reads twice the KV, so Step-3 doubles the attention instances (4A2F) and keeps the FFN pool, whose work depends on the batch, not the context. Total throughput stays the same over 48 GPUs instead of 32, so per GPU it falls to about 4,039 × 4 ÷ 6 ≈ 2,690.',
        ideas: [
          'Longer context grows only attention\'s work, so only the attention pool grows (4A2F)',
          'The FFN pool, batch and total throughput stay the same',
          'The same total over 48 GPUs instead of 32 gives about 2,690 tok/s per GPU',
        ],
        kcs: ['t6.attention-ffn-split'],
      },
    ],
  },
}

export default lesson
