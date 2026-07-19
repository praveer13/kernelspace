/**
 * GLOSSARY — /glossary (glossary.md).
 * The isomorphism library: 24 OS ≡ LLM flip-card pairs, fuzzy search,
 * track filters, auto-cycling hero translation card, #anchor deep links.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion'
import Fuse from 'fuse.js'
import { ArrowLeftRight, ArrowRight, RotateCw, Search } from 'lucide-react'
import { TRACKS } from '@/lib/tracks'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* The 24 pairs (glossary.md §3 — content source of truth)             */
/* ------------------------------------------------------------------ */

interface Pair {
  slug: string
  os: string
  osDef: string
  llm: string
  llmDef: string
  why: string
  taught: string
  /** lesson deep link, e.g. `t2.l2` */
  lesson: string
  tracks: string[]
  formula?: string
  syn: string[]
}

const P = (
  slug: string,
  os: string,
  osDef: string,
  llm: string,
  llmDef: string,
  why: string,
  taught: string,
  lesson: string,
  tracks: string[],
  syn: string[],
  formula?: string,
): Pair => ({ slug, os, osDef, llm, llmDef, why, taught, lesson, tracks, syn, formula })

const PAIRS: Pair[] = [
  P('page', 'Page', 'Fixed-size chunk of virtual memory (4 KB).', 'KV token block (16 tok)', 'Fixed-size chunk of a sequence\u2019s KV cache.', 'Both turn variable-length memory demand into uniform allocation units — the unit size trades a little internal waste for zero external fragmentation.', 'T2.L2 → T5.L5', 't2.l2', ['t2', 't5'], ['block', 'chunk', 'memory unit']),
  P('page-table', 'Page table', 'Per-process map: virtual page → physical frame.', 'Block table', 'Per-sequence map: logical KV block → physical HBM block.', 'PagedAttention is demand paging: the block table is the page table, and every decode step is an address translation.', 'T2.L2 → T5.L5', 't5.l5', ['t2', 't5'], ['pagedattention', 'vllm', 'address translation'], 'logical → physical'),
  P('tlb', 'TLB', 'Tiny cache of recent page-table entries.', 'Block-table lookup cache', 'Hot path that keeps block lookups off the critical path.', 'Translation is on every access, so both systems cache the translation itself — a hit costs ~1 cycle, a miss costs a walk.', 'T2.L2 → T5.L5', 't2.l2', ['t2', 't5'], ['translation lookaside buffer', 'cache']),
  P('page-fault', 'Page fault', 'Access to a non-resident page traps to the OS.', 'KV block miss + fetch', 'A needed block is not in HBM — fetch or recompute it.', 'The trap is expensive but invisible to the caller; both systems hide the fetch behind a fault handler and resume.', 'T2.L2', 't2.l2', ['t2'], ['fault', 'miss', 'trap']),
  P('swap', 'Swap space', 'Disk backing store for evicted pages.', 'KV cache offload to CPU DRAM', 'Cold KV blocks spilled out of HBM.', 'When the fast tier fills, both push cold state to a slower tier and pay bandwidth to get it back — capacity beats recompute until it doesn\u2019t.', 'T2.L3 → T5.L5', 't2.l3', ['t2', 't5'], ['offload', 'spill', 'disk', 'dram']),
  P('eviction-lru', 'Eviction (LRU)', 'Drop the least-recently-used page under pressure.', 'KV prefix eviction / recompute', 'Drop cold prefixes; recompute on demand.', 'LRU is a bet that past use predicts future use; when it\u2019s wrong, both systems thrash — re-fetching what they just dropped.', 'T2.L3', 't2.l3', ['t2'], ['lru', 'thrashing', 'replacement']),
  P('copy-on-write', 'Copy-on-write', 'Shared pages, copied only on mutation.', 'Prefix sharing across sequences', 'Shared prompt blocks, refcounted across requests.', 'Fork and parallel sampling are the same trick: share the read-only prefix, branch lazily, pay for memory only at divergence.', 'T2.L2 → T5.L5', 't5.l5', ['t2', 't5'], ['cow', 'fork', 'prefix', 'sharing', 'beam']),
  P('malloc', 'malloc / free list', 'General-purpose heap allocator.', 'KV block allocator (vLLM)', 'Free-list allocator over fixed KV blocks.', 'You built this in T1: a free list, alloc/free in O(1), no compaction — because the blocks are uniform, the allocator never fragments.', 'T1.L3', 't1.l3', ['t1'], ['allocator', 'heap', 'free list', 'vllm']),
  P('external-fragmentation', 'External fragmentation', 'Free memory stranded in unusably small holes.', 'Reserved-context waste in naive KV', 'HBM stranded in worst-case reservations.', 'Reserving max-context per request strands 60–80% of HBM — the same death as a fragmented heap, just measured in gigabytes.', 'T1.L4 → T5.L5', 't1.l4', ['t1', 't5'], ['fragmentation', 'waste', 'reservation']),
  P('fixed-size-pages', 'Fixed-size pages', 'Uniform pages: some internal waste, no holes.', 'Fixed token blocks (<4% waste)', 'Uniform 16-token blocks cap waste at the tail.', 'Internal fragmentation is bounded and cheap; external fragmentation is unbounded and fatal. Both systems choose the bounded evil.', 'T1.L4 → T5.L5', 't5.l5', ['t1', 't5'], ['internal fragmentation', 'uniform', 'block size']),
  P('process', 'Process', 'An address space + resources under one identity.', 'Request / sequence', 'A prompt, its KV state, and its stream.', 'The unit of ownership: each gets isolated state, an id, and a lifecycle the scheduler manages independently.', 'T2.L1', 't2.l1', ['t2'], ['request', 'sequence', 'isolation']),
  P('thread', 'Thread', 'Independent execution within a process.', 'Sequence in a batch', 'Independent generation within an engine step.', 'Threads share an address space; batched sequences share the GPU\u2019s weights — parallel work amortizing one big resource.', 'T2.L1', 't2.l1', ['t2'], ['sequence', 'parallel', 'batch']),
  P('context-switch', 'Context switch', 'Save/restore state to run another process.', 'Iteration-level preemption', 'Swap a sequence\u2019s KV out mid-generation.', 'Both pause work to keep the machine fair and full — and both pay for it in state movement, so both minimize how often it happens.', 'T2.L1 → T5.L6', 't5.l6', ['t2', 't5'], ['preemption', 'swap', 'scheduling']),
  P('scheduler', 'Scheduler / runqueue', 'Picks who runs next, every tick.', 'Continuous batcher', 'Admits and evicts sequences every iteration.', 'The runqueue is the batch: admission at iteration boundaries keeps the GPU exactly as full as the ready queue allows.', 'T2.L4 → T5.L6', 't5.l6', ['t2', 't5'], ['continuous batching', 'runqueue', 'orca', 'vllm']),
  P('admission-control', 'Admission control', 'Refuse work the system can\u2019t serve well.', 'Max-batch / max-tokens gating', 'Cap batch size and total KV tokens.', 'Saying no early is how both protect latency SLOs — overload admitted is throughput lost, not gained.', 'T2.L4 → T5.L6', 't5.l6', ['t2', 't5'], ['max batch', 'overload', 'slo', 'backpressure']),
  P('priority-inversion', 'Priority inversion', 'A low-priority task blocks a high-priority one.', 'Long-prompt head-of-line blocking', 'One giant prefill stalls every decode behind it.', 'An unbounded work unit starves everyone queued behind it; the fix in both worlds is to bound or split the unit.', 'T2.L4 → T5.L7', 't2.l4', ['t2', 't5'], ['head of line', 'hol blocking', 'starvation', 'prefill']),
  P('time-slicing', 'Time-slicing', 'Bound a task\u2019s run so others get the CPU.', 'Chunked prefill (SARATHI)', 'Split prefill into fixed-size chunks.', 'Long prefills are sliced so decode steps interleave every iteration — exactly the quantum a preemptive scheduler enforces.', 'T2.L4 → T5.L7', 't5.l7', ['t2', 't5'], ['sarathi', 'chunked prefill', 'quantum', 'fairness']),
  P('mutex-atomics', 'Mutex / atomics', 'Serialize access to shared state.', 'Kernel reductions & stream sync', 'Serialize GPU work where order matters.', 'Some operations must be atomic to be correct — but every serialization point is a stall, so both design to minimize shared state.', 'T2.L5 → T4', 't2.l5', ['t2', 't4'], ['lock', 'atomic', 'sync', 'reduction', 'barrier']),
  P('lock-free-queue', 'Lock-free queue', 'Wait-free handoff between producers/consumers.', 'Dynamo\u2019s Rust message plane (NATS)', 'Lock-free handoff between prefill and decode workers.', 'Disaggregated serving moves tokens between processes, not threads — the same lock-free discipline, one address space wider.', 'T2.L5 → T3.L6', 't2.l5', ['t2', 't3'], ['nats', 'dynamo', 'mpmc', 'ring buffer', 'rust']),
  P('epoll', 'epoll / io_uring', 'One thread, ten thousand ready sockets.', 'Async token streaming backpressure', 'One server, ten thousand open token streams.', 'Scale by reacting to readiness, not by polling: SSE token streams are just another event loop with a slow consumer at the end.', 'T2.L6 → T3.L6', 't2.l6', ['t2', 't3'], ['async', 'io', 'sse', 'streaming', 'event loop']),
  P('cache-line', 'Cache line (64B)', 'Memory moves in 64-byte bursts, not bytes.', 'Coalesced HBM access / tiling', 'HBM moves in wide bursts, not scalars.', 'The hardware fetches a neighborhood whether you want it or not — layouts that match the burst get the bytes for free.', 'T0.L4 → T4.L6', 't0.l4', ['t0', 't4'], ['coalescing', 'hbm', 'burst', 'bandwidth']),
  P('cache-blocking', 'Cache blocking', 'Tile loops so working data stays in cache.', 'FlashAttention tiling', 'Tile attention so blocks stay in SRAM.', 'FlashAttention is a loop-tiling optimization: keep Q/K/V tiles on-chip, never materialize the N×N matrix in HBM.', 'T0.L3 → T4.L6', 't4.l6', ['t0', 't4'], ['flashattention', 'tiling', 'sram', 'locality']),
  P('gc-pause', 'GC pause', 'The world stops while the heap is walked.', 'Synchronous host↔device copies', 'The stream stalls while bytes cross PCIe.', 'Both are stop-the-world taxes for moving memory — the fix is the same too: do it less, do it in bulk, do it off the critical path.', 'T0.L5 → T5.L3', 't0.l5', ['t0', 't5'], ['pcie', 'stall', 'copy', 'latency']),
  P('jit-warmup', 'JIT warmup', 'Slow first runs while the compiler learns.', 'CUDA graph capture / warmup', 'Slow first runs while kernels are captured.', 'Peak throughput is earned after a warmup phase — record the work once, then replay it at machine speed forever.', 'T0.L5 → T5.L9', 't0.l5', ['t0', 't5'], ['cuda graph', 'compile', 'warmup', 'replay']),
]

/* ------------------------------------------------------------------ */
/* Hero translation card (auto-cycles 3 flagship pairs, 6s)            */
/* ------------------------------------------------------------------ */

interface Flagship {
  osTitle: string
  osEra: string
  llmTitle: string
  llmEra: string
  rows: [string, string][]
}

const FLAGSHIPS: Flagship[] = [
  {
    osTitle: 'virtual memory',
    osEra: 'OS · 1970s',
    llmTitle: 'PagedAttention',
    llmEra: 'LLM SERVING · 2023',
    rows: [
      ['page', 'token block'],
      ['page table', 'block table'],
      ['page fault', 'cache miss + fetch'],
    ],
  },
  {
    osTitle: 'process scheduler',
    osEra: 'OS · 1962',
    llmTitle: 'continuous batcher',
    llmEra: 'LLM SERVING · 2022',
    rows: [
      ['process', 'request'],
      ['context switch', 'iteration preemption'],
      ['time slice', 'chunked prefill'],
    ],
  },
  {
    osTitle: 'malloc',
    osEra: 'OS · 1970s',
    llmTitle: 'KV block allocator',
    llmEra: 'LLM SERVING · 2023',
    rows: [
      ['free list', 'free KV blocks'],
      ['fragmentation', 'reserved-context waste'],
      ['fixed pages', 'fixed token blocks'],
    ],
  },
]

/** Mini page-table / block-table glyph — rows of small cells. */
function MiniTable({ tone }: { tone: 'cyan' | 'rose' }) {
  const stroke = tone === 'cyan' ? '#22D3EE' : '#FB7185'
  return (
    <svg viewBox="0 0 96 64" className="h-16 w-24" aria-hidden>
      {Array.from({ length: 4 }, (_, r) => (
        <g key={r}>
          <rect x={4} y={6 + r * 14} width={40} height={10} rx={2} fill="none" stroke={stroke} strokeOpacity={0.7} strokeWidth={1} />
          <rect x={52} y={6 + r * 14} width={40} height={10} rx={2} fill={stroke} fillOpacity={r === 1 ? 0.35 : 0.12} stroke={stroke} strokeOpacity={0.5} strokeWidth={1} />
          <line x1={44} y1={11 + r * 14} x2={52} y2={11 + r * 14} stroke="#5D6B80" strokeWidth={1} strokeDasharray="2 2" />
        </g>
      ))}
    </svg>
  )
}

function TypeIn({ text, start, delay }: { text: string; start: boolean; delay: number }) {
  const reduced = useReducedMotion()
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!start || reduced) return
    const t0 = window.setTimeout(() => {
      const iv = window.setInterval(() => {
        setN((v) => {
          if (v >= text.length) {
            window.clearInterval(iv)
            return v
          }
          return v + 1
        })
      }, 8)
    }, delay)
    return () => window.clearTimeout(t0)
  }, [start, text, delay, reduced])
  if (reduced) return <span>{text}</span>
  return <span>{text.slice(0, start ? n : 0)}</span>
}

function HeroCard() {
  const reduced = useReducedMotion()
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })

  useEffect(() => {
    if (paused || reduced) return
    const t = window.setInterval(() => setIdx((i) => (i + 1) % FLAGSHIPS.length), 6000)
    return () => window.clearInterval(t)
  }, [paused, reduced])

  const f = FLAGSHIPS[idx]
  return (
    <div
      ref={ref}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="mx-auto mt-12 w-full max-w-[720px] rounded-lg border border-line bg-surface-1 p-6"
    >
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={reduced ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? undefined : { opacity: 0, x: -16 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="grid items-center gap-4 sm:grid-cols-[1fr_40px_1fr]">
            <div className="rounded-md border border-t2/30 bg-t2/5 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-t2">{f.osEra}</p>
              <p className="mt-1 font-display text-h4 text-text-1">{f.osTitle}</p>
              <MiniTable tone="cyan" />
            </div>
            <div className="relative flex items-center justify-center">
              <span className="font-display text-[32px] text-text-1">≡</span>
              <span className="absolute h-10 w-10 animate-breathe rounded-full border border-accent/30" aria-hidden />
            </div>
            <div className="rounded-md border border-t5/30 bg-t5/5 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-t5">{f.llmEra}</p>
              <p className="mt-1 font-display text-h4 text-text-1">{f.llmTitle}</p>
              <MiniTable tone="rose" />
            </div>
          </div>
          <div className="mt-4 space-y-1.5 border-t border-line pt-4 font-mono text-[12px]">
            {f.rows.map(([a, b], i) => (
              <p key={a} className="flex items-center gap-2">
                <span className="text-t2">
                  <TypeIn text={a} start={inView} delay={i * 80 * a.length} />
                </span>
                <span className="text-text-3">≡</span>
                <span className="text-t5">
                  <TypeIn text={b} start={inView} delay={i * 80 * b.length + 100} />
                </span>
              </p>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="mt-4 flex justify-center gap-1.5">
        {FLAGSHIPS.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Show flagship pair ${i + 1}`}
            onClick={() => setIdx(i)}
            className={cn(
              'h-1.5 rounded-full transition-all duration-250',
              i === idx ? 'w-6 bg-accent' : 'w-1.5 bg-surface-3 hover:bg-line-bright',
            )}
          />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Flip card                                                           */
/* ------------------------------------------------------------------ */

function FlipCard({ pair, flash }: { pair: Pair; flash: boolean }) {
  const reduced = useReducedMotion()
  const [flipped, setFlipped] = useState(false)
  return (
    <div id={pair.slug} className="[perspective:1200px]">
      <motion.div
        role="button"
        tabIndex={0}
        aria-expanded={flipped}
        aria-label={`${pair.os} ≡ ${pair.llm} — activate to ${flipped ? 'flip back' : 'flip and read why'}`}
        onClick={() => setFlipped((f) => !f)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setFlipped((f) => !f)
          }
        }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={
          reduced
            ? { duration: 0 }
            : { duration: 0.5, ease: [0.2, 0.8, 0.3, 1] }
        }
        className={cn(
          'relative h-[220px] w-full cursor-pointer [transform-style:preserve-3d]',
          flash && 'rounded-lg shadow-[0_0_0_2px_#3EF2A4]',
        )}
      >
        {/* front */}
        <div
          className="absolute inset-0 flex flex-col rounded-lg border border-line bg-surface-1 p-4 [backface-visibility:hidden] hover:border-line-bright"
        >
          <div className="grid flex-1 grid-cols-[1fr_28px_1fr] gap-2">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-t2">OS</p>
              <p className="mt-1 font-display text-[18px] font-medium leading-snug text-text-1">
                {pair.os}
              </p>
              <p className="mt-1 text-body-sm leading-snug text-text-2">{pair.osDef}</p>
            </div>
            <div className="flex items-center justify-center font-display text-xl text-text-3">
              ≡
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-t5">LLM</p>
              <p className="mt-1 font-display text-[18px] font-medium leading-snug text-text-1">
                {pair.llm}
              </p>
              <p className="mt-1 text-body-sm leading-snug text-text-2">{pair.llmDef}</p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-3">
              {pair.taught}
            </span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-text-3">
              flip <RotateCw size={10} />
            </span>
          </div>
        </div>
        {/* back */}
        <div className="absolute inset-0 flex flex-col rounded-lg border border-line-bright bg-surface-2 p-4 [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
            <ArrowLeftRight size={11} className="text-accent" /> why it holds
          </p>
          <p className="mt-2 flex-1 text-body-sm leading-relaxed text-text-2">{pair.why}</p>
          {pair.formula && (
            <p className="mb-2 inline-block w-fit rounded-sm border border-line bg-surface-3 px-2 py-0.5 font-mono text-[11px] text-accent">
              {pair.formula}
            </p>
          )}
          <div className="flex items-center justify-between border-t border-line pt-2">
            <Link
              to={`/lesson/${pair.lesson}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 font-mono text-[11px] text-accent hover:underline"
            >
              learn the lesson <ArrowRight size={11} />
            </Link>
            <span className="flex items-center gap-1 font-mono text-[10px] text-text-3">
              flip back <RotateCw size={10} />
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Glossary() {
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [track, setTrack] = useState<string | null>(null)
  const [flashSlug, setFlashSlug] = useState<string | null>(null)

  const fuse = useMemo(
    () =>
      new Fuse(PAIRS, {
        keys: [
          { name: 'os', weight: 2 },
          { name: 'llm', weight: 2 },
          { name: 'syn', weight: 1.5 },
          { name: 'osDef', weight: 0.5 },
          { name: 'llmDef', weight: 0.5 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [],
  )

  const filtered = useMemo(() => {
    let list = query.trim()
      ? fuse.search(query.trim()).map((r) => r.item)
      : PAIRS
    if (track) list = list.filter((p) => p.tracks.includes(track))
    return list
  }, [query, track, fuse])

  const suggestions = useMemo(() => {
    if (!query.trim()) return PAIRS.slice(0, 3)
    return fuse.search(query.trim(), { limit: 3 }).map((r) => r.item)
  }, [query, fuse])

  /* #anchor deep link: scroll + mint flash 1.2s */
  useEffect(() => {
    const slug = location.hash.replace('#', '')
    if (!slug) return
    const el = document.getElementById(slug)
    if (!el) return
    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFlashSlug(slug)
      window.setTimeout(() => setFlashSlug(null), 1200)
    }, 150)
    return () => window.clearTimeout(t)
  }, [location.hash])

  return (
    <div className="bg-grad-radial-glow">
      {/* Section 1 — header */}
      <section className="mx-auto max-w-app px-6 pt-24 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="section-label">0x05 — translation table</p>
          <h1 className="mt-4 font-display text-display-lg text-text-1">
            Same idea. New machine.
          </h1>
          <p className="mt-4 max-w-[60ch] text-body text-text-2">
            Every systems concept you'll learn, paired with its LLM-serving analog. Flip a
            card to translate. If you know the left side, you already half-know the right.
          </p>
        </motion.div>

        <HeroCard />
      </section>

      {/* search + filter row (sticky) */}
      <div className="sticky top-16 z-30 mt-14 border-y border-line bg-ink/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-app items-center gap-3 px-6 lg:px-12">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-1.5 focus-within:border-line-bright">
            <Search size={13} className="shrink-0 text-text-3" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="translate a concept…"
              aria-label="Search concept pairs"
              className="w-full bg-transparent font-mono text-xs text-text-1 placeholder:text-text-3 focus:outline-none"
            />
          </div>
          <div className="hidden items-center gap-1.5 sm:flex" role="group" aria-label="Filter by track">
            {TRACKS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTrack((cur) => (cur === t.id ? null : t.id))}
                aria-pressed={track === t.id}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors duration-150',
                  track === t.id
                    ? 'border-transparent text-ink'
                    : 'border-line bg-surface-2 text-text-3 hover:border-line-bright hover:text-text-2',
                )}
                style={track === t.id ? { backgroundColor: t.color } : undefined}
              >
                {t.code}
              </button>
            ))}
          </div>
          <span className="shrink-0 font-mono text-[11px] text-text-3">
            {filtered.length} pairs
          </span>
        </div>
      </div>

      {/* Section 3 — mapping grid */}
      <section className="mx-auto max-w-app px-6 py-10 lg:px-12">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-line bg-surface-1 px-6 py-16 text-center">
            <div className="grid grid-cols-8 gap-1 opacity-60" aria-hidden>
              {Array.from({ length: 32 }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-3 w-3 rounded-[2px] border border-line',
                    i === 19 ? 'animate-caret-blink bg-accent/60' : 'bg-surface-2',
                  )}
                />
              ))}
            </div>
            <p className="mt-6 font-mono text-body-sm text-text-2">no translation found</p>
            <p className="mt-1 font-mono text-[11px] text-text-3">close matches:</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s.slug}
                  type="button"
                  onClick={() => setQuery(s.os)}
                  className="rounded-full border border-line bg-surface-2 px-3 py-1 font-mono text-[11px] text-text-2 transition-colors hover:border-line-bright hover:text-accent"
                >
                  {s.os} ≡ {s.llm}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <motion.div layout className="grid gap-4 lg:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {filtered.map((p, i) => (
                <motion.div
                  key={p.slug}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-5% 0px' }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{
                    duration: 0.45,
                    delay: (i % 6) * 0.04,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <FlipCard pair={p} flash={flashSlug === p.slug} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </section>

      {/* Section 4 — CTA strip */}
      <section className="mx-auto max-w-app px-6 pb-24 lg:px-12">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-start justify-between gap-4 rounded-lg border border-line bg-surface-1 p-6 sm:flex-row sm:items-center"
        >
          <p className="font-mono text-body-sm text-text-2">
            each pair is taught in a lesson
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to="/curriculum"
              className="group/ks relative inline-flex items-center gap-2 overflow-hidden rounded-md bg-accent px-5 py-3 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 ease-snap hover:-translate-y-px active:scale-[.97]"
            >
              Start the curriculum <ArrowRight size={15} />
            </Link>
            <Link
              to="/lesson/t2.l8"
              className="font-mono text-body-sm text-text-2 transition-colors hover:text-accent"
            >
              test yourself in a quiz →
            </Link>
          </div>
        </motion.div>
      </section>
    </div>
  )
}
