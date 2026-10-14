/**
 * Lab 06's race against the reference (docs/specs/wave-3.md §8.3, task 3b-09).
 *
 * The pure parts (who is offered the race, the fleet-run it writes, the histogram) are checked directly. The race itself
 * runs on injected edges: a fake runner for the passing side, which needs a module that plays like the reference and whose
 * source stays private (labs/_solutions is never committed), and a hand-assembled wasm scheduler that admits nothing for the
 * losing side, run through the real Act I engine. The ledger is a real façade on a memory profile, so the claim "RING 0's lab
 * 06 row turns green from labFleetOk" is the fold's and the ring selector's own, not a copy of them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import RaceReference, { BestiaryChart, RacePanel, RaceResult } from '../../src/components/forge/RaceReference'
import { FORGE_LABS } from '../../src/data/labs'
import { RING0_RACE_LABS } from '../../src/lib/economy-table'
import { selectRings } from '../../src/lib/economy'
import { runAct1, type ActResult } from '../../src/lib/fleet-week'
import {
  BESTIARY_JOB,
  BIN_POINTS,
  RACE_BAR_POINTS,
  RACE_LAB,
  bestiaryTable,
  histogramBins,
  placementSentence,
  raceJob,
  raceOffered,
  raceRunResult,
  runRace,
  type RaceDeps,
  type RaceOutcome,
} from '../../src/lib/forge/race'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { drawGradedSeeds } from '../../src/lib/graded-seed'
import { sha256Hex } from '../../src/lib/ledger/stable'
import type { FleetRunResult } from '../../src/lib/ledger/types'
import { BESTIARY, runBestiary, type BestiaryResult, type BestiaryRow } from '../../src/lib/world/bestiary'
import { ringSections } from '../../src/pages/progress/ring-rows'
import { installDom, type DomKit } from '../dom/mini-dom'
import { makeProfile, startTab } from '../ledger/env'

const SLOW = 120_000
const src = join(import.meta.dir, '../../src')
const read = (p: string) => readFileSync(join(src, p), 'utf8')

const lab = FORGE_LABS.find((l) => l.id === RACE_LAB)!
const required = lab.checks.filter((c) => !c.optional).map((c) => c.id)

const row = (id: string, status: CheckResult['status'] = 'pass'): CheckResult => ({ id, label: id, status, msg: '', seed: 7, fresh: true })
/** A green run of lab 06's required checks on fresh seeds (the advanced check fails: it never gates). */
const green = (over: Partial<LabRunReport> = {}): LabRunReport => ({
  lab: RACE_LAB,
  reference: false,
  abi: 2,
  version: 3,
  checks: lab.checks.map((c) => row(c.id, c.optional ? 'fail' : 'pass')),
  seeds: 'fresh',
  ms: 10,
  ...over,
})

/* ------------------- a tiny hand-assembled scheduler module ------------------- */

const uleb = (n: number): number[] => {
  const out: number[] = []
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n !== 0) byte |= 0x80
    out.push(byte)
  } while (n !== 0)
  return out
}
const sleb64 = (value: bigint): number[] => {
  const out: number[] = []
  for (;;) {
    const byte = Number(value & 0x7fn)
    value >>= 7n
    if ((value === 0n && (byte & 0x40) === 0) || (value === -1n && (byte & 0x40) !== 0)) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}
const section = (id: number, body: number[]): number[] => [id, ...uleb(body.length), ...body]
const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()]
const str = (s: string): number[] => [...uleb(s.length), ...new TextEncoder().encode(s)]
const packed = (ptr: number, len: number): number[] => [0x42, ...sleb64((BigInt(ptr) << 32n) | BigInt(len))]

/** A zero-import lab module whose ks_invoke answers "ok" to init and an empty admit/preempt to everything else: a scheduler that never admits. */
function admitNothingModule(): ArrayBuffer {
  const ADMIT_NOTHING = 'admit\npreempt'
  const report = JSON.stringify({ lab: RACE_LAB, version: 3, checks: [{ id: 'c', label: 'c', pass: true, msg: 'ok' }] })
  const ksAlloc = [0x00, 0x41, ...sleb64(4096n), 0x0b]
  const ksFree = [0x00, 0x0b]
  const ksRun = [0x00, ...packed(2048, report.length), 0x0b]
  const ksInvoke = [0x00, 0x20, 0x00, 0x2d, 0x00, 0x00, 0x41, ...sleb64(105n), 0x46, 0x04, 0x7e, ...packed(1024, 2), 0x05, ...packed(1040, ADMIT_NOTHING.length), 0x0b, 0x0b]
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7f, 0x01, 0x7f], [0x60, 0x02, 0x7f, 0x7f, 0x00], [0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e]])),
    ...section(3, vec([[0], [1], [2], [2]])),
    ...section(5, vec([[0x00, 0x01]])),
    ...section(7, vec([[...str('memory'), 0x02, 0x00], [...str('ks_alloc'), 0x00, 0], [...str('ks_free'), 0x00, 1], [...str('ks_run'), 0x00, 2], [...str('ks_invoke'), 0x00, 3]])),
    ...section(10, vec([[...uleb(ksAlloc.length), ...ksAlloc], [...uleb(ksFree.length), ...ksFree], [...uleb(ksRun.length), ...ksRun], [...uleb(ksInvoke.length), ...ksInvoke]])),
    ...section(11, vec([[1024, 'ok'], [1040, ADMIT_NOTHING], [2048, report]].map(([at, text]) => [0x00, 0x41, ...sleb64(BigInt(at as number)), 0x0b, ...str(text as string)]))),
  ]
  return new Uint8Array(bytes).buffer
}

/* ------------------------------ fake edges ------------------------------ */

const ENTROPY = 0x2b21

/** An Act I result as `runAct1` returns it for a component of yours. */
const act1Result = (goodput: number, refGoodput: number, seed: number | null = 0x1234_5678): ActResult => ({
  pass: goodput >= refGoodput - 3,
  score: Math.min(1, goodput / refGoodput),
  headline: `goodput ${goodput}% vs reference ${refGoodput}%`,
  detail: goodput >= refGoodput - 3 ? 'your engine holds the objective function against the reference stack.' : `the gap is the lesson: ${refGoodput - goodput} points.`,
  metrics: [],
  seed,
  run: { goodput, refGoodput, ttftP95: 11 },
})

/** twelve rows with the reference at `ref` and the others spread around it */
const rowsAround = (ref: number): BestiaryRow[] => BESTIARY.map((p, i) => ({ ...p, goodput: i === 0 ? ref : Math.round((ref - 4 * i + 0.4 * i) * 10) / 10 }))

interface Fake {
  deps: RaceDeps
  jobs: { kind: string; entropy: number | undefined; modules?: unknown }[]
  recorded: FleetRunResult[]
}

/** A runner that answers Act I with `race` and the bestiary with `rows`, and keeps what it was asked. */
function fakeDeps(race: ActResult, rows: BestiaryRow[] | Error, opts: { raceError?: Error; recordThrows?: boolean } = {}): Fake {
  const jobs: Fake['jobs'] = []
  const recorded: FleetRunResult[] = []
  const deps: RaceDeps = {
    run: (async (job: { kind: string; modules?: unknown }, onProgress?: (f: number) => void, entropy?: number) => {
      jobs.push({ kind: job.kind, entropy, ...(job.modules ? { modules: job.modules } : {}) })
      onProgress?.(0.5)
      onProgress?.(1)
      if (job.kind === 'act1') {
        if (opts.raceError) throw opts.raceError
        return { result: race, entropy: ENTROPY }
      }
      if (rows instanceof Error) throw rows
      const result: BestiaryResult = { seed: race.seed ?? null, refGoodput: rows[0].goodput, rows }
      return { result, entropy: entropy ?? -1 }
    }) as RaceDeps['run'],
    record: (run) => {
      if (opts.recordThrows) throw new Error('the ledger is read-only')
      recorded.push(run)
    },
    sha256: sha256Hex,
  }
  return { deps, jobs, recorded }
}

/* ------------------------------ who is offered the race ------------------------------ */

describe('who is offered the race', () => {
  test('lab 06 with a module that passed every required check on fresh seeds in this run, credited unseen', () => {
    expect(raceOffered(RACE_LAB, green(), 'unseen')).toBe(true)
    expect(required.length).toBeGreaterThan(0)
  })

  test('no other lab, and no other credit', () => {
    expect(raceOffered('kv-block-manager', green({ lab: 'kv-block-manager' }), 'unseen')).toBe(false)
    for (const credit of ['lab-green', 'assisted', null] as const) expect(raceOffered(RACE_LAB, green(), credit)).toBe(false)
  })

  test('a red required check, a reference build, an ABI 1 module, a stale version or seeds not drawn at grade time: no race', () => {
    expect(raceOffered(RACE_LAB, green({ checks: green().checks.map((c) => (c.id === required[0] ? { ...c, status: 'fail' as const } : c)) }), 'unseen')).toBe(false)
    expect(raceOffered(RACE_LAB, green({ reference: true }), 'unseen')).toBe(false)
    expect(raceOffered(RACE_LAB, green({ abi: 1 }), 'unseen')).toBe(false)
    expect(raceOffered(RACE_LAB, green({ version: 2 }), 'unseen')).toBe(false)
    expect(raceOffered(RACE_LAB, green({ seeds: 'default' }), 'unseen')).toBe(false)
  })

  test('the component renders nothing for a lab that is not offered, and the panel for lab 06', () => {
    const bytes = new ArrayBuffer(4)
    const other = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
    expect(renderToStaticMarkup(createElement(RaceReference, { lab: other, bytes, report: green({ lab: other.id }), credit: 'unseen' }))).toBe('')
    expect(renderToStaticMarkup(createElement(RaceReference, { lab, bytes, report: green(), credit: 'lab-green' }))).toBe('')
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RaceReference, { lab, bytes, report: green(), credit: 'unseen' })))
    expect(html).toContain('data-testid="race-panel"')
    expect(html).toContain('race the reference')
    expect(html).toContain('install it and open the real-engine panel')
  })

  test('RING0_RACE_LABS lists lab 06 (D25): the race exists, so RING 0 needs it', () => {
    expect(RING0_RACE_LABS).toEqual([RACE_LAB])
    expect(RACE_BAR_POINTS).toBe(3)
  })
})

/* ------------------------------ the job and the event ------------------------------ */

describe('the race is Act I with only your scheduler; its event is one engine component', () => {
  test('raceJob puts the bytes in the scheduler slot and nothing else; the bestiary job carries no bytes', () => {
    const bytes = new ArrayBuffer(8)
    expect(raceJob(bytes)).toEqual({ kind: 'act1', modules: { sched: bytes, mgr: null, queue: null } })
    expect(BESTIARY_JOB).toEqual({ kind: 'bestiary' })
  })

  test('raceRunResult: mode engine, one scheduler component from batching-scheduler, fresh seeds, the run numbers and the seed', () => {
    const sha = 'ab'.repeat(32)
    expect(raceRunResult(act1Result(43.8, 42.9), sha)).toEqual({
      seed: 0x1234_5678,
      data: { v: 1, mode: 'engine', components: [{ slot: 'scheduler', labId: RACE_LAB, sha256: sha }], seeds: 'fresh', goodput: 43.8, refGoodput: 42.9, ttftP95: 11 },
    })
  })

  test('no numbers, or no graded seed (the practice scenario): nothing to record', () => {
    expect(raceRunResult({ ...act1Result(40, 42), run: undefined }, 'a'.repeat(64))).toBeNull()
    expect(raceRunResult(act1Result(40, 42, null), 'a'.repeat(64))).toBeNull()
  })
})

/* ------------------------------ the race ------------------------------ */

describe('runRace', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer

  test('Act I with your scheduler first, then the bestiary on the SAME entropy; one fleet-run written', async () => {
    const f = fakeDeps(act1Result(43.8, 42.9), rowsAround(42.9))
    const seen: number[] = []
    const out = await runRace(bytes, f.deps, (x) => seen.push(x))
    expect(f.jobs.map((j) => j.kind)).toEqual(['act1', 'bestiary'])
    expect(f.jobs[0].entropy).toBeUndefined() // a fresh draw: runSimWithEntropy draws it
    expect(f.jobs[0].modules).toEqual({ sched: bytes, mgr: null, queue: null })
    expect(f.jobs[1].entropy).toBe(ENTROPY) // the entropy the race ran on
    expect(f.recorded).toHaveLength(1)
    expect(f.recorded[0].data).toMatchObject({ mode: 'engine', seeds: 'fresh', goodput: 43.8, refGoodput: 42.9, components: [{ slot: 'scheduler', labId: RACE_LAB, sha256: await sha256Hex(bytes) }] })
    expect(out).toMatchObject({ goodput: 43.8, refGoodput: 42.9, within: true, seed: 0x1234_5678, entropy: ENTROPY, recorded: true, bestiaryError: null })
    expect(out.bestiary?.rows).toHaveLength(12)
    // progress only goes up and ends at 1
    expect(seen.every((x, i) => i === 0 || x >= seen[i - 1])).toBe(true)
    expect(seen.at(-1)).toBe(1)
  })

  test('within 3 points is the fold’s rule: 3.0 behind is within, 3.1 behind is not', async () => {
    expect((await runRace(bytes, fakeDeps(act1Result(39.9, 42.9), rowsAround(42.9)).deps)).within).toBe(true)
    expect((await runRace(bytes, fakeDeps(act1Result(39.8, 42.9), rowsAround(42.9)).deps)).within).toBe(false)
  })

  test('a race that misses is still recorded (the ledger keeps the attempt), and says so', async () => {
    const f = fakeDeps(act1Result(30, 43), rowsAround(43))
    const out = await runRace(bytes, f.deps)
    expect(out.within).toBe(false)
    expect(f.recorded).toHaveLength(1)
    expect(out.detail).toContain('the gap is the lesson')
  })

  test('a bestiary that fails leaves the race standing, with the reason', async () => {
    const f = fakeDeps(act1Result(43.8, 42.9), new Error('the simulation was still running after 10 s'))
    const out = await runRace(bytes, f.deps)
    expect(out.recorded).toBe(true)
    expect(out.bestiary).toBeNull()
    expect(out.bestiaryError).toContain('still running')
    expect(f.recorded).toHaveLength(1)
  })

  test('a ledger that refuses the event leaves the race and the bestiary on screen, unrecorded', async () => {
    const f = fakeDeps(act1Result(43.8, 42.9), rowsAround(42.9), { recordThrows: true })
    const out = await runRace(bytes, f.deps)
    expect(out.recorded).toBe(false)
    expect(out.bestiary).not.toBeNull()
  })

  test('a module that traps or spins rejects before anything is recorded or the bestiary runs', async () => {
    const f = fakeDeps(act1Result(43.8, 42.9), rowsAround(42.9), { raceError: new Error('unreachable executed') })
    await expect(runRace(bytes, f.deps)).rejects.toThrow('unreachable executed')
    expect(f.recorded).toEqual([])
    expect(f.jobs.map((j) => j.kind)).toEqual(['act1'])
  })
})

/* ------------------------------ RING 0 turns green from labFleetOk ------------------------------ */

describe('the ledger: an unseen engine run with only your scheduler within 3 points sets labFleetOk, and RING 0’s lab 06 row turns green', () => {
  const bytes = new Uint8Array([9, 9, 9]).buffer
  /** Deps whose Act I result is `result`, writing to `store`'s ledger. */
  const withResult = (result: ActResult, store: ReturnType<typeof startTab>['progress']): RaceDeps => ({
    ...fakeDeps(result, rowsAround(result.run?.refGoodput ?? 40)).deps,
    record: (run) => store.getState().recordFleetRun(run),
  })

  const raceRow = (store: ReturnType<typeof startTab>['progress']) =>
    ringSections(selectRings(store.getState().aggregate), true)
      .find((s) => s.ring === 'RING 0')!
      .rows.find((r) => r.key === 'race')

  test('before the race the row is there (the list is live) and open, pointing at the lab', () => {
    const store = startTab(makeProfile()).progress
    expect(selectRings(store.getState().aggregate).ring0.race).toEqual({ done: 0, total: 1, missing: [RACE_LAB] })
    expect(raceRow(store)).toMatchObject({ done: false, to: '/forge/batching-scheduler', action: 'race the reference' })
  })

  test('within 3 points: labFleetOk, an unseen engine run, and a green row', async () => {
    const store = startTab(makeProfile()).progress
    await runRace(bytes, withResult(act1Result(41.7, 43.8), store))
    const agg = store.getState().aggregate
    expect(agg.labFleetOk).toEqual({ [RACE_LAB]: true })
    expect(agg.fleetRuns.engine).toMatchObject({ own: true, unseenOk: true })
    expect(selectRings(agg).ring0.race).toEqual({ done: 1, total: 1, missing: [] })
    expect(raceRow(store)).toMatchObject({ done: true, count: '1/1', action: 'open' })
  })

  test('outside the bar: the run is in the ledger, labFleetOk is not, and the row stays open', async () => {
    const store = startTab(makeProfile()).progress
    await runRace(bytes, withResult(act1Result(30, 43.8), store))
    const agg = store.getState().aggregate
    expect(agg.fleetRuns.engine).toMatchObject({ own: true })
    expect(agg.fleetRuns.engine?.unseenOk).toBeUndefined()
    expect(agg.labFleetOk).toEqual({})
    expect(raceRow(store)).toMatchObject({ done: false })
  })

  test('a miss does not undo a pass: labFleetOk stays once earned', async () => {
    const store = startTab(makeProfile()).progress
    await runRace(bytes, withResult(act1Result(41.7, 43.8), store))
    await runRace(bytes, withResult(act1Result(20, 43.8), store))
    expect(store.getState().aggregate.labFleetOk).toEqual({ [RACE_LAB]: true })
  })
})

/* ------------------------------ a fake scheduler module on the real Act I ------------------------------ */

describe('a fake scheduler module raced on the real Act I engine and the real bestiary', () => {
  test('it loses to the reference, is recorded with its real hash, and the bestiary runs on the same graded seed', async () => {
    const module = admitNothingModule()
    const store = startTab(makeProfile()).progress
    const deps: RaceDeps = {
      // the worker's run(): the graded seeds come from the entropy, exactly as in sim.worker
      run: (async (job: { kind: string; modules?: Parameters<typeof runAct1>[0] }, onProgress?: (f: number) => void, entropy = ENTROPY) => {
        const { seeds } = drawGradedSeeds(entropy)
        const result = job.kind === 'act1' ? await runAct1(job.modules!, seeds, onProgress) : runBestiary(seeds, onProgress)
        return { result, entropy }
      }) as RaceDeps['run'],
      record: (run) => store.getState().recordFleetRun(run),
      sha256: sha256Hex,
    }
    const out = await runRace(module, deps)
    expect(out.within).toBe(false)
    expect(out.goodput).toBeLessThan(out.refGoodput - RACE_BAR_POINTS)
    expect(out.recorded).toBe(true)
    expect(out.seed).toBe(drawGradedSeeds(ENTROPY).seeds.seed)
    // the bestiary's reference is the race's reference: the same trace
    expect(out.bestiary?.refGoodput).toBe(out.refGoodput)
    expect(out.bestiary?.seed).toBe(out.seed)
    expect(out.bestiary?.rows.map((r) => r.id)).toEqual(BESTIARY.map((p) => p.id))
    const agg = store.getState().aggregate
    expect(agg.fleetRuns.engine).toMatchObject({ own: true })
    expect(agg.labFleetOk).toEqual({})
    // placed below every policy that does anything: a scheduler that admits nothing meets no SLO
    expect(placementSentence(out.goodput, out.bestiary!.rows)).toContain('below')
  }, SLOW)
})

/* ------------------------------ the histogram and the sentence ------------------------------ */

describe('the bestiary histogram and where you fall', () => {
  const rows = rowsAround(44)

  test('bins are 5 points wide, cover the twelve and yours, and each policy is in exactly one', () => {
    for (const mine of [3, 44, 47.5, 60]) {
      const bins = histogramBins(rows, mine)
      expect(bins.every((b) => b.hi - b.lo === BIN_POINTS)).toBe(true)
      expect(bins.every((b, i) => i === 0 || b.lo === bins[i - 1].hi)).toBe(true)
      expect(bins.reduce((n, b) => n + b.rows.length, 0)).toBe(12)
      expect(bins.filter((b) => b.mine)).toHaveLength(1)
      const home = bins.find((b) => b.mine)!
      expect(mine >= home.lo && mine < home.hi).toBe(true)
      for (const b of bins) for (const r of b.rows) expect(r.goodput >= b.lo && r.goodput < b.hi).toBe(true)
    }
  })

  test('a goodput on a bin edge falls in the upper bin', () => {
    const bins = histogramBins(rowsAround(44), 45)
    expect(bins.find((b) => b.mine)).toMatchObject({ lo: 45, hi: 50 })
  })

  test('the sentence says above, below and level in counts that add to twelve', () => {
    const g = rows.map((r) => r.goodput)
    expect(placementSentence(Math.max(...g) + 1, rows)).toBe(`Your ${Math.max(...g) + 1}% is above all 12 policies.`)
    expect(placementSentence(Math.min(...g) - 1, rows)).toBe(`Your ${Math.min(...g) - 1}% is below all 12 policies.`)
    const mid = [...g].sort((a, b) => a - b)[5] + 0.1
    expect(placementSentence(mid, rows)).toBe(`Your ${mid}% is above 6 of the 12 policies, below 6.`)
    expect(placementSentence(44, rows)).toBe('Your 44% is above 11 of the 12 policies, level with 1, below 0.')
  })

  test('the mirror table lists the twelve and you, best first, each with its dials and goodput', () => {
    const t = bestiaryTable(45.2, rows)
    expect(t.columns).toEqual(['Policy', 'Dials', 'Goodput (%)'])
    expect(t.rows).toHaveLength(13)
    expect(t.rows[0][0]).toBe('your scheduler')
    expect(t.rows.map((r) => Number(r[2]))).toEqual([...t.rows.map((r) => Number(r[2]))].sort((a, b) => b - a))
    expect(t.rows.find((r) => String(r[0]).startsWith('1. '))?.[1]).toBe('sjf · guard 2000 · headroom 48 · no preempt')
    expect(t.announce).toBe(placementSentence(45.2, rows))
  })

  test('the chart is a labelled image described by the table, with one mark per policy and one for you', () => {
    const html = renderToStaticMarkup(createElement(BestiaryChart, { goodput: 45.2, rows, label: 'a chart', describedBy: 'tbl' }))
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="a chart"')
    expect(html).toContain('aria-describedby="tbl"')
    expect(html.match(/<circle/g)).toHaveLength(12)
    expect(html).toContain('>you<')
  })
})

/* ------------------------------ the page ------------------------------ */

describe('RaceResult and the panel', () => {
  const rows = rowsAround(44)
  const outcome = (over: Partial<RaceOutcome> = {}): RaceOutcome => ({
    goodput: 45.2, refGoodput: 44, within: true, seed: 0xabcdef12, entropy: ENTROPY, recorded: true, detail: 'd', bestiary: { seed: 0xabcdef12, refGoodput: 44, rows }, bestiaryError: null, ...over,
  })
  const html = (o: RaceOutcome) => renderToStaticMarkup(createElement(RaceResult, { outcome: o }))

  test('a win says within 3 points, the numbers, the seed and that RING 0 counts it', () => {
    const h = html(outcome())
    expect(h).toContain('WITHIN 3 POINTS')
    expect(h).toContain('goodput 45.2% vs reference 44%')
    expect(h).toContain('0xabcdef12')
    expect(h).toContain('RING 0 counts it')
    expect(h).toContain('matched or beat the reference')
  })

  test('a narrow miss inside the bar says how far behind; a real miss says the act’s own gap line', () => {
    expect(html(outcome({ goodput: 41.7, refGoodput: 43.8 }))).toContain('2.1 points behind the reference, inside the 3-point bar')
    const miss = html(outcome({ goodput: 30, refGoodput: 44, within: false, detail: 'the gap is the lesson: 14 points.' }))
    expect(miss).toContain('NOT YET')
    expect(miss).toContain('the gap is the lesson: 14 points.')
    expect(miss).toContain('outside the bar')
    expect(miss).not.toContain('RING 0 counts it')
  })

  test('the bestiary is labelled as Compose dials, not production schedulers, and has its table', () => {
    const h = html(outcome())
    expect(h).toContain('twelve policies from the Compose dials')
    expect(h).toContain('They are not production schedulers')
    expect(h).toContain('Show data table')
    expect(h).toContain('role="img"')
  })

  test('without a bestiary the race still shows, and the reason does', () => {
    const h = html(outcome({ bestiary: null, bestiaryError: 'the worker crashed' }))
    expect(h).toContain('WITHIN 3 POINTS')
    expect(h).toContain('did not run: the worker crashed')
    expect(h).not.toContain('data-testid="bestiary"')
  })

  test('an unrecorded run says so', () => {
    expect(html(outcome({ recorded: false }))).toContain('not recorded')
  })
})

describe('pressing the button in the small DOM', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(async () => {
    await dom.uninstall()
  })

  const bytes = new Uint8Array([5, 6, 7]).buffer
  const panel = (deps: RaceDeps) => createElement(MemoryRouter, null, createElement(RacePanel, { lab, bytes, report: green(), credit: 'unseen', deps }))
  const button = (page: { container: { querySelectorAll(sel: string): { textContent: string; disabled?: boolean }[] } }, label: string) => page.container.querySelectorAll('button').find((b) => b.textContent.includes(label))

  test('race the reference runs both jobs, shows the verdict and the chart, and offers a second race', async () => {
    const f = fakeDeps(act1Result(43.8, 42.9), rowsAround(42.9))
    const page = await dom.mount(panel(f.deps))
    expect(page.container.querySelector('[data-testid="race-result"]')).toBeNull()
    await dom.press(page.container.querySelectorAll('button').find((b) => b.textContent.includes('race the reference'))!)
    await dom.until(() => page.container.querySelector('[data-testid="race-result"]') !== null)
    expect(f.jobs.map((j) => j.kind)).toEqual(['act1', 'bestiary'])
    const text = page.container.textContent
    expect(text).toContain('WITHIN 3 POINTS')
    expect(text).toContain('goodput 43.8% vs reference 42.9%')
    expect(page.container.querySelector('svg[role="img"]')).not.toBeNull()
    expect(page.container.querySelectorAll('button').some((b) => b.textContent.includes('race again on a new seed'))).toBe(true)
    // the live region carries the verdict for a screen reader
    expect(page.container.querySelector('#race-status')!.textContent).toContain('WITHIN 3 POINTS')
    await page.unmount()
  })

  test('a module that traps shows the worker’s message in an alert and can race again', async () => {
    const f = fakeDeps(act1Result(43.8, 42.9), rowsAround(42.9), { raceError: new Error('unreachable executed') })
    const page = await dom.mount(panel(f.deps))
    await dom.press(page.container.querySelectorAll('button').find((b) => b.textContent.includes('race the reference'))!)
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)
    expect(page.container.querySelector('[role="alert"]')!.textContent).toBe('execution failed: unreachable executed. Fix the cause and race again.')
    expect(button(page, 'race the reference')?.disabled).toBeFalsy()
    await page.unmount()
  })
})

/* ------------------------------ the mounts ------------------------------ */

describe('ForgeLab mounts it, the sim worker answers it and Fleet opens on it', () => {
  test('ForgeLab hands RaceReference the run values and nothing else (the stub’s props held)', () => {
    expect(read('pages/ForgeLab.tsx')).toContain('<RaceReference lab={lab} bytes={run.bytes} report={run.report} credit={run.credit} />')
  })

  test('the sim worker answers a bestiary job from the same entropy-drawn seeds, and receipts keep their act-only job type', () => {
    const worker = read('workers/sim.worker.ts')
    expect(worker).toMatch(/const \{ seeds \} = drawGradedSeeds\(entropy\)[\s\S]*case 'bestiary':\s*return runBestiary\(seeds, onProgress\)/)
    const protocol = read('workers/sim-protocol.ts')
    expect(protocol).toMatch(/export type SimJob =\s*\| \{ kind: 'act1'[\s\S]*?\| \{ kind: 'act3' \}\n/)
    expect(protocol).toContain("export type SimRequestJob = SimJob | BestiaryJob")
  })

  test('the link goes to the real-engine panel and Fleet reads it', () => {
    expect(read('components/forge/RaceReference.tsx')).toContain("navigate('/fleet?mode=real')")
    expect(read('pages/Fleet.tsx')).toMatch(/params\.get\('mode'\)[\s\S]*asked === 'real'/)
  })
})
