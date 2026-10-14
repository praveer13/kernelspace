/**
 * Act I requires one of your components (docs/specs/wave-2.md §10.6, task 2b-21).
 *
 * `runAct1` passes only when the scheduler, the block manager or the intake queue is the learner's; an all-reference
 * run is practice and says how to install one. Acts I and II write a `fleet-run` event (`fleet:act1`, `fleet:act2`)
 * when a component of yours took part, and none otherwise. The modules here are hand-assembled wasm (no private
 * solution is committed): a scheduler that admits nothing is a component of yours that loses to the reference, and
 * the passing side is tested on the verdict and on the events with the numbers a passing run reports.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PRACTICE_SEED } from '../../src/lib/fleet-model'
import {
  INSTALL_HINT,
  act1Verdict,
  fleetRunFor,
  ownKindsOf,
  recordActRun,
  referenceFleet,
  runAct1,
  runAct2,
  runComponents,
  type ActResult,
  type FleetWeekSeeds,
  type ModuleBytes,
} from '../../src/lib/fleet-week'
import { drawGradedSeeds } from '../../src/lib/graded-seed'
import { sha256Hex } from '../../src/lib/ledger/stable'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = path.join(import.meta.dir, '../..')
const SLOW = 120_000

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

const INIT_OK_AT = 1024
const ADMIT_NOTHING_AT = 1040
const REPORT_AT = 2048
const ADMIT_NOTHING = 'admit\npreempt'

/** A zero-import lab module whose ks_invoke answers "ok" to init and an empty admit/preempt to everything else: a scheduler that never admits. */
function admitNothingModule(): ArrayBuffer {
  const report = JSON.stringify({ lab: 'batching-scheduler', version: 3, checks: [{ id: 'c', label: 'c', pass: true, msg: 'ok' }] })
  const ksAlloc = [0x00, 0x41, ...sleb64(4096n), 0x0b]
  const ksFree = [0x00, 0x0b]
  const ksRun = [0x00, ...packed(REPORT_AT, report.length), 0x0b]
  const ksInvoke = [
    0x00,
    0x20, 0x00, 0x2d, 0x00, 0x00, // local.get 0; i32.load8_u
    0x41, ...sleb64(105n), 0x46, // i32.const 'i'; i32.eq
    0x04, 0x7e, // if (result i64)
    ...packed(INIT_OK_AT, 2),
    0x05, // else
    ...packed(ADMIT_NOTHING_AT, ADMIT_NOTHING.length),
    0x0b,
    0x0b,
  ]
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7f, 0x01, 0x7f], [0x60, 0x02, 0x7f, 0x7f, 0x00], [0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e]])),
    ...section(3, vec([[0], [1], [2], [2]])),
    ...section(5, vec([[0x00, 0x01]])),
    ...section(7, vec([[...str('memory'), 0x02, 0x00], [...str('ks_alloc'), 0x00, 0], [...str('ks_free'), 0x00, 1], [...str('ks_run'), 0x00, 2], [...str('ks_invoke'), 0x00, 3]])),
    ...section(10, vec([[...uleb(ksAlloc.length), ...ksAlloc], [...uleb(ksFree.length), ...ksFree], [...uleb(ksRun.length), ...ksRun], [...uleb(ksInvoke.length), ...ksInvoke]])),
    ...section(
      11,
      vec(
        [
          [INIT_OK_AT, 'ok'],
          [ADMIT_NOTHING_AT, ADMIT_NOTHING],
          [REPORT_AT, report],
        ].map(([at, text]) => [0x00, 0x41, ...sleb64(BigInt(at as number)), 0x0b, ...str(text as string)]),
      ),
    ),
  ]
  return new Uint8Array(bytes).buffer
}

const NO_MODULES: ModuleBytes = { sched: null, mgr: null, queue: null }
const PRACTICE: FleetWeekSeeds = { seed: null, trace: PRACTICE_SEED, faults: 0xfa17, deathPick: 0, deathTick: 400 }
const GRADED = drawGradedSeeds(0x2b21).seeds

const SHA = 'a'.repeat(64)
const part = { slot: 'scheduler', labId: 'batching-scheduler', sha256: SHA } as const

/** What a run that took part in the ledger looks like, from numbers a passing run reports. */
const ran = (over: Partial<ActResult> = {}): ActResult => ({
  pass: true,
  score: 1,
  headline: 'h',
  detail: 'd',
  metrics: [],
  seed: 0x1234_5678,
  run: { goodput: 42, refGoodput: 42.5, ttftP95: 12 },
  ...over,
})

/* ------------------------------------------------------------------ */
/* The verdict                                                          */
/* ------------------------------------------------------------------ */

describe('Act I passes only with a component of yours in the engine', () => {
  test('an all-reference run never passes, however close it is, and says how to install a component', () => {
    for (const [mine, ref] of [[41.3, 41.3], [60, 41.3], [0, 0]] as const) {
      const v = act1Verdict(mine, ref, false)
      expect(v.pass).toBe(false)
      expect(v.detail).toBe(INSTALL_HINT)
    }
    expect(INSTALL_HINT).toMatch(/^practice: install one of your components to pass Act I/)
    expect(INSTALL_HINT).toContain('Install in your engine')
    expect(INSTALL_HINT).toContain('Fleet page')
  })

  test('with a component of yours the bar is the old one: within 3 points of the reference', () => {
    expect(act1Verdict(41.3, 41.3, true).pass).toBe(true)
    expect(act1Verdict(38.3, 41.3, true).pass).toBe(true)
    expect(act1Verdict(38.2, 41.3, true).pass).toBe(false)
    expect(act1Verdict(38.2, 41.3, true).detail).toContain('the gap is the lesson')
    expect(act1Verdict(50, 41.3, true).detail).toContain('holds the objective function')
  })

  test('ownKindsOf names the slots of yours in a run, and an empty run has none', () => {
    const bytes = admitNothingModule()
    expect(ownKindsOf(NO_MODULES)).toEqual([])
    expect(ownKindsOf({ ...NO_MODULES, queue: bytes })).toEqual(['queue'])
    expect(ownKindsOf({ sched: bytes, mgr: bytes, queue: null })).toEqual(['sched', 'mgr'])
  })
})

describe('runAct1 on the reference and on a component of yours', () => {
  test('an all-reference run is practice: it ties the reference, does not pass, carries no run and says how to install', async () => {
    for (const seeds of [PRACTICE, GRADED]) {
      const r = await runAct1(NO_MODULES, seeds)
      expect(r.pass).toBe(false)
      expect(r.practice).toBe(true)
      expect(r.run).toBeUndefined()
      expect(r.detail).toBe(INSTALL_HINT)
      const [mine, ref] = /goodput ([\d.]+)% vs reference ([\d.]+)%/.exec(r.headline)!.slice(1)
      expect(mine).toBe(ref) // the reference ties itself: the gap was never the point
      expect(r.seed).toBe(seeds.seed)
    }
  }, SLOW)

  test('a component of yours is a counted run: it carries its numbers, is not practice, and a loss reads as the gap', async () => {
    const r = await runAct1({ ...NO_MODULES, sched: admitNothingModule() }, GRADED)
    expect(r.practice).toBeUndefined()
    expect(r.run).toBeDefined()
    expect(r.run!.goodput).toBeLessThan(r.run!.refGoodput - 3)
    expect(r.pass).toBe(false)
    expect(r.detail).toContain('the gap is the lesson')
    expect(r.detail).not.toBe(INSTALL_HINT)
    expect(r.headline).toBe(`goodput ${r.run!.goodput}% vs reference ${r.run!.refGoodput}%`)
  }, SLOW)
})

/* ------------------------------------------------------------------ */
/* The fleet-run events                                                 */
/* ------------------------------------------------------------------ */

describe('Acts I and II write a fleet-run event when a component of yours took part', () => {
  test('the event is fleet:<mode> with the run numbers, fresh seeds and the modules that ran', () => {
    const run = fleetRunFor('act1', ran(), [part])
    expect(run).toEqual({
      seed: 0x1234_5678,
      data: { v: 1, mode: 'act1', components: [part], seeds: 'fresh', goodput: 42, refGoodput: 42.5, ttftP95: 12 },
    })
    expect(fleetRunFor('act2', ran(), [part])!.data.mode).toBe('act2')
    // the fixed practice scenario is `practice` and carries no seed
    const practice = fleetRunFor('act1', ran({ seed: null }), [part])!
    expect(practice.data.seeds).toBe('practice')
    expect('seed' in practice).toBe(false)
    // no ttft to report, none written
    expect('ttftP95' in fleetRunFor('act1', ran({ run: { goodput: 1, refGoodput: 1 } }), [part])!.data).toBe(false)
  })

  test('an all-reference run, a run without numbers and a run with no modules write nothing', () => {
    expect(fleetRunFor('act1', ran({ run: undefined, practice: true }), [part])).toBeNull()
    expect(fleetRunFor('act1', ran(), [])).toBeNull()
    const store = startTab(makeProfile()).progress
    expect(recordActRun(store, 'act1', ran({ run: undefined }), [part])).toBe(false)
    expect(recordActRun(store, 'act2', ran(), [])).toBe(false)
    expect(store.getState().aggregate.fleetRuns).toEqual({})
  })

  test('the ledger holds fleet:act1 and fleet:act2: unseenOk only from an ok run on seeds drawn at run time', () => {
    const store = startTab(makeProfile()).progress
    // a miss on a fresh seed: recorded, not ok
    expect(recordActRun(store, 'act1', ran({ run: { goodput: 20, refGoodput: 42 } }), [part])).toBe(true)
    expect(store.getState().aggregate.fleetRuns.act1).toMatchObject({ own: true })
    expect(store.getState().aggregate.fleetRuns.act1?.unseenOk).toBeUndefined()
    // an ok run on the fixed practice scenario: ok, but not unseen
    expect(recordActRun(store, 'act1', ran({ seed: null }), [part])).toBe(true)
    expect(store.getState().aggregate.fleetRuns.act1?.unseenOk).toBeUndefined()
    // an ok run on a fresh seed
    expect(recordActRun(store, 'act1', ran(), [part])).toBe(true)
    expect(store.getState().aggregate.fleetRuns.act1).toMatchObject({ own: true, unseenOk: true })
    // Act II is its own mode
    expect(store.getState().aggregate.fleetRuns.act2).toBeUndefined()
    expect(recordActRun(store, 'act2', ran(), [part])).toBe(true)
    expect(store.getState().aggregate.fleetRuns.act2).toMatchObject({ own: true, unseenOk: true })
    expect(Object.keys(store.getState().aggregate.fleetRuns).sort()).toEqual(['act1', 'act2'])
  })

  test('runComponents names each module by slot, lab and the hash of the bytes that ran', async () => {
    const sched = admitNothingModule()
    const queue = new Uint8Array([1, 2, 3]).buffer
    const parts = await runComponents({ sched: { bytes: sched, lab: 'batching-scheduler' }, mgr: null, queue: { bytes: queue, lab: 'mpmc-queue' } })
    expect(parts).toEqual([
      { slot: 'scheduler', labId: 'batching-scheduler', sha256: await sha256Hex(sched) },
      { slot: 'intake', labId: 'mpmc-queue', sha256: await sha256Hex(queue) },
    ])
    expect(await runComponents({ sched: null, mgr: null, queue: null })).toEqual([])
  })
})

describe('Act II with a component of yours compares with the reference fleet on the same topology', () => {
  test('an all-reference run carries no run; with a module the numbers come with the reference fleet\'s goodput', async () => {
    const choice = { workers: 2, router: 'rr' } as const
    const plain = await runAct2(NO_MODULES, choice, GRADED)
    expect(plain.run).toBeUndefined()
    expect(plain.practice).toBeUndefined()
    const mine = await runAct2({ ...NO_MODULES, sched: admitNothingModule() }, choice, GRADED)
    expect(mine.run).toBeDefined()
    // the comparator is the all-reference fleet with the same workers, router, seed and faults
    expect(mine.run!.refGoodput).toBe(referenceFleet(GRADED, 2, 'rr').goodput)
    expect(mine.run!.goodput).toBeLessThan(mine.run!.refGoodput)
    expect(mine.headline).not.toBe(plain.headline)
  }, SLOW)

  test('the reference fleet defaults to join-shortest-queue, as it always did', () => {
    expect(referenceFleet(GRADED, 2)).toEqual(referenceFleet(GRADED, 2, 'jsq'))
  })
})

/* ------------------------------------------------------------------ */
/* The page records through the same functions                          */
/* ------------------------------------------------------------------ */

describe('/week records the runs', () => {
  const page = readFileSync(path.join(ROOT, 'src/pages/FleetWeek.tsx'), 'utf8')

  // 3b-05: an all-reference run is still recorded for receipts (a receipt check needs no pass), but its write-up cannot be submitted
  test('Act I and Act II record fleet-run after their trace, and an all-reference Act I cannot submit its write-up', () => {
    expect(page).toContain("recordRun('act1', run.result, slots)")
    expect(page).toContain("recordRun('act2', run.result, slots)")
    expect(page).toContain('blocked={trace.pass ? null : trace.practice ?')
    expect(page).toContain('data-install-hint')
  })
})
