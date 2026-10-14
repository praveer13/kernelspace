/**
 * The prefix router over your radix cache (docs/specs/wave-2.md §10.3, task 2b-20): the `RouterDriver` hook in
 * Cluster, `makeWasmRouter` (one radix instance per worker, longest match inside the load guard, then insert), its
 * agreement with the reference `WorkerPrefixCache` on a conformance trace, and the fleet host carrying the
 * prefix-router slot, incident opens included.
 *
 * No wasm built from a private solution is ever committed, so the radix cache here is a JS stand-in that answers
 * `reset`, `insert <ids>` and `match <ids>` the way the lab's bridge does (the fakeLab pattern of
 * tests/forge/fixtures.ts: an object the host cannot tell from a module).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import type { InstalledSlots } from '../../src/lib/engine/slots'
import { REFUSALS } from '../../src/lib/engine/store'
import { createFleetHost } from '../../src/lib/fleet-host'
import {
  choosePrefixWorker,
  Cluster,
  Engine,
  makePrefixSharedRequestStream,
  makeRefManager,
  makeRefQueue,
  makeRefRouter,
  makeRefScheduler,
  PREFIX_LOAD_GUARD,
  PRACTICE_SEED,
  type EngineConfig,
  type RouteCandidate,
  type RouterDriver,
} from '../../src/lib/fleet-model'
import { LabAbiError, LabTrapError } from '../../src/lib/wasm-lab'
import { generateIncident } from '../../src/lib/world/incident-spec'
import ClusterPanel from '../../src/pages/fleet/ClusterPanel'
import { makeWasmRouter, REBUILD_MESSAGE, slotBytes, type Mod } from '../../src/pages/fleet/drivers'
import { EMPTY_SLOTS, useSlots } from '../../src/pages/fleet/slots'
import type { FleetReply, FleetRequest, FleetSlotBytes } from '../../src/workers/fleet-protocol'

/* ------------------------------ a radix cache stand-in ------------------------------ */

interface Node {
  kids: Map<number, Node>
  end: boolean
}

interface FakeRadix extends Mod {
  /** Every command the module was sent, in order. */
  cmds: string[]
}

/**
 * A module that answers the radix-cache bridge's verbs from a plain trie: `reset` empties it, `insert <ids>` adds a
 * sequence and replies `ok <entries>` (sequences that are not a prefix of another), `match <ids>` replies the
 * length of the longest cached prefix. `answer` overrides replies, for stale, unfinished or broken modules.
 */
function fakeRadix(answer?: (cmd: string) => string | undefined): FakeRadix {
  let root: Node = { kids: new Map(), end: false }
  const cmds: string[] = []
  const leaves = (n: Node): number => (n.kids.size === 0 ? (n.end ? 1 : 0) : [...n.kids.values()].reduce((a, k) => a + leaves(k), 0))
  const ids = (text: string): number[] => (text === '' ? [] : text.split(',').map(Number))
  return {
    cmds,
    hasInvoke: true,
    runChecks: () => {
      throw new Error('the stand-in has no self-checks')
    },
    dispose() {},
    invoke(cmd) {
      cmds.push(cmd)
      const custom = answer?.(cmd)
      if (custom !== undefined) return custom
      const [verb, arg = ''] = cmd.split(' ')
      if (verb === 'reset') {
        root = { kids: new Map(), end: false }
        return 'ok'
      }
      if (verb === 'insert') {
        let n = root
        for (const id of ids(arg)) {
          let next = n.kids.get(id)
          if (!next) n.kids.set(id, (next = { kids: new Map(), end: false }))
          n = next
        }
        n.end = true
        return `ok ${leaves(root)}`
      }
      if (verb === 'match') {
        let n = root
        let len = 0
        for (const id of ids(arg)) {
          const next = n.kids.get(id)
          if (!next) break
          n = next
          len++
        }
        return String(len)
      }
      return `err unknown command ${JSON.stringify(cmd)}`
    },
  }
}

const radixFleet = (workers: number) => Array.from({ length: workers }, () => fakeRadix())
const stream = () => makePrefixSharedRequestStream(240, 900, PRACTICE_SEED)

/* ------------------------------- the RouterDriver hook ------------------------------- */

const WORKER: EngineConfig = { numBlocks: 128, blockSize: 16, maxRunning: 12, sloTtft: 40, prefillChunk: 128 }
const engines = (n: number) =>
  Array.from({ length: n }, () => new Engine(WORKER, [], makeRefScheduler(), makeRefManager(WORKER.numBlocks, WORKER.blockSize), { intake: makeRefQueue(32), drainPerTick: 6 }))

describe('Cluster takes a RouterDriver beside RouterKind', () => {
  test('without one it routes exactly as before: the explicit reference router changes nothing', () => {
    for (const router of ['rr', 'jsq', 'prefix'] as const) {
      const plain = new Cluster(stream(), engines(2), router)
      const explicit = new Cluster(stream(), engines(2), router, makeRefRouter(2))
      while (!plain.done) plain.step()
      while (!explicit.done) explicit.step()
      expect(explicit.aggregate()).toEqual(plain.aggregate())
      expect(explicit.workers.map((w) => w.stats().completed)).toEqual(plain.workers.map((w) => w.stats().completed))
    }
  })

  test('the cluster asks the driver: a recording driver sees every routed prompt, its warm-ups and a revived node', () => {
    const seen: string[] = []
    const inner = makeRefRouter(2)
    const driver: RouterDriver = {
      name: 'recorder',
      route(tokens, candidates) {
        seen.push(`route ${tokens.length} of ${candidates.length}`)
        return inner.route(tokens, candidates)
      },
      warm(index, tokens) {
        seen.push(`warm ${index}`)
        inner.warm?.(index, tokens)
      },
      reset(index) {
        seen.push(`reset ${index}`)
        inner.reset(index)
      },
      size: (index) => inner.size(index),
    }
    const cluster = new Cluster(stream(), engines(2), 'prefix', driver)
    expect(cluster.routerDriver).toBe(driver)
    for (let i = 0; i < 1500 && !cluster.done; i++) {
      cluster.step()
      if (i === 200) {
        cluster.workers[1].kill()
        cluster.revive(1)
      }
    }
    expect(seen.filter((s) => s.startsWith('route')).length).toBeGreaterThanOrEqual(200)
    expect(seen.some((s) => s.startsWith('warm'))).toBe(true)
    expect(seen).toContain('reset 1')
    // the panel's cache column reads the driver
    expect(cluster.cacheEntries(0)).toBe(inner.size(0))
  })

  test('round-robin and join-shortest-queue still report their worker\'s hit through the driver', () => {
    const calls: number[] = []
    const inner = makeRefRouter(2)
    const driver: RouterDriver = { ...inner, name: 'counter', route: (tokens, candidates) => (calls.push(candidates.length), inner.route(tokens, candidates)) }
    const cluster = new Cluster(stream(), engines(2), 'rr', driver)
    while (!cluster.done) cluster.step()
    // the router kind chose the worker; the driver was asked about that one worker alone
    expect(calls.length).toBe(240)
    expect(new Set(calls)).toEqual(new Set([1]))
    expect(cluster.aggregate().kvHitRate).toBeGreaterThan(0)
  })
})

describe('choosePrefixWorker is the one choice both routers make', () => {
  const at = (...loads: number[]): RouteCandidate[] => loads.map((load, index) => ({ index, load }))

  test('longest match wins among the workers inside the load guard', () => {
    const hits = [10, 300, 40]
    expect(choosePrefixWorker(at(0, 1, 2), (i) => hits[i])).toEqual({ index: 1, hit: 300 })
  })

  test('a worker more than the guard above the lightest is skipped, however long its match', () => {
    const hits = [0, 500, 0]
    const over = at(0, PREFIX_LOAD_GUARD + 1, 1)
    expect(choosePrefixWorker(over, (i) => hits[i])).toEqual({ index: 0, hit: 0 })
    // exactly at the guard it is still in
    expect(choosePrefixWorker(at(0, PREFIX_LOAD_GUARD, 1), (i) => hits[i])).toEqual({ index: 1, hit: 500 })
  })

  test('ties go to the lighter worker, then the lower index', () => {
    expect(choosePrefixWorker(at(3, 1, 2), () => 64)).toEqual({ index: 1, hit: 64 })
    expect(choosePrefixWorker(at(2, 2, 2), () => 64)).toEqual({ index: 0, hit: 64 })
  })

  test('it asks for a match only from the eligible workers', () => {
    const asked: number[] = []
    choosePrefixWorker(at(0, 9, 1), (i) => (asked.push(i), 0))
    expect(asked).toEqual([0, 2])
  })
})

/* -------------------------------- makeWasmRouter -------------------------------- */

describe('makeWasmRouter drives one radix instance per worker', () => {
  test('construction sends reset to every instance, and only reset', () => {
    const mods = radixFleet(3)
    makeWasmRouter(mods)
    for (const m of mods) expect(m.cmds).toEqual(['reset'])
  })

  test('a request goes to the longest match, skipping workers over the guard, and is inserted into that worker only', () => {
    const mods = radixFleet(3)
    const router = makeWasmRouter(mods)
    const sys = Array.from({ length: 40 }, (_, i) => 1000 + i)
    const a = [...sys, 1, 2, 3]
    const b = [...sys, 7, 8, 9]

    // nothing cached: a tie everywhere, so the lightest worker (index 1) takes it
    expect(router.route(a, [{ index: 0, load: 2 }, { index: 1, load: 0 }, { index: 2, load: 1 }])).toEqual({ index: 1, hit: 0 })
    expect(mods[1].cmds.at(-1)).toBe(`insert ${a.join(',')}`)
    expect(mods[0].cmds.filter((c) => c.startsWith('insert'))).toEqual([])
    expect(mods[2].cmds.filter((c) => c.startsWith('insert'))).toEqual([])

    // the same family again: worker 1 holds its 40-token system prompt
    expect(router.route(b, [{ index: 0, load: 1 }, { index: 1, load: 2 }, { index: 2, load: 1 }])).toEqual({ index: 1, hit: 40 })

    // worker 1 is now more than the guard above the lightest: it is not even asked
    const before = mods[1].cmds.length
    const out = router.route(b, [{ index: 0, load: 0 }, { index: 1, load: PREFIX_LOAD_GUARD + 1 }, { index: 2, load: 1 }])
    expect(out.index).not.toBe(1)
    expect(out.hit).toBe(0)
    expect(mods[1].cmds.length).toBe(before)
    // the routed prompt landed in the chosen worker's own instance
    expect(mods[out.index].cmds.at(-1)).toBe(`insert ${b.join(',')}`)
  })

  test('the entry count of the cache column follows the module\'s own "ok <entries>" replies', () => {
    const mods = radixFleet(2)
    const router = makeWasmRouter(mods)
    expect(router.size(0)).toBe(0)
    router.route([1, 2, 3], [{ index: 0, load: 0 }])
    router.route([9, 9, 9], [{ index: 0, load: 0 }])
    expect(router.size(0)).toBe(2)
    router.reset(0)
    expect(router.size(0)).toBe(0)
    expect(mods[0].cmds.at(-1)).toBe('reset')
  })

  test('an empty prompt is a miss that touches no module', () => {
    const mods = radixFleet(2)
    const router = makeWasmRouter(mods)
    expect(router.route([], [{ index: 1, load: 0 }])).toEqual({ index: 1, hit: 0 })
    expect(mods.map((m) => m.cmds)).toEqual([['reset'], ['reset']])
  })

  test('a module built from an older zip is told to rebuild, in the words of the install gate', () => {
    expect(REBUILD_MESSAGE).toBe(REFUSALS['stale-version'])
    const old = fakeRadix((cmd) => (cmd === 'reset' ? 'err unknown command "reset" (try: probe <seed>)' : undefined))
    let thrown: unknown
    try {
      makeWasmRouter([old])
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(LabAbiError)
    expect((thrown as Error).message).toBe(REFUSALS['stale-version'])
  })

  test('an unfinished module traps, and a broken reply fails closed', () => {
    const unfinished = fakeRadix(() => {
      throw new LabTrapError()
    })
    expect(() => makeWasmRouter([unfinished])).toThrow(LabTrapError)

    const mute = { ...fakeRadix(), hasInvoke: false }
    expect(() => makeWasmRouter([mute])).toThrow('no ks_invoke bridge')

    const notACount = fakeRadix((cmd) => (cmd.startsWith('match') ? 'many' : undefined))
    expect(() => makeWasmRouter([notACount]).route([1, 2], [{ index: 0, load: 0 }])).toThrow('not a count')

    const tooLong = fakeRadix((cmd) => (cmd.startsWith('match') ? '99' : undefined))
    expect(() => makeWasmRouter([tooLong]).route([1, 2], [{ index: 0, load: 0 }])).toThrow('99 cached tokens for a 2-token prompt')

    const refuses = fakeRadix((cmd) => (cmd.startsWith('insert') ? 'err a 700-token prompt does not fit the 1024-block pool' : undefined))
    expect(() => makeWasmRouter([refuses]).route([1, 2], [{ index: 0, load: 0 }])).toThrow('router insert: err a 700-token prompt')

    const noAck = fakeRadix((cmd) => (cmd.startsWith('insert') ? 'done' : undefined))
    expect(() => makeWasmRouter([noAck]).route([1, 2], [{ index: 0, load: 0 }])).toThrow('not "ok <entries>"')
  })
})

/* --------------------------------- conformance --------------------------------- */

describe('makeWasmRouter agrees with WorkerPrefixCache on a conformance trace', () => {
  /**
   * The trace is makePrefixSharedRequestStream (twelve system prefixes, unique tails). Loads are scripted so the
   * guard bites and ties occur; now and then a worker is missing from the candidates, as a killed or cordoned node is. The
   * reference inserts each routed prompt as the wasm router does, so the two see the same cache contents; its
   * capacity is the stand-in's room, not the six-entry routing view, so the comparison is of routing, not eviction.
   * This proves routing agreement at a 64-entry capacity (the reference is built with `makeRefRouter(workers, 64)`),
   * not production eviction timing: the cluster's own routing view holds six entries, and when a prefix is evicted
   * from it is not what this trace checks.
   */
  for (const workers of [2, 3, 4]) {
    test(`${workers} workers: the same worker and the same hit on all 240 requests`, () => {
      const ref = makeRefRouter(workers, 64)
      const mods = radixFleet(workers)
      const mine = makeWasmRouter(mods)
      let warm = 0
      let skippedBetter = 0
      let routed = 0
      for (const request of stream()) {
        const tokens = request.tokens!
        const down = request.id % 29 === 0 ? request.id % workers : -1
        const candidates: RouteCandidate[] = Array.from({ length: workers }, (_, index) => ({ index, load: (request.id * 7 + index * 13 + (index === 0 ? request.id : 0)) % 9 })).filter(({ index }) => index !== down)
        const want = ref.route(tokens, candidates)
        ref.warm?.(want.index, tokens)
        const got = mine.route(tokens, candidates)
        expect(got, `request ${request.id}`).toEqual(want)
        routed++
        if (got.hit > 0) warm++
        // a better cache existed outside the guard: the guard, not the match, decided
        const best = Math.max(...mods.map((m, i) => (candidates.some((c) => c.index === i) ? Number(m.invoke(`match ${tokens.join(',')}`)) : 0)))
        if (best > got.hit) skippedBetter++
      }
      expect(routed).toBe(240)
      // the trace exercises both a warm cache and the load guard
      expect(warm).toBeGreaterThan(100)
      expect(skippedBetter).toBeGreaterThan(0)
      // each worker's instance saw its own requests only
      const inserts = mods.map((m) => m.cmds.filter((c) => c.startsWith('insert')).length)
      expect(inserts.reduce((a, b) => a + b, 0)).toBe(240)
      expect(inserts.every((n) => n > 0)).toBe(true)
    })
  }

  test('a revived node starts cold in both', () => {
    const ref = makeRefRouter(2, 64)
    const mine = makeWasmRouter(radixFleet(2))
    const [first] = stream()
    const both = [{ index: 0, load: 0 }, { index: 1, load: 1 }]
    ref.route(first.tokens!, both)
    ref.warm?.(0, first.tokens!)
    mine.route(first.tokens!, both)
    expect(mine.route(first.tokens!, both).hit).toBe(ref.route(first.tokens!, both).hit)
    ref.reset(0)
    mine.reset(0)
    expect(mine.route(first.tokens!, both)).toEqual(ref.route(first.tokens!, both))
  })

  test('in a whole cluster the wasm router still routes by prefix: it finishes the trace and beats join-shortest-queue on KV hits', () => {
    const jsq = new Cluster(stream(), engines(2), 'jsq')
    const yours = new Cluster(stream(), engines(2), 'prefix', makeWasmRouter(radixFleet(2)))
    const reference = new Cluster(stream(), engines(2), 'prefix')
    for (const c of [jsq, yours, reference]) while (!c.done) c.step()
    expect(yours.aggregate().completed).toBe(240)
    expect(yours.aggregate().kvHitRate).toBeGreaterThan(jsq.aggregate().kvHitRate)
    // inserting at route time can only find a prefix sooner than the reference, which waits for the prefill
    expect(yours.aggregate().kvHitRate).toBeGreaterThanOrEqual(reference.aggregate().kvHitRate)
    expect(yours.cacheEntries(0)).toBeGreaterThan(0)
  })
})

/* ------------------------------- the fleet host ------------------------------- */

/** A host whose modules are radix stand-ins, one per `instantiate` call, in call order. */
function hostWithRadix(make: () => FakeRadix = () => fakeRadix()) {
  const made: FakeRadix[] = []
  const host = createFleetHost({
    instantiate: async () => {
      const m = make()
      made.push(m)
      return m
    },
  })
  const replies: FleetReply[] = []
  let id = 0
  const send = async (cmd: Omit<FleetRequest, 'id'>): Promise<FleetReply[]> => {
    const start = replies.length
    await host.handle({ id: id++, ...cmd } as FleetRequest, (r) => replies.push(r))
    return replies.slice(start).filter((r) => r.type !== 'tick')
  }
  return { made, send }
}

const noModules: FleetSlotBytes = { sched: null, mgr: null, queue: null }
const ROUTER_BYTES = new ArrayBuffer(8)

describe('the fleet host carries the prefix-router slot', () => {
  test('slotBytes puts an installed radix cache in the router slot, and the slot is empty without one', () => {
    expect(slotBytes(EMPTY_SLOTS).router).toBeNull()
    expect(slotBytes(EMPTY_SLOTS, ROUTER_BYTES).router).toBe(ROUTER_BYTES)
    expect(slotBytes(EMPTY_SLOTS, ROUTER_BYTES).sched).toBeNull()
  })

  test('a cluster session gives each worker its own radix instance and routes through them', async () => {
    const { made, send } = hostWithRadix()
    const [ready] = await send({
      cmd: 'open',
      open: { mode: 'cluster', slots: { ...noModules, router: ROUTER_BYTES }, traffic: stream(), cfg: { worker: WORKER, workers: 3, router: 'prefix', intakeCap: 32, drainPerTick: 6 } },
    })
    expect(ready.type).toBe('ready')
    expect(made).toHaveLength(3)
    for (const m of made) expect(m.cmds[0]).toBe('reset')

    let snap
    do {
      const [step] = await send({ cmd: 'step', ticks: 50 })
      if (step.type !== 'step' || step.snapshot.mode !== 'cluster') throw new Error('expected a cluster snapshot')
      snap = step.snapshot
    } while (!snap.done)
    expect(snap.agg.completed).toBe(240)
    // the learner's caches did the matching, not the reference
    expect(made.every((m) => m.cmds.some((c) => c.startsWith('match')))).toBe(true)
    expect(made.every((m) => m.cmds.some((c) => c.startsWith('insert')))).toBe(true)
    expect(snap.workers.every((w) => w.cacheEntries > 0)).toBe(true)
    expect(snap.agg.kvHitRate).toBeGreaterThan(0)
  })

  test('with the slot empty the cluster keeps the reference router and instantiates nothing', async () => {
    const { made, send } = hostWithRadix()
    const [ready] = await send({
      cmd: 'open',
      open: { mode: 'cluster', slots: noModules, traffic: stream(), cfg: { worker: WORKER, workers: 2, router: 'prefix', intakeCap: 32, drainPerTick: 6 } },
    })
    expect(ready.type).toBe('ready')
    expect(made).toHaveLength(0)
  })

  test('an incident open carries the slot: every worker\'s instance loads and answers reset', async () => {
    const spec = generateIncident('drill', 's20-0')
    const { made, send } = hostWithRadix()
    const [ready] = await send({ cmd: 'open', open: { mode: 'incident', spec, slots: { ...noModules, router: ROUTER_BYTES } } })
    expect(ready.type).toBe('ready')
    expect(made).toHaveLength(spec.workers)
    for (const m of made) expect(m.cmds).toEqual(['reset'])
  })

  test('an incident open with a stale radix cache fails with the rebuild message', async () => {
    const spec = generateIncident('drill', 's20-0')
    const { send } = hostWithRadix(() => fakeRadix((cmd) => (cmd === 'reset' ? 'err unknown command "reset"' : undefined)))
    const [reply] = await send({ cmd: 'open', open: { mode: 'incident', spec, slots: { ...noModules, router: ROUTER_BYTES } } })
    expect(reply).toMatchObject({ type: 'failed', kind: 'abi', message: REFUSALS['stale-version'] })
  })

  test('a cluster open with an unfinished radix cache fails as a trap, like any other unfinished module', async () => {
    const { send } = hostWithRadix(() =>
      fakeRadix(() => {
        throw new LabTrapError()
      }),
    )
    const [reply] = await send({
      cmd: 'open',
      open: { mode: 'cluster', slots: { ...noModules, router: ROUTER_BYTES }, traffic: [], cfg: { worker: WORKER, workers: 2, router: 'prefix', intakeCap: 32, drainPerTick: 6 } },
    })
    expect(reply).toMatchObject({ type: 'failed', kind: 'trap' })
  })
})

describe('the cluster panel shows your installed radix cache as the router', () => {
  /**
   * Effects do not run in a server render, so this checks the half of the wiring a render shows: the panel reads the
   * prefix-router module from the slots store, and its label and worker rows follow it. That the same bytes reach the
   * session is slotBytes (tested above). zustand serves a server render from the store's initial state, so that
   * object carries the installed modules for the render and gets its own back after.
   */
  const render = (installed: InstalledSlots) => {
    const initial = useSlots.getInitialState()
    const before = initial.installed
    initial.installed = installed
    try {
      return renderToString(createElement(MemoryRouter, null, createElement(ClusterPanel, { slots: EMPTY_SLOTS })))
    } finally {
      initial.installed = before
    }
  }
  const radix: InstalledSlots = {
    'prefix-router': { slot: 'prefix-router', labId: 'radix-cache', sha256: 'a'.repeat(64), bytes: new ArrayBuffer(8) } as InstalledSlots['prefix-router'],
  }

  test('with a prefix-router module installed the stack line says your radix cache routes', () => {
    expect(render(radix)).toContain('your radix cache routes')
  })

  test('without one the panel keeps the reference router and says nothing of a radix cache', () => {
    expect(render({})).not.toContain('radix cache')
    // an installed module whose bytes are not on this device does not count
    expect(render({ 'prefix-router': { ...radix['prefix-router']!, bytes: null } })).not.toContain('radix cache')
  })
})
