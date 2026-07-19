/**
 * SIM-02 `sim-allocator` — Toy Allocator Playground (playground.md §5).
 * A 1024-byte heap: malloc/free with first/next/best-fit, split & coalesce,
 * fragmentation meter, and the fixed-64B-block PagedAttention mode
 * (`≡ KV block manager`) that trades internal for external fragmentation.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Zap } from 'lucide-react'
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
const FIXED_BLOCK = 64

const hx4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`

type Strategy = 'first' | 'next' | 'best'

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

const fixedHeap = (): HeapState => ({
  blocks: Array.from({ length: HEAP_SIZE / FIXED_BLOCK }, (_, i) => ({
    id: i,
    start: i * FIXED_BLOCK,
    size: FIXED_BLOCK,
    free: true,
    req: 0,
    splinter: 0,
  })),
  rover: 0,
  seq: HEAP_SIZE / FIXED_BLOCK,
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

type WorkOp = { type: 'malloc'; size: number } | { type: 'free' }

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

/* ------------------------------ URL config ------------------------------ */

interface AllocCfg {
  s: Strategy
  c: boolean
  f: boolean
  b: [number, number, number, number][] // start,size,free,req
}

function heapToCfg(h: HeapState, s: Strategy, c: boolean, f: boolean): AllocCfg {
  return { s, c, f, b: h.blocks.map((b) => [b.start, b.size, b.free ? 1 : 0, b.req]) }
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

  useWriteCfg(heapToCfg(heap, strategy, coalesceOn, fixedMode))

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
        if (idx === -1) {
          log(t, 'ALLOC', `${n}B ✗ ENOMEM — all 16 KV blocks in use`, 'err')
          setShakeKey((k) => k + 1)
          return
        }
        const blocks = heapRef.current.blocks.map((b, i) =>
          i === idx ? { ...b, free: false, req: n } : b,
        )
        setHeap({ ...heapRef.current, blocks })
        const waste = FIXED_BLOCK - n
        log(
          t,
          'ALLOC',
          `${n}B @ ${hx4(idx * FIXED_BLOCK)} (64B block${waste > 0 ? `, ${waste}B internal waste` : ''})`,
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
    [bump, fixedMode, log, setHeap, strategy],
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
  }, [doFreeRandom, doMalloc])

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
  }, [log])

  /* ----------------------------- task checks ----------------------------- */
  useEffect(() => {
    if (!fixedMode && frag.totalFree > 0 && frag.ratio < 0.25) {
      sawFragRef.current = true
      completeSimTask(SIM_ID, 't-frag', 60)
    }
    if (!fixedMode && coalesceOn && sawFragRef.current && frag.ratio > 0.75) {
      completeSimTask(SIM_ID, 't-coalesce', 60)
    }
    if (fixedMode && usedCount >= 8) {
      completeSimTask(SIM_ID, 't-paged', 60)
    }
  }, [frag.ratio, frag.totalFree, fixedMode, coalesceOn, usedCount])

  const reset = useCallback(() => {
    setHeap(fixedMode ? fixedHeap() : blankHeap())
    setQueue(null)
    setPlaying(false)
    ticksRef.current = 0
    setTicks(0)
    sawFragRef.current = false
    log(0, 'RESET', fixedMode ? 'heap re-issued as 16 × 64B KV blocks' : 'heap re-issued — one 1024B free block')
  }, [fixedMode, log, setHeap])

  const toggleFixed = useCallback(
    (on: boolean) => {
      setFixedMode(on)
      setQueue(null)
      setPlaying(false)
      setHeap(on ? fixedHeap() : blankHeap())
      log(
        ticksRef.current,
        'MODE',
        on
          ? 'fixed 64B blocks — ≡ KV block manager (no splits, no coalescing, no external frag)'
          : 'variable blocks — split & coalesce live',
        'warn',
      )
    },
    [log, setHeap],
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
      title="Toy Allocator"
      subtitle="free lists · split & coalesce · fragmentation"
      tasks={[
        { id: 't-frag', text: 'Fragment the heap below 25% (largest free / total free)', xp: 60 },
        { id: 't-coalesce', text: 'Enable coalescing and recover above 75%', xp: 60 },
        { id: 't-paged', text: 'In 64B-fixed mode, allocate 8+ blocks — 0 external fragmentation', xp: 60 },
        { id: 't-quiz', text: 'Explain why fixed blocks trade internal for external fragmentation', xp: 60 },
      ]}
      help={
        <>
          <p>
            A 1024-byte heap, drawn like a hex editor (4 rows × 256B). Every block pays an{' '}
            <span className="font-mono text-text-1">8B header</span> (the dark cap).{' '}
            <span className="font-mono text-text-1">malloc</span> walks the free list with your
            chosen strategy and splits blocks;{' '}
            <span className="font-mono text-text-1">free</span> returns them, optionally merging
            neighbors.
          </p>
          <p>
            The meter watches <span className="font-mono text-text-1">largest free ÷ total
            free</span> — when it craters, plenty of bytes exist but none are usable. That is
            external fragmentation. Flip on{' '}
            <span className="font-mono text-text-1">fixed 64B blocks</span> and it becomes
            impossible — exactly why vLLM pages the KV cache in uniform 16-token blocks.
          </p>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
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
                    ≡ KV block manager — 16 × 64B
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
                        !b.free && seg.isTail && fixedMode && FIXED_BLOCK - b.req > 0
                          ? ((FIXED_BLOCK - b.req) / seg.segLen) * 100
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
                fixed 64B blocks only
                <Switch checked={fixedMode} onCheckedChange={toggleFixed} />
              </label>
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

            <ControlGroup label="stress">
              <ChipButton onClick={startWorkload} className="flex w-full items-center justify-center gap-2">
                <Zap size={12} strokeWidth={1.75} /> auto workload — 40 ops
              </ChipButton>
              <p className="font-mono text-[10px] leading-relaxed text-text-3">
                injects mixed mallocs/frees at transport speed. queue:{' '}
                {queue ? `${queue.length} ops left` : 'empty'}.
              </p>
            </ControlGroup>

            <ControlGroup label="task · explain" className="border-b-0">
              <InlineQuiz
                question="Why do fixed 64B blocks trade internal for external fragmentation?"
                options={[
                  'Every allocation rounds up to a whole block — waste moves inside the block (≤63B) instead of scattering unusable gaps between blocks.',
                  'Fixed blocks are faster to search, so the allocator just ignores gaps.',
                  'The MMU forbids coalescing, so fragmentation is hidden rather than removed.',
                ]}
                correctIndex={0}
                onSolved={() => {
                  completeSimTask(SIM_ID, 't-quiz', 60)
                  log(
                    ticksRef.current,
                    'NOTE',
                    '≡ PagedAttention: 16-token blocks cap waste at <4% — internal, bounded, never external',
                    'ok',
                  )
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
    </PlaygroundShell>
  )
}
