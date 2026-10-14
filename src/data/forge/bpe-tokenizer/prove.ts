/**
 * Prove it v1, "Prove it, no AI", for lab 03 (docs/specs/wave-2.md §13.3; the mechanics are lab 01's, wave-1.md §13.3).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions below about their
 * own `tokenizer.rs`. One question returns 30 days later as a Today item (`followUpRef`). The state machine, the draw and
 * the ledger payload are the same for every lab: they live in src/lib/forge/prove.ts. The panel is
 * src/components/forge/ProveIt.tsx, which draws from the bundle's `prove`.
 */

import { KC } from '@/data/kc/ids'
import type { ProveQuestion } from '../types'

export const PROVE_LAB_ID = 'bpe-tokenizer'

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'rank-not-id',
    prompt: 'Where does the rank of a rule come from in your `Tokenizer`, and why is it not the merged id?',
    model:
      'The rank is the rule’s position in the `merges` vector, so I store it when I build the pair map: pair to (rank, merged id). The merged id is only the new symbol’s name. In the lab’s tables the ids happen to rise with the ranks, but the contract is the position, and a table with ids in another order must still merge by position. Comparing ids instead would silently break that.',
    ideas: [
      'the rank is the index in the merge list, stored with the pair when the table is indexed',
      'the merged id is a name for the new symbol and says nothing about priority',
      'comparing ids would only work while the ids happen to rise with the ranks',
    ],
    kcs: [KC.bpeMerges],
  },
  {
    id: 'two-rules',
    prompt: 'The table has (b, c) at rank 0 and (a, b) at rank 1. What does your `encode` do to "abc", pass by pass?',
    model:
      'Pass one scans the pairs (a, b) and (b, c). Both have rules, and the ranks are 1 and 0, so the lowest rank wins and (b, c) becomes 256: the sequence is [97, 256]. Pass two looks at (97, 256), finds no rule, and stops. The leftmost pair would have merged (a, b) first and given [257, 99], which is why the scan takes the minimum rank over the whole sequence rather than the first match.',
    ideas: [
      'finds both pairs with rules and compares their ranks, 1 against 0',
      'merges (b, c) first and ends with [97, 256]',
      'stops when the new pair (97, 256) has no rule',
    ],
    kcs: [KC.bpeMerges],
  },
  {
    id: 'run-of-a',
    prompt: 'With one rule for (a, a), what does your `encode` do to "aaa", and what keeps a byte from being merged twice?',
    model:
      'It returns [256, 97]. The replacement pass walks left to right with an index: at position 0 the pair (a, a) matches, so it pushes 256 and advances by two, which skips the second a. At position 2 there is no next element, so the last a is pushed on its own. Advancing by two after a match is what stops the overlapping match (a, a) at positions 1 and 2.',
    ideas: [
      'the result is [256, 97], the leftover a staying as it is',
      'a match pushes the merged id and moves the position forward by two',
      'so the second half of a merged pair is never tested as the start of another',
    ],
    kcs: [KC.bpeMerges],
  },
  {
    id: 'loop-until',
    prompt: 'Why does your `encode` repeat until no pair has a rule, and what would stopping after one round miss?',
    model:
      'A merge creates a new id, and that id can be the left or right half of a later rule. In the 48-merge table, " t" and "he " each become one id, and rule 259 then merges those two ids. A round merges only the lowest-rank pair, so stopping after one round leaves pairs that still have a rule, which is the failure `contract` reports as an encode that stopped early. Looping until nothing merges ends because each replacement makes the sequence shorter.',
    ideas: [
      'a merge makes a new id that later rules can name',
      'stopping after one round leaves pairs that still have a rule, including ones the merge just made',
      'the loop stops because every replacement shortens the sequence',
    ],
    kcs: [KC.bpeMerges],
  },
  {
    id: 'nested-decode',
    prompt: 'How does your `decode` expand a merge id whose children are themselves merge ids, and where does it stop?',
    model:
      'It keeps a stack of ids still to expand. Popping an id below 256 appends that byte. Popping a merge id pushes its right child and then its left, so the left child is popped, and so written, first. That repeats until the stack is empty, however deeply the merges nest. The collected bytes are turned into a string once at the end, so a multi-byte character split across tokens still comes out whole.',
    ideas: [
      'a work stack or recursion expands children until only bytes remain',
      'pushes the right child first so the left one comes out first',
      'builds the string from all the bytes at the end, not token by token',
    ],
    kcs: [KC.tokenizerBytes],
  },
  {
    id: 'bad-id',
    prompt: 'What does your `decode` do with the id 9999, and why is that better than panicking inside a server?',
    model:
      'An id that is neither a byte nor in the table adds the three UTF-8 bytes of U+FFFD to the output, and decoding carries on with the next id, so the ids around it still come out right. It does not panic and does not drop the id silently. Ids arrive from clients, logs and caches that can be corrupted, and a panic would take down the whole process, and every other request, for one bad one.',
    ideas: [
      'writes the replacement character U+FFFD, three bytes, for the unknown id',
      'carries on, so the neighbouring ids still decode',
      'a panic would end the server for one bad request, and silent dropping hides the bug',
    ],
    kcs: [KC.tokenizerBytes],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab03.prove.${qid}`
