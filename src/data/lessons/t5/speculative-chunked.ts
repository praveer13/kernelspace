import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't5.l8',
  slug: 'speculative-chunked',
  trackId: 't5',
  index: 8,
  title: 'Speculative Decoding & Chunked Prefill',
  minutes: 25,
  hook: 'Two optimizations that fight the same enemy — decode\'s serial bandwidth wall — from opposite directions: skip steps, and backfill idle FLOPs.',
  exercise: 'quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T5.L3 left decode with three possible medicine shapes: cheaper steps (quantization), amortized steps (batching), or *fewer* steps. This lesson covers the third shape — **speculative decoding**, the most elegant trick in the stack — plus its quiet sibling **chunked prefill**, which fixes a different crack in the continuous-batching façade: long prompts convoying the iteration loop. Both are about the same insight from T4.L3: **decode wastes the compute roof; anything that converts wasted FLOPs into fewer or denser steps is free throughput.**`,
    },
    {
      type: 'prose',
      md: `## Speculative decoding: the draft-verify trick

The observation: many tokens are *easy* — function words, boilerplate, code punctuation — and a tiny "draft" model (or a cheap heuristic head) predicts them with high accuracy. The method:

1. **Draft** the next k tokens with a small/fast model (e.g. a 100M-param drafter next to your 70B target) — k serial steps, but each ~100× cheaper than a target step.
2. **Verify all k in one parallel forward pass of the target model** — one *prefill-shaped* (compute-bound, wide) pass over the k drafted tokens instead of k serial decode steps.
3. **Accept the longest prefix where the target's distribution agrees** (with a rejection-sampling rule that keeps the output *exactly* as the target model would have produced — this is lossless, not approximate), and resume from the first mismatch.

The economics are pure T4.L3: decode steps are bandwidth-bound with idle ALUs; verification reuses those idle FLOPs to check k tokens per weight-read instead of 1 — **arithmetic intensity × k on the same bandwidth.** Model the acceptance of each drafted token as a probability α (a simplification: independent per position). The pass emits the accepted prefix plus one bonus token from the target itself, so the expected tokens per verification step is **E = (1 − α^(k+1)) / (1 − α)** — α = 0.7, k = 4 gives E ≈ 2.8. E is capped at 1/(1 − α) however long you draft, and each extra draft token adds only α^(k+1) to it. Typical acceptance rates (60–80% on predictable text) yield **1.5–2.5× decode speedups** once draft and verify costs are paid, with bit-identical output. And you've met the pattern before: it's the JIT's speculate-and-deopt (T0.L5), branch prediction (T4.L1), and optimistic concurrency control — optimism + cheap validation + safe rollback.`,
    },
    {
      type: 'diagram',
      caption: 'fig 1 — one speculative round: draft 4, verify 1 pass, accept 3',
      height: 52,
      nodes: [
        { id: 'draft', x: 2, y: 8, w: 26, h: 10, label: 'draft model (tiny)', sub: '4 cheap serial steps', color: '#5CA8FF' },
        { id: 'd1', x: 34, y: 2, w: 12, h: 7, label: '" the"' },
        { id: 'd2', x: 34, y: 11, w: 12, h: 7, label: '" quick"' },
        { id: 'd3', x: 34, y: 20, w: 12, h: 7, label: '" brown"' },
        { id: 'd4', x: 34, y: 29, w: 12, h: 7, label: '" dog"', color: '#FF5C6C' },
        { id: 'verify', x: 52, y: 12, w: 22, h: 10, label: 'target model', sub: 'ONE parallel pass over 4', color: '#A78BFA' },
        { id: 'accept', x: 80, y: 6, w: 18, h: 9, label: 'accept 3', sub: '+1 bonus token', color: '#3EF2A4' },
        { id: 'reject', x: 80, y: 22, w: 18, h: 9, label: 'reject "dog"', sub: 'resume from mismatch', color: '#FF5C6C' },
      ],
      edges: [
        { from: 'draft', to: 'd1' },
        { from: 'd1', to: 'd2' },
        { from: 'd2', to: 'd3' },
        { from: 'd3', to: 'd4' },
        { from: 'd4', to: 'verify', label: 'verify all' },
        { from: 'verify', to: 'accept' },
        { from: 'verify', to: 'reject' },
      ],
      steps: [
        { caption: 'The tiny drafter autoregresses 4 candidate tokens — 4 serial steps, each ~1/100 the cost of a target step.', active: ['draft', 'd1', 'd2', 'd3', 'd4'], edges: ['draft->d1', 'd1->d2', 'd2->d3'] },
        { caption: 'The 70B target scores all 4 positions in ONE wide pass (compute-bound — the ALUs were idle anyway). Cost ≈ one decode step.', active: ['verify'], edges: ['d4->verify'] },
        { caption: 'Distribution check: " the quick brown" matches the target\'s own choices — accepted. Bonus: the pass also yields the NEXT token for free. 4 tokens for ~1 step\'s price.', active: ['accept'], edges: ['verify->accept'] },
        { caption: '" dog" disagrees — rejected (rejection sampling keeps output EXACTLY target-equivalent; this is lossless). Resume from the mismatch. Speedup = accepted/round ≈ 1.5–2.5×.', active: ['reject'], edges: ['verify->reject'] },
      ],
    },
    {
      type: 'statline',
      stats: [
        { value: '1.5–2.5×', label: 'typical speedup', hint: 'Acceptance-rate dependent; boilerplate/code accepts better than creative text.' },
        { value: '0', label: 'quality delta', hint: 'Rejection sampling makes output distributionally identical to the target model.' },
        { value: 'k ≈ 4–8', label: 'draft length', hint: 'Separate draft model, cheap per token. E = (1 − α^(k+1)) / (1 − α) flattens as k grows; T6.L6 shows why MTP stops at k ≈ 2–4.' },
        { value: '~free', label: 'verify FLOPs', hint: 'The wide pass uses ALUs that decode was leaving idle — the roofline pays you back.' },
      ],
    },
    {
      type: 'prose',
      md: `## Chunked prefill: the other convoy fix

Continuous batching (T5.L7) schedules *sequences*, but prefill is still atomic: one 100k-token prompt's prefill is a multi-second compute-bound job that, run whole, stalls every decode in the batch (ITL spike for all users — a convoy inside the continuous schedule). **Chunked prefill** slices the prefill into fixed-size chunks (e.g. 2k tokens) and interleaves them with decode iterations: each step mixes one prefill chunk + the running decodes.

The roofline blessing: decode iterations are bandwidth-bound with idle compute, prefill chunks are compute-bound with spare bandwidth — **they backfill each other**. The batch's arithmetic intensity rises toward the roof from both sides: ITL stays smooth for everyone, long prompts get processed without convoying, and total goodput rises. This is why every modern engine (vLLM, SGLang, TRT-LLM) runs mixed prefill+decode batches by default, and why disaggregation (T5.L9) exists as the *alternative* answer: instead of mixing on one GPU, send the two phases to different GPUs entirely.`,
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Speculative decoding is your **JIT speculation** (T0.L5) and your **optimistic UI update**: run the cheap guess, validate against the authority, roll back on mismatch — bit-identical either way. Chunked prefill is **GC incrementalization** (ZGC slicing stop-the-world into mutator-time slices) and **cooperative multitasking**: no job may monopolize the loop; big jobs are sliced so small jobs' latency survives. Same law everywhere in this course: slice the big serial thing; interleave it with the latency-sensitive thing.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      md: `Speculation has a dirty secret: at **large batch sizes**, decode is already near the compute roof — there are no idle FLOPs left, and verification becomes a *cost*, not a freebie. Speculative decoding wins at low-to-mid batch (latency-sensitive, capacity-rich) and can *hurt* at max-throughput batch. The engines that ship it gate it on measured batch occupancy. Generalize: every "free" optimization in T5 is free only in a specific roofline regime. Check the regime before shipping.`,
    },
    {
      type: 'prose',
      md: `## The family tree

Variants worth recognizing in the wild: **Medusa/EAGLE** — draft with extra heads on the target itself (no separate model, better acceptance); **self-speculative** (draft = early-exit layers); **prompt lookup** (draft from the prompt — great for RAG/code editing where outputs repeat inputs); and **tree verification** — verify multiple draft branches per pass. Same draft-verify spine, different drafters. Meanwhile chunked prefill's cousins are **prefill prioritization policies** and, at the limit, full **disaggregation**. T5.L9 next: what happens when the machine itself is distributed across nodes.`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'Speculative decoding speeds up decode without quality loss because…',
          options: [
            'The draft model is distilled from the target, so its guesses are accepted as-is and the target is rarely consulted',
            'Rejection sampling keeps outputs identical to the target\'s distribution; k tokens are scored per weight read',
            'The target is quantized for the verify pass, and the small numeric error is too small for sampling noise to reveal',
            'Drafted tokens are accepted whenever they fall in the target\'s top-k, which stays close to the target while skipping most steps',
          ],
          correct: [1],
          explanation:
            'Losslessness is the point: the target model verifies, and mismatches are resampled from an adjusted distribution. The speedup is a roofline conversion — idle ALUs traded for fewer serial steps.',
          why: [
            'The drafter is deliberately much weaker (for example 100M against 70B). Its guesses are only proposals; the target checks every one, so quality does not depend on the drafter.',
            'Right: accepted sequences match the target\'s own distribution, and mismatches are resampled from an adjusted one. The gain is a roofline trade of idle ALUs for fewer serial steps.',
            'Verification runs the full-precision target, and quantization is a separate decode remedy that is not lossless. Speculation is lossless because of its acceptance rule, not reduced precision.',
            'A top-k rule would be approximate and change the output distribution. Lossless speculation accepts token x with probability min(1, p_target(x) / p_draft(x)) and resamples on rejection.',
          ],
        },
        {
          q: 'Verifying k drafted tokens costs about as much as ONE decode step because…',
          options: [
            'The target reuses the drafts\' K/V from the drafting phase, so verification only compares tokens and does no model math',
            'One parallel pass over k positions reads the weights once; decode was bandwidth-bound with idle ALUs, so the extra math is nearly free',
            'Verification is offloaded to the CPU, which scores the k tokens while the GPU keeps decoding the next batch of requests',
            'The k positions are checked in sequence but each reuses weights held in on-chip cache, so the combined cost stays near one step of the decode loop',
          ],
          correct: [1],
          explanation:
            'The weight read dominates the step and happens once regardless; scoring k positions is compute the bandwidth-bound regime wasn\'t using. AI × k on the same bytes — the whole trick.',
          why: [
            'Draft K/V comes from a different, smaller model and cannot stand in for the target\'s. The target must run its own forward pass over all k positions.',
            'Right: the weight read dominates the step and happens once however many positions are scored. In the bandwidth-bound regime the extra FLOPs use units that were idle.',
            'Verification is the target model\'s own forward pass and stays on the GPU. A CPU would score k tokens far slower than the GPU can simply decode them serially.',
            'Weights are far larger than on-chip cache, so they are not held between positions. Verification is cheap because one pass scores all k positions, reading weights from HBM once.',
          ],
        },
        {
          q: 'Chunked prefill improves goodput by…',
          options: [
            'Truncating or summarizing long prompts into fewer tokens before prefill, so each iteration finishes sooner for every running sequence',
            'Slicing long prefills and interleaving chunks with decode steps, so compute-bound chunks use decode\'s idle ALUs and no prompt stalls ITL',
            'Moving a long prompt\'s prefill to idle CPU cores while the GPU keeps decoding, then copying its K/V back before that prompt decodes',
            'Skipping attention over the oldest chunks of a long prompt, which cuts the prefill FLOPs that were blocking other sequences',
          ],
          correct: [1],
          explanation:
            'Mixed batches raise arithmetic intensity from both sides: decode supplies spare FLOPs, prefill chunks supply spare bandwidth demand. ITL smooths out and total throughput rises — the default in modern engines.',
          why: [
            'Chunking does not change how many tokens are processed; every prompt token is still prefilled, only spread over several iterations. Total prefill work is unchanged.',
            'Right: mixed batches raise arithmetic intensity from both sides. Decode leaves compute idle, chunks add compute-bound work, and the stall per iteration is bounded by the chunk size.',
            'Prefill is compute-bound and far too heavy for CPU cores. Chunked prefill keeps everything on the GPU; it only changes how prefill is scheduled among decode steps.',
            'Chunks still attend to all earlier prompt tokens through the KV cache, so the result is identical. Skipping chunks would change the output; chunking only reschedules the same work.',
          ],
        },
        {
          q: 'Speculative decoding can HURT throughput when…',
          options: [
            'The text is highly predictable boilerplate or code, because verification then rejects most of the drafted tokens, wasting each pass',
            'Batch sizes are already large enough that decode nears the compute roof, so verification FLOPs stop being free and become overhead',
            'Decoding is greedy (temperature 0), because rejection sampling needs randomness to decide which of the drafted tokens to accept at each step',
            'The prompt is long, because verification must re-read the whole prompt\'s K/V once for every drafted position',
          ],
          correct: [1],
          explanation:
            'The freebie exists only while decode is bandwidth-bound. At max batch the ALUs are busy; extra verification math competes instead of backfilling. Engines gate speculation on batch occupancy for exactly this reason.',
          why: [
            'Predictable text raises the acceptance rate, so more drafted tokens survive each pass. Boilerplate and code are where speculation wins most.',
            'Right: the freebie exists only while decode is bandwidth-bound. At large batch the ALUs are busy, so verifying tokens that get rejected competes for compute. Engines gate speculation on occupancy.',
            'Greedy decoding works with speculation: a drafted token is accepted when it equals the target\'s argmax. Randomness is not required, and output equals non-speculative greedy.',
            'Verification reads the prompt\'s K/V once for all k positions in one pass. A long prompt raises every step\'s cost equally and does not make speculation lose.',
          ],
        },
      ],
    },
  ],
}

export default lesson
