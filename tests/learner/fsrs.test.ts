import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DEFAULT_RETENTION, MAX_INTERVAL, W, intervalDays, nextMemory, retrievability } from '../../src/lib/learner/fsrs'
import type { MemoryState, Rating } from '../../src/lib/learner/types'

/** The tolerance the spec states (§6.1). Intervals are whole days and must match exactly. */
const TOL = 1e-8

interface Vectors {
  generator: { tool: string; version: string }
  w: number[]
  stats: Record<string, number>
  curve: { t: number; s: number; r: number }[]
  intervals: { s: number; retention: number; days: number }[]
  sequences: { retention: number; steps: [number, Rating, number | null, number, number, number][] }[]
}

const vectors = JSON.parse(
  readFileSync(new URL('../fixtures/fsrs/reference-vectors.json', import.meta.url), 'utf8'),
) as Vectors

const near = (actual: number, expected: number) => Math.abs(actual - expected) <= TOL

describe('fixture', () => {
  test('is from ts-fsrs 5.4.2 and covers the spec sample', () => {
    expect(vectors.generator.tool).toBe('ts-fsrs')
    expect(vectors.generator.version).toBe('5.4.2')
    expect(vectors.sequences.length).toBe(2000)
    for (const { steps } of vectors.sequences) expect(steps.length >= 1 && steps.length <= 12).toBe(true)
  })

  test('spans ratings, same-day reviews, lapses, long gaps and desired retentions', () => {
    const { stats } = vectors
    expect(stats.sameDay).toBeGreaterThan(500)
    expect(stats.lapses).toBeGreaterThan(500)
    expect(stats.hard).toBeGreaterThan(500)
    expect(stats.easy).toBeGreaterThan(500)
    expect(stats.longGaps).toBeGreaterThan(200)
    expect(new Set(vectors.sequences.map((s) => s.retention)).size).toBeGreaterThanOrEqual(6)
    const grades = new Set(vectors.sequences.flatMap((s) => s.steps.map((st) => st[1])))
    expect([...grades].sort()).toEqual([1, 2, 3, 4])
  })
})

describe('weights', () => {
  test('are the 21 FSRS-6 defaults of the reference', () => {
    expect(W.length).toBe(21)
    expect([...W]).toEqual(vectors.w)
  })
})

describe('reference vectors', () => {
  test('every replayed step matches {R, S, D, interval}', () => {
    let worst = 0
    for (const [i, { retention, steps }] of vectors.sequences.entries()) {
      let memory: MemoryState | null = null
      for (const [k, [t, g, r, s, d, interval]] of steps.entries()) {
        if (r !== null) {
          const got = retrievability(t, memory!.stability)
          worst = Math.max(worst, Math.abs(got - r))
          if (!near(got, r)) throw new Error(`sequence ${i} step ${k}: R ${got} vs ${r}`)
        }
        memory = nextMemory(memory, t, g)
        worst = Math.max(worst, Math.abs(memory.stability - s), Math.abs(memory.difficulty - d))
        if (!near(memory.stability, s)) throw new Error(`sequence ${i} step ${k}: S ${memory.stability} vs ${s}`)
        if (!near(memory.difficulty, d)) throw new Error(`sequence ${i} step ${k}: D ${memory.difficulty} vs ${d}`)
        if (intervalDays(memory.stability, retention) !== interval) {
          throw new Error(`sequence ${i} step ${k}: interval ${intervalDays(memory.stability, retention)} vs ${interval}`)
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(TOL)
  })

  test('R(t, S) matches over the grid, including t = 0 and the S ends', () => {
    for (const { t, s, r } of vectors.curve) expect(near(retrievability(t, s), r)).toBe(true)
  })

  test('intervals match exactly over S x desired retention in [0.5, 1]', () => {
    for (const { s, retention, days } of vectors.intervals) expect(intervalDays(s, retention)).toBe(days)
  })
})

describe('model properties', () => {
  test('R is 0.9 at t = S, 1 at t = 0, and falls with t', () => {
    expect(retrievability(0, 5)).toBe(1)
    expect(Math.abs(retrievability(5, 5) - 0.9)).toBeLessThan(1e-6)
    expect(retrievability(10, 5)).toBeLessThan(retrievability(5, 5))
  })

  test('first review: S0 is w[G-1] floored at 0.1, D0 is clamped to [1, 10]', () => {
    for (const g of [1, 2, 3, 4] as const) {
      const m = nextMemory(null, 0, g)
      expect(m.stability).toBe(Math.max(W[g - 1], 0.1))
      expect(m.difficulty >= 1 && m.difficulty <= 10).toBe(true)
    }
    expect(nextMemory(null, 0, 1).difficulty).toBeGreaterThan(nextMemory(null, 0, 4).difficulty)
  })

  test('a lapse never leaves a card more stable than before', () => {
    let m = nextMemory(nextMemory(null, 0, 3), 5, 3)
    for (const t of [1, 10, 100]) {
      const lapsed = nextMemory(m, t, 1)
      expect(lapsed.stability).toBeLessThanOrEqual(m.stability)
      expect(lapsed.difficulty).toBeGreaterThanOrEqual(m.difficulty)
      m = nextMemory(m, t, 3)
    }
  })

  test('recall at a longer gap grows stability more, and Easy more than Good more than Hard', () => {
    const base = nextMemory(nextMemory(null, 0, 3), 3, 3)
    expect(nextMemory(base, 20, 3).stability).toBeGreaterThan(nextMemory(base, 2, 3).stability)
    const [hard, good, easy] = ([2, 3, 4] as const).map((g) => nextMemory(base, 4, g).stability)
    expect(hard).toBeLessThan(good)
    expect(good).toBeLessThan(easy)
  })

  test('a same-day pass never lowers stability; a same-day Again can', () => {
    const m = nextMemory(null, 0, 3)
    expect(nextMemory(m, 0, 3).stability).toBeGreaterThanOrEqual(m.stability)
    expect(nextMemory(m, 0, 1).stability).toBeLessThan(m.stability)
  })

  test('difficulty stays within [1, 10] under any run of ratings', () => {
    for (const g of [1, 4] as const) {
      let m = nextMemory(null, 0, g)
      for (let i = 0; i < 60; i++) {
        m = nextMemory(m, 2, g)
        expect(m.difficulty >= 1 && m.difficulty <= 10).toBe(true)
      }
    }
  })

  test('a negative gap (clock skew in a replayed ledger) acts as same-day', () => {
    const m = nextMemory(null, 0, 3)
    expect(nextMemory(m, -2, 3)).toEqual(nextMemory(m, 0, 3))
  })

  test('intervals are whole days in [1, MAX_INTERVAL], and grow with S and with lower retention', () => {
    expect(intervalDays(0.001)).toBe(1)
    expect(intervalDays(1e9)).toBe(MAX_INTERVAL)
    expect(intervalDays(10, 0.8)).toBeGreaterThan(intervalDays(10, 0.9))
    expect(intervalDays(100)).toBeGreaterThan(intervalDays(10))
    expect(intervalDays(10, 1)).toBe(1)
    expect(intervalDays(10)).toBe(intervalDays(10, DEFAULT_RETENTION))
    expect(() => intervalDays(10, 0)).toThrow(RangeError)
    expect(() => intervalDays(10, 1.01)).toThrow(RangeError)
  })

  test('is deterministic: the same replay twice gives identical bits', () => {
    const run = () => {
      let m: MemoryState | null = null
      for (const [t, g] of [[0, 3], [1, 3], [4, 1], [0, 2], [9, 4]] as [number, Rating][]) m = nextMemory(m, t, g)
      return m
    }
    expect(run()).toEqual(run())
  })
})
