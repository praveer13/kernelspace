/**
 * The hint ladder's rules, for every lab (H3, docs/specs/wave-1.md §13.2; docs/specs/wave-2.md §13.1): five rungs,
 * the rules that unlock them, the ledger refs they write and the "ask a human" link.
 *
 *   R0 prompt-and-compare   always first; a ≥ 12-word teach-back, then three authored ideas to tick
 *   R1 concept              ≤ 60 words, linked to the lesson H2; after a good-faith R0
 *   R2 where to look        ≤ 40 words; one more red run, or 2 minutes after R1
 *   R3 fragment             ≤ 3 lines of pseudo-code, never compilable Rust; R2 plus one more red run
 *   R4 design               ≤ 80 words of prose; on explicit request
 *   bottom-out              after R4 and 2 more red runs: the walkthrough to the first divergence,
 *                           then "re-implement after a break", credited `assisted` for 24 h
 *
 * Pure functions with no lab's text in them: the authored rungs come from a lab's `ForgeBundle`, the component
 * (src/components/forge/HintLadder.tsx) owns the clock and the ledger, and scripts/lint-mentor.ts holds every
 * authored rung to its limits. Lab 01's ladder module re-exports these, so its import paths did not change.
 * No hearts, no delays that cost anything (PLAN §10): a rung that is locked says why.
 */

import type { HintRef } from '@/lib/ledger/types'

/** The rungs, in unlock order; `bottom` is the walkthrough after R4. */
export const RUNGS = ['R0', 'R1', 'R2', 'R3', 'R4'] as const
export type Rung = (typeof RUNGS)[number]
export type RungId = Rung | 'bottom'

/** R0's teach-back: this many words, in the learner's own words. */
export const MIN_TEACHBACK_WORDS = 12
/** A good-faith teach-back is not one word pasted twelve times. */
export const MIN_DISTINCT_WORDS = 6
/** R2 opens this long after R1 even without another red run. */
export const R2_AFTER_MS = 2 * 60 * 1000
/** Red runs after R4 before the bottom-out opens. */
export const BOTTOM_RED_RUNS = 2
/** How long runs stay `assisted` after the bottom-out (mirrors the ledger fold, which owns the figure). */
export const ASSISTED_HOURS = 24

/** The word limits of the authored rungs; `verify:mentor` enforces them. */
export const LIMITS = { r1Words: 60, r2Words: 40, r3Lines: 3, r4Words: 80, promptWords: 30, ideaWords: 30 } as const

/** Shown after the bottom-out walkthrough. */
export const AFTER_BREAK = {
  title: 'Now re-implement it after a break',
  text: 'You have seen where your code first breaks the rules. Step away, then write this check’s logic again without looking. Runs for the next 24 hours count as assisted. A pass on seeds you have not seen, after that, gives the full credit back.',
}

/* ------------------------------------------------------------------ */
/* Ledger refs                                                          */
/* ------------------------------------------------------------------ */

/** `ack hint:<lab>/<check>#R<n>`, or `#bottom`. A trace of what the learner opened, never credit. */
export const hintRef = (checkId: string, rung: RungId, labId: string): HintRef => `hint:${labId}/${checkId}#${rung}`

/** The end of the assisted window an `#bottom` ack opens (the ledger fold computes the same instant). */
export function assistedUntil(bottomAckAt: string): string {
  return new Date(Date.parse(bottomAckAt) + ASSISTED_HOURS * 3_600_000).toISOString()
}

/* ------------------------------------------------------------------ */
/* Words and the teach-back                                             */
/* ------------------------------------------------------------------ */

export const words = (text: string): string[] => text.split(/\s+/).filter((w) => w !== '')
export const wordCount = (text: string): number => words(text).length

/** Good faith: enough words, and enough different ones. Self-assessment follows, never credit. */
export function teachBackOk(text: string): boolean {
  const ws = words(text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' '))
  return ws.length >= MIN_TEACHBACK_WORDS && new Set(ws).size >= MIN_DISTINCT_WORDS
}

/* ------------------------------------------------------------------ */
/* Unlock rules                                                         */
/* ------------------------------------------------------------------ */

/** When a rung was opened: the clock and the check's red-run count at that moment. */
export interface RungOpen {
  at: number
  red: number
}

export interface LadderState {
  /** The R0 teach-back draft. */
  r0: string
  /** "Compare" was pressed on a good-faith teach-back: R1 may open and the three ideas show. */
  compared: boolean
  /** Which of the three R0 ideas the learner ticked (self-assessment). */
  ticks: readonly boolean[]
  opened: Partial<Record<RungId, RungOpen>>
}

export const freshState = (): LadderState => ({ r0: '', compared: false, ticks: [false, false, false], opened: {} })

/** Where a check stands now: how many red runs it has had, and the time. */
export interface Ctx {
  red: number
  now: number
  /** The lab whose acks `restoreState` reads. */
  labId?: string
}

export interface Unlock {
  ok: boolean
  /** Why it is locked (empty when `ok`). */
  reason: string
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** Whether `rung` may open now. Rungs open in order; `bottom` follows R4. */
export function unlockOf(state: LadderState, rung: RungId, ctx: Ctx): Unlock {
  const o = state.opened
  const yes: Unlock = { ok: true, reason: '' }
  const no = (reason: string): Unlock => ({ ok: false, reason })
  switch (rung) {
    case 'R0':
      return yes
    case 'R1':
      return o.R0 !== undefined && state.compared ? yes : no(`Write ${MIN_TEACHBACK_WORDS} or more words of your own in R0, then compare.`)
    case 'R2': {
      const r1 = o.R1
      if (r1 === undefined) return no('Open R1 first.')
      const more = r1.red + 1 - ctx.red
      const left = r1.at + R2_AFTER_MS - ctx.now
      return more <= 0 || left <= 0 ? yes : no(`Needs another red run on this check, or ${Math.ceil(left / 1000)} s more after R1.`)
    }
    case 'R3': {
      const r2 = o.R2
      if (r2 === undefined) return no('Open R2 first.')
      return ctx.red > r2.red ? yes : no('Needs one more red run on this check after R2.')
    }
    case 'R4':
      return o.R3 === undefined ? no('Open R3 first.') : yes
    case 'bottom': {
      const r4 = o.R4
      if (r4 === undefined) return no('Open R4 first.')
      const left = BOTTOM_RED_RUNS - (ctx.red - r4.red)
      return left <= 0 ? yes : no(`Needs ${plural(left, 'more red run')} on this check after R4.`)
    }
  }
}

export type LadderAction =
  | { type: 'draft'; text: string }
  | { type: 'compare' }
  | { type: 'tick'; index: number }
  | { type: 'open'; rung: RungId }

/** The ladder's reducer: an action the rules do not allow leaves the state as it was. */
export function ladderReduce(state: LadderState, action: LadderAction, ctx: Ctx): LadderState {
  switch (action.type) {
    case 'draft':
      return state.compared ? state : { ...state, r0: action.text }
    case 'compare':
      return state.opened.R0 !== undefined && !state.compared && teachBackOk(state.r0) ? { ...state, compared: true } : state
    case 'tick':
      return state.compared && action.index >= 0 && action.index < state.ticks.length
        ? { ...state, ticks: state.ticks.map((t, i) => (i === action.index ? !t : t)) }
        : state
    case 'open': {
      if (state.opened[action.rung] !== undefined || !unlockOf(state, action.rung, ctx).ok) return state
      return { ...state, opened: { ...state.opened, [action.rung]: { at: ctx.now, red: ctx.red } } }
    }
  }
}

/**
 * A state rebuilt from the ledger's acks after a reload. Rungs already acked count as opened now, so the
 * next rung still needs a run or the clock; the teach-back text is not stored, so R1 and later are
 * restored as compared.
 */
export function restoreState(acks: Readonly<Record<string, string>>, checkId: string, ctx: Ctx & { labId: string }): LadderState {
  const opened: LadderState['opened'] = {}
  for (const rung of [...RUNGS, 'bottom'] as RungId[]) if (acks[hintRef(checkId, rung, ctx.labId)] !== undefined) opened[rung] = { at: ctx.now, red: ctx.red }
  return { ...freshState(), compared: opened.R1 !== undefined, opened }
}

/* ------------------------------------------------------------------ */
/* Red runs                                                             */
/* ------------------------------------------------------------------ */

/** The slice of a lab report the ladder reads. */
export interface RunLike {
  reference?: boolean
  checks: readonly { id: string; status: string }[]
}

/**
 * How many runs left `checkId` red: any status but `pass`. A reference build is not the learner's code
 * and a run that did not list the check says nothing about it.
 */
export function redRuns(reports: readonly RunLike[], checkId: string): number {
  let n = 0
  for (const r of reports) {
    if (r.reference === true) continue
    const c = r.checks.find((x) => x.id === checkId)
    if (c !== undefined && c.status !== 'pass') n++
  }
  return n
}

/* ------------------------------------------------------------------ */
/* Ask a human                                                          */
/* ------------------------------------------------------------------ */

/** Owner answer O2: lab threads go to the Q&A category of the project's Discussions. */
export const DISCUSSIONS = { repo: 'praveer13/kernelspace', category: 'q-a' } as const
/** The prefilled URL stays under 2 KB; this leaves room for proxies that count a little differently. */
export const URL_BUDGET = 1800
export const URL_LIMIT = 2048

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
const wellFormed = (s: string) => s.replace(LONE_SURROGATE, '\uFFFD')

/** At most `n` code points (never half of a surrogate pair), with an ellipsis when cut. */
function clip(s: string, n: number): string {
  const cps = Array.from(s)
  return cps.length <= n ? s : `${cps.slice(0, Math.max(0, n - 1)).join('')}…`
}

/** A line that reads as Rust: a declaration, a statement or a block edge. */
const CODE_LINE = /^\s*(pub\s|fn\s|impl\b|let\s|mut\s|struct\s|self\.|\/\/)|[;{}]\s*$|::|=>|&mut\b|\.unwrap\(|\bVec</
/** An inline span that is more than a name. */
const CODE_SPAN = /`([^`\n]*)`/g

/**
 * Text that may go into a public post: fenced blocks, code-looking lines and code-looking inline spans
 * become a placeholder. "Never their code" is a rule of the link, not a request to the learner.
 */
export function stripCode(text: string): string {
  const noFences = wellFormed(text).replace(/\r/g, '').replace(/```[\s\S]*?(```|$)/g, '\n[code removed]\n')
  const noSpans = noFences.replace(CODE_SPAN, (m, inner: string) => (/[;{}=]|::|->/.test(inner) || inner.length > 40 ? '[code removed]' : m))
  const out: string[] = []
  for (const line of noSpans.split('\n')) {
    const bad = CODE_LINE.test(line)
    if (bad && out[out.length - 1] === '[code removed]') continue
    out.push(bad ? '[code removed]' : line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const quote = (text: string) => text.split('\n').map((l) => `> ${l}`.trimEnd()).join('\n')

export interface AskInput {
  /** The lab's `discussionsLabel` ("[lab 02]"). */
  label: string
  checkId: string
  /** The failing check's message (`CheckResult.msg`). */
  message: string
  /** The learner's R0 teach-back, if they wrote one. */
  r0?: string
}

/**
 * A prefilled new-discussion URL: category Q&A, title "<label> <check id>: <first line of the message>" (the lab's label),
 * body = the message and the R0 text. There is no code input anywhere, and both texts pass `stripCode`.
 * Always shorter than `URL_BUDGET`: the texts shrink until it fits.
 */
export function askHumanUrl({ label, checkId, message, r0 = '' }: AskInput): string {
  const msg = stripCode(message)
  const mine = stripCode(r0)
  const first = msg.split('\n').find((l) => l.trim() !== '' && l !== '[code removed]')?.trim() ?? 'failing'
  const prefix = `${label} ${checkId}: `
  const labName = label.replace(/^\[|\]$/g, '').replace(/^./, (c) => c.toUpperCase())
  const prefixLen = Array.from(prefix).length
  const build = (titleCap: number, msgCap: number, r0Cap: number) => {
    const title = clip(`${prefix}${first}`, titleCap)
    const parts = [`${labName} · check \`${checkId}\``, `**What the check said**\n${quote(clip(msg, msgCap) || '(no message)')}`]
    if (mine !== '') parts.push(`**What I understand so far**\n${quote(clip(mine, r0Cap))}`)
    parts.push('No code is attached.')
    const q = `category=${DISCUSSIONS.category}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(parts.join('\n\n'))}`
    return `https://github.com/${DISCUSSIONS.repo}/discussions/new?${q}`
  }
  let scale = 1
  for (;;) {
    const url = build(Math.max(prefixLen + 12, Math.floor(150 * scale)), Math.floor(600 * scale), Math.floor(500 * scale))
    if (url.length <= URL_BUDGET || scale < 0.05) return url
    scale = Math.round((scale - 0.05) * 100) / 100
  }
}
