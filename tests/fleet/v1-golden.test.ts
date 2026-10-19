/**
 * The v1 golden fixture (docs/specs/s5.md §6.6, task S5-01, invariant I1): every v1 surface hashes to the sha256 it had
 * at 9aa27de, and `src/lib/fleet-model.ts` is byte for byte the file it was then. The surfaces and their inputs live in
 * scripts/v1-golden.ts, which `bun scripts/v1-golden.ts --check` runs too; one `test()` per surface, so a failure
 * names the surface that moved. The fixture is never regenerated in an S5 PR: a changed hash blocks the merge (§9.4).
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { DAILY_EPOCH, daysBetween } from '../../src/lib/world/daily'
import {
  BASE_COMMIT,
  DAILY_DATES,
  ENTROPIES,
  FLEET_MODEL_PATH,
  SURFACES,
  SWEEP_SEEDS,
  V1_EXERCISES,
  fleetModelSha,
  readFixture,
  runSurface,
  type GoldenFixture,
} from '../../scripts/v1-golden'

/** The whole fixture must run inside this many seconds (S5-01). */
const TOTAL_BUDGET_S = 60
/** The suite's per-test timeout (`bun test --timeout 20000`), asserted per surface as well as enforced by the runner. */
const TEST_BUDGET_MS = 20_000

const fixture: GoldenFixture = await readFixture()
let totalMs = 0

describe('the v1 golden fixture (S5-01, I1)', () => {
  test('says it is never regenerated in an S5 PR, and names its base', () => {
    expect(fixture.base).toBe(BASE_COMMIT)
    expect(fixture.header).toContain('NEVER regenerated in an S5 PR')
    expect(fixture.header).toContain('blocks the merge')
    expect(fixture.header).toContain(BASE_COMMIT)
  })

  test('has exactly one sha256 row per surface, and no surface without a row', () => {
    expect(Object.keys(fixture.surfaces).sort()).toEqual(SURFACES.map((s) => s.id).sort())
    for (const s of SURFACES) {
      expect(fixture.surfaces[s.id].sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(fixture.surfaces[s.id].n).toBe(s.n)
    }
  })

  test('covers the inputs the spec names: 20 entropies with 0x3a12 and 0x3a13, six sweeps on seeds 0-19, 30 Daily dates from the epoch', () => {
    expect(ENTROPIES).toHaveLength(20)
    expect(new Set(ENTROPIES).size).toBe(20)
    expect(ENTROPIES).toContain(0x3a12)
    expect(ENTROPIES).toContain(0x3a13)
    expect(V1_EXERCISES).toEqual(['knee', 'pd-split', 'broken-bench', 'push-luck', 'straggler', 'timing-oracle'])
    expect(SWEEP_SEEDS).toEqual(Array.from({ length: 20 }, (_, i) => i))
    for (const id of V1_EXERCISES) expect(SURFACES.map((s) => s.id)).toContain(`fleet-ex:${id}`)
    expect(DAILY_DATES).toHaveLength(30)
    expect(DAILY_DATES[0]).toBe(DAILY_EPOCH)
    DAILY_DATES.forEach((d, i) => expect(daysBetween(DAILY_EPOCH, d)).toBe(i))
  })

  test('src/lib/fleet-model.ts has the sha256 it has at 9aa27de (I1)', async () => {
    expect(fixture.fleetModel.path).toBe(FLEET_MODEL_PATH)
    expect(await fleetModelSha()).toBe(fixture.fleetModel.sha256)
  })

  describe('one hash per surface', () => {
    for (const surface of SURFACES) {
      test(
        `${surface.id}: ${surface.covers}`,
        async () => {
          const { sha256, ms } = await runSurface(surface)
          totalMs += ms
          expect(ms).toBeLessThan(TEST_BUDGET_MS)
          // a drift here means v1 moved: fix the code, never the fixture (§9.4 stop rule 3)
          expect(sha256).toBe(fixture.surfaces[surface.id].sha256)
        },
        TEST_BUDGET_MS,
      )
    }
  })

  afterAll(() => {
    const seconds = totalMs / 1000
    console.log(`v1 golden: ${SURFACES.length} surfaces recomputed in ${seconds.toFixed(1)} s (budget ${TOTAL_BUDGET_S} s)`)
    if (seconds >= TOTAL_BUDGET_S) throw new Error(`the v1 golden surfaces took ${seconds.toFixed(1)} s; the budget is ${TOTAL_BUDGET_S} s`)
  })
})
