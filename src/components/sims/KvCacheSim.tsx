/**
 * SIM-07 · KV-Cache Calculator (sim-kv) — playground.md §10
 * memory/token = 2 × layers × H_kv × head_dim × bytes — a form with live
 * consequences: formula-linked sliders, HBM budget bar, OOM stamp.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Copy, Trash2 } from 'lucide-react'
import PlaygroundShell from '@/components/sims/PlaygroundShell'
import { Slider } from '@/components/ui/slider'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* shared in-sim infra                                                 */
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
    <section aria-label="log console" className="overflow-hidden rounded-md border border-line bg-surface-2">
      <div className="flex h-10 items-center gap-2 border-b border-line px-3">
        <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">log</span>
        <span className="font-mono text-[11px] text-text-3">{lines.length} lines</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={copy} aria-label="copy log" className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-text-1">
            {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
          </button>
          <button type="button" onClick={onClear} aria-label="clear log" className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-danger">
            <Trash2 size={14} />
          </button>
          <button type="button" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'expand log' : 'collapse log'} className="rounded-sm p-1.5 text-text-3 transition-colors duration-180 hover:bg-surface-3 hover:text-text-1">
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
          className="scrollbar-slim h-36 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.7]"
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

function useTaskAward(simId: string, log: (kind: LogKind, text: string) => void) {
  return useCallback(
    (taskId: string, xp: number, note: string) => {
      const st = useProgress.getState()
      if (st.sims[simId]?.tasksDone.includes(taskId)) return
      st.recordSimTask(simId, taskId)
      useProgress.setState((p) => ({ xp: p.xp + xp }))
      log('ok', `TASK ✓ ${note}  (+${xp} XP)`)
    },
    [simId, log],
  )
}

/** 400ms cubic-out number tween (jumps instantly under reduced motion). */
function useTweened(value: number, reduced: boolean, dur = 400): number {
  const [display, setDisplay] = useState(value)
  const st = useRef({ from: value, raf: 0 })
  useEffect(() => {
    if (reduced) {
      st.current.from = value
      setDisplay(value)
      return
    }
    const from = st.current.from
    const start = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      const v = from + (value - from) * e
      st.current.from = v
      setDisplay(v)
      if (p < 1) st.current.raf = requestAnimationFrame(tick)
    }
    st.current.raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(st.current.raf)
  }, [value, reduced, dur])
  return display
}

/* ------------------------------------------------------------------ */
/* model + hardware data                                               */
/* ------------------------------------------------------------------ */

type PresetId = 'llama3-8b' | 'llama3-70b' | 'mixtral-8x7b' | 'custom'
type Dtype = 'fp16' | 'fp8' | 'int4'

interface ModelPreset {
  id: PresetId
  name: string
  layers: number
  kvHeads: number
  headDim: number
  paramsB: number
  note?: string
}
const PRESETS: ModelPreset[] = [
  { id: 'llama3-8b', name: 'Llama-3-8B', layers: 32, kvHeads: 8, headDim: 128, paramsB: 8.03, note: 'GQA 8 KV heads' },
  { id: 'llama3-70b', name: 'Llama-3-70B', layers: 80, kvHeads: 8, headDim: 128, paramsB: 70.6, note: 'GQA 8 KV heads' },
  { id: 'mixtral-8x7b', name: 'Mixtral-8x7B', layers: 32, kvHeads: 8, headDim: 128, paramsB: 46.7, note: 'MoE · 12.9B active, all 46.7B resident' },
]

const DTYPE: { id: Dtype; label: string; bytes: number }[] = [
  { id: 'fp16', label: 'FP16', bytes: 2 },
  { id: 'fp8', label: 'FP8', bytes: 1 },
  { id: 'int4', label: 'INT4', bytes: 0.5 },
]

const GPUS = [
  { id: 'h100', name: 'H100', gb: 80 },
  { id: 'a100-80', name: 'A100 80GB', gb: 80 },
  { id: 'a100-40', name: 'A100 40GB', gb: 40 },
  { id: 'rtx4090', name: 'RTX 4090', gb: 24 },
  { id: 't4', name: 'T4', gb: 16 },
]

const CTX_STEPS = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 200000, 262144, 524288, 1048576]
const BATCH_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256]

const TASKS = [
  { id: 'kv-oom', text: 'Make a 70B FP16 model OOM at 32k context on one H100', xp: 60 },
  { id: 'kv-rescue', text: 'Rescue it: quantize (FP8) and use GQA math to fit the same 32k context', xp: 60 },
  { id: 'kv-batch', text: 'Compute a batch size that fits 200k context (no OOM)', xp: 60 },
]

type Term = 'two' | 'L' | 'H' | 'd' | 'bytes' | 'ctx' | 'B' | null

function fmtGb(gb: number): string {
  return gb >= 100 ? gb.toFixed(1) : gb.toFixed(2)
}
function fmtCtx(c: number): string {
  return c >= 1000 ? `${(c / 1000).toFixed(c % 1000 === 0 ? 0 : 1)}k` : String(c)
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

export default function KvCacheSim() {
  const reduced = useReducedMotion()
  const { lines, log, clear } = useLog('kv-calc ready — memory/token = 2 × L × H_kv × d × bytes')
  const award = useTaskAward('sim-kv', log)

  const [presetId, setPresetId] = useState<PresetId>('llama3-8b')
  const [layers, setLayers] = useState(32)
  const [kvHeads, setKvHeads] = useState(8)
  const [headDim, setHeadDim] = useState(128)
  const [dtype, setDtype] = useState<Dtype>('fp16')
  const [ctxIdx, setCtxIdx] = useState(3) // 8192
  const [batchIdx, setBatchIdx] = useState(2) // 4
  const [gpuId, setGpuId] = useState('h100')
  const [paged, setPaged] = useState(true)
  const [prefixShare, setPrefixShare] = useState(0)
  const [hoverTerm, setHoverTerm] = useState<Term>(null)

  const isCustom = presetId === 'custom'
  const paramsB = isCustom ? 7 : PRESETS.find((p) => p.id === presetId)?.paramsB ?? 7
  const bytes = DTYPE.find((d) => d.id === dtype)?.bytes ?? 2
  const ctx = CTX_STEPS[ctxIdx]
  const batch = BATCH_STEPS[batchIdx]
  const gpu = GPUS.find((g) => g.id === gpuId) ?? GPUS[0]

  /* ---- the math: KV bytes = 2 × L × H_kv × d × bytes × ctx × B ---- */
  const calc = useMemo(() => {
    const kvPerToken = 2 * layers * kvHeads * headDim * bytes // bytes / token / sequence
    const shareFactor = batch > 1 ? 1 - (prefixShare / 100) * ((batch - 1) / batch) : 1
    const kvUsed = (kvPerToken * ctx * batch * shareFactor) / 1e9 // GB actually needed
    const paFactor = paged ? 1.04 : 1 / 0.3 // static reservation wastes ~70%
    const kvReserved = kvUsed * paFactor
    const weights = paramsB * bytes
    const overhead = 1 + 0.03 * weights
    const total = weights + kvReserved + overhead
    const oom = total > gpu.gb
    const perSeqGb = (kvPerToken * ctx * paFactor * (batch > 1 ? shareFactor : 1)) / 1e9
    const maxBatch = Math.max(0, Math.floor((gpu.gb - weights - overhead) / Math.max(perSeqGb, 1e-9)))
    return {
      kvPerToken,
      kvUsed,
      kvReserved,
      weights,
      overhead,
      total,
      oom,
      maxBatch,
      shareFactor,
      paFactor,
      wastePct: paged ? 4 : 70,
    }
  }, [layers, kvHeads, headDim, bytes, ctx, batch, prefixShare, paged, paramsB, gpu.gb])

  const heroGb = useTweened(calc.kvReserved, reduced)

  /* ---- logging on transitions ---- */
  const prevOom = useRef<boolean | null>(null)
  useEffect(() => {
    if (prevOom.current === calc.oom) return
    if (prevOom.current !== null) {
      if (calc.oom)
        log('err', `OOM  need ${fmtGb(calc.total)}GB > ${gpu.gb}GB HBM (${gpu.name}) — CUDA out of memory`)
      else log('ok', `FIT  ${fmtGb(calc.total)}GB ≤ ${gpu.gb}GB (${gpu.name}) ✓`)
    }
    prevOom.current = calc.oom
  }, [calc.oom, calc.total, gpu.gb, gpu.name, log])

  /* ---- task detection ---- */
  const oomSeen = useRef(false)
  useEffect(() => {
    if (presetId === 'llama3-70b' && dtype === 'fp16' && ctx >= 32768 && calc.oom) {
      oomSeen.current = true
      award('kv-oom', 60, `70B FP16 @ ${fmtCtx(ctx)}: needs ${fmtGb(calc.total)}GB > ${gpu.gb}GB`)
    }
  }, [presetId, dtype, ctx, calc.oom, calc.total, gpu.gb, award])

  useEffect(() => {
    if (oomSeen.current && presetId === 'llama3-70b' && dtype !== 'fp16' && ctx >= 32768 && !calc.oom) {
      award('kv-rescue', 60, `rescued: 70B ${dtype.toUpperCase()} @ ${fmtCtx(ctx)} fits in ${fmtGb(calc.total)}GB ✓`)
    }
  }, [presetId, dtype, ctx, calc.oom, calc.total, award])

  useEffect(() => {
    if (ctx >= 200000 && !calc.oom && batch >= 2) {
      award('kv-batch', 60, `batch ${batch} fits @ ${fmtCtx(ctx)} (max ≈ ${calc.maxBatch})`)
    }
  }, [ctx, calc.oom, calc.maxBatch, batch, award])

  const applyPreset = (id: PresetId) => {
    setPresetId(id)
    const p = PRESETS.find((pp) => pp.id === id)
    if (p) {
      setLayers(p.layers)
      setKvHeads(p.kvHeads)
      setHeadDim(p.headDim)
      log('op', `MODEL ${p.name}  L=${p.layers} H_kv=${p.kvHeads} d=${p.headDim} (${p.paramsB}B params)`)
    } else {
      log('op', 'MODEL custom — architecture sliders unlocked')
    }
  }

  const segPct = (gb: number) => Math.min(100, (gb / gpu.gb) * 100)
  const totalPct = (calc.total / gpu.gb) * 100

  const termBtn = (id: Exclude<Term, null>, label: string) => (
    <button
      type="button"
      onMouseEnter={() => setHoverTerm(id)}
      onMouseLeave={() => setHoverTerm(null)}
      onFocus={() => setHoverTerm(id)}
      onBlur={() => setHoverTerm(null)}
      className={cn(
        'rounded-[3px] px-1 transition-colors duration-180',
        hoverTerm === id ? 'bg-accent-dim text-accent' : 'text-text-2',
      )}
    >
      {label}
    </button>
  )

  const ctrlLabel = (id: Exclude<Term, null>, text: string, value: string) => (
    <div
      className={cn(
        'mb-1 flex justify-between rounded-[3px] px-1 font-mono text-[11px] transition-colors duration-180',
        hoverTerm === id ? 'bg-accent-dim text-accent' : 'text-text-3',
      )}
    >
      <span>{text}</span>
      <span className={hoverTerm === id ? 'text-accent' : 'text-text-1'}>{value}</span>
    </div>
  )

  /* mini block diagram for PagedAttention panel */
  const blocks = useMemo(() => {
    const n = 24
    const used = 7
    const arr: { used: boolean; wasted: boolean }[] = []
    for (let i = 0; i < n; i++) {
      if (paged) arr.push({ used: i < used, wasted: i === used })
      else arr.push({ used: i < used, wasted: i >= used && i < Math.round(n * 0.7 + used * 0.3) })
    }
    return arr
  }, [paged])

  return (
    <PlaygroundShell
      simId="sim-kv"
      title="KV-Cache Calculator"
      subtitle="memory/token = 2 × L × H_kv × d × bytes — a form with live consequences"
      tasks={TASKS}
    >
      <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
        {/* ================= left: parameter form ================= */}
        <div className="flex flex-col gap-4 rounded-md border border-line bg-surface-1 p-4">
          <div>
            <div className="mb-1.5 font-mono text-label uppercase tracking-[0.10em] text-text-3">model preset</div>
            <div className="grid grid-cols-2 gap-1">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    'rounded-sm border px-2 py-1.5 text-left transition-all duration-180 active:scale-[.97]',
                    presetId === p.id ? 'border-accent bg-accent-dim' : 'border-line bg-surface-2 hover:border-line-bright',
                  )}
                >
                  <div className={cn('font-mono text-[12px]', presetId === p.id ? 'text-accent' : 'text-text-1')}>{p.name}</div>
                  <div className="font-mono text-[10px] text-text-3">{p.note}</div>
                </button>
              ))}
              <button
                onClick={() => applyPreset('custom')}
                className={cn(
                  'rounded-sm border px-2 py-1.5 text-left transition-all duration-180 active:scale-[.97]',
                  isCustom ? 'border-accent bg-accent-dim' : 'border-line bg-surface-2 hover:border-line-bright',
                )}
              >
                <div className={cn('font-mono text-[12px]', isCustom ? 'text-accent' : 'text-text-1')}>custom</div>
                <div className="font-mono text-[10px] text-text-3">your own arch</div>
              </button>
            </div>
          </div>

          <div className={cn(!isCustom && 'pointer-events-none opacity-45')}>
            {ctrlLabel('L', 'layers L', String(layers))}
            <Slider value={[layers]} onValueChange={(v) => setLayers(v[0])} min={8} max={128} step={4} aria-label="layers" />
            <div className="mt-3" />
            {ctrlLabel('H', 'KV heads (GQA)', String(kvHeads))}
            <Slider value={[kvHeads]} onValueChange={(v) => setKvHeads(v[0])} min={1} max={16} step={1} aria-label="kv heads" />
            <div className="mt-3" />
            {ctrlLabel('d', 'head dim', String(headDim))}
            <Slider value={[headDim]} onValueChange={(v) => setHeadDim(v[0])} min={64} max={256} step={64} aria-label="head dim" />
          </div>
          {!isCustom && (
            <div className="-mt-1 font-mono text-[10px] text-text-3">
              arch locked by preset — pick <span className="text-text-2">custom</span> to edit
            </div>
          )}

          <div>
            {ctrlLabel('bytes', 'precision (weights + KV)', DTYPE.find((d) => d.id === dtype)?.label ?? '')}
            <div className="flex gap-1">
              {DTYPE.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setDtype(d.id)
                    log('op', `PRECISION → ${d.label} (${d.bytes}B/param)`)
                  }}
                  className={cn(
                    'flex-1 rounded-sm border px-2 py-1 font-mono text-[12px] transition-all duration-180 active:scale-[.97]',
                    dtype === d.id ? 'border-accent bg-accent-dim text-accent' : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                  )}
                >
                  {d.label}
                  <span className="ml-1 text-[10px] text-text-3">{d.bytes}B</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            {ctrlLabel('ctx', 'context length (log)', fmtCtx(ctx))}
            <Slider value={[ctxIdx]} onValueChange={(v) => setCtxIdx(v[0])} min={0} max={CTX_STEPS.length - 1} step={1} aria-label="context length" />
            <div className="mt-1 flex justify-between font-mono text-[9px] text-text-3">
              <span>1k</span>
              <span>32k</span>
              <span>200k</span>
              <span>1M</span>
            </div>
          </div>

          <div>
            {ctrlLabel('B', 'batch size', String(batch))}
            <Slider value={[batchIdx]} onValueChange={(v) => setBatchIdx(v[0])} min={0} max={BATCH_STEPS.length - 1} step={1} aria-label="batch size" />
          </div>

          <div>
            <div className="mb-1 flex justify-between px-1 font-mono text-[11px] text-text-3">
              <span>prefix sharing (radix cache)</span>
              <span className="text-text-1">{prefixShare}%</span>
            </div>
            <Slider value={[prefixShare]} onValueChange={(v) => setPrefixShare(v[0])} min={0} max={90} step={5} aria-label="prefix sharing" />
          </div>

          <button
            onClick={() => {
              setPaged(!paged)
              log('op', !paged ? 'PAGEDATTENTION on — block=16, waste <4% ≡ OS paging' : 'STATIC reservation — reserve max ctx per seq (≈70% waste)')
            }}
            className={cn(
              'flex items-center justify-between rounded-sm border px-3 py-2 font-mono text-[12px] transition-all duration-180 active:scale-[.98]',
              paged ? 'border-accent/60 bg-accent-dim/40 text-accent' : 'border-amber/50 bg-amber/5 text-amber',
            )}
          >
            <span>PagedAttention (block=16)</span>
            <span className="text-[10px]">{paged ? 'ON ≡ page table' : 'OFF ≡ static reserve'}</span>
          </button>

          <div>
            <div className="mb-1.5 font-mono text-label uppercase tracking-[0.10em] text-text-3">gpu hbm budget</div>
            <div className="grid grid-cols-3 gap-1">
              {GPUS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => {
                    setGpuId(g.id)
                    log('op', `GPU → ${g.name} (${g.gb}GB HBM)`)
                  }}
                  className={cn(
                    'rounded-sm border px-1.5 py-1 font-mono text-[11px] transition-all duration-180 active:scale-[.97]',
                    gpuId === g.id ? 'border-accent bg-accent-dim text-accent' : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ================= right: results stack ================= */}
        <div className="flex flex-col gap-4">
          {/* hero number + formula */}
          <section className="relative overflow-hidden rounded-md border border-line bg-surface-1 p-5">
            <div className="font-mono text-label uppercase tracking-[0.10em] text-text-3">kv cache @ this config</div>
            <div className={cn('mt-1 font-display text-[48px] font-bold leading-none tracking-[-0.02em]', calc.oom ? 'text-danger' : 'text-text-1')}>
              {fmtGb(heroGb)}
              <span className="ml-2 text-[20px] text-text-3">GB</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-0.5 font-mono text-[13px]">
              {termBtn('two', '2')}
              <span className="text-text-3">×</span>
              {termBtn('L', `L=${layers}`)}
              <span className="text-text-3">×</span>
              {termBtn('H', `H_kv=${kvHeads}`)}
              <span className="text-text-3">×</span>
              {termBtn('d', `d=${headDim}`)}
              <span className="text-text-3">×</span>
              {termBtn('bytes', `${bytes}B`)}
              <span className="text-text-3">×</span>
              {termBtn('ctx', fmtCtx(ctx))}
              <span className="text-text-3">×</span>
              {termBtn('B', `B=${batch}`)}
            </div>
            <div className="mt-2 font-mono text-[11px] text-text-3">
              hover a term → its slider lights up. the leading 2 = K and V.
            </div>
            {/* OOM stamp */}
            <AnimatePresence>
              {calc.oom && (
                <motion.div
                  key="oom"
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.4 }}
                  animate={
                    reduced
                      ? { opacity: 1 }
                      : { opacity: 1, scale: 1, x: [0, -5, 5, -3, 3, 0], transition: { duration: 0.35 } }
                  }
                  exit={{ opacity: 0 }}
                  className="absolute right-4 top-4 rotate-[-8deg] rounded-sm border-2 border-danger px-3 py-1.5 font-mono text-[15px] font-bold uppercase tracking-[0.14em] text-danger"
                  style={{ boxShadow: '0 0 24px rgba(255,92,108,.25)' }}
                >
                  OOM
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* memory bar */}
          <section className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-2 flex items-center justify-between font-mono text-[11px] text-text-3">
              <span>{gpu.name} · {gpu.gb}GB HBM</span>
              <span className={calc.oom ? 'text-danger' : 'text-text-2'}>
                {fmtGb(calc.total)} / {gpu.gb}GB ({totalPct.toFixed(0)}%)
              </span>
            </div>
            <div className="relative h-9 overflow-hidden rounded-sm border border-line bg-ink">
              <div
                className={cn('absolute inset-y-0 left-0 bg-t4/70', !reduced && 'transition-[width] duration-300 ease-out-expo')}
                style={{ width: `${segPct(calc.weights)}%` }}
                title={`weights ${fmtGb(calc.weights)}GB`}
              />
              <div
                className={cn('absolute inset-y-0 bg-t5/70', !reduced && 'transition-[width,left] duration-300 ease-out-expo')}
                style={{ left: `${segPct(calc.weights)}%`, width: `${segPct(calc.kvReserved)}%` }}
                title={`KV cache ${fmtGb(calc.kvReserved)}GB`}
              />
              <div
                className={cn('absolute inset-y-0 bg-text-3/40', !reduced && 'transition-[width,left] duration-300 ease-out-expo')}
                style={{ left: `${segPct(calc.weights + calc.kvReserved)}%`, width: `${segPct(calc.overhead)}%` }}
                title={`overhead ${fmtGb(calc.overhead)}GB`}
              />
              <div className="absolute inset-y-0 right-0 w-px bg-line-bright" />
            </div>
            <div className="mt-2 flex flex-wrap gap-4 font-mono text-[10px] text-text-3">
              <span><i className="mr-1 inline-block h-2 w-2 rounded-[1px] bg-t4" />weights {fmtGb(calc.weights)}GB</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-[1px] bg-t5" />kv {fmtGb(calc.kvReserved)}GB{!paged && ' (reserved)'}</span>
              <span><i className="mr-1 inline-block h-2 w-2 rounded-[1px] bg-text-3" />overhead {fmtGb(calc.overhead)}GB</span>
              <span className="ml-auto text-text-2">max batch @ {fmtCtx(ctx)}: <span className="text-accent">{calc.maxBatch}</span></span>
            </div>
          </section>

          {/* per-token + callout */}
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-md border border-line bg-surface-1 p-4">
              <div className="font-mono text-label uppercase tracking-[0.10em] text-text-3">per-token cost</div>
              <div className="mt-1 font-display text-[28px] font-bold text-text-1">
                {(calc.kvPerToken / 1024).toFixed(1)}
                <span className="ml-1 text-[14px] text-text-3">KB/token</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-text-3">
                2 × {layers} × {kvHeads} × {headDim} × {bytes}B — every token, every sequence, forever
              </div>
            </section>
            <section className="rounded-md border border-line bg-surface-1 p-4">
              <div className="font-mono text-label uppercase tracking-[0.10em] text-text-3">one request @ 100k ctx</div>
              <div className="mt-1 font-display text-[28px] font-bold text-t5">
                {fmtGb((calc.kvPerToken * 100000) / 1e9)}
                <span className="ml-1 text-[14px] text-text-3">GB</span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-text-3">
                a single long-context request can outweigh the model itself
              </div>
            </section>
          </div>

          {/* PagedAttention savings */}
          <section className="rounded-md border border-line bg-surface-1 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">
                {paged ? 'pagedattention: on-demand blocks' : 'static reservation: the 70% tax'}
              </span>
              <span className={cn('rounded-sm border px-1.5 py-0.5 font-mono text-[11px]', paged ? 'border-accent/50 text-accent' : 'border-amber/50 text-amber')}>
                waste {calc.wastePct}%
              </span>
            </div>
            <div className="mb-2 grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(24, minmax(0,1fr))' }}>
              {blocks.map((b, i) => (
                <div
                  key={i}
                  className={cn('h-4 rounded-[1px] border', !reduced && 'transition-colors duration-300')}
                  style={{
                    background: b.used ? 'rgba(251,113,133,.7)' : b.wasted ? 'rgba(255,178,36,.25)' : '#182130',
                    borderColor: b.used ? '#FB7185' : b.wasted ? 'rgba(255,178,36,.5)' : '#1E2937',
                  }}
                  title={b.used ? 'used KV block' : b.wasted ? 'reserved but wasted' : 'free'}
                />
              ))}
            </div>
            <div className="font-mono text-[11px] leading-relaxed text-text-3">
              {paged ? (
                <>
                  allocate KV in 16-token blocks as tokens arrive ≡ <span className="text-t2">OS paging</span> ≡{' '}
                  <span className="text-t5">KV block table</span>. internal fragmentation &lt; 1 block/seq ⇒{' '}
                  <span className="text-accent">waste &lt;4%</span>. that's the entire PagedAttention trick.
                </>
              ) : (
                <>
                  without paging you must reserve <span className="font-mono text-amber">max_ctx × batch</span> up
                  front — sequences that stop early leave HBM stranded (amber). need ≈
                  <span className="text-amber"> 3.3×</span> the KV you actually use.
                </>
              )}
            </div>
          </section>

          <LogConsole lines={lines} onClear={clear} />
        </div>
      </div>
    </PlaygroundShell>
  )
}
