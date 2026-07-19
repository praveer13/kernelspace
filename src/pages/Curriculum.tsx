/**
 * Curriculum overview (curriculum.md): progress header with 120px ring,
 * the address-space stack (capstone on top → T0 base; mobile reverses to
 * T0→T5 via flex-col-reverse), expandable track layers with LessonRows,
 * dashed connectors with `requires` notes, "not sure where to start" strip
 * with a 5-question placement modal.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Check,
  ChevronDown,
  Compass,
  Flame,
  GraduationCap,
  Play,
  Terminal,
  X,
} from 'lucide-react'
import ProgressRing from '@/components/ProgressRing'
import { rankForXp, selectStreak, useProgress } from '@/lib/progress'
import { getTrack, TRACKS, CAPSTONE } from '@/lib/tracks'
import {
  ALL_LESSONS,
  ORDERED_LESSON_IDS,
  TRACK_EXTRAS,
  lessonsForTrack,
  simsForTrack,
  lessonPath,
} from '@/data/lessons'
import type { TrackId } from '@/data/lessons/types'
import LessonRow from '@/pages/lesson/LessonRow'
import { cn } from '@/lib/utils'

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

/* ------------------------------------------------------------------ */
/* placement quiz                                                      */
/* ------------------------------------------------------------------ */

const PLACEMENT: { q: string; options: string[]; correct: number }[] = [
  {
    q: 'A pointer in C is best described as…',
    options: ['An object reference with methods', 'An integer naming a byte address in memory', 'A garbage-collected handle', 'A database foreign key'],
    correct: 1,
  },
  {
    q: 'When the CPU needs data absent from all caches, it pays roughly…',
    options: ['1 ns', '10 ns', '100 ns (DRAM)', '10 ms'],
    correct: 2,
  },
  {
    q: 'A page fault occurs when…',
    options: [
      'The printer jams',
      'A virtual address has no mapped physical frame and the kernel must intervene',
      'The TLB is flushed by a context switch',
      'A malloc call returns NULL',
    ],
    correct: 1,
  },
  {
    q: 'Rust\'s borrow rule that kills data races at compile time is…',
    options: ['One reference per value', 'Many &T (shared) XOR one &mut T (exclusive)', 'References must be static', 'Mutexes on every type'],
    correct: 1,
  },
  {
    q: 'In LLM serving, the KV cache stores…',
    options: [
      'Model weights on disk',
      'Per-token key/value attention tensors so decode avoids recomputing the past',
      'Tokenized prompts',
      'GPU driver state',
    ],
    correct: 1,
  },
]

function recommendFor(score: number): TrackId {
  return (['t0', 't1', 't2', 't3', 't4', 't5'] as TrackId[])[Math.min(score, 5)]
}

function PlacementModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [score, setScore] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const finished = step >= PLACEMENT.length
  const rec = recommendFor(score)
  const recTrack = getTrack(rec)!
  const recLessons = lessonsForTrack(rec)

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
        className="w-full max-w-lg rounded-lg border border-line-bright bg-surface-1 p-6 shadow-[0_24px_80px_rgba(0,0,0,.6)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Placement check"
      >
        <div className="mb-5 flex items-center justify-between">
          <p className="font-mono text-label uppercase text-text-3">
            placement check · {finished ? 'result' : `${step + 1}/${PLACEMENT.length}`}
          </p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-3 hover:text-text-1">
            <X size={16} />
          </button>
        </div>

        {!finished ? (
          <>
            <div className="mb-5 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent transition-all duration-300" style={{ width: `${(step / PLACEMENT.length) * 100}%` }} />
            </div>
            <p className="font-display text-h4 text-text-1">{PLACEMENT[step].q}</p>
            <div className="mt-5 space-y-2">
              {PLACEMENT[step].options.map((opt, i) => {
                const isCorrect = picked !== null && i === PLACEMENT[step].correct
                const isWrongPick = picked === i && i !== PLACEMENT[step].correct
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={picked !== null}
                    onClick={() => {
                      setPicked(i)
                      if (i === PLACEMENT[step].correct) setScore((s) => s + 1)
                      setTimeout(() => {
                        setPicked(null)
                        setStep((s) => s + 1)
                      }, 700)
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left text-body-sm transition-colors duration-150',
                      isCorrect
                        ? 'border-accent bg-accent-dim text-text-1'
                        : isWrongPick
                          ? 'border-danger bg-danger/10 text-text-1'
                          : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
                    )}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-line font-mono text-[10px]">
                      {isCorrect ? <Check size={11} className="text-accent" /> : String.fromCharCode(65 + i)}
                    </span>
                    {opt}
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <div className="text-center">
            <p className="font-mono text-[11px] text-text-3">
              you scored {score}/{PLACEMENT.length} — your entry segment:
            </p>
            <p className="mt-3 font-display text-h2" style={{ color: recTrack.color }}>
              {recTrack.code} · {recTrack.name}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-body-sm text-text-2">{recTrack.promise}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-line bg-surface-2 px-4 py-2 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
              >
                Browse the map
              </button>
              <Link
                to={lessonPath(recLessons[0])}
                className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-display text-body-sm font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px"
              >
                <Play size={14} /> Start {recTrack.code}.L1
              </Link>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* track layer (accordion)                                             */
/* ------------------------------------------------------------------ */

function TrackLayer({
  trackId,
  open,
  onToggle,
}: {
  trackId: TrackId
  open: boolean
  onToggle: () => void
}) {
  const track = getTrack(trackId)!
  const extras = TRACK_EXTRAS[trackId]
  const lessons = lessonsForTrack(trackId)
  const sims = simsForTrack(trackId)
  const Glyph = track.glyph
  const lessonStates = useProgress((s) => s.lessons)
  const doneCount = lessons.filter((l) => lessonStates[l.id]?.status === 'done').length
  const pct = Math.round((doneCount / lessons.length) * 100)
  const hours = Math.round((lessons.reduce((n, l) => n + l.minutes, 0) / 60) * 2) / 2
  const exerciseCount = lessons.filter((l) => l.exercise === 'sim' || l.exercise === 'code' || l.exercise === 'quiz+sim').length
  const state = doneCount === lessons.length ? 'done' : doneCount > 0 ? 'in progress' : 'not started'
  const resume = lessons.find((l) => lessonStates[l.id]?.status !== 'done') ?? lessons[0]

  return (
    <div className="relative">
      {/* connector note above this layer */}
      <div className="flex items-center gap-3 py-1 pl-6">
        <span className="h-6 border-l border-dashed border-line-bright" />
        <span className="font-mono text-[10px] text-text-3">{extras.requires}</span>
      </div>

      <div
        className={cn(
          'relative overflow-hidden rounded-lg border bg-surface-1 transition-colors duration-180',
          open ? 'border-line-bright' : 'border-line hover:border-line-bright',
        )}
      >
        {/* left memory-segment bar */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: track.color }} />

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex w-full items-center gap-4 px-5 py-4 pl-6 text-left"
        >
          <Glyph size={24} strokeWidth={1.75} style={{ color: track.color }} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono text-label uppercase" style={{ color: track.color }}>
                {track.code}
              </span>
              <span className="font-display text-h4 text-text-1">{track.name}</span>
            </span>
            <span className="mt-0.5 hidden truncate text-body-sm text-text-3 md:block">{track.promise}</span>
          </span>
          <span className="hidden shrink-0 font-mono text-[11px] text-text-3 lg:block">
            {lessons.length} lessons · {exerciseCount} exercises · ~{hours}h
          </span>
          <span
            className={cn(
              'hidden shrink-0 rounded-full border px-2.5 py-0.5 font-mono text-[10px] sm:block',
              state === 'done'
                ? 'border-accent/40 bg-accent-dim text-accent'
                : state === 'in progress'
                  ? 'border-line-bright text-text-2'
                  : 'border-line text-text-3',
            )}
          >
            {state === 'done' ? `done ${doneCount}/${lessons.length}` : state}
          </span>
          <ProgressRing value={pct} size={48} color={track.color} />
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }} className="shrink-0 text-text-3">
            <ChevronDown size={18} />
          </motion.span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="border-t border-line px-3 py-3 pl-5">
                <div className="divide-y divide-line/60">
                  {lessons.map((l) => (
                    <LessonRow key={l.id} lesson={l} trackColor={track.color} current={l.id === resume.id && doneCount > 0} />
                  ))}
                </div>
                {sims.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line/60 px-3 pt-3">
                    <span className="font-mono text-[10px] uppercase text-text-3">linked sims</span>
                    {sims.map(({ sim }) => (
                      <Link
                        key={sim.id}
                        to={`/lab/${sim.id}`}
                        className="flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 font-mono text-[10px] text-text-2 transition-colors duration-150 hover:border-line-bright hover:text-text-1"
                      >
                        <sim.icon size={11} style={{ color: track.color }} />
                        {sim.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function CurriculumPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const lessonStates = useProgress((s) => s.lessons)
  const xp = useProgress((s) => s.xp)
  const streak = useProgress(selectStreak)

  const doneCount = ORDERED_LESSON_IDS.filter((id) => lessonStates[id]?.status === 'done').length
  const overallPct = Math.round((doneCount / ORDERED_LESSON_IDS.length) * 100)
  const rank = rankForXp(xp)

  const nextRecommended = useMemo(() => {
    const id = ORDERED_LESSON_IDS.find((l) => lessonStates[l]?.status !== 'done') ?? ORDERED_LESSON_IDS[0]
    return ALL_LESSONS.find((l) => l.id === id)!
  }, [lessonStates])

  const [open, setOpen] = useState<Set<TrackId>>(() => new Set([nextRecommended.trackId]))
  const [placementOpen, setPlacementOpen] = useState(searchParams.get('placement') === '1')

  const toggle = (t: TrackId) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  const closePlacement = () => {
    setPlacementOpen(false)
    if (searchParams.get('placement')) setSearchParams({}, { replace: true })
  }

  return (
    <div className="relative">
      {/* ------------------------------ header ------------------------------ */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 bg-grad-radial-glow" />
        <div className="absolute inset-0 bg-blueprint opacity-40" style={{ maskImage: 'linear-gradient(to bottom, black, transparent)' }} />
        <div className="relative mx-auto grid max-w-app gap-8 px-6 py-14 lg:grid-cols-[1fr_auto] lg:px-12 lg:py-16">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <p className="font-mono text-label uppercase text-text-3">0x02 — address space map</p>
            <h1 className="mt-3 font-display text-display-lg text-text-1">Curriculum</h1>
            <p className="mt-4 max-w-measure text-body-lg text-text-2">
              Six tracks, forty lessons, one capstone. The stack reads bottom to top: memory physics at the
              base, production serving at the summit. Every layer is unlocked — the order is the point.
            </p>
            {/* legend */}
            <div className="mt-6 flex flex-wrap items-center gap-4 font-mono text-[11px] text-text-3">
              <span className="flex items-center gap-1.5">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <Check size={9} strokeWidth={3} />
                </span>
                done
              </span>
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-4 w-4 items-center justify-center">
                  <span className="absolute inset-0 animate-ping rounded-full border border-accent opacity-60 [animation-duration:1.6s]" />
                  <span className="h-4 w-4 rounded-full border-2 border-accent" />
                </span>
                current
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-4 w-4 rounded-full border border-line" />
                todo
              </span>
              <span className="flex items-center gap-1.5">
                <GraduationCap size={14} className="text-amber" />
                exam
              </span>
            </div>
            {doneCount === 0 && (
              <p className="mt-5 inline-flex items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-2 font-mono text-[11px] text-text-2">
                <span className="h-2 w-2 animate-pulse rounded-sm bg-accent" />
                nothing allocated yet — the address space is all yours. Start at T0.L1.
              </p>
            )}
          </motion.div>

          {/* stats cluster */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
            className="flex items-center gap-6 lg:flex-col lg:items-end lg:justify-center"
          >
            <div className="flex items-center gap-4">
              <ProgressRing value={overallPct} size={120} color="#3EF2A4" />
              <div className="space-y-2">
                <div>
                  <p className="font-display text-stat text-text-1">
                    {doneCount}
                    <span className="text-h4 text-text-3">/40</span>
                  </p>
                  <p className="font-mono text-[11px] text-text-3">lessons allocated</p>
                </div>
                <div>
                  <p className="font-mono text-body-sm text-text-1">
                    {xp} XP <span className="text-text-3">·</span>{' '}
                    <span className="text-accent">{rank.name}</span>
                  </p>
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
                    <Flame size={11} className="text-amber" /> {streak} day uptime
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* --------------------------- the stack --------------------------- */}
      <section className="mx-auto max-w-app px-6 py-12 lg:px-12">
        {/* DOM order T0..T5,capstone; desktop reverses → capstone on top */}
        <div className="flex flex-col gap-2 lg:flex-col-reverse">
          {TRACKS.map((t) => (
            <TrackLayer key={t.id} trackId={t.id as TrackId} open={open.has(t.id as TrackId)} onToggle={() => toggle(t.id as TrackId)} />
          ))}

          {/* capstone layer (DOM-last = visual top on desktop) */}
          <div className="relative">
            <div className="flex items-center gap-3 py-1 pl-6">
              <span className="h-6 border-l border-dashed border-line-bright" />
              <span className="font-mono text-[10px] text-text-3">requires T5 · the whole stack</span>
            </div>
            <Link
              to="/capstone"
              className="group block rounded-lg border border-transparent bg-grad-brand p-[1px] transition-all duration-180 hover:-translate-y-0.5"
            >
              <span className="flex items-center gap-4 rounded-[7px] bg-surface-1 px-5 py-4">
                <Terminal size={24} strokeWidth={1.75} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-mono text-label uppercase text-grad-brand">{CAPSTONE.code}</span>
                    <span className="font-display text-h4 text-text-1">{CAPSTONE.name}</span>
                  </span>
                  <span className="mt-0.5 hidden truncate text-body-sm text-text-3 md:block">
                    the whole address space — build a toy inference engine end to end
                  </span>
                </span>
                <span className="hidden shrink-0 font-mono text-[11px] text-text-3 lg:block">7 steps</span>
                <ArrowRight size={18} className="shrink-0 text-text-3 transition-transform duration-150 group-hover:translate-x-1 group-hover:text-accent" />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------- not sure where to start --------------------- */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-app px-6 py-12 lg:px-12">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-h3 text-text-1">Not sure where to start?</h2>
            <button
              type="button"
              onClick={() => setPlacementOpen(true)}
              className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
            >
              <Compass size={14} className="text-accent" />
              take the 2-min placement check
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                who: 'Total beginner to systems',
                path: 'Start at the base: latency numbers, cache lines, your runtime.',
                cta: 'T0 · L1 — Why systems',
                to: `/lesson/${ORDERED_LESSON_IDS[0]}`,
              },
              {
                who: 'You know some C / Rust',
                path: 'Skip to the OS layer: paging, eviction, scheduling — the vLLM exam.',
                cta: 'T2 · L1 — Processes & threads',
                to: `/lesson/t2.l1`,
              },
              {
                who: 'Here for vLLM only',
                path: 'Straight to serving systems — but T2/T4 holes will show. Fair warning.',
                cta: 'T5 · L4 — KV cache math',
                to: '/lesson/t5.l4',
                warn: true,
              },
            ].map((c) => (
              <Link
                key={c.cta}
                to={c.to}
                className="group rounded-lg border border-line bg-surface-1 p-5 transition-all duration-180 hover:-translate-y-1 hover:border-line-bright hover:shadow-[0_12px_32px_rgba(0,0,0,.4)]"
              >
                <p className="font-mono text-label uppercase text-text-3">{c.who}</p>
                <p className="mt-2 text-body-sm text-text-2">{c.path}</p>
                <p className="mt-4 flex items-center gap-1.5 font-mono text-[11px] text-accent">
                  {c.cta}
                  <ArrowRight size={12} className="transition-transform duration-150 group-hover:translate-x-1" />
                </p>
                {c.warn && <p className="mt-2 font-mono text-[10px] text-amber">⚠ skip-the-line route</p>}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <AnimatePresence>{placementOpen && <PlacementModal onClose={closePlacement} />}</AnimatePresence>
    </div>
  )
}
