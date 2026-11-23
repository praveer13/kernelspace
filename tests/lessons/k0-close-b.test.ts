/**
 * K0-CLOSE-B: DeepSeek's day-6 figures, the dated H100 median, and the T7 lessons, after the closing review.
 * - The day-6 totals, hit rate, token counts and the 545% are read from their claims in t7.l4, t6.l1 and t6.l2, and the
 *   5.45 and 6.45 are computed from cost and revenue, so no lesson types a figure a claim holds.
 * - price.h100.median-2026-11 says what the GetDeploying page said on the day it was read, and that the page re-issues
 *   its figure within a dated day.
 * - The ~8x tokens per MW names both number formats: a GB200 NVL72 at FP4 against a single-node H200 at FP8.
 * - T7.L5 gives ModelExpress's result without figures no claim holds: weights alone barely shorten time to API-ready.
 * - T7.L4 and T6.L1 type no Epoch AI date or range and no "as of August 2025".
 * - T7.L2: GuideLLM and AIPerf are "live" as their READMEs say; the opening says each status once; a p95 grows with
 *   run length only past capacity; step 32 of the worked sweep serves fewer tokens per second than step 16.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { ECONOMICS_CLAIMS } from '@/data/claims/lazy/economics'
import { lessonById } from '@/data/lessons'
import t7l3Erratum from '@/data/errata/2026-11-23-t7-l3-frontier-is-downward-sloping'

const src = (p: string) => readFileSync(`src/data/lessons/${p}`, 'utf8')
const text = (id: string) => JSON.stringify(lessonById(id)).replace(/\\n/g, ' ')
const claim = (id: string) => ECONOMICS_CLAIMS.find((c) => c.id === id)!
const num = (id: string) => claim(id).value as number

describe('B1: the day-6 figures are read from their claims', () => {
  const cost = num('bench.deepseek-day6.daily-cost')
  const revenue = num('bench.deepseek-day6.theoretical-revenue')
  test('t7.l4 types no day-6 total, ratio or margin', () => {
    const s = src('t7/unit-economics.ts')
    for (const typed of ["'$87k / $562k'", 'A 545% cost profit margin', '= 5.45', 'about 6.45×', 'price ≈ 6.45×', 'margin of 545%**', 'peak 278']) {
      expect(s).not.toContain(typed)
    }
    expect(s).toContain("claimNumber('bench.deepseek-day6.cost-profit-margin')")
  })
  test('t7.l4 prints the ratios its claims give', () => {
    const t = text('t7.l4')
    expect(t).toContain(`= ${((revenue - cost) / cost).toFixed(2)}, so price is about ${(revenue / cost).toFixed(2)}× cost`)
    expect(t).toContain(`(price ≈ ${(revenue / cost).toFixed(2)}× cost)`)
    expect(t).toContain(`$${Math.round(cost / 1e3)}k / $${Math.round(revenue / 1e3)}k`)
    expect(t).toContain(`A ${num('bench.deepseek-day6.cost-profit-margin')}% cost profit margin`)
  })
  test('t6.l1 and t6.l2 type none of the day-6 figures', () => {
    for (const typed of ['608B input', '168B output', '56.3%', '$87k', '$562k', '545%', '226–278']) {
      expect(src('t6/moe-anatomy.ts')).not.toContain(typed)
      expect(src('t6/wide-ep.ts')).not.toContain(typed)
    }
    expect(text('t6.l1')).toContain(`${num('bench.deepseek-day6.cache-hit-rate')}% KV-cache hit rate`)
    expect(text('t6.l1')).toContain(`the ${num('bench.deepseek-day6.cost-profit-margin')}% cost profit margin`)
    expect(text('t6.l2')).toContain(`the ${num('bench.deepseek-day6.cache-hit-rate')}% KV-cache hit rate`)
  })
})

describe('B2: the dated H100 median is what its page said that day', () => {
  const c = claim('price.h100.median-2026-11')
  test('value, quote, provider count and read date move together', () => {
    expect(c.value).toBe(3.98)
    expect(c.source?.quote).toBe('the median on-demand price is $3.98 per GPU per hour across 46 providers with a priced on-demand config')
    expect(c.verifiedAt).toBe('2026-11-23')
    expect(c.boundary).toContain('46 providers')
    expect(c.boundary).toContain('re-issues')
    expect(c.ttlDays).toBe(30)
  })
})

describe('B3: the ~8x per MW names both number formats', () => {
  test('t7.l3, its erratum and t7.l4 say FP4 against FP8', () => {
    expect(text('t7.l3')).toContain('a GB200 NVL72 at FP4 (no MTP) is ~8× a single-node H200 at FP8, so the gap mixes hardware and number format')
    expect(t7l3Erratum.after).toContain('GB200 NVL72 at FP4 ~8x a single-node H200 at FP8')
    expect(t7l3Erratum.after.length).toBeLessThanOrEqual(240)
    expect(text('t7.l4')).toContain('a GB200 NVL72 at FP4 over a single-node H200 at FP8')
  })
})

describe('B4: ModelExpress without figures no claim holds', () => {
  test('t7.l5 types no ModelExpress timing and says weights alone barely move API-ready', () => {
    const t = text('t7.l5')
    for (const typed of ['11 seconds', '48×', '8 minutes 53', 'vLLM 0.23.0', '8×B200']) expect(t).not.toContain(typed)
    expect(t).toContain('https://github.com/ai-dynamo/modelexpress/blob/v0.8.0/README.md')
    expect(t).toContain('weights alone barely shorten the time to an API-ready replica')
    expect(t).toContain('JIT kernel caches')
  })
})

describe('B5 and B6: no Epoch AI date or range, no "as of August 2025"', () => {
  test('t7.l4 says the Epoch finding in words and links it', () => {
    const s = src('t7/unit-economics.ts')
    for (const typed of ['9×', '900×', 'March 2025', 'Mar 2025']) expect(s).not.toContain(typed)
    expect(s).toContain('https://epoch.ai/data-insights/llm-inference-price-trends')
  })
  test('t6.l1 lists the MoE models as examples, undated', () => {
    expect(src('t6/moe-anatomy.ts')).not.toContain('August 2025')
  })
})

describe('B8 and B9: the live load generators', () => {
  test('GuideLLM and AIPerf are "live", as their READMEs at the pinned tags support', () => {
    expect(claim('status.loadgen.guidellm').value).toBe('live')
    expect(claim('status.loadgen.aiperf').value).toBe('live')
  })
  test('the opening paragraph says each status once and links the vLLM docs for the recommendation', () => {
    const first = (lessonById('t7.l2')!.blocks[0] as { md: string }).md
    expect(first.match(/phased out/g)?.length).toBe(1)
    expect(first).not.toContain('replacement for GenAI-Perf')
    expect(first).toContain('https://docs.vllm.ai/en/latest/benchmarking/cli/')
    expect(first).toContain('GuideLLM and AIPerf are live')
  })
})

describe('B10 and B11: the broken-benchmark p95 and the worked sweep', () => {
  test('a p95 depends on run length past capacity, not past the knee', () => {
    const t = text('t7.l2')
    expect(t).not.toContain('a p95 taken past the knee is not a latency number')
    expect(t).toContain('a p95 taken past capacity is not a latency number')
  })
  test('step 32 serves fewer tokens per second than step 16, at any tail-to-mean ratio the two steps share', () => {
    // tok/s = c × 1000 ÷ mean TPOT, and mean = p95 ÷ r for the same r at both steps.
    for (const r of [1.2, 1.5, 2]) expect((32 * 1000) / (240 / r)).toBeLessThan((16 * 1000) / (96 / r))
    expect((16 * 1000) / (96 / 1.2)).toBe(200)
    expect((32 * 1000) / (240 / 1.2)).toBe(160)
    const t = text('t7.l2')
    expect(t).not.toContain('may still add tokens per second')
    expect(t).toContain('Step 32 serves fewer tokens per second than 16 here')
  })
  test('one new t7.l2 erratum records both', () => {
    const files = readdirSync('src/data/errata').filter((f) => f.endsWith('-t7-l2-knee-and-step-32.ts'))
    expect(files.length).toBe(1)
    expect(existsSync(`src/data/errata/${files[0]}`)).toBe(true)
    const body = readFileSync(`src/data/errata/${files[0]}`, 'utf8')
    expect(body).toContain("lessons: ['t7.l2']")
    expect(body).toContain('past capacity')
    expect(body).toContain('Step 32')
  })
})
