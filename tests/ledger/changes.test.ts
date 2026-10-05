import { describe, expect, test } from 'bun:test'
import kvbm from '../../src/data/errata/2026-10-04-dynamo-kvbm-deprecated'
import type { Erratum } from '../../src/data/errata/schema'
import { selectChangeCards, selectSeen } from '../../src/lib/ledger/changes'
import { derive } from '../../src/lib/ledger/fold'
import { mergeLedgers } from '../../src/lib/ledger/merge'
import { evt } from './gen'

const BEFORE_FIX = '2026-09-28T10:00:00.000Z'
const FIX_DAY_MORNING = '2026-10-04T01:00:00.000Z'
const FIX_DAY_LATE = '2026-10-04T23:59:59.999Z'
const AFTER_FIX = '2026-10-05T00:00:00.000Z'

const erratum = (over: Partial<Erratum>): Erratum => ({
  id: '2026-10-01-x',
  date: '2026-10-01',
  kind: 'error',
  lessons: ['t0.l1'],
  title: 't',
  before: 'b',
  after: 'a',
  ...over,
})

describe('selectSeen', () => {
  test('completed lessons with their first completion time', () => {
    const agg = derive([
      evt('complete', 'lesson:t0.l1', '2026-09-02T00:00:00.000Z'),
      evt('complete', 'lesson:t0.l1', '2026-09-01T00:00:00.000Z'),
      evt('visit', 'lesson:t0.l2', '2026-09-01T00:00:00.000Z'),
    ])
    expect(selectSeen(agg)).toEqual({ 't0.l1': { learnedAt: '2026-09-01T00:00:00.000Z' } })
  })
})

describe('selectChangeCards (P14, Addendum A4)', () => {
  test('a t6 lesson completed before the KVBM erratum date shows that card', () => {
    const agg = derive([evt('complete', 'lesson:t6.l3', BEFORE_FIX)])
    const cards = selectChangeCards(agg, [kvbm])
    expect(cards).toHaveLength(1)
    expect(cards[0].erratum.id).toBe('2026-10-04-dynamo-kvbm-deprecated')
    expect(cards[0].lessonIds).toEqual(['t6.l3'])
    expect(cards[0].learnedAt).toBe(BEFORE_FIX)
    expect(cards[0].acked).toBe(false)
  })

  test('a learner who completed it after the fix gets no card', () => {
    const agg = derive([evt('complete', 'lesson:t6.l3', AFTER_FIX)])
    expect(selectChangeCards(agg, [kvbm])).toEqual([])
  })

  test('a completion on the fix day counts as before it (conservative)', () => {
    for (const at of [FIX_DAY_MORNING, FIX_DAY_LATE]) {
      expect(selectChangeCards(derive([evt('complete', 'lesson:t6.l3', at)]), [kvbm])).toHaveLength(1)
    }
  })

  test('only completed lessons count: a visit or an unrelated lesson does not', () => {
    const agg = derive([evt('visit', 'lesson:t6.l3', BEFORE_FIX), evt('complete', 'lesson:t0.l1', BEFORE_FIX)])
    expect(selectChangeCards(agg, [kvbm])).toEqual([])
  })

  test('affected lessons are filtered per lesson; learnedAt is the earliest of them', () => {
    const agg = derive([
      evt('complete', 'lesson:t5.l6', '2026-09-20T00:00:00.000Z'),
      evt('complete', 'lesson:t5.l9', '2026-09-10T00:00:00.000Z'),
      evt('complete', 'lesson:t6.l3', AFTER_FIX),
    ])
    const [card] = selectChangeCards(agg, [kvbm])
    expect(card.lessonIds).toEqual(['t5.l6', 't5.l9'])
    expect(card.learnedAt).toBe('2026-09-10T00:00:00.000Z')
  })

  test('an ack marks the card acked', () => {
    const agg = derive([
      evt('complete', 'lesson:t6.l3', BEFORE_FIX),
      evt('ack', `erratum:${kvbm.id}`, '2026-10-06T00:00:00.000Z'),
    ])
    expect(selectChangeCards(agg, [kvbm])[0].acked).toBe(true)
  })

  test('a merge carries acks across devices', () => {
    const complete = evt('complete', 'lesson:t6.l3', BEFORE_FIX)
    const phone = { events: [complete], working: [] }
    const laptop = { events: [complete, evt('ack', `erratum:${kvbm.id}`, '2026-10-06T00:00:00.000Z')], working: [] }
    expect(selectChangeCards(derive(phone.events), [kvbm])[0].acked).toBe(false)
    expect(selectChangeCards(derive(mergeLedgers(phone, laptop).events), [kvbm])[0].acked).toBe(true)
    expect(selectChangeCards(derive(mergeLedgers(laptop, phone).events), [kvbm])[0].acked).toBe(true)
  })

  test('sort: unacked first, then date descending, then id', () => {
    const old = erratum({ id: '2026-09-30-a', date: '2026-09-30' })
    const newer = erratum({ id: '2026-10-02-b', date: '2026-10-02' })
    const sameDayLater = erratum({ id: '2026-10-02-c', date: '2026-10-02' })
    const ackedNewest = erratum({ id: '2026-10-03-d', date: '2026-10-03' })
    const agg = derive([evt('complete', 'lesson:t0.l1', '2026-09-01T00:00:00.000Z'), evt('ack', 'erratum:2026-10-03-d', '2026-10-04T00:00:00.000Z')])
    const ids = selectChangeCards(agg, [old, ackedNewest, sameDayLater, newer]).map((c) => c.erratum.id)
    expect(ids).toEqual(['2026-10-02-b', '2026-10-02-c', '2026-09-30-a', '2026-10-03-d'])
  })

  test('no errata, or an empty ledger, gives no cards', () => {
    expect(selectChangeCards(derive([evt('complete', 'lesson:t0.l1', BEFORE_FIX)]), [])).toEqual([])
    expect(selectChangeCards(derive([]), [kvbm])).toEqual([])
  })
})
