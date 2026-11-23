/** K0-C3: t7.l4's arithmetic recomputed from the registry claims (cost, revenue, both margins, the cache-hit share, the node-day cost), and the sentences it withdrew. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getClaim } from '../../src/data/claims'
import '../../src/data/claims/lazy/economics'
import { lessonById } from '../../src/data/lessons'

const n = (id: string): number => getClaim(id).value as number
const cost = n('bench.deepseek-day6.daily-cost')
const revenue = n('bench.deepseek-day6.theoretical-revenue')
const hitTok = n('bench.deepseek-day6.cache-hit-tokens')
const inTok = n('bench.deepseek-day6.input-tokens')
const outTok = n('bench.deepseek-day6.output-tokens')
const hitP = n('price.deepseek.r1-input-cache-hit')
const missP = n('price.deepseek.r1-input-cache-miss')
const outP = n('price.deepseek.r1-output')

const lesson = lessonById('t7.l4')
const text = JSON.stringify(lesson)

describe('DeepSeek day six, from the claims', () => {
  test('cost is 226.75 nodes x 8 GPUs x $2 x 24 h = $87,072', () => {
    expect(n('bench.deepseek-day6.avg-nodes') * 8 * n('price.deepseek.h800-hourly-assumption') * 24).toBe(cost)
    expect(cost).toBe(87_072)
  })
  test('revenue is $562,027 and the token counts at list prices land within 0.05% of it', () => {
    expect(revenue).toBe(562_027)
    const fromTokens = (hitTok * hitP + (inTok - hitTok) * missP + outTok * outP) / 1e6
    expect(Math.abs(fromTokens - revenue) / revenue).toBeLessThan(0.0005)
  })
  test('cost profit margin is profit over cost: 5.45, so 545%', () => {
    expect(Math.round(((revenue - cost) / cost) * 100)).toBe(n('bench.deepseek-day6.cost-profit-margin'))
    expect(((revenue - cost) / cost).toFixed(2)).toBe('5.45')
  })
  test('gross margin on the same totals is 84.5%, and price is 1 / (1 - m) = 6.45x cost', () => {
    const gross = 1 - cost / revenue
    expect((gross * 100).toFixed(1)).toBe('84.5')
    expect((1 / (1 - gross)).toFixed(2)).toBe('6.45')
    expect((revenue / cost).toFixed(2)).toBe('6.45')
  })
  test('the cache hit is about 25% of input revenue, not more than half (and 8.5% of the day)', () => {
    const hitRev = (hitTok * hitP) / 1e6
    const inputRev = hitRev + ((inTok - hitTok) * missP) / 1e6
    expect(hitRev).toBeCloseTo(47_880, 6)
    expect(inputRev).toBeCloseTo(194_180, 6)
    expect(hitRev / inputRev).toBeGreaterThan(0.24)
    expect(hitRev / inputRev).toBeLessThan(0.26)
    expect(hitRev / inputRev).toBeLessThan(0.5)
    expect(hitRev / revenue).toBeCloseTo(0.085, 3)
    expect(hitTok / inTok).toBeCloseTo(n('bench.deepseek-day6.cache-hit-rate') / 100, 3)
  })
})

describe('the SGLang node-day', () => {
  const tokens = 22.3e3 * 86_400
  const perM = (rent: number) => ((rent * 8 * 24) / tokens) * 1e6
  test('$2 gives $0.20 per million output tokens', () => {
    expect(perM(2).toFixed(2)).toBe('0.20')
  })
  test('the dated median gives about $0.39 per million', () => {
    expect(n('price.h100.median-2026-11')).toBe(3.91)
    expect(perM(n('price.h100.median-2026-11')).toFixed(2)).toBe('0.39')
    expect(8 * n('price.h100.median-2026-11') * 24).toBeCloseTo(750.72, 6)
  })
  test('the older median claim is untouched', () => {
    expect(n('price.h100.median')).toBe(3.49)
    expect(getClaim('price.h100.median').verifiedAt).toBe('2026-10-04')
  })
  test('the new median has a 30-day ttl and no pin', () => {
    expect(getClaim('price.h100.median-2026-11').ttlDays).toBe(30)
    expect(getClaim('price.h100.median-2026-11').pin).toBeUndefined()
  })
})

describe('the napkin relation', () => {
  test('tok/s to earn gross margin m at price P: C x 1e6 / (3600 x P x (1 - m)) = about 1,850 at $2, $0.60, 50%', () => {
    expect(Math.round((2 * 1e6) / (3600 * 0.6 * 0.5))).toBe(1852)
  })
})

describe('the lesson text', () => {
  test('the withdrawn sentences are gone', () => {
    expect(text).not.toContain('why API prices then fell')
    expect(text).not.toContain("value: '~80%'")
    expect(text).not.toContain('~80% in a year because')
    expect(text).not.toContain('~80%')
    expect(text).not.toContain('found the same arithmetic')
    expect(text).not.toContain('more than half the input margin')
    expect(text).not.toContain('price × (1 + margin target)')
    expect(text).not.toContain('Margin: **545%**')
  })
  test('it says cost profit margin, gross margin, the latency limit and the flagship price', () => {
    expect(text).toContain('cost profit margin')
    expect(text).toContain('84.5%')
    expect(text).toContain('TTFT of 2–5 seconds')
    expect(text).toContain('about 25% of its list-price input revenue')
    expect(text).toContain('deepseek-v4-pro')
  })
  test('the lesson reads claims through the snapshot reader and imports no claims module', () => {
    const src = readFileSync('src/data/lessons/t7/unit-economics.ts', 'utf8')
    expect(src).toContain("from '../claims'")
    expect(src).not.toMatch(/from '@\/data\/claims/)
  })
  test('the lesson index blurb carries the label', () => {
    expect(readFileSync('src/data/lessons/index.ts', 'utf8')).toContain('the 545% cost profit margin day')
  })
})
