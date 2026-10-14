/**
 * Lab 05's authored hint ladder (docs/specs/wave-3.md §8.2, D13 and D26): a faded ladder, R0 to R2 for each of the six
 * required checks. R0 is the teach-back and its three ideas, R1 the concept with an anchor in the host lesson (for
 * nested_spawn, the readiness lesson r.l8: see `SHORT_GUARD`), R2 where to look: a function that exists in the zip's
 * `src/lib.rs`. After R2 the page offers the H2 packet (`AskPacket`), as in the ladder arm; there is no R3, R4 or
 * bottom-out, and `ForgeBundle.fade` says so. The rules every lab shares
 * (unlocking, the reducer, the ledger refs, the "ask a human" link) live in src/lib/forge/ladder.ts.
 *
 * Pure data: the component (src/components/forge/HintLadder.tsx) owns the clock and the ledger, and
 * scripts/lint-mentor.ts (`bun run verify:mentor`) holds every authored rung to its limits.
 */

import type { CheckLadder, LessonLink } from '../types'

export const LAB_ID = 'toy-executor'

/** The title prefix of lab 05's Ask-a-human posts. */
export const DISCUSSIONS_LABEL = '[lab 05]'

export const R0_PROMPT = 'In two sentences: what does this check do to your executor, and what did yours do?'

/** Lesson t3.l4's H2s, by the id the lesson page gives them. */
const POLL_LOOP: LessonLink = {
  lessonId: 't3.l4',
  h2: 'Half two: the waker, and 50 lines of executor',
  anchor: 'half-two-the-waker-and-50-lines-of-executor',
}
const TOY_TO_TOKIO: LessonLink = { lessonId: 't3.l4', h2: 'From the toy to tokio', anchor: 'from-the-toy-to-tokio' }
/**
 * Lesson r.l8's H2 on guards that end with their statement. nested_spawn's R1 is about a `RefCell` borrow held across a
 * poll, and no H2 of the host lesson t3.l4 teaches a borrow's scope (its executor uses a `Mutex` and never says why the
 * lock ends before the poll), so that one rung links lab 05's readiness lesson instead (labs.ts `readiness`: R7, R8).
 */
const SHORT_GUARD: LessonLink = { lessonId: 'r.l8', h2: 'Make the guard shorter', anchor: 'make-the-guard-shorter' }

/** The required checks, in the order the module lists them and the page grades them. */
export const LADDER_CHECK_IDS = ['block_on', 'fifo_poll', 'pending_repoll', 'ping_pong', 'many_tasks', 'nested_spawn'] as const

export const LADDER: Record<string, CheckLadder> = {
  block_on: {
    checkId: 'block_on',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It runs `block_on` on a future that is ready at once, and on one that returns Pending once and wakes itself.',
        'It fails if either value is lost: 42 from the first future, 7 from the second.',
        'After a Pending, the wake queues the task again, and `block_on` has to keep running until the Output is stored.',
      ],
    },
    r1: {
      text: 'A future advances only when something polls it, and `block_on` is the smallest something. It spawns one wrapper task that awaits your future and stores the Output, runs the queue until it is empty, then takes the stored value. A Pending future that woke itself is back on the queue, so the same loop polls it again.',
      link: POLL_LOOP,
    },
    r2: {
      text: 'The message says which of the two futures lost its value. In lib.rs, check_block_on runs both. Does your `run` put a Pending future back into its task, and does it keep looping until the queue is empty?',
      fn: 'check_block_on',
    },
  },

  fifo_poll: {
    checkId: 'fifo_poll',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It spawns 3 to 8 tasks that yield 0 to 3 times each, and each task logs its id on every poll.',
        'It fails unless the log is what a plain queue gives: spawn order first, then wake order, with `run()` returning the log’s length.',
        'A wake pushes to the back and `run` pops from the front, so the task that has waited longest goes first.',
      ],
    },
    r1: {
      text: 'A run queue is first in, first out. Spawn pushes to the back, a wake pushes to the back, and `run` pops from the front. Each round then visits the pending tasks in the order they were queued. Pop from the back instead and the newest task is polled again at once, while the older ones wait behind it.',
      link: POLL_LOOP,
    },
    r2: {
      text: 'The message prints your poll order beside the wanted one. In lib.rs, check_fifo_poll builds the wanted order from a plain queue. Compare which end your `run` pops from, and whether it counts every pop or only real polls.',
      fn: 'check_fifo_poll',
    },
  },

  pending_repoll: {
    checkId: 'pending_repoll',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'Part one polls a future that yields three times. Part two parks a task on a gate that another task opens.',
        'It fails if the first future is not polled exactly 4 times, or if the parked task is polled any number of times but 2.',
        'A task that returned Pending is polled again only when something wakes it. The loop never re-queues it on its own.',
      ],
    },
    r1: {
      text: 'Pending means not yet, and a wake is the only thing that says now. If `run` pushes every Pending task back itself, a task parked on a gate is polled again at once, and on every round until the gate opens: a core burned per idle task. The waker does the re-queue. The loop only stores the future back.',
      link: POLL_LOOP,
    },
    r2: {
      text: 'The message counts how many times the parked task was polled. In lib.rs, check_pending_repoll has both parts. Look at what your `run` does on Poll::Pending: it should store the future back in its task and queue nothing.',
      fn: 'check_pending_repoll',
    },
  },

  ping_pong: {
    checkId: 'ping_pong',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'Two tasks take turns 100 times. Each stores its own waker for the other to use, and wakes the other one’s.',
        'It fails unless the count reaches 100 and both tasks see that it is done.',
        'The stored waker fires inside the other task’s poll, so `run` must still look at the queue after that poll.',
      ],
    },
    r1: {
      text: 'A reactor is a table of stored wakers, and an event calls one. Here the table has two entries, and each task wakes the other from inside its own poll. That wake pushes onto the queue `run` is draining right now. A loop that works from a copy of the queue never sees it, and the exchange stops.',
      link: TOY_TO_TOKIO,
    },
    r2: {
      text: 'The message shows the count and which tasks finished. In lib.rs, check_ping_pong stores a waker per task. Check that `run` reads the queue again after every poll, and that no wake made during a poll is lost.',
      fn: 'check_ping_pong',
    },
  },

  many_tasks: {
    checkId: 'many_tasks',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It spawns 1000 tasks whose yields are a seeded shuffle of 200 each of 0, 1, 2, 3 and 4.',
        'It fails if fewer than 1000 tasks finish, or if `run()` does not report exactly 3000 polls.',
        'Each task is polled once per yield and once to finish: 2000 yields plus 1000 tasks. Any other count means a lost or repeated poll.',
      ],
    },
    r1: {
      text: 'Nothing new is needed here: it is the same loop at scale, where a small mistake repeats a thousand times. A task dropped while Pending is a lost task, and a poll made without a wake pushes the count above 3000. Keep each future in its task until it is Ready, and count only real polls.',
      link: TOY_TO_TOKIO,
    },
    r2: {
      text: 'The message shows how many tasks finished or how many polls ran. In lib.rs, check_many_tasks works out the wanted 3000 from the yields. Lost tasks: look at where a Pending future goes. A high count: look at what you count.',
      fn: 'check_many_tasks',
    },
  },

  nested_spawn: {
    checkId: 'nested_spawn',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'A parent task spawns 3 to 8 children from inside its own poll, and some of the children spawn grandchildren the same way.',
        'It fails unless every child and grandchild runs, and `run()` reports the number of polls the whole tree needs.',
        '`spawn` pushes onto the live queue while `run` is in the middle of its loop, so `run` must not hold the queue borrowed during a poll.',
      ],
    },
    r1: {
      text: 'Tasks can spawn tasks, so `spawn` runs while `run` is polling. If `run` still holds the queue’s `RefCell` borrow, the spawn panics. If `run` works from a copy, the new tasks are never visited. End the borrow in its own statement, then read the live queue again on each turn.',
      link: SHORT_GUARD,
    },
    r2: {
      text: 'The message counts the children and grandchildren that ran. In lib.rs, check_nested_spawn builds the tree inside a poll. Look at how your `run` pops: is the borrow gone before the poll, and does each turn read the live queue?',
      fn: 'check_nested_spawn',
    },
  },
}
