import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l6',
  slug: 'speculative-production',
  trackId: 't6',
  index: 6,
  title: 'Speculative Decoding in Production: MTP, EAGLE, and the Acceptance Economy',
  minutes: 25,
  hook: 'T5.L8 taught the draft-verify trick. Production made it stranger: the draft is now the model\'s own head (MTP), acceptance rate is a designed quantity, and on MoE the win is 2–3× interactivity, not 1.5×.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T5.L8's mechanics stand: draft k tokens cheaply, verify in one parallel pass, accept the longest agreeing prefix, lose nothing. What production changed is the *draft*. Three shapes now:

- **Draft model** (T5.L8's version): a small sibling model. Simple, but the drafter is a second model to host, version, and keep distribution-aligned — and it doesn't share the target's KV cache, so verify cost includes extra bookkeeping.
- **Medusa heads**: small extra output heads on the target model predicting tokens t+1..t+k in parallel. One model, one cache — but the heads are shallow predictors; acceptance drops on hard text.
- **MTP (Multi-Token Prediction, DeepSeek)**: train the model *itself* with extra MTP modules — full transformer-depth mini-layers sharing the target's trunk and KV. The draft is the same distribution as the target because it almost *is* the target. Highest acceptance rates of the three; this is what DeepSeek-R1's production stack runs (MTP-3) and what every 2026 engine integrated (vLLM/SGLang/TRT-LLM all ship MTP and EAGLE-class heads).`,
    },
    {
      type: 'prose',
      md: `## The acceptance economy

The speedup math is T5.L8's one line. With per-token acceptance α and draft length k, expected tokens per verification step is **E = (1 − α^(k+1)) / (1 − α)** (= 1 + α + … + α^k: the accepted prefix plus the bonus token), and the win is capped by E / (1 + draft_cost). α = 0.85, k = 3 (MTP-3) gives E ≈ 3.2. The engineering consequences:

- **Acceptance rate is a metric you design for, not observe.** Domain drafters (a code-tuned head for a code product), temperature coupling (low temperature → higher acceptance), k tuning per workload (k=2–4 typical; each extra draft token costs draft time and verify FLOPs).
- **Why k here is smaller than T5.L8's k ≈ 4–8.** Same E, different setting. A separate draft model is a cheap, independent predictor, so on predictable text you can run it further out. MTP depth is built in at training time: each extra module is another layer of compute on the critical path, and the deeper modules predict tokens further ahead, so α falls with depth and the α^(k+1) term you gain per step shrinks faster than your cost. The ranges overlap near k ≈ 4; they are not a contradiction.
- **Verify is prefill-shaped, and that's the point.** T4.L3: decode wastes the compute roof; verification backfills it — k tokens per weight-read instead of 1. The win disappears when the batch is already compute-saturated: speculative decoding is an *interactivity* technology (small batches, single-user streams), not a throughput one. SemiAnalysis on InferenceMAX: MTP gives **2–3× interactivity**, and high-interactivity configs are where B200 single-node can beat GB200 NVL72 (which wins at low interactivity / max throughput).
- **MoE makes it bigger.** On a 37B-active-param MoE, a target step reads little weight, so the verify pass's marginal cost is low and acceptance on structured text (code, JSON, tool calls) runs high. 2–3× on MoE vs ~1.5–2× on dense, per NVIDIA's and SemiAnalysis' published numbers.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '2–3×', label: 'MTP interactivity gain on MoE', hint: 'NVIDIA + SemiAnalysis InferenceMAX numbers, DeepSeek-class models.' },
        { value: 'k = 2–4', label: 'typical draft length', hint: 'MTP depth. Each extra token costs draft time + verify FLOPs, and E = (1 − α^(k+1)) / (1 − α) flattens; a separate draft model (T5.L8) runs k ≈ 4–8.' },
        { value: '0%', label: 'quality loss', hint: 'Rejection sampling keeps output distributionally identical to the target model — speed, not approximation.' },
        { value: 'MTP-3', label: 'DeepSeek-R1 production drafter', hint: 'Three MTP modules sharing the target trunk — drafter as the model itself.' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `MTP is the **JIT's inline cache grown a brain**: T0.L5's speculate-and-deopt, except the speculation is now produced by the same optimizer that runs the slow path. And the batch-level trade is your thread-pool lesson again: at full occupancy (compute-bound), speculation adds FLOPs you don't have; at low occupancy it's free — "spare capacity" is the only thing being spent.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'MTP beats a separate draft model because…',
          options: [
            'It uses fewer GPUs',
            'The draft shares the target\'s trunk and KV cache — highest acceptance (same distribution), no second model to host',
            'It avoids quantization',
            'It is older',
          ],
          correct: [1],
          explanation:
            'MTP modules are transformer-depth mini-layers on the target itself — the draft IS the target\'s distribution, which is what drives acceptance rates up. One model, one cache, no version skew.',
        },
        {
          q: 'Speculative decoding pays off most when…',
          options: [
            'The batch is huge and compute-saturated',
            'Interactivity matters and the batch is small — verify backfills the idle compute roof; at saturation it only adds FLOPs',
            'The model is dense',
            'Prompts are short',
          ],
          correct: [1],
          explanation:
            'The mechanism converts idle decode FLOPs into skipped steps. At high occupancy there are no idle FLOPs — it is an interactivity (tok/s/user) technology: 2–3× on MoE, which is why min-latency configs love MTP and throughput configs care less.',
        },
        {
          q: 'The output quality cost of speculative decoding is…',
          options: [
            'About 1%',
            'About 5%',
            'Zero — the accept/reject rule (rejection sampling) keeps the output distributionally identical to the target',
            'Proportional to k',
          ],
          correct: [2],
          explanation:
            'Tokens are accepted only under the rule that preserves the target\'s distribution exactly. You are buying speed with spare compute, not quality.',
        },
        {
          q: 'Why is the win bigger on MoE than dense?',
          options: [
            'MoE has more experts to draft',
            'A target step on MoE reads few weights (37B of 671B active) — the verify pass\'s marginal cost is low, and acceptance on structured text is high',
            'MoE is always slower',
            'Routers draft tokens too',
          ],
          correct: [1],
          explanation:
            'Speculative economics = win × acceptance ÷ verify cost. MoE shrinks the denominator (per-step bytes) and, on code/JSON-shaped text, raises acceptance. Published: ~2–3× on MoE vs ~1.5–2× dense.',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'EAGLE and where heads are going',
      md: `EAGLE (and EAGLE-3, the version most engines integrated in 2025) made the draft **feature-level autoregression**: the head consumes the target's hidden states (not just tokens), one lightweight layer deep, trained to predict the next feature vector — better acceptance than Medusa with a fraction of the parameters. The 2026 shape in production: MTP-style modules for the frontier MoE stacks, EAGLE-3-class heads for open-weight deployments, draft-models for exotic cases. All three are in vLLM and SGLang today; TRT-LLM runs MTP-3 on the DeepSeek-R1 B200 records. If you implement one thing from this lesson: acceptance-rate instrumentation — you cannot tune what you don't count.`,
    },
  ],
}

export default lesson
