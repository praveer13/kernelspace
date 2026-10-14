/**
 * H4 v1, "Prove it, no AI", for lab 01 (docs/specs/wave-1.md §13.3).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions
 * below about their own `allocator.rs`. One question returns 30 days later as a Today item (`followUpRef`).
 * The state machine, the draw and the ledger payload are the same for every lab: they live in
 * src/lib/forge/prove.ts and are re-exported here, with this lab's pool and id as the defaults, so no import
 * path changed. The panel is src/components/forge/ProveIt.tsx.
 */

import { KC } from '@/data/kc/ids'
import type { ProveResult } from '@/lib/ledger/types'
import { buildProveResult as buildProveResultOf, pickQuestions as pickQuestionsOf, PROVE_PICK } from '@/lib/forge/prove'
import type { ProveAttempt } from '@/lib/forge/prove'
import type { ProveQuestion } from '../types'

// The shape lives in ../types (the Forge bundle contract); it is re-exported so lab 01's imports keep working.
export type { ProveQuestion }

export {
  MAX_ANSWER_CHARS,
  MIN_ANSWER_WORDS,
  PROVE_PICK,
  RETRY_AFTER_MS,
  activeIndex,
  answerReady,
  formatWait,
  freshCards,
  lastAttempt,
  proveDone,
  proveScore,
  reduceCards,
  retryOpensAt,
  wordCount,
} from '@/lib/forge/prove'
export type { ProveAction, ProveAttempt, ProveCard } from '@/lib/forge/prove'

export const PROVE_LAB_ID = 'rust-allocator'


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


/** Three questions for an attempt, from this lab's pool unless another is given. */
export const pickQuestions = (
  history: readonly ProveAttempt[],
  seed: number,
  pool: readonly ProveQuestion[] = PROVE_QUESTIONS,
  count: number = PROVE_PICK,
): ProveQuestion[] => pickQuestionsOf(history, seed, pool, count)

/** The `recordProve` argument, or null until every question is graded; lab 01's id unless `opts.labId` says otherwise. */
export function buildProveResult(
  questions: readonly ProveQuestion[],
  cards: Parameters<typeof buildProveResultOf>[1],
  opts: { labId?: string; ms?: number } = {},
): ProveResult | null {
  return buildProveResultOf(questions, cards, { ...opts, labId: opts.labId ?? PROVE_LAB_ID })
}
