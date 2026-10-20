/**
 * K5 track forms A, B and C (docs/specs/wave-3.md §12.6; task 3b-19): three parallel 12-item forms per track on seeds
 * the learner has not met, offered once each and never gating. Measurement only: a form item is graded and pays XP like
 * any item, but never reschedules a card (W18; `isFormItem` in cards.ts) and never counts for VRK30 or competence.
 *
 * - **Parallel.** A track's blueprint is fixed by its KCs and its loaded families alone: 12 slots over the track's
 *   generator-covered KCs at level 2, each slot a (KC, family, variant). Form A, B and C draw the same blueprint on
 *   different seeds, so they differ in numbers and not in what they ask. A track with fewer than 3 such KCs has no forms
 *   (`formsFor` gives null): T0, T2 and T3 on the Wave 3 base.
 * - **Unseen.** Three disjoint seed sets per track come from the learner's `exp:seed`
 *   (`hash32('forms:' + track + ':' + set + ':' + i + ':' + expSeed)`), so the seeds differ between learners, and no
 *   two items of a track's three forms share a fingerprint (`Instance.rev`), so a form never repeats an item of another.
 *   The sets are drawn in set order 0, 1, 2, each against the fingerprints of the sets below it, so what a seed set holds
 *   (a collision's bumped draw included) depends on the learner's seed and the set alone, never on which form it serves.
 * - **Counterbalanced.** Which seed set is form A, B or C is one of the 6 permutations, `armOf('forms', track, expSeed, 6)`
 *   (experiments.ts), so across learners each set serves each form equally often and a set that happens to be harder
 *   does not look like learning.
 * - **On the KC.** Every slot is drawn with `drawOnKc(kc, seed, (s) => gen.make(s, 2, variant))`, so it carries its KC
 *   and the 3-KC rule and the per-KC readers see the right items.
 * - **Timing** (`formWindows`): A is offered until a lesson of the track is done, B once the track's closing lesson is
 *   passed (its spiral checkpoint where it has one, else its last lesson is done), C at least 30 days after B was
 *   finished. Nothing is ever locked on a form, and a form is opt-in.
 * - **Recording.** `formItemResponse` writes src `form` with `{formId, track, formSlot, formSet}`; the ticket's `form`
 *   and the Today position `slot` are never used (the codec refuses them on a form item).
 *
 * Draws run inside `settle()` (src/lib/items/on-demand.ts): the compile family's `make` throws `NotReady` until its bank
 * group has loaded, so `buildForms` asks for every group it needs, carries on, and stops with the `NotReady` at the end;
 * `settle` then runs it again once the groups landed. The run that misses nothing is the same one a runtime with every
 * group in hand makes, so a form never changes with load timing.
 *
 * Pure and deterministic per `exp:seed` (verify-determinism lints this file): no clock, no randomness.
 */

import type { Lesson } from '@/data/lessons/types'
import { NotReady, settle } from '@/lib/items/on-demand'
import type { ItemResult } from '@/lib/items/play'
import type { Gen, Instance, Level, PlayableItem } from '@/lib/items/types'
import type { Kc, KcId } from '@/lib/kc/types'
import type { IsoInstant, ItemData, ItemResponse, LedgerEvent, LessonAgg, LocalDay } from '@/lib/ledger/types'
import { hash32 } from '@/lib/rng'
import { armOf } from './experiments'
import { drawOnKc } from './on-kc'
import { proportionOf, type Proportion } from './proportion'
import { addDays, daysBetween } from './reentry'
import { itemResponseOf } from './today'
import { asOf } from './vrk'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export type FormId = 'A' | 'B' | 'C'
export type FormSet = 0 | 1 | 2

export const FORM_IDS: readonly FormId[] = ['A', 'B', 'C']
/** The three seed sets, in the order they are drawn. */
const SEED_SETS: readonly FormSet[] = [0, 1, 2]
/** Items in a form. One item is 100 ÷ 12 = 8.3 points, so only track-level results are shown, with intervals. */
export const FORM_SLOTS = 12
/** Every form item is drawn at the independent level (family docs: level 2 = independent, single KC). */
export const FORM_LEVEL: Level = 2
/** A track needs this many generator-covered KCs to have forms. */
export const MIN_FORM_KCS = 3
/** C is offered this many local days after B was finished. */
export const C_AFTER_B_DAYS = 30
/** The experiment name `armOf` hashes with the track and the learner's seed. */
export const FORMS_EXPERIMENT = 'forms'
/** Seeds tried for a slot (the first is the spec's formula) before it gives up on an option. */
const MAX_BUMPS = 8

/**
 * The 6 permutations of the three seed sets, in lexicographic order: entry `[a, b, c]` means form A uses seed set `a`,
 * form B set `b` and form C set `c`. `armOf('forms', track, expSeed, 6)` picks the entry.
 */
export const FORM_ORDERS: readonly (readonly [FormSet, FormSet, FormSet])[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]

/** The seed sets of forms A, B and C for this learner on this track. */
export const formOrder = (track: string, expSeed: number): readonly [FormSet, FormSet, FormSet] =>
  FORM_ORDERS[armOf(FORMS_EXPERIMENT, track, expSeed, FORM_ORDERS.length)]

/**
 * The seed of slot `i` of seed set `set` on `track` for the learner whose `exp:seed` is `expSeed`: the spec's
 * `hash32('forms:' + track + ':' + set + ':' + i + ':' + expSeed)`. `bump` is 0 except when a draw has to move on
 * (the instance did not carry the KC on any redraw, or repeated an item of another form).
 */
export const formSeed = (track: string, set: FormSet, i: number, expSeed: number, bump = 0): number =>
  hash32(`forms:${track}:${set}:${i}:${expSeed}${bump === 0 ? '' : `:${bump}`}`)

/** The ledger group of a form's items, `data.grp`. */
export const formGrp = (track: string, formId: FormId): string => `form:${track}:${formId}`

/* ------------------------------------------------------------------ */
/* The blueprint                                                       */
/* ------------------------------------------------------------------ */

/** One slot of a track's blueprint, the same in all three forms. */
export interface BlueprintSlot {
  slot: number
  kc: KcId
  family: string
  variant: string
}

interface Option {
  family: string
  variant: string
}

interface Covered {
  kc: KcId
  options: Option[]
}

export interface FormsInput {
  /** The generator families that loaded, by id. */
  gens: ReadonlyMap<string, Gen>
  /** The KC graph. */
  kcs: readonly Kc[]
  /** The learner's `exp:seed`. */
  expSeed: number
}

/**
 * What a run has asked for and not got. A probe or a draw that stops on `NotReady` has already asked for its bank group
 * (`want`), so the run carries on, asks for every other group too, and stops with the first `NotReady` at the end.
 */
interface Run {
  missing: NotReady | null
}

function guarded<T>(run: Run, work: () => T, otherwise: T): T {
  try {
    return work()
  } catch (e) {
    if (!(e instanceof NotReady)) throw e
    run.missing ??= e
    return otherwise
  }
}

/** One draw of `variant` at the form level that carries `kc`: the spec's `drawOnKc(kc, seed, (s) => gen.make(s, 2, variant))`. */
const drawOnKcAt = (gen: Gen, variant: string, kc: KcId, seed: number): Instance | null => drawOnKc(kc, seed, (s) => gen.make(s, FORM_LEVEL, variant))

/** The seed a (KC, option) pair is probed at: fixed by the pair alone, so the blueprint never depends on a learner. */
const probeSeed = (kc: KcId, o: Option): number => hash32(`forms:probe:${kc}:${o.family}/${o.variant}`)

/**
 * The (family, variant) pairs of loaded families that serve `kc` at the form level, in the KC's own family order. A
 * variant that lists level 2 is not enough: a few variants teach a KC only at a higher level (kv's `t5.gqa-kv-heads`,
 * on-kc.ts), so a pair counts only when an instance at level 2 carries the KC. While a bank group is missing the pair is
 * assumed to serve, and the run stops on the missing group at its end.
 */
function optionsOf(kc: Kc, input: FormsInput, run: Run): Option[] {
  const out: Option[] = []
  for (const family of kc.gen ?? []) {
    const gen = input.gens.get(family)
    if (!gen) continue
    for (const v of gen.variants) {
      if (!v.kcs.includes(kc.id) || !v.levels.includes(FORM_LEVEL) || v.blockOnly) continue
      const o = { family, variant: v.id }
      if (guarded(run, () => drawOnKcAt(gen, v.id, kc.id, probeSeed(kc.id, o)) !== null, true)) out.push(o)
    }
  }
  return out
}

/** The track's generator-covered KCs in the graph's order, thinned to evenly spaced when there are more than 12. */
function coveredKcs(track: string, input: FormsInput, run: Run): Covered[] {
  const all = input.kcs
    .filter((k) => k.track === track)
    .map((k) => ({ kc: k.id, options: optionsOf(k, input, run) }))
    .filter((c) => c.options.length > 0)
  if (all.length <= FORM_SLOTS) return all
  return Array.from({ length: FORM_SLOTS }, (_, i) => all[Math.floor((i * all.length) / FORM_SLOTS)])
}

/**
 * Slot `i` takes KC `i mod n` and that KC's option `floor(i / n) mod options`, so every KC is asked about (the slots go
 * round the KCs) and a KC with several variants is asked a different way each round. Null with fewer than 3 covered KCs.
 */
function blueprintOf(covered: readonly Covered[]): BlueprintSlot[] | null {
  if (covered.length < MIN_FORM_KCS) return null
  return Array.from({ length: FORM_SLOTS }, (_, slot) => {
    const c = covered[slot % covered.length]
    const o = c.options[Math.floor(slot / covered.length) % c.options.length]
    return { slot, kc: c.kc, family: o.family, variant: o.variant }
  })
}

/**
 * The track's 12 slots, or null with fewer than 3 covered KCs. It depends on the KC graph and the loaded families alone,
 * never on a seed, so forms A, B and C of every learner ask the same thing. Like `buildForms` it throws `NotReady` while a
 * bank group is missing; call it under `settle`.
 */
export function formBlueprint(track: string, input: Pick<FormsInput, 'gens' | 'kcs'>): BlueprintSlot[] | null {
  const run: Run = { missing: null }
  const blueprint = blueprintOf(coveredKcs(track, { ...input, expSeed: 0 }, run))
  if (run.missing) throw run.missing
  return blueprint
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

export interface FormSlot extends BlueprintSlot {
  inst: Instance
}

export interface FormPlan {
  id: FormId
  /** The seed set this form draws from (0 to 2). */
  set: FormSet
  slots: FormSlot[]
}

export interface TrackForms {
  track: string
  expSeed: number
  /** Seed set of forms A, B and C. */
  order: readonly [FormSet, FormSet, FormSet]
  /** The distinct KCs the slots cover, in blueprint order (at least 3). */
  kcs: KcId[]
  forms: Record<FormId, FormPlan>
}

/**
 * One slot of one seed set: the first instance on the KC at a seed whose item no earlier slot of this track used, trying
 * the slot's own option first and the KC's other options after it.
 */
function drawSlot(track: string, set: FormSet, b: BlueprintSlot, covered: Covered, input: FormsInput, used: Set<string>): Instance | null {
  const at = covered.options.findIndex((o) => o.family === b.family && o.variant === b.variant)
  for (let k = 0; k < covered.options.length; k++) {
    const o = covered.options[(at + k) % covered.options.length]
    const gen = input.gens.get(o.family)
    if (!gen) continue
    for (let bump = 0; bump < MAX_BUMPS; bump++) {
      const inst = drawOnKcAt(gen, o.variant, b.kc, formSeed(track, set, b.slot, input.expSeed, bump))
      if (inst === null || used.has(inst.rev)) continue
      used.add(inst.rev)
      return inst
    }
  }
  return null
}

/**
 * Forms A, B and C of `track`, synchronously, or null when the track has no forms or a slot cannot be drawn. It throws
 * `NotReady` (after asking for every missing bank group, so one round trip loads them all) when an instance needs data
 * that has not loaded; call it through `formsFor`, which runs it under `settle`.
 */
export function buildForms(track: string, input: FormsInput): TrackForms | null {
  const run: Run = { missing: null }
  const covered = coveredKcs(track, input, run)
  const blueprint = blueprintOf(covered)
  if (blueprint === null) {
    if (run.missing) throw run.missing
    return null
  }
  const byKc = new Map(covered.map((c) => [c.kc, c] as const))
  const order = formOrder(track, input.expSeed)
  // Draw by seed set (0, 1, 2), not in form order A, B, C: the dedupe set a draw meets then holds only the sets below it,
  // so a set's bumped draw is the same whichever form the shuffle assigns it to (a fingerprint collision moves the same slot).
  const used = new Set<string>()
  let failed = false
  const bySet: FormSlot[][] = [[], [], []]
  for (const set of SEED_SETS) {
    for (const b of blueprint) {
      const inst = guarded(run, () => drawSlot(track, set, b, byKc.get(b.kc)!, input, used), null)
      if (inst !== null) bySet[set].push({ ...b, family: inst.family, variant: inst.variant, inst })
      else if (run.missing === null) failed = true
    }
  }
  const forms = {} as Record<FormId, FormPlan>
  FORM_IDS.forEach((id, j) => {
    forms[id] = { id, set: order[j], slots: bySet[order[j]] }
  })
  if (run.missing) throw run.missing
  if (failed) return null
  return { track, expSeed: input.expSeed, order, kcs: [...new Set(blueprint.map((b) => b.kc))], forms }
}

/**
 * Forms A, B and C of `track` for the learner whose `exp:seed` is `input.expSeed`, or null when the track has fewer than
 * 3 generator-covered KCs. The draws run inside `settle()` as Today's start flow does, so a bank group that has not
 * loaded is fetched and the draw run again, and the result is the one every group in hand gives. Rejects with
 * `NotReady` when a group could not be loaded: the caller says so and offers another try, as Today does.
 */
export function formsFor(track: string, input: FormsInput): Promise<TrackForms | null> {
  return settle(() => buildForms(track, input))
}

/* ------------------------------------------------------------------ */
/* The ledger                                                          */
/* ------------------------------------------------------------------ */

export interface FormCtx {
  track: string
  formId: FormId
  formSlot: number
  formSet: FormSet
}

/**
 * The ledger write for one answered form item: Today's `itemResponseOf` (one mapping from a result to an event) with the
 * form's identity instead of a session slot: `src: 'form'`, `{formId, track, formSlot, formSet}`, and no `slot`, `of`,
 * `reason` or `form` (those mean the Today position and the ticket form; the codec refuses `form` and `slot` here).
 */
export function formItemResponse(result: ItemResult, item: PlayableItem, ctx: FormCtx, seen: ReadonlySet<string>): ItemResponse {
  const base = itemResponseOf(result, item, { grp: formGrp(ctx.track, ctx.formId), slot: 0, of: FORM_SLOTS, reason: 'extra', src: 'practice' }, seen)
  const data: ItemData = { ...(base.data as ItemData), src: 'form', formId: ctx.formId, track: ctx.track, formSlot: ctx.formSlot, formSet: ctx.formSet }
  delete data.slot
  delete data.of
  delete data.reason
  return { ...base, kind: 'item', data }
}

const dataOf = (e: LedgerEvent): Record<string, unknown> => {
  const d = (e as { data?: unknown }).data
  return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : {}
}

/** What the ledger holds of one form of one track. */
export interface FormTally {
  id: FormId
  /** Distinct slots answered (the first answer to a slot counts). */
  answered: number
  correct: number
  /** All 12 slots answered. */
  complete: boolean
  /** The seed set the answers were drawn from, or null with none. */
  set: FormSet | null
  /** The 12th answer's instant and local day. */
  finishedAt?: IsoInstant
  finishedDay?: LocalDay
  /** The slots answered, so a form can be resumed at the first one left. */
  slots: ReadonlySet<number>
}

/**
 * The three forms of `track` as the ledger holds them as of `now`: form items (src `form`, graded `item` events) grouped
 * by `formId`, the first answer to a slot counting. Duplicates collapse, later days wait for their day.
 */
export function tallyForms(events: Iterable<LedgerEvent>, track: string, now: LocalDay): Record<FormId, FormTally> {
  const seen = new Map<FormId, Map<number, LedgerEvent>>(FORM_IDS.map((id) => [id, new Map()]))
  for (const e of asOf(events, now)) {
    if (e.kind !== 'item') continue
    const d = dataOf(e)
    if (d.src !== 'form' || d.track !== track) continue
    const id = d.formId
    const slot = d.formSlot
    if ((id !== 'A' && id !== 'B' && id !== 'C') || !Number.isInteger(slot) || (slot as number) < 0 || (slot as number) >= FORM_SLOTS) continue
    const mine = seen.get(id)!
    if (!mine.has(slot as number)) mine.set(slot as number, e)
  }
  const out = {} as Record<FormId, FormTally>
  for (const id of FORM_IDS) {
    const mine = [...seen.get(id)!.values()]
    const last = mine.reduce<LedgerEvent | null>((a, e) => (a === null || e.at > a.at ? e : a), null)
    const set = mine.length === 0 ? null : (dataOf(mine[0]).formSet as FormSet)
    out[id] = {
      id,
      answered: mine.length,
      correct: mine.filter((e) => (e as { ok?: boolean }).ok === true).length,
      complete: mine.length === FORM_SLOTS,
      set: set === 0 || set === 1 || set === 2 ? set : null,
      ...(mine.length === FORM_SLOTS && last ? { finishedAt: last.at, finishedDay: last.day } : {}),
      slots: new Set(seen.get(id)!.keys()),
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Timing                                                              */
/* ------------------------------------------------------------------ */

/** A track's lessons as the timing reads them. */
export interface TrackShape {
  track: string
  /** Lesson ids in curriculum order. */
  lessons: readonly string[]
  /** The lesson whose pass opens B: the track's spiral checkpoint, else its last lesson. */
  closing: string
  /** Whether `closing` is a spiral checkpoint (must be passed) rather than a last lesson (must be done). */
  spiral: boolean
}

/** The part of a lesson the timing reads. */
export type TrackLesson = Pick<Lesson, 'id' | 'trackId' | 'ticket'>

/** The shape of `track` from the lessons in curriculum order, or null for a track with none. */
export function trackShape(track: string, lessons: readonly TrackLesson[]): TrackShape | null {
  const mine = lessons.filter((l) => l.trackId === track)
  if (mine.length === 0) return null
  const spiral = mine.find((l) => l.ticket?.form === 'spiral')
  return { track, lessons: mine.map((l) => l.id), closing: spiral?.id ?? mine[mine.length - 1].id, spiral: spiral !== undefined }
}

/** What the timing reads of the ledger's lesson aggregate (`Aggregate.lessons`). */
export type LessonMarks = Readonly<Record<string, Pick<LessonAgg, 'done' | 'passedAt'> | undefined>>

/**
 * `open`: offered now. `upcoming`: not yet (`why` says what it waits for). `taken`: all 12 answered. `closed`: its window
 * has passed without all 12 answered (only A, once a lesson is done).
 */
export type FormState = 'open' | 'upcoming' | 'taken' | 'closed'
export type FormWhy = 'pretest' | 'lesson-done' | 'spiral' | 'finish-track' | 'after-b' | 'wait' | 'taken' | 'now'

export interface FormWindow {
  id: FormId
  state: FormState
  why: FormWhy
  /** C only, once B is taken: the local day C opens. */
  opensOn?: LocalDay
  tally: FormTally
}

const isDone = (m: LessonMarks[string]): boolean => m?.done === true || m?.passedAt !== undefined

/**
 * Which forms are offered to a learner on `now`. Nothing here locks a lesson, a card or a form: a window decides only what
 * the card on /me offers.
 * - A: until any lesson of the track is done (a pretest ends with the first lesson).
 * - B: once `closing` is passed (a spiral) or done (a last lesson).
 * - C: `C_AFTER_B_DAYS` local days after B's 12th answer; never before B is taken.
 */
export function formWindows(shape: TrackShape, marks: LessonMarks, tallies: Record<FormId, FormTally>, now: LocalDay): FormWindow[] {
  const anyDone = shape.lessons.some((id) => isDone(marks[id]))
  const closing = marks[shape.closing]
  const closed = shape.spiral ? closing?.passedAt !== undefined : isDone(closing)
  const [a, b, c] = [tallies.A, tallies.B, tallies.C]

  const wa: FormWindow = a.complete
    ? { id: 'A', state: 'taken', why: 'taken', tally: a }
    : anyDone
      ? { id: 'A', state: 'closed', why: 'lesson-done', tally: a }
      : { id: 'A', state: 'open', why: 'pretest', tally: a }

  const wb: FormWindow = b.complete
    ? { id: 'B', state: 'taken', why: 'taken', tally: b }
    : closed
      ? { id: 'B', state: 'open', why: 'now', tally: b }
      : { id: 'B', state: 'upcoming', why: shape.spiral ? 'spiral' : 'finish-track', tally: b }

  let wc: FormWindow
  if (c.complete) wc = { id: 'C', state: 'taken', why: 'taken', tally: c }
  else if (!b.complete || b.finishedDay === undefined) wc = { id: 'C', state: 'upcoming', why: 'after-b', tally: c }
  else {
    const opensOn = addDays(b.finishedDay, C_AFTER_B_DAYS)
    wc = daysBetween(opensOn, now) >= 0 ? { id: 'C', state: 'open', why: 'now', opensOn, tally: c } : { id: 'C', state: 'upcoming', why: 'wait', opensOn, tally: c }
  }
  return [wa, wb, wc]
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/** A difference of two proportions, with its interval (all in [-1, 1]). */
export interface Difference {
  diff: number
  lo: number
  hi: number
}

/**
 * `to` minus `from` with Newcombe's hybrid score interval (Newcombe 1998, method 10): the Wilson 95 % limits (l, u) of
 * each proportion are combined as the difference of the rates plus and minus the root of the sums of squared distances to
 * the limits that bear on that side:
 *   lo = d - sqrt((p_to - l_to)^2 + (u_from - p_from)^2),  hi = d + sqrt((u_to - p_to)^2 + (p_from - l_from)^2).
 * It treats the two forms' items as independent draws, which is the right reading of "how much would the score move by
 * the luck of the 12 items", and ignores that the same learner took both: that only makes it wider. Null unless both
 * forms are complete.
 */
export function differenceOf(from: Proportion, to: Proportion): Difference | null {
  if (from.rate === null || from.ci95 === null || to.rate === null || to.ci95 === null) return null
  const d = to.rate - from.rate
  const [lf, uf] = from.ci95
  const [lt, ut] = to.ci95
  return {
    diff: d,
    lo: Math.max(-1, d - Math.sqrt((to.rate - lt) ** 2 + (uf - from.rate) ** 2)),
    hi: Math.min(1, d + Math.sqrt((ut - to.rate) ** 2 + (from.rate - lf) ** 2)),
  }
}

export interface FormResults {
  /** k of 12 with its Wilson interval, per form; null until the form is complete. */
  forms: Record<FormId, Proportion | null>
  /** B − A, "including the pretest effect": A is itself practice, so the gap is the lessons' and the pretest's together. */
  bMinusA: Difference | null
  /** C − B, shown beside B: how far the score moved in the 30 days or more between them. */
  cMinusB: Difference | null
}

/** The results of a track's three forms: only a complete form has a score. */
export function formResults(tallies: Record<FormId, FormTally>): FormResults {
  const forms = {} as Record<FormId, Proportion | null>
  for (const id of FORM_IDS) forms[id] = tallies[id].complete ? proportionOf(tallies[id].correct, FORM_SLOTS) : null
  return {
    forms,
    bMinusA: forms.A && forms.B ? differenceOf(forms.A, forms.B) : null,
    cMinusB: forms.B && forms.C ? differenceOf(forms.B, forms.C) : null,
  }
}
