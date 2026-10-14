import { beforeAll, describe, expect, test } from 'bun:test'
import {
  REFERENCE_SCHED_SPEC,
  SCHED_DIALS,
  compileSchedPolicy,
  referenceMismatches,
  runSchedGhost,
  runSchedSpec,
  schedComposeOk,
  schedComposeResult,
  schedComposeTable,
  schedEquivalent,
  schedSpecData,
  schedSpecProblems,
} from '../../src/lib/world/sched-policy'
import { SCHED_PRACTICE_MINUTE_SEED, isInBand, makeSchedTrace, parseSchedSource, practiceMinute, runSched, GHOST_DRIVER, type SchedSource, type SchedTrace } from '../../src/lib/world/sched-traces'
import { Engine, makeRefManager, makeRefQueue, referenceScheduler, type SchedAction, type SchedView } from '../../src/lib/fleet-model'
import { policyBaselines, traceFor } from '../../src/lib/fleet-week'
import { deriveSeeds } from '../../src/lib/graded-seed'
import type { SchedPolicySpec } from '../../src/lib/world/types'

const dir = new URL('../../public/traces/', import.meta.url)
let source: SchedSource
beforeAll(async () => {
  source = await parseSchedSource(
    await Bun.file(new URL('burstgpt-v2-busiest-minute.json', dir)).json(),
    await Bun.file(new URL('burstgpt-v2-busiest-hour.json', dir)).json(),
  )
})

/**
 * The first 1,000 in-band seeds of `makeSchedTrace` (seeds 0 to 75,856), as base-36 gaps. Finding
 * them takes about 30 s of rejection sampling, so they are pinned here; the test re-checks that every
 * one is in band and that the first 20 are the generator's first 20, so a change to the band or the
 * generator fails here instead of going stale.
 */
const BANDED_SEEDS = (() => {
  const gaps = [
    '46 50 3e c 2r 1e w 25 3x u 3y 7 2 f 1k 2o 26 13 o v 30 19 1j s y r 2s k 2h 1r 2e 1n j 17 5r 2m 7',
    ' 10 25 8 7 1v a 4 1s 1g x 1o 27 v 7v w 1z 1f s 48 42 2 w 14 2 s 8i 9 67 2n 6 d 2t 45 1i 2s w 7c ',
    '38 94 1q 10 4 1b 10 l l 12 7 57 1y a 4i k 5 10 6x 1l n 1d 33 2n 1e 58 30 1 13 r q i 2g 9 y 9 z 2',
    '2 6c e t t r b p d 1v 64 ao s 13 l 1d i k 8c 3x j 4s 4 9 2r 28 8 1 5h 48 4j 2s 26 50 11 32 18 29',
    ' 2w 1l 3v p e 23 q 2k 1k 1w 4s 2z 2b 2p 1g 11 2l 1y 45 d8 28 i 1l w 8d 5j 1h 3t 4i 2a 2h 6 o 35 ',
    'k 6 7 1n i 18 2i r f 5 3e 3j 2e y 3z o l 2t d 1b 10 i 6i 4 42 h 8 3 1k n 10 d 1p 3y 10 4z 12 14 ',
    '14 3 s 2 1k 3s 2d l 7c 3w 1o 3a x b 50 36 5 15 5 32 13 4d 21 7 26 h t 6b 1o 1b v 11 8 b a 2f 31 ',
    '8k w 8 3z 5v 3s g 3z 4e 1k d 37 4e 53 8c 2y e 1x 7g 8 6k 3m 34 43 2e 4s 4u l j u 8 h 2e 1y 3c 3 ',
    'n 3u 3 3s g 29 1g 1e 35 2 t 1l e v av 2e z 25 5q 36 21 10 11 7 p 6 l 6 c 44 38 9 20 5 u e 3 13 4',
    'k 4s t 1 t 3 2x 1p 3p ca 1e 44 c 9m 5g 1c 2b 2t d 3 5 8 1n 2j x s 3 h 29 1m 1 4 39 1n 2f 1g 5v 1',
    'e 1z j 34 v 5 1x 1e 1q 6n 5n g 1c 3q d 57 1f c 57 1h 28 7 8 45 1v 1s 4m 32 k 1l 1m r 3x 22 15 1m',
    ' 1s 14 u 1j 1 27 4d 1p 4 w 3q r 5n 33 h 1 24 8 m 1j 1x 12 1o h 3n 1c 3f 4x z 2t 1a 4 27 1s 5b 6p',
    ' 2c 17 n 1m d 4 5q 4y g t 4b 17 16 s 2s 1 3r 1m 1f f x y 1x 2d i 14 8 3p 1j u 2 3b 1u 28 1n 17 5',
    ' 10 5t 2r 2j 23 6 p 2 1s g 16 4p 1z 6l 18 k 1t c 2 15 7 f 7d 2v 2 g 1t 1s 5i 1s 1b b 4a 3q 1f 3 ',
    'n o 3c 5p 4r z b u 2n f 1x 1i 18 2n 2c 2k u 2o 1a 1x j 1b 2r m 1i 13 1j 4 2l 64 1q 3 38 n 28 x b',
    ' d 9d l 5 1g 48 3v 17 1d 16 2k 31 49 z m 1f 25 2v i i 4s 68 1l n 3 d 1p t g 19 2k 5j 83 1 3m t 2',
    'l z 29 5z 13 46 15 26 19 2l 1v 9l z 8 3b 1l 9i 1q 1z g s 34 1c 1b 4d i 59 e 1s 25 2f 1s 2x d 15 ',
    'k 2k 5m 20 10 7y 7 1y 33 1 1l 1m 1j 13 59 4m 1s 1b 1x f 1y 16 44 3p w 12 18 6b 7 59 4r 23 2f 39 ',
    '2 82 19 4c 19 3 8s 22 18 46 i 1i 3w 4 1m 3 1f k 3m 20 23 f 5c 2 j b 2r 9 s w c 1p 1r 18 z 3s 38 ',
    'o 3z 7c 1b 4k 42 g 1l k 10 9 1q 1i 7 11 19 d 1e 2g 5c 2b s 1p h k q 2e k 1w h a h 1t 14 1j 26 1l',
    ' 22 2n 15 2n eg 32 20 l 3b 21 b3 1a n m s 11 1 16 5b 6 1c 2b 29 1h 3l 13 h 6h 2h 1u 73 8 2p 8 6 ',
    '3w 14 o b 2g 1a 9m 1t 2m 1h 8 9 o 2s 1k 2n 5 f a 15 h 3t 5q 5 4x 2a 4d 3o 2j 1a 8 1y e k 1m e h ',
    '27 m 6l 59 1z z 3i y 3t 12 4v 2b 5 o 4p 2c 1q 3h 4q 1v 9 4 25 2n 1k 37 y 56 10 q 1i 2s 26 69 12 ',
    '1 f 4i 2e 6 4f 6 20 2d h 2 a 6z 3u h d 2q 2f 30 w 25 2c i 11 5h i a f 2o 2 5 1p u 4k 44 1w 2j 1i',
    ' 3x q 2r 2u 2c 7 11 41 2 3t 1l 1w 2t 7e 1n e 2x 14 4c 6 r 42 18 6 36 2 1k 30 3j 3l 16 46 a 18 h ',
    '2c 5v t 2d 3 1f 5k 1t 22 f 7 19 1y 2j 1i 6 4 2c 4t n 2z 5 4 16 67 2k 1l 25 l 65 2j 3q t 1y o 2r ',
    '58 4y 2d 45 2k 1b 10 l 5o 99 y m 1b 3y 2w 82 1f 7x 22 n g 2 l 14 a l 9 y 12 1w 3t 2 90 8 b s 6 2',
    's 17 5y 1y 2b k q 3p q 51 1l 1k 2y 78 25 37 20',
  ]
    .join('')
    .split(' ')
    .map((g) => parseInt(g, 36))
  let seed = 0
  return gaps.map((g) => (seed += g))
})()
/** The banded seeds other than the practice minute's own: Compose's five fresh minutes are never the practice minute again. */
const FRESH_SEEDS = BANDED_SEEDS.filter((s) => s !== SCHED_PRACTICE_MINUTE_SEED)
/** The suite prints its equivalence and preempt-dial counts only when asked: SCHED_REPORT=1 bun test tests/world/sched-policy.test.ts */
const REPORT = Boolean(process.env.SCHED_REPORT)

/** Fleet Week's engine (fleet-week.ts `CFG` and `simulateEngine`, module-private, copied): pinned to the module below. */
const FLEET_WEEK_CFG = { numBlocks: 256, blockSize: 16, maxRunning: 16, sloTtft: 40, prefillChunk: 128 }
const FLEET_WEEK_REQUESTS = 240

function fleetWeekEngine(seed: number, schedule: (v: SchedView) => SchedAction): Engine {
  const e = new Engine(FLEET_WEEK_CFG, traceFor(deriveSeeds(seed)), { name: 'lockstep', schedule }, makeRefManager(FLEET_WEEK_CFG.numBlocks, FLEET_WEEK_CFG.blockSize), {
    intake: makeRefQueue(32),
    drainPerTick: 8,
  })
  for (let guard = 0; !e.done && guard < 20000; guard++) e.step()
  return e
}

/** Runs the reference and records, at every iteration, whether `driver` returned the identical action. */
function lockstepFleetWeek(seed: number, spec: SchedPolicySpec) {
  const driver = compileSchedPolicy(spec, FLEET_WEEK_CFG.blockSize)
  let iterations = 0
  const mismatches: number[] = []
  const e = fleetWeekEngine(seed, (v) => {
    iterations++
    const ref = referenceScheduler(v)
    if (JSON.stringify(driver.schedule(v)) !== JSON.stringify(ref)) mismatches.push(v.iter)
    return ref
  })
  return { e, iterations, mismatches }
}

const variants = (): SchedPolicySpec[] => [
  { ...REFERENCE_SCHED_SPEC, order: 'fcfs' },
  { ...REFERENCE_SCHED_SPEC, guard: 20 },
  { ...REFERENCE_SCHED_SPEC, headroom: 0 },
  { ...REFERENCE_SCHED_SPEC, headroom: 16 },
  { ...REFERENCE_SCHED_SPEC, headroom: 128 },
  { ...REFERENCE_SCHED_SPEC, preempt: 'newest', headroom: 0 },
]

describe('compileSchedPolicy', () => {
  test('the reference spec is the plan’s {sjf, 2000, 48, none}, and every dial value compiles', () => {
    expect(REFERENCE_SCHED_SPEC).toEqual({ order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' })
    for (const order of SCHED_DIALS.order)
      for (const guard of SCHED_DIALS.guard)
        for (const headroom of SCHED_DIALS.headroom)
          for (const preempt of SCHED_DIALS.preempt) {
            const spec = { order, guard, headroom, preempt }
            expect(schedSpecProblems(spec)).toEqual([])
            expect(compileSchedPolicy(spec).name).toBe(`${order}/guard ${guard}/headroom ${headroom}/preempt ${preempt}`)
          }
  })

  test('a spec off the dials is refused with a reason (ledger rows are untrusted)', () => {
    const bad = { order: 'lifo', guard: 7, headroom: 50, preempt: 'oldest' } as unknown as SchedPolicySpec
    expect(schedSpecProblems(bad)).toHaveLength(4)
    expect(() => compileSchedPolicy(bad)).toThrow('order lifo')
  })

  test('the driver is stateless: the same view gives the same action, and the view is not changed', () => {
    const v: SchedView = {
      iter: 30,
      maxRunning: 8,
      memCap: 4096,
      memUsed: 1024,
      waiting: [
        { id: 4, arrival: 2, prompt: 900 },
        { id: 7, arrival: 5, prompt: 60 },
        { id: 9, arrival: 9, prompt: 60 },
      ],
      running: [{ id: 1, arrival: 0, prompt: 1000, decoded: 3, prefillLeft: 0 }],
    }
    const before = JSON.stringify(v)
    for (const spec of [REFERENCE_SCHED_SPEC, ...variants()]) {
      const d = compileSchedPolicy(spec)
      expect(d.schedule(v)).toEqual(d.schedule(v))
    }
    expect(JSON.stringify(v)).toBe(before)
    // Order: sjf takes the two 60-token prompts first, ties by arrival; fcfs takes arrival order.
    expect(compileSchedPolicy(REFERENCE_SCHED_SPEC).schedule(v).admit).toEqual([7, 9, 4])
    expect(compileSchedPolicy({ ...REFERENCE_SCHED_SPEC, order: 'fcfs' }).schedule(v).admit).toEqual([4, 7, 9])
    // Guard 20: #4 and #7 have waited more than 20 iterations, so they go first, FIFO.
    expect(compileSchedPolicy({ ...REFERENCE_SCHED_SPEC, guard: 20 }).schedule(v).admit).toEqual([4, 7, 9])
    // Headroom: 1,000 + 3 + 128 held for the running request; 900 + 128 and two 60 + 128 fit in 4,096.
    expect(compileSchedPolicy({ ...REFERENCE_SCHED_SPEC, headroom: 128 }).schedule(v).admit).toEqual([7, 9, 4])
  })

  test('preempt newest: when the next decode step would run the pool dry, the newest running request goes, and nothing is admitted', () => {
    // Two decoding requests whose tails are full (1,024 + 1 − 1 = 1,024 held, a multiple of 16) and no free block.
    const v: SchedView = {
      iter: 50,
      maxRunning: 8,
      memCap: 2048,
      memUsed: 2048,
      waiting: [{ id: 9, arrival: 40, prompt: 16 }],
      running: [
        { id: 2, arrival: 3, prompt: 1024, decoded: 1, prefillLeft: 0 },
        { id: 5, arrival: 8, prompt: 1024, decoded: 1, prefillLeft: 0 },
      ],
    }
    const newest = compileSchedPolicy({ ...REFERENCE_SCHED_SPEC, preempt: 'newest' })
    expect(newest.schedule(v)).toEqual({ admit: [], preempt: [5] })
    // A free block per growing request: no pressure, no preempt.
    expect(newest.schedule({ ...v, memCap: 2080 })).toEqual({ admit: [], preempt: [] })
    // The last running request is never preempted.
    expect(newest.schedule({ ...v, running: [v.running[0]], memCap: 1024, memUsed: 1024 }).preempt).toEqual([])
  })
})

describe('the equivalence proof: {sjf, 2000, 48, none} returns referenceScheduler’s SchedAction at every iteration', () => {
  test('the practice minute', () => {
    const t = practiceMinute(source)
    expect(referenceMismatches(t, compileSchedPolicy(REFERENCE_SCHED_SPEC), Infinity)).toEqual([])
    expect(runSchedSpec(REFERENCE_SCHED_SPEC, t)).toEqual(runSchedGhost(t))
  })

  test('the pinned seeds are the generator’s in-band seeds', () => {
    expect(BANDED_SEEDS).toHaveLength(1000)
    expect(new Set(BANDED_SEEDS).size).toBe(1000)
    const first: number[] = []
    for (let seed = 0; first.length < 20; seed++) if (isInBand(makeSchedTrace(source, seed))) first.push(seed)
    expect(BANDED_SEEDS.slice(0, 20)).toEqual(first)
    expect(BANDED_SEEDS[0]).toBe(SCHED_PRACTICE_MINUTE_SEED)
    expect(BANDED_SEEDS[BANDED_SEEDS.length - 1]).toBe(75856)
  })

  test('1,000 banded minutes', () => {
    let iterations = 0
    for (const seed of BANDED_SEEDS) {
      const t = makeSchedTrace(source, seed)
      expect(isInBand(t)).toBe(true)
      const driver = compileSchedPolicy(REFERENCE_SCHED_SPEC)
      const mismatches: number[] = []
      const e = new Engine(t.cfg, t.requests.map((r) => ({ ...r })), {
        name: 'lockstep',
        schedule(v) {
          iterations++
          const ref = referenceScheduler(v)
          if (JSON.stringify(driver.schedule(v)) !== JSON.stringify(ref)) mismatches.push(v.iter)
          return ref
        },
      }, makeRefManager(t.cfg.numBlocks, t.cfg.blockSize))
      while (!e.done) e.step()
      expect(mismatches).toEqual([])
    }
    if (REPORT) console.log(`sched equivalence: 1,000 banded minutes, ${iterations} iterations, 0 mismatches`)
  }, 30000)

  test('100 Fleet Week traces (CFG, the intake queue and its drain)', () => {
    let iterations = 0
    for (let seed = 0; seed < 100; seed++) {
      const run = lockstepFleetWeek(seed, REFERENCE_SCHED_SPEC)
      expect(run.mismatches).toEqual([])
      expect(run.e.done).toBe(true)
      iterations += run.iterations
    }
    if (REPORT) console.log(`sched equivalence: 100 Fleet Week traces, ${iterations} iterations, 0 mismatches`)
  }, 30000)

  test('the copied Fleet Week engine is Fleet Week’s: the reference outcome matches policyBaselines on the same seeds', () => {
    for (const seed of [0, 1, 17, 99]) {
      const e = fleetWeekEngine(seed, referenceScheduler)
      const ref = policyBaselines(deriveSeeds(seed)).reference
      expect({ goodput: e.goodput(FLEET_WEEK_REQUESTS), completed: e.stats().completed, shed: e.stats().shed, ttftP95: e.ttftP95(), queueP95: e.queueP95() }).toEqual(ref)
    }
  })

  test('the proof has teeth: every one-dial change from the reference differs somewhere', () => {
    const traces = [practiceMinute(source), ...FRESH_SEEDS.slice(0, 5).map((s) => makeSchedTrace(source, s))]
    for (const spec of variants()) {
      expect(schedEquivalent(spec, traces)).toBe(false)
    }
    // Fleet Week too: the shortest-first order and the headroom are visible on its traces.
    expect(lockstepFleetWeek(0, { ...REFERENCE_SCHED_SPEC, order: 'fcfs' }).mismatches.length).toBeGreaterThan(0)
    expect(lockstepFleetWeek(0, { ...REFERENCE_SCHED_SPEC, headroom: 16 }).mismatches.length).toBeGreaterThan(0)
  })

  test('guard 0 and guard 2,000 cannot be told apart on a minute: 2,000 iterations never pass inside one (why the dial offers 20)', () => {
    const traces = [practiceMinute(source), ...FRESH_SEEDS.slice(0, 20).map((s) => makeSchedTrace(source, s))]
    expect(schedEquivalent({ ...REFERENCE_SCHED_SPEC, guard: 0 }, traces)).toBe(true)
    for (const t of traces) expect(runSched(t, GHOST_DRIVER).iterations).toBeLessThan(2000)
  })
})

describe('Compose', () => {
  const six = (): SchedTrace[] => [practiceMinute(source), ...FRESH_SEEDS.slice(0, 5).map((s) => makeSchedTrace(source, s))]

  test('the table runs the spec and the ghost on the same traces; the reference spec’s rows are the ghost’s', () => {
    const traces = six()
    const ref = schedComposeTable(REFERENCE_SCHED_SPEC, traces)
    expect(ref.mine.map((r) => r.seed)).toEqual(traces.map((t) => t.seed))
    ref.mine.forEach((row, i) => {
      expect(row.label).toBe('your spec')
      expect(ref.ghost[i].label).toBe('reference')
      expect({ ...row, label: '' }).toEqual({ ...ref.ghost[i], label: '' })
      expect(row.goodputPermille).toBe(Math.round((row.met * 1000) / row.total))
    })
    expect(ref.ghost[0].met).toBe(runSched(traces[0], GHOST_DRIVER).met)
  })

  test('FCFS falls behind the ghost on banded minutes (band rule 2), and no headroom means auto-preempts (rule 3)', () => {
    for (const t of six().slice(1)) {
      expect(runSchedSpec({ ...REFERENCE_SCHED_SPEC, order: 'fcfs' }, t).met).toBeLessThanOrEqual(runSchedGhost(t).met - 3)
      expect(runSchedSpec({ order: 'fcfs', guard: 0, headroom: 0, preempt: 'none' }, t).autoPreempts).toBeGreaterThan(0)
    }
  })

  test('the preempt dial replaces the Engine’s auto-preempts with its own choice', () => {
    let auto = 0
    let chosen = 0
    for (const t of six().slice(1)) {
      auto += runSchedSpec({ order: 'fcfs', guard: 0, headroom: 0, preempt: 'none' }, t).autoPreempts
      chosen += runSchedSpec({ order: 'fcfs', guard: 0, headroom: 0, preempt: 'newest' }, t).autoPreempts
    }
    if (REPORT) console.log(`preempt dial, FCFS without headroom on 5 banded minutes: ${auto} auto-preempts with none, ${chosen} with newest`)
    expect(chosen).toBeLessThan(auto)
  })

  test('ok: equivalent, or at least the ghost’s count on every trace', () => {
    const traces = six()
    expect(schedComposeOk(REFERENCE_SCHED_SPEC, traces)).toEqual({ ok: true, equivalent: true })
    expect(schedComposeOk({ ...REFERENCE_SCHED_SPEC, order: 'fcfs' }, traces)).toEqual({ ok: false, equivalent: false })
  })

  test('the ledger result carries the spec and equivalence (wave-2 §8.4)', () => {
    const r = schedComposeResult(
      { ...REFERENCE_SCHED_SPEC, guard: 20 },
      { ok: false, equivalent: false, survived: 30, ghostSurvived: 40, tries: 3 },
      { seed: 0, provenance: 'practice', kcs: ['t5.sched-order'] },
    )
    expect(r).toEqual({
      playId: 'scheduler',
      score: 0.75,
      ok: false,
      seed: 0,
      provenance: 'practice',
      data: { phase: 'compose', turns: 3, survived: 30, ghostSurvived: 40, spec: { order: 'sjf', guard: 20, headroom: 48, preempt: 'none' }, equivalent: false, kcs: ['t5.sched-order'] },
    })
    expect(schedSpecData(REFERENCE_SCHED_SPEC)).toEqual({ order: 'sjf', guard: 2000, headroom: 48, preempt: 'none' })
  })
})
