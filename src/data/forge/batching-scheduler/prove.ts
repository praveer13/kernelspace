/**
 * H4 v1, "Prove it, no AI", for lab 06 (docs/specs/wave-3.md §8.2).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions below about
 * their own `scheduler.rs`. One question returns 30 days later as a Today item (`followUpRef`). The state machine, the
 * draw and the ledger payload are the same for every lab and live in src/lib/forge/prove.ts; this module is the lab's
 * pool and id. The panel is src/components/forge/ProveIt.tsx. Prove-it v2 (prove2.ts) asks what the module replies.
 */

import { KC } from '@/data/kc/ids'
import type { ProveResult } from '@/lib/ledger/types'
import { buildProveResult as buildProveResultOf, pickQuestions as pickQuestionsOf, PROVE_PICK } from '@/lib/forge/prove'
import type { ProveAttempt } from '@/lib/forge/prove'
import type { ProveQuestion } from '../types'

export const PROVE_LAB_ID = 'batching-scheduler'

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'walk-order',
    prompt: 'In what order does your `schedule` walk the waiting requests, and what breaks a tie between two with the same prompt?',
    model:
      'It puts requests older than the age limit first, oldest first, then sorts the rest by prompt length, smallest first, and breaks a tie by arrival so the earlier request goes first. The admit loop then walks that order. Walking in arrival order instead would send the 8,192-token whale first in the convoy check, and the shorts behind it would miss their first-token bound.',
    ideas: [
      'names the sort key: prompt length, smallest first, after the old requests',
      'breaks a tie by arrival, so equal prompts are served first come first served',
      'says what the order is for: the whale must not hold up the shorts',
    ],
    kcs: [KC.schedOrder],
  },
  {
    id: 'headroom',
    prompt: 'How much memory does your `schedule` keep back for decode growth, and what happens if the pool fills anyway?',
    model:
      'It counts each running request as its prompt plus the tokens it has decoded, and adds a margin of about 48 tokens per running sequence before it admits another. Decode adds one token to every running sequence every iteration, so a pool that is full at admission runs out of room mid-flight. The engine then evicts the newest sequence and discards its progress, and the work is done twice.',
    ideas: [
      'counts resident memory as prompt plus decoded tokens for every running request',
      'keeps a margin per running sequence, about 48 tokens, before admitting',
      'says a full pool makes the engine evict the newest sequence and throw its work away',
    ],
    kcs: [KC.admissionHeadroom],
  },
  {
    id: 'skip-or-stop',
    prompt: 'The next request in your order does not fit right now. What does your admit loop do, and why?',
    model:
      'It skips that request and keeps walking, admitting each later one that fits, and it stops only when the slots are full. Stopping would leave memory and slots idle while smaller requests could run. The skipped request stays at its place in the order, so it is tried first on the next call, and it gets in as soon as enough room opens.',
    ideas: [
      'skips the request that does not fit and keeps walking the list',
      'stops only when no slot is free',
      'says stopping would idle free room, and the skipped request is tried first next call',
    ],
    kcs: [KC.continuousBatching],
  },
  {
    id: 'aging',
    prompt: 'How does your `schedule` keep a long request from waiting forever under a stream of short ones?',
    model:
      'It reads each waiting request’s age, the current iteration minus its arrival, and past a limit of roughly 900 to 1,600 iterations the request goes to the front, oldest first. Everyone younger stays in smallest-first order. Without the limit a short request always sorts ahead of a long one, and the three long requests in the starvation check never run.',
    ideas: [
      'computes a waiting request’s age as the iteration minus its arrival',
      'moves a request older than a limit to the front, oldest first',
      'says why: smallest-first alone never reaches a long request while shorts keep arriving',
    ],
    kcs: [KC.schedOrder],
  },
  {
    id: 'legal',
    prompt: 'What does your `schedule` check before it puts an id in the admit list, so that it never returns an illegal action?',
    model:
      'It admits only ids from the waiting list, counts the slots left as the maximum minus the running requests, and adds each admitted prompt to the resident tokens, so the total stays under the cap. An id that is not waiting, a count above the maximum, or an action that pushes resident memory over the cap fails the whole scenario at once. Preempts count the other way: a preempted request frees its tokens and its slot.',
    ideas: [
      'admits only ids that are in the waiting list',
      'keeps the running count at or under the maximum, counting what it admits',
      'keeps resident tokens, with each admitted prompt added, at or under the cap',
    ],
    kcs: [KC.continuousBatching, KC.admissionHeadroom],
  },
  {
    id: 'preempt',
    prompt: 'Does your `schedule` ever preempt? When would it, and what does a preempt cost?',
    model:
      'Mine returns an empty preempt list, because the lab’s traces never need one. A preempt would be for a pool under pressure, and it should take the newest running request, since that has the least work to lose. It still costs everything that request has done: its prefill and its decoded tokens are discarded and it goes back to the waiting list to be recomputed. Headroom is the cheaper way to avoid the pressure.',
    ideas: [
      'says plainly whether the preempt list is ever non-empty, and when',
      'picks the newest request as the victim because it has the least work to lose',
      'says a preempt discards the victim’s progress, so headroom is the cheaper fix',
    ],
    kcs: [KC.continuousBatching, KC.schedOrder],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab06.prove.${qid}`

/** Three questions for an attempt, from this lab's pool unless another is given. */
export const pickQuestions = (
  history: readonly ProveAttempt[],
  seed: number,
  pool: readonly ProveQuestion[] = PROVE_QUESTIONS,
  count: number = PROVE_PICK,
): ProveQuestion[] => pickQuestionsOf(history, seed, pool, count)

/** The `recordProve` argument, or null until every question is graded; lab 06's id unless `opts.labId` says otherwise. */
export function buildProveResult(
  questions: readonly ProveQuestion[],
  cards: Parameters<typeof buildProveResultOf>[1],
  opts: { labId?: string; ms?: number } = {},
): ProveResult | null {
  return buildProveResultOf(questions, cards, { ...opts, labId: opts.labId ?? PROVE_LAB_ID })
}
