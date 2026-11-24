/** K0-C34: resident warps in the t4.l4 occupancy example, recomputed from the registry claims. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { getClaim } from '../../src/data/claims'
import '../../src/data/claims/lazy/tiling'

const regs = () => getClaim('hw.h100-sxm.registers-per-sm').value as number
const smemKiB = () => getClaim('hw.h100-sxm.smem-per-sm').value as number

describe('t4.l4 occupancy example: 128 registers/thread, 100 KiB shared/block, 64-thread blocks', () => {
  const threadsPerBlock = 64
  const warpsPerBlock = threadsPerBlock / 32

  test('registers alone allow 16 warps', () => {
    expect(Math.floor(regs() / (128 * 32))).toBe(16)
  })

  test('shared memory allows 2 blocks, so 4 warps: the binding budget', () => {
    const blocks = Math.floor(smemKiB() / 100)
    expect(blocks).toBe(2)
    const bySmem = blocks * warpsPerBlock
    expect(bySmem).toBe(4)
    expect(bySmem).toBeLessThan(Math.floor(regs() / (128 * 32)))
  })

  test('4 of 64 warps is 6.25%, quoted as 6%', () => {
    expect((4 / 64) * 100).toBe(6.25)
    expect(Math.round((4 / 64) * 100)).toBe(6)
  })

  test('the lesson names the 64-thread blocks and shared memory as the binding budget, and no longer blames registers', () => {
    const src = readFileSync('src/data/lessons/t4/occupancy-coalescing.ts', 'utf8')
    expect(src).toContain('blocks of 64 threads (2 warps each)')
    expect(src).toContain('Shared memory is the binding budget')
    expect(src).not.toContain('so many registers per thread that only four warps')
    expect(src).not.toContain('128 registers/thread and 100 KiB shared/block might fit only 4')
  })
})

describe('t4.l7 spiral item: the same example, with the key naming shared memory', () => {
  const src = readFileSync('src/data/lessons/t4/quantization.ts', 'utf8')

  test('the stem states the example whose resident warps the claims give as four', () => {
    expect(src).toContain('only four warps resident on each multiprocessor')
    expect(src).toContain('128 registers each, and its blocks of 64 threads use 100 KiB of shared memory each')
    expect(Math.floor(smemKiB() / 100) * (64 / 32)).toBe(4)
    expect(Math.floor(regs() / (128 * 32))).toBe(16)
  })

  test('the key names shared memory, and no longer blames registers', () => {
    expect(src).toContain("'Use less shared memory per block, with more blocks then fitting to cover each wait'")
    expect(src).toContain('here shared memory, lets more warps hide the wait')
    expect(src).not.toContain('registers cap how many warps fit')
    expect(src).not.toContain('here registers, lets more warps')
  })

  test('the stat hint says one GPU instead of two (140 GB over 80 GB per GPU rounds up to 2)', () => {
    expect(src).toContain('One GPU instead of two.')
    expect(Math.ceil(140 / (getClaim('hw.h100-sxm.hbm-capacity').value as number))).toBe(2)
    expect(Math.ceil(35 / (getClaim('hw.h100-sxm.hbm-capacity').value as number))).toBe(1)
  })
})
