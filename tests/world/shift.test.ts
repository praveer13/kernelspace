/**
 * The On-Call pilot's shift mode (docs/specs/wave-3.md §16.6, task 3s-08): `/daily?shift=3` chains three
 * drill-namespace incidents from one seed, with a handoff note between them that is never stored, and records each as
 * practice. Everything the page computes for it is a pure function in world/shift, tested here; the page's own walk
 * is e2e/shift.spec.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { factMinutes } from '../../src/lib/economy'
import { splitmix32u } from '../../src/lib/rng'
import { parseIncidentRef } from '../../src/lib/ledger/refs'
import { INCIDENT_MAX_MS, dailyIncident, dailyPlayed, dailyRef, kcsFor } from '../../src/lib/world/daily'
import { FAULT_SHORT, INCIDENT_FAULTS, LIMIT_MINUTES, generateIncident, type IncidentFault } from '../../src/lib/world/incident-spec'
import { runExpert } from '../../src/lib/world/incident-sim'
import {
  SHIFT_LENGTH,
  handoffNote,
  recordShift,
  seedKey,
  shiftIncidents,
  shiftPlayed,
  shiftRef,
  shiftRequested,
  shiftResult,
  shiftSeed,
  shiftSummary,
  type ShiftFacts,
} from '../../src/lib/world/shift'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = path.join(import.meta.dir, '../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')
const date = '2026-10-23'

/** A finished incident as the debrief reports it: the expert's own play on the incident, with fields overridden. */
function facts(fault: IncidentFault, over: Partial<ShiftFacts> = {}): ShiftFacts {
  const spec = generateIncident('drill', 'cafe0001')
  const run = runExpert({ ...spec, fault })
  return { ...run.outcome, expertBurn: run.outcome.burn, ...over }
}

/* ------------------------------------------------------------------ */
/* The shift: one seed, three incidents, the same for everybody         */
/* ------------------------------------------------------------------ */

describe('the shift is three drill-namespace incidents drawn from one seed', () => {
  test('?shift=3 turns it on and nothing else does', () => {
    expect(SHIFT_LENGTH).toBe(3)
    expect(shiftRequested('3')).toBe(true)
    for (const raw of [null, '', '0', '1', '2', '4', '03', '3x', ' 3', 'true']) expect(shiftRequested(raw)).toBe(false)
  })

  test('the incidents are the first three draws of the date\'s shift seed, in the drill namespace', () => {
    const next = splitmix32u(shiftSeed(date))
    const plan = shiftIncidents(date)
    expect(plan).toHaveLength(3)
    plan.forEach((p, i) => {
      const seed = next()
      expect(p.index).toBe(i)
      expect(p.seed).toBe(seed)
      expect(p.source).toEqual({ ns: 'drill', key: seed.toString(16).padStart(8, '0') })
      expect(p.source.key).toBe(seedKey(seed))
      expect(p.source.key).toMatch(/^[0-9a-f]{8}$/)
      // the spec is exactly what Act IV's drill on that seed plays
      expect(p.spec).toEqual(generateIncident('drill', p.source.key))
      expect(p.spec.ns).toBe('drill')
      expect(p.ref).toBe(shiftRef(date, i))
    })
    expect(new Set(plan.map((p) => p.seed)).size).toBe(3)
  })

  test('it is deterministic: the same date is the same shift, and a new date is a new one', () => {
    expect(shiftIncidents(date)).toEqual(shiftIncidents(date))
    expect(shiftIncidents('2026-10-24').map((p) => p.seed)).not.toEqual(shiftIncidents(date).map((p) => p.seed))
    // pinned, so a change to the seed's derivation shows (the e2e walk reads the same three)
    expect(shiftSeed(date)).toBe(0x3b60903f)
    expect(shiftIncidents(date).map((p) => [p.source.key, p.spec.fault])).toEqual([
      ['184b2f39', 'node-death'],
      ['92038f72', 'pool-shrink'],
      ['cc8ba44b', 'node-death'],
    ])
  })

  test('it shares nothing with the Daily of the same date', () => {
    for (const d of ['2026-10-14', date, '2026-12-31']) {
      const daily = dailyIncident(d)
      for (const p of shiftIncidents(d)) {
        expect(p.spec.seed).not.toBe(daily.seed)
        expect(p.spec.ns).not.toBe(daily.ns)
      }
    }
  })

  test('over a year of dates the faults are balanced, and are drawn independently within a shift', () => {
    const counts = Object.fromEntries(INCIDENT_FAULTS.map((f) => [f, 0])) as Record<IncidentFault, number>
    let repeats = 0
    const days = 365
    for (let i = 0; i < days; i++) {
      const d = `2027-${String(1 + Math.floor(i / 31)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`
      const faults = shiftIncidents(d).map((p) => p.spec.fault)
      for (const f of faults) counts[f] += 1
      if (new Set(faults).size < 3) repeats += 1
    }
    const total = 3 * days
    for (const f of INCIDENT_FAULTS) expect(counts[f] / total).toBeGreaterThan(0.18) // 25 % expected
    for (const f of INCIDENT_FAULTS) expect(counts[f] / total).toBeLessThan(0.32)
    // independent draws repeat a fault in a shift about 1 - (4 * 3 * 2) / 64 = 62.5 % of the time; a "distinct" rule would give 0
    expect(repeats / days).toBeGreaterThan(0.5)
    expect(repeats / days).toBeLessThan(0.75)
  })

  test('every incident of several shifts is playable: the expert recovers it', () => {
    for (const d of ['2026-10-14', date, '2026-10-24', '2026-11-30']) {
      for (const p of shiftIncidents(d)) {
        const run = runExpert(p.spec)
        expect(run.outcome.fixed).toBe(true)
        expect(run.outcome.recovered).toBe(true)
        expect(run.outcome.diagnosed).toBe(true)
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* The handoff note and the summary                                     */
/* ------------------------------------------------------------------ */

describe('the handoff note', () => {
  const OTHER_FAULT_NAMES = (fault: IncidentFault) => INCIDENT_FAULTS.filter((f) => f !== fault).map((f) => FAULT_SHORT[f])

  test('is a pure function of the debrief and numbers the incidents from one', () => {
    const done = facts('pool-shrink')
    expect(handoffNote(done, 0)).toEqual(handoffNote(structuredClone(done), 0))
    expect(handoffNote(done, 0).heading).toBe('Handoff note: incident 1 to 2')
    expect(handoffNote(done, 1).heading).toBe('Handoff note: incident 2 to 3')
    expect(handoffNote(done, 0).lines[0]).toBe('Closed: incident 1 of 3, "Pool shrank".')
  })

  test('says how it ended, what was changed, whether the suspect was right and how the probes went', () => {
    const good = handoffNote(facts('drain-stall'), 0).lines.join('\n')
    expect(good).toMatch(/Status: recovered \d+ min after the alert, with [\d.]+ burn-minutes against the expert's [\d.]+\./)
    expect(good).toContain('Changed: Restore the drain, which reverts the fault.')
    expect(good).toContain('Diagnosis: the suspect you held was the fault.')

    const lost = handoffNote(facts('node-death', { recovered: false, fixed: false, diagnosed: false, fix: 'restore-pool', burn: 30 }), 1).lines.join('\n')
    expect(lost).toContain(`Status: not recovered within the ${LIMIT_MINUTES}-minute limit, with 30 burn-minutes`)
    expect(lost).toContain('Changed: Restore the pool, which was not the fix for this fault. The fault was left in place.')
    expect(lost).toContain('Diagnosis: the suspect you held was not the fault.')

    const none = handoffNote(facts('tenant-burst', { fixed: false, fix: undefined, probes: [], streetlight: 0 }), 0).lines.join('\n')
    expect(none).toContain('Changed: nothing. No fix went in.')
    expect(none).toContain('Probes: none taken.')
  })

  test('the probe line counts the Streetlight probes and says what to ask next', () => {
    const some = handoffNote(facts('pool-shrink', { probes: ['intake', 'workers', 'kv'], streetlight: 2 }), 0).lines.join('\n')
    expect(some).toContain('Probes: 3 probes, 2 of them Streetlight')
    expect(some).toContain('ask which suspects it would separate')
    const none = handoffNote(facts('pool-shrink', { probes: ['kv'], streetlight: 0 }), 0).lines.join('\n')
    expect(none).toContain('Probes: 1 probe, none of them Streetlight.')
  })

  test('says nothing about the next incident beyond that its fault is drawn independently', () => {
    const last = (fault: IncidentFault) => handoffNote(facts(fault), 0).lines.at(-1)
    // the closing line is one sentence for every input
    expect(new Set(INCIDENT_FAULTS.map(last)).size).toBe(1)
    expect(last('pool-shrink')).toContain('drawn independently of this one')
    // and a note names the closed fault only: no other fault's name, so it cannot rule one in or out
    for (const fault of INCIDENT_FAULTS) {
      const text = handoffNote(facts(fault), 0).lines.join('\n')
      expect(text).toContain(FAULT_SHORT[fault])
      for (const other of OTHER_FAULT_NAMES(fault)) expect(text).not.toContain(other)
    }
  })

  test('the summary has a line per incident and the shift\'s totals', () => {
    const done = [facts('pool-shrink', { streetlight: 1 }), facts('drain-stall', { recovered: false, diagnosed: false, burn: 30 }), facts('node-death')]
    const summary = shiftSummary(done)
    expect(summary.heading).toBe('Shift summary')
    expect(summary.lines).toHaveLength(4)
    expect(summary.lines[0]).toMatch(/^Incident 1, "Pool shrank": named, recovered after \d+ min, [\d.]+ burn-minutes/)
    expect(summary.lines[1]).toMatch(/^Incident 2, "Drain stalled": not named, not recovered, 30 burn-minutes/)
    const total = Math.round(done.reduce((a, d) => a + d.burn, 0) * 10) / 10
    expect(summary.lines[3]).toContain('2 of 3 named, 2 of 3 recovered')
    expect(summary.lines[3]).toContain(`${total} burn-minutes`)
    expect(summary.lines[3]).toContain('1 Streetlight probe.')
  })
})

/* ------------------------------------------------------------------ */
/* Recording: practice, once per incident, and nothing else             */
/* ------------------------------------------------------------------ */

describe('each shift incident is recorded as practice', () => {
  const plan = shiftIncidents(date)

  test('the event is a team-grammar ref, src team, the incident\'s public seed and the incident KCs, with no components', () => {
    const done = facts(plan[0].spec.fault)
    const r = shiftResult(date, plan[0], done, 123_456.4)
    expect(r.ref).toBe('inc:team/shift-1/2026-10-23')
    expect(parseIncidentRef(r.ref)).toEqual({ src: 'team', code: 'shift-1', date })
    expect(r.seed).toBe(plan[0].seed)
    expect(r.ms).toBe(123_456)
    expect(r.data).toMatchObject({ v: 1, src: 'team', date, fault: plan[0].spec.fault, components: [], diagnosed: true, fixed: true })
    expect(r.data.kcs).toEqual(kcsFor(plan[0].spec.fault))
    expect('act4' in r.data).toBe(false)
    // a time past the cap is cut to it, and no time leaves no `ms`
    expect(shiftResult(date, plan[0], done, 10 * INCIDENT_MAX_MS).ms).toBe(INCIDENT_MAX_MS)
    expect('ms' in shiftResult(date, plan[0], done)).toBe(false)
  })

  test('the first attempt writes, graded practice; a replay, another tab and a reload write nothing', async () => {
    const profile = makeProfile()
    const store = startTab(profile).progress
    expect(shiftPlayed(store, plan[0])).toBe(false)
    expect(recordShift(store, date, plan[0], facts(plan[0].spec.fault), 5000)).toBe(true)
    expect(shiftPlayed(store, plan[0])).toBe(true)
    expect(shiftPlayed(store, plan[1])).toBe(false)
    expect(recordShift(store, date, plan[0], facts(plan[0].spec.fault, { burn: 1 }), 5000)).toBe(false)
    expect(store.getState().aggregate.incidents[plan[0].ref]?.n).toBe(1)

    await store.controls.flush()
    const second = startTab(profile).progress
    expect(shiftPlayed(second, plan[0])).toBe(true)
    expect(recordShift(second, date, plan[0], facts(plan[0].spec.fault), 5000)).toBe(false)

    // each of the three incidents is its own ref and its own event
    expect(recordShift(store, date, plan[1], facts(plan[1].spec.fault), 5000)).toBe(true)
    expect(recordShift(store, date, plan[2], facts(plan[2].spec.fault), 5000)).toBe(true)
    await store.controls.flush()
    const { events } = await profile.store.readAll()
    const incidents = events.filter((e) => e.kind === 'incident')
    expect(incidents.map((e) => e.ref).sort()).toEqual(plan.map((p) => p.ref).sort())
    for (const e of incidents) {
      expect((e as { provenance?: string }).provenance).toBe('practice')
      expect((e as { data: { src: string } }).data.src).toBe('team')
    }
  })

  test('it touches no Daily, no Act IV fact, no price and no unseen evidence', async () => {
    const profile = makeProfile()
    const store = startTab(profile).progress
    for (const p of plan) expect(recordShift(store, date, p, facts(p.spec.fault), 5000)).toBe(true)
    const agg = store.getState().aggregate
    // not the Daily's: its ref, its played day and its Today card read nothing
    expect(dailyPlayed(store, date)).toBe(false)
    expect(agg.incidents[dailyRef(date)]).toBeUndefined()
    expect(agg.dailyDays[date]).toBeUndefined()
    // no fact: neither Act IV's `inc:drill/<fault>` nor the shift's own ref pays anything
    expect(Object.keys(agg.facts).filter((k) => k.startsWith('inc:'))).toEqual([])
    for (const p of plan) expect(factMinutes(p.ref)).toBe(0)
    // the selectors that count Dailies (F3) and Act IV's drills read `inc:daily/` and `inc:drill/` refs only
    for (const p of plan) {
      expect(p.ref.startsWith('inc:daily/')).toBe(false)
      expect(p.ref.startsWith('inc:drill/')).toBe(false)
    }
    // and the Act IV credits are untouched
    expect(store.getState().fleetWeek.measurementEvidence?.incident).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* Never stored                                                         */
/* ------------------------------------------------------------------ */

describe('the handoff note is never stored', () => {
  test('a whole shift writes events with no note text and no working key or storage entry holds it', async () => {
    const profile = makeProfile()
    const store = startTab(profile).progress
    const plan = shiftIncidents(date)
    const notes: string[] = []
    plan.forEach((p, i) => {
      const done = facts(p.spec.fault, { streetlight: 1, probes: ['intake', 'kv'] })
      notes.push(...handoffNote(done, i).lines, ...shiftSummary([done]).lines)
      recordShift(store, date, p, done, 5000)
    })
    await store.controls.flush()

    const { events } = await profile.store.readAll()
    const everything = JSON.stringify(events) + JSON.stringify([...profile.storage.data.entries()]) + JSON.stringify(store.getState().aggregate)
    expect(events.length).toBeGreaterThan(0)
    for (const line of notes) expect(everything).not.toContain(line)
    for (const needle of ['Handoff', 'handoff', 'Closed: incident', 'Shift summary']) expect(everything).not.toContain(needle)
  })

  test('the module and the page keep it in memory: no storage, no working key, no ledger write beyond the event', () => {
    const shift = read('src/lib/world/shift.ts').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'setWorking', 'document.cookie', 'fetch(']) expect(shift).not.toContain(banned)
    const page = read('src/pages/Daily.tsx').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const banned of ['localStorage', 'sessionStorage', 'indexedDB', 'setWorking', 'document.cookie']) expect(page).not.toContain(banned)
    // the only thing the page hands the store for a shift is the incident event
    expect(page).toContain('recordShift(useProgress')
    expect(page.match(/useProgress\.getState\(\)\.\w+/g) ?? []).toEqual([])
  })

  test('the Daily page does not load Fleet Week for the shift (the drill key is repeated, not imported)', () => {
    expect(read('src/lib/world/shift.ts')).not.toMatch(/from '@\/lib\/fleet-week'/)
    expect(read('src/pages/Daily.tsx')).not.toMatch(/fleet-week/)
  })
})

/* ------------------------------------------------------------------ */
/* The protocol                                                         */
/* ------------------------------------------------------------------ */

describe('docs/oncall/pilot.md is the think-aloud protocol', () => {
  const doc = read('docs/oncall/pilot.md')
  const section = (title: string): string => {
    const at = doc.indexOf(`\n## ${title}`)
    expect(at).toBeGreaterThan(-1)
    const next = doc.indexOf('\n## ', at + 1)
    return doc.slice(at, next === -1 ? undefined : next)
  }

  test('it covers consent, the script and what the owner writes down', () => {
    expect(section('3. Consent')).toMatch(/Do you agree to take part\?/)
    expect(section('3. Consent')).toMatch(/stop at any moment/)
    expect(section('5. Script')).toMatch(/think aloud/)
    expect(section('5. Script')).toMatch(/Keep talking/)
    expect(section('6. What you write down')).toMatch(/Per incident/)
    expect(section('6. What you write down')).toMatch(/Never write/)
  })

  test('it says the session notes stay private to the owner and only a de-identified summary feeds the gate', () => {
    expect(doc).toMatch(/private to the owner/i)
    expect(section('7. Where the notes live, and who sees them')).toMatch(/stay out of the repository/)
    expect(section('7. Where the notes live, and who sees them')).toMatch(/every AI tool/)
    expect(section('9. The de-identified summary')).toMatch(/only thing from the pilot that goes in the repository/)
    expect(doc).toMatch(/de-identified summary/)
    expect(doc).toContain('Wave 4 gate')
    // it is the pilot and not the shift (D23)
    expect(doc).toMatch(/Not:\*\* the On-Call shift itself/)
  })

  test('the reading in section 8 is a draft the owner confirms: nobody signed or dated it', () => {
    expect(section('8. The reading')).toMatch(/Owner confirmation of section 8 \(name and ISO date, written by the owner; left blank here\): _+\s*$/)
    // the signature line the prereg tooling reads is not here, and no date stands as a signature
    expect(doc).not.toMatch(/^Signed:/m)
    expect(doc).not.toMatch(/signed by/i)
  })

  test('the route it names is the one the page reads, and its numbers are the incident catalog\'s', () => {
    expect(doc).toContain('/daily?shift=3')
    expect(shiftRequested(new URL('https://x.test/daily?shift=3').searchParams.get('shift'))).toBe(true)
    expect(doc).toContain('graded practice')
    expect(doc).toContain(`inc:team/shift-<k>/<date>`)
    expect(shiftRef('2026-10-23', 0)).toBe('inc:team/shift-1/2026-10-23')
  })
})
