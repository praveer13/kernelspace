/**
 * T7 (economics and operations) KCs: Wave 2's contract ids (docs/specs/wave-2.md §4.2), the inputs of the
 * goodput and cost families, the Daily's burn and the signature items, and the rest of T7 (task 2a-11),
 * 2-3 per lesson, in lesson order.
 *
 * Each contract KC's `gen` names a family that may not have landed; verify-kc requires its `Gen.kcs` to
 * agree with these links once it does (§4.2), so a family task never edits this file. The track's spine is
 * the business notional machine (notional.ts): goodput at an SLO, cost per GPU-hour, the operating point.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T7_KCS: readonly Kc[] = [
  /* ---- t7.l1 ---- */
  {
    id: KC.sloErrorBudget,
    title: 'SLOs and the error budget',
    can: 'You can turn an SLO into an error budget, and compute how fast a given failure rate burns it.',
    track: 't7',
    kind: 'procedure',
    lessons: ['t7.l1'],
    requires: [],
    since,
  },
  {
    id: KC.goodput,
    title: 'Goodput',
    can: 'You can compute goodput as the work that met every SLO per second, and say why raw throughput misleads.',
    track: 't7',
    kind: 'procedure',
    lessons: ['t7.l1'],
    requires: [KC.sloErrorBudget],
    confusable: [KC.batchingThroughput],
    gen: ['goodput'],
    since,
  },
  {
    id: 't7.tail-percentiles',
    title: 'Tail percentiles',
    can: 'You can say why a latency SLO is written at p95 or p99, and why a mean hides the slow requests users remember.',
    track: 't7',
    kind: 'concept',
    lessons: ['t7.l1'],
    requires: ['t5.latency-metrics'],
    since,
  },

  /* ---- t7.l2 ---- */
  {
    id: KC.goodputCurve,
    title: 'The goodput curve',
    can: 'You can read goodput against offered load, find the knee, and say why it collapses past it.',
    track: 't7',
    kind: 'concept',
    lessons: ['t7.l2'],
    requires: [KC.goodput],
    // both pick the best point that meets an SLO off a throughput curve; the slip reads the load knee as the
    // per-GPU/per-user operating point, or the reverse (the goodput family's `knee` and `frontier` variants)
    confusable: [KC.paretoFrontier],
    gen: ['goodput'],
    since,
  },
  {
    id: 't7.benchmark-hygiene',
    title: 'Honest benchmarks',
    can: 'You can spot a benchmark without real traffic, warmup, enough samples or identical stacks, and say what each skews.',
    track: 't7',
    kind: 'skill',
    lessons: ['t7.l2'],
    requires: ['t7.tail-percentiles', KC.goodputCurve],
    since,
  },

  /* ---- t7.l3 ---- */
  {
    id: KC.paretoFrontier,
    title: 'The Pareto frontier',
    can: 'You can pick the non-dominated points of a tok/s/GPU versus tok/s/user sweep, and choose one by SLO.',
    track: 't7',
    kind: 'procedure',
    lessons: ['t7.l3'],
    requires: [KC.goodputCurve],
    confusable: [KC.goodputCurve],
    gen: ['goodput'],
    since,
  },
  {
    id: 't7.frontier-shifts',
    title: 'Sliding along versus moving the frontier',
    can: 'You can tell a dial that slides along the frontier, like batch size, from a change that moves it, like FP4 or MTP.',
    track: 't7',
    kind: 'concept',
    lessons: ['t7.l3'],
    requires: [KC.paretoFrontier],
    since,
  },

  /* ---- t7.l4 ---- */
  {
    id: KC.costPerMtok,
    title: 'Cost per million tokens',
    can: 'You can compute $/Mtok from GPU price and throughput, and divide by tokens delivered within SLO.',
    track: 't7',
    kind: 'procedure',
    lessons: ['t7.l4'],
    requires: [KC.goodput],
    confusable: [KC.epEconomics],
    gen: ['cost'],
    since,
  },
  {
    id: 't7.output-token-premium',
    title: 'Why output tokens cost more',
    can: 'You can say why output tokens are priced several times input tokens, from parallel prefill and serial decode.',
    track: 't7',
    kind: 'concept',
    lessons: ['t7.l4'],
    requires: [KC.costPerMtok, 't5.prefill-vs-decode'],
    since,
  },
  {
    id: 't7.tokens-per-megawatt',
    title: 'Tokens per megawatt',
    can: 'You can compute tokens per megawatt, and say why power rather than GPU count caps a power-limited fleet\'s revenue.',
    track: 't7',
    kind: 'procedure',
    lessons: ['t7.l4'],
    requires: [KC.costPerMtok],
    since,
  },

  /* ---- t7.l5 (the T7 spiral) ---- */
  {
    id: KC.capacityPlanning,
    title: 'Capacity planning',
    can: 'You can size a fleet for peak load at an SLO with headroom, and say what losing a node does to it.',
    track: 't7',
    kind: 'procedure',
    lessons: ['t7.l5'],
    requires: [KC.goodput],
    gen: ['goodput', 'sig'],
    since,
  },
  {
    id: KC.incidentDiagnosis,
    title: 'Incident diagnosis',
    can: 'You can read telemetry for utilization, saturation and errors, and name the failing component before changing anything.',
    track: 't7',
    kind: 'skill',
    lessons: ['t7.l5'],
    requires: [KC.sloErrorBudget],
    gen: ['sig'],
    since,
  },
  {
    id: 't7.leading-signals',
    title: 'Scaling on leading signals',
    can: 'You can say why a planner scales on queue age and KV use before TTFT breaks, and what to shed when capacity is late.',
    track: 't7',
    kind: 'concept',
    lessons: ['t7.l5'],
    requires: [KC.capacityPlanning, KC.admissionHeadroom],
    since,
  },
]
