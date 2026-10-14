/**
 * Lab 04's authored hint ladder (docs/specs/wave-3.md §8.2, D13 and D26): a faded ladder, R0 to R2 for each of the six
 * required checks, and then the H2 packet. R0 is the teach-back and its three ideas, R1 the concept with a lesson
 * anchor, R2 where to look (a function in the zip's `src/lib.rs`). There is no R3, R4 or bottom-out here: the bundle
 * sets `fade: 'r2'`, and the lab is outside the ladder-or-packet experiment (`RANDOMIZED_LABS` stays labs 01 to 03).
 * The rules every lab shares (unlocking, the reducer, the ledger refs, the "ask a human" link) live in
 * src/lib/forge/ladder.ts; this module binds lab 04's.
 *
 * Pure data and pure functions: the component (src/components/forge/HintLadder.tsx) owns the clock and the ledger, and
 * scripts/lint-mentor.ts (`bun run verify:mentor`) holds every authored rung to its limits. Every claim a rung makes
 * about a check is read from labs/mpmc-queue/src/lib.rs and labs/mpmc-queue/calibration.json.
 */

import type { HintRef } from '@/lib/ledger/types'
import { hintRef as hintRefOf, restoreState as restoreStateOf, type Ctx, type LadderState, type RungId } from '@/lib/forge/ladder'
import type { CheckLadder, LessonLink } from '../types'

export const LAB_ID = 'mpmc-queue'

/** The title prefix of lab 04's Ask-a-human posts. */
export const DISCUSSIONS_LABEL = '[lab 04]'

/** `ack hint:mpmc-queue/<check>#R<n>`. */
export const hintRef = (checkId: string, rung: RungId): HintRef => hintRefOf(checkId, rung, LAB_ID)

/** A state rebuilt from the ledger's acks, for this lab. */
export const restoreState = (acks: Readonly<Record<string, string>>, checkId: string, ctx: Ctx): LadderState =>
  restoreStateOf(acks, checkId, { ...ctx, labId: LAB_ID })

export const R0_PROMPT = 'In two sentences: what does this check do to your queue, and what did yours do?'

const QUEUES: LessonLink = {
  lessonId: 't2.l5',
  h2: 'Lock-free queues and the ABA problem',
  anchor: 'lock-free-queues-and-the-aba-problem',
}
const DECISION: LessonLink = { lessonId: 't2.l5', h2: 'The decision procedure', anchor: 'the-decision-procedure' }

/** The required checks, in the order the module lists them and the page grades them. */
export const LADDER_CHECK_IDS = ['fifo', 'backpressure', 'wraparound', 'model_gauntlet', 'slot_conservation', 'burst_model'] as const

export const LADDER: Record<string, CheckLadder> = {
  fifo: {
    checkId: 'fifo',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It builds an 8-slot ring and pushes 1 to 8, and every one of those pushes has to be accepted.',
        'It pops eight times and expects 1 to 8 in exactly that order, first in and first out.',
        'It pops once more on the drained ring, which has to say None, not a value left behind.',
      ],
    },
    r1: {
      text: 'The ring is a row of slots, each with a sequence number. A producer claims position t with a compare-exchange on the tail, stores its payload in slot t mod capacity, then publishes by writing t + 1. A consumer waits for h + 1 on its slot. Claim first, store second, publish last.',
      link: QUEUES,
    },
    r2: {
      text: 'The message names the push that failed or the value popped. In lib.rs, check_fifo pushes 1 to 8 into an 8-slot ring and pops them back. Check the number your push waits for, and which slot your pop reads.',
      fn: 'check_fifo',
    },
  },

  backpressure: {
    checkId: 'backpressure',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It fills a 4-slot ring with 10 to 13, then pushes 99, which has to come back as Err(99): the same value, not another.',
        'It pops once and expects Some(10), so the refused push did not disturb the head of the queue.',
        'It pushes 99 again, which must now succeed, because the slot the pop emptied is free for the next push.',
      ],
    },
    r1: {
      text: 'A bounded queue has to be able to say no. When the slot at the tail still holds last lap’s value, its sequence number is behind the position, and push returns Err with the caller’s own value. The pop that empties a slot must free it for the next lap, or the next push sees a full ring.',
      link: QUEUES,
    },
    r2: {
      text: 'The message says which step broke: the refusal, the value returned, or the push after the pop. In lib.rs, check_backpressure fills 4 slots, overflows once, pops once and pushes again. Look at the number your pop stores.',
      fn: 'check_backpressure',
    },
  },

  wraparound: {
    checkId: 'wraparound',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It runs 1,000 laps of a 4-slot ring, and each lap pushes four values and then pops four.',
        'Every pop has to return the next number in the count, so no lap may hand back an old value.',
        'A failed push or a wrong pop names the lap. The cursors count up for ever and only the slot index wraps.',
      ],
    },
    r1: {
      text: 'Cursors count up for ever; only the slot index wraps. The sequence number is how a slot knows which lap it is on. After a pop at position h, the next push to that slot comes at h + capacity, so the pop must write exactly that. Any other number makes the slot look like last lap’s.',
      link: QUEUES,
    },
    r2: {
      text: 'The message names the cycle. In lib.rs, check_wraparound runs 1,000 laps of 4 pushes and 4 pops. Compare the number your pop writes with the position the next lap’s push will wait for.',
      fn: 'check_wraparound',
    },
  },

  model_gauntlet: {
    checkId: 'model_gauntlet',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It draws a ring of 4, 8, 16 or 32 slots and a push share of 40 to 64 percent from the seed.',
        'It runs 3,000 random pushes and pops, and shadows every one with a plain double-ended queue.',
        'Every Ok, every Err(v) and every popped value has to match the model, and the first mismatch fails with its op number.',
      ],
    },
    r1: {
      text: 'A random run is only as good as its model. The harness keeps a plain queue beside yours and wants the same answer to every push and pop, refusals included. If this fails while the earlier checks pass, a rare branch is wrong: a full ring in the middle of a run, or a pop right after a push.',
      link: DECISION,
    },
    r2: {
      text: 'The message gives the op number and what disagreed with the model. In lib.rs, check_model_gauntlet draws the ring size and push share from the seed. Look at rings of 4 to 32 slots, and at the full and empty edges.',
      fn: 'check_model_gauntlet',
    },
  },

  slot_conservation: {
    checkId: 'slot_conservation',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It fills a 16-slot ring with 16 values and pops all 16, and it does that 100 times.',
        'Every push in every lap has to succeed, and every pop has to find a value.',
        'A ring that loses one slot now and then runs out of slots well before lap 100, and the message names the lap.',
      ],
    },
    r1: {
      text: 'Every slot has to come back every lap. A pop that skips its release, or writes the wrong sequence number now and then, loses a slot, and the ring shrinks by one each time. Fill and drain enough laps and a lost slot shows as a push that fails on a ring that should have room.',
      link: QUEUES,
    },
    r2: {
      text: 'The message names the lap and the push or pop that failed. In lib.rs, check_slot_conservation fills and drains 16 slots 100 times. Look for a path through your pop that returns without writing the sequence number.',
      fn: 'check_slot_conservation',
    },
  },

  burst_model: {
    checkId: 'burst_model',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It draws a ring of 8, 16 or 32 slots and alternates floods of pushes with partial drains of pops, for 2,000 ops.',
        'A flood is up to one and a half times the capacity, so some pushes land on a full ring and must be refused.',
        'A drain is up to half the capacity. The model decides every push, so a false full or a phantom slot fails.',
      ],
    },
    r1: {
      text: 'Real traffic comes in floods. A push into a full ring must be refused exactly when the model is full, so a false full or a phantom slot at the edge of a burst fails. Cursors and sequence numbers must still agree after the flood, because the pops that follow rely on them.',
      link: DECISION,
    },
    r2: {
      text: 'The message gives the op where your queue and the model split. In lib.rs, check_burst_model floods a ring of 8 to 32 slots past its capacity, then drains part. Check the full case at the edge of a flood.',
      fn: 'check_burst_model',
    },
  },
}
