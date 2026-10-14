import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { checkFamily, checkHashes, genSeeds, lintLiterals, readHashRows } from '../../scripts/verify-generators'
import { partsText } from '../../src/lib/items/core'
import goodput from '../../src/lib/items/families/goodput'
import { correctResponse } from '../../src/lib/items/grade'
import type { Instance, Level, Response } from '../../src/lib/items/types'

const FILE = new URL('../../src/lib/items/families/goodput.ts', import.meta.url)
const hashes = readHashRows('goodput') // tests/fixtures/items/hashes/goodput.json
const LEVELS = [0, 1, 2, 3] as const
const seeds = genSeeds(100)

const truthOf = (i: Instance): number => (i.answer.kind === 'choice' ? Number.NaN : i.answer.truth)
const list = (i: Instance, k: string): number[] => String(i.params[k]).split(',').map(Number)
const numeric = (i: Instance, value: number): Response => ({ kind: 'numeric', value, unit: i.answer.kind === 'numeric' ? i.answer.unit : '' })

/** Every instance of a variant over the 100 test seeds, at the given levels. */
function all(variant: string, levels: readonly Level[] = LEVELS): Instance[] {
  return levels.flatMap((l) => seeds.map((s) => goodput.make(s, l, variant)))
}

/** The counts of a request table, recomputed from its raw columns the way a learner would. */
function counts(i: Instance): { n: number; both: number; ttft: number; tpot: number } {
  const [ttft, tpot] = [list(i, 'ttft'), list(i, 'tpot')]
  const [bt, bp] = [Number(i.params.sloTtft), Number(i.params.sloTpot)]
  return {
    n: ttft.length,
    both: ttft.filter((x, k) => x < bt && tpot[k] < bp).length,
    ttft: ttft.filter((x) => x < bt).length,
    tpot: tpot.filter((x) => x < bp).length,
  }
}

describe('the goodput family (§5.3)', () => {
  test('passes the whole §5.6 suite at 100 seeds, with no dead rule', () => {
    const r = checkFamily(goodput, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * 5 * 4)
  })

  test('declares the five variants at levels 0-3 and the four KCs', () => {
    expect(goodput.variants.map((v) => v.id)).toEqual(['slo-count', 'goodput-rate', 'knee', 'frontier', 'replicas'])
    for (const v of goodput.variants) expect(v.levels).toEqual([0, 1, 2, 3])
    expect([...goodput.kcs].sort()).toEqual(['t7.capacity-planning', 't7.goodput', 't7.goodput-curve', 't7.pareto-frontier'])
    expect(goodput.variants.map((v) => v.kcs)).toEqual([['t7.goodput'], ['t7.goodput'], ['t7.goodput-curve'], ['t7.pareto-frontier'], ['t7.capacity-planning']])
  })

  test('names the five spec diagnoses, with the two one-bound slips told apart', () => {
    expect(goodput.ratioRules.map((r) => r.id)).toEqual([
      'goodput.one-bound',
      'goodput.one-bound-tpot',
      'goodput.all-requests',
      'goodput.per-minute',
      'goodput.no-headroom',
      'goodput.floor',
    ])
  })

  test('its hash fixture has this family\'s rows and they match', () => {
    expect(Object.keys(hashes.goodput).sort()).toEqual(goodput.variants.map((v) => v.id).sort())
    expect(checkHashes(goodput, hashes)).toEqual([])
  })

  test('its source passes the literal lint', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('every number is a hypothetical scenario: no instance reads a claim, and every prompt says so', () => {
    for (const v of goodput.variants) {
      for (const l of LEVELS) {
        const i = goodput.make(seeds[4], l, v.id)
        expect(i.claims).toEqual([])
        expect(partsText(i.prompt.stem)).toContain('hypothetical')
      }
    }
  })
})

describe('pins', () => {
  const pin = (needle: string) => goodput.pins.find((p) => p.name.includes(needle))!.make()

  test('t7.l1\'s pair, TTFT under 2 s and TPOT under 100 ms, over eight requests: four meet both, 0.4 req/s over 10 s', () => {
    expect(goodput.pins).toHaveLength(2)
    const count = pin('four meet both')
    expect(truthOf(count)).toBe(4)
    expect(partsText(count.prompt.stem)).toContain('TTFT under 2,000 ms and TPOT under 100 ms')
    expect(count.level).toBe(0)
    const rate = pin('0.4 req/s')
    expect(truthOf(rate)).toBeCloseTo(0.4, 9)
    expect(partsText(rate.prompt.stem)).toContain('10 seconds')
    expect(rate.level).toBe(0)
  })

  test('the pinned table tells every slip apart: five requests meet TTFT, six meet TPOT, eight is every request', () => {
    expect(counts(pin('four meet both'))).toEqual({ n: 8, both: 4, ttft: 5, tpot: 6 })
  })

  test('level 0 always uses the lesson\'s pair, in milliseconds', () => {
    for (const i of [...all('slo-count', [0]), ...all('goodput-rate', [0])]) {
      expect([i.params.sloTtft, i.params.sloTpot, i.params.ttftUnit]).toEqual([2000, 100, 'ms'])
    }
  })
})

describe('the truths', () => {
  test('slo-count is the number of requests under both bounds, strictly', () => {
    for (const i of all('slo-count')) {
      expect(truthOf(i)).toBe(counts(i).both)
      expect(truthOf(i)).toBeGreaterThanOrEqual(2)
      // no request sits on a bound, so "under" and "at most" agree
      for (const x of list(i, 'ttft')) expect(x).not.toBe(Number(i.params.sloTtft))
      for (const x of list(i, 'tpot')) expect(x).not.toBe(Number(i.params.sloTpot))
    }
  })

  test('every one-bound count, and the count of all requests, differs from the truth and from each other', () => {
    for (const i of [...all('slo-count'), ...all('goodput-rate')]) {
      const c = counts(i)
      expect(new Set([c.both, c.ttft, c.tpot, c.n]).size).toBe(4)
      expect(c.n).toBeGreaterThanOrEqual(8)
      expect(c.n).toBeLessThanOrEqual(12)
    }
  })

  test('goodput-rate is the count over the window in seconds, or in minutes at level 3', () => {
    for (const i of all('goodput-rate')) {
      const secs = i.params.winUnit === 'min' ? Number(i.params.win) * 60 : Number(i.params.win)
      expect(truthOf(i)).toBeCloseTo(counts(i).both / secs, 12)
      expect(i.params.winUnit).toBe(i.level === 3 ? 'min' : 's')
    }
  })

  test('the knee is the last row under the limit, every row after it is over, and throughput always rises', () => {
    for (const i of all('knee')) {
      const [conc, tps, tpot] = [list(i, 'conc'), list(i, 'tps'), list(i, 'tpot')]
      const limit = Number(i.params.limit)
      expect(conc).toHaveLength(6)
      const key = conc.filter((_, k) => tpot[k] < limit).length - 1
      expect(key).toBeGreaterThanOrEqual(0)
      expect(key).toBeLessThanOrEqual(4)
      // the passing rows are a prefix: TPOT rises with concurrency
      tpot.forEach((x, k) => expect(x < limit).toBe(k <= key))
      for (let k = 1; k < 6; k++) {
        expect(tpot[k]).toBeGreaterThan(tpot[k - 1])
        expect(tps[k]).toBeGreaterThan(tps[k - 1])
        expect(conc[k]).toBeGreaterThan(conc[k - 1])
      }
      if (i.answer.kind !== 'choice') throw new Error('knee is a choice')
      expect(i.answer.correct).toEqual([`c${key}`])
      expect(i.answer.options.find((o) => o.id === `c${key}`)!.text).toBe(`${conc[key]} concurrent requests`)
      expect(i.answer.options).toHaveLength(6)
    }
  })

  test('the frontier answer is the point with the most tok/s/GPU among those at or over the floor', () => {
    for (const i of all('frontier')) {
      const [tg, tu] = [list(i, 'tg'), list(i, 'tu')]
      const floor = i.params.surface === 'period' ? 1000 / Number(i.params.periodMs) : Number(i.params.floor)
      expect(Number.isInteger(floor)).toBe(true)
      const feasible = tg.map((g, k) => ({ g, k })).filter(({ k }) => tu[k] >= floor)
      expect(feasible.length).toBeGreaterThanOrEqual(3 - (i.level === 0 ? 1 : 0))
      expect(feasible.length).toBeLessThan(tg.length)
      const best = feasible.reduce((a, b) => (b.g > a.g ? b : a))
      // the winner is unique, and the point with the most tok/s/GPU overall is not it
      expect(feasible.filter(({ g }) => g === best.g)).toHaveLength(1)
      expect(tg.indexOf(Math.max(...tg))).not.toBe(best.k)
      if (i.answer.kind !== 'choice') throw new Error('frontier is a choice')
      expect(i.answer.correct).toEqual(['ABCDE'[best.k]])
      expect(i.answer.options.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D', 'E'].slice(0, tg.length))
      // no two points tie on either axis among the feasible ones, so "the most" is well defined
      expect(new Set(feasible.map(({ k }) => tu[k])).size).toBe(feasible.length)
    }
  })

  test('replicas is ceil(λ ÷ (g · (1 − h))), never a whole number, with floor and no-headroom counts that differ from it and from each other', () => {
    for (const i of all('replicas')) {
      const [lambda, g, h] = [Number(i.params.lambda), Number(i.params.goodput), Number(i.params.headroom)]
      const raw = lambda / (g * (1 - h / 100))
      expect(Number.isInteger(raw)).toBe(false)
      expect(truthOf(i)).toBe(Math.ceil(raw))
      expect(new Set([Math.ceil(raw), Math.floor(raw), Math.ceil(lambda / g)]).size).toBe(3)
      expect(raw).toBeGreaterThanOrEqual(3)
      expect(truthOf(i)).toBeLessThanOrEqual(28)
    }
  })
})

describe('levels', () => {
  test('level 0 shows every step with the last blanked, level 1 drops the last step and blanks the one before, levels 2 and 3 show none', () => {
    for (const v of goodput.variants) {
      for (const l of LEVELS) {
        for (const s of [seeds[3], seeds[8]]) {
          const i = goodput.make(s, l, v.id)
          const full = goodput.solution(i)
          if (l >= 2) {
            expect(i.prompt.worked).toBeUndefined()
            continue
          }
          const worked = i.prompt.worked!
          expect(worked.filter((w) => w.blank)).toHaveLength(1)
          expect(worked.findIndex((w) => w.blank)).toBe(l === 0 ? full.length - 1 : full.length - 2)
          expect(worked).toHaveLength(l === 0 ? full.length : full.length - 1)
          const blank = worked.find((w) => w.blank)!
          const at = worked.indexOf(blank)
          // a blank step keeps what it computes and drops how: its text is no longer than the full step's
          expect(partsText(blank.text).length).toBeLessThanOrEqual(partsText(full[at].text).length)
        }
      }
    }
  })

  test('no visible worked step already holds the answer (numeric variants)', () => {
    for (const v of ['slo-count', 'goodput-rate', 'replicas']) {
      for (const i of all(v, [0, 1])) {
        for (const w of i.prompt.worked!) if (!w.blank) expect(w.result?.value).not.toBe(truthOf(i))
      }
    }
  })

  test('a blanked step does not leak the list, the rows or the point it found', () => {
    for (const v of ['slo-count', 'knee', 'frontier']) {
      for (const i of all(v, [0, 1])) {
        const blank = i.prompt.worked!.find((w) => w.blank)!
        const text = partsText(blank.text)
        expect(text).not.toMatch(/\bR\d/)
        expect(text).not.toContain('next row')
        expect(text).not.toContain('point ')
      }
    }
  })

  test('the transfer level changes the surface: seconds against milliseconds, a window in minutes, per-user tok/s, a TPOT floor, a peak per minute', () => {
    expect(new Set(all('slo-count', [3]).map((i) => i.params.ttftUnit))).toEqual(new Set(['s']))
    const secs = all('slo-count', [3])[0]
    const table = secs.prompt.stem.find((p) => p.t === 'table')
    if (table?.t !== 'table') throw new Error('no table')
    expect(table.columns[1]).toBe('TTFT (s)')
    expect(partsText(secs.prompt.stem)).toContain('TTFT under')
    expect(new Set(all('goodput-rate', [3]).map((i) => i.params.winUnit))).toEqual(new Set(['min']))
    expect(new Set(all('knee', [3]).map((i) => i.params.surface))).toEqual(new Set(['rate']))
    expect(new Set(all('knee', [0, 1, 2]).map((i) => i.params.surface))).toEqual(new Set(['tpot']))
    expect(new Set(all('frontier', [3]).map((i) => i.params.surface))).toEqual(new Set(['period']))
    expect(new Set(all('frontier', [0, 1, 2]).map((i) => i.params.surface))).toEqual(new Set(['floor']))
    expect(new Set(all('replicas', [3]).map((i) => i.params.peakUnit))).toEqual(new Set(['min']))
    expect(partsText(all('replicas', [3])[0].prompt.stem)).toContain('requests per minute')
  })

  test('a clean frontier at level 0 (no dominated point), a dominated one that meets the floor from level 1', () => {
    for (const l of LEVELS) {
      for (const i of all('frontier', [l])) {
        if (i.answer.kind !== 'choice') throw new Error('frontier is a choice')
        const dominated = i.answer.options.filter((o) => o.miss === 'goodput.dominated')
        expect(dominated).toHaveLength(l === 0 ? 0 : 1)
        expect(list(i, 'tg')).toHaveLength(5)
      }
    }
  })
})

describe('diagnoses', () => {
  const at = (variant: string, level: Level) => seeds.map((s) => goodput.make(s, level, variant))
  const diag = (i: Instance, value: number) => goodput.grade(i, numeric(i, value)).diagnosis?.id

  test('counting only TTFT, or only TPOT, is named per bound, on a count and on a rate', () => {
    for (const l of LEVELS) {
      for (const i of at('slo-count', l)) {
        const c = counts(i)
        expect(diag(i, c.ttft)).toBe('goodput.one-bound')
        expect(diag(i, c.tpot)).toBe('goodput.one-bound-tpot')
      }
      for (const i of at('goodput-rate', l)) {
        const c = counts(i)
        expect(diag(i, (truthOf(i) * c.ttft) / c.both)).toBe('goodput.one-bound')
        expect(diag(i, (truthOf(i) * c.tpot) / c.both)).toBe('goodput.one-bound-tpot')
      }
    }
  })

  test('the level-3 message for a missed unit says the table is in seconds', () => {
    const i = at('slo-count', 3)[0]
    // ms against seconds: every TTFT passes, so a learner who skips the conversion counts only TPOT
    const g = goodput.grade(i, numeric(i, counts(i).tpot))
    expect(g.diagnosis?.message).toContain('seconds')
    const plain = at('slo-count', 2)[0]
    expect(goodput.grade(plain, numeric(plain, counts(plain).tpot)).diagnosis?.message).not.toContain('seconds')
  })

  test('counting every request is named, on a count and on a rate', () => {
    for (const i of at('slo-count', 2)) expect(diag(i, counts(i).n)).toBe('goodput.all-requests')
    for (const i of at('goodput-rate', 2)) expect(diag(i, (truthOf(i) * counts(i).n) / counts(i).both)).toBe('goodput.all-requests')
  })

  test('a rate per minute is truth × 60, whether the window was in seconds or in minutes, and is not diagnosed on a count', () => {
    for (const l of LEVELS) for (const i of at('goodput-rate', l)) expect(diag(i, truthOf(i) * 60)).toBe('goodput.per-minute')
    const i = at('slo-count', 2)[0]
    expect(diag(i, truthOf(i) * 60)).toBeUndefined()
    // at level 3 the minutes message is the one that says why
    const m = at('goodput-rate', 3)[0]
    expect(goodput.grade(m, numeric(m, truthOf(m) * 60)).diagnosis?.message).toContain('minutes')
    const s = at('goodput-rate', 1)[0]
    expect(goodput.grade(s, numeric(s, truthOf(s) * 60)).diagnosis?.message).toContain('per minute')
  })

  test('no headroom divides by the whole goodput, and rounding down is a replica short', () => {
    for (const l of LEVELS) {
      for (const i of at('replicas', l)) {
        const [lambda, g, h] = [Number(i.params.lambda), Number(i.params.goodput), Number(i.params.headroom)]
        expect(diag(i, Math.ceil(lambda / g))).toBe('goodput.no-headroom')
        expect(diag(i, Math.floor(lambda / (g * (1 - h / 100))))).toBe('goodput.floor')
      }
    }
  })

  test('an unconverted per-minute peak is named at level 3 and nowhere else', () => {
    for (const i of at('replicas', 3)) {
      const [lambda, g, h] = [Number(i.params.lambda), Number(i.params.goodput), Number(i.params.headroom)]
      expect(diag(i, Math.ceil((lambda * 60) / (g * (1 - h / 100))))).toBe('goodput.per-minute')
    }
    for (const i of at('replicas', 2)) {
      const [lambda, g, h] = [Number(i.params.lambda), Number(i.params.goodput), Number(i.params.headroom)]
      expect(diag(i, Math.ceil((lambda * 60) / (g * (1 - h / 100))))).toBeUndefined()
    }
  })

  test('a right answer is never diagnosed', () => {
    for (const v of goodput.variants) {
      for (const l of LEVELS) {
        const i = goodput.make(seeds[9], l, v.id)
        const g = goodput.grade(i, correctResponse(i))
        expect(g.ok).toBe(true)
        expect(g.diagnosis).toBeUndefined()
      }
    }
  })
})

describe('the choice items', () => {
  test('a knee item names the slip behind every wrong row: below the knee, past it, or the peak throughput', () => {
    const seen = new Set<string>()
    for (const i of all('knee')) {
      if (i.answer.kind !== 'choice') throw new Error('knee is a choice')
      const key = Number(i.answer.correct[0].slice(1))
      i.answer.options.forEach((o, k) => {
        expect(o.why.length).toBeGreaterThan(20)
        if (k === key) return expect(o.miss).toBeUndefined()
        seen.add(o.miss!)
        expect(o.miss).toBe(k < key ? 'goodput.below-knee' : k === 5 ? 'goodput.peak-throughput' : 'goodput.past-knee')
        expect(goodput.grade(i, { kind: 'choice', picks: [o.id] }).diagnosis?.id).toBe(o.miss)
      })
    }
    expect([...seen].sort()).toEqual(['goodput.below-knee', 'goodput.past-knee', 'goodput.peak-throughput'])
  })

  test('the peak throughput is always the last row and always past the knee, so it is never the key', () => {
    for (const i of all('knee')) {
      const tps = list(i, 'tps')
      expect(tps.indexOf(Math.max(...tps))).toBe(5)
      if (i.answer.kind !== 'choice') throw new Error('knee is a choice')
      expect(i.answer.correct).not.toEqual(['c5'])
    }
  })

  test('a frontier item names the slip behind every wrong point', () => {
    const seen = new Set<string>()
    for (const i of all('frontier')) {
      if (i.answer.kind !== 'choice') throw new Error('frontier is a choice')
      for (const o of i.answer.options) {
        expect(o.why.length).toBeGreaterThan(20)
        if (i.answer.correct.includes(o.id)) {
          expect(o.miss).toBeUndefined()
          continue
        }
        seen.add(o.miss!)
        expect(goodput.grade(i, { kind: 'choice', picks: [o.id] }).diagnosis?.id).toBe(o.miss)
      }
      expect(goodput.grade(i, correctResponse(i)).ok).toBe(true)
    }
    expect([...seen].sort()).toEqual(['goodput.below-floor', 'goodput.dominated', 'goodput.feasible-not-best', 'goodput.max-interactivity', 'goodput.max-throughput'])
  })

  test('the option text is the label alone, so no surface feature carries the key', () => {
    for (const i of all('frontier', [2])) if (i.answer.kind === 'choice') for (const o of i.answer.options) expect(o.text).toBe(`Point ${o.id}`)
    for (const i of all('knee', [2])) {
      if (i.answer.kind !== 'choice') continue
      for (const o of i.answer.options) expect(o.text).toMatch(/^[\d,]+ concurrent requests$/)
    }
  })

  test('the key is not the longest option more than a third of the time, and both ends of the sweep occur as keys', () => {
    const items = all('knee')
    let longest = 0
    const keys = new Set<string>()
    for (const i of items) {
      if (i.answer.kind !== 'choice') continue
      keys.add(i.answer.correct[0])
      const lens = i.answer.options.map((o) => o.text.length)
      const top = i.answer.options.filter((o) => o.text.length === Math.max(...lens))
      if (top.length === 1 && i.answer.correct.includes(top[0].id)) longest++
    }
    expect(longest / items.length).toBeLessThanOrEqual(0.3)
    expect([...keys].sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4'])
  })
})
