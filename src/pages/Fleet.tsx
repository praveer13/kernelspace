import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  Upload,
} from 'lucide-react'
import { instantiateLab, LabAbiError, LabTrapError, type LabModule } from '@/lib/wasm-lab'
import {
  dumpRefMultiset,
  makeScript,
  parseDump,
  RefBlockManager,
  type FleetOp,
  type ManagerDump,
} from '@/lib/fleet-model'
import { cn } from '@/lib/utils'
import EnginePanel from '@/pages/fleet/EnginePanel'
import { validateModule } from '@/pages/fleet/drivers'
import ClusterPanel from '@/pages/fleet/ClusterPanel'
import RealEnginePanel from '@/pages/fleet/RealEnginePanel'
import { SLOT_LABEL, SLOT_WANT_LAB, useSlots, type LabKind } from '@/pages/fleet/slots'

/**
 * The Fleet — Phase 2's home. Three modes over one deterministic request
 * stream:
 *   engine:  your scheduler (lab 06) + block manager (lab 02) + intake
 *            queue (lab 04) run the whole serving loop against the
 *            reference stack. Goodput under SLO is the score.
 *   cluster: the same stack replicated across N workers behind a router —
 *            scale-out economics and routing policy made visible.
 *   pool:    your block manager alone, driven op by op, conformance-checked
 *            against the JS reference every tick.
 */
export default function Fleet() {
  const [mode, setMode] = useState<'engine' | 'cluster' | 'real' | 'pool'>('engine')
  const slots = useSlots((s) => s.slots)
  const setSlot = useSlots((s) => s.setSlot)
  const [slotError, setSlotError] = useState<string | null>(null)
  const inputsRef = useRef<Record<LabKind, HTMLInputElement | null>>({ sched: null, mgr: null, queue: null })

  const onSlotFile = useCallback(async (kind: LabKind, file: File) => {
    setSlotError(null)
    const bytes = await file.arrayBuffer()
    const res = await validateModule(bytes, SLOT_WANT_LAB[kind])
    if (!res.ok) {
      setSlotError(`${SLOT_LABEL[kind]}: ${res.title} — ${res.detail}`)
      return
    }
    setSlot(kind, { bytes, fileName: file.name, lab: SLOT_WANT_LAB[kind] })
  }, [setSlot])

  return (
    <div className="mx-auto max-w-app px-6 pb-24 pt-16 lg:px-12">
      <Link to="/forge" className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-text-3 transition-colors hover:text-text-1">
        <ArrowLeft className="h-3.5 w-3.5" /> the forge
      </Link>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">the fleet · v2</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-text-1 sm:text-4xl">
            Your stack, live traffic, N workers
          </h1>
          <p className="mt-3 max-w-2xl text-body-lg text-text-2">
            Upload your Forge modules once — they run everywhere.{' '}
            <span className="text-text-1">Engine</span>: one engine, your scheduler + block manager +
            intake queue vs the reference stack. <span className="text-text-1">Cluster</span>: your stack
            replicated across workers behind a router. <span className="text-text-1">Pool</span>: your
            block manager alone, conformance-checked op by op.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          {(['engine', 'cluster', 'real', 'pool'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded border px-3 py-1.5 transition-colors',
                mode === m ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* shared upload slots */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {(['sched', 'mgr', 'queue'] as const).map((kind) => (
          <span key={kind}>
            <button
              onClick={() => inputsRef.current[kind]?.click()}
              className={cn(
                'inline-flex items-center gap-2 rounded-md border px-3.5 py-2 font-mono text-[12px] transition-colors',
                slots[kind] ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-surface-1 text-text-2 hover:border-accent/50 hover:text-text-1',
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              {SLOT_LABEL[kind]}: {slots[kind] ? 'yours ✓' : 'reference'}
            </button>
            <input
              ref={(el) => {
                inputsRef.current[kind] = el
              }}
              type="file"
              accept=".wasm,application/wasm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onSlotFile(kind, f)
                e.target.value = ''
              }}
            />
          </span>
        ))}
        {slotError && <span className="font-mono text-[11px] text-danger">{slotError}</span>}
      </div>

      <div className="mt-6">
        {mode === 'engine' ? <EnginePanel slots={slots} /> : mode === 'cluster' ? <ClusterPanel slots={slots} /> : mode === 'real' ? <RealEnginePanel slots={slots} /> : <PoolMode />}
      </div>
    </div>
  )
}

/* ------------------------------ pool mode ------------------------------ */

const NUM_BLOCKS = 64
const BLOCK_SIZE = 16
const TICKS = 160

type Driver =
  | { kind: 'none' }
  | { kind: 'demo' } // JS reference drives the grid (no module uploaded)
  | { kind: 'wasm'; mod: LabModule & { hasInvoke: boolean }; checksPassed: number; checksTotal: number }

interface Divergence {
  tick: number
  detail: string
}

interface Counters {
  allocs: number
  forks: number
  appends: number
  frees: number
  failedAdmits: number
}

const SEQ_HUES = [162, 200, 265, 20, 330, 90, 45, 285, 150, 0]
const seqColor = (id: number) => `hsl(${SEQ_HUES[id % SEQ_HUES.length]} 70% 45%)`

function PoolMode() {
  const [driver, setDriver] = useState<Driver>({ kind: 'none' })
  const [intensity, setIntensity] = useState(1)
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [dump, setDump] = useState<ManagerDump | null>(null)
  const [divergence, setDivergence] = useState<Divergence | null>(null)
  const [counters, setCounters] = useState<Counters>({ allocs: 0, forks: 0, appends: 0, frees: 0, failedAdmits: 0 })
  const [logLines, setLogLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const refRef = useRef<RefBlockManager | null>(null)
  const scriptRef = useRef<FleetOp[][]>([])

  const log = useCallback((line: string) => {
    setLogLines((prev) => [...prev.slice(-13), line])
  }, [])

  const reset = useCallback(() => {
    setTick(0)
    setPlaying(false)
    setDivergence(null)
    setCounters({ allocs: 0, forks: 0, appends: 0, frees: 0, failedAdmits: 0 })
    setLogLines([])
    scriptRef.current = makeScript(TICKS, intensity)
    refRef.current = new RefBlockManager(NUM_BLOCKS, BLOCK_SIZE)
    if (driver.kind === 'wasm') {
      try {
        driver.mod.invoke(`init ${NUM_BLOCKS} ${BLOCK_SIZE}`)
        setDump(parseDump(driver.mod.invoke('dump')))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } else if (driver.kind === 'demo') {
      const m = refRef.current
      setDump({ numBlocks: NUM_BLOCKS, blockSize: BLOCK_SIZE, free: m.freeBlocks, refs: new Map(), seqs: new Map() })
    }
  }, [driver, intensity])

  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, intensity])

  const step = useCallback(() => {
    const t = tick
    if (t >= TICKS) {
      setPlaying(false)
      return
    }
    const ops = scriptRef.current[t] ?? []
    const ref = refRef.current
    if (!ref) return
    let newDump: ManagerDump | null = null
    const c = { ...counters }

    for (const op of ops) {
      let refResult: boolean = true
      if (op.kind === 'allocate') refResult = ref.allocate(op.a, op.n ?? 0)
      else if (op.kind === 'append') refResult = ref.append(op.a, op.n ?? 0)
      else if (op.kind === 'fork') refResult = ref.fork(op.a, op.b ?? 0)
      else ref.free(op.a)

      if (driver.kind === 'wasm') {
        try {
          const cmd =
            op.kind === 'allocate'
              ? `allocate ${op.a} ${op.n}`
              : op.kind === 'append'
                ? `append ${op.a} ${op.n}`
                : op.kind === 'fork'
                  ? `fork ${op.a} ${op.b}`
                  : `free ${op.a}`
          const got = driver.mod.invoke(cmd).trim()
          const gotBool = got === 'true' ? true : got === 'false' ? false : null
          if (op.kind !== 'free' && gotBool !== null && gotBool !== refResult) {
            setDivergence({
              tick: t,
              detail: `${cmd} → ${got} but reference says ${refResult} — capacity accounting differs`,
            })
            setPlaying(false)
          } else if (op.kind !== 'free' && gotBool === null) {
            setDivergence({ tick: t, detail: `${cmd} → "${got}" (unparseable reply)` })
            setPlaying(false)
          }
        } catch (e) {
          setDivergence({
            tick: t,
            detail: e instanceof LabTrapError ? 'module trapped mid-run — a todo!() or panic fired' : String(e),
          })
          setPlaying(false)
          return
        }
      }

      if (op.kind === 'allocate') {
        c.allocs++
        if (!refResult) c.failedAdmits++
      } else if (op.kind === 'fork') c.forks++
      else if (op.kind === 'append') c.appends++
      else c.frees++
      log(
        `${String(t).padStart(3, '0')} ${
          op.kind === 'allocate'
            ? `admit seq ${op.a} (${op.n} tok)`
            : op.kind === 'append'
              ? `decode seq ${op.a} +${op.n}`
              : op.kind === 'fork'
                ? `fork seq ${op.a} → ${op.b}`
                : `free seq ${op.a}`
        }${op.kind !== 'free' && !refResult ? ' — REJECTED (no blocks)' : ''}`,
      )
    }

    if (driver.kind === 'wasm') {
      try {
        const freeReply = Number(driver.mod.invoke('free_blocks').trim())
        if (freeReply !== ref.freeBlocks) {
          setDivergence({ tick: t, detail: `free_blocks = ${freeReply}, reference ${ref.freeBlocks} — a leak or a double-free` })
          setPlaying(false)
        }
        const parsed = parseDump(driver.mod.invoke('dump'))
        const a = dumpRefMultiset(parsed).join(',')
        const b = ref.refcountMultiset().join(',')
        if (a !== b) {
          setDivergence({ tick: t, detail: `refcount multiset differs (yours [${a}] vs reference [${b}]) — sharing/CoW semantics diverge` })
          setPlaying(false)
        }
        newDump = parsed
      } catch (e) {
        setDivergence({ tick: t, detail: e instanceof Error ? e.message : String(e) })
        setPlaying(false)
        return
      }
    } else {
      const refsMap = new Map<number, number>()
      for (const [, s] of ref.seqs()) for (const b of s.blocks) refsMap.set(b, (refsMap.get(b) ?? 0) + 1)
      newDump = { numBlocks: NUM_BLOCKS, blockSize: BLOCK_SIZE, free: ref.freeBlocks, refs: refsMap, seqs: new Map(ref.seqs()) }
    }

    setCounters(c)
    setDump(newDump)
    setTick(t + 1)
  }, [tick, counters, driver, log])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(step, 120)
    return () => window.clearInterval(id)
  }, [playing, step])

  const onFile = useCallback(async (file: File) => {
    setError(null)
    try {
      const mod = await instantiateLab(await file.arrayBuffer())
      if (!mod.hasInvoke) {
        setError('this module predates the fleet bridge (no ks_invoke) — pull the latest lab template and rebuild.')
        return
      }
      const report = mod.runChecks()
      if (report.lab !== 'kv-block-manager') {
        setError(`this module is for "${report.lab}" — pool mode drives kv-block-manager (lab 02).`)
        return
      }
      const passed = report.checks.filter((x) => x.pass).length
      setDriver({ kind: 'wasm', mod, checksPassed: passed, checksTotal: report.checks.length })
      setDivergence(null)
    } catch (e) {
      if (e instanceof LabTrapError) setError('the module trapped — a todo!() is still open (the fleet needs dump() implemented too).')
      else if (e instanceof LabAbiError) setError(e.message)
      else setError(String(e))
    }
  }, [])

  const utilization = dump ? Math.round(((dump.numBlocks - dump.free) / dump.numBlocks) * 100) : 0

  const gridCells = useMemo(() => {
    if (!dump) return []
    const owner = new Map<number, number>()
    for (const [id, s] of dump.seqs) for (const b of s.blocks) if (!owner.has(b)) owner.set(b, id)
    return Array.from({ length: dump.numBlocks }, (_, b) => {
      const refs = dump.refs.get(b) ?? 0
      return { b, refs, owner: owner.get(b) }
    })
  }, [dump])

  return (
    <div>
      {/* driver bar */}
      <div className="flex flex-wrap items-center gap-3">
        {driver.kind !== 'wasm' && (
          <button
            onClick={() => setDriver({ kind: 'demo' })}
            className={cn(
              'rounded-md border px-4 py-2 font-mono text-sm transition-colors',
              driver.kind === 'demo' ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-surface-1 text-text-2 hover:text-text-1',
            )}
          >
            ▶ demo mode (reference engine)
          </button>
        )}
        <button
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-1 px-4 py-2 font-mono text-sm text-text-2 transition-colors hover:border-accent/50 hover:text-text-1"
        >
          <Upload className="h-4 w-4" />
          {driver.kind === 'wasm' ? 'module loaded ✓ — replace' : 'drop your kv_block_manager.wasm'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".wasm,application/wasm"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onFile(f)
            e.target.value = ''
          }}
        />
        {driver.kind === 'wasm' && (
          <span className={cn('font-mono text-[11px]', driver.checksPassed === driver.checksTotal ? 'text-accent' : 'text-amber')}>
            lab checks {driver.checksPassed}/{driver.checksTotal}
          </span>
        )}
        <div className="mr-auto flex items-center gap-2 font-mono text-[11px]">
          {[1, 2, 4].map((x) => (
            <button
              key={x}
              onClick={() => setIntensity(x)}
              className={cn(
                'rounded border px-2.5 py-1 transition-colors',
                intensity === x ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line text-text-3 hover:text-text-1',
              )}
            >
              {x}×
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPlaying((p) => !p)}
            disabled={driver.kind === 'none'}
            className="rounded-md border border-line bg-surface-1 p-2 text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
            aria-label={playing ? 'pause' : 'play'}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={step}
            disabled={driver.kind === 'none' || playing}
            className="rounded-md border border-line bg-surface-1 p-2 text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
            aria-label="step one tick"
          >
            <StepForward className="h-4 w-4" />
          </button>
          <button
            onClick={reset}
            disabled={driver.kind === 'none'}
            className="rounded-md border border-line bg-surface-1 p-2 text-text-2 transition-colors hover:text-text-1 disabled:opacity-40"
            aria-label="reset"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* banners */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <p className="text-body-sm text-text-2">{error}</p>
          </motion.div>
        )}
        {divergence && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <div>
              <p className="font-mono text-sm text-danger">conformance divergence at tick {divergence.tick}</p>
              <p className="mt-1 text-body-sm text-text-2">{divergence.detail}</p>
            </div>
          </motion.div>
        )}
        {driver.kind === 'wasm' && !divergence && tick > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <Check className="h-4 w-4 text-accent" />
            <p className="font-mono text-[12px] text-accent">in lockstep with the reference — {tick} ticks, zero divergence</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* grid + stats */}
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border border-line bg-surface-1 p-5">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">HBM pool — 64 KV blocks</p>
            <p className="font-mono text-[11px] text-text-3">
              tick {tick}/{TICKS} ·{' '}
              <span className={utilization > 90 ? 'text-danger' : utilization > 70 ? 'text-amber' : 'text-accent'}>{utilization}%</span> resident
            </p>
          </div>
          <div className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(16, minmax(0, 1fr))' }}>
            {gridCells.map(({ b, refs, owner }) => (
              <div
                key={b}
                title={refs === 0 ? `block ${b}: free` : `block ${b}: ${refs} ref${refs > 1 ? 's' : ''}${owner !== undefined ? `, seq ${owner}` : ''}`}
                className={cn(
                  'aspect-square rounded-[3px] border transition-colors duration-150',
                  refs === 0 ? 'border-line bg-ink' : refs > 1 ? 'border-accent' : 'border-transparent',
                )}
                style={refs > 0 ? { backgroundColor: seqColor(owner ?? 0) } : undefined}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-4 font-mono text-[10px] text-text-3">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px] border border-line bg-ink" /> free</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: seqColor(1) }} /> owned</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[2px] border border-accent" style={{ backgroundColor: seqColor(1) }} /> shared (refs &gt; 1)</span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-surface-1 p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">counters</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[12px] text-text-2">
              <span>admissions</span><span className="text-right text-text-1">{counters.allocs}</span>
              <span>rejected</span><span className={cn('text-right', counters.failedAdmits > 0 ? 'text-amber' : 'text-text-1')}>{counters.failedAdmits}</span>
              <span>forks</span><span className="text-right text-text-1">{counters.forks}</span>
              <span>decode steps</span><span className="text-right text-text-1">{counters.appends}</span>
              <span>frees</span><span className="text-right text-text-1">{counters.frees}</span>
              <span>live seqs</span><span className="text-right text-text-1">{dump?.seqs.size ?? 0}</span>
            </div>
          </div>
          <div className="rounded-lg border border-line bg-ink p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-3">event log</p>
            <div className="mt-2 space-y-1 font-mono text-[10.5px] leading-relaxed text-text-3">
              {logLines.length === 0 && <p className="text-text-3/60">— press play —</p>}
              {logLines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="mt-8 max-w-2xl text-body-sm text-text-3">
        The script is deterministic (same traffic every run). Conformance checks compare only
        implementation-agnostic state: op results, free block count, and the refcount multiset —
        your physical block ids may differ from the reference, the invariants may not. Demo mode
        runs the reference engine directly; your module replaces it.
      </p>
    </div>
  )
}
