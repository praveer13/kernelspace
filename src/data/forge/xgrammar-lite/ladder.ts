/**
 * Lab 08's authored hint ladder (docs/specs/wave-3.md §8.2, D13 and D26): R0 to R2 for each of the six required
 * checks, and then the packet. The bundle sets `fade: 'r2'`, so the ladder has no R3, R4 or bottom-out walkthrough.
 * The rules every lab shares (unlocking, the reducer, the ledger refs, the "ask a human" link) live in
 * src/lib/forge/ladder.ts; scripts/lint-mentor.ts (`bun run verify:mentor`) holds every authored rung to its limits.
 *
 * Pure data: the component (src/components/forge/HintLadder.tsx) owns the clock and the ledger.
 */

import type { CheckLadder, LessonLink } from '../types'

export const LAB_ID = 'xgrammar-lite'

/** The title prefix of lab 08's Ask-a-human posts. */
export const DISCUSSIONS_LABEL = '[lab 08]'

export const R0_PROMPT = 'In two sentences: what does this check do to your matcher, and what did yours do?'

const MASK: LessonLink = {
  lessonId: 't6.l8',
  h2: 'The token mask is not a string mask',
  anchor: 'the-token-mask-is-not-a-string-mask',
}
const HANDLE: LessonLink = {
  lessonId: 'r.l7',
  h2: 'Clone the handle, not the payload',
  anchor: 'clone-the-handle-not-the-payload',
}

/** The required checks, in the order the module lists them and the page grades them. */
export const LADDER_CHECK_IDS = ['schema_compile', 'valid_acceptance', 'earliest_rejection', 'token_mask', 'mask_overhead', 'compile_cache'] as const

export const LADDER: Record<string, CheckLadder> = {
  schema_compile: {
    checkId: 'schema_compile',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It parses a profile schema with a string, an array of integers and a boolean, calls compile on it, and reads state_count.',
        'It fails if compile returns an error, or if state_count is under 5 or over 128.',
        'A nested schema must lower to a finite set of states, so the recursion ends at the leaves: strings, integers, booleans and enums.',
      ],
    },
    r1: {
      text: 'A schema is a tree, and a matcher needs a finite program for it. Lower every node once: an object, an array, a string, an enum, an integer or a boolean each becomes a state the matcher can enter. Children lower before their parent, and the count is how many states you made.',
      link: MASK,
    },
    r2: {
      text: 'The message gives your state count. In lib.rs, check_schema_compile parses a profile schema, compiles it and counts the states. Check that compile visits every nested node, and that state_count returns what compile built.',
      fn: 'check_schema_compile',
    },
  },

  valid_acceptance: {
    checkId: 'valid_acceptance',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It feeds a valid profile document in five fragments, then six random documents cut at random bytes, each with an escape and whitespace.',
        'It fails if any fragment is rejected, or if the status is Complete before the last fragment.',
        'Only the closing brace of the root object makes the matcher complete; an escape, a space or half of true must stay a prefix.',
      ],
    },
    r1: {
      text: 'Feed bytes through a stack of small state machines: one for the object, one for a string, one for an array, one for an integer. A string frame treats a backslash as the start of an escape, and whitespace is allowed between tokens. State carries over between fragments, and the root completes only on its closing brace.',
      link: MASK,
    },
    r2: {
      text: 'The message names the round and how many bytes were fed. In lib.rs, check_valid_acceptance feeds the fixed fragments first, then six random documents. Find where your status turns Rejected, and ask which byte your string or whitespace state refused.',
      fn: 'check_valid_acceptance',
    },
  },

  earliest_rejection: {
    checkId: 'earliest_rejection',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It corrupts a document in eleven ways, such as a key, a boolean, an integer, an enum value, a comma or trailing text, and feeds it whole or cut.',
        'It fails unless the status is Rejected at the offset of the first bad byte, counted from the start of the document, not of the token.',
        'Once the matcher has rejected, every later token must return the same Rejected status.',
      ],
    },
    r1: {
      text: 'A byte is rejected the moment no valid document can continue with it, not at the end of its token and not when the document ends. Keep a running count of bytes consumed, store the offset of the first refusal, and never change it. A maximum of 100 rejects the third digit of 101, not the comma after it.',
      link: MASK,
    },
    r2: {
      text: 'The message gives the round, the corruption and the byte wanted. In lib.rs, check_earliest_rejection builds each case in corrupt. Compare the offset it expects with the one accept_token returned, and look at where you add the token’s start.',
      fn: 'check_earliest_rejection',
    },
  },

  token_mask: {
    checkId: 'token_mask',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It consumes a prefix and masks six fixed tokens, then four random half-written documents with 24 random tokens each.',
        'It fails if an entry differs from a search of the 200 documents the schema allows, or if token_mask changes the matcher it was called on.',
        'A token is legal only if all its bytes keep the document viable, even when it crosses several states or starts well and ends badly.',
      ],
    },
    r1: {
      text: 'The sampler picks whole tokens, so test whole tokens. For each candidate, copy the matcher, feed every byte of the token to the copy, and allow the token if the copy was not rejected. The original stays untouched. Testing only the first byte lets through a token that starts legally and ends in garbage.',
      link: MASK,
    },
    r2: {
      text: 'The message names the state, the token, and whether it should be legal. In lib.rs, check_token_mask first masks six fixed tokens. Does your mask copy the matcher before feeding a token, and feed every byte of it?',
      fn: 'check_token_mask',
    },
  },

  mask_overhead: {
    checkId: 'mask_overhead',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It consumes a prefix and masks a vocabulary of 512 tokens, most of them nonsense such as bad_token_5.',
        'The browser run fails only if the mask has the wrong length or allows nothing; a native run also fails over 10 ms per mask.',
        'A mask is cheap when each token costs one small stack copy, not a copy of the compiled grammar.',
      ],
    },
    r1: {
      text: 'A mask runs at every decode step, once per vocabulary token. The compiled grammar never changes, so share it behind an Rc and copy only the matcher’s small state: the stack of frames and a few counters. Cloning the Rc bumps a counter. Cloning the grammar copies every node, for each token.',
      link: HANDLE,
    },
    r2: {
      text: 'The message gives microseconds per mask on a native run. In lib.rs, check_mask_overhead builds 512 tokens and times 40 masks. Look at what your clone copies per token, and whether the matcher holds the grammar in an Rc.',
      fn: 'check_mask_overhead',
    },
  },

  compile_cache: {
    checkId: 'compile_cache',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It compiles a tool schema, then the same schema with another keyword order, enum order and whitespace, and counts entries, compilations and hits.',
        'It fails unless both calls return the same Rc, with one entry, one compilation and one hit; a different schema must compile once more.',
        'The key is the parsed Schema, which the harness parser has already put in order, not the source text.',
      ],
    },
    r1: {
      text: 'Two sources can mean one schema. The parser already ignores whitespace and keyword order and sorts enum values, so equal meanings parse to equal Schema values. Key the map by the Schema, not the string. A hit returns another handle to the same compiled grammar, an Rc clone, and counts a hit. Only a miss compiles.',
      link: HANDLE,
    },
    r2: {
      text: 'The message prints entries, compiles and hits at the failing call. In lib.rs, check_compile_cache runs a fixed pair, then a random schema rewritten. Is your map keyed by the parsed Schema, and does a hit return an Rc clone?',
      fn: 'check_compile_cache',
    },
  },
}
