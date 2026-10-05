import { describe, expect, test } from 'bun:test'
import { EMPTY_INCIDENT_LEDGER, gradeIncidentCall, INCIDENTS } from '../../src/lib/fleet-week'

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
    expect(retry.result.headline).toContain('practice')
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
