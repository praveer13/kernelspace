/**
 * SIM-01b `sim-memory` (latency mode) — Latency Walk (t0.l2 "The Memory
 * Hierarchy"). A synthetic-but-faithful pointer-chase bench: pick a working-set
 * size and stride, fire dependent loads, and watch which level of the hierarchy
 * answers. The chart plots ns/access vs working set so the L1 → L2 → L3 → DRAM
 * plateaus appear as steps, exactly like the classic latency-walk measurement.
 *
 * Model notes (documented in the help modal):
 *   L1 32 KB / 0.5 ns · L2 1 MB / 5 ns · L3 32 MB / 15 ns · DRAM / 100 ns.
 *   Stride < 64 B shares a cache line across accesses (latency × stride/64).
 *   Stride ≥ 4 KB adds a TLB-miss penalty and defeats the prefetcher.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import {
  ChipButton,
  ControlGroup,
  LogConsole,
  SliderRow,
  completeSimTask,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
} from '@/components/sims/PlaygroundShell'
import type { SimTask } from '@/components/sims/PlaygroundShell'

const SIM_ID = 'sim-memory'

export const LATENCY_TASKS: SimTask[] = [
  {
    id: 't-lat-l1',
    text: 'Pointer-chase a ≤32 KB working set — find which cache level answers',
    xp: 60,
  },
  {
    id: 't-lat-dram',
    text: 'Grow the working set to 64 MB — watch latency step L1 → L2 → L3 → DRAM',
    xp: 60,
  },
  {
    id: 't-lat-stride',
    text: 'Same ≥1 MB buffer, stride ≤64 B vs stride 4096 B — explain the gap',
    xp: 60,
  },
  {
    id: 't-lat-hbm',
    text: 'Reveal HBM on the ladder — note its bandwidth vs DRAM',
    xp: 60,
  },
]

/* -------- hierarchy model -------- */
interface Level {
  name: string
  capKb: number // Infinity for DRAM
  ns: number
  color: string
}
const LEVELS: Level[] = [
  { name: 'L1', capKb: 32, ns: 0.5, color: '#3EF2A4' },
  { name: 'L2', capKb: 1024, ns: 5, color: '#22D3EE' },
  { name: 'L3', capKb: 32768, ns: 15, color: '#A78BFA' },
  { name: 'DRAM', capKb: Infinity, ns: 100, color: '#FBBF24' },
]
const levelFor = (wsKb: number): Level =>
  LEVELS.find((l) => wsKb <= l.capKb) ?? LEVELS[LEVELS.length - 1]

const WS_MIN_IDX = 0
const WS_SIZES_KB = [4, 16, 32, 64, 256, 1024, 8192, 32768, 65536, 262144]
const WS_MAX_IDX = WS_SIZES_KB.length - 1
const STRIDES_B = [8, 64, 256, 1024, 4096]

const fmtKb = (kb: number): string =>
  kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`
const fmtNs = (ns: number): string =>
  ns >= 100 ? `${ns.toFixed(0)} ns` : ns >= 10 ? `${ns.toFixed(1)} ns` : `${ns.toFixed(2)} ns`

/** Clean (jitter-free) latency of one dependent load, in ns. */
function latencyModel(wsKb: number, strideB: number, prefetch: boolean): number {
  const level = levelFor(wsKb)
  let lat = level.ns
  /* sub-line strides share a 64 B line across dependent accesses */
  lat *= Math.max(Math.min(strideB / 64, 1), 1 / 16)
  /* prefetcher rescues short regular strides only */
  if (prefetch && strideB <= 256) lat *= 0.6
  /* page-crossing strides: TLB miss on every access, no prefetch rescue */
  if (strideB >= 4096) lat += level.name === 'DRAM' ? 20 : 8
  return Math.max(lat, 0.3)
}

/* deterministic jitter so reruns feel measured, not random */
const jitter = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return 1 + (x - Math.floor(x) - 0.5) * 0.08
}

interface Run {
  id: number
  wsKb: number
  strideB: number
  prefetch: boolean
  ns: number
  level: string
  bwGbs: number
}

/* -------- chart geometry -------- */
const CHART_H = 300
const PAD = { l: 46, r: 14, t: 14, b: 30 }
const X_MIN = Math.log2(WS_SIZES_KB[WS_MIN_IDX]) // 4 KB
const X_MAX = Math.log2(WS_SIZES_KB[WS_MAX_IDX]) // 256 MB
const Y_MIN = Math.log2(0.25) // ns
const Y_MAX = Math.log2(400)

export default function LatencyWalk() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const [wsIdx, setWsIdx] = useState(2) // 32 KB
  const [strideB, setStrideB] = useState(8)
  const [prefetch, setPrefetch] = useState(true)
  const [showHbm, setShowHbm] = useState(false)
  const [runs, setRuns] = useState<Run[]>([])
  const [probe, setProbe] = useState<number | null>(null) // run id being animated

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(720)
  const tickRef = useRef(0)

  const wsKb = WS_SIZES_KB[wsIdx]
  const lastRun = runs[runs.length - 1]

  /* ---- run one pointer-chase ---- */
  const run = useCallback(() => {
    tickRef.current += 1
    const t = tickRef.current
    const ns = latencyModel(wsKb, strideB, prefetch) * jitter(t)
    const level = levelFor(wsKb)
    const r: Run = {
      id: t,
      wsKb,
      strideB,
      prefetch,
      ns,
      level: level.name,
      bwGbs: 8 / ns, // 8 bytes per dependent load
    }
    setRuns((prev) => [...prev.slice(-39), r])
    setProbe(t)
    log(
      t,
      'CHASE',
      `${fmtKb(wsKb)} stride-${strideB}B → ${level.name} answers · ${fmtNs(ns)}/load · ${r.bwGbs.toFixed(2)} GB/s`,
      level.name === 'DRAM' ? 'warn' : 'ok',
    )
    if (strideB >= 4096)
      log(t, 'TLB', 'stride ≥ 4 KB — every load a new page; prefetcher cannot help', 'warn')

    /* guided-task detection (t0.l2) */
    if (wsKb <= 32) completeSimTask(SIM_ID, 't-lat-l1', 60)
    if (wsKb >= 65536) completeSimTask(SIM_ID, 't-lat-dram', 60)
    if (wsKb >= 1024) {
      const all = [...runs, r]
      const hasSmall = all.some((x) => x.wsKb >= 1024 && x.strideB <= 64)
      const hasPage = all.some((x) => x.wsKb >= 1024 && x.strideB >= 4096)
      if (hasSmall && hasPage) completeSimTask(SIM_ID, 't-lat-stride', 60)
    }
  }, [wsKb, strideB, prefetch, runs, log])

  const toggleHbm = useCallback(() => {
    setShowHbm((v) => {
      if (!v) {
        tickRef.current += 1
        log(
          tickRef.current,
          'HBM',
          'HBM3 ~80 GB · ~3.35 TB/s — DRAM-class latency, ~25× the bandwidth. decode lives here.',
          'ok',
        )
        completeSimTask(SIM_ID, 't-lat-hbm', 60)
      }
      return !v
    })
  }, [log])

  const reset = useCallback(() => {
    setRuns([])
    setProbe(null)
    clear()
  }, [clear])

  /* ---- canvas sizing ---- */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /* ---- chart paint ---- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(width, 280)
    canvas.width = w * dpr
    canvas.height = CHART_H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, CHART_H)

    const px = (kb: number) => PAD.l + ((Math.log2(kb) - X_MIN) / (X_MAX - X_MIN)) * (w - PAD.l - PAD.r)
    const py = (ns: number) =>
      PAD.t + (1 - (Math.log2(ns) - Y_MIN) / (Y_MAX - Y_MIN)) * (CHART_H - PAD.t - PAD.b)

    /* grid + axes */
    ctx.strokeStyle = 'rgba(38,48,64,0.8)'
    ctx.fillStyle = '#5D6B80'
    ctx.font = '10px ui-monospace, monospace'
    ctx.lineWidth = 1
    for (const ns of [0.5, 1, 5, 10, 15, 50, 100, 200]) {
      ctx.beginPath()
      ctx.moveTo(PAD.l, py(ns))
      ctx.lineTo(w - PAD.r, py(ns))
      ctx.stroke()
      ctx.fillText(`${ns} ns`, 6, py(ns) + 3)
    }
    for (const kb of WS_SIZES_KB) {
      ctx.beginPath()
      ctx.moveTo(px(kb), PAD.t)
      ctx.lineTo(px(kb), CHART_H - PAD.b)
      ctx.stroke()
      ctx.fillText(fmtKb(kb), px(kb) - 14, CHART_H - PAD.b + 16)
    }

    /* level boundaries */
    for (const l of LEVELS.slice(0, 3)) {
      ctx.strokeStyle = `${l.color}55`
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(px(l.capKb), PAD.t)
      ctx.lineTo(px(l.capKb), CHART_H - PAD.b)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = l.color
      ctx.fillText(`${l.name} ${fmtKb(l.capKb)}`, px(l.capKb) + 5, PAD.t + 12)
    }

    /* reference sweep at current stride/prefetch (the "expected staircase") */
    ctx.strokeStyle = 'rgba(93,107,128,0.55)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (let i = 0; i <= 200; i += 1) {
      const kb = 2 ** (X_MIN + ((X_MAX - X_MIN) * i) / 200)
      const y = py(latencyModel(kb, strideB, prefetch))
      if (i === 0) ctx.moveTo(px(kb), y)
      else ctx.lineTo(px(kb), y)
    }
    ctx.stroke()

    /* HBM reference */
    if (showHbm) {
      ctx.strokeStyle = '#FB7185'
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(PAD.l, py(2.2))
      ctx.lineTo(w - PAD.r, py(2.2))
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#FB7185'
      ctx.fillText('HBM3 — ~3.35 TB/s class (bandwidth, not latency, is the kingdom)', PAD.l + 8, py(2.2) - 6)
    }

    /* measured runs */
    for (const r of runs) {
      const level = LEVELS.find((l) => l.name === r.level) ?? LEVELS[3]
      ctx.fillStyle = level.color
      ctx.beginPath()
      ctx.arc(px(r.wsKb), py(r.ns), r.id === probe ? 5 : 3.5, 0, Math.PI * 2)
      ctx.fill()
      if (r.strideB >= 4096) {
        ctx.strokeStyle = '#FF5C6C'
        ctx.beginPath()
        ctx.arc(px(r.wsKb), py(r.ns), r.id === probe ? 8 : 6.5, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    /* probe label */
    if (probe !== null && lastRun) {
      ctx.fillStyle = '#E6EDF7'
      const label = `${lastRun.level} · ${fmtNs(lastRun.ns)}`
      ctx.fillText(label, Math.min(px(lastRun.wsKb) + 10, w - PAD.r - 110), py(lastRun.ns) - 8)
    }
  }, [runs, strideB, prefetch, showHbm, width, probe, lastRun])

  const ladderRows = useMemo(
    () =>
      LEVELS.map((l) => ({
        ...l,
        cap: l.capKb === Infinity ? '32–512 GB' : fmtKb(l.capKb),
      })),
    [],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------- stage ------- */}
        <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              pointer-chase · dependent 8 B loads
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              ws {fmtKb(wsKb)} · stride {strideB} B
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              prefetch {prefetch ? 'on' : 'off'}
            </span>
            {lastRun && (
              <span
                className="rounded-sm border px-2 py-0.5"
                style={{
                  color: LEVELS.find((l) => l.name === lastRun.level)?.color,
                  borderColor: `${LEVELS.find((l) => l.name === lastRun.level)?.color}55`,
                }}
              >
                {lastRun.level} answers · {fmtNs(lastRun.ns)} · {lastRun.bwGbs.toFixed(2)} GB/s
              </span>
            )}
          </div>

          <div ref={wrapRef} className="w-full">
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: CHART_H }}
              role="img"
              aria-label={`Latency versus working-set chart. ${runs.length} runs recorded.`}
            />
          </div>

          {/* access trace — a decorative strip of dependent hops */}
          {probe !== null && lastRun && (
            <div className="mt-3 flex items-center gap-1.5" aria-hidden>
              <span className="mr-1 font-mono text-[9px] uppercase text-text-3">chase</span>
              {Array.from({ length: 24 }, (_, i) => (
                <motion.span
                  key={`${probe}-${i}`}
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{
                    backgroundColor:
                      LEVELS.find((l) => l.name === lastRun.level)?.color ?? '#3EF2A4',
                  }}
                  initial={{ opacity: 0.1 }}
                  animate={reducedMotion ? { opacity: 0.85 } : { opacity: [0.1, 1, 0.45] }}
                  transition={{ delay: reducedMotion ? 0 : i * 0.05, duration: 0.4 }}
                />
              ))}
              <span className="ml-2 font-mono text-[9px] text-text-3">
                24 dependent loads · {fmtNs(lastRun.ns)} each
              </span>
            </div>
          )}

          <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
            the faint staircase is the model's expectation at your current stride — each plateau is
            one level of the hierarchy. your measured runs land on top as dots; a red ring means the
            stride crossed a page on every load.
          </p>
        </div>

        {/* ------- control panel ------- */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
          <ControlGroup label="access pattern">
            <SliderRow
              label="working set"
              value={wsIdx}
              display={fmtKb(wsKb)}
              min={WS_MIN_IDX}
              max={WS_MAX_IDX}
              step={1}
              onChange={setWsIdx}
            />
            <div>
              <p className="mb-1.5 font-mono text-[11px] text-text-2">stride</p>
              <div className="flex flex-wrap gap-1.5">
                {STRIDES_B.map((s) => (
                  <ChipButton
                    key={s}
                    active={strideB === s}
                    color="#FBBF24"
                    onClick={() => setStrideB(s)}
                  >
                    {s} B
                  </ChipButton>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={prefetch} onClick={() => setPrefetch((v) => !v)}>
                prefetcher {prefetch ? 'on' : 'off'}
              </ChipButton>
              <ChipButton active={showHbm} color="#FB7185" onClick={toggleHbm}>
                HBM ref
              </ChipButton>
            </div>
          </ControlGroup>

          <ControlGroup label="run">
            <button
              type="button"
              onClick={run}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
            >
              <Play size={15} strokeWidth={2} /> run the pointer-chase
            </button>
            <button
              type="button"
              onClick={reset}
              className="w-full text-center font-mono text-[10px] text-text-3 transition-colors hover:text-danger"
            >
              clear recorded runs
            </button>
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              each run fires a chain of dependent loads through the buffer — the answering level is
              the slowest store the chain touches.
            </p>
          </ControlGroup>

          <ControlGroup label="the ladder" className="border-b-0">
            {ladderRows.map((l) => (
              <div key={l.name} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                  style={{ borderColor: l.color, backgroundColor: `${l.color}30` }}
                />
                <span className="font-mono text-[10px] text-text-2">
                  {l.name} · {l.cap} · {fmtNs(l.ns)}
                </span>
              </div>
            ))}
            {showHbm && (
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-[#FB7185] bg-[#FB7185]/30" />
                <span className="font-mono text-[10px] text-[#FB7185]">
                  HBM3 · ~80 GB · 3.35 TB/s
                </span>
              </div>
            )}
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              {showHbm
                ? 'HBM trades capacity for bandwidth: DRAM-class latency, ~25× the throughput. gpu decode is built on that trade.'
                : 'toggle “HBM ref” to place high-bandwidth memory on the ladder.'}
            </p>
          </ControlGroup>
        </aside>
      </div>

      {!embed && <LogConsole lines={lines} onClear={clear} />}
    </div>
  )
}
