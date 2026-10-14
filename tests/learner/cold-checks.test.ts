import { describe, expect, test } from 'bun:test'
import type { Kc } from '../../src/lib/kc/types'
import { wilson } from '../../src/lib/learner/calibration'
import { COLD_LONG_DAYS, COLD_MIN_DAYS, COLD_TRACK_MIN_N, coldCheckAge, selectColdCheckSummary } from '../../src/lib/learner/cold-checks'
import { addDays } from '../../src/lib/learner/reentry'
import type { LedgerEvent, LocalDay } from '../../src/lib/ledger/types'
import { Journal, resolveTag, shuffled, START } from './ledger-gen'

const D = (n: number) => addDays(START, n)

const kc = (id: string, track: Kc['track']): Kc => ({ id, title: id, can: 'You can.', track, kind: 'concept', lessons: [], requires: [], since: '2026-10-05' })
const CONTENT = { kcs: [kc('t5.kv-bytes', 't5'), kc('r.borrow-rules', 'r'), kc('t2.address-translation', 't2')], resolve: resolveTag }

interface ProbeOpts {
  src?: string
  provenance?: string
  kind?: 'probe' | 'item'
  kcs?: string[]
}

/** A Today cold check on `kcs` asked `since` days after the KC was last met. */
function probe(j: Journal, day: LocalDay, since: number | undefined, ok: boolean, o: ProbeOpts = {}): LedgerEvent {
  return j.add(o.kind ?? 'probe', 'gen:memory/kv', day, {
    score: ok ? 1 : 0,
    ok,
    rev: 'r',
    provenance: o.provenance ?? 'unseen',
    data: { src: o.src ?? 'today', reason: 'probe', kcs: o.kcs ?? ['t5.kv-bytes'], ...(since === undefined ? {} : { sinceDays: since }) },
  })
}

const prop = (correct: number, n: number) => {
  if (n === 0) return { n, correct, rate: null, ci95: null }
  const w = wilson(correct, n)
  return { n, correct, rate: correct / n, ci95: [w.lo, w.hi] }
}

describe('cold-check summaries (§12.3)', () => {
  test('the bands are 7 and 30 days, and a track needs 10 checks before /me shows it', () => {
    expect([COLD_MIN_DAYS, COLD_LONG_DAYS, COLD_TRACK_MIN_N]).toEqual([7, 30, 10])
  })

  test('n, accuracy and Wilson intervals at 7 days or more and at 30 days or more', () => {
    const j = new Journal()
    probe(j, D(10), 7, true)
    probe(j, D(10), 12, false)
    probe(j, D(10), 29, true)
    probe(j, D(10), 30, true)
    probe(j, D(10), 45, false)
    probe(j, D(10), 6, true) // too fresh for either band
    const s = selectColdCheckSummary(j.events, CONTENT, D(10))
    expect(s.overall).toEqual({ track: null, d7: prop(3, 5), d30: prop(1, 2) })
    expect(s.tracks).toEqual([{ track: 't5', d7: prop(3, 5), d30: prop(1, 2) }])
  })

  test("only Today's unassisted probes with an age count", () => {
    const j = new Journal()
    probe(j, D(10), 40, true, { src: 'cold' }) // Wave 0b's lesson cold check
    probe(j, D(10), 40, true, { kind: 'item' }) // a due review, not a probe
    probe(j, D(10), 40, false, { provenance: 'assisted' })
    probe(j, D(10), undefined, true) // no age recorded
    expect(selectColdCheckSummary(j.events, CONTENT, D(10)).overall.d7.n).toBe(0)
    // provenance does not otherwise matter: an authored item asked cold is still a cold check
    probe(j, D(10), 40, true, { provenance: 'practice' })
    expect(selectColdCheckSummary(j.events, CONTENT, D(10)).overall.d30).toEqual(prop(1, 1))
    expect(coldCheckAge(j.events[j.events.length - 1])).toBe(40)
    expect(coldCheckAge(j.events[2])).toBeNull()
  })

  test('by track in curriculum order; a probe over two tracks counts once in each and once overall', () => {
    const j = new Journal()
    probe(j, D(10), 8, true, { kcs: ['t5.kv-bytes'] })
    probe(j, D(10), 8, false, { kcs: ['t2.address-translation', 't5.kv-bytes'] })
    probe(j, D(10), 31, true, { kcs: ['r.borrow-rules'] })
    // a KC the graph does not hold falls back to its id's track
    probe(j, D(10), 9, true, { kcs: ['t7.goodput'] })
    // a probe nothing resolves counts overall only
    probe(j, D(10), 9, true, { kcs: [] })
    const s = selectColdCheckSummary(j.events, CONTENT, D(10))
    expect(s.overall.d7).toEqual(prop(4, 5))
    expect(s.tracks.map((r) => r.track)).toEqual(['r', 't2', 't5', 't7'])
    expect(s.tracks.find((r) => r.track === 't5')).toEqual({ track: 't5', d7: prop(1, 2), d30: prop(0, 0) })
    expect(s.tracks.find((r) => r.track === 'r')).toEqual({ track: 'r', d7: prop(1, 1), d30: prop(1, 1) })
  })

  test('as of now, duplicates once, and the same in any order', () => {
    const j = new Journal()
    probe(j, D(10), 8, true)
    probe(j, D(11), 8, false)
    expect(selectColdCheckSummary(j.events, CONTENT, D(10)).overall.d7).toEqual(prop(1, 1))
    const want = selectColdCheckSummary(j.events, CONTENT, D(11))
    expect(want.overall.d7).toEqual(prop(1, 2))
    expect(selectColdCheckSummary(shuffled([...j.events, ...j.events], 3), CONTENT, D(11))).toEqual(want)
  })

  test('an empty ledger is n = 0 with no rate and no interval', () => {
    expect(selectColdCheckSummary([], CONTENT, D(0))).toEqual({ overall: { track: null, d7: prop(0, 0), d30: prop(0, 0) }, tracks: [] })
  })
})
