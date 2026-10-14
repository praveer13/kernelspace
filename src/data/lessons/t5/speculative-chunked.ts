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
  kcs: ['t5.prefill-decode-interference', 't5.speculative-decoding'],
  ticket: {
    form: 'ticket',
    cr: [
      {
        prompt: 'Say why speculative decoding does not change the model\'s output, and when it hurts throughput.',
        model:
          'The target scores every drafted token, accepts one with probability min(1, p_target / p_draft) and resamples on a rejection, so the output follows the target\'s own distribution. It wins only while decode has idle compute. At large batch the units are busy, so verifying tokens that get rejected costs real throughput.',
        ideas: [
          'The target verifies every drafted token and resamples on rejection, so output matches its distribution',
          'Verification is cheap only because decode leaves compute idle',
          'At large batch there is no idle compute, so rejected drafts cost throughput',
        ],
        kcs: ['t5.speculative-decoding'],
      },
      {
        prompt: 'Explain how chunked prefill shortens the stall that a long prompt causes, and what the chunk size trades.',
        model:
          'It slices the prompt into fixed-size chunks and mixes one chunk into each decode iteration. A running user then waits about one chunk per step, not the whole prefill. Decode leaves compute idle and chunks add compute-bound work, so goodput rises. Smaller chunks favour ITL, larger chunks favour TTFT.',
        ideas: [
          'Slice the prompt into chunks and mix one into each decode iteration',
          'A running user waits about one chunk per step, not the whole prefill',
          'Smaller chunks give better ITL and larger chunks give better TTFT',
        ],
        kcs: ['t5.prefill-decode-interference'],
      },
    ],
  },
  blocks: [
    {
      type: 'predict',
      items: [
        {
          kind: 'numeric',
          q: 'A small draft model proposes 4 tokens. The target accepts each one with probability 0.7, independently, and always adds one token of its own. On average, how many tokens does one verification step emit?',
          unit: 'tokens',
          truth: 2.77,
          okWithinFactor: 1.15,
          revealAt: 'Speculative decoding: the draft-verify trick',
          kcs: ['t5.speculative-decoding'],
        },
        {
          kind: 'choice',
          q: 'A 100,000-token prompt arrives while 30 other users are mid-reply, and the engine prefills it in one piece. What do those 30 users see?',
          options: [
            'Every reply freezes for seconds, since whole iterations go to the long prefill before decoding resumes',
            'No change at all, since prefill and decode run on separate units of the GPU and never compete for time',
            'Slightly slower tokens, since only the memory that the long prompt takes is lost to the other users',
            'Their replies restart from the first token, since the scheduler frees every running sequence to make room',
          ],
          correct: [0],
          why: [
            'Right: a whole-prompt prefill is one multi-second compute-bound job, and every running decode waits for it. All users see an ITL spike, and chunking exists to bound that stall.',
            'Prefill and decode share the same units and the same iteration loop. A long prefill takes the step, so the decode work of the other users waits behind it.',
            'Memory is not the main loss. The long prompt takes whole iterations of compute, so each running user\'s next token is late by about the length of the prefill, not by a few blocks.',
            'Running sequences are not restarted. They keep their blocks and wait for the iteration to end, which is why the stall shows up as a long gap between tokens.',
          ],
          revealAt: 'Chunked prefill: the other convoy fix',
          kcs: ['t5.prefill-decode-interference'],
        },
      ],
    },
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
      predictAt: {
        step: 2,
        prompt: 'The target has scored all four drafted tokens in one pass. Its own choices match the first three (" the quick brown") and differ at " dog". How many tokens does this round add to the output?',
        options: [
          '3 tokens, the accepted prefix, since the rejected token and everything after it is thrown away',
          '4 tokens, since the accepted prefix is joined by the target\'s own token at the mismatch',
          '1 token, since one verification step costs one decode step and so emits one token',
          '0 tokens, since a rejection anywhere in the round voids every drafted token and restarts it',
        ],
        correct: [1],
        why: [
          'This misses the extra token. The pass that rejects " dog" also gives the target\'s own token for that position, so the round emits the three accepted tokens plus one more.',
          'Right: three accepted tokens plus the target\'s own token at the mismatch (or a bonus token when all four pass). Four tokens for about the price of one decode step.',
          'Cost and output are different things. The wide pass costs about one decode step but scores four positions, so it can emit several tokens, not one.',
          'A rejection only discards the tokens from the mismatch onward. The accepted prefix stays, because the target\'s own choices matched it exactly.',
        ],
        kcs: ['t5.speculative-decoding'],
      },
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
      type: 'item',
      title: 'Count the tokens of a speculative round',
      family: 'spec',
      variants: ['expected-tokens', 'draft-tokens'],
    },
    {
      type: 'prose',
      md: `## Chunked prefill: the other convoy fix

Continuous batching (T5.L7) schedules *sequences*, but prefill is still atomic: one 100k-token prompt's prefill is a multi-second compute-bound job that, run whole, stalls every decode in the batch (ITL spike for all users — a convoy inside the continuous schedule). **Chunked prefill** slices the prefill into fixed-size chunks (e.g. 2k tokens) and interleaves them with decode iterations: each step mixes one prefill chunk + the running decodes.

The roofline blessing: decode iterations are bandwidth-bound with idle compute, prefill chunks are compute-bound with spare bandwidth — **they backfill each other**. The batch's arithmetic intensity rises toward the roof from both sides: total goodput rises, and a long prompt no longer holds every decode for its whole prefill. It does not make ITL free. Each mixed step still carries up to one chunk of prefill, so a long prompt delays running decodes by about one chunk, not by the whole prefill, and the chunk budget trades ITL against TTFT: smaller chunks give better ITL, larger chunks give better TTFT. This is why every modern engine (vLLM, SGLang, TRT-LLM) runs mixed prefill+decode batches by default, and why disaggregation (T5.L9) exists as the *alternative* answer: instead of mixing on one GPU, send the two phases to different GPUs entirely.`,
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
            'The draft model is distilled from the target, and its guesses are accepted as-is while the target is rarely consulted',
            'Rejection sampling keeps outputs identical to the target\'s distribution, and several tokens are scored per weight read',
            'The target is quantized for the verify pass, and the small numeric error stays below the level that sampling noise reveals',
            'Drafted tokens are accepted when they fall in the target\'s top few choices, and that stays close to the target while skipping steps',
          ],
          correct: [1],
          explanation:
            'Losslessness is the point: the target model verifies, and mismatches are resampled from an adjusted distribution. The speedup is a roofline conversion — idle ALUs traded for fewer serial steps.',
          why: [
            'The drafter is deliberately much weaker (for example 100M against 70B). Its guesses are only proposals; the target checks every one, so quality does not depend on the drafter.',
            'Right: accepted sequences match the target\'s own distribution, and mismatches are resampled from an adjusted one. The gain is a roofline trade of idle ALUs for fewer serial steps.',
            'Verification runs the deployed target model, at whatever precision it is served, with no extra quantization for the verify pass. Speculation reproduces that target\'s output distribution exactly because of its acceptance rule. Quantization is a separate, lossy decode remedy.',
            'A top-k rule would be approximate and change the output distribution. Lossless speculation accepts token x with probability min(1, p_target(x) / p_draft(x)) and resamples on rejection.',
          ],
          kcs: ['t5.speculative-decoding'],
          miss: ['t5.spec-drafter-distilled', '', 't5.spec-verify-quantized', 't5.spec-top-k-accept'],
        },
        {
          q: 'Verifying k drafted tokens costs about as much as ONE decode step because…',
          options: [
            'The target reuses the drafts\' key and value tensors from the drafting phase, and verification compares tokens without any model math',
            'One parallel pass over the drafted positions reads the weights once, and the extra arithmetic is nearly free on idle units',
            'Verification is offloaded to the host processor, and it scores the drafted tokens while the accelerator decodes other requests',
            'The drafted positions are checked in sequence and each reuses weights held in on-chip cache, keeping the cost near one decode step',
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
          kcs: ['t5.speculative-decoding', 't4.decode-bandwidth'],
          miss: ['t5.spec-reuses-draft-kv', '', 't5.spec-verify-on-host', 't5.spec-sequential-cached-weights'],
        },
        {
          q: 'Chunked prefill improves goodput by…',
          options: [
            'Truncating or summarizing long prompts into fewer tokens before prefill, which shortens each iteration for the running sequences',
            'Slicing long prefills and interleaving the chunks with decode steps, which fills idle compute and caps any stall at one chunk',
            'Moving a long prompt\'s prefill to idle host cores while the accelerator keeps decoding, and copying its cache back before decode starts',
            'Skipping attention over the oldest chunks of a long prompt, which cuts the prefill work that was blocking other sequences',
          ],
          correct: [1],
          explanation:
            'Mixed batches raise arithmetic intensity from both sides: decode supplies spare FLOPs, prefill chunks supply spare bandwidth demand. ITL smooths out, with the stall per step capped by the chunk size, and total throughput rises — the default in modern engines.',
          why: [
            'Chunking does not change how many tokens are processed; every prompt token is still prefilled, only spread over several iterations. Total prefill work is unchanged.',
            'Right: mixed batches raise arithmetic intensity from both sides. Decode leaves compute idle, chunks add compute-bound work, and the stall per iteration is bounded by the chunk size.',
            'Prefill is compute-bound and far too heavy for CPU cores. Chunked prefill keeps everything on the GPU; it only changes how prefill is scheduled among decode steps.',
            'Chunks still attend to all earlier prompt tokens through the KV cache, so the result is identical. Skipping chunks would change the output; chunking only reschedules the same work.',
          ],
          kcs: ['t5.prefill-decode-interference'],
          miss: ['t5.chunking-truncates-prompts', '', 't5.chunking-uses-host-cores', 't5.chunking-skips-attention'],
        },
        {
          q: 'Speculative decoding can HURT throughput when…',
          options: [
            'The text is highly predictable boilerplate or code, and verification then rejects most drafted tokens and wastes each pass',
            'Batch sizes are already large enough that decode nears the compute roof, and verification arithmetic stops being free',
            'Decoding is greedy at temperature zero, and rejection sampling needs randomness to decide which drafted tokens to accept',
            'The prompt is long, and verification must re-read the whole prompt\'s cached tensors once for each drafted position',
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
          kcs: ['t5.speculative-decoding', 't4.bound-classification'],
          miss: ['t5.spec-fails-on-predictable-text', '', 't5.spec-needs-sampling', 't5.spec-rereads-prompt'],
        },
      ],
    },
  ],
}

export default lesson
