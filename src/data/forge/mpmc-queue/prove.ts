/**
 * H4 v1, "Prove it, no AI", for lab 04 (docs/specs/wave-3.md §8.2).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions below about
 * their own `queue.rs`. One question returns 30 days later as a Today item (`followUpRef`). The state machine, the
 * draw and the ledger payload are the same for every lab and live in src/lib/forge/prove.ts; this module is the lab's
 * pool and id. The panel is src/components/forge/ProveIt.tsx. Every model answer describes the design the file's
 * header lays out (Vyukov's sequence numbers), which is what the six checks pin.
 */

import type { ProveResult } from '@/lib/ledger/types'
import { buildProveResult as buildProveResultOf, pickQuestions as pickQuestionsOf, PROVE_PICK } from '@/lib/forge/prove'
import type { ProveAttempt } from '@/lib/forge/prove'
import type { ProveQuestion } from '../types'

export const PROVE_LAB_ID = 'mpmc-queue'

const MUTEX_ATOMICS = 't2.mutex-atomics'
const ABA = 't2.aba'

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'claim-cas',
    prompt: 'What does the compare-exchange in your `push` claim, and what does your loop do when it fails?',
    model:
      'It claims a position. It tries to move `tail` from the value this thread loaded to that value plus one, and only the thread that succeeds owns the slot at that position. When it fails, another producer moved the tail first and the exchange hands back the tail it found, so the loop goes round again from that value and repeats the sequence-number check. The payload is never written before the exchange has succeeded, because until then the slot may belong to someone else.',
    ideas: [
      'tries to move the tail from the value it loaded to that value plus one',
      'on failure takes the tail it was handed back and goes round the loop again',
      'writes the payload only after the exchange has succeeded',
    ],
    kcs: [MUTEX_ATOMICS],
  },
  {
    id: 'full-or-empty',
    prompt: 'When your head and tail are equal, how does your code tell an empty ring from a full one?',
    model:
      'It does not use the two cursors for that. It reads the sequence number of the slot at the cursor. For a push at position t, a number equal to t means the slot is free, and a number behind t means the slot still holds last lap’s value, so the ring is full. For a pop at position h, a number equal to h + 1 means a value is published, and a number behind that means none is, so the ring is empty. The old ring-buffer ambiguity is settled by the slot, not by counting.',
    ideas: [
      'looks at the sequence number of the slot, not at the two cursors',
      'a push that finds the number behind its position calls the ring full',
      'a pop that finds the number behind its position plus one calls the ring empty',
    ],
    kcs: [MUTEX_ATOMICS, ABA],
  },
  {
    id: 'release-lap',
    prompt: 'After your `pop` has read the payload, what sequence number does it store, and what goes wrong if it stores the position plus one instead?',
    model:
      'It stores the position plus the capacity, which is the position at which the next lap’s push will come to this slot, so that push finds the number it waits for. The position plus one is the number a published value carries, so the slot would look full for the position it was just popped from. The next lap’s push then sees a number behind its own position and reports a full ring that has room. The fifo check misses it, because it never pushes after a pop; backpressure does not.',
    ideas: [
      'stores the position plus the capacity',
      'that is the number the next lap’s push waits for',
      'position plus one leaves the slot looking full, so a push is refused though the ring has room',
    ],
    kcs: [ABA],
  },
  {
    id: 'publish-order',
    prompt: 'In your `push`, why is the payload stored before the sequence number is published, and which orderings do those two stores use?',
    model:
      'A consumer treats the new sequence number as the signal that the payload is there. So the payload goes in first, and the sequence number is stored with Release, which makes the payload visible to any thread that sees the new number. The consumer loads that number with Acquire. With the stores the other way round, or a Relaxed store of the number, a consumer could see the slot as published and still read the old payload. One thread never shows this, so only the native stress test can catch it.',
    ideas: [
      'the sequence number is the signal that the payload is ready, so the payload goes first',
      'the sequence number is stored with Release and loaded with Acquire',
      'otherwise a consumer on another thread reads the old payload, and only the stress test shows it',
    ],
    kcs: [MUTEX_ATOMICS],
  },
  {
    id: 'err-value',
    prompt: 'What does your `push` return when the ring is full, and why does it hand back the caller’s own value instead of dropping it?',
    model:
      'It returns Err with the value it was given and changes nothing in the ring. That is backpressure in the type: the caller still owns the request and can retry it later or shed it on purpose, so the engine never loses one silently. The backpressure check compares the value that comes back with the one pushed, so an Err that returns a different number fails. Nothing blocks, and nothing is dropped.',
    ideas: [
      'returns Err(v) with the same value and leaves the ring untouched',
      'the caller keeps the request, so it can retry or shed on purpose',
      'it never blocks and never drops a value silently',
    ],
    kcs: [MUTEX_ATOMICS],
  },
  {
    id: 'capacity-rounding',
    prompt: 'What does your `new` do with a capacity of 6, and how many pushes does a fresh queue then accept before one replies full?',
    model:
      'This one reads your own code. A ring that finds the slot with a mask, as the file header suggests, needs a power of two, so `new` rounds 6 up to 8 and the queue accepts eight pushes. A version that finds the slot with a remainder can keep 6 and accept six. Either passes the six checks, because they use only powers of two. What matters is that you know which you wrote, and that a mask on a capacity that is not a power of two would reach only some of the slots.',
    ideas: [
      'says which it is: rounded up to a power of two, or kept as asked',
      'gives the matching count, 8 after a round-up and 6 if it is kept',
      'knows a mask needs a power of two, and that the checks never try anything else',
    ],
    kcs: [MUTEX_ATOMICS],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab04.prove.${qid}`

/** Three questions for an attempt, from this lab's pool unless another is given. */
export const pickQuestions = (
  history: readonly ProveAttempt[],
  seed: number,
  pool: readonly ProveQuestion[] = PROVE_QUESTIONS,
  count: number = PROVE_PICK,
): ProveQuestion[] => pickQuestionsOf(history, seed, pool, count)

/** The `recordProve` argument, or null until every question is graded; lab 04's id unless `opts.labId` says otherwise. */
export function buildProveResult(
  questions: readonly ProveQuestion[],
  cards: Parameters<typeof buildProveResultOf>[1],
  opts: { labId?: string; ms?: number } = {},
): ProveResult | null {
  return buildProveResultOf(questions, cards, { ...opts, labId: opts.labId ?? PROVE_LAB_ID })
}
