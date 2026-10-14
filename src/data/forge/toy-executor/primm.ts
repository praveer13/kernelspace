/**
 * Lab 05 (toy-executor) in PRIMM stages (docs/specs/wave-3.md §8.2): Predict, Run, Investigate, Modify, Make.
 *
 * Pure data and pure functions (no DOM, no clock, no storage), in the shape of the Forge bundle contract:
 *   1. the stage table of the Make step (`STAGES`), the same four stages as `executor.rs` and labs.ts;
 *   2. the reference run (`RUN_SPEC`): the crate's own `probe 7` reply, as `labs/toy-executor/calibration.json`
 *      committed it, replayed one frame per poll round;
 *   3. the items: what the learner predicts, investigates and modifies (`PRIMM_ITEMS`). Each one is the ledger ref
 *      `item:lab05.primm.<id>`.
 *
 * The committed reply names the task count, the yield total, the poll count and the first twelve polls. The page
 * needs each task's yields to draw rounds, so it asks the harness's own generator for them (`HarnessRng`, the port of
 * kslab's `Rng` that lab 03 already uses) and holds the result to the reply: tests/forge/toy-executor.test.ts checks
 * the task count, the yield total, the poll count and the twelve polls against the committed line. The run is not a
 * check and does not use the learner's executor: it is a labelled replay of the reference on one seed.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { AuthoredItem } from '@/lib/items/types'
import { HarnessRng } from '@/lib/world/bpe'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, ReferenceRunSpec, RunConfig, RunFrame, RunResult, StageInfo } from '../types'

export const PRIMM_LAB = 'toy-executor'

const FUTURES = 't3.futures-state-machines'
const WAKERS = 't3.wakers-executor'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/** The stage markers in `labs/toy-executor/src/executor.rs`. Which checks belong to which stage comes from labs.ts. */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'Queue and loop', minutes: 2, goal: 'A queue, `spawn`, a `run` that takes a future out, polls it and puts it back, and `block_on`. The two-minute win.' },
  { n: 2, title: 'Order and count', minutes: 15, goal: 'Wakeups run in FIFO order, `run()` counts only real polls, and the loop never re-queues a Pending task itself.' },
  { n: 3, title: 'Live queue', minutes: 20, goal: 'A wake or a spawn made during a poll is run by the same `run()`: read the queue again every turn.' },
  { n: 4, title: 'Scale', minutes: 5, goal: 'No new code: 1,000 tasks, exactly 3,000 polls, none lost.' },
]

/* ------------------------------------------------------------------ */
/* The reference run: the committed `probe 7`, one frame per poll round */
/* ------------------------------------------------------------------ */

/** The seed of the committed probe line. */
export const PROBE_SEED = 7

/** `probe 7` on the reference executor, verbatim from `labs/toy-executor/calibration.json` (`probe.reply`). */
export const SEED7_REPLY = 'tasks=10 yields=25 polls=35 model_polls=35 first_polls=1,2,3,4,5,6,7,8,9,10,1,2'

export interface ProbeLine {
  tasks: number
  yields: number
  polls: number
  modelPolls: number
  /** Task ids (1-based, in spawn order) of the first polls, as many as the line lists. */
  firstPolls: number[]
}

/** Reads a `probe` reply; undefined when it is not the line `lib.rs` prints. */
export function parseProbe(reply: string): ProbeLine | undefined {
  const m = /^tasks=(\d+) yields=(\d+) polls=(\d+) model_polls=(\d+) first_polls=([\d,]*)$/.exec(reply.trim())
  if (m === null) return undefined
  return {
    tasks: Number(m[1]),
    yields: Number(m[2]),
    polls: Number(m[3]),
    modelPolls: Number(m[4]),
    firstPolls: m[5] === '' ? [] : m[5].split(',').map(Number),
  }
}

/**
 * The yields of the tasks `probe <seed>` spawns, in spawn order: the harness's generator draws the task count with
 * `range(6, 12)`, then one `below(5)` per task, exactly as `probe` in `lib.rs` does.
 */
export function probeYields(seed: number = PROBE_SEED): number[] {
  const rng = new HarnessRng(seed)
  const n = rng.range(6, 12)
  return Array.from({ length: n }, () => rng.below(5))
}

/** One round of a FIFO run: every task still alive is polled once, in queue order. */
export interface PollRound {
  /** Task ids (1-based, in spawn order) polled in this round, in poll order. */
  polled: number[]
  /** The ones among them that returned Ready. */
  finished: number[]
}

/**
 * A correct executor on tasks that wake themselves `yields[i]` times and then finish: round k polls, in queue order,
 * every task that has not finished, and the ones that return Pending have woken themselves to the back of the queue
 * for round k + 1. This is `model_poll_order` in `lib.rs`, cut at the round borders.
 */
export function pollRounds(yields: readonly number[]): PollRound[] {
  let queue = yields.map((left, i) => ({ id: i + 1, left }))
  const rounds: PollRound[] = []
  while (queue.length > 0) {
    const polled = queue.map((t) => t.id)
    const finished = queue.filter((t) => t.left === 0).map((t) => t.id)
    queue = queue.filter((t) => t.left > 0).map((t) => ({ id: t.id, left: t.left - 1 }))
    rounds.push({ polled, finished })
  }
  return rounds
}

/** The Run step's reference: the committed line's tasks as they are. */
export const REFERENCE: RunConfig = { tasks: 10, more: 0, reverse: false }

const clamp = (config: RunConfig, key: string, lo: number, hi: number, fallback: number): number => {
  const n = Math.round(Number(config[key]))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/**
 * The yields of a config: the first `tasks` tasks of `probe 7`, each yielding `more` extra times, spawned in the
 * opposite order when `reverse` is on.
 */
export function yieldsOf(config: RunConfig): number[] {
  const base = probeYields()
  const tasks = clamp(config, 'tasks', 1, base.length, base.length)
  const more = clamp(config, 'more', 0, 4, 0)
  const ys = base.slice(0, tasks).map((y) => y + more)
  return config.reverse === true ? ys.reverse() : ys
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
const isReference = (config: RunConfig): boolean => yieldsOf(config).join() === probeYields().join()

/** What `ReferenceRun` shows for a config: one frame per poll round, one cell per task. */
function runResult(config: RunConfig): RunResult {
  const yields = yieldsOf(config)
  const rounds = pollRounds(yields)
  const n = yields.length
  const total = n + sum(yields)
  const done = new Array<boolean>(n).fill(false)
  let polls = 0
  const frames: RunFrame[] = rounds.map((round, k) => {
    polls += round.polled.length
    for (const id of round.finished) done[id - 1] = true
    const finished = done.filter(Boolean).length
    const queued = n - finished
    return {
      op: polls,
      cells: done.map((d) => (d ? 100 : 30)),
      stats: [
        { label: 'round', value: `${k + 1} of ${rounds.length}` },
        { label: 'polls so far', value: String(polls) },
        { label: 'tasks finished', value: `${finished} of ${n}` },
        { label: 'queued for next round', value: String(queued) },
      ],
      alt: `After round ${k + 1} of ${rounds.length}: ${polls} polls so far, ${finished} of ${n} tasks finished and ${queued} queued for the next round. One cell per task, dark when finished.`,
    }
  })
  const yieldTotal = sum(yields)
  return {
    config,
    total: polls,
    value: polls,
    // The FIFO model's count, `model_polls` in the probe line: one poll per yield and one more to finish, for every task.
    truth: total,
    clean: polls === total,
    frames,
    summary: `${n} tasks that yield ${yieldTotal} times in all take ${polls} polls in ${rounds.length} rounds: one poll for every yield and one more for each task to finish.`,
  }
}

/** The Run step's own item: the reference run's observed poll count. An observation, not an answer: no KCs. */
export const RUN_ITEM = { id: 'lab05.primm.r1', nsec: 45 }

/** Lab 05's Run and Modify steps as data: the bundle's `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) => {
    const tasks = yieldsOf(config)
    return isReference(config)
      ? `The reference on seed ${PROBE_SEED}: ${tasks.length} tasks, ${sum(tasks)} yields`
      : `The reference on seed ${PROBE_SEED}, changed: ${tasks.length} tasks, ${sum(tasks)} yields`
  },
  disclaimer: `This replays the reference executor’s committed probe line for seed ${PROBE_SEED} (${SEED7_REPLY}). The page redraws each task’s yields from the harness’s generator and shows them round by round. It is not a check, and your executor is not in it.`,
  reference: REFERENCE,
  run: runResult,
  modify: {
    lead: `Change one thing about the reference run (seed ${PROBE_SEED}: 10 tasks, 25 yields, 35 polls).`,
    dials: [
      { id: 'more1', label: 'every task yields one more time', config: { tasks: 10, more: 1, reverse: false } },
      { id: 'first5', label: 'only the first 5 tasks are spawned', config: { tasks: 5, more: 0, reverse: false } },
      { id: 'reverse', label: 'the same 10 tasks are spawned in the opposite order', config: { tasks: 10, more: 0, reverse: true } },
    ],
  },
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

type KcList = AuthoredItem['kcs']

const choice = (
  id: string,
  step: ChoicePrimm['step'],
  kcs: KcList,
  q: Omit<QuizQuestion, 'kcs'>,
  nsec = 45,
): ChoicePrimm => ({ kind: 'choice', id, step, nsec, item: { id, kcs, q: { ...q, kcs: [...kcs] } } })

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab05.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: [WAKERS],
    prompt:
      'The crate’s `probe 7` spawns 10 tasks. Each one wakes itself and returns Pending a few times before it finishes, 25 times in all across the 10 tasks. The reference executor runs them to the end. How many polls does `run()` execute?',
    unit: 'polls',
    factor: 1.15,
    explain:
      'A task is polled once for every time it returns Pending, and once more when it finishes, so the polls are the tasks plus the yields: 10 + 25 = 35. Forgetting each task’s last poll gives 25. The lab’s `many_tasks` is the same sum at scale: 1,000 tasks that yield 2,000 times in all make exactly 3,000 polls.',
  },
  choice('lab05.primm.p2', 'predict', [WAKERS], {
    q: 'Your `run()` pops each task from the back of the queue instead of the front, so the queue acts as a stack. Wakes still push to the back. Which checks go red?',
    options: [
      '`fifo_poll` by itself, since it is the one check that compares the order of the polls',
      '`fifo_poll` and `pending_repoll`, since the stack changes the order and when the parked task first runs',
      '`block_on` and `many_tasks`, since both depend on each task being found in the queue and run through it',
      'No check goes red, since each task is still polled once per yield and the totals stay right too',
    ],
    correct: [1],
    why: [
      '`pending_repoll` goes red too. A stack runs the gate’s opener, the last task spawned, to its end before the parked task has been polled once. The parked task then finds the gate open and is polled once, not twice.',
      'The stack polls the newest task again and again, so `fifo_poll` sees a wrong order. The opener also finishes before the waiter first runs, so the waiter is polled once where the check wants 2: `pending_repoll` is red as well.',
      '`block_on` runs one task and `many_tasks` only counts polls. A stack makes the same number of polls in another order, so both stay green.',
      'The counts are right, which is why `many_tasks` stays green. But `fifo_poll` compares the exact order of the polls, and a stack is not first in, first out.',
    ],
    explanation:
      'A stack and a queue make the same number of polls in a different order. Counting checks stay green; `fifo_poll` reads the order, and `pending_repoll` depends on the parked task running before its opener finishes.',
  }),

  /* ---- Investigate: the harness ---- */
  {
    kind: 'numeric',
    id: 'lab05.primm.i1',
    step: 'investigate',
    nsec: 45,
    kcs: [FUTURES, WAKERS],
    prompt:
      'In `pending_repoll`, one task parks on a gate: it stores its waker, returns Pending and does not wake itself. A second task yields 3 times, then opens the gate and wakes the waiting task. How many times is the waiting task polled by a correct executor?',
    unit: 'polls',
    truth: 2,
    lures: [
      { value: 1, miss: 'exec.wake-dropped', message: 'One poll means the task parked and was never run again. The opener’s wake puts it back on the queue for a second poll.' },
      { value: 3, miss: 'exec.counted-opener', message: 'Three is how often the other task yields. The waiting task does not wake itself, so its polls depend only on the one wake it gets.' },
      { value: 4, miss: 'exec.requeue-pending', message: 'Four is what a loop that puts every Pending task back itself gives: the parked task is polled again at once and on every round until the gate opens.' },
    ],
    explain: 'The waiting task is polled once to park, then not again until the opener wakes it; that second poll finds the gate open and it finishes. Together with the opener’s 4 polls, `run()` reports 6.',
  },
  choice('lab05.primm.i2', 'investigate', [FUTURES, WAKERS], {
    q: 'Your `run` pops its next task in the head of a `while let`, with `queue.borrow_mut().pop_front()`, so the guard lives through the whole loop body. Everything else is correct. Which check is the first to go red, in the order the page lists them?',
    options: [
      '`block_on`, since its second future wakes itself and meets a queue that `run` has borrowed',
      '`fifo_poll`, since the borrow delays each wake and the poll order comes out wrong',
      '`nested_spawn`, since it is the one check where a task spawns into the queue during a poll',
      'No check goes red, since the compiler rejects a borrow that lasts through the loop body',
    ],
    correct: [0],
    why: [
      'The `while let` keeps its `RefMut` alive for the whole body. The second part of `block_on` polls a future that calls `wake_by_ref`, which needs `borrow_mut` on the same queue, and `RefCell` panics with "already borrowed".',
      'The wake does not arrive late: it panics. And `block_on` comes first in the list, so it is red before `fifo_poll` runs.',
      '`nested_spawn` fails this way too, but a plain wake is enough to trigger the panic, and the first check with a wake is `block_on`.',
      '`RefCell` checks its borrows at run time, not at compile time. The code compiles, and the panic happens when the first wake needs the queue.',
    ],
    explanation: 'A `RefCell` guard that lives in the loop’s head lasts as long as the body. Take the borrow in its own statement so the `RefMut` is gone before the poll.',
  }),
  choice('lab05.primm.i3', 'investigate', [WAKERS], {
    q: 'Your `run` copies the queue’s tasks into a list once, polls each task in that list one time and returns. In `nested_spawn`, the parent task spawns its children from inside its poll. What does the check report?',
    options: [
      'That the children ran but the grandchildren did not, since the children were polled once and spawned theirs late',
      'That none of them ran, since they were queued after the list was made and `run` returned first',
      'A panic, since `spawn` needs the queue while `run` still holds a borrow of it for the copy',
      'That they all ran, since `spawn` pushes onto the same queue that `run` started from',
    ],
    correct: [1],
    why: [
      'The children never run either. They are spawned during the parent’s poll, after the list was made, and nothing looks at the queue again.',
      'The check reports "0 of 6 children and 0 of 7 grandchildren ran" (the counts change with the seed). `spawn` does push onto the live queue, but a loop over a copy never reads the live queue again.',
      'The copy is made in one statement and the borrow ends with it, before any poll starts, so `spawn` finds the queue free. This is a missing run, not a panic.',
      '`spawn` does write to the live queue, but `run` reads only its copy, so the new tasks stay in the queue unrun when `run()` returns.',
    ],
    explanation: 'The queue has to be read again on every turn. A wake or a spawn made during a poll lands in the live queue, and only a loop that looks at the live queue will run it.',
  }),

  /* ---- Modify: one dial, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab05.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: [WAKERS],
    prompt: 'The reference run makes 35 polls. How many polls does your changed run make?',
    unit: 'polls',
    factor: 1.1,
    explain:
      'The polls are the tasks plus the yields. One more yield for each of 10 tasks adds 10 polls (45). Five tasks keep their 2 + 2 + 1 + 4 + 1 = 10 yields and add 5 final polls (15). Spawning in the opposite order changes who is polled when, not how many polls there are (35).',
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, count the polls of ten self-waking tasks, and say which checks go red when the queue is a stack.' },
  { id: 'run', title: 'Run', blurb: 'Watch the reference executor’s committed seed-7 run, one frame per round of polls.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Three questions about parked tasks, borrows and the live queue.' },
  { id: 'modify', title: 'Modify', blurb: 'Change the tasks of the run, predict the poll count, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the executor in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { NumberPrimm }
