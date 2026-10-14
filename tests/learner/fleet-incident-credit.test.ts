/**
 * Act IV's credit lives in the progress store, not in the page (docs/specs/wave-2.md §9.8, task 2b-17).
 *
 * Until 2b-17 the act credited only a learner's first call on each of three static incidents, kept as
 * `{attempted, credited}` ids in the working record `fw:evidence:incident`, and one missed first call closed the act.
 * Drills on fresh seeds replace that: a retry is a new incident, so nothing closes. The same record now holds the
 * passed drills (`credited`: fault, seed and score), and these tests hold what that means across reloads and for a
 * learner whose store still carries the old ledger.
 */
import { describe, expect, test } from 'bun:test'
import { drillCreditsFrom, drillFor, drillKey, recordDrill } from '../../src/lib/fleet-week'
import { fixFor, type IncidentFault } from '../../src/lib/world/incident-spec'
import type { FinishedIncident } from '../../src/lib/world/daily'
import { makeProfile, startTab } from '../ledger/env'

function seedFor(fault: IncidentFault, skip = 0): number {
  let left = skip
  for (let seed = 1; ; seed++) if (drillFor(seed).spec.fault === fault && left-- === 0) return seed
}

const finished = (fault: IncidentFault, over: Partial<FinishedIncident> = {}): FinishedIncident => ({
  fault,
  severity: 1,
  firstHypothesis: 'unsure',
  hypothesis: fault,
  probes: ['intake'],
  fix: fixFor(fault),
  diagnosed: true,
  fixed: true,
  burn: 8,
  expertBurn: 6,
  streetlight: 0,
  ...over,
})

describe('the credits survive a reload', () => {
  test('a passed drill is still credited in a second tab, and its seed is no longer fresh', async () => {
    const profile = makeProfile()
    const first = startTab(profile)
    const seed = seedFor('pool-shrink')
    expect(recordDrill(first.progress, drillFor(seed), finished('pool-shrink')).verdict).toBe('credited')
    await first.progress.controls.flush()

    const second = startTab(profile) // a reload: new tab, same storage
    const credits = drillCreditsFrom(second.progress.getState().fleetWeek.measurementEvidence?.incident)
    expect(credits).toEqual([{ fault: 'pool-shrink', seed, score: 0.778 }]) // (expert 6 + 1) / (burn 8 + 1), in thousandths
  })

  test('the act stays done after a reload, and a later pass does not complete it again', async () => {
    const profile = makeProfile()
    const first = startTab(profile)
    for (const fault of ['pool-shrink', 'drain-stall', 'node-death'] as const) recordDrill(first.progress, drillFor(seedFor(fault)), finished(fault))
    expect(first.progress.getState().fleetWeek.actsDone).toContain('incident')
    await first.progress.controls.flush()

    const second = startTab(profile)
    expect(second.progress.getState().fleetWeek.actsDone).toContain('incident')
    const again = recordDrill(second.progress, drillFor(seedFor('tenant-burst')), finished('tenant-burst'))
    expect(again.verdict).toBe('credited')
    expect(again.credits).toHaveLength(4)
    await second.progress.controls.flush()
    const acts = (await (await second.engine()).events({ kinds: ['fleet-act'] })).filter((e) => e.ref === 'fw:incident')
    expect(acts).toHaveLength(1)
  })

  test('a drill on a credited seed, replayed in the second tab, is practice', async () => {
    const profile = makeProfile()
    const first = startTab(profile)
    const seed = seedFor('node-death')
    recordDrill(first.progress, drillFor(seed), finished('node-death'))
    await first.progress.controls.flush()
    const second = startTab(profile)
    const g = recordDrill(second.progress, drillFor(seed), finished('node-death'))
    expect(g.verdict).toBe('practice')
    expect(second.progress.getState().aggregate.incidents['inc:drill/node-death']?.n).toBe(1)
  })
})

describe('a store that still carries the first-call ledger is not closed', () => {
  test('a missed first call on a static incident no longer blocks anything: the next fresh drill counts', async () => {
    const profile = makeProfile()
    const first = startTab(profile)
    // what the old page wrote after one missed first call
    first.progress.getState().setFleetWeekEvidence('incident', { attempted: ['kv-thrash'], credited: [] })
    await first.progress.controls.flush()

    const second = startTab(profile)
    const stored = second.progress.getState().fleetWeek.measurementEvidence?.incident
    expect(stored?.attempted).toEqual(['kv-thrash'])
    expect(drillCreditsFrom(stored)).toEqual([])
    const g = recordDrill(second.progress, drillFor(seedFor('drain-stall')), finished('drain-stall'))
    expect(g.verdict).toBe('credited')
    expect(g.result.detail).not.toMatch(/closed|first call/i)
  })

  test('the old credited ids are ignored, so three of them are not three passed faults', () => {
    const store = startTab(makeProfile()).progress
    store.getState().setFleetWeekEvidence('incident', { attempted: ['kv-thrash', 'intake-stall', 'no-admission'], credited: ['kv-thrash', 'intake-stall', 'no-admission'] })
    expect(drillCreditsFrom(store.getState().fleetWeek.measurementEvidence?.incident)).toEqual([])
    const g = recordDrill(store, drillFor(seedFor('pool-shrink')), finished('pool-shrink'))
    expect(g.credits).toHaveLength(1)
    expect(g.pass).toBe(false)
    expect(store.getState().fleetWeek.actsDone).not.toContain('incident')
  })

  test('a hand-edited record cannot credit a fault whose seed generates another one', () => {
    const store = startTab(makeProfile()).progress
    const seed = seedFor('pool-shrink')
    store.getState().setFleetWeekEvidence('incident', {
      credited: [`drain-stall:${drillKey(seed)}:1000`, `node-death:${drillKey(seed)}:1000`, `tenant-burst:${drillKey(seed)}:1000`],
    })
    expect(drillCreditsFrom(store.getState().fleetWeek.measurementEvidence?.incident)).toEqual([])
  })
})
