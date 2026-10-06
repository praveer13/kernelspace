/**
 * H4 v1, "Prove it, no AI", for every lab (docs/specs/wave-1.md §13.3; docs/specs/wave-2.md §13.1).
 *
 * After every required check is green the learner closes their agent and answers 3 of a lab's 6 or more
 * questions about their own code. Each one runs the same way: write at least 12 words, the model answer
 * appears, the learner grades themselves "got it" or "not yet". It is self-graded, so the ledger event
 * carries provenance `practice`: weight at most 0.3, outside rings and VRK30 (V6). A retry waits 24 h and
 * draws questions the learner has not seen.
 *
 * Everything here is pure and holds no lab's questions: the pool is a `ForgeBundle`'s `prove`. The panel is
 * src/components/forge/ProveIt.tsx; lab 01's prove module re-exports these with its own pool as the default.
 */

import type { ProveData, ProveResult } from '@/lib/ledger/types'
import type { ProveQuestion } from '@/data/forge/types'

/** Questions served per attempt. */
export const PROVE_PICK = 3
/** The shortest answer that unlocks the model answer. */
export const MIN_ANSWER_WORDS = 12
export const MAX_ANSWER_CHARS = 1200
/** A retry opens this long after the last attempt, with questions the learner has not seen. */
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

export function wordCount(text: string): number {
  const t = text.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

export const answerReady = (text: string): boolean => wordCount(text) >= MIN_ANSWER_WORDS

/* ------------------------------------------------------------------ */
/* History and the draw                                                */
/* ------------------------------------------------------------------ */

/** One past attempt, as read back from `prove` events. */
export interface ProveAttempt {
  /** ISO instant of the event. */
  at: string
  qids: readonly string[]
  score?: number
}

const ms = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/** The newest attempt, or undefined. */
export function lastAttempt(history: readonly ProveAttempt[]): ProveAttempt | undefined {
  let best: ProveAttempt | undefined
  for (const a of history) if (best === undefined || ms(a.at) > ms(best.at)) best = a
  return best
}

/** Epoch ms when a retry opens, or null when there is nothing to wait for. */
export function retryOpensAt(history: readonly ProveAttempt[], now: number): number | null {
  const last = lastAttempt(history)
  if (last === undefined) return null
  const at = ms(last.at) + RETRY_AFTER_MS
  return at > now ? at : null
}

/** Small seeded generator (mulberry32): the draw is a function of its inputs. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Three questions for an attempt. Questions the learner has never been served come first, then the ones
 * served longest ago, so the second attempt gets exactly the other three. Within a rank the order comes
 * from `seed`. The same history and seed always give the same draw.
 */
export function pickQuestions(
  history: readonly ProveAttempt[],
  seed: number,
  pool: readonly ProveQuestion[],
  count: number = PROVE_PICK,
): ProveQuestion[] {
  const served = new Map<string, { n: number; last: number }>()
  for (const a of history) {
    for (const qid of a.qids) {
      const prev = served.get(qid) ?? { n: 0, last: 0 }
      served.set(qid, { n: prev.n + 1, last: Math.max(prev.last, ms(a.at)) })
    }
  }
  const next = rng(seed)
  return pool
    .map((q) => ({ q, ...(served.get(q.id) ?? { n: 0, last: 0 }), tie: next() }))
    .sort((a, b) => a.n - b.n || a.last - b.last || a.tie - b.tie)
    .slice(0, Math.min(count, pool.length))
    .map((r) => r.q)
}

/* ------------------------------------------------------------------ */
/* One attempt                                                         */
/* ------------------------------------------------------------------ */

export interface ProveCard {
  answer: string
  revealed: boolean
  /** 1 = "got it", 0 = "not yet"; undefined until the learner grades. */
  self?: 0 | 1
}

export type ProveAction =
  | { type: 'write'; index: number; text: string }
  | { type: 'reveal'; index: number }
  | { type: 'grade'; index: number; got: boolean }

export const freshCards = (n: number = PROVE_PICK): ProveCard[] => Array.from({ length: n }, () => ({ answer: '', revealed: false }))

/** The question the learner is on: the first one not yet graded, or -1 when all are. */
export const activeIndex = (cards: readonly ProveCard[]): number => cards.findIndex((c) => c.self === undefined)

export const proveDone = (cards: readonly ProveCard[]): boolean => cards.length > 0 && activeIndex(cards) === -1

/**
 * Pure transition. An action out of order is ignored, so the model answer never appears before a
 * 12-word answer, an answer cannot change once the model answer is out, and a grade cannot come before
 * the reveal or be changed afterwards.
 */
export function reduceCards(cards: readonly ProveCard[], action: ProveAction): ProveCard[] {
  const i = action.index
  const card = cards[i]
  if (card === undefined || i !== activeIndex(cards)) return cards.slice()
  const put = (c: ProveCard) => cards.map((x, j) => (j === i ? c : x))
  switch (action.type) {
    case 'write':
      return card.revealed ? cards.slice() : put({ ...card, answer: action.text.slice(0, MAX_ANSWER_CHARS) })
    case 'reveal':
      return card.revealed || !answerReady(card.answer) ? cards.slice() : put({ ...card, revealed: true })
    case 'grade':
      return card.revealed ? put({ ...card, self: action.got ? 1 : 0 }) : cards.slice()
  }
}

/** Fraction graded "got it". */
export function proveScore(cards: readonly ProveCard[]): number {
  if (cards.length === 0) return 0
  return cards.filter((c) => c.self === 1).length / cards.length
}

/**
 * The `recordProve` argument, or null until every question is graded. `ok` means every question was
 * answered, not that every one was "got it"; the score carries that. The façade fixes the provenance at
 * `practice`.
 */
export function buildProveResult(
  questions: readonly ProveQuestion[],
  cards: readonly ProveCard[],
  opts: { labId: string; ms?: number },
): ProveResult | null {
  if (questions.length !== cards.length || !proveDone(cards)) return null
  const kcs = [...new Set(questions.flatMap((q) => q.kcs))].sort().slice(0, 6)
  const data: ProveData = {
    v: 1,
    qids: questions.map((q) => q.id),
    self: cards.map((c) => c.self ?? 0),
    ...(kcs.length > 0 ? { kcs } : {}),
  }
  return {
    labId: opts.labId,
    score: proveScore(cards),
    ok: true,
    ...(opts.ms === undefined ? {} : { ms: opts.ms }),
    data,
  }
}

/** "23 h 10 min", "45 min": how long until a retry opens. Rounds up so it never says 0. */
export function formatWait(msLeft: number): string {
  const minutes = Math.max(1, Math.ceil(msLeft / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}
