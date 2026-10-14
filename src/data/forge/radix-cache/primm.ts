/**
 * Lab 07 (radix-cache) in PRIMM stages (docs/specs/wave-3.md §8.2): Predict, Run, Investigate, Modify, Make.
 *
 * Three jobs live here, all pure (no DOM, no clock, no storage):
 *   1. the stage table of the Make step (`STAGES`, `stageRows`, `attemptsToGreen`);
 *   2. the in-browser reference run: the lab's own `probe` traffic (48 chat requests over four system prompts) through a
 *      radix tree with leaf LRU (src/lib/world/radix.ts), whose numbers are the harness's, line for line;
 *   3. the items: what the learner predicts, investigates and modifies (`PRIMM_ITEMS`). Each one is the ledger ref
 *      `item:lab07.primm.<id>`; grading and the ledger payload are the shared ones in src/lib/forge/primm.ts.
 *
 * The reference run is NOT a check. It is a labelled stand-in: the page's tree on a 48-request replay with the lab's
 * `probe` shape, never the 240-request replay of `chat_hit_rate`, so no check's number is on the page before the learner
 * builds the cache. Every number the items quote is a property of that run, and tests/forge/radix-cache.test.ts pins each.
 */

import { KC } from '@/data/kc/ids'
import type { ForgeLabCheck } from '@/data/labs'
import type { QuizQuestion } from '@/components/QuizBlock'
import type { ItemResponse } from '@/lib/ledger/types'
import { attemptsToGreen as attemptsToGreenOf, observationResponse, stageRows as stageRowsOf } from '@/lib/forge/primm'
import { BLOCK_SIZE, PRACTICE_SEED, REPLAY, replay, type Replay } from '@/lib/world/radix'
import type { AuthoredItem } from '@/lib/items/types'
import type { ChoicePrimm, NumberPrimm, PrimmItem, PrimmStep, PrimmStepId, ReferenceRunSpec, RunConfig, RunResult, StageInfo } from '../types'

// The shapes live in ../types (the Forge bundle contract), and what PRIMM does for every lab lives in
// src/lib/forge/primm.ts; both are re-exported here, as lab 02's module does.
export type { ChoicePrimm, NumberPrimm, PrimmItem, StageInfo }
export { currentStage, gradeChoice, gradeNumber, greenStage, itemRev, itemResponse, predictGraded, primmRef } from '@/lib/forge/primm'
export type { PrimmAnswer, PrimmGrade, StageRow } from '@/lib/forge/primm'

export const PRIMM_LAB = 'radix-cache'

/* ------------------------------------------------------------------ */
/* The Make step: four stages                                          */
/* ------------------------------------------------------------------ */

/**
 * The stage markers in `labs/radix-cache/src/cache.rs` (name, minutes). Which checks belong to which stage comes from
 * labs.ts: stage 3 holds two checks, `eviction_order` and `cow_divergence`, and stage 4 holds `block_conservation` and
 * `chat_hit_rate`.
 */
export const STAGES: readonly StageInfo[] = [
  { n: 1, title: 'Exact', minutes: 2, goal: 'Keep the entries, retain a prompt’s table once, and look it up whole. The first green.' },
  { n: 2, title: 'Longest', minutes: 10, goal: 'Follow the query to the deepest cached ancestor, not the first branch that shares a prefix.' },
  { n: 3, title: 'Leaves and sharing', minutes: 25, goal: 'Evict the coldest leaf at the entry limit, and share whole blocks while a divergent tail stays private.' },
  { n: 4, title: 'Churn', minutes: 20, goal: '2,000 operations and a drain conserve every block, and the chat replay reuses the shared system prompt.' },
]

/** The stages with their checks (labs.ts `stage`) and which of them passed: the shared `stageRows`, bound to lab 07's stages. */
export const stageRows = (checks: readonly ForgeLabCheck[], passed: ReadonlySet<string>) => stageRowsOf(STAGES, checks, passed)

/** Attempts-to-green per stage (spec §13.1, descriptive only), over lab 07's stages. */
export const attemptsToGreen = (runs: readonly (readonly string[])[], checks: readonly ForgeLabCheck[]): (number | null)[] =>
  attemptsToGreenOf(STAGES, runs, checks)

/* ------------------------------------------------------------------ */
/* The reference run: the lab's `probe` traffic through a radix tree    */
/* ------------------------------------------------------------------ */

/**
 * `report` says which number the run's `value` is: `rate`, the percentage of prompt tokens the cache served (the Predict
 * and Run steps), or `misses`, the requests whose lookup found nothing (the Modify step). The traffic is the same either way.
 */
export interface ReplayRunConfig {
  seed: number
  /** The entry limit. */
  entries: number
  /** Physical blocks in the pool. */
  blocks: number
  report: 'rate' | 'misses'
}

/** The reference run: 12 entries over 48 blocks, the seed the lab's calibration records, reporting the hit rate. */
export const REFERENCE: ReplayRunConfig = { seed: PRACTICE_SEED, entries: REPLAY.entries, blocks: REPLAY.blocks, report: 'rate' }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A share of prompt tokens as a percentage to one decimal. */
export const percent = (hits: number, prompts: number): number => (prompts === 0 ? 0 : Math.round((hits * 1000) / prompts) / 10)

/** Replays a config; the page's tree, the harness's traffic. */
export const runReplay = (config: ReplayRunConfig): Replay => replay({ seed: config.seed, entries: config.entries, blocks: config.blocks })

/** One sentence on a finished replay, for the strip's caption and the Modify reveal. */
export function describeRun(run: Replay): string {
  const { entries, blocks } = run.config
  const head = `${plural(entries, 'entry', 'entries')} over ${blocks} blocks`
  if (run.error !== null) return `${head}: the cache could not admit a request, so the run stops early.`
  const asks = REPLAY.requests
  const served = `${run.hitTokens.toLocaleString('en-US')} of ${run.promptTokens.toLocaleString('en-US')} prompt tokens came from the cache (${percent(run.hitTokens, run.promptTokens)}%)`
  const nothing = run.misses === 0 ? 'every request found a prefix' : `${plural(run.misses, 'request')} of ${asks} found nothing`
  return `${head}: ${served}, and ${nothing}. ${run.conserved ? 'Free plus allocated blocks equalled the pool throughout.' : 'Conservation broke.'}`
}

/** What the reference run ends with, quoted in the Modify question so the change is the learner's guess. */
const REFERENCE_RUN = runReplay(REFERENCE)
const REFERENCE_MISSES = REFERENCE_RUN.misses
/** The requests that can never hit: the first of each system prompt, when all four appear. */
const COLD_STARTS = REPLAY.families

/** What `ReferenceRun` shows for a config, in the bundle's lab-neutral shape (frames, stats, one-line summary). */
function runSpecResult(config: RunConfig): RunResult {
  const cfg = config as unknown as ReplayRunConfig
  const run = runReplay(cfg)
  const misses = cfg.report === 'misses'
  return {
    config,
    total: REPLAY.requests,
    value: misses ? run.misses : percent(run.hitTokens, run.promptTokens),
    // the most the value could be: every request finds nothing, or every token comes from the cache
    truth: misses ? REPLAY.requests : 100,
    clean: run.error === null && run.conserved,
    summary: describeRun(run),
    frames: run.steps.map((s) => {
      const one = s.owners.filter((o) => o === 1).length
      const shared = s.owners.filter((o) => o > 1).length
      return {
        op: s.request,
        cells: s.owners.map((o) => (o === 0 ? 0 : o === 1 ? 40 : 100)),
        stats: [
          { label: 'tokens reused', value: s.promptTokens === 0 ? '-' : `${percent(s.hitTokens, s.promptTokens)}%` },
          { label: 'entries', value: `${s.entries} of ${cfg.entries}` },
          { label: 'free blocks', value: String(s.freeBlocks) },
        ],
        alt:
          s.request === 0
            ? `The pool of ${cfg.blocks} blocks in id order, all free. The cache is empty.`
            : `The pool of ${cfg.blocks} blocks in id order after request ${s.request} of ${REPLAY.requests}. ${s.freeBlocks} free, ${one} held by one cached prompt, ${shared} shared by two or more. ${s.entries} cached prompts; ${percent(s.hitTokens, s.promptTokens)}% of the prompt tokens so far came from the cache.`,
      }
    }),
  }
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

type KcList = AuthoredItem['kcs']

const PREFIX_KEYS = 't5.prefix-cache-keys'
const RADIX_EVICTION = 't5.radix-eviction'

const choice = (
  id: string,
  step: ChoicePrimm['step'],
  kcs: KcList,
  q: Omit<QuizQuestion, 'kcs'>,
  nsec = 45,
): ChoicePrimm => ({ kind: 'choice', id, step, nsec, item: { id, kcs, q: { ...q, kcs: [...kcs] } } })

const PROMPT_TOKENS = REPLAY.systemTokens + REPLAY.turnTokens
const TOTAL_TOKENS = REPLAY.requests * PROMPT_TOKENS

export const PRIMM_ITEMS: readonly PrimmItem[] = [
  /* ---- Predict, before the learner downloads anything ---- */
  {
    kind: 'estimate',
    id: 'lab07.primm.p1',
    step: 'predict',
    nsec: 60,
    kcs: [PREFIX_KEYS, RADIX_EVICTION],
    prompt: `A chat service caches the K/V of finished prompts in blocks of ${BLOCK_SIZE} tokens, and keeps at most ${REPLAY.entries} prompts: when it is full, the least recently used leaf goes. It serves ${REPLAY.requests} requests. Each prompt is ${PROMPT_TOKENS} tokens: one of ${REPLAY.families} system prompts of ${REPLAY.systemTokens} tokens, drawn at random, then a ${REPLAY.turnTokens}-token user turn that no other request repeats. Before each request is prefilled, the cache is asked for the longest prefix it holds. What share of all ${TOTAL_TOKENS.toLocaleString('en-US')} prompt tokens does the cache serve, as a percentage?`,
    unit: '%',
    factor: 1.3,
    explain: `A request's turn is new, so at best ${REPLAY.systemTokens} of its ${PROMPT_TOKENS} tokens (66.7%) are reused. The first request of each of the ${REPLAY.families} system prompts finds nothing, which leaves ${REPLAY.requests - COLD_STARTS} requests that can hit: ${((REPLAY.requests - COLD_STARTS) * REPLAY.systemTokens).toLocaleString('en-US')} of ${TOTAL_TOKENS.toLocaleString('en-US')} tokens, 61.1%, and a cache with room for 24 prompts reaches exactly that. With ${REPLAY.entries} entries the least recently used leaf is sometimes the last cached prompt of a system prompt, so ${REFERENCE_MISSES - COLD_STARTS} later requests find theirs gone: ${REFERENCE_RUN.hitTokens / REPLAY.systemTokens} hits, ${REFERENCE_RUN.hitTokens.toLocaleString('en-US')} tokens, ${percent(REFERENCE_RUN.hitTokens, REFERENCE_RUN.promptTokens)}%.`,
  },
  choice('lab07.primm.p2', 'predict', [PREFIX_KEYS], {
    q: 'You write `match_prefix` so that it reports a hit only when a whole cached prompt is a prefix of the query, and returns 0 otherwise. The checks of stages 1 to 3 look up prompts they inserted, or longer ones that extend a prompt they inserted. The replay in `chat_hit_rate` sends 240 requests, each a 64-token system prompt that other requests share and then a 16-token turn nobody repeats. Exactly one of these four checks goes red. Which one?',
    options: [
      '`exact_match`, because the lookup of the very prompt it inserted no longer counts as a hit',
      '`longest_prefix`, because the query extends the cached document, and a lookup that only wants whole prompts cannot pick it out',
      '`cow_divergence`, because its two prompts share only a block and a tail, and a partial match no longer counts',
      '`chat_hit_rate`, because no cached prompt is a prefix of a new request, since requests part at the user turn',
    ],
    correct: [3],
    why: [
      'The prompt it looks up is a cached prompt, so the entry is a prefix of the query because it is the query. A whole-entry lookup hits, and this check stays green.',
      'The query is the 48-token document plus 11 new tokens. The document is a cached prompt and a prefix of the query, and the deepest one, so a whole-entry lookup finds it and this check stays green.',
      'This check looks up the two prompts it inserted, one at a time, and both are whole cached prompts. It never asks for a partial match, so it stays green.',
      'Every request is a system prompt followed by a turn that no earlier request had, so no cached prompt is a prefix of it and the lookup answers 0 each time. The check wants at least 65% of the tokens reused, and gets none.',
    ],
    explanation:
      'Stages 1 to 3 only ask for whole entries, so a lookup that insists on one passes them. The saving in chat traffic is in the partial prefix that requests share, and `chat_hit_rate` is where that is first asked for. `block_conservation` goes red too, in the same stage.',
  }),

  /* ---- Investigate: the harness ---- */
  {
    kind: 'numeric',
    id: 'lab07.primm.i1',
    step: 'investigate',
    nsec: 40,
    kcs: [PREFIX_KEYS],
    prompt:
      'One 40-token prompt, ids 100 to 139, is cached. A query has the same first 20 ids, then 7 ids the cache has never seen. `match_prefix` returns the longest token prefix the query shares with any cached prompt. What `len` does it return?',
    unit: 'tokens',
    truth: 20,
    lures: [
      { value: 16, miss: 'prefix.whole-blocks-only', message: '16 is 20 rounded down to a whole block. The length counts tokens, and the blocks that cover them are rounded up: the 20 shared tokens sit in two blocks.' },
      { value: 0, miss: 'prefix.whole-entry-only', message: '0 is what a lookup returns when it wants a whole cached prompt to be a prefix of the query. This query parts from the prompt halfway, and the 20 shared tokens are still reusable.' },
      { value: 40, miss: 'prefix.entry-length', message: '40 is the length of the cached prompt. The query does not contain all of it: its 21st token differs, so only 20 tokens match.' },
      { value: 27, miss: 'prefix.query-length', message: '27 is the length of the query. Its last 7 ids are new, so they match nothing in the cache.' },
    ],
    explain: 'Token by token, the query agrees with the cached prompt for 20 ids and then parts. The match is 20 tokens, covered by the first two blocks (20 over 16, rounded up).',
  },
  choice('lab07.primm.i2', 'investigate', [KC.blockRefcounts], {
    q: `Two prompts of ${PROMPT_TOKENS} tokens share their first ${REPLAY.systemTokens} (a system prompt) and differ in the last ${REPLAY.turnTokens}. Blocks hold ${BLOCK_SIZE} tokens. Each is prefilled into ${PROMPT_TOKENS / BLOCK_SIZE} fresh blocks and inserted, and the harness then releases its temporary table. With both prompts cached, how many physical blocks are allocated?`,
    options: [
      '6 blocks, because each cached prompt keeps the three blocks that its own prefill filled',
      '4 blocks, because the two system-prompt blocks are shared and each prompt adds one',
      '5 blocks, because the first of the two system-prompt blocks is shared, and the second block of each prompt stays private',
      '3 blocks, because the second prompt is a copy of the first and shares its three blocks',
    ],
    correct: [1],
    why: [
      'That is what a cache that never reuses a canonical block holds: two private tables, six blocks. The shared 32 tokens are two whole blocks that both prompts can read, so this is more than needed (and `cow_divergence` catches it).',
      'The first 32 tokens fill two whole blocks that both prompts agree on, so the second prompt reuses the cached ones and its fresh copies return to the pool. The last 16 tokens differ, so each prompt keeps its own third block: 2 + 1 + 1 = 4, with the shared two at two owners each.',
      'The second block is a whole block of 16 tokens that both prompts agree on, so it is shared too. Only a partial tail is kept private, and neither prompt has one here.',
      'The last 16 tokens differ between the prompts, so their third blocks hold different K/V and cannot be one block. Sharing it would let one prompt read the other\'s tokens.',
    ],
    explanation: 'A whole block that two prompts agree on is stored once and held by both entries. A block whose tokens differ is private. Here that is two shared blocks and one private block each.',
  }),
  choice('lab07.primm.i3', 'investigate', [RADIX_EVICTION], {
    q: 'The cache holds at most 3 prompts. X (32 tokens) is inserted first, then Y (X plus 16 more tokens), then Z (16 unrelated tokens). A lookup of Z follows. Then W (16 more unrelated tokens) is inserted into the full cache. Which prompt does the cache evict to make room?',
    options: [
      'X, because it is the prompt that was used longest ago, so it is the coldest',
      'Z, because it is the prompt that was inserted most recently',
      'Y, because it is the coldest of the prompts that no other prompt extends',
      'None of them, because a full cache refuses W and stays as it was',
    ],
    correct: [2],
    why: [
      'X is the oldest, but Y extends it, so X is an interior prompt whose blocks Y still needs. Only a leaf, a prompt that no other cached prompt extends, can be evicted, and X is not one.',
      'Z was looked up just before W arrived, so it is the hottest prompt, not the coldest. Being inserted late does not matter once a lookup has refreshed it.',
      'The leaves are Y and Z. Z was just looked up, so Y was used longest ago and goes. X becomes a leaf once Y is gone, and keeps its entry.',
      'A full cache makes room for a new prompt by evicting a leaf first. It refuses only when there is no leaf it may evict, which is not the case here.',
    ],
    explanation: 'Eviction takes the coldest leaf, never an interior prompt: X is older than Y, but Y depends on X, so Y goes first.',
  }),

  /* ---- Modify: one dial, predict, run ---- */
  {
    kind: 'estimate',
    id: 'lab07.primm.m1',
    step: 'modify',
    nsec: 60,
    kcs: [RADIX_EVICTION, PREFIX_KEYS],
    prompt: `You changed the entry limit of the reference run, which was ${REPLAY.entries}; the ${REPLAY.requests} requests are the same. In the reference run ${REFERENCE_MISSES} requests find nothing in the cache: ${COLD_STARTS} are the first of a system prompt, and ${REFERENCE_MISSES - COLD_STARTS} arrive after their system prompt's last cached prompt was evicted. How many requests find nothing in your changed run?`,
    unit: 'requests',
    factor: 1.4,
    explain: `A request finds nothing when no cached prompt shares its system prompt. The ${COLD_STARTS} first requests miss at any size. The rest depend on how long a system prompt's last cached prompt survives, and the least recently used leaf goes first: with 6 entries, ${runReplay({ ...REFERENCE, entries: 6, report: 'misses' }).misses} requests find nothing, with 3 entries ${runReplay({ ...REFERENCE, entries: 3, report: 'misses' }).misses}, and with room for 24 prompts only the ${runReplay({ ...REFERENCE, entries: 24, report: 'misses' }).misses} cold starts.`,
  },
]

/** The multiple-choice items, as verify-items judges them (blind-strategy gates, every option with a why). */
export const PRIMM_MC_ITEMS: readonly AuthoredItem[] = PRIMM_ITEMS.flatMap((i) => (i.kind === 'choice' ? [i.item] : []))

export const itemById = (id: string): PrimmItem | undefined => PRIMM_ITEMS.find((i) => i.id === id)

/** Steps the panel walks through, in order. `run` has no item of its own: its evidence is `RUN_ITEM`. */
export const PRIMM_STEPS = [
  { id: 'predict', title: 'Predict', blurb: 'Before you download anything, guess how much of a chat replay a prefix cache serves, and which check a lookup that wants whole prompts breaks.' },
  { id: 'run', title: 'Run', blurb: 'Watch a radix cache serve 48 chat requests in your browser, block by block.' },
  { id: 'investigate', title: 'Investigate', blurb: 'Three questions about how a lookup matches, how blocks are shared and which prompt is evicted.' },
  { id: 'modify', title: 'Modify', blurb: 'Change the entry limit, predict how many requests find nothing, then run it.' },
  { id: 'make', title: 'Make', blurb: 'Build the cache in four stages. Each is green on this page before the next.' },
] as const satisfies readonly PrimmStep[]

export type { PrimmStepId }

/**
 * The Run step's own item: the reference run's observed hit rate. Watching a strip is not an answer, so it carries
 * no KCs; only the time and the observed value are evidence.
 */
export const RUN_ITEM = { id: 'lab07.primm.r1', nsec: 45 }

/** The Run step's evidence: the share of prompt tokens the reference run served from the cache. An observation, not a graded answer: no KCs. */
export const runResponse = (run: Replay, ms?: number): ItemResponse =>
  observationResponse(RUN_ITEM, { config: { ...run.config, report: 'rate' } as unknown as RunConfig, value: percent(run.hitTokens, run.promptTokens), truth: 100 }, ms)

/** Lab 07's Run and Modify steps as data: the bundle's `primm.run`. */
export const RUN_SPEC: ReferenceRunSpec = {
  item: RUN_ITEM,
  title: (config) => `Reference: a radix cache of ${config.entries} entries over ${config.blocks} blocks`,
  disclaimer:
    'Each cell is one block of the pool: faint is free, half-bright is held by one cached prompt, bright is shared by two or more. This is a radix tree with leaf LRU on the lab’s `probe` traffic, a 48-request replay, not the 240-request replay of a check.',
  reference: { ...REFERENCE },
  run: runSpecResult,
  modify: {
    lead: `Change one thing about the reference run (${REPLAY.entries} entries over ${REPLAY.blocks} blocks).`,
    dials: [
      { id: 'entries6', label: `entry limit ${REPLAY.entries} becomes ${REPLAY.entries / 2} (halved)`, config: { ...REFERENCE, entries: REPLAY.entries / 2, report: 'misses' } },
      { id: 'entries3', label: `entry limit ${REPLAY.entries} becomes 3`, config: { ...REFERENCE, entries: 3, report: 'misses' } },
      { id: 'entries24', label: `entry limit ${REPLAY.entries} becomes ${REPLAY.entries * 2} (doubled)`, config: { ...REFERENCE, entries: REPLAY.entries * 2, report: 'misses' } },
    ],
  },
}
