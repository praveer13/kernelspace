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
import { FIXES, INCIDENT_FAULTS, fixFor, type IncidentFault } from '../../src/lib/world/incident-spec'
import { runExpert, scoreIncident } from '../../src/lib/world/incident-sim'
import { kcsFor, type FinishedIncident } from '../../src/lib/world/daily'
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
