import { describe, expect, test } from 'bun:test'
import { byId } from '@/data/claims/all'
import { lessonById } from '@/data/lessons'

/**
 * K0-C29: the t7.l5 spiral item on the batch-1 decode ceiling is recomputed from the claims. The weights it names
 * must fit the GPUs its stem names (140 GB of BF16 weights do not fit one 80 GB H100), and its key must equal the
 * aggregate bandwidth of those GPUs divided by the weight bytes. Tests may read the eager claims directly; lessons may not.
 */
const num = (id: string): number => {
  const v = byId[id]?.value
  if (typeof v !== 'number') throw new Error(`claim ${id} is not a number`)
  return v
}
const WORD_GPUS: Record<string, number> = { one: 1, two: 2, four: 4, eight: 8 }
const WORD_TOKENS: Record<number, string> = { 24: 'Twenty-four', 48: 'Forty-eight', 96: 'Ninety-six' }

const item = lessonById('t7.l5')!.ticket!.spiral!.find((i) => i.id === 't7.spiral.decode-ceiling')!
const stem = item.q.q
const gpus = WORD_GPUS[/across (one|two|four|eight) /.exec(stem)?.[1] ?? 'one']!
const capacityBytes = num('hw.h100-sxm.hbm-capacity') * 1e9
const bandwidth = num('hw.h100-sxm.hbm-bw') * 1e12
const weightBytes = 70e9 * 2 // 70 billion parameters at 2 bytes per BF16 parameter

describe('t7.spiral.decode-ceiling recomputed from the claims', () => {
  test('the weights fit the GPUs the stem names', () => {
    expect(stem).toContain('BF16')
    expect(weightBytes).toBe(140e9)
    expect(gpus * capacityBytes).toBeGreaterThanOrEqual(weightBytes)
  })

  test('the key is the aggregate bandwidth over the weight bytes', () => {
    const tokensPerSecond = Math.round((gpus * bandwidth) / weightBytes)
    expect(tokensPerSecond).toBe(48)
    const keyed = item.q.options[item.q.correct[0]!]!
    expect(keyed.startsWith(WORD_TOKENS[tokensPerSecond]!)).toBe(true)
  })

  test('the explanation states the same ceiling', () => {
    expect(item.q.explanation).toContain('6.7 TB/s ÷ 140 GB')
    expect(item.q.explanation).toContain('about 48 tokens per second')
  })
})
