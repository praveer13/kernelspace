/**
 * The replay (docs/specs/s5.md §5.3 steps 1-3, §5.6; S5-06, S5-D52, S5-D53).
 *
 *  - On the snapshot, the protocol's selection and filters (W and kv from the model byte claims, HBM from the capacity
 *    claims) drop exactly `filters.expectDropped`, for the stated reasons, and keep 42/58/60 with F/H 25/17, 34/24, 36/24.
 *  - A replay records through EngineV2's `onStep` hook and `card` override: its schedule is the engine's, its weights
 *    sum to one, every request decodes in exactly osl_r − 1 consecutive steps, and two replays are identical.
 *  - Consistency (§5.6): on each row's three configurations, a real EngineV2 run with a clock (in box, no explore)
 *    equals the weighted-sum prediction within 0.5 µs on mean TPOT and 0.5 µs per step of the median windows on median
 *    TTFT. The parameters here are fixture parameters (§3.6's and §3.7's [proto] sets from the golden step vectors); the
 *    script runs the same check with the fit on F.
 */
import { describe, expect, test } from 'bun:test'
import { makeRefManager } from '../../src/lib/fleet-model'
import { stepCard } from '../../src/lib/world/physics/card'
import { closedLoop } from '../../src/lib/world/physics/client'
import { EngineV2 } from '../../src/lib/world/physics/engine-v2'
import {
  medianWindowSteps,
  predictMedianTtft,
  predictTpot,
  replayNumBlocks,
  replayPoint,
  replayRow,
  stepSeconds,
  ttftWindows,
  type StepLog,
} from '../../src/lib/world/physics/replay'
import type { CardParams, CardSpec } from '../../src/lib/world/physics/types'
import {
  claimSI,
  consistencyOf,
  consistencyPoints,
  droppedIds,
  loadExtract,
  replayPointOf,
  replaySettings,
  rowShapes,
  seedOf,
  selectPoints,
} from '../../scripts/fit-physics'
import { kvTokenLimit } from '../../scripts/fetch-physics-points'
import { readProtocol } from '../../scripts/physics-protocol'
import vectors from '../fixtures/physics/step-vectors.json'

const protocol = readProtocol()
const { rows: extract } = loadExtract()
const sel = selectPoints(protocol, extract)
const settings = replaySettings(protocol)
const seed = seedOf(protocol)
const byKey = (key: string) => {
  const s = sel.find((x) => x.prow.key === key)
  if (!s) throw new Error(`no row ${key}`)
  return s
}
const H100 = 'h100-vllm-0-10-2-fp8'
const B200 = 'b200-vllm-0-10-2-fp8'
const NVFP4 = 'b200-vllm-0-10-2-nvfp4'

describe('selection, filters and split on the snapshot (§4.1, S5-D52)', () => {
  test('the dropped ids are exactly the protocol\'s expectDropped', () => {
    expect(droppedIds(sel)).toEqual([...protocol.filters.expectDropped].sort())
  })

  test('kept 42 / 58 / 60 of 45 / 60 / 60 selected, and F / H 25 / 17, 34 / 24, 36 / 24', () => {
    const counts = sel.map((s) => [s.prow.key, s.selected.length, s.kept.length, s.fit.length, s.heldOut.length])
    expect(counts).toEqual([
      [H100, 45, 42, 25, 17],
      [B200, 60, 58, 34, 24],
      [NVFP4, 60, 60, 36, 24],
    ])
  })

  test('each drop has the protocol\'s reason: KV for the c = 64 points with an 8k side at the smallest TP, TTFT ≥ 3 s for 44119', () => {
    const reasons = Object.fromEntries(sel.flatMap((s) => s.dropped.map((d) => [d.row.id, d.reasons.map((r) => r.split(':')[0])])))
    expect(reasons).toEqual({
      '41507': ['KV', 'TTFT'],
      '42070': ['KV', 'TTFT'],
      '44119': ['TTFT'],
      '42140': ['KV'],
      '40752': ['KV', 'TTFT'],
    })
  })

  test('the KV room from the claims is the protocol\'s worked figures: 448,303 (H100 TP 2), 558,166 (B200 TP 1), 746,555 (NVFP4 TP 1)', () => {
    expect(kvTokenLimit(protocol, byKey(H100).prow, 2, claimSI)).toBe(448_303)
    expect(kvTokenLimit(protocol, byKey(B200).prow, 1, claimSI)).toBe(558_166)
    expect(kvTokenLimit(protocol, byKey(NVFP4).prow, 1, claimSI)).toBe(746_555)
  })

  test('W and kv come from the model byte claims; the split is by the protocol\'s concurrencies', () => {
    for (const s of sel) {
      const { model } = rowShapes(protocol, s.prow)
      expect(model.kvBytesPerToken).toBe(163_840)
      expect(model.weightBytes).toBe(s.prow.precision === 'fp4' ? 39_684_375_000 : 70_550_000_000)
      expect(s.fit.every((r) => protocol.split.fitConc.includes(r.conc))).toBe(true)
      expect(s.heldOut.every((r) => protocol.split.heldOutConc.includes(r.conc))).toBe(true)
    }
  })
})

/* ------------------------------ the replay ------------------------------ */

const SPECS = vectors.specs as Record<string, CardSpec>
const paramsOf = (key: string): CardParams => (key === H100 ? SPECS['h100-fp8-example-a'] : SPECS['b200-fp8-example-b']).params
const specOf = (key: string): CardSpec => ({ ...rowShapes(protocol, byKey(key).prow), params: paramsOf(key) })

const pointOf = (key: string, id: string) => {
  const r = byKey(key).kept.find((p) => p.id === id)
  if (!r) throw new Error(`no kept point ${id}`)
  return replayPointOf(r, seed)
}

describe('a replay records the engine\'s schedule (S5-D53)', () => {
  const spec = specOf(B200)
  const p = pointOf(B200, '40518')
  const log = replayPoint(spec, p, settings)

  test('the seed is the protocol\'s hash32(\'ix:\' + id), and the pool is ⌊(0.9 · HBM · TP − W) ÷ (kv · 16)⌋', () => {
    expect(p.seed).toBe(seedOf(protocol)('40518'))
    expect(replayNumBlocks(spec, 1, settings)).toBe(Math.floor((0.9 * 180e9 - 70.55e9) / (163_840 * 16)))
  })

  test('one recorded step per engine iteration: a plain run with a clock takes the same steps', () => {
    const numBlocks = replayNumBlocks(spec, p.tp, settings)
    const loads: string[] = []
    const e = new EngineV2(
      { physics: { id: 't', row: replayRow(spec, p, settings), tp: p.tp }, maxNumSeqs: p.conc, batchTokens: settings.batchTokens, blockSize: 16, numBlocks, onStep: (s) => loads.push(JSON.stringify(s.load)) },
      makeRefManager(numBlocks, 16),
      closedLoop({ conc: p.conc, n: settings.promptsPerConc * p.conc, isl: p.isl, osl: p.osl, ratio: settings.rangeRatio, seed: p.seed }),
    )
    e.run()
    expect(e.iterations).toBe(log.steps)
    expect(loads).toEqual(Array.from({ length: log.steps }, (_, s) => JSON.stringify({ seqs: log.seqs[s], tokens: log.tokens[s], kvTokens: log.kvTokens[s], attnPairs: log.attnPairs[s] })))
  })

  test('the TPOT weights sum to one, and each request decodes in exactly osl_r − 1 consecutive steps after its first token', () => {
    let sum = 0
    for (const w of log.weights) sum += w
    expect(Math.abs(sum - 1)).toBeLessThan(1e-12)
    expect(log.requests).toBe(protocol.replay.promptsPerConc * p.conc)
    for (let r = 0; r < log.requests; r++) {
      expect(log.lastStep[r] - log.firstStep[r]).toBe(log.output[r] - 1)
      expect(log.firstStep[r]).toBeGreaterThanOrEqual(log.admitStep[r])
    }
    // the weight of a step is Σ 1 / ((osl_r − 1) · R) over the requests decoding in it
    const w = new Float64Array(log.steps)
    for (let r = 0; r < log.requests; r++) for (let s = log.firstStep[r] + 1; s <= log.lastStep[r]; s++) w[s] += 1 / ((log.output[r] - 1) * log.requests)
    for (let s = 0; s < log.steps; s++) expect(Math.abs(w[s] - log.weights[s])).toBeLessThanOrEqual(1e-15)
  })

  test('lengths are drawn on [⌊0.8 · L⌋, L]', () => {
    for (let r = 0; r < log.requests; r++) {
      expect(log.prompt[r]).toBeGreaterThanOrEqual(Math.floor(settings.rangeRatio * p.isl))
      expect(log.prompt[r]).toBeLessThanOrEqual(p.isl)
      expect(log.output[r]).toBeGreaterThanOrEqual(Math.floor(settings.rangeRatio * p.osl))
      expect(log.output[r]).toBeLessThanOrEqual(p.osl)
    }
  })

  test('two replays of a point are identical', () => {
    const again = replayPoint(spec, p, settings)
    const flat = (l: StepLog) => JSON.stringify(Object.fromEntries(Object.entries(l).map(([k, v]) => [k, ArrayBuffer.isView(v) ? Array.from(v as Float64Array) : v])))
    expect(flat(again)).toBe(flat(log))
  })

  test('the weighted sums are the card\'s float stepS, step by step', () => {
    const stepS = stepSeconds(log, spec)
    for (const s of [0, 1, log.steps >> 1, log.steps - 1]) {
      expect(stepS[s]).toBe(stepCard(spec, p.tp, { seqs: log.seqs[s], tokens: log.tokens[s], kvTokens: log.kvTokens[s], attnPairs: log.attnPairs[s] }).stepS)
    }
    let sum = 0
    for (let s = 0; s < log.steps; s++) sum += log.weights[s] * stepS[s]
    expect(predictTpot(log, spec)).toBe(sum)
    const win = ttftWindows(log, spec)
    expect(win.length).toBe(log.requests)
    expect(win[0]).toBe(stepS[log.admitStep[0]] + (log.firstStep[0] > log.admitStep[0] ? stepS[log.firstStep[0]] : 0))
  })
})

/* ------------------------------ consistency (§5.6) ------------------------------ */

describe('consistency: EngineV2 with a clock equals the weighted sums (§5.6, S5-D14)', () => {
  for (const key of [H100, B200, NVFP4]) {
    test(`${key}: the three configurations, |Δ mean TPOT| ≤ 0.5 µs and |Δ median TTFT| ≤ 0.5 µs × the median windows' steps`, () => {
      const s = byKey(key)
      const points = consistencyPoints(protocol, s)
      expect(points.length).toBe(protocol.consistency.configsPerRow)
      const tps = [...s.prow.boxTp].sort((a, b) => a - b)
      expect(points.map((r) => [r.decode_tp, r.conc, r.isl, r.osl])).toEqual([
        [tps[0], 4, 1024, 1024],
        [tps[tps.length - 1], 64, 1024, 1024],
        [tps[0], 4, 8192, 1024],
      ])
      const spec = specOf(key)
      for (const r of points) {
        const log = replayPoint(spec, replayPointOf(r, seed), settings)
        const c = consistencyOf(log, spec, settings, seed(r.id), protocol.consistency.tpotMaxAbsUs)
        expect(c.ttftBoundUs).toBe(0.5 * medianWindowSteps(log, spec))
        expect(Math.abs(c.engineTpotUs - c.predTpotUs)).toBeLessThanOrEqual(protocol.consistency.tpotMaxAbsUs)
        expect(Math.abs(c.engineTtftUs - c.predTtftUs)).toBeLessThanOrEqual(c.ttftBoundUs)
        expect(c.tpotOk && c.ttftOk).toBe(true)
        expect(c.predTtftUs).toBe(predictMedianTtft(log, spec) * 1e6)
      }
    }, 60_000)
  }
})
