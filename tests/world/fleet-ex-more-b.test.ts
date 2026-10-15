/**
 * More W5 exercises, part B (docs/specs/wave-3.md §16.3, task 3s-05): the rollout straggler (`straggler`, t6.l7) and the
 * prefix-cache timing oracle (`timing-oracle`, t6.l10). One fleet-ex module each, registered in `FLEET_EXERCISES` and
 * placed as fleet blocks; the exercise job dispatches by id, so no worker, host or session file names them.
 *
 * What is measured here, and printed so the review can read it:
 *   - the model: the straggler's idle share against 1 − Σ l ÷ (k × max l) and the `rollout` family's pinned 37.5 %; the
 *     timing oracle's engine facts (a hit's TTFT, the probe's gap of P ÷ 128 ticks), its cache's miss counts (K shared,
 *     T × K tenant-keyed) and the hit rate lost, K × (T − 1) ÷ n, which the sweep measures and a test holds equal;
 *   - fairness: the draws spread the right answers, every banded seed completes, the lesson notes' numbers re-derived;
 *   - BF8 (a generated exercise must not let a strategy that ignores the scene pass): the best constant, cycling
 *     constants, and the scene's reading, each judged by the panel's own done rule (`runOf`);
 *   - the panel's pure session on the two new exercises (free number in a range, own verdict and table, a full round).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { kcById } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { FleetExerciseBlock } from '../../src/data/lessons/types'
import {
  PASSES_NEEDED,
  accepts,
  canSave,
  copyFor,
  entryText,
  explainReady,
  freshRound,
  itemEvent,
  parsePrediction,
  predictEvent,
  readExercise,
  reduceRound,
  runOf,
  sweepTable,
  verdictText,
  type Played,
} from '../../src/components/fleet-ex/session'
import { Engine, SIM_TICK_SECONDS, makeRefManager, makeRefScheduler } from '../../src/lib/fleet-model'
import { splitmix32u } from '../../src/lib/rng'
import { FLEET_EXERCISES, type FleetExerciseDef, type SceneFact, type SweepResult } from '../../src/lib/world/fleet-ex'
import {
  STR_CANONICAL_SEED,
  STR_GROUP,
  STR_LONG_BANDS,
  STR_LONG_COUNTS,
  STR_MAX_IDLE,
  STR_MIN_IDLE,
  STR_POINTS,
  STR_SHORT_BANDS,
  STR_STEP,
  STR_TOLERANCE,
  strBand,
  strIdlePct,
  strLengths,
  strPass,
  strRead,
  strScene,
  strSweep,
  strTruth,
} from '../../src/lib/world/fleet-ex/straggler'
import {
  TO_CANONICAL_SEED,
  TO_ENGINE,
  TO_LOST_EDGES,
  TO_MIN_GAP_TICKS,
  TO_PREFIX_TOKENS,
  TO_PROBE_PAIRS,
  TO_SHARED,
  TO_SUFFIX,
  TO_TENANT,
  TO_TOLERANCE_POINTS,
  TO_TOLERANCE_SHARE,
  toBand,
  toCase,
  toCombosByLost,
  toGap,
  toHits,
  toLostPct,
  toPass,
  toPoint,
  toRead,
  toScene,
  toStream,
  toSweep,
  toTruth,
} from '../../src/lib/world/fleet-ex/timing-oracle'

const str = FLEET_EXERCISES['straggler'] as FleetExerciseDef
const to = FLEET_EXERCISES['timing-oracle'] as FleetExerciseDef
const knee = FLEET_EXERCISES['knee'] as FleetExerciseDef

const pct = (x: number) => `${(100 * x).toFixed(1)} %`

/* ------------------------------ surveys, shared ------------------------------ */

const STR_SEEDS = 600
const TO_SEEDS = 300

interface Row {
  seed: number
  truth: number
  read: number
  banded: boolean
  pass: (guess: number) => boolean
}

const strRows: Row[] = Array.from({ length: STR_SEEDS }, (_, seed) => {
  const r = strSweep(seed)
  return { seed, truth: strTruth(r), read: strRead(strScene(seed)), banded: strBand(r), pass: (g) => strPass(g, r) }
})
const toRows: (Row & { pairShare: number; shared: number; tenant: number })[] = Array.from({ length: TO_SEEDS }, (_, seed) => {
  const r = toSweep(seed)
  const c = toCase(seed)
  return {
    seed,
    truth: toTruth(r),
    read: toRead(toScene(seed)),
    banded: toBand(r),
    pass: (g) => toPass(g, r),
    pairShare: (c.tenants * c.prefixes) / c.requests,
    shared: r.points[0]?.ttftP95 ?? NaN,
    tenant: r.points[1]?.ttftP95 ?? NaN,
  }
})

/** The panel's rule on a list of rounds: P(done within `rounds`) for a player whose guess is `guess(row)`, Monte Carlo over the rows. */
function doneWithin(rows: readonly Row[], guess: (r: Row) => number, rounds: number, trials = 4000): number {
  const rnd = splitmix32u(0xd0e5)
  let done = 0
  for (let i = 0; i < trials; i++) {
    const played: Played[] = []
    for (let t = 0; t < rounds; t++) {
      const r = rows[rnd() % rows.length] as Row
      const g = guess(r)
      played.push({ seed: t, ok: r.pass(g), value: g, truth: r.truth })
    }
    if (runOf(played, PASSES_NEEDED).done) done++
  }
  return done / trials
}

/** The constant that passes on the most rows, and the share it passes on. */
function bestConstant(rows: readonly Row[], lo: number, hi: number, step: number): { value: number; share: number } {
  let best = { value: lo, share: 0 }
  for (let c = lo; c <= hi; c += step) {
    const share = rows.filter((r) => r.pass(c)).length / rows.length
    if (share > best.share) best = { value: c, share }
  }
  return best
}

/* ------------------------------ registration and placement ------------------------------ */

describe('registered and placed', () => {
  test('each exercise is one fleet-ex module, registered by id after the four before it', () => {
    expect(Object.keys(FLEET_EXERCISES)).toEqual(['knee', 'pd-split', 'broken-bench', 'push-luck', 'straggler', 'timing-oracle'])
    expect(str.id).toBe('straggler')
    expect(to.id).toBe('timing-oracle')
    expect([str.lessonId, to.lessonId]).toEqual(['t6.l7', 't6.l10'])
  })

  test('each names its lesson’s real KCs, holds its lesson’s one fleet block for it, and names no claim', () => {
    for (const def of [str, to]) {
      const lesson = ALL_LESSONS.find((l) => l.id === def.lessonId)
      expect(lesson).toBeDefined()
      for (const kc of def.kcs) {
        expect(kcById(kc)).toBeDefined()
        expect(lesson?.kcs).toContain(kc)
      }
      const blocks = (lesson?.blocks ?? []).filter((b): b is FleetExerciseBlock => b.type === 'exercise' && 'fleet' in b && b.fleet === def.id)
      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.title).toBe(def.title)
      // §16.3 lists no production row for either, and no pinned claim names their dials
      expect(def.productionClaims).toEqual([])
    }
  })

  test('each sits after its lesson’s item block and before its quiz, with only other fleet blocks between', () => {
    for (const def of [str, to]) {
      const lesson = ALL_LESSONS.find((l) => l.id === def.lessonId)!
      const index = lesson.blocks.findIndex((b) => b.type === 'exercise' && 'fleet' in b && b.fleet === def.id)
      expect(lesson.blocks.findIndex((b) => b.type === 'item')).toBeLessThan(index)
      expect(index).toBeLessThan(lesson.blocks.findIndex((b) => b.type === 'quiz'))
    }
  })

  test('no worker, host, protocol or session file names either exercise: the job dispatches by id', () => {
    for (const file of ['src/workers/fleet-protocol.ts', 'src/lib/fleet-host.ts', 'src/lib/fleet-session.ts', 'src/workers/fleet.worker.ts']) {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
      for (const id of ['straggler', 'timing-oracle']) expect(text).not.toMatch(new RegExp(`['"\`]${id}['"\`]`))
    }
  })

  test('the exported markdown lists each as a fleet block (public/lessons-md is regenerated by scripts/export-lessons-md.ts)', () => {
    for (const [lesson, title] of [['t6.l7', 'The rollout straggler'], ['t6.l10', 'The prefix-cache timing oracle']] as const) {
      const file = new URL(`../../public/lessons-md/${lesson}.md`, import.meta.url)
      expect(existsSync(file)).toBe(true)
      expect(readFileSync(file, 'utf8')).toContain(`**Exercise: ${title}**`)
    }
  })
})

/* ------------------------------ straggler: the model ------------------------------ */

describe('straggler: the model', () => {
  test('the idle share is 1 − Σ l ÷ (k × max l), which is 1 − mean ÷ max, and the family’s pinned group idles 37.5 %', () => {
    expect(strIdlePct([2000, 4000, 6000, 8000])).toBe(37.5)
    for (const seed of [0, 1, 2, 3, 77, 300]) {
      const l = strLengths(seed)
      const sum = l.reduce((a, b) => a + b, 0)
      expect(strIdlePct(l)).toBeCloseTo(100 * (1 - sum / (l.length * Math.max(...l))), 9)
      expect(strIdlePct(l)).toBeCloseTo(100 * (1 - sum / l.length / Math.max(...l)), 9)
    }
    // a slot is busy for its own sample’s length: slot-time = k × max, idle tokens = k × max − Σ
    const r = strSweep(5)
    for (const p of r.points) {
      const m = p.metrics!
      expect(m['idleTokens']).toBe(m['slotTokens']! - m['meanTokens']! * m['samples']!)
      expect((100 * m['idleTokens']!) / m['slotTokens']!).toBeCloseTo(m['idleShare']!, 9)
    }
  })

  test('the lesson’s note states two groups: 2k, 4k, 6k, 8k idle 37.5 %, and seven of 3,000 with one of 21,000 idle 75 %', () => {
    expect(strIdlePct([3000, 3000, 3000, 3000, 3000, 3000, 3000, 21000])).toBe(75)
    const lesson = ALL_LESSONS.find((l) => l.id === 't6.l7')
    const note = (lesson?.blocks.find((b) => b.type === 'exercise' && 'fleet' in b) as FleetExerciseBlock).note ?? ''
    for (const part of ['mean of 5,000 and a longest of 8,000, so 37.5 % of the slot-time is idle', 'mean of 5,250 against a longest of 21,000, and 75 % idle', 'the formula and not a run']) expect(note).toContain(part)
  })

  test('the sweep is model-only: seven group sizes, no request served, the model in each point’s metrics', () => {
    const r = strSweep(3)
    expect(r.points.map((p) => p.x)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(str.points).toEqual([...STR_POINTS])
    expect(str.range).toEqual({ min: 0, max: 100 })
    const all = strLengths(3)
    for (const p of r.points) {
      expect(p.goodputRps).toBe(0)
      expect(p.ttftP95).toBe(0)
      const group = all.slice(0, p.x)
      expect(p.metrics?.['samples']).toBe(p.x)
      expect(p.metrics?.['longestTokens']).toBe(Math.max(...group))
      expect(p.metrics?.['meanTokens']).toBe(group.reduce((a, b) => a + b, 0) / p.x)
      expect(p.metrics?.['idleShare']).toBe(strIdlePct(group))
    }
    expect(strTruth(r)).toBe(r.points[r.points.length - 1]?.metrics?.['idleShare'] as number)
  })

  test('the lengths are a long tail: eight multiples of 100, one to three of them long, the rest short, in the drawn bands', () => {
    const counts = new Map<number, number>()
    for (let seed = 0; seed < 200; seed++) {
      const l = strLengths(seed)
      expect(l).toHaveLength(STR_GROUP)
      for (const x of l) expect(x % STR_STEP).toBe(0)
      const longMin = Math.min(...STR_LONG_BANDS.map((b) => b.min))
      const shortMax = Math.max(...STR_SHORT_BANDS.map((b) => b.max))
      const longs = l.filter((x) => x >= longMin).length
      expect(shortMax).toBeLessThan(longMin)
      expect((STR_LONG_COUNTS as readonly number[]).includes(longs)).toBe(true)
      counts.set(longs, (counts.get(longs) ?? 0) + 1)
      expect(Math.max(...l)).toBeGreaterThanOrEqual(longMin)
    }
    console.log(`straggler long samples per group over seeds 0 … 199: ${[...counts].sort((a, b) => a[0] - b[0]).map(([n, c]) => `${n}: ${c}`).join(', ')}`)
    expect([...counts.keys()].sort()).toEqual([1, 2, 3])
  })
})

/* ------------------------------ straggler: fairness, determinism, strategies ------------------------------ */

describe('straggler: a fair question, deterministic, and a strategy that ignores the scene does not finish', () => {
  test('sweeps are pure and deterministic, in any order', () => {
    const a = strSweep(11)
    strSweep(12)
    expect(strSweep(11)).toEqual(a)
    expect(strScene(11)).toEqual(strScene(11))
    expect(str.sweep(11)).toEqual(a)
  })

  test('the seeds in band: every seed is a fair question, between 20 % and 90 % idle', () => {
    const banded = strRows.filter((r) => r.banded)
    const lo = Math.min(...banded.map((r) => r.truth))
    const hi = Math.max(...banded.map((r) => r.truth))
    console.log(`straggler: ${banded.length} of ${strRows.length} seeds in 0 … ${STR_SEEDS - 1} are in band; idle share ${lo.toFixed(1)} … ${hi.toFixed(1)} %`)
    expect(banded.length / strRows.length).toBeGreaterThan(0.95)
    for (const r of banded) {
      expect(r.truth).toBeGreaterThanOrEqual(STR_MIN_IDLE)
      expect(r.truth).toBeLessThanOrEqual(STR_MAX_IDLE)
    }
  })

  test('the scene lists the group and every length, never an idle share, and its reading is the truth on every seed', () => {
    for (const r of strRows) {
      const scene = strScene(r.seed)
      expect(scene).toHaveLength(1 + STR_GROUP)
      expect(scene[0]?.label).toBe('Group')
      expect(scene[0]?.value).toBe(STR_GROUP)
      for (const f of scene) expect(f.label.toLowerCase()).not.toContain('idle')
      expect(scene.slice(1).map((f) => f.value)).toEqual(strLengths(r.seed))
      expect(r.read).toBeCloseTo(r.truth, 9)
    }
  })

  test('the pass rule is within one percentage point; the mean-over-mean slip and a dropped sample do not pass', () => {
    const seed = strRows.find((r) => r.banded)!.seed
    const r = strSweep(seed)
    const t = strTruth(r)
    expect(strPass(t, r)).toBe(true)
    expect(strPass(t + STR_TOLERANCE, r)).toBe(true)
    expect(strPass(t - STR_TOLERANCE, r)).toBe(true)
    expect(strPass(t + STR_TOLERANCE + 0.01, r)).toBe(false)
    expect(str.truth(r)).toBe(t)
    // the family’s slip (the gap over the mean instead of the longest) and a group of seven are not the answer on nearly every seed
    const slips = strRows.filter((x) => {
      const l = strLengths(x.seed)
      const mean = l.reduce((a, b) => a + b, 0) / l.length
      return x.pass((100 * (Math.max(...l) - mean)) / mean)
    }).length
    const sevens = strRows.filter((x) => x.pass(strIdlePct(strLengths(x.seed).slice(0, 7)))).length
    console.log(`straggler slips that pass: gap over the mean ${pct(slips / strRows.length)}, a group of seven ${pct(sevens / strRows.length)}`)
    expect(slips / strRows.length).toBeLessThan(0.03)
    expect(sevens / strRows.length).toBeLessThan(0.3)
  })

  test('the phone seed is the first in band, and its outcome is that seed’s sweep', () => {
    expect(STR_CANONICAL_SEED).toBe(strRows.find((r) => r.banded)?.seed)
    expect(str.phone.seed).toBe(STR_CANONICAL_SEED)
    expect(str.phone.canonical).toEqual(strSweep(STR_CANONICAL_SEED))
  })

  test('the right answers are spread: the best constant passes on at most a fifth of seeds and finishes within 10 rounds about 3 % of the time', () => {
    const rows = strRows.filter((r) => r.banded)
    const best = bestConstant(rows, 20, 90, 0.05)
    const d10 = doneWithin(rows, () => best.value, 10)
    const d30 = doneWithin(rows, () => best.value, 30)
    console.log(`straggler best constant ${best.value.toFixed(2)} %: passes on ${pct(best.share)} of banded seeds; done within 10 rounds ${pct(d10)}, within 30 ${pct(d30)}`)
    expect(best.share).toBeLessThan(0.2)
    expect(d10).toBeLessThan(0.1)
    expect(d30).toBeLessThan(0.3)
  })

  test('a learner who reads the scene finishes within 10 rounds, every time', () => {
    const rows = strRows.filter((r) => r.banded)
    const d10 = doneWithin(rows, (r) => r.read, 10)
    console.log(`straggler scene reading: done within 10 rounds ${pct(d10)}`)
    expect(d10).toBeGreaterThan(0.99)
  })
})

/* ------------------------------ timing oracle: the engine facts ------------------------------ */

describe('timing-oracle: what the header and copy say about the engine', () => {
  test('a hit skips its prefix’s prefill: TTFT ⌈(prompt − cached) ÷ 128⌉ − 1 ticks, and a miss ⌈prompt ÷ 128⌉ − 1', () => {
    for (const prefix of TO_PREFIX_TOKENS) {
      for (const suffix of [64, 128, 129, 300]) {
        const ttft = (cached: number): number => {
          const spec = { id: 1, arrival: 0, prompt: prefix + suffix, output: 16, ...(cached > 0 ? { cachedPrefix: cached } : {}) }
          const e = new Engine(TO_ENGINE, [spec], makeRefScheduler(), makeRefManager(TO_ENGINE.numBlocks, TO_ENGINE.blockSize))
          while (!e.done) e.step()
          return e.stats().ttfts[0] as number
        }
        expect(ttft(0)).toBe(Math.ceil((prefix + suffix) / TO_ENGINE.prefillChunk) - 1)
        expect(ttft(prefix)).toBe(Math.ceil(suffix / TO_ENGINE.prefillChunk) - 1)
        // with the prefix a multiple of the chunk, the saving is exactly prefix ÷ 128 ticks whatever the suffix is
        expect(ttft(0) - ttft(prefix)).toBe(prefix / TO_ENGINE.prefillChunk)
      }
    }
  })

  test('the probe’s gap is P ÷ 128 ticks of 50 ms with the shared key, and 0 with the tenant in the key', () => {
    for (const row of toRows.slice(0, 80)) {
      const c = toCase(row.seed)
      const r = toSweep(row.seed)
      expect(toGap(r, TO_SHARED)).toBe((c.prefixTokens / TO_ENGINE.prefillChunk) * Math.round(SIM_TICK_SECONDS * 1000))
      expect(toGap(r, TO_TENANT)).toBe(0)
      // with the tenant in the key both guesses miss: the used and the unused prefix take the same time
      expect(r.points[1]?.metrics?.['probeHitMs']).toBe(r.points[1]?.metrics?.['probeMissMs'])
    }
    // the lesson’s note: 2,048 tokens is 16 ticks, so 800 ms
    expect((2048 / 128) * 50).toBe(800)
  })

  test('the probe runs on an idle engine, in pairs of the same suffix: TO_PROBE_PAIRS of each, the engine drained first', () => {
    expect(TO_PROBE_PAIRS).toBe(4)
    const p = toPoint(0, TO_SHARED)
    expect(p.metrics?.['completed']).toBe(p.metrics?.['requests'])
    // the probes join the engine after the traffic: its tallies and p95 are the traffic’s alone
    expect(p.metrics?.['requests']).toBe(toStream(0).length)
  })
})

/* ------------------------------ timing oracle: the cache and the answer ------------------------------ */

describe('timing-oracle: the cache’s misses are K shared and T × K tenant-keyed, so the hit rate lost is K × (T − 1) ÷ n', () => {
  test('every (tenant, prefix) pair sends a request, so the misses are countable by hand', () => {
    for (const row of toRows.slice(0, 60)) {
      const c = toCase(row.seed)
      const stream = toStream(row.seed)
      expect(stream).toHaveLength(c.requests)
      const pairs = new Set(stream.map((r) => `${r.tenant}/${r.prefix}`))
      expect(pairs.size).toBe(c.tenants * c.prefixes)
      const misses = (mode: number) => toHits(stream, mode, c.prefixTokens).filter((s) => s.cachedPrefix === undefined).length
      expect(misses(TO_SHARED)).toBe(c.prefixes)
      expect(misses(TO_TENANT)).toBe(c.tenants * c.prefixes)
    }
  })

  test('the sweep’s measured loss is the hand reading on every seed, and the lesson’s note example is 3.5 points', () => {
    for (const row of toRows) {
      expect(row.banded).toBe(true)
      expect(row.read).toBeCloseTo(row.truth, 9)
      expect(toLostPct(toCase(row.seed))).toBeCloseTo(row.truth, 9)
    }
    // 8 tenants, 2 prefixes, 400 requests: 2 misses against 16, 99.5 % down to 96 %
    expect(toLostPct({ tenants: 8, prefixes: 2, requests: 400 })).toBe(3.5)
    expect(100 * (1 - 2 / 400)).toBe(99.5)
    expect(100 * (1 - 16 / 400)).toBe(96)
    const lesson = ALL_LESSONS.find((l) => l.id === 't6.l10')
    const note = (lesson?.blocks.find((b) => b.type === 'exercise' && 'fleet' in b) as FleetExerciseBlock).note ?? ''
    for (const part of ['a 2,048-token prefix is 16 ticks, so the probe sees a gap of 800 ms', '8 tenants, 2 prefixes and 400 requests go from 2 misses to 16, a loss of 3.5 points of hit rate (99.5 % down to 96 %)', 'not modelled here']) {
      expect(note).toContain(part)
    }
  })

  test('the TTFT p95 shows the loss once misses pass about 5 % of requests: equal below 4 %, higher above 7 %', () => {
    const low = toRows.filter((r) => r.pairShare <= 0.04)
    const high = toRows.filter((r) => r.pairShare > 0.07)
    console.log(`timing-oracle TTFT p95: ${low.filter((r) => r.shared === r.tenant).length} of ${low.length} seeds with tenant pairs at 4 % of requests or less show no change; ${high.filter((r) => r.tenant > r.shared).length} of ${high.length} above 7 % show a higher p95`)
    expect(low.length).toBeGreaterThan(10)
    expect(high.length).toBeGreaterThan(10)
    for (const r of low) expect(r.tenant).toBe(r.shared)
    for (const r of high) expect(r.tenant).toBeGreaterThan(r.shared)
  })

  test('the engine never queues the traffic into a shed or an unfinished request, and never loads past what the draw sized', () => {
    for (const row of toRows.slice(0, 60)) {
      for (const p of toSweep(row.seed).points) {
        expect(p.metrics?.['completed']).toBe(p.metrics?.['requests'])
        expect(p.metrics?.['shed']).toBe(0)
        expect(p.metrics?.['hitRate']).toBe((100 * (p.metrics?.['hits'] as number)) / (p.metrics?.['requests'] as number))
      }
    }
  })
})

/* ------------------------------ timing oracle: fairness, determinism, strategies ------------------------------ */

describe('timing-oracle: a fair question, deterministic, and a strategy that ignores the scene does not finish', () => {
  test('sweeps are pure and deterministic, in any order, and two points: shared, then tenant-keyed', () => {
    const a = toSweep(5)
    toSweep(6)
    expect(toSweep(5)).toEqual(a)
    expect(to.sweep(5)).toEqual(a)
    expect(a.points.map((p) => p.x)).toEqual([0, 1])
    expect(to.points).toEqual([0, 1])
    expect(to.range).toEqual({ min: 0, max: 100 })
    expect(toScene(5)).toEqual(toScene(5))
    expect(toStream(5)).toEqual(toStream(5))
  })

  test('every drawn seed is a fair question: it completes, the oracle is open and then closed, the loss is 2 … 25 points', () => {
    const banded = toRows.filter((r) => r.banded)
    const lo = Math.min(...toRows.map((r) => r.truth))
    const hi = Math.max(...toRows.map((r) => r.truth))
    console.log(`timing-oracle: ${banded.length} of ${toRows.length} seeds in 0 … ${TO_SEEDS - 1} are in band; hit rate lost ${lo.toFixed(2)} … ${hi.toFixed(2)} points`)
    expect(banded.length).toBe(toRows.length)
    expect(lo).toBeGreaterThanOrEqual(2)
    expect(hi).toBeLessThanOrEqual(25)
    for (const row of toRows.slice(0, 60)) {
      const r = toSweep(row.seed)
      expect(toGap(r, TO_SHARED)).toBeGreaterThanOrEqual(TO_MIN_GAP_TICKS * 50)
    }
    // the tenant-keyed hit rate stays at 75 % or more
    for (const row of toRows.slice(0, 60)) expect(toSweep(row.seed).points[1]?.metrics?.['hitRate'] as number).toBeGreaterThanOrEqual(75)
  })

  test('the grid offers a band of combinations for each range of loss, and each band is drawn from equally often', () => {
    const bands = toCombosByLost()
    expect(bands).toHaveLength(TO_LOST_EDGES.length - 1)
    bands.forEach((band, i) => {
      for (const c of band) {
        const lost = toLostPct(c)
        expect(lost).toBeGreaterThanOrEqual(TO_LOST_EDGES[i] as number)
        expect(lost).toBeLessThanOrEqual(TO_LOST_EDGES[i + 1] as number)
      }
    })
    const share = new Map<number, number>()
    for (const r of toRows) {
      const band = TO_LOST_EDGES.findIndex((e, i) => i > 0 && r.truth < e) - 1
      share.set(band < 0 ? bands.length - 1 : band, (share.get(band < 0 ? bands.length - 1 : band) ?? 0) + 1 / toRows.length)
    }
    console.log(`timing-oracle loss bands (${TO_LOST_EDGES.join(', ')}): ${[...share].sort((a, b) => a[0] - b[0]).map(([i, s]) => `${i}: ${pct(s)}`).join(', ')}`)
    for (const s of share.values()) expect(s).toBeGreaterThan(0.08)
  })

  test('the scene gives tenants, prefixes, the prefix length and the requests, never a hit rate or a TTFT, and its reading is the truth', () => {
    for (const row of toRows) {
      const scene = toScene(row.seed)
      expect(scene.map((f) => f.label)).toEqual(['Tenants', 'Shared prefixes', 'Prefix length', 'Requests'])
      for (const f of scene) {
        expect(Number.isFinite(f.value)).toBe(true)
        expect(f.label.toLowerCase()).not.toContain('hit rate')
        expect(f.label.toLowerCase()).not.toContain('ttft')
      }
      expect((TO_PREFIX_TOKENS as readonly number[]).includes(scene[2]?.value as number)).toBe(true)
      expect(scene[2]?.unit).toContain(`${TO_SUFFIX.min} to ${TO_SUFFIX.max} tokens`)
      expect(row.read).toBeCloseTo(row.truth, 9)
    }
  })

  test('the pass rule is a quarter of a point or 5 %, whichever is larger; the phone seed is the first in band', () => {
    const r = toSweep(2)
    const t = toTruth(r)
    const tol = Math.max(TO_TOLERANCE_POINTS, TO_TOLERANCE_SHARE * t)
    expect(toPass(t, r)).toBe(true)
    expect(toPass(t + tol, r)).toBe(true)
    expect(toPass(t - tol, r)).toBe(true)
    expect(toPass(t + tol + 0.01, r)).toBe(false)
    expect(to.truth(r)).toBe(t)
    expect(TO_CANONICAL_SEED).toBe(toRows.find((r) => r.banded)?.seed)
    expect(to.phone.seed).toBe(TO_CANONICAL_SEED)
    expect(to.phone.canonical).toEqual(toSweep(TO_CANONICAL_SEED))
  })

  test('the best constant passes on at most a fifth of seeds and finishes within 10 rounds about 3 % of the time (30 rounds: under a third)', () => {
    const best = bestConstant(toRows, 2, 25, 0.05)
    const d10 = doneWithin(toRows, () => best.value, 10)
    const d30 = doneWithin(toRows, () => best.value, 30)
    console.log(`timing-oracle best constant ${best.value.toFixed(2)} points: passes on ${pct(best.share)} of seeds; done within 10 rounds ${pct(d10)}, within 30 ${pct(d30)}`)
    expect(best.share).toBeLessThan(0.2)
    expect(d10).toBeLessThan(0.12)
    expect(d30).toBeLessThan(0.33)
  })

  test('the misreadings the scene tempts do not pass: all-miss (T − 1) ÷ T, the tenant-keyed miss rate, and K ÷ n', () => {
    const slip = (f: (c: ReturnType<typeof toCase>) => number) => toRows.filter((r) => r.pass(f(toCase(r.seed)))).length / toRows.length
    const a = slip((c) => (100 * (c.tenants - 1)) / c.tenants)
    const b = slip((c) => (100 * c.tenants * c.prefixes) / c.requests)
    const d = slip((c) => (100 * c.prefixes) / c.requests)
    console.log(`timing-oracle slips that pass: (T − 1) ÷ T ${pct(a)}, T × K ÷ n ${pct(b)}, K ÷ n ${pct(d)}`)
    expect(a).toBeLessThan(0.05)
    expect(b).toBeLessThan(0.08)
    expect(d).toBeLessThan(0.1)
  })

  test('a learner who reads the scene finishes within 10 rounds, every time', () => {
    const d10 = doneWithin(toRows, (r) => r.read, 10)
    console.log(`timing-oracle scene reading: done within 10 rounds ${pct(d10)}`)
    expect(d10).toBeGreaterThan(0.99)
  })
})

/* ------------------------------ the panel’s pure session ------------------------------ */

describe('the panel session on the new exercises', () => {
  test('a free number in the range is a prediction for both, and the knee keeps “one of” its points', () => {
    for (const def of [str, to]) {
      expect(accepts(def, 37.5)).toBe(true)
      expect(accepts(def, 0)).toBe(true)
      expect(accepts(def, 100)).toBe(true)
      expect(accepts(def, -1)).toBe(false)
      expect(accepts(def, 100.5)).toBe(false)
      expect(accepts(def, NaN)).toBe(false)
      expect(parsePrediction(def, '62.5')).toBe(62.5)
      expect(parsePrediction(def, 'much')).toBeNull()
      expect(parsePrediction(def, '101')).toBeNull()
    }
    expect(parsePrediction(knee, '1.3')).toBeNull()
  })

  test('the entry rule names the unit each takes', () => {
    expect(entryText(str, copyFor('straggler')!)).toEqual({ hint: 'a percentage from 0 to 100', error: 'Enter the idle share as a percentage from 0 to 100, such as 62.5.' })
    expect(entryText(to, copyFor('timing-oracle')!)).toEqual({ hint: 'a number of percentage points', error: 'Enter the hit rate lost as a number of percentage points, such as 7.5.' })
  })

  test('each has copy: a setup that states its own constants and its label, three ideas, a model answer, and a label for every point', () => {
    for (const def of [str, to]) {
      const c = copyFor(def.id)!
      expect(c).not.toBeNull()
      expect(c.ideas).toHaveLength(3)
      expect(c.model.length).toBeGreaterThan(200)
      expect(c.explainPrompt).toMatch(/\?|\.$/)
      for (const p of def.points) {
        expect(c.tickLabel(p)).not.toBe('')
        expect(c.pointLabel(p)).not.toBe('')
      }
      expect(c.view).toBeDefined()
      expect(c.view?.plot).toBeNull()
    }
    const s = copyFor('straggler')!
    for (const part of ['hypothetical', '1 − Σ l ÷ (8 × max l)', '1 − mean ÷ max', 'not a Fleet run', 'k = 2 … 8', '1 percentage point']) expect(s.setup).toContain(part)
    const t = copyFor('timing-oracle')!
    for (const part of ['64 sequences', '50 ms', '128 tokens', '64 to 319 tokens', '⌈(prompt − cached) ÷ 128⌉', 'partly a model', 'unbounded cache', 'at least this much', '0.25 point or 5%']) expect(t.setup).toContain(part)
  })

  test('the straggler’s verdict and table name the idle share, the mean and the longest, and the window that counts as right', () => {
    const seed = strRows.find((r) => r.banded)!.seed
    const r = strSweep(seed)
    const c = copyFor('straggler')!
    const truth = strTruth(r)
    const right = verdictText(str, c, truth, r)
    expect(right.ok).toBe(true)
    expect(right.detail).toContain('of its slot-time idle on this seed')
    const off = verdictText(str, c, truth + 5, r)
    expect(off.ok).toBe(false)
    expect(off.headline).toBe('Your prediction was off.')
    expect(off.detail).toContain('within 1 point is right')
    expect(off.detail).toContain('The mean length is')
    const table = sweepTable(str, c, r, truth)
    expect(table.columns).toEqual(['Samples per group', 'Mean length (tokens)', 'Longest (tokens)', 'Idle share (%)'])
    expect(table.rows).toHaveLength(STR_POINTS.length)
    expect(table.rows[STR_POINTS.length - 1]?.[0]).toBe('8 (the answer)')
  })

  test('the timing oracle’s verdict and table name both hit rates, the loss, the probe’s gap with each key and the TTFT p95', () => {
    const r = toSweep(4)
    const c = copyFor('timing-oracle')!
    const truth = toTruth(r)
    const right = verdictText(to, c, truth, r)
    expect(right.ok).toBe(true)
    expect(right.detail).toContain('of hit rate on this seed')
    expect(right.detail).toContain('with the shared cache and 0 ms with the tenant in the key')
    const off = verdictText(to, c, truth + 10, r)
    expect(off.ok).toBe(false)
    expect(off.detail).toContain('is right:')
    const table = sweepTable(to, c, r, truth)
    expect(table.columns).toEqual(['Cache key', 'Hit rate (%)', 'Probe, used prefix (ms)', 'Probe, unused prefix (ms)', 'Probe gap (ms)', 'TTFT p95 (ms)'])
    expect(table.rows.map((row) => row[0])).toEqual(['Shared across tenants', 'Tenant in the key'])
    expect(table.rows[1]?.[4]).toBe('0')
    expect(c.pointLabel(0)).toBe('the shared cache')
    expect(c.pointLabel(1)).toBe('the tenant in the key')
  })

  test.each([
    ['straggler', str],
    ['timing-oracle', to],
  ] as const)('%s: a round runs draw → predict → explain → saved, writes numeric events, and counts as a pass', (_id, def) => {
    const seed = 3
    const r: SweepResult = def.sweep(seed)
    expect(def.band(r)).toBe(true)
    let round = reduceRound(def, freshRound(0), { type: 'draw' })
    round = reduceRound(def, round, { type: 'swept', seed, result: r, at: 1 })
    expect(round.phase).toBe('predict')
    // a value the exercise does not take is refused
    expect(reduceRound(def, round, { type: 'commit', prediction: -5, at: 2 }).phase).toBe('predict')
    const answer = def.truth(r)
    round = reduceRound(def, round, { type: 'commit', prediction: answer, conf: 'sure', at: 2 })
    expect(round.phase).toBe('explain')
    expect(round.ok).toBe(true)
    expect(round.truth).toBe(answer)
    round = reduceRound(def, round, { type: 'explain', text: 'the slower thing sets the rate and the rest follows from it' })
    expect(explainReady(round.explain)).toBe(true)
    for (const index of [0, 1, 2]) round = reduceRound(def, round, { type: 'idea', index })
    expect(canSave(round)).toBe(true)
    round = reduceRound(def, round, { type: 'save', at: 3 })
    expect(round.phase).toBe('saved')
    const ctx = { lessonId: def.lessonId, index: 7 }
    const item = itemEvent(def, ctx, round)
    const predict = predictEvent(def, ctx, round)
    for (const e of [item, predict]) {
      expect(e.ref).toBe(`item:fleet.${def.id}`)
      expect(e.ok).toBe(true)
      expect(e.provenance).toBe('unseen')
      expect(e.data).toMatchObject({ src: 'lesson', value: answer, truth: answer, unit: def.unit, lessonId: def.lessonId, grp: `${def.lessonId}#7` })
    }
    const state = readExercise([{ kind: 'item', ref: item.ref, at: '2026-01-01T00:00:00Z', ok: true, seed, data: item.data }], { id: def.id, lessonId: def.lessonId, index: 7, needs: PASSES_NEEDED })
    expect(state.passes).toBe(1)
  })

  test('a close number is a pass and a distant one a miss', () => {
    const r = strSweep(3)
    const t = strTruth(r)
    const play = (def: FleetExerciseDef, sweep: SweepResult, prediction: number) =>
      reduceRound(def, reduceRound(def, reduceRound(def, freshRound(0), { type: 'draw' }), { type: 'swept', seed: 3, result: sweep, at: 1 }), { type: 'commit', prediction, at: 2 })
    expect(play(str, r, Math.round(t)).ok).toBe(true)
    expect(play(str, r, t + 8).ok).toBe(false)
    const o = toSweep(3)
    expect(play(to, o, Math.round(toTruth(o) * 10) / 10).ok).toBe(true)
    expect(play(to, o, toTruth(o) * 1.5).ok).toBe(false)
  })
})

/* a scene fact is a number the panel prints with its unit */
test('every scene fact of both exercises has a label, a finite value and a unit', () => {
  for (let seed = 0; seed < 20; seed++) {
    for (const f of [...strScene(seed), ...toScene(seed)] as SceneFact[]) {
      expect(f.label).not.toBe('')
      expect(Number.isFinite(f.value)).toBe(true)
      expect(f.unit).not.toBe('')
    }
  }
})
