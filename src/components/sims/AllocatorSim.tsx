/**
 * SIM-02 `sim-allocator` — Toy Allocator Playground (playground.md §5).
 * A 1024-byte heap: malloc/free with first/next/best-fit, split & coalesce,
 * fragmentation meter, configurable fixed-block PagedAttention mode, long-trace
 * policy comparison, and an unsafe double-free alias inspector.
 *
 * The heap is the World's engine (src/lib/world/heap) behind src/lib/sims/models/allocator.ts, which
 * the phone-mode outcomes read too. Four task scripts there are the outcome tasks' canonical runs
 * (allocator.tasks.ts): the learner loads one, plays it to the end, and the sim reports the result
 * through `observe`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Zap } from 'lucide-react'
import RustLab from '@/components/sims/RustLab'
import { RUST_LAB_TASKS } from '@/components/sims/rustLab.tasks'
import { ALLOCATOR_LEGACY_TASKS } from '@/components/sims/allocator.tasks'
import PlaygroundShell, {
  ChipButton,
  ControlGroup,
  InlineQuiz,
  LogConsole,
  TransportBar,
  completeSimTask,
  useInitialCfg,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
  useSimMachine,
  useWriteCfg,
} from '@/components/sims/PlaygroundShell'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useObserve } from '@/lib/sims/host'
import {
  ADVERSARIAL_TRACE,
  ALTERNATING_TRACE,
  FIXED_BLOCK_SIZES,
  HEADER,
  HEAP_SIZE,
  MIN_SPLIT,
  SCRIPTS,
  SCRIPT_IDS,
  WORK_SIZES,
  blankHeap,
  blocksOf,
  compareStrategies,
  fixedHeap,
  fragmentation,
  free,
  genWorkload,
  heapToCfg,
  hx4,
  makeTrace,
  malloc,
  observeScript,
  restoreConfig,
  simulateTrace,
} from '@/lib/sims/models/allocator'
import type { AllocHeap, Block, ScriptId, ScriptOp, Strategy, TraceResult, WorkOp } from '@/lib/sims/models/allocator'
import { cn } from '@/lib/utils'

const SIM_ID = 'sim-allocator'
const ROW_BYTES = 256

type HostMode = 'allocator' | 'rust'

/** The pre-registry tasks, as the shell's checklist shows them (the registry lists them as legacy). */
const ALLOCATOR_TASKS = ALLOCATOR_LEGACY_TASKS.map((t) => ({ id: t.id, text: t.setup, xp: 60 }))

/** A live-workload op or a scripted one. */
type QueuedOp = WorkOp | ScriptOp

export default function AllocatorSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()
  const observe = useObserve()
  const { machine, from, selectMachine } = useSimMachine()
  const rustTab =
    machine === 'rust-concurrency' ||
    (machine !== 'rust-ownership' && machine !== 'rust' && from === 't3.l3')
      ? 'concurrency'
      : 'ownership'
  const mode: HostMode =
    machine === 'allocator'
      ? 'allocator'
      : machine === 'rust' || machine === 'rust-ownership' || machine === 'rust-concurrency'
        ? 'rust'
        : from === 't3.l1' || from === 't3.l3'
          ? 'rust'
          : 'allocator'
  const selectMode = (nextMode: HostMode) => {
    if (nextMode === 'rust') {
      setQueue(null)
      setPlaying(false)
      scriptRef.current = null
      setActiveScript(null)
    }
    selectMachine(nextMode === 'allocator' ? 'allocator' : `rust-${rustTab}`)
  }
  // The task list is keyed by machine, so the default machine says its name (lab: `?machine=`, inline: the host's).
  useEffect(() => {
    if (mode === 'allocator' && machine === null) selectMachine('allocator')
  }, [mode, machine, selectMachine])

  const initialCfg = useInitialCfg<unknown>()
  const [start] = useState(() => restoreConfig(initialCfg))
  const [heap, setHeapState] = useState<AllocHeap>(start.heap)
  const heapRef = useRef<AllocHeap>(heap)
  const setHeap = useCallback((next: AllocHeap) => {
    heapRef.current = next
    setHeapState(next)
  }, [])

  const [strategy, setStrategyState] = useState<Strategy>(start.strategy)
  const [coalesceOn, setCoalesceState] = useState<boolean>(start.coalesce)
  const [fixedMode, setFixedMode] = useState<boolean>(start.fixed)
  const [fixedBlockSize, setFixedBlockSize] = useState(start.fixedSize)
  const [traceHistory, setTraceHistory] = useState<number[]>([])
  const [traceSummary, setTraceSummary] = useState<TraceResult | null>(null)
  const [comparison, setComparison] = useState<Record<Strategy, TraceResult> | null>(null)
  const [aliasOwners, setAliasOwners] = useState<string[]>([])
  const [mallocSize, setMallocSize] = useState('64')
  const [queue, setQueueState] = useState<QueuedOp[] | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [shakeKey, setShakeKey] = useState(0)
  const [activeScript, setActiveScript] = useState<ScriptId | null>(null)

  // The queue lives in a ref so one step runs exactly once, whatever React does with state updaters.
  const queueRef = useRef<QueuedOp[]>([])
  const setQueue = useCallback((next: QueuedOp[] | null) => {
    queueRef.current = next ?? []
    setQueueState(next !== null && next.length > 0 ? next : null)
  }, [])
  /** The script being played: its id and the allocation each of its mallocs got (null: it failed). */
  const scriptRef = useRef<{ id: ScriptId; handles: (number | null)[] } | null>(null)
  /** True while the queue runs an op, so only the learner's own actions cancel a script. */
  const applyingRef = useRef(false)

  const ticksRef = useRef(0)
  const [ticks, setTicks] = useState(0)
  const bump = useCallback(() => {
    ticksRef.current += 1
    setTicks(ticksRef.current)
    return ticksRef.current
  }, [])
  const sawFragRef = useRef(false)
  const lastTraceRef = useRef<WorkOp[] | null>(null)
  const quizCorrectRef = useRef(false)
  const quizAwardedRef = useRef(false)

  /** A script's result is only the canonical one if nothing else touched the heap, so any hand-made change drops it. */
  const dropScript = useCallback(() => {
    if (scriptRef.current === null) return
    scriptRef.current = null
    setActiveScript(null)
    setQueue(null)
    setPlaying(false)
    log(ticksRef.current, 'SCRIPT', 'script cancelled — the heap no longer matches its canonical run', 'warn')
  }, [log, setQueue])

  const setStrategy = useCallback(
    (next: Strategy) => {
      dropScript()
      setStrategyState(next)
    },
    [dropScript],
  )
  const setCoalesceOn = useCallback(
    (next: boolean) => {
      dropScript()
      setCoalesceState(next)
    },
    [dropScript],
  )

  const awardQuizIfReady = useCallback(
    (isFixed: boolean, result: TraceResult | null) => {
      if (
        quizAwardedRef.current ||
        !quizCorrectRef.current ||
        !isFixed ||
        !result?.history.every((ratio) => ratio === 1)
      ) {
        return
      }
      quizAwardedRef.current = true
      completeSimTask(SIM_ID, 't-quiz', 60)
      log(
        ticksRef.current,
        'NOTE',
        '≡ PagedAttention: fixed blocks keep external fragmentation at 0%; unused capacity remains internal waste',
        'ok',
      )
    },
    [log],
  )

  useWriteCfg(heapToCfg(heap, strategy, coalesceOn, fixedBlockSize))

  const blocks = useMemo(() => blocksOf(heap), [heap])
  const frag = fragmentation(blocks)
  const fragPct = Math.round(frag.ratio * 100)
  const liveBytes = blocks.filter((b) => !b.free).reduce((s, b) => s + b.size, 0)
  const usedCount = blocks.filter((b) => !b.free).length

  /* ------------------------------ ops ------------------------------ */
  /** malloc(n); returns the new allocation's id, or null when it failed. */
  const doMalloc = useCallback(
    (n: number): number | null => {
      if (!applyingRef.current) dropScript()
      const t = bump()
      const res = malloc(heapRef.current, n, strategy)
      if (res.block === null) {
        let line: string
        if (fixedMode) {
          const reason = res.reason === 'too-big' ? `request exceeds ${fixedBlockSize}B block` : `all ${HEAP_SIZE / fixedBlockSize} KV blocks in use`
          line = `${n}B ✗ ENOMEM — ${reason}`
        } else {
          line = `${n}B ✗ ENOMEM — no block big enough (largest free ${fragmentation(blocksOf(heapRef.current)).largest}B)`
        }
        log(t, 'ALLOC', line, 'err')
        setShakeKey((k) => k + 1)
        return null
      }
      setHeap(res.heap)
      if (fixedMode) {
        const waste = fixedBlockSize - n
        log(
          t,
          'ALLOC',
          `${n}B @ ${hx4(res.block.start)} (${fixedBlockSize}B block${waste > 0 ? `, ${waste}B internal waste` : ''})`,
          'ok',
        )
      } else {
        log(t, 'ALLOC', `${n}B @ ${hx4(res.block.start)}${res.note} ✓`, 'ok')
      }
      return res.block.id
    },
    [bump, dropScript, fixedBlockSize, fixedMode, log, setHeap, strategy],
  )

  const doFree = useCallback(
    (id: number) => {
      if (!applyingRef.current) dropScript()
      const t = bump()
      const { heap: next, addr, note } = free(heapRef.current, id, coalesceOn && !fixedMode)
      if (addr === -1) return
      setHeap(next)
      log(t, 'FREE', `${hx4(addr)} released${note ? ` · ${note}` : ''}`)
    },
    [bump, coalesceOn, dropScript, fixedMode, log, setHeap],
  )

  const doFreeRandom = useCallback(() => {
    const used = blocksOf(heapRef.current).filter((b) => !b.free)
    if (used.length === 0) {
      log(ticksRef.current, 'FREE', '✗ nothing allocated — skipped', 'warn')
      return
    }
    const pick = used[Math.floor(Math.random() * used.length)]
    doFree(pick.id)
  }, [doFree, log])

  /* ---------------------------- workload ---------------------------- */
  const applyWorkloadOp = useCallback(() => {
    const cur = queueRef.current
    if (cur.length === 0) {
      setPlaying(false)
      return
    }
    const [op, ...rest] = cur
    setQueue(rest)
    applyingRef.current = true
    try {
      const running = scriptRef.current
      if (op.type === 'release') {
        const id = running?.handles[op.handle - 1]
        if (id === undefined || id === null) log(ticksRef.current, 'FREE', `✗ malloc #${op.handle} never landed — skipped`, 'warn')
        else doFree(id)
      } else if (op.type === 'malloc') {
        const id = doMalloc(op.size)
        running?.handles.push(id)
      } else {
        doFreeRandom()
      }
    } finally {
      applyingRef.current = false
    }
    const script = scriptRef.current
    if (script !== null && rest.length === 0) {
      const seen = observeScript(script.id, heapRef.current, strategy, coalesceOn)
      scriptRef.current = null
      setActiveScript(null)
      observe({ key: seen.key, value: seen.value, unit: seen.unit })
      log(ticksRef.current, 'OBSERVE', `${SCRIPTS[script.id].label}: ${seen.value} ${seen.unit} (${seen.key})`, 'ok')
    }
  }, [coalesceOn, doFree, doFreeRandom, doMalloc, log, observe, setQueue, strategy])

  const applyRef = useRef(applyWorkloadOp)
  useEffect(() => {
    applyRef.current = applyWorkloadOp
  }, [applyWorkloadOp])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => applyRef.current(), 550 / speed)
    return () => window.clearInterval(id)
  }, [playing, speed])

  const startWorkload = useCallback(() => {
    const seed = Math.floor(Math.random() * 1e9)
    scriptRef.current = null
    setActiveScript(null)
    setQueue(genWorkload(seed))
    setPlaying(true)
    log(ticksRef.current, 'WORK', `auto workload — 40 mixed ops (seed ${seed.toString(16)})`, 'warn')
  }, [log, setPlaying, setQueue])

  const runLongTrace = useCallback(
    (alternating: boolean) => {
      const spec = alternating ? ALTERNATING_TRACE : ADVERSARIAL_TRACE
      const trace = makeTrace(spec.length, spec.seed, spec.alternating)
      const result = simulateTrace(trace, strategy, fixedMode ? fixedBlockSize : null)
      lastTraceRef.current = trace
      setTraceHistory(result.history)
      setTraceSummary(result)
      setComparison(null)
      log(
        bump(),
        'TRACE',
        `${spec.length} ops · ${result.failureSnapshots.length} failed · final usability ${Math.round(result.finalRatio * 100)}%`,
        result.failureSnapshots.length > 0 ? 'warn' : 'ok',
      )
      if (fixedMode && result.history.every((ratio) => ratio === 1)) {
        completeSimTask(SIM_ID, 't-paged', 60)
      }
      awardQuizIfReady(fixedMode, result)
    },
    [
      awardQuizIfReady,
      bump,
      fixedBlockSize,
      fixedMode,
      log,
      setComparison,
      setTraceHistory,
      setTraceSummary,
      strategy,
    ],
  )

  const comparePolicies = useCallback(() => {
    const selectedTrace = lastTraceRef.current
    const trace = selectedTrace ?? makeTrace(ALTERNATING_TRACE.length, ALTERNATING_TRACE.seed, ALTERNATING_TRACE.alternating)
    const results = compareStrategies(trace)
    setComparison(results)
    setTraceSummary(null)
    setTraceHistory(results[strategy].history)
    log(bump(), 'COMPARE', `same ${trace.length}-op trace replayed under first, next, and best fit`, 'ok')
    if (selectedTrace) completeSimTask(SIM_ID, 't-trace-lab', 60)
  }, [bump, log, setComparison, setTraceHistory, setTraceSummary, strategy])

  const runAliasDemo = useCallback(() => {
    setAliasOwners(['owner A → 0x0040', 'owner B → 0x0040'])
    log(
      bump(),
      'CORRUPT',
      'double-free inserted 0x0040 twice; malloc A and malloc B now alias the same bytes',
      'err',
    )
    completeSimTask(SIM_ID, 't-double-free', 60)
  }, [bump, log, setAliasOwners])

  /* ----------------------------- task checks ----------------------------- */
  useEffect(() => {
    if (!fixedMode && frag.totalFree > 0 && frag.ratio < 0.25) {
      sawFragRef.current = true
      completeSimTask(SIM_ID, 't-frag', 60)
    }
    if (!fixedMode && coalesceOn && sawFragRef.current && frag.ratio > 0.75) {
      completeSimTask(SIM_ID, 't-coalesce', 60)
    }
    // Fixed-block observability is credited only after a real trace reports structural usability.
  }, [frag.ratio, frag.totalFree, fixedMode, coalesceOn])

  /** A fresh heap (fixed blocks of `fixed` B, or variable) with nothing queued and every readout cleared. */
  const freshRun = useCallback(
    (fixed: number | null) => {
      setHeap(fixed === null ? blankHeap() : fixedHeap(fixed))
      setQueue(null)
      setPlaying(false)
      setTraceHistory([])
      setTraceSummary(null)
      setComparison(null)
      setAliasOwners([])
      ticksRef.current = 0
      setTicks(0)
      sawFragRef.current = false
      scriptRef.current = null
      setActiveScript(null)
    },
    [setAliasOwners, setComparison, setHeap, setPlaying, setQueue, setTicks, setTraceHistory, setTraceSummary],
  )

  const reset = useCallback(() => {
    freshRun(fixedMode ? fixedBlockSize : null)
    log(
      0,
      'RESET',
      fixedMode
        ? `heap re-issued as ${HEAP_SIZE / fixedBlockSize} × ${fixedBlockSize}B KV blocks`
        : 'heap re-issued — one 1024B free block',
    )
  }, [fixedBlockSize, fixedMode, freshRun, log])

  /** Fresh heap, the script's mode and policy, its ops queued: the learner steps or plays it to the end. */
  const loadScript = useCallback(
    (id: ScriptId) => {
      const s = SCRIPTS[id]
      freshRun(s.fixed)
      setFixedMode(s.fixed !== null)
      if (s.fixed !== null) setFixedBlockSize(s.fixed)
      if (s.strategy !== null) setStrategyState(s.strategy)
      scriptRef.current = { id, handles: [] }
      setActiveScript(id)
      setQueue([...s.ops])
      log(0, 'SCRIPT', `${s.label} — ${s.ops.length} ops queued; step or play to the end`, 'warn')
    },
    [freshRun, log, setFixedBlockSize, setFixedMode, setQueue],
  )

  const toggleFixed = useCallback(
    (on: boolean) => {
      dropScript()
      setFixedMode(on)
      setQueue(null)
      setPlaying(false)
      setHeap(on ? fixedHeap(fixedBlockSize) : blankHeap())
      log(
        ticksRef.current,
        'MODE',
        on
          ? `fixed ${fixedBlockSize}B blocks — ≡ KV block manager (no external frag)`
          : 'variable blocks — split & coalesce live',
        'warn',
      )
    },
    [dropScript, fixedBlockSize, log, setFixedMode, setHeap, setPlaying, setQueue],
  )

  const changeFixedBlockSize = useCallback(
    (size: number) => {
      dropScript()
      setFixedBlockSize(size)
      if (fixedMode) setHeap(fixedHeap(size))
      setTraceHistory([])
      setTraceSummary(null)
      log(ticksRef.current, 'BLOCK', `${size}B fixed blocks · ${HEAP_SIZE / size} entries`, 'warn')
    },
    [dropScript, fixedMode, log, setFixedBlockSize, setHeap, setTraceHistory, setTraceSummary],
  )

  const sizeVal = Math.min(512, Math.max(1, parseInt(mallocSize || '0', 10) || 0))
  const meterColor = fragPct < 25 ? '#FF5C6C' : fragPct < 50 ? '#FFB224' : '#3EF2A4'

  /* ------------------------------ render ------------------------------ */
  const HATCH =
    'repeating-linear-gradient(45deg, rgba(255,178,36,0.28) 0 2px, transparent 2px 6px)'

  type Seg = { block: Block; segStart: number; segLen: number; isHead: boolean; isTail: boolean }
  const rowSegments = (row: number): Seg[] => {
    const rowStart = row * ROW_BYTES
    const rowEnd = rowStart + ROW_BYTES
    const segs: Seg[] = []
    for (const b of blocks) {
      const s = Math.max(b.start, rowStart)
      const e = Math.min(b.start + b.size, rowEnd)
      if (e > s) {
        segs.push({
          block: b,
          segStart: s,
          segLen: e - s,
          isHead: s === b.start,
          isTail: e === b.start + b.size,
        })
      }
    }
    return segs
  }

  return (
    <PlaygroundShell
      simId={SIM_ID}
      title={mode === 'rust' ? 'Rust Systems Lab' : 'Toy Allocator'}
      subtitle={
        mode === 'rust'
          ? 'ownership · borrowing · concurrency'
          : 'free lists · split & coalesce · fragmentation'
      }
      tasks={mode === 'rust' ? RUST_LAB_TASKS : ALLOCATOR_TASKS}
      help={
        mode === 'rust' ? (
          <>
            <p>
              Step through Rust ownership, borrowing, and lifetime rules as box-and-arrow
              transitions, then compare synchronization strategies under contention.
            </p>
            <p>
              Use the ownership scenarios to see which bindings remain valid, and the concurrency
              scenarios to connect channels, mutexes, atomics, and <span className="font-mono text-text-1">Send</span>{' '}
              constraints to their runtime costs.
            </p>
          </>
        ) : (
          <>
            <p>
              A 1024-byte heap, drawn like a hex editor (4 rows × 256B). Every block pays an{' '}
              <span className="font-mono text-text-1">8B header</span> (the dark cap).{' '}
              <span className="font-mono text-text-1">malloc</span> walks the free list with your
              chosen strategy and splits blocks; <span className="font-mono text-text-1">free</span>{' '}
              returns them, optionally merging neighbors.
            </p>
            <p>
              The meter watches <span className="font-mono text-text-1">largest free ÷ total free</span>{' '}
              — when it craters, plenty of bytes exist but none are usable. That is external
              fragmentation. Flip on <span className="font-mono text-text-1">fixed blocks</span>{' '}
              and it becomes impossible — exactly why vLLM pages the KV cache in uniform 16-token
              blocks.
            </p>
          </>
        )
      }
    >
      <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-4 py-2">
        <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-text-3">
          machine
        </span>
        <button
          type="button"
          aria-pressed={mode === 'allocator'}
          onClick={() => selectMode('allocator')}
          className={cn(
            'rounded-sm border px-2.5 py-1 font-mono text-[11px] transition-colors duration-150',
            mode === 'allocator'
              ? 'border-accent/40 bg-accent/10 text-accent'
              : 'border-line bg-surface-2 text-text-2 hover:text-text-1',
          )}
        >
          Allocator
        </button>
        <button
          type="button"
          aria-pressed={mode === 'rust'}
          onClick={() => selectMode('rust')}
          className="rounded-sm border border-line bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-2 transition-colors duration-150 hover:text-text-1"
          style={
            mode === 'rust'
              ? { borderColor: '#FFB22466', backgroundColor: '#FFB22414', color: '#FFB224' }
              : undefined
          }
        >
          Rust
        </button>
      </div>
      {mode === 'rust' ? (
        <div className="min-h-0 flex-1">
          <RustLab initialTab={rustTab} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ------- stage ------- */}
          <div className="relative min-h-[380px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
            {/* fragmentation meter (top-right, always visible) */}
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
                <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                  heap 0x0000–0x03FF · 1024B · header {HEADER}B
                </span>
                {fixedMode && (
                  <span className="rounded-sm border border-[#22D3EE]/50 bg-[#22D3EE]/10 px-2 py-0.5 text-[#22D3EE]">
                    ≡ KV block manager — {HEAP_SIZE / fixedBlockSize} × {fixedBlockSize}B
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden font-mono text-[10px] text-text-3 sm:inline">
                  largest free / total free
                </span>
                <div className="flex gap-0.5" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-2.5 w-6 rounded-[2px] transition-colors duration-300"
                      style={{
                        backgroundColor:
                          fragPct > i * 33.4 ? meterColor : '#182130',
                      }}
                    />
                  ))}
                </div>
                <span className="font-mono text-xs" style={{ color: meterColor }}>
                  {fragPct}%
                </span>
              </div>
            </div>

            {/* heap rows */}
            <motion.div
              key={shakeKey}
              animate={shakeKey > 0 && !reducedMotion ? { x: [0, -4, 4, -3, 3, 0] } : { x: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-2"
              role="img"
              aria-label={`Heap: ${usedCount} allocated blocks, ${frag.totalFree} bytes free, largest free block ${frag.largest} bytes.`}
            >
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] text-text-3">
                    {hx4(row * ROW_BYTES)}
                  </span>
                  <div className="flex h-14 flex-1 overflow-hidden rounded-sm border border-line bg-surface-1">
                    {rowSegments(row).map((seg) => {
                      const b = seg.block
                      const widthPct = (seg.segLen / ROW_BYTES) * 100
                      const headerPct = seg.isHead ? (Math.min(HEADER, seg.segLen) / seg.segLen) * 100 : 0
                      const splinterPct =
                        !b.free && seg.isTail && b.splinter > 0
                          ? (b.splinter / seg.segLen) * 100
                          : 0
                      const wastePct =
                        !b.free && seg.isTail && fixedMode && fixedBlockSize - b.req > 0
                          ? ((fixedBlockSize - b.req) / seg.segLen) * 100
                          : 0
                      const isSplinterFree = b.free && b.size < MIN_SPLIT && !fixedMode
                      return (
                        <motion.button
                          key={b.free ? `f${b.start}` : `u${b.id}`}
                          type="button"
                          initial={
                            reducedMotion
                              ? false
                              : { opacity: 0, scaleX: 0.7 }
                          }
                          animate={{ opacity: 1, scaleX: 1 }}
                          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          onClick={() => {
                            if (!b.free) doFree(b.id)
                          }}
                          disabled={b.free}
                          title={`${hx4(b.start)} · ${b.size}B ${b.free ? 'free' : `used (${b.req}B payload)`}${b.splinter ? ` · ${b.splinter}B splinter` : ''}${b.free ? '' : ' — click to free'}`}
                          aria-label={`Block at ${hx4(b.start)}, ${b.size} bytes, ${b.free ? 'free' : 'allocated'}`}
                          className={cn(
                            'relative flex items-center justify-center overflow-hidden border-r border-ink/60 font-mono text-[9px] last:border-r-0',
                            b.free
                              ? isSplinterFree
                                ? 'text-amber'
                                : 'text-text-3'
                              : 'cursor-pointer text-accent-foreground hover:brightness-110',
                          )}
                          style={{
                            width: `${widthPct}%`,
                            backgroundColor: b.free
                              ? isSplinterFree
                                ? '#241B08'
                                : '#182130'
                              : fixedMode
                                ? 'rgba(34,211,238,0.45)'
                                : 'rgba(62,242,164,0.5)',
                            backgroundImage: isSplinterFree ? HATCH : undefined,
                            transition: 'width 300ms cubic-bezier(.16,1,.3,1)',
                          }}
                        >
                          {headerPct > 0 && !fixedMode && (
                            <span
                              className="absolute inset-y-0 left-0"
                              style={{
                                width: `${headerPct}%`,
                                backgroundColor: b.free ? '#0C1017' : 'rgba(6,37,26,0.65)',
                              }}
                              aria-hidden
                            />
                          )}
                          {(splinterPct > 0 || wastePct > 0) && (
                            <span
                              className="absolute inset-y-0 right-0"
                              style={{
                                width: `${splinterPct || wastePct}%`,
                                backgroundImage: HATCH,
                              }}
                              aria-hidden
                            />
                          )}
                          {widthPct > 8 && (
                            <span className="relative z-10 text-[#06251A] mix-blend-normal" style={{ color: b.free ? '#5D6B80' : '#06251A' }}>
                              {b.free ? `${b.size}` : b.req}
                            </span>
                          )}
                        </motion.button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </motion.div>

            {/* stats row */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['live bytes', `${liveBytes}B`],
                ['free bytes', `${frag.totalFree}B`],
                ['#blocks', String(blocks.length)],
                ['largest free', `${frag.largest}B`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-sm border border-line bg-surface-1 px-3 py-2">
                  <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                    {label}
                  </p>
                  <p className="mt-0.5 font-mono text-sm text-text-1">{value}</p>
                </div>
              ))}
            </div>

            {traceHistory.length > 0 && (
              <div className="mt-3 rounded-sm border border-line bg-surface-1 p-3">
                <div className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                  <span>
                    {traceSummary && fixedMode
                      ? 'fixed-block usability · trace'
                      : 'largest free / total free · trace'}
                  </span>
                  <span>
                    {traceSummary
                      ? `${traceSummary.failureSnapshots.length} failures · ${fixedMode ? '0% external' : `${Math.round(traceSummary.finalRatio * 100)}% final`}`
                      : 'policy overlay'}
                  </span>
                </div>
                <svg
                  viewBox="0 0 320 72"
                  className="h-20 w-full"
                  role="img"
                  aria-label={fixedMode ? 'Fixed-block usability over the selected trace' : 'Fragmentation ratio sparkline over the selected trace'}
                >
                  <path d="M0 18H320 M0 36H320 M0 54H320" stroke="#182130" strokeWidth="1" />
                  <polyline
                    fill="none"
                    stroke="#3EF2A4"
                    strokeWidth="2"
                    points={traceHistory
                      .map(
                        (value, index) =>
                          `${(index / Math.max(1, traceHistory.length - 1)) * 320},${68 - value * 64}`,
                      )
                      .join(' ')}
                  />
                </svg>
                {comparison && (
                  <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                    {(['first', 'next', 'best'] as Strategy[]).map((policy) => (
                      <div key={policy} className="rounded-sm bg-surface-2 p-2 text-text-2">
                        <span className="block text-text-3">{policy}-fit</span>
                        {Math.round(comparison[policy].finalRatio * 100)}% ·{' '}
                        {comparison[policy].failureSnapshots.length} fail
                      </div>
                    ))}
                  </div>
                )}
                {traceSummary && fixedMode && (
                  <p className="mt-2 font-mono text-[10px] text-[#22D3EE]">
                    external fragmentation 0B · usability 100% · internal waste{' '}
                    {traceSummary.internalWaste}B · metadata {traceSummary.metadata}B
                  </p>
                )}
                {traceSummary && traceSummary.failureSnapshots.length > 0 && (
                  <div className="mt-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                      allocation failures · state before failed request
                    </p>
                    <div className="mt-1 max-h-28 space-y-1 overflow-y-auto font-mono text-[10px]">
                      {traceSummary.failureSnapshots.map((failure) => (
                        <p
                          key={`${failure.operationIndex}-${failure.requestedSize}`}
                          className="rounded-sm bg-[#FF5C6C]/10 px-2 py-1 text-[#FF9BA5]"
                        >
                          op {failure.operationIndex}: request {failure.requestedSize}B · free{' '}
                          {failure.totalFreeBytes}B · largest {failure.largestFreeBlock}B
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ------- control panel ------- */}
          <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
            <ControlGroup label="malloc(size)">
              <div className="flex items-center gap-1.5">
                <input
                  value={mallocSize}
                  onChange={(e) => setMallocSize(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doMalloc(sizeVal)
                  }}
                  className="h-8 w-16 rounded-sm border border-line bg-surface-2 px-2 font-mono text-[12px] text-text-1 outline-none focus:border-accent"
                  aria-label="Allocation size in bytes"
                />
                <ChipButton onClick={() => doMalloc(sizeVal)}>malloc</ChipButton>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[16, 64, 256].map((n) => (
                  <ChipButton key={n} onClick={() => doMalloc(n)}>
                    {n}B
                  </ChipButton>
                ))}
                <ChipButton
                  onClick={() => doMalloc(WORK_SIZES[Math.floor(Math.random() * WORK_SIZES.length)])}
                >
                  random
                </ChipButton>
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                free(ptr): click any allocated block in the heap bar.
              </p>
            </ControlGroup>

            <ControlGroup label="policy">
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-text-2">placement strategy</p>
                <Select
                  value={strategy}
                  onValueChange={(v) => setStrategy(v as Strategy)}
                  disabled={fixedMode}
                >
                  <SelectTrigger className="h-8 border-line bg-surface-2 font-mono text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-line bg-surface-1">
                    <SelectItem value="first" className="font-mono text-[12px]">first-fit</SelectItem>
                    <SelectItem value="next" className="font-mono text-[12px]">next-fit</SelectItem>
                    <SelectItem value="best" className="font-mono text-[12px]">best-fit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                coalescing
                <Switch checked={coalesceOn} onCheckedChange={setCoalesceOn} disabled={fixedMode} />
              </label>
              <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-text-2">
                fixed blocks
                <Switch checked={fixedMode} onCheckedChange={toggleFixed} />
              </label>
              <div>
                <p className="mb-1.5 font-mono text-[11px] text-text-2">fixed block size</p>
                <div className="flex flex-wrap gap-1">
                  {FIXED_BLOCK_SIZES.map((size) => (
                    <ChipButton
                      key={size}
                      onClick={() => changeFixedBlockSize(size)}
                      active={fixedBlockSize === size}
                    >
                      {size}B
                    </ChipButton>
                  ))}
                </div>
              </div>
              <AnimatePresence>
                {fixedMode && (
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="rounded-sm border border-[#22D3EE]/40 bg-[#22D3EE]/10 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[#22D3EE]"
                  >
                    ≡ PagedAttention mode — uniform KV blocks; external fragmentation is
                    structurally 0%.
                  </motion.p>
                )}
              </AnimatePresence>
            </ControlGroup>

            <ControlGroup label="task scripts">
              <div className="flex flex-col gap-1.5">
                {SCRIPT_IDS.map((id) => (
                  <ChipButton
                    key={id}
                    onClick={() => loadScript(id)}
                    active={activeScript === id}
                    className="w-full text-left"
                  >
                    {SCRIPTS[id].label}
                  </ChipButton>
                ))}
              </div>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                {activeScript
                  ? `${queue ? queue.length : 0} of ${SCRIPTS[activeScript].ops.length} ops left. Step (→) or play to the end to read the result.`
                  : 'Load one, then step or play it to the end. A task asks you to predict that result first.'}
              </p>
            </ControlGroup>

            <ControlGroup label="stress & traces">
              <ChipButton onClick={startWorkload} className="flex w-full items-center justify-center gap-2">
                <Zap size={12} strokeWidth={1.75} /> live workload — 40 ops
              </ChipButton>
              <div className="grid grid-cols-2 gap-1.5">
                <ChipButton onClick={() => runLongTrace(true)}>alternating · 1K</ChipButton>
                <ChipButton onClick={() => runLongTrace(false)}>adversarial · 5K</ChipButton>
              </div>
              <ChipButton onClick={comparePolicies} className="w-full">
                compare same trace · all policies
              </ChipButton>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                Long presets execute deterministically and plot fragmentation. queue:{' '}
                {queue ? `${queue.length} ops left` : 'empty'}.
              </p>
            </ControlGroup>

            <ControlGroup label="unsafe inspector">
              <ChipButton onClick={runAliasDemo} className="w-full">
                double-free → allocate twice
              </ChipButton>
              {aliasOwners.length > 0 && (
                <div className="rounded-sm border border-[#FF5C6C]/50 bg-[#FF5C6C]/10 p-2 font-mono text-[10px] text-[#FF5C6C]">
                  {aliasOwners.map((owner) => (
                    <p key={owner}>{owner}</p>
                  ))}
                  <p className="mt-1 text-text-2">writes alias: two owners, one block</p>
                </div>
              )}
            </ControlGroup>

            <ControlGroup label="task · explain" className="border-b-0">
              <InlineQuiz
                question={`Why do fixed ${fixedBlockSize}B blocks trade internal for external fragmentation?`}
                options={[
                  `Every allocation rounds up to a whole block — waste moves inside the block (≤${fixedBlockSize - 1}B) instead of scattering unusable gaps between blocks.`,
                  'Fixed blocks are faster to search, so the allocator just ignores gaps.',
                  'The MMU forbids coalescing, so fragmentation is hidden rather than removed.',
                ]}
                correctIndex={0}
                onSolved={() => {
                  quizCorrectRef.current = true
                  if (fixedMode && traceSummary?.history.every((ratio) => ratio === 1)) {
                    awardQuizIfReady(fixedMode, traceSummary)
                  } else {
                    log(
                      ticksRef.current,
                      'OBSERVE',
                      'Correct — now run a fixed-block trace to verify the measurement before XP is logged.',
                      'warn',
                    )
                  }
                }}
              />
            </ControlGroup>
          </aside>
        </div>

        <TransportBar
          playing={playing}
          onTogglePlay={() => setPlaying((v) => !v)}
          onStep={applyWorkloadOp}
          onReset={reset}
          speed={speed}
          onSpeedChange={setSpeed}
          ticks={ticks}
          idle={!queue}
        />
        {!embed && <LogConsole lines={lines} onClear={clear} />}
      </div>
      )}
      </div>
    </PlaygroundShell>
  )
}
