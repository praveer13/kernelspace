/**
 * The KV-full concurrency's verdict wording (3s-07's second review note): vLLM budgets 90 % of the memory the driver reports,
 * not of the claim's 80 × 10⁹ bytes, and then takes out what its profiling run measures besides the weights, so a reading
 * near the estimate can land on either side of it. The numbers the wording states are derived here by hand.
 */
import { describe, expect, test } from 'bun:test'
import { claimNumber } from '../../src/data/claims'
import decodeKv, { DRIVER_MIB, MAX_MODEL_LEN, UTILIZATION, decodeKvRows, driverHeadroom } from '../../src/data/field-labs/decode-kv'
import { verdictFor } from '../../src/data/field-labs/types'

const concurrency = decodeKv.metrics.find((m) => m.id === 'concurrency')!
const estimate = decodeKvRows().find((r) => r.id === 'concurrency')!.value

describe("the concurrency verdict says what the driver's memory and the profiling run do", () => {
  test('81,559 MiB is 85.5 × 10⁹ bytes; 90 % of the 5.5 × 10⁹ over the claim is 4.97 × 10⁹, 9.3 requests of 4,096 tokens', () => {
    expect(DRIVER_MIB * 2 ** 20).toBe(85_520_809_984)
    expect(claimNumber('hw.h100-sxm.hbm-capacity', 1e9)).toBe(80e9)
    expect(claimNumber('model.llama3-8b.kv-bytes-per-token')).toBe(131_072)
    expect([UTILIZATION, MAX_MODEL_LEN]).toEqual([0.9, 4096])
    const h = driverHeadroom()
    // 0.90 × (85,520,809,984 − 80,000,000,000) = 4,968,728,985.6
    expect(h.bytes).toBeCloseTo(4_968_728_985.6, 1)
    // ÷ 131,072 B per token ÷ 4,096 tokens = 9.25 requests, over the estimate's 104.2: at most 1.09×
    expect(h.requests).toBeCloseTo(9.255, 3)
    expect(estimate).toBeCloseTo(104.196, 3)
    expect(h.ratio).toBeCloseTo(1.0888, 4)
  })

  test('below no longer says a reading under is expected: it names both effects and that they roughly cancel', () => {
    expect(concurrency.below).not.toContain('a little under is expected')
    expect(concurrency.below).toContain('81,559 MiB (85.5 × 10⁹ bytes)')
    expect(concurrency.below).toContain('up to 5.0 × 10⁹ bytes more, about 9 more requests')
    expect(concurrency.below).toContain('profiling run')
    expect(concurrency.below).toContain('roughly cancel')
    expect(concurrency.below).toContain('either side')
  })

  test("above says the driver's extra is worth at most 1.09×, so a reading past the near band (1.1×) needs another cause", () => {
    expect(concurrency.above).toContain('at most 1.09× the estimate')
    expect(concurrency.above).toContain('81,559 MiB')
    // the driver's extra alone stays inside the near band, so it never explains an 'above' verdict on an 80 GB card
    expect(verdictFor(concurrency, estimate * driverHeadroom().ratio, estimate).band).toBe('near')
    expect(verdictFor(concurrency, estimate * 1.11, estimate).band).toBe('above')
  })
})
