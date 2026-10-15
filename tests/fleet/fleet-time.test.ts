/**
 * Fleet Week's time (task EF1; docs/specs/wave-3.md §15.1, the journey re-cut). The page measures visible time and passes
 * it in; the builders keep it as `ms`: an act run's wall time on its `fleet-run` event (`fleetRunFor`, at most
 * `FLEET_RUN_MAX_MS`), a drill's alert-to-debrief on its `incident` event (`drillResult`, at most `INCIDENT_MAX_MS`), and
 * the time spent on an act that no run or drill holds on its `fleet-act` event (`actMeta`, `recordDrill`, at most
 * `FLEET_ACT_MAX_MS`), which the façade clamps to the codec's bound (a finite `ms` of 0 or more). Before EF1 none of
 * them carried `ms`, so F1's instrument read 0 minutes for Fleet Week on every real ledger.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  FLEET_ACT_MAX_MS,
  FLEET_RUN_MAX_MS,
  actMeta,
  drillFor,
  drillResult,
  fleetRunFor,
  recordActRun,
  recordDrill,
  type ActResult,
} from '../../src/lib/fleet-week'
import type { FleetRunData, LedgerEvent } from '../../src/lib/ledger/types'
import { INCIDENT_MAX_MS, type FinishedIncident } from '../../src/lib/world/daily'
import { fixFor, type IncidentFault } from '../../src/lib/world/incident-spec'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = path.join(import.meta.dir, '../..')
const COMPONENTS: FleetRunData['components'] = [{ slot: 'scheduler', labId: 'batching-scheduler', sha256: 'a'.repeat(64) }]
const RUN: ActResult = { pass: true, score: 1, headline: '', detail: '', metrics: [], seed: 99, run: { goodput: 10, refGoodput: 11 } }
const EVIDENCE = { runId: '0a1b2c3d', checks: [], uncited: [] }

const finished = (fault: IncidentFault): FinishedIncident => ({ fault, severity: 2, hypothesis: fault, probes: ['kv'], fix: fixFor(fault), diagnosed: true, fixed: true, burn: 6, expertBurn: 5, streetlight: 0 })
/** The first seed (from 1) whose drill is `fault`. */
const seedFor = (fault: IncidentFault): number => {
  let seed = 1
  while (drillFor(seed).spec.fault !== fault) seed++
  return seed
}

async function eventsOf(tab: ReturnType<typeof startTab>): Promise<LedgerEvent[]> {
  await tab.progress.controls.flush()
  return (await (await tab.engine()).events()) as LedgerEvent[]
}

describe('the builders keep the time the page measured', () => {
  test('fleetRunFor: the run\'s wall time, whole ms, at most FLEET_RUN_MAX_MS; none without a measurement or a run to record', () => {
    expect(fleetRunFor('act1', RUN, COMPONENTS, 41_250.4)?.ms).toBe(41_250)
    expect(fleetRunFor('act1', RUN, COMPONENTS, 3 * 3_600_000)?.ms).toBe(FLEET_RUN_MAX_MS)
    expect(fleetRunFor('act2', RUN, COMPONENTS, -1)?.ms).toBe(0)
    expect('ms' in (fleetRunFor('act1', RUN, COMPONENTS) ?? {})).toBe(false)
    expect('ms' in (fleetRunFor('act1', RUN, COMPONENTS, Number.NaN) ?? {})).toBe(false)
    expect(fleetRunFor('act1', RUN, [], 1000)).toBeNull()
  })

  test('drillResult: the drill\'s alert to its debrief, at most INCIDENT_MAX_MS', () => {
    const drill = drillFor(seedFor('pool-shrink'))
    expect(drillResult(drill, finished('pool-shrink'), [], 200_000).ms).toBe(200_000)
    expect(drillResult(drill, finished('pool-shrink'), [], 10 * 3_600_000).ms).toBe(INCIDENT_MAX_MS)
    expect('ms' in drillResult(drill, finished('pool-shrink'))).toBe(false)
  })

  test('actMeta: the time on the act, at most FLEET_ACT_MAX_MS, beside the receipts as before', () => {
    expect(actMeta(RUN, EVIDENCE, undefined, 25 * 60_000).ms).toBe(25 * 60_000)
    expect(actMeta(RUN, EVIDENCE, undefined, 8 * 3_600_000).ms).toBe(FLEET_ACT_MAX_MS)
    const plain = actMeta(RUN, EVIDENCE)
    expect('ms' in plain).toBe(false)
    expect(actMeta(RUN, EVIDENCE, undefined, 1000)).toEqual({ ...plain, ms: 1000 })
  })
})

describe('the façade writes the time on every Fleet Week event', () => {
  test('an Act I run, an Act IV drill that completes the act, and an Act I pass each carry their ms', async () => {
    const tab = startTab(makeProfile())
    const store = tab.progress
    expect(recordActRun(store, 'act1', RUN, COMPONENTS, 40_000)).toBe(true)
    const faults = ['pool-shrink', 'drain-stall', 'node-death'] as const
    for (const [i, fault] of faults.entries()) recordDrill(store, drillFor(seedFor(fault)), finished(fault), [], { ms: 120_000 + i, actMs: 600_000 })
    store.getState().completeFleetWeekAct('engine', 0.9, actMeta(RUN, EVIDENCE, undefined, 900_000))
    const events = await eventsOf(tab)
    expect(events.find((e) => e.kind === 'fleet-run')).toMatchObject({ ref: 'fleet:act1', ms: 40_000 })
    expect(events.filter((e) => e.kind === 'incident').map((e) => e.ms)).toEqual([120_000, 120_001, 120_002])
    // the act's own time is written once, on the drill that completes it
    expect(events.find((e) => e.kind === 'fleet-act' && e.ref === 'fw:incident')).toMatchObject({ ms: 600_000, provenance: 'unseen' })
    expect(events.find((e) => e.kind === 'fleet-act' && e.ref === 'fw:engine')).toMatchObject({ ms: 900_000 })
  })

  test('completeFleetWeekAct holds ms to the codec\'s bound: a negative one is 0, a non-finite one is left out, the act is kept', async () => {
    const tab = startTab(makeProfile())
    const s = tab.progress.getState()
    s.completeFleetWeekAct('engine', 0.8, { provenance: 'unseen', ms: -5 })
    s.completeFleetWeekAct('fleet', 0.8, { provenance: 'unseen', ms: Number.NaN })
    s.completeFleetWeekAct('business', 0.8, { provenance: 'unseen' })
    const acts = (await eventsOf(tab)).filter((e) => e.kind === 'fleet-act')
    expect(acts.map((e) => [e.ref, e.ms])).toEqual([
      ['fw:engine', 0],
      ['fw:fleet', undefined],
      ['fw:business', undefined],
    ])
  })
})

describe('/week measures visible time and counts each second once', () => {
  const page = readFileSync(path.join(ROOT, 'src/pages/FleetWeek.tsx'), 'utf8')

  test('one visible clock for the page, and every writer claims what its event holds', () => {
    expect(page).toContain("import { useVisibleClock } from '@/hooks/use-visible-clock'")
    expect(page).toContain('unclaimed: () => Math.max(0, visible() - claimed.current)')
    // a run: its time, claimed only when the fleet-run event was written
    expect(page).toContain('if (await recordRun(mode, done.result, slots, ms)) time.claim(ms)')
    // an act: the page's time that nothing else holds, up to the pass
    expect(page).toMatch(/const ms = time\.unclaimed\(\)\s+completeAct\(actId, r\.score, meta\(ms\)\)\s+time\.claim\(ms\)/)
    for (const act of ['engine', 'fleet']) expect(page).toContain(`const r = gradeMeasurementSubmission('${act}', trace, evidence)\n            finish(r, (ms) => actMeta(r, evidence, rubric, ms))`)
    expect(page).toContain('finish(r, (ms) => actMeta(r, evidence, rubric, ms))')
    // a drill: alert to debrief, and the act's share without it
    expect(page).toMatch(/setPhase\('play'\)\s+alertAt\.current = time\.now\(\)/)
    expect(page).toContain('const actMs = Math.max(0, time.unclaimed() - (ms ?? 0))')
    expect(page).toContain('recordDrill(useProgress, drill, done, [], { ms, actMs })')
  })

  test('the fleet modules read no clock: the time arrives as a number', () => {
    const src = readFileSync(path.join(ROOT, 'src/lib/fleet-week.ts'), 'utf8')
    for (const banned of ['Date.now', 'new Date(', 'performance.now']) expect(src).not.toContain(banned)
  })
})
