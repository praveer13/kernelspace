import { describe, expect, test } from 'bun:test'
import {
  EMPTY_INCIDENT_LEDGER,
  gradeIncidentCall,
  incidentLedgerFrom,
  incidentMisses,
  INCIDENT_CLOSED_NOTE,
  INCIDENTS,
} from '../../src/lib/fleet-week'
import { makeProfile, startTab } from '../ledger/env'

const total = INCIDENTS.length

describe('Act IV credits first-attempt calls only', () => {
  test('three first-attempt correct calls pass the act', () => {
    let ledger = EMPTY_INCIDENT_LEDGER
    let last = null as ReturnType<typeof gradeIncidentCall> | null
    for (const inc of INCIDENTS) {
      last = gradeIncidentCall(ledger, inc, true, true)
      ledger = last.ledger
      expect(last.practice).toBe(false)
    }
    expect(last?.result.pass).toBe(true)
    expect(ledger.credited.length).toBe(total)
  })

  test('a wrong first call followed by the revealed answer earns no credit', () => {
    const first = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, INCIDENTS[0], false, true)
    expect(first.result.pass).toBe(false)
    expect(first.ledger.credited).toEqual([])
    const retry = gradeIncidentCall(first.ledger, INCIDENTS[0], true, true)
    expect(retry.practice).toBe(true)
    expect(retry.result.pass).toBe(false)
    expect(retry.ledger.credited).toEqual([])
    expect(retry.result.practice).toBe(true)
    let ledger = retry.ledger
    for (const inc of INCIDENTS.slice(1)) ledger = gradeIncidentCall(ledger, inc, true, true).ledger
    const done = gradeIncidentCall(ledger, INCIDENTS[1], true, true)
    expect(done.result.pass).toBe(false)
    expect(ledger.credited.length).toBe(total - 1)
  })

  test('a practice call never changes the ledger', () => {
    const first = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, INCIDENTS[0], true, true)
    const again = gradeIncidentCall(first.ledger, INCIDENTS[0], true, true)
    expect(again.ledger).toEqual(first.ledger)
  })
})

describe('the first-call ledger survives a reload', () => {
  test('a persisted first-call miss still marks later calls as practice', async () => {
    const profile = makeProfile()
    const first = startTab(profile)
    const missed = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, INCIDENTS[0], false, false)
    first.progress.getState().setFleetWeekEvidence('incident', missed.ledger)
    await first.progress.controls.flush()

    const second = startTab(profile) // a reload: new tab, same storage
    const stored = second.progress.getState().fleetWeek.measurementEvidence?.incident
    const ledger = incidentLedgerFrom(stored)
    expect(ledger.attempted).toEqual([INCIDENTS[0].id])
    const retry = gradeIncidentCall(ledger, INCIDENTS[0], true, true)
    expect(retry.practice).toBe(true)
    expect(retry.result.practice).toBe(true)
    expect(retry.result.pass).toBe(false)
    expect(retry.ledger.credited).toEqual([])
  })

  test('a malformed stored ledger is read as empty or filtered, never trusted', () => {
    const [first, second] = INCIDENTS.map((i) => i.id)
    expect(incidentLedgerFrom(undefined)).toEqual(EMPTY_INCIDENT_LEDGER)
    expect(incidentLedgerFrom({ attempted: 'x', credited: [1, first] })).toEqual(EMPTY_INCIDENT_LEDGER)
    expect(incidentLedgerFrom({ attempted: [first], credited: [first, second] })).toEqual({ attempted: [first], credited: [first] })
  })

  test('repeated and unknown ids are dropped, so credited.length cannot stand in for diagnosed incidents', () => {
    const [first, second] = INCIDENTS.map((i) => i.id)
    const forged = { attempted: [first, first, 'made-up', first], credited: [first, first, 'made-up', first] }
    const ledger = incidentLedgerFrom(forged)
    expect(ledger).toEqual({ attempted: [first], credited: [first] })
    expect(incidentLedgerFrom({ attempted: ['nope'], credited: ['nope'] })).toEqual(EMPTY_INCIDENT_LEDGER)
    // three "credits" for one incident, then one honest first call on a second incident: still not done
    const graded = gradeIncidentCall(ledger, INCIDENTS[1], true, true)
    expect(graded.ledger.credited).toEqual([first, second])
    expect(graded.result.pass).toBe(false)
    // the same holds when a caller hands gradeIncidentCall the forged ledger directly
    const direct = gradeIncidentCall(forged, INCIDENTS[1], true, true)
    expect(direct.ledger.credited).toEqual([first, second])
    expect(direct.result.pass).toBe(false)
  })

  test('an incident outside INCIDENTS is never credited', () => {
    const stray = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, { id: 'made-up', title: 'incident 99 — not real' }, true, true)
    expect(stray.practice).toBe(true)
    expect(stray.ledger).toEqual(EMPTY_INCIDENT_LEDGER)
    expect(stray.result.pass).toBe(false)
  })
})

describe('a missed first call closes Act IV and the UI says so', () => {
  test('the result after a missed first call says later calls are practice and fresh incidents arrive later', () => {
    const missed = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, INCIDENTS[0], false, true)
    expect(missed.practice).toBe(false)
    expect(missed.result.pass).toBe(false)
    expect(missed.result.closed).toBe(true)
    expect(missed.result.headline).not.toContain('look at the telemetry again')
    expect(missed.result.detail).toContain('practice only')
    expect(missed.result.detail).toContain('closed for now')
    expect(missed.result.detail).toContain('earns no XP')
    expect(missed.result.detail).toContain('later update')
    expect(incidentMisses(missed.ledger)).toBe(1)
  })

  test('a practice call after a miss says the act stays closed and nothing is credited', () => {
    const missed = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, INCIDENTS[0], false, false)
    const retry = gradeIncidentCall(missed.ledger, INCIDENTS[0], true, true)
    expect(retry.practice).toBe(true)
    expect(retry.result.closed).toBe(true)
    expect(retry.result.detail).toContain('closed it for now')
    expect(retry.result.detail).toContain('later update')
    expect(retry.ledger).toEqual(missed.ledger)
  })

  test('a correct first call after an earlier miss is graded and marked but cannot complete the act', () => {
    let ledger = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, INCIDENTS[0], false, true).ledger
    let last = gradeIncidentCall(ledger, INCIDENTS[1], true, true)
    ledger = last.ledger
    // the first call on an incident not yet called is not practice: it is recorded and marked ✓...
    expect(last.practice).toBe(false)
    expect(ledger.attempted).toEqual([INCIDENTS[0].id, INCIDENTS[1].id])
    expect(ledger.credited).toEqual([INCIDENTS[1].id])
    // ...but the act is closed, and the result says so without calling anything "credited"
    expect(last.result.pass).toBe(false)
    expect(last.result.closed).toBe(true)
    expect(last.result.detail).toContain('Correct and marked')
    expect(last.result.detail).toContain('stays closed')
    expect(last.result.detail).toContain('earns no XP')
    expect(last.result.detail).not.toContain('Credited')
    expect(last.result.detail).not.toContain('cannot be credited')
    last = gradeIncidentCall(ledger, INCIDENTS[2], true, true)
    expect(last.practice).toBe(false)
    expect(last.result.pass).toBe(false)
    expect(last.result.detail).toContain('later update')
    expect(last.ledger.credited.length).toBe(total - 1)
    // the missed incident stays practice, and no later call on any incident can pass
    const repeat = gradeIncidentCall(last.ledger, INCIDENTS[0], true, true)
    expect(repeat.practice).toBe(true)
    expect(repeat.ledger).toEqual(last.ledger)
    for (const inc of INCIDENTS) expect(gradeIncidentCall(last.ledger, inc, true, true).result.pass).toBe(false)
  })

  test('before any miss the act is open and the notice is not shown', () => {
    const first = gradeIncidentCall(EMPTY_INCIDENT_LEDGER, INCIDENTS[0], true, true)
    expect(first.result.closed).toBe(false)
    expect(first.result.detail).toContain('a miss closes the act')
    expect(incidentMisses(first.ledger)).toBe(0)
  })

  test('the standing notice says what the code does: repeat calls are practice, first calls on other incidents are graded and marked, no XP', () => {
    expect(INCIDENT_CLOSED_NOTE).toContain('earns no XP')
    expect(INCIDENT_CLOSED_NOTE).toContain('Repeat calls on an incident are practice')
    expect(INCIDENT_CLOSED_NOTE).toContain('graded and marked')
    expect(INCIDENT_CLOSED_NOTE).toContain('cannot complete the act')
    expect(INCIDENT_CLOSED_NOTE).toContain('later update')
    // the old note said every later call is practice and never credited; first calls on other incidents are not
    expect(INCIDENT_CLOSED_NOTE).not.toContain('never credited')
    expect(INCIDENT_CLOSED_NOTE).not.toContain('Calls from here on are practice')
  })
})
