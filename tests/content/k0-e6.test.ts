import { describe, expect, test } from 'bun:test'
import { claimNumber } from '@/data/claims'
import { ALL_LESSONS } from '@/data/lessons'

// K0-E6: t2.l7 gives the earlier systems' waste in the paper's figures, not a rounding, and its briefing asks why
// the block-table indirection is worth its cost. Q5's stem is unchanged (owner question D: default keep).

const lesson = ALL_LESSONS.find((l) => l.id === 't2.l7')
if (!lesson) throw new Error('t2.l7 not found')

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const all = strings(lesson.blocks)
const low = claimNumber('model.kv.static-utilization-low')
const high = claimNumber('model.kv.static-utilization-high')

describe('t2.l7 waste of the earlier systems', () => {
  test("no string contains '60–80%' or '60-80%'", () => {
    for (const s of all) {
      expect(s).not.toContain('60–80%')
      expect(s).not.toContain('60-80%')
    }
  })
  test('the Section 1-3 prose holds the two claim values as rendered', () => {
    const prose = all.find((s) => s.includes('In the paper\'s Figure 2'))
    expect(prose).toBeDefined()
    expect(prose).toContain(`${low}% to ${high}%`)
  })
  test('the prose does not say every earlier system pre-allocates the maximum length', () => {
    expect(all.some((s) => s.includes('pre-allocated for the maximum possible length'))).toBe(false)
  })
})

describe('t2.l7 checkpoint briefing', () => {
  const briefing = all.find((s) => s.includes('You are ready for the checkpoint'))
  test('asks why the indirection is worth its cost', () => {
    expect(briefing).toContain('Why is the block-table indirection worth its cost?')
    expect(briefing).not.toContain('cost so little')
  })
  test("Q5's stem is unchanged", () => {
    expect(all).toContain('Why does the block-table indirection cost so little relative to its benefit?')
  })
})
