/**
 * EngineV2 (docs/specs/s5.md §6.2-6.4, S5-05): the step order by hand, the closed loop, the stamps, the median rule,
 * determinism, the step hook and the card override (S5-D53), the refusals, the envelope count, no preemption in the box,
 * the v1 boundary, and the golden fixture that pins ENGINE_V2_REV.
 *
 * The rows here are fixture rows, not the fitted table (§6.4): the two [proto] parameter sets of §3.6 and §3.7, read
 * from the golden step vectors, on the protocol's boxes. Hand cases use `explore` with a hand-built client, since a
 * client of fixed lengths states no box shape.
 *
 * The golden fixture is written only when ENGINE_V2_REV is bumped:
 *   EV2_GOLDEN_WRITE=1 bun test tests/physics/engine-v2.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeRefManager } from '../../src/lib/fleet-model'
import { hash32 } from '../../src/lib/rng'
import { defaultNumBlocks, exceeds } from '../../src/lib/world/physics/box'
import { stepCard } from '../../src/lib/world/physics/card'
import { closedLoop, openLoop, type ClientDriver, type ClientShape, type Request } from '../../src/lib/world/physics/client'
import {
  ENGINE_V2_REV,
  EngineV2,
  NotCalibrated,
  OutOfBox,
  medianOf,
  type EngineV2Config,
  type EngineV2Stats,
  type FinishedV2,
  type StepRecord,
} from '../../src/lib/world/physics/engine-v2'
import type { CalibratedRow, CardSpec, StepCard, StepLoad } from '../../src/lib/world/physics/types'
import { readProtocol } from '../../scripts/physics-protocol'
import vectors from '../fixtures/physics/step-vectors.json'

const GOLDEN_PATH = fileURLToPath(new URL('../fixtures/physics/engine-v2-golden.json', import.meta.url))
const ENGINE_PATH = fileURLToPath(new URL('../../src/lib/world/physics/engine-v2.ts', import.meta.url))
const FLEET_MODEL_PATH = fileURLToPath(new URL('../../src/lib/fleet-model.ts', import.meta.url))
const V1_GOLDEN_PATH = fileURLToPath(new URL('../fixtures/fleet/v1-golden.json', import.meta.url))

/* ------------------------------ fixture rows ------------------------------ */

const protocol = readProtocol()
const SPECS = vectors.specs as Record<string, CardSpec>
const SHAPES = [
  { isl: 1024, osl: 1024 },
  { isl: 1024, osl: 8192 },
  { isl: 8192, osl: 1024 },
] as const
const boxTp = (key: string): number[] => {
  const row = protocol.rows.find((r) => r.key === key)
  if (!row) throw new Error(`no protocol row ${key}`)
  return [...row.boxTp]
}

/** A fixture row: in-box everywhere the protocol boxes it, with an envelope tight enough that 8k prefills leave it. */
const fixtureRow = (key: string, spec: CardSpec): CalibratedRow => ({
  key,
  status: 'calibrated',
  spec,
  harnessMs: 0,
  box: { tp: boxTp(key), maxNumSeqs: 64, shapes: SHAPES, batchTokens: 8192 },
  envelope: { tokens: 8192, decodeSeqs: 64, kvTokensPerGpu: 65_536, attnPairsPerGpu: 8e6 },
  eligible: { tpot: true, ttft: true },
  label: { tpot: { p90: 0, n: 0 }, ttft: { mean: 0, p90: 0, n: 0 } },
})

const H100 = fixtureRow('h100-vllm-0-10-2-fp8', SPECS['h100-fp8-example-a'])
const B200 = fixtureRow('b200-vllm-0-10-2-fp8', SPECS['b200-fp8-example-b'])

/** An in-box closed-loop engine, as the replay builds it (§5.3). */
function boxEngine(
  row: CalibratedRow,
  tp: number,
  c: number,
  shape: { isl: number; osl: number },
  seed: number,
  extra: Partial<EngineV2Config> = {},
): EngineV2 {
  const cfg: EngineV2Config = { physics: { id: 'fixture', row, tp }, maxNumSeqs: c, batchTokens: 8192, blockSize: 16, ...extra }
  const client = closedLoop({ conc: c, n: 10 * c, isl: shape.isl, osl: shape.osl, ratio: 0.8, seed })
  return new EngineV2(cfg, makeRefManager(defaultNumBlocks(row, tp), 16), client)
}

/** A client of fixed requests, sorted by (arrivalUs, id); it states a shape only when given one. */
function fixedClient(reqs: readonly Request[], shape?: ClientShape): ClientDriver {
  const sorted = [...reqs].sort((a, b) => a.arrivalUs - b.arrivalUs || a.id - b.id)
  let next = 0
  return {
    shape,
    nextArrivalUs: () => (next < sorted.length ? sorted[next].arrivalUs : null),
    due: (clockUs) => {
      const out: Request[] = []
      for (; next < sorted.length && sorted[next].arrivalUs <= clockUs; next++) out.push({ ...sorted[next] })
      return out
    },
  }
}

/** A hand-case engine: explore (the client states no shape), the row's own pool unless given. */
function handEngine(
  row: CalibratedRow,
  tp: number,
  reqs: readonly Request[],
  extra: Partial<EngineV2Config> = {},
): { e: EngineV2; steps: StepRecord[]; done: FinishedV2[] } {
  const steps: StepRecord[] = []
  const done: FinishedV2[] = []
  const numBlocks = extra.numBlocks ?? defaultNumBlocks(row, tp)
  const e = new EngineV2(
    { physics: { id: 'fixture', row, tp }, maxNumSeqs: 64, batchTokens: 8192, blockSize: 16, explore: true, onStep: (s) => steps.push(s), ...extra, numBlocks },
    makeRefManager(numBlocks, 16),
    fixedClient(reqs),
  )
  e.onFinish = (r) => done.push(r)
  return { e, steps, done }
}

const req = (id: number, prompt: number, output: number, arrivalUs = 0): Request => ({ id, arrivalUs, prompt, output })
const prefillPairs = (p: number, h: number): number => p * h + (p * (p + 1)) / 2

/* ------------------------------ hand cases (§6.2's step order) ------------------------------ */

describe('hand cases', () => {
  test('an idle one-request run: the clock jumps to the arrival with no step and no iteration; TTFT is one prefill card', () => {
    const { e, steps, done } = handEngine(H100, 2, [req(7, 1000, 3, 120_000)])
    e.step()
    expect(e.clockUs).toBe(120_000)
    expect(e.iterations).toBe(0)
    expect(steps).toEqual([])
    expect(e.lastCard).toBeUndefined()
    e.step()
    const prefill: StepLoad = { seqs: 1, tokens: 1000, kvTokens: 1000, attnPairs: 500_500 }
    const card = stepCard(H100.spec, 2, prefill)
    expect(steps[0]).toEqual({ load: prefill, tp: 2, decoded: [], prefillDone: [7], admitted: [7] })
    expect(e.iterations).toBe(1)
    expect(e.clockUs).toBe(120_000 + card.us)
    expect(e.lastCard).toEqual(card)
    e.run()
    expect(done).toHaveLength(1)
    expect(done[0].ttftAdmitUs).toBe(card.us)
    expect(done[0].ttftUs).toBe(card.us)
    expect(done[0].queueUs).toBe(0)
    // two decode steps at context 1,001 and 1,002, so TPOT is their mean
    const d1 = stepCard(H100.spec, 2, { seqs: 1, tokens: 1, kvTokens: 1001, attnPairs: 1001 }).us
    const d2 = stepCard(H100.spec, 2, { seqs: 1, tokens: 1, kvTokens: 1002, attnPairs: 1002 }).us
    expect(done[0].tpotUs).toBe((d1 + d2) / 2)
    expect(e.iterations).toBe(3)
    expect(e.done()).toBe(true)
  })

  test('an idle gap between requests is a jump, not an iteration', () => {
    const { e, steps } = handEngine(H100, 2, [req(0, 100, 1, 0), req(1, 100, 1, 10_000_000)])
    e.step()
    expect(e.iterations).toBe(1)
    const after = e.clockUs
    expect(after).toBeLessThan(10_000_000)
    e.step()
    expect(e.clockUs).toBe(10_000_000)
    expect(e.iterations).toBe(1)
    expect(steps).toHaveLength(1)
    e.run()
    expect(e.iterations).toBe(2)
  })

  test('a decode-only steady state: TPOT equals the decode card (§3.6\'s load, K = A = 5,529 at TP 4 → 12,049 µs)', () => {
    // prompts 1,381 ×3 and 1,382 prefill together; the next step decodes all four at contexts 1,382 ×3 and 1,383
    const reqs = [req(0, 1381, 2), req(1, 1381, 2), req(2, 1381, 2), req(3, 1382, 2)]
    const { e, steps, done } = handEngine(H100, 4, reqs)
    e.run()
    expect(steps).toHaveLength(2)
    expect(steps[1]).toEqual({ load: { seqs: 4, tokens: 4, kvTokens: 5529, attnPairs: 5529 }, tp: 4, decoded: [0, 1, 2, 3], prefillDone: [], admitted: [] })
    expect(stepCard(H100.spec, 4, steps[1].load).us).toBe(12_049)
    expect(done.map((r) => r.tpotUs)).toEqual([12_049, 12_049, 12_049, 12_049])
  })

  test('a longer steady state: each TPOT is the mean of its decode cards, and with no KV term every decode card is one card', () => {
    const reqs = [0, 1, 2, 3].map((id) => req(id, 512, 9))
    const { e, steps, done } = handEngine(H100, 2, reqs)
    e.run()
    expect(steps).toHaveLength(9)
    let sum = 0
    for (let k = 1; k <= 8; k++) {
      const load: StepLoad = { seqs: 4, tokens: 4, kvTokens: 4 * (512 + k), attnPairs: 4 * (512 + k) }
      expect(steps[k].load).toEqual(load)
      sum += stepCard(H100.spec, 2, load).us
    }
    for (const r of done) expect(r.tpotUs).toBe(sum / 8)
    // kv = 0: a memory-bound decode card no longer depends on K, so TPOT is that card exactly
    const flat: CalibratedRow = { ...H100, spec: { ...H100.spec, model: { ...H100.spec.model, kvBytesPerToken: 0 } } }
    // kv = 0 makes the default pool infinite, which the engine refuses; any pool that holds the four runs the same
    expect(() => new EngineV2({ physics: { id: 'x', row: flat, tp: 2 }, maxNumSeqs: 4, batchTokens: 8192, blockSize: 16, explore: true }, makeRefManager(1, 16), fixedClient(reqs))).toThrow(/whole number of blocks/)
    const run = handEngine(flat, 2, reqs, { numBlocks: 1000 })
    run.e.run()
    const card = stepCard(flat.spec, 2, { seqs: 4, tokens: 4, kvTokens: 4 * 513, attnPairs: 4 * 513 })
    expect(card.bound).toBe('mem')
    for (const r of run.done) expect(r.tpotUs).toBe(card.us)
  })

  test('a mixed step equals its card: a decode beside a new prefill, and the newcomer\'s TTFT is that step', () => {
    const { e, steps, done } = handEngine(H100, 2, [req(0, 100, 50), req(1, 300, 5, 1)])
    e.step()
    const t1 = e.clockUs
    e.step()
    const mixed: StepLoad = { seqs: 2, tokens: 301, kvTokens: 101 + 300, attnPairs: 101 + prefillPairs(300, 0) }
    expect(steps[1]).toEqual({ load: mixed, tp: 2, decoded: [0], prefillDone: [1], admitted: [1] })
    const card = stepCard(H100.spec, 2, mixed)
    expect(e.lastCard).toEqual(card)
    expect(e.clockUs).toBe(t1 + card.us)
    e.run()
    const r1 = done.find((r) => r.id === 1) as FinishedV2
    expect(r1.admitUs).toBe(t1)
    expect(r1.ttftAdmitUs).toBe(card.us)
    expect(r1.ttftUs).toBe(t1 + card.us - 1)
    expect(r1.queueUs).toBe(t1 - 1)
  })

  test('a budget overflow chunks the second prompt: 6,000 + 2,192 fill 8,192, then 2,808 more beside a decode', () => {
    const { e, steps } = handEngine(H100, 2, [req(0, 6000, 4), req(1, 5000, 4)])
    e.step()
    e.step()
    expect(steps[0]).toEqual({
      load: { seqs: 2, tokens: 8192, kvTokens: 8192, attnPairs: prefillPairs(6000, 0) + prefillPairs(2192, 0) },
      tp: 2,
      decoded: [],
      prefillDone: [0],
      admitted: [0, 1],
    })
    expect(prefillPairs(6000, 0) + prefillPairs(2192, 0)).toBe(18_003_000 + 2_403_528)
    expect(steps[1]).toEqual({
      load: { seqs: 2, tokens: 2809, kvTokens: 6001 + 5000, attnPairs: 6001 + 6_155_136 + 3_943_836 },
      tp: 2,
      decoded: [0],
      prefillDone: [1],
      admitted: [],
    })
    expect(prefillPairs(2808, 2192)).toBe(6_155_136 + 3_943_836)
  })

  test('§3.7\'s prefill step: a 7,373-token prompt beside three decodes at context 7,834 on B200 TP 1 has TTFT 566,681 µs', () => {
    // three 2,000-token prompts prefill in step 1 and sit at context 2,000 + k in step k + 1; the fourth arrives when
    // step 5,834 ends, so step 5,835 decodes them at 7,834 beside its whole prompt
    const base = [req(0, 2000, 6000), req(1, 2000, 6000), req(2, 2000, 6000)]
    const probe = handEngine(B200, 1, base)
    for (let k = 0; k < 5834; k++) probe.e.step()
    const arrival = probe.e.clockUs
    const { e, steps, done } = handEngine(B200, 1, [...base, req(3, 7373, 2, arrival)])
    e.run()
    const step = steps[5834]
    expect(step.admitted).toEqual([3])
    expect(step.load).toEqual({ seqs: 4, tokens: 7376, kvTokens: 30_875, attnPairs: 27_207_753 })
    expect(done.find((r) => r.id === 3)?.ttftAdmitUs).toBe(566_681)
  })
})

/* ------------------------------ the closed loop ------------------------------ */

describe('the closed loop (§5.3, S5-D9)', () => {
  test('closedLoop and openLoop return a ClientDriver; closedLoop queues n requests at t = 0, ids 0 … n − 1, lengths on [⌊0.8·L⌋, L]', () => {
    const c = closedLoop({ conc: 4, n: 40, isl: 1024, osl: 8192, ratio: 0.8, seed: 9 })
    expect(c.nextArrivalUs()).toBe(0)
    expect(c.shape).toEqual({ isl: 1024, osl: 8192, ratio: 0.8 })
    const all = c.due(0)
    expect(all.map((r) => r.id)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    for (const r of all) {
      expect(r.arrivalUs).toBe(0)
      expect(r.prompt).toBeGreaterThanOrEqual(819)
      expect(r.prompt).toBeLessThanOrEqual(1024)
      expect(r.output).toBeGreaterThanOrEqual(6553)
      expect(r.output).toBeLessThanOrEqual(8192)
    }
    expect(c.nextArrivalUs()).toBeNull()
    expect(c.due(1e12)).toEqual([])
    // the draw order is prompt then output, from one splitmix32 stream: the same seed, the same requests
    expect(closedLoop({ conc: 4, n: 40, isl: 1024, osl: 8192, ratio: 0.8, seed: 9 }).due(0)).toEqual(all)
    expect(closedLoop({ conc: 4, n: 40, isl: 1024, osl: 8192, ratio: 0.8, seed: 10 }).due(0)).not.toEqual(all)
    const o = openLoop({ ratePerS: 4, n: 50, seed: 3 })
    expect(typeof o.nextArrivalUs).toBe('function')
    expect(typeof o.due).toBe('function')
  })

  test('the bounds of the length draw are reached: every integer of a narrow range shows up', () => {
    const seen = new Set(closedLoop({ conc: 1, n: 400, isl: 10, osl: 10, ratio: 0.8, seed: 1 }).due(0).map((r) => r.prompt))
    expect([...seen].sort((a, b) => a - b)).toEqual([8, 9, 10])
  })

  test('openLoop: arrivals on the 50 ms grid, in (arrivalUs, id) order, at about the asked rate', () => {
    const o = openLoop({ ratePerS: 4, n: 400, seed: 3 })
    const first = o.nextArrivalUs() as number
    const early = o.due(first)
    expect(early.length).toBeGreaterThan(0)
    const rest = o.due(1e12)
    const all = [...early, ...rest]
    expect(all.map((r) => r.id)).toEqual(Array.from({ length: 400 }, (_, i) => i))
    for (let i = 0; i < all.length; i++) {
      expect(all[i].arrivalUs % 50_000).toBe(0)
      if (i > 0) expect(all[i].arrivalUs).toBeGreaterThanOrEqual(all[i - 1].arrivalUs)
    }
    // 400 arrivals at 4/s span about 100 s
    const last = all[all.length - 1].arrivalUs
    expect(last).toBeLessThan(100_000_000)
    expect(last).toBeGreaterThan(95_000_000)
    expect(openLoop({ ratePerS: 4, n: 400, seed: 3 }).due(1e12)).toEqual(all)
  })

  test('admission is FCFS up to maxNumSeqs; TTFT is stamped from admission', () => {
    const steps: StepRecord[] = []
    const done: FinishedV2[] = []
    const e = boxEngine(H100, 2, 4, SHAPES[0], hash32('ix:test'), { onStep: (s) => steps.push(s) })
    e.onFinish = (r) => done.push(r)
    e.run()
    expect(steps.flatMap((s) => s.admitted)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    expect(steps[0].admitted).toEqual([0, 1, 2, 3])
    for (const s of steps) expect(s.load.seqs).toBeLessThanOrEqual(4)
    expect(done).toHaveLength(40)
    const admitted = done.filter((r) => r.admitUs > 0)
    expect(admitted.length).toBe(36)
    for (const r of done) {
      expect(r.arrivalUs).toBe(0)
      expect(r.queueUs).toBe(r.admitUs)
      expect(r.ttftAdmitUs).toBe(r.firstUs - r.admitUs)
      expect(r.ttftUs).toBe(r.firstUs)
    }
    // admissions follow ids: a later id is never admitted before an earlier one
    const byId = [...done].sort((a, b) => a.id - b.id)
    for (let i = 1; i < byId.length; i++) expect(byId[i].admitUs).toBeGreaterThanOrEqual(byId[i - 1].admitUs)
    // a slot frees when a request completes, and the next request is admitted at that step's end
    const lasts = new Set(done.map((r) => r.lastUs))
    for (const r of admitted) expect(lasts.has(r.admitUs)).toBe(true)
    const stats = e.stats()
    expect(stats.medianTtftUs).toBe(medianOf(done.map((r) => r.ttftAdmitUs)))
    expect(stats.medianTtftUs).toBeLessThan(medianOf(done.map((r) => r.ttftUs)))
  })
})

/* ------------------------------ stats ------------------------------ */

describe('stats()', () => {
  test('the protocol\'s median rule: the middle value for odd n, the mean of the two middle values for even n', () => {
    expect(medianOf([])).toBe(0)
    expect(medianOf([5])).toBe(5)
    expect(medianOf([3, 1, 2])).toBe(2)
    expect(medianOf([4, 1, 3, 2])).toBe(2.5)
    expect(medianOf([10, 1])).toBe(5.5)
    expect(protocol.stats.median).toContain('mean of sorted[n/2 - 1] and sorted[n/2] for even n')
  })

  test('mean TPOT, median TTFT, tok/s/user and output tok/s/GPU follow from the finished requests', () => {
    const done: FinishedV2[] = []
    const e = boxEngine(B200, 2, 16, SHAPES[2], 77)
    e.onFinish = (r) => done.push(r)
    e.run()
    const s = e.stats()
    expect(done).toHaveLength(160)
    let sum = 0
    for (const r of done) sum += r.tpotUs
    expect(s.completed).toBe(160)
    expect(s.meanTpotUs).toBe(sum / 160)
    const sorted = done.map((r) => r.ttftAdmitUs).sort((a, b) => a - b)
    expect(s.medianTtftUs).toBe((sorted[79] + sorted[80]) / 2)
    expect(s.tokPerSUser).toBe(1e6 / s.meanTpotUs)
    expect(s.clockUs).toBe(e.clockUs)
    expect(s.outputTokPerSGpu).toBe((s.outputTokens * 1e6) / (e.clockUs * 2))
    expect(s.iterations).toBe(e.iterations)
    expect(s.preemptions).toBe(0)
  })

  test('time is integer µs, and two runs are byte-identical', () => {
    const run = (): string => {
      const done: FinishedV2[] = []
      const cards: number[] = []
      const e = boxEngine(H100, 4, 16, SHAPES[2], hash32('ix:twice'))
      e.onFinish = (r) => done.push(r)
      while (!e.done()) {
        e.step()
        cards.push(e.lastCard?.us as number)
        expect(Number.isInteger(e.clockUs)).toBe(true)
      }
      for (const r of done) {
        for (const t of [r.arrivalUs, r.admitUs, r.firstUs, r.lastUs, r.ttftUs, r.ttftAdmitUs, r.queueUs]) expect(Number.isInteger(t)).toBe(true)
      }
      return JSON.stringify({ stats: e.stats(), done, cards })
    }
    expect(run()).toBe(run())
  })
})

/* ------------------------------ the golden fixture (§6.4) ------------------------------ */

interface GoldenConfig { row: string; tp: number; c: number; isl: number; osl: number; seed: number }

/** Per FP8 row: its smallest TP at c 4, 1k/1k; its largest TP at c 64, 1k/1k; its smallest TP at c 4, 8k/1k. */
const GOLDEN_CONFIGS: GoldenConfig[] = [H100, B200].flatMap((row) => {
  const lo = Math.min(...row.box.tp)
  const hi = Math.max(...row.box.tp)
  return [
    { tp: lo, c: 4, isl: 1024, osl: 1024 },
    { tp: hi, c: 64, isl: 1024, osl: 1024 },
    { tp: lo, c: 4, isl: 8192, osl: 1024 },
  ].map((g) => ({ row: row.key, ...g, seed: hash32(`ev2-golden:${row.key}:${g.tp}:${g.c}:${g.isl}/${g.osl}`) }))
})
const ROWS: Record<string, CalibratedRow> = { [H100.key]: H100, [B200.key]: B200 }

function goldenStats(extra: (g: GoldenConfig) => Partial<EngineV2Config> = () => ({})): EngineV2Stats[] {
  return GOLDEN_CONFIGS.map((g) => boxEngine(ROWS[g.row], g.tp, g.c, g, g.seed, extra(g)).run().stats())
}
const sha256 = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex')

interface GoldenFixture { header: string; rev: string; sha256: string; configs: GoldenConfig[]; stats: EngineV2Stats[] }

describe('the golden fixture pins ENGINE_V2_REV (§6.4)', () => {
  const stats = goldenStats()
  const hash = sha256(stats)
  if (process.env.EV2_GOLDEN_WRITE === '1') {
    const fixture: GoldenFixture = {
      header:
        'Golden EngineV2 fixture (docs/specs/s5.md §6.4, S5-05): the sha256 of JSON.stringify of stats() on six configurations, run with fixture parameters (the §3.6 and §3.7 [proto] sets from step-vectors.json), not the fitted table. A changed hash means scheduling or stamping changed: bump ENGINE_V2_REV, which changes PHYS_ID, and only then rewrite this file with EV2_GOLDEN_WRITE=1 bun test tests/physics/engine-v2.test.ts.',
      rev: ENGINE_V2_REV,
      sha256: hash,
      configs: GOLDEN_CONFIGS,
      stats,
    }
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
  }
  const fixture = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFixture

  test('the six configurations are the ones §6.4 names', () => {
    expect(GOLDEN_CONFIGS.map((g) => `${g.row} tp${g.tp} c${g.c} ${g.isl}/${g.osl}`)).toEqual([
      'h100-vllm-0-10-2-fp8 tp2 c4 1024/1024',
      'h100-vllm-0-10-2-fp8 tp8 c64 1024/1024',
      'h100-vllm-0-10-2-fp8 tp2 c4 8192/1024',
      'b200-vllm-0-10-2-fp8 tp1 c4 1024/1024',
      'b200-vllm-0-10-2-fp8 tp8 c64 1024/1024',
      'b200-vllm-0-10-2-fp8 tp1 c4 8192/1024',
    ])
    expect(fixture.configs).toEqual(GOLDEN_CONFIGS)
  })

  test('the fixture was written at this rev; a new rev needs a rewritten fixture', () => {
    expect(fixture.rev).toBe(ENGINE_V2_REV)
  })

  test('stats() on the six configurations hash to the pinned sha256 (else bump ENGINE_V2_REV)', () => {
    expect(stats).toEqual(fixture.stats)
    expect(hash).toBe(fixture.sha256)
  })

  test('the fixture exercises the envelope: the 8k prefills leave the fixture envelope, so the count is pinned too', () => {
    expect(stats[2].outOfEnvelope).toBeGreaterThan(0)
    expect(stats[0].outOfEnvelope).toBe(0)
  })

  test('the hook and the card override, unset or set to the card itself, leave stats() and the golden hash unchanged (S5-D53)', () => {
    expect(sha256(goldenStats(() => ({ onStep: () => {} })))).toBe(fixture.sha256)
    expect(sha256(goldenStats((g) => ({ explore: true, card: (load: StepLoad, tp: number) => stepCard(ROWS[g.row].spec, tp, load) })))).toBe(fixture.sha256)
  })

  test('the hash moves with the timing: one µs more per step is a different fixture', () => {
    const slower = goldenStats((g) => ({
      explore: true,
      card: (load: StepLoad, tp: number) => {
        const c = stepCard(ROWS[g.row].spec, tp, load)
        return { ...c, us: c.us + 1 }
      },
    }))
    expect(sha256(slower)).not.toBe(fixture.sha256)
  })
})

/* ------------------------------ the hook and the override (S5-D53) ------------------------------ */

describe('the step hook and the card override (S5-D53)', () => {
  test('a recording run gives the same step sequence as a plain run', () => {
    const plain = boxEngine(H100, 2, 16, SHAPES[2], 5)
    const plainSteps: { us: number; clock: number }[] = []
    while (!plain.done()) {
      plain.step()
      plainSteps.push({ us: (plain.lastCard as StepCard).us, clock: plain.clockUs })
    }
    const records: StepRecord[] = []
    const rec = boxEngine(H100, 2, 16, SHAPES[2], 5, { onStep: (s) => records.push(s) })
    const recSteps: { us: number; clock: number }[] = []
    while (!rec.done()) {
      rec.step()
      recSteps.push({ us: (rec.lastCard as StepCard).us, clock: rec.clockUs })
    }
    expect(recSteps).toEqual(plainSteps)
    expect(records).toHaveLength(plainSteps.length)
    records.forEach((r, i) => expect(stepCard(H100.spec, 2, r.load).us).toBe(plainSteps[i].us))
    expect(rec.stats()).toEqual(plain.stats())
  })

  test('the hook fires before the clock advances, and the ids it reports are the step\'s', () => {
    const clocks: number[] = []
    let e: EngineV2 | null = null
    e = boxEngine(B200, 1, 4, SHAPES[0], 11, { onStep: () => clocks.push((e as EngineV2).clockUs) })
    const before: number[] = []
    while (!e.done()) {
      before.push(e.clockUs)
      e.step()
    }
    expect(clocks).toEqual(before)
  })

  test('decoded, prefillDone and admitted account for every token: each request decodes output − 1 times', () => {
    const records: StepRecord[] = []
    const done: FinishedV2[] = []
    const e = boxEngine(B200, 2, 16, SHAPES[0], 21, { onStep: (s) => records.push(s) })
    const outputs = new Map<number, number>()
    e.onFinish = (r) => done.push(r)
    e.run()
    for (const r of closedLoop({ conc: 16, n: 160, isl: 1024, osl: 1024, ratio: 0.8, seed: 21 }).due(0)) outputs.set(r.id, r.output)
    const decodes = new Map<number, number>()
    const firsts = new Map<number, number>()
    for (const s of records) {
      for (const id of s.decoded) decodes.set(id, (decodes.get(id) ?? 0) + 1)
      for (const id of s.prefillDone) firsts.set(id, (firsts.get(id) ?? 0) + 1)
      expect(s.decoded.length).toBeLessThanOrEqual(s.load.seqs)
    }
    for (const [id, out] of outputs) {
      expect(decodes.get(id)).toBe(out - 1)
      expect(firsts.get(id)).toBe(1)
    }
    expect(done).toHaveLength(160)
  })

  test('the card override replaces stepCard, and needs explore', () => {
    const flat = (): StepCard => ({ memBytes: 0, flops: 0, linkBytes: 0, memS: 0, flopS: 0, fixedS: 0, linkS: 0, stepS: 0.001, bound: 'mem', us: 1000 })
    expect(() => boxEngine(H100, 2, 4, SHAPES[0], 1, { card: flat })).toThrow(/explore/)
    const e = boxEngine(H100, 2, 4, SHAPES[0], 1, { card: flat, explore: true })
    e.run()
    expect(e.clockUs).toBe(1000 * e.iterations)
    expect(e.extrapolated).toEqual(['the step card is overridden'])
    expect(() => boxEngine(H100, 2, 4, SHAPES[0], 1, { card: () => ({ ...flat(), us: 0.5 }), explore: true }).run()).toThrow(/whole/)
  })
})

/* ------------------------------ refusals, envelope, preemption ------------------------------ */

describe('NotCalibrated, OutOfBox and explore', () => {
  test('a failed row, or a metric the row is not eligible for, throws NotCalibrated without explore', () => {
    const failed: CalibratedRow = { ...H100, status: 'failed' }
    expect(() => boxEngine(failed, 2, 4, SHAPES[0], 1)).toThrow(NotCalibrated)
    const noTtft: CalibratedRow = { ...H100, eligible: { tpot: true, ttft: false } }
    expect(() => boxEngine(noTtft, 2, 4, SHAPES[0], 1)).not.toThrow()
    try {
      boxEngine(noTtft, 2, 4, SHAPES[0], 1, { metric: 'ttft' })
      throw new Error('no throw')
    } catch (err) {
      expect(err).toBeInstanceOf(NotCalibrated)
      expect((err as NotCalibrated).row).toBe(H100.key)
      expect((err as NotCalibrated).metric).toBe('ttft')
    }
    const e = boxEngine(failed, 2, 4, SHAPES[0], 1, { explore: true })
    expect(e.extrapolated).toEqual([`row ${H100.key} failed its gate`])
  })

  test('an out-of-box configuration throws OutOfBox without explore, and runs labelled with it', () => {
    const cases: [string, () => EngineV2, RegExp][] = [
      ['TP', () => boxEngine(H100, 1, 4, SHAPES[0], 1), /TP 1/],
      ['concurrency', () => boxEngine(H100, 8, 65, SHAPES[0], 1), /maxNumSeqs 65/],
      ['shape', () => boxEngine(H100, 8, 4, { isl: 2048, osl: 1024 }, 1), /shape 2048\/1024/],
      ['KV', () => boxEngine(H100, 2, 64, SHAPES[2], 1), /KV/],
      ['budget', () => boxEngine(H100, 2, 4, SHAPES[0], 1, { batchTokens: 4096 }), /token budget/],
      ['a client with no shape', () => new EngineV2({ physics: { id: 'x', row: H100, tp: 2 }, maxNumSeqs: 4, batchTokens: 8192, blockSize: 16 }, makeRefManager(defaultNumBlocks(H100, 2), 16), fixedClient([req(0, 10, 2)])), /shape/],
      ['a manager of another size', () => new EngineV2({ physics: { id: 'x', row: H100, tp: 2 }, maxNumSeqs: 4, batchTokens: 8192, blockSize: 16 }, makeRefManager(100, 16), closedLoop({ conc: 4, n: 40, isl: 1024, osl: 1024, ratio: 0.8, seed: 1 })), /block manager/],
    ]
    for (const [, make, reason] of cases) {
      let caught: unknown = null
      try {
        make()
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(OutOfBox)
      expect((caught as OutOfBox).reason).toMatch(reason)
      expect((caught as OutOfBox).row).toBe(H100.key)
    }
    const e = boxEngine(H100, 1, 4, SHAPES[0], 1, { explore: true })
    expect(e.extrapolated).toHaveLength(1)
    expect(e.extrapolated[0]).toMatch(/TP 1/)
    expect(boxEngine(H100, 2, 4, SHAPES[0], 1).extrapolated).toEqual([])
  })
})

describe('the envelope count', () => {
  test('outOfEnvelope counts exactly the steps that exceed the row\'s envelope', () => {
    const records: StepRecord[] = []
    const e = boxEngine(H100, 2, 16, SHAPES[2], 3, { onStep: (s) => records.push(s) })
    e.run()
    const counted = records.filter((s) => exceeds(H100.envelope, s.load, s.tp, s.decoded.length)).length
    expect(counted).toBeGreaterThan(0)
    expect(e.outOfEnvelope).toBe(counted)
    expect(e.stats().outOfEnvelope).toBe(counted)
    const wide: CalibratedRow = { ...H100, envelope: { tokens: 8192, decodeSeqs: 64, kvTokensPerGpu: 1e12, attnPairsPerGpu: 1e15 } }
    expect(boxEngine(wide, 2, 16, SHAPES[2], 3).run().outOfEnvelope).toBe(0)
  })
})

describe('preemption', () => {
  test('no in-box run preempts: every box shape at every box TP at c = 64 where the KV room allows it, on both rows', () => {
    let runs = 0
    for (const row of [H100, B200]) {
      for (const tp of row.box.tp) {
        for (const shape of SHAPES) {
          let e: EngineV2
          try {
            e = boxEngine(row, tp, 64, shape, hash32(`ix-box:${row.key}:${tp}:${shape.isl}/${shape.osl}`))
          } catch (err) {
            expect(err).toBeInstanceOf(OutOfBox)
            expect((err as OutOfBox).reason).toMatch(/^KV/)
            continue
          }
          expect(e.run().stats().preemptions).toBe(0)
          expect(e.stats().completed).toBe(640)
          runs += 1
        }
      }
    }
    // H100 TP 2 and B200 TP 1 cannot hold 64 × 9,216 tokens of 8k/1k or 1k/8k; every other pair runs
    expect(runs).toBe(3 * 3 + 4 * 3 - 4)
  })

  test('a pool too small preempts the newest by recompute, keeps its outputs, and every request still completes', () => {
    const reqs = [0, 1, 2, 3].map((id) => req(id, 64, 200))
    const { e, done, steps } = handEngine(H100, 2, reqs, { numBlocks: 40 })
    e.run()
    const s = e.stats()
    expect(s.preemptions).toBeGreaterThan(0)
    expect(s.completed).toBe(4)
    expect(s.outputTokens).toBe(800)
    expect(done.map((r) => r.id).sort()).toEqual([0, 1, 2, 3])
    // a recompute prefills prompt + outputs so far, so some step prefills more than a 64-token prompt
    expect(steps.some((st) => st.load.tokens > 4 * 64)).toBe(true)
    for (const r of done) expect(r.firstUs).toBeLessThanOrEqual(r.lastUs)
  })

  test('a request the pool can never hold is an error, not a hang', () => {
    const { e } = handEngine(H100, 2, [req(0, 1000, 2)], { numBlocks: 10 })
    expect(() => e.run()).toThrow(/cannot hold/)
  })
})

/* ------------------------------ the v1 boundary (S5-D8, I1) ------------------------------ */

describe('the v1 boundary', () => {
  test('engine-v2.ts imports only types from fleet-model.ts', () => {
    const src = readFileSync(ENGINE_PATH, 'utf8')
    const lines = src.split('\n').filter((l) => /from '(\.\.\/)+fleet-model'/.test(l))
    expect(lines).toEqual(["import type { ManagerDriver } from '../../fleet-model'"])
  })

  test('fleet-model.ts is the file the v1 golden fixture pins', () => {
    // read directly: importing scripts/v1-golden here would load every v1 surface into this file's module graph
    const fixture = JSON.parse(readFileSync(V1_GOLDEN_PATH, 'utf8')) as { fleetModel: { path: string; sha256: string } }
    expect(fixture.fleetModel.path).toBe('src/lib/fleet-model.ts')
    expect(createHash('sha256').update(readFileSync(FLEET_MODEL_PATH)).digest('hex')).toBe(fixture.fleetModel.sha256)
  })
})

/* ------------------------------ cost (§8.2, §9.5) ------------------------------ */

describe('cost per sequence-step', () => {
  test('is printed at c = 64 (H100 TP 8, 1k/1k and 1k/8k)', () => {
    for (const shape of [SHAPES[0], SHAPES[1]]) {
      let seqSteps = 0
      const e = boxEngine(H100, 8, 64, shape, 1, { onStep: (s) => (seqSteps += s.load.seqs) })
      const t0 = performance.now()
      e.run()
      const ms = performance.now() - t0
      console.log(
        `EngineV2 cost at c = 64, ${shape.isl}/${shape.osl}: ${seqSteps} sequence-steps in ${e.iterations} steps, ${ms.toFixed(0)} ms, ${((ms * 1e6) / seqSteps).toFixed(0)} ns per sequence-step`,
      )
      expect(seqSteps).toBeGreaterThan(0)
    }
  })
})
