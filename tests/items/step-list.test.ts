import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StepList } from '../../src/components/items/PromptView'
import { genSeeds } from '../../scripts/verify-generators'
import { loadFamilyPart } from '../../src/lib/items/on-demand'
import { loadFamily } from '../../src/lib/items/registry'
import { formatNumber } from '../../src/lib/items/units'
import type { Level, SolutionStep } from '../../src/lib/items/types'

/**
 * A worked step draws its value once. A family either leads up to the value and lets `result` be the chip, or ends
 * its text with the value (or with "=" where a blanked step hid it) and repeats it in `result`; the list must not
 * print "= value = value" for the second kind, nor "= = ?" for a blanked one.
 */
const FAMILIES = ['roofline', 'step', 'tiling', 'cost', 'prefill', 'memory', 'rollout'] as const
const LEVELS: Level[] = [0, 1]
const SEEDS = genSeeds(40)

const items = (html: string): string[] => [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1].replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '').replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'"))
const resultText = (s: SolutionStep): string => (s.result ? `${formatNumber(s.result.value)}${s.result.unit ? ` ${s.result.unit}` : ''}` : '')
const escape = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The result printed twice in a row, with or without an "=" between: the bug. A value that merely recurs inside the sentence is not. */
const twice = (row: string, res: string): boolean => new RegExp(`(?<![\\d.,])${escape(res)}\\s*(=\\s*)?${escape(res)}\\s*$`).test(row)

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
              expect(rows).toHaveLength(steps.length)
              steps.forEach((s, i) => {
                const where = `${id}/${v.id} L${level} seed ${seed} step ${i + 1} (reveal ${reveal}): ${rows[i]}`
                expect(rows[i], where).not.toMatch(/=\s*=/)
                if (s.result && !(s.blank && !reveal)) expect(twice(rows[i], resultText(s)), where).toBe(false)
                if (s.result && s.blank && !reveal) expect(rows[i], where).toMatch(/[=:]\s*\?\s*$/)
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
