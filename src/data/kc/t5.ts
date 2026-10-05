/**
 * T5 (LLM serving) KCs that Wave 1 needs: the kv family, KvCacheSim tasks and Boot
 * (docs/specs/wave-1.md §4.9). The rest of T5 joins the graph with its tickets in Wave 2.
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
    gen: ['kv'],
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
]
