/**
 * CAPSTONE — /capstone (capstone.md).
 * "Build the engine." A 7-step guided wizard: tokenize → embed → forward →
 * decode → KV cache → continuous batching → measure. Each step ships an 80%
 * code harness with TODO slots, automated checks, a live architecture glyph,
 * and ends in a results dashboard + client-rendered certificate.
 *
 * The engine itself is pure TS in @/components/sims/engine-core (shared with
 * the lab's ToyEngineSim); the glyph is imported from the sim component.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  Award,
  Check,
  Eye,
  Play,
  RotateCcw,
  Share2,
  ShieldCheck,
  X,
  Download,
} from 'lucide-react'
import { EngineGlyph } from '@/components/sims/ToyEngineSim'
import {
  TOY_MODEL,
  EOS_ID,
  detokenize,
  tokenizeWithTrace,
  forwardAll,
  percentile,
  measureEngine,
  makeWorkload,
  simulateSchedule,
  SAMPLE_PROMPTS,
  KV_BLOCK_SIZE,
} from '@/components/sims/engine-core'
import { MIN_SPEEDUP, REF_DECODE, SAMPLE_PROMPT_IDS, SAMPLE_SCRIPT_IDS } from '@/lib/capstone-checks'
import { REF_CACHED, STEPS, TRACE, referenceSpeedup, type CheckResult } from '@/lib/capstone/steps'
import {
  MODE_LABEL,
  createCapstoneSandbox,
  type CapstoneSandbox,
  type SandboxMode,
} from '@/lib/capstone/sandbox'
import capstoneWorkerUrl from '@/workers/capstone.worker?worker&url'
import { useProgress, XP } from '@/lib/progress'
import { cn } from '@/lib/utils'
import { scrollBehavior } from '@/lib/lesson-scroll'

/* ------------------------------------------------------------------ */
/* Sandbox: learner code runs in an opaque-origin frame's worker       */
/* ------------------------------------------------------------------ */

let sandbox: CapstoneSandbox | null = null

/* One per page visit; Capstone() closes it on unmount. Dev serves an unbundled
   worker that no Blob can host, so dev uses the worker-only fallback. */
function getSandbox(): CapstoneSandbox {
  sandbox ??= createCapstoneSandbox({
    workerUrl: capstoneWorkerUrl,
    frameUrl: `${import.meta.env.BASE_URL}capstone-sandbox.html`,
    workerOnly: import.meta.env.DEV,
  })
  return sandbox
}

function closeSandbox() {
  sandbox?.dispose()
  sandbox = null
}

/* ------------------------------------------------------------------ */
/* Per-step stage visualizations (small, live, honest)                 */
/* ------------------------------------------------------------------ */

function StageTokenize() {
  const trace = useMemo(() => tokenizeWithTrace(SAMPLE_PROMPTS[0].text), [])
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {trace.ids.map((id, i) => (
          <span
            key={i}
            className="rounded-sm border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-xs text-accent"
          >
            {detokenize([id]).replace(' ', '␣')}
            <span className="ml-1.5 text-[9px] text-text-3">{id}</span>
          </span>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        "{SAMPLE_PROMPTS[0].text}" — {SAMPLE_PROMPTS[0].text.length} chars → {trace.ids.length}{' '}
        tokens in {trace.events.length} merge rounds
      </p>
    </div>
  )
}

function StageEmbed() {
  const ids = SAMPLE_PROMPT_IDS
  return (
    <div className="space-y-2">
      {ids.map((id) => {
        const row = TOY_MODEL.emb[id].slice(0, 8)
        const max = Math.max(...row.map(Math.abs), 1e-9)
        return (
          <div key={id} className="flex items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-[10px] text-text-3">
              id {id}
            </span>
            <div className="flex flex-1 items-center gap-px">
              {row.map((v, c) => (
                <div
                  key={c}
                  className={cn('h-3.5 flex-1 rounded-[1px]', v >= 0 ? 'bg-accent/60' : 'bg-info/50')}
                  style={{ opacity: 0.25 + (Math.abs(v) / max) * 0.75 }}
                  title={`d${c} = ${v.toFixed(3)}`}
                />
              ))}
            </div>
          </div>
        )
      })}
      <p className="pt-1 font-mono text-[11px] text-text-3">
        first 8 of d={TOY_MODEL.d} dims per token — a gather, not a matmul
      </p>
    </div>
  )
}

function StageForward() {
  const trace = useMemo(() => forwardAll(TOY_MODEL, SAMPLE_PROMPT_IDS), [])
  const attn = trace.layers[0].attn
  const n = SAMPLE_PROMPT_IDS.length
  const size = 180
  const cell = size / n
  return (
    <div className="flex items-start gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-[200px] rounded-md border border-line bg-ink"
        role="img"
        aria-label="Attention heatmap, layer 0"
      >
        {attn.map((row, i) =>
          row.map((w, j) => (
            <rect
              key={`${i}-${j}`}
              x={j * cell}
              y={i * cell}
              width={cell}
              height={cell}
              fill={j > i ? '#111722' : `rgba(62,242,164,${0.06 + w * 0.9})`}
            >
              <title>
                w[{i}][{j}] = {w.toFixed(3)}
              </title>
            </rect>
          )),
        )}
      </svg>
      <div className="font-mono text-[11px] leading-relaxed text-text-3">
        <p>layer 0 attention · {n}×{n}</p>
        <p className="mt-1">upper triangle = 0 (causal mask)</p>
        <p className="mt-1 text-accent">every softmax row sums to 1</p>
        <p className="mt-1">logits over vocab {TOY_MODEL.vocab}</p>
      </div>
    </div>
  )
}

function StageDecode() {
  const max = REF_DECODE.naiveFlops
  return (
    <div>
      <div className="space-y-2">
        {REF_DECODE.tokens.slice(0, 6).map((t, i) => {
          const cached = REF_CACHED.tokens[i]
          return (
            <div key={i} className="flex items-center gap-2 font-mono text-[10px]">
              <span className="w-12 shrink-0 text-text-3">step {i}</span>
              <div className="h-3 rounded-[1px] bg-amber/70" style={{ width: `${(t.flops / (max / 20)) * 100}%`, maxWidth: '70%' }} />
              <span className="text-amber">{(t.flops / 1000).toFixed(0)}K</span>
              <div className="h-3 rounded-[1px] bg-accent/70" style={{ width: `${((cached?.flops ?? 0) / (max / 20)) * 100}%`, maxWidth: '70%' }} />
              <span className="text-accent">{((cached?.flops ?? 0) / 1000).toFixed(1)}K</span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        <span className="text-amber">■ naive recompute</span> ·{' '}
        <span className="text-accent">■ with KV cache (step 5)</span> — FLOPs per decode step
      </p>
    </div>
  )
}

function StageKV() {
  const sp = referenceSpeedup()
  const naiveMean = REF_DECODE.tokens.reduce((a, t) => a + t.itlMs, 0) / REF_DECODE.tokens.length
  const cachedMean = REF_CACHED.tokens.reduce((a, t) => a + t.itlMs, 0) / REF_CACHED.tokens.length
  const tokens = SAMPLE_PROMPT_IDS.length + REF_CACHED.tokens.length
  const blocks = Math.ceil(tokens / KV_BLOCK_SIZE)
  return (
    <div>
      <div className="grid max-w-md grid-cols-2 gap-3">
        <div className="rounded-md border border-amber/40 bg-amber/5 p-3">
          <p className="font-mono text-[10px] uppercase text-amber">naive mean ITL</p>
          <p className="mt-1 font-display text-h4 text-text-1">{naiveMean.toFixed(1)}ms</p>
        </div>
        <div className="rounded-md border border-accent/40 bg-accent/5 p-3">
          <p className="font-mono text-[10px] uppercase text-accent">cached mean ITL</p>
          <p className="mt-1 font-display text-h4 text-text-1">{cachedMean.toFixed(1)}ms</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {Array.from({ length: 8 }, (_, b) => (
          <div
            key={b}
            className={cn(
              'h-7 w-10 rounded-sm border font-mono text-[9px] flex items-center justify-center',
              b < blocks ? 'border-info/60 bg-info/20 text-info' : 'border-line bg-surface-3 text-text-3',
            )}
          >
            {b < blocks ? `0x0${b}` : 'free'}
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        block table: {tokens} tokens → {blocks} × {KV_BLOCK_SIZE}-token blocks · waste counter
        collapsed <span className="text-accent">{sp.toFixed(1)}×</span>
      </p>
    </div>
  )
}

function StageBatch() {
  const cont = useMemo(
    () => simulateSchedule(makeWorkload(), { maxBatch: 2, memBlocks: 8, mode: 'continuous' }),
    [],
  )
  const stat = useMemo(
    () => simulateSchedule(makeWorkload(), { maxBatch: 2, memBlocks: 8, mode: 'static' }),
    [],
  )
  const maxIters = Math.max(cont.iters, stat.iters)
  return (
    <div>
      <div className="space-y-2.5">
        {[
          { label: 'static batching', iters: stat.iters, cls: 'bg-amber/70', text: 'text-amber' },
          { label: 'continuous batching', iters: cont.iters, cls: 'bg-accent/70', text: 'text-accent' },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-36 shrink-0 font-mono text-[11px] text-text-2">{r.label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-3">
              <div className={cn('h-full rounded-sm', r.cls)} style={{ width: `${(r.iters / maxIters) * 100}%` }} />
            </div>
            <span className={cn('w-16 shrink-0 text-right font-mono text-[11px]', r.text)}>
              {r.iters} iters
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        same 4 requests, same max batch 2 — continuous refills a slot the iteration after it frees
      </p>
    </div>
  )
}

function StageMeasure() {
  const bins = useMemo(() => {
    const max = Math.max(...TRACE.itl)
    const B = 8
    const counts = new Array<number>(B).fill(0)
    for (const v of TRACE.itl) counts[Math.min(B - 1, Math.floor((v / max) * B))]++
    return { counts, max }
  }, [])
  const top = Math.max(...bins.counts)
  return (
    <div>
      <div className="flex h-24 items-end gap-1.5">
        {bins.counts.map((c, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t-sm bg-info/60"
              style={{ height: `${top ? (c / top) * 100 : 0}%`, minHeight: c ? 3 : 0 }}
              title={`${c} samples`}
            />
            <span className="font-mono text-[9px] text-text-3">
              {((bins.max / 8) * (i + 1)).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[11px] text-text-3">
        ITL histogram (ms) · {TRACE.itl.length} samples · p50{' '}
        {percentile(TRACE.itl, 50).toFixed(1)} · p95 {percentile(TRACE.itl, 95).toFixed(1)} ·
        TTFT p50 {percentile(TRACE.ttft, 50).toFixed(1)}
      </p>
    </div>
  )
}

const STAGE_VIZ: Record<string, () => React.ReactNode> = {
  tokenize: StageTokenize,
  embed: StageEmbed,
  forward: StageForward,
  decode: StageDecode,
  'kv-cache': StageKV,
  batch: StageBatch,
  measure: StageMeasure,
}

/* ------------------------------------------------------------------ */
/* Capstone flags (shared with the Progress page achievements)         */
/* ------------------------------------------------------------------ */

const FLAGS_KEY = 'kernelspace:capstone:flags'

function readFlags(): { hints: boolean; optimizer: boolean } {
  try {
    const raw = localStorage.getItem(FLAGS_KEY)
    if (!raw) return { hints: false, optimizer: false }
    const p = JSON.parse(raw)
    return { hints: !!p.hints, optimizer: !!p.optimizer }
  } catch {
    return { hints: false, optimizer: false }
  }
}

function writeFlags(patch: Partial<{ hints: boolean; optimizer: boolean }>) {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify({ ...readFlags(), ...patch }))
  } catch {
    // storage unavailable — flags are best-effort
  }
}

const draftKey = (stepId: string) => `kernelspace:capstone:draft:${stepId}`

/* ------------------------------------------------------------------ */
/* Wizard                                                              */
/* ------------------------------------------------------------------ */

function Wizard({
  stepIndex,
  stepsDone,
  onSelect,
  onCompleted,
}: {
  stepIndex: number
  stepsDone: string[]
  onSelect: (i: number) => void
  onCompleted: () => void
}) {
  const step = STEPS[stepIndex]
  const completeCapstoneStep = useProgress((s) => s.completeCapstoneStep)
  const setCapstoneMetrics = useProgress((s) => s.setCapstoneMetrics)
  const unlockAchievement = useProgress((s) => s.unlockAchievement)

  /* Wizard is remounted per step (key={step.id} by the parent), so lazy
     initializers are the draft loader — no reset effect needed. */
  const [code, setCode] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(draftKey(step.id))
      // drafts from the old step 5 call forwardCached, which no longer exists
      const stale = step.id === 'kv-cache' && saved?.includes('forwardCached')
      return saved != null && !stale ? saved : step.template
    } catch {
      return step.template
    }
  })
  const [results, setResults] = useState<Record<string, CheckResult> | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [showSolution, setShowSolution] = useState(false)
  const [solutionConfirmed, setSolutionConfirmed] = useState(false)
  const [hintRung, setHintRung] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  /* numbers measured from the learner's own code in the sandbox (step 5: speedup) */
  const [measured, setMeasured] = useState<Record<string, number>>({})
  const [mode, setMode] = useState<SandboxMode | 'unavailable' | null>(null)

  useEffect(() => {
    let live = true
    getSandbox()
      .start()
      .then(
        (m) => live && setMode(m),
        () => live && setMode('unavailable'),
      )
    return () => {
      live = false
    }
  }, [])

  const saveDraft = (next: string) => {
    setCode(next)
    try {
      localStorage.setItem(draftKey(step.id), next)
    } catch {
      // best-effort
    }
  }

  const allPass = results != null && step.checks.every((c) => results[c.id]?.pass === true)

  /* The learner's code runs in the sandbox (§14.1), never on this thread. */
  const runChecks = async () => {
    setRunError(null)
    setRunning(true)
    const out = await getSandbox().run(step.id, code)
    setRunning(false)
    if (out.kind === 'unavailable') {
      setMode('unavailable')
      setResults(null)
      setRunError(`the sandbox could not start, so nothing ran: ${out.reason}`)
      return
    }
    setMode(out.mode)
    if (out.kind === 'timeout') {
      setResults(null)
      setRunError(
        `stopped after ${out.budgetMs / 1000} s: look for a loop that never ends. The page itself kept running.`,
      )
      return
    }
    if (out.reply.error != null) {
      setResults(null)
      setRunError(out.reply.error)
      return
    }
    setResults(out.reply.results)
    setMeasured(out.reply.metrics)
  }

  const revealSolution = () => {
    setSolutionConfirmed(true)
    writeFlags({ hints: true })
  }

  const revealHint = () => {
    if (!step.hints) return
    if (hintRung === 0) writeFlags({ hints: true })
    setHintRung((r) => Math.min(step.hints!.length, r + 1))
  }

  const completeStep = () => {
    if (!allPass) return
    completeCapstoneStep(step.id, stepIndex)
    if (step.id === 'kv-cache' && (measured.speedup ?? 0) >= MIN_SPEEDUP) {
      writeFlags({ optimizer: true })
    }
    if (stepIndex === STEPS.length - 1) {
      const m = measureEngine(TOY_MODEL, SAMPLE_PROMPTS[0].text, SAMPLE_PROMPTS[0].script)
      setCapstoneMetrics({ ttft: m.ttft, itl: m.itl, throughput: m.throughput })
      unlockAchievement('engine-builder')
      const flags = readFlags()
      if (!flags.hints) unlockAchievement('no-hints')
      if (flags.optimizer) unlockAchievement('optimizer')
    }
    setToast(`+${XP.capstoneStep} XP — step ${stepIndex + 1} complete`)
    window.setTimeout(() => setToast(null), 3500)
    onCompleted()
  }

  const Viz = STAGE_VIZ[step.id]
  const lineCount = code.split('\n').length

  return (
    <div className="rounded-lg border border-line bg-surface-1">
      {/* StepHeader */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <button
          type="button"
          onClick={() => onSelect(-1)}
          className="flex items-center gap-1 font-mono text-[11px] text-text-3 transition-colors hover:text-accent"
        >
          <ArrowLeft size={12} /> all steps
        </button>
        <p className="font-mono text-[12px] text-text-2">
          STEP {stepIndex + 1}/7 · <span className="text-text-1">{step.title}</span>
        </p>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent">
          +{XP.capstoneStep} XP
        </span>
      </div>

      <div className="grid lg:grid-cols-[240px_1fr]">
        {/* step rail — vertical on lg, horizontal scroller on mobile */}
        <div className="flex gap-1 overflow-x-auto border-b border-line p-3 scrollbar-slim lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r">
          {STEPS.map((s, i) => {
            const done = stepsDone.includes(s.id)
            const current = i === stepIndex
            const reachable = done || i <= stepsDone.length
            return (
              <button
                key={s.id}
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(i)}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-150 lg:w-full',
                  current
                    ? 'bg-surface-3 shadow-[inset_0_0_0_1px_#2C3A4F]'
                    : reachable
                      ? 'hover:bg-surface-2'
                      : 'opacity-45',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
                    done
                      ? 'bg-grad-brand text-ink'
                      : current
                        ? 'border border-accent text-accent animate-breathe'
                        : 'border border-line text-text-3',
                  )}
                >
                  {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate font-mono text-[11px]', current ? 'text-text-1' : 'text-text-2')}>
                    {s.id}
                  </span>
                  <span className="block font-mono text-[9px] text-text-3">~{s.minutes}m</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* workbench */}
        <div className="min-w-0 p-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25 }}
            >
              {/* briefing */}
              <div className="max-w-[640px] space-y-3">
                {step.briefing.map((p, i) => (
                  <p key={i} className="text-body leading-relaxed text-text-2">
                    {p}
                  </p>
                ))}
                <div className="rounded-md border-l-[3px] border-amber bg-surface-2 px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-amber">
                    analogy
                  </p>
                  <p className="mt-1 text-body-sm text-text-2">{step.analogy}</p>
                </div>
                <Link
                  to={`/lesson/${step.iso.lesson}`}
                  className="flex items-center gap-2 rounded-md border-l-[3px] border-t2 bg-surface-2 px-4 py-3 transition-colors hover:bg-surface-3"
                >
                  <span className="font-mono text-[11px] text-t2">{step.iso.os}</span>
                  <span className="text-text-3">≡</span>
                  <span className="font-mono text-[11px] text-t5">{step.iso.llm}</span>
                  <span className="ml-auto font-mono text-[10px] text-text-3">lesson →</span>
                </Link>
              </div>

              {/* interactive stage */}
              <div className="mt-5 rounded-md border border-line bg-ink p-4">
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
                  stage — live
                </p>
                <Viz />
              </div>

              {/* code panel */}
              <div className="mt-5 overflow-hidden rounded-md border border-line bg-surface-2">
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <span className="font-mono text-[11px] text-text-3">steps/{step.id}.ts</span>
                  <span className="font-mono text-[10px] text-text-3">{lineCount} lines</span>
                </div>
                <textarea
                  value={code}
                  onChange={(e) => saveDraft(e.target.value)}
                  spellCheck={false}
                  aria-label={`Code harness for step ${stepIndex + 1}`}
                  className="h-[320px] w-full resize-y bg-transparent p-4 font-mono text-code leading-relaxed text-text-2 focus:outline-none"
                />
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => void runChecks()}
                    disabled={running}
                    aria-busy={running}
                    className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold text-accent-foreground transition-transform active:scale-[.97] disabled:opacity-60"
                  >
                    <Play size={11} /> {running ? 'running…' : 'run checks'}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveDraft(step.template)}
                    className="flex items-center gap-1.5 rounded-sm border border-line bg-surface-3 px-3 py-1.5 font-mono text-[11px] text-text-2 transition-colors hover:border-line-bright"
                  >
                    <RotateCcw size={11} /> reset to template
                  </button>
                  <button
                    type="button"
                    onClick={step.hints ? revealHint : () => setShowSolution((v) => !v)}
                    disabled={step.hints != null && hintRung >= step.hints.length}
                    className="flex items-center gap-1.5 rounded-sm border border-line bg-surface-3 px-3 py-1.5 font-mono text-[11px] text-text-2 transition-colors hover:border-line-bright disabled:opacity-45"
                  >
                    <Eye size={11} />{' '}
                    {step.hints
                      ? hintRung >= step.hints.length
                        ? 'no more hints'
                        : `hint ${hintRung + 1}/${step.hints.length}`
                      : 'show solution'}
                  </button>
                  <span
                    className={cn(
                      'ml-auto flex items-center gap-1.5 font-mono text-[10px]',
                      mode === 'worker' ? 'text-amber' : mode === 'unavailable' ? 'text-danger' : 'text-text-3',
                    )}
                    title="Your code runs isolated from this page: it cannot see your progress or stall the tab"
                  >
                    <ShieldCheck size={11} aria-hidden />
                    {mode === 'unavailable'
                      ? 'sandbox: unavailable'
                      : mode
                        ? MODE_LABEL[mode]
                        : 'sandbox: starting…'}
                  </span>
                </div>
                {step.hints && hintRung > 0 && (
                  <ol className="space-y-2 border-t border-line p-4">
                    {step.hints.slice(0, hintRung).map((h, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="font-mono text-[10px] text-amber">{i + 1}/3</span>
                        <p className="whitespace-pre-line font-mono text-[11px] leading-relaxed text-text-3">
                          {h}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
                {showSolution && step.solution && (
                  <div className="relative border-t border-line">
                    {!solutionConfirmed && (
                      <button
                        type="button"
                        onClick={revealSolution}
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-ink/60 backdrop-blur-sm"
                      >
                        <span className="font-mono text-[12px] text-amber">
                          reveal the solution?
                        </span>
                        <span className="max-w-[320px] text-center font-mono text-[10px] leading-relaxed text-text-3">
                          XP is still granted, but the `no-hints` achievement is forfeited for
                          this run. Click to confirm.
                        </span>
                      </button>
                    )}
                    <pre
                      className={cn(
                        'max-h-64 overflow-auto p-4 font-mono text-code leading-relaxed text-text-3 scrollbar-slim',
                        !solutionConfirmed && 'select-none blur-sm',
                      )}
                    >
                      {step.solution}
                    </pre>
                  </div>
                )}
              </div>

              {runError && (
                <div role="alert" className="mt-4 rounded-md border border-danger/50 bg-danger/10 px-4 py-3">
                  <p className="font-mono text-[11px] text-danger">harness error: {runError}</p>
                </div>
              )}

              {/* validation bar */}
              <div className="mt-5 rounded-md border border-line bg-surface-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
                    validation
                  </p>
                  <button
                    type="button"
                    disabled={!allPass}
                    onClick={completeStep}
                    className={cn(
                      'group/ks relative overflow-hidden rounded-md px-5 py-2.5 font-display text-[14px] font-semibold transition-all duration-150 ease-snap',
                      allPass
                        ? 'bg-grad-brand text-ink hover:-translate-y-px active:scale-[.97]'
                        : 'cursor-not-allowed bg-surface-3 text-text-3',
                    )}
                  >
                    Complete step →
                  </button>
                </div>
                <div className="mt-3 space-y-1.5" aria-live="polite">
                  {step.checks.map((c, i) => {
                    const r = results?.[c.id]
                    return (
                      <motion.p
                        key={c.id}
                        initial={false}
                        animate={r ? { scale: [1, 1.02, 1] } : undefined}
                        transition={{ duration: 0.25, delay: i * 0.06 }}
                        className="flex items-start gap-2 font-mono text-[12px]"
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                            r == null
                              ? 'border border-line text-text-3'
                              : r.pass
                                ? 'bg-accent text-accent-foreground'
                                : 'bg-danger text-ink',
                          )}
                        >
                          {r == null ? (
                            <span className="h-1 w-1 rounded-full bg-text-3" />
                          ) : r.pass ? (
                            <Check size={10} strokeWidth={3.5} />
                          ) : (
                            <X size={10} strokeWidth={3.5} />
                          )}
                        </span>
                        <span className={r == null ? 'text-text-3' : r.pass ? 'text-text-2' : 'text-danger'}>
                          {c.label}
                          {r && !r.pass && <span className="ml-2 text-[10px]">— {r.msg}</span>}
                        </span>
                      </motion.p>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-16 right-6 z-[80] rounded-md border border-accent/40 bg-surface-2 px-4 py-2.5 font-mono text-xs text-accent shadow-lg lg:bottom-14"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero({
  stepsDone,
  onBegin,
}: {
  stepsDone: string[]
  onBegin: () => void
}) {
  const n = stepsDone.length
  const pct = Math.round((n / 7) * 100)
  return (
    <section className="mx-auto max-w-app px-6 pt-24 lg:px-12">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-[760px] text-center"
      >
        <p className="section-label text-grad-brand">T* — capstone</p>
        <h1 className="mt-4 font-display text-display-lg text-text-1">Build the engine.</h1>
        <p className="mx-auto mt-4 max-w-[62ch] text-body-lg text-text-2">
          Seven steps. One toy transformer. By the end you'll have tokenized, forwarded,
          cached, batched — and measured TTFT and ITL with your own hands. Everything runs in
          your browser; every stage is visible.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 font-mono text-[11px] text-text-3">
          {['7 steps', '~4h', `+${XP.capstoneStep} XP/step`, 'unlocks after T5 · best after T7'].map(
            (c) => (
              <span key={c} className="rounded-full border border-line bg-surface-2 px-3 py-1">
                {c}
              </span>
            ),
          )}
        </div>

        {/* 7-segment step bar */}
        <div className="mt-8">
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                {i < n && (
                  <motion.div
                    className="h-full rounded-full bg-grad-brand"
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] text-text-3">
            {n}/7 · {pct}%
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={onBegin}
            className="group/ks relative inline-flex items-center gap-2 overflow-hidden rounded-md bg-accent px-6 py-3 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 ease-snap hover:-translate-y-px active:scale-[.97]"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-grad-brand opacity-90 transition-transform duration-300 ease-out-expo group-hover/ks:translate-x-0" />
            <span className="relative">
              {n === 0 ? 'Begin step 1 →' : n >= 7 ? 'Review the build →' : `Resume step ${n + 1} →`}
            </span>
          </button>
          <Link
            to="/lab/sim-engine"
            className="font-mono text-body-sm text-text-2 transition-colors hover:text-accent"
          >
            open in free play ↗
          </Link>
          <Link
            to="/week"
            className="inline-flex items-center gap-2 rounded-md border border-accent/50 bg-accent/10 px-4 py-2 font-mono text-body-sm text-accent transition-colors hover:bg-accent/20"
          >
            capstone 2.0: fleet week →
          </Link>
        </div>
        <p className="mt-4 font-mono text-[10px] text-text-3 lg:hidden">
          best on a wide screen
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-10 max-w-[720px]"
      >
        <EngineGlyph lit={n} active={n < 7 ? n : undefined} className="w-full" />
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Results dashboard + certificate                                     */
/* ------------------------------------------------------------------ */

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1e-9)
  const min = Math.min(...values)
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 96
      const y = 26 - ((v - min) / Math.max(1e-9, max - min)) * 22
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 96 28" className="h-7 w-24" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

function Dashboard() {
  const metrics = useProgress((s) => s.capstone.metrics)
  const reduced = useReducedMotion()
  const m = metrics ?? measureEngine(TOY_MODEL, SAMPLE_PROMPTS[0].text, SAMPLE_PROMPTS[0].script)

  const kvSaved = useMemo(() => {
    const sched = simulateSchedule(makeWorkload(), {
      maxBatch: 4,
      memBlocks: 64,
      mode: 'continuous',
    })
    const pagedTokens = sched.requests.reduce(
      (a, r) => a + Math.ceil((r.promptIds.length + r.generated.length) / KV_BLOCK_SIZE) * KV_BLOCK_SIZE,
      0,
    )
    const naiveTokens = 32 * sched.requests.length // reserve max-ctx per sequence
    return Math.round((1 - pagedTokens / naiveTokens) * 100)
  }, [])

  const panels = [
    { label: 'TTFT', value: `${m.ttft.toFixed(1)}ms`, spark: TRACE.ttft, color: '#FFB224' },
    { label: 'ITL', value: `${m.itl.toFixed(1)}ms`, spark: TRACE.itl, color: '#3EF2A4' },
    { label: 'throughput', value: `${m.throughput.toFixed(0)} tok/s`, spark: TRACE.itl, color: '#5CA8FF' },
    { label: 'KV blocks saved vs naive', value: `${kvSaved}%`, spark: TRACE.itl, color: '#A78BFA' },
  ]

  return (
    <div className="relative mt-14 overflow-hidden rounded-lg border border-line bg-surface-1 p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-grad-brand" aria-hidden />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-h3 text-text-1">results — your engine, measured</h2>
        <p className="font-mono text-[11px] text-text-3">all stages lit · deterministic seed</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {panels.map((p, i) => (
          <motion.div
            key={p.label}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-md border border-line bg-surface-2 p-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
              {p.label}
            </p>
            <p className="mt-1 font-display text-stat text-text-1">{p.value}</p>
            <Sparkline values={p.spark} color={p.color} />
          </motion.div>
        ))}
      </div>

      {/* auto-replay strip */}
      <div className="mt-5 overflow-hidden rounded-md border border-line bg-ink">
        <EngineGlyph lit={7} className="w-full" />
        <div className="border-t border-line py-2">
          <div className={cn('flex w-max gap-2 px-3', !reduced && 'animate-marquee')}>
            {[0, 1].map((dup) => (
              <div key={dup} className="flex gap-2" aria-hidden={dup === 1}>
                {[...SAMPLE_PROMPT_IDS, ...SAMPLE_SCRIPT_IDS].map((id, i) => (
                  <span
                    key={`${dup}-${i}`}
                    className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-2"
                  >
                    {id === EOS_ID ? '<eos>' : detokenize([id]).replace(' ', '␣')}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Certificate() {
  const metrics = useProgress((s) => s.capstone.metrics)
  const [copied, setCopied] = useState(false)
  const m = metrics ?? measureEngine(TOY_MODEL, SAMPLE_PROMPTS[0].text, SAMPLE_PROMPTS[0].script)
  const dateStr = new Date().toISOString().slice(0, 10)

  const download = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 630
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // background + blueprint grid
    ctx.fillStyle = '#07090D'
    ctx.fillRect(0, 0, 1200, 630)
    ctx.strokeStyle = 'rgba(148,163,184,.07)'
    ctx.lineWidth = 1
    for (let x = 0; x <= 1200; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke()
    }
    for (let y = 0; y <= 630; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke()
    }
    // gradient hairline
    const grad = ctx.createLinearGradient(0, 0, 1200, 0)
    grad.addColorStop(0, '#3EF2A4')
    grad.addColorStop(0.5, '#22D3EE')
    grad.addColorStop(1, '#A78BFA')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 1200, 3)
    // hex badge
    ctx.save()
    ctx.translate(600, 150)
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      const px = Math.cos(a) * 64
      const py = Math.sin(a) * 64
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = '#111722'
    ctx.fill()
    ctx.strokeStyle = grad
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#3EF2A4'
    ctx.font = '700 34px "JetBrains Mono", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('[▮]_', 0, 0)
    ctx.restore()
    // headline
    ctx.fillStyle = '#E8EEF6'
    ctx.font = '700 52px "Space Grotesk", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Engine built.', 600, 290)
    ctx.fillStyle = '#A3B0C2'
    ctx.font = '400 20px "JetBrains Mono", monospace'
    ctx.fillText('kernelspace certificate of systems competence', 600, 330)
    // metrics readout
    ctx.fillStyle = '#3EF2A4'
    ctx.font = '500 22px "JetBrains Mono", monospace'
    ctx.fillText(
      `TTFT ${m.ttft.toFixed(1)}ms · ITL ${m.itl.toFixed(1)}ms · ${m.throughput.toFixed(0)} tok/s`,
      600,
      400,
    )
    ctx.fillStyle = '#5D6B80'
    ctx.font = '400 16px "JetBrains Mono", monospace'
    ctx.fillText(`7 steps · tokenize → batch → measure · ${dateStr}`, 600, 445)
    ctx.fillText('runs 100% in the browser · no backend · deterministic seed 1337', 600, 560)

    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `kernelspace-certificate-${dateStr}.png`
    a.click()
  }

  const share = async () => {
    const url = `${window.location.origin}/capstone?ttft=${m.ttft.toFixed(1)}&itl=${m.itl.toFixed(1)}&th=${m.throughput.toFixed(0)}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // clipboard unavailable
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto mt-10 max-w-[640px] rounded-lg border border-line bg-surface-1 p-8 text-center"
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, duration: 0.7 }}
        className="mx-auto flex h-24 w-24 items-center justify-center"
      >
        <svg viewBox="0 0 96 96" className="h-24 w-24" role="img" aria-label="Capstone badge">
          <defs>
            <linearGradient id="cert-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3EF2A4" />
              <stop offset="50%" stopColor="#22D3EE" />
              <stop offset="100%" stopColor="#A78BFA" />
            </linearGradient>
          </defs>
          <polygon
            points="48,6 84,27 84,69 48,90 12,69 12,27"
            fill="#111722"
            stroke="url(#cert-grad)"
            strokeWidth="2.5"
          />
          <text
            x="48"
            y="54"
            textAnchor="middle"
            fontSize="18"
            fontFamily="JetBrains Mono, monospace"
            fill="#3EF2A4"
            fontWeight="700"
          >
            [▮]_
          </text>
        </svg>
      </motion.div>
      <h3 className="mt-5 font-display text-h2 text-text-1">Engine built.</h3>
      <p className="mt-3 font-mono text-[12px] leading-relaxed text-text-2">
        TTFT {m.ttft.toFixed(1)}ms · ITL {m.itl.toFixed(1)}ms · {m.throughput.toFixed(0)} tok/s
        <br />
        {dateStr} · kernelspace certificate of systems competence
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={download}
          className="flex items-center gap-2 rounded-md bg-accent px-5 py-3 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 ease-snap hover:-translate-y-px active:scale-[.97]"
        >
          <Download size={15} /> download card (PNG)
        </button>
        <button
          type="button"
          onClick={share}
          className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-5 py-3 font-mono text-[13px] text-text-1 transition-colors hover:border-line-bright"
        >
          {copied ? <Check size={15} className="text-accent" /> : <Share2 size={15} />}
          {copied ? 'link copied' : 'share'}
        </button>
      </div>
      <div className="mt-8 grid gap-3 border-t border-line pt-6 sm:grid-cols-3">
        {[
          { label: 'read the vLLM source', to: '/lesson/t5.l5' },
          { label: 'revisit the lab in free play', to: '/lab/sim-engine' },
          { label: 'export your progress', to: '/progress' },
        ].map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="rounded-md border border-line bg-surface-2 px-3 py-2.5 font-mono text-[11px] text-text-2 transition-colors hover:border-line-bright hover:text-accent"
          >
            {c.label} →
          </Link>
        ))}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Page assembly                                                       */
/* ------------------------------------------------------------------ */

export default function Capstone() {
  const stepsDone = useProgress((s) => s.capstone.stepsDone)
  const [activeStep, setActiveStep] = useState<number>(-1)
  const wizardRef = useRef<HTMLDivElement>(null)
  const allDone = stepsDone.length >= 7

  // the sandbox frame and its worker leave with the page
  useEffect(() => closeSandbox, [])

  const openWizard = (index?: number) => {
    const target = index ?? Math.min(stepsDone.length, 6)
    setActiveStep(target)
    window.setTimeout(
      () => wizardRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }),
      60,
    )
  }

  return (
    <div className="bg-grad-radial-glow pb-24">
      <Hero stepsDone={stepsDone} onBegin={() => openWizard()} />

      <section className="mx-auto mt-14 max-w-app px-6 lg:px-12">
        {allDone && (
          <>
            <Dashboard />
            <Certificate />
            <div className="mt-10 text-center">
              <button
                type="button"
                onClick={() => openWizard(0)}
                className="font-mono text-body-sm text-text-2 transition-colors hover:text-accent"
              >
                review any step ↓
              </button>
            </div>
          </>
        )}
        <div ref={wizardRef} className="scroll-mt-20">
          {activeStep >= 0 && (
            <Wizard
              key={STEPS[activeStep].id}
              stepIndex={activeStep}
              stepsDone={stepsDone}
              onSelect={(i) => setActiveStep(i)}
              onCompleted={() => {
                if (activeStep < 6) setActiveStep(activeStep + 1)
                else setActiveStep(-1)
              }}
            />
          )}
        </div>
        {activeStep < 0 && !allDone && (
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openWizard(i)}
                disabled={i > stepsDone.length}
                className={cn(
                  'rounded-md border border-line bg-surface-1 p-4 text-left transition-colors duration-150',
                  i <= stepsDone.length
                    ? 'hover:border-line-bright hover:bg-surface-2'
                    : 'opacity-45',
                )}
              >
                <p className="font-mono text-[10px] text-text-3">step {i + 1}</p>
                <p className="mt-1 flex items-center gap-2 font-mono text-body-sm text-text-1">
                  {stepsDone.includes(s.id) && (
                    <Award size={13} className="text-accent" />
                  )}
                  {s.id}
                </p>
                <p className="mt-1 font-mono text-[10px] text-text-3">~{s.minutes}m</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
