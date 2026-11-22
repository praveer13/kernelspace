import { describe, expect, test } from 'bun:test'
import { MIX, mixWastePct } from '@/data/lessons/pagedMix'

// A hand count of the mixed batch's tail waste, made apart from mixWastePct. The block sizes are arguments of the
// arithmetic, not vLLM's default or the paper's: this test reads no claim.
describe('the mixed batch: tail waste counted by hand', () => {
  test('the mix is the eight lengths', () => {
    expect([...MIX]).toEqual([330, 245, 288, 412, 367, 301, 190, 455])
  })

  test('at 16 tokens per block: 36 unused of 2,624 slots is 1.4%', () => {
    // Per-sequence tails: 330 -> 336 (6), 245 -> 256 (11), 288 -> 288 (0), 412 -> 416 (4), 367 -> 368 (1), 301 -> 304 (3), 190 -> 192 (2), 455 -> 464 (9).
    const tails = [6, 11, 0, 4, 1, 3, 2, 9]
    expect(tails.reduce((a, b) => a + b, 0)).toBe(36)
    expect(2624 - 36).toBe(2588) // the eight lengths sum to 2,588
    expect(((36 / 2624) * 100).toFixed(1)).toBe('1.4')
    expect(mixWastePct(16)).toBe('1.4')
  })

  test('at 64 tokens per block: 228 unused of 2,816 slots is 8.1%', () => {
    // 330 -> 384 (54), 245 -> 256 (11), 288 -> 320 (32), 412 -> 448 (36), 367 -> 384 (17), 301 -> 320 (19), 190 -> 192 (2), 455 -> 512 (57).
    const tails = [54, 11, 32, 36, 17, 19, 2, 57]
    expect(tails.reduce((a, b) => a + b, 0)).toBe(228)
    expect(2816 - 228).toBe(2588)
    expect(((228 / 2816) * 100).toFixed(1)).toBe('8.1')
    expect(mixWastePct(64)).toBe('8.1')
  })
})
