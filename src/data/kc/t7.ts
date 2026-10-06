/**
 * T7 (economics and operations) KCs that Wave 2's contract names (docs/specs/wave-2.md §4.2): the inputs of
 * the goodput and cost families, the Daily's burn and the signature items. The rest of T7 joins the graph
 * with its tickets in 2a-11.
 *
 * Each KC's `gen` names a family that may not have landed; verify-kc requires its `Gen.kcs` to agree
 * with these links once it does (§4.2), so a family task never edits this file.
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
    gen: ['goodput'],
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
    gen: ['goodput'],
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
    gen: ['goodput'],
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
    gen: ['cost'],
    since,
  },

  /* ---- t7.l5 ---- */
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
]
