import { describe, expect, test } from 'bun:test'
import {
  BAND,
  LARGE_CELLS,
  MAX_DRAWS,
  PLAY_PRACTICE_SEED,
  SMALL_CELLS,
  TRACE_OPS,
  checkPlacementBand,
  drawPlacementTrace,
  makePlacementTrace,
} from '../../src/lib/world/traces'
import { asDecider, placementSetup, playAll, summarizePlacement } from '../../src/lib/world/play'
import { firstFit } from '../../src/lib/world/placement'
import { splitmix32u } from '../../src/lib/rng'

describe('makePlacementTrace', () => {
  test('same seed, same trace', () => {
    for (const seed of [0, 1, 61, 0xffffffff]) expect(makePlacementTrace(seed)).toEqual(makePlacementTrace(seed))
    expect(makePlacementTrace(1)).not.toEqual(makePlacementTrace(2))
  })

  test('40 ops, bimodal sizes in whole cells, unique ids, frees only of live blocks', () => {
    for (let seed = 0; seed < 300; seed++) {
      const t = makePlacementTrace(seed)
      expect(t.ops).toHaveLength(TRACE_OPS)
      expect(t.capacity).toBe(1024)
      const live = new Set<number>()
      const seen = new Set<number>()
      for (const op of t.ops) {
        if (op.op === 'alloc') {
          expect(seen.has(op.id)).toBe(false)
          seen.add(op.id)
          live.add(op.id)
          const c = op.size / 16
          expect(Number.isInteger(c)).toBe(true)
          const small = c >= SMALL_CELLS.min && c <= SMALL_CELLS.max
          const large = c >= LARGE_CELLS.min && c <= LARGE_CELLS.max
          expect(small || large).toBe(true)
        } else {
          expect(live.delete(op.id)).toBe(true)
        }
      }
    }
  })

  test('both modes and hole-punching frees show up', () => {
    let small = 0
    let large = 0
    let frees = 0
    for (let seed = 0; seed < 200; seed++) {
      for (const op of makePlacementTrace(seed).ops) {
        if (op.op === 'free') frees++
        else if (op.size <= SMALL_CELLS.max * 16) small++
        else large++
      }
    }
    expect(small / (small + large)).toBeGreaterThan(0.1)
    expect(large / (small + large)).toBeGreaterThan(0.6)
    expect(frees / (200 * TRACE_OPS)).toBeGreaterThan(0.2)
  })
})

describe('the band (spec §11.2)', () => {
  test('acceptance rate on 2,000 splitmix32 draws, reported', () => {
    const next = splitmix32u(0x5eed)
    let accepted = 0
    const n = 2000
    for (let i = 0; i < n; i++) if (checkPlacementBand(makePlacementTrace(next())).inBand) accepted++
    const rate = accepted / n
    console.log(`placement band acceptance: ${(rate * 100).toFixed(1)} % of ${n} draws (≈ ${(1 / rate).toFixed(1)} candidates per fresh seed)`)
    expect(rate).toBeGreaterThan(0.3)
    expect(rate).toBeLessThan(0.5)
  })

  test('every drawn trace is in band: ghost survives, worst fit fails before 80 %, fixed-4 survives with 15–40 % waste', () => {
    const entropy = splitmix32u(99)
    let draws = 0
    for (let i = 0; i < 300; i++) {
      const d = drawPlacementTrace(entropy())
      draws += d.draws
      const b = d.band
      expect(b.inBand).toBe(true)
      expect(b.ghostSurvived).toBe(TRACE_OPS)
      expect(b.worstSurvived * 1000).toBeLessThan(TRACE_OPS * BAND.worstFailsBeforePermille)
      expect(b.fixedSurvived).toBe(TRACE_OPS)
      expect(b.fixedWastePermille).toBeGreaterThanOrEqual(150)
      expect(b.fixedWastePermille).toBeLessThanOrEqual(400)
      expect(d.draws).toBeLessThan(MAX_DRAWS)
    }
    expect(draws / 300).toBeLessThan(4)
  })

  test('one entropy value always lands on the same trace; the first candidate is the entropy itself', () => {
    expect(drawPlacementTrace(12345)).toEqual(drawPlacementTrace(12345))
    const inBand = drawPlacementTrace(4242).trace.seed
    const d = drawPlacementTrace(inBand)
    expect(d.draws).toBe(1)
    expect(d.trace.seed).toBe(inBand)
  })

  test('rejections name the rule they break', () => {
    let rejected = 0
    for (let seed = 0; seed < 50; seed++) {
      const b = checkPlacementBand(makePlacementTrace(seed))
      if (!b.inBand) {
        rejected++
        expect(b.violations.length).toBeGreaterThan(0)
        expect(b.violations.join(' ')).toMatch(/ghost|worst|fixed/)
      }
    }
    expect(rejected).toBeGreaterThan(0)
  })
})

describe('PLAY_PRACTICE_SEED', () => {
  test('is in band, and first fit loses it the classic way', () => {
    const t = makePlacementTrace(PLAY_PRACTICE_SEED)
    expect(checkPlacementBand(t).inBand).toBe(true)
    const setup = placementSetup(t)
    const s = summarizePlacement(setup, playAll(setup, asDecider({ name: 'first-fit', place: firstFit })))
    expect(s.survived).toBe(28)
    expect(s.divergence?.op).toBe(15)
    expect(s.divergence?.explanation).toBe(
      'At op 16 you put 1 cell in the 15-cell run at cell 8; the reference would have used the 1-cell gap at cell 31. From there even the reference runs out: op 29 needed 10 cells, and your largest run was 9.',
    )
  })
})
