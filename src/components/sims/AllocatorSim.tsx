/**
 * SIM-02 `sim-allocator` — Toy Allocator Playground (playground.md §5).
 * A 1024-byte heap: malloc/free with first/next/best-fit, split & coalesce,
 * fragmentation meter, configurable fixed-block PagedAttention mode, long-trace
 * policy comparison, and an unsafe double-free alias inspector.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Zap } from 'lucide-react'
import RustLab from '@/components/sims/RustLab'
import { RUST_LAB_TASKS } from '@/components/sims/rustLab.tasks'
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
import { cn } from '@/lib/utils'

const SIM_ID = 'sim-allocator'
const HEAP_SIZE = 1024
const HEADER = 8
const MIN_SPLIT = 24 // header + min payload
const ROW_BYTES = 256
const DEFAULT_FIXED_BLOCK = 64

const hx4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`

type Strategy = 'first' | 'next' | 'best'

type HostMode = 'allocator' | 'rust'

const ALLOCATOR_TASKS = [
  { id: 't-frag', text: 'Fragment the heap below 25% (largest free / total free)', xp: 60 },
  { id: 't-coalesce', text: 'Enable coalescing and recover above 75%', xp: 60 },
  { id: 't-paged', text: 'Observe a fixed-block trace report 0% external fragmentation', xp: 60 },
  { id: 't-quiz', text: 'Explain the observed internal-for-external fragmentation trade', xp: 60 },
  { id: 't-trace-lab', text: 'Run a long trace and compare placement policies', xp: 60 },
  { id: 't-double-free', text: 'Trigger the inspector double-free alias demonstration', xp: 60 },
]

interface Block {
  id: number
  start: number
  size: number // total bytes incl. header
  free: boolean
  req: number // requested payload (for internal-waste display)
  splinter: number // unsplittable tail given away with the block
}

interface HeapState {
  blocks: Block[]
  rover: number // next-fit cursor (index into blocks)
  seq: number // block id source
}

const blankHeap = (): HeapState => ({
  blocks: [{ id: 0, start: 0, size: HEAP_SIZE, free: true, req: 0, splinter: 0 }],
  rover: 0,
  seq: 1,
})

const fixedHeap = (blockSize: number): HeapState => ({
  blocks: Array.from({ length: HEAP_SIZE / blockSize }, (_, i) => ({
    id: i,
    start: i * blockSize,
    size: blockSize,
    free: true,
    req: 0,
    splinter: 0,
  })),
  rover: 0,
  seq: HEAP_SIZE / blockSize,
})

/* ------------------------- pure allocator engine ------------------------- */

function engineMalloc(
  st: HeapState,
  n: number,
  strategy: Strategy,
): { st: HeapState; ptr: Block | null; note: string } {
  const need = n + HEADER
  const blocks = st.blocks
  let idx = -1

  if (strategy === 'first') {
    idx = blocks.findIndex((b) => b.free && b.size >= need)
  } else if (strategy === 'best') {
    let bestSize = Infinity
    blocks.forEach((b, i) => {
      if (b.free && b.size >= need && b.size < bestSize) {
        bestSize = b.size
        idx = i
      }
    })
  } else {
    for (let k = 0; k < blocks.length; k += 1) {
      const i = (st.rover + k) % blocks.length
      if (blocks[i].free && blocks[i].size >= need) {
        idx = i
        break
      }
    }
  }

  if (idx === -1) return { st, ptr: null, note: '' }

  const chosen = blocks[idx]
  const remainder = chosen.size - need
  let next: Block[]
  let note = ''
  if (remainder >= MIN_SPLIT) {
    const alloc: Block = { id: st.seq, start: chosen.start, size: need, free: false, req: n, splinter: 0 }
    const rest: Block = { id: st.seq + 1, start: chosen.start + need, size: remainder, free: true, req: 0, splinter: 0 }
    next = [...blocks.slice(0, idx), alloc, rest, ...blocks.slice(idx + 1)]
    note = ` (split ${chosen.size}→${n}+${remainder})`
    return { st: { blocks: next, rover: idx + 1, seq: st.seq + 2 }, ptr: alloc, note }
  }
  const alloc: Block = { ...chosen, free: false, req: n, splinter: remainder, id: st.seq }
  next = [...blocks.slice(0, idx), alloc, ...blocks.slice(idx + 1)]
  if (remainder > 0) note = ` (+${remainder}B splinter burned)`
  return { st: { blocks: next, rover: idx, seq: st.seq + 1 }, ptr: alloc, note }
}

function engineFree(
  st: HeapState,
  id: number,
  coalesce: boolean,
): { st: HeapState; addr: number; note: string } {
  const idx = st.blocks.findIndex((b) => b.id === id)
  if (idx === -1) return { st, addr: -1, note: '' }
  const addr = st.blocks[idx].start
  let blocks = st.blocks.map((b, i) =>
    i === idx ? { ...b, free: true, req: 0, splinter: 0 } : b,
  )
  const notes: string[] = []
  if (coalesce) {
    // merge forward then backward
    if (idx + 1 < blocks.length && blocks[idx + 1].free) {
      const merged = blocks[idx].size + blocks[idx + 1].size
      notes.push(`COALESCE ${hx4(blocks[idx].start)}+${hx4(blocks[idx + 1].start)} → ${merged}B`)
      blocks = [
        ...blocks.slice(0, idx),
        { ...blocks[idx], size: merged },
        ...blocks.slice(idx + 2),
      ]
    }
    if (idx - 1 >= 0 && blocks[idx - 1].free) {
      const merged = blocks[idx - 1].size + blocks[idx].size
      notes.push(`COALESCE ${hx4(blocks[idx - 1].start)}+${hx4(blocks[idx].start)} → ${merged}B`)
      blocks = [
        ...blocks.slice(0, idx - 1),
        { ...blocks[idx - 1], size: merged },
        ...blocks.slice(idx + 1),
      ]
    }
  }
  return { st: { blocks, rover: Math.min(st.rover, blocks.length - 1), seq: st.seq }, addr, note: notes.join(' · ') }
}

function fragmentation(blocks: Block[]): { totalFree: number; largest: number; ratio: number } {
  const freeBlocks = blocks.filter((b) => b.free)
  const totalFree = freeBlocks.reduce((s, b) => s + b.size, 0)
  const largest = freeBlocks.reduce((m, b) => Math.max(m, b.size), 0)
  return { totalFree, largest, ratio: totalFree > 0 ? largest / totalFree : 1 }
}

/* ------------------------------ workload ------------------------------ */

type WorkOp = { type: 'malloc'; size: number } | { type: 'free'; slot?: number }

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const WORK_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256]

function genWorkload(seed: number): WorkOp[] {
  const rng = mulberry32(seed)
  return Array.from({ length: 40 }, () =>
    rng() < 0.6
      ? ({ type: 'malloc', size: WORK_SIZES[Math.floor(rng() * WORK_SIZES.length)] } as WorkOp)
      : ({ type: 'free' } as WorkOp),
  )
}

type AllocationFailureSnapshot = {
  operationIndex: number
  requestedSize: number
  totalFreeBytes: number
  largestFreeBlock: number
}

type TraceResult = {
  history: number[]
  failureSnapshots: AllocationFailureSnapshot[]
  finalRatio: number
  internalWaste: number
  metadata: number
}

function makeTrace(length: number, seed: number, alternating: boolean): WorkOp[] {
  const rng = mulberry32(seed)
  let live = 0
  return Array.from({ length }, (_, i) => {
    if (live > 2 && (i % 5 === 4 || rng() < 0.34)) {
      const slot = Math.floor(rng() * live)
      live -= 1
      return { type: 'free', slot }
    }
    live += 1
    const size = alternating ? (i % 2 === 0 ? 24 : 96) : WORK_SIZES[Math.floor(rng() * WORK_SIZES.length)]
    return { type: 'malloc', size }
  })
}

function simulateTrace(
  trace: WorkOp[],
  strategy: Strategy,
  fixedBlockSize: number | null,
): TraceResult {
  let state = fixedBlockSize ? fixedHeap(fixedBlockSize) : blankHeap()
  let liveIds: number[] = []
  const failureSnapshots: AllocationFailureSnapshot[] = []
  const history: number[] = []
  const sampleEvery = Math.max(1, Math.floor(trace.length / 80))

  const recordFailure = (operationIndex: number, requestedSize: number) => {
    const free = fragmentation(state.blocks)
    failureSnapshots.push({
      operationIndex,
      requestedSize,
      totalFreeBytes: free.totalFree,
      largestFreeBlock: free.largest,
    })
  }

  trace.forEach((op, index) => {
    if (op.type === 'free') {
      if (liveIds.length > 0) {
        const liveIndex = (op.slot ?? 0) % liveIds.length
        const id = liveIds[liveIndex]
        liveIds = liveIds.filter((_, i) => i !== liveIndex)
        state = engineFree(state, id, !fixedBlockSize).st
      }
    } else if (fixedBlockSize) {
      const freeIndex = state.blocks.findIndex((block) => block.free)
      if (freeIndex === -1 || op.size > fixedBlockSize) {
        recordFailure(index + 1, op.size)
      } else {
        const id = state.blocks[freeIndex].id
        state = {
          ...state,
          blocks: state.blocks.map((block, i) =>
            i === freeIndex ? { ...block, free: false, req: op.size } : block,
          ),
        }
        liveIds.push(id)
      }
    } else {
      const result = engineMalloc(state, op.size, strategy)
      state = result.st
      if (result.ptr) liveIds.push(result.ptr.id)
      else recordFailure(index + 1, op.size)
    }
    if (index % sampleEvery === 0 || index === trace.length - 1) {
      history.push(fixedBlockSize ? 1 : fragmentation(state.blocks).ratio)
    }
  })

  const final = fragmentation(state.blocks)
  const internalWaste = fixedBlockSize
    ? state.blocks.reduce(
        (waste, block) => waste + (block.free ? 0 : fixedBlockSize - block.req),
        0,
      )
    : 0
  return {
    history,
    failureSnapshots,
    finalRatio: fixedBlockSize ? 1 : final.ratio,
    internalWaste,
    metadata: state.blocks.length * HEADER,
  }
}

/* ------------------------------ URL config ------------------------------ */

interface AllocCfg {
  s: Strategy
  c: boolean
  f: boolean
  b: [number, number, number, number][] // start,size,free,req
  z?: number
}

function heapToCfg(h: HeapState, s: Strategy, c: boolean, f: boolean, z: number): AllocCfg {
  return { s, c, f, z, b: h.blocks.map((b) => [b.start, b.size, b.free ? 1 : 0, b.req]) }
}

function cfgToHeap(cfg: AllocCfg | null): HeapState | null {
  if (!cfg?.b?.length) return null
  try {
    return {
      blocks: cfg.b.map(([start, size, free, req], i) => ({
        id: i,
        start,
        size,
        free: free === 1,
        req,
        splinter: 0,
      })),
      rover: 0,
      seq: cfg.b.length,
    }
  } catch {
    return null
  }
}

export default function AllocatorSim() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()
  const [searchParams, setSearchParams] = useSearchParams()
  const machine = searchParams.get('machine')
  const from = searchParams.get('from')
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
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('machine', nextMode === 'allocator' ? 'allocator' : `rust-${rustTab}`)
        return next
      },
      { replace: true },
    )
  }

  const initialCfg = useInitialCfg<AllocCfg>()
  const [heap, setHeapState] = useState<HeapState>(() => cfgToHeap(initialCfg) ?? blankHeap())
  const heapRef = useRef<HeapState>(heap)
  const setHeap = useCallback((next: HeapState) => {
    heapRef.current = next
    setHeapState(next)
  }, [])

  const [strategy, setStrategy] = useState<Strategy>(initialCfg?.s ?? 'first')
  const [coalesceOn, setCoalesceOn] = useState<boolean>(initialCfg?.c ?? true)
  const [fixedMode, setFixedMode] = useState<boolean>(initialCfg?.f ?? false)
  const [fixedBlockSize, setFixedBlockSize] = useState(initialCfg?.z ?? DEFAULT_FIXED_BLOCK)
  const [traceHistory, setTraceHistory] = useState<number[]>([])
  const [traceSummary, setTraceSummary] = useState<TraceResult | null>(null)
  const [comparison, setComparison] = useState<Record<Strategy, TraceResult> | null>(null)
  const [aliasOwners, setAliasOwners] = useState<string[]>([])
  const [mallocSize, setMallocSize] = useState('64')
  const [queue, setQueue] = useState<WorkOp[] | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [shakeKey, setShakeKey] = useState(0)

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

  useWriteCfg(heapToCfg(heap, strategy, coalesceOn, fixedMode, fixedBlockSize))

  const frag = fragmentation(heap.blocks)
  const fragPct = Math.round(frag.ratio * 100)
  const liveBytes = heap.blocks.filter((b) => !b.free).reduce((s, b) => s + b.size, 0)
  const usedCount = heap.blocks.filter((b) => !b.free).length

  /* ------------------------------ ops ------------------------------ */
  const doMalloc = useCallback(
    (n: number) => {
      const t = bump()
      if (fixedMode) {
        const idx = heapRef.current.blocks.findIndex((b) => b.free)
        if (idx === -1 || n > fixedBlockSize) {
          const reason =
            n > fixedBlockSize
              ? `request exceeds ${fixedBlockSize}B block`
              : `all ${HEAP_SIZE / fixedBlockSize} KV blocks in use`
          log(t, 'ALLOC', `${n}B ✗ ENOMEM — ${reason}`, 'err')
          setShakeKey((k) => k + 1)
          return
        }
        const blocks = heapRef.current.blocks.map((b, i) =>
          i === idx ? { ...b, free: false, req: n } : b,
        )
        setHeap({ ...heapRef.current, blocks })
        const waste = fixedBlockSize - n
        log(
          t,
          'ALLOC',
          `${n}B @ ${hx4(idx * fixedBlockSize)} (${fixedBlockSize}B block${waste > 0 ? `, ${waste}B internal waste` : ''})`,
          'ok',
        )
        return
      }
      const { st, ptr, note } = engineMalloc(heapRef.current, n, strategy)
      if (!ptr) {
        const { largest } = fragmentation(heapRef.current.blocks)
        log(t, 'ALLOC', `${n}B ✗ ENOMEM — no block big enough (largest free ${largest}B)`, 'err')
        setShakeKey((k) => k + 1)
        return
      }
      setHeap(st)
      log(t, 'ALLOC', `${n}B @ ${hx4(ptr.start)}${note} ✓`, 'ok')
    },
    [bump, fixedBlockSize, fixedMode, log, setHeap, strategy],
  )

  const doFree = useCallback(
    (id: number) => {
      const t = bump()
      const { st, addr, note } = engineFree(heapRef.current, id, coalesceOn && !fixedMode)
      if (addr === -1) return
      setHeap(st)
      log(t, 'FREE', `${hx4(addr)} released${note ? ` · ${note}` : ''}`)
    },
    [bump, coalesceOn, fixedMode, log, setHeap],
  )

  const doFreeRandom = useCallback(() => {
    const used = heapRef.current.blocks.filter((b) => !b.free)
    if (used.length === 0) {
      log(ticksRef.current, 'FREE', '✗ nothing allocated — skipped', 'warn')
      return
    }
    const pick = used[Math.floor(Math.random() * used.length)]
    doFree(pick.id)
  }, [doFree, log])

  /* ---------------------------- workload ---------------------------- */
  const applyWorkloadOp = useCallback(() => {
    setQueue((cur) => {
      if (!cur || cur.length === 0) {
        setPlaying(false)
        return cur
      }
      const [op, ...rest] = cur
      if (op.type === 'malloc') doMalloc(op.size)
      else doFreeRandom()
      return rest.length > 0 ? rest : null
    })
  }, [doFreeRandom, doMalloc, setPlaying, setQueue])

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
    setQueue(genWorkload(seed))
    setPlaying(true)
    log(ticksRef.current, 'WORK', `auto workload — 40 mixed ops (seed ${seed.toString(16)})`, 'warn')
  }, [log, setPlaying, setQueue])

  const runLongTrace = useCallback(
    (length: number, alternating: boolean) => {
      const trace = makeTrace(length, alternating ? 0xa11e : 0xc0ffee, alternating)
      const result = simulateTrace(trace, strategy, fixedMode ? fixedBlockSize : null)
      lastTraceRef.current = trace
      setTraceHistory(result.history)
      setTraceSummary(result)
      setComparison(null)
      log(
        bump(),
        'TRACE',
        `${length} ops · ${result.failureSnapshots.length} failed · final usability ${Math.round(result.finalRatio * 100)}%`,
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
    const trace = selectedTrace ?? makeTrace(1000, 0xa11e, true)
    const results: Record<Strategy, TraceResult> = {
      first: simulateTrace(trace, 'first', null),
      next: simulateTrace(trace, 'next', null),
      best: simulateTrace(trace, 'best', null),
    }
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

  const reset = useCallback(() => {
    setHeap(fixedMode ? fixedHeap(fixedBlockSize) : blankHeap())
    setQueue(null)
    setPlaying(false)
    setTraceHistory([])
    setTraceSummary(null)
    setComparison(null)
    setAliasOwners([])
    ticksRef.current = 0
    setTicks(0)
    sawFragRef.current = false
    log(
      0,
      'RESET',
      fixedMode
        ? `heap re-issued as ${HEAP_SIZE / fixedBlockSize} × ${fixedBlockSize}B KV blocks`
        : 'heap re-issued — one 1024B free block',
    )
  }, [
    fixedBlockSize,
    fixedMode,
    log,
    setAliasOwners,
    setComparison,
    setHeap,
    setPlaying,
    setQueue,
    setTicks,
    setTraceHistory,
    setTraceSummary,
  ])

  const toggleFixed = useCallback(
    (on: boolean) => {
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
    [fixedBlockSize, log, setFixedMode, setHeap, setPlaying, setQueue],
  )

  const changeFixedBlockSize = useCallback(
    (size: number) => {
      setFixedBlockSize(size)
      if (fixedMode) setHeap(fixedHeap(size))
      setTraceHistory([])
      setTraceSummary(null)
      log(ticksRef.current, 'BLOCK', `${size}B fixed blocks · ${HEAP_SIZE / size} entries`, 'warn')
    },
    [fixedMode, log, setFixedBlockSize, setHeap, setTraceHistory, setTraceSummary],
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
    for (const b of heap.blocks) {
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
                          key={b.id}
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
                ['#blocks', String(heap.blocks.length)],
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
                  {[16, 32, 64, 128, 256].map((size) => (
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

            <ControlGroup label="stress & traces">
              <ChipButton onClick={startWorkload} className="flex w-full items-center justify-center gap-2">
                <Zap size={12} strokeWidth={1.75} /> live workload — 40 ops
              </ChipButton>
              <div className="grid grid-cols-2 gap-1.5">
                <ChipButton onClick={() => runLongTrace(1000, true)}>alternating · 1K</ChipButton>
                <ChipButton onClick={() => runLongTrace(5000, false)}>adversarial · 5K</ChipButton>
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
