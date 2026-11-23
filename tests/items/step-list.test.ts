import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepList } from '../../src/components/items/PromptView'
import { genSeeds } from '../../scripts/verify-generators'
import { loadFamilyPart } from '../../src/lib/items/on-demand'
import { familyIds, loadFamily } from '../../src/lib/items/registry'
import { formatNumber } from '../../src/lib/items/units'
import type { Level, SolutionStep } from '../../src/lib/items/types'

/**
 * A worked step draws its value once. A family either leads up to the value and lets `result` be the chip, or ends
 * its text with the value (or with "=" where a blanked step hid it) and repeats it in `result`; the list must not
 * print "= value = value" for the second kind, nor "= = ?" for a blanked one. Every family in the registry is held
 * to it, and to two more: a shown step ends by stating its result after "=", ":" or "by", and a blank step's row is
 * the shown row cut at the result, so no operand goes missing ("12,200 tokens −  = ?") and no result is dropped
 * ("Free HBM = 80 GB − 40 GB" with the 40 GB left unsaid because the operand happens to equal it).
 */
const FAMILIES = await familyIds()
const LEVELS: Level[] = [0, 1]
const SEEDS = genSeeds(40)

const items = (html: string): string[] => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'"))
const resultText = (s: SolutionStep): string => (s.result ? `${formatNumber(s.result.value)}${s.result.unit ? ` ${s.result.unit}` : ''}` : '')
const escape = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The stated result printed again after it, with or without an "=" between: the bug. An operand that equals the result ("100 − 50 % = 50 %") is not. */
const twice = (row: string, res: string): boolean => new RegExp(`(?:[=:]|\\bby)\\s*${escape(res)}\\s*(=\\s*)?${escape(res)}\\s*$`).test(row)
/** The number as a family may round it in its text ("93.3" for 93.33, at the digits the text chose). */
const sameNumber = (shown: string, value: number): boolean => [undefined, 0, 1, 2, 3, 4].some((d) => formatNumber(value, d) === shown)
/** A shown row ends by stating its result, unit included: "= 6,100 tokens", ": 4 CTAs", "by 3.556 ×". */
function states(row: string, r: NonNullable<SolutionStep['result']>): boolean {
  const m = new RegExp(`(?:[=:]|\\bby)\\s*(-?[\\d,]+(?:\\.\\d+)?)${r.unit ? `\\s*${escape(r.unit)}` : ''}\\s*$`).exec(row)
  return !!m && sameNumber(m[1], r.value)
}

describe('StepList: the value once, and no "= = ?"', () => {
  for (const id of FAMILIES) {
    test(`${id}: worked steps (blank ones as gaps) and solution steps print each result once and no "= ="`, async () => {
      await loadFamilyPart('step-calibrated')
      const gen = await loadFamily(id)
      let drawn = 0
      for (const v of gen.variants) {
        for (const level of LEVELS) {
          if (!v.levels.includes(level)) continue
          for (const seed of SEEDS) {
            const inst = gen.make(seed, level, v.id)
            const lists: [readonly SolutionStep[], boolean][] = [[inst.prompt.worked ?? [], false], [inst.prompt.worked ?? [], true], [gen.solution(inst), true]]
            for (const [steps, reveal] of lists) {
              const rows = items(renderToStaticMarkup(createElement(StepList, { steps, reveal, label: 'steps' })))
              const shownRows = items(renderToStaticMarkup(createElement(StepList, { steps, reveal: true, label: 'steps' })))
              expect(rows).toHaveLength(steps.length)
              steps.forEach((s, i) => {
                const where = `${id}/${v.id} L${level} seed ${seed} step ${i + 1} (reveal ${reveal}): ${rows[i]}`
                // a step's own text may hold code ("== Some(&2)"); the list's "=" only follows a step with a result
                if (s.result) expect(rows[i], where).not.toMatch(/=\s*=/)
                if (s.result && !(s.blank && !reveal)) {
                  expect(twice(rows[i], resultText(s)), where).toBe(false)
                  expect(states(rows[i], s.result), `${where}: ends without stating ${resultText(s)}`).toBe(true)
                }
                if (s.result && s.blank && !reveal) {
                  expect(rows[i], where).toMatch(/(?:[=:]|\bby)\s*\?\s*$/)
                  // the gap row is the shown row up to its result: every operand stays
                  const cut = rows[i].replace(/\?\s*$/, '').trimEnd()
                  expect(shownRows[i].startsWith(cut), `${where}: not a prefix of the shown row «${shownRows[i]}»`).toBe(true)
                }
                drawn++
              })
            }
          }
        }
      }
      expect(drawn).toBeGreaterThan(0)
    })
  }
})
