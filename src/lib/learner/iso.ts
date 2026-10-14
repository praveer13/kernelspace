/**
 * P3, active isomorphisms: the pure side (docs/specs/wave-3.md §11.1; task 3b-07). The panel
 * (src/components/lesson/Isomorphism.tsx) only draws this and writes the ledger.
 *
 * - **Align.** One row per pair's `os`; the pairs' `llm` labels, shuffled per attempt, are the choices. A row is
 *   right when its label is its own pair's. `item:<lesson>.iso.<n>` scores the base rows: right ÷ base rows, ok
 *   when every base row is right. n counts the lesson's isomorphism blocks from 1, those without a break item
 *   too (the numbering scripts/item-pools.ts gives `item:<lesson>.iso.<n>.break`).
 * - **A work row** (§11.3) joins the align step when `profile:background` is one of its pair's backgrounds. It gets
 *   its feedback and is never graded, never counted and never recorded, so the event is the same bytes whatever
 *   the background: a donation keeps the score and must not reveal it.
 * - **Name the break** is an authored choice item (`breakItem`, pool `iso`), recorded as
 *   `item:<lesson>.iso.<n>.break`. Both events carry src `lesson` and the block's KCs, else the lesson's.
 *
 * Pure: no DOM, no clock, no randomness (the caller passes the attempt seed).
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { ContentBlock, IsomorphismBlock, IsomorphismPair } from '@/data/lessons/types'
import { BACKGROUNDS } from '@/lib/ledger/constants'
import { rev32 } from '@/lib/ledger/stable'
import type { Background, ItemResponse } from '@/lib/ledger/types'
import type { ItemResult } from '@/lib/items/play'
import type { PlayableItem } from '@/lib/items/types'
import { shuffledOrder } from '@/lib/rng'

/** The codec refuses an item with more KCs than this (wave-1.md §3.2), and a refused event is lost at the flush. */
export const MAX_KCS = 6
/** Nominal seconds per graded row, for session sizing (spec §8.4 reads `nsec ?? 30`); it never reads the work row. */
export const NSEC_PER_ROW = 15

/** A block runs the active version only when it asks the break question (wave-3.md §11.1). */
export const isActive = (block: IsomorphismBlock): block is IsomorphismBlock & { breakItem: QuizQuestion } => block.breakItem !== undefined

/** `profile:background` as the working record holds it: one of the six values, else none. */
export const backgroundOf = (value: unknown): Background | null =>
  typeof value === 'string' && (BACKGROUNDS as readonly string[]).includes(value) ? (value as Background) : null

/** The block's number across its lesson's isomorphism blocks, from 1; 0 when the lesson does not hold it. */
export function isoNumber(lesson: { blocks: readonly ContentBlock[] }, block: IsomorphismBlock): number {
  let n = 0
  for (const b of lesson.blocks) {
    if (b.type !== 'isomorphism') continue
    n++
    if (b === block) return n
  }
  return 0
}

/** The ledger refs of block number `n`. */
export const alignRef = (lessonId: string, n: number): `item:${string}` => `item:${lessonId}.iso.${n}`
export const breakRef = (lessonId: string, n: number): `item:${string}` => `item:${lessonId}.iso.${n}.break`

/** The KCs both events carry: the block's, else the lesson's. */
export const isoKcs = (block: Pick<IsomorphismBlock, 'kcs'>, lessonKcs: readonly string[] = []): string[] => [...(block.kcs ?? lessonKcs)].slice(0, MAX_KCS)

/* ------------------------------ the rows ------------------------------ */

/** One row of the align step. */
export interface IsoRow {
  /** Stable within the block: `p<pair>` for a base row, `w<pair>` for the work row of that pair. */
  id: string
  /** Index of the pair whose `llm` label is this row's right answer. */
  pair: number
  /** True for a work row: feedback, never graded. */
  work: boolean
  os: string
  osLine: string
  /** The right label, the pair's own `llm`. */
  llm: string
  llmLine: string
  /** The break shown with this row's pair (a work row's is the work pair's own). */
  breaks?: string
}

/** True when the pair's work analogue is for this background. */
export const workApplies = (pair: IsomorphismPair, background: Background | null): boolean => background !== null && !!pair.work && pair.work.backgrounds.includes(background)

/**
 * The block's rows in pair order: a base row per pair, and a work row right after its pair when the background
 * matches. A work row's right label is the pair's `llm` (§11.3).
 */
export function alignRows(block: Pick<IsomorphismBlock, 'pairs'>, background: Background | null): IsoRow[] {
  return block.pairs.flatMap((p, i) => {
    const base: IsoRow = { id: `p${i}`, pair: i, work: false, os: p.os, osLine: p.osLine, llm: p.llm, llmLine: p.llmLine, ...(p.breaks ? { breaks: p.breaks } : {}) }
    if (!workApplies(p, background) || !p.work) return [base]
    const work: IsoRow = { id: `w${i}`, pair: i, work: true, os: p.work.os, osLine: p.work.osLine, llm: p.llm, llmLine: p.llmLine, breaks: p.work.breaks }
    return [base, work]
  })
}

/** The distinct `llm` labels in authored order: the choices, and the index a recorded pick names. */
export const labelsOf = (block: Pick<IsomorphismBlock, 'pairs'>): string[] => [...new Set(block.pairs.map((p) => p.llm))]

/**
 * The labels in this attempt's order. A retry re-shuffles (`seed`); with two or more labels the order is never the
 * authored one, because that is the answer key read down the page.
 */
export function shuffledLabels(block: Pick<IsomorphismBlock, 'pairs'>, seed: number): string[] {
  const labels = labelsOf(block)
  if (labels.length < 2) return labels
  for (let k = 0; k < 8; k++) {
    const order = shuffledOrder(labels.length, (seed + k) >>> 0)
    if (order.some((o, i) => o !== i)) return order.map((o) => labels[o])
  }
  return [...labels.slice(1), labels[0]]
}

/* ------------------------------ grading ------------------------------ */

export interface RowVerdict {
  id: string
  /** The label picked, or null for a row not yet given one. */
  picked: string | null
  right: boolean
  /** False for a work row. */
  graded: boolean
}

export interface AlignGrade {
  rows: RowVerdict[]
  /** Base rows right, and base rows. */
  right: number
  base: number
  /** right ÷ base: the work row is not in it. */
  score: number
  ok: boolean
  /** Every row, work rows included, has a label. */
  complete: boolean
}

/** The align step graded: `picks` maps a row id to the label picked. Only base rows count (§11.1). */
export function gradeAlign(rows: readonly IsoRow[], picks: Readonly<Record<string, string>>): AlignGrade {
  const verdicts: RowVerdict[] = rows.map((r) => {
    const picked = Object.hasOwn(picks, r.id) ? picks[r.id] : null
    return { id: r.id, picked, right: picked === r.llm, graded: !r.work }
  })
  const graded = verdicts.filter((v) => v.graded)
  const right = graded.filter((v) => v.right).length
  const base = graded.length
  return { rows: verdicts, right, base, score: base === 0 ? 0 : right / base, ok: base > 0 && right === base, complete: verdicts.every((v) => v.picked !== null) }
}

/* ------------------------------ the ledger ------------------------------ */

/** The item fingerprint of the align step: the base pairs only, so the work row never reaches the event. */
export const alignRev = (block: Pick<IsomorphismBlock, 'pairs'>): string => rev32({ pairs: block.pairs.map((p) => [p.os, p.llm]) })

/**
 * `item:<lessonId>.iso.<n>`: score right ÷ base rows, ok when all are right, `pick` the authored index of the label
 * given to each base row. The work row is in none of it, so two learners with the same base picks write the same
 * event whatever their background.
 */
export function alignResponse(
  lessonId: string,
  n: number,
  block: Pick<IsomorphismBlock, 'pairs' | 'kcs'>,
  lessonKcs: readonly string[] | undefined,
  grade: AlignGrade,
  meta: { seed: number; ms: number },
): ItemResponse {
  const labels = labelsOf(block)
  const base = grade.rows.filter((v) => v.graded)
  return {
    kind: 'item',
    ref: alignRef(lessonId, n) as ItemResponse['ref'],
    rev: alignRev(block),
    score: grade.score,
    ok: grade.ok,
    seed: meta.seed >>> 0,
    ms: Math.max(0, Math.round(meta.ms)),
    data: {
      src: 'lesson',
      pick: base.map((v) => (v.picked === null ? -1 : labels.indexOf(v.picked))),
      lessonId,
      kcs: isoKcs(block, lessonKcs),
      nsec: NSEC_PER_ROW * base.length,
    },
  }
}

/** The break item as the shared player plays it: `item:<lessonId>.iso.<n>.break`, under the block's KCs. */
export function breakItem(lessonId: string, n: number, block: Pick<IsomorphismBlock, 'kcs'>, q: QuizQuestion, lessonKcs: readonly string[] = []): PlayableItem {
  return { source: 'item', item: { id: `${lessonId}.iso.${n}.break`, q, kcs: isoKcs(block, lessonKcs) } }
}

/** The ledger event for one answer to the break item (src 'lesson', the authored pick, the item's KCs). */
export function breakResponse(lessonId: string, r: ItemResult): ItemResponse {
  return {
    kind: 'item',
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    data: {
      src: 'lesson',
      pick: r.pick ?? [],
      lessonId,
      kcs: r.kcs.slice(0, MAX_KCS),
      nsec: r.nsec,
      ...(r.grade.diagnosis ? { miss: r.grade.diagnosis.id } : {}),
    },
  }
}
