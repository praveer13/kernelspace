/**
 * SIM-04 `sim-roofline` — Roofline Model Playground (playground.md §7).
 * Hand-rolled canvas log-log chart: bandwidth roof + compute ceiling meeting at
 * the ridge point. Hardware presets with 400ms line morphs, a plottable kernel
 * library (prefill compute-bound vs decode bandwidth-bound), a scrubbing
 * intensity guide, and quantized ceilings that raise the roof.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, TrendingUp } from 'lucide-react'
import PlaygroundShell, {
  ChipButton,
  ControlGroup,
  InlineQuiz,
  LogConsole,
  SliderRow,
  TransportBar,
  completeSimTask,
  useInitialCfg,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
  useWriteCfg,
} from '@/components/sims/PlaygroundShell'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SIM_ID = 'sim-roofline'

interface Machine {
  name: string
  bw: number // GB/s
  peak: number // GFLOP/s
}

const PRESETS: Machine[] = [
  { name: 'T4', bw: 320, peak: 65_000 },
  { name: 'RTX 4090', bw: 1008, peak: 165_000 },
  { name: 'A100', bw: 1555, peak: 312_000 },
  { name: 'H100', bw: 3350, peak: 989_000 },
]

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

const X_MIN = -7 // log2 FLOPs/byte
const X_MAX = 10
const Y_MIN = 7 // log2 GFLOP/s
const Y_MAX = 22

const BATCH_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]

const fmtAI = (v: number): string =>
  v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toPrecision(2)

const fmtRate = (g: number): string =>
  g >= 1000 ? `${(g / 1000).toFixed(g >= 100_000 ? 0 : 1)} TFLOP/s` : `${g.toFixed(0)} GFLOP/s`

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

interface RoofCfg {
  m: string // preset name
  bw: number
  peak: number
  batch: number
  quant: boolean
  guide: number // log2 AI
}

interface PlottedPoint {
  kernelId: string
  at: number // ms timestamp for pop animation
}

export default function RooflineSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const initialCfg = useInitialCfg<RoofCfg>()
  const initialPreset = PRESETS.find((p) => p.name === initialCfg?.m) ?? PRESETS[3]

  const [preset, setPreset] = useState<string>(initialPreset.name)
  const [bw, setBw] = useState(initialCfg?.bw ?? initialPreset.bw)
  const [peak, setPeak] = useState(initialCfg?.peak ?? initialPreset.peak)
  const [batch, setBatch] = useState(initialCfg?.batch ?? 1)
  const [quant, setQuant] = useState(initialCfg?.quant ?? false)
  const [guide, setGuide] = useState(initialCfg?.guide ?? 0) // log2 AI
  const [points, setPoints] = useState<PlottedPoint[]>([])
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  const ticksRef = useRef(0)
  const [ticks, setTicks] = useState(0)
  const bump = useCallback(() => {
    ticksRef.current += 1
    setTicks(ticksRef.current)
    return ticksRef.current
  }, [])

  useWriteCfg({ m: preset, bw, peak, batch, quant, guide } satisfies RoofCfg)

  /* animated (morphing) machine values */
  const animRef = useRef({ bw: initialPreset.bw, peak: initialPreset.peak })
  const targetRef = useRef({ bw: initialPreset.bw, peak: initialPreset.peak })
  useEffect(() => {
    targetRef.current = { bw, peak }
  }, [bw, peak])

  const ridgeAI = peak / bw
  const guideAI = 2 ** guide
  const guideBound: 'bandwidth' | 'compute' = guideAI < ridgeAI ? 'bandwidth' : 'compute'

  const decodeAI = batch
  const decodePlotted = points.some((p) => p.kernelId === 'decode')

  /* ------------------------------ plotting ------------------------------ */
  const plotKernel = useCallback(
    (k: KernelDef) => {
      bump()
      setPoints((prev) => {
        if (prev.some((p) => p.kernelId === k.id)) return prev
        return [...prev, { kernelId: k.id, at: performance.now() }]
      })
      const ai = k.id === 'decode' ? decodeAI : k.ai
      const roof = Math.min(peak, bw * ai)
      const bound = ai < peak / bw ? 'bandwidth-bound' : 'compute-bound'
      log(
        ticksRef.current,
        'PLOT',
        `${k.label} — AI ${fmtAI(ai)} → ${fmtRate(k.frac * roof)} (${bound})`,
        k.id === 'decode' || k.id === 'prefill' ? 'warn' : 'ok',
      )
      if (k.id === 'decode') completeSimTask(SIM_ID, 't-decode', 60)
    },
    [bump, bw, decodeAI, log, peak],
  )

  /* batch moves decode right until it crosses the ridge */
  useEffect(() => {
    if (decodePlotted && decodeAI >= ridgeAI) completeSimTask(SIM_ID, 't-batch', 60)
  }, [decodePlotted, decodeAI, ridgeAI])

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
    },
    [log],
  )

  const reset = useCallback(() => {
    setPoints([])
    setBatch(1)
    setGuide(0)
    setPlaying(false)
    ticksRef.current = 0
    setTicks(0)
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

  /* ------------------------------ canvas ------------------------------ */
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({ quant, guide, points, batch, decodeAI, reducedMotion, preset })
  useEffect(() => {
    stateRef.current = { quant, guide, points, batch, decodeAI, reducedMotion, preset }
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

      const { bw: aBw, peak: aPeak } = anim
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

      /* quantized ceilings */
      if (s.quant) {
        ctx.setLineDash([6, 5])
        ctx.lineWidth = 1.5
        const ceilings: [number, string][] = [
          [aPeak * 2, 'INT8 ×2'],
          [aPeak * 4, 'INT4 ×4'],
        ]
        for (const [ceil, label] of ceilings) {
          const ly = Math.log2(ceil)
          if (ly > Y_MAX) continue
          ctx.strokeStyle = '#A78BFA'
          ctx.globalAlpha = 0.7
          ctx.beginPath()
          ctx.moveTo(xMap(X_MIN), yMap(ly))
          ctx.lineTo(xMap(X_MAX), yMap(ly))
          ctx.stroke()
          ctx.globalAlpha = 1
          ctx.fillStyle = '#A78BFA'
          ctx.textAlign = 'left'
          ctx.fillText(label, xMap(X_MIN) + 6, yMap(ly) - 5)
        }
        ctx.setLineDash([])
      }

      /* ceiling label */
      ctx.fillStyle = '#5D6B80'
      ctx.textAlign = 'right'
      ctx.fillText(`FP16 ceiling · ${fmtRate(aPeak)}`, xMap(X_MAX) - 4, yMap(Math.log2(aPeak)) - 6)

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
        const k = KERNELS.find((kk) => kk.id === p.kernelId)
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
      tasks={[
        { id: 't-decode', text: 'Plot decode @ 70B and name its bound (bandwidth)', xp: 60 },
        { id: 't-batch', text: 'Batch decode right until it hits the compute roof', xp: 60 },
        { id: 't-quiz', text: 'Explain why a faster-FLOPs GPU does nothing for decode', xp: 60 },
      ]}
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
            ceiling. This is the entire economics of LLM serving.
          </p>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ------- stage ------- */}
          <div className="relative min-h-[420px] flex-1 bg-ink bg-blueprint">
            <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
              <span className="flex items-center gap-1.5 rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                <TrendingUp size={11} strokeWidth={1.75} className="text-accent" />
                {preset} · {bw} GB/s · {fmtRate(peak)}
              </span>
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                ridge @ {fmtAI(ridgeAI)} F/B
              </span>
            </div>
            <div ref={wrapRef} className="absolute inset-0">
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
                role="img"
                aria-label={`Roofline chart for ${preset}: ridge point at ${fmtAI(ridgeAI)} FLOPs per byte. Guide at intensity ${fmtAI(guideAI)}, ${guideBound}-bound.`}
              />
            </div>
          </div>

          {/* ------- control panel ------- */}
          <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
            <ControlGroup label="hardware">
              <Select value={preset} onValueChange={applyPreset}>
                <SelectTrigger className="h-8 border-line bg-surface-2 font-mono text-[12px]">
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
                max={4000}
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
              <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                quantized ceilings
                <Switch checked={quant} onCheckedChange={setQuant} />
              </label>
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
                {fmtRate(Math.min(peak, bw * guideAI))}
              </p>
              <SliderRow
                label="batch size → (shifts decode)"
                value={BATCH_STEPS.indexOf(batch)}
                display={`×${batch}`}
                min={0}
                max={BATCH_STEPS.length - 1}
                step={1}
                onChange={(i) => setBatch(BATCH_STEPS[i])}
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
                  completeSimTask(SIM_ID, 't-quiz', 60)
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
