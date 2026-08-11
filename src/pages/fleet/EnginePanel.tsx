import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Pause, Play, RotateCcw, StepForward, Upload } from 'lucide-react'
import { instantiateLab, LabAbiError, LabTrapError } from '@/lib/wasm-lab'
import {
  Engine,
  loadTraceStream,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  makeRequestStream,
  makeServingMetrics,
  type ManagerDump,
} from '@/lib/fleet-model'
import {
  FLEET_TRAFFIC_PROFILES,
  getFleetTrafficProfile,
  parseTraceArtifact,
  traceToRequestStream,
  type TraceArtifact,
  type FleetTrafficId,
} from '@/lib/traces'
import { cn } from '@/lib/utils'
import { makeWasmManager, makeWasmQueue, makeWasmScheduler } from '@/pages/fleet/drivers'
import MetricsDashboard from '@/pages/fleet/MetricsDashboard'
import type { SlotState } from '@/pages/fleet/slots'

const REQ_COUNT = 240
const SPAN = 900

interface PanelError {
  title: string
  detail: string
}

type TrafficChoice = FleetTrafficId | 'local'

interface LocalTrace {
  fileName: string
  artifact: TraceArtifact
}

export default function EnginePanel({ slots }: { slots: SlotState }) {
  const [traffic, setTraffic] = useState<TrafficChoice>('synthetic')
  const [localTrace, setLocalTrace] = useState<LocalTrace | null>(null)
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<PanelError | null>(null)
  const [dump, setDump] = useState<ManagerDump | null>(null)
  const [mine, setMine] = useState({
    met: 0,
    done: 0,
    p95: 0,
    tpotP95: 0,
    queueP95: 0,
    inputTokens: 0,
    outputTokens: 0,
    autoPreempts: 0,
    capMisses: 0,
    shed: 0,
    waiting: 0,
    running: 0,
  })
  const [ref, setRef] = useState({ met: 0, done: 0, p95: 0 })
  const [violations, setViolations] = useState<string[]>([])
  const [divergence, setDivergence] = useState<string | null>(null)
  const [isDone, setIsDone] = useState(false)
  const mineRef = useRef<Engine | null>(null)
  const refRef = useRef<Engine | null>(null)
  const totalRef = useRef(REQ_COUNT)
  const buildTokenRef = useRef(0)
  const localTraceInputRef = useRef<HTMLInputElement>(null)

  const buildEngines = useCallback(async (s: SlotState, which: TrafficChoice, local: LocalTrace | null) => {
    const profile = getFleetTrafficProfile(which === 'local' ? 'lmsys-shape' : which)
    const { config: cfg, intakeCap, drainPerTick: drain } = profile
    const stream =
      which === 'local'
        ? local
          ? traceToRequestStream(local.artifact)
          : (() => {
              throw new Error('choose a local trace artifact first')
            })()
        : profile.artifactUrl
          ? await loadTraceStream(profile.artifactUrl)
          : makeRequestStream(REQ_COUNT, SPAN, 0x5eed)
    const referenceStream = stream.map((request) => ({
      ...request,
      ...(request.tokens ? { tokens: [...request.tokens] } : {}),
    }))
    const total = stream.length
    const schedMine = s.sched ? makeWasmScheduler(await instantiateLab(s.sched.bytes)) : makeRefScheduler()
    const mgrMine = s.mgr ? makeWasmManager(await instantiateLab(s.mgr.bytes), cfg.numBlocks, cfg.blockSize) : makeRefManager(cfg.numBlocks, cfg.blockSize)
    const queueMine = s.queue ? makeWasmQueue(await instantiateLab(s.queue.bytes), intakeCap) : makeRefQueue(intakeCap)
    const shadow = s.queue ? makeRefQueue(intakeCap) : undefined
    const mine = new Engine(cfg, stream, schedMine, mgrMine, {
      intake: queueMine,
      intakeShadow: shadow,
      drainPerTick: drain,
    })
    const reference = new Engine(
      cfg,
      referenceStream,
      makeRefScheduler(),
      makeRefManager(cfg.numBlocks, cfg.blockSize),
      { intake: makeRefQueue(intakeCap), drainPerTick: drain },
    )
    return { mine, reference, total }
  }, [])

  const reset = useCallback(() => {
    setPlaying(false)
    setTick(0)
    setViolations([])
    setDivergence(null)
    setIsDone(false)
    setError(null)
    mineRef.current = null
    refRef.current = null
    const token = ++buildTokenRef.current
    void buildEngines(slots, traffic, localTrace)
      .then(({ mine, reference, total }) => {
        if (buildTokenRef.current !== token) return
        mineRef.current = mine
        refRef.current = reference
        totalRef.current = total
      })
      .catch((cause: unknown) => {
        if (buildTokenRef.current !== token) return
        setError({ title: 'trace failed to load', detail: cause instanceof Error ? cause.message : String(cause) })
      })
    setMine({
      met: 0,
      done: 0,
      p95: 0,
      tpotP95: 0,
      queueP95: 0,
      inputTokens: 0,
      outputTokens: 0,
      autoPreempts: 0,
      capMisses: 0,
      shed: 0,
      waiting: 0,
      running: 0,
    })
    setRef({ met: 0, done: 0, p95: 0 })
    setDump(null)
  }, [slots, traffic, localTrace, buildEngines])

  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, traffic])

  const step = useCallback(() => {
    const me = mineRef.current
    const re = refRef.current
    if (!me || !re) return
    if (me.done && re.done) {
      setPlaying(false)
      return
    }
    try {
      if (!me.done) me.step()
      if (!re.done) re.step()
    } catch (e) {
      setPlaying(false)
      if (e instanceof LabTrapError) {
        setError({ title: 'module trapped mid-run', detail: 'a todo!() or panic fired while the engine was driving your code.' })
      } else if (e instanceof LabAbiError) {
        setError({ title: 'ABI problem', detail: e.message })
      } else {
        setError({ title: 'engine error', detail: String(e) })
      }
      return
    }
    const s = me.stats()
    const rs = re.stats()
    setMine({
      met: s.sloMet,
      done: s.completed,
      p95: me.ttftP95(),
      tpotP95: me.tpotP95(),
      queueP95: me.queueP95(),
      inputTokens: s.completedInputTokens,
      outputTokens: s.completedOutputTokens,
      autoPreempts: s.autoPreempts,
      capMisses: s.capacityMisses,
      shed: s.shed,
      waiting: s.waitingNow,
      running: s.runningNow,
    })
    setRef({ met: rs.sloMet, done: rs.completed, p95: re.ttftP95() })
    if (me.violations.length > 0) setViolations(me.violations.slice(0, 3))
    if (me.divergence.length > 0) setDivergence(me.divergence[0])
    setDump(me.mgrDump())
    setTick(me.tick)
    if (me.done && re.done) setIsDone(true)
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(step, 60)
    return () => window.clearInterval(id)
  }, [playing, step])

  const finished = isDone
  const total = totalRef.current
  const myGoodput = mine.done ? Math.round((mine.met / total) * 1000) / 10 : 0
  const refGoodput = ref.done ? Math.round((ref.met / total) * 1000) / 10 : 0
  const observability = makeServingMetrics({
    totalRequests: total,
    sloMet: mine.met,
    ttftP95Ticks: mine.p95,
    tpotP95Ticks: mine.tpotP95,
    queueP95Ticks: mine.queueP95,
    kvHitRate: 0,
    completedInputTokens: mine.inputTokens,
    completedOutputTokens: mine.outputTokens,
    elapsedTicks: tick,
    workers: 1,
  })

  const gridCells = (() => {
    if (!dump) return []
    const owner = new Map<number, number>()
    for (const [id, s] of dump.seqs) for (const b of s.blocks) if (!owner.has(b)) owner.set(b, id)
    return Array.from({ length: dump.numBlocks }, (_, b) => ({ b, refs: dump.refs.get(b) ?? 0, owner: owner.get(b) }))
  })()

  const HUES = [162, 200, 265, 20, 330, 90, 45, 285, 150, 0]
  const trafficProfile = getFleetTrafficProfile(traffic === 'local' ? 'lmsys-shape' : traffic)
  const trafficDescription =
    traffic === 'local' && localTrace
      ? `${localTrace.fileName} · ${localTrace.artifact.requestCount} validated rows · stays in this tab`
      : trafficProfile.description

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-3">
        <span className={cn(slots.sched ? 'text-accent' : '')}>scheduler: {slots.sched ? 'yours ✓' : 'reference'}</span>
        <span>·</span>
        <span className={cn(slots.mgr ? 'text-accent' : '')}>manager: {slots.mgr ? 'yours ✓' : 'reference'}</span>
        <span>·</span>
        <span className={cn(slots.queue ? 'text-accent' : '')}>intake queue: {slots.queue ? 'yours ✓' : 'reference'}</span>
        <span>·</span>
        <span>traffic:</span>
        {FLEET_TRAFFIC_PROFILES.map((profile) => (
          <button
            key={profile.id}
            onClick={() => setTraffic(profile.id)}
            className={cn(
              'rounded border px-2 py-0.5 transition-colors',
              traffic === profile.id ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line hover:text-text-1',
            )}
          >
            {profile.shortLabel}
          </button>
        ))}
        <button
          type="button"
          onClick={() => localTraceInputRef.current?.click()}
          className={cn(
            'inline-flex items-center gap-1 rounded border px-2 py-0.5 transition-colors',
            traffic === 'local' ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line hover:text-text-1',
          )}
          title="Load a schema-v1 trace JSON; the file remains in this browser tab"
        >
          <Upload className="h-3 w-3" /> {localTrace ? 'replace local' : 'local trace'}
        </button>
        <input
          ref={localTraceInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              void file
                .text()
                .then((text) => JSON.parse(text) as unknown)
                .then(parseTraceArtifact)
                .then((artifact) => {
                  setLocalTrace({ fileName: file.name, artifact })
                  setTraffic('local')
                })
                .catch((cause: unknown) => {
                  setError({
                    title: 'local trace rejected',
                    detail: cause instanceof Error ? cause.message : String(cause),
                  })
                })
            }
            event.target.value = ''
          }}
        />
        <span className="ml-auto" />
        <button onClick={() => setPlaying((p) => !p)} className="rounded-md border border-line bg-surface-1 p-2 text-text-2 hover:text-text-1" aria-label={playing ? 'pause' : 'play'}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button onClick={step} disabled={playing} className="rounded-md border border-line bg-surface-1 p-2 text-text-2 hover:text-text-1 disabled:opacity-40" aria-label="step one tick">
          <StepForward className="h-4 w-4" />
        </button>
        <button onClick={reset} className="rounded-md border border-line bg-surface-1 p-2 text-text-2 hover:text-text-1" aria-label="reset">
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-text-3">
        {trafficDescription} · {trafficProfile.config.maxRunning} slots ·{' '}
        {trafficProfile.config.numBlocks * trafficProfile.config.blockSize} token capacity · TTFT SLO{' '}
        {trafficProfile.config.sloTtft} ticks
      </p>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div>
              <p className="font-mono text-sm text-danger">{error.title}</p>
              <p className="mt-1 text-body-sm text-text-2">{error.detail}</p>
            </div>
          </motion.div>
        )}
        {violations.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div>
              <p className="font-mono text-sm text-danger">scheduler legality violation</p>
              {violations.map((v) => (
                <p key={v} className="mt-0.5 font-mono text-[11px] text-text-2">{v}</p>
              ))}
            </div>
          </motion.div>
        )}
        {divergence && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-lg border border-amber/40 bg-amber/5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
            <div>
              <p className="font-mono text-sm text-amber">intake queue divergence</p>
              <p className="mt-0.5 font-mono text-[11px] text-text-2">{divergence}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <MetricsDashboard metrics={observability} scope={`engine · ${traffic} traffic`} />

      <div className="grid gap-4 sm:grid-cols-2">
        <ScoreCard
          title={slots.sched || slots.mgr || slots.queue ? 'your engine' : 'your engine (all-reference — upload to change)'}
          goodput={myGoodput}
          rows={[
            ['SLO-met', `${mine.met}/${total}`],
            ['completed', `${mine.done}`],
            ['ttft p95', `${mine.p95} iters`],
            ['tpot p95', `${mine.tpotP95.toFixed(1)} iters`],
            ['queue p95', `${mine.queueP95} iters`],
            ['shed at intake', `${mine.shed}`],
            ['auto-preempts', `${mine.autoPreempts}`],
            ['capacity misses', `${mine.capMisses}`],
            ['waiting / running', `${mine.waiting} / ${mine.running}`],
          ]}
          highlight={finished && myGoodput >= refGoodput}
        />
        <ScoreCard
          title="reference engine"
          goodput={refGoodput}
          rows={[
            ['SLO-met', `${ref.met}/${total}`],
            ['completed', `${ref.done}`],
            ['ttft p95', `${ref.p95} iters`],
          ]}
          highlight={false}
        />
      </div>

      <div className="rounded-lg border border-line bg-surface-1 p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">
            HBM pool — {trafficProfile.config.numBlocks} KV blocks ·{' '}
            {slots.mgr ? 'your manager' : 'reference manager'}
          </p>
          <p className="font-mono text-[11px] text-text-3">tick {tick}</p>
        </div>
        <div className="mt-4 grid gap-[3px]" style={{ gridTemplateColumns: 'repeat(32, minmax(0, 1fr))' }}>
          {gridCells.map(({ b, refs, owner }) => (
            <div
              key={b}
              title={refs === 0 ? `block ${b}: free` : `block ${b}: ${refs} ref${refs > 1 ? 's' : ''}`}
              className={cn(
                'aspect-square rounded-[2px] border transition-colors duration-150',
                refs === 0 ? 'border-line bg-ink' : refs > 1 ? 'border-accent' : 'border-transparent',
              )}
              style={refs > 0 ? { backgroundColor: `hsl(${HUES[(owner ?? 0) % HUES.length]} 70% 45%)` } : undefined}
            />
          ))}
        </div>
      </div>

      {finished && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('rounded-lg border p-4', myGoodput >= refGoodput ? 'border-accent/50 bg-accent/10' : 'border-amber/50 bg-amber/5')}>
          <p className={cn('font-mono text-sm', myGoodput >= refGoodput ? 'text-accent' : 'text-amber')}>
            {myGoodput >= refGoodput
              ? `run complete — your engine matches or beats the reference (${myGoodput}% vs ${refGoodput}%).`
              : `run complete — your engine: ${myGoodput}% vs reference ${refGoodput}%. The gap is the lesson.`}
          </p>
          <p className="mt-1 text-body-sm text-text-2">
            same traffic, same engine rules — the only difference is the policy, block manager, and queue you uploaded.
          </p>
        </motion.div>
      )}
    </div>
  )
}

function ScoreCard({ title, goodput, rows, highlight }: { title: string; goodput: number; rows: [string, string][]; highlight: boolean }) {
  return (
    <div className={cn('rounded-lg border p-5', highlight ? 'border-accent/60 bg-accent/5' : 'border-line bg-surface-1')}>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">{title}</p>
        <p className={cn('font-mono text-2xl font-semibold', highlight ? 'text-accent' : 'text-text-1')}>
          {goodput}<span className="text-sm text-text-3">% goodput</span>
        </p>
      </div>
      <div className="mt-3 space-y-1 font-mono text-[12px] text-text-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-text-3">{k}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
