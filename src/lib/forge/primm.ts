/**
 * What PRIMM does for every lab (docs/specs/wave-1.md §13.1; docs/specs/wave-2.md §13.1): the Make step's stage rows
 * against what a run passed, how a choice or a number is graded, and what each answer is worth to the ledger.
 * Pure: no DOM, no clock, no storage, and no lab's items; those come from a `ForgeBundle`. Lab 01's primm module
 * re-exports these (binding its own stages where the signature takes them), so no import path changed.
 */

import type { ForgeLabCheck } from '@/data/labs'
import type { ChoicePrimm, NumberPrimm, PrimmItem, RunConfig, RunResult, StageInfo } from '@/data/forge/types'
import type { ItemResponse } from '@/lib/ledger/types'
import { rev32 } from '@/lib/ledger/stable'

/** Every PRIMM item's ledger ref is `item:` plus its id. */
export const primmRef = (id: string) => `item:${id}` as const

export interface StageRow {
  stage: StageInfo
  checks: { id: string; label: string; passed: boolean }[]
  /** Every check of the stage passed. */
  green: boolean
}

const required = (checks: readonly ForgeLabCheck[]) => checks.filter((c) => c.optional !== true)

/** The stages with their checks (labs.ts `stage`) and which of them passed. A stage with no checks is never green. */
export function stageRows(stages: readonly StageInfo[], checks: readonly ForgeLabCheck[], passed: ReadonlySet<string>): StageRow[] {
  return stages.map((stage) => {
    const mine = required(checks)
      .filter((c) => c.stage === stage.n)
      .map((c) => ({ id: c.id, label: c.label, passed: passed.has(c.id) }))
    return { stage, checks: mine, green: mine.length > 0 && mine.every((c) => c.passed) }
  })
}

/** The first stage that is not green yet (what to build next), or null when all four are. */
export function currentStage(rows: readonly StageRow[]): StageInfo | null {
  return rows.find((r) => !r.green)?.stage ?? null
}

/** The highest stage k with stages 1..k all green (0 when stage 1 is not): the `stage` of a `lab-check` event. */
export function greenStage(rows: readonly StageRow[]): number {
  let k = 0
  for (const r of rows) {
    if (!r.green) break
    k = r.stage.n
  }
  return k
}

/**
 * Attempts-to-green per stage (spec §13.1, descriptive only): `runs` are the passed check ids of each lab run,
 * oldest first. A stage is green on the first run where all its checks pass. Its count is the number of runs from
 * the run after the previous stage went green, up to and including its own; 0 when it came green on the same run
 * as the stage before. Null while a stage has never been green.
 */
export function attemptsToGreen(stages: readonly StageInfo[], runs: readonly (readonly string[])[], checks: readonly ForgeLabCheck[]): (number | null)[] {
  const out: (number | null)[] = []
  let previous = 0
  for (const stage of stages) {
    const ids = required(checks)
      .filter((c) => c.stage === stage.n)
      .map((c) => c.id)
    const at = ids.length === 0 ? -1 : runs.findIndex((r) => ids.every((id) => r.includes(id)))
    if (at < 0) {
      out.push(null)
      continue
    }
    const run = at + 1
    out.push(Math.max(0, run - previous))
    previous = Math.max(previous, run)
  }
  return out
}

/** Whether the Predict step still takes graded answers: not after the run was shown first (the "show me anyway" peek). */
export const predictGraded = (peeked: boolean, alreadyAnswered: boolean) => alreadyAnswered || !peeked

/* ------------------------------------------------------------------ */
/* Grading and the ledger                                               */
/* ------------------------------------------------------------------ */

export interface PrimmGrade {
  ok: boolean
  /** In [0, 1]. */
  score: number
  /** One or two sentences: the verdict, then the key step. */
  feedback: string
  /** Misconception id of a recognised wrong answer. */
  miss?: string
}

/** Grades a pick (authored index). The feedback is the option's own `why`, then the key's. */
export function gradeChoice(item: ChoicePrimm, pick: number): PrimmGrade {
  const { q } = item.item
  const ok = q.correct.length === 1 && q.correct[0] === pick
  const own = q.why?.[pick] ?? ''
  const key = q.why?.[q.correct[0]] ?? ''
  return { ok, score: ok ? 1 : 0, feedback: ok ? own : `${own} ${key}`.trim() }
}

const closeEnough = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

/**
 * Grades a number. `numeric`: exact, with a named mistake when the answer is a known lure. `estimate`: right within
 * the item's factor of `truth`; the score falls off with the log error, as the generators' estimates do (spec §5.2).
 */
export function gradeNumber(item: NumberPrimm, value: number, truth: number): PrimmGrade {
  if (item.kind === 'numeric') {
    const ok = closeEnough(value, truth)
    const lure = item.lures?.find((l) => closeEnough(l.value, value))
    return {
      ok,
      score: ok ? 1 : 0,
      feedback: ok ? `Yes, ${truth} ${item.unit}. ${item.explain}` : `${lure?.message ?? `Not ${value}.`} ${item.explain}`.trim(),
      ...(lure ? { miss: lure.miss } : {}),
    }
  }
  const factor = item.factor ?? 2
  const ratio = value <= 0 || truth <= 0 ? Infinity : Math.max(value / truth, truth / value)
  const ok = ratio <= factor
  const score = ratio === Infinity ? 0 : Math.max(0, 1 - Math.log10(ratio) / Math.log10(factor * 5))
  const verdict = ok
    ? `Close enough: ${truth} ${item.unit}, and you said ${value}.`
    : `The run says ${truth} ${item.unit}; you said ${value}, ${ratio === Infinity ? 'which cannot be right' : `a factor of ${Math.round(ratio * 10) / 10} ${value > truth ? 'too high' : 'too low'}`}.`
  return { ok, score, feedback: `${verdict} ${item.explain}` }
}

/** What a response to a PRIMM item is worth to the ledger: one `item` event, `src: practice`, tagged with its KCs. */
export interface PrimmAnswer {
  item: PrimmItem
  grade: PrimmGrade
  /** Choice items: the picked authored index. */
  pick?: number
  /** Number items: the learner's answer and the truth it was graded against. */
  value?: number
  truth?: number
  ms?: number
}

/** Short content fingerprint: an edit to a prompt or an option changes it, so old events never claim the new text. */
export function itemRev(item: PrimmItem): string {
  return item.kind === 'choice'
    ? rev32({ id: item.id, q: item.item.q.q, options: item.item.q.options, correct: item.item.q.correct })
    : rev32({ id: item.id, prompt: item.prompt, unit: item.unit, truth: item.truth ?? null })
}

export function itemResponse(a: PrimmAnswer): ItemResponse {
  const kcs = a.item.kind === 'choice' ? a.item.item.kcs : a.item.kcs
  return {
    kind: 'item',
    ref: primmRef(a.item.id),
    rev: itemRev(a.item),
    score: a.grade.score,
    ok: a.grade.ok,
    provenance: 'practice',
    ...(a.ms !== undefined ? { ms: a.ms } : {}),
    data: {
      src: 'practice',
      kcs: [...kcs],
      nsec: a.item.nsec,
      ...(a.pick !== undefined ? { pick: [a.pick] } : {}),
      ...(a.value !== undefined ? { value: a.value } : {}),
      ...(a.truth !== undefined ? { truth: a.truth } : {}),
      ...(a.grade.miss !== undefined ? { miss: a.grade.miss } : {}),
    },
  }
}

/** The Run step's evidence: what the reference run observed. An observation, not a graded answer: no KCs. */
export function observationResponse(item: { id: string; nsec: number }, run: Pick<RunResult, 'config' | 'value' | 'truth'>, ms?: number): ItemResponse {
  return {
    kind: 'item',
    ref: primmRef(item.id),
    rev: rev32({ id: item.id, config: run.config }),
    score: 1,
    ok: true,
    provenance: 'practice',
    ...(ms !== undefined ? { ms } : {}),
    data: { src: 'practice', kcs: [], nsec: item.nsec, value: run.value, truth: run.truth },
  }
}

/** Two run configs are the same run: equal keys and values. */
export function sameConfig(a: RunConfig, b: RunConfig): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}
