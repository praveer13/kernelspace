/**
 * T5 (LLM serving) KCs that Wave 1 needs: the kv family, KvCacheSim tasks and Boot
 * (docs/specs/wave-1.md §4.9), plus Wave 2's contract ids (§4.2) for labs 02-03, the attention zoo, the
 * scheduler play and the spec family. The rest of T5 joins the graph with its tickets in 2a-11.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T5_KCS: readonly Kc[] = [
  {
    id: KC.kvBytesPerToken,
    title: 'KV bytes per token',
    can: 'You can compute KV bytes per token as 2 × layers × KV heads × head dim × bytes per value.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l4'],
    requires: [],
    // the GQA slip: pricing query heads instead of KV heads (diagnosis kv.query-heads, spec §5.5)
    confusable: [KC.gqaKvHeads],
    threshold: 'core',
    gen: ['kv'],
    claims: ['model.llama3-8b.kv-bytes-per-token'],
    since,
  },
  {
    id: KC.kvCapacity,
    title: 'KV capacity',
    can: 'You can estimate how many tokens or chats fit in the HBM left over after the weights.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l4', 't4.l2'],
    requires: [KC.kvBytesPerToken],
    contains: [KC.kvBytesPerToken],
    // `sig` (§4.2): signature items give a telemetry table and ask which pool ran out
    gen: ['kv', 'sig'],
    claims: ['hw.h100-sxm.hbm-capacity'],
    since,
  },
  {
    id: KC.gqaKvHeads,
    title: 'GQA and KV heads',
    can: 'You can size a KV cache by KV heads, not query heads, and say how much GQA shrinks it.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l4', 't5.l1'],
    requires: [KC.kvBytesPerToken],
    confusable: [KC.kvBytesPerToken],
    gen: ['kv'],
    claims: ['model.llama3-8b.kv-heads', 'model.llama3-8b.attn-heads'],
    since,
  },
  {
    id: KC.batchingThroughput,
    title: 'Why batching raises throughput',
    can: 'You can explain why batching decode multiplies tokens per second until compute or KV memory runs out.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l7', 't4.l3', 't0.l1'],
    requires: [KC.decodeBandwidth, KC.kvCapacity, KC.admissionScheduling],
    since,
  },

  /* ---- t5.l2: lab 03 (bpe-tokenizer) ---- */
  {
    id: KC.tokenizerBytes,
    title: 'Tokens are bytes first',
    can: 'You can say why byte-level BPE needs only 256 base ids, accepts any UTF-8 and decodes back exactly.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l2'],
    requires: [KC.enumsOptionResult],
    labs: ['bpe-tokenizer'],
    since,
  },
  {
    id: KC.bpeMerges,
    title: 'BPE merge order',
    can: 'You can apply a ranked merge table, lowest rank first and left to right without overlap, and predict the ids.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l2'],
    requires: [KC.tokenizerBytes, 'r.closures-collections'],
    labs: ['bpe-tokenizer'],
    since,
  },

  /* ---- t5.l4: the attention zoo ---- */
  {
    id: KC.attentionVariants,
    title: 'MHA, MQA, GQA and MLA',
    can: 'You can compare MHA, MQA, GQA and MLA by the values each caches per token per layer.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l4'],
    requires: [KC.kvBytesPerToken],
    since,
  },
  {
    id: KC.kvReadsVsCapacity,
    title: 'KV reads versus KV capacity',
    can: 'You can separate the KV bytes a variant stores (capacity) from the bytes each decode step reads (bandwidth).',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l4'],
    requires: [KC.attentionVariants, KC.decodeBandwidth],
    since,
  },

  /* ---- t5.l5: lab 02 (kv-block-manager) ---- */
  {
    id: KC.blockTables,
    title: 'Block tables',
    can: 'You can translate a token position to a physical block and offset through a block table, and size the pool.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l5'],
    requires: [KC.addressTranslation, KC.enumsOptionResult, 'r.iterators-ownership'],
    labs: ['kv-block-manager'],
    since,
  },
  {
    id: KC.blockRefcounts,
    title: 'Block refcounts',
    can: 'You can track refcounts across fork and free, and say a shared block returns only when its last owner drops it.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l5'],
    requires: [KC.blockTables, 'r.smart-pointers'],
    labs: ['kv-block-manager'],
    since,
  },
  {
    id: KC.kvCopyOnWrite,
    title: 'Copy-on-write on the shared tail',
    can: 'You can say when an append copies a block (only when the tail is shared) and who keeps the original.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l5'],
    requires: [KC.blockRefcounts, 't2.copy-on-write'],
    labs: ['kv-block-manager'],
    since,
  },

  /* ---- t5.l6 ---- */
  {
    id: KC.prefixRouting,
    title: 'Prefix-aware routing',
    can: 'You can predict a prefix-cache hit from block-aligned shared prefixes, and route to the replica holding the longest.',
    track: 't5',
    kind: 'skill',
    lessons: ['t5.l6'],
    requires: [KC.blockRefcounts],
    since,
  },

  /* ---- t5.l7: the scheduler play ---- */
  {
    id: KC.continuousBatching,
    title: 'Continuous batching',
    can: 'You can say how iteration-level scheduling admits and retires requests every step, and why static batches idle.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l7'],
    requires: [KC.batchingThroughput, KC.admissionScheduling],
    since,
  },
  {
    id: KC.admissionHeadroom,
    title: 'Admission headroom',
    can: 'You can decide whether to admit a request by checking KV blocks for its prompt plus headroom for its decode.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l7'],
    requires: [KC.continuousBatching, KC.kvCapacity],
    since,
  },
  {
    id: KC.schedOrder,
    title: 'Scheduling order and starvation',
    can: 'You can predict how FIFO and shortest-first order waits, and why shortest-first needs a starvation guard.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l7'],
    requires: [KC.continuousBatching],
    since,
  },

  /* ---- t5.l8 ---- */
  {
    id: KC.prefillDecodeInterference,
    title: 'Prefill-decode interference',
    can: 'You can say why a long prefill stalls every other request\'s decode step, and how chunking bounds the stall.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l8'],
    requires: [KC.continuousBatching],
    gen: ['sig'],
    since,
  },
  {
    id: KC.speculativeDecoding,
    title: 'Speculative decoding',
    can: 'You can compute expected tokens per target step from draft length and acceptance, and say why output is unchanged.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l8'],
    requires: [KC.decodeBandwidth],
    gen: ['spec'],
    since,
  },
]
