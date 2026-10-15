/**
 * Season 0 (docs/specs/wave-3.md §16.7, task 3s-09): seven consecutive dates, the Daily's header on them, and the /me
 * card of your own results and share strings read from the ledger. The dates and rows are pure; the ledger half writes
 * real Daily events through the façade (`recordDaily`) and reads them back the way the card does. The card and the
 * Daily's header are mounted with tests/dom/mini-dom.ts. What a browser alone can answer (reflow, contrast, the Tab
 * walk) stays with the a11y harness.
 */
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import {
  SEASON0_DAYS,
  SEASON0_START,
  season0Dates,
  season0Day,
  season0Header,
  season0Outcome,
  season0Rows,
  season0State,
  type Season0Row,
} from '../../src/data/season0'
import type { IncidentEvent, LedgerEvent } from '../../src/lib/ledger/types'
import { DAILY_EPOCH, dailyIncident, dailyNumber, recordDaily, shareString } from '../../src/lib/world/daily'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'
import { makeProfile, startTab } from '../ledger/env'

const src = (f: string) => readFileSync(join(import.meta.dir, '../..', f), 'utf8')

/* ------------------------------------------------------------------ */
/* The seven dates                                                      */
/* ------------------------------------------------------------------ */

describe('Season 0 is seven consecutive dates starting on a Monday', () => {
  test('the start is a Monday, on or after the Daily epoch, and the season is seven days', () => {
    const [y, m, d] = SEASON0_START.split('-').map(Number)
    expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(1)
    expect(SEASON0_START >= DAILY_EPOCH).toBe(true)
    expect(SEASON0_DAYS).toBe(7)
  })

  test('the dates run Monday to Sunday with no gap, across a month end, a year end and a leap day', () => {
    expect(season0Dates()).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    expect(season0Dates('2026-10-26')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
    expect(season0Dates('2026-12-28')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
    expect(season0Dates('2028-02-28')).toContain('2028-02-29')
    expect(new Set(season0Dates()).size).toBe(7)
  })

  test('each date is its own Daily: seven different incidents and seven consecutive Daily numbers', () => {
    const dates = season0Dates()
    expect(dates.map((d) => dailyNumber(d))).toEqual([7, 8, 9, 10, 11, 12, 13])
    expect(new Set(dates.map((d) => dailyIncident(d).seed)).size).toBe(7)
  })

  test('the day of the season is 1 to 7 on those dates and nothing before or after, or for a malformed date', () => {
    expect(season0Dates().map((d) => season0Day(d))).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(season0Day('2026-10-18')).toBeNull()
    expect(season0Day('2026-10-26')).toBeNull()
    expect(season0Day('2026-02-30')).toBeNull()
    expect(season0Day('not a date')).toBeNull()
  })

  test("the header reads 'Season 0 · day k of 7'", () => {
    expect(season0Header(1)).toBe('Season 0 · day 1 of 7')
    expect(season0Header(7)).toBe('Season 0 · day 7 of 7')
  })
})

/* ------------------------------------------------------------------ */
/* Your results, from the ledger                                        */
/* ------------------------------------------------------------------ */

const finished = (over: Partial<Parameters<typeof recordDaily>[3]> = {}): Parameters<typeof recordDaily>[3] => ({
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

/** A ledger with: day 1 fixed (2 probes), day 3 missed with 3 probes on one of your boxes, a Daily outside the season, and a drill. */
async function fixtureEvents(): Promise<LedgerEvent[]> {
  const tab = startTab(makeProfile())
  const store = tab.progress
  expect(recordDaily(store, '2026-10-19', dailyIncident('2026-10-19'), finished())).toBe(true)
  expect(recordDaily(store, '2026-10-21', dailyIncident('2026-10-21'), finished({ diagnosed: false, fixed: false, burn: 30, probes: ['a', 'b', 'c'] }), ['a'.repeat(64)])).toBe(true)
  expect(recordDaily(store, '2026-10-26', dailyIncident('2026-10-26'), finished())).toBe(true) // the Monday after the season
  expect(recordDaily(store, '2026-10-18', dailyIncident('2026-10-18'), finished())).toBe(true) // the Sunday before
  await store.controls.flush()
  return (await tab.engine()).events()
}

describe('the card lists your own results and the Daily\'s own share strings', () => {
  test('one row per date, in order; a played date carries the recomputed share string, an unplayed one carries none', async () => {
    const rows = season0Rows(await fixtureEvents())
    expect(rows.map((r) => [r.day, r.date, r.result !== null])).toEqual([
      [1, '2026-10-19', true],
      [2, '2026-10-20', false],
      [3, '2026-10-21', true],
      [4, '2026-10-22', false],
      [5, '2026-10-23', false],
      [6, '2026-10-24', false],
      [7, '2026-10-25', false],
    ])
    // the string the debrief offered: shareString(number, probes, burn, onMyEngine), identical to the byte
    expect(rows[0].result?.share).toBe(shareString(dailyNumber('2026-10-19'), 2, 5.4, false))
    expect(rows[0].result?.share).toBe('KS-Daily #7 · 2 probes · burn 18%')
    expect(rows[2].result?.share).toBe(shareString(dailyNumber('2026-10-21'), 3, 30, true))
    expect(rows[2].result?.share).toBe('KS-Daily #9 · 3 probes · burn 100% · on my engine')
  })

  test('the string carries no hash, seed or component name, even for a run on your own engine', async () => {
    const rows = season0Rows(await fixtureEvents())
    expect(rows[2].result?.share).not.toMatch(/[0-9a-f]{16}|seed|pool-shrink/)
  })

  test('a Daily outside the seven dates, a drill and a non-incident event are not in the rows', async () => {
    const events = await fixtureEvents()
    const rows = season0Rows(events)
    expect(rows.flatMap((r) => (r.result ? [r.date] : []))).toEqual(['2026-10-19', '2026-10-21'])
    const drill = { ...(events.find((e) => e.kind === 'incident') as IncidentEvent) }
    const asDrill = { ...drill, id: 'x-drill', ref: 'inc:drill/ab12' as IncidentEvent['ref'], data: { ...drill.data, src: 'drill' as const } }
    const notDaily = { ...drill, id: 'x-team', data: { ...drill.data, src: 'team' as const }, at: '2026-10-19T00:00:00.000Z' as IncidentEvent['at'] }
    expect(season0Rows([...events, asDrill, notDaily]).map((r) => r.result?.share ?? null)).toEqual(rows.map((r) => r.result?.share ?? null))
    expect(season0Rows([]).every((r) => r.result === null)).toBe(true)
  })

  test('two events on one date (a second device) list the earlier attempt and never replace it', async () => {
    const events = await fixtureEvents()
    const first = events.find((e) => e.kind === 'incident' && e.ref === 'inc:daily/2026-10-19') as IncidentEvent
    const later: IncidentEvent = { ...first, id: 'zz-later', at: '2026-10-20T08:00:00.000Z' as IncidentEvent['at'], data: { ...first.data, probes: ['a', 'b', 'c', 'd', 'e'], burn: 12 } }
    for (const order of [[...events, later], [later, ...events]]) expect(season0Rows(order)[0].result?.share).toBe('KS-Daily #7 · 2 probes · burn 18%')
  })

  test('the outcome says what happened without a score', () => {
    expect(season0Outcome({ fixed: true, diagnosed: true })).toBe('Fixed, and your hypothesis named the fault.')
    expect(season0Outcome({ fixed: true, diagnosed: false })).toBe('Fixed, though your hypothesis did not name the fault.')
    expect(season0Outcome({ fixed: false, diagnosed: true })).toBe('Your hypothesis named the fault; the fix did not land in time.')
    expect(season0Outcome({ fixed: false, diagnosed: false })).toBe('Not fixed in time, and your hypothesis did not name the fault.')
  })

  test("a date's state against today: played, open, missed or upcoming", () => {
    const row = (date: string, played: boolean): Season0Row => ({ day: 1, date, result: played ? { diagnosed: true, fixed: true, probes: 1, share: 's' } : null })
    expect(season0State(row('2026-10-21', true), '2026-10-21')).toBe('played')
    expect(season0State(row('2026-10-21', true), '2026-10-30')).toBe('played')
    expect(season0State(row('2026-10-21', false), '2026-10-21')).toBe('open')
    expect(season0State(row('2026-10-21', false), '2026-10-22')).toBe('missed')
    expect(season0State(row('2026-10-21', false), '2026-10-15')).toBe('upcoming')
  })
})

/* ------------------------------------------------------------------ */
/* The pages                                                            */
/* ------------------------------------------------------------------ */

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(async () => {
  setSystemTime()
  await dom.uninstall()
})

const textOf = (el: MiniElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('the card on /me', () => {
  test('it lists the seven days with your results and share strings, and settles once the ledger is read', async () => {
    const events = await fixtureEvents()
    const Season0Card = (await import('../../src/pages/me/Season0Card')).default
    let settled = 0
    const read = () => Promise.resolve(events)
    const page = await dom.mount(createElement(MemoryRouter, null, createElement(Season0Card, { read, today: '2026-10-22', onSettled: () => void settled++ })))
    await dom.until(() => page.container.querySelector('[data-season0-list]') !== null)
    expect(settled).toBe(1)
    const rows = page.container.querySelectorAll('[data-season0-row]')
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['played', 'missed', 'played', 'open', 'upcoming', 'upcoming', 'upcoming'])
    const shares = page.container.querySelectorAll('[data-season0-share]').map(textOf)
    expect(shares).toEqual(['KS-Daily #7 · 2 probes · burn 18%', 'KS-Daily #9 · 3 probes · burn 100% · on my engine'])
    expect(textOf(rows[3])).toContain('Open today')
    expect(page.container.querySelector('a[href="/daily"]')).not.toBeNull()
    expect(textOf(page.container.querySelector('[data-season0-card]') as MiniElement)).toContain('there is no board')
    await page.unmount()
  })

  test('an empty ledger shows seven days and no share string', async () => {
    const Season0Card = (await import('../../src/pages/me/Season0Card')).default
    const page = await dom.mount(createElement(MemoryRouter, null, createElement(Season0Card, { read: () => Promise.resolve([]), today: '2026-10-15' })))
    await dom.until(() => page.container.querySelector('[data-season0-list]') !== null)
    expect(page.container.querySelectorAll('[data-season0-row]').length).toBe(7)
    expect(page.container.querySelectorAll('[data-season0-share]').length).toBe(0)
    await page.unmount()
  })

  test('a ledger that cannot be read says so, settles and offers a retry', async () => {
    const Season0Card = (await import('../../src/pages/me/Season0Card')).default
    let settled = 0
    let tries = 0
    const read = () => (++tries === 1 ? Promise.reject(new Error('no ledger')) : Promise.resolve([] as LedgerEvent[]))
    const page = await dom.mount(createElement(MemoryRouter, null, createElement(Season0Card, { read, onSettled: () => void settled++ })))
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)
    expect(settled).toBe(1)
    const retry = page.container.querySelector('[role="alert"] button') as MiniElement
    await dom.press(retry)
    await dom.until(() => page.container.querySelector('[data-season0-list]') !== null)
    await page.unmount()
  })

  test('/me loads the card as a chunk of its own and holds the journey back until it has settled', () => {
    const me = src('src/pages/Me.tsx')
    expect(me).toContain("import('@/pages/me/Season0Card')")
    expect(me).not.toMatch(/^import .*Season0Card/m)
    expect(me.indexOf('<forms.Season0')).toBeGreaterThan(me.indexOf('<BackgroundPick />'))
    expect(me.indexOf('<forms.Season0')).toBeLessThan(me.indexOf('<Journey />'))
    expect(me).toContain('season0Settled')
  })
})

describe('the Daily\'s header', () => {
  /** The Daily page on a local date, as far as its first paint: the header is there before the incident opens. */
  async function headerOn(date: Date, search = ''): Promise<{ season: string | null; text: string }> {
    setSystemTime(date)
    const Daily = (await import('../../src/pages/Daily')).default
    const page = await dom.mount(createElement(MemoryRouter, { initialEntries: [`/daily${search}`] }, createElement(Daily)))
    await dom.until(() => page.container.querySelector('[data-page="daily"]') !== null)
    const el = page.container.querySelector('[data-season0]')
    const out = { season: el ? textOf(el) : null, text: textOf(page.container) }
    await page.unmount()
    setSystemTime()
    return out
  }

  test('on each of the seven dates it says Season 0 · day k of 7, and links to Me', async () => {
    for (let k = 1; k <= 7; k++) {
      const { season } = await headerOn(new Date(2026, 9, 18 + k, 12))
      expect(season).toContain(`Season 0 · day ${k} of 7`)
      expect(season).toContain('stay on this device')
    }
  })

  test('the day before, the day after and the on-call shift show no Season 0 line', async () => {
    expect((await headerOn(new Date(2026, 9, 18, 12))).season).toBeNull()
    expect((await headerOn(new Date(2026, 9, 26, 12))).season).toBeNull()
    expect((await headerOn(new Date(2026, 9, 21, 12), '?shift=3')).season).toBeNull()
  })
})

describe('nothing to moderate: no board, no fetch', () => {
  test('the season\'s files make no network call and name no board', () => {
    for (const f of ['src/data/season0.ts', 'src/pages/me/Season0Card.tsx']) {
      const code = src(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      expect(code, f).not.toMatch(/\bfetch\b|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.share|clipboard/)
      expect(code, f).not.toMatch(/leaderboard|ranking|friends/i)
    }
  })

  test('the Daily reads nothing new: Season 0 adds no import beyond the date helper', () => {
    const imports = src('src/pages/Daily.tsx').split('\n').filter((l) => l.includes('season0'))
    expect(imports.filter((l) => l.startsWith('import'))).toEqual(["import { season0Day, season0Header } from '@/data/season0'"])
  })
})
