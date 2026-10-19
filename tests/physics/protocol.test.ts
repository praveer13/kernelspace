import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BLOCK_FENCE,
  extractProtocolBlock,
  gridValues,
  historyProblems,
  parseProtocol,
  protocolProblems,
  protocolSha256,
  readProtocol,
  readProtocolHistory,
  type Protocol,
} from '../../scripts/physics-protocol'

/**
 * The pre-registered S5 gate protocol (docs/specs/s5.md §5.1, task S5-00; S5-D2, S5-D46, S5-D52, S5-D63).
 * The block is read only through `readProtocol()`. Its values are written out below by hand, from §5.1's block, so a
 * change to protocol.md (or to protocol.md and the spec together) fails here until a dated amendment updates this test.
 */
const ROOT = resolve(import.meta.dir, '../..')
const PROTOCOL_MD = readFileSync(resolve(ROOT, 'docs/physics/protocol.md'), 'utf8')
const SPEC_MD = readFileSync(resolve(ROOT, 'docs/specs/s5.md'), 'utf8')
const P = readProtocol()

/** §5.1's block, value for value. */
const EXPECTED: Protocol = {
  id: 's5-physics-gate',
  version: 1,
  date: '2026-10-18',
  status: 'adopted by the build on 2026-10-18, unsigned',
  snapshot: {
    url: 'https://inferencex.semianalysis.com/api/v1/benchmarks?model=Llama-3.3-70B-Instruct-FP8&date=2025-10-29&exact=true',
    rawSha256: 'd2ce48fdbd84936994d68bb28413f0e842da3b01a2c7a0958e4041699dc19792',
    rawBytes: 1026817,
    rawRows: 681,
    fetched: '2026-10-18',
    harness: { repo: 'SemiAnalysisAI/InferenceX', ref: '9596d23d74e9e1e4f4bcdb27572c87cafb746a02' },
  },
  select: { framework: 'vllm', spec_method: 'none', disagg: false, is_multinode: false },
  model: {
    params: 'model.llama3-70b.params',
    layers: 'model.llama3-70b.layers',
    hidden: 'model.llama3-70b.hidden-size',
    kvBytesPerToken: 'model.llama3-70b.kv-bytes-per-token-fp8',
  },
  rows: [
    {
      key: 'h100-vllm-0-10-2-fp8', hardware: 'h100', precision: 'fp8', fitTp: [2, 4, 8], boxTp: [2, 4, 8],
      bw: 'hw.h100-sxm.hbm-bw', peak: 'hw.h100-sxm.fp8-dense', hbm: 'hw.h100-sxm.hbm-capacity',
      weightBytes: 'model.llama3-70b.weight-bytes-fp8',
    },
    {
      key: 'b200-vllm-0-10-2-fp8', hardware: 'b200', precision: 'fp8', fitTp: [1, 2, 4, 8], boxTp: [1, 2, 4, 8],
      bw: 'hw.b200.hbm-bw', peak: 'hw.b200.fp8-dense', hbm: 'hw.b200.hbm-capacity',
      weightBytes: 'model.llama3-70b.weight-bytes-fp8',
    },
    {
      key: 'b200-vllm-0-10-2-nvfp4', hardware: 'b200', precision: 'fp4', fitTp: [1, 2, 4, 8], boxTp: [1, 2, 4],
      bw: 'hw.b200.hbm-bw', peak: 'hw.b200.fp4-dense', hbm: 'hw.b200.hbm-capacity',
      weightBytes: 'model.llama3-70b.weight-bytes-nvfp4',
    },
  ],
  controls: [
    { hardware: 'mi325x', precision: 'fp8', batchTokens: 131072 },
    { hardware: 'mi355x', precision: 'fp8', batchTokens: 131072 },
  ],
  filters: {
    gpuMemUtil: 0.9,
    kvRule: 'drop if conc * (isl + osl) > floor((gpuMemUtil * HBM * TP - W) / kv)',
    ttftMaxSeconds: 3,
    expectDropped: ['40752', '41507', '42070', '42140', '44119'],
  },
  split: { fitConc: [4, 16, 64], heldOutConc: [8, 32] },
  replay: {
    promptsPerConc: 10,
    rangeRatio: 0.8,
    batchTokens: 'status.inferencex.harness.batch-tokens',
    blockSize: 'status.vllm-0-10-2.block-size',
    seed: "hash32('ix:' + id)",
    order: 'all 10*c requests queued at t = 0 in id order; maxNumSeqs = c; FCFS; TTFT stamped from admission',
  },
  fit: {
    etaMem: { from: 0.3, to: 1, step: 0.01 },
    etaFlop: { from: 0.1, to: 1, step: 0.02 },
    etaFlopStart: 0.6,
    linear: ['layerUs', 'seqUs', 'invLinkGBs'],
    objective: 'sum over fit points of (predTpot / measTpot - 1)^2, by NNLS with every active set enumerated',
    ttftRounds: 3,
    ttftPoints: "every fit point's median TTFT",
    harness: 'closed-form weighted least squares on (engine TTFT + h) / meas - 1, clipped at 0',
    memo: 'the per-point weighted kernel is memoised by (etaMem, etaFlop) per row and shared by the fit and every LOO, LOTPO and LOSO refit',
  },
  stats: {
    error: 'abs(pred / meas - 1)',
    mean: 'arithmetic',
    p90: 'sorted[ceil(0.9 * n) - 1]',
    max: 'largest',
    median: 'mean of sorted[n/2 - 1] and sorted[n/2] for even n (np.median), sorted[(n - 1)/2] for odd; over requests, per parameter set',
  },
  gates: {
    G1: { metric: 'tpot', population: 'leave-one-out over the fit subset', meanMax: 0.1, p90Max: 0.15 },
    G2: { metric: 'tpot', population: 'held-out subset, scored by the fit on the whole fit subset', meanMax: 0.1, p90Max: 0.15 },
    G3: {
      metric: 'ttft-median',
      population: 'leave-one-out over fit-subset points with isl 8192, harness term added',
      meanMax: 0.15,
      decides: 'TTFT eligibility only',
    },
    G4: { etaMem: [0.5, 0.95], etaFlop: [0.2, 0.9], layerUsMax: 200, seqUsMax: 200, linkGBsMax: 900, harnessMsMax: 100 },
    G5: { fitPointsMin: 20, tpValuesMin: 2, concValuesMin: 3, shapesMin: 2, shapeRequired: [8192, 1024] },
  },
  printed: ['max', 'worst three points with run_url', 'LOTPO', 'LOSO', 'NIM cross-harness', 'MI325X/MI355X control', 'frozen-form report on newer snapshots'],
  consistency: { configsPerRow: 3, sum: 'float stepS, as the fit uses', tpotMaxAbsUs: 0.5, ttftMaxAbsUs: '0.5 * steps in the median windows' },
  h1: {
    scope: 'decisions graded against measured values (frontier); step items are graded at the family tolerance and carry H4 labels only',
    tolerance: "max(0.15, p90 of the quantity's LOO error), rounded up to a whole percent",
    separation: 'measured winner / runner-up >= 1 / (1 - deltaSep); deltaSep = p90 of the LOO error of the winner-to-runner-up ratio over published option pairs of the row',
    membership: "every option's tok/s/user at least deltaMem from the floor, relatively; deltaMem = the row's TPOT LOO p90 over F",
    agreement: 'the answer from LOO predictions equals the answer from measured values',
  },
  fairness: {
    doneRule: '3 right in a row on fresh seeds with at least 2 distinct answers',
    answerShareMax: 0.29,
    blindWithin10Max: 0.14,
    blindWithin30Max: 0.4,
    readerWithin10Min: 0.9,
  },
  frontier: {
    concs: [4, 16, 64],
    floorFrom: 15,
    floorTo: 120,
    floorStep: 0.1,
    classWidthMin: 3,
    classesMin: 6,
    sampling: "a class uniformly, then a shape and a floor uniformly within the class's gradeable intervals",
    replaySeed: "hash32('ix-frontier:' + isl + '/' + osl + ':' + c)",
    replays: 'one per (shape, c), shared across TPs and rows',
    classesCount: 'distinct answer codes (100 * TP + c) across rows',
    sweepMaxMs: 2500,
  },
  items: {
    instances: 2000,
    constantCoverMax: 0.1,
    answerSpanMin: 10,
    ratioRule: 'ratio variants: no span bound; constantCoverMax measured at the family tolerance',
  },
}

/** The `> ` paragraph that follows a line in `markdown`, without the marker. */
const quoteAfter = (markdown: string, heading: string): string => {
  const lines = markdown.split('\n')
  const at = lines.findIndex((l) => l === heading)
  const quote = lines.slice(at + 1).find((l) => l.startsWith('> '))
  if (at < 0 || quote === undefined) throw new Error(`no quote after ${heading}`)
  return quote.slice(2)
}

describe('the s5-protocol block', () => {
  test('protocol.md holds exactly one block, byte for byte the block of the spec §5.1', () => {
    expect(PROTOCOL_MD.split('\n').filter((l) => l === BLOCK_FENCE)).toHaveLength(1)
    expect(extractProtocolBlock(PROTOCOL_MD)).toBe(extractProtocolBlock(SPEC_MD))
  })

  test('readProtocol() returns §5.1 value for value, with the right shape, frozen', () => {
    expect(protocolProblems(P)).toEqual([])
    expect(P).toEqual(EXPECTED)
    expect(Object.isFrozen(P)).toBe(true)
    expect(Object.isFrozen(P.rows[2].boxTp)).toBe(true)
    expect(Object.isFrozen(P.gates.G4)).toBe(true)
  })

  test('identity: version 1 of 2026-10-18, adopted by the build and unsigned', () => {
    expect([P.id, P.version, P.date]).toEqual(['s5-physics-gate', 1, '2026-10-18'])
    expect(P.status).toBe('adopted by the build on 2026-10-18, unsigned')
    expect(P.snapshot.rawSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(P.snapshot.harness.ref).toMatch(/^[0-9a-f]{40}$/)
  })

  test('rows: H100 FP8 TP 2/4/8, B200 FP8 TP 1-8, B200 NVFP4 fitted on TP 1-8 and boxed to TP 1-4 (S5-D6)', () => {
    expect(P.rows.map((r) => [r.key, r.hardware, r.precision])).toEqual([
      ['h100-vllm-0-10-2-fp8', 'h100', 'fp8'],
      ['b200-vllm-0-10-2-fp8', 'b200', 'fp8'],
      ['b200-vllm-0-10-2-nvfp4', 'b200', 'fp4'],
    ])
    expect(P.rows.map((r) => r.fitTp)).toEqual([[2, 4, 8], [1, 2, 4, 8], [1, 2, 4, 8]])
    expect(P.rows.map((r) => r.boxTp)).toEqual([[2, 4, 8], [1, 2, 4, 8], [1, 2, 4]])
    for (const r of P.rows) expect(r.boxTp.every((tp) => r.fitTp.includes(tp))).toBe(true)
    expect(P.rows.map((r) => r.peak)).toEqual(['hw.h100-sxm.fp8-dense', 'hw.b200.fp8-dense', 'hw.b200.fp4-dense'])
    expect(P.rows.map((r) => r.weightBytes)).toEqual([
      'model.llama3-70b.weight-bytes-fp8',
      'model.llama3-70b.weight-bytes-fp8',
      'model.llama3-70b.weight-bytes-nvfp4',
    ])
    expect(P.model.kvBytesPerToken).toBe('model.llama3-70b.kv-bytes-per-token-fp8')
    expect(P.controls.map((c) => [c.hardware, c.precision, c.batchTokens])).toEqual([['mi325x', 'fp8', 131072], ['mi355x', 'fp8', 131072]])
  })

  test('selection: single-node vLLM rows without speculation', () => {
    expect(P.select).toEqual({ framework: 'vllm', spec_method: 'none', disagg: false, is_multinode: false })
  })

  test('filters: the KV rule at 0.9 of HBM, TTFT under 3 s, exactly the five expected drops', () => {
    expect(P.filters.gpuMemUtil).toBe(0.9)
    expect(P.filters.ttftMaxSeconds).toBe(3)
    expect(P.filters.kvRule).toBe('drop if conc * (isl + osl) > floor((gpuMemUtil * HBM * TP - W) / kv)')
    expect(P.filters.expectDropped).toEqual(['40752', '41507', '42070', '42140', '44119'])
    expect([...P.filters.expectDropped].sort()).toEqual([...P.filters.expectDropped])
  })

  test('split: F = {4, 16, 64} fits, H = {8, 32} is held out, and frontier uses F only', () => {
    expect(P.split).toEqual({ fitConc: [4, 16, 64], heldOutConc: [8, 32] })
    expect(P.split.fitConc.some((c) => P.split.heldOutConc.includes(c))).toBe(false)
    expect(P.frontier.concs).toEqual(P.split.fitConc)
  })

  test('replay: 10 prompts per user at range ratio 0.8, the harness budget and vLLM 0.10.2 block size (S5-D34), seeded per id', () => {
    expect(P.replay.promptsPerConc).toBe(10)
    expect(P.replay.rangeRatio).toBe(0.8)
    expect(P.replay.batchTokens).toBe('status.inferencex.harness.batch-tokens')
    expect(P.replay.blockSize).toBe('status.vllm-0-10-2.block-size')
    expect(P.replay.seed).toBe("hash32('ix:' + id)")
    expect(P.replay.order).toContain('maxNumSeqs = c; FCFS; TTFT stamped from admission')
  })

  test('fit: bounds and the exhaustive grid of S5-D35 (71 x 46), starting at eta_f 0.60 with three TTFT rounds', () => {
    expect(P.fit.etaMem).toEqual({ from: 0.3, to: 1, step: 0.01 })
    expect(P.fit.etaFlop).toEqual({ from: 0.1, to: 1, step: 0.02 })
    const mem = gridValues(P.fit.etaMem)
    const flop = gridValues(P.fit.etaFlop)
    expect(mem).toHaveLength(71)
    expect(flop).toHaveLength(46)
    expect([mem[0], mem[1], mem[70]]).toEqual([0.3, 0.31, 1])
    expect([flop[0], flop[1], flop[45]]).toEqual([0.1, 0.12, 1])
    expect(flop).toContain(P.fit.etaFlopStart)
    expect(P.fit.etaFlopStart).toBe(0.6)
    expect(P.fit.ttftRounds).toBe(3)
    expect(P.fit.linear).toEqual(['layerUs', 'seqUs', 'invLinkGBs'])
    expect(P.fit.objective).toContain('NNLS with every active set enumerated')
    expect(P.fit.harness).toContain('clipped at 0')
    expect(() => gridValues({ from: 0.3, to: 1, step: 0.03 })).toThrow()
    expect(() => gridValues({ from: 0.305, to: 1, step: 0.01 })).toThrow()
  })

  test('stats: relative error, arithmetic mean, nearest-rank p90 and the np.median rule', () => {
    expect(P.stats.error).toBe('abs(pred / meas - 1)')
    expect(P.stats.mean).toBe('arithmetic')
    expect(P.stats.p90).toBe('sorted[ceil(0.9 * n) - 1]')
    expect(P.stats.max).toBe('largest')
    expect(P.stats.median).toBe(
      'mean of sorted[n/2 - 1] and sorted[n/2] for even n (np.median), sorted[(n - 1)/2] for odd; over requests, per parameter set',
    )
  })

  test('gates G1-G5 (O1 (b), S5-D3)', () => {
    expect(Object.keys(P.gates)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5'])
    for (const g of [P.gates.G1, P.gates.G2]) expect([g.metric, g.meanMax, g.p90Max]).toEqual(['tpot', 0.1, 0.15])
    expect(P.gates.G1.population).toBe('leave-one-out over the fit subset')
    expect(P.gates.G2.population).toBe('held-out subset, scored by the fit on the whole fit subset')
    expect([P.gates.G3.metric, P.gates.G3.meanMax, P.gates.G3.decides]).toEqual(['ttft-median', 0.15, 'TTFT eligibility only'])
    expect(P.gates.G3.population).toContain('isl 8192')
    expect(P.gates.G4).toEqual({ etaMem: [0.5, 0.95], etaFlop: [0.2, 0.9], layerUsMax: 200, seqUsMax: 200, linkGBsMax: 900, harnessMsMax: 100 })
    // G4's physical ranges sit inside the fit's grid bounds, so a bound-hugging fit is flagged rather than impossible.
    expect(P.gates.G4.etaMem[0]).toBeGreaterThanOrEqual(P.fit.etaMem.from)
    expect(P.gates.G4.etaMem[1]).toBeLessThanOrEqual(P.fit.etaMem.to)
    expect(P.gates.G4.etaFlop[0]).toBeGreaterThanOrEqual(P.fit.etaFlop.from)
    expect(P.gates.G4.etaFlop[1]).toBeLessThanOrEqual(P.fit.etaFlop.to)
    expect(P.gates.G5).toEqual({ fitPointsMin: 20, tpValuesMin: 2, concValuesMin: 3, shapesMin: 2, shapeRequired: [8192, 1024] })
    expect(P.printed).toEqual(EXPECTED.printed)
  })

  test('consistency: 3 configurations per row, 0.5 µs on mean TPOT (S5-D14)', () => {
    expect(P.consistency).toEqual({ configsPerRow: 3, sum: 'float stepS, as the fit uses', tpotMaxAbsUs: 0.5, ttftMaxAbsUs: '0.5 * steps in the median windows' })
  })

  test('H1 binds frontier only; step items carry H4 (S5-D57)', () => {
    expect(P.h1.scope).toContain('(frontier)')
    expect(P.h1.scope).toContain('step items are graded at the family tolerance and carry H4 labels only')
    expect(P.h1.tolerance).toBe("max(0.15, p90 of the quantity's LOO error), rounded up to a whole percent")
    expect(P.h1.separation).toContain('>= 1 / (1 - deltaSep)')
    expect(P.h1.membership).toContain("deltaMem = the row's TPOT LOO p90 over F")
    expect(P.h1.agreement).toBe('the answer from LOO predictions equals the answer from measured values')
  })

  test('fairness: wave-3 D39 bounds', () => {
    expect(P.fairness).toEqual({
      doneRule: '3 right in a row on fresh seeds with at least 2 distinct answers',
      answerShareMax: 0.29,
      blindWithin10Max: 0.14,
      blindWithin30Max: 0.4,
      readerWithin10Min: 0.9,
    })
  })

  test('frontier: floors, classes, the shared replay seed (S5-D60) and the kill-rule figures (O7, S5-D45)', () => {
    expect([P.frontier.floorFrom, P.frontier.floorTo, P.frontier.floorStep]).toEqual([15, 120, 0.1])
    expect(P.frontier.classWidthMin).toBe(3)
    expect(P.frontier.replaySeed).toBe("hash32('ix-frontier:' + isl + '/' + osl + ':' + c)")
    expect(P.frontier.replays).toBe('one per (shape, c), shared across TPs and rows')
    expect(P.frontier.sampling).toContain('a class uniformly')
    // Kill rule 1: fewer than 6 distinct answer codes; rule 1b: answer share; rule 2: the blind guesser; rule 3: the reader; rule 4: sweep time.
    expect(P.frontier.classesMin).toBe(6)
    expect(P.frontier.classesCount).toBe('distinct answer codes (100 * TP + c) across rows')
    expect([P.fairness.answerShareMax, P.fairness.blindWithin10Max, P.fairness.blindWithin30Max, P.fairness.readerWithin10Min]).toEqual([0.29, 0.14, 0.4, 0.9])
    expect(P.frontier.sweepMaxMs).toBe(2500)
    // Every answer code 100·TP + c is distinct across the rows' box TPs and F's concurrencies.
    const codes = P.rows.flatMap((r) => r.boxTp.flatMap((tp) => P.frontier.concs.map((c) => 100 * tp + c)))
    expect(new Set(codes).size).toBe(new Set(P.rows.flatMap((r) => r.boxTp)).size * P.frontier.concs.length)
  })

  test('items: 2,000 instances, constant cover at most 10 %, span at least 10x, and the ratio rule (S5-D57)', () => {
    expect(P.items).toEqual({
      instances: 2000,
      constantCoverMax: 0.1,
      answerSpanMin: 10,
      ratioRule: 'ratio variants: no span bound; constantCoverMax measured at the family tolerance',
    })
  })
})

describe('the parser', () => {
  const md = (json: string) => `# x\n\n${BLOCK_FENCE}\n${json}\n\`\`\`\n`
  const block = JSON.parse(extractProtocolBlock(PROTOCOL_MD)) as Record<string, unknown>

  test('round-trips the committed block', () => {
    expect(parseProtocol(md(JSON.stringify(block)))).toEqual(P)
  })

  test('rejects a missing key, an unknown key and a wrong type, naming each', () => {
    const missing = { ...block }
    delete missing.items
    expect(() => parseProtocol(md(JSON.stringify(missing)))).toThrow('protocol.items: missing')
    expect(() => parseProtocol(md(JSON.stringify({ ...block, extra: 1 })))).toThrow('protocol.extra: not a protocol key')
    expect(() => parseProtocol(md(JSON.stringify({ ...block, version: '1' })))).toThrow('protocol.version: expected a finite number')
    const g4 = { ...(block.gates as Record<string, unknown>), G4: { ...((block.gates as Record<string, Record<string, unknown>>).G4), etaMem: [0.5] } }
    expect(() => parseProtocol(md(JSON.stringify({ ...block, gates: g4 })))).toThrow('protocol.gates.G4.etaMem: expected two finite numbers')
  })

  test('rejects no block, two blocks and an unclosed block', () => {
    expect(() => extractProtocolBlock('# nothing\n')).toThrow('found 0')
    expect(() => extractProtocolBlock(md('{}') + md('{}'))).toThrow('found 2')
    expect(() => extractProtocolBlock(`${BLOCK_FENCE}\n{}\n`)).toThrow('not closed')
  })
})

describe('protocol.md', () => {
  const lines = PROTOCOL_MD.split('\n')

  test('is dated 2026-10-18 and opens with its unsigned status', () => {
    const firstText = lines.find((l) => l !== '' && !l.startsWith('#'))
    expect(firstText).toBe('Status: adopted by the build on 2026-10-18, unsigned. The owner signs it (F2); the build does not wait.')
    expect(PROTOCOL_MD).toContain('**Date:** 2026-10-18.')
  })

  test('carries the eleven headings of §5.1, in order', () => {
    expect(lines.filter((l) => l.startsWith('## '))).toEqual([
      '## 1. Purpose',
      '## 2. The snapshot',
      '## 3. Selection, filters and split',
      '## 4. Rows, peaks and boxes',
      '## 5. The card and the fit',
      '## 6. The gates',
      '## 7. Decisions that follow',
      '## 8. Exercises',
      '## 9. Selection disclosure',
      '## 10. Amendments',
      '## 11. The machine block',
    ])
  })

  test('quotes the selection disclosure of §5.1 verbatim', () => {
    const spec = quoteAfter(SPEC_MD, '**Selection disclosure** (verbatim):')
    expect(spec.startsWith('The card form (layers·t_layer')).toBe(true)
    expect(quoteAfter(PROTOCOL_MD, '## 9. Selection disclosure')).toBe(spec)
  })

  test('quotes PLAN-100X.md:706 as it stands', () => {
    const plan = readFileSync(resolve(ROOT, 'PLAN-100X.md'), 'utf8').split('\n')[705]
    expect(`| ${quoteAfter(PROTOCOL_MD, '## 1. Purpose')} |`).toBe(plan)
  })

  test('has no amendment yet, so no dated entry under Amendments', () => {
    const at = lines.indexOf('## 10. Amendments')
    const next = lines.indexOf('## 11. The machine block')
    expect(lines.slice(at + 1, next).filter((l) => l.startsWith('### '))).toEqual([])
  })
})

describe('protocol-history.json (S5-D63)', () => {
  const history = readProtocolHistory()

  test('is version 1 of 2026-10-18, and its last entry has protocol.md sha256 and the block version', () => {
    expect(history).toEqual([{ version: 1, date: '2026-10-18', sha256: protocolSha256() }])
    const last = history[history.length - 1]
    expect(last.sha256).toBe(protocolSha256())
    expect(last.version).toBe(P.version)
    expect(historyProblems(P, protocolSha256(), history)).toEqual([])
  })

  test('is append-only: entry 1 keeps the sha256 the verdict was taken under, whatever is appended after it', () => {
    // a prose edit plus entry 1 rewritten in place to the new sha would otherwise pass every other check
    expect(history[0]).toEqual({ version: 1, date: '2026-10-18', sha256: '0a235a69821ffc67a66417b2ba23c6c2e8285e0483d7e2f23cf13e9699100fba' })
  })

  test('historyProblems names a changed file, a version mismatch and a gap', () => {
    const sha = 'a'.repeat(64)
    const other = '0'.repeat(64)
    const v1 = [{ version: 1, date: '2026-10-18', sha256: sha }]
    expect(historyProblems(P, sha, v1)).toEqual([])
    expect(historyProblems(P, other, v1)).toEqual([`protocol.md's sha256 is ${other}, the last history entry records ${sha}`])
    const v2 = [...v1, { version: 2, date: '2027-01-01', sha256: sha }]
    expect(historyProblems(P, sha, v2)).toEqual([
      "the block's version is 1, the last history entry records 2",
      "the block's date is 2026-10-18, the last history entry records 2027-01-01",
    ])
    expect(historyProblems(P, sha, [{ version: 2, date: '2026-10-18', sha256: sha }])).toContain('history entry 0 has version 2, expected 1')
  })
})
