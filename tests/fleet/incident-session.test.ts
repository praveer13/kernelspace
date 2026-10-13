/**
 * Incident sessions in the fleet worker (docs/specs/wave-2.md §9.5, task 2b-15): open {mode: 'incident'}
 * builds the incident cluster, probe / fix / wait / finish drive world/incident-sim's clock one command at
 * a time, the learner's module bytes reach every worker, budgets and FleetTimeoutError are the other
 * modes', and a session replays to the same burn as incident-sim for the same action log.
 */
import { describe, expect, test } from 'bun:test'
import { createFleetHost } from '../../src/lib/fleet-host'
import { makeRefManager, makeRefQueue } from '../../src/lib/fleet-model'
import { FleetTimeoutError, openIncidentSession, type FleetWorkerLike } from '../../src/lib/fleet-session'
import { instantiateLab } from '../../src/lib/wasm-lab'
import { makeWasmScheduler } from '../../src/lib/wasm-scheduler'
import { fixFor, generateIncident, INCIDENT_FAULTS, PROBE_IDS, type IncidentAction, type IncidentFault, type IncidentSpec } from '../../src/lib/world/incident-spec'
import { IncidentSession, replayIncident, runExpert, scoreIncident, type StackFactory } from '../../src/lib/world/incident-sim'
import type { FleetReply, FleetRequest, FleetSlotBytes, IncidentOpen } from '../../src/workers/fleet-protocol'

/* --------------------------- an in-process fake worker --------------------------- */

type Script = (req: FleetRequest, emit: (reply: FleetReply) => void) => void | Promise<void>

class FakeWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  terminated = false
  readonly received: FleetRequest[] = []
  readonly replies: FleetReply[] = []

  constructor(private readonly script: Script) {
    queueMicrotask(() => this.deliver({ type: 'boot' }))
  }

  private deliver(reply: FleetReply) {
    this.replies.push(reply)
    if (!this.terminated) this.onmessage?.({ data: reply })
  }

  postMessage(msg: FleetRequest) {
    this.received.push(msg)
    if (this.terminated) return
    setTimeout(() => void this.script(msg, (reply) => this.deliver(reply)), 0)
  }

  terminate() {
    this.terminated = true
  }
}

/** The real host behind the fake worker: what fleet.worker.ts does, minus the thread. */
function hostScript(): Script {
  const host = createFleetHost()
  return (req, emit) => host.handle(req, emit)
}

function spawner(script: () => Script) {
  const workers: FakeWorker[] = []
  return {
    workers,
    spawn: () => {
      const w = new FakeWorker(script())
      workers.push(w)
      return w
    },
  }
}

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
  const report = JSON.stringify({ lab: 'batching-scheduler', version: 2, checks: [{ id: 'c', label: 'c', pass: true, msg: 'ok' }] })
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

const noModules: FleetSlotBytes = { sched: null, mgr: null, queue: null }
const open = (spec: IncidentSpec, slots: FleetSlotBytes = noModules): IncidentOpen => ({ mode: 'incident', spec, slots })

/** One spec per catalog fault, found by scanning drill keys (the generator balances faults over seeds). */
function specFor(fault: IncidentFault, nth = 0): IncidentSpec {
  let seen = 0
  for (let i = 0; ; i++) {
    const spec = generateIncident('drill', `s15-${i}`)
    if (spec.fault === fault && seen++ === nth) return spec
  }
}

/* ------------------------------ replay equals incident-sim ------------------------------ */

describe('a session replays to the same burn as incident-sim for the same action log', () => {
  for (const fault of INCIDENT_FAULTS) {
    test(`${fault}: the expert's log, command by command`, async () => {
      const spec = specFor(fault)
      const expert = runExpert(spec)
      const t = spawner(() => hostScript())
      const session = await openIncidentSession(open(spec), { spawn: t.spawn })

      const direct = new IncidentSession(spec)
      expect(session.alert).toBe(direct.alertMinute)
      expect(session.limit).toBe(direct.limit)

      for (const a of expert.actions) {
        if (a.kind === 'hypothesis') {
          await session.hypothesis(a.fault)
          direct.hypothesis(a.fault)
        } else if (a.kind === 'probe') {
          const got = await session.probe(a.probe)
          const want = direct.probe(a.probe)
          // the same readings, category and clock a direct session shows
          expect(got).toEqual({ ...want, ended: direct.ended })
        } else if (a.kind === 'fix') {
          const got = await session.fix(a.fix)
          const want = direct.fix(a.fix)
          expect(got).toEqual({ ...want, ended: direct.ended })
          expect(got.effective).toBe(true)
        } else {
          expect((await session.wait()).minute).toBe(direct.wait().minute)
        }
      }

      const done = await session.finish()
      const replayed = replayIncident(spec, expert.actions)
      expect(done.burn).toBe(replayed.burn)
      expect(done.burn).toBe(expert.outcome.burn)
      expect(done.expertBurn).toBe(expert.outcome.burn)
      expect(done.recovered).toBe(true)
      expect(done.diagnosed).toBe(true)
      expect(done.fixed).toBe(true)
      expect(done.actions).toEqual(expert.actions)
      expect(done.expert.named).toBe(fault)
      // the wire carries the whole outcome, not just the three headline fields
      expect(done).toMatchObject(replayed)
      session.close()
    })
  }

  test('a clumsy log: wrong fix first, a wait, a late right fix scores the same as scoreIncident', async () => {
    const spec = specFor('pool-shrink', 1)
    const wrong = fixFor('drain-stall')
    const log: IncidentAction[] = [
      { kind: 'hypothesis', fault: 'unsure' },
      { kind: 'probe', probe: 'latency' },
      { kind: 'hypothesis', fault: 'drain-stall' },
      { kind: 'fix', fix: wrong },
      { kind: 'probe', probe: 'kv' },
      { kind: 'wait' },
      { kind: 'hypothesis', fault: 'pool-shrink' },
      { kind: 'fix', fix: fixFor('pool-shrink') },
    ]
    const t = spawner(() => hostScript())
    const session = await openIncidentSession(open(spec), { spawn: t.spawn })
    const effective: boolean[] = []
    for (const a of log) {
      if (a.kind === 'hypothesis') await session.hypothesis(a.fault)
      else if (a.kind === 'probe') await session.probe(a.probe)
      else if (a.kind === 'fix') effective.push((await session.fix(a.fix)).effective)
      else await session.wait()
    }
    // a wrong fix wastes its time and changes nothing; the right one lands
    expect(effective).toEqual([false, true])
    const done = await session.finish()
    const want = scoreIncident(spec, log)
    expect(done.burn).toBe(want.burn)
    expect(done.expertBurn).toBe(want.expertBurn)
    expect(done.recovered).toBe(want.recovered)
    expect(done.firstHypothesis).toBe('unsure')
    expect(done.hypothesis).toBe('pool-shrink')
    expect(done.diagnosed).toBe(true)
    // looking and misfiring cost clock: the clumsy log burns more than the expert
    expect(done.burn).toBeGreaterThan(done.expertBurn)
    // finish is idempotent: asking again changes nothing
    expect((await session.finish()).burn).toBe(done.burn)
    session.close()
  })

  test('an unfixed incident runs to the limit and does not recover', async () => {
    const spec = specFor('drain-stall')
    const t = spawner(() => hostScript())
    const session = await openIncidentSession(open(spec), { spawn: t.spawn })
    const done = await session.finish()
    const want = replayIncident(spec, [])
    expect(done.burn).toBe(want.burn)
    expect(done.recovered).toBe(false)
    expect(done.end).toBe(session.limit)
    expect(done.diagnosed).toBe(false)
    // probes after the end read the final state and count for nothing
    const late = await session.probe('intake')
    expect(late.ended).toBe(true)
    session.close()
  })
})

describe('the faults reach the cluster', () => {
  test('each fault shows its own signature on its probes', async () => {
    const readings: Record<string, string> = {}
    for (const fault of INCIDENT_FAULTS) {
      const t = spawner(() => hostScript())
      const session = await openIncidentSession(open(specFor(fault, 2)), { spawn: t.spawn })
      const cats: string[] = []
      for (const p of PROBE_IDS) cats.push((await session.probe(p)).category)
      readings[fault] = cats.join(',')
      session.close()
    }
    // four faults, four different category vectors
    expect(new Set(Object.values(readings)).size).toBe(INCIDENT_FAULTS.length)
  })
})

/* ------------------------------ own components ------------------------------ */

describe('the learner modules run in every worker', () => {
  test('a scheduler that never admits scores the burn a direct run with the same bytes scores', async () => {
    const bytes = admitNothingModule()
    const spec = specFor('node-death')
    // fresh instances per use: the modules hold state
    const freshStack = async (): Promise<StackFactory> => {
      const mods = []
      for (let w = 0; w < spec.workers; w++) mods.push(await instantiateLab(bytes))
      return (w, cfg, cap) => ({
        sched: makeWasmScheduler(mods[w]!),
        mgr: makeRefManager(cfg.numBlocks, cfg.blockSize),
        queue: makeRefQueue(cap),
      })
    }
    const log: IncidentAction[] = [
      { kind: 'hypothesis', fault: 'node-death' },
      { kind: 'probe', probe: 'workers' },
      { kind: 'fix', fix: 'replace-node' },
    ]
    const want = replayIncident(spec, log, { stack: await freshStack() })

    const t = spawner(() => hostScript())
    const session = await openIncidentSession(open(spec, { ...noModules, sched: bytes }), { spawn: t.spawn })
    await session.hypothesis('node-death')
    await session.probe('workers')
    await session.fix('replace-node')
    const done = await session.finish()
    expect(done.burn).toBe(want.burn)
    expect(done.recovered).toBe(want.recovered)
    // the learner's scheduler really ran: it differs from the same log on the reference drivers
    expect(done.burn).not.toBe(replayIncident(spec, log).burn)
    // the expert's burn is the expert on fresh instances of the same modules, not the reference expert
    const expert = runExpert(spec, { stack: await freshStack() })
    expect(done.expertBurn).toBe(expert.outcome.burn)
    expect(done.expertBurn).not.toBe(runExpert(spec).outcome.burn)
    // callers keep their bytes: nothing was transferred away
    expect(bytes.byteLength).toBeGreaterThan(0)
    session.close()
  })
})

/* -------------------------------- budgets -------------------------------- */

describe('budgets and FleetTimeoutError', () => {
  const spec = () => specFor('pool-shrink')

  /** The real host until `cmd`, which streams tick progress 410..412 and never answers: a module spinning at tick 412. */
  const spinsOn =
    (cmd: FleetRequest['cmd']): (() => Script) =>
    () => {
      const real = hostScript()
      return (req, emit) => {
        if (req.cmd !== cmd) return real(req, emit)
        for (const tick of [410, 411, 412]) emit({ type: 'tick', id: req.id, tick })
      }
    }

  test('a probe that outruns its budget terminates the worker and names the tick', async () => {
    const t = spawner(spinsOn('probe'))
    const session = await openIncidentSession(open(spec(), { ...noModules, sched: admitNothingModule() }), { spawn: t.spawn, budgets: { step: 40 } })
    const error = await session.probe('intake').then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(FleetTimeoutError)
    const timeout = error as FleetTimeoutError
    expect(timeout.phase).toBe('step')
    expect(timeout.tick).toBe(412)
    expect(timeout.budgetMs).toBe(40)
    expect(timeout.message).toContain('your scheduler stopped responding at tick 412')
    expect(t.workers[0]!.terminated).toBe(true)
    // the session is over; it does not hang on a dead worker
    await expect(session.wait()).rejects.toBeInstanceOf(FleetTimeoutError)
  })

  test('fix and wait take the same 2 s budget, finish its own', async () => {
    for (const cmd of ['fix', 'wait'] as const) {
      const t = spawner(spinsOn(cmd))
      const session = await openIncidentSession(open(spec()), { spawn: t.spawn, budgets: { step: 30 } })
      const run = cmd === 'fix' ? session.fix('restore-pool') : session.wait()
      const error = await run.then(
        () => null,
        (e: unknown) => e,
      )
      expect((error as FleetTimeoutError).phase).toBe('step')
    }
    const t = spawner(spinsOn('finish'))
    const session = await openIncidentSession(open(spec()), { spawn: t.spawn, budgets: { step: 5000, finish: 30 } })
    const error = await session.finish().then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(FleetTimeoutError)
    expect((error as FleetTimeoutError).phase).toBe('finish')
    expect((error as FleetTimeoutError).budgetMs).toBe(30)
  })

  test('an open that never returns times out with the open budget', async () => {
    const t = spawner(() => () => {})
    const error = await openIncidentSession(open(spec()), { spawn: t.spawn, budgets: { open: 30 } }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(FleetTimeoutError)
    expect((error as FleetTimeoutError).phase).toBe('open')
    expect(t.workers[0]!.terminated).toBe(true)
  })

  test('the host reports the tick it is running while a command works', async () => {
    const t = spawner(() => hostScript())
    const session = await openIncidentSession(open(spec()), { spawn: t.spawn })
    const before = t.workers[0]!.replies.length
    await session.probe('latency')
    const ticks = t.workers[0]!.replies.slice(before).flatMap((r) => (r.type === 'tick' ? [r.tick] : []))
    // a 3-minute probe is 60 engine ticks, each reported once and in order
    expect(ticks.length).toBeGreaterThanOrEqual(50)
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
    expect(new Set(ticks).size).toBe(ticks.length)
    session.close()
  })

  test('an incident command with no incident open fails with a plain error', async () => {
    const t = spawner(() => hostScript())
    const worker = t.spawn()
    const replies: FleetReply[] = []
    worker.onmessage = (ev) => replies.push(ev.data)
    worker.postMessage({ id: 0, cmd: 'probe', probe: 'kv' })
    await new Promise((r) => setTimeout(r, 20))
    const failed = replies.find((r) => r.type === 'failed')
    expect(failed).toMatchObject({ type: 'failed', id: 0, kind: 'error', message: 'no incident session is open' })
  })
})
