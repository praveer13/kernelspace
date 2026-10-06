/**
 * KC graph utilities (docs/specs/wave-1.md §4.1-4.2): pure functions over a KC list, with no data
 * imports, so verify-kc can run them on fixtures and Today, the braid and the ticket can run them on
 * the real graph (src/data/kc).
 */

import type { Kc, KcId, KcMigration } from './types'

export type KcIndex = ReadonlyMap<KcId, Kc>

/** id → KC. On a duplicate id the first KC wins (verify-kc reports duplicates). */
export function indexKcs(kcs: readonly Kc[]): Map<KcId, Kc> {
  const out = new Map<KcId, Kc>()
  for (const k of kcs) if (!out.has(k.id)) out.set(k.id, k)
  return out
}

/** The prerequisite edges of a KC. */
export const requiresOf = (k: Kc): readonly KcId[] => k.requires

/** Prerequisite plus composition edges: verify-kc requires this union to be acyclic too. */
export const requiresAndContains = (k: Kc): readonly KcId[] => [...k.requires, ...(k.contains ?? [])]

/**
 * A cycle over `edges` as a closed path `[a, b, …, a]`, or null when there is none. Ids that name no
 * KC are skipped (a dangling edge is a separate error). Deterministic: the first cycle reached when
 * walking the KCs in input order.
 */
export function findCycle(kcs: readonly Kc[], edges: (k: Kc) => readonly KcId[] = requiresOf): KcId[] | null {
  const index = indexKcs(kcs)
  const state = new Map<KcId, 1 | 2>() // 1 = on the current path, 2 = finished
  for (const root of kcs) {
    if (state.has(root.id)) continue
    // iterative DFS: each frame is a KC and the position of its next edge
    const stack: { id: KcId; next: number; out: readonly KcId[] }[] = [{ id: root.id, next: 0, out: edges(root) }]
    state.set(root.id, 1)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top.next >= top.out.length) {
        state.set(top.id, 2)
        stack.pop()
        continue
      }
      const to = top.out[top.next++]
      const k = index.get(to)
      if (!k) continue
      const s = state.get(to)
      if (s === 1) {
        const from = stack.findIndex((f) => f.id === to)
        return [...stack.slice(from).map((f) => f.id), to]
      }
      if (s === 2) continue
      state.set(to, 1)
      stack.push({ id: to, next: 0, out: edges(k) })
    }
  }
  return null
}

/**
 * Prerequisites first (Kahn's algorithm over `requires`). Among KCs that are ready together, input
 * order wins, so the result is deterministic and close to curriculum order. Throws on a cycle.
 */
export function topoOrder(kcs: readonly Kc[]): Kc[] {
  const index = indexKcs(kcs)
  const pending = new Map<KcId, number>()
  const dependants = new Map<KcId, KcId[]>()
  for (const k of index.values()) {
    const reqs = [...new Set(k.requires)].filter((r) => index.has(r))
    pending.set(k.id, reqs.length)
    for (const r of reqs) dependants.set(r, [...(dependants.get(r) ?? []), k.id])
  }
  const position = new Map([...index.keys()].map((id, i) => [id, i]))
  const ready = [...index.keys()].filter((id) => pending.get(id) === 0)
  const out: Kc[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))
    const id = ready.shift() as KcId
    out.push(index.get(id) as Kc)
    for (const d of dependants.get(id) ?? []) {
      const left = (pending.get(d) ?? 0) - 1
      pending.set(d, left)
      if (left === 0) ready.push(d)
    }
  }
  if (out.length !== index.size) throw new Error(`requires has a cycle: ${findCycle(kcs)?.join(' → ')}`)
  return out
}

/** Every KC `id` transitively requires (not including `id`), nearest first. Unknown ids are skipped. */
export function prerequisitesOf(index: KcIndex, id: KcId): KcId[] {
  const seen = new Set<KcId>([id])
  const out: KcId[] = []
  const queue = [...(index.get(id)?.requires ?? [])]
  while (queue.length > 0) {
    const next = queue.shift() as KcId
    if (seen.has(next) || !index.has(next)) continue
    seen.add(next)
    out.push(next)
    queue.push(...(index.get(next)?.requires ?? []))
  }
  return out
}

/** KCs that directly require `id`, in input order. */
export const dependantsOf = (kcs: readonly Kc[], id: KcId): Kc[] => kcs.filter((k) => k.requires.includes(id))

/** The KC's confusable set (symmetric in a verified graph), without the KC itself. */
export const confusableWith = (index: KcIndex, id: KcId): readonly KcId[] => index.get(id)?.confusable ?? []

/** The lesson that introduces a KC (its first lesson), or undefined for a lab-only KC. */
export const introducingLesson = (k: Kc): string | undefined => k.lessons[0]

/** KCs that list `lessonId` among the lessons that teach them, in input order. */
export const kcsTaughtIn = (kcs: readonly Kc[], lessonId: string): Kc[] => kcs.filter((k) => k.lessons.includes(lessonId))

/** KCs whose introducing lesson is `lessonId`. */
export const kcsIntroducedIn = (kcs: readonly Kc[], lessonId: string): Kc[] => kcs.filter((k) => k.lessons[0] === lessonId)

/**
 * Read-time id migration (§4.6 rule 4). Renames map 1→1, splits 1→n, merges n→1, and chains resolve
 * (a → b → c reads a as c). A looping chain leaves the id where the loop closes rather than spinning.
 * The result is de-duplicated, first occurrence first.
 */
export function applyMigrations(ids: readonly KcId[], migrations: readonly KcMigration[]): KcId[] {
  if (migrations.length === 0) return [...new Set(ids)]
  const rows = new Map<KcId, KcId[]>()
  for (const m of migrations) rows.set(m.from, [...(rows.get(m.from) ?? []), ...m.to])
  const out = new Set<KcId>()
  const visit = (id: KcId, path: Set<KcId>) => {
    const to = rows.get(id)
    if (!to || path.has(id)) {
      out.add(id)
      return
    }
    path.add(id)
    for (const t of to) visit(t, path)
    path.delete(id)
  }
  for (const id of ids) visit(id, new Set())
  return [...out]
}
