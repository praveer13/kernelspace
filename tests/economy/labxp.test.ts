/**
 * `labXp` and `labCheckXp` (wave-1.md §8.4): the numbers ForgeLab and the Forge index print come from the
 * table, so they cannot drift from what `labc:` facts actually pay.
 */
import { describe, expect, test } from 'bun:test'
import { FORGE_LABS } from '../../src/data/labs'
import { factMinutes, labCheckXp, labXp } from '../../src/lib/economy'

describe('labXp', () => {
  test('is the lab’s minutes, for every Forge lab', () => {
    for (const lab of FORGE_LABS) expect(labXp(lab.id)).toBe(lab.minutes)
  })

  test('lab 01 is 90 XP, 15 per required check', () => {
    expect(labXp('rust-allocator')).toBe(90)
    expect(labCheckXp('rust-allocator')).toBe(15)
  })

  test('the per-check price is what a labc fact pays, and the checks add up to the lab', () => {
    for (const lab of FORGE_LABS) {
      const required = lab.checks.filter((c) => !c.optional)
      for (const c of required) expect(factMinutes(`labc:${lab.id}/${c.id}`)).toBeCloseTo(labCheckXp(lab.id), 9)
      expect(labCheckXp(lab.id) * required.length).toBeCloseTo(labXp(lab.id), 9)
    }
  })

  test('an unknown lab pays nothing, including prototype-chain names', () => {
    expect(labXp('no-such-lab')).toBe(0)
    expect(labCheckXp('no-such-lab')).toBe(0)
    expect(labXp('constructor')).toBe(0)
    expect(labCheckXp('__proto__')).toBe(0)
  })
})
