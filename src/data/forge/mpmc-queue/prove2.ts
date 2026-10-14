/**
 * Prove-it v2 for lab 04 (docs/specs/wave-3.md §7.2): three seeded traces over the fleet bridge's verbs (`init`, `push`,
 * `pop`; labs/mpmc-queue/src/lib.rs `dispatch`), and what the learner predicts their own queue replies. Grading,
 * provenance and retries are lab-neutral (src/lib/forge/prove2.ts); this module is the lab's templates.
 *
 * Lab 04's required checks pin a correct module's behaviour exactly (FIFO, backpressure at capacity 4, 1,000 wraps,
 * a 3,000-op model gauntlet, bursts at 8 to 32 slots), so a module with credit `unseen` can only be a correct queue.
 * The rule of lab 02's templates (3a-22) therefore reads differently here:
 *   1. `last-pop` and `after-wrap` are tracing questions about a correct module. The answer is a number the story's
 *      own pushes and the checks' contract fix, but only by working the trace: a refused push drops its value, and a
 *      pop after the cursors have gone round the ring still has to return the oldest value left.
 *   2. `full-count` reads a design choice the checks leave open. queue.rs lets `new` round the capacity up to a power
 *      of two or keep it, and the checks only ever use powers of two, so how many pushes of a 6-slot queue are accepted
 *      is answered by your own `new` (8 after a round-up, 6 if kept, 4 after a round-down).
 *   3. For one module the answer differs across seeds, so no remembered number answers it; a plausible mistake (`bug`)
 *      changes it. At most 12 calls, every state-changing call told in words in `story`.
 * tests/forge/mpmc-queue.test.ts proves 1 and 3 on every template with a fake correct module and fakes with the bugs.
 *
 * No template calls `probe`: it builds its own queue of 8 slots and leaves the one `init` made alone, so it says
 * nothing about the module under test's state, and `init` replies only `ok`.
 */

import { splitmix32u } from '@/lib/rng'
import type { ProveV2Spec, ProveV2Template } from '../types'

const MUTEX_ATOMICS = 't2.mutex-atomics'
const ABA = 't2.aba'

/** `last-pop` and `after-wrap` run on a 4-slot queue, the size `backpressure` and `wraparound` pin. */
export const RING = 4
/** A trace is `init` and at most 11 more calls (PROVE2_MAX_CALLS is 12). */
export const TRACE_OPS = 11

/** One call after `init`: a push of a value, or a pop. */
type Op = { push: number } | 'pop'

/** A seeded draw of integers in [lo, hi]. */
function draws(seed: number): (lo: number, hi: number) => number {
  const next = splitmix32u(seed)
  return (lo, hi) => lo + (next() % (hi - lo + 1))
}

/** `n` distinct values in 10 to 99, in a seeded order: two-digit, so none is a position or a capacity. */
function values(d: (lo: number, hi: number) => number, n: number): number[] {
  const pool = Array.from({ length: 90 }, (_, i) => i + 10)
  for (let i = 0; i < n; i++) {
    const j = i + d(0, pool.length - 1 - i)
    const taken = pool[j]
    pool[j] = pool[i]
    pool[i] = taken
  }
  return pool.slice(0, n)
}

/** A reply that must be a value, `ok`, `full` or `empty`; anything else (`err …`) is a module that failed the trace. */
function reply(r: string | undefined, call: string): string {
  const t = (r ?? '').trim()
  if (!/^(\d+|ok|full|empty)$/.test(t)) throw new Error(`\`${call}\` replied '${t.slice(0, 40)}', which is not ok, full, empty or a value`)
  return t
}

/** A reply that must be a popped value; `empty` is a module that popped nothing where the trace has a value. */
function whole(r: string | undefined, call: string): number {
  const t = (r ?? '').trim()
  if (!/^\d+$/.test(t)) throw new Error(`\`${call}\` replied '${t.slice(0, 40)}', not a value`)
  return Number(t)
}

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1]

const call = (op: Op): string => (op === 'pop' ? 'pop' : `push ${op.push}`)
const line = (op: Op): string => (op === 'pop' ? 'Pop.' : `Push ${op.push}.`)

/** What a plain FIFO of `cap` values replies to `ops`, as the bridge words it. `stack` and `overwrite` are wrong models. */
function replay(cap: number, ops: readonly Op[], model: 'fifo' | 'stack' | 'overwrite' = 'fifo'): string[] {
  const q: number[] = []
  return ops.map((op) => {
    if (op === 'pop') {
      const v = model === 'stack' ? q.pop() : q.shift()
      return v === undefined ? 'empty' : String(v)
    }
    if (q.length >= cap) {
      if (model !== 'overwrite') return 'full'
      q.shift()
    }
    q.push(op.push)
    return 'ok'
  })
}

/** The values pops returned: a push replies `ok` or `full`, and a pop that finds the queue empty replies `empty`, which pops nothing. */
export const popped = (replies: readonly string[]): string[] => replies.filter((r) => /^\d+$/.test(r))

/**
 * `last-pop`: the last pop's reply after a trace on a 4-slot queue that refuses some pushes. A refused push is not in
 * the queue, so the value it carried never comes out, and the oldest value left is the answer. A trace is kept only
 * when a push is refused, at least three pops return a value (a pop on the empty queue does not count), the last op is
 * one of them, and the two wrong models (a full queue that overwrites its oldest value, and a stack) both answer
 * something else.
 */
export const LAST_POP: ProveV2Template = {
  id: 'last-pop',
  kcs: [MUTEX_ATOMICS],
  bug: 'a push into the full queue that overwrites the oldest value (or is queued anyway) instead of being refused, or a pop that takes the newest value',
  make(seed) {
    const d = draws(seed)
    for (let attempt = 0; attempt < 1000; attempt++) {
      const v = values(d, TRACE_OPS)
      const ops: Op[] = Array.from({ length: TRACE_OPS }, (_, i) => (i === TRACE_OPS - 1 || (i > 0 && d(0, 99) >= 62) ? 'pop' : { push: v[i] }))
      const right = replay(RING, ops)
      const refused = right.filter((r) => r === 'full').length
      const answer = last(right)
      if (refused < 1 || popped(right).length < 3 || answer === undefined || !/^\d+$/.test(answer)) continue
      if (last(replay(RING, ops, 'overwrite')) === answer || last(replay(RING, ops, 'stack')) === answer) continue
      return {
        calls: [`init ${RING}`, ...ops.map(call)],
        story: [`Start a queue with capacity ${RING}.`, ...ops.slice(0, -1).map(line)],
        ask: 'Then one more `pop`. What does that last pop reply?',
        answer: 'number' as const,
      }
    }
    throw new Error(`last-pop found no trace for seed ${seed}`)
  },
  read: (replies) => whole(last(replies), 'pop'),
}

/** Capacities that are not a power of two and that 11 calls can saturate in every design: round-down, kept and round-up. */
const ODD_CAPACITIES = [3, 5, 6, 7] as const
const roundUp = (c: number): number => 2 ** Math.ceil(Math.log2(c))
const roundDown = (c: number): number => 2 ** Math.floor(Math.log2(c))

/** Pushes refused when `ops` run on a queue that holds `cap`. */
const refusals = (cap: number, ops: readonly Op[]): number => replay(cap, ops).filter((r) => r === 'full').length

/**
 * `full-count`: how many pushes reply `full` on a queue whose capacity is not a power of two. queue.rs lets `new` round
 * up (the reference does) or keep the capacity, and a round-down passes the checks too, since they only use powers of
 * two. A trace is kept only when the three designs refuse a different number of pushes, so the answer is your `new`.
 */
export const FULL_COUNT: ProveV2Template = {
  id: 'full-count',
  kcs: [MUTEX_ATOMICS],
  bug: 'taking the capacity as asked when your new() rounds it up to a power of two, or the other way round',
  make(seed) {
    const d = draws(seed)
    for (let attempt = 0; attempt < 1000; attempt++) {
      const cap = ODD_CAPACITIES[d(0, ODD_CAPACITIES.length - 1)]
      const n = TRACE_OPS - d(0, 2)
      const pops = d(1, 3)
      const at = new Set<number>()
      while (at.size < pops) at.add(d(3, n - 1))
      const v = values(d, n)
      const ops: Op[] = Array.from({ length: n }, (_, i) => (at.has(i) ? 'pop' : { push: v[i] }))
      const counts = new Set([refusals(cap, ops), refusals(roundUp(cap), ops), refusals(roundDown(cap), ops)])
      if (counts.size < 3) continue
      return {
        calls: [`init ${cap}`, ...ops.map(call)],
        story: [`Start a queue with capacity ${cap}.`, ...ops.map(line)],
        ask: 'How many of those pushes reply `full`? (Read your own `new`: the checks never try a capacity that is not a power of two.)',
        answer: 'number' as const,
      }
    }
    throw new Error(`full-count found no trace for seed ${seed}`)
  },
  read(replies) {
    const rs = replies.map((r, i) => reply(r, `call ${i + 1}`))
    return rs.filter((r) => r === 'full').length
  },
}

/**
 * `after-wrap`: the last pop's reply once both cursors have gone round the 4-slot ring. The trace keeps the queue
 * between one and four values, so no push is refused and no pop finds it empty: it has 6 pushes and 5 pops, and the
 * fifth pop (head cursor 4, slot 0 again) must still return the fifth value pushed. A slot freed at the wrong number
 * would make a later push see a full ring, and a read of the slot instead of the queue would return a newer value.
 */
export const AFTER_WRAP: ProveV2Template = {
  id: 'after-wrap',
  kcs: [ABA],
  bug: 'reading the slot the cursor wrapped onto instead of the oldest value still queued: the newest value, as a stack would reply',
  make(seed) {
    const d = draws(seed)
    for (let attempt = 0; attempt < 1000; attempt++) {
      const v = values(d, 6)
      let pushes = 0
      let held = 0
      const ops: Op[] = []
      for (let i = 0; i < TRACE_OPS; i++) {
        // the first op must push, the last must pop; in between a push needs room and a pop needs a value to leave one behind
        const push = i === 0 || (i < TRACE_OPS - 1 && held < RING && (held < 2 || d(0, 1) === 0))
        ops.push(push ? { push: v[pushes++] ?? -1 } : 'pop')
        held += push ? 1 : -1
        if (held < 1 && i < TRACE_OPS - 1) break
      }
      if (ops.length !== TRACE_OPS || pushes !== 6) continue
      const right = replay(RING, ops)
      const answer = last(right)
      if (right.includes('full') || right.includes('empty') || answer === undefined) continue
      if (last(replay(RING, ops, 'stack')) === answer) continue
      return {
        calls: [`init ${RING}`, ...ops.map(call)],
        story: [`Start a queue with capacity ${RING}.`, ...ops.slice(0, -1).map(line)],
        ask: 'Then one more `pop`. By now the push and pop positions have each gone round the 4 slots. What does that last pop reply?',
        answer: 'number' as const,
      }
    }
    throw new Error(`after-wrap found no trace for seed ${seed}`)
  },
  read: (replies) => whole(last(replies), 'pop'),
}

export const PROVE2: ProveV2Spec = { templates: [LAST_POP, FULL_COUNT, AFTER_WRAP] }
