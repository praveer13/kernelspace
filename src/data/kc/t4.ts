/**
 * T4 (GPU architecture) KCs that Wave 1 needs: the roofline family, RooflineSim tasks and Boot
 * (docs/specs/wave-1.md §4.9). The rest of T4 joins the graph with its tickets in Wave 2.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T4_KCS: readonly Kc[] = [
  {
    id: KC.ridgePoint,
    title: 'The ridge point',
    can: 'You can compute a chip\'s ridge point (peak FLOP/s ÷ memory bandwidth) and find it on a roofline.',
    track: 't4',
    kind: 'procedure',
    lessons: ['t4.l3'],
    requires: [KC.locality],
    confusable: [KC.decodeBandwidth],
    gen: ['roofline'],
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
    lessons: ['t4.l3', 't0.l1', 't5.l3'],
    requires: [KC.boundClassification],
    confusable: [KC.ridgePoint],
    gen: ['roofline'],
    claims: ['hw.h100-sxm.hbm-bw', 'model.llama3-8b.params'],
    since,
  },
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
]
