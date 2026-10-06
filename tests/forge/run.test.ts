import { afterAll, describe, expect, test } from 'bun:test'
import {
  assembleReport,
  callRun,
  driveLabRun,
  fromV1Report,
  listChecks,
  runCheck,
  runChecks,
  stageReached,
  timeoutResult,
  toLabRun,
  toLegacyReport,
  type LabPool,
  type LabPort,
  type LabProgress,
  type Timers,
} from '../../src/lib/forge/run'
import { LabAbiError, LabTimeoutError, LabTrapError } from '../../src/lib/wasm-lab'
import { disposeLabWorker, runLab, runLabInWorker } from '../../src/lib/lab-worker'
import type { CheckResult, ListReply } from '../../src/lib/forge/types'
import type { LabWorkerReply, LabWorkerRequest } from '../../src/workers/lab-protocol'
import { fakeLab, tinyLabWasm, trap } from './fixtures'

afterAll(() => disposeLabWorker())

/** A lab shaped like rust-allocator's pilot: an unseeded check, a seeded one, a trapping one. */
const pilot = () =>
  fakeLab('rust-allocator', [
    { id: 'boot', stage: 1, run: () => ({ pass: true, msg: 'alive' }) },
    { id: 'align', stage: 2, seeded: true, defaultSeed: 0xa11c, run: (seed, trace) => (trace(`seed ${seed}`), { pass: seed % 2 === 0, msg: `seed ${seed}` }) },
    { id: 'coalesce', stage: 4, run: (_, trace) => (trace('freeing 16 blocks'), trap('panicked at src/allocator.rs:3:140: not yet implemented: construct your allocator')) },
  ])

describe('the engine on fake modules (the prototype behaviours)', () => {
  test('list works on a template whose checks trap, and runs no student code', () => {
    const lab = pilot()
    const list = listChecks(lab.make)
    expect(list.checks.map((c) => [c.id, c.stage, c.seeded])).toEqual([
      ['boot', 1, false],
      ['align', 2, true],
      ['coalesce', 4, false],
    ])
    expect(lab.ran).toEqual([])
    expect(lab.inputs).toEqual(['v 2\nlist\n'])
  })

  test('every check runs in a fresh instance, and a trap costs one check, not the run', () => {
    const lab = pilot()
    const list = listChecks(lab.make)
    const results = runChecks(lab.make, list, { seeds: 'default' })
    expect(lab.instances()).toBe(1 + 3)
    expect(results.map((r) => r.status)).toEqual(['pass', 'pass', 'trap'])
    expect(lab.inputs.slice(1)).toEqual(['v 2\nonly boot\n', 'v 2\nonly align\n', 'v 2\nonly coalesce\n'])
  })

  test('after a trap the panic text and the trace come from that same instance', () => {
    const lab = pilot()
    const [, , coalesce] = runChecks(lab.make, listChecks(lab.make), { seeds: 'default' })
    expect(coalesce.panic).toBe('panicked at src/allocator.rs:3:140: not yet implemented: construct your allocator')
    expect(coalesce.msg).toBe('not implemented yet: construct your allocator (src/allocator.rs:3:140)')
    expect(coalesce.trace).toBe('freeing 16 blocks\n')
  })

  test('fresh seeds go to seeded checks only; default seeds send no seed line', () => {
    const lab = pilot()
    const list = listChecks(lab.make)
    const fresh = runChecks(lab.make, list, { seeds: 'fresh', draw: () => 42 })
    expect(lab.inputs.slice(1, 3)).toEqual(['v 2\nonly boot\n', 'v 2\nonly align\nseed 42\n'])
    expect(fresh[1]).toMatchObject({ id: 'align', status: 'pass', seed: 42, fresh: true, trace: 'seed 42\n' })
    expect(fresh[0].seed).toBeUndefined()
    expect(fresh[0].fresh).toBeUndefined()
    const byDefault = runChecks(lab.make, list, { seeds: 'default' })
    expect(byDefault[1]).toMatchObject({ seed: 0xa11c, fresh: false, status: 'pass' })
  })

  test('startAt resumes after a timed-out check, and the hooks see every check', () => {
    const lab = pilot()
    const seen: string[] = []
    const out = runChecks(lab.make, listChecks(lab.make), {
      seeds: 'fresh',
      startAt: 1,
      draw: () => 7,
      onStart: (i, meta, seed) => seen.push(`start ${i} ${meta.id} ${seed}`),
      onDone: (i, r) => seen.push(`done ${i} ${r.status}`),
    })
    expect(out.map((r) => r.id)).toEqual(['align', 'coalesce'])
    expect(seen).toEqual(['start 1 align 7', 'done 1 fail', 'start 2 coalesce undefined', 'done 2 trap'])
  })

  test('empty input is v1: every check on default seeds, the v1 report', () => {
    const lab = fakeLab('demo', [{ id: 'a', run: () => ({ pass: true, msg: 'ok' }) }])
    const reply = JSON.parse(callRun(lab.make(), ''))
    expect(reply).toEqual({ lab: 'demo', version: 1, checks: [{ id: 'a', label: 'a', pass: true, msg: 'ok' }] })
    expect(lab.inputs).toEqual([''])
  })

  test('a reply about another check, or on another seed, is an ABI violation', () => {
    const liar = fakeLab('demo', [{ id: 'a', seeded: true, run: () => ({ pass: true, msg: 'ok' }) }])
    const list = listChecks(liar.make)
    expect(() => runCheck(liar.make, list.lab, { ...list.checks[0], id: 'b' })).toThrow(LabAbiError)
    const ignoresSeed = fakeLab('demo', [{ id: 'a', seeded: true, defaultSeed: 1, run: () => ({ pass: true, msg: 'ok' }) }])
    const make = () => {
      const ex = ignoresSeed.make()
      const run = ex.ks_run
      ex.ks_run = (p, l) => run(p, Math.min(l, 'v 2\nonly a\n'.length))
      return ex
    }
    expect(() => runCheck(make, 'demo', list.checks[0], 99)).toThrow(/seed/)
  })

  test('a trap while listing is an ABI violation, not a red check', () => {
    const lab = pilot()
    const make = () => {
      const ex = lab.make()
      ex.ks_run = () => {
        throw new WebAssembly.RuntimeError('unreachable')
      }
      return ex
    }
    expect(() => listChecks(make)).toThrow(LabAbiError)
  })
})

describe('reports', () => {
  const list: ListReply = {
    lab: 'rust-allocator@reference',
    version: 2,
    abi: 2,
    checks: [
      { id: 'boot', label: 'b', stage: 1, seeded: false },
      { id: 'align', label: 'a', stage: 2, seeded: true },
    ],
  }
  const results: CheckResult[] = [
    { id: 'boot', label: 'b', status: 'pass', msg: '', stage: 1 },
    { id: 'align', label: 'a', status: 'trap', msg: 'not implemented yet', stage: 2, seed: 5, fresh: true },
  ]

  test('a reference build is identified by list and kept apart from its lab id', () => {
    const r = assembleReport(list, results, 'fresh', 3)
    expect(r).toMatchObject({ lab: 'rust-allocator', reference: true, abi: 2, version: 2, seeds: 'fresh' })
  })

  test('the legacy report keeps @reference in the lab id, so no lab-id match credits it', () => {
    const legacy = toLegacyReport(assembleReport(list, results, 'fresh', 3))
    expect(legacy.lab).toBe('rust-allocator@reference')
    expect(legacy.checks.map((c) => [c.id, c.pass, c.status])).toEqual([
      ['boot', true, 'pass'],
      ['align', false, 'trap'],
    ])
    const v1 = toLegacyReport(fromV1Report({ lab: 'demo', version: 1, checks: [{ id: 'a', label: 'a', pass: false, msg: 'x' }] }, 1))
    expect(v1).toEqual({ lab: 'demo', version: 1, abi: 1, checks: [{ id: 'a', label: 'a', pass: false, msg: 'x' }] })
  })

  test('stages: the highest stage whose checks all passed', () => {
    const r = assembleReport({ ...list, lab: 'x' }, results, 'default', 1)
    expect(stageReached(r)).toBe(1)
    expect(stageReached({ ...r, checks: r.checks.map((c) => ({ ...c, status: 'pass' as const })) })).toBe(2)
    expect(stageReached({ ...r, checks: [{ ...r.checks[0], status: 'fail' }] })).toBe(0)
  })

  test('toLabRun builds the recordLabRun payload from the required checks', () => {
    const r = assembleReport({ ...list, lab: 'rust-allocator' }, results, 'fresh', 12.4)
    expect(toLabRun(r, 'lab-green', ['boot', 'align'], { wasmSha256: 'ab' })).toEqual({
      labId: 'rust-allocator',
      passed: ['boot'],
      total: 2,
      abi: 2,
      checks: [
        { id: 'boot', status: 'pass' },
        { id: 'align', status: 'trap', seed: 5, fresh: true },
      ],
      seeds: 'fresh',
      provenance: 'lab-green',
      wasmSha256: 'ab',
      stage: 1,
      ms: 12,
    })
  })

  test('a timed-out check names itself', () => {
    const t = timeoutResult({ id: 'coalesce', label: 'c', stage: 4, seeded: false }, 2000)
    expect(t).toMatchObject({ id: 'coalesce', status: 'timeout', stage: 4, ms: 2000 })
    expect(t.msg).toContain('check "coalesce" was still running after 2 s')
  })
})

/* ------------------------------ the driver ------------------------------ */

const LIST3: ListReply = {
  lab: 'demo',
  version: 1,
  abi: 2,
  checks: ['a', 'b', 'c'].map((id) => ({ id, label: id, stage: 1, seeded: id === 'b' })),
}
const ok = (id: string): CheckResult => ({ id, label: id, status: 'pass', msg: 'ok' })

type Script = (req: LabWorkerRequest, emit: (m: LabWorkerReply) => void) => void

/** Fake workers that follow `script` when posted to; `fire()` runs the one pending timer. */
function harness(script: Script) {
  const posts: LabWorkerRequest[] = []
  const discarded: number[] = []
  const pending = new Set<{ fn: () => void }>()
  let spawned = 0
  const timers: Timers = {
    set: (fn) => {
      const h = { fn }
      pending.add(h)
      return h
    },
    clear: (h) => pending.delete(h as { fn: () => void }),
  }
  const pool: LabPool = {
    async acquire() {
      const n = spawned++
      let listener: ((m: LabWorkerReply) => void) | null = null
      const port: LabPort & { n: number } = {
        n,
        post(req) {
          posts.push(req)
          script(req, (m) => listener?.(m))
        },
        subscribe(onMessage) {
          listener = onMessage
          return () => {
            listener = null
          }
        },
      }
      return port
    },
    discard(port) {
      discarded.push((port as LabPort & { n: number }).n)
    },
  }
  const fire = () => {
    expect(pending.size).toBe(1)
    const [h] = pending
    pending.delete(h)
    h.fn()
  }
  let id = 0
  return { pool, timers, posts, discarded, fire, pending, nextId: () => id++, spawned: () => spawned }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

/** Lists, then runs checks from startAt; `spinAt` never finishes. */
const v2Worker =
  (spinAt?: number, opts: { probe?: 'ok' | 'spin' } = {}): Script =>
  (req, emit) => {
    emit({ type: 'listed', id: req.id, list: LIST3 })
    for (let i = req.startAt ?? 0; i < LIST3.checks.length; i++) {
      const id = LIST3.checks[i].id
      emit({ type: 'check-start', id: req.id, index: i, check: id, ...(id === 'b' ? { seed: 9 } : {}) })
      if (i === spinAt) return
      emit({ type: 'check-done', id: req.id, index: i, result: ok(id) })
    }
    if (req.mode === 'validate') {
      emit({ type: 'phase', id: req.id, phase: 'invoke', checksPassed: req.priorGreen ?? true })
      if (opts.probe === 'spin') return
    }
    emit({ type: 'done', id: req.id, abi: 2, report: null, hasInvoke: req.mode === 'validate' })
  }

describe('driveLabRun: a 2 s budget per check, respawn, continue', () => {
  test('every check in order, with progress for each', async () => {
    const h = harness(v2Worker())
    const progress: LabProgress[] = []
    const out = await driveLabRun(h.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'fresh' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers, onProgress: (e) => progress.push(e) })
    expect(out).toMatchObject({ abi: 2, list: LIST3, results: [ok('a'), ok('b'), ok('c')] })
    expect(progress.map((p) => p.type)).toEqual(['listed', 'check-start', 'check-done', 'check-start', 'check-done', 'check-start', 'check-done'])
    expect(h.posts).toHaveLength(1)
    expect(h.posts[0]).toMatchObject({ mode: 'grade', seeds: 'fresh', startAt: 0 })
    expect(h.pending.size).toBe(0)
  })

  test('a spinning check is marked timeout, its worker discarded, and a new worker resumes past it', async () => {
    const h = harness(v2Worker(1))
    const run = driveLabRun(h.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'fresh' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    expect(h.posts.map((p) => p.startAt)).toEqual([0])
    h.fire()
    const out = await run
    expect(h.discarded).toEqual([0])
    expect(h.posts.map((p) => p.startAt)).toEqual([0, 2])
    if (out.abi !== 2) throw new Error('expected v2')
    expect(out.results.map((r) => r.status)).toEqual(['pass', 'timeout', 'pass'])
    expect(out.results[1]).toMatchObject({ id: 'b', seed: 9, fresh: true })
    expect(out.results[1].msg).toContain('check "b"')
  })

  test('a spin in the last check ends the run without another worker', async () => {
    const h = harness(v2Worker(2))
    const run = driveLabRun(h.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    h.fire()
    const out = await run
    expect(h.spawned()).toBe(1)
    if (out.abi !== 2) throw new Error('expected v2')
    expect(out.results.map((r) => r.status)).toEqual(['pass', 'pass', 'timeout'])
  })

  test('validate: after a timed-out last check a new worker still runs the probe', async () => {
    const h = harness(v2Worker(2))
    const run = driveLabRun(h.pool, { mode: 'validate', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    h.fire()
    const out = await run
    expect(h.posts.map((p) => [p.startAt, p.priorGreen])).toEqual([
      [0, true],
      [3, false],
    ])
    expect(out).toMatchObject({ abi: 2, hasInvoke: true })
  })

  test('a spin in the probe is the run’s LabTimeoutError, named for ks_invoke', async () => {
    const h = harness(v2Worker(undefined, { probe: 'spin' }))
    const run = driveLabRun(h.pool, { mode: 'validate', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    h.fire()
    const err = await run.catch((e) => e)
    expect(err).toBeInstanceOf(LabTimeoutError)
    expect(err.message).toContain('ks_invoke')
  })

  test('stuck before listing: the run times out as a whole', async () => {
    const h = harness(() => {})
    const run = driveLabRun(h.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    h.fire()
    const err = await run.catch((e) => e)
    expect(err).toBeInstanceOf(LabTimeoutError)
    expect(err.check).toBeUndefined()
    expect(h.discarded).toEqual([0])
  })

  test('v1 keeps one request and one budget: its report, its trap', async () => {
    const report = { lab: 'demo', version: 1, checks: [{ id: 'a', label: 'a', pass: true, msg: '' }] }
    const h = harness((req, emit) => emit({ type: 'done', id: req.id, report, hasInvoke: false }))
    const out = await driveLabRun(h.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    expect(out).toEqual({ abi: 1, report, hasInvoke: false })
    const t = harness((req, emit) => emit({ type: 'failed', id: req.id, kind: 'trap', message: 'x' }))
    const err = await driveLabRun(t.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: t.nextId, timers: t.timers }).catch((e) => e)
    expect(err).toBeInstanceOf(LabTrapError)
  })

  test('v1 validate does not get a second budget for the probe', async () => {
    const h = harness((req, emit) => emit({ type: 'phase', id: req.id, phase: 'invoke', checksPassed: true }))
    const run = driveLabRun(h.pool, { mode: 'validate', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    h.fire()
    const err = await run.catch((e) => e)
    expect(err).toBeInstanceOf(LabTimeoutError)
    expect(err.message).toContain('self-checks passed')
  })

  test('a respawned worker that lists different checks is refused', async () => {
    let n = 0
    const h = harness((req, emit) => {
      if (n++ === 0) return v2Worker(0)(req, emit)
      emit({ type: 'listed', id: req.id, list: { ...LIST3, checks: LIST3.checks.slice(1) } })
    })
    const run = driveLabRun(h.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    h.fire()
    expect(await run.catch((e) => e)).toBeInstanceOf(LabAbiError)
  })

  test('messages for another run are ignored', async () => {
    const h = harness((req, emit) => {
      emit({ type: 'done', id: req.id + 100, abi: 2, report: null, hasInvoke: false })
      v2Worker()(req, emit)
    })
    const out = await driveLabRun(h.pool, { mode: 'grade', bytes: new ArrayBuffer(0), seeds: 'default' }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    if (out.abi !== 2) throw new Error('expected v2')
    expect(out.results).toHaveLength(3)
  })
})

describe('the real worker, on a hand-assembled module', () => {
  test('v2: a trapping check reports trap with its panic text, and the run still returns', async () => {
    const r = await runLab(tinyLabWasm({ lab: 'demo', trapCheck: true, panic: 'panicked at src/a.rs:1:2: not yet implemented: x' }))
    expect(r).toMatchObject({ lab: 'demo', abi: 2, reference: false, seeds: 'default' })
    expect(r.checks).toHaveLength(1)
    expect(r.checks[0]).toMatchObject({ id: 'c1', status: 'trap', msg: 'not implemented yet: x (src/a.rs:1:2)' })
  })

  test('runLabInWorker keeps its v1 shape for a v2 module', async () => {
    const r = await runLabInWorker(tinyLabWasm({ lab: 'demo' }))
    expect(r.lab).toBe('demo')
    expect(r.checks[0]).toMatchObject({ id: 'c1', pass: true, msg: 'v2', status: 'pass' })
  })

  test('v1 is unchanged: a report, or a LabTrapError for the whole run', async () => {
    expect(await runLabInWorker(tinyLabWasm({ lab: 'demo', abi: 1 }))).toEqual({ lab: 'demo', version: 1, checks: [{ id: 'c1', label: 'one', pass: true, msg: 'v1' }] })
    /* .catch, not expect().rejects: under bun test the matcher's wait can starve the worker's reply */
    expect(await runLabInWorker(tinyLabWasm({ lab: 'demo', abi: 1, trapCheck: true })).catch((e) => e)).toBeInstanceOf(LabTrapError)
    const r = await runLab(tinyLabWasm({ lab: 'demo', abi: 1, trapCheck: true }), { expected: { lab: 'demo', checks: [{ id: 'c1', label: 'one' }] } })
    expect(r.checks).toEqual([{ id: 'c1', label: 'one', status: 'trap', msg: expect.stringContaining('trapped') }])
  })

  test('a module that is not wasm is an ABI error', async () => {
    expect(await runLabInWorker(new Uint8Array([1, 2, 3]).buffer).catch((e) => e)).toBeInstanceOf(LabAbiError)
  })
})
