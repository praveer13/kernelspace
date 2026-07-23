/**
 * SIM-01c `sim-memory` (matrix mode) — Row- vs Column-Major Matrix Sum
 * (t0.l3 "Benchmark: Row- vs Column-Major Traversal").
 *
 * A synthetic-but-faithful bandwidth benchmark over an N×N f64 matrix.
 * Row-major walks memory sequentially, reusing every 64 B cache line for 8
 * doubles and letting the prefetcher run far ahead. Column-major strides by
 * N×8 B, using only one double per line; at N=8192 the stride is 64 KB,
 * defeating the prefetcher and thrashing the TLB.
 *
 * Model constants:
 *   f64 = 8 B · cache line = 64 B
 *   L1  32 KB / 0.5 ns  (~16 GB/s class)
 *   L2   4 MB / 5.0 ns   (~12.8 GB/s class)
 *   L3  32 MB / 15 ns    (~4.3 GB/s class)
 *   DRAM     / 85 ns     (~1.4 GB/s class)
 *   TLB miss penalty = +20 ns/access for page-crossing strides.
 *
 * Why L2=4 MB? 512²·8 B = 2 MB, so the whole matrix fits in L2. The active
 * column set is only N·64 B = 32 KB, which fits L1; once loaded, column-major
 * reuses those lines across the 8 columns that share each line. The gap between
 * row and column therefore nearly vanishes at 512², while at 8192² the total
 * matrix spills to DRAM and the 64 KB stride pays full TLB cost.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, RotateCcw } from 'lucide-react'
import {
  ChipButton,
  ControlGroup,
  LogConsole,
  completeSimTask,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
} from '@/components/sims/PlaygroundShell'

const SIM_ID = 'sim-memory'

/* -------- hierarchy model -------- */
interface Level {
  name: string
  capKb: number
  ns: number
  color: string
}
const LEVELS: Level[] = [
  { name: 'L1', capKb: 32, ns: 0.5, color: '#3EF2A4' },
  { name: 'L2', capKb: 4096, ns: 5, color: '#22D3EE' },
  { name: 'L3', capKb: 32768, ns: 15, color: '#A78BFA' },
  { name: 'DRAM', capKb: Infinity, ns: 85, color: '#FBBF24' },
]
const L2_KB = LEVELS[1].capKb

const levelFor = (kb: number): Level =>
  LEVELS.find((l) => kb <= l.capKb) ?? LEVELS[LEVELS.length - 1]

const N_SIZES = [64, 128, 256, 512, 1024, 2048, 4096, 8192]
const L2_N = 512

const fmtN = (n: number): string => (n >= 1024 ? `${n / 1024}K` : `${n}`)
const fmtMs = (ns: number): string => {
  if (ns >= 1e9) return `${(ns / 1e9).toFixed(2)} s`
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms`
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`
  return `${ns.toFixed(1)} ns`
}
const fmtGbs = (bw: number): string =>
  bw >= 10 ? `${bw.toFixed(1)} GB/s` : `${bw.toFixed(2)} GB/s`

/** Deterministic jitter so reruns feel measured rather than random. */
const jitter = (seed: number): number => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return 1 + (x - Math.floor(x) - 0.5) * 0.06
}

/** Clean wall-clock time and effective bandwidth for one traversal. */
function matrixModel(
  n: number,
  order: 'row' | 'col',
  prefetch: boolean,
): { ns: number; bwGbs: number; level: string } {
  const bytes = n * n * 8
  const kb = bytes / 1024
  const level = levelFor(kb)
  const doubles = n * n
  const lines = doubles / 8
  const stride = n * 8

  let ns = 0

  if (order === 'row') {
    // Sequential: one cache-line fetch serves 8 doubles; prefetcher runs ahead.
    ns = lines * level.ns
    if (prefetch) ns *= 0.55
  } else {
    // Column-major: one double per access.
    // If the whole matrix fits L2, the active column lines (N·64 B) fit L1 and
    // are reused across the 8 columns that share each line.
    const colLevel = kb <= L2_KB ? LEVELS[0] : level
    ns = doubles * colLevel.ns
    // Prefetcher only helps small column strides; the 64 KB stride at 8192
    // is far outside its window.
    if (prefetch && stride <= 256) ns *= 0.65
    // Page-crossing stride plus a working set larger than L2 = TLB thrash.
    if (stride >= 4096 && kb > L2_KB) ns += doubles * 20
  }

  ns = Math.max(ns, 1)
  const bwGbs = bytes / ns
  return { ns, bwGbs, level: level.name }
}

interface Run {
  id: number
  n: number
  order: 'row' | 'col'
  prefetch: boolean
  ns: number
  bwGbs: number
  level: string
}

/* -------- chart geometry -------- */
const CHART_H = 300
const PAD = { l: 52, r: 14, t: 14, b: 34 }
const X_MIN = Math.log2(N_SIZES[0])
const X_MAX = Math.log2(N_SIZES[N_SIZES.length - 1])
const Y_MIN = Math.log2(0.01)
const Y_MAX = Math.log2(200)

const ROW_COLOR = '#3EF2A4'
const COL_COLOR = '#FF5C6C'

export default function MatrixBench() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const [n, setN] = useState<number>(8192)
  const [order, setOrder] = useState<'row' | 'col'>('row')
  const [prefetch, setPrefetch] = useState<boolean>(true)
  const [runs, setRuns] = useState<Run[]>([])
  const [probe, setProbe] = useState<number | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(720)
  const tickRef = useRef(0)

  const lastRun = runs[runs.length - 1]

  const run = useCallback(() => {
    tickRef.current += 1
    const t = tickRef.current
    const clean = matrixModel(n, order, prefetch)
    const ns = clean.ns * jitter(t)
    const bwGbs = (n * n * 8) / ns
    const r: Run = {
      id: t,
      n,
      order,
      prefetch,
      ns,
      bwGbs,
      level: clean.level,
    }
    setRuns((prev) => [...prev.slice(-39), r])
    setProbe(t)
    log(
      t,
      'BENCH',
      `${fmtN(n)}² ${order} · ${fmtGbs(bwGbs)} · ${fmtMs(ns)} · ${clean.level}`,
      order === 'col' && n >= 4096 ? 'warn' : 'ok',
    )
    if (order === 'col' && n >= 4096) {
      log(
        t,
        'STRIDE',
        `stride ${(n * 8) / 1024} KB — one double per line, TLB miss per access`,
        'warn',
      )
    }

    /* ---- task detection ---- */
    if (order === 'row' && n >= 4096) completeSimTask(SIM_ID, 't-matrix-row', 60)
    if (order === 'col' && n >= 4096 && bwGbs < 0.5)
      completeSimTask(SIM_ID, 't-matrix-col', 60)
    if (n === L2_N) {
      const atL2 = [...runs, r].filter((x) => x.n === L2_N)
      const hasRow = atL2.some((x) => x.order === 'row')
      const hasCol = atL2.some((x) => x.order === 'col')
      if (hasRow && hasCol) completeSimTask(SIM_ID, 't-matrix-l2', 60)
    }
    if (n >= 4096) {
      const hasMatchingPrefetchRun = runs.some(
        (x) => x.n === n && x.order === order && x.prefetch !== prefetch,
      )
      if (hasMatchingPrefetchRun) completeSimTask(SIM_ID, 't-matrix-prefetch', 60)
    }
  }, [n, order, prefetch, runs, log])

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

    const px = (valN: number) =>
      PAD.l + ((Math.log2(valN) - X_MIN) / (X_MAX - X_MIN)) * (w - PAD.l - PAD.r)
    const py = (bw: number) =>
      PAD.t + (1 - (Math.log2(bw) - Y_MIN) / (Y_MAX - Y_MIN)) * (CHART_H - PAD.t - PAD.b)

    /* grid + axes */
    ctx.strokeStyle = 'rgba(38,48,64,0.8)'
    ctx.fillStyle = '#5D6B80'
    ctx.font = '10px ui-monospace, monospace'
    ctx.lineWidth = 1
    for (const bw of [0.1, 1, 10, 100]) {
      ctx.beginPath()
      ctx.moveTo(PAD.l, py(bw))
      ctx.lineTo(w - PAD.r, py(bw))
      ctx.stroke()
      ctx.fillText(`${bw} GB/s`, 6, py(bw) + 3)
    }
    for (const s of N_SIZES) {
      ctx.beginPath()
      ctx.moveTo(px(s), PAD.t)
      ctx.lineTo(px(s), CHART_H - PAD.b)
      ctx.stroke()
      ctx.fillText(fmtN(s), px(s) - 10, CHART_H - PAD.b + 16)
    }

    /* level boundaries */
    for (const l of LEVELS.slice(0, 3)) {
      ctx.strokeStyle = `${l.color}55`
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      const x = px(Math.sqrt((l.capKb * 1024) / 8))
      ctx.moveTo(x, PAD.t)
      ctx.lineTo(x, CHART_H - PAD.b)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = l.color
      ctx.fillText(`${l.name} ${formatBytes(l.capKb * 1024)}`, x + 5, PAD.t + 12)
    }

    /* expected curves at current prefetch setting */
    const drawCurve = (o: 'row' | 'col', color: string) => {
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.45
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i <= 200; i += 1) {
        const logN = X_MIN + ((X_MAX - X_MIN) * i) / 200
        const valN = 2 ** logN
        const { bwGbs } = matrixModel(Math.round(valN), o, prefetch)
        const x = px(valN)
        const y = py(bwGbs)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    drawCurve('row', ROW_COLOR)
    drawCurve('col', COL_COLOR)

    /* measured runs */
    for (const r of runs) {
      const color = r.order === 'row' ? ROW_COLOR : COL_COLOR
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(px(r.n), py(r.bwGbs), r.id === probe ? 5.5 : 4, 0, Math.PI * 2)
      ctx.fill()
      if (r.order === 'col' && r.n >= 4096) {
        ctx.strokeStyle = COL_COLOR
        ctx.beginPath()
        ctx.arc(px(r.n), py(r.bwGbs), r.id === probe ? 8.5 : 7, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    /* probe label */
    if (probe !== null && lastRun) {
      ctx.fillStyle = '#E6EDF7'
      const label = `${lastRun.order === 'row' ? 'row' : 'col'} · ${fmtGbs(lastRun.bwGbs)} · ${fmtMs(lastRun.ns)}`
      ctx.fillText(label, Math.min(px(lastRun.n) + 10, w - PAD.r - 150), py(lastRun.bwGbs) - 10)
    }
  }, [runs, prefetch, width, probe, lastRun])

  const expected = useMemo(() => matrixModel(n, order, prefetch), [n, order, prefetch])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------- stage ------- */}
        <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              N×N f64 matrix sum
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              N={fmtN(n)} · {fmtN(n)}²·8B = {formatBytes(n * n * 8)}
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              {order === 'row' ? 'row-major' : 'column-major'} · prefetch {prefetch ? 'on' : 'off'}
            </span>
            {lastRun && (
              <span
                className="rounded-sm border px-2 py-0.5"
                style={{
                  color: order === 'row' ? ROW_COLOR : COL_COLOR,
                  borderColor: `${order === 'row' ? ROW_COLOR : COL_COLOR}55`,
                }}
              >
                {fmtGbs(lastRun.bwGbs)} · {fmtMs(lastRun.ns)}
              </span>
            )}
          </div>

          <div ref={wrapRef} className="w-full">
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: CHART_H }}
              role="img"
              aria-label={`Bandwidth versus matrix order chart. ${runs.length} runs recorded.`}
            />
          </div>

          {/* access trace — a decorative strip of cache-line hops */}
          {probe !== null && lastRun && (
            <div className="mt-3 flex items-center gap-1.5" aria-hidden>
              <span className="mr-1 font-mono text-[9px] uppercase text-text-3">
                {lastRun.order === 'row' ? 'sequential' : 'stride'}
              </span>
              {Array.from({ length: 24 }, (_, i) => {
                const strideBytes = lastRun.order === 'row' ? 8 : lastRun.n * 8
                const hop = i * strideBytes
                return (
                  <motion.span
                    key={`${probe}-${i}`}
                    className="h-2.5 w-2.5 rounded-[2px]"
                    style={{
                      backgroundColor: lastRun.order === 'row' ? ROW_COLOR : COL_COLOR,
                      opacity: 0.25 + Math.min(hop / (64 * 16), 0.75),
                    }}
                    initial={{ scale: 0.6, opacity: 0.1 }}
                    animate={
                      reducedMotion
                        ? { scale: 1, opacity: 0.85 }
                        : { scale: [0.6, 1, 0.9], opacity: [0.1, 1, 0.6] }
                    }
                    transition={{ delay: reducedMotion ? 0 : i * 0.04, duration: 0.35 }}
                  />
                )
              })}
              <span className="ml-2 font-mono text-[9px] text-text-3">
                {lastRun.order === 'row'
                  ? 'one line reused 8×'
                  : `stride ${(lastRun.n * 8) / 1024} KB`}
              </span>
            </div>
          )}

          <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
            the faint curves are the model's expectation at your current prefetch setting. green =
            row-major reuses every cache line; red = column-major jumps by N·8 B. red rings mark a
            page-crossing stride.
          </p>
        </div>

        {/* ------- control panel ------- */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
          <ControlGroup label="matrix size N">
            <div className="flex flex-wrap gap-1.5">
              {N_SIZES.map((s) => (
                <ChipButton key={s} active={n === s} color="#22D3EE" onClick={() => setN(s)}>
                  {fmtN(s)}
                </ChipButton>
              ))}
            </div>
          </ControlGroup>

          <ControlGroup label="traversal order">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={order === 'row'} color={ROW_COLOR} onClick={() => setOrder('row')}>
                row-major
              </ChipButton>
              <ChipButton active={order === 'col'} color={COL_COLOR} onClick={() => setOrder('col')}>
                column-major
              </ChipButton>
            </div>
          </ControlGroup>

          <ControlGroup label="prefetcher">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={prefetch} onClick={() => setPrefetch(true)}>
                prefetcher on
              </ChipButton>
              <ChipButton active={!prefetch} onClick={() => setPrefetch(false)}>
                prefetcher off
              </ChipButton>
            </div>
          </ControlGroup>

          <ControlGroup label="run">
            <button
              type="button"
              onClick={run}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
            >
              <Play size={15} strokeWidth={2} /> run the benchmark
            </button>
            <div className="rounded-md border border-line bg-surface-2 p-2.5">
              <div className="flex items-center justify-between font-mono text-[10px] text-text-2">
                <span>expected</span>
                <span className="text-text-1">{fmtGbs(expected.bwGbs)} · {fmtMs(expected.ns)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={reset}
              className="flex w-full items-center justify-center gap-1.5 text-center font-mono text-[10px] text-text-3 transition-colors hover:text-danger"
            >
              <RotateCcw size={12} /> clear recorded runs
            </button>
          </ControlGroup>

          <ControlGroup label="legend" className="border-b-0">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                style={{ borderColor: ROW_COLOR, backgroundColor: `${ROW_COLOR}30` }}
              />
              <span className="font-mono text-[10px] text-text-2">row-major · line reuse</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                style={{ borderColor: COL_COLOR, backgroundColor: `${COL_COLOR}30` }}
              />
              <span className="font-mono text-[10px] text-text-2">column-major · stride N·8 B</span>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              at 8192² the column stride is 64 KB: one useful double per fetched line, a new page
              every access, and no prefetcher rescue.
            </p>
          </ControlGroup>
        </aside>
      </div>

      {!embed && <LogConsole lines={lines} onClear={clear} />}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
