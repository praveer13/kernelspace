/**
 * Lab 03's authored hint ladder (docs/specs/wave-2.md §13.3): five rungs for every required check, and a bottom-out
 * walkthrough that replays the reference on a small case from the check. The rules every lab shares (unlocking, the
 * reducer, the ledger refs, the "ask a human" link) live in src/lib/forge/ladder.ts; scripts/lint-mentor.ts
 * (`bun run verify:mentor`) holds every authored rung to its limits.
 *
 * Pure data and pure functions: the component (src/components/forge/HintLadder.tsx) owns the clock and the ledger.
 */

import { CORPUS, encodeSteps, trainBpe, type Merge } from '@/lib/world/bpe'
import type { CheckLadder, LessonLink, WalkStep, Walkthrough } from '../types'

export const LAB_ID = 'bpe-tokenizer'

/** The title prefix of lab 03's Ask-a-human posts. */
export const DEFAULT_LABEL = '[lab 03]'

export const R0_PROMPT = 'In two sentences: what does this check do to your tokenizer, and what did yours do?'

const TOKENS: LessonLink = {
  lessonId: 't5.l2',
  h2: 'The systems-relevant consequences',
  anchor: 'the-systems-relevant-consequences',
}
const DATA_PATHS: LessonLink = { lessonId: 'r.l6', h2: 'Build the Forge data paths', anchor: 'build-the-forge-data-paths' }

export const LADDER: Record<string, CheckLadder> = {
  bytes_are_ids: {
    checkId: 'bytes_are_ids',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It builds a tokenizer from an empty merge table and encodes "hello".',
        'It fails if the ids are not the five UTF-8 bytes, 104 101 108 108 111, or if decode does not return "hello".',
        'With no rules to apply, every byte is its own id, and the byte values are the ids.',
      ],
    },
    r1: {
      text: 'Before any merge exists, a tokenizer is a plain mapping: byte b is id b. The word "hello" is five bytes, so five ids. Merges come later and only fuse ids that already exist. Get this layer right first, because every later stage builds on it, and the table can stay unused for now.',
      link: TOKENS,
    },
    r2: {
      text: 'The message shows the ids your encode returned beside the ones wanted. In lib.rs, check_bytes_are_ids builds a tokenizer with an empty table and encodes "hello". Check what encode starts from: the text’s bytes, each widened to a u32.',
      fn: 'check_bytes_are_ids',
    },
    r3: [
      'encode: take the text as bytes and widen each byte to its own id',
      'decode: take the ids as bytes and read them as UTF-8',
      'ignore the merge table for now, since it is empty',
    ].join('\n'),
    r4: 'A tokenizer here is two functions over one table. With an empty table, encode is only a conversion: the UTF-8 bytes of the text, each kept as a number from 0 to 255. decode is its inverse: every id below 256 is a byte, so collect the bytes and read them as a string. The invariant for this stage is that decode of encode gives the text back, byte for byte.',
  },

  merge_priority: {
    checkId: 'merge_priority',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It builds a two-rule table, (b, c) at rank 0 and (a, b) at rank 1, and encodes "abc".',
        'It fails unless the result is [97, 256]: the rank-0 pair merges first, although (a, b) sits further left.',
        'Rank is the position in the merge table, so the lowest rank anywhere in the sequence wins, not the leftmost pair.',
      ],
    },
    r1: {
      text: 'A merge table is ordered by priority, and the order is the rank: the rule at index 0 beats the rule at index 1. When two pairs could merge, the lower rank goes first wherever it sits in the text. Index the table so a pair finds its rank quickly, as a frequency map finds a count.',
      link: DATA_PATHS,
    },
    r2: {
      text: 'The message shows what encode("abc") returned. In lib.rs, check_merge_priority holds the two rules and the answer wanted. Does your encode pick the lowest rank over the whole sequence, or the first pair it finds with any rule?',
      fn: 'check_merge_priority',
    },
    r3: [
      'look at every adjacent pair and find the lowest rank among those with a rule',
      'replace that pair wherever it occurs in the sequence',
      'then look at the new sequence from the start',
    ].join('\n'),
    r4: 'Index the table once: a map from each pair to its rank and its merged id, where rank is the position in the list. To encode, start from the bytes and scan every adjacent pair, keeping the smallest rank. If no pair has a rule, stop. Otherwise replace that pair and look again. Rank is the position in the list, not the merged id, so keep them as separate values.',
  },

  leftmost_nonoverlap: {
    checkId: 'leftmost_nonoverlap',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It uses one rule, (a, a) into 256, and encodes "aaaa", "aaa" and "aa".',
        'It fails unless they give [256, 256], [256, 97] and [256]: merged from the left, with no byte used twice.',
        'A merge consumes both of its bytes, so the scan skips past the pair it just replaced.',
      ],
    },
    r1: {
      text: 'When a pair repeats, as in a run of one byte, the matches overlap: "aaa" holds (a, a) at positions 0 and 1. Replace from the left, and once a pair merges, step past both of its bytes. The leftover a stays as it is. The scan only moves forward and never reuses a byte.',
      link: TOKENS,
    },
    r2: {
      text: 'The message names the string and shows your ids beside the wanted ones. In lib.rs, check_leftmost_nonoverlap tries "aaaa", "aaa" and "aa". If "aaa" is wrong, check where your scan moves after it replaces a pair.',
      fn: 'check_leftmost_nonoverlap',
    },
    r3: [
      'walk the ids from left to right with one position',
      'if this id and the next one form the pair, push the merged id and skip two',
      'otherwise push this id and move on by one',
    ].join('\n'),
    r4: 'Build a new vector while walking the old one by index. At each position, test whether the current and the next id form the pair being merged. If they do, push the merged id and advance by two. If not, push the current id and advance by one. Never look back, and never test a pair that starts inside one you just merged. The leftover element survives.',
  },

  roundtrip: {
    checkId: 'roundtrip',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It builds a table of 16 to 48 merges from a seed, encodes twelve texts with emoji, CJK and accents, and decodes each.',
        'It fails when decode(encode(text)) is not the text, byte for byte.',
        'Usual causes: a decode that stops after one level of merges, or one that mangles multi-byte characters.',
      ],
    },
    r1: {
      text: 'A merged id stands for two ids, and either may itself be a merged id. Decoding means expanding until only bytes remain. Collect all the bytes first, then read them as UTF-8 once at the end. Reading each token as text on its own can cut a multi-byte character in half.',
      link: TOKENS,
    },
    r2: {
      text: 'The message shows the merge count and the text that failed. In lib.rs, check_roundtrip encodes twelve texts and compares each decode with the original. Does your decode expand a merge id through its children until every id is below 256?',
      fn: 'check_roundtrip',
    },
    r3: [
      'keep a stack of ids still to expand, starting with one id',
      'an id below 256 is a byte, so output it, and any other id pushes its right child, then its left',
      'after all the ids, read the collected bytes as UTF-8 text',
    ].join('\n'),
    r4: 'Remember each merge as: merged id maps to its two children. To decode, keep a work stack. Pop an id. If it is below 256, append that byte. If it is in the map, push its right child and then its left, so the left comes out first. Continue until the stack is empty, then turn the whole byte buffer into a string once.',
  },

  robust_decode: {
    checkId: 'robust_decode',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It builds a one-rule table and decodes an empty list, the id 9999, and the list [256, 9999, 97].',
        'It wants "", then U+FFFD, then "ab", U+FFFD and "a": a bad id degrades to the replacement character.',
        'A tokenizer inside a server must never panic on bad input, and must not silently drop an id.',
      ],
    },
    r1: {
      text: 'Ids reach a tokenizer from outside: a client, a log, a corrupted cache. An id that is not a byte and not in the table has no meaning, so the safe answer is U+FFFD, the replacement character, while the ids around it still decode. Panicking would take the server down for one bad request.',
      link: TOKENS,
    },
    r2: {
      text: 'The message shows what decode returned for which ids. In lib.rs, check_robust_decode tries an empty list, id 9999 and a list mixing good and bad ids. Check what your decode does when the table has no entry for an id.',
      fn: 'check_robust_decode',
    },
    r3: [
      'an id below 256 is a byte',
      'an id in the table expands to its two children',
      'any other id adds the three bytes of U+FFFD, and decoding goes on',
    ].join('\n'),
    r4: 'Decode never asks up front whether an id is valid. It handles three cases as it goes. A byte id adds that byte. A table id is replaced by its two children. Any other id adds the three UTF-8 bytes of U+FFFD, which are EF BF BD, and moves on to the next id. An empty list gives an empty string. Then read the collected bytes as lossy UTF-8.',
  },

  contract: {
    checkId: 'contract',
    r0: {
      prompt: R0_PROMPT,
      ideas: [
        'It trains a 48-merge table on the lab’s corpus and encodes a fixed sentence it expects bit for bit.',
        'It then encodes six seeded texts, and fails if any adjacent pair still has a rule, or if decode does not return the text.',
        'The ids are the model’s contract. Close does not exist: one wrong id changes every number the model sees.',
      ],
    },
    r1: {
      text: 'A trained table has dozens of rules, and merged ids appear in later rules. Each merge creates new pairs, so one round of finding the lowest-rank pair and replacing it is not enough. Keep going until no adjacent pair has a rule. Then the output matches the reference exactly.',
      link: TOKENS,
    },
    r2: {
      text: 'The message gives the first index where your ids differ, or says a pair still had a rule. In lib.rs, check_contract has the fixed sentence, then six seeded texts. Does your encode loop until nothing merges?',
      fn: 'check_contract',
    },
    r3: [
      'repeat: find the lowest rank among all adjacent pairs that have a rule',
      'if there is none, stop, and if there is one, replace every occurrence of that pair',
      'the loop ends because every replacement makes the sequence shorter',
    ].join('\n'),
    r4: 'Wrap stage 2 in a loop. Each round finds the smallest rank among all adjacent pairs, replaces that pair everywhere from the left, and goes round again. The loop ends when no pair has a rule. It terminates because each round shortens the sequence by at least one id. Invariants: the result has no adjacent pair with a rule, and decoding it gives back the text.',
  },
}

/** Check ids with an authored ladder, in grading order. */
export const LADDER_CHECK_IDS = ['bytes_are_ids', 'merge_priority', 'leftmost_nonoverlap', 'roundtrip', 'robust_decode', 'contract'] as const

/* ------------------------------------------------------------------ */
/* The walkthrough                                                      */
/* ------------------------------------------------------------------ */

/** One encode the check makes, shrunk to what shows the idea. */
interface Case {
  merges: readonly Merge[]
  text: string
  note?: string
}

const ABC: readonly Merge[] = [
  [98, 99, 256],
  [97, 98, 257],
]
const AA: readonly Merge[] = [[97, 97, 256]]

const SMALL = (): readonly Merge[] => trainBpe(CORPUS, 16)
const HARNESS = (): readonly Merge[] => trainBpe(CORPUS, 48)

/** Each check's encode cases (not the texts the checks themselves use for `roundtrip` and `contract`). */
const CASES: Record<string, () => readonly Case[]> = {
  bytes_are_ids: () => [{ merges: [], text: 'hello', note: 'No rules, so no pass: each byte is its own id.' }],
  merge_priority: () => [{ merges: ABC, text: 'abc', note: 'Rank 0 is (b, c). It goes first, and the b it takes is gone before (a, b) can use it.' }],
  leftmost_nonoverlap: () => [
    { merges: AA, text: 'aaaa' },
    { merges: AA, text: 'aaa', note: 'The first two a bytes merge. The third has no partner left.' },
    { merges: AA, text: 'aa' },
  ],
  roundtrip: () => [{ merges: SMALL(), text: 'the stream', note: 'Decode these ids and the ten bytes of the text must come back.' }],
  robust_decode: () => [],
  contract: () => [{ merges: HARNESS(), text: 'the stream', note: 'Each pass makes pairs the next pass can use, so the loop runs until none has a rule.' }],
}

const show = (ids: readonly number[]) => `[${ids.join(', ')}]`

/** What the learner logs with `kslab::trace!`: `encode("abc") -> [97, 256]`. */
const ENCODE_LINE = /^encode\(\s*"(.*)"\s*\)\s*(?:->|=>|=|:)\s*\[([\d,\s]*)\]$/i
/** A trace is at most 16 KiB; this bounds the work on a hostile one all the same. */
const MAX_LINES = 400

/** The ids the learner logged for each text, the last call winning. */
function loggedEncodes(trace: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  for (const raw of trace.slice(0, MAX_LINES)) {
    const m = ENCODE_LINE.exec(raw.trim())
    if (m === null) continue
    const ids = m[2].split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number)
    out.set(m[1], ids)
  }
  return out
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i])

const SCRIPT_HEADLINE =
  'Your tokenizer logged nothing, so here is the reference on a small case from the check, one pass at a time. Log each call with kslab::trace! as encode("abc") -> [97, 256], run again, and this view will show where yours first differs.'

function robustScript(): Walkthrough {
  const rows: [string, string][] = [
    ['decode([])', 'the empty string'],
    ['decode([9999])', 'U+FFFD: no byte and no rule, so one replacement character'],
    ['decode([256, 9999, 97])', '"ab", U+FFFD, "a": the bad id degrades, and the ids around it still decode'],
  ]
  return {
    source: 'script',
    divergedAt: null,
    skipped: 0,
    headline: 'Here is what the reference decode does with the ids robust_decode feeds it, with one rule that merges (97, 98) into 256.',
    steps: rows.map(([op, reference], i) => ({ n: i + 1, op, yours: '-', reference, diverges: false })),
  }
}

/**
 * The bottom-out walkthrough for a check: the reference on a small case from the check, pass by pass, and your logged
 * `encode("…") -> [ids]` lines beside it where a text matches. The first call that differs is the divergence.
 */
export function walkthroughFor(checkId: string, trace: readonly string[] = []): Walkthrough {
  if (checkId === 'robust_decode') return robustScript()
  const cases = (CASES[checkId] ?? (() => []))()
  const logged = loggedEncodes(trace)
  const steps: WalkStep[] = []
  let divergedAt: number | null = null
  let matched = false
  for (const c of cases) {
    const { steps: passes, ids } = encodeSteps(c.text, c.merges)
    passes.forEach((p, k) => {
      steps.push({
        n: steps.length + 1,
        op: `encode("${c.text}"), pass ${k + 1}`,
        yours: '-',
        reference: `rank ${p.rank}, (${p.merge[0]}, ${p.merge[1]}) into ${p.merge[2]}, ${p.replaced} ${p.replaced === 1 ? 'place' : 'places'}: ${show(p.ids)}`,
        diverges: false,
      })
    })
    const mine = logged.get(c.text)
    const differs = mine !== undefined && !same(mine, ids)
    if (mine !== undefined) matched = true
    steps.push({
      n: steps.length + 1,
      op: `encode("${c.text}")`,
      yours: mine === undefined ? '-' : show(mine),
      reference: show(ids),
      diverges: differs,
      ...(c.note === undefined ? {} : { note: c.note }),
    })
    if (differs && divergedAt === null) divergedAt = steps.length
  }
  const shown = steps.slice(0, divergedAt ?? steps.length)
  if (divergedAt !== null) {
    const bad = steps[divergedAt - 1]
    return {
      source: 'trace',
      steps: shown,
      divergedAt,
      skipped: 0,
      headline: `Your encode first leaves the reference at ${bad.op}: you logged ${bad.yours}, and the reference gives ${bad.reference}.`,
    }
  }
  return matched
    ? {
        source: 'trace',
        steps,
        divergedAt: null,
        skipped: 0,
        headline: 'Every encode you logged for this check agrees with the reference, so the failure is in a call your trace does not show. Log the failing text from the check’s message.',
      }
    : { source: 'script', steps, divergedAt: null, skipped: 0, headline: SCRIPT_HEADLINE }
}
