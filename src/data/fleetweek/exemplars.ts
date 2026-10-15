/**
 * The rubric and its scored exemplars for Fleet Week's self-review (docs/specs/wave-3.md §10.4, D14).
 *
 * The rubric is formative: you read three scored write-ups of one real run, score your own on the same four criteria,
 * and the four scores are recorded in the act's data. They are never part of the score (the evidence supports
 * self-assessment against a rubric of required ideas with model answers, computing-education.md:199; rubric grading is
 * formative and only the executed checks gate XP, ai-tutoring.md:278).
 *
 * Every exemplar was written from a real run of the act: the all-reference engine on a graded seed drawn from the
 * entropy named in `runs`. Its receipt tokens name those runs' records (their ids are the first 8 hex digits of the
 * record's sha256, `runRecordId`) and carry the values the act printed. tests/fleet/receipts-act.test.ts rebuilds each
 * record by running the act, checks the ids, and re-runs every token through `verifyReceipts`, so a number here that
 * the simulation no longer gives fails the test. Figures with a unit outside a token are left in the thin exemplars
 * on purpose: that is what "cite it or cut it" flags. The exemplars cite all-reference runs, so they show the form of
 * a write-up, not a passing module for Act I (no passing module is ever committed).
 */

import type { Act2Choice } from '@/lib/fleet-week'
import { RUBRIC_KEYS } from '@/lib/ledger/constants'
import type { FleetActData } from '@/lib/ledger/types'

/** The four criteria, in the codec's order: the codec's own `RUBRIC_KEYS` (ledger/constants.ts, D35, D48). */
export { RUBRIC_KEYS }
export type RubricKey = (typeof RUBRIC_KEYS)[number]
export type RubricScore = 0 | 1 | 2 | 3
export const RUBRIC_SCORES: readonly RubricScore[] = [0, 1, 2, 3]

/** Your self-scores while you choose them: a criterion is left out until you pick its level. */
export type RubricDraft = Partial<Record<RubricKey, RubricScore>>

/** The four scores as the act's data wants them, or undefined until all four are chosen. */
export function rubricData(draft: RubricDraft): FleetActData['rubric'] | undefined {
  const [capacity, slo, cost, failure] = RUBRIC_KEYS.map((k) => draft[k])
  return capacity === undefined || slo === undefined || cost === undefined || failure === undefined ? undefined : { capacity, slo, cost, failure }
}

export interface RubricCriterion {
  key: RubricKey
  title: string
  /** The question the criterion asks of a write-up. */
  ask: string
  /** One line per level, 0 to 3. */
  levels: readonly [string, string, string, string]
}

export const RUBRIC: readonly RubricCriterion[] = [
  {
    key: 'capacity',
    title: 'Capacity math',
    ask: 'Does it work out what the machine can hold, with arithmetic?',
    levels: [
      'No capacity figure, or numbers that are not tied to the machine.',
      'Quotes the run’s counts without relating them to the resource that limits it.',
      'Relates the counts to the limiting resource (KV pool, slots, workers) with the arithmetic shown.',
      'Does that arithmetic and says what moving the lever would do to it, consistent with the run.',
    ],
  },
  {
    key: 'slo',
    title: 'SLO reasoning',
    ask: 'Does it say what the SLO counts and why requests missed it?',
    levels: [
      'Never mentions the SLO or goodput.',
      'Quotes goodput without saying what it counts or which requests miss.',
      'Says what goodput counts and ties the misses to a measured latency or count.',
      'Also separates the cause (queueing, prefill, loss) with the numbers, and says what must change for the SLO to hold.',
    ],
  },
  {
    key: 'cost',
    title: 'Cost sensitivity',
    ask: 'Does it say what the choice costs and what would change the answer?',
    levels: [
      'No mention of what the choice costs.',
      'Names a cost (hardware, hours, a price) without saying what drives it.',
      'Says what the cost depends on (workers, or hours times price over tokens served) and what the figure assumes.',
      'Also shows how the conclusion moves when the price or the trace moves, with a ratio or a break-even.',
    ],
  },
  {
    key: 'failure',
    title: 'Failure modes',
    ask: 'Does it say what breaks first and what the run did not test?',
    levels: [
      'No failure named.',
      'Names a failure without a number from the run.',
      'Names what fails first and cites the number that shows it.',
      'Also says what the run does not test, or what production would see instead.',
    ],
  },
]

/** The acts that carry a rubric: Acts I-III (Act IV is graded by its drills). */
export type ExemplarAct = 'engine' | 'fleet' | 'business'

/** One run an exemplar cites: its record id, the entropy that draws its graded seed and, for Act II, the topology. */
export interface ExemplarRun {
  id: string
  entropy: number
  choice?: Act2Choice
}

export interface Exemplar {
  id: string
  act: ExemplarAct
  /** What the reader should notice, before the scores. */
  label: string
  /** The write-up, with receipt tokens. */
  text: string
  runs: readonly ExemplarRun[]
  scores: Record<RubricKey, RubricScore>
  /** One sentence per criterion on why it earns that level. */
  why: Record<RubricKey, string>
}

export const exemplarTotal = (e: Exemplar): number => RUBRIC_KEYS.reduce((n, k) => n + e.scores[k], 0)

/* ------------------------- Act I: the reference engine on 0x3a12 ------------------------- */

const ENGINE_RUN: ExemplarRun = { id: 'ecf5a110', entropy: 0x3a12 }

/* ------------------------- Act II: two workers and four, JSQ, on 0x3a12 ------------------------- */

const FLEET_2W: ExemplarRun = { id: 'bde4b176', entropy: 0x3a12, choice: { workers: 2, router: 'jsq' } }
const FLEET_4W: ExemplarRun = { id: 'b33f753a', entropy: 0x3a12, choice: { workers: 4, router: 'jsq' } }

/* ------------------------- Act III: the three offers on 0x3a12 and 0x3a13 ------------------------- */

const BUSINESS_RUN: ExemplarRun = { id: '716bd5db', entropy: 0x3a12 }
const BUSINESS_RUN_2: ExemplarRun = { id: 'b8d6aff1', entropy: 0x3a13 }

export const EXEMPLARS: Record<ExemplarAct, readonly [Exemplar, Exemplar, Exemplar]> = {
  engine: [
    {
      id: 'engine-strong',
      act: 'engine',
      label: 'Works the pool out in tokens, separates waiting from eviction, and says what it did not show.',
      runs: [ENGINE_RUN],
      text:
        'Reference engine, one run. Goodput was [[r:ecf5a110 goodput=43.8]]: 105 of the 240 requests had a first token inside the 40-iteration TTFT SLO, so 135 missed it. ' +
        '[[r:ecf5a110 completed=224]] finished, [[r:ecf5a110 shed=16]] were shed and [[r:ecf5a110 preempts=0]] were preempted, so the misses are waiting, not eviction: ' +
        'queue p95 was [[r:ecf5a110 queueP95=866]] iterations of a [[r:ecf5a110 ttftP95=873]]-iteration TTFT p95, all but seven iterations of the tail. ' +
        'The pool is 256 blocks of 16 tokens, 4,096 tokens, and a running request holds its prompt, what it has decoded and 48 tokens of headroom: about 436 tokens at a mean prompt near 360. ' +
        'That fits about nine requests, fewer than the 16 sequence slots, so KV memory binds first; extra slots could not be filled. A block manager that wastes less, or a scheduler that admits short prompts first, is the lever. ' +
        'A larger pool costs HBM that this run does not price. The 16 shed were turned away by the 32-deep intake queue in the three flash crowds, so an intake queue of my own is where they would be won back. ' +
        'This is one seed and an all-reference engine: I have shown where the limit sits, not that a better manager moves the number.',
      scores: { capacity: 3, slo: 3, cost: 2, failure: 3 },
      why: {
        capacity: 'Turns 256 blocks of 16 tokens into 4,096 tokens, divides by what a request holds (about 436) to get about nine, compares that with the 16 slots, and says what more slots would and would not do.',
        slo: 'Says what goodput counts (105 of 240 inside 40 iterations), and separates the cause with numbers: no preemptions, and queue p95 is 866 of the 873-iteration TTFT p95.',
        cost: 'Names HBM as what a bigger pool costs and says the run does not price it. It gives no ratio or break-even, which is what a 3 needs.',
        failure: 'Names the shed requests with their count, where they were shed, and states what the run did not test: it has not shown that a better manager moves the number.',
      },
    },
    {
      id: 'engine-middling',
      act: 'engine',
      label: 'Reads the latencies correctly, but the capacity and failure lines stay general.',
      runs: [ENGINE_RUN],
      text:
        'Goodput was [[r:ecf5a110 goodput=43.8]]: [[r:ecf5a110 completed=224]] of 240 requests completed and [[r:ecf5a110 shed=16]] were shed. ' +
        'The SLO is on the first token, and queue p95 ([[r:ecf5a110 queueP95=866]]) is nearly all of TTFT p95 ([[r:ecf5a110 ttftP95=873]]), so requests wait to be admitted rather than being slow to prefill. ' +
        'The pool is 256 blocks of 16 tokens, 4,096 tokens, and every running request holds its whole prompt, so memory fills before the 16 slots do. ' +
        'A smarter scheduler could admit short prompts first. A bigger pool would cost more HBM. The shed requests are simply lost.',
      scores: { capacity: 2, slo: 2, cost: 1, failure: 1 },
      why: {
        capacity: 'Does the 256 × 16 arithmetic and relates it to the slots (memory fills first), but never works out how many requests fit, so it cannot say what a change would do.',
        slo: 'Names the first token as what the SLO is on and ties the misses to queue p95 against TTFT p95. It does not say what goodput counts or what must change.',
        cost: 'Names a cost (more HBM) and stops: no driver, no assumption, nothing that would change the answer.',
        failure: 'Says the shed requests are lost, and cites the count earlier, but does not say where they were shed or what the run leaves untested.',
      },
    },
    {
      id: 'engine-thin',
      act: 'engine',
      label: 'One receipt, one figure with no receipt, and a lever that is not an engine lever.',
      runs: [ENGINE_RUN],
      text:
        'Goodput was [[r:ecf5a110 goodput=43.8]], which is bad. The engine is slow because there are too many requests. TTFT p95 was 873 iterations. ' +
        'We should fix it by adding more GPUs, but that costs a lot.',
      scores: { capacity: 0, slo: 1, cost: 1, failure: 0 },
      why: {
        capacity: 'No figure ties the machine to the load: "too many requests" is not a capacity.',
        slo: 'Quotes goodput (as a receipt) and calls it bad. It does not say what goodput counts or which requests miss.',
        cost: 'Says more GPUs cost a lot, with nothing about what drives the cost or what it buys.',
        failure: 'Names no failure. The 873 iterations is also a figure outside a receipt: cite it or cut it.',
      },
    },
  ],
  fleet: [
    {
      id: 'fleet-strong',
      act: 'fleet',
      label: 'Compares two topologies on one seed, splits the shed into its two causes, and prices the redundancy.',
      runs: [FLEET_2W, FLEET_4W],
      text:
        'Two workers on JSQ failed both bars: [[r:bde4b176 completedPct=89]] completed against 92 and [[r:bde4b176 goodput=34.4]] goodput against 40. ' +
        'The run is 291 requests, the 240 plus the 51 the flash crowd adds, so 89 percent is 259 completed and 32 shed ([[r:bde4b176 shed=32]]). ' +
        'The node death took [[r:bde4b176 lost=16]] of them, the requests queued or running on that worker. The other 16 are intake-queue overflow, because a request is only shed by a death or an overflow. ' +
        'On four workers [[r:b33f753a shed=2]] with [[r:b33f753a lost=2]]: no overflow at all, and the dead worker held only two requests, so little was queued. ' +
        'TTFT p95 fell from [[r:bde4b176 ttftP95=1453]] to [[r:b33f753a ttftP95=375]] iterations, and goodput rose to [[r:b33f753a goodput=57.4]] with completion at [[r:b33f753a completedPct=99.3]]. ' +
        'Four workers is double the hardware (each has 128 blocks and 12 sequence slots) for 23 more points of goodput. ' +
        'Redundancy bought one death, not two: a second loss would leave the two workers that failed here.',
      scores: { capacity: 3, slo: 3, cost: 2, failure: 3 },
      why: {
        capacity: 'Counts the whole run (240 plus 51 is 291, 259 plus 32), splits the shed into death and overflow, and shows how four workers change both: two lost and none overflowed.',
        slo: 'Reads both bars off the run, and separates the cause with numbers: the queue backed up on two workers (TTFT p95 1453 against 375), which is also why the dead worker held so many.',
        cost: 'States what the redundancy costs (double the hardware, with each worker’s size) against what it buys (23 points), but gives no price or break-even.',
        failure: 'Cites lost and shed for both topologies, and says what the run does not cover: a second loss leaves the fleet at the size that failed.',
      },
    },
    {
      id: 'fleet-middling',
      act: 'fleet',
      label: 'Right about the lone survivor, but never says what goodput counts or checks the four-worker answer.',
      runs: [FLEET_2W],
      text:
        'Two workers, JSQ: [[r:bde4b176 completedPct=89]] completed (259 of 291, the 240 requests plus the flash crowd) and [[r:bde4b176 goodput=34.4]] goodput, under both bars (92 and 40). ' +
        'When worker 0 died it took [[r:bde4b176 lost=16]] requests with it, and from then on one worker, with 128 blocks and 12 sequence slots, had to carry the whole trace, which it could not. ' +
        'Four workers would leave three alive. That is double the hardware. I would pick four workers.',
      scores: { capacity: 2, slo: 1, cost: 1, failure: 2 },
      why: {
        capacity: 'Relates the loss to what is left (one worker of 128 blocks and 12 slots carrying the whole trace), with the 259 of 291 arithmetic. It does not size what that worker could carry.',
        slo: 'Says the run is under both bars but not what goodput counts or why requests missed; no latency is read.',
        cost: 'Names the cost as double the hardware, without what it buys or what would change the choice.',
        failure: 'Names the lone survivor as what fails and cites the lost requests. The claim about four workers is not backed by a run.',
      },
    },
    {
      id: 'fleet-thin',
      act: 'fleet',
      label: 'A verdict and a guess, with one figure that has no receipt.',
      runs: [FLEET_2W],
      text:
        'The fleet did not pass. Goodput was [[r:bde4b176 goodput=34.4]] and TTFT p95 was 1453 iterations, probably because the node died. More workers would help.',
      scores: { capacity: 0, slo: 1, cost: 0, failure: 1 },
      why: {
        capacity: 'No count of requests, workers or blocks: nothing to check a lever against.',
        slo: 'Quotes goodput as a receipt but does not say what it counts or which requests missed.',
        cost: 'More workers is a lever with a price, and the price is never mentioned.',
        failure: 'Names the node death as the likely cause but cites nothing from the run about it, and leaves 1453 iterations uncited.',
      },
    },
  ],
  business: [
    {
      id: 'business-strong',
      act: 'business',
      label: 'Cost as price times run length over tokens, a break-even, a second run for the margin, and the model’s limits.',
      runs: [BUSINESS_RUN, BUSINESS_RUN_2],
      text:
        'I pick the B200 node. It kept [[r:716bd5db goodput.b200=72.1]] percent of the 240 requests inside the TTFT SLO, so the executed check passes ([[r:716bd5db meetsSlo.b200=1]]; the bar is 50 percent), at [[r:716bd5db costPerMtok.b200=7.45]] $/Mtok. ' +
        'The H100 is cheaper by the hour but misses the bar ([[r:716bd5db goodput.h100=43.8]], [[r:716bd5db meetsSlo.h100=0]]), so its [[r:716bd5db costPerMtok.h100=10.51]] is not an option. ' +
        'The B200 has twice the KV pool (512 blocks of 16 tokens is 8,192 tokens against 4,096), twice the sequence slots and a larger prefill chunk, so it admits more at once and the queue drains sooner. ' +
        'All three serve the same 51,251 tokens, so $/Mtok is hourly price times run length. The B200’s run is about 63 percent as long as the H100’s (7.45 / 10.51, over the price ratio 28.04 / 25), which more than pays for its 12 percent higher price; ' +
        'it stays cheaper until its hourly price is about 41 percent higher (10.51 / 7.45). The GB200 rack, [[r:716bd5db costPerMtok.gb200=238.77]] $/Mtok, is 32 times the B200, the same as its price ratio (900 / 28.04), so it finishes no sooner: ' +
        'it buys goodput ([[r:716bd5db goodput.gb200=93.3]]) this trace does not need. ' +
        'Limits: one node has no redundancy, and Act II showed what a death costs; on another run the B200 held [[r:b8d6aff1 goodput.b200=69.6]], so its margin over the bar moves with the trace; and this $/Mtok is derived under flat-tick physics, not a market price.',
      scores: { capacity: 3, slo: 2, cost: 3, failure: 3 },
      why: {
        capacity: 'Sizes both pools in tokens (8,192 against 4,096), compares slots and prefill chunk, and says what the larger machine does with them: it admits more at once.',
        slo: 'Says the bar (50 percent) and which options clear it, with their goodput. Act III shows no latency, so the cause is argued from the pools and not measured, which keeps it at 2.',
        cost: 'Gives the formula (price times run length over tokens), derives the run-length ratio from the table, and states a break-even (about 41 percent) and the rack’s ratio (32 times).',
        failure: 'Names the single node, cites a second run for the margin, and states the model’s limit: the cost is derived under flat-tick physics, not a market price.',
      },
    },
    {
      id: 'business-middling',
      act: 'business',
      label: 'The right pick with the right numbers, but the cost reasoning stops at "expensive" and the risk has no number.',
      runs: [BUSINESS_RUN],
      text:
        'B200. Goodput is the share of the 240 requests with a first token inside the SLO: it is [[r:716bd5db goodput.b200=72.1]] here, which clears the bar, while the H100 reaches only [[r:716bd5db goodput.h100=43.8]] and misses it for more than half the trace. ' +
        'The B200 costs [[r:716bd5db costPerMtok.b200=7.45]] $/Mtok, the lowest of the options that meet the SLO. The rack is far too expensive for this trace. ' +
        'The B200 has more memory than the H100, so it handles more requests. One risk is that a single node can fail.',
      scores: { capacity: 1, slo: 2, cost: 1, failure: 1 },
      why: {
        capacity: '"More memory, so more requests" is the right direction with no pool, token or slot count to check it.',
        slo: 'Says what goodput counts and which option misses, with the numbers. It does not say why the H100 misses.',
        cost: 'Cites the cost and calls the rack too expensive, but never says what drives $/Mtok or by how much the rack differs.',
        failure: 'Names the single node as a risk with no number from the run behind it.',
      },
    },
    {
      id: 'business-thin',
      act: 'business',
      label: 'A pick by reputation, one receipt, and no reason the SLO holds.',
      runs: [BUSINESS_RUN],
      text:
        'B200 is best because it is new. It costs [[r:716bd5db costPerMtok.b200=7.45]] $/Mtok, which is cheap, and the goodput is good. GB200 is expensive. It should work fine.',
      scores: { capacity: 0, slo: 1, cost: 1, failure: 0 },
      why: {
        capacity: 'Nothing about what either machine can hold.',
        slo: 'Says the goodput is good with no number and no bar: it does not say what it counts or whether the check passes.',
        cost: 'Cites the cost and calls the rack expensive, with no ratio and nothing about why $/Mtok differs.',
        failure: '"It should work fine" names no failure.',
      },
    },
  ],
}

/** Every exemplar, in act and reading order. */
export const ALL_EXEMPLARS: readonly Exemplar[] = [...EXEMPLARS.engine, ...EXEMPLARS.fleet, ...EXEMPLARS.business]
