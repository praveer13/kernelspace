import { describe, expect, test } from 'bun:test'
import { levelFor, MEASURE_LEVEL, stairFor, stairStep, START_LEVEL, TARGET_ACCURACY, UP_RUN, type StairEvent, type StairState } from '../../src/lib/items/staircase'
import { shuffledOrder, splitmix32 } from '../../src/lib/rng'

const at = (i: number) => `2026-10-05T10:${String(i).padStart(2, '0')}:00.000Z`
function ev(i: number, ok: boolean, over: Partial<StairEvent> = {}): StairEvent {
  return { id: `e${String(i).padStart(3, '0')}`, kind: 'item', ref: 'gen:kv/bytes-per-token', at: at(i), ok, data: { kcs: ['t5.kv-bytes-per-token'] }, ...over }
}
const KC = 't5.kv-bytes-per-token'

describe('stairStep', () => {
  test('three correct in a row raise the level; the run restarts', () => {
    let s: StairState = { level: 1, streak: 0 }
    s = stairStep(s, true)
    s = stairStep(s, true)
    expect(s).toEqual({ level: 1, streak: 2 })
    s = stairStep(s, true)
    expect(s).toEqual({ level: 2, streak: 0 })
    expect(UP_RUN).toBe(3)
  })

  test('one miss lowers the level and clears the run', () => {
    expect(stairStep({ level: 2, streak: 2 }, false)).toEqual({ level: 1, streak: 0 })
    expect(stairStep({ level: 2, streak: 0 }, false)).toEqual({ level: 1, streak: 0 })
  })

  test('clamped to [0, top]', () => {
    expect(stairStep({ level: 0, streak: 0 }, false)).toEqual({ level: 0, streak: 0 })
    expect(stairStep({ level: 3, streak: 2 }, true)).toEqual({ level: 3, streak: 0 })
    expect(stairStep({ level: 9, streak: 2 }, true, 9)).toEqual({ level: 9, streak: 0 })
    expect(stairStep({ level: 8, streak: 2 }, true, 9)).toEqual({ level: 9, streak: 0 })
  })

  test('the target is the accuracy where three in a row is a coin flip', () => {
    expect(TARGET_ACCURACY ** 3).toBeCloseTo(0.5, 12)
    expect(TARGET_ACCURACY).toBeCloseTo(0.794, 3)
  })
})

describe('levelFor', () => {
  test('starts at 1 after a lesson, or where the caller says (placement and test-out measure at 2)', () => {
    expect(levelFor([], KC, 'kv')).toBe(START_LEVEL)
    expect(START_LEVEL).toBe(1)
    expect(levelFor([], KC, 'kv', { start: MEASURE_LEVEL })).toBe(2)
    expect(MEASURE_LEVEL).toBe(2)
  })

  test('replays the history: up after three, down after a miss', () => {
    const up = [ev(1, true), ev(2, true), ev(3, true)]
    expect(levelFor(up, KC, 'kv')).toBe(2)
    expect(levelFor([...up, ev(4, true), ev(5, true)], KC, 'kv')).toBe(2)
    expect(levelFor([...up, ev(4, false)], KC, 'kv')).toBe(1)
    expect(levelFor([ev(1, false), ev(2, false), ev(3, false)], KC, 'kv')).toBe(0)
    const climb = Array.from({ length: 30 }, (_, i) => ev(i, true))
    expect(levelFor(climb, KC, 'kv')).toBe(3)
  })

  test('a miss in the middle of a run resets it', () => {
    expect(levelFor([ev(1, true), ev(2, true), ev(3, false), ev(4, true), ev(5, true)], KC, 'kv')).toBe(0)
    expect(stairFor([ev(1, true), ev(2, true), ev(3, false), ev(4, true), ev(5, true)], KC, 'kv')).toEqual({ level: 0, streak: 2 })
  })

  test('only graded items and probes of this family and KC count', () => {
    const noise: StairEvent[] = [
      ev(1, false, { ref: 'gen:frag/internal-waste' }),
      ev(2, false, { data: { kcs: ['t4.ridge-point'] } }),
      ev(3, false, { data: {} }),
      ev(4, false, { data: undefined }),
      ev(5, false, { kind: 'predict' }),
      ev(6, false, { kind: 'quiz' }),
      ev(7, false, { ref: 'item:r.anchor.e0502-1' }),
      ev(8, false, { ref: 'gen:kvx/bytes-per-token' }),
    ]
    expect(levelFor(noise, KC, 'kv')).toBe(1)
    const mine = [ev(10, true), ev(11, true), ev(12, true)]
    expect(levelFor([...noise, ...mine], KC, 'kv')).toBe(2)
    expect(levelFor([ev(1, true, { kind: 'probe' }), ev(2, true, { kind: 'probe' }), ev(3, true, { kind: 'probe' })], KC, 'kv')).toBe(2)
  })

  test('an event carrying several KCs counts for each', () => {
    const two = (i: number, ok: boolean) => ev(i, ok, { data: { kcs: ['t5.kv-bytes-per-token', 't5.gqa-kv-heads'] } })
    const h = [two(1, true), two(2, true), two(3, true)]
    expect(levelFor(h, 't5.gqa-kv-heads', 'kv')).toBe(2)
    expect(levelFor(h, 't5.kv-bytes-per-token', 'kv')).toBe(2)
    expect(levelFor(h, 't5.kv-capacity', 'kv')).toBe(1)
  })

  test('the order events arrive in does not matter (merge, outbox), and the input is not mutated', () => {
    const history = Array.from({ length: 24 }, (_, i) => ev(i, i % 5 !== 4 && i % 7 !== 3))
    const want = stairFor(history, KC, 'kv')
    for (let seed = 1; seed <= 20; seed++) {
      const shuffled = shuffledOrder(history.length, seed).map((i) => history[i])
      const copy = shuffled.slice()
      expect(stairFor(shuffled, KC, 'kv')).toEqual(want)
      expect(shuffled).toEqual(copy)
    }
  })

  test('equal timestamps break on id', () => {
    const a = ev(1, true, { at: at(1), id: 'a' })
    const b = ev(1, false, { at: at(1), id: 'b' })
    const c = ev(1, true, { at: at(1), id: 'c' })
    expect(stairFor([c, b, a], KC, 'kv')).toEqual(stairFor([a, b, c], KC, 'kv'))
  })

  test('a missing ok is a miss', () => {
    expect(levelFor([ev(1, true, { ok: undefined })], KC, 'kv')).toBe(0)
  })
})

describe('convergence on a simulated learner', () => {
  /**
   * A learner whose chance of a correct answer falls with the level: p = σ(a − step · level). A fine ladder
   * stands in for the continuous difficulty the rule is defined on, and the walker settles where p³ = 0.5.
   */
  function accuracy(a: number, step: number, top: number, seed: number, trials = 60000, burn = 8000): number {
    const rand = splitmix32(seed)
    let state: StairState = { level: 0, streak: 0 }
    let correct = 0
    let n = 0
    for (let t = 0; t < trials; t++) {
      const p = 1 / (1 + Math.exp(-(a - step * state.level)))
      const ok = rand() < p
      if (t >= burn) {
        n++
        if (ok) correct++
      }
      state = stairStep(state, ok, top)
    }
    return correct / n
  }

  test.each([
    [3, 0.1],
    [4, 0.25],
    [6, 0.1],
    [6, 0.25],
  ])('learner a=%p, step %p settles at 0.79 ± 0.03', (a, step) => {
    const acc = accuracy(a, step, 79, 1000 + a)
    expect(acc).toBeGreaterThan(0.76)
    expect(acc).toBeLessThan(0.82)
  })

  test('ability does not move the equilibrium: a stronger learner just sits higher', () => {
    const weak = accuracy(2.5, 0.1, 79, 7)
    const strong = accuracy(6, 0.1, 79, 8)
    expect(Math.abs(weak - strong)).toBeLessThan(0.03)
  })

  test('on the real four-level ladder a learner who is 79 % right at level 2 stays near 79 % and mostly at level 2', () => {
    const p = [0.97, 0.9, 0.79, 0.5]
    const rand = splitmix32(99)
    let state: StairState = { level: 1, streak: 0 }
    const seen = [0, 0, 0, 0]
    let correct = 0
    const trials = 20000
    for (let t = 0; t < trials; t++) {
      seen[state.level]++
      const ok = rand() < p[state.level]
      if (ok) correct++
      state = stairStep(state, ok)
    }
    expect(Math.abs(correct / trials - 0.79)).toBeLessThan(0.03)
    expect(Math.max(...seen)).toBe(seen[2])
  })

  test('a learner who is always right ends at level 3; one who is always wrong ends at 0', () => {
    expect(levelFor(Array.from({ length: 40 }, (_, i) => ev(i, true)), KC, 'kv')).toBe(3)
    expect(levelFor(Array.from({ length: 6 }, (_, i) => ev(i, false)), KC, 'kv')).toBe(0)
  })
})
