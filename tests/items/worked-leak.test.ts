/**
 * K0-A6: at levels 0 and 1 no visible worked step carries the answer, in any family. The visible steps are the ones
 * not blanked; a blank step keeps its lead-in, so the rule is that nothing follows it and no other step's result or
 * text shows the final truth.
 */
import { describe, expect, test } from 'bun:test'
import { partsText, workedSteps } from '../../src/lib/items/core'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Instance, SolutionStep } from '../../src/lib/items/types'
import { formatNumber } from '../../src/lib/items/units'

const families = await loadAllFamilies()
/**
 * Families whose level 1 still blanks a middle step and shows steps after it (those steps print the blank's value, not
 * the final answer). They have their own workedFor and are not part of K0-A6; the rule is asserted for every other family.
 */
const AFTER_BLANK_AT_LEVEL_1 = new Set(['frag', 'kv', 'memory', 'prefill', 'rollout', 'sig', 'spec'])
const SEEDS = Array.from({ length: 30 }, (_, i) => 1000 + i * 37)

const truthOf = (i: Instance): number | undefined => (i.answer.kind === 'numeric' || i.answer.kind === 'estimate' ? i.answer.truth : undefined)

/** The number stated as a result: after an "=" or a ":", and not the start of a longer number. */
function states(text: string, n: number): boolean {
  const s = formatNumber(n).replace(/[.,]/g, '\\$&')
  return new RegExp(`[=:]\\s*${s}(?![\\d]|[.,]\\d)`).test(text)
}

describe('worked steps at levels 0 and 1', () => {
  for (const gen of families) {
    test(`${gen.id}: one blank, nothing visible after it, no visible step holds the answer`, () => {
      for (const v of gen.variants) {
        for (const level of [0, 1] as const) {
          if (!v.levels.includes(level)) continue
          for (const seed of SEEDS) {
            const i = gen.make(seed, level, v.id)
            const worked = i.prompt.worked
            const where = `${gen.id}/${v.id} level ${level} seed ${seed}`
            if (!worked) continue
            const blank = worked.findIndex((w) => w.blank)
            // a family may show every step but the last with none blank (cost, frag); a blank step is always the last shown
            if (blank >= 0 && !AFTER_BLANK_AT_LEVEL_1.has(gen.id)) expect(blank, `${where}: a step is visible after the blank`).toBe(worked.length - 1)
            const truth = truthOf(i)
            if (truth === undefined) continue
            const unit = i.answer.kind === 'numeric' || i.answer.kind === 'estimate' ? i.answer.unit : undefined
            worked.forEach((w, k) => {
              if (w.blank) return
              // a step is the answer when it finds the same value in the same unit; a number that merely coincides with a
              // value of another unit (9 req/s, 9 replicas) is not
              const sameUnit = w.result?.unit === undefined || unit === undefined || w.result.unit === unit
              if (w.result && sameUnit) expect(w.result.value, `${where}: step ${k + 1} result is the answer`).not.toBe(truth)
              // a one-digit whole answer ("2") also stands for a count or an exponent in a step's words; and a step that
              // states a result of its own is not stating the answer by coinciding with it in its words
              if (Number.isInteger(truth) && Math.abs(truth) < 10) return
              if (w.result && (w.result.value !== truth || !sameUnit)) return
              expect(states(partsText(w.text), truth), `${where}: step ${k + 1} text states ${formatNumber(truth)}`).toBe(false)
            })
          }
        }
      }
    })
  }
})

describe('workedSteps', () => {
  const step = (n: number): SolutionStep => ({ text: [{ t: 'text', text: `s${n} = ${n}` }], result: { value: n } })
  const blank = (s: SolutionStep): SolutionStep => ({ ...s, blank: true })
  const full = [step(1), step(2), step(3)]

  test('level 0 blanks the last of every step; level 1 drops the last and blanks the one before; later levels show none', () => {
    expect(workedSteps(full, 0, blank)?.map((s) => !!s.blank)).toEqual([false, false, true])
    expect(workedSteps(full, 1, blank)?.map((s) => !!s.blank)).toEqual([false, true])
    expect(workedSteps(full, 2, blank)).toBeUndefined()
    expect(workedSteps(full, 3, blank)).toBeUndefined()
  })
})
