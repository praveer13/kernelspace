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
per token  = 2 × 32 × 1024 × 2 B = 131,072 B = 128 KB
128k ctx   = 128 KB × 131,072   ≈ 16 GB      (== the model's own weights)
4k convo   = 128 KB × 4,096     ≈ 0.5 GB
\`\`\`

One 80 GB H100: 16 GB weights (FP16) + ~2 GB runtime leaves ~60 GB for KV — about **480k tokens** of cache. As 4k conversations, that's ~120 concurrent; as 128k documents, **3**. Context length is a concurrency tax, linear in both directions.`,
    },
    {
      type: 'prose',
      md: `## Worked example two: the 70B that eats a node

LLaMA-3-70B shape: 80 layers, 8 KV heads (GQA), head_dim 128 → \`d_kv = 1024\`. FP16:

\`\`\`text
per token  = 2 × 80 × 1024 × 2 B = 327,680 B = 320 KB
weights    = 70B × 2 B           = 140 GB    (2×80 GB GPUs, nothing left for KV)
8 GPUs     = 640 GB − 140 GB     ≈ 500 GB KV ≈ 1.6 M tokens
\`\`\`

Read those numbers again: to serve 70B with serious context, you need **8 GPUs — of which the weights use barely 2, and the other ~500 GB is KV cache.** This is the sentence the course has been building toward: **at long context, the cache — not the model — is the payload.** It's why PagedAttention's waste reduction (T2.L7) was worth a famous paper, why prefix caching is a product feature, and why FP8 KV is a line item in every engine's release notes.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '2×L×d×b', label: 'the formula', hint: 'K and V × layers × KV dim × bytes/elem. All of T5.L4 in six symbols.' },
        { value: '320 KB', label: '70B FP16 / token', hint: '80 layers, 8 KV heads × 128. GQA already included — MHA would be 8× worse.' },
        { value: '40 GB', label: '70B 128k ctx', hint: 'One long document = half a GPU of cache. Capacity planning starts here.' },
        { value: '×2 / ×4', label: 'FP8 / INT4 KV', hint: 'Cache quantization multiplies token capacity directly (T4.L7).' },
      ],
    },
    {
      type: 'prose',
      md: `## The levers, priced in tokens

Every KV optimization is a multiplier on that formula. Price them:

- **GQA/MQA** — fewer KV heads: ÷4 (8 vs 32) to ÷8. Free-ish (baked into the model, small quality cost paid at training time). Already counted above; *without* GQA our 70B would need 2.6 MB/token.
- **KV quantization (FP8/INT4)** — b: 2 B → 1 B → 0.5 B: ×2 to ×4 tokens, tiny quality cost (T4.L7). Decode reads the whole cache per token, so this *also* multiplies decode bandwidth.
- **Sliding-window attention** — cap the effective context (Mistral-style): cache stops growing at the window. Changes the model, not just the system.
- **Prefix sharing** — share the system prompt's blocks across all requests (T5.L5): one copy of your 2k-token system prompt instead of one per request. At 100 concurrent requests: ~100× on the shared part.
- **Eviction/offload** — drop or swap cold KV (H2O, SnapKV, vLLM preemption): trade quality or latency for capacity (T2.L3 in disguise).

And the formula's blind spot: it prices *residency*. The per-step **bandwidth** cost is the same bytes — decode re-reads the cache every token — so cache size simultaneously sets *how many* you serve and *how fast*. One number, two SLOs.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `This is your **JVM heap sizing**, one layer down: \`-Xmx\` is HBM capacity; live objects are weights; the cache is your session store growing per user; GZIP session compression is FP8 KV; and "sessions × bytes/session > heap ⇒ OOM" is exactly "concurrent × context × 2Ld > HBM ⇒ preemption." You have done this capacity review before. The only new part is that the sessions cost 320 KB per *token*.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Don't confuse the two memory walls. **Capacity wall:** concurrent × context × per-token bytes > HBM → can't admit more requests (solve with paging, quant, offload). **Bandwidth wall:** per-step reads of weights+KV > what latency allows → ITL blows the SLO (solve with batching, quant, shorter cache). Teams routinely fix the wrong one: more GPUs don't speed ITL; faster kernels don't add capacity. Name the wall before you buy the fix.`,
    },
    {
      type: 'prose',
      md: `## In the calculator

Plug in any model shape and watch the numbers move: weights vs cache, tokens-per-GPU, concurrency vs context trade-offs, and the effect of every lever (GQA, FP8, windowing, prefix sharing). The goal is that by the end you trust your own arithmetic more than any vendor chart.`,
    },
    {
      type: 'exercise',
      simId: 'sim-kv',
      title: 'KV-cache calculator',
      tasks: [
        'Reproduce the 8B numbers: verify 128 KB/token and ~480k tokens on one 80 GB GPU.',
        'Model the 70B on 8 GPUs: show weights ≈ 2 GPUs, KV ≈ 6 GPUs of the 8.',
        'Flip FP16 → FP8 KV and 32 → 8 KV heads: rank the levers by tokens gained.',
        'Find the concurrency limit for 32k-context chat on 2 GPUs; state whether you hit the capacity or bandwidth wall first.',
      ],
      note: `Six symbols — 2, L, d_kv, b — explain why long context is expensive, why GQA and FP8 KV ship in every engine, and why "how many GPUs" is a cache question as much as a weights question. T5.L5 shows how vLLM manages this memory; T5.L6 how it\'s scheduled.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'KV bytes per token equals…',
          options: [
            'params × bytes',
            '2 (K+V) × layers × KV-dim × bytes/elem',
            'vocab × hidden × 4',
            'context length × bytes',
          ],
          correct: [1],
          explanation:
            'Per token, every layer stores one K and one V vector of d_kv = kv_heads × head_dim elements. 2 × L × d_kv × b — the most useful formula in serving.',
        },
        {
          q: 'For a 70B FP16 model (80 layers, d_kv=1024), a single 128k-token context costs about…',
          options: ['1 GB', '10 GB', '40 GB — 320 KB × 131,072', '140 GB'],
          correct: [2],
          explanation:
            '2×80×1024×2 B = 320 KB/token; ×131,072 ≈ 40 GB. One long document = half an H100 of cache. Long context is a capacity product, not a quality feature.',
        },
        {
          q: 'GQA reduces KV-cache size by…',
          options: [
            'Compressing the cache with zlib',
            'Sharing K/V across groups of query heads — KV-dim shrinks by the group factor (32→8 heads = ÷4)',
            'Skipping layers',
            'Using smaller vocabularies',
          ],
          correct: [1],
          explanation:
            'd_kv = kv_heads × head_dim; fewer KV heads divides the per-token bytes (and the per-step cache reads) by the same factor — a training-time trade that serving inherits gratefully.',
        },
        {
          q: 'More GPUs with the same model will NOT improve which metric?',
          options: [
            'Concurrent request capacity',
            'Per-token decode latency (ITL) — that\'s set by per-step bytes ÷ bandwidth, not by how many tokens fit',
            'Maximum context length served',
            'Goodput under SLO',
          ],
          correct: [1],
          explanation:
            'Capacity scales with total HBM; ITL is a per-step bandwidth/efficiency number. Name the wall — capacity or bandwidth — before buying the fix.',
        },
      ],
    },
  ],
}

export default lesson
