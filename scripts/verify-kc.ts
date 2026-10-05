/**
 * verify-kc — the KC graph gate (docs/specs/wave-1.md §4.7; fast gate).
 *
 * FAILS on:
 *   ids        malformed, duplicate, more than 200, a contract id from ids.ts missing, a track prefix
 *              that disagrees with `track`, a bad title/can/kind/since;
 *   references a dangling id in requires/contains/confusable, an unknown lesson, family, claim or lab,
 *              a KC with no lessons and no lab, an unknown id in any tag (items, Lesson.kcs, lab checks,
 *              ref-map), a self-edge;
 *   shape      a cycle in requires or in requires ∪ contains; an asymmetric confusable set or one with
 *              more than 3 entries; thresholds other than THRESHOLD_KCS (6 core) plus RUST_ANCHOR_KC;
 *              a notional card outside 3-6 rules and 2-4 ignores, or a Wave 1 track without one;
 *   coverage   in a lesson that sets Lesson.kcs: an untagged checkpoint item, Lesson.kcs outside 2-3 or
 *              naming a KC that does not list the lesson; a KC in some Lesson.kcs with fewer than 2
 *              tagged items and no generator; an R lesson that no T-side KC requires (§4.3); a lab whose
 *              check KCs' prerequisites miss a readiness lesson; a lab check tag the KC's `labs` does
 *              not name (and the reverse once the lab is tagged); a generator family whose Gen.kcs
 *              disagrees with the KCs that name it; a lesson with more than one quiz block (quiz refs
 *              count per block, so tags would be ambiguous);
 *   migrations a `from` that is still a KC, a target that is neither a KC nor a later `from`, a repeated
 *              `from`, a looping chain.
 * WARNS (never fails) on: a requires edge into a KC introduced later in curriculum order; a lesson
 * whose KCs have no requires at all; a family the graph names that has not landed yet.
 *
 *   bun run verify:kc
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import type { ForgeLab } from '../src/data/labs'
import type { Lesson } from '../src/data/lessons/types'
import type { AuthoredItem } from '../src/lib/items/types'
import type { Kc, KcGraph } from '../src/lib/kc/types'
import { findCycle, indexKcs, prerequisitesOf, requiresAndContains } from '../src/lib/kc/graph'

/** §4.1: granularity drift is capped. */
export const MAX_KCS = 200
export const KC_ID = /^(r|t[0-7])\.[a-z0-9]+(-[a-z0-9]+)*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const KINDS = new Set(['concept', 'procedure', 'fact', 'skill'])
/** Tracks that need a notional-machine card in Wave 1 (§4.8). */
const NOTIONAL_TRACKS = ['r', 't0', 't1', 't2']
/**
 * Families the spec commits to (§5.5) that B9-B11 land in parallel with this graph. Naming one before
 * its module exists is a warning; once the module exists, its Gen.kcs must agree with the graph.
 */
export const PENDING_FAMILIES = ['frag', 'kv', 'roofline']

export interface KcFamily {
  id: string
  kcs: readonly string[]
}

export interface VerifyKcInput {
  graph: KcGraph
  /** Every id in src/data/kc/ids.ts. */
  contract: readonly string[]
  thresholds: readonly string[]
  anchor: string
  /** Curriculum order: the warning on late prerequisites reads positions from it. */
  lessons: readonly Lesson[]
  labs: readonly ForgeLab[]
  claims: ReadonlySet<string>
  refMap: Readonly<Record<string, readonly string[]>>
  /** Families whose modules exist. */
  families: readonly KcFamily[]
  pendingFamilies?: readonly string[]
  /** Authored items outside lessons (placement anchors); spiral items are read from the lessons. */
  items?: readonly AuthoredItem[]
}

export interface VerifyKcResult {
  errors: string[]
  warnings: string[]
  stats: {
    kcs: number
    byTrack: Record<string, number>
    byKind: Record<string, number>
    confusableSets: string[][]
    pairing: { rLesson: string; edges: string[] }[]
    optedIn: string[]
    taggedItems: number
  }
}

const validDate = (s: string): boolean => {
  if (!DATE.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s
}

const dupes = (xs: readonly string[]): string[] => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))]

/** One place an item tag lives, with its ref for messages. */
interface TagSite {
  ref: string
  lessonId: string | null
  kcs: readonly string[] | undefined
  checkpoint: boolean
}

function tagSites(lessons: readonly Lesson[], items: readonly AuthoredItem[]): TagSite[] {
  const out: TagSite[] = []
  for (const l of lessons) {
    let qi = 0
    let pi = 0
    l.blocks.forEach((b, bi) => {
      if (b.type === 'quiz') for (const q of b.questions) out.push({ ref: `quiz:${l.id}#${qi++}`, lessonId: l.id, kcs: q.kcs, checkpoint: true })
      else if (b.type === 'predict') for (const p of b.items) out.push({ ref: `pre:${l.id}#${pi++}`, lessonId: l.id, kcs: p.kcs, checkpoint: false })
      else if (b.type === 'diagram' && b.predictAt) out.push({ ref: `dia:${l.id}#${bi}`, lessonId: l.id, kcs: b.predictAt.kcs, checkpoint: false })
    })
    l.ticket?.cr.forEach((c, i) => out.push({ ref: `cr:${l.id}#${i}`, lessonId: l.id, kcs: c.kcs, checkpoint: false }))
    for (const s of l.ticket?.spiral ?? []) out.push({ ref: `item:${s.id}`, lessonId: l.id, kcs: s.kcs, checkpoint: false })
  }
  for (const it of items) out.push({ ref: `item:${it.id}`, lessonId: null, kcs: it.kcs, checkpoint: false })
  return out
}

export function verifyKc(input: VerifyKcInput): VerifyKcResult {
  const errors: string[] = []
  const warnings: string[] = []
  const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`)
  const warn = (where: string, msg: string) => warnings.push(`${where}: ${msg}`)

  const { graph } = input
  const kcs = graph.kcs
  const index = indexKcs(kcs)
  const lessonIds = new Set(input.lessons.map((l) => l.id))
  const position = new Map(input.lessons.map((l, i) => [l.id, i]))
  const labIds = new Set(input.labs.map((l) => l.id))
  const familyIds = new Set(input.families.map((f) => f.id))
  const pending = new Set((input.pendingFamilies ?? []).filter((f) => !familyIds.has(f)))
  const known = (id: string) => index.has(id)

  /* ---------------- ids ---------------- */
  if (kcs.length > MAX_KCS) err('graph', `${kcs.length} KCs exceeds the cap of ${MAX_KCS}`)
  for (const id of dupes(kcs.map((k) => k.id))) err(id, 'duplicate id')
  for (const k of kcs) {
    if (!KC_ID.test(k.id)) err(k.id, 'malformed id (want <track>.<kebab-slug>, e.g. t1.external-frag)')
    else if (k.id.split('.')[0] !== k.track) err(k.id, `id prefix disagrees with track "${k.track}"`)
    if (!k.title.trim() || k.title.length > 48) err(k.id, `title must be 1-48 characters (has ${k.title.length})`)
    if (!k.can.startsWith('You can ') || k.can.length > 120) err(k.id, `can must start "You can " and be at most 120 characters (has ${k.can.length})`)
    if (!KINDS.has(k.kind)) err(k.id, `unknown kind "${k.kind}"`)
    if (!validDate(k.since)) err(k.id, `since "${k.since}" is not a real YYYY-MM-DD`)
    if (k.threshold !== undefined && k.threshold !== 'core' && k.threshold !== 'anchor') err(k.id, `unknown threshold "${k.threshold}"`)
  }
  for (const id of input.contract) if (!known(id)) err(id, 'contract id from src/data/kc/ids.ts is not defined')

  /* ---------------- references ---------------- */
  for (const k of kcs) {
    const lists: [string, readonly string[]][] = [
      ['requires', k.requires],
      ['contains', k.contains ?? []],
      ['confusable', k.confusable ?? []],
    ]
    for (const [field, ids] of lists) {
      for (const id of ids) {
        if (id === k.id) err(k.id, `${field} names itself`)
        else if (!known(id)) err(k.id, `${field} names unknown KC ${id}`)
      }
      for (const d of dupes(ids)) err(k.id, `${field} repeats ${d}`)
    }
    for (const l of k.lessons) if (!lessonIds.has(l)) err(k.id, `unknown lesson ${l}`)
    for (const d of dupes(k.lessons)) err(k.id, `lessons repeats ${d}`)
    if (k.lessons.length === 0 && !(k.labs?.length)) err(k.id, 'no lessons and no lab: nothing teaches or exercises it')
    for (const f of k.gen ?? []) if (!familyIds.has(f) && !pending.has(f)) err(k.id, `unknown generator family ${f}`)
    for (const c of k.claims ?? []) if (!input.claims.has(c)) err(k.id, `unknown claim ${c}`)
    for (const l of k.labs ?? []) if (!labIds.has(l)) err(k.id, `unknown lab ${l}`)
  }

  /* ---------------- shape ---------------- */
  const cycle = findCycle(kcs)
  if (cycle) err('requires', `cycle ${cycle.join(' → ')}`)
  else {
    const both = findCycle(kcs, requiresAndContains)
    if (both) err('requires ∪ contains', `cycle ${both.join(' → ')}`)
  }
  for (const k of kcs) {
    const conf = k.confusable ?? []
    if (conf.length > 3) err(k.id, `confusable has ${conf.length} entries (at most 3)`)
    for (const other of conf) {
      const o = index.get(other)
      if (o && !(o.confusable ?? []).includes(k.id)) err(k.id, `confusable with ${other}, but ${other} does not list ${k.id} (sets are symmetric)`)
    }
  }
  const core = kcs.filter((k) => k.threshold === 'core').map((k) => k.id)
  const anchors = kcs.filter((k) => k.threshold === 'anchor').map((k) => k.id)
  if (core.length !== 6) err('threshold', `${core.length} core KCs (want 6)`)
  if (anchors.length !== 1) err('threshold', `${anchors.length} anchor KCs (want 1)`)
  for (const id of input.thresholds) if (known(id) && !core.includes(id)) err(id, 'listed in THRESHOLD_KCS but not threshold: core')
  for (const id of core) if (!input.thresholds.includes(id)) err(id, 'threshold: core but not in THRESHOLD_KCS')
  if (known(input.anchor) && !anchors.includes(input.anchor)) err(input.anchor, 'RUST_ANCHOR_KC is not threshold: anchor')
  for (const id of anchors) if (id !== input.anchor) err(id, 'threshold: anchor but not RUST_ANCHOR_KC')

  const cards = new Map<string, number>()
  for (const card of graph.notional) {
    cards.set(card.track, (cards.get(card.track) ?? 0) + 1)
    const where = `notional ${card.track}`
    if (!card.title.trim()) err(where, 'missing title')
    if (card.rules.length < 3 || card.rules.length > 6) err(where, `${card.rules.length} rules (want 3-6)`)
    if (card.ignores.length < 2 || card.ignores.length > 4) err(where, `${card.ignores.length} ignores (want 2-4)`)
    for (const line of [...card.rules, ...card.ignores]) if (!line.trim()) err(where, 'empty line')
  }
  for (const t of NOTIONAL_TRACKS) if (cards.get(t) !== 1) err(`notional ${t}`, `${cards.get(t) ?? 0} cards (want exactly 1)`)

  /* ---------------- migrations ---------------- */
  const froms = new Set(graph.migrations.map((m) => m.from))
  for (const d of dupes(graph.migrations.map((m) => m.from))) err(`migration ${d}`, 'repeated from (put every target in one row)')
  for (const m of graph.migrations) {
    const where = `migration ${m.from}`
    if (!KC_ID.test(m.from)) err(where, 'malformed from')
    if (known(m.from)) err(where, 'from is still a KC; a migrated id must leave the graph')
    if (m.to.length === 0) err(where, 'no targets')
    for (const t of m.to) if (!known(t) && !froms.has(t)) err(where, `target ${t} is neither a KC nor migrated further`)
    if (!validDate(m.at)) err(where, `at "${m.at}" is not a real YYYY-MM-DD`)
    if (!m.why.trim()) err(where, 'missing why')
  }
  {
    // a looping chain: walk from→to edges among migration rows only
    const rows = new Map<string, string[]>()
    for (const m of graph.migrations) rows.set(m.from, [...(rows.get(m.from) ?? []), ...m.to])
    const migrationNodes = [...rows.keys()].map((id) => ({ id, requires: (rows.get(id) ?? []).filter((t) => rows.has(t)) }) as Kc)
    const loop = findCycle(migrationNodes)
    if (loop) err('migrations', `chain loops: ${loop.join(' → ')}`)
  }

  /* ---------------- ref map ---------------- */
  for (const [ref, ids] of Object.entries(input.refMap)) {
    if (!ref.includes(':')) err(`ref-map ${ref}`, 'not a ref')
    if (ids.length === 0) err(`ref-map ${ref}`, 'maps to no KCs')
    for (const id of ids) if (!known(id)) err(`ref-map ${ref}`, `unknown KC ${id}`)
  }

  /* ---------------- tags and coverage ---------------- */
  const sites = tagSites(input.lessons, input.items ?? [])
  for (const s of sites) {
    if (s.kcs === undefined) continue
    if (s.kcs.length < 1 || s.kcs.length > 3) err(s.ref, `tags ${s.kcs.length} KCs (want 1-3, primary first)`)
    for (const id of s.kcs) if (!known(id)) err(s.ref, `tags unknown KC ${id}`)
    for (const d of dupes(s.kcs)) err(s.ref, `tags ${d} twice`)
  }
  for (const d of dupes(sites.filter((s) => s.ref.startsWith('item:')).map((s) => s.ref))) err(d, 'authored item id is not unique')

  const optedIn = input.lessons.filter((l) => l.kcs !== undefined)
  for (const l of input.lessons) {
    const quizBlocks = l.blocks.filter((b) => b.type === 'quiz').length
    if (quizBlocks > 1) err(l.id, `${quizBlocks} quiz blocks; quiz refs count per block, so item tags would be ambiguous`)
  }
  for (const l of optedIn) {
    const lk = l.kcs ?? []
    if (lk.length < 2 || lk.length > 3) err(l.id, `Lesson.kcs has ${lk.length} KCs (want 2-3, primary first)`)
    for (const d of dupes(lk)) err(l.id, `Lesson.kcs repeats ${d}`)
    for (const id of lk) {
      const k = index.get(id)
      if (!k) err(l.id, `Lesson.kcs names unknown KC ${id}`)
      else if (!k.lessons.includes(l.id)) err(l.id, `Lesson.kcs names ${id}, whose lessons do not include ${l.id}`)
    }
    for (const s of sites) if (s.lessonId === l.id && s.checkpoint && !s.kcs?.length) err(s.ref, 'untagged checkpoint item in a lesson that sets Lesson.kcs')
  }

  const itemCount = new Map<string, number>()
  for (const s of sites) for (const id of new Set(s.kcs ?? [])) itemCount.set(id, (itemCount.get(id) ?? 0) + 1)
  const genCovers = (k: Kc) =>
    (k.gen ?? []).some((f) => familyIds.has(f) || pending.has(f)) || input.families.some((f) => f.kcs.includes(k.id))
  const inScope = new Set(optedIn.flatMap((l) => l.kcs ?? []))
  for (const id of inScope) {
    const k = index.get(id)
    if (k && (itemCount.get(id) ?? 0) < 2 && !genCovers(k)) err(id, `${itemCount.get(id) ?? 0} tagged item(s) and no generator (want at least 2 items or a generator)`)
  }

  // §4.3: every R lesson needs a T-side KC that requires a KC it introduces
  const pairing: VerifyKcResult['stats']['pairing'] = []
  for (const l of input.lessons.filter((x) => x.trackId === 'r')) {
    const introduced = new Set(kcs.filter((k) => k.lessons[0] === l.id).map((k) => k.id))
    const edges = kcs
      .filter((k) => k.track !== 'r')
      .flatMap((k) => k.requires.filter((r) => introduced.has(r)).map((r) => `${k.id} → ${r}`))
    pairing.push({ rLesson: l.id, edges })
    if (edges.length === 0) err(l.id, 'no T-side KC requires a KC this R lesson introduces (the braid cannot place it)')
  }

  /* ---------------- labs ---------------- */
  for (const lab of input.labs) {
    const tagged = lab.checks.filter((c) => c.kcs !== undefined)
    const taggedIds = new Set<string>()
    for (const c of tagged) {
      const where = `lab ${lab.id}/${c.id}`
      const ck = c.kcs ?? []
      if (ck.length < 1 || ck.length > 3) err(where, `tags ${ck.length} KCs (want 1-3)`)
      for (const id of ck) {
        taggedIds.add(id)
        const k = index.get(id)
        if (!k) err(where, `tags unknown KC ${id}`)
        else if (!(k.labs ?? []).includes(lab.id)) err(where, `tags ${id}, whose labs do not name ${lab.id}`)
      }
    }
    const naming = kcs.filter((k) => (k.labs ?? []).includes(lab.id))
    if (tagged.length > 0) for (const k of naming) if (!taggedIds.has(k.id)) err(k.id, `names lab ${lab.id}, but no check of that lab tags it`)
    const checkKcs = new Set([...naming.map((k) => k.id), ...[...taggedIds].filter(known)])
    const ready = lab.readiness?.lessonIds ?? []
    if (checkKcs.size === 0 || ready.length === 0) continue
    const reach = new Set<string>()
    for (const id of checkKcs) for (const r of [id, ...prerequisitesOf(index, id)]) reach.add(r)
    for (const lessonId of ready) {
      if (!kcs.some((k) => reach.has(k.id) && k.lessons[0] === lessonId)) err(`lab ${lab.id}`, `readiness lesson ${lessonId} introduces no prerequisite of the lab's check KCs`)
    }
  }

  /* ---------------- generator families ---------------- */
  for (const f of input.families) {
    for (const id of f.kcs) {
      const k = index.get(id)
      if (!k) err(`family ${f.id}`, `Gen.kcs names unknown KC ${id}`)
      else if (!(k.gen ?? []).includes(f.id)) err(`family ${f.id}`, `Gen.kcs names ${id}, whose gen does not list ${f.id}`)
    }
    for (const k of kcs) if ((k.gen ?? []).includes(f.id) && !f.kcs.includes(k.id)) err(k.id, `gen lists ${f.id}, but that family's Gen.kcs does not include it`)
  }
  for (const f of pending) if (kcs.some((k) => (k.gen ?? []).includes(f))) warn(`family ${f}`, 'named by the graph; its module has not landed yet (spec §5.5)')

  /* ---------------- warnings ---------------- */
  for (const k of kcs) {
    const mine = k.lessons[0]
    if (mine === undefined) continue
    for (const r of k.requires) {
      const theirs = index.get(r)?.lessons[0]
      if (theirs !== undefined && (position.get(theirs) ?? -1) > (position.get(mine) ?? -1)) {
        warn(k.id, `requires ${r}, introduced later (${theirs} after ${mine})`)
      }
    }
  }
  const taught = new Set(kcs.flatMap((k) => k.lessons))
  for (const l of input.lessons) {
    if (!taught.has(l.id)) continue
    const theirs = l.kcs ? l.kcs.map((id) => index.get(id)).filter((k): k is Kc => !!k) : kcs.filter((k) => k.lessons.includes(l.id))
    if (theirs.every((k) => k.requires.length === 0)) warn(l.id, 'none of its KCs requires anything')
  }

  /* ---------------- stats ---------------- */
  const byTrack: Record<string, number> = {}
  const byKind: Record<string, number> = {}
  for (const k of kcs) {
    byTrack[k.track] = (byTrack[k.track] ?? 0) + 1
    byKind[k.kind] = (byKind[k.kind] ?? 0) + 1
  }
  const seenSets = new Set<string>()
  const confusableSets: string[][] = []
  for (const k of kcs) {
    if (!k.confusable?.length) continue
    for (const other of k.confusable) {
      const pair = [k.id, other].sort()
      const key = pair.join('|')
      if (!seenSets.has(key)) {
        seenSets.add(key)
        confusableSets.push(pair)
      }
    }
  }

  return {
    errors,
    warnings,
    stats: {
      kcs: kcs.length,
      byTrack,
      byKind,
      confusableSets,
      pairing,
      optedIn: optedIn.map((l) => l.id),
      taggedItems: sites.filter((s) => s.kcs?.length).length,
    },
  }
}

/* ---------------- discovery (Bun has no import.meta.glob; spec §5.1) ---------------- */

const isFamily = (x: unknown): x is KcFamily & { variants: unknown[] } =>
  !!x && typeof x === 'object' && typeof (x as KcFamily).id === 'string' && Array.isArray((x as KcFamily).kcs) && Array.isArray((x as { variants?: unknown }).variants)

/** Generator families: any export of src/lib/items/families/*.ts shaped like a Gen. */
export async function discoverFamilies(root = new URL('../src/lib/items/families/', import.meta.url)): Promise<KcFamily[]> {
  if (!existsSync(root)) return []
  const out = new Map<string, KcFamily>()
  for (const name of (await readdir(root)).filter((n) => n.endsWith('.ts')).sort()) {
    const mod = (await import(new URL(name, root).href)) as Record<string, unknown>
    for (const value of Object.values(mod)) if (isFamily(value)) out.set(value.id, { id: value.id, kcs: [...value.kcs] })
  }
  return [...out.values()]
}

const isAuthored = (x: unknown): x is AuthoredItem =>
  !!x && typeof x === 'object' && typeof (x as AuthoredItem).id === 'string' && Array.isArray((x as AuthoredItem).kcs) && typeof (x as AuthoredItem).q === 'object'

/** Authored items outside lessons: any exported array of AuthoredItem under src/data/placement (B17's anchors). */
export async function discoverAuthoredItems(root = new URL('../src/data/placement/', import.meta.url)): Promise<AuthoredItem[]> {
  if (!existsSync(root)) return []
  const out: AuthoredItem[] = []
  for (const name of (await readdir(root)).filter((n) => n.endsWith('.ts')).sort()) {
    const mod = (await import(new URL(name, root).href)) as Record<string, unknown>
    for (const value of Object.values(mod)) if (Array.isArray(value) && value.length > 0 && value.every(isAuthored)) out.push(...value)
  }
  return out
}

async function main() {
  const [{ KC_GRAPH, KC, THRESHOLD_KCS, RUST_ANCHOR_KC, REF_KCS }, { ALL_LESSONS }, { FORGE_LABS }, { CLAIMS }] = await Promise.all([
    import('../src/data/kc'),
    import('../src/data/lessons'),
    import('../src/data/labs'),
    import('../src/data/claims'),
  ])
  const result = verifyKc({
    graph: KC_GRAPH,
    contract: Object.values(KC),
    thresholds: THRESHOLD_KCS,
    anchor: RUST_ANCHOR_KC,
    lessons: ALL_LESSONS,
    labs: FORGE_LABS,
    claims: new Set(CLAIMS.map((c) => c.id)),
    refMap: REF_KCS,
    families: await discoverFamilies(),
    pendingFamilies: PENDING_FAMILIES,
    items: await discoverAuthoredItems(),
  })
  const s = result.stats
  console.log(`tracks: ${Object.entries(s.byTrack).map(([t, n]) => `${t} ${n}`).join(' · ')}`)
  console.log(`kinds: ${Object.entries(s.byKind).map(([t, n]) => `${n} ${t}`).join(' · ')}`)
  console.log(`confusable: ${s.confusableSets.map((p) => `{${p.join(', ')}}`).join(' ')}`)
  console.log(`R pairing: ${s.pairing.map((p) => `${p.rLesson} ← ${p.edges.map((e) => e.split(' → ')[0]).join(', ') || '-'}`).join(' · ')}`)
  console.log(`opted in (Lesson.kcs): ${s.optedIn.length > 0 ? s.optedIn.join(', ') : 'none yet'} · tagged items: ${s.taggedItems}`)
  for (const w of result.warnings) console.log(`warn ${w}`)
  if (result.errors.length > 0) {
    console.error(`verify-kc: ${result.errors.length} problem(s)`)
    for (const e of result.errors) console.error(`  ${e}`)
    process.exit(1)
  }
  console.log(`verify-kc: ok, ${s.kcs} KCs, ${KC_GRAPH.notional.length} notional machines, ${KC_GRAPH.migrations.length} migrations`)
}

if (import.meta.main) await main()
