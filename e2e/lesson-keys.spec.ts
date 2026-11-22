import { expect, test } from '@playwright/test'

// Arrow keys inside a control stay with the control; the lesson's ArrowRight shortcut works from the page itself.
// At 360 px a sim is in phone mode, so these run at a desktop width.
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

test('ArrowRight on a request in the scheduler play moves focus and keeps the lesson', async ({ page }) => {
  await page.goto('/lesson/t5.l7')
  const chips = page.locator('[data-queue] [data-chip]:not(:disabled)')
  await chips.first().scrollIntoViewIfNeeded()
  await chips.first().focus()
  await page.keyboard.press('ArrowRight')
  // The first turn has one request, so the arrow walk wraps to it: focus stays on the request and the page stays put.
  await expect(chips.first()).toBeFocused()
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
