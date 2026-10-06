/**
 * The pure model behind SIM-02 `sim-allocator` (docs/specs/wave-1.md §10.2–10.4, task C9).
 *
 * The toy allocator is the World's heap engine (`src/lib/world/heap.ts`) plus four rules the sim has
 * always had: every block pays an 8 B header, a tail under 24 B is not worth splitting, next fit keeps
 * a rover (an index into the block list), and a free merges only with its two neighbours. Fixed-block
 * mode (the PagedAttention move) is the engine's `{ fixed }` size class, capped at one block per
 * request. The sim and phone mode both read this module, so a prediction is graded against exactly
 * what the hands-on run measures.
 *
 * The four task scripts at the bottom are the tasks' canonical configs: one deterministic op list each,
 * played live by the sim (one op per step) and run in one go by `PHONE_MODELS`. All scenario numbers are
 * synthetic.
 */

import { allocWith, alignedStart, createHeap, freeId, runFits } from '@/lib/world/heap'
import type { HeapOptions, HeapState } from '@/lib/world/heap'
import { bestFit, firstFit } from '@/lib/world/placement'
import type { AllocRequest, HeapRun, HeapView, Placement } from '@/lib/world/types'
import type { CanonicalOutcome } from '@/lib/sims/host'

export const HEAP_SIZE = 1024
export const HEADER = 8
/** Header plus the smallest payload: a tail under this stays inside the allocation (a splinter). */
export const MIN_SPLIT = 24
export const DEFAULT_FIXED_BLOCK = 64
export const FIXED_BLOCK_SIZES = [16, 32, 64, 128, 256] as const

export type Strategy = 'first' | 'next' | 'best'
export const STRATEGIES: readonly Strategy[] = ['first', 'next', 'best']

export const hx4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`

/* ------------------------------------------------------------------ */
/* The heap                                                             */
/* ------------------------------------------------------------------ */

/**
 * Engine options: byte granule and alignment (the header is part of the request), no merging inside the
 * engine. `free` merges the neighbours of the freed block itself, so turning coalescing on later does not
 * sweep up pairs of free blocks that were left apart while it was off.
 */
const VARIABLE: HeapOptions = { capacity: HEAP_SIZE, coalesce: false, minSplit: MIN_SPLIT, granule: 1, classes: 'none' }

export interface AllocHeap {
  readonly world: HeapState
  /** Next fit's cursor: an index into the block list, like the sim's original. */
  readonly rover: number
  /** Allocation id source. */
  readonly seq: number
  /** Fixed-block size in bytes, or null for the variable heap. */
  readonly fixed: number | null
}

export const blankHeap = (): AllocHeap => ({ world: createHeap(VARIABLE), rover: 0, seq: 1, fixed: null })

export const fixedHeap = (blockSize: number): AllocHeap => ({
  world: createHeap({ ...VARIABLE, classes: { fixed: blockSize } }),
  rover: 0,
  seq: 1,
  fixed: blockSize,
})

/** One block as the heap strip draws it. */
export interface Block {
  /** Allocation id of a used block (0 for a free one: free blocks have no identity). */
  id: number
  start: number
  /** Total bytes, header included. */
  size: number
  free: boolean
  /** Requested payload. */
  req: number
  /** Unsplittable tail given away with the block (variable heap only). */
  splinter: number
}

export function blocksOf(h: AllocHeap): Block[] {
  return h.world.runs.map((r) => {
    if (r.free) return { id: 0, start: r.start, size: r.size, free: true, req: 0, splinter: 0 }
    const held = r.req ?? r.size
    return h.fixed === null
      ? { id: r.id ?? 0, start: r.start, size: r.size, free: false, req: Math.max(0, held - HEADER), splinter: r.size - held }
      : { id: r.id ?? 0, start: r.start, size: r.size, free: false, req: held, splinter: 0 }
  })
}

export function fragmentation(blocks: readonly Block[]): { totalFree: number; largest: number; ratio: number } {
  let totalFree = 0
  let largest = 0
  for (const b of blocks) {
    if (!b.free) continue
    totalFree += b.size
    if (b.size > largest) largest = b.size
  }
  return { totalFree, largest, ratio: totalFree > 0 ? largest / totalFree : 1 }
}

/** Bytes inside used fixed blocks that the requests did not ask for. */
export function fixedInternalWaste(h: AllocHeap): number {
  if (h.fixed === null) return 0
  let waste = 0
  for (const b of blocksOf(h)) if (!b.free) waste += h.fixed - b.req
  return waste
}

/** Next fit: scan the block list from the rover, wrapping, and take the first block that fits. */
function nextFitFrom(rover: number): (view: HeapView, req: AllocRequest) => Placement {
  return (view, req) => {
    const runs = view.runs
    for (let k = 0; k < runs.length; k++) {
      const run = runs[(rover + k) % runs.length]
      if (runFits(run, req.size, req.align)) return { kind: 'place', start: alignedStart(run, req.align) }
    }
    return { kind: 'reject' }
  }
}

export interface MallocResult {
  heap: AllocHeap
  block: Block | null
  /** Log suffix: the split, or the splinter that was burned. */
  note: string
  /** Why it failed, when it did. */
  reason?: 'too-big' | 'full' | 'no-fit'
}

/** malloc(n): the engine places it, the model keeps the rover and the log note. */
export function malloc(h: AllocHeap, n: number, strategy: Strategy): MallocResult {
  const id = h.seq
  if (h.fixed !== null) {
    if (n > h.fixed) return { heap: h, block: null, note: '', reason: 'too-big' }
    const out = allocWith(h.world, { id, size: n, align: 1 }, firstFit)
    if (!out.ok) return { heap: h, block: null, note: '', reason: 'full' }
    const heap: AllocHeap = { ...h, world: out.state, seq: id + 1 }
    return { heap, block: blocksOf(heap).find((b) => b.id === id) ?? null, note: '' }
  }

  const need = n + HEADER
  const place = strategy === 'first' ? firstFit : strategy === 'best' ? bestFit : nextFitFrom(h.rover)
  const out = allocWith(h.world, { id, size: need, align: 1 }, place)
  if (!out.ok || out.at === undefined) return { heap: h, block: null, note: '', reason: 'no-fit' }
  const runs = out.state.runs
  const idx = runs.findIndex((r) => r.start === out.at)
  const split = runs.length > h.world.runs.length
  const used = runs[idx]
  let note = ''
  let rover = idx
  if (split) {
    const rest = runs[idx + 1].size
    note = ` (split ${used.size + rest}→${n}+${rest})`
    rover = idx + 1
  } else if (used.size > need) {
    note = ` (+${used.size - need}B splinter burned)`
  }
  const heap: AllocHeap = { ...h, world: out.state, rover, seq: id + 1 }
  return { heap, block: blocksOf(heap)[idx], note }
}

export interface FreeResult {
  heap: AllocHeap
  /** Start of the freed block, or -1 for an unknown id. */
  addr: number
  /** Log suffix: the merges, in the order they happened (forward, then backward). */
  note: string
}

/** free(id), merging with a free next and previous block when `coalesce` is on (variable heap only). */
export function free(h: AllocHeap, id: number, coalesce: boolean): FreeResult {
  const was = h.world.runs.find((r) => !r.free && r.id === id)
  if (was === undefined) return { heap: h, addr: -1, note: '' }
  let runs: HeapRun[] = [...freeId(h.world, id).runs]
  const idx = runs.findIndex((r) => r.start === was.start)
  const notes: string[] = []
  if (coalesce && h.fixed === null) {
    let at = idx
    if (at + 1 < runs.length && runs[at + 1].free) {
      const merged = runs[at].size + runs[at + 1].size
      notes.push(`COALESCE ${hx4(runs[at].start)}+${hx4(runs[at + 1].start)} → ${merged}B`)
      runs = [...runs.slice(0, at), { start: runs[at].start, size: merged, free: true }, ...runs.slice(at + 2)]
    }
    if (at - 1 >= 0 && runs[at - 1].free) {
      const merged = runs[at - 1].size + runs[at].size
      notes.push(`COALESCE ${hx4(runs[at - 1].start)}+${hx4(runs[at].start)} → ${merged}B`)
      runs = [...runs.slice(0, at - 1), { start: runs[at - 1].start, size: merged, free: true }, ...runs.slice(at + 1)]
      at -= 1
    }
  }
  const heap: AllocHeap = { ...h, world: { options: h.world.options, runs }, rover: Math.min(h.rover, runs.length - 1) }
  return { heap, addr: was.start, note: notes.join(' · ') }
}

/* ------------------------------------------------------------------ */
/* URL / lesson config                                                  */
/* ------------------------------------------------------------------ */

export interface AllocCfg {
  s?: Strategy
  c?: boolean
  f?: boolean
  /** One `[start, size, free, payload]` per block; absent: a fresh heap. */
  b?: [number, number, number, number][]
  z?: number
}

export function heapToCfg(h: AllocHeap, s: Strategy, c: boolean, z: number): AllocCfg {
  return { s, c, f: h.fixed !== null, z, b: blocksOf(h).map((b) => [b.start, b.size, b.free ? 1 : 0, b.req]) }
}

export interface RestoredConfig {
  heap: AllocHeap
  strategy: Strategy
  coalesce: boolean
  fixed: boolean
  fixedSize: number
}

const isFixedSize = (z: unknown): z is number => typeof z === 'number' && Number.isInteger(z) && z >= 16 && z <= 512 && HEAP_SIZE % z === 0

/**
 * What a `?cfg=` or a lesson block's `config` says, with anything malformed replaced by the default.
 * A block list that does not tile the heap exactly is dropped whole (a fresh heap), not patched.
 */
export function restoreConfig(cfg: unknown): RestoredConfig {
  const c = (typeof cfg === 'object' && cfg !== null ? cfg : {}) as Partial<Record<keyof AllocCfg, unknown>>
  const strategy: Strategy = c.s === 'first' || c.s === 'next' || c.s === 'best' ? c.s : 'first'
  const coalesce = typeof c.c === 'boolean' ? c.c : true
  const fixedSize = isFixedSize(c.z) ? c.z : DEFAULT_FIXED_BLOCK
  const fixed = c.f === true
  const heap = heapFromBlocks(c.b, fixed ? fixedSize : null)
  const mode = heap !== null ? heap.fixed !== null : fixed
  return { heap: heap ?? (mode ? fixedHeap(fixedSize) : blankHeap()), strategy, coalesce, fixed: mode, fixedSize }
}

function heapFromBlocks(raw: unknown, fixed: number | null): AllocHeap | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const runs: HeapRun[] = []
  let at = 0
  for (let i = 0; i < raw.length; i++) {
    const row: unknown = raw[i]
    if (!Array.isArray(row) || row.length < 4 || !row.slice(0, 4).every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 0)) return null
    const [start, size, isFree, payload] = row as number[]
    if (start !== at || size <= 0 || at + size > HEAP_SIZE || (fixed !== null && size !== fixed)) return null
    runs.push(
      isFree === 1
        ? { start, size, free: true }
        : { start, size, free: false, id: i + 1, req: Math.min(size, fixed === null ? payload + HEADER : payload) },
    )
    at += size
  }
  if (at !== HEAP_SIZE) return null
  const options = fixed === null ? VARIABLE : { ...VARIABLE, classes: { fixed } }
  return { world: { options, runs }, rover: 0, seq: raw.length + 1, fixed }
}

/* ------------------------------------------------------------------ */
/* Workloads and long traces                                            */
/* ------------------------------------------------------------------ */

export type WorkOp = { type: 'malloc'; size: number } | { type: 'free'; slot?: number }

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const WORK_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256]

export function genWorkload(seed: number): WorkOp[] {
  const rng = mulberry32(seed)
  return Array.from({ length: 40 }, () =>
    rng() < 0.6
      ? ({ type: 'malloc', size: WORK_SIZES[Math.floor(rng() * WORK_SIZES.length)] } as WorkOp)
      : ({ type: 'free' } as WorkOp),
  )
}

export function makeTrace(length: number, seed: number, alternating: boolean): WorkOp[] {
  const rng = mulberry32(seed)
  let live = 0
  return Array.from({ length }, (_, i) => {
    if (live > 2 && (i % 5 === 4 || rng() < 0.34)) {
      const slot = Math.floor(rng() * live)
      live -= 1
      return { type: 'free', slot }
    }
    live += 1
    const size = alternating ? (i % 2 === 0 ? 24 : 96) : WORK_SIZES[Math.floor(rng() * WORK_SIZES.length)]
    return { type: 'malloc', size }
  })
}

export type AllocationFailureSnapshot = {
  operationIndex: number
  requestedSize: number
  totalFreeBytes: number
  largestFreeBlock: number
}

export type TraceResult = {
  history: number[]
  failureSnapshots: AllocationFailureSnapshot[]
  finalRatio: number
  internalWaste: number
  metadata: number
}

export function simulateTrace(trace: readonly WorkOp[], strategy: Strategy, fixedBlockSize: number | null): TraceResult {
  let heap = fixedBlockSize ? fixedHeap(fixedBlockSize) : blankHeap()
  let liveIds: number[] = []
  const failureSnapshots: AllocationFailureSnapshot[] = []
  const history: number[] = []
  const sampleEvery = Math.max(1, Math.floor(trace.length / 80))

  trace.forEach((op, index) => {
    if (op.type === 'free') {
      if (liveIds.length > 0) {
        const liveIndex = (op.slot ?? 0) % liveIds.length
        const id = liveIds[liveIndex]
        liveIds = liveIds.filter((_, i) => i !== liveIndex)
        heap = free(heap, id, !fixedBlockSize).heap
      }
    } else {
      const res = malloc(heap, op.size, strategy)
      if (res.block) {
        heap = res.heap
        liveIds.push(res.block.id)
      } else {
        const f = fragmentation(blocksOf(heap))
        failureSnapshots.push({ operationIndex: index + 1, requestedSize: op.size, totalFreeBytes: f.totalFree, largestFreeBlock: f.largest })
      }
    }
    if (index % sampleEvery === 0 || index === trace.length - 1) {
      history.push(fixedBlockSize ? 1 : fragmentation(blocksOf(heap)).ratio)
    }
  })

  const final = fragmentation(blocksOf(heap))
  return {
    history,
    failureSnapshots,
    finalRatio: fixedBlockSize ? 1 : final.ratio,
    internalWaste: fixedInternalWaste(heap),
    metadata: heap.world.runs.length * HEADER,
  }
}

/** The same trace under every placement policy (the heap is variable-block, coalescing on). */
export function compareStrategies(trace: readonly WorkOp[]): Record<Strategy, TraceResult> {
  return { first: simulateTrace(trace, 'first', null), next: simulateTrace(trace, 'next', null), best: simulateTrace(trace, 'best', null) }
}

/** The trace the sim's long-run buttons and the comparison start from. */
export const ALTERNATING_TRACE = { length: 1000, seed: 0xa11e, alternating: true }
export const ADVERSARIAL_TRACE = { length: 5000, seed: 0xc0ffee, alternating: false }

/* ------------------------------------------------------------------ */
/* The four task scripts (canonical configs of the outcome tasks)       */
/* ------------------------------------------------------------------ */

/** A scripted op: `release` frees the allocation made by the `handle`-th malloc of the script (1-based; a failed malloc is skipped). */
export type ScriptOp = { type: 'malloc'; size: number } | { type: 'release'; handle: number }

export type ScriptId = 'frag-first-fit' | 'coalesce-recover' | 'fixed-block-waste' | 'policy-race'

export interface TaskScript {
  id: ScriptId
  /** The button's caption. */
  label: string
  /** The strategy the script forces; null leaves the learner's choice (the race is graded per policy). */
  strategy: Strategy | null
  /** Fixed-block size, or null for the variable heap. Coalescing is never forced: it is the learner's switch. */
  fixed: number | null
  ops: readonly ScriptOp[]
}

const mallocs = (sizes: readonly number[]): ScriptOp[] => sizes.map((size) => ({ type: 'malloc', size }))
const releases = (handles: readonly number[]): ScriptOp[] => handles.map((handle) => ({ type: 'release', handle }))

/** Eight 96 B blocks (104 B each with the header), then every other one freed. */
const EIGHT = mallocs(Array.from({ length: 8 }, () => 96))
const EVERY_OTHER = releases([1, 3, 5, 7])

export const SCRIPTS: Readonly<Record<ScriptId, TaskScript>> = {
  'frag-first-fit': {
    id: 'frag-first-fit',
    label: 'Eight blocks, free every other one',
    strategy: 'first',
    fixed: null,
    ops: [...EIGHT, ...EVERY_OTHER],
  },
  'coalesce-recover': {
    id: 'coalesce-recover',
    label: 'Heal the middle',
    strategy: 'first',
    fixed: null,
    ops: [...EIGHT, ...EVERY_OTHER, ...releases([4])],
  },
  'fixed-block-waste': {
    id: 'fixed-block-waste',
    label: 'Fixed 64 B blocks, eight requests',
    strategy: 'first',
    fixed: 64,
    ops: mallocs([20, 33, 64, 50, 17, 41, 9, 60]),
  },
  // A full heap with two holes (blocks 1 and 3: 300 B and 120 B with their headers), then two requests.
  'policy-race': {
    id: 'policy-race',
    label: 'Two holes, two requests',
    strategy: null,
    fixed: null,
    ops: [...mallocs([292, 92, 112, 496]), ...releases([1, 3]), ...mallocs([100, 280])],
  },
}

export const SCRIPT_IDS = Object.keys(SCRIPTS) as ScriptId[]

/** Keys the sim reports through `observe` (the tasks' `observe` fields). */
export const OBSERVE = {
  fragPct: 'alloc.frag-pct',
  largestFree: 'alloc.largest-free',
  largestFreeOff: 'alloc.largest-free-off',
  fixedWaste: 'alloc.fixed-waste',
  /** One key per policy, so only a run under the policy the prediction names is graded. */
  race: (strategy: Strategy) => `alloc.race-${strategy}`,
} as const

export interface ScriptObservation {
  key: string
  value: number
  unit: string
}

/**
 * What the sim reports when the script's last op has run. A result that depends on a switch carries it in
 * the key (the race per policy, the heal per coalescing setting), so only a run under the condition the
 * prediction names is graded.
 */
export function observeScript(id: ScriptId, heap: AllocHeap, strategy: Strategy, coalesce: boolean): ScriptObservation {
  const f = fragmentation(blocksOf(heap))
  switch (id) {
    case 'frag-first-fit':
      return { key: OBSERVE.fragPct, value: Math.round(f.ratio * 100), unit: '%' }
    case 'coalesce-recover':
      return { key: coalesce ? OBSERVE.largestFree : OBSERVE.largestFreeOff, value: f.largest, unit: 'B' }
    case 'fixed-block-waste':
      return { key: OBSERVE.fixedWaste, value: fixedInternalWaste(heap), unit: 'B' }
    case 'policy-race':
      return { key: OBSERVE.race(strategy), value: f.totalFree, unit: 'B' }
  }
}

export interface ScriptStep {
  op: ScriptOp
  /** The malloc landed, or the release found its block. */
  ok: boolean
  heap: AllocHeap
}

export interface ScriptRun {
  heap: AllocHeap
  steps: ScriptStep[]
}

/** Runs the script from a fresh heap with the policy the script forces (else `strategy`). */
export function runScript(script: TaskScript, strategy: Strategy, coalesce = true): ScriptRun {
  const use = script.strategy ?? strategy
  let heap = script.fixed === null ? blankHeap() : fixedHeap(script.fixed)
  const handles: (number | null)[] = []
  const steps: ScriptStep[] = []
  for (const op of script.ops) {
    let ok = false
    if (op.type === 'malloc') {
      const res = malloc(heap, op.size, use)
      handles.push(res.block ? res.block.id : null)
      if (res.block) heap = res.heap
      ok = res.block !== null
    } else {
      const id = handles[op.handle - 1]
      if (id !== null && id !== undefined) {
        heap = free(heap, id, coalesce).heap
        ok = true
      }
    }
    steps.push({ op, ok, heap })
  }
  return { heap, steps }
}

/* ------------------------------------------------------------------ */
/* Canonical outcomes for phone mode                                    */
/* ------------------------------------------------------------------ */

const pct = (r: number) => Math.round(r * 100)

function describeOp(op: ScriptOp, ok: boolean): string {
  if (op.type === 'malloc') return ok ? `malloc ${op.size} B` : `malloc ${op.size} B (fails)`
  return `free block ${op.handle}`
}

function fragOutcome(): CanonicalOutcome {
  const { steps, heap } = runScript(SCRIPTS['frag-first-fit'], 'first')
  const f = fragmentation(blocksOf(heap))
  const rows = steps.map((s, i) => {
    const g = fragmentation(blocksOf(s.heap))
    return [i + 1, describeOp(s.op, s.ok), g.totalFree, g.largest, pct(g.ratio)] as const
  })
  return {
    actual: pct(f.ratio),
    unit: '%',
    summary: `${f.totalFree} B are free, but the largest free block is ${f.largest} B: ${pct(f.ratio)}% of the free bytes are usable in one piece.`,
    chart: {
      kind: 'line',
      xLabel: 'script step',
      yLabel: 'largest free ÷ total free (%)',
      points: rows.map((r) => ({ x: r[0], y: r[4] })),
      mark: rows.length - 1,
    },
    table: {
      caption: 'Heap after each step of the script (first-fit, coalescing on)',
      columns: ['Step', 'Operation', 'Free bytes', 'Largest free block (B)', 'Usable (%)'],
      rows,
      announce: `After freeing every other block, ${f.totalFree} bytes are free and the largest block is ${f.largest} bytes: ${pct(f.ratio)} percent usable.`,
    },
  }
}

function coalesceOutcome(): CanonicalOutcome {
  const script = SCRIPTS['coalesce-recover']
  const rows = ([true, false] as const).map((on) => {
    const { heap } = runScript(script, 'first', on)
    const blocks = blocksOf(heap)
    const f = fragmentation(blocks)
    return { on, f, freeBlocks: blocks.filter((b) => b.free).length }
  })
  const on = rows[0]
  const off = rows[1]
  return {
    actual: on.f.largest,
    unit: 'B',
    summary: `With coalescing on, freeing block 4 fuses it with its free neighbours into a ${on.f.largest} B block. With it off the largest block stays ${off.f.largest} B.`,
    chart: {
      kind: 'bars',
      xLabel: 'coalescing',
      yLabel: 'largest free block (B)',
      points: [
        { x: 'off', y: off.f.largest, label: 'off' },
        { x: 'on', y: on.f.largest, label: 'on' },
      ],
      mark: 1,
    },
    table: {
      caption: 'After the script, with and without coalescing',
      columns: ['Coalescing', 'Free blocks', 'Free bytes', 'Largest free block (B)'],
      rows: [off, on].map((r) => [r.on ? 'on' : 'off', r.freeBlocks, r.f.totalFree, r.f.largest]),
      announce: `With coalescing, the largest free block is ${on.f.largest} bytes; without it, ${off.f.largest} bytes.`,
    },
  }
}

function fixedOutcome(): CanonicalOutcome {
  const script = SCRIPTS['fixed-block-waste']
  const block = script.fixed ?? DEFAULT_FIXED_BLOCK
  const sizes = script.ops.flatMap((o) => (o.type === 'malloc' ? [o.size] : []))
  const waste = sizes.map((n) => block - n)
  const total = waste.reduce((a, b) => a + b, 0)
  return {
    actual: total,
    unit: 'B',
    summary: `Every request takes one whole ${block} B block, so ${total} B sit unused inside the blocks. Between blocks there is nothing to waste: external fragmentation is 0.`,
    chart: {
      kind: 'bars',
      xLabel: 'request (B)',
      yLabel: 'internal waste (B)',
      points: sizes.map((n, i) => ({ x: i + 1, y: waste[i], label: String(n) })),
    },
    table: {
      caption: `Internal waste per request in ${block} B blocks`,
      columns: ['Request (B)', 'Block (B)', 'Wasted inside the block (B)'],
      rows: [...sizes.map((n, i) => [n, block, waste[i]]), ['Total', '', total]],
      announce: `Fixed ${block} byte blocks waste ${total} bytes across ${sizes.length} requests, with no external fragmentation.`,
    },
  }
}

function raceOutcome(): CanonicalOutcome {
  const script = SCRIPTS['policy-race']
  const requests = script.ops.filter((o) => o.type === 'malloc').slice(-2)
  const results = STRATEGIES.map((s) => {
    const { heap, steps } = runScript(script, s)
    const f = fragmentation(blocksOf(heap))
    return { s, f, served: steps.slice(-requests.length).filter((st) => st.ok).length }
  })
  const first = results[0]
  const best = results[2]
  return {
    actual: first.f.totalFree,
    unit: 'B',
    summary: `First-fit ends with ${first.f.totalFree} B free after serving ${first.served} of ${requests.length} requests; best-fit serves ${best.served} and ends with ${best.f.totalFree} B free.`,
    chart: {
      kind: 'bars',
      xLabel: 'placement policy',
      yLabel: 'free bytes left (B)',
      points: results.map((r) => ({ x: r.s, y: r.f.totalFree, label: `${r.s}-fit` })),
      mark: 0,
    },
    table: {
      caption: `Two holes, then requests of ${requests.map((r) => (r.type === 'malloc' ? r.size : 0)).join(' B and ')} B`,
      columns: ['Policy', `Requests served (of ${requests.length})`, 'Free bytes left', 'Largest free block (B)'],
      rows: results.map((r) => [`${r.s}-fit`, r.served, r.f.totalFree, r.f.largest]),
      announce: `First-fit leaves ${first.f.totalFree} bytes free and serves ${first.served} of ${requests.length} requests; best-fit serves ${best.served}.`,
    },
  }
}

/** `phone.canonical` is `allocator.<name>`: one entry per outcome task. */
export const PHONE_MODELS: Readonly<Record<string, () => CanonicalOutcome>> = {
  'frag-first-fit': fragOutcome,
  'coalesce-recover': coalesceOutcome,
  'fixed-block-waste': fixedOutcome,
  'policy-race': raceOutcome,
}
