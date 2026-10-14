/**
 * /me, the journey: Progress's sections as they were, folded into one lazy section (wave-3.md §12.5, task 3b-06).
 * Rings with their checklists, the KPI band, the memory map, achievements, your engine, Up Next and the activity
 * heatmap. This section uses framer-motion, so it renders inside `MotionScope` (reduced motion is honoured; the
 * route itself is plain `lazy`, App.tsx). It imports no lesson content. Progress divided the lab tasks done by the free-text
 * tasks of the lesson blocks, a count that pulled all lesson content for a figure that was not what a learner completes
 * (D17: those link cards earn nothing); the sim registry would have been 36 KB gzip for a better one. So the line has no total.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { animate, motion, useInView, useReducedMotion } from 'framer-motion'
import {
  Braces,
  Cog,
  Cpu,
  Flame,
  Gauge,
  Grid3X3,
  Layers,
  Lock,
  Play,
  Power,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useProgress, selectStreak, localDateKey, TOTAL_LESSONS } from '@/lib/progress'
import type { ProgressState } from '@/lib/progress'
import { TRACKS, CAPSTONE, ORDERED_LESSON_IDS, SIMS } from '@/lib/tracks'
import { MotionScope } from '@/lib/motion'
import ProgressRing from '@/components/ProgressRing'
import { selectRings } from '@/lib/economy'
import type { AmberRing } from '@/lib/learner/ring-recall'
import XpExplainer from '@/pages/progress/XpExplainer'
import RingChecklists from '@/pages/progress/RingChecklists'
import { ringSections } from '@/pages/progress/ring-rows'
import { useRingEvidence } from '@/pages/progress/useRingEvidence'
import { useSummary } from '@/pages/progress/useSummary'
import { useUpNext, type UpNextState } from '@/lib/learner/up-next'
import UpNextCard from '@/components/learner/UpNextCard'
import { cn } from '@/lib/utils'

// The review model (calibration, week, hand-off) loads on demand, after the rings have painted.
const ReviewPanel = lazy(() => import('@/pages/progress/ReviewPanel'))
// Mount point that 2b-12 fills (wave-2.md §2.3); it renders nothing until then.
const EngineCard = lazy(() => import('@/components/engine/EngineCard'))

/* ---------------- shared bits ---------------- */

function useCountUp(target: number, start: boolean, duration = 0.8): number {
  const reduced = useReducedMotion()
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!start || reduced) return
    const controls = animate(0, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (x) => setV(x),
    })
    return () => controls.stop()
  }, [target, start, duration, reduced])
  return reduced && start ? target : v
}

const RANK_FLAVOR: Record<string, string> = {
  'RING 3': 'userland — safe mode only',
  'RING 2': 'kernel privileges: may allocate memory',
  'RING 1': 'kernel privileges: may touch page tables',
  'RING 0': 'kernel privileges: ring zero, full control',
  ROOT: 'kernel privileges: you are the kernel now',
}

const CAPSTONE_FLAGS_KEY = 'kernelspace:capstone:flags'

const LAST_LESSON_ADDRESS = Math.max(0, TOTAL_LESSONS - 1)
const MID_LESSON_ADDRESS = Math.floor(LAST_LESSON_ADDRESS / 2)
const hexAddress = (value: number) => `0x${value.toString(16).toUpperCase().padStart(2, '0')}`

function readCapstoneFlags(): { hints: boolean; optimizer: boolean } {
  try {
    const raw = localStorage.getItem(CAPSTONE_FLAGS_KEY)
    if (!raw) return { hints: false, optimizer: false }
    const p = JSON.parse(raw)
    return { hints: !!p.hints, optimizer: !!p.optimizer }
  } catch {
    return { hints: false, optimizer: false }
  }
}

/* ---------------- achievements catalog (progress.md §5) ---------------- */

interface AchievementDef {
  id: string
  name: string
  cond: string
  icon: LucideIcon
  color?: string
  derived: (s: ProgressState) => boolean
}

const trackDone = (s: ProgressState, tid: string, n: number) =>
  Object.entries(s.lessons).filter(
    ([id, l]) => id.startsWith(`${tid}.`) && l.status === 'done',
  ).length >= n

const TRACK_COMPLETION_ACHIEVEMENTS: AchievementDef[] = TRACKS.map((track) => ({
  id: `track-${track.id}`,
  name: `${track.code.toLowerCase()} complete`,
  cond: `complete all ${track.lessons} ${track.code} lessons`,
  icon: track.glyph,
  color: track.color,
  derived: (state) => trackDone(state, track.id, track.lessons),
}))

const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first-boot',
    name: 'first boot',
    cond: 'complete any lesson',
    icon: Power,
    color: '#3EF2A4',
    derived: (s) => Object.values(s.lessons).some((l) => l.status === 'done'),
  },
  {
    id: 'cache-warm',
    name: 'cache primed',
    cond: 'T0 warm-up · complete 5/6 lessons',
    icon: Layers,
    color: '#34D399',
    derived: (s) => trackDone(s, 't0', 5),
  },
  {
    id: 'heap-whisperer',
    name: 'heap whisperer',
    cond: 'T1 done + allocator tasks',
    icon: Braces,
    color: '#FBBF24',
    derived: (s) =>
      trackDone(s, 't1', 6) && (s.sims['sim-allocator']?.tasksDone.length ?? 0) > 0,
  },
  {
    id: 'kernel-mind',
    name: 'kernel mind',
    cond: 'T2 done · exam ≥ 80%',
    icon: Cpu,
    color: '#22D3EE',
    derived: (s) => trackDone(s, 't2', 7) && (s.lessons['t2.l7']?.quizScore ?? 0) >= 0.8,
  },
  {
    id: 'fearless-borrower',
    name: 'fearless borrower',
    cond: 'complete T3 — Rust',
    icon: ShieldCheck,
    color: '#F97316',
    derived: (s) => trackDone(s, 't3', 7),
  },
  {
    id: 'silicon-eye',
    name: 'silicon warmup',
    cond: 'T4 warm-up · complete 6/7 lessons',
    icon: Grid3X3,
    color: '#A78BFA',
    derived: (s) => trackDone(s, 't4', 6),
  },
  {
    id: 'serving-engineer',
    name: 'serving warmup',
    cond: 'T5 warm-up · complete 7/10 lessons',
    icon: Server,
    color: '#FB7185',
    derived: (s) => trackDone(s, 't5', 7),
  },
  ...TRACK_COMPLETION_ACHIEVEMENTS,
  {
    id: 'forge-first',
    name: 'first forging',
    cond: 'pass every required check in one Forge lab',
    icon: Braces,
    color: '#F97316',
    derived: (s) => Object.values(s.labs).some((lab) => lab.done),
  },
  {
    id: 'fleet-week',
    name: 'fleet survivor',
    cond: 'complete all four Fleet Week acts',
    icon: Gauge,
    color: '#5CA8FF',
    derived: (s) => s.fleetWeek.actsDone.length >= 4,
  },
  {
    id: 'engine-builder',
    name: 'engine builder',
    cond: 'finish the capstone',
    icon: Cog,
    color: '#3EF2A4',
    derived: (s) => s.capstone.stepsDone.length >= 7,
  },
  {
    id: 'no-hints',
    name: 'no hints',
    cond: 'capstone, zero solutions viewed',
    icon: Sparkles,
    color: '#3EF2A4',
    derived: (s) => s.capstone.stepsDone.length >= 7 && !readCapstoneFlags().hints,
  },
  {
    id: 'optimizer',
    name: 'optimizer',
    cond: 'step-5 speedup ≥ 10×',
    icon: Gauge,
    color: '#FFB224',
    derived: () => readCapstoneFlags().optimizer,
  },
  {
    id: 'week-uptime',
    name: 'week uptime',
    cond: '7-day streak',
    icon: Flame,
    color: '#FF5C6C',
    derived: (s) => selectStreak(s) >= 7,
  },
]

/* ---------------- section 1: ring panel ---------------- */

/**
 * The highest ring earned and what each ring still needs (§8.5; wave-2.md §6.4). Rings are derived from the
 * ledger, never revoked and never a gate; amber (mean predicted recall under 0.8 over the ring's ideas) is only a
 * nudge to refresh. The headline reads the ledger's cold checks once they have loaded, which only ROOT needs.
 */
function RingPanel() {
  const xp = useProgress((s) => s.xp)
  const aggregate = useProgress((s) => s.aggregate)
  const lessons = useProgress((s) => s.lessons)
  const sims = useProgress((s) => s.sims)
  const { cold, recall } = useRingEvidence()
  const rings = useMemo(() => selectRings(aggregate, cold), [aggregate, cold])
  const sections = useMemo(() => ringSections(rings, cold !== undefined), [rings, cold])
  const { rank } = rings
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true })
  const shownXp = useCountUp(xp, inView)
  const done = Object.values(lessons).filter((l) => l.status === 'done').length
  const scored = Object.values(lessons).filter((l) => l.quizScore != null)
  const quizAvg = scored.length
    ? Math.round((scored.reduce((a, l) => a + (l.quizScore ?? 0), 0) / scored.length) * 100)
    : 0
  const labTasks = Object.values(sims).reduce((a, s) => a + s.tasksDone.length, 0)
  const amber = rings.earned.filter((r): r is AmberRing => r !== 'RING 3' && recall[r]?.amber === true)

  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : { opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-lg border border-line bg-surface-1 p-6"
      data-ring-panel
    >
      <div className="absolute inset-x-0 top-0 h-px bg-grad-brand" aria-hidden />
      <p className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">highest ring earned</p>
      <p className="mt-2 font-display text-[40px] font-bold leading-none text-text-1">{rank}</p>
      <p className="mt-2 font-mono text-[11px] text-text-3">{RANK_FLAVOR[rank]}</p>
      {amber.map((r) => {
        const mean = recall[r]?.mean
        return (
          mean != null && (
            <p key={r} data-ring-amber={r} className="mt-3 rounded-md border border-amber/50 bg-amber/10 px-3 py-2 text-body-sm text-text-1">
              Amber: predicted recall of {r}'s ideas is {Math.round(mean * 100)} %. Your ring stays; a short review on Today brings it up.
            </p>
          )
        )
      })}

      <h2 className="mt-5 font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">What each ring needs</h2>
      <RingChecklists sections={sections} />
      <p className="mt-2 text-[13px] text-text-3">
        Drills and labs count when their checks pass on numbers you have not seen. A ticket counts when you pass it, not when you read the
        lesson. Rings are earned on their own and nothing locks behind them.
      </p>

      <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-text-3">
        {Math.round(shownXp)} XP · lessons {done}/{TOTAL_LESSONS} · quizzes {quizAvg}% · lab tasks {labTasks}
      </p>
    </motion.div>
  )
}

/* ---------------- section 2: KPI band ---------------- */

function KpiBand() {
  const lessons = useProgress((s) => s.lessons)
  const streakDays = useProgress((s) => s.streakDays)
  const streak = useProgress(selectStreak)
  const sims = useProgress((s) => s.sims)
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })

  const done = Object.values(lessons).filter((l) => l.status === 'done').length
  const pct = Math.round((done / TOTAL_LESSONS) * 100)
  const scored = Object.values(lessons).filter((l) => l.quizScore != null)
  const passed = scored.filter((l) => (l.quizScore ?? 0) >= 0.8).length
  const quizAvg = scored.length
    ? Math.round((scored.reduce((a, l) => a + (l.quizScore ?? 0), 0) / scored.length) * 100)
    : 0
  const runs = Object.values(sims).reduce((a, s) => a + s.visits, 0)
  const topSim = useMemo(() => {
    let best: string | null = null
    let bestN = 0
    for (const [id, s] of Object.entries(sims)) {
      if (s.visits > bestN) {
        bestN = s.visits
        best = id
      }
    }
    return best ? (SIMS.find((x) => x.id === best)?.name ?? best) : null
  }, [sims])

  const shownPct = useCountUp(pct, inView)
  const shownStreak = useCountUp(streak, inView)
  const shownQuiz = useCountUp(quizAvg, inView)
  const shownRuns = useCountUp(runs, inView)

  const last14 = useMemo(() => {
    const set = new Set(streakDays)
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date()
      d.setDate(d.getDate() - (13 - i))
      return set.has(localDateKey(d))
    })
  }, [streakDays])

  return (
    <div ref={ref} className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
      {[
        <div key="k0" className="flex items-center gap-4">
          <ProgressRing value={pct} size={64} />
          <div>
            <p className="font-display text-stat text-text-1">{Math.round(shownPct)}%</p>
            <p className="font-mono text-[11px] text-text-3">
              {done}/{TOTAL_LESSONS} lessons
            </p>
          </div>
        </div>,
        <div key="k1">
          <p className="font-display text-stat text-text-1">{Math.round(shownStreak)}d</p>
          <p className="font-mono text-[11px] text-text-3">uptime</p>
          <div className="mt-2 flex gap-1">
            {last14.map((on, i) => (
              <span
                key={i}
                className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-accent' : 'bg-surface-3')}
              />
            ))}
          </div>
        </div>,
        <div key="k2">
          <p className="font-display text-stat text-text-1">{Math.round(shownQuiz)}%</p>
          <p className="font-mono text-[11px] text-text-3">best quiz average</p>
          <p className="mt-1 font-mono text-[11px] text-text-3">{passed} checkpoints passed</p>
        </div>,
        <div key="k3">
          <p className="font-display text-stat text-text-1">{Math.round(shownRuns)}</p>
          <p className="font-mono text-[11px] text-text-3">simulator runs</p>
          {topSim && (
            <p className="mt-1 inline-block rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-text-2">
              {topSim}
            </p>
          )}
        </div>,
      ].map((content, i) => (
        <motion.div
          key={i}
          initial={reduced ? false : { opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-md border border-line bg-surface-1 p-5"
        >
          {content}
        </motion.div>
      ))}
    </div>
  )
}

/* ---------------- section 3: track breakdown + address map ---------------- */

function TrackBreakdown({ nextId }: { nextId: string | null }) {
  const lessons = useProgress((s) => s.lessons)
  const stepsDone = useProgress((s) => s.capstone.stepsDone)
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })

  const rows = TRACKS.map((t) => {
    const doneN = Object.entries(lessons).filter(
      ([id, l]) => id.startsWith(`${t.id}.`) && l.status === 'done',
    ).length
    return { track: t, doneN, pct: Math.round((doneN / t.lessons) * 100) }
  })

  return (
    <div ref={ref} className="mt-14">
      <h2 className="font-display text-h3 text-text-1">memory map</h2>
      <div className="mt-5 grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-2.5">
          {rows.map(({ track, doneN, pct }, i) => {
            const Icon = track.glyph
            return (
              <motion.div
                key={track.id}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={inView ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 0.4, delay: i * 0.1 }}
              >
                <Link
                  to={`/tracks/${track.id}`}
                  className="group flex items-center gap-4 rounded-md border border-line bg-surface-1 px-4 py-3 transition-colors duration-180 hover:border-line-bright hover:bg-surface-2"
                >
                  <ProgressRing value={pct} size={40} color={track.color} strokeWidth={3} />
                  <span
                    className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px]"
                    style={{ color: track.color }}
                  >
                    <Icon size={11} strokeWidth={1.75} />
                    {track.code}
                  </span>
                  <span className="hidden w-44 truncate text-body-sm text-text-2 sm:inline">
                    {track.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: track.color }}
                      initial={{ width: reduced ? `${pct}%` : 0 }}
                      animate={inView ? { width: `${pct}%` } : undefined}
                      transition={{ duration: 0.8, delay: 0.2 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-mono text-[11px] text-text-3">
                    {doneN}/{track.lessons} · {pct}%
                  </span>
                </Link>
              </motion.div>
            )
          })}
          {/* capstone row */}
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ duration: 0.4, delay: 0.6 }}
          >
            <Link
              to="/capstone"
              className="group flex items-center gap-4 rounded-md border border-line bg-surface-1 px-4 py-3 transition-colors duration-180 hover:border-line-bright hover:bg-surface-2"
            >
              <ProgressRing
                value={Math.round((stepsDone.length / 7) * 100)}
                size={40}
                strokeWidth={3}
              />
              <span className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-grad-brand">
                {CAPSTONE.code}
              </span>
              <span className="hidden w-44 truncate text-body-sm text-text-2 sm:inline">
                Capstone
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                <motion.div
                  className="h-full rounded-full bg-grad-brand"
                  initial={{ width: reduced ? `${(stepsDone.length / 7) * 100}%` : 0 }}
                  animate={inView ? { width: `${(stepsDone.length / 7) * 100}%` } : undefined}
                  transition={{ duration: 0.8, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-[11px] text-text-3">
                {stepsDone.length}/7 · {Math.round((stepsDone.length / 7) * 100)}%
              </span>
            </Link>
          </motion.div>
        </div>

        {/* address map (xl only) */}
        <motion.div
          initial={reduced ? false : { opacity: 0 }}
          animate={inView ? { opacity: 1 } : undefined}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="hidden rounded-md border border-line bg-surface-1 p-4 xl:block"
        >
          <div className="flex h-full gap-3">
            <div className="flex h-[240px] flex-1 flex-col gap-[2px]">
              {ORDERED_LESSON_IDS.map((id, i) => {
                const trackId = id.split('.')[0]
                const track = TRACKS.find((t) => t.id === trackId)
                const done = lessons[id]?.status === 'done'
                const isNext = id === nextId
                return (
                  <motion.div
                    key={id}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={inView ? { opacity: 1 } : undefined}
                    transition={{ delay: 0.4 + i * 0.03 }}
                    className="flex-1"
                  >
                    <Link
                      to={`/lesson/${id}`}
                      title={id}
                      aria-label={`Lesson ${id}${done ? ' (done)' : ''}`}
                      className={cn(
                        'block h-full w-full rounded-[1px] border transition-transform duration-120 hover:scale-y-125',
                        isNext && 'animate-breathe',
                      )}
                      style={{
                        backgroundColor: done ? track?.color : 'transparent',
                        borderColor: isNext ? '#3EF2A4' : done ? track?.color : '#2C3A4F',
                      }}
                    />
                  </motion.div>
                )
              })}
            </div>
            <div className="flex h-[240px] flex-col justify-between font-mono text-[10px] text-text-3">
              <span>{hexAddress(0)}</span>
              <span>{hexAddress(MID_LESSON_ADDRESS)}</span>
              <span>{hexAddress(LAST_LESSON_ADDRESS)}</span>
            </div>
          </div>
          <p className="mt-3 font-mono text-[10px] text-text-3">
            {TOTAL_LESSONS} lesson blocks · solid = allocated · glow = next instruction
          </p>
        </motion.div>
      </div>
    </div>
  )
}

/* ---------------- section 4: activity heatmap ---------------- */

function Heatmap() {
  const streakDays = useProgress((s) => s.streakDays)
  // NOTE: object-returning selectors (selectActivityMap) break zustand's
  // useSyncExternalStore snapshot stability → infinite re-render loop.
  // Subscribe to raw state and memoize the derived map instead.
  const lessons = useProgress((s) => s.lessons)
  const activity = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of Object.values(lessons)) {
      if (l.completedAt) {
        const day = localDateKey(new Date(l.completedAt))
        map[day] = (map[day] ?? 0) + 1
      }
    }
    return map
  }, [lessons])
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  const reduced = useReducedMotion()

  const { weeks, longest, totalActive } = useMemo(() => {
    const days = new Set(streakDays)
    const counts = new Map<string, number>()
    for (const d of streakDays) counts.set(d, (counts.get(d) ?? 0) + 1)
    for (const [d, n] of Object.entries(activity)) counts.set(d, (counts.get(d) ?? 0) + n)

    // 20 weeks ending with the current week, columns = weeks (Sun..Sat rows)
    const today = new Date()
    const end = new Date(today)
    end.setDate(end.getDate() - end.getDay()) // start of this week (Sunday)
    const start = new Date(end)
    start.setDate(start.getDate() - 19 * 7)

    const weeks: { date: string; n: number; future: boolean }[][] = []
    for (let w = 0; w < 20; w++) {
      const col: { date: string; n: number; future: boolean }[] = []
      for (let d = 0; d < 7; d++) {
        const cur = new Date(start)
        cur.setDate(start.getDate() + w * 7 + d)
        const iso = localDateKey(cur)
        col.push({
          date: iso,
          n: days.has(iso) ? (counts.get(iso) ?? 1) : (counts.get(iso) ?? 0),
          future: cur > today,
        })
      }
      weeks.push(col)
    }

    // longest streak
    const sorted = [...days].sort()
    let longest = 0
    let run = 0
    let prev = ''
    for (const d of sorted) {
      if (prev) {
        const diff = (new Date(d).getTime() - new Date(prev).getTime()) / 86400000
        run = diff === 1 ? run + 1 : 1
      } else {
        run = 1
      }
      longest = Math.max(longest, run)
      prev = d
    }
    return { weeks, longest, totalActive: days.size }
  }, [streakDays, activity])

  const intensity = (n: number): string => {
    if (n <= 0) return 'bg-surface-3'
    if (n === 1) return 'bg-accent/25'
    if (n === 2) return 'bg-accent/50'
    if (n === 3) return 'bg-accent/75'
    return 'bg-accent'
  }

  const empty = totalActive === 0

  return (
    <div ref={ref} className="mt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-h3 text-text-1">Activity</h2>
        <p className="font-mono text-[11px] text-text-3">
          longest streak {longest}d · total active days {totalActive}
        </p>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Activity heatmap, scrolls sideways on a narrow screen"
        className="relative mt-5 overflow-x-auto rounded-md border border-line bg-surface-1 p-4 scrollbar-slim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex min-w-[640px] gap-[3px]" role="img" aria-label={`Activity heatmap — ${totalActive} active days in the last 20 weeks`}>
          {weeks.map((col, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {col.map((cell, d) => (
                <motion.div
                  key={cell.date}
                  initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                  animate={inView ? { opacity: 1, scale: 1 } : undefined}
                  transition={{ delay: reduced ? 0 : (w * 7 + d) * 0.012, duration: 0.2 }}
                  whileHover={{ scale: 1.15 }}
                  title={`${cell.date} — ${cell.n} ${cell.n === 1 ? 'activity' : 'activities'}`}
                  className={cn(
                    'h-3 w-3 rounded-[2px]',
                    cell.future ? 'bg-surface-2' : intensity(cell.n),
                    empty && !cell.future && 'bg-surface-3/60',
                  )}
                />
              ))}
            </div>
          ))}
        </div>
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-ink/60">
            <p className="font-mono text-body-sm text-text-2">
              no activity yet — day 0 starts with R.L1
            </p>
            <Link
              to="/lesson/r.l1"
              className="pointer-events-auto mt-3 rounded-md bg-accent px-4 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-transform active:scale-[.97]"
            >
              begin →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- section 5: achievements ---------------- */

function Achievements() {
  const state = useProgress()
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })
  const unlocked = new Set(state.achievements)

  return (
    <div ref={ref} className="mt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-h3 text-text-1">privilege escalations</h2>
        <p className="font-mono text-[11px] text-text-3">
          {ACHIEVEMENTS.filter((a) => unlocked.has(a.id) || a.derived(state)).length}/
          {ACHIEVEMENTS.length} unlocked
        </p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {ACHIEVEMENTS.map((a, i) => {
          const earned = unlocked.has(a.id) || a.derived(state)
          const Icon = earned ? a.icon : Lock
          return (
            <motion.div
              key={a.id}
              initial={reduced ? false : { opacity: 0, scale: 0.9 }}
              animate={inView ? { opacity: 1, scale: 1 } : undefined}
              transition={{ duration: 0.4, delay: i * 0.06, ease: [0.3, 1.4, 0.4, 1] }}
              title={earned ? a.name : `locked — ${a.cond}`}
              className={cn(
                'flex h-[180px] flex-col items-center justify-center rounded-lg border p-4 text-center',
                earned ? 'border-line bg-surface-1' : 'border-line/60 bg-surface-1/50',
              )}
            >
              <div
                className={cn(
                  'flex h-16 w-16 items-center justify-center rounded-full border-2',
                  !earned && 'opacity-35 grayscale',
                )}
                style={{
                  borderColor: earned ? (a.color ?? '#3EF2A4') : '#2C3A4F',
                  backgroundColor: earned ? `${a.color ?? '#3EF2A4'}14` : 'transparent',
                }}
              >
                <Icon
                  size={26}
                  strokeWidth={1.75}
                  style={{ color: earned ? (a.color ?? '#3EF2A4') : '#5D6B80' }}
                />
              </div>
              <p
                className={cn(
                  'mt-3 font-display text-[15px] font-medium',
                  earned ? 'text-text-1' : 'text-text-3',
                )}
              >
                {a.name}
              </p>
              <p className="mt-1 font-mono text-[11px] leading-tight text-text-3">
                {earned ? 'unlocked' : a.cond}
              </p>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------------- section 6: up next ---------------- */

function UpNext({ up }: { up: UpNextState }) {
  if (up.status === 'loading') {
    return <div data-up-next-slot aria-busy="true" className="min-h-[7rem] rounded-lg border border-line bg-surface-1" />
  }
  // the recommender could not load: a plain link to the path, never a guess at a lesson
  if (up.status === 'error') {
    return (
      <Link to="/curriculum" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface-1 px-5 py-3 font-display text-[15px] text-text-1">
        <Play size={14} /> open your path →
      </Link>
    )
  }
  return <UpNextCard rec={up.rec} offerPlacement={up.offerPlacement} />
}

/* ---------------- page assembly ---------------- */

/**
 * Up Next keeps Progress's rule: with any activity (a streak day or a lesson with a mark) it is the first thing, beside the
 * rings; a learner with none sees the rings first and Up Next at the foot of the journey, as Progress showed it. (Progress
 * put it below data ownership; that section is now its own, after this one in Me.tsx.)
 */
function JourneyBody() {
  const streakDays = useProgress((s) => s.streakDays)
  const lessons = useProgress((s) => s.lessons)
  const hasAny = streakDays.length > 0 || Object.keys(lessons).length > 0
  const { load, retry } = useSummary()
  const up = useUpNext()
  const nextLessonId = up.status === 'ready' && up.rec.kind === 'lesson' ? up.rec.ref : null

  return (
    <>
      {hasAny ? (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]" data-up-next-place="first">
          <div>
            <UpNext up={up} />
          </div>
          <RingPanel />
        </div>
      ) : (
        <RingPanel />
      )}

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <XpExplainer />
        <Suspense fallback={null}>
          <ReviewPanel load={load} onRetry={retry} />
        </Suspense>
      </div>

      <KpiBand />
      <Suspense fallback={null}>
        <EngineCard />
      </Suspense>
      <TrackBreakdown nextId={nextLessonId} />
      <Heatmap />
      <Achievements />
      {!hasAny && (
        <div className="mt-14" data-up-next-place="last">
          <UpNext up={up} />
        </div>
      )}
    </>
  )
}

export default function Journey() {
  return (
    <MotionScope>
      <JourneyBody />
    </MotionScope>
  )
}
