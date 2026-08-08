import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Cpu, Download, Loader2, Play, Zap } from 'lucide-react'
import { instantiateLab } from '@/lib/wasm-lab'
import { type SchedulerDriver, type SchedView } from '@/lib/fleet-model'
import { makeWasmScheduler } from '@/pages/fleet/drivers'
import { loadRealModel, runRealEngine, type RealGenFn, type RealReqState, type RealRunMetrics } from '@/lib/real-engine'
import type { SlotState } from '@/pages/fleet/slots'
import { cn } from '@/lib/utils'

const MODELS = [
  { id: 'onnx-community/Qwen3-0.6B-ONNX', label: 'Qwen3-0.6B (better, ~400MB)' },
  { id: 'onnx-community/SmolLM2-135M-Instruct-ONNX-GQA', label: 'SmolLM2-135M (fastest, ~90MB)' },
]

/** FCFS baseline: admit the oldest when the slot is free. */
function fcfsScheduler(): SchedulerDriver {
  return {
    name: 'fcfs',
    schedule: (v: SchedView) => ({
      admit: v.running.length < v.maxRunning && v.waiting.length > 0 ? [v.waiting[0].id] : [],
      preempt: [],
    }),
  }
}

export default function RealEnginePanel({ slots }: { slots: SlotState }) {
  const [modelId, setModelId] = useState(MODELS[0].id)
  const [loadState, setLoadState] = useState<{ phase: string; frac: number } | null>(null)
  const [device, setDevice] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [reqs, setReqs] = useState<RealReqState[] | null>(null)
  const [metrics, setMetrics] = useState<RealRunMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const genRef = useRef<RealGenFn | null>(null)

  const load = useCallback(async () => {
    setError(null)
    setLoadState({ phase: 'starting', frac: 0 })
    try {
      const loaded = await loadRealModel(modelId, (phase, frac) => setLoadState({ phase, frac }))
      genRef.current = loaded.gen
      setDevice(loaded.device)
    } catch (e) {
      setLoadState(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [modelId])

  const run = useCallback(async () => {
    const gen = genRef.current
    if (!gen) return
    setRunning(true)
    setMetrics(null)
    setNote(null)
    setError(null)
    try {
      const scheduler = slots.sched ? makeWasmScheduler(await instantiateLab(slots.sched.bytes)) : fcfsScheduler()
      const m = await runRealEngine(
        gen,
        scheduler,
        (states, n) => {
          setReqs(states.map((s) => ({ ...s })))
          if (n) setNote(n)
        },
      )
      setMetrics(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [slots.sched])

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-body-sm text-text-2">
        One real model, one generation slot, eight requests — and the scheduler deciding who runs.
        Upload your lab 06 module and <span className="text-text-1">your Rust admission policy serves a
        real model</span>; otherwise the FCFS baseline does. Reorder mid-generation and the previous request
        pays a real recompute — preemption you can watch.
      </p>

      {/* model loader */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value)
            genRef.current = null
            setLoadState(null)
            setDevice(null)
          }}
          className="rounded-md border border-line bg-surface-1 px-3 py-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent/60"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button
          onClick={() => void load()}
          disabled={!!loadState && !device}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-1 px-4 py-2 font-mono text-sm text-text-2 transition-colors hover:border-accent/50 hover:text-text-1 disabled:opacity-50"
        >
          {device ? <Zap className="h-4 w-4 text-accent" /> : loadState ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {device ? `ready (${device})` : loadState ? loadState.phase : 'load model'}
        </button>
        {loadState && !device && (
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(loadState.frac * 100)}%` }} />
          </div>
        )}
        <button
          onClick={() => void run()}
          disabled={!genRef.current || running}
          className="inline-flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-4 py-2 font-mono text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'serving…' : slots.sched ? 'run with YOUR scheduler' : 'run (FCFS reference)'}
        </button>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-danger/40 bg-danger/5 p-4 font-mono text-[12px] text-danger">
            {error}
          </motion.div>
        )}
        {note && (
          <motion.div key={note} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-lg border border-amber/40 bg-amber/5 p-3 font-mono text-[11px] text-amber">
            {note}
          </motion.div>
        )}
      </AnimatePresence>

      {/* request cards */}
      {reqs && (
        <div className="grid gap-3 sm:grid-cols-2">
          {reqs.map((r) => (
            <div key={r.spec.id} className="rounded-lg border border-line bg-surface-1 p-4">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] text-text-3">req {r.spec.id} · ~{r.spec.estTokens} tok prompt</p>
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 font-mono text-[10px]',
                    r.status === 'done'
                      ? 'border-accent/60 text-accent'
                      : r.status === 'generating'
                        ? 'border-info/60 text-info'
                        : r.status === 'admitted'
                          ? 'border-amber/60 text-amber'
                          : 'border-line text-text-3',
                  )}
                >
                  {r.status}
                  {r.preempted > 0 ? ` · preempted ×${r.preempted}` : ''}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 min-h-[2.5rem] font-mono text-[11px] leading-relaxed text-text-2">
                {r.text ? r.text.replace(/<\|im_end\|>/g, '').slice(-240) : r.spec.prompt}
              </p>
              <p className="mt-2 font-mono text-[10px] text-text-3">
                {r.tokens} tok{r.firstTokenAt && r.admittedAt !== undefined ? ` · ttft ${Math.round(r.firstTokenAt - r.admittedAt)}ms` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {metrics && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-accent/50 bg-accent/10 p-4">
          <p className="font-mono text-sm text-accent">
            run complete — avg TTFT {metrics.avgTtftMs}ms · {metrics.tokPerSec} tok/s · {metrics.preemptions} preemptions · {(metrics.totalMs / 1000).toFixed(1)}s wall
          </p>
          <p className="mt-1 text-body-sm text-text-2">
            {slots.sched
              ? 'that was your Rust admission policy serving a real model. Compare against the FCFS run: order is the whole game.'
              : 'that was FCFS. Upload your lab 06 scheduler on the Fleet page and run again — your policy vs first-come-first-served on real tokens.'}
          </p>
        </motion.div>
      )}

      <p className="font-mono text-[10px] text-text-3">
        <Cpu className="mr-1 inline h-3 w-3" />
        runtime: transformers.js v4 from CDN · model cached by the browser after first load · no server, your GPU (or CPU) does the work
      </p>
    </div>
  )
}
