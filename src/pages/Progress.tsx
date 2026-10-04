/**
 * PROGRESS — /progress (progress.md).
 * "htop for your brain": rank panel, KPI tweens, per-track memory-map bars,
 * GitHub-style heatmap, achievement catalog, export/import (merge or replace, with undo)/reset with double-confirm.
 * Consumes src/lib/progress.ts as-is.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, animate, motion, useInView, useReducedMotion } from 'framer-motion'
import {
  Braces,
  Check,
  Cog,
  Cpu,
  Download,
  Flame,
  Gauge,
  Grid3X3,
  Layers,
  Lock,
  Play,
  Power,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  useProgress,
  rankForXp,
  nextRank,
  selectStreak,
  localDateKey,
  TOTAL_LESSONS,
} from '@/lib/progress'
import type { ProgressState } from '@/lib/progress'
import { getLedgerClient } from '@/lib/ledger/client'
import { IMPORT_MAX_BYTES } from '@/lib/ledger/constants'
import { readOnlyNote } from '@/lib/ledger/read-only'
import type { LedgerClient, LedgerStatus } from '@/lib/ledger/types'
import ImportPreviewDialog, { DialogFrame } from '@/components/ledger/ImportPreview'
import type { ImportFile } from '@/components/ledger/ImportPreview'
import { TRACKS, CAPSTONE, ORDERED_LESSON_IDS, SIMS } from '@/lib/tracks'
import { ALL_LESSONS } from '@/data/lessons'
import ProgressRing from '@/components/ProgressRing'
import { cn } from '@/lib/utils'

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

const TOTAL_LAB_TASKS = ALL_LESSONS.reduce(
  (total, lesson) =>
    total +
    lesson.blocks.reduce(
      (lessonTotal, block) => lessonTotal + (block.type === 'exercise' ? block.tasks.length : 0),
      0,
    ),
  0,
)

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

/* ---------------- section 1: rank panel ---------------- */

function RankPanel() {
  const xp = useProgress((s) => s.xp)
  const lessons = useProgress((s) => s.lessons)
  const sims = useProgress((s) => s.sims)
  const rank = rankForXp(xp)
  const next = nextRank(xp)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true })
  const shownXp = useCountUp(xp, inView)
  const done = Object.values(lessons).filter((l) => l.status === 'done').length
  const scored = Object.values(lessons).filter((l) => l.quizScore != null)
  const quizAvg = scored.length
    ? Math.round((scored.reduce((a, l) => a + (l.quizScore ?? 0), 0) / scored.length) * 100)
    : 0
  const labTasks = Object.values(sims).reduce((a, s) => a + s.tasksDone.length, 0)
  const pctToNext = next ? Math.min(100, (xp / next.minXp) * 100) : 100

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-lg border border-line bg-surface-1 p-6"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-grad-brand" aria-hidden />
      <p className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">rank</p>
      <p className="mt-2 font-display text-[40px] font-bold leading-none text-text-1">
        {rank.name}
      </p>
      <p className="mt-2 font-mono text-[11px] text-text-3">{RANK_FLAVOR[rank.name]}</p>
      <div className="mt-5">
        <div className="flex justify-between font-mono text-[11px] text-text-3">
          <span>
            {Math.round(shownXp)}
            {next ? `/${next.minXp}` : ''} XP
          </span>
          <span>{next ? `next: ${next.name}` : 'max rank'}</span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full rounded-full bg-grad-brand"
            initial={{ width: 0 }}
            animate={{ width: `${pctToNext}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>
      <p className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-text-3">
        lessons {done}/{TOTAL_LESSONS} · quizzes {quizAvg}% · lab tasks {labTasks}/{TOTAL_LAB_TASKS}
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
          initial={{ opacity: 0, y: 24 }}
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

function TrackBreakdown() {
  const lessons = useProgress((s) => s.lessons)
  const stepsDone = useProgress((s) => s.capstone.stepsDone)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-10% 0px' })

  const nextId = ORDERED_LESSON_IDS.find((id) => lessons[id]?.status !== 'done') ?? null

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
                initial={{ opacity: 0, y: 12 }}
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
                      initial={{ width: 0 }}
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
            initial={{ opacity: 0, y: 12 }}
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
                  initial={{ width: 0 }}
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
          initial={{ opacity: 0 }}
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
                    initial={{ opacity: 0 }}
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
      <div className="relative mt-5 overflow-x-auto rounded-md border border-line bg-surface-1 p-4 scrollbar-slim">
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
              initial={{ opacity: 0, scale: 0.9 }}
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

/* ---------------- section 6: data ownership ---------------- */

const BACKUP_NUDGE_DAYS = 30
const DAY_MS = 86_400_000

/** Whole days since `since` (an ISO instant or a local `YYYY-MM-DD`). Kept outside the component so render stays pure. */
function daysSince(since: string): number {
  const t = since.length === 10 ? new Date(`${since}T00:00:00`).getTime() : Date.parse(since)
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / DAY_MS) : 0
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

const UNDO_LABELS: Record<NonNullable<LedgerStatus['undo']>['reason'], string> = {
  'import-merge': 'import (merge)',
  'import-replace': 'import (replace)',
  reset: 'reset',
}

type Estimate = Awaited<ReturnType<LedgerClient['storageEstimate']>>

function DataOwnership() {
  const ledger = useProgress((s) => s.ledger)
  const lessons = useProgress((s) => s.lessons)
  const streakDays = useProgress((s) => s.streakDays)
  const resetProgress = useProgress((s) => s.resetProgress)
  const [toast, setToast] = useState<string | null>(null)
  const [pending, setPending] = useState<ImportFile | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0)
  const [resetText, setResetText] = useState('')
  const [estimate, setEstimate] = useState<Estimate | 'unavailable' | null>(null)
  const [working, setWorking] = useState<'export' | 'import' | 'undo' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLButtonElement>(null)
  const resetRef = useRef<HTMLButtonElement>(null)
  const clientRef = useRef<Promise<LedgerClient> | null>(null)
  const [client, setClient] = useState<LedgerClient | null>(null)

  // One engine handle for the page; a failed chunk load clears it so the next click retries.
  const withClient = () => {
    clientRef.current ??= getLedgerClient().then(
      (c) => {
        setClient(c)
        return c
      },
      (err) => {
        clientRef.current = null
        throw err
      },
    )
    return clientRef.current
  }

  const readOnly = ledger.readOnly
  const readOnlyReason = readOnly ? readOnlyNote(ledger.reason) : null
  const undoAt = ledger.undo?.at

  // The storage line: the engine's own count plus the browser's quota. It refreshes whenever an import,
  // undo or reset changes the ledger (their checkpoint changes `undo.at`) or the engine finishes loading.
  useEffect(() => {
    let live = true
    withClient()
      .then((c) => c.storageEstimate())
      .then((e) => live && setEstimate(e))
      .catch(() => live && setEstimate('unavailable'))
    return () => {
      live = false
    }
  }, [ledger.ready, undoAt])

  const flashToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3500)
  }

  const doExport = async () => {
    if (readOnly || working) return
    setWorking('export')
    try {
      const file = await (await withClient()).exportV3()
      const json = JSON.stringify(file)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kernelspace-progress-${localDateKey(new Date(file.exportedAt))}.json`
      a.click()
      URL.revokeObjectURL(url)
      flashToast(`exported ${file.events.length.toLocaleString()} events · ${formatBytes(blob.size)}`)
    } catch {
      flashToast('export failed — nothing was changed')
    } finally {
      setWorking(null)
    }
  }

  const onFile = async (file: File) => {
    if (readOnly) return
    setImportError(null)
    if (file.size > IMPORT_MAX_BYTES) {
      setImportError(`this file is over ${IMPORT_MAX_BYTES / (1024 * 1024)} MB`)
      return
    }
    setWorking('import')
    try {
      const text = await file.text()
      const preview = await (await withClient()).previewImport(text, 'merge')
      if ('error' in preview) setImportError(preview.detail ?? "this file can't be imported")
      else setPending({ name: file.name, text, preview })
    } catch {
      setImportError('could not read that file')
    } finally {
      setWorking(null)
    }
  }

  const onApplied = (r: { mode: 'merge' | 'replace'; added: number; removed: number }) => {
    setPending(null)
    flashToast(
      r.mode === 'merge'
        ? `merged · ${r.added.toLocaleString()} new events · undo available`
        : `replaced · +${r.added.toLocaleString()} −${r.removed.toLocaleString()} events · undo available`,
    )
  }

  const doUndo = async () => {
    if (readOnly || working) return
    setWorking('undo')
    try {
      const ok = await (await withClient()).undo()
      flashToast(ok ? 'undone — your progress is back as it was' : 'nothing to undo')
    } catch {
      flashToast('undo failed — nothing was changed')
    } finally {
      setWorking(null)
    }
  }

  const doReset = () => {
    resetProgress()
    setResetStep(0)
    setResetText('')
    flashToast('progress cleared — day 0 · undo available')
  }

  // Backup nudge: 30 days since the last export, or (never exported) since the first graded day.
  const hasAny = streakDays.length > 0 || Object.keys(lessons).length > 0
  const since = ledger.lastExportAt ?? (streakDays.length > 0 ? [...streakDays].sort()[0] : null)
  const age = since ? daysSince(since) : 0
  const nudge = ledger.ready && !readOnly && hasAny && since !== null && age >= BACKUP_NUDGE_DAYS

  const btn =
    'rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-xs text-text-1 transition-colors enabled:hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-40'
  const rows = [
    {
      icon: Download,
      title: 'Export progress',
      desc: 'Download everything as one JSON file (export v3): your events, settings and Capstone drafts.',
      action: (
        <button
          type="button"
          onClick={() => void doExport()}
          disabled={readOnly}
          aria-busy={working !== null}
          className={btn}
        >
          {working === 'export' ? 'exporting…' : 'download'}
        </button>
      ),
    },
    {
      icon: Upload,
      title: 'Import progress',
      desc: 'Restore or combine an export v3 file. You see what changes before anything is written, and you can undo it.',
      action: (
        <button
          ref={chooseRef}
          type="button"
          onClick={() => !working && fileRef.current?.click()}
          disabled={readOnly}
          aria-busy={working !== null}
          className="rounded-md border border-dashed border-line-bright px-4 py-2 font-mono text-xs text-text-2 transition-colors enabled:hover:border-accent enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {working === 'import' ? 'reading…' : 'choose file'}
        </button>
      ),
    },
    ...(ledger.undo
      ? [
          {
            icon: RotateCcw,
            title: `Undo last ${UNDO_LABELS[ledger.undo.reason]}`,
            desc: `Puts your progress back as it was before the ${UNDO_LABELS[ledger.undo.reason]} on ${new Date(ledger.undo.at).toLocaleString()}. Anything you have done since stays. Available until your next import or reset.`,
            action: (
              <button
                type="button"
                onClick={() => void doUndo()}
                disabled={readOnly}
                aria-busy={working !== null}
                className={btn}
              >
                {working === 'undo' ? 'undoing…' : 'undo'}
              </button>
            ),
          },
        ]
      : []),
    {
      icon: Trash2,
      title: 'Reset everything',
      desc: 'Clear your lessons, quiz and lab results, XP, streak, achievements and saved settings from this browser. Undo is available until your next import or reset.',
      action: (
        <button
          ref={resetRef}
          type="button"
          onClick={() => !working && setResetStep(1)}
          disabled={readOnly}
          aria-busy={working !== null}
          className="rounded-md border border-danger/60 px-4 py-2 font-mono text-xs text-danger transition-colors enabled:hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          reset
        </button>
      ),
    },
  ]

  return (
    <div className="mt-14">
      <h2 className="font-display text-h3 text-text-1">data ownership</h2>
      {readOnlyReason && (
        <p
          role="status"
          className="mt-4 rounded-md border border-amber/50 bg-amber/5 px-4 py-3 text-body-sm text-text-1"
        >
          Export, import, undo and reset are turned off. {readOnlyReason}
        </p>
      )}
      {nudge && (
        <div
          role="region"
          aria-label="Backup reminder"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-4 py-3"
        >
          <p className="min-w-0 flex-1 text-body-sm text-text-1">
            {ledger.lastExportAt
              ? `Your last backup was ${age} days ago.`
              : `You have been learning for ${age} days and have not downloaded a backup.`}{' '}
            <span className="text-text-2">
              Browsers can clear site data without asking; a downloaded export is the copy that survives it.
            </span>
          </p>
          <button type="button" onClick={() => void doExport()} aria-busy={working !== null} className={btn}>
            download backup
          </button>
        </div>
      )}
      <div className="mt-5 divide-y divide-line rounded-lg border border-line bg-surface-1">
        {rows.map((row) => (
          <div
            key={row.title}
            className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-surface-2"
          >
            <row.icon size={18} strokeWidth={1.75} className="shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-medium text-text-1">{row.title}</p>
              <p className="text-body-sm text-text-3">{row.desc}</p>
            </div>
            {row.action}
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        {readOnly
          ? 'stored locally · size unavailable while this tab is read-only'
          : estimate === null
            ? 'stored locally · measuring…'
            : estimate === 'unavailable'
              ? 'stored locally · size unavailable'
              : `stored locally · ${estimate.events.toLocaleString()} events · ~${formatBytes(estimate.approxBytes)}${
                estimate.usage !== undefined && estimate.quota !== undefined
                  ? ` · this site uses ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}`
                  : ''
              }${
                ledger.persisted === true
                  ? ' · protected from eviction'
                  : ledger.persisted === false
                    ? ' · the browser may clear it when space is short'
                    : ''
              }`}
        {' · no account · no tracking'}
      </p>
      {importError && (
        <p role="alert" className="mt-2 font-mono text-[12px] text-danger">
          {importError}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="import-file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void onFile(f)
          e.target.value = ''
        }}
      />

      {pending && client && (
        <ImportPreviewDialog
          file={pending}
          client={client}
          returnFocus={chooseRef}
          onClose={() => setPending(null)}
          onApplied={onApplied}
        />
      )}

      {resetStep > 0 && (
        <DialogFrame
          role="alertdialog"
          returnFocus={resetRef}
          tone={resetStep === 2 ? 'danger' : 'default'}
          onClose={() => {
            setResetStep(0)
            setResetText('')
          }}
          title={resetStep === 1 ? 'Reset everything?' : 'Type RESET to confirm'}
          description={
            resetStep === 1 ? (
              <>
                <span className="block">
                  <strong className="font-medium text-text-1">This clears</strong> every lesson, checkpoint
                  answer, sim task, lab result, Fleet Week and Capstone step, achievement, XP point and
                  streak day, plus your saved settings and scroll positions, in this browser.
                </span>
                <span className="mt-2 block">
                  <strong className="font-medium text-text-1">This keeps</strong> any file you exported,
                  your compiled lab modules, your Capstone drafts and flags, and your leaderboard best.
                </span>
                <span className="mt-2 block">
                  Undo is available until your next import or reset. A backup is safer: export first.
                </span>
              </>
            ) : (
              'This is the last step. Your progress is cleared as soon as you confirm.'
            )
          }
        >
          {resetStep === 2 && (
            <input
              value={resetText}
              onChange={(e) => setResetText(e.target.value)}
              aria-label="Type RESET to confirm"
              placeholder="RESET"
              autoComplete="off"
              autoFocus
              className="mt-4 w-full rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-text-1 placeholder:text-text-3 focus:border-danger focus:outline-none"
            />
          )}
          <div className="mt-5 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setResetStep(0)
                setResetText('')
              }}
              className="rounded-md border border-line bg-surface-2 px-4 py-2 font-mono text-xs text-text-2 hover:border-line-bright"
            >
              {resetStep === 1 ? 'keep my progress' : 'cancel'}
            </button>
            {resetStep === 1 ? (
              <button
                type="button"
                onClick={() => setResetStep(2)}
                className="rounded-md border border-danger/60 px-4 py-2 font-mono text-xs text-danger hover:bg-danger/10"
              >
                continue →
              </button>
            ) : (
              <button
                type="button"
                disabled={resetText !== 'RESET'}
                onClick={doReset}
                className="rounded-md bg-danger px-4 py-2 font-mono text-xs font-semibold text-ink transition-all enabled:hover:brightness-110 disabled:opacity-40"
              >
                wipe it
              </button>
            )}
          </div>
        </DialogFrame>
      )}

      {/* announced to screen readers; the visible toast below is decoration */}
      <div role="status" aria-live="polite" className="sr-only">
        {toast}
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25 }}
            className="fixed bottom-16 right-6 z-[80] flex items-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2.5 font-mono text-xs text-text-1 shadow-lg lg:bottom-14"
          >
            <Check size={13} className="text-accent" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------------- section 7: up next ---------------- */

function UpNext() {
  const lessons = useProgress((s) => s.lessons)
  const reduced = useReducedMotion()
  const nextId = ORDERED_LESSON_IDS.find((id) => lessons[id]?.status !== 'done') ?? null

  const reviewId = useMemo(() => {
    if (nextId) return null
    let worst: string | null = null
    let worstScore = Infinity
    for (const [id, l] of Object.entries(lessons)) {
      if (l.quizScore != null && l.quizScore < worstScore) {
        worstScore = l.quizScore
        worst = id
      }
    }
    return worst
  }, [nextId, lessons])

  const target = nextId ?? reviewId
  if (!target) return null
  const track = TRACKS.find((t) => t.id === target.split('.')[0])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-lg border border-line bg-surface-1 p-5"
    >
      <div className="absolute inset-x-0 top-0 h-px overflow-hidden" aria-hidden>
        {!reduced && (
          <motion.div
            className="h-full w-1/3 bg-grad-brand"
            animate={{ x: ['-100%', '300%'] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          />
        )}
        {reduced && <div className="h-full bg-grad-brand" />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
            {nextId ? 'recommended next instruction' : 'review'}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px]"
              style={{ color: track?.color }}
            >
              {track?.code}
            </span>
            <span className="font-mono text-body-sm text-text-1">{target}</span>
            <span className="font-mono text-[11px] text-text-3">
              · {track?.name} · ~12min
            </span>
          </p>
        </div>
        <Link
          to={`/lesson/${target}`}
          className="flex items-center gap-2 rounded-md bg-accent px-5 py-3 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 ease-snap hover:-translate-y-px active:scale-[.97]"
        >
          <Play size={14} /> execute →
        </Link>
      </div>
    </motion.div>
  )
}

/* ---------------- page assembly ---------------- */

export default function Progress() {
  const streakDays = useProgress((s) => s.streakDays)
  const lessons = useProgress((s) => s.lessons)
  const hasAny = streakDays.length > 0 || Object.keys(lessons).length > 0

  return (
    <div className="bg-grad-radial-glow">
      <section className="mx-auto max-w-app px-6 pb-24 pt-24 lg:px-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="section-label">0x06 — process stats</p>
            <h1 className="mt-4 font-display text-display-lg text-text-1">Progress</h1>
            <p className="mt-4 max-w-[60ch] text-body text-text-2">
              Everything below lives in this browser: an append-only ledger in IndexedDB. Export
              it, move it, nuke it — it's yours.
            </p>
            {hasAny && (
              <div className="mt-6">
                <UpNext />
              </div>
            )}
          </motion.div>
          <RankPanel />
        </div>

        <KpiBand />
        <TrackBreakdown />
        <Heatmap />
        <Achievements />
        <DataOwnership />
        {!hasAny && (
          <div className="mt-14">
            <UpNext />
          </div>
        )}
        <div className="mt-16 font-mono text-[11px] text-text-3">
          <Link to="/curriculum" className="hover:text-accent">
            ← back to curriculum
          </Link>
        </div>
      </section>
    </div>
  )
}
