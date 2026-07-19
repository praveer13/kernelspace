/**
 * Track detail (track.md): layered hero with ghost glyph + blueprint tint,
 * outcomes, full lesson list with hooks, linked-sim cards, prev/next track.
 */

import { Link, useParams } from 'react-router'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Compass,
  GraduationCap,
  Play,
  Terminal,
} from 'lucide-react'
import ProgressRing from '@/components/ProgressRing'
import { selectTrackPct, useProgress } from '@/lib/progress'
import { getTrack, TRACKS, CAPSTONE } from '@/lib/tracks'
import { TRACK_EXTRAS, lessonsForTrack, simsForTrack, lessonPath } from '@/data/lessons'
import type { TrackId } from '@/data/lessons/types'
import LessonRow from '@/pages/lesson/LessonRow'

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

function TrackNotFound({ id }: { id?: string }) {
  return (
    <div className="mx-auto flex max-w-prose flex-col items-center px-6 py-32 text-center">
      <p className="font-mono text-body text-danger">address error</p>
      <p className="mt-2 font-mono text-body-sm text-text-3">
        track segment <span className="text-text-1">{id ?? '???'}</span> is unmapped
      </p>
      <Link
        to="/curriculum"
        className="mt-8 rounded-md border border-line bg-surface-2 px-5 py-2.5 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
      >
        Return to curriculum
      </Link>
    </div>
  )
}

export default function TrackPage() {
  const { trackId } = useParams()
  const track = trackId ? getTrack(trackId) : undefined
  if (!track) return <TrackNotFound id={trackId} />
  return <TrackView key={track.id} trackId={track.id as TrackId} />
}

function TrackView({ trackId }: { trackId: TrackId }) {
  const track = getTrack(trackId)!
  const extras = TRACK_EXTRAS[trackId]
  const lessons = lessonsForTrack(trackId)
  const sims = simsForTrack(trackId)
  const Glyph = track.glyph

  const lessonStates = useProgress((s) => s.lessons)
  const pct = useProgress(selectTrackPct(trackId, lessons.length))
  const doneCount = lessons.filter((l) => lessonStates[l.id]?.status === 'done').length

  const exerciseCount = lessons.filter((l) => l.exercise === 'sim' || l.exercise === 'code' || l.exercise === 'quiz+sim').length
  const hours = Math.round((lessons.reduce((n, l) => n + l.minutes, 0) / 60) * 2) / 2

  const resume = lessons.find((l) => lessonStates[l.id]?.status !== 'done') ?? lessons[0]
  const started = doneCount > 0
  const hasExam = lessons.some((l) => l.exam)

  const idx = TRACKS.findIndex((t) => t.id === trackId)
  const prevTrack = idx > 0 ? TRACKS[idx - 1] : null
  const nextTrack = idx < TRACKS.length - 1 ? TRACKS[idx + 1] : null
  const prereqTrack = idx > 0 ? TRACKS[idx - 1] : null

  return (
    <div className="relative">
      {/* ------------------------------ hero ------------------------------ */}
      <section className="relative overflow-hidden border-b border-line">
        {/* layered bg: gradient, tinted blueprint, ghost glyph, glow */}
        <div className="absolute inset-0 bg-gradient-to-b from-surface-1 to-ink" />
        <div
          className="absolute inset-0 bg-blueprint opacity-60"
          style={{ maskImage: 'linear-gradient(to bottom, black, transparent)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: `radial-gradient(60% 60% at 50% 0%, ${track.color}14, transparent 70%)` }}
        />
        <Glyph
          aria-hidden
          className="pointer-events-none absolute -right-8 top-1/2 hidden -translate-y-1/2 rotate-[-8deg] opacity-[.05] md:block"
          style={{ color: track.color, maskImage: 'linear-gradient(to left, black 30%, transparent)' }}
          size={320}
          strokeWidth={1}
        />

        <div className="relative mx-auto max-w-app px-6 py-14 lg:px-12 lg:py-20">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}>
            <nav className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
              <Link to="/curriculum" className="transition-colors hover:text-text-1">
                ~/curriculum
              </Link>
              <ChevronRight size={11} />
              <span style={{ color: track.color }}>{track.code}</span>
            </nav>

            <div className="mt-5 flex items-center gap-3">
              <span
                className="flex items-center gap-2 rounded-sm border px-2.5 py-1 font-mono text-label uppercase"
                style={{ borderColor: `${track.color}55`, color: track.color, backgroundColor: `${track.color}0d` }}
              >
                <Glyph size={14} strokeWidth={1.75} />
                {track.code}
              </span>
              <span className="font-mono text-label uppercase text-text-3">{extras.requires}</span>
            </div>

            <h1 className="mt-4 font-display text-display-lg text-text-1">{track.name}</h1>
            <p className="mt-4 max-w-measure text-body-lg text-text-2">{extras.pitch}</p>

            {/* meta chips */}
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <span className="rounded-full border border-line bg-surface-1 px-3 py-1 font-mono text-[11px] text-text-2">
                {lessons.length} lessons
              </span>
              <span className="rounded-full border border-line bg-surface-1 px-3 py-1 font-mono text-[11px] text-text-2">
                {exerciseCount} exercises
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 py-1 font-mono text-[11px] text-text-2">
                <Clock size={11} /> ~{hours}h
              </span>
              {hasExam && (
                <span className="flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-3 py-1 font-mono text-[11px] text-amber">
                  <GraduationCap size={11} /> includes exam
                </span>
              )}
              {prereqTrack && (
                <Link
                  to={`/tracks/${prereqTrack.id}`}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 py-1 font-mono text-[11px] text-text-3 transition-colors duration-150 hover:border-line-bright hover:text-text-1"
                >
                  requires {prereqTrack.code} <ArrowUpRight size={10} />
                </Link>
              )}
            </div>

            {/* stats + CTA */}
            <div className="mt-8 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3">
                <ProgressRing value={pct} size={64} color={track.color} />
                <div>
                  <p className="font-display text-h4 text-text-1">
                    {doneCount}/{lessons.length}
                  </p>
                  <p className="font-mono text-[11px] text-text-3">lessons done</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to={lessonPath(resume)}
                  className="flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
                >
                  <Play size={15} />
                  {started ? `Resume · L${resume.index} ${resume.title}` : 'Start track'}
                </Link>
                {trackId !== 't0' && (
                  <Link
                    to="/curriculum?placement=1"
                    className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2.5 font-display text-body-sm font-medium text-text-1 transition-colors duration-150 hover:border-line-bright"
                  >
                    <Compass size={14} /> take the placement check
                  </Link>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* --------------------------- outcomes --------------------------- */}
      <section className="mx-auto grid max-w-app gap-6 px-6 py-12 lg:grid-cols-[280px_1fr] lg:px-12">
        <h2 className="font-display text-h3 text-text-1 lg:sticky lg:top-24 lg:self-start">
          After this track
          <br />
          you can…
        </h2>
        <ul className="space-y-3">
          {extras.outcomes.map((o, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, x: 8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-10% 0px' }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: EASE }}
              className="flex items-start gap-3 rounded-md border border-line bg-surface-1 px-4 py-3.5"
            >
              <CheckCircle2 size={17} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: track.color }} />
              <span className="text-body text-text-2">{o}</span>
            </motion.li>
          ))}
        </ul>
      </section>

      {/* --------------------------- lesson list --------------------------- */}
      <section className="mx-auto max-w-app px-6 pb-12 lg:px-12">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-h3 text-text-1">Lessons</h2>
          <p className="hidden font-mono text-[11px] text-text-3 xl:block">{extras.sideNote}</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-surface-1">
          <div className="divide-y divide-line/60 p-1.5">
            {lessons.map((l) => {
              const isCurrent = l.id === resume.id && l.id !== lessons[0].id
              return (
                <LessonRow
                  key={l.id}
                  lesson={l}
                  trackColor={track.color}
                  current={isCurrent}
                  showDescription
                />
              )
            })}
          </div>
        </div>
        {hasExam && (
          <p className="mt-3 flex items-center gap-2 font-mono text-[11px] text-amber">
            <GraduationCap size={12} />
            the exam lesson requires ≥80% on its checkpoint quiz to mark complete — double XP.
          </p>
        )}
      </section>

      {/* ------------------------------ sims ------------------------------ */}
      {sims.length > 0 && (
        <section className="mx-auto max-w-app px-6 pb-14 lg:px-12">
          <h2 className="mb-4 font-display text-h3 text-text-1">Simulators in this track</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sims.map(({ sim, lesson }) => {
              const SimIcon = sim.icon
              return (
                <motion.div
                  key={sim.id}
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="group overflow-hidden rounded-lg border border-line bg-surface-1 transition-colors duration-180 hover:border-line-bright hover:shadow-[0_12px_32px_rgba(0,0,0,.4)]"
                >
                  <Link to={`/lab/${sim.id}`} className="block">
                    <div className="relative flex h-[140px] items-center justify-center bg-blueprint">
                      <span
                        className="flex h-14 w-14 items-center justify-center rounded-lg border bg-surface-2 transition-transform duration-300 group-hover:rotate-6"
                        style={{ borderColor: `${track.color}55`, color: track.color }}
                      >
                        <SimIcon size={26} strokeWidth={1.5} />
                      </span>
                      <span className="absolute right-3 top-3 font-mono text-[10px] uppercase text-text-3">
                        {sim.id}
                      </span>
                    </div>
                    <div className="border-t border-line p-4">
                      <p className="font-display text-h4 text-text-1">{sim.name}</p>
                      <p className="mt-1 text-body-sm text-text-2">{sim.hook}</p>
                      <p className="mt-3 font-mono text-[11px] text-text-3">
                        used in{' '}
                        <Link
                          to={lessonPath(lesson)}
                          className="text-text-2 underline-offset-2 transition-colors hover:text-accent hover:underline"
                        >
                          L{lesson.index} · {lesson.slug}
                        </Link>
                      </p>
                    </div>
                  </Link>
                </motion.div>
              )
            })}
          </div>
        </section>
      )}

      {/* ------------------------- prev / next track ------------------------- */}
      <section className="border-t border-line">
        <div className="mx-auto grid max-w-app gap-4 px-6 py-10 sm:grid-cols-2 lg:px-12">
          {prevTrack ? (
            <Link
              to={`/tracks/${prevTrack.id}`}
              className="group rounded-lg border border-line bg-surface-1 p-5 transition-all duration-180 hover:-translate-y-0.5 hover:border-line-bright"
            >
              <span className="flex items-center gap-1.5 font-mono text-[11px] text-text-3">
                <ArrowLeft size={12} /> previous track
              </span>
              <span className="mt-2 flex items-center gap-2 font-display text-h4 text-text-1">
                <prevTrack.glyph size={18} style={{ color: prevTrack.color }} />
                {prevTrack.code} · {prevTrack.name}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {nextTrack ? (
            <Link
              to={`/tracks/${nextTrack.id}`}
              className="group rounded-lg border p-5 text-right transition-all duration-180 hover:-translate-y-0.5"
              style={{ borderColor: `${nextTrack.color}55`, backgroundColor: `${nextTrack.color}0a` }}
            >
              <span className="flex items-center justify-end gap-1.5 font-mono text-[11px]" style={{ color: nextTrack.color }}>
                next track <ArrowRight size={12} />
              </span>
              <span className="mt-2 flex items-center justify-end gap-2 font-display text-h4 text-text-1">
                {nextTrack.code} · {nextTrack.name}
                <nextTrack.glyph size={18} style={{ color: nextTrack.color }} />
              </span>
            </Link>
          ) : (
            <Link to="/capstone" className="group rounded-lg border border-transparent bg-grad-brand p-[1px] transition-all duration-180 hover:-translate-y-0.5">
              <span className="block rounded-[7px] bg-surface-1 p-5 text-right">
                <span className="flex items-center justify-end gap-1.5 font-mono text-[11px] text-grad-brand">
                  final destination <ArrowRight size={12} />
                </span>
                <span className="mt-2 flex items-center justify-end gap-2 font-display text-h4 text-text-1">
                  {CAPSTONE.code} · {CAPSTONE.name}
                  <Terminal size={18} className="text-accent" />
                </span>
              </span>
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
