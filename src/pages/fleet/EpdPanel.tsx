import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Play, RotateCcw } from 'lucide-react'
import { describeFleetError, openFleetSession, type FleetSession } from '@/lib/fleet-session'
import {
  makeRequestStream,
  makeRng,
  PRACTICE_SEED,
  type ManagerDump,
  type RequestSpec,
} from '@/lib/fleet-model'
import type { EpdResult, EpdSide, EpdSnapshot } from '@/workers/fleet-protocol'
import { slotBytes } from '@/pages/fleet/drivers'
import type { SlotState } from '@/pages/fleet/slots'
import { cn } from '@/lib/utils'

const REQ_CHAT = 240
const REQ_LONG = 160
const SPAN = 900
/** ticks per worker batch: well inside the 2 s step budget, and few enough round trips */
const BATCH_TICKS = 100

function longCtxStream(count: number, span: number): RequestSpec[] {
  const rng = makeRng(0x10c5)
  const out: RequestSpec[] = []
  for (let i = 0; i < count; i++) {
    out.push({ id: i + 1, arrival: rng() % span, prompt: 512 + (rng() % 513), output: 96 + (rng() % 161) })
  }
  return out.sort((a, b) => a.arrival - b.arrival || a.id - b.id)
}

interface PanelError {
  message: string
  /** a fleet command outran its budget: offer "reset with reference drivers" */
  timedOut: boolean
}

export default function EpdPanel({ slots, onUseReference }: { slots: SlotState; onUseReference?: () => void }) {
  const [traffic, setTraffic] = useState<'chat' | 'long'>('chat')
  const [itl, setItl] = useState(2)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<PanelError | null>(null)
  const [result, setResult] = useState<EpdResult | null>(null)
  const runIdRef = useRef(0)
  const sessionRef = useRef<FleetSession<EpdSnapshot> | null>(null)

  const streamFor = useCallback(() => {
    return traffic === 'chat' ? makeRequestStream(REQ_CHAT, SPAN, PRACTICE_SEED) : longCtxStream(REQ_LONG, SPAN)
  }, [traffic])

  const run = useCallback(async () => {
    const runId = ++runIdRef.current
    setRunning(true)
    setError(null)
    sessionRef.current?.close()
    sessionRef.current = null
    try {
      // colocated: 2 workers, each a full engine; EPD: 1 prefill + 1 decode with the same total blocks (cut in the worker)
      const colocated = traffic === 'chat'
        ? { numBlocks: 192, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128, interference: true, sloItl: itl }
        : { numBlocks: 448, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128, interference: true, sloItl: itl }
      /* the worker instantiates the learner stack for every engine and runs both topologies, a batch of ticks at a time */
      const session = await openFleetSession({
        mode: 'epd',
        slots: slotBytes(slots),
        traffic: streamFor(),
        cfg: { colocated, transferRate: 256, intakeCap: 32, drainPerTick: 6, maxTicks: 40000 },
      })
      sessionRef.current = session
      let snap = await session.step(BATCH_TICKS)
      while (!snap.done) {
        if (runIdRef.current !== runId) return
        snap = await session.step(BATCH_TICKS)
      }
      if (runIdRef.current !== runId) return
      session.close()
      sessionRef.current = null
      setResult(snap.result)
    } catch (e) {
      if (runIdRef.current !== runId) return
      const { detail, timedOut } = describeFleetError(e)
      setError({ message: detail, timedOut })
    } finally {
      if (runIdRef.current === runId) setRunning(false)
    }
  }, [traffic, itl, slots, streamFor])

  useEffect(() => {
    runIdRef.current++
    sessionRef.current?.close()
    sessionRef.current = null
    setResult(null)
    setRunning(false)
    setError(null)
  }, [traffic, itl, slots])

  /* leaving the page, or switching topology, stops the worker */
  useEffect(
    () => () => {
      runIdRef.current++
      sessionRef.current?.close()
      sessionRef.current = null
    },
    [],
  )

  const HUES = [162, 200, 265, 20, 330, 90, 45, 285, 150, 0]

  return (
    <div className="space-y-4">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
        <span className="text-text-3">traffic</span>
        {(['chat', 'long'] as const).map((t) => (
          <button key={t} onClick={() => setTraffic(t)} className={cn('rounded border px-2.5 py-1', traffic === t ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>
            {t === 'chat' ? 'chat mix' : 'long context'}
          </button>
        ))}
        <span className="text-text-3">ITL SLO</span>
        {[2, 3, 5].map((n) => (
          <button key={n} onClick={() => setItl(n)} className={cn('rounded border px-2.5 py-1', itl === n ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1')}>
            ≤{n} ticks
          </button>
        ))}
        <button onClick={() => void run()} disabled={running} className="ml-auto inline-flex items-center gap-2 rounded-md border border-accent/60 bg-accent/10 px-4 py-2 font-mono text-sm text-accent hover:bg-accent/20 disabled:opacity-50">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {running ? 'executing both topologies…' : 'run colocated vs EPD'}
        </button>
        {result && (
          <button onClick={() => setResult(null)} className="rounded-md border border-line bg-surface-1 p-2 text-text-2 hover:text-text-1" aria-label="reset">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-danger/40 bg-danger/5 p-4 font-mono text-[12px] text-danger">
            {error.message}
            {error.timedOut && onUseReference && (
              <button
                type="button"
                onClick={onUseReference}
                className="mt-3 block rounded border border-line bg-surface-1 px-3 py-1.5 text-[11px] text-text-1 hover:border-accent/50"
              >
                reset with reference drivers
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !running && (
        <p className="max-w-2xl text-body-sm text-text-3">
          The T5.L9 rule, executable: disaggregation pays for ITL isolation and costs a KV transfer.
          Run both topologies on the same traffic and watch the crossover — EPD wins when the ITL
          SLO is tight (decode isolation beats the transfer tax), colocated wins when it's loose
          (the tax is pure overhead). Pools are sized equal-total per trace. This is a practice
          run on fixed seeds (chat 0x{PRACTICE_SEED.toString(16)}, long-context 0x10c5), not graded.
        </p>
      )}

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* verdict */}
          <div className={cn('rounded-lg border p-4', result.winner === 'epd' ? 'border-accent/50 bg-accent/10' : 'border-line bg-surface-1')}>
            <p className={cn('font-mono text-sm', result.winner === 'epd' ? 'text-accent' : 'text-text-1')}>
              {result.winner === 'tie'
                ? 'dead heat'
                : result.winner === 'epd'
                  ? `EPD wins at ITL ≤${itl}: decode isolation > transfer tax (${result.epd.goodput}% vs ${result.colocated.goodput}%)`
                  : `colocated wins at ITL ≤${itl}: the transfer tax is pure overhead (${result.colocated.goodput}% vs ${result.epd.goodput}%)`}
            </p>
            <p className="mt-1 text-body-sm text-text-2">
              {result.winner === 'epd'
                ? 'the 2025–26 default architecture exists for exactly this regime: tight ITL contracts, skewed phases, fleets big enough to bin-pack.'
                : 'the rule holds: disaggregate at scale and tight SLO, colocate at small scale and loose SLO. Move the ITL slider to see the crossover.'}
            </p>
          </div>

          {/* scoreboard */}
          <div className="grid gap-4 sm:grid-cols-2">
            <SideCard title="colocated (2 workers, shared pools)" r={result.colocated} winner={result.winner === 'colocated'} />
            <SideCard title="EPD (prefill pool + decode pool)" r={result.epd} winner={result.winner === 'epd'} />
          </div>

          {/* P/D grids */}
          <div className="grid gap-4 sm:grid-cols-2">
            <PoolGrid title="prefill pool (KV freed at transfer)" dump={result.dumps.prefill} hues={HUES} />
            <PoolGrid title="decode pool (KV lands here)" dump={result.dumps.decode} hues={HUES} />
          </div>
        </motion.div>
      )}
    </div>
  )
}

function SideCard({ title, r, winner }: { title: string; r: EpdSide; winner: boolean }) {
  return (
    <div className={cn('rounded-lg border p-5', winner ? 'border-accent/60 bg-accent/5' : 'border-line bg-surface-1')}>
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">{title}</p>
        <p className={cn('font-mono text-2xl font-semibold', winner ? 'text-accent' : 'text-text-1')}>
          {r.goodput}<span className="text-sm text-text-3">% goodput</span>
        </p>
      </div>
      <div className="mt-3 space-y-1 font-mono text-[12px] text-text-2">
        <div className="flex justify-between"><span className="text-text-3">completed</span><span>{r.completed}</span></div>
        <div className="flex justify-between"><span className="text-text-3">shed</span><span>{r.shed}</span></div>
        <div className="flex justify-between"><span className="text-text-3">auto-preempts</span><span>{r.preempts}</span></div>
        {r.delay !== undefined && (
          <div className="flex justify-between"><span className="text-text-3">avg transfer delay</span><span>{r.delay} ticks</span></div>
        )}
      </div>
    </div>
  )
}

function PoolGrid({ title, dump, hues }: { title: string; dump: ManagerDump; hues: number[] }) {
  const owner = new Map<number, number>()
  for (const [id, s] of dump.seqs) for (const b of s.blocks) if (!owner.has(b)) owner.set(b, id)
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">{title}</p>
        <p className="font-mono text-[11px] text-text-3">{Math.round(((dump.numBlocks - dump.free) / dump.numBlocks) * 100)}% resident</p>
      </div>
      <div className="mt-3 grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(32, minmax(0, 1fr))' }}>
        {Array.from({ length: dump.numBlocks }, (_, b) => {
          const refs = dump.refs.get(b) ?? 0
          return (
            <div
              key={b}
              className={cn('aspect-square rounded-[2px] border', refs === 0 ? 'border-line bg-ink' : refs > 1 ? 'border-accent' : 'border-transparent')}
              style={refs > 0 ? { backgroundColor: `hsl(${hues[(owner.get(b) ?? 0) % hues.length]} 70% 45%)` } : undefined}
            />
          )
        })}
      </div>
    </div>
  )
}
