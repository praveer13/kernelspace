/**
 * Read-time event → KC resolution (docs/specs/wave-1.md §4.6).
 *
 * `kcsOfEvent(e, content)` returns the KCs a ledger event is evidence for. The first rule that yields
 * KCs applies, then migrations map the result onto current ids:
 *   1. rev-matched current tag: an item ref whose event `rev` equals the item's current fingerprint
 *      takes the item's *current* `kcs`, so retagging an unchanged item applies retroactively;
 *   2. write-time tag: `e.data.kcs`;
 *   3. static map: `ref-map.ts` by exact ref, then the generator's variant or family KCs for `gen:`;
 *   4. migrations (renames, splits, merges, chains), de-duplicated.
 * An event with no KCs still counts for streak, XP and exposure; it just updates no card.
 *
 * Content is injected (`buildKcContent`), so this module imports no lesson data and the learner model
 * can test against fixtures. The fingerprints below are the contract for every writer of an item ref:
 * a tag (`kcs`) and per-option feedback (`why`) are deliberately outside them, so retagging or
 * rewording feedback never invalidates evidence.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { DiagramPredict, Lesson, Prequestion } from '@/data/lessons/types'
import type { AuthoredItem, ConstructedPrompt } from '@/lib/items/types'
import type { LedgerEvent } from '@/lib/ledger/types'
import { rev32 } from '@/lib/ledger/stable'
import { KC_MIGRATIONS } from '@/data/kc/migrations'
import { REF_KCS } from '@/data/kc/ref-map'
import { applyMigrations } from './graph'
import type { KcId, KcMigration } from './types'

/** The most KCs one event may carry (the codec's cap on `data.kcs`, spec §3.2). */
export const MAX_EVENT_KCS = 6

/* ---------------- content fingerprints (ledger spec §4.5) ---------------- */

/** Checkpoint item `quiz:<lessonId>#<qi>`: exactly what QuizBlock writes. */
export const quizRev = (q: Pick<QuizQuestion, 'q' | 'options' | 'correct'>): string =>
  rev32({ q: q.q, options: q.options, correct: q.correct })

/** Prequestion `pre:<lessonId>#<i>` (P1): the stem and what it is graded against. */
export const prequestionRev = (p: Prequestion): string =>
  p.kind === 'choice'
    ? rev32({ kind: p.kind, q: p.q, options: p.options, correct: p.correct })
    : rev32({ kind: p.kind, q: p.q, unit: p.unit, truth: p.truth, okWithinFactor: p.okWithinFactor })

/** Diagram prediction `dia:<lessonId>#<blockIndex>` (P1). */
export const diagramPredictRev = (d: DiagramPredict): string =>
  rev32({ step: d.step, prompt: d.prompt, options: d.options, correct: d.correct })

/** Constructed response `cr:<lessonId>#<i>`: the prompt, the model answer and the three ideas it is self-checked against. */
export const constructedRev = (c: ConstructedPrompt): string => rev32({ prompt: c.prompt, model: c.model, ideas: c.ideas })

/** Authored item `item:<id>` (placement anchors, spiral items): the same shape as a checkpoint item. */
export const authoredItemRev = (item: AuthoredItem): string => quizRev(item.q)

/* ---------------- content ---------------- */

export interface KcItemTag {
  /** The item's current fingerprint. */
  rev: string
  /** The item's current tag, primary first. */
  kcs: readonly KcId[]
}

export interface GenKcs {
  /** The family's KCs (`Gen.kcs`), used when the variant is unknown. */
  kcs: readonly KcId[]
  /** Per-variant KCs (`VariantSpec.kcs`). */
  variants: ReadonlyMap<string, readonly KcId[]>
}

/** What the resolver reads. Build it once per content version with `buildKcContent`. */
export interface KcContent {
  /** Rule 1: the current tag and fingerprint of every tagged item, keyed by ref. */
  tags: ReadonlyMap<string, KcItemTag>
  /** Rule 3: exact ref → KCs (Boot steps, sim tasks). */
  refs: Readonly<Record<string, readonly KcId[]>>
  /** Rule 3: generator family id → its KCs. */
  gens: ReadonlyMap<string, GenKcs>
  /** Rule 4. */
  migrations: readonly KcMigration[]
}

export interface KcContentInput {
  lessons: readonly Lesson[]
  /** Generator families (B9-B11). Only `id`, `kcs` and the variants' `id`/`kcs` are read. */
  gens?: readonly { id: string; kcs: readonly KcId[]; variants: readonly { id: string; kcs: readonly KcId[] }[] }[]
  /** Authored items outside any lesson (placement anchors). Spiral items are read from the lessons. */
  items?: readonly AuthoredItem[]
  /** Extra exact-ref tags (sim tasks from the registry), merged over `ref-map.ts`. */
  refs?: Readonly<Record<string, readonly KcId[]>>
  /** Defaults to `src/data/kc/migrations.ts`. */
  migrations?: readonly KcMigration[]
}

const tagged = (kcs: readonly KcId[] | undefined): kcs is readonly KcId[] => Array.isArray(kcs) && kcs.length > 0

/**
 * Index every item ref the lessons define, with its current fingerprint and tag. Untagged items are
 * left out, so their events fall through to the write-time tag. Quiz refs count questions lesson-wide
 * (each lesson has one quiz block; verify-kc fails otherwise), and `dia:` refs use the block index.
 */
export function buildKcContent(input: KcContentInput): KcContent {
  const tags = new Map<string, KcItemTag>()
  const put = (ref: string, rev: string, kcs: readonly KcId[] | undefined) => {
    if (tagged(kcs)) tags.set(ref, { rev, kcs })
  }
  const putItem = (item: AuthoredItem) => put(`item:${item.id}`, authoredItemRev(item), item.kcs)

  for (const lesson of input.lessons) {
    let qi = 0
    let pi = 0
    lesson.blocks.forEach((b, bi) => {
      if (b.type === 'quiz') for (const q of b.questions) put(`quiz:${lesson.id}#${qi++}`, quizRev(q), q.kcs)
      else if (b.type === 'predict') for (const p of b.items) put(`pre:${lesson.id}#${pi++}`, prequestionRev(p), p.kcs)
      else if (b.type === 'diagram' && b.predictAt) put(`dia:${lesson.id}#${bi}`, diagramPredictRev(b.predictAt), b.predictAt.kcs)
    })
    lesson.ticket?.cr.forEach((c, i) => put(`cr:${lesson.id}#${i}`, constructedRev(c), c.kcs))
    lesson.ticket?.spiral?.forEach(putItem)
  }
  input.items?.forEach(putItem)

  const gens = new Map<string, GenKcs>()
  for (const g of input.gens ?? []) {
    gens.set(g.id, { kcs: [...g.kcs], variants: new Map(g.variants.map((v) => [v.id, [...v.kcs]])) })
  }

  return {
    tags,
    refs: { ...REF_KCS, ...input.refs },
    gens,
    migrations: input.migrations ?? KC_MIGRATIONS,
  }
}

/* ---------------- resolution ---------------- */

/** The write-time tag, when it is a non-empty array of strings (a malformed tag is ignored, never thrown on). */
function writeTimeKcs(e: LedgerEvent): KcId[] | null {
  const data = (e as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const kcs = (data as { kcs?: unknown }).kcs
  if (!Array.isArray(kcs)) return null
  const ids = kcs.filter((k): k is string => typeof k === 'string' && k.length > 0).slice(0, MAX_EVENT_KCS)
  return ids.length > 0 ? ids : null
}

/** `gen:<family>/<variant>` → the variant's KCs, else the family's. */
function genKcs(ref: string, gens: KcContent['gens']): readonly KcId[] | null {
  if (!ref.startsWith('gen:')) return null
  const body = ref.slice(4)
  const slash = body.indexOf('/')
  const family = slash < 0 ? body : body.slice(0, slash)
  const g = gens.get(family)
  if (!g) return null
  const variant = slash < 0 ? undefined : g.variants.get(body.slice(slash + 1))
  return tagged(variant) ? variant : tagged(g.kcs) ? g.kcs : null
}

/** Rules 1-3: the KCs before migration, or [] when nothing tags the event. */
export function rawKcsOfEvent(e: LedgerEvent, content: KcContent): readonly KcId[] {
  const ref: string = e.ref
  const tag = content.tags.get(ref)
  if (tag && e.rev !== undefined && e.rev === tag.rev) return tag.kcs
  const written = writeTimeKcs(e)
  if (written) return written
  if (Object.hasOwn(content.refs, ref)) {
    const mapped = content.refs[ref]
    if (tagged(mapped)) return mapped
  }
  return genKcs(ref, content.gens) ?? []
}

/** The KCs `e` is evidence for, after migrations, de-duplicated and primary first (spec §4.6). */
export function kcsOfEvent(e: LedgerEvent, content: KcContent): KcId[] {
  return applyMigrations(rawKcsOfEvent(e, content), content.migrations)
}
