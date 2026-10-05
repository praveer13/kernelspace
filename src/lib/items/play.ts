/**
 * The item player's model (docs/specs/wave-1.md §5.1, §6.8, §8.1; task B13): adapters that turn the four
 * `PlayableItem` sources (generated, checkpoint, constructed response, authored) into one display model,
 * the draft an answer control edits, the grade, and the result a caller writes to the ledger.
 *
 * Pure: no DOM, no clock, no randomness (option order comes from the caller's seed). The player
 * (src/components/items/*) renders `PlayView`s; Today, exit tickets, test-out and placement own the
 * session and the ledger write, so nothing here records anything.
 */

import { hash32, shuffledOrder } from '@/lib/rng'
import { rev32 } from '@/lib/ledger/stable'
import type { Confidence } from '@/lib/ledger/types'
import type { QuizQuestion } from '@/components/QuizBlock'
import type { KcId } from '@/lib/kc/types'
import { gradeResponse } from './grade'
import type {
  AnswerSpec,
  ChoiceOption,
  ConstructedPrompt,
  Gen,
  Grade,
  Level,
  PlayableItem,
  Prompt,
  Response,
} from './types'

/** Option labels by display position; keys A to D pick (a fifth option is allowed for older checkpoints). */
export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const

/** Nominal seconds for an authored item (a generated item carries its own `nsec`). Spec §8.4 reads `nsec ?? 30`. */
export const NSEC_CHOICE = 30
export const NSEC_CR = 90

/** A constructed response is "correct" when at least this many of its three ideas are ticked (spec §8.1). */
export const CR_PASS_IDEAS = 2

/* ------------------------------ responses and results ------------------------------ */

/** A self-checked constructed response: the text stays on the device; `ideas` are the ticks. */
export interface CrResponse {
  kind: 'cr'
  text: string
  ideas: [boolean, boolean, boolean]
}

export type PlayResponse = Response | CrResponse

/** What a finished item hands its caller (Today, a ticket, test-out): enough to write the ledger event. */
export interface ItemResult {
  source: PlayableItem['source']
  /** The ledger ref: `gen:<family>/<variant>`, `quiz:<lesson>#<qi>`, `cr:<lesson>#<i>` or `item:<id>`. */
  ref: string
  /** The item fingerprint (`Instance.rev`, or `rev32` of the authored content). */
  rev: string
  kcs: KcId[]
  ok: boolean
  score: number
  grade: Grade
  response: PlayResponse
  conf?: Confidence
  /** Milliseconds from first show to submit. */
  ms: number
  /** Nominal seconds, for XP and session sizing. */
  nsec: number
  /** The option-order seed, so a reload can reproduce what the learner saw. */
  seed: number
  level?: Level
  variant?: string
  /** Checkpoint and authored items: the picked authored option indices (the ledger's `data.pick`). */
  pick?: number[]
  /** Constructed responses: indices of the ticked ideas (the ledger's `data.ideas`). */
  ideas?: number[]
}

/* ------------------------------ the display model ------------------------------ */

interface BaseView {
  source: PlayableItem['source']
  ref: string
  rev: string
  kcs: KcId[]
  prompt: Prompt
  nsec: number
  level?: Level
  variant?: string
  /** Authored items: the explanation shown after submit. */
  explanation?: string
}

export type PlayView = BaseView &
  (
    | {
        kind: 'choice'
        /** In display order: the player labels them A, B, C… and grades by `id`. */
        options: ChoiceOption[]
        correct: string[]
        multi: boolean
      }
    | { kind: 'numeric'; answer: Extract<AnswerSpec, { kind: 'numeric' }> }
    | { kind: 'estimate'; answer: Extract<AnswerSpec, { kind: 'estimate' }> }
    | { kind: 'cr'; cr: ConstructedPrompt }
  )

/** The ledger ref an item's event carries. */
export function refFor(item: PlayableItem): string {
  switch (item.source) {
    case 'gen':
      return `gen:${item.inst.family}/${item.inst.variant}`
    case 'quiz':
      return `quiz:${item.lessonId}#${item.qi}`
    case 'cr':
      return `cr:${item.lessonId}#${item.index}`
    case 'item':
      return `item:${item.item.id}`
  }
}

/** The fingerprint a caller stores as the event's `rev`: a changed question reads as a new item. */
export function revFor(item: PlayableItem): string {
  switch (item.source) {
    case 'gen':
      return item.inst.rev
    case 'quiz':
      return questionRev(item.q)
    case 'item':
      return questionRev(item.item.q)
    case 'cr':
      return rev32({ prompt: item.cr.prompt, model: item.cr.model, ideas: item.cr.ideas })
  }
}

/** The same fingerprint QuizBlock writes, so a question has one rev wherever it is played. */
function questionRev(q: QuizQuestion): string {
  return rev32({ q: q.q, options: q.options, correct: q.correct })
}

export function kcsFor(item: PlayableItem): KcId[] {
  switch (item.source) {
    case 'gen':
      return [...item.inst.kcs]
    case 'quiz':
      return [...item.kcs]
    case 'cr':
      return [...item.cr.kcs]
    case 'item':
      return [...item.item.kcs]
  }
}

/**
 * The seed the option order falls back to: a generated item's own seed, otherwise a hash of its ref.
 * Stable, so a server render and the first client render agree; pass a fresh seed per attempt for a
 * new order on a retry.
 */
export function defaultSeed(item: PlayableItem): number {
  return item.source === 'gen' ? item.inst.seed : hash32(refFor(item))
}

type ChoiceView = Extract<PlayView, { kind: 'choice' }>

/** An authored question as a choice: ids are the authored indices, so grading never depends on order. */
function authoredView(q: QuizQuestion, seed: number): Pick<ChoiceView, 'kind' | 'prompt' | 'options' | 'correct' | 'multi'> {
  const hasWhy = q.why?.length === q.options.length
  const options: ChoiceOption[] = q.options.map((text, i) => ({ id: String(i), text, why: hasWhy ? (q.why?.[i] ?? '') : '' }))
  return {
    kind: 'choice',
    prompt: { stem: [{ t: 'text', text: q.q }] },
    options: shuffledOrder(options.length, seed).map((i) => options[i]),
    correct: q.correct.map(String),
    multi: q.multi ?? q.correct.length > 1,
  }
}

/**
 * The display model for an item. Options are shuffled by `seed` (choice items, generated or authored);
 * everything else is the item as authored. A generated item's prompt is used as it is: claims and values
 * stay structured so the player can render them as chips.
 */
export function playView(item: PlayableItem, seed: number = defaultSeed(item)): PlayView {
  const base = { source: item.source, ref: refFor(item), rev: revFor(item), kcs: kcsFor(item) }
  switch (item.source) {
    case 'gen': {
      const { inst } = item
      const gen = { ...base, prompt: inst.prompt, nsec: inst.nsec, level: inst.level, variant: inst.variant }
      const a = inst.answer
      if (a.kind === 'choice') {
        const order = shuffledOrder(a.options.length, seed)
        return { ...gen, kind: 'choice', options: order.map((i) => a.options[i]), correct: [...a.correct], multi: a.multi ?? a.correct.length > 1 }
      }
      return a.kind === 'numeric' ? { ...gen, kind: 'numeric', answer: a } : { ...gen, kind: 'estimate', answer: a }
    }
    case 'quiz':
      return { ...base, nsec: NSEC_CHOICE, ...authoredView(item.q, seed), ...(item.q.explanation ? { explanation: item.q.explanation } : {}) }
    case 'item':
      return { ...base, nsec: NSEC_CHOICE, ...authoredView(item.item.q, seed), ...(item.item.q.explanation ? { explanation: item.item.q.explanation } : {}) }
    case 'cr':
      return { ...base, kind: 'cr', cr: item.cr, nsec: NSEC_CR, prompt: { stem: [{ t: 'text', text: item.cr.prompt }] } }
  }
}

/* ------------------------------ drafts: what an answer control edits ------------------------------ */

export type Draft =
  | { kind: 'choice'; picks: string[] }
  | { kind: 'numeric'; text: string; unit: string }
  | { kind: 'estimate'; text: string; lo: string; hi: string; range: boolean }
  /** `revealed`: the model answer is showing and the three ideas can be ticked. */
  | { kind: 'cr'; text: string; ideas: [boolean, boolean, boolean]; revealed: boolean }

export function emptyDraft(view: PlayView): Draft {
  switch (view.kind) {
    case 'choice':
      return { kind: 'choice', picks: [] }
    case 'numeric':
      return { kind: 'numeric', text: '', unit: view.answer.unit }
    case 'estimate':
      return { kind: 'estimate', text: '', lo: '', hi: '', range: false }
    case 'cr':
      return { kind: 'cr', text: '', ideas: [false, false, false], revealed: false }
  }
}

/**
 * A number from what the learner typed: digits with an optional sign, decimal point and exponent.
 * Commas are accepted only as thousands separators (`1,024`), so a decimal comma is refused rather than
 * read as a thousand times too much. Anything else (a unit, a percent sign, a word) is null.
 */
export function parseNumber(text: string): number | null {
  let s = text.trim().replace(/\s+/g, '')
  if (s.includes(',')) {
    if (!/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return null
    s = s.replace(/,/g, '')
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** True once the draft holds something the learner chose or typed: it reveals the confidence row. */
export function hasAnswer(draft: Draft): boolean {
  switch (draft.kind) {
    case 'choice':
      return draft.picks.length > 0
    case 'numeric':
    case 'estimate':
      return draft.text.trim() !== ''
    case 'cr':
      return false
  }
}

export type Built = { ok: true; response: PlayResponse } | { ok: false; problem: string }

/** The response a draft stands for, or the one-line reason it cannot be graded yet. */
export function responseFor(draft: Draft): Built {
  switch (draft.kind) {
    case 'choice':
      return draft.picks.length === 0 ? { ok: false, problem: 'Pick an answer first.' } : { ok: true, response: { kind: 'choice', picks: [...draft.picks] } }
    case 'numeric': {
      const value = parseNumber(draft.text)
      if (value === null) return { ok: false, problem: 'Enter digits only; the unit goes in the unit box.' }
      return { ok: true, response: { kind: 'numeric', value, unit: draft.unit } }
    }
    case 'estimate': {
      const value = parseNumber(draft.text)
      if (value === null) return { ok: false, problem: 'Enter digits only.' }
      const rangeTyped = draft.range && (draft.lo.trim() !== '' || draft.hi.trim() !== '')
      if (!rangeTyped) return { ok: true, response: { kind: 'estimate', value } }
      const lo = parseNumber(draft.lo)
      const hi = parseNumber(draft.hi)
      if (lo === null || hi === null || lo > hi) return { ok: false, problem: 'Give both ends of the range, low then high, or clear it.' }
      return { ok: true, response: { kind: 'estimate', value, lo, hi } }
    }
    case 'cr':
      return { ok: true, response: { kind: 'cr', text: draft.text, ideas: [...draft.ideas] } }
  }
}

/* ------------------------------ grading ------------------------------ */

function gradeCr(cr: ConstructedPrompt, r: CrResponse): Grade {
  const got = r.ideas.filter(Boolean).length
  const ok = got >= CR_PASS_IDEAS
  const missed = cr.ideas.filter((_, i) => !r.ideas[i])
  const feedback = ok
    ? `You covered ${got} of 3 ideas.`
    : `You covered ${got} of 3 ideas. Two make it a pass. Not yet in your answer: ${missed.join(' ')}`
  return { ok, score: ok ? 1 : 0, feedback }
}

/**
 * Choice grading for authored questions: picked ids equal the correct ids. Authored options carry no
 * misconception id, so there is no diagnosis; a wrong pick's why reaches the learner through Feedback's Whys.
 */
function gradeAuthoredChoice(view: Pick<ChoiceView, 'correct'>, r: Extract<Response, { kind: 'choice' }>): Grade {
  const picks = [...new Set(Array.isArray(r.picks) ? r.picks : [])]
  if (picks.length === 0) return { ok: false, score: 0, feedback: 'Pick an answer first.' }
  const right = new Set(view.correct)
  const ok = picks.length === right.size && picks.every((p) => right.has(p))
  return { ok, score: ok ? 1 : 0, feedback: ok ? 'Correct.' : 'Not quite.' }
}

/**
 * Grades a response to an item. A generated item goes through its family's `grade` when `gen` is given
 * (the family's ratio rules name the slip) and through the shared rules otherwise; a checkpoint or authored
 * question is right when the picked ids equal the keyed ones; a constructed response is right when at least
 * two ideas are ticked (self-assessed, spec §8.1). A response of the wrong kind is not ok.
 */
export function gradeItem(item: PlayableItem, response: PlayResponse, gen?: Pick<Gen, 'grade'>): Grade {
  if (item.source === 'gen') {
    if (response.kind === 'cr') return { ok: false, score: 0, feedback: 'That answer does not fit this question.' }
    return gen ? gen.grade(item.inst, response) : gradeResponse(item.inst, response)
  }
  if (item.source === 'cr') {
    return response.kind === 'cr' ? gradeCr(item.cr, response) : { ok: false, score: 0, feedback: 'That answer does not fit this question.' }
  }
  if (response.kind !== 'choice') return { ok: false, score: 0, feedback: 'That answer does not fit this question.' }
  const q = item.source === 'quiz' ? item.q : item.item.q
  return gradeAuthoredChoice(authoredView(q, 0), response)
}

/** Everything a caller needs to write the ledger event for a graded item. */
export function resultFor(item: PlayableItem, response: PlayResponse, grade: Grade, extra: { seed: number; ms: number; conf?: Confidence }): ItemResult {
  const view = playView(item, extra.seed)
  return {
    source: item.source,
    ref: view.ref,
    rev: view.rev,
    kcs: view.kcs,
    ok: grade.ok,
    score: grade.score,
    grade,
    response,
    ...(extra.conf ? { conf: extra.conf } : {}),
    ms: Math.max(0, Math.round(extra.ms)),
    nsec: view.nsec,
    seed: extra.seed,
    ...(view.level === undefined ? {} : { level: view.level }),
    ...(view.variant === undefined ? {} : { variant: view.variant }),
    ...(response.kind === 'choice' && (item.source === 'quiz' || item.source === 'item')
      ? { pick: response.picks.map(Number).filter(Number.isInteger).sort((a, b) => a - b) }
      : {}),
    ...(response.kind === 'cr' ? { ideas: response.ideas.flatMap((on, i) => (on ? [i] : [])) } : {}),
  }
}

/* ------------------------------ keys ------------------------------ */

/** The option a letter key picks: A to D (and E when a question has five), either case; null otherwise. */
export function optionIndexForKey(key: string, count: number): number | null {
  if (key.length !== 1) return null
  const i = OPTION_LETTERS.indexOf(key.toUpperCase() as (typeof OPTION_LETTERS)[number])
  return i >= 0 && i < count ? i : null
}

/** Confidence for keys 1, 2 and 3, in the order the picker shows them. */
export function confidenceForKey(key: string): Confidence | null {
  return key === '1' ? 'guess' : key === '2' ? 'think' : key === '3' ? 'sure' : null
}

/** Toggles an option id: multi-select adds or removes it, single-select replaces the pick. */
export function togglePick(picks: readonly string[], id: string, multi: boolean): string[] {
  if (!multi) return [id]
  return picks.includes(id) ? picks.filter((p) => p !== id) : [...picks, id]
}

/* ------------------------------ the keyboard, as a pure decision ------------------------------ */

/** What the focused element is, as far as the card's keys care. `option` is an answer button; a `link` keeps its own Enter, like a button. */
export type KeyTarget = 'option' | 'button' | 'link' | 'input' | 'textarea' | 'select' | 'other'

export interface KeyState {
  stepsOpen: boolean
  /** The verdict is showing. */
  done: boolean
  kind: PlayView['kind']
  optionCount: number
  /** `hasAnswer(draft)`. */
  answered: boolean
  /** The optional confidence row is enabled for this card. */
  confidence: boolean
}

export interface KeyInput {
  key: string
  repeat: boolean
  shift: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  target: KeyTarget
}

/**
 * What the card does with a key. `act` is the primary action (reveal, submit, or next); `swallow` cancels
 * the browser default and does nothing, so a held Enter cannot submit and then click the Next button that
 * has just taken focus; `none` leaves the key to the browser.
 */
export type KeyAction =
  | { type: 'none' }
  | { type: 'swallow' }
  | { type: 'close-steps' }
  | { type: 'act' }
  | { type: 'pick'; index: number }
  | { type: 'confidence'; conf: Confidence }

const NONE: KeyAction = { type: 'none' }

export function keyAction(s: KeyState, e: KeyInput): KeyAction {
  if (e.key === 'Escape') return s.stepsOpen ? { type: 'close-steps' } : NONE
  if (e.alt) return NONE
  const typing = e.target === 'input' || e.target === 'textarea' || e.target === 'select'
  if (e.key === 'Enter') {
    if (e.shift || e.target === 'select') return NONE
    if (e.target === 'textarea' && !(e.ctrl || e.meta)) return NONE
    if (e.repeat) return { type: 'swallow' }
    // a button or link keeps its own Enter (click); an option submits once something is picked, else it selects
    if (e.target === 'button' || e.target === 'link' || (e.target === 'option' && !s.answered)) return NONE
    return { type: 'act' }
  }
  if (typing || e.ctrl || e.meta || e.shift || e.repeat || s.done) return NONE
  if (s.kind === 'choice') {
    const index = optionIndexForKey(e.key, s.optionCount)
    if (index !== null) return { type: 'pick', index }
  }
  const conf = confidenceForKey(e.key)
  if (conf && s.confidence && s.kind !== 'cr' && s.answered) return { type: 'confidence', conf }
  return NONE
}
