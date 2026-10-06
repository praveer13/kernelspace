/**
 * Reference-vector generator for src/lib/learner/fsrs.ts (spec §6.1, ADR-2).
 *
 * Runs ts-fsrs 5.4.2 ONCE and writes tests/fixtures/fsrs/reference-vectors.json. ts-fsrs is
 * installed only in a scratch directory and never enters package.json (W7); this script loads
 * it by path, so the repo needs no copy of it. The fixture is committed. Re-run only to extend
 * the vectors or to move to another ts-fsrs version (and then say so in the commit).
 *
 *   mkdir -p /tmp/fsrs-ref && cd /tmp/fsrs-ref && npm init -y && npm install ts-fsrs@5.4.2
 *   bun scripts/gen-fsrs-vectors.ts /tmp/fsrs-ref
 *
 * What is recorded, all with the library's own `enable_short_term: true`, no learning steps
 * and no fuzz (the configuration Kernelspace uses):
 * - `sequences`: 2,000 seeded random `(t, G)` replays of length 1-12 at one desired retention
 *   each. Per step: `[t, G, R before the review (null on the first), S, D, interval at the
 *   sequence's retention]`, where S and D are the state AFTER the review.
 * - `curve`: R(t, S) over a grid of t and S, including t = 0 and the S_MIN and S_MAX ends.
 * - `intervals`: `next_interval(S, retention)` over a grid of S and retentions in [0.5, 1].
 *
 * Before writing, every sequence is also replayed through the library's public scheduler
 * (`fsrs().next(card, date, grade)`, dates `t` days apart) and must give the same S and D as
 * the algorithm methods recorded above, so the vectors are what a real card would get. The
 * scheduler's own interval adjustments (again <= hard < good < easy by a day each) are NOT
 * part of the memory model and are not recorded; `intervals` is the raw `next_interval`.
 *
 * Output is deterministic for a given ts-fsrs and Bun (the seed is fixed below).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { splitmix32 } from '../src/lib/rng'

const VERSION = '5.4.2'
const SEED = 0x6b657231
const SEQUENCES = 2000
const OUT = 'tests/fixtures/fsrs/reference-vectors.json'
const RETENTIONS = [0.7, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99]
const GRID_RETENTIONS = [0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99, 1]
const GRID_S = [0.001, 0.01, 0.1, 0.212, 0.5, 1, 1.2931, 2.3065, 3, 8.2956, 10, 30, 100, 365, 1000, 5000, 36500]
const GRID_T = [0, 1, 2, 3, 7, 14, 30, 90, 365, 1000, 5000]

interface Memory {
  difficulty: number
  stability: number
}
interface ScratchCard {
  stability: number
  difficulty: number
}
interface TsFsrs {
  fsrs(params: Record<string, unknown>): {
    next(card: ScratchCard, now: Date, grade: number): { card: ScratchCard }
    next_state(memory: Memory | null, t: number, grade: number): Memory
    forgetting_curve(t: number, s: number): number
    next_interval(s: number, t: number): number
  }
  createEmptyCard(now: Date): ScratchCard
  default_w: readonly number[]
}

const scratch = resolve(process.argv[2] ?? '')
const entry = join(scratch, 'node_modules/ts-fsrs/dist/index.mjs')
if (!process.argv[2] || !existsSync(entry)) {
  console.error('usage: bun scripts/gen-fsrs-vectors.ts <scratch dir with ts-fsrs@' + VERSION + ' installed>')
  process.exit(2)
}
const installed = (JSON.parse(readFileSync(join(scratch, 'node_modules/ts-fsrs/package.json'), 'utf8')) as { version: string }).version
if (installed !== VERSION) {
  console.error(`ts-fsrs ${installed} is installed in ${scratch}; the vectors are defined for ${VERSION}`)
  process.exit(2)
}
const lib = (await import(pathToFileURL(entry).href)) as TsFsrs

const rand = splitmix32(SEED)
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]

/** Elapsed whole days: mostly short gaps, some same-day, a long tail. */
function elapsed(): number {
  const u = rand()
  if (u < 0.15) return 0
  if (u < 0.4) return int(1, 3)
  if (u < 0.75) return int(4, 30)
  if (u < 0.95) return int(31, 400)
  return int(401, 3000)
}

/** Per-sequence rating profiles so lapses, Hard and Easy all occur often (Again, Hard, Good, Easy). */
const PROFILES: readonly (readonly number[])[] = [
  [0.1, 0.1, 0.6, 0.2],
  [0.35, 0.2, 0.35, 0.1],
  [0.05, 0.05, 0.3, 0.6],
  [0.25, 0.25, 0.25, 0.25],
  [0.5, 0.2, 0.25, 0.05],
]
function grade(profile: readonly number[]): number {
  let u = rand()
  for (let i = 0; i < 4; i++) {
    u -= profile[i]
    if (u < 0) return i + 1
  }
  return 4
}

const day = 86_400_000
const t0 = Date.UTC(2026, 0, 1, 12)
const make = (retention: number) =>
  lib.fsrs({ enable_short_term: true, learning_steps: [], relearning_steps: [], enable_fuzz: false, request_retention: retention })

type Step = [t: number, g: number, r: number | null, s: number, d: number, interval: number]
const sequences: { retention: number; steps: Step[] }[] = []
const stats = { steps: 0, firstReviews: 0, sameDay: 0, lapses: 0, hard: 0, easy: 0, longGaps: 0, maxS: 0 }

for (let i = 0; i < SEQUENCES; i++) {
  const retention = pick(RETENTIONS)
  const profile = pick(PROFILES)
  const f = make(retention)
  const length = int(1, 12)
  const steps: Step[] = []
  let memory: Memory | null = null
  let card = lib.createEmptyCard(new Date(t0))
  let now = t0
  for (let k = 0; k < length; k++) {
    const t = k === 0 ? 0 : elapsed()
    const g = grade(profile)
    const r = memory ? f.forgetting_curve(t, memory.stability) : null
    memory = f.next_state(memory, t, g)
    // The same review through the public scheduler must land on the same memory.
    now += t * day
    card = f.next(card, new Date(now), g).card
    if (card.stability !== memory.stability || card.difficulty !== memory.difficulty) {
      throw new Error(`sequence ${i} step ${k}: scheduler S/D disagree with next_state`)
    }
    steps.push([t, g, r, memory.stability, memory.difficulty, f.next_interval(memory.stability, t)])
    stats.steps++
    if (k === 0) stats.firstReviews++
    else if (t === 0) stats.sameDay++
    else if (g === 1) stats.lapses++
    if (g === 2) stats.hard++
    if (g === 4) stats.easy++
    if (t > 365) stats.longGaps++
    stats.maxS = Math.max(stats.maxS, memory.stability)
  }
  sequences.push({ retention, steps })
}

const base = make(0.9)
const curve = GRID_S.flatMap((s) => GRID_T.map((t) => ({ t, s, r: base.forgetting_curve(t, s) })))
const intervals = GRID_RETENTIONS.flatMap((retention) => {
  const f = make(retention)
  return GRID_S.map((s) => ({ s, retention, days: f.next_interval(s, 0) }))
})

const fixture = {
  generator: {
    tool: 'ts-fsrs',
    version: VERSION,
    script: 'scripts/gen-fsrs-vectors.ts',
    command: `bun scripts/gen-fsrs-vectors.ts <scratch dir with ts-fsrs@${VERSION}>`,
    seed: SEED,
    config: { enable_short_term: true, learning_steps: [], relearning_steps: [], enable_fuzz: false },
    sequenceStep: '[t, grade, R before the review (null on the first), S after, D after, interval at the sequence retention]',
  },
  w: [...lib.default_w],
  stats,
  curve,
  intervals,
  sequences,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(fixture) + '\n')
console.log(`wrote ${OUT}: ${sequences.length} sequences, ${stats.steps} steps, ${curve.length} curve points, ${intervals.length} interval points`)
console.log(JSON.stringify(stats))
