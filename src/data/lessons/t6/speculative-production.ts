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
- **MTP (Multi-Token Prediction, DeepSeek)**: train the model *itself* with an extra MTP module — a transformer-block head fed by the target's hidden states, sharing its embedding and output head. DeepSeek-V3/R1 ship exactly one (config num_nextn_predict_layers = 1). The draft is nearly the same distribution as the target because it reads the target's own hidden states. Highest acceptance rates of the three; this is what DeepSeek-R1's production stack runs (MTP-3: that one module applied for 3 draft steps) and what every 2026 engine integrated (vLLM/SGLang/TRT-LLM all ship MTP and EAGLE-class heads).`,
    },
    {
      type: 'prose',
      md: `## The acceptance economy

The speedup math is T5.L8's one line. With per-token acceptance α and draft length k, expected tokens per verification step is **E = (1 − α^(k+1)) / (1 − α)** (= 1 + α + … + α^k: the accepted prefix plus the bonus token), and the win is capped by E / (1 + draft_cost). α = 0.85, k = 3 (MTP-3) gives E ≈ 3.2. The engineering consequences:

- **Acceptance rate is a metric you design for, not observe.** Domain drafters (a code-tuned head for a code product), temperature coupling (low temperature → higher acceptance), k tuning per workload (k=2–4 typical; each extra draft token costs draft time and verify FLOPs).
- **Why k here is smaller than T5.L8's k ≈ 4–8.** Same E, different setting. A separate draft model is a cheap, independent predictor, so on predictable text you can run it further out. MTP ships one trained module (DeepSeek-V3/R1: num_nextn_predict_layers = 1), and MTP-3 runs that same module for 3 draft steps. Each extra step is another pass of the module on the critical path, and later steps predict tokens further ahead than the module was trained for, so α falls with each step and the α^(k+1) term you gain per step shrinks faster than your cost. The ranges overlap near k ≈ 4; they are not a contradiction.
- **Verify is prefill-shaped, and that's the point.** T4.L3: decode wastes the compute roof; verification backfills it — k tokens per weight-read instead of 1. The win disappears when the batch is already compute-saturated: speculative decoding is an *interactivity* technology (small batches, single-user streams), not a throughput one. SemiAnalysis on InferenceX (formerly InferenceMAX): MTP gives **2–3× interactivity**, and high-interactivity configs are where B200 single-node can beat GB200 NVL72 (which wins at low interactivity / max throughput).
- **MoE makes it bigger.** On a 37B-active-param MoE, a target step reads little weight, so the verify pass's marginal cost is low and acceptance on structured text (code, JSON, tool calls) runs high. 2–3× on MoE vs ~1.5–2× on dense, per NVIDIA's and SemiAnalysis' published numbers.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '2–3×', label: 'MTP interactivity gain on MoE', hint: 'NVIDIA + SemiAnalysis InferenceX numbers, DeepSeek-class models.' },
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
            'Its draft tokens are sampled from the target\'s own weights, so the verification pass can be skipped whenever the head is confident in them',
            'The head reads the target\'s hidden states and shares its embedding and output head, so its drafts track the target\'s distribution closely',
            'It predicts tokens t+1 through t+k in parallel from shallow output heads, and parallel prediction is more accurate than drafting in sequence',
            'It removes the second model\'s memory footprint, and that saving alone produces the speedup whether or not the drafts are accepted',
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
            'The batch is large and compute-saturated, because verifying k tokens per sequence puts more arithmetic on the GPU for each weight read',
            'Batches are small and per-user speed matters, because verification spends compute that single-token decode would leave idle',
            'The model is dense, because MoE routing makes the draft and target disagree on expert choice and acceptance collapses',
            'Prompts are short, because the drafter then has little context to mispredict and acceptance approaches 100%',
          ],
          correct: [1],
          explanation:
            'The mechanism converts idle decode FLOPs into skipped steps. At high occupancy there are no idle FLOPs — it is an interactivity (tok/s/user) technology: 2–3× on MoE, which is why min-latency configs love MTP and throughput configs care less.',
          why: [
            'Backwards. A saturated batch has no idle compute to fill, so verifying extra tokens adds FLOPs that slow every sequence. Speculation is an interactivity technique, not a throughput one.',
            'Right: at small batch, decode is bound by reading weights and leaves arithmetic idle. Verifying k tokens per weight read uses that spare compute to skip steps.',
            'The published gains are larger on MoE (2–3×) than on dense models (about 1.5–2×). Acceptance depends on how predictable the text is, not on the target being dense.',
            'Acceptance depends on how predictable the continuation is (code, JSON, low temperature), not on prompt length. Short prompts also say nothing about whether the batch has idle compute.',
          ],
        },
        {
          q: 'The output quality cost of speculative decoding is…',
          options: [
            'Small but real, because accepted draft tokens come from a weaker distribution, and the loss grows with the draft length k',
            'Bounded, because the target re-scores each draft token and rejects any whose probability falls below a fixed cutoff threshold',
            'None in distribution: accept/reject sampling against the target\'s probabilities reproduces exactly its output distribution',
            'Zero only at temperature 0; at higher temperatures sampled draft tokens let lower-quality continuations through',
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
          q: 'Why is the win bigger on MoE than dense?',
          options: [
            'The router acts as the drafter: each expert predicts a different future token, so k drafts come from one routing decision',
            'A MoE decode step moves few weight bytes (37B of 671B active), so verifying costs little and structured text accepts often',
            'MoE layers run fewer FLOPs per token than dense layers, so verifying k extra tokens in each decode step is free at any batch size',
            'MoE models have more total parameters, so a draft head trained on them has more capacity and reaches near-perfect acceptance on all text',
          ],
          correct: [1],
          explanation:
            'Speculative economics = win × acceptance ÷ verify cost. MoE shrinks the denominator (per-step bytes) and, on code/JSON-shaped text, raises acceptance. Published: ~2–3× on MoE vs ~1.5–2× dense.',
          why: [
            'Routers choose experts for the current token\'s feed-forward layer; they do not predict future tokens. Drafts come from a draft model, Medusa heads or an MTP module.',
            'Right: a MoE step reads only the active experts, so the verify pass adds little marginal cost, and code or JSON-shaped text accepts at a high rate. Published: about 2–3× on MoE versus 1.5–2× dense.',
            'Sparse activation lowers the cost per token but does not make verification free. Once the batch saturates compute, extra verified tokens cost FLOPs again, as on dense models.',
            'Acceptance depends on how predictable the text is and how well the head matches the target, not on total parameter count. The MoE gain comes mainly from cheaper verification.',
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
