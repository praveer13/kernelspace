/**
 * Traces for the scheduler play (docs/specs/wave-2.md §8.2).
 *
 * THE BUSIEST-MINUTE ARTIFACT is `public/traces/burstgpt-v2-busiest-minute.json`: 40 requests sampled
 * evenly from BurstGPT v2's busiest aligned 60 s, one real second per tick. The artifact records
 * how many requests that minute holds (`sampling.sourceRowsInWindow`); the source lines read it,
 * so no UI line ever types the number. Its 40 rows are `sampledMinute`, and its arrival gaps pace
 * every minute the play runs, the practice minute included.
 *
 * FRESH MINUTES. `makeSchedTrace(source, seed)` resamples 40 distinct (prompt, output) pairs from
 * the 480 rows of the busiest-hour artifact and takes the 39 arrival gaps, with replacement, from
 * the practice minute's own gaps. Same seed, same trace, in every browser. The pairs are real
 * BurstGPT rows; the arrangement is synthetic (provenance `unseen`).
 *
 * THE ENGINE CONFIG is a labelled scenario, not a claim: 256 blocks of 16, 8 running, 128-token
 * prefill chunks, and the TTFT SLO below.
 *
 * THE BAND. A minute is in band when:
 *   1. the ghost (`referenceScheduler`) meets the TTFT SLO on at least 70 % of the requests;
 *   2. FCFS with the same 48-token headroom meets at least 3 fewer;
 *   3. admitting everything that fits, in arrival order with no headroom, causes at least one
 *      auto-preempt;
 *   4. the ghost's run needs at most 50 turns (an iteration where a request is waiting and one of
 *      them fits: `prompt <= memCap - memUsed` and a slot is free);
 *   5. at least one prompt is 768 tokens or longer.
 * `drawSchedTrace(entropy, source)` keeps the first in-band candidate: the entropy itself, then
 * its splitmix32 outputs on each rejection, as `drawPlacementTrace` does.
 *
 * THE PRACTICE MINUTE AND THE BAND. The spec asks the practice minute to be in band too, and the
 * sampled minute cannot be: the busiest minute holds 1,095 requests and none is longer than 692
 * tokens, so rule 5 fails whatever sample is taken, and its responses are mostly 1 to 4 tokens, so
 * a 4,096-token pool never fills (rules 2 and 3); the ghost, FCFS and the no-headroom run all serve
 * 40 of 40 in 40 turns of one request each. The shared practice minute is therefore a pinned fresh
 * minute, as Wave 1's `PLAY_PRACTICE_SEED` is: `SCHED_PRACTICE_MINUTE_SEED` is the first seed from 0
 * whose `makeSchedTrace` passes all five rules, and tests/world/sched-traces.test.ts re-derives it
 * with `firstInBandSeed`. `checkSchedBand` still reports every rule, so a caller can show which
 * ones a minute meets.
 *
 * ACCEPTANCE (measured 2026-10-05, SCHED_CFG.sloTtft = 8): 1.5 % of seeds 0..1,999 are in band
 * (about 67 candidates per fresh minute, about 0.5 ms each with the short-circuit `isInBand`).
 * Rules 2 and 3 do the rejecting (84 % and 71 % of candidates), rule 4 another 39 %, rules 1 and 5
 * under 10 % each. A looser or tighter SLO moves the rate only between 1.0 % (SLO 12) and 2.3 %
 * (SLO 2), so the spec's 20 % target cannot be met by tuning `sloTtft`; see the 2b-01 notes. The
 * draw loop gives up after MAX_DRAWS = 1,024 candidates, which at this rate fails about 2 in 10^7
 * draws. tests/world/sched-traces.test.ts and verify-traces re-measure the rate on 2,000 seeds
 * and fail outside [1 %, 5 %].
 */

import { splitmix32u } from '@/lib/rng'
import {
  Engine,
  HEADROOM_TOKENS,
  makeRefManager,
  referenceScheduler,
  traceToRequestStream,
  type EngineConfig,
  type RequestSpec,
  type SchedAction,
  type SchedView,
  type SchedulerDriver,
  type TraceArtifact,
  type TraceRequest,
} from '@/lib/fleet-model'
import { parseTraceArtifact } from '@/lib/traces'

/** 1024 -> "1,024", without the platform's locale data; the debrief and the source lines share it. */
export const groups = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** Requests per minute, practice and fresh. */
export const SCHED_REQUESTS = 40

/** The scenario: 256 blocks of 16 tokens is the burstgpt Fleet profile's pool (`traces.ts` profiles). */
export const SCHED_CFG: EngineConfig = Object.freeze({
  numBlocks: 256,
  blockSize: 16,
  maxRunning: 8,
  sloTtft: 8,
  prefillChunk: 128,
})

export const BAND = {
  /** The ghost meets the SLO on at least this share of the requests (percent). */
  ghostMetPct: 70,
  /** FCFS meets at least this many fewer than the ghost. */
  fcfsBehind: 3,
  /** The no-headroom run causes at least this many auto-preempts. */
  autoPreempts: 1,
  /** The ghost's run needs at most this many turns. */
  maxTurns: 50,
  /** Some prompt is at least this long. */
  longPrompt: 768,
}

/** Iterations after which a run is abandoned (a prompt that never fits would never finish). */
export const RUN_GUARD = 2000

/** Give up after this many rejected candidates (hitting it means the band no longer fits the generator). */
export const MAX_DRAWS = 1024

/** The two artifacts the traces come from, already parsed (checksums verified by `parseTraceArtifact`). */
export interface SchedSource {
  minute: TraceArtifact
  hour: TraceArtifact
}

/** Parses and cross-checks the two artifacts; the page fetches them, tests and scripts read the files. */
export async function parseSchedSource(minuteRaw: unknown, hourRaw: unknown): Promise<SchedSource> {
  const minute = await parseTraceArtifact(minuteRaw)
  const hour = await parseTraceArtifact(hourRaw)
  if (minute.id !== 'burstgpt-v2-busiest-minute') throw new Error(`not the busiest-minute artifact: ${minute.id}`)
  if (hour.id !== 'burstgpt-v2-busiest-hour') throw new Error(`not the busiest-hour artifact: ${hour.id}`)
  if (minute.requestCount !== SCHED_REQUESTS) throw new Error(`the minute holds ${minute.requestCount} rows, not ${SCHED_REQUESTS}`)
  minuteSourceCount(minute)
  return { minute, hour }
}

/** Fetches both artifacts from the site. */
export async function loadSchedSource(base = '/traces'): Promise<SchedSource> {
  const [minute, hour] = await Promise.all([
    fetch(`${base}/burstgpt-v2-busiest-minute.json`).then((r) => r.json()),
    fetch(`${base}/burstgpt-v2-busiest-hour.json`).then((r) => r.json()),
  ])
  return parseSchedSource(minute, hour)
}

/** How many requests the source minute holds: M in "N of M sampled". */
export function minuteSourceCount(minute: TraceArtifact): number {
  const m = minute.sampling.sourceRowsInWindow
  if (typeof m !== 'number' || !Number.isInteger(m) || m < minute.requestCount) {
    throw new Error('the minute artifact does not record how many requests the source minute holds')
  }
  return m
}

/** The artifact's own line, with both numbers read from it: "40 of 1,095 requests sampled". */
export function minuteSampleLine(minute: TraceArtifact): string {
  return `BurstGPT v2, busiest minute, ${minute.requestCount} of ${groups(minuteSourceCount(minute))} requests sampled`
}

/** The practice minute's source line: its rows come from the busiest hour, its pace from the busiest minute (read from the artifact). */
export function practiceSourceLine(minute: TraceArtifact): string {
  return `${minute.requestCount} requests from BurstGPT v2's busiest hour, arriving at the pace of its busiest minute (${groups(minuteSourceCount(minute))} requests)`
}

export interface SchedTrace {
  id: string
  /** The seed the minute was made from; null only for the artifact's own sampled minute. */
  seed: number | null
  provenance: 'practice' | 'unseen'
  cfg: EngineConfig
  requests: RequestSpec[]
}

/** The busiest-minute artifact's 40 requests as they were sampled. Too gentle for the band (see the header), so not the practice minute. */
export function sampledMinute(source: SchedSource): SchedTrace {
  return {
    id: 't5.sched-sampled-minute',
    seed: null,
    provenance: 'practice',
    cfg: SCHED_CFG,
    requests: traceToRequestStream(source.minute),
  }
}

/** The first seed from 0 whose fresh minute is in band; `SCHED_PRACTICE_MINUTE_SEED` pins its answer. */
export const SCHED_PRACTICE_MINUTE_SEED = 150

/** Arrival gaps of the practice minute, in ticks, in arrival order. */
export function minuteGaps(minute: TraceArtifact): number[] {
  return minute.requests.slice(1).map((row, i) => row.t - minute.requests[i].t)
}

/** A fresh minute for this seed. */
export function makeSchedTrace(source: SchedSource, seed: number): SchedTrace {
  const next = splitmix32u(seed)
  const rows: readonly TraceRequest[] = source.hour.requests
  // 40 distinct rows: a partial Fisher-Yates over the row indices.
  const index = Array.from({ length: rows.length }, (_, i) => i)
  for (let i = 0; i < SCHED_REQUESTS; i++) {
    const j = i + (next() % (rows.length - i))
    const swap = index[i]
    index[i] = index[j]
    index[j] = swap
  }
  const gaps = minuteGaps(source.minute)
  const requests: RequestSpec[] = []
  let arrival = 0
  for (let i = 0; i < SCHED_REQUESTS; i++) {
    if (i > 0) arrival += gaps[next() % gaps.length]
    const row = rows[index[i]]
    requests.push({ id: i + 1, arrival, prompt: row.p, output: row.o })
  }
  return { id: `t5.sched-minute-${(seed >>> 0).toString(16).padStart(8, '0')}`, seed: seed >>> 0, provenance: 'unseen', cfg: SCHED_CFG, requests }
}

/** The shared story: everyone's first run uses this pinned in-band minute, so the debrief has real decisions to find. */
export function practiceMinute(source: SchedSource): SchedTrace {
  return { ...makeSchedTrace(source, SCHED_PRACTICE_MINUTE_SEED), id: 't5.sched-practice-minute', provenance: 'practice' }
}

/** The arrival-order admission rule, `referenceScheduler`'s loop with another order and headroom. */
function admitInOrder(name: string, headroom: number, before: (a: SchedView['waiting'][number], b: SchedView['waiting'][number]) => number): SchedulerDriver {
  return {
    name,
    schedule(v: SchedView): SchedAction {
      let used = v.running.reduce((a, r) => a + r.prompt + r.decoded + headroom, 0)
      let slots = v.maxRunning - v.running.length
      const admit: number[] = []
      for (const r of [...v.waiting].sort(before)) {
        if (slots === 0) break
        const cost = r.prompt + headroom
        if (used + cost > v.memCap) continue
        admit.push(r.id)
        slots -= 1
        used += cost
      }
      return { admit, preempt: [] }
    },
  }
}

const byArrival = (a: SchedView['waiting'][number], b: SchedView['waiting'][number]) => a.arrival - b.arrival || a.id - b.id

/** FCFS with the reference's headroom: the band's "careless order" baseline. */
export const FCFS_DRIVER = admitInOrder('fcfs', HEADROOM_TOKENS, byArrival)
/** Admits everything that fits, in arrival order, with no headroom for decode growth. */
export const GREEDY_DRIVER = admitInOrder('greedy', 0, byArrival)
export const GHOST_DRIVER: SchedulerDriver = { name: 'reference', schedule: referenceScheduler }

export interface SchedRun {
  /** Requests that met the TTFT SLO. */
  met: number
  total: number
  completed: number
  autoPreempts: number
  /** Iterations where a request was waiting and one of them fit. */
  turns: number
  iterations: number
  /** False when the guard ended the run before every request completed. */
  finished: boolean
}

/** Runs a driver over a trace on a fresh Fleet `Engine`, counting turns by the §8.3 rule. */
export function runSched(trace: SchedTrace, driver: SchedulerDriver): SchedRun {
  let turns = 0
  const counting: SchedulerDriver = {
    name: driver.name,
    schedule(v) {
      const room = v.memCap - v.memUsed
      if (v.running.length < v.maxRunning && v.waiting.some((r) => r.prompt <= room)) turns++
      return driver.schedule(v)
    },
  }
  const stream = trace.requests.map((r) => ({ ...r }))
  const engine = new Engine(trace.cfg, stream, counting, makeRefManager(trace.cfg.numBlocks, trace.cfg.blockSize))
  while (!engine.done && engine.tick < RUN_GUARD) engine.step()
  const s = engine.stats()
  return {
    met: s.sloMet,
    total: trace.requests.length,
    completed: s.completed,
    autoPreempts: s.autoPreempts,
    turns,
    iterations: engine.tick,
    finished: engine.done,
  }
}

export interface SchedBandCheck {
  inBand: boolean
  /** Whether each of the five rules holds, in rule order. */
  rules: [boolean, boolean, boolean, boolean, boolean]
  /** One line per rule that fails, in rule order. */
  violations: string[]
  ghost: SchedRun
  fcfs: SchedRun
  greedy: SchedRun
  longestPrompt: number
}

const longestPromptOf = (trace: SchedTrace) => Math.max(...trace.requests.map((r) => r.prompt))
const ghostMeetsSlo = (ghost: SchedRun) => ghost.finished && ghost.met * 100 >= BAND.ghostMetPct * ghost.total
const ghostFitsTurns = (ghost: SchedRun) => ghost.finished && ghost.turns <= BAND.maxTurns

/** Checks the five band rules on a trace. */
export function checkSchedBand(trace: SchedTrace): SchedBandCheck {
  const ghost = runSched(trace, GHOST_DRIVER)
  const fcfs = runSched(trace, FCFS_DRIVER)
  const greedy = runSched(trace, GREEDY_DRIVER)
  const longestPrompt = longestPromptOf(trace)
  const rules: SchedBandCheck['rules'] = [
    ghostMeetsSlo(ghost),
    fcfs.met <= ghost.met - BAND.fcfsBehind,
    greedy.autoPreempts >= BAND.autoPreempts,
    ghostFitsTurns(ghost),
    longestPrompt >= BAND.longPrompt,
  ]
  const why = [
    ghost.finished ? `the ghost meets the SLO on ${ghost.met} of ${ghost.total}` : `the ghost's run does not finish in ${RUN_GUARD} iterations`,
    `FCFS meets ${fcfs.met}, the ghost ${ghost.met}`,
    'no auto-preempt without headroom',
    `the ghost needs ${ghost.turns} turns`,
    `the longest prompt is ${longestPrompt} tokens`,
  ]
  const violations = why.filter((_, i) => !rules[i])
  return { inBand: violations.length === 0, rules, violations, ghost, fcfs, greedy, longestPrompt }
}

/**
 * `checkSchedBand(trace).inBand`, stopping at the first failed rule: the cheap rule first, the ghost's
 * run next, the two baselines last. The draw loop rejects most candidates, so this is what it asks.
 */
export function isInBand(trace: SchedTrace): boolean {
  if (longestPromptOf(trace) < BAND.longPrompt) return false
  const ghost = runSched(trace, GHOST_DRIVER)
  if (!ghostMeetsSlo(ghost) || !ghostFitsTurns(ghost)) return false
  if (runSched(trace, FCFS_DRIVER).met > ghost.met - BAND.fcfsBehind) return false
  return runSched(trace, GREEDY_DRIVER).autoPreempts >= BAND.autoPreempts
}

export interface SchedDraw {
  trace: SchedTrace
  band: SchedBandCheck
  /** Candidates tried, rejected ones included. */
  draws: number
}

/** Turns entropy into an in-band fresh minute: the entropy itself first, then its splitmix32 outputs. */
export function drawSchedTrace(entropy: number, source: SchedSource): SchedDraw {
  const more = splitmix32u(entropy)
  let candidate = entropy >>> 0
  for (let draws = 1; draws <= MAX_DRAWS; draws++) {
    const trace = makeSchedTrace(source, candidate)
    if (isInBand(trace)) return { trace, band: checkSchedBand(trace), draws }
    candidate = more()
  }
  throw new Error(`no in-band minute in ${MAX_DRAWS} draws: the band no longer matches the generator`)
}

/** The first seed from 0 whose minute passes every rule: how `SCHED_PRACTICE_MINUTE_SEED` was found, re-run by the tests. */
export function firstInBandSeed(source: SchedSource): number {
  for (let seed = 0; seed < MAX_DRAWS * 64; seed++) if (isInBand(makeSchedTrace(source, seed))) return seed
  throw new Error('no in-band seed: the band no longer matches the generator')
}

/** Acceptance over seeds 0..n-1: how many candidates are in band, and how many each rule rejects. */
export function measureAcceptance(source: SchedSource, n: number) {
  let inBand = 0
  const rejectedBy = [0, 0, 0, 0, 0]
  for (let seed = 0; seed < n; seed++) {
    const band = checkSchedBand(makeSchedTrace(source, seed))
    if (band.inBand) inBand++
    band.rules.forEach((ok, i) => {
      if (!ok) rejectedBy[i]++
    })
  }
  return { rate: inBand / n, inBand, n, rejectedBy }
}
