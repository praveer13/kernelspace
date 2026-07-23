/**
 * SIM-08 mode · CPU Scheduler Lab (host sim-batching)
 *
 * A single-core scheduling sandbox: FIFO / round-robin / priority scheduling,
 * priority-inheritance, and admission control.  The timeline is drawn as a
 * Gantt-style canvas; metrics report short-job p99 latency and throughput.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import {
  ChipButton,
  ControlGroup,
  LogConsole,
  SliderRow,
  completeSimTask,
  usePlaygroundContext,
  useSimLog,
} from '@/components/sims/PlaygroundShell'

const SIM_ID = 'sim-batching'
const CTX_COST = 0.5
const ROW_H = 22
const LANE_H = 18
const TOP_MARGIN = 56
const LEFT_MARGIN = 72
const RIGHT_MARGIN = 16
const COLORS = ['#3EF2A4', '#22D3EE', '#A78BFA', '#FBBF24', '#FF5C6C', '#FB7185']

type Policy = 'fifo' | 'rr' | 'priority'
type Scenario = 'convoy' | 'inversion' | 'overload'

interface JobSpec {
  id: string
  arrival: number
  total: number
  priority: number
  color: string
  needsLock?: boolean
  holdsLockFor?: number
}

interface SimJob extends JobSpec {
  remaining: number
  lockHeld: number
  completed: boolean
  completionTime: number | null
  blocked: boolean
  admitted: boolean
  rejected: boolean
  effectivePriority: number
}

interface Segment {
  jobId: string
  start: number
  end: number
  kind: 'run' | 'ctx'
}

interface SimResult {
  segments: Segment[]
  jobs: SimJob[]
  makespan: number
  p99: number
  p99Short: number
  throughput: number
  ctxSwitches: number
  rejected: number
  avgQueue: number
  highLatency?: number
}

/* -------- deterministic job sets -------- */
function buildConvoyJobs(): JobSpec[] {
  const js: JobSpec[] = [
    { id: 'long', arrival: 0, total: 300, priority: 5, color: '#FBBF24' },
  ]
  for (let i = 0; i < 5; i++) {
    js.push({
      id: `short-${i}`,
      arrival: 1 + i,
      total: 5,
      priority: 5,
      color: '#3EF2A4',
    })
  }
  return js
}

function buildInversionJobs(): JobSpec[] {
  return [
    { id: 'low', arrival: 0, total: 25, priority: 3, color: '#FBBF24', holdsLockFor: 12 },
    { id: 'med-1', arrival: 4, total: 25, priority: 2, color: '#22D3EE' },
    { id: 'med-2', arrival: 8, total: 25, priority: 2, color: '#A78BFA' },
    { id: 'high', arrival: 6, total: 10, priority: 1, color: '#FF5C6C', needsLock: true },
  ]
}

function buildOverloadJobs(load: number): JobSpec[] {
  const duration = 240
  const service = 5
  const inter = service / load
  const count = Math.floor(duration / inter) + 1
  return Array.from({ length: count }, (_, i) => ({
    id: `j-${i}`,
    arrival: i * inter,
    total: service,
    priority: 5,
    color: COLORS[i % COLORS.length],
  }))
}

function buildJobs(scenario: Scenario, load: number): JobSpec[] {
  if (scenario === 'convoy') return buildConvoyJobs()
  if (scenario === 'inversion') return buildInversionJobs()
  return buildOverloadJobs(load)
}

/* -------- statistics -------- */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.max(0, Math.ceil(sorted.length * p) - 1)
  return sorted[idx]
}

/* -------- discrete-event scheduler -------- */
interface SimulateOpts {
  policy: Policy
  quantum: number
  priorityInheritance: boolean
  admissionControl: boolean
  capacity: number
  maxTime: number
  jobs: JobSpec[]
}

function simulate(opts: SimulateOpts): SimResult {
  const { policy, quantum, priorityInheritance, admissionControl, capacity, maxTime, jobs } = opts

  const all: SimJob[] = jobs.map((j) => ({
    ...j,
    remaining: j.total,
    lockHeld: 0,
    completed: false,
    completionTime: null,
    blocked: false,
    admitted: false,
    rejected: false,
    effectivePriority: j.priority,
  }))

  let t = 0
  let running: SimJob | null = null
  let quantumUsed = 0
  const ready: SimJob[] = []
  const blocked: SimJob[] = []
  let lockHolder: SimJob | null = null
  const segments: Segment[] = []
  let ctxSwitches = 0
  let rejectedCount = 0
  let queueTicks = 0

  const releaseLock = () => {
    if (!lockHolder) return
    lockHolder = null
    for (const j of blocked) {
      j.blocked = false
      ready.push(j)
    }
    blocked.length = 0
  }

  const recomputePriorities = () => {
    for (const j of all) j.effectivePriority = j.priority
    if (!priorityInheritance || !lockHolder) return
    const waiterPrios = blocked.filter((j) => j.needsLock).map((j) => j.priority)
    if (waiterPrios.length === 0) return
    const boost = Math.min(...waiterPrios)
    lockHolder.effectivePriority = Math.min(lockHolder.priority, boost)
  }

  const admit = () => {
    for (const j of all) {
      if (j.admitted || j.rejected || j.completed || j.arrival > t) continue
      const inSystem = ready.length + blocked.length + (running ? 1 : 0)
      if (admissionControl && inSystem >= capacity) {
        j.rejected = true
        rejectedCount += 1
      } else {
        j.admitted = true
        if (j.holdsLockFor) lockHolder = j
        if (j.needsLock && lockHolder && lockHolder !== j) {
          j.blocked = true
          blocked.push(j)
        } else {
          ready.push(j)
        }
      }
    }
  }

  const pickBest = (): SimJob | null => {
    if (running && policy === 'rr' && (quantumUsed < quantum - 1e-9 || ready.length === 0)) {
      return running
    }
    if (ready.length === 0) return running
    if (policy === 'rr' || policy === 'fifo') return running ?? ready[0]
    const candidates = running ? [...ready, running] : ready.slice()
    candidates.sort(
      (a, b) =>
        a.effectivePriority - b.effectivePriority || a.arrival - b.arrival || a.id.localeCompare(b.id),
    )
    return candidates[0]
  }

  while (t < maxTime) {
    admit()
    recomputePriorities()

    const best = pickBest()
    if (!best && !running) {
      const nextArr = all
        .filter((j) => !j.admitted && !j.rejected && !j.completed)
        .map((j) => j.arrival)
        .sort((a, b) => a - b)[0]
      if (nextArr === undefined) break
      if (nextArr > t) {
        segments.push({ jobId: 'idle', start: t, end: Math.min(nextArr, maxTime), kind: 'run' })
      }
      t = Math.min(nextArr, maxTime)
      continue
    }

    if (best && running && best.id !== running.id) {
      if (running.remaining > 1e-9) ready.push(running)
      running = null
    }

    if (!running && best) {
      segments.push({ jobId: 'ctx', start: t, end: t + CTX_COST, kind: 'ctx' })
      t += CTX_COST
      ctxSwitches += 1
      running = best
      const idx = ready.indexOf(best)
      if (idx >= 0) ready.splice(idx, 1)
      quantumUsed = 0
    }

    if (!running) break
    const current = running

    let duration = running.remaining
    if (policy === 'rr' && quantumUsed < quantum) {
      duration = Math.min(quantum - quantumUsed, running.remaining)
    }

    if (policy === 'priority') {
      const nextPreempt = all
        .filter(
          (j) =>
            !j.admitted && !j.rejected && !j.completed && j.arrival > t && j.priority < current.effectivePriority,
        )
        .map((j) => j.arrival)
        .sort((a, b) => a - b)[0]
      if (nextPreempt !== undefined) duration = Math.min(duration, nextPreempt - t)
    }

    if (running.holdsLockFor && running.lockHeld < running.holdsLockFor) {
      duration = Math.min(duration, running.holdsLockFor - running.lockHeld)
    }

    duration = Math.max(0, Math.min(duration, maxTime - t))
    if (duration <= 1e-9) break

    segments.push({ jobId: running.id, start: t, end: t + duration, kind: 'run' })
    queueTicks += ready.length * duration
    running.remaining -= duration
    running.lockHeld += duration
    quantumUsed += duration
    t += duration

    if (running.holdsLockFor && running.lockHeld >= running.holdsLockFor - 1e-9) {
      releaseLock()
    }

    if (running.remaining <= 1e-9) {
      running.completed = true
      running.completionTime = t
      if (running.holdsLockFor) releaseLock()
      running = null
    } else if (policy === 'rr' && quantumUsed >= quantum - 1e-9) {
      ready.push(running)
      running = null
    }
  }

  const completed = all.filter((j) => j.completed && j.completionTime !== null && j.completionTime > 0)
  const latencies = completed.map((j) => j.completionTime! - j.arrival)
  const short = completed.filter((j) => j.total <= 10).map((j) => j.completionTime! - j.arrival)
  const high = all.find((j) => j.id === 'high')

  return {
    segments,
    jobs: all,
    makespan: t,
    p99: percentile(latencies, 0.99),
    p99Short: percentile(short, 0.99),
    throughput: t > 0 ? completed.length / t : 0,
    ctxSwitches,
    rejected: rejectedCount,
    avgQueue: t > 0 ? queueTicks / t : 0,
    highLatency: high && high.completionTime ? high.completionTime - high.arrival : undefined,
  }
}

export default function SchedulerLab() {
  const { embed } = usePlaygroundContext()
  const { lines, log, clear } = useSimLog()
  const tickRef = useRef(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(720)

  const [policy, setPolicy] = useState<Policy>('fifo')
  const [scenario, setScenario] = useState<Scenario>('convoy')
  const [quantum, setQuantum] = useState(1)
  const [priorityInheritance, setPriorityInheritance] = useState(false)
  const [admissionControl, setAdmissionControl] = useState(false)
  const [load, setLoad] = useState(1.0)
  const [results, setResults] = useState<SimResult | null>(null)

  const maxTime = useMemo(() => (scenario === 'overload' ? 250 : 350), [scenario])

  /* ---- run / reset ---- */
  const reset = useCallback(() => {
    setResults(null)
    clear()
  }, [clear])

  const run = useCallback(() => {
    tickRef.current += 1
    const t = tickRef.current
    const jobs = buildJobs(scenario, load)
    const res = simulate({
      policy,
      quantum,
      priorityInheritance,
      admissionControl,
      capacity: 6,
      maxTime,
      jobs,
    })
    setResults(res)

    const modeTag = policy === 'rr' ? `RR q=${quantum}` : policy === 'priority' ? 'PRI' : 'FIFO'
    log(t, 'SCHED', `${modeTag} · ${scenario} · makespan ${res.makespan.toFixed(1)} ticks`, 'op')
    if (res.rejected > 0) log(t, 'ADMIT', `${res.rejected} jobs rejected by admission controller`, 'warn')

    /* task detection */
    if (scenario === 'convoy' && policy === 'fifo' && res.p99Short > 80) {
      completeSimTask(SIM_ID, 't-sched-fifo', 60)
    }
    if (scenario === 'convoy' && policy === 'rr' && quantum <= 1 && res.p99Short < 80) {
      completeSimTask(SIM_ID, 't-sched-rr', 60)
    }
    if (scenario === 'inversion' && policy === 'priority' && !priorityInheritance && (res.highLatency ?? 0) > 40) {
      completeSimTask(SIM_ID, 't-sched-inversion', 60)
    }
    if (scenario === 'inversion' && policy === 'priority' && priorityInheritance && (res.highLatency ?? 0) < 25) {
      completeSimTask(SIM_ID, 't-sched-pi', 60)
    }
    if (
      scenario === 'overload' &&
      !admissionControl &&
      load >= 1.8 &&
      res.rejected === 0 &&
      res.avgQueue > 10
    ) {
      completeSimTask(SIM_ID, 't-sched-admit', 60)
    }
  }, [policy, scenario, quantum, priorityInheritance, admissionControl, load, maxTime, log])

  /* ---- canvas sizing ---- */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /* ---- canvas paint ---- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const jobOrder = Array.from(new Set(results?.jobs.filter((j) => j.admitted).map((j) => j.id) ?? []))
    const h = TOP_MARGIN + jobOrder.length * ROW_H + 24
    canvas.width = Math.max(width, 280) * dpr
    canvas.height = h * dpr
    canvas.style.width = `${Math.max(width, 280)}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, Math.max(width, 280), h)

    const w = Math.max(width, 280) - LEFT_MARGIN - RIGHT_MARGIN
    const endT = Math.max(results?.makespan ?? 100, 100)
    const tx = (time: number) => LEFT_MARGIN + (time / endT) * w

    /* axes / grid */
    ctx.strokeStyle = 'rgba(38,48,64,0.8)'
    ctx.lineWidth = 1
    ctx.fillStyle = '#5D6B80'
    ctx.font = '10px ui-monospace, monospace'
    ctx.beginPath()
    ctx.moveTo(LEFT_MARGIN, TOP_MARGIN - 8)
    ctx.lineTo(LEFT_MARGIN + w, TOP_MARGIN - 8)
    ctx.stroke()
    for (let i = 0; i <= 10; i++) {
      const x = LEFT_MARGIN + (w * i) / 10
      const time = (endT * i) / 10
      ctx.beginPath()
      ctx.moveTo(x, TOP_MARGIN - 12)
      ctx.lineTo(x, TOP_MARGIN - 4)
      ctx.stroke()
      ctx.fillText(String(Math.round(time)), x - 8, TOP_MARGIN - 16)
    }

    /* CPU lane */
    ctx.fillStyle = '#1B2430'
    ctx.fillRect(LEFT_MARGIN, TOP_MARGIN, w, LANE_H)
    ctx.fillStyle = '#5D6B80'
    ctx.fillText('CPU', 8, TOP_MARGIN + LANE_H / 2 + 3)

    if (results) {
      for (const seg of results.segments) {
        const x0 = tx(seg.start)
        const x1 = tx(seg.end)
        if (seg.kind === 'ctx') {
          ctx.fillStyle = '#5D6B80'
          ctx.fillRect(x0, TOP_MARGIN, Math.max(x1 - x0, 1), LANE_H)
        } else if (seg.jobId === 'idle') {
          ctx.fillStyle = 'rgba(93,107,128,0.25)'
          ctx.fillRect(x0, TOP_MARGIN, Math.max(x1 - x0, 1), LANE_H)
        } else {
          const job = results.jobs.find((j) => j.id === seg.jobId)
          ctx.fillStyle = job?.color ?? '#3EF2A4'
          ctx.fillRect(x0, TOP_MARGIN, Math.max(x1 - x0, 1), LANE_H)
        }
      }

      /* per-job rows */
      jobOrder.forEach((id, i) => {
        const job = results.jobs.find((j) => j.id === id)
        if (!job) return
        const y = TOP_MARGIN + 32 + i * ROW_H
        ctx.fillStyle = '#5D6B80'
        ctx.fillText(id.length > 8 ? `${id.slice(0, 7)}…` : id, 8, y + ROW_H / 2 + 3)
        const arrivalX = tx(job.arrival)
        ctx.strokeStyle = 'rgba(93,107,128,0.35)'
        ctx.setLineDash([2, 2])
        ctx.beginPath()
        ctx.moveTo(arrivalX, y)
        ctx.lineTo(arrivalX, y + ROW_H - 2)
        ctx.stroke()
        ctx.setLineDash([])

        for (const seg of results.segments) {
          if (seg.jobId !== id || seg.kind !== 'run') continue
          const x0 = tx(seg.start)
          const x1 = tx(seg.end)
          ctx.fillStyle = job.color
          ctx.fillRect(x0, y + 2, Math.max(x1 - x0, 2), ROW_H - 6)
        }
      })
    }

    /* labels */
    ctx.fillStyle = '#5D6B80'
    ctx.fillText('arrival', 8, TOP_MARGIN + 18)
  }, [results, width, maxTime])

  const metricCard = (label: string, value: string, color?: string) => (
    <div
      className="rounded-sm border border-line bg-surface-1 px-3 py-2"
      style={color ? { borderColor: `${color}55` } : undefined}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">{label}</p>
      <p className="font-display text-[18px] font-semibold" style={{ color: color ?? '#E6EDF7' }}>
        {value}
      </p>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------- stage ------- */}
        <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              {policy === 'fifo' ? 'FIFO' : policy === 'rr' ? `RR q=${quantum}` : 'priority'}
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">{scenario}</span>
            {scenario === 'overload' && (
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                load {load.toFixed(1)}×
              </span>
            )}
            {priorityInheritance && (
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">priority inheritance</span>
            )}
            {admissionControl && (
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">admission ON</span>
            )}
          </div>

          {results ? (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {metricCard('short-job p99', `${results.p99Short.toFixed(1)} ticks`, results.p99Short > 50 ? '#FBBF24' : '#3EF2A4')}
              {metricCard('throughput', `${results.throughput.toFixed(3)} jobs/tick`)}
              {metricCard('context switches', String(results.ctxSwitches))}
              {metricCard('avg runqueue', results.avgQueue.toFixed(1))}
              {results.rejected > 0 && metricCard('rejected', String(results.rejected), '#FF5C6C')}
              {results.highLatency !== undefined &&
                metricCard('high latency', `${results.highLatency.toFixed(1)} ticks`, results.highLatency > 40 ? '#FBBF24' : '#3EF2A4')}
            </div>
          ) : (
            <div className="mb-3 rounded-sm border border-line bg-surface-1 px-3 py-2 font-mono text-[10px] text-text-3">
              Press ▶ run to generate the schedule and metrics.
            </div>
          )}

          <div ref={wrapRef} className="w-full">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label="CPU scheduling Gantt chart.  Press run to generate."
            />
          </div>

          {!embed && (
            <p className="mt-3 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
              The top lane is the CPU; gray slivers are context switches.  Each row is one job; the
              dashed line marks its arrival.  Watch FIFO trap short jobs behind the long one, RR
              chop the timeline, priority inversion stall the high-priority job, and admission
              control refuse excess load.
            </p>
          )}
        </div>

        {/* ------- control panel ------- */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[300px] lg:border-l lg:border-t-0">
          <ControlGroup label="policy">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={policy === 'fifo'} onClick={() => setPolicy('fifo')}>
                FIFO
              </ChipButton>
              <ChipButton active={policy === 'rr'} onClick={() => setPolicy('rr')}>
                round-robin
              </ChipButton>
              <ChipButton active={policy === 'priority'} onClick={() => setPolicy('priority')}>
                priority
              </ChipButton>
            </div>
            {policy === 'rr' && (
              <SliderRow
                label="quantum"
                value={quantum}
                display={`${quantum} tick${quantum === 1 ? '' : 's'}`}
                min={1}
                max={10}
                step={1}
                onChange={setQuantum}
              />
            )}
          </ControlGroup>

          <ControlGroup label="scenario / jobs">
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={scenario === 'convoy'} onClick={() => setScenario('convoy')}>
                convoy (60× long)
              </ChipButton>
              <ChipButton active={scenario === 'inversion'} onClick={() => setScenario('inversion')}>
                priority inversion
              </ChipButton>
              <ChipButton active={scenario === 'overload'} onClick={() => setScenario('overload')}>
                overload stream
              </ChipButton>
            </div>
          </ControlGroup>

          {scenario === 'inversion' && (
            <ControlGroup label="priority options">
              <div className="flex flex-wrap gap-1.5">
                <ChipButton active={priorityInheritance} onClick={() => setPriorityInheritance((v) => !v)}>
                  priority inheritance {priorityInheritance ? 'on' : 'off'}
                </ChipButton>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                With inheritance the low-priority lock holder borrows the high-priority waiter&apos;s
                urgency; without it, medium-priority jobs preempt the holder and starve the high
                job.
              </p>
            </ControlGroup>
          )}

          {scenario === 'overload' && (
            <ControlGroup label="admission control">
              <div className="flex flex-wrap gap-1.5">
                <ChipButton active={admissionControl} onClick={() => setAdmissionControl((v) => !v)}>
                  admission {admissionControl ? 'on' : 'off'}
                </ChipButton>
              </div>
              <SliderRow
                label="offered load"
                value={load}
                display={`${load.toFixed(1)}×`}
                min={0.5}
                max={2.0}
                step={0.1}
                onChange={setLoad}
              />
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                At 2× offered load the arrival rate exceeds the core&apos;s service rate.  With
                admission off the runqueue grows without bound; with it on, excess jobs are refused
                and tail latency stays capped.
              </p>
            </ControlGroup>
          )}

          <ControlGroup label="run" className="border-b-0">
            <button
              type="button"
              onClick={run}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
            >
              <Play size={15} strokeWidth={2} /> run the scheduler
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-sm border border-line bg-surface-2 font-mono text-[11px] text-text-2 transition-all hover:text-text-1 active:scale-95"
            >
              <RotateCcw size={13} strokeWidth={1.75} /> reset
            </button>
          </ControlGroup>
        </aside>
      </div>

      {!embed && <LogConsole lines={lines} onClear={clear} />}
    </div>
  )
}
