/**
 * The roofline model behind sim-roofline, as pure arithmetic (P2, docs/specs/wave-1.md §10.2–10.5).
 *
 * Three consumers share it, so they cannot disagree:
 *   - RooflineSim draws and reports from it;
 *   - the eighteen outcome tasks (src/components/sims/roofline.tasks.ts) are graded against what it reports,
 *     through `observationsFor`;
 *   - phone mode (PhoneOutcome) shows `PHONE_MODELS[...]`, the canonical outcome of each task's setup.
 *
 * Every hardware number comes from the atlas (sourced claims). The scenario numbers below are synthetic
 * and declared so (invariant W4): the 32k-context attention shape, decode's one-FLOP-per-byte intensity at
 * batch 1, FlashAttention's round intensity of 60, the precision multipliers, the CPU and GPU timings of the
 * latency-versus-throughput demo, the memory-tier bandwidths and the Fleet worksheet's FLOPs and bytes.
 * The FP8 ceiling is 2 × BF16 dense, the rule the Tiling Cube shares (FP8_OVER_BF16 in
 * src/lib/world/tiling.ts), so the app shows one H100 FP8 ridge, 590.4 FLOP/B. No DOM, no clock.
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

/**
 * What a tile's residency does to its throughput. A CTA's loads hide behind another CTA's math only when two
 * are resident on the SM, so one CTA per SM gets half the roof and none (the slabs exceed the per-block
 * limit) the floor. `ctas` is the cube's CTAs per SM (`ctasPerSm` in src/lib/world/tiling.ts, which counts
 * shared memory and the accumulators' registers at the cube's k = 64, 2 stages and FP16), passed in so this
 * model stays out of the eager registry's graph.
 */
export const CTAS_TO_OVERLAP = 2
export const TILE_FLOOR = 0.08
export const tileOccupancyFactor = (ctas: number): number => (ctas < 1 ? TILE_FLOOR : Math.min(1, ctas / CTAS_TO_OVERLAP))

/* ------------------------------------------------------------------ */
/* CPU versus GPU, occupancy, access patterns and the memory tiers     */
/* ------------------------------------------------------------------ */

/** The latency-versus-throughput demo (synthetic): a dependent chain and a 64M-element map, on a CPU core and on the GPU. */
export const CPU_GPU = { cpuSerialMs: 0.08, gpuSerialMs: 4, cpuMapMs: 128, gpuMapMs: 2.56 } as const

/** How many times faster the CPU is on the serial chain. */
export const serialSpeedup = (): number => CPU_GPU.gpuSerialMs / CPU_GPU.cpuSerialMs

/** The GPU's time for the map at a throughput factor (access pattern and occupancy), with the factor floored at 2%. */
export const gpuMapMs = (accessFactor: number, occupancyThroughput: number): number =>
  CPU_GPU.gpuMapMs / Math.max(0.02, accessFactor * occupancyThroughput)

/** The map's CPU time over the GPU's: how many times faster the GPU is. */
export const mapSpeedup = (accessFactor: number, occupancyThroughput: number): number => CPU_GPU.cpuMapMs / gpuMapMs(accessFactor, occupancyThroughput)

export const WARP_THREADS = 32
export const MAX_WARP_SLOTS = 64
/** 256 KiB of 32-bit registers per SM. */
export const REG_FILE_REGS = (256 * 1024) / 4
export const SMEM_KB_PER_SM = 228
export const SHARED_BW_GBS = 20_000 // ~20 TB/s
export const L2_BW_GBS = 12_000 // ~12 TB/s
export const PCIE_BW_GBS = 32 // PCIe x16 Gen4, ~32 GB/s

/** Synthetic occupancy: the register file is the binding budget. */
export function occupancyModel(warps: number, regPerThread: number): { resident: number; pct: number; spill: boolean; maxByReg: number } {
  const regsPerWarp = regPerThread * WARP_THREADS
  const maxByReg = Math.max(1, Math.floor(REG_FILE_REGS / regsPerWarp))
  const resident = Math.min(warps, maxByReg, MAX_WARP_SLOTS)
  const pct = Math.round((resident / MAX_WARP_SLOTS) * 100)
  const spill = warps * regsPerWarp > REG_FILE_REGS
  return { resident, pct, spill, maxByReg }
}

/** The most registers per thread at which `warps` warps still fit the register file. */
export const maxRegistersFor = (warps: number): number => Math.floor(REG_FILE_REGS / (warps * WARP_THREADS))

export type AccessPattern = 'coalesced' | 'strided' | 'divergent' | 'staged'

/** Effective HBM bandwidth multiplier for the access-pattern demo. */
export const coalesceFactor = (pattern: 'coalesced' | 'strided' | 'divergent'): number => {
  if (pattern === 'coalesced') return 1
  if (pattern === 'strided') return 1 / 32
  return 1 / 8 // divergent: serialized warp paths
}

export interface AccessResult {
  globalEfficiency: number
  globalTrafficBytes: number
  sharedEfficiency: number | null
  sharedTrafficBytes: number
  effectiveBandwidth: number
}

/**
 * Models one warp producing 128 useful bytes. Staging first coalesces the global load, then pays a
 * shared-memory write and a transposed read (256 B of shared traffic).
 */
export function accessResult(pattern: AccessPattern, hbmBw: number, bankConflict: boolean, bankPadding: boolean): AccessResult {
  const globalEfficiency = pattern === 'staged' ? 1 : coalesceFactor(pattern)
  const globalTrafficBytes = 128 / globalEfficiency
  if (pattern !== 'staged') {
    return { globalEfficiency, globalTrafficBytes, sharedEfficiency: null, sharedTrafficBytes: 0, effectiveBandwidth: hbmBw * globalEfficiency }
  }
  const sharedEfficiency = bankConflict && !bankPadding ? 1 / 32 : 1
  const sharedTrafficBytes = 256
  const secondsPerGb = globalTrafficBytes / 128 / hbmBw + sharedTrafficBytes / 128 / (SHARED_BW_GBS * sharedEfficiency)
  return { globalEfficiency, globalTrafficBytes, sharedEfficiency, sharedTrafficBytes, effectiveBandwidth: 1 / secondsPerGb }
}

/** Percent of the HBM bandwidth the staged transpose delivers end to end (no bank conflict). */
export const stagedPercent = (hbmBw: number): number => (100 * accessResult('staged', hbmBw, false, false).effectiveBandwidth) / hbmBw

/** How many times more bandwidth the +1 padding fix gives a staged transpose with a 32-way bank conflict. */
export const paddingGain = (hbmBw: number): number =>
  accessResult('staged', hbmBw, true, true).effectiveBandwidth / accessResult('staged', hbmBw, true, false).effectiveBandwidth

export type MemoryPath = 'auto' | 'shared' | 'hbm'

/** Effective bandwidth tier for the working-set probe. Explicit paths support the 4 KiB comparison. */
export function tierBandwidth(wsKb: number, pcie: boolean, path: MemoryPath, spilling: boolean, hbmBw: number): number {
  if (pcie) return PCIE_BW_GBS
  if (spilling || path === 'hbm') return hbmBw
  if (path === 'shared') return SHARED_BW_GBS
  if (wsKb <= SMEM_KB_PER_SM) return SHARED_BW_GBS
  if (wsKb <= 50 * 1024) return L2_BW_GBS
  return hbmBw
}

export function tierName(wsKb: number, pcie: boolean, path: MemoryPath, spilling: boolean): string {
  if (pcie) return 'PCIe'
  if (spilling) return 'HBM spill'
  if (path === 'shared') return 'shared'
  if (path === 'hbm') return 'HBM'
  if (wsKb <= SMEM_KB_PER_SM) return 'shared'
  if (wsKb <= 50 * 1024) return 'L2'
  return 'HBM'
}

/** How many times faster the shared-memory tier is than HBM at a bandwidth (GB/s). */
export const sharedOverHbm = (hbmBw: number): number => SHARED_BW_GBS / hbmBw

/** How many times slower a PCIe transfer is than streaming HBM at a bandwidth (GB/s). */
export const hbmOverPcie = (hbmBw: number): number => hbmBw / PCIE_BW_GBS

/**
 * The Fleet serving loop as a worksheet: GFLOPs / GB reduces directly to FLOPs per byte, so no hidden unit
 * conversion can rescue a guessed answer. Synthetic, derived from the Fleet engine's loop.
 */
export interface FleetKernel {
  id: 'fleet-router' | 'fleet-decode' | 'fleet-paged-attn' | 'fleet-prefill'
  label: string
  flopsG: number
  bytesG: number
  /** FLOPs per byte: `flopsG / bytesG`, written as the round figure the worksheet shows */
  ai: number
}

export const FLEET_KERNELS: readonly FleetKernel[] = [
  { id: 'fleet-router', label: 'router scoring', flopsG: 0.12, bytesG: 0.08, ai: 1.5 },
  { id: 'fleet-decode', label: '70B decode · b32', flopsG: 4480, bytesG: 140, ai: 32 },
  { id: 'fleet-paged-attn', label: 'paged attention · prefill chunk', flopsG: 2048, bytesG: 8, ai: 256 },
  { id: 'fleet-prefill', label: '70B prefill · 512', flopsG: 71_680, bytesG: 140, ai: 512 },
]

export const fleetKernel = (id: string): FleetKernel | undefined => FLEET_KERNELS.find((k) => k.id === id)

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
  /** `roof.occupancy`: the warps per SM whose register limit is reported. */
  occupancy: { warps: 16 },
  /** `roof.coalesce`, `roof.bank`, `roof.tiers` and `roof.pcie`: the bandwidths are the H100's. */
  access: { preset: 'H100' },
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
  /** "run serial comparison" was pressed. */
  | { type: 'serial' }
  /** "run map comparison" was pressed under an access pattern and an occupancy. */
  | { type: 'map'; pattern: AccessPattern; occupancyPct: number }
  /** A warp or register slider moved. */
  | { type: 'occupancy'; warps: number; registers: number }
  /** The access pattern or a bank-conflict switch changed, on a machine with this HBM bandwidth (GB/s). */
  | { type: 'access'; preset: string; bw: number; pattern: AccessPattern; bankConflict: boolean; bankPadding: boolean }
  /** The working-set sweep has been through the shared, L2 and HBM tiers. */
  | { type: 'tiers'; preset: string; bw: number }
  /** The CPU→GPU PCIe transfer was switched on. */
  | { type: 'pcie'; preset: string; bw: number }
  /** A row of the Fleet worksheet was placed on the chart. */
  | { type: 'fleet'; kernel: string; preset: string; dtype: Dtype }

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
    case 'serial':
      return [obs('roof.cpu-serial', serialSpeedup(), '×')]
    case 'map': {
      // the clean map is graded with the register file not limiting the warps, the divergent one on the same terms
      const throughput = Math.min(1, e.occupancyPct / 25)
      if (throughput < 1) return []
      if (e.pattern === 'coalesced') return [obs('roof.gpu-map', mapSpeedup(coalesceFactor('coalesced'), throughput), '×')]
      if (e.pattern === 'divergent') return [obs('roof.gpu-divergence', mapSpeedup(coalesceFactor('divergent'), throughput), '×')]
      return []
    }
    case 'occupancy':
      return e.warps === SETUP.occupancy.warps && occupancyModel(e.warps, e.registers).pct < 25
        ? [obs('roof.occupancy', maxRegistersFor(e.warps), 'registers')]
        : []
    case 'access': {
      if (e.preset !== SETUP.access.preset || e.pattern !== 'staged') return []
      if (!e.bankConflict) return [obs('roof.coalesce', stagedPercent(e.bw), '%')]
      return e.bankPadding ? [obs('roof.bank', paddingGain(e.bw), '×')] : []
    }
    case 'tiers':
      return e.preset === SETUP.access.preset ? [obs('roof.tiers', sharedOverHbm(e.bw), '×')] : []
    case 'pcie':
      return e.preset === SETUP.access.preset ? [obs('roof.pcie', hbmOverPcie(e.bw), '×')] : []
    case 'fleet': {
      const k = fleetKernel(e.kernel)
      return k !== undefined && e.preset === SETUP.ridge.preset && e.dtype === SETUP.ridge.dtype ? [obs(`roof.${k.id}`, k.ai, 'FLOP/B')] : []
    }
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

const ms = (v: number): string => `${Number(v.toPrecision(3))} ms`
const gbs = (v: number): string => (v >= 1000 ? fmtTBs(v) : `${Number(v.toPrecision(3))} GB/s`)

/** The CPU against the GPU on a dependent chain. */
function cpuSerial(): CanonicalOutcome {
  const { cpuSerialMs: cpu, gpuSerialMs: gpu } = CPU_GPU
  const ratio = serialSpeedup()
  return {
    actual: ratio,
    unit: '×',
    summary: `On a chain of dependent operations the CPU needs ${ms(cpu)} and the GPU ${ms(gpu)}: the CPU is ${fmtAI(ratio)}× faster.`,
    chart: {
      kind: 'bars',
      xLabel: 'machine',
      yLabel: 'time (ms)',
      points: [
        { x: 'CPU', y: cpu, label: 'CPU' },
        { x: 'GPU', y: gpu, label: 'GPU' },
      ],
      mark: 0,
      logY: true,
    },
    table: {
      caption: 'A serial dependency chain on one CPU core and on the GPU (synthetic timings)',
      columns: ['machine', 'time'],
      rows: [
        ['CPU', ms(cpu)],
        ['GPU', ms(gpu)],
        ['CPU speedup', `${fmtAI(ratio)}×`],
      ],
    },
  }
}

/** The GPU against the CPU on the 64M-element map, for the access patterns that are graded. */
function mapOutcome(pattern: 'coalesced' | 'divergent'): () => CanonicalOutcome {
  return () => {
    const clean = gpuMapMs(coalesceFactor('coalesced'), 1)
    const rows: { x: string; y: number }[] = [
      { x: 'CPU', y: CPU_GPU.cpuMapMs },
      { x: 'GPU coalesced', y: clean },
    ]
    if (pattern === 'divergent') rows.push({ x: 'GPU divergent', y: gpuMapMs(coalesceFactor('divergent'), 1) })
    const speed = mapSpeedup(coalesceFactor(pattern), 1)
    const last = rows.length - 1
    return {
      actual: speed,
      unit: '×',
      summary:
        pattern === 'coalesced'
          ? `On a map over 64M independent elements the GPU needs ${ms(clean)} against the CPU's ${ms(CPU_GPU.cpuMapMs)}: ${fmtAI(speed)}× faster.`
          : `When the lanes of a warp take different branches the GPU keeps an eighth of its throughput: ${ms(rows[last].y)} against the CPU's ${ms(CPU_GPU.cpuMapMs)}, still ${fmtAI(speed)}× faster.`,
      chart: { kind: 'bars', xLabel: 'machine', yLabel: 'time (ms)', points: rows.map((r) => ({ x: r.x, y: r.y, label: r.x })), mark: last, logY: true },
      table: {
        caption: 'A 64M-element map on the CPU and on the GPU (synthetic timings)',
        columns: ['machine', 'time', 'speedup over CPU'],
        rows: rows.map((r) => [r.x, ms(r.y), `${fmtAI(CPU_GPU.cpuMapMs / r.y)}×`]),
      },
    }
  }
}

const OCC_REGISTERS = [32, 64, 96, 128, 160, 192, 255]

/** Occupancy of 16 warps per SM as the registers per thread grow. */
function occupancyOutcome(): CanonicalOutcome {
  const warps = SETUP.occupancy.warps
  const limit = maxRegistersFor(warps)
  const occ = (r: number) => occupancyModel(warps, r)
  return {
    actual: limit,
    unit: 'registers',
    summary: `${REG_FILE_REGS.toLocaleString('en-US')} registers hold ${warps} warps of ${WARP_THREADS} threads up to ${limit} registers per thread; past that occupancy drops below ${Math.round((warps / MAX_WARP_SLOTS) * 100)}%.`,
    chart: {
      kind: 'bars',
      xLabel: 'registers per thread',
      yLabel: 'occupancy (%)',
      points: OCC_REGISTERS.map((r) => ({ x: r, y: occ(r).pct, label: `${r} regs` })),
      mark: OCC_REGISTERS.indexOf(limit),
    },
    table: {
      caption: `Occupancy of ${warps} requested warps per SM by registers per thread`,
      columns: ['registers per thread', 'resident warps', 'occupancy'],
      rows: OCC_REGISTERS.map((r) => [r, occ(r).resident, `${occ(r).pct}%`]),
    },
  }
}

const PATTERNS: AccessPattern[] = ['coalesced', 'strided', 'divergent', 'staged']

/** What each access pattern delivers on the H100. */
function coalesceOutcome(): CanonicalOutcome {
  const bw = MACHINES.h100.bw
  const pct = stagedPercent(bw)
  const got = (p: AccessPattern) => accessResult(p, bw, false, false).effectiveBandwidth
  return {
    actual: pct,
    unit: '%',
    summary: `Staging the strided load through shared memory restores a coalesced global read, and the extra shared-memory traffic leaves ${fmtAI(pct)}% of the H100's ${fmtTBs(bw)}.`,
    chart: {
      kind: 'bars',
      xLabel: 'access pattern',
      yLabel: 'delivered GB/s',
      points: PATTERNS.map((p) => ({ x: p === 'staged' ? 'shared transpose' : p, y: got(p), label: p })),
      mark: PATTERNS.indexOf('staged'),
      logY: true,
    },
    table: {
      caption: `Delivered bandwidth by access pattern on the H100 (HBM ${fmtTBs(bw)})`,
      columns: ['access pattern', 'delivered', 'share of HBM'],
      rows: PATTERNS.map((p) => [p === 'staged' ? 'shared transpose' : p, gbs(got(p)), `${fmtAI((100 * got(p)) / bw)}%`]),
    },
  }
}

/** The shared-memory transpose clean, with a 32-way bank conflict, and padded. */
function bankOutcome(): CanonicalOutcome {
  const bw = MACHINES.h100.bw
  const gain = paddingGain(bw)
  const steps = [
    { x: 'no conflict', r: accessResult('staged', bw, false, false) },
    { x: '32-way conflict', r: accessResult('staged', bw, true, false) },
    { x: 'padded', r: accessResult('staged', bw, true, true) },
  ]
  return {
    actual: gain,
    unit: '×',
    summary: `A 32-way bank conflict serialises the shared-memory half of the transpose; one column of padding gives ${fmtAI(gain)}× the bandwidth back, not 32×, because the global load was never slowed.`,
    chart: { kind: 'bars', xLabel: 'shared-memory layout', yLabel: 'delivered GB/s', points: steps.map((s) => ({ x: s.x, y: s.r.effectiveBandwidth, label: s.x })), mark: 2, logY: true },
    table: {
      caption: `A staged transpose on the H100 by shared-memory layout (HBM ${fmtTBs(bw)})`,
      columns: ['layout', 'shared banks', 'delivered'],
      rows: steps.map((s) => [s.x, `${Math.round((s.r.sharedEfficiency ?? 1) * 100)}% efficient`, gbs(s.r.effectiveBandwidth)]),
    },
  }
}

/** The bandwidth of each tier the working-set sweep passes through. */
function tiersOutcome(): CanonicalOutcome {
  const bw = MACHINES.h100.bw
  const ratio = sharedOverHbm(bw)
  const tiers = [
    { x: 'shared', y: SHARED_BW_GBS },
    { x: 'L2', y: L2_BW_GBS },
    { x: 'HBM', y: bw },
  ]
  return {
    actual: ratio,
    unit: '×',
    summary: `Sweeping the working set from a few KiB to many GiB steps down from shared memory (${fmtTBs(SHARED_BW_GBS)}) through L2 to HBM (${fmtTBs(bw)}): shared memory is ${fmtAI(ratio)}× faster.`,
    chart: { kind: 'bars', xLabel: 'tier', yLabel: 'bandwidth (GB/s)', points: tiers.map((t) => ({ x: t.x, y: t.y, label: t.x })), mark: 0, logY: true },
    table: {
      caption: 'Memory-tier bandwidth on the H100 (synthetic shared and L2 figures)',
      columns: ['tier', 'bandwidth', 'versus HBM'],
      rows: tiers.map((t) => [t.x, gbs(t.y), `${fmtAI(t.y / bw)}×`]),
    },
  }
}

/** HBM streaming against a PCIe transfer. */
function pcieOutcome(): CanonicalOutcome {
  const bw = MACHINES.h100.bw
  const ratio = hbmOverPcie(bw)
  return {
    actual: ratio,
    unit: '×',
    summary: `A PCIe x16 Gen4 transfer moves ${gbs(PCIE_BW_GBS)} against HBM's ${fmtTBs(bw)}: ${fmtAI(ratio)}× slower, the offload cliff.`,
    chart: {
      kind: 'bars',
      xLabel: 'path',
      yLabel: 'bandwidth (GB/s)',
      points: [
        { x: 'HBM', y: bw, label: 'HBM' },
        { x: 'PCIe', y: PCIE_BW_GBS, label: 'PCIe' },
      ],
      mark: 1,
      logY: true,
    },
    table: {
      caption: 'HBM streaming against a CPU→GPU PCIe transfer, H100',
      columns: ['path', 'bandwidth'],
      rows: [
        ['HBM', gbs(bw)],
        ['PCIe x16 Gen4', gbs(PCIE_BW_GBS)],
        ['HBM ÷ PCIe', `${fmtAI(ratio)}×`],
      ],
    },
  }
}

/** One Fleet worksheet row against the B200's ridge. */
function fleetOutcome(id: FleetKernel['id']): () => CanonicalOutcome {
  return () => {
    const k = fleetKernel(id)!
    const m = MACHINES.b200
    const ridge = ridgeAI(m, SETUP.ridge.dtype)
    const bound = boundOf(k.ai, ridge)
    return {
      actual: k.ai,
      unit: 'FLOP/B',
      summary: `${k.label} does ${k.flopsG.toLocaleString('en-US')} GFLOP over ${k.bytesG.toLocaleString('en-US')} GB: ${fmtAI(k.ai)} FLOP/B against the B200's ridge of ${fmtAI(ridge)}, so it is ${bound}-bound.`,
      chart: {
        kind: 'bars',
        xLabel: 'kernel',
        yLabel: 'FLOP/B',
        points: [
          { x: k.label, y: k.ai, label: k.label },
          { x: 'B200 ridge', y: ridge, label: 'B200 ridge' },
        ],
        mark: 0,
        logY: true,
      },
      table: {
        caption: `${k.label} against the B200 ridge, FP16`,
        columns: ['quantity', 'value'],
        rows: [
          ['GFLOP', k.flopsG.toLocaleString('en-US')],
          ['GB moved', k.bytesG.toLocaleString('en-US')],
          ['FLOP/B', fmtAI(k.ai)],
          ['B200 ridge', fmtAI(ridge)],
          ['bound by', bound],
        ],
      },
    }
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
  'cpu-serial': cpuSerial,
  'gpu-map': mapOutcome('coalesced'),
  'gpu-divergence': mapOutcome('divergent'),
  occupancy: occupancyOutcome,
  coalesce: coalesceOutcome,
  bank: bankOutcome,
  tiers: tiersOutcome,
  pcie: pcieOutcome,
  'fleet-router': fleetOutcome('fleet-router'),
  'fleet-decode': fleetOutcome('fleet-decode'),
  'fleet-paged-attn': fleetOutcome('fleet-paged-attn'),
  'fleet-prefill': fleetOutcome('fleet-prefill'),
}
