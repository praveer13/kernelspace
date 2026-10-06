/**
 * sim-roofline tasks in the registry (P2, docs/specs/wave-1.md §10.2).
 *
 * `ROOFLINE_TASKS`: the six outcome tasks, predict → run → explain. Each is graded on the first value
 * the sim reports for its `observe` key after the prediction is locked (`observationsFor` in
 * src/lib/sims/models/roofline.ts), and shown in phone mode from the same model's canonical outcome.
 * They replace the click-through tasks named in each `legacyId`.
 *
 * `ROOFLINE_LEGACY_TASKS`: the tasks that still complete on a state change and pay 0 XP until Wave 3. They
 * are registered so a lesson's exercise block can list them with their real completion state.
 *
 * Hardware numbers in the prompts are formatted from the atlas, never typed. The scenario numbers (batch 1,
 * a 128 × 128 tile, a 32k context, head dimension 128) are synthetic and declared so.
 */

import { KC } from '@/data/kc/ids'
import { ATTENTION, MACHINES, SETUP, batchToRidge, fmtAI, fmtPeak, fmtTBs, ridgeAI } from '@/lib/sims/models/roofline'
import type { SimTaskDef } from '@/lib/sims/types'

const { h100, b200 } = MACHINES
const h100Ridge = ridgeAI(h100)
const b200Ridge = ridgeAI(b200)
const h100Fp8Ridge = ridgeAI(h100, SETUP.fp8.dtype)
const batchFirst = batchToRidge(h100, SETUP.decode.dtype)

export const ROOFLINE_TASKS: SimTaskDef[] = [
  {
    id: 'roof.ridge',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the B200 ridge point',
    setup: 'Choose B200 in the hardware menu and keep the precision ceiling on FP16. The sim reports that machine\'s ridge.',
    kcs: [KC.ridgePoint],
    predict: {
      kind: 'numeric',
      prompt: `A B200 delivers ${fmtPeak(b200.peak)} of dense FP16 and ${fmtTBs(b200.bw)} of HBM bandwidth. At what arithmetic intensity do the bandwidth slope and the compute ceiling meet?`,
      unit: 'FLOP/B',
      tolerance: { rel: 0.05 },
    },
    observe: 'roof.ridge',
    explain: {
      prompt: 'In one line: why does the ridge sit there, and what changes for a kernel on either side of it?',
      model: `The ridge is peak FLOP/s divided by peak bandwidth, ${fmtPeak(b200.peak)} over ${fmtTBs(b200.bw)}, about ${fmtAI(b200Ridge)} FLOP/B. A kernel left of it is capped by the bandwidth slope, one right of it by the flat compute ceiling.`,
      ideas: ['The ridge is peak FLOP/s divided by peak bandwidth', 'Left of it, bandwidth caps the kernel', 'Right of it, the compute ceiling caps it'],
    },
    note: 'The ridge is a property of the **machine**, one division of two datasheet numbers. A kernel\'s intensity is a property of the **kernel**. Comparing the two is the whole classification.',
    phone: { canonical: 'roofline.b200-ridge' },
    lessons: ['t4.l3'],
    legacyId: 't-roof-b200-ridge',
  },
  {
    id: 'roof.decode-bound',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Classify decode at batch 1 on the H100',
    setup: 'Pick H100 with the FP16 ceiling, leave the batch at ×1, then click "decode @ 70B" in the kernel library to plot it.',
    kcs: [KC.boundClassification],
    predict: {
      kind: 'choice',
      prompt: 'Decoding one token at a time (batch 1) reads every weight once for about one FLOP per byte. On an H100 at FP16, which limit does it hit first?',
      options: [
        { id: 'bandwidth', text: 'The bandwidth slope: it waits on HBM while the compute units idle' },
        { id: 'compute', text: 'The compute ceiling: it runs out of FLOP/s before HBM is saturated' },
      ],
    },
    observe: 'roof.decode-bound',
    explain: {
      prompt: 'Say why in one line, using intensity and the ridge.',
      model: `Decode at batch ${SETUP.decode.batch} does about one FLOP per byte of weights, far left of the H100's ridge at ${fmtAI(h100Ridge)} FLOP/B. Attainable speed is bandwidth times intensity there, so extra FLOP/s would not help.`,
      ideas: ['Decode intensity is about 1 FLOP/B', 'That sits far left of the ridge', 'Speed is set by bandwidth, so more FLOP/s will not help'],
    },
    note: 'Decode sits on the **sloped wall**. Its dot rides the bandwidth line, hundreds of times below the compute ceiling. That is why batching, quantization and speculative decoding, all levers on bytes per FLOP, matter more than a faster chip.',
    phone: { canonical: 'roofline.decode-bound' },
    lessons: ['t4.l3'],
    legacyId: 't-decode',
  },
  {
    id: 'roof.batch-to-ridge',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Batch decode until it reaches the ridge',
    setup: 'On the H100 at FP16, plot decode, then raise the batch slider until its dot reaches the flat compute roof.',
    kcs: [KC.decodeBandwidth],
    predict: {
      kind: 'numeric',
      prompt: `Every request in a decode batch shares the same weight reads, so a batch of N has N times the intensity of batch 1. On an H100 at FP16 (ridge about ${fmtAI(h100Ridge)} FLOP/B), which slider step is the first to reach the ridge?`,
      unit: 'requests',
      tolerance: { rel: 0.45 },
    },
    observe: 'roof.batch-to-ridge',
    explain: {
      prompt: 'Why does batching move decode right, and why does it stop helping?',
      model: `All requests in the batch reuse one read of the weights, so FLOPs grow with the batch while bytes stay fixed and intensity rises in proportion. At batch ${batchFirst ?? '?'} it passes the ridge, the compute ceiling takes over, and a bigger batch no longer speeds each step up.`,
      ideas: ['The batch shares one read of the weights', 'Intensity grows in proportion to batch', 'Past the ridge the compute ceiling takes over'],
    },
    note: 'Batching is a **ride along the slope**: throughput climbs with the batch until the dot meets the roof. Past that point the batch adds latency without adding speed.',
    phone: { canonical: 'roofline.batch-to-ridge' },
    lessons: ['t4.l3'],
    legacyId: 't-batch',
  },
  {
    id: 'roof.tile-ai',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the intensity of a 128 × 128 tile',
    setup: 'In "tiling & attention", drag the matmul tile T up from 16 to 128. The sim reports the intensity at T = 128.',
    kcs: [KC.tilingIntensity],
    predict: {
      kind: 'numeric',
      prompt: `A matmul kernel computes one ${SETUP.tile} × ${SETUP.tile} output tile at a time and loads its operand slabs from HBM once per tile, with 2-byte FP16 elements. What arithmetic intensity does the tile reach?`,
      unit: 'FLOP/B',
      tolerance: { rel: 0.1 },
    },
    observe: 'roof.tile-ai',
    explain: {
      prompt: 'Where does the extra intensity come from?',
      model: 'Each A and B element staged in shared memory is reused T times. A T × T tile does 2·T²·K FLOPs on 2·T·K·2 bytes, so FP16 intensity is T/2, and it grows linearly with T.',
      ideas: ['Each staged element is reused T times', 'FLOPs grow as T² while bytes grow only as T', 'At FP16 the intensity is T/2'],
    },
    note: 'Tiling does not change the FLOPs. It changes **which tier feeds them**: each byte from HBM now serves T multiplies, so the dot moves right along the roofline.',
    phone: { canonical: 'roofline.tile-ai' },
    lessons: ['t4.l6'],
    legacyId: 't-roof-tile',
  },
  {
    id: 'roof.flash-ai',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict FlashAttention\'s intensity at 32k context',
    setup: 'Under "attention view", switch from naive to flash. The sim reports the intensity of the flash view.',
    kcs: [KC.tilingIntensity],
    predict: {
      kind: 'numeric',
      prompt: `At a ${ATTENTION.context.toLocaleString('en-US')}-token context with head dimension ${ATTENTION.headDim}, naive attention writes the N × N FP16 score matrix to HBM and sits near ${ATTENTION.naiveAI} FLOP/B. FlashAttention does the same FLOPs but keeps the scores in SRAM and moves only Q, K and V (3 · N · ${ATTENTION.headDim} FP16 values). What intensity does the sim report for it?`,
      unit: 'FLOP/B',
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'roof.flash-ai',
    explain: {
      prompt: 'What did FlashAttention change, and what did it leave alone?',
      model: 'It leaves the FLOPs alone and removes the N × N score traffic by keeping partial scores in SRAM with an online softmax. The same math moves far fewer bytes, so intensity rises by roughly the byte ratio and attention moves toward the compute roof.',
      ideas: ['The FLOPs are unchanged', 'The N × N scores never go to HBM', 'Fewer bytes for the same FLOPs raise the intensity'],
    },
    note: 'FlashAttention is **cache blocking applied to attention**. The sim\'s flash figure is a round number of the right order (the byte ratio is about N / 3d); real kernels land lower once rescaling work and tile shapes are counted.',
    phone: { canonical: 'roofline.flash-ai' },
    lessons: ['t4.l6'],
    legacyId: 't-roof-flash',
  },
  {
    id: 'roof.fp8-ridge',
    simId: 'sim-roofline',
    kind: 'outcome',
    title: 'Predict the H100 ridge at the FP8 ceiling',
    setup: 'Pick H100 with the FP16 ceiling, then switch the precision ceiling to FP8. The sim reports the new ridge.',
    kcs: [KC.ridgePoint],
    predict: {
      kind: 'numeric',
      prompt: `An H100 delivers ${fmtPeak(h100.peak)} of dense FP16 against ${fmtTBs(h100.bw)} of HBM bandwidth, and FP8 doubles the peak. Where is its ridge at the FP8 ceiling?`,
      unit: 'FLOP/B',
      tolerance: { rel: 0.05 },
    },
    observe: 'roof.fp8-ridge',
    explain: {
      prompt: 'Why does the ridge move when only the precision changes?',
      model: `The ridge is peak FLOP/s over bandwidth. FP8 doubles the peak and leaves the bandwidth alone, so the ridge doubles from ${fmtAI(h100Ridge)} to ${fmtAI(h100Fp8Ridge)} FLOP/B: a kernel now needs twice the intensity to be compute-bound.`,
      ideas: ['The ridge is peak FLOP/s over bandwidth', 'FP8 doubles the peak FLOP/s', 'Bandwidth is unchanged, so the ridge doubles'],
    },
    note: 'Lower precision raises the **ceiling**, not the slope. The bandwidth wall stays where it was, so more of the chart now lies under it.',
    phone: { canonical: 'roofline.fp8-ridge' },
    lessons: ['t4.l3'],
    legacyId: 't-roof-dtype',
  },
]

/** The tasks that still complete when the sim detects a state (0 XP, kept until Wave 3's remaining P2 work). */
const legacy = (id: string, title: string, machine: 'cpu-gpu' | 'roofline', lessons: string[]): SimTaskDef => ({
  id,
  simId: 'sim-roofline',
  machine,
  kind: 'legacy',
  title,
  setup: title,
  kcs: [],
  lessons,
})

export const ROOFLINE_LEGACY_TASKS: SimTaskDef[] = [
  legacy('t-cpu-serial', 'Compare the serial dependency chain on CPU and GPU', 'cpu-gpu', ['t4.l1']),
  legacy('t-gpu-map', 'Compare a 64M elementwise map on CPU and GPU', 'cpu-gpu', ['t4.l1']),
  legacy('t-gpu-divergence', 'Compare the 64M map with divergent warp branches', 'cpu-gpu', ['t4.l1']),
  legacy('t-roof-occupancy', 'Raise registers until occupancy drops below 25%', 'roofline', ['t4.l1', 't4.l4']),
  legacy('t-roof-coalesce', 'Recover scattered global loads with coalesced shared-memory staging', 'roofline', ['t4.l4']),
  legacy('t-roof-bank', 'Fix a 32-way shared-memory bank conflict with padding', 'roofline', ['t4.l4']),
  legacy('t-roof-tiers', 'Sweep working set across shared / L2 / HBM cliffs', 'roofline', ['t4.l2']),
  legacy('t-roof-pcie', 'Measure the CPU→GPU PCIe transfer cliff', 'roofline', ['t4.l2']),
  legacy('t-roof-fleet-router', 'Classify and place Fleet router scoring', 'roofline', ['t4.l3']),
  legacy('t-roof-fleet-decode', 'Classify and place 70B batch-32 decode', 'roofline', ['t4.l3']),
  legacy('t-roof-fleet-paged-attn', 'Classify and place paged attention', 'roofline', ['t4.l3']),
  legacy('t-roof-fleet-prefill', 'Classify and place 512-token prefill', 'roofline', ['t4.l3']),
]
