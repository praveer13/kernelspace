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
      md: `T4.L3's roofline doesn't care about marketing; it cares about two numbers. Blackwell changes both, and adds a third lever. **B200**: ~180 GB HBM3e per GPU as shipped in HGX/DGX B200 (1,440 GB across 8 GPUs; many sources cite 192 GB per GPU, but the shipped spec lists 1,440 GB per 8) at **~8 TB/s** (2.4× H100's bandwidth, ~2.25× the capacity). **GB200 NVL72**: 72 Blackwell GPUs in one NVLink domain at ~1.8 TB/s per GPU bidirectional — the "one giant GPU" fiction made physical, and the reason EP144 and CP-over-32-nodes are routine (T6.L2, T6.L4). And **FP4**: a native 4-bit floating point format the tensor cores execute, doubling FP8 throughput per FLOP and halving the bytes again.

Run T4's decode arithmetic: tokens/s ≈ bandwidth ÷ bytes-per-token. B200 alone roughly doubles the H100 decode rate at FP8; FP4 halves the weight bytes again for models quantized to it. NVIDIA's B200 DeepSeek-R1 demo: **368 tok/s/user** on 8×B200 with NVFP4 weights + MTP-3 speculative + fused kernels — up from a 67 tok/s baseline, 5.5×, on the heaviest open model in production.`,
    },
    {
      type: 'prose',
      md: `## FP4 honestly: what 4 bits buys and what it costs

T4.L7's cliffs apply with interest. FP4 (NVFP4, E2M1 with **per-16-element microscaling** — a small FP8 scale per block, the trick that makes 4-bit survivable) halves weight bytes vs FP8. Where it wins:

- **Decode of huge models** — the bandwidth-bound path (T4.L3): bytes-per-token is the denominator, and MoE already spends it carefully (T6.L1). DeepSeek-R1 at NVFP4 was the flagship demo for a reason.
- **Capacity** — a 671B-param MoE at FP4 weights. NVFP4 is not a flat 4 bits: each 16-element block carries an FP8 scale, so ~4.5 bits per weight. 671B × 4.5 bits ÷ 8 = ~377 GB of weights [derived]. One 8×B200 node holds 8 × 180 = 1,440 GB, so the weights take about a quarter of it and the rest goes to KV cache and activations. At FP8 the same model is ~671 GB, more than one 8×H100 node's 640 GB. (An NVL72 is a 72-GPU rack, not a node; you don't need one just to hold the weights.) Fleet composition changes (T7.L4 prices this).

Where it bites: **activations and outliers**, same as T4.L7 but with less mantissa to hide behind. Weight-only FP4 with BF16/FP8 activations is the production recipe; end-to-end FP4 is where accuracy work is still happening. The quantization ladder you learned — weights tolerate 4 bits, activations want 8 — didn't change; the floor just dropped a rung.`,
    },
    {
      type: 'statline',
      stats: [
        { value: '~180 GB', label: 'B200 HBM3e (as shipped)', hint: '~2.25× H100 capacity (many sources cite 192 GB; shipped DGX/HGX B200 lists 1,440 GB per 8 GPUs) — a 70B FP16 model (140 GB) + ~125k tokens of KV at 320 KB/token in one GPU.' },
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
            'Faster training, since 4-bit gradients cut the weight-update traffic and let pretraining runs finish in fewer GPU-hours',
            'Decode of bandwidth-bound giants: weight bytes per token fall ~1.8× vs FP8 (about 4.5 bits with scales) for MoEs',
            'Higher accuracy than FP8, because per-16-element scales give finer dynamic range than FP8\'s single per-tensor scale',
            'Simpler kernels, since one 4-bit format removes the dequantize and scale-handling steps that FP8 pipelines need',
          ],
          correct: [1],
          explanation:
            'On the bandwidth slope, shrinking weight bytes raises the rate in proportion (T4.L3). NVFP4 is ~4.5 bits per weight with its block scales, so ~1.8× fewer bytes than FP8, not a clean 2×. The flagship demo was DeepSeek-R1 at NVFP4 on B200. Accuracy work lives in the microscaling (per-16-element FP8 scales) and keeping activations at higher precision.',
          why: [
            'The production win is inference: weights read on every decode step. Training updates need higher-precision accumulation and master weights, so 4-bit weights are not a training-speed story.',
            'Right: on the bandwidth-bound decode path, rate scales with fewer bytes per token. NVFP4 is ~4.5 bits with scales, ~1.8× fewer weight bytes than FP8, so big MoEs need less fleet.',
            'Microscaling narrows the accuracy gap but 4 bits still carry less precision than FP8. FP4 trades a small accuracy risk for bytes, and activations stay wider to protect quality.',
            'FP4 adds block scales and extra handling in the kernels, so they get more intricate, not simpler. The payoff is fewer bytes moved, not less code.',
          ],
        },
        {
          q: 'GB200 NVL72 changes architecture (not just speed) because…',
          options: [
            'It cuts per-GPU power draw enough to pack more accelerators per rack, so the same footprint delivers more total FLOPs',
            '72 GPUs share one ~1.8 TB/s per-GPU NVLink domain, so TP, EP and CP groups that stopped at 8 GPUs can span a whole rack',
            'Direct liquid cooling lets the GPUs sustain boost clocks, so per-GPU throughput rises enough to change batch sizes',
            'A Grace CPU beside each pair of GPUs gives the rack a unified host memory pool, so KV cache never needs to leave the rack',
          ],
          correct: [1],
          explanation:
            'T6.L4\'s rule — per-layer collectives need the NVLink tier — used to bound those axes to ~8 GPUs. NVL72 makes it 72. That is why wide-EP decode and CP-over-32-nodes are production patterns now.',
          why: [
            'Power and cooling are facility concerns, not what changes the design. The architectural change is NVLink domain size, which sets how wide TP, EP and CP can go.',
            'Right: per-layer collectives need the NVLink tier, which used to end at about 8 GPUs. A 72-GPU domain lets TP, EP and CP span a rack without dropping to RDMA.',
            'Cooling affects sustained clocks, a modest per-GPU effect. The topology change comes from the NVLink domain, which turns cross-node RDMA hops into in-domain hops.',
            'Host memory extends capacity but at far lower bandwidth than HBM, so it is a tier, not a fix for per-layer collectives. The change that matters is the 72-GPU NVLink domain.',
          ],
        },
        {
          q: 'The production quantization recipe on Blackwell is…',
          options: [
            'Everything in FP4, including weights, activations and KV cache, because the tensor cores run FP4 natively',
            'FP4 weights with microscaling and wider activations: weights tolerate 4 bits, activations and outliers still want 8 bits or more',
            'INT4 everywhere with one per-tensor scale, since an integer grid gives uniform resolution and avoids FP4\'s coarse spacing',
            'BF16 throughout, because weights are cheap to store and quantization only pays off when the model no longer fits in HBM',
          ],
          correct: [1],
          explanation:
            'The cliff didn\'t move: activations and outliers remain the fragile path. Weight-only FP4 + FP8/BF16 activations is what ships; end-to-end FP4 is still research-grade.',
          why: [
            'Native FP4 execution does not remove outlier sensitivity. Activations and KV keep wider formats in the shipped recipes; end-to-end FP4 is still being worked out.',
            'Right: weights tolerate 4 bits when block scales absorb the range, but activations and outliers are the fragile path, so they stay at 8 bits or wider.',
            'One per-tensor scale lets outliers wreck 4-bit accuracy; the per-block scale is what makes 4 bits survivable. Blackwell\'s native path is NVFP4, not INT4 everywhere.',
            'Decode is bandwidth-bound even when the model fits, so fewer bytes per token raises tokens/s. Quantization is a speed lever as well as a capacity one.',
          ],
        },
        {
          q: 'Re-deriving T4\'s roofline for B200: the decode rate roughly…',
          options: [
            'Stays unchanged, since decode is limited by the model\'s FLOP count and Blackwell\'s extra FLOPs go to prefill',
            'Rises ~2.4× over H100 at equal precision (8 vs 3.35 TB/s), then ~1.8× more from FP4 over FP8 weights',
            'Falls below H100 per GPU, because FP4\'s block scale factors add extra reads that cancel the bandwidth gain',
            'Follows peak tensor FLOPs instead, so FP4\'s higher TFLOPS multiplies decode rate even if bandwidth stayed fixed',
          ],
          correct: [1],
          explanation:
            'Decode is bandwidth-bound: tokens/s ≈ BW ÷ bytes/token. Bandwidth up 2.4×, weight bytes down ~1.8× at NVFP4 (4.5 bits vs 8) — compounding levers, which is why the per-generation economics jumped instead of crept (T7.L4 prices it).',
          why: [
            'Decode sits far below the ridge, so its rate follows bandwidth, not FLOPs. B200\'s ~8 TB/s against H100\'s 3.35 TB/s lifts the ceiling about 2.4× at equal precision.',
            'Right: tokens/s ≈ bandwidth ÷ bytes per token. Bandwidth is ~2.4× higher, and NVFP4 at ~4.5 bits moves ~1.8× fewer weight bytes than FP8, so the gains compound.',
            'The scales add about 0.5 bit per weight, so FP4 saves ~1.8× rather than 2×, still a net gain. Bandwidth also rose, so the rate cannot fall.',
            'Decode has low arithmetic intensity, so extra FLOPs sit idle waiting for bytes. Peak TFLOPS help prefill and large batches, not the bandwidth-bound decode path.',
          ],
        },
      ],
    },
    {
      type: 'deepdive',
      title: 'The AMD footnote',
      md: `The roofline is vendor-neutral, and so is this lesson's question: "bandwidth and capacity per dollar?" MI300X/MI355X compete exactly there — 192–288 GB HBM3e, and AMD's inference path of choice is SGLang with aiter kernels (their published claim: MI355X slightly cheaper per token than B200 TRT-LLM on specific MoE configs, 2026). The framework from T6.L4 and this lesson — bytes, bandwidth, interconnect — is what lets you evaluate that claim in a meeting instead of believing it. InferenceX (formerly InferenceMAX), covered in T7.L2, publishes the measured versions nightly.`,
    },
  ],
}

export default lesson
