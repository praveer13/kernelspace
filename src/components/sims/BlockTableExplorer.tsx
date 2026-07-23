/**
 * SIM-07x · Block-table explorer for PagedAttention (host sim-kv).
 *
 * A hands-on block manager: fixed-size physical blocks, per-sequence logical
 * block tables, refcounted prefix sharing, copy-on-write beam divergence,
 * preemption (swap vs recompute), and a block-size tradeoff sweep.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Copy,
  Cpu,
  Database,
  GitFork,
  Plus,
  RotateCcw,
} from 'lucide-react'
import {
  ChipButton,
  ControlGroup,
  LogConsole,
  SliderRow,
  completeSimTask,
  usePlaygroundContext,
  usePrefersReducedMotion,
  useSimLog,
} from '@/components/sims/PlaygroundShell'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const SIM_ID = 'sim-kv'

const BLOCK_SIZE = 16
const PROMPT_TOKENS = 48
const INITIAL_POOL = 10
const SWEEP_SIZES = [4, 8, 16, 32, 64]

const COLORS: Record<string, string> = {
  A: '#22D3EE',
  B: '#A78BFA',
  C: '#3EF2A4',
  D: '#FBBF24',
}

interface PhysicalBlock {
  id: number
  refcount: number
  seqs: string[]
  copiedFrom?: number
  copiedAt?: number
}

interface Sequence {
  id: string
  name: string
  color: string
  logicalBlocks: number[]
}

interface SimState {
  pool: PhysicalBlock[]
  seqs: Sequence[]
}

interface PreemptDialog {
  open: boolean
  needed: number
  victimId?: string
  mode?: 'swap' | 'recompute'
}

function createPhysicalPool(size: number): PhysicalBlock[] {
  return Array.from({ length: size }, (_, i) => ({
    id: i,
    refcount: 0,
    seqs: [],
  }))
}

function initialState(): SimState {
  const pool = createPhysicalPool(INITIAL_POOL)
  const logicalBlocks = [0, 1, 2]
  for (const pid of logicalBlocks) {
    pool[pid].refcount = 2
    pool[pid].seqs = ['A', 'B']
  }
  return {
    pool,
    seqs: [
      { id: 'A', name: 'seq A', color: COLORS.A, logicalBlocks: [...logicalBlocks] },
      { id: 'B', name: 'seq B', color: COLORS.B, logicalBlocks: [...logicalBlocks] },
    ],
  }
}

export default function BlockTableExplorer() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const [state, setState] = useState<SimState>(initialState)
  const [blockSize, setBlockSize] = useState<number>(16)
  const [poolSize, setPoolSize] = useState<number>(INITIAL_POOL)
  const [preempt, setPreempt] = useState<PreemptDialog>({ open: false, needed: 0 })
  const [sweepSeen, setSweepSeen] = useState<Set<number>>(new Set([16]))
  const [shareVerified, setShareVerified] = useState(false)
  const [exhaustedSeen, setExhaustedSeen] = useState(false)
  const [preemptResults, setPreemptResults] = useState<Partial<Record<'swap' | 'recompute', number>>>({})
  const tickRef = useRef(0)
  const [renderTick, setRenderTick] = useState(0)

  const { pool, seqs } = state

  const freeCount = useMemo(() => pool.filter((b) => b.refcount === 0).length, [pool])
  const uniqueBlocksPaid = useMemo(() => pool.filter((b) => b.refcount > 0).length, [pool])
  const totalLogicalBlocks = useMemo(
    () => seqs.reduce((sum, s) => sum + s.logicalBlocks.length, 0),
    [seqs],
  )

  /* ---------------- task detection ---------------- */
  useEffect(() => {
    if (shareVerified && pool.filter((b) => b.refcount === 2).length === 3 && uniqueBlocksPaid === 3) {
      completeSimTask(SIM_ID, 't-blk-share', 60)
    }
  }, [pool, shareVerified, uniqueBlocksPaid])


  useEffect(() => {
    if (exhaustedSeen && preemptResults.swap !== undefined && preemptResults.recompute !== undefined) {
      completeSimTask(SIM_ID, 't-blk-preempt', 60)
    }
  }, [exhaustedSeen, preemptResults])

  useEffect(() => {
    if (sweepSeen.has(4) && sweepSeen.has(16) && sweepSeen.has(64)) {
      completeSimTask(SIM_ID, 't-blk-sweep', 60)
    }
  }, [sweepSeen])

  /* ---------------- helpers ---------------- */
  const bump = useCallback(() => {
    tickRef.current += 1
    const nextTick = tickRef.current
    setRenderTick(nextTick)
    return nextTick
  }, [])

  const reset = useCallback(() => {
    setState(initialState())
    setBlockSize(16)
    setPoolSize(INITIAL_POOL)
    setPreempt({ open: false, needed: 0 })
    setSweepSeen(new Set([16]))
    tickRef.current = 0
    setRenderTick(0)
    clear()
    log(0, 'RESET', 'block-table explorer rebooted — 48-token prompt shared by seq A and B', 'op')
    setShareVerified(false)
  }, [clear, log])

  const resizePool = useCallback(
    (newSize: number) => {
      const t = bump()
      setPoolSize(newSize)
      setState((prev) => {
        if (newSize > prev.pool.length) {
          const added: PhysicalBlock[] = Array.from(
            { length: newSize - prev.pool.length },
            (_, i): PhysicalBlock => ({
              id: prev.pool.length + i,
              refcount: 0,
              seqs: [],
            }),
          )
          log(t, 'POOL', `grew physical pool to ${newSize} blocks`, 'op')
          return { ...prev, pool: [...prev.pool, ...added] }
        }
        if (newSize < prev.pool.length) {
          const kept = prev.pool.slice(0, newSize)
          const evicted = prev.pool.slice(newSize).filter((b) => b.refcount > 0)
          let nextSeqs = prev.seqs
          for (const b of evicted) {
            for (const sid of b.seqs) {
              nextSeqs = nextSeqs.map((sq: Sequence): Sequence =>
                sq.id === sid
                  ? { ...sq, logicalBlocks: sq.logicalBlocks.filter((pid) => pid !== b.id) }
                  : sq,
              )
            }
            log(t, 'EVICT', `physical block ${b.id} removed from pool (refcount ${b.refcount})`, 'warn')
          }
          log(t, 'POOL', `shrank physical pool to ${newSize} blocks`, 'warn')
          return { ...prev, pool: kept, seqs: nextSeqs }
        }
        return prev
      })
    },
    [bump, log],
  )

  const verifySharedPrompt = useCallback(() => {
    const sharedBlocks = pool.filter(
      (block) => block.refcount === 2 && block.seqs.includes('A') && block.seqs.includes('B'),
    )
    const paidOnce = sharedBlocks.length === 3 && uniqueBlocksPaid === 3
    setShareVerified(paidOnce)
    log(
      bump(),
      'SHARE',
      paidOnce
        ? 'A+B share 48 tokens in 3 physical blocks — rc=2, memory paid once'
        : 'shared-prefix invariant is not currently satisfied; reset A+B and inspect again',
      paidOnce ? 'ok' : 'err',
    )
  }, [bump, log, pool, uniqueBlocksPaid])

  /* ---------------- fork beam (prefix sharing) ---------------- */
  const forkBeam = useCallback(() => {
    const t = bump()
    setState((prev) => {
      if (prev.seqs.some((s) => s.id === 'C')) {
        log(t, 'FORK', 'beam C already exists', 'warn')
        return prev
      }
      const b = prev.seqs.find((s) => s.id === 'B')
      if (!b) return prev
      const nextPool = prev.pool.map((blk: PhysicalBlock): PhysicalBlock =>
        b.logicalBlocks.includes(blk.id)
          ? { ...blk, refcount: blk.refcount + 1, seqs: [...blk.seqs, 'C'] }
          : blk,
      )
      log(t, 'FORK', `beam C forked from B — prefix blocks share refcount`, 'ok')
      return {
        pool: nextPool,
        seqs: [...prev.seqs, { id: 'C', name: 'seq C', color: COLORS.C, logicalBlocks: [...b.logicalBlocks] }],
      }
    })
  }, [bump, log])

  /* ---------------- COW write on B ---------------- */
  const divergeB = useCallback(() => {
    const t = bump()
    setState((prev) => {
      if (!prev.seqs.some((s) => s.id === 'C')) {
        log(t, 'COW', 'fork beam C before diverging B so the shared full block is observable', 'warn')
        return prev
      }
      const b = prev.seqs.find((s) => s.id === 'B')
      if (!b) return prev
      const logicalIdx = 2
      const oldPid = b.logicalBlocks[logicalIdx]
      if (oldPid === undefined) return prev
      const oldBlk = prev.pool[oldPid]
      if (!oldBlk || oldBlk.refcount <= 1) {
        log(t, 'WRITE', `seq B writes logical block ${logicalIdx} → physical ${oldPid} (already private)`, 'op')
        return prev
      }
      const freeIdx = prev.pool.findIndex((blk) => blk.refcount === 0)
      if (prev.pool.filter((blk) => blk.refcount === 0).length === 1) {
        setExhaustedSeen(true)
      }
      if (freeIdx === -1) {
        log(t, 'COW', '✗ no free block for copy-on-write — memory pressure', 'err')
        return prev
      }
      const nextPool = prev.pool.map((blk) => {
        if (blk.id === oldPid) {
          return { ...blk, refcount: blk.refcount - 1, seqs: blk.seqs.filter((sid) => sid !== 'B') }
        }
        if (blk.id === freeIdx) {
          return { ...blk, refcount: 1, seqs: ['B'], copiedFrom: oldPid, copiedAt: t }
        }
        return blk
      })
      const nextSeqs = prev.seqs.map((s: Sequence): Sequence =>
        s.id === 'B'
          ? { ...s, logicalBlocks: s.logicalBlocks.map((pid, i) => (i === logicalIdx ? freeIdx : pid)) }
          : s,
      )
      log(
        t,
        'COW',
        `seq B writes shared logical block ${logicalIdx} — copied ${BLOCK_SIZE} tokens P${oldPid} → P${freeIdx}`,
        'ok',
      )
      completeSimTask(SIM_ID, 't-blk-cow', 60)
      return { pool: nextPool, seqs: nextSeqs }
    })
  }, [bump, log])

  /* ---------------- preemption ---------------- */
  const beginPreempt = useCallback(
    (needed: number) => {
      setPreempt({ open: true, needed })
      log(bump(), 'PREEMPT', `free queue exhausted — choose victim and policy`, 'warn')
    },
    [bump, log],
  )

  const resolvePreempt = useCallback(() => {
    const { victimId, mode, needed } = preempt
    if (!victimId || !mode) return
    const t = bump()

    setState((prev) => {
      const victim = prev.seqs.find((s) => s.id === victimId)
      if (!victim) return prev

      // free victim's exclusive references
      const nextPool = prev.pool.map((blk) => {
        if (!victim.logicalBlocks.includes(blk.id)) return blk
        const nextSeqs = blk.seqs.filter((sid) => sid !== victimId)
        const nextRef = blk.refcount - 1
        if (nextRef <= 0) {
          return { id: blk.id, refcount: 0, seqs: [] }
        }
        return { ...blk, refcount: nextRef, seqs: nextSeqs }
      })

      const freed = nextPool.filter((blk, i) => blk.refcount === 0 && prev.pool[i].refcount > 0).length
      log(
        t,
        'PREEMPT',
        `victim ${victimId}: ${mode === 'swap' ? 'swap to CPU DRAM' : 'recompute on demand'} — freed ${freed} block(s)`,
        mode === 'swap' ? 'ok' : 'warn',
      )

      // admit new request D
      const freeBlocks = nextPool.filter((b) => b.refcount === 0)
      if (freeBlocks.length < needed) {
        log(t, 'ALLOC', 'still not enough blocks after preemption', 'err')
        return { pool: nextPool, seqs: prev.seqs.filter((s) => s.id !== victimId) }
      }
      const taken = freeBlocks.slice(0, needed).map((b) => b.id)
      const admittedPool = nextPool.map((b: PhysicalBlock): PhysicalBlock =>
        taken.includes(b.id) ? { ...b, refcount: 1, seqs: ['D'] } : b,
      )
      if (admittedPool.every((block) => block.refcount > 0)) {
        setExhaustedSeen(true)
      }
      const admittedSeqs = prev.seqs
        .filter((s) => s.id !== victimId)
        .concat({ id: 'D', name: 'seq D', color: COLORS.D, logicalBlocks: taken })
      log(t + 1, 'ALLOC', `new request D admitted — ${needed} block(s)`, 'ok')
      const ttftMs = mode === 'swap' ? 42 : 118
      setPreemptResults((previous) => ({ ...previous, [mode]: ttftMs }))
      log(t + 2, 'TTFT', `${mode}: resumed request TTFT ${ttftMs} ms`, mode === 'swap' ? 'ok' : 'warn')
      setPreempt({ open: false, needed: 0 })
      return { pool: admittedPool, seqs: admittedSeqs }
    })
  }, [bump, log, preempt])

  const spawnPressure = useCallback(() => {
    const needed = 4 // 64-token prompt
    const available = pool.filter((b) => b.refcount === 0).length
    if (available === 0) setExhaustedSeen(true)
    if (available < needed) {
      beginPreempt(needed)
      return
    }
    const t = bump()
    const taken = pool.filter((b) => b.refcount === 0).slice(0, needed).map((b) => b.id)
    if (available === needed) setExhaustedSeen(true)
    setState((prev) => {
      if (prev.seqs.some((s) => s.id === 'D')) return prev
      const nextPool = prev.pool.map((b: PhysicalBlock): PhysicalBlock =>
        taken.includes(b.id) ? { ...b, refcount: 1, seqs: ['D'] } : b,
      )
      return {
        pool: nextPool,
        seqs: [...prev.seqs, { id: 'D', name: 'seq D', color: COLORS.D, logicalBlocks: taken }],
      }
    })
    log(t, 'ALLOC', `new request D admitted — ${needed} block(s) (free now ${available - needed})`, 'ok')
  }, [beginPreempt, bump, log, pool])

  /* ---------------- block-size sweep ---------------- */
  const sweepData = useMemo(() => {
    return SWEEP_SIZES.map((size) => {
      const entries = Math.ceil(PROMPT_TOKENS / size)
      const tail = PROMPT_TOKENS % size
      const tailWaste = tail === 0 ? 0 : size - tail
      const wastePct = (tailWaste / PROMPT_TOKENS) * 100
      const overheadBytes = entries * 8
      return { size, entries, tailWaste, wastePct, overheadBytes }
    })
  }, [])

  const currentSweep = sweepData.find((d) => d.size === blockSize) ?? sweepData[2]

  const onBlockSizeChange = useCallback(
    (idx: number) => {
      const size = SWEEP_SIZES[idx]
      setBlockSize(size)
      setSweepSeen((prev) => {
        const next = new Set(prev)
        next.add(size)
        return next
      })
      const data = sweepData.find((d) => d.size === size) ?? sweepData[2]
      const t = bump()
      log(t, 'SWEEP', `block size ${size} tokens — tail waste ${data.wastePct.toFixed(1)}% · ${data.entries} table entries`, 'op')
    },
    [bump, log, sweepData],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------- stage ------- */}
        <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
          {/* stats strip */}
          <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              block size {BLOCK_SIZE} tokens
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              pool {poolSize} blocks · free {freeCount}
            </span>
            <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
              logical blocks {totalLogicalBlocks} · unique physical {uniqueBlocksPaid}
            </span>
            <span
              className="rounded-sm border px-2 py-0.5"
              style={{ color: '#3EF2A4', borderColor: '#3EF2A455' }}
            >
              memory paid once for shared prefix
            </span>
          </div>

          {/* physical block pool */}
          <div className="mb-6">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
              physical block pool (HBM)
            </p>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-10">
              {pool.map((blk) => {
                const isFree = blk.refcount === 0
                const isCopied = blk.copiedAt !== undefined && renderTick - blk.copiedAt < 8
                return (
                  <motion.div
                    key={blk.id}
                    layout
                    initial={false}
                    animate={{
                      scale: isCopied && !reducedMotion ? [1, 1.08, 1] : 1,
                    }}
                    transition={{ duration: 0.35 }}
                    className="relative rounded-md border p-2"
                    style={{
                      borderColor: isFree ? '#334155' : '#5D6B80',
                      backgroundColor: isFree ? 'rgba(30,41,59,0.5)' : 'rgba(51,65,85,0.7)',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] text-text-2">P{blk.id}</span>
                      {!isFree && (
                        <span
                          className="rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                          style={{
                            color: blk.refcount > 1 ? '#3EF2A4' : '#E6EDF7',
                            backgroundColor: blk.refcount > 1 ? '#3EF2A422' : '#5D6B8022',
                          }}
                        >
                          rc={blk.refcount}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {blk.seqs.map((sid) => (
                        <span
                          key={sid}
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: COLORS[sid] ?? '#94A3B8' }}
                        />
                      ))}
                    </div>
                    {blk.copiedFrom !== undefined && (
                      <p className="mt-1 font-mono text-[8px] text-text-3">
                        copy of P{blk.copiedFrom}
                      </p>
                    )}
                  </motion.div>
                )
              })}
            </div>
          </div>

          {/* sequence block tables */}
          <div className="space-y-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
              per-sequence block tables
            </p>
            {seqs.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-md border border-line bg-surface-1 p-3"
              >
                <span
                  className="w-16 shrink-0 font-mono text-[11px] font-semibold"
                  style={{ color: s.color }}
                >
                  {s.name}
                </span>
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  {s.logicalBlocks.map((pid, li) => {
                    const blk = pool[pid]
                    const shared = blk ? blk.refcount > 1 : false
                    return (
                      <div
                        key={`${s.id}-${li}`}
                        className="flex items-center gap-1.5 rounded-sm border px-2 py-1"
                        style={{
                          borderColor: shared ? `${s.color}55` : '#334155',
                          backgroundColor: shared ? `${s.color}15` : 'rgba(30,41,59,0.5)',
                        }}
                      >
                        <span className="font-mono text-[9px] text-text-3">L{li}</span>
                        <ArrowRight size={10} className="text-text-3" />
                        <span
                          className="font-mono text-[11px]"
                          style={{ color: s.color }}
                        >
                          P{pid}
                        </span>
                        {shared && (
                          <span className="ml-1 font-mono text-[8px] text-[#3EF2A4]">shared</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {!embed && (
            <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
              two 48-token prompts map to the same three physical blocks. refcount tracks how many
              sequences share each block; a write to a shared block triggers copy-on-write, copying
              exactly one 16-token block to a free entry.
            </p>
          )}

          {/* preemption dialog */}
          <Dialog
            open={preempt.open}
            onOpenChange={(open) => {
              if (!open) setPreempt({ open: false, needed: 0 })
            }}
          >
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto bg-surface-1 p-4 sm:max-w-md sm:p-5">
              <DialogHeader className="text-left">
                <DialogTitle className="flex items-center gap-2 font-display text-[15px] font-semibold text-text-1">
                  <Cpu size={18} className="text-danger" />
                  free queue exhausted
                </DialogTitle>
                <DialogDescription className="font-mono text-[11px] leading-relaxed text-text-2">
                  a new request needs {preempt.needed} block(s) but only {freeCount} are free. pick
                  a victim sequence and a preemption policy.
                </DialogDescription>
              </DialogHeader>

              <fieldset className="space-y-2">
                <legend className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
                  victim sequence
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {seqs.map((s) => (
                    <label
                      key={s.id}
                      className="flex min-h-10 cursor-pointer items-center justify-center rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-text-2 transition-colors has-[:checked]:border-line-bright has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
                      style={
                        preempt.victimId === s.id
                          ? {
                              color: s.color,
                              borderColor: `${s.color}66`,
                              backgroundColor: `${s.color}14`,
                            }
                          : undefined
                      }
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="preemption-victim"
                        value={s.id}
                        checked={preempt.victimId === s.id}
                        onChange={() => setPreempt((p) => ({ ...p, victimId: s.id }))}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
                  policy
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['swap', 'swap to CPU', '#22D3EE'],
                    ['recompute', 'recompute', '#FBBF24'],
                  ] as const).map(([mode, label, color]) => (
                    <label
                      key={mode}
                      className="flex min-h-10 cursor-pointer items-center justify-center rounded-sm border border-line bg-surface-2 px-2.5 py-1.5 text-center font-mono text-[11px] text-text-2 transition-colors has-[:checked]:border-line-bright has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"
                      style={
                        preempt.mode === mode
                          ? {
                              color,
                              borderColor: `${color}66`,
                              backgroundColor: `${color}14`,
                            }
                          : undefined
                      }
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="preemption-policy"
                        value={mode}
                        checked={preempt.mode === mode}
                        onChange={() => setPreempt((p) => ({ ...p, mode }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <DialogFooter>
                <button
                  type="button"
                  onClick={() => setPreempt({ open: false, needed: 0 })}
                  className="min-h-10 rounded-md border border-line px-4 py-2 font-mono text-[11px] text-text-2 hover:text-text-1"
                >
                  cancel
                </button>
                <button
                  type="button"
                  disabled={!preempt.victimId || !preempt.mode}
                  onClick={resolvePreempt}
                  className="min-h-10 flex-1 rounded-md bg-accent px-4 py-2 font-display text-[14px] font-semibold text-accent-foreground disabled:opacity-40 sm:flex-none"
                >
                  preempt & admit
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* ------- control panel ------- */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[300px] lg:border-l lg:border-t-0">
          <ControlGroup label="prefix sharing">
            <button
              type="button"
              onClick={reset}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface-2 font-mono text-[11px] text-text-2 transition-colors hover:text-text-1"
            >
              <RotateCcw size={13} /> reset shared A+B prompt
            </button>
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <p className="font-mono text-[10px] text-text-2">
                A and B both map logical blocks 0–2 to physical blocks 0–2. check the pool grid:
                refcount should be 2 on each shared block.
              </p>
            </div>
            <button
              type="button"
              onClick={verifySharedPrompt}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[14px] font-semibold text-accent-foreground transition-all hover:-translate-y-px active:scale-[.98]"
            >
              verify 48-token sharing
            </button>
            {shareVerified && (
              <p className="font-mono text-[10px] text-accent">
                verified: 6 logical mappings use 3 physical blocks.
              </p>
            )}
          </ControlGroup>

          <ControlGroup label="beam fork + COW">
            <div className="flex flex-wrap gap-2">
              <ChipButton onClick={forkBeam} color={COLORS.C}>
                <GitFork size={12} className="mr-1" /> fork beam from B
              </ChipButton>
              <ChipButton onClick={divergeB} color={COLORS.B}>
                <Copy size={12} className="mr-1" /> diverge B at L2
              </ChipButton>
            </div>
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              forking creates beam C sharing B&apos;s blocks. diverging B at logical block 2 writes
              into shared physical memory and triggers a 16-token copy-on-write.
            </p>
          </ControlGroup>

          <ControlGroup label="memory pressure">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-text-2">
              <span className="flex items-center gap-1">
                <Database size={12} /> free queue
              </span>
              <span className={freeCount === 0 ? 'text-danger' : 'text-accent'}>{freeCount}</span>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <ChipButton onClick={spawnPressure} color="#FB7185">
                <Plus size={12} className="mr-1" /> spawn 64-token request
              </ChipButton>
            </div>
            <SliderRow
              label="pool size"
              value={poolSize}
              display={`${poolSize} blocks`}
              min={6}
              max={14}
              step={1}
              onChange={resizePool}
            />
            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              spawning a 64-token request needs 4 free blocks. if the free queue hits zero mid-way,
              the preemption dialog opens.
            </p>
            {(preemptResults.swap !== undefined || preemptResults.recompute !== undefined) && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-line bg-surface-2 p-2 font-mono text-[10px]">
                  <p className="text-text-3">swap TTFT</p>
                  <p className="text-cyan-300">{preemptResults.swap ?? '—'}{preemptResults.swap !== undefined ? ' ms' : ''}</p>
                </div>
                <div className="rounded-md border border-line bg-surface-2 p-2 font-mono text-[10px]">
                  <p className="text-text-3">recompute TTFT</p>
                  <p className="text-amber-300">{preemptResults.recompute ?? '—'}{preemptResults.recompute !== undefined ? ' ms' : ''}</p>
                </div>
              </div>
            )}
          </ControlGroup>

          <ControlGroup label="block-size sweep" className="border-b-0">
            <SliderRow
              label="block size"
              value={SWEEP_SIZES.indexOf(blockSize)}
              display={`${blockSize} tokens`}
              min={0}
              max={SWEEP_SIZES.length - 1}
              step={1}
              onChange={onBlockSizeChange}
            />
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-line bg-surface-2 p-2">
                <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                  tail waste
                </p>
                <p className="font-mono text-[16px]" style={{ color: '#FBBF24' }}>
                  {currentSweep.wastePct.toFixed(1)}%
                </p>
                <p className="font-mono text-[9px] text-text-3">{currentSweep.tailWaste} tokens</p>
              </div>
              <div className="rounded-md border border-line bg-surface-2 p-2">
                <p className="font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                  table entries
                </p>
                <p className="font-mono text-[16px]" style={{ color: '#22D3EE' }}>
                  {currentSweep.entries}
                </p>
                <p className="font-mono text-[9px] text-text-3">
                  {currentSweep.overheadBytes} B overhead
                </p>
              </div>
            </div>

            <div className="mt-2 space-y-1">
              {sweepData.map((d) => {
                const active = d.size === blockSize
                return (
                  <div
                    key={d.size}
                    className="flex items-center justify-between rounded-sm px-2 py-1 font-mono text-[10px]"
                    style={{
                      backgroundColor: active ? 'rgba(94,107,128,0.18)' : 'transparent',
                    }}
                  >
                    <span className={active ? 'text-text-1' : 'text-text-3'}>{d.size} tok</span>
                    <span className="text-text-3">waste {d.wastePct.toFixed(1)}%</span>
                    <span className="text-text-3">entries {d.entries}</span>
                  </div>
                )
              })}
            </div>

            <p className="font-mono text-[10px] leading-relaxed text-text-3">
              larger blocks amortize table-entry overhead but increase tail waste. 16 tokens is the
              vLLM default because it keeps both numbers small.
            </p>
          </ControlGroup>
        </aside>
      </div>

      {!embed && <LogConsole lines={lines} onClear={clear} />}
    </div>
  )
}
