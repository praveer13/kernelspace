import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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
    const pair = ((gpus * bandwidth) / 1e12).toFixed(1)
    expect(item.q.explanation).toContain(`${pair} TB/s ÷ 140 GB`)
    expect(item.q.explanation).toContain('about 48 tokens per second')
  })

  // K0-FIX-T7: the stem's GPU figures come from the claims the test reads, and the compute-bound distractor models the
  // same two GPUs the stem names, not one chip.
  test('the stem prints the claims, and the lesson reads them instead of typing them', () => {
    expect(stem).toContain(`two ${num('hw.h100-sxm.hbm-capacity')} GB GPUs`)
    expect(stem).toContain(`each with ${num('hw.h100-sxm.hbm-bw')} TB/s`)
    const src = readFileSync('src/data/lessons/t7/autoscaling-planner.ts', 'utf8')
    expect(src).toContain("claimNumber('hw.h100-sxm.hbm-capacity')")
    expect(src).toContain("claimNumber('hw.h100-sxm.hbm-bw')")
    expect(src).not.toContain('two 80 GB GPUs')
    expect(src).not.toContain('3.35 TB/s')
  })

  test('the stream times in the options are the weight bytes over both GPUs\' bandwidth', () => {
    const ms = (bytes: number) => Math.round((bytes / (gpus * bandwidth)) * 1000)
    expect(item.q.options[0]).toContain(`about ${ms(70e9)} ms`)
    expect(item.q.options[2]).toContain(`about ${ms(weightBytes)} ms`)
  })

  test('the compute-bound distractor is two chips\' BF16 rate over 140 GFLOP a token', () => {
    const thousands = Math.round((gpus * num('hw.h100-sxm.bf16-dense') * 1e12) / 140e9 / 1000)
    expect(thousands).toBe(14)
    expect(item.q.options[3]!.startsWith('Fourteen thousand tokens per second: the two chips\'')).toBe(true)
  })
})
