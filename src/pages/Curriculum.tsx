/**
 * Curriculum overview (curriculum.md): progress header with 120px ring,
 * the address-space stack (capstone on top → Rust Zero base; mobile reverses
 * into curriculum order), expandable track layers with LessonRows,
 * dashed connectors with `requires` notes, "not sure where to start" strip
 * that opens the placement walk (≤ 20 items, wave-1.md §7.1). The "current"
 * marker is the first lesson of the learner's path plan (paths.ts, placement
 * applied) that is neither done nor read; a lesson only read is marked as such.
 */

import { lazy, Suspense, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  Compass,
  Flame,
  GraduationCap,
  Terminal,
} from 'lucide-react'
import ProgressRing from '@/components/ProgressRing'
import { selectRings } from '@/lib/economy'
import { selectStreak, TOTAL_LESSONS, useProgress } from '@/lib/progress'
import { getTrack, TRACKS, CAPSTONE } from '@/lib/tracks'
import { KCS } from '@/data/kc'
import { ALL_LESSONS, ORDERED_LESSON_IDS, TRACK_EXTRAS, lessonsForTrack, simsForTrack } from '@/data/lessons'
import type { TrackId } from '@/data/lessons/types'
import LessonRow from '@/pages/lesson/LessonRow'
import { cn } from '@/lib/utils'
import { cachedPathPlan, lessonCode, pathOf, PATH_LABEL, type PathGraph } from '@/lib/learner/paths'
import { currentLesson, readPlacement } from '@/lib/learner/placement'

// the walk loads on demand: it pulls the item player and the generator families, which a map visit never needs
const PlacementWalk = lazy(() => import('@/components/learner/PlacementWalk'))

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

/** What a path plan reads: labs do not change which lesson is current. */
const PLAN_GRAPH: PathGraph = { kcs: KCS, lessons: ALL_LESSONS, labs: [] }

/* ------------------------------------------------------------------ */
/* track layer (accordion)                                             */
/* ------------------------------------------------------------------ */

function TrackLayer({
  trackId,
  open,
  onToggle,
  currentId,
  rTestOut,
}: {
  trackId: TrackId
  open: boolean
  onToggle: () => void
  /** The path plan's current lesson (any track), or null. */
  currentId: string | null
  /** A placement found Rust reading solid (or skipped it): R is offered as test-outs. */
  rTestOut: boolean
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
  // read = finished without passing: navigation only, so it never moves the percentage or the badge's count
  const readCount = lessons.filter((l) => lessonStates[l.id]?.status === 'read').length
  const state = doneCount === lessons.length ? 'done' : doneCount > 0 || readCount > 0 ? 'in progress' : 'not started'

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
            {state === 'done' ? `done ${doneCount}/${lessons.length}` : readCount > 0 ? `${state} · ${readCount} read` : state}
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
                {trackId === 'r' && rTestOut && (
                  <p className="px-3 pb-3 font-mono text-[11px] text-text-3">
                    placement found your Rust reading solid: open any lesson here and test out of it.
                  </p>
                )}
                <div className="divide-y divide-line/60">
                  {lessons.map((l) => (
                    <div key={l.id}>
                      <LessonRow lesson={l} trackColor={track.color} current={l.id === currentId} />
                      {lessonStates[l.id]?.status === 'read' && (
                        <p className="-mt-1.5 flex items-center gap-1.5 pb-2.5 pl-14 font-mono text-[11px] text-text-3">
                          <BookOpenCheck size={12} aria-hidden /> read, not passed: its check is still open
                        </p>
                      )}
                    </div>
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
  // the highest ring earned from the ledger, never an XP threshold (spec 8.5)
  const rank = useProgress((s) => selectRings(s.aggregate).rank)

  // the path plan (paths.ts) with the placement applied: its first lesson that is neither done nor read is "current"
  const path = pathOf(useProgress((s) => s.working['boot:path']))
  const placementRaw = useProgress((s) => s.working['placement:result'])
  const placement = useMemo(() => readPlacement(placementRaw), [placementRaw])
  const plan = cachedPathPlan(path, PLAN_GRAPH, placement)
  const started = ORDERED_LESSON_IDS.some((id) => (lessonStates[id]?.status ?? 'unstarted') !== 'unstarted')
  const currentId = started || placement ? currentLesson(plan, (id) => lessonStates[id]?.status) : null
  const firstId = currentId ?? plan.lessons[0] ?? ORDERED_LESSON_IDS[0]
  const placedAt = placement ? getTrack(placement.entryTrack) : undefined

  const [open, setOpen] = useState<Set<TrackId>>(() => new Set([(ALL_LESSONS.find((l) => l.id === firstId)?.trackId ?? 'r') as TrackId]))
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
              {TRACKS.length} tracks, {TOTAL_LESSONS} lessons, one capstone. The stack starts with a Rust ramp, builds from
              memory physics, and ends at production serving. Every layer is unlocked — the order is the point.
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
                <BookOpenCheck size={14} className="text-text-2" aria-hidden />
                read, not passed
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
                nothing allocated yet — the address space is all yours. Start at {lessonCode(firstId)}.
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
                    <span className="text-h4 text-text-3">/{TOTAL_LESSONS}</span>
                  </p>
                  <p className="font-mono text-[11px] text-text-3">lessons allocated</p>
                </div>
                <div>
                  <p className="font-mono text-body-sm text-text-1">
                    {xp} XP <span className="text-text-3">·</span>{' '}
                    <span className="text-accent">{rank}</span>
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

      {/* ------------------------- the placement walk ------------------------- */}
      {placementOpen && (
        <section aria-label="Placement" className="mx-auto max-w-app px-6 pt-8 lg:px-12">
          <Suspense fallback={<p className="rounded-lg border border-line bg-surface-1 p-5 text-body-sm text-text-2">Preparing the placement walk.</p>}>
            <PlacementWalk path={path} onClose={closePlacement} />
          </Suspense>
        </section>
      )}

      {/* --------------------------- the stack --------------------------- */}
      <section className="mx-auto max-w-app px-6 py-12 lg:px-12">
        {/* DOM order R..T7,capstone; desktop reverses → capstone on top */}
        <div className="flex flex-col gap-2 lg:flex-col-reverse">
          {TRACKS.map((t) => (
            <TrackLayer
              key={t.id}
              trackId={t.id as TrackId}
              open={open.has(t.id as TrackId)}
              onToggle={() => toggle(t.id as TrackId)}
              currentId={currentId}
              rTestOut={plan.testOut.length > 0}
            />
          ))}

          {/* capstone layer (DOM-last = visual top on desktop) */}
          <div className="relative">
            <div className="flex items-center gap-3 py-1 pl-6">
              <span className="h-6 border-l border-dashed border-line-bright" />
              <span className="font-mono text-[10px] text-text-3">unlocks after T5 · best after T7</span>
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
            {!placementOpen && (
              <button
                type="button"
                onClick={() => setPlacementOpen(true)}
                className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
              >
                <Compass size={14} className="text-accent" aria-hidden />
                {placement ? 'retake the placement walk' : 'take the placement walk · up to 20 items, about 15 min'}
              </button>
            )}
          </div>
          {placement && (
            <p className="mb-6 max-w-measure text-body-sm text-text-2">
              Your placement started you at {placedAt ? `${placedAt.code} · ${placedAt.name}` : placement.entryTrack.toUpperCase()}: {placement.solidKcs.length} solid,{' '}
              {placement.missedKcs.length} to work on, on {PATH_LABEL[path]}. Nothing is locked: every layer below is open.
            </p>
          )}
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

    </div>
  )
}
