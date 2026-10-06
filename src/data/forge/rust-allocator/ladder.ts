/**
 * Lab 01's authored hint ladder (H3, docs/specs/wave-1.md §13.2): five rungs for every required check,
 * the rules that unlock them, the bottom-out walkthrough and the "ask a human" link.
 *
 *   R0 prompt-and-compare   always first; a ≥ 12-word teach-back, then three authored ideas to tick
 *   R1 concept              ≤ 60 words, linked to the lesson H2; after a good-faith R0
 *   R2 where to look        ≤ 40 words; one more red run, or 2 minutes after R1
 *   R3 fragment             ≤ 3 lines of pseudo-code, never compilable Rust; R2 plus one more red run
 *   R4 design               ≤ 80 words of prose; on explicit request
 *   bottom-out              after R4 and 2 more red runs: the walkthrough to the first divergence,
 *                           then "re-implement after a break", credited `assisted` for 24 h
 *
 * Pure data and pure functions: the component (src/components/forge/HintLadder.tsx) owns the clock and
 * the ledger, and scripts/lint-mentor.ts (`bun run verify:mentor`) holds every authored rung to its limits.
 * No hearts, no delays that cost anything (PLAN §10): a rung that is locked says why.
 */

import { applyOp, createHeap, fitsAnywhere, freeId, placeBlock, viewOf } from '@/lib/world/heap'
import type { HeapOptions } from '@/lib/world/heap'
import { firstFit } from '@/lib/world/placement'
import type { HeapOp, PlacementDriver } from '@/lib/world/types'
import type { HintRef } from '@/lib/ledger/types'

export const LAB_ID = 'rust-allocator'

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

export const R0_PROMPT = 'In two sentences: what does this check do to your allocator, and what did yours do?'

export interface LessonLink {
  lessonId: string
  /** The H2's text, as written in the lesson. */
  h2: string
  /** The H2's id on the lesson page (the lesson's slugify of `h2`); `verify:mentor` checks it exists. */
  anchor: string
}

export interface CheckLadder {
  checkId: string
  r0: { prompt: string; ideas: readonly string[] }
  r1: { text: string; link: LessonLink }
  /** `fn` is the check's function in the zip's `src/lib/lib.rs`; the text names it. */
  r2: { text: string; fn: string }
  /** Pseudo-code, one line per `\n`. */
  r3: string
  r4: string
}

const TWO_OPS: LessonLink = { lessonId: 't1.l3', h2: 'The two operations that matter', anchor: 'the-two-operations-that-matter' }
const CONTRACT: LessonLink = { lessonId: 't1.l3', h2: 'The contract and the slab', anchor: 'the-contract-and-the-slab' }
const EXTERNAL: LessonLink = {
  lessonId: 't1.l4',
  h2: 'External fragmentation: waste between the boxes',
  anchor: 'external-fragmentation-waste-between-the-boxes',
}

export const LADDER: Record<string, CheckLadder> = {
  boot: {
    checkId: 'boot',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It builds an allocator over a 1 MiB heap and asks for one byte with alloc(1, 1).',
        'It fails if construction traps or panics, or if that first request comes back as None.',
        'A fresh allocator holds one free run that covers the whole capacity, and a request is carved off the front of it.',
      ],
    },
    r1: {
      text: 'An allocator is state plus two rules. Here the state is a list of free runs, and at the start there is exactly one, covering the whole heap. A first allocation just takes bytes off the front of that run and leaves the rest free. Nothing clever is needed yet: you are proving the heap exists and answers.',
      link: CONTRACT,
    },
    r2: {
      text: 'The message says whether alloc returned None or the check trapped. In lib.rs, check_boot is three lines long. Check that new records the capacity, and that your free list starts with one entry rather than none.',
      fn: 'check_boot',
    },
    r3: [
      'new: the free list holds one run, from offset 0, as long as the capacity',
      'alloc: take the first run that is big enough and carve the front off it',
      'return where the carve started, then shrink the run, or drop it when empty',
    ].join('\n'),
    r4: 'Keep a growable list of (offset, size) runs sorted by offset. Invariants: no two runs overlap, every run has size above zero, and the sizes never add up to more than the capacity. new creates the single run (0, capacity). alloc returns the start of a run that is big enough, then replaces that run by what is left, removing it when nothing is left. Stage 1 can stop there; alignment and merging come later.',
  },

  align: {
    checkId: 'align',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It makes 200 seeded requests, with alignments from 1 to 256 and sizes up to 512 bytes, and frees the oldest to keep at most 64 live.',
        'It fails when a returned offset is not a multiple of its alignment, or when alloc says None with under 64 KiB live.',
        'Round the start of the block up to the alignment before carving, and keep the skipped padding in the free list.',
      ],
    },
    r1: {
      text: 'Alignment is a property of the address you return, not of the size you were asked for. To place a block at a multiple of align, round the candidate start up: add align minus one, divide by align, multiply back, all in whole numbers. The bytes you skip are padding, and they still belong to the free list.',
      link: TWO_OPS,
    },
    r2: {
      text: 'The message names the op, the size, the alignment and the offset you returned. In lib.rs, check_align only tests offset modulo align. Look at where alloc computes the start: is that value rounded up before you return it?',
      fn: 'check_align',
    },
    r3: [
      'start = the run start, rounded up to a multiple of align',
      'padding = start minus the run start, and it stays free',
      'the block is [start, start + size), the tail after it stays free too',
    ].join('\n'),
    r4: 'For each free run, compute its aligned start. The run fits the request only if that start plus the size stays inside the run. Splitting then leaves up to two free pieces: a prefix, the alignment padding if any, and a suffix, the tail. Put both back in address order. Invariants: free runs never overlap, none is empty, every returned offset is a multiple of its alignment. Check the rounding cannot overflow near the heap end.',
  },

  no_overlap: {
    checkId: 'no_overlap',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It runs 400 seeded allocs and frees, tracking every live span, with sizes up to about 1 KiB and alignments up to 64.',
        'It fails when a new span runs past the end of the heap, or shares even one byte with a live span.',
        'Usual causes: an off-by-one where the leftover of a split begins, or a free that hands back a different range than alloc gave out.',
      ],
    },
    r1: {
      text: 'Two spans [a, a + n) and [b, b + m) overlap exactly when a is below b + m and b is below a + n. The end is exclusive, so touching is fine. Most overlap bugs are an off-by-one in a split: the leftover begins at the old start plus the size, not a byte off.',
      link: TWO_OPS,
    },
    r2: {
      text: 'The message prints the new span and the live span it hits. Work out which of your splits produced the live one. In lib.rs, check_no_overlap frees at random, so a free that returns the wrong range can cause this too.',
      fn: 'check_no_overlap',
    },
    r3: [
      'a block is [start, start + size), and the end is exclusive',
      'the leftover of a split begins exactly at start + size',
      'free gives back the same range that alloc handed out',
    ].join('\n'),
    r4: 'Treat every span as a half-open range and keep one invariant: free runs and live blocks tile the heap with no gap that is double-counted and no byte in two places. In alloc, the prefix ends at the aligned start, the block ends at start plus size, and the suffix begins there. In free, insert exactly the range returned. Write the three endpoints on paper for one split and check each against its neighbour.',
  },

  reuse: {
    checkId: 'reuse',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It allocates 1 KiB, frees it, then asks for 1 KiB again with the same alignment.',
        'It fails unless the second block lands at the same offset as the first, which a bump allocator never does.',
        'free must put the span somewhere alloc looks, and alloc must search the free list before it grows into untouched space.',
      ],
    },
    r1: {
      text: 'Freeing has to give the bytes back to something alloc can see. If free does nothing, or alloc only moves a pointer forward, memory is never reused. The fix is one shared structure: free puts the span into it, and alloc searches it before taking anything new.',
      link: CONTRACT,
    },
    r2: {
      text: 'The message gives the offset of the freed block and where the next 1 KiB landed. In lib.rs, check_reuse is one alloc, one free, one alloc. Does your free change any state that alloc reads?',
      fn: 'check_reuse',
    },
    r3: [
      'free: add the span to the free list, in address order',
      'alloc: scan the free list from the lowest offset first',
      'only grow into untouched space when no free run is big enough',
    ].join('\n'),
    r4: 'One structure serves both operations: a list of free runs sorted by offset. alloc scans it from the front and takes the first run that fits, so a block freed at the lowest offset is found first. free inserts the span at its sorted position. Invariants: the list stays sorted, runs do not overlap, and there is no separate bump pointer, because untouched space is simply one more free run at the end.',
  },

  coalesce: {
    checkId: 'coalesce',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It fills the heap, frees sixteen 4 KiB neighbours (evens, then odds) and asks for 64 KiB, then frees three 16 KiB neighbours and asks for 48 KiB.',
        'The rest of the heap is full, so only a merged run can serve those requests. A free that just adds an entry leaves sixteen small runs.',
        'free must merge with the free neighbour on each side, and the middle block joins three runs at once.',
      ],
    },
    r1: {
      text: 'A free list that never merges turns one big run into many small ones, even when every byte is free. Coalescing means: when a block is freed, look at the free run just before it and the one just after. If either touches the freed block, where one ends exactly where the next begins, fuse them into a single run.',
      link: TWO_OPS,
    },
    r2: {
      text: 'The message says which request failed after which frees: 64 KiB after evens and odds, or 48 KiB after left, right, middle. Both parts are in lib.rs, check_coalesce. Does your free check the right neighbour as well as the left?',
      fn: 'check_coalesce',
    },
    r3: [
      'insert the freed run in address order',
      'if the previous run ends exactly where the freed run starts, fuse the two',
      'if the next run starts exactly where the freed run ends, fuse those too',
    ].join('\n'),
    r4: 'Keep free runs sorted by offset. On free, find the insertion position, then test the neighbour on each side: the left one touches when its end equals the freed start, the right one when the freed end equals its start. Merge the right neighbour first, then the left, or the middle block of the three-way case ends up half merged. Invariants: sorted, non-overlapping, and no two free runs ever touch.',
  },

  fragmentation: {
    checkId: 'fragmentation',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It fills the heap with 16 B to 2 KiB blocks, frees a window of neighbours, then churns 3000 ops near 75% occupancy, mixing in 8 to 32 KiB requests.',
        'A refusal counts as a bug only when a free span bigger than the request, plus 64 bytes, sits between your live blocks.',
        'Placement policy is yours to choose. What fails is a free that never merges neighbours, or a split that loses its remainder.',
      ],
    },
    r1: {
      text: 'Fragmentation is free memory that exists but cannot serve a request because it is broken into pieces. The check demands two things: merge neighbours on every free, and keep every leftover from a split. Placement, whether first, best or next fit, is a trade-off you may choose. Losing free bytes is never allowed.',
      link: EXTERNAL,
    },
    r2: {
      text: 'The message names the op, the request size and the stretch of free bytes you missed. In lib.rs, check_fragmentation and largest_gap define free space as bytes no live block covers. Replay it on paper: which free left that gap unmerged?',
      fn: 'check_fragmentation',
    },
    r3: [
      'on every free, merge with the free neighbour on the left and on the right',
      'on every split, keep both the prefix and the tail as free runs',
      'refuse a request only when no single free run is big enough for it',
    ].join('\n'),
    r4: 'Everything free lives in one address-ordered list, and the list only ever changes in two ways. A split replaces one run by up to two leftovers, and nothing is dropped. A free inserts one run and merges it with touching neighbours. Invariants: the free runs plus the live blocks account for every byte of the heap, and no two free runs touch. Then any policy you pick passes, because a refusal means the space really is not there.',
  },
}

/** Check ids with an authored ladder, in grading order. */
export const LADDER_CHECK_IDS = ['boot', 'align', 'no_overlap', 'reuse', 'coalesce', 'fragmentation'] as const

/** Shown after the bottom-out walkthrough. */
export const AFTER_BREAK = {
  title: 'Now re-implement it after a break',
  text: 'You have seen where your allocator first breaks the rules. Step away, then write this check’s logic again without looking. Runs for the next 24 hours count as assisted. A pass on seeds you have not seen, after that, gives the full credit back.',
}

/* ------------------------------------------------------------------ */
/* Ledger refs                                                          */
/* ------------------------------------------------------------------ */

/** `ack hint:rust-allocator/<check>#R<n>`, or `#bottom`. A trace of what the learner opened, never credit. */
export const hintRef = (checkId: string, rung: RungId): HintRef => `hint:${LAB_ID}/${checkId}#${rung}`

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
export function restoreState(acks: Readonly<Record<string, string>>, checkId: string, ctx: Ctx): LadderState {
  const opened: LadderState['opened'] = {}
  for (const rung of [...RUNGS, 'bottom'] as RungId[]) if (acks[hintRef(checkId, rung)] !== undefined) opened[rung] = { at: ctx.now, red: ctx.red }
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
  checkId: string
  /** The failing check's message (`CheckResult.msg`). */
  message: string
  /** The learner's R0 teach-back, if they wrote one. */
  r0?: string
}

/**
 * A prefilled new-discussion URL: category Q&A, title "[lab 01] <check id>: <first line of the message>",
 * body = the message and the R0 text. There is no code input anywhere, and both texts pass `stripCode`.
 * Always shorter than `URL_BUDGET`: the texts shrink until it fits.
 */
export function askHumanUrl({ checkId, message, r0 = '' }: AskInput): string {
  const msg = stripCode(message)
  const mine = stripCode(r0)
  const first = msg.split('\n').find((l) => l.trim() !== '' && l !== '[code removed]')?.trim() ?? 'failing'
  const prefixLen = Array.from(`[lab 01] ${checkId}: `).length
  const build = (titleCap: number, msgCap: number, r0Cap: number) => {
    const title = clip(`[lab 01] ${checkId}: ${first}`, titleCap)
    const parts = [`Lab 01 · check \`${checkId}\``, `**What the check said**\n${quote(clip(msg, msgCap) || '(no message)')}`]
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

/* ------------------------------------------------------------------ */
/* The walkthrough to the first divergence                              */
/* ------------------------------------------------------------------ */

/** Lab 01's heap (labs/rust-allocator/src/lib.rs `CAP`) as the reference sees it: exact sizes, eager coalescing. */
export const LAB_HEAP: HeapOptions = { capacity: 1 << 20, coalesce: true, minSplit: 1, granule: 1, classes: 'none' }
/** The harness forgives a refusal unless a free span is this many bytes bigger than the request (`SLACK`). */
export const SLACK = 64

const FIRST_FIT: PlacementDriver = { name: 'first-fit', place: firstFit }

export interface WalkStep {
  /** 1-based position in the trace (or script). */
  n: number
  op: string
  /** What the learner's allocator did; `-` when there is no trace of it. */
  yours: string
  /** What the reference heap says about that op. */
  reference: string
  /** The first op at which the learner's trace breaks the harness's rules. */
  diverges: boolean
  note?: string
}

export interface Walkthrough {
  /** `trace`: replayed from the learner's `ks_trace_drain` lines. `script`: the check's op sequence on the reference alone. */
  source: 'trace' | 'script'
  steps: WalkStep[]
  /** The step number of the first divergence, or null. */
  divergedAt: number | null
  headline: string
  /** Ops of the trace before the steps shown (they agree with the reference). */
  skipped: number
}

/** What the learner's code logs with `kslab::trace!`: `alloc(<size>[, <align>]) -> <offset>|none` and `free(<offset>)`. */
export type TraceOp =
  | { kind: 'alloc'; size: number; align: number; got: number | null }
  | { kind: 'free'; offset: number }

const ALLOC_LINE = /^alloc\(\s*(\d+)\s*(?:,\s*(?:align\s*[=:]?\s*)?(\d+)\s*)?\)\s*(?:->|=>|=|:)\s*(?:Some\(\s*)?(\d+|none)\s*\)?$/i
const FREE_LINE = /^free\(\s*(\d+)\s*(?:,\s*\d+\s*)?\)$/i
/** A trace is at most 16 KiB; this bounds the work on a hostile one all the same. */
const MAX_TRACE_OPS = 4000

export function parseTrace(text: string): TraceOp[] {
  const ops: TraceOp[] = []
  for (const raw of text.split('\n')) {
    if (ops.length >= MAX_TRACE_OPS) break
    const line = raw.trim()
    const a = ALLOC_LINE.exec(line)
    if (a !== null) {
      ops.push({ kind: 'alloc', size: Number(a[1]), align: a[2] === undefined ? 1 : Math.max(1, Number(a[2])), got: a[3].toLowerCase() === 'none' ? null : Number(a[3]) })
      continue
    }
    const f = FREE_LINE.exec(line)
    if (f !== null) ops.push({ kind: 'free', offset: Number(f[1]) })
  }
  return ops
}

const largest = (state: ReturnType<typeof createHeap>) => viewOf(state).largestFree
const SHOWN = 8

/**
 * Replays the learner's own trace on the reference heap: every alloc is placed where the learner put it
 * (the engine refuses a start outside the heap or inside a live block), every refusal is checked against
 * the free span the live blocks leave, and every free goes back by offset. The first op the reference
 * rejects is the divergence; the first-fit column shows what the reference itself would have done.
 */
export function replayTrace(ops: readonly TraceOp[]): Walkthrough {
  let state = createHeap(LAB_HEAP)
  const live = new Map<number, { id: number; size: number }>()
  const steps: WalkStep[] = []
  let nextId = 1
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    const n = i + 1
    if (op.kind === 'free') {
      const hit = live.get(op.offset)
      if (hit === undefined) {
        steps.push({ n, op: `free(${op.offset})`, yours: 'freed it', reference: 'no live block starts there', diverges: true })
        break
      }
      state = freeId(state, hit.id)
      live.delete(op.offset)
      steps.push({ n, op: `free(${op.offset})`, yours: 'freed it', reference: `largest free run ${largest(state)} B`, diverges: false })
      continue
    }
    const label = `alloc(${op.size}, align ${op.align})`
    const id = nextId++
    const bytes = Math.max(1, op.size)
    const ff = FIRST_FIT.place(viewOf(state), { id, size: bytes, align: op.align })
    const ref = ff.kind === 'place' ? `first-fit puts it at ${ff.start}` : 'no free run is big enough'
    if (op.got === null) {
      const fits = fitsAnywhere(viewOf(state), { id, size: bytes + SLACK, align: op.align })
      steps.push({
        n,
        op: label,
        yours: 'None',
        reference: fits ? `refused, yet ${largest(state)} B are free in one run` : `${ref}, so refusing is right`,
        diverges: fits,
      })
      if (fits) break
      continue
    }
    const at = op.got
    const bad = (why: string) => steps.push({ n, op: label, yours: `at ${at}`, reference: why, diverges: true })
    if (at % op.align !== 0) {
      bad(`${at} is not a multiple of ${op.align}`)
      break
    }
    const placed = placeBlock(state, id, bytes, bytes, at)
    if (!placed.ok) {
      const over = [...live.entries()].sort((x, y) => x[0] - y[0]).find(([off, b]) => at < off + b.size && off < at + bytes)
      bad(
        at + bytes > LAB_HEAP.capacity
          ? `[${at}, ${at + bytes}) runs past the ${LAB_HEAP.capacity} B heap`
          : over === undefined
            ? placed.reason
            : `[${at}, ${at + bytes}) overlaps your live block [${over[0]}, ${over[0] + over[1].size})`,
      )
      break
    }
    state = placed.state
    live.set(at, { id, size: bytes })
    steps.push({ n, op: label, yours: `at ${at}`, reference: ref, diverges: false })
  }
  const bad = steps.find((s) => s.diverges)
  if (bad === undefined) {
    const shown = steps.slice(-SHOWN)
    return {
      source: 'trace',
      steps: shown,
      divergedAt: null,
      skipped: steps.length - shown.length,
      headline:
        'No op in your trace breaks the rules, so the failure is in an op your trace does not show. The buffer holds 16 KiB; log less per op, or log only the failing stretch.',
    }
  }
  const shown = steps.slice(Math.max(0, steps.length - SHOWN))
  return {
    source: 'trace',
    steps: shown,
    divergedAt: bad.n,
    skipped: steps.length - shown.length,
    headline: `Your allocator first leaves the rules at op ${bad.n}, ${bad.op}. Everything before it agrees with the reference.`,
  }
}

interface ScriptOp {
  op: HeapOp
  note?: string
}

const CAP = LAB_HEAP.capacity
const KIB = 1024

/** Each check's op sequence, shrunk to what shows the idea, on the reference alone (for a learner whose code logs nothing). */
const SCRIPTS: Record<string, readonly ScriptOp[]> = {
  boot: [{ op: { op: 'alloc', id: 1, size: 1, align: 1 }, note: 'The first byte of an empty heap comes from offset 0.' }],
  align: [
    { op: { op: 'alloc', id: 1, size: 3, align: 1 } },
    { op: { op: 'alloc', id: 2, size: 10, align: 64 }, note: 'The 61 bytes skipped to reach a multiple of 64 stay free.' },
    { op: { op: 'alloc', id: 3, size: 1, align: 256 } },
    { op: { op: 'alloc', id: 4, size: 8, align: 8 }, note: 'The padding is reused: first-fit finds it before the tail.' },
  ],
  no_overlap: [
    { op: { op: 'alloc', id: 1, size: 100, align: 8 } },
    { op: { op: 'alloc', id: 2, size: 200, align: 8 }, note: 'Starts at the next multiple of 8 after byte 100, not inside block 1.' },
    { op: { op: 'free', id: 1 } },
    { op: { op: 'alloc', id: 3, size: 90, align: 8 }, note: 'Fits the hole block 1 left; its end stays below block 2.' },
  ],
  reuse: [
    { op: { op: 'alloc', id: 1, size: KIB, align: 8 } },
    { op: { op: 'free', id: 1 } },
    { op: { op: 'alloc', id: 2, size: KIB, align: 8 }, note: 'Same offset as the first: the freed block came back.' },
  ],
  coalesce: [
    { op: { op: 'alloc', id: 1, size: 16 * KIB, align: 16 } },
    { op: { op: 'alloc', id: 2, size: 16 * KIB, align: 16 } },
    { op: { op: 'alloc', id: 3, size: 16 * KIB, align: 16 } },
    { op: { op: 'alloc', id: 4, size: CAP - 48 * KIB, align: 1 }, note: 'The rest of the heap is full, so only a merged run can serve the last request.' },
    { op: { op: 'free', id: 1 } },
    { op: { op: 'free', id: 3 } },
    { op: { op: 'free', id: 2 }, note: 'The middle block joins the free runs on both sides at once.' },
    { op: { op: 'alloc', id: 5, size: 48 * KIB, align: 16 }, note: 'One 48 KiB run, because the three merged.' },
  ],
  fragmentation: [
    { op: { op: 'alloc', id: 1, size: 2 * KIB, align: 16 } },
    { op: { op: 'alloc', id: 2, size: 2 * KIB, align: 16 } },
    { op: { op: 'alloc', id: 3, size: 2 * KIB, align: 16 } },
    { op: { op: 'alloc', id: 4, size: 2 * KIB, align: 16 } },
    { op: { op: 'alloc', id: 5, size: CAP - 8 * KIB, align: 1 }, note: 'The heap is full.' },
    { op: { op: 'free', id: 2 } },
    { op: { op: 'free', id: 3 } },
    { op: { op: 'free', id: 4 }, note: 'Three 2 KiB neighbours are free. Merged, they are one 6 KiB run.' },
    { op: { op: 'alloc', id: 6, size: 6 * KIB - SLACK, align: 16 }, note: 'A refusal here would be a bug: the span exists.' },
  ],
}

const opLabel = (op: HeapOp) => (op.op === 'free' ? `free(#${op.id})` : `alloc(${op.size}, align ${op.align ?? 1}) as #${op.id}`)

/** The check's op sequence replayed on the reference (first-fit, eager coalescing). */
export function referenceScript(checkId: string): Walkthrough {
  const script = SCRIPTS[checkId] ?? []
  let state = createHeap(LAB_HEAP)
  const steps: WalkStep[] = []
  script.forEach(({ op, note }, i) => {
    const res = applyOp(state, op, FIRST_FIT)
    state = res.state
    const where = op.op === 'free' ? `largest free run ${largest(state)} B` : res.ok ? `at ${res.at}, largest free run ${largest(state)} B` : `refused: ${res.reason}`
    steps.push({ n: i + 1, op: opLabel(op), yours: '-', reference: where, diverges: false, ...(note === undefined ? {} : { note }) })
  })
  return {
    source: 'script',
    steps,
    divergedAt: null,
    skipped: 0,
    headline:
      'Your allocator logged no trace, so here is the check’s op sequence on the reference. Log each call with kslab::trace! as "alloc(size, align) -> offset" and "free(offset)", run again, and this view will show where yours first leaves the rules.',
  }
}

/** The bottom-out walkthrough for a check: the learner's trace when it holds parseable lines, else the script. */
export function walkthroughFor(checkId: string, trace?: string): Walkthrough {
  const ops = trace === undefined ? [] : parseTrace(trace)
  return ops.length > 0 ? replayTrace(ops) : referenceScript(checkId)
}
