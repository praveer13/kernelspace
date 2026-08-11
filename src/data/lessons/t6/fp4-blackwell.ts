import type { Lesson } from '../types'

const lesson: Lesson = {
  id: 't6.l5',
  slug: 'fp4-blackwell',
  trackId: 't6',
  index: 5,
  title: 'FP4 and Blackwell: The New Rooflines',
  minutes: 25,
  hook: 'T4\'s numbers were H100: 3.35 TB/s, 80 GB, ridge at ~295 FLOP/byte. Blackwell moves every one of those, adds a 4-bit floating point the tensor cores run natively, and changes the decode economics again. Time to re-derive.',
  exercise: 'read+quiz',
  verifiedAt: '2026-08',
  blocks: [
    {
      type: 'prose',
      md: `T4.L3's roofline doesn't care about marketing; it cares about two numbers. Blackwell changes both, and adds a third lever. **B200**: 192 GB HBM3e at **~8 TB/s** (2.4× H100's bandwidth, 2.4× the capacity). **GB200 NVL72**: 72 Blackwell GPUs in one NVLink domain at ~1.8 TB/s per GPU bidirectional — the "one giant GPU" fiction made physical, and the reason EP144 and CP-over-32-nodes are routine (T6.L2, T6.L4). And **FP4**: a native 4-bit floating point format the tensor cores execute, doubling FP8 throughput per FLOP and halving the bytes again.

Run T4's decode arithmetic: tokens/s ≈ bandwidth ÷ bytes-per-token. B200 alone roughly doubles the H100 decode rate at FP8; FP4 halves the weight bytes again for models quantized to it. NVIDIA's B200 DeepSeek-R1 demo: **368 tok/s/user** on 8×B200 with NVFP4 weights + MTP-3 speculative + fused kernels — up from a 67 tok/s baseline, 5.5×, on the heaviest open model in production.`,
    },
    {
      type: 'prose',
      md: `## FP4 honestly: what 4 bits buys and what it costs

T4.L7's cliffs apply with interest. FP4 (NVFP4, E2M1 with **per-16-element microscaling** — a small FP8 scale per block, the trick that makes 4-bit survivable) halves weight bytes vs FP8. Where it wins:

- **Decode of huge models** — the bandwidth-bound path (T4.L3): bytes-per-token is the denominator, and MoE already spends it carefully (T6.L1). DeepSeek-R1 at NVFP4 was the flagship demo for a reason.
- **Capacity** — a 671B-param MoE at FP4 weights: ~335 GB → fits a 2-node NVL72 pair instead of 5+ H100 nodes. Fleet composition changes (T7.L4 prices this).

Where it bites: **activations and outliers**, same as T4.L7 but with less mantissa to hide behind. Weight-only FP4 with BF16/FP8 activations is the production recipe; end-to-end FP4 is where accuracy work is still happening. The quantization ladder you learned — weights tolerate 4 bits, activations want 8 — didn't change; the floor just dropped a rung.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '192 GB', label: 'B200 HBM3e', hint: '2.4× H100 capacity — a 70B FP16 model + 500k tokens of KV in one GPU.' },
        { value: '~8 TB/s', label: 'B200 HBM bandwidth', hint: '2.4× H100\'s 3.35 TB/s. Decode rates scale with it.' },
        { value: '~1.8 TB/s', label: 'NVLink 5 per GPU', hint: 'GB200 NVL72: 72 GPUs, one domain. TP/EP/CP territory (T6.L4).' },
        { value: '368 tok/s', label: 'DeepSeek-R1 per user on 8×B200', hint: 'NVFP4 + MTP3 + fused kernels, min-latency config (NVIDIA TRT-LLM blog).' },
      ],
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Blackwell is your **DDR4→DDR5 + L3-doubling upgrade**, but the business effect is bigger: when bytes-per-token halves and bandwidth doubles, the *same SLO* is met with a fraction of the fleet — or the same fleet meets a SLO that was previously fantasy. This is the T7 theme arriving early: hardware generations are no longer 20% events; they change which architectures are viable (Blackwell's NVL72 is why wide-EP decode is a thing you do, not a thing you admire).`,
    },
    {
      type: 'quiz',
      questions: [
        {
          q: 'FP4\'s biggest production win is…',
          options: [
            'Training speed',
            'Decode of bandwidth-bound giants: bytes-per-token halves, and 671B-class MoE fits a fraction of the prior fleet',
            'Better accuracy than FP8',
            'Simpler kernels',
          ],
          correct: [1],
          explanation:
            'On the bandwidth slope, halving weight bytes doubles the rate (T4.L3). The flagship demo was DeepSeek-R1 at NVFP4 on B200. Accuracy work lives in the microscaling (per-16-element FP8 scales) and keeping activations at 8 bits.',
        },
        {
          q: 'GB200 NVL72 changes architecture (not just speed) because…',
          options: [
            'It uses less power',
            '72 GPUs share a ~1.8 TB/s/GPU NVLink domain — TP/EP/CP topologies that were fantasy at cluster scale become routine inside one rack',
            'It is water cooled',
            'It has more fans',
          ],
          correct: [1],
          explanation:
            'T6.L4\'s rule — per-layer collectives need the NVLink tier — used to bound those axes to ~8 GPUs. NVL72 makes it 72. That is why wide-EP decode and CP-over-32-nodes are production patterns now.',
        },
        {
          q: 'The production quantization recipe on Blackwell is…',
          options: [
            'Everything FP4',
            'FP4/FP8 weights with 8-bit activations — weights tolerate 4 bits (with microscaling), activations still want 8, same ladder as T4.L7 one rung lower',
            'INT4 everywhere',
            'BF16 always',
          ],
          correct: [1],
          explanation:
            'The cliff didn\'t move: activations and outliers remain the fragile path. Weight-only FP4 + FP8/BF16 activations is what ships; end-to-end FP4 is still research-grade.',
        },
        {
          q: 'Re-deriving T4\'s roofline for B200: the decode rate roughly…',
          options: [
            'Unchanged',
            '~2.4× H100 at the same precision (bandwidth 8 vs 3.35 TB/s), plus another ~2× at FP4 vs FP8 weights on the bandwidth-bound path',
            'Half of H100',
            'Scales with FLOPs instead',
          ],
          correct: [1],
          explanation:
            'Decode is bandwidth-bound: tokens/s ≈ BW ÷ bytes/token. Bandwidth up 2.4×, bytes down 2× at FP4 — compounding levers, which is why the per-generation economics jumped instead of crept (T7.L4 prices it).',
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'The AMD footnote',
      md: `The roofline is vendor-neutral, and so is this lesson's question: "bandwidth and capacity per dollar?" MI300X/MI355X compete exactly there — 192–288 GB HBM3e, and AMD's inference path of choice is SGLang with aiter kernels (their published claim: MI355X slightly cheaper per token than B200 TRT-LLM on specific MoE configs, 2026). The framework from T6.L4 and this lesson — bytes, bandwidth, interconnect — is what lets you evaluate that claim in a meeting instead of believing it. InferenceMAX (T7.L2) publishes the measured versions nightly.`,
    },
  ],
}

export default lesson
