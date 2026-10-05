import { afterAll, describe, expect, test } from 'bun:test'
import { creditFor, toLabRun, unseenPasses } from '../../src/lib/forge/run'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { disposeLabWorker, runLab, runLabInWorker, validateLabInWorker } from '../../src/lib/lab-worker'
import { LabAbiError } from '../../src/lib/wasm-lab'
import { validateModule } from '../../src/pages/fleet/drivers'
import { verifyAndScoreScheduler } from '../../src/lib/leaderboard'
import type { TraceArtifact } from '../../src/lib/traces'
import { tinyLabWasm } from './fixtures'

afterAll(() => disposeLabWorker())

const REQUIRED = ['boot', 'align', 'coalesce']
const row = (id: string, status: CheckResult['status'], seed?: number, fresh?: boolean): CheckResult => ({
  id,
  label: id,
  status,
  msg: '',
  ...(seed === undefined ? {} : { seed }),
  ...(fresh === undefined ? {} : { fresh }),
})
const report = (checks: CheckResult[], extra: Partial<LabRunReport> = {}): LabRunReport => ({
  lab: 'rust-allocator',
  reference: false,
  abi: 2,
  version: 2,
  checks,
  seeds: 'fresh',
  ms: 10,
  ...extra,
})
const green = () => [row('boot', 'pass'), row('align', 'pass', 41, true), row('coalesce', 'pass')]

describe('creditFor (§12.3)', () => {
  test('a fresh-seed v2 run with every required check green is unseen', () => {
    expect(creditFor(report(green()), {}, REQUIRED)).toBe('unseen')
    expect(unseenPasses(report(green()))).toEqual(['boot', 'align', 'coalesce'])
  })

  test('@reference earns nothing, whatever else is true', () => {
    expect(creditFor(report(green(), { reference: true }), {}, REQUIRED)).toBeNull()
    expect(creditFor(report(green(), { reference: true, seeds: 'default' }))).toBeNull()
    expect(creditFor(report(green(), { reference: true, abi: 1 }))).toBeNull()
    expect(creditFor(report(green(), { reference: true }), { assistedUntil: '2999-01-01T00:00:00.000Z' })).toBeNull()
  })

  test('default seeds, ABI 1 or a red required check is lab-green', () => {
    expect(creditFor(report(green(), { seeds: 'default' }), {}, REQUIRED)).toBe('lab-green')
    expect(creditFor(report(green(), { abi: 1 }), {}, REQUIRED)).toBe('lab-green')
    expect(creditFor(report([row('boot', 'pass'), row('align', 'trap', 41, true), row('coalesce', 'pass')]), {}, REQUIRED)).toBe('lab-green')
  })

  test('a seeded check passed on its default seed is not unseen', () => {
    const r = report([row('boot', 'pass'), row('align', 'pass', 0xa11c, false), row('coalesce', 'pass')])
    expect(unseenPasses(r)).toEqual(['boot', 'coalesce'])
    expect(creditFor(r, {}, REQUIRED)).toBe('lab-green')
  })

  test('the per-check union: checks passed on an earlier unseen run still count', () => {
    const r = report([row('boot', 'pass'), row('align', 'timeout', 7, true), row('coalesce', 'pass')])
    expect(creditFor(r, { unseen: { align: true } }, REQUIRED)).toBe('unseen')
    expect(creditFor(r, { unseen: { boot: true } }, REQUIRED)).toBe('lab-green')
  })

  test('only required checks matter; with no list, every reported check is required', () => {
    const r = report([...green(), row('stretch', 'fail')])
    expect(creditFor(r, {}, REQUIRED)).toBe('unseen')
    expect(creditFor(r)).toBe('lab-green')
  })

  test('inside the H3 bottom-out window a run is assisted, even on unseen seeds; after it, unseen again', () => {
    const until = '2026-10-06T12:00:00.000Z'
    expect(creditFor(report(green()), { assistedUntil: until, at: '2026-10-06T11:59:59.000Z' }, REQUIRED)).toBe('assisted')
    expect(creditFor(report(green()), { assistedUntil: until, at: '2026-10-06T12:00:00.000Z' }, REQUIRED)).toBe('unseen')
  })

  test('the recordLabRun payload carries the provenance creditFor gave', () => {
    const run = toLabRun(report(green()), 'unseen', REQUIRED)
    expect(run).toMatchObject({ labId: 'rust-allocator', passed: REQUIRED, total: 3, abi: 2, seeds: 'fresh', provenance: 'unseen' })
  })
})

describe('a reference module is denied everywhere (G6)', () => {
  const refWasm = (lab: string) => tinyLabWasm({ lab: `${lab}@reference` })

  test('ForgeLab: the report keeps @reference, so it never matches the page’s lab id, and creditFor gives none', async () => {
    const legacy = await runLabInWorker(refWasm('rust-allocator'))
    expect(legacy.lab).toBe('rust-allocator@reference')
    expect(legacy.lab).not.toBe('rust-allocator')
    expect(legacy.reference).toBe(true)
    const full = await runLab(refWasm('rust-allocator'), { seeds: 'fresh' })
    expect(full).toMatchObject({ lab: 'rust-allocator', reference: true })
    expect(creditFor(full)).toBeNull()
  })

  test('Fleet admission refuses it before running anything', async () => {
    const err = await validateLabInWorker(refWasm('kv-block-manager')).catch((e) => e)
    expect(err).toBeInstanceOf(LabAbiError)
    expect(err.message).toContain('reference build')
    const verdict = await validateModule(refWasm('kv-block-manager'), 'kv-block-manager')
    expect(verdict.ok).toBe(false)
  })

  test('the leaderboard refuses it', async () => {
    const trace = {} as TraceArtifact
    const err = await verifyAndScoreScheduler(refWasm('batching-scheduler'), trace, trace).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String(err.message)).toContain('reference build')
  })

  test('a learner build of the same module is admitted to the next step', async () => {
    const r = await validateLabInWorker(tinyLabWasm({ lab: 'kv-block-manager' }))
    /* the tiny module has no ks_invoke: the caller's "rebuild with the bridge" path, not a reference refusal */
    expect(r).toEqual({ report: null, hasInvoke: false })
  })
})
