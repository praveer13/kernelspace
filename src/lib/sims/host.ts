/**
 * SimHost internals (P2, docs/specs/wave-1.md §10.1–10.4): the React context sims read instead of the
 * URL, the observation bus the task panel grades against, and the pure rules behind predict → run →
 * explain (grading, the per-task state machine, the outcome that reaches the ledger), phone mode and
 * the laptop queue. No JSX and no router: everything here runs under `bun test`.
 *
 * Config reaches a sim from props (`initialConfig`) and leaves it through `writeConfig`. Only mode
 * `lab` puts it in the URL (`scheduleConfigWrite`), so an inline sim cannot rewrite its lesson's query.
 */

import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { SimId } from '@/data/lessons/types'
import type { Confidence, SimOutcome } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import type { MirrorTable, Observation, PredictSpec, SimHostContextValue, SimHostMode, SimTaskDef } from './types'

/* ------------------------------------------------------------------ */
/* Config ↔ URL codec (playground.md §2: base64 JSON, versioned)       */
/* ------------------------------------------------------------------ */

export function encodeCfg(cfg: unknown): string {
  try {
    return btoa(JSON.stringify({ v: 1, cfg }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
  } catch {
    return ''
  }
}

export function decodeCfg<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const b64 = raw.replaceAll('-', '+').replaceAll('_', '/')
    const parsed = JSON.parse(atob(b64)) as { v: number; cfg: T }
    return parsed?.v === 1 ? parsed.cfg : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* /lab/:simId ids                                                     */
/* ------------------------------------------------------------------ */

/** Both the canonical `sim-*` ids (progress store, lessons) and the short ids of src/lib/tracks.ts. */
export const SIM_ALIASES: Readonly<Record<string, SimId>> = {
  'sim-memory': 'sim-memory',
  'memory-grid': 'sim-memory',
  'sim-allocator': 'sim-allocator',
  allocator: 'sim-allocator',
  'sim-vm': 'sim-vm',
  paging: 'sim-vm',
  'sim-roofline': 'sim-roofline',
  roofline: 'sim-roofline',
  'sim-wgsl': 'sim-wgsl',
  wgsl: 'sim-wgsl',
  'sim-quant': 'sim-quant',
  quantizer: 'sim-quant',
  'sim-kv': 'sim-kv',
  'kv-calc': 'sim-kv',
  'sim-batching': 'sim-batching',
  batching: 'sim-batching',
  'sim-engine': 'sim-engine',
  engine: 'sim-engine',
}

/* ------------------------------------------------------------------ */
/* Observations                                                        */
/* ------------------------------------------------------------------ */

export interface ObservationBus {
  /** Drops anything that is not `{key: non-empty, value: finite number | string}`. */
  emit(obs: Observation): void
  subscribe(listener: (obs: Observation) => void): () => void
}

/**
 * A listener bus, not a log: the task panel grades the first observation that arrives after its
 * commit, so only the order of delivery matters. Nothing is replayed to a late subscriber.
 */
export function createObservationBus(): ObservationBus {
  const listeners = new Set<(obs: Observation) => void>()
  return {
    emit(obs) {
      if (typeof obs?.key !== 'string' || obs.key === '') return
      const v = obs.value
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string') return
      for (const l of [...listeners]) l(obs)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/**
 * Which tasks finished a predict → run → explain cycle in this mount, and which of those passed (a right
 * prediction). A miss finishes the cycle, so its note unlocks, but it is not passed: the ledger fold needs an
 * `ok` outcome (§3.4), so the panel and the list show "finished, not yet passed" until a later try is right.
 */
export interface FinishedStore {
  /** `passed` is the prediction's verdict; a later passing try upgrades an earlier miss. */
  add(taskId: string, passed: boolean): void
  has(taskId: string): boolean
  passed(taskId: string): boolean
  subscribe(listener: () => void): () => void
  /** Bumps on every change (the useSyncExternalStore snapshot). */
  version(): number
}

export function createFinishedStore(): FinishedStore {
  const done = new Set<string>()
  const passed = new Set<string>()
  const listeners = new Set<() => void>()
  let version = 0
  return {
    add(taskId, ok) {
      const grew = !done.has(taskId) || (ok && !passed.has(taskId))
      done.add(taskId)
      if (ok) passed.add(taskId)
      if (!grew) return
      version += 1
      for (const l of [...listeners]) l()
    },
    has: (taskId) => done.has(taskId),
    passed: (taskId) => passed.has(taskId),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    version: () => version,
  }
}

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

/** The public context value plus what the task panels need. */
export interface SimHostInternal extends SimHostContextValue {
  lessonId?: string
  taskIds?: readonly string[]
  bus: ObservationBus
  finished: FinishedStore
}

export const SimHostContext = createContext<SimHostInternal | null>(null)

/** The enclosing SimHost, or null when a sim renders without one (it then behaves as in lab mode). */
export function useSimHost(): SimHostInternal | null {
  return useContext(SimHostContext)
}

const NOOP = (): void => {}

/** `observe` for a sim to call with what it measured; a no-op outside a SimHost. */
export function useObserve(): (obs: Observation) => void {
  return useContext(SimHostContext)?.observe ?? NOOP
}

/** Re-render when any task of this host finishes a cycle. */
export function useFinishedVersion(host: SimHostInternal | null): number {
  return useSyncExternalStore(
    host ? host.finished.subscribe : NOOP_SUBSCRIBE,
    host ? host.finished.version : ZERO,
    ZERO,
  )
}

const NOOP_SUBSCRIBE = (): (() => void) => NOOP
const ZERO = (): number => 0

/**
 * Whether each of one sim's tasks is passed: an `ok` outcome in the ledger or a right prediction in this
 * mount (outcome tasks), a recorded task (legacy). A phone-mode record is neither, by design.
 */
export function useTasksDone(tasks: readonly SimTaskDef[]): Record<string, boolean> {
  return useTaskStates(tasks).done
}

/**
 * `done` as in `useTasksDone`; `finished` also counts a cycle finished with a missed prediction in this mount,
 * which is what opens "what just happened".
 */
export function useTaskStates(tasks: readonly SimTaskDef[]): { done: Record<string, boolean>; finished: Record<string, boolean> } {
  const host = useSimHost()
  const simId = tasks[0]?.simId ?? ''
  const outcomes = useProgress((s) => s.aggregate.sims[simId]?.outcomes)
  const tasksDone = useProgress((s) => s.sims[simId]?.tasksDone)
  const version = useFinishedVersion(host)
  return useMemo(() => {
    void version // a cycle finished in this mount re-derives the maps
    const done: Record<string, boolean> = {}
    const finished: Record<string, boolean> = {}
    for (const t of tasks) {
      const d =
        t.kind === 'legacy' ? tasksDone?.includes(t.id) === true : outcomes?.[t.id] === true || host?.finished.passed(t.id) === true
      done[t.id] = d
      finished[t.id] = d || host?.finished.has(t.id) === true
    }
    return { done, finished }
  }, [tasks, outcomes, tasksDone, host, version])
}

/* ------------------------------------------------------------------ */
/* Where a config change goes                                          */
/* ------------------------------------------------------------------ */

/** Lab mode's `?cfg=` debounce (unchanged from PlaygroundShell's original `useWriteCfg`). */
export const CFG_WRITE_DELAY_MS = 250

export interface ConfigSinks {
  /** Lab: serialize into `?cfg=` (replace). */
  url(cfg: unknown): void
  /** Embed and phone: keep it in memory; the URL is never touched. */
  memory(cfg: unknown): void
}

/**
 * Route one config change. Lab: debounce, then `sinks.url`. Anything else: `sinks.memory` at once and
 * `sinks.url` never. Returns the cancel to use as an effect cleanup.
 */
export function scheduleConfigWrite(
  mode: SimHostMode,
  cfg: unknown,
  sinks: ConfigSinks,
  delayMs: number = CFG_WRITE_DELAY_MS,
): () => void {
  if (mode !== 'lab') {
    sinks.memory(cfg)
    return NOOP
  }
  const id = setTimeout(() => sinks.url(cfg), delayMs)
  return () => clearTimeout(id)
}

/**
 * The host-to-sink decision the shell hooks share (`useWriteCfg`, `useInitialCfg`, `useSimMachine`): the URL
 * is the store only in lab mode, or when no SimHost wraps the sim. Kept pure so tests can pin it.
 */
export const hostUsesUrl = (host: Pick<SimHostContextValue, 'mode'> | null): boolean => (host?.mode ?? 'lab') === 'lab'

/** `scheduleConfigWrite` for a sim's hook: `mode` and `writeMemory` come from the SimHost (undefined: none). */
export function routeConfigWrite(
  mode: SimHostMode | undefined,
  writeMemory: ((cfg: unknown) => void) | undefined,
  cfg: unknown,
  writeUrl: (cfg: unknown) => void,
): () => void {
  return scheduleConfigWrite(mode ?? 'lab', cfg, { url: writeUrl, memory: (c) => writeMemory?.(c) })
}

/** The config a sim starts from: the host's props outside lab mode, else the decoded `?cfg=`. */
export function pickInitialCfg<T>(host: Pick<SimHostContextValue, 'mode' | 'initialConfig'> | null, rawUrlCfg: string | null): T | null {
  if (host === null || hostUsesUrl(host)) return decodeCfg<T>(rawUrlCfg)
  return (host.initialConfig ?? null) as T | null
}

/** The machine and lesson a sim sees, and where a machine switch goes: the host in embed and phone, else the URL. */
export function pickMachineSource(
  host: Pick<SimHostContextValue, 'mode' | 'machine' | 'selectMachine'> & { lessonId?: string } | null,
  url: { machine: string | null; from: string | null; select: (machine: string) => void },
): { machine: string | null; from: string | null; selectMachine: (machine: string) => void } {
  if (host === null || hostUsesUrl(host)) return { machine: url.machine, from: url.from, selectMachine: url.select }
  return { machine: host.machine ?? null, from: host.lessonId ?? null, selectMachine: host.selectMachine }
}

/* ------------------------------------------------------------------ */
/* Touch targets                                                       */
/* ------------------------------------------------------------------ */

/**
 * Hit area of a control (spec §16.2, WCAG 2.5.8): 44 px in phone mode and on a coarse pointer, at least
 * 24 px on a desktop one.
 */
export const hitArea = (touch: boolean): string =>
  touch ? 'min-h-11 min-w-11' : 'min-h-6 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11'

/* ------------------------------------------------------------------ */
/* Predictions and grading (§10.3)                                     */
/* ------------------------------------------------------------------ */

export type Prediction = { value: number; choice?: undefined } | { choice: string; value?: undefined }

/** What the learner typed or picked, before it is a prediction. */
export interface PredictionDraft {
  text?: string
  choice?: string
}

/** Parse a typed number: thousands separators and spaces are allowed, `1e3` too. */
export function parseNumeric(text: string): number | null {
  const t = text.trim().replace(/[,_\s]/g, '')
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** A draft becomes a prediction only if it answers the spec: a finite (positive, for `log`) number, or one of the options. */
export function checkPrediction(spec: PredictSpec, draft: PredictionDraft): Prediction | null {
  if (spec.kind === 'choice') {
    const id = draft.choice
    return id !== undefined && spec.options.some((o) => o.id === id) ? { choice: id } : null
  }
  const n = parseNumeric(draft.text ?? '')
  if (n === null) return null
  if (spec.log === true && n <= 0) return null
  return { value: n }
}

export interface PredictionGrade {
  /** Within tolerance (numeric) or equal (choice). */
  ok: boolean
  /** 1 when `ok`; otherwise falls linearly to 0 (see gradePrediction). */
  score: number
  /** Signed log10(predicted / actual), when both are positive numbers. */
  logErr?: number
}

const LOG10_2 = Math.log10(2)

/**
 * Grade a prediction against what the sim measured.
 * - numeric: within `tolerance.abs` or `tolerance.rel`; with `log: true`, within a factor of 2 (|log10(pred/actual)| <= log10 2).
 * - choice: equal.
 * A miss scores `1 - excess/width`, floored at 0: excess is the distance past the tolerance and the width is
 * 4 tolerances (numeric) or the gap between a factor of 2 and a factor of 10 (log), so a miss by an order of magnitude scores 0.
 * Returns null when the observation cannot answer this kind of prediction (the panel then keeps waiting).
 */
export function gradePrediction(spec: PredictSpec, pred: Prediction, actual: number | string): PredictionGrade | null {
  if (spec.kind === 'choice') {
    if (pred.choice === undefined) return null
    const ok = pred.choice === String(actual)
    return { ok, score: ok ? 1 : 0 }
  }
  if (pred.value === undefined) return null
  const a = typeof actual === 'number' ? actual : Number(actual)
  if (typeof actual === 'string' && actual.trim() === '') return null
  if (!Number.isFinite(a)) return null
  const p = pred.value
  const logErr = p > 0 && a > 0 ? round(Math.log10(p / a), 4) : undefined
  const withLog = (g: Omit<PredictionGrade, 'logErr'>): PredictionGrade => (logErr === undefined ? g : { ...g, logErr })
  if (spec.log === true) {
    if (p <= 0 || a <= 0) return { ok: false, score: 0 }
    const e = Math.abs(Math.log10(p / a))
    const ok = e <= LOG10_2 + 1e-9
    return withLog({ ok, score: ok ? 1 : clamp01(1 - (e - LOG10_2) / (1 - LOG10_2)) })
  }
  const diff = Math.abs(p - a)
  const { abs, rel } = spec.tolerance
  const tol = Math.max(abs ?? 0, (rel ?? 0) * Math.abs(a))
  const ok = diff <= tol + 1e-12
  return withLog({ ok, score: ok ? 1 : tol > 0 ? clamp01(1 - (diff - tol) / (4 * tol)) : 0 })
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)
const round = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits

/* ------------------------------------------------------------------ */
/* The per-task state machine (§10.3)                                  */
/* ------------------------------------------------------------------ */

export const MIN_EXPLAIN_WORDS = 8
export const MAX_EXPLAIN_CHARS = 280

export type RunPhase = 'predict' | 'run' | 'explain' | 'done'

export interface TaskRun {
  phase: RunPhase
  /** Locked once committed. */
  prediction?: Prediction
  conf?: Confidence
  committedAt?: number
  /** The first observation of the task's `observe` key after the commit. */
  observed?: { actual: number | string; unit?: string; grade: PredictionGrade }
  explain: string
  /** Indices of the ticked ideas, ascending. */
  ideas: number[]
}

export type RunAction =
  | { type: 'commit'; prediction: Prediction; conf?: Confidence; at: number }
  | { type: 'observe'; obs: Observation }
  | { type: 'explain'; text: string }
  | { type: 'idea'; index: number }
  | { type: 'finish' }
  | { type: 'retry' }

export const freshRun = (): TaskRun => ({ phase: 'predict', explain: '', ideas: [] })

export function wordCount(text: string): number {
  const t = text.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

export const explainReady = (text: string): boolean => wordCount(text) >= MIN_EXPLAIN_WORDS

/**
 * Pure transition. An action out of phase is ignored, so nothing can reach `done` without a committed
 * prediction, a graded observation and a long enough explanation.
 */
export function reduceRun(task: SimTaskDef, state: TaskRun, action: RunAction): TaskRun {
  switch (action.type) {
    case 'commit': {
      if (state.phase !== 'predict' || task.predict === undefined) return state
      if (checkPrediction(task.predict, predictionToDraft(action.prediction)) === null) return state
      return { ...state, phase: 'run', prediction: action.prediction, conf: action.conf, committedAt: action.at }
    }
    case 'observe': {
      if (state.phase !== 'run' || state.prediction === undefined || task.predict === undefined) return state
      if (action.obs.key !== task.observe) return state
      const grade = gradePrediction(task.predict, state.prediction, action.obs.value)
      if (grade === null) return state
      const observed = { actual: action.obs.value, unit: action.obs.unit, grade }
      return { ...state, phase: 'explain', observed }
    }
    case 'explain':
      return state.phase === 'explain' ? { ...state, explain: action.text.slice(0, MAX_EXPLAIN_CHARS) } : state
    case 'idea': {
      if (state.phase !== 'explain' || !explainReady(state.explain)) return state
      if (!Number.isInteger(action.index) || action.index < 0 || action.index > 2) return state
      const has = state.ideas.includes(action.index)
      const ideas = has ? state.ideas.filter((i) => i !== action.index) : [...state.ideas, action.index].sort()
      return { ...state, ideas }
    }
    case 'finish':
      return buildOutcome(task, state, { ms: 0 }) === null ? state : { ...state, phase: 'done' }
    case 'retry':
      return state.phase === 'done' ? freshRun() : state
  }
}

const predictionToDraft = (p: Prediction): PredictionDraft =>
  p.choice !== undefined ? { choice: p.choice } : { text: String(p.value) }

/** The prediction shown back to the learner, with its unit or the option text. */
export function describePrediction(spec: PredictSpec, p: Prediction): string {
  if (spec.kind === 'choice') return spec.options.find((o) => o.id === p.choice)?.text ?? String(p.choice)
  return `${formatNumber(p.value ?? NaN)} ${spec.unit}`.trim()
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-3)) return n.toExponential(2)
  return Number(n.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/**
 * The ledger outcome of a finished cycle, or null while any step is missing. `score` is the prediction's
 * score and `ok` is whether the prediction was right; the task still completes on a miss (§10.3). The
 * explanation is kept to 280 characters and stays in the learner's own ledger.
 */
export function buildOutcome(task: SimTaskDef, run: TaskRun, opts: { ms?: number } = {}): SimOutcome | null {
  const { prediction, observed } = run
  if (task.kind !== 'outcome' || task.predict === undefined) return null
  if (prediction === undefined || observed === undefined) return null // no committed prediction, no completion
  if (!explainReady(run.explain)) return null
  const data: SimOutcome['data'] = {
    v: 2,
    outcome: true,
    predict: predictField(task.predict, prediction),
    actual: observed.actual,
    explain: run.explain.trim().slice(0, MAX_EXPLAIN_CHARS),
    ideas: [...run.ideas],
  }
  if (observed.grade.logErr !== undefined) data.logErr = observed.grade.logErr
  if (task.kcs.length > 0) data.kcs = [...task.kcs]
  const out: SimOutcome = { taskId: task.id, score: observed.grade.score, ok: observed.grade.ok, data }
  if (run.conf !== undefined) out.conf = run.conf
  if (opts.ms !== undefined && opts.ms > 0) out.ms = Math.round(opts.ms)
  return out
}

function predictField(spec: PredictSpec, p: Prediction): SimOutcome['data']['predict'] {
  return spec.kind === 'choice' ? { choice: p.choice } : { value: p.value, unit: spec.unit }
}

/**
 * Phone mode (§10.4): the prediction graded against the canonical outcome, with no hands-on run behind it.
 * `ok` is false on purpose: a graded `ok` outcome would complete the task in the ledger (and skip the later
 * laptop run), but "full completion still needs the run on a laptop". The score still records how close the
 * prediction was, and `data.phone` marks where it came from.
 */
export function buildPhoneOutcome(
  task: SimTaskDef,
  prediction: Prediction,
  conf: Confidence | undefined,
  actual: number | string,
): SimOutcome | null {
  if (task.kind !== 'outcome' || task.predict === undefined) return null
  const grade = gradePrediction(task.predict, prediction, actual)
  if (grade === null) return null
  const data: SimOutcome['data'] = { v: 2, outcome: true, predict: predictField(task.predict, prediction), actual, phone: true }
  if (grade.logErr !== undefined) data.logErr = grade.logErr
  if (task.kcs.length > 0) data.kcs = [...task.kcs]
  const out: SimOutcome = { taskId: task.id, score: grade.score, ok: false, data }
  if (conf !== undefined) out.conf = conf
  return out
}

/** Write a finished cycle through `record` (the façade's `recordSimOutcome`). Returns whether anything was written. */
export function completeTask(
  record: (simId: string, outcome: SimOutcome) => void,
  task: SimTaskDef,
  run: TaskRun,
  opts: { ms?: number } = {},
): boolean {
  const outcome = buildOutcome(task, run, opts)
  if (outcome === null) return false
  record(task.simId, outcome)
  return true
}

/* ------------------------------------------------------------------ */
/* Phone mode (§10.4)                                                  */
/* ------------------------------------------------------------------ */

/** Below 640 px, or on a coarse primary pointer. */
export const PHONE_QUERY = '(max-width: 639.98px), (pointer: coarse)'

/** `today:prefs.phoneMode === false` is the only way to opt out. */
export function resolveInlineMode(phoneViewport: boolean, prefs: unknown): Exclude<SimHostMode, 'lab'> {
  const off = typeof prefs === 'object' && prefs !== null && (prefs as { phoneMode?: unknown }).phoneMode === false
  return phoneViewport && !off ? 'phone' : 'embed'
}

/** Whether the viewport is a phone's (re-evaluated when it changes). False where there is no window. */
export function usePhoneViewport(): boolean {
  return useSyncExternalStore(subscribePhone, phoneSnapshot, () => false)
}

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return NOOP
  const mql = window.matchMedia(PHONE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function phoneSnapshot(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}

/* ------------------------------------------------------------------ */
/* The laptop queue (working key `queue:laptop`, §3.5)                 */
/* ------------------------------------------------------------------ */

// A type alias, not an interface: it must be assignable to the ledger's `Json`.
export type LaptopQueueItem = {
  simId: string
  taskId: string
  at: string
}

export const LAPTOP_QUEUE_MAX = 20

/** Tolerant read of the working value: anything that is not a well-formed item is dropped. */
export function parseLaptopQueue(value: unknown): LaptopQueueItem[] {
  if (!Array.isArray(value)) return []
  const out: LaptopQueueItem[] = []
  for (const v of value) {
    if (typeof v !== 'object' || v === null) continue
    const { simId, taskId, at } = v as Record<string, unknown>
    if (typeof simId === 'string' && typeof taskId === 'string' && typeof at === 'string') out.push({ simId, taskId, at })
  }
  return out
}

/** Append `item`; a task already queued moves to the end, and only the newest 20 stay. */
export function queueForLaptop(prev: unknown, item: LaptopQueueItem): LaptopQueueItem[] {
  const rest = parseLaptopQueue(prev).filter((q) => !(q.simId === item.simId && q.taskId === item.taskId))
  return [...rest, item].slice(-LAPTOP_QUEUE_MAX)
}

/* ------------------------------------------------------------------ */
/* Canonical outcomes for phone mode                                   */
/* ------------------------------------------------------------------ */

/** One series point: a category (bars) or a number (line). */
export interface ChartPoint {
  x: number | string
  y: number
  label?: string
}

/** What a pure sim model returns for a task's canonical config. */
export interface CanonicalOutcome {
  /** The value that grades the prediction (a number, or the winning option id). */
  actual: number | string
  unit?: string
  /** One sentence naming the result, shown above the chart. */
  summary: string
  chart: {
    kind: 'bars' | 'line'
    xLabel: string
    yLabel: string
    points: readonly ChartPoint[]
    /** Index into `points` to mark. */
    mark?: number
    logX?: boolean
    logY?: boolean
  }
  table: MirrorTable
}

export type PhoneModel = () => CanonicalOutcome

/** A module under `src/lib/sims/models/` exports its models by name: `export const PHONE_MODELS = { 'b200-ridge': () => ... }`. */
export interface PhoneModelModule {
  PHONE_MODELS: Readonly<Record<string, PhoneModel>>
}

/** `phone.canonical` is `<model>.<name>`: the file `models/<model>.ts` and its key in `PHONE_MODELS`. */
export function splitCanonical(key: string): { model: string; name: string } | null {
  const dot = key.indexOf('.')
  if (dot <= 0 || dot === key.length - 1) return null
  return { model: key.slice(0, dot), name: key.slice(dot + 1) }
}

/* ------------------------------------------------------------------ */
/* Mirror announcements (§10.5)                                        */
/* ------------------------------------------------------------------ */

/** A mirror's live region speaks at most once per second. */
export const ANNOUNCE_MIN_GAP_MS = 1000

/** How long to wait before announcing now, given when the last announcement was made (null: never). */
export function announceDelay(lastAt: number | null, now: number, gapMs: number = ANNOUNCE_MIN_GAP_MS): number {
  return lastAt === null ? 0 : Math.max(0, lastAt + gapMs - now)
}
