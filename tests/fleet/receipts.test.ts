/**
 * The receipts engine (docs/specs/wave-3.md §10.2-10.3, D14, W16; task 3a-12).
 *
 * A run record keeps a Fleet Week run's act, its job with module bytes replaced by {slot, sha256}, the entropy and the
 * values; its id is the first 8 hex of the sha256 of all that. A receipt token cites one value of one record. Checking
 * re-runs each cited record once, on the same entropy with the same module bytes, and verifies a cited value when it
 * equals the re-run value rounded to the decimals written. Here the re-run is the act itself, in process (the page's
 * runner is the sim worker, which runs the same functions on the same graded seeds), and the components store is a map.
 *
 * The modules are hand-assembled wasm (no private solution is committed): a scheduler that admits nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  ACT_JOB,
  MAX_RUN_RECORDS,
  citeToken,
  citedMatches,
  parseReceipts,
  rebuildJob,
  receiptCounts,
  roundCited,
  runRecord,
  runRecordId,
  uncitedFigures,
  valuesOf,
  verifyReceipts,
  withRunRecord,
  type ReceiptRunner,
} from '../../src/lib/fleet-receipts'
import { evalAct3, runAct1, runAct2, type ModuleBytes } from '../../src/lib/fleet-week'
import { drawGradedSeeds } from '../../src/lib/graded-seed'
import { validateWorkingRecord } from '../../src/lib/ledger/codec'
import { sha256Hex, stableStringify } from '../../src/lib/ledger/stable'
import type { RunRecord } from '../../src/lib/ledger/types'
import type { SimJob, SimResults } from '../../src/workers/sim-protocol'

const AT = '2026-10-14T09:00:00.000Z'
const E1 = 0x3a12
const E2 = 0x3a14
const NO_MODULES: ModuleBytes = { sched: null, mgr: null, queue: null }

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

/** A zero-import lab module whose ks_invoke answers "ok" to init and an empty admit/preempt to everything else. */
function admitNothingModule(): ArrayBuffer {
  const report = JSON.stringify({ lab: 'batching-scheduler', version: 3, checks: [{ id: 'c', label: 'c', pass: true, msg: 'ok' }] })
  const answer = 'admit\npreempt'
  const ksInvoke = [0x00, 0x20, 0x00, 0x2d, 0x00, 0x00, 0x41, ...sleb64(105n), 0x46, 0x04, 0x7e, ...packed(1024, 2), 0x05, ...packed(1040, answer.length), 0x0b, 0x0b]
  const bodies = [[0x00, 0x41, ...sleb64(4096n), 0x0b], [0x00, 0x0b], [0x00, ...packed(2048, report.length), 0x0b], ksInvoke]
  const data: [number, string][] = [[1024, 'ok'], [1040, answer], [2048, report]]
  const bytes = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec([[0x60, 0x01, 0x7f, 0x01, 0x7f], [0x60, 0x02, 0x7f, 0x7f, 0x00], [0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7e]])),
    ...section(3, vec([[0], [1], [2], [2]])),
    ...section(5, vec([[0x00, 0x01]])),
    ...section(7, vec([[...str('memory'), 0x02, 0x00], [...str('ks_alloc'), 0x00, 0], [...str('ks_free'), 0x00, 1], [...str('ks_run'), 0x00, 2], [...str('ks_invoke'), 0x00, 3]])),
    ...section(10, vec(bodies.map((b) => [...uleb(b.length), ...b]))),
    ...section(11, vec(data.map(([at, text]) => [0x00, 0x41, ...sleb64(BigInt(at)), 0x0b, ...str(text)]))),
  ]
  return new Uint8Array(bytes).buffer
}

/* ------------------- the runner: the acts in process, a map for the components store ------------------- */

/** What sim.worker does with a request: draw the graded seeds from the entropy and run the act. */
async function runJob(job: SimJob, entropy: number): Promise<SimResults[SimJob['kind']]> {
  const { seeds } = drawGradedSeeds(entropy)
  if (job.kind === 'act1') return runAct1(job.modules, seeds)
  if (job.kind === 'act2') return runAct2(job.modules, job.choice, seeds)
  return evalAct3(seeds)
}

/** A runner over a components store holding `held`, counting the re-runs it does. */
function runnerWith(held: ArrayBuffer[] = []) {
  const store = new Map<string, ArrayBuffer>()
  const ready = Promise.all(held.map(async (b) => store.set(await sha256Hex(b), b)))
  const calls: { job: SimJob; entropy: number }[] = []
  const runner: ReceiptRunner = {
    run: async (job, entropy) => {
      calls.push({ job, entropy })
      return runJob(job, entropy)
    },
    bytes: async (sha) => {
      await ready
      return store.get(sha) ?? null
    },
  }
  return { runner, calls, store }
}

/** One recorded run: run the job on the entropy and keep its record, as Fleet Week will. */
async function recorded(act: RunRecord['act'], job: SimJob, entropy: number): Promise<RunRecord> {
  return runRecord(act, job, entropy, valuesOf(await runJob(job, entropy)), AT)
}

const SCHED = admitNothingModule()
let engine: RunRecord // Act I, all reference, on E1
let mine: RunRecord // Act I with the scheduler module, on E1
let business: RunRecord // Act III on E1
let fleet: RunRecord // Act II on E1

beforeAll(async () => {
  engine = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
  mine = await recorded('engine', { kind: 'act1', modules: { ...NO_MODULES, sched: SCHED } }, E1)
  business = await recorded('business', { kind: 'act3' }, E1)
  fleet = await recorded('fleet', { kind: 'act2', modules: { ...NO_MODULES, sched: SCHED }, choice: { workers: 4, router: 'jsq' } }, E1)
})

const badWorking = (value: unknown) => {
  const r = validateWorkingRecord({ key: 'fw:runs', value, at: AT, dev: 'd1' })
  return r.ok ? null : r.error
}

/* ------------------------------------------------------------------ */
/* Run records                                                          */
/* ------------------------------------------------------------------ */

describe('run records', () => {
  test('a record is {id, act, job with module bytes replaced by {slot, sha256}, entropy, values, at}', async () => {
    const sha = await sha256Hex(SCHED)
    expect(Object.keys(mine).sort()).toEqual(['act', 'at', 'entropy', 'id', 'job', 'values'])
    expect(mine.act).toBe('engine')
    expect(mine.job).toEqual({ kind: 'act1', modules: { sched: { slot: 'scheduler', sha256: sha }, mgr: null, queue: null } })
    expect(fleet.job).toEqual({ kind: 'act2', modules: { sched: { slot: 'scheduler', sha256: sha }, mgr: null, queue: null }, choice: { workers: 4, router: 'jsq' } })
    expect(business.job).toEqual({ kind: 'act3' })
    expect(mine.entropy).toBe(E1)
    expect(mine.at).toBe(AT)
    expect(mine.values).toEqual(valuesOf(await runJob({ kind: 'act1', modules: { ...NO_MODULES, sched: SCHED } }, E1)))
    expect(JSON.stringify(mine)).not.toContain('ArrayBuffer')
  })

  test('its id is the first 8 hex of sha256(stableStringify(the record without id and at))', async () => {
    for (const r of [engine, mine, business, fleet]) {
      const { id, at: _at, ...body } = r
      void _at
      expect(id).toMatch(/^[0-9a-f]{8}$/)
      expect(id).toBe((await sha256Hex(stableStringify(body))).slice(0, 8))
      expect(await runRecordId(r)).toBe(id)
    }
    // `at` is not part of it; the entropy and the values are
    const later = await runRecord('engine', { kind: 'act1', modules: NO_MODULES }, E1, engine.values, '2026-10-15T00:00:00.000Z')
    expect(later.id).toBe(engine.id)
    expect((await runRecord('engine', { kind: 'act1', modules: NO_MODULES }, E2, engine.values, AT)).id).not.toBe(engine.id)
    expect((await runRecord('engine', { kind: 'act1', modules: NO_MODULES }, E1, { ...engine.values, goodput: 1 }, AT)).id).not.toBe(engine.id)
    expect(new Set([engine.id, mine.id, business.id, fleet.id]).size).toBe(4)
  })

  test("every record passes the fw:runs codec, and so do 50 of them; runRecord refuses what the codec would", async () => {
    expect(badWorking([engine, mine, business, fleet])).toBeNull()
    for (const r of [engine, mine, business, fleet]) {
      expect(new TextEncoder().encode(stableStringify(r.job)).byteLength).toBeLessThanOrEqual(4096)
      expect(Object.keys(r.values).length).toBeLessThanOrEqual(40)
    }
    // the largest job: all three slots filled, Act II's topology
    const all = await runRecord('fleet', { kind: 'act2', modules: { sched: SCHED, mgr: SCHED, queue: SCHED }, choice: { workers: 2, router: 'prefix' } }, 0xffffffff, fleet.values, AT)
    expect(badWorking([all])).toBeNull()
    let list: RunRecord[] = []
    for (let i = 0; i < 60; i++) list = withRunRecord(list, await runRecord('business', { kind: 'act3' }, i, business.values, AT))
    expect(list).toHaveLength(MAX_RUN_RECORDS)
    expect(list.at(-1)!.entropy).toBe(59) // newest last, the oldest dropped
    expect(badWorking(list)).toBeNull()
    // a record with the same id replaces the old one and moves to the end
    expect(withRunRecord([engine, mine], engine).map((r) => r.id)).toEqual([mine.id, engine.id])

    await expect(runRecord('engine', { kind: 'act3' }, E1, {}, AT)).rejects.toThrow(RangeError)
    await expect(runRecord('business', { kind: 'act3' }, -1, {}, AT)).rejects.toThrow('uint32')
    await expect(runRecord('business', { kind: 'act3' }, 2 ** 32, {}, AT)).rejects.toThrow('uint32')
    await expect(runRecord('business', { kind: 'act3' }, 1, { x: Infinity }, AT)).rejects.toThrow('finite')
    const many = Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i]))
    await expect(runRecord('business', { kind: 'act3' }, 1, many, AT)).rejects.toThrow('40')
    expect(Object.keys(ACT_JOB)).toEqual(['engine', 'fleet', 'business'])
  })

  test('rebuilding a job reads module bytes by sha256, and only the same bytes count', async () => {
    const held = runnerWith([SCHED])
    const back = await rebuildJob(mine, held.runner.bytes)
    expect('job' in back && back.job.kind === 'act1' && back.job.modules.sched).toBeTruthy()
    expect(await rebuildJob(mine, runnerWith().runner.bytes)).toEqual({ missing: ['scheduler'] })
    // bytes under the right key that hash to something else are not the module that ran
    const wrong = runnerWith()
    wrong.store.set((mine.job.modules as { sched: { sha256: string } }).sched.sha256, new Uint8Array([0, 97, 115, 109]).buffer)
    expect(await rebuildJob(mine, wrong.runner.bytes)).toEqual({ missing: ['scheduler'] })
    expect(await rebuildJob({ ...business, act: 'engine' }, held.runner.bytes)).toEqual({ bad: true })
    expect(await rebuildJob({ ...fleet, job: { ...fleet.job, choice: { workers: 3, router: 'jsq' } } }, held.runner.bytes)).toEqual({ bad: true })
    expect(await rebuildJob({ ...mine, job: { kind: 'act1', modules: { sched: { slot: 'intake', sha256: 'a'.repeat(64) }, mgr: null, queue: null } } }, held.runner.bytes)).toEqual({ bad: true })
  })
})

/* ------------------------------------------------------------------ */
/* Tokens and the rounding rule                                         */
/* ------------------------------------------------------------------ */

describe('receipt tokens', () => {
  test('parseReceipts reads [[r:<8 hex> <key>=<number>]] and nothing else', () => {
    const text = 'Goodput held at [[r:7f3a9c21 goodput=41.2]] against [[r:7f3a9c21 refGoodput=43]], at [[r:0000abcd costPerMtok.b200=7.45]] per Mtok.'
    const rs = parseReceipts(text)
    expect(rs.map(({ id, key, text: t, value, decimals }) => ({ id, key, t, value, decimals }))).toEqual([
      { id: '7f3a9c21', key: 'goodput', t: '41.2', value: 41.2, decimals: 1 },
      { id: '7f3a9c21', key: 'refGoodput', t: '43', value: 43, decimals: 0 },
      { id: '0000abcd', key: 'costPerMtok.b200', t: '7.45', value: 7.45, decimals: 2 },
    ])
    expect(text.slice(rs[0].index, rs[0].index + rs[0].length)).toBe('[[r:7f3a9c21 goodput=41.2]]')
    expect(parseReceipts('[[r:7F3A9C21  goodput = 41.20 ]]')).toMatchObject([{ id: '7f3a9c21', key: 'goodput', text: '41.20', decimals: 2 }])
    expect(parseReceipts('[[r:7f3a9c21 shed=-0]]')).toMatchObject([{ value: -0, decimals: 0 }])
    for (const not of ['[[r:7f3a9c212 goodput=41.2]]', '[[r:7f3a9c2 goodput=41.2]]', '[[r:7f3a9c21 goodput 41.2]]', '[[r:7f3a9c21 goodput=]]', '[r:7f3a9c21 goodput=41.2]', '[[7f3a9c21 goodput=41.2]]', '[[r:7f3a9c21 goodput=41.2%]]', '[[r:7f3a9c21 =41.2]]', '[[r:7f3a9c21 goodput=.5]]']) {
      expect(parseReceipts(not)).toEqual([])
    }
  })

  test('a value is its shortest decimal form rounded half away from zero to the decimals written', () => {
    const cases: [number, number, string][] = [
      [41.2, 1, '41.2'],
      [41.2, 0, '41'],
      [41.2, 2, '41.20'],
      [41.5, 0, '42'],
      [41.25, 1, '41.3'],
      [41.249, 1, '41.2'],
      [1.005, 2, '1.01'], // as written, not as the binary double rounds (toFixed gives 1.00)
      [9.995, 2, '10.00'],
      [99.96, 1, '100.0'],
      [-0.125, 2, '-0.13'],
      [-41.5, 0, '-42'],
      [0, 2, '0.00'],
      [873, 0, '873'],
      [1e-7, 2, '0.00'],
      [0.3 - 0.1, 1, '0.2'],
    ]
    for (const [value, d, out] of cases) expect([value, d, roundCited(value, d)]).toEqual([value, d, out])
  })

  test('a cited value matches when it equals that rounding, and never past 2 decimals', () => {
    const at = (text: string) => parseReceipts(`[[r:00000000 k=${text}]]`)[0]
    expect(citedMatches(at('41.2'), 41.2)).toBe(true)
    expect(citedMatches(at('41'), 41.2)).toBe(true)
    expect(citedMatches(at('41.20'), 41.2)).toBe(true)
    expect(citedMatches(at('41.3'), 41.25)).toBe(true)
    expect(citedMatches(at('41.2'), 41.25)).toBe(false)
    expect(citedMatches(at('41.3'), 41.2)).toBe(false)
    expect(citedMatches(at('42'), 41.2)).toBe(false)
    expect(citedMatches(at('1.01'), 1.005)).toBe(true)
    expect(citedMatches(at('0'), -0.4)).toBe(true) // -0 is 0
    expect(citedMatches(at('41.200'), 41.2)).toBe(false) // more precise than any act shows
    expect(citedMatches(at('41.2'), Infinity)).toBe(false)
  })

  test('citeToken writes a token that parses back and matches its value', () => {
    expect(citeToken('7f3a9c21', 'goodput', 41.2)).toBe('[[r:7f3a9c21 goodput=41.2]]')
    expect(citeToken('7f3a9c21', 'costPerMtok.gb200', 238.77)).toBe('[[r:7f3a9c21 costPerMtok.gb200=238.77]]')
    expect(citeToken('7f3a9c21', 'x', 2 / 3)).toBe('[[r:7f3a9c21 x=0.67]]')
    expect(citeToken('7f3a9c21', 'x', 41.25, 1)).toBe('[[r:7f3a9c21 x=41.3]]')
    for (const v of [41.2, 873, 2 / 3, 1.005, 0, 238.77, 12.345678]) {
      const [r] = parseReceipts(citeToken('0badf00d', 'k', v))
      expect(citedMatches(r, v)).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ */
/* Verification by re-run                                               */
/* ------------------------------------------------------------------ */

describe('verifyReceipts re-runs the cited record', () => {
  test('a correct receipt verifies: Act I with your module, Act II and Act III', async () => {
    const { runner } = runnerWith([SCHED])
    const text = [
      citeToken(mine.id, 'goodput', mine.values.goodput),
      citeToken(mine.id, 'refGoodput', mine.values.refGoodput),
      citeToken(mine.id, 'ttftP95', mine.values.ttftP95),
      citeToken(fleet.id, 'lost', fleet.values.lost),
      citeToken(business.id, 'costPerMtok.b200', business.values['costPerMtok.b200']),
      citeToken(engine.id, 'goodput', engine.values.goodput, 0),
    ].join(' ')
    const checks = await verifyReceipts(parseReceipts(text), [engine, mine, business, fleet], runner)
    expect(checks.map((c) => c.status)).toEqual(['verified', 'verified', 'verified', 'verified', 'verified', 'verified'])
    expect(checks[0].actual).toBe(mine.values.goodput)
    expect(receiptCounts(checks, uncitedFigures(text))).toEqual({ cited: 6, verified: 6, uncited: 0 })
  })

  test('an edited value fails', async () => {
    const { runner } = runnerWith([SCHED])
    const edited = mine.values.goodput + 1.5
    const [check] = await verifyReceipts(parseReceipts(citeToken(mine.id, 'goodput', edited)), [mine], runner)
    expect(check.status).toBe('mismatch')
    expect(check.actual).toBe(mine.values.goodput)
    // and the record's stored values are not what is compared: editing them in the record breaks its id
    const forged = { ...mine, values: { ...mine.values, goodput: edited } }
    const [again] = await verifyReceipts(parseReceipts(citeToken(mine.id, 'goodput', edited)), [forged], runner)
    expect(again.status).toBe('tampered')
  })

  test('a record for another entropy fails', async () => {
    const { runner } = runnerWith()
    const other = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E2)
    expect(other.values.goodput).not.toBe(engine.values.goodput) // the two entropies run differently
    // the cited record's entropy edited to another one: the id no longer holds
    const moved = { ...engine, entropy: E2 }
    const [a] = await verifyReceipts(parseReceipts(citeToken(engine.id, 'goodput', engine.values.goodput)), [moved], runner)
    expect(a.status).toBe('tampered')
    // a well-formed record on the other entropy carrying the first run's values: the re-run on its entropy disagrees
    const relabelled = await runRecord('engine', { kind: 'act1', modules: NO_MODULES }, E2, engine.values, AT)
    const [b] = await verifyReceipts(parseReceipts(citeToken(relabelled.id, 'goodput', engine.values.goodput)), [relabelled], runner)
    expect(b.status).toBe('mismatch')
    expect(b.actual).toBe(other.values.goodput)
    // the first run's token against a list holding only the other entropy's record names no record here
    const [c] = await verifyReceipts(parseReceipts(citeToken(engine.id, 'goodput', engine.values.goodput)), [other], runner)
    expect(c.status).toBe('no-record')
  })

  test('a module missing from the device fails, and the record is not re-run', async () => {
    const { runner, calls } = runnerWith()
    const checks = await verifyReceipts(parseReceipts(`${citeToken(mine.id, 'goodput', mine.values.goodput)} ${citeToken(fleet.id, 'goodput', fleet.values.goodput)}`), [mine, fleet], runner)
    expect(checks.map((c) => c.status)).toEqual(['module-missing', 'module-missing'])
    expect(checks[0].missing).toEqual(['scheduler'])
    expect(calls).toHaveLength(0)
    expect(receiptCounts(checks, []).verified).toBe(0)
  })

  test('each distinct record re-runs once, with its job, its entropy and the module bytes it names', async () => {
    const { runner, calls } = runnerWith([SCHED])
    const text = ['goodput', 'refGoodput', 'completed', 'shed'].map((k) => citeToken(mine.id, k, mine.values[k])).join(' ') + citeToken(business.id, 'goodput.h100', business.values['goodput.h100'])
    const checks = await verifyReceipts(parseReceipts(text), [engine, mine, business], runner)
    expect(checks.every((c) => c.status === 'verified')).toBe(true)
    expect(calls.map((c) => [c.job.kind, c.entropy])).toEqual([['act1', E1], ['act3', E1]])
    const job = calls[0].job as Extract<SimJob, { kind: 'act1' }>
    expect(await sha256Hex(job.modules.sched!)).toBe(await sha256Hex(SCHED))
    expect(job.modules.mgr).toBeNull()
  })

  test('a key the run has no value for, a citation past 2 decimals and a run that throws do not verify', async () => {
    const { runner } = runnerWith([SCHED])
    const text = `[[r:${engine.id} nonsense=1]] [[r:${engine.id} goodput=${engine.values.goodput.toFixed(3)}]]`
    const checks = await verifyReceipts(parseReceipts(text), [engine], runner)
    expect(checks.map((c) => c.status)).toEqual(['no-value', 'too-precise'])
    const throwing: ReceiptRunner = { run: () => Promise.reject(new Error('trap')), bytes: runner.bytes }
    const [failed] = await verifyReceipts(parseReceipts(citeToken(engine.id, 'goodput', engine.values.goodput)), [engine], throwing)
    expect(failed.status).toBe('run-failed')
    // a record whose job is not one a run writes, with an id that matches its contents
    const odd = { ...business, act: 'engine' as const }
    const reId = { ...odd, id: await runRecordId(odd) }
    const [bad] = await verifyReceipts(parseReceipts(citeToken(reId.id, 'goodput.h100', 1)), [reId], runner)
    expect(bad.status).toBe('bad-record')
  })
})

/* ------------------------------------------------------------------ */
/* Uncited figures                                                      */
/* ------------------------------------------------------------------ */

describe('uncitedFigures', () => {
  test('flags every %, ms, s, iters, tok/s, req/s or $ figure outside a token', () => {
    const text = 'Goodput fell to 41.2% while TTFT p95 rose to 873 iters (about 43.6 s, or 120ms per step). It served 1,200 tok/s and 3 req/s at $7.45/Mtok, i.e. 7.45 $ per Mtok, and −3% on retries; 12 iterations.'
    expect(uncitedFigures(text).map((f) => f.text)).toEqual(['41.2%', '873 iters', '43.6 s', '120ms', '1,200 tok/s', '3 req/s', '$7.45', '7.45 $', '−3%', '12 iterations'])
    const f = uncitedFigures(text)[1]
    expect(text.slice(f.index, f.index + f.text.length)).toBe('873 iters')
  })

  test('a figure inside a token is cited, and numbers without a unit are not figures', () => {
    const text = `Goodput was [[r:7f3a9c21 goodput=41.2]] on seed 0x3a12 with 4 workers, p95 and H100 nodes, 240 requests and 2 sets of runs in v1.5 of 3 acts.`
    expect(uncitedFigures(text)).toEqual([])
    expect(uncitedFigures(`${text} It was 41.2% before.`).map((f) => f.text)).toEqual(['41.2%'])
    // a malformed token is not a citation: its figure is flagged
    expect(uncitedFigures('[[r:7f3a9c21 goodput=41.2%]]').map((f) => f.text)).toEqual(['41.2%'])
  })

  // 3a-12's minors: 3b-05's pass rule ('no uncited figure remains') is only as good as this scanner
  const flagged: [string, string, string[]][] = [
    ['%', 'down 41.2% on retries', ['41.2%']],
    ['$ before', 'at $7.45 per Mtok', ['$7.45']],
    ['$ after', 'at 7.45 $ per Mtok', ['7.45 $']],
    ['ms', 'a step of 120ms and 3 ms', ['120ms', '3 ms']],
    ['millisecond(s)', '1 millisecond, 20 milliseconds', ['1 millisecond', '20 milliseconds']],
    ['s', 'took 43.6 s and 2s', ['43.6 s', '2s']],
    ['sec(s)', '1 sec, 5 secs', ['1 sec', '5 secs']],
    ['second(s)', '1 second, 5 seconds', ['1 second', '5 seconds']],
    ['iter(s)', '1 iter, 873 iters', ['1 iter', '873 iters']],
    ['iteration(s)', '1 iteration, 12 iterations', ['1 iteration', '12 iterations']],
    ['tok/s', '1,200 tok/s', ['1,200 tok/s']],
    ['tokens/s', '900 tokens/s', ['900 tokens/s']],
    ['req/s', '3 req/s', ['3 req/s']],
    ['requests/s', '3 requests/s', ['3 requests/s']],
    ['a slash after ms', '12 ms/token', ['12 ms']],
    ['a slash after s', '5 s/req', ['5 s']],
    ['a slash after iters', '7 iters/step', ['7 iters']],
    ['a slash after tok/s', '40 tok/s/GPU', ['40 tok/s']],
    ['a leading-dot decimal', 'about .5 s and (.25 ms)', ['.5 s', '.25 ms']],
    ['a k suffix', '1.5k tok/s and 2k req/s', ['1.5k tok/s', '2k req/s']],
    ['upper-case units', '3 MS, 10 TOK/S, 4 Req/S, 5 ITERS, 6 S', ['3 MS', '10 TOK/S', '4 Req/S', '5 ITERS', '6 S']],
    ['an exponent', '1e3 ms and 2.5E-3 s', ['1e3 ms', '2.5E-3 s']],
    ['a minus sign', '−3% and -2 ms', ['−3%', '-2 ms']],
  ]
  test.each(flagged)('flags %s', (_name, text, expected) => {
    const found = uncitedFigures(text)
    expect(found.map((f) => f.text)).toEqual(expected)
    for (const f of found) expect(text.slice(f.index, f.index + f.text.length)).toBe(f.text)
  })

  const notFigures: [string, string][] = [
    ['version strings', 'built on v0.31.0 and 1.2.3, Rust 1.85.0, Node 22.4.1'],
    ['dates', 'on 2026-10-14, 14 Oct 2026 or 10/14/2026 at 09:30'],
    ['model and GPU names', 'Llama-3-70B and Qwen2.5-72B on H100, A100-80GB and 8xH100 SXM nodes, GPT-4'],
    ['percentile labels', 'the p95 and p99.9 of TTFT, a p50 line'],
    ['counts and ids without a unit', '4 workers, 240 requests, seed 0x3a12, 3 acts, set 2 and step 12'],
    ['words that merely start with a unit', '5 secure runs, 2 sets, 9 mss, 4 tokens, 3 seasons'],
  ]
  test.each(notFigures)('does not flag %s', (_name, text) => {
    expect(uncitedFigures(text)).toEqual([])
  })

  test('a cited figure is not flagged, in either unit form', () => {
    expect(uncitedFigures('TTFT was [[r:7f3a9c21 ttft=43.6]] s, and [[r:7f3a9c21 goodput=1200]] tok/s')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* The sim client: runSim keeps its result, runSimWithEntropy names its entropy */
/* ------------------------------------------------------------------ */

describe('the sim client', () => {
  type Listener = (event: { data: unknown }) => void
  const posted: { entropy: number }[] = []
  // where Worker is absent (under bun it is), afterAll deletes the stand-in rather than leaving an own `undefined`
  const hadWorker = Object.hasOwn(globalThis, 'Worker')
  const realWorker = (globalThis as { Worker?: unknown }).Worker

  /** A stand-in for sim.worker: says ready, then answers each job with a result naming the entropy it was sent. */
  class FakeWorker {
    private listeners = new Map<string, Set<Listener>>()
    constructor() {
      setTimeout(() => this.emit('message', { type: 'ready' }), 0)
    }
    addEventListener(type: string, fn: Listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type)!.add(fn)
    }
    removeEventListener(type: string, fn: Listener) {
      this.listeners.get(type)?.delete(fn)
    }
    postMessage(request: { id: number; entropy: number }) {
      posted.push({ entropy: request.entropy })
      setTimeout(() => this.emit('message', { id: request.id, type: 'result', result: { seed: request.entropy, perOption: [], bestValue: 'h100', values: { ran: request.entropy } } }), 0)
    }
    terminate() {}
    private emit(type: string, data: unknown) {
      for (const fn of this.listeners.get(type) ?? []) fn({ data })
    }
  }

  beforeAll(() => {
    ;(globalThis as { Worker?: unknown }).Worker = FakeWorker
  })
  afterAll(() => {
    if (hadWorker) (globalThis as { Worker?: unknown }).Worker = realWorker
    else delete (globalThis as { Worker?: unknown }).Worker
  })

  test('runSimWithEntropy resolves the result and the entropy it ran on; runSim resolves the result alone', async () => {
    // a private instance of the module (the query makes a new module key): its module-level worker is the fake, and
    // the shared instance, which any later test or import gets, never holds it
    const { runSim, runSimWithEntropy } = (await import('../../src/workers/sim-client?fake-worker')) as typeof import('../../src/workers/sim-client')
    const given = await runSimWithEntropy({ kind: 'act3' }, undefined, 0xdeadbeef)
    expect(given.entropy).toBe(0xdeadbeef)
    expect(given.result.values).toEqual({ ran: 0xdeadbeef })
    expect(posted.at(-1)).toEqual({ entropy: 0xdeadbeef })

    const fresh = await runSimWithEntropy({ kind: 'act3' })
    expect(Number.isInteger(fresh.entropy) && fresh.entropy >= 0 && fresh.entropy <= 0xffffffff).toBe(true)
    expect(fresh.result.values).toEqual({ ran: fresh.entropy }) // the entropy it reports is the one the worker got

    const plain = await runSim({ kind: 'act3' }, undefined, 7)
    expect(plain.values).toEqual({ ran: 7 })
    expect('entropy' in plain).toBe(false)

    await expect(runSimWithEntropy({ kind: 'act3' }, undefined, -1)).rejects.toThrow('uint32')
    await expect(runSim({ kind: 'act3' }, undefined, 1.5)).rejects.toThrow('uint32')

    // the shared module is a different instance: it never saw the fake
    const shared = await import('../../src/workers/sim-client')
    expect(shared.runSim).not.toBe(runSim)
  })
})
