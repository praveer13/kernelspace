/**
 * T4 (GPU architecture) KCs: the roofline family, RooflineSim tasks and Boot (docs/specs/wave-1.md §4.9),
 * `t4.quantized-bytes` for the memory family (wave-2.md §4.2), and the rest of T4 (task 2a-11), 2-3 per
 * lesson, seeded from each lesson's H2s, statline row and checkpoint items.
 *
 * The track's spine is the GPU notional machine (notional.ts): warps on SMs, a memory ladder, a roofline.
 * t4.l1-t4.l2 build the machine, t4.l3 prices it, t4.l4-t4.l6 make kernels fit it and t4.l7 shrinks the bytes.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T4_KCS: readonly Kc[] = [
  /* ---- t4.l1 ---- */
  {
    id: 't4.throughput-design',
    title: 'Latency versus throughput machines',
    can: 'You can contrast a CPU\'s few fast cores with a GPU\'s thousands of lanes, and say which workloads fill each.',
    track: 't4',
    kind: 'concept',
    lessons: ['t4.l1'],
    requires: ['t0.latency-ladder'],
    since,
  },
  {
    id: 't4.simt-warps',
    title: 'SIMT, warps and divergence',
    can: 'You can say how a warp runs one instruction across 32 lanes, and why lanes that branch apart take turns.',
    track: 't4',
    kind: 'concept',
    lessons: ['t4.l1'],
    requires: ['t4.throughput-design'],
    since,
  },

  /* ---- t4.l2 ---- */
  {
    id: 't4.gpu-memory-ladder',
    title: 'The GPU memory ladder',
    can: 'You can order registers, shared memory, L2 and HBM by size and bandwidth, and say which tiers each SM owns.',
    track: 't4',
    kind: 'fact',
    lessons: ['t4.l2'],
    requires: ['t0.latency-ladder', 't4.simt-warps'],
    claims: ['hw.h100-sxm.hbm-capacity', 'hw.h100-sxm.hbm-bw'],
    since,
  },
  {
    id: 't4.shared-memory-scratchpad',
    title: 'Shared memory is a scratchpad',
    can: 'You can say why shared memory is a scratchpad the kernel fills by hand, and why spilled registers fall to slow memory.',
    track: 't4',
    kind: 'concept',
    lessons: ['t4.l2'],
    requires: ['t4.gpu-memory-ladder'],
    gen: ['tiling'],
    since,
  },

  /* ---- t4.l3 ---- */
  {
    id: KC.ridgePoint,
    title: 'The ridge point',
    can: 'You can compute a chip\'s ridge point (peak FLOP/s ÷ memory bandwidth) and find it on a roofline.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l3'],
    requires: [KC.locality],
    confusable: [KC.decodeBandwidth],
    // `step` (s5 §7.5): the decode step's intensity with the KV cache, against the ridge
    gen: ['roofline', 'tiling', 'step'],
    claims: ['hw.h100-sxm.bf16-dense', 'hw.h100-sxm.hbm-bw'],
    since,
  },
  {
    id: KC.boundClassification,
    title: 'Bound classification',
    can: 'You can classify a kernel as bandwidth- or compute-bound from its arithmetic intensity and the ridge point.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l3'],
    requires: [KC.ridgePoint],
    contains: [KC.ridgePoint],
    threshold: 'core',
    gen: ['roofline'],
    since,
  },
  {
    id: KC.decodeBandwidth,
    title: 'Decode is bandwidth-bound',
    can: 'You can estimate batch-1 decode speed as memory bandwidth ÷ weight bytes, and say why compute sits idle.',
    track: 't4',
    kind: 'procedure',
    // t6.l5 re-runs the arithmetic on a B200 (a revisit, not a Blackwell-only KC)
    lessons: ['t4.l3', 't0.l1', 't5.l3', 't6.l5'],
    requires: [KC.boundClassification],
    confusable: [KC.ridgePoint],
    // `step` (s5 §7.2): the decode step's milliseconds, KV and the max with the math included
    gen: ['roofline', 'step'],
    claims: ['hw.h100-sxm.hbm-bw', 'model.llama3-8b.params'],
    since,
  },

  /* ---- t4.l4 ---- */
  {
    id: 't4.occupancy',
    title: 'Occupancy',
    can: 'You can find the resident warps per SM from registers, shared memory and block size, and say how they hide latency.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l4'],
    requires: ['t4.simt-warps', 't4.shared-memory-scratchpad'],
    // the two levers of t4.l4: more warps hide latency, merged accesses cut transactions; the slip fixes one with the other
    confusable: ['t4.coalescing'],
    gen: ['tiling'],
    since,
  },
  {
    id: 't4.coalescing',
    title: 'Coalescing and bank conflicts',
    can: 'You can count the memory transactions of one warp load from its lane addresses, and spot a shared-memory bank conflict.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l4'],
    requires: ['t4.simt-warps', 't0.cache-lines'],
    confusable: ['t4.occupancy'],
    since,
  },

  /* ---- t4.l5 ---- */
  {
    id: 't4.compute-grid',
    title: 'Workgroups and the dispatch grid',
    can: 'You can map a global invocation id to the element it owns, and size a dispatch so every element is covered once.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l5'],
    requires: ['t4.simt-warps'],
    since,
  },
  {
    id: 't4.parallel-reduction',
    title: 'Tree reduction and barriers',
    can: 'You can write a tree reduction with workgroup barriers, and say why it beats every thread adding to one atomic.',
    track: 't4',
    kind: 'skill',
    lessons: ['t4.l5'],
    requires: ['t4.compute-grid', 't4.shared-memory-scratchpad'],
    since,
  },

  /* ---- t4.l6 ---- */
  {
    id: KC.tilingIntensity,
    title: 'Tiling raises intensity',
    can: 'You can compute how a matmul tile raises arithmetic intensity (T/2 at FP16), and why tiles cannot grow forever.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l6'],
    requires: [KC.boundClassification, KC.locality],
    gen: ['roofline'],
    since,
  },
  {
    id: KC.rasterL2Reuse,
    title: 'Raster order decides L2 reuse',
    can: 'You can say why the order a grid visits tiles sets how many A and B slabs a wave shares through L2.',
    track: 't4',
    kind: 'concept',
    lessons: ['t4.l6'],
    requires: [KC.tilingIntensity],
    gen: ['tiling'],
    since,
  },
  {
    id: 't4.flashattention-blocking',
    title: 'FlashAttention as cache blocking',
    can: 'You can say how FlashAttention streams tiles through SRAM with an online softmax, never writing the score matrix.',
    track: 't4',
    kind: 'concept',
    lessons: ['t4.l6'],
    requires: [KC.tilingIntensity, 't4.shared-memory-scratchpad'],
    gen: ['tiling'],
    since,
  },

  /* ---- t4.l7 (the T4 spiral) ---- */
  {
    id: 't4.number-formats',
    title: 'FP16, BF16, FP8 and INT4',
    can: 'You can say what exponent and mantissa bits buy (range versus precision), and why BF16 trains where FP16 overflows.',
    track: 't4',
    kind: 'concept',
    lessons: ['t4.l7'],
    requires: ['r.scalar-types'],
    since,
  },
  {
    id: KC.quantizedBytes,
    title: 'Bytes per weight when quantized',
    can: 'You can compute weight bytes at FP16, FP8 and INT4 with scale overhead, and the decode speedup that bandwidth gives.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l7'],
    requires: [KC.decodeBandwidth],
    gen: ['memory'],
    since,
  },
  {
    id: 't4.quantization-error',
    title: 'Group scales and quantization error',
    can: 'You can say why per-group scales contain outliers, and rank weights, KV and activations by how hard they quantize.',
    track: 't4',
    kind: 'concept',
    lessons: ['t4.l7'],
    requires: ['t4.number-formats', KC.quantizedBytes],
    since,
  },
]
