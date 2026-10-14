/**
 * H4 v2, "Prove it" on your own module: the core (docs/specs/wave-3.md §7.3).
 *
 * After an unseen-seed green the learner closes their agent and predicts what their module replies to a seeded list
 * of ks_invoke calls. The simulator, not a model, grades: the answer is right when it equals the template's `read` of
 * the module's replies. Provenance `proved` needs three things at once: the answer is right; the module is the one
 * ForgeLab just graded (same sha256), and that run had credit `unseen`; and no credited attempt for the lab is
 * waiting out its 24 h retry. Anything else is `practice`, and says so. Nothing is locked (W8): you can always practise.
 *
 * Everything here is pure except `proveFromModule`, which takes the call runner (`runLabCalls`, lab-worker.ts) and a
 * hash as parameters, so tests drive it with fake modules (tests/forge/fixtures.ts). The panel is 3b-04's.
 * The templates are a bundle's `prove2` (src/data/forge/types.ts); nothing here names a lab.
 */

import type { ProveV2Template } from '@/data/forge/types'
import { sha256Hex } from '@/lib/ledger/stable'
import type { LocalDay, ProveDataV2, ProveResult } from '@/lib/ledger/types'
import { addDays, daysBetween } from '@/lib/learner/reentry'
import { LabAbiError, LabTimeoutError, LabTrapError } from '../wasm-lab'
import { RETRY_AFTER_MS } from './prove'
import type { Credit } from './run'

/** A trace is at most this many calls (§7.2; ProveDataV2.calls is 1 to 12). */
export const PROVE2_MAX_CALLS = 12
/** An ids answer is at most this many ids. */
export const PROVE2_MAX_IDS = 16
/** The 30-day return is due this many local days after a lab's first prove event (§7.5). */
export const RETURN_AFTER_DAYS = 30

const ms = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/* ------------------------------------------------------------------ */
/* History: what the ledger's v2 prove events say                       */
/* ------------------------------------------------------------------ */

/** One past v2 attempt on a lab. */
export interface Prove2Attempt {
  /** ISO instant of the event. */
  at: string
  /** The template served. */
  qid: string
  /** The answer equalled the module's. */
  right: boolean
  /** `false` when the attempt was known not to be credited (it never waits out or opens a retry). Absent means the window alone decides. */
  credited?: false
}

/** What `attemptsOf` and `firstProve` read: the envelope of any ledger event, with its `data` unchecked. */
export interface ProveEventLike {
  kind: string
  ref: string
  at: string
  day: string
  data?: unknown
}

const isNumberOrIds = (x: unknown): x is number | number[] => typeof x === 'number' || (Array.isArray(x) && x.every((v) => typeof v === 'number'))

function sameAnswer(a: number | number[] | null, b: number | number[] | null): boolean {
  if (a === null || b === null) return false
  if (typeof a === 'number' || typeof b === 'number') return a === b
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * The v2 attempts among a lab's `prove` events, oldest first. v1 events (and anything malformed) are skipped: a v1
 * attempt neither opens nor waits out a v2 retry. Right means the recorded answer equals the recorded actual.
 */
export function attemptsOf(events: readonly ProveEventLike[], labId: string): Prove2Attempt[] {
  const out: Prove2Attempt[] = []
  for (const e of events) {
    if (e.kind !== 'prove' || e.ref !== `prove:${labId}`) continue
    const d = e.data as Partial<ProveDataV2> | undefined
    if (typeof d !== 'object' || d === null || d.v !== 2 || typeof d.qid !== 'string' || !isNumberOrIds(d.answer)) continue
    out.push({ at: e.at, qid: d.qid, right: d.actual !== undefined && sameAnswer(d.answer, d.actual) })
  }
  return out.sort((a, b) => ms(a.at) - ms(b.at))
}

/* ------------------------------------------------------------------ */
/* Retries and eligibility                                              */
/* ------------------------------------------------------------------ */

/**
 * Whether a credited attempt is open now. Replays the attempts in time order: an attempt at or after the time the window
 * opened is credited, and a wrong credited attempt closes it for RETRY_AFTER_MS; an attempt before that is practice and
 * moves nothing, so practising never extends the wait.
 */
export function retryWindow(history: readonly Prove2Attempt[], now: number): { open: boolean; opensAt: number | null } {
  let opensAt = 0
  for (const a of [...history].sort((x, y) => ms(x.at) - ms(y.at))) {
    if (a.credited === false || ms(a.at) < opensAt) continue
    if (!a.right) opensAt = ms(a.at) + RETRY_AFTER_MS
  }
  return opensAt > now ? { open: false, opensAt } : { open: true, opensAt: null }
}

/** The run that graded the module the learner is about to be asked about (ForgeLab's `credit`, and the hash of the module that earned it). */
export interface GradedRun {
  sha256: string
  credit: Credit
}

export type Eligibility =
  | { credited: true }
  /** `credit`: the graded run was not `unseen` (or there was none); `module`: it graded a different module; `retry`: a credited miss is waiting out its 24 h. */
  | { credited: false; reason: 'credit' | 'module' | 'retry'; opensAt?: number }

/** Whether an attempt on the module with `moduleSha` can earn `proved` now (§7.3, conditions 2 and 3). */
export function eligibility(graded: GradedRun | null, moduleSha: string | null, history: readonly Prove2Attempt[], now: number): Eligibility {
  if (graded === null || graded.credit !== 'unseen') return { credited: false, reason: 'credit' }
  if (moduleSha === null || moduleSha !== graded.sha256) return { credited: false, reason: 'module' }
  const w = retryWindow(history, now)
  return w.open ? { credited: true } : { credited: false, reason: 'retry', ...(w.opensAt === null ? {} : { opensAt: w.opensAt }) }
}

/* ------------------------------------------------------------------ */
/* Planning                                                             */
/* ------------------------------------------------------------------ */

/**
 * The template for the next question: never-served first, then the one served longest ago, ties in the bundle's order.
 * So the second question is another template and the cycle repeats. Throws on an empty list (a bundle without `prove2`
 * has no v2 panel).
 */
export function pickTemplate(templates: readonly ProveV2Template[], history: readonly Prove2Attempt[]): ProveV2Template {
  if (templates.length === 0) throw new Error('this lab has no Prove-it v2 templates')
  const served = new Map<string, { n: number; last: number }>()
  for (const a of history) {
    const prev = served.get(a.qid) ?? { n: 0, last: 0 }
    served.set(a.qid, { n: prev.n + 1, last: Math.max(prev.last, ms(a.at)) })
  }
  const rank = (t: ProveV2Template) => served.get(t.id) ?? { n: 0, last: 0 }
  return templates
    .map((t, i) => ({ t, i, ...rank(t) }))
    .sort((a, b) => a.n - b.n || a.last - b.last || a.i - b.i)[0].t
}

/** One question: the calls to run, the story that tells them in words, and what to ask. */
export interface Prove2Plan {
  templateId: string
  seed: number
  kcs: string[]
  calls: string[]
  story: string[]
  ask: string
  answer: 'number' | 'ids'
}

/** The question for (template, seed). Throws when the template breaks its own contract (1 to 12 calls, a story, an ask). */
export function planQuestion(template: ProveV2Template, seed: number): Prove2Plan {
  const q = template.make(seed >>> 0)
  if (q.calls.length < 1 || q.calls.length > PROVE2_MAX_CALLS) {
    throw new Error(`template ${template.id} made ${q.calls.length} calls; a trace is 1 to ${PROVE2_MAX_CALLS}`)
  }
  if (q.calls.some((c) => c.trim() === '')) throw new Error(`template ${template.id} made an empty call`)
  if (q.story.length === 0 || q.ask.trim() === '') throw new Error(`template ${template.id} needs a story and an ask`)
  return { templateId: template.id, seed: seed >>> 0, kcs: [...template.kcs], calls: [...q.calls], story: [...q.story], ask: q.ask, answer: q.answer }
}

/**
 * The learner's input as an answer: a number, or ids separated by commas or spaces. Null when it is not one of those
 * (the panel keeps the input and says what it expects), never a guess.
 */
export function parseAnswer(text: string, kind: 'number' | 'ids'): number | number[] | null {
  const t = text.trim()
  if (kind === 'number') return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null
  if (t === '') return null
  const parts = t.split(/[\s,]+/).filter((p) => p !== '')
  if (parts.length > PROVE2_MAX_IDS || !parts.every((p) => /^-?\d+$/.test(p))) return null
  return parts.map(Number)
}

/* ------------------------------------------------------------------ */
/* Running and grading                                                  */
/* ------------------------------------------------------------------ */

/** `runLabCalls` (lab-worker.ts): the replies to `calls`, in order, from the module in the lab worker. */
export type RunCalls = (bytes: ArrayBuffer, calls: string[]) => Promise<string[]>

export type CallOutcome =
  | { kind: 'replied'; replies: string[] }
  /** The module trapped, spun past the budget, or answered unreadably: the answer is wrong and the panel says the module failed. */
  | { kind: 'failed'; reason: 'trap' | 'timeout' | 'error'; message: string }
  /** The module may not be asked at all (a reference build, no ks_invoke, a v1 template): nothing is graded or recorded. */
  | { kind: 'refused'; message: string }

/** Run the plan's calls on the module. A trap, a timeout or a refusal becomes an outcome; any other error is thrown. */
export async function runPlan(bytes: ArrayBuffer, plan: Prove2Plan, run: RunCalls): Promise<CallOutcome> {
  try {
    const replies = await run(bytes, plan.calls)
    if (replies.length !== plan.calls.length) {
      return { kind: 'failed', reason: 'error', message: `the module answered ${replies.length} of ${plan.calls.length} calls` }
    }
    return { kind: 'replied', replies }
  } catch (e) {
    if (e instanceof LabTimeoutError) return { kind: 'failed', reason: 'timeout', message: e.message }
    if (e instanceof LabTrapError) return { kind: 'failed', reason: 'trap', message: e.message }
    if (e instanceof LabAbiError) return { kind: 'refused', message: e.message }
    throw e
  }
}

export interface Prove2Grade {
  /** The answer equals the module's, exactly. */
  right: boolean
  /** What the module replied; null when it failed. */
  actual: number | number[] | null
  failed: null | 'trap' | 'timeout' | 'error'
  /** Why the module failed, for the panel. */
  message?: string
}

/** Grade `answer` against what the module replied. A failed module makes `actual` null and the answer wrong. */
export function gradeAnswer(template: ProveV2Template, answer: number | number[], outcome: Exclude<CallOutcome, { kind: 'refused' }>): Prove2Grade {
  if (outcome.kind === 'failed') return { right: false, actual: null, failed: outcome.reason, message: outcome.message }
  let actual: number | number[]
  try {
    actual = template.read(outcome.replies)
  } catch (e) {
    return { right: false, actual: null, failed: 'error', message: e instanceof Error ? e.message : String(e) }
  }
  if (!isNumberOrIds(actual) || (typeof actual === 'number' && !Number.isFinite(actual))) {
    return { right: false, actual: null, failed: 'error', message: 'the replies could not be read as an answer' }
  }
  return { right: sameAnswer(answer, actual), actual, failed: null }
}

/* ------------------------------------------------------------------ */
/* The result                                                           */
/* ------------------------------------------------------------------ */

export interface BuildInput {
  labId: string
  plan: Prove2Plan
  answer: number | number[]
  grade: Prove2Grade
  eligibility: Eligibility
  /** The module's lowercase hex SHA-256, or null when it could not be hashed (then the event is practice). */
  moduleSha: string | null
  /** Milliseconds from the question shown to the answer given. */
  ms?: number
  /** The 30-day return (§7.5). */
  ret?: boolean
}

/**
 * The `recordProve` argument. Provenance is `proved` only when the answer is right and the attempt is credited
 * (module graded `unseen`, no retry waiting); otherwise `practice`. `ok` is true: the question was answered (a
 * failed module is a wrong answer, not an unanswered one). A miss scores 0.
 */
export function buildProve2Result(i: BuildInput): ProveResult {
  const proved = i.grade.right && i.eligibility.credited && i.moduleSha !== null
  const data: ProveDataV2 = {
    v: 2,
    qid: i.plan.templateId,
    kcs: i.plan.kcs.slice(0, 6),
    answer: i.answer,
    actual: i.grade.actual,
    calls: i.plan.calls.length,
    ...(i.ret ? { return: true as const } : {}),
  }
  return {
    labId: i.labId,
    score: i.grade.right ? 1 : 0,
    ok: true,
    ...(i.ms === undefined ? {} : { ms: Math.max(0, Math.round(i.ms)) }),
    provenance: proved ? 'proved' : 'practice',
    ...(i.moduleSha === null ? {} : { wasmSha256: i.moduleSha }),
    seed: i.plan.seed,
    data,
  }
}

export interface ProveAttemptInput {
  labId: string
  template: ProveV2Template
  plan: Prove2Plan
  answer: number | number[]
  /** The module to ask, as dropped or as installed. */
  bytes: ArrayBuffer
  /** The run that graded this module; null when none did. */
  graded: GradedRun | null
  history: readonly Prove2Attempt[]
  /** Epoch ms. */
  now: number
  run: RunCalls
  hash?: (bytes: ArrayBuffer) => Promise<string>
  ms?: number
  ret?: boolean
}

export type ProveAttemptResult =
  | { kind: 'refused'; message: string }
  | {
      kind: 'graded'
      grade: Prove2Grade
      eligibility: Eligibility
      /** The `recordProve` argument. */
      result: ProveResult
      /** Epoch ms when the next credited attempt opens: 24 h on, after a credited miss; the wait still running otherwise; null when one is open. */
      opensAt: number | null
    }

/**
 * One attempt end to end: run the plan's calls on the module, grade the answer, decide the provenance. A refused module
 * (reference build, no bridge, v1 template) is reported and nothing is graded. The attempt is credited only when the
 * hash of `bytes` is the one the graded run named, so a different module than ForgeLab graded earns practice.
 */
export async function proveFromModule(i: ProveAttemptInput): Promise<ProveAttemptResult> {
  const outcome = await runPlan(i.bytes, i.plan, i.run)
  if (outcome.kind === 'refused') return { kind: 'refused', message: outcome.message }
  const grade = gradeAnswer(i.template, i.answer, outcome)
  const moduleSha = await (i.hash ?? sha256Hex)(i.bytes).catch(() => null)
  const elig = eligibility(i.graded, moduleSha, i.history, i.now)
  const result = buildProve2Result({
    labId: i.labId,
    plan: i.plan,
    answer: i.answer,
    grade,
    eligibility: elig,
    moduleSha,
    ...(i.ms === undefined ? {} : { ms: i.ms }),
    ...(i.ret ? { ret: true } : {}),
  })
  const opensAt = elig.credited ? (grade.right ? null : i.now + RETRY_AFTER_MS) : elig.reason === 'retry' ? (elig.opensAt ?? null) : null
  return { kind: 'graded', grade, eligibility: elig, result, opensAt }
}

/* ------------------------------------------------------------------ */
/* The 30-day return (§7.5)                                             */
/* ------------------------------------------------------------------ */

/** A lab's first `prove` event, v1 or v2: its instant and local day. Null when there is none. */
export function firstProve(events: readonly ProveEventLike[], labId: string): { at: string; day: LocalDay } | null {
  let best: ProveEventLike | null = null
  for (const e of events) {
    if (e.kind !== 'prove' || e.ref !== `prove:${labId}`) continue
    if (best === null || ms(e.at) < ms(best.at)) best = e
  }
  return best === null ? null : { at: best.at, day: best.day }
}

/** The local day the return question is due: 30 local days after the first prove event's day. */
export const returnDay = (firstDay: LocalDay): LocalDay => addDays(firstDay, RETURN_AFTER_DAYS)

/** Whether the return question is due on `today`: at least 30 local days since the first prove event's day. A malformed day is never due. */
export const returnDue = (firstDay: LocalDay, today: LocalDay): boolean => daysBetween(firstDay, today) >= RETURN_AFTER_DAYS
