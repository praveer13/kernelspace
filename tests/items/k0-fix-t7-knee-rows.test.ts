/**
 * K0-FIX-T7: the knee variant works out its feasible rows once per (ladder, limit, level) instead of on every make. K0-B11's
 * rising-throughput rule made the per-make search about four times the family's other work, and the full unit suite then
 * missed the 1 ms make + grade budget on slow cores. The memo must hand back the same rows a fresh search finds, and the
 * same object on a second call.
 */
import { describe, expect, test } from 'bun:test'
import goodput, { kneeRows } from '../../src/lib/items/families/goodput'
import { genSeeds } from '../../scripts/verify-generators'

const tps = (c: number, p95: number): number => Math.floor((c * 1000 * 120) / (100 * p95))
const span = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
const KEY_PCT = [[60, 85], [60, 90], [70, 95], [80, 95]] as const
const NEXT_PCT = [[120, 160], [115, 160], [105, 140], [105, 125]] as const

describe('the knee rows are worked out once (K0-FIX-T7)', () => {
  test('a second call with the same ladder, limit and level returns the same object', () => {
    const ladder = [1, 2, 4, 8, 16, 32]
    expect(kneeRows(ladder, 100, 0)).toBe(kneeRows([...ladder], 100, 0))
    expect(kneeRows(ladder, 100, 0)).not.toBe(kneeRows(ladder, 100, 1))
  })

  test('the kept rows are the ones a fresh search finds', () => {
    for (const [ladder, limit] of [[[1, 2, 4, 8, 16, 32], 100], [[10, 20, 30, 40, 50, 60], 40], [[25, 50, 75, 100, 125, 150], 120]] as const) {
      for (const level of [0, 1, 2, 3] as const) {
        const want = ladder.slice(0, 5).map((_, k) =>
          span(...KEY_PCT[level]).flatMap((kp) =>
            span(...NEXT_PCT[level])
              .filter((np) => tps(ladder[k + 1], Math.ceil((limit * np) / 100)) > tps(ladder[k], Math.floor((limit * kp) / 100)))
              .map((np) => [kp, np]),
          ),
        )
        const got = kneeRows([...ladder], limit, level)
        expect(got.pairs).toEqual(want)
        expect(got.keys).toEqual(want.map((_, k) => k).filter((k) => want[k].length > 0))
      }
    }
  })

  test('every knee instance still keys a row the rule allows', () => {
    for (const level of [0, 1, 2, 3] as const) {
      for (const s of genSeeds(200)) {
        const i = goodput.make(s, level, 'knee')
        const conc = String(i.params.conc).split(',').map(Number)
        const tpot = String(i.params.tpot).split(',').map(Number)
        const key = tpot.filter((x) => x < Number(i.params.limit)).length - 1
        expect(kneeRows(conc, Number(i.params.limit), level).keys).toContain(key)
      }
    }
  })
})
