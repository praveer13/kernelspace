/**
 * P1 prequestions and `DiagramBlock.predictAt` (docs/specs/wave-1.md §9; task B20): the pure side.
 *
 * What lives here is everything about the two surfaces that is not a pixel: the ledger refs and the
 * events they write, how a prequestion becomes a `PlayableItem` for the shared player, how a saved guess is
 * read back from the ledger, what the reveal says, when the reveal is due, the diagram gate, and the expert
 * skip. The components (src/components/blocks/Prequestions.tsx, src/pages/lesson/diagram.tsx) only draw it.
 *
 * Refs: `pre:<lessonId>#<i>` (choice: `item`; numeric: `predict`; `src: 'pre'`) and
 * `dia:<lessonId>#<blockIndex>` (`item`, `src: 'diagram'`). Both carry the authored rev, the item's `kcs` and
 * `nsec: 20`, and are graded at answer time but shown later (prequestions) or at once (diagrams).
 *
 * Expert skip (§9.1): when every KC of the block has a card with predicted recall ≥ 0.9 today, or the
 * placement walk marked it solid, the block starts collapsed. Cards are derived from the ledger by
 * `deriveCards` (never stored); the heavy modules load on demand, so a lesson with nothing to skip pays nothing.
 */

import type { DiagramPredict, Prequestion } from '@/data/lessons/types'
import { gradeResponse } from '@/lib/items/grade'
import type { ItemResult } from '@/lib/items/play'
import type { Gen, Instance, PlayableItem } from '@/lib/items/types'
import { formatNumber } from '@/lib/items/units'
import { diagramPredictRev, prequestionRev } from '@/lib/kc/resolve'
import { dayOf } from '@/lib/ledger/time'
import type {
  Confidence,
  EventFilter,
  ItemResponse,
  Json,
  LedgerEvent,
  LocalDay,
  WorkingKey,
} from '@/lib/ledger/types'
import { hash32 } from '@/lib/rng'
import type { CardsContent, CardsPlan } from './cards'

/** Nominal seconds of one guess (spec §9.1 `nsec: 20`); a diagram prediction is sized the same. */
export const PRE_NSEC = 20
/** A card with at least this predicted recall counts as known (spec §9.1). */
export const EXPERT_RECALL = 0.9
/** The codec rejects an item with more KCs than this (spec §3.2). */
const MAX_KCS = 6

/* ------------------------------ refs ------------------------------ */

export const preRef = (lessonId: string, index: number): `pre:${string}#${number}` => `pre:${lessonId}#${index}`
export const diaRef = (lessonId: string, blockIndex: number): `dia:${string}#${number}` => `dia:${lessonId}#${blockIndex}`

/** The KCs a block assesses, de-duplicated in order. */
export function blockKcs(parts: readonly { kcs: readonly string[] }[]): string[] {
  return [...new Set(parts.flatMap((p) => p.kcs))]
}

/* ------------------------------ prequestion → player item ------------------------------ */

/**
 * The checker the player needs for a numeric prequestion. Prequestions are authored, not generated, so
 * there is nothing to `make`; grading is the shared log-scored estimate rule and there are no steps.
 */
export const PRE_GEN: Gen = {
  id: 'pre',
  version: 1,
  title: 'Prequestion',
  kcs: [],
  variants: [],
  ratioRules: [],
  make() {
    throw new Error('prequestions are authored, not generated')
  },
  grade: gradeResponse,
  solution: () => [],
  pins: [],
}

/**
 * A prequestion as the shared item player's input. Choice items are authored items (options graded by
 * authored index); numeric ones are an estimate instance the player grades in log space. The caller keys the
 * player by the returned ref and writes the ledger event itself (`preResponse`): the player's own ref for
 * these items is not the `pre:` ref.
 */
export function prequestionItem(lessonId: string, index: number, p: Prequestion): PlayableItem {
  const ref = preRef(lessonId, index)
  if (p.kind === 'choice') {
    return { source: 'item', item: { id: ref, q: { q: p.q, options: p.options, correct: p.correct, why: p.why }, kcs: p.kcs } }
  }
  const inst: Instance = {
    family: 'pre',
    version: 1,
    variant: `${lessonId}#${index}`,
    seed: hash32(ref),
    level: 3,
    params: {},
    kcs: p.kcs,
    prompt: { stem: [{ t: 'text', text: p.q }] },
    answer: { kind: 'estimate', truth: p.truth, unit: p.unit, okWithinFactor: p.okWithinFactor, interval: false },
    claims: [],
    rev: prequestionRev(p),
    nsec: PRE_NSEC,
  }
  return { source: 'gen', inst }
}

const spread = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]?: V }))

/** The ledger write for an answered prequestion: `item` for a choice, `predict` for a number. */
export function preResponse(lessonId: string, index: number, p: Prequestion, r: ItemResult): ItemResponse {
  const base = {
    ref: preRef(lessonId, index),
    rev: prequestionRev(p),
    score: r.score,
    ok: r.ok,
    ...spread('conf', r.conf),
    ...spread('seed', r.seed),
    ...spread('ms', r.ms),
  }
  const kcs = p.kcs.slice(0, MAX_KCS)
  if (p.kind === 'numeric' && r.response.kind === 'estimate') {
    return { kind: 'predict', ...base, data: { value: r.response.value, unit: p.unit, truth: p.truth, src: 'pre', kcs, nsec: PRE_NSEC } }
  }
  return {
    kind: 'item',
    ...base,
    data: { src: 'pre', pick: r.pick ?? [], lessonId, kcs, nsec: PRE_NSEC, ...(r.grade.diagnosis ? { miss: r.grade.diagnosis.id } : {}) },
  }
}

/* ------------------------------ diagram prediction ------------------------------ */

/**
 * The prediction gate of a diagram, or null when the block has none or it cannot hold (the step must
 * leave a step before it and the step itself, and the options must be answerable).
 */
export function activePredict(block: { steps: readonly unknown[]; predictAt?: DiagramPredict }): DiagramPredict | null {
  const d = block.predictAt
  if (!d || !Number.isInteger(d.step) || d.step < 1 || d.step >= block.steps.length) return null
  return d.options.length >= 2 && d.correct.length > 0 ? d : null
}

/** The furthest step the learner may reach: one before the gated step until a choice is committed. */
export function maxStep(stepCount: number, d: DiagramPredict | null, committed: boolean): number {
  const last = Math.max(0, stepCount - 1)
  return d && !committed ? Math.min(last, d.step - 1) : last
}

/** Whether step `i`'s caption may show: the gated step and every later one stay hidden until a commit. */
export const captionVisible = (i: number, d: DiagramPredict | null, committed: boolean): boolean => committed || !d || i < d.step

/** The prompt shows on the step just before the gated one, until a choice is committed. */
export const promptVisible = (step: number, d: DiagramPredict | null, committed: boolean): boolean => !!d && !committed && step === d.step - 1

/** Whether an authored option index is among the correct ones. A prediction is a single pick. */
export const diagramPickOk = (d: DiagramPredict, pick: number): boolean => d.correct.includes(pick)

/** The ledger write for a committed diagram prediction (`item dia:<lessonId>#<blockIndex>`, `src: 'diagram'`). */
export function diaResponse(
  lessonId: string,
  blockIndex: number,
  d: DiagramPredict,
  pick: number,
  extra: { conf?: Confidence; ms?: number; seed?: number } = {},
): ItemResponse {
  const ok = diagramPickOk(d, pick)
  return {
    kind: 'item',
    ref: diaRef(lessonId, blockIndex),
    rev: diagramPredictRev(d),
    score: ok ? 1 : 0,
    ok,
    ...spread('conf', extra.conf),
    ...spread('seed', extra.seed),
    ...spread('ms', extra.ms === undefined ? undefined : Math.max(0, Math.round(extra.ms))),
    data: { src: 'diagram', pick: [pick], lessonId, kcs: d.kcs.slice(0, MAX_KCS), nsec: PRE_NSEC },
  }
}

/* ------------------------------ saved guesses ------------------------------ */

/** What the ledger remembers of one guess. */
export interface SavedGuess {
  ok: boolean
  /** Choice: the picked authored option indices. */
  pick?: number[]
  /** Numeric: the number the learner typed, in the prequestion's unit. */
  value?: number
  conf?: Confidence
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function guessOf(e: LedgerEvent): SavedGuess | null {
  const x = e as unknown as { ok?: unknown; conf?: unknown; data?: unknown }
  if (typeof x.ok !== 'boolean') return null
  const d = isRec(x.data) ? x.data : {}
  const out: SavedGuess = { ok: x.ok }
  if (Array.isArray(d.pick) && d.pick.every((n) => Number.isInteger(n))) out.pick = d.pick as number[]
  if (typeof d.value === 'number' && Number.isFinite(d.value)) out.value = d.value
  if (x.conf === 'guess' || x.conf === 'think' || x.conf === 'sure') out.conf = x.conf
  return out
}

/** The earliest event on `ref` graded against `rev`: the first answer is the honest one, and an edited item reads as unanswered. */
function firstGuess(events: readonly LedgerEvent[], ref: string, rev: string): SavedGuess | null {
  let best: LedgerEvent | null = null
  for (const e of events) {
    if (e.ref !== ref || (e as { rev?: string }).rev !== rev) continue
    if (e.kind !== 'item' && e.kind !== 'predict') continue
    if (best === null || e.at < best.at || (e.at === best.at && e.id < best.id)) best = e
  }
  return best ? guessOf(best) : null
}

/** Each prequestion's saved guess, in authored order (null = not answered yet). */
export function savedGuesses(events: readonly LedgerEvent[], lessonId: string, items: readonly Prequestion[]): (SavedGuess | null)[] {
  return items.map((p, i) => firstGuess(events, preRef(lessonId, i), prequestionRev(p)))
}

/** The saved prediction of a diagram, or null. */
export function savedPrediction(events: readonly LedgerEvent[], lessonId: string, blockIndex: number, d: DiagramPredict): SavedGuess | null {
  return firstGuess(events, diaRef(lessonId, blockIndex), diagramPredictRev(d))
}

/* ------------------------------ the reveal ------------------------------ */

export interface Reveal {
  /** "You said …": the option text(s) or the number with its unit. */
  said: string
  /** "It is …": the keyed option text(s) or the true number with its unit. */
  truth: string
  /** The learner's guess was right, or within the prequestion's factor. */
  ok: boolean
  /** Numeric, when it missed: how far off it was, "12×". */
  off?: string
  /** The why of the keyed options (choice). */
  because: string[]
  /** The why of a wrong pick, named after the pick (choice). */
  slip: string[]
}

const texts = (options: readonly string[], idx: readonly number[]): string[] =>
  [...new Set(idx)].filter((i) => i >= 0 && i < options.length).sort((a, b) => a - b).map((i) => options[i])

/** "You said X. It is Y, because …" (spec §9.1), from the authored item and what was saved. */
export function revealFor(p: Prequestion, g: SavedGuess): Reveal {
  if (p.kind === 'choice') {
    const pick = g.pick ?? []
    return {
      said: texts(p.options, pick).join(' and ') || 'nothing',
      truth: texts(p.options, p.correct).join(' and '),
      ok: g.ok,
      because: [...new Set(p.correct)].sort((a, b) => a - b).map((i) => p.why[i] ?? '').filter((w) => w !== ''),
      slip: g.ok ? [] : [...new Set(pick)].filter((i) => !p.correct.includes(i)).sort((a, b) => a - b).map((i) => p.why[i] ?? '').filter((w) => w !== ''),
    }
  }
  const v = g.value
  const ratio = v !== undefined && v > 0 && p.truth > 0 ? Math.max(v / p.truth, p.truth / v) : undefined
  return {
    said: v === undefined ? 'nothing' : `${formatNumber(v)} ${p.unit}`,
    truth: `${formatNumber(p.truth)} ${p.unit}`,
    ok: g.ok,
    ...(!g.ok && ratio !== undefined ? { off: `${formatNumber(ratio, ratio >= 10 ? 0 : 1)}×` } : {}),
    because: [],
    slip: [],
  }
}

/**
 * Whether the heading has scrolled out of view upward: its bottom edge is above the viewport. A heading
 * below the viewport, or still on screen, has not (spec §9.1).
 */
export const scrolledPast = (rect: { bottom: number }): boolean => rect.bottom < 0

/* ------------------------------ expert skip ------------------------------ */

/** Whether every KC is solid: placement marked it, or its card predicts recall ≥ 0.9 today. No KCs, no skip. */
export function isExpert(kcs: readonly string[], recall: (kc: string) => number | null, solid: ReadonlySet<string>): boolean {
  if (kcs.length === 0) return false
  return kcs.every((kc) => solid.has(kc) || (recall(kc) ?? 0) >= EXPERT_RECALL)
}

/** `placement:result`'s solid KCs, read defensively (a working record is JSON from any bundle). */
export function placementSolid(value: Json | undefined): Set<string> {
  if (!isRec(value) || !Array.isArray(value.solidKcs)) return new Set()
  return new Set(value.solidKcs.filter((k): k is string => typeof k === 'string'))
}

/** What the ledger-reading helpers need, so tests and the app pass what they have. */
export interface PreDeps {
  events(filter?: EventFilter): Promise<LedgerEvent[]>
  working: Partial<Record<WorkingKey, Json>>
  today: LocalDay
}

/** The façade as these helpers see it: `useProgress`. */
export interface ProgressLike {
  controls: { engine(): Promise<{ events(filter?: EventFilter): Promise<LedgerEvent[]> }> }
  getState(): { working: Partial<Record<WorkingKey, Json>> }
}

/** `PreDeps` over the live store. The engine loads on the first read (it would load for the next write anyway). */
export function depsFrom(store: ProgressLike, now: Date = new Date()): PreDeps {
  const at = now.toISOString()
  return {
    events: async (filter) => (await store.controls.engine()).events(filter),
    working: store.getState().working,
    today: dayOf(at, -now.getTimezoneOffset()),
  }
}

/** Every event on this lesson's refs of one prefix (`pre:` or `dia:`). */
export const eventsOf = (deps: PreDeps, prefix: 'pre' | 'dia', lessonId: string): Promise<LedgerEvent[]> =>
  deps.events({ refPrefix: `${prefix}:${lessonId}#` })

/** KC content is the same for every block on a page, and building it walks every lesson: once. */
let cardContent: Promise<CardsContent> | null = null
function loadCardContent(): Promise<CardsContent> {
  cardContent ??= Promise.all([
    import('@/data/kc'),
    import('@/data/lessons'),
    import('@/lib/kc/resolve'),
    import('./cards'),
  ]).then(([kc, lessons, resolve, cards]) => {
    const content = resolve.buildKcContent({ lessons: lessons.ALL_LESSONS })
    return cards.cardsContent({
      kcs: kc.KCS,
      lessons: lessons.ALL_LESSONS,
      bootKcs: kc.BOOT_KCS,
      resolve: (e) => resolve.kcsOfEvent(e, content),
    })
  })
  cardContent.catch(() => {
    cardContent = null
  })
  return cardContent
}

/** The week plan fields cards read, or null (a missing or odd plan is the default one). */
function planOf(v: Json | undefined): CardsPlan | null {
  if (!isRec(v)) return null
  return {
    ...(v.slo === 0.85 || v.slo === 0.9 ? { slo: v.slo } : {}),
    ...(typeof v.sessionMinutes === 'number' ? { sessionMinutes: v.sessionMinutes } : {}),
  }
}

/**
 * Whether the learner already knows what a block asks about (the expert skip, spec §9.1 and §9.2).
 * Placement-solid KCs need no ledger read; otherwise the cards are derived from the whole ledger and each KC
 * needs a card with predicted recall ≥ 0.9 today. Never throws: when the ledger cannot be read the block asks.
 */
export async function expertFor(kcs: readonly string[], deps: PreDeps): Promise<boolean> {
  if (kcs.length === 0) return false
  try {
    const solid = placementSolid(deps.working['placement:result'])
    if (kcs.every((k) => solid.has(k))) return true
    const [events, content, cards] = await Promise.all([deps.events(), loadCardContent(), import('./cards')])
    const set = cards.deriveCards(events, content, deps.today, planOf(deps.working['boot:week']), { placement: { solidKcs: [...solid] } })
    return isExpert(
      kcs,
      (kc) => {
        const card = set.cards[kc]
        return card ? cards.cardRetrievability(card, deps.today) : null
      },
      solid,
    )
  } catch {
    return false
  }
}
