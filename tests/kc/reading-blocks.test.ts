/**
 * Serving-first reading blocks B1-B7 are where the promise says (docs/specs/serving-reading.md §5.3, M1 item 1, SR-06).
 *
 * `readingCoverage()` is exported for SR-07's copy test, so Boot's blurb and the blocks cannot drift apart. It holds:
 * every direct edge from a serving-first lesson's KCs to an R KC is covered by a reading block in that lesson (except
 * the deferred `r.bindings-expressions`, Q3); every block KC is in D(L) or the one on-page clause (SR-D3); every
 * variant is a declared block-only compile variant; the first `count` draws cover the direct-edge KCs and include
 * both kinds; every block sits after every index-keyed block of its host and before the quiz; the keyed blocks'
 * indices equal a frozen map (an insertion that shifted one would orphan its ledger refs); and the hosts are exactly
 * the seven the spec names. `outcomes.ts` keeps its own literals (SR-08), and this file holds them to the blocks and
 * to `READING_KCS`.
 */
import { describe, expect, test } from 'bun:test'
import { KCS, kcById } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Block, Lesson, ReadingBlock } from '../../src/data/lessons/types'
import { READING_KCS } from '../../src/data/rust-items/constants'
import compile from '../../src/lib/items/families/compile'
import { SERVING_READING_HOSTS, SERVING_READING_KCS } from '../../src/lib/learner/outcomes'
import { pathPlan, type PathGraph } from '../../src/lib/learner/paths'

const GRAPH: PathGraph = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }

/** Deferred by Q3: t0.l2 has no Rust on the page, so its edge to `r.bindings-expressions` has no block. */
export const DEFERRED: readonly string[] = ['r.bindings-expressions']
/** The one on-page clause (SR-D3): `prefix_router.rs` (prefix-caching.ts, the `code` block above B3) builds closures over `guard` and `workers`. */
export const ON_PAGE: Readonly<Record<string, readonly string[]>> = { 't5.l6': ['r.closures-collections'] }
/** Block indices of the keyed blocks of the seven hosts at the base: diagram predictions, item blocks and Fleet exercises. */
export const KEYED: Readonly<Record<string, readonly number[]>> = {
  't5.l2': [],
  't5.l5': [3],
  't5.l6': [4],
  't5.l7': [3],
  't5.l10': [],
  't6.l8': [2],
  't6.l9': [4],
}
/** Where each block sits in its host, and what it asks for: B1-B7 of §5.3. */
export const BLOCKS: Readonly<Record<string, { at: number; count: number }>> = {
  't5.l2': { at: 3, count: 2 },
  't5.l5': { at: 6, count: 3 },
  't5.l6': { at: 8, count: 3 },
  't5.l7': { at: 5, count: 2 },
  't5.l10': { at: 7, count: 2 },
  't6.l8': { at: 4, count: 2 },
  't6.l9': { at: 8, count: 2 },
}

const lessonOf = (id: string): Lesson => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`no lesson ${id}`)
  return l
}
const isReading = (b: Block): b is ReadingBlock => b.type === 'reading'
const readingOf = (l: Lesson): ReadingBlock[] => l.blocks.filter(isReading)
/** Indices of the blocks that key their ledger events on their position: diagram predictions, item blocks and Fleet exercises. */
const keyedIndices = (l: Lesson): number[] =>
  l.blocks.flatMap((b, i) => (b.type === 'diagram' && b.predictAt !== undefined) || b.type === 'item' || (b.type === 'exercise' && 'fleet' in b) ? [i] : [])

/** The R KCs a lesson's KCs need directly. */
const directEdges = (l: Lesson): string[] => [...new Set((l.kcs ?? []).flatMap((k) => (kcById(k)?.requires ?? []).filter((r) => r.startsWith('r.'))))]

/** D(L): the R KCs needed directly by L's KCs, or by a T5-T7 KC reachable from them through T5-T7 edges. */
function reachable(l: Lesson): Set<string> {
  const seen = new Set<string>()
  const out = new Set<string>()
  const stack = [...(l.kcs ?? [])]
  while (stack.length > 0) {
    const k = stack.pop() as string
    if (seen.has(k)) continue
    seen.add(k)
    for (const r of kcById(k)?.requires ?? []) {
      if (r.startsWith('r.')) out.add(r)
      else if (/^t[567]\./.test(r)) stack.push(r)
    }
  }
  return out
}

const kindOf = (variant: string): string => variant.split('.')[0]
const specOf = (variant: string) => compile.variants.find((v) => v.id === variant)

/** Every problem the blocks have against the spec; an empty list is a pass. */
export function readingCoverage(): { problems: string[]; hosts: string[] } {
  const problems: string[] = []
  const plan = pathPlan('serving-first', GRAPH).lessons
  const hosts = ALL_LESSONS.filter((l) => readingOf(l).length > 0).map((l) => l.id)
  for (const id of plan) {
    const l = lessonOf(id)
    const blocks = readingOf(l)
    const covered = new Set(blocks.flatMap((b) => b.variants.slice(0, b.count).map((v) => specOf(v)?.kcs[0] ?? '')))
    for (const kc of directEdges(l)) {
      if (!DEFERRED.includes(kc) && !covered.has(kc)) problems.push(`${id}: the edge to ${kc} has no reading block drawing it`)
    }
    for (const b of blocks) {
      const allowed = new Set([...reachable(l), ...(ON_PAGE[id] ?? [])])
      for (const v of b.variants) {
        const spec = specOf(v)
        if (!spec) {
          problems.push(`${id}: ${v} is not a compile variant`)
          continue
        }
        if (spec.blockOnly !== true) problems.push(`${id}: ${v} is not block-only`)
        for (const kc of spec.kcs) if (!allowed.has(kc)) problems.push(`${id}: ${v} teaches ${kc}, outside D(${id}) and its on-page clause`)
      }
      const first = b.variants.slice(0, b.count)
      if (new Set(first.map(kindOf)).size !== 2) problems.push(`${id}: the first ${b.count} draws are not both a verdict and a fix`)
      const quiz = l.blocks.findIndex((x) => x.type === 'quiz')
      const at = l.blocks.indexOf(b)
      if (quiz !== -1 && at > quiz) problems.push(`${id}: the reading block is after the quiz`)
      for (const k of keyedIndices(l)) if (at < k) problems.push(`${id}: the reading block (${at}) is before the keyed block at ${k}`)
    }
    if (blocks.length > 1) problems.push(`${id}: ${blocks.length} reading blocks`)
    if (KEYED[id] !== undefined && JSON.stringify(keyedIndices(l)) !== JSON.stringify(KEYED[id])) problems.push(`${id}: the keyed blocks moved to ${keyedIndices(l).join(',')}`)
  }
  for (const id of hosts) if (!plan.includes(id)) problems.push(`${id} holds a reading block and is not a serving-first step`)
  return { problems, hosts }
}

describe('reading blocks B1-B7', () => {
  test('the coverage holds', () => {
    const { problems, hosts } = readingCoverage()
    expect(problems).toEqual([])
    expect(hosts).toEqual(Object.keys(BLOCKS))
  })

  test('every host is a T5 or T6 lesson on the serving-first path, with exactly one reading block', () => {
    const plan = pathPlan('serving-first', GRAPH).lessons
    for (const id of Object.keys(BLOCKS)) {
      const l = lessonOf(id)
      expect({ id, track: l.trackId, onPath: plan.includes(id), blocks: readingOf(l).length }).toEqual({ id, track: id.split('.')[0], onPath: true, blocks: 1 })
      expect(['t5', 't6']).toContain(l.trackId)
    }
  })

  test('the blocks sit at the frozen indices, after every keyed block and before the quiz', () => {
    for (const [id, want] of Object.entries(BLOCKS)) {
      const l = lessonOf(id)
      const b = readingOf(l)[0]
      expect({ id, at: l.blocks.indexOf(b), count: b.count }).toEqual({ id, at: want.at, count: want.count })
      expect({ id, keyed: keyedIndices(l) }).toEqual({ id, keyed: [...KEYED[id]] })
      expect(Math.max(-1, ...KEYED[id])).toBeLessThan(want.at)
      expect(l.blocks.findIndex((x) => x.type === 'quiz')).toBeGreaterThan(want.at)
    }
  })

  test('the seven blocks ask for 16 correct answers, and none asks for more than it has variants', () => {
    const blocks = Object.keys(BLOCKS).map((id) => readingOf(lessonOf(id))[0])
    expect(blocks.reduce((n, b) => n + b.count, 0)).toBe(16)
    for (const b of blocks) {
      expect(b.count).toBeLessThanOrEqual(b.variants.length)
      expect(new Set(b.variants).size).toBe(b.variants.length)
    }
  })

  test('each block has a title, a lead of one to three sentences, and names no persona', () => {
    for (const id of Object.keys(BLOCKS)) {
      const b = readingOf(lessonOf(id))[0]
      expect(b.title.startsWith('Read it in Rust: ')).toBe(true)
      const sentences = b.lead
        .replace(/`[^`]*`/g, 'code')
        .split(/(?<=[.!?])\s+/)
        .filter(Boolean)
      expect(sentences.length).toBeGreaterThanOrEqual(1)
      expect(sentences.length).toBeLessThanOrEqual(3)
      expect(/\b(Wei|persona)\b/.test(b.lead + b.title)).toBe(false)
    }
  })

  test('direct edges are covered, the deferred one is the only gap, and the check bites', () => {
    const plan = pathPlan('serving-first', GRAPH).lessons
    const uncovered = plan.flatMap((id) => {
      const covered = new Set(readingOf(lessonOf(id)).flatMap((b) => b.variants.slice(0, b.count).map((v) => specOf(v)?.kcs[0])))
      return directEdges(lessonOf(id)).filter((kc) => !covered.has(kc)).map((kc) => `${id} ${kc}`)
    })
    expect(uncovered).toEqual(['t0.l2 r.bindings-expressions'])
    // the narrow host rule: t5.l7 reaches enums only, so a smart-pointer block there would be rejected
    expect([...reachable(lessonOf('t5.l7'))]).toEqual(['r.enums-option-result'])
    expect([...reachable(lessonOf('t6.l9'))].sort()).toEqual(['r.enums-option-result', 'r.iterators-ownership'])
    expect(ON_PAGE['t5.l6']).toEqual(['r.closures-collections'])
    expect(reachable(lessonOf('t5.l6')).has('r.closures-collections')).toBe(false)
  })
})

describe("outcomes.ts' literals follow the blocks (SR-08)", () => {
  test('SERVING_READING_HOSTS equals the hosts of the mounted reading blocks', () => {
    const hosts = ALL_LESSONS.filter((l) => readingOf(l).length > 0).map((l) => l.id)
    expect([...SERVING_READING_HOSTS].sort()).toEqual([...hosts].sort())
  })

  test('SERVING_READING_KCS equals READING_KCS, and the blocks draw every one of them', () => {
    expect([...SERVING_READING_KCS]).toEqual([...READING_KCS])
    const drawn = new Set(ALL_LESSONS.flatMap((l) => readingOf(l).flatMap((b) => b.variants.map((v) => specOf(v)?.kcs[0]))))
    expect([...drawn].sort()).toEqual([...READING_KCS].sort())
  })
})
