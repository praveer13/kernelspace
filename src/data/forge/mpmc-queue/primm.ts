/**
 * Lab 04 in PRIMM stages (docs/specs/wave-3.md §8.2, task 3b-10): Predict, Run, Investigate, Modify, Make.
 *
 * Three jobs live here, all pure (no DOM, no clock, no storage):
 *   1. the stage table of the Make step (`STAGES`, `stageRows`, `attemptsToGreen`);
 *   2. the in-browser reference run: one bursty load on the Fleet's own reference queue (`makeRefQueue`, `runBursts`);
 *   3. the items: what the learner predicts, investigates and modifies (`PRIMM_ITEMS`). Each one is the ledger ref
 *      `item:lab04.primm.<id>`; grading and the ledger payload are the shared ones in src/lib/forge/primm.ts.
 *
 * The reference run is NOT the lab's `burst_model`. It is a labelled stand-in: the Fleet's array-backed FIFO, drawn
 * on its own seed, with the slot of each value worked out as a ring would place it (the position's remainder after
 * dividing by the capacity). Every number here is a property of that run and is synthetic. Items 2 and 3 of the
 * investigate step read the checks' behaviour from labs/mpmc-queue/calibration.json (which check catches which mutant).
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { ForgeLabCheck } from '@/data/labs'
import { attemptsToGreen as attemptsToGreenOf, observationResponse, stageRows as stageRowsOf } from '@/lib/forge/primm'
import { makeRefQueue } from '@/lib/fleet-model'
import type { AuthoredItem } from '@/lib/items/types'
import type { ItemResponse } from '@/lib/ledger/types'
import { splitmix32u } from '@/lib/rng'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, PrimmStepId, ReferenceRunSpec, RunConfig, RunResult, StageInfo } from '../types'

// The shapes live in ../types (the Forge bundle contract), and what PRIMM does for every lab lives in
// src/lib/forge/primm.ts; both are re-exported here, as lab 02's module does.
export type { ChoicePrimm, NumberPrimm, PrimmItem, StageInfo }
export { currentStage, gradeChoice, gradeNumber, greenStage, itemRev, itemResponse, predictGraded, primmRef } from '@/lib/forge/primm'
export type { PrimmAnswer, PrimmGrade, StageRow } from '@/lib/forge/primm'

export const PRIMM_LAB = 'mpmc-queue'

/** The KCs of lab 04's checks (src/data/labs.ts): the queue and its lock-free claim, and the lap a slot carries. */
const MUTEX_ATOMICS = 't2.mutex-atomics'
const ABA = 't2.aba'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/**
 * The stage markers in `labs/mpmc-queue/src/queue.rs`. Which checks belong to which stage comes from labs.ts: stage 1
 * is `fifo`, 2 `backpressure`, 3 `wraparound` and `slot_conservation`, 4 `model_gauntlet` and `burst_model`.
 */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'The ring', minutes: 20, goal: 'A ring of slots with sequence numbers, and `push` and `pop` on one thread that claim a position by compare-exchange.' },
  { n: 2, title: 'Backpressure', minutes: 10, goal: 'A full ring hands `Err(v)` back with the caller’s own value, and `pop` frees its slot for the next lap.' },
  { n: 3, title: 'Laps', minutes: 10, goal: 'Nothing new to write: the release must hold over a thousand laps of the ring, and no slot may be lost.' },
  { n: 4, title: 'The model', minutes: 15, goal: '3,000 and 2,000 random operations agree with a plain queue on every Ok, Err and value.' },
]

/** The stages with their checks (labs.ts `stage`) and which of them passed: the shared `stageRows`, bound to lab 04's stages. */
export const stageRows = (checks: readonly ForgeLabCheck[], passed: ReadonlySet<string>) => stageRowsOf(STAGES, checks, passed)

/** Attempts-to-green per stage (spec §13.1, descriptive only), over lab 04's stages. */
export const attemptsToGreen = (runs: readonly (readonly string[])[], checks: readonly ForgeLabCheck[]): (number | null)[] =>
  attemptsToGreenOf(STAGES, runs, checks)

/* ------------------------------------------------------------------ */
/* The reference run: bursts on the Fleet's reference queue             */
/* ------------------------------------------------------------------ */

/**
 * The traffic of the reference run, drawn from the seed alone, never from the capacity or the queue's replies, so the
 * Modify step changes the ring and nothing else. A burst of pushes, then a few pops, over and over.
 */
export const BURSTS = {
  /** Ops in the run. */
  ops: 40,
  /** A burst is this many pushes... */
  pushes: { min: 3, max: 8 },
  /** ...followed by this many pops (a pop that finds the queue empty still counts as an op). */
  pops: { min: 1, max: 5 },
} as const

/** The practice run's seed: fixed, so the numbers can be asked about. */
export const PRACTICE_SEED = 0x17e

/** The reference ring: the capacity the Predict step asks about (the Modify step doubles it). */
export const CAPACITY = 8

export interface BurstConfig {
  seed: number
  /** Slots in the ring. */
  capacity: number
}

export const REFERENCE: BurstConfig = { seed: PRACTICE_SEED, capacity: CAPACITY }

const draw = (u: number, min: number, max: number) => min + (u % (max - min + 1))

/** The run's ops, in order: `true` is a push. A function of the seed only. */
export function burstOps(seed: number): boolean[] {
  const next = splitmix32u(seed)
  const ops: boolean[] = []
  while (ops.length < BURSTS.ops) {
    for (let n = draw(next(), BURSTS.pushes.min, BURSTS.pushes.max); n > 0 && ops.length < BURSTS.ops; n--) ops.push(true)
    for (let n = draw(next(), BURSTS.pops.min, BURSTS.pops.max); n > 0 && ops.length < BURSTS.ops; n--) ops.push(false)
  }
  return ops
}

/** One frame of the strip. */
export interface BurstSample {
  /** Ops applied so far. */
  op: number
  /** Values in the ring now. */
  len: number
  /** Pushes refused so far. */
  full: number
  /** Pops that found the ring empty so far. */
  empty: number
  /** Slots holding a value, in slot order (a ring puts position p in slot p mod capacity). */
  occupied: readonly number[]
}

export interface BurstRun {
  config: BurstConfig
  total: number
  /** Pushes in the run. */
  pushes: number
  /** Pushes that replied full. */
  full: number
  /** Pops in the run. */
  pops: number
  /** Pops that found the ring empty. */
  empty: number
  /** Values in the ring when the run ends. */
  endLen: number
  /** The most values the ring held at once. */
  peak: number
  /** Every value came out in the order it went in, and the ring never held more than its capacity. */
  fifo: boolean
  samples: readonly BurstSample[]
}

/**
 * Runs the burst on `makeRefQueue(capacity)`. A push the ring cannot take is refused (`full`, the value handed back,
 * the ring unchanged), as the lab's `Err(v)`. Each accepted push takes the next position; each pop that returns a
 * value frees the oldest one, so position p sits in slot p mod capacity, which is where a ring buffer would put it.
 */
export function runBursts(config: BurstConfig): BurstRun {
  const q = makeRefQueue(config.capacity)
  const ops = burstOps(config.seed)
  const samples: BurstSample[] = []
  let tail = 0 // positions handed out
  let head = 0 // positions popped
  let next = 1
  let full = 0
  let empty = 0
  let pushes = 0
  let pops = 0
  let peak = 0
  let fifo = true
  let lastOut = 0
  const sample = (op: number) =>
    samples.push({
      op,
      len: tail - head,
      full,
      empty,
      occupied: Array.from({ length: tail - head }, (_, i) => (head + i) % config.capacity).sort((a, b) => a - b),
    })
  sample(0)
  ops.forEach((isPush, i) => {
    if (isPush) {
      pushes++
      if (q.push(next)) {
        next++
        tail++
      } else full++
    } else {
      pops++
      const v = q.pop()
      if (v === null) empty++
      else {
        if (v <= lastOut) fifo = false
        lastOut = v
        head++
      }
    }
    peak = Math.max(peak, tail - head)
    if (tail - head > config.capacity) fifo = false
    sample(i + 1)
  })
  return { config, total: ops.length, pushes, full, pops, empty, endLen: tail - head, peak, fifo, samples }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One sentence on a finished run, for the strip’s caption and the Modify reveal. */
export function describeRun(run: BurstRun): string {
  const refused = run.full === 0 ? 'no push was refused' : `${plural(run.full, 'push', 'pushes')} of ${run.pushes} replied full`
  const dry = run.empty === 0 ? 'no pop found it empty' : `${plural(run.empty, 'pop')} found it empty`
  return `A ring of ${run.config.capacity} slots, ${run.total} ops of bursty traffic: ${refused}, ${dry}, and it ends holding ${run.endLen}. ${run.fifo ? 'Values came out in the order they went in.' : 'The order broke.'}`
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
  nsec = 40,
): ChoicePrimm => ({ kind: 'choice', id, step, nsec, item: { id, kcs, q: { ...q, kcs: [...kcs] } } })

const REFERENCE_RUN = runBursts(REFERENCE)

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab04.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: [MUTEX_ATOMICS],
    prompt: `The Fleet’s reference queue holds ${CAPACITY} values and takes ${BURSTS.ops} ops of bursty traffic: a burst of ${BURSTS.pushes.min} to ${BURSTS.pushes.max} pushes, then ${BURSTS.pops.min} to ${BURSTS.pops.max} pops, over and over. A push into a full queue replies full and hands the value back. Over the whole run, how many pushes reply full?`,
    unit: 'pushes',
    factor: 1.5,
    explain: `Each burst puts in more than the pops after it take out (about 5.5 in, 3 out), so the ring climbs to its capacity within a few bursts and then stays near it. From there a burst is accepted only as far as the last pops made room, and the rest comes back as full. In the reference run ${REFERENCE_RUN.full} of ${REFERENCE_RUN.pushes} pushes were refused.`,
  },
  choice('lab04.primm.p2', 'predict', [MUTEX_ATOMICS, ABA], {
    q: 'You write a queue whose `push` is right, but `pop` frees its slot with `seq = h + 1` instead of `h + capacity`, where `h` is the position it just popped. Going through the stages in order (1, 2, 3, 4), which check goes red first?',
    options: [
      '`fifo` in stage 1, because the first pop already returns the wrong value after a slot is freed',
      '`backpressure` in stage 2, because the push that follows its first pop finds that freed slot not ready',
      '`wraparound` in stage 3, because a push fails on the second lap of the ring, after four values went in',
      '`model_gauntlet` in stage 4, because random pops and pushes eventually meet a slot that was never freed',
    ],
    correct: [1],
    why: [
      'The `fifo` check pushes eight values and pops all eight, and never pushes after a pop. No slot is used twice there, so a release at `h + 1` still passes it.',
      'That check fills a 4-slot ring, is refused once, pops once and pushes again. That push needs slot 0 to read `seq = 4`, and the release left it at 1, so the push calls the ring full. This is the first red check.',
      'It goes red there too, because a jam after the first lap is the same mistake. But `backpressure` in stage 2 reaches it first when you go through the stages in order.',
      'The gauntlet fails on this mistake as well, on every seed the calibration ran, but it is in the last stage. Three checks in two earlier stages reach the false full before it does: `backpressure` in stage 2, then `wraparound` and `slot_conservation` in stage 3.',
    ],
    explanation: 'A pop that frees its slot at `h + 1` is wrong only for the next lap. The first check that pushes after a pop is `backpressure`.',
  }),

  /* ---- Investigate: the sequence numbers and what the checks can see ---- */
  {
    kind: 'numeric',
    id: 'lab04.primm.i1',
    step: 'investigate',
    nsec: 60,
    kcs: [ABA],
    prompt:
      'A 4-slot ring starts with `seq = [0, 1, 2, 3]`. On one thread you push four values, pop three, then push two more. A push at position t writes `seq = t + 1` and a pop at position h writes `seq = h + 4`. What does `seq[1]` hold at the end?',
    unit: 'seq value',
    truth: 6,
    lures: [
      { value: 5, miss: 'seq.stopped-at-pop', message: '5 is slot 1 right after the pop at position 1 freed it (1 + 4). The last push then took position 5 from slot 1 and published 5 + 1.' },
      { value: 2, miss: 'seq.first-lap-only', message: '2 is slot 1 after the first push (1 + 1). The pop and the second lap’s push both moved it on.' },
      { value: 1, miss: 'seq.untouched', message: '1 is where slot 1 started. Position 1 was pushed and popped, and position 5 was pushed after that, so it has changed three times.' },
    ],
    explain:
      'Slot 1 starts at 1. Position 1 is pushed (seq = 2), then popped (1 + 4 = 5), so the slot is free for the next lap. Position 5 is also slot 1, and it is pushed once seq equals 5, which publishes 5 + 1 = 6.',
  },
  choice('lab04.primm.i2', 'investigate', [MUTEX_ATOMICS], {
    q: 'In the claim loop, `push` reads the slot’s sequence number and works out `dif = seq - pos`, where `pos` is the tail it loaded. What does `dif < 0` tell it?',
    options: [
      'The slot still holds last lap’s value that nobody popped, so the ring is full and the push hands the value back',
      'Another producer already took this position and published its value, so the push reloads the tail and tries again',
      'The slot is free for this lap, so the push may now claim the position with a compare-exchange on the tail',
      'The compare-exchange on the tail lost a race, so the payload must not be stored in the slot after all',
    ],
    correct: [0],
    why: [
      'The sequence number is behind the position: the slot was never freed for this lap, so it is still full. The ring is full, and the push hands the value back.',
      'That is `dif > 0`: the sequence number is ahead, because another producer took this position and published it. The push reloads the tail and retries.',
      'That is `dif == 0`: the sequence number equals the position, so the slot is free for this lap. Only then does the push try the compare-exchange.',
      'A lost compare-exchange is reported by the compare-exchange itself, which returns the tail it found. `dif` is read before it and says nothing about it.',
    ],
    explanation: 'Three cases, one subtraction: below zero is full, zero is yours to claim, above zero means someone beat you.',
  }),
  choice('lab04.primm.i3', 'investigate', [MUTEX_ATOMICS], {
    q: 'All six browser checks are green, but the native `stress_threads` test in `cargo test` fails. Which mistake is the likeliest cause?',
    options: [
      'A `Relaxed` store where `Release` is needed, so a consumer sees the new number before the payload',
      'A pop on the empty ring that returns Some instead of None, so a caller reads a value nobody pushed',
      'A full ring that returns Err with a different value, so the caller is handed something it never pushed',
      'A pop that skips its release now and then, so a slot is lost and Ok turns into Err on a later lap',
    ],
    correct: [0],
    why: [
      'The browser runs one thread, so no consumer can ever see a sequence number early. Only the native test, with 4 producers and 4 consumers, can expose a wrong memory ordering.',
      'That is a one-thread mistake: `fifo` pops the drained ring and wants None, so a pop that invents a value is already red in stage 1.',
      'In stage 2 `backpressure` pushes into a full ring and compares the value that comes back. A swapped value never reaches the stress test.',
      'A slot that is never freed is a plain logic bug: `wraparound` and `slot_conservation` stall on it soon after the 50th pop, on one thread.',
    ],
    explanation: 'The six checks pin the logic on one thread. A wrong Release or Acquire is invisible there and shows up only under real threads.',
  }),

  /* ---- Modify: the capacity, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab04.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: [MUTEX_ATOMICS],
    prompt: `You changed the ring from ${CAPACITY} slots to ${CAPACITY * 2}, and the traffic is the same. The reference run, at ${CAPACITY} slots, refused ${REFERENCE_RUN.full} of its ${REFERENCE_RUN.pushes} pushes. How many pushes reply full in your run?`,
    unit: 'pushes',
    factor: 1.5,
    explain:
      'A burst puts in more than the pops after it take out, so the ring fills in either case. The bigger ring has twice the room to absorb that surplus, so it fills later and refuses only the last bursts. Doubling the capacity here removes most of the refusals, not half.',
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, guess how many pushes a bursty load gets refused, and which check catches a slot that never comes back.' },
  { id: 'run', title: 'Run', blurb: 'Watch the Fleet’s own reference queue take bursts of pushes and pops in your browser.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Three questions about sequence numbers, the claim loop and what the browser checks cannot see.' },
  { id: 'modify', title: 'Modify', blurb: 'Double the ring, predict how many pushes are still refused, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the queue in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { PrimmStepId }

/**
 * The Run step’s own item: the reference run’s observed value. Watching a strip is not an answer, so it carries
 * no KCs; only the time and the observed value are evidence.
 */
export const RUN_ITEM = { id: 'lab04.primm.r1', nsec: 45 }

/** The Run step’s evidence: the pushes the reference run refused, of the pushes it made. An observation, not a graded answer: no KCs. */
export const runResponse = (run: BurstRun, ms?: number): ItemResponse =>
  observationResponse(RUN_ITEM, { config: run.config as unknown as RunConfig, value: run.full, truth: run.pushes }, ms)

/* ------------------------------------------------------------------ */
/* The reference run as bundle data                                     */
/* ------------------------------------------------------------------ */

const slotList = (slots: readonly number[]) => (slots.length === 0 ? 'none' : slots.join(', '))

/** What `ReferenceRun` shows for a config, in the bundle’s lab-neutral shape (frames, stats, one-line summary). */
function runSpecResult(config: RunConfig): RunResult {
  const cfg = config as unknown as BurstConfig
  const run = runBursts(cfg)
  return {
    config,
    total: run.total,
    value: run.full,
    // the most the value could be: every push refused
    truth: run.pushes,
    clean: run.fifo,
    summary: describeRun(run),
    frames: run.samples.map((s) => ({
      op: s.op,
      cells: Array.from({ length: cfg.capacity }, (_, slot) => (s.occupied.includes(slot) ? 100 : 0)),
      stats: [
        { label: 'values in the ring', value: `${s.len} of ${cfg.capacity}` },
        { label: 'pushes refused', value: String(s.full) },
        { label: 'pops on empty', value: String(s.empty) },
      ],
      alt: `A ring of ${cfg.capacity} slots, numbered from 0. Slots holding a value: ${slotList(s.occupied)}. ${s.full} pushes refused so far.`,
    })),
  }
}

/** Lab 04’s Run and Modify steps as data: the bundle’s `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) => `Reference: the Fleet’s queue, ${config.capacity} slots, bursty traffic`,
  disclaimer:
    'Each cell is one slot of the ring: faint is free, bright holds a value. This is the Fleet’s own reference queue on the page’s own bursts, shaped like the burst_model check (floods, then partial drains), not the check itself. Its slots are drawn where a ring would put each position.',
  reference: { ...REFERENCE },
  run: runSpecResult,
  modify: {
    lead: `Change one thing about the reference run (${CAPACITY} slots, the same bursts).`,
    dials: [{ id: 'cap16', label: `slots ${CAPACITY} becomes ${CAPACITY * 2}`, config: { ...REFERENCE, capacity: CAPACITY * 2 } }],
  },
}
