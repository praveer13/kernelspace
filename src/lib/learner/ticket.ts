/**
 * Exit tickets, the spiral checkpoint and test-out (docs/specs/wave-1.md §7.2, §8.1, §8.6; owner answer O7).
 *
 * `planTicket` turns a lesson, the learner's history and a seed into the items of one attempt. Pure and
 * deterministic per seed (verify-determinism lints this file): the clock is a parameter, randomness is the
 * seed, and generated items come through an injected `TicketPool`, so the generator families (which load
 * lazily) and the ledger stay outside this module.
 *
 * - Ticket and test-out: 3 items. The non-MCQ is a generated numeric or estimate item at level 2 when a
 *   family covers a lesson KC, else a self-checked constructed response (rotating on retries). The other
 *   two are checkpoint questions. Pass: at least 2 of 3 and the non-MCQ right.
 * - Spiral (t2.l7): 8 items, 4 on the lesson's own KCs and 4 on earlier T0-T2 KCs (lowest predicted recall
 *   first among carded KCs, else curriculum order), at least 2 non-MCQ. Pass: at least 6 of 8 and at least
 *   one non-MCQ right.
 * - Display order puts the multiple-choice items first, so they warm up recall for the answer that has to
 *   be produced.
 * - Nothing here locks anything (W8): a miss is evidence, and the caller always offers new numbers and
 *   continue-anyway. A test-out is limited to one per lesson per local day.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { Lesson, QuizBlockData } from '@/data/lessons/types'
import { seedFor } from '@/lib/items/core'
import type { ItemResult } from '@/lib/items/play'
import { MEASURE_LEVEL } from '@/lib/items/staircase'
import type { AuthoredItem, ConstructedPrompt, Gen, Level, PlayableItem } from '@/lib/items/types'
import type { Kc, KcId } from '@/lib/kc/types'
import type { ItemData, ItemResponse, LedgerEvent, LocalDay, TicketAttempt, TicketForm } from '@/lib/ledger/types'
import { hash32 } from '@/lib/rng'
import type { ItemPool } from './composer'
import type { TicketPlan } from './types'

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

type PassRule = TicketPlan['passRule']

/** Ticket and test-out (spec §8.1, §7.2): at least 2 of 3, and the non-MCQ right. */
export const TICKET_RULE: PassRule = { minCorrect: 2, requireNonMcq: true }
/** Spiral checkpoint (spec §8.6): at least 6 of 8, with at least one non-MCQ right. */
export const SPIRAL_RULE: PassRule = { minCorrect: 6, requireNonMcq: true }

export const TICKET_ITEMS = 3
export const SPIRAL_ITEMS = 8
/** The spiral's split: items on the lesson's own KCs (one non-MCQ among them) and items on earlier KCs. */
const SPIRAL_OWN = 4
const SPIRAL_EARLIER = 4
/** At least this many of the spiral's 8 are non-MCQ. */
export const SPIRAL_MIN_NON_MCQ = 2
/** Instances tried on fresh seeds before a family is given up on for a non-MCQ item. */
const GEN_TRIES = 12

const passRuleOf = (form: TicketForm): PassRule => ({ ...(form === 'spiral' ? SPIRAL_RULE : TICKET_RULE) })

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

/** What a ticket needs of the generators: the families that cover a KC, and one instance on a seed. */
export type TicketPool = Pick<ItemPool, 'families' | 'make'>

export interface TicketContent {
  pool: TicketPool
  /** Spiral only: the KCs of earlier T0-T2 lessons, in curriculum order (`earlierKcsOf`). */
  earlier?: readonly KcId[]
  /** Spiral only: the predicted recall now of a carded KC, null for a KC with no card. */
  recall?(kc: KcId): number | null
}

/** The part of a lesson a ticket reads. */
export type TicketLesson = Pick<Lesson, 'id' | 'blocks'> & Partial<Pick<Lesson, 'kcs' | 'ticket'>>

export interface PlanOptions {
  /** Defaults to the lesson's `ticket.form`, else `ticket`. A test-out passes `testout`. */
  form?: TicketForm
  /** Item refs to put last in line (what "New numbers" has just shown), so a retry meets other questions. */
  avoid?: ReadonlySet<string>
}

/** A pool over loaded families: a KC is served by the variants that list it, so a ticket never gets an off-KC item. */
export function makeGenPool(gens: ReadonlyMap<string, Gen>, familiesOf: (kc: KcId) => readonly string[]): TicketPool {
  return {
    families: (kc) => familiesOf(kc).filter((f) => gens.has(f)),
    make: (family, kc, level: Level, seed) => {
      const gen = gens.get(family)
      if (!gen) return null
      const offered = gen.variants.filter((v) => v.kcs.includes(kc) && v.levels.includes(level))
      if (offered.length === 0) return null
      try {
        return { source: 'gen', inst: gen.make(seed, level, offered[seed % offered.length].id) }
      } catch {
        return null
      }
    },
  }
}

const LESSON_ID = /^t(\d)\.l(\d+)$/

/** Curriculum position of a T0-T7 lesson id, or null (`r.l1`, anything else). */
function lessonPos(id: string): number | null {
  const m = LESSON_ID.exec(id)
  return m ? Number(m[1]) * 100 + Number(m[2]) : null
}

/**
 * The KCs a spiral draws its earlier items from: T0-T2 KCs first taught in a lesson before `lessonId`,
 * in the graph's order (each track in lesson order). R is left out: the spiral is a T0-T2 checkpoint.
 */
export function earlierKcsOf(lessonId: string, kcs: readonly Kc[]): KcId[] {
  const at = lessonPos(lessonId)
  if (at === null) return []
  return kcs
    .filter((k) => {
      const first = k.lessons[0] === undefined ? null : lessonPos(k.lessons[0])
      return first !== null && first < at && (k.track === 't0' || k.track === 't1' || k.track === 't2')
    })
    .map((k) => k.id)
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

/** True for an item answered by producing something: a generated numeric or estimate, or a constructed response. */
export function isNonMcq(item: PlayableItem): boolean {
  return item.source === 'cr' || (item.source === 'gen' && item.inst.answer.kind !== 'choice')
}

function itemKey(item: PlayableItem): string {
  switch (item.source) {
    case 'gen':
      return `gen:${item.inst.family}/${item.inst.variant}#${item.inst.rev}`
    case 'quiz':
      return `quiz:${item.lessonId}#${item.qi}`
    case 'cr':
      return `cr:${item.lessonId}#${item.index}`
    case 'item':
      return `item:${item.item.id}`
  }
}

/** The ledger ref of an item, as a history lookup key (a generated item has no stable ref across seeds). */
function refOf(item: PlayableItem): string {
  return item.source === 'gen' ? `gen:${item.inst.family}/${item.inst.variant}` : itemKey(item)
}

/** Lexicographic order over small number tuples. */
function byKey<T>(key: (x: T) => number[]): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]
    return 0
  }
}

/**
 * A generated numeric or estimate item for the first KC with a family that can make one, at level 2 on
 * seeds drawn from the ticket's seed (fresh per attempt: that is what makes the item `unseen`). A variant
 * that is multiple choice is skipped, so the draw moves on to the next seed.
 */
function genNonMcq(kcs: readonly KcId[], pool: TicketPool, seed: number, salt: number): PlayableItem | null {
  for (const kc of kcs) {
    const families = pool.families(kc)
    if (families.length === 0) continue
    for (let t = 0; t < GEN_TRIES; t++) {
      const s = seedFor(seed, salt + t)
      const item = pool.make(families[s % families.length], kc, MEASURE_LEVEL, s)
      if (item && isNonMcq(item)) return item
    }
  }
  return null
}

/** Any generated item for the KC, for filling a spiral when no authored item is left. */
function genAny(kc: KcId, pool: TicketPool, seed: number, salt: number): PlayableItem | null {
  const families = pool.families(kc)
  if (families.length === 0) return null
  const s = seedFor(seed, salt)
  return pool.make(families[s % families.length], kc, MEASURE_LEVEL, s)
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

interface History {
  /** Item ref (`quiz:` or `cr:`) → the latest instant the learner answered it, in any attempt. */
  answered: Map<string, string>
  /** The learner's last attempt at this lesson (the latest `quiz` event with a group): refs shown, refs right. */
  shown: Set<string>
  correct: Set<string>
}

const dataOf = (e: LedgerEvent): Record<string, unknown> => {
  const d = (e as { data?: unknown }).data
  return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : {}
}

const newer = (a: LedgerEvent, b: LedgerEvent): boolean => (a.at === b.at ? a.id > b.id : a.at > b.at)

function historyOf(events: readonly LedgerEvent[], lessonId: string): History {
  const quizPrefix = `quiz:${lessonId}#`
  const crPrefix = `cr:${lessonId}#`
  const answered = new Map<string, string>()
  let last: LedgerEvent | undefined
  for (const e of events) {
    if (e.kind === 'item' && (e.ref.startsWith(quizPrefix) || e.ref.startsWith(crPrefix))) {
      const at = answered.get(e.ref)
      if (at === undefined || e.at > at) answered.set(e.ref, e.at)
    } else if (e.kind === 'quiz' && e.ref === `lesson:${lessonId}` && typeof dataOf(e).grp === 'string') {
      if (!last || newer(e, last)) last = e
    }
  }
  const shown = new Set<string>()
  const correct = new Set<string>()
  const grp = last === undefined ? undefined : dataOf(last).grp
  if (grp !== undefined) {
    for (const e of events) {
      if (e.kind !== 'item' || dataOf(e).grp !== grp || !(e.ref.startsWith(quizPrefix) || e.ref.startsWith(crPrefix))) continue
      shown.add(e.ref)
      if (e.ok) correct.add(e.ref)
    }
  }
  return { answered, shown, correct }
}

/** True when the learner has already used this lesson's test-out on local day `day` (any verdict). */
export function testOutUsedToday(events: readonly LedgerEvent[], lessonId: string, day: LocalDay): boolean {
  return events.some((e) => e.kind === 'quiz' && e.ref === `lesson:${lessonId}` && e.day === day && dataOf(e).form === 'testout')
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

interface QuizCand {
  qi: number
  item: Extract<PlayableItem, { source: 'quiz' }>
}

/** Picks `k` checkpoint questions, best first; `covered` grows with each pick, so a second question prefers new KCs. */
function pickQuestions(
  cands: readonly QuizCand[],
  k: number,
  covered: Set<KcId>,
  avoid: ReadonlySet<string>,
  seed: number,
  rank: (c: QuizCand) => number[],
): QuizCand[] {
  const left = [...cands]
  const out: QuizCand[] = []
  const isCovered = (c: QuizCand) => c.item.kcs.length > 0 && c.item.kcs.every((kc) => covered.has(kc))
  while (out.length < k && left.length > 0) {
    left.sort(
      byKey((c) => [avoid.has(refOf(c.item)) ? 1 : 0, isCovered(c) ? 1 : 0, ...rank(c), hash32(`${seed}:${refOf(c.item)}`)]),
    )
    const [best] = left.splice(0, 1)
    out.push(best)
    for (const kc of best.item.kcs) covered.add(kc)
  }
  return out
}

/** The constructed response to ask: the one answered longest ago (never answered first), then the lowest index. */
function pickCr(lesson: TicketLesson, history: History, avoid: ReadonlySet<string>): PlayableItem | null {
  const crs: ConstructedPrompt[] = lesson.ticket?.cr ?? []
  if (crs.length === 0) return null
  const ranked = crs
    .map((cr, index) => ({ cr, index, ref: `cr:${lesson.id}#${index}` }))
    .sort((a, b) => {
      const aa = avoid.has(a.ref) ? 1 : 0
      const ab = avoid.has(b.ref) ? 1 : 0
      if (aa !== ab) return aa - ab
      const ta = history.answered.get(a.ref) ?? ''
      const tb = history.answered.get(b.ref) ?? ''
      return ta === tb ? a.index - b.index : ta < tb ? -1 : 1
    })
  const { cr, index } = ranked[0]
  return { source: 'cr', lessonId: lesson.id, index, cr }
}

/** The spiral's four earlier-KC items (spec §8.6), or null when the lesson cannot supply them. */
function spiralItems(
  lesson: TicketLesson,
  content: TicketContent,
  avoid: ReadonlySet<string>,
  seed: number,
  needNonMcq: number,
): PlayableItem[] | null {
  const authored: readonly AuthoredItem[] = lesson.ticket?.spiral ?? []
  const own = new Set(lesson.kcs ?? [])
  const universe = [...(content.earlier ?? [])]
  for (const a of authored) for (const kc of a.kcs) if (!universe.includes(kc)) universe.push(kc)
  const entries = universe
    .filter((kc) => !own.has(kc))
    .map((kc, i) => ({ kc, i, recall: content.recall?.(kc) ?? null }))
  // carded KCs by lowest predicted recall, then the rest in curriculum order
  const carded = entries.filter((x) => x.recall !== null).sort((a, b) => (a.recall as number) - (b.recall as number) || a.i - b.i)
  const ordered = [...carded, ...entries.filter((x) => x.recall === null)].map((x) => x.kc)
  const priority = new Map(ordered.map((kc, i) => [kc, i]))

  const picked: { kc: KcId; item: PlayableItem }[] = []
  const used = new Set<string>()
  const take = (kc: KcId, item: PlayableItem) => {
    used.add(itemKey(item))
    picked.push({ kc, item })
  }
  const authoredFor = (kc: KcId) =>
    authored
      .filter((a) => a.kcs.includes(kc) && !used.has(`item:${a.id}`))
      .sort(byKey((a) => [avoid.has(`item:${a.id}`) ? 1 : 0, a.kcs[0] === kc ? 0 : 1, hash32(`${seed}:${a.id}`)]))

  // the non-MCQ items first: they are scarce, and a spiral without them cannot pass
  let need = needNonMcq
  for (const [i, kc] of ordered.entries()) {
    if (need <= 0) break
    const item = genNonMcq([kc], content.pool, seed, 300 + i * GEN_TRIES)
    if (item) {
      take(kc, item)
      need -= 1
    }
  }
  if (need > 0) return null

  for (const [i, kc] of ordered.entries()) {
    if (picked.length >= SPIRAL_EARLIER) break
    if (picked.some((p) => p.kc === kc)) continue
    const [a] = authoredFor(kc)
    const item: PlayableItem | null = a ? { source: 'item', item: a } : genAny(kc, content.pool, seed, 700 + i)
    if (item && !used.has(itemKey(item))) take(kc, item)
  }
  // a short list of KCs: a second authored item from a KC already used
  for (const kc of ordered) {
    while (picked.length < SPIRAL_EARLIER) {
      const [a] = authoredFor(kc)
      if (!a) break
      take(kc, { source: 'item', item: a })
    }
  }
  if (picked.length < SPIRAL_EARLIER) return null
  return picked.sort((a, b) => (priority.get(a.kc) ?? 0) - (priority.get(b.kc) ?? 0)).map((p) => p.item)
}

/**
 * The items of one attempt, or null when the lesson cannot supply a valid one (too few checkpoint
 * questions, no way to ask a non-MCQ, a spiral with too few earlier items). The caller then falls back to
 * the lesson's checkpoint, so a lesson is never stranded without a way to finish (W8).
 *
 * `events` is the learner's ledger (any superset of the lesson's `quiz:`, `cr:` and `lesson:` events). `seed`
 * is fresh per attempt: it drives every generated item's seed and every tie.
 */
export function planTicket(
  lesson: TicketLesson,
  content: TicketContent,
  events: readonly LedgerEvent[],
  seed: number,
  opts: PlanOptions = {},
): TicketPlan | null {
  const form = opts.form ?? lesson.ticket?.form ?? 'ticket'
  const spiral = form === 'spiral'
  const testout = form === 'testout'
  const avoid = opts.avoid ?? new Set<string>()
  const history = historyOf(events, lesson.id)
  const lessonKcs = lesson.kcs ?? []

  const nonMcq = genNonMcq(lessonKcs, content.pool, seed, 100) ?? pickCr(lesson, history, avoid)
  if (!nonMcq) return null

  const quiz = lesson.blocks.find((b): b is QuizBlockData => b.type === 'quiz')
  const cands: QuizCand[] = (quiz?.questions ?? []).map((q: QuizQuestion, qi) => ({
    qi,
    item: { source: 'quiz', lessonId: lesson.id, qi, q, kcs: q.kcs && q.kcs.length > 0 ? [...q.kcs] : [...lessonKcs] },
  }))
  const covered = new Set<KcId>(nonMcq.source === 'gen' ? nonMcq.inst.kcs : nonMcq.source === 'cr' ? nonMcq.cr.kcs : [])
  // a test-out meets questions the learner has never answered; a ticket retry meets ones not right last time
  const rank = testout
    ? (c: QuizCand) => [history.answered.has(refOf(c.item)) ? 1 : 0]
    : (c: QuizCand) => [history.correct.has(refOf(c.item)) ? 1 : 0, history.shown.has(refOf(c.item)) ? 1 : 0]
  const mcqs = pickQuestions(cands, spiral ? SPIRAL_OWN - 1 : TICKET_ITEMS - 1, covered, avoid, seed, rank)
  if (mcqs.length < (spiral ? SPIRAL_OWN - 1 : TICKET_ITEMS - 1)) return null

  const items: PlayableItem[] = mcqs.map((c) => c.item)
  const produced: PlayableItem[] = [nonMcq]
  if (spiral) {
    const earlier = spiralItems(lesson, content, avoid, seed, SPIRAL_MIN_NON_MCQ - 1)
    if (!earlier) return null
    for (const it of earlier) (isNonMcq(it) ? produced : items).push(it)
  }
  // item 1 is shown last: the multiple-choice items warm up recall for the answer that has to be produced
  const ordered = [...items, ...produced]
  return {
    lessonId: lesson.id,
    form,
    seed,
    items: ordered,
    nonMcqIndex: ordered.findIndex(isNonMcq),
    passRule: passRuleOf(form),
  }
}

/* ------------------------------------------------------------------ */
/* Verdict and the ledger write                                        */
/* ------------------------------------------------------------------ */

export interface TicketVerdict {
  correct: number
  of: number
  /** At least one non-MCQ item was right (for a ticket, the non-MCQ item). */
  nonMcqOk: boolean
  ok: boolean
}

/** The pass rule over per-item verdicts, in display order. An item not yet answered counts as wrong. */
export function judgeTicket(plan: Pick<TicketPlan, 'items' | 'passRule'>, oks: readonly boolean[]): TicketVerdict {
  const of = plan.items.length
  const right = plan.items.map((_, i) => oks[i] === true)
  const correct = right.filter(Boolean).length
  const nonMcqOk = plan.items.some((it, i) => isNonMcq(it) && right[i])
  const ok = correct >= plan.passRule.minCorrect && (!plan.passRule.requireNonMcq || nonMcqOk)
  return { correct, of, nonMcqOk, ok }
}

/** What one finished item adds to the ledger event (the façade stamps `src`, `form`, `grp`, `slot` and `of`). */
function itemData(r: ItemResult): ItemData {
  const resp = r.response
  const g = r.grade
  const data: ItemData = { src: 'ticket', kcs: r.kcs, nsec: r.nsec }
  if (r.level !== undefined) data.level = r.level
  if (r.variant !== undefined) data.variant = r.variant
  if (r.pick) data.pick = r.pick
  if (r.ideas) data.ideas = r.ideas
  if (g.diagnosis) data.miss = g.diagnosis.id
  if (resp.kind === 'choice' && r.source === 'gen') data.picks = [...resp.picks]
  if (resp.kind === 'numeric') {
    data.value = resp.value
    if (resp.unit !== undefined) data.unit = resp.unit
  }
  if (resp.kind === 'estimate') {
    data.value = resp.value
    if (resp.lo !== undefined && resp.hi !== undefined) {
      data.lo = resp.lo
      data.hi = resp.hi
      if (g.interval) data.hit = g.interval.hit
    }
  }
  return data
}

/**
 * The `recordTicket` input for a finished attempt: one response per item in display order, and the
 * verdict of the pass rule. A generated item is on a fresh seed, so it carries `unseen`; an authored
 * question or constructed response is `practice` (V6). The constructed response is self-assessed.
 */
export function ticketAttempt(plan: TicketPlan, results: readonly ItemResult[], ms?: number): TicketAttempt {
  const verdict = judgeTicket(plan, results.map((r) => r.ok))
  const src = plan.form === 'testout' ? 'testout' : 'ticket'
  const responses: TicketAttempt['responses'] = results.map((r): Omit<ItemResponse, 'kind'> => ({
    ref: r.ref as ItemResponse['ref'],
    rev: r.rev,
    score: r.score,
    ok: r.ok,
    ...(r.conf ? { conf: r.conf } : {}),
    seed: r.seed,
    ms: r.ms,
    provenance: r.source === 'gen' ? 'unseen' : 'practice',
    data: { ...itemData(r), src },
  }))
  return {
    lessonId: plan.lessonId,
    form: plan.form,
    seed: plan.seed,
    ...(ms === undefined ? {} : { ms: Math.max(0, Math.round(ms)) }),
    responses,
    ok: verdict.ok,
    nonMcqOk: verdict.nonMcqOk,
  }
}
