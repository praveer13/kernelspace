/**
 * Prove-it v2 for lab 07 (docs/specs/wave-3.md §7.2): two seeded traces over the router bridge's verbs (reset, insert,
 * match), and what the learner predicts their own cache replies. Grading, provenance and retries are lab-neutral
 * (src/lib/forge/prove2.ts); this module is the lab's templates.
 *
 * The template rule (3a-22's Opus check, applied to this lab):
 *   1. Answerable from your own code. The required checks pin a correct cache's lookups exactly (the longest cached
 *      ancestor, shared system prompts that part into branches), so an eligible module can only be correct and each
 *      template is a tracing question about a correct module: walk your code through the calls.
 *   2. Never from the story alone. The answer is a sum of run lengths that differs across seeds and across the branch the
 *      query leaves by, and a plausible bug (`bug`) changes it, so the question exercises the code a mistake lives in.
 *   3. At most 12 calls (these use 5 and 4), every mutating call told in words in `story`; the measuring call is what
 *      `ask` names.
 * tests/forge/radix-cache.test.ts proves 2 on both templates with a fake correct cache and fakes with the named bugs.
 *
 * There is no `match-cold` template: a query that shares no first token with any cached prompt replies 0 from every
 * module, so the story alone would answer it. Eviction cannot be reached in 12 calls (the bridge's cache holds 256 entries).
 *
 * Every shared prefix is a whole number of blocks (16, 32 or 48 tokens), and every query leaves the cached paths where
 * a prompt ends or where two prompts part, with ids nothing has used. So a module that matches token for token, one that
 * matches at the points where paths part or end, and one that matches whole blocks agree on every question: the answer is
 * the length of the cached path the query follows, whichever way the module walks it.
 */

import { splitmix32u } from '@/lib/rng'
import type { ProveV2Spec, ProveV2Template } from '../types'

/** Tokens per block in the bridge's pool. */
export const BLOCK = 16
const START = `Reset the cache. Its blocks hold ${BLOCK} tokens each.`

/** `len` consecutive ids from `start`: how the lab's own checks build their prompts. */
interface Run {
  start: number
  len: number
}

const idsOf = (runs: readonly Run[]): number[] => runs.flatMap((r) => Array.from({ length: r.len }, (_, i) => r.start + i))
const said = (runs: readonly Run[]): string =>
  runs.map((r) => (r.len === 1 ? `id ${r.start}` : `ids ${r.start} to ${r.start + r.len - 1}`)).join(', then ')

/** A seeded draw of integers in [lo, hi]. */
function draws(seed: number): (lo: number, hi: number) => number {
  const next = splitmix32u(seed)
  return (lo, hi) => lo + (next() % (hi - lo + 1))
}

/** The five bands of ids, so no two kinds of run share an id: a system prompt, a first branch, a second branch, a tail nothing cached, another family. */
const BAND = { system: 0, first: 10_000, second: 20_000, fresh: 30_000, other: 40_000 } as const

/** The calls and the story for inserting `prompts` in order and then matching `query`. */
function trace(prompts: readonly (readonly Run[])[], query: readonly Run[]): { calls: string[]; story: string[]; ask: string } {
  const calls = ['reset', ...prompts.map((p) => `insert ${idsOf(p).join(',')}`), `match ${idsOf(query).join(',')}`]
  const story = [START, ...prompts.map((p) => `Insert a prompt: ${said(p)}.`)]
  const ask = `The cache is then asked for the longest prefix it holds of this prompt: ${said(query)}. How many tokens does \`match\` reply?`
  return { calls, story, ask }
}

/** The module's reply to the last call: a count of tokens. Every earlier call must have been answered `ok`. */
function readMatch(replies: string[]): number {
  if (replies.length < 3) throw new Error(`expected replies to reset, insert and match, got ${replies.length}`)
  const done = replies.slice(0, -1)
  const bad = done.findIndex((r, i) => (i === 0 ? r.trim() !== 'ok' : !/^ok \d+$/.test(r.trim())))
  if (bad >= 0) throw new Error(`call ${bad + 1} replied '${done[bad].trim().slice(0, 40)}', not ok`)
  const last = (replies[replies.length - 1] ?? '').trim()
  if (!/^\d+$/.test(last)) throw new Error(`\`match\` replied '${last.slice(0, 40)}', not a number`)
  return Number(last)
}

/** The system prompt every shape starts from: 16, 32 or 48 tokens, a whole number of blocks. */
function systemRun(d: (lo: number, hi: number) => number): Run {
  return { start: BAND.system + d(1, 9) * 100, len: BLOCK * d(1, 3) }
}

/**
 * `match-len`: three prompts are inserted, then one is matched. Three shapes of three prompts, drawn by seed, share a
 * system prompt S and branch from it: S, S + document and S + tools; two documents of which one extends the other; or
 * two branches and a prompt of another family. The query follows one cached path to a point where a prompt ends or two
 * parted, then runs on with ids nothing has used, so the answer is the length of that path. The prompts go in in a
 * seeded order, so the first prompt that shares a prefix with the query is often not the deepest.
 */
export const MATCH_LEN: ProveV2Template = {
  id: 'match-len',
  kcs: ['t5.prefix-cache-keys'],
  bug: 'returning the first cached prompt that shares any prefix with the query, instead of the deepest one',
  make(seed) {
    const d = draws(seed)
    const s = systemRun(d)
    const a = d(6, 40)
    const b = d(6, 40)
    const e = d(4, 24)
    const w = d(3, 12)
    const sys: Run[] = [s]
    const doc: Run[] = [s, { start: BAND.first + d(1, 9) * 100, len: a }]
    const tools: Run[] = [s, { start: BAND.second + d(1, 9) * 100, len: b }]
    const shape = d(0, 2)
    // each shape: the prompts it inserts, and the paths a query may follow (each ends at a point where a prompt ends or two part)
    let prompts: Run[][]
    let paths: Run[][]
    if (shape === 0) {
      prompts = [sys, doc, tools]
      paths = [sys, doc, tools]
    } else if (shape === 1) {
      const ext: Run[] = [...doc, { start: BAND.second + 5_000 + d(1, 9) * 100, len: e }]
      prompts = [doc, ext, tools]
      paths = [sys, doc, ext, tools]
    } else {
      const other: Run[] = [{ start: BAND.other + d(1, 9) * 100, len: BLOCK * d(1, 3) + d(0, 8) }]
      prompts = [doc, tools, other]
      paths = [sys, doc, tools, other]
    }
    // a seeded order of insertion (Fisher-Yates over the three)
    const order = [0, 1, 2]
    for (let i = 2; i > 0; i--) {
      const j = d(0, i)
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const path = paths[d(0, paths.length - 1)]
    const query: Run[] = [...path, { start: BAND.fresh + d(1, 9) * 100, len: w }]
    return { ...trace(order.map((i) => prompts[i]), query), answer: 'number' }
  },
  read: readMatch,
}

/**
 * `match-after-split`: a prompt is inserted, then a second one that parts from it after a shared system prompt, so the
 * edge splits at the shared prefix. The query follows the shared prefix and stops (the answer is the split point), or
 * follows either branch to its end (the answer is that branch's length), then runs on with ids nothing has used. A
 * cache that loses the first branch when the second part from it, or that stops looking at the split, answers differently.
 */
export const MATCH_AFTER_SPLIT: ProveV2Template = {
  id: 'match-after-split',
  kcs: ['t5.prefix-cache-keys'],
  bug: 'a split that drops the first branch’s tail, so a query along the first prompt stops at the point where they part',
  make(seed) {
    const d = draws(seed)
    const s = systemRun(d)
    const first: Run[] = [s, { start: BAND.first + d(1, 9) * 100, len: d(4, 40) }]
    const second: Run[] = [s, { start: BAND.second + d(1, 9) * 100, len: d(4, 40) }]
    const path = [[s], first, second][d(0, 2)]
    const query: Run[] = [...path, { start: BAND.fresh + d(1, 9) * 100, len: d(3, 12) }]
    // either may be inserted first: the bug costs whichever branch came first
    const prompts = d(0, 1) === 0 ? [first, second] : [second, first]
    return { ...trace(prompts, query), answer: 'number' }
  },
  read: readMatch,
}

export const PROVE2: ProveV2Spec = { templates: [MATCH_LEN, MATCH_AFTER_SPLIT] }
