/**
 * The decision tables (docs/specs/s5.md §7.0-7.1, §5.8; S5-08): the done rule and the guessers, the `frontier` replays,
 * decision-level H1 on fixtures, and the committed decisions.json, frontier-scenes.json and controls.json against the table
 * and the claims. `verify:physics --full` regenerates the first two from the gate run and diffs them; this file never runs
 * the gate (it would take the 20 s budget of a test).
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ALL_CLAIMS, getClaim } from '../../src/data/claims/all'
import { ANSWERS_NEEDED, PASSES_NEEDED, runOf, type Played } from '../../src/components/fleet-ex/session'
import { hash32, splitmix32u } from '../../src/lib/rng'
import { stepCard } from '../../src/lib/world/physics/card'
import {
  buildFrontier,
  choose,
  decodeLoad,
  engineTpot,
  floorGrid,
  frontierReplay,
  ignoring,
  meanLength,
  nextRound,
  pairRatios,
  parseCodeMultiplier,
  parseDoneRule,
  parseReplaySeed,
  prefillLoad,
  readerDone,
  rowOnly,
  sceneVerdict,
  twoCardTpot,
  type FrontierOption,
  type FrontierRules,
} from '../../src/lib/world/physics/decide'
import { medianWindowSteps, predictMedianTtft, runEngine, stepSeconds } from '../../src/lib/world/physics/replay'
import { PHYSICS_ROWS, PHYS_ID } from '../../src/lib/world/physics/table'
import { EXTRACT_PATH, readExtract } from '../../scripts/fetch-physics-points'
import { replaySettings } from '../../scripts/fit-physics'
import { CONTROLS_COMMAND, newerSnapshots, nimFamily, nimGroup } from '../../scripts/physics-controls'
import { protocolSha256, readProtocol } from '../../scripts/physics-protocol'
import {
  CONTROLS_PATH,
  CONTROL_CLAIMS,
  DECISIONS_COMMAND,
  DECISIONS_PATH,
  SCENES_PATH,
  controlsProblems,
  decisionClaimIds,
  decisionsProblems,
  prettyJson,
  type Decisions,
  type FrontierScenesFile,
} from '../../scripts/verify-physics'

const protocol = readProtocol()
const rule = parseDoneRule(protocol.fairness.doneRule)

/* ------------------------------ the done rule: a copy of tests/fleet-ex/done-rule.test.ts:80-111 ------------------------------ */

type Trail = readonly number[]

/** One more round on a fresh seed, judged by the panel's own rule (`runOf`). Verbatim from done-rule.test.ts. */
function next(trail: Trail, guess: number, right: boolean): { trail: Trail; done: boolean } {
  const played: Played[] = trail.map((t, i) => ({ seed: i, ok: true, value: t, truth: t }))
  played.push({ seed: trail.length, ok: right, value: guess, truth: right ? guess : NaN })
  return { trail: right ? [...trail, guess].slice(-(PASSES_NEEDED - 1)) : [], done: runOf(played, PASSES_NEEDED).done }
}

/** `ignoring()` verbatim from done-rule.test.ts: the reference decide.ts's copy must equal. */
function reference(p: Map<number, number>, rounds: number, policy?: (round: number) => number): number {
  const memo = new Map<string, number>()
  const f = (t: number, trail: Trail): number => {
    if (t === rounds) return 0
    const key = `${t}|${trail.join(',')}`
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let best = 0
    for (const g of policy ? [policy(t)] : [...p.keys()]) {
      const pg = p.get(g) ?? 0
      const right = next(trail, g, true)
      const wrong = next(trail, g, false)
      const v = pg * (right.done ? 1 : f(t + 1, right.trail)) + (1 - pg) * (wrong.done ? 1 : f(t + 1, wrong.trail))
      best = Math.max(best, v)
    }
    memo.set(key, best)
    return best
  }
  return f(0, [])
}

/**
 * done-rule.test.ts's cases: the right-answer shares it measures on its banded seeds (it prints them: knee 50, 51, 27 and 48
 * of 176 seeds; P:D 20, 22, 23 and 15 of 80), with its policies: a constant, cycling the top k, and the best guess.
 */
const CASES: [string, Map<number, number>][] = [
  ['knee', new Map([[0.75, 50 / 176], [1, 51 / 176], [1.25, 27 / 176], [1.5, 48 / 176]])],
  ['P:D split', new Map([[2, 20 / 80], [3, 22 / 80], [4, 23 / 80], [5, 15 / 80]])],
]

describe('the done rule and the guessers (a pure copy of done-rule.test.ts:92-111)', () => {
  test("the protocol's done rule is the panel's", () => {
    expect(rule).toEqual({ passes: PASSES_NEEDED, answers: ANSWERS_NEEDED })
    expect(() => parseDoneRule('three in a row')).toThrow()
  })

  test("nextRound is runOf's verdict on every short history", () => {
    const rnd = splitmix32u(0x5e08)
    for (let i = 0; i < 2000; i++) {
      const trail = Array.from({ length: rnd() % PASSES_NEEDED }, () => 1 + (rnd() % 3))
      const guess = 1 + (rnd() % 3)
      const right = rnd() % 2 === 0
      expect(nextRound(rule, trail, guess, right)).toEqual(next(trail, guess, right))
    }
  })

  for (const [name, p] of CASES) {
    test(`${name}: equal to the test file's ignoring() for a constant, cycling and the best guess, within 10 and 30`, () => {
      const order = [...p.keys()].sort((a, b) => (p.get(b) as number) - (p.get(a) as number))
      for (const rounds of [10, 30]) {
        expect(ignoring(p, rounds, rule, () => order[0])).toBe(reference(p, rounds, () => order[0]))
        for (let k = 2; k <= order.length; k++) expect(ignoring(p, rounds, rule, (t) => order[t % k])).toBe(reference(p, rounds, (t) => order[t % k]))
        expect(ignoring(p, rounds, rule)).toBe(reference(p, rounds))
      }
      // the figures the test file prints: knee 14.0 / 40.2 %, P:D 13.5 / 38.9 %
      const [ten, thirty] = name === 'knee' ? [0.14, 0.402] : [0.135, 0.389]
      expect(Math.abs(ignoring(p, 10, rule) - ten)).toBeLessThan(0.0005)
      expect(Math.abs(ignoring(p, 30, rule) - thirty)).toBeLessThan(0.0005)
    })
  }

  test('the row-only guesser on one row is the scene-blind guesser; on rows that split the answers it does better', () => {
    const p = CASES[0][1]
    expect(rowOnly([{ weight: 1, shares: p }], 10, rule)).toBeCloseTo(ignoring(p, 10, rule), 12)
    const split = rowOnly([{ weight: 0.5, shares: new Map([[1, 0.5], [2, 0.5]]) }, { weight: 0.5, shares: new Map([[3, 0.5], [4, 0.5]]) }], 10, rule)
    expect(split).toBeGreaterThan(ignoring(new Map([[1, 0.25], [2, 0.25], [3, 0.25], [4, 0.25]]), 10, rule))
  })

  test('the reader: exact on a hand case, zero when never right', () => {
    // two classes, always read right: done within 3 rounds unless all three draws are one class: 1 − 2 × (1/2)³
    expect(readerDone([{ weight: 0.5, answer: 1, right: 1 }, { weight: 0.5, answer: 2, right: 1 }], 3, rule)).toBeCloseTo(0.75, 15)
    expect(readerDone([{ weight: 0.5, answer: 1, right: 0 }, { weight: 0.5, answer: 2, right: 0 }], 30, rule)).toBe(0)
    // one answer only can never finish
    expect(readerDone([{ weight: 1, answer: 7, right: 1 }], 30, rule)).toBe(0)
  })
})

/* ------------------------------ the replays (S5-D60) ------------------------------ */

describe('the frontier replays: one per (shape, c), shared across TPs and rows', () => {
  const settings = replaySettings(protocol)
  const h100 = PHYSICS_ROWS.find((r) => r.key === 'h100-vllm-0-10-2-fp8')
  const b200 = PHYSICS_ROWS.find((r) => r.key === 'b200-vllm-0-10-2-fp8')
  if (!h100 || !b200) throw new Error('the table has no FP8 rows')

  test("the seed rule and the answer code are the protocol's", () => {
    expect(parseReplaySeed(protocol.frontier.replaySeed)(1024, 8192, 64)).toBe('ix-frontier:1024/8192:64')
    expect(parseCodeMultiplier(protocol.frontier.classesCount)).toBe(100)
    expect(() => parseReplaySeed("hash32('ix:' + id)")).toThrow()
  })

  test("one replay's weighted sum equals EngineV2 at every TP and row it serves (§5.6's tolerance)", () => {
    const shape = { isl: 1024, osl: 1024 }
    const conc = 4
    const seed = hash32(parseReplaySeed(protocol.frontier.replaySeed)(shape.isl, shape.osl, conc))
    const users = [...h100.box.tp.map((tp) => ({ row: h100.key, spec: h100.spec, tp })), ...b200.box.tp.map((tp) => ({ row: b200.key, spec: b200.spec, tp }))]
    const r = frontierReplay(shape, conc, seed, users, settings)
    expect(r.checkedAtMax).toBe(true)
    expect(r.pools.max).toBeGreaterThan(r.pools.min)
    for (const [row, tp] of [[h100, 2], [h100, 8], [b200, 1], [b200, 8]] as const) {
      const run = runEngine(row, { id: 'frontier', tp, conc, isl: shape.isl, osl: shape.osl, seed }, settings)
      const log = { ...r.log, tp }
      const stepS = stepSeconds(log, row.spec)
      expect(Math.abs(run.meanTpotUs - engineTpot(r.log, row.spec, tp) * 1e6)).toBeLessThanOrEqual(protocol.consistency.tpotMaxAbsUs)
      expect(Math.abs(run.medianTtftUs - predictMedianTtft(log, row.spec, stepS) * 1e6)).toBeLessThanOrEqual(0.5 * medianWindowSteps(log, row.spec, stepS))
      expect(run.preemptions).toBe(0)
    }
  }, 60_000)
})

/* ------------------------------ H1 on fixtures ------------------------------ */

/** An option whose every side reads the same TPOT unless told otherwise. */
const opt = (id: string, tp: number, conc: number, tpot: number, over: Partial<FrontierOption> = {}): FrontierOption => ({
  id, tp, conc, isl: 1024, osl: 1024, meas: tpot, loo: tpot, engine: tpot, reader: tpot, ...over,
})

describe('decision-level H1 (§7.0) on hand-made options', () => {
  // tok/s per user is 1 ÷ TPOT, tok/s per GPU c ÷ (TPOT × TP)
  const a = opt('a', 1, 4, 0.01) // 100 tok/s/user, 400 tok/s/GPU
  const b = opt('b', 1, 16, 0.02) // 50, 800
  const c = opt('c', 1, 64, 0.04) // 25, 1600
  const m = { deltaMem: 0.1, deltaSep: 0.1 }

  test('the answer is the most tok/s/GPU among the options meeting the floor', () => {
    expect(choose([a, b, c], (o) => o.meas, 20, 100)).toMatchObject({ qualifying: 3, answer: 164, runnerUp: 116, ratio: 2 })
    expect(choose([a, b, c], (o) => o.meas, 40, 100)).toMatchObject({ qualifying: 2, answer: 116, runnerUp: 104 })
    expect(choose([a, b, c], (o) => o.meas, 90, 100)).toMatchObject({ qualifying: 1, answer: 104, runnerUp: null })
  })

  test('each check in its order: too few, membership, separation, LOO agreement, H2, the engine margins', () => {
    expect(sceneVerdict([a, b, c], 90, m, 100).verdict).toBe('few')
    // 26.0: c sits 3.8 % from the floor, inside δ_mem
    expect(sceneVerdict([a, b, c], 26, m, 100).verdict).toBe('membership')
    // two options 5 % apart per GPU cannot be told apart at δ_sep 10 %
    expect(sceneVerdict([a, b, opt('d', 2, 32, 0.021)], 30, m, 100).verdict).toBe('separation')
    expect(sceneVerdict([a, b, c], 20, m, 100)).toEqual({ verdict: 'ok', answer: 164 })
    expect(sceneVerdict([a, b, { ...c, loo: 0.06 }], 20, m, 100).verdict).toBe('loo')
    expect(sceneVerdict([a, b, { ...c, engine: 0.06 }], 20, m, 100).verdict).toBe('h2')
    // the engine keeps the answer but puts c within δ_mem of the floor
    expect(sceneVerdict([a, b, { ...c, engine: 0.0485 }], 20, m, 100).verdict).toBe('engine-margins')
  })

  test('the pair-ratio table: every pair of one shape, its LOO error', () => {
    const pr = pairRatios([a, { ...b, loo: 0.022 }, c, { ...opt('e', 1, 4, 0.01), isl: 8192 }])
    expect(pr.map((x) => `${x.a}-${x.b}`)).toEqual(['a-b', 'a-c', 'b-c'])
    expect(pr[0].meas).toBeCloseTo(0.5, 15)
    expect(pr[0].error).toBeCloseTo(0.1, 12)
    expect(pr[1].error).toBe(0)
  })

  const rules = (over: Partial<FrontierRules> = {}): FrontierRules => ({
    grid: floorGrid(15, 120, 0.1),
    widthMin: 30,
    classesMin: 6,
    mult: 100,
    rule,
    answerShareMax: 0.29,
    blindWithin10Max: 0.14,
    blindWithin30Max: 0.4,
    readerWithin10Min: 0.9,
    ...over,
  })

  test('intervals, the width rule, classes and flattened sampling', () => {
    const f = buildFrontier([{ key: 'r', margins: m, options: [a, b, c] }], rules())
    // c (25 tok/s/user) wins from 15.0 up to 25 ÷ 1.1 = 22.7; b (50) from 25 ÷ 0.9 = 27.8 up to 50 ÷ 1.1 = 45.4; above 50 ÷ 0.9 only a qualifies
    expect(f.intervals.map((x) => [x.answer, x.interval.from, x.interval.to, x.kept])).toEqual([[164, 150, 227, true], [116, 278, 454, true]])
    expect(f.classes.map((k) => [k.answer, k.scenes, k.readerRight])).toEqual([[116, 177, 177], [164, 78, 78]])
    expect(f.sampling.shares).toEqual([{ answer: 116, share: 0.5 }, { answer: 164, share: 0.5 }])
    expect(f.kill.find((k) => k.rule === '1')?.trips).toBe(true)
    expect(f.killed).toBe(true)
    expect(f.rule).toStartWith('kill rule 1:')
    // a wider width rule drops the narrower class
    const g = buildFrontier([{ key: 'r', margins: m, options: [a, b, c] }], rules({ widthMin: 100 }))
    expect(g.classes.map((k) => k.answer)).toEqual([116])
    expect(g.narrowClasses).toEqual([{ row: 'r', answer: 164, widest: 77 }])
  })

  test('the floor grid is whole steps', () => {
    expect(floorGrid(15, 120, 0.1)).toEqual({ first: 150, last: 1200, perUnit: 10 })
    expect(() => floorGrid(15.05, 120, 0.1)).toThrow()
  })
})

/* ------------------------------ the reader (§3.8) ------------------------------ */

describe("the reader's two-card rule", () => {
  test('TPOT ≈ t_dec + (c − 1)(t_pre − t_dec) ÷ OSL with §3.6 and §3.7 loads', () => {
    const row = PHYSICS_ROWS[0]
    const [conc, isl, osl, ratio] = [64, 8192, 1024, 0.8]
    expect(meanLength(8192, 0.8)).toBe(7372.5)
    expect(decodeLoad(4, 1024, 1024, 0.8)).toEqual({ seqs: 4, tokens: 4, kvTokens: 5529, attnPairs: 5529 })
    expect(prefillLoad(4, 8192, 1024, 0.8)).toEqual({ seqs: 4, tokens: 7376, kvTokens: 30875, attnPairs: 27207753 })
    const dec = stepCard(row.spec, 4, decodeLoad(conc, isl, osl, ratio)).stepS
    const pre = stepCard(row.spec, 4, prefillLoad(conc, isl, osl, ratio)).stepS
    expect(twoCardTpot(row.spec, 4, conc, isl, osl, ratio)).toBeCloseTo(dec + (63 * (pre - dec)) / 921.5, 15)
  })
})

/* ------------------------------ the committed files ------------------------------ */

const decisions = JSON.parse(readFileSync(DECISIONS_PATH, 'utf8')) as Decisions
const scenes = JSON.parse(readFileSync(SCENES_PATH, 'utf8')) as FrontierScenesFile
const controls = JSON.parse(readFileSync(CONTROLS_PATH, 'utf8')) as { claimValues: Record<string, number>; generatedBy: string; nim: { groups: { key: string; n: number }[] }; control: { hardware: string; nFit: number; batchTokens: number }[] }

describe('the committed decision tables', () => {
  test("were written for this table and protocol, agree with themselves, and frontier-scenes.json holds their classes", () => {
    expect(decisions.physId).toBe(PHYS_ID)
    expect(decisions.generatedBy).toBe(DECISIONS_COMMAND)
    expect(decisionsProblems(decisions, scenes, PHYS_ID, protocolSha256())).toEqual([])
    expect(decisionsProblems({ ...decisions, physId: 'v2-other' }, scenes, PHYS_ID, protocolSha256()).length).toBeGreaterThan(0)
    expect(decisionsProblems({ ...decisions, frontier: { ...decisions.frontier, killed: !decisions.frontier.killed } }, scenes, PHYS_ID, protocolSha256()).length).toBeGreaterThan(0)
  })

  test('frontier: rows, δ_mem from G1, the pair counts, and the kill as data (S5-D45)', () => {
    const fr = decisions.frontier
    expect(fr.rows).toEqual(['h100-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-fp8'])
    for (const h of fr.h1) {
      const table = PHYSICS_ROWS.find((r) => r.key === h.row)
      expect(h.deltaMem).toBe(table?.label.tpot.p90 as number)
      expect(h.separationMin).toBeCloseTo(1 / (1 - h.deltaSep.p90), 15)
      expect(h.deltaSep.n).toBe(fr.pairs[h.row].length)
    }
    expect(fr.h1.map((h) => h.deltaSep.n)).toEqual([92, 176])
    // one replay per (shape, c): three shapes × concurrency 4, 16, 64
    expect(fr.replays.map((r) => `${r.isl}/${r.osl}:${r.conc}`)).toEqual(['1024/1024:4', '1024/1024:16', '1024/1024:64', '1024/8192:4', '1024/8192:16', '1024/8192:64', '8192/1024:4', '8192/1024:16', '8192/1024:64'])
    for (const r of fr.replays) expect(r.seed).toBe(hash32(r.seedText))
    // rule 1 counts distinct answer codes, not classes
    expect(fr.figures.distinctAnswers).toEqual([...new Set(fr.classes.map((k) => k.answer))].sort((x, y) => x - y))
    const r1 = fr.kill.find((k) => k.rule === '1')
    expect(r1?.trips).toBe(fr.figures.distinctAnswers.length < protocol.frontier.classesMin)
    expect(fr.killed).toBe(fr.kill.some((k) => k.trips))
    // every kept interval is at least the width rule wide
    for (const k of fr.classes) for (const i of k.intervals) expect(i.to - i.from).toBeGreaterThanOrEqual(protocol.frontier.classWidthMin - 1e-9)
  })

  test('the claims it reproduces are registered, and their boundaries carry its counts', () => {
    expect(Object.keys(decisions.claimValues).sort()).toEqual(decisionClaimIds(decisions.frontier.rows))
    for (const [id, v] of Object.entries(decisions.claimValues)) expect(getClaim(id).value).toBe(v)
    expect(getClaim('phys.h100-vllm-0-10-2-fp8.frontier-sep-p90').boundary).toContain(`${decisions.frontier.h1[0].deltaSep.n} pairs`)
    expect(getClaim('phys.b200-vllm-0-10-2-fp8.frontier-sep-p90').boundary).toContain(`${decisions.frontier.h1[1].deltaSep.n} pairs`)
    const c = decisions.findings.b200CheaperPerToken
    expect(getClaim('phys.finding.b200-cheaper-per-token').boundary).toContain(`${c.scenes.toLocaleString('en-US')} frontier scenes`)
    expect(c.b200Cheaper).toBe(c.scenes)
    const q = decisions.findings.nvfp4TpotGain
    expect(getClaim('phys.finding.nvfp4-tpot-gain').boundary).toContain(`over the ${q.n} configurations`)
    expect(q.cited).toMatchObject({ fp8: '40624', nvfp4: '40085' })
    expect(q.weightBytesRatio).toBeCloseTo(16 / 9, 12)
  })

  test('the TP 2 → 8 finding is the published points, and the napkin divides by TP', () => {
    const t = decisions.findings.tp2ToTp8
    const rows = readExtract(EXTRACT_PATH)
    const at = (id: string) => rows.find((r) => r.id === id)?.mean_tpot as number
    expect([t.from.id, t.to.id]).toEqual(['42017', '41625'])
    expect(t.measured).toBe(at('42017') / at('41625'))
    expect(t.napkin).toBeCloseTo(4, 12)
  })
})

describe('the committed controls (S5-D65)', () => {
  test('hold the seven claims, registered at their values, and the NIM groups the boundaries count', () => {
    expect(controls.generatedBy).toBe(CONTROLS_COMMAND)
    expect(controlsProblems(controls)).toEqual([])
    expect(Object.keys(controls.claimValues).sort()).toEqual([...CONTROL_CLAIMS].sort())
    for (const [id, v] of Object.entries(controls.claimValues)) expect(getClaim(id).value).toBe(v)
    for (const g of controls.nim.groups) expect(getClaim(`phys.nim.${g.key}.itl-mean`).boundary).toContain(`the ${g.n} rows`)
    for (const c of controls.control) {
      expect(c.batchTokens).toBe(131072)
      expect(getClaim(`phys.control.${c.hardware}.loo-tpot-p90`).boundary).toContain(`the ${c.nFit} fit points`)
    }
  })

  test('the NIM rows map to their groups', () => {
    expect(nimFamily('Llama-3.3-70b-instruct')).toBe('70b')
    expect(nimFamily('Llama-3.1-8b-instruct')).toBe('8b')
    expect(nimGroup({ model: 'Llama-3.1-70b-instruct', tp: 4 })).toBe('h100-tp4')
    expect(nimGroup({ model: 'Llama-3.1-8b-instruct', tp: 1 })).toBe('8b-tp1')
  })

  test('a newer snapshot is found, an older one is not', () => {
    const dir = mkdtempSync(join(tmpdir(), 's5-08-'))
    for (const name of ['inferencex-l70-2025-10-28.json', 'inferencex-l70-2026-01-15.json', 'inferencex-l70-2025-10-29.json', 'other.json']) writeFileSync(join(dir, name), '[]')
    expect(newerSnapshots(dir).map((x) => x.date)).toEqual(['2026-01-15'])
    expect(newerSnapshots(EXTRACT_PATH.slice(0, EXTRACT_PATH.lastIndexOf('/')))).toEqual([])
  })
})

describe("S5-08's claims", () => {
  test('twelve phys.* claims: two separation margins, three findings, seven controls, each reproduced by its file', () => {
    const ours = ALL_CLAIMS.filter((c) => /^phys\.(finding|control|nim)\.|\.frontier-sep-p90$/.test(c.id)).map((c) => c.id).sort()
    expect(ours).toEqual([...decisionClaimIds(decisions.frontier.rows), ...CONTROL_CLAIMS].sort())
    for (const id of ours) expect(getClaim(id).kind).toBe('derived')
  })

  test('the AMD peaks (O13): six spec claims, each quoting its product page as fetched', () => {
    const amd = ALL_CLAIMS.filter((c) => /^hw\.mi3[25]5x\./.test(c.id))
    expect(amd.map((c) => c.id).sort()).toEqual(['hw.mi325x.fp8-dense', 'hw.mi325x.hbm-bw', 'hw.mi325x.hbm-capacity', 'hw.mi355x.fp8-dense', 'hw.mi355x.hbm-bw', 'hw.mi355x.hbm-capacity'])
    for (const c of amd) {
      expect(c.kind).toBe('spec')
      expect(c.source?.url).toStartWith('https://www.amd.com/en/products/accelerators/instinct/')
      expect(c.source?.url).toContain(c.id.split('.')[1])
      expect(c.source?.quote?.trim()).toBeTruthy()
      expect(c.source?.row?.trim()).toBeTruthy()
    }
    // each quote carries the registered value in the registered unit (TFLOPS, PFLOPs, TB/s, GB)
    for (const c of amd) expect(c.source?.quote).toContain(String(c.value))
  })
})

test('prettyJson writes JSON that parses back to the value', () => {
  const v = { a: [1, 2.5, { b: 'x"y', c: null }], d: true, e: Array.from({ length: 40 }, (_, i) => i / 7) }
  expect(JSON.parse(prettyJson(v))).toEqual(v)
  expect(JSON.parse(readFileSync(DECISIONS_PATH, 'utf8'))).toEqual(decisions)
})
