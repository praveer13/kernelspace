import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { genSeeds } from '../../scripts/verify-generators'
import { partText } from '../../src/lib/items/core'
import { formatNumber } from '../../src/lib/items/units'
import type { Gen, Instance, Level, PromptPart, SolutionStep } from '../../src/lib/items/types'

/**
 * WCAG 1.4.10 (Reflow): a value or claim chip is drawn as one unit, so a long chip is wider than a
 * phone's prompt box and the page scrolls sideways. A chip keeps its unit short; the descriptive words
 * belong in the text around it. This reads every chip of every shipped family, variant and level.
 */
const MAX_CHIP = 28
const SEEDS = genSeeds(200)
const LEVELS: Level[] = [0, 1, 2, 3]
const DIR = new URL('../../src/lib/items/families/', import.meta.url)

async function families(): Promise<Gen[]> {
  const names = readdirSync(DIR)
    .filter((n) => /^[a-z][a-z0-9-]*\.ts$/.test(n))
    .sort()
  return Promise.all(names.map(async (n) => ((await import(new URL(n, DIR).href)) as { default: Gen }).default))
}

/** The text of every chip PromptView draws for an instance: value and claim parts, and each step's result. */
function chips(inst: Instance, solution: readonly SolutionStep[]): string[] {
  const out: string[] = []
  const take = (parts: readonly PromptPart[]) => {
    for (const p of parts) if (p.t === 'value' || p.t === 'claim') out.push(partText(p))
  }
  take(inst.prompt.stem)
  for (const g of inst.prompt.givens ?? []) take([g.value])
  for (const s of [...(inst.prompt.worked ?? []), ...solution]) {
    take(s.text)
    if (s.result) out.push(`${formatNumber(s.result.value)}${s.result.unit ? ` ${s.result.unit}` : ''}`)
  }
  return out
}

describe('chips: every value and claim chip stays short enough to fit a phone', () => {
  test(`no chip is longer than ${MAX_CHIP} characters in any shipped family, variant or level over ${SEEDS.length} seeds`, async () => {
    const fams = await families()
    expect(fams.length).toBeGreaterThan(0)
    const long = new Set<string>()
    for (const gen of fams) {
      for (const v of gen.variants) {
        for (const level of LEVELS) {
          if (!v.levels.includes(level)) continue
          for (const seed of SEEDS) {
            const inst = gen.make(seed, level, v.id)
            for (const c of chips(inst, gen.solution(inst))) {
              if (c.length > MAX_CHIP) long.add(`${gen.id}/${v.id}: ${c.replace(/^[\d.,\s]+/, '# ')}`)
            }
          }
        }
      }
    }
    expect([...long].sort()).toEqual([])
  })
})
