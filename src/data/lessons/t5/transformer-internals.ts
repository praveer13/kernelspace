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
- **Output projection**: another \`2d²\` ≈ 67 MFLOPs.
- **MLP** (SwiGLU, intermediate ≈ 3.5d): three matmuls ≈ \`6d² × 3.5 / 2 …\` ≈ 470 MFLOPs — **the MLP is ~2/3 of the layer's parameters and FLOPs**. Attention gets the papers; the MLP eats the budget.

Sum across 32 layers and you land at the famous rule of thumb: **~2 FLOPs per parameter per token** (2 × 8e9 = 16 GFLOPs/token for our 8B model, plus the attention term that grows with t). And the bytes: every weight is read once per token (per sequence, at batch 1) — \`2 × params\` bytes in FP16, 16 GB. You already know from T4.L3 what that means: decode at batch 1 moves 16 GB for 16 GFLOPs — arithmetic intensity ≈ 1, hard against the bandwidth wall.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '2 × params', label: 'FLOPs per token', hint: 'The Kaplan rule of thumb for decoder forward passes (attention term extra).' },
        { value: '2 × params B', label: 'weight bytes per token', hint: 'FP16: every weight read once per token at batch 1.' },
        { value: '~2/3', label: 'MLP share', hint: 'Of parameters and FLOPs. Attention is the celebrity; MLP is the workforce.' },
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
                   = 2 × 32 × 4096 × 2 B  =  512 KB per token   (8B model)
\`\`\`

A 128k-token context on this model: \`512 KB × 131,072 = 64 GB\` — *bigger than the 16 GB of weights*. That single formula is the reason T5 exists. T5.L4 is entirely about it; vLLM exists because of it.`,
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
        { id: 'mlp', x: 62, y: 40, w: 18, h: 8, label: 'MLP', sub: '~2/3 of FLOPs' },
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
- **Context window**: max \`t\`; every "128k context" claim is a KV-cache capacity claim — 64 GB for our 8B, before batching.
- **GQA/MQA**: grouped/multi-query attention shares K/V across query heads (8 KV heads instead of 32), cutting the cache 4× — a *capacity* optimization dressed as an architecture tweak. When a model card says GQA, read: "KV cache ÷ 4."

The remaining lessons put these to work: tokenization next (the input side), then the economics (prefill vs decode), then the memory math in full.`,
    },
    {
      type: 'exercise',
      simId: 'sim-engine',
      title: 'Forward pass under the microscope',
      tasks: [
        'Step one token through the 8B model: watch QKV → attention → MLP per layer; note the MLP\'s FLOP share.',
        'Toggle the KV cache OFF: watch decode cost go quadratic in context length.',
        'Sweep context 1k → 128k: plot KV-cache GB vs the 16 GB weight line; find the crossover.',
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
            'GPUs need a cache to run attention',
            'Past tokens\' K/V vectors never change, so caching them converts decode from O(t²) recompute per sequence to O(1) new work per token — at the cost of memory',
            'Weights can\'t be stored in HBM',
            'Softmax requires it',
          ],
          correct: [1],
          explanation:
            'Causal attention freezes the past: k_i, v_i depend only on tokens ≤ i. Cache them once; compute only the new token each step. The classic time-memory trade — and the memory half becomes T5\'s entire problem.',
        },
        {
          q: 'For an 8B FP16 model (32 layers, d=4096), KV cache per token is…',
          options: [
            '~16 KB',
            '~512 KB — 2 (K,V) × 32 layers × 4096 hidden × 2 bytes',
            '~16 MB',
            '~64 GB',
          ],
          correct: [1],
          explanation:
            '2 × L × d × bytes = 2×32×4096×2 = 524,288 B ≈ 512 KB per token. At 128k context that\'s 64 GB — 4× the weights. This is why "long context" is a memory-capacity feature.',
        },
        {
          q: 'Where do most of a transformer layer\'s parameters and FLOPs live?',
          options: ['The attention projections', 'The MLP (~2/3 of both)', 'The layer norms', 'The embedding table'],
          correct: [1],
          explanation:
            'SwiGLU MLPs with ~3.5d intermediate width dominate the parameter count. Attention gets the research attention; the MLP gets the transistor budget — a useful bias when reading optimization papers.',
        },
        {
          q: 'GQA (grouped-query attention) matters to a serving engineer because it…',
          options: [
            'Improves model quality',
            'Shares K/V across query head groups, cutting KV-cache size (and its per-token bandwidth) by the group factor — a capacity/throughput optimization',
            'Reduces FLOPs per token by half',
            'Removes the need for positional encoding',
          ],
          correct: [1],
          explanation:
            '8 KV heads instead of 32 query heads → KV cache ÷ 4, per-token KV reads ÷ 4. On a bandwidth-bound decode loop that is a direct throughput and capacity win.',
        },
      ],
    },
  ],
}

export default lesson
