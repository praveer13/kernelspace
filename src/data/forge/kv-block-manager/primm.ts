/**
 * Lab 02 in PRIMM stages (F2; docs/specs/wave-2.md §13.2): Predict, Run, Investigate, Modify, Make.
 *
 * Three jobs live here, all pure (no DOM, no clock, no storage):
 *   1. the stage table of the Make step (`STAGES`, `stageRows`, `attemptsToGreen`);
 *   2. the in-browser reference run: one fork-heavy churn on the Fleet's own `RefBlockManager` (`runChurn`);
 *   3. the items: what the learner predicts, investigates and modifies (`PRIMM_ITEMS`). Each one is the ledger ref
 *      `item:lab02.primm.<id>`; grading and the ledger payload are the shared ones in src/lib/forge/primm.ts.
 *
 * The reference run is NOT the lab's `gauntlet`. It is a labelled stand-in: a pool of 32 blocks of 16 tokens, traffic
 * of the same four operations, drawn from its own seed. Every number here is a property of that run and is synthetic.
 */

import { KC } from '@/data/kc/ids'
import type { ForgeLabCheck } from '@/data/labs'
import type { QuizQuestion } from '@/components/QuizBlock'
import type { ItemResponse } from '@/lib/ledger/types'
import { attemptsToGreen as attemptsToGreenOf, observationResponse, stageRows as stageRowsOf } from '@/lib/forge/primm'
import { RefBlockManager } from '@/lib/fleet-model'
import { splitmix32u } from '@/lib/rng'
import type { AuthoredItem } from '@/lib/items/types'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, PrimmStepId, ReferenceRunSpec, RunConfig, RunResult, StageInfo } from '../types'

// The shapes live in ../types (the Forge bundle contract), and what PRIMM does for every lab lives in
// src/lib/forge/primm.ts; both are re-exported here, as lab 01's module does.
export type { ChoicePrimm, NumberPrimm, PrimmItem, StageInfo }
export { currentStage, gradeChoice, gradeNumber, greenStage, itemRev, itemResponse, predictGraded, primmRef } from '@/lib/forge/primm'
export type { PrimmAnswer, PrimmGrade, StageRow } from '@/lib/forge/primm'

export const PRIMM_LAB = 'kv-block-manager'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/**
 * The stage markers in `labs/kv-block-manager/src/manager.rs` (name, minutes). Which checks belong to which stage
 * comes from labs.ts. Stage 5, the optional adapter extension, is not a stage of the walk: it never blocks completion.
 */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'Paging', minutes: 2, goal: 'A pool, a block table per sequence, and `translate`. The first green.' },
  { n: 2, title: 'Capacity', minutes: 10, goal: 'An `allocate` that is all-or-nothing, and a `free` that returns blocks.' },
  { n: 3, title: 'Sharing', minutes: 20, goal: 'Refcounts: `fork` copies the table, `free` gives a block back only at zero.' },
  { n: 4, title: 'Copy-on-write', minutes: 25, goal: '`append` copies a shared partial tail, and 2,000 churn ops conserve every block.' },
]

/** The stages with their checks (labs.ts `stage`) and which of them passed: the shared `stageRows`, bound to lab 02's stages. */
export const stageRows = (checks: readonly ForgeLabCheck[], passed: ReadonlySet<string>) => stageRowsOf(STAGES, checks, passed)

/** Attempts-to-green per stage (spec §13.1, descriptive only), over lab 02's stages. */
export const attemptsToGreen = (runs: readonly (readonly string[])[], checks: readonly ForgeLabCheck[]): (number | null)[] =>
  attemptsToGreenOf(STAGES, runs, checks)

/* ------------------------------------------------------------------ */
/* The reference run: fork-heavy churn on the Fleet's RefBlockManager   */
/* ------------------------------------------------------------------ */

/** The pool and the traffic of the reference run. The percentages are cumulative cut-offs of one draw in [0, 100). */
export const CHURN = {
  /** Physical blocks in the pool. */
  numBlocks: 32,
  /** Tokens per block in the reference run (the Modify step changes it). */
  blockSize: 16,
  /** Sequence ids 0 to slots - 1 can be live at once. */
  slots: 8,
  /** Ops in the run. */
  ops: 400,
  /** Out of 100 ops, about this many allocate a new sequence... */
  allocatePct: 22,
  /** ...this many append... */
  appendPct: 20,
  /** ...this many fork a live sequence (what makes the traffic fork-heavy)... */
  forkPct: 35,
  /** ...and the rest free one. */
  freePct: 23,
  /** A new sequence starts with this many tokens. */
  allocate: { min: 8, max: 72 },
  /** An append adds this many tokens. */
  append: { min: 1, max: 24 },
  /** One sample (a frame of the strip) every this many ops. */
  every: 4,
} as const

/** The practice run's seed: fixed, so the numbers can be asked about. */
export const PRACTICE_SEED = 0x17e

/**
 * `report` says which number the run's `value` is: `shared`, the most blocks held by two or more sequences at once
 * (the Predict and Run steps), or `waste`, the token slots left empty in the blocks in use when the run ends (the
 * Modify step). The traffic and the pool are the same either way.
 */
export interface ChurnConfig {
  seed: number
  blockSize: number
  report: 'shared' | 'waste'
}

/** The reference run: 32 blocks of 16 tokens. */
export const REFERENCE: ChurnConfig = { seed: PRACTICE_SEED, blockSize: CHURN.blockSize, report: 'shared' }

const draw = (u: number, min: number, max: number) => min + (u % (max - min + 1))

/** One frame of the strip. */
export interface ChurnSample {
  /** Ops applied so far. */
  op: number
  free: number
  shared: number
  /** Token slots empty in the blocks in use. */
  waste: number
  /** Per block id: 0 free, 40 held by one sequence, 100 shared. */
  cells: readonly number[]
}

export interface ChurnRun {
  config: ChurnConfig
  total: number
  /** The most blocks shared at once. */
  peakShared: number
  /** The fewest free blocks the pool fell to. */
  minFree: number
  /** Requests the pool could not cover (an allocate, append or fork that returned false). */
  refused: number
  /** Token slots empty in the blocks in use when the run ends. */
  endWaste: number
  /** Sequences live when the run ends. */
  endLive: number
  /** Free plus distinct referenced blocks equalled the pool after every op. */
  conserved: boolean
  samples: readonly ChurnSample[]
}

/** What the manager holds right now, read from its sequences: refs per block, and the empty slots in partial tails. */
function observe(m: RefBlockManager, blockSize: number): { refs: number[]; shared: number; waste: number; live: number } {
  const refs = new Array<number>(m.numBlocks).fill(0)
  const tails = new Map<number, number>()
  let live = 0
  for (const [, seq] of m.seqs()) {
    live++
    for (const b of seq.blocks) refs[b]++
    const partial = seq.len % blockSize
    // A shared partial tail has the same fill in every sequence that holds it (an append copies it first).
    if (partial !== 0) tails.set(seq.blocks[seq.blocks.length - 1], blockSize - partial)
  }
  let waste = 0
  for (const w of tails.values()) waste += w
  return { refs, shared: refs.filter((r) => r > 1).length, waste, live }
}

/**
 * Runs the churn on `RefBlockManager`. Each op draws one of allocate, append, fork or free over the live sequences, in
 * the proportions of `CHURN`; a request the pool cannot cover is refused (the manager leaves its state alone), and
 * what is drawn next depends on what is live, as in the harness's gauntlet.
 */
export function runChurn(config: ChurnConfig): ChurnRun {
  const next = splitmix32u(config.seed)
  const m = new RefBlockManager(CHURN.numBlocks, config.blockSize)
  const live = new Set<number>()
  const samples: ChurnSample[] = []
  let peakShared = 0
  let minFree: number = CHURN.numBlocks
  let refused = 0
  let conserved = true
  const sample = (op: number) => {
    const o = observe(m, config.blockSize)
    samples.push({
      op,
      free: m.freeBlocks,
      shared: o.shared,
      waste: o.waste,
      cells: o.refs.map((r) => (r === 0 ? 0 : r === 1 ? 40 : 100)),
    })
    return o
  }
  sample(0)
  let last = observe(m, config.blockSize)
  for (let i = 0; i < CHURN.ops; i++) {
    const pick = next() % 100
    const ids = [...live].sort((a, b) => a - b)
    const slot = Array.from({ length: CHURN.slots }, (_, s) => s).find((s) => !live.has(s))
    const some = () => ids[next() % ids.length]
    if ((pick < CHURN.allocatePct || ids.length === 0) && slot !== undefined) {
      if (m.allocate(slot, draw(next(), CHURN.allocate.min, CHURN.allocate.max))) live.add(slot)
      else refused++
    } else if (pick < CHURN.allocatePct + CHURN.appendPct && ids.length > 0) {
      if (!m.append(some(), draw(next(), CHURN.append.min, CHURN.append.max))) refused++
    } else if (pick < CHURN.allocatePct + CHURN.appendPct + CHURN.forkPct && ids.length > 0 && slot !== undefined) {
      if (m.fork(some(), slot)) live.add(slot)
      else refused++
    } else if (ids.length > 0) {
      const gone = some()
      m.free(gone)
      live.delete(gone)
    }
    const op = i + 1
    last = observe(m, config.blockSize)
    const used = last.refs.filter((r) => r > 0).length
    if (m.freeBlocks + used !== CHURN.numBlocks) conserved = false
    peakShared = Math.max(peakShared, last.shared)
    minFree = Math.min(minFree, m.freeBlocks)
    if (op % CHURN.every === 0 || op === CHURN.ops) sample(op)
  }
  return {
    config,
    total: CHURN.ops,
    peakShared,
    minFree,
    refused,
    endWaste: last.waste,
    endLive: last.live,
    conserved,
    samples,
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One sentence on a finished run, for the strip's caption and the Modify reveal. */
export function describeRun(run: ChurnRun): string {
  const pool = `${CHURN.numBlocks} blocks of ${run.config.blockSize} tokens`
  const refusals = run.refused === 0 ? 'no request was refused' : `${plural(run.refused, 'request')} refused for want of blocks`
  const kept = run.conserved ? 'Free plus referenced blocks equalled the pool after every op.' : 'Conservation broke.'
  return run.config.report === 'waste'
    ? `${pool}: ${plural(run.endWaste, 'token slot')} sat empty in the blocks in use at the end, with ${plural(run.endLive, 'sequence')} live; at most ${plural(run.peakShared, 'block')} shared, ${refusals}.`
    : `${pool}, ${CHURN.ops} ops of fork-heavy churn: at most ${plural(run.peakShared, 'block')} shared at once, the pool ran down to ${run.minFree} free, ${refusals}. ${kept}`
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

/** What the reference run ends with at 16 tokens a block, quoted in the Modify question so the change is the learner's guess. */
const REFERENCE_WASTE = runChurn({ ...REFERENCE, report: 'waste' }).endWaste

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab02.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: [KC.blockRefcounts, KC.blockTables],
    prompt: `A pool of ${CHURN.numBlocks} blocks of ${CHURN.blockSize} tokens serves ${CHURN.ops} ops of fork-heavy traffic. Of every 100 ops, about ${CHURN.allocatePct} allocate a new sequence (${CHURN.allocate.min} to ${CHURN.allocate.max} tokens), ${CHURN.appendPct} append ${CHURN.append.min} to ${CHURN.append.max} tokens, ${CHURN.forkPct} fork a live sequence and ${CHURN.freePct} free one. Up to ${CHURN.slots} sequences are live at once. At the busiest moment of the run, how many blocks are shared by two or more sequences?`,
    unit: 'blocks',
    factor: 1.5,
    explain:
      'A fork copies a block table and shares every block in it, so each fork of a live sequence turns that sequence’s blocks into shared ones. A block stops being shared when a free drops one owner, or when an append copies a shared partial tail. With forks the most common op, about half the pool is shared at the peak.',
  },
  choice('lab02.primm.p2', 'predict', [KC.blockRefcounts], {
    q: 'You write a manager whose `allocate`, `fork` and `append` are right, but `free(seq)` hands every block of that table back to the pool, shared or not. Going through the stages in stage order (1, 2, 3, 4), which check goes red first?',
    options: [
      '`capacity` in stage 2, because every allocate right after a free finds the pool short of blocks',
      '`fork_shares` in stage 3, because the copied table leaves both sequences pointing at one block',
      '`cow` in stage 4, because the copy of the tail lands in a block that has already been freed',
      '`free_refcount` in stage 3, because freeing one sharer returns all blocks the other uses',
    ],
    correct: [3],
    why: [
      'The `capacity` check frees a lone sequence, and a lone sequence owns each of its blocks, so returning them all is right. This manager passes it.',
      'The `fork_shares` check forks and translates, and never calls `free`. A wrong `free` cannot show up there.',
      'The `cow` check forks and appends, and never calls `free`. Its answer depends on `append`, which this manager gets right.',
      'The `free_refcount` check forks sequence 1 into 2 and frees 1. A free that ignores sharing returns blocks sequence 2 still reads, so the pool count is wrong and this is the first red check.',
    ],
    explanation: 'Only `free_refcount` frees a sequence that still shares blocks. The gauntlet fails too, but it is the last check of stage 4.',
  }),

  /* ---- Investigate: the harness ---- */
  {
    kind: 'numeric',
    id: 'lab02.primm.i1',
    step: 'investigate',
    nsec: 30,
    kcs: [KC.blockTables],
    prompt: 'Blocks hold 16 tokens each. `translate(seq, 37)` looks token 37 up in the sequence’s block table. Which entry of the table, counting from 0, holds the block it returns?',
    unit: 'entry',
    truth: 2,
    lures: [
      { value: 3, miss: 'paging.ceil-for-index', message: '3 is 37 / 16 rounded up. That is how many blocks 37 tokens need (ceil), not where token 37 lives: the index rounds down.' },
      { value: 5, miss: 'paging.offset-for-index', message: '5 is the slot inside the block (37 % 16). The table is indexed by the block number, 37 / 16 rounded down.' },
      { value: 1, miss: 'paging.one-based', message: 'Tokens 16 to 31 are in entry 1. Token 37 is past entry 1’s last token (31), in the next block.' },
    ],
    explain: 'Entry 37 / 16 = 2 in integer division, and the token sits at offset 37 % 16 = 5 inside it. Needing 3 blocks (ceil) is a different question.',
  },
  choice('lab02.primm.i2', 'investigate', [KC.kvCopyOnWrite], {
    q: 'A fork copies the block table and bumps refcounts, and copies no tokens. The copy of a block comes later, when one sequence appends. Why does copy-on-write wait for the append?',
    options: [
      'Because a fork can run when the pool is full, so a copy would have no block',
      'Because a fork writes nothing, so sharing stays safe until someone writes into the shared tail',
      'Because refcounts only count the sequences that write, and a fork has not yet written anything at all',
      'Because a copy at fork time would move the parent’s table to new blocks',
    ],
    correct: [1],
    why: [
      'It is true that a fork never fails for lack of blocks, but that is a consequence, not the reason. The reason is that a read-only share needs no copy at all.',
      'Both tables point at the same blocks, and both only read them until one appends. The append is the first write into a shared partial tail, so that is when the one block is copied.',
      'Refcounts count owners, readers and writers alike. A fork adds one owner to every block of the table.',
      'A copy at fork time would give the child new blocks and leave the parent’s table alone. The cost would be a full copy of the cache, which sharing exists to avoid.',
    ],
    explanation: 'Sharing is free until a write. The first write into a shared partial tail is the one that pays for a block.',
  }),
  {
    kind: 'numeric',
    id: 'lab02.primm.i3',
    step: 'investigate',
    nsec: 30,
    kcs: [KC.blockRefcounts],
    prompt: 'Sequence 1 holds 40 tokens in blocks [7, 3, 12], 16 tokens a block. You call `fork(1, 2)`. What refcount does block 12, the partial tail, hold afterwards?',
    unit: 'owners',
    truth: 2,
    lures: [
      { value: 1, miss: 'refcount.not-bumped', message: '1 is its count before the fork. A fork adds one owner to every block of the table, tail included.' },
      { value: 3, miss: 'refcount.counted-blocks', message: '3 is the number of blocks in the table. The count of one block is how many sequences hold it.' },
      { value: 0, miss: 'refcount.free-means-zero', message: '0 would mean block 12 is back in the pool. Both tables hold it, so the pool did not get it back.' },
    ],
    explain: 'Sequence 1 and sequence 2 both list block 12, so its refcount is 2. The pool did not shrink: a fork takes nothing from it.',
  },
  choice('lab02.primm.i4', 'investigate', [KC.blockRefcounts, KC.kvCopyOnWrite], {
    q: 'Sequence 1 holds exactly 32 tokens in two full blocks of 16, and you fork it into sequence 2. Sequence 2 then appends one token. How many blocks does the append copy?',
    options: [
      'One: the shared tail is copied before anything else is written beside it',
      'Two: the child needs its own private copies of both blocks of its table before writing',
      'None: the full tail takes no write, and the new token goes into a fresh block',
      'None: the append is refused, because every block of the table is shared and read-only',
    ],
    correct: [2],
    why: [
      'Copying happens only when the tail is partial and shared. A full block has no room for the new token, so nothing is written into it.',
      'Only the block that would be written can need a copy. The first block is read-only for the child whatever its refcount.',
      'The tail is full, so the token starts a new block, which comes from the pool at refcount 1. The shared blocks stay shared, and the append takes one block but copies none.',
      'An append is refused only when the pool cannot cover what it needs. A shared table does not stop it.',
    ],
    explanation: 'The copy-on-write trigger is a partial tail with a refcount above 1. A full shared tail needs no copy; new tokens go into a fresh block anyway.',
  }),
  choice('lab02.primm.i5', 'investigate', [KC.blockRefcounts], {
    q: 'The `gauntlet` fails with: "op 311: conservation broken, 3 free + 62 referenced ≠ 64 total". The two numbers add up to 65. What does that tell you?',
    options: [
      'A block is in the pool and in a table: something has freed a block in use',
      'A block leaked: no table holds it, and the pool does not have it any more',
      'The pool is too small for the traffic, so an allocate should have been refused earlier',
      'A `translate` returned the wrong offset inside a block, though the block was the right one',
    ],
    correct: [0],
    why: [
      'A block counted both as free and as referenced makes the sum exceed the pool. This is a double free: a block went back to the pool while a table still held it, as a `free` that ignores refcounts does.',
      'A leak makes the sum fall short of the pool (for example 3 + 60 = 63): some block is counted nowhere. Here the sum is too large.',
      'Running out of blocks makes `allocate` return false. It does not change the sum, which counts blocks, not requests.',
      'The check reads which block each token translates to, not the offset inside it. A wrong offset would not change a block count.',
    ],
    explanation: 'Free plus distinct referenced blocks must equal the pool after every op. Too many is a double free, too few is a leak.',
  }),

  /* ---- Modify: one dial, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab02.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: [KC.internalFrag, KC.blockTables],
    prompt: `You changed the block size; the pool is still ${CHURN.numBlocks} blocks and the run uses the same seed. The reference run, at ${CHURN.blockSize} tokens a block, ends with ${REFERENCE_WASTE} token slots empty in the blocks in use. How many token slots are empty in the blocks in use when your run ends?`,
    unit: 'token slots',
    factor: 1.5,
    explain:
      'The empty slots sit in each sequence’s last block, about half a block per live sequence, and a block shared by two sequences is counted once. So the waste grows with the block size, and the trade is the one T5.L5 names: bigger blocks mean shorter tables and less metadata, and fatter tails.',
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, guess how much of the pool fork-heavy traffic shares, and which check catches a `free` that ignores sharing.' },
  { id: 'run', title: 'Run', blurb: 'Watch the Fleet’s own reference block manager serve a fork-heavy churn in your browser.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Five questions about block tables, refcounts and what the harness checks.' },
  { id: 'modify', title: 'Modify', blurb: 'Change the block size, predict the internal waste, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the block manager in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { PrimmStepId }

/**
 * The Run step's own item: the reference run's observed value. Watching a strip is not an answer, so it carries
 * no KCs; only the time and the observed value are evidence.
 */
export const RUN_ITEM = { id: 'lab02.primm.r1', nsec: 45 }

/** The Run step's evidence: the blocks the reference run shared at the peak, of the pool. An observation, not a graded answer: no KCs. */
export const runResponse = (run: ChurnRun, ms?: number): ItemResponse =>
  observationResponse(RUN_ITEM, { config: run.config as unknown as RunConfig, value: run.peakShared, truth: CHURN.numBlocks }, ms)

/* ------------------------------------------------------------------ */
/* The reference run as bundle data                                     */
/* ------------------------------------------------------------------ */

/** What `ReferenceRun` shows for a config, in the bundle's lab-neutral shape (frames, stats, one-line summary). */
function runSpecResult(config: RunConfig): RunResult {
  const cfg = config as unknown as ChurnConfig
  const run = runChurn(cfg)
  const waste = cfg.report === 'waste'
  return {
    config,
    total: run.total,
    value: waste ? run.endWaste : run.peakShared,
    // the most the value could be: every block shared, or every slot of the pool empty
    truth: waste ? CHURN.numBlocks * cfg.blockSize : CHURN.numBlocks,
    clean: run.conserved,
    summary: describeRun(run),
    frames: run.samples.map((s) => {
      const held = CHURN.numBlocks - s.free - s.shared
      return {
        op: s.op,
        cells: s.cells,
        stats: [
          { label: 'free blocks', value: String(s.free) },
          { label: 'shared blocks', value: String(s.shared) },
          { label: 'empty slots', value: String(s.waste) },
        ],
        alt: `The pool of ${CHURN.numBlocks} blocks in id order. ${s.free} free, ${s.shared} shared by two or more sequences, ${held} held by one. ${s.waste} token slots empty in the blocks in use.`,
      }
    }),
  }
}

/** Lab 02's Run and Modify steps as data: the bundle's `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) => `Reference: the Fleet’s block manager, ${CHURN.numBlocks} blocks of ${config.blockSize} tokens`,
  disclaimer:
    'Each cell is one block: faint is free, half-bright is held by one sequence, bright is shared. This is the Fleet’s own reference manager on the page’s own churn, shaped like the gauntlet (same four operations), not the gauntlet itself.',
  reference: { ...REFERENCE },
  run: runSpecResult,
  modify: {
    lead: `Change one thing about the reference run (${CHURN.numBlocks} blocks of ${CHURN.blockSize} tokens).`,
    dials: [
      { id: 'bs32', label: 'block size 16 becomes 32', config: { ...REFERENCE, blockSize: 32, report: 'waste' } },
      { id: 'bs64', label: 'block size 16 becomes 64', config: { ...REFERENCE, blockSize: 64, report: 'waste' } },
    ],
  },
}
