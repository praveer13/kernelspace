import { expect, test, type Page } from '@playwright/test'

// Keyboard smoke (docs/specs/wave-2.md §22.2): every control /today shows is reached by Tab alone, at 360 px,
// and Tab never gets stuck. Later specs (daily, scheduler, item-block, ticket) follow the same shape.

const CONTROLS = 'a[href], button, input, select, textarea, summary, [tabindex]'

/** Stamp each visible, tabbable control with a number, so a Tab press can be matched to a control. */
async function stampControls(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    const labels: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const disabled = (el as HTMLButtonElement).disabled === true
      if (disabled || el.tabIndex < 0 || !el.checkVisibility({ visibilityProperty: true })) continue
      el.dataset.e2eIdx = String(labels.length)
      const name = el.getAttribute('aria-label') ?? el.textContent ?? el.tagName
      labels.push(`${el.tagName.toLowerCase()} "${name.trim().replace(/\s+/g, ' ').slice(0, 40)}"`)
    }
    return labels
  }, CONTROLS)
}

/** Press Tab until every stamped control has had focus, or give up after `limit` presses. */
async function tabOrder(page: Page, count: number, limit: number): Promise<number[]> {
  const seen: number[] = []
  for (let i = 0; i < limit && new Set(seen).size < count; i++) {
    await page.keyboard.press('Tab')
    const idx = await page.evaluate(() => document.activeElement?.getAttribute('data-e2e-idx') ?? null)
    if (idx !== null) seen.push(Number(idx))
  }
  return seen
}

test('/today: Tab reaches every control', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)

  const labels = await stampControls(page)
  test.info().annotations.push({ type: 'controls', description: String(labels.length) })
  // the skip link, the nav and the page's own controls: far above zero, or the selector found nothing
  expect(labels.length).toBeGreaterThan(5)

  // room for controls Tab visits twice and for ones that appear on focus
  const seen = await tabOrder(page, labels.length, labels.length * 2 + 10)
  const missed = labels.filter((_, i) => !seen.includes(i))
  expect(missed, `controls Tab never reached:\n${missed.join('\n')}`).toEqual([])
})

// Reflow (WCAG 1.4.10): axe does not test it, so measure it. These pages scrolled sideways before their fixes
// (Home's code comparison, long lesson titles, the isomorphism panel); the full sweep is `npm run a11y`.
for (const route of ['/', '/lesson/t4.l7', '/lesson/t6.l4', '/lesson/t6.l9']) {
  test(`${route}: no sideways scroll at 360 and 320 px`, async ({ page }) => {
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(route)
      await expect(page.locator('main')).toBeVisible()
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.fonts.ready)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${route} scrolls sideways by ${overflow}px at ${width}px`).toBeLessThanOrEqual(0)
    }
  })
}
