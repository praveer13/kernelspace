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
/** An ids answer, or a reply read as ids, is at most this many ids: the most the ledger stores (codec.ts, isProveAnswer). */
export const PROVE2_MAX_IDS = 12
/** A template id is the event's `qid`, which the ledger holds to 1 to this many characters (codec.ts, MAX_QID_LENGTH). */
export const PROVE2_MAX_QID = 40
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
  /** Of a `lab-check` event: the credit its run earned, and the module it graded (`attemptsOf` reads both). */
  provenance?: string
  wasmSha256?: string
  data?: unknown
}

const isNumberOrIds = (x: unknown): x is number | number[] => typeof x === 'number' || (Array.isArray(x) && x.every((v) => typeof v === 'number'))

/**
 * What the ledger stores as a v2 `answer` or `actual`: a finite number, or an ordered list of at most 12 whole ids of
 * 0 or more (codec.ts, isProveAnswer). An answer or a reply outside this shape would build an event the codec refuses,
 * and the attempt would be lost on reload, so neither ever reaches `buildProve2Result`'s output.
 */
export const isProve2Answer = (x: unknown): x is number | number[] =>
  (typeof x === 'number' && Number.isFinite(x)) || (Array.isArray(x) && x.length <= PROVE2_MAX_IDS && x.every((v) => Number.isInteger(v) && v >= 0))

const SHA256_HEX = /^[0-9a-f]{64}$/

/** A copy as the ledger gives it back: JSON has no -0, so a -0 is stored as the 0 a reload reads. */
const stored = (a: number | number[]): number | number[] => (typeof a === 'number' ? a + 0 : a.map((v) => v + 0))

/** A caller handed over an answer `readAnswer` never gives: a bug, so it throws instead of building an attempt the ledger drops. */
const notAnAnswer = (answer: unknown): RangeError =>
  new RangeError(`an answer is a number or at most ${PROVE2_MAX_IDS} whole ids of 0 or more (readAnswer), not ${JSON.stringify(answer)}`)

function sameAnswer(a: number | number[] | null, b: number | number[] | null): boolean {
  if (a === null || b === null) return false
  if (typeof a === 'number' || typeof b === 'number') return a === b
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * The v2 attempts among a lab's `prove` events, oldest first. v1 events (and anything malformed) are skipped: a v1
 * attempt neither opens nor waits out a v2 retry. Right means the recorded answer equals the recorded actual.
 *
 * Whether an attempt was credited is read back the way `proveFromModule` decided it: the lab's latest run at or before
 * the attempt (a `lab-check` on `lab:<id>`, never an `@reference` build) must have had provenance `unseen` and the
 * attempt's `wasmSha256`. Any other attempt, such as a practice miss on a module that was not graded `unseen`, is
 * `credited: false` and never opens a 24 h wait. A 30-day return (`data.return`) is not a credited attempt either: it is
 * a recall check on a lab already proved, so a miss there starts no wait, and a return never waits one out.
 */
export function attemptsOf(events: readonly ProveEventLike[], labId: string): Prove2Attempt[] {
  const runs = events
    .filter((e) => e.kind === 'lab-check' && e.ref === `lab:${labId}`)
    .map((e, i) => ({ t: ms(e.at), i, e }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
  const creditedAt = (at: string, sha: string | undefined): boolean => {
    let latest: ProveEventLike | null = null
    for (const r of runs) if (r.t <= ms(at)) latest = r.e
    return latest !== null && latest.provenance === 'unseen' && sha !== undefined && latest.wasmSha256 === sha
  }
  const out: Prove2Attempt[] = []
  for (const e of events) {
    if (e.kind !== 'prove' || e.ref !== `prove:${labId}`) continue
    const d = e.data as Partial<ProveDataV2> | undefined
    if (typeof d !== 'object' || d === null || d.v !== 2 || typeof d.qid !== 'string' || !isNumberOrIds(d.answer)) continue
    const credited = d.return !== true && creditedAt(e.at, e.wasmSha256)
    out.push({ at: e.at, qid: d.qid, right: d.actual !== undefined && sameAnswer(d.answer, d.actual), ...(credited ? {} : { credited: false as const }) })
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

/** The question for (template, seed). Throws when the template breaks its own contract (an id of 1 to 40 characters, 1 to 12 calls, a story, an ask). */
export function planQuestion(template: ProveV2Template, seed: number): Prove2Plan {
  if (template.id.length === 0 || template.id.length > PROVE2_MAX_QID) throw new Error(`template id '${template.id.slice(0, 50)}' must be 1 to ${PROVE2_MAX_QID} characters`)
  const q = template.make(seed >>> 0)
  if (q.calls.length < 1 || q.calls.length > PROVE2_MAX_CALLS) {
    throw new Error(`template ${template.id} made ${q.calls.length} calls; a trace is 1 to ${PROVE2_MAX_CALLS}`)
  }
  if (q.calls.some((c) => c.trim() === '')) throw new Error(`template ${template.id} made an empty call`)
  if (q.story.length === 0 || q.ask.trim() === '') throw new Error(`template ${template.id} needs a story and an ask`)
  return { templateId: template.id, seed: seed >>> 0, kcs: [...template.kcs], calls: [...q.calls], story: [...q.story], ask: q.ask, answer: q.answer }
}

/** The learner's input read as an answer, or what to change so it reads as one. */
export type AnswerRead = { ok: true; answer: number | number[] } | { ok: false; message: string }

/**
 * The learner's input as an answer: a number, or ids in order separated by commas or spaces, or `none` for no ids
 * (a module may answer an empty list: no request preempted, say). Anything else is not an answer, never a guess, and
 * the message says what to type instead; the panel keeps the input. Every answer read here is one the ledger stores
 * (`isProve2Answer`): at most 12 ids, each a whole number of 0 or more.
 */
export function readAnswer(text: string, kind: 'number' | 'ids'): AnswerRead {
  const t = text.trim()
  if (kind === 'number') {
    if (!/^-?\d+(\.\d+)?$/.test(t)) return { ok: false, message: 'Type one number, such as 12 or 2.5.' }
    const n = Number(t)
    return Number.isFinite(n) ? { ok: true, answer: n } : { ok: false, message: 'That number is too long to be a reply. Type the number your module replies.' }
  }
  if (/^none$/i.test(t)) return { ok: true, answer: [] }
  const parts = t.split(/[\s,]+/).filter((p) => p !== '')
  if (parts.length === 0) return { ok: false, message: 'Type the ids in order, separated by commas, such as 3, 7, 1, or none if the list is empty.' }
  if (!parts.every((p) => /^\d+$/.test(p) && Number.isSafeInteger(Number(p)))) {
    return { ok: false, message: 'Each id is a whole number of 0 or more, such as 3, 7, 1, with no signs, decimals or letters.' }
  }
  if (parts.length > PROVE2_MAX_IDS) return { ok: false, message: `An answer holds at most ${PROVE2_MAX_IDS} ids, and this one has ${parts.length}. Type the ${PROVE2_MAX_IDS} or fewer your module replies.` }
  return { ok: true, answer: parts.map(Number) }
}

/** `readAnswer`'s answer, or null when the input is not one (then `readAnswer` says why). */
export function parseAnswer(text: string, kind: 'number' | 'ids'): number | number[] | null {
  const r = readAnswer(text, kind)
  return r.ok ? r.answer : null
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
  // A reading the ledger cannot store (more than 12 ids, a negative or fractional id, NaN) is an unreadable reply, not an actual.
  if (!isProve2Answer(actual)) {
    return { right: false, actual: null, failed: 'error', message: `the replies could not be read as an answer (a number, or at most ${PROVE2_MAX_IDS} whole ids of 0 or more)` }
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
 * The `recordProve` argument (wave-3.md §3.2): `ok` means right, the stored answer equals the stored actual, and
 * `score` is `ok ? 1 : 0`. So a miss, or a module that failed (actual null), is `ok: false`: the fold gives it no
 * `proves[lab]`, no `prove:<lab>` fact and never `proved`. Provenance is `proved` only when the answer is right and
 * the attempt is credited (module graded `unseen`, no retry waiting) on a hashed module; otherwise `practice`.
 *
 * Every result passes the ledger codec (tests/forge/prove2-codec.test.ts): an actual it could not store is null (an
 * unreadable reply), a malformed hash or `ms` is left out, and an answer, plan or template id it could not store is
 * a caller's bug that throws here rather than build an attempt the ledger would drop on reload.
 */
export function buildProve2Result(i: BuildInput): ProveResult {
  if (!isProve2Answer(i.answer)) throw notAnAnswer(i.answer)
  const qid = i.plan.templateId
  if (qid.length === 0 || qid.length > PROVE2_MAX_QID) throw new RangeError(`template id '${qid.slice(0, 50)}' must be 1 to ${PROVE2_MAX_QID} characters`)
  const calls = i.plan.calls.length
  if (calls < 1 || calls > PROVE2_MAX_CALLS) throw new RangeError(`a plan of ${calls} calls; a trace is 1 to ${PROVE2_MAX_CALLS} (planQuestion)`)
  const actual = isProve2Answer(i.grade.actual) ? i.grade.actual : null
  const right = actual !== null && sameAnswer(i.answer, actual)
  const sha = i.moduleSha !== null && SHA256_HEX.test(i.moduleSha) ? i.moduleSha : null
  const proved = right && i.eligibility.credited && sha !== null
  const data: ProveDataV2 = {
    v: 2,
    qid,
    kcs: i.plan.kcs.slice(0, 6),
    answer: stored(i.answer),
    actual: actual === null ? null : stored(actual),
    calls,
    ...(i.ret ? { return: true as const } : {}),
  }
  return {
    labId: i.labId,
    score: right ? 1 : 0,
    ok: right,
    ...(i.ms === undefined || !Number.isFinite(i.ms) ? {} : { ms: Math.max(0, Math.round(i.ms)) }),
    provenance: proved ? 'proved' : 'practice',
    ...(sha === null ? {} : { wasmSha256: sha }),
    seed: i.plan.seed >>> 0,
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
 * hash of `bytes` is the one the graded run named, so a different module than ForgeLab graded earns practice. An answer
 * `readAnswer` would not give throws before the module runs.
 */
export async function proveFromModule(i: ProveAttemptInput): Promise<ProveAttemptResult> {
  if (!isProve2Answer(i.answer)) throw notAnAnswer(i.answer)
  const outcome = await runPlan(i.bytes, i.plan, i.run)
  if (outcome.kind === 'refused') return { kind: 'refused', message: outcome.message }
  const grade = gradeAnswer(i.template, i.answer, outcome)
  const hashed = await (i.hash ?? sha256Hex)(i.bytes).catch(() => null)
  const moduleSha = typeof hashed === 'string' && SHA256_HEX.test(hashed) ? hashed : null
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
  const opensAt = elig.credited ? (result.ok || i.ret ? null : i.now + RETRY_AFTER_MS) : elig.reason === 'retry' ? (elig.opensAt ?? null) : null
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
