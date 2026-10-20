/**
 * The serving-first reading blocks' coverage check (docs/specs/serving-reading.md §5.3, M1 item 1, SR-06), outside any
 * test file so that tests/kc/reading-blocks.test.ts and SR-07's copy test in tests/learner/recommend.test.ts can share
 * it without bun registering one file's tests twice.
 *
 * `readingCoverage()` holds: every direct edge from a serving-first lesson's KCs to an R KC is covered by a reading block
 * in that lesson (except the deferred `r.bindings-expressions`, Q3); every block KC is in D(L) or the one on-page clause
 * (SR-D3); every variant is a declared block-only compile variant; the first `count` draws cover the direct-edge KCs and
 * include both kinds; every block sits after every index-keyed block of its host and before the quiz; the keyed blocks'
 * indices equal a frozen map (an insertion that shifted one would orphan its ledger refs); and the hosts are exactly the
 * seven the spec names.
 */
import { KCS, kcById } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Block, Lesson, ReadingBlock } from '../../src/data/lessons/types'
import compile from '../../src/lib/items/families/compile'
import { pathPlan, type PathGraph } from '../../src/lib/learner/paths'

export const GRAPH: PathGraph = { kcs: KCS, lessons: ALL_LESSONS, labs: FORGE_LABS }

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

export const lessonOf = (id: string): Lesson => {
  const l = ALL_LESSONS.find((x) => x.id === id)
  if (!l) throw new Error(`no lesson ${id}`)
  return l
}
const isReading = (b: Block): b is ReadingBlock => b.type === 'reading'
export const readingOf = (l: Lesson): ReadingBlock[] => l.blocks.filter(isReading)
/** Indices of the blocks that key their ledger events on their position: diagram predictions, item blocks and Fleet exercises. */
export const keyedIndices = (l: Lesson): number[] =>
  l.blocks.flatMap((b, i) => (b.type === 'diagram' && b.predictAt !== undefined) || b.type === 'item' || (b.type === 'exercise' && 'fleet' in b) ? [i] : [])

/** The R KCs a lesson's KCs need directly. */
export const directEdges = (l: Lesson): string[] => [...new Set((l.kcs ?? []).flatMap((k) => (kcById(k)?.requires ?? []).filter((r) => r.startsWith('r.'))))]

/** D(L): the R KCs needed directly by L's KCs, or by a T5-T7 KC reachable from them through T5-T7 edges. */
export function reachable(l: Lesson): Set<string> {
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
export const specOf = (variant: string) => compile.variants.find((v) => v.id === variant)

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
