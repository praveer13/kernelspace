import { describe, expect, test } from 'bun:test'
import { CLAIMS } from '../../src/data/claims'
import { KC, KC_GRAPH, REF_KCS, RUST_ANCHOR_KC, THRESHOLD_KCS } from '../../src/data/kc'
import { FORGE_LABS, type ForgeLab } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson } from '../../src/data/lessons/types'
import { gradeItem } from '../../src/lib/items/play'
import { prequestionItem } from '../../src/lib/learner/prequestions'
import type { Kc, KcGraph } from '../../src/lib/kc/types'
import { PENDING_FAMILIES, discoverAuthoredItems, discoverFamilies, verifyKc, type VerifyKcInput } from '../../scripts/verify-kc'

/** The real inputs, deep-copied so each test can break one thing. */
function input(over: Partial<VerifyKcInput> = {}): VerifyKcInput {
  return {
    graph: structuredClone(KC_GRAPH) as KcGraph,
    contract: Object.values(KC),
    thresholds: THRESHOLD_KCS,
    anchor: RUST_ANCHOR_KC,
    lessons: ALL_LESSONS,
    labs: FORGE_LABS,
    claims: new Set(CLAIMS.map((c) => c.id)),
    refMap: REF_KCS,
    families: [],
    pendingFamilies: PENDING_FAMILIES,
    items: [],
    ...over,
  }
}

const kcOf = (inp: VerifyKcInput, id: string): Kc => {
  const k = inp.graph.kcs.find((x) => x.id === id)
  if (!k) throw new Error(`no ${id}`)
  return k
}

/** A copy of the lessons with one lesson replaced by `edit(copy)`. */
function withLesson(id: string, edit: (l: Lesson) => void): Lesson[] {
  return ALL_LESSONS.map((l) => {
    if (l.id !== id) return l
    const copy = structuredClone(l)
    edit(copy)
    return copy
  })
}

const tagQuiz = (l: Lesson, tags: (string[] | undefined)[]) => {
  for (const b of l.blocks) if (b.type === 'quiz') b.questions.forEach((q, i) => (q.kcs = tags[i]))
}

const errorsOf = (inp: VerifyKcInput) => verifyKc(inp).errors
const has = (errors: string[], pattern: RegExp) => errors.some((e) => pattern.test(e))

describe('verify-kc on the committed graph', () => {
  test('passes, with only the pending-family warnings', () => {
    const r = verifyKc(input())
    expect(r.errors).toEqual([])
    expect(r.warnings.every((w) => /^family (frag|kv|roofline):/.test(w))).toBe(true)
    expect(r.stats.pairing.every((p) => p.edges.length > 0)).toBe(true)
  })

  test('passes once the spec\'s three families land with their §5.5 KCs', () => {
    const families = [
      { id: 'frag', kcs: [KC.internalFrag, KC.externalFrag, KC.fixedBlocks, KC.placementPolicy] },
      { id: 'kv', kcs: [KC.kvBytesPerToken, KC.kvCapacity, KC.gqaKvHeads] },
      { id: 'roofline', kcs: [KC.ridgePoint, KC.boundClassification, KC.decodeBandwidth, KC.tilingIntensity] },
    ]
    const r = verifyKc(input({ families }))
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
  })

  test('passes once lab 01\'s checks carry the §4.5 tags', () => {
    const tags: Record<string, string[]> = {
      boot: [KC.allocatorContract, KC.enumsOptionResult],
      align: [KC.alignment],
      no_overlap: [KC.allocatorContract],
      coalesce: [KC.splitCoalesce],
      reuse: [KC.allocatorContract],
      fragmentation: [KC.externalFrag, KC.placementPolicy],
    }
    const labs: ForgeLab[] = FORGE_LABS.map((lab) =>
      lab.id === 'rust-allocator' ? { ...lab, checks: lab.checks.map((c) => ({ ...c, kcs: tags[c.id] })) } : lab,
    )
    expect(errorsOf(input({ labs }))).toEqual([])
  })

  test('discovery finds nothing in a missing directory', async () => {
    const nowhere = new URL('./no-such-dir/', import.meta.url)
    expect(await discoverFamilies(nowhere)).toEqual([])
    expect(await discoverAuthoredItems(nowhere)).toEqual([])
  })
})

describe('verify-kc fails on', () => {
  test('a missing contract id, a malformed id and a duplicate', () => {
    const inp = input()
    inp.graph = { ...inp.graph, kcs: inp.graph.kcs.filter((k) => k.id !== KC.alignment) }
    expect(has(errorsOf(inp), /t1\.alignment: contract id/)).toBe(true)

    const bad = input()
    kcOf(bad, 't0.wait-bars').id = 't0.Wait_Bars'
    expect(has(errorsOf(bad), /malformed id/)).toBe(true)

    const dup = input()
    dup.graph = { ...dup.graph, kcs: [...dup.graph.kcs, { ...kcOf(dup, 't0.wait-bars') }] }
    expect(has(errorsOf(dup), /t0\.wait-bars: duplicate id/)).toBe(true)
  })

  test('more than 200 KCs', () => {
    const inp = input()
    const filler = Array.from({ length: 140 }, (_, i): Kc => ({ ...kcOf(inp, 't0.wait-bars'), id: `t0.filler-${i}`, requires: [] }))
    inp.graph = { ...inp.graph, kcs: [...inp.graph.kcs, ...filler] }
    expect(has(errorsOf(inp), /exceeds the cap of 200/)).toBe(true)
  })

  test('dangling references, unknown lessons, claims, labs and families', () => {
    const inp = input()
    kcOf(inp, 't0.wait-bars').requires = ['t0.nope']
    kcOf(inp, 't0.flame-graphs').lessons = ['t0.l99']
    kcOf(inp, KC.ridgePoint).claims = ['hw.nope']
    kcOf(inp, KC.alignment).labs = ['no-such-lab']
    kcOf(inp, KC.tilingIntensity).gen = ['tiles']
    const errors = errorsOf(inp)
    for (const p of [/requires names unknown KC t0\.nope/, /unknown lesson t0\.l99/, /unknown claim hw\.nope/, /unknown lab no-such-lab/, /unknown generator family tiles/]) {
      expect({ p: p.source, hit: has(errors, p) }).toEqual({ p: p.source, hit: true })
    }
  })

  test('a cycle in requires, and one in requires ∪ contains', () => {
    const inp = input()
    kcOf(inp, 'r.bindings-expressions').requires = [KC.ownershipMoves]
    expect(has(errorsOf(inp), /requires: cycle .*r\.bindings-expressions/)).toBe(true)

    const both = input()
    kcOf(both, KC.ridgePoint).contains = [KC.boundClassification]
    expect(has(errorsOf(both), /requires ∪ contains: cycle/)).toBe(true)
  })

  test('an asymmetric confusable set, and one wider than 3', () => {
    const inp = input()
    kcOf(inp, 'r.lifetimes').confusable = []
    expect(has(errorsOf(inp), /r\.borrow-rules: confusable with r\.lifetimes, but/)).toBe(true)

    const wide = input()
    kcOf(wide, 't0.wait-bars').confusable = ['t0.flame-graphs', 't0.locality', 't0.cache-lines', 't0.data-layout']
    expect(has(errorsOf(wide), /confusable has 4 entries/)).toBe(true)
  })

  test('a threshold count other than 6 core plus 1 anchor', () => {
    const inp = input()
    delete kcOf(inp, KC.locality).threshold
    const errors = errorsOf(inp)
    expect(has(errors, /5 core KCs/)).toBe(true)
    expect(has(errors, /t0\.locality: listed in THRESHOLD_KCS/)).toBe(true)

    const two = input()
    kcOf(two, KC.ownershipMoves).threshold = 'anchor'
    expect(has(errorsOf(two), /2 anchor KCs/)).toBe(true)
  })

  test('an R lesson with no T-side dependant', () => {
    const inp = input()
    kcOf(inp, 't0.stride-traversal').requires = ['t0.cache-lines']
    expect(errorsOf(inp)).toContain('r.l2: no T-side KC requires a KC this R lesson introduces (the braid cannot place it)')
  })

  test('a notional card with too few rules, or a Wave 1 track without one', () => {
    const inp = input()
    inp.graph = { ...inp.graph, notional: inp.graph.notional.filter((n) => n.track !== 't1').map((n) => (n.track === 'r' ? { ...n, rules: n.rules.slice(0, 2) } : n)) }
    const errors = errorsOf(inp)
    expect(has(errors, /notional r: 2 rules/)).toBe(true)
    expect(has(errors, /notional t1: 0 cards/)).toBe(true)
  })

  test('migrations: a from that still exists, an unknown target, a repeated from, a loop', () => {
    const at = '2026-10-05'
    const why = 'test'
    const inp = input()
    inp.graph = {
      ...inp.graph,
      migrations: [
        { from: KC.locality, to: ['t0.cache-lines'], at, why },
        { from: 't0.gone', to: ['t0.nowhere'], at, why },
        { from: 't1.a', to: ['t1.b'], at, why },
        { from: 't1.b', to: ['t1.a'], at, why },
        { from: 't1.a', to: [KC.internalFrag], at, why },
      ],
    }
    const errors = errorsOf(inp)
    for (const p of [/migration t0\.locality: from is still a KC/, /target t0\.nowhere is neither/, /migration t1\.a: repeated from/, /chain loops: t1\.a → t1\.b → t1\.a/]) {
      expect({ p: p.source, hit: has(errors, p) }).toEqual({ p: p.source, hit: true })
    }
  })

  test('a ref-map entry naming an unknown KC', () => {
    expect(has(errorsOf(input({ refMap: { 'boot:ridge': ['t4.nope'] } })), /ref-map boot:ridge: unknown KC t4\.nope/)).toBe(true)
  })

  test('tags anywhere that name unknown KCs, even in lessons that have not opted in', () => {
    const lessons = withLesson('t3.l1', (l) => tagQuiz(l, [['t3.nope']]))
    expect(has(errorsOf(input({ lessons })), /quiz:t3\.l1#0: tags unknown KC t3\.nope/)).toBe(true)
  })
})

describe('coverage, for lessons that set Lesson.kcs', () => {
  test('a lesson without Lesson.kcs is not checked for untagged items', () => {
    expect(errorsOf(input())).toEqual([])
  })

  test('an opted-in lesson needs every checkpoint item tagged', () => {
    const lessons = withLesson('t2.l1', (l) => {
      l.kcs = ['t2.process-thread', 't2.context-switch']
      tagQuiz(l, [['t2.process-thread'], ['t2.context-switch']])
    })
    const errors = errorsOf(input({ lessons }))
    expect(errors).toContain('quiz:t2.l1#2: untagged checkpoint item in a lesson that sets Lesson.kcs')
    expect(errors).toContain('quiz:t2.l1#3: untagged checkpoint item in a lesson that sets Lesson.kcs')
  })

  test('a KC in Lesson.kcs needs 2 tagged items or a generator', () => {
    const lessons = withLesson('t2.l1', (l) => {
      l.kcs = ['t2.process-thread', 't2.context-switch']
      // the real t2.l1 has a ticket whose constructed responses add tagged items; this test counts quiz tags alone
      delete l.ticket
      tagQuiz(l, [['t2.process-thread'], ['t2.process-thread', 't2.context-switch'], ['t2.process-thread'], ['t2.process-thread']])
    })
    expect(errorsOf(input({ lessons }))).toEqual(['t2.context-switch: 1 tagged item(s) and no generator (want at least 2 items or a generator)'])

    const fixed = withLesson('t2.l1', (l) => {
      l.kcs = ['t2.process-thread', 't2.context-switch']
      tagQuiz(l, [['t2.process-thread'], ['t2.process-thread', 't2.context-switch'], ['t2.context-switch'], ['t2.process-thread']])
    })
    expect(errorsOf(input({ lessons: fixed }))).toEqual([])
  })

  test('a generator covers a KC with fewer than two items', () => {
    const lessons = withLesson('t1.l4', (l) => {
      l.kcs = [KC.externalFrag, KC.internalFrag, KC.fixedBlocks]
      tagQuiz(l, [[KC.externalFrag], [KC.internalFrag], [KC.fixedBlocks], [KC.externalFrag], [KC.fixedBlocks]])
    })
    expect(errorsOf(input({ lessons }))).toEqual([])
  })

  test('Lesson.kcs must hold 1-3 KCs that teach the lesson', () => {
    const lessons = withLesson('t2.l1', (l) => {
      l.kcs = ['t2.process-thread', KC.locality, 't2.context-switch', 't2.tlb']
      tagQuiz(l, [['t2.process-thread'], ['t2.process-thread'], ['t2.context-switch'], ['t2.context-switch']])
    })
    const errors = errorsOf(input({ lessons }))
    expect(has(errors, /t2\.l1: Lesson\.kcs has 4 KCs/)).toBe(true)
    expect(has(errors, /t2\.l1: Lesson\.kcs names t0\.locality, whose lessons do not include t2\.l1/)).toBe(true)
  })

  test('Lesson.kcs may name only KCs first taught in this lesson or an earlier one', () => {
    // the committed lessons are clean (the first test); t0.l1 once named two KCs that t4.l3 and t5.l7 introduce
    const lessons = withLesson('t0.l1', (l) => {
      l.kcs = ['t0.idea-reuse', KC.decodeBandwidth, KC.batchingThroughput]
    })
    const errors = errorsOf(input({ lessons }))
    expect(errors).toEqual([
      't0.l1: Lesson.kcs names t4.decode-bandwidth, first taught in t4.l3, later in curriculum order (name only KCs this lesson or an earlier one introduces)',
      't0.l1: Lesson.kcs names t5.batching-throughput, first taught in t5.l7, later in curriculum order (name only KCs this lesson or an earlier one introduces)',
    ])
    // a KC first taught earlier is fine: t0.l5 may name t0.idea-reuse, whose first lesson is t0.l1
    const earlier = withLesson('t0.l5', (l) => {
      l.kcs = ['t0.idea-reuse', 't0.runtime-costs']
    })
    expect(errorsOf(input({ lessons: earlier }))).toEqual([])
  })

  test('lab check tags must agree with the KCs\' labs', () => {
    const labs: ForgeLab[] = FORGE_LABS.map((lab) =>
      lab.id === 'rust-allocator' ? { ...lab, checks: lab.checks.map((c) => ({ ...c, kcs: c.id === 'align' ? [KC.locality] : undefined })) } : lab,
    )
    const errors = errorsOf(input({ labs }))
    expect(has(errors, /lab rust-allocator\/align: tags t0\.locality, whose labs do not name rust-allocator/)).toBe(true)
    expect(has(errors, /t1\.alignment: names lab rust-allocator, but no check of that lab tags it/)).toBe(true)
  })

  test('a lab whose check KCs miss a readiness lesson', () => {
    const inp = input()
    kcOf(inp, KC.allocatorContract).requires = ['t1.pointers']
    expect(has(errorsOf(inp), /lab rust-allocator: readiness lesson r\.l5 introduces no prerequisite/)).toBe(false) // r.enums-option-result is a check KC of the lab
    kcOf(inp, KC.enumsOptionResult).labs = []
    inp.labs = inp.labs.map((lab) =>
      lab.id === 'rust-allocator' ? { ...lab, checks: lab.checks.map((c) => ({ ...c, kcs: c.kcs?.filter((k) => k !== KC.enumsOptionResult) })) } : lab,
    )
    expect(has(errorsOf(inp), /lab rust-allocator: readiness lesson r\.l5 introduces no prerequisite/)).toBe(true)
  })

  test('a family whose Gen.kcs disagrees with the graph', () => {
    const families = [{ id: 'frag', kcs: [KC.internalFrag, KC.externalFrag, KC.fixedBlocks, KC.alignment] }]
    const errors = errorsOf(input({ families }))
    expect(has(errors, /family frag: Gen\.kcs names t1\.alignment, whose gen does not list frag/)).toBe(true)
    expect(has(errors, /t1\.placement-policy: gen lists frag, but that family's Gen\.kcs does not include it/)).toBe(true)
  })
})

describe('warnings', () => {
  test('a requires edge into a KC introduced later', () => {
    const inp = input()
    kcOf(inp, 't0.flame-graphs').requires = ['t2.context-switch']
    const r = verifyKc(inp)
    expect(r.errors).toEqual([])
    expect(r.warnings).toContain('t0.flame-graphs: requires t2.context-switch, introduced later (t2.l1 after t0.l6)')
  })

  test('a lesson whose KCs require nothing', () => {
    const inp = input()
    kcOf(inp, 't0.wait-bars').requires = []
    expect(verifyKc(inp).warnings).toContain('t0.l6: none of its KCs requires anything')
  })
})

describe('authored facts the final review caught (BF4)', () => {
  test('the fragmentation block-count prequestion grades the forgotten partial block (12) as wrong', () => {
    const l = ALL_LESSONS.find((x) => x.id === 't1.l4')
    const block = l?.blocks.find((b) => b.type === 'predict')
    if (block?.type !== 'predict') throw new Error('t1.l4 has no predict block')
    const i = block.items.findIndex((p) => p.kind === 'numeric')
    const p = block.items[i]
    if (p.kind !== 'numeric') throw new Error('no numeric prequestion')
    expect(p.truth).toBe(13)
    // 200 tokens in 16-token blocks: 12.5 rounds up, so 13; the tolerance must stay below 13/12
    expect(p.okWithinFactor).toBeLessThan(13 / 12)
    const item = prequestionItem('t1.l4', i, p)
    const ok = (value: number) => gradeItem(item, { kind: 'estimate', value }).ok
    expect([ok(12), ok(13), ok(14)]).toEqual([false, true, false])
  })

  test('stack-vs-heap never says a frame is released by a subtract (the subtract allocates; an add or leave releases)', () => {
    const l = ALL_LESSONS.find((x) => x.id === 't1.l1')
    const block = l?.blocks.find((b) => b.type === 'predict')
    if (block?.type !== 'predict') throw new Error('t1.l1 has no predict block')
    const text = JSON.stringify(block.items)
    expect(/releas\w*[^.]*subtract/i.test(text)).toBe(false)
    expect(text).toContain('one add to rsp')
  })
})
