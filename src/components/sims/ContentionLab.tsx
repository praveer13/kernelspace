/**
 * SIM-03 `sim-vm` — Contention Lab (t2.l5 "Mutexes, Atomics & Lock-Free Queues").
 * Two machines in one:
 *   1) Counter benchmark: mutex vs atomic CAS vs lock-free striped counters.
 *      Throughput vs threads, plus a cache-line ownership visualiser for the
 *      atomic case.
 *   2) ABA inspector: step-through replay of the classic lock-free stack ABA
 *      hazard, with a tagged-pointer toggle that makes the stale CAS fail.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, RotateCcw, StepForward } from 'lucide-react'
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

const SIM_ID = 'sim-vm'
const MAX_THREADS = 16
const BASE_OPS_MS = 1000

const IMPLS = ['mutex', 'atomic', 'striped'] as const
type Impl = (typeof IMPLS)[number]

const IMPL_META: Record<Impl, { label: string; color: string }> = {
  mutex: { label: 'mutex', color: '#A78BFA' },
  atomic: { label: 'atomic CAS', color: '#FF5C6C' },
  striped: { label: 'striped', color: '#3EF2A4' },
}

const CHART_H = 300
const PAD = { l: 58, r: 16, t: 16, b: 34 }
const Y_MIN = Math.log2(60)
const Y_MAX = Math.log2(24000)

/* -------- deterministic throughput model -------- */

function modelOpsMs(impl: Impl, threads: number): number {
  const t = Math.max(1, Math.min(MAX_THREADS, threads))
  switch (impl) {
    case 'mutex':
      return BASE_OPS_MS / (1 + 0.05 * (t - 1))
    case 'atomic':
      return BASE_OPS_MS / (1 + 0.12 * Math.pow(t - 1, 1.5))
    case 'striped':
      return BASE_OPS_MS * (1 + (t - 1) * 0.95)
  }
}

function fmtOpsMs(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`
  return `${n.toFixed(0)}`
}

/* -------- ABA trace state machine -------- */

type ABAStep = {
  caption: string
  t1: string
  t2: string
  stack: { id: string; tag: number; freed: boolean }[]
  headIndex: number
  failCas?: boolean
  corrupt?: boolean
}

function buildABATrace(tagged: boolean): ABAStep[] {
  const s0: ABAStep[] = [
    {
      caption: 'Initial stack: head → A → B → C.',
      t1: 'idle',
      t2: 'idle',
      stack: [
        { id: 'A', tag: 0, freed: false },
        { id: 'B', tag: 0, freed: false },
        { id: 'C', tag: 0, freed: false },
      ],
      headIndex: 0,
    },
    {
      caption: 'Thread 1 reads head = A and prepares CAS(head, A → B). It gets preempted.',
      t1: 'read A, CAS pending',
      t2: 'idle',
      stack: [
        { id: 'A', tag: 0, freed: false },
        { id: 'B', tag: 0, freed: false },
        { id: 'C', tag: 0, freed: false },
      ],
      headIndex: 0,
    },
    {
      caption: 'Thread 2 pops A. Head is now B → C; A is freed to the allocator.',
      t1: 'CAS pending',
      t2: 'pop A',
      stack: [
        { id: 'B', tag: 0, freed: false },
        { id: 'C', tag: 0, freed: false },
      ],
      headIndex: 0,
    },
    {
      caption: 'Thread 2 pops B. Head is now C; B is freed.',
      t1: 'CAS pending',
      t2: 'pop B',
      stack: [{ id: 'C', tag: 0, freed: false }],
      headIndex: 0,
    },
    {
      caption:
        'Thread 2 pushes A again — the allocator recycles the same address with a fresh tag (A1).',
      t1: 'CAS pending',
      t2: 'push A',
      stack: [
        { id: 'A', tag: 1, freed: false },
        { id: 'C', tag: 0, freed: false },
      ],
      headIndex: 0,
    },
  ]

  if (!tagged) {
    s0.push({
      caption:
        'Thread 1 resumes: head still equals A, so the untagged CAS succeeds and sets head = B. B was freed — the stack is corrupt.',
      t1: 'CAS succeeds ✗',
      t2: 'idle',
      stack: [{ id: 'B', tag: 0, freed: true }],
      headIndex: 0,
      corrupt: true,
    })
  } else {
    s0.push(
      {
        caption:
          'Thread 1 resumes: the tagged CAS compares (A, tag 0) against current head (A, tag 1). Tag mismatch — CAS fails safely.',
        t1: 'CAS fails ✓',
        t2: 'idle',
        stack: [
          { id: 'A', tag: 1, freed: false },
          { id: 'C', tag: 0, freed: false },
        ],
        headIndex: 0,
        failCas: true,
      },
      {
        caption:
          'Thread 1 retries with the current head A1 and sets head = C. The pop completes correctly.',
        t1: 'retry succeeds ✓',
        t2: 'idle',
        stack: [{ id: 'C', tag: 0, freed: false }],
        headIndex: 0,
        corrupt: false,
      },
    )
  }

  return s0
}

/* -------- main component -------- */

export default function ContentionLab() {
  const { embed } = usePlaygroundContext()
  const reducedMotion = usePrefersReducedMotion()
  const { lines, log, clear } = useSimLog()

  const [tab, setTab] = useState<'counter' | 'aba'>('counter')
  const [threads, setThreads] = useState(1)
  const [impl, setImpl] = useState<Impl>('atomic')
  const [runs, setRuns] = useState<{ id: number; impl: Impl; threads: number; opsMs: number }[]>([])

  const [abaTagged, setAbaTagged] = useState(false)
  const [abaStep, setAbaStep] = useState(0)
  const [abaPlaying, setAbaPlaying] = useState(false)
  const [abaSeen, setAbaSeen] = useState({ tagged: false, untagged: false })

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(720)
  const tickRef = useRef(0)
  const [cacheOwner, setCacheOwner] = useState(0)

  const trace = useMemo(() => buildABATrace(abaTagged), [abaTagged])
  const stepInfo = trace[Math.min(abaStep, trace.length - 1)]

  /* ---- resize ---- */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  /* ---- cache-line ping-pong animation (atomic + >1 thread) ---- */
  useEffect(() => {
    if (reducedMotion || tab !== 'counter' || impl !== 'atomic' || threads <= 1) return
    let owner = 0
    const interval = window.setInterval(() => {
      owner = (owner + 1) % threads
      setCacheOwner(owner)
    }, Math.max(80, 400 / threads))
    return () => window.clearInterval(interval)
  }, [reducedMotion, tab, impl, threads])

  const recordABACompletion = useCallback((tagged: boolean) => {
    setAbaSeen((prev) => {
      const next = {
        tagged: prev.tagged || tagged,
        untagged: prev.untagged || !tagged,
      }
      if (next.tagged && next.untagged) {
        completeSimTask(SIM_ID, 't-lock-aba', 60)
      }
      return next
    })
  }, [])

  /* ---- ABA auto-play ---- */
  useEffect(() => {
    if (!abaPlaying) return
    const interval = window.setInterval(() => {
      setAbaStep((s) => {
        if (s >= trace.length - 1) {
          setAbaPlaying(false)
          return s
        }
        const next = s + 1
        if (next === trace.length - 1) {
          recordABACompletion(abaTagged)
        }
        return next
      })
    }, 900)
    return () => window.clearInterval(interval)
  }, [abaPlaying, trace.length, abaTagged, recordABACompletion])

  /* ---- counter run ---- */
  const runCounter = useCallback(() => {
    tickRef.current += 1
    const t = tickRef.current
    const opsMs = modelOpsMs(impl, threads)
    setRuns((prev) => [...prev.slice(-59), { id: t, impl, threads, opsMs }])
    log(
      t,
      'BENCH',
      `${IMPL_META[impl].label} · ${threads} thread${threads === 1 ? '' : 's'} → ${fmtOpsMs(opsMs)} ops/ms`,
      'ok',
    )

    if (threads === 1) {
      const allAtOne = new Set(
        runs.filter((r) => r.threads === 1).map((r) => r.impl),
      )
      allAtOne.add(impl)
      if (allAtOne.size === IMPLS.length) {
        completeSimTask(SIM_ID, 't-lock-base', 60)
      }
    }
    if (impl === 'atomic' && threads === MAX_THREADS) {
      log(t, 'COHER', 'atomic counter capped by cache-line ping-pong on 16 cores', 'warn')
      completeSimTask(SIM_ID, 't-lock-pingpong', 60)
    }
    if (impl === 'striped' && threads >= 8) {
      completeSimTask(SIM_ID, 't-lock-striped', 60)
    }
  }, [impl, threads, runs, log])

  const resetCounter = useCallback(() => {
    setRuns([])
    tickRef.current += 1
    log(tickRef.current, 'RESET', 'counter benchmark runs cleared', 'op')
  }, [log])

  const resetABA = useCallback(() => {
    setAbaStep(0)
    setAbaPlaying(false)
    tickRef.current += 1
    log(tickRef.current, 'ABA', 'trace reset', 'op')
  }, [log])

  const stepABA = useCallback(() => {
    setAbaStep((s) => {
      const next = Math.min(s + 1, trace.length - 1)
      if (next === trace.length - 1 && next !== s) {
        recordABACompletion(abaTagged)
      }
      return next
    })
  }, [trace.length, abaTagged, recordABACompletion])

  const toggleAbaTagged = useCallback(() => {
    setAbaTagged((v) => {
      const next = !v
      setAbaStep(0)
      tickRef.current += 1
      log(tickRef.current, 'ABA', `tagged pointers ${next ? 'enabled' : 'disabled'}`, 'op')
      return next
    })
  }, [log])

  /* ---- chart paint ---- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(width, 280)
    canvas.width = w * dpr
    canvas.height = CHART_H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, CHART_H)

    const px = (thr: number) =>
      PAD.l + ((thr - 1) / (MAX_THREADS - 1)) * (w - PAD.l - PAD.r)
    const py = (ops: number) =>
      PAD.t + (1 - (Math.log2(ops) - Y_MIN) / (Y_MAX - Y_MIN)) * (CHART_H - PAD.t - PAD.b)

    /* grid + axes */
    ctx.strokeStyle = 'rgba(38,48,64,0.8)'
    ctx.fillStyle = '#5D6B80'
    ctx.font = '10px ui-monospace, monospace'
    ctx.lineWidth = 1
    for (const ops of [100, 250, 500, 1000, 2500, 5000, 10000, 20000]) {
      const y = py(ops)
      ctx.beginPath()
      ctx.moveTo(PAD.l, y)
      ctx.lineTo(w - PAD.r, y)
      ctx.stroke()
      ctx.fillText(`${fmtOpsMs(ops)}`, 6, y + 3)
    }
    for (let thr = 1; thr <= MAX_THREADS; thr += 1) {
      const x = px(thr)
      ctx.beginPath()
      ctx.moveTo(x, PAD.t)
      ctx.lineTo(x, CHART_H - PAD.b)
      ctx.stroke()
      if (thr === 1 || thr % 4 === 0 || thr === MAX_THREADS) {
        ctx.fillText(String(thr), x - 3, CHART_H - PAD.b + 16)
      }
    }

    /* model curves */
    for (const im of IMPLS) {
      const color = IMPL_META[im].color
      ctx.strokeStyle = color
      ctx.globalAlpha = 0.55
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i <= 160; i += 1) {
        const thr = 1 + (MAX_THREADS - 1) * (i / 160)
        const y = py(modelOpsMs(im, thr))
        const x = px(thr)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    /* vertical marker for current thread count */
    ctx.strokeStyle = '#E6EDF755'
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(px(threads), PAD.t)
    ctx.lineTo(px(threads), CHART_H - PAD.b)
    ctx.stroke()
    ctx.setLineDash([])

    /* measured runs */
    for (const r of runs) {
      const color = IMPL_META[r.impl].color
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(px(r.threads), py(r.opsMs), r.threads === threads && r.impl === impl ? 5 : 3.5, 0, Math.PI * 2)
      ctx.fill()
    }

    /* legend */
    let lx = PAD.l + 8
    for (const im of IMPLS) {
      const color = IMPL_META[im].color
      ctx.fillStyle = color
      ctx.fillRect(lx, PAD.t + 6, 10, 3)
      ctx.fillStyle = '#9CA3AF'
      ctx.fillText(IMPL_META[im].label, lx + 14, PAD.t + 11)
      lx += ctx.measureText(IMPL_META[im].label).width + 34
    }
  }, [runs, threads, impl, width])

  /* ---- derived info ---- */
  const currentOps = modelOpsMs(impl, threads)
  const peakImpl = runs.reduce<Impl | null>((best, r) => {
    if (!best) return r.impl
    const bestRun = runs.find((x) => x.impl === best)
    if (!bestRun || r.opsMs > bestRun.opsMs) return r.impl
    return best
  }, null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------- stage ------- */}
        <div className="relative min-h-[420px] flex-1 overflow-auto bg-ink bg-blueprint p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-text-3">
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                contention lab
              </span>
              <span className="rounded-sm border border-line bg-surface-1 px-2 py-0.5">
                {tab === 'counter' ? 'counter benchmark' : 'ABA stack inspector'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <ChipButton active={tab === 'counter'} onClick={() => setTab('counter')}>
                counter
              </ChipButton>
              <ChipButton active={tab === 'aba'} onClick={() => setTab('aba')}>
                ABA inspector
              </ChipButton>
            </div>
          </div>

          {tab === 'counter' ? (
            <>
              <div ref={wrapRef} className="w-full">
                <canvas
                  ref={canvasRef}
                  style={{ width: '100%', height: CHART_H }}
                  role="img"
                  aria-label="Counter throughput versus thread count. Three model curves and measured runs."
                />
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
                <div>
                  <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
                    current measurement
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-sm border px-2 py-0.5 font-mono text-[11px]"
                      style={{
                        color: IMPL_META[impl].color,
                        borderColor: `${IMPL_META[impl].color}55`,
                        backgroundColor: `${IMPL_META[impl].color}14`,
                      }}
                    >
                      {IMPL_META[impl].label} · {threads} thread{threads === 1 ? '' : 's'}
                    </span>
                    <span className="font-mono text-[13px] text-text-1">
                      {fmtOpsMs(currentOps)} ops/ms
                    </span>
                    {impl === 'atomic' && threads > 1 && (
                      <span className="font-mono text-[10px] text-amber">
                        cache-line ping-pong
                      </span>
                    )}
                    {impl === 'striped' && threads > 1 && (
                      <span className="font-mono text-[10px] text-accent">
                        ~{threads}× scaling
                      </span>
                    )}
                  </div>
                </div>

                {/* cache-line ownership visualiser */}
                {impl === 'atomic' && threads > 1 && (
                  <div className="rounded-sm border border-line bg-surface-1 p-3">
                    <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.10em] text-text-3">
                      cache-line ownership
                    </p>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-1.5">
                        {Array.from({ length: Math.min(threads, 8) }, (_, i) => (
                          <div
                            key={i}
                            className="flex h-5 w-16 items-center justify-between rounded-sm border px-1.5 font-mono text-[9px]"
                            style={{
                              borderColor: cacheOwner === i ? '#FF5C6C' : undefined,
                              backgroundColor: cacheOwner === i ? 'rgba(255,92,108,0.12)' : undefined,
                            }}
                          >
                            <span className="text-text-3">cpu{i}</span>
                            {cacheOwner === i && (
                              <span className="text-[#FF5C6C]">owner</span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div
                        className="flex h-16 w-28 items-center justify-center rounded-sm border font-mono text-[10px]"
                        style={{
                          borderColor: '#FF5C6C66',
                          backgroundColor: 'rgba(255,92,108,0.10)',
                          color: '#FF5C6C',
                        }}
                      >
                        shared cache line
                      </div>
                    </div>
                    <p className="mt-2 max-w-[220px] font-mono text-[9px] leading-relaxed text-text-3">
                      every CAS invalidates the line in other caches, forcing ownership to bounce.
                    </p>
                  </div>
                )}
              </div>

              <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
                the faint curves are the model. measured runs appear as dots. at one thread all
                three converge; at sixteen cores the atomic CAS collapses from coherence traffic
                while the striped counter scales with cores.
              </p>
            </>
          ) : (
            <>
              <div className="mb-4 rounded-sm border border-line bg-surface-1 p-3">
                <p className="font-mono text-[11px] leading-snug text-text-1">
                  {stepInfo.caption}
                </p>
                <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px]">
                  <span className="text-[#22D3EE]">T1: {stepInfo.t1}</span>
                  <span className="text-[#FB7185]">T2: {stepInfo.t2}</span>
                </div>
              </div>

              {/* stack diagram */}
              <div className="relative min-h-[140px]">
                <div className="flex items-center gap-1">
                  <span className="w-12 font-mono text-[10px] text-text-3">head</span>
                  <span className="text-text-3">→</span>
                  {stepInfo.stack.map((node, i) => {
                    const isHead = i === stepInfo.headIndex
                    const color = isHead ? '#22D3EE' : node.freed ? '#5D6B80' : '#A78BFA'
                    return (
                      <div key={`${node.id}-${node.tag}-${i}`} className="flex items-center">
                        <motion.div
                          layout
                          initial={reducedMotion ? false : { opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.2 }}
                          className="flex flex-col items-center rounded-sm border px-3 py-2"
                          style={{
                            borderColor: `${color}66`,
                            backgroundColor: `${color}14`,
                            color,
                          }}
                        >
                          <span className="font-mono text-[12px] font-semibold">{node.id}</span>
                          <span className="font-mono text-[9px] text-text-3">tag {node.tag}</span>
                          {node.freed && (
                            <span className="font-mono text-[8px] text-danger">freed</span>
                          )}
                        </motion.div>
                        {i < stepInfo.stack.length - 1 && (
                          <span className="mx-1 text-text-3">→</span>
                        )}
                      </div>
                    )
                  })}
                  {stepInfo.stack.length === 0 && (
                    <span className="font-mono text-[10px] text-text-3">null</span>
                  )}
                </div>

                {(stepInfo.corrupt || stepInfo.failCas) && (
                  <motion.div
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 inline-block rounded-sm border px-3 py-1.5 font-mono text-[11px]"
                    style={{
                      borderColor: stepInfo.corrupt ? '#FF5C6C66' : '#3EF2A466',
                      backgroundColor: stepInfo.corrupt
                        ? 'rgba(255,92,108,0.12)'
                        : 'rgba(62,242,164,0.12)',
                      color: stepInfo.corrupt ? '#FF5C6C' : '#3EF2A4',
                    }}
                  >
                    {stepInfo.corrupt
                      ? 'CAS succeeded on stale head — stack corrupt'
                      : 'tag mismatch detected — CAS failed safely'}
                  </motion.div>
                )}
              </div>

              <p className="mt-4 max-w-xl font-mono text-[10px] leading-relaxed text-text-3">
                ABA is a history bug, not a value bug: the address returned to its old value while
                T1 was preempted. tagged pointers store a version counter so the stale CAS fails.
              </p>
            </>
          )}
        </div>

        {/* ------- control panel ------- */}
        <aside className="w-full shrink-0 overflow-y-auto border-t border-line bg-surface-1 lg:w-[296px] lg:border-l lg:border-t-0">
          {tab === 'counter' ? (
            <>
              <ControlGroup label="implementation">
                <div className="flex flex-wrap gap-1.5">
                  {IMPLS.map((im) => (
                    <ChipButton
                      key={im}
                      active={impl === im}
                      color={IMPL_META[im].color}
                      onClick={() => setImpl(im)}
                    >
                      {IMPL_META[im].label}
                    </ChipButton>
                  ))}
                </div>
                <p className="font-mono text-[10px] leading-relaxed text-text-3">
                  {impl === 'mutex' && 'one thread holds the lock; others spin or sleep.'}
                  {impl === 'atomic' && 'every thread CASes the same cache line — coherence traffic.'}
                  {impl === 'striped' && 'per-thread counters on separate lines; sum on read.'}
                </p>
              </ControlGroup>

              <ControlGroup label="threads">
                <SliderRow
                  label="thread count"
                  value={threads}
                  display={String(threads)}
                  min={1}
                  max={MAX_THREADS}
                  step={1}
                  onChange={setThreads}
                />
              </ControlGroup>

              <ControlGroup label="run">
                <button
                  type="button"
                  onClick={runCounter}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
                >
                  <Play size={15} strokeWidth={2} /> run benchmark
                </button>
                <button
                  type="button"
                  onClick={resetCounter}
                  className="w-full text-center font-mono text-[10px] text-text-3 transition-colors hover:text-danger"
                >
                  clear recorded runs
                </button>
              </ControlGroup>

              <ControlGroup label="legend" className="border-b-0">
                {IMPLS.map((im) => (
                  <div key={im} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[2px] border"
                      style={{ borderColor: IMPL_META[im].color, backgroundColor: `${IMPL_META[im].color}30` }}
                    />
                    <span className="font-mono text-[10px] text-text-2">
                      {IMPL_META[im].label} — {im === 'mutex' ? 'serialises' : im === 'atomic' ? 'single cache line' : 'per-thread stripes'}
                    </span>
                  </div>
                ))}
                {peakImpl && (
                  <p className="font-mono text-[10px] leading-relaxed text-text-3">
                    fastest measured: {IMPL_META[peakImpl].label}
                  </p>
                )}
              </ControlGroup>
            </>
          ) : (
            <>
              <ControlGroup label="ABA replay">
                <div className="flex flex-wrap gap-1.5">
                  <ChipButton active={!abaTagged} onClick={() => abaTagged && toggleAbaTagged()}>
                    untagged
                  </ChipButton>
                  <ChipButton
                    active={abaTagged}
                    color="#3EF2A4"
                    onClick={() => !abaTagged && toggleAbaTagged()}
                  >
                    tagged pointers
                  </ChipButton>
                </div>
                <p className="font-mono text-[10px] leading-relaxed text-text-3">
                  {abaTagged
                    ? 'the pointer carries a version tag; a recycled node has a new tag.'
                    : 'CAS compares only the address; a recycled A looks identical.'}
                </p>
              </ControlGroup>

              <ControlGroup label="transport">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAbaPlaying((p) => !p)}
                    className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md bg-accent font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
                  >
                    {abaPlaying ? 'pause' : (
                      <>
                        <Play size={15} strokeWidth={2} aria-hidden="true" />
                        play
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={stepABA}
                    disabled={abaStep >= trace.length - 1}
                    className="flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-line bg-surface-2 font-mono text-[12px] text-text-2 transition-all duration-150 hover:border-line-bright hover:text-text-1 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <StepForward size={15} strokeWidth={2} /> step
                  </button>
                </div>
                <button
                  type="button"
                  onClick={resetABA}
                  className="flex h-9 w-full items-center justify-center gap-2 rounded-sm border border-danger/40 bg-transparent font-mono text-[11px] text-danger transition-all duration-150 hover:bg-danger/10 active:scale-95"
                >
                  <RotateCcw size={13} strokeWidth={1.75} /> reset trace
                </button>
              </ControlGroup>

              <ControlGroup label="progress" className="border-b-0">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-text-3">step</span>
                    <span className="text-text-1">
                      {Math.min(abaStep + 1, trace.length)} / {trace.length}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-surface-2">
                    <div
                      className="h-1.5 rounded-full bg-accent transition-all duration-200"
                      style={{ width: `${((abaStep + 1) / trace.length) * 100}%` }}
                    />
                  </div>
                </div>
                {abaSeen.untagged && abaSeen.tagged && (
                  <p className="font-mono text-[10px] text-accent">
                    both variants observed — ABA lesson complete
                  </p>
                )}
              </ControlGroup>
            </>
          )}
        </aside>
      </div>

      {!embed && <LogConsole lines={lines} onClear={clear} />}
    </div>
  )
}
