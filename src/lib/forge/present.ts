/**
 * What a ForgeLab run looks like on the page (docs/specs/wave-1.md §12.3, §13): the per-check rows,
 * live while the checks run and final after, and the sentence that says what the run earned.
 *
 * Pure: no React, no ledger, no clock. src/pages/ForgeLab.tsx renders it; tests drive it with plain objects.
 */

import type { ForgeLabCheck } from '@/data/labs'
import { ABI_COMPAT } from './abi'
import type { Credit } from './run'
import type { CheckResult, CheckStatus, LabRunReport } from './types'

/** `pending` and `running` exist only while a run is in flight; the rest are the host's verdicts. */
export type RowState = 'pending' | 'running' | CheckStatus

export interface Row {
  id: string
  label: string
  optional: boolean
  stage?: number
  state: RowState
  /** The check's own message; for a trap, "not implemented yet" plus the `todo!()` text. */
  msg?: string
  seed?: number
  fresh?: boolean
  ms?: number
  /** `ks_panic_msg()` after a trap, verbatim. */
  panic?: string
  /** `ks_trace_drain()` after the check. */
  trace?: string
}

/** The checks the page expects, then any the module reported that the page did not list (it says so, never hides them). */
export function buildRows(
  expected: readonly ForgeLabCheck[],
  results: ReadonlyMap<string, CheckResult>,
  running?: string | null,
): Row[] {
  const rows: Row[] = expected.map((c) => rowFor(c.id, c.label, c.optional === true, c.stage, results.get(c.id), running))
  const known = new Set(expected.map((c) => c.id))
  for (const r of results.values()) if (!known.has(r.id)) rows.push(rowFor(r.id, r.label, false, r.stage, r, running))
  return rows
}

function rowFor(
  id: string,
  label: string,
  optional: boolean,
  stage: number | undefined,
  r: CheckResult | undefined,
  running: string | null | undefined,
): Row {
  if (r === undefined) return { id, label, optional, ...(stage === undefined ? {} : { stage }), state: running === id ? 'running' : 'pending' }
  return {
    id,
    label,
    optional,
    ...(r.stage === undefined && stage === undefined ? {} : { stage: r.stage ?? stage }),
    state: r.status,
    msg: r.msg,
    ...(r.seed === undefined ? {} : { seed: r.seed }),
    ...(r.fresh === undefined ? {} : { fresh: r.fresh }),
    ...(r.ms === undefined ? {} : { ms: r.ms }),
    ...(r.panic === undefined ? {} : { panic: r.panic }),
    ...(r.trace === undefined ? {} : { trace: r.trace }),
  }
}

/** Results of a finished report, keyed by check id. */
export const resultsOf = (report: LabRunReport): Map<string, CheckResult> => new Map(report.checks.map((c) => [c.id, c]))

/** A row has something to open: a panic text, a trace, or the seed the check ran on. */
export const hasDetail = (r: Row): boolean => r.panic !== undefined || r.trace !== undefined

/** The spoken form of a row's state ("passed", "failed", ...), for screen readers and the status chip. */
export const STATE_WORD: Record<RowState, string> = {
  pending: 'waiting',
  running: 'running',
  pass: 'passed',
  fail: 'failed',
  trap: 'not implemented or panicked',
  timeout: 'timed out',
}

/** Required rows only. */
export const requiredRows = (rows: readonly Row[]): Row[] => rows.filter((r) => !r.optional)

/* ------------------------------------------------------------------ */
/* What the run earned                                                 */
/* ------------------------------------------------------------------ */

export interface CreditNote {
  /** Short, mono: `unseen`, `lab-green`, `assisted` or `reference module: no credit`. */
  label: string
  /** One or two sentences under it. */
  detail: string
  /** `none` is a reference module: nothing was written. */
  tone: 'full' | 'partial' | 'none'
}

export interface CreditContext {
  /** Required checks the lab has. */
  required: number
  /** Required checks passed on seeds drawn at grade time, in this run or an earlier unseen run. */
  unseenSoFar: number
}

/**
 * The sentence under a result: which provenance the run was written with and why, or that a reference
 * build was shown and nothing was written (§12.3).
 */
export function creditNote(credit: Credit, report: LabRunReport, ctx: CreditContext): CreditNote {
  if (credit === null) {
    return {
      label: 'reference module: no credit',
      detail: 'This build reports itself as a reference build, so the run is shown and nothing is recorded: no XP, no ring, no leaderboard entry. Build your own to be graded.',
      tone: 'none',
    }
  }
  if (credit === 'unseen') {
    return {
      label: 'unseen',
      detail: 'Every required check passed on seeds drawn when you dropped the file, so this run counts in full.',
      tone: 'full',
    }
  }
  if (credit === 'assisted') {
    return {
      label: 'assisted',
      detail: 'This run is inside the 24 hours after a bottom-out hint, so it is recorded as assisted. An unseen-seed pass after that restores full credit.',
      tone: 'partial',
    }
  }
  const compat = ABI_COMPAT[report.abi]
  if (!compat.seeds) {
    return {
      label: 'lab-green',
      detail: `${compat.note}. A v1 build can reach lab-green, not unseen.`,
      tone: 'partial',
    }
  }
  const left = ctx.required - ctx.unseenSoFar
  return {
    label: 'lab-green',
    detail:
      left > 0
        ? `Unseen needs every required check passed on fresh seeds: ${ctx.unseenSoFar} of ${ctx.required} so far. Fix the red ones and drop the file again; each drop draws new seeds.`
        : 'Recorded as lab-green. A run on fresh seeds that passes every required check earns unseen.',
    tone: 'partial',
  }
}

/** Required checks that passed on fresh seeds (or with no seed) in this report, plus those in `earlier`. */
export function unseenCount(report: LabRunReport, required: readonly string[], earlier: Readonly<Record<string, true>> = {}): number {
  const now = new Set(
    report.abi === 2 && report.seeds === 'fresh'
      ? report.checks.filter((c) => c.status === 'pass' && (c.fresh === true || c.seed === undefined)).map((c) => c.id)
      : [],
  )
  return required.filter((id) => now.has(id) || earlier[id] === true).length
}

/** `3/6 required` and, when the lab has them, `1/2 advanced`. Counts passed checks only. */
export function tally(rows: readonly Row[]): { required: number; requiredTotal: number; advanced: number; advancedTotal: number } {
  const req = rows.filter((r) => !r.optional)
  const adv = rows.filter((r) => r.optional)
  return {
    required: req.filter((r) => r.state === 'pass').length,
    requiredTotal: req.length,
    advanced: adv.filter((r) => r.state === 'pass').length,
    advancedTotal: adv.length,
  }
}
