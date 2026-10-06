/**
 * Lesson block renderer (lesson.md §2 — The Block System).
 * Renders every ContentBlock type: prose (markdown-lite), code compare tabs,
 * five callout variants, step-through SVG diagrams, statlines, quizzes,
 * exercise embed cards, isomorphism panels, collapsible deep-dives, and the
 * Wave 1 prequestion, play and exit-ticket blocks (lazy). ProseView, DiagramView
 * and ExerciseView live in their own modules beside this one.
 */

import { Suspense, lazy, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Lightbulb,
  Info,
  AlertTriangle,
  OctagonX,
  ArrowLeftRight,
  Plus,
  ExternalLink,
  BookOpenText,
  CalendarClock,
} from 'lucide-react'
import CodeBlock from '@/components/CodeBlock'
import QuizBlock from '@/components/QuizBlock'
import { useProgress } from '@/lib/progress'
import type {
  CalloutBlock,
  CodeBlockData,
  ContentBlock,
  DeepdiveBlock,
  FieldNoteBlock,
  IsomorphismBlock,
  Lesson,
  StatlineBlock,
} from '@/data/lessons/types'
import { DiagramView } from './diagram'
import { ExerciseView } from './exercise'
import { ProseView } from './prose'

// Wave 1 blocks are their own chunks, so a lesson without them never downloads them.
const Prequestions = lazy(() => import('@/components/blocks/Prequestions'))
const PlayBlock = lazy(() => import('@/components/blocks/PlayBlock'))
const ExitTicketBlock = lazy(() => import('@/components/learner/ExitTicketBlock'))

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
  // No opacity fade-in: at 0.7 the 4.5:1 text-3 label measures 3.05:1 until the block scrolls into view.
  return (
    <div className="my-6 flex flex-wrap gap-3">
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
    </div>
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
          <div key={i}>
            <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
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
            {p.breaks && (
              <p className="mt-1.5 border-l-2 border-line-bright pl-3 text-[13px] leading-snug text-text-3">
                <span className="mr-1.5 font-mono text-[10px] uppercase">where it breaks:</span>
                {p.breaks}
              </p>
            )}
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
/* field note — dated primary-source reading card (PLAN.md §3.8)      */
/* ------------------------------------------------------------------ */

function FieldNoteView({ block, trackColor }: { block: FieldNoteBlock; trackColor: string }) {
  return (
    <aside className="my-8 overflow-hidden rounded-lg border border-line bg-surface-1">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2/50 px-5 py-3">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: trackColor }}>
          <BookOpenText size={13} /> field note · paper spine
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-text-3">
          <CalendarClock size={12} /> verified {block.verified}
        </span>
      </div>
      <div className="px-5 py-5">
        <p className="font-display text-h4 text-text-1">{block.title}</p>
        <p className="mt-1 font-mono text-[11px] text-text-3">
          {block.source} · {block.published}
        </p>
        <div className="mt-4 [&_p]:!text-body [&_p]:!leading-[1.65]">
          <ProseView md={block.md} trackColor={trackColor} compact />
        </div>
        <a
          href={block.href}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] underline-offset-4 hover:underline"
          style={{ color: trackColor }}
        >
          read the primary source <ExternalLink size={12} />
        </a>
      </div>
    </aside>
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

/** Keeps a lazy block's slot from collapsing while its chunk loads. */
function BlockFallback() {
  return (
    <div role="status" aria-live="polite" className="my-8 min-h-24 rounded-lg border border-line bg-surface-1 px-5 py-4">
      <p className="font-mono text-body-sm text-text-3">loading…</p>
    </div>
  )
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
      return <DiagramView block={block} trackColor={trackColor} lessonId={lesson.id} blockIndex={lesson.blocks.indexOf(block)} />
    case 'statline':
      return <StatlineView block={block} trackColor={trackColor} />
    case 'quiz':
      // V5: a lesson with a ticket renders its checkpoint as the exit ticket.
      if (lesson.ticket) {
        return (
          <Suspense fallback={<BlockFallback />}>
            <ExitTicketBlock lesson={lesson} block={block} trackColor={trackColor} />
          </Suspense>
        )
      }
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
    case 'field-note':
      return <FieldNoteView block={block} trackColor={trackColor} />
    case 'predict':
      return (
        <Suspense fallback={<BlockFallback />}>
          <Prequestions lessonId={lesson.id} items={block.items} trackColor={trackColor} />
        </Suspense>
      )
    case 'play':
      return (
        <Suspense fallback={<BlockFallback />}>
          <PlayBlock lessonId={lesson.id} playId={block.playId} title={block.title} trackColor={trackColor} />
        </Suspense>
      )
    default:
      return null
  }
}
