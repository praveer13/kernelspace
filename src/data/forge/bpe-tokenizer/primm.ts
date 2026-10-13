/**
 * Lab 03 (bpe-tokenizer) in PRIMM stages (docs/specs/wave-2.md §13.3): Predict, Run, Investigate, Modify, Make.
 *
 * Pure data and pure functions (no DOM, no clock, no storage), in the shape of the Forge bundle contract:
 *   1. the stage table of the Make step (`STAGES`), the same four stages as `tokenizer.rs` and labs.ts;
 *   2. the in-browser reference run (`RUN_SPEC`): the page's own byte-level BPE (src/lib/world/bpe.ts, which trains and
 *      encodes exactly as the harness does) applied to one sentence with the first N merges of the lab's table;
 *   3. the items: what the learner predicts, investigates and modifies (`PRIMM_ITEMS`). Each one is the ledger ref
 *      `item:lab03.primm.<id>`.
 *
 * The reference run is NOT a check. It is a labelled stand-in: the lab's corpus and trainer, a sentence the checks never
 * use, and token counts only, so no check's expected ids are on the page before the learner builds the encoder.
 */

import { KC } from '@/data/kc/ids'
import type { QuizQuestion } from '@/components/QuizBlock'
import type { AuthoredItem } from '@/lib/items/types'
import { CORPUS, bytesOf, encodeWith, trainBpe, type Merge } from '@/lib/world/bpe'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, ReferenceRunSpec, RunConfig, RunResult, StageInfo } from '../types'

export const PRIMM_LAB = 'bpe-tokenizer'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/** The stage markers in `labs/bpe-tokenizer/src/tokenizer.rs`. Which checks belong to which stage comes from labs.ts. */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'Bytes', minutes: 2, goal: '`encode` and `decode` with no merges: byte b is id b. The two-minute win.' },
  { n: 2, title: 'Merge', minutes: 20, goal: 'Index the table, then merge the lowest rank first, left to right, without overlap.' },
  { n: 3, title: 'Decode', minutes: 20, goal: 'Expand merge ids back to bytes, however deep; a bad id becomes U+FFFD.' },
  { n: 4, title: 'Contract', minutes: 10, goal: 'Repeat until nothing merges, so a 48-rule table gives exactly the reference ids.' },
]

/* ------------------------------------------------------------------ */
/* The reference run: one sentence, the first N merges                  */
/* ------------------------------------------------------------------ */

/** The Run step's sentence: made of the corpus's own words, in an order the corpus never has, and not any check's text. */
export const RUN_TEXT = 'the scheduler batches the keys and values for the user'

/** Most merges a run can ask for: `trainBpe` stops at 168, where no adjacent pair is left in the corpus. */
const MAX_MERGES = 200

/** The harness's merge count for `contract` and `probe`, and the Run step's reference. */
export const REFERENCE_MERGES = 48

/** A frame every this many merges at most, so a long run still plays in a few seconds (about 49 frames). */
const FRAMES = 48

let table: Merge[] | undefined
/** The lab's corpus trained as far as it goes (168 merges); a prefix of it is the harness's table of that many merges. */
export function fullTable(): readonly Merge[] {
  table ??= trainBpe(CORPUS, MAX_MERGES)
  return table
}

/** Merges the page can apply: the whole trained table. */
export const maxMerges = (): number => fullTable().length

const clampMerges = (config: RunConfig): number => {
  const n = Math.round(Number(config.merges))
  return Number.isFinite(n) ? Math.min(maxMerges(), Math.max(0, n)) : REFERENCE_MERGES
}

const bytesPerToken = (bytes: number, tokens: number) => (tokens === 0 ? '0.00' : (bytes / tokens).toFixed(2))

/** Byte length of every id in the table: a byte is 1, a merge is the sum of its two children. */
function byteLengths(): Map<number, number> {
  const len = new Map<number, number>()
  for (const [l, r, id] of fullTable()) len.set(id, (len.get(l) ?? 1) + (len.get(r) ?? 1))
  return len
}

/** The ids of `RUN_TEXT` under the first `merges` rules. */
export const idsAt = (merges: number, text: string = RUN_TEXT): number[] => encodeWith(text, fullTable(), merges)

/** The Run step's second number: tokens of `RUN_TEXT` under the first `merges` rules. */
export const tokensAt = (merges: number, text: string = RUN_TEXT): number => idsAt(merges, text).length

/** What `ReferenceRun` shows for a config `{ merges }`, in the bundle's lab-neutral shape. */
function runResult(config: RunConfig): RunResult {
  const merges = clampMerges(config)
  const lengths = byteLengths()
  const bytes = bytesOf(RUN_TEXT).length
  const stride = Math.max(1, Math.ceil(merges / FRAMES))
  const marks: number[] = []
  for (let n = 0; n < merges; n += stride) marks.push(n)
  marks.push(merges)
  const frames = marks.map((n) => {
    const ids = idsAt(n)
    const longest = ids.reduce((m, id) => Math.max(m, lengths.get(id) ?? 1), 1)
    return {
      op: n,
      cells: ids.map((id) => Math.min(100, ((lengths.get(id) ?? 1) * 100) / 8)),
      stats: [
        { label: 'tokens', value: String(ids.length) },
        { label: 'bytes per token', value: bytesPerToken(bytes, ids.length) },
        { label: 'longest token', value: `${longest} ${longest === 1 ? 'byte' : 'bytes'}` },
      ],
      alt: `The ${bytes}-byte sentence as ${ids.length} tokens after ${n} merges, one cell per token, darker for a longer token. ${bytesPerToken(bytes, ids.length)} bytes per token.`,
    }
  })
  const tokens = tokensAt(merges)
  return {
    config,
    total: merges,
    value: tokens,
    truth: bytes,
    clean: true,
    frames,
    summary:
      merges === 0
        ? `With no merges every byte is its own token: ${bytes} bytes, ${bytes} tokens.`
        : `With ${merges} merges the ${bytes}-byte sentence becomes ${tokens} tokens, ${bytesPerToken(bytes, tokens)} bytes per token.`,
  }
}

/** The Run step's own item: the reference run's observed token count. An observation, not an answer: no KCs. */
export const RUN_ITEM = { id: 'lab03.primm.r1', nsec: 45 }

/** Lab 03's Run and Modify steps as data: the bundle's `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) => `Reference: the first ${clampMerges(config)} merges of the lab’s table`,
  disclaimer:
    'This is the page’s own BPE on one sentence the checks never use, trained on the lab’s corpus. It is not a check, and it shows counts, not the ids a check expects.',
  reference: { merges: REFERENCE_MERGES },
  run: runResult,
  modify: {
    lead: `Change one thing about the reference run (the first ${REFERENCE_MERGES} merges, ${tokensAt(REFERENCE_MERGES)} tokens).`,
    dials: [
      { id: 'merges96', label: `${REFERENCE_MERGES} merges becomes 96 merges`, config: { merges: 96 } },
      { id: 'merges24', label: `${REFERENCE_MERGES} merges becomes 24 merges`, config: { merges: 24 } },
      { id: 'merges-all', label: `${REFERENCE_MERGES} merges becomes every merge the corpus has (${maxMerges()})`, config: { merges: maxMerges() } },
    ],
  },
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

type KcList = AuthoredItem['kcs']

const choice = (
  id: string,
  step: ChoicePrimm['step'],
  kcs: KcList,
  q: Omit<QuizQuestion, 'kcs'>,
  nsec = 45,
): ChoicePrimm => ({ kind: 'choice', id, step, nsec, item: { id, kcs, q: { ...q, kcs: [...kcs] } } })

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab03.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: [KC.bpeMerges, KC.tokenizerBytes],
    prompt: `The lab trains a table of 48 merges on a short text about a serving stack ("the scheduler schedules the batch. the batcher batches tokens. ..."). Then it encodes text the table never saw. Take this sentence of ${bytesOf(RUN_TEXT).length} bytes: "${RUN_TEXT}". About how many tokens does the encoder turn it into after the 48 merges?`,
    unit: 'tokens',
    factor: 1.4,
    explain:
      'Every merge fuses a pair the corpus repeats, and this sentence is built from the corpus’s own words, so most of its bytes land inside merged pieces. Words like "the", "user" and "values" become one or two tokens each. Text the corpus never used, such as other scripts, would merge far less.',
  },
  choice('lab03.primm.p2', 'predict', [KC.bpeMerges], {
    q: 'You write `encode` so that it always merges the leftmost adjacent pair that has a rule, instead of the lowest-rank pair anywhere in the sequence. Going through the stages in stage order (1, 2, 3, 4), which check goes red first?',
    options: [
      '`bytes_are_ids` in stage 1, because it needs the merge loop',
      '`merge_priority` in stage 2, because its two rules compete on "abc"',
      '`leftmost_nonoverlap` in stage 2, because "aaa" has two pairs',
      '`contract` in stage 4, because 48 rules give many pairs to choose from',
    ],
    correct: [1],
    why: [
      'With an empty table there is no pair to choose, so any merge order gives the bytes back and stage 1 is green.',
      'The table has (b, c) at rank 0 and (a, b) at rank 1. Leftmost-first merges (a, b) and returns [257, 99], but the check wants [97, 256], so this is the first red check.',
      'That table has one rule, so the leftmost pair and the lowest-rank pair are always the same pair. A leftmost-first encoder stays green here.',
      'It does fail there too, since the 48 rules disagree about order, but stage 4 comes after stage 2, and `merge_priority` is already red by then.',
    ],
    explanation: 'Leftmost-first and lowest-rank-first only differ when two rules compete. `merge_priority` is the smallest table in which they do.',
  }),

  /* ---- Investigate: the harness ---- */
  {
    kind: 'numeric',
    id: 'lab03.primm.i1',
    step: 'investigate',
    nsec: 40,
    kcs: [KC.bpeMerges],
    prompt:
      'The `merge_priority` table has two rules: rank 0 merges (b, c) into 256, and rank 1 merges (a, b) into 257. The bytes are a = 97, b = 98, c = 99. What is the first id that `encode("abc")` returns?',
    unit: 'id',
    truth: 97,
    lures: [
      { value: 257, miss: 'bpe.leftmost-first', message: 'That is what merging the leftmost pair gives: [257, 99]. Rank 0 is (b, c), so it goes first and takes the b away from (a, b).' },
      { value: 256, miss: 'bpe.wrong-position', message: '256 is the second id. The a stays alone, because the b joined the c before (a, b) could use it.' },
      { value: 98, miss: 'bpe.byte-shift', message: 'The ids follow the text, and the text starts with a (97), not b (98).' },
    ],
    explain: 'Rank 0 (b, c) merges first, giving [97, 256]. The pair (97, 256) has no rule, so the encoding ends there.',
  },
  {
    kind: 'numeric',
    id: 'lab03.primm.i2',
    step: 'investigate',
    nsec: 40,
    kcs: [KC.bpeMerges],
    prompt: 'One rule merges (a, a) into 256. How many tokens does `encode("aaaaa")` return, five a bytes in a row?',
    unit: 'tokens',
    truth: 3,
    lures: [
      { value: 5, miss: 'bpe.no-merge', message: 'Five tokens means no merge happened. Each (a, a) pair is a rule match.' },
      { value: 4, miss: 'bpe.overlapping', message: 'Four is what you get when every neighbouring pair merges and a byte is used twice. A merged pair takes both its bytes.' },
      { value: 2, miss: 'bpe.dropped-tail', message: 'Two pairs merge, but the fifth byte is still there. A tokenizer never drops a byte.' },
    ],
    explain: 'Left to right, the first two a bytes merge, the next two merge, and the last a stays alone: [256, 256, 97].',
  },
  choice('lab03.primm.i3', 'investigate', [KC.tokenizerBytes], {
    q: 'Id 259 was merged from 256 and 258, and 258 was itself merged from two byte ids. Your `decode` expands 259 into its two children and no further. Which checks go red?',
    options: [
      '`robust_decode` and `roundtrip`, because bad ids and nested ids both need expanding',
      '`roundtrip` only, because `contract` compares ids and decodes none',
      '`bytes_are_ids` and `roundtrip`, because byte ids are expanded the same way',
      '`roundtrip` and `contract`, because both read ids back from trained tables',
    ],
    correct: [3],
    why: [
      '`robust_decode` uses a one-rule table: 256 is (97, 98) and both children are bytes, so one level is enough there and that check is green.',
      '`contract` compares the ids first, but it then decodes six fresh texts and compares them with the originals, so it fails too once a nested merge is lost.',
      '`bytes_are_ids` has an empty table, so there is nothing nested to expand. It decodes plain byte ids and is green.',
      'A trained table nests merges, as 259 does. Both `roundtrip` and the second half of `contract` run decode(encode(text)) on such a table, so both go red.',
    ],
    explanation: 'Nested merges only show up in tables trained on text. The two checks that use one are the two that need a decode which goes all the way down.',
  }),
  {
    kind: 'numeric',
    id: 'lab03.primm.i4',
    step: 'investigate',
    nsec: 40,
    kcs: [KC.tokenizerBytes],
    prompt:
      'One rule merges (97, 98) into 256. `robust_decode` calls `decode([256, 9999, 97])`: the merge, an id the table has never heard of, and an a. The expected string is "ab", then U+FFFD, then "a". How many UTF-8 bytes long is that string?',
    unit: 'bytes',
    truth: 6,
    lures: [
      { value: 3, miss: 'bpe.dropped-unknown', message: 'Three bytes is "aba": the unknown id vanished. The check wants a replacement character there, not a gap.' },
      { value: 4, miss: 'bpe.question-mark', message: 'Four bytes is "ab?a". U+FFFD is not a question mark: it is a single character that takes three bytes in UTF-8.' },
      { value: 5, miss: 'bpe.two-byte-replacement', message: 'Five bytes counts the replacement character as two. U+FFFD is encoded as EF BF BD, three bytes.' },
    ],
    explain: '"ab" is 2 bytes, U+FFFD is 3 (EF BF BD) and "a" is 1: 6 bytes, with the bad id replaced and the ids around it intact.',
  },
  choice('lab03.primm.i5', 'investigate', [KC.bpeMerges], {
    q: 'Your encoder passes `merge_priority` and `leftmost_nonoverlap`, but `contract` fails with "ids 99 and 257 at index 14 still have a merge rule — encode stopped early". What does your `encode` most likely do?',
    options: [
      'It leaves out the last rule of the table, so a pair that rule names stays unmerged',
      'It merges the highest rank first, so later rules fire before earlier ones',
      'It expands merge ids one level, so a nested id comes back as the wrong bytes',
      'It merges the lowest-rank pair once and stops, so new pairs go unchecked',
    ],
    correct: [3],
    why: [
      'That would break `leftmost_nonoverlap`, whose only rule is its last one, and the stem says that check passes.',
      'A highest-rank-first encoder returns the wrong ids on "abc", so `merge_priority` would be red as well. The stem says it passes.',
      'That is a decode bug. It would break the decode(encode(text)) comparison, and the message would not say that a merge rule still applies.',
      'One round is enough for the two small tables, which need a single merge each. The 48-rule table needs many rounds, because every merge makes new pairs that other rules name. Looping until nothing changes fixes it.',
    ],
    explanation: 'The two small tables fit in one round. The trained 48-rule table does not, because merging makes new pairs that other rules name.',
  }),

  /* ---- Modify: one dial, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab03.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: [KC.bpeMerges],
    prompt: `The reference run makes ${tokensAt(REFERENCE_MERGES)} tokens with 48 merges. How many tokens does your changed run make?`,
    unit: 'tokens',
    factor: 1.3,
    explain:
      'Merges are ranked by how often their pair occurs in the corpus, so the first ones save the most tokens and each later one saves fewer. Doubling the merges does not halve the count, and the last merges, which fuse pairs seen once, barely change it.',
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, guess how far 48 merges shrink a sentence, and which check a wrong merge order breaks.' },
  { id: 'run', title: 'Run', blurb: 'Watch the merges apply to one sentence in your browser, from raw bytes to tokens.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Five questions about what the harness checks and why.' },
  { id: 'modify', title: 'Modify', blurb: 'Change how many merges the run uses, predict the token count, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the tokenizer in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { NumberPrimm }
