import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import {
  checkFamily,
  checkHashes,
  checkInstance,
  genSeeds,
  hashFamily,
  isRound,
  lintLiterals,
  literalSelfTest,
  responseFromSolution,
  type HashRows,
} from '../../scripts/verify-generators'
import { claimRef, finishInstance, instanceRev, instanceText, makeRng, partsText, resolveVariant, rngFor, seedFor } from '../../src/lib/items/core'
import { gradeResponse } from '../../src/lib/items/grade'
import { familyIds, loadAllFamilies, loadFamily } from '../../src/lib/items/registry'
import type { Gen, Instance, Level } from '../../src/lib/items/types'
import { rev32, stableStringify } from '../../src/lib/ledger/stable'
import { splitmix32u } from '../../src/lib/rng'
import demo from './fixture-family'

const FAMILY_DIR = new URL('../../src/lib/items/families/', import.meta.url)
const hashFixture: HashRows = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../fixtures/items/hashes.json', import.meta.url), 'utf8')) as HashRows
  } catch {
    return {}
  }
})()

describe('seeds and the rng', () => {
  test('seedFor is splitmix32u(base ^ imul(i + 1, golden))() and spreads', () => {
    for (const [base, i] of [[1, 0], [0xdeadbeef, 7], [0xffffffff, 1000]] as const) {
      expect(seedFor(base, i)).toBe(splitmix32u(base ^ Math.imul(i + 1, 0x9e3779b9))())
    }
    const seen = new Set(Array.from({ length: 1000 }, (_, i) => seedFor(42, i)))
    expect(seen.size).toBe(1000)
    for (const s of seen) expect(s >= 0 && s <= 0xffffffff && Number.isInteger(s)).toBe(true)
    expect(seedFor(1, 3)).not.toBe(seedFor(2, 3))
  })

  test('makeRng is a deterministic stream', () => {
    const a = makeRng(7)
    const b = makeRng(7)
    for (let i = 0; i < 50; i++) expect(a.u32()).toBe(b.u32())
    expect(makeRng(7).u32()).not.toBe(makeRng(8).u32())
  })

  test('int covers its closed range and nothing else', () => {
    const rng = makeRng(1)
    const seen = new Set<number>()
    for (let i = 0; i < 2000; i++) seen.add(rng.int(3, 7))
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7])
    expect(rng.int(5, 5)).toBe(5)
    expect(() => rng.int(2, 1)).toThrow(RangeError)
    expect(() => rng.int(0.5, 2)).toThrow(RangeError)
  })

  test('pick, shuffle and sample', () => {
    const rng = makeRng(3)
    const xs = ['a', 'b', 'c', 'd', 'e']
    const picked = new Set(Array.from({ length: 500 }, () => rng.pick(xs)))
    expect(picked.size).toBe(5)
    const sh = rng.shuffle(xs)
    expect([...sh].sort()).toEqual(xs)
    expect(xs).toEqual(['a', 'b', 'c', 'd', 'e'])
    const sam = rng.sample(xs, 3)
    expect(new Set(sam).size).toBe(3)
    expect(() => rng.pick([])).toThrow(RangeError)
    expect(() => rng.sample(xs, 6)).toThrow(RangeError)
  })

  test('rngFor mixes the family, variant, level and seed', () => {
    const draw = (f: string, v: string, l: Level, s: number) => rngFor(f, v, l, s).u32()
    expect(draw('kv', 'a', 1, 5)).toBe(draw('kv', 'a', 1, 5))
    const distinct = new Set([draw('kv', 'a', 1, 5), draw('kv', 'b', 1, 5), draw('kv', 'a', 2, 5), draw('kv', 'a', 1, 6), draw('frag', 'a', 1, 5)])
    expect(distinct.size).toBe(5)
  })
})

describe('resolveVariant', () => {
  test('an explicit variant must exist and offer the level', () => {
    expect(resolveVariant(demo, 1, 2, 'capacity').id).toBe('capacity')
    expect(() => resolveVariant(demo, 1, 0, 'capacity')).toThrow(RangeError)
    expect(() => resolveVariant(demo, 1, 2, 'nope')).toThrow(RangeError)
  })

  test('without one, the seed picks among the variants that offer the level, reproducibly', () => {
    const picks = new Set<string>()
    for (const s of genSeeds(300)) {
      const v = resolveVariant(demo, s, 0)
      expect(v.levels.includes(0)).toBe(true)
      expect(resolveVariant(demo, s, 0).id).toBe(v.id)
      picks.add(v.id)
    }
    // at level 0 only two of the demo's three variants are offered
    expect([...picks].sort()).toEqual(['bytes-per-token', 'which-plane'])
    expect(() => resolveVariant({ id: 'x', variants: [] }, 1, 1)).toThrow(RangeError)
  })
})

describe('instances and fingerprints', () => {
  const base = demo.make(5, 2, 'bytes-per-token')

  test('rev is rev32 of the stable text of exactly {family, version, variant, level, params, claims}', () => {
    const { family, version, variant, level, params, claims } = base
    expect(base.rev).toBe(rev32({ family, version, variant, level, params, claims }))
    expect(instanceRev(base)).toBe(base.rev)
    // key order, and fields outside the fingerprint, change nothing
    const reordered = { ...base, params: Object.fromEntries(Object.entries(base.params).reverse()), nsec: 999, seed: 1 }
    expect(instanceRev(reordered)).toBe(base.rev)
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })

  test('a change to the params, the level, the version or a claim\'s verifiedAt gives a new rev', () => {
    const revs = new Set([
      base.rev,
      instanceRev({ ...base, params: { ...base.params, layers: 1234 } }),
      instanceRev({ ...base, level: 3 }),
      instanceRev({ ...base, version: base.version + 1 }),
      instanceRev({ ...base, claims: ['model.llama3-8b.layers@2027-01-01'] }),
      instanceRev({ ...base, variant: 'capacity' }),
    ])
    expect(revs.size).toBe(6)
  })

  test('claimRef is id@verifiedAt and an unknown claim throws', () => {
    expect(claimRef('model.llama3-8b.layers')).toMatch(/^model\.llama3-8b\.layers@\d{4}-\d{2}-\d{2}$/)
    expect(base.claims).toEqual([claimRef('model.llama3-8b.layers')])
    expect(() => claimRef('no.such.claim')).toThrow()
  })

  test('finishInstance sorts and dedupes claims and rejects a non-finite param', () => {
    const draft = { variant: 'v', seed: 1, level: 1 as Level, params: { a: 1 }, kcs: ['t5.kv-capacity'], prompt: { stem: [] }, answer: { kind: 'numeric' as const, truth: 1, unit: 'B', tolerance: { rel: 0.1 } }, nsec: 10 }
    const i = finishInstance({ id: 'f', version: 2 }, { ...draft, claims: ['b@2026-01-01', 'a@2026-01-01', 'b@2026-01-01'] })
    expect(i.claims).toEqual(['a@2026-01-01', 'b@2026-01-01'])
    expect(i.family).toBe('f')
    expect(i.version).toBe(2)
    expect(() => finishInstance({ id: 'f', version: 1 }, { ...draft, params: { a: Number.NaN } })).toThrow(RangeError)
    expect(() => finishInstance({ id: 'f', version: 1 }, { ...draft, params: { a: Infinity } })).toThrow(RangeError)
  })

  test('make is deterministic across calls, survives JSON, and differs across seeds and levels', () => {
    for (const seed of genSeeds(50)) {
      const a = demo.make(seed, 1, 'capacity')
      expect(demo.make(seed, 1, 'capacity')).toEqual(a)
      expect(JSON.parse(JSON.stringify(a))).toEqual(a)
    }
    expect(demo.make(1, 1, 'capacity').rev).not.toBe(demo.make(2, 1, 'capacity').rev)
    expect(demo.make(1, 1, 'capacity').params).not.toEqual(demo.make(1, 2, 'capacity').params)
  })

  test('prompt text renders values and claims, and resolves claim ids', () => {
    expect(partsText([{ t: 'text', text: 'A ' }, { t: 'value', value: 131072, unit: 'B' }, { t: 'text', text: ' and ' }, { t: 'value', value: 0.34, digits: 2, unit: '%' }])).toBe('A 131,072 B and 0.34 %')
    expect(partsText([{ t: 'claim', claim: 'model.llama3-8b.layers' }])).toBe('32')
    expect(partsText([{ t: 'claim', claim: 'model.llama3-8b.layers', scale: 2 }])).toBe('64')
    expect(partsText([{ t: 'code', code: 'let x = 1' }])).toBe('let x = 1')
    expect(() => partsText([{ t: 'claim', claim: 'no.such.claim' }])).toThrow()
    const text = instanceText(demo.make(1, 0, 'which-plane'))
    expect(text.some((t) => t === 'Both K and V')).toBe(true)
    expect(text.some((t) => t.includes('Attention reads K'))).toBe(true)
  })
})

describe('the registry', () => {
  const names = (): string[] => {
    try {
      return readdirSync(FAMILY_DIR).filter((n) => n.endsWith('.ts')).map((n) => n.slice(0, -3)).sort()
    } catch {
      return [] // no families yet
    }
  }
  const onDisk = names()

  test('discovers exactly the family files in the directory (zero is fine)', async () => {
    expect(await familyIds()).toEqual(onDisk)
  })

  test('loads each family lazily by id, with a matching Gen id, and caches it', async () => {
    for (const id of onDisk) {
      const gen = await loadFamily(id)
      expect(gen.id).toBe(id)
      expect(await loadFamily(id)).toBe(gen)
    }
    expect((await loadAllFamilies()).map((g) => g.id)).toEqual(onDisk)
  })

  test('an unknown family rejects, and a failed load is not cached', async () => {
    await expect(loadFamily('no-such-family')).rejects.toThrow('unknown generator family')
    await expect(loadFamily('no-such-family')).rejects.toThrow('unknown generator family')
  })

  test('every shipped family passes the whole §5.6 suite at 100 seeds', async () => {
    for (const gen of await loadAllFamilies()) {
      expect(checkFamily(gen, { seeds: 100 }).problems).toEqual([])
      expect(checkHashes(gen, hashFixture)).toEqual([])
    }
  })
})

describe('verify-generators: a sound family', () => {
  test('passes at 100 seeds with no problems and no dead rules', () => {
    const r = checkFamily(demo, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.instances).toBe(100 * (4 + 3 + 4))
    expect(r.p95Ms).toBeLessThan(1)
  })

  test('the solution\'s final result is a gradable response', () => {
    const i = demo.make(3, 2, 'capacity')
    const r = responseFromSolution(i, demo.solution(i))!
    expect(r.kind).toBe('estimate')
    expect(gradeResponse(i, r).score).toBe(1)
    expect(responseFromSolution(i, [])).toBeUndefined()
    const c = demo.make(3, 2, 'which-plane')
    expect(responseFromSolution(c, [])).toEqual({ kind: 'choice', picks: ['kv'] })
  })

  test('genSeeds starts with the uint32 extremes and is stable', () => {
    const s = genSeeds(1000)
    expect(s.slice(0, 2)).toEqual([0, 0xffffffff])
    expect(s).toHaveLength(1000)
    expect(new Set(s).size).toBe(1000)
    expect(genSeeds(1000)).toEqual(s)
  })
})

/** The suite must fail when a family is broken, one defect at a time. */
describe('verify-generators: it catches each defect', () => {
  const run = (patch: Partial<Gen>, opts: { speed?: boolean } = { speed: false }) => checkFamily({ ...demo, ...patch }, { seeds: 60, ...opts })
  const says = (patch: Partial<Gen>, needle: RegExp, opts?: { speed?: boolean }) => {
    const r = run(patch, opts)
    expect(r.problems.some((p) => needle.test(p))).toBe(true)
    return r
  }
  const fromDemo = (fn: (i: Instance) => Instance): Partial<Gen> => ({ make: (s, l, v) => fn(demo.make(s, l, v)) })
  const refinish = (i: Instance, over: Partial<Instance>): Instance => ({ ...i, ...over, rev: instanceRev({ ...i, ...over }) })

  test('a make that is not deterministic', () => {
    let n = 0
    says({ make: (s, l, v) => refinish(demo.make(s, l, v), { params: { ...demo.make(s, l, v).params, n: n++ } }) }, /make twice gives different instances/)
  })

  test('an instance that does not survive JSON', () => {
    says(fromDemo((i) => ({ ...i, prompt: { ...i.prompt, givens: undefined } })), /JSON round-trip/)
  })

  test('a rev that is not the fingerprint', () => {
    says(fromDemo((i) => ({ ...i, rev: 'zzz' })), /does not match its fingerprint/)
  })

  test('the wrong family, version, variant, level or seed echoed back', () => {
    says(fromDemo((i) => ({ ...i, family: 'other' })), /family is "other"/)
    says(fromDemo((i) => ({ ...i, version: 9 })), /version is 9/)
    says(fromDemo((i) => ({ ...i, seed: i.seed === 5 ? 6 : 5 })), /carries variant/)
  })

  test('kcs outside the family, and a non-positive nsec', () => {
    says(fromDemo((i) => refinish(i, { kcs: ['t9.nope'] })), /kcs \["t9.nope"\]/)
    says(fromDemo((i) => ({ ...i, nsec: 0 })), /nsec 0/)
  })

  test('a claim not written id@date', () => {
    says(fromDemo((i) => refinish(i, { claims: ['model.llama3-8b.layers'] })), /is not id@YYYY-MM-DD/)
  })

  test('a truth that is zero, negative or NaN', () => {
    for (const truth of [0, -5, Number.NaN, Infinity]) {
      says(fromDemo((i) => (i.answer.kind === 'numeric' ? { ...i, answer: { ...i.answer, truth } } : i)), /truth .* must be finite and > 0/)
    }
  })

  test('NaN, Infinity or undefined in the rendered text', () => {
    for (const bad of ['NaN', 'Infinity', 'undefined']) {
      says(fromDemo((i) => ({ ...i, prompt: { stem: [{ t: 'text', text: `Bytes: ${bad}` }] } })), /rendered text contains/)
    }
    says(fromDemo((i) => ({ ...i, prompt: { stem: [{ t: 'value', value: Number.NaN }] } })), /rendered text contains/)
  })

  test('choice options: too few, duplicated, no why, correct id missing', () => {
    const choice = (patch: (a: Extract<Instance['answer'], { kind: 'choice' }>) => Partial<Extract<Instance['answer'], { kind: 'choice' }>>): Partial<Gen> =>
      fromDemo((i) => (i.answer.kind === 'choice' ? refinish(i, { answer: { ...i.answer, ...patch(i.answer) } }) : i))
    says(choice((a) => ({ options: a.options.slice(0, 1) })), /needs at least 2/)
    says(choice((a) => ({ options: [a.options[0], { ...a.options[1], text: a.options[0].text }, a.options[2]] })), /texts are not distinct/)
    says(choice((a) => ({ options: [a.options[0], { ...a.options[1], id: a.options[0].id }, a.options[2]] })), /ids are not distinct/)
    says(choice((a) => ({ options: [{ ...a.options[0], why: '' }, ...a.options.slice(1)] })), /has no why/)
    says(choice(() => ({ correct: ['zzz'] })), /correct ids are not among the options/)
    says(choice(() => ({ correct: ['kv', 'k'] })), /exactly one correct id/)
  })

  test('a key that is usually the longest option', () => {
    const longKey = fromDemo((i) =>
      i.answer.kind === 'choice'
        ? refinish(i, { answer: { ...i.answer, options: i.answer.options.map((o) => (o.id === 'kv' ? { ...o, text: `${o.text}, which is what the cache stores and reads back at every step` } : o)) } })
        : i,
    )
    says(longKey, /strictly the longest option/)
  })

  test('a solution that does not grade as right, and one with no result', () => {
    says({ solution: (i) => demo.solution(i).map((s) => (s.result ? { ...s, result: { ...s.result, value: s.result.value * 3 } } : s)) }, /solution's own result grades ok=false/)
    says({ solution: () => [{ text: [{ t: 'text', text: 'no result here' }] }] }, /no solution step carries a result/)
    says({ solution: () => [] }, /solution is empty/)
  })

  test('a grade that never applies the family\'s ratio rules', () => {
    says({ grade: (i, r) => gradeResponse(i, r, []) }, /rule demo\./)
  })

  test('a grade that throws, or returns a score outside [0, 1]', () => {
    says({ grade: () => { throw new Error('boom') } }, /grade threw boom/)
    says({ grade: (i, r) => ({ ...gradeResponse(i, r, demo.ratioRules), score: 2 }) }, /outside \[0, 1\]|grades ok=true score=2/)
  })

  test('a grade that throws only on hostile input', () => {
    says({ grade: (i, r) => { if (r.kind === 'numeric' && !Number.isFinite(r.value)) throw new Error('nan'); return gradeResponse(i, r, demo.ratioRules) } }, /grade threw nan/)
  })

  test('a ratio of exactly 1 claimed as a slip', () => {
    says({ ratioRules: [...demo.ratioRules, { id: 'demo.identity', ratio: 1, message: 'x' }] }, /ratio of exactly 1/)
  })

  test('ratio rule ids must be unique and carry the family prefix', () => {
    says({ ratioRules: [...demo.ratioRules, demo.ratioRules[0]] }, /declared twice/)
    says({ ratioRules: [{ id: 'other.rule', ratio: 3, message: 'm' }] }, /must start with "demo\."/)
  })

  test('a rule that never fires is a warning, not a failure', () => {
    const r = run({ ratioRules: [...demo.ratioRules, { id: 'demo.never', ratio: () => null, message: 'm' }] })
    expect(r.problems).toEqual([])
    expect(r.warnings.some((w) => /demo\.never never fired/.test(w))).toBe(true)
  })

  test('level-0 params that are not round', () => {
    says(fromDemo((i) => (i.level === 0 ? refinish(i, { params: { ...i.params, layers: 257 } }) : i)), /level-0 param layers=\d+ is not a round number/)
  })

  test('fewer than half the truths distinct', () => {
    says(fromDemo((i) => (i.answer.kind === 'numeric' ? refinish(i, { answer: { ...i.answer, truth: 4096 } }) : i)), /distinct truths/)
  })

  test('a pin that drifted, and a pin that is not numeric', () => {
    says({ pins: [{ ...demo.pins[0], truth: 131072 * 2 }] }, /the lesson says 262144/)
    says({ pins: [{ ...demo.pins[0], make: () => demo.make(1, 1, 'which-plane') }] }, /pins must be numeric or estimate/)
    says({ pins: [{ ...demo.pins[0], make: () => { throw new Error('gone') } }] }, /pin "[^"]+": threw gone/)
  })

  test('a family that is too slow', () => {
    const spin = (ms: number) => {
      const end = performance.now() + ms
      while (performance.now() < end);
    }
    // one variant at one level keeps the run short; the 2 ms spin is well over the 1 ms budget
    const one = { variants: [{ ...demo.variants[0], levels: [1] as const }], pins: [] }
    says({ ...one, make: (s, l, v) => { spin(2); return demo.make(s, l, v) } }, /p95 of make \+ grade/, { speed: true })
  })

  test('a variant whose kcs are missing from the family, or a family with none', () => {
    says({ kcs: ['t5.kv-bytes-per-token'] }, /kc t5\.kv-capacity is missing from the family/)
    says({ variants: [] }, /declares no variants/)
  })

  test('a make that throws', () => {
    says({ make: () => { throw new Error('nope') } }, /make threw nope/)
  })

  test('checkInstance reports a sound instance as clean', () => {
    expect(checkInstance(demo, demo.make(1, 2, 'capacity'), 'w')).toEqual([])
  })
})

describe('the hash fixture', () => {
  test('hashes are per variant, stable, and move with any change to the output', () => {
    const h = hashFamily(demo)
    expect(Object.keys(h).sort()).toEqual(['bytes-per-token', 'capacity', 'which-plane'])
    expect(hashFamily(demo)).toEqual(h)
    for (const v of Object.values(h)) expect(v).toMatch(/^[0-9a-f]{8}$/)
    expect(checkHashes(demo, { demo: h })).toEqual([])
    const bumped = { ...demo, version: 2, make: (s: number, l: Level, v?: string) => finishInstance({ id: 'demo', version: 2 }, { ...demo.make(s, l, v), claims: [] }) }
    expect(checkHashes(bumped, { demo: h }).length).toBe(3)
  })

  test('a missing family, a missing variant and a stale variant are all reported with the fix', () => {
    const h = hashFamily(demo)
    expect(checkHashes(demo, {})[0]).toContain('--update-hashes --family demo')
    const rest = Object.fromEntries(Object.entries(h).filter(([v]) => v !== 'capacity'))
    expect(checkHashes(demo, { demo: rest }).join('\n')).toContain('demo/capacity: no hash row')
    expect(checkHashes(demo, { demo: { ...h, gone: 'deadbeef' } }).join('\n')).toContain('demo/gone: fixture row for a variant that no longer exists')
  })
})

describe('the numeric-literal lint (§5.4)', () => {
  test('its own self-test passes', () => {
    expect(literalSelfTest()).toEqual([])
  })

  test('reports line and column of a stray literal, and is satisfied by SYNTHETIC, the allow-list or an annotation', () => {
    const src = ['const SYNTHETIC = { layers: 32 }', 'const x = a * 4096', 'const y = a * 8 // gen-literal-ok: bits per byte', 'const z = [0, 1, 2, 10, 100]'].join('\n')
    const found = lintLiterals('f.ts', src)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ line: 2, col: 15 })
    expect(found[0].message).toContain('4096')
  })

  test('isRound: two significant digits or a power of two', () => {
    for (const n of [1, 12, 40, 99, 100, 1500, 20000, 4096, 128, 0.5, 0.25, 0, 64]) expect(isRound(n)).toBe(true)
    for (const n of [257, 123, 1234, 0.123, 4097, Number.NaN, Infinity]) expect(isRound(n)).toBe(false)
  })
})
