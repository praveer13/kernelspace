/**
 * KvCacheSim's zoo machine outcome tasks (W6, docs/specs/wave-2.md §11.4): predict → run → explain on the
 * Attention Zoo. The learner picks the model (and context) a task's `setup` names and presses Run; the machine
 * reads the pure model in src/lib/sims/models/zoo.ts, which reads src/lib/kv-zoo.ts (presets from the `zoo.*`
 * claims), and reports the task's `observe` key. Every number in the text below comes from those models, never
 * from a literal (W4).
 */

import { KC } from '@/data/kc/ids'
import { layerBytes, zooBytes, zooPresetById } from '@/lib/kv-zoo'
import type { DsaLayer, FullLayer, LinearLayer, MlaLayer, SwaLayer, ZooModel } from '@/lib/kv-zoo'
import {
  BASELINE_ID,
  READINGS,
  SETUPS,
  ZOO_CTX_STEPS,
  ctxOfSetup,
  fmtBytes,
  fmtCtx,
  fmtInt,
  groupRows,
  modelOfSetup,
  readSetup,
} from '@/lib/sims/models/zoo'
import type { SimTaskDef } from '@/lib/sims/types'

const need = (id: string): ZooModel => {
  const m = zooPresetById(id)
  if (m === undefined) throw new Error(`unknown zoo preset ${id}`)
  return m
}
const unitOf = (key: string): string => READINGS.find((r) => r.key === key)?.unit ?? ''
const answer = (key: string): number | string => {
  const r = readSetup(key)
  if (r === null) throw new Error(`no reading for ${key}`)
  return r.value
}
const round = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits

const llama = need(BASELINE_ID)
const v3 = modelOfSetup(SETUPS['zoo.mla-ratio'])
const oss = modelOfSetup(SETUPS['zoo.swa-flat'])
const v32 = modelOfSetup(SETUPS['zoo.dsa-reads'])
const kimi = modelOfSetup(SETUPS['zoo.hybrid-share'])
const qwen = modelOfSetup(SETUPS['zoo.gdn-prefix'])

const llamaLayer = llama.groups[0].layer as FullLayer
const v3Layer = v3.groups[0].layer as MlaLayer
const swaGroup = oss.groups.find((g) => g.layer.kind === 'swa')!
const swaLayer = swaGroup.layer as SwaLayer
const dsaGroup = v32.groups[0]
const dsaLayer = dsaGroup.layer as DsaLayer
const kdaGroup = kimi.groups.find((g) => g.layer.kind === 'linear')!
const kdaLayer = kdaGroup.layer as LinearLayer
const mlaGroup = kimi.groups.find((g) => g.layer.kind === 'mla')!
const gdnGroup = qwen.groups.find((g) => g.layer.kind === 'linear')!

const llamaBpt = zooBytes(llama, 1).stored
const v3Bpt = zooBytes(v3, 1).stored

const ctxHeadline = ctxOfSetup(SETUPS['zoo.dsa-reads'])
const ossAt = zooBytes(oss, ZOO_CTX_STEPS[ZOO_CTX_STEPS.length - 1])
const ossWindowShare = round((ossAt.groups[oss.groups.indexOf(swaGroup)].stored / ossAt.stored) * 100, 2)
const ossWindowBytes = swaGroup.count * layerBytes(swaLayer, ctxOfSetup(SETUPS['zoo.swa-flat'])).stored

const v32Z = zooBytes(v32, ctxHeadline)
const v32Main = dsaGroup.count * layerBytes(dsaLayer.base, Math.min(ctxHeadline, dsaLayer.topK)).stored
const v32Index = v32Z.read - v32Main

const kdaState = layerBytes(kdaLayer, ZOO_CTX_STEPS[0]).stored
const kimiCtx = ctxOfSetup(SETUPS['zoo.hybrid-share'])
const kimiRows = groupRows(kimi, kimiCtx)
const kimiMla = kimiRows[kimi.groups.indexOf(mlaGroup)]
const kimiKda = kimiRows[kimi.groups.indexOf(kdaGroup)]
const mlaGrowth = ZOO_CTX_STEPS[ZOO_CTX_STEPS.length - 1] / ZOO_CTX_STEPS[0]

export const ZOO_TASKS: SimTaskDef[] = [
  {
    id: 'zoo.mla-ratio',
    simId: 'sim-kv',
    machine: 'zoo',
    kind: 'outcome',
    title: `${llama.name} ÷ ${v3.name} KV bytes per token`,
    setup: `Pick ${v3.name} in the zoo and press Run. The readout compares it with ${llama.name}.`,
    kcs: [KC.attentionVariants],
    predict: {
      kind: 'numeric',
      prompt: `${llama.name} has ${llama.groups[0].count} layers with ${llamaLayer.kvHeads} KV heads of ${llamaLayer.headDim} dimensions. ${v3.name} has ${v3.groups[0].count} layers that each cache one latent of ${v3Layer.latentDim} dimensions plus ${v3Layer.ropeDim} for the rotary key. At BF16, how many times more KV bytes per token does ${llama.name} store?`,
      unit: unitOf('zoo.mla-ratio'),
      // log: the grader accepts a factor of 2 either way; the registry still wants a tolerance on file
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'zoo.mla-ratio',
    explain: {
      prompt: 'What does the latent replace, and does the ratio depend on the context?',
      model: `${llama.name} stores K and V for every KV head: 2 × ${llamaLayer.kvHeads} × ${llamaLayer.headDim} × 2 B per layer, ${fmtInt(llamaBpt)} B per token over ${llama.groups[0].count} layers. ${v3.name} stores one latent of ${v3Layer.latentDim + v3Layer.ropeDim} elements shared by all heads, ${fmtInt(v3Bpt)} B per token over ${v3.groups[0].count} layers. The ratio is ${answer('zoo.mla-ratio')}×, and it is the same at 1k and at 1M because both caches grow linearly with the context.`,
      ideas: [
        'Grouped-query attention stores K and V for each KV head; MLA stores one shared latent per token instead',
        'The saving is in the bytes per token (and a few fewer layers), not in a shorter context',
        'Both caches grow linearly with context, so the ratio stays the same at every length',
      ],
    },
    note: `MLA does not shrink the context, it shrinks what each token costs. The curve keeps its shape and sits ${answer('zoo.mla-ratio')}× lower than the baseline's.`,
    phone: { canonical: 'zoo.mla-ratio' },
    lessons: ['t5.l4'],
  },
  {
    id: 'zoo.swa-flat',
    simId: 'sim-kv',
    machine: 'zoo',
    kind: 'outcome',
    title: `Where ${oss.name}'s window layers stop growing`,
    setup: `Pick ${oss.name} in the zoo and press Run. The layer table says how each group grows.`,
    kcs: [KC.attentionVariants],
    predict: {
      kind: 'numeric',
      prompt: `${oss.name} alternates ${swaGroup.count} sliding-window layers with ${oss.groups.find((g) => g.layer.kind === 'full')?.count} full-attention layers. At what context, in tokens, do the sliding-window layers stop storing more bytes?`,
      unit: unitOf('zoo.swa-flat'),
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'zoo.swa-flat',
    explain: {
      prompt: 'Why does a window layer stop growing, and what sets the point where it does?',
      model: `A sliding-window layer attends only to the last ${fmtInt(swaLayer.window)} tokens (the sinks are learned logits, not stored tokens), so it keeps ${fmtInt(swaLayer.window + swaLayer.sinks)} tokens of K and V and drops the rest. Past that point its ${swaGroup.count} layers hold ${fmtBytes(ossWindowBytes)} however long the context gets. The full layers keep growing, so at 1M tokens the window layers are ${ossWindowShare}% of the cache.`,
      ideas: [
        'A window layer keeps only the last W tokens, so its cache stops growing once the context passes W',
        'The window is a number in the model config, far smaller than the contexts we serve',
        'Only the full-attention layers keep growing, so at long context they decide the capacity',
      ],
    },
    note: `The window layers are the flat part of the curve. They bound what those layers cost, not what the model can attend to: the full layers still see everything.`,
    phone: { canonical: 'zoo.swa-flat' },
    lessons: ['t5.l4'],
  },
  {
    id: 'zoo.dsa-reads',
    simId: 'sim-kv',
    machine: 'zoo',
    kind: 'outcome',
    title: `What one ${v32.name} step reads at ${fmtCtx(ctxHeadline)}`,
    setup: `Pick ${v32.name} with context ${fmtCtx(ctxHeadline)} and press Run. Compare the stored and read cards.`,
    kcs: [KC.kvReadsVsCapacity],
    predict: {
      kind: 'choice',
      prompt: `${v32.name} stores one latent per token per layer, as ${v3.name} does, plus a small index key. At ${fmtCtx(ctxHeadline)} tokens, how do the bytes one decode step reads compare with the bytes the cache stores?`,
      options: [
        { id: 'same', text: 'About the same: a step reads everything it stores' },
        { id: 'reads-less', text: 'Reads are several times smaller than what is stored' },
        { id: 'stored-less', text: 'What is stored is several times smaller than what a step reads' },
      ],
    },
    observe: 'zoo.dsa-reads',
    explain: {
      prompt: 'Which bytes does the cache hold that a step does not read, and which does it still read in full?',
      model: `${v32.name} keeps every latent, so the cache holds ${fmtBytes(v32Z.stored)} at ${fmtCtx(ctxHeadline)}. A step reads only the top ${fmtInt(dsaLayer.topK)} tokens' latents (${fmtBytes(v32Main)}) but must score one index key per cached token (${fmtBytes(v32Index)}): ${fmtBytes(v32Z.read)} in all, ${round(v32Z.stored / v32Z.read, 1)}× less than is stored. The indexer's keys are most of what is read, so reads still grow with context, only more slowly than capacity.`,
      ideas: [
        'Capacity: every token keeps its latent, so the stored bytes still grow with the context',
        'Bandwidth: a step reads only the top-k tokens the indexer picks, not the whole cache',
        'The indexer looks at one key per cached token, so reads still grow with context, just more slowly',
      ],
    },
    note: `Capacity and bandwidth are different curves here. Sparse attention separates them: the cache is as big as ever, but each step touches a fraction of it.`,
    phone: { canonical: 'zoo.dsa-reads' },
    lessons: ['t5.l4'],
  },
  {
    id: 'zoo.linear-state',
    simId: 'sim-kv',
    machine: 'zoo',
    kind: 'outcome',
    title: `A linear layer's state at ${fmtCtx(ZOO_CTX_STEPS[ZOO_CTX_STEPS.length - 1])} against ${fmtCtx(ZOO_CTX_STEPS[0])}`,
    setup: `Pick ${kimi.name} in the zoo and press Run. The layer table lists its linear group.`,
    kcs: [KC.attentionVariants],
    predict: {
      kind: 'numeric',
      prompt: `${kimi.name} has ${kdaGroup.count} linear (${kdaGroup.label.replace('linear (', '').replace(')', '')}) layers beside ${mlaGroup.count} MLA layers. How many times larger is one linear layer's state at ${fmtCtx(ZOO_CTX_STEPS[ZOO_CTX_STEPS.length - 1])} tokens than at ${fmtCtx(ZOO_CTX_STEPS[0])}?`,
      unit: unitOf('zoo.linear-state'),
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'zoo.linear-state',
    explain: {
      prompt: 'What is a linear layer\'s state, and why does its size not depend on the context?',
      model: `A ${kdaGroup.label} layer folds every token into one ${kdaLayer.heads} × ${kdaLayer.keyDim} × ${kdaLayer.valueDim} state, ${fmtBytes(kdaState)} per layer, whatever it has read. At 1k and at 1M tokens that is the same ${fmtBytes(kdaState)}: ${answer('zoo.linear-state')}×. The MLA layers beside it grow ${fmtInt(mlaGrowth)}× over the same range.`,
      ideas: [
        'A recurrent state folds every token into a fixed-size matrix, so its size is independent of context',
        'The linear layers cost per request, not per token: that part of the curve is flat',
        'The price is that the state cannot be addressed by position: it is a checkpoint, not a log',
      ],
    },
    note: `Constant state is why linear layers are cheap at long context, and why a hybrid keeps a few full layers: the state is a summary, not a record you can look things up in.`,
    phone: { canonical: 'zoo.linear-state' },
    lessons: ['t5.l4'],
  },
  {
    id: 'zoo.hybrid-share',
    simId: 'sim-kv',
    machine: 'zoo',
    kind: 'outcome',
    title: `${kimi.name}'s KV held by its MLA layers at ${fmtCtx(kimiCtx)}`,
    setup: `Pick ${kimi.name} with context ${fmtCtx(kimiCtx)} and press Run. The layer table shows each group's share.`,
    kcs: [KC.attentionVariants],
    predict: {
      kind: 'numeric',
      prompt: `${kimi.name} has ${kdaGroup.count} linear layers and ${mlaGroup.count} MLA layers. At ${fmtCtx(kimiCtx)} tokens, what percent of its KV bytes do the MLA layers hold?`,
      unit: unitOf('zoo.hybrid-share'),
      tolerance: { rel: 1 },
      log: true,
    },
    observe: 'zoo.hybrid-share',
    explain: {
      prompt: `Why is the share not the layer count, ${mlaGroup.count} of ${kdaGroup.count + mlaGroup.count}?`,
      model: `At ${fmtCtx(kimiCtx)} each of the ${kdaGroup.count} linear layers holds a constant ${fmtBytes(kdaState)} (${fmtBytes(kimiKda.stored)} in all), while each of the ${mlaGroup.count} MLA layers holds ${fmtBytes(kimiMla.stored / mlaGroup.count)} and grows with every token (${fmtBytes(kimiMla.stored)} in all). The MLA layers hold ${answer('zoo.hybrid-share')}% of the bytes.`,
      ideas: [
        'Constant-state layers cost the same at any context, growing layers cost in proportion to it',
        'At long context the few growing layers hold nearly all the bytes',
        'Weigh each layer by what it stores at this context, not by how many there are',
      ],
    },
    note: `In a hybrid the growing layers decide capacity at long context. Moving more layers to linear attention cuts the cache; the few that stay full set what is left.`,
    phone: { canonical: 'zoo.hybrid-share' },
    lessons: ['t5.l4'],
  },
  {
    id: 'zoo.gdn-prefix',
    simId: 'sim-kv',
    machine: 'zoo',
    kind: 'outcome',
    title: `Reusing half a cached prefix in a ${gdnGroup.label.replace('linear (', '').replace(')', '')} layer`,
    setup: `Pick ${qwen.name} in the zoo and press Run. The layer table says what each group can reuse.`,
    kcs: [KC.kvReadsVsCapacity],
    predict: {
      kind: 'choice',
      prompt: `${qwen.name} mixes ${gdnGroup.label} layers with full-attention layers. A request shares only the first half of a cached sequence. Can a ${gdnGroup.label} layer serve that shared half from its cache without recomputing it?`,
      options: [
        { id: 'yes', text: 'Yes: it reuses the cached state for the shared half' },
        { id: 'no', text: 'No: it has to recompute the shared half' },
      ],
    },
    observe: 'zoo.gdn-prefix',
    explain: {
      prompt: 'What does the cache of a linear layer hold, and where in the sequence does it exist?',
      model: `A ${gdnGroup.label} layer's state summarizes every token up to the last one, so it exists only at the end of the cached sequence. There is no state for the first half to hand back: serving the shared half means recomputing it through those layers, or having saved a checkpoint at that point. The full layers can reuse the half, because a log keeps one record per token.`,
      ideas: [
        'A recurrent state is a checkpoint after the last token: the middle of the sequence has no state',
        'A KV log is addressable by position, so any prefix of it can be reused',
        'A prefix cache on a hybrid must recompute the linear layers, or store checkpoints at chosen points',
      ],
    },
    note: `KV is an append-only log with random reads. A recurrent state is a checkpoint you can resume from, but not from the middle.`,
    phone: { canonical: 'zoo.gdn-prefix' },
    lessons: ['t5.l4'],
  },
]
