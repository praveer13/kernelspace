/**
 * S2's claims coverage ratchet (Wave 1 stage 0, task K3-2): every statline chip names a claim, every fact-bearing sentence
 * of prose cites one, and the committed baseline of today's uncited items may only shrink.
 *
 * `bun scripts/claims-coverage.ts` prints the per-track counts; `--update` refuses to add a baseline line.
 */
import { describe, expect, test } from 'bun:test'
import {
  factsIn,
  findings,
  formatReport,
  isEmpty,
  readBaseline,
  scanCoverage,
  sentencesOf,
  type Baseline,
} from '../../scripts/claims-coverage'

// the per-track counts the wave's report quotes
console.log(formatReport())

describe('the detector', () => {
  test('it finds a year, a version, a price and a number with a unit', () => {
    expect(factsIn('The release came in 2024.')).toEqual(['year'])
    expect(factsIn('vLLM v0.34.0 changed it.')).toEqual(['version'])
    expect(factsIn('It costs $2 per GPU-hour.')).toEqual(['price', 'unit'])
    expect(factsIn('HBM3 gives 3.35 TB/s.')).toEqual(['unit'])
    expect(factsIn('Batching fills the GPU.')).toEqual([])
  })

  test('it reads prose sentences only: no fences, no inline code, no headings', () => {
    const md = '## 2024 in review\n\nA 2024 claim.\n\n```\nv0.1.0 in code\n```\n\nInline `v9.9.9` stays code.'
    expect(sentencesOf(md)).toEqual(['A 2024 claim.', 'Inline stays code.'])
    expect(factsIn('Released in 2024.')).toEqual(['year'])
  })
})

describe('the baseline', () => {
  test('the committed baseline matches the tree, and every new or stale item would fail', () => {
    const coverage = scanCoverage()
    expect(isEmpty(findings(readBaseline(), coverage))).toBe(true)
    // a sentence that is not in the baseline is a new finding
    const baseline = readBaseline()
    const fake = {
      ...coverage,
      sentences: [...coverage.sentences, { lesson: 't0.l1', hash: 'fake', facts: ['year'], sample: 'A new claim in 2024.' }],
      chips: [...coverage.chips, { lesson: 't0.l1', label: 'a new chip', value: '1' }],
    }
    const f = findings(baseline, fake)
    expect(f.newSentences.map((s) => s.hash)).toEqual(['fake'])
    expect(f.newChips.map((c) => c.label)).toEqual(['a new chip'])
  })

  test('a baseline entry whose sentence is now cited is stale, so the file can only shrink', () => {
    const baseline: Baseline = { chips: [{ lesson: 't0.l1', label: 'a chip', value: '1' }], sentences: [{ lesson: 't0.l1', hash: 'gone', facts: ['year'], sample: 'old' }] }
    const f = findings(baseline, { chips: [], sentences: [], chipsTotal: {}, sentencesTotal: {} })
    expect(f.staleChips).toHaveLength(1)
    expect(f.staleSentences).toHaveLength(1)
  })

  test('the S2 report prints the per-track counts', () => {
    const report = formatReport()
    expect(report).toContain('S2 coverage (cited / total)')
    for (const track of ['R', 'T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']) expect(report).toContain(`  ${track.padEnd(3)} chips`)
    expect(report).toMatch(/chips \d+\/\d+/)
  })
})
