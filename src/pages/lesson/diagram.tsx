/**
 * Step-through SVG diagram (lesson.md §2.4). Split out of blocks.tsx (Wave 1 scaffold B1).
 *
 * P1 `predictAt` (docs/specs/wave-1.md §9.2; task B20): before step `predictAt.step` the step control shows
 * the prompt with 2-4 shuffled options. The captions of that step and every later one stay hidden, and the
 * Next control and the arrow keys stop one step short, until a choice is committed (or skipped, when the KCs
 * are solid). A commit writes `item dia:<lessonId>#<blockIndex>` (src 'diagram') and then shows the why.
 * A learner who already answered (a reload, a second visit) is not gated again.
 * Arrow keys step the diagram while focus is on its controls; elsewhere they still change lessons.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { DiagramBlock } from '@/data/lessons/types'
import { OPTION_LETTERS } from '@/lib/items/play'
import {
  activePredict,
  blockKcs,
  captionVisible,
  depsFrom,
  diagramSeed,
  diaResponse,
  eventsOf,
  expertFor,
  maxStep,
  promptVisible,
  savedPrediction,
} from '@/lib/learner/prequestions'
import { useProgress } from '@/lib/progress'
import { shuffledOrder } from '@/lib/rng'
import { cn } from '@/lib/utils'

/** What the learner did at the gate: picked an option (authored index), or skipped as an expert. */
type Gate = { pick: number } | { skipped: true }

export function DiagramView({
  block,
  trackColor,
  lessonId,
  blockIndex,
}: {
  block: DiagramBlock
  trackColor: string
  /** With `blockIndex`: the ledger ref `dia:<lessonId>#<blockIndex>` of the prediction. Without them the gate is off. */
  lessonId?: string
  blockIndex?: number
}) {
  const [step, setStep] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const predict = lessonId !== undefined && blockIndex !== undefined ? activePredict(block) : null
  const [gate, setGate] = useState<Gate | null>(null)
  const [expert, setExpert] = useState(false)
  const [askAnyway, setAskAnyway] = useState(false)
  const recordItems = useProgress((s) => s.recordItems)
  const shownAt = useRef<number | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const committed = gate !== null || predict === null
  const reach = maxStep(block.steps.length, predict, committed)
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const arrOn = `arr-${uid}`
  const arrOff = `arrd-${uid}`
  const H = block.height ?? 60
  const cur = block.steps[step]
  const activeSet = useMemo(() => new Set(cur?.active ?? []), [cur])
  const edgeSet = useMemo(() => new Set(cur?.edges ?? []), [cur])
  const seed = lessonId !== undefined && blockIndex !== undefined ? diagramSeed(lessonId, blockIndex) : 0
  /** `order[position] = authored index`: stable per diagram, so a reload shows the options where they were. */
  const order = useMemo(() => (predict ? shuffledOrder(predict.options.length, seed) : []), [predict, seed])
  const showPrompt = promptVisible(step, predict, committed)
  const focusNext = useRef(false)
  const promptId = `${uid}-predict`

  // A learner who already answered is not gated again, and one whose KCs are solid may skip.
  useEffect(() => {
    if (!predict || lessonId === undefined || blockIndex === undefined) return
    let live = true
    const deps = depsFrom(useProgress)
    eventsOf(deps, 'dia', lessonId)
      .then((events) => savedPrediction(events, lessonId, blockIndex, predict))
      .catch(() => null)
      .then(async (found) => {
        const skip = found === null && (await expertFor(blockKcs([predict]), deps))
        if (!live) return
        if (found) setGate(found.pick && found.pick.length > 0 ? { pick: found.pick[0] } : { skipped: true })
        setExpert(skip)
      })
    return () => {
      live = false
    }
  }, [predict, lessonId, blockIndex])

  // Time on task starts when the prompt first shows.
  useEffect(() => {
    if (showPrompt && shownAt.current === null) shownAt.current = performance.now()
  }, [showPrompt])

  // After a commit or skip the options are gone: focus goes to Next, so the arrow keys keep stepping.
  useEffect(() => {
    if (gate && focusNext.current) {
      focusNext.current = false
      nextRef.current?.focus()
    }
  }, [gate])

  /** `at` is the click's `timeStamp`, on the same clock as `shownAt` (performance.now). */
  const commit = (pick: number, at: number) => {
    if (!predict || lessonId === undefined || blockIndex === undefined || gate) return
    const ms = shownAt.current === null ? 0 : at - shownAt.current
    recordItems([diaResponse(lessonId, blockIndex, predict, pick, { ms, seed })])
    focusNext.current = true
    setGate({ pick })
  }

  const skip = () => {
    focusNext.current = true
    setGate({ skipped: true })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const t = e.target as HTMLElement
    if (!(t instanceof HTMLButtonElement)) return
    const to = step + (e.key === 'ArrowRight' ? 1 : -1)
    if (to < 0 || to > reach) {
      // a gated diagram swallows the key (stepping waits for the commit); a finished one hands it back to the page
      if (to > reach && !committed) {
        e.preventDefault()
        e.stopPropagation()
      }
      return
    }
    e.preventDefault()
    e.stopPropagation()
    setStep(to)
  }

  const nodeById = useMemo(() => {
    const m = new Map<string, { cx: number; cy: number }>()
    for (const n of block.nodes) {
      const w = n.w ?? 18
      const h = n.h ?? 9
      m.set(n.id, { cx: n.x + w / 2, cy: n.y + h / 2 })
    }
    return m
  }, [block.nodes])

  const nodeState = (id: string) => {
    if (hovered) return hovered === id ? 'hover' : 'dim'
    if (activeSet.size === 0) return 'idle'
    return activeSet.has(id) ? 'active' : 'dim'
  }

  return (
    <figure className="my-8 rounded-lg border border-line bg-surface-1 p-4 md:p-5" onKeyDown={onKeyDown}>
      <svg
        viewBox={`0 0 100 ${H}`}
        className="w-full"
        role="img"
        aria-label={block.caption}
        style={{ display: 'block' }}
      >
        <defs>
          <marker id={arrOn} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={trackColor} />
          </marker>
          <marker id={arrOff} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="#2C3A4F" />
          </marker>
        </defs>

        {/* edges under nodes */}
        {(block.edges ?? []).map((e) => {
          const a = nodeById.get(e.from)
          const b = nodeById.get(e.to)
          if (!a || !b) return null
          const key = `${e.from}->${e.to}`
          const on = edgeSet.has(key)
          return (
            <g key={key} style={{ transition: 'opacity 300ms' }} opacity={edgeSet.size === 0 ? 0.7 : on ? 1 : 0.18}>
              <line
                x1={a.cx}
                y1={a.cy}
                x2={b.cx}
                y2={b.cy}
                stroke={on || edgeSet.size === 0 ? trackColor : '#2C3A4F'}
                strokeWidth={on ? 0.7 : 0.4}
                strokeDasharray={on ? '2 1.4' : undefined}
                markerEnd={`url(#${on || edgeSet.size === 0 ? arrOn : arrOff})`}
              />
              {e.label && (
                <text
                  x={(a.cx + b.cx) / 2}
                  y={(a.cy + b.cy) / 2 - 1.2}
                  textAnchor="middle"
                  fontSize="2.6"
                  fill={on ? '#E8EEF6' : '#5D6B80'}
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {e.label}
                </text>
              )}
            </g>
          )
        })}

        {/* nodes */}
        {block.nodes.map((n) => {
          const w = n.w ?? 18
          const h = n.h ?? 9
          const st = nodeState(n.id)
          const color = n.color ?? trackColor
          return (
            <g
              key={n.id}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ transition: 'opacity 200ms', cursor: 'default' }}
              opacity={st === 'dim' ? 0.35 : 1}
            >
              <rect
                x={n.x}
                y={n.y}
                width={w}
                height={h}
                rx={1.2}
                fill={st === 'active' || st === 'hover' ? `${color}22` : '#111722'}
                stroke={st === 'active' || st === 'hover' ? color : '#2C3A4F'}
                strokeWidth={st === 'active' ? 0.6 : 0.4}
                style={{ transition: 'fill 300ms, stroke 300ms' }}
              />
              <text
                x={n.x + w / 2}
                y={n.sub ? n.y + h / 2 - 0.6 : n.y + h / 2 + 1}
                textAnchor="middle"
                fontSize="2.9"
                fontWeight={500}
                fill={st === 'idle' ? '#A3B0C2' : '#E8EEF6'}
                fontFamily="'JetBrains Mono', monospace"
              >
                {n.label}
              </text>
              {n.sub && (
                <text
                  x={n.x + w / 2}
                  y={n.y + h / 2 + 2.6}
                  textAnchor="middle"
                  fontSize="2.2"
                  fill="#5D6B80"
                  fontFamily="'JetBrains Mono', monospace"
                >
                  {n.sub}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* step controls */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
        <figcaption className="font-mono text-[11px] text-text-3">{block.caption}</figcaption>
        {block.steps.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              aria-label="Previous step"
              className="flex h-7 w-7 items-center justify-center rounded border border-line bg-surface-2 text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="min-w-[52px] text-center font-mono text-[11px] text-text-3">
              step {step + 1}/{block.steps.length}
            </span>
            {/* aria-disabled, not disabled: stopping at the gate must not drop focus, or the arrow keys would change lessons */}
            <button
              ref={nextRef}
              type="button"
              onClick={() => setStep((s) => Math.min(reach, s + 1))}
              aria-disabled={step >= reach}
              aria-describedby={showPrompt ? promptId : undefined}
              aria-label="Next step"
              className="flex h-7 w-7 items-center justify-center rounded border border-line bg-surface-2 text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-text-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-line aria-disabled:hover:text-text-2"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>

      {predict && (
        <div className="mt-3" aria-live="polite">
          {showPrompt && expert && !askAnyway && (
            <div className="rounded-md border border-line bg-surface-2 px-3.5 py-3" id={promptId}>
              <p className="text-body-sm text-text-1">You know this. Skip, or answer anyway.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={skip}
                  className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => setAskAnyway(true)}
                  className="min-h-11 rounded-md border border-line bg-surface-1 px-5 text-body-sm text-text-1 hover:border-line-bright"
                >
                  Answer anyway
                </button>
              </div>
            </div>
          )}
          {showPrompt && !(expert && !askAnyway) && (
            <div role="group" aria-labelledby={`${promptId}-q`} id={promptId} className="rounded-md border border-line bg-surface-2 px-3.5 py-3">
              <p className="font-mono text-[10px] uppercase" style={{ color: trackColor }}>
                predict before step {predict.step + 1}
              </p>
              <p id={`${promptId}-q`} className="mt-1 text-body-sm text-text-1">
                {predict.prompt}
              </p>
              <div className="mt-3 grid gap-2">
                {order.map((authored, pos) => (
                  <button
                    key={authored}
                    type="button"
                    onClick={(e) => commit(authored, e.timeStamp)}
                    className="flex min-h-11 items-start gap-2.5 rounded-md border border-line bg-surface-1 px-3.5 py-2.5 text-left text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright"
                  >
                    <span className="mt-0.5 font-mono text-[11px] text-text-3">{OPTION_LETTERS[pos]}</span>
                    <span className="min-w-0 break-words">{predict.options[authored]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {gate && 'pick' in gate && <Prediction predict={predict} pick={gate.pick} />}
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={step}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 font-mono text-[11px] leading-relaxed text-text-2"
        >
          {captionVisible(step, predict, committed) ? cur?.caption : null}
        </motion.p>
      </AnimatePresence>
    </figure>
  )
}

/** The committed prediction: what was said, whether it held, and the why of the pick and of the key. */
function Prediction({ predict, pick }: { predict: NonNullable<ReturnType<typeof activePredict>>; pick: number }) {
  const ok = predict.correct.includes(pick)
  const key = predict.correct.find((i) => i !== pick) ?? predict.correct[0]
  return (
    <div className={cn('space-y-1.5 rounded-md border-l-2 bg-surface-2 px-3.5 py-2.5 text-body-sm text-text-2', ok ? 'border-accent' : 'border-danger')}>
      <p className="flex items-start gap-2 text-text-1">
        {ok ? <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <X size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
        <span className="min-w-0 break-words">
          {ok ? 'Right.' : 'Not quite.'} You said {predict.options[pick]}.
          {!ok && key !== undefined && <> It is {predict.options[key]}.</>}
        </span>
      </p>
      {predict.why[pick] && <p className="break-words">{predict.why[pick]}</p>}
      {!ok && key !== undefined && predict.why[key] && <p className="break-words">{predict.why[key]}</p>}
    </div>
  )
}
