import { describe, expect, test } from 'bun:test'
import {
  CALIBRATION_MIN_N,
  CONFIDENCE_P,
  selectCalibration,
  sureSummary,
  wilson,
} from '../../src/lib/learner/calibration'
import type { Confidence, LedgerEvent } from '../../src/lib/ledger/types'
import { splitmix32 } from '../../src/lib/rng'
import { makeProfile, startTab } from '../ledger/env'

const LEVELS: Confidence[] = ['guess', 'think', 'sure']

let seq = 0
function item(ok: boolean, conf?: Confidence, over: Record<string, unknown> = {}): LedgerEvent {
  seq++
  return {
    id: `e${seq}`,
    v: 1,
    kind: 'item',
    ref: `quiz:t0.l1#${seq % 5}`,
    at: '2026-09-01T08:00:00.000Z',
    tz: 0,
    day: '2026-09-01',
    dev: 'd',
    rev: 'r',
    score: ok ? 1 : 0,
    ok,
    provenance: 'practice',
    ...(conf ? { conf } : {}),
    data: { src: 'quiz' },
    ...over,
  } as LedgerEvent
}

describe('mapping', () => {
  test('is the accepted v1 mapping (Addendum A3)', () => {
    expect(CONFIDENCE_P).toEqual({ guess: 0.33, think: 0.67, sure: 0.95 })
  })
})

describe('wilson', () => {
  // reference values: the roots of (k/n − p)² = z² p(1 − p)/n, solved by bisection in Python (z = 1.959963984540054)
  const REF: [number, number, number, number][] = [
    [0, 1, 0, 0.7934506856227626],
    [1, 1, 0.20654931437723745, 1],
    [0, 10, 0, 0.27753279986288915],
    [5, 10, 0.236593090512564, 0.7634069094874361],
    [10, 10, 0.7224672001371109, 1],
    [18, 20, 0.6989663547715128, 0.9721335187862319],
    [81, 100, 0.7222115462093563, 0.8748524849023127],
    [3, 7, 0.15821985525146975, 0.7495416354723428],
    [1, 2, 0.09453120573423077, 0.9054687942657693],
    [50, 60, 0.7196838683638547, 0.9068682302080855],
  ]
  for (const [k, n, lo, hi] of REF) {
    test(`${k}/${n}`, () => {
      const w = wilson(k, n)
      expect(Math.abs(w.lo - lo)).toBeLessThan(1e-9)
      expect(Math.abs(w.hi - hi)).toBeLessThan(1e-9)
    })
  }
  test('no trials is the whole interval', () => {
    expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 })
  })
  test('stays inside [0,1] and contains the sample proportion', () => {
    for (let n = 1; n <= 60; n++) {
      for (let k = 0; k <= n; k++) {
        const w = wilson(k, n)
        expect(w.lo).toBeGreaterThanOrEqual(0)
        expect(w.hi).toBeLessThanOrEqual(1)
        expect(w.lo).toBeLessThanOrEqual(k / n + 1e-12)
        expect(w.hi).toBeGreaterThanOrEqual(k / n - 1e-12)
      }
    }
  })
})

describe('selectCalibration', () => {
  test('brier = reliability − resolution + uncertainty to 1e-12 on random inputs', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = splitmix32(seed)
      const n = 1 + Math.floor(rand() * 200)
      const bias = rand() // per-run skill, so ok rates differ between runs
      const events: LedgerEvent[] = []
      for (let i = 0; i < n; i++) {
        const conf = LEVELS[Math.floor(rand() * 3)]
        const ok = rand() < 0.2 + 0.7 * bias * (LEVELS.indexOf(conf) / 2 + 0.3)
        events.push(item(ok, conf))
      }
      const c = selectCalibration(events)
      expect(c.n).toBe(n)
      expect(Math.abs(c.brier - (c.reliability - c.resolution + c.uncertainty))).toBeLessThan(1e-12)
      // and brier really is mean((p − ok)²)
      const direct =
        events.reduce((s, e) => {
          const p = CONFIDENCE_P[(e as { conf: Confidence }).conf]
          return s + (p - (e.kind === 'item' && e.ok ? 1 : 0)) ** 2
        }, 0) / n
      expect(Math.abs(c.brier - direct)).toBeLessThan(1e-12)
    }
  })

  test('counts bins, bias and sure-and-wrong', () => {
    const events = [
      item(true, 'sure'),
      item(true, 'sure'),
      item(false, 'sure'),
      item(true, 'think'),
      item(false, 'guess'),
      item(false, 'guess'),
    ]
    const c = selectCalibration(events)
    expect(c.n).toBe(6)
    expect(c.bins.map((b) => [b.conf, b.n, b.correct])).toEqual([
      ['guess', 2, 0],
      ['think', 1, 1],
      ['sure', 3, 2],
    ])
    expect(c.bins[2].accuracy).toBeCloseTo(2 / 3, 12)
    expect(c.bins[0].accuracy).toBe(0)
    expect(c.sureWrong).toBe(1)
    const meanP = (2 * 0.33 + 0.67 + 3 * 0.95) / 6
    expect(c.bias).toBeCloseTo(meanP - 3 / 6, 12)
    expect(c.bins[2].lo).toBeCloseTo(wilson(2, 3).lo, 12)
  })

  test('unrated answers are excluded, not counted as wrong or right', () => {
    const rated = [item(true, 'sure'), item(false, 'think')]
    const withUnrated = [...rated, item(false), item(true), item(false)]
    expect(selectCalibration(withUnrated)).toEqual(selectCalibration(rated))
    expect(selectCalibration([item(true), item(false)]).n).toBe(0)
  })

  test('reads item, probe and predict only', () => {
    const events = [
      item(true, 'sure'),
      item(true, 'sure', { kind: 'probe', ref: 'quiz:t0.l1#0' }),
      item(false, 'think', { kind: 'predict', ref: 'boot:s1', data: { value: 1, unit: 'x', truth: 2, src: 'boot' } }),
      // a stray conf on a quiz summary is ignored
      item(true, 'sure', { kind: 'quiz', ref: 'lesson:t0.l1', data: {} }),
    ]
    expect(selectCalibration(events).n).toBe(3)
  })

  test('ignores an unknown conf value', () => {
    expect(selectCalibration([item(true, 'certain' as Confidence)]).n).toBe(0)
  })

  test('since keeps events at or after the instant', () => {
    const events = [
      item(true, 'sure', { at: '2026-08-31T23:59:59.999Z' }),
      item(false, 'sure', { at: '2026-09-01T00:00:00.000Z' }),
      item(true, 'think', { at: '2026-09-02T00:00:00.000Z' }),
    ]
    const c = selectCalibration(events, { since: '2026-09-01T00:00:00.000Z' })
    expect(c.n).toBe(2)
    expect(c.sureWrong).toBe(1)
  })

  test('an empty history is all zeros and an empty-bin interval', () => {
    const c = selectCalibration([])
    expect(c).toMatchObject({ n: 0, brier: 0, reliability: 0, resolution: 0, uncertainty: 0, bias: 0, sureWrong: 0 })
    expect(c.bins.every((b) => b.accuracy === null && b.lo === 0 && b.hi === 1)).toBe(true)
  })

  test('is order-insensitive', () => {
    const rand = splitmix32(7)
    const events = Array.from({ length: 50 }, () => item(rand() < 0.6, LEVELS[Math.floor(rand() * 3)]))
    const a = selectCalibration(events)
    const b = selectCalibration([...events].reverse())
    expect(Math.abs(a.brier - b.brier)).toBeLessThan(1e-12)
    expect(a.bins).toEqual(b.bins)
  })
})

describe('through the façade', () => {
  test('a quiz attempt with some picks rated feeds calibration and leaves the rest out', async () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordQuizAttempt({
      lessonId: 't0.l3',
      seed: 99,
      responses: [
        { qi: 0, rev: 'a', pick: [1], ok: true, conf: 'sure' },
        { qi: 1, rev: 'b', pick: [0], ok: false, conf: 'sure' },
        { qi: 2, rev: 'c', pick: [2], ok: false },
        { qi: 3, rev: 'd', pick: [0, 1], ok: true, conf: 'guess' },
      ],
    })
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'item')).toHaveLength(4)
    expect(events.filter((e) => e.kind === 'quiz')).toHaveLength(1)
    const c = selectCalibration(events)
    expect(c.n).toBe(3)
    expect(c.sureWrong).toBe(1)
    expect(c.bins.map((b) => [b.conf, b.n, b.correct])).toEqual([
      ['guess', 1, 1],
      ['think', 0, 0],
      ['sure', 2, 1],
    ])
  })
})

describe('sureSummary', () => {
  test('waits for enough rated answers and some sure ones', () => {
    const few = Array.from({ length: CALIBRATION_MIN_N - 1 }, () => item(true, 'sure'))
    expect(sureSummary(selectCalibration(few))).toBeNull()
    const noSure = Array.from({ length: CALIBRATION_MIN_N }, () => item(true, 'think'))
    expect(sureSummary(selectCalibration(noSure))).toBeNull()
    const enough = [
      ...Array.from({ length: 18 }, () => item(true, 'sure')),
      item(false, 'sure'),
      item(false, 'sure'),
    ]
    expect(sureSummary(selectCalibration(enough))).toEqual({ correct: 18, n: 20 })
  })
})
