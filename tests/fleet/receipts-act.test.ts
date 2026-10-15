/**
 * Fleet Week's grading by receipts (docs/specs/wave-3.md §10.4, D14; task 3b-05).
 *
 * Acts I-II pass with the trace pass, at least two verified receipts of the graded run and no uncited figure; Act III
 * with its executed SLO check and its $/Mtok as a verified receipt. No passing module is committed (private solutions
 * stay private), and Act I's trace passes only with one of your own components in the engine, so "Acts I-II pass with
 * the trace pass and >= 2 verified receipts" is proved by feeding the grading a fixture passing trace result: a real
 * all-reference run whose verdict is set to pass. A receipt check compares values and needs no pass, so the receipts
 * themselves are real: each token is checked by re-running its record in process, as the page's worker does.
 *
 * Also here: the nine exemplars (their tokens re-run and verify, their prose arithmetic holds), the rubric's keys
 * (the codec's), and that nothing of the text but its receipts is read.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ALL_EXEMPLARS, EXEMPLARS, RUBRIC, RUBRIC_KEYS, exemplarTotal, type Exemplar } from '../../src/data/fleetweek/exemplars'
import { HEADROOM_TOKENS, PRACTICE_SEED } from '../../src/lib/fleet-model'
import { RUBRIC_KEYS as LEDGER_RUBRIC_KEYS } from '../../src/lib/ledger/constants'
import {
  ACT1_MACHINE,
  ACT2_MACHINE,
  HW_MENU,
  MIN_VERIFIED_RECEIPTS,
  TRACE_NOTE,
  actMeta,
  citeKeyFor,
  evalAct3,
  gradeAct3Doc,
  gradeMeasurementSubmission,
  machineLine,
  runAct1,
  runAct2,
  traceFor,
  verifiedFor,
  type ActResult,
  type Act3Eval,
  type ModuleBytes,
  type ReceiptEvidence,
} from '../../src/lib/fleet-week'
import { citeToken, parseReceipts, runRecord, uncitedFigures, valuesOf, verifyReceipts, type ReceiptRunner } from '../../src/lib/fleet-receipts'
import { drawGradedSeeds } from '../../src/lib/graded-seed'
import type { RunRecord } from '../../src/lib/ledger/types'
import type { SimJob, SimResults } from '../../src/workers/sim-protocol'
import { makeProfile, startTab } from '../ledger/env'

const AT = '2026-10-14T09:00:00.000Z'
const E1 = 0x3a12
const E2 = 0x3a13
const NO_MODULES: ModuleBytes = { sched: null, mgr: null, queue: null }

/* ------------------- the page's re-run, in process ------------------- */

/** What sim.worker does with a request: draw the graded seeds from the entropy and run the act. */
async function runJob(job: SimJob, entropy: number): Promise<SimResults[SimJob['kind']]> {
  const { seeds } = drawGradedSeeds(entropy)
  if (job.kind === 'act1') return runAct1(job.modules, seeds)
  if (job.kind === 'act2') return runAct2(job.modules, job.choice, seeds)
  return evalAct3(seeds)
}

const RUNNER: ReceiptRunner = { run: runJob, bytes: async () => null }

/** One recorded run, as Fleet Week keeps it. */
async function recorded<K extends SimJob['kind']>(act: RunRecord['act'], job: Extract<SimJob, { kind: K }>, entropy: number): Promise<{ result: SimResults[K]; record: RunRecord }> {
  const result = (await runJob(job, entropy)) as SimResults[K]
  return { result, record: await runRecord(act, job, entropy, valuesOf(result), AT) }
}

/** The grading's evidence for `text`: its receipts checked against `records` by re-running, its uncited figures, the graded run. */
async function evidenceFor(text: string, records: readonly RunRecord[], runId: string): Promise<ReceiptEvidence> {
  return { runId, checks: await verifyReceipts(parseReceipts(text), records, RUNNER), uncited: uncitedFigures(text) }
}

/** A real all-reference trace result with its verdict set to pass: the fixture passing trace (no passing module is committed). */
function passing(result: ActResult, score = 0.9): ActResult {
  const { practice: _practice, ...rest } = result
  void _practice
  return { ...rest, pass: true, score }
}

const tokens = (record: RunRecord, ...keys: string[]): string => keys.map((k) => citeToken(record.id, k, record.values[k])).join(' and ')

/* ------------------------------------------------------------------ */
/* Acts I-II                                                            */
/* ------------------------------------------------------------------ */

describe.each([
  { act: 'engine' as const, label: 'Act I', keys: ['goodput', 'completed'], make: () => recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1), other: () => recorded('engine', { kind: 'act1', modules: NO_MODULES }, E2) },
  {
    act: 'fleet' as const,
    label: 'Act II',
    keys: ['completedPct', 'goodput'],
    make: () => recorded('fleet', { kind: 'act2', modules: NO_MODULES, choice: { workers: 4, router: 'jsq' } }, E1),
    other: () => recorded('fleet', { kind: 'act2', modules: NO_MODULES, choice: { workers: 4, router: 'jsq' } }, E2),
  },
])('$label passes with the trace pass, at least 2 verified receipts and no uncited figure', ({ act, keys, make, other }) => {
  test('a fixture passing trace with 2 verified receipts passes; the score is 0.6 of the trace and 0.4 for the receipts', async () => {
    const { result, record } = await make()
    const text = `The run measured ${tokens(record, ...keys)}, so the lever mattered.`
    const evidence = await evidenceFor(text, [record], record.id)
    expect(evidence.checks.map((c) => c.status)).toEqual(['verified', 'verified'])
    const graded = gradeMeasurementSubmission(act, passing(result, 0.9), evidence)
    expect(graded.pass).toBe(true)
    expect(graded.score).toBeCloseTo(0.9 * 0.6 + 0.4, 10)
    expect(graded.values).toEqual(result.values!)
    expect(graded.seed).toBe(result.seed!)
    expect(graded.metrics).toEqual([
      ['trace gate', 'pass'],
      ['receipts verified', `2 (need ${MIN_VERIFIED_RECEIPTS})`],
      ['uncited figures', '0 (need 0)'],
    ])
  })

  test('a trace score above 1 is capped, so the score never exceeds 1', async () => {
    const { result, record } = await make()
    const evidence = await evidenceFor(tokens(record, ...keys), [record], record.id)
    expect(gradeMeasurementSubmission(act, passing(result, 1.7), evidence).score).toBeCloseTo(1, 10)
  })

  test('one verified receipt is not enough, and the score keeps only the trace share', async () => {
    const { result, record } = await make()
    const evidence = await evidenceFor(tokens(record, keys[0]), [record], record.id)
    const graded = gradeMeasurementSubmission(act, passing(result, 0.9), evidence)
    expect(graded.pass).toBe(false)
    expect(graded.score).toBeCloseTo(0.9 * 0.6, 10)
    expect(graded.headline).toContain('verify at least 2 values')
  })

  test('the same value cited twice is one measurement', async () => {
    const { result, record } = await make()
    const evidence = await evidenceFor(`${tokens(record, keys[0])} then again ${tokens(record, keys[0])}`, [record], record.id)
    expect(evidence.checks).toHaveLength(2)
    expect(verifiedFor(evidence.checks, record.id)).toHaveLength(1)
    expect(gradeMeasurementSubmission(act, passing(result), evidence).pass).toBe(false)
  })

  test('a figure with a unit outside a receipt fails it, however many receipts verify', async () => {
    const { result, record } = await make()
    const text = `${tokens(record, ...keys)} and it took about 12 ms per step`
    const evidence = await evidenceFor(text, [record], record.id)
    expect(evidence.uncited.map((f) => f.text)).toEqual(['12 ms'])
    const graded = gradeMeasurementSubmission(act, passing(result, 0.9), evidence)
    expect(graded.pass).toBe(false)
    expect(graded.score).toBeCloseTo(0.9 * 0.6, 10)
    expect(graded.headline).toBe('cite it or cut it: 1 figure with a unit sits outside a receipt')
  })

  test('an edited value does not verify, and with it the write-up fails', async () => {
    const { result, record } = await make()
    const edited = `[[r:${record.id} ${keys[0]}=${record.values[keys[0]] + 5}]] and ${tokens(record, keys[1])}`
    const evidence = await evidenceFor(edited, [record], record.id)
    expect(evidence.checks.map((c) => c.status)).toEqual(['mismatch', 'verified'])
    expect(gradeMeasurementSubmission(act, passing(result), evidence).pass).toBe(false)
  })

  test('receipts of another run verify but do not count: the write-up is about the run being graded', async () => {
    const { result, record } = await make()
    const { record: elsewhere } = await other()
    const evidence = await evidenceFor(tokens(elsewhere, ...keys), [record, elsewhere], record.id)
    expect(evidence.checks.map((c) => c.status)).toEqual(['verified', 'verified'])
    expect(verifiedFor(evidence.checks, record.id)).toHaveLength(0)
    expect(gradeMeasurementSubmission(act, passing(result), evidence).pass).toBe(false)
  })

  test('a trace that has not passed fails the act whatever the receipts say', async () => {
    const { result, record } = await make()
    const evidence = await evidenceFor(tokens(record, ...keys), [record], record.id)
    const lost: ActResult = { ...result, pass: false, score: 0.5 }
    const graded = gradeMeasurementSubmission(act, lost, evidence)
    expect(graded.pass).toBe(false)
    expect(graded.score).toBeCloseTo(0.5 * 0.6 + 0.4, 10)
    expect(graded.headline).toBe('the executable trace gate is not green')
  })

  test('the words are not read: keywords, a word count and a screenshot buy nothing, and the receipts alone decide', async () => {
    const { result, record } = await make()
    const stuffed = 'ttft tpot queue kv hit goodput slo cost shed preempt scheduler admission headroom batch prefill intake router worker redundancy jsq topology node '.repeat(4)
    const stuffedEvidence = await evidenceFor(stuffed, [record], record.id)
    expect(stuffedEvidence.uncited).toEqual([])
    expect(gradeMeasurementSubmission(act, passing(result), stuffedEvidence).pass).toBe(false)
    // two bare receipts and nothing else pass: no length, no vocabulary, no number-with-a-unit requirement
    const bare = await evidenceFor(tokens(record, ...keys), [record], record.id)
    expect(gradeMeasurementSubmission(act, passing(result), bare).pass).toBe(true)
  })
})

describe('Act I passes only with one of your own components', () => {
  test('an all-reference run is practice: its trace fails, and receipts on it verify all the same', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    expect(result.pass).toBe(false)
    expect(result.practice).toBe(true)
    const evidence = await evidenceFor(tokens(record, 'goodput', 'refGoodput', 'completed'), [record], record.id)
    expect(evidence.checks.every((c) => c.status === 'verified')).toBe(true)
    const graded = gradeMeasurementSubmission('engine', result, evidence)
    expect(graded.pass).toBe(false)
    expect(graded.headline).toBe('the executable trace gate is not green')
  })
})

/* ------------------------------------------------------------------ */
/* Act III                                                              */
/* ------------------------------------------------------------------ */

describe('Act III passes with its executed SLO check and its $/Mtok as a verified receipt', () => {
  const run = (entropy = E1) => recorded('business', { kind: 'act3' }, entropy)

  test('the chosen option meets the SLO and its cost is a verified receipt: 0.55 + 0.45', async () => {
    const { result, record } = await run()
    const text = `B200: ${tokens(record, 'costPerMtok.b200')}.`
    const evidence = await evidenceFor(text, [record], record.id)
    const graded = gradeAct3Doc('b200', result, evidence)
    expect(graded.pass).toBe(true)
    expect(graded.score).toBeCloseTo(1, 10)
    expect(graded.values).toEqual(result.values)
    expect(graded.metrics.find(([l]) => l === 'cost receipt')?.[1]).toBe('verified')
    expect(graded.seed).toBe(result.seed)
  })

  test('no length, vocabulary or claim field is read: one bare receipt passes, and a stuffed doc without one fails', async () => {
    const { result, record } = await run()
    const bare = await evidenceFor(tokens(record, 'costPerMtok.b200'), [record], record.id)
    expect(gradeAct3Doc('b200', result, bare).pass).toBe(true)
    const stuffed = 'goodput slo cache batch frontier pareto cost shed ttft '.repeat(20)
    const none = await evidenceFor(stuffed, [record], record.id)
    const graded = gradeAct3Doc('b200', result, none)
    expect(graded.pass).toBe(false)
    expect(graded.score).toBeCloseTo(0.45, 10)
    expect(graded.headline).toContain('costPerMtok.b200')
  })

  test('an option that misses the SLO fails, with the cost verified: 0.55', async () => {
    const { result, record } = await run()
    const evidence = await evidenceFor(tokens(record, 'costPerMtok.h100'), [record], record.id)
    const graded = gradeAct3Doc('h100', result, evidence)
    expect(result.perOption.find((o) => o.id === 'h100')!.meetsSlo).toBe(false)
    expect(graded.pass).toBe(false)
    expect(graded.score).toBeCloseTo(0.55, 10)
    expect(graded.headline).toContain('misses the SLO')
  })

  test('the cost of another option, a value other than the cost, or an edited cost does not count', async () => {
    const { result, record } = await run()
    const wrongOption = await evidenceFor(tokens(record, 'costPerMtok.gb200'), [record], record.id)
    expect(gradeAct3Doc('b200', result, wrongOption).pass).toBe(false)
    const wrongValue = await evidenceFor(tokens(record, 'goodput.b200', 'meetsSlo.b200'), [record], record.id)
    expect(gradeAct3Doc('b200', result, wrongValue).pass).toBe(false)
    const edited = await evidenceFor(`[[r:${record.id} costPerMtok.b200=${record.values['costPerMtok.b200'] + 1}]]`, [record], record.id)
    expect(edited.checks[0].status).toBe('mismatch')
    expect(gradeAct3Doc('b200', result, edited).pass).toBe(false)
  })

  test('a cost verified on another evaluation is not the evaluation being defended', async () => {
    const { result, record } = await run(E1)
    const { record: elsewhere } = await run(E2)
    const evidence = await evidenceFor(tokens(elsewhere, 'costPerMtok.b200'), [record, elsewhere], record.id)
    expect(evidence.checks[0].status).toBe('verified')
    expect(gradeAct3Doc('b200', result, evidence).pass).toBe(false)
  })

  test('uncited figures are listed but do not fail Act III', async () => {
    const { result, record } = await run()
    const evidence = await evidenceFor(`${tokens(record, 'costPerMtok.b200')} and I expect 12 ms of slack`, [record], record.id)
    const graded = gradeAct3Doc('b200', result, evidence)
    expect(graded.pass).toBe(true)
    expect(graded.metrics.find(([l]) => l === 'uncited figures')?.[1]).toBe('1')
    expect(graded.detail).toContain('cite it or cut it')
  })

  test('an unknown option grades to nothing', () => {
    const e: Act3Eval = evalAct3(drawGradedSeeds(E1).seeds)
    expect(gradeAct3Doc('nope', e, { runId: '00000000', checks: [], uncited: [] })).toMatchObject({ pass: false, score: 0, headline: 'unknown hardware option' })
  })
})

/* ------------------------------------------------------------------ */
/* What an act records                                                  */
/* ------------------------------------------------------------------ */

describe('an act records its seed, provenance unseen and its receipts', () => {
  test('actMeta carries the seed, provenance unseen, the counts, the ids cited and the self-scores', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const evidence = await evidenceFor(`${tokens(record, 'goodput', 'completed')} then ${tokens(record, 'shed')} but 12 ms`, [record], record.id)
    const rubric = { capacity: 3, slo: 2, cost: 1, failure: 0 } as const
    expect(actMeta(result, evidence, rubric)).toEqual({
      seed: result.seed!,
      provenance: 'unseen',
      data: { receipts: { cited: 3, verified: 3, uncited: 1 }, runs: [record.id], rubric },
    })
    expect(actMeta(result, evidence).data).not.toHaveProperty('rubric')
  })

  test('the façade keeps it as the act’s data, the ledger flags the seed as unseen, and the rubric is never in the score', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const evidence = await evidenceFor(tokens(record, 'goodput', 'completed'), [record], record.id)
    const graded = gradeMeasurementSubmission('engine', passing(result, 0.9), evidence)
    const scoreOf = async (rubric?: { capacity: 0 | 1 | 2 | 3; slo: 0 | 1 | 2 | 3; cost: 0 | 1 | 2 | 3; failure: 0 | 1 | 2 | 3 }) => {
      const tab = startTab(makeProfile())
      tab.progress.getState().completeFleetWeekAct('engine', graded.score, actMeta(graded, evidence, rubric))
      await tab.progress.controls.flush()
      const [event] = (await (await tab.engine()).events()) as unknown as Array<{ kind: string; ref: string; score: number; provenance: string; seed?: number; data?: Record<string, unknown> }>
      return event
    }
    const high = await scoreOf({ capacity: 3, slo: 3, cost: 3, failure: 3 })
    const low = await scoreOf({ capacity: 0, slo: 0, cost: 0, failure: 0 })
    expect(high).toMatchObject({ kind: 'fleet-act', ref: 'fw:engine', provenance: 'unseen', seed: result.seed!, data: { receipts: { cited: 2, verified: 2, uncited: 0 }, runs: [record.id], rubric: { capacity: 3, slo: 3, cost: 3, failure: 3 } } })
    expect(low.data?.rubric).toEqual({ capacity: 0, slo: 0, cost: 0, failure: 0 })
    expect(high.score).toBe(low.score)
    expect(high.score).toBeCloseTo(graded.score, 10)
  })

  test('the rubric’s four keys are the codec’s RUBRIC_KEYS (D35, D48): the façade keeps a rubric of exactly these keys and drops one missing any', async () => {
    const keep = async (rubric: Record<string, number>) => {
      const tab = startTab(makeProfile())
      tab.progress.getState().completeFleetWeekAct('engine', 1, { provenance: 'unseen', data: { rubric: rubric as never } })
      await tab.progress.controls.flush()
      const [event] = (await (await tab.engine()).events()) as unknown as Array<{ data?: { rubric?: unknown } }>
      return event.data?.rubric
    }
    const all = Object.fromEntries(RUBRIC_KEYS.map((k) => [k, 2]))
    expect(await keep(all)).toEqual(all)
    for (const k of RUBRIC_KEYS) expect(await keep(Object.fromEntries(Object.entries(all).filter(([key]) => key !== k)))).toBeUndefined()
    // one source: the exemplars hand on ledger/constants.ts's own list, the one the codec and the façade read, not a copy
    // (tests/ledger/shared-bounds.test.ts holds every other file to it)
    expect(RUBRIC_KEYS).toBe(LEDGER_RUBRIC_KEYS)
    expect(RUBRIC.map((c) => c.key)).toEqual([...RUBRIC_KEYS])
  })
})

/* ------------------------------------------------------------------ */
/* Nothing but the receipts is read                                     */
/* ------------------------------------------------------------------ */

describe('the keyword lists, word counts and screenshot are gone', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  test('fleet-week.ts reads no keyword list, word count or screenshot', () => {
    const src = read('../../src/lib/fleet-week.ts')
    for (const gone of ['screenshot', 'metricTerms', 'decisionTerms', 'vocab', 'lengthOk', 'numericClaim', 'split(/', 'MeasurementEvidence', 'claimCost']) expect(src).not.toContain(gone)
  })

  test('the page has no file input and no screenshot, and keeps the analysis text only', () => {
    const src = read('../../src/pages/FleetWeek.tsx')
    for (const gone of ['type="file"', 'screenshot', 'ImagePlus', 'screenshotName', 'screenshotBytes']) expect(src).not.toContain(gone)
    expect(src).toContain("setEvidence('engine', { analysis: next })")
    expect(src).toContain("setEvidence('fleet', { analysis: next })")
  })

  test('the evidence setter takes no screenshot any more; evidence stored before keeps its fields', () => {
    const src = read('../../src/lib/progress.ts')
    const setter = src.slice(src.indexOf('  setFleetWeekEvidence: ('), src.indexOf(') => void', src.indexOf('  setFleetWeekEvidence: (')))
    expect(setter).toContain('analysis?: string')
    expect(setter).not.toContain('screenshot')
    // the stored shape (FleetWeekProgress) still reads what older events hold
    expect(src.slice(src.indexOf('export interface FleetWeekProgress'), src.indexOf('export type CodeLang'))).toContain('screenshotName?: string')
  })
})

describe('Act III says which number is modelled', () => {
  test('the tokens-served column is a modelled estimate (completed × 56 + completed × 288 × 0.6), and its header and its name say so', () => {
    const page = readFileSync(new URL('../../src/pages/FleetWeek.tsx', import.meta.url), 'utf8')
    expect(page).toContain('<th className="p-2.5" aria-label="tokens served (modelled), an estimate, not a measured count">tokens served (modelled)</th>')
    expect(page).not.toContain('<th className="p-2.5">tokens served</th>')
    expect(readFileSync(new URL('../../src/lib/fleet-week.ts', import.meta.url), 'utf8')).toContain('const tokensOut = stats.completed * 56 + stats.completed * 288 * 0.6')
  })
})

/* ------------------------------------------------------------------ */
/* The cite buttons                                                     */
/* ------------------------------------------------------------------ */

describe('every metric row that restates a value offers cite', () => {
  test('Act I: every §10.1 value is the row of a metric', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const cited = result.metrics.map(([l, t]) => citeKeyFor('engine', l, t)).filter((k): k is string => k !== null)
    expect(cited.sort()).toEqual(Object.keys(record.values).sort())
  })

  test('Act II: the rows restate the values, and the node-death event offers lost', async () => {
    const { result, record } = await recorded('fleet', { kind: 'act2', modules: NO_MODULES, choice: { workers: 2, router: 'jsq' } }, E1)
    const cited = result.metrics.map(([l, t]) => citeKeyFor('fleet', l, t)).filter((k): k is string => k !== null)
    expect(cited.sort()).toEqual(Object.keys(record.values).sort())
    expect(citeKeyFor('fleet', 'event', 't436: NODE DEATH — worker 0 lost with 16 in-flight requests')).toBe('lost')
    expect(citeKeyFor('fleet', 'event', 't600: FLASH CROWD')).toBeNull()
    expect(citeKeyFor('fleet', 'graded seed', '0x00003a12')).toBeNull()
    expect(citeKeyFor('engine', 'constructor', '1')).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* The capacity line the exemplars' arithmetic rests on                 */
/* ------------------------------------------------------------------ */

describe('the machine and trace lines the page prints', () => {
  test('state the pools, slots and SLO of the configs they describe', () => {
    expect(ACT1_MACHINE).toBe('256 KV blocks of 16 tokens (4,096 tokens), up to 16 running sequences, TTFT SLO 40 iterations (2000 ms at 50 ms per iteration)')
    expect(ACT2_MACHINE).toBe('128 KV blocks of 16 tokens (2,048 tokens), up to 12 running sequences, TTFT SLO 40 iterations (2000 ms at 50 ms per iteration)')
    expect(machineLine(HW_MENU[1].cfg)).toContain('512 KV blocks of 16 tokens (8,192 tokens), up to 32 running sequences')
    expect(machineLine(HW_MENU[2].cfg)).toContain('2048 KV blocks of 16 tokens (32,768 tokens), up to 96 running sequences')
  })

  test('the trace note matches the trace: three bursts of 45, a mix of light and heavy prompts, outputs of 16 to 96, the headroom', () => {
    expect(TRACE_NOTE).toContain(`${HEADROOM_TOKENS} tokens of headroom`)
    for (const seed of [PRACTICE_SEED, drawGradedSeeds(E1).seeds.trace, drawGradedSeeds(E2).seeds.trace]) {
      const trace = traceFor({ seed: null, trace: seed, faults: 0, deathPick: 0, deathTick: 0 })
      expect(trace).toHaveLength(240)
      const heavy = trace.filter((r) => r.prompt >= 768)
      expect(trace.every((r) => (r.prompt >= 64 && r.prompt <= 512) || (r.prompt >= 768 && r.prompt <= 1024))).toBe(true)
      expect(heavy.length / 240).toBeGreaterThan(0.06)
      expect(heavy.length / 240).toBeLessThan(0.18)
      expect(trace.every((r) => r.output >= 16 && r.output <= 96)).toBe(true)
      const meanPrompt = trace.reduce((a, r) => a + r.prompt, 0) / 240
      expect(meanPrompt).toBeGreaterThan(320) // "mean about 360": the expectation is 0.88 × 288 + 0.12 × 896 = 361
      expect(meanPrompt).toBeLessThan(400)
      const meanOutput = trace.reduce((a, r) => a + r.output, 0) / 240
      expect(Math.abs(meanOutput - 56)).toBeLessThan(5)
    }
    expect(0.88 * 288 + 0.12 * 896).toBeCloseTo(361, 0)
  })
})

/* ------------------------------------------------------------------ */
/* The exemplars                                                        */
/* ------------------------------------------------------------------ */

/** The record of one run an exemplar cites, rebuilt by running the act on its entropy. */
async function rebuild(run: Exemplar['runs'][number], act: Exemplar['act']): Promise<RunRecord> {
  if (act === 'engine') return (await recorded('engine', { kind: 'act1', modules: NO_MODULES }, run.entropy)).record
  if (act === 'fleet') return (await recorded('fleet', { kind: 'act2', modules: NO_MODULES, choice: run.choice! }, run.entropy)).record
  return (await recorded('business', { kind: 'act3' }, run.entropy)).record
}

describe('the rubric and its exemplars', () => {
  test('three exemplars per act, each scored 0 to 3 on all four criteria with a why, strong above middling above thin', () => {
    for (const act of ['engine', 'fleet', 'business'] as const) {
      const three = EXEMPLARS[act]
      expect(three).toHaveLength(3)
      expect(three.every((e) => e.act === act)).toBe(true)
      expect(exemplarTotal(three[0])).toBeGreaterThan(exemplarTotal(three[1]))
      expect(exemplarTotal(three[1])).toBeGreaterThan(exemplarTotal(three[2]))
      for (const e of three) {
        expect(Object.keys(e.scores).sort()).toEqual([...RUBRIC_KEYS].sort())
        expect(Object.keys(e.why).sort()).toEqual([...RUBRIC_KEYS].sort())
        for (const k of RUBRIC_KEYS) {
          expect([0, 1, 2, 3]).toContain(e.scores[k])
          expect(e.why[k].length).toBeGreaterThan(30)
        }
      }
    }
    expect(ALL_EXEMPLARS).toHaveLength(9)
    expect(new Set(ALL_EXEMPLARS.map((e) => e.id)).size).toBe(9)
  })

  test('the rubric has four criteria with four levels of one line each', () => {
    expect(RUBRIC).toHaveLength(4)
    for (const c of RUBRIC) {
      expect(c.levels).toHaveLength(4)
      expect(new Set(c.levels).size).toBe(4)
      expect(c.levels.every((l) => l.length > 10 && l.length < 140)).toBe(true)
    }
  })

  test('every receipt in every exemplar names a run it lists, and each run’s id is the record the act gives', async () => {
    for (const e of ALL_EXEMPLARS) {
      const ids = new Map<string, RunRecord>()
      for (const run of e.runs) {
        const record = await rebuild(run, e.act)
        expect(record.id).toBe(run.id)
        ids.set(run.id, record)
      }
      const receipts = parseReceipts(e.text)
      expect(receipts.length).toBeGreaterThan(0)
      for (const r of receipts) expect(ids.has(r.id)).toBe(true)
      // every listed run is cited
      for (const run of e.runs) expect(receipts.some((r) => r.id === run.id)).toBe(true)
    }
  })

  test('re-running every exemplar’s receipts verifies each one (the numbers are the simulation’s)', async () => {
    for (const e of ALL_EXEMPLARS) {
      const records = await Promise.all(e.runs.map((run) => rebuild(run, e.act)))
      const checks = await verifyReceipts(parseReceipts(e.text), records, RUNNER)
      expect(checks.map((c) => c.status).filter((s) => s !== 'verified')).toEqual([])
      expect(checks.length).toBe(parseReceipts(e.text).length)
    }
  })

  test('the strong and middling exemplars leave no figure uncited; the thin ones of Acts I and II leave exactly one', () => {
    for (const act of ['engine', 'fleet', 'business'] as const) {
      const [strong, middling, thin] = EXEMPLARS[act]
      expect(uncitedFigures(strong.text)).toEqual([])
      expect(uncitedFigures(middling.text)).toEqual([])
      expect(uncitedFigures(thin.text).length).toBe(act === 'business' ? 0 : 1)
    }
  })

  test('no exemplar is longer than the write-up box allows', () => {
    for (const e of ALL_EXEMPLARS) expect(e.text.length).toBeLessThanOrEqual(2400)
  })
})

describe('the arithmetic in the exemplars’ prose holds on the runs they cite', () => {
  test('Act I: 105 of 240 inside the SLO, 135 missed, seven iterations between queue and TTFT, 4,096 tokens, about nine requests', async () => {
    const { result, record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const v = record.values
    expect(Math.round((v.goodput / 100) * 240)).toBe(105)
    expect(240 - 105).toBe(135)
    expect(v.ttftP95 - v.queueP95).toBe(7)
    expect(v.preempts).toBe(0)
    expect(v.completed + v.shed).toBe(240)
    expect(256 * 16).toBe(4096)
    // the pool holds a request's prompt (near 360), what it has decoded (about half of 56) and the headroom
    expect(Math.floor(4096 / (360 + 28 + HEADROOM_TOKENS))).toBe(9)
    expect(result.values).toEqual(v)
  })

  test('Act I, shed: all 16 are intake overflow in the three flash crowds (a larger intake queue sheds none)', async () => {
    const { Engine, makeRefManager, makeRefQueue, makeRefScheduler } = await import('../../src/lib/fleet-model')
    const cfg = { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 }
    const seeds = drawGradedSeeds(E1).seeds
    const sheds = (depth: number) => {
      const e = new Engine(cfg, traceFor(seeds), makeRefScheduler(), makeRefManager(cfg.numBlocks, cfg.blockSize), { intake: makeRefQueue(depth), drainPerTick: 8 })
      const at: number[] = []
      let last = 0
      for (let t = 1; !e.done && t < 20000; t++) {
        e.step()
        const s = e.stats().shed
        if (s > last) at.push(t)
        last = s
      }
      return { shed: e.stats().shed, at }
    }
    const base = sheds(32)
    expect(base.shed).toBe(16)
    // the flash crowds land at ticks 225, 450 and 675 (span 900, quarters), two ticks long
    expect(base.at.every((t) => [225, 450, 675].some((b) => t >= b && t <= b + 3))).toBe(true)
    expect(sheds(128).shed).toBe(0)
  })

  test('Act II: 291 requests, 259 completed and 32 shed on two workers, 16 lost to the death and 16 to overflow; 23 points more on four', async () => {
    const two = (await recorded('fleet', { kind: 'act2', modules: NO_MODULES, choice: { workers: 2, router: 'jsq' } }, E1)).record.values
    const four = (await recorded('fleet', { kind: 'act2', modules: NO_MODULES, choice: { workers: 4, router: 'jsq' } }, E1)).record.values
    // 240 arrivals plus the flash crowd's 51 (every third iteration of 600..750, both ends)
    const injected = Array.from({ length: 151 }, (_, i) => 600 + i).filter((t) => t % 3 === 0).length
    expect(injected).toBe(51)
    const total = 240 + injected
    expect(total).toBe(291)
    for (const v of [two, four]) expect(Math.round(((total - v.shed) / total) * 1000) / 10).toBe(v.completedPct)
    expect(total - two.shed).toBe(259)
    expect([two.shed, two.lost, two.shed - two.lost]).toEqual([32, 16, 16])
    expect([four.shed, four.lost]).toEqual([2, 2])
    expect(Math.round((four.goodput - two.goodput) * 10) / 10).toBe(23)
    expect(two.completedPct).toBeLessThan(92)
    expect(two.goodput).toBeLessThan(40)
    expect(two.ttftP95).toBeGreaterThan(four.ttftP95)
  })

  test('Act III: the pools, the 51,251 tokens every option serves, the run-length and price ratios, the break-even and the rack’s 32 times', async () => {
    const a = (await recorded('business', { kind: 'act3' }, E1)).result
    const b = (await recorded('business', { kind: 'act3' }, E2)).result
    const cost = (e: Act3Eval, id: string) => e.values[`costPerMtok.${id}`]
    const hourly = (id: string) => HW_MENU.find((h) => h.id === id)!.hourlyUsd
    expect(a.perOption.map((o) => o.tokensOut)).toEqual([51251, 51251, 51251])
    expect(HW_MENU[1].cfg.numBlocks * HW_MENU[1].cfg.blockSize).toBe(8192)
    expect(HW_MENU[0].cfg.numBlocks * HW_MENU[0].cfg.blockSize).toBe(4096)
    expect(HW_MENU[1].cfg.maxRunning / HW_MENU[0].cfg.maxRunning).toBe(2)
    expect(HW_MENU[1].cfg.prefillChunk).toBeGreaterThan(HW_MENU[0].cfg.prefillChunk)
    // cost = price × run length over equal tokens, so the run-length ratio is the cost ratio over the price ratio
    const priceRatio = hourly('b200') / hourly('h100')
    expect(Math.round((priceRatio - 1) * 100)).toBe(12)
    expect(Math.round((cost(a, 'b200') / cost(a, 'h100') / priceRatio) * 100)).toBe(63)
    // the B200 stays cheaper than the H100 until its hourly price is about 41 % higher
    expect(Math.round((cost(a, 'h100') / cost(a, 'b200') - 1) * 100)).toBe(41)
    // the rack: 32 times the B200's cost, the same as its price ratio, so its run is no shorter
    expect(Math.round(cost(a, 'gb200') / cost(a, 'b200'))).toBe(32)
    expect(Math.round((hourly('gb200') / hourly('b200')) * 10) / 10).toBe(32.1)
    expect(a.values['meetsSlo.b200']).toBe(1)
    expect(a.values['meetsSlo.h100']).toBe(0)
    expect(b.values['goodput.b200']).toBe(69.6)
    expect(b.values['meetsSlo.b200']).toBe(1)
    expect(Math.round(a.values['goodput.b200'] - 50)).toBe(22)
  })

  test('the typed cite of a run value is the shortest form that verifies', async () => {
    const { record } = await recorded('engine', { kind: 'act1', modules: NO_MODULES }, E1)
    const checks = await verifyReceipts(parseReceipts(Object.keys(record.values).map((k) => citeToken(record.id, k, record.values[k])).join(' ')), [record], RUNNER)
    expect(checks.every((c) => c.status === 'verified')).toBe(true)
    expect(checks).toHaveLength(Object.keys(record.values).length)
  })
})
