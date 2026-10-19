import { describe, expect, test } from 'bun:test'
import { byId, type Claim } from '@/data/claims/all'
import { HARDWARE_CLAIMS } from '@/data/claims/hardware'
import itlKit from '@/data/errata/2026-10-19-t5-l3-itl-kit'
import statline from '@/data/errata/2026-10-19-t5-l7-iteration-statline'
import tpotPeriod from '@/data/errata/2026-10-19-t7-l1-tpot-is-a-period'
import type { Erratum } from '@/data/errata/schema'
import decodeKv from '@/data/field-labs/decode-kv'
import { lessonById } from '@/data/lessons'
import { napkinSpec, stepCard } from '@/lib/world/physics/card'
import { readExtract } from '../../scripts/fetch-physics-points'

/**
 * S5-09 (docs/specs/s5.md §7.7, S5-D62, S5-D67): the three errata, the lesson lines they fix and the two η sentences.
 * Every figure the errata and the lessons state is recomputed here from the claims: the datasheet bound at H100 TP 4,
 * 1k/1k, the two measured TPOTs (pinned to the point claims and the extract row each claim copies) and their ratios.
 */
const claim = (id: string): Claim => {
  const c = byId[id]
  if (!c) throw new Error(`claim ${id} is not registered`)
  return c
}
const num = (id: string): number => {
  const v = claim(id).value
  if (typeof v !== 'number') throw new Error(`claim ${id} is not a number`)
  return v
}

const BW = num('hw.h100-sxm.hbm-bw') * 1e12 // TB/s → B/s
const W = num('model.llama3-70b.weight-bytes-fp8')
const KV = num('model.llama3-70b.kv-bytes-per-token-fp8')
const RANGE = num('status.inferencex.harness.range-ratio')
const TP = 4
const NOMINAL = 1024

/** The harness draws lengths uniformly on the integers [⌊ratio × nominal⌋, nominal]; a decoding sequence sits at its prompt plus half its output (§3.6 step 1). */
const meanLen = (Math.floor(RANGE * NOMINAL) + NOMINAL) / 2
const context = meanLen + meanLen / 2
/** The datasheet bound on one step: every weight byte and every cached KV byte of the batch streamed once at the peak bandwidth, per GPU. */
const boundS = (users: number): number => (W + KV * users * context) / TP / BW

const POINTS = [
  { id: '41187', users: 4, claimId: 'bench.ix-l70.h100-vllm-0-10-2-fp8.tp4.1024-1024.c4.tpot', bound: '5.33', measured: '11.78', ratio: '2.2' },
  { id: '41821', users: 64, claimId: 'bench.ix-l70.h100-vllm-0-10-2-fp8.tp4.1024-1024.c64.tpot', bound: '6.35', measured: '19.51', ratio: '3.1' },
] as const
const extract = readExtract()
const ms = (s: number, digits: number): string => (s * 1e3).toFixed(digits)

describe('the datasheet bound and the measured periods (§7.7, S5-D62)', () => {
  test('the claims give K = 5,529 at 4 users and 88,464 at 64 (mean length 921.5, context 1,382.25)', () => {
    expect([BW, W, KV, RANGE]).toEqual([3.35e12, 70.55e9, 163_840, 0.8])
    expect(meanLen).toBe(921.5)
    expect(context).toBe(1382.25)
    expect(4 * context).toBe(5529)
    expect(64 * context).toBe(88_464)
  })

  for (const p of POINTS) {
    test(`id ${p.id}: the bound is ${p.bound} ms, the point claim ${p.measured} ms, ${p.ratio}× the bound`, () => {
      const bound = boundS(p.users)
      expect(ms(bound, 2)).toBe(p.bound)
      // the η = 1 card (napkin) gives the same bound, and memory is its max: the FLOPs side is far below it
      const model = { params: num('model.llama3-70b.params') * 1e9, layers: num('model.llama3-70b.layers'), hidden: num('zoo.llama-3-3-70b.hidden'), kvBytesPerToken: KV, weightBytes: W }
      const chip = { bwBps: BW, peakFlops: num('hw.h100-sxm.fp8-dense') * 1e12, hbmBytes: num('hw.h100-sxm.hbm-capacity') * 1e9 }
      const K = p.users * context
      const card = stepCard(napkinSpec(chip, model), TP, { seqs: p.users, tokens: p.users, kvTokens: K, attnPairs: K })
      expect(card.bound).toBe('mem')
      expect(Math.abs(card.stepS - bound) / bound).toBeLessThan(1e-12)
      // the measurement is the point claim, which is the extract row's raw member
      const c = claim(p.claimId)
      expect(c.source?.row).toBe(`id ${p.id}`)
      expect(c.unit).toBe('s')
      const row = extract.find((r) => r.id === p.id)!
      expect([row.hardware, row.precision, row.decode_tp, row.conc, row.isl, row.osl]).toEqual(['h100', 'fp8', TP, p.users, NOMINAL, NOMINAL])
      expect(row.mean_tpot).toBe(c.value as number)
      expect(ms(row.mean_tpot, 2)).toBe(p.measured)
      expect((row.mean_tpot / bound).toFixed(1)).toBe(p.ratio)
      // a lower bound: every measurement sits above it
      expect(row.mean_tpot).toBeGreaterThan(bound)
    })
  }

  test('the t5-l7 figure is id 41187 to one decimal: 11.8 ms', () => {
    expect(ms(num(POINTS[0].claimId), 1)).toBe('11.8')
  })
})

const ERRATA: readonly [string, Erratum][] = [
  ['2026-10-19-t5-l3-itl-kit', itlKit],
  ['2026-10-19-t7-l1-tpot-is-a-period', tpotPeriod],
  ['2026-10-19-t5-l7-iteration-statline', statline],
]
/** "ITL ≈ …", "TPOT = …": the equality the first draft wrote. */
const EQUALITY = /\b(?:ITL|TPOT)\s*[=≈]/

describe('the three errata', () => {
  test('each id is its file name, dated the day it shipped, kind error, with a source and retrieval items', () => {
    for (const [stem, e] of ERRATA) {
      expect(e.id).toBe(stem)
      expect(stem.startsWith(`${e.date}-`)).toBe(true)
      expect(e.kind).toBe('error')
      expect(e.source?.url).toBe(claim(POINTS[0].claimId).source?.url)
      expect(e.items?.length).toBeGreaterThan(0)
      for (const item of e.items ?? []) expect(item.why?.length).toBe(item.options.length)
    }
  })

  test('t5-l3 states the bound, not the equality, with both measurements and both ratios', () => {
    expect(itlKit.lessons).toEqual(['t5.l3'])
    expect(itlKit.after).toContain('at least')
    expect(itlKit.after).toContain('not that ÷ batch')
    expect(itlKit.after).not.toMatch(EQUALITY)
    for (const p of POINTS) expect(itlKit.after).toContain(`${p.measured} ms`)
    expect(itlKit.after).toContain('2.2× and 3.1× the bound')
    expect(itlKit.after).toContain('ids 41187, 41821')
  })

  test('t7-l1 says the ratio is a rate and the period is at least the bound, with both ratios', () => {
    expect(tpotPeriod.lessons).toEqual(['t7.l1'])
    expect(tpotPeriod.after).toContain('a rate')
    expect(tpotPeriod.after).toContain('at least')
    expect(tpotPeriod.after).toContain('2.2× and 3.1×')
    expect(tpotPeriod.after).not.toMatch(EQUALITY)
  })

  test('t5-l7 cites id 41187 at 11.8 ms and names the 50 ms tick a teaching unit', () => {
    expect(statline.lessons).toEqual(['t5.l7'])
    expect(statline.after).toContain('11.8 ms')
    expect(statline.after).toContain('id 41187')
    expect(statline.after).toContain('teaching unit')
    const why = statline.items![0].why!.join(' ')
    expect(why).toContain('11.78 ms')
    expect(why).toContain(`${POINTS[0].bound} ms`)
  })

  test('the retrieval items test "not divided by batch" and "a rate, not a period; a lower bound", and no key is an equality', () => {
    const batch = itlKit.items![0]
    expect(batch.options[batch.correct[0]]).toContain('full step time')
    expect(batch.options.filter((o) => o.includes('divided by'))).toHaveLength(2)
    expect(batch.correct[0]).not.toBe(batch.options.findIndex((o) => o.includes('divided by 16')))
    const period = tpotPeriod.items![0]
    const key = period.options[period.correct[0]]
    expect(key).toContain('B ÷ W is a floor on TPOT')
    expect(key).toContain('W ÷ B is a rate')
    expect(period.options.find((o) => o.includes('exactly'))).toBeDefined()
    expect(key).not.toContain('exactly')
    for (const [, e] of ERRATA) for (const item of e.items ?? []) expect(item.options[item.correct[0]]).not.toMatch(EQUALITY)
    // the ratios in the whys are the computed ones
    expect(period.why![1]).toContain('2.2× and 3.1×')
  })
})

describe('the lesson lines the errata fix', () => {
  const md = (id: string): string => {
    const lesson = lessonById(id)
    if (!lesson) throw new Error(`no lesson ${id}`)
    return JSON.stringify(lesson.blocks)
  }

  test('t5.l3: ITL is the whole step, at least the bound, never divided by batch; the measurements and ratios are the claims\'', () => {
    const text = md('t5.l3')
    expect(text).not.toContain('/ bandwidth / batch')
    expect(text).not.toContain('divided by batch efficiency')
    expect(text).not.toContain('within ~2×')
    expect(text).toContain('ITL ≥ (weight_bytes + KV_bytes_per_token × Σ context)')
    for (const p of POINTS) expect(text).toContain(`${p.measured} ms`)
    expect(text).toContain('2.2× and 3.1× its floor')
  })

  test('t7.l1: TPOT is a period, at least the bound; bandwidth ÷ bytes is a rate', () => {
    const text = md('t7.l1')
    expect(text).not.toContain('bandwidth ÷ (weight+KV bytes)')
    expect(text).toContain('per-token decode period, seconds per token')
    expect(text).toContain('at least (weight + KV bytes each GPU reads per step) ÷ its bandwidth')
    expect(text).toContain('2.2× it at 4 users and 3.1× at 64')
  })

  test('t5.l7: the statline is the measured mean time per token, said to be a mean and not one step, and no copy keeps the unsourced 50 ms step', () => {
    const lesson = lessonById('t5.l7')!
    const stats = lesson.blocks.flatMap((b) => (b.type === 'statline' ? b.stats : []))
    const step = stats.find((s) => s.label === 'mean time per token')
    expect(stats.find((s) => s.label === 'one decode step')).toBeUndefined()
    expect(step?.value).toBe(`${ms(num(POINTS[0].claimId), 1)} ms`)
    expect(step?.hint).toContain('id 41187')
    expect(step?.hint).toContain('a mean over every step a user waits through, prefills included, not one step')
    expect(stats.find((s) => s.value === '~50 ms')).toBeUndefined()
    const text = md('t5.l7')
    expect(text).not.toContain('~50 ms step')
    expect(text).not.toContain('roughly 50 ms')
    expect(text).not.toContain('about 50 ms each')
  })
})

describe('what the lines say of the gap and the mean (S5-D5, S5-11 review)', () => {
  test('t7-l1: the key puts the gap on "other per-step work", not on a fixed cost, and the swapped-roles option says the bound is a lower bound', () => {
    const item = tpotPeriod.items![0]
    const why = item.why!
    expect(why[item.correct[0]]).toContain('other per-step work comes on top')
    expect(why.join(' ')).not.toMatch(/fixed/i)
    expect(why[3]).toContain('is the lower bound on the time')
    expect(why[3]).not.toContain('is the time.')
  })

  test('t5.l7: 11.8 ms is a mean over every step a user waits through, not one step, and a one-second period is about 85 steps of it', () => {
    const lesson = lessonById('t5.l7')!
    const text = JSON.stringify(lesson.blocks)
    expect(text).not.toContain('one decode step')
    expect(text).not.toContain('dozens of steps')
    const steps = 1 / num(POINTS[0].claimId)
    expect(Math.round(steps)).toBe(85)
    expect(text).toContain('up to about 85 steps (1 s ÷ 11.8 ms)')
    const quiz = lesson.blocks.flatMap((b) => (b.type === 'quiz' ? b.questions : [])).find((q) => q.q === 'Continuous batching schedules at what granularity?')!
    expect(quiz.explanation).toContain('a mean over every step a user waits through, prefills included')
    expect(statline.after).toContain('a mean over every step a user waits through, prefills included')
    expect(statline.title).not.toContain('decode step')
  })
})

describe('the two η sentences point to the physics tab (§7.7, S5-D5, S5-D67)', () => {
  const OLD = 'Peak datasheet figure; real kernels reach roughly 80-90% of it.'

  test('hardware.ts: the H100 bandwidth boundary is no longer than the old one, points to the tab and states no figure', () => {
    expect(OLD.length).toBe(63)
    const boundary = HARDWARE_CLAIMS.find((c) => c.id === 'hw.h100-sxm.hbm-bw')!.boundary!
    expect(boundary.length).toBeLessThanOrEqual(OLD.length)
    expect(new TextEncoder().encode(boundary).length).toBeLessThanOrEqual(new TextEncoder().encode(OLD).length)
    expect(boundary).toContain('physics tab')
    expect(boundary).not.toMatch(/\d/)
  })

  test("decode-kv: the speed verdict's below text points to the tab with the InferenceX fit's split, and drops \"half\"", () => {
    const below = decodeKv.metrics.find((m) => m.id === 'tps')!.below
    expect(below).toContain("physics tab")
    expect(below).toContain("the InferenceX fit's split")
    expect(below).toContain('other equally good fits split differently')
    expect(below).not.toMatch(/half/i)
    expect(below).not.toMatch(/\d/)
  })
})
