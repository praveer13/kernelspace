/**
 * The receipts exit gate (docs/specs/wave-3.md §18.1 B2, §10.4, D14; task 3c-01). Fleet Week's Acts I and III are replayed
 * from a stored run through the real grading: the run record is kept in `fw:runs`, the write-up cites values with
 * receipt tokens, `verifyReceipts` re-runs the record (the acts in process, as the page's sim worker does), and
 * `gradeMeasurementSubmission` or `gradeAct3Doc` decides. Verified receipts pass; an edited value, another entropy and
 * a module that is not on this device each fail. The act is then written through the façade with its receipts counts.
 *
 * No passing module is committed (private solutions stay private), and Act I's trace passes only with one of your own
 * components within 3 points of the reference. So Act I's trace result is a fixture: a real all-reference run whose
 * verdict is set to pass (receipts-act.test.ts does the same). A receipt check compares values and needs no pass, so the
 * receipts themselves are real: the record's values are the run's, and every token is checked by re-running. Act III
 * needs no module and runs for real. The module cases use a hand-assembled wasm scheduler that admits nothing (it loses).
 */
import { describe, expect, test } from 'bun:test'
import {
  actMeta,
  citeKeyFor,
  evalAct3,
  gradeAct3Doc,
  gradeMeasurementSubmission,
  runAct1,
  runAct2,
  verifiedFor,
  type ActResult,
  type ModuleBytes,
  type ReceiptEvidence,
} from '../../src/lib/fleet-week'
import { citeToken, parseReceipts, rebuildJob, runRecord, uncitedFigures, valuesOf, verifyReceipts, withRunRecord, type ReceiptRunner } from '../../src/lib/fleet-receipts'
import { drawGradedSeeds } from '../../src/lib/graded-seed'
import { sha256Hex } from '../../src/lib/ledger/stable'
import type { Json, RunRecord } from '../../src/lib/ledger/types'
import type { SimJob, SimResults } from '../../src/workers/sim-protocol'
import { makeProfile, startTab } from '../ledger/env'

const AT = '2026-10-14T09:00:00.000Z'
const E1 = 0x3a12
const E2 = 0x3a13
const NO_MODULES: ModuleBytes = { sched: null, mgr: null, queue: null }

/* ------------------- a tiny hand-assembled scheduler module (it loses) ------------------- */

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

/** A zero-import lab module whose `ks_invoke` answers "ok" to init and an empty admit/preempt to everything else. */
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

/* ------------------- the page's re-run, in process ------------------- */

/** What sim.worker does with a request: draw the graded seeds from the entropy and run the act. */
async function runJob(job: SimJob, entropy: number): Promise<SimResults[SimJob['kind']]> {
  const { seeds } = drawGradedSeeds(entropy)
  if (job.kind === 'act1') return runAct1(job.modules, seeds)
  if (job.kind === 'act2') return runAct2(job.modules, job.choice, seeds)
  return evalAct3(seeds)
}

/** The runner over a components store holding `held` (by sha256): the device the receipts are checked on. */
async function deviceHolding(...held: ArrayBuffer[]): Promise<ReceiptRunner> {
  const store = new Map<string, ArrayBuffer>()
  for (const b of held) store.set(await sha256Hex(b), b)
  return { run: runJob, bytes: async (sha) => store.get(sha) ?? null }
}

/** One recorded run, as Fleet Week keeps it in `fw:runs`. */
async function recorded<K extends SimJob['kind']>(act: RunRecord['act'], job: Extract<SimJob, { kind: K }>, entropy: number): Promise<{ result: SimResults[K]; record: RunRecord }> {
  const result = (await runJob(job, entropy)) as SimResults[K]
  return { result, record: await runRecord(act, job, entropy, valuesOf(result), AT) }
}

/** The grading's evidence for `text`, checked on `device` against the stored `records`, as the page's "Check my receipts" builds it. */
async function evidenceFor(text: string, records: readonly RunRecord[], runId: string, device: ReceiptRunner): Promise<ReceiptEvidence> {
  return { runId, checks: await verifyReceipts(parseReceipts(text), records, device), uncited: uncitedFigures(text) }
}

/** The fixture passing trace: a real run whose verdict is set to pass, with the score the trace would give. */
function passing(result: ActResult, score = 0.9): ActResult {
  const { practice: _practice, ...rest } = result
  void _practice
  return { ...rest, pass: true, score }
}

/** The write-up of a run the way the cite buttons build it: the first `n` metric rows that restate a value, each as a token. */
function citedRows(act: 'engine' | 'fleet', result: ActResult, record: RunRecord, n: number): string[] {
  const keys = result.metrics.map(([label, text]) => citeKeyFor(act, label, text)).filter((k): k is string => k !== null)
  expect(keys.length).toBeGreaterThanOrEqual(n)
  return keys.slice(0, n).map((k) => citeToken(record.id, k, record.values[k]))
}

/** The value of `key` as a cite button writes it (rounded to at most two decimals). */
const roundedOf = (record: RunRecord, key: string): string => citeToken(record.id, key, record.values[key]).split('=')[1]

/** Move a cited value away from the run's: a different number at the decimals written. */
function edited(token: string): string {
  return token.replace(/=(-?\d+(?:\.\d+)?)\]\]/, (_, n: string) => `=${(Number(n) + 5).toFixed(n.includes('.') ? n.length - n.indexOf('.') - 1 : 0)}]]`)
}

/* ------------------------------------------------------------------ */
/* Act I                                                                */
/* ------------------------------------------------------------------ */

describe('Act I, replayed from a stored run through the real grading', () => {
  test('the verified receipts pass: the record is read back from fw:runs, re-run, graded with the fixture trace, and written with its counts', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    // the run is kept in the working record `fw:runs` and read back by a later page load
    const profile = makeProfile()
    const first = startTab(profile)
    first.progress.getState().setWorking('fw:runs', JSON.parse(JSON.stringify(withRunRecord([], record))) as Json)
    await first.progress.controls.flush()
    const second = startTab(profile)
    const stored = second.progress.getState().working['fw:runs'] as unknown as RunRecord[]
    expect(stored).toEqual([record])

    const [a, b] = citedRows('engine', result, record, 2)
    const text = `Goodput held at ${a} and the pool admitted ${b}, so admission, not the decode loop, set the ceiling.`
    const evidence = await evidenceFor(text, stored, record.id, await deviceHolding())
    expect(evidence.checks.map((c) => c.status)).toEqual(['verified', 'verified'])
    expect(evidence.uncited).toEqual([])
    expect(verifiedFor(evidence.checks, record.id)).toHaveLength(2)

    const graded = gradeMeasurementSubmission('engine', passing(result, 0.9), evidence)
    expect(graded.pass).toBe(true)
    expect(graded.score).toBeCloseTo(0.9 * 0.6 + 0.4, 10)
    expect(graded.headline).toContain('2 receipts verified')

    // the page writes the act when it passes, with the receipts it re-ran
    second.progress.getState().completeFleetWeekAct('engine', graded.score, actMeta(graded, evidence))
    await second.progress.controls.flush()
    const [event] = (await (await second.engine()).events({ kinds: ['fleet-act'] })) as unknown as Array<{ ref: string; ok: boolean; provenance: string; seed: number; data: { receipts: unknown; runs: string[] } }>
    expect(event).toMatchObject({ ref: 'fw:engine', ok: true, provenance: 'unseen', seed: result.seed, data: { receipts: { cited: 2, verified: 2, uncited: 0 }, runs: [record.id] } })
    expect(second.progress.getState().aggregate.fleetWeek.acts.engine).toBe(true)
  })

  test('the receipts are the run’s own: they verify on a run whose trace failed, and the grade is still not a pass', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    expect(result.pass).toBe(false) // an all-reference run is practice
    const evidence = await evidenceFor(citedRows('engine', result, record, 2).join(' '), [record], record.id, await deviceHolding())
    expect(evidence.checks.every((c) => c.status === 'verified')).toBe(true)
    const graded = gradeMeasurementSubmission('engine', result, evidence)
    expect(graded.pass).toBe(false)
    expect(graded.headline).toBe('the executable trace gate is not green')
  })

  test('an edited value fails: the re-run gives another value at the decimals written', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const [a, b] = citedRows('engine', result, record, 2)
    const evidence = await evidenceFor(`${edited(a)} and ${b}`, [record], record.id, await deviceHolding())
    expect(evidence.checks.map((c) => c.status)).toEqual(['mismatch', 'verified'])
    const graded = gradeMeasurementSubmission('engine', passing(result), evidence)
    expect(graded.pass).toBe(false)
    expect(graded.score).toBeCloseTo(0.9 * 0.6, 10) // the trace's share only
    expect(graded.headline).toContain('verify at least 2 values')
  })

  test('a value cited with more than two decimals, and a value the run does not have, fail', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const [a, b] = citedRows('engine', result, record, 2)
    const device = await deviceHolding()
    const precise = await evidenceFor(`[[r:${record.id} goodput=${record.values.goodput}000]] and ${b}`, [record], record.id, device)
    expect(precise.checks.map((c) => c.status)).toEqual(['too-precise', 'verified'])
    expect(gradeMeasurementSubmission('engine', passing(result), precise).pass).toBe(false)
    const invented = await evidenceFor(`[[r:${record.id} throughput=12]] and ${a}`, [record], record.id, device)
    expect(invented.checks.map((c) => c.status)).toEqual(['no-value', 'verified'])
    expect(gradeMeasurementSubmission('engine', passing(result), invented).pass).toBe(false)
  })

  test('another entropy fails: a record kept with a different entropy no longer matches its id, and one minted on another entropy re-runs to other values', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const { record: onE2 } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E2)
    expect(onE2.values).not.toEqual(record.values) // the entropy moves the graded seeds, so it moves the values
    const text = citedRows('engine', result, record, 2).join(' and ')
    const device = await deviceHolding()

    // (a) the stored record was edited: its entropy says E2, its id is still the one E1 earned
    const swapped: RunRecord = { ...record, entropy: E2 }
    const tampered = await evidenceFor(text, [swapped], record.id, device)
    expect(tampered.checks.map((c) => c.status)).toEqual(['tampered', 'tampered'])
    expect(gradeMeasurementSubmission('engine', passing(result), tampered).pass).toBe(false)

    // (b) a record minted honestly on E2 but carrying E1's values (a hand-built claim): the re-run on E2 disagrees
    const forged = await runRecord('engine', { kind: 'act1', modules: NO_MODULES }, E2, record.values, AT)
    // cite two values that differ between the entropies: a value that happens to agree would (rightly) verify
    const differing = Object.keys(record.values).filter((k) => roundedOf(record, k) !== roundedOf(onE2, k))
    expect(differing.length).toBeGreaterThanOrEqual(2)
    const forgedText = differing.slice(0, 2).map((k) => citeToken(forged.id, k, forged.values[k])).join(' and ')
    const claim = await evidenceFor(forgedText, [forged], forged.id, device)
    expect(claim.checks.map((c) => c.status)).toEqual(['mismatch', 'mismatch'])
    expect(gradeMeasurementSubmission('engine', passing(result), claim).pass).toBe(false)

    // (c) the receipts of the other run verify, but they are not about the run being graded
    const elsewhere = await evidenceFor(citedRows('engine', result, onE2, 2).join(' and '), [record, onE2], record.id, device)
    expect(elsewhere.checks.map((c) => c.status)).toEqual(['verified', 'verified'])
    expect(verifiedFor(elsewhere.checks, record.id)).toHaveLength(0)
    expect(gradeMeasurementSubmission('engine', passing(result), elsewhere).pass).toBe(false)
  })

  test('a missing module fails: a record that used a module this device does not hold cannot be re-run here', async () => {
    const mine = admitNothingModule()
    const withMine: ModuleBytes = { ...NO_MODULES, sched: mine }
    const { result, record } = await recorded('engine', { kind: 'act1', modules: withMine }, E1)
    expect(record.job).toMatchObject({ kind: 'act1', modules: { sched: { slot: 'scheduler', sha256: await sha256Hex(mine) } } })
    const text = citedRows('engine', result, record, 2).join(' and ')

    // on a device that holds the module, the same receipts verify by re-running it
    const here = await evidenceFor(text, [record], record.id, await deviceHolding(mine))
    expect(here.checks.map((c) => c.status)).toEqual(['verified', 'verified'])
    expect(gradeMeasurementSubmission('engine', passing(result), here).pass).toBe(true)

    // on one that does not, nothing is verified and the record is not re-run
    const away = await evidenceFor(text, [record], record.id, await deviceHolding())
    expect(away.checks.map((c) => c.status)).toEqual(['module-missing', 'module-missing'])
    expect(away.checks[0].missing).toEqual(['scheduler'])
    expect(gradeMeasurementSubmission('engine', passing(result), away).pass).toBe(false)

    // bytes under the right name that hash to something else count as missing too
    const wrong = new Uint8Array([1, 2, 3]).buffer
    const store: ReceiptRunner = { run: runJob, bytes: async () => wrong }
    expect(await rebuildJob(record, store.bytes)).toEqual({ missing: ['scheduler'] })
    expect((await evidenceFor(text, [record], record.id, store)).checks.map((c) => c.status)).toEqual(['module-missing', 'module-missing'])
  })

  test('a figure with a unit outside a receipt fails Act I, however many receipts verify', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const evidence = await evidenceFor(`${citedRows('engine', result, record, 2).join(' and ')}, about 12 ms per step`, [record], record.id, await deviceHolding())
    expect(evidence.uncited.map((f) => f.text)).toEqual(['12 ms'])
    const graded = gradeMeasurementSubmission('engine', passing(result), evidence)
    expect(graded.pass).toBe(false)
    expect(graded.headline).toBe('cite it or cut it: 1 figure with a unit sits outside a receipt')
  })

  test('the words are not graded: a keyword-stuffed write-up with no receipt fails, and two bare receipts pass', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const device = await deviceHolding()
    const stuffed = 'ttft tpot queue kv hit goodput slo cost shed preempt scheduler admission headroom batch prefill '.repeat(8)
    expect(gradeMeasurementSubmission('engine', passing(result), await evidenceFor(stuffed, [record], record.id, device)).pass).toBe(false)
    const bare = await evidenceFor(citedRows('engine', result, record, 2).join(' '), [record], record.id, device)
    expect(gradeMeasurementSubmission('engine', passing(result), bare).pass).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* Act II, the same machinery                                           */
/* ------------------------------------------------------------------ */

describe('Act II grades the same way', () => {
  test('verified receipts pass with the fixture trace, and an edited value fails', async () => {
    const { result, record } = await recorded('fleet', { kind: 'act2', modules: NO_MODULES, choice: { workers: 4, router: 'jsq' } }, E1)
    const [a, b] = citedRows('fleet', result, record, 2)
    const device = await deviceHolding()
    const ok = await evidenceFor(`${a} and ${b}`, [record], record.id, device)
    expect(ok.checks.map((c) => c.status)).toEqual(['verified', 'verified'])
    expect(gradeMeasurementSubmission('fleet', passing(result), ok).pass).toBe(true)
    const bad = await evidenceFor(`${edited(a)} and ${b}`, [record], record.id, device)
    expect(gradeMeasurementSubmission('fleet', passing(result), bad).pass).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* Act III                                                              */
/* ------------------------------------------------------------------ */

describe('Act III, replayed through the real grading (it needs no module)', () => {
  const run = (entropy = E1) => recorded('business', { kind: 'act3' }, entropy)

  test('the chosen option meets the SLO and its $/Mtok is a verified receipt: it passes with full score and is written with its receipts', async () => {
    const { result, record } = await run()
    const token = citeToken(record.id, 'costPerMtok.b200', record.values['costPerMtok.b200'])
    const evidence = await evidenceFor(`B200 serves a million tokens for ${token}.`, [record], record.id, await deviceHolding())
    expect(evidence.checks.map((c) => c.status)).toEqual(['verified'])
    const graded = gradeAct3Doc('b200', result, evidence)
    expect(graded.pass).toBe(true)
    expect(graded.score).toBeCloseTo(1, 10)
    expect(graded.metrics.find(([l]) => l === 'cost receipt')?.[1]).toBe('verified')

    const tab = startTab(makeProfile())
    tab.progress.getState().completeFleetWeekAct('business', graded.score, actMeta(graded, evidence))
    await tab.progress.controls.flush()
    const [event] = (await (await tab.engine()).events({ kinds: ['fleet-act'] })) as unknown as Array<{ ref: string; provenance: string; seed: number; data: { receipts: unknown; runs: string[] } }>
    expect(event).toMatchObject({ ref: 'fw:business', provenance: 'unseen', seed: result.seed, data: { receipts: { cited: 1, verified: 1, uncited: 0 }, runs: [record.id] } })
    expect(tab.progress.getState().aggregate.fleetWeek.acts.business).toBe(true)
  })

  test('an edited cost fails, and a tampered stored evaluation fails', async () => {
    const { result, record } = await run()
    const device = await deviceHolding()
    const token = citeToken(record.id, 'costPerMtok.b200', record.values['costPerMtok.b200'])
    const bad = await evidenceFor(edited(token), [record], record.id, device)
    expect(bad.checks.map((c) => c.status)).toEqual(['mismatch'])
    const graded = gradeAct3Doc('b200', result, bad)
    expect(graded.pass).toBe(false)
    expect(graded.score).toBeCloseTo(0.45, 10) // the SLO share only
    // the stored record's value was edited after the run: its id no longer matches
    const doctored: RunRecord = { ...record, values: { ...record.values, 'costPerMtok.b200': 0.01 } }
    const forged = await evidenceFor(citeToken(record.id, 'costPerMtok.b200', 0.01), [doctored], record.id, device)
    expect(forged.checks.map((c) => c.status)).toEqual(['tampered'])
    expect(gradeAct3Doc('b200', result, forged).pass).toBe(false)
  })

  test('another entropy fails: a cost verified on another evaluation is not the one being defended', async () => {
    const { result, record } = await run(E1)
    const { record: other } = await run(E2)
    const device = await deviceHolding()
    const token = citeToken(other.id, 'costPerMtok.b200', other.values['costPerMtok.b200'])
    const elsewhere = await evidenceFor(token, [record, other], record.id, device)
    expect(elsewhere.checks.map((c) => c.status)).toEqual(['verified'])
    expect(gradeAct3Doc('b200', result, elsewhere).pass).toBe(false)
    // a record minted on E2 with E1's values re-runs to E2's, so the claim does not hold
    const forged = await runRecord('business', { kind: 'act3' }, E2, record.values, AT)
    const claim = await evidenceFor(citeToken(forged.id, 'costPerMtok.b200', record.values['costPerMtok.b200']), [forged], forged.id, device)
    expect(roundedOf(record, 'costPerMtok.b200')).not.toBe(roundedOf(other, 'costPerMtok.b200'))
    expect(claim.checks.map((c) => c.status)).toEqual(['mismatch'])
    expect(gradeAct3Doc('b200', result, claim).pass).toBe(false)
  })

  test('no record on this device, and an option that misses the SLO, fail', async () => {
    const { result, record } = await run()
    const device = await deviceHolding()
    const token = citeToken(record.id, 'costPerMtok.b200', record.values['costPerMtok.b200'])
    const none = await evidenceFor(token, [], record.id, device)
    expect(none.checks.map((c) => c.status)).toEqual(['no-record'])
    expect(gradeAct3Doc('b200', result, none).pass).toBe(false)
    const h100 = await evidenceFor(citeToken(record.id, 'costPerMtok.h100', record.values['costPerMtok.h100']), [record], record.id, device)
    expect(h100.checks.map((c) => c.status)).toEqual(['verified'])
    const missed = gradeAct3Doc('h100', result, h100)
    expect(missed.pass).toBe(false)
    expect(missed.score).toBeCloseTo(0.55, 10) // the cost receipt verified, the SLO did not hold
  })

  test('the words are not graded: a stuffed write-up with no receipt fails, and one bare receipt passes', async () => {
    const { result, record } = await run()
    const device = await deviceHolding()
    const stuffed = 'goodput slo cache batch frontier pareto cost shed ttft '.repeat(20)
    expect(gradeAct3Doc('b200', result, await evidenceFor(stuffed, [record], record.id, device)).pass).toBe(false)
    const bare = await evidenceFor(citeToken(record.id, 'costPerMtok.b200', record.values['costPerMtok.b200']), [record], record.id, device)
    expect(gradeAct3Doc('b200', result, bare).pass).toBe(true)
  })
})
