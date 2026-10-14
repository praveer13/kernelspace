/**
 * Acts I-III report their numbers as receipt values (docs/specs/wave-3.md §10.1, task 3a-12).
 *
 * Each act's result keeps its display `metrics` and gains `values`, keyed as §10.1 says, holding the numbers the act
 * displays (latencies in iterations). The runs themselves do not change: tests/world/faults.test.ts hashes every act
 * output but `values`, and its hash is the base commit's. Here the values are held to the metrics and headlines
 * they restate, on the practice scenario and on graded seeds.
 */
import { describe, expect, test } from 'bun:test'
import { PRACTICE_SEED } from '../../src/lib/fleet-model'
import {
  ACT1_VALUE_KEYS,
  ACT2_VALUE_KEYS,
  HW_MENU,
  evalAct3,
  gradeAct3Doc,
  gradeMeasurementSubmission,
  runAct1,
  runAct2,
  type ActResult,
  type FleetWeekSeeds,
  type ModuleBytes,
} from '../../src/lib/fleet-week'
import { drawGradedSeeds } from '../../src/lib/graded-seed'

const NO_MODULES: ModuleBytes = { sched: null, mgr: null, queue: null }
const PRACTICE: FleetWeekSeeds = { seed: null, trace: PRACTICE_SEED, faults: 0xfa17, deathPick: 0, deathTick: 400 }
const SEEDS = [PRACTICE, drawGradedSeeds(0x3a12).seeds, drawGradedSeeds(0x3a13).seeds]

/** The number at the start of a metric's display text (`873 iters`, `224/240`, `$7.45`). */
const shown = (r: ActResult, label: string): number => {
  const row = r.metrics.find(([l]) => l === label)
  if (!row) throw new Error(`no metric ${label}`)
  return Number(/-?\d+(?:\.\d+)?/.exec(row[1])![0])
}

describe('Act I values', () => {
  test('hold exactly the §10.1 keys, finite, and equal the numbers the act displays', async () => {
    for (const seeds of SEEDS) {
      const r = await runAct1(NO_MODULES, seeds)
      const v = r.values!
      expect(Object.keys(v).sort()).toEqual([...ACT1_VALUE_KEYS].sort())
      expect(Object.values(v).every(Number.isFinite)).toBe(true)
      expect(r.headline).toBe(`goodput ${v.goodput}% vs reference ${v.refGoodput}%`)
      expect(v.goodput).toBe(shown(r, 'your goodput'))
      expect(v.refGoodput).toBe(shown(r, 'reference goodput'))
      expect(v.completed).toBe(shown(r, 'completed'))
      expect(v.shed).toBe(shown(r, 'shed'))
      expect(v.preempts).toBe(shown(r, 'auto-preempts'))
      expect(v.ttftP95).toBe(shown(r, 'ttft p95'))
      expect(v.tpotP95).toBe(shown(r, 'tpot p95'))
      expect(v.queueP95).toBe(shown(r, 'queue p95'))
      // the display text is the value as written (TPOT at one decimal), so a value cited at the shown precision is the shown text
      expect(r.metrics.find(([l]) => l === 'tpot p95')![1]).toBe(`${v.tpotP95.toFixed(1)} iters`)
    }
  })

  test('the same seed gives the same values', async () => {
    const a = await runAct1(NO_MODULES, SEEDS[1])
    const b = await runAct1(NO_MODULES, SEEDS[1])
    expect(b.values).toEqual(a.values!)
  })
})

describe('Act II values', () => {
  test('hold exactly the §10.1 keys and equal the numbers the act displays', async () => {
    for (const seeds of SEEDS) {
      for (const choice of [{ workers: 2, router: 'rr' }, { workers: 4, router: 'jsq' }] as const) {
        const r = await runAct2(NO_MODULES, choice, seeds)
        const v = r.values!
        expect(Object.keys(v).sort()).toEqual([...ACT2_VALUE_KEYS].sort())
        expect(Object.values(v).every(Number.isFinite)).toBe(true)
        expect(r.headline).toBe(`${v.completedPct}% completed, ${v.goodput}% goodput, ${v.shed} shed (incl. node loss)`)
        expect(v.goodput).toBe(shown(r, 'goodput'))
        expect(v.shed).toBe(shown(r, 'shed (node + intake)'))
        expect(v.ttftP95).toBe(shown(r, 'ttft p95'))
        expect(v.workers).toBe(choice.workers)
      }
    }
  })

  test('lost is the in-flight work the node death took, as its event says, and part of shed', async () => {
    let fired = 0
    for (const seeds of SEEDS) {
      const r = await runAct2(NO_MODULES, { workers: 2, router: 'jsq' }, seeds)
      const event = r.metrics.find(([l, text]) => l === 'event' && text.includes('NODE DEATH'))
      const lost = event ? Number(/lost with (\d+) in-flight/.exec(event[1])![1]) : 0
      if (event) fired++
      expect(r.values!.lost).toBe(lost)
      expect(r.values!.lost).toBeLessThanOrEqual(r.values!.shed)
    }
    expect(fired).toBeGreaterThan(0) // the death fires on these seeds, so `lost` is read on a real loss
  })
})

describe('Act III values', () => {
  test('hold costPerMtok, goodput and meetsSlo for each option, as the evaluation prices them', () => {
    for (const seeds of SEEDS) {
      const e = evalAct3(seeds)
      const keys = HW_MENU.flatMap((o) => [`costPerMtok.${o.id}`, `goodput.${o.id}`, `meetsSlo.${o.id}`])
      expect(Object.keys(e.values).sort()).toEqual(keys.sort())
      for (const o of e.perOption) {
        expect(e.values[`costPerMtok.${o.id}`]).toBe(o.costPerMtok)
        expect(e.values[`goodput.${o.id}`]).toBe(o.goodput)
        expect(e.values[`meetsSlo.${o.id}`]).toBe(o.meetsSlo ? 1 : 0)
      }
    }
  })

  test("the act's verdict carries the evaluation's values, and its metrics are unchanged", () => {
    const e = evalAct3(SEEDS[1])
    const r = gradeAct3Doc('b200', e, { runId: '00000000', checks: [], uncited: [] })
    expect(r.values).toEqual(e.values)
    expect(r.metrics.map(([l]) => l)).toEqual(['your pick', 'simulated $/Mtok', 'cost receipt', 'goodput', 'best value', 'uncited figures', 'graded seed'])
    expect(shown(r, 'simulated $/Mtok')).toBe(e.values['costPerMtok.b200'])
  })
})

describe('the write-up keeps the run values', () => {
  test("Acts I-II's graded submission carries its trace's values", async () => {
    const trace = await runAct1(NO_MODULES, SEEDS[1])
    const r = gradeMeasurementSubmission('engine', trace, { runId: '00000000', checks: [], uncited: [] })
    expect(r.values).toEqual(trace.values!)
  })
})
