/**
 * Lab 07's authored hint ladder (H3, docs/specs/wave-1.md §13.2; wave-3.md §8.2, D13): a faded ladder, R0 to R2 for each of
 * the six required checks. R0 is the teach-back and its three ideas, R1 the concept with an H2 anchor in the host lesson,
 * R2 where to look (a function that exists in lib.rs); after R2 the page offers the H2 packet, and there is no pseudo-code,
 * no code-free design rung and no bottom-out. The rules every lab shares (unlocking, the reducer, the ledger refs, the "ask
 * a human" link) live in src/lib/forge/ladder.ts; this module binds lab 07's.
 *
 * Pure data and pure functions: the component (src/components/forge/HintLadder.tsx) owns the clock and the ledger, and
 * scripts/lint-mentor.ts (`bun run verify:mentor`) holds every authored rung to its limits, a `fade: 'r2'` bundle to R0-R2.
 * Every fact a rung states is read off labs/radix-cache/src/lib.rs, and tests/forge/radix-cache.test.ts holds each to it.
 */

import type { HintRef } from '@/lib/ledger/types'
import { hintRef as hintRefOf, restoreState as restoreStateOf, type Ctx, type LadderState, type RungId } from '@/lib/forge/ladder'
import type { CheckLadder, LessonLink } from '../types'

export const LAB_ID = 'radix-cache'

/** The title prefix of lab 07's Ask-a-human posts. */
export const DISCUSSIONS_LABEL = '[lab 07]'

/** `ack hint:radix-cache/<check>#R<n>`. */
export const hintRef = (checkId: string, rung: RungId): HintRef => hintRefOf(checkId, rung, LAB_ID)

/** A state rebuilt from the ledger's acks, for this lab. */
export const restoreState = (acks: Readonly<Record<string, string>>, checkId: string, ctx: Ctx): LadderState =>
  restoreStateOf(acks, checkId, { ...ctx, labId: LAB_ID })

export const R0_PROMPT = 'In two sentences: what does this check do to your cache, and what did yours do?'

const RADIX: LessonLink = {
  lessonId: 't5.l6',
  h2: 'RadixAttention: cache structure becomes scheduling structure',
  anchor: 'radixattention-cache-structure-becomes-scheduling-structure',
}
const CLUSTER: LessonLink = { lessonId: 't5.l6', h2: 'The cluster is part of the cache', anchor: 'the-cluster-is-part-of-the-cache' }
const LIFECYCLE: LessonLink = {
  lessonId: 't5.l5',
  h2: 'The allocation lifecycle, end to end',
  anchor: 'the-allocation-lifecycle-end-to-end',
}

/** The required checks, in the order the module lists them and the page grades them. */
export const LADDER_CHECK_IDS = ['exact_match', 'longest_prefix', 'eviction_order', 'block_conservation', 'cow_divergence', 'chat_hit_rate'] as const

export const LADDER: Record<string, CheckLadder> = {
  exact_match: {
    checkId: 'exact_match',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It stores one 40-token prompt through the harness, then looks the same prompt up twice.',
        'It fails if the lookup is not 40 tokens over 3 blocks, if the second lookup differs, or if a block has more than one owner.',
        'It stores the prompt again and expects a touch: still one entry and 3 blocks allocated.',
      ],
    },
    r1: {
      text: 'A prefix cache keeps finished prompts keyed by their exact token ids. A lookup follows the query token by token and reports how many matched, with the blocks that cover them. Inserting a prompt the cache already holds is a touch, not a second copy: keep one entry, and retain each block once.',
      link: RADIX,
    },
    r2: {
      text: 'The message says what differed: the length, the block table, an owner count or the entry count. In lib.rs, check_exact_match stores 40 tokens, looks them up twice, then stores them again. Count your retains.',
      fn: 'check_exact_match',
    },
  },

  longest_prefix: {
    checkId: 'longest_prefix',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It caches a 32-token system prompt, that prompt plus a 16-token document, and the system prompt plus another 12 tokens.',
        'It looks up the document plus 11 new tokens and expects 48 tokens over 3 blocks, not the 32-token ancestor or the other branch.',
        'It looks up 20 tokens nobody cached and expects a miss: length 0 and no blocks.',
      ],
    },
    r1: {
      text: 'A shared system prompt is the trunk of the tree and each document or turn is a branch. A lookup follows the query down, remembering the deepest place where it still agrees with a cached prompt. Returning the first branch that shares any prefix returns too little.',
      link: RADIX,
    },
    r2: {
      text: 'The message gives the length and blocks you returned. In lib.rs, check_longest_prefix stores three prompts, then looks up an extension of the longest. Check that your lookup keeps going past a branch instead of stopping there.',
      fn: 'check_longest_prefix',
    },
  },

  eviction_order: {
    checkId: 'eviction_order',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It fills a cache of three entries, looks up A, then inserts D, and expects B, the coldest, to be the one evicted.',
        'It pins C with an outside owner and expects eviction to skip it and take another leaf instead.',
        'It stores a prompt, an extension of it and a third prompt, then adds a fourth: the third must go, not the older prompt that has a descendant.',
      ],
    },
    r1: {
      text: 'Eviction frees memory from the edges of the tree. Only a leaf, a prompt that no other cached prompt extends, may go, because an interior prompt\'s blocks are shared with its descendants. Among leaves the one used longest ago goes first, and a lookup counts as use. A leaf with an outside owner is skipped.',
      link: RADIX,
    },
    r2: {
      text: 'The message says which of the three scenarios broke. In lib.rs, check_eviction_order runs plain recency, a pinned leaf and an interior prefix. Read it with your evict_lru open, and check what makes an entry a leaf.',
      fn: 'check_eviction_order',
    },
  },

  block_conservation: {
    checkId: 'block_conservation',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It runs 2,000 seeded operations on a pool of 128 blocks with a limit of 24 entries: mostly lookup then insert, some lookups, some evictions.',
        'After every operation the entry count must stay within 24 and free plus allocated blocks must equal 128.',
        'It then evicts until the cache is empty and expects all 128 blocks free. One leaked retain stops the drain from finishing.',
      ],
    },
    r1: {
      text: 'Every block has an owner count. A cached entry owns one reference to each block of its table, and the prefill\'s temporary owner is released after the insert. Retains and releases must pair up for every entry, including the ones you evict. A block with no owners returns to the pool by itself.',
      link: LIFECYCLE,
    },
    r2: {
      text: 'The message gives the operation number and the count that broke. In lib.rs, check_block_conservation replays the churn from a seed and drains the cache. Check every path that retains, releases or evicts, and the entry limit.',
      fn: 'check_block_conservation',
    },
  },

  cow_divergence: {
    checkId: 'cow_divergence',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It caches a 20-token prompt (one full block and a 4-token tail), then the same prompt plus 7 more tokens.',
        'It expects each entry to have two blocks, with the first block the same physical block in both.',
        'It expects the second blocks to differ, so 3 blocks are allocated in all: one shared, two private tails.',
      ],
    },
    r1: {
      text: 'A full block holds 16 tokens that both prompts agree on, so both can read one physical block. A partial tail holds tokens that only one prompt has, and a shared tail would let a writer change what the other reads. Reuse the cached block for whole blocks and keep the new prompt\'s own block for the tail.',
      link: RADIX,
    },
    r2: {
      text: 'The message says which block was shared or copied wrongly, or how many blocks are allocated. In lib.rs, check_cow_divergence stores a base and a branch. Check which blocks your insert replaces with cached ones.',
      fn: 'check_cow_divergence',
    },
  },

  chat_hit_rate: {
    checkId: 'chat_hit_rate',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It replays 240 chat requests from 8 products: a 64-token system prompt each product shares, then a 16-token turn nobody repeats.',
        'Each request looks up its prompt, counts the tokens reused, then stores it, in a pool of 128 blocks with a limit of 32 entries.',
        'It expects at least 65% of all prompt tokens reused, so a lookup that wants a whole cached prompt fails.',
      ],
    },
    r1: {
      text: 'KV hit rate is cached prompt tokens divided by prompt tokens. In chat, requests share a long system prompt and differ in the turn, so the saving is the shared prefix, not a whole prompt. Report the longest shared prefix even where no entry ends, and do not evict what the next request needs.',
      link: CLUSTER,
    },
    r2: {
      text: 'The message gives the hit rate against the 65% floor, or the request that failed. In lib.rs, check_chat_hit_rate replays 240 requests. Look at what your lookup returns when only the start of an entry matches.',
      fn: 'check_chat_hit_rate',
    },
  },
}
