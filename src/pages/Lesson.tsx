/**
 * Lesson engine (lesson.md): three-rail layout — track navigator (264px),
 * 720px reading column, right rail with ON THIS PAGE + controls.
 * Reading-progress bar via rAF (no re-renders), scrollPct resume, keyboard
 * shortcuts (←/→ j/k e m ? esc), quiz-gated exam completion, XP toast flow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  GraduationCap,
  Keyboard,
  List,
  ListTree,
  Lock,
  OctagonX,
  RotateCcw,
  Terminal,
  X,
} from 'lucide-react'
import { XP, rankForXp, selectTrackPct, useProgress } from '@/lib/progress'
import AgentActions from '@/components/AgentActions'
import { getTrack, CAPSTONE } from '@/lib/tracks'
import {
  lessonById,
  lessonsForTrack,
  nextLesson,
  prevLesson,
  lessonPath,
} from '@/data/lessons'
import type { Lesson } from '@/data/lessons/types'
import { RenderBlock } from '@/pages/lesson/blocks'
import { countH2, extractHeadings } from '@/pages/lesson/markdown'
import { EXERCISE_META } from '@/pages/lesson/exercise-meta'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

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
  canComplete: boolean
  examGate: boolean
  done: boolean
  onComplete: () => void
  onOpenShortcuts: () => void
}

function RightRail({
  lesson,
  headings,
  activeId,
  pctRef,
  canComplete,
  examGate,
  done,
  onComplete,
  onOpenShortcuts,
}: RightRailProps) {
  const track = getTrack(lesson.trackId)!
  const hasExercise = lesson.blocks.some((b) => b.type === 'exercise')

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
          onClick={onComplete}
          disabled={done || !canComplete}
          title={examGate ? 'Requires ≥80% on the checkpoint quiz' : undefined}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 font-display text-body-sm font-semibold transition-all duration-150 active:scale-[.97]',
            done
              ? 'cursor-default bg-accent-dim text-accent'
              : canComplete
                ? 'bg-accent text-accent-foreground hover:-translate-y-px'
                : 'cursor-not-allowed border border-line bg-surface-2 text-text-3',
          )}
        >
          {done ? (
            <>
              <CheckCircle2 size={15} /> Completed
            </>
          ) : examGate ? (
            <>
              <Lock size={14} /> Mark complete
            </>
          ) : (
            <>
              <Check size={15} /> Mark complete
            </>
          )}
        </button>
        {examGate && !done && (
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-amber">
            EXAM — unlocks at ≥80% on the checkpoint quiz
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
    const t = setTimeout(onClose, 3500)
    return () => clearTimeout(t)
  }, [onClose, toast])
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-md border border-line bg-surface-2 px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,.5)] lg:bottom-14"
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
    ['m', 'mark complete'],
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
  const trackLessons = lessonsForTrack(lesson.trackId)
  const next = nextLesson(lesson)
  const prev = prevLesson(lesson)
  const nextTrack = next && next.trackId !== lesson.trackId ? getTrack(next.trackId) : null

  const progress = useProgress((s) => s.lessons[lesson.id])
  const markLessonStatus = useProgress((s) => s.markLessonStatus)
  const setLessonScroll = useProgress((s) => s.setLessonScroll)
  const unlockAchievement = useProgress((s) => s.unlockAchievement)

  const done = progress?.status === 'done'
  const quizScore = progress?.quizScore
  const examGate = !!lesson.exam && (quizScore ?? 0) < 0.8
  const canComplete = !examGate

  const headings = useMemo(() => extractHeadings(lesson.blocks), [lesson])
  const blockOffsets = useMemo(() => {
    let h2 = 0
    return lesson.blocks.map((b) => {
      const start = h2
      if (b.type === 'prose') h2 += countH2(b.md)
      return start
    })
  }, [lesson])

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

  /* mark reading on mount (also creates the record for scroll saves) */
  useEffect(() => {
    if (useProgress.getState().lessons[lesson.id]?.status !== 'done') {
      markLessonStatus(lesson.id, 'reading')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id])

  /* resume position (runs after Layout's scroll-to-top) */
  useEffect(() => {
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
  }, [lesson.id])

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

  const complete = useCallback(() => {
    if (done || !canComplete) return
    markLessonStatus(lesson.id, 'done')
    const pct = selectTrackPct(lesson.trackId, trackLessons.length)(useProgress.getState())
    setToast({ msg: `+${XP.lesson} XP — lesson complete`, detail: `${track.code} progress ${pct}% · rank ${rankForXp(useProgress.getState().xp).name}` })
    const allDone = trackLessons.every((l) =>
      l.id === lesson.id ? true : useProgress.getState().lessons[l.id]?.status === 'done',
    )
    if (allDone) {
      unlockAchievement(`track-${lesson.trackId}`)
      setTimeout(() => setTrackDoneOpen(true), 600)
    }
  }, [done, canComplete, markLessonStatus, lesson, trackLessons, track.code, unlockAchievement])

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
          complete()
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
  }, [prev, next, navigate, stepSection, complete])

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
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] lg:block">
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
                  <GraduationCap size={11} /> ★ exam · quiz ≥80% to complete
                </span>
              )}
              {done && (
                <span className="flex items-center gap-1.5 font-mono text-[11px] text-accent">
                  <CheckCircle2 size={12} /> done
                </span>
              )}
              {resumePct !== null && !done && (
                <span className="font-mono text-[11px] text-text-3">resumed at {resumePct}%</span>
              )}
              <AgentActions lessonId={lesson.id} title={lesson.title} />
            </div>
          </header>

          {/* blocks */}
          {lesson.blocks.map((b, i) => (
            <RenderBlock key={i} block={b} lesson={lesson} trackColor={track.color} h2Start={blockOffsets[i]} />
          ))}

          {/* prev / next (lesson.md §7) */}
          <nav className="mt-16 grid gap-4 border-t border-line pt-8 sm:grid-cols-2">
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
            {next ? (
              <Link
                to={lessonPath(next)}
                className="group rounded-lg border p-4 text-right transition-all duration-180 hover:-translate-y-0.5"
                style={{ borderColor: `${track.color}55`, backgroundColor: `${track.color}0d` }}
              >
                <span className="flex items-center justify-end gap-1.5 font-mono text-[11px]" style={{ color: track.color }}>
                  {nextTrack ? `next track · ${nextTrack.code}` : 'next lesson'} <ArrowRight size={12} />
                </span>
                <span className="mt-1.5 block truncate font-display text-body-sm font-medium text-text-1">
                  {next.title}
                </span>
                <span className="mt-1 block font-mono text-[10px] text-text-3">{next.minutes} min · {nextTrack?.name ?? track.name}</span>
              </Link>
            ) : (
              <Link
                to="/capstone"
                className="group rounded-lg border border-transparent bg-grad-brand p-[1px] transition-all duration-180 hover:-translate-y-0.5"
              >
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
            )}
          </nav>
        </article>

        {/* right rail */}
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] overflow-y-auto py-12 scrollbar-slim lg:block">
          <RightRail
            lesson={lesson}
            headings={headings}
            activeId={activeId}
            pctRef={pctRef}
            canComplete={canComplete}
            examGate={examGate}
            done={done}
            onComplete={complete}
            onOpenShortcuts={() => setShortcutsOpen(true)}
          />
        </aside>
      </div>

      {/* sticky completion bar (lesson.md §5) */}
      <AnimatePresence>
        {showCompleteBar && !done && (
          <motion.div
            initial={{ y: 64, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 64, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 left-1/2 z-40 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 lg:bottom-14"
          >
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line-bright bg-surface-1/95 px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,.5)] backdrop-blur">
              <p className="font-mono text-[11px] text-text-2">
                end of lesson — {canComplete ? 'bank it?' : examGate ? 'quiz ≥80% required' : ''}
              </p>
              <button
                type="button"
                onClick={complete}
                disabled={!canComplete}
                className={cn(
                  'shrink-0 rounded-md px-4 py-2 font-display text-body-sm font-semibold transition-all duration-150 active:scale-[.97]',
                  canComplete ? 'bg-accent text-accent-foreground hover:-translate-y-px' : 'cursor-not-allowed border border-line bg-surface-2 text-text-3',
                )}
              >
                Mark complete · +{XP.lesson} XP
              </button>
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
                canComplete={canComplete}
                examGate={examGate}
                done={done}
                onComplete={() => {
                  complete()
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
