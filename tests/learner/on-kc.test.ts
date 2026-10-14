/**
 * Items are on-KC (2b final review, blocking 1): the redraw Today (`makeInstance`), tickets and the placement
 * walk (`makeGenPool`) share. A family whose instance carries the KC on the seed it is handed serves exactly
 * the instance it served before; one whose KCs come from the seed (sig: the fault's KC) is redrawn, bounded and
 * deterministically, until the instance carries the KC; when no draw does, the pool serves nothing (the caller
 * falls back to authored items), never an off-KC item; and a `make` that throws is not a draw that missed.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { KCS } from '../../src/data/kc'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Gen, Instance, Level } from '../../src/lib/items/types'
import type { KcId } from '../../src/lib/kc/types'
import { ON_KC_DRAWS, drawOnKc, onKcSeed } from '../../src/lib/learner/on-kc'
import { makeGenPool } from '../../src/lib/learner/ticket'
import { makeInstance } from '../../src/lib/learner/today'
import { hash32 } from '../../src/lib/rng'

const EXT = 't1.external-frag'
const LEVELS: readonly Level[] = [0, 1, 2, 3]

let gens: Map<string, Gen>
beforeAll(async () => {
  gens = new Map((await loadAllFamilies()).map((g) => [g.id, g]))
})

/** A stand-in instance: only `seed` and `kcs` matter to the redraw. */
const inst = (seed: number, kcs: KcId[]): Instance => ({ seed, kcs }) as unknown as Instance

/** A family whose instance carries `kc` only on seeds that are 0 mod `every` (as sig carries one fault KC in four). */
function bySeed(base: Gen, kc: KcId, every: number, other: KcId = 't0.locality'): Gen {
  return {
    ...base,
    id: 'by-seed',
    make: (s, l, v) => ({ ...base.make(s, l, v), family: 'by-seed', kcs: s % every === 0 ? [kc] : [other] }),
  }
}

describe('the redraw', () => {
  test('the first seed is the one handed in; the others hash the seed, the KC and the draw', () => {
    expect(onKcSeed(77, EXT, 0)).toBe(77)
    expect(onKcSeed(77, EXT, 3)).toBe(hash32(`77:${EXT}:3`))
    const seeds = Array.from({ length: ON_KC_DRAWS }, (_, k) => onKcSeed(77, EXT, k))
    expect(new Set(seeds).size).toBe(ON_KC_DRAWS)
    // another KC redraws on other seeds
    expect(onKcSeed(77, 't5.kv-capacity', 3)).not.toBe(onKcSeed(77, EXT, 3))
  })

  test('an instance that carries the KC on the first seed is served as made: one call, no redraw', () => {
    const calls: number[] = []
    const got = drawOnKc(EXT, 77, (s) => (calls.push(s), inst(s, [EXT, 't0.locality'])))
    expect(calls).toEqual([77])
    expect(got?.seed).toBe(77)
  })

  test('otherwise the first redraw that carries the KC, and the same seed always gives the same draw', () => {
    const fits = (s: number) => s % 5 === 0
    const make = (s: number) => inst(s, fits(s) ? [EXT] : ['t0.locality'])
    for (let seed = 1; seed < 200; seed++) {
      const a = drawOnKc(EXT, seed, make)
      expect(drawOnKc(EXT, seed, make)).toEqual(a)
      const want = Array.from({ length: ON_KC_DRAWS }, (_, k) => onKcSeed(seed, EXT, k)).find(fits)
      expect(a?.seed).toBe(want)
      if (a) expect(a.kcs).toContain(EXT)
    }
  })

  test('when no draw fits it serves nothing, after exactly ON_KC_DRAWS draws', () => {
    let calls = 0
    expect(drawOnKc(EXT, 9, (s) => (calls++, inst(s, ['t0.locality'])))).toBeNull()
    expect(calls).toBe(ON_KC_DRAWS)
    expect(ON_KC_DRAWS).toBe(16)
  })

  test('a make that serves nothing ends the draw', () => {
    let calls = 0
    expect(drawOnKc(EXT, 9, () => (calls++, null))).toBeNull()
    expect(calls).toBe(1)
  })

  test('a make that throws propagates its error unchanged, and nothing is drawn after it', () => {
    class NotReady extends Error {}
    const err = new NotReady('load the group first')
    let calls = 0
    const make = (s: number) => {
      calls++
      if (calls === 3) throw err
      return inst(s, ['t0.locality'])
    }
    let caught: unknown
    try {
      drawOnKc(EXT, 9, make)
    } catch (e) {
      caught = e
    }
    expect(caught).toBe(err)
    expect(calls).toBe(3)
  })
})

describe('the pools', () => {
  test('a family whose instance carries the KC on its seed serves the same instance as before the redraw, in Today and in tickets', () => {
    // every gen link of the graph: where the seed's own instance is on-KC, both pools serve exactly it
    for (const k of KCS) {
      for (const fam of k.gen ?? []) {
        const gen = gens.get(fam)
        if (!gen) continue
        const pool = makeGenPool(gens, () => [fam])
        for (const level of LEVELS) {
          const offered = gen.variants.filter((v) => v.kcs.includes(k.id) && v.levels.includes(level))
          if (offered.length === 0) continue
          for (let i = 0; i < (fam === 'sig' ? 6 : 20); i++) {
            const seed = (i * 2654435761) >>> 0
            const before = gen.make(seed, level, offered[seed % offered.length].id)
            if (!before.kcs.includes(k.id)) continue
            expect(makeInstance(gen, k.id, level, seed)).toEqual(before)
            expect(pool.make(fam, k.id, level, seed)).toEqual({ source: 'gen', inst: before })
          }
        }
      }
    }
  })

  test('the links whose seed alone can miss the KC are the four sig fault KCs, kv below level 3 for GQA, and memory below level 3 for quantized bytes', () => {
    const misses = new Set<string>()
    for (const k of KCS) {
      for (const fam of k.gen ?? []) {
        const gen = gens.get(fam)
        if (!gen) continue
        for (const level of LEVELS) {
          const offered = gen.variants.filter((v) => v.kcs.includes(k.id) && v.levels.includes(level))
          for (let i = 0; i < (fam === 'sig' ? 12 : 20) && offered.length > 0; i++) {
            const seed = (i * 2654435761) >>> 0
            if (!gen.make(seed, level, offered[seed % offered.length].id).kcs.includes(k.id)) misses.add(`${k.id} ${fam}`)
          }
        }
      }
    }
    expect([...misses].sort()).toEqual([
      't2.admission-scheduling sig',
      't4.quantized-bytes memory',
      't5.gqa-kv-heads kv',
      't5.kv-capacity sig',
      't5.prefill-decode-interference sig',
      't7.capacity-planning sig',
    ])
  })

  test('every instance either pool serves carries the KC it was asked for, on every link, level and seed', () => {
    for (const k of KCS) {
      for (const fam of k.gen ?? []) {
        const gen = gens.get(fam)
        if (!gen) continue
        const pool = makeGenPool(gens, () => [fam])
        for (const level of LEVELS) {
          for (let i = 0; i < (fam === 'sig' ? 6 : 20); i++) {
            const seed = (i * 2654435761 + 1) >>> 0
            const a = makeInstance(gen, k.id, level, seed)
            if (a) expect(a.kcs).toContain(k.id)
            const b = pool.make(fam, k.id, level, seed)
            if (b?.source === 'gen') expect(b.inst.kcs).toContain(k.id)
          }
        }
      }
    }
  })

  test('kv below level 3 never carries GQA, so a GQA card there gets no kv item (the authored items serve it); at level 3 it does', () => {
    const kv = gens.get('kv') as Gen
    for (let seed = 0; seed < 20; seed++) {
      for (const level of [0, 1, 2] as const) expect(makeInstance(kv, 't5.gqa-kv-heads', level, seed)).toBeNull()
      expect(makeInstance(kv, 't5.gqa-kv-heads', 3, seed)?.kcs).toContain('t5.gqa-kv-heads')
    }
  })

  test('a redrawn instance replays from the seed it records', () => {
    const sig = gens.get('sig') as Gen
    let redrawn = 0
    for (let seed = 1; seed < 12; seed++) {
      const got = makeInstance(sig, 't2.admission-scheduling', 2, seed)
      if (!got) continue
      if (got.seed !== seed) redrawn++
      expect(sig.make(got.seed, got.level, got.variant)).toEqual(got)
    }
    expect(redrawn).toBeGreaterThan(0)
  })

  test('a family that carries the KC on one seed in four is redrawn the same way in Today and in tickets', () => {
    const frag = gens.get('frag') as Gen
    const fake = bySeed(frag, EXT, 4)
    const pool = makeGenPool(new Map([[fake.id, fake]]), () => [fake.id])
    for (let seed = 0; seed < 100; seed++) {
      const a = makeInstance(fake, EXT, 1, seed)
      const b = pool.make(fake.id, EXT, 1, seed)
      expect(b).toEqual(a === null ? null : { source: 'gen', inst: a })
      if (a) expect(a.kcs).toEqual([EXT])
    }
  })

  test('a family that never carries the KC serves nothing in either pool', () => {
    const frag = gens.get('frag') as Gen
    const never = bySeed(frag, EXT, Number.MAX_SAFE_INTEGER)
    const pool = makeGenPool(new Map([[never.id, never]]), () => [never.id])
    for (let seed = 1; seed < 20; seed++) {
      expect(makeInstance(never, EXT, 1, seed)).toBeNull()
      expect(pool.make(never.id, EXT, 1, seed)).toBeNull()
    }
  })

  test('a family that throws is still served as nothing by the pools (their existing guard), after one call', () => {
    const frag = gens.get('frag') as Gen
    let calls = 0
    const broken: Gen = {
      ...frag,
      id: 'broken',
      make: () => {
        calls++
        throw new Error('broken')
      },
    }
    expect(makeInstance(broken, EXT, 1, 5)).toBeNull()
    expect(makeGenPool(new Map([['broken', broken]]), () => ['broken']).make('broken', EXT, 1, 5)).toBeNull()
    expect(calls).toBe(2)
  })
})
