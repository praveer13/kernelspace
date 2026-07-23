/**
 * Lesson block renderer (lesson.md §2 — The Block System).
 * Renders every ContentBlock type: prose (markdown-lite), code compare tabs,
 * five callout variants, step-through SVG diagrams, statlines, quizzes,
 * exercise embed cards, isomorphism panels, collapsible deep-dives.
 */

import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Lightbulb,
  Info,
  AlertTriangle,
  OctagonX,
  ArrowLeftRight,
  Plus,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Square,
  FlaskConical,
} from 'lucide-react'
import CodeBlock from '@/components/CodeBlock'
import QuizBlock from '@/components/QuizBlock'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import { SIM_INFO } from '@/data/lessons'
import type {
  CalloutBlock,
  CodeBlockData,
  ContentBlock,
  DeepdiveBlock,
  DiagramBlock,
  ExerciseBlock,
  IsomorphismBlock,
  Lesson,
  StatlineBlock,
} from '@/data/lessons/types'
import { renderInline, slugify } from './markdown'

/* ------------------------------------------------------------------ */
/* markdown-lite block renderer (prose)                                */
/* ------------------------------------------------------------------ */

interface ProseViewProps {
  md: string
  trackColor: string
  /** running H2 count before this block — for the mono index prefix */
  h2Start?: number
  /** compact mode for callouts/deepdives (no H2 treatment) */
  compact?: boolean
}

export function ProseView({ md, trackColor, h2Start = 0, compact = false }: ProseViewProps) {
  const lines = md.replace(/\r/g, '').split('\n')
  const nodes: ReactNode[] = []
  let i = 0
  let key = 0
  let h2 = h2Start

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      i++
      continue
    }

    // H2 / H3
    if (!compact && (line.startsWith('## ') || line.startsWith('### '))) {
      const isH2 = line.startsWith('## ')
      const text = line.slice(isH2 ? 3 : 4)
      const id = slugify(text)
      if (isH2) {
        h2++
        nodes.push(
          <h2
            key={key++}
            id={id}
            className="group relative mt-12 scroll-mt-24 font-display text-h2 text-text-1 first:mt-0"
          >
            <span className="mr-3 font-mono text-body font-normal" style={{ color: trackColor }}>
              {String(h2).padStart(2, '0')} —
            </span>
            {renderInline(text)}
            <a
              href={`#${id}`}
              aria-label={`Link to ${text}`}
              className="absolute -left-6 top-1/2 hidden -translate-y-1/2 font-mono text-body text-text-3 opacity-0 transition-opacity duration-120 hover:text-accent group-hover:opacity-100 xl:block"
            >
              #
            </a>
          </h2>,
        )
      } else {
        nodes.push(
          <h3 key={key++} id={id} className="mt-8 scroll-mt-24 font-display text-h3 text-text-1">
            {renderInline(text)}
          </h3>,
        )
      }
      i++
      continue
    }

    // tables: consecutive lines starting with |
    if (line.trimStart().startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        const raw = lines[i].trim().replace(/^\||\|$/g, '')
        rows.push(raw.split('|').map((c) => c.trim()))
        i++
      }
      const sepIdx = rows.findIndex((r) => r.every((c) => /^:?-{2,}:?$/.test(c)))
      const header = sepIdx > 0 ? rows.slice(0, sepIdx) : [rows[0]]
      const body = sepIdx > 0 ? rows.slice(sepIdx + 1) : rows.slice(1)
      nodes.push(
        <div key={key++} className="my-6 overflow-x-auto rounded-md border border-line scrollbar-slim">
          <table className="w-full border-collapse bg-surface-1 text-body-sm">
            <thead>
              {header.map((r, ri) => (
                <tr key={ri} className="border-b border-line">
                  {r.map((c, ci) => (
                    <th
                      key={ci}
                      className="whitespace-nowrap px-4 py-2.5 text-left font-mono text-label uppercase text-text-3"
                    >
                      {renderInline(c)}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className={cn('border-b border-line/60 last:border-0', ri % 2 === 1 && 'bg-surface-2/40')}>
                  {r.map((c, ci) => (
                    <td key={ci} className="px-4 py-2.5 align-top text-text-2">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // unordered list
    if (/^\s*- /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*- /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*- /, ''))
        i++
      }
      nodes.push(
        <ul key={key++} className="my-5 space-y-2.5">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-3 text-body-lg leading-[1.65] text-text-2">
              <span className="mt-[0.65em] h-1.5 w-1.5 shrink-0 rounded-[1px]" style={{ backgroundColor: trackColor }} />
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // ordered list
    if (/^\s*\d+\. /.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\. /, ''))
        i++
      }
      nodes.push(
        <ol key={key++} className="my-5 space-y-2.5">
          {items.map((it, ii) => (
            <li key={ii} className="flex gap-3 text-body-lg leading-[1.65] text-text-2">
              <span className="shrink-0 font-mono text-body-sm" style={{ color: trackColor }}>
                {String(ii + 1).padStart(2, '0')}
              </span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ol>,
      )
      continue
    }

    // paragraph: consume until blank line / structural start
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('## ') &&
      !lines[i].startsWith('### ') &&
      !lines[i].trimStart().startsWith('|') &&
      !/^\s*- /.test(lines[i]) &&
      !/^\s*\d+\. /.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    nodes.push(
      <p key={key++} className="my-5 max-w-measure text-body-lg leading-[1.65] text-text-2 first:mt-0 last:mb-0">
        {renderInline(para.join(' '))}
      </p>,
    )
  }

  return <>{nodes}</>
}

/* ------------------------------------------------------------------ */
/* callout (lesson.md §2.3, design.md §9.9)                            */
/* ------------------------------------------------------------------ */

const CALLOUT_META: Record<
  CalloutBlock['variant'],
  { icon: typeof Info; bar: string; text: string; label: string }
> = {
  analogy: { icon: Lightbulb, bar: '#FFB224', text: '#FFB224', label: "YOU'VE SEEN THIS" },
  info: { icon: Info, bar: '#5CA8FF', text: '#5CA8FF', label: 'INFO' },
  warning: { icon: AlertTriangle, bar: '#FFB224', text: '#FFB224', label: 'FOOTGUN' },
  segfault: { icon: OctagonX, bar: '#FF5C6C', text: '#FF5C6C', label: 'SEGFAULT' },
  isomorphism: { icon: ArrowLeftRight, bar: '#22D3EE', text: '#22D3EE', label: 'ISOMORPHISM' },
}

function CalloutView({ block }: { block: CalloutBlock }) {
  const meta = CALLOUT_META[block.variant]
  const Icon = meta.icon
  return (
    <aside
      className="relative my-6 overflow-hidden rounded-md border border-line bg-surface-1 px-5 py-4 pl-6"
      style={{ borderLeftWidth: 3, borderLeftColor: meta.bar }}
    >
      {block.variant === 'isomorphism' && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: 'linear-gradient(to bottom, #22D3EE, #FB7185)' }} />
      )}
      <div className="mb-2 flex items-center gap-2 font-mono text-label uppercase" style={{ color: meta.text }}>
        <Icon size={15} strokeWidth={1.75} />
        {block.title ?? meta.label}
      </div>
      <div className="[&_p]:!text-body [&_p]:!leading-[1.6]">
        <ProseView md={block.md} trackColor={meta.bar} compact />
      </div>
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* statline (lesson.md §2.5)                                           */
/* ------------------------------------------------------------------ */

function StatlineView({ block, trackColor }: { block: StatlineBlock; trackColor: string }) {
  return (
    <motion.div
      initial={{ opacity: 0.7 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: '-20% 0px' }}
      transition={{ duration: 0.5 }}
      className="my-6 flex flex-wrap gap-3"
    >
      {block.stats.map((s) => (
        <div
          key={s.label}
          title={s.hint}
          className="flex items-baseline gap-2.5 rounded-md border border-line bg-surface-2 px-4 py-3"
        >
          <span className="font-mono text-body font-medium" style={{ color: trackColor }}>
            {s.value}
          </span>
          <span className="font-mono text-label uppercase text-text-3">{s.label}</span>
        </div>
      ))}
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* diagram (lesson.md §2.4) — step-through SVG figure                  */
/* ------------------------------------------------------------------ */

function DiagramView({ block, trackColor }: { block: DiagramBlock; trackColor: string }) {
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

/* ------------------------------------------------------------------ */
/* isomorphism panel (lesson.md §2.8)                                  */
/* ------------------------------------------------------------------ */

function IsomorphismView({ block }: { block: IsomorphismBlock }) {
  return (
    <div className="my-8 rounded-lg border border-line bg-surface-1 p-5">
      <div className="mb-4 flex items-center gap-2 font-mono text-label uppercase text-text-3">
        <ArrowLeftRight size={14} className="text-text-3" />
        {block.title ?? 'the same idea, twice'}
      </div>
      <div className="space-y-3">
        {block.pairs.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
            <div className="rounded-md border border-[#22D3EE]/30 bg-[#22D3EE]/5 p-3.5">
              <div className="font-mono text-body-sm font-medium text-[#22D3EE]">{p.os}</div>
              <div className="mt-1 text-body-sm text-text-2">{p.osLine}</div>
            </div>
            <div className="flex items-center font-mono text-h4 text-text-3">≡</div>
            <div className="rounded-md border border-[#FB7185]/30 bg-[#FB7185]/5 p-3.5">
              <div className="font-mono text-body-sm font-medium text-[#FB7185]">{p.llm}</div>
              <div className="mt-1 text-body-sm text-text-2">{p.llmLine}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* deepdive (lesson.md §2.9)                                           */
/* ------------------------------------------------------------------ */

function DeepdiveView({ block, trackColor }: { block: DeepdiveBlock; trackColor: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-6 rounded-md border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-surface-2/60"
        aria-expanded={open}
      >
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.2 }} className="text-text-3">
          <Plus size={15} strokeWidth={1.75} />
        </motion.span>
        <span className="font-mono text-label uppercase text-text-3">Optional — go deeper</span>
        <span className="font-display text-body-sm font-medium text-text-1">{block.title}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-5 py-4 [&_p]:!text-body [&_p]:!leading-[1.65]">
              <ProseView md={block.md} trackColor={trackColor} compact />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* exercise — placeholder embed card → /lab/:simId (lesson.md §2.7)    */
/* ------------------------------------------------------------------ */

function ExerciseView({
  block,
  trackColor,
  lessonId,
}: {
  block: ExerciseBlock
  trackColor: string
  lessonId: string
}) {
  const sim = SIM_INFO[block.simId]
  const Icon = sim?.icon ?? FlaskConical
  const [noteOpen, setNoteOpen] = useState(false)
  const labSearch = new URLSearchParams({ from: lessonId })
  if (block.machine) labSearch.set('machine', block.machine)
  const labUrl = `/lab/${block.simId}?${labSearch.toString()}`

  return (
    <section className="my-8 overflow-hidden rounded-lg border border-line bg-surface-1" data-exercise={block.simId}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-label uppercase" style={{ color: trackColor }}>
            Exercise
          </span>
          <span className="font-display text-body-sm font-medium text-text-1">{block.title}</span>
        </div>
        <Link
          to={labUrl}
          className="flex items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors duration-150 hover:text-accent"
        >
          open full screen
          <ExternalLink size={12} />
        </Link>
      </div>

      {/* placeholder canvas (sim is mounted by the lab route) */}
      <div className="relative flex min-h-[240px] flex-col items-center justify-center gap-4 bg-blueprint px-6 py-10 text-center md:min-h-[300px]">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-lg border bg-surface-2"
          style={{ borderColor: `${trackColor}55`, color: trackColor }}
        >
          <Icon size={26} strokeWidth={1.5} />
        </span>
        <div>
          <p className="font-display text-h4 text-text-1">{sim?.name ?? block.title}</p>
          <p className="mt-1 max-w-md text-body-sm text-text-2">{sim?.hook}</p>
        </div>
        <p className="font-mono text-[11px] text-text-3">
          the live simulator runs at <span className="text-text-1">/lab/{block.simId}</span>
        </p>
        <Link
          to={labUrl}
          className="rounded-md bg-accent px-5 py-2.5 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
        >
          Open the simulator
        </Link>
      </div>

      {/* guided tasks */}
      <div className="border-t border-line px-5 py-4">
        <p className="mb-3 font-mono text-label uppercase text-text-3">Guided tasks</p>
        <ul className="space-y-2">
          {block.tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-3 text-body-sm text-text-2">
              <Square size={14} className="mt-0.5 shrink-0 text-text-3" strokeWidth={1.75} />
              <span>
                <span className="mr-2 font-mono text-[11px] text-text-3">{String(i + 1).padStart(2, '0')}</span>
                {renderInline(t)}
              </span>
            </li>
          ))}
        </ul>
        {block.note && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-text-3 transition-colors duration-150 hover:text-text-1"
              aria-expanded={noteOpen}
            >
              <motion.span animate={{ rotate: noteOpen ? 45 : 0 }} transition={{ duration: 0.2 }}>
                <Plus size={12} />
              </motion.span>
              what just happened
            </button>
            <AnimatePresence initial={false}>
              {noteOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 [&_p]:!text-body-sm">
                    <ProseView md={block.note} trackColor={trackColor} compact />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* code wrapper — compare tabs default to settings.codeLang (§2.2)     */
/* ------------------------------------------------------------------ */

function CodeView({ block }: { block: CodeBlockData }) {
  const codeLang = useProgress((s) => s.settings.codeLang)
  const tabs = useMemo(() => {
    if (!block.tabs) return undefined
    if (!codeLang) return block.tabs
    const idx = block.tabs.findIndex((t) => t.lang === codeLang || t.label.toLowerCase() === codeLang)
    if (idx <= 0) return block.tabs
    const re = [...block.tabs]
    const [pref] = re.splice(idx, 1)
    return [pref, ...re]
  }, [block.tabs, codeLang])

  return (
    <div className="my-6">
      <CodeBlock
        filename={block.filename}
        tabs={tabs}
        code={block.code}
        lang={block.lang}
        highlightLines={block.highlightLines}
      />
      {block.chips && block.chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {block.chips.map((c) => (
            <span key={c} className="rounded-full border border-line bg-surface-1 px-2.5 py-0.5 font-mono text-[10px] text-text-3">
              {c}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* dispatcher                                                          */
/* ------------------------------------------------------------------ */

interface RenderBlockProps {
  block: ContentBlock
  lesson: Lesson
  trackColor: string
  h2Start: number
}

export function RenderBlock({ block, lesson, trackColor, h2Start }: RenderBlockProps) {
  switch (block.type) {
    case 'prose':
      return <ProseView md={block.md} trackColor={trackColor} h2Start={h2Start} />
    case 'code':
      return <CodeView block={block} />
    case 'callout':
      return <CalloutView block={block} />
    case 'diagram':
      return <DiagramView block={block} trackColor={trackColor} />
    case 'statline':
      return <StatlineView block={block} trackColor={trackColor} />
    case 'quiz':
      return (
        <div className="my-8">
          <QuizBlock lessonId={lesson.id} questions={block.questions} />
        </div>
      )
    case 'exercise':
      return <ExerciseView block={block} trackColor={trackColor} lessonId={lesson.id} />
    case 'isomorphism':
      return <IsomorphismView block={block} />
    case 'deepdive':
      return <DeepdiveView block={block} trackColor={trackColor} />
    default:
      return null
  }
}
