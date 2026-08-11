/**
 * SIM-06 · The Quantizer (sim-quant) — playground.md §9
 * Type a float → see bit anatomy FP32→FP16/BF16/FP8-E4M3/INT8/INT4,
 * dynamic range, reconstruction error, and why LLM weights tolerate it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Info, Trash2, Zap } from 'lucide-react'
import PlaygroundShell from '@/components/sims/PlaygroundShell'
import { Slider } from '@/components/ui/slider'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* shared in-sim infra (log console, hooks)                            */
/* ------------------------------------------------------------------ */

type LogKind = 'op' | 'ok' | 'warn' | 'err'
interface LogLine {
  id: number
  kind: LogKind
  text: string
}

const LOG_CLS: Record<LogKind, string> = {
  op: 'text-text-2',
  ok: 'text-accent',
  warn: 'text-amber',
  err: 'text-danger',
}

function useLog(initial: string) {
  const [lines, setLines] = useState<LogLine[]>([{ id: 0, kind: 'op', text: initial }])
  const idRef = useRef(1)
  const log = useCallback((kind: LogKind, text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: idRef.current++, kind, text }]
      return next.length > 220 ? next.slice(next.length - 220) : next
    })
  }, [])
  const clear = useCallback(() => setLines([]), [])
  return { lines, log, clear }
}

function LogConsole({ lines, onClear }: { lines: LogLine[]; onClear: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const [stick, setStick] = useState(true)
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (stick && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, stick, collapsed])

  const copy = () => {
    const text = lines.map((l) => `[t+${String(l.id).padStart(4, '0')}] ${l.text}`).join('\n')
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  const last = lines[lines.length - 1]
  return (
    <section
      aria-label="log console"
      className="overflow-hidden rounded-md border border-line bg-surface-2"
    >
      <div className="flex h-10 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">log</span>
        <span className="font-mono text-[11px] text-text-3">{lines.length} lines</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={copy}
            className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-text-1"
            aria-label="copy log"
          >
            {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-danger"
            aria-label="clear log"
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-text-1"
            aria-label={collapsed ? 'expand log' : 'collapse log'}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>
      {collapsed ? (
        <div className="truncate px-3 py-2 font-mono text-[12px] text-text-3">
          {last ? `[t+${String(last.id).padStart(4, '0')}] ${last.text}` : '—'}
        </div>
      ) : (
        <div
          ref={bodyRef}
          onMouseEnter={() => setStick(false)}
          onMouseLeave={() => setStick(true)}
          aria-live="polite"
          className="scrollbar-slim h-40 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.7]"
        >
          {lines.map((l) => (
            <div key={l.id} className={cn('whitespace-pre-wrap', LOG_CLS[l.kind])}>
              <span className="text-text-3">[t+{String(l.id).padStart(4, '0')}]</span> {l.text}
            </div>
          ))}
          {lines.length === 0 && <div className="text-text-3">— log cleared —</div>}
        </div>
      )}
    </section>
  )
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const fn = () => setReduced(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return reduced
}

/** Idempotent guided-task completion: records task + awards XP once. */
function useTaskAward(simId: string, log: (kind: LogKind, text: string) => void) {
  return useCallback(
    (taskId: string, xp: number, note: string) => {
      const st = useProgress.getState()
      if (st.sims[simId]?.tasksDone.includes(taskId)) return
      st.recordSimTask(simId, taskId)
      log('ok', `TASK ✓ ${note}  (+${xp} XP)`)
    },
    [simId, log],
  )
}

/* ------------------------------------------------------------------ */
/* quantization math                                                   */
/* ------------------------------------------------------------------ */

type RoundMode = 'rtn' | 'stoch'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function roundMant(raw: number, mode: RoundMode): number {
  if (mode === 'stoch') return Math.floor(raw + Math.random())
  const fl = Math.floor(raw)
  const d = raw - fl
  if (d > 0.5) return fl + 1
  if (d < 0.5) return fl
  return fl % 2 === 0 ? fl : fl + 1 // ties-to-even
}

interface FloatFmtDef {
  eBits: number
  mBits: number
  eMax: number // max unbiased exponent for finite encodings
  hasInf: boolean
}
const FP16_DEF: FloatFmtDef = { eBits: 5, mBits: 10, eMax: 15, hasInf: true }
const BF16_DEF: FloatFmtDef = { eBits: 8, mBits: 7, eMax: 127, hasInf: true }
const FP8_DEF: FloatFmtDef = { eBits: 4, mBits: 3, eMax: 8, hasInf: false } // E4M3: saturates, NaN-only

function quantizeFloat(x: number, f: FloatFmtDef, mode: RoundMode): { bits: number; value: number } {
  const total = 1 + f.eBits + f.mBits
  const bias = (1 << (f.eBits - 1)) - 1
  const eMin = 1 - bias
  const signBit = Object.is(x, -0) || x < 0 ? 1 : 0
  const signShift = signBit << (total - 1)
  const expMask = (1 << f.eBits) - 1
  const ax = Math.abs(x)
  const maxFinite = Math.pow(2, f.eMax) * (2 - Math.pow(2, -f.mBits) * (f.hasInf ? 1 : 2))

  if (Number.isNaN(ax)) return { bits: signShift | (expMask << f.mBits) | 1, value: NaN }
  if (ax === 0) return { bits: signShift, value: 0 }
  if (ax > maxFinite || !Number.isFinite(ax)) {
    if (f.hasInf)
      return { bits: signShift | (expMask << f.mBits), value: signBit ? -Infinity : Infinity }
    return {
      bits: signShift | (expMask << f.mBits) | ((1 << f.mBits) - 2),
      value: (signBit ? -1 : 1) * maxFinite,
    }
  }
  let e = Math.floor(Math.log2(ax))
  if (e >= eMin) {
    const base = Math.pow(2, e)
    let mant = roundMant((ax / base - 1) * (1 << f.mBits), mode)
    if (mant >= 1 << f.mBits) {
      mant = 0
      e += 1
    }
    if (e > f.eMax) {
      if (f.hasInf) return { bits: signShift | (expMask << f.mBits), value: signBit ? -Infinity : Infinity }
      return {
        bits: signShift | (expMask << f.mBits) | ((1 << f.mBits) - 2),
        value: (signBit ? -1 : 1) * maxFinite,
      }
    }
    if (!f.hasInf && e === f.eMax && mant > (1 << f.mBits) - 2) mant = (1 << f.mBits) - 2 // stay finite (E4M3)
    const bits = signShift | ((e + bias) << f.mBits) | mant
    const value = (signBit ? -1 : 1) * Math.pow(2, e) * (1 + mant / (1 << f.mBits))
    return { bits, value }
  }
  // subnormal
  const step = Math.pow(2, eMin - f.mBits)
  const q = roundMant(ax / step, mode)
  if (q === 0) return { bits: signShift, value: 0 }
  return { bits: signShift | q, value: (signBit ? -1 : 1) * q * step }
}

function fp32Of(x: number): { bits: number; value: number } {
  const dv = new DataView(new ArrayBuffer(4))
  dv.setFloat32(0, x)
  return { bits: dv.getUint32(0), value: dv.getFloat32(0) }
}

function quantizeInt(
  x: number,
  scale: number,
  zp: number,
  bits: 4 | 8,
  symmetric: boolean,
  mode: RoundMode,
): { q: number; dq: number } {
  const qmax = (1 << (bits - 1)) - 1
  const qmin = symmetric ? -qmax : -(1 << (bits - 1))
  const raw = x / scale + (symmetric ? 0 : zp)
  let q = mode === 'stoch' ? Math.floor(raw + Math.random()) : Math.round(raw)
  q = Math.min(qmax, Math.max(qmin, q))
  const dq = scale * (q - (symmetric ? 0 : zp))
  return { q, dq }
}

function bitsOf(value: number, width: number): boolean[] {
  const out: boolean[] = []
  for (let i = width - 1; i >= 0; i--) out.push(((value >>> i) & 1) === 1)
  return out
}

/* ------------------------------------------------------------------ */
/* tensor generation + histograms                                      */
/* ------------------------------------------------------------------ */

type TensorKind = 'normal' | 'llm' | 'outlier'

function genTensor(kind: TensorKind, seed: number, outlierSpike: boolean): number[] {
  const rng = mulberry32(seed)
  const gauss = () => {
    const u = Math.max(rng(), 1e-9)
    const v = rng()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  const n = 256
  const xs = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    if (kind === 'normal') xs[i] = gauss()
    else if (kind === 'llm') xs[i] = rng() < 0.03 ? gauss() * 0.16 : gauss() * 0.02 // heavy-ish tails
    else xs[i] = rng() < 0.06 ? (rng() < 0.5 ? -1 : 1) * (4 + rng() * 5) : gauss() * 0.8
  }
  if (outlierSpike) xs[7] = 47.3 // the channel-outlier spike (foreshadows AWQ/GPTQ)
  return xs
}

function histCounts(xs: number[], bins: number, lo: number, hi: number): number[] {
  const c = new Array<number>(bins).fill(0)
  const w = hi - lo || 1
  for (const x of xs) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(((x - lo) / w) * bins)))
    c[i] += 1
  }
  return c
}

function symKl(p: number[], q: number[]): number {
  const eps = 1e-6
  let sp = 0
  let sq = 0
  for (let i = 0; i < p.length; i++) {
    sp += p[i]
    sq += q[i]
  }
  let d = 0
  for (let i = 0; i < p.length; i++) {
    const a = (p[i] + eps) / (sp + eps * p.length)
    const b = (q[i] + eps) / (sq + eps * q.length)
    d += a * Math.log(a / b) + b * Math.log(b / a)
  }
  return d / 2
}

/* ------------------------------------------------------------------ */
/* UI registry                                                         */
/* ------------------------------------------------------------------ */

type FmtId = 'fp32' | 'fp16' | 'bf16' | 'fp8' | 'int8' | 'int4'

const SEG = {
  sign: { name: 'S', fill: '#FB7185' },
  exp: { name: 'E', fill: '#FFB224' },
  man: { name: 'M', fill: '#3EF2A4' },
  int: { name: 'Q', fill: '#3EF2A4' },
} as const

interface RowData {
  id: FmtId
  label: string
  sub: string
  bits: boolean[]
  seg: { count: number; fill: string; name: string }[]
  recon: number
  err: number
  rel: number
}

const TASKS = [
  { id: 'q-fp16', text: 'Quantize π (3.14159…) to FP16 and read the reconstruction error', xp: 60 },
  { id: 'q-int4-max', text: 'Find the largest exactly-representable INT4 value (zero error at q = ±7)', xp: 60 },
  { id: 'q-group-compare', text: 'Calibrate per-tensor INT4, then group-128; compare max error and distribution drift', xp: 60 },
  { id: 'q-outlier', text: 'Run the AWQ-style challenge: inject the 47.3 salient outlier, then rescue its group', xp: 60 },
]

const GROUP_SIZES = [256, 128, 64, 32, 16]

function fmtNum(x: number, digits = 6): string {
  if (!Number.isFinite(x)) return String(x)
  if (x === 0) return '0'
  const ax = Math.abs(x)
  if (ax >= 1e6 || ax < 1e-4) return x.toExponential(3)
  return String(Number(x.toPrecision(digits)))
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export default function QuantizerSim() {
  const reduced = useReducedMotion()
  const { lines, log, clear } = useLog('quantizer ready — type a float or load a tensor')
  const award = useTaskAward('sim-quant', log)

  const [input, setInput] = useState('3.14159')
  const [focus, setFocus] = useState<FmtId>('fp16')
  const [mode, setMode] = useState<RoundMode>('rtn')
  const [scale, setScale] = useState(0.5)
  const [zp, setZp] = useState(0)
  const [tensorKind, setTensorKind] = useState<TensorKind>('llm')
  const [outlier, setOutlier] = useState(false)
  const [groupSize, setGroupSize] = useState(128)
  const [hoverBit, setHoverBit] = useState<string>('hover a bit cell to see its weight')

  const x = useMemo(() => {
    const v = Number(input)
    return Number.isFinite(v) ? v : 0
  }, [input])
  const inputValid = input.trim() !== '' && Number.isFinite(Number(input))

  /* scalar rows */
  const rows = useMemo<RowData[]>(() => {
    const mk = (
      id: FmtId,
      label: string,
      sub: string,
      bits: boolean[],
      seg: RowData['seg'],
      recon: number,
    ): RowData => ({
      id,
      label,
      sub,
      bits,
      seg,
      recon,
      err: recon - x,
      rel: x !== 0 ? (recon - x) / Math.abs(x) : 0,
    })
    const f32 = fp32Of(x)
    const f16 = quantizeFloat(x, FP16_DEF, mode)
    const bf = quantizeFloat(x, BF16_DEF, mode)
    const f8 = quantizeFloat(x, FP8_DEF, mode)
    const i8 = quantizeInt(x, scale, zp, 8, false, mode)
    const i4 = quantizeInt(x, scale, 0, 4, true, mode)
    return [
      mk('fp32', 'FP32', '1 · 8 · 23 — the source of truth', bitsOf(f32.bits, 32), [
        { count: 1, ...SEG.sign },
        { count: 8, ...SEG.exp },
        { count: 23, ...SEG.man },
      ], f32.value),
      mk('fp16', 'FP16', '1 · 5 · 10 — half the bits, ±65504 range', bitsOf(f16.bits, 16), [
        { count: 1, ...SEG.sign },
        { count: 5, ...SEG.exp },
        { count: 10, ...SEG.man },
      ], f16.value),
      mk('bf16', 'BF16', '1 · 8 · 7 — FP32 range, FP16 size', bitsOf(bf.bits, 16), [
        { count: 1, ...SEG.sign },
        { count: 8, ...SEG.exp },
        { count: 7, ...SEG.man },
      ], bf.value),
      mk('fp8', 'FP8', 'E4M3 · 1 · 4 · 3 — ±448, saturates', bitsOf(f8.bits, 8), [
        { count: 1, ...SEG.sign },
        { count: 4, ...SEG.exp },
        { count: 3, ...SEG.man },
      ], f8.value),
      mk('int8', 'INT8', `q·s+z · s=${scale.toFixed(2)} z=${zp}`, bitsOf(i8.q < 0 ? i8.q + 256 : i8.q, 8), [
        { count: 1, ...SEG.sign },
        { count: 7, ...SEG.int },
      ], i8.dq),
      mk('int4', 'INT4', `sym q·s · s=${scale.toFixed(2)} · q∈[-7,7]`, bitsOf(i4.q < 0 ? i4.q + 16 : i4.q, 4), [
        { count: 1, ...SEG.sign },
        { count: 3, ...SEG.int },
      ], i4.dq),
    ]
  }, [x, mode, scale, zp])

  const focusRow = rows.find((r) => r.id === focus) ?? rows[0]

  /* tensor pipeline */
  const tensor = useMemo(() => genTensor(tensorKind, 0xc0ffee, outlier), [tensorKind, outlier])
  const quantTensor = useMemo(() => {
    const isInt = focus === 'int8' || focus === 'int4'
    if (!isInt) {
      const def = focus === 'fp16' ? FP16_DEF : focus === 'bf16' ? BF16_DEF : focus === 'fp8' ? FP8_DEF : null
      if (!def) return tensor.slice()
      return tensor.map((v) => quantizeFloat(v, def, 'rtn').value)
    }
    const bits = focus === 'int8' ? 8 : 4
    const symmetric = focus === 'int4'
    const qmax = (1 << (bits - 1)) - 1
    const out = new Array<number>(tensor.length)
    for (let g = 0; g < tensor.length; g += groupSize) {
      const group = tensor.slice(g, g + groupSize)
      const maxAbs = Math.max(...group.map((v) => Math.abs(v)), 1e-9)
      const s = maxAbs / qmax
      for (let j = 0; j < group.length; j++) {
        out[g + j] = quantizeInt(group[j], s, symmetric ? 0 : zp, bits, symmetric, 'rtn').dq
      }
    }
    return out
  }, [tensor, focus, groupSize, zp])

  const hist = useMemo(() => {
    const bins = 44
    let lo = Math.min(...tensor)
    let hi = Math.max(...tensor)
    if (lo === hi) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.04
    lo -= pad
    hi += pad
    return { lo, hi, bins, orig: histCounts(tensor, bins, lo, hi), quant: histCounts(quantTensor, bins, lo, hi) }
  }, [tensor, quantTensor])
  const drift = useMemo(() => symKl(hist.orig, hist.quant), [hist])
  const tensorMaxError = useMemo(
    () => tensor.reduce((max, value, i) => Math.max(max, Math.abs(quantTensor[i] - value)), 0),
    [tensor, quantTensor],
  )

  /* canvases */
  const sparkRef = useRef<HTMLCanvasElement>(null)
  const histRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = sparkRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = cv.clientWidth
    const h = cv.clientHeight
    cv.width = w * dpr
    cv.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const lo = Math.min(...tensor)
    const hi = Math.max(...tensor)
    const span = hi - lo || 1
    ctx.beginPath()
    tensor.forEach((v, i) => {
      const px = (i / (tensor.length - 1)) * w
      const py = h - 4 - ((v - lo) / span) * (h - 8)
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.strokeStyle = '#3EF2A4'
    ctx.lineWidth = 1.25
    ctx.stroke()
    const zy = h - 4 - ((0 - lo) / span) * (h - 8)
    if (zy >= 0 && zy <= h) {
      ctx.strokeStyle = 'rgba(93,107,128,.4)'
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(0, zy)
      ctx.lineTo(w, zy)
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (outlier) {
      const px = (7 / (tensor.length - 1)) * w
      const py = h - 4 - ((tensor[7] - lo) / span) * (h - 8)
      ctx.fillStyle = '#FF5C6C'
      ctx.beginPath()
      ctx.arc(px, Math.max(py, 3), 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [tensor, outlier])

  useEffect(() => {
    const cv = histRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = cv.clientWidth
    const h = cv.clientHeight
    cv.width = w * dpr
    cv.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const maxC = Math.max(...hist.orig, ...hist.quant, 1)
    const bw = w / hist.bins
    ctx.strokeStyle = 'rgba(62,242,164,.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    hist.orig.forEach((c, i) => {
      const bh = (c / maxC) * (h - 14)
      ctx.strokeRect(i * bw + 0.5, h - bh - 0.5, bw, bh)
    })
    ctx.fillStyle = 'rgba(255,178,36,.5)'
    hist.quant.forEach((c, i) => {
      const bh = (c / maxC) * (h - 14)
      ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh)
    })
    ctx.fillStyle = '#5D6B80'
    ctx.font = '10px "JetBrains Mono", monospace'
    ctx.fillText(fmtNum(hist.lo, 3), 2, h - 2)
    const hiTxt = fmtNum(hist.hi, 3)
    ctx.fillText(hiTxt, w - ctx.measureText(hiTxt).width - 2, h - 2)
  }, [hist])

  /* task detection */
  useEffect(() => {
    if (Math.abs(x - Math.PI) < 2e-5 && focus === 'fp16') {
      const r = rows.find((rr) => rr.id === 'fp16')
      if (r) award('q-fp16', 60, `π → FP16 = ${fmtNum(r.recon)} (Δ ${fmtNum(r.err, 3)})`)
    }
  }, [x, focus, rows, award])

  useEffect(() => {
    if (focus !== 'int4') return
    const r = rows.find((rr) => rr.id === 'int4')
    if (!r) return
    const q = Math.round(x / scale)
    if (Math.abs(q) === 7 && Math.abs(r.err) < 1e-9) {
      award('q-int4-max', 60, `INT4 max exact: ${fmtNum(x)} = 7 × s(${scale.toFixed(2)})`)
    }
  }, [x, focus, scale, rows, award])

  const perTensorRunRef = useRef<{
    tensorKind: TensorKind
    outlier: boolean
    maxError: number
    drift: number
  } | null>(null)
  useEffect(() => {
    if (focus !== 'int4') return
    if (groupSize === 256) {
      perTensorRunRef.current = { tensorKind, outlier, maxError: tensorMaxError, drift }
      return
    }
    const perTensor = perTensorRunRef.current
    if (
      groupSize === 128 &&
      perTensor &&
      perTensor.tensorKind === tensorKind &&
      perTensor.outlier === outlier
    ) {
      award(
        'q-group-compare',
        60,
        `per-tensor→group-128: max error ${fmtNum(perTensor.maxError, 3)}→${fmtNum(tensorMaxError, 3)}, drift ${perTensor.drift.toFixed(2)}→${drift.toFixed(2)} nats`,
      )
    }
  }, [focus, groupSize, tensorKind, outlier, tensorMaxError, drift, award])

  useEffect(() => {
    if (outlier && (focus === 'int8' || focus === 'int4') && groupSize <= 16) {
      award('q-outlier', 60, `outlier contained: group ${groupSize} → drift ${drift.toFixed(2)} nats`)
    }
  }, [outlier, focus, groupSize, drift, award])

  /* log metrics for each integer tensor run */
  const prevDriftRef = useRef<{
    g: number
    d: number
    e: number
    tensorKind: TensorKind
    outlier: boolean
    focus: 'int8' | 'int4'
  } | null>(null)
  useEffect(() => {
    if (focus !== 'int8' && focus !== 'int4') return
    const prev = prevDriftRef.current
    const sameTensor = prev?.tensorKind === tensorKind && prev.outlier === outlier && prev.focus === focus
    if (!prev || prev.g !== groupSize || !sameTensor) {
      const label = groupSize === 256 ? 'per-tensor' : `group-${groupSize}`
      log('op', `${label}: max error ${fmtNum(tensorMaxError, 3)}, drift ${drift.toFixed(2)} nats`)
      if (prev && sameTensor && outlier) {
        log(
          drift < prev.d ? 'ok' : 'warn',
          `GROUP ${prev.g}→${groupSize}  max error ${fmtNum(prev.e, 3)}→${fmtNum(tensorMaxError, 3)} · drift ${prev.d.toFixed(2)}→${drift.toFixed(2)} nats ${drift < prev.d ? '✓ rescued' : '✗ worse'}`,
        )
      }
      prevDriftRef.current = { g: groupSize, d: drift, e: tensorMaxError, tensorKind, outlier, focus }
    }
  }, [groupSize, drift, tensorMaxError, tensorKind, focus, outlier, log])

  const toggleOutlier = () => {
    setOutlier(!outlier)
    log('warn', !outlier ? 'OUTLIER injected: x[7] ← 47.3 (one channel ruins the absmax scale)' : 'outlier removed')
  }

  const maxErr = Math.max(...rows.map((r) => Math.abs(r.err)), 1e-12)

  return (
    <PlaygroundShell
      simId="sim-quant"
      title="The Quantizer"
      subtitle="FP32 → FP16 · BF16 · FP8 · INT4 — watch what your weights lose"
      tasks={TASKS}
    >
      <div className="flex flex-col gap-4">
        {/* ---- row 1: input + tensor ---- */}
        <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
          {/* input zone */}
          <section className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-2 font-mono text-label uppercase tracking-[0.10em] text-text-3">
              input scalar
            </div>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              inputMode="decimal"
              spellCheck={false}
              aria-label="float value to quantize"
              placeholder="type a float…"
              className={cn(
                'w-full rounded-sm border bg-surface-2 px-3 py-2 font-mono text-[24px] text-text-1 outline-none transition-colors duration-180',
                inputValid ? 'border-line focus:border-accent' : 'border-danger',
              )}
            />
            <div className="mt-1 h-4 font-mono text-[11px] text-text-3">
              {inputValid ? (
                <>
                  fp32 exact: <span className="text-text-2">{fmtNum(fp32Of(x).value, 8)}</span>
                </>
              ) : (
                <span className="text-danger">not a number — defaulting to 0</span>
              )}
            </div>

            {/* format focus tabs */}
            <div className="mt-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="focus format">
              {rows.map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  aria-selected={focus === r.id}
                  onClick={() => setFocus(r.id)}
                  className={cn(
                    'rounded-sm border px-2.5 py-1 font-mono text-[12px] uppercase transition-all duration-180 active:scale-[.97]',
                    focus === r.id
                      ? 'border-accent bg-accent-dim text-accent'
                      : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
                  )}
                >
                  {r.label}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1 rounded-sm border border-line bg-surface-2 p-0.5">
                {(['rtn', 'stoch'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMode(m)
                      log('op', `ROUNDING → ${m === 'rtn' ? 'round-to-nearest-even' : 'stochastic'}`)
                    }}
                    className={cn(
                      'rounded-[4px] px-2 py-0.5 font-mono text-[11px] uppercase transition-colors duration-180',
                      mode === m ? 'bg-surface-3 text-accent' : 'text-text-3 hover:text-text-1',
                    )}
                  >
                    {m === 'rtn' ? 'RTN' : 'stochastic'}
                  </button>
                ))}
              </div>
            </div>

            {/* int controls */}
            <div className={cn('mt-4 grid gap-4 sm:grid-cols-2', focus !== 'int8' && focus !== 'int4' && 'opacity-40')}>
              <div>
                <div className="mb-1 flex justify-between font-mono text-[11px] text-text-3">
                  <span>scale s</span>
                  <span className="text-text-1">{scale.toFixed(2)}</span>
                </div>
                <Slider
                  value={[scale]}
                  onValueChange={(v) => setScale(v[0])}
                  min={0.05}
                  max={2}
                  step={0.05}
                  aria-label="quantization scale"
                />
              </div>
              <div className={cn(focus !== 'int8' && 'pointer-events-none opacity-40')}>
                <div className="mb-1 flex justify-between font-mono text-[11px] text-text-3">
                  <span>zero-point z (INT8)</span>
                  <span className="text-text-1">{zp}</span>
                </div>
                <Slider
                  value={[zp]}
                  onValueChange={(v) => setZp(Math.round(v[0]))}
                  min={-128}
                  max={127}
                  step={1}
                  aria-label="zero point"
                />
              </div>
            </div>
            <div className="mt-3 rounded-sm border border-line bg-surface-2 px-3 py-2 font-mono text-[12px]">
              <span className="text-text-3">reconstructed ({focusRow.label}): </span>
              <span className="text-accent">{fmtNum(focusRow.recon, 7)}</span>
              <span className="text-text-3">  Δ </span>
              <span className={Math.abs(focusRow.rel) > 0.01 ? 'text-amber' : 'text-text-2'}>
                {fmtNum(focusRow.err, 3)} ({(focusRow.rel * 100).toFixed(3)}%)
              </span>
            </div>
          </section>

          {/* tensor zone */}
          <section className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">load tensor</span>
              <span className="font-mono text-[11px] text-text-3">256 vals</span>
            </div>
            <div className="mb-2 flex gap-1">
              {(
                [
                  ['normal', 'normal dist'],
                  ['llm', 'LLM weights'],
                  ['outlier', 'outlier-heavy'],
                ] as [TensorKind, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => {
                    setTensorKind(k)
                    log('op', `TENSOR loaded: ${label} (seed 0xC0FFEE)`)
                  }}
                  className={cn(
                    'flex-1 rounded-sm border px-1.5 py-1 font-mono text-[11px] transition-all duration-180 active:scale-[.97]',
                    tensorKind === k
                      ? 'border-accent bg-accent-dim text-accent'
                      : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <canvas ref={sparkRef} className="h-20 w-full rounded-sm border border-line bg-ink" />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                onClick={toggleOutlier}
                className={cn(
                  'flex items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[11px] transition-all duration-180 active:scale-[.97]',
                  outlier
                    ? 'border-danger bg-danger/10 text-danger'
                    : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                )}
              >
                <Zap size={12} />
                outlier 47.3 {outlier ? 'ON' : 'off'}
              </button>
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-text-3">scale</span>
                {GROUP_SIZES.map((g) => {
                  const label = g === 256 ? 'tensor' : String(g)
                  return (
                    <button
                      key={g}
                      onClick={() => setGroupSize(g)}
                      aria-label={g === 256 ? 'per-tensor scale, group size 256' : `per-group scale, group size ${g}`}
                      className={cn(
                        'rounded-sm border px-1.5 py-0.5 font-mono text-[11px] transition-colors duration-180',
                        groupSize === g
                          ? 'border-accent bg-accent-dim text-accent'
                          : 'border-line bg-surface-2 text-text-3 hover:text-text-1',
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>
        </div>

        {/* ---- bit anatomy ---- */}
        <section className="rounded-md border border-line bg-surface-1 p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">
              bit anatomy — same value, six encodings
            </span>
            <span className="font-mono text-[11px] text-text-3" aria-live="polite">
              {hoverBit}
            </span>
          </div>
          <div className="mb-3 flex gap-4 font-mono text-[10px] text-text-3">
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-[1px]" style={{ background: SEG.sign.fill }} />
              sign
            </span>
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-[1px]" style={{ background: SEG.exp.fill }} />
              exponent
            </span>
            <span>
              <i className="mr-1 inline-block h-2 w-2 rounded-[1px]" style={{ background: SEG.man.fill }} />
              mantissa / int payload
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => setFocus(r.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setFocus(r.id)
                }}
                className={cn(
                  'group grid cursor-pointer grid-cols-[52px_1fr_auto] items-center gap-3 rounded-sm border px-2 py-1.5 text-left transition-colors duration-180',
                  focus === r.id ? 'border-accent/60 bg-accent-dim/30' : 'border-transparent hover:border-line',
                )}
              >
                <span className="font-mono text-[12px] font-medium text-text-1">{r.label}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-[2px]">
                  {r.bits.map((b, i) => {
                    let acc = 0
                    let fill: string = SEG.man.fill
                    let segName = 'M'
                    let segIdx = i
                    for (const s of r.seg) {
                      if (i < acc + s.count) {
                        fill = s.fill
                        segName = s.name
                        segIdx = i - acc
                        break
                      }
                      acc += s.count
                    }
                    const info =
                      segName === 'S'
                        ? `${r.label} bit ${i}: sign ±1`
                        : segName === 'E'
                          ? `${r.label} bit ${i}: exponent value 2^${r.seg[1].count - 1 - segIdx} (before bias)`
                          : r.id === 'int8' || r.id === 'int4'
                            ? `${r.label} bit ${i}: payload 2^${r.bits.length - 1 - i} × s`
                            : `${r.label} bit ${i}: mantissa 2^-${segIdx + 1}`
                    return (
                      <span
                        key={i}
                        onMouseEnter={() => setHoverBit(info)}
                        className={cn('h-[18px] w-[18px] rounded-[2px] border', !reduced && 'transition-all duration-300')}
                        style={{
                          transitionDelay: reduced ? undefined : `${i * 15}ms`,
                          background: b ? fill : '#182130',
                          borderColor: b ? fill : '#1E2937',
                        }}
                        title={info}
                      />
                    )
                  })}
                </span>
                <span className="whitespace-nowrap font-mono text-[11px] text-text-2">
                  {fmtNum(r.recon, 5)}{' '}
                  <span className={Math.abs(r.rel) > 0.01 ? 'text-amber' : 'text-text-3'}>
                    Δ{fmtNum(r.err, 2)}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2 font-mono text-[11px] text-text-3">{focusRow.sub}</div>
        </section>

        {/* ---- error zone ---- */}
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-3 font-mono text-label uppercase tracking-[0.10em] text-text-3">
              abs reconstruction error (log scale)
            </div>
            <div className="flex h-36 items-end gap-2">
              {rows.map((r) => {
                const ae = Math.abs(r.err)
                const h = 8 + (92 * (Math.log10(ae + 1e-12) + 12)) / (Math.log10(maxErr + 1e-12) + 12 || 1)
                return (
                  <div key={r.id} className="flex flex-1 flex-col items-center gap-1">
                    <span className="font-mono text-[10px] text-text-3">{fmtNum(ae, 2)}</span>
                    <div
                      className={cn(
                        'w-full rounded-t-sm',
                        focus === r.id ? 'bg-accent' : 'bg-surface-3',
                        !reduced && 'transition-all duration-300 ease-out-expo',
                      )}
                      style={{ height: `${Math.max(3, h)}%` }}
                    />
                    <span className={cn('font-mono text-[10px]', focus === r.id ? 'text-accent' : 'text-text-3')}>
                      {r.label}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1 font-mono text-[11px] text-text-3">
                <span>
                  tensor: original (mint) vs {focusRow.label}-quantized (amber)
                  {(focus === 'int8' || focus === 'int4') && ` · ${groupSize === 256 ? 'per-tensor' : `group-${groupSize}`}`}
                </span>
                <span className="flex gap-1">
                  <span className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 text-amber">
                    max error {fmtNum(tensorMaxError, 3)}
                  </span>
                  <span className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 text-amber">
                    drift {drift.toFixed(2)} nats
                  </span>
                </span>
              </div>
              <canvas ref={histRef} className="h-28 w-full rounded-sm border border-line bg-ink" />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-md border border-info/30 bg-surface-1 p-4">
            <div className="flex items-center gap-2 font-mono text-label uppercase tracking-[0.10em] text-info">
              <Info size={13} /> why LLM weights tolerate this
            </div>
            <p className="text-body-sm text-text-2">
              A 7B model stores ~7,000,000,000 weights. Quantizing FP16→INT4 adds roughly{' '}
              <span className="font-mono text-text-1">±7%</span> relative noise per weight — yet perplexity
              barely moves. Three reasons:
            </p>
            <ul className="list-none space-y-2 text-body-sm text-text-2">
              <li className="flex gap-2">
                <span className="font-mono text-accent">01</span>
                <span>
                  <b className="text-text-1">Weights are small and gaussian-ish.</b> ~99% sit within a narrow
                  band around 0, so a per-tensor absmax scale already fits them well — the dynamic range of
                  FP16 is mostly wasted on weights.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-accent">02</span>
                <span>
                  <b className="text-text-1">Networks are over-parameterized noise-averagers.</b> Each output
                  sums thousands of weighted terms; independent rounding errors partially cancel (error grows
                  ~√n while signal grows ~n). Training also makes the loss flat in most weight directions.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-mono text-amber">03</span>
                <span>
                  <b className="text-text-1">Outliers are the real enemy.</b> One{' '}
                  <span className="font-mono text-danger">47.3</span> in a group forces{' '}
                  <span className="font-mono">s = max/7</span> and crushes every other value to 0. Fix it with
                  smaller groups (your slider), per-channel scales, or keeping outliers in FP16 — that's the
                  whole game behind <span className="font-mono text-text-1">AWQ / GPTQ</span>.
                </span>
              </li>
            </ul>
            <div className="mt-auto rounded-sm border border-line bg-surface-2 px-3 py-2 font-mono text-[11px] text-text-3">
              rule of thumb: FP16 → BF16 is free · FP8 costs ~nothing with scales · INT4 needs per-group
              scales · activations (not weights) are where quantization goes to die
            </div>
          </section>
        </div>

        <LogConsole lines={lines} onClear={clear} />
      </div>
    </PlaygroundShell>
  )
}
