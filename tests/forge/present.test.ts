/**
 * What ForgeLab shows for a run (src/lib/forge/present.ts): rows that fill in as checks finish, the panic text
 * and trace under a trap, and the sentence for each provenance, including "reference module: no credit".
 */
import { describe, expect, test } from 'bun:test'
import type { ForgeLabCheck } from '../../src/data/labs'
import { FORGE_LABS } from '../../src/data/labs'
import { creditFor } from '../../src/lib/forge/run'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { buildRows, creditNote, creditedRequiredPass, hasDetail, requiredFailedCount, resultsOf, tally, unseenCount } from '../../src/lib/forge/present'

const lab01 = FORGE_LABS.find((l) => l.id === 'rust-allocator')!
const expected: ForgeLabCheck[] = [
  { id: 'boot', label: 'boots', stage: 1 },
  { id: 'align', label: 'aligns', stage: 2 },
  { id: 'extra', label: 'advanced one', optional: true },
]
const res = (id: string, status: CheckResult['status'], more: Partial<CheckResult> = {}): CheckResult => ({ id, label: id, status, msg: `${id} ${status}`, ...more })
const report = (checks: CheckResult[], more: Partial<LabRunReport> = {}): LabRunReport => ({
  lab: 'rust-allocator',
  reference: false,
  abi: 2,
  version: 2,
  checks,
  seeds: 'fresh',
  ms: 5,
  ...more,
})
const REQUIRED = ['boot', 'align']

describe('rows while the run is in flight', () => {
  test('every expected check is listed, waiting; the one that started is running', () => {
    const rows = buildRows(expected, new Map(), 'boot')
    expect(rows.map((r) => [r.id, r.state])).toEqual([
      ['boot', 'running'],
      ['align', 'pending'],
      ['extra', 'pending'],
    ])
    expect(rows[2].optional).toBe(true)
    expect(rows[0].stage).toBe(1)
  })

  test('a finished check keeps its place and carries its message', () => {
    const rows = buildRows(expected, new Map([['boot', res('boot', 'pass')]]), 'align')
    expect(rows.map((r) => r.state)).toEqual(['pass', 'running', 'pending'])
    expect(rows[0].msg).toBe('boot pass')
  })

  test('a check the module reports but the page did not list is shown, never dropped', () => {
    const rows = buildRows(expected, new Map([['surprise', res('surprise', 'fail')]]))
    expect(rows.map((r) => r.id)).toEqual(['boot', 'align', 'extra', 'surprise'])
    expect(rows[3].state).toBe('fail')
  })
})

describe('per-check results: panic text and trace', () => {
  const trap = res('boot', 'trap', {
    msg: 'not implemented yet: construct your allocator (src/allocator.rs:3:140)',
    panic: 'panicked at src/allocator.rs:3:140: not yet implemented: construct your allocator',
    trace: 'alloc 64\nfree 0',
    seed: 7,
    fresh: true,
    ms: 0.4,
  })

  test('a trapped row keeps the panic text verbatim and the trace, and offers them', () => {
    const [row] = buildRows(expected, resultsOf(report([trap])))
    expect(row.state).toBe('trap')
    expect(row.panic).toBe(trap.panic)
    expect(row.trace).toBe('alloc 64\nfree 0')
    expect(hasDetail(row)).toBe(true)
    expect(row.seed).toBe(7)
    expect(row.fresh).toBe(true)
  })

  test('a passing check with nothing to show has no detail', () => {
    const [row] = buildRows(expected, resultsOf(report([res('boot', 'pass')])))
    expect(hasDetail(row)).toBe(false)
    expect('panic' in row).toBe(false)
  })

  test('a timeout is a red row with its own state', () => {
    const [row] = buildRows(expected, resultsOf(report([res('boot', 'timeout')])))
    expect(row.state).toBe('timeout')
  })
})

describe('the tally', () => {
  test('counts required and advanced passes separately', () => {
    const rows = buildRows(expected, resultsOf(report([res('boot', 'pass'), res('align', 'fail'), res('extra', 'pass')])))
    expect(tally(rows)).toEqual({ required: 1, requiredTotal: 2, advanced: 1, advancedTotal: 1 })
  })

  test('lab 01 lists its six required checks with the stage labs.ts gives each', () => {
    const rows = buildRows(lab01.checks, new Map())
    expect(rows.filter((r) => !r.optional)).toHaveLength(6)
    expect(rows.every((r) => r.stage !== undefined)).toBe(true)
  })
})

describe('what the run earned', () => {
  const green = [res('boot', 'pass'), res('align', 'pass', { seed: 1, fresh: true })]

  test('unseen: every required check passed on fresh seeds', () => {
    const r = report(green)
    const credit = creditFor(r, {}, REQUIRED)
    expect(credit).toBe('unseen')
    const note = creditNote(credit, r, { required: 2, unseenSoFar: unseenCount(r, REQUIRED), requiredFailed: requiredFailedCount(r, REQUIRED) })
    expect(note.label).toBe('unseen')
    expect(note.tone).toBe('full')
  })

  test('a reference module says "reference module: no credit" and nothing else', () => {
    const r = report(green, { reference: true })
    const credit = creditFor(r, {}, REQUIRED)
    expect(credit).toBeNull()
    const note = creditNote(credit, r, { required: 2, unseenSoFar: 2, requiredFailed: 0 })
    expect(note.label).toBe('reference module: no credit')
    expect(note.tone).toBe('none')
    expect(note.detail).toContain('nothing is recorded')
  })

  test('assisted inside the bottom-out window, and the note says how to restore full credit', () => {
    const r = report(green)
    const credit = creditFor(r, { assistedUntil: '2099-01-01T00:00:00.000Z', at: '2098-12-31T00:00:00.000Z' }, REQUIRED)
    expect(credit).toBe('assisted')
    const note = creditNote(credit, r, { required: 2, unseenSoFar: 2, requiredFailed: 0 })
    expect(note.label).toBe('assisted')
    expect(note.detail).toContain('unseen-seed pass')
  })

  test('a v1 build is lab-green and the note carries the rebuild line', () => {
    const r = report([res('boot', 'pass'), res('align', 'pass')], { abi: 1, seeds: 'default' })
    const credit = creditFor(r, {}, REQUIRED)
    expect(credit).toBe('lab-green')
    expect(creditNote(credit, r, { required: 2, unseenSoFar: 0, requiredFailed: 0 }).detail).toContain('rebuild for per-check results')
  })

  test('a v2 run with a red required check is lab-green and says how many are unseen so far', () => {
    const r = report([res('boot', 'pass'), res('align', 'fail', { seed: 3, fresh: true })])
    const credit = creditFor(r, {}, REQUIRED)
    expect(credit).toBe('lab-green')
    const note = creditNote(credit, r, { required: 2, unseenSoFar: unseenCount(r, REQUIRED), requiredFailed: requiredFailedCount(r, REQUIRED) })
    expect(note.detail).toContain('1 of 2 so far')
  })

  test('a failing run after an unseen pass keeps the earlier pass and never says every check passed', () => {
    const r = report([res('boot', 'pass'), res('align', 'fail', { seed: 3, fresh: true })])
    const earlier = { boot: true, align: true } as const
    const credit = creditFor(r, { unseen: earlier }, REQUIRED)
    expect(credit).toBe('unseen')
    const note = creditNote(credit, r, { required: 2, unseenSoFar: unseenCount(r, REQUIRED, earlier), requiredFailed: requiredFailedCount(r, REQUIRED) })
    expect(note.label).toBe('unseen')
    expect(note.tone).toBe('partial')
    expect(note.detail).toContain('earlier run')
    expect(note.detail).toContain('stands')
    expect(note.detail).toContain('failed 1 required check,')
    expect(note.detail).not.toContain('Every required check passed')
  })

  test('a spinning build (every check timed out) after an unseen pass counts every required check as failed', () => {
    const r = report([res('boot', 'timeout'), res('align', 'timeout', { seed: 3, fresh: true }), res('extra', 'timeout')])
    const earlier = { boot: true, align: true } as const
    const credit = creditFor(r, { unseen: earlier }, REQUIRED)
    expect(credit).toBe('unseen')
    expect(requiredFailedCount(r, REQUIRED)).toBe(2)
    const note = creditNote(credit, r, { required: 2, unseenSoFar: 2, requiredFailed: 2 })
    expect(note.detail).toContain('failed 2 required checks')
    expect(note.detail).not.toContain('Every required check passed')
  })

  test('a required check the module never reported counts as failed', () => {
    expect(requiredFailedCount(report([res('boot', 'pass')]), REQUIRED)).toBe(1)
    expect(requiredFailedCount(report(green), REQUIRED)).toBe(0)
  })

  test('the all-green run on fresh seeds still says every required check passed', () => {
    const note = creditNote('unseen', report(green), { required: 2, unseenSoFar: 2, requiredFailed: 0 })
    expect(note.detail).toContain('Every required check passed')
    expect(note.tone).toBe('full')
  })

  test('a green reference run has no credit, so the lab is not passed and Prove it stays shut', () => {
    const r = report(green, { reference: true })
    const counts = tally(buildRows(expected, resultsOf(r)))
    expect(counts.required).toBe(counts.requiredTotal)
    expect(creditedRequiredPass(creditFor(r, {}, REQUIRED), counts)).toBe(false)
    expect(creditedRequiredPass(creditFor(report(green), {}, REQUIRED), counts)).toBe(true)
    expect(creditedRequiredPass(creditFor(report([res('boot', 'pass'), res('align', 'fail')]), {}, REQUIRED), tally(buildRows(expected, resultsOf(report([res('boot', 'pass'), res('align', 'fail')])))))).toBe(false)
  })

  test('unseenCount adds the checks an earlier unseen run already passed', () => {
    const r = report([res('boot', 'fail'), res('align', 'pass', { seed: 3, fresh: true })])
    expect(unseenCount(r, REQUIRED)).toBe(1)
    expect(unseenCount(r, REQUIRED, { boot: true })).toBe(2)
  })

  test('default seeds earn no unseen count', () => {
    const r = report([res('boot', 'pass'), res('align', 'pass')], { seeds: 'default' })
    expect(unseenCount(r, REQUIRED)).toBe(0)
  })
})
