/**
 * Every attempt Prove-it v2 builds is one the ledger keeps (the 3a final review's B2). `buildProve2Result` is the
 * `recordProve` argument; the façade shows its event at once and the engine drops it at the outbox recovery when the
 * codec refuses it, so an attempt the codec cannot store, with any `proved` it earned, would vanish on reload. Here every
 * output, made into the event `recordProve` writes, passes `validateEvent`: over lab 02's templates and synthetic
 * ones, many seeds, answers typed by a hostile learner, raw answers a buggy panel might pass, and replies and readings
 * no module should give. Outputs also keep the ledger contract: `ok` is answer-equals-actual and `score` is `ok ? 1 : 0`.
 */
import { describe, expect, test } from 'bun:test'
import { PROVE2 } from '../../src/data/forge/kv-block-manager/prove2'
import type { ProveV2Template } from '../../src/data/forge/types'
import {
  buildProve2Result,
  gradeAnswer,
  isProve2Answer,
  planQuestion,
  PROVE2_MAX_CALLS,
  PROVE2_MAX_QID,
  proveFromModule,
  readAnswer,
  type CallOutcome,
  type Eligibility,
  type GradedRun,
} from '../../src/lib/forge/prove2'
import { validateEvent } from '../../src/lib/ledger/codec'
import { dayOf } from '../../src/lib/ledger/time'
import type { ProveData, ProveResult } from '../../src/lib/ledger/types'
import { splitmix32 } from '../../src/lib/rng'
import { makeProfile, startTab } from '../ledger/env'
import { fakeBlockManager, fakeBridge, trap } from './fixtures'

type Rand = () => number
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
const chance = (r: Rand, p: number) => r() < p

const SHA = 'ab'.repeat(32)
const AT = '2026-10-14T09:30:00.000Z'

/** The event `recordProve` writes for `r`, envelope and all, before the façade's own checks. */
function asEvent(r: ProveResult) {
  const { labId, provenance, ...rest } = r
  return { id: 't:1', v: 1, kind: 'prove', ref: `prove:${labId}`, at: AT, tz: 0, day: dayOf(AT, 0), dev: 'dev-1', provenance: provenance ?? 'practice', ...rest }
}

function expectKept(r: ProveResult, context: string) {
  const checked = validateEvent(asEvent(r))
  if (!checked.ok) throw new Error(`${context}: the codec refuses ${JSON.stringify(r)}: ${checked.reason}`)
  // §3.2: ok means right, and the score is ok ? 1 : 0
  const d = r.data as { answer: number | number[]; actual: number | number[] | null }
  const right = d.actual !== null && JSON.stringify(d.answer) === JSON.stringify(d.actual)
  expect(r.ok).toBe(right)
  expect(r.score).toBe(right ? 1 : 0)
  if (r.provenance === 'proved') expect(r.ok && r.wasmSha256 === SHA).toBe(true)
}

/* ------------------------------ hostile inputs ------------------------------ */

const ODD_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, -5, 2.5, 1e308, 2 ** 53 + 2, 0, 7, 31]

/** A value a template's `read` or a buggy panel might hand over: anything, mostly near the codec's edges. */
function oddValue(r: Rand): unknown {
  switch (int(r, 0, 5)) {
    case 0:
      return pick(r, ODD_NUMBERS)
    case 1:
      return int(r, -3, 40)
    case 2:
    case 3:
      return Array.from({ length: int(r, 0, 20) }, () => (chance(r, 0.85) ? int(r, 0, 31) : pick(r, [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, -0, 2 ** 60, '3', null])))
    case 4:
      return Array.from({ length: int(r, 0, 12) }, () => int(r, 0, 31))
    default:
      return pick(r, [null, undefined, '7', '', {}, [[1]], true])
  }
}

/** What a learner might type into the box. */
function oddText(r: Rand): string {
  const ids = () => Array.from({ length: int(r, 0, 16) }, () => (chance(r, 0.9) ? String(int(r, 0, 40)) : pick(r, ['-1', '1.5', 'x', '+2', '1e3', '9'.repeat(30), '0x1f'])))
  switch (int(r, 0, 4)) {
    case 0:
      return ids().join(pick(r, [', ', ',', ' ', ' ,  ']))
    case 1:
      return pick(r, ['', ' ', 'none', 'NONE', ', ,', 'none, 1', '-', '1'.repeat(400), '-3', '2.5', ' 12 ', 'twelve', '3, 7, 1'])
    case 2:
      return String(int(r, -100, 100))
    case 3:
      return `${int(r, 0, 99)}.${int(r, 0, 99)}`
    default:
      return Array.from({ length: int(r, 10, 14) }, () => String(int(r, 0, 31))).join(', ')
  }
}

/** A reply a lab 02 module could send to any call, most of them not the protocol's. */
const ODD_REPLIES = ['', 'ok', 'true', 'false', 'none', 'err unknown command', '0', '7', '31', '-3', '2.5', '1e400', '9'.repeat(400), ' 12 ', 'NaN', 'Infinity', '0x1f', '3,7,1', '\u0000']

const oddEligibility = (r: Rand): Eligibility =>
  pick(r, [{ credited: true }, { credited: false, reason: 'credit' }, { credited: false, reason: 'module' }, { credited: false, reason: 'retry', opensAt: 5 }] as Eligibility[])
const oddSha = (r: Rand): string | null => pick(r, [SHA, SHA, null, 'AB'.repeat(32), 'ab'.repeat(31), 'not a hash', ''])
const oddMs = (r: Rand): number | undefined => pick(r, [undefined, 0, 41_234.6, -5, Number.NaN, Number.POSITIVE_INFINITY, 1e12])

/* ------------------------------ lab 02, through the whole attempt ------------------------------ */

describe('every attempt on lab 02 passes the codec', () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 2]).buffer

  test('its three templates, 400 seeds each, correct and hostile modules, typed answers and their truths', async () => {
    let built = 0
    let proved = 0
    for (const t of PROVE2.templates) {
      for (let seed = 0; seed < 400; seed++) {
        const r = splitmix32(seed * 7919 + t.id.length)
        const plan = planQuestion(t, seed * 2654435761)
        const correct = chance(r, 0.5)
        const module = correct
          ? fakeBlockManager({ lifo: chance(r, 0.5) })
          : () => (cmd: string) => (chance(r, 0.05) && cmd !== plan.calls[0] ? trap('boom') : pick(r, ODD_REPLIES))
        const run = fakeBridge(module).run
        // the module's own answer, when it has one, half the time; otherwise whatever the learner typed
        const truth = await run(bytes, plan.calls).then((replies) => {
          try {
            return t.read(replies)
          } catch {
            return null
          }
        }, () => null)
        const typed = readAnswer(oddText(r), plan.answer)
        const answer = truth !== null && isProve2Answer(truth) && chance(r, 0.5) ? truth : typed.ok ? typed.answer : null
        if (answer === null) continue
        const graded: GradedRun | null = pick(r, [{ sha256: SHA, credit: 'unseen' }, { sha256: SHA, credit: 'lab-green' }, null] as const)
        const result = await proveFromModule({
          labId: 'kv-block-manager',
          template: t,
          plan,
          answer,
          bytes,
          graded,
          history: [],
          now: 0,
          run,
          hash: pick(r, [async () => SHA, async () => 'AB'.repeat(32), async () => { throw new Error('no crypto.subtle') }]),
          ...(chance(r, 0.5) ? { ms: oddMs(r) } : {}),
          ...(chance(r, 0.2) ? { ret: true } : {}),
        })
        if (result.kind === 'refused') throw new Error(result.message)
        expectKept(result.result, `${t.id} seed ${seed}`)
        built++
        if (result.result.provenance === 'proved') proved++
      }
    }
    expect(built).toBeGreaterThan(600)
    expect(proved).toBeGreaterThan(20) // the property covers proved events, not only practice
  })
})

/* ------------------------------ synthetic templates, straight into the builder ------------------------------ */

describe('every buildProve2Result output passes the codec', () => {
  const synthetic = (r: Rand, read: () => unknown): ProveV2Template => ({
    id: 'q'.repeat(int(r, 1, PROVE2_MAX_QID)),
    kcs: Array.from({ length: int(r, 0, 10) }, (_, i) => `kc.synthetic.${i}` as never),
    bug: 'none',
    make: () => ({ calls: Array.from({ length: int(r, 1, PROVE2_MAX_CALLS) }, (_, i) => `call ${i}`), story: ['A story.'], ask: 'What?', answer: chance(r, 0.5) ? 'ids' : 'number' }),
    read: read as () => number,
  })

  test('templates reading anything, over many seeds, with hostile answers, outcomes, hashes and timings', () => {
    let built = 0
    let refusedAnswers = 0
    for (let seed = 0; seed < 4000; seed++) {
      const r = splitmix32(seed + 1)
      const reading = oddValue(r)
      const template = synthetic(r, chance(r, 0.15) ? () => { throw new Error('unreadable') } : () => reading)
      const plan = planQuestion(template, int(r, 0, 0xffffffff))
      const outcome: Exclude<CallOutcome, { kind: 'refused' }> = chance(r, 0.15)
        ? { kind: 'failed', reason: pick(r, ['trap', 'timeout', 'error'] as const), message: 'failed' }
        : { kind: 'replied', replies: plan.calls.map(() => pick(r, ODD_REPLIES)) }
      // half typed through readAnswer, half handed over raw, as a buggy panel might
      const typed = readAnswer(oddText(r), plan.answer)
      const raw = chance(r, 0.5) ? oddValue(r) : typed.ok ? typed.answer : oddValue(r)
      const grade = gradeAnswer(template, isProve2Answer(raw) ? raw : 0, outcome)
      const input = { labId: 'lab-x', plan, answer: raw as number, grade, eligibility: oddEligibility(r), moduleSha: oddSha(r), ms: oddMs(r), ...(chance(r, 0.2) ? { ret: true } : {}) }
      if (!isProve2Answer(raw)) {
        expect(() => buildProve2Result(input)).toThrow(RangeError)
        refusedAnswers++
        continue
      }
      expectKept(buildProve2Result(input), `seed ${seed}`)
      built++
    }
    expect(built).toBeGreaterThan(2000)
    expect(refusedAnswers).toBeGreaterThan(200)
  })

  test('a grade that came from anywhere (a stale or hand-made one) still builds a kept event', () => {
    const plan = planQuestion({ ...PROVE2.templates[0] }, 7)
    for (let seed = 0; seed < 2000; seed++) {
      const r = splitmix32(seed + 77)
      const answer = oddValue(r)
      if (!isProve2Answer(answer)) continue
      const grade = { right: chance(r, 0.5), actual: oddValue(r) as number | null, failed: pick(r, [null, 'trap', 'timeout', 'error'] as const) }
      expectKept(buildProve2Result({ labId: 'kv-block-manager', plan, answer, grade, eligibility: oddEligibility(r), moduleSha: oddSha(r) }), `seed ${seed}`)
    }
  })

  test('every text a learner can type either reads as an answer the codec stores, or says what to type instead', () => {
    for (let seed = 0; seed < 5000; seed++) {
      const r = splitmix32(seed + 9)
      const read = readAnswer(oddText(r), chance(r, 0.5) ? 'ids' : 'number')
      if (read.ok) expect(isProve2Answer(read.answer)).toBe(true)
      else expect(read.message.length).toBeGreaterThan(20)
    }
  })
})

/* ------------------------------ and the façade writes it as built ------------------------------ */

describe('the façade writes what prove2 built, unchanged, and the engine keeps every one', () => {
  test('200 built results recorded and flushed: the same events come back, each one the codec takes', async () => {
    const tab = startTab(makeProfile())
    const built: ProveResult[] = []
    const plan = planQuestion(PROVE2.templates[1], 3)
    for (let seed = 0; built.length < 200; seed++) {
      const r = splitmix32(seed + 500)
      const answer = oddValue(r)
      if (!isProve2Answer(answer)) continue
      const actual = chance(r, 0.4) ? answer : (oddValue(r) as number | null)
      const result = buildProve2Result({ labId: 'kv-block-manager', plan, answer, grade: { right: false, actual, failed: null }, eligibility: oddEligibility(r), moduleSha: oddSha(r), ms: oddMs(r), ...(chance(r, 0.2) ? { ret: true } : {}) })
      built.push(result)
      tab.progress.getState().recordProve({ ...result, data: result.data as ProveData })
    }
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()) as unknown as Array<Record<string, unknown>>
    expect(events).toHaveLength(built.length)
    const byOrder = [...events].sort((a, b) => Number.parseInt(String(a.id).split(':')[1], 36) - Number.parseInt(String(b.id).split(':')[1], 36))
    byOrder.forEach((e, i) => {
      const want = asEvent(built[i])
      expect(e).toMatchObject({ ...want, id: e.id, at: e.at, day: e.day, dev: e.dev })
      expect(validateEvent(e).ok).toBe(true)
    })
  })
})
