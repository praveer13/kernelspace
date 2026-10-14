/**
 * Lab 01 in PRIMM stages (F2; docs/specs/wave-1.md §13.1): Predict, Run, Investigate, Modify, Make.
 *
 * Three jobs live here, all pure (no DOM, no clock, no storage):
 *   1. the stage table of the Make step and what a run's results say about it (`stageRows`, `attemptsToGreen`);
 *   2. the in-browser reference run: one churn of the same shape as check 6 (`makeChurnTrace`), driven through
 *      `world/heap` by first-fit, worst-fit or a bump allocator, with coalescing on or off (`runChurn`);
 *   3. the items: what the learner predicts, investigates and modifies, and how each answer is graded and written
 *      (`PRIMM_ITEMS`, `gradeItem`, `itemResponse`). Each one is the ledger ref `item:lab01.primm.<id>`.
 *
 * The reference run is NOT check 6. It is a labelled stand-in: the same heap (1 MiB), the same request mix (16 B to
 * 2 KiB, one request in eight 8 to 32 KiB) and the same churn around an occupancy, from its own seeded trace. Every
 * number here is a property of that trace and is synthetic (W4); none of them is a real-world constant.
 */

import { KC } from '@/data/kc/ids'
import type { ForgeLabCheck } from '@/data/labs'
import type { QuizQuestion } from '@/components/QuizBlock'
import type { ItemResponse } from '@/lib/ledger/types'
import { attemptsToGreen as attemptsToGreenOf, observationResponse, stageRows as stageRowsOf } from '@/lib/forge/primm'
import { splitmix32u } from '@/lib/rng'
import type { AuthoredItem } from '@/lib/items/types'
import { alignedStart, allocWith, createHeap, freeId, runFits, viewOf, type HeapOptions } from '@/lib/world/heap'
import { firstFit, worstFit } from '@/lib/world/placement'
import type { HeapOp, HeapTrace, HeapView, PlacementDriver } from '@/lib/world/types'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, PrimmStepId, ReferenceRunSpec, RunConfig, RunResult, StageInfo } from '../types'

// The shapes live in ../types (the Forge bundle contract), and what PRIMM does for every lab lives in
// src/lib/forge/primm.ts; both are re-exported so lab 01's imports keep working.
export type { ChoicePrimm, NumberPrimm, PrimmItem, StageInfo }
export { currentStage, gradeChoice, gradeNumber, greenStage, itemRev, itemResponse, predictGraded, primmRef } from '@/lib/forge/primm'
export type { PrimmAnswer, PrimmGrade, StageRow } from '@/lib/forge/primm'

export const PRIMM_LAB = 'rust-allocator'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/** The stage markers in `labs/rust-allocator/src/allocator.rs`. Which checks belong to which stage comes from labs.ts. */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'Boot', minutes: 2, goal: '`new` plus a bump `alloc`. The two-minute win.' },
  { n: 2, title: 'Align and spans', minutes: 10, goal: '`align_up`, and spans that never overlap.' },
  { n: 3, title: 'Reuse', minutes: 20, goal: 'An address-ordered free list with first-fit and split.' },
  { n: 4, title: 'Coalesce', minutes: 25, goal: 'Merge on `free`, so churn near 75% never strands a span.' },
]

/** The stages with their checks (labs.ts `stage`) and which of them passed: the shared `stageRows`, bound to lab 01's stages. */
export const stageRows = (checks: readonly ForgeLabCheck[], passed: ReadonlySet<string>) => stageRowsOf(STAGES, checks, passed)

/** Attempts-to-green per stage (spec §13.1, descriptive only), over lab 01's stages. */
export const attemptsToGreen = (runs: readonly (readonly string[])[], checks: readonly ForgeLabCheck[]): (number | null)[] =>
  attemptsToGreenOf(STAGES, runs, checks)

/* ------------------------------------------------------------------ */
/* The reference run: a churn shaped like check 6                       */
/* ------------------------------------------------------------------ */

/** Check 6's heap and request mix (labs/rust-allocator/src/lib.rs); the trace itself is this page's own. */
export const CHURN = {
  capacity: 1 << 20,
  grain: 16,
  /** Small requests: 1 to 128 grains, 16 B to 2 KiB. */
  small: { min: 1, max: 128 },
  /** One request in `largeOneIn` is large: 512 to 2048 grains, 8 to 32 KiB. */
  large: { min: 512, max: 2048 },
  largeOneIn: 8,
  /** Ops of churn after the heap has filled to the occupancy. */
  churnOps: 3000,
  /** The strip's resolution: 64 buckets of 16 KiB. */
  buckets: 64,
  /** One sample (a frame of the strip) every this many ops. */
  every: 25,
} as const

/** The practice trace's seed. A graded run on the page draws its own; this one is fixed so the numbers can be asked about. */
export const PRACTICE_SEED = 0x1a2b

export type Fit = 'first' | 'worst' | 'bump'

export interface ChurnConfig {
  seed: number
  /** Live bytes the churn holds the heap near, percent. */
  occupancyPct: number
  /** The placement policy. `bump` hands out the next unused address and never takes a freed block back. */
  fit: Fit
  /** Merge a freed run with its free neighbours. A bump allocator never does (it has no free list). */
  coalesce: boolean
}

/** The reference allocator of the Run step: first-fit with coalescing, near 75%. */
export const REFERENCE: ChurnConfig = { seed: PRACTICE_SEED, occupancyPct: 75, fit: 'first', coalesce: true }
/** The Run step's second strip, and the subject of the first prediction. */
export const BUMP: ChurnConfig = { ...REFERENCE, fit: 'bump', coalesce: false }

const draw = (u: number, min: number, max: number) => min + (u % (max - min + 1))

/** An allocator-independent trace: fill to the occupancy, then free or allocate around it. Same seed, same ops. */
export function makeChurnTrace(seed: number, occupancyPct: number, churnOps: number = CHURN.churnOps): HeapTrace {
  const next = splitmix32u(seed)
  const target = Math.floor((CHURN.capacity * occupancyPct) / 100)
  const ops: HeapOp[] = []
  const live: { id: number; size: number }[] = []
  let liveBytes = 0
  let nextId = 1
  const alloc = () => {
    const large = next() % CHURN.largeOneIn === 0
    const range = large ? CHURN.large : CHURN.small
    const size = CHURN.grain * draw(next(), range.min, range.max)
    const id = nextId++
    live.push({ id, size })
    liveBytes += size
    ops.push({ op: 'alloc', id, size, align: CHURN.grain })
  }
  while (liveBytes < target) alloc()
  for (let i = 0; i < churnOps; i++) {
    if (liveBytes < target || live.length === 0) {
      alloc()
    } else {
      const [gone] = live.splice(next() % live.length, 1)
      liveBytes -= gone.size
      ops.push({ op: 'free', id: gone.id })
    }
  }
  return {
    id: 'lab01.primm.churn',
    seed: seed >>> 0,
    capacity: CHURN.capacity,
    ops,
    source: `lab 01 reference run: check 6's heap and request mix near ${occupancyPct}%, its own seeded trace (not check 6)`,
  }
}

/** The bump allocator: only the run that ends at the heap's end can serve, so a freed block is never handed out again. */
const bump: PlacementDriver = {
  name: 'bump',
  place(view, req) {
    const last = view.runs[view.runs.length - 1]
    return last !== undefined && runFits(last, req.size, req.align)
      ? { kind: 'place', start: alignedStart(last, req.align) }
      : { kind: 'reject' }
  },
}

const DRIVERS: Record<Fit, PlacementDriver> = {
  first: { name: 'first-fit', place: firstFit },
  worst: { name: 'worst-fit', place: worstFit },
  bump,
}

export const FIT_LABEL: Record<Fit, string> = { first: 'first-fit', worst: 'worst-fit', bump: 'bump allocator' }

/** The heap options a config means. A bump allocator has no free list to merge, so it never coalesces. */
export function heapOptions(config: ChurnConfig): HeapOptions {
  return {
    capacity: CHURN.capacity,
    coalesce: config.fit === 'bump' ? false : config.coalesce,
    minSplit: CHURN.grain,
    granule: CHURN.grain,
    classes: 'none',
  }
}

/** One frame of the strip. */
export interface ChurnSample {
  /** Ops applied so far. */
  op: number
  liveBytes: number
  /** The largest single free run the allocator tracks. */
  largestFree: number
  /** The largest stretch of free bytes side by side, runs merged: what a coalescing allocator would hold. */
  gap: number
  /** Percent of each 16 KiB bucket that holds live bytes, address order. */
  map: readonly number[]
}

export interface ChurnRun {
  config: ChurnConfig
  /** Ops in the trace. */
  total: number
  /** Ops completed before the first request that was refused although a big enough stretch was free; `total` if none. */
  survived: number
  /** True when that never happened. */
  clean: boolean
  /** The failing request, in words (empty when clean). */
  failure: string
  /** Requests refused because no free stretch was big enough. These are fair: the heap really was too full or too broken up. */
  fairRefusals: number
  /** The sampled frames, the first at op 0 and the last at `survived`. */
  samples: readonly ChurnSample[]
  /** Peak external fragmentation (1 − largest run / free bytes), per mille. */
  peakFragPermille: number
}

/** The largest stretch of free bytes side by side, and how many free runs it spans. */
export function mergedGap(view: HeapView): { bytes: number; runs: number } {
  let best = { bytes: 0, runs: 0 }
  let cur = { bytes: 0, runs: 0 }
  for (const r of view.runs) {
    if (!r.free) {
      cur = { bytes: 0, runs: 0 }
      continue
    }
    cur = { bytes: cur.bytes + r.size, runs: cur.runs + 1 }
    if (cur.bytes > best.bytes) best = cur
  }
  return best
}

function bucketMap(view: HeapView): number[] {
  const size = CHURN.capacity / CHURN.buckets
  const used = new Array<number>(CHURN.buckets).fill(0)
  for (const r of view.runs) {
    if (r.free) continue
    for (let b = Math.floor(r.start / size); b < CHURN.buckets && b * size < r.start + r.size; b++) {
      used[b] += Math.min(r.start + r.size, (b + 1) * size) - Math.max(r.start, b * size)
    }
  }
  return used.map((u) => Math.round((u * 100) / size))
}

const kib = (bytes: number) => `${Math.round(bytes / 102.4) / 10} KiB`

/**
 * Runs the churn through the heap engine. It stops at the first request the allocator refuses although a free
 * stretch that large existed (the harness's own test of a refusal, `largest_gap` in lib.rs), which is where check 6
 * would fail it. A refusal with no such stretch is fair and the run goes on.
 */
export function runChurn(config: ChurnConfig, trace: HeapTrace = makeChurnTrace(config.seed, config.occupancyPct)): ChurnRun {
  const options = heapOptions(config)
  const driver = DRIVERS[config.fit]
  let state = createHeap(options)
  const samples: ChurnSample[] = []
  let liveBytes = 0
  const sizes = new Map<number, number>()
  let fairRefusals = 0
  let peak = 0
  let failure = ''
  let survived = trace.ops.length
  const sample = (op: number, view: HeapView) =>
    samples.push({ op, liveBytes, largestFree: view.largestFree, gap: mergedGap(view).bytes, map: bucketMap(view) })
  sample(0, viewOf(state))
  for (let i = 0; i < trace.ops.length; i++) {
    const op = trace.ops[i]
    if (op.op === 'free') {
      if (sizes.has(op.id)) {
        liveBytes -= sizes.get(op.id) ?? 0
        sizes.delete(op.id)
      }
      state = freeId(state, op.id)
    } else {
      const res = allocWith(state, op, (v, r) => driver.place(v, r))
      if (res.ok) {
        state = res.state
        sizes.set(op.id, op.size)
        liveBytes += op.size
      } else {
        const view = viewOf(state)
        const gap = mergedGap(view)
        if (gap.bytes >= op.size) {
          survived = i
          failure = `op ${i + 1}: a ${kib(op.size)} request was refused, yet ${kib(gap.bytes)} were free side by side (in ${gap.runs} free ${gap.runs === 1 ? 'run' : 'runs'})`
          sample(i, view)
          break
        }
        fairRefusals++
      }
    }
    const view = viewOf(state)
    const frag = view.totalFree === 0 ? 0 : Math.round(((view.totalFree - view.largestFree) * 1000) / view.totalFree)
    if (frag > peak) peak = frag
    if ((i + 1) % CHURN.every === 0 || i === trace.ops.length - 1) sample(i + 1, view)
  }
  return { config, total: trace.ops.length, survived, clean: failure === '', failure, fairRefusals, samples, peakFragPermille: peak }
}

/** One sentence on a finished run, for the strip's caption and the Modify reveal. */
export function describeRun(run: ChurnRun): string {
  const label = `${FIT_LABEL[run.config.fit]}${run.config.fit === 'bump' ? '' : run.config.coalesce ? ' with coalescing' : ' without coalescing'}`
  const fair = run.fairRefusals === 0 ? 'no refusals' : `${run.fairRefusals} fair ${run.fairRefusals === 1 ? 'refusal' : 'refusals'}`
  return run.clean
    ? `${label}, near ${run.config.occupancyPct}%: all ${run.total} ops served, with ${fair} (no free stretch was big enough).`
    : `${label}, near ${run.config.occupancyPct}%: ${run.failure}. That is ${run.survived} ops in; check 6 would fail it there.`
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

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab01.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: [KC.externalFrag, KC.allocatorContract],
    prompt:
      'Check 6 churns a 1 MiB heap near 75% full: most requests are 16 B to 2 KiB, and one in eight is 8 to 32 KiB. A bump allocator hands out the next unused address and never takes a freed block back. On a churn of that shape, how many operations (allocs and frees) does it complete before it first refuses a request that a free stretch of the heap could have served?',
    unit: 'ops',
    factor: 1.5,
    explain:
      'A bump pointer only moves up, and a free gives nothing back. Filling the heap to 75% takes a couple of hundred allocations, and every alloc after that pushes the pointer further, so the top of the heap is reached within a few hundred ops while the freed stretches below it sit unused.',
  },
  choice('lab01.primm.p2', 'predict', [KC.allocatorContract], {
    q: 'You build a bump allocator that rounds each start up to the alignment, hands out the next unused span and never takes a freed block back, then drop it on this page. Going through the stages in stage order (1, 2, 3, 4), which check goes red first?',
    options: [
      '`boot` in stage 1, because it has no free list yet',
      '`no_overlap` in stage 2, because each start can land inside the last span',
      '`reuse` in stage 3, because a freed block is not handed out again',
      '`coalesce` in stage 4, because freed neighbours never merge',
    ],
    correct: [2],
    why: [
      'A bump allocator serves the first request by moving one pointer, which is all `boot` asks for, so stage 1 is green.',
      'Each new span starts where the last one ended, so none can share a byte with another. Bump allocators never overlap.',
      'After a free, the next same-size request lands at a new address instead of the freed one, so `reuse` is the first red check.',
      'It does fail `coalesce`, but stage 4 comes after stage 3, and `reuse` is already red by then.',
    ],
    explanation: 'Stages 1 and 2 only ask for a pointer and alignment. The first check that needs `free` to do something is `reuse`.',
  }),

  /* ---- Investigate: the harness ---- */
  choice('lab01.primm.i1', 'investigate', [KC.splitCoalesce], {
    q: 'The repaired lab no longer lets a free list that never merges slip through. You write first-fit with split, but `free` only puts the span back and merges nothing. Which checks does it fail?',
    options: [
      '`coalesce` and `fragmentation` fail, rest pass',
      '`coalesce`, `reuse` and `fragmentation` fail',
      '`no_overlap` and `fragmentation` fail, rest pass',
      'All six pass, as they did before the repair',
    ],
    correct: [0],
    why: [
      'Freed neighbours stay apart, so the 64 KiB request in `coalesce` fails, and so does the churn in `fragmentation`. A freed block still comes back whole, so `reuse` passes.',
      'A same-size request after a free finds that block again, so `reuse` is green. Not merging only shows when a bigger request needs the neighbours.',
      'Spans that are only put back unmerged never overlap anything, so `no_overlap` is green. The failures come from space that is free but split.',
      'That was true before the repair: the old `coalesce` was served from the untouched tail and passed. The repaired one uses the tail up first.',
    ],
    explanation: 'Not merging leaves free space in pieces. The repaired `coalesce` and `fragmentation` both need a piece bigger than any one freed block.',
  }),
  {
    kind: 'numeric',
    id: 'lab01.primm.i2',
    step: 'investigate',
    nsec: 30,
    kcs: [KC.alignment],
    prompt: '`align_up(off, align)` rounds an offset up to the next multiple of the alignment, with `(off + align - 1) / align * align` in integer arithmetic. What does `align_up(13, 8)` return?',
    unit: 'bytes',
    truth: 16,
    lures: [
      { value: 8, miss: 'align.rounded-down', message: 'That is 13 rounded down. `align_up` never returns less than the offset it was given.' },
      { value: 13, miss: 'align.unchanged', message: '13 is not a multiple of 8 (13 % 8 is 5), so the offset has to move.' },
      { value: 21, miss: 'align.added-align', message: 'That is 13 + 8. The formula adds `align - 1`, here 7, before the integer division.' },
      { value: 20, miss: 'align.forgot-divide', message: 'That is 13 + 7, the step before the division. Divide by 8 (2) and multiply by 8 again.' },
    ],
    explain: '13 + 7 = 20, 20 / 8 = 2 in integer arithmetic, 2 * 8 = 16: the smallest multiple of 8 that is at least 13.',
  },
  choice('lab01.primm.i3', 'investigate', [KC.splitCoalesce, KC.externalFrag], {
    q: '`coalesce` takes every byte of the heap it can before it frees 16 neighbouring 4 KiB blocks and asks for 64 KiB. Why fill the heap first?',
    options: [
      'So `free` is timed with the heap full, which is its slowest case for 4 KiB blocks',
      'So `alloc` has to return None once, which covers the failure path of the heap',
      'So the leftover tail cannot answer the 64 KiB request, and only merging can',
      'So the 64 KiB request is aligned to 4 KiB, which first-fit would skip',
    ],
    correct: [2],
    why: [
      'No check measures time. A slow `free` is a different problem, and the run only has a 2 s budget per check.',
      'The check does not care whether `alloc` ever returns None on the way. It cares whether the 64 KiB request is served at the end.',
      'With the tail used up, the only 64 KiB the heap can offer is the 16 freed blocks side by side. A `free` that does not merge cannot serve it. The old check left the tail free, so it never tested merging.',
      'Alignment is a different check. The request asks for 16-byte alignment, and a correct first-fit meets it without help from the fill.',
    ],
    explanation: 'The fill takes the easy way out of the allocator. What is left to serve 64 KiB is whatever `free` merged.',
  }),
  choice('lab01.primm.i4', 'investigate', [KC.externalFrag, KC.placementPolicy], {
    q: '`fragmentation` can fail with "alloc(9216) returned None ... yet the 12288 bytes from offset 400384 hold no live block". What is your `None` compared against?',
    options: [
      'The largest block in your free list, which the harness reads through a hook',
      'The total free bytes, so any request below that total must succeed',
      'A gap the harness works out from the live spans, not from your free list',
      'A reference allocator the harness runs on the same operations beside yours',
    ],
    correct: [2],
    why: [
      'The harness never looks inside your struct. It only sees the offsets you return and the spans it freed.',
      'Total free space can be in many pieces, and the harness allows a refusal when no single stretch is big enough. That is why a policy such as best-fit or next-fit also passes.',
      'The harness keeps its own list of live spans, so the stretches between them are exactly what a coalescing free list would hold. If one of them fits the request and you said None, your free list lost it.',
      'No reference runs beside yours. The check is a fixed rule about gaps, so different placement policies all pass.',
    ],
    explanation: 'The harness is an honest referee: it knows which bytes are live, so it knows which stretches were free.',
  }),
  choice('lab01.primm.i5', 'investigate', [KC.allocatorContract], {
    q: 'Your allocator passes `cargo test`. The page grades the seeded checks (`align`, `no_overlap` and `fragmentation`) on seeds it draws when you drop the file. What does that change for a correct allocator?',
    options: [
      'Nothing, because a correct one passes any seed and a tuned one fails',
      'Each drop needs a fresh `cargo build`, because the seed is baked into the module',
      'Some seeds fail by chance, so a correct allocator may need a second try',
      'No seed is drawn, so a lucky constant for the default seed still passes',
    ],
    correct: [0],
    why: [
      'A correct allocator is correct for every sequence of requests, so a new seed cannot hurt it. A solution that only works on the default sizes passed the terminal and fails here, which is the point.',
      'The seed arrives as input on each run and the module is not rebuilt. The same file can be dropped again and graded on a new seed.',
      'No seed makes a correct allocator fail. The checks were calibrated: the reference passed every one of thousands of seeds.',
      'Seeded checks are drawn at grade time on this page, so a hard-coded answer for the default seed is exactly what gets caught.',
    ],
    explanation: '`cargo test` also runs the seeded checks on 32 extra seeds, so a green terminal and a red page is rare unless the code was tuned.',
  }),

  /* ---- Modify: one dial, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab01.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: [KC.splitCoalesce, KC.placementPolicy],
    prompt: 'You changed one thing about the reference run. Where does the run first refuse a request that a free stretch could have served? Enter the number of ops in the trace if you think it never does.',
    unit: 'ops',
    factor: 1.5,
    explain: 'Coalescing is what keeps free stretches usable. A different placement policy or occupancy changes how many requests are refused fairly (nothing big enough was free), not whether a request that fits gets served.',
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, guess what a bump allocator does on a churn like check 6.' },
  { id: 'run', title: 'Run', blurb: 'Watch a reference allocator and a bump allocator run the same churn in your browser.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Five questions about what the harness checks and why.' },
  { id: 'modify', title: 'Modify', blurb: 'Change one thing about the reference run, predict the result, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the allocator in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { PrimmStepId }

/**
 * The Run step's own item: the reference run's observed value. Watching a strip is not an answer, so it carries
 * no KCs (nothing for a KC aggregate to credit, and the empty list is how a reader tells it from an answer); only the
 * time and the observed value are evidence.
 */
export const RUN_ITEM = { id: 'lab01.primm.r1', nsec: 45 }

/** The Run step's evidence: what the reference run observed (ops served of the trace). An observation, not a graded answer: no KCs. */
export const runResponse = (run: ChurnRun, ms?: number): ItemResponse =>
  observationResponse(RUN_ITEM, { config: run.config as unknown as RunConfig, value: run.survived, truth: run.total }, ms)

/* ------------------------------------------------------------------ */
/* The reference run as bundle data                                     */
/* ------------------------------------------------------------------ */

const mib = CHURN.capacity / (1 << 20)
const bucketKiB = CHURN.capacity / 1024 / CHURN.buckets

/** What `ReferenceRun` shows for a config, in the bundle's lab-neutral shape (frames, stats, one-line summary). */
function runSpecResult(config: RunConfig): RunResult {
  const run = runChurn(config as unknown as ChurnConfig)
  return {
    config,
    total: run.total,
    value: run.survived,
    truth: run.total,
    clean: run.clean,
    summary: describeRun(run),
    frames: run.samples.map((s) => ({
      op: s.op,
      cells: s.map,
      stats: [
        { label: 'live bytes', value: kib(s.liveBytes) },
        { label: 'largest free run', value: kib(s.largestFree) },
      ],
      alt: `The ${mib} MiB heap in address order, ${CHURN.buckets} buckets of ${bucketKiB} KiB. ${kib(s.liveBytes)} live, largest free run ${kib(s.largestFree)}.`,
    })),
  }
}

/** Lab 01's Run and Modify steps as data: the bundle's `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) =>
    config.fit === 'bump'
      ? 'Bump allocator: never takes a freed block back'
      : `Reference: ${FIT_LABEL[config.fit as Fit] ?? config.fit}${config.coalesce ? ' with coalescing' : ' without coalescing'}`,
  disclaimer: 'This is the page’s own churn, shaped like check 6 (same heap, same request sizes), not check 6 itself.',
  reference: { ...REFERENCE },
  baseline: { ...BUMP },
  run: runSpecResult,
  modify: {
    lead: `Change one thing about the reference run (${FIT_LABEL[REFERENCE.fit]} with coalescing, near ${REFERENCE.occupancyPct}%).`,
    dials: [
      { id: 'nocoal', label: 'turn coalescing off', config: { ...REFERENCE, coalesce: false } },
      { id: 'worst', label: 'first-fit becomes worst-fit', config: { ...REFERENCE, fit: 'worst' } },
      { id: 'occ45', label: 'occupancy 75% becomes 45%', config: { ...REFERENCE, occupancyPct: 45 } },
      { id: 'occ90', label: 'occupancy 75% becomes 90%', config: { ...REFERENCE, occupancyPct: 90 } },
    ],
  },
}
