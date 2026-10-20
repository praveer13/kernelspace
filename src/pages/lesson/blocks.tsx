/**
 * Lesson block renderer (lesson.md §2 — The Block System).
 * Renders every ContentBlock type: prose (markdown-lite), code compare tabs,
 * five callout variants, step-through SVG diagrams, statlines, quizzes,
 * exercise embed cards, isomorphism panels, collapsible deep-dives, and the
 * Wave 1 prequestion, play and exit-ticket blocks, the Wave 2 item block and the serving-first `reading` block (both lazy ItemBlock), the stretch protégé block (lazy), and on code blocks
 * F4's language switch, permission diagram and alignment items (lazy). ProseView, DiagramView
 * and ExerciseView live in their own modules beside this one.
 */

import { Suspense, lazy, useId, useMemo, useState, useSyncExternalStore } from 'react'
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
import { IsomorphismView } from '@/components/lesson/Isomorphism'
import { getProgress, useProgress, type CodeLang } from '@/lib/progress'
import { cn } from '@/lib/utils'
import type {
  CalloutBlock,
  CodeBlockData,
  ContentBlock,
  DeepdiveBlock,
  FieldNoteBlock,
  ItemBlock as ItemBlockData,
  Lesson,
  ReadingBlock,
  StatlineBlock,
} from '@/data/lessons/types'
import { DiagramView } from './diagram'
import { ExerciseView } from './exercise'
import { ProseView } from './prose'

// Wave 1 blocks are their own chunks, so a lesson without them never downloads them.
const Prequestions = lazy(() => import('@/components/blocks/Prequestions'))
const PlayBlock = lazy(() => import('@/components/blocks/PlayBlock'))
const ExitTicketBlock = lazy(() => import('@/components/learner/ExitTicketBlock'))
// Wave 2: generated items inside a lesson (a stub until 2a-12).
const ItemBlock = lazy(() => import('@/components/blocks/ItemBlock'))

/**
 * A `reading` block (docs/specs/serving-reading.md §5.2) is a compile-bank item block under its own title and lead. Its item spec is
 * derived once per block object (SR-D22): ItemBlock's load effect keys on the spec's identity, so a literal built in each render
 * would reload the block forever.
 */
const READING_ITEMS = new WeakMap<ReadingBlock, ItemBlockData>()
function readingItem(block: ReadingBlock): ItemBlockData {
  let item = READING_ITEMS.get(block)
  if (!item) {
    item = { type: 'item', title: block.title, family: 'compile', variants: block.variants, count: block.count, predict: false }
    READING_ITEMS.set(block, item)
  }
  return item
}
// Stretch P4 (wave-3 §16.9): a protégé block loads only in a lesson that has one.
const ProtegeBlock = lazy(() => import('@/components/blocks/ProtegeBlock'))
// F4 (wave-2 §17): permission diagrams and alignment items load only with a code block that has them.
const PermissionDiagram = lazy(() => import('@/components/lesson/PermissionDiagram'))
const AlignItem = lazy(() => import('@/components/lesson/AlignItem'))

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
/* code wrapper — compare tabs default to settings.codeLang (§2.2);    */
/* F4 (wave-2 §17): the familiar version beside the Rust, chosen by a   */
/* language switch that writes settings.codeLang, then the permission  */
/* diagram and the alignment items                                     */
/* ------------------------------------------------------------------ */

const ALT_LANGS = ['java', 'python'] as const
type AltLang = (typeof ALT_LANGS)[number]
const ALT_LABEL: Record<AltLang, string> = { java: 'Java', python: 'Python' }

/**
 * The alternate shown beside the Rust: the one settings.codeLang names, the first one authored when
 * it names neither, and none when it says Rust.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests/lesson/permission.test.ts
export function shownAlt(available: readonly AltLang[], codeLang: CodeLang | undefined): AltLang | null {
  if (available.length === 0 || codeLang === 'rust') return null
  return available.find((l) => l === codeLang) ?? available[0]
}

/*
 * settings.codeLang is the one source of truth: every code block reads it, so a pick in any block moves
 * them all. A read-only tab (§8.7) cannot write settings, so there the pick lives in this module instead,
 * still one value for every block on the page.
 */
let pagePick: CodeLang | null = null
const pagePickListeners = new Set<() => void>()

/** The language every code block shows: the page's pick on a read-only tab, settings.codeLang otherwise. */
function currentCodeLang(): CodeLang | undefined {
  const s = getProgress()
  return (s.ledger.readOnly ? pagePick : null) ?? s.settings.codeLang
}

function subscribeCodeLang(fn: () => void): () => void {
  const off = useProgress.subscribe(fn)
  pagePickListeners.add(fn)
  return () => {
    off()
    pagePickListeners.delete(fn)
  }
}

/** What the language switch does: write settings.codeLang, or, where settings cannot be written, the page's pick. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests/lesson/permission.test.ts
export function pickCodeLang(next: CodeLang): void {
  const s = getProgress()
  if (s.ledger.readOnly) {
    pagePick = next
    for (const fn of pagePickListeners) fn()
  } else s.updateSettings({ codeLang: next })
}

// The app renders only in the browser, so the server snapshot is the same live read (a static render in tests sees the store as it is).
const useCodeLang = () => useSyncExternalStore(subscribeCodeLang, currentCodeLang, currentCodeLang)

function LanguageSwitch({ available, shown, onPick }: { available: readonly AltLang[]; shown: AltLang | null; onPick: (lang: CodeLang) => void }) {
  const uid = useId()
  const choices: { value: CodeLang; label: string; on: boolean }[] = [
    ...available.map((l) => ({ value: l, label: ALT_LABEL[l], on: shown === l })),
    { value: 'rust', label: 'Rust only', on: shown === null },
  ]
  return (
    <div role="radiogroup" aria-labelledby={`${uid}-label`} className="mb-2 flex flex-wrap items-center gap-2">
      <span id={`${uid}-label`} className="mr-1 font-mono text-label uppercase text-text-3">
        Beside the Rust
      </span>
      {choices.map((c) => (
        <label key={c.value} className="relative cursor-pointer">
          <input type="radio" name={uid} value={c.value} checked={c.on} onChange={() => onPick(c.value)} className="peer sr-only" />
          <span
            className={cn(
              'inline-flex min-h-8 items-center rounded-full border px-3 py-1 font-mono text-[12px] transition-colors duration-150',
              'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
              c.on ? 'border-accent bg-accent-dim text-text-1' : 'border-line-bright bg-surface-1 text-text-2 hover:text-text-1',
            )}
          >
            {c.label}
          </span>
        </label>
      ))}
    </div>
  )
}

function CodeView({ block, lesson, alignStart }: { block: CodeBlockData; lesson: Lesson; alignStart: number }) {
  const lessonId = lesson.id
  const lang = useCodeLang()
  const tabs = useMemo(() => {
    if (!block.tabs) return undefined
    if (!lang) return block.tabs
    const idx = block.tabs.findIndex((t) => t.lang === lang || t.label.toLowerCase() === lang)
    if (idx <= 0) return block.tabs
    const re = [...block.tabs]
    const [pref] = re.splice(idx, 1)
    return [pref, ...re]
  }, [block.tabs, lang])

  const available = ALT_LANGS.filter((l) => block.alt?.[l] !== undefined)
  const alt = shownAlt(available, lang)
  const rust = (
    <CodeBlock
      filename={block.filename}
      tabs={tabs}
      code={block.code}
      lang={block.lang}
      highlightLines={block.highlightLines}
    />
  )

  return (
    <div className="my-6">
      {available.length > 0 && <LanguageSwitch available={available} shown={alt} onPick={pickCodeLang} />}
      {alt ? (
        <div className="space-y-3">
          <CodeBlock filename={`${ALT_LABEL[alt]} · what you know`} code={block.alt?.[alt]} lang={alt} />
          {rust}
        </div>
      ) : (
        rust
      )}
      {block.chips && block.chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {block.chips.map((c) => (
            <span key={c} className="rounded-full border border-line bg-surface-1 px-2.5 py-0.5 font-mono text-[10px] text-text-3">
              {c}
            </span>
          ))}
        </div>
      )}
      {block.permissions && block.code !== undefined && (
        <Suspense fallback={<BlockFallback />}>
          <PermissionDiagram lessonId={lessonId} traceKey={block.permissions.trace} code={block.code} />
        </Suspense>
      )}
      {block.align && block.align.length > 0 && (
        <Suspense fallback={<BlockFallback />}>
          {block.align.map((q, i) => (
            <AlignItem key={i} lessonId={lessonId} n={alignStart + i} q={q} lessonKcs={lesson.kcs} langLabel={alt ? ALT_LABEL[alt] : undefined} />
          ))}
        </Suspense>
      )}
    </div>
  )
}

/**
 * The number of a code block's first alignment item. Items are numbered across the lesson's code blocks in block
 * order from 1, the way scripts/item-pools.ts numbers them (`item:<lessonId>.align.<n>`), so the ledger ref the
 * lesson records is the ref the gates and the analysis name.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests/lesson/align.test.ts
export function alignStartOf(lesson: Lesson, block: ContentBlock): number {
  let n = 1
  for (const b of lesson.blocks) {
    if (b === block) return n
    if (b.type === 'code') n += b.align?.length ?? 0
  }
  return n
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
      return <CodeView block={block} lesson={lesson} alignStart={alignStartOf(lesson, block)} />
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
      return <ExerciseView block={block} trackColor={trackColor} lessonId={lesson.id} blockIndex={lesson.blocks.indexOf(block)} />
    case 'isomorphism':
      return <IsomorphismView block={block} lesson={lesson} />
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
    case 'item':
      return (
        <Suspense fallback={<BlockFallback />}>
          <ItemBlock lessonId={lesson.id} blockIndex={lesson.blocks.indexOf(block)} block={block} trackColor={trackColor} />
        </Suspense>
      )
    case 'reading':
      return (
        <>
          <ProseView md={block.lead} trackColor={trackColor} compact />
          <Suspense fallback={<BlockFallback />}>
            <ItemBlock lessonId={lesson.id} blockIndex={lesson.blocks.indexOf(block)} block={readingItem(block)} trackColor={trackColor} reading />
          </Suspense>
        </>
      )
    case 'protege':
      return (
        <Suspense fallback={<BlockFallback />}>
          <ProtegeBlock block={block} lesson={lesson} trackColor={trackColor} />
        </Suspense>
      )
    default:
      return null
  }
}
