/**
 * T5 (LLM serving) KCs: the kv family, KvCacheSim tasks and Boot (docs/specs/wave-1.md §4.9), Wave 2's
 * contract ids (wave-2.md §4.2) for labs 02-03, the attention zoo, the scheduler play and the spec family,
 * and the rest of T5 (task 2a-11), 2-3 per lesson, in lesson order.
 *
 * The track's spine is the serving-engine notional machine (notional.ts): tokenizer → scheduler → block
 * manager → model step → detokenizer, one iteration at a time.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T5_KCS: readonly Kc[] = [
  /* ---- t5.l1 ---- */
  {
    id: 't5.forward-pass-costs',
    title: 'FLOPs and bytes per token',
    can: 'You can estimate a forward pass at about 2 × params FLOPs and 2 × params bytes per token, and say where they go.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l1'],
    requires: [KC.boundClassification],
    since,
  },
  {
    id: 't5.why-kv-cache',
    title: 'Why the KV cache exists',
    can: 'You can say why decode caches every past token\'s keys and values, and what recomputing them each step would cost.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l1'],
    requires: ['t5.forward-pass-costs'],
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
  {
    id: 't5.token-economics',
    title: 'Tokens are the unit of cost',
    can: 'You can estimate cost and latency in tokens rather than words, and say why one changed leading space misses the cache.',
    track: 't5',
    kind: 'procedure',
    lessons: ['t5.l2'],
    requires: [KC.tokenizerBytes],
    since,
  },

  /* ---- t5.l3 ---- */
  {
    id: 't5.prefill-vs-decode',
    title: 'Prefill versus decode',
    can: 'You can say why prefill is compute-bound and sets TTFT while decode is bandwidth-bound and sets ITL.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l3'],
    requires: ['t5.forward-pass-costs', KC.decodeBandwidth],
    since,
  },
  {
    id: 't5.latency-metrics',
    title: 'TTFT, ITL and the batching seesaw',
    can: 'You can define TTFT, ITL and throughput, and say why a bigger batch raises throughput and ITL together.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l3'],
    requires: ['t5.prefill-vs-decode'],
    since,
  },

  /* ---- t5.l4: KV math and the attention zoo ---- */
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
    id: KC.attentionVariants,
    title: 'MHA, MQA, GQA and MLA',
    can: 'You can compare MHA, MQA, GQA and MLA by the values each caches per token per layer.',
    track: 't5',
    kind: 'concept',
    // t6.l1 returns to MLA as half of the DeepSeek design
    lessons: ['t5.l4', 't6.l1'],
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
    // the same held-versus-read split as an MoE's total and active parameters (memory.total-for-active)
    confusable: [KC.moeActiveParams],
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
    id: 't5.prefix-cache-keys',
    title: 'What a prefix-cache key must hold',
    can: 'You can say what a cached block\'s key must cover (earlier tokens, model, adapter, tenant salt) and what a hit skips.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l6'],
    requires: [KC.blockRefcounts, 't5.token-economics'],
    since,
  },
  {
    id: 't5.radix-eviction',
    title: 'Radix trees and leaf eviction',
    can: 'You can trace a radix-tree prefix cache: longest-prefix lookup, and LRU eviction of unreferenced leaves only.',
    track: 't5',
    kind: 'procedure',
    // t5.l10 compares SGLang's RadixAttention with vLLM's hashed blocks
    lessons: ['t5.l6', 't5.l10'],
    requires: ['t5.prefix-cache-keys', 't2.eviction-policies'],
    since,
  },
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
    id: KC.batchingThroughput,
    title: 'Why batching raises throughput',
    can: 'You can explain why batching decode multiplies tokens per second until compute or KV memory runs out.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l7', 't4.l3', 't0.l1'],
    requires: [KC.decodeBandwidth, KC.kvCapacity, KC.admissionScheduling],
    // raw tokens per second is not goodput: the "10,000 tok/s with no latency numbers" slip (t7.l1)
    confusable: [KC.goodput],
    since,
  },
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
    // two cures for one convoy: chunk the prefill in place, or move it to another fleet (t5.l9)
    confusable: ['t5.pd-disaggregation'],
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
    // tokens per target step is not the speedup until the draft's cost is paid (diagnosis spec.ignored-cost)
    confusable: [KC.specAcceptance],
    gen: ['spec'],
    since,
  },

  /* ---- t5.l9 ---- */
  {
    id: 't5.interconnect-ladder',
    title: 'The interconnect ladder',
    can: 'You can rank HBM, NVLink, PCIe and RDMA by bandwidth, and say which traffic each hop can carry.',
    track: 't5',
    kind: 'fact',
    lessons: ['t5.l9'],
    requires: ['t4.gpu-memory-ladder'],
    since,
  },
  {
    id: 't5.parallelism-axes',
    title: 'Tensor, pipeline and data parallelism',
    can: 'You can say what tensor, pipeline and data parallelism each split, and why tensor parallelism stays on NVLink.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l9'],
    requires: ['t5.forward-pass-costs', 't5.interconnect-ladder'],
    since,
  },
  {
    id: 't5.pd-disaggregation',
    title: 'Prefill-decode disaggregation',
    can: 'You can say when running prefill and decode on separate GPUs pays, and what shipping the KV cache between them costs.',
    track: 't5',
    kind: 'concept',
    // t5.l10 reads Dynamo as the data plane that disaggregation needs
    lessons: ['t5.l9', 't5.l10'],
    requires: ['t5.prefill-vs-decode', 't5.interconnect-ladder'],
    confusable: [KC.prefillDecodeInterference],
    since,
  },

  /* ---- t5.l10 (the T5 spiral) ---- */
  {
    id: 't5.engine-design-centers',
    title: 'Engines and their design centers',
    can: 'You can match vLLM, SGLang, TensorRT-LLM and Dynamo to what each optimizes, and pick one for a deployment.',
    track: 't5',
    kind: 'concept',
    lessons: ['t5.l10'],
    requires: [KC.continuousBatching, KC.prefixRouting, 't5.pd-disaggregation'],
    since,
  },
]
