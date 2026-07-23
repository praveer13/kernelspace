/**
 * SIM-08 · Continuous Batching Simulator (sim-batching) — playground.md §11
 * Requests arrive over time (seeded, honest A/B); static vs continuous
 * batching; GPU slot timeline, utilization, TTFT/ITL, preemption,
 * chunked prefill — the scheduler-is-a-batcher aha.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ChevronDown, ChevronUp, Copy, Dices, Pause, Play, RotateCcw, StepForward, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router'
import ContextSwitchLab from '@/components/sims/ContextSwitchLab'
import PlaygroundShell, { completeSimTask } from '@/components/sims/PlaygroundShell'
import SchedulerLab from '@/components/sims/SchedulerLab'
import { CONTEXT_SWITCH_LAB_TASKS } from '@/components/sims/contextSwitchLab.tasks'
import { SCHEDULER_LAB_TASKS as SCHEDULER_TASKS } from '@/components/sims/schedulerLab.tasks'
import { Slider } from '@/components/ui/slider'
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
      return next.length > 260 ? next.slice(next.length - 260) : next
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

/* ------------------------------------------------------------------ */
/* engine — pure deterministic state machine (fixed 10 ticks/s logical) */
/* ------------------------------------------------------------------ */

type Mode = 'static' | 'continuous'
type PresetId = 'steady' | 'burst' | 'bimodal'

type MachineMode = 'batching' | 'scheduler' | 'context-switch'
type PreemptionPolicy = 'youngest' | 'oldest'

interface Req {
  id: number
  prompt: number
  out: number
  arrival: number
  state: 'queued' | 'prefill' | 'decode' | 'done' | 'preempted'
  prefilled: number
  generated: number
  firstTokenTick: number | null
  doneTick: number | null
  itlSum: number
  itlN: number
  lastDecodeTick: number | null
  admittedTick: number | null
  protectedUntil: number
}

interface EngineConfig {
  mode: Mode
  maxBatch: number
  lambdaPerSec: number
  meanOut: number
  memCapacity: number
  chunked: boolean
  preempt: boolean
  preemptionPolicy: PreemptionPolicy
  preset: PresetId
  seed: number
  honestSeed: boolean
  fixedTrace: boolean
}

function policyWorkloadKey(c: EngineConfig): string {
  return [
    c.mode,
    c.chunked ? 'chunk' : 'nochunk',
    c.seed,
    c.preset,
    c.lambdaPerSec,
    c.meanOut,
    c.maxBatch,
    c.memCapacity,
    c.preempt,
  ].join('|')
}

interface EngineEvent {
  kind: LogKind
  text: string
}

interface Engine {
  tick: number
  runWorkload: string
  runPolicy: PreemptionPolicy
  rng: () => number
  nextId: number
  queue: Req[]
  active: Req[]
  preempted: Req[]
  done: Req[]
  staticPhase: 'idle' | 'prefill' | 'decode'
  batchMinOut: number
  batchMaxOut: number
  generatedTotal: number
  ttftSum: number
  ttftN: number
  itlSum: number
  itlN: number
  preemptCount: number
  lowUtilStreak: number
  stragglerSeen: boolean
  fullTraceIdleSlotSteps: number
  adIdleSlotSteps: number
  series: { util: number[]; batch: number[]; mem: number[] }
  genWindow: number[]
  events: EngineEvent[]
}

const PREFILL_RATE = 512 // tokens/tick dedicated prefill
const CHUNK_BUDGET = 768 // tokens/tick shared budget (SARATHI-ish)
const MAX_TICKS = 1200 // 120s logical per run
const SERIES_CAP = 600

function createEngine(cfg: EngineConfig): Engine {
  return {
    tick: 0,
    runWorkload: policyWorkloadKey(cfg),
    runPolicy: cfg.preemptionPolicy,
    rng: mulberry32(cfg.seed),
    nextId: 1,
    queue: [],
    active: [],
    preempted: [],
    done: [],
    staticPhase: 'idle',
    batchMinOut: 0,
    batchMaxOut: 0,
    generatedTotal: 0,
    ttftSum: 0,
    ttftN: 0,
    itlSum: 0,
    itlN: 0,
    preemptCount: 0,
    lowUtilStreak: 0,
    stragglerSeen: false,
    fullTraceIdleSlotSteps: 0,
    adIdleSlotSteps: 0,
    series: { util: [], batch: [], mem: [] },
    genWindow: [],
    events: [],
  }
}

function poisson(rng: () => number, lam: number): number {
  const L = Math.exp(-lam)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}

function expDist(rng: () => number, mean: number): number {
  return Math.max(4, Math.round(-mean * Math.log(1 - rng())))
}

function genReq(e: Engine, cfg: EngineConfig): Req {
  const r = e.rng
  let prompt: number
  let out: number
  if (cfg.preset === 'steady') {
    prompt = 64 + Math.floor(r() * 448)
    out = expDist(r, cfg.meanOut)
  } else if (cfg.preset === 'burst') {
    prompt = 32 + Math.floor(r() * 224)
    out = expDist(r, cfg.meanOut)
  } else {
    if (r() < 0.5) {
      prompt = 32 + Math.floor(r() * 96)
      out = 8 + Math.floor(r() * 24)
    } else {
      prompt = 1024 + Math.floor(r() * 1024)
      out = Math.max(32, expDist(r, cfg.meanOut))
    }
  }
  return {
    id: e.nextId++,
    prompt,
    out,
    arrival: e.tick,
    state: 'queued',
    prefilled: 0,
    generated: 0,
    firstTokenTick: null,
    doneTick: null,
    itlSum: 0,
    itlN: 0,
    lastDecodeTick: null,
    admittedTick: null,
    protectedUntil: 0,
  }
}

function memUsed(e: Engine): number {
  let m = 0
  for (const r of e.active) m += r.prefilled + r.generated
  return m
}

function finishIfDone(e: Engine, r: Req): void {
  if (r.generated >= r.out && r.state !== 'done') {
    r.state = 'done'
    r.doneTick = e.tick + 1
    e.done.push(r)
    const ttft = r.firstTokenTick !== null ? (r.firstTokenTick - r.arrival) / 10 : 0
    const itl = r.itlN > 0 ? (r.itlSum / r.itlN) * 100 : 100
    e.events.push({ kind: 'ok', text: `FINISH r${r.id}  TTFT ${ttft.toFixed(2)}s · ITL ${itl.toFixed(0)}ms · ${r.out} tok` })
  }
}

function firstToken(e: Engine, r: Req): void {
  r.state = 'decode'
  r.generated = 1
  e.generatedTotal++
  r.firstTokenTick = e.tick
  r.lastDecodeTick = e.tick
  e.ttftSum += e.tick - r.arrival
  e.ttftN++
}

function decodeStep(e: Engine, r: Req): number {
  r.generated++
  e.generatedTotal++
  if (r.lastDecodeTick !== null) {
    const gap = e.tick - r.lastDecodeTick
    r.itlSum += gap
    r.itlN++
    e.itlSum += gap
    e.itlN++
  }
  r.lastDecodeTick = e.tick
  finishIfDone(e, r)
  return 1
}

const FIXED_TRACE = [
  { id: 1, prompt: 64, out: 8, arrival: 0 },
  { id: 2, prompt: 64, out: 12, arrival: 0 },
  { id: 3, prompt: 64, out: 20, arrival: 0 },
  { id: 4, prompt: 64, out: 40, arrival: 0 },
  { id: 5, prompt: 64, out: 12, arrival: 8 },
  { id: 6, prompt: 64, out: 12, arrival: 12 },
  { id: 7, prompt: 64, out: 12, arrival: 20 },
] as const

function enqueueFixedTraceArrivals(e: Engine): void {
  for (const spec of FIXED_TRACE) {
    if (spec.arrival !== e.tick) continue
    const request: Req = {
      ...spec,
      state: 'queued',
      prefilled: 0,
      generated: 0,
      firstTokenTick: null,
      doneTick: null,
      itlSum: 0,
      itlN: 0,
      lastDecodeTick: null,
      admittedTick: null,
      protectedUntil: 0,
    }
    e.queue.push(request)
    e.nextId = Math.max(e.nextId, request.id + 1)
    e.events.push({ kind: 'op', text: `ARRIVE ${String.fromCharCode(64 + request.id)}  p=${request.prompt} out=${request.out} (fixed trace)` })
  }
}

function engineTick(e: Engine, cfg: EngineConfig): void {
  if (cfg.fixedTrace) enqueueFixedTraceArrivals(e)
  /* ---- arrivals (poisson; burst preset modulates λ) ---- */
  if (!cfg.fixedTrace) {
    let lam = cfg.lambdaPerSec / 10
    if (cfg.preset === 'burst' && e.tick % 120 < 20) lam *= 5
    const k = poisson(e.rng, lam)
    for (let i = 0; i < k && e.queue.length < 64; i++) {
      const r = genReq(e, cfg)
      e.queue.push(r)
      e.events.push({ kind: 'op', text: `ARRIVE r${r.id}  p=${r.prompt} out≈${r.out} (queue ${e.queue.length})` })
    }
  }

  let decodeTokens = 0

  if (cfg.mode === 'static') {
    /* ================= STATIC BATCHING ================= */
    if (e.active.length === 0) {
      let mem = 0
      const admitted: Req[] = []
      while (e.queue.length > 0 && admitted.length < cfg.maxBatch) {
        const r = e.queue[0]
        if (mem + r.prompt + r.out > cfg.memCapacity) break
        e.queue.shift()
        r.state = 'prefill'
        r.admittedTick = e.tick
        admitted.push(r)
        mem += r.prompt + r.out
      }
      if (admitted.length > 0) {
        e.active = admitted
        e.staticPhase = 'prefill'
        e.batchMinOut = Math.min(...admitted.map((r) => r.out))
        e.batchMaxOut = Math.max(...admitted.map((r) => r.out))
        e.events.push({
          kind: 'op',
          text: `BATCH LOCK  ${admitted.length} seqs admitted — slots locked until ALL finish (static)`,
        })
      }
    }
    if (e.staticPhase === 'prefill' && e.active.length > 0) {
      for (const r of e.active) r.prefilled = Math.min(r.prompt, r.prefilled + PREFILL_RATE)
      if (e.active.every((r) => r.prefilled >= r.prompt)) {
        // lockstep: everyone waited for the longest prompt; first tokens together
        for (const r of e.active) {
          firstToken(e, r)
          decodeTokens++
        }
        e.staticPhase = 'decode'
        const slowest = e.active.reduce((a, b) => (a.prompt > b.prompt ? a : b))
        e.events.push({ kind: 'op', text: `PREFILL DONE  batch decodes in lockstep (slowest prompt: r${slowest.id}, ${slowest.prompt} tok)` })
      }
    } else if (e.staticPhase === 'decode') {
      for (const r of e.active) {
        if (r.state !== 'decode') continue
        decodeTokens += decodeStep(e, r)
      }
      const still = e.active.filter((r) => r.state === 'decode').length
      if (still > 0 && still <= Math.max(1, Math.floor(cfg.maxBatch / 4)) && e.batchMaxOut >= 3 * e.batchMinOut) {
        e.lowUtilStreak++
        if (e.lowUtilStreak === 15) {
          e.stragglerSeen = true
          e.events.push({
            kind: 'warn',
            text: `STRAGGLER CLIFF  ${still}/${cfg.maxBatch} slots decoding — GPU idling at ${Math.round((100 * still) / cfg.maxBatch)}% (len ratio ${Math.round(e.batchMaxOut / Math.max(1, e.batchMinOut))}×)`,
          })
        }
      } else {
        e.lowUtilStreak = 0
      }
      if (e.active.length > 0 && e.active.every((r) => r.state === 'done')) {
        e.events.push({ kind: 'op', text: `BATCH DONE  all ${e.active.length} seqs finished — slots unlock, next batch admits` })
        e.active = []
        e.staticPhase = 'idle'
      }
    }
  } else {
    /* ================= CONTINUOUS BATCHING ================= */
    // iteration-level admission (ORCA-style)
    while (e.queue.length > 0 && e.active.length < cfg.maxBatch) {
      const r = e.queue[0]
      if (memUsed(e) + r.prompt > cfg.memCapacity) {
        if (cfg.preempt) {
          const candidates = e.active.filter((v) => v.state === 'decode' && v.protectedUntil <= e.tick)
          const victim = cfg.preemptionPolicy === 'youngest' ? candidates[candidates.length - 1] : candidates[0]
          if (victim) {
            victim.state = 'preempted'
            e.preempted.push(victim)
            e.active = e.active.filter((a) => a !== victim)
            e.preemptCount++
            e.events.push({ kind: 'warn', text: `PREEMPT r${victim.id}  KV swapped out for r${r.id} ≡ OS swap` })
            continue
          }
        }
        break
      }
      e.queue.shift()
      r.state = 'prefill'
      r.admittedTick = e.tick
      r.protectedUntil = e.tick + 10 // grace: never insta-thrash a fresh admission
      e.active.push(r)
      e.events.push({ kind: 'op', text: `ADMIT r${r.id}  p=${r.prompt} out≈${r.out} → slot ${e.active.length}/${cfg.maxBatch}` })
    }

    if (cfg.chunked || cfg.fixedTrace) {
      // SARATHI-ish: one shared token budget per iteration; decodes first
      let budget = CHUNK_BUDGET
      for (const r of e.active) {
        if (r.state === 'decode' && budget > 0) {
          decodeTokens += decodeStep(e, r)
          budget--
        }
      }
      for (const r of e.active) {
        if (r.state === 'prefill' && budget > 0) {
          const c = Math.min(budget, r.prompt - r.prefilled)
          r.prefilled += c
          budget -= c
          if (r.prefilled >= r.prompt) {
            firstToken(e, r)
            decodeTokens++
          }
        }
      }
    } else {
      // prefill-priority: a prefilling sequence owns the whole iteration
      const pf = e.active.find((r) => r.state === 'prefill')
      if (pf) {
        pf.prefilled = Math.min(pf.prompt, pf.prefilled + PREFILL_RATE)
        if (pf.prefilled >= pf.prompt) {
          firstToken(e, pf)
          decodeTokens++
        } else if (e.active.some((r) => r.state === 'decode')) {
          e.events.push({ kind: 'warn', text: `ITL STALL  decode paused — iteration dedicated to r${pf.id} prefill (${pf.prefilled}/${pf.prompt})` })
        }
      } else {
        for (const r of e.active) {
          if (r.state === 'decode') decodeTokens += decodeStep(e, r)
        }
      }
    }

    // memory growth pressure → apply the selected age policy
    let guard = 0
    while (memUsed(e) > cfg.memCapacity && cfg.preempt && guard++ < 8) {
      const candidates = e.active.filter((v) => v.state === 'decode' && v.protectedUntil <= e.tick)
      const victim = cfg.preemptionPolicy === 'youngest' ? candidates[candidates.length - 1] : candidates[0]
      if (!victim) break
      victim.state = 'preempted'
      e.preempted.push(victim)
      e.active = e.active.filter((a) => a !== victim)
      e.preemptCount++
      e.events.push({ kind: 'warn', text: `PREEMPT r${victim.id}  KV over capacity mid-decode → swap out` })
    }
    // resume when space frees
    while (e.preempted.length > 0 && memUsed(e) + 256 <= cfg.memCapacity) {
      const r = e.preempted.shift()
      if (!r) break
      r.state = 'decode'
      r.protectedUntil = e.tick + 10
      e.active.push(r)
      e.events.push({ kind: 'op', text: `RESUME r${r.id}  swapped back in — decode continues at ${r.generated}/${r.out}` })
    }
  }

  if (cfg.fixedTrace) {
    const occupiedSlots = Math.min(cfg.maxBatch, decodeTokens)
    e.fullTraceIdleSlotSteps += cfg.maxBatch - occupiedSlots
    if (e.tick < 40) {
      const adWork = Math.min(4, e.active.filter((r) => r.id <= 4 && r.lastDecodeTick === e.tick).length)
      e.adIdleSlotSteps += 4 - adWork
    }
  }
  /* ---- bookkeeping / series ---- */
  if (cfg.mode === 'continuous') e.active = e.active.filter((r) => r.state !== 'done') // slots free instantly
  const busy = e.active.length > 0
  const util = busy ? Math.max(25, Math.min(100, (100 * decodeTokens) / cfg.maxBatch)) : 0
  e.series.util.push(util)
  e.series.batch.push(e.active.filter((r) => r.state !== 'done').length)
  e.series.mem.push(memUsed(e))
  if (e.series.util.length > SERIES_CAP) {
    e.series.util.shift()
    e.series.batch.shift()
    e.series.mem.shift()
  }
  e.genWindow.push(decodeTokens)
  if (e.genWindow.length > 30) e.genWindow.shift()
  e.tick++
}

/* ------------------------------------------------------------------ */
/* run records (same-seed A/B comparison for guided tasks)             */
/* ------------------------------------------------------------------ */

interface RunRecord {
  throughput: number
  meanTtft: number
  meanItl: number
  done: number
  ticks: number
  fullTraceIdleSlotSteps: number
  adIdleSlotSteps: number
  fairness: number
  adDoneTicks: number[]
  preemptCount: number
}

interface PolicyComparison {
  youngest: RunRecord
  oldest: RunRecord
  ttftDelta: number
  fairnessDelta: number
}

function recordOf(e: Engine): RunRecord {
  const windowSum = e.genWindow.reduce((a, b) => a + b, 0)
  const ttfts = e.done
    .filter((r) => r.firstTokenTick !== null)
    .map((r) => (r.firstTokenTick as number) - r.arrival)
  const ttftSum = ttfts.reduce((sum, value) => sum + value, 0)
  const ttftSquareSum = ttfts.reduce((sum, value) => sum + value * value, 0)
  return {
    throughput: e.tick > 30 ? (e.generatedTotal / e.tick) * 10 : (windowSum / Math.max(1, e.genWindow.length)) * 10,
    meanTtft: e.ttftN > 0 ? e.ttftSum / e.ttftN / 10 : 0,
    meanItl: e.itlN > 0 ? (e.itlSum / e.itlN) * 100 : 0,
    done: e.done.length,
    ticks: e.tick,
    fullTraceIdleSlotSteps: e.fullTraceIdleSlotSteps,
    adIdleSlotSteps: e.adIdleSlotSteps,
    fairness: ttftSquareSum > 0 ? (ttftSum * ttftSum) / (ttfts.length * ttftSquareSum) : ttfts.length > 0 ? 1 : 0,
    adDoneTicks: e.done.filter((r) => r.id <= 4).sort((a, b) => a.id - b.id).map((r) => r.doneTick ?? -1),
    preemptCount: e.preemptCount,
  }
}

const TASKS = [
  { id: 'batch-trace-static', text: 'Run the deterministic 8/12/20/40 trace on static batching and measure idle slots and wait.', xp: 60 },
  { id: 'batch-trace-continuous', text: 'Run the same 8/12/20/40 trace continuously and watch freed slots recycle.', xp: 60 },
  { id: 'batch-overload', text: 'Sweep arrival rate to 2× capacity and trigger preemption under memory pressure.', xp: 60 },
  { id: 'batch-policy', text: 'Compare youngest-first and oldest-first preemption policy.', xp: 60 },
]

const SPEED_STEPS = [0.25, 0.5, 1, 2, 4]

/* ------------------------------------------------------------------ */
/* snapshot (engine → React, ≤10 Hz)                                   */
/* ------------------------------------------------------------------ */

interface Snap {
  tick: number
  queue: Req[]
  active: Req[]
  preempted: Req[]
  doneRecent: Req[]
  doneCount: number
  throughput: number
  meanTtft: number
  meanItl: number
  preemptCount: number
  utilNow: number
  memNow: number
  batchNow: number
}

function snapshot(e: Engine): Snap {
  const w = e.genWindow.reduce((a, b) => a + b, 0)
  return {
    tick: e.tick,
    queue: e.queue.map((r) => ({ ...r })),
    active: e.active.map((r) => ({ ...r })),
    preempted: e.preempted.map((r) => ({ ...r })),
    doneRecent: e.done.slice(-3).map((r) => ({ ...r })),
    doneCount: e.done.length,
    throughput: (w / Math.max(1, e.genWindow.length)) * 10,
    meanTtft: e.ttftN > 0 ? e.ttftSum / e.ttftN / 10 : 0,
    meanItl: e.itlN > 0 ? (e.itlSum / e.itlN) * 100 : 0,
    preemptCount: e.preemptCount,
    utilNow: e.series.util[e.series.util.length - 1] ?? 0,
    memNow: memUsed(e),
    batchNow: e.active.filter((r) => r.state !== 'done').length,
  }
}

/* ------------------------------------------------------------------ */
/* component                                                           */
/* ------------------------------------------------------------------ */

function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      onClick={() => onChange(!on)}
      title={hint}
      className="flex items-center justify-between rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 transition-colors duration-180 hover:border-line-bright"
    >
      <span className="font-mono text-[11px] text-text-2">{label}</span>
      <span className={cn('flex h-4 w-7 items-center rounded-full p-0.5 transition-colors duration-180', on ? 'justify-end bg-accent/70' : 'justify-start bg-surface-3')}>
        <span className="block h-3 w-3 rounded-full bg-text-1" />
      </span>
    </button>
  )
}

export default function BatchingSim() {
  const [searchParams, setSearchParams] = useSearchParams()
  const machineParam = searchParams.get('machine')
  const fromParam = searchParams.get('from')
  const desiredMode: MachineMode =
    machineParam === 'batching' || machineParam === 'scheduler' || machineParam === 'context-switch'
      ? machineParam
      : fromParam === 't2.l4'
        ? 'scheduler'
        : fromParam === 't2.l1'
          ? 'context-switch'
          : 'batching'
  const machineMode = desiredMode
  const selectMachine = (mode: MachineMode) => {
    setPlaying(false)
    const next = new URLSearchParams(searchParams)
    next.set('machine', mode)
    setSearchParams(next, { replace: true })
  }
  const reduced = useReducedMotion()
  const { lines, log, clear } = useLog('batcher idle — press ▶ to start the arrival stream')

  const [cfg, setCfg] = useState<EngineConfig>({
    mode: 'static',
    maxBatch: 8,
    lambdaPerSec: 0.5,
    meanOut: 96,
    memCapacity: 16384,
    chunked: false,
    preempt: false,
    preemptionPolicy: 'youngest',
    preset: 'steady',
    seed: 0xc0ffee,
    honestSeed: true,
    fixedTrace: false,
  })
  const configRef = useRef<EngineConfig>(cfg)
  const [initialEngine] = useState<Engine>(() => createEngine(cfg))
  const engineRef = useRef<Engine>(initialEngine)
  const [snap, setSnap] = useState<Snap>(() => snapshot(initialEngine))
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(2)
  const speedRef = useRef(SPEED_STEPS[2])
  const accRef = useRef(0)
  const recordsRef = useRef(new Map<string, RunRecord>())
  const [traceMode, setTraceMode] = useState<Mode | null>(null)
  const [traceResult, setTraceResult] = useState<RunRecord | null>(null)
  const [policyComparison, setPolicyComparison] = useState<PolicyComparison | null>(null)
  const overloadPreemptionSeen = useRef(false)

  const drainEvents = useCallback(() => {
    const eng = engineRef.current
    if (!eng) return
    const evs = eng.events.splice(0, eng.events.length)
    for (const ev of evs.slice(0, 12)) log(ev.kind, ev.text)
    if (evs.length > 12) log('op', `… ${evs.length - 12} more events`)
  }, [log])

  /* ---- run recording + same-seed A/B task evaluation ---- */
  const finishRun = useCallback(
    (reason: string, complete = false) => {
      const e = engineRef.current
      const c = configRef.current
      if (!e || !complete || c.fixedTrace || c.mode !== 'continuous' || !c.preempt) return
      const workload = policyWorkloadKey(c)
      if (e.runWorkload !== workload || e.runPolicy !== c.preemptionPolicy) {
        log('warn', `RUN NOT RECORDED  config changed during execution; restart for a matched policy comparison`)
        return
      }
      const rec = recordOf(e)
      if (rec.preemptCount === 0) {
        log('warn', `RUN NOT RECORDED  ${c.preemptionPolicy}-first selected, but no preemption exercised the policy`)
        return
      }
      recordsRef.current.set(`${workload}|${c.preemptionPolicy}`, rec)
      log(
        'op',
        `COMPLETE RUN  ${c.preemptionPolicy}-first seed 0x${c.seed.toString(16).toUpperCase()} · TTFT ${rec.meanTtft.toFixed(2)}s · fairness ${rec.fairness.toFixed(3)} · done ${rec.done} (${reason})`,
      )
      const youngest = recordsRef.current.get(`${workload}|youngest`)
      const oldest = recordsRef.current.get(`${workload}|oldest`)
      if (youngest && oldest) {
        const comparison = {
          youngest,
          oldest,
          ttftDelta: oldest.meanTtft - youngest.meanTtft,
          fairnessDelta: oldest.fairness - youngest.fairness,
        }
        setPolicyComparison(comparison)
        log(
          'ok',
          `MATCHED POLICY A/B  oldest − youngest: TTFT ${comparison.ttftDelta >= 0 ? '+' : ''}${comparison.ttftDelta.toFixed(2)}s · fairness ${comparison.fairnessDelta >= 0 ? '+' : ''}${comparison.fairnessDelta.toFixed(3)}`,
        )
        completeSimTask('sim-batching', 'batch-policy', 60)
      }
    },
    [log],
  )
  const finishRunRef = useRef(finishRun)
  useEffect(() => {
    finishRunRef.current = finishRun
  }, [finishRun])

  /* ---- reset / config helpers ---- */
  const recreateEngine = useCallback((next: EngineConfig) => {
    setCfg(next)
    configRef.current = next
    engineRef.current = createEngine(next)
    overloadPreemptionSeen.current = false
    setSnap(snapshot(engineRef.current))
  }, [])

  const reset = useCallback(
    (newSeed?: number) => {
      finishRunRef.current('reset')
      const seed = newSeed ?? configRef.current.seed
      recreateEngine({ ...configRef.current, seed, fixedTrace: false })
      log('op', `RESET  seed 0x${seed.toString(16).toUpperCase().padStart(6, '0')} · ${configRef.current.mode} · ${configRef.current.preset}${configRef.current.chunked ? ' · chunked' : ''}`)
    },
    [recreateEngine, log],
  )

  const patch = useCallback(
    (p: Partial<EngineConfig>) => {
      const next = { ...configRef.current, ...p }
      setCfg(next)
      configRef.current = next
    },
    [],
  )

  const switchMode = useCallback(
    (mode: Mode) => {
      if (mode === configRef.current.mode) return
      finishRunRef.current('mode switch')
      const seed = configRef.current.honestSeed ? configRef.current.seed : Math.floor(Math.random() * 0xffffff)
      recreateEngine({ ...configRef.current, mode, seed, fixedTrace: false })
      log(
        'op',
        `MODE ≡ ${mode.toUpperCase()}  ${configRef.current.honestSeed ? `same seed 0x${seed.toString(16).toUpperCase()} — identical arrival script (honest A/B)` : 'fresh seed — scripts differ (enable honest-seed for A/B)'}`,
      )
    },
    [recreateEngine, log],
  )

  const changePreset = useCallback(
    (preset: PresetId) => {
      if (preset === configRef.current.preset) return
      finishRunRef.current('script change')
      recreateEngine({ ...configRef.current, preset, fixedTrace: false })
      log('op', `SCRIPT → ${preset} (seed kept)`)
    },
    [recreateEngine, log],
  )
  const runFixedTrace = (mode: Mode) => {
    setPlaying(false)
    setTraceMode(mode)
    setTraceResult(null)
    overloadPreemptionSeen.current = false
    const next: EngineConfig = {
      ...configRef.current,
      mode,
      maxBatch: 4,
      lambdaPerSec: 0,
      memCapacity: 16384,
      chunked: false,
      preempt: false,
      fixedTrace: true,
    }
    recreateEngine(next)
    log('op', `FIXED TRACE START  ${mode.toUpperCase()} · A–D arrive t=0 · E/F/G arrive t=8/12/20`)
    setPlaying(true)
  }

  /* ---- tick loop: fixed 100ms real, speed = logical ticks/interval ---- */
  useEffect(() => {
    if (!playing) return
    const iv = window.setInterval(() => {
      const eng = engineRef.current
      if (!eng) return
      accRef.current += speedRef.current
      const steps = Math.min(8, Math.floor(accRef.current))
      accRef.current -= steps
      for (let i = 0; i < steps && eng.tick < MAX_TICKS; i++) engineTick(eng, configRef.current)
      const traceComplete =
        configRef.current.fixedTrace &&
        eng.done.length === FIXED_TRACE.length &&
        eng.active.length === 0 &&
        eng.queue.length === 0
      if (traceComplete) {
        const rec = recordOf(eng)
        setPlaying(false)
        setTraceResult(rec)
        completeSimTask('sim-batching', configRef.current.mode === 'static' ? 'batch-trace-static' : 'batch-trace-continuous', 60)
        log('ok', `FIXED TRACE COMPLETE  ${configRef.current.mode} · ${rec.throughput.toFixed(1)} tok/s · TTFT ${rec.meanTtft.toFixed(2)}s · A–D idle ${rec.adIdleSlotSteps}/160 · full trace idle ${rec.fullTraceIdleSlotSteps} slot-ticks`)
      } else if (eng.tick >= MAX_TICKS) {
        setPlaying(false)
        finishRunRef.current('120s logical complete', true)
        log('ok', `RUN COMPLETE  t=120s logical · ${eng.done.length} seqs finished`)
      }
      drainEvents()
      setSnap(snapshot(eng))
    }, 100)
    return () => window.clearInterval(iv)
  }, [playing, drainEvents, log])

  const stepOnce = () => {
    const eng = engineRef.current
    if (!eng || playing) return
    engineTick(eng, configRef.current)
    drainEvents()
    setSnap(snapshot(eng))
  }

  /* ---- task watchers ---- */
  useEffect(() => {
    const c = configRef.current
    const requestCapacity = (c.maxBatch * 10) / Math.max(1, c.meanOut)
    const explicitOverload = c.lambdaPerSec >= 2 * requestCapacity
    if (snap.preemptCount > 0) overloadPreemptionSeen.current = true
    if (
      c.mode === 'continuous' &&
      c.preempt &&
      explicitOverload &&
      overloadPreemptionSeen.current
    ) {
      completeSimTask('sim-batching', 'batch-overload', 60)
    }
  }, [snap.preemptCount, snap.queue.length])

  /* ---- utilization chart ---- */
  const chartRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = chartRef.current
    const eng = engineRef.current
    if (!cv || !eng) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = cv.clientWidth
    const h = cv.clientHeight
    cv.width = w * dpr
    cv.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const { util, batch, mem } = eng.series
    const n = util.length
    if (n < 2) {
      ctx.fillStyle = '#5D6B80'
      ctx.font = '11px "JetBrains Mono", monospace'
      ctx.fillText('press ▶ — utilization / batch / memory draw here', 10, h / 2)
      return
    }
    const offset = SERIES_CAP - n
    const px = (i: number) => ((i + offset) / (SERIES_CAP - 1)) * w
    const py = (v01: number) => h - 2 - v01 * (h - 14)
    // util area
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const y = py(util[i] / 100)
      if (i === 0) ctx.moveTo(px(i), y)
      else ctx.lineTo(px(i), y)
    }
    ctx.strokeStyle = '#3EF2A4'
    ctx.lineWidth = 1.25
    ctx.stroke()
    ctx.lineTo(px(n - 1), h)
    ctx.lineTo(px(0), h)
    ctx.closePath()
    ctx.fillStyle = 'rgba(62,242,164,.10)'
    ctx.fill()
    // batch step line (info)
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const y = py(batch[i] / Math.max(1, cfg.maxBatch))
      if (i === 0) ctx.moveTo(px(i), y)
      else ctx.lineTo(px(i), y)
    }
    ctx.strokeStyle = 'rgba(92,168,255,.7)'
    ctx.lineWidth = 1
    ctx.stroke()
    // memory line (rose) + capacity hairline (danger)
    const memMax = Math.max(cfg.memCapacity, ...mem, 1)
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const y = py(mem[i] / memMax)
      if (i === 0) ctx.moveTo(px(i), y)
      else ctx.lineTo(px(i), y)
    }
    ctx.strokeStyle = '#FB7185'
    ctx.lineWidth = 1
    ctx.stroke()
    const cy = py(cfg.memCapacity / memMax)
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(255,92,108,.65)'
    ctx.beginPath()
    ctx.moveTo(0, cy)
    ctx.lineTo(w, cy)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#5D6B80'
    ctx.font = '9px "JetBrains Mono", monospace'
    ctx.fillText('100%', 2, 10)
    ctx.fillText('cap', w - 20, cy - 3)
  }, [snap, cfg.maxBatch, cfg.memCapacity])

  const speed = SPEED_STEPS[speedIdx]

  return (
    <PlaygroundShell
      simId="sim-batching"
      title={
        machineMode === 'scheduler'
          ? 'CPU Scheduler Lab'
          : machineMode === 'context-switch'
            ? 'Context Switch Lab'
            : 'Continuous Batching Simulator'
      }
      subtitle={
        machineMode === 'scheduler'
          ? 'schedule CPU work, expose convoy effects, and repair priority inversion'
          : machineMode === 'context-switch'
            ? 'measure the throughput tax of oversubscription, short quanta, and cold caches'
            : 'the GPU is a CPU; the batcher is a scheduler — watch it context-switch'
      }
      tasks={machineMode === 'scheduler' ? SCHEDULER_TASKS : machineMode === 'context-switch' ? CONTEXT_SWITCH_LAB_TASKS : TASKS}
      help={
        machineMode === 'scheduler' ? (
          <p>
            Compare FIFO, round-robin, and priority scheduling. Change the workload and
            controls, then run the model to see how policy affects latency, throughput,
            and queue growth.
          </p>
        ) : (
          <p>
            Compare static and continuous batching with the same arrival seed. Use memory
            pressure and chunked prefill to expose the scheduling trade-offs behind GPU
            utilization, TTFT, and inter-token latency.
          </p>
        )
      }
    >
      <div className="mb-4 grid min-w-0 grid-cols-1 gap-1 rounded-md border border-line bg-surface-1 p-1 sm:grid-cols-3">
        {(['batching', 'scheduler', 'context-switch'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => selectMachine(mode)}
            aria-pressed={machineMode === mode}
            className={cn(
              'min-w-0 truncate rounded-sm border px-2 py-1.5 font-mono text-[11px] transition-all duration-180 active:scale-[.98]',
              machineMode === mode
                ? 'border-accent bg-accent-dim text-accent'
                : 'border-transparent text-text-2 hover:border-line-bright hover:text-text-1',
            )}
          >
            {mode === 'batching' ? 'continuous batching' : mode === 'scheduler' ? 'CPU scheduler' : 'context switch'}
          </button>
        ))}
      </div>
      {machineMode === 'batching' ? (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          {/* ================= controls ================= */}
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-1 p-3">
            {/* mode toggle — the money toggle */}
            <div>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => switchMode('static')}
                  className={cn(
                    'rounded-sm border px-2 py-1.5 font-mono text-[11px] transition-all duration-180 active:scale-[.97]',
                    cfg.mode === 'static' ? 'border-amber bg-amber/10 text-amber' : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                  )}
                >
                  static batching
                </button>
                <button
                  onClick={() => switchMode('continuous')}
                  className={cn(
                    'rounded-sm border px-2 py-1.5 font-mono text-[11px] transition-all duration-180 active:scale-[.97]',
                    cfg.mode === 'continuous' ? 'border-accent bg-accent-dim text-accent' : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                  )}
                >
                  continuous
                </button>
              </div>
              <div className="mt-1 text-center font-mono text-[10px] text-text-3">static ≡ continuous — the money toggle</div>
            </div>

            {/* transport */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPlaying(!playing)}
                aria-label={playing ? 'pause' : 'play'}
                className="flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-1 transition-all duration-180 hover:border-line-bright active:scale-95"
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={stepOnce}
                disabled={playing}
                aria-label="step one tick"
                className="flex h-8 w-8 items-center justify-center rounded-sm border border-line bg-surface-2 text-text-1 transition-all duration-180 hover:border-line-bright active:scale-95 disabled:opacity-40"
              >
                <StepForward size={14} />
              </button>
              <button
                onClick={() => reset()}
                aria-label="reset run"
                className="flex h-8 w-8 items-center justify-center rounded-sm border border-danger/40 bg-surface-2 text-danger transition-all duration-180 hover:border-danger active:scale-95"
              >
                <RotateCcw size={14} />
              </button>
              <span className="ml-auto font-mono text-[11px] text-text-3">t = {snap.tick}</span>
            </div>

            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px] text-text-3">
                <span>speed</span>
                <span className="text-text-1">{speed}×</span>
              </div>
              <Slider
                value={[speedIdx]}
                onValueChange={(v) => {
                  setSpeedIdx(v[0])
                  speedRef.current = SPEED_STEPS[v[0]]
                }}
                min={0}
                max={SPEED_STEPS.length - 1}
                step={1}
                aria-label="simulation speed"
              />
            </div>

            {/* arrival script */}
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">arrival script</div>
              <div className="grid grid-cols-3 gap-1">
                {(['steady', 'burst', 'bimodal'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => changePreset(p)}
                    className={cn(
                      'rounded-sm border px-1 py-1 font-mono text-[11px] transition-all duration-180 active:scale-[.97]',
                      cfg.preset === p ? 'border-accent bg-accent-dim text-accent' : 'border-line bg-surface-2 text-text-2 hover:border-line-bright',
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px] text-text-3">
                <span>λ arrival rate</span>
                <span className="text-text-1">{cfg.lambdaPerSec.toFixed(1)} req/s</span>
              </div>
              <Slider value={[cfg.lambdaPerSec]} onValueChange={(v) => patch({ lambdaPerSec: v[0] })} min={0.2} max={6} step={0.2} aria-label="arrival rate" />
            </div>
            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px] text-text-3">
                <span>max batch size</span>
                <span className="text-text-1">{cfg.maxBatch}</span>
              </div>
              <Slider value={[cfg.maxBatch]} onValueChange={(v) => patch({ maxBatch: v[0] })} min={2} max={16} step={1} aria-label="max batch size" />
            </div>
            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px] text-text-3">
                <span>mean output length</span>
                <span className="text-text-1">{cfg.meanOut} tok</span>
              </div>
              <Slider value={[cfg.meanOut]} onValueChange={(v) => patch({ meanOut: v[0] })} min={16} max={512} step={16} aria-label="mean output length" />
            </div>
            <div>
              <div className="mb-1 flex justify-between font-mono text-[11px] text-text-3">
                <span>memory capacity (KV)</span>
                <span className="text-text-1">{(cfg.memCapacity / 1024).toFixed(0)}k tok</span>
              </div>
              <Slider value={[cfg.memCapacity]} onValueChange={(v) => patch({ memCapacity: v[0] })} min={2048} max={65536} step={2048} aria-label="memory capacity" />
            </div>

            <Toggle
              on={cfg.chunked}
              onChange={(v) => {
                patch({ chunked: v })
                log('op', v ? 'CHUNKED PREFILL on — SARATHI: prefill shares a token budget with decodes' : 'CHUNKED PREFILL off — prefill owns whole iterations (ITL stalls)')
              }}
              label="chunked prefill ≡ SARATHI"
            />
            <Toggle
              on={cfg.preempt}
              onChange={(v) => {
                patch({
                  preempt: v,
                  memCapacity: v ? Math.min(configRef.current.memCapacity, 6144) : configRef.current.memCapacity,
                })
                log('warn', v ? 'MEMORY PRESSURE on — KV budget squeezed, preemption enabled ≡ OS swap' : 'memory pressure off')
              }}
              label="memory pressure (preempt)"
              hint="continuous mode: over-capacity sequences swap out and resume later"
            />
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[.1em] text-text-3">preemption policy</div>
              <div className="grid grid-cols-2 gap-1">
                {(['youngest', 'oldest'] as const).map((policy) => (
                  <button
                    key={policy}
                    type="button"
                    onClick={() => {
                      if (policy === configRef.current.preemptionPolicy) return
                      finishRunRef.current('policy switch')
                      recreateEngine({ ...configRef.current, preemptionPolicy: policy, fixedTrace: false })
                      log('op', `PREEMPTION POLICY → ${policy}-first · restarted with identical seed/config/workload`)
                    }}
                    className={cn('min-w-0 truncate rounded-sm border px-2 py-1 font-mono text-[10px]', cfg.preemptionPolicy === policy ? 'border-accent bg-accent-dim text-accent' : 'border-line bg-surface-2 text-text-2')}
                  >
                    {policy}-first
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-sm border border-line bg-surface-2 px-2.5 py-2 font-mono text-[10px] text-text-3">
              {policyComparison ? (
                <>
                  <div className="text-text-2">matched complete runs · oldest − youngest</div>
                  <div>TTFT Δ {policyComparison.ttftDelta >= 0 ? '+' : ''}{policyComparison.ttftDelta.toFixed(2)}s</div>
                  <div>fairness Δ {policyComparison.fairnessDelta >= 0 ? '+' : ''}{policyComparison.fairnessDelta.toFixed(3)}</div>
                  <div className="mt-1">youngest {policyComparison.youngest.meanTtft.toFixed(2)}s / {policyComparison.youngest.fairness.toFixed(3)} · oldest {policyComparison.oldest.meanTtft.toFixed(2)}s / {policyComparison.oldest.fairness.toFixed(3)}</div>
                </>
              ) : (
                'Policy award: complete the full 120s run under both policies without changing seed, config, or workload.'
              )}
            </div>
            <Toggle
              on={cfg.honestSeed}
              onChange={(v) => {
                patch({ honestSeed: v })
                log('op', v ? 'HONEST SEED on — mode switches replay the identical arrival script' : 'honest seed off — mode switches re-roll arrivals')
              }}
              label="honest-seed A/B"
            />
            <div className="flex items-center justify-between rounded-sm border border-line bg-surface-2 px-2.5 py-1.5">
              <span className="font-mono text-[11px] text-text-3">seed</span>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-accent">0x{cfg.seed.toString(16).toUpperCase().padStart(6, '0')}</span>
                <button
                  onClick={() => reset(Math.floor(Math.random() * 0xffffff))}
                  aria-label="re-roll seed"
                  className="rounded-sm p-1 text-text-3 transition-colors duration-180 hover:text-text-1"
                >
                  <Dices size={13} />
                </button>
              </span>
            </div>
          </div>

          {/* ================= scene ================= */}
          <div className="flex flex-col gap-4">
            {/* arrival timeline */}
            <section className="rounded-md border border-line bg-surface-1 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-label uppercase tracking-[.1em] text-text-3">deterministic trace · 8 / 12 / 20 / 40</span>
                <div className="flex gap-1">
                  {(['static', 'continuous'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => runFixedTrace(mode)}
                      className={cn('rounded-sm border px-2 py-1 font-mono text-[10px]', traceMode === mode ? 'border-accent bg-accent-dim text-accent' : 'border-line bg-surface-2 text-text-2')}
                    >
                      run {mode}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                {[8, 12, 20, 40].map((length, i) => (
                  <div key={length} className="flex min-w-0 items-center gap-2">
                    <span className="w-5 font-mono text-[10px] text-text-3">{String.fromCharCode(65 + i)}</span>
                    <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-[2px] bg-surface-3">
                      <div className={cn('h-full', traceMode === 'static' ? 'bg-amber/70' : 'bg-accent/70')} style={{ width: `${(length / 40) * 100}%` }} />
                    </div>
                    <span className="w-14 text-right font-mono text-[10px] text-text-2">{length} steps</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 font-mono text-[10px] text-text-3">
                {traceResult
                  ? `${traceMode === 'static' ? 'Static' : 'Continuous'} observed: A–D completed at [${traceResult.adDoneTicks.join(', ')}] · A–D 40-step idle ${traceResult.adIdleSlotSteps}/160 (static expectation 80/160) · full trace idle ${traceResult.fullTraceIdleSlotSteps} slot-ticks · TTFT ${traceResult.meanTtft.toFixed(2)}s · full trace completed at tick ${traceResult.ticks}.`
                  : traceMode
                    ? `${traceMode === 'static' ? 'Static' : 'Continuous'} trace running through the scheduler…`
                    : 'Run either policy; A–D arrive at tick 0 and E/F/G arrive at ticks 8, 12, and 20.'}
              </p>
            </section>
            <section className="rounded-md border border-line bg-surface-1 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">
                  arrival queue ({snap.queue.length})
                </span>
                <span className="font-mono text-[10px] text-text-3">
                  λ={cfg.lambdaPerSec.toFixed(1)}/s · {cfg.preset}
                  {cfg.preset === 'burst' && snap.tick % 120 < 20 ? ' · BURST' : ''}
                </span>
              </div>
              <div className="flex min-h-8 flex-wrap items-center gap-1">
                {snap.queue.length === 0 && <span className="font-mono text-[11px] text-text-3">— empty —</span>}
                {snap.queue.slice(0, 24).map((r) => (
                  <motion.span
                    key={r.id}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 font-mono text-[10px]',
                      r.prompt >= 512 ? 'border-t4/60 bg-t4/10 text-t4' : 'border-t2/50 bg-t2/10 text-t2',
                    )}
                    title={`r${r.id}: prompt ${r.prompt}, out ≈${r.out}, arrived t=${r.arrival}`}
                  >
                    r{r.id} p{r.prompt >= 1024 ? `${(r.prompt / 1024).toFixed(1)}k` : r.prompt}
                  </motion.span>
                ))}
                {snap.queue.length > 24 && <span className="font-mono text-[10px] text-text-3">+{snap.queue.length - 24}</span>}
              </div>
            </section>

            {/* engine row */}
            <section className="rounded-md border border-line bg-surface-1 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">
                  GPU · batch {snap.batchNow}/{cfg.maxBatch}
                </span>
                <span className={cn('rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase', cfg.mode === 'continuous' ? 'border-accent/50 text-accent' : 'border-amber/50 text-amber')}>
                  {cfg.mode === 'continuous' ? 'continuous — admit every iteration' : 'static — locked until all finish'}
                </span>
              </div>
              <div className="flex min-h-24 flex-col gap-1.5">
                {snap.active.length === 0 && (
                  <div className="flex h-20 items-center justify-center rounded-sm border border-dashed border-line font-mono text-[11px] text-text-3">
                    GPU idle — {playing ? 'waiting for arrivals…' : 'press ▶'}
                  </div>
                )}
                <AnimatePresence mode="popLayout">
                  {snap.active.map((r) => {
                    const total = r.prompt + r.out
                    const prePct = (r.prefilled / total) * 100
                    const decLeft = (r.prompt / total) * 100
                    const decPct = (r.generated / total) * 100
                    const done = r.state === 'done'
                    return (
                      <motion.div
                        key={r.id}
                        layout="position"
                        initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, x: 80 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                        className={cn('flex items-center gap-2', done && 'opacity-50')}
                      >
                        <span className="w-8 shrink-0 font-mono text-[10px] text-text-3">r{r.id}</span>
                        <div className="relative h-5 flex-1 overflow-hidden rounded-[3px] border border-line bg-surface-3/50">
                          <div
                            className="absolute inset-y-0 left-0 bg-t4/70"
                            style={{ width: `${prePct}%`, transition: reduced ? undefined : 'width 200ms linear' }}
                            title={`prefill ${r.prefilled}/${r.prompt}`}
                          />
                          <div
                            className="absolute inset-y-0 bg-accent/80"
                            style={{
                              left: `${decLeft}%`,
                              width: `${decPct}%`,
                              transition: reduced ? undefined : 'width 200ms linear',
                            }}
                            title={`decode ${r.generated}/${r.out}`}
                          />
                        </div>
                        <span className="w-28 shrink-0 text-right font-mono text-[10px] text-text-3">
                          {done ? (
                            <span className="text-accent">done ✓</span>
                          ) : r.state === 'prefill' ? (
                            <span className="text-t4">prefill {r.prefilled}/{r.prompt}</span>
                          ) : (
                            `${r.generated}/${r.out} tok`
                          )}
                        </span>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
              {/* swapped / waiting lane */}
              {(snap.preempted.length > 0 || cfg.preempt) && (
                <div className="mt-2 border-t border-dashed border-amber/30 pt-2">
                  <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.10em] text-amber">
                    swapped / waiting ({snap.preempted.length}) ≡ swap space
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {snap.preempted.map((r) => (
                      <span key={r.id} className="rounded-sm border border-dashed border-amber/60 bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] text-amber">
                        r{r.id} {r.generated}/{r.out}
                      </span>
                    ))}
                    {snap.preempted.length === 0 && <span className="font-mono text-[10px] text-text-3">— empty —</span>}
                  </div>
                </div>
              )}
              {/* recently finished stamps */}
              {snap.doneRecent.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {snap.doneRecent.map((r) => (
                    <span key={r.id} className="rounded-sm border border-accent/40 bg-accent-dim/40 px-1.5 py-0.5 font-mono text-[10px] text-accent">
                      r{r.id} done · TTFT {r.firstTokenTick !== null ? ((r.firstTokenTick - r.arrival) / 10).toFixed(2) : '?'}s
                    </span>
                  ))}
                </div>
              )}
            </section>

            {/* utilization dashboard */}
            <section className="rounded-md border border-line bg-surface-1 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-text-3">
                <span className="font-mono text-label uppercase tracking-[0.10em] text-text-3">utilization dashboard</span>
                <span className="ml-auto" />
                <span><i className="mr-1 inline-block h-2 w-2 rounded-[1px] bg-accent" />gpu util %</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-[1px] bg-info" />batch size</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-[1px] bg-t5" />memory</span>
              </div>
              <canvas ref={chartRef} className="h-32 w-full rounded-sm border border-line bg-ink" />
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { label: 'throughput', value: `${snap.throughput.toFixed(0)} tok/s`, cls: 'text-accent' },
                  { label: 'mean TTFT', value: `${snap.meanTtft.toFixed(2)}s`, cls: 'text-amber' },
                  { label: 'mean ITL', value: `${snap.meanItl.toFixed(0)}ms`, cls: 'text-info' },
                  { label: 'finished', value: String(snap.doneCount), cls: 'text-text-1' },
                  { label: 'preempted', value: String(snap.preemptCount), cls: snap.preemptCount > 0 ? 'text-danger' : 'text-text-1' },
                ].map((s) => (
                  <div key={s.label} className="rounded-sm border border-line bg-surface-2 px-2 py-1.5">
                    <div className={cn('font-mono text-[14px] font-medium', s.cls)}>{s.value}</div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">{s.label}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <LogConsole lines={lines} onClear={clear} />
      </div>
      ) : machineMode === 'scheduler' ? (
        <SchedulerLab />
      ) : (
        <ContextSwitchLab />
      )}
    </PlaygroundShell>
  )
}
