/**
 * Lesson engine (lesson.md): three-rail layout — track navigator (264px),
 * 720px reading column, right rail with ON THIS PAGE + controls.
 * Reading-progress bar via rAF (no re-renders), scrollPct resume, keyboard
 * shortcuts (←/→ j/k e m ? esc).
 *
 * Wave 1 (docs/specs/wave-1.md §8.2–8.3, §7.2–7.3, §14.3): nothing is clicked to completion. T0–T2 end in an
 * exit ticket (t2.l7 the spiral checkpoint); T3–T7 and R say "pass the checkpoint" with a "continue anyway"
 * that marks the lesson *read*; a pass shows one toast ("Passed · +3 min · RING 2: 11/19 tickets"). `m`
 * navigates (never completes): to the ticket's first unanswered control, or to Up Next once the lesson is
 * done. A not-yet-passed lesson offers a test-out, the footer shows one Up Next with its why, and the
 * discussion mounts at the end. Nothing here locks anything (W8).
 */

import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  ClipboardCheck,
  Flag,
  GraduationCap,
  Keyboard,
  List,
  ListTree,
  OctagonX,
  RotateCcw,
  Terminal,
  X,
} from 'lucide-react'
import { selectTrackPct, useProgress } from '@/lib/progress'
import type { LessonStatus } from '@/lib/progress'
import { MINUTES, localDateKey, selectRings } from '@/lib/economy'
import { RING2_LESSONS } from '@/lib/economy-table'
import AgentActions from '@/components/AgentActions'
import UpNextCard from '@/components/learner/UpNextCard'
import { getTrack, CAPSTONE } from '@/lib/tracks'
import {
  ALL_LESSONS,
  lessonById,
  lessonsForTrack,
  nextLesson,
  prevLesson,
  lessonPath,
} from '@/data/lessons'
import type { ContentBlock, Lesson, TrackId } from '@/data/lessons/types'
import type { LocalDay } from '@/lib/ledger/types'
import type { PlacementResult, Recommendation } from '@/lib/learner/types'
import type { RecommendContent, RecommendState } from '@/lib/learner/recommend'
import { RenderBlock } from '@/pages/lesson/blocks'
import { countH2, extractHeadings } from '@/pages/lesson/markdown'
import { EXERCISE_META } from '@/pages/lesson/exercise-meta'
import { cn } from '@/lib/utils'

// the ticket, the test-out and the discussion load on demand: a lesson that is read first never pays for them
const TestOut = lazy(() => import('@/components/learner/TestOut'))
const Discussion = lazy(() => import('@/components/community/Discussion'))

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** What the completion control says: T0–T2 end in a ticket (t2.l7 in the spiral checkpoint), the rest in the checkpoint. */
function finishLabel(lesson: Lesson): string {
  if (!lesson.ticket) return 'Finish: pass the checkpoint'
  return lesson.ticket.form === 'spiral' ? 'Spiral checkpoint · 8 items' : 'Exit ticket · 3 items'
}

/** What a lesson that was finished without passing is waiting for. */
const passWord = (lesson: Lesson): string => (lesson.ticket ? 'ticket' : 'checkpoint')

const CONTENT_ERROR_FORM = 'https://github.com/praveer13/kernelspace/issues/new'

function contentErrorUrl(lessonId: string, section: string): string {
  const query = new URLSearchParams({ template: 'content-error.yml', lesson_id: lessonId, section })
  return `${CONTENT_ERROR_FORM}?${query.toString()}`
}

/**
 * A section runs from one H2 to the next. For each block, the plain heading of the section it
 * ends, or null when the block is mid-section; blocks before the first H2 count as "Intro".
 */
function sectionEnds(blocks: ContentBlock[]): (string | null)[] {
  const startsSection = (b: ContentBlock) => b.type === 'prose' && countH2(b.md) > 0
  let section = 'Intro'
  return blocks.map((b, i) => {
    if (b.type === 'prose') {
      const h2 = b.md.split('\n').filter((l) => l.startsWith('## '))
      if (h2.length > 0) section = h2[h2.length - 1].slice(3).replace(/[`*]/g, '').trim()
    }
    const next = blocks[i + 1]
    return !next || startsSection(next) ? section : null
  })
}

function ReportError({ lessonId, section }: { lessonId: string; section: string }) {
  return (
    <a
      href={contentErrorUrl(lessonId, section)}
      target="_blank"
      rel="noreferrer"
      className="mb-2 mt-1 flex w-fit items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors hover:text-text-2 focus-visible:text-text-2"
    >
      <Flag size={11} /> report an error<span className="sr-only"> in the section {section}</span>
    </a>
  )
}

function scrollPctNow(): number {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  if (max <= 0) return 100
  return Math.min(100, Math.max(0, (window.scrollY / max) * 100))
}

function scrollToPct(pct: number) {
  const doc = document.documentElement
  const max = doc.scrollHeight - window.innerHeight
  window.scrollTo({ top: (pct / 100) * max, behavior: 'instant' as ScrollBehavior })
}

/* ------------------------------------------------------------------ */
/* reading progress bar (rAF, zero re-render)                          */
/* ------------------------------------------------------------------ */

function ReadingBar({ trackColor, barRef }: { trackColor: string; barRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 h-0.5 bg-surface-2/60">
      <div
        ref={barRef}
        className="h-full w-full origin-left"
        style={{ backgroundColor: trackColor, transform: 'scaleX(0)' }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* left rail — track navigator (lesson.md §1)                          */
/* ------------------------------------------------------------------ */

function TrackNav({ lesson, onNavigate }: { lesson: Lesson; onNavigate?: () => void }) {
  const track = getTrack(lesson.trackId)!
  const trackLessons = lessonsForTrack(lesson.trackId)
  const lessons = useProgress((s) => s.lessons)
  const doneCount = trackLessons.filter((l) => lessons[l.id]?.status === 'done').length
  const listRef = useRef<HTMLDivElement>(null)
  const Glyph = track.glyph

  useEffect(() => {
    // auto-scroll the current lesson into view inside the rail
    const el = listRef.current?.querySelector<HTMLElement>(`[data-lesson="${lesson.id}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  }, [lesson.id])

  return (
    <div className="flex h-full flex-col">
      <Link
        to={`/tracks/${track.id}`}
        className="group flex items-center gap-2.5 border-b border-line px-4 py-3.5 transition-colors duration-150 hover:bg-surface-2/60"
      >
        <Glyph size={17} strokeWidth={1.75} style={{ color: track.color }} />
        <span className="min-w-0">
          <span className="block font-mono text-label uppercase" style={{ color: track.color }}>
            {track.code} · {track.name}
          </span>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-surface-3">
            <span
              className="block h-full rounded-full transition-all duration-500"
              style={{ width: `${(doneCount / trackLessons.length) * 100}%`, backgroundColor: track.color }}
            />
          </span>
        </span>
      </Link>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2 scrollbar-slim">
        {trackLessons.map((l) => {
          const st = lessons[l.id]?.status ?? 'unstarted'
          const current = l.id === lesson.id
          return (
            <Link
              key={l.id}
              data-lesson={l.id}
              to={lessonPath(l)}
              onClick={onNavigate}
              aria-current={current ? 'true' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-2.5 border-l-2 px-4 py-2 transition-colors duration-150',
                current ? 'bg-surface-2' : 'border-transparent hover:bg-surface-2/60',
              )}
              style={current ? { borderLeftColor: track.color } : undefined}
            >
              <span className="flex w-4 shrink-0 justify-center">
                {st === 'done' ? (
                  <Check size={13} strokeWidth={3} className="text-accent" />
                ) : st === 'read' ? (
                  <>
                    <Check size={13} strokeWidth={1.5} className="text-text-3" aria-hidden />
                    <span className="sr-only">{`read, ${passWord(l)} not passed`}</span>
                  </>
                ) : l.exam ? (
                  <GraduationCap size={13} className={current ? 'text-amber' : 'text-text-3'} />
                ) : current ? (
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: track.color }} />
                ) : (
                  <span className={cn('h-2 w-2 rounded-full border', st === 'reading' ? 'border-2' : 'border-line')} style={st === 'reading' ? { borderColor: track.color } : undefined} />
                )}
              </span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-body-sm',
                  current ? 'font-medium text-text-1' : st === 'done' ? 'text-text-3' : 'text-text-2',
                )}
              >
                {l.title}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-text-3">{l.minutes}m</span>
            </Link>
          )
        })}
      </div>

      <div className="border-t border-line px-4 py-3">
        <p className="font-mono text-[11px] text-text-3">
          {doneCount}/{trackLessons.length} done ·{' '}
          <Link to={`/tracks/${track.id}`} className="text-text-2 underline-offset-2 hover:text-accent hover:underline">
            track overview
          </Link>
        </p>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* right rail — ON THIS PAGE + controls (lesson.md §1)                 */
/* ------------------------------------------------------------------ */

interface RightRailProps {
  lesson: Lesson
  headings: { id: string; text: string; level: 2 | 3 }[]
  activeId: string | null
  pctRef: React.RefObject<HTMLSpanElement | null>
  status: LessonStatus
  /** Scroll to the exit ticket (T0–T2) or the checkpoint (the rest) and focus its first control. */
  onFinish: () => void
  /** "Continue anyway (read)": T3–T7 and R only; an exit ticket offers its own after a miss. */
  onContinue: () => void
  onOpenShortcuts: () => void
}

function RightRail({
  lesson,
  headings,
  activeId,
  pctRef,
  status,
  onFinish,
  onContinue,
  onOpenShortcuts,
}: RightRailProps) {
  const track = getTrack(lesson.trackId)!
  const hasExercise = lesson.blocks.some((b) => b.type === 'exercise')
  const done = status === 'done'
  const read = status === 'read'

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2.5 font-mono text-label uppercase text-text-3">On this page</p>
        <nav className="space-y-0.5 border-l border-line">
          {headings.map((h) => (
            <a
              key={h.id}
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault()
                document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
              className={cn(
                'block py-1 pr-2 text-body-sm transition-colors duration-150',
                h.level === 3 ? 'pl-7' : 'pl-4',
                activeId === h.id ? '-ml-px border-l-2 font-medium' : 'text-text-3 hover:text-text-1',
              )}
              style={activeId === h.id ? { borderLeftColor: track.color, color: track.color } : undefined}
            >
              {h.text}
            </a>
          ))}
        </nav>
      </div>

      <div className="rounded-md border border-line bg-surface-1 p-4">
        <p className="mb-3 font-mono text-label uppercase text-text-3">Controls</p>
        <button
          type="button"
          onClick={onFinish}
          data-complete-control
          disabled={done}
          className={cn(
            'flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 font-display text-body-sm font-semibold transition-all duration-150 active:scale-[.97]',
            done ? 'cursor-default bg-accent-dim text-accent' : 'bg-accent text-accent-foreground hover:-translate-y-px',
          )}
        >
          {done ? (
            <>
              <CheckCircle2 size={15} /> Passed
            </>
          ) : (
            <>
              {lesson.ticket ? <ClipboardCheck size={15} /> : <Check size={15} />} {finishLabel(lesson)}
            </>
          )}
        </button>
        {!done && !read && !lesson.ticket && (
          <button
            type="button"
            onClick={onContinue}
            data-continue-anyway
            className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
          >
            Continue anyway (read)
          </button>
        )}
        {read && (
          <p className="mt-2 flex items-start gap-1.5 font-mono text-[10px] leading-relaxed text-text-3">
            <Check size={11} strokeWidth={1.5} className="mt-px shrink-0" aria-hidden />
            Read, {passWord(lesson)} not passed. It stays open: pass it any time.
          </p>
        )}
        {!done && lesson.exam && (
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-amber">
            {lesson.ticket?.form === 'spiral' ? 'SPIRAL CHECKPOINT: 6 of 8, a miss never locks anything' : 'EXAM'}
          </p>
        )}

        {hasExercise && (
          <button
            type="button"
            onClick={() => document.querySelector('[data-exercise]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-[11px] text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-text-1"
          >
            <RotateCcw size={12} /> Restart exercise
          </button>
        )}

        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="font-mono text-[10px] uppercase text-text-3">read</span>
          <span ref={pctRef} className="font-mono text-[11px] text-text-2">
            0%
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenShortcuts}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5 font-mono text-[11px] text-text-3 transition-colors duration-150 hover:text-accent"
        >
          <Keyboard size={12} /> keyboard · ?
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* toast + modals                                                      */
/* ------------------------------------------------------------------ */

interface ToastData {
  msg: string
  detail: string
}

function Toast({ toast, onClose }: { toast: ToastData; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000)
    return () => clearTimeout(t)
  }, [onClose, toast])
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-md border border-line bg-surface-2 px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,.5)] lg:bottom-14 lg:right-6"
      role="status"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-dim text-accent">
        <Check size={14} strokeWidth={3} />
      </span>
      <span>
        <span className="block text-body-sm font-medium text-text-1">{toast.msg}</span>
        <span className="block font-mono text-[11px] text-text-3">{toast.detail}</span>
      </span>
    </motion.div>
  )
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['← / →', 'previous / next lesson'],
    ['j / k', 'next / previous section'],
    ['e', 'jump to exercise'],
    ['m', 'jump to the ticket, or Up Next'],
    ['?', 'this cheat sheet'],
    ['esc', 'close panels'],
  ]
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.98, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.98, opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="w-full max-w-sm rounded-lg border border-line-bright bg-surface-1 p-5 shadow-[0_24px_80px_rgba(0,0,0,.6)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="font-mono text-label uppercase text-text-3">Keyboard shortcuts</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-3 hover:text-text-1">
            <X size={16} />
          </button>
        </div>
        <ul className="space-y-2">
          {rows.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-4">
              <kbd className="rounded-sm border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-1">{k}</kbd>
              <span className="text-body-sm text-text-2">{v}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </motion.div>
  )
}

function TrackCompleteModal({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const track = getTrack(trackId)!
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md rounded-lg border bg-surface-1 p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,.6)]"
        style={{ borderColor: `${track.color}66` }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${track.name} complete`}
      >
        <img src={`/badge-${trackId}.svg`} alt="" className="mx-auto h-24 w-24" />
        <p className="mt-4 font-mono text-label uppercase" style={{ color: track.color }}>
          achievement unlocked
        </p>
        <h3 className="mt-2 font-display text-h3 text-text-1">
          {track.code} · {track.name} — complete
        </h3>
        <p className="mt-2 text-body-sm text-text-2">Every lesson in this track is done. The stack grows upward.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link
            to="/curriculum"
            className="rounded-md border border-line bg-surface-2 px-4 py-2 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
          >
            View curriculum
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-accent px-4 py-2 font-display text-body-sm font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px"
          >
            Keep reading
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* lesson not found — segfault style                                   */
/* ------------------------------------------------------------------ */

function LessonNotFound({ id }: { id?: string }) {
  return (
    <div className="mx-auto flex max-w-prose flex-col items-center px-6 py-32 text-center">
      <OctagonX size={40} strokeWidth={1.5} className="text-danger" />
      <p className="mt-6 font-mono text-body text-danger">Segmentation fault (core dumped)</p>
      <p className="mt-2 font-mono text-body-sm text-text-3">
        lesson <span className="text-text-1">{id ?? '???'}</span> not mapped at any address
      </p>
      <Link
        to="/curriculum"
        className="mt-8 rounded-md border border-line bg-surface-2 px-5 py-2.5 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
      >
        Return to safety → curriculum
      </Link>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* footer — previous, and one Up Next with a why (§7.3)                 */
/* ------------------------------------------------------------------ */

const TRACK_IDS: readonly string[] = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** `placement:result` as Up Next reads it; anything that is not a placement record is no placement. */
function parsePlacement(raw: unknown): RecommendState['placement'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.entryTrack !== 'string' || !TRACK_IDS.includes(r.entryTrack)) return null
  const anchor = r.rustAnchor === 'solid' || r.rustAnchor === 'missed' ? r.rustAnchor : 'skipped'
  return { entryTrack: r.entryTrack as TrackId, missedKcs: strings(r.missedKcs), solidKcs: strings(r.solidKcs), rustAnchor: anchor } satisfies Pick<
    PlacementResult,
    'entryTrack' | 'missedKcs' | 'solidKcs' | 'rustAnchor'
  >
}

type UpNextLoad =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; recommend: typeof import('@/lib/learner/recommend').recommend; content: RecommendContent; now: string; day: 'phone' | 'laptop' | 'rest' }

/**
 * The lesson footer's Up Next: `recommend()` over the façade's lessons and labs, the learner's path and placement,
 * and the week plan's kind of day. The KC graph, the labs and the recommender load on demand, so reading a lesson
 * does not pay for them; until they land the slot holds its place, and if they cannot load the footer falls back
 * to the plain next lesson, because a link must never depend on a chunk. Today's due cards are Today's and Home's
 * to point at: this footer passes no summary, so rule 2 (due reviews first) does not fire here.
 */
function LessonUpNext({ lesson, trackColor }: { lesson: Lesson; trackColor: string }) {
  const lessons = useProgress((s) => s.lessons)
  const labs = useProgress((s) => s.labs)
  const bootDone = useProgress((s) => s.completions.boot !== undefined)
  const path = useProgress((s) => s.working['boot:path'])
  const placementRaw = useProgress((s) => s.working['placement:result'])
  const week = useProgress((s) => s.working['boot:week'])
  const [load, setLoad] = useState<UpNextLoad>({ status: 'loading' })

  useEffect(() => {
    let live = true
    Promise.all([import('@/data/kc'), import('@/data/labs'), import('@/lib/learner/recommend'), import('@/lib/learner/planner')])
      .then(([kc, labsMod, rec, planner]) => {
        if (!live) return
        const day = planner.dayKindOf(planner.normalizeWeekPlan(week), localDateKey() as LocalDay, window.innerWidth)
        setLoad({
          status: 'ready',
          recommend: rec.recommend,
          content: { kcs: kc.KCS, lessons: ALL_LESSONS, labs: labsMod.FORGE_LABS },
          now: new Date().toISOString(),
          day,
        })
      })
      .catch(() => live && setLoad({ status: 'error' }))
    return () => {
      live = false
    }
  }, [week])

  const rec: Recommendation | null = useMemo(() => {
    if (load.status !== 'ready') return null
    // This footer is the end of this lesson, so for Up Next it has been read (a view of the state, never written):
    // the recommendation looks past it instead of offering to resume the page the learner is on.
    const here = lessons[lesson.id]
    const seen = here?.status === 'done' ? lessons : { ...lessons, [lesson.id]: { ...here, status: 'read' as const, lastVisitedAt: here?.lastVisitedAt ?? load.now } }
    const state: RecommendState = {
      bootDone,
      lessons: seen,
      labs,
      path: path === 'serving-first' || path === 'rust-systems' ? path : 'full-ramp',
      placement: parsePlacement(placementRaw),
      today: null,
    }
    try {
      return load.recommend(state, load.content, load.now, load.day)
    } catch {
      return null
    }
  }, [load, lesson.id, bootDone, lessons, labs, path, placementRaw])

  if (load.status === 'error' || (load.status === 'ready' && !rec)) return <NextLessonLink lesson={lesson} trackColor={trackColor} />
  if (!rec) return <div data-up-next-slot aria-busy="true" className="min-h-[9.5rem] rounded-lg border border-line bg-surface-1" />
  return <UpNextCard rec={rec} as="h2" />
}

/** The pre-Wave-1 footer link, kept as the fallback and for the last lesson's way on to the capstone. */
function NextLessonLink({ lesson, trackColor }: { lesson: Lesson; trackColor: string }) {
  const next = nextLesson(lesson)
  const track = getTrack(lesson.trackId)!
  const nextTrack = next && next.trackId !== lesson.trackId ? getTrack(next.trackId) : null
  if (next) {
    return (
      <Link
        to={lessonPath(next)}
        className="group rounded-lg border p-4 text-right transition-all duration-180 hover:-translate-y-0.5"
        style={{ borderColor: `${trackColor}55`, backgroundColor: `${trackColor}0d` }}
      >
        <span className="flex items-center justify-end gap-1.5 font-mono text-[11px]" style={{ color: trackColor }}>
          {nextTrack ? `next track · ${nextTrack.code}` : 'next lesson'} <ArrowRight size={12} />
        </span>
        <span className="mt-1.5 block truncate font-display text-body-sm font-medium text-text-1">{next.title}</span>
        <span className="mt-1 block font-mono text-[10px] text-text-3">
          {next.minutes} min · {nextTrack?.name ?? track.name}
        </span>
      </Link>
    )
  }
  return <CapstoneLink />
}

function CapstoneLink() {
  return (
    <Link to="/capstone" className="group rounded-lg border border-transparent bg-grad-brand p-[1px] transition-all duration-180 hover:-translate-y-0.5">
      <span className="block rounded-[7px] bg-surface-1 p-4 text-right">
        <span className="flex items-center justify-end gap-1.5 font-mono text-[11px] text-grad-brand">
          <Terminal size={12} /> final destination
        </span>
        <span className="mt-1.5 block font-display text-body-sm font-medium text-text-1">
          {CAPSTONE.code} · {CAPSTONE.name}
        </span>
        <span className="mt-1 block font-mono text-[10px] text-text-3">the whole address space</span>
      </span>
    </Link>
  )
}

/* ------------------------------------------------------------------ */
/* focus helpers for `m` and the finish control                         */
/* ------------------------------------------------------------------ */

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Bring `root` to the middle of the screen and focus `target` (or `root` itself, which then needs a tabindex). */
function reveal(root: HTMLElement, target: HTMLElement | null) {
  if (!target && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
  root.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })
  ;(target ?? root).focus({ preventScroll: true })
}

/** The exit ticket (or spiral checkpoint): its first unanswered control, else its first live button, else the section. */
function focusTicket(): boolean {
  const ticket = document.querySelector<HTMLElement>('[data-ks-ticket]')
  if (!ticket) return false
  const first =
    ticket.querySelector<HTMLElement>('[data-ks-option]:not(:disabled), [data-ks-field]:not(:disabled)') ??
    ticket.querySelector<HTMLElement>('button:not(:disabled)')
  reveal(ticket, first)
  return true
}

/** The checkpoint quiz of a lesson without a ticket: its first unanswered question, else Submit, else the section. */
function focusCheckpoint(): boolean {
  const quiz = document.querySelector<HTMLElement>('section[aria-label="Checkpoint quiz"]')
  if (!quiz) return false
  const first =
    quiz.querySelector<HTMLElement>('[data-answered="false"] button:not(:disabled)') ??
    quiz.querySelector<HTMLElement>('[data-quiz-submit]:not(:disabled)')
  reveal(quiz, first)
  return true
}

/** Up Next: its link once the card has loaded, else its place holder. */
function focusUpNext(): boolean {
  const card = document.querySelector<HTMLElement>('[data-up-next]')
  if (card) {
    reveal(card, card.querySelector<HTMLElement>('a'))
    return true
  }
  const slot = document.querySelector<HTMLElement>('[data-up-next-slot]')
  if (!slot) return false
  reveal(slot, null)
  return true
}

/* ------------------------------------------------------------------ */
/* the engine                                                          */
/* ------------------------------------------------------------------ */

export default function LessonPage() {
  const { lessonId } = useParams()
  const lesson = lessonById(lessonId)
  if (!lesson) return <LessonNotFound id={lessonId} />
  return <LessonView key={lesson.id} lesson={lesson} />
}

function LessonView({ lesson }: { lesson: Lesson }) {
  const track = getTrack(lesson.trackId)!
  const navigate = useNavigate()
  const { hash } = useLocation()
  const trackLessons = lessonsForTrack(lesson.trackId)
  const next = nextLesson(lesson)
  const prev = prevLesson(lesson)

  const progress = useProgress((s) => s.lessons[lesson.id])
  const markLessonStatus = useProgress((s) => s.markLessonStatus)
  const completeLesson = useProgress((s) => s.completeLesson)
  const setLessonScroll = useProgress((s) => s.setLessonScroll)
  const unlockAchievement = useProgress((s) => s.unlockAchievement)

  // done = passed (ticket, spiral, checkpoint or test-out); read = finished without passing (§8.3)
  const status: LessonStatus = progress?.status ?? 'unstarted'
  const done = status === 'done'
  const read = status === 'read'
  // a test-out is offered on a lesson that is not yet done, and stays mounted to show its verdict after a pass
  const [offerTestOut] = useState(() => !!lesson.ticket && useProgress.getState().lessons[lesson.id]?.status !== 'done')

  const headings = useMemo(() => extractHeadings(lesson.blocks), [lesson])
  const blockOffsets = useMemo(() => {
    let h2 = 0
    return lesson.blocks.map((b) => {
      const start = h2
      if (b.type === 'prose') h2 += countH2(b.md)
      return start
    })
  }, [lesson])

  const reportSections = useMemo(() => sectionEnds(lesson.blocks), [lesson])

  const [activeId, setActiveId] = useState<string | null>(headings[0]?.id ?? null)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [trackDoneOpen, setTrackDoneOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [showCompleteBar, setShowCompleteBar] = useState(false)
  const [resumePct, setResumePct] = useState<number | null>(null)

  const barRef = useRef<HTMLDivElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const lastSaved = useRef(0)

  /* mark reading on mount (also creates the record for scroll saves); a lesson already read or passed keeps its state */
  useEffect(() => {
    const st = useProgress.getState().lessons[lesson.id]?.status
    if (st !== 'done' && st !== 'read') markLessonStatus(lesson.id, 'reading')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id])

  /* resume position (runs after Layout's scroll-to-top); a #heading link (⌘K opens KCs at their H2) wins over it */
  useEffect(() => {
    const anchor = decodeURIComponent(hash.slice(1))
    if (anchor && headings.some((h) => h.id === anchor)) {
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior })),
      )
      return () => cancelAnimationFrame(id)
    }
    const saved = useProgress.getState().lessons[lesson.id]?.scrollPct
    if (saved && saved > 5 && saved < 95) {
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          scrollToPct(saved)
          setResumePct(Math.round(saved))
        }),
      )
      return () => cancelAnimationFrame(id)
    }
  }, [lesson.id, hash, headings])

  /* scroll driver: progress bar + pct readout (refs), throttled store save */
  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        const pct = scrollPctNow()
        if (barRef.current) barRef.current.style.transform = `scaleX(${pct / 100})`
        if (pctRef.current) pctRef.current.textContent = `${Math.round(pct)}%`
        setShowCompleteBar(pct >= 90)
        const now = Date.now()
        if (now - lastSaved.current > 500) {
          lastSaved.current = now
          setLessonScroll(lesson.id, Math.round(pct))
        }
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [lesson.id, setLessonScroll])

  /* scroll-spy on headings */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveId(e.target.id)
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    )
    for (const h of headings) {
      const el = document.getElementById(h.id)
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [headings])

  /* a pass made on this page (ticket, spiral, checkpoint or test-out): one toast, and the track's badge when it was the last */
  const lastStatus = useRef(status)
  useEffect(() => {
    const before = lastStatus.current
    lastStatus.current = status
    if (status !== 'done' || before === 'done') return
    // a pass that reached this tab from elsewhere (another tab, a sync) is not announced as made here
    const at = useProgress.getState().lessons[lesson.id]?.completedAt
    if (at !== undefined && Date.now() - Date.parse(at) > 15_000) return
    const st = useProgress.getState()
    const minutes = lesson.ticket?.form === 'spiral' ? MINUTES.spiral : MINUTES.quiz
    const tickets = selectRings(st.aggregate).ring2.tickets
    const detail = RING2_LESSONS.includes(lesson.id)
      ? `RING 2: ${tickets.done}/${tickets.total} tickets`
      : `${track.code} progress ${selectTrackPct(lesson.trackId, trackLessons.length)(st)}%`
    setToast({ msg: `Passed · +${minutes} min`, detail })
    if (trackLessons.every((l) => st.lessons[l.id]?.status === 'done')) {
      unlockAchievement(`track-${lesson.trackId}`)
      setTimeout(() => setTrackDoneOpen(true), 600)
    }
  }, [status, lesson, trackLessons, track.code, unlockAchievement])

  /* the finish control: go to the ticket (T0–T2) or the checkpoint; it never completes anything by itself */
  const finish = useCallback(() => {
    if (lesson.ticket ? focusTicket() || focusCheckpoint() : focusCheckpoint()) return
    document.querySelector('[data-exercise]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [lesson.ticket])

  /* "continue anyway": finished without passing, so the lesson reads as read and nothing else changes (W8) */
  const continueAnyway = useCallback(() => {
    if (useProgress.getState().lessons[lesson.id]?.status === 'done') return
    completeLesson(lesson.id, 'read')
  }, [completeLesson, lesson.id])

  /* section stepping for j/k */
  const stepSection = useCallback(
    (dir: 1 | -1) => {
      const els = headings
        .map((h) => document.getElementById(h.id))
        .filter((el): el is HTMLElement => !!el)
      if (els.length === 0) return
      const y = window.scrollY + 96
      const tops = els.map((el) => el.getBoundingClientRect().top + window.scrollY)
      if (dir === 1) {
        const idx = tops.findIndex((top) => top > y + 4)
        const target = els[idx === -1 ? els.length - 1 : idx]
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else {
        let idx = -1
        for (let i = 0; i < tops.length; i++) if (tops[i] < y - 4) idx = i
        const target = els[idx === -1 ? 0 : idx]
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    },
    [headings],
  )

  /* m: navigate, never complete. The ticket's first unanswered control; Up Next once the lesson is done (§8.2) */
  const focusCompletion = useCallback(() => {
    if (useProgress.getState().lessons[lesson.id]?.status === 'done') {
      if (!focusUpNext()) focusTicket()
      return
    }
    if (lesson.ticket ? focusTicket() || focusCheckpoint() : focusCheckpoint()) return
    focusUpNext()
  }, [lesson.id, lesson.ticket])

  /* keyboard shortcuts (lesson.md §6) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      switch (e.key) {
        case 'ArrowLeft':
          if (prev) navigate(lessonPath(prev))
          break
        case 'ArrowRight':
          if (next) navigate(lessonPath(next))
          break
        case 'j':
          stepSection(1)
          break
        case 'k':
          stepSection(-1)
          break
        case 'e':
          document.querySelector('[data-exercise]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          break
        case 'm':
          focusCompletion()
          break
        case '?':
          setShortcutsOpen((v) => !v)
          break
        case 'Escape':
          setShortcutsOpen(false)
          setNavOpen(false)
          setTocOpen(false)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prev, next, navigate, stepSection, focusCompletion])

  const exerciseMeta = EXERCISE_META[lesson.exercise]
  const ExIcon = exerciseMeta.icon

  return (
    <div className="relative">
      <ReadingBar trackColor={track.color} barRef={barRef} />

      {/* mobile rail toggles */}
      <div className="mx-auto flex max-w-prose items-center gap-2 px-6 pt-4 lg:hidden">
        <button
          type="button"
          onClick={() => setNavOpen(true)}
          className="flex items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-1.5 font-mono text-[11px] text-text-2"
        >
          <ListTree size={13} /> {track.code} lessons
        </button>
        <button
          type="button"
          onClick={() => setTocOpen(true)}
          className="flex items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-1.5 font-mono text-[11px] text-text-2"
        >
          <List size={13} /> on this page
        </button>
      </div>

      <div className="mx-auto grid max-w-app grid-cols-1 gap-8 px-6 lg:grid-cols-[264px_minmax(0,1fr)_232px] lg:px-12">
        {/* left rail */}
        <aside aria-label="Track lessons" className="sticky top-16 hidden h-[calc(100dvh-4rem)] lg:block">
          <TrackNav lesson={lesson} />
        </aside>

        {/* center column */}
        <article className="min-w-0 max-w-prose pb-16 pt-8 lg:pt-12">
          {/* header (lesson.md §4) */}
          <header className="mb-10">
            <nav className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
              <Link to="/curriculum" className="transition-colors hover:text-text-1">
                ~/curriculum
              </Link>
              <ChevronRight size={11} />
              <Link to={`/tracks/${track.id}`} className="transition-colors hover:text-text-1" style={{ color: track.color }}>
                {track.code}
              </Link>
              <ChevronRight size={11} />
              <span className="text-text-2">L{lesson.index}</span>
            </nav>

            <h1 className="mt-4 font-display text-h1 text-text-1">{lesson.title}</h1>

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
                <Clock size={12} /> {lesson.minutes} min
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 py-0.5 font-mono text-[10px] text-text-3">
                <ExIcon size={11} /> {exerciseMeta.label}
              </span>
              {lesson.exam && (
                <span className="flex items-center gap-1.5 rounded-sm border border-amber/40 bg-amber/10 px-2.5 py-0.5 font-mono text-[10px] uppercase text-amber">
                  <GraduationCap size={11} /> ★ {lesson.ticket?.form === 'spiral' ? 'spiral checkpoint · 8 items' : 'exam'}
                </span>
              )}
              {lesson.verifiedAt && (
                <Link
                  to="/freshness?tab=field-notes"
                  className="flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/5 px-2.5 py-0.5 font-mono text-[10px] text-accent transition-colors hover:border-accent/50 hover:bg-accent/10"
                  title="Landscape-sensitive content; open the quarterly verification log"
                >
                  <BadgeCheck size={11} /> last verified {lesson.verifiedAt}
                </Link>
              )}
              {done && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-accent">
                  <CheckCircle2 size={12} /> done
                </span>
              )}
              {read && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
                  <Check size={12} strokeWidth={1.5} aria-hidden /> read, {passWord(lesson)} not passed
                </span>
              )}
              {resumePct !== null && !done && !read && (
                <span className="font-mono text-[11px] text-text-3">resumed at {resumePct}%</span>
              )}
              <AgentActions lessonId={lesson.id} title={lesson.title} />
            </div>
          </header>

          {/* test-out (§7.2): offered while the lesson is not done, and kept to show its verdict */}
          {offerTestOut && (
            <div className="mb-8">
              <Suspense fallback={<div aria-hidden className="min-h-[6.5rem]" />}>
                <TestOut lesson={lesson} trackColor={track.color} />
              </Suspense>
            </div>
          )}

          {/* blocks */}
          {lesson.blocks.map((b, i) => (
            <Fragment key={i}>
              <RenderBlock block={b} lesson={lesson} trackColor={track.color} h2Start={blockOffsets[i]} />
              {reportSections[i] && <ReportError lessonId={lesson.id} section={reportSections[i]} />}
            </Fragment>
          ))}

          {/* discussion (§14.3): click to load, nothing is requested before the click */}
          <Suspense fallback={null}>
            <Discussion kind="lesson" id={lesson.id} />
          </Suspense>

          {/* previous, and Up Next with its why (lesson.md §7; wave-1.md §7.3) */}
          <nav aria-label="Previous lesson and Up Next" className="mt-16 grid grid-cols-1 gap-4 border-t border-line pt-8 sm:grid-cols-2">
            {prev ? (
              <Link
                to={lessonPath(prev)}
                className="group rounded-lg border border-line bg-surface-1 p-4 transition-all duration-180 hover:-translate-y-0.5 hover:border-line-bright"
              >
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
                  <ArrowLeft size={12} /> previous
                </span>
                <span className="mt-1.5 block truncate font-display text-body-sm font-medium text-text-1">
                  {prev.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            <LessonUpNext lesson={lesson} trackColor={track.color} />
            {!next && (
              <div className="sm:col-span-2 sm:w-1/2 sm:justify-self-end">
                <CapstoneLink />
              </div>
            )}
          </nav>
        </article>

        {/* right rail */}
        <aside aria-label="On this page and controls" className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto py-12 scrollbar-slim lg:block">
          <RightRail
            lesson={lesson}
            headings={headings}
            activeId={activeId}
            pctRef={pctRef}
            status={status}
            onFinish={finish}
            onContinue={continueAnyway}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        </aside>
      </div>

      {/* sticky finish bar (lesson.md §5): at the end of a lesson that is neither passed nor read */}
      <AnimatePresence>
        {showCompleteBar && !done && !read && (
          <motion.div
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 64, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md lg:bottom-14"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line-bright bg-surface-1/95 px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,.5)] backdrop-blur">
              <p className="font-mono text-[11px] text-text-2">
                end of lesson · {lesson.ticket ? 'pass the ticket to finish' : 'pass the checkpoint to finish'}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {!lesson.ticket && (
                  <button
                    type="button"
                    onClick={continueAnyway}
                    data-continue-anyway
                    className="min-h-11 rounded-md border border-line bg-surface-2 px-3 py-2 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
                  >
                    Continue anyway (read)
                  </button>
                )}
                <button
                  type="button"
                  onClick={finish}
                  data-complete-control
                  className="min-h-11 rounded-md bg-accent px-4 py-2 font-display text-body-sm font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
                >
                  {finishLabel(lesson)}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* mobile drawers */}
      <AnimatePresence>
        {navOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm lg:hidden"
              onClick={() => setNavOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 left-0 z-50 w-[280px] border-r border-line bg-surface-1 lg:hidden"
            >
              <div className="flex justify-end p-2">
                <button type="button" onClick={() => setNavOpen(false)} aria-label="Close" className="p-2 text-text-3">
                  <X size={16} />
                </button>
              </div>
              <TrackNav lesson={lesson} onNavigate={() => setNavOpen(false)} />
            </motion.div>
          </>
        )}
        {tocOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm lg:hidden"
              onClick={() => setTocOpen(false)}
            />
            <motion.div
              initial={{ x: 280 }}
              animate={{ x: 0 }}
              exit={{ x: 280 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="fixed inset-y-0 right-0 z-50 w-[280px] overflow-y-auto border-l border-line bg-surface-1 p-5 scrollbar-slim lg:hidden"
            >
              <div className="mb-4 flex justify-end">
                <button type="button" onClick={() => setTocOpen(false)} aria-label="Close" className="p-1 text-text-3">
                  <X size={16} />
                </button>
              </div>
              <RightRail
                lesson={lesson}
                headings={headings}
                activeId={activeId}
                pctRef={pctRef}
                status={status}
                onFinish={() => {
                  setTocOpen(false)
                  finish()
                }}
                onContinue={() => {
                  continueAnyway()
                  setTocOpen(false)
                }}
                onOpenShortcuts={() => {
                  setTocOpen(false)
                  setShortcutsOpen(true)
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* toast + modals */}
      <AnimatePresence>{toast && <Toast toast={toast} onClose={() => setToast(null)} />}</AnimatePresence>
      <AnimatePresence>{shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}</AnimatePresence>
      <AnimatePresence>{trackDoneOpen && <TrackCompleteModal trackId={lesson.trackId} onClose={() => setTrackDoneOpen(false)} />}</AnimatePresence>
    </div>
  )
}
