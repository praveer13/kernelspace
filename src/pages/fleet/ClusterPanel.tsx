import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Pause, Play, RotateCcw, StepForward } from 'lucide-react'
import { instantiateLab, LabAbiError, LabTrapError } from '@/lib/wasm-lab'
import {
  Cluster,
  Engine,
  makeRefManager,
  makeRefQueue,
  makeRefScheduler,
  makePrefixSharedRequestStream,
  makeServingMetrics,
  routerLabel,
  type ClusterStats,
  type ManagerDump,
  type RouterKind,
} from '@/lib/fleet-model'
import { cn } from '@/lib/utils'
import EpdPanel from '@/pages/fleet/EpdPanel'
import { makeWasmManager, makeWasmQueue, makeWasmScheduler } from '@/pages/fleet/drivers'
import MetricsDashboard from '@/pages/fleet/MetricsDashboard'
import type { SlotState } from '@/pages/fleet/slots'

const WORKER_CFG = { numBlocks: 128, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128 }
const INTAKE_CAP = 32
const DRAIN_PER_TICK = 6
const REQ_COUNT = 240
const SPAN = 900

const HUES = [162, 200, 265, 20, 330, 90, 45, 285, 150, 0]

const emptyAggregate = (): ClusterStats => ({
  completed: 0,
  sloMet: 0,
  shed: 0,
  autoPreempts: 0,
  capMisses: 0,
  cacheHitTokens: 0,
  promptTokens: 0,
  kvHitRate: 0,
  ttftSloMet: 0,
  ttftSloPct: 0,
  ttftP95: 0,
  tpotP95: 0,
  queueP95: 0,
  completedInputTokens: 0,
  completedOutputTokens: 0,
})

export default function ClusterPanel({ slots }: { slots: SlotState }) {
  const [topology, setTopology] = useState<'colocated' | 'epd'>('colocated')
  const [workerCount, setWorkerCount] = useState(2)
  const [router, setRouter] = useState<RouterKind>('jsq')
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agg, setAgg] = useState<ClusterStats>(emptyAggregate)
  const [workerRows, setWorkerRows] = useState<
    { waiting: number; running: number; util: number; cacheEntries: number; dump: ManagerDump }[]
  >([])
  const clusterRef = useRef<Cluster | null>(null)

  const build = useCallback(async () => {
    const workers: Engine[] = []
    for (let i = 0; i < workerCount; i++) {
      const sched = slots.sched ? makeWasmScheduler(await instantiateLab(slots.sched.bytes)) : makeRefScheduler()
      const mgr = slots.mgr
        ? makeWasmManager(await instantiateLab(slots.mgr.bytes), WORKER_CFG.numBlocks, WORKER_CFG.blockSize)
        : makeRefManager(WORKER_CFG.numBlocks, WORKER_CFG.blockSize)
      const queue = slots.queue
        ? makeWasmQueue(await instantiateLab(slots.queue.bytes), INTAKE_CAP)
        : makeRefQueue(INTAKE_CAP)
      workers.push(
        new Engine(WORKER_CFG, [], sched, mgr, { intake: queue, drainPerTick: DRAIN_PER_TICK }),
      )
    }
    clusterRef.current = new Cluster(
      makePrefixSharedRequestStream(REQ_COUNT, SPAN, 0x5eed),
      workers,
      router,
    )
  }, [workerCount, router, slots])

  const reset = useCallback(() => {
    setPlaying(false)
    setTick(0)
    setError(null)
    setAgg(emptyAggregate())
    setWorkerRows([])
    void build()
  }, [build])

  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build])

  const snapshot = useCallback(() => {
    const c = clusterRef.current
    if (!c) return
    setAgg(c.aggregate())
    setWorkerRows(
      c.workers.map((w, index) => {
        const s = w.stats()
        const dump = w.mgrDump()
        return {
          waiting: s.waitingNow,
          running: s.runningNow,
          util: Math.round(((dump.numBlocks - dump.free) / dump.numBlocks) * 100),
          cacheEntries: c.cacheEntries(index),
          dump,
        }
      }),
    )
    setTick(c.tick)
  }, [])

  const step = useCallback(() => {
    const c = clusterRef.current
    if (!c) return
    if (c.done) {
      setPlaying(false)
      return
    }
    try {
      c.step()
    } catch (e) {
      setPlaying(false)
      if (e instanceof LabTrapError) setError('a module trapped mid-run — a todo!() or panic fired.')
      else if (e instanceof LabAbiError) setError(e.message)
      else setError(String(e))
      return
    }
    snapshot()
  }, [snapshot])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(step, 60)
    return () => window.clearInterval(id)
  }, [playing, step])

  const goodput = Math.round((agg.sloMet / REQ_COUNT) * 1000) / 10
  const done = clusterRef.current?.done ?? false
  const observability = makeServingMetrics({
    totalRequests: REQ_COUNT,
    sloMet: agg.sloMet,
    ttftP95Ticks: agg.ttftP95,
    tpotP95Ticks: agg.tpotP95,
    queueP95Ticks: agg.queueP95,
    kvHitRate: agg.kvHitRate,
    completedInputTokens: agg.completedInputTokens,
    completedOutputTokens: agg.completedOutputTokens,
    elapsedTicks: tick,
    workers: workerCount,
  })

  return (
    <div className="space-y-4">
      {/* topology toggle */}
      <div className="flex items-center gap-2 font-mono text-[11px]">
        <span className="text-text-3">topology</span>
        {(['colocated', 'epd'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTopology(t)}
            className={cn(
              'rounded border px-2.5 py-1 transition-colors',
              topology === t ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1',
            )}
          >
            {t === 'colocated' ? 'colocated pools' : 'EPD (prefill/decode split)'}
          </button>
        ))}
      </div>
      {topology === 'epd' ? (
        <EpdPanel slots={slots} />
      ) : (
        <div className="space-y-4">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-text-3">workers</span>
          {[1, 2, 4].map((n) => (
            <button
              key={n}
              onClick={() => setWorkerCount(n)}
              className={cn(
                'rounded border px-2.5 py-1 transition-colors',
                workerCount === n ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="text-text-3">router</span>
          {(['rr', 'jsq', 'prefix'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRouter(r)}
              className={cn(
                'rounded border px-2.5 py-1 transition-colors',
                router === r ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1',
              )}
            >
              {routerLabel(r)}
            </button>
          ))}
        </div>
        <span className="font-mono text-[11px] text-text-3">
          {slots.sched || slots.mgr || slots.queue ? 'your stack in every worker' : 'reference stack (upload above to change)'}
        </span>
        <div className="ml-auto flex items-center gap-2">
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
      </div>
      <p className="font-mono text-[10px] leading-relaxed text-text-3">
        shared trace · 12 interleaved system+tool prefixes (256–512 tokens) · identical arrivals for every policy
      </p>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <p className="text-body-sm text-text-2">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <MetricsDashboard
        metrics={observability}
        scope={`cluster · ${workerCount} workers · ${routerLabel(router)}`}
      />

      {/* operational counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[
          ['completed', `${agg.completed}/${REQ_COUNT}`],
          ['shed', `${agg.shed}`],
          ['auto-preempts', `${agg.autoPreempts}`],
          ['cap misses', `${agg.capMisses}`],
          ['tick', `${tick}`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-surface-1 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">{k}</p>
            <p className="mt-1 font-mono text-lg text-text-1">{v}</p>
          </div>
        ))}
      </div>

      {/* workers */}
      <div className={cn('grid gap-4', workerCount === 1 ? 'sm:grid-cols-1' : workerCount === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-4')}>
        {workerRows.map((w, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface-1 p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">worker {i}</p>
              <p className="font-mono text-[11px] text-text-3">
                <span className={w.util > 90 ? 'text-danger' : w.util > 70 ? 'text-amber' : 'text-accent'}>{w.util}%</span> · cache {w.cacheEntries}/6 · w {w.waiting} / r {w.running}
              </p>
            </div>
            <div className="mt-3 grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(32, minmax(0, 1fr))' }}>
              {Array.from({ length: w.dump.numBlocks }, (_, b) => {
                const refs = w.dump.refs.get(b) ?? 0
                let owner: number | undefined
                if (refs > 0) {
                  for (const [id, s] of w.dump.seqs) {
                    if (s.blocks.includes(b)) {
                      owner = id
                      break
                    }
                  }
                }
                return (
                  <div
                    key={b}
                    className={cn(
                      'aspect-square rounded-[2px] border',
                      refs === 0 ? 'border-line bg-ink' : refs > 1 ? 'border-accent' : 'border-transparent',
                    )}
                    style={refs > 0 ? { backgroundColor: `hsl(${HUES[(owner ?? 0) % HUES.length]} 70% 45%)` } : undefined}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {done && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-accent/50 bg-accent/10 p-4">
          <p className="font-mono text-sm text-accent">
            cluster drained — {agg.completed}/{REQ_COUNT} completed, {agg.sloMet} within SLO ({goodput}% goodput, {agg.kvHitRate}% KV hit, {routerLabel(router)}, {workerCount} worker{workerCount > 1 ? 's' : ''}).
          </p>
          <p className="mt-1 text-body-sm text-text-2">
            hold the worker count fixed, flip the router, and reset. Prefix affinity trades a bounded
            queue imbalance for warm KV; the TTFT-SLO card says whether that trade actually paid.
          </p>
        </motion.div>
      )}
        </div>
      )}
    </div>
  )
}
