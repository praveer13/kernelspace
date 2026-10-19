/**
 * The fit (docs/specs/s5.md §5.3 steps 4-7, §5.5; S5-06, S5-D35).
 *
 * Synthetic points: real EngineV2 replays of small closed loops on the B200 FP8 row's chip and model (from the claims),
 * whose "measured" TPOT and TTFT are the weighted-sum predictions (`replay.ts`, through `stepCard`) under known
 * parameters. With η on the grid the fit recovers every parameter to 1e-6 relative; with η_m below the grid, or a
 * negative t_seq, a bound is active and a brute-force search (every η_m on the grid, each with a projected
 * coordinate-descent NNLS on features summed straight from the log) finds the same optimum. The memo is shared and
 * computes each (η_m, η_f) once; LOO equals n refits on fresh memos, by value; two evaluations are byte-identical.
 */
import { describe, expect, test } from 'bun:test'
import { hash32 } from '../../src/lib/rng'
import { stepCard } from '../../src/lib/world/physics/card'
import { medianOf } from '../../src/lib/world/physics/engine-v2'
import {
  cardParams,
  engineTtft,
  errorStats,
  evaluateRow,
  fit,
  fitTpot,
  harnessTerm,
  kernel,
  leaveOneOut,
  makeFitRow,
  nnls,
  predTpot,
  predTtft,
  preparePoint,
  type FitParams,
  type FitRow,
  type GateRules,
} from '../../src/lib/world/physics/fit'
import { loadAt, predictMedianTtft, predictTpot, replayPoint, type StepLog } from '../../src/lib/world/physics/replay'
import type { CardParams, CardSpec } from '../../src/lib/world/physics/types'
import { fitGrid, replaySettings, rowShapes } from '../../scripts/fit-physics'
import { readProtocol } from '../../scripts/physics-protocol'

const protocol = readProtocol()
const grid = fitGrid(protocol)
const RULES = protocol.gates as GateRules
const settings = replaySettings(protocol)
const prow = protocol.rows.find((r) => r.key === 'b200-vllm-0-10-2-fp8')
if (!prow) throw new Error('no B200 FP8 row')
const { chip, model } = rowShapes(protocol, prow)

/** Small closed loops on TP 1, 2 and 4, at 4 and 16 users, on the 1k/1k and 8k/1k shapes (12 points). */
const CONFIGS = [1, 2, 4].flatMap((tp) =>
  [4, 16].flatMap((conc) =>
    [
      [1024, 1024],
      [8192, 1024],
    ].map(([isl, osl]) => ({ id: `syn-${tp}-${conc}-${isl}`, tp, conc, isl, osl, seed: hash32(`fit-test:${tp}/${conc}/${isl}`) })),
  ),
)
const LOGS: StepLog[] = CONFIGS.map((p) => replayPoint({ chip, model, params: { etaMem: 1, etaFlop: 1, layerUs: 0, seqUs: 0, linkGBs: null } }, p, settings))

const specWith = (params: CardParams): CardSpec => ({ chip, model, params })

/** Points whose measurements are the weighted-sum predictions under `truth`, plus a harness term h (seconds). */
function syntheticRow(truth: CardParams, h: number): FitRow {
  const points = LOGS.map((log) => {
    const spec = specWith(truth)
    return preparePoint(log, chip, model, { tpot: predictTpot(log, spec), ttft: predictMedianTtft(log, spec) + h })
  })
  return makeFitRow(chip, model, grid, points)
}

const ALL = LOGS.map((_, i) => i)
const relClose = (got: number, want: number, tol: number) => Math.abs(got / want - 1) <= tol

describe('the grid and procedure come from the protocol', () => {
  test('71 η_m values from 0.30 by 0.01 and 46 η_f values from 0.10 by 0.02, each an integer ÷ 100; start at 0.60; three rounds', () => {
    expect(grid.etaMem.length).toBe(71)
    expect(grid.etaFlop.length).toBe(46)
    expect(grid.etaMem[0]).toBe(30 / 100)
    expect(grid.etaMem[70]).toBe(1)
    expect(grid.etaFlop[0]).toBe(10 / 100)
    expect(grid.etaFlop[45]).toBe(1)
    expect(grid.etaFlop).toContain(grid.etaFlopStart)
    expect(grid.etaFlopStart).toBe(protocol.fit.etaFlopStart)
    expect(grid.ttftRounds).toBe(protocol.fit.ttftRounds)
  })
})

describe('the decomposition equals the weighted sums of the card (§5.3 step 4)', () => {
  const truth: CardParams = { etaMem: 0.81, etaFlop: 0.44, layerUs: 65, seqUs: 30, linkGBs: 250 }
  const row = syntheticRow(truth, 0.04)
  const p: FitParams = {
    iM: grid.etaMem.indexOf(0.81), iF: grid.etaFlop.indexOf(0.44), etaMem: 0.81, etaFlop: 0.44,
    layerUs: 65, seqUs: 30, invLinkGBs: 1 / 250, harnessS: 0.04, tpotSse: 0, ttftSse: 0,
  }

  test('the kernel term is the card\'s Math.max(memS, flopS), bit for bit, step by step', () => {
    const log = LOGS[3]
    const pt = row.points[3]
    const spec = specWith({ ...truth, layerUs: 0, seqUs: 0, linkGBs: null })
    let sum = 0
    for (let s = 0; s < log.steps; s++) {
      const card = stepCard(spec, log.tp, loadAt(log, s))
      expect(pt.memBytes[s]).toBe(card.memBytes)
      expect(pt.flops[s]).toBe(card.flops)
      sum += log.weights[s] * card.stepS
    }
    expect(kernel(row, p.iM, p.iF)[3]).toBe(sum)
  })

  test('TPOT and median TTFT through the memoised kernel equal predictTpot and predictMedianTtft to 1e-12 relative', () => {
    LOGS.forEach((log, i) => {
      const spec = specWith(cardParams(p))
      expect(relClose(predTpot(row, i, p), predictTpot(log, spec), 1e-12)).toBe(true)
      expect(relClose(engineTtft(row, i, p), predictMedianTtft(log, spec), 1e-12)).toBe(true)
      expect(predTtft(row, i, p)).toBe(engineTtft(row, i, p) + 0.04)
    })
  })
})

describe('recovery: points made by known parameters on the grid', () => {
  const truth: CardParams = { etaMem: 0.81, etaFlop: 0.44, layerUs: 65, seqUs: 30, linkGBs: 250 }
  const row = syntheticRow(truth, 0.04)
  const got = fit(row, ALL)

  test('η_m and η_f are the grid values exactly; t_layer, t_seq, β and h to 1e-6 relative', () => {
    expect(got.etaMem).toBe(truth.etaMem)
    expect(got.etaFlop).toBe(truth.etaFlop)
    expect(relClose(got.layerUs, truth.layerUs, 1e-6)).toBe(true)
    expect(relClose(got.seqUs, truth.seqUs, 1e-6)).toBe(true)
    expect(relClose(1 / got.invLinkGBs, 250, 1e-6)).toBe(true)
    expect(relClose(got.harnessS, 0.04, 1e-6)).toBe(true)
    expect(got.tpotSse).toBeLessThan(1e-20)
    expect(got.ttftSse).toBeLessThan(1e-20)
  })

  test('every LOO refit recovers them too, so the refit ranges collapse to the truth', () => {
    for (const q of leaveOneOut(row, ALL)) {
      expect([q.etaMem, q.etaFlop]).toEqual([truth.etaMem, truth.etaFlop])
      expect(relClose(q.layerUs, 65, 1e-6) && relClose(q.seqUs, 30, 1e-6) && relClose(q.harnessS, 0.04, 1e-6)).toBe(true)
    }
  })
})

/* ------------------------------ brute force ------------------------------ */

/** min over x ≥ 0 of Σ((c + F·x)/y − 1)² by projected coordinate descent on the column-scaled normal equations. */
function bruteNnls(F: number[][], c: number[], y: number[]): { x: number[]; sse: number } {
  const k = F[0].length
  const n = y.length
  const scale = Array.from({ length: k }, (_, j) => {
    let s = 0
    for (let i = 0; i < n; i++) s += (F[i][j] / y[i]) * (F[i][j] / y[i])
    return s > 0 ? 1 / Math.sqrt(s) : 0
  })
  const G = Array.from({ length: k }, () => new Array(k).fill(0))
  const b = new Array(k).fill(0)
  for (let i = 0; i < n; i++) {
    const t = 1 - c[i] / y[i]
    for (let p = 0; p < k; p++) {
      const up = (F[i][p] / y[i]) * scale[p]
      b[p] += up * t
      for (let q = 0; q < k; q++) G[p][q] += up * (F[i][q] / y[i]) * scale[q]
    }
  }
  const z = new Array(k).fill(0)
  for (let sweep = 0; sweep < 200_000; sweep++) {
    let moved = 0
    for (let j = 0; j < k; j++) {
      if (G[j][j] === 0) continue
      let g = -b[j]
      for (let q = 0; q < k; q++) g += G[j][q] * z[q]
      const next = Math.max(0, z[j] - g / G[j][j])
      moved = Math.max(moved, Math.abs(next - z[j]))
      z[j] = next
    }
    if (moved < 1e-16) break
  }
  const x = z.map((v, j) => v * scale[j])
  let sse = 0
  for (let i = 0; i < n; i++) {
    let pred = c[i]
    for (let j = 0; j < k; j++) pred += x[j] * F[i][j]
    sse += (pred / y[i] - 1) ** 2
  }
  return { x, sse }
}

/** The TPOT step by brute force at a fixed η_f: every η_m on the grid, the kernel and features summed from the logs. */
function bruteTpot(meas: readonly number[], etaFlop: number): { etaMem: number; x: number[]; sse: number } {
  const feats = LOGS.map((log) => {
    let w = 0
    let ws = 0
    let wl = 0
    for (let s = 0; s < log.steps; s++) {
      w += log.weights[s]
      ws += log.weights[s] * log.seqs[s]
      wl += log.weights[s] * stepCard(specWith({ etaMem: 1, etaFlop: 1, layerUs: 0, seqUs: 0, linkGBs: null }), log.tp, loadAt(log, s)).linkBytes
    }
    return [(w * model.layers) / 1e6, ws / 1e6, wl / 1e9]
  })
  let best = { etaMem: NaN, x: [0, 0, 0], sse: Infinity }
  for (const etaMem of grid.etaMem) {
    const k = LOGS.map((log) => predictTpot(log, specWith({ etaMem, etaFlop, layerUs: 0, seqUs: 0, linkGBs: null })))
    const r = bruteNnls(feats, k, [...meas])
    if (r.sse < best.sse) best = { etaMem, ...r }
  }
  return best
}

const agrees = (got: FitParams, brute: { etaMem: number; x: number[]; sse: number }) => {
  expect(got.etaMem).toBe(brute.etaMem)
  const ours = [got.layerUs, got.seqUs, got.invLinkGBs]
  ours.forEach((v, j) => {
    if (v === 0 || brute.x[j] === 0) expect(Math.abs(v - brute.x[j])).toBeLessThan(1e-9 * (j === 2 ? 1e-2 : 1))
    else expect(relClose(v, brute.x[j], 1e-6)).toBe(true)
  })
  expect(Math.abs(got.tpotSse - brute.sse)).toBeLessThanOrEqual(1e-9 * Math.max(brute.sse, 1e-12))
}

describe('a bound active: the fit returns the bounded optimum, and a brute-force search agrees', () => {
  test('η_m below the grid (0.25): the fit stops at the bound 0.30 and the brute-force TPOT search at its η_f finds the same', () => {
    const row = syntheticRow({ etaMem: 0.25, etaFlop: 0.44, layerUs: 65, seqUs: 30, linkGBs: 250 }, 0.04)
    const got = fit(row, ALL)
    expect(got.iM).toBe(0)
    expect(got.etaMem).toBe(grid.etaMem[0])
    agrees(got, bruteTpot(row.points.map((p) => p.measTpot), got.etaFlop))
    // and it is the TPOT step's own optimum at that η_f
    expect(fitTpot(row, ALL, got.iF)).toEqual({ ...got, harnessS: 0, ttftSse: 0 })
  }, 60_000)

  test('t_seq negative (−20 µs): non-negative least squares holds it at 0, and the brute-force search agrees', () => {
    const row = syntheticRow({ etaMem: 0.81, etaFlop: 0.44, layerUs: 65, seqUs: -20, linkGBs: 250 }, 0.04)
    const got = fit(row, ALL)
    expect(got.seqUs).toBe(0)
    expect(got.layerUs).toBeGreaterThan(0)
    agrees(got, bruteTpot(row.points.map((p) => p.measTpot), got.etaFlop))
  }, 60_000)
})

describe('NNLS and the harness term', () => {
  test('an exact problem: y = 1 + 2·f1 + 3·f2 is solved to 1e-12', () => {
    const F = [[1, 0], [0, 1], [1, 1], [2, 1]]
    const y = F.map(([a, b]) => 1 + 2 * a + 3 * b)
    const r = nnls(F, y.map(() => 1), y)
    expect(Math.abs(r.x[0] - 2)).toBeLessThan(1e-12)
    expect(Math.abs(r.x[1] - 3)).toBeLessThan(1e-12)
    expect(r.sse).toBeLessThan(1e-24)
  })

  test('a negative unconstrained coefficient is held at 0, and the rest is the restricted least squares', () => {
    // unconstrained, y = 5 + 2a − b is fitted exactly by (5, 2, −1)
    const F = [[1, 1, 0], [1, 0, 1], [1, 1, 1], [1, 2, 1], [1, 1, 3]]
    const y = F.map(([, a, b]) => 5 + 2 * a - b)
    const r = nnls(F, y.map(() => 0), y)
    const brute = bruteNnls(F, y.map(() => 0), y)
    expect(r.x[2]).toBe(0)
    expect(brute.x[2]).toBe(0)
    expect(r.sse).toBeGreaterThan(0)
    for (const j of [0, 1]) expect(relClose(r.x[j], brute.x[j], 1e-9)).toBe(true)
    expect(Math.abs(r.sse - brute.sse)).toBeLessThan(1e-12)
  })

  test('a feature that is zero on every point is left out (the link term on TP 1 alone)', () => {
    const F = [[1, 0], [2, 0], [3, 0]]
    const y = [3, 5, 7]
    const r = nnls(F, [1, 1, 1], y)
    expect(Math.abs(r.x[0] - 2)).toBeLessThan(1e-12)
    expect(r.x[1]).toBe(0)
  })

  test('the harness term is the closed-form weighted least squares, clipped at 0', () => {
    const eng = [0.5, 0.6, 0.7]
    const y = [0.55, 0.66, 0.74]
    const { h, sse } = harnessTerm(eng, y)
    let bestH = 0
    let bestSse = Infinity
    for (let k = 0; k <= 100_000; k++) {
      const hh = k / 1e6
      let s = 0
      for (let i = 0; i < 3; i++) s += ((eng[i] + hh) / y[i] - 1) ** 2
      if (s < bestSse) {
        bestSse = s
        bestH = hh
      }
    }
    expect(Math.abs(h - bestH)).toBeLessThanOrEqual(1e-6)
    expect(sse).toBeLessThanOrEqual(bestSse)
    expect(harnessTerm([1, 1], [0.9, 0.8]).h).toBe(0)
  })
})

describe('the memo, LOO by value, and determinism', () => {
  const truth: CardParams = { etaMem: 0.83, etaFlop: 0.5, layerUs: 60, seqUs: 35, linkGBs: 290 }
  // measured values with a deterministic ±4 % wobble, so refits differ and the memo is exercised across η
  const wobble = (i: number) => 1 + 0.04 * ((hash32(`wobble:${i}`) % 2001) / 1000 - 1)
  const noisyRow = () => {
    const points = LOGS.map((log, i) => {
      const spec = specWith(truth)
      return preparePoint(log, chip, model, { tpot: predictTpot(log, spec) * wobble(i), ttft: (predictMedianTtft(log, spec) + 0.03) * wobble(100 + i) })
    })
    return makeFitRow(chip, model, grid, points)
  }

  test('LOO equals n explicit refits, each on a fresh memo, by value', () => {
    const row = noisyRow()
    const loo = leaveOneOut(row, ALL)
    const explicit = ALL.map((i) => fit(noisyRow(), ALL.filter((j) => j !== i)))
    expect(loo).toEqual(explicit)
  }, 60_000)

  test('each (η_m, η_f) kernel and window set is computed once and shared by the fit, LOO, LOTPO and LOSO', () => {
    const row = noisyRow()
    const split = { fit: ALL.filter((i) => CONFIGS[i].conc === 4 || CONFIGS[i].tp !== 2), heldOut: ALL.filter((i) => CONFIGS[i].conc !== 4 && CONFIGS[i].tp === 2), ttftIsl: 8192 }
    fit(row, split.fit)
    expect(row.counts.kernels).toBeGreaterThanOrEqual(grid.etaMem.length)
    const ev = evaluateRow(row, split, RULES)
    expect(row.counts.kernels).toBe(row.kernels.size)
    expect(row.counts.windows).toBe(row.windows.size)
    // every TPOT fit computes at least one kernel per η_m; unshared, the refits (the fit on F, LOO over F, LOTPO, LOSO)
    // would compute at least that many each, and here all of them together compute fewer
    const refits = 1 + split.fit.length + ev.lotpo.groups.length + ev.loso.groups.length
    expect(row.counts.kernels).toBeLessThan(refits * grid.etaMem.length)
    expect(row.counts.kernels % grid.etaMem.length).toBe(0)
  }, 60_000)

  test('two evaluations on fresh memos are byte-identical', () => {
    const split = { fit: ALL.filter((i) => CONFIGS[i].conc === 4), heldOut: ALL.filter((i) => CONFIGS[i].conc === 16), ttftIsl: 8192 }
    const a = JSON.stringify(evaluateRow(noisyRow(), split, RULES))
    const b = JSON.stringify(evaluateRow(noisyRow(), split, RULES))
    expect(a).toBe(b)
  }, 60_000)
})


describe('statistics and gates (protocol `stats`, `gates`)', () => {
  test('p90 is the nearest rank sorted[⌈0.9·n⌉ − 1]; mean arithmetic; max the largest', () => {
    const xs = Array.from({ length: 25 }, (_, i) => (i + 1) / 100)
    const s = errorStats(xs)
    expect(s.p90).toBe(xs[Math.ceil(0.9 * 25) - 1])
    expect(s.max).toBe(0.25)
    expect(Math.abs(s.mean - 0.13)).toBeLessThan(1e-15)
    expect(errorStats([0.3, 0.1, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]).p90).toBe(0.9)
    expect(errorStats([])).toEqual({ n: 0, mean: 0, p90: 0, max: 0 })
  })

  test('the median TTFT follows the protocol\'s rule (EngineV2\'s medianOf): even n takes the mean of the two middle values', () => {
    expect(medianOf([4, 1, 3, 2])).toBe(2.5)
    expect(medianOf([5, 1, 3])).toBe(3)
  })

  test('G1-G5 read the protocol\'s bounds; on exact synthetic data every TPOT gate passes and G4 reports the parameters', () => {
    const row = syntheticRow({ etaMem: 0.81, etaFlop: 0.44, layerUs: 65, seqUs: 30, linkGBs: 250 }, 0.04)
    const split = { fit: ALL.filter((i) => CONFIGS[i].conc === 4 || CONFIGS[i].tp === 1), heldOut: ALL.filter((i) => CONFIGS[i].conc === 16 && CONFIGS[i].tp !== 1), ttftIsl: 8192 }
    const ev = evaluateRow(row, split, RULES)
    expect(ev.g1.max).toBeLessThan(1e-9)
    expect(ev.g2.max).toBeLessThan(1e-9)
    expect(ev.g3.max).toBeLessThan(1e-9)
    expect(ev.gates.G1.ok && ev.gates.G2.ok && ev.gates.G3.ok && ev.gates.G4.ok).toBe(true)
    // 8 fit points is below G5's n_F ≥ 20: the row cannot be calibrated
    expect(ev.gates.G5.ok).toBe(false)
    expect(ev.calibrated).toBe(false)
    expect(ev.points.filter((p) => p.subset === 'F').length).toBe(split.fit.length)
    expect(ev.lotpo.groups.map((g) => g.group)).toEqual(['TP 1', 'TP 2', 'TP 4'])
    expect(ev.loso.groups.map((g) => g.group)).toEqual(['1024/1024', '8192/1024'])
    expect(ev.boundFlags).toEqual([])
  }, 60_000)
})
