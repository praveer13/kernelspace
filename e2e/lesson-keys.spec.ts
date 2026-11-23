import { expect, test, type Locator, type Page } from '@playwright/test'

// Arrow keys inside a control stay with the control; the lesson's ArrowRight shortcut works from the page itself.
// At 360 px a sim is in phone mode, so the sim tests run at a desktop width.
test.use({ viewport: { width: 1280, height: 900 } })

test('ArrowRight on the roofline slider nudges it and keeps the lesson', async ({ page }) => {
  await page.goto('/lesson/t4.l3')
  const slider = page.locator('[data-exercise="sim-roofline"] [role="slider"]').first()
  await slider.scrollIntoViewIfNeeded()
  await slider.focus()
  const before = await slider.getAttribute('aria-valuenow')
  await page.keyboard.press('ArrowRight')
  await expect(slider).not.toHaveAttribute('aria-valuenow', before ?? '')
  expect(page.url()).toMatch(/\/lesson\/t4\.l3$/)
})

/** The scheduler play's arrow walk, in the order the queue walks it. */
const WALK = '[data-queue] [data-chip]:not(:disabled), [data-queue] [data-preempt]'

/** Play turns (admit the first request, run the iteration) until the walk has at least two stops. */
async function untilTwoStops(page: Page): Promise<Locator> {
  const walk = page.locator(WALK)
  for (let turn = 0; turn < 20; turn++) {
    if ((await walk.count()) >= 2) return walk
    const chip = page.locator('[data-queue] [data-chip]:not(:disabled)').first()
    const before = await page.locator('[data-action-line]').innerText()
    await chip.scrollIntoViewIfNeeded()
    await chip.click()
    await expect(page.locator('[data-action-line]')).not.toHaveText(before)
    await page.getByRole('button', { name: /^Run iteration/ }).click()
    await page.waitForTimeout(200)
  }
  throw new Error('the play never offered two requests at once')
}

test('ArrowRight on a request in the scheduler play moves focus to the next request and keeps the lesson', async ({ page }) => {
  await page.goto('/lesson/t5.l7')
  await expect(page.locator('[data-queue] [data-chip]:not(:disabled)').first()).toBeVisible()
  const walk = await untilTwoStops(page)
  await walk.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(walk.nth(1)).toBeFocused()
  await page.waitForTimeout(300)
  expect(page.url()).toMatch(/\/lesson\/t5\.l7$/)
})

test('ArrowRight with focus on the page still goes to the next lesson', async ({ page }) => {
  await page.goto('/lesson/t4.l3')
  await expect(page.locator('[data-exercise="sim-roofline"] [role="slider"]').first()).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('ArrowRight')
  await expect(page).toHaveURL(/\/lesson\/t4\.l4$/)
})

test('Space on the lesson page leaves the embedded sim alone', async ({ page }) => {
  await page.goto('/lesson/t4.l3')
  const exercise = page.locator('[data-exercise="sim-roofline"]')
  await expect(exercise.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await page.evaluate(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.scrollTo(0, 1000)
  })
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  await expect(exercise.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)
  await expect(exercise.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  expect(page.url()).toMatch(/\/lesson\/t4\.l3$/)
})

test('r on the lesson page does not reset the embedded sim', async ({ page }) => {
  await page.goto('/lesson/t4.l3')
  const exercise = page.locator('[data-exercise="sim-roofline"]')
  await expect(exercise.getByRole('button', { name: 'Step forward' })).toBeVisible()
  // step the sim once by its button, hand focus back to the page, press r: the tick count stays.
  const ticks = exercise.getByText(/^t = \d+$/)
  const start = await ticks.innerText()
  await exercise.getByRole('button', { name: 'Step forward' }).click()
  await expect(ticks).not.toHaveText(start)
  const stepped = await ticks.innerText()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('r')
  await page.waitForTimeout(300)
  await expect(ticks).toHaveText(stepped)
  expect(page.url()).toMatch(/\/lesson\/t4\.l3$/)
})

// A code block or a table that is wider than the column is a scroll region the keyboard can reach: its arrows
// scroll it, as a browser's own do, and never leave the lesson. At 390 px these blocks overflow.
test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const [what, label] of [
    ['code block', 'code, scrolls sideways'],
    ['table', 'table, scrolls sideways'],
  ] as const) {
    test(`ArrowRight on a focused ${what} scrolls it and keeps the lesson`, async ({ page }) => {
      await page.goto('/lesson/t4.l3')
      const regions = page.getByRole('region', { name: label })
      await expect(regions.first()).toBeAttached()
      // the first region of this kind that is wider than its box
      const n = await regions.count()
      let region: Locator | null = null
      for (let i = 0; i < n; i++) {
        const r = regions.nth(i)
        if (await r.evaluate((el) => el.scrollWidth > el.clientWidth)) {
          region = r
          break
        }
      }
      expect(region, `no ${what} on t4.l3 overflows at 390 px`).not.toBeNull()
      await region!.scrollIntoViewIfNeeded()
      await region!.focus()
      await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(300)
      expect(page.url()).toMatch(/\/lesson\/t4\.l3$/)
      await expect.poll(() => region!.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    })
  }
})
