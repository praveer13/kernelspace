/**
 * H4 v1, "Prove it, no AI", for lab 02 (docs/specs/wave-2.md §13.2).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions below about
 * their own `manager.rs`. One question returns 30 days later as a Today item (`followUpRef`). The state machine, the
 * draw and the ledger payload are the same for every lab and live in src/lib/forge/prove.ts; this module is the lab's
 * pool and id. The panel is src/components/forge/ProveIt.tsx.
 */

import { KC } from '@/data/kc/ids'
import type { ProveResult } from '@/lib/ledger/types'
import { buildProveResult as buildProveResultOf, pickQuestions as pickQuestionsOf, PROVE_PICK } from '@/lib/forge/prove'
import type { ProveAttempt } from '@/lib/forge/prove'
import type { ProveQuestion } from '../types'

export const PROVE_LAB_ID = 'kv-block-manager'

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'free-shared',
    prompt: 'What does your `free` do to a block another sequence still shares?',
    model:
      'It lowers that block’s refcount by one and leaves the block where it is. Only a block whose count reaches zero goes back to the pool, so the other sequence keeps reading every token. Returning the block on the first owner’s free would let the pool hand it out again while a table still lists it, and the conservation count would come out above the pool size.',
    ideas: [
      'lowers the refcount by one instead of returning the block',
      'returns a block to the pool only when its count reaches zero',
      'says what goes wrong otherwise: another sequence reads a block the pool can reuse',
    ],
    kcs: [KC.blockRefcounts],
  },
  {
    id: 'fork-cost',
    prompt: 'What does your `fork` take from the pool, and what does it change for each block of the table?',
    model:
      'It takes nothing from the pool. It copies the source’s block table and length to the new sequence and adds one to the refcount of every block in that table, so both tables now list the same physical blocks. The pool count is the same before and after, which is the whole point: a fork is a table copy, not a memory copy. It returns false if the source is missing or the new id already exists.',
    ideas: [
      'takes no blocks from the pool: the free count does not move',
      'copies the table and length, and adds one to each block’s refcount',
      'refuses when the source is missing or the destination already exists',
    ],
    kcs: [KC.blockRefcounts, KC.blockTables],
  },
  {
    id: 'cow-trigger',
    prompt: 'When exactly does your `append` copy a block, and what happens to the old block?',
    model:
      'Only when the last block is partly filled and its refcount is above one. Then the append takes a fresh block, puts it in this sequence’s table in place of the shared tail, and lowers the old block’s refcount by one; the other sequence’s table does not change. A shared tail that is full needs no copy, because the new tokens go into a new block anyway. One shared partial tail costs exactly one extra block.',
    ideas: [
      'names both conditions: the tail is partial and its refcount is above one',
      'swaps the tail in this table only, and lowers the old block’s count by one',
      'says a full shared tail needs no copy, and the parent’s table never changes',
    ],
    kcs: [KC.kvCopyOnWrite],
  },
  {
    id: 'refuse-clean',
    prompt: 'What state does your `allocate` leave behind when the pool cannot cover the request?',
    model:
      'The same state it found. It works out the number of blocks first, as the ceiling of the tokens over the block size, and compares it with the pool before it takes anything. If the pool is short it returns false with the free list, the refcounts and the tables untouched. Taking blocks and then giving up would leave a half-built sequence and a pool count that no longer adds up.',
    ideas: [
      'computes the blocks needed before taking any',
      'returns false with the pool, refcounts and tables exactly as they were',
      'says what a half-done allocate would break: a leak that the gauntlet’s count catches',
    ],
    kcs: [KC.blockTables, KC.blockRefcounts],
  },
  {
    id: 'translate-bound',
    prompt: 'What does your `translate` return for token 20 of a 20-token sequence, and how does it know?',
    model:
      'It returns None. With 16 tokens a block the sequence has two blocks, so token 20 would index a table entry that exists, but it is at the sequence’s length and nothing was written there. So translate compares the token with the stored length, not with the table size, before it looks up the table at token over block size. An unknown sequence also gives None.',
    ideas: [
      'returns None for a token at or past the length',
      'compares against the stored token length, not the number of table entries',
      'looks up the entry at token divided by block size, and gives None for an unknown sequence',
    ],
    kcs: [KC.blockTables],
  },
  {
    id: 'conservation',
    prompt: 'What does the gauntlet recount after every op, and what does a total above or below the pool size tell you?',
    model:
      'It adds the free blocks to the distinct blocks that live sequences use, and that has to equal the pool size. A total above it means a block is counted twice: it is in the pool and in a table, which is a double free or a free that ignored sharing. A total below it means a block is nowhere, a leak: a refcount that never reaches zero, or an operation that took blocks and then failed.',
    ideas: [
      'free blocks plus distinct referenced blocks equals the pool size',
      'a total above the pool means a double free: a block in both the pool and a table',
      'a total below the pool means a leak: a block nobody holds and the pool does not have',
    ],
    kcs: [KC.blockRefcounts, KC.kvCopyOnWrite],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab02.prove.${qid}`

/** Three questions for an attempt, from this lab's pool unless another is given. */
export const pickQuestions = (
  history: readonly ProveAttempt[],
  seed: number,
  pool: readonly ProveQuestion[] = PROVE_QUESTIONS,
  count: number = PROVE_PICK,
): ProveQuestion[] => pickQuestionsOf(history, seed, pool, count)

/** The `recordProve` argument, or null until every question is graded; lab 02's id unless `opts.labId` says otherwise. */
export function buildProveResult(
  questions: readonly ProveQuestion[],
  cards: Parameters<typeof buildProveResultOf>[1],
  opts: { labId?: string; ms?: number } = {},
): ProveResult | null {
  return buildProveResultOf(questions, cards, { ...opts, labId: opts.labId ?? PROVE_LAB_ID })
}
