import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l1',
  slug: 'transformer-internals',
  trackId: 't5',
  index: 1,
  title: 'Transformer Internals for Systems Engineers',
  minutes: 30,
  hook: 'QKV math, why the KV cache exists, FLOPs and bytes per token — the model, stripped to the parts that cost money.',
  exercise: 'sim',
  simId: 'sim-engine',
  blocks: [
    {
      type: 'prose',
      md: `You do not need to understand why transformers *work* to understand why they're *expensive*. This lesson is the model from a systems seat: what tensors flow where, what each operation costs in FLOPs and bytes, and why one specific optimization — the KV cache — creates the entire memory-management problem that T2 prepared you for. We'll use a running 8B-parameter decoder-only model (LLaMA-3-8B-shaped: 32 layers, hidden 4096, 32 attention heads) so every number is concrete.

A decoder-only transformer is a stack of L identical blocks. Each block: **attention** (mix information across positions) then an **MLP** (transform each position independently), with normalization and residuals around them. Token in, next-token distribution out. Everything expensive happens in those two components.`,
    },
    {
      type: 'prose',
      md: `## The forward pass as a cost ledger

One token flowing through one layer (hidden size \`d = 4096\`):

- **QKV projection**: \`x · W_q, x · W_k, x · W_v\` — three matmuls \`d × d\` → \`3 × 2d²\` FLOPs ≈ 100 MFLOPs. Produces the query \`q\`, key \`k\`, value \`v\` for this token.
- **Attention**: \`softmax(QKᵀ/√d_h) · V\`. Against all \`t\` previous positions: \`~4td\` FLOPs — *grows with context length*.
- **Output projection**: another \`2d²\` ≈ 33.5 MFLOPs.
- **MLP** (SwiGLU, intermediate ≈ 3.5d): three matmuls ≈ \`3 × 2 × d × 3.5d = 21d²\` ≈ 352 MFLOPs — **the MLP is about 70-80% of the layer's parameters and FLOPs (72% with full MHA, 81% for Llama-3-8B with GQA)**. Attention gets the papers; the MLP eats the budget.

Sum across 32 layers and you land at the famous rule of thumb: **~2 FLOPs per parameter per token** (2 × 8e9 = 16 GFLOPs/token for our 8B model, plus the attention term that grows with t). And the bytes: every weight is read once per token (per sequence, at batch 1) — \`2 × params\` bytes in FP16, 16 GB. You already know from T4.L3 what that means: decode at batch 1 moves 16 GB for 16 GFLOPs — arithmetic intensity ≈ 1, hard against the bandwidth wall.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '2 × params', label: 'FLOPs per token', hint: 'The Kaplan rule of thumb for decoder forward passes (attention term extra).' },
        { value: '2 × params B', label: 'weight bytes per token', hint: 'FP16: every weight read once per token at batch 1.' },
        { value: '70-80%', label: 'MLP share', hint: 'Of parameters and FLOPs (72% with MHA, 81% for Llama-3-8B). Attention is the celebrity; MLP is the workforce.' },
        { value: '∝ t', label: 'attention cost', hint: 'Per-token attention FLOPs grow linearly with context length t.' },
      ],
    },
    {
      type: 'prose',
      md: `## Why the KV cache exists

Autoregressive decode generates token \`t+1\` using tokens \`1..t\`. Naively, you'd re-run the whole prefix through the model for every new token: \`O(t)\` work per token, \`O(t²)\` per sequence — quadratic waste. But notice: the K and V vectors of past tokens **never change** (token \`i\`'s keys/values depend only on tokens \`≤ i\`, and causal masking keeps them frozen). So every engine *caches* them: after computing \`k_i, v_i\` once, store them; for the next token, compute only the new token's \`q, k, v\`, and attend against the cached history. Work per token drops from \`O(t)\` full forward passes to **one**.

The bill arrives in memory: per token, per layer, we store one K vector and one V vector of size \`d\` each:

\`\`\`text
KV bytes per token = 2 (K and V) × L (layers) × d (hidden) × bytes/elem
                   = 2 × 32 × 4096 × 2 B  =  512 KiB per token   (32 KV heads, no GQA)
\`\`\`

This worked example is an 8B-class model with full multi-head attention (32 KV heads). A 128k-token context on it: \`512 KiB × 131,072 = 64 GiB\` — *about 4× the 16 GB (≈15 GiB) of weights*. Real Llama-3-8B uses GQA with 8 KV heads and needs 128 KiB per token (T5.L4); GQA is exactly the lever that closes that gap. That single formula is the reason T5 exists. T5.L4 is entirely about it; vLLM exists because of it.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — decode step t: one new token attends to the cached past',
      height: 52,
      nodes: [
        { id: 'tok', x: 2, y: 8, w: 18, h: 10, label: 'token t+1', sub: 'embedding' },
        { id: 'qkv', x: 28, y: 8, w: 20, h: 10, label: 'QKV proj', sub: '3 × d×d matmul' },
        { id: 'kvc', x: 28, y: 30, w: 26, h: 14, label: 'KV cache (HBM)', sub: 'K,V for tokens 1..t', color: '#FB7185' },
        { id: 'attn', x: 62, y: 18, w: 18, h: 10, label: 'attention', sub: 'q·Kᵀ → softmax → ·V', color: '#A78BFA' },
        { id: 'mlp', x: 62, y: 40, w: 18, h: 8, label: 'MLP', sub: '70-80% of FLOPs' },
        { id: 'out', x: 86, y: 18, w: 12, h: 10, label: 'logits', sub: 'sample' },
      ],
      edges: [
        { from: 'tok', to: 'qkv' },
        { from: 'qkv', to: 'kvc', label: 'append k,v' },
        { from: 'kvc', to: 'attn', label: 'read ALL history' },
        { from: 'attn', to: 'out' },
        { from: 'attn', to: 'mlp' },
      ],
      steps: [
        { caption: 'Decode step: only the NEW token enters. Its q,k,v are computed once (3 matmuls) — no recomputation of the prefix.', active: ['tok', 'qkv'], edges: ['tok->qkv'] },
        { caption: 'The new k,v are APPENDED to the per-layer cache in HBM. This is the write that the KV-block manager (vLLM) must allocate space for, every token, every sequence.', active: ['kvc'], edges: ['qkv->kvc'] },
        { caption: 'Attention reads the ENTIRE cached history (t tokens × 2 × d per layer) — this read, plus the weights, is why decode is bandwidth-bound. Attention FLOPs grow ∝ t; bytes grow ∝ t.', active: ['attn', 'kvc'], edges: ['kvc->attn'] },
        { caption: 'Output projection + MLP finish the layer; ×32 layers; logits → sample → the token joins the history and the loop repeats. ITL is this loop\'s period.', active: ['mlp', 'out'], edges: ['attn->out'] },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `The KV cache is your **materialized view** — precompute the expensive join (past tokens' keys/values) and read it on every query instead of recomputing. And like materialized views, the problem is never the query — it's *storage, invalidation, and eviction*. vLLM is a storage engine for this one materialized view; PagedAttention is its page layout; continuous batching is its query scheduler. DBA instincts apply verbatim.`,
    },
    {
      type: 'prose',
      md: `## The terms that will recur, locked in

- **Prefill**: the parallel pass over the prompt that fills the cache initially — compute-bound (T4.L3). Metric: **TTFT** (time to first token).
- **Decode**: the autoregressive loop above — bandwidth-bound. Metric: **ITL/TPOT** (inter-token latency) and throughput in tok/s.
- **Context window**: max \`t\`; every "128k context" claim is a KV-cache capacity claim — 64 GiB for our 8B, before batching.
- **GQA/MQA**: grouped/multi-query attention shares K/V across query heads (8 KV heads instead of 32), cutting the cache 4× — a *capacity* optimization dressed as an architecture tweak. When a model card says GQA, read: "KV cache ÷ 4."

The remaining lessons put these to work: tokenization next (the input side), then the economics (prefill vs decode), then the memory math in full.`,
    },
    {
      type: 'exercise',
      simId: 'sim-engine',
      machine: 'transformer',
      title: 'Forward pass under the microscope',
      tasks: [
        'Step one token through the 8B model: watch QKV → attention → MLP per layer; note the MLP\'s FLOP share.',
        'Toggle the KV cache OFF: watch decode cost go quadratic in context length.',
        'Sweep context 1k → 128k: plot KV-cache GiB vs the 16 GB weight line; find the crossover.',
        'Switch 32 heads → 8 KV heads (GQA): confirm the cache shrinks 4×.',
      ],
      note: `Three numbers to keep forever: 2·params FLOPs/token, 2·params bytes/token, and 2·L·d·bytes KV/token. Every T5 lesson is arithmetic on these three.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'The KV cache exists because…',
          options: [
            'Attention scores for earlier tokens are expensive, so the engine stores the softmax weights and reuses them unchanged for every later token',
            'Under causal masking a past token\'s keys and values never change, so storing them lets each step process only the new token instead of re-running the prefix',
            'Model weights are re-read for every token, so the engine keeps the hottest weight matrices in on-chip memory next to the tensor cores',
            'The prompt is tokenized and embedded once, so the cache stores those embeddings and later steps skip the embedding lookup',
          ],
          correct: [1],
          explanation:
            'Causal attention freezes the past: k_i and v_i depend only on tokens up to i. Cache them once and each step runs one new token through the model instead of the whole prefix. Attention still reads all t cached entries, so per-step cost still grows with context. The classic time-memory trade, and the memory half becomes T5\'s whole problem.',
          why: [
            'Attention weights are not reusable: a new query gives a new softmax over all positions, so they change at every step. What stays fixed is K and V, not the scores.',
            'Right: causal masking freezes k_i and v_i, so each step projects only the new token and reads the stored history. The t-fold recompute is gone; the attention read over t entries is not.',
            'That describes a weight cache. The KV cache holds per-token activations, and weights are still streamed from HBM on each step; the cache adds reads rather than removing them.',
            'Embedding lookups are cheap table reads. The cache stores per-layer K and V, which are costly to recompute (projections at every layer), not input embeddings.',
          ],
        },
        {
          q: 'A decoder-only model has 32 layers, hidden size 4096 and 32 KV heads (full multi-head attention, no GQA), with an FP16 cache. KV cache per token is about…',
          options: [
            'About 256 KiB, because only K is stored per layer and V can be recomputed from it on demand',
            'About 512 KiB: 2 (keys and values) x 32 layers x 4096 hidden x 2 bytes per FP16 element',
            'About 1 MiB, the same product with 4 bytes per element because the softmax runs in FP32',
            'About 128 KiB, because Llama-3-8B shares 8 KV heads across query heads and so the same saving applies here',
          ],
          correct: [1],
          explanation:
            '2 x L x d x bytes = 2 x 32 x 4096 x 2 = 524,288 B, about 512 KiB per token, with every query head keeping its own K and V. At 128k context that is 64 GiB, about 4x the weights. Real Llama-3-8B uses 8 KV heads and needs 128 KiB (T5.L4).',
          why: [
            'V cannot be derived from K: they come from different projection matrices, so both must be stored. Dropping V halves the true figure.',
            'Right: K and V per layer, 32 layers, 4096 elements each, 2 bytes per FP16 element gives 524,288 B. This is the no-GQA case, with 32 KV heads.',
            'The cache stores K and V in the model\'s KV dtype, here FP16 at 2 bytes. Softmax precision is a separate matter and does not change what is stored.',
            'That is real Llama-3-8B with GQA. The question stipulates 32 KV heads, so there is no sharing; with 8 KV heads the figure would indeed drop 4x.',
          ],
        },
        {
          q: 'Where do most of a transformer layer\'s parameters and FLOPs live?',
          options: [
            'In attention: the Q, K, V and output projections plus the softmax over the context, since attention is the defining operation',
            'In the MLP: its three SwiGLU matrices hold about 70-80% of the layer\'s parameters and FLOPs',
            'In the layer norms and residual adds, which run on every token twice per layer',
            'In the embedding and output tables: one 128k x 4096 matrix is about 0.5B parameters of an 8B model, touched on every step',
          ],
          correct: [1],
          explanation:
            'SwiGLU MLPs with about 3.5d intermediate width dominate the parameter count. Attention gets the research attention; the MLP gets the transistor budget, a useful bias when reading optimization papers.',
          why: [
            'Attention is famous, not large: its four d x d projections are well under half the layer\'s weights, and the context-length term only overtakes the matmuls at long context.',
            'Right: three matrices of roughly d x 3.5d beat the four d x d attention projections, about 10.5 d^2 against 4 d^2, so 72% with MHA and 81% for GQA Llama-3-8B.',
            'Norms and residuals hold a few thousand parameters and do elementwise work. Frequent but tiny; they are memory-bound filler, not the FLOP budget.',
            'The tables sit outside the layers, so they cannot be where the layer\'s parameters live. Even counting them, they are a small share of an 8B model.',
          ],
        },
        {
          q: 'GQA (grouped-query attention) matters to a serving engineer because it…',
          options: [
            'Drops attention heads whose scores are small at inference time, so the model does less work per token and the cache holds fewer positions',
            'Lets several query heads share one key and value head, so cache size and per-step reads fall by the group factor (32 to 8 KV heads is 4x)',
            'Stores K and V in FP8 inside the attention kernel, halving cache bytes and bandwidth with the model unchanged',
            'Limits each query head to a window of recent tokens, so the cache stops growing once the window is full',
          ],
          correct: [1],
          explanation:
            '8 KV heads instead of 32 query heads: KV cache divided by 4 and per-token KV reads divided by 4. On a bandwidth-bound decode loop that is a direct throughput and capacity win, paid for at training time.',
          why: [
            'GQA prunes nothing at inference. All query heads still run; only the number of distinct K/V heads is smaller, which is fixed when the model is trained.',
            'Right: query heads in a group read the same K and V, so the stored KV dimension shrinks by the group factor and decode reads that many fewer bytes per step.',
            'That is KV-cache quantization, a separate lever that changes bytes per element. GQA keeps the element type and cuts the number of KV heads instead.',
            'That is sliding-window attention, which changes what each token may attend to. GQA still attends over the full context and keeps every position cached.',
          ],
        },
      ],
    },
  ],
}

export default lesson
