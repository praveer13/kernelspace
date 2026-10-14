/**
 * The Fleet Daily (docs/specs/wave-2.md §9.7, task 2b-19): the identity of a day's incident, the flow's pure
 * state, a probe's readings as tables, the share string, and the one `incident` event per date. The flow
 * components take the session and the incident's source as props; the last test plays a whole Daily through
 * them with the fleet host behind a fake worker, the way the page does.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createFleetHost } from '../../src/lib/fleet-host'
import { openIncidentSession, type FleetWorkerLike } from '../../src/lib/fleet-session'
import { FIXES, INCIDENT_FAULTS, PROBE_IDS, generateIncident, burnPercent, type IncidentFault } from '../../src/lib/world/incident-spec'
import { IncidentSession, runExpert } from '../../src/lib/world/incident-sim'
import { readSlots } from '../../src/lib/engine/slots'
import type { EngineSlot } from '../../src/lib/ledger/types'
import {
  DAILY_EPOCH,
  HYPOTHESIS_OPTIONS,
  type InstalledBoxes,
  boxHashes,
  boxLines,
  dailyBoxes,
  dailySlotBytes,
  engineLine,
  ownBoxes,
  ownedBoxCount,
  daysBetween,
  daysFromCivil,
  dailyIncident,
  dailyNumber,
  dailyPlayed,
  dailyRef,
  dailyResult,
  dailySource,
  elapsed,
  kcsFor,
  menuOrderFor,
  observationsOf,
  parseLocalDate,
  probesTaken,
  readingView,
  recordDaily,
  shareString,
  sinceAlert,
  sourceTitle,
  startFlow,
  streetlightOf,
  withFix,
  withHypothesis,
  withProbe,
  withWait,
} from '../../src/lib/world/daily'
import type { FleetReply, FleetRequest } from '../../src/workers/fleet-protocol'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = path.join(import.meta.dir, '../..')

/* ------------------------------------------------------------------ */
/* Identity: the number and the incident of a date                      */
/* ------------------------------------------------------------------ */

describe('the Daily number counts local days from the epoch', () => {
  test('the epoch is #1 and every day after adds one', () => {
    expect(dailyNumber(DAILY_EPOCH)).toBe(1)
    expect(dailyNumber('2026-10-14')).toBe(2)
    expect(dailyNumber('2026-10-23')).toBe(11)
  })

  test('month, year and leap-day boundaries are plain calendar days', () => {
    expect(dailyNumber('2026-10-31', '2026-10-30')).toBe(2)
    expect(dailyNumber('2026-11-01', '2026-10-31')).toBe(2)
    expect(dailyNumber('2027-01-01', '2026-12-31')).toBe(2)
    expect(dailyNumber('2028-03-01', '2028-02-28')).toBe(3) // 2028 is a leap year: the 29th exists
    expect(dailyNumber('2027-03-01', '2027-02-28')).toBe(2) // 2027 is not
    expect(dailyNumber('2100-03-01', '2100-02-28')).toBe(2) // a century year that is not a leap year
    expect(dailyNumber('2027-10-13')).toBe(366) // a full year after the epoch: day 366, no DST or time zone anywhere
  })

  test('days are counted from 1970 the standard way', () => {
    expect(daysFromCivil({ y: 1970, m: 1, d: 1 })).toBe(0)
    expect(daysFromCivil({ y: 2000, m: 3, d: 1 })).toBe(11017)
    expect(daysFromCivil({ y: 1969, m: 12, d: 31 })).toBe(-1)
    expect(daysBetween('2026-10-13', '2026-10-10')).toBe(-3)
    expect(daysBetween('nope', '2026-10-10')).toBeNull()
  })

  test('a date before the epoch, or a malformed one, is #1 rather than zero or negative', () => {
    expect(dailyNumber('2020-01-01')).toBe(1)
    expect(dailyNumber('garbage')).toBe(1)
  })

  test('parseLocalDate takes real calendar dates only', () => {
    expect(parseLocalDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 })
    for (const bad of ['2027-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-1-1', '', '2026-10-13T00:00']) expect(parseLocalDate(bad)).toBeNull()
  })
})

describe('one incident per local date', () => {
  test('is generateIncident(daily, date): the same for everybody on the date, another on the next', () => {
    const a = dailyIncident('2026-10-23')
    expect(a).toEqual(generateIncident('daily', '2026-10-23'))
    expect(a.ns).toBe('daily')
    expect(a.key).toBe('2026-10-23')
    expect(dailyIncident('2026-10-24').seed).not.toBe(a.seed)
    expect(dailySource('2026-10-23')).toEqual({ ns: 'daily', key: '2026-10-23' })
    expect(dailyRef('2026-10-23')).toBe('inc:daily/2026-10-23')
  })

  test('a month of Dailies meets every catalog fault', () => {
    const seen = new Set<IncidentFault>()
    for (let d = 0; d < 30; d++) seen.add(dailyIncident(`2026-11-${String(d + 1).padStart(2, '0')}`).fault)
    expect([...seen].sort()).toEqual([...INCIDENT_FAULTS].sort())
  })

  test('titles: the Daily carries its number, a drill does not', () => {
    expect(sourceTitle(dailySource('2026-10-23'))).toBe('Fleet Daily #11')
    expect(sourceTitle({ ns: 'drill', key: 'ab12cd34' })).toBe('Incident drill')
  })

  test('the hypothesis menu is the four catalog faults then "unsure"', () => {
    expect(HYPOTHESIS_OPTIONS.map((o) => o.id)).toEqual([...INCIDENT_FAULTS, 'unsure'])
  })

  test('the menus a Daily shows are a fixed shuffle of its own seed: the same on every visit, "Unsure" last', () => {
    const spec = dailyIncident('2026-10-23')
    const m = menuOrderFor(spec)
    expect(menuOrderFor(dailyIncident('2026-10-23'))).toEqual(m)
    expect(m.hypotheses.map((o) => o.id).slice(0, -1).sort()).toEqual([...INCIDENT_FAULTS].sort())
    expect(m.hypotheses.at(-1)?.id).toBe('unsure')
    expect([...m.fixes].sort()).toEqual(Object.keys(FIXES).sort())
  })
})

describe('the pinned date of e2e/daily.spec.ts still draws the incident the walk plays', () => {
  test('its constants match generateIncident', () => {
    const spec = readFileSync(path.join(ROOT, 'e2e/daily.spec.ts'), 'utf8')
    const date = /const PINNED_DATE = '([\d-]+)'/.exec(spec)?.[1]
    const fault = /const PINNED_FAULT = '([a-z-]+)'/.exec(spec)?.[1]
    expect(date).toBeDefined()
    expect(dailyIncident(date!).fault).toBe(fault as IncidentFault)
  })
})

/* ------------------------------------------------------------------ */
/* The share string                                                     */
/* ------------------------------------------------------------------ */

describe('the share string', () => {
  test("is 'KS-Daily #N · P probes · burn B%' and carries nothing else", () => {
    expect(shareString(47, 3, 5.4)).toBe('KS-Daily #47 · 3 probes · burn 18%')
    expect(shareString(1, 0, 0)).toBe('KS-Daily #1 · 0 probes · burn 0%')
    expect(shareString(2, 1, 30)).toBe('KS-Daily #2 · 1 probe · burn 100%')
    expect(shareString(47, 3, 5.4)).toMatch(/^KS-Daily #\d+ · \d+ probes? · burn \d+%$/)
  })

  test('burn is the rounded share of the 30 burn-minute budget', () => {
    expect(burnPercent(5.4)).toBe(18)
    expect(shareString(9, 2, 3.207)).toBe('KS-Daily #9 · 2 probes · burn 11%')
  })
})

/* ------------------------------------------------------------------ */
/* The flow                                                             */
/* ------------------------------------------------------------------ */

describe('the flow state', () => {
  const alert = 15
  const probe = (minute: number, ended = false) => ({
    minute,
    category: 'full-shedding' as const,
    readings: { probe: 'errors' as const, window: { from: minute - 10, to: minute }, shed: [], lost: [] },
    ended,
  })

  test('starts at the alert with no hypothesis, and every action advances the clock', () => {
    let s = startFlow(alert, 75)
    expect(s).toMatchObject({ clock: 15, hypothesis: null, log: [], ended: false, fixed: false })
    s = withHypothesis(s, 'drain-stall')
    expect(s.clock).toBe(15) // a hypothesis costs no time
    s = withProbe(s, 'intake', probe(17))
    expect(elapsed(s)).toBe(2)
    s = withWait(s, { minute: 18, ended: false })
    s = withFix(s, 'restore-pool', { minute: 23, effective: false, ended: false })
    expect(elapsed(s)).toBe(8)
    expect(s.fixed).toBe(false)
    s = withFix(s, 'restore-drain', { minute: 24, effective: true, ended: false })
    expect(s.fixed).toBe(true)
    expect(s.log.map((e) => e.kind)).toEqual(['probe', 'wait', 'fix', 'fix'])
    expect(probesTaken(s)).toEqual(['intake'])
  })

  test('the first fix, right or wrong, locks the hypothesis held at that moment; a later revision is refused (F1)', () => {
    let s = withHypothesis(startFlow(alert, 75), 'drain-stall')
    expect(s.hypothesisAtFix).toBeNull()
    s = withHypothesis(s, 'pool-shrink') // revisable until a fix goes in
    expect(s.hypothesis).toBe('pool-shrink')
    s = withFix(s, 'restore-drain', { minute: 21, effective: false, ended: false })
    expect(s.hypothesisAtFix).toBe('pool-shrink')
    const revised = withHypothesis(s, 'drain-stall')
    expect(revised).toBe(s) // refused: nothing about the state changes
    s = withFix(s, 'restore-pool', { minute: 22, effective: true, ended: false })
    expect(s.hypothesisAtFix).toBe('pool-shrink')
    expect(s.hypothesis).toBe('pool-shrink')
  })

  test('the fixed flag stays set once the right fix went in, and ended comes from the last reply', () => {
    let s = withFix(startFlow(alert, 75), 'restore-drain', { minute: 16, effective: true, ended: false })
    s = withWait(s, { minute: 21, ended: true })
    expect(s).toMatchObject({ fixed: true, ended: true, clock: 21 })
  })

  test('transitions do not mutate the state they were given', () => {
    const s = startFlow(alert, 75)
    withProbe(s, 'errors', probe(17))
    expect(s.log).toEqual([])
    expect(s.clock).toBe(15)
  })

  test('clock minutes read against the alert', () => {
    expect(sinceAlert(27, 15)).toBe('+12 min')
    expect(sinceAlert(15, 15)).toBe('+0 min')
    expect(sinceAlert(12, 15)).toBe('−3 min')
  })

  test('Streetlight is flagged per probe, from what had been seen before it', () => {
    // errors "shed" first: only drain-stall fits, so the probes after it cannot split anything
    let s = startFlow(alert, 75)
    s = withProbe(s, 'errors', { ...probe(17), category: 'shed' })
    s = withProbe(s, 'intake', { ...probe(19), category: 'full-shedding' })
    expect(observationsOf(s)).toEqual([
      { probe: 'errors', category: 'shed' },
      { probe: 'intake', category: 'full-shedding' },
    ])
    expect(streetlightOf(s)).toEqual([false, true])
  })
})

/* ------------------------------------------------------------------ */
/* Readings as sparklines and tables                                    */
/* ------------------------------------------------------------------ */

describe('readingView turns every probe into series and tables that agree', () => {
  for (const fault of INCIDENT_FAULTS) {
    test(`${fault}: all six probes`, () => {
      const spec = [...Array(400).keys()].map((i) => generateIncident('drill', `daily-view-${i}`)).find((s) => s.fault === fault)!
      const session = new IncidentSession(spec)
      for (const id of PROBE_IDS) {
        const r = session.probe(id)
        const view = readingView(r.readings, session.alertMinute)
        const minutes = r.readings.window.to - r.readings.window.from
        expect(view.probe).toBe(id)
        expect(view.series.length).toBeGreaterThan(0)
        for (const s of view.series) {
          expect(s.values.length).toBe(minutes)
          expect(s.values.every((v) => Number.isFinite(v))).toBe(true)
        }
        const [byMinute] = view.tables
        expect(byMinute.rows.length).toBe(minutes)
        expect(byMinute.columns.length).toBe(view.series.length + 1)
        for (const row of byMinute.rows) expect(row.length).toBe(byMinute.columns.length)
        // the last row is "now"
        expect(byMinute.rows[byMinute.rows.length - 1][0]).toBe(sinceAlert(r.readings.window.to, session.alertMinute))
      }
    })
  }

  test('a worker that is down reads "—" in the table and plots as zero', () => {
    const spec = [...Array(400).keys()].map((i) => generateIncident('drill', `daily-down-${i}`)).find((s) => s.fault === 'node-death')!
    const session = new IncidentSession(spec)
    const r = session.probe('intake')
    const view = readingView(r.readings, session.alertMinute)
    const downs = view.series.flatMap((s) => s.down?.filter(Boolean) ?? [])
    expect(downs.length).toBeGreaterThan(0)
    expect(JSON.stringify(view.tables[0].rows)).toContain('—')
  })

  test('the latency reading adds the split by prompt length and tenant', () => {
    const spec = dailyIncident('2026-10-14') // tenant-burst
    const session = new IncidentSession(spec)
    const view = readingView(session.probe('latency').readings, session.alertMinute)
    expect(view.tables.length).toBe(2)
    expect(view.tables[1].columns).toEqual(['prompt', 'tenant', 'requests', 'TTFT p95', 'TPOT p95'])
    expect(view.tables[1].rows.length).toBeGreaterThan(0)
  })
})

/* ------------------------------------------------------------------ */
/* The page-safe split                                                  */
/* ------------------------------------------------------------------ */

describe('world/daily.ts stays page-safe and deterministic', () => {
  const src = readFileSync(path.join(ROOT, 'src/lib/world/daily.ts'), 'utf8')

  test('it imports nothing from the engine (fleet-model, incident-sim)', () => {
    for (const m of src.matchAll(/^(?:import|export)\s+(type\s+)?[^;'"]*?\s*from\s+'([^']+)'/gm)) {
      if (m[1]) continue
      expect(m[2]).not.toMatch(/fleet-model|incident-sim/)
    }
  })

  test('it reads no clock and no randomness: the page hands it the date', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\bDate\b|Math\.random|performance\.now|new Intl/)
  })

  test('the flow components load no engine either', () => {
    for (const f of ['Alert', 'Hypothesis', 'ProbeBar', 'FixMenu', 'Debrief', 'ShareString', 'DailyCard']) {
      const file = path.join(ROOT, 'src/components/daily', `${f}.tsx`)
      expect(existsSync(file)).toBe(true)
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/^import\s+(type\s+)?[^;'"]*?\s*from\s+'([^']+)'/gm)) {
        if (m[1]) continue
        expect(m[2]).not.toMatch(/fleet-model|incident-sim|fleet-host/)
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* Recording: once per date                                             */
/* ------------------------------------------------------------------ */

const finished = (over: Partial<Parameters<typeof dailyResult>[2]> = {}): Parameters<typeof dailyResult>[2] => ({
  fault: 'pool-shrink',
  severity: 1,
  firstHypothesis: 'unsure',
  hypothesis: 'pool-shrink',
  probes: ['intake', 'kv'],
  fix: 'restore-pool',
  diagnosed: true,
  fixed: true,
  burn: 5.4,
  expertBurn: 4.4,
  streetlight: 1,
  ...over,
})

describe('the Daily writes one incident event per date', () => {
  const date = '2026-10-23'
  const spec = dailyIncident(date)

  test('the event is the Daily ref with the date, public seed and the incident KCs, and shares no components', () => {
    const r = dailyResult(date, spec, finished())
    expect(r.ref).toBe('inc:daily/2026-10-23')
    expect(r.seed).toBe(spec.seed)
    expect(r.data).toMatchObject({ v: 1, src: 'daily', date, fault: 'pool-shrink', components: [], diagnosed: true, fixed: true, burn: 5.4, expertBurn: 4.4 })
    expect(r.data.kcs).toEqual(kcsFor('pool-shrink'))
    expect(r.data.kcs).toEqual(['t7.incident-diagnosis', 't5.kv-capacity'])
  })

  test('optional fields stay out of the event when the learner never set them', () => {
    const { data } = dailyResult(date, spec, finished({ firstHypothesis: undefined, hypothesis: undefined, fix: undefined, diagnosed: false, fixed: false }))
    expect('firstHypothesis' in data).toBe(false)
    expect('hypothesis' in data).toBe(false)
    expect('fix' in data).toBe(false)
  })

  test('the first completed attempt writes; a replay, a second call and a reload write nothing', async () => {
    const profile = makeProfile()
    const tab = startTab(profile)
    const store = tab.progress
    expect(dailyPlayed(store, date)).toBe(false)
    expect(recordDaily(store, date, spec, finished())).toBe(true)
    expect(dailyPlayed(store, date)).toBe(true)
    const incidents = store.getState().aggregate.incidents
    expect(incidents[dailyRef(date)]?.n).toBe(1)
    expect(store.getState().aggregate.dailyDays[date]).toBe(true)

    // a replay the same day is practice: no second event
    expect(recordDaily(store, date, spec, finished({ burn: 3 }))).toBe(false)
    expect(store.getState().aggregate.incidents[dailyRef(date)]?.n).toBe(1)

    // another tab on the same profile, after a flush, already knows
    await store.controls.flush()
    const second = startTab(profile).progress
    expect(dailyPlayed(second, date)).toBe(true)
    expect(recordDaily(second, date, spec, finished())).toBe(false)
    expect(second.getState().aggregate.incidents[dailyRef(date)]?.n).toBe(1)

    // the next date is its own Daily
    expect(recordDaily(store, '2026-10-24', dailyIncident('2026-10-24'), finished())).toBe(true)
  })

  test('a first attempt that did not diagnose or fix still counts as the date\'s attempt, graded not ok', () => {
    const store = startTab(makeProfile()).progress
    expect(recordDaily(store, date, spec, finished({ diagnosed: false, fixed: false, burn: 30 }))).toBe(true)
    const inc = store.getState().aggregate.incidents[dailyRef(date)]
    expect(inc?.n).toBe(1)
    expect(inc?.okAt).toBeFalsy()
    expect(store.getState().aggregate.dailyDays[date]).toBeUndefined()
    expect(recordDaily(store, date, spec, finished())).toBe(false) // a later good run is practice
  })
})

/* ------------------------------------------------------------------ */
/* A whole Daily through the session, as the page plays it              */
/* ------------------------------------------------------------------ */

class FakeWorker implements FleetWorkerLike {
  onmessage: FleetWorkerLike['onmessage'] = null
  onerror: FleetWorkerLike['onerror'] = null
  private terminated = false
  private readonly host = createFleetHost()
  constructor() {
    queueMicrotask(() => this.deliver({ type: 'boot' }))
  }
  private deliver(reply: FleetReply) {
    if (!this.terminated) this.onmessage?.({ data: reply })
  }
  postMessage(msg: FleetRequest) {
    if (this.terminated) return
    setTimeout(() => void this.host.handle(msg, (reply) => this.deliver(reply)), 0)
  }
  terminate() {
    this.terminated = true
  }
}

describe('a Daily played through the session records once and scores like the expert', () => {
  test('the expert\'s log, driven through the flow transitions, then recorded', async () => {
    const date = '2026-10-23' // the pinned e2e date: pool-shrink
    const spec = dailyIncident(date)
    const expert = runExpert(spec)
    const session = await openIncidentSession({ mode: 'incident', spec, slots: { sched: null, mgr: null, queue: null } }, { spawn: () => new FakeWorker() })
    let flow = startFlow(session.alert, session.limit)
    for (const a of expert.actions) {
      if (a.kind === 'hypothesis') {
        await session.hypothesis(a.fault)
        flow = withHypothesis(flow, a.fault)
      } else if (a.kind === 'probe') {
        flow = withProbe(flow, a.probe, await session.probe(a.probe))
      } else if (a.kind === 'fix') {
        const reply = await session.fix(a.fix)
        flow = withFix(flow, a.fix, reply)
        expect(reply.effective).toBe(true)
      } else {
        flow = withWait(flow, await session.wait())
      }
    }
    expect(flow.fixed).toBe(true)
    expect(probesTaken(flow)).toEqual(expert.outcome.probes)
    expect(streetlightOf(flow).filter(Boolean).length).toBe(expert.outcome.streetlight)

    const done = await session.finish()
    expect(done.burn).toBe(expert.outcome.burn)
    expect(done.expertBurn).toBe(done.burn)
    expect(done.probes.length).toBe(probesTaken(flow).length)

    const store = startTab(makeProfile()).progress
    expect(recordDaily(store, date, spec, done)).toBe(true)
    expect(store.getState().aggregate.dailyDays[date]).toBe(true)
    expect(recordDaily(store, date, spec, done)).toBe(false)
    expect(shareString(dailyNumber(date), done.probes.length, done.burn)).toMatch(/^KS-Daily #11 · \d+ probes? · burn \d+%$/)
    session.close()
  }, 60_000)
})

/* ------------------------------------------------------------------ */
/* Boxes count only when they drive the run and their bytes are here    */
/* ------------------------------------------------------------------ */

describe('the boxes the Daily claims are the boxes that ran (F6, 2b-21)', () => {
  const at = '2026-10-05T09:00:00.000Z'
  const bytesOf = (n: number): ArrayBuffer => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, n]).buffer as ArrayBuffer
  const sha = (c: string) => c.repeat(64)
  const entry = (sha256: string, labId: string) => ({ sha256, labId, version: 3, at })

  /** A device whose `engine:slots` names modules, of which only those in `held` have their bytes (an import can carry the record and not the bytes). */
  async function device(slots: Record<string, { sha256: string; labId: string }>, held: Record<string, ArrayBuffer>) {
    const tab = startTab(
      makeProfile({
        seed: {
          components: Object.values(slots).map((s) => ({ sha256: s.sha256, labId: s.labId, size: 9, addedAt: at, ...(held[s.sha256] ? { bytes: held[s.sha256] } : {}) })),
          working: [{ key: 'engine:slots', value: Object.fromEntries(Object.entries(slots).map(([slot, s]) => [slot, entry(s.sha256, s.labId)])), at, dev: 'd' }],
        },
      }),
    )
    const engine = await tab.progress.controls.engine()
    return { tab, named: readSlots(tab.progress.getState().working['engine:slots']), readBytes: (h: string) => engine.componentBytes(h) }
  }

  test('a slot named in engine:slots without its bytes is not counted: the Daily would run the reference', async () => {
    const d = await device(
      { scheduler: { sha256: sha('a'), labId: 'batching-scheduler' }, 'block-manager': { sha256: sha('b'), labId: 'kv-block-manager' }, intake: { sha256: sha('c'), labId: 'mpmc-queue' } },
      { [sha('a')]: bytesOf(1) },
    )
    expect(Object.keys(d.named)).toEqual(['scheduler', 'block-manager', 'intake'])
    // counted by name alone, all three would have been "yours"; only one has bytes and only one runs
    expect(await ownedBoxCount(d.named, d.readBytes)).toBe(1)
    expect(await ownedBoxCount({}, d.readBytes)).toBe(0)
    // and the page agrees: the same device's boxes name one as yours
    const installed: InstalledBoxes = {}
    for (const [slot, e] of Object.entries(d.named)) installed[slot as EngineSlot] = { sha256: e.sha256, labId: e.labId, bytes: await d.readBytes(e.sha256) }
    expect(ownBoxes(dailyBoxes(installed)).map((b) => b.slot)).toEqual(['scheduler'])
    expect(engineLine(await ownedBoxCount(d.named, d.readBytes))).toBe('your engine: 1 of 3 boxes')
  })

  test('with every driving slot held all three count, and a prefix router beside them does not', async () => {
    const d = await device(
      {
        scheduler: { sha256: sha('a'), labId: 'batching-scheduler' },
        'block-manager': { sha256: sha('b'), labId: 'kv-block-manager' },
        intake: { sha256: sha('c'), labId: 'mpmc-queue' },
        'prefix-router': { sha256: sha('d'), labId: 'radix-cache' },
      },
      { [sha('a')]: bytesOf(1), [sha('b')]: bytesOf(2), [sha('c')]: bytesOf(3), [sha('d')]: bytesOf(4) },
    )
    expect(await ownedBoxCount(d.named, d.readBytes)).toBe(3)
    expect(engineLine(3)).toBe('your engine: 3 of 3 boxes')
  })

  test('a prefix router alone: not counted, not "on my engine", not in the event, and not loaded', async () => {
    const router: InstalledBoxes = { 'prefix-router': { sha256: sha('d'), labId: 'radix-cache', bytes: bytesOf(4) } }
    const d = await device({ 'prefix-router': { sha256: sha('d'), labId: 'radix-cache' } }, { [sha('d')]: bytesOf(4) })
    expect(await ownedBoxCount(d.named, d.readBytes)).toBe(0)

    const boxes = dailyBoxes(router)
    expect(ownBoxes(boxes)).toEqual([])
    expect(boxHashes(boxes)).toEqual([])
    // the share string asks `ownBoxes(boxes).length > 0`: the router adds nothing to it
    expect(shareString(11, 1, 5.4, ownBoxes(boxes).length > 0)).not.toContain('on my engine')
    // the debrief still tells the learner what happened to the router they installed
    expect(boxes.map((b) => b.slot)).toEqual(['scheduler', 'block-manager', 'intake', 'prefix-router'])
    expect(boxLines(boxes)[3]).toBe('prefix router: not used (incident clusters route by shortest queue)')

    const date = '2026-10-23'
    expect(dailyResult(date, dailyIncident(date), finished(), boxHashes(boxes)).data.components).toEqual([])
    // the router's bytes never reach the incident session: a router that would fail to load cannot fail a Daily it takes no part in
    expect(dailySlotBytes(router).router).toBeNull()
    const garbage: InstalledBoxes = { 'prefix-router': { sha256: sha('e'), labId: 'radix-cache', bytes: new Uint8Array([1, 2, 3]).buffer as ArrayBuffer } }
    const session = await openIncidentSession({ mode: 'incident', spec: dailyIncident(date), slots: dailySlotBytes(garbage) }, { spawn: () => new FakeWorker() })
    expect(session.alert).toBeGreaterThan(0)
    session.close()
  })

  test('a router beside a scheduler of yours: only the scheduler is counted, shared and recorded', () => {
    const inst: InstalledBoxes = {
      scheduler: { sha256: sha('a'), labId: 'batching-scheduler', bytes: bytesOf(1) },
      'prefix-router': { sha256: sha('d'), labId: 'radix-cache', bytes: bytesOf(4) },
    }
    const boxes = dailyBoxes(inst)
    expect(ownBoxes(boxes).map((b) => b.slot)).toEqual(['scheduler'])
    expect(boxHashes(boxes)).toEqual([sha('a')])
    expect(shareString(11, 1, 5.4, ownBoxes(boxes).length > 0)).toMatch(/ · on my engine$/)
    const date = '2026-10-23'
    expect(dailyResult(date, dailyIncident(date), finished(), boxHashes(boxes)).data.components).toEqual([sha('a')])
    // a run on the reference engine (the fallback, or a choice) names no router either
    expect(dailyBoxes(inst, true).map((b) => b.slot)).toEqual(['scheduler', 'block-manager', 'intake'])
  })
})
