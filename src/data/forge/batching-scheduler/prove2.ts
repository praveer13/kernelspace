/**
 * Prove-it v2 for lab 06 (docs/specs/wave-3.md §7.2): three seeded views over the scheduler bridge's `schedule` verb,
 * and what the learner predicts their own scheduler replies. Grading, provenance and retries are lab-neutral
 * (src/lib/forge/prove2.ts); this module is the lab's templates.
 *
 * Every trace is two calls: `init`, then one multi-line `schedule` entry (a header, then W and R lines;
 * labs/batching-scheduler/src/lib.rs `bridge`). The reply is `admit <ids>` and `preempt <ids>`, each a comma list.
 *
 * The template rule (3a-22's Opus check, which labs 04, 06 and 07 apply):
 *   1. Answerable from your own code. The answer is what your `schedule` returns for a view; the view is built so the
 *      choices the six required checks leave free (headroom, preemption) are what separates modules, and the choices
 *      they pin (smallest prompt first, aging) agree across every eligible module.
 *   2. Never from the story alone. For one module the answer differs across seeds, and a plausible bug (`bug`) changes
 *      it, so the question exercises the code path the bug lives in.
 *   3. At most 12 calls (here 2), every request told in words in `story`; `ask` names what is measured.
 * tests/forge/batching-scheduler.test.ts proves 2 on every template with a fake correct scheduler and a fake with the bug.
 *
 * What the checks leave free, and so what each template reads:
 *   admit-order   Nothing but the tie-break: every view has distinct prompts at least 64 tokens apart, nothing old
 *                 enough to age, and room for all of it, so smallest prompt first is the only eligible order. The bug is
 *                 first come first served, which `convoy` already rejects: this is the order check, in your own code.
 *   admit-count   Headroom. `scheduler.rs` says no check catches too little headroom, even none. The view's cap sits
 *                 between what a module with no margin admits and what a module that keeps about 48 tokens per
 *                 sequence admits, however it counts that margin (per running request, or also per admitted one).
 *   preempt       Whether, and whom. The reference never preempts, and the traces never need one, so a module that
 *                 never preempts answers `none` here; the template is for the one that does, and it asks the learner
 *                 to know which they wrote. The limit: every module that never preempts answers `none`, so for it this
 *                 template is a constant that the learner can answer without reading code; admit-order and admit-count
 *                 are the two that vary across such modules. The view is over the cap by less than any one request
 *                 holds, so a single victim fixes it, and the oldest and the newest differ.
 *
 * Nothing here reads `mem_used`: the bridge ignores the header's field (`let _ = mem_used`), so a view builds its
 * pressure from `mem_cap` and the running requests' tokens. The header still carries the true sum, for modules that read it.
 */

import { KC } from '@/data/kc/ids'
import { splitmix32u } from '@/lib/rng'
import type { ProveV2Spec, ProveV2Template } from '../types'

/** The memory cap of `admit-order`'s views: nothing in them comes near it. */
export const ROOMY_CAP = 8192
/** The margin per sequence the reference keeps (scheduler.rs: "about 48 tokens"). */
export const MARGIN = 48

const START = 'Start your scheduler fresh (`init`).'

/** A seeded draw of integers in [lo, hi]. */
function draws(seed: number): (lo: number, hi: number) => number {
  const next = splitmix32u(seed)
  return (lo, hi) => lo + (next() % (hi - lo + 1))
}
type Draw = ReturnType<typeof draws>

/** A seeded shuffle (Fisher-Yates). */
function shuffled<T>(d: Draw, xs: readonly T[]): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = d(0, i)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** `n` distinct request ids from 0 to 23, in a seeded order: not ascending, so arrival order is never id order. */
const pickIds = (d: Draw, n: number): number[] => shuffled(d, Array.from({ length: 24 }, (_, i) => i)).slice(0, n)

/** `n` distinct integers in [lo, hi], ascending. */
function distinct(d: Draw, n: number, lo: number, hi: number): number[] {
  const pool = shuffled(d, Array.from({ length: hi - lo + 1 }, (_, i) => lo + i))
  return pool.slice(0, n).sort((a, b) => a - b)
}

interface Req {
  id: number
  arrival: number
  prompt: number
}
interface Run extends Req {
  decoded: number
}
interface View {
  iter: number
  maxRunning: number
  memCap: number
  /** In arrival order. */
  waiting: Req[]
  /** In arrival order (here also the order they were admitted in). Every one has finished its prefill. */
  running: Run[]
}

/** Tokens a running request holds: its prompt plus what it has decoded (lib.rs `simulate`). */
const resident = (running: readonly Run[]): number => running.reduce((a, r) => a + r.prompt + r.decoded, 0)

/** The bridge's `schedule` entry for a view: one call, a header and then W and R lines. */
function scheduleCall(v: View): string {
  return [
    `schedule ${v.iter} ${v.maxRunning} ${v.memCap} ${resident(v.running)}`,
    ...v.waiting.map((r) => `W ${r.id} ${r.arrival} ${r.prompt}`),
    ...v.running.map((r) => `R ${r.id} ${r.arrival} ${r.prompt} ${r.decoded} 0`),
  ].join('\n')
}

const tokens = (n: number): string => (n === 1 ? '1 token' : `${n} tokens`)

/** The view in words: every request with the numbers the call carries. */
function viewStory(v: View): string[] {
  const head = `At iteration ${v.iter} the engine allows ${v.maxRunning} running requests at once and holds at most ${v.memCap} tokens; a running request holds its prompt plus the tokens it has decoded.`
  const running =
    v.running.length === 0
      ? ['Nothing is running.']
      : v.running.map((r) => `Running: request ${r.id} arrived at iteration ${r.arrival}, has a prompt of ${tokens(r.prompt)} and has decoded ${tokens(r.decoded)}.`)
  const waiting =
    v.waiting.length === 0
      ? ['Nothing is waiting.']
      : v.waiting.map((r) => `Waiting: request ${r.id} arrived at iteration ${r.arrival} with a prompt of ${tokens(r.prompt)}.`)
  return [START, head, ...running, ...waiting]
}

/** The ids on `admit` or `preempt` of a `schedule` reply; a reply without the line, or with anything but ids, is a module that failed. */
function listOf(reply: string | undefined, key: 'admit' | 'preempt'): number[] {
  const m = new RegExp(`^${key}[ \\t]*(.*)$`, 'm').exec(reply ?? '')
  if (m === null) throw new Error(`\`schedule\` replied '${(reply ?? '').trim().slice(0, 40)}', with no ${key} line`)
  const body = m[1].trim()
  if (body === '') return []
  const parts = body.split(',').map((p) => p.trim())
  if (!parts.every((p) => /^\d+$/.test(p))) throw new Error(`\`schedule\` replied '${key} ${body.slice(0, 40)}', which is not a list of ids`)
  return parts.map(Number)
}

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1]

/** A running request: a prompt, and some decode behind it. */
const runOf = (d: Draw, id: number, arrival: number, lo: number, hi: number): Run => ({ id, arrival, prompt: d(lo, hi), decoded: d(1, 60) })

/**
 * `admit-order`: which waiting requests are admitted, in what order. Four to six requests wait on one to three
 * running ones; two to four slots are free, so the list is cut at the slots as well as sorted. Prompts are drawn
 * without repeats from 64 to 448 in steps of 64, every wait is under 41 iterations and the cap is far off, so
 * smallest prompt first is the one order an eligible module can give. The first request to arrive is never the
 * smallest, so a module that admits in arrival order answers differently on every seed.
 */
export const ADMIT_ORDER: ProveV2Template = {
  id: 'admit-order',
  kcs: [KC.schedOrder],
  bug: 'admitting in arrival order (first come first served) instead of smallest prompt first, so the whale-first order the convoy check rejects',
  make(seed) {
    const d = draws(seed)
    const nRun = d(1, 3)
    const free = d(2, 4)
    const n = d(Math.max(free, 4), 6)
    const iter = d(60, 120)
    const ids = pickIds(d, nRun + n)
    const runArrivals = distinct(d, nRun, 0, iter - 41)
    const waitArrivals = distinct(d, n, iter - 40, iter - 1)
    const sizes = shuffled(d, [64, 128, 192, 256, 320, 384, 448]).slice(0, n)
    // The smallest prompt is never first in line, and the first `free` in arrival order are never the `free` smallest in order.
    if (sizes[0] === Math.min(...sizes)) [sizes[0], sizes[1]] = [sizes[1], sizes[0]]
    const view: View = {
      iter,
      maxRunning: nRun + free,
      memCap: ROOMY_CAP,
      running: runArrivals.map((a, i) => runOf(d, ids[i], a, 64, 448)),
      waiting: waitArrivals.map((a, i) => ({ id: ids[nRun + i], arrival: a, prompt: sizes[i] })),
    }
    return {
      calls: ['init', scheduleCall(view)],
      story: [...viewStory(view), `${free} slots are free.`],
      ask: 'Which waiting requests does your `schedule` admit, and in what order? Type the ids in the order your module lists them.',
      answer: 'ids',
    }
  },
  read: (replies) => listOf(last(replies), 'admit'),
}

/**
 * `admit-count`: how many waiting requests are admitted when the running ones leave little of the cap free. The
 * waiting prompts rise with arrival, so arrival order and smallest first agree and only the memory test is asked.
 * The cap is set from `c` and the prompts: a module that keeps no margin fits `c + 1` of them, and a module that keeps
 * about 48 tokens per sequence fits `c` however it counts the margin (per running request alone, or also per request
 * it admits, with or without the candidate). With `n` running and `S(k)` the tokens of the `k` smallest waiting
 * prompts plus the running ones, the cap lies in [max(S(c) + 48(n + c), S(c + 1)), S(c + 1) + 48n - 1].
 */
export const ADMIT_COUNT: ProveV2Template = {
  id: 'admit-count',
  kcs: [KC.admissionHeadroom],
  bug: 'keeping no headroom for decode growth, so one more waiting request fits under the cap than a module with its margin admits',
  make(seed) {
    const d = draws(seed)
    const nRun = d(2, 4)
    const c = d(1, 3)
    const n = c + 1 + d(0, 2)
    const iter = d(60, 120)
    const ids = pickIds(d, nRun + n)
    const running = distinct(d, nRun, 0, iter - 41).map((a, i) => runOf(d, ids[i], a, 100, 400))
    const arrivals = distinct(d, n, iter - 40, iter - 1)
    // Each prompt is 70 to 140 tokens above the last, from 120 to 200: so the gap to the next one is at least 48c + 1.
    const prompts: number[] = [d(120, 200)]
    while (prompts.length < n) prompts.push(prompts[prompts.length - 1] + d(70, 140))
    const upTo = (k: number): number => resident(running) + prompts.slice(0, k).reduce((a, p) => a + p, 0)
    const lo = Math.max(upTo(c) + MARGIN * (nRun + c), upTo(c + 1))
    const hi = upTo(c + 1) + MARGIN * nRun - 1
    if (lo > hi) throw new Error(`admit-count: no cap between ${lo} and ${hi}`)
    const view: View = {
      iter,
      maxRunning: nRun + n + 1,
      memCap: Math.floor((lo + hi) / 2),
      running,
      waiting: arrivals.map((a, i) => ({ id: ids[nRun + i], arrival: a, prompt: prompts[i] })),
    }
    return {
      calls: ['init', scheduleCall(view)],
      story: [...viewStory(view), 'Slots are not the limit: memory is.'],
      ask: 'How many of the waiting requests does your `schedule` admit?',
      answer: 'number',
    }
  },
  read: (replies) => listOf(last(replies), 'admit').length,
}

/**
 * `preempt`: whom the module preempts when the running requests hold more than the cap. Three or four requests run,
 * none waits, and the total is over the cap by 5 to 60 tokens: less than any one request holds (each holds more than
 * 120), so preempting one fixes it. Which one is the whole question: the newest has the least work to lose (the
 * engine's own forced preemption takes it), and the oldest differs from it on every seed. A module that never preempts
 * answers `none`.
 */
export const PREEMPT: ProveV2Template = {
  id: 'preempt',
  kcs: [KC.continuousBatching],
  bug: 'preempting the oldest running request when your module preempts the newest, or the reverse',
  make(seed) {
    const d = draws(seed)
    const nRun = d(3, 4)
    const iter = d(60, 150)
    const ids = pickIds(d, nRun)
    const running = distinct(d, nRun, 0, iter - 1).map((a, i) => runOf(d, ids[i], a, 120, 420))
    const over = d(5, 60)
    const view: View = { iter, maxRunning: nRun + 2, memCap: resident(running) - over, waiting: [], running }
    return {
      calls: ['init', scheduleCall(view)],
      story: [...viewStory(view), `Together the running requests hold ${resident(running)} tokens, ${over} more than the cap.`],
      ask: 'Which running requests does your `schedule` preempt, in the order your module lists them? Type none if it preempts nobody.',
      answer: 'ids',
    }
  },
  read: (replies) => listOf(last(replies), 'preempt'),
}

export const PROVE2: ProveV2Spec = { templates: [ADMIT_ORDER, ADMIT_COUNT, PREEMPT] }
