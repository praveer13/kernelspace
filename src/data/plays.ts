/**
 * The plays (W1 Play → Compose → Code, docs/specs/wave-1.md §11): the registry that /play/:playId, the
 * lesson's play block and verify-plays read, the In-production card's rows, and the pure session model
 * the block-placement components drive. Components keep no rules of their own, so the rules run under
 * `bun test` (tests/plays/play.test.ts).
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

export const PLAYS: Readonly<Record<string, PlayDef>> = { [BLOCK_PLACEMENT.id]: BLOCK_PLACEMENT }
export const PLAY_IDS: readonly string[] = Object.keys(PLAYS)

/** The play behind a route or a block, or undefined for an id that is not a play (also `__proto__`). */
export const getPlay = (id: string): PlayDef | undefined => (Object.hasOwn(PLAYS, id) ? PLAYS[id] : undefined)

/** Where lab 01 starts: the play ends by sending the learner here. */
export const BUILD_THIS = { to: '/forge/rust-allocator', label: 'Build this: lab 01, stage 1 is a 2-minute win' } as const

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
