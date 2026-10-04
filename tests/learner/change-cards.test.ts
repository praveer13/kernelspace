import { describe, expect, test } from 'bun:test'
import kvbm from '../../src/data/errata/2026-10-04-dynamo-kvbm-deprecated'
import priceRefresh from '../../src/data/errata/2026-10-04-act3-price-refresh'
import prices from '../../src/data/errata/2026-10-04-act3-prices'
import { changeCardsFor } from '../../src/lib/learner/change-cards'

const BEFORE_FIX = '2026-09-28T10:00:00.000Z'
const AFTER_FIX = '2026-10-05T00:00:00.000Z'
const done = (completedAt: string) => ({ status: 'done', completedAt })

describe('changeCardsFor (S4, Addendum A4)', () => {
  test('a t6 lesson completed before the KVBM erratum shows that card with its items', () => {
    const cards = changeCardsFor({ 't6.l3': done(BEFORE_FIX) }, {}, [kvbm])
    expect(cards).toHaveLength(1)
    expect(cards[0].erratum.id).toBe(kvbm.id)
    expect(cards[0].lessonIds).toEqual(['t6.l3'])
    expect(cards[0].erratum.items?.length).toBe(2)
    expect(cards[0].acked).toBe(false)
  })

  test('a learner who completed it after the fix gets no card', () => {
    expect(changeCardsFor({ 't6.l3': done(AFTER_FIX) }, {}, [kvbm])).toEqual([])
  })

  test('a new learner, or one who only visited, gets no section', () => {
    expect(changeCardsFor({}, {}, [kvbm])).toEqual([])
    expect(changeCardsFor({ 't6.l3': { status: 'reading' } }, {}, [kvbm])).toEqual([])
  })

  test('an acknowledgement marks the card acked', () => {
    const cards = changeCardsFor({ 't6.l3': done(BEFORE_FIX) }, { [`erratum:${kvbm.id}`]: AFTER_FIX }, [kvbm])
    expect(cards.map((c) => c.acked)).toEqual([true])
  })

  test('a superseded erratum folds into the one that replaced it', () => {
    const cards = changeCardsFor({ 't7.l4': done(BEFORE_FIX) }, {}, [prices, priceRefresh])
    expect(cards.map((c) => c.erratum.id)).toEqual([priceRefresh.id])
  })
})
