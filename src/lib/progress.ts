import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TOTAL_TRACK_LESSONS } from './tracks'

/**
 * Kernelspace progress store (design.md §10).
 * Single localStorage namespace: `kernelspace:v1`.
 */

export type LessonStatus = 'unstarted' | 'reading' | 'done'

export interface LessonProgress {
  status: LessonStatus
  quizScore?: number // 0..1
  exerciseDone?: boolean
  completedAt?: string // ISO
  lastVisitedAt: string // ISO
  scrollPct?: number // resume position
}

export interface SimProgress {
  visits: number
  tasksDone: string[]
  lastConfig?: unknown
}

export interface CapstoneMetrics {
  ttft: number
  itl: number
  throughput: number
}

export interface CapstoneProgress {
  step: number
  stepsDone: string[]
  metrics?: CapstoneMetrics
}

export interface LabProgress {
  done: boolean
  checksDone: string[]
  completedAt?: string // ISO
}

export interface FleetWeekProgress {
  actsDone: string[]
  scores: Record<string, number>
  docText?: string
  measurementEvidence?: Record<
    string,
    { analysis?: string; screenshotName?: string; screenshotBytes?: number }
  >
}

export type CodeLang = 'python' | 'java' | 'rust' | 'c'

export interface ProgressSettings {
  reducedMotion?: boolean
  codeLang?: CodeLang
}

export interface ProgressState {
  version: 2
  lessons: Record<string, LessonProgress>
  sims: Record<string, SimProgress>
  labs: Record<string, LabProgress>
  fleetWeek: FleetWeekProgress
  capstone: CapstoneProgress
  xp: number
  streakDays: string[] // ISO dates with any activity
  achievements: string[]
  settings: ProgressSettings

  // actions
  markLessonStatus: (lessonId: string, status: LessonStatus) => void
  setLessonScroll: (lessonId: string, scrollPct: number) => void
  recordQuizScore: (lessonId: string, score: number) => void
  markExerciseDone: (lessonId: string) => void
  recordSimVisit: (simId: string) => void
  recordSimTask: (simId: string, taskId: string) => void
  setSimConfig: (simId: string, config: unknown) => void
  recordLabResult: (labId: string, passedCheckIds: string[], totalChecks: number) => void
  completeFleetWeekAct: (actId: string, score: number) => void
  setFleetWeekDoc: (text: string) => void
  setFleetWeekEvidence: (
    actId: string,
    patch: { analysis?: string; screenshotName?: string; screenshotBytes?: number },
  ) => void
  completeCapstoneStep: (stepId: string, stepIndex: number) => void
  setCapstoneMetrics: (metrics: CapstoneMetrics) => void
  unlockAchievement: (id: string) => void
  updateSettings: (patch: Partial<ProgressSettings>) => void
  importProgress: (json: string) => boolean
  resetProgress: () => void
}

export const XP = {
  lesson: 100,
  quiz: 40,
  exercise: 60,
  capstoneStep: 150,
  lab: 200,
  fleetWeekAct: 250,
} as const

export const TOTAL_LESSONS = TOTAL_TRACK_LESSONS

export interface Rank {
  name: string
  minXp: number
}

/** XP → Rank: progress rendered as privilege escalation (design.md §10). */
export const RANKS: Rank[] = [
  { name: 'ROOT', minXp: 5000 },
  { name: 'RING 0', minXp: 3000 },
  { name: 'RING 1', minXp: 1500 },
  { name: 'RING 2', minXp: 500 },
  { name: 'RING 3', minXp: 0 },
]

export function rankForXp(xp: number): Rank {
  return RANKS.find((r) => xp >= r.minXp) ?? RANKS[RANKS.length - 1]
}

export function nextRank(xp: number): Rank | null {
  const sorted = [...RANKS].sort((a, b) => a.minXp - b.minXp)
  return sorted.find((r) => r.minXp > xp) ?? null
}

const todayISO = () => new Date().toISOString().slice(0, 10)

const initialData = {
  version: 2 as const,
  lessons: {} as Record<string, LessonProgress>,
  sims: {} as Record<string, SimProgress>,
  labs: {} as Record<string, LabProgress>,
  fleetWeek: { actsDone: [] as string[], scores: {} as Record<string, number> },
  capstone: { step: 0, stepsDone: [] as string[] },
  xp: 0,
  streakDays: [] as string[],
  achievements: [] as string[],
  settings: {} as ProgressSettings,
}

function touchStreak(streakDays: string[]): string[] {
  const today = todayISO()
  if (streakDays.includes(today)) return streakDays
  return [...streakDays, today]
}

const RETIRED_SIM_TASKS: Readonly<Record<string, Readonly<Record<string, true>>>> = {
  'sim-wgsl': { 'wgsl-wg1': true, 'wgsl-shared': true, 'wgsl-tiled': true },
  'sim-batching': {
    'batch-continuous': true,
    'batch-chunked': true,
    'batch-straggler': true,
    'batch-preempt': true,
  },
  'sim-roofline': { 't-quiz': true },
}

function removeRetiredSimTasks(state: unknown): unknown {
  if (!state || typeof state !== 'object') return state

  const progress = state as Record<string, unknown>
  if (!progress.sims || typeof progress.sims !== 'object') return state

  const sims = progress.sims as Record<string, unknown>
  let nextSims: Record<string, unknown> | undefined

  for (const [simId, retiredTasks] of Object.entries(RETIRED_SIM_TASKS)) {
    const sim = sims[simId]
    if (!sim || typeof sim !== 'object') continue

    const tasksDone = (sim as Record<string, unknown>).tasksDone
    if (!Array.isArray(tasksDone)) continue

    const retainedTasks = tasksDone.filter(
      (taskId) => typeof taskId !== 'string' || retiredTasks[taskId] !== true,
    )
    if (retainedTasks.length === tasksDone.length) continue

    nextSims ??= { ...sims }
    nextSims[simId] = { ...sim, tasksDone: retainedTasks }
  }

  return nextSims ? { ...progress, sims: nextSims } : state
}

const T5_LESSON_ID_MIGRATION = [
  ['t5.l6', 't5.l7'],
  ['t5.l7', 't5.l8'],
  ['t5.l8', 't5.l9'],
  ['t5.l9', 't5.l10'],
] as const

/** Wave 2 inserted prefix caching at T5.L6. Move old lesson records once,
 * from a snapshot, so adjacent ids cannot overwrite one another. */
export function migrateT5LessonIds(state: unknown): unknown {
  if (!state || typeof state !== 'object') return state
  const progress = state as Record<string, unknown>
  if (!progress.lessons || typeof progress.lessons !== 'object') {
    return { ...progress, version: 2 }
  }

  const oldLessons = progress.lessons as Record<string, unknown>
  const lessons = { ...oldLessons }
  for (const [oldId] of T5_LESSON_ID_MIGRATION) delete lessons[oldId]
  for (const [oldId, newId] of T5_LESSON_ID_MIGRATION) {
    if (oldLessons[oldId] !== undefined) lessons[newId] = oldLessons[oldId]
  }
  return { ...progress, version: 2, lessons }
}

export function migrateProgress(persistedState: unknown, persistedVersion: number): unknown {
  let next = persistedState
  if (persistedVersion < 2) next = removeRetiredSimTasks(next)
  if (persistedVersion < 3) next = migrateT5LessonIds(next)
  return next
}

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      ...initialData,

      markLessonStatus: (lessonId, status) =>
        set((s) => {
          const prev = s.lessons[lessonId]
          const wasDone = prev?.status === 'done'
          const nowDone = status === 'done'
          return {
            lessons: {
              ...s.lessons,
              [lessonId]: {
                ...prev,
                status,
                completedAt: nowDone && !wasDone ? new Date().toISOString() : prev?.completedAt,
                lastVisitedAt: new Date().toISOString(),
              },
            },
            xp: s.xp + (nowDone && !wasDone ? XP.lesson : 0),
            streakDays: touchStreak(s.streakDays),
          }
        }),

      setLessonScroll: (lessonId, scrollPct) =>
        set((s) => {
          const prev = s.lessons[lessonId]
          if (!prev) return s
          return { lessons: { ...s.lessons, [lessonId]: { ...prev, scrollPct } } }
        }),

      recordQuizScore: (lessonId, score) =>
        set((s) => {
          const prev = s.lessons[lessonId]
          const best = Math.max(prev?.quizScore ?? 0, score)
          const firstPass = (prev?.quizScore ?? 0) < 0.8 && score >= 0.8
          return {
            lessons: {
              ...s.lessons,
              [lessonId]: {
                ...prev,
                status: prev?.status ?? 'reading',
                quizScore: best,
                lastVisitedAt: new Date().toISOString(),
              },
            },
            xp: s.xp + (firstPass ? XP.quiz : 0),
            streakDays: touchStreak(s.streakDays),
          }
        }),

      markExerciseDone: (lessonId) =>
        set((s) => {
          const prev = s.lessons[lessonId]
          if (prev?.exerciseDone) return s
          return {
            lessons: {
              ...s.lessons,
              [lessonId]: {
                ...prev,
                status: prev?.status ?? 'reading',
                exerciseDone: true,
                lastVisitedAt: new Date().toISOString(),
              },
            },
            xp: s.xp + XP.exercise,
            streakDays: touchStreak(s.streakDays),
          }
        }),

      recordSimVisit: (simId) =>
        set((s) => {
          const prev = s.sims[simId] ?? { visits: 0, tasksDone: [] as string[] }
          return {
            sims: { ...s.sims, [simId]: { ...prev, visits: prev.visits + 1 } },
            streakDays: touchStreak(s.streakDays),
          }
        }),

      recordSimTask: (simId, taskId) =>
        set((s) => {
          const prev = s.sims[simId] ?? { visits: 0, tasksDone: [] as string[] }
          if (prev.tasksDone.includes(taskId)) return s
          return {
            sims: { ...s.sims, [simId]: { ...prev, tasksDone: [...prev.tasksDone, taskId] } },
            xp: s.xp + XP.exercise,
            streakDays: touchStreak(s.streakDays),
          }
        }),

      setSimConfig: (simId, config) =>
        set((s) => {
          const prev = s.sims[simId] ?? { visits: 0, tasksDone: [] as string[] }
          return { sims: { ...s.sims, [simId]: { ...prev, lastConfig: config } } }
        }),

      recordLabResult: (labId, passedCheckIds, totalChecks) =>
        set((s) => {
          const prev = s.labs[labId] ?? { done: false, checksDone: [] as string[] }
          const checksDone = [...new Set([...prev.checksDone, ...passedCheckIds])]
          const nowDone = totalChecks > 0 && checksDone.length >= totalChecks
          const firstDone = nowDone && !prev.done
          return {
            labs: {
              ...s.labs,
              [labId]: {
                done: nowDone || prev.done,
                checksDone,
                completedAt: firstDone ? new Date().toISOString() : prev.completedAt,
              },
            },
            xp: s.xp + (firstDone ? XP.lab : 0),
            streakDays: touchStreak(s.streakDays),
          }
        }),

      completeFleetWeekAct: (actId, score) =>
        set((s) => {
          const first = !s.fleetWeek.actsDone.includes(actId)
          const actsDone = first ? [...s.fleetWeek.actsDone, actId] : s.fleetWeek.actsDone
          const allDone = actsDone.length >= 4
          return {
            fleetWeek: {
              ...s.fleetWeek,
              actsDone,
              scores: { ...s.fleetWeek.scores, [actId]: Math.max(score, s.fleetWeek.scores[actId] ?? 0) },
            },
            achievements:
              allDone && !s.achievements.includes('fleet-week')
                ? [...s.achievements, 'fleet-week']
                : s.achievements,
            xp: s.xp + (first ? XP.fleetWeekAct : 0),
            streakDays: touchStreak(s.streakDays),
          }
        }),

      setFleetWeekDoc: (text) => set((s) => ({ fleetWeek: { ...s.fleetWeek, docText: text } })),

      setFleetWeekEvidence: (actId, patch) =>
        set((s) => ({
          fleetWeek: {
            ...s.fleetWeek,
            measurementEvidence: {
              ...s.fleetWeek.measurementEvidence,
              [actId]: { ...s.fleetWeek.measurementEvidence?.[actId], ...patch },
            },
          },
        })),

      completeCapstoneStep: (stepId, stepIndex) =>
        set((s) => {
          if (s.capstone.stepsDone.includes(stepId)) return s
          return {
            capstone: {
              ...s.capstone,
              step: Math.max(s.capstone.step, stepIndex + 1),
              stepsDone: [...s.capstone.stepsDone, stepId],
            },
            xp: s.xp + XP.capstoneStep,
            streakDays: touchStreak(s.streakDays),
          }
        }),

      setCapstoneMetrics: (metrics) => set((s) => ({ capstone: { ...s.capstone, metrics } })),

      unlockAchievement: (id) =>
        set((s) => (s.achievements.includes(id) ? s : { achievements: [...s.achievements, id] })),

      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      importProgress: (json) => {
        try {
          const data = JSON.parse(json)
          if (
            (data?.version !== 1 && data?.version !== 2) ||
            typeof data.lessons !== 'object' ||
            typeof data.xp !== 'number'
          ) {
            return false
          }
          const cleaned = removeRetiredSimTasks(data)
          const migrated = data.version === 1 ? migrateT5LessonIds(cleaned) : cleaned
          set({ ...initialData, ...(migrated as typeof initialData), version: 2 })
          return true
        } catch {
          return false
        }
      },

      resetProgress: () => set({ ...initialData }),
    }),
    {
      name: 'kernelspace:v1',
      version: 3,
      migrate: migrateProgress as (persistedState: unknown, version: number) => ProgressState,
    },
  ),
)

/* ---------------- Derived selectors (design.md §10) ---------------- */

export const selectDoneLessons = (s: ProgressState) =>
  Object.values(s.lessons).filter((l) => l.status === 'done').length

export const selectOverallPct = (s: ProgressState) =>
  Math.round((selectDoneLessons(s) / TOTAL_LESSONS) * 100)

/** Per-track completion % — lessonIds are prefixed `${trackId}.` (e.g. `t0.l2`). */
export function selectTrackPct(trackId: string, lessonCount: number) {
  return (s: ProgressState) => {
    if (lessonCount <= 0) return 0
    const done = Object.entries(s.lessons).filter(
      ([id, l]) => id.startsWith(`${trackId}.`) && l.status === 'done',
    ).length
    return Math.round((done / lessonCount) * 100)
  }
}

export function selectTrackDone(trackId: string) {
  return (s: ProgressState) =>
    Object.entries(s.lessons).filter(([id, l]) => id.startsWith(`${trackId}.`) && l.status === 'done')
      .length
}

/** First non-done lesson in track order → next recommended lesson id. */
export function selectNextLesson(orderedLessonIds: string[]) {
  return (s: ProgressState) =>
    orderedLessonIds.find((id) => s.lessons[id]?.status !== 'done') ?? null
}

/** Current streak length in consecutive days ending today/yesterday. */
export function selectStreak(s: ProgressState): number {
  if (s.streakDays.length === 0) return 0
  const days = new Set(s.streakDays)
  let streak = 0
  const cursor = new Date()
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1) // allow streak to end yesterday
  }
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** Activity heatmap data: date → lesson completions (from streakDays + completedAt). */
export function selectActivityMap(s: ProgressState): Record<string, number> {
  const map: Record<string, number> = {}
  for (const l of Object.values(s.lessons)) {
    if (l.completedAt) {
      const day = l.completedAt.slice(0, 10)
      map[day] = (map[day] ?? 0) + 1
    }
  }
  return map
}

/** Export the raw store as a JSON download string. */
export function exportProgress(): string {
  const { lessons, sims, labs, fleetWeek, capstone, xp, streakDays, achievements, settings } =
    useProgress.getState()
  return JSON.stringify(
    { version: 2, lessons, sims, labs, fleetWeek, capstone, xp, streakDays, achievements, settings },
    null,
    2,
  )
}

// Convenience non-hook getter for one-off reads outside React.
export const getProgress = () => useProgress.getState()
