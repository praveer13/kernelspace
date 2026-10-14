/**
 * Act IV as probe drills on unseen seeds (docs/specs/wave-2.md §9.8, task 2b-17).
 *
 * A drill opens an incident session on reference components with a seed drawn when the drill starts, and is scored
 * by the session's `finish`; the act passes after one passed drill on each of three distinct faults; a drill on a
 * seed the learner has seen (a replay, or no fresh seed at all) never counts. This holds the exit gate "Act IV passes
 * only on unseen seeds" (B3): the pass rule, the credit rules, the events the store receives, `INCIDENTS` as the
 * shared menus, and that the static incidents, their worker job and the first-call-only credit are gone.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as week from '../../src/lib/fleet-week'
import {
  DRILL_BURN_FACTOR,
  DRILL_BURN_SLACK,
  DRILL_FAULTS_NEEDED,
  INCIDENTS,
  actScore,
  drillCreditsFrom,
  drillFor,
  drillKey,
  drillPassed,
  drillResult,
  encodeCredits,
  gradeDrill,
  recordDrill,
  replayDrill,
  startDrill,
  type DrillAttempt,
  type DrillCredit,
} from '../../src/lib/fleet-week'
import { createFleetHost } from '../../src/lib/fleet-host'
import { openIncidentSession, type FleetWorkerLike } from '../../src/lib/fleet-session'
import { hash32 } from '../../src/lib/rng'
import { FAULT_LABELS, FAULT_SHORT, FIXES, FIX_IDS, INCIDENT_FAULTS, fixFor, type FixId, type IncidentAction, type IncidentFault } from '../../src/lib/world/incident-spec'
import { replayIncident, runExpert, scoreIncident } from '../../src/lib/world/incident-sim'
import { HYPOTHESIS_OPTIONS, kcsFor, menuOrderFor, type FinishedIncident } from '../../src/lib/world/daily'
import type { FleetReply, FleetRequest } from '../../src/workers/fleet-protocol'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = path.join(import.meta.dir, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** The first seed (counting up from 1) whose drill is `fault`, and the next after it: distinct, fresh seeds per fault. */
function seedsFor(fault: IncidentFault, count = 1): number[] {
  const out: number[] = []
  for (let seed = 1; out.length < count; seed++) if (drillFor(seed).spec.fault === fault) out.push(seed)
  return out
}

/** What `finish` reports for a drill, from a facts slice: every field `recordDrill` reads. */
function finished(fault: IncidentFault, over: Partial<FinishedIncident> = {}): FinishedIncident {
  return {
    fault,
    severity: 2,
    firstHypothesis: 'unsure',
    hypothesis: fault,
    probes: ['intake', 'kv'],
    fix: fixFor(fault),
    diagnosed: true,
    fixed: true,
    burn: 6,
    expertBurn: 5,
    streetlight: 0,
    ...over,
  }
}

/* ------------------------------------------------------------------ */
/* The menus                                                            */
/* ------------------------------------------------------------------ */

describe('INCIDENTS keeps its shape as the shared hypothesis and fix menus', () => {
  test('one entry per catalog fault, in catalog order, with the old fields', () => {
    expect(INCIDENTS.map((i) => i.id)).toEqual([...INCIDENT_FAULTS])
    for (const inc of INCIDENTS) {
      expect(Object.keys(inc).sort()).toEqual(['briefing', 'causes', 'id', 'mitigations', 'title'])
      expect(inc.briefing.length).toBeGreaterThan(40)
      expect(inc.title).toMatch(/^incident 0[1-4] — /)
    }
  })

  test('the option texts and their order are identical across entries; only correct and the whys vary', () => {
    const [first, ...rest] = INCIDENTS
    for (const inc of rest) {
      expect(inc.causes.map((o) => [o.id, o.label])).toEqual(first.causes.map((o) => [o.id, o.label]))
      expect(inc.mitigations.map((o) => [o.id, o.label])).toEqual(first.mitigations.map((o) => [o.id, o.label]))
    }
    const keys = INCIDENTS.map((inc) => inc.causes.findIndex((o) => o.correct))
    expect(new Set(keys).size).toBe(INCIDENT_FAULTS.length) // each option is the key of exactly one entry
    const fixKeys = INCIDENTS.map((inc) => inc.mitigations.findIndex((o) => o.correct))
    expect(new Set(fixKeys).size).toBe(INCIDENT_FAULTS.length)
    expect(INCIDENTS.map((inc) => inc.causes.map((o) => o.why).join('|')).every((w, i, all) => all.indexOf(w) === i)).toBe(true)
  })

  test('exactly one key per list, and it is the running fault and the fix that reverts it', () => {
    for (const inc of INCIDENTS) {
      const fault = inc.id as IncidentFault
      expect(inc.causes.filter((o) => o.correct).map((o) => o.id)).toEqual([fault])
      expect(inc.mitigations.filter((o) => o.correct).map((o) => o.id)).toEqual([fixFor(fault)])
      expect(inc.causes).toHaveLength(INCIDENT_FAULTS.length)
      expect(inc.mitigations).toHaveLength(Object.keys(FIXES).length)
    }
  })

  test('every option carries a why; a key says "Right:" and a distractor does not', () => {
    for (const inc of INCIDENTS) {
      for (const o of [...inc.causes, ...inc.mitigations]) {
        expect(typeof o.why).toBe('string')
        expect(o.why!.length).toBeGreaterThan(60)
        expect(o.why!.startsWith('Right: ')).toBe(o.correct)
      }
    }
  })

  test('the texts have no length cue to find: one character count and one word count per menu', () => {
    for (const list of [INCIDENTS[0].causes, INCIDENTS[0].mitigations]) {
      expect(new Set(list.map((o) => o.label.length)).size).toBe(1)
      expect(new Set(list.map((o) => o.label.split(/\s+/).length)).size).toBe(1)
    }
  })
})

/* ------------------------------------------------------------------ */
/* The pass rule                                                        */
/* ------------------------------------------------------------------ */

describe('a drill passes on the right fault, the right fix and a bounded burn (Q5)', () => {
  const facts = { diagnosed: true, fixed: true, expertBurn: 4 }

  test('burn up to twice the expert\'s plus five passes, a hair over fails', () => {
    expect(DRILL_BURN_FACTOR).toBe(2)
    expect(DRILL_BURN_SLACK).toBe(5)
    expect(drillPassed({ ...facts, burn: 13 })).toBe(true)
    expect(drillPassed({ ...facts, burn: 13.01 })).toBe(false)
    expect(drillPassed({ ...facts, burn: 0 })).toBe(true)
  })

  test('naming the wrong fault or missing the fix fails however low the burn', () => {
    expect(drillPassed({ ...facts, burn: 1, diagnosed: false })).toBe(false)
    expect(drillPassed({ ...facts, burn: 1, fixed: false })).toBe(false)
  })

  test('the act needs three distinct faults', () => {
    expect(DRILL_FAULTS_NEEDED).toBe(3)
    expect(INCIDENT_FAULTS.length).toBeGreaterThan(DRILL_FAULTS_NEEDED)
  })
})

/* ------------------------------------------------------------------ */
/* Credit                                                               */
/* ------------------------------------------------------------------ */

describe('only passed drills on fresh seeds and new faults count', () => {
  const [a] = seedsFor('pool-shrink')
  const [b] = seedsFor('drain-stall')
  const [c] = seedsFor('node-death')
  const [d] = seedsFor('tenant-burst')
  const attempt = (fault: IncidentFault, seed: number | null, over: Partial<DrillAttempt> = {}): DrillAttempt => ({
    ...finished(fault),
    seed,
    ...over,
  })

  test('three passed drills on three distinct faults pass the act, with the mean drill score', () => {
    let credits: DrillCredit[] = []
    const verdicts: string[] = []
    for (const [fault, seed] of [['pool-shrink', a], ['drain-stall', b], ['node-death', c]] as const) {
      const g = gradeDrill(credits, attempt(fault, seed))
      verdicts.push(g.verdict)
      credits = g.credits
      expect(g.pass).toBe(credits.length === 3)
    }
    expect(verdicts).toEqual(['credited', 'credited', 'credited'])
    expect(actScore(credits)).toBeCloseTo(6 / 7, 6) // (expert 5 + 1) / (burn 6 + 1) each
  })

  test('a second pass on a fault that already counts does not add to the three', () => {
    const [a2] = seedsFor('pool-shrink', 2).slice(1)
    const credits = gradeDrill([], attempt('pool-shrink', a)).credits
    for (const seed of [a2, a2 + 1000]) {
      const g = gradeDrill(credits, attempt('pool-shrink', seed))
      expect(g.verdict).toBe('repeat-fault')
      expect(g.credits).toEqual(credits)
      expect(g.pass).toBe(false)
    }
  })

  test('a failed drill closes nothing: the next drill on a new seed still counts', () => {
    const failed = gradeDrill([], attempt('pool-shrink', a, { diagnosed: false }))
    expect(failed.verdict).toBe('failed')
    expect(failed.credits).toEqual([])
    expect(failed.result.detail).toContain('Retries are free')
    expect(failed.result.pass).toBe(false)
    const [, again] = seedsFor('pool-shrink', 2)
    expect(gradeDrill(failed.credits, attempt('pool-shrink', again)).verdict).toBe('credited')
  })

  test('a drill on a practice seed never counts, however well it was played', () => {
    const perfect = attempt('pool-shrink', null, { burn: 0, expertBurn: 0 })
    expect(drillPassed(perfect)).toBe(true)
    const g = gradeDrill([], perfect)
    expect(g.verdict).toBe('practice')
    expect(g.credits).toEqual([])
    expect(g.result.practice).toBe(true)
    expect(g.result.pass).toBe(false)
    // and three of them in a row complete nothing
    let credits: DrillCredit[] = []
    for (const fault of ['pool-shrink', 'drain-stall', 'node-death'] as const) credits = gradeDrill(credits, attempt(fault, null)).credits
    expect(credits).toEqual([])
    // a seed that already earned a credit is not fresh again
    const earned = gradeDrill([], attempt('drain-stall', b)).credits
    const replay = gradeDrill(earned, attempt('drain-stall', b))
    expect(replay.verdict).toBe('practice')
    expect(replay.credits).toEqual(earned)
  })

  test('the fourth fault can stand in for any of the three', () => {
    let credits: DrillCredit[] = []
    for (const [fault, seed] of [['tenant-burst', d], ['drain-stall', b], ['node-death', c]] as const) credits = gradeDrill(credits, attempt(fault, seed)).credits
    expect(credits).toHaveLength(3)
  })
})

describe('a drill seed is drawn when the drill starts', () => {
  test('startDrill draws one seed per call and generates the incident from it', () => {
    const draws = [0xdeadbeef, 0x00000007]
    const first = startDrill(() => draws.shift() as number)
    expect(first.seed).toBe(0xdeadbeef)
    expect(first.practice).toBe(false)
    expect(first.source).toEqual({ ns: 'drill', key: 'deadbeef' })
    expect(first.spec.ns).toBe('drill')
    expect(first.spec.key).toBe('deadbeef')
    const second = startDrill(() => draws.shift() as number)
    expect(second.source.key).toBe('00000007') // eight digits, as the seed label shows it
    expect(drillKey(2 ** 32 + 5)).toBe('00000005')
  })

  test('with no argument it draws from freshSeed: two drills do not share a seed', () => {
    const seeds = new Set(Array.from({ length: 8 }, () => startDrill().seed))
    expect(seeds.size).toBe(8)
  })

  test('the same seed is the same incident, and a replay is flagged practice without changing it', () => {
    const d = drillFor(1234)
    expect(drillFor(1234).spec).toEqual(d.spec)
    const r = replayDrill(d)
    expect(r.practice).toBe(true)
    expect(r.spec).toEqual(d.spec)
    expect(d.practice).toBe(false)
  })

  test('faults are drawn from the whole catalog: all four turn up in a few dozen seeds', () => {
    const seen = new Set(Array.from({ length: 64 }, (_, i) => startDrill(() => i * 2654435761).spec.fault))
    expect([...seen].sort()).toEqual([...INCIDENT_FAULTS].sort())
  })
})

/* ------------------------------------------------------------------ */
/* What the store receives                                              */
/* ------------------------------------------------------------------ */

describe('recordDrill writes the events and completes the act on the third distinct fault', () => {
  test('a fresh drill writes an incident event graded unseen with its own seed; a practice replay writes nothing', () => {
    const store = startTab(makeProfile()).progress
    const [seed] = seedsFor('pool-shrink')
    const drill = drillFor(seed)
    const g = recordDrill(store, drill, finished('pool-shrink'))
    expect(g.verdict).toBe('credited')
    const ref = 'inc:drill/pool-shrink' as const
    expect(store.getState().aggregate.incidents[ref]?.n).toBe(1)

    const replay = recordDrill(store, replayDrill(drill), finished('pool-shrink', { burn: 0 }))
    expect(replay.verdict).toBe('practice')
    expect(store.getState().aggregate.incidents[ref]?.n).toBe(1)
    expect(Object.keys(store.getState().aggregate.incidents)).toEqual([ref])
    expect(store.getState().aggregate.facts[ref]).toBe(true) // the ok drill is a fact (spec section 3.4)
  })

  test('the drill event is the fault\'s drill ref (the ledger\'s grammar) with src drill, act4, the KCs and no components', () => {
    const [seed] = seedsFor('node-death')
    const r = drillResult(drillFor(seed), finished('node-death'))
    expect(r.ref).toBe('inc:drill/node-death')
    expect(r.seed).toBe(seed)
    expect(r.data).toMatchObject({ v: 1, src: 'drill', act4: true, fault: 'node-death', components: [], diagnosed: true, fixed: true })
    expect(r.data.kcs).toEqual(kcsFor('node-death'))
    expect('date' in r.data).toBe(false)
  })

  test('three passed drills on distinct faults complete Act IV once, with provenance unseen, the seed and the evidence', async () => {
    const tab = startTab(makeProfile())
    const store = tab.progress
    const plan = [['pool-shrink', seedsFor('pool-shrink')[0]], ['drain-stall', seedsFor('drain-stall')[0]], ['node-death', seedsFor('node-death')[0]]] as const
    for (const [i, [fault, seed]] of plan.entries()) {
      expect(store.getState().fleetWeek.actsDone).not.toContain('incident')
      const g = recordDrill(store, drillFor(seed), finished(fault))
      expect(g.pass).toBe(i === 2)
    }
    expect(store.getState().fleetWeek.actsDone).toContain('incident')
    expect(store.getState().fleetWeek.scores.incident).toBeCloseTo(6 / 7, 3)

    // a fourth pass, and a failed one, add events but do not complete the act again
    const [seed4] = seedsFor('tenant-burst')
    recordDrill(store, drillFor(seed4), finished('tenant-burst'))
    recordDrill(store, drillFor(99), finished(drillFor(99).spec.fault, { diagnosed: false }))

    await store.controls.flush()
    const events = await (await tab.engine()).events()
    const acts = events.filter((e) => e.kind === 'fleet-act' && e.ref === 'fw:incident')
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ provenance: 'unseen', seed: plan[2][1] })
    expect(acts[0].data).toEqual({ faults: ['pool-shrink', 'drain-stall', 'node-death'], seeds: plan.map(([, s]) => drillKey(s)) })
    const drills = events.filter((e) => e.kind === 'incident')
    expect(drills).toHaveLength(5)
    for (const e of drills) {
      expect(e.provenance).toBe('unseen')
      expect(e.ref).toMatch(/^inc:drill\/(pool-shrink|drain-stall|node-death|tenant-burst)$/)
    }
  })

  test('practice drills on three faults leave the act open and the store free of drill events', async () => {
    const tab = startTab(makeProfile())
    const store = tab.progress
    for (const fault of ['pool-shrink', 'drain-stall', 'node-death'] as const) {
      const drill = replayDrill(drillFor(seedsFor(fault)[0]))
      expect(recordDrill(store, drill, finished(fault, { burn: 0, expertBurn: 0 })).verdict).toBe('practice')
    }
    expect(store.getState().fleetWeek.actsDone).not.toContain('incident')
    expect(Object.keys(store.getState().aggregate.incidents)).toEqual([])
    await store.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'incident' || e.kind === 'fleet-act')).toEqual([])
    expect(store.getState().fleetWeek.measurementEvidence?.incident).toBeUndefined()
  })

  test('a failed drill writes its event (graded not ok) but credits nothing', () => {
    const store = startTab(makeProfile()).progress
    const [seed] = seedsFor('pool-shrink')
    const g = recordDrill(store, drillFor(seed), finished('pool-shrink', { diagnosed: false }))
    expect(g.verdict).toBe('failed')
    const inc = store.getState().aggregate.incidents['inc:drill/pool-shrink']
    expect(inc?.n).toBe(1)
    expect(inc?.okAt).toBeFalsy()
    expect(store.getState().fleetWeek.measurementEvidence?.incident).toBeUndefined()
  })
})

describe('the credits are read back defensively', () => {
  test('encode then decode is the identity', () => {
    const credits: DrillCredit[] = [
      { fault: 'pool-shrink', seed: seedsFor('pool-shrink')[0], score: 0.857 },
      { fault: 'node-death', seed: seedsFor('node-death')[0], score: 1 },
    ]
    expect(drillCreditsFrom({ credited: encodeCredits(credits) })).toEqual(credits)
  })

  test('static-incident ids from the old ledger, malformed entries and a fault that does not match its seed are dropped', () => {
    const [seed] = seedsFor('drain-stall')
    const good = `drain-stall:${drillKey(seed)}:900`
    const forged = [
      'kv-thrash',
      'intake-stall',
      good,
      good, // a repeat
      `drain-stall:${drillKey(seedsFor('drain-stall', 2)[1])}:900`, // a second credit for the same fault
      `pool-shrink:${drillKey(seed)}:900`, // the seed generates drain-stall, not pool-shrink
      'made-up:00000001:900',
      `drain-stall:${drillKey(seed)}:99999`,
      42,
      null,
    ]
    expect(drillCreditsFrom({ credited: forged })).toEqual([{ fault: 'drain-stall', seed, score: 0.9 }])
    expect(drillCreditsFrom(undefined)).toEqual([])
    expect(drillCreditsFrom({ credited: 'x' })).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* A drill through the session, as the page plays it                    */
/* ------------------------------------------------------------------ */

class FakeWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  private terminated = false
  private readonly host = createFleetHost()
  constructor() {
    queueMicrotask(() => this.deliver({ type: 'boot' }))
  }
  private deliver(reply: FleetReply) {
    if (!this.terminated) this.onmessage?.({ data: reply })
  }
  postMessage(msg: FleetRequest) {
    if (this.terminated) return
    setTimeout(() => void this.host.handle(msg, (reply) => this.deliver(reply)), 0)
  }
  terminate() {
    this.terminated = true
  }
}

describe('drills played in a fleet worker session on reference components', () => {
  test('the expert\'s line on a fresh seed passes, records once and counts; the same seed replayed does not', async () => {
    const [seed] = seedsFor('tenant-burst')
    const drill = startDrill(() => seed)
    const expert = runExpert(drill.spec)
    const session = await openIncidentSession({ mode: 'incident', spec: drill.spec, slots: { sched: null, mgr: null, queue: null } }, { spawn: () => new FakeWorker() })
    for (const a of expert.actions) {
      if (a.kind === 'hypothesis') await session.hypothesis(a.fault)
      else if (a.kind === 'probe') await session.probe(a.probe)
      else if (a.kind === 'fix') expect((await session.fix(a.fix)).effective).toBe(true)
      else await session.wait()
    }
    const done = await session.finish()
    session.close()
    expect(done.fault).toBe('tenant-burst')
    expect(drillPassed(done)).toBe(true)

    const store = startTab(makeProfile()).progress
    expect(recordDrill(store, drill, done).verdict).toBe('credited')
    expect(recordDrill(store, replayDrill(drill), done).verdict).toBe('practice')
    expect(store.getState().aggregate.incidents['inc:drill/tenant-burst']?.n).toBe(1)
  }, 60_000)

  test('a learner who names the wrong fault fails the drill and the retry on a new seed is open', () => {
    const [seed, next] = seedsFor('pool-shrink', 2)
    const spec = drillFor(seed).spec
    const wrong = scoreIncident(spec, [
      { kind: 'hypothesis', fault: 'node-death' },
      { kind: 'fix', fix: 'replace-node' },
      { kind: 'fix', fix: fixFor('pool-shrink') },
    ])
    expect(wrong.diagnosed).toBe(false)
    const store = startTab(makeProfile()).progress
    expect(recordDrill(store, drillFor(seed), wrong).verdict).toBe('failed')
    const right = scoreIncident(drillFor(next).spec, runExpert(drillFor(next).spec).actions)
    expect(recordDrill(store, drillFor(next), right).verdict).toBe('credited')
  }, 60_000)
})

/* ------------------------------------------------------------------ */
/* The act certifies diagnosis (the 2b final review's F1)               */
/* ------------------------------------------------------------------ */

describe('Act IV certifies probing: diagnosed is the hypothesis held at the first fix', () => {
  const SEEDS = 300
  const seedOf = (i: number) => hash32(`bf2-act4:${i}`)

  /** The learner who takes no probes and works down the fix menu as shown, naming each fix's fault just before applying it. */
  const walker = (spec: ReturnType<typeof drillFor>['spec']): IncidentAction[] =>
    menuOrderFor(spec).fixes.flatMap((fix): IncidentAction[] => [
      { kind: 'hypothesis', fault: FIXES[fix].fault },
      { kind: 'fix', fix },
    ])

  /** One blind guess: name a fault by a hash of the seed, apply its fix, and stop. */
  const blind = (spec: ReturnType<typeof drillFor>['spec']): IncidentAction[] => {
    const fault = INCIDENT_FAULTS[hash32(`blind:${spec.seed}`) % INCIDENT_FAULTS.length]
    return [
      { kind: 'hypothesis', fault },
      { kind: 'fix', fix: fixFor(fault) },
    ]
  }

  /** The old rule: the hypothesis held when the right fix landed, whatever came before it. */
  const legacyDiagnosed = (spec: ReturnType<typeof drillFor>['spec'], log: readonly IncidentAction[]): boolean => {
    let held: string | undefined
    for (const a of log) {
      if (a.kind === 'hypothesis') held = a.fault
      else if (a.kind === 'fix' && FIXES[a.fix].fault === spec.fault) return held === spec.fault
    }
    return false
  }

  function measure() {
    const out = { expert: 0, walker: 0, walkerLegacy: 0, blind: 0, blindFixed: 0 }
    for (let i = 0; i < SEEDS; i++) {
      const { spec } = drillFor(seedOf(i))
      const e = runExpert(spec)
      const verdict = (log: readonly IncidentAction[]) => {
        const o = replayIncident(spec, log)
        return { passed: drillPassed({ ...o, expertBurn: e.outcome.burn }), fixed: o.fixed, o }
      }
      if (drillPassed({ ...e.outcome, expertBurn: e.outcome.burn })) out.expert++
      const w = walker(spec)
      const wv = verdict(w)
      if (wv.passed) out.walker++
      // the same walk under the old rule: diagnosed read the hypothesis held at the right fix
      if (legacyDiagnosed(spec, w) && wv.o.fixed && wv.o.burn <= 2 * e.outcome.burn + 5) out.walkerLegacy++
      const b = verdict(blind(spec))
      if (b.passed) out.blind++
      if (b.fixed) out.blindFixed++
    }
    return out
  }

  test(`over ${SEEDS} fresh drill seeds the expert passes every one, and a fix-menu walker or one blind guess passes about one in four`, () => {
    const m = measure()
    console.log(
      `Act IV drills on ${SEEDS} seeds: expert ${m.expert}/${SEEDS}; fix-menu walker ${m.walker}/${SEEDS} (the old rule passed it ${m.walkerLegacy}/${SEEDS}); one blind guess ${m.blind}/${SEEDS}`,
    )
    expect(m.expert).toBe(SEEDS)
    // the walk used to pass about nine drills in ten; now only the walk whose first fix is right can
    expect(m.walkerLegacy / SEEDS).toBeGreaterThan(0.8)
    expect(m.walker / SEEDS).toBeLessThan(0.35)
    expect(m.walker / SEEDS).toBeGreaterThan(0.15)
    expect(m.blind / SEEDS).toBeLessThan(0.35)
    expect(m.blind / SEEDS).toBeGreaterThan(0.15)
    // a blind guess that lands the right fix is, by construction, a diagnosed one
    expect(m.blind).toBe(m.blindFixed)
  }, 300_000)

  test('the act is out of reach for the walker: drills until three distinct faults pass, against the expert\'s', () => {
    // retries are free, so the walker eventually gets there on luck; count the drills it needs on a run of fresh seeds
    const needed = (play: (spec: ReturnType<typeof drillFor>['spec']) => IncidentAction[] | 'expert'): number => {
      const passed = new Set<IncidentFault>()
      let n = 0
      for (let i = 0; passed.size < DRILL_FAULTS_NEEDED && n < 400; i++, n++) {
        const { spec } = drillFor(hash32(`bf2-act:${i}`))
        const e = runExpert(spec)
        const log = play(spec)
        const o = log === 'expert' ? e.outcome : replayIncident(spec, log)
        if (drillPassed({ ...o, expertBurn: e.outcome.burn })) passed.add(spec.fault)
      }
      return n
    }
    const expertDrills = needed(() => 'expert')
    const walkerDrills = needed(walker)
    console.log(`Act IV act: three distinct faults passed after ${expertDrills} drills for the expert, ${walkerDrills} for the fix-menu walker`)
    expect(expertDrills).toBeLessThanOrEqual(DRILL_FAULTS_NEEDED + 3)
    // one in four per drill, over four faults: well over twice the drills
    expect(walkerDrills).toBeGreaterThan(expertDrills * 2)
  }, 300_000)

  test('the walk fails at the second fix however it is named: the first fix\'s hypothesis is the one scored', () => {
    const { spec } = drillFor(seedsFor('pool-shrink')[0])
    const first = menuOrderFor(spec).fixes.find((f) => FIXES[f].fault !== 'pool-shrink') as FixId
    const log: IncidentAction[] = [
      { kind: 'hypothesis', fault: FIXES[first].fault },
      { kind: 'fix', fix: first },
      { kind: 'hypothesis', fault: 'pool-shrink' },
      { kind: 'fix', fix: fixFor('pool-shrink') },
    ]
    const o = replayIncident(spec, log)
    expect(o.fixed).toBe(true)
    expect(o.diagnosed).toBe(false)
    expect(drillPassed({ ...o, expertBurn: runExpert(spec).outcome.burn })).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* The menus a drill shows                                              */
/* ------------------------------------------------------------------ */

describe('Act IV\'s option lists are drawn fresh per drill, so position carries no cue (F8 and the label source)', () => {
  const DRAWS = 1200

  test('the shown labels are the gated labels: INCIDENTS reads the flow\'s own FAULT_LABELS and FIXES, and no second copy exists', () => {
    for (const inc of INCIDENTS) {
      expect(inc.causes.map((o) => [o.id, o.label])).toEqual(INCIDENT_FAULTS.map((f) => [f, FAULT_LABELS[f]]))
      for (const o of inc.mitigations) expect(o.label).toBe(FIXES[o.id as keyof typeof FIXES].label)
    }
    for (const o of HYPOTHESIS_OPTIONS.filter((h) => h.id !== 'unsure')) expect(o.label).toBe(FAULT_LABELS[o.id as IncidentFault])
    const src = read('src/lib/fleet-week.ts')
    expect(src).not.toMatch(/CAUSE_LABELS|FIX_LABELS/)
  })

  test('every fault and fix has a short form for chips and quotes, and the menus keep the full sentence', () => {
    const shorts = [...INCIDENT_FAULTS.map((f) => FAULT_SHORT[f]), ...FIX_IDS.map((f) => FIXES[f].short)]
    expect(new Set(shorts).size).toBe(shorts.length)
    for (const f of INCIDENT_FAULTS) {
      expect(FAULT_SHORT[f].length).toBeLessThanOrEqual(20)
      expect(FAULT_SHORT[f].length).toBeLessThan(FAULT_LABELS[f].length)
    }
    for (const f of FIX_IDS) {
      expect(FIXES[f].short.length).toBeLessThanOrEqual(20)
      expect(FIXES[f].short.length).toBeLessThan(FIXES[f].label.length)
    }
    for (const inc of INCIDENTS) {
      const shown = [...inc.causes, ...inc.mitigations].map((o) => o.label)
      for (const t of shorts) expect(shown).not.toContain(t)
    }
    // the drill verdict names the fault by its short form
    expect(gradeDrill([], { ...finished('node-death'), seed: 1 }).result.headline).toBe(`drill passed: ${FAULT_SHORT['node-death']}`)
  })

  test('the node-death briefing and whys do not count the workers still up: they read right on a fleet of two or four', () => {
    const nd = INCIDENTS.find((i) => i.id === 'node-death')!
    for (const t of [nd.briefing, ...nd.causes.map((o) => o.why ?? ''), ...nd.mitigations.map((o) => o.why ?? '')]) {
      expect(t).not.toMatch(/\bthe workers still up\b/i)
    }
    expect(nd.briefing).toMatch(/each worker still up has a long waiting list/)
  })

  test('each drill shows the four faults and the four fixes in an order drawn from its own seed, with "Unsure" last', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const { spec } = drillFor(hash32(`bf2-menu:${i}`))
      const m = menuOrderFor(spec)
      expect(m.hypotheses.map((o) => o.id).slice(0, -1).sort()).toEqual([...INCIDENT_FAULTS].sort())
      expect(m.hypotheses[m.hypotheses.length - 1].id).toBe('unsure')
      expect([...m.fixes].sort()).toEqual([...FIX_IDS].sort())
      expect(menuOrderFor(spec)).toEqual(m) // the same drill shows the same order (a replay, a re-render)
      seen.add(m.hypotheses.map((o) => o.id).join() + '|' + m.fixes.join())
    }
    // 24 orders of each menu: 200 drills see most of the combinations, so the order is not a fixed list
    expect(seen.size).toBeGreaterThan(100)
  })

  test('the key sits at each position about equally often, whichever fault is running (no position cue)', () => {
    const hypo = Array.from({ length: INCIDENT_FAULTS.length }, () => Array<number>(INCIDENT_FAULTS.length).fill(0))
    const fix = Array.from({ length: INCIDENT_FAULTS.length }, () => Array<number>(FIX_IDS.length).fill(0))
    const perFault = Array<number>(INCIDENT_FAULTS.length).fill(0)
    for (let i = 0; i < DRAWS; i++) {
      const { spec } = drillFor(hash32(`bf2-pos:${i}`))
      const f = INCIDENT_FAULTS.indexOf(spec.fault)
      const m = menuOrderFor(spec)
      perFault[f]++
      hypo[f][m.hypotheses.findIndex((o) => o.id === spec.fault)]++
      fix[f][m.fixes.indexOf(fixFor(spec.fault))]++
    }
    for (let f = 0; f < INCIDENT_FAULTS.length; f++) {
      for (let pos = 0; pos < 4; pos++) {
        // ~300 per fault: 25 % +- 8 points is about 3 SD of a binomial
        expect(Math.abs(hypo[f][pos] / perFault[f] - 0.25)).toBeLessThan(0.08)
        expect(Math.abs(fix[f][pos] / perFault[f] - 0.25)).toBeLessThan(0.08)
      }
    }
  })

  test('the hypothesis and fix orders are drawn independently of each other and of the incident\'s own draws', () => {
    // the fault is the first draw of splitmix32(seed); the menus hash the seed on their own streams, so neither tracks the other
    let same = 0
    const n = 800
    for (let i = 0; i < n; i++) {
      const { spec } = drillFor(hash32(`bf2-ind:${i}`))
      const m = menuOrderFor(spec)
      const hi = INCIDENT_FAULTS.indexOf(m.hypotheses[0].id as IncidentFault)
      const fi = FIX_IDS.indexOf(m.fixes[0])
      if (INCIDENT_FAULTS[hi] === FIXES[FIX_IDS[fi]].fault) same++
    }
    expect(Math.abs(same / n - 0.25)).toBeLessThan(0.06)
  })

  test('both pages hand the drawn orders to the flow components, and the components render what they are given', () => {
    for (const page of ['src/pages/FleetWeek.tsx', 'src/pages/Daily.tsx']) {
      const src = read(page)
      expect(src).toContain('menuOrderFor(')
      expect(src).toContain('options={menus.hypotheses}')
      expect(src).toContain('fixes={menus.fixes}')
      expect(src).toContain('lockedAt={flow.hypothesisAtFix}')
    }
    expect(read('src/components/daily/Hypothesis.tsx')).toContain('options.map(')
    expect(read('src/components/daily/FixMenu.tsx')).toContain('fixes.map(')
  })
})

/* ------------------------------------------------------------------ */
/* What went                                                            */
/* ------------------------------------------------------------------ */

describe('the static incidents, their job and the first-call-only credit are gone', () => {
  test('fleet-week no longer exports loadIncident, runIncident, the ledger or the closed note', () => {
    const names = Object.keys(week)
    for (const gone of ['loadIncident', 'runIncident', 'INCIDENT_SCENARIOS', 'gradeIncidentCall', 'incidentLedgerFrom', 'incidentMisses', 'EMPTY_INCIDENT_LEDGER', 'INCIDENT_CLOSED_NOTE']) {
      expect(names).not.toContain(gone)
    }
  })

  test('sim.worker has no incident job and its protocol no incident result', () => {
    expect(read('src/workers/sim-protocol.ts')).not.toMatch(/kind: 'incident'|incident:/)
    expect(read('src/workers/sim.worker.ts')).not.toContain('loadIncident')
    expect(read('src/workers/sim.worker.ts')).not.toContain("case 'incident'")
  })

  test('the consistency test went with loadIncident, and the page plays the Daily\'s flow components', () => {
    expect(existsSync(path.join(ROOT, 'tests/fleet/incident-consistency.test.ts'))).toBe(false)
    const page = read('src/pages/FleetWeek.tsx')
    for (const c of ['Alert', 'Hypothesis', 'ProbeBar', 'FixMenu', 'Debrief']) expect(page).toContain(`import ${c} from '@/components/daily/${c}'`)
    expect(page).toContain('openIncidentSession')
    expect(page).toContain('recordDrill')
    expect(page).not.toContain("kind: 'incident'")
  })

  test('the page says nothing of first calls or a closed act', () => {
    expect(read('src/pages/FleetWeek.tsx')).not.toMatch(/first call|closed for now|INCIDENT_CLOSED/)
  })
})
