/**
 * The prefix-cache timing oracle (docs/specs/wave-3.md §16.3; t6.l10, `t6.cache-timing-oracle`): tenants share a
 * deployment whose prefix cache serves a hit by skipping the cached prefill. An outside tenant, the prober, sends a
 * guess at a prefix the others use and times it. With one cache for everyone the guess hits, and it comes back faster
 * than a guess nobody used: that gap is the oracle. Putting the tenant in the cache key closes it, because the prober's
 * namespace holds nothing, and it costs hit rate. You predict that cost: the percentage points of hit rate lost when
 * the key carries the tenant. The sweep has two points, x = 0 the shared key and x = 1 the tenant in the key, and shows
 * the probe's gap at each beside the hit rate and the fleet's TTFT.
 *
 * WHAT RUNS ON THE FLEET ENGINE, AND WHAT IS MODELLED. The Engine models what a hit does, not which requests hit: it
 * skips the cached part of a prompt's prefill (`RequestSpec.cachedPrefix`, the same mechanism the broken benchmark's warm
 * cache uses), and everything below (queueing, slots, the TTFT of a hit and of a miss) is the Engine's. The decision
 * whether a request hits is this module's own, labelled model, because the Engine has no cache of its own to ask: an
 * unbounded cache, in arrival order, whose entry for a key exists from the arrival of the first request with that key
 * (`toHits`). Two things follow that a real cache does not do: a request that arrives while the first one with its key is
 * still prefilling already hits (a real cache holds a block only once it is computed), and nothing is ever evicted (a
 * real cache is bounded, and a tenant key multiplies the entries it needs by the tenants). So the hit rate lost is the
 * floor of what a real deployment loses. The Cluster's radix router is not used. Everything is flat-tick, version 1.
 *
 * THE MODEL (flat tick, labelled). One Engine of `TO_ENGINE`: 64 running sequences, first come first served, one prefill
 * chunk of 128 tokens or one decode token per tick per sequence, 50 ms a tick. A request that waits for no one has a TTFT of
 * ⌈uncached prompt ÷ 128⌉ − 1 ticks, where the uncached prompt is the prompt less the cached prefix. A request is a prefix of
 * P tokens (one of K shared prompts any tenant may send) and a unique suffix; with P a multiple of 128 a hit saves exactly
 * P ÷ 128 ticks of prefill, so on an idle engine the probe's gap is P ÷ 128 × 50 ms whatever its suffix is (the lesson's
 * hit-gap: cached tokens ÷ the prefill rate, here 128 tokens per 50 ms).
 *
 * THE TRAFFIC (`toStream`). n requests arrive at uniform random times over a window sized so that, if every one missed, the
 * engine would be loaded at 30, 40 or 50 percent of its Little's-law capacity (slots ÷ the mean hold), so TTFT is mostly
 * prefill and a miss shows. Each request is from one of T tenants and carries one of K prefixes; the (tenant, prefix) pairs
 * are dealt so that every one of the T × K pairs sends at least one request, and the rest are drawn at random. That makes
 * the misses countable by hand:
 *   - with the shared key a request misses only the first time its prefix is seen: K misses in all;
 *   - with the tenant in the key it misses the first time each tenant sends each prefix: T × K misses.
 * The hit rate is the share of requests that hit, so it loses (T × K − K) ÷ n = K × (T − 1) ÷ n, in percentage points
 * 100 × K × (T − 1) ÷ n (`toRead`). The truth is measured from the sweep's two runs, never read from this formula; a test
 * holds them equal on every banded seed.
 *
 * THE PROBES (`toProbe`). After the traffic has drained, the prober (tenant T, outside the others) times four pairs on
 * an idle engine: a guess at prefix 0, which the others used, and a guess at a prefix nobody used, with the same suffix.
 * Whether the first hits is the same cache's answer for the prober's key: with the shared key, yes; with the tenant in the
 * key the prober's namespace is empty, so both miss and the gap is 0. The probe's gap is the miss's TTFT less the hit's.
 *
 * THE DRAW (`toCase`). The seed draws T, K, n, P and the load from the grids below. A (T, K, n) is kept when the tenants'
 * pairs are at most a quarter of the requests (so the tenant-keyed hit rate stays at 75 % or more) and the hit rate lost is
 * between 2 and 25 points; the seed then draws one of six bands of that loss first and a combination in it, so no one
 * answer is right on more than about a fifth of seeds (tests/world/fleet-ex-more-b.test.ts measures it). The scene gives T, K, n, P and
 * the suffix range, never a hit rate or a TTFT. The band (`toBand`): every request completes, the probe's gap is at least
 * four ticks (200 ms) with the shared key and 0 with the tenant key, and the hit rate lost is in that 2 … 25. A prediction
 * passes within a quarter of a percentage point or 5 % of the truth, whichever is larger.
 */

import { splitmix32u } from '@/lib/rng'
import {
  Engine,
  HEADROOM_TOKENS,
  makeRefManager,
  SIM_TICK_SECONDS,
  type EngineConfig,
  type RequestSpec,
  type SchedAction,
  type SchedulerDriver,
  type SchedView,
} from '@/lib/fleet-model'
import type { FleetExerciseDef, SceneFact, SweepPoint, SweepResult } from './index'
import { goodputRps } from './rate'

/** x = 0 is the shared cache (the key is the token prefix), x = 1 the key carries the tenant. */
export const TO_POINTS = [0, 1] as const
export const TO_SHARED = 0
export const TO_TENANT = 1

/** The engine every run uses: KV is large enough that 64 sequences of the longest prompt never fill it. */
export const TO_ENGINE: EngineConfig = {
  numBlocks: 40000,
  blockSize: 16,
  maxRunning: 64,
  sloTtft: 40,
  prefillChunk: 128,
}

/** The grids a seed draws from: tenants, shared prefixes, requests, the prefix's tokens (a multiple of the chunk), and the all-miss load. */
export const TO_TENANTS = [2, 3, 4, 6, 8, 12, 16] as const
export const TO_PREFIXES = [1, 2, 3, 4, 6] as const
export const TO_REQUESTS = [200, 300, 400, 500, 600] as const
export const TO_PREFIX_TOKENS = [512, 1024, 1536, 2048, 3072, 4096] as const
export const TO_LOADS = [0.3, 0.4, 0.5] as const

/** A request's unique suffix and output, uniform over these ranges (tokens). */
export const TO_SUFFIX = { min: 64, max: 319 } as const
export const TO_OUTPUT = { min: 16, max: 63 } as const

/** The probe: this many pairs of a hit-guess and a miss-guess. */
export const TO_PROBE_PAIRS = 4

/** The tenants' (tenant, prefix) pairs are at most this share of the requests; the hit rate lost is between these percentage points. */
export const TO_MAX_PAIR_SHARE = 0.25
export const TO_MIN_LOST = 2
export const TO_MAX_LOST = 25
/** The hit rate lost is drawn from these bands of percentage points, one band first and then a combination in it, so no one answer dominates. */
export const TO_LOST_EDGES = [2, 4, 6, 9, 13, 18, 25] as const
/** The probe must see at least this many ticks of gap with the shared key. */
export const TO_MIN_GAP_TICKS = 4
/** A prediction passes within this many percentage points or this share of the truth, whichever is larger. */
export const TO_TOLERANCE_POINTS = 0.25
export const TO_TOLERANCE_SHARE = 0.05

const PERCENT = 100
const MS_PER_TICK = Math.round(SIM_TICK_SECONDS * 1000)
/** Ticks past the window a run may take before it is cut off (it never is on a banded seed). */
const TO_DRAIN_TICKS = 20000

/** Salts the draws, so the case, the traffic and the probes each have a stream of their own. */
const CASE_SALT = 0x74696d65
const TRAFFIC_SALT = 0x74726166
const PROBE_SALT = 0x70726f62

/** A seed's case: who shares the deployment and what the prefix is. */
export interface ToCase {
  tenants: number
  prefixes: number
  requests: number
  prefixTokens: number
  /** The arrival window in ticks. */
  window: number
}

/** Ticks a request holds a slot on average if it misses: ⌈mean prompt ÷ chunk⌉ for its prefill, then one tick per output token. */
function hold(prefixTokens: number): number {
  const prompt = prefixTokens + (TO_SUFFIX.min + TO_SUFFIX.max) / 2
  return Math.ceil(prompt / TO_ENGINE.prefillChunk) + (TO_OUTPUT.min + TO_OUTPUT.max) / 2
}

/** The hit rate the tenant key loses, in percentage points: K × (T − 1) ÷ n of the requests. */
export const toLostPct = (c: Pick<ToCase, 'tenants' | 'prefixes' | 'requests'>): number => (PERCENT * c.prefixes * (c.tenants - 1)) / c.requests

interface Combo {
  tenants: number
  prefixes: number
  requests: number
}

let groups: readonly (readonly Combo[])[] | undefined

/**
 * The (tenants, prefixes, requests) combinations of the grid that make a fair question, grouped by the band of
 * `TO_LOST_EDGES` their hit rate lost falls in (the last band includes its top), in grid order within a band.
 */
export function toCombosByLost(): readonly (readonly Combo[])[] {
  if (groups) return groups
  const bands: Combo[][] = TO_LOST_EDGES.slice(1).map(() => [])
  for (const tenants of TO_TENANTS) {
    for (const prefixes of TO_PREFIXES) {
      for (const requests of TO_REQUESTS) {
        const c = { tenants, prefixes, requests }
        const lost = toLostPct(c)
        if (tenants * prefixes > TO_MAX_PAIR_SHARE * requests || lost < TO_MIN_LOST || lost > TO_MAX_LOST) continue
        const band = TO_LOST_EDGES.findIndex((edge, i) => i > 0 && lost < edge)
        ;(bands[band < 0 ? bands.length - 1 : band - 1] as Combo[]).push(c)
      }
    }
  }
  return (groups = bands.filter((b) => b.length > 0))
}

/** The case the seed draws. */
export function toCase(seed: number): ToCase {
  const next = splitmix32u(seed ^ CASE_SALT)
  const bands = toCombosByLost()
  const band = bands[next() % bands.length] as readonly Combo[]
  const combo = band[next() % band.length] as Combo
  const prefixTokens = TO_PREFIX_TOKENS[next() % TO_PREFIX_TOKENS.length] as number
  const load = TO_LOADS[next() % TO_LOADS.length] as number
  // window = n ÷ (load × capacity), capacity = slots ÷ hold
  const window = Math.round((combo.requests * hold(prefixTokens)) / (load * TO_ENGINE.maxRunning))
  return { ...combo, prefixTokens, window }
}

/** One request of the traffic with who sent it and which prefix it carries. */
export interface ToRequest extends RequestSpec {
  tenant: number
  prefix: number
}

const inRange = (u: number, r: { min: number; max: number }): number => r.min + (u % (r.max - r.min + 1))

/** The traffic for the seed, sorted by arrival: every (tenant, prefix) pair sends at least once, the rest at random. */
export function toStream(seed: number): ToRequest[] {
  const c = toCase(seed)
  const next = splitmix32u(seed ^ TRAFFIC_SALT)
  const pairs = c.tenants * c.prefixes
  const dealt: number[] = []
  for (let i = 0; i < c.requests; i++) dealt.push(i < pairs ? i : next() % pairs)
  for (let i = dealt.length - 1; i > 0; i--) {
    const j = next() % (i + 1)
    const t = dealt[i] as number
    dealt[i] = dealt[j] as number
    dealt[j] = t
  }
  const out: ToRequest[] = dealt.map((pair, i) => ({
    id: i + 1,
    arrival: next() % c.window,
    prompt: c.prefixTokens + inRange(next(), TO_SUFFIX),
    output: inRange(next(), TO_OUTPUT),
    tenant: Math.floor(pair / c.prefixes),
    prefix: pair % c.prefixes,
  }))
  return out.sort((a, b) => a.arrival - b.arrival || a.id - b.id)
}

/** The cache's key: the prefix alone, or the prefix in the tenant's namespace. */
const keyOf = (mode: number, tenant: number, prefix: number): number => (mode === TO_TENANT ? (tenant + 1) * 1000 + prefix : prefix)

/**
 * The cache's decisions, in arrival order: a request hits when an earlier request with its key arrived, and then the
 * Engine skips the prefix's prefill (`cachedPrefix`). Unbounded, with no wait for the first prefill to finish: the model
 * the header labels.
 */
export function toHits(stream: readonly ToRequest[], mode: number, prefixTokens: number): RequestSpec[] {
  const seen = new Set<number>()
  return stream.map((r) => {
    const key = keyOf(mode, r.tenant, r.prefix)
    const hit = seen.has(key)
    seen.add(key)
    return { id: r.id, arrival: r.arrival, prompt: r.prompt, output: r.output, tenant: r.tenant, ...(hit ? { cachedPrefix: prefixTokens } : {}) }
  })
}

/** First come, first served: admit the oldest waiting request while a slot and its prompt plus headroom fit. */
function fifo(v: SchedView): SchedAction {
  let used = v.running.reduce((a, r) => a + r.prompt + r.decoded + HEADROOM_TOKENS, 0)
  let slots = v.maxRunning - v.running.length
  const admit: number[] = []
  for (const r of [...v.waiting].sort((a, b) => a.arrival - b.arrival || a.id - b.id)) {
    if (slots === 0 || used + r.prompt + HEADROOM_TOKENS > v.memCap) break
    admit.push(r.id)
    slots -= 1
    used += r.prompt + HEADROOM_TOKENS
  }
  return { admit, preempt: [] }
}

const FIFO: SchedulerDriver = { name: 'fifo', schedule: fifo }

/** The probe pairs of the seed: each pair has one suffix, used for the guess at a used prefix and for the guess at an unused one. */
function toProbe(seed: number): number[] {
  const next = splitmix32u(seed ^ PROBE_SALT)
  return Array.from({ length: TO_PROBE_PAIRS }, () => inRange(next(), TO_SUFFIX))
}

/** One point of the sweep: the traffic and then the probes, on one Engine, with the cache keyed as `mode` says. */
export function toPoint(seed: number, mode: number): SweepPoint {
  const c = toCase(seed)
  const stream = toStream(seed)
  const specs = toHits(stream, mode, c.prefixTokens)
  const hits = specs.filter((s) => s.cachedPrefix !== undefined).length
  const engine = new Engine(TO_ENGINE, specs, FIFO, makeRefManager(TO_ENGINE.numBlocks, TO_ENGINE.blockSize))
  const limit = c.window + TO_DRAIN_TICKS
  while (!engine.done && engine.tick < limit) engine.step()
  // the traffic's own numbers, before the probes join the engine's tallies
  const done = engine.stats()
  const served = { completed: done.completed, sloMet: done.sloMet, shed: done.shed }
  const ttftP95 = engine.ttftP95()
  // the prober is tenant T, outside the traffic's 0 … T − 1: its key holds what it has sent itself, and nothing else
  const prober = c.tenants
  const cache = new Set<number>(stream.map((r) => keyOf(mode, r.tenant, r.prefix)))
  const ttftOf = new Map<number, number>()
  engine.onFinish = (f) => {
    ttftOf.set(f.id, f.ttft)
  }
  let id = specs.length
  const probe = (suffix: number, prefix: number): number => {
    id += 1
    const hit = cache.has(keyOf(mode, prober, prefix))
    engine.inject({ id, arrival: engine.tick, prompt: c.prefixTokens + suffix, output: TO_OUTPUT.min, tenant: prober, ...(hit ? { cachedPrefix: c.prefixTokens } : {}) })
    const stop = engine.tick + TO_DRAIN_TICKS
    while (!ttftOf.has(id) && engine.tick < stop) engine.step()
    return ttftOf.get(id) ?? NaN
  }
  const hitTicks: number[] = []
  const missTicks: number[] = []
  for (const suffix of toProbe(seed)) {
    // a guess at prefix 0, which the others used, then at prefix K, which nobody used
    hitTicks.push(probe(suffix, 0))
    missTicks.push(probe(suffix, c.prefixes))
  }
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
  return {
    x: mode,
    goodputRps: goodputRps(served.sloMet, c.window),
    ttftP95,
    metrics: {
      requests: specs.length,
      completed: served.completed,
      sloMet: served.sloMet,
      shed: served.shed,
      hits,
      hitRate: (PERCENT * hits) / specs.length,
      probeHitMs: mean(hitTicks) * MS_PER_TICK,
      probeMissMs: mean(missTicks) * MS_PER_TICK,
      gapMs: (mean(missTicks) - mean(hitTicks)) * MS_PER_TICK,
      ttftP95Ms: ttftP95 * MS_PER_TICK,
    },
  }
}

export const toSweep = (seed: number): SweepResult => ({ points: TO_POINTS.map((mode) => toPoint(seed, mode)) })

const at = (r: SweepResult, x: number): SweepPoint => r.points.find((p) => p.x === x) as SweepPoint
const metric = (r: SweepResult, x: number, name: string): number => at(r, x).metrics?.[name] ?? NaN

/** The hit rate the tenant key lost, in percentage points: the shared cache's hit rate less the tenant-keyed one. */
export const toTruth = (r: SweepResult): number => metric(r, TO_SHARED, 'hitRate') - metric(r, TO_TENANT, 'hitRate')

/** The probe's gap in milliseconds with the shared key (the oracle) and with the tenant in the key. */
export const toGap = (r: SweepResult, x: number): number => metric(r, x, 'gapMs')

/** The seed is a fair question (see the file header). */
export function toBand(r: SweepResult): boolean {
  if (r.points.length !== TO_POINTS.length) return false
  for (const x of TO_POINTS) {
    const p = at(r, x)
    if ((p.metrics?.['completed'] ?? 0) !== (p.metrics?.['requests'] ?? -1) || (p.metrics?.['shed'] ?? 1) !== 0) return false
  }
  const lost = toTruth(r)
  return toGap(r, TO_SHARED) >= TO_MIN_GAP_TICKS * MS_PER_TICK && toGap(r, TO_TENANT) === 0 && lost >= TO_MIN_LOST && lost <= TO_MAX_LOST
}

/** You pass within a quarter of a point or 5 % of the hit rate the tenant key lost, whichever is larger. */
export const toPass = (prediction: number, r: SweepResult): boolean => {
  const truth = toTruth(r)
  return Math.abs(prediction - truth) <= Math.max(TO_TOLERANCE_POINTS, TO_TOLERANCE_SHARE * truth)
}

/** What the learner reads before predicting: who shares the deployment and what is cached; never a hit rate or a TTFT. */
export function toScene(seed: number): SceneFact[] {
  const c = toCase(seed)
  return [
    { label: 'Tenants', value: c.tenants, unit: 'sharing one deployment, and the prober, a tenant outside them' },
    { label: 'Shared prefixes', value: c.prefixes, unit: 'in all, each a prompt any tenant may send and a cacheable prefix' },
    { label: 'Prefix length', value: c.prefixTokens, unit: `tokens, each followed by a suffix of ${TO_SUFFIX.min} to ${TO_SUFFIX.max} tokens that is never repeated` },
    { label: 'Requests', value: c.requests, unit: 'in the window, each from one tenant with one prefix, and every tenant sends every prefix at least once' },
  ]
}

/** The scene's reading, which a learner makes by hand: 100 × K × (T − 1) ÷ n, the misses the tenant key adds. */
export function toRead(scene: readonly SceneFact[]): number {
  const [tenants, prefixes, , requests] = scene as [SceneFact, SceneFact, SceneFact, SceneFact]
  return (PERCENT * prefixes.value * (tenants.value - 1)) / requests.value
}

/** The seed phone mode shows: the first in-band seed from 0 (tests/world/fleet-ex-more-b.test.ts re-derives it). */
export const TO_CANONICAL_SEED = 0

let canonical: SweepResult | undefined

export const timingOracleExercise: FleetExerciseDef = {
  id: 'timing-oracle',
  title: 'The prefix-cache timing oracle',
  lessonId: 't6.l10',
  kcs: ['t6.cache-timing-oracle'],
  unit: 'the percentage points of hit rate lost when the cache key carries the tenant',
  points: TO_POINTS,
  range: { min: 0, max: 100 },
  sweep: toSweep,
  truth: toTruth,
  band: toBand,
  pass: toPass,
  scene: toScene,
  productionClaims: [],
  get phone() {
    return { seed: TO_CANONICAL_SEED, canonical: (canonical ??= toSweep(TO_CANONICAL_SEED)) }
  },
}
