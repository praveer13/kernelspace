/**
 * The block-table explorer's pure model (P2, docs/specs/wave-3.md §13, task 3a-19): the physical pool, the
 * sequences' block tables, a beam fork, copy-on-write, preemption and the block-size sweep.
 *
 * BlockTableExplorer renders this, the four `blk.*` outcome tasks (src/components/sims/blockTableExplorer.tasks.ts)
 * read it through the observations the sim emits, and phone mode draws the canonical outcome from `PHONE_MODELS`
 * without the sim. Every function takes a state and returns a new one, so the sim's handlers log and observe
 * outside React's updaters. The scenario is synthetic: a pool of 10 physical blocks of 16 tokens (the vLLM
 * default), two sequences sharing a 48-token prompt, and a 64-token request that needs 4 blocks.
 * No React, no DOM, no clock: it runs under `bun test`.
 */

import type { CanonicalOutcome } from '@/lib/sims/host'

export const BLOCK_SIZE = 16
export const PROMPT_TOKENS = 48
export const INITIAL_POOL = 10
export const SWEEP_SIZES: readonly number[] = [4, 8, 16, 32, 64]
/** A block-table entry costs this many bytes in the sweep's overhead column. */
export const ENTRY_BYTES = 8
/** A new request is 64 tokens: four 16-token blocks. */
export const NEW_REQUEST_BLOCKS = 4
/** The prompt's logical blocks: L0..L2. Beam B diverges at the last one. */
export const PROMPT_BLOCKS = PROMPT_TOKENS / BLOCK_SIZE
export const DIVERGE_AT = PROMPT_BLOCKS - 1

/** Ids a new request can take, in order; the component colours the first four and greys the rest. */
const REQUEST_IDS = ['D', 'E', 'F', 'G', 'H'] as const

/* ------------------------------------------------------------------ */
/* The pool                                                             */
/* ------------------------------------------------------------------ */

export interface PhysicalBlock {
  id: number
  refcount: number
  /** Sequences that map this block, in the order they took it. */
  seqs: string[]
  /** Set on the target of a copy-on-write. */
  copiedFrom?: number
  copiedAt?: number
}

export interface Sequence {
  id: string
  /** Logical block i → physical block id. */
  logicalBlocks: number[]
}

export interface PoolState {
  pool: PhysicalBlock[]
  seqs: Sequence[]
}

const emptyPool = (size: number): PhysicalBlock[] => Array.from({ length: size }, (_, i) => ({ id: i, refcount: 0, seqs: [] }))

/** Two sequences, A and B, map the same three physical blocks: a 48-token prompt paid once. */
export function initialState(poolSize: number = INITIAL_POOL): PoolState {
  const pool = emptyPool(poolSize)
  const logical = Array.from({ length: PROMPT_BLOCKS }, (_, i) => i)
  for (const pid of logical) {
    pool[pid].refcount = 2
    pool[pid].seqs = ['A', 'B']
  }
  return {
    pool,
    seqs: [
      { id: 'A', logicalBlocks: [...logical] },
      { id: 'B', logicalBlocks: [...logical] },
    ],
  }
}

export const freeCount = (s: PoolState): number => s.pool.filter((b) => b.refcount === 0).length
export const physicalInUse = (s: PoolState): number => s.pool.filter((b) => b.refcount > 0).length
export const logicalCount = (s: PoolState): number => s.seqs.reduce((n, q) => n + q.logicalBlocks.length, 0)

const hasSeq = (s: PoolState, id: string): boolean => s.seqs.some((q) => q.id === id)

/** The pool as reset leaves it: 10 blocks, A and B sharing three of them, nothing else. */
export function isStart(s: PoolState): boolean {
  return s.pool.length === INITIAL_POOL && s.seqs.length === 2 && freeCount(s) === INITIAL_POOL - PROMPT_BLOCKS && s.pool.every((b) => b.copiedFrom === undefined)
}

/** Whether C has been forked from the start and nothing else has happened. */
export function isStartPlusFork(s: PoolState): boolean {
  return s.pool.length === INITIAL_POOL && s.seqs.map((q) => q.id).join('') === 'ABC' && freeCount(s) === INITIAL_POOL - PROMPT_BLOCKS && s.pool.every((b) => b.copiedFrom === undefined)
}

/**
 * The pool the preemption task states: reset, then one 64-token request admitted, so A and B share three blocks, D holds
 * four and three are free. Any other pool (B already preempted, say) gives A a different count, so it is not graded.
 */
export function isPressured(s: PoolState): boolean {
  return JSON.stringify(s) === JSON.stringify(pressured())
}

/* ------------------------------------------------------------------ */
/* Fork and copy-on-write                                               */
/* ------------------------------------------------------------------ */

export type ForkResult = { ok: true; state: PoolState } | { ok: false; state: PoolState; reason: 'exists' | 'no-parent' }

/** Fork beam C from B: C gets a copy of B's block table and every block it maps gains one reference. */
export function forkBeam(s: PoolState): ForkResult {
  if (hasSeq(s, 'C')) return { ok: false, state: s, reason: 'exists' }
  const b = s.seqs.find((q) => q.id === 'B')
  if (b === undefined) return { ok: false, state: s, reason: 'no-parent' }
  const pool = s.pool.map((blk): PhysicalBlock => (b.logicalBlocks.includes(blk.id) ? { ...blk, refcount: blk.refcount + 1, seqs: [...blk.seqs, 'C'] } : blk))
  return { ok: true, state: { pool, seqs: [...s.seqs, { id: 'C', logicalBlocks: [...b.logicalBlocks] }] } }
}

export type DivergeResult =
  | { kind: 'copied'; state: PoolState; from: number; to: number; tokens: number }
  | { kind: 'no-fork' | 'private' | 'no-free' | 'no-parent'; state: PoolState; physical?: number }

/**
 * B writes into its last prompt block. A block with one owner is written in place; a shared one is copied
 * first: one free block gets all BLOCK_SIZE tokens, B's table points at it, and the original loses B's reference.
 */
export function divergeB(s: PoolState, tick: number): DivergeResult {
  if (!hasSeq(s, 'C')) return { kind: 'no-fork', state: s }
  const b = s.seqs.find((q) => q.id === 'B')
  if (b === undefined) return { kind: 'no-parent', state: s }
  const oldPid = b.logicalBlocks[DIVERGE_AT]
  if (oldPid === undefined) return { kind: 'no-parent', state: s }
  const old = s.pool[oldPid]
  if (old === undefined || old.refcount <= 1) return { kind: 'private', state: s, physical: oldPid }
  const to = s.pool.findIndex((blk) => blk.refcount === 0)
  if (to === -1) return { kind: 'no-free', state: s }
  const pool = s.pool.map((blk): PhysicalBlock => {
    if (blk.id === oldPid) return { ...blk, refcount: blk.refcount - 1, seqs: blk.seqs.filter((sid) => sid !== 'B') }
    if (blk.id === to) return { ...blk, refcount: 1, seqs: ['B'], copiedFrom: oldPid, copiedAt: tick }
    return blk
  })
  const seqs = s.seqs.map((q): Sequence => (q.id === 'B' ? { ...q, logicalBlocks: q.logicalBlocks.map((pid, i) => (i === DIVERGE_AT ? to : pid)) } : q))
  return { kind: 'copied', state: { pool, seqs }, from: oldPid, to, tokens: BLOCK_SIZE }
}

/* ------------------------------------------------------------------ */
/* Pressure and preemption                                              */
/* ------------------------------------------------------------------ */

/** The first request id not in use (D, E, ...). */
export const nextRequestId = (s: PoolState): string => REQUEST_IDS.find((id) => !hasSeq(s, id)) ?? `R${s.seqs.length}`

function admitInto(s: PoolState, pool: PhysicalBlock[], needed: number): PoolState | null {
  const free = pool.filter((b) => b.refcount === 0)
  if (free.length < needed) return null
  const id = nextRequestId(s)
  const taken = free.slice(0, needed).map((b) => b.id)
  return {
    pool: pool.map((b): PhysicalBlock => (taken.includes(b.id) ? { ...b, refcount: 1, seqs: [id] } : b)),
    seqs: [...s.seqs, { id, logicalBlocks: taken }],
  }
}

/** Admit a request that needs `needed` blocks when that many are free; null when they are not. */
export function admit(s: PoolState, needed: number = NEW_REQUEST_BLOCKS): { state: PoolState; id: string } | null {
  const next = admitInto(s, s.pool, needed)
  return next === null ? null : { state: next, id: next.seqs[next.seqs.length - 1].id }
}

export interface PreemptResult {
  state: PoolState
  /** Blocks whose refcount reached 0 because the victim let go. */
  freed: number
  /** The waiting request fit afterwards; its id when it did. */
  admitted: string | null
}

/** Illustrative time to first token after a preemption (the sim says so on screen): swap-in against a re-prefill. */
export const TTFT_MS = { swap: 42, recompute: 118 } as const

/**
 * Drop the victim: each block it maps loses one reference, and only a block whose last owner it was returns to the
 * free queue. Then the waiting request, if it now fits, takes blocks. Null for an unknown victim.
 */
export function preemptVictim(s: PoolState, victimId: string, needed: number = NEW_REQUEST_BLOCKS): PreemptResult | null {
  const victim = s.seqs.find((q) => q.id === victimId)
  if (victim === undefined) return null
  const pool = s.pool.map((blk): PhysicalBlock => {
    if (!victim.logicalBlocks.includes(blk.id)) return blk
    const refcount = blk.refcount - 1
    return refcount <= 0 ? { id: blk.id, refcount: 0, seqs: [] } : { ...blk, refcount, seqs: blk.seqs.filter((sid) => sid !== victimId) }
  })
  const freed = pool.filter((blk, i) => blk.refcount === 0 && s.pool[i].refcount > 0).length
  const rest: PoolState = { pool, seqs: s.seqs.filter((q) => q.id !== victimId) }
  const next = admitInto(rest, pool, needed)
  return next === null ? { state: rest, freed, admitted: null } : { state: next, freed, admitted: next.seqs[next.seqs.length - 1].id }
}

/** What preempting each sequence would return to the free queue, without doing it. */
export const freedBy = (s: PoolState, victimId: string): number => preemptVictim(s, victimId, Number.MAX_SAFE_INTEGER)?.freed ?? 0

/** The pool after reset and two 64-token requests: A and B share 3 blocks, D holds 4, 3 are free. */
export function pressured(): PoolState {
  const first = admit(initialState(), NEW_REQUEST_BLOCKS)
  if (first === null) throw new Error('the starting pool has room for one request')
  return first.state
}

export interface ResizeResult {
  state: PoolState
  /** Blocks cut off the end that still had owners. */
  evicted: { id: number; refcount: number }[]
}

/** Grow or shrink the pool; a block cut off the end disappears from every table that maps it. */
export function resizePool(s: PoolState, size: number): ResizeResult {
  if (size > s.pool.length) {
    const added = Array.from({ length: size - s.pool.length }, (_, i): PhysicalBlock => ({ id: s.pool.length + i, refcount: 0, seqs: [] }))
    return { state: { ...s, pool: [...s.pool, ...added] }, evicted: [] }
  }
  if (size < s.pool.length) {
    const cut = s.pool.slice(size).filter((b) => b.refcount > 0)
    const gone = new Set(cut.map((b) => b.id))
    const seqs = s.seqs.map((q): Sequence => ({ ...q, logicalBlocks: q.logicalBlocks.filter((pid) => !gone.has(pid)) }))
    return { state: { pool: s.pool.slice(0, size), seqs }, evicted: cut.map((b) => ({ id: b.id, refcount: b.refcount })) }
  }
  return { state: s, evicted: [] }
}

/* ------------------------------------------------------------------ */
/* The block-size sweep                                                 */
/* ------------------------------------------------------------------ */

export interface SweepRow {
  size: number
  /** Block-table entries the 48-token prompt needs. */
  entries: number
  /** Unused token slots in the prompt's last block. */
  tailWaste: number
  /** Tail waste as a share of the prompt's tokens, one decimal. */
  wastePct: number
  overheadBytes: number
}

export function sweepRow(size: number): SweepRow {
  const entries = Math.ceil(PROMPT_TOKENS / size)
  const tail = PROMPT_TOKENS % size
  const tailWaste = tail === 0 ? 0 : size - tail
  return { size, entries, tailWaste, wastePct: Math.round((tailWaste / PROMPT_TOKENS) * 1000) / 10, overheadBytes: entries * ENTRY_BYTES }
}

export const SWEEP: readonly SweepRow[] = SWEEP_SIZES.map(sweepRow)

/* ------------------------------------------------------------------ */
/* Observation keys                                                     */
/* ------------------------------------------------------------------ */

/** Keys the sim reports through `observe` (the tasks' `observe` fields, spelled out there and pinned by tests). */
export const OBSERVE = {
  /** Free blocks right after beam C forks from B in the starting pool. */
  shareFree: 'blk.share-free',
  /** Tokens copied by B's first write into the shared block. */
  cowCopied: 'blk.cow-copied',
  /** One key per victim, so only the sequence the prediction names is graded. */
  preemptFreed: (victimId: string): string => `blk.preempt-freed-${victimId.toLowerCase()}`,
  /** One key per block size. */
  sweepTail: (size: number): string => `blk.sweep-tail-${size}`,
} as const

/* ------------------------------------------------------------------ */
/* Canonical outcomes for phone mode                                    */
/* ------------------------------------------------------------------ */

function shareOutcome(): CanonicalOutcome {
  const start = initialState()
  const forked = forkBeam(start)
  const after = forked.state
  // The same fork done by copying B's tokens into fresh blocks would take one block per prompt block.
  const copied = INITIAL_POOL - physicalInUse(start) - PROMPT_BLOCKS
  const row = (label: string, st: PoolState): (string | number)[] => [label, freeCount(st), logicalCount(st), physicalInUse(st)]
  return {
    actual: freeCount(after),
    unit: 'blocks',
    summary: `Forking C copies B's block table, not its tokens: ${physicalInUse(after)} physical blocks still back ${logicalCount(after)} logical ones, so ${freeCount(after)} of ${INITIAL_POOL} stay free. Copying the prompt would have left ${copied}.`,
    chart: {
      kind: 'bars',
      xLabel: 'how C gets the prompt',
      yLabel: 'free blocks left',
      points: [
        { x: 'copy tokens', y: copied, label: 'copy' },
        { x: 'share blocks', y: freeCount(after), label: 'share' },
      ],
      mark: 1,
    },
    table: {
      caption: `A pool of ${INITIAL_POOL} blocks before and after beam C forks from B`,
      columns: ['Step', 'Free blocks', 'Logical mappings', 'Physical blocks in use'],
      rows: [row('A and B share the prompt', start), row('fork C by sharing', after), ['fork C by copying (not what the manager does)', copied, logicalCount(after), physicalInUse(start) + PROMPT_BLOCKS]],
      announce: `After the fork, ${freeCount(after)} of ${INITIAL_POOL} blocks are free; copying the prompt would have left ${copied}.`,
    },
  }
}

function cowOutcome(): CanonicalOutcome {
  const forked = forkBeam(initialState()).state
  const out = divergeB(forked, 1)
  if (out.kind !== 'copied') throw new Error('B diverges after the fork')
  const before = forked.pool[out.from].refcount
  const after = out.state.pool[out.from].refcount
  return {
    actual: out.tokens,
    unit: 'tokens',
    summary: `B's write copies one block, ${out.tokens} tokens of KV, into free block P${out.to}. The original P${out.from} drops from refcount ${before} to ${after} and stays with A and C. The other ${PROMPT_TOKENS - out.tokens} prompt tokens are not copied.`,
    chart: {
      kind: 'bars',
      xLabel: 'what is copied',
      yLabel: 'tokens of KV copied',
      points: [
        { x: 'one block (COW)', y: out.tokens, label: 'COW' },
        { x: 'whole prompt', y: PROMPT_TOKENS, label: 'prompt' },
      ],
      mark: 0,
    },
    table: {
      caption: `Physical blocks P${out.from} and P${out.to} before and after B writes into logical block L${DIVERGE_AT}`,
      columns: ['Block', 'Refcount before', 'Refcount after', 'Mapped by after'],
      rows: [
        [`P${out.from} (shared original)`, before, after, out.state.pool[out.from].seqs.join(', ')],
        [`P${out.to} (B's copy)`, 0, out.state.pool[out.to].refcount, out.state.pool[out.to].seqs.join(', ')],
      ],
      announce: `B's write copies ${out.tokens} tokens into one new block; the original keeps ${after} owners.`,
    },
  }
}

function preemptOutcome(): CanonicalOutcome {
  const s = pressured()
  const ids = s.seqs.map((q) => q.id)
  const rows = ids.map((id) => {
    const q = s.seqs.find((x) => x.id === id) as Sequence
    const shared = q.logicalBlocks.filter((pid) => s.pool[pid].refcount > 1).length
    return { id, maps: q.logicalBlocks.length, shared, freed: freedBy(s, id) }
  })
  const a = rows.find((r) => r.id === 'A') as (typeof rows)[number]
  return {
    actual: a.freed,
    unit: 'blocks',
    summary: `${freeCount(s)} blocks are free and a new request needs ${NEW_REQUEST_BLOCKS}. Preempting A returns ${a.freed}: all ${a.maps} of its blocks are shared with B, so each only drops to refcount 1. Preempting D would return ${rows.find((r) => r.id === 'D')?.freed}.`,
    chart: {
      kind: 'bars',
      xLabel: 'victim',
      yLabel: 'blocks returned to the free queue',
      points: rows.map((r) => ({ x: r.id, y: r.freed, label: `seq ${r.id}` })),
      mark: 0,
    },
    table: {
      caption: `Pool of ${INITIAL_POOL}: ${freeCount(s)} free, a request waiting for ${NEW_REQUEST_BLOCKS} blocks`,
      columns: ['Victim', 'Blocks it maps', 'Of them shared', 'Blocks returned when preempted'],
      rows: rows.map((r) => [`seq ${r.id}`, r.maps, r.shared, r.freed]),
      announce: `Preempting A returns ${a.freed} blocks, because its blocks are shared with B.`,
    },
  }
}

/** The block size the sweep task names. */
export const SWEEP_TASK_SIZE = 64

function sweepOutcome(): CanonicalOutcome {
  const at = sweepRow(SWEEP_TASK_SIZE)
  return {
    actual: at.tailWaste,
    unit: 'tokens',
    summary: `A ${PROMPT_TOKENS}-token prompt in ${at.size}-token blocks fills ${at.entries} block and leaves ${at.tailWaste} token slots unused. At ${BLOCK_SIZE} tokens it leaves none and needs ${sweepRow(BLOCK_SIZE).entries} table entries.`,
    chart: {
      kind: 'bars',
      xLabel: 'block size (tokens)',
      yLabel: 'unused token slots in the last block',
      points: SWEEP.map((r) => ({ x: r.size, y: r.tailWaste, label: String(r.size) })),
      mark: SWEEP_SIZES.indexOf(SWEEP_TASK_SIZE),
    },
    table: {
      caption: `Block-size sweep for a ${PROMPT_TOKENS}-token prompt`,
      columns: ['Block size (tokens)', 'Table entries', 'Unused slots (tokens)', 'Unused (% of prompt)', `Table overhead (B at ${ENTRY_BYTES} B per entry)`],
      rows: SWEEP.map((r) => [r.size, r.entries, r.tailWaste, r.wastePct, r.overheadBytes]),
      announce: `At ${at.size}-token blocks the prompt leaves ${at.tailWaste} unused slots; at ${BLOCK_SIZE} tokens it leaves none.`,
    },
  }
}

/** `phone.canonical` is `blocks.<name>`: one entry per outcome task. */
export const PHONE_MODELS: Readonly<Record<string, () => CanonicalOutcome>> = {
  share: shareOutcome,
  cow: cowOutcome,
  preempt: preemptOutcome,
  sweep: sweepOutcome,
}
