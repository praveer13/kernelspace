import { describe, expect, test } from 'bun:test'
import {
  allocWith,
  applyOp,
  classSize,
  createHeap,
  externalFragPermille,
  freeId,
  nextPow2,
  placeBlock,
  runTrace,
  viewOf,
  type HeapOptions,
  type HeapState,
} from '../../src/lib/world/heap'
import { bestFit, firstFit, makeDriver, PLAY_HEAP } from '../../src/lib/world/placement'
import { splitmix32u } from '../../src/lib/rng'
import type { HeapOp, Placement } from '../../src/lib/world/types'

const opts = (o: Partial<HeapOptions> = {}): HeapOptions => ({ ...PLAY_HEAP, ...o })
const at = (start: number) => (): Placement => ({ kind: 'place', start })

/** Runs cover [0, capacity) in order with no gaps; used runs carry an id; eager heaps have no two adjacent free runs. */
function checkInvariants(s: HeapState) {
  let addr = 0
  for (const r of s.runs) {
    expect(r.start).toBe(addr)
    expect(r.size).toBeGreaterThan(0)
    if (!r.free) {
      expect(r.id).toBeDefined()
      expect(r.req).toBeLessThanOrEqual(r.size)
    }
    addr += r.size
  }
  expect(addr).toBe(s.options.capacity)
  if (s.options.coalesce && typeof s.options.classes !== 'object') {
    for (let i = 1; i < s.runs.length; i++) expect(s.runs[i - 1].free && s.runs[i].free).toBe(false)
  }
  const v = viewOf(s)
  expect(v.totalFree).toBe(s.runs.filter((r) => r.free).reduce((a, r) => a + r.size, 0))
}

describe('createHeap and size classes', () => {
  test('a plain heap is one free run; a fixed-block heap is carved into blocks', () => {
    expect(createHeap(opts()).runs).toEqual([{ start: 0, size: 1024, free: true }])
    const fixed = createHeap(opts({ classes: { fixed: 64 } }))
    expect(fixed.runs.length).toBe(16)
    expect(fixed.runs.every((r, i) => r.free && r.start === i * 64 && r.size === 64)).toBe(true)
    expect(() => createHeap(opts({ classes: { fixed: 48 } }))).toThrow()
  })

  test('classes round to the granule, to a power of two, or to the fixed block', () => {
    expect(classSize(1, opts())).toBe(16)
    expect(classSize(17, opts())).toBe(32)
    expect(classSize(48, opts({ classes: 'pow2' }))).toBe(64)
    expect(classSize(64, opts({ classes: 'pow2' }))).toBe(64)
    expect(classSize(1, opts({ classes: 'pow2' }))).toBe(16)
    expect(classSize(160, opts({ classes: { fixed: 64 } }))).toBe(64)
    expect([1, 2, 3, 5, 17, 64, 65].map(nextPow2)).toEqual([1, 2, 4, 8, 32, 64, 128])
  })
})

describe('placeBlock: split, minSplit, and refusals', () => {
  test('placing inside a run leaves a free lead and a free tail', () => {
    const r = placeBlock(createHeap(opts()), 7, 32, 30, 64)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.state.runs).toEqual([
      { start: 0, size: 64, free: true },
      { start: 64, size: 32, free: false, id: 7, req: 30 },
      { start: 96, size: 928, free: true },
    ])
    checkInvariants(r.state)
  })

  test('a tail smaller than minSplit goes with the allocation as internal waste', () => {
    const h = createHeap(opts({ capacity: 64, minSplit: 32 }))
    const r = placeBlock(h, 1, 48, 40, 0)
    expect(r.ok && r.state.runs).toEqual([{ start: 0, size: 64, free: false, id: 1, req: 40 }])
    expect(r.ok && viewOf(r.state).internalWaste).toBe(24)
  })

  test('refuses a start inside a used run, past the run, or outside the heap, leaving the heap unchanged', () => {
    const h = createHeap(opts())
    const one = placeBlock(h, 1, 32, 32, 0)
    if (!one.ok) throw new Error('setup')
    for (const [start, size] of [[16, 16], [1008, 32], [2048, 16]]) {
      const r = placeBlock(one.state, 2, size, size, start)
      expect(r.ok).toBe(false)
      expect(r.state).toBe(one.state)
    }
  })
})

describe('freeId and coalescing', () => {
  const three = (o: HeapOptions) => {
    let s = createHeap(o)
    for (const [id, start] of [[1, 0], [2, 32], [3, 64]]) {
      const r = allocWith(s, { id, size: 32 }, at(start))
      if (!r.ok) throw new Error('setup')
      s = r.state
    }
    return s
  }

  test('eager coalescing merges a freed run with both free neighbours', () => {
    let s = three(opts())
    s = freeId(s, 1)
    s = freeId(s, 3)
    expect(s.runs.filter((r) => r.free).map((r) => [r.start, r.size])).toEqual([[0, 32], [64, 960]])
    s = freeId(s, 2)
    expect(s.runs).toEqual([{ start: 0, size: 1024, free: true }])
  })

  test('without coalescing, adjacent free runs stay apart', () => {
    let s = three(opts({ coalesce: false }))
    s = freeId(freeId(freeId(s, 1), 2), 3)
    expect(s.runs.map((r) => [r.start, r.size, r.free])).toEqual([
      [0, 32, true],
      [32, 32, true],
      [64, 32, true],
      [96, 928, true],
    ])
    expect(viewOf(s).largestFree).toBe(928)
  })

  test('an unknown id is a no-op', () => {
    const s = three(opts())
    expect(freeId(s, 99)).toBe(s)
  })
})

describe('fixed blocks: the PagedAttention move', () => {
  const o = opts({ classes: { fixed: 64 } })

  test('a request takes ceil(size / block) blocks, not necessarily contiguous, and never splits one', () => {
    let s = createHeap(o)
    for (const id of [1, 2, 3]) s = (allocWith(s, { id, size: 64 }, firstFit) as { state: HeapState }).state
    s = freeId(s, 2)
    const r = allocWith(s, { id: 4, size: 160 }, firstFit)
    expect(r.ok).toBe(true)
    expect(r.blocks).toEqual([64, 192, 256])
    const v = viewOf(r.state)
    expect(v.internalWaste).toBe(3 * 64 - 160)
    // Any free block serves any request: the largest request that fits is all of them.
    expect(v.largestFree).toBe(v.totalFree)
    expect(externalFragPermille(v)).toBe(0)
  })

  test('all or nothing: too few free blocks leaves the heap unchanged', () => {
    let s = createHeap(opts({ capacity: 256, classes: { fixed: 64 } }))
    s = (allocWith(s, { id: 1, size: 150 }, firstFit) as { state: HeapState }).state
    const r = allocWith(s, { id: 2, size: 129 }, firstFit)
    expect(r.ok).toBe(false)
    expect(r.state).toBe(s)
  })

  test('freed blocks never merge', () => {
    let s = createHeap(o)
    s = (allocWith(s, { id: 1, size: 128 }, firstFit) as { state: HeapState }).state
    s = freeId(s, 1)
    expect(s.runs.length).toBe(16)
  })
})

describe('alignment and driver errors', () => {
  test('a driver placing at the aligned start of a run leaves the padding free', () => {
    let s = createHeap(opts({ granule: 8, minSplit: 8 }))
    s = (allocWith(s, { id: 1, size: 8 }, bestFit) as { state: HeapState }).state
    const r = allocWith(s, { id: 2, size: 32, align: 32 }, bestFit)
    expect(r.at).toBe(32)
    expect(r.state.runs[1]).toEqual({ start: 8, size: 24, free: true })
  })

  test('a misaligned start, a declined request and a full heap all fail with a reason', () => {
    const s = createHeap(opts())
    expect(allocWith(s, { id: 1, size: 16, align: 32 }, at(16)).reason).toContain('aligned')
    expect(allocWith(s, { id: 1, size: 16 }, () => ({ kind: 'reject' })).reason).toBe('declined')
    const full = (allocWith(s, { id: 1, size: 1024 }, firstFit) as { state: HeapState }).state
    expect(allocWith(full, { id: 2, size: 16 }, firstFit).reason).toBe('no run fits')
  })
})

describe('invariants under random churn, every option combination', () => {
  const combos: HeapOptions[] = []
  for (const coalesce of [true, false])
    for (const minSplit of [16, 32, 48])
      for (const classes of ['none', 'pow2', { fixed: 32 }, { fixed: 64 }] as const) combos.push(opts({ coalesce, minSplit, classes }))

  test('runs tile the heap, ids stay unique, frees restore capacity', () => {
    for (const [ci, o] of combos.entries()) {
      for (const fit of ['first', 'next', 'best', 'worst'] as const) {
        const next = splitmix32u(ci * 31 + fit.length)
        const driver = makeDriver(fit)
        let s = createHeap(o)
        const live: number[] = []
        for (let id = 1; id <= 120; id++) {
          const freeing = live.length > 0 && next() % 3 === 0
          const op: HeapOp = freeing ? { op: 'free', id: live.splice(next() % live.length, 1)[0] } : { op: 'alloc', id, size: 1 + (next() % 160) }
          const r = applyOp(s, op, driver)
          if (r.ok && op.op === 'alloc') live.push(op.id)
          s = r.state
          checkInvariants(s)
        }
        for (const id of live) s = freeId(s, id)
        expect(viewOf(s).totalFree).toBe(o.capacity)
        if (o.coalesce && typeof o.classes !== 'object') expect(s.runs.length).toBe(1)
      }
    }
  })
})

describe('runTrace', () => {
  test('stops at the first failure and reports where every op landed', () => {
    const ops: HeapOp[] = [
      { op: 'alloc', id: 1, size: 512 },
      { op: 'alloc', id: 2, size: 256 },
      { op: 'free', id: 1 },
      { op: 'alloc', id: 3, size: 600 },
      { op: 'alloc', id: 4, size: 16 },
    ]
    const r = runTrace(ops, makeDriver('first'), PLAY_HEAP)
    expect(r.failedAt).toBe(3)
    expect(r.survived).toBe(3)
    expect(r.placements).toEqual([0, 512, null])
    expect(r.final.largestFree).toBe(512)
    expect(r.peakExternalPermille).toBe(Math.round((256 * 1000) / 768))
  })

  test('internal waste is wasted bytes over bytes handed out', () => {
    const ops: HeapOp[] = [
      { op: 'alloc', id: 1, size: 16 },
      { op: 'alloc', id: 2, size: 112 },
    ]
    const r = runTrace(ops, makeDriver('first'), opts({ classes: { fixed: 64 } }))
    expect(r.internalWastePermille).toBe(Math.round(((48 + 16) * 1000) / 192))
  })

  test('is deterministic', () => {
    const ops: HeapOp[] = Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? { op: 'free', id: i - 1 } : { op: 'alloc', id: i, size: 16 * (1 + (i % 7)) }))
    expect(runTrace(ops, makeDriver('next'), PLAY_HEAP)).toEqual(runTrace(ops, makeDriver('next'), PLAY_HEAP))
  })
})
