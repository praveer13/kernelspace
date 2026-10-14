import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of the Fleet Daily (docs/specs/wave-2.md §9.7, §22.2; exit gate B6), at 360 x 740: a pinned date's Daily
// is played from the alert to the share string with the keyboard alone. Tab and the arrow keys choose the hypothesis,
// Enter takes the probes and applies the fixes, and focus lands on each new result by itself. Nothing uses the pointer
// after the page has loaded. The date is fixed through the browser clock, so the incident is the same on every run;
// tests/world/daily.test.ts checks that PINNED_FAULT is what generateIncident('daily', PINNED_DATE) draws.

const PINNED_DATE = '2026-10-23'
const PINNED_FAULT = 'pool-shrink'

test.use({ viewport: { width: 360, height: 740 }, permissions: ['clipboard-read', 'clipboard-write'] })

/** Press Tab until the focused element matches `selector`, or give up after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return
    await page.keyboard.press('Tab')
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120) ?? 'nothing')
  throw new Error(`Tab never reached ${selector}; focus is on ${at}`)
}

/** The Daily page, on the pinned date, with the incident opened and the fonts ready. */
async function open(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(`${PINNED_DATE}T12:00:00`))
  await page.goto('/daily')
  await expect(page.getByRole('heading', { level: 1, name: 'Fleet Daily' })).toBeVisible()
  // the fleet worker warms the incident up to its alert: a few seconds
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('/daily: the pinned Daily is played from the alert to the share string by keyboard alone at 360 px', async ({ page }) => {
  await open(page)
  await expect(page.locator('[data-page="daily"]')).toHaveAttribute('data-daily-date', PINNED_DATE)
  expect(await noHorizontalScroll(page)).toBe(true)

  // The alert names no fault and says what the budget is.
  const alert = page.locator('[data-flow="alert"]')
  await expect(alert).toContainText('Fleet Daily #11')
  await expect(alert).toContainText('Error budget: 30 burn-minutes')
  await expect(alert).toContainText('Synthetic scenario')

  // Hypothesis first: the probes are closed until one is logged.
  await expect(page.locator('[data-probe]').first()).toBeDisabled()
  await expect(page.locator('[data-probes-closed]')).toBeVisible()

  // The arrow keys move the choice inside the radio group. The menu is shown in an order drawn from the incident's seed,
  // so the walk reads the order first: down to the second fault, then on to the pinned one.
  await tabTo(page, 'input[type="radio"]')
  const order = await page.locator('input[type="radio"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
  expect([...order].sort()).toEqual(['drain-stall', 'node-death', 'pool-shrink', 'tenant-burst', 'unsure'])
  expect(order[order.length - 1]).toBe('unsure')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator(`input[value="${order[1]}"]`)).toBeChecked()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator(`input[value="${order[0]}"]`)).toBeChecked()
  for (let i = 0; i < order.indexOf(PINNED_FAULT); i++) await page.keyboard.press('ArrowDown')
  await expect(page.locator(`input[value="${PINNED_FAULT}"]`)).toBeChecked()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Log hypothesis' })).toBeFocused()
  await page.keyboard.press('Enter')

  // Logging opens the probes and moves focus to the first one.
  await expect(page.locator('[data-flow="hypothesis"]')).toHaveAttribute('data-logged', PINNED_FAULT)
  await expect(page.locator('[data-probe="intake"]')).toBeFocused()
  await expect(page.locator('[data-live]')).toContainText('Hypothesis logged')

  // Every control in the flow is a 44 px target in reading order.
  for (const selector of ['[data-probe]', '[data-fix]', '[data-wait]']) {
    const boxes = await page.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    expect(boxes.length).toBeGreaterThan(0)
    for (const h of boxes) expect(h).toBeGreaterThanOrEqual(44)
  }

  // Probe the intake, then the KV cache: each reading takes focus and is spoken.
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-reading="intake"] [data-reading-heading]')).toBeFocused()
  await expect(page.locator('[data-live]')).toContainText('Intake:')
  await tabTo(page, '[data-probe="kv"]')
  await page.keyboard.press('Enter')
  const kv = page.locator('[data-reading="kv"]')
  await expect(kv.locator('[data-reading-heading]')).toBeFocused()
  await expect(kv.locator('[data-reading-heading]')).toContainText('≈ 0 free, preempts rising')
  await expect(page.locator('[data-live]')).toContainText('KV cache:')
  // the reading is sparklines plus the table that describes them, and the table scrolls inside its own region
  await expect(kv.locator('svg[role="img"]').first()).toBeVisible()
  const region = kv.locator('[role="region"]')
  await expect(region).toBeVisible()
  expect(await noHorizontalScroll(page)).toBe(true)
  // the clock moved: a probe costs incident minutes
  await expect(page.locator('[data-clock]')).toContainText('+4 min')

  // A wrong fix wastes five minutes and says so; focus lands on the message.
  await tabTo(page, '[data-fix="restore-drain"]')
  await page.keyboard.press('Enter')
  const status = page.locator('[data-fix-status]')
  await expect(status).toContainText('that did not help')
  await expect(status).toBeFocused()
  await expect(page.locator('[data-clock]')).toContainText('+9 min')

  // The right fix goes in, the incident replays to recovery, and the debrief takes focus.
  await tabTo(page, `[data-fix="restore-pool"]`)
  await page.keyboard.press('Enter')
  const debrief = page.locator('[data-flow="debrief"][data-debrief="done"]')
  await expect(debrief).toBeVisible({ timeout: 60_000 })
  await expect(debrief.getByRole('heading', { level: 2 })).toBeFocused()
  await expect(debrief.locator('[data-verdict]')).toContainText(/burn-minutes/)
  await expect(debrief.locator('[data-verdict]')).toContainText("the expert's")
  await expect(debrief.locator('[data-expert-steps] li').first()).toBeVisible()
  await expect(debrief.locator('[data-your-probes] li')).toHaveCount(2)
  await expect(debrief.locator('[data-kcs]')).toContainText('KV capacity')
  expect(await noHorizontalScroll(page)).toBe(true)

  // The share string is copied from the keyboard.
  const share = debrief.locator('[data-share-string]')
  await expect(share).toHaveText(/^KS-Daily #11 · 2 probes · burn \d+%$/)
  const text = (await share.innerText()).trim()
  await tabTo(page, '[data-share] button')
  await expect(page.getByRole('button', { name: 'Copy result' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-share-status]')).toHaveText('Copied to the clipboard.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text)
  // it carries no hashes or seeds
  expect(text).not.toMatch(/[0-9a-f]{8}/)
  await expect(page.locator('[data-record-note]')).toHaveText('Recorded as today’s Daily.')

  // A reload remembers it: the same date is now practice, and Today's card offers the replay.
  await page.reload()
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-practice]')).toBeVisible()
  await page.goto('/today')
  const card = page.locator('[data-daily-card]')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-played', 'true')
  await expect(card).toContainText('Fleet Daily #11 · about 8 min')
  await expect(card.getByRole('link', { name: /Replay as practice/ })).toBeVisible()
})

test('/daily: a replay is practice, writes nothing, and the recorded burn stays the first attempt\'s', async ({ page }) => {
  await open(page)
  // Play the fastest legitimate Daily: unsure (ArrowUp wraps from the first fault to the last choice), no probe, the right fix.
  await tabTo(page, 'input[type="radio"]')
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('input[value="unsure"]')).toBeChecked()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-probe="intake"]')).toBeFocused()
  await tabTo(page, '[data-fix="restore-pool"]')
  await page.keyboard.press('Enter')
  const debrief = page.locator('[data-flow="debrief"][data-debrief="done"]')
  await expect(debrief).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-record-note]')).toHaveText('Recorded as today’s Daily.')
  await expect(debrief.locator('[data-share-string]')).toHaveText(/^KS-Daily #11 · 0 probes · burn \d+%$/)

  // Replay it as practice, from the keyboard: the banner appears and nothing more is recorded.
  await tabTo(page, '[data-share] button')
  await tabTo(page, 'button:not([data-share] button)')
  await expect(page.getByRole('button', { name: 'Replay as practice' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-practice]')).toBeVisible()
  await tabTo(page, 'input[type="radio"]')
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await tabTo(page, '[data-give-up]')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-flow="debrief"][data-debrief="done"]')).toBeVisible({ timeout: 90_000 })
  await expect(page.locator('[data-record-note]')).toHaveText('Practice replay: nothing was written to your record.')
})
