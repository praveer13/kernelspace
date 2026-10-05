/**
 * KvCacheSim's outcome tasks (P2, docs/specs/wave-1.md §10.2): predict → run → explain, replacing `kv-oom`,
 * `kv-rescue` and `kv-batch`. The learner sets the sim up as `setup` says and presses Run; the sim reads the
 * pure model in src/lib/sims/models/kv.ts and reports the task's `observe` key. Every real-world number in the
 * text below comes from that model (and so from a claim, W4), never from a literal.
 */

import { KC } from '@/data/kc/ids'
import {
  PRESETS,
  READINGS,
  SETUPS,
  STATIC_RESERVE_FACTOR,
  fmtCtx,
  gpuById,
  kvModel,
  presetById,
  stateFromSetup,
} from '@/lib/sims/models/kv'
import type { KvState } from '@/lib/sims/models/kv'
import type { SimTaskDef } from '@/lib/sims/types'

const n = (x: number): string => x.toLocaleString('en-US', { maximumFractionDigits: 1 })
const need = (id: string): (typeof PRESETS)[number] => {
  const p = presetById(id as (typeof PRESETS)[number]['id'])
  if (p === undefined) throw new Error(`unknown KV preset ${id}`)
  return p
}
const unitOf = (key: string): string => READINGS.find((r) => r.key === key)?.unit ?? ''

/** The state a task's setup describes and what the model reads from it. */
function worked(key: string): { s: KvState; r: ReturnType<typeof kvModel>; gpu: ReturnType<typeof gpuById> } {
  const s = stateFromSetup(SETUPS[key])
  return { s, r: kvModel(s), gpu: gpuById(s.gpuId) }
}

const p70 = need('llama3-70b')
const p8 = need('llama3-8b')

const bpt = worked('kv.bytes-per-token')
const oom = worked('kv.oom-context')
const rescue = worked('kv.fp8-rescue')
const gqa = worked('kv.gqa')
const batch = worked('kv.max-batch')

const kvHeads8 = p8.kvHeads
const mhaHeads = gqa.s.kvHeads
const fp16Rescue = kvModel({ ...rescue.s, kvDtype: 'fp16' }).maxBatch
const rescueFree = rescue.r.totalHbmGb - rescue.r.weights - rescue.r.overhead
const oomFree = oom.r.totalHbmGb - oom.r.weights - oom.r.overhead
const bytes8 = kvModel({ ...stateFromSetup({ presetId: 'llama3-8b' }), kvDtype: 'fp16' }).kvPerToken
const gqaReal = kvModel({ ...gqa.s, kvHeads: kvHeads8 }).oneSequenceGb

export const KV_TASKS: SimTaskDef[] = [
  {
    id: 'kv.bytes-per-token',
    simId: 'sim-kv',
    machine: 'calc',
    kind: 'outcome',
    title: `KV bytes per token for ${p70.name}`,
    setup: `Pick ${p70.name} (${p70.layers} layers, ${p70.kvHeads} KV heads, head dim ${p70.headDim}), keep KV precision at FP16, and press Run.`,
    kcs: [KC.kvBytesPerToken],
    predict: {
      kind: 'numeric',
      prompt: `${p70.name} has ${p70.layers} layers, ${p70.kvHeads} KV heads and head dim ${p70.headDim}. How many KiB of KV cache does one token cost at FP16?`,
      unit: unitOf('kv.bytes-per-token'),
      tolerance: { rel: 0.05 },
    },
    observe: 'kv.bytes-per-token',
    explain: {
      prompt: 'Where does that number come from, and which inputs does it depend on?',
      model: `Every token stores one K and one V vector in every layer: 2 × ${p70.layers} × ${p70.kvHeads} × ${p70.headDim} × 2 B = ${n(bpt.r.kvPerToken)} B, ${n(bpt.r.kvPerToken / 1024)} KiB. Only the model's shape and the KV precision set it; context and batch just multiply it. That is ${n(bpt.r.kvPerToken / bytes8)}× the 8B's ${n(bytes8 / 1024)} KiB because the layer count differs while the KV heads do not.`,
      ideas: [
        'K and V are both stored (the factor 2), for every layer and every KV head',
        'The cost per token depends on layers, KV heads, head dim and precision, not on context or batch',
        'The 70B costs more than the 8B because it has more layers, not more KV heads (GQA)',
      ],
    },
    note: `The per-token cost is a property of the architecture. Context length and batch size multiply it, which is why the same ${n(bpt.r.kvPerToken / 1024)} KiB turns into gigabytes so quickly.`,
    phone: { canonical: 'kv.bytes-per-token' },
    lessons: ['t5.l4'],
  },
  {
    id: 'kv.oom-context',
    simId: 'sim-kv',
    machine: 'calc',
    kind: 'outcome',
    title: `How far one request can stretch on one ${oom.gpu.name}`,
    setup: `Pick ${p70.name} with FP8 weights and FP16 KV on one ${oom.gpu.name}, batch 1, PagedAttention on. Raise the context until the OOM stamp appears, then press Run.`,
    kcs: [KC.kvCapacity],
    legacyId: 'kv-oom',
    predict: {
      kind: 'numeric',
      prompt: `${p70.name} with FP8 weights on one ${oom.gpu.name} (${oom.gpu.gb} GB HBM), batch 1, FP16 KV. What is the longest context, in tokens, before it runs out of memory?`,
      unit: unitOf('kv.oom-context'),
      // log: the grader accepts a factor of 2 either way; the registry still wants a tolerance on file
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'kv.oom-context',
    explain: {
      prompt: 'What is left for the KV cache once the weights are in, and how does that become a context length?',
      model: `The weights are paid first: ${n(oom.r.weights)} GB of FP8 weights plus ${n(oom.r.overhead)} GB of scratch leave ${n(oomFree)} GB of the ${oom.gpu.gb} GB. At ${n(oom.r.kvPerToken / 1024)} KiB per token (FP16 KV, plus a little paging waste) that budget holds about ${n(oom.r.maxCtx)} tokens, ${fmtCtx(Math.round(oom.r.maxCtx / 1000) * 1000)} or so, for a single request.`,
      ideas: [
        'The KV budget is what HBM has left after the weights and the runtime scratch',
        'Context length is that budget divided by the KV bytes per token',
        'FP8 weights shrink the weights, not the KV, so a long context is still expensive',
      ],
    },
    note: `A model that fits is not a model that serves. Here the weights leave ${n(oomFree)} GB, so the cache, not the weights, decides how long a request can be. Quantizing the KV (the next task) or adding GPUs moves that line.`,
    phone: { canonical: 'kv.oom-context' },
    lessons: ['t5.l4'],
  },
  {
    id: 'kv.fp8-rescue',
    simId: 'sim-kv',
    machine: 'calc',
    kind: 'outcome',
    title: `Rescue ${p70.name} at ${fmtCtx(rescue.s.ctx)}: FP8 on ${rescue.s.gpuCount} × ${rescue.gpu.name}`,
    setup: `Pick ${p70.name} with FP8 weights and FP8 KV on ${rescue.s.gpuCount} × ${rescue.gpu.name}, context ${fmtCtx(rescue.s.ctx)}, PagedAttention on, and press Run.`,
    kcs: [KC.kvBytesPerToken],
    legacyId: 'kv-rescue',
    predict: {
      kind: 'numeric',
      prompt: `${rescue.s.gpuCount} × ${rescue.gpu.name} (${rescue.r.totalHbmGb} GB in all), ${p70.name} with FP8 weights and FP8 KV. How many ${fmtCtx(rescue.s.ctx)}-token requests fit at once?`,
      unit: unitOf('kv.fp8-rescue'),
      tolerance: { rel: 0.15 },
    },
    observe: 'kv.fp8-rescue',
    explain: {
      prompt: 'How did FP8 change the count, and what did it leave alone?',
      model: `${n(rescueFree)} GB is left after the FP8 weights and scratch. One ${fmtCtx(rescue.s.ctx)}-token request needs ${n(rescue.r.oneSequenceGb)} GB of FP8 KV (${n(rescue.r.kvPerToken / 1024)} KiB per token), a little more with paging, so ${n(rescue.r.maxBatch)} fit. With FP16 KV the same hardware holds ${n(fp16Rescue)}: halving the bytes per element doubles the requests, but the weights are unchanged.`,
      ideas: [
        'The weights come out of HBM first and FP8 KV does not change them',
        'Each request needs context × KV bytes per token, which FP8 halves',
        'Halving the KV bytes doubles how many requests fit, it does not halve the total memory',
      ],
    },
    note: `Quantizing the cache raises capacity in proportion to the bytes it saves per token. Quantizing the weights raises it too, by freeing the HBM that the cache then fills.`,
    phone: { canonical: 'kv.fp8-rescue' },
    lessons: ['t5.l4'],
  },
  {
    id: 'kv.gqa',
    simId: 'sim-kv',
    machine: 'calc',
    kind: 'outcome',
    title: `What a ${fmtCtx(gqa.s.ctx)} request costs without GQA`,
    setup: `Pick custom: ${gqa.s.layers} layers, ${mhaHeads} KV heads (one per query head, plain multi-head attention), head dim ${gqa.s.headDim}, KV at FP16, context ${fmtCtx(gqa.s.ctx)}. Press Run.`,
    kcs: [KC.gqaKvHeads],
    predict: {
      kind: 'numeric',
      prompt: `Suppose ${p8.name} kept ${mhaHeads} KV heads, one per query head, instead of its real ${kvHeads8}. How many GB of KV cache would one ${fmtCtx(gqa.s.ctx)}-token request need at FP16?`,
      unit: unitOf('kv.gqa'),
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'kv.gqa',
    explain: {
      prompt: 'What does grouped-query attention change in the formula, and by how much?',
      model: `With ${mhaHeads} KV heads one token costs 2 × ${gqa.s.layers} × ${mhaHeads} × ${gqa.s.headDim} × 2 B = ${n(gqa.r.kvPerToken / 1024)} KiB, so a ${fmtCtx(gqa.s.ctx)}-token request holds ${n(gqa.r.oneSequenceGb)} GB, more than the model's own weights. The real ${kvHeads8} KV heads cut it to ${n(gqaReal)} GB, ${n(mhaHeads / kvHeads8)}× less, because several query heads share each K and V.`,
      ideas: [
        'The KV heads term multiplies the cost per token directly',
        'GQA keeps the query heads but shares each K and V among a group of them',
        `The saving is the ratio of query heads to KV heads, here ${n(mhaHeads / kvHeads8)}×`,
      ],
    },
    note: `One long request can cost more cache than the model has weights. Sharing K and V across query heads is why every recent open model ships with GQA.`,
    phone: { canonical: 'kv.gqa' },
    lessons: ['t5.l4'],
  },
  {
    id: 'kv.max-batch',
    simId: 'sim-kv',
    machine: 'calc',
    kind: 'outcome',
    title: `How many ${fmtCtx(batch.s.ctx)} requests fit on ${batch.s.gpuCount} × ${batch.gpu.name}?`,
    setup: `Pick ${p8.name} with FP16 weights and FP16 KV on ${batch.s.gpuCount} × ${batch.gpu.name}, context ${fmtCtx(batch.s.ctx)}, PagedAttention on. Press Run, then compare the capacity and bandwidth walls.`,
    kcs: [KC.kvCapacity],
    legacyId: 'kv-batch',
    predict: {
      kind: 'numeric',
      prompt: `${batch.s.gpuCount} × ${batch.gpu.name} (${batch.r.totalHbmGb} GB in all), ${p8.name} at FP16 with FP16 KV. How many ${fmtCtx(batch.s.ctx)}-token requests fit at once?`,
      unit: unitOf('kv.max-batch'),
      tolerance: { rel: 0.15 },
    },
    observe: 'kv.max-batch',
    explain: {
      prompt: 'Which limit stops you first, and how would you get past it?',
      model: `${n(batch.r.totalHbmGb - batch.r.weights - batch.r.overhead)} GB is free after the weights; one ${fmtCtx(batch.s.ctx)}-token request needs ${n(batch.r.oneSequenceGb)} GB of KV (a little more with paging), so ${n(batch.r.maxBatch)} fit. Reading that much cache every step would allow about ${n(batch.r.bandwidthBatch)} at the latency target, so the ${batch.r.limitingWall} wall comes first. Static reservation would need about ${n(STATIC_RESERVE_FACTOR)}× the cache and fit far fewer.`,
      ideas: [
        'Capacity is free HBM after the weights divided by the KV one request needs',
        'Bandwidth is a separate limit: every step reads all the live KV',
        'Paging lets the cache grow as tokens arrive instead of reserving the maximum context',
      ],
    },
    note: `Capacity and bandwidth are different walls. Size both before choosing a fix: more memory moves the first, faster memory or a smaller cache moves the second.`,
    phone: { canonical: 'kv.max-batch' },
    lessons: ['t5.l4'],
  },
]
