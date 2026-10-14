/**
 * Lab 02's authored hint ladder (H3, docs/specs/wave-1.md §13.2; wave-2.md §13.2): five rungs for each of the six
 * required checks. The rules every lab shares (unlocking, the reducer, the ledger refs, the "ask a human" link) live in
 * src/lib/forge/ladder.ts; lab 01's ladder module re-exports them with its own defaults, and this module binds lab 02's.
 *
 * Pure data and pure functions: the component (src/components/forge/HintLadder.tsx) owns the clock and the ledger, and
 * scripts/lint-mentor.ts (`bun run verify:mentor`) holds every authored rung to its limits. The lab has no bottom-out
 * walkthrough yet (the bundle's `walkthrough` is optional), so its ladder ends at R4.
 */

import type { HintRef } from '@/lib/ledger/types'
import { hintRef as hintRefOf, restoreState as restoreStateOf, type Ctx, type LadderState, type RungId } from '@/lib/forge/ladder'
import type { CheckLadder, LessonLink } from '../types'

export const LAB_ID = 'kv-block-manager'

/** The title prefix of lab 02's Ask-a-human posts. */
export const DISCUSSIONS_LABEL = '[lab 02]'

/** `ack hint:kv-block-manager/<check>#R<n>`. */
export const hintRef = (checkId: string, rung: RungId): HintRef => hintRefOf(checkId, rung, LAB_ID)

/** A state rebuilt from the ledger's acks, for this lab. */
export const restoreState = (acks: Readonly<Record<string, string>>, checkId: string, ctx: Ctx): LadderState =>
  restoreStateOf(acks, checkId, { ...ctx, labId: LAB_ID })

export const R0_PROMPT = 'In two sentences: what does this check do to your block manager, and what did yours do?'

const TABLES: LessonLink = { lessonId: 't5.l5', h2: 'The data structures, concretely', anchor: 'the-data-structures-concretely' }
const LIFECYCLE: LessonLink = {
  lessonId: 't5.l5',
  h2: 'The allocation lifecycle, end to end',
  anchor: 'the-allocation-lifecycle-end-to-end',
}
const FAULTS: LessonLink = {
  lessonId: 't2.l2',
  h2: 'Page faults are a mechanism, not an error',
  anchor: 'page-faults-are-a-mechanism-not-an-error',
}

/** The required checks, in the order the module lists them and the page grades them. */
export const LADDER_CHECK_IDS = ['paging', 'capacity', 'fork_shares', 'cow', 'free_refcount', 'gauntlet'] as const

export const LADDER: Record<string, CheckLadder> = {
  paging: {
    checkId: 'paging',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It builds a pool of 8 blocks of 16 tokens and allocates sequences of 20, 16 and 17 tokens, which take 2, 1 and 2 blocks.',
        'It fails if 3 blocks are not left, if tokens 0 and 15 do not share a block, or if token 16 is not in the next one.',
        'It expects translate past the end of a sequence to be None, and no two sequences to share a block while nothing has been forked.',
      ],
    },
    r1: {
      text: 'A block table is a plain list: entry i holds the physical block for tokens 16i to 16i + 15. A sequence of n tokens needs n over the block size, rounded up, so 20 tokens take two blocks. To find a token, divide by the block size, rounding down, and index the table. Past the length, no block.',
      link: TABLES,
    },
    r2: {
      text: 'The message names the count or the token that broke. In lib.rs, check_paging allocates 20, 16 and 17 tokens, then translates a handful of them. Check the rounding in allocate and the bound you test in translate.',
      fn: 'check_paging',
    },
    r3: [
      'blocks needed = tokens plus block size minus one, divided by block size',
      'translate: if the token is below the length, return the table entry at token divided by block size',
      'otherwise return nothing',
    ].join('\n'),
    r4: 'Keep a pool of free block ids, and per sequence a table of ids plus a token length. Invariants: an id is in the pool or in a table, never both, and a table has exactly length over block size, rounded up, entries. new fills the pool with every id. allocate takes that many ids off the pool. translate returns the table entry at token over block size, or nothing at or past the length.',
  },

  capacity: {
    checkId: 'capacity',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It fills a pool of 4 blocks with one sequence of 64 tokens, then asks for one more token, which has to be refused.',
        'It fails if the refused allocate changes the free count, or if free(1) does not give all 4 blocks back.',
        'It ends with an allocate on the freed pool, so returned blocks must be usable again, not only counted.',
      ],
    },
    r1: {
      text: 'A pool is finite, so allocate can say no. Work out how many blocks the request needs and compare that with what the pool holds. If it does not fit, return false before touching anything. Taking some blocks and then giving up leaves a half-built sequence behind. On free, every block of a lone sequence goes back.',
      link: LIFECYCLE,
    },
    r2: {
      text: 'The message says which step broke: a refusal that changed state, or a free that returned too few. In lib.rs, check_capacity fills the pool, is refused once, frees, then allocates again. Is the pool checked before any block is taken?',
      fn: 'check_capacity',
    },
    r3: [
      'need = the number of blocks the request takes',
      'if the pool holds fewer than need, return false and change nothing',
      'otherwise take need ids off the pool and record them in the table',
    ].join('\n'),
    r4: 'Make every fallible operation two phases. First compute what it needs and test that against the pool, with no mutation at all. Only if it fits, apply the changes. Invariants: a refused call leaves the pool and every table exactly as before, and a freed block is back in the pool, so the next allocate can take it. A lone sequence owns each of its blocks, so free returns them all.',
  },

  fork_shares: {
    checkId: 'fork_shares',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It allocates 40 tokens, which take 3 blocks, then forks sequence 1 into sequence 2 while the pool has blocks to spare.',
        'It fails if the free count moves after the fork. A fork shares blocks, so it takes nothing from the pool.',
        'It compares translate for all 40 tokens of both sequences, and they must be identical right after the fork.',
      ],
    },
    r1: {
      text: 'A fork copies the table, not the memory. The child gets the same list of block ids, so every token translates alike, and each block gains one owner. Nothing leaves the pool. The refcount per block is what lets two tables share safely. Fork fails when the source is missing or the child already exists.',
      link: TABLES,
    },
    r2: {
      text: 'The message says whether fork failed, the free count moved or a token diverged. In lib.rs, check_fork_shares forks a 40-token sequence and compares all 40 translations. Does your fork clone the table and add one to each refcount?',
      fn: 'check_fork_shares',
    },
    r3: [
      'copy the source table and length to the new sequence',
      'add one to the refcount of every block in that table',
      'take nothing from the pool, and refuse if the source is missing or the new id exists',
    ].join('\n'),
    r4: 'Per physical block keep a refcount: the number of tables that list it. allocate sets each new block to one. fork checks that the source exists and the destination does not, clones the table and the length, and adds one to the count of each block in it. The pool is untouched. Invariant: a block count equals the number of tables holding it, and a free block has count zero.',
  },

  cow: {
    checkId: 'cow',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It forks a 40-token sequence, then appends one token to the child. The last block holds 8 tokens and is shared.',
        'It expects exactly one block taken from the pool, the parent’s tail untouched and the child’s tail now different.',
        'It compares tokens 0 to 31 of both sequences, which must still share their blocks: only the tail is copied.',
      ],
    },
    r1: {
      text: 'Writing into a block that two sequences read would change the other one’s tokens. So before an append goes into a shared, partly filled tail, take a fresh block, point only this table at it, and lower the old block’s refcount by one. A full shared tail needs no copy: the new tokens start a new block.',
      link: FAULTS,
    },
    r2: {
      text: 'The message names what moved: the free count, the parent’s tail or the child’s. In lib.rs, check_cow forks 40 tokens and appends one to the child. Look at how your append tests for a shared partial tail.',
      fn: 'check_cow',
    },
    r3: [
      'if the last block is partly full and its refcount is above one, it is shared',
      'then take a fresh block, put it in this table only, and lower the old count by one',
      'after that add the new tokens, taking whole new blocks when the tail fills',
    ].join('\n'),
    r4: 'Plan before you act. Count the blocks the append needs: one copy if the tail is partial and shared, plus whole new blocks for the tokens beyond the room left in the tail. Refuse with no change if the pool cannot cover that. Then apply it: swap the shared tail for a fresh block in this table only, lower the old count, and push the new blocks. The parent never changes.',
  },

  free_refcount: {
    checkId: 'free_refcount',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It forks a 40-token sequence, frees sequence 1 and expects the free count not to move, because sequence 2 still holds all 3 blocks.',
        'It fails if sequence 2 loses a token, which means a block went back to the pool while it was in use.',
        'It then frees sequence 2 and expects the whole pool back, so a block must return when its count reaches zero.',
      ],
    },
    r1: {
      text: 'Free means this sequence lets go, not that the block dies. Lower the refcount of every block in its table by one. Only a block that reaches zero goes back to the pool. If you return a block while another table still lists it, that sequence reads memory the pool may hand out again.',
      link: LIFECYCLE,
    },
    r2: {
      text: 'The message says whether the free count moved too early or the pool did not come back whole. In lib.rs, check_free_refcount forks, frees the parent, then the child. Check what your free does when a count is above one.',
      fn: 'check_free_refcount',
    },
    r3: [
      'for each block in the table, lower its refcount by one',
      'if that count is now zero, put the block back in the pool',
      'drop the sequence from the table map, and ignore an unknown id',
    ].join('\n'),
    r4: 'free takes the sequence’s table out of the map, then walks it once. For each block it lowers the refcount by one, and only a block whose count reaches zero is pushed onto the pool. Invariants: a count never goes below zero, a block is in the pool exactly when its count is zero, and freeing an unknown id does nothing. Freeing twice must not return anything twice.',
  },

  gauntlet: {
    checkId: 'gauntlet',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It runs 2,000 seeded allocate, append, fork and free operations on a pool of 64 blocks, with up to 16 live sequences.',
        'After every op it adds the free blocks to the distinct blocks live sequences use, and the total must be 64.',
        'A leak makes the sum too small, a double free makes it too big, and a failed op that changed state breaks it too.',
      ],
    },
    r1: {
      text: 'Conservation is the rule behind every other check: each block is either in the pool or used by a live table, never both and never neither. Each operation either completes or changes nothing. Work out what an op needs, test that against the pool, and only then touch any refcount.',
      link: LIFECYCLE,
    },
    r2: {
      text: 'The message gives the op number and the sum that broke. In lib.rs, check_gauntlet mixes all four ops from a seed and recounts after each one. Look first at the paths that can fail halfway: append and fork.',
      fn: 'check_gauntlet',
    },
    r3: [
      'before any change, work out every block the op needs and refuse if the pool is short',
      'after any change, each block is in the pool or has a count that matches its owners',
      'a copy of a shared tail also lowers the old block count by one',
    ].join('\n'),
    r4: 'The earlier checks each cover one path, and the gauntlet interleaves all of them. Audit each operation for the same two things. Does it check the pool before it mutates anything? And does every refcount change pair up: a copy of a shared tail adds one block and lowers another, a free lowers each and returns zeros. A sum above the pool is a double free, below it a leak.',
  },
}
