/**
 * AllocatorSim on the World's heap engine (wave-1.md §10.2–10.4, task C9).
 *
 * The sim's own engine was replaced by `src/lib/world/heap` behind `src/lib/sims/models/allocator.ts`.
 * `LEGACY` below is the old engine, copied verbatim from the sim before the swap; the first block runs
 * both over three traces and over a mixed op stream and requires the same blocks and the same numbers,
 * and pins those numbers as literals. The second block pins the four outcome tasks to their scripts, and
 * the third the config round trip, the phone models and the registry entries.
 */
import { describe, expect, test } from 'bun:test'
import { KC } from '../../src/data/kc/ids'
import { ALLOCATOR_LEGACY_TASKS, ALLOCATOR_OUTCOME_TASKS } from '../../src/components/sims/allocator.tasks'
import { gradePrediction } from '../../src/lib/sims/host'
import {
  ADVERSARIAL_TRACE,
  ALTERNATING_TRACE,
  DEFAULT_FIXED_BLOCK,
  HEAP_SIZE,
  OBSERVE,
  PHONE_MODELS,
  SCRIPTS,
  SCRIPT_IDS,
  STRATEGIES,
  blankHeap,
  blocksOf,
  compareStrategies,
  fixedHeap,
  fixedInternalWaste,
  fragmentation,
  free,
  genWorkload,
  heapToCfg,
  makeTrace,
  malloc,
  observeScript,
  restoreConfig,
  runScript,
  simulateTrace,
} from '../../src/lib/sims/models/allocator'
import type { Block, ScriptId, Strategy, TraceResult, WorkOp } from '../../src/lib/sims/models/allocator'
import { buildRegistry } from '../../src/lib/sims/registry'
import type { SimTaskDef } from '../../src/lib/sims/types'

/* ------------------------------------------------------------------ */
/* The engine the sim had before the swap, verbatim                     */
/* ------------------------------------------------------------------ */

const LEGACY = (() => {
  const HEADER = 8
  const MIN_SPLIT = 24

  interface HeapState {
    blocks: Block[]
    rover: number
    seq: number
  }

  const blankHeap = (): HeapState => ({
    blocks: [{ id: 0, start: 0, size: HEAP_SIZE, free: true, req: 0, splinter: 0 }],
    rover: 0,
    seq: 1,
  })

  const fixedHeap = (blockSize: number): HeapState => ({
    blocks: Array.from({ length: HEAP_SIZE / blockSize }, (_, i) => ({
      id: i,
      start: i * blockSize,
      size: blockSize,
      free: true,
      req: 0,
      splinter: 0,
    })),
    rover: 0,
    seq: HEAP_SIZE / blockSize,
  })

  function engineMalloc(st: HeapState, n: number, strategy: Strategy): { st: HeapState; ptr: Block | null; note: string } {
    const need = n + HEADER
    const blocks = st.blocks
    let idx = -1

    if (strategy === 'first') {
      idx = blocks.findIndex((b) => b.free && b.size >= need)
    } else if (strategy === 'best') {
      let bestSize = Infinity
      blocks.forEach((b, i) => {
        if (b.free && b.size >= need && b.size < bestSize) {
          bestSize = b.size
          idx = i
        }
      })
    } else {
      for (let k = 0; k < blocks.length; k += 1) {
        const i = (st.rover + k) % blocks.length
        if (blocks[i].free && blocks[i].size >= need) {
          idx = i
          break
        }
      }
    }

    if (idx === -1) return { st, ptr: null, note: '' }

    const chosen = blocks[idx]
    const remainder = chosen.size - need
    let next: Block[]
    let note = ''
    if (remainder >= MIN_SPLIT) {
      const alloc: Block = { id: st.seq, start: chosen.start, size: need, free: false, req: n, splinter: 0 }
      const rest: Block = { id: st.seq + 1, start: chosen.start + need, size: remainder, free: true, req: 0, splinter: 0 }
      next = [...blocks.slice(0, idx), alloc, rest, ...blocks.slice(idx + 1)]
      note = ` (split ${chosen.size}→${n}+${remainder})`
      return { st: { blocks: next, rover: idx + 1, seq: st.seq + 2 }, ptr: alloc, note }
    }
    const alloc: Block = { ...chosen, free: false, req: n, splinter: remainder, id: st.seq }
    next = [...blocks.slice(0, idx), alloc, ...blocks.slice(idx + 1)]
    if (remainder > 0) note = ` (+${remainder}B splinter burned)`
    return { st: { blocks: next, rover: idx, seq: st.seq + 1 }, ptr: alloc, note }
  }

  const hx4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`

  function engineFree(st: HeapState, id: number, coalesce: boolean): { st: HeapState; addr: number; note: string } {
    const idx = st.blocks.findIndex((b) => b.id === id)
    if (idx === -1) return { st, addr: -1, note: '' }
    const addr = st.blocks[idx].start
    let blocks = st.blocks.map((b, i) => (i === idx ? { ...b, free: true, req: 0, splinter: 0 } : b))
    const notes: string[] = []
    if (coalesce) {
      if (idx + 1 < blocks.length && blocks[idx + 1].free) {
        const merged = blocks[idx].size + blocks[idx + 1].size
        notes.push(`COALESCE ${hx4(blocks[idx].start)}+${hx4(blocks[idx + 1].start)} → ${merged}B`)
        blocks = [...blocks.slice(0, idx), { ...blocks[idx], size: merged }, ...blocks.slice(idx + 2)]
      }
      if (idx - 1 >= 0 && blocks[idx - 1].free) {
        const merged = blocks[idx - 1].size + blocks[idx].size
        notes.push(`COALESCE ${hx4(blocks[idx - 1].start)}+${hx4(blocks[idx].start)} → ${merged}B`)
        blocks = [...blocks.slice(0, idx - 1), { ...blocks[idx - 1], size: merged }, ...blocks.slice(idx + 1)]
      }
    }
    return { st: { blocks, rover: Math.min(st.rover, blocks.length - 1), seq: st.seq }, addr, note: notes.join(' · ') }
  }

  function fragmentation(blocks: Block[]): { totalFree: number; largest: number; ratio: number } {
    const freeBlocks = blocks.filter((b) => b.free)
    const totalFree = freeBlocks.reduce((s, b) => s + b.size, 0)
    const largest = freeBlocks.reduce((m, b) => Math.max(m, b.size), 0)
    return { totalFree, largest, ratio: totalFree > 0 ? largest / totalFree : 1 }
  }

  function simulateTrace(trace: readonly WorkOp[], strategy: Strategy, fixedBlockSize: number | null): TraceResult {
    let state = fixedBlockSize ? fixedHeap(fixedBlockSize) : blankHeap()
    let liveIds: number[] = []
    const failureSnapshots: TraceResult['failureSnapshots'] = []
    const history: number[] = []
    const sampleEvery = Math.max(1, Math.floor(trace.length / 80))

    const recordFailure = (operationIndex: number, requestedSize: number) => {
      const f = fragmentation(state.blocks)
      failureSnapshots.push({ operationIndex, requestedSize, totalFreeBytes: f.totalFree, largestFreeBlock: f.largest })
    }

    trace.forEach((op, index) => {
      if (op.type === 'free') {
        if (liveIds.length > 0) {
          const liveIndex = (op.slot ?? 0) % liveIds.length
          const id = liveIds[liveIndex]
          liveIds = liveIds.filter((_, i) => i !== liveIndex)
          state = engineFree(state, id, !fixedBlockSize).st
        }
      } else if (fixedBlockSize) {
        const freeIndex = state.blocks.findIndex((block) => block.free)
        if (freeIndex === -1 || op.size > fixedBlockSize) {
          recordFailure(index + 1, op.size)
        } else {
          const id = state.blocks[freeIndex].id
          state = {
            ...state,
            blocks: state.blocks.map((block, i) => (i === freeIndex ? { ...block, free: false, req: op.size } : block)),
          }
          liveIds.push(id)
        }
      } else {
        const result = engineMalloc(state, op.size, strategy)
        state = result.st
        if (result.ptr) liveIds.push(result.ptr.id)
        else recordFailure(index + 1, op.size)
      }
      if (index % sampleEvery === 0 || index === trace.length - 1) {
        history.push(fixedBlockSize ? 1 : fragmentation(state.blocks).ratio)
      }
    })

    const final = fragmentation(state.blocks)
    const internalWaste = fixedBlockSize
      ? state.blocks.reduce((waste, block) => waste + (block.free ? 0 : fixedBlockSize - block.req), 0)
      : 0
    return {
      history,
      failureSnapshots,
      finalRatio: fixedBlockSize ? 1 : final.ratio,
      internalWaste,
      metadata: state.blocks.length * HEADER,
    }
  }

  return { blankHeap, fixedHeap, engineMalloc, engineFree, simulateTrace }
})()

/* ------------------------------------------------------------------ */
/* Snapshot: three traces                                               */
/* ------------------------------------------------------------------ */

const ALTERNATING = makeTrace(ALTERNATING_TRACE.length, ALTERNATING_TRACE.seed, ALTERNATING_TRACE.alternating)
const ADVERSARIAL = makeTrace(ADVERSARIAL_TRACE.length, ADVERSARIAL_TRACE.seed, ADVERSARIAL_TRACE.alternating)
const WORKLOAD = genWorkload(0x5eed).map((op, i): WorkOp => (op.type === 'free' ? { type: 'free', slot: i * 7 } : op))

const TRACES: { name: string; ops: readonly WorkOp[]; fixed: number | null }[] = [
  { name: 'alternating 1K, variable heap', ops: ALTERNATING, fixed: null },
  { name: 'adversarial 5K, variable heap', ops: ADVERSARIAL, fixed: null },
  { name: 'adversarial 5K, fixed 128 B blocks', ops: ADVERSARIAL, fixed: 128 },
]

/** What the sim shows for a result: the numbers a learner reads off the page. */
const digest = (r: TraceResult) => ({
  failures: r.failureSnapshots.length,
  firstFailure: r.failureSnapshots[0] ?? null,
  lastFailure: r.failureSnapshots[r.failureSnapshots.length - 1] ?? null,
  finalPct: Math.round(r.finalRatio * 100),
  internalWaste: r.internalWaste,
  metadata: r.metadata,
  samples: r.history.length,
  meanRatio: Math.round((r.history.reduce((a, b) => a + b, 0) / r.history.length) * 1e6) / 1e6,
})

describe('the engine swap keeps the sim’s behaviour (snapshot on three traces)', () => {
  for (const t of TRACES) {
    for (const s of STRATEGIES) {
      if (t.fixed !== null && s !== 'first') continue
      test(`${t.name}, ${s}-fit: the model equals the old engine, sample for sample`, () => {
        expect(simulateTrace(t.ops, s, t.fixed)).toEqual(LEGACY.simulateTrace(t.ops, s, t.fixed))
      })
    }
  }

  test('the numbers on the page, pinned', () => {
    const snap = {
      alternating: Object.fromEntries(STRATEGIES.map((s) => [s, digest(simulateTrace(ALTERNATING, s, null))])),
      adversarial: Object.fromEntries(STRATEGIES.map((s) => [s, digest(simulateTrace(ADVERSARIAL, s, null))])),
      fixed: digest(simulateTrace(ADVERSARIAL, 'first', 128)),
    }
    expect(snap).toEqual(SNAPSHOT)
  })

  test('compare-all runs the same trace under the three policies', () => {
    const all = compareStrategies(ALTERNATING)
    for (const s of STRATEGIES) expect(all[s]).toEqual(LEGACY.simulateTrace(ALTERNATING, s, null))
  })

  test('block by block: a mixed stream keeps the same layout after every op, in every mode', () => {
    for (const s of STRATEGIES) {
      for (const coalesce of [true, false]) {
        let now = blankHeap()
        let old = LEGACY.blankHeap()
        WORKLOAD.concat(ALTERNATING.slice(0, 300)).forEach((op, i) => {
          if (op.type === 'malloc') {
            const a = malloc(now, op.size, s)
            const b = LEGACY.engineMalloc(old, op.size, s)
            expect(a.block === null).toBe(b.ptr === null)
            expect(a.note).toBe(b.note)
            if (a.block !== null) now = a.heap
            old = b.st
          } else {
            const used = blocksOf(now).filter((x) => !x.free)
            if (used.length === 0) return
            const pick = (op.slot ?? i) % used.length
            const a = free(now, used[pick].id, coalesce)
            const oldUsed = old.blocks.filter((x) => !x.free)
            const b = LEGACY.engineFree(old, oldUsed[pick].id, coalesce)
            expect(a.addr).toBe(b.addr)
            expect(a.note).toBe(b.note)
            now = a.heap
            old = b.st
          }
          const layout = (bs: readonly Block[]) => bs.map((x) => [x.start, x.size, x.free, x.req, x.splinter])
          expect(layout(blocksOf(now))).toEqual(layout(old.blocks))
          expect(now.rover).toBe(old.rover)
        })
        expect(fragmentation(blocksOf(now))).toEqual(fragmentation(old.blocks))
      }
    }
  })

  test('block by block, fixed mode: the first free block takes each request, as the old inline code did', () => {
    for (const size of [16, 64, 256]) {
      let now = fixedHeap(size)
      let old = LEGACY.fixedHeap(size)
      ADVERSARIAL.slice(0, 400).forEach((op, i) => {
        if (op.type === 'malloc') {
          const idx = old.blocks.findIndex((b) => b.free)
          const a = malloc(now, op.size, 'first')
          expect(a.block === null).toBe(idx === -1 || op.size > size)
          if (a.block === null) return
          now = a.heap
          old = { ...old, blocks: old.blocks.map((b, j) => (j === idx ? { ...b, free: false, req: op.size } : b)) }
        } else {
          const used = blocksOf(now).filter((b) => !b.free)
          if (used.length === 0) return
          const pick = (op.slot ?? i) % used.length
          const a = free(now, used[pick].id, false)
          const victim = old.blocks.filter((b) => !b.free)[pick]
          const b = LEGACY.engineFree(old, victim.id, false)
          expect(a.addr).toBe(b.addr)
          now = a.heap
          old = b.st
        }
        const layout = (bs: readonly Block[]) => bs.map((x) => [x.start, x.size, x.free, x.free ? 0 : x.req])
        expect(layout(blocksOf(now))).toEqual(layout(old.blocks))
      })
    }
  })

  test('fixed blocks: one block per request, ENOMEM past the block size or when full', () => {
    let h = fixedHeap(64)
    const big = malloc(h, 65, 'first')
    expect(big.block).toBeNull()
    expect(big.reason).toBe('too-big')
    for (let i = 0; i < HEAP_SIZE / 64; i++) {
      const r = malloc(h, 10 + i, 'first')
      expect(r.block?.start).toBe(i * 64)
      expect(r.block?.req).toBe(10 + i)
      h = r.heap
    }
    expect(malloc(h, 1, 'first').reason).toBe('full')
    expect(fixedInternalWaste(h)).toBe(16 * 64 - Array.from({ length: 16 }, (_, i) => 10 + i).reduce((a, b) => a + b, 0))
    // Freeing the third block returns exactly that block to the next request; nothing merges.
    const freed = free(h, blocksOf(h)[2].id, true)
    expect(freed.addr).toBe(128)
    expect(freed.note).toBe('')
    expect(malloc(freed.heap, 5, 'first').block?.start).toBe(128)
  })

  test('freeing an unknown id changes nothing', () => {
    const h = blankHeap()
    expect(free(h, 99, true)).toEqual({ heap: h, addr: -1, note: '' })
  })
})

/** Read off the old engine on these three traces; the equality tests above keep the model in step with it. */
const SNAPSHOT = {
  alternating: {
    first: { failures: 48, firstFailure: { operationIndex: 184, requestedSize: 96, totalFreeBytes: 32, largestFreeBlock: 32 }, lastFailure: { operationIndex: 994, requestedSize: 96, totalFreeBytes: 144, largestFreeBlock: 72 }, finalPct: 42, internalWaste: 0, metadata: 136, samples: 85, meanRatio: 0.600373 },
    next: { failures: 48, firstFailure: { operationIndex: 182, requestedSize: 96, totalFreeBytes: 152, largestFreeBlock: 64 }, lastFailure: { operationIndex: 994, requestedSize: 96, totalFreeBytes: 136, largestFreeBlock: 72 }, finalPct: 38, internalWaste: 0, metadata: 136, samples: 85, meanRatio: 0.526658 },
    best: { failures: 49, firstFailure: { operationIndex: 184, requestedSize: 96, totalFreeBytes: 32, largestFreeBlock: 32 }, lastFailure: { operationIndex: 994, requestedSize: 96, totalFreeBytes: 104, largestFreeBlock: 72 }, finalPct: 28, internalWaste: 0, metadata: 128, samples: 85, meanRatio: 0.723298 },
  },
  adversarial: {
    first: { failures: 391, firstFailure: { operationIndex: 32, requestedSize: 64, totalFreeBytes: 72, largestFreeBlock: 48 }, lastFailure: { operationIndex: 4989, requestedSize: 192, totalFreeBytes: 208, largestFreeBlock: 152 }, finalPct: 79, internalWaste: 0, metadata: 32, samples: 82, meanRatio: 0.695218 },
    next: { failures: 392, firstFailure: { operationIndex: 32, requestedSize: 64, totalFreeBytes: 88, largestFreeBlock: 40 }, lastFailure: { operationIndex: 4981, requestedSize: 96, totalFreeBytes: 184, largestFreeBlock: 88 }, finalPct: 100, internalWaste: 0, metadata: 24, samples: 82, meanRatio: 0.614303 },
    best: { failures: 388, firstFailure: { operationIndex: 32, requestedSize: 64, totalFreeBytes: 72, largestFreeBlock: 48 }, lastFailure: { operationIndex: 4977, requestedSize: 128, totalFreeBytes: 80, largestFreeBlock: 56 }, finalPct: 80, internalWaste: 0, metadata: 40, samples: 82, meanRatio: 0.71489 },
  },
  fixed: { failures: 649, firstFailure: { operationIndex: 3, requestedSize: 192, totalFreeBytes: 768, largestFreeBlock: 128 }, lastFailure: { operationIndex: 4989, requestedSize: 192, totalFreeBytes: 512, largestFreeBlock: 128 }, finalPct: 100, internalWaste: 0, metadata: 64, samples: 82, meanRatio: 1 },
}

/* ------------------------------------------------------------------ */
/* The four outcome tasks                                               */
/* ------------------------------------------------------------------ */

const task = (id: string): SimTaskDef => {
  const t = ALLOCATOR_OUTCOME_TASKS.find((x) => x.id === id)
  if (t === undefined) throw new Error(`no task ${id}`)
  return t
}

const TASK_SCRIPT: Record<string, ScriptId> = {
  'alloc.frag-first-fit': 'frag-first-fit',
  'alloc.coalesce-recover': 'coalesce-recover',
  'alloc.fixed-block-waste': 'fixed-block-waste',
  'alloc.policy-race': 'policy-race',
}

describe('outcome tasks: ids, KCs and what each one observes', () => {
  test('the four contract ids, each on its KC, replacing the old t-* ids', () => {
    expect(ALLOCATOR_OUTCOME_TASKS.map((t) => t.id)).toEqual(Object.keys(TASK_SCRIPT))
    expect(task('alloc.frag-first-fit').kcs).toEqual([KC.externalFrag])
    expect(task('alloc.coalesce-recover').kcs).toEqual(['t1.split-coalesce' as never])
    expect(task('alloc.fixed-block-waste').kcs).toEqual(['t1.fixed-blocks' as never])
    expect(task('alloc.policy-race').kcs).toEqual(['t1.placement-policy' as never])
    expect(ALLOCATOR_OUTCOME_TASKS.map((t) => t.legacyId)).toEqual(['t-frag', 't-coalesce', 't-paged', 't-trace-lab'])
    for (const t of ALLOCATOR_OUTCOME_TASKS) {
      expect(t.kind).toBe('outcome')
      expect(t.simId).toBe('sim-allocator')
      expect(t.phone?.canonical).toBe(`allocator.${TASK_SCRIPT[t.id]}`)
    }
  })

  test('the registry accepts them, and the old t-* ids stay as legacy under sim-allocator', () => {
    const r = buildRegistry({
      '/src/components/sims/allocator.tasks.ts': { ALLOCATOR_OUTCOME_TASKS, ALLOCATOR_LEGACY_TASKS },
    })
    expect(r.problems).toEqual([])
    const legacy = r.tasks.filter((t) => t.kind === 'legacy').map((t) => t.id)
    expect(legacy).toEqual(['t-frag', 't-coalesce', 't-paged', 't-quiz', 't-trace-lab', 't-double-free'])
    for (const t of ALLOCATOR_LEGACY_TASKS) {
      expect(t.simId).toBe('sim-allocator')
      expect(t.kcs).toEqual([])
      expect(t.predict).toBeUndefined()
    }
    expect(r.forSim('sim-allocator', 'allocator').filter((t) => t.kind === 'outcome')).toHaveLength(4)
    expect(r.forSim('sim-allocator', 'rust').filter((t) => t.kind === 'outcome')).toHaveLength(0)
  })

  test('the observe keys written in the tasks file are the keys the model reports', () => {
    const keys = (id: ScriptId, strategy: Strategy, coalesce: boolean) => {
      const run = runScript(SCRIPTS[id], strategy, coalesce)
      return observeScript(id, run.heap, strategy, coalesce).key
    }
    expect(task('alloc.frag-first-fit').observe).toBe(keys('frag-first-fit', 'first', true))
    expect(task('alloc.coalesce-recover').observe).toBe(keys('coalesce-recover', 'first', true))
    expect(task('alloc.fixed-block-waste').observe).toBe(keys('fixed-block-waste', 'first', true))
    expect(task('alloc.policy-race').observe).toBe(keys('policy-race', 'first', true))
    // A run under another condition reports another key, so it never grades this prediction.
    expect(keys('coalesce-recover', 'first', false)).toBe(OBSERVE.largestFreeOff)
    expect(keys('policy-race', 'best', true)).toBe(OBSERVE.race('best'))
    expect(OBSERVE.race('first')).not.toBe(OBSERVE.race('next'))
  })

  test('each phone model key resolves, and its actual is what the hands-on run observes', () => {
    for (const t of ALLOCATOR_OUTCOME_TASKS) {
      const name = t.phone?.canonical.split('.')[1] ?? ''
      const model = PHONE_MODELS[name]
      expect(model).toBeDefined()
      const id = TASK_SCRIPT[t.id]
      const run = runScript(SCRIPTS[id], 'first', true)
      const seen = observeScript(id, run.heap, 'first', true)
      const out = model()
      expect(out.actual).toBe(seen.value)
      expect(out.unit).toBe(seen.unit)
      expect(seen.key).toBe(t.observe)
    }
    expect(Object.keys(PHONE_MODELS).sort()).toEqual([...SCRIPT_IDS].sort())
  })

  test('a phone table always has columns and rows of the same width', () => {
    for (const name of Object.keys(PHONE_MODELS)) {
      const { table, chart } = PHONE_MODELS[name]()
      expect(chart.points.length).toBeGreaterThan(0)
      expect(table.rows.length).toBeGreaterThan(0)
      for (const row of table.rows) expect(row).toHaveLength(table.columns.length)
    }
  })
})

describe('the scripts give the numbers the task text promises', () => {
  const finalBlocks = (id: ScriptId, strategy: Strategy = 'first', coalesce = true) =>
    blocksOf(runScript(SCRIPTS[id], strategy, coalesce).heap)

  test('frag-first-fit: 608 B free in five holes, the largest 192 B, 32% usable', () => {
    const holes = finalBlocks('frag-first-fit').filter((b) => b.free)
    expect(holes.map((b) => b.size)).toEqual([104, 104, 104, 104, 192])
    const f = fragmentation(finalBlocks('frag-first-fit'))
    expect([f.totalFree, f.largest, Math.round(f.ratio * 100)]).toEqual([608, 192, 32])
    // A 200 B request needs 208 B in one piece and fails, whatever the policy.
    for (const s of STRATEGIES) {
      const run = runScript(SCRIPTS['frag-first-fit'], s)
      expect(malloc(run.heap, 200, s).block).toBeNull()
      expect(malloc(run.heap, 184, s).block).not.toBeNull()
    }
  })

  test('coalesce-recover: freeing block 4 fuses three 104 B blocks into 312 B; with coalescing off it stays 192 B', () => {
    const largest = (coalesce: boolean) =>
      Math.max(...finalBlocks('coalesce-recover', 'first', coalesce).filter((b) => b.free).map((b) => b.size))
    expect(largest(true)).toBe(312)
    expect(largest(false)).toBe(192)
    const last = runScript(SCRIPTS['coalesce-recover'], 'first', true).steps.at(-1)
    expect(last?.op).toEqual({ type: 'release', handle: 4 })
  })

  test('fixed-block-waste: 294 B asked, 512 B held, 218 B wasted inside eight 64 B blocks, none outside', () => {
    const run = runScript(SCRIPTS['fixed-block-waste'], 'first')
    const used = blocksOf(run.heap).filter((b) => !b.free)
    expect(used.map((b) => b.req)).toEqual([20, 33, 64, 50, 17, 41, 9, 60])
    expect(used.reduce((a, b) => a + b.req, 0)).toBe(294)
    expect(used.reduce((a, b) => a + b.size, 0)).toBe(512)
    expect(fixedInternalWaste(run.heap)).toBe(218)
    expect(run.steps.every((s) => s.ok)).toBe(true)
  })

  test('policy-race: first- and next-fit strand 312 B and serve one request; best-fit serves both', () => {
    const setup = { ...SCRIPTS['policy-race'], ops: SCRIPTS['policy-race'].ops.slice(0, 6) }
    const holes = blocksOf(runScript(setup, 'first').heap).filter((b) => b.free)
    expect(holes.map((b) => [b.start, b.size])).toEqual([
      [0, 300],
      [400, 120],
    ])
    const served = (s: Strategy) => runScript(SCRIPTS['policy-race'], s).steps.slice(-2).map((x) => x.ok)
    const left = (s: Strategy) => fragmentation(blocksOf(runScript(SCRIPTS['policy-race'], s).heap)).totalFree
    expect([served('first'), left('first')]).toEqual([[true, false], 312])
    expect([served('next'), left('next')]).toEqual([[true, false], 312])
    expect([served('best'), left('best')]).toEqual([[true, true], 0])
  })

  test('a script is deterministic and its last step is the final heap', () => {
    for (const id of SCRIPT_IDS) {
      const a = runScript(SCRIPTS[id], 'first')
      expect(a).toEqual(runScript(SCRIPTS[id], 'first'))
      expect(a.steps).toHaveLength(SCRIPTS[id].ops.length)
      expect(a.steps.at(-1)?.heap).toBe(a.heap)
    }
  })

  test('the long-trace claim in the policy-race note: first, next and best fail 48, 48 and 49 on the alternating trace', () => {
    const all = compareStrategies(ALTERNATING)
    expect(STRATEGIES.map((s) => all[s].failureSnapshots.length)).toEqual([48, 48, 49])
    expect(task('alloc.policy-race').note ?? '').toContain('48, 48 and 49')
  })
})

describe('predictions are graded the way the task text promises', () => {
  const grade = (id: string, guess: number, actual: number) => {
    const t = task(id)
    return t.predict === undefined ? null : gradePrediction(t.predict, { value: guess }, actual)
  }

  test('a 4-point miss on the usable percentage passes, a 6-point miss does not', () => {
    expect(grade('alloc.frag-first-fit', 28, 32)?.ok).toBe(true)
    expect(grade('alloc.frag-first-fit', 38, 32)?.ok).toBe(false)
  })

  test('each canonical answer is inside its own tolerance, and the obvious wrong answers are not', () => {
    expect(grade('alloc.coalesce-recover', 312, 312)?.ok).toBe(true)
    expect(grade('alloc.coalesce-recover', 296, 312)?.ok).toBe(false) // forgot the reclaimed headers
    expect(grade('alloc.coalesce-recover', 192, 312)?.ok).toBe(false) // thought nothing merges
    expect(grade('alloc.fixed-block-waste', 218, 218)?.ok).toBe(true)
    expect(grade('alloc.fixed-block-waste', 512 - 294 - 40, 218)?.ok).toBe(false)
    expect(grade('alloc.policy-race', 312, 312)?.ok).toBe(true)
    expect(grade('alloc.policy-race', 0, 312)?.ok).toBe(false) // best-fit's answer
  })
})

/* ------------------------------------------------------------------ */
/* Config round trip                                                    */
/* ------------------------------------------------------------------ */

describe('?cfg= and lesson config', () => {
  const layout = (h: ReturnType<typeof blankHeap>) => blocksOf(h).map((b) => [b.start, b.size, b.free, b.req, b.splinter])

  test('a heap survives heapToCfg, JSON and restoreConfig, in both modes', () => {
    let h = blankHeap()
    for (const n of [64, 16, 40, 200]) h = malloc(h, n, 'first').heap
    h = free(h, blocksOf(h)[1].id, true).heap
    const back = restoreConfig(JSON.parse(JSON.stringify(heapToCfg(h, 'best', false, DEFAULT_FIXED_BLOCK))))
    expect(back.strategy).toBe('best')
    expect(back.coalesce).toBe(false)
    expect(back.fixed).toBe(false)
    expect(layout(back.heap)).toEqual(layout(h))

    let f = fixedHeap(32)
    f = malloc(f, 20, 'first').heap
    f = malloc(f, 32, 'first').heap
    const fb = restoreConfig(JSON.parse(JSON.stringify(heapToCfg(f, 'first', true, 32))))
    expect(fb.fixed).toBe(true)
    expect(fb.fixedSize).toBe(32)
    expect(layout(fb.heap)).toEqual(layout(f))
  })

  test('anything malformed falls back to the defaults instead of throwing', () => {
    const fresh = restoreConfig(null)
    expect(fresh).toMatchObject({ strategy: 'first', coalesce: true, fixed: false, fixedSize: DEFAULT_FIXED_BLOCK })
    expect(blocksOf(fresh.heap)).toEqual([{ id: 0, start: 0, size: HEAP_SIZE, free: true, req: 0, splinter: 0 }])
    const bad: unknown[] = [
      'x',
      42,
      [],
      { s: 'worst', c: 'yes', z: 7 },
      { b: 'nope' },
      { b: [[0, 512, 1, 0]] }, // does not tile the heap
      { b: [[0, 1024, 1]] }, // short row
      { b: [[0, 1024, 1.5, 0]] },
      { b: [[8, 1016, 1, 0]] }, // does not start at 0
    ]
    for (const cfg of bad) expect(fragmentation(blocksOf(restoreConfig(cfg).heap)).totalFree).toBe(HEAP_SIZE)
    expect(restoreConfig({ f: true, z: 100 }).fixedSize).toBe(DEFAULT_FIXED_BLOCK) // 100 does not divide 1024
    expect(blocksOf(restoreConfig({ f: true, z: 128 }).heap)).toHaveLength(8)
    // A variable block list in fixed mode is dropped whole: the heap is eight fresh blocks.
    expect(blocksOf(restoreConfig({ f: true, z: 128, b: [[0, 1024, 1, 0]] }).heap)).toHaveLength(8)
  })
})
