/**
 * SIM-04 `sim-roofline` — Roofline Model Playground (playground.md §7).
 * Hand-rolled canvas log-log chart: bandwidth roof + compute ceiling meeting at
 * the ridge point. Hardware presets, quantized ceilings, a plottable kernel
 * library, and four live extensions:
 *
 *   1. Occupancy: warps/SM and registers/thread sliders with a synthetic
 *      occupancy limiter (register-file budget per SM).
 *   2. Coalescing / bank conflicts: access-pattern toggle that changes
 *      effective bytes per warp load, plus a shared-memory 32-way conflict demo
 *      with a padding fix.
 *   3. Memory tier probe: working-set slider that steps across shared memory,
 *      L2, and HBM bandwidths, plus a PCIe transfer mode.
 *   4. Matmul tiling + attention: tile-size sweep with AI = T/2 (FP16), and a naive
 *      vs FlashAttention toggle. The tile's residency (CTAs per SM) is the Tiling Cube's
 *      (src/lib/world/tiling.ts: shared memory for the slabs at k = 64 and 2 stages, and the
 *      accumulators' registers, in FP16), so the sim, the cube and the generated items agree.
 *
 * Documented constants (synthetic but dimensionally faithful; the pure ones live in
 * src/lib/sims/models/roofline.ts):
 *   - register file: 256 KiB/SM  = 65,536 32-bit registers
 *   - max warp slots: 64/SM
 *   - shared memory: 228 KiB/SM
 *   - H100-class HBM: 3.35 TB/s
 *   - L2 bandwidth: ~12 TB/s
 *   - shared memory bandwidth: ~20 TB/s
 *   - PCIe x16 Gen4: ~32 GB/s
 *
 * Under a SimHost the eighteen outcome tasks of roofline.tasks.ts are graded on what this sim reports through
 * `useObserve` (the rules live in src/lib/sims/models/roofline.ts); the chart has a DOM mirror (SimMirror).
 * No task is detected from a state any more: each handler below reports what the learner just did.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Eraser, TrendingUp } from 'lucide-react'
import PlaygroundShell, {
  ChipButton,
  ControlGroup,
  InlineQuiz,
  LogConsole,
  SliderRow,
  TransportBar,
  useInitialCfg,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
  useSimMachine,
  useWriteCfg,
} from '@/components/sims/PlaygroundShell'
import SimMirror from '@/components/sims/SimMirror'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useObserve } from '@/lib/sims/host'
import {
  BATCH_STEPS,
  CPU_GPU,
  FLEET_KERNELS,
  MACHINES,
  MAX_WARP_SLOTS,
  PRESETS,
  TILE_CHOICES,
  accessResult,
  announceAttention,
  announceDecode,
  announceKernel,
  announceMachine,
  announceTile,
  attentionAI as attentionAIOf,
  attentionBytes as attentionBytesOf,
  attainable,
  decodeAI as decodeAIOf,
  dtypeLabel,
  dtypeMultiplier,
  fmtAI,
  fmtRate,
  gpuMapMs,
  matmulAI,
  mirrorTable,
  observationsFor,
  occupancyModel,
  ridgeAI as ridgeAIOf,
  tierBandwidth,
  tierName,
  tileOccupancyFactor,
} from '@/lib/sims/models/roofline'
import type { AccessPattern, AttentionMode, Dtype, FleetKernel, MemoryPath, RooflineEvent } from '@/lib/sims/models/roofline'
import { BASE, ctasPerSm, smemBytes } from '@/lib/world/tiling'

const SIM_ID = 'sim-roofline'

interface KernelDef {
  id: string
  label: string
  ai: number // FLOPs/byte
  frac: number // achieved fraction of the roof
  color: string
}

const KERNELS: KernelDef[] = [
  { id: 'vadd', label: 'vector add', ai: 0.15, frac: 0.82, color: '#5CA8FF' },
  { id: 'decode', label: 'decode @ 70B', ai: 1, frac: 0.9, color: '#FB7185' },
  { id: 'flash', label: 'attention flash', ai: 60, frac: 0.75, color: '#22D3EE' },
  { id: 'prefill', label: 'prefill @ 70B', ai: 400, frac: 0.9, color: '#A78BFA' },
  { id: 'matmul', label: 'matmul-tiled', ai: 512, frac: 0.88, color: '#3EF2A4' },
]

/** How each row of the B200 Fleet worksheet (FLEET_KERNELS in the model) is drawn once it is placed. */
const FLEET_STYLE: Record<FleetKernel['id'], { frac: number; color: string }> = {
  'fleet-router': { frac: 0.72, color: '#FBBF24' },
  'fleet-decode': { frac: 0.82, color: '#FB7185' },
  'fleet-paged-attn': { frac: 0.78, color: '#22D3EE' },
  'fleet-prefill': { frac: 0.88, color: '#A78BFA' },
}

const FLEET_DEFS: KernelDef[] = FLEET_KERNELS.map((k) => ({ id: k.id, label: k.label, ai: k.ai, ...FLEET_STYLE[k.id] }))

const ALL_KERNELS: KernelDef[] = [...KERNELS, ...FLEET_DEFS]

const X_MIN = -7 // log2 FLOPs/byte
const X_MAX = 10
const Y_MIN = 7 // log2 GFLOP/s
const Y_MAX = 22

const fmtBandwidth = (gbs: number): string =>
  gbs >= 1000 ? `${(gbs / 1000).toFixed(1)} TB/s` : `${gbs.toFixed(gbs >= 100 ? 0 : 1)} GB/s`

const fmtYTick = (p: number): string => {
  const v = 2 ** p
  if (v >= 1_048_576) return `${Math.round(v / 1_048_576)}M`
  if (v >= 1024) return `${Math.round(v / 1024)}K`
  return String(v)
}

const fmtXT = (p: number): string => {
  const v = 2 ** p
  return v >= 1 ? String(v) : v.toPrecision(1)
}

const fmtBytes = (b: number): string => {
  if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GiB`
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MiB`
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KiB`
  return `${b} B`
}

/** The cube's scene (k = 64, 2 stages, FP16) for a square tile of side T: the tiling panel reads its residency from it. */
const tileScene = (T: number) => ({ ...BASE, tm: T, tn: T })

interface RoofCfg {
  m: string // preset name
  bw: number
  peak: number
  batch: number
  dtype: Dtype
  guide: number // log2 AI
  warps: number
  registers: number
  accessPattern: AccessPattern
  bankConflict: boolean
  bankPadding: boolean
  workingSetKb: number
  memoryPath: MemoryPath
  pcieMode: boolean
  tileT: number
  attentionMode: AttentionMode
  serialRan: boolean
  mapRan: boolean
}

type StoredRoofCfg = Partial<RoofCfg> & { quant?: boolean }

const finiteOr = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback

const oneOfOr = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback
const numberOneOfOr = (
  value: unknown,
  options: readonly number[],
  fallback: number,
): number => (typeof value === 'number' && options.includes(value) ? value : fallback)

interface PlottedPoint {
  kernelId: string
  at: number // ms timestamp for pop animation
}


type HostMode = 'roofline' | 'cpu-gpu'

export default function RooflineSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()
  const { machine, from, selectMachine: selectMode } = useSimMachine()
  const mode: HostMode =
    machine === 'cpu-gpu' || (machine !== 'roofline' && from === 't4.l1') ? 'cpu-gpu' : 'roofline'
  const observe = useObserve()
  const mirrorId = useId()
  // Discrete results for the mirror's live region; SimMirror speaks them at most once a second.
  const [announce, setAnnounce] = useState('')

  const initialCfg = useInitialCfg<StoredRoofCfg>()
  const initialPreset = PRESETS.find((p) => p.name === initialCfg?.m) ?? PRESETS[3]
  const initialDtype =
    initialCfg?.dtype === undefined && initialCfg?.quant === true
      ? 'fp8'
      : oneOfOr(initialCfg?.dtype, ['fp16', 'fp8', 'int4'] as const, 'fp16')
  const initialBankConflict = initialCfg?.bankConflict === true

  const [preset, setPreset] = useState<string>(initialPreset.name)
  const [bw, setBw] = useState(() => finiteOr(initialCfg?.bw, initialPreset.bw, 1, 100_000))
  const [peak, setPeak] = useState(() =>
    finiteOr(initialCfg?.peak, initialPreset.peak, 1, 10_000_000),
  )
  const [batch, setBatch] = useState(() => finiteOr(initialCfg?.batch, 1, 1, 512))
  const [dtype, setDtype] = useState<Dtype>(initialDtype)
  const [guide, setGuide] = useState(() => finiteOr(initialCfg?.guide, 0, X_MIN, X_MAX))
  const [points, setPoints] = useState<PlottedPoint[]>([])
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [serialRan, setSerialRan] = useState(initialCfg?.serialRan === true)
  const [mapRan, setMapRan] = useState(initialCfg?.mapRan === true)

  /* ------------------------------- extensions ------------------------------- */
  const [warpsPerSM, setWarpsPerSM] = useState(() =>
    finiteOr(initialCfg?.warps, 16, 1, MAX_WARP_SLOTS),
  )
  const [regPerThread, setRegPerThread] = useState(() =>
    finiteOr(initialCfg?.registers, 32, 8, 256),
  )

  const [accessPattern, setAccessPattern] = useState<AccessPattern>(
    oneOfOr(
      initialCfg?.accessPattern,
      ['coalesced', 'strided', 'divergent', 'staged'] as const,
      'coalesced',
    ),
  )
  const [bankConflict, setBankConflict] = useState(initialBankConflict)
  const [bankPadding, setBankPadding] = useState(
    initialBankConflict && initialCfg?.bankPadding === true,
  )

  const [workingSetKb, setWorkingSetKb] = useState(() =>
    finiteOr(initialCfg?.workingSetKb, 4, 4, 2 ** 27),
  )
  const [memoryPath, setMemoryPath] = useState<MemoryPath>(
    oneOfOr(initialCfg?.memoryPath, ['auto', 'shared', 'hbm'] as const, 'auto'),
  )
  const [pcieMode, setPcieMode] = useState(initialCfg?.pcieMode === true)

  const [tileT, setTileT] = useState(() => numberOneOfOr(initialCfg?.tileT, TILE_CHOICES, 16))
  const [attentionMode, setAttentionMode] = useState<AttentionMode>(
    oneOfOr(initialCfg?.attentionMode, ['naive', 'flash'] as const, 'naive'),
  )

  const ticksRef = useRef(0)
  const [ticks, setTicks] = useState(0)
  const bump = useCallback(() => {
    ticksRef.current += 1
    setTicks(ticksRef.current)
    return ticksRef.current
  }, [])

  useWriteCfg({
    m: preset,
    bw,
    peak,
    batch,
    dtype,
    guide,
    warps: warpsPerSM,
    registers: regPerThread,
    accessPattern,
    bankConflict,
    bankPadding,
    workingSetKb,
    memoryPath,
    pcieMode,
    tileT,
    attentionMode,
    serialRan,
    mapRan,
  } satisfies RoofCfg)

  /* animated (morphing) machine values */
  const animRef = useRef({ bw: initialPreset.bw, peak: initialPreset.peak })
  const targetRef = useRef({ bw: initialPreset.bw, peak: initialPreset.peak })
  useEffect(() => {
    targetRef.current = { bw, peak }
  }, [bw, peak])
  const ridgeAI = ridgeAIOf({ bw, peak }, dtype)
  const guideAI = 2 ** guide
  const guideBound: 'bandwidth' | 'compute' = guideAI < ridgeAI ? 'bandwidth' : 'compute'

  // Decode performs the same FLOPs while lower precision reads fewer weight bytes.
  const decodeAI = decodeAIOf(batch, dtype)
  const decodePlotted = points.some((p) => p.kernelId === 'decode')

  /* --------------------------- derived extension model ---------------------- */
  const { pct: occupancyPct, spill: regSpill, resident: residentWarps } = occupancyModel(
    warpsPerSM,
    regPerThread,
  )
  const occupancyLow = occupancyPct < 25

  const access = accessResult(accessPattern, bw, bankConflict, bankPadding)
  const coalesceEff = access.globalEfficiency
  const effectiveHbmBw = access.effectiveBandwidth
  const accessThroughputFactor = effectiveHbmBw / bw
  const occupancyThroughput = Math.min(1, occupancyPct / 25)
  const { cpuSerialMs, gpuSerialMs, cpuMapMs } = CPU_GPU
  const gpuMapTime = gpuMapMs(accessThroughputFactor, occupancyThroughput)

  const tierBw = tierBandwidth(workingSetKb, pcieMode, memoryPath, regSpill, bw)
  const tier = tierName(workingSetKb, pcieMode, memoryPath, regSpill)

  // the tiling panel: the throughput factor is the cube's residency (CTAs per SM) at this tile
  const tileAI = matmulAI(tileT)
  const tileCtas = ctasPerSm(tileScene(tileT))
  const tileSmemBytes = smemBytes(tileScene(tileT))
  const tileOccFactor = tileOccupancyFactor(tileCtas)

  const attentionAI = attentionAIOf(attentionMode)
  const attentionBytes = attentionBytesOf(attentionMode)

  /* The eighteen outcome tasks (roofline.tasks.ts) are graded on what a learner's action reports, not on a state
     the sim detects: each handler below calls `report` with what the learner just did. */
  const report = useCallback(
    (event: RooflineEvent) => {
      for (const o of observationsFor(event)) observe(o)
    },
    [observe],
  )

  // the tiers the working-set sweep has been through (HBM and a register spill count as one), starting from where it opened
  const sawTiersRef = useRef(new Set([tier === 'HBM spill' ? 'HBM' : tier]))
  const touchTier = useCallback(
    (name: string) => {
      const saw = sawTiersRef.current
      saw.add(name === 'HBM spill' ? 'HBM' : name)
      if (saw.has('shared') && saw.has('L2') && saw.has('HBM')) report({ type: 'tiers', preset, bw })
    },
    [bw, preset, report],
  )

  /* ------------------------------ plotting ------------------------------ */
  const plotKernel = useCallback(
    (k: KernelDef) => {
      bump()
      setPoints((prev) => {
        if (prev.some((p) => p.kernelId === k.id)) return prev
        return [...prev, { kernelId: k.id, at: performance.now() }]
      })
      const ai = k.id === 'decode' ? decodeAI : k.ai
      const dtypePeak = peak * dtypeMultiplier(dtype)
      const roof = Math.min(dtypePeak, bw * ai)
      const bound = ai < dtypePeak / bw ? 'bandwidth-bound' : 'compute-bound'
      log(
        ticksRef.current,
        'PLOT',
        `${k.label} — AI ${fmtAI(ai)} → ${fmtRate(k.frac * roof)} (${bound})`,
        k.id === 'decode' || k.id === 'prefill' ? 'warn' : 'ok',
      )
      setAnnounce(
        k.id === 'decode'
          ? announceDecode({ bw, peak }, dtype, batch)
          : announceKernel(k.label, ai, dtypePeak / bw),
      )
      if (k.id === 'decode') report({ type: 'plot-decode', preset, dtype, batch })
    },
    [batch, bump, bw, decodeAI, dtype, log, peak, preset, report],
  )

  const applyPreset = useCallback(
    (name: string) => {
      const m = PRESETS.find((p) => p.name === name)
      if (!m) return
      setPreset(name)
      setBw(m.bw)
      setPeak(m.peak)
      log(
        ticksRef.current,
        'PRESET',
        `${m.name} — ${m.bw} GB/s HBM · ${fmtRate(m.peak)} peak`,
      )
      setAnnounce(announceMachine(m.name, m, dtype))
      report({ type: 'machine', preset: name, dtype })
    },
    [dtype, log, report],
  )

  const chooseDtype = useCallback(
    (next: Dtype) => {
      setDtype(next)
      setAnnounce(announceMachine(preset, { bw, peak }, next))
      report({ type: 'machine', preset, dtype: next })
    },
    [bw, peak, preset, report],
  )

  const chooseBatch = useCallback(
    (next: number) => {
      setBatch(next)
      if (decodePlotted) setAnnounce(announceDecode({ bw, peak }, dtype, next))
      report({ type: 'batch', preset, dtype, batch: next, decodePlotted })
    },
    [bw, decodePlotted, dtype, peak, preset, report],
  )

  const chooseTile = useCallback(
    (next: number) => {
      setTileT(next)
      setAnnounce(announceTile(next))
      report({ type: 'tile', tile: next })
    },
    [report],
  )

  const chooseAttention = useCallback(
    (next: AttentionMode) => {
      setAttentionMode(next)
      setAnnounce(announceAttention(next))
      report({ type: 'attention', mode: next })
    },
    [report],
  )

  /* The CPU/GPU demo: each press reports its timings, and the map is graded under the pattern and occupancy it ran with. */
  const runSerial = useCallback(() => {
    setSerialRan(true)
    log(ticksRef.current, 'COMPARE', 'serial chain — CPU wins latency by 50×', 'ok')
    report({ type: 'serial' })
  }, [log, report])

  const runMap = useCallback(
    (pattern: AccessPattern, occupancyPct: number, summary: string) => {
      setMapRan(true)
      log(ticksRef.current, 'COMPARE', summary, pattern === 'coalesced' || pattern === 'staged' ? 'ok' : 'warn')
      report({ type: 'map', pattern, occupancyPct })
    },
    [log, report],
  )

  /* Occupancy and registers: the sliders report the limit once occupancy shows below 25%. */
  const chooseWarps = useCallback(
    (next: number) => {
      setWarpsPerSM(next)
      touchTier(tierName(workingSetKb, pcieMode, memoryPath, occupancyModel(next, regPerThread).spill))
      report({ type: 'occupancy', warps: next, registers: regPerThread })
    },
    [memoryPath, pcieMode, regPerThread, report, touchTier, workingSetKb],
  )

  const chooseRegisters = useCallback(
    (next: number) => {
      setRegPerThread(next)
      touchTier(tierName(workingSetKb, pcieMode, memoryPath, occupancyModel(warpsPerSM, next).spill))
      report({ type: 'occupancy', warps: warpsPerSM, registers: next })
    },
    [memoryPath, pcieMode, report, touchTier, warpsPerSM, workingSetKb],
  )

  /* Access pattern and bank conflicts: the staged transpose is graded without a conflict, and again once padding fixes one. */
  const reportAccess = useCallback(
    (pattern: AccessPattern, conflict: boolean, padding: boolean) =>
      report({ type: 'access', preset, bw, pattern, bankConflict: conflict, bankPadding: padding }),
    [bw, preset, report],
  )

  const choosePattern = useCallback(
    (next: AccessPattern) => {
      setAccessPattern(next)
      reportAccess(next, bankConflict, bankPadding)
    },
    [bankConflict, bankPadding, reportAccess],
  )

  const chooseConflict = useCallback(
    (on: boolean) => {
      setBankConflict(on)
      if (!on) setBankPadding(false)
      reportAccess(accessPattern, on, on && bankPadding)
    },
    [accessPattern, bankPadding, reportAccess],
  )

  const choosePadding = useCallback(
    (on: boolean) => {
      setBankPadding(on)
      reportAccess(accessPattern, bankConflict, on)
    },
    [accessPattern, bankConflict, reportAccess],
  )

  /* The memory tier probe: the sweep is reported once it has been through shared memory, L2 and HBM. */
  const chooseWorkingSet = useCallback(
    (log2Kb: number) => {
      const next = 2 ** log2Kb
      setWorkingSetKb(next)
      touchTier(tierName(next, pcieMode, memoryPath, occupancyModel(warpsPerSM, regPerThread).spill))
    },
    [memoryPath, pcieMode, regPerThread, touchTier, warpsPerSM],
  )

  const chooseMemoryPath = useCallback(
    (next: MemoryPath) => {
      setMemoryPath(next)
      touchTier(tierName(workingSetKb, pcieMode, next, occupancyModel(warpsPerSM, regPerThread).spill))
    },
    [pcieMode, regPerThread, touchTier, warpsPerSM, workingSetKb],
  )

  const choosePcie = useCallback(
    (on: boolean) => {
      setPcieMode(on)
      touchTier(tierName(workingSetKb, on, memoryPath, occupancyModel(warpsPerSM, regPerThread).spill))
      if (on) report({ type: 'pcie', preset, bw })
    },
    [bw, memoryPath, preset, regPerThread, report, touchTier, warpsPerSM, workingSetKb],
  )

  /* The B200 Fleet table: placing a row switches to the B200 at FP16, plots the kernel and reports its intensity. */
  const placeFleet = useCallback(
    (k: FleetKernel) => {
      bump()
      const b200 = MACHINES.b200
      setPreset(b200.name)
      setBw(b200.bw)
      setPeak(b200.peak)
      setDtype('fp16')
      setPoints((prev) => (prev.some((p) => p.kernelId === k.id) ? prev : [...prev, { kernelId: k.id, at: performance.now() }]))
      const ridge = ridgeAIOf(b200)
      log(ticksRef.current, 'PLOT', `${k.label} — AI ${fmtAI(k.ai)} on the ${b200.name}, ridge ${fmtAI(ridge)} (${k.ai < ridge ? 'bandwidth' : 'compute'}-bound)`, 'ok')
      setAnnounce(announceKernel(k.label, k.ai, ridge))
      report({ type: 'fleet', kernel: k.id, preset: b200.name, dtype: 'fp16' })
    },
    [bump, log, report],
  )

  const reset = useCallback(() => {
    setPoints([])
    setSerialRan(false)
    setMapRan(false)
    setBatch(1)
    setGuide(0)
    setDtype('fp16')
    setWarpsPerSM(16)
    setRegPerThread(32)
    setAccessPattern('coalesced')
    setBankConflict(false)
    setBankPadding(false)
    setWorkingSetKb(4)
    setMemoryPath('auto')
    setPcieMode(false)
    setTileT(16)
    setAttentionMode('naive')
    setPlaying(false)
    ticksRef.current = 0
    setTicks(0)
    sawTiersRef.current = new Set(['shared'])
    log(0, 'RESET', 'chart cleared — kernels unplotted')
  }, [log])

  /* transport: sweep the guide across intensities */
  const stepGuide = useCallback(() => {
    bump()
    setGuide((g) => {
      const next = g + 1
      return next > X_MAX ? X_MIN : next
    })
  }, [bump])

  const stepRef = useRef(stepGuide)
  useEffect(() => {
    stepRef.current = stepGuide
  }, [stepGuide])
  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => stepRef.current(), 500 / speed)
    return () => window.clearInterval(id)
  }, [playing, speed])

  /* ------------------------------ DOM mirror ------------------------------ */
  const mirror = mirrorTable({
    preset,
    bw,
    peak,
    dtype,
    guideAI,
    plotted: points.flatMap((p) => {
      const k = ALL_KERNELS.find((kk) => kk.id === p.kernelId)
      if (!k) return []
      const ai = k.id === 'decode' ? decodeAI : k.ai
      return [{ label: k.id === 'decode' && batch > 1 ? `${k.label} ×${batch}` : k.label, ai, attained: k.frac * attainable({ bw, peak }, dtype, ai) }]
    }),
    probes: [
      { label: `coalescing probe (${accessPattern})`, ai: 0.25, attained: 0.25 * effectiveHbmBw },
      { label: `tier probe (${tier})`, ai: 0.25, attained: 0.25 * tierBw },
      { label: `matmul tile T=${tileT}`, ai: tileAI, attained: attainable({ bw, peak }, dtype, tileAI) * tileOccFactor },
      { label: `${attentionMode} attention`, ai: attentionAI, attained: attainable({ bw, peak }, dtype, attentionAI) * 0.8 },
    ],
    announce,
  })

  /* ------------------------------ canvas ------------------------------ */
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({
    quant: dtype !== 'fp16',
    dtype,
    guide,
    points,
    batch,
    decodeAI,
    reducedMotion,
    preset,
    accessPattern,
    coalesceEff,
    effectiveHbmBw,
    accessThroughputFactor,
    tierBw,
    tier,
    workingSetKb,
    pcieMode,
    tileT,
    tileAI,
    tileOccFactor,
    attentionAI,
    attentionMode,
    occupancyPct,
  })
  useEffect(() => {
    stateRef.current = {
      quant: dtype !== 'fp16',
      dtype,
      guide,
      points,
      batch,
      decodeAI,
      reducedMotion,
      preset,
      accessPattern,
      coalesceEff,
      effectiveHbmBw,
      accessThroughputFactor,
      tierBw,
      tier,
      workingSetKb,
      pcieMode,
      tileT,
      tileAI,
      tileOccFactor,
      attentionAI,
      attentionMode,
      occupancyPct,
    }
  })

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let running = true
    let visible = true
    const shade = { bandwidth: 0.03, compute: 0.03 }

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = wrap.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
    })
    io.observe(wrap)
    const onVis = () => {
      running = !document.hidden
    }
    document.addEventListener('visibilitychange', onVis)

    const easeOutBack = (t: number) => {
      const c1 = 1.70158
      const c3 = c1 + 1
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
    }

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (!running || !visible) return
      const s = stateRef.current
      const anim = animRef.current
      const target = targetRef.current

      /* 400ms morph toward target machine values */
      if (s.reducedMotion) {
        anim.bw = target.bw
        anim.peak = target.peak
      } else {
        anim.bw += (target.bw - anim.bw) * 0.12
        anim.peak += (target.peak - anim.peak) * 0.12
        if (Math.abs(anim.bw - target.bw) < 0.5) anim.bw = target.bw
        if (Math.abs(anim.peak - target.peak) < 1) anim.peak = target.peak
      }

      const mult = dtypeMultiplier(s.dtype)
      const aBw = anim.bw
      const aPeak = anim.peak * mult
      const ridge = aPeak / aBw
      const logRidge = Math.log2(ridge)

      const w = canvas.width
      const h = canvas.height
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cw = w / dpr
      const ch = h / dpr
      ctx.clearRect(0, 0, cw, ch)

      const L = 56
      const R = 16
      const T = 16
      const B = 36
      const pw = cw - L - R
      const ph = ch - T - B
      const xMap = (lx: number) => L + ((lx - X_MIN) / (X_MAX - X_MIN)) * pw
      const yMap = (ly: number) => T + (1 - (ly - Y_MIN) / (Y_MAX - Y_MIN)) * ph
      const roofAt = (lx: number) => Math.min(Math.log2(aPeak), Math.log2(aBw) + lx)

      ctx.font = '10px "JetBrains Mono", ui-monospace, monospace'

      /* grid + tick labels */
      ctx.strokeStyle = '#1E2937'
      ctx.fillStyle = '#5D6B80'
      ctx.lineWidth = 1
      for (let p = X_MIN; p <= X_MAX; p += 1) {
        const x = xMap(p)
        ctx.globalAlpha = 0.6
        ctx.beginPath()
        ctx.moveTo(x, T)
        ctx.lineTo(x, T + ph)
        ctx.stroke()
        ctx.globalAlpha = 1
        if (p % 2 === 0) {
          ctx.textAlign = 'center'
          ctx.fillText(fmtXT(p), x, T + ph + 14)
        }
      }
      for (let p = Y_MIN; p <= Y_MAX; p += 1) {
        const y = yMap(p)
        ctx.globalAlpha = 0.6
        ctx.beginPath()
        ctx.moveTo(L, y)
        ctx.lineTo(L + pw, y)
        ctx.stroke()
        ctx.globalAlpha = 1
        if (p % 2 === 1) {
          ctx.textAlign = 'right'
          ctx.fillText(fmtYTick(p), L - 6, y + 3)
        }
      }

      /* region shading under the active bound */
      const gAI = 2 ** s.guide
      const gBound: 'bandwidth' | 'compute' = gAI < ridge ? 'bandwidth' : 'compute'
      shade.bandwidth += ((gBound === 'bandwidth' ? 0.09 : 0.03) - shade.bandwidth) * 0.15
      shade.compute += ((gBound === 'compute' ? 0.09 : 0.03) - shade.compute) * 0.15

      /* bandwidth region (under diagonal, left of ridge) */
      if (logRidge > X_MIN) {
        const xEnd = xMap(Math.min(logRidge, X_MAX))
        ctx.fillStyle = `rgba(255,178,36,${shade.bandwidth.toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(xMap(X_MIN), yMap(Y_MIN))
        ctx.lineTo(xMap(X_MIN), yMap(roofAt(X_MIN)))
        ctx.lineTo(xEnd, yMap(roofAt(Math.min(logRidge, X_MAX))))
        ctx.lineTo(xEnd, yMap(Y_MIN))
        ctx.closePath()
        ctx.fill()
      }
      /* compute region (under ceiling, right of ridge) */
      if (logRidge < X_MAX) {
        const xStart = xMap(Math.max(logRidge, X_MIN))
        ctx.fillStyle = `rgba(62,242,164,${shade.compute.toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(xStart, yMap(Y_MIN))
        ctx.lineTo(xStart, yMap(Math.log2(aPeak)))
        ctx.lineTo(xMap(X_MAX), yMap(Math.log2(aPeak)))
        ctx.lineTo(xMap(X_MAX), yMap(Y_MIN))
        ctx.closePath()
        ctx.fill()
      }

      /* the roofline */
      ctx.strokeStyle = '#E8EEF6'
      ctx.lineWidth = 2
      ctx.beginPath()
      let started = false
      for (let lx = X_MIN; lx <= X_MAX; lx += 0.05) {
        const ly = roofAt(lx)
        if (ly < Y_MIN) continue
        const x = xMap(lx)
        const y = yMap(ly)
        if (!started) {
          ctx.moveTo(x, y)
          started = true
        } else ctx.lineTo(x, y)
      }
      ctx.stroke()

      /* dtype ceiling label */
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1.5
      const ly = Math.log2(aPeak)
      if (ly <= Y_MAX) {
        ctx.strokeStyle = '#A78BFA'
        ctx.globalAlpha = 0.7
        ctx.beginPath()
        ctx.moveTo(xMap(X_MIN), yMap(ly))
        ctx.lineTo(xMap(X_MAX), yMap(ly))
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.fillStyle = '#A78BFA'
        ctx.textAlign = 'left'
        ctx.fillText(dtypeLabel(s.dtype), xMap(X_MIN) + 6, yMap(ly) - 5)
      }
      ctx.setLineDash([])

      /* base FP16 ceiling label (ghosted) */
      const baseLy = Math.log2(anim.peak)
      if (Math.abs(baseLy - ly) > 0.2 && baseLy <= Y_MAX) {
        ctx.setLineDash([3, 6])
        ctx.strokeStyle = '#5D6B80'
        ctx.globalAlpha = 0.35
        ctx.beginPath()
        ctx.moveTo(xMap(X_MIN), yMap(baseLy))
        ctx.lineTo(xMap(X_MAX), yMap(baseLy))
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
        ctx.fillStyle = '#5D6B80'
        ctx.textAlign = 'right'
        ctx.fillText(`FP16 base · ${fmtRate(anim.peak)}`, xMap(X_MAX) - 4, yMap(baseLy) - 6)
      }

      /* ridge marker */
      if (logRidge > X_MIN && logRidge < X_MAX) {
        ctx.fillStyle = '#E8EEF6'
        ctx.beginPath()
        ctx.arc(xMap(logRidge), yMap(Math.log2(aPeak)), 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#5D6B80'
        ctx.textAlign = 'left'
        ctx.fillText(`ridge ${fmtAI(ridge)} F/B`, xMap(logRidge) + 7, yMap(Math.log2(aPeak)) + 14)
      }

      /* guide */
      const gx = xMap(s.guide)
      const gRoof = roofAt(s.guide)
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#A3B0C2'
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(gx, T)
      ctx.lineTo(gx, T + ph)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.globalAlpha = 1
      ctx.fillStyle = gBound === 'bandwidth' ? '#FFB224' : '#3EF2A4'
      ctx.beginPath()
      ctx.arc(gx, yMap(gRoof), 4, 0, Math.PI * 2)
      ctx.fill()
      const readout = `${fmtAI(gAI)} F/B → ${fmtRate(Math.min(aPeak, aBw * gAI))}`
      const boundText = gBound === 'bandwidth' ? 'bound by: BANDWIDTH' : 'bound by: COMPUTE'
      const alignLeft = gx < cw - 190
      ctx.textAlign = alignLeft ? 'left' : 'right'
      const tx = alignLeft ? gx + 8 : gx - 8
      ctx.fillStyle = '#E8EEF6'
      ctx.fillText(readout, tx, T + 14)
      ctx.fillStyle = gBound === 'bandwidth' ? '#FFB224' : '#3EF2A4'
      ctx.fillText(boundText, tx, T + 27)

      /* plotted kernels */
      for (const p of s.points) {
        const k = ALL_KERNELS.find((kk) => kk.id === p.kernelId)
        if (!k) continue
        const ai = k.id === 'decode' ? s.decodeAI : k.ai
        const attained = k.frac * Math.min(aPeak, aBw * ai)
        const x = xMap(Math.log2(ai))
        const y = yMap(Math.log2(Math.max(attained, 2 ** Y_MIN)))
        const age = now - p.at
        const scale = s.reducedMotion ? 1 : age < 350 ? easeOutBack(age / 350) : 1
        ctx.save()
        ctx.shadowColor = k.color
        ctx.shadowBlur = k.id === 'decode' || k.id === 'prefill' ? 14 : 6
        ctx.fillStyle = k.color
        ctx.beginPath()
        ctx.arc(x, y, 5 * scale, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        ctx.fillStyle = '#07090D'
        ctx.beginPath()
        ctx.arc(x, y, 1.8 * scale, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = k.color
        ctx.textAlign = 'center'
        const label = k.id === 'decode' && s.batch > 1 ? `${k.label} ×${s.batch}` : k.label
        ctx.fillText(label, x, y - 11)
        ctx.fillStyle = '#5D6B80'
        ctx.fillText(fmtRate(attained), x, y + 16)
      }

      /* dynamic scenario points ------------------------------------------ */
      const drawPoint = (
        ai: number,
        attained: number,
        color: string,
        label: string,
        sublabel: string,
      ) => {
        const x = xMap(Math.log2(ai))
        const y = yMap(Math.log2(Math.max(attained, 2 ** Y_MIN)))
        ctx.save()
        ctx.shadowColor = color
        ctx.shadowBlur = 8
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
        ctx.fillStyle = '#07090D'
        ctx.beginPath()
        ctx.arc(x, y, 1.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = color
        ctx.textAlign = 'center'
        ctx.fillText(label, x, y - 10)
        ctx.fillStyle = '#5D6B80'
        ctx.fillText(sublabel, x, y + 17)
      }

      /* coalescing probe — memory-bound load */
      const coalesceAI = 0.25
      const coalesceAttained = coalesceAI * s.effectiveHbmBw
      drawPoint(
        coalesceAI,
        coalesceAttained,
        '#FBBF24',
        'mem-bound',
        `${(s.accessThroughputFactor * 100).toFixed(1)}% end-to-end`,
      )

      /* tier probe — low-intensity streaming load */
      const tierAI = 0.25
      const tierAttained = s.tierBw * tierAI
      drawPoint(tierAI, tierAttained, '#22D3EE', s.tier, fmtBandwidth(s.tierBw))

      /* tiled matmul point */
      const tileRoof = Math.min(aPeak, aBw * s.tileAI) * s.tileOccFactor
      drawPoint(
        s.tileAI,
        tileRoof,
        '#3EF2A4',
        `tile T=${s.tileT}`,
        `AI ${fmtAI(s.tileAI)} · occ ${(s.tileOccFactor * 100).toFixed(0)}%`,
      )

      /* attention point */
      const attentionRoof = Math.min(aPeak, aBw * s.attentionAI) * 0.8
      drawPoint(
        s.attentionAI,
        attentionRoof,
        '#A78BFA',
        s.attentionMode,
        `AI ${fmtAI(s.attentionAI)}`,
      )

      /* occupancy annotation near the bandwidth roof */
      if (s.occupancyPct < 60) {
        ctx.fillStyle = '#FF5C6C'
        ctx.textAlign = 'left'
        ctx.fillText(
          `low occupancy ${s.occupancyPct}% — latency hiding fails`,
          L + 6,
          yMap(Math.log2(aBw)) - 8,
        )
      }

      /* axis captions */
      ctx.fillStyle = '#5D6B80'
      ctx.textAlign = 'center'
      ctx.fillText('arithmetic intensity (FLOPs / byte) →', L + pw / 2, ch - 4)
      ctx.save()
      ctx.translate(12, T + ph / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText('attainable GFLOP/s →', 0, 0)
      ctx.restore()
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  /* ------------------------------ render ------------------------------ */
  return (
    <PlaygroundShell
      simId={SIM_ID}
      title="Roofline Model"
      subtitle="bandwidth roof · compute ceiling · the ridge point"
      help={
        <>
          <p>
            One chart, two walls. Attainable speed ={' '}
            <span className="font-mono text-text-1">min(peak FLOPs, bandwidth × intensity)</span>.
            Left of the ridge you starve on memory; right of it you starve on math. Kernel
            performance is whichever wall you hit first.
          </p>
          <p>
            <span className="font-mono text-[#FB7185]">decode</span> reads every weight per token —
            AI ≈ 1 FLOP/byte, deep in bandwidth land.{' '}
            <span className="font-mono text-[#A78BFA]">prefill</span> amortizes weights over the
            whole prompt — compute-bound. Batching moves decode right; quantization raises the
            ceiling. Tiling raises AI by staging reuse in SRAM; FlashAttention avoids materializing
            the N² score matrix.
          </p>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex gap-1 border-b border-line bg-surface-1 px-3 py-2">
          <ChipButton active={mode === 'cpu-gpu'} color="#5CA8FF" onClick={() => selectMode('cpu-gpu')}>
            CPU vs GPU
          </ChipButton>
          <ChipButton active={mode === 'roofline'} color="#A78BFA" onClick={() => selectMode('roofline')}>
            roofline lab
          </ChipButton>
        </div>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ------- stage + its data table ------- */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-[420px] flex-1 bg-ink bg-blueprint">
              <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
                <span className="flex items-center gap-1.5 rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                  <TrendingUp size={11} strokeWidth={1.75} className="text-accent" />
                  {preset} · {bw} GB/s · {fmtRate(peak)}
                </span>
                <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                  ridge @ {fmtAI(ridgeAI)} F/B
                </span>
                <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                  dtype {dtypeLabel(dtype)}
                </span>
              </div>
              {mode === 'cpu-gpu' && (
                <div className="absolute inset-x-4 bottom-4 top-12 z-20 flex flex-col justify-center gap-3">
                  <div className="rounded-sm border border-line bg-surface-1/95 p-4">
                    <p className="font-display text-base font-semibold text-text-1">Serial dependency chain</p>
                    <p className="mt-1 font-mono text-[11px] text-text-2">
                      Each operation depends on the previous result. GPU lanes cannot parallelize the chain,
                      and launch/synchronization overhead dominates.
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                      <div className="rounded-sm border border-[#5CA8FF44] p-2">CPU · {cpuSerialMs} ms</div>
                      <div className="rounded-sm border border-[#A78BFA44] p-2">GPU · {gpuSerialMs} ms</div>
                    </div>
                    <ChipButton
                      className="mt-3"
                      active={serialRan}
                      color="#5CA8FF"
                      onClick={runSerial}
                    >
                      run serial comparison
                    </ChipButton>
                    {serialRan && <p className="mt-2 font-mono text-[11px] text-[#5CA8FF]">CPU wins 50×</p>}
                  </div>
                  <div className="rounded-sm border border-line bg-surface-1/95 p-4">
                    <p className="font-display text-base font-semibold text-text-1">64M elementwise map</p>
                    <p className="mt-1 font-mono text-[11px] text-text-2">
                      64 million independent elements expose enough uniform work to fill GPU warps.
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
                      <div className="rounded-sm border border-[#5CA8FF44] p-2">CPU · {cpuMapMs} ms</div>
                      <div className="rounded-sm border border-[#A78BFA44] p-2">GPU · {gpuMapTime.toFixed(2)} ms</div>
                    </div>
                    <ChipButton
                      className="mt-3"
                      active={mapRan}
                      color="#A78BFA"
                      onClick={() =>
                        runMap(
                          accessPattern,
                          occupancyPct,
                          `64M map — GPU ${accessPattern === 'coalesced' ? 'wins throughput by 50×' : accessPattern === 'staged' ? 'recovers coalesced global traffic through shared staging' : 'loses efficiency to warp divergence / scattered access'}`,
                        )
                      }
                    >
                      run map comparison
                    </ChipButton>
                    {mapRan && (
                      <p className="mt-2 font-mono text-[11px] text-[#A78BFA]">
                        {accessPattern === 'coalesced'
                          ? 'GPU wins 50×'
                          : accessPattern === 'staged'
                            ? `staging recovers ${Math.round(accessThroughputFactor * 100)}% end-to-end bandwidth`
                            : `${accessPattern} warps cut effective throughput ${Math.round(1 / coalesceEff)}×`}
                      </p>
                    )}
                  </div>
                </div>
              )}
              <div ref={wrapRef} className="absolute inset-0">
                <canvas
                  ref={canvasRef}
                  style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
                  role="img"
                  aria-label={`Roofline chart for ${preset}: ridge point at ${fmtAI(ridgeAI)} FLOPs per byte. Guide at intensity ${fmtAI(guideAI)}, ${guideBound}-bound.`}
                  aria-describedby={mirrorId}
                />
              </div>
            </div>
            <SimMirror id={mirrorId} table={mirror} className="border-t border-line bg-surface-1 px-3 py-2" />
          </div>

          {/* ------- control panel ------- */}
          <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
            <ControlGroup label="hardware">
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger aria-label="hardware" className="h-8 border-line bg-surface-2 font-mono text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-line bg-surface-1">
                  {PRESETS.map((m) => (
                    <SelectItem key={m.name} value={m.name} className="font-mono text-[12px]">
                      {m.name} — {m.bw} GB/s · {fmtRate(m.peak)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SliderRow
                label="HBM bandwidth"
                value={bw}
                display={`${bw} GB/s`}
                min={100}
                max={10_000}
                step={10}
                onChange={(v) => {
                  setBw(v)
                  setPreset('custom')
                }}
              />
              <SliderRow
                label="peak compute"
                value={peak}
                display={fmtRate(peak)}
                min={8000}
                max={1_000_000}
                step={1000}
                onChange={(v) => {
                  setPeak(v)
                  setPreset('custom')
                }}
              />
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-text-2">precision ceiling</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['fp16', 'fp8', 'int4'] as const).map((d) => (
                    <ChipButton
                      key={d}
                      active={dtype === d}
                      color="#A78BFA"
                      onClick={() => chooseDtype(d)}
                    >
                      {dtypeLabel(d)}
                    </ChipButton>
                  ))}
                </div>
              </div>
            </ControlGroup>

            <ControlGroup label="kernel library — click to plot">
              <div className="flex flex-wrap gap-1.5">
                {KERNELS.map((k) => {
                  const plotted = points.some((p) => p.kernelId === k.id)
                  return (
                    <ChipButton
                      key={k.id}
                      color={k.color}
                      active={plotted}
                      onClick={() => plotKernel(k)}
                    >
                      {k.label}
                    </ChipButton>
                  )
                })}
                <ChipButton
                  onClick={() => {
                    setPoints([])
                    log(ticksRef.current, 'CLEAR', 'all kernels unplotted')
                  }}
                  className="flex items-center gap-1"
                >
                  <Eraser size={11} strokeWidth={1.75} /> clear
                </ChipButton>
              </div>
            </ControlGroup>

            <ControlGroup label="B200 fleet table">
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                Four kernels from the Fleet serving loop, as GFLOP and GB. Predict a row&apos;s intensity in
                the task panel, then place it: the chart switches to the B200 at FP16 and plots the kernel.
              </p>
              <div className="space-y-2">
                {FLEET_KERNELS.map((kernel) => {
                  const placed = points.some((p) => p.kernelId === kernel.id)
                  const color = FLEET_STYLE[kernel.id].color
                  return (
                    <div key={kernel.id} className="rounded border border-line bg-ink p-2">
                      <div className="flex items-start justify-between gap-2 font-mono text-[10px]">
                        <span style={{ color }}>{kernel.label}</span>
                        <span className="text-right text-text-3">
                          {kernel.flopsG.toLocaleString()} GF / {kernel.bytesG.toLocaleString()} GB
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <ChipButton active={placed} color={color} onClick={() => placeFleet(kernel)}>
                          place {kernel.label} on B200
                        </ChipButton>
                      </div>
                      {placed && (
                        <p className="mt-1.5 font-mono text-[10px] text-accent">
                          placed · AI {fmtAI(kernel.ai)} F/B · {kernel.ai < ridgeAIOf(MACHINES.b200) ? 'bandwidth' : 'compute'}-bound
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </ControlGroup>

            <ControlGroup label="occupancy & registers">
              <SliderRow
                label="warps per SM"
                value={warpsPerSM}
                display={`${warpsPerSM} / ${MAX_WARP_SLOTS}`}
                min={1}
                max={64}
                step={1}
                onChange={chooseWarps}
              />
              <SliderRow
                label="registers per thread"
                value={regPerThread}
                display={`${regPerThread}`}
                min={16}
                max={255}
                step={1}
                onChange={chooseRegisters}
              />
              <div
                className="rounded-sm border px-2 py-1.5 font-mono text-[10px]"
                style={{
                  color: occupancyLow ? '#FF5C6C' : '#3EF2A4',
                  borderColor: occupancyLow ? '#FF5C6C44' : '#3EF2A444',
                  backgroundColor: occupancyLow ? '#FF5C6C11' : '#3EF2A411',
                }}
              >
                occupancy {occupancyPct}% · resident {residentWarps} warps
                {regSpill && (
                  <span className="ml-2 text-[#FF5C6C]">spill: reg file exceeded</span>
                )}
              </div>
            </ControlGroup>

            <ControlGroup label="memory access pattern">
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-text-2">access pattern</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['coalesced', 'strided', 'divergent', 'staged'] as const).map((p) => (
                    <ChipButton
                      key={p}
                      active={accessPattern === p}
                      color="#FBBF24"
                      onClick={() => choosePattern(p)}
                    >
                      {p === 'staged' ? 'shared transpose' : p}
                    </ChipButton>
                  ))}
                </div>
              </div>
              <div className="grid gap-1 font-mono text-[10px] text-text-2 sm:grid-cols-2">
                <span>global traffic {Math.round(access.globalTrafficBytes)} B / warp</span>
                <span>global load {Math.round(access.globalEfficiency * 100)}% coalesced</span>
                <span>
                  shared traffic {access.sharedTrafficBytes ? `${Math.round(access.sharedTrafficBytes)} B / warp` : 'none'}
                </span>
                <span>
                  shared banks {access.sharedEfficiency === null ? 'not used' : `${Math.round(access.sharedEfficiency * 100)}% efficient`}
                </span>
                <span className="sm:col-span-2">result bandwidth {fmtBandwidth(effectiveHbmBw)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                <span>32-way bank conflict</span>
                <Switch
                  aria-label="Toggle 32-way bank conflict"
                  checked={bankConflict}
                  onCheckedChange={chooseConflict}
                />
              </div>
              <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                <span>+1 padding fix</span>
                <Switch
                  aria-label="Toggle bank-conflict padding fix"
                  checked={bankPadding}
                  onCheckedChange={choosePadding}
                  disabled={!bankConflict}
                />
              </div>
              {bankConflict && (
                <div
                  className="rounded-sm border px-2 py-1.5 font-mono text-[10px]"
                  style={{
                    color: bankPadding ? '#3EF2A4' : '#FF5C6C',
                    borderColor: bankPadding ? '#3EF2A444' : '#FF5C6C44',
                    backgroundColor: bankPadding ? '#3EF2A411' : '#FF5C6C11',
                  }}
                >
                  {bankPadding
                    ? 'conflict-free: column padded to 33 banks'
                    : 'shared mem serialized 32× — throughput collapsed'}
                </div>
              )}
            </ControlGroup>

            <ControlGroup label="memory tier probe">
              <SliderRow
                label="working set"
                value={Math.log2(workingSetKb)}
                display={fmtBytes(workingSetKb * 1024)}
                min={2}
                max={27}
                step={0.1}
                onChange={chooseWorkingSet}
              />
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-text-2">4 KiB data path</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['auto', 'shared', 'hbm'] as const).map((path) => (
                    <ChipButton
                      key={path}
                      active={memoryPath === path}
                      color="#22D3EE"
                      onClick={() => chooseMemoryPath(path)}
                    >
                      {path}
                    </ChipButton>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-text-2">
                <span
                  className="rounded-sm border px-1.5 py-0.5"
                  style={{
                    color: tier === 'shared' ? '#3EF2A4' : tier === 'L2' ? '#22D3EE' : '#FBBF24',
                    borderColor:
                      tier === 'shared' ? '#3EF2A444' : tier === 'L2' ? '#22D3EE44' : '#FBBF2444',
                    backgroundColor:
                      tier === 'shared' ? '#3EF2A411' : tier === 'L2' ? '#22D3EE11' : '#FBBF2411',
                  }}
                >
                  {tier}
                </span>
                <span>bandwidth {fmtBandwidth(tierBw)}</span>
              </div>
              <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                CPU→GPU over PCIe (~32 GB/s)
                <Switch checked={pcieMode} onCheckedChange={choosePcie} />
              </label>
            </ControlGroup>

            <ControlGroup label="tiling & attention">
              <SliderRow
                label="matmul tile T"
                value={tileT}
                display={`${tileT}`}
                min={16}
                max={256}
                step={16}
                onChange={chooseTile}
              />
              <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-text-2">
                <span>AI ≈ {fmtAI(tileAI)} F/B</span>
                <span>occupancy {(tileOccFactor * 100).toFixed(0)}%</span>
                <span>
                  {tileCtas} {tileCtas === 1 ? 'CTA' : 'CTAs'} per SM
                </span>
                <span>slabs {fmtBytes(tileSmemBytes)} SMEM</span>
              </div>
              <div className="font-mono text-[10px] text-text-2">
                HBM traffic {fmtBytes((2 * 4096 ** 3) / tileAI)}
              </div>
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-text-2">attention view</p>
                <div className="flex flex-wrap gap-1.5">
                  {(['naive', 'flash'] as const).map((m) => (
                    <ChipButton
                      key={m}
                      active={attentionMode === m}
                      color="#A78BFA"
                      onClick={() => chooseAttention(m)}
                    >
                      {m} attention
                    </ChipButton>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 font-mono text-[10px] text-text-2">
                <span>context 32k</span>
                <span>HBM bytes {fmtBytes(attentionBytes)}</span>
                <span>{attentionMode === 'flash' ? 'score matrix avoided' : 'N×N scores materialized'}</span>
              </div>
            </ControlGroup>

            <ControlGroup label="scrub the model">
              <SliderRow
                label="arithmetic intensity"
                value={guide}
                display={`${fmtAI(guideAI)} F/B`}
                min={X_MIN}
                max={X_MAX}
                step={0.1}
                onChange={setGuide}
              />
              <p
                className="rounded-sm border px-2 py-1.5 font-mono text-[10px]"
                style={{
                  color: guideBound === 'bandwidth' ? '#FFB224' : '#3EF2A4',
                  borderColor: guideBound === 'bandwidth' ? '#FFB22444' : '#3EF2A444',
                  backgroundColor: guideBound === 'bandwidth' ? '#FFB22411' : '#3EF2A411',
                }}
              >
                bound by: {guideBound.toUpperCase()} — ceiling{' '}
                {fmtRate(Math.min(peak * dtypeMultiplier(dtype), bw * guideAI))}
              </p>
              <SliderRow
                label="batch size → (shifts decode)"
                value={BATCH_STEPS.indexOf(batch)}
                display={`×${batch}`}
                min={0}
                max={BATCH_STEPS.length - 1}
                step={1}
                onChange={(i) => chooseBatch(BATCH_STEPS[i])}
              />
            </ControlGroup>

            <ControlGroup label="task · explain" className="border-b-0">
              <InlineQuiz
                question="You swap in a GPU with double the peak FLOPs. Decode tokens/s barely moves. Why?"
                options={[
                  "Decode reads every weight from HBM for each token — it's pinned to the bandwidth roof, so extra FLOPs just lift a ceiling you're nowhere near.",
                  'The model got bigger, cancelling out the new FLOPs.',
                  'PCIe is the bottleneck; HBM speed is irrelevant.',
                ]}
                correctIndex={0}
                onSolved={() => {
                  log(
                    ticksRef.current,
                    'NOTE',
                    'decode is bandwidth-bound: buy memory bandwidth (or batch), not FLOPs',
                    'ok',
                  )
                }}
              />
            </ControlGroup>
          </aside>
        </div>

        <TransportBar
          playing={playing}
          onTogglePlay={() => setPlaying((v) => !v)}
          onStep={stepGuide}
          onReset={reset}
          speed={speed}
          onSpeedChange={setSpeed}
          ticks={ticks}
        />
        {!embed && <LogConsole lines={lines} onClear={clear} />}
      </div>
    </PlaygroundShell>
  )
}
