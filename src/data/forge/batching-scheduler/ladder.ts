/**
 * Lab 06's authored hint ladder (H3, docs/specs/wave-1.md §13.2; wave-3.md §8.2): three rungs for each of the six
 * required checks, and then the H2 packet. The rules every lab shares (unlocking, the reducer, the ledger refs, the
 * "ask a human" link) live in src/lib/forge/ladder.ts; this module binds lab 06's id.
 *
 * Labs 04 to 08 are faded (D13): R0 (the teach-back and its three ideas), R1 (the concept, with an H2 anchor in the
 * host lesson) and R2 (where to look: a function that exists in `lib.rs`). The bundle sets `fade: 'r2'`, so there is
 * no R3, no R4 and no bottom-out; after R2 the page offers the packet (`AskPacket`). Lab 06 is outside the
 * ladder-or-packet experiment (`RANDOMIZED_LABS` stays labs 01 to 03).
 *
 * Pure data and pure functions: the component (src/components/forge/HintLadder.tsx) owns the clock and the ledger, and
 * scripts/lint-mentor.ts (`bun run verify:mentor`) holds every authored rung to its limits. Every fact below is read
 * from `labs/batching-scheduler/src/lib.rs`: the scenarios (`scn_light_seeded`, `scn_burst`, `scn_convoy`,
 * `scn_starvation_seeded`, `scn_fleet`, `scn_burstgpt`, `scn_lmsys_shape`), the check bodies and their thresholds.
 */

import type { HintRef } from '@/lib/ledger/types'
import { hintRef as hintRefOf, restoreState as restoreStateOf, type Ctx, type LadderState, type RungId } from '@/lib/forge/ladder'
import type { CheckLadder, LessonLink } from '../types'

export const LAB_ID = 'batching-scheduler'

/** The title prefix of lab 06's Ask-a-human posts. */
export const DISCUSSIONS_LABEL = '[lab 06]'

/** `ack hint:batching-scheduler/<check>#R<n>`. */
export const hintRef = (checkId: string, rung: RungId): HintRef => hintRefOf(checkId, rung, LAB_ID)

/** A state rebuilt from the ledger's acks, for this lab. */
export const restoreState = (acks: Readonly<Record<string, string>>, checkId: string, ctx: Ctx): LadderState =>
  restoreStateOf(acks, checkId, { ...ctx, labId: LAB_ID })

export const R0_PROMPT = 'In two sentences: what does this check do to your scheduler, and what did yours do?'

const LOOP: LessonLink = {
  lessonId: 't5.l7',
  h2: 'The scheduler loop, in systems vocabulary',
  anchor: 'the-scheduler-loop-in-systems-vocabulary',
}
const METRICS: LessonLink = { lessonId: 't5.l3', h2: 'The metrics, defined properly', anchor: 'the-metrics-defined-properly' }
const ADMISSION: LessonLink = {
  lessonId: 't2.l4',
  h2: 'Admission control: the scheduler\'s other half',
  anchor: 'admission-control-the-scheduler-s-other-half',
}
const ZOO: LessonLink = { lessonId: 't2.l4', h2: 'The policy zoo, compressed', anchor: 'the-policy-zoo-compressed' }

/** The required checks, in the order the module lists them and the page grades them. */
export const LADDER_CHECK_IDS = ['runs_clean', 'slo_light', 'burst', 'convoy', 'starvation', 'goodput_score'] as const

export const LADDER: Record<string, CheckLadder> = {
  runs_clean: {
    checkId: 'runs_clean',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It plays 20 light requests, spread over 200 iterations, through your schedule on 8 slots and 8,192 tokens of memory.',
        'It fails at once on an illegal action: an id that is not waiting, too many running, or resident tokens pushed over the cap.',
        'It also fails if fewer than 20 requests complete, which is what an admit list that is always empty gives.',
      ],
    },
    r1: {
      text: 'Each call gives you the waiting and running lists and wants two id lists back. Admit only a waiting id, while a slot is free and its whole prompt fits under the cap minus what is resident. Resident means prompt plus decoded tokens, summed over the running requests.',
      link: LOOP,
    },
    r2: {
      text: 'The message names the illegal action or the count that finished. In lib.rs, check_runs_clean plays the light load through your schedule in scheduler.rs. Does your admit list ever hold an id that fits?',
      fn: 'check_runs_clean',
    },
  },

  slo_light: {
    checkId: 'slo_light',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It replays the same kind of light load and counts the requests whose first token lands within 40 iterations of arrival.',
        'It needs at least 95 percent of them, which is 19 of the 20 requests.',
        'A scheduler that waits for the batch to empty, or admits too few per call, misses the bound although the load is light.',
      ],
    },
    r1: {
      text: 'Time to first token counts from arrival: the wait for a slot, then a prefill of the prompt over 128 tokens, rounded up, iterations. On a light load nobody has to wait, so admit every request that fits as soon as it arrives, even while others run.',
      link: METRICS,
    },
    r2: {
      text: 'The message gives the goodput and the TTFT p95. In lib.rs, check_slo_light compares the share that met the bound. Look at when your schedule admits a request: on its first call, or on a later one?',
      fn: 'check_slo_light',
    },
  },

  burst: {
    checkId: 'burst',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It drops 48 requests into the first 6 iterations, on 24 slots and 8,192 tokens, with a first-token bound of 90 iterations.',
        'It needs at least 90 percent of them, 44 of 48, to get their first token inside the bound.',
        'It fails a scheduler that admits one request per call, and one whose headroom per sequence keeps the batch tiny.',
      ],
    },
    r1: {
      text: 'A burst is absorbed by filling the batch every call. Walk the whole waiting list, admit each request that still fits, and keep a running total of tokens as you go. One admit per call lets the queue outgrow the bound; a huge headroom per sequence stops the batch filling.',
      link: ADMISSION,
    },
    r2: {
      text: 'The message gives the goodput under the burst. In lib.rs, check_burst runs the 48-request table. Does your loop in scheduler.rs stop after its first admit, or once the headroom has used up the cap?',
      fn: 'check_burst',
    },
  },

  convoy: {
    checkId: 'convoy',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It sends an 8,192-token whale and 88 short requests of 128 tokens at iteration 0, with room for 12,288 tokens.',
        'Memory holds the whale or all the shorts, not both, and the first token has to land within 40 iterations.',
        'It needs 85 of the 89 inside the bound and the whale finished, so first-come-first-served and largest-first fail.',
      ],
    },
    r1: {
      text: 'Whoever enters first holds the memory. Admit the smallest prompts first and the shorts all fit and finish quickly; the whale fits once they leave, so it completes late but completes. Sort the waiting list by prompt size, ties by arrival, before the loop walks it.',
      link: ZOO,
    },
    r2: {
      text: 'The message counts how many met the bound, or says the whale never finished. In lib.rs, check_convoy runs this one trace. Check the order your schedule in scheduler.rs walks the waiting list in.',
      fn: 'check_convoy',
    },
  },

  starvation: {
    checkId: 'starvation',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It starts three 1,024-token requests at iteration 0, then feeds short requests for 2,000 iterations, on 5 slots.',
        'It needs all three long requests to complete, and at least 100 requests in all.',
        'Pure smallest-first fails it: a short request is always ahead of a long one, so the longs never reach the front.',
      ],
    },
    r1: {
      text: 'Priority must grow with waiting. Pick an age, somewhere from 900 to 1,600 iterations, past which a request jumps to the front, oldest first. Everyone younger stays in smallest-first order. Without aging, a long request never reaches the front while shorts keep arriving.',
      link: LOOP,
    },
    r2: {
      text: 'The message says how many of the three longs completed. In lib.rs, check_starvation counts them. Where does your sort in scheduler.rs read a waiting request’s age, the iteration minus its arrival?',
      fn: 'check_starvation',
    },
  },

  goodput_score: {
    checkId: 'goodput_score',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It replays three fixed traces: a 400-request synthetic overload, 480 BurstGPT requests and a 360-request LMSYS-shaped mix.',
        'Each trace must clear its own goodput floor: 55, 85 and 70 percent.',
        'The earlier checks do not guarantee it: first-come-first-served, largest-first and a huge headroom each miss a floor.',
      ],
    },
    r1: {
      text: 'Goodput is the share of requests whose first token lands inside the bound, so a request that finishes late counts for nothing. The reference shape clears every floor: old requests first, then smallest prompt first, admitting what fits with a small headroom. Tune the headroom and the age only if one trace misses.',
      link: METRICS,
    },
    r2: {
      text: 'The message names the trace that missed and its goodput. In lib.rs, check_goodput_score replays all three. Running the calibrate example with --mine prints your three scores.',
      fn: 'check_goodput_score',
    },
  },
}
