import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l6',
  slug: 'speculative-production',
  trackId: 't6',
  index: 6,
  title: 'Speculative Decoding in Production: MTP, EAGLE, and the Acceptance Economy',
  minutes: 25,
  hook: 'T5.L8 taught the draft-verify trick. Production made it stranger: the draft is now the model\'s own head (MTP), acceptance rate is a designed quantity, and on DeepSeek-R1 the published win reaches 2–3× interactivity.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T5.L8's mechanics stand: draft k tokens cheaply, verify in one parallel pass, accept the longest agreeing prefix, lose nothing. What production changed is the *draft*. Three shapes now:

- **Draft model** (T5.L8's version): a small sibling model. Simple, but the drafter is a second model to host, version, and keep distribution-aligned — and it doesn't share the target's KV cache, so verify cost includes extra bookkeeping.
- **Medusa heads**: small extra output heads on the target model predicting tokens t+1..t+k in parallel. One model, one cache — but the heads are shallow predictors; acceptance drops on hard text.
- **MTP (Multi-Token Prediction, DeepSeek)**: train the model *itself* with an extra MTP module — a transformer-block head fed by the target's hidden states, sharing its embedding and output head. DeepSeek-V3/R1 ship exactly one (config num_nextn_predict_layers = 1). The draft is nearly the same distribution as the target because it reads the target's own hidden states. Highest acceptance rates of the three; this is what DeepSeek-R1's production stack runs (MTP-3: that one module applied for 3 draft steps) and what every 2026 engine integrated (vLLM/SGLang/TRT-LLM all ship MTP and EAGLE-class heads).`,
    },
    {
      type: 'prose',
      md: `## The acceptance economy

The speedup math is T5.L8's one line. With per-token acceptance α and draft length k, expected tokens per verification step is **E = (1 − α^(k+1)) / (1 − α)** (= 1 + α + … + α^k: the accepted prefix plus the bonus token), and the win is capped by E / (1 + draft_cost). α = 0.85, k = 3 (MTP-3) gives E ≈ 3.2. The engineering consequences:

- **Acceptance rate is a metric you design for, not observe.** Domain drafters (a code-tuned head for a code product), temperature coupling (low temperature → higher acceptance), k tuning per workload (k=2–4 typical; each extra draft token costs draft time and verify FLOPs).
- **Why k here is smaller than T5.L8's k ≈ 4–8.** Same E, different setting. A separate draft model is a cheap, independent predictor, so on predictable text you can run it further out. MTP ships one trained module (DeepSeek-V3/R1: num_nextn_predict_layers = 1), and MTP-3 runs that same module for 3 draft steps. Each extra step is another pass of the module on the critical path, and later steps predict tokens further ahead than the module was trained for, so α falls with each step and the α^(k+1) term you gain per step shrinks faster than your cost. The ranges overlap near k ≈ 4; they are not a contradiction.
- **Verify is prefill-shaped, and that's the point.** T4.L3: decode wastes the compute roof; verification backfills it — k tokens per weight-read instead of 1. The win disappears when the batch is already compute-saturated: speculative decoding is an *interactivity* technology (small batches, single-user streams), not a throughput one. SemiAnalysis on InferenceX (formerly InferenceMAX): MTP gives **2–3× interactivity**, and high-interactivity configs are where B200 single-node can beat GB200 NVL72 (which wins at low interactivity / max throughput).
- **MoE changes the arithmetic, not the rule.** A sparse MoE feeds each expert only a small share of the batch, so decode stays bandwidth-bound out to much larger batches than a dense model, and verification keeps using idle compute where dense decode has none ([MoESD](https://arxiv.org/abs/2505.19645) finds MoE can gain more than dense at medium batch sizes). The catch: k drafted tokens can route to more experts than one decode step touches, so a verify pass reads more weight bytes than a single step and the gain depends on batch size. The published numbers are for DeepSeek-R1 only: SemiAnalysis measured up to 2–3× throughput at some iso-interactivity points (GB200 NVL72, 8K in and 1K out), and NVIDIA [reports 2.16× at batch 1](https://nvidia.github.io/TensorRT-LLM/blogs/tech_blog/blog2_DeepSeek_R1_MTP_Implementation_and_Optimization.html) on 8 B200. Neither gives a dense-model figure, so there is no sourced MoE-versus-dense ratio.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '2–3×', label: 'MTP gain on DeepSeek-R1', hint: 'Up to, at some iso-interactivity points on GB200 NVL72 (SemiAnalysis InferenceX); NVIDIA reports 2.16× at batch 1 on 8 B200.' },
        { value: 'k = 2–4', label: 'typical draft length', hint: 'MTP depth. Each extra token costs draft time + verify FLOPs, and E = (1 − α^(k+1)) / (1 − α) flattens; a separate draft model (T5.L8) runs k ≈ 4–8.' },
        { value: '0%', label: 'quality loss', hint: 'Rejection sampling keeps output distributionally identical to the target model — speed, not approximation.' },
        { value: 'MTP-3', label: 'DeepSeek-R1 production drafter', hint: 'One MTP module (num_nextn_predict_layers = 1) run for 3 draft steps, fed by the target hidden states — drafter as the model itself.' },
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
            'Its draft tokens are sampled from the target\'s own weights, letting the verification pass be skipped when the head is confident',
            'The head reads the target\'s hidden states and shares its embeddings, keeping drafts close to the target\'s distribution',
            'It predicts several future tokens in parallel from shallow output heads, beating the accuracy of drafting in sequence',
            'It removes the second model\'s memory footprint, producing the speedup whether or not the drafts are accepted',
          ],
          correct: [1],
          explanation:
            'The MTP module is a transformer block trained with the target, consuming the target\'s own hidden states — its draft stays close to the target\'s distribution, which is what drives acceptance rates up. One checkpoint, no version skew.',
          why: [
            'Verification is never skipped. Accept/reject against the target is what keeps the output identical, and a confident draft can still disagree with the target, so every draft token is checked.',
            'Right: reading the target\'s own hidden states keeps the draft close to the target\'s distribution, which raises acceptance. One checkpoint also means no second model to host or keep aligned.',
            'That describes Medusa heads, which are shallow independent predictors whose acceptance drops on hard text. MTP is a transformer block fed by the target\'s hidden states.',
            'Saved memory is not the speedup. Speed comes from accepted tokens per verification pass, so a low acceptance rate erases the gain however small the drafter is.',
          ],
        },
        {
          q: 'Speculative decoding pays off most when…',
          options: [
            'The batch is large and compute-saturated, putting more arithmetic on the chip for each weight read',
            'Batches are small and per-user speed matters most, spending the compute that single-token decode would leave idle',
            'The model is dense, avoiding the routing mismatch between draft and target that collapses acceptance on MoE models',
            'Prompts are short, giving the drafter little context to mispredict and pushing acceptance near its ceiling',
          ],
          correct: [1],
          explanation:
            'The mechanism converts idle decode FLOPs into skipped steps. At high occupancy there are no idle FLOPs — it is an interactivity (tok/s/user) technology: up to 2–3× on DeepSeek-R1, which is why min-latency configs love MTP and throughput configs care less.',
          why: [
            'Backwards. A saturated batch has no idle compute to fill, so verifying extra tokens adds FLOPs that slow every sequence. Speculation is an interactivity technique, not a throughput one.',
            'Right: at small batch, decode is bound by reading weights and leaves arithmetic idle. Verifying k tokens per weight read uses that spare compute to skip steps.',
            'MoE routing does not collapse acceptance: the published MTP gains, up to 2–3×, are on DeepSeek-R1, a MoE. Acceptance depends on how predictable the text is, not on the target being dense.',
            'Acceptance depends on how predictable the continuation is (code, JSON, low temperature), not on prompt length. Short prompts also say nothing about whether the batch has idle compute.',
          ],
        },
        {
          q: 'The output quality cost of speculative decoding is…',
          options: [
            'Small but real, with accepted draft tokens coming from a weaker distribution and the loss growing with draft length',
            'Bounded by a cutoff, with the target re-scoring each draft token and rejecting those below a fixed probability threshold',
            'Nothing in distribution, with accept and reject sampling against the target reproducing its output distribution exactly',
            'Zero at temperature zero, with sampled draft tokens letting lower-quality continuations through at higher temperatures',
          ],
          correct: [2],
          explanation:
            'Tokens are accepted only under the rule that preserves the target\'s distribution exactly. You are buying speed with spare compute, not quality.',
          why: [
            'Draft tokens are not accepted on trust. The accept rule uses the target\'s own probabilities, so a weak drafter lowers the acceptance rate (speed), never output quality, whatever k is.',
            'Threshold acceptance exists but is a lossy approximation. Standard speculative sampling accepts with probability min(1, p/q) and resamples from the residual on rejection, which preserves the distribution exactly.',
            'Right: accepting each draft token with probability min(1, p/q) and resampling on rejection reproduces the target\'s distribution exactly. You spend spare compute, not quality.',
            'The guarantee holds at any temperature, because p and q are the temperature-adjusted distributions. Temperature changes the acceptance rate (lower is higher), not correctness.',
          ],
        },
        {
          q: 'Why can speculative decoding stay profitable at larger batches on a MoE than on a dense model?',
          options: [
            'The router acts as the drafter, so each expert predicts a different future token per routing decision',
            'Each expert sees few tokens, so decode stays bandwidth-bound where a dense model is already compute-bound',
            'MoE layers run fewer FLOPs per token than dense layers, so extra verified tokens are free at any batch size',
            'MoE models hold more total parameters, so a draft head gets more capacity and near-perfect acceptance on any text',
          ],
          correct: [1],
          explanation:
            'Speculative gain = accepted tokens per step ÷ verify cost. A sparse MoE stays bandwidth-bound out to larger batches, so verification keeps using idle compute where a dense model has none; but k drafted tokens can touch more experts than one step, so the gain depends on batch size. Reported: up to 2–3× on DeepSeek-R1 (SemiAnalysis), 2.16× at batch 1 on 8 B200 (NVIDIA); no source here gives a dense figure.',
          why: [
            'Routers choose experts for the current token\'s feed-forward layer; they do not predict future tokens. Drafts come from a draft model, Medusa heads or an MTP module.',
            'Right: each expert gets a small share of the batch, so intensity stays low and compute idle at batch sizes where dense decode is compute-bound. One study finds MoE can gain more at medium batches.',
            'Sparse activation lowers the cost per token but not to zero. Verifying k tokens can route to more experts than one decode step touches, and once the batch saturates compute, extra tokens cost FLOPs again.',
            'Acceptance depends on how predictable the text is and how well the head matches the target, not on total parameter count. The MoE advantage comes from idle compute over a wider batch range.',
          ],
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
