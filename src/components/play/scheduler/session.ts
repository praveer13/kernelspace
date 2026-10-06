/**
 * The scheduler play's session model (docs/specs/wave-2.md §8.3-8.4): what the components drive, as plain
 * functions so the rules run under `bun test` without a DOM. The world is src/lib/world/sched.ts; this file adds
 * what a screen needs on top of it: the admit list the learner builds by tapping (its order is the tap order),
 * the one optional preempt, the aria-live line per turn, and Compose's dials and report.
 *
 * The ghost lives inside `play.ghost` (the lockstep runner plays it up front) and is read only by the debrief:
 * `stageOf` and the chips are built from the learner's own frame, so nothing on the play screen can show it.
 */

import { byId } from '@/data/claims'
import { SCHEDULER, SCHEDULER_PRODUCTION_ROWS, type ProductionRow } from '@/data/plays'
import { HEADROOM_TOKENS, type SchedAction, type SchedViewReq } from '@/lib/fleet-model'
import type { PlayResult } from '@/lib/ledger/types'
import { splitmix32u } from '@/lib/rng'
import {
  SCHED_PRACTICE_SEED,
  canSkip as canSkipPlay,
  effectiveAdmits,
  groups,
  schedPending,
  schedPlayResult,
  schedSetup,
  schedTurn,
  schedTurnLine,
  skipSchedToDebrief,
  startSchedPlay,
  summarizeSched,
  type SchedPlay,
  type SchedSetup,
  type SchedSummary,
} from '@/lib/world/sched'
import {
  REFERENCE_SCHED_SPEC,
  SCHED_DIALS,
  schedComposeOk,
  schedComposeResult,
  schedComposeTable,
  type SchedComposeRow,
} from '@/lib/world/sched-policy'
import { SCHED_CFG, drawSchedTrace, type SchedSource, type SchedTrace } from '@/lib/world/sched-traces'
import type { SchedFrame, SchedFrameRun, SchedPolicySpec } from '@/lib/world/types'

/* ------------------------------------------------------------------ */
/* One play session                                                     */
/* ------------------------------------------------------------------ */

export type SchedProvenance = 'practice' | 'unseen'

export interface SchedSession {
  trace: SchedTrace
  provenance: SchedProvenance
  setup: SchedSetup
  /** Both sides of the lockstep run. Only the debrief may read `play.ghost`. */
  play: SchedPlay
  /** Waiting requests the learner has tapped, in tap order: the admit order. */
  picks: readonly number[]
  /** The running request to preempt this turn, if any. */
  preempt: number | null
  /** The last turn as the aria-live line says it. */
  line: string
  /** Set once the learner has asked for the debrief. */
  summary: SchedSummary | null
}

export function newSchedSession(trace: SchedTrace): SchedSession {
  const setup = schedSetup(trace)
  return { trace, provenance: trace.provenance, setup, play: startSchedPlay(setup), picks: [], preempt: null, line: '', summary: null }
}

/** What the learner faces now. Built from the learner's side only. */
export type SchedStage = { kind: 'turn'; turn: number; frame: SchedFrame } | { kind: 'over' }

export function stageOf(s: SchedSession): SchedStage {
  const p = schedPending(s.setup, s.play)
  return p ? { kind: 'turn', turn: p.turn, frame: p.frame } : { kind: 'over' }
}

/** The learner's frame now: the pending turn's, or the end of the run once the play is over. */
export const frameOf = (s: SchedSession): SchedFrame => s.setup.model.view(s.play.mine)

const blocksFor = (tokens: number, blockSize: number) => Math.ceil(tokens / blockSize)
/** Tokens a running request holds in the pool: its prompt, plus every decoded token after the first. */
const held = (r: { prompt: number; decoded: number }) => r.prompt + Math.max(0, r.decoded - 1)

/** The action the picks and the preempt make. */
export const actionOf = (s: SchedSession): SchedAction => ({ admit: [...s.picks], preempt: s.preempt === null ? [] : [s.preempt] })

/** Free tokens and free slots after this turn's preempt and picks: what the next chip has to fit. */
export function roomAfter(frame: SchedFrame, picks: readonly number[], preempt: number | null): { free: number; slots: number } {
  const v = frame.view
  let free = frame.free
  let slots = v.maxRunning - v.running.length
  const gone = preempt === null ? undefined : v.running.find((r) => r.id === preempt)
  if (gone) {
    free += blocksFor(held(gone), frame.blockSize) * frame.blockSize
    slots++
  }
  for (const id of effectiveAdmits(v, { admit: [...picks], preempt: gone ? [gone.id] : [] }, frame.blockSize)) {
    const w = v.waiting.find((r) => r.id === id) as SchedViewReq
    free -= blocksFor(w.prompt, frame.blockSize) * frame.blockSize
    slots--
  }
  return { free, slots }
}

/** Why `id` cannot be tapped now (empty = it can). A tapped request can always be untapped. */
export function pickProblem(frame: SchedFrame, picks: readonly number[], preempt: number | null, id: number): string {
  if (picks.includes(id)) return ''
  const w = frame.view.waiting.find((r) => r.id === id)
  if (!w) return 'not waiting'
  const room = roomAfter(frame, picks, preempt)
  if (room.slots <= 0) return `batch full: ${frame.view.maxRunning} running`
  const need = blocksFor(w.prompt, frame.blockSize) * frame.blockSize
  return need > room.free ? `needs ${groups(need)}, ${groups(room.free)} free` : ''
}

/** Taps a waiting request: adds it to the admit order, or takes it out again. */
export function togglePick(s: SchedSession, id: number): SchedSession {
  const st = stageOf(s)
  if (st.kind !== 'turn') return s
  if (s.picks.includes(id)) return { ...s, picks: s.picks.filter((p) => p !== id) }
  if (pickProblem(st.frame, s.picks, s.preempt, id) !== '') return s
  return { ...s, picks: [...s.picks, id] }
}

/** Marks a running request for preemption, or clears it. One per turn; picks that no longer fit are dropped. */
export function togglePreempt(s: SchedSession, id: number): SchedSession {
  const st = stageOf(s)
  if (st.kind !== 'turn' || !st.frame.view.running.some((r) => r.id === id)) return s
  const preempt = s.preempt === id ? null : id
  const picks = effectiveAdmits(st.frame.view, { admit: [...s.picks], preempt: preempt === null ? [] : [preempt] }, st.frame.blockSize)
  return { ...s, preempt, picks }
}

/** "Run iteration": the learner's action at the pending turn. The next turn, if any, is already waiting. */
export function runIteration(s: SchedSession): SchedSession {
  const st = stageOf(s)
  if (st.kind !== 'turn') return s
  const action = actionOf(s)
  return { ...s, play: schedTurn(s.setup, s.play, action), picks: [], preempt: null, line: schedTurnLine(st.frame, action) }
}

/** The expert skip (spec §8.3): offered after five turns. */
export const canSkip = (s: SchedSession): boolean => canSkipPlay(s.play) && s.summary === null

/** The reference finishes the learner's run from where they stand. */
export function skip(s: SchedSession): SchedSession {
  if (!canSkip(s)) return s
  return { ...s, play: skipSchedToDebrief(s.play), picks: [], preempt: null, line: '' }
}

/** Reaches the debrief: only a finished run has one. */
export function debrief(s: SchedSession): SchedSession {
  if (!s.play.ended || s.summary) return s
  return { ...s, summary: summarizeSched(s.setup, s.play) }
}

/** The ledger result of a debriefed play. */
export function recordOf(s: SchedSession, ms?: number): PlayResult | null {
  if (!s.summary) return null
  return schedPlayResult(s.summary, { provenance: s.provenance, kcs: [...SCHEDULER.kcs], ms })
}

/* ------------------------------------------------------------------ */
/* Display helpers                                                      */
/* ------------------------------------------------------------------ */

export { groups, HEADROOM_TOKENS }

/** "1 iteration", "5 iterations". */
export const iterations = (n: number): string => `${n} iteration${n === 1 ? '' : 's'}`

/** "#12 · 1,024 tokens": a request as a chip reads it. */
export const requestLabel = (r: { id: number; prompt: number }): string => `#${r.id} · ${groups(r.prompt)} tokens`

/** The KV bar's segments, in tokens: what running requests hold, what this turn's picks take, the headroom, and what is left. */
export interface KvSplit {
  capacity: number
  used: number
  chosen: number
  /** HEADROOM_TOKENS for each running request and each pick, as far as the pool has room for it. */
  headroom: number
  free: number
}

export function kvSplit(frame: SchedFrame, picks: readonly number[] = [], preempt: number | null = null): KvSplit {
  const v = frame.view
  const gone = preempt === null ? undefined : v.running.find((r) => r.id === preempt)
  const admitted = effectiveAdmits(v, { admit: [...picks], preempt: gone ? [gone.id] : [] }, frame.blockSize)
  const capacity = v.memCap
  const used = Math.max(0, v.memUsed - (gone ? blocksFor(held(gone), frame.blockSize) * frame.blockSize : 0))
  const chosen = admitted.reduce((a, id) => a + blocksFor((v.waiting.find((r) => r.id === id) as SchedViewReq).prompt, frame.blockSize) * frame.blockSize, 0)
  const left = Math.max(0, capacity - used - chosen)
  const headroom = Math.min(left, HEADROOM_TOKENS * (v.running.length - (gone ? 1 : 0) + admitted.length))
  return { capacity, used, chosen, headroom, free: left - headroom }
}

/** The bar's text equivalent. */
export function kvText(split: KvSplit, running: number): string {
  const parts = [`${groups(split.used)} of ${groups(split.capacity)} tokens in use by ${running} running`]
  if (split.chosen > 0) parts.push(`${groups(split.chosen)} chosen to admit`)
  parts.push(`${groups(split.headroom)} held as headroom`, `${groups(split.free)} free beyond it`)
  return `KV pool: ${parts.join(', ')}`
}

/** The decode progress of a running request, in words. */
export function progressWords(r: SchedFrameRun): string {
  if (r.prefillLeft > 0) return `prefilling, ${groups(r.prefillLeft)} tokens left`
  return `decoded ${r.decoded} of ${r.output}`
}

/** "vllm-project/vllm v0.31.0", "sgl-project/sglang v0.5.21": the releases the card's claims pin, in row order, read from the claims. */
export function pinnedReleases(rows: readonly ProductionRow[] = SCHEDULER_PRODUCTION_ROWS): string[] {
  const out: string[] = []
  for (const r of rows) {
    const pin = byId[r.claim]?.pin
    const text = pin ? `${pin.repo} ${pin.ref}` : ''
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

/** Where a new session's minute comes from, for the line under the heading. */
export const provenanceLine = (p: SchedProvenance): string => (p === 'unseen' ? 'a new minute' : 'the shared practice minute')

/* ------------------------------------------------------------------ */
/* Compose (spec §8.4)                                                  */
/* ------------------------------------------------------------------ */

/** A plain first-come-first-served scheduler with no guard, no headroom and no preemption: the learner turns the dials from here. */
export const DEFAULT_SCHED_SPEC: SchedPolicySpec = { order: 'fcfs', guard: 0, headroom: 0, preempt: 'none' }

export type SchedDialDef = {
  [K in keyof SchedPolicySpec]: { key: K; label: string; hint: string; options: readonly { value: SchedPolicySpec[K]; label: string }[] }
}[keyof SchedPolicySpec]

const tokens = (n: number) => `${groups(n)} token${n === 1 ? '' : 's'}`

export const SCHED_DIAL_DEFS: readonly SchedDialDef[] = [
  {
    key: 'order',
    label: 'Order',
    hint: 'Which waiting request is admitted first.',
    options: [
      { value: 'fcfs', label: 'Arrival order' },
      { value: 'sjf', label: 'Shortest prompt first' },
    ],
  },
  {
    key: 'guard',
    label: 'Guard',
    hint: 'After this many iterations a waiting request goes first, whatever its size. The long guard never fires inside one minute; the short one shows starvation.',
    options: SCHED_DIALS.guard.map((g) => ({ value: g, label: g === 0 ? 'None' : `${groups(g)} iterations` })),
  },
  {
    key: 'headroom',
    label: 'Headroom',
    hint: 'Tokens reserved for each admitted request to grow into while it decodes.',
    options: SCHED_DIALS.headroom.map((h) => ({ value: h, label: tokens(h) })),
  },
  {
    key: 'preempt',
    label: 'Preempt',
    hint: 'When the next decode step would run the pool dry: do nothing, or preempt the newest running request.',
    options: [
      { value: 'none', label: 'None' },
      { value: 'newest', label: 'Newest running' },
    ],
  },
]

/** One dial turned: the spec with `key` set. */
export function withDial<K extends keyof SchedPolicySpec>(spec: SchedPolicySpec, key: K, value: SchedPolicySpec[K]): SchedPolicySpec {
  return { ...spec, [key]: value }
}

/** Fresh minutes on top of the play's own (spec §8.4: "the practice minute and 5 fresh minutes"). */
export const SCHED_COMPOSE_FRESH = 5

/** The play's minute, then `count` in-band minutes drawn from `entropy`. */
export function schedComposeTraces(base: SchedTrace, source: SchedSource, entropy: number, count = SCHED_COMPOSE_FRESH): SchedTrace[] {
  const next = splitmix32u(entropy)
  const out = [base]
  for (let i = 0; i < count; i++) out.push(drawSchedTrace(next(), source).trace)
  return out
}

/** What the table calls each minute: the play's own, then the fresh ones. */
export const schedTraceLabel = (i: number): string => (i === 0 ? 'this minute' : `new minute ${i}`)

export interface SchedComposeReport {
  mine: SchedComposeRow[]
  ghost: SchedComposeRow[]
  ok: boolean
  equivalent: boolean
  /** Requests within SLO, summed over every minute. */
  survived: number
  ghostSurvived: number
  total: number
  note: string
}

const guardWords = (g: number) => (g === 0 ? 'no guard' : `a guard of ${groups(g)} iterations`)

/** Runs the spec on every minute and says what it shows. */
export function schedComposeReport(spec: SchedPolicySpec, traces: readonly SchedTrace[]): SchedComposeReport {
  const { mine, ghost } = schedComposeTable(spec, traces)
  const { ok, equivalent } = schedComposeOk(spec, traces)
  const sum = (rows: SchedComposeRow[], f: (r: SchedComposeRow) => number) => rows.reduce((n, r) => n + f(r), 0)
  const survived = sum(mine, (r) => r.met)
  const ghostSurvived = sum(ghost, (r) => r.met)
  const total = sum(mine, (r) => r.total)
  const noun = `${traces.length} minutes`
  const r = REFERENCE_SCHED_SPEC
  let note: string
  if (equivalent) {
    note = `Your spec chose exactly what the reference chooses at every iteration, on all ${noun}: ${r.order === 'sjf' ? 'shortest prompt first' : 'arrival order'}, ${guardWords(r.guard)}, ${tokens(r.headroom)} of headroom, no preemption.`
  } else if (ok) {
    note = `Your spec served at least as many requests within the SLO as the reference on all ${noun}, without choosing what it chooses. Compare goodput and TTFT p95 in the table.`
  } else {
    note = `Your spec served ${survived} of ${total} requests within the SLO across ${noun}; the reference served ${ghostSurvived}. Change a dial and run it again.`
  }
  return { mine, ghost, ok, equivalent, survived, ghostSurvived, total, note }
}

/** Whole per mille as a percentage with one decimal ("12.5 %"). */
export const permille = (n: number): string => `${(n / 10).toFixed(1)} %`

/** The ledger result of one Compose run. `tries` counts the specs run so far. */
export function schedComposeRecord(spec: SchedPolicySpec, report: SchedComposeReport, base: SchedTrace, tries: number): PlayResult {
  return schedComposeResult(
    spec,
    { ok: report.ok, equivalent: report.equivalent, survived: report.survived, ghostSurvived: report.ghostSurvived, tries },
    { seed: base.seed ?? SCHED_PRACTICE_SEED, provenance: 'practice', kcs: [...SCHEDULER.kcs] },
  )
}

/** The SLO a table row is held to, as the caption says it. */
export const sloLine = `a first token within ${SCHED_CFG.sloTtft} iterations of arrival`
