/**
 * RooflineSim's outcome tasks, mirror and phone mode (wave-1.md §10.2–10.5, task C7).
 *
 * The pure model is the contract between three things: what the sim reports while a learner runs a task,
 * what phone mode shows as the canonical outcome, and what the task grades. The tests pin that the first
 * two agree, that nothing is graded outside a task's setup, and that the six tasks walk predict → run →
 * explain into a ledger outcome tagged with their KCs. The sim itself is checked by source (it needs a
 * canvas) and by a server render of its markup; the browser pass is in the task notes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import RooflineSim from '../../src/components/sims/RooflineSim'
import SimMirror from '../../src/components/sims/SimMirror'
import { OutcomeChart } from '../../src/components/sims/PhoneOutcome'
import { PAGED_ATTN, ROOFLINE_TASKS } from '../../src/components/sims/roofline.tasks'
import { ALL_LESSONS } from '../../src/data/lessons'
import {
  SimHostContext,
  announceDelay,
  buildOutcome,
  buildPhoneOutcome,
  completeTask,
  createFinishedStore,
  createObservationBus,
  freshRun,
  gradePrediction,
  reduceRun,
  splitCanonical,
} from '../../src/lib/sims/host'
import type { RunAction, SimHostInternal, TaskRun } from '../../src/lib/sims/host'
import {
  ATTENTION,
  BATCH_STEPS,
  CPU_GPU,
  FLEET_KERNELS,
  L2_BW_GBS,
  MACHINES,
  PCIE_BW_GBS,
  PHONE_MODELS,
  PRESETS,
  TILE_CHOICES,
  SETUP,
  SHARED_BW_GBS,
  accessResult,
  announceAttention,
  announceDecode,
  announceKernel,
  announceMachine,
  announceTile,
  attentionAI,
  attentionBytes,
  batchToRidge,
  boundOf,
  decodeAI,
  dtypeMultiplier,
  gpuMapMs,
  mapSpeedup,
  matmulAI,
  maxRegistersFor,
  mirrorTable,
  observationsFor,
  occupancyModel,
  ridgeAI,
  serialSpeedup,
  tierBandwidth,
  tierName,
  tileOccupancyFactor,
} from '../../src/lib/sims/models/roofline'
import type { Dtype, MirrorInput, RooflineEvent } from '../../src/lib/sims/models/roofline'
import { buildRegistry, resolveTasks } from '../../src/lib/sims/registry'
import type { Observation, SimTaskDef } from '../../src/lib/sims/types'
import { WAIVER, checkCanvasMirrors } from '../../scripts/verify-plays'
import { makeProfile, startTab } from '../ledger/env'
import { MiniElement, MiniEvent, installDom } from '../dom/mini-dom'
import type { DomKit } from '../dom/mini-dom'
import { BASE, FP8_OVER_BF16, ctasPerSm, ridge as tilingRidge, smemBytes } from '../../src/lib/world/tiling'

const ROOT = join(import.meta.dir, '..', '..')
const SIM_SRC = readFileSync(join(ROOT, 'src', 'components', 'sims', 'RooflineSim.tsx'), 'utf8')

const reg = buildRegistry({ '/src/components/sims/roofline.tasks.ts': { ROOFLINE_TASKS } })
const task = (id: string): SimTaskDef => {
  const t = reg.byId(id)
  if (t === undefined) throw new Error(`no task ${id}`)
  return t
}

const CHART_IDS = ['roof.ridge', 'roof.decode-bound', 'roof.batch-to-ridge', 'roof.tile-ai', 'roof.flash-ai', 'roof.fp8-ridge']
/** The twelve that were click-throughs until wave-3.md §13: the CPU/GPU demo, the probes and the B200 worksheet. */
const PROBE_IDS = [
  'roof.cpu-serial',
  'roof.gpu-map',
  'roof.gpu-divergence',
  'roof.occupancy',
  'roof.coalesce',
  'roof.bank',
  'roof.tiers',
  'roof.pcie',
  'roof.fleet-router',
  'roof.fleet-decode',
  'roof.fleet-paged-attn',
  'roof.fleet-prefill',
]
const OUTCOME_IDS = [...CHART_IDS, ...PROBE_IDS]

const H100_BW = MACHINES.h100.bw
const staged = (bankConflict: boolean, bankPadding: boolean): RooflineEvent => ({ type: 'access', preset: 'H100', bw: H100_BW, pattern: 'staged', bankConflict, bankPadding })

/** What the sim reports when a learner does the task's run, and the canonical key phone mode shows. */
const RUN: Record<string, RooflineEvent> = {
  'roof.ridge': { type: 'machine', preset: 'B200', dtype: 'fp16' },
  'roof.decode-bound': { type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 1 },
  'roof.batch-to-ridge': { type: 'batch', preset: 'H100', dtype: 'fp16', batch: 512, decodePlotted: true },
  'roof.tile-ai': { type: 'tile', tile: 128 },
  'roof.flash-ai': { type: 'attention', mode: 'flash' },
  'roof.fp8-ridge': { type: 'machine', preset: 'H100', dtype: 'fp8' },
  'roof.cpu-serial': { type: 'serial' },
  'roof.gpu-map': { type: 'map', pattern: 'coalesced', occupancyPct: 25 },
  'roof.gpu-divergence': { type: 'map', pattern: 'divergent', occupancyPct: 25 },
  'roof.occupancy': { type: 'occupancy', warps: 16, registers: 160 },
  'roof.coalesce': staged(false, false),
  'roof.bank': staged(true, true),
  'roof.tiers': { type: 'tiers', preset: 'H100', bw: H100_BW },
  'roof.pcie': { type: 'pcie', preset: 'H100', bw: H100_BW },
  'roof.fleet-router': { type: 'fleet', kernel: 'fleet-router', preset: 'B200', dtype: 'fp16' },
  'roof.fleet-decode': { type: 'fleet', kernel: 'fleet-decode', preset: 'B200', dtype: 'fp16' },
  'roof.fleet-paged-attn': { type: 'fleet', kernel: 'fleet-paged-attn', preset: 'B200', dtype: 'fp16' },
  'roof.fleet-prefill': { type: 'fleet', kernel: 'fleet-prefill', preset: 'B200', dtype: 'fp16' },
}

const reported = (id: string): Observation => {
  const t = task(id)
  const o = observationsFor(RUN[id]).find((x) => x.key === t.observe)
  if (o === undefined) throw new Error(`${id}: the run reports nothing for ${t.observe}`)
  return o
}

/** A prediction that is right for the task, from what the model reports. */
const rightPrediction = (id: string) => {
  const o = reported(id)
  return typeof o.value === 'number' ? { value: o.value } : { choice: o.value }
}

describe('the model', () => {
  test('ridges come from the atlas: the H100 near 295, the B200 at 281.25, FP8 and INT4 multiply the ceiling', () => {
    expect(ridgeAI(MACHINES.h100)).toBeCloseTo(295.22, 1)
    expect(ridgeAI(MACHINES.b200)).toBe(281.25)
    expect(ridgeAI(MACHINES.h100, 'fp8')).toBeCloseTo(2 * ridgeAI(MACHINES.h100), 9)
    expect(ridgeAI(MACHINES.h100, 'int4')).toBeCloseTo(4 * ridgeAI(MACHINES.h100), 9)
    expect(PRESETS.map((p) => p.name)).toEqual(['T4', 'RTX 4090', 'A100', 'H100', 'B200', 'TPU7x'])
    for (const p of PRESETS) expect(p.bw * p.peak).toBeGreaterThan(0)
  })

  test('decode intensity is the batch times the precision multiplier, and the first batch step past the ridge is found', () => {
    expect(decodeAI(32, 'fp16')).toBe(32)
    expect(decodeAI(32, 'fp8')).toBe(64)
    expect(batchToRidge(MACHINES.h100, 'fp16')).toBe(512)
    expect(batchToRidge(MACHINES.h100, 'fp8')).toBe(512) // FP8 weights double the intensity, but the ridge doubled too, so the crossing batch does not move
    expect(batchToRidge({ bw: 1, peak: 10 ** 6 }, 'fp16')).toBeNull() // never gets there on the slider
    expect(BATCH_STEPS[BATCH_STEPS.length - 1]).toBe(512)
  })

  test('tiling and attention: T/2 at FP16, and flash moves far fewer bytes for the same FLOPs', () => {
    expect(matmulAI(16)).toBe(8)
    expect(matmulAI(128)).toBe(64)
    expect(attentionAI('naive')).toBe(1)
    expect(attentionAI('flash')).toBe(60)
    const ratio = attentionBytes('naive') / attentionBytes('flash')
    expect(ratio).toBeCloseTo(ATTENTION.context / (3 * ATTENTION.headDim), 6)
    // the sim's round figure is within a factor of 2 of the byte ratio, so a learner can derive it
    expect(Math.abs(Math.log2(attentionAI('flash') / (attentionAI('naive') * ratio)))).toBeLessThan(1)
  })

  test('boundOf puts the ridge itself on the compute side', () => {
    expect(boundOf(1, 295)).toBe('bandwidth')
    expect(boundOf(295, 295)).toBe('compute')
  })
})

describe('the eighteen outcome tasks (§10.2; wave-3.md §13)', () => {
  test('registered as written: outcome kind on sim-roofline, with the contract KCs and the old ids they replace', () => {
    expect(reg.problems).toEqual([])
    const want: Record<string, { kc: string; legacyId: string }> = {
      'roof.ridge': { kc: 't4.ridge-point', legacyId: 't-roof-b200-ridge' },
      'roof.decode-bound': { kc: 't4.bound-classification', legacyId: 't-decode' },
      'roof.batch-to-ridge': { kc: 't4.decode-bandwidth', legacyId: 't-batch' },
      'roof.tile-ai': { kc: 't4.tiling-intensity', legacyId: 't-roof-tile' },
      'roof.flash-ai': { kc: 't4.tiling-intensity', legacyId: 't-roof-flash' },
      'roof.fp8-ridge': { kc: 't4.ridge-point', legacyId: 't-roof-dtype' },
      'roof.cpu-serial': { kc: 't4.throughput-design', legacyId: 't-cpu-serial' },
      'roof.gpu-map': { kc: 't4.throughput-design', legacyId: 't-gpu-map' },
      'roof.gpu-divergence': { kc: 't4.simt-warps', legacyId: 't-gpu-divergence' },
      'roof.occupancy': { kc: 't4.occupancy', legacyId: 't-roof-occupancy' },
      'roof.coalesce': { kc: 't4.coalescing', legacyId: 't-roof-coalesce' },
      'roof.bank': { kc: 't4.coalescing', legacyId: 't-roof-bank' },
      'roof.tiers': { kc: 't4.gpu-memory-ladder', legacyId: 't-roof-tiers' },
      'roof.pcie': { kc: 't4.gpu-memory-ladder', legacyId: 't-roof-pcie' },
      'roof.fleet-router': { kc: 't4.bound-classification', legacyId: 't-roof-fleet-router' },
      'roof.fleet-decode': { kc: 't4.bound-classification', legacyId: 't-roof-fleet-decode' },
      'roof.fleet-paged-attn': { kc: 't4.bound-classification', legacyId: 't-roof-fleet-paged-attn' },
      'roof.fleet-prefill': { kc: 't4.bound-classification', legacyId: 't-roof-fleet-prefill' },
    }
    expect(ROOFLINE_TASKS.map((t) => t.id)).toEqual(OUTCOME_IDS)
    for (const id of OUTCOME_IDS) {
      const t = task(id)
      expect(t.kind).toBe('outcome')
      expect(t.simId).toBe('sim-roofline')
      expect(t.kcs).toEqual([want[id].kc])
      expect(t.legacyId).toBe(want[id].legacyId)
      expect(t.title.length).toBeLessThanOrEqual(80)
      expect(t.note).toBeTruthy()
      expect(t.predict).toBeDefined()
      expect(t.explain?.ideas).toHaveLength(3)
    }
  })

  test('every outcome task has a phone model that exists, a numeric prediction, and an observe key of the form roof.<name>', () => {
    for (const id of OUTCOME_IDS) {
      const parts = splitCanonical(task(id).phone?.canonical ?? '')
      expect(parts?.model).toBe('roofline')
      expect(PHONE_MODELS[parts!.name]).toBeInstanceOf(Function)
      expect(task(id).observe, id).toBe(id)
    }
    for (const id of PROBE_IDS) expect(task(id).predict?.kind, id).toBe('numeric')
    expect(Object.keys(PHONE_MODELS).sort()).toEqual(OUTCOME_IDS.map((id) => splitCanonical(task(id).phone!.canonical)!.name).sort())
  })

  test('the registry no longer holds the click-through ids: the old ids are only a legacyId', () => {
    const old = ROOFLINE_TASKS.map((t) => t.legacyId!)
    expect(old).toHaveLength(18)
    for (const id of old) expect(reg.byId(id), id).toBeUndefined()
    expect(reg.tasks.filter((t) => t.kind === 'legacy')).toEqual([])
    expect(reg.forSim('sim-roofline').map((t) => t.id)).toEqual(OUTCOME_IDS)
  })

  test('no hardware number is typed into a prompt: the prompts show what the atlas says', () => {
    expect(task('roof.ridge').predict?.prompt).toContain('2.25 PFLOP/s')
    expect(task('roof.ridge').predict?.prompt).toContain('8 TB/s')
    expect(task('roof.fp8-ridge').predict?.prompt).toContain('989 TFLOP/s')
    expect(task('roof.fp8-ridge').predict?.prompt).toContain('3.35 TB/s')
    const src = readFileSync(join(ROOT, 'src', 'components', 'sims', 'roofline.tasks.ts'), 'utf8')
    expect(src).not.toMatch(/2[,_.]?250|989|3[.,]35|8000|295|281/)
  })

  test('each of the twelve has a three-idea explanation and a prompt that takes its numbers from the model', () => {
    for (const id of PROBE_IDS) {
      const t = task(id)
      expect(t.explain?.ideas, id).toHaveLength(3)
      expect(t.explain!.model.length, id).toBeGreaterThan(60)
      expect(t.note, id).toBeTruthy()
      expect(t.kcs, id).toHaveLength(1)
    }
    expect(task('roof.pcie').predict?.prompt).toContain(`${PCIE_BW_GBS} GB/s`)
    expect(task('roof.tiers').predict?.prompt).toContain('20 TB/s')
    expect(task('roof.occupancy').predict?.prompt).toContain('65,536')
    expect(task('roof.fleet-router').predict?.prompt).toContain('0.12 GFLOP')
    expect(task('roof.fleet-prefill').predict?.prompt).toContain('71,680 GFLOP')
  })
})

describe('what the sim reports (and what it does not)', () => {
  test('the run of each task reports exactly the value its phone model shows as the canonical outcome', () => {
    for (const id of OUTCOME_IDS) {
      const t = task(id)
      const canonical = PHONE_MODELS[splitCanonical(t.phone!.canonical)!.name]()
      expect(reported(id).value).toBe(canonical.actual)
      expect(reported(id).unit).toBe(canonical.unit)
    }
    expect(reported('roof.ridge').value).toBe(281.25)
    expect(reported('roof.decode-bound').value).toBe('bandwidth')
    expect(reported('roof.batch-to-ridge').value).toBe(512)
    expect(reported('roof.tile-ai').value).toBe(64)
    expect(reported('roof.flash-ai').value).toBe(60)
    expect(reported('roof.fp8-ridge').value).toBeCloseTo(590.4, 1)
    expect(reported('roof.cpu-serial').value).toBeCloseTo(50, 9)
    expect(reported('roof.gpu-map').value).toBeCloseTo(50, 9)
    expect(reported('roof.gpu-divergence').value).toBeCloseTo(6.25, 9)
    expect(reported('roof.occupancy').value).toBe(128)
    expect(reported('roof.coalesce').value).toBeCloseTo(74.9, 1)
    expect(reported('roof.bank').value).toBeCloseTo(8.78, 2)
    expect(reported('roof.tiers').value).toBeCloseTo(5.97, 2)
    expect(reported('roof.pcie').value).toBeCloseTo(104.69, 2)
    expect(PROBE_IDS.filter((id) => id.startsWith('roof.fleet-')).map((id) => reported(id).value)).toEqual([1.5, 32, 256, 512])
  })

  test('the fleet worksheet’s intensities are its FLOPs over its bytes', () => {
    for (const k of FLEET_KERNELS) expect(k.flopsG / k.bytesG).toBeCloseTo(k.ai, 9)
  })

  test('the paged-attention row is a prefill chunk: its FLOPs and bytes follow from Llama-3-70B and the chunk, not from the batch', () => {
    const k = FLEET_KERNELS.find((r) => r.id === 'fleet-paged-attn')!
    const { layers, qHeads, kvHeads, headDim, gqaGroup, chunk, cached, decodeAI: oneToken, crossChunk } = PAGED_ATTN
    expect([layers, qHeads, kvHeads, headDim]).toEqual([80, 64, 8, 128]) // the model claims
    expect(k.label).toBe('paged attention · prefill chunk')
    expect(gqaGroup).toBe(8)
    expect(chunk).toBe(32)
    // QKᵀ and PV: 4 · d FLOPs per query head, query token and cached token, in every layer
    expect(4 * chunk * cached * headDim * qHeads * layers).toBeCloseTo(k.flopsG * 1e9, -3)
    // K and V of every cached token, in every layer, at 2 bytes
    expect(2 * layers * kvHeads * headDim * 2 * cached).toBeCloseTo(k.bytesG * 1e9, -3)
    expect(Math.round(cached / 100) * 100).toBe(24_400)
    // decode attention: one query token per read, 2 × (query heads per KV head) ÷ bytes per element
    expect(oneToken).toBe((2 * (qHeads / kvHeads)) / 2)
    expect(oneToken * chunk).toBe(k.ai)
    // the ridge is crossed by more tokens per read, 36 and not 35
    const ridge = ridgeAI(MACHINES.b200)
    expect(crossChunk).toBe(36)
    expect(crossChunk * oneToken).toBeGreaterThanOrEqual(ridge)
    expect((crossChunk - 1) * oneToken).toBeLessThan(ridge)
  })

  test('the paged-attention task teaches what moves attention’s intensity, and not batch size or block layout', () => {
    const t = task('roof.fleet-paged-attn')
    const words = [t.title, t.predict!.prompt, t.explain!.model, ...t.explain!.ideas, t.note!].join(' ')
    expect(t.title).toContain('prefill chunk')
    expect(t.predict!.prompt).toContain('32 tokens of a Llama-3-70B prompt')
    expect(words).not.toMatch(/block layout and batch size decide|a little more reuse/)
    expect(t.note).toContain('each sequence reads its own KV')
    expect(t.note).toContain('same FLOPs, same bytes')
    expect(t.explain!.model).toContain('36-token chunk would cross the ridge')
    expect(t.explain!.model).toContain('near 8 FLOP/B')
    expect(t.explain!.ideas[2]).toContain('a bigger batch would not')
  })

  test('the twelve probes are reported only under the setup their prompt names', () => {
    const none: RooflineEvent[] = [
      { type: 'map', pattern: 'coalesced', occupancyPct: 13 }, // too few warps: the register file limits the map
      { type: 'map', pattern: 'strided', occupancyPct: 25 },
      { type: 'map', pattern: 'staged', occupancyPct: 25 },
      { type: 'occupancy', warps: 16, registers: 128 }, // still 25%
      { type: 'occupancy', warps: 32, registers: 255 }, // another warp count answers another question
      { type: 'occupancy', warps: 16, registers: 32 },
      { ...(staged(false, false) as Extract<RooflineEvent, { type: 'access' }>), preset: 'custom' },
      { ...(staged(false, false) as Extract<RooflineEvent, { type: 'access' }>), pattern: 'strided' },
      staged(true, false), // a conflict still standing is not graded by either task
      { type: 'tiers', preset: 'B200', bw: MACHINES.b200.bw },
      { type: 'pcie', preset: 'custom', bw: 1000 },
      { type: 'fleet', kernel: 'fleet-router', preset: 'H100', dtype: 'fp16' },
      { type: 'fleet', kernel: 'fleet-router', preset: 'B200', dtype: 'fp8' },
      { type: 'fleet', kernel: 'nope', preset: 'B200', dtype: 'fp16' },
    ]
    for (const e of none) expect(observationsFor(e), JSON.stringify(e)).toEqual([])
    // the occupancy limit is reported once occupancy falls below 25% at 16 warps, and the bank gain once padding is on
    expect(observationsFor({ type: 'occupancy', warps: 16, registers: 129 }).map((o) => o.value)).toEqual([128])
    expect(observationsFor(staged(true, true)).map((o) => o.key)).toEqual(['roof.bank'])
    expect(observationsFor(staged(false, false)).map((o) => o.key)).toEqual(['roof.coalesce'])
  })

  test('the CPU/GPU map keeps the structure of the sim’s timings: coalesced 50×, divergent an eighth of that throughput', () => {
    expect(serialSpeedup()).toBe(CPU_GPU.gpuSerialMs / CPU_GPU.cpuSerialMs)
    expect(mapSpeedup(1, 1)).toBeCloseTo(CPU_GPU.cpuMapMs / CPU_GPU.gpuMapMs, 9)
    expect(mapSpeedup(1 / 8, 1)).toBeCloseTo(mapSpeedup(1, 1) / 8, 9)
    expect(gpuMapMs(0.0001, 1)).toBeCloseTo(CPU_GPU.gpuMapMs / 0.02, 9) // the throughput factor is floored at 2%
  })

  test('occupancy: 16 warps fit up to 128 registers per thread, and the register file is the binding budget', () => {
    expect(maxRegistersFor(16)).toBe(128)
    expect(occupancyModel(16, 128).pct).toBe(25)
    expect(occupancyModel(16, 129).resident).toBeLessThan(16)
    expect(occupancyModel(16, 129).pct).toBeLessThan(25)
    expect(occupancyModel(64, 32).pct).toBe(100)
    expect(occupancyModel(16, 128).spill).toBe(false)
    expect(occupancyModel(16, 129).spill).toBe(true) // past the limit the requested warps no longer fit, and the sim marks a spill
  })

  test('the staged transpose: it recovers three quarters of HBM, a bank conflict costs far less than 32×, and padding restores it', () => {
    const clean = accessResult('staged', H100_BW, false, false).effectiveBandwidth
    const conflict = accessResult('staged', H100_BW, true, false).effectiveBandwidth
    expect(clean / H100_BW).toBeGreaterThan(0.7)
    expect(clean / H100_BW).toBeLessThan(0.8)
    expect(clean / conflict).toBeLessThan(32) // only the shared half slows
    expect(accessResult('staged', H100_BW, true, true).effectiveBandwidth).toBe(clean)
    expect(accessResult('strided', H100_BW, false, false).effectiveBandwidth).toBeCloseTo(H100_BW / 32, 9)
  })

  test('the tiers: shared, L2 and HBM bandwidth by working set, and PCIe overrides them', () => {
    expect(tierName(4, false, 'auto', false)).toBe('shared')
    expect(tierName(1024, false, 'auto', false)).toBe('L2')
    expect(tierName(2 ** 27, false, 'auto', false)).toBe('HBM')
    expect(tierName(4, false, 'auto', true)).toBe('HBM spill')
    expect(tierName(4, true, 'auto', false)).toBe('PCIe')
    expect(tierBandwidth(4, false, 'auto', false, H100_BW)).toBe(SHARED_BW_GBS)
    expect(tierBandwidth(1024, false, 'auto', false, H100_BW)).toBe(L2_BW_GBS)
    expect(tierBandwidth(4, false, 'hbm', false, H100_BW)).toBe(H100_BW)
    expect(tierBandwidth(4, true, 'shared', false, H100_BW)).toBe(PCIE_BW_GBS)
  })

  test('a run under another setup is the learner’s own experiment: nothing is reported', () => {
    const none: RooflineEvent[] = [
      { type: 'machine', preset: 'H100', dtype: 'fp16' },
      { type: 'machine', preset: 'B200', dtype: 'fp8' }, // the ridge task is graded at FP16
      { type: 'machine', preset: 'B200', dtype: 'int4' },
      { type: 'machine', preset: 'custom', dtype: 'fp16' },
      { type: 'machine', preset: 'H100', dtype: 'int4' },
      { type: 'plot-decode', preset: 'H100', dtype: 'fp8', batch: 1 },
      { type: 'plot-decode', preset: 'A100', dtype: 'fp16', batch: 1 },
      { type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 8 }, // not the batch-1 question, and not past the ridge
      { type: 'batch', preset: 'H100', dtype: 'fp16', batch: 256, decodePlotted: true }, // still left of the ridge
      { type: 'batch', preset: 'H100', dtype: 'fp16', batch: 512, decodePlotted: false },
      { type: 'batch', preset: 'B200', dtype: 'fp16', batch: 512, decodePlotted: true },
      { type: 'tile', tile: 112 },
      { type: 'tile', tile: 144 },
      { type: 'attention', mode: 'naive' },
    ]
    for (const e of none) expect(observationsFor(e)).toEqual([])
  })

  test('plotting decode once the batch is already past the ridge reports both answers', () => {
    const keys = observationsFor({ type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 512 }).map((o) => o.key)
    expect(keys).toEqual(['roof.batch-to-ridge']) // batch 512 is not the batch-1 question
    expect(observationsFor({ type: 'plot-decode', preset: 'H100', dtype: 'fp16', batch: 1 }).map((o) => o.key)).toEqual(['roof.decode-bound'])
  })

  test('the lessons start every task away from its answer state, so a run is a deliberate act', () => {
    for (const lesson of ALL_LESSONS) {
      for (const b of lesson.blocks) {
        if (b.type !== 'exercise' || b.simId !== 'sim-roofline') continue
        const cfg = (b.config ?? {}) as Record<string, unknown>
        expect(cfg.m === SETUP.ridge.preset && cfg.dtype === SETUP.ridge.dtype).toBe(false)
        expect(cfg.dtype).not.toBe('fp8')
        expect(cfg.tileT).not.toBe(SETUP.tile)
        expect(cfg.attentionMode).not.toBe('flash')
        expect(cfg.batch === undefined || BATCH_STEPS.includes(cfg.batch as number)).toBe(true)
        // the twelve probes: no demo already run, no staged transpose, no PCIe path, no register count past the 16-warp limit
        expect(cfg.serialRan).not.toBe(true)
        expect(cfg.mapRan).not.toBe(true)
        expect(cfg.accessPattern).not.toBe('staged')
        expect(cfg.pcieMode).not.toBe(true)
        expect(cfg.bankPadding).not.toBe(true)
        expect(cfg.warps !== 16 || cfg.registers === undefined || (cfg.registers as number) <= maxRegistersFor(16)).toBe(true)
      }
    }
  })
})

describe('predict → run → explain, end to end', () => {
  const LINE = 'The ridge is peak compute over peak bandwidth so decode sits far to the left of it'
  const play = (t: SimTaskDef, actions: RunAction[], from: TaskRun = freshRun()): TaskRun => actions.reduce((s, a) => reduceRun(t, s, a), from)

  test.each(OUTCOME_IDS)('%s: the right prediction passes, and the outcome carries its KCs', (id) => {
    const t = task(id)
    const o = reported(id)
    const s = play(t, [
      { type: 'commit', prediction: rightPrediction(id), at: 1 },
      { type: 'observe', obs: o },
      { type: 'explain', text: LINE },
      { type: 'finish' },
    ])
    expect(s.phase).toBe('done')
    const out = buildOutcome(t, s)!
    expect(out).toMatchObject({ taskId: id, ok: true, score: 1 })
    expect(out.data.kcs).toEqual(t.kcs)
    expect(out.data.actual).toBe(o.value)
  })

  test.each(OUTCOME_IDS)('%s: a wrong prediction is graded as a miss, not a pass', (id) => {
    const t = task(id)
    const o = reported(id)
    const wrong = typeof o.value === 'number' ? { value: o.value * 10 } : { choice: t.predict!.kind === 'choice' ? t.predict!.options.find((x) => x.id !== o.value)!.id : '' }
    const grade = gradePrediction(t.predict!, wrong, o.value)!
    expect(grade.ok).toBe(false)
    expect(grade.score).toBeLessThan(1)
  })

  test.each(OUTCOME_IDS)('%s: the sim reporting before a prediction is locked completes nothing', (id) => {
    const t = task(id)
    const s = play(t, [{ type: 'observe', obs: reported(id) }, { type: 'explain', text: LINE }, { type: 'finish' }])
    expect(s).toEqual(freshRun())
    expect(buildOutcome(t, s)).toBeNull()
  })

  test('the tolerances are the ones that make sense: calculations are tight, estimates are a factor', () => {
    const tol = (id: string) => (task(id).predict?.kind === 'numeric' ? task(id).predict : undefined)
    expect(gradePrediction(task('roof.ridge').predict!, { value: 281 }, 281.25)!.ok).toBe(true)
    expect(gradePrediction(task('roof.ridge').predict!, { value: 300 }, 281.25)!.ok).toBe(false) // 6.7% off a division
    expect(gradePrediction(task('roof.fp8-ridge').predict!, { value: 295 }, 590.4)!.ok).toBe(false) // forgot the FP8 doubling
    expect(gradePrediction(task('roof.tile-ai').predict!, { value: 32 }, 64)!.ok).toBe(false) // T/4, the FP32 formula
    expect(gradePrediction(task('roof.tile-ai').predict!, { value: 128 }, 64)!.ok).toBe(false) // T, forgetting the element size
    expect(gradePrediction(task('roof.batch-to-ridge').predict!, { value: 300 }, 512)!.ok).toBe(true) // the analytic crossing
    expect(gradePrediction(task('roof.batch-to-ridge').predict!, { value: 256 }, 512)!.ok).toBe(false) // a step short is still bandwidth-bound
    expect(gradePrediction(task('roof.flash-ai').predict!, { value: 85 }, 60)!.ok).toBe(true) // derived from the byte ratio
    expect(gradePrediction(task('roof.flash-ai').predict!, { value: 8 }, 60)!.ok).toBe(false)
    expect(tol('roof.flash-ai')?.log).toBe(true)
  })

  test('the twelve probes: every one is a calculation from its prompt, so the tolerance is tight, and the common wrong answers miss', () => {
    const ok = (id: string, value: number, actual: number) => gradePrediction(task(id).predict!, { value }, actual)!.ok
    for (const id of PROBE_IDS) expect(task(id).predict?.kind === 'numeric' && task(id).predict?.log, id).not.toBe(true)
    expect(ok('roof.cpu-serial', 50, 50)).toBe(true) // 4 µs over 80 ns
    expect(ok('roof.cpu-serial', 30, 50)).toBe(false) // a guess, not the per-step ratio
    expect(ok('roof.cpu-serial', 0.02, 50)).toBe(false) // the ratio upside down
    expect(ok('roof.gpu-map', 50, 50)).toBe(true) // 2 ns over 40 ps
    expect(ok('roof.gpu-map', 100, 50)).toBe(false)
    expect(ok('roof.gpu-map', 4, 50)).toBe(false)
    expect(ok('roof.gpu-divergence', 6.5, 6.25)).toBe(true)
    expect(ok('roof.gpu-divergence', 8, 6.25)).toBe(false) // the throughput loss, not the lead over the CPU
    expect(ok('roof.gpu-divergence', 50, 6.25)).toBe(false) // forgot the divergence
    expect(ok('roof.occupancy', 128, 128)).toBe(true)
    expect(ok('roof.occupancy', 4096, 128)).toBe(false) // registers per warp, not per thread
    expect(ok('roof.occupancy', 64, 128)).toBe(false)
    expect(ok('roof.coalesce', 75, 74.9)).toBe(true)
    expect(ok('roof.coalesce', 100, 74.9)).toBe(false) // forgot the shared-memory traffic
    expect(ok('roof.coalesce', 3, 74.9)).toBe(false) // the strided figure
    expect(ok('roof.bank', 8.8, 8.78)).toBe(true)
    expect(ok('roof.bank', 32, 8.78)).toBe(false) // the conflict's 32× applies to one half only
    expect(ok('roof.tiers', 6, 5.97)).toBe(true)
    expect(ok('roof.tiers', 3.6, 5.97)).toBe(false) // L2, not shared memory
    expect(ok('roof.pcie', 105, 104.69)).toBe(true)
    expect(ok('roof.pcie', 52, 104.69)).toBe(false) // the Gen5 link, not the sim's
    expect(ok('roof.fleet-router', 1.5, 1.5)).toBe(true)
    expect(ok('roof.fleet-decode', 4480, 32)).toBe(false) // GFLOP, not FLOP per byte
    expect(ok('roof.fleet-prefill', 500, 512)).toBe(true)
    expect(ok('roof.fleet-paged-attn', 281, 256)).toBe(false) // the ridge, not the kernel
    expect(ok('roof.fleet-paged-attn', 8, 256)).toBe(false) // decode attention, one token per read
  })

  /** Every number a learner needs is in the prompt: pull them out of the text and redo the arithmetic. */
  test('every graded number of the twelve can be worked out from its prompt alone, within its tolerance', () => {
    const nums = (id: string): number[] => (task(id).predict as { prompt: string }).prompt.match(/\d[\d,]*(?:\.\d+)?/g)!.map((n) => Number(n.replace(/,/g, '')))
    const has = (id: string, ...want: number[]) => {
      for (const w of want) expect(nums(id), `${id} states ${w}`).toContain(w)
    }
    const derived: Record<string, number> = {
      'roof.cpu-serial': (4 * 1000) / 80, // 4 µs per GPU step over 80 ns per CPU step
      'roof.gpu-map': (2 * 1000) / 40, // 2 ns per CPU element over 40 ps per GPU element
      'roof.gpu-divergence': 128 / (2.56 * 8),
      'roof.occupancy': 65_536 / (16 * 32),
      'roof.coalesce': 100 / (1 + (256 / 128) * (3.35 / 20)),
      'roof.bank': (1 + (256 / 128) * 32 * (3.35 / 20)) / (1 + (256 / 128) * (3.35 / 20)),
      'roof.tiers': 20 / 3.35,
      'roof.pcie': 3350 / 32,
      'roof.fleet-router': 0.12 / 0.08,
      'roof.fleet-decode': 4480 / 140,
      'roof.fleet-paged-attn': 2048 / 8,
      'roof.fleet-prefill': 71_680 / 140,
    }
    has('roof.cpu-serial', 80, 4)
    has('roof.gpu-map', 2, 40)
    has('roof.gpu-divergence', 2.56, 128)
    has('roof.occupancy', 16, 32, 65_536)
    has('roof.coalesce', 128, 256, 3.35, 20)
    has('roof.bank', 128, 256, 3.35, 20, 32) // the shared traffic and its bandwidth, once missing (3a-18 review)
    has('roof.tiers', 20, 3.35)
    has('roof.pcie', 32, 3.35)
    has('roof.fleet-router', 0.12, 0.08)
    has('roof.fleet-decode', 4480, 140)
    has('roof.fleet-paged-attn', 2048, 8)
    has('roof.fleet-prefill', 71_680, 140)
    expect(task('roof.coalesce').predict?.prompt).toContain('add')
    expect(task('roof.bank').predict?.prompt).toContain('add')
    expect(Object.keys(derived).sort()).toEqual([...PROBE_IDS].sort())
    for (const id of PROBE_IDS) {
      const o = reported(id)
      expect(gradePrediction(task(id).predict!, { value: derived[id] }, o.value)!.ok, id).toBe(true)
    }
  })

  test('a finished cycle reaches the ledger as a sim-task event with the KCs, and completes the task', async () => {
    const id = 'roof.tile-ai'
    const t = task(id)
    const s = play(t, [
      { type: 'commit', prediction: { value: 64 }, conf: 'think', at: 1 },
      { type: 'observe', obs: reported(id) },
      { type: 'explain', text: LINE },
      { type: 'finish' },
    ])
    const tab = startTab(makeProfile())
    expect(completeTask(tab.progress.getState().recordSimOutcome, t, s)).toBe(true)
    expect(tab.progress.getState().aggregate.sims['sim-roofline'].outcomes).toEqual({ [id]: true })
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'sim-task')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ref: `sim:sim-roofline/${id}`, ok: true, data: { v: 2, outcome: true, actual: 64, kcs: ['t4.tiling-intensity'] } })
  })
})

describe('phone mode shows the canonical outcome (§10.4)', () => {
  test.each(OUTCOME_IDS)('%s: a chart and a table from the model, both well-formed', (id) => {
    const o = PHONE_MODELS[splitCanonical(task(id).phone!.canonical)!.name]()
    expect(o.summary.length).toBeGreaterThan(20)
    expect(o.chart.points.length).toBeGreaterThanOrEqual(2)
    expect(o.chart.mark).toBeGreaterThanOrEqual(0)
    expect(o.chart.mark).toBeLessThan(o.chart.points.length)
    for (const p of o.chart.points) expect(Number.isFinite(p.y) && p.y > 0).toBe(true)
    expect(o.table.rows.length).toBeGreaterThanOrEqual(2)
    for (const r of o.table.rows) expect(r).toHaveLength(o.table.columns.length)
    const svg = renderToString(createElement(OutcomeChart, { outcome: o }))
    expect(svg).toContain('role="img"')
    expect(svg).not.toContain('NaN')
    expect(svg).not.toContain('Infinity')
  })

  test('the marked point is the answer: the ridge, the decode bar, the crossing batch, T = 128, flash and FP8', () => {
    const mark = (name: string) => {
      const o = PHONE_MODELS[name]()
      return o.chart.points[o.chart.mark!]
    }
    expect(mark('b200-ridge').label).toContain('ridge')
    expect(mark('decode-bound').label).toContain('decode')
    expect(mark('batch-to-ridge').x).toBe(512)
    expect(mark('tile-ai').x).toBe(128)
    expect(mark('flash-ai').x).toBe('flash')
    expect(mark('fp8-ridge').x).toBe('fp8')
    expect(mark('cpu-serial').x).toBe('CPU')
    expect(mark('gpu-map').x).toBe('GPU coalesced')
    expect(mark('gpu-divergence').x).toBe('GPU divergent')
    expect(mark('occupancy').x).toBe(128)
    expect(mark('coalesce').x).toBe('shared transpose')
    expect(mark('bank').x).toBe('padded')
    expect(mark('tiers').x).toBe('shared')
    expect(mark('pcie').x).toBe('PCIe')
    expect(mark('fleet-router').x).toBe('router scoring')
    expect(mark('fleet-prefill').x).toBe('70B prefill · 512')
  })

  test('a prediction is graded and recorded as a phone outcome: ok false, data.phone, KCs kept', () => {
    for (const id of OUTCOME_IDS) {
      const t = task(id)
      const actual = PHONE_MODELS[splitCanonical(t.phone!.canonical)!.name]().actual
      const out = buildPhoneOutcome(t, rightPrediction(id), 'sure', actual)!
      expect(out).toMatchObject({ taskId: id, score: 1, ok: false })
      expect(out.data).toMatchObject({ phone: true, actual, kcs: t.kcs })
    }
  })
})

describe('the DOM mirror (§10.5)', () => {
  const input: MirrorInput = {
    preset: 'H100',
    bw: MACHINES.h100.bw,
    peak: MACHINES.h100.peak,
    dtype: 'fp16',
    guideAI: 1,
    plotted: [{ label: 'decode @ 70B', ai: 1, attained: 3015 }],
    probes: [{ label: 'matmul tile T=16', ai: 8, attained: 26_800 }],
  }

  test('the table lists the ridge, the roof series, the guide, the plotted kernels and the probe points', () => {
    const t = mirrorTable(input)
    expect(t.columns).toEqual(['series or point', 'intensity (FLOP/B)', 'attainable', 'bound by'])
    const names = t.rows.map((r) => String(r[0]))
    expect(names[0]).toBe('ridge')
    expect(names.filter((n) => n.startsWith('roof at')).length).toBeGreaterThanOrEqual(8)
    expect(names).toContain('guide')
    expect(names).toContain('decode @ 70B')
    expect(names).toContain('matmul tile T=16')
    for (const r of t.rows) expect(r).toHaveLength(t.columns.length)
    expect(t.caption).toContain('H100')
    expect(t.caption).toContain('295')
    expect(t.rows[0][1]).toBe('295')
    expect(t.rows.find((r) => r[0] === 'decode @ 70B')?.[3]).toBe('bandwidth')
  })

  test('the roof rows follow min(peak, AI × bandwidth): the low end is bandwidth-bound, the high end compute-bound', () => {
    const rows = mirrorTable(input).rows.filter((r) => String(r[0]).startsWith('roof at'))
    expect(rows[0][3]).toBe('bandwidth')
    expect(rows[rows.length - 1][3]).toBe('compute')
  })

  test('a precision change moves the ridge in the table; an announcement appears only when there is a discrete result', () => {
    expect(mirrorTable({ ...input, dtype: 'fp8' }).rows[0][1]).toBe('590')
    expect(mirrorTable(input).announce).toBeUndefined()
    expect(mirrorTable({ ...input, announce: '' }).announce).toBeUndefined()
    expect(mirrorTable({ ...input, announce: 'decode at batch 1 is bandwidth-bound' }).announce).toBe('decode at batch 1 is bandwidth-bound')
  })

  test('announcements are short discrete sentences in the spec’s shape, never per-frame values', () => {
    expect(announceDecode(MACHINES.h100, 'fp16', 32)).toBe('decode at batch 32 is bandwidth-bound: 32.0 FLOP/B, ridge 295')
    expect(announceDecode(MACHINES.h100, 'fp16', 512)).toBe('decode at batch 512 is compute-bound: 512 FLOP/B, ridge 295')
    expect(announceKernel('prefill @ 70B', 400, ridgeAI(MACHINES.h100))).toBe('prefill @ 70B is compute-bound: 400 FLOP/B, ridge 295')
    expect(announceMachine('B200', MACHINES.b200, 'fp16')).toBe('B200 at FP16 ×1: ridge 281 FLOP/B')
    expect(announceTile(128)).toBe('tile 128 reaches 64.0 FLOP/B')
    expect(announceAttention('flash')).toBe('flash attention at 60.0 FLOP/B')
    for (const s of [announceDecode(MACHINES.h100, 'fp16', 1), announceTile(16), announceAttention('naive')]) expect(s.length).toBeLessThan(90)
  })

  test('the live region speaks at most once a second: a burst of announcements is spaced by announceDelay', () => {
    // the same scheduling SimMirror's hook uses: each text waits announceDelay(lastSpokenAt, now), the newest wins
    const events = [0, 120, 340, 600, 1300, 1450]
    let lastAt: number | null = null
    const spoken: number[] = []
    let pending: { at: number } | null = null
    for (const now of events) {
      if (pending !== null && pending.at <= now) {
        spoken.push(pending.at)
        lastAt = pending.at
        pending = null
      }
      pending = { at: now + announceDelay(lastAt, now) } // a newer text replaces the pending one
    }
    spoken.push(pending!.at)
    expect(spoken.length).toBeLessThan(events.length)
    for (let i = 1; i < spoken.length; i++) expect(spoken[i] - spoken[i - 1]).toBeGreaterThanOrEqual(1000)
  })

  test('SimMirror renders that table behind a toggle, with the canvas pointing at it', () => {
    const html = renderToString(createElement(SimMirror, { id: 'roof-mirror', table: mirrorTable(input) }))
    expect(html).toMatch(/<div id="roof-mirror" class="sr-only"><table/)
    expect(html).toContain('Show data table')
    expect(html).toContain('decode @ 70B')
  })
})

describe('RooflineSim itself', () => {
  test('the file’s waiver is replaced by a mirror: verify-plays sees it mirrored, and the canvas is described by it', () => {
    expect(SIM_SRC).not.toContain(WAIVER)
    expect(SIM_SRC).toContain('<SimMirror')
    expect(SIM_SRC).toContain('aria-describedby={mirrorId}')
    const [finding] = checkCanvasMirrors([{ file: 'RooflineSim.tsx', text: SIM_SRC }])
    expect(finding.status).toBe('mirrored')
  })

  test('migrated to SimHost: it reads the machine and config through the shell hooks, never the router', () => {
    expect(SIM_SRC).not.toMatch(/\b(useSearchParams|setSearchParams)\b/)
    expect(SIM_SRC).toContain('useSimMachine()')
    expect(SIM_SRC).toContain('useInitialCfg<')
    expect(SIM_SRC).toContain('useObserve()')
  })

  test('announcements come from handlers, never from the animation loop', () => {
    const draw = SIM_SRC.slice(SIM_SRC.indexOf('const draw = (now: number)'), SIM_SRC.indexOf('raf = requestAnimationFrame(draw)\n    return () => {'))
    expect(draw.length).toBeGreaterThan(1000)
    expect(draw).not.toContain('setAnnounce')
    expect(draw).not.toContain('observe(')
    expect(SIM_SRC.match(/setAnnounce\(/g)!.length).toBeGreaterThanOrEqual(6)
  })

  const host = (mode: 'lab' | 'embed'): SimHostInternal => ({
    simId: 'sim-roofline',
    mode,
    machine: 'roofline',
    initialConfig: { m: 'H100', dtype: 'fp8', batch: 4 },
    writeConfig: () => {},
    selectMachine: () => {},
    observe: () => {},
    bus: createObservationBus(),
    finished: createFinishedStore(),
  })
  const render = (h: SimHostInternal) =>
    renderToString(createElement(MemoryRouter, { initialEntries: ['/lesson/t4.l3'] }, createElement(SimHostContext.Provider, { value: h }, createElement(RooflineSim))))

  test('inline, it renders the chart with its mirror and starts from the lesson’s config', () => {
    const html = render(host('embed'))
    expect(html).toContain('<canvas')
    expect(html).toContain('role="img"')
    expect(html).toMatch(/aria-describedby="[^"]+"/)
    expect(html).toContain('data-sim-mirror')
    expect(html).toContain('Show data table')
    expect(html).toContain('Roofline for H100 at FP8 ×2')
    expect(html).toContain('ridge 590 FLOP/B')
  })

  test('the mirror table is in the markup for the chart to describe', () => {
    const html = render(host('embed'))
    const id = html.match(/<canvas[^>]*aria-describedby="([^"]+)"/)![1]
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain('roof at 2^-6')
    expect(html).toContain('matmul tile T=16')
  })

  test('a config for another preset or dtype is honoured; unknown values fall back', () => {
    const html = renderToString(
      createElement(
        MemoryRouter,
        { initialEntries: ['/lesson/t4.l6'] },
        createElement(SimHostContext.Provider, { value: { ...host('embed'), initialConfig: { m: 'B200', dtype: 'nope', tileT: 999 } } }, createElement(RooflineSim)),
      ),
    )
    expect(html).toContain('Roofline for B200 at FP16 ×1')
    expect(html).toContain('matmul tile T=16')
  })
})

describe('the T4 exercise blocks (§10.2: taskIds and config)', () => {
  const blocks = ALL_LESSONS.flatMap((l) => l.blocks.flatMap((b) => (b.type === 'exercise' && b.simId === 'sim-roofline' ? [{ lesson: l.id, b }] : [])))

  test('all five T4 roofline exercises name registry tasks and a config', () => {
    expect(blocks.map((x) => x.lesson).sort()).toEqual(['t4.l1', 't4.l2', 't4.l3', 't4.l4', 't4.l6'])
    for (const { lesson, b } of blocks) {
      expect(b.taskIds?.length, lesson).toBeGreaterThan(0)
      expect(b.config, lesson).toBeTypeOf('object')
      expect(resolveTasks(b.simId, b.machine, b.taskIds, reg).map((t) => t.id)).toEqual(b.taskIds!)
      // wave-3.md §13: every id a lesson exercise block lists is an outcome task, which earns credit
      for (const t of resolveTasks(b.simId, b.machine, b.taskIds, reg)) expect(t.kind, `${lesson}: ${t.id}`).toBe('outcome')
    }
  })

  test('the six outcome tasks sit in the lessons that teach them, once each', () => {
    const where = (id: string) => blocks.filter((x) => x.b.taskIds?.includes(id)).map((x) => x.lesson)
    expect(where('roof.ridge')).toEqual(['t4.l3'])
    expect(where('roof.decode-bound')).toEqual(['t4.l3'])
    expect(where('roof.batch-to-ridge')).toEqual(['t4.l3'])
    expect(where('roof.fp8-ridge')).toEqual(['t4.l3'])
    expect(where('roof.tile-ai')).toEqual(['t4.l6'])
    expect(where('roof.flash-ai')).toEqual(['t4.l6'])
    for (const t of ROOFLINE_TASKS) expect(t.lessons).toEqual(where(t.id))
  })

  test('the twelve new ids sit in t4.l1 to t4.l4, and no exercise block lists an old click-through id', () => {
    const where = (id: string) => blocks.filter((x) => x.b.taskIds?.includes(id)).map((x) => x.lesson)
    expect(where('roof.cpu-serial')).toEqual(['t4.l1'])
    expect(where('roof.gpu-map')).toEqual(['t4.l1'])
    expect(where('roof.gpu-divergence')).toEqual(['t4.l1'])
    expect(where('roof.occupancy')).toEqual(['t4.l1', 't4.l4'])
    expect(where('roof.coalesce')).toEqual(['t4.l4'])
    expect(where('roof.bank')).toEqual(['t4.l4'])
    expect(where('roof.tiers')).toEqual(['t4.l2'])
    expect(where('roof.pcie')).toEqual(['t4.l2'])
    for (const id of ['roof.fleet-router', 'roof.fleet-decode', 'roof.fleet-paged-attn', 'roof.fleet-prefill']) expect(where(id)).toEqual(['t4.l3'])
    const old = new Set(ROOFLINE_TASKS.map((t) => t.legacyId))
    for (const { lesson, b } of blocks) for (const id of b.taskIds ?? []) expect(old.has(id), `${lesson} lists ${id}`).toBe(false)
  })

  test('a config only sets what the sim reads, with values it accepts', () => {
    const known = new Set(['m', 'bw', 'peak', 'batch', 'dtype', 'guide', 'warps', 'registers', 'accessPattern', 'bankConflict', 'bankPadding', 'workingSetKb', 'memoryPath', 'pcieMode', 'tileT', 'attentionMode', 'serialRan', 'mapRan'])
    for (const { lesson, b } of blocks) {
      const cfg = b.config as Record<string, unknown>
      for (const k of Object.keys(cfg)) expect(known.has(k), `${lesson}: ${k}`).toBe(true)
      expect(PRESETS.some((p) => p.name === cfg.m), lesson).toBe(true)
      if (cfg.dtype !== undefined) expect((['fp16', 'fp8', 'int4'] as Dtype[]).includes(cfg.dtype as Dtype)).toBe(true)
    }
  })

  test('the markdown task list says what the registry tasks ask, without giving the answers', () => {
    const l3 = blocks.find((x) => x.lesson === 't4.l3')!.b.tasks.join('\n')
    const l6 = blocks.find((x) => x.lesson === 't4.l6')!.b.tasks.join('\n')
    expect(l3).toMatch(/Predict the B200/)
    expect(l6).toMatch(/Predict the arithmetic intensity of a 128 × 128/)
    for (const answer of ['281', '295', '590', '= 64']) {
      expect(l3).not.toContain(answer)
      expect(l6).not.toContain(answer)
    }
  })
})

describe('one H100 FP8 ridge, and the tiling panel reads the cube', () => {
  const scene = (T: number) => ({ ...BASE, tm: T, tn: T })

  test('the sim, the family and the cube share one FP8 ridge: 2 × BF16 dense over HBM, 590.4 FLOP/B', () => {
    expect(dtypeMultiplier('fp8')).toBe(FP8_OVER_BF16)
    expect(ridgeAI(MACHINES.h100, 'fp8')).toBeCloseTo(590.4, 1)
    expect(ridgeAI(MACHINES.h100, 'fp8')).toBeCloseTo(tilingRidge('fp8'), 9)
    expect(ridgeAI(MACHINES.h100, 'fp16')).toBeCloseTo(tilingRidge('bf16'), 9)
    expect(reported('roof.fp8-ridge').value).toBeCloseTo(tilingRidge('fp8'), 9)
  })

  test('a tile’s throughput factor is its CTAs per SM from the cube: FP16 slabs at k = 64 and 2 stages, not 4-byte elements', () => {
    const factor = (T: number) => tileOccupancyFactor(ctasPerSm(scene(T)))
    expect(ctasPerSm(scene(128))).toBe(3)
    expect(smemBytes(scene(128))).toBe(64 * 1024) // 2 stages × 256 rows × 64 deep × 2 bytes
    expect(factor(16)).toBe(1)
    expect(factor(128)).toBe(1) // the 4-byte, K = T curve gave 0.25 here
    expect(factor(256)).toBe(0.5) // one CTA fits (SMEM and registers), and it cannot overlap its own loads
    for (const T of TILE_CHOICES) {
      expect(ctasPerSm(scene(T)), `T = ${T} runs`).toBeGreaterThanOrEqual(1)
      expect(factor(T), `T = ${T}`).toBeLessThanOrEqual(factor(Math.max(16, T - 16)))
    }
    expect(tileOccupancyFactor(0)).toBe(0.08) // slabs past the per-block limit cannot launch
  })
})

describe('RooflineSim reports what the learner does (mounted)', () => {
  let dom: DomKit
  // The sim draws Radix sliders and switches and a canvas chart, which read what mini-dom's elements do not have: an input
  // prototype with `value` and `checked`, `options` on the native select, and a 2-d context. They are added here and removed after.
  const extras: Record<string, PropertyDescriptor> = {
    options: { configurable: true, get: () => [] },
    getContext: { configurable: true, value: () => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true }) },
  }
  beforeAll(async () => {
    dom = await installDom()
    const g = globalThis as unknown as Record<'HTMLInputElement' | 'HTMLSelectElement', { prototype: object }>
    const slot = { configurable: true, get: () => '', set: () => {} }
    Object.defineProperties(g.HTMLInputElement.prototype, { value: slot, checked: slot })
    Object.defineProperty(g.HTMLSelectElement.prototype, 'value', slot)
    Object.defineProperties(MiniElement.prototype, extras)
  })
  afterAll(async () => {
    for (const k of Object.keys(extras)) delete (MiniElement.prototype as unknown as Record<string, unknown>)[k]
    await dom.uninstall()
  })

  const text = (el: MiniElement) => el.textContent.replace(/\s+/g, ' ')
  const button = (root: MiniElement, label: string) => {
    const found = root.querySelectorAll('button').find((b) => text(b).trim() === label)
    if (found === undefined) throw new Error(`no button "${label}"`)
    return found
  }
  const toggle = (root: MiniElement, label: string) => {
    const found = root.querySelectorAll('button').find((b) => b.getAttribute('role') === 'switch' && b.getAttribute('aria-label') === label)
    if (found === undefined) throw new Error(`no switch "${label}"`)
    return found
  }

  /** Mount the sim inline on a machine with a config; `seen` collects what it reports to the task panel. */
  async function mountSim(machine: string, initialConfig: Record<string, unknown>) {
    const seen: Observation[] = []
    const host: SimHostInternal = {
      simId: 'sim-roofline',
      mode: 'embed',
      machine,
      initialConfig,
      writeConfig: () => {},
      selectMachine: () => {},
      observe: (o) => void seen.push(o),
      bus: createObservationBus(),
      finished: createFinishedStore(),
    }
    const m = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/lesson/t4.l1'] }, createElement(SimHostContext.Provider, { value: host }, createElement(RooflineSim))))
    return { m, seen, keys: () => seen.map((o) => o.key) }
  }

  test('CPU vs GPU: the serial run reports 50×; the map reports 50× when coalesced and 6.25× once the warps diverge', async () => {
    const { m, seen } = await mountSim('cpu-gpu', { m: 'H100', accessPattern: 'coalesced', warps: 16, registers: 32 })
    await dom.press(button(m.container, 'run serial comparison'))
    expect(seen).toEqual([{ key: 'roof.cpu-serial', value: 50, unit: '×' }])
    await dom.press(button(m.container, 'run map comparison'))
    expect(seen[1]).toMatchObject({ key: 'roof.gpu-map', unit: '×' })
    expect(seen[1].value).toBeCloseTo(50, 9)
    await dom.press(button(m.container, 'divergent'))
    expect(seen).toHaveLength(2) // choosing a pattern runs nothing
    await dom.press(button(m.container, 'run map comparison'))
    expect(seen[2]).toMatchObject({ key: 'roof.gpu-divergence' })
    expect(seen[2].value).toBeCloseTo(6.25, 9)
    await m.unmount()
  })

  test('access patterns: the shared transpose reports its bandwidth, and a bank conflict reports the padding gain once it is fixed', async () => {
    const { m, seen, keys } = await mountSim('roofline', { m: 'H100', accessPattern: 'strided', warps: 16, registers: 32, bankConflict: false })
    await dom.press(button(m.container, 'coalesced'))
    expect(keys()).toEqual([]) // only the staged transpose is graded
    await dom.press(button(m.container, 'shared transpose'))
    expect(keys()).toEqual(['roof.coalesce'])
    expect(seen[0].value).toBeCloseTo(74.9, 1)
    await dom.press(toggle(m.container, 'Toggle 32-way bank conflict'))
    expect(keys()).toEqual(['roof.coalesce']) // the conflict itself is not an answer
    await dom.press(toggle(m.container, 'Toggle bank-conflict padding fix'))
    expect(keys()).toEqual(['roof.coalesce', 'roof.bank'])
    expect(seen[1].value).toBeCloseTo(8.78, 2)
    await m.unmount()
  })

  test('the tier probe reports once the sweep has been through shared memory, L2 and HBM; PCIe reports on its own', async () => {
    const { m, seen, keys } = await mountSim('roofline', { m: 'H100', workingSetKb: 1024, memoryPath: 'auto', pcieMode: false })
    await dom.press(button(m.container, 'shared'))
    expect(keys()).toEqual([]) // L2 and shared so far
    await dom.press(button(m.container, 'hbm'))
    expect(keys()).toEqual(['roof.tiers'])
    expect(seen[0].value).toBeCloseTo(5.97, 2)
    const pcie = m.container.querySelectorAll('button').find((b) => b.getAttribute('role') === 'switch' && !b.getAttribute('aria-label'))
    if (pcie === undefined) throw new Error('no PCIe switch')
    await dom.press(pcie)
    expect(keys()[keys().length - 1]).toBe('roof.pcie')
    expect(seen[seen.length - 1].value).toBeCloseTo(104.69, 2)
    await m.unmount()
  })

  test('the B200 fleet table: placing a row switches to the B200, plots the kernel and reports its intensity', async () => {
    const { m, seen } = await mountSim('roofline', { m: 'H100', dtype: 'fp8', batch: 1 })
    expect(text(m.container)).toContain('Roofline for H100 at FP8')
    await dom.press(button(m.container, 'place paged attention · prefill chunk on B200'))
    expect(seen).toEqual([{ key: 'roof.fleet-paged-attn', value: 256, unit: 'FLOP/B' }])
    expect(text(m.container)).toContain('Roofline for B200 at FP16')
    expect(text(m.container)).toContain('placed · AI 256 F/B · bandwidth-bound')
    await dom.press(button(m.container, 'place 70B prefill · 512 on B200'))
    expect(seen[1]).toEqual({ key: 'roof.fleet-prefill', value: 512, unit: 'FLOP/B' })
    expect(text(m.container)).toContain('placed · AI 512 F/B · compute-bound')
    await m.unmount()
  })

  test('the tiling panel shows the cube’s CTAs per SM and the occupancy they give', async () => {
    for (const [tileT, ctas, occ] of [[128, '3 CTAs per SM', 'occupancy 100%'], [192, '1 CTA per SM', 'occupancy 50%'], [16, '28 CTAs per SM', 'occupancy 100%']] as const) {
      const { m } = await mountSim('roofline', { m: 'H100', tileT })
      expect(text(m.container), `T = ${tileT}`).toContain(ctas)
      expect(text(m.container), `T = ${tileT}`).toContain(occ)
      await m.unmount()
    }
  })

  test('the register slider reports the limit once 16 warps no longer fit (keyboard)', async () => {
    const { m, seen } = await mountSim('roofline', { m: 'H100', warps: 16, registers: 120 })
    const thumb = m.container.querySelectorAll('[role="slider"]').find((e) => e.getAttribute('aria-label') === 'registers per thread')
    if (thumb === undefined) throw new Error('no registers slider')
    const key = (k: string) => dom.act(() => void thumb.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: k })))
    for (let i = 0; i < 8; i++) await key('ArrowRight') // 121 … 128: occupancy is still 25%
    expect(seen).toEqual([])
    await key('ArrowRight') // 129
    expect(seen).toEqual([{ key: 'roof.occupancy', value: 128, unit: 'registers' }])
    await m.unmount()
  })
})
