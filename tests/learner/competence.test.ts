import { describe, expect, test } from 'bun:test'
import type { Kc } from '../../src/lib/kc/types'
import {
  COMPETENCE_MIN_DAYS,
  COMPETENCE_MIN_ITEMS,
  COMPETENCE_MIN_RIGHT,
  COMPETENCE_WINDOW,
  competenceEvidence,
  selectCompetence,
  statementText,
} from '../../src/lib/learner/competence'
import { addDays } from '../../src/lib/learner/reentry'
import type { LedgerEvent, LocalDay } from '../../src/lib/ledger/types'
import { Journal, resolveTag, shuffled, START } from './ledger-gen'

const D = (n: number) => addDays(START, n)

const KCS: Kc[] = [
  { id: 't6.mla-kv', title: 'MLA KV', can: 'You can size KV for an MLA model.', track: 't6', kind: 'procedure', lessons: ['t6.l4'], requires: [], since: '2026-10-05' },
  { id: 't5.kv-bytes', title: 'KV bytes', can: 'You can compute KV bytes per token.', track: 't5', kind: 'procedure', lessons: ['t5.l1'], requires: [], since: '2026-10-05' },
]
const CONTENT = { kcs: KCS, resolve: resolveTag }
const MLA = 't6.mla-kv'

interface ItemOpts {
  kind?: 'item' | 'probe' | 'prove'
  provenance?: string
  ref?: string
  seed?: number
  level?: number
  src?: string
}

let seedN = 1
function item(j: Journal, day: LocalDay, ok: boolean, o: ItemOpts = {}, kc = MLA): LedgerEvent {
  const kind = o.kind ?? 'item'
  return j.add(kind, o.ref ?? (kind === 'prove' ? 'prove:kv-block-manager' : 'gen:memory/mla'), day, {
    score: ok ? 1 : 0,
    ok,
    rev: 'r',
    provenance: o.provenance ?? 'unseen',
    seed: o.seed ?? seedN++,
    data: kind === 'prove' ? { v: 2, qid: 'q', kcs: [kc], answer: 1, actual: 1, calls: 2 } : { src: o.src ?? 'today', kcs: [kc], level: o.level ?? 2 },
  })
}

/** `oks` answered in order, the first half on day 0 and the rest on day 1. */
function ledger(oks: boolean[], days = 2): Journal {
  const j = new Journal()
  oks.forEach((ok, i) => item(j, D(Math.floor((i * days) / oks.length)), ok))
  return j
}

describe('competence statements (§12.4)', () => {
  test('the thresholds are 6 credited fresh items over 2 local days, 5 of the last 6 right', () => {
    expect([COMPETENCE_MIN_ITEMS, COMPETENCE_MIN_DAYS, COMPETENCE_WINDOW, COMPETENCE_MIN_RIGHT]).toEqual([6, 2, 6, 5])
  })

  test('six of six over two days shows the can line, worded as the spec has it', () => {
    const j = ledger([true, true, true, true, true, true])
    const [s, ...rest] = selectCompetence(j.events, CONTENT, D(1))
    expect(rest).toEqual([])
    expect(s).toMatchObject({ kc: MLA, n: 6, days: 2, right: 6, of: 6, last: D(1), met: true })
    expect(s.text).toBe('You can size KV for an MLA model: 6 of your last 6, on new numbers each time.')
  })

  test('five items are not enough, however right', () => {
    const j = ledger([true, true, true, true, true])
    expect(selectCompetence(j.events, CONTENT, D(1))).toEqual([])
    expect(competenceEvidence(j.events, CONTENT, D(1))).toEqual([{ kc: MLA, n: 5, days: 2, right: 5, of: 5, last: D(1), met: false }])
  })

  test('six items on one local day are not enough', () => {
    const j = ledger([true, true, true, true, true, true], 1)
    expect(selectCompetence(j.events, CONTENT, D(0))).toEqual([])
    item(j, D(3), true)
    expect(selectCompetence(j.events, CONTENT, D(3))).toHaveLength(1)
  })

  test('five of the last six is enough; four is not; older misses fall out of the window', () => {
    expect(selectCompetence(ledger([true, false, true, true, true, true]).events, CONTENT, D(1))[0]?.text).toBe(
      'You can size KV for an MLA model: 5 of your last 6, on new numbers each time.',
    )
    expect(selectCompetence(ledger([true, false, true, false, true, true]).events, CONTENT, D(1))).toEqual([])
    const late = selectCompetence(ledger([false, false, false, true, true, true, true, true, true]).events, CONTENT, D(1))
    expect(late).toMatchObject([{ n: 9, right: 6, of: 6 }])
    // and a run of misses at the end takes the line away again
    const j = ledger([true, true, true, true, true, true])
    item(j, D(2), false)
    item(j, D(2), false)
    expect(selectCompetence(j.events, CONTENT, D(2))).toEqual([])
  })

  test('only full credit counts: practice, assisted, lab-green and field items are left out', () => {
    const j = ledger([true, true, true, true, true])
    for (const provenance of ['practice', 'assisted', 'lab-green', 'field']) item(j, D(1), true, { provenance })
    expect(competenceEvidence(j.events, CONTENT, D(1))[0]).toMatchObject({ n: 5, met: false })
    // nor do they count as misses
    for (const provenance of ['practice', 'assisted']) item(j, D(1), false, { provenance })
    item(j, D(1), true)
    expect(selectCompetence(j.events, CONTENT, D(1))).toMatchObject([{ n: 6, right: 6 }])
  })

  test('fresh means generated on a new seed: an authored item is not, and a repeated instance counts once', () => {
    const j = ledger([true, true, true, true, true])
    item(j, D(1), true, { ref: 'quiz:t6.l4#0' })
    item(j, D(1), true, { ref: 'item:t6.l4.iso.1' })
    expect(competenceEvidence(j.events, CONTENT, D(1))[0].n).toBe(5)
    // the same ref, level and seed twice (a merge can bring a second unseen copy) is one item
    item(j, D(1), true, { seed: 77 })
    item(j, D(1), true, { seed: 77 })
    expect(competenceEvidence(j.events, CONTENT, D(1))[0].n).toBe(6)
    // the same seed at another level is another instance
    item(j, D(1), true, { seed: 77, level: 3 })
    expect(competenceEvidence(j.events, CONTENT, D(1))[0].n).toBe(7)
  })

  test('cold-check probes are items; a proved prove event is fresh evidence, a practice one is not', () => {
    const j = new Journal()
    item(j, D(0), true, { kind: 'probe' })
    item(j, D(0), true, { kind: 'prove', provenance: 'practice' })
    for (let i = 0; i < 5; i++) item(j, D(1), true, { kind: 'prove', provenance: 'proved' })
    expect(selectCompetence(j.events, CONTENT, D(1))).toMatchObject([{ kc: MLA, n: 6, days: 2 }])
  })

  test('an item counts for every KC it carries, and statements come in the graph order', () => {
    const j = new Journal()
    for (let i = 0; i < 6; i++) {
      j.add('item', 'gen:memory/kv', D(i % 2), { score: 1, ok: true, rev: 'r', provenance: 'unseen', seed: 500 + i, data: { src: 'today', kcs: ['t5.kv-bytes', MLA] } })
    }
    expect(selectCompetence(j.events, CONTENT, D(1)).map((s) => s.kc)).toEqual([MLA, 't5.kv-bytes'])
  })

  test('a KC outside the graph has evidence but no line', () => {
    const j = new Journal()
    for (let i = 0; i < 6; i++) item(j, D(i % 2), true, {}, 't9.unknown')
    expect(competenceEvidence(j.events, CONTENT, D(1))).toMatchObject([{ kc: 't9.unknown', met: true }])
    expect(selectCompetence(j.events, CONTENT, D(1))).toEqual([])
  })

  test('as of now, and the same in any order with repeats', () => {
    const j = ledger([true, true, true, true, true, true])
    expect(selectCompetence(j.events, CONTENT, D(0))).toEqual([])
    const want = selectCompetence(j.events, CONTENT, D(1))
    expect(selectCompetence(shuffled([...j.events, ...j.events], 7), CONTENT, D(1))).toEqual(want)
  })

  test('the statement text drops the can line full stop once', () => {
    expect(statementText('You can do it.', 5, 6)).toBe('You can do it: 5 of your last 6, on new numbers each time.')
    expect(statementText('You can do it', 6, 6)).toBe('You can do it: 6 of your last 6, on new numbers each time.')
  })
})
