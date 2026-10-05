/**
 * Step-through SVG diagram (lesson.md §2.4). Split out of blocks.tsx (Wave 1 scaffold B1) so P1's
 * `predictAt` gate (B20) can land here without touching the dispatcher.
 */

import { useId, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DiagramBlock } from '@/data/lessons/types'

export function DiagramView({ block, trackColor }: { block: DiagramBlock; trackColor: string }) {
  const [step, setStep] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const arrOn = `arr-${uid}`
  const arrOff = `arrd-${uid}`
  const H = block.height ?? 60
  const cur = block.steps[step]
  const activeSet = useMemo(() => new Set(cur?.active ?? []), [cur])
  const edgeSet = useMemo(() => new Set(cur?.edges ?? []), [cur])

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
    <figure className="my-8 rounded-lg border border-line bg-surface-1 p-4 md:p-5">
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
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(block.steps.length - 1, s + 1))}
              disabled={step === block.steps.length - 1}
              aria-label="Next step"
              className="flex h-7 w-7 items-center justify-center rounded border border-line bg-surface-2 text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={step}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 font-mono text-[11px] leading-relaxed text-text-2"
        >
          {cur?.caption}
        </motion.p>
      </AnimatePresence>
    </figure>
  )
}
