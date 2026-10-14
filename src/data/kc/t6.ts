/**
 * T6 (frontier serving) KCs: Wave 2's contract ids (docs/specs/wave-2.md §4.2), the inputs of the memory,
 * cost and spec families, and the rest of T6 (task 2a-11), 2-3 per lesson, in lesson order.
 *
 * Each contract KC's `gen` names a family that may not have landed; verify-kc requires its `Gen.kcs` to
 * agree with these links once it does (§4.2), so a family task never edits this file. The track's spine is
 * the fleet notional machine (notional.ts): experts and routers, the parallelism axes, the interconnect ladder.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T6_KCS: readonly Kc[] = [
  /* ---- t6.l1 (and t5.attention-variants revisited for MLA) ---- */
  {
    id: KC.moeActiveParams,
    title: 'MoE active versus total parameters',
    can: 'You can separate an MoE model\'s total parameters (memory held) from its active ones (compute and bytes read per token).',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l1'],
    requires: [KC.quantizedBytes],
    confusable: [KC.kvReadsVsCapacity],
    gen: ['memory'],
    since,
  },
  {
    id: 't6.all-to-all',
    title: 'Expert routing and the all-to-all',
    can: 'You can say why each MoE layer needs a dispatch and a combine all-to-all, and how one hot expert stalls every GPU.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l1'],
    requires: [KC.moeActiveParams, 't5.parallelism-axes'],
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
    // per node-day against per GPU-hour: the ×GPUs slip (diagnosis cost.per-gpu-vs-node)
    confusable: [KC.costPerMtok],
    gen: ['cost'],
    since,
  },
  {
    id: 't6.expert-load-balance',
    title: 'Expert load balancing',
    can: 'You can say how EPLB replicates and places hot experts to even GPU load, since the slowest GPU sets each layer\'s pace.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l2'],
    requires: ['t6.all-to-all'],
    since,
  },
  {
    id: 't6.comm-overlap',
    title: 'Hiding the all-to-all under compute',
    can: 'You can say how dual-batch overlap runs one micro-batch\'s all-to-all under the other\'s compute, and when it fails.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l2'],
    requires: ['t6.all-to-all'],
    since,
  },

  /* ---- t6.l3 ---- */
  {
    id: 't6.epd-phases',
    title: 'Encode, prefill and decode fleets',
    can: 'You can say why multimodal encode becomes a third fleet beside prefill and decode, and what each phase is bound by.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l3'],
    requires: ['t5.pd-disaggregation'],
    gen: ['prefill'],
    since,
  },
  {
    id: 't6.kv-tiering',
    title: 'KV tiers and transfer',
    can: 'You can place KV blocks across HBM, CPU memory and remote storage, and say when moving one beats recomputing it.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l3'],
    requires: ['t5.pd-disaggregation', 't2.swap-vs-recompute'],
    gen: ['prefill'],
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
  {
    id: 't6.parallelism-composition',
    title: 'Composing the parallelism axes',
    can: 'You can lay out TP inside an NVLink domain, then PP, EP and CP across nodes, and say why DP is filled in last.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l4'],
    requires: ['t5.parallelism-axes', 't6.all-to-all'],
    since,
  },
  {
    id: 't6.context-parallelism',
    title: 'Context parallelism',
    can: 'You can say why a million-token prompt splits its sequence across GPUs, and what the attention exchange then costs.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l4'],
    requires: ['t5.parallelism-axes', KC.kvCapacity],
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
  // t6.l5's "re-derive the roofline for a B200" is t4.decode-bandwidth on a second chip, so the lesson revisits
  // that KC (t4.ts) rather than open a hardware-specific copy a learner would have to earn twice
  {
    id: 't6.nvlink-domain',
    title: 'The rack-scale NVLink domain',
    can: 'You can say why a 72-GPU NVLink domain keeps wide EP and TP off the network, and what that changes in a layout.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l5'],
    requires: ['t6.parallelism-composition'],
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
    confusable: [KC.speculativeDecoding],
    gen: ['spec'],
    since,
  },
  {
    id: 't6.self-drafting',
    title: 'Self-drafting with MTP and EAGLE',
    can: 'You can say why a model\'s own MTP or EAGLE head drafts more cheaply and accurately than a separate draft model.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l6'],
    requires: [KC.speculativeDecoding],
    since,
  },

  /* ---- t6.l7 ---- */
  {
    id: 't6.rollout-bound-rl',
    title: 'Rollout dominates RL',
    can: 'You can say why generation takes most of RL\'s wall-clock, and how a long tail of rollouts leaves the trainer idle.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l7'],
    requires: [KC.continuousBatching],
    gen: ['rollout'],
    since,
  },
  {
    id: 't6.weight-sync',
    title: 'Weight sync between trainer and engine',
    can: 'You can say why rollouts must not silently mix policy versions, and how partial rollout and colocation trade staleness.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l7'],
    requires: ['t6.rollout-bound-rl'],
    gen: ['rollout'],
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
  {
    id: 't6.grammar-masks',
    title: 'Grammar masks over tokens',
    can: 'You can compute which tokens a grammar state allows, and say why one token can cross several grammar states.',
    track: 't6',
    kind: 'procedure',
    lessons: ['t6.l8'],
    requires: [KC.tokenizerBytes],
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
  {
    id: 't6.multi-lora-batching',
    title: 'Many adapters in one base batch',
    can: 'You can say how one batch shares the base matmul while SGMV adds each request\'s delta, and why adapters page beside KV.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l9'],
    requires: [KC.loraAdapterBytes, KC.blockTables],
    since,
  },

  /* ---- t6.l10 (the T6 spiral) ---- */
  {
    id: 't6.isolation-boundaries',
    title: 'Isolation boundaries for tool code',
    can: 'You can pick a process, container or microVM boundary for model-generated code, and say what each one stops.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l10'],
    requires: ['t3.wasm-sandbox', 't2.process-thread'],
    since,
  },
  {
    id: 't6.cache-timing-oracle',
    title: 'Prefix caches as a timing oracle',
    can: 'You can say how a prefix-cache hit leaks another tenant\'s prompt through latency, and how a cache namespace closes it.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l10'],
    requires: ['t5.prefix-cache-keys'],
    gen: ['prefill'],
    since,
  },
  {
    id: 't6.tool-authorization',
    title: 'Authorizing tool calls',
    can: 'You can say why a schema-valid tool call is not authorization, and where policy checks and scoped credentials belong.',
    track: 't6',
    kind: 'concept',
    lessons: ['t6.l10'],
    requires: ['t6.isolation-boundaries'],
    since,
  },
]
