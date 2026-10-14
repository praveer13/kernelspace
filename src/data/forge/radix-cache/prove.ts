/**
 * H4 v1, "Prove it, no AI", for lab 07 (docs/specs/wave-3.md §8.2; the mechanics are lab 01's, wave-1.md §13.3).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions below about their
 * own `cache.rs`. One question returns 30 days later as a Today item (`followUpRef`). The state machine, the draw and the
 * ledger payload are the same for every lab and live in src/lib/forge/prove.ts; this module is the lab's pool and id.
 * The panel is src/components/forge/ProveIt.tsx. Prove-it v2 for this lab is `prove2.ts`.
 */

import { KC } from '@/data/kc/ids'
import type { ProveResult } from '@/lib/ledger/types'
import { buildProveResult as buildProveResultOf, pickQuestions as pickQuestionsOf, PROVE_PICK } from '@/lib/forge/prove'
import type { ProveAttempt } from '@/lib/forge/prove'
import type { ProveQuestion } from '../types'

export const PROVE_LAB_ID = 'radix-cache'

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'partial-match',
    prompt: 'What does your `match_prefix` return for a query that shares only the first 20 tokens of a cached 40-token prompt, and how does it find that?',
    model:
      'It returns a length of 20 and the two blocks that cover those tokens (20 over 16, rounded up). It compares the query with the cached prompts token by token and stops at the first token that differs, so a prompt that parts from an entry halfway still reuses what it shares. Insisting on a whole cached prompt would return 0 here, and the chat replay, where requests share a system prompt and part at the turn, would reuse nothing.',
    ideas: [
      'returns 20 tokens and the blocks covering them, rounded up to whole blocks',
      'compares token by token and stops at the first token that differs, instead of wanting a whole cached prompt',
      'says what goes wrong otherwise: a chat request that parts at its turn would get no reuse',
    ],
    kcs: ['t5.prefix-cache-keys'],
  },
  {
    id: 'deepest-not-first',
    prompt: 'Two cached prompts share a 32-token system prompt, and the query extends the second. How does your lookup end up with the second and not the first?',
    model:
      'It does not stop at the first entry or branch that shares a prefix. It follows the query as far as the cached paths agree with it and keeps the deepest point reached, so the second prompt, which agrees for longer, wins. Taking the first match would return the 32 tokens both share, or the wrong branch, and `longest_prefix` and `cow_divergence` both go red for that.',
    ideas: [
      'follows the query as far as any cached prompt agrees with it',
      'keeps the deepest match, not the first branch that shares a prefix',
      'the shorter result would be the shared 32 tokens, which loses the second prompt’s extra tokens',
    ],
    kcs: ['t5.prefix-cache-keys'],
  },
  {
    id: 'touch-on-hit',
    prompt: 'Where does your code refresh an entry’s recency, and what goes wrong if a lookup never does?',
    model:
      'In `match_prefix`, on the entry it hit, and in `insert` when the prompt is already cached, because that is a touch. Eviction takes the coldest leaf, so a hot prefix that is never refreshed sits at the cold end and is evicted while it is still in use. `eviction_order` shows it first: the entry the check just looked up is evicted instead of the one nobody asked for.',
    ideas: [
      'refreshes in match_prefix on a hit, and in insert on an exact duplicate',
      'eviction picks the coldest leaf, so a lookup that does not refresh leaves a hot entry looking cold',
      'the hot entry is evicted while in use, which eviction_order catches',
    ],
    kcs: ['t5.radix-eviction'],
  },
  {
    id: 'leaf-only',
    prompt: 'Which entries can your `evict_lru` consider, and what happens to a prompt that is a proper prefix of another cached prompt?',
    model:
      'Only leaves: entries that no other cached prompt extends, and whose blocks have no owner outside the cache. A prompt that is a proper prefix of another is an interior node, so it is not a candidate until its descendants are gone, and then it becomes a leaf. Among the candidates it takes the least recently used, releases that entry’s whole block table once, and returns false when no candidate exists.',
    ideas: [
      'only leaves are candidates, and entries with an outside owner are skipped',
      'a proper prefix of another entry is interior and is not evicted until its descendants are',
      'takes the least recently used candidate, releases its table once, and returns false when there is none',
    ],
    kcs: ['t5.radix-eviction'],
  },
  {
    id: 'canonical-blocks',
    prompt: 'The harness hands `insert` a temporary table of fresh blocks. Which of them does your cache keep, which does it replace, and what happens to the ones it replaces?',
    model:
      'For every whole block that a cached prompt already holds, the cache swaps the fresh block for that cached one. It keeps the fresh block for any part that is new, including a partial tail. Then it retains the resulting table once, and the harness releases its temporary table. The swapped-out fresh blocks fall to zero owners and return to the pool, the cached ones are now held by both entries, and the new blocks sit at one owner.',
    ideas: [
      'replaces each whole block a cached prompt already holds with the cached block',
      'keeps the fresh blocks for the new part and any partial tail, and retains the final table once',
      'the harness’s release sends the replaced fresh blocks back to the pool, and the shared ones stay',
    ],
    kcs: [KC.blockRefcounts],
  },
  {
    id: 'private-tail',
    prompt: 'A 20-token prompt and a 27-token prompt that extends it are both cached. Which of their blocks are one physical block, which are two, and why not share all of them?',
    model:
      'The first 16 tokens fill a whole block that both prompts agree on, so it is one physical block with two owners. The second block holds tokens 16 to 19 for the shorter prompt, a partial tail, and tokens 16 to 26 for the longer one, so the contents differ and each entry keeps its own. Sharing it would let a writer change what the other prompt reads. That is 1 shared block and 2 private ones, 3 in all.',
    ideas: [
      'the first full block is one physical block held by both entries',
      'the second block holds different tokens for each prompt, so each entry keeps its own',
      'sharing a partial tail would let a writer change what the other prompt reads, so 3 blocks are allocated',
    ],
    kcs: [KC.blockRefcounts, KC.kvCopyOnWrite],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab07.prove.${qid}`

/** Three questions for an attempt, from this lab's pool unless another is given. */
export const pickQuestions = (
  history: readonly ProveAttempt[],
  seed: number,
  pool: readonly ProveQuestion[] = PROVE_QUESTIONS,
  count: number = PROVE_PICK,
): ProveQuestion[] => pickQuestionsOf(history, seed, pool, count)

/** The `recordProve` argument, or null until every question is graded; lab 07's id unless `opts.labId` says otherwise. */
export function buildProveResult(
  questions: readonly ProveQuestion[],
  cards: Parameters<typeof buildProveResultOf>[1],
  opts: { labId?: string; ms?: number } = {},
): ProveResult | null {
  return buildProveResultOf(questions, cards, { ...opts, labId: opts.labId ?? PROVE_LAB_ID })
}
