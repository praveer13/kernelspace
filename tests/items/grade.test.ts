import { describe, expect, test } from 'bun:test'
import {
  correctResponse,
  DEFAULT_RATIO_TOL,
  diagnose,
  estimateScore,
  gradeResponse,
  inTolerance,
  logError,
  ruleRatio,
  SHARED_RULES,
  winkler,
} from '../../src/lib/items/grade'
import type { AnswerSpec, ChoiceOption, Instance, RatioRule, Response } from '../../src/lib/items/types'
import { byteUnitChoices, formatNumber, toCanonical } from '../../src/lib/items/units'

function inst(answer: AnswerSpec, params: Instance['params'] = {}): Instance {
  return { family: 'unit', version: 1, variant: 'v', seed: 1, level: 2, params, kcs: ['t5.kv-bytes-per-token'], prompt: { stem: [] }, answer, claims: [], rev: 'x', nsec: 30 }
}

const numeric = (truth = 131072, extra: Partial<Extract<AnswerSpec, { kind: 'numeric' }>> = {}): Instance =>
  inst({ kind: 'numeric', truth, unit: 'B', tolerance: { rel: 0.01 }, units: byteUnitChoices('B', ['KiB', 'KB']), ...extra })

const estimate = (truth = 1000, interval = true, okWithinFactor = 2): Instance => inst({ kind: 'estimate', truth, unit: 'tokens', okWithinFactor, interval })

const num = (value: number, unit?: string): Response => ({ kind: 'numeric', value, ...(unit ? { unit } : {}) })
const est = (value: number, lo?: number, hi?: number): Response => ({ kind: 'estimate', value, ...(lo === undefined ? {} : { lo }), ...(hi === undefined ? {} : { hi }) })

describe('tolerance and log error', () => {
  test('relative, absolute, either, or exact', () => {
    expect(inTolerance(101, 100, { rel: 0.01 })).toBe(true)
    expect(inTolerance(101.1, 100, { rel: 0.01 })).toBe(false)
    expect(inTolerance(100.4, 100, { abs: 0.5 })).toBe(true)
    expect(inTolerance(100.6, 100, { abs: 0.5 })).toBe(false)
    expect(inTolerance(100.4, 100, { rel: 0.001, abs: 0.5 })).toBe(true)
    expect(inTolerance(105, 100, { rel: 0.1, abs: 0.5 })).toBe(true)
    expect(inTolerance(100, 100, {})).toBe(true)
    expect(inTolerance(100.0001, 100, {})).toBe(false)
    expect(inTolerance(Number.NaN, 100, { rel: 1 })).toBe(false)
    expect(inTolerance(Infinity, Infinity, { rel: 1 })).toBe(false)
  })

  test('logError is |log10(x / truth)| for positive finite numbers only', () => {
    expect(logError(1000, 100)).toBeCloseTo(1, 12)
    expect(logError(10, 100)).toBeCloseTo(1, 12)
    expect(logError(100, 100)).toBe(0)
    expect(logError(0, 100)).toBeUndefined()
    expect(logError(-5, 100)).toBeUndefined()
    expect(logError(Number.NaN, 100)).toBeUndefined()
    expect(logError(Infinity, 100)).toBeUndefined()
    expect(logError(5, 0)).toBeUndefined()
  })
})

describe('estimate score', () => {
  test('1 at the truth, 0 at 5 × the ok factor, linear in log between', () => {
    expect(estimateScore(0, 2)).toBe(1)
    expect(estimateScore(Math.log10(10), 2)).toBeCloseTo(0, 12)
    expect(estimateScore(2, 2)).toBe(0)
    expect(estimateScore(Math.log10(2), 2)).toBeCloseTo(1 - Math.log10(2), 12)
    expect(estimateScore(Math.log10(5), 1.5)).toBeCloseTo(1 - Math.log10(5) / Math.log10(7.5), 12)
  })

  test('grading an estimate: ok exactly at the factor, not beyond, symmetric', () => {
    const i = estimate(1000, false, 2)
    expect(gradeResponse(i, est(1000)).score).toBe(1)
    for (const x of [2000, 500, 1500, 700]) expect(gradeResponse(i, est(x)).ok).toBe(true)
    for (const x of [2001, 499, 5000, 100]) expect(gradeResponse(i, est(x)).ok).toBe(false)
    const g = gradeResponse(i, est(2000))
    expect(g.score).toBeCloseTo(1 - Math.log10(2), 9)
    expect(g.logErr).toBeCloseTo(Math.log10(2), 12)
    expect(gradeResponse(i, est(1e5)).score).toBe(0)
  })

  test('a non-positive estimate is wrong, with no log error', () => {
    const g = gradeResponse(estimate(), est(0))
    expect(g.ok).toBe(false)
    expect(g.score).toBe(0)
    expect(g.logErr).toBeUndefined()
    expect(g.diagnosis).toBeUndefined()
  })
})

describe('Winkler interval score (log10, α = 0.1)', () => {
  test('a hit costs only the log width', () => {
    const w = winkler(100, 1000, 300)!
    expect(w.hit).toBe(true)
    expect(w.score).toBeCloseTo(1, 12)
  })

  test('a miss costs 20 per decade outside, on either side', () => {
    const low = winkler(100, 1000, 10)!
    expect(low.hit).toBe(false)
    expect(low.score).toBeCloseTo(1 + 20, 12)
    const high = winkler(100, 1000, 1e4)!
    expect(high.hit).toBe(false)
    expect(high.score).toBeCloseTo(1 + 20, 12)
    expect(winkler(100, 1000, 100 * 10 ** -0.5)!.score).toBeCloseTo(1 + 10, 9)
  })

  test('the endpoints are inside the interval', () => {
    expect(winkler(100, 1000, 100)!.hit).toBe(true)
    expect(winkler(100, 1000, 1000)!.hit).toBe(true)
  })

  test('an interval that is too wide scores worse than a tight hit; too narrow and missed scores worse still', () => {
    const tight = winkler(800, 1250, 1000)!.score
    const wide = winkler(10, 1e5, 1000)!.score
    const narrowMiss = winkler(100, 110, 1000)!.score
    expect(tight).toBeLessThan(wide)
    expect(wide).toBeLessThan(narrowMiss)
  })

  test('a reversed interval is read as swapped; bad numbers have no score', () => {
    expect(winkler(1000, 100, 300)).toEqual(winkler(100, 1000, 300)!)
    expect(winkler(0, 100, 50)).toBeUndefined()
    expect(winkler(-1, 100, 50)).toBeUndefined()
    expect(winkler(10, Number.NaN, 50)).toBeUndefined()
    expect(winkler(10, 100, 0)).toBeUndefined()
  })

  test('grading attaches it only when the item asks for an interval and both ends are given', () => {
    const asked = estimate(1000, true)
    expect(gradeResponse(asked, est(1000, 500, 2000)).interval).toEqual({ hit: true, score: winkler(500, 2000, 1000)!.score })
    expect(gradeResponse(asked, est(1000, 2000, 3000)).interval?.hit).toBe(false)
    expect(gradeResponse(asked, est(1000, 500)).interval).toBeUndefined()
    expect(gradeResponse(asked, est(1000)).interval).toBeUndefined()
    expect(gradeResponse(estimate(1000, false), est(1000, 500, 2000)).interval).toBeUndefined()
    // an interval does not change whether the point estimate was ok
    expect(gradeResponse(asked, est(1000, 1, 2)).ok).toBe(true)
  })
})

describe('shared ratio rules', () => {
  const answerFor = (ratio: number) => gradeResponse(numeric(), num(131072 * ratio))

  test.each([
    [1000, 'unit.kilo'],
    [1 / 1000, 'unit.kilo'],
    [1024, 'unit.kibi'],
    [1 / 1024, 'unit.kibi'],
    [1.024, 'unit.kibi-vs-kilo'],
    [1 / 1.024, 'unit.kibi-vs-kilo'],
    [8, 'unit.bits-bytes'],
    [1 / 8, 'unit.bits-bytes'],
  ])('ratio %p is %s', (ratio, id) => {
    const g = answerFor(ratio)
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe(id)
    expect(g.diagnosis?.ratio).toBeCloseTo(ratio, 9)
    expect(g.feedback).toContain(g.diagnosis!.message)
  })

  test('kilo and kibi never shadow each other (1,000 and 1,024 are 2.4 % apart)', () => {
    expect(answerFor(1000).diagnosis?.id).toBe('unit.kilo')
    expect(answerFor(1024).diagnosis?.id).toBe('unit.kibi')
    expect(answerFor(1000 * 1.009).diagnosis?.id).toBe('unit.kilo')
    expect(answerFor(1024 * 0.991).diagnosis?.id).toBe('unit.kibi')
    // between the two windows nothing is named
    expect(answerFor(1012).diagnosis).toBeUndefined()
  })

  test('the window is ±2 % by default, ±1 % for the 1,000 / 1,024 rules', () => {
    expect(DEFAULT_RATIO_TOL).toBe(0.02)
    expect(answerFor(8 * 1.019).diagnosis?.id).toBe('unit.bits-bytes')
    expect(answerFor(8 * 0.981).diagnosis?.id).toBe('unit.bits-bytes')
    expect(answerFor(8 * 1.022).diagnosis).toBeUndefined()
    expect(answerFor(1000 * 1.011).diagnosis).toBeUndefined()
    expect(answerFor(1.024 * 1.009).diagnosis?.id).toBe('unit.kibi-vs-kilo')
    expect(answerFor(1.024 * 1.011).diagnosis).toBeUndefined()
  })

  test('every rule has an id, a second-person one-sentence message, and a positive ratio', () => {
    const ids = new Set(SHARED_RULES.map((r) => r.id))
    expect([...ids].sort()).toEqual(['unit.bits-bytes', 'unit.kibi', 'unit.kibi-vs-kilo', 'unit.kilo'])
    for (const r of SHARED_RULES) {
      expect(typeof r.message).toBe('string')
      expect(r.message as string).toMatch(/^Your answer /)
      expect(ruleRatio(r, numeric())).toBeGreaterThan(0)
    }
  })

  test('a right answer and a near miss are not diagnosed as unit slips', () => {
    expect(answerFor(1).diagnosis).toBeUndefined()
    expect(answerFor(1.5).diagnosis).toBeUndefined()
    expect(answerFor(0.9).diagnosis).toBeUndefined()
    expect(diagnose(numeric(), 1, [])).toBeUndefined()
    expect(diagnose(numeric(), -1000, [])).toBeUndefined()
    expect(diagnose(numeric(), Number.NaN, [])).toBeUndefined()
  })
})

describe('family ratio rules', () => {
  const rules: RatioRule[] = [
    { id: 'kv.priced-fp16', ratio: (i) => (i.params.dtype === 'fp8' ? 2 : i.params.dtype === 'fp4' ? 4 : null), message: (i) => `You priced FP16: this cache is ${String(i.params.dtype).toUpperCase()}.` },
    { id: 'kv.forgot-k-and-v', ratio: 0.5, message: 'You counted one plane.' },
    { id: 'kv.loose', ratio: 3, tol: 0.1, message: 'Loose rule.' },
  ]
  const fp8 = numeric(131072, {})
  fp8.params = { dtype: 'fp8' }

  test('the first matching rule wins, in order, and the message can read the instance', () => {
    const g = gradeResponse(fp8, num(131072 * 2), rules)
    expect(g.diagnosis).toEqual({ id: 'kv.priced-fp16', ratio: 2, message: 'You priced FP16: this cache is FP8.' })
    expect(g.feedback).toBe('Not quite. You priced FP16: this cache is FP8.')
    expect(gradeResponse(fp8, num(131072 / 2), rules).diagnosis?.id).toBe('kv.forgot-k-and-v')
  })

  test('a rule whose ratio is null for this instance does not apply', () => {
    const bf16 = numeric(131072)
    bf16.params = { dtype: 'bf16' }
    expect(gradeResponse(bf16, num(131072 * 2), rules).diagnosis).toBeUndefined()
  })

  test('family rules come before shared rules; a rule can widen its own window', () => {
    const eight: RatioRule[] = [{ id: 'fam.eight', ratio: 8, message: 'Family says 8.' }]
    expect(gradeResponse(numeric(), num(131072 * 8), eight).diagnosis?.id).toBe('fam.eight')
    expect(gradeResponse(numeric(), num(131072 * 3.2), rules).diagnosis?.id).toBe('kv.loose')
    expect(gradeResponse(numeric(), num(131072 * 3.4), rules).diagnosis).toBeUndefined()
  })

  test('a computed ratio of 0, a negative or NaN is skipped, not matched', () => {
    const odd: RatioRule[] = [
      { id: 'a.zero', ratio: () => 0, message: 'x' },
      { id: 'a.neg', ratio: () => -1, message: 'x' },
      { id: 'a.nan', ratio: () => Number.NaN, message: 'x' },
    ]
    for (const r of odd) expect(ruleRatio(r, numeric())).toBeNull()
    expect(gradeResponse(numeric(), num(131072 * 3), odd).diagnosis).toBeUndefined()
  })

  test('estimates are diagnosed too, but only when not ok', () => {
    const rule: RatioRule[] = [{ id: 'roofline.sparse-flops', ratio: 3, message: 'You used the sparse figure.' }]
    expect(gradeResponse(estimate(1000, false, 2), est(3000), rule).diagnosis?.id).toBe('roofline.sparse-flops')
    expect(gradeResponse(estimate(1000, false, 4), est(3000), rule).diagnosis).toBeUndefined()
    expect(gradeResponse(estimate(1000, false, 4), est(3000), rule).ok).toBe(true)
  })
})

describe('numeric answers', () => {
  test('ok within tolerance scores 1; outside scores 0; logErr is reported', () => {
    expect(gradeResponse(numeric(), num(131072))).toMatchObject({ ok: true, score: 1, logErr: 0 })
    expect(gradeResponse(numeric(), num(131072 * 1.005)).ok).toBe(true)
    const g = gradeResponse(numeric(), num(131072 * 1.5))
    expect(g).toMatchObject({ ok: false, score: 0 })
    expect(g.logErr).toBeCloseTo(Math.log10(1.5), 12)
    expect(g.feedback).toContain('131,072 B')
  })

  test('the learner may answer in an offered unit', () => {
    expect(gradeResponse(numeric(), num(128, 'KiB')).ok).toBe(true)
    expect(gradeResponse(numeric(), num(131.072, 'KB')).ok).toBe(true)
    expect(gradeResponse(numeric(), num(131072, 'B')).ok).toBe(true)
    // 128 KiB written as 128,000 B is the 1,000-versus-1,024 slip, and the diagnosis names it
    const g = gradeResponse(numeric(), num(128 * 1000, 'B'))
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe('unit.kibi-vs-kilo')
    expect(gradeResponse(numeric(), num(131072 * 1024 * 1024, 'KiB')).ok).toBe(false)
  })

  test('an unoffered unit or a bad number is not ok and says how to fix it', () => {
    const g = gradeResponse(numeric(), num(1, 'furlongs'))
    expect(g).toMatchObject({ ok: false, score: 0 })
    expect(g.feedback).toContain('furlongs')
    for (const v of [Number.NaN, Infinity, -Infinity]) {
      const b = gradeResponse(numeric(), num(v))
      expect(b).toMatchObject({ ok: false, score: 0 })
      expect(b.logErr).toBeUndefined()
    }
  })

  test('the wrong kind of response is ungradable, never a throw', () => {
    expect(gradeResponse(numeric(), est(131072)).ok).toBe(false)
    expect(gradeResponse(numeric(), { kind: 'choice', picks: ['a'] }).ok).toBe(false)
    expect(gradeResponse(estimate(), num(1000)).ok).toBe(false)
    expect(gradeResponse(numeric(), undefined as unknown as Response).ok).toBe(false)
  })

  test('a negative answer is wrong with no log error', () => {
    const g = gradeResponse(numeric(), num(-131072))
    expect(g.ok).toBe(false)
    expect(g.logErr).toBeUndefined()
  })
})

describe('choice answers', () => {
  const opts: ChoiceOption[] = [
    { id: 'a', text: 'A', why: 'a is right because x.' },
    { id: 'b', text: 'B', why: 'b priced FP16.', miss: 'kv.priced-fp16' },
    { id: 'c', text: 'C', why: 'c is a plain wrong.' },
    { id: 'd', text: 'D', why: 'd is also right.' },
  ]
  const single = inst({ kind: 'choice', options: opts, correct: ['a'] })
  const multi = inst({ kind: 'choice', options: opts, correct: ['a', 'd'], multi: true })
  const pick = (...picks: string[]): Response => ({ kind: 'choice', picks })

  test('graded by id; the verdict carries the key option\'s why', () => {
    expect(gradeResponse(single, pick('a'))).toMatchObject({ ok: true, score: 1, feedback: 'Correct: a is right because x.' })
  })

  test('a lure with a miss id names it; a lure without one gives its why and no diagnosis', () => {
    const lure = gradeResponse(single, pick('b'))
    expect(lure).toMatchObject({ ok: false, score: 0, diagnosis: { id: 'kv.priced-fp16', message: 'b priced FP16.' } })
    const plain = gradeResponse(single, pick('c'))
    expect(plain.ok).toBe(false)
    expect(plain.diagnosis).toBeUndefined()
    expect(plain.feedback).toBe('Not quite: c is a plain wrong.')
  })

  test('multi: the exact set is required; a subset, a superset and a mixed set all fail', () => {
    expect(gradeResponse(multi, pick('d', 'a')).ok).toBe(true)
    expect(gradeResponse(multi, pick('a')).ok).toBe(false)
    expect(gradeResponse(multi, pick('a', 'd', 'c')).ok).toBe(false)
    expect(gradeResponse(multi, pick('a', 'b')).diagnosis?.id).toBe('kv.priced-fp16')
    expect(gradeResponse(multi, pick('a')).feedback).toContain('missed "D"')
  })

  test('duplicates collapse; no picks and unknown ids are not ok', () => {
    expect(gradeResponse(single, pick('a', 'a')).ok).toBe(true)
    expect(gradeResponse(single, pick()).ok).toBe(false)
    expect(gradeResponse(single, pick('zzz')).ok).toBe(false)
    expect(gradeResponse(single, pick('a', 'zzz')).ok).toBe(false)
    expect(gradeResponse(single, { kind: 'numeric', value: 1 }).ok).toBe(false)
  })

  test('ratio rules are never applied to a choice', () => {
    const rules: RatioRule[] = [{ id: 'x.y', ratio: 1, message: 'm' }]
    expect(gradeResponse(single, pick('c'), rules).diagnosis).toBeUndefined()
  })
})

describe('hostile responses', () => {
  const answers: Instance[] = [numeric(), estimate(1000, true), estimate(1000, false), inst({ kind: 'choice', options: [{ id: 'a', text: 'A', why: 'w' }, { id: 'b', text: 'B', why: 'w' }], correct: ['a'] })]

  test('grade never throws and always returns a score in [0, 1]', () => {
    const values = [1e9, -1e9, 1e-9, 0, -0, Number.NaN, Infinity, -Infinity, Number.MAX_VALUE, Number.MIN_VALUE, 131072e9, -131072e9]
    for (const i of answers) {
      const responses: Response[] = []
      for (const v of values) {
        responses.push(num(v), num(v, 'KiB'), num(v, 'nope'), est(v), est(1000, v, v), est(1000, v, 1), est(v, v, v))
      }
      responses.push({ kind: 'choice', picks: [] }, { kind: 'choice', picks: ['__proto__'] }, { kind: 'choice', picks: 'a' as unknown as string[] })
      for (const r of responses) {
        const g = gradeResponse(i, r, [])
        expect(g.score >= 0 && g.score <= 1).toBe(true)
        expect(typeof g.ok).toBe('boolean')
        expect(g.feedback.length).toBeGreaterThan(0)
        expect(g.feedback).not.toMatch(/NaN|undefined/)
      }
    }
  })

  test('±1e9 × truth is simply wrong', () => {
    const i = numeric()
    expect(gradeResponse(i, num(131072e9)).ok).toBe(false)
    expect(gradeResponse(i, num(-131072e9)).ok).toBe(false)
  })
})

describe('correctResponse', () => {
  test('grades ok with score 1 for every answer kind', () => {
    const choice = inst({ kind: 'choice', options: [{ id: 'a', text: 'A', why: 'w' }, { id: 'b', text: 'B', why: 'w' }], correct: ['b'] })
    for (const i of [numeric(), estimate(1000, true), estimate(1000, false), choice]) {
      expect(gradeResponse(i, correctResponse(i))).toMatchObject({ ok: true, score: 1 })
    }
  })
})

describe('units', () => {
  test('byteUnitChoices gives value × factor in the canonical unit', () => {
    const u = byteUnitChoices('B', ['KiB', 'MiB', 'KB'])
    expect(u).toEqual([
      { unit: 'B', factor: 1 },
      { unit: 'KiB', factor: 1024 },
      { unit: 'MiB', factor: 1048576 },
      { unit: 'KB', factor: 1000 },
    ])
    expect(byteUnitChoices('KiB', ['B', 'MiB'])).toEqual([
      { unit: 'KiB', factor: 1 },
      { unit: 'B', factor: 1 / 1024 },
      { unit: 'MiB', factor: 1024 },
    ])
    expect(() => byteUnitChoices('furlong', [])).toThrow()
    expect(() => byteUnitChoices('B', ['furlong'])).toThrow()
  })

  test('toCanonical converts, passes the canonical unit through, and refuses unknown units', () => {
    const u = byteUnitChoices('B', ['KiB'])
    expect(toCanonical(2, 'KiB', 'B', u)).toBe(2048)
    expect(toCanonical(2, undefined, 'B', u)).toBe(2)
    expect(toCanonical(2, 'B', 'B', undefined)).toBe(2)
    expect(toCanonical(2, 'MB', 'B', u)).toBeNull()
  })

  test('formatNumber is locale-free and never prints exponent text for ordinary numbers', () => {
    expect(formatNumber(131072)).toBe('131,072')
    expect(formatNumber(1234.5678)).toBe('1,235')
    expect(formatNumber(0.5)).toBe('0.5')
    expect(formatNumber(295.2)).toBe('295.2')
    expect(formatNumber(0.34, 2)).toBe('0.34')
    expect(formatNumber(-1500.4)).toBe('-1,500')
    expect(formatNumber(-0.00001)).toBe('0')
    expect(formatNumber(2, 3)).toBe('2')
    expect(formatNumber(Number.NaN)).toBe('NaN')
    expect(formatNumber(Infinity)).toBe('Infinity')
  })
})
