import { describe, expect, test } from 'bun:test'
import { LESSONS_BY_TRACK } from '../../src/data/lessons'

/**
 * Wave 2 spec §19.3: T1-T3 prose follows the Wave 1a units convention.
 * Memory sizes (pages, blocks, stacks, heaps, caches) are binary, KiB/MiB/GiB. Decimal units appear only where a
 * source says them, which in T1-T3 means bandwidth rates (TB/s HBM, GB/s links) from spec sheets. One unit per figure.
 * Each rule is a pattern that was live before the sweep; the fixture below proves every rule still fires.
 */

interface Rule {
  name: string
  pattern: RegExp
}

const NUMBER = String.raw`\d[\d.,]*(?:\s?[–-]\s?\d[\d.,]*)?`

export const RULES: Rule[] = [
  // "1 MB stack", "64 KB on the heap", "1–8 MB per thread": a memory size in the decimal-looking spelling.
  { name: 'bare KB/MB beside a number', pattern: new RegExp(String.raw`${NUMBER}\s?(?:KB|kB|MB)\b`) },
  // "a 10 GB file", "~80 GB of address space": GB and TB are fine as a rate (GB/s, TB/s), not as a size.
  { name: 'bare GB/TB size (not a rate)', pattern: new RegExp(String.raw`${NUMBER}\s?(?:GB|TB)\b(?!\s?/\s?s)`) },
  // "the entire megabyte", "a gigabyte": the word spelling of the same size.
  { name: 'spelled-out decimal size with a count', pattern: /\b(?:a|an|one|the entire|the whole)\s+(?:kilo|mega|giga|tera)bytes?\b/i },
  // "4 KiB (4 KB)", "1 MiB MB": two spellings of one figure.
  { name: 'two units for one figure', pattern: new RegExp(String.raw`\b(?:Ki|Mi|Gi|Ti)B\s*\(?\s*${NUMBER}?\s?(?:KB|kB|MB|GB|TB)\b`) },
]

/** Every string in a value, depth first (lessons are plain data: markdown, code, options, whys, sim notes). */
function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value
  else if (Array.isArray(value)) for (const v of value) yield* strings(v)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* strings(v)
}

export function unitViolations(text: string): string[] {
  const hits: string[] = []
  for (const rule of RULES) {
    const m = rule.pattern.exec(text)
    if (m) hits.push(`${rule.name}: "${m[0]}"`)
  }
  return hits
}

describe('units sweep, T1-T3 (spec §19.3)', () => {
  test('every rule fires on the pre-sweep wording', () => {
    const before = [
      'typically 1–8 MB per thread',
      'a 100 MB buffer',
      'owned: 64 KB on the heap',
      'a 10 GB file once through a 4 GB cache',
      'the first malloc(8) would consume the entire megabyte',
      'a 4 KiB (4 KB) page',
    ]
    for (const text of before) expect(unitViolations(text).length).toBeGreaterThan(0)
    expect(RULES.every((r) => before.some((t) => r.pattern.test(t)))).toBe(true)
  })

  test('rates and binary sizes pass', () => {
    const after = [
      'typically 1–8 MiB per thread',
      'a 3.35 TB/s HBM stack and ~64 GB/s of PCIe',
      'a 4 KiB page, 512 GiB of metadata, a 1 MiB slab',
      'moving GB/s over RDMA',
    ]
    for (const text of after) expect(unitViolations(text)).toEqual([])
  })

  for (const track of ['t1', 't2', 't3'] as const) {
    for (const lesson of LESSONS_BY_TRACK[track]) {
      test(`${lesson.id} uses KiB/MiB/GiB for sizes, one unit per figure`, () => {
        const found: string[] = []
        for (const s of strings(lesson)) found.push(...unitViolations(s))
        expect(found).toEqual([])
      })
    }
  }
})
