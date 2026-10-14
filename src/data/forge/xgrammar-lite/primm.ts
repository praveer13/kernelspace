/**
 * Lab 08 (xgrammar-lite) in PRIMM stages (docs/specs/wave-3.md §8.2): Predict, Run, Investigate, Modify, Make.
 *
 * Pure data and pure functions (no DOM, no clock, no storage), in the shape of the Forge bundle contract:
 *   1. the stage table of the Make step (`STAGES`), the same four stages as `grammar.rs` and labs.ts;
 *   2. the reference run (`RUN_SPEC`): the crate's own `probe <seed>`, replayed one frame per grammar step. The
 *      committed seed-7 reply (labs/xgrammar-lite/calibration.json) is the reference; the page recomputes it from the
 *      harness's random stream (`HarnessRng`, the Rust `Rng`) and from the language the schema allows, and
 *      tests/forge/xgrammar-lite.test.ts holds the recomputation to the committed reply and to replies of the private
 *      reference solution on other seeds;
 *   3. the items: what the learner predicts, investigates and modifies (`PRIMM_ITEMS`). Each one is the ledger ref
 *      `item:lab08.primm.<id>`.
 *
 * The reference run is NOT a check. It is a labelled stand-in: the tool-call schema of `probe`, a mask that is exact
 * (every byte of a token is tried, as the stage-3 `token_mask` does) and one dice roll among the legal tokens per step.
 * It runs no learner code and shows no check's expected value.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { AuthoredItem } from '@/lib/items/types'
import { HarnessRng } from '@/lib/world/bpe'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, ReferenceRunSpec, RunConfig, RunFrame, RunResult, RunDial, StageInfo } from '../types'

export const PRIMM_LAB = 'xgrammar-lite'

/** `t6.grammar-masks`: the one KC every check of lab 08 carries (labs.ts). */
export const GRAMMAR_MASKS = 't6.grammar-masks'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/** The stage markers in `labs/xgrammar-lite/src/grammar.rs`. Which checks belong to which stage comes from labs.ts. */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'Compile', minutes: 2, goal: 'Lower the schema into states and count them. The two-minute win.' },
  { n: 2, title: 'Match', minutes: 25, goal: 'Feed bytes through a stack of frames: accept valid JSON in pieces, reject at the first bad byte and stay rejected.' },
  { n: 3, title: 'Mask', minutes: 10, goal: 'Try every byte of each vocabulary token on a clone of the matcher; allow it if the clone survives.' },
  { n: 4, title: 'Speed and cache', minutes: 15, goal: 'Clone only the small stack, and key a cache on the parsed schema so equal schemas compile once.' },
]

/* ------------------------------------------------------------------ */
/* The probe, recomputed                                               */
/* ------------------------------------------------------------------ */

/** The seed of the committed probe reply (calibration.json `probe.seed`) and of the reference run. */
export const PROBE_SEED = 7

/** `probe` decodes for at most this many steps (lib.rs). */
export const MAX_STEPS = 40

/** The 29 characters `probe` puts first in its vocabulary. */
const PROBE_CHARS = '{}":,0123456789tolanswerkindc'

/** Every character a document of the tool schema uses: `PROBE_CHARS` and the `u` of "count". */
const DOC_CHARS = `${PROBE_CHARS}u`

/** The 64 tokens of the probe: its characters, then fragments of documents until there are this many. */
export const PROBE_VOCAB = 64

/** The language of the tool schema (`kind` is "tool" or "answer", `count` an integer 0 to 99), written without whitespace: 200 documents, in lib.rs's order. */
export const TOOL_DOCS: readonly string[] = ['tool', 'answer'].flatMap((kind) =>
  Array.from({ length: 100 }, (_, n) => `{"kind":"${kind}","count":${n}}`),
)

/** Whether `text` begins some document of the language, which is what a matcher answers "not rejected" to. */
const viable = (text: string): boolean => TOOL_DOCS.some((d) => d.startsWith(text))

/** What the probe's mask is built from. */
export interface ProbeOptions {
  /** `whole`: every byte of a token (the stage-3 mask). `first-byte`: only its first byte (calibration's first_byte_mask). */
  mask: 'whole' | 'first-byte'
  /** `mixed`: the probe's 64 tokens. `chars`: one token per character of the documents (30). */
  vocab: 'mixed' | 'chars'
}

export const WHOLE_MIXED: ProbeOptions = { mask: 'whole', vocab: 'mixed' }

/** One step of a probe run. */
export interface ProbeStep {
  /** The vocabulary indices the mask allowed, ascending. */
  legal: number[]
  /** Of those, the ones whose whole token does not keep the document viable (only a first-byte mask allows these). */
  wrong: number[]
  /** The index picked, or -1 when the mask allowed nothing. */
  pick: number
  /** The text before this step. */
  before: string
}

export type ProbeEnd = 'complete' | 'rejected' | 'empty' | 'limit'

export interface Probe {
  seed: number
  options: ProbeOptions
  vocab: string[]
  steps: ProbeStep[]
  /** The text written, including a rejected pick. */
  text: string
  end: ProbeEnd
}

/** The probe's vocabulary: the characters, then (for `mixed`) fragments of random documents, 2 to 10 bytes, drawn from `rng`. */
function vocabulary(rng: HarnessRng, kind: ProbeOptions['vocab']): string[] {
  if (kind === 'chars') return [...DOC_CHARS]
  const vocab = [...PROBE_CHARS]
  while (vocab.length < PROBE_VOCAB) {
    const d = TOOL_DOCS[rng.below(TOOL_DOCS.length)]
    const at = rng.below(d.length)
    vocab.push(d.slice(at, at + rng.range(2, 10)))
  }
  return vocab
}

/**
 * The mask after `consumed`: a token is allowed when the document is still viable after it (`whole`: every byte, the
 * stage-3 `token_mask`) or after its first byte (`first-byte`, calibration's first_byte_mask).
 */
export function maskOf(consumed: string, vocab: readonly string[], how: ProbeOptions['mask'] = 'whole'): boolean[] {
  return vocab.map((token) => viable(consumed + (how === 'whole' ? token : token.slice(0, 1))))
}

/**
 * lib.rs's `probe(seed)`, over the language of the schema instead of a matcher: at each step the mask allows the
 * tokens that keep the document viable, a seeded pick among them is appended, until the document is complete.
 * Without whitespace in any token, a correct matcher and "begins one of the 200 documents" give the same mask (the
 * harness's `token_mask` check compares them on 24 tokens per round).
 */
export function probe(seed: number, options: ProbeOptions = WHOLE_MIXED): Probe {
  const rng = new HarnessRng(seed)
  const vocab = vocabulary(rng, options.vocab)
  const steps: ProbeStep[] = []
  let text = ''
  let end: ProbeEnd = 'limit'
  for (let n = 0; n < MAX_STEPS; n++) {
    const whole = maskOf(text, vocab, 'whole')
    const allowed = options.mask === 'whole' ? whole : maskOf(text, vocab, 'first-byte')
    const legal = vocab.flatMap((_, i) => (allowed[i] ? [i] : []))
    const wrong = legal.filter((i) => !whole[i])
    if (legal.length === 0) {
      steps.push({ legal, wrong, pick: -1, before: text })
      end = 'empty'
      break
    }
    const pick = legal[rng.below(legal.length)]
    steps.push({ legal, wrong, pick, before: text })
    text += vocab[pick]
    if (!viable(text)) {
      end = 'rejected'
      break
    }
    if (TOOL_DOCS.includes(text)) {
      end = 'complete'
      break
    }
  }
  return { seed, options, vocab, steps, text, end }
}

/** Rust's `{:?}` of a string made of printable ASCII, which is all a document holds: quotes and backslashes escaped. */
const debug = (s: string): string => `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

/** The one-line reply of the crate's `probe`, as `ks_invoke` returns it (lib.rs). */
export function replyOf(p: Probe): string {
  const last = p.steps[p.steps.length - 1]
  if (p.end === 'empty') return `err no legal token after ${debug(p.text)}`
  if (p.end === 'rejected') return `err the mask allowed ${debug(p.vocab[last.pick])} but accept_token rejected it`
  return `steps=${p.steps.length} complete=${p.end === 'complete'} legal_per_step=${p.steps.map((s) => s.legal.length).join(',')} text=${debug(p.text)}`
}

/* ------------------------------------------------------------------ */
/* The reference run: one frame per grammar step                        */
/* ------------------------------------------------------------------ */

const asMask = (v: unknown): ProbeOptions['mask'] => (v === 'first-byte' ? 'first-byte' : 'whole')
const asVocab = (v: unknown): ProbeOptions['vocab'] => (v === 'chars' ? 'chars' : 'mixed')
const asSeed = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 0 ? n >>> 0 : PROBE_SEED
}

/** The config of a run: the seed, and the two things the Modify step can change. */
export const configOf = (seed: number, options: ProbeOptions = WHOLE_MIXED): RunConfig => ({ seed, mask: options.mask, vocab: options.vocab })

/** The Run step's reference: the committed seed-7 reply. */
export const REFERENCE: RunConfig = configOf(PROBE_SEED)

const probeOf = (config: RunConfig): Probe => probe(asSeed(config.seed), { mask: asMask(config.mask), vocab: asVocab(config.vocab) })

/** A token as the page shows it: its index and its text. */
const named = (p: Probe, i: number) => `#${i} ${p.vocab[i]}`

/** The last `n` characters, with an ellipsis when something was cut. */
const tail = (s: string, n = 12) => (s.length <= n ? s : `…${s.slice(s.length - n + 1)}`)

/** Up to `max` names, then how many more: what a screen reader hears for the legal set. */
function listed(p: Probe, indices: readonly number[], max = 8): string {
  const shown = indices.slice(0, max).map((i) => named(p, i))
  return indices.length > max ? `${shown.join(', ')} and ${indices.length - max} more` : shown.join(', ')
}

const STATUS = { complete: 'Complete', rejected: 'Rejected', empty: 'no legal token', limit: 'Prefix' } as const

/** The first byte of `text` after which no document can continue: the offset `Rejected { byte }` would carry. */
function badByte(text: string): number {
  for (let k = 1; k <= text.length; k++) if (!viable(text.slice(0, k))) return k - 1
  return text.length
}

function frameOf(p: Probe, n: number): RunFrame {
  const step = p.steps[n]
  const last = n === p.steps.length - 1
  const status = last ? STATUS[p.end] : 'Prefix'
  const wrong = new Set(step.wrong)
  const legal = new Set(step.legal)
  const text = step.pick < 0 ? step.before : step.before + p.vocab[step.pick]
  const stats = [
    { label: 'legal tokens', value: `${step.legal.length} of ${p.vocab.length}` },
    { label: 'picked', value: step.pick < 0 ? 'none' : named(p, step.pick) },
    { label: 'text so far', value: text === '' ? '(nothing)' : tail(text) },
    { label: 'status', value: status },
  ]
  if (p.options.mask === 'first-byte') stats.push({ label: 'wrongly allowed', value: String(step.wrong.length) })
  const names = step.legal.length === 0 ? 'nothing' : listed(p, step.legal)
  const picked = step.pick < 0 ? 'No token can be picked.' : `Picked ${named(p, step.pick)}; the status is ${status}.`
  return {
    op: n + 1,
    // picked 100, wrongly allowed 20, legal 55, not allowed 0 (drawn at the strip's 10% floor)
    cells: p.vocab.map((_, i) => (i === step.pick ? 100 : wrong.has(i) ? 20 : legal.has(i) ? 55 : 0)),
    stats,
    alt: `Step ${n + 1} of ${p.steps.length}, one cell per vocabulary token (${p.vocab.length}), darker for an allowed one. After ${step.before === '' ? 'nothing' : step.before} the mask allows ${step.legal.length}: ${names}. ${picked}`,
  }
}

const list = (nums: readonly number[]) => nums.join(', ')

/** What `ReferenceRun` shows for a config, in the bundle's lab-neutral shape. */
function runResult(config: RunConfig): RunResult {
  const p = probeOf(config)
  const n = p.steps.length
  const frames = p.steps.map((_, i) => frameOf(p, i))
  const legal = list(p.steps.map((s) => s.legal.length))
  let summary: string
  if (p.end === 'complete') {
    summary = `Seed ${p.seed} reaches Complete in ${n} steps. The mask allowed ${legal} tokens at the steps, and the text is ${p.text}.`
  } else if (p.end === 'rejected') {
    const last = p.steps[n - 1]
    summary = `Step ${n}: the mask allowed ${named(p, last.pick)} (it looks at the first byte only), but the matcher rejects ${p.text} at byte ${badByte(p.text)}. A mask that cannot see the rest of a token lets this through.`
  } else if (p.end === 'empty') {
    summary = `Step ${n}: after ${p.text} no token in the vocabulary is legal. The mask is empty, so the sampler has nothing to choose.`
  } else {
    summary = `The probe stopped after ${MAX_STEPS} steps without Complete.`
  }
  return {
    config,
    total: n,
    value: n,
    truth: MAX_STEPS,
    clean: p.end === 'complete',
    frames,
    summary,
  }
}

/** The Run step's own item: the reference run's observed step count. An observation, not an answer: no KCs. */
export const RUN_ITEM = { id: 'lab08.primm.r1', nsec: 45 }

const DIALS: readonly RunDial[] = [
  {
    id: 'first-byte',
    label: 'the mask looks at the first byte of each token only',
    config: configOf(PROBE_SEED, { mask: 'first-byte', vocab: 'mixed' }),
  },
  {
    id: 'chars',
    label: 'the vocabulary is the 30 single characters, with no fragments',
    config: configOf(PROBE_SEED, { mask: 'whole', vocab: 'chars' }),
  },
]

/** Lab 08's Run and Modify steps as data: the bundle's `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) => `Reference: the probe on seed ${asSeed(config.seed)}, one frame per grammar step`,
  disclaimer:
    'This replays the crate’s probe on seed 7, the reply committed in calibration.json: the tool-call schema, a 64-token vocabulary and one dice roll among the legal tokens per step. It is not a check, and it does not run your module.',
  reference: REFERENCE,
  run: runResult,
  modify: {
    lead: `Change one thing about the reference run (the exact mask over 64 tokens, ${probe(PROBE_SEED).steps.length} steps).`,
    dials: [...DIALS],
  },
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

type KcList = AuthoredItem['kcs']
const KCS: KcList = [GRAMMAR_MASKS]

const choice = (id: string, step: ChoicePrimm['step'], q: Omit<QuizQuestion, 'kcs'>, nsec = 50): ChoicePrimm => ({
  kind: 'choice',
  id,
  step,
  nsec,
  item: { id, kcs: KCS, q: { ...q, kcs: [...KCS] } },
})

const REFERENCE_STEPS = probe(PROBE_SEED).steps.length

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab08.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: KCS,
    prompt:
      'The lab’s probe decodes one tool call through your mask. The schema is an object with `kind` (`"tool"` or `"answer"`) and `count` (an integer from 0 to 99), so a document without whitespace is 25 to 28 bytes. The vocabulary has 64 tokens: 29 single characters and 35 fragments of valid documents, each up to 10 bytes. At every step the mask lists the legal tokens, a seeded dice roll picks one of them, and the probe stops when the matcher says Complete. On seed 7, how many steps does the decode take?',
    unit: 'steps',
    factor: 1.6,
    explain: `The dice pick uniformly among the legal tokens, so a long fragment such as \`{"kind":"\` can finish a stretch in one step while a single character takes one step per byte. On seed 7 the 28-byte document takes ${REFERENCE_STEPS} steps, about 2.5 bytes a step. Across seeds 0 to 63 the 61 runs that finish take 6 to 17 steps.`,
  },
  choice('lab08.primm.p2', 'predict', {
    q: 'The matcher has consumed `{"kind":`. The vocabulary holds the four tokens below, and the schema is `kind` in `tool` or `answer`, then `count` from 0 to 99. Which one does a correct mask allow?',
    options: [
      '`"tool","count":100}`, a count over the maximum',
      '`"tool","count":07}`, a count with a leading zero',
      '`"answer","count":7}`, a whole valid ending',
      '`"tool",count:7}`, a key without quotes',
    ],
    correct: [2],
    why: [
      'It starts well and ends badly. The key, the comma and the digits 1 and 0 are all legal, since 10 is a count. The third digit makes 100, which is over 99, so the token fails at its last digit.',
      'A zero is a whole number here, so after 0 only the closing brace can follow. The 7 after it is rejected, because JSON writes 7 and never 07.',
      'Every byte fits. The enum value `"answer"` is complete, the comma and the quoted key `"count"` follow, 7 is in range, and the brace closes the object. It crosses five states in one token and is legal.',
      'After the comma the object needs a quoted key, so the `c` is rejected on the spot, the byte right after the comma. The rest of the token never matters.',
    ],
    explanation:
      'A mask has to follow every byte of a token. Three of these tokens look plausible at their first byte and break later, at a different byte each: the last digit, the digit after the zero, and the `c` of the key.',
  }),

  /* ---- Investigate: the checks ---- */
  choice('lab08.primm.i1', 'investigate', {
    q: 'The schema gives `id` as an integer from 0 to 100, and a model writes `{"id":101,"tag":"alpha","ok":true}`. The prefix `{"id":` is six bytes, so the digits of 101 sit at offsets 6, 7 and 8, counted from the start of the document. Where must a correct matcher report `Rejected { byte }`?',
    options: [
      'At offset 6, since the 1 that starts the number is out of range',
      'At offset 7, since the 0 makes 10, which is no longer a value',
      'At offset 9, the comma, since the number is only checked once it ends',
      'At offset 8, the last digit, since no value up to 100 begins with 101',
    ],
    correct: [3],
    why: [
      'A 1 can begin 1, 10 to 19 and 100, all in range, so the matcher must still accept it. Rejecting here would refuse documents that are valid.',
      '10 is itself a value, and 100 begins with it, so the matcher must still accept the 0. The digits so far are still on the way to a value.',
      'By the comma the damage is done: once the second digit is read, the third rules out every value. A matcher that waits for the number to end reports the error three bytes late, and `earliest_rejection` fails it.',
      'The digits 1 and 10 can still grow into a value up to 100, but 101 cannot become anything in range, so the third digit is the first byte no valid document allows. The offset is counted from the start of the document.',
    ],
    explanation:
      'A matcher rejects the moment no valid continuation exists, not when the number or the token ends. A bound of 100 is checked on every digit by asking whether the digits so far can still reach a value in range.',
  }),
  choice('lab08.primm.i2', 'investigate', {
    q: 'After `{"kind":` the harness offers six tokens: `"tool"`, `"answer","count":`, `null`, `"tool","count":7}`, `"tool"}garbage` and `"to`. A mask that tests only the first byte of each token gets exactly one of them wrong. Which?',
    options: [
      '`"tool"`, which it blocks because the first byte of the token is not the whole value',
      '`null`, which it lets through because the first byte of the token is a legal letter',
      '`"tool"}garbage`, which it lets through because the token starts with a legal quote',
      '`"to`, which it blocks because the token ends before the string does',
    ],
    correct: [2],
    why: [
      'A first-byte mask looks at one byte, the quote, and the quote is legal here, so it allows `"tool"`. The mask is right about it, and it never blocks a token that is valid.',
      'A string value must start with a quote, so n is not a legal first byte and `null` is blocked. A first-byte mask handles this one correctly.',
      'The quote is legal, so the mask allows it, but after `"tool"` the object needs a comma, not a brace. The token starts well and ends in garbage, and only a mask that follows every byte can see that.',
      'The quote is legal, so the mask allows it, and that is right: `"to` is a prefix of `"tool"`, so the document is still viable when the token ends.',
    ],
    explanation:
      'A first-byte mask can only admit too much: any token with a legal first byte gets through. Here that is the one token that goes wrong later. This is the mistake the `token_mask` check is built to catch.',
  }),
  choice('lab08.primm.i3', 'investigate', {
    q: 'The first pair in `compile_cache` is the same tool schema twice, the second time with its keywords and its enum values in another order. Your `GrammarCache` is keyed by the source string. Which line does the check print?',
    options: [
      '`entries=1 compiles=1 hits=1 same_rc=true`, the second source being a hit',
      '`entries=2 compiles=2 hits=0 same_rc=false`, a new key for the second source',
      '`entries=1 compiles=1 hits=0 same_rc=true`, a hit that nobody counted',
      '`entries=1 compiles=2 hits=0 same_rc=false`, a cache that never serves a hit',
    ],
    correct: [1],
    why: [
      'That is the state of a correct cache, and the check would pass. A cache keyed by the source string sees two different texts, so the second call is a miss.',
      'The two sources are different strings, so each gets its own entry, each compiles, and nothing is a hit. The two Rc values are different too. Parsing first, and keying on the parsed `Schema`, is what makes them one entry.',
      'This cache would have to find the second source in its map, which it cannot do: the text differs. A cache that finds the entry but forgets `hits += 1` prints this line, which is a different mistake.',
      'One entry and two compilations is the line of a cache that does store its result but never looks it up before compiling. A source-keyed cache does look up, and it stores a second entry.',
    ],
    explanation:
      'The harness parser already puts keyword order, whitespace and enum order into one normal form, so two sources with one meaning give equal `Schema` values. Keying the map by the parsed `Schema` turns the second call into a hit.',
  }),

  /* ---- Modify: one dial, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab08.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: KCS,
    prompt: `The reference run ends on step ${REFERENCE_STEPS}, at Complete. On which step does your changed run end? A run that fails ends on the step where it fails.`,
    unit: 'steps',
    factor: 1.6,
    explain:
      'A decode run ends in one of three ways: Complete; a pick the matcher rejects, because the mask let through a token it should have blocked; or an empty mask. The line above says which one your change reached. Longer tokens finish the document in fewer steps, so fewer mask computations.',
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, guess how long a decode takes and which token a correct mask lets through.' },
  { id: 'run', title: 'Run', blurb: 'Watch the reference decode one tool call in your browser, one frame per step, with the legal tokens at each.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Three questions about what the checks look for and why.' },
  { id: 'modify', title: 'Modify', blurb: 'Break the mask or shrink the vocabulary, predict the step the run ends on, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the matcher in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { NumberPrimm }
