/**
 * Prove it v1, "Prove it, no AI", for lab 08 (docs/specs/wave-3.md §8.2; the mechanics are lab 01's, wave-1.md §13.3).
 *
 * After every required check is green the learner closes their agent and answers 3 of the 6 questions below about
 * their own `grammar.rs`. One question returns 30 days later as a Today item (`followUpRef`). There is no Prove-it v2
 * for this lab: its bridge answers `probe` only (wave-3.md §7.2), so no template can name a call list. The state
 * machine, the draw and the ledger payload are the same for every lab and live in src/lib/forge/prove.ts; this module
 * is the lab's pool. The panel is src/components/forge/ProveIt.tsx, which draws from the bundle's `prove`.
 */

import type { ProveQuestion } from '../types'
import { GRAMMAR_MASKS } from './primm'

export const PROVE_LAB_ID = 'xgrammar-lite'

export const PROVE_QUESTIONS: readonly ProveQuestion[] = [
  {
    id: 'stack-of-frames',
    prompt: 'What does your `Matcher` keep between two bytes, and why a stack of frames rather than one flat state machine?',
    model:
      'It keeps a stack of frames, one per open object, array, string or integer, plus the count of bytes consumed and the status. A frame says where in its own small machine it is. When an inner value ends, its frame is popped and the frame below carries on. A flat machine would copy an inner machine for every place it appears, an array of up to four items repeating its item machine four times, and no fixed number of states can follow a schema that refers to itself.',
    ideas: [
      'a stack of frames, one for each open object, array, string or integer, and a byte count',
      'a frame is popped when its value ends, and the frame below continues',
      'a flat machine copies an inner machine at every place it appears, and cannot follow a recursive schema',
    ],
    kcs: [GRAMMAR_MASKS],
  },
  {
    id: 'whole-token',
    prompt: 'How does your `token_mask` decide that a token is legal, and what goes wrong if it only looks at the token’s first byte?',
    model:
      'For every vocabulary entry it clones the matcher, feeds all of the token’s bytes to the clone through the same code as `accept_token`, and allows the token if the clone is not rejected. The real matcher is never changed. Looking only at the first byte admits a token that starts legally and breaks later, such as a legal quote followed by garbage, so the sampler could still pick an invalid one.',
    ideas: [
      'clones the matcher per token and feeds every byte of the token to the clone',
      'allows the token when the clone is not rejected, and leaves the real matcher unchanged',
      'a first-byte check admits tokens that start well and end in garbage',
    ],
    kcs: [GRAMMAR_MASKS],
  },
  {
    id: 'global-offset',
    prompt: 'A token arrives and its third byte is the first one the grammar cannot take. What does your matcher report, and why is the rejection sticky?',
    model:
      'It reports Rejected with the offset of that byte counted from the start of the document, which is the bytes consumed before this token plus 2. It stops reading the token there. After that every call returns the same Rejected status without reading anything. A rejected stream stays rejected because the document can no longer become valid, and a sampler must not recover from an invalid state by accident.',
    ideas: [
      'the offset counts from the start of the document, so it adds the bytes consumed in earlier tokens',
      'it stops at the first bad byte instead of reading to the end of the token',
      'later calls return the same Rejected status, because no later byte can make the document valid',
    ],
    kcs: [GRAMMAR_MASKS],
  },
  {
    id: 'integer-bounds',
    prompt: 'With a maximum of 100, how does your integer frame accept 10, reject 101 at its last digit, and reject 01?',
    model:
      'After each digit it asks whether the digits so far can still grow into a value in range. 1 and 10 can (10 is a value, and 100 begins with it), but 101 cannot become anything in range, so the third digit is rejected at once. A leading zero is a complete number by itself, so after a 0 only a non-digit can follow, and the 1 of 01 is rejected. A matcher that checks the bound only when the number ends reports the error too late.',
    ideas: [
      'after every digit it asks whether the digits so far can still reach a value in range',
      'the third digit of 101 is rejected on arrival, not when the number ends',
      'a zero is a whole number, so another digit after it is rejected',
    ],
    kcs: [GRAMMAR_MASKS],
  },
  {
    id: 'clone-cost',
    prompt: 'What does your `token_mask` copy for each of the vocabulary’s tokens, and what does it deliberately not copy?',
    model:
      'It copies the matcher’s own small state: the stack of frames, the byte count and the status. The compiled grammar sits behind an `Rc`, so cloning the matcher bumps a counter and shares the nodes. Copying the grammar for each token would repeat that work for every entry of the vocabulary at every decode step, which is what the `mask_overhead` check guards against.',
    ideas: [
      'copies the stack of frames, the byte count and the status',
      'shares the compiled grammar through an Rc, so a clone only bumps a counter',
      'copying the grammar per token would repeat at every decode step for every vocabulary entry',
    ],
    kcs: [GRAMMAR_MASKS],
  },
  {
    id: 'cache-key',
    prompt: 'What is your `GrammarCache` keyed by, and why do two schema texts with another key order or other whitespace share one compiled program?',
    model:
      'It is keyed by the parsed `Schema`, not by the source text. The parser has already dropped whitespace and keyword order and sorted the enum values, so two texts with one meaning parse to equal values and find the same entry. A hit returns a clone of the stored `Rc` and counts a hit, and only a miss compiles. Keying by the text would compile the same schema again for every spelling, which is wasted work on agent traffic that repeats its schemas.',
    ideas: [
      'the key is the parsed Schema, so whitespace and keyword order no longer matter',
      'a hit returns a clone of the stored Rc and counts a hit; only a miss compiles',
      'a text key would recompile every spelling of a schema that agent traffic repeats',
    ],
    kcs: [GRAMMAR_MASKS],
  },
]

/** The Today follow-up item for a question: a constructed response, 30 days after the attempt. */
export const followUpRef = (qid: string): `item:${string}` => `item:lab08.prove.${qid}`
