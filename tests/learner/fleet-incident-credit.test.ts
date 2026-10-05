import { describe, expect, test } from 'bun:test'
import { EMPTY_INCIDENT_LEDGER, gradeIncidentCall, incidentLedgerFrom, INCIDENTS } from '../../src/lib/fleet-week'
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
    expect(incidentLedgerFrom(undefined)).toEqual(EMPTY_INCIDENT_LEDGER)
    expect(incidentLedgerFrom({ attempted: 'x', credited: [1, 'a'] })).toEqual(EMPTY_INCIDENT_LEDGER)
    expect(incidentLedgerFrom({ attempted: ['a'], credited: ['a', 'b'] })).toEqual({ attempted: ['a'], credited: ['a'] })
  })
})
