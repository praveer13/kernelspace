import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import erratum from '@/data/errata/2026-11-22-t3-l3-admit-and-model'

/** K0-B3, t3.l3: admit() uses checked_sub from eight slots with a release(); the sim is called a model. */
const src = readFileSync(new URL('../../src/data/lessons/t3/rust-concurrency.ts', import.meta.url), 'utf8')

describe('K0-B3: t3.l3 listing and sim wording', () => {
  test('admit() does not use then_some and has slots to give', () => {
    expect(src).not.toContain('then_some')
    expect(src).toContain('n.checked_sub(1)')
    expect(src).toContain('AtomicU64::new(8)')
    expect(src).toContain('fn release()')
  })
  test('the lesson no longer calls the sim a measurement or names a crossbeam counter', () => {
    expect(src).not.toContain('measured in Rust')
    expect(src).not.toContain('The measured ordering')
    expect(src).not.toContain("sharded counters")
    expect(src).toContain('crossbeam_utils::CachePadded')
    expect(src).toContain('as a model')
    expect(src).toContain('The modelled ordering')
  })
  test('the erratum is for t3.l3', () => {
    expect(erratum.lessons).toEqual(['t3.l3'])
    expect(erratum.after).toContain('CachePadded')
  })
})
