import { describe, expect, test } from 'bun:test'
import { BOOT_KCS, KC, KC_GRAPH, KCS, REF_KCS, RUST_ANCHOR_KC, THRESHOLD_KCS, kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import { GRADED_STEPS } from '../../src/lib/boot/model'
import {
  applyMigrations,
  dependantsOf,
  findCycle,
  indexKcs,
  kcsIntroducedIn,
  prerequisitesOf,
  requiresAndContains,
  topoOrder,
} from '../../src/lib/kc/graph'
import type { Kc } from '../../src/lib/kc/types'

const kc = (id: string, requires: string[] = [], extra: Partial<Kc> = {}): Kc => ({
  id,
  title: id,
  can: `You can ${id}`,
  track: id.split('.')[0] as Kc['track'],
  kind: 'concept',
  lessons: [],
  requires,
  since: '2026-10-05',
  ...extra,
})

describe('the v1 graph', () => {
  test('defines every contract id from ids.ts', () => {
    for (const id of Object.values(KC)) expect(kcById(id)?.id).toBe(id)
  })

  test('is about 70 KCs, under the cap, with unique well-formed ids', () => {
    expect(KCS.length).toBeGreaterThanOrEqual(60)
    expect(KCS.length).toBeLessThanOrEqual(80)
    expect(new Set(KCS.map((k) => k.id)).size).toBe(KCS.length)
    for (const k of KCS) expect(k.id).toMatch(/^(r|t[0-7])\.[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  test('requires is a DAG, and so is requires ∪ contains', () => {
    expect(findCycle(KCS)).toBeNull()
    expect(findCycle(KCS, requiresAndContains)).toBeNull()
  })

  test('confusable sets are symmetric and at most 3 wide', () => {
    for (const k of KCS) {
      expect((k.confusable ?? []).length).toBeLessThanOrEqual(3)
      for (const other of k.confusable ?? []) expect(kcById(other)?.confusable).toContain(k.id)
    }
  })

  test('the spec\'s seven confusable pairs are all present (§4.9)', () => {
    const pairs: [string, string][] = [
      [KC.addressTranslation, 't2.pagedattention-as-paging'],
      [KC.internalFrag, KC.externalFrag],
      [KC.ownershipMoves, KC.borrowRules],
      ['r.smart-pointers', 'r.interior-mutability'],
      ['t2.mutex-atomics', 'r.atomics-ordering'],
      ['t0.cache-lines', 't0.false-sharing'],
      [KC.ridgePoint, KC.decodeBandwidth],
    ]
    for (const [a, b] of pairs) expect(kcById(a)?.confusable).toContain(b)
  })

  test('six core thresholds in THRESHOLD_KCS order of their lessons, plus the Rust anchor', () => {
    const core = KCS.filter((k) => k.threshold === 'core').map((k) => k.id)
    expect(new Set(core)).toEqual(new Set(THRESHOLD_KCS))
    expect(KCS.filter((k) => k.threshold === 'anchor').map((k) => k.id)).toEqual([RUST_ANCHOR_KC])
    // §4.4: introduced at t0.l2, t1.l4, t2.l2, t2.l4, t4.l3, t5.l4
    expect(THRESHOLD_KCS.map((id) => kcById(id)?.lessons[0])).toEqual(['t0.l2', 't1.l4', 't2.l2', 't2.l4', 't4.l3', 't5.l4'])
    expect(kcById(RUST_ANCHOR_KC)?.lessons[0]).toBe('r.l4')
  })

  test('every lesson a KC names exists, and only the lab-only KC has none', () => {
    const ids = new Set(ALL_LESSONS.map((l) => l.id))
    for (const k of KCS) for (const l of k.lessons) expect(ids.has(l)).toBe(true)
    expect(KCS.filter((k) => k.lessons.length === 0).map((k) => k.id)).toEqual([KC.alignment])
  })

  test('every R and T0-T2 lesson is taught by at least two KCs, so Lesson.kcs can hold 2-3', () => {
    for (const l of ALL_LESSONS.filter((x) => ['r', 't0', 't1', 't2'].includes(x.trackId))) {
      expect({ lesson: l.id, n: KCS.filter((k) => k.lessons.includes(l.id)).length >= 2 }).toEqual({ lesson: l.id, n: true })
    }
  })

  test('each R lesson has a T-side dependant (§4.3), and the pairing runs in R order', () => {
    const order = new Map(ALL_LESSONS.map((l, i) => [l.id, i]))
    const firstDependant: number[] = []
    for (let n = 1; n <= 10; n++) {
      const introduced = kcsIntroducedIn(KCS, `r.l${n}`)
      const dependants = introduced.flatMap((k) => dependantsOf(KCS, k.id)).filter((d) => d.track !== 'r')
      expect({ lesson: `r.l${n}`, paired: dependants.length > 0 }).toEqual({ lesson: `r.l${n}`, paired: true })
      firstDependant.push(Math.min(...dependants.map((d) => order.get(d.lessons[0]) ?? Infinity)))
    }
    // r.l1-r.l8 pair in curriculum order; r.l10 (t2.aba, t2.l5) lands before r.l9 (t2.async-tasks, t2.l6)
    for (let i = 1; i < 8; i++) expect(firstDependant[i]).toBeGreaterThanOrEqual(firstDependant[i - 1])
  })

  test('lab 01\'s KCs reach every readiness lesson r.l1-r.l5 through requires', () => {
    const index = indexKcs(KCS)
    const reach = new Set(KCS.filter((k) => k.labs?.includes('rust-allocator')).flatMap((k) => [k.id, ...prerequisitesOf(index, k.id)]))
    for (const l of ['r.l1', 'r.l2', 'r.l3', 'r.l4', 'r.l5']) {
      expect(kcsIntroducedIn(KCS, l).some((k) => reach.has(k.id))).toBe(true)
    }
  })

  test('lab 01\'s check KCs from the §4.5 table all name the lab', () => {
    for (const id of [KC.allocatorContract, KC.enumsOptionResult, KC.alignment, KC.splitCoalesce, KC.externalFrag, KC.placementPolicy]) {
      expect(kcById(id)?.labs).toContain('rust-allocator')
    }
  })

  test('each family\'s spec KCs (§5.5) name that family', () => {
    const families: Record<string, string[]> = {
      frag: [KC.internalFrag, KC.externalFrag, KC.fixedBlocks, KC.placementPolicy],
      kv: [KC.kvBytesPerToken, KC.kvCapacity, KC.gqaKvHeads],
      roofline: [KC.ridgePoint, KC.boundClassification, KC.decodeBandwidth, KC.tilingIntensity],
    }
    for (const [family, ids] of Object.entries(families)) {
      expect(KCS.filter((k) => k.gen?.includes(family)).map((k) => k.id).sort()).toEqual([...ids].sort())
    }
  })

  test('four notional machines, one per Wave 1 track, 3-6 rules and 2-4 ignores', () => {
    expect(KC_GRAPH.notional.map((n) => n.track).sort()).toEqual(['r', 't0', 't1', 't2'])
    for (const n of KC_GRAPH.notional) {
      expect(n.rules.length).toBeGreaterThanOrEqual(3)
      expect(n.rules.length).toBeLessThanOrEqual(6)
      expect(n.ignores.length).toBeGreaterThanOrEqual(2)
      expect(n.ignores.length).toBeLessThanOrEqual(4)
    }
  })

  test('the ref map covers every graded Boot step, and Boot earns four KCs', () => {
    for (const step of GRADED_STEPS) expect(REF_KCS[`boot:${step}`]?.length).toBeGreaterThan(0)
    expect(new Set(Object.values(REF_KCS).flat())).toEqual(new Set(BOOT_KCS))
    expect(BOOT_KCS).toHaveLength(4)
  })
})

describe('graph utilities', () => {
  test('findCycle returns a closed path, and skips dangling edges', () => {
    const kcs = [kc('t0.a', ['t0.b']), kc('t0.b', ['t0.c', 't0.missing']), kc('t0.c', ['t0.a'])]
    expect(findCycle(kcs)).toEqual(['t0.a', 't0.b', 't0.c', 't0.a'])
    expect(findCycle([kc('t0.a', ['t0.missing'])])).toBeNull()
    expect(findCycle([kc('t0.a', ['t0.a'])])).toEqual(['t0.a', 't0.a'])
  })

  test('requiresAndContains catches a cycle that requires alone does not', () => {
    const kcs = [kc('t0.a', ['t0.b']), kc('t0.b', [], { contains: ['t0.a'] })]
    expect(findCycle(kcs)).toBeNull()
    expect(findCycle(kcs, requiresAndContains)).toEqual(['t0.a', 't0.b', 't0.a'])
  })

  test('topoOrder puts prerequisites first and keeps input order among ready KCs', () => {
    const kcs = [kc('t0.c', ['t0.a']), kc('t0.b'), kc('t0.a'), kc('t0.d', ['t0.c', 't0.b'])]
    expect(topoOrder(kcs).map((k) => k.id)).toEqual(['t0.b', 't0.a', 't0.c', 't0.d'])
    expect(() => topoOrder([kc('t0.a', ['t0.b']), kc('t0.b', ['t0.a'])])).toThrow(/cycle/)
  })

  test('topoOrder over the real graph respects every requires edge', () => {
    const at = new Map(topoOrder(KCS).map((k, i) => [k.id, i]))
    expect(at.size).toBe(KCS.length)
    for (const k of KCS) for (const r of k.requires) expect(at.get(r) as number).toBeLessThan(at.get(k.id) as number)
  })

  test('prerequisitesOf is transitive and excludes the KC itself', () => {
    const index = indexKcs([kc('t0.a'), kc('t0.b', ['t0.a']), kc('t0.c', ['t0.b', 't0.a'])])
    expect(prerequisitesOf(index, 't0.c')).toEqual(['t0.b', 't0.a'])
    expect(prerequisitesOf(index, 't0.a')).toEqual([])
  })

  test('applyMigrations: rename, split, merge, chain, loop guard and de-duplication', () => {
    const at = '2026-10-05'
    const why = 'test'
    expect(applyMigrations(['t1.old'], [{ from: 't1.old', to: ['t1.new'], at, why }])).toEqual(['t1.new'])
    expect(applyMigrations(['t1.big'], [{ from: 't1.big', to: ['t1.x', 't1.y'], at, why }])).toEqual(['t1.x', 't1.y'])
    const merge = [
      { from: 't1.p', to: ['t1.m'], at, why },
      { from: 't1.q', to: ['t1.m'], at, why },
    ]
    expect(applyMigrations(['t1.p', 't1.q'], merge)).toEqual(['t1.m'])
    const chain = [
      { from: 't1.a', to: ['t1.b'], at, why },
      { from: 't1.b', to: ['t1.c'], at, why },
    ]
    expect(applyMigrations(['t1.a', 't1.c', 't1.z'], chain)).toEqual(['t1.c', 't1.z'])
    const loop = [
      { from: 't1.a', to: ['t1.b'], at, why },
      { from: 't1.b', to: ['t1.a'], at, why },
    ]
    expect(applyMigrations(['t1.a'], loop)).toEqual(['t1.a'])
    expect(applyMigrations(['t1.a', 't1.a'], [])).toEqual(['t1.a'])
  })
})
