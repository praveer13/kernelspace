/**
 * Grading (docs/specs/wave-1.md §5.2): numeric tolerance, log-scored estimates, 90 % intervals scored
 * with the Winkler interval score, choice grading by id, and the ratio diagnosis that turns a wrong
 * number into a named slip ("You priced FP16: this cache is FP8, 1 byte per value.").
 *
 * Pure: no clock, no randomness, no DOM. Logs are allowed here (and in staircase.ts) and nowhere in
 * instance construction (§5.4). `grade` never throws: a hostile response is simply wrong.
 */

import type { AnswerSpec, Diagnosis, Grade, Instance, RatioRule, Response, Tolerance } from './types'
import { formatNumber, toCanonical } from './units'

/** Default relative window around a rule's ratio (±2 %). */
export const DEFAULT_RATIO_TOL = 0.02

/** The Winkler penalty weight 2/α for a 90 % interval (α = 0.1). */
export const WINKLER_PENALTY = 20

/** Slack on the estimate boundary, so a response exactly `okWithinFactor` times the truth is ok. */
const FACTOR_SLACK = 1e-9

/* ------------------------------ shared ratio rules ------------------------------ */

const rule = (id: string, ratio: number, message: string, tol?: number): RatioRule => ({ id, ratio, message, ...(tol === undefined ? {} : { tol }) })

/**
 * Unit slips, tried after the family's own rules. Each direction is its own entry, so the message
 * can say which way the learner slipped; an id may therefore appear twice. Kilo, kibi and
 * kibi-vs-kilo use ±1 % windows: 1,000 and 1,024 sit only 2.4 % apart, so the default ±2 % would
 * overlap and blame the wrong prefix.
 */
export const SHARED_RULES: readonly RatioRule[] = [
  rule('unit.kilo', 1000, 'Your answer is 1,000 times the truth: a kilo prefix slipped (check KB against B, or TB against GB).', 0.01),
  rule('unit.kilo', 1 / 1000, 'Your answer is a thousandth of the truth: a kilo prefix slipped (check B against KB, or GB against TB).', 0.01),
  rule('unit.kibi', 1024, 'Your answer is 1,024 times the truth: you stepped a binary prefix too far (1 KiB is 1,024 bytes).', 0.01),
  rule('unit.kibi', 1 / 1024, 'Your answer is 1/1,024 of the truth: you missed a binary step (1 KiB is 1,024 bytes).', 0.01),
  rule('unit.kibi-vs-kilo', 1.024, 'Your answer is 2.4 % high, the gap between 1,000 and 1,024: the item\'s unit says which one counts.', 0.01),
  rule('unit.kibi-vs-kilo', 1 / 1.024, 'Your answer is 2.4 % low, the gap between 1,000 and 1,024: the item\'s unit says which one counts.', 0.01),
  rule('unit.bits-bytes', 8, 'Your answer is 8 times the truth: bits and bytes got swapped (a byte is 8 bits).'),
  rule('unit.bits-bytes', 1 / 8, 'Your answer is an eighth of the truth: bits and bytes got swapped (a byte is 8 bits).'),
]

/** A rule's ratio for this instance, or null when it does not apply (or is not a usable number). */
export function ruleRatio(r: RatioRule, inst: Instance): number | null {
  const rho = typeof r.ratio === 'function' ? r.ratio(inst) : r.ratio
  return rho !== null && Number.isFinite(rho) && rho > 0 ? rho : null
}

/**
 * The first rule whose ratio matches `ratio` = response / truth: the family's own rules in order,
 * then the shared unit rules. `|ratio / ρ − 1| ≤ tol`.
 */
export function diagnose(inst: Instance, ratio: number, familyRules: readonly RatioRule[]): Diagnosis | undefined {
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined
  for (const r of [...familyRules, ...SHARED_RULES]) {
    const rho = ruleRatio(r, inst)
    if (rho === null) continue
    if (Math.abs(ratio / rho - 1) <= (r.tol ?? DEFAULT_RATIO_TOL)) {
      return { id: r.id, ratio, message: typeof r.message === 'function' ? r.message(inst) : r.message }
    }
  }
  return undefined
}

/* ------------------------------ numbers ------------------------------ */

/** Whether `x` is within `tol` of `truth`: relative, absolute, or either. No tolerance means exact. */
export function inTolerance(x: number, truth: number, tol: Tolerance): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(truth)) return false
  const diff = Math.abs(x - truth)
  if (tol.rel !== undefined && diff <= tol.rel * Math.abs(truth)) return true
  if (tol.abs !== undefined && diff <= tol.abs) return true
  return tol.rel === undefined && tol.abs === undefined && x === truth
}

/** |log10(x / truth)|, or undefined when either is not a positive finite number. */
export function logError(x: number, truth: number): number | undefined {
  if (!(x > 0) || !(truth > 0) || !Number.isFinite(x) || !Number.isFinite(truth)) return undefined
  return Math.abs(Math.log10(x / truth))
}

/** The estimate score: `max(0, 1 − logErr / log10(5 · okWithinFactor))`. */
export function estimateScore(logErr: number, okWithinFactor: number): number {
  return Math.max(0, 1 - logErr / Math.log10(5 * okWithinFactor))
}

/**
 * The Winkler interval score of a 90 % interval [lo, hi] against `truth`, in log10 space, lower is
 * better: `(Lhi − Llo) + 20·max(0, Llo − Lt) + 20·max(0, Lt − Lhi)` (α = 0.1). Undefined unless all
 * three are positive finite numbers. A reversed interval is read the way it was meant (swapped).
 */
export function winkler(lo: number, hi: number, truth: number): { hit: boolean; score: number } | undefined {
  for (const v of [lo, hi, truth]) if (!(v > 0) || !Number.isFinite(v)) return undefined
  const a = Math.min(lo, hi)
  const b = Math.max(lo, hi)
  const La = Math.log10(a)
  const Lb = Math.log10(b)
  const Lt = Math.log10(truth)
  return {
    hit: a <= truth && truth <= b,
    score: Lb - La + WINKLER_PENALTY * Math.max(0, La - Lt) + WINKLER_PENALTY * Math.max(0, Lt - Lb),
  }
}

/* ------------------------------ grading ------------------------------ */

const show = (n: number, unit: string): string => `${formatNumber(n)}${unit ? ` ${unit}` : ''}`
const ungradable = (feedback: string): Grade => ({ ok: false, score: 0, feedback })

function gradeNumeric(inst: Instance, a: Extract<AnswerSpec, { kind: 'numeric' }>, resp: Extract<Response, { kind: 'numeric' }>, rules: readonly RatioRule[]): Grade {
  if (typeof resp.value !== 'number' || !Number.isFinite(resp.value)) return ungradable('That was not a number I can grade. Enter digits only.')
  const x = toCanonical(resp.value, resp.unit, a.unit, a.units)
  if (x === null) return ungradable(`"${resp.unit}" is not one of the units offered here. Pick one from the list.`)
  const logErr = logError(x, a.truth)
  const ok = inTolerance(x, a.truth, a.tolerance)
  const base = { ok, score: ok ? 1 : 0, ...(logErr === undefined ? {} : { logErr }) }
  if (ok) return { ...base, feedback: `Correct: ${show(a.truth, a.unit)}.` }
  const diagnosis = diagnose(inst, x / a.truth, rules)
  return {
    ...base,
    feedback: diagnosis ? `Not quite. ${diagnosis.message}` : `Not quite: the answer is ${show(a.truth, a.unit)}.`,
    ...(diagnosis ? { diagnosis } : {}),
  }
}

function gradeEstimate(inst: Instance, a: Extract<AnswerSpec, { kind: 'estimate' }>, resp: Extract<Response, { kind: 'estimate' }>, rules: readonly RatioRule[]): Grade {
  if (typeof resp.value !== 'number' || !Number.isFinite(resp.value)) return ungradable('That was not a number I can grade. Enter digits only.')
  const logErr = logError(resp.value, a.truth)
  // a non-positive or zero estimate has no log error: it can only be wrong (or exactly the truth)
  const ok = logErr === undefined ? resp.value === a.truth : logErr <= Math.log10(a.okWithinFactor) + FACTOR_SLACK
  const score = logErr === undefined ? (ok ? 1 : 0) : estimateScore(logErr, a.okWithinFactor)
  const interval =
    a.interval && resp.lo !== undefined && resp.hi !== undefined && Number.isFinite(resp.lo) && Number.isFinite(resp.hi)
      ? winkler(resp.lo, resp.hi, a.truth)
      : undefined
  const tail = { ...(logErr === undefined ? {} : { logErr }), ...(interval ? { interval } : {}) }
  const near = `within a factor of ${formatNumber(a.okWithinFactor)} of the truth`
  if (ok) return { ok, score, ...tail, feedback: `Close enough: ${near} (${show(a.truth, a.unit)}).` }
  const diagnosis = diagnose(inst, resp.value / a.truth, rules)
  const miss =
    logErr === undefined ? 'Not quite' : `Not quite: off by a factor of ${formatNumber(10 ** logErr, 2)}, and the goal is ${near}`
  return {
    ok,
    score,
    ...tail,
    feedback: diagnosis ? `${miss}. ${diagnosis.message}` : `${miss} (${show(a.truth, a.unit)}).`,
    ...(diagnosis ? { diagnosis } : {}),
  }
}

function gradeChoice(a: Extract<AnswerSpec, { kind: 'choice' }>, resp: Extract<Response, { kind: 'choice' }>): Grade {
  const picks = [...new Set(Array.isArray(resp.picks) ? resp.picks : [])]
  if (picks.length === 0) return ungradable('Pick an answer first.')
  const known = new Set(a.options.map((o) => o.id))
  const right = new Set(a.correct)
  const ok = picks.length === right.size && picks.every((p) => right.has(p))
  const key = a.options.filter((o) => right.has(o.id))
  if (ok) return { ok, score: 1, feedback: `Correct: ${key.map((o) => o.why).join(' ')}` }
  // the first picked option that is wrong (by option order) names the slip
  const wrongPick = a.options.find((o) => picks.includes(o.id) && !right.has(o.id))
  const missed = key.find((o) => !picks.includes(o.id))
  const unknown = picks.some((p) => !known.has(p))
  const verdict = unknown ? 'That is not one of the options.' : wrongPick ? `Not quite: ${wrongPick.why}` : `Not quite: you missed "${missed?.text ?? ''}". ${missed?.why ?? ''}`.trim()
  return {
    ok,
    score: 0,
    feedback: verdict,
    ...(wrongPick?.miss ? { diagnosis: { id: wrongPick.miss, message: wrongPick.why } } : {}),
  }
}

/**
 * Grades one response to one instance (spec §5.2). `rules` are the family's own ratio rules; the
 * shared unit rules follow. A response of the wrong kind, a non-number or a unit the item does not
 * offer is not ok with a one-line prompt to fix it; nothing throws.
 */
export function gradeResponse(inst: Instance, response: Response, rules: readonly RatioRule[] = []): Grade {
  const a = inst.answer
  if (!response || response.kind !== a.kind) return ungradable('That answer does not fit this question.')
  if (a.kind === 'numeric' && response.kind === 'numeric') return gradeNumeric(inst, a, response, rules)
  if (a.kind === 'estimate' && response.kind === 'estimate') return gradeEstimate(inst, a, response, rules)
  if (a.kind === 'choice' && response.kind === 'choice') return gradeChoice(a, response)
  return ungradable('That answer does not fit this question.')
}

/**
 * The response that grades ok with score 1: the truth in the answer's unit (an estimate also gets a
 * 90 % interval one `okWithinFactor` either side), or the correct option ids. verify-generators and
 * the tests use it for self-consistency.
 */
export function correctResponse(inst: Instance): Response {
  const a = inst.answer
  if (a.kind === 'choice') return { kind: 'choice', picks: [...a.correct] }
  if (a.kind === 'numeric') return { kind: 'numeric', value: a.truth, unit: a.unit }
  return { kind: 'estimate', value: a.truth, ...(a.interval ? { lo: a.truth / a.okWithinFactor, hi: a.truth * a.okWithinFactor } : {}) }
}
