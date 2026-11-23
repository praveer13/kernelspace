import { expect, test, type Page } from '@playwright/test'
import { INCIDENT_MAX_MS } from '../src/lib/world/daily'

// EF1's page wiring in a real browser (docs/specs/wave-3.md §15.1 and §17.4; the 3c review's G4, round 3): the Fleet
// Daily and an Act IV drill write the visible time from the alert to the debrief as their `incident` event's `ms`, and
// Act III, passed after the drill, writes the page's visible time that the drill does not hold. A stretch in the middle
// with the page hidden (visibilityState 'hidden' and a visibilitychange, as a background tab sees it) adds nothing, and
// each value sits under its cap; a third walk moves the page's clock past the cap and reads the cap back. The values are
// read from IndexedDB, where the ledger keeps them, so a page that passed 0 or the wall time would fail here.

test.use({ viewport: { width: 360, height: 800 } })

/** The hidden stretch, and how far a measured value may sit above what the walk saw (scheduling between the page and the test). */
const HIDDEN_MS = 5000
const SLACK_MS = 300
/** FLEET_ACT_MAX_MS in src/lib/fleet-week.ts (one hour), which loads the lab bridges and so is not imported here. */
const FLEET_ACT_MAX_MS = 60 * 60_000

/** Press Tab until the focused element matches `selector`, or give up after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 400): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return
    await page.keyboard.press('Tab')
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 140) ?? 'nothing')
  throw new Error(`Tab never reached ${selector}; focus is on ${at}`)
}

interface Stored {
  kind: string
  ref: string
  ms?: number
  provenance?: string
}

/** The ledger's events of `kind` whose ref starts with `prefix`, read from IndexedDB (the aggregate keeps no `ms`). */
async function stored(page: Page, kind: string, prefix: string): Promise<Stored[]> {
  return page.evaluate(
    ({ kind, prefix }) =>
      new Promise<Stored[]>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('events', 'readonly').objectStore('events').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve((all.result as Stored[]).filter((e) => e.kind === kind && e.ref.startsWith(prefix)))
          }
        }
      }),
    { kind, prefix },
  )
}

/** The page's own record of its clock, kept by `recordPageClock`. */
interface PageClockRecord {
  __seen: { t: number; hidden: boolean }[]
  __alertAt: number | null
  /** when a fleet worker's reply first carried an incident's alert (the Daily's alert follows it at once) */
  __readyAt: number | null
  /** when the ledger first put an event of kind `incident`, by its ref */
  __incidentPutAt: Record<string, number>
}

/**
 * Record, from before the page's own code runs, when the page itself saw each visibilitychange, when the alert was
 * raised (a click on the drill's start button; on the Daily, the fleet worker's reply that opens the incident with its
 * alert, which the page's own handler receives after this one and only then marks its alert), and when the ledger wrote each incident event into IndexedDB, all on
 * the page's own monotonic clock. The test's outside clock and the page's can disagree by scheduling under load; the
 * page's bookkeeping is checked against what the page saw. The page takes an incident's `ms` before it hands the event
 * to the ledger, and the ledger puts it after, so the put is an upper end for the time the event holds that does not
 * grow while the test waits for the event to appear.
 */
async function recordPageClock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as PageClockRecord
    w.__seen = []
    w.__alertAt = null
    w.__incidentPutAt = {}
    w.__readyAt = null
    const PageWorker = window.Worker
    window.Worker = class extends PageWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        // added before the page sets its onmessage, so it runs first for every reply
        this.addEventListener('message', (ev: MessageEvent) => {
          const d = ev.data as { incident?: { alert?: unknown } } | null
          if (w.__readyAt === null && d && typeof d === 'object' && d.incident && d.incident.alert !== undefined) w.__readyAt = performance.now()
        })
      }
    }
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const e = value as { kind?: unknown; ref?: unknown } | null
      if (this.name === 'events' && e && e.kind === 'incident' && typeof e.ref === 'string' && !(e.ref in w.__incidentPutAt)) {
        w.__incidentPutAt[e.ref] = performance.now()
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key)
    }
    document.addEventListener(
      'visibilitychange',
      () => w.__seen.push({ t: performance.now(), hidden: document.visibilityState === 'hidden' }),
      true,
    )
    document.addEventListener(
      'click',
      (ev) => {
        if (w.__alertAt === null && (ev.target as Element | null)?.closest?.('[data-start-drill]')) w.__alertAt = performance.now()
      },
      true,
    )
  })
}

/** The hidden stretch the page itself saw (ms), the page's clock now, the alert, and each incident event's put. */
async function pageSaw(
  page: Page,
): Promise<{ hidden: number; now: number; alertAt: number | null; readyAt: number | null; incidentPutAt: Record<string, number> }> {
  return page.evaluate(() => {
    const w = window as unknown as PageClockRecord
    let hidden = 0
    let from: number | null = null
    for (const e of w.__seen) {
      if (e.hidden && from === null) from = e.t
      else if (!e.hidden && from !== null) {
        hidden += e.t - from
        from = null
      }
    }
    return { hidden, now: performance.now(), alertAt: w.__alertAt, readyAt: w.__readyAt, incidentPutAt: { ...w.__incidentPutAt } }
  })
}

/** Hide the page for `ms`, as a background tab: the visible clock must not count it. */
async function hiddenFor(page: Page, ms: number): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(ms)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** Log the first hypothesis on the menu and give up: the shortest way from the alert to the debrief. */
async function playDailyToDebrief(page: Page): Promise<void> {
  await tabTo(page, 'input[type="radio"]')
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await tabTo(page, '[data-give-up]')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-flow="debrief"][data-debrief="done"]')).toBeVisible({ timeout: 90_000 })
}

test('/daily: the incident holds the visible time from the alert to the debrief, not a hidden stretch, under its cap', async ({ page }) => {
  await recordPageClock(page)
  await page.goto('/daily')
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  await hiddenFor(page, HIDDEN_MS)
  await page.waitForTimeout(1500)
  await playDailyToDebrief(page)
  await expect.poll(async () => (await stored(page, 'incident', 'inc:daily/')).length, { timeout: 30_000 }).toBe(1)
  // from the worker's reply that opens the incident (the page marks its alert right after) to the instant the ledger put
  // the event (the debrief writes it a moment after its phase shows, as it loads lazily), on the page's clock: neither
  // the page's load before the alert nor the test's poll for the event adds to the bound
  const saw = await pageSaw(page)
  const [e] = await stored(page, 'incident', 'inc:daily/')
  const putAt = saw.incidentPutAt[e.ref]
  expect(saw.readyAt).not.toBeNull()
  expect(putAt).toBeDefined()
  const wall = putAt - saw.readyAt!
  const hidden = saw.hidden
  const bound = wall - hidden + SLACK_MS
  console.log(`fleet-time: Daily ms ${e.ms}, page clock from the alert to the put ${Math.round(wall)} ms, ${Math.round(hidden)} ms of it hidden as the page saw it, bound ${Math.round(bound)} ms`)
  expect(hidden).toBeGreaterThanOrEqual(HIDDEN_MS)
  expect(Number.isInteger(e.ms)).toBe(true)
  // the 3 s visible before and after the hidden stretch are in it, and the hidden stretch is not
  expect(e.ms!).toBeGreaterThanOrEqual(3000)
  expect(e.ms!).toBeLessThanOrEqual(bound)
  expect(e.ms!).toBeLessThanOrEqual(INCIDENT_MAX_MS)
})

test('/week: a drill holds its visible alert-to-debrief time, and Act III the visible page time the drill does not', async ({ page }) => {
  await recordPageClock(page)
  await page.goto('/week')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const loaded = (await pageSaw(page)).now

  /* ---- an Act IV drill, hidden for a stretch in the middle ---- */
  await page.locator('[data-start-drill]').click()
  await expect(page.locator('[data-drill][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  await hiddenFor(page, HIDDEN_MS)
  await page.waitForTimeout(1500)
  await page.locator('[data-drill] input[type="radio"]').first().check()
  await page.locator('[data-drill] input[type="radio"]').first().press('Tab')
  await page.keyboard.press('Enter')
  await page.locator('[data-drill] [data-give-up]').click()
  await expect(page.locator('[data-drill][data-phase="debrief"]')).toBeVisible({ timeout: 90_000 })
  await expect.poll(async () => (await stored(page, 'incident', 'inc:drill/')).length, { timeout: 30_000 }).toBe(1)
  // from the alert click to the instant the ledger put the event (the debrief writes it a moment after its phase shows),
  // on the page's clock: the test's poll adds nothing to the bound
  const sawDrill = await pageSaw(page)
  const [drill] = await stored(page, 'incident', 'inc:drill/')
  const drillPutAt = sawDrill.incidentPutAt[drill.ref]
  expect(sawDrill.alertAt).not.toBeNull()
  expect(drillPutAt).toBeDefined()
  const drillWall = drillPutAt - sawDrill.alertAt!
  const drillBound = drillWall - sawDrill.hidden + SLACK_MS
  console.log(`fleet-time: drill ms ${drill.ms}, page clock from the alert to the put ${Math.round(drillWall)} ms, ${Math.round(sawDrill.hidden)} ms of it hidden as the page saw it, bound ${Math.round(drillBound)} ms`)
  expect(sawDrill.hidden).toBeGreaterThanOrEqual(HIDDEN_MS)
  expect(Number.isInteger(drill.ms)).toBe(true)
  expect(drill.ms!).toBeGreaterThanOrEqual(3000)
  expect(drill.ms!).toBeLessThanOrEqual(drillBound)
  expect(drill.ms!).toBeLessThanOrEqual(INCIDENT_MAX_MS)

  /* ---- Act III, which needs no module: execute, cite, check, score, submit ---- */
  const act3 = page.locator('section', { hasText: 'Act III — The Business' })
  await act3.getByRole('button', { name: /execute all three options/ }).click()
  await expect(act3.locator('table')).toBeVisible({ timeout: 90_000 })
  await act3.locator('button[data-cite][aria-label^="cite b200 cost per Mtok"]').click()
  const text3 = act3.locator('[data-workbench="business"] textarea')
  await text3.focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('B200 clears the SLO bar.')
  await act3.locator('[data-workbench="business"] [data-check-receipts]').click()
  await expect(act3.locator('[data-check-note]')).toHaveText('1 of 1 receipts verified by re-running.', { timeout: 90_000 })
  const picks: Record<string, number> = { capacity: 2, slo: 1, cost: 3, failure: 0 }
  for (const [criterion, level] of Object.entries(picks)) await act3.locator(`[data-criterion="${criterion}"] input[value="${level}"]`).check()
  await act3.locator('[data-workbench="business"] [data-submit-writeup]').click()
  await expect(act3.getByText(/^PASS — your b200 choice holds/)).toBeVisible({ timeout: 90_000 })
  const sawPass = await pageSaw(page)
  await expect.poll(async () => (await stored(page, 'fleet-act', 'fw:business')).length, { timeout: 30_000 }).toBe(1)
  const [act] = await stored(page, 'fleet-act', 'fw:business')
  // the page was visible from the load to the pass but for the hidden stretch; the act holds what the drill does not
  // (all on the page's own clock, which starts at the navigation, and the hidden stretch as the page saw it)
  const visible = sawPass.now - sawPass.hidden
  console.log(`fleet-time: Act III ms ${act.ms}, drill ${drill.ms}, page visible about ${Math.round(visible)} ms (${Math.round(loaded)} ms of it loading)`)
  expect(Number.isInteger(act.ms)).toBe(true)
  expect(act.ms!).toBeGreaterThan(0)
  expect(act.ms!).toBeLessThanOrEqual(FLEET_ACT_MAX_MS)
  // no second is counted twice: the drill and the act together are at most the page's visible time
  expect(drill.ms! + act.ms!).toBeLessThanOrEqual(visible + SLACK_MS)
  // and together they hold nearly all of it (the page's clock starts on mount, after the load)
  expect(drill.ms! + act.ms!).toBeGreaterThanOrEqual(visible - loaded - 2500)
})

test('/daily: a visible page nobody reads records no more than the cap', async ({ page }) => {
  // the page's clock (Date and performance.now) runs as usual until the jump; the fleet worker keeps the real clock
  await page.clock.install()
  await page.goto('/daily')
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  // forty minutes on a visible page: more than the cap of four Dailies' eight minutes
  await page.clock.fastForward('40:00')
  await playDailyToDebrief(page)
  await expect.poll(async () => (await stored(page, 'incident', 'inc:daily/')).length, { timeout: 30_000 }).toBe(1)
  const [e] = await stored(page, 'incident', 'inc:daily/')
  console.log(`fleet-time: Daily after a 40-minute jump: ms ${e.ms} (cap ${INCIDENT_MAX_MS})`)
  expect(e.ms).toBe(INCIDENT_MAX_MS)
})
