import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l4',
  slug: 'kv-cache-math',
  trackId: 't5',
  index: 4,
  title: 'KV Cache Math',
  minutes: 25,
  hook: '2 × layers × hidden × bytes: the interactive calculator — why a 70B model\'s cache dominates everything, and how to size it yourself.',
  exercise: 'sim',
  simId: 'sim-kv',
  blocks: [
    {
      type: 'prose',
      md: `This is the lesson everyone quotes, because it turns "the KV cache is big" into arithmetic you can do in a meeting. One formula, five inputs, and you can answer: how many tokens fit on this GPU? Why does a 70B model need 8 GPUs for long-context chat? What does FP8 KV buy? When does the cache outweigh the weights? In the calculator below you'll derive every number live — but the napkin version fits in one line:

\`\`\`text
KV bytes per token  =  2 (K+V) × L (layers) × d_kv (KV dim) × b (bytes/elem)
\`\`\`

where \`d_kv\` = num_kv_heads × head_dim (hidden size for MHA models; smaller for GQA). That's it. Everything in this lesson is applying it.`,
    },
    {
      type: 'prose',
      md: `## Worked example one: the 8B on one GPU

LLaMA-3-8B shape: 32 layers, 8 KV heads (GQA), head_dim 128 → \`d_kv = 8 × 128 = 1024\`. FP16:

\`\`\`text
per token  = 2 × 32 × 1024 × 2 B = 131,072 B = 128 KiB
128k ctx   = 128 KiB × 131,072  = 16 GiB     (≈ the model's own FP16 weights, ≈16 GB)
4k convo   = 128 KiB × 4,096    = 0.5 GiB
\`\`\`

One 80 GB H100: 16 GB weights (FP16) + ~2 GB runtime leaves ~60 GB for KV — about **480k tokens** of cache. As 4k conversations, that's ~120 concurrent; as 128k documents, **3**. Context length is a concurrency tax, linear in both directions.`,
    },
    {
      type: 'prose',
      md: `## Worked example two: the 70B that eats a node

LLaMA-3-70B shape: 80 layers, 8 KV heads (GQA), head_dim 128 → \`d_kv = 1024\`. FP16:

\`\`\`text
per token  = 2 × 80 × 1024 × 2 B = 327,680 B = 320 KiB
weights    = 70B × 2 B           = 140 GB    (2×80 GB GPUs, nothing left for KV)
8 GPUs     = 640 GB − 140 GB     ≈ 500 GB KV ≈ 1.6 M tokens
\`\`\`

Read those numbers again: to serve 70B with serious context, you need **8 GPUs — of which the weights use barely 2, and the other ~500 GB is KV cache.** This is the sentence the course has been building toward: **at long context, the cache — not the model — is the payload.** It's why PagedAttention's waste reduction (T2.L7) was worth a famous paper, why prefix caching is a product feature, and why FP8 KV is a line item in every engine's release notes.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '2×L×d×b', label: 'the formula', hint: 'K and V × layers × KV dim × bytes/elem. All of T5.L4 in six symbols.' },
        { value: '320 KiB', label: '70B FP16 / token', hint: '80 layers, 8 KV heads × 128. GQA already included — MHA would be 8× worse.' },
        { value: '40 GiB', label: '70B 128k ctx', hint: '≈43 GB. One long document = half a GPU of cache. Capacity planning starts here.' },
        { value: '×2 / ×4', label: 'FP8 / INT4 KV', hint: 'Cache quantization multiplies token capacity directly (T4.L7).' },
      ],
    },
    {
      type: 'prose',
      md: `## The levers, priced in tokens

Every KV optimization is a multiplier on that formula. Price them:

- **GQA/MQA** — fewer KV heads: ÷4 (8 vs 32) to ÷8. Free-ish (baked into the model, small quality cost paid at training time). Already counted above; *without* GQA our 70B would need 2.5 MiB/token.
- **KV quantization (FP8/INT4)** — b: 2 B → 1 B → 0.5 B: ×2 to ×4 tokens, tiny quality cost (T4.L7). Decode reads the whole cache per token, so this *also* multiplies decode bandwidth.
- **Sliding-window attention** — cap the effective context (Mistral-style): cache stops growing at the window. Changes the model, not just the system.
- **Prefix sharing** — share the system prompt's blocks across all requests (T5.L5): one copy of your 2k-token system prompt instead of one per request. At 100 concurrent requests: ~100× on the shared part.
- **Eviction/offload** — drop or swap cold KV (H2O, SnapKV, vLLM preemption): trade quality or latency for capacity (T2.L3 in disguise).

And the formula's blind spot: it prices *residency*. The per-step **bandwidth** cost is the same bytes — decode re-reads the cache every token — so cache size simultaneously sets *how many* you serve and *how fast*. One number, two SLOs.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is your **JVM heap sizing**, one layer down: \`-Xmx\` is HBM capacity; live objects are weights; the cache is your session store growing per user; GZIP session compression is FP8 KV; and "sessions × bytes/session > heap ⇒ OOM" is exactly "concurrent × context × 2Ld > HBM ⇒ preemption." You have done this capacity review before. The only new part is that the sessions cost 320 KiB per *token*.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Don't confuse the two memory walls. **Capacity wall:** concurrent × context × per-token bytes > HBM → can't admit more requests (solve with paging, quant, offload). **Bandwidth wall:** per-step reads of weights+KV > what latency allows → ITL blows the SLO (solve with batching, quant, shorter cache). Teams routinely fix the wrong one: more replicas do not speed ITL; sharding one model across GPUs can, until communication dominates; faster kernels don't add capacity. Name the wall before you buy the fix.`,
    },
    {
      type: 'prose',
      md: `## In the calculator

Plug in any model shape and watch the numbers move: independently choose weight and KV precision, scale from one GPU to a node, and compare aggregate HBM capacity with aggregate bandwidth. The calculator reports both the capacity-limited concurrency and the bandwidth-derived ITL floor, then names which wall arrives first. The goal is that by the end you trust your own arithmetic more than any vendor chart.`,
    },
    {
      type: 'exercise',
      simId: 'sim-kv',
      machine: 'calc',
      title: 'KV-cache calculator',
      taskIds: ['kv.bytes-per-token', 'kv.gqa', 'kv.oom-context', 'kv.fp8-rescue', 'kv.max-batch'],
      tasks: [
        'Predict the KV cache one token costs for Llama-3-70B at FP16, set the calculator up, press Run, then explain which inputs the number depends on.',
        'Predict what one 128k-token request would cost if Llama-3-8B had a KV head for every query head, then run it and explain what GQA changes.',
        'Predict the longest context one request can reach with Llama-3-70B at FP8 weights on a single H100, then run it and explain where the budget goes.',
        'Predict how many 32k-token requests fit when the 70B runs FP8 weights and FP8 KV on four H100s, then run it and explain what FP8 changed and what it left alone.',
        'Predict how many 32k-token requests Llama-3-8B fits on two H100s, then run it, read the capacity and bandwidth walls, and say which arrives first.',
      ],
      note: `Six symbols — 2, L, d_kv, b — explain why long context is expensive, why GQA and FP8 KV ship in every engine, and why "how many GPUs" is a cache question as much as a weights question. Capacity and bandwidth are separate limits: size both before choosing a fix. T5.L5 shows how vLLM manages this memory; T5.L6 how cached prefixes reuse it; T5.L7 how it is scheduled.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'KV bytes per token equals…',
          options: [
            'Parameters x bytes per element (the weights), because the cache is a working copy of the weights each token touches',
            '2 (K and V) x layers x KV dimension x bytes per element, stored once for every token in the context',
            '2 x layers x hidden size x context length x bytes, since the cache is per sequence and context length belongs in the formula',
            'Vocabulary size x hidden size x 4 (bytes per float), one embedding row stored per cached token and looked up at each step',
          ],
          correct: [1],
          explanation:
            'Per token, every layer stores one K and one V vector of d_kv = kv_heads x head_dim elements. 2 x L x d_kv x b is the most useful formula in serving; multiply by context length to size a sequence.',
          why: [
            'Weights are fixed per model. The cache grows with every token generated, so it cannot be params x bytes; it depends on layers, KV heads, head size and dtype.',
            'Right: one K and one V vector of d_kv (kv heads x head dim) elements per layer per token, times bytes per element. Multiplying by tokens in flight gives total cache size.',
            'That is a per-sequence total, not a per-token figure: context length multiplies the per-token bytes afterwards. It also uses hidden size, which overcounts when GQA makes d_kv smaller.',
            'The embedding table is read once per token at the input and is not stored per cached token. The cache holds per-layer K and V, not embedding rows.',
          ],
        },
        {
          q: 'For a 70B FP16 model (80 layers, d_kv = 1024), a single 128k-token context costs about…',
          options: [
            'About 20 GiB: 80 layers x 1024 x 2 bytes x 131,072 tokens, counting only the K tensor',
            'About 320 GiB: 2.5 MiB per token, as if all 64 heads stored their own K and V with no GQA',
            'About 40 GiB: 2 x 80 layers x 1024 x 2 bytes = 320 KiB per token, x 131,072 tokens',
            'About 130 GiB, the same as the FP16 weights, since a full-context cache and the model are the same size',
          ],
          correct: [2],
          explanation:
            '2 x 80 x 1024 x 2 B = 320 KiB per token; x 131,072 is 40 GiB (about 43 GB). One long document is half an H100 of cache. Long context is a capacity product, not a quality feature.',
          why: [
            'That drops V. Both K and V are stored, so the per-token figure has a factor of 2 and the total is about double this.',
            'That is full multi-head attention. Llama-3-70B has 8 KV heads (d_kv = 1024), so GQA already cuts the 2.5 MiB figure 8x to 320 KiB per token.',
            'Right: 2 (K and V) x 80 layers x 1024 x 2 bytes is 327,680 B (320 KiB) per token, and 131,072 tokens of that is 40 GiB.',
            'Only the 8B model at 128k comes close: its FP16 weights are ≈16 GB (≈15 GiB), its cache 16 GiB. For the 70B, weights are about 130 GiB and the cache 40 GiB.',
          ],
        },
        {
          q: 'GQA reduces KV-cache size by…',
          options: [
            'Compressing stored K and V with a lossless codec (such as zstd or zlib) after each write, and decompressing inside the attention kernel',
            'Sharing K/V across groups of query heads, so the KV dimension shrinks by the group factor (32 to 8 heads is 4x) and the cache with it',
            'Storing K and V in FP8 instead of FP16 (a per-tensor scale), which halves the bytes per element and is applied when the model is loaded',
            'Skipping a fixed fraction of layers (for example alternate layers) when writing the cache, so only some layers contribute K and V for each token',
          ],
          correct: [1],
          explanation:
            'd_kv = kv_heads x head_dim; fewer KV heads divides the per-token bytes (and the per-step cache reads) by the same factor. It is a training-time trade that serving inherits gratefully.',
          why: [
            'GQA is a model architecture, not a codec. Decompressing in the kernel would add work to every step, whereas fewer KV heads cut both stored and read bytes.',
            'Right: several query heads read one shared K/V head, so d_kv falls by the group factor and the per-token cache falls with it.',
            'That is KV quantization, a separate multiplier on bytes per element. GQA leaves the element type alone and reduces how many K/V heads exist.',
            'Every layer still writes K and V for every token. GQA keeps all layers and shrinks the number of K/V heads within each one.',
          ],
        },
        {
          q: 'You add GPUs as extra independent replicas of the same model. Which number stays the same for a request that is already being served, at the same per-replica batch size?',
          options: [
            'Fleet capacity: the number of concurrent requests (sequences) the fleet can keep resident in KV cache at the same moment',
            'Time between tokens (ITL): each step still reads the same weight and KV bytes at the same HBM bandwidth',
            'Goodput: requests per second the fleet can serve within its TTFT and ITL targets (as load grows past one GPU)',
            'Fleet throughput: tokens generated per second (across every replica) running in parallel',
          ],
          correct: [1],
          explanation:
            'Replicas add capacity and aggregate throughput, but one request still runs on one replica at that replica\'s bandwidth, so at the same per-replica batch size its ITL is unchanged. Sharding one model across GPUs (tensor parallelism) is different: it cuts bytes read per GPU per step, at the cost of communication.',
          why: [
            'Each replica brings its own HBM and therefore its own KV blocks, so the fleet admits proportionally more concurrent requests.',
            'Right: at the same per-replica batch, a step does the same work as before, so ITL is unchanged. Only sharding the model (tensor parallelism) shortens a step.',
            'More replicas absorb more load before queues build, so goodput at a given SLO rises with replica count.',
            'Independent replicas run in parallel, so aggregate tokens per second grows roughly with replica count.',
          ],
        },
      ],
    },
  ],
}

export default lesson
