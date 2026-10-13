import { beforeAll, describe, expect, test } from 'bun:test'
import {
  BAND,
  FCFS_DRIVER,
  GHOST_DRIVER,
  MAX_DRAWS,
  SCHED_CFG,
  SCHED_REQUESTS,
  checkSchedBand,
  drawSchedTrace,
  isInBand,
  makeSchedTrace,
  measureAcceptance,
  minuteGaps,
  minuteSampleLine,
  minuteSourceCount,
  parseSchedSource,
  practiceMinute,
  runSched,
  type SchedSource,
} from '../../src/lib/world/sched-traces'
import { Engine, makeRefManager, referenceScheduler } from '../../src/lib/fleet-model'

const dir = new URL('../../public/traces/', import.meta.url)
const minuteRaw = await Bun.file(new URL('burstgpt-v2-busiest-minute.json', dir)).json()
const hourRaw = await Bun.file(new URL('burstgpt-v2-busiest-hour.json', dir)).json()
// 2,000 seeds of three engine runs each take about 5 s, bun's default timeout; leave room for a loaded machine.
const TIMEOUT_MS = 60_000
let source: SchedSource
beforeAll(async () => {
  source = await parseSchedSource(minuteRaw, hourRaw)
})

describe('the busiest-minute artifact', () => {
  test('schema 1, 40 rows within one 60 s window at one tick per second, checksummed', () => {
    const m = source.minute
    expect(m.schemaVersion).toBe(1)
    expect(m.requestCount).toBe(SCHED_REQUESTS)
    expect(m.requestSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(m.sampling.windowSeconds).toBe(60)
    expect(m.sampling.secondsPerTick).toBe(1)
    expect(m.requests[0].t).toBeGreaterThanOrEqual(0)
    expect(m.requests[m.requests.length - 1].t).toBeLessThan(60)
  })

  test('a tampered row fails the checksum', async () => {
    const bad = structuredClone(minuteRaw)
    bad.requests[3].p += 1
    await expect(parseSchedSource(bad, hourRaw)).rejects.toThrow('checksum')
  })

  test('the source minute holds more requests than the 40 sampled, and the line reads that from the artifact', () => {
    expect(minuteSourceCount(source.minute)).toBeGreaterThan(SCHED_REQUESTS)
    expect(minuteSampleLine(source.minute)).toBe(
      `BurstGPT v2, busiest minute, 40 of ${source.minute.sampling.sourceRowsInWindow} requests sampled`,
    )
    // Changing only the recorded count changes the line: nothing in it is typed.
    const other = structuredClone(minuteRaw)
    other.sampling.sourceRowsInWindow = 777
    return parseSchedSource(other, hourRaw).then((s) => expect(minuteSampleLine(s.minute)).toBe('BurstGPT v2, busiest minute, 40 of 777 requests sampled'))
  })

  test('an artifact without the count, or with fewer than the rows sampled, is refused', async () => {
    const none = structuredClone(minuteRaw)
    delete none.sampling.sourceRowsInWindow
    await expect(parseSchedSource(none, hourRaw)).rejects.toThrow('how many requests')
    const few = structuredClone(minuteRaw)
    few.sampling.sourceRowsInWindow = 12
    await expect(parseSchedSource(few, hourRaw)).rejects.toThrow('how many requests')
  })

  test('the two artifacts cannot be swapped', async () => {
    await expect(parseSchedSource(hourRaw, hourRaw)).rejects.toThrow('busiest-minute')
    await expect(parseSchedSource(minuteRaw, minuteRaw)).rejects.toThrow('busiest-hour')
  })
})

describe('the practice minute', () => {
  test('is the artifact, one request per row, ids in arrival order', () => {
    const t = practiceMinute(source)
    expect(t.provenance).toBe('practice')
    expect(t.seed).toBeNull()
    expect(t.requests).toHaveLength(SCHED_REQUESTS)
    t.requests.forEach((r, i) => {
      expect(r).toEqual({ id: i + 1, arrival: source.minute.requests[i].t, prompt: source.minute.requests[i].p, output: source.minute.requests[i].o })
    })
  })

  // The spec asks for the practice minute to be in band. The pinned source cannot: its busiest
  // minute has no prompt over 692 tokens and responses of 1 to 4 tokens. This test pins what is
  // true so that a rebuilt artifact, or a band that changes, is reviewed rather than missed.
  test('meets rules 1 and 4 and misses rules 2, 3 and 5, for reasons in the data', () => {
    const band = checkSchedBand(practiceMinute(source))
    expect(band.rules).toEqual([true, false, false, true, false])
    expect(band.ghost).toMatchObject({ met: 40, total: 40, turns: 40, finished: true })
    expect(band.longestPrompt).toBeLessThan(BAND.longPrompt)
    expect(band.greedy.autoPreempts).toBe(0)
    expect(band.fcfs.met).toBe(band.ghost.met)
  })
})

describe('makeSchedTrace', () => {
  test('same seed, same minute; different seeds differ', () => {
    for (const seed of [0, 1, 0x5eed, 0xffffffff]) expect(makeSchedTrace(source, seed)).toEqual(makeSchedTrace(source, seed))
    expect(makeSchedTrace(source, 1)).not.toEqual(makeSchedTrace(source, 2))
  })

  test('40 requests, ids in arrival order from tick 0, gaps from the practice minute, pairs from the hour', () => {
    const gaps = new Set(minuteGaps(source.minute))
    const pairs = new Set(source.hour.requests.map((r) => `${r.p}/${r.o}`))
    for (let seed = 0; seed < 200; seed++) {
      const t = makeSchedTrace(source, seed)
      expect(t.provenance).toBe('unseen')
      expect(t.seed).toBe(seed)
      expect(t.requests).toHaveLength(SCHED_REQUESTS)
      expect(t.requests[0].arrival).toBe(0)
      t.requests.forEach((r, i) => {
        expect(r.id).toBe(i + 1)
        expect(pairs.has(`${r.prompt}/${r.output}`)).toBe(true)
        if (i > 0) expect(gaps.has(r.arrival - t.requests[i - 1].arrival)).toBe(true)
      })
    }
  })

  test('the 40 rows are distinct rows of the hour (a row cannot be drawn twice)', () => {
    // Two hour rows can share a (prompt, output) pair, so count each pair no more often than the hour holds it.
    const held = new Map<string, number>()
    for (const r of source.hour.requests) held.set(`${r.p}/${r.o}`, (held.get(`${r.p}/${r.o}`) ?? 0) + 1)
    for (let seed = 0; seed < 100; seed++) {
      const used = new Map<string, number>()
      for (const r of makeSchedTrace(source, seed).requests) used.set(`${r.prompt}/${r.output}`, (used.get(`${r.prompt}/${r.output}`) ?? 0) + 1)
      for (const [pair, n] of used) expect(n).toBeLessThanOrEqual(held.get(pair) as number)
    }
  })

  test('the minute is not changed by running it', () => {
    const t = makeSchedTrace(source, 7)
    const before = JSON.stringify(t)
    runSched(t, GHOST_DRIVER)
    runSched(t, FCFS_DRIVER)
    expect(JSON.stringify(t)).toBe(before)
  })
})

describe('runSched', () => {
  test('the ghost run is the Fleet Engine under referenceScheduler', () => {
    for (const seed of [3, 11, 42]) {
      const t = makeSchedTrace(source, seed)
      const e = new Engine(SCHED_CFG, t.requests.map((r) => ({ ...r })), { name: 'reference', schedule: referenceScheduler }, makeRefManager(SCHED_CFG.numBlocks, SCHED_CFG.blockSize))
      while (!e.done) e.step()
      const run = runSched(t, GHOST_DRIVER)
      expect(run.met).toBe(e.stats().sloMet)
      expect(run.iterations).toBe(e.tick)
      expect(run.finished).toBe(true)
    }
  })

  test('a turn is an iteration where a request waits and one fits', () => {
    const run = runSched(practiceMinute(source), GHOST_DRIVER)
    // The practice minute: every arrival is admitted the iteration it appears or the next, and the
    // 40 requests need 40 admission turns in 63 iterations.
    expect(run.turns).toBe(40)
    expect(run.iterations).toBe(63)
  })
})

describe('the band', () => {
  // The same 2,000 seeds measureAcceptance runs, so the short-circuit rule order cannot drift from checkSchedBand unseen.
  test('isInBand agrees with checkSchedBand on 2,000 seeds', () => {
    for (let seed = 0; seed < 2000; seed++) {
      const t = makeSchedTrace(source, seed)
      expect(isInBand(t)).toBe(checkSchedBand(t).inBand)
    }
  }, TIMEOUT_MS)

  test('violations name the rules that fail, in order', () => {
    const band = checkSchedBand(practiceMinute(source))
    expect(band.violations).toHaveLength(band.rules.filter((ok) => !ok).length)
    expect(band.violations[band.violations.length - 1]).toContain('longest prompt')
  })

  test('acceptance on 2,000 seeds, reported', () => {
    const n = 2000
    const m = measureAcceptance(source, n)
    console.log(
      `sched band acceptance: ${(m.rate * 100).toFixed(2)} % of ${n} seeds ` +
        `(≈ ${(1 / m.rate).toFixed(0)} candidates per fresh minute; rejected by rule 1-5: ${m.rejectedBy.join(', ')})`,
    )
    // Fails if a change to the band or the generator moves the rate; the draw loop gives up after MAX_DRAWS candidates.
    expect(m.rate).toBeGreaterThan(0.01)
    expect(m.rate).toBeLessThan(0.05)
    expect((1 - m.rate) ** MAX_DRAWS).toBeLessThan(1e-6)
  }, TIMEOUT_MS)
})

describe('drawSchedTrace', () => {
  test('is deterministic per entropy and returns an in-band minute', () => {
    for (const entropy of [0, 1, 0x5eed, 0xdeadbeef]) {
      const a = drawSchedTrace(entropy, source)
      const b = drawSchedTrace(entropy, source)
      expect(a.trace).toEqual(b.trace)
      expect(a.draws).toBe(b.draws)
      expect(a.band.inBand).toBe(true)
      expect(a.band.violations).toEqual([])
      expect(a.band.ghost.met * 100).toBeGreaterThanOrEqual(BAND.ghostMetPct * SCHED_REQUESTS)
      expect(a.band.fcfs.met).toBeLessThanOrEqual(a.band.ghost.met - BAND.fcfsBehind)
      expect(a.band.greedy.autoPreempts).toBeGreaterThanOrEqual(BAND.autoPreempts)
      expect(a.band.ghost.turns).toBeLessThanOrEqual(BAND.maxTurns)
      expect(a.band.longestPrompt).toBeGreaterThanOrEqual(BAND.longPrompt)
      expect(a.trace.provenance).toBe('unseen')
    }
  })

  test('the minute is makeSchedTrace of the first in-band candidate', () => {
    const d = drawSchedTrace(5, source)
    expect(d.trace).toEqual(makeSchedTrace(source, d.trace.seed as number))
    expect(d.draws).toBeGreaterThanOrEqual(1)
    // The first candidate is the entropy itself.
    if (d.draws === 1) expect(d.trace.seed).toBe(5)
  })

  test('different entropy gives different minutes', () => {
    const seeds = new Set([1, 2, 3, 4, 5, 6].map((e) => drawSchedTrace(e, source).trace.seed))
    expect(seeds.size).toBeGreaterThan(3)
  })
})
