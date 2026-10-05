/**
 * T6 (frontier serving) KCs that Wave 2's contract names (docs/specs/wave-2.md §4.2): the inputs of the
 * memory, cost and spec families. The rest of T6 joins the graph with its tickets in 2a-11.
 *
 * Each KC's `gen` names a family that may not have landed; verify-kc requires its `Gen.kcs` to agree
 * with these links once it does (§4.2), so a family task never edits this file.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T6_KCS: readonly Kc[] = [
  /* ---- t6.l1 ---- */
  {
    id: KC.moeActiveParams,
    title: 'MoE active versus total parameters',
    can: 'You can separate an MoE model\'s total parameters (memory held) from its active ones (compute and bytes read per token).',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l1'],
    requires: [KC.quantizedBytes],
    gen: ['memory'],
    since,
  },

  /* ---- t6.l2 ---- */
  {
    id: KC.epEconomics,
    title: 'Expert-parallel economics',
    can: 'You can price a wide expert-parallel deployment per node-day and per token from node price and throughput.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l2'],
    requires: [KC.moeActiveParams],
    gen: ['cost'],
    since,
  },

  /* ---- t6.l4 ---- */
  {
    id: KC.parallelMemory,
    title: 'Memory per GPU under TP, PP, DP and EP',
    can: 'You can compute per-GPU weight bytes for a TP×PP×DP×EP layout, and say which axes shard which tensors.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l4'],
    requires: [KC.quantizedBytes],
    gen: ['memory'],
    since,
  },

  /* ---- t6.l5 ---- */
  {
    id: KC.fp4Capacity,
    title: 'FP4 capacity gains',
    can: 'You can compute what FP4 weights and KV change: the model that fits and the cache tokens left, scales included.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l5'],
    requires: [KC.quantizedBytes],
    gen: ['memory'],
    since,
  },

  /* ---- t6.l6 ---- */
  {
    id: KC.specAcceptance,
    title: 'Speculative acceptance economics',
    can: 'You can compute speedup from acceptance rate, draft length and draft cost, and find where a longer draft stops paying.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l6'],
    requires: [KC.speculativeDecoding],
    gen: ['spec'],
    since,
  },

  /* ---- t6.l8 ---- */
  {
    id: KC.agentPrefixLocality,
    title: 'Agent prefix locality',
    can: 'You can estimate cache hit rate and cost for an agent loop from its shared prefix, and say what breaks locality.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l8'],
    requires: [KC.prefixRouting],
    gen: ['cost'],
    since,
  },

  /* ---- t6.l9 ---- */
  {
    id: KC.loraAdapterBytes,
    title: 'LoRA adapter bytes',
    can: 'You can compute an adapter\'s bytes from its rank and target matrices, and how many fit beside the base model.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l9'],
    requires: [KC.quantizedBytes],
    gen: ['memory'],
    since,
  },
]
