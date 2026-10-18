/**
 * P4, protégé blocks: the pure side (docs/specs/wave-3.md §16.9; task 3s-11). The block
 * (src/components/blocks/ProtegeBlock.tsx) only draws this and writes the ledger.
 *
 * A block shows 4-6 sentences of "Sam's" explanation with exactly one false, and asks three choice items in order:
 *   1. **find** the false sentence (the options are sentence numbers, so the question never repeats the passage),
 *   2. **tag** the misconception behind it,
 *   3. **fix** it: which sentence repairs it.
 * Each is a `QuizQuestion` with a why per option, in the item pool `protege`, recorded as
 * `item:<lessonId>.protege.<n>.<step>` with src `lesson` and the block's KCs, else the lesson's. n counts the lesson's protégé
 * blocks from 1, the numbering scripts/item-pools.ts gives the pool.
 *
 * Pure: no DOM, no clock, no randomness (the caller passes the attempt seed).
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { ContentBlock, ProtegeBlock } from '@/data/lessons/types'
import type { ItemResult } from '@/lib/items/play'
import type { PlayableItem } from '@/lib/items/types'
import type { ItemResponse } from '@/lib/ledger/types'
import { MAX_KCS } from './iso'

export const PROTEGE_STEPS = ['find', 'tag', 'fix'] as const
export type ProtegeStep = (typeof PROTEGE_STEPS)[number]

/** A passage has 4 to 6 sentences (§16.9). */
export const MIN_SENTENCES = 4
export const MAX_SENTENCES = 6
/** The pool's option cap: scripts/item-cues.ts `MAX_RANK_SUBSET_OPTIONS`, which structureErrors enforces on every choice item. */
export const MAX_OFFER = 4

/** The block's number across its lesson's protégé blocks, from 1; 0 when the lesson does not hold it. */
export function protegeNumber(lesson: { blocks: readonly ContentBlock[] }, block: ProtegeBlock): number {
  let n = 0
  for (const b of lesson.blocks) {
    if (b.type !== 'protege') continue
    n++
    if (b === block) return n
  }
  return 0
}

/** The ledger ref of one step of block number `n`. */
export const stepRef = (lessonId: string, n: number, step: ProtegeStep): `item:${string}` => `item:${lessonId}.protege.${n}.${step}`

/** The KCs every step's event carries: the block's, else the lesson's. */
export const protegeKcs = (block: Pick<ProtegeBlock, 'kcs'>, lessonKcs: readonly string[] = []): string[] => [...(block.kcs ?? lessonKcs)].slice(0, MAX_KCS)

/* ------------------------------ the three questions ------------------------------ */

/** The label of sentence `i` (0-based) in the find question and on the page: "Sentence 3". */
export const sentenceLabel = (i: number): string => `Sentence ${i + 1}`

/**
 * The find question as a choice item: one option per offered sentence number, the false one the key. The options are labels
 * and not the sentences, so every option has the same shape and the passage is read once, where it is shown.
 */
export function findQuestion(block: Pick<ProtegeBlock, 'title' | 'falseAt' | 'find'>): QuizQuestion {
  const key = block.find.offer.indexOf(block.falseAt)
  return {
    q: `In "${block.title}", one sentence is false. Which one?`,
    options: block.find.offer.map(sentenceLabel),
    correct: key < 0 ? [] : [key],
    why: [...block.find.why],
  }
}

/** The question a step asks. */
export function stepQuestion(block: ProtegeBlock, step: ProtegeStep): QuizQuestion {
  return step === 'find' ? findQuestion(block) : block[step]
}

/** The corrected sentence: the fix question's key option. */
export const correction = (block: Pick<ProtegeBlock, 'fix'>): string => block.fix.options[block.fix.correct[0]] ?? ''

/** A step as the shared item player plays it: `item:<lessonId>.protege.<n>.<step>`, under the block's KCs. */
export function stepItem(lessonId: string, n: number, block: ProtegeBlock, step: ProtegeStep, lessonKcs: readonly string[] = []): PlayableItem {
  return { source: 'item', item: { id: `${lessonId}.protege.${n}.${step}`, q: stepQuestion(block, step), kcs: protegeKcs(block, lessonKcs) } }
}

/** The ledger event for one answer to a step (src 'lesson', the authored pick, the block's KCs, the lure's miss id on a miss). */
export function stepResponse(lessonId: string, r: ItemResult): ItemResponse {
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

/* ------------------------------ authoring checks ------------------------------ */

/**
 * What is wrong with a block, as lines for verify-items: the passage length, the false sentence, the find offer and its whys,
 * and the two authored questions having one key each, the fix's key being a different sentence from the false one. The option
 * structure (counts, duplicates, a why per option) is checked per item by the pool gates, not here.
 */
export function protegeErrors(block: ProtegeBlock): string[] {
  const errs: string[] = []
  const { sentences, falseAt, find } = block
  if (!Array.isArray(sentences) || sentences.length < MIN_SENTENCES || sentences.length > MAX_SENTENCES) {
    errs.push(`${Array.isArray(sentences) ? sentences.length : 'no'} sentences; a protégé passage has ${MIN_SENTENCES} to ${MAX_SENTENCES}`)
    return errs
  }
  if (sentences.some((s) => typeof s !== 'string' || !s.trim())) errs.push('a sentence is empty')
  if (new Set(sentences.map((s) => s.trim())).size !== sentences.length) errs.push('two sentences are the same text')
  if (!Number.isInteger(falseAt) || falseAt < 0 || falseAt >= sentences.length) {
    errs.push(`falseAt ${String(falseAt)} is not a sentence index (0 to ${sentences.length - 1})`)
    return errs
  }
  const offer = find?.offer
  if (!Array.isArray(offer) || offer.some((i) => !Number.isInteger(i) || i < 0 || i >= sentences.length) || new Set(offer).size !== offer.length) {
    errs.push('find.offer must be distinct sentence indices')
  } else {
    if (!offer.includes(falseAt)) errs.push('find.offer does not include the false sentence')
    const want = Math.min(MAX_OFFER, sentences.length)
    if (offer.length !== want) errs.push(`find.offer has ${offer.length} sentences; a ${sentences.length}-sentence passage offers ${want}`)
    if (!Array.isArray(find.why) || find.why.length !== offer.length) errs.push(`find.why has ${Array.isArray(find.why) ? find.why.length : 'no'} entries for ${offer.length} offered sentences`)
  }
  for (const step of ['tag', 'fix'] as const) {
    if (block[step]?.correct?.length !== 1) errs.push(`${step} must have exactly one correct option`)
  }
  if (block.fix?.correct?.length === 1 && correction(block).trim() === sentences[falseAt].trim()) errs.push('the fix key is the false sentence itself')
  if (block.fix?.correct?.length === 1 && sentences.some((s, i) => i !== falseAt && s.trim() === correction(block).trim())) errs.push('the fix key repeats one of the true sentences')
  return errs
}
