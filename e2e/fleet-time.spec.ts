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
  // the page marks its alert before Playwright's poll sees the play phase (up to ~500 ms later), so the wall starts first
  const alert = Date.now()
  await page.goto('/daily')
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  await hiddenFor(page, HIDDEN_MS)
  await page.waitForTimeout(1500)
  await playDailyToDebrief(page)
  const wall = Date.now() - alert
  await expect.poll(async () => (await stored(page, 'incident', 'inc:daily/')).length, { timeout: 30_000 }).toBe(1)
  const [e] = await stored(page, 'incident', 'inc:daily/')
  console.log(`fleet-time: Daily ms ${e.ms}, wall from the alert ${wall} ms, ${HIDDEN_MS} ms of it hidden`)
  expect(Number.isInteger(e.ms)).toBe(true)
  // the 3 s visible before and after the hidden stretch are in it, and the hidden stretch is not
  expect(e.ms!).toBeGreaterThanOrEqual(3000)
  expect(e.ms!).toBeLessThanOrEqual(wall - HIDDEN_MS + SLACK_MS)
  expect(e.ms!).toBeLessThanOrEqual(INCIDENT_MAX_MS)
})

test('/week: a drill holds its visible alert-to-debrief time, and Act III the visible page time the drill does not', async ({ page }) => {
  const opened = Date.now()
  await page.goto('/week')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const loaded = Date.now()

  /* ---- an Act IV drill, hidden for a stretch in the middle ---- */
  const alert = Date.now()
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
  const drillWall = Date.now() - alert
  await expect.poll(async () => (await stored(page, 'incident', 'inc:drill/')).length, { timeout: 30_000 }).toBe(1)
  const [drill] = await stored(page, 'incident', 'inc:drill/')
  console.log(`fleet-time: drill ms ${drill.ms}, wall from the alert ${drillWall} ms, ${HIDDEN_MS} ms of it hidden`)
  expect(Number.isInteger(drill.ms)).toBe(true)
  expect(drill.ms!).toBeGreaterThanOrEqual(3000)
  expect(drill.ms!).toBeLessThanOrEqual(drillWall - HIDDEN_MS + SLACK_MS)
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
  const passAt = Date.now()
  await expect.poll(async () => (await stored(page, 'fleet-act', 'fw:business')).length, { timeout: 30_000 }).toBe(1)
  const [act] = await stored(page, 'fleet-act', 'fw:business')
  // the page was visible from the load to the pass but for the hidden stretch; the act holds what the drill does not
  const visible = passAt - opened - HIDDEN_MS
  console.log(`fleet-time: Act III ms ${act.ms}, drill ${drill.ms}, page visible about ${visible} ms (${loaded - opened} ms of it loading)`)
  expect(Number.isInteger(act.ms)).toBe(true)
  expect(act.ms!).toBeGreaterThan(0)
  expect(act.ms!).toBeLessThanOrEqual(FLEET_ACT_MAX_MS)
  // no second is counted twice: the drill and the act together are at most the page's visible time
  expect(drill.ms! + act.ms!).toBeLessThanOrEqual(visible + SLACK_MS)
  // and together they hold nearly all of it (the page's clock starts on mount, after the load)
  expect(drill.ms! + act.ms!).toBeGreaterThanOrEqual(visible - (loaded - opened) - 2500)
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
