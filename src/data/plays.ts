/**
 * The plays (W1 Play → Compose → Code, docs/specs/wave-1.md §11; the scheduler play, wave-2.md §8): the registry
 * that /play/:playId, the lesson's play block and verify-plays read, each play's In-production rows, and the pure
 * session model the block-placement components drive. Components keep no rules of their own, so the rules run
 * under `bun test` (tests/plays/play.test.ts). The scheduler's session model lives beside its components
 * (src/components/play/scheduler/session.ts): it pulls in the Fleet engine, which block-placement must not.
 *
 * The ghost lives inside a `Session` (the lockstep runner plays it up front) and is read only by the
 * debrief: `stageOf`, the chips and the grid are built from the learner's side alone.
 */

import { KC } from '@/data/kc/ids'
import { splitmix32u } from '@/lib/rng'
import type { PlayResult } from '@/lib/ledger/types'
import {
  BLOCK_PLACEMENT_ID,
  SKIP_AFTER_TURNS,
  TURN_CAP,
  composeResult,
  pendingAsk,
  placementSetup,
  playResult,
  playTurn,
  skipToDebrief,
  startPlay,
  summarizePlacement,
  turnLine,
  type PlacementPlay,
  type PlacementSetup,
  type PlacementSummary,
} from '@/lib/world/play'
import { CELL_BYTES, runAt, runChoices, type Fit, type RunChoice } from '@/lib/world/placement'
import { composeOk, composeTable, isFixedSpec, type ComposeRow } from '@/lib/world/policy'
import { drawPlacementTrace } from '@/lib/world/traces'
import type { AllocRequest, HeapTrace, HeapView, PlayDef, PolicySpec } from '@/lib/world/types'

/* ------------------------------------------------------------------ */
/* The In-production card (spec §11.4)                                 */
/* ------------------------------------------------------------------ */

/**
 * One line of the card: `lead`, the claim as a chip, `tail`. Every number on the card is a claim (W4);
 * `dial` names the Compose dial the real setting corresponds to.
 */
export interface ProductionRow {
  claim: string
  dial: string
  lead: string
  tail: string
  /** Replaces the chip's default "value unit" text (derived from the claim, never typed in). */
  as?: 'kib'
}

export const PRODUCTION_ROWS: readonly ProductionRow[] = [
  {
    claim: 'production.vllm.block-size',
    dial: 'size classes: fixed blocks',
    lead: 'vLLM cuts its KV cache into fixed blocks of',
    tail: 'by default. A sequence takes whole blocks wherever they are, so no hole is the wrong size. This is your fixed-block spec, the PagedAttention move of T2.L7.',
  },
  {
    claim: 'production.vllm.v1-preemption',
    dial: 'when nothing fits',
    lead: 'When vLLM runs out of blocks, its default preemption mode in V1 is',
    tail: ': the evicted request is rebuilt later rather than swapped out. Your play ended at the same point, on a request that fitted nowhere.',
  },
  {
    claim: 'production.glibc.bins',
    dial: 'size classes and coalescing',
    lead: 'glibc malloc files free chunks in bins:',
    tail: '. Small bins hold one size each and large bins a range. That is the size-class dial, and not every bin coalesces: fastbins do not, small and large bins do.',
  },
  {
    claim: 'production.glibc.mmap-threshold',
    dial: 'leave the heap alone',
    lead: 'glibc starts its mmap threshold at',
    tail: ': a request at or above it gets a mapping of its own, outside the heap, so the biggest blocks never punch holes in it. The threshold then adjusts as large blocks are freed.',
    as: 'kib',
  },
  {
    claim: 'production.jemalloc.classes-per-doubling',
    dial: 'size classes: finer than powers of two',
    lead: 'jemalloc keeps',
    tail: 'in size, where your power-of-two dial keeps one.',
  },
  {
    claim: 'production.jemalloc.max-internal-frag',
    dial: 'minimum split and size classes',
    lead: 'Its class spacing limits internal fragmentation to about',
    tail: 'for all but the smallest classes. Compare it with the internal waste Compose reports for each class dial.',
  },
]

/**
 * The scheduler play's card (wave-2.md §8.5). Each row ties a Compose dial to a setting in vLLM or SGLang at the
 * release its claim pins (D19). A fact that could not be quoted at that release is not a row: the spec never
 * invents one. The copy holds no digits, because every number on the card is the claim chip.
 */
export const SCHEDULER_PRODUCTION_ROWS: readonly ProductionRow[] = [
  {
    claim: 'production.vllm.scheduling-policy',
    dial: 'order: arrival or priority',
    lead: "vLLM's scheduling policy defaults to",
    tail: ': first come first served. Its only other choice is priority, a number each caller sets, so shortest prompt first is a policy you write yourself. Your order dial at fcfs is this default.',
  },
  {
    claim: 'production.sglang.schedule-policy',
    dial: 'order: shortest first is a flag',
    lead: "SGLang's --schedule-policy also defaults to",
    tail: ', and its choices include shortest-prefill-first: your sjf setting, one flag away. Neither engine orders by prompt length out of the box.',
  },
  {
    claim: 'production.vllm.watermark',
    dial: 'headroom: off by default',
    lead: 'vLLM can keep a watermark of KV blocks free when it admits a waiting request. Its default is',
    tail: ', so headroom is off until you ask for it. The reference you met reserves a fixed number of tokens per running request; the watermark is the same idea as a share of the pool.',
  },
  {
    claim: 'production.sglang.schedule-conservativeness',
    dial: 'headroom: a direction, not a token count',
    lead: 'SGLang reserves decode room through its schedule conservativeness, which defaults to',
    tail: '. A larger value schedules more cautiously, and its own help text says to raise it if requests are retracted often. That is the direction of your headroom dial; the source gives no token count.',
  },
  {
    claim: 'production.vllm.v1-preemption',
    dial: 'preempt: recompute',
    lead: 'When vLLM V1 runs out of KV memory, its default preemption mode is',
    tail: ': the evicted request goes back to waiting and is rebuilt from scratch later. That rebuild is what a preempt cost the request in your debrief.',
  },
  {
    claim: 'production.sglang.retract',
    dial: 'preempt: retract',
    lead: "When a decode step cannot get KV memory, SGLang's scheduler will",
    tail: ' requests: it puts them back on the waiting queue to be recomputed, and a retraction policy picks the victims. Your preempt dial picks the newest running request.',
  },
  {
    claim: 'production.vllm.max-num-seqs',
    dial: 'concurrency: fixed in the play',
    lead: "The play fixes how many requests run at once. On the practice minute that cap and the pool both bind: the pool fills nearly to the brim and requests also wait for a free slot. vLLM's max_num_seqs defaults to",
    tail: 'on a large GPU serving the API, and a smaller GPU gets a smaller default.',
  },
  {
    claim: 'production.sglang.max-running-requests',
    dial: 'concurrency: sized from the pool',
    lead: 'When --max-running-requests is not given, SGLang uses',
    tail: '. A real server runs far more requests at once than the play allows.',
  },
  {
    claim: 'production.vllm.max-num-batched-tokens',
    dial: 'chunk: fixed in the play',
    lead: "The play prefills in fixed chunks. vLLM's max_num_batched_tokens, the per-iteration token budget that chunked prefill fills, defaults to",
    tail: 'on a large GPU serving the API.',
  },
  {
    claim: 'production.sglang.chunked-prefill-size',
    dial: 'chunk: sized by the GPU',
    lead: "SGLang's chunked prefill size defaults to",
    tail: 'for GPUs in the middle of its memory table; smaller and larger GPUs get other defaults.',
  },
]

/**
 * The Tiling Cube's card (wave-3.md §6.3). The cube prices one tile on the H100's own numbers, so each row ties a
 * thing the levels counted to the hardware figure or the kernel setting behind it. The claims live in the lazy `tiling`
 * group, which the cube's model registers by importing it; this file imports no lazy group, so it names the ids only.
 * The copy holds no digits, because every number on the card is the claim chip.
 */
export const TILING_CUBE_PRODUCTION_ROWS: readonly ProductionRow[] = [
  {
    claim: 'hw.h100-sxm.smem-per-sm',
    dial: 'stages and slab depth',
    lead: 'An H100 SM has',
    tail: 'of shared memory, shared by every CTA resident on it. Level 3 divided this budget by the slabs of one tile to count the CTAs an SM holds.',
  },
  {
    claim: 'hw.h100-sxm.smem-per-block',
    dial: 'the largest slabs',
    lead: 'One thread block can address at most',
    tail: ': CUDA reserves a kilobyte of shared memory per block for itself. A tile whose slabs are bigger cannot launch, and that is the limit level 2 counted against.',
  },
  {
    claim: 'hw.h100-sxm.registers-per-sm',
    dial: 'the tile cap',
    lead: 'Each SM has',
    tail: ', four bytes each: the register file your FP32 accumulators must fit. That is why the biggest tile that runs is smaller than the biggest that fits shared memory.',
  },
  {
    claim: 'hw.h100-sxm.sm-count',
    dial: 'one wave',
    lead: 'An H100 SXM5 has',
    tail: ': a persistent kernel puts one CTA on each, so a wave in level 4 is this many tiles.',
  },
  {
    claim: 'hw.h100-sxm.l2',
    dial: 'raster order',
    lead: 'The L2 cache holds',
    tail: 'for the whole chip. A grouped raster works because one wave of slabs fits inside it; a wave that did not fit would have slabs evicted before every tile had read them.',
  },
  {
    claim: 'production.triton.group-size-m',
    dial: 'group height',
    lead: "Triton's matmul tutorial launches its tiles in groups of",
    tail: ', the grouped raster of level 4. Every CUDA config in the tutorial sets the same group height, so it is the one dial the tutorial leaves fixed while it tunes the rest.',
  },
]

/**
 * The EPLB play's card (wave-3.md §5.2). The reference you met is DeepSeek EPLB, so the rows tie the two Compose dials to
 * its rule and the engine flags that turn it on, and ground the toy layer in the model it shrinks. The claims live in the
 * lazy `moe` group, which the card imports; this file imports no lazy group, so it names the ids only. The copy holds no
 * digits, because every number on the card is the claim chip.
 */
export const EPLB_PRODUCTION_ROWS: readonly ProductionRow[] = [
  {
    claim: 'model.deepseek-v3.routed-experts',
    dial: 'experts on a layer',
    lead: 'Each MoE layer of DeepSeek-V3 has',
    tail: 'routed by its router, plus one shared expert. Your layer is a toy that you could pack by hand, and the loads you were dealt are made up: a real layer has far more experts to place, and its loads are measured while it serves.',
  },
  {
    claim: 'model.deepseek-v3.experts-per-token',
    dial: 'why the busiest GPU is the score',
    lead: 'The router sends each token to',
    tail: 'chosen from those. A token is not finished until the slowest GPU it was sent to has answered at the combine barrier, so the layer is as slow as its busiest GPU, which is the number you were scored on.',
  },
  {
    claim: 'production.eplb.rebalance',
    dial: 'replicate: most load per copy',
    lead: 'The reference you met is DeepSeek EPLB. Its replication rule is to',
    tail: ', one replica at a time. It then deals the copies out heaviest first, each to the lightest GPU that still has a free slot. Those are your per-copy and least-loaded dials. The function takes each expert\'s load as an input, and the repository publishes no release, so the card pins a commit.',
  },
  {
    claim: 'production.vllm.eplb',
    dial: 'switching it on: vLLM',
    lead: 'vLLM ships with EPLB off. Its settings are',
    tail: '. Redundant experts are the extra copies your replicate turns made, and at the default there are none. The engine decides from a window of recent load and rebalances at an interval, both set in its EPLB config, and it needs expert parallelism.',
  },
  {
    claim: 'production.sglang.eplb',
    dial: 'switching it on: SGLang',
    lead: 'SGLang ships with it off too:',
    tail: '. With both at their defaults a stock engine places each expert once. Turning them on is the replicate step of this play.',
  },
]

/** The rows each play's card renders, by play id: verify-plays compares them with that play's own `productionClaims`. */
export const PLAY_PRODUCTION_ROWS: Readonly<Record<string, readonly ProductionRow[]>> = {
  'block-placement': PRODUCTION_ROWS,
  scheduler: SCHEDULER_PRODUCTION_ROWS,
  'tiling-cube': TILING_CUBE_PRODUCTION_ROWS,
  eplb: EPLB_PRODUCTION_ROWS,
}

/* ------------------------------------------------------------------ */
/* The registry                                                         */
/* ------------------------------------------------------------------ */

/** T1.L4's play. Nominal minutes pay XP once the debrief is reached (spec §8.4). */
export const BLOCK_PLACEMENT: PlayDef = {
  id: BLOCK_PLACEMENT_ID,
  title: 'Block placement',
  lessonId: 't1.l4',
  minutes: 15,
  turnCap: TURN_CAP,
  kcs: [KC.externalFrag, KC.placementPolicy, KC.splitCoalesce, KC.fixedBlocks, KC.internalFrag],
  productionClaims: PRODUCTION_ROWS.map((r) => r.claim),
}

/**
 * T5.L7's play, "I was the scheduler" (wave-2.md §8). Its id is typed here rather than imported from
 * src/lib/world/sched.ts, which holds the Fleet engine: this file loads with block-placement. A test holds the id to
 * `SCHEDULER_PLAY_ID` and the minutes to `PLAY_MINUTES` (economy-table.ts).
 */
export const SCHEDULER: PlayDef = {
  id: 'scheduler',
  title: 'I was the scheduler',
  lessonId: 't5.l7',
  minutes: 20,
  turnCap: TURN_CAP,
  kcs: [KC.continuousBatching, KC.admissionHeadroom, KC.schedOrder, KC.batchingThroughput],
  productionClaims: SCHEDULER_PRODUCTION_ROWS.map((r) => r.claim),
}

/**
 * T4.L6's play, the Tiling Cube in 2D (wave-3.md §6.3): six prediction-opened levels on the cube's model. Its id is typed
 * here, not imported from the model, which registers the lazy `tiling` claims; a test holds the KCs to the levels' own
 * (`CUBE_LEVELS`), the id to the play's folder and the minutes to `PLAY_MINUTES` (economy-table.ts). Its turn cap is the
 * six levels.
 */
export const TILING_CUBE: PlayDef = {
  id: 'tiling-cube',
  title: 'The Tiling Cube',
  lessonId: 't4.l6',
  minutes: 25,
  turnCap: 6,
  kcs: [KC.tilingIntensity, KC.sharedMemoryScratchpad, KC.occupancy, KC.rasterL2Reuse, KC.ridgePoint, KC.flashAttentionBlocking],
  productionClaims: TILING_CUBE_PRODUCTION_ROWS.map((r) => r.claim),
}

/**
 * T6.L2's play, "Place the experts" (wave-3.md §5.2): replicate 4 hot experts of a 16-expert layer, then place the 20 copies
 * on 4 GPUs of 5 slots, against DeepSeek EPLB. Its id is typed here, not imported from the world (src/lib/world/eplb.ts); a
 * test holds the id to `EPLB_PLAY_ID`, the minutes to `PLAY_MINUTES` (economy-table.ts) and the turn cap to the world's 24 turns.
 */
export const EPLB: PlayDef = {
  id: 'eplb',
  title: 'Place the experts',
  lessonId: 't6.l2',
  minutes: 15,
  turnCap: 24,
  kcs: [KC.expertLoadBalance, KC.allToAll],
  productionClaims: EPLB_PRODUCTION_ROWS.map((r) => r.claim),
}

export const PLAYS: Readonly<Record<string, PlayDef>> = { [BLOCK_PLACEMENT.id]: BLOCK_PLACEMENT, [SCHEDULER.id]: SCHEDULER, [TILING_CUBE.id]: TILING_CUBE, [EPLB.id]: EPLB }
export const PLAY_IDS: readonly string[] = Object.keys(PLAYS)

/** The play behind a route or a block, or undefined for an id that is not a play (also `__proto__`). */
export const getPlay = (id: string): PlayDef | undefined => (Object.hasOwn(PLAYS, id) ? PLAYS[id] : undefined)

/** Where lab 01 starts: the play ends by sending the learner here. */
export const BUILD_THIS = { to: '/forge/rust-allocator', label: 'Build this: lab 01, stage 1 is a 2-minute win' } as const

/** Where the scheduler play ends: lab 06, whose reference is the policy the ghost plays (wave-2.md §8.1). */
export const BUILD_THIS_SCHEDULER = { to: '/forge/batching-scheduler', label: 'Build this: lab 06, Goodput or Nothing' } as const

/* ------------------------------------------------------------------ */
/* Display helpers                                                      */
/* ------------------------------------------------------------------ */

/** Whole per mille as a percentage with one decimal ("12.5 %"). */
export const pct = (permille: number): string => `${(permille / 10).toFixed(1)} %`

/** A block's colour: the golden angle keeps neighbours with consecutive ids far apart. */
export const blockHue = (id: number): number => (id * 137) % 360

export const cellWord = (n: number): string => `${n} cell${n === 1 ? '' : 's'}`

/** A fresh uint32 for "new numbers" (the world modules are pure, so the entropy enters here). */
export function freshEntropy(): number {
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint32Array(1))[0]
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}

/* ------------------------------------------------------------------ */
/* One play session                                                     */
/* ------------------------------------------------------------------ */

export type PlayProvenance = 'practice' | 'unseen'

export interface Session {
  trace: HeapTrace
  provenance: PlayProvenance
  setup: PlacementSetup
  /** Both sides of the lockstep run. Only the debrief may read `ps.ghost`. */
  ps: PlacementPlay
  /** The last turn as the aria-live line says it. */
  line: string
  /** The free run the last free opened, in cells: it flashes. */
  freed: { start: number; size: number } | null
  /** Set once the learner has asked for the debrief. */
  summary: PlacementSummary | null
}

export function newSession(trace: HeapTrace, provenance: PlayProvenance): Session {
  const setup = placementSetup(trace)
  return { trace, provenance, setup, ps: startPlay(setup), line: '', freed: null, summary: null }
}

/** What the learner faces now. Built from the learner's side only. */
export type Stage =
  | { kind: 'free'; op: number }
  | { kind: 'ask'; op: number; req: AllocRequest; view: HeapView; choices: RunChoice[] }
  /** A request that fits nowhere: the play is about to end. */
  | { kind: 'stuck'; op: number; req: AllocRequest; view: HeapView; choices: RunChoice[] }
  | { kind: 'over' }

export function stageOf(s: Session): Stage {
  if (s.ps.mine.ended) return { kind: 'over' }
  const ask = pendingAsk(s.setup, s.ps)
  if (!ask) return { kind: 'free', op: s.ps.mine.next }
  const choices = runChoices(ask.view, ask.req)
  return { kind: choices.some((c) => c.fits) ? 'ask' : 'stuck', op: ask.op, req: ask.req, view: ask.view, choices }
}

/** The learner's heap now. */
export const heapOf = (s: Session): HeapView => {
  const steps = s.ps.mine.steps
  return steps.length > 0 ? steps[steps.length - 1].view : s.setup.model.view(s.setup.model.init())
}

function afterTurn(s: Session, ps: PlacementPlay, freed: Session['freed']): Session {
  const step = ps.mine.steps[ps.mine.steps.length - 1]
  return { ...s, ps, line: turnLine(s.trace.ops, step), freed }
}

/** A free applies by itself: one per turn, and the run it opened is reported so it can flash. */
export function applyFree(s: Session): Session {
  const op = s.trace.ops[s.ps.mine.next]
  if (!op || op.op !== 'free' || s.ps.mine.ended) return s
  const block = heapOf(s).runs.find((r) => !r.free && r.id === op.id)
  const ps = playTurn(s.setup, s.ps, null)
  const opened = block ? runAt(heapOf({ ...s, ps }), block.start) : undefined
  return afterTurn(s, ps, opened ? { start: opened.start / CELL_BYTES, size: opened.size / CELL_BYTES } : null)
}

/** The learner taps a free run (`start` in bytes, as the chips carry it). A run that does not fit is ignored. */
export function placeAt(s: Session, start: number): Session {
  const st = stageOf(s)
  if (st.kind !== 'ask' || !st.choices.some((c) => c.fits && c.start === start)) return s
  return afterTurn(s, playTurn(s.setup, s.ps, { kind: 'place', start }), null)
}

/** "See what happened" on a request that fits nowhere: the play ends on it. */
export function giveUp(s: Session): Session {
  if (stageOf(s).kind !== 'stuck') return s
  return afterTurn(s, playTurn(s.setup, s.ps, { kind: 'reject' }), null)
}

/** The expert skip (spec §11.2): offered after five turns. */
export const canSkip = (s: Session): boolean => s.ps.turns >= SKIP_AFTER_TURNS && !s.ps.mine.ended && s.summary === null

/** The reference's policy finishes the learner's run. */
export function skip(s: Session): Session {
  if (!canSkip(s)) return s
  return { ...s, ps: skipToDebrief(s.setup, s.ps), freed: null, line: '' }
}

/** Reaches the debrief: only a finished run has one. */
export function debrief(s: Session): Session {
  if (!s.ps.mine.ended || s.summary) return s
  return { ...s, summary: summarizePlacement(s.setup, s.ps) }
}

/** The ledger result of a debriefed play. */
export function recordOf(s: Session, ms?: number): PlayResult | null {
  if (!s.summary) return null
  return playResult(s.summary, { provenance: s.provenance, kcs: BLOCK_PLACEMENT.kcs, ms })
}

/* ------------------------------------------------------------------ */
/* Compose (spec §11.3)                                                 */
/* ------------------------------------------------------------------ */

export type ClassChoice = 'none' | 'pow2' | 'fixed2' | 'fixed4'

/** The four dials as the radio groups hold them (strings, so a group is one `value`). */
export interface Dials {
  fit: Fit
  coalesce: 'eager' | 'none'
  minSplit: '1' | '2' | '3'
  classes: ClassChoice
}

/** A plain first-fit allocator, like lab 01's: the learner turns the dials from here. */
export const DEFAULT_DIALS: Dials = { fit: 'first', coalesce: 'eager', minSplit: '1', classes: 'none' }

export interface DialDef {
  key: keyof Dials
  label: string
  hint: string
  options: readonly { value: string; label: string }[]
}

export const DIAL_DEFS: readonly DialDef[] = [
  {
    key: 'fit',
    label: 'Fit',
    hint: 'Which free run takes the block.',
    options: [
      { value: 'first', label: 'First' },
      { value: 'next', label: 'Next' },
      { value: 'best', label: 'Best' },
      { value: 'worst', label: 'Worst' },
    ],
  },
  {
    key: 'coalesce',
    label: 'Coalesce',
    hint: 'Whether a freed run merges with free neighbours.',
    options: [
      { value: 'eager', label: 'Eager' },
      { value: 'none', label: 'None' },
    ],
  },
  {
    key: 'minSplit',
    label: 'Minimum split',
    hint: 'A leftover smaller than this is given away as internal waste.',
    options: [
      { value: '1', label: '1 cell' },
      { value: '2', label: '2 cells' },
      { value: '3', label: '3 cells' },
    ],
  },
  {
    key: 'classes',
    label: 'Size classes',
    hint: 'Round every request up to a class.',
    options: [
      { value: 'none', label: 'None' },
      { value: 'pow2', label: 'Powers of 2' },
      { value: 'fixed2', label: 'Fixed 2 cells' },
      { value: 'fixed4', label: 'Fixed 4 cells' },
    ],
  },
]

/** The dials as a `PolicySpec` (bytes). */
export function specOf(d: Dials): PolicySpec {
  const classes: PolicySpec['classes'] = d.classes === 'fixed2' ? { fixed: 2 * CELL_BYTES } : d.classes === 'fixed4' ? { fixed: 4 * CELL_BYTES } : d.classes
  return { fit: d.fit, coalesce: d.coalesce, minSplit: Number(d.minSplit) * CELL_BYTES, classes }
}

/** Fresh seeds on top of the play's own trace (spec §11.3). */
export const COMPOSE_FRESH_SEEDS = 5

/** The play's trace, then `count` in-band traces drawn from `entropy`. */
export function composeTraces(base: HeapTrace, entropy: number, count = COMPOSE_FRESH_SEEDS): HeapTrace[] {
  const next = splitmix32u(entropy)
  const out = [base]
  for (let i = 0; i < count; i++) out.push(drawPlacementTrace(next()).trace)
  return out
}

export interface ComposeReport {
  mine: ComposeRow[]
  ghost: ComposeRow[]
  ok: boolean
  equivalent: boolean
  fixed: boolean
  /** Ops survived, summed over every trace. */
  survived: number
  ghostSurvived: number
  total: number
  note: string
}

/** Runs the spec on every trace and says what it shows. */
export function composeReport(spec: PolicySpec, traces: readonly HeapTrace[]): ComposeReport {
  const { mine, ghost } = composeTable(spec, traces)
  const { ok, equivalent } = composeOk(spec, traces)
  const sum = (rows: ComposeRow[], f: (r: ComposeRow) => number) => rows.reduce((n, r) => n + f(r), 0)
  const survived = sum(mine, (r) => r.survived)
  const total = sum(mine, (r) => r.ops)
  const fixed = isFixedSpec(spec)
  const noun = `${traces.length} traces`
  let note: string
  if (equivalent) {
    note = `Your spec placed every op exactly where the reference does, on all ${noun}. Best fit with eager coalescing is the reference.`
  } else if (fixed && survived === total) {
    const waste = mine.map((r) => r.internalWastePermille)
    const ext = Math.max(...mine.map((r) => r.externalPermille))
    note = `Fixed blocks survived every op on all ${noun}: ${pct(ext)} external fragmentation, ${pct(Math.min(...waste))} to ${pct(Math.max(...waste))} internal waste. This is the PagedAttention move: T2.L7.`
  } else if (survived === total) {
    note = `Your spec survived every op on all ${noun}, but not by placing like the reference. Compare the fragmentation columns.`
  } else {
    note = `Your spec survived ${survived} of ${total} ops across ${noun}; the reference survived ${sum(ghost, (r) => r.survived)}. Change a dial and run it again.`
  }
  return { mine, ghost, ok, equivalent, fixed, survived, ghostSurvived: sum(ghost, (r) => r.survived), total, note }
}

/** What the table calls each trace: the play's own, then the fresh seeds. */
export const traceLabel = (i: number): string => (i === 0 ? 'this trace' : `new seed ${i}`)

/** The ledger result of one Compose run. `tries` counts the specs run so far. */
export function composeRecord(spec: PolicySpec, report: ComposeReport, base: HeapTrace, tries: number): PlayResult {
  return composeResult(
    spec,
    { ok: report.ok, equivalent: report.equivalent, survived: report.survived, ghostSurvived: report.ghostSurvived, tries },
    { seed: base.seed, provenance: 'practice', kcs: BLOCK_PLACEMENT.kcs },
  )
}
