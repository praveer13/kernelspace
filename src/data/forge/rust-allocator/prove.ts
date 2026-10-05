/**
 * H4 v1, "Prove it, no AI", for lab 01 (docs/specs/wave-1.md §13.3).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions
 * below about their own `allocator.rs`. Each one runs the same way: write at least 12 words, the model
 * answer appears, the learner grades themselves "got it" or "not yet". It is self-graded, so the ledger
 * event carries provenance `practice`: weight at most 0.3, outside rings and VRK30 (V6). One question
 * returns 30 days later as a Today item (`followUpRef`); a retry waits 24 h and draws questions the
 * learner has not seen.
 *
 * Everything here is pure: the pool, the draw, the per-question reducer and the ledger payload. The panel
 * is src/components/forge/ProveIt.tsx.
 */

import { KC } from '@/data/kc/ids'
import type { ProveData, ProveResult } from '@/lib/ledger/types'

export const PROVE_LAB_ID = 'rust-allocator'
/** Questions served per attempt. */
export const PROVE_PICK = 3
/** The shortest answer that unlocks the model answer. */
export const MIN_ANSWER_WORDS = 12
export const MAX_ANSWER_CHARS = 1200
/** A retry opens this long after the last attempt, with questions the learner has not seen. */
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

export interface ProveQuestion {
  /** Short id: what `ProveData.qids` records. The Today follow-up ref is `followUpRef(id)`. */
  id: string
  /** Markdown-lite: backticks mark code. */
  prompt: string
  /** What a good answer says. Shown after the learner has written their own. */
  model: string
  /** Three points to check the learner's answer against. */
  ideas: readonly [string, string, string]
  kcs: readonly string[]
}

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'free-both',
    prompt: 'What does your `free` do when the span touches a free neighbour on both sides?',
    model:
      'It merges all three into one run. It finds where the freed offset belongs in the address-ordered list, sees that the previous run ends exactly at the freed offset and the next run starts exactly where the freed span ends, and replaces the three by one run that starts at the left offset and has the summed size. Merging only one side leaves a hole that no later large request can use.',
    ideas: [
      'finds the neighbours by address, in the sorted list',
      'checks both adjacencies: left end == offset and offset + size == right start',
      'ends with one entry, not three',
    ],
    kcs: [KC.splitCoalesce],
  },
  {
    id: 'align-overflow',
    prompt: 'Can your `align_up` overflow here, and why not?',
    model:
      'Not in this lab. The heap is 1 MiB, so every offset is below 2^20 and the alignment is at most 256. Adding align - 1 to an offset stays far below the largest usize, even on 32-bit wasm. It would overflow only for an offset within align - 1 of usize::MAX, which a 1 MiB heap never reaches. A checked_add, or a bound check on the capacity, makes that explicit.',
    ideas: [
      'names the real bounds: a 1 MiB heap and an alignment of at most 256',
      'compares them with the largest value a usize holds',
      'says what would break it: a huge capacity, or an offset near usize::MAX',
    ],
    kcs: [KC.alignment],
  },
  {
    id: 'too-big',
    prompt: 'What does your allocator do when a request is larger than every free run?',
    model:
      'It returns None and changes nothing. The scan compares the request, plus any padding needed to reach the alignment, with each run; when none fits it falls out of the loop before splitting anything or touching the free list. It does not stitch together runs that are not adjacent, because an allocation must be one contiguous span.',
    ideas: [
      'returns None',
      'leaves the free list exactly as it was: no half-done split',
      'counts the alignment padding when it asks whether a run fits',
    ],
    kcs: [KC.allocatorContract, KC.placementPolicy],
  },
  {
    id: 'align-split',
    prompt:
      'When `alloc` has to skip bytes at the front of a free run to reach the alignment, where do those bytes go, and what about the bytes after the allocation?',
    model:
      'Both leftovers stay free. The bytes before the aligned start become a smaller free run that keeps the old offset, and the bytes after the allocation become another run that starts at offset + size. Both go back into the list in address order. A leftover of zero bytes is never inserted. If either were dropped, that memory would be lost for good.',
    ideas: [
      'the front padding stays on the free list at the old offset',
      'the tail after offset + size stays on the free list too',
      'inserts nothing for a zero-length leftover',
    ],
    kcs: [KC.splitCoalesce, KC.alignment],
  },
  {
    id: 'no-merge-fails',
    prompt: 'If `free` stopped merging neighbours, which check goes red first, and which ones stay green?',
    model:
      'coalesce goes red first, then fragmentation. boot, align, no_overlap and reuse stay green: none of them needs a run larger than one block that was freed. The coalesce check fills the untouched tail first, so only a merged run can serve its big request. fragmentation fails the same way once churn has split the heap into pieces too small for the large requests.',
    ideas: [
      'names coalesce first, and fragmentation as the other failure',
      'says why the others pass: they never ask for a run bigger than one freed block',
      'explains the tail: the harness uses it up, so only merging can serve the big request',
    ],
    kcs: [KC.splitCoalesce, KC.externalFrag],
  },
  {
    id: 'zero-size',
    prompt: 'What does your `alloc(0, 1)` do, and how do two zero-byte allocations avoid sharing an offset?',
    model:
      'It treats the request as one byte, so each call takes a real span off the free list and the next call starts after it. The offsets differ because the spans do. `free(offset, 0)` has to give back that same one byte, so it applies the same rounding. Returning the same offset twice would hand two owners one address.',
    ideas: [
      'rounds the size up to at least 1',
      'takes a real span from the free list, so the next request starts later',
      'applies the same rounding in `free`, so the byte is returned',
    ],
    kcs: [KC.allocatorContract],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab01.prove.${qid}`

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
  pool: readonly ProveQuestion[] = PROVE_QUESTIONS,
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
  opts: { labId?: string; ms?: number } = {},
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
    labId: opts.labId ?? PROVE_LAB_ID,
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
