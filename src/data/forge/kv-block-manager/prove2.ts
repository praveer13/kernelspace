/**
 * Prove-it v2 for lab 02 (docs/specs/wave-3.md §7.2): three seeded traces over the fleet bridge's verbs (init,
 * allocate, append, fork, free, translate, free_blocks), and what the learner predicts their own manager replies.
 * Grading, provenance and retries are lab-neutral (src/lib/forge/prove2.ts); this module is the lab's templates.
 *
 * The template rule (3a-22's Opus check; labs 04, 06 and 07 apply it):
 *   1. Answerable from your own code. The answer is a number read from verbs whose behaviour the lab's required checks
 *      pin, or from a design choice your code made and can be read for (here: the order your pool hands blocks out).
 *   2. Never from the story alone. For one module the answer differs across seeds, so no remembered number answers it,
 *      and a plausible bug (`bug`) changes it, so the question exercises the code path the bug lives in.
 *   3. At most 12 calls, every mutating call told in words in `story`; the measuring calls are what `ask` names.
 * tests/forge/prove2-lab02.test.ts proves 2 on every template with a fake correct module and a fake with the bug.
 *
 * No template reads `dump`: no required check looks at its format, so a module that earned `unseen` may still print
 * a dump nothing can parse. `shared-after-append` compares `translate` replies instead, which every check pins.
 * `translate` reads the free-list order only a pool kept as a list can show; a pool kept in a hash set hands ids
 * out in hash order, which no reading predicts (the lab suggests `free: Vec<usize>`, as the reference keeps).
 */

import { KC } from '@/data/kc/ids'
import { splitmix32u } from '@/lib/rng'
import type { ProveV2Spec, ProveV2Template } from '../types'

/** Every trace starts from this pool: 32 blocks of 16 tokens, ids 0 to 31. No trace comes near filling it. */
export const POOL = 32
export const BLOCK = 16
const INIT = `init ${POOL} ${BLOCK}`
const START = `Start a pool of ${POOL} blocks of ${BLOCK} tokens each (ids 0 to ${POOL - 1}).`

/** A seeded draw of integers in [lo, hi]. */
function draws(seed: number): (lo: number, hi: number) => number {
  const next = splitmix32u(seed)
  return (lo, hi) => lo + (next() % (hi - lo + 1))
}

/** A reply that must be a count or a block id; anything else (`none`, `false`, `err …`) is a module that failed the trace. */
function whole(reply: string | undefined, call: string): number {
  const t = (reply ?? '').trim()
  if (!/^\d+$/.test(t)) throw new Error(`\`${call}\` replied '${t.slice(0, 40)}', not a number`)
  return Number(t)
}

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1]
const tokens = (n: number): string => (n === 1 ? '1 token' : `${n} tokens`)
const list = (xs: readonly number[]): string => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * `free-after`: free blocks after a fork-and-append trace that frees the parent while the child still shares its
 * blocks. Sequence 1 always spans at least two blocks, so at least one full block is still shared when 1 is freed:
 * a manager that gives shared blocks back at the first owner's free answers more, on every seed.
 */
export const FREE_AFTER: ProveV2Template = {
  id: 'free-after',
  kcs: [KC.blockRefcounts],
  bug: 'giving a shared block back to the pool when its first owner is freed, instead of when its refcount reaches 0',
  make(seed) {
    const d = draws(seed)
    const parent = d(17, 72)
    const other = d(1, 40)
    const child = d(1, 40)
    const grow = d(0, 1) === 1 ? d(1, 30) : 0
    const otherFirst = d(0, 1) === 1
    const calls = [INIT]
    const story = [START]
    const add = (call: string, line: string) => {
      calls.push(call)
      story.push(line)
    }
    add(`allocate 1 ${parent}`, `Allocate sequence 1 with ${tokens(parent)}.`)
    if (otherFirst) add(`allocate 3 ${other}`, `Allocate sequence 3 with ${tokens(other)}.`)
    add('fork 1 2', 'Fork sequence 1 as sequence 2.')
    add(`append 2 ${child}`, `Append ${tokens(child)} to sequence 2.`)
    if (!otherFirst) add(`allocate 3 ${other}`, `Allocate sequence 3 with ${tokens(other)}.`)
    if (grow > 0) add(`append 1 ${grow}`, `Append ${tokens(grow)} to sequence 1.`)
    add('free 1', 'Free sequence 1.')
    calls.push('free_blocks')
    return { calls, story, ask: 'How many blocks are free in the pool now (`free_blocks`)?', answer: 'number' }
  },
  read: (replies) => whole(last(replies), 'free_blocks'),
}

/**
 * `translate`: the physical block a token of a forked, appended sequence lands in, after a free put blocks back in the
 * pool. The token always sits in a block taken after that free (the copy-on-write tail or a new block), so the answer
 * is the order your pool hands blocks out: the oldest free block (FIFO) and the newest freed (LIFO) differ on every seed.
 */
export const TRANSLATE: ProveV2Template = {
  id: 'translate',
  kcs: [KC.blockTables, KC.kvCopyOnWrite],
  bug: 'the other free-list order: the oldest free block (FIFO) when your pool hands out the newest freed (LIFO), or the reverse',
  make(seed) {
    const d = draws(seed)
    const first = d(17, 64)
    const kept = d(1, 48)
    const more = d(1, 32)
    // Sequence 3's block floor(kept / BLOCK) is the first it takes after the free, and one formula covers both tails: it is
    // the copy-on-write copy of a partial tail, or, when the tail is full, the first new block the append adds.
    const fresh = Math.floor(kept / BLOCK)
    const token = d(fresh * BLOCK, kept + more - 1)
    return {
      calls: [INIT, `allocate 1 ${first}`, `allocate 2 ${kept}`, 'free 1', 'fork 2 3', `append 3 ${more}`, `translate 3 ${token}`],
      story: [
        START,
        `Allocate sequence 1 with ${tokens(first)}.`,
        `Allocate sequence 2 with ${tokens(kept)}.`,
        'Free sequence 1.',
        'Fork sequence 2 as sequence 3.',
        `Append ${tokens(more)} to sequence 3.`,
      ],
      ask: `Which physical block does token ${token} of sequence 3 translate to?`,
      answer: 'number',
    }
  },
  read: (replies) => whole(last(replies), 'translate'),
}

/**
 * `shared-after-append`: how many blocks a fork still shares with its parent after one append to the fork. Read by
 * translating the first token of each of the parent's blocks in both sequences (at most 4 blocks, so at most 12 calls).
 * A manager that copies on fork shares none; one that copies a full tail (or never copies) is off by one.
 */
export const SHARED_AFTER_APPEND: ProveV2Template = {
  id: 'shared-after-append',
  kcs: [KC.kvCopyOnWrite, KC.blockRefcounts],
  bug: 'copying the blocks on fork, instead of copying only a shared partial tail on the first append',
  make(seed) {
    const d = draws(seed)
    // A third of the parents end on a block boundary, so a full tail (no copy) is asked as often as a partial one.
    const blocks = d(2, 4)
    const parent = d(0, 2) === 0 ? blocks * BLOCK : (blocks - 1) * BLOCK + d(1, BLOCK - 1)
    const more = d(1, 40)
    const probes = Array.from({ length: blocks }, (_, i) => i * BLOCK)
    return {
      calls: [INIT, `allocate 1 ${parent}`, 'fork 1 2', `append 2 ${more}`, ...probes.flatMap((t) => [`translate 1 ${t}`, `translate 2 ${t}`])],
      story: [START, `Allocate sequence 1 with ${tokens(parent)}.`, 'Fork sequence 1 as sequence 2.', `Append ${tokens(more)} to sequence 2.`],
      ask: `How many physical blocks do sequences 1 and 2 still share? (Your module is asked to translate tokens ${list(probes)} of both.)`,
      answer: 'number',
    }
  },
  read(replies) {
    const pairs = replies.slice(4)
    if (pairs.length === 0 || pairs.length % 2 !== 0) throw new Error(`expected pairs of translate replies, got ${pairs.length}`)
    let shared = 0
    for (let i = 0; i < pairs.length; i += 2) {
      const call = `translate 1 ${(i / 2) * BLOCK}`
      if (whole(pairs[i], call) === whole(pairs[i + 1], call.replace(' 1 ', ' 2 '))) shared++
    }
    return shared
  },
}

export const PROVE2: ProveV2Spec = { templates: [FREE_AFTER, TRANSLATE, SHARED_AFTER_APPEND] }
