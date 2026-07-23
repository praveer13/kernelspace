/**
 * SIM-01c `sim-memory` (layout mode) — Layout Lab (t0.l4 "AoS vs SoA, False
 * Sharing & Cache Lines"). Two synthetic benchmarks that make the 64-byte
 * cache-line rule concrete:
 *   1. AoS vs SoA deadline sweep — shows effective bandwidth collapse when
 *      only 8 useful bytes are fetched inside a 64-byte line.
 *   2. False-sharing counter — shows 8 independent counters in one line
 *      ping-ponging ownership and killing throughput.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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

const SIM_ID = 'sim-memory'

const RECORD_SIZE = 32 // bytes: struct { u64 deadline; u64 a; u64 b; u64 c }
const U64 = 8
const LINE = 64
const DRAM_ROOF_GBPS = 40 // synthetic peak

const COUNT_MIN = 0
const COUNT_MAX = 5
const COUNT_STEPS = [128_000, 512_000, 2_000_000, 8_000_000, 32_000_000, 128_000_000]
const fmtCount = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(0)}M records` : `${(n / 1000).toFixed(0)}K records`

const fmtBytes = (b: number): string => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

const fmtGbps = (g: number): string => `${g.toFixed(2)} GB/s`

interface SweepResult {
  layout: 'aos' | 'soa'
  n: number
  bytesFetched: number
  bytesUsed: number
  effectiveGbps: number
  timeMs: number
}

interface FalseResult {
  padded: boolean
  totalIncrements: number
  throughputMips: number
  pingPongs: number
  ratio: number
}

/* deterministic jitter */
const jitter = (seed: number): number => {
  const x = Math.sin(seed * 93.7 + 19.3) * 43758.5453
  return 1 + (x - Math.floor(x) - 0.5) * 0.06
}

function runSweepModel(layout: 'aos' | 'soa', n: number, seed: number): SweepResult {
  // AoS: each record access brings in a full 64-byte line but only 8 bytes are used.
  // SoA: the deadline array is dense — 8 useful bytes per 8 bytes fetched.
  const bytesUsed = n * U64
  const bytesFetched = layout === 'aos' ? n * LINE : n * U64
  const j = jitter(seed)
  const timeS = (bytesFetched / (DRAM_ROOF_GBPS * 1e9)) * j
  const effectiveGbps = bytesUsed / timeS / 1e9
  return {
    layout,
    n,
    bytesFetched,
    bytesUsed,
    effectiveGbps,
    timeMs: timeS * 1000,
  }
}

function runFalseModel(padded: boolean, seed: number): FalseResult {
  const threads = 8
  const incrementsPerThread = 1_000_000
  const totalIncrements = threads * incrementsPerThread
  // unpadded: every increment forces an ownership transfer of the shared line.
  // padded: each counter lives on its own line, L1-hot, no coherence traffic.
  const j = jitter(seed)
  const nsPerInc = (padded ? 2.5 : 95) * j
  const totalNs = totalIncrements * nsPerInc
  const throughputMips = totalIncrements / (totalNs / 1e3)
  const pingPongs = padded ? 0 : Math.round(totalIncrements * 0.95)
  // compare the two layouts using the same jitter so the ratio is deterministic.
  const paddedMips = totalIncrements / ((totalIncrements * 2.5 * j) / 1e3)
  const unpaddedMips = totalIncrements / ((totalIncrements * 95 * j) / 1e3)
  const ratio = padded ? paddedMips / unpaddedMips : unpaddedMips / paddedMips
  return { padded, totalIncrements, throughputMips, pingPongs, ratio }
}

/* -------- canvas helpers -------- */
const CHART_H = 320
const PAD = { l: 52, r: 18, t: 18, b: 36 }

export default function LayoutLab() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const [mode, setMode] = useState<'sweep' | 'false'>('sweep')

  /* sweep state */
  const [layout, setLayout] = useState<'aos' | 'soa'>('aos')
  const [countIdx, setCountIdx] = useState(2)
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null)

  /* false-sharing state */
  const [padded, setPadded] = useState(false)
  const [falseResult, setFalseResult] = useState<FalseResult | null>(null)

  const [running, setRunning] = useState(false)
  const tickRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(720)

  const count = COUNT_STEPS[countIdx]

  /* ---- canvas sizing ---- */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /* ---- cleanup animation ---- */
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  /* ---- canvas drawing: sweep ---- */
  const drawSweep = useCallback(
    (res: SweepResult, progress: number) => {
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

      const roofPx = PAD.t + 24
      const floorPx = CHART_H - PAD.b - 24
      const barW = Math.min(72, (w - PAD.l - PAD.r) / 5)
      const cx1 = PAD.l + (w - PAD.l - PAD.r) / 4
      const cx2 = PAD.l + ((w - PAD.l - PAD.r) * 3) / 4
      const maxBytes = res.bytesFetched * 1.15
      const hFor = (b: number) => floorPx - (b / maxBytes) * (floorPx - roofPx) * progress

      // axes
      ctx.strokeStyle = 'rgba(38,48,64,0.8)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD.l, roofPx)
      ctx.lineTo(PAD.l, floorPx)
      ctx.lineTo(w - PAD.r, floorPx)
      ctx.stroke()

      // labels
      ctx.fillStyle = '#5D6B80'
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText('0', PAD.l - 10, floorPx + 4)
      ctx.fillText(fmtBytes(maxBytes), PAD.l - 38, roofPx + 4)
      ctx.fillText('bytes fetched vs bytes used', PAD.l, CHART_H - 10)

      // roof line
      ctx.strokeStyle = '#FBBF2455'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(PAD.l, roofPx)
      ctx.lineTo(w - PAD.r, roofPx)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#FBBF24'
      ctx.fillText(`DRAM roof ${DRAM_ROOF_GBPS} GB/s`, PAD.l + 6, roofPx - 6)

      // fetched bar (red when wasteful)
      const fetchedH = hFor(res.bytesFetched)
      ctx.fillStyle = res.layout === 'aos' ? '#FF5C6C88' : '#22D3EE88'
      ctx.fillRect(cx1 - barW / 2, fetchedH, barW, floorPx - fetchedH)
      ctx.strokeStyle = res.layout === 'aos' ? '#FF5C6C' : '#22D3EE'
      ctx.strokeRect(cx1 - barW / 2, fetchedH, barW, floorPx - fetchedH)
      ctx.fillStyle = '#E6EDF7'
      ctx.fillText(fmtBytes(res.bytesFetched), cx1 - barW / 2 + 4, fetchedH - 6)
      ctx.fillText('fetched', cx1 - barW / 2 + 4, floorPx + 14)

      // used bar (green)
      const usedH = hFor(res.bytesUsed)
      ctx.fillStyle = '#3EF2A488'
      ctx.fillRect(cx2 - barW / 2, usedH, barW, floorPx - usedH)
      ctx.strokeStyle = '#3EF2A4'
      ctx.strokeRect(cx2 - barW / 2, usedH, barW, floorPx - usedH)
      ctx.fillStyle = '#E6EDF7'
      ctx.fillText(fmtBytes(res.bytesUsed), cx2 - barW / 2 + 4, usedH - 6)
      ctx.fillText('used', cx2 - barW / 2 + 4, floorPx + 14)

      // scanline
      if (progress < 1) {
        const scanX = PAD.l + (w - PAD.l - PAD.r) * progress
        ctx.strokeStyle = '#A78BFA'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(scanX, roofPx)
        ctx.lineTo(scanX, floorPx)
        ctx.stroke()
        ctx.setLineDash([])
      }
    },
    [width],
  )

  /* ---- canvas drawing: false sharing ---- */
  const drawFalse = useCallback(
    (res: FalseResult, progress: number) => {
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

      // 8 counters laid out as slots in a cache line (or one slot per line when padded)
      const slots = 8
      const slotW = Math.min(56, (w - PAD.l - PAD.r - 16) / slots)
      const startX = PAD.l + (w - PAD.l - PAD.r - slots * slotW) / 2
      const lineY = PAD.t + 40
      const lineH = 56

      // ownership ping-pong: deterministic based on progress
      const activeSlot = res.padded ? -1 : Math.floor(progress * slots * 12) % slots

      for (let i = 0; i < slots; i++) {
        const x = startX + i * slotW
        const isActive = i === activeSlot

        // background line per slot
        ctx.fillStyle = isActive ? '#FBBF2430' : '#22D3EE15'
        ctx.fillRect(x, lineY, slotW - 2, lineH)
        ctx.strokeStyle = isActive ? '#FBBF24' : '#5D6B80'
        ctx.lineWidth = isActive ? 2 : 1
        ctx.strokeRect(x, lineY, slotW - 2, lineH)

        // counter value
        const incSoFar = Math.floor(progress * 1000 * (i + 1) * (res.padded ? 1 : 0.7))
        ctx.fillStyle = '#E6EDF7'
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText(`${incSoFar}`, x + 6, lineY + 24)
        ctx.font = '9px ui-monospace, monospace'
        ctx.fillStyle = '#5D6B80'
        ctx.fillText(`T${i}`, x + 6, lineY + lineH - 8)
      }

      // connecting coherence arrows when unpadded
      if (!res.padded && activeSlot >= 0) {
        ctx.strokeStyle = '#FF5C6C'
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 3])
        for (let j = 0; j < slots; j++) {
          if (j === activeSlot) continue
          const x1 = startX + activeSlot * slotW + slotW / 2
          const y1 = lineY + lineH
          const x2 = startX + j * slotW + slotW / 2
          const y2 = lineY + lineH + 18
          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.quadraticCurveTo((x1 + x2) / 2, y1 + 24, x2, y2)
          ctx.stroke()
        }
        ctx.setLineDash([])
        ctx.fillStyle = '#FF5C6C'
        ctx.font = '10px ui-monospace, monospace'
        ctx.fillText('coherence invalidation', PAD.l, lineY + lineH + 42)
      }

      // throughput gauge
      const gaugeW = w - PAD.l - PAD.r
      const gaugeY = lineY + lineH + 72
      const gaugeH = 18
      const fillRatio = Math.min(1, res.throughputMips / 4000)
      ctx.fillStyle = '#262C3A'
      ctx.fillRect(PAD.l, gaugeY, gaugeW, gaugeH)
      ctx.fillStyle = res.padded ? '#3EF2A4' : '#FF5C6C'
      ctx.fillRect(PAD.l, gaugeY, gaugeW * fillRatio * progress, gaugeH)
      ctx.strokeStyle = '#5D6B80'
      ctx.strokeRect(PAD.l, gaugeY, gaugeW, gaugeH)
      ctx.fillStyle = '#E6EDF7'
      ctx.font = '11px ui-monospace, monospace'
      ctx.fillText(
        `throughput ${(res.throughputMips / 1000).toFixed(1)}M inc/ms`,
        PAD.l,
        gaugeY + gaugeH + 16,
      )
      if (!res.padded) {
        ctx.fillStyle = '#FF5C6C'
        ctx.fillText(`${res.pingPongs.toLocaleString()} line ping-pongs`, PAD.l, gaugeY + gaugeH + 32)
      } else {
        ctx.fillStyle = '#3EF2A4'
        ctx.fillText(
          `each counter owns a private line · ${res.ratio.toFixed(0)}× faster`,
          PAD.l,
          gaugeY + gaugeH + 32,
        )
      }
    },
    [width],
  )

  /* ---- sweep run ---- */
  const runSweep = useCallback(() => {
    tickRef.current += 1
    const t = tickRef.current
    setRunning(true)
    const res = runSweepModel(layout, count, t)
    setSweepResult(res)
    log(
      t,
      'SWEEP',
      `${layout.toUpperCase()} · ${fmtCount(count)} · fetched ${fmtBytes(res.bytesFetched)} · used ${fmtBytes(res.bytesUsed)} · ${fmtGbps(res.effectiveGbps)} effective`,
      res.layout === 'aos' ? 'warn' : 'ok',
    )
    if (res.layout === 'aos') {
      log(t, 'LAYOUT', 'AoS pulls a whole 64-byte line per record but only reads the 8-byte deadline', 'warn')
    } else {
      log(t, 'LAYOUT', 'SoA streams dense deadline values — nearly every fetched byte is useful', 'ok')
    }

    if (reducedMotion) {
      drawSweep(res, 1)
      setRunning(false)
      return
    }

    const start = performance.now()
    const animate = () => {
      const p = Math.min(1, (performance.now() - start) / 900)
      drawSweep(res, p)
      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        rafRef.current = null
        setRunning(false)
      }
    }
    rafRef.current = requestAnimationFrame(animate)
  }, [layout, count, log, reducedMotion, drawSweep])

  /* ---- false-sharing run ---- */
  const runFalse = useCallback(() => {
    tickRef.current += 1
    const t = tickRef.current
    setRunning(true)
    const res = runFalseModel(padded, t)
    setFalseResult(res)
    log(
      t,
      'FALSE',
      `${padded ? 'padded' : 'unpadded'} · ${(res.throughputMips / 1000).toFixed(1)}M inc/ms · ${res.pingPongs.toLocaleString()} coherence transfers`,
      padded ? 'ok' : 'warn',
    )
    if (padded) {
      log(t, 'LAYOUT', 'each counter owns a private 64-byte line — no ping-pong, L1-hot throughput', 'ok')
    } else {
      log(t, 'LAYOUT', 'all 8 counters share one line: every increment invalidates the other 7 caches', 'warn')
    }

    if (reducedMotion) {
      drawFalse(res, 1)
      setRunning(false)
      return
    }

    const start = performance.now()
    const animate = () => {
      const p = Math.min(1, (performance.now() - start) / 1400)
      drawFalse(res, p)
      if (p < 1) {
        rafRef.current = requestAnimationFrame(animate)
      } else {
        rafRef.current = null
        setRunning(false)
      }
    }
    rafRef.current = requestAnimationFrame(animate)
  }, [padded, log, reducedMotion, drawFalse])

  useEffect(() => {
    if (!sweepResult) return
    if (
      sweepResult.layout === 'aos' &&
      sweepResult.effectiveGbps <= DRAM_ROOF_GBPS * 0.2
    ) {
      completeSimTask(SIM_ID, 't-layout-aos', 60)
    }
    if (
      sweepResult.layout === 'soa' &&
      sweepResult.effectiveGbps >= DRAM_ROOF_GBPS * 0.85
    ) {
      completeSimTask(SIM_ID, 't-layout-soa', 60)
    }
  }, [sweepResult])

  useEffect(() => {
    if (!falseResult) return
    if (!falseResult.padded && falseResult.pingPongs >= falseResult.totalIncrements * 0.9) {
      completeSimTask(SIM_ID, 't-layout-false', 60)
    }
    if (
      falseResult.padded &&
      falseResult.pingPongs === 0 &&
      falseResult.ratio >= 10 &&
      falseResult.ratio <= 50
    ) {
      completeSimTask(SIM_ID, 't-layout-pad', 60)
    }
  }, [falseResult])

  /* ---- initial paint ---- */
  useEffect(() => {
    if (mode === 'sweep' && sweepResult) {
      drawSweep(sweepResult, 1)
    } else if (mode === 'false' && falseResult) {
      drawFalse(falseResult, 1)
    }
  }, [mode, sweepResult, falseResult, drawSweep, drawFalse])

  const reset = useCallback(() => {
    setSweepResult(null)
    setFalseResult(null)
    clear()
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    setRunning(false)
  }, [clear])

  const modeLabel = mode === 'sweep' ? 'AoS / SoA sweep' : 'false-sharing counter'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------- stage ------- */}
        <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              layout lab · {modeLabel}
            </span>
            {mode === 'sweep' && (
              <>
                <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                  layout {layout.toUpperCase()}
                </span>
                <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                  {fmtCount(count)}
                </span>
              </>
            )}
            {mode === 'false' && (
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                padding {padded ? 'on' : 'off'}
              </span>
            )}
            {sweepResult && mode === 'sweep' && (
              <span
                className="rounded-sm border px-2 py-0.5"
                style={{
                  color: sweepResult.layout === 'aos' ? '#FF5C6C' : '#3EF2A4',
                  borderColor: sweepResult.layout === 'aos' ? '#FF5C6C55' : '#3EF2A455',
                }}
              >
                {fmtGbps(sweepResult.effectiveGbps)} effective
              </span>
            )}
            {falseResult && mode === 'false' && (
              <span
                className="rounded-sm border px-2 py-0.5"
                style={{
                  color: falseResult.padded ? '#3EF2A4' : '#FF5C6C',
                  borderColor: falseResult.padded ? '#3EF2A455' : '#FF5C6C55',
                }}
              >
                {(falseResult.throughputMips / 1000).toFixed(1)}M inc/ms
              </span>
            )}
          </div>

          <div ref={wrapRef} className="w-full">
            <canvas
              ref={canvasRef}
              style={{ width: '100%', height: CHART_H }}
              role="img"
              aria-label={`Layout lab visualization. Current mode: ${modeLabel}.`}
            />
          </div>

          {mode === 'sweep' && (
            <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
              AoS fetches a whole 64-byte cache line for every record but only reads the 8-byte
              deadline. SoA reads the deadline array densely, so nearly every fetched byte is
              useful.
            </p>
          )}
          {mode === 'false' && (
            <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
              Coherence works at cache-line granularity. Eight independent counters in one line
              behave like one shared variable; padding each counter to its own line removes the
              ping-pong.
            </p>
          )}
        </div>

        {/* ------- control panel ------- */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
          <ControlGroup label="experiment">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={mode === 'sweep'} color="#22D3EE" onClick={() => setMode('sweep')}>
                AoS / SoA
              </ChipButton>
              <ChipButton active={mode === 'false'} color="#FBBF24" onClick={() => setMode('false')}>
                false sharing
              </ChipButton>
            </div>
          </ControlGroup>

          {mode === 'sweep' ? (
            <ControlGroup label="layout sweep">
              <div className="flex flex-wrap gap-1.5">
                <ChipButton active={layout === 'aos'} color="#FF5C6C" onClick={() => setLayout('aos')}>
                  AoS
                </ChipButton>
                <ChipButton active={layout === 'soa'} color="#3EF2A4" onClick={() => setLayout('soa')}>
                  SoA
                </ChipButton>
              </div>
              <SliderRow
                label="record count"
                value={countIdx}
                display={fmtCount(count)}
                min={COUNT_MIN}
                max={COUNT_MAX}
                step={1}
                onChange={setCountIdx}
              />
              <div className="rounded-sm border border-line bg-surface-2 p-2">
                <p className="font-mono text-[10px] text-text-3">
                  struct {'{'} u64 deadline; u64 a; u64 b; u64 c; {'}'} = {RECORD_SIZE} bytes
                </p>
                <p className="font-mono text-[10px] text-text-3">
                  sweep reads only <span className="text-text-1">deadline</span> ({U64} bytes/record)
                </p>
              </div>
            </ControlGroup>
          ) : (
            <ControlGroup label="false sharing">
              <div className="flex flex-wrap gap-1.5">
                <ChipButton active={!padded} color="#FF5C6C" onClick={() => setPadded(false)}>
                  unpadded
                </ChipButton>
                <ChipButton active={padded} color="#3EF2A4" onClick={() => setPadded(true)}>
                  64-byte pad
                </ChipButton>
              </div>
              <div className="rounded-sm border border-line bg-surface-2 p-2">
                <p className="font-mono text-[10px] text-text-3">
                  8 threads increment 8 independent u64 counters.
                </p>
                <p className="font-mono text-[10px] text-text-3">
                  {padded
                    ? 'Each counter is aligned to its own cache line.'
                    : 'All 8 counters fit in a single 64-byte cache line.'}
                </p>
              </div>
            </ControlGroup>
          )}

          <ControlGroup label="run">
            <button
              type="button"
              disabled={running}
              onClick={mode === 'sweep' ? runSweep : runFalse}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97] disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100"
            >
              <Play size={15} strokeWidth={2} /> run {mode === 'sweep' ? 'sweep' : 'counters'}
            </button>
            <button
              type="button"
              onClick={reset}
              className="w-full text-center font-mono text-[10px] text-text-3 transition-colors hover:text-danger"
            >
              clear results
            </button>
          </ControlGroup>

          {!embed && (
            <ControlGroup label="numbers" className="border-b-0">
              {mode === 'sweep' && sweepResult && (
                <div className="space-y-1 font-mono text-[10px] text-text-2">
                  <div className="flex justify-between">
                    <span>fetched</span>
                    <span className="text-text-1">{fmtBytes(sweepResult.bytesFetched)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>used</span>
                    <span className="text-text-1">{fmtBytes(sweepResult.bytesUsed)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>utilization</span>
                    <span className="text-text-1">
                      {((sweepResult.bytesUsed / sweepResult.bytesFetched) * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>time</span>
                    <span className="text-text-1">{sweepResult.timeMs.toFixed(2)} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>effective BW</span>
                    <span className="text-text-1">{fmtGbps(sweepResult.effectiveGbps)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>DRAM roof</span>
                    <span className="text-text-1">{DRAM_ROOF_GBPS} GB/s</span>
                  </div>
                </div>
              )}
              {mode === 'false' && falseResult && (
                <div className="space-y-1 font-mono text-[10px] text-text-2">
                  <div className="flex justify-between">
                    <span>increments</span>
                    <span className="text-text-1">{falseResult.totalIncrements.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>throughput</span>
                    <span className="text-text-1">
                      {(falseResult.throughputMips / 1000).toFixed(1)}M inc/ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>ping-pongs</span>
                    <span className="text-text-1">{falseResult.pingPongs.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>speedup vs unpadded</span>
                    <span className="text-text-1">{falseResult.ratio.toFixed(1)}×</span>
                  </div>
                </div>
              )}
              {((mode === 'sweep' && !sweepResult) || (mode === 'false' && !falseResult)) && (
                <p className="font-mono text-[10px] text-text-3">press run to generate measurements</p>
              )}
            </ControlGroup>
          )}
        </aside>
      </div>

      <LogConsole lines={lines} onClear={clear} />
    </div>
  )
}
