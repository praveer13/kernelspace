import { describe, expect, test } from 'bun:test'
import { getClaim } from '@/data/claims'
import { ALL_LESSONS } from '@/data/lessons'
import { SHARED_BW_GBS } from '@/lib/sims/models/roofline'

// K0-C30: the shared-memory ratio t4.l2 states must be the one its own simulator and the H100 HBM claim give.

const lesson = ALL_LESSONS.find((l) => l.id === 't4.l2')
if (!lesson) throw new Error('t4.l2 not found')

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) strings(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out)
  return out
}
const text = strings(lesson.blocks).join('\n')

describe('t4.l2 shared memory against HBM', () => {
  test('the stated "about N×" is the simulator constant over the H100 HBM claim, within rounding', () => {
    const hbmGBs = Number(getClaim('hw.h100-sxm.hbm-bw').value) * 1000
    const actual = SHARED_BW_GBS / hbmGBs
    const stated = [...text.matchAll(/about (\d+(?:\.\d+)?)×/g)].map((m) => Number(m[1]))
    expect(stated.length).toBeGreaterThan(0)
    for (const n of stated) expect(Math.abs(n - actual)).toBeLessThanOrEqual(0.5)
  })
  test('the old 20-30× is gone', () => {
    expect(text).not.toMatch(/20[–-]30\s*×/)
  })
  test('L2 is not the KV cache\'s home, and nothing lives there between steps', () => {
    expect(text).not.toContain('second home')
    expect(text).not.toContain('can live here between steps')
  })
})
