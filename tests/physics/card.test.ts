/**
 * The step card (docs/specs/s5.md §3.2, S5-02): the operation order, the two worked examples to the digits
 * printed, the napkin pins (S5-D38) and the golden step vectors.
 */
import { describe, expect, test } from 'bun:test'
import { atlasRow } from '../../src/data/atlas'
import { claimNumber } from '../../src/data/claims'
import { BYTES_PER_WEIGHT, CHAT_TOKENS, bootInputs, deriveBoot } from '../../src/lib/boot/model'
import roofline from '../../src/lib/items/families/roofline'
import { DTYPE_BYTES, type Dtype } from '../../src/lib/items/units'
import { DEFAULT_STATE, SETUPS, kvModel, stateFromSetup, type KvState } from '../../src/lib/sims/models/kv'
import { NAPKIN, napkinSpec, stepCard } from '../../src/lib/world/physics/card'
import type { CardSpec, ChipShape, ModelShape, StepCard, StepLoad } from '../../src/lib/world/physics/types'
import vectors from '../fixtures/physics/step-vectors.json'

const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b)
/** A figure at the digits the spec prints it: `milli(x.memS, 6)` is "6.200614" for 0.006200614 s. */
const ms = (seconds: number, digits: number): string => (seconds * 1e3).toFixed(digits)
const pct = (value: number, truth: number): string => `${((value / truth - 1) * 100).toFixed(1)}`

/* ---- the Llama-3-70B architecture, FP8 weights and KV (§3.3), as an arithmetic fixture ---- */
const M70: ModelShape = { params: 70.55e9, layers: 80, hidden: 8192, kvBytesPerToken: 163840, weightBytes: 70.55e9 }
const H100: ChipShape = { bwBps: 3.35e12, peakFlops: 1.979e15, hbmBytes: 80e9 }
const B200: ChipShape = { bwBps: 8e12, peakFlops: 4.5e15, hbmBytes: 180e9 }

describe('§3.6 worked example A: a decode step (H100 · FP8, TP 4, 4 users, ~1k/1k)', () => {
  const spec: CardSpec = { chip: H100, model: M70, params: { etaMem: 0.86, etaFlop: 0.5, layerUs: 68.8, seqUs: 69.0, linkGBs: 231 } }
  const tp = 4

  test('1. lengths: [819, 1,024], mean 921.5, context 1,382.25, K = A = 5,529', () => {
    const lo = Math.floor(0.8 * 1024)
    expect([lo, 1024]).toEqual([819, 1024])
    const mean = (lo + 1024) / 2
    expect(mean).toBe(921.5)
    const ctx = mean + mean / 2
    expect(ctx).toBe(1382.25)
    expect(4 * ctx).toBe(5529)
  })

  const load: StepLoad = { seqs: 4, tokens: 4, kvTokens: 5529, attnPairs: 5529 }
  const card = stepCard(spec, tp, load)

  test('2. memory: kv·K = 905,871,360 B; + W = 71,455,871,360 B; ÷ 4 = 17,863,967,840 B; η_m·BW = 2.881e12; memS = 6.200614 ms', () => {
    expect(M70.kvBytesPerToken * 5529).toBe(905_871_360)
    expect(M70.weightBytes + M70.kvBytesPerToken * 5529).toBe(71_455_871_360)
    expect(card.memBytes).toBe(17_863_967_840)
    expect(rel(0.86 * H100.bwBps, 2.881e12)).toBeLessThan(1e-15)
    expect(ms(card.memS, 6)).toBe('6.200614')
  })

  test('3. compute: 564,400,000,000 + 14,493,941,760 = 578,893,941,760; ÷ 4 = 144,723,485,440; η_f·F = 9.895e14; flopS = 0.146259 ms; memory-bound', () => {
    expect(2 * M70.params * 4).toBe(564_400_000_000)
    expect(4 * 80 * 8192 * 5529).toBe(14_493_941_760)
    expect(564_400_000_000 + 14_493_941_760).toBe(578_893_941_760)
    expect(card.flops).toBe(144_723_485_440)
    expect(rel(0.5 * H100.peakFlops, 9.895e14)).toBeLessThan(1e-15)
    expect(ms(card.flopS, 6)).toBe('0.146259')
    expect(card.bound).toBe('mem')
  })

  test('4. fixed: 80 × 68.8 + 4 × 69.0 = 5,504 + 276 = 5,780 µs', () => {
    expect(80 * 68.8).toBe(5504)
    expect(4 * 69.0).toBe(276)
    expect(ms(card.fixedS, 6)).toBe('5.780000')
    expect(card.fixedS * 1e6).toBeCloseTo(5780, 9)
  })

  test('5. link: 15,728,640 B per GPU; ÷ 231e9 B/s = 0.068089 ms', () => {
    expect(card.linkBytes).toBe(15_728_640)
    expect(ms(card.linkS, 6)).toBe('0.068089')
  })

  test('6. step: 5.780000 + 0.068089 + 6.200614 = 12.048703 ms → 12,049 µs; +2.3 % against 11.776 ms measured', () => {
    expect(ms(card.stepS, 6)).toBe('12.048703')
    expect(card.us).toBe(12_049)
    expect(Number.isInteger(card.us)).toBe(true)
    expect(pct(card.us / 1000, 11.776)).toBe('2.3')
  })

  test('7. debrief: napkin 5.33 ms (−54.7 %), card 12.05 ms, measured 11.78 ms, v1 50 ms (+324.6 %); TP 2 → 8 is 4.0× napkin and 1.91× measured', () => {
    const napkin = stepCard(napkinSpec(H100, M70), tp, load)
    expect(ms(napkin.stepS, 2)).toBe('5.33')
    expect(napkin.bound).toBe('mem')
    // max(17,863,967,840 ÷ 3.35e12, 144,723,485,440 ÷ 1.979e15), written out
    expect(napkin.stepS).toBe(Math.max(17_863_967_840 / 3.35e12, 144_723_485_440 / 1.979e15))
    expect(pct(napkin.stepS * 1e3, 11.776)).toBe('-54.7')
    expect(ms(card.stepS, 2)).toBe('12.05')
    expect((11.776147370379336).toFixed(2)).toBe('11.78')
    expect(pct(50, 11.776)).toBe('324.6')
    // measured-only finding: ids 42017 and 41625
    const tp2 = stepCard(napkinSpec(H100, M70), 2, load)
    const tp8 = stepCard(napkinSpec(H100, M70), 8, load)
    expect((tp2.memS / tp8.memS).toFixed(1)).toBe('4.0')
    expect((17.41 / 9.11).toFixed(2)).toBe('1.91')
  })
})

describe('§3.7 worked example B: a prefill step (B200 · FP8, TP 1, 4 users, ~8k/1k)', () => {
  // §3.7 gives no β: it is moot at TP 1 (the link term is 0 either way)
  const params = { etaMem: 0.84, etaFlop: 0.44, layerUs: 61.1, seqUs: 34.6 }
  const spec: CardSpec = { chip: B200, model: M70, params: { ...params, linkGBs: null } }

  test('1. lengths: [6,553, 8,192], mean 7,372.5, p = 7,373 in one step; 3 decodes at 7,373 + 461 = 7,834', () => {
    const lo = Math.floor(0.8 * 8192)
    expect([lo, 8192]).toEqual([6553, 8192])
    expect((lo + 8192) / 2).toBe(7372.5)
    const p = 7373
    expect(p + 3).toBeLessThanOrEqual(8192)
    expect(Math.round((Math.floor(0.8 * 1024) + 1024) / 2 / 2)).toBe(461)
    expect(p + 461).toBe(7834)
  })

  const load: StepLoad = { seqs: 4, tokens: 7373 + 3, kvTokens: 7373 + 3 * 7834, attnPairs: (7373 * 7374) / 2 + 3 * 7834 }
  const card = stepCard(spec, 1, load)

  test('2. load: T = 7,376; K = 30,875; A = 27,184,251 + 23,502 = 27,207,753; seqs = 4', () => {
    expect(load.tokens).toBe(7376)
    expect(load.kvTokens).toBe(30_875)
    expect((7373 * 7374) / 2).toBe(27_184_251)
    expect(3 * 7834).toBe(23_502)
    expect(load.attnPairs).toBe(27_207_753)
    expect(load.seqs).toBe(4)
  })

  test('3. compute: 1,040,753,600,000,000 + 71,323,492,024,320 = 1,112,077,092,024,320 FLOP; η_f·F = 1.98e15; flopS = 561.655097 ms', () => {
    expect(2 * M70.params * 7376).toBe(1_040_753_600_000_000)
    expect(4 * 80 * 8192 * 27_207_753).toBe(71_323_492_024_320)
    expect(card.flops).toBe(1_112_077_092_024_320)
    expect(rel(0.44 * B200.peakFlops, 1.98e15)).toBeLessThan(1e-15)
    expect(ms(card.flopS, 6)).toBe('561.655097')
  })

  test('4. memory: 70.55e9 + 5,058,560,000 = 75,608,560,000 B; ÷ 6.72e12 = 11.251274 ms; compute-bound', () => {
    expect(M70.kvBytesPerToken * 30_875).toBe(5_058_560_000)
    expect(card.memBytes).toBe(75_608_560_000)
    expect(rel(0.84 * B200.bwBps, 6.72e12)).toBeLessThan(1e-15)
    expect(ms(card.memS, 6)).toBe('11.251274')
    expect(card.bound).toBe('flop')
  })

  test('5. fixed: 80 × 61.1 + 4 × 34.6 = 4,888 + 138.4 = 5,026.4 µs → 5.026400 ms; link 0 at TP 1, with or without β', () => {
    expect(80 * 61.1).toBe(4888)
    expect(ms(card.fixedS, 6)).toBe('5.026400')
    expect(card.linkBytes).toBe(0)
    expect(card.linkS).toBe(0)
    const withBeta = stepCard({ ...spec, params: { ...spec.params, linkGBs: 291 } }, 1, load)
    expect(withBeta).toEqual(card)
  })

  test('6. step: 5.026400 + 0 + 561.655097 = 566.681497 ms → 566,681 µs (the engine\'s TTFT for this request)', () => {
    expect(ms(card.stepS, 6)).toBe('566.681497')
    expect(card.us).toBe(566_681)
  })

  test('7. against the published TTFT: + 52.7 ms harness = 619.38 ms, −5.3 % against 654.02; the card alone −13.4 %', () => {
    const published = 0.654017546446994
    expect((published * 1e3).toFixed(2)).toBe('654.02')
    expect((card.us / 1e3 + 52.7).toFixed(2)).toBe('619.38')
    expect(pct(card.us / 1e3 + 52.7, published * 1e3)).toBe('-5.3')
    expect(pct(card.us / 1e3, published * 1e3)).toBe('-13.4')
  })

  test('8. debrief: napkin 247.13 ms (−62.2 %, compute-bound too); v1: ⌈7,373 / 128⌉ − 1 = 57 ticks × 50 ms = 2,850 ms', () => {
    const napkin = stepCard(napkinSpec(B200, M70), 1, load)
    expect(napkin.flops).toBe(1_112_077_092_024_320)
    expect(ms(napkin.stepS, 2)).toBe('247.13')
    expect(napkin.bound).toBe('flop')
    expect(pct(napkin.stepS * 1e3, 654.017546446994)).toBe('-62.2')
    const ticks = Math.ceil(7373 / 128) - 1
    expect(ticks).toBe(57)
    expect(ticks * 50).toBe(2850)
  })
})

describe('the card: every field, in the order written', () => {
  const spec: CardSpec = { chip: H100, model: M70, params: { etaMem: 0.9, etaFlop: 0.5, layerUs: 70, seqUs: 60, linkGBs: 200 } }
  const load: StepLoad = { seqs: 8, tokens: 8, kvTokens: 12_000, attnPairs: 12_000 }

  test('returns all ten fields of StepCard, and `us` is one Math.round of stepS in µs', () => {
    const c = stepCard(spec, 2, load)
    expect(Object.keys(c).sort()).toEqual(['bound', 'flopS', 'flops', 'fixedS', 'linkBytes', 'linkS', 'memBytes', 'memS', 'stepS', 'us'].sort())
    expect(c.us).toBe(Math.round(c.stepS * 1e6))
    expect(Number.isInteger(c.us)).toBe(true)
  })

  test('each field is the formula of §3.2, computed with the same grouping', () => {
    const tp = 2
    const c = stepCard(spec, tp, load)
    const p = spec.params
    const memBytes = (M70.weightBytes + M70.kvBytesPerToken * load.kvTokens) / tp
    const flops = (2 * M70.params * load.tokens + 4 * M70.layers * M70.hidden * load.attnPairs) / tp
    const linkBytes = (2 * M70.layers * load.tokens * M70.hidden * 2 * 2 * (tp - 1)) / tp
    const memS = memBytes / (p.etaMem * H100.bwBps)
    const flopS = flops / (p.etaFlop * H100.peakFlops)
    const linkS = linkBytes / (200 * 1e9)
    const fixedS = (M70.layers * p.layerUs + load.seqs * p.seqUs) / 1e6
    const stepS = fixedS + linkS + Math.max(memS, flopS)
    expect(c).toEqual({ memBytes, flops, linkBytes, memS, flopS, fixedS, linkS, stepS, bound: 'mem', us: Math.round(stepS * 1e6) })
  })

  test('link bytes: two ring all-reduces of BF16 activations per layer, 0 at TP 1; no β, no link time', () => {
    const t = (tp: number): StepCard => stepCard(spec, tp, load)
    expect(t(1).linkBytes).toBe(0)
    expect(t(1).linkS).toBe(0)
    for (const tp of [2, 3, 4, 8]) expect(t(tp).linkBytes).toBe((2 * 80 * 8 * 8192 * 4 * (tp - 1)) / tp)
    const noLink = stepCard({ ...spec, params: { ...spec.params, linkGBs: null } }, 4, load)
    expect(noLink.linkBytes).toBeGreaterThan(0)
    expect(noLink.linkS).toBe(0)
  })

  test('the bound is "mem" on a tie and flips with the max', () => {
    const toy: CardSpec = {
      chip: { bwBps: 2, peakFlops: 2, hbmBytes: 16 },
      model: { params: 1, layers: 1, hidden: 1, kvBytesPerToken: 0, weightBytes: 2 },
      params: NAPKIN,
    }
    const load1: StepLoad = { seqs: 1, tokens: 1, kvTokens: 0, attnPairs: 0 }
    const tie = stepCard(toy, 1, load1)
    expect([tie.memS, tie.flopS, tie.bound]).toEqual([1, 1, 'mem'])
    expect(stepCard(toy, 1, { ...load1, tokens: 2 }).bound).toBe('flop')
  })
})

describe('the napkin pins (S5-D38; no caller is edited)', () => {
  test('NAPKIN is η = 1 with no fixed terms and no link term', () => {
    expect(NAPKIN).toEqual({ etaMem: 1, etaFlop: 1, layerUs: 0, seqUs: 0, linkGBs: null })
    expect(napkinSpec(H100, M70)).toEqual({ chip: H100, model: M70, params: NAPKIN })
  })

  // Boot builds its inputs with claimNumber(id, 1e12) and 1e9: the card takes the same units and the same operation order
  const i = bootInputs()
  const boot: CardSpec = napkinSpec(
    { bwBps: i.bandwidth, peakFlops: i.flops, hbmBytes: i.capacity },
    {
      params: i.params,
      layers: claimNumber('model.llama3-8b.layers'),
      hidden: claimNumber('model.llama3-8b.hidden-size'),
      kvBytesPerToken: i.kvPerToken,
      weightBytes: i.params * BYTES_PER_WEIGHT,
    },
  )
  const one = { seqs: 1, tokens: 1, attnPairs: 0 }

  test('memS === deriveBoot().tokenSeconds with no KV, and === stepSeconds with Boot\'s chats × 4,096 tokens, on Boot\'s own inputs', () => {
    const b = deriveBoot(i)
    expect(stepCard(boot, 1, { ...one, kvTokens: 0 }).memS).toBe(b.tokenSeconds)
    const k = stepCard(boot, 1, { ...one, kvTokens: b.chats * CHAT_TOKENS })
    expect(k.memS).toBe(b.stepSeconds)
    expect(k.memBytes).toBe(b.stepBytes)
    expect(k.stepS).toBe(b.stepSeconds)
    expect(b.chats).toBe(119)
  })

  const kvStateOf = (s: KvState) => {
    const r = kvModel(s)
    const gpu = atlasRow(s.gpuId)
    const spec = napkinSpec(
      { bwBps: (gpu.hbmBwGBs ?? Number.NaN) * 1e9, peakFlops: 1, hbmBytes: r.totalHbmGb * 1e9 },
      { params: 1, layers: 1, hidden: 1, kvBytesPerToken: r.kvPerToken, weightBytes: r.weights * 1e9 },
    )
    return { r, card: stepCard(spec, s.gpuCount, { seqs: s.batch, tokens: s.batch, kvTokens: s.ctx * s.batch * r.shareFactor, attnPairs: 0 }) }
  }

  test('agrees with kv.ts itlMs on its fixtures (the five setups, the default and a grid of GPU counts and contexts) to 1e-12 relative', () => {
    const states: KvState[] = [DEFAULT_STATE, ...Object.values(SETUPS).map(stateFromSetup)]
    for (const gpuCount of [1, 2, 4, 8]) for (const ctx of [1024, 8192, 32768]) for (const batch of [1, 16, 128]) {
      states.push({ ...stateFromSetup(SETUPS['kv.fp8-rescue']), gpuCount, ctx, batch })
      states.push({ ...DEFAULT_STATE, gpuCount, ctx, batch, prefixShare: 50 })
    }
    expect(states.length).toBeGreaterThan(70)
    let worst = 0
    for (const s of states) {
      const { r, card } = kvStateOf(s)
      worst = Math.max(worst, rel(card.memS * 1000, r.itlMs))
    }
    console.log(`napkin vs kv.ts itlMs: max relative deviation ${worst.toExponential(2)} over ${states.length} states`)
    expect(worst).toBeLessThanOrEqual(1e-12)
  })

  test('roofline decode-b1 with fb = 100: 1 ÷ memS (tp 1, K = 0, W = paramsB·1e9·bytes) equals the truth to 1e-12 relative', () => {
    const instances = [roofline.pins.find((p) => p.name.includes('Boot') && p.name.includes('decode'))!.make()]
    for (let seed = 1; seed <= 400; seed++) for (const level of [0, 1, 2, 3] as const) instances.push(roofline.make(seed, level, 'decode-b1'))
    const plain = instances.filter((x) => x.params.fb === 100)
    // a quarter of the draws are the plain datasheet case, and the pin is one of them
    expect(plain.length).toBeGreaterThan(400)
    expect(plain[0]).toBe(instances[0])
    // draws with fb < 100 are out of scope (S5-D38): the card's η = 1 cannot match them
    expect(instances.length - plain.length).toBeGreaterThan(0)
    let worst = 0
    for (const x of plain) {
      if (x.answer.kind !== 'estimate') throw new Error('decode-b1 is an estimate')
      const gpu = atlasRow(String(x.params.hw))
      const dtype = x.params.dtype as Dtype
      const model: ModelShape = { params: 1, layers: 1, hidden: 1, kvBytesPerToken: 0, weightBytes: Number(x.params.paramsB) * 1e9 * DTYPE_BYTES[dtype] }
      const card = stepCard(napkinSpec({ bwBps: (gpu.hbmBwGBs ?? Number.NaN) * 1e9, peakFlops: 1, hbmBytes: 1 }, model), 1, { seqs: 1, tokens: 1, kvTokens: 0, attnPairs: 0 })
      worst = Math.max(worst, rel(1 / card.memS, x.answer.truth))
    }
    console.log(`napkin vs roofline decode-b1 (fb = 100): max relative deviation ${worst.toExponential(2)} over ${plain.length} instances`)
    expect(worst).toBeLessThanOrEqual(1e-12)
  })
})

describe('the 50 golden step vectors', () => {
  const specs = vectors.specs as Record<string, CardSpec>
  const list = vectors.vectors as { name: string; spec: string; tp: number; load: StepLoad; card: StepCard }[]

  test('there are 50, with distinct names, each over a declared spec', () => {
    expect(list).toHaveLength(50)
    expect(new Set(list.map((v) => v.name)).size).toBe(50)
    for (const v of list) expect(Object.keys(specs)).toContain(v.spec)
  })

  test('they cover both rows\' parameters (§3.6, §3.7), napkin, TP 1-8, decode, prefill and mixed loads, and a bound on each side', () => {
    const used = new Set(list.map((v) => v.spec))
    for (const k of ['h100-fp8-example-a', 'b200-fp8-example-b', 'napkin-h100-fp8', 'napkin-b200-fp8', 'napkin-boot-8b-bf16']) expect(used.has(k)).toBe(true)
    expect(specs['h100-fp8-example-a'].params).toEqual({ etaMem: 0.86, etaFlop: 0.5, layerUs: 68.8, seqUs: 69, linkGBs: 231 })
    expect(specs['b200-fp8-example-b'].params).toMatchObject({ etaMem: 0.84, etaFlop: 0.44, layerUs: 61.1, seqUs: 34.6 })
    for (const k of ['napkin-h100-fp8', 'napkin-b200-fp8', 'napkin-boot-8b-bf16']) expect(specs[k].params).toEqual(NAPKIN)
    expect([...new Set(list.map((v) => v.tp))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const kind = (l: StepLoad): 'decode' | 'prefill' | 'mixed' => {
      const decodes = l.seqs - 1
      if (l.tokens === l.seqs) return 'decode'
      return decodes > 0 && l.tokens > l.seqs ? 'mixed' : 'prefill'
    }
    const kinds = new Set(list.map((v) => kind(v.load)))
    expect([...kinds].sort()).toEqual(['decode', 'mixed', 'prefill'])
    const bounds = list.map((v) => v.card.bound)
    expect(bounds).toContain('mem')
    expect(bounds).toContain('flop')
    for (const row of ['h100-fp8-example-a', 'b200-fp8-example-b']) {
      const b = list.filter((v) => v.spec === row).map((v) => v.card.bound)
      expect(b).toContain('mem')
      expect(b).toContain('flop')
    }
  })

  test('the two worked examples are in it, at 12,049 and 566,681 µs', () => {
    expect(list.find((v) => v.name.startsWith('example A'))?.card.us).toBe(12_049)
    expect(list.find((v) => v.name.startsWith('example B'))?.card.us).toBe(566_681)
  })

  test('stepCard reproduces every vector exactly (===, every field)', () => {
    for (const v of list) expect({ name: v.name, card: stepCard(specs[v.spec], v.tp, v.load) }).toEqual({ name: v.name, card: v.card })
  })

  test('each vector\'s `us` rounds its stepS, its stepS sums its terms and its bound follows the max', () => {
    for (const v of list) {
      expect(v.load.seqs).toBeGreaterThanOrEqual(1)
      expect(v.card.us).toBe(Math.round(v.card.stepS * 1e6))
      expect(v.card.stepS).toBe(v.card.fixedS + v.card.linkS + Math.max(v.card.memS, v.card.flopS))
      expect(v.card.bound).toBe(v.card.memS >= v.card.flopS ? 'mem' : 'flop')
    }
  })

  test('the fixture is an independent check, not just a snapshot: a re-grouped reference agrees to 1e-12', () => {
    for (const v of list) {
      const s = specs[v.spec]
      const p = s.params
      const T = v.load.tokens
      const bytes = (s.model.weightBytes + s.model.kvBytesPerToken * v.load.kvTokens) / v.tp
      const flops = (2 * s.model.params * T + 4 * s.model.layers * s.model.hidden * v.load.attnPairs) / v.tp
      const link = v.tp > 1 && p.linkGBs !== null ? (4 * s.model.layers * T * s.model.hidden * 2 * (v.tp - 1)) / v.tp / (p.linkGBs * 1e9) : 0
      const fixed = (s.model.layers * p.layerUs + v.load.seqs * p.seqUs) * 1e-6
      const step = fixed + link + Math.max(bytes / s.chip.bwBps / p.etaMem, flops / s.chip.peakFlops / p.etaFlop)
      expect(rel(v.card.stepS, step)).toBeLessThan(1e-12)
    }
  })
})
