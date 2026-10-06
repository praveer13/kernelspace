import { describe, expect, test } from 'bun:test'
import {
  CELL_BYTES,
  GHOST,
  PLAY_CELLS,
  PLAY_HEAP,
  bestFit,
  cells,
  firstFit,
  makeDriver,
  makeNextFit,
  runAt,
  runChoices,
  worstFit,
} from '../../src/lib/world/placement'
import type { AllocRequest, HeapRun, HeapView } from '../../src/lib/world/types'

/** A view from [start, size, free] triples in cells. */
function view(spec: [number, number, boolean][]): HeapView {
  const runs: HeapRun[] = spec.map(([s, n, free], i) => (free ? { start: s * 16, size: n * 16, free } : { start: s * 16, size: n * 16, free, id: i, req: n * 16 }))
  const free = runs.filter((r) => r.free)
  return {
    capacity: 1024,
    runs,
    totalFree: free.reduce((a, r) => a + r.size, 0),
    largestFree: free.reduce((a, r) => Math.max(a, r.size), 0),
    internalWaste: 0,
  }
}
const req = (c: number, align = 8): AllocRequest => ({ id: 99, size: c * 16, align })
const placedAt = (p: ReturnType<typeof firstFit>) => (p.kind === 'place' ? p.start / 16 : null)

// Free runs: 4 cells at 0, 9 at 10, 2 at 30, 9 at 40, 14 at 50.
const V = view([
  [0, 4, true],
  [4, 6, false],
  [10, 9, true],
  [19, 11, false],
  [30, 2, true],
  [32, 8, false],
  [40, 9, true],
  [49, 1, false],
  [50, 14, true],
])

describe('the play heap is the spec’s 64 cells of 16 B', () => {
  test('1 KiB in a 4 × 16 grid', () => {
    expect(PLAY_CELLS * CELL_BYTES).toBe(1024)
    expect(PLAY_HEAP).toEqual({ capacity: 1024, coalesce: true, minSplit: 16, granule: 16, classes: 'none' })
  })
})

describe('fit drivers', () => {
  test('first fit takes the lowest address that fits', () => {
    expect(placedAt(firstFit(V, req(2)))).toBe(0)
    expect(placedAt(firstFit(V, req(5)))).toBe(10)
  })

  test('best fit takes the smallest run that fits, the lower address on a tie', () => {
    expect(placedAt(bestFit(V, req(2)))).toBe(30)
    expect(placedAt(bestFit(V, req(3)))).toBe(0)
    expect(placedAt(bestFit(V, req(9)))).toBe(10)
    expect(placedAt(bestFit(V, req(10)))).toBe(50)
  })

  test('worst fit takes the largest run, the lower address on a tie', () => {
    expect(placedAt(worstFit(V, req(1)))).toBe(50)
    const tie = view([
      [0, 8, true],
      [8, 8, false],
      [16, 8, true],
      [24, 40, false],
    ])
    expect(placedAt(worstFit(tie, req(1)))).toBe(0)
  })

  test('next fit resumes from the rover and wraps', () => {
    const nf = makeNextFit()
    expect(placedAt(nf.place(V, req(2)))).toBe(0)
    expect(placedAt(nf.place(V, req(2)))).toBe(10)
    expect(placedAt(nf.place(V, req(8)))).toBe(40)
    expect(placedAt(nf.place(V, req(10)))).toBe(50)
    expect(placedAt(nf.place(V, req(3)))).toBe(0)
    // Each run gets its own rover.
    expect(placedAt(makeDriver('next').place(V, req(2)))).toBe(0)
  })

  test('every driver rejects when nothing fits', () => {
    for (const fit of ['first', 'next', 'best', 'worst'] as const) expect(makeDriver(fit).place(V, req(15))).toEqual({ kind: 'reject' })
  })

  test('drivers honour alignment', () => {
    const odd = view([
      [0, 1, false],
      [1, 7, true],
      [8, 56, false],
    ])
    // 4 cells aligned to 64 B: the run starts at 16 B, the aligned start is 64 B and still fits.
    expect(firstFit(odd, req(4, 64))).toEqual({ kind: 'place', start: 64 })
    expect(firstFit(odd, req(5, 64))).toEqual({ kind: 'reject' })
  })

  test('the ghost is best fit', () => {
    expect(GHOST.place).toBe(bestFit)
  })
})

describe('the chip list', () => {
  test('lists free runs in address order and says why a run cannot take the request', () => {
    const chips = runChoices(V, req(9))
    expect(chips.map((c) => [c.start / 16, c.size / 16, c.fits])).toEqual([
      [0, 4, false],
      [10, 9, true],
      [30, 2, false],
      [40, 9, true],
      [50, 14, true],
    ])
    expect(chips[0].why).toBe('4 cells free, needs 9')
    expect(chips[1].why).toBe('')
  })

  test('cells and runAt', () => {
    expect(cells(160)).toBe(10)
    expect(runAt(V, 33 * 16)?.start).toBe(32 * 16)
    expect(runAt(V, 2048)).toBeUndefined()
  })
})
