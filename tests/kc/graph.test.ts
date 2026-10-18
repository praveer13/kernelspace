import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'
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
import { MAX_KCS, NOTIONAL_TRACKS } from '../../scripts/verify-kc'

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

describe('the graph', () => {
  test('defines every contract id from ids.ts', () => {
    for (const id of Object.values(KC)) expect(kcById(id)?.id).toBe(id)
  })

  test('is about 155 KCs and under the 200 cap (wave-2 §4.1), with unique well-formed ids', () => {
    expect(KCS.length).toBeGreaterThanOrEqual(145)
    expect(KCS.length).toBeLessThanOrEqual(MAX_KCS)
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

  test('the eight T3-T7 confusable pairs of 2a-11 are present', () => {
    const pairs: [string, string][] = [
      [KC.goodputCurve, KC.paretoFrontier],
      ['t3.futures-state-machines', 't3.wakers-executor'],
      ['t4.occupancy', 't4.coalescing'],
      [KC.batchingThroughput, KC.goodput],
      [KC.prefillDecodeInterference, 't5.pd-disaggregation'],
      [KC.speculativeDecoding, KC.specAcceptance],
      [KC.kvReadsVsCapacity, KC.moeActiveParams],
      [KC.epEconomics, KC.costPerMtok],
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

  test('every lesson is taught by at least two KCs, so Lesson.kcs can hold 2-3', () => {
    for (const l of ALL_LESSONS) {
      expect({ lesson: l.id, n: KCS.filter((k) => k.lessons.includes(l.id)).length >= 2 }).toEqual({ lesson: l.id, n: true })
    }
  })

  test('every T3-T7 lesson has 2+ KCs its Lesson.kcs may name, i.e. introduced there or earlier (wave-2 §4.1, §4.4)', () => {
    const order = new Map(ALL_LESSONS.map((l, i) => [l.id, i]))
    const t37 = ALL_LESSONS.filter((x) => ['t3', 't4', 't5', 't6', 't7'].includes(x.trackId))
    expect(t37).toHaveLength(40)
    for (const l of t37) {
      const at = order.get(l.id) as number
      const nameable = KCS.filter((k) => k.lessons.includes(l.id) && (order.get(k.lessons[0]) as number) <= at)
      expect({ lesson: l.id, ok: nameable.length >= 2 }).toEqual({ lesson: l.id, ok: true })
    }
  })

  test('no T3-T7 lesson introduces more than 3 KCs beyond the contract ids (merge siblings, wave-2 §4.1)', () => {
    const contract = new Set<string>(Object.values(KC))
    const over = ALL_LESSONS.filter((l) => ['t3', 't4', 't5', 't6', 't7'].includes(l.trackId))
      .map((l) => ({ lesson: l.id, n: KCS.filter((k) => k.lessons[0] === l.id && !contract.has(k.id)).length }))
      .filter((x) => x.n > 3)
    expect(over).toEqual([])
  })

  test('t6.l5 revisits t4.decode-bandwidth instead of a Blackwell-only copy of it (2a-11 review)', () => {
    expect(kcById(KC.decodeBandwidth)?.lessons).toContain('t6.l5')
    expect(KCS.filter((k) => k.lessons[0] === 't6.l5').map((k) => k.id).sort()).toEqual([KC.fp4Capacity, 't6.nvlink-domain'])
  })

  test('no requires edge points at a KC introduced later in curriculum order', () => {
    const order = new Map(ALL_LESSONS.map((l, i) => [l.id, i]))
    const index = indexKcs(KCS)
    const late = KCS.flatMap((k) =>
      k.lessons.length === 0
        ? []
        : k.requires.filter((r) => (order.get(index.get(r)?.lessons[0] ?? '') ?? -1) > (order.get(k.lessons[0]) as number)).map((r) => `${k.id} → ${r}`),
    )
    expect(late).toEqual([])
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

  test('nine notional machines, one per track (wave-2 §4.3), 3-6 rules and 2-4 ignores', () => {
    expect(NOTIONAL_TRACKS).toHaveLength(9)
    expect(KC_GRAPH.notional.map((n) => n.track).sort()).toEqual([...NOTIONAL_TRACKS].sort())
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

describe('the Wave 2 contract ids (§4.2)', () => {
  /** id → [introducing lesson, requires, labs] exactly as the §4.2 table lists them. */
  const TABLE: Record<string, [string, string[], string[]]> = {
    'r.permissions': ['r.l3', ['r.ownership-moves'], []],
    'r.analyzer-limits': ['r.l4', ['r.borrow-rules'], []],
    't3.unsafe-boundaries': ['t3.l2', ['r.analyzer-limits', 'r.slices'], []],
    't4.quantized-bytes': ['t4.l7', ['t4.decode-bandwidth'], []],
    't5.tokenizer-bytes': ['t5.l2', ['r.enums-option-result'], ['bpe-tokenizer']],
    't5.bpe-merges': ['t5.l2', ['t5.tokenizer-bytes', 'r.closures-collections'], ['bpe-tokenizer']],
    't5.block-tables': ['t5.l5', ['t2.address-translation', 'r.enums-option-result', 'r.iterators-ownership'], ['kv-block-manager']],
    't5.block-refcounts': ['t5.l5', ['t5.block-tables', 'r.smart-pointers'], ['kv-block-manager', 'radix-cache']],
    't5.kv-copy-on-write': ['t5.l5', ['t5.block-refcounts', 't2.copy-on-write'], ['kv-block-manager']],
    't5.attention-variants': ['t5.l4', ['t5.kv-bytes-per-token'], []],
    't5.kv-reads-vs-capacity': ['t5.l4', ['t5.attention-variants', 't4.decode-bandwidth'], []],
    't5.prefix-routing': ['t5.l6', ['t5.block-refcounts'], []],
    't5.continuous-batching': ['t5.l7', ['t5.batching-throughput', 't2.admission-scheduling'], ['batching-scheduler']],
    't5.admission-headroom': ['t5.l7', ['t5.continuous-batching', 't5.kv-capacity', 'r.enums-option-result'], ['batching-scheduler']],
    't5.sched-order': ['t5.l7', ['t5.continuous-batching'], ['batching-scheduler']],
    't5.prefill-decode-interference': ['t5.l8', ['t5.continuous-batching'], []],
    't5.speculative-decoding': ['t5.l8', ['t4.decode-bandwidth'], []],
    't6.moe-active-params': ['t6.l1', ['t4.quantized-bytes'], []],
    't6.ep-economics': ['t6.l2', ['t6.moe-active-params'], []],
    't6.parallel-memory': ['t6.l4', ['t4.quantized-bytes'], []],
    't6.fp4-capacity': ['t6.l5', ['t4.quantized-bytes'], []],
    't6.spec-acceptance': ['t6.l6', ['t5.speculative-decoding'], []],
    't6.agent-prefix-locality': ['t6.l8', ['t5.prefix-routing'], []],
    't6.lora-adapter-bytes': ['t6.l9', ['t4.quantized-bytes'], []],
    't7.slo-error-budget': ['t7.l1', [], []],
    't7.goodput': ['t7.l1', ['t7.slo-error-budget'], []],
    't7.goodput-curve': ['t7.l2', ['t7.goodput'], []],
    't7.pareto-frontier': ['t7.l3', ['t7.goodput-curve'], []],
    't7.cost-per-mtok': ['t7.l4', ['t7.goodput'], []],
    't7.capacity-planning': ['t7.l5', ['t7.goodput'], []],
    't7.incident-diagnosis': ['t7.l5', ['t7.slo-error-budget'], []],
  }

  test('all 31 are exported from ids.ts and defined', () => {
    expect(Object.keys(TABLE)).toHaveLength(31)
    const exported = new Set<string>(Object.values(KC))
    for (const id of Object.keys(TABLE)) {
      expect({ id, exported: exported.has(id) }).toEqual({ id, exported: true })
      expect(kcById(id)?.id).toBe(id)
    }
  })

  test('each has the introducing lesson, requires and labs the table lists', () => {
    for (const [id, [lesson, requires, labs]] of Object.entries(TABLE)) {
      const k = kcById(id)
      expect({ id, lesson: k?.lessons[0] }).toEqual({ id, lesson })
      expect({ id, requires: [...(k?.requires ?? [])].sort() }).toEqual({ id, requires: [...requires].sort() })
      expect({ id, labs: k?.labs ?? [] }).toEqual({ id, labs })
    }
  })

  test('every gen link of the family table is set, so a family lands without editing a KC file', () => {
    const families: Record<string, string[]> = {
      goodput: ['t7.goodput', 't7.goodput-curve', 't7.pareto-frontier', 't7.capacity-planning'],
      cost: ['t7.cost-per-mtok', 't6.ep-economics', 't6.agent-prefix-locality'],
      memory: ['t4.quantized-bytes', 't6.moe-active-params', 't6.parallel-memory', 't6.fp4-capacity', 't6.lora-adapter-bytes'],
      spec: ['t6.spec-acceptance', 't5.speculative-decoding'],
      sig: ['t7.incident-diagnosis', 't5.kv-capacity', 't2.admission-scheduling', 't7.capacity-planning', 't5.prefill-decode-interference'],
      compile: [
        'r.ownership-moves',
        'r.clone-copy-drop',
        'r.borrow-rules',
        'r.slices',
        'r.lifetimes',
        'r.interior-mutability',
        'r.permissions',
        'r.analyzer-limits',
      ],
    }
    for (const [family, ids] of Object.entries(families)) {
      expect({ family, kcs: KCS.filter((k) => k.gen?.includes(family)).map((k) => k.id).sort() }).toEqual({ family, kcs: [...ids].sort() })
    }
  })

  test('the R pairing edges: t1.ownership-answer requires r.permissions, t3.unsafe-boundaries requires r.analyzer-limits', () => {
    expect(kcById('t1.ownership-answer')?.requires).toContain(KC.permissions)
    expect(kcById(KC.unsafeBoundaries)?.requires).toContain(KC.analyzerLimits)
    const index = indexKcs(KCS)
    for (const lab of ['kv-block-manager', 'bpe-tokenizer']) {
      expect(KCS.filter((k) => k.labs?.includes(lab)).length).toBeGreaterThan(0)
    }
    // the readiness lessons each introduce a prerequisite of the lab's check KCs (§4.2, last note)
    const labReady: Record<string, string[]> = { 'kv-block-manager': ['r.l5', 'r.l6', 'r.l7'], 'bpe-tokenizer': ['r.l5', 'r.l6'] }
    for (const [lab, lessons] of Object.entries(labReady)) {
      const reach = new Set(KCS.filter((k) => k.labs?.includes(lab)).flatMap((k) => [k.id, ...prerequisitesOf(index, k.id)]))
      for (const l of lessons) expect({ lab, l, ok: kcsIntroducedIn(KCS, l).some((k) => reach.has(k.id)) }).toEqual({ lab, l, ok: true })
    }
  })
})

describe('the Wave 3 contract (§4.3)', () => {
  test('t4.raster-l2-reuse is a concept of t4.l6 that requires t4.tiling-intensity, and the lesson lists it third', () => {
    const k = kcById('t4.raster-l2-reuse')
    expect(k?.kind).toBe('concept')
    expect(k?.lessons).toEqual(['t4.l6'])
    expect(k?.requires).toEqual(['t4.tiling-intensity'])
    expect(Object.values(KC)).toContain('t4.raster-l2-reuse')
    expect(ALL_LESSONS.find((l) => l.id === 't4.l6')?.kcs).toEqual(['t4.tiling-intensity', 't4.flashattention-blocking', 't4.raster-l2-reuse'])
  })

  test('the graph holds 155 KCs', () => {
    expect(KCS).toHaveLength(155)
  })

  test('t6.l12 introduces t6.attention-ffn-split and revisits t6.epd-phases, the KC its prefill/pd-ratio block assesses (§16.2)', () => {
    const k = kcById(KC.attentionFfnSplit)
    expect(k?.lessons).toEqual(['t6.l12'])
    // its three benchmark claims are lazy, so they sit in the lesson's statline and not in the KC (§4.4; G4 of the 3s final review)
    expect(k?.claims).toBeUndefined()
    expect(kcById('t6.epd-phases')?.lessons).toEqual(['t6.l3', 't6.l12'])
    expect(ALL_LESSONS.find((l) => l.id === 't6.l12')?.kcs).toEqual([KC.attentionFfnSplit, 't6.epd-phases'])
  })

  test('every gen link of the tiling, prefill and rollout rows is set, so each family lands without editing a KC file', () => {
    const families: Record<string, string[]> = {
      tiling: ['t4.shared-memory-scratchpad', 't4.occupancy', 't4.raster-l2-reuse', 't4.ridge-point', 't4.flashattention-blocking'],
      prefill: ['t6.epd-phases', 't6.kv-tiering', 't6.cache-timing-oracle'],
      rollout: ['t6.rollout-bound-rl', 't6.weight-sync'],
    }
    for (const [family, ids] of Object.entries(families)) {
      expect({ family, kcs: KCS.filter((k) => k.gen?.includes(family)).map((k) => k.id).sort() }).toEqual({ family, kcs: [...ids].sort() })
    }
    expect(kcById('t4.ridge-point')?.gen).toContain('roofline')
  })

  test('no confusable set changes: t2.address-translation keeps its one Wave 1 partner', () => {
    expect(kcById('t2.address-translation')?.confusable).toEqual(['t2.pagedattention-as-paging'])
    expect(kcById('t5.block-tables')?.confusable ?? []).not.toContain('t2.address-translation')
    expect(kcById('t5.prefix-cache-keys')?.confusable ?? []).not.toContain('t5.block-tables')
  })

  // A cold process: tests share one module registry, so a lazy group another file registered would hide a KC claim that
  // only a lazy group holds. This runs the packet's own reader (claimsFor) in a fresh bun process that imports no group.
  test('no KC cites a claim that only a lazy group holds: on a cold load claimsFor returns one claim per KC claim id, t6.l12 included (§4.4)', () => {
    const script = `
      const { KCS } = await import('./src/data/kc')
      const { byId } = await import('./src/data/claims')
      const { claimsFor } = await import('./src/lib/mentor/packet')
      const lazy = []
      for (const k of KCS) for (const id of k.claims ?? []) if (byId[id] === undefined) lazy.push(k.id + ' ' + id)
      const l12 = await claimsFor({ lessonId: 't6.l12' })
      const l12ids = KCS.filter((k) => k.lessons.includes('t6.l12')).flatMap((k) => k.claims ?? [])
      console.log(JSON.stringify({ lazy, l12: l12.length, l12ids: l12ids.length }))
    `
    const r = Bun.spawnSync(['bun', '-e', script], { cwd: resolve(import.meta.dirname, '../..') })
    expect(r.stderr.toString()).toBe('')
    expect(JSON.parse(r.stdout.toString())).toEqual({ lazy: [], l12: 0, l12ids: 0 })
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
