import { describe, expect, test } from 'bun:test'
import { claimNumber, getClaim } from '@/data/claims'
import '@/data/claims/lazy/gpu-limits'
import '@/data/claims/lazy/tiling'
import erratum from '@/data/errata/2026-11-22-t4-l1-64-warps-per-sm'
import lesson from '@/data/lessons/t4/cpu-vs-gpu'

/** K0-B9: t4.l1 states the warp limit per SM from the Hopper claim, not "thousands". */
describe('t4.l1 warps per SM (K0-B9)', () => {
  test('the Hopper per-SM warp limit is a spec claim of 64 warps', () => {
    const c = getClaim('hw.h100-sxm.max-warps-per-sm')
    expect(c.kind).toBe('spec')
    expect(c.value).toBe(64)
    expect(c.unit).toBe('warps')
    expect(c.source.url).toContain('docs.nvidia.com')
  })

  test('the about-8,000 figure is the SM count times the per-SM limit, rounded to the thousand', () => {
    const product = claimNumber('hw.h100-sxm.sm-count') * claimNumber('hw.h100-sxm.max-warps-per-sm')
    expect(product).toBe(132 * 64)
    expect(Math.round(product / 1000) * 1000).toBe(8000)
  })

  test('the lesson states the limit from the claim and no longer says thousands of warps', () => {
    const text = JSON.stringify(lesson)
    expect(text).toContain('up to 64 resident warps per SM, about 8,000 across an H100')
    expect(text).toContain('dozens of warps per SM can be resident')
    expect(text).not.toContain('thousands of warps')
  })

  test('the erratum id is its file name, dated the day it was written, and names t4.l1', () => {
    expect(erratum.id).toBe('2026-11-22-t4-l1-64-warps-per-sm')
    expect(erratum.date).toBe('2026-11-22')
    expect(erratum.kind).toBe('error')
    expect(erratum.lessons).toEqual(['t4.l1'])
    expect(erratum.before.length).toBeLessThanOrEqual(240)
    expect(erratum.after.length).toBeLessThanOrEqual(240)
  })
})
