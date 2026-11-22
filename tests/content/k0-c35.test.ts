import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import erratum from '@/data/errata/2026-11-22-t4-l5-workgroup-dispatch-limit-and-staged-race'

/**
 * K0-C35, t4.l5: WebGPU's default maxComputeWorkgroupsPerDimension is 65,535, so 65,536 workgroups are launched in
 * two dimensions; the playground stages the symptom of a missing barrier and does not reproduce a race.
 */
const MAX_PER_DIMENSION = 65535
const src = readFileSync(new URL('../../src/data/lessons/t4/wgsl-playground.ts', import.meta.url), 'utf8')

describe('K0-C35: t4.l5 dispatch limit and the staged race', () => {
  test('no dispatchWorkgroups call in the lesson launches more than 65,535 groups in one argument', () => {
    const calls = [...src.matchAll(/dispatchWorkgroups\(([^)]*)\)/g)]
    expect(calls.length).toBeGreaterThan(0)
    // The old listing gave a count of groups beside a one-argument dispatch; a group count over the cap must name its two dimensions.
    const listing = src.slice(src.indexOf('// host:'), src.indexOf('// NOTE: AI'))
    expect(listing).toContain('dispatchWorkgroups(256, 256)')
    expect(listing).not.toMatch(/dispatchWorkgroups\(ceil/)
    for (const m of calls) {
      for (const arg of m[1].split(',')) {
        const n = Number(arg.replace(/[_,\s]/g, ''))
        if (Number.isFinite(n)) expect(n).toBeLessThanOrEqual(MAX_PER_DIMENSION)
      }
    }
  })

  test('the prediction truth stays 65536 in total and its stem says so', () => {
    expect(src).toContain('truth: 65536,')
    expect(src).toContain('How many workgroups in total must the dispatch launch')
  })

  test('the lesson no longer claims the playground reproduces a race', () => {
    expect(src).not.toContain('all reproducible in the playground')
    expect(src).not.toContain('a race you can watch')
    expect(src).toContain('does not reproduce a race')
  })

  test('the erratum names the lesson and the 65,535 limit', () => {
    expect(erratum.lessons).toEqual(['t4.l5'])
    expect(erratum.after).toContain('65,535')
  })
})
