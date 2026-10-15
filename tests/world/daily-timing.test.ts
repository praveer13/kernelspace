/**
 * The Daily's time (task EF1; docs/specs/wave-3.md §15.1, the journey re-cut): the page measures the attempt's visible
 * time from the alert to the end of the flow and passes it in, `dailyResult` keeps it as the `incident` event's `ms`
 * (whole milliseconds, capped at `INCIDENT_MAX_MS`), and the façade writes it. Before EF1 no Daily event carried `ms`,
 * so F1's instrument read 0 minutes for the Daily on every real ledger.
 *
 * The visible clock (`src/hooks/use-visible-clock.ts`) counts only while the page is visible: a tab left open in the
 * background adds nothing. It is tested here on an injected clock and visibility.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { visibleClock, type VisibleClockEnv } from '../../src/hooks/use-visible-clock'
import { DAILY_MINUTES, INCIDENT_MAX_MS, dailyIncident, dailyResult, recordDaily, recordedMs, type FinishedIncident } from '../../src/lib/world/daily'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = path.join(import.meta.dir, '../..')
const DATE = '2026-10-20'
const done: FinishedIncident = { fault: 'pool-shrink', severity: 2, probes: ['kv'], diagnosed: true, fixed: true, burn: 6, expertBurn: 4, streetlight: 0 }

/** A page whose clock and visibility the test moves. */
function fakePage(hidden = false) {
  let now = 1000
  let isHidden = hidden
  const listeners = new Set<() => void>()
  const env: VisibleClockEnv = {
    now: () => now,
    hidden: () => isHidden,
    watch: (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
  }
  return {
    env,
    listeners,
    advance: (ms: number) => {
      now += ms
    },
    setHidden: (h: boolean) => {
      isHidden = h
      for (const f of listeners) f()
    },
  }
}

describe('the visible clock counts only while the page is visible', () => {
  test('time behind other tabs adds nothing; visible time on either side of it does', () => {
    const page = fakePage()
    const clock = visibleClock(page.env)
    page.advance(30_000)
    expect(clock.read()).toBe(30_000)
    page.setHidden(true)
    page.advance(3 * 3_600_000) // an evening in another tab
    expect(clock.read()).toBe(30_000)
    page.setHidden(false)
    page.advance(15_000)
    expect(clock.read()).toBe(45_000)
  })

  test('a page that opens hidden starts counting when it is shown, and a dispose stops the clock and its listener', () => {
    const page = fakePage(true)
    const clock = visibleClock(page.env)
    page.advance(60_000)
    expect(clock.read()).toBe(0)
    page.setHidden(false)
    page.advance(5_000)
    clock.dispose()
    expect(page.listeners.size).toBe(0)
    page.advance(60_000)
    expect(clock.read()).toBe(5_000)
  })

  test('a clock that steps back never takes time away', () => {
    const page = fakePage()
    const clock = visibleClock(page.env)
    page.advance(10_000)
    expect(clock.read()).toBe(10_000)
    page.advance(-4_000)
    expect(clock.read()).toBe(10_000)
  })
})

describe('dailyResult carries the attempt\'s time', () => {
  test('whole milliseconds within [0, INCIDENT_MAX_MS], and no ms at all without a finite measurement', () => {
    expect(INCIDENT_MAX_MS).toBe(4 * DAILY_MINUTES * 60_000)
    const spec = dailyIncident(DATE)
    expect(dailyResult(DATE, spec, done, [], 312_400.6).ms).toBe(312_401)
    expect(dailyResult(DATE, spec, done, [], 5 * 3_600_000).ms).toBe(INCIDENT_MAX_MS)
    expect(dailyResult(DATE, spec, done, [], -20).ms).toBe(0)
    for (const none of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect('ms' in dailyResult(DATE, spec, done, [], none)).toBe(false)
    expect(recordedMs(Number.NEGATIVE_INFINITY, 10)).toBeUndefined()
    // everything else is as before
    expect(dailyResult(DATE, spec, done, ['a'.repeat(64)], 1000)).toEqual({ ...dailyResult(DATE, spec, done, ['a'.repeat(64)]), ms: 1000 })
  })

  test('recordDaily writes the event with its ms through the façade, once per date', async () => {
    const tab = startTab(makeProfile({ ms: Date.parse(`${DATE}T09:00:00.000Z`) }))
    const store = tab.progress
    expect(recordDaily(store, DATE, dailyIncident(DATE), done, [], 7 * 60_000)).toBe(true)
    expect(recordDaily(store, DATE, dailyIncident(DATE), done, [], 60_000)).toBe(false)
    await store.controls.flush()
    const events = (await (await tab.engine()).events()) as LedgerEvent[]
    const daily = events.filter((e) => e.kind === 'incident')
    expect(daily).toHaveLength(1)
    expect(daily[0]).toMatchObject({ ref: `inc:daily/${DATE}`, ms: 7 * 60_000, provenance: 'practice' })
  })
})

describe('the Daily page measures from the alert to the end of the flow', () => {
  const page = readFileSync(path.join(ROOT, 'src/pages/Daily.tsx'), 'utf8')

  test('it marks the visible clock when the alert shows and passes the difference when the debrief is ready', () => {
    expect(page).toContain("import { useVisibleClock } from '@/hooks/use-visible-clock'")
    expect(page).toMatch(/setPhase\('play'\)\s+alertAt\.current = visible\(\)/)
    expect(page).toContain('const ms = alertAt.current === null ? undefined : visible() - alertAt.current')
    expect(page).toContain('recordDaily(useProgress, date, spec, result, boxHashes(boxes), ms)')
    // a restart forgets the last attempt's mark
    expect(page).toMatch(/function restart[\s\S]{0,120}alertAt\.current = null/)
  })

  test('world/daily reads no clock: the time arrives as a number', () => {
    const src = readFileSync(path.join(ROOT, 'src/lib/world/daily.ts'), 'utf8')
    for (const banned of ['Date.now', 'new Date(', 'performance.now']) expect(src).not.toContain(banned)
  })
})
