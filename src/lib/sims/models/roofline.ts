/**
 * The roofline model behind sim-roofline, as pure arithmetic (P2, docs/specs/wave-1.md §10.2–10.5).
 *
 * Three consumers share it, so they cannot disagree:
 *   - RooflineSim draws and reports from it;
 *   - the six outcome tasks (src/components/sims/roofline.tasks.ts) are graded against what it reports,
 *     through `observationsFor`;
 *   - phone mode (PhoneOutcome) shows `PHONE_MODELS[...]`, the canonical outcome of each task's setup.
 *
 * Every hardware number comes from the atlas (sourced claims). The scenario numbers below are synthetic
 * and declared so (invariant W4): the 32k-context attention shape, decode's one-FLOP-per-byte intensity at
 * batch 1, FlashAttention's round intensity of 60, and the precision multipliers. No DOM, no clock.
 */

import { atlasRow } from '@/data/atlas'
import { tiledIntensity } from '@/lib/roofline'
import type { CanonicalOutcome } from '@/lib/sims/host'
import type { MirrorTable, Observation } from '@/lib/sims/types'

/* ------------------------------------------------------------------ */
/* Machines                                                            */
/* ------------------------------------------------------------------ */

export interface Machine {
  name: string
  bw: number // GB/s
  peak: number // GFLOP/s, dense BF16/FP16
}

// Every preset comes from the hardware atlas (sourced claims). `name` is the saved-config key, so A100 keeps its short name.
// T4 peak is dense FP16 (Turing has no BF16) and RTX 4090 peak is dense BF16 with FP32 accumulate.
function atlasMachine(id: string, name?: string): Machine {
  const row = atlasRow(id)
  return { name: name ?? row.name, bw: row.hbmBwGBs ?? 0, peak: row.bf16DenseGflops ?? 0 }
}

export const MACHINES = {
  t4: atlasMachine('t4'),
  rtx4090: atlasMachine('rtx4090'),
  a100: atlasMachine('a100-40', 'A100'),
  h100: atlasMachine('h100'),
  b200: atlasMachine('b200'),
  tpu7x: atlasMachine('tpu7x'),
} as const

export const PRESETS: Machine[] = [MACHINES.t4, MACHINES.rtx4090, MACHINES.a100, MACHINES.h100, MACHINES.b200, MACHINES.tpu7x]

/* ------------------------------------------------------------------ */
/* Precision, intensity and the ridge                                  */
/* ------------------------------------------------------------------ */

export type Dtype = 'fp16' | 'fp8' | 'int4'
export type Bound = 'bandwidth' | 'compute'

/** Peak FLOP/s multiplier of a precision ceiling over dense FP16 (synthetic, dimensionally faithful). */
export const dtypeMultiplier = (dtype: Dtype): number => {
  if (dtype === 'fp8') return 2
  if (dtype === 'int4') return 4
  return 1
}

export const dtypeLabel = (dtype: Dtype): string => {
  if (dtype === 'fp8') return 'FP8 ×2'
  if (dtype === 'int4') return 'INT4 ×4'
  return 'FP16 ×1'
}

/** FLOP/byte where the bandwidth slope meets the compute ceiling: peak / bandwidth, at the precision's ceiling. */
export const ridgeAI = (m: Pick<Machine, 'bw' | 'peak'>, dtype: Dtype = 'fp16'): number => (m.peak * dtypeMultiplier(dtype)) / m.bw

/** Attainable GFLOP/s at an intensity: `min(peak, AI × bandwidth)`. */
export const attainable = (m: Pick<Machine, 'bw' | 'peak'>, dtype: Dtype, ai: number): number =>
  Math.min(m.peak * dtypeMultiplier(dtype), m.bw * ai)

export const boundOf = (ai: number, ridge: number): Bound => (ai < ridge ? 'bandwidth' : 'compute')

export const BATCH_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]

/** Decode performs the same FLOPs per weight read whatever the batch, so a batch of N is N times the intensity; lower precision reads fewer weight bytes. */
export const decodeAI = (batch: number, dtype: Dtype): number => batch * dtypeMultiplier(dtype)

/** The first batch step at which decode reaches the ridge, or null if the slider never gets there. */
export function batchToRidge(m: Pick<Machine, 'bw' | 'peak'>, dtype: Dtype): number | null {
  const ridge = ridgeAI(m, dtype)
  return BATCH_STEPS.find((b) => decodeAI(b, dtype) >= ridge) ?? null
}

/* ------------------------------------------------------------------ */
/* Tiling and attention                                                */
/* ------------------------------------------------------------------ */

export const TILE_CHOICES = Array.from({ length: 16 }, (_, index) => (index + 1) * 16)

/** Tiled reuse raises intensity in proportion to T: T/2 F/B for FP16 operands (see tiledIntensity). */
export const matmulAI = (T: number): number => tiledIntensity(T, 2)

/**
 * The attention scenario of the tiling playground (synthetic, declared): a 32k context, head dimension 128,
 * FP16 scores and activations. Naive attention materializes the N×N scores in HBM; FlashAttention moves Q, K
 * and V only. The intensities are round figures of the right order: the byte ratio is N/(3d) ≈ 85.
 */
export const ATTENTION = {
  context: 32_768,
  headDim: 128,
  naiveAI: 1,
  flashAI: 60,
} as const

export type AttentionMode = 'naive' | 'flash'

export const attentionAI = (mode: AttentionMode): number => (mode === 'naive' ? ATTENTION.naiveAI : ATTENTION.flashAI)

export const attentionBytes = (mode: AttentionMode): number =>
  mode === 'naive' ? 2 * ATTENTION.context ** 2 : 2 * ATTENTION.context * ATTENTION.headDim * 3

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const fmtAI = (v: number): string =>
  v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(2)

export const fmtRate = (g: number): string =>
  g >= 1000 ? `${(g / 1000).toFixed(g >= 100_000 ? 0 : 1)} TFLOP/s` : `${g.toFixed(0)} GFLOP/s`

/** A peak or bandwidth for a task's prompt, in the units a datasheet uses. */
export const fmtPeak = (gflops: number): string =>
  gflops >= 1_000_000 ? `${Number((gflops / 1_000_000).toPrecision(3))} PFLOP/s` : `${Number((gflops / 1000).toPrecision(3))} TFLOP/s`
export const fmtTBs = (gbs: number): string => `${Number((gbs / 1000).toPrecision(3))} TB/s`

/* ------------------------------------------------------------------ */
/* What a run reports (the observations the task panel grades)         */
/* ------------------------------------------------------------------ */

/**
 * The setup each outcome task is graded under. A run under any other setup is the learner's own experiment:
 * it is not reported, so a prediction about the B200 is never graded against another machine.
 */
export const SETUP = {
  /** `roof.ridge`: B200 at the FP16 ceiling. */
  ridge: { preset: 'B200', dtype: 'fp16' },
  /** `roof.decode-bound` and `roof.batch-to-ridge`: H100 at FP16 (decode-bound also at batch 1). */
  decode: { preset: 'H100', dtype: 'fp16', batch: 1 },
  /** `roof.fp8-ridge`: H100 at the FP8 ceiling. */
  fp8: { preset: 'H100', dtype: 'fp8' },
  /** `roof.tile-ai`: the tile that is reported. */
  tile: 128,
} as const

const machineOf = (preset: string): Machine | undefined => PRESETS.find((p) => p.name === preset)

export type RooflineEvent =
  /** A hardware preset or a precision ceiling was chosen. */
  | { type: 'machine'; preset: string; dtype: Dtype }
  /** The decode kernel was plotted. */
  | { type: 'plot-decode'; preset: string; dtype: Dtype; batch: number }
  /** The batch slider moved. */
  | { type: 'batch'; preset: string; dtype: Dtype; batch: number; decodePlotted: boolean }
  /** The matmul tile slider moved. */
  | { type: 'tile'; tile: number }
  /** The attention view changed. */
  | { type: 'attention'; mode: AttentionMode }

const obs = (key: string, value: number | string, unit?: string): Observation => (unit === undefined ? { key, value } : { key, value, unit })

/** The first batch step that reaches the ridge, once decode is plotted at (or past) it; null when the setup is not the task's. */
function batchObservation(preset: string, dtype: Dtype, batch: number): Observation | null {
  const m = machineOf(preset)
  if (m === undefined || preset !== SETUP.decode.preset || dtype !== SETUP.decode.dtype) return null
  const first = batchToRidge(m, dtype)
  return first !== null && batch >= first ? obs('roof.batch-to-ridge', first, 'requests') : null
}

/** What the sim reports to the task panel for one learner action: nothing, or the measurements the setup defines. */
export function observationsFor(e: RooflineEvent): Observation[] {
  switch (e.type) {
    case 'machine': {
      const m = machineOf(e.preset)
      if (m === undefined) return []
      if (e.preset === SETUP.ridge.preset && e.dtype === SETUP.ridge.dtype) return [obs('roof.ridge', ridgeAI(m, e.dtype), 'FLOP/B')]
      if (e.preset === SETUP.fp8.preset && e.dtype === SETUP.fp8.dtype) return [obs('roof.fp8-ridge', ridgeAI(m, e.dtype), 'FLOP/B')]
      return []
    }
    case 'plot-decode': {
      const m = machineOf(e.preset)
      if (m === undefined || e.preset !== SETUP.decode.preset || e.dtype !== SETUP.decode.dtype) return []
      const out: Observation[] = []
      if (e.batch === SETUP.decode.batch) out.push(obs('roof.decode-bound', boundOf(decodeAI(e.batch, e.dtype), ridgeAI(m, e.dtype))))
      const crossed = batchObservation(e.preset, e.dtype, e.batch)
      if (crossed !== null) out.push(crossed)
      return out
    }
    case 'batch': {
      if (!e.decodePlotted) return []
      const crossed = batchObservation(e.preset, e.dtype, e.batch)
      return crossed === null ? [] : [crossed]
    }
    case 'tile':
      return e.tile === SETUP.tile ? [obs('roof.tile-ai', matmulAI(e.tile), 'FLOP/B')] : []
    case 'attention':
      return e.mode === 'flash' ? [obs('roof.flash-ai', attentionAI('flash'), 'FLOP/B')] : []
  }
}

/* ------------------------------------------------------------------ */
/* Announcements: discrete results only, never per frame (§10.5)       */
/* ------------------------------------------------------------------ */

export function announceDecode(m: Pick<Machine, 'bw' | 'peak'>, dtype: Dtype, batch: number): string {
  const ai = decodeAI(batch, dtype)
  const ridge = ridgeAI(m, dtype)
  return `decode at batch ${batch} is ${boundOf(ai, ridge)}-bound: ${fmtAI(ai)} FLOP/B, ridge ${fmtAI(ridge)}`
}

export function announceKernel(label: string, ai: number, ridge: number): string {
  return `${label} is ${boundOf(ai, ridge)}-bound: ${fmtAI(ai)} FLOP/B, ridge ${fmtAI(ridge)}`
}

export function announceMachine(preset: string, m: Pick<Machine, 'bw' | 'peak'>, dtype: Dtype): string {
  return `${preset} at ${dtypeLabel(dtype)}: ridge ${fmtAI(ridgeAI(m, dtype))} FLOP/B`
}

export const announceTile = (tile: number): string => `tile ${tile} reaches ${fmtAI(matmulAI(tile))} FLOP/B`

export const announceAttention = (mode: AttentionMode): string => `${mode} attention at ${fmtAI(attentionAI(mode))} FLOP/B`

/* ------------------------------------------------------------------ */
/* The DOM mirror of the chart (§10.5)                                 */
/* ------------------------------------------------------------------ */

export interface MirrorPoint {
  label: string
  /** FLOP/byte. */
  ai: number
  /** Attained GFLOP/s. */
  attained: number
}

export interface MirrorInput {
  preset: string
  bw: number
  peak: number
  dtype: Dtype
  /** The scrub guide's intensity. */
  guideAI: number
  /** Kernels the learner has plotted. */
  plotted: readonly MirrorPoint[]
  /** The four scenario points the chart always draws (coalescing, tier, tile, attention). */
  probes: readonly MirrorPoint[]
  announce?: string
}

/** Roof samples at every other power of two across the chart's x range (2^-6 … 2^10). */
const ROOF_SAMPLES = [-6, -4, -2, 0, 2, 4, 6, 8, 10]

/** The plotted series and current points of the roofline chart, as a table. */
export function mirrorTable(input: MirrorInput): MirrorTable {
  const m = { bw: input.bw, peak: input.peak }
  const ridge = ridgeAI(m, input.dtype)
  const row = (label: string, ai: number, attained: number): (string | number)[] => [label, fmtAI(ai), fmtRate(attained), boundOf(ai, ridge)]
  const rows: (string | number)[][] = [
    row('ridge', ridge, input.peak * dtypeMultiplier(input.dtype)),
    ...ROOF_SAMPLES.map((p) => row(`roof at 2^${p}`, 2 ** p, attainable(m, input.dtype, 2 ** p))),
    row('guide', input.guideAI, attainable(m, input.dtype, input.guideAI)),
    ...input.plotted.map((p) => row(p.label, p.ai, p.attained)),
    ...input.probes.map((p) => row(p.label, p.ai, p.attained)),
  ]
  const table: MirrorTable = {
    caption: `Roofline for ${input.preset} at ${dtypeLabel(input.dtype)}: bandwidth ${fmtTBs(input.bw)}, peak ${fmtRate(input.peak * dtypeMultiplier(input.dtype))}, ridge ${fmtAI(ridge)} FLOP/B. The roof series, the guide, plotted kernels and probe points.`,
    columns: ['series or point', 'intensity (FLOP/B)', 'attainable', 'bound by'],
    rows,
  }
  if (input.announce !== undefined && input.announce !== '') table.announce = input.announce
  return table
}

/* ------------------------------------------------------------------ */
/* Phone mode: the canonical outcome of each task's setup (§10.4)      */
/* ------------------------------------------------------------------ */

const tflops = (g: number): number => Number((g / 1000).toPrecision(4))

/** The B200 roofline, with the ridge placed among the samples. */
function b200Ridge(): CanonicalOutcome {
  const m = MACHINES.b200
  const dtype = SETUP.ridge.dtype
  const ridge = ridgeAI(m, dtype)
  const ais = [0.25, 1, 4, 16, 64, ridge, 1024]
  const points = ais.map((ai) => ({
    x: ai,
    y: tflops(attainable(m, dtype, ai)),
    label: ai === ridge ? `ridge ${fmtAI(ridge)}` : String(ai),
  }))
  return {
    actual: ridge,
    unit: 'FLOP/B',
    summary: `The B200's roofline bends at ${fmtAI(ridge)} FLOP/B: ${fmtPeak(m.peak)} of FP16 over ${fmtTBs(m.bw)}.`,
    chart: { kind: 'line', xLabel: 'FLOP/B', yLabel: 'TFLOP/s', points, mark: ais.indexOf(ridge), logX: true, logY: true },
    table: {
      caption: 'B200 attainable throughput by arithmetic intensity, FP16',
      columns: ['FLOP/B', 'attainable TFLOP/s', 'bound by'],
      rows: points.map((p, i) => [fmtAI(ais[i]), p.y, boundOf(ais[i], ridge)]),
    },
  }
}

/** Decode at batch 1 against the H100's ridge. */
function decodeBound(): CanonicalOutcome {
  const m = MACHINES.h100
  const { dtype, batch } = SETUP.decode
  const ai = decodeAI(batch, dtype)
  const ridge = ridgeAI(m, dtype)
  const bound = boundOf(ai, ridge)
  return {
    actual: bound,
    summary: `Decode at batch ${batch} has ${fmtAI(ai)} FLOP/B against an H100 ridge of ${fmtAI(ridge)}: ${bound}-bound.`,
    chart: {
      kind: 'bars',
      xLabel: 'workload',
      yLabel: 'FLOP/B',
      points: [
        { x: 'decode', y: ai, label: `decode b${batch}` },
        { x: 'ridge', y: ridge, label: 'H100 ridge' },
      ],
      mark: 0,
      logY: true,
    },
    table: {
      caption: 'Decode intensity against the H100 ridge, FP16',
      columns: ['quantity', 'FLOP/B'],
      rows: [
        [`decode at batch ${batch}`, fmtAI(ai)],
        ['H100 ridge', fmtAI(ridge)],
      ],
    },
  }
}

/** Decode's attainable throughput as the batch grows, until it meets the compute roof. */
function batchToRidgeOutcome(): CanonicalOutcome {
  const m = MACHINES.h100
  const dtype = SETUP.decode.dtype
  const ridge = ridgeAI(m, dtype)
  const first = batchToRidge(m, dtype) ?? BATCH_STEPS[BATCH_STEPS.length - 1]
  const points = BATCH_STEPS.map((b) => ({ x: b, y: tflops(attainable(m, dtype, decodeAI(b, dtype))) }))
  return {
    actual: first,
    unit: 'requests',
    summary: `On an H100 at FP16 decode reaches the ridge (${fmtAI(ridge)} FLOP/B) at batch ${first}, the first step whose intensity is at least that.`,
    chart: { kind: 'line', xLabel: 'batch', yLabel: 'TFLOP/s', points, mark: BATCH_STEPS.indexOf(first), logX: true, logY: true },
    table: {
      caption: 'Decode attainable throughput by batch size, H100 FP16',
      columns: ['batch', 'FLOP/B', 'attainable TFLOP/s', 'bound by'],
      rows: BATCH_STEPS.map((b) => [b, fmtAI(decodeAI(b, dtype)), tflops(attainable(m, dtype, decodeAI(b, dtype))), boundOf(decodeAI(b, dtype), ridge)]),
    },
  }
}

const TILE_SWEEP = [16, 32, 64, 128, 256]

/** Intensity of a matmul tile as T grows. */
function tileOutcome(): CanonicalOutcome {
  const T = SETUP.tile
  const ai = matmulAI(T)
  return {
    actual: ai,
    unit: 'FLOP/B',
    summary: `A ${T} × ${T} tile reuses each staged element ${T} times, so FP16 intensity is T/2 = ${fmtAI(ai)} FLOP/B.`,
    chart: {
      kind: 'bars',
      xLabel: 'tile T',
      yLabel: 'FLOP/B',
      points: TILE_SWEEP.map((t) => ({ x: t, y: matmulAI(t), label: `T=${t}` })),
      mark: TILE_SWEEP.indexOf(T),
      logY: true,
    },
    table: {
      caption: 'Matmul tile intensity by tile size, FP16 operands',
      columns: ['tile T', 'FLOP/B'],
      rows: TILE_SWEEP.map((t) => [t, fmtAI(matmulAI(t))]),
    },
  }
}

/** Attention intensity, naive against flash. */
function flashOutcome(): CanonicalOutcome {
  const flash = attentionAI('flash')
  return {
    actual: flash,
    unit: 'FLOP/B',
    summary: `FlashAttention keeps the N×N scores in SRAM, so at a ${ATTENTION.context.toLocaleString('en-US')}-token context the sim reports ${fmtAI(flash)} FLOP/B against ${fmtAI(attentionAI('naive'))} for naive attention.`,
    chart: {
      kind: 'bars',
      xLabel: 'attention view',
      yLabel: 'FLOP/B',
      points: [
        { x: 'naive', y: attentionAI('naive'), label: 'naive' },
        { x: 'flash', y: flash, label: 'flash' },
      ],
      mark: 1,
      logY: true,
    },
    table: {
      caption: `Attention intensity and HBM bytes at a ${ATTENTION.context.toLocaleString('en-US')}-token context (synthetic scenario)`,
      columns: ['view', 'FLOP/B', 'HBM bytes'],
      rows: (['naive', 'flash'] as const).map((mode) => [mode, fmtAI(attentionAI(mode)), attentionBytes(mode).toLocaleString('en-US')]),
    },
  }
}

/** The H100 ridge at each precision ceiling. */
function fp8Ridge(): CanonicalOutcome {
  const m = MACHINES.h100
  const dtypes: Dtype[] = ['fp16', 'fp8', 'int4']
  const ridge = ridgeAI(m, SETUP.fp8.dtype)
  return {
    actual: ridge,
    unit: 'FLOP/B',
    summary: `FP8 doubles the H100's peak but not its bandwidth, so the ridge moves from ${fmtAI(ridgeAI(m, 'fp16'))} to ${fmtAI(ridge)} FLOP/B.`,
    chart: {
      kind: 'bars',
      xLabel: 'precision ceiling',
      yLabel: 'FLOP/B',
      points: dtypes.map((d) => ({ x: d, y: ridgeAI(m, d), label: d.toUpperCase() })),
      mark: dtypes.indexOf(SETUP.fp8.dtype),
    },
    table: {
      caption: 'H100 ridge by precision ceiling',
      columns: ['precision', 'peak', 'ridge FLOP/B'],
      rows: dtypes.map((d) => [d.toUpperCase(), fmtRate(m.peak * dtypeMultiplier(d)), fmtAI(ridgeAI(m, d))]),
    },
  }
}

/** `phone.canonical` of a task is `roofline.<name>`. */
export const PHONE_MODELS: Readonly<Record<string, () => CanonicalOutcome>> = {
  'b200-ridge': b200Ridge,
  'decode-bound': decodeBound,
  'batch-to-ridge': batchToRidgeOutcome,
  'tile-ai': tileOutcome,
  'flash-ai': flashOutcome,
  'fp8-ridge': fp8Ridge,
}
