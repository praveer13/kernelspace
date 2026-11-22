import { expect, test } from '@playwright/test'

// /freshness?tab=claims at 390 x 844: the claims table stacks, so every "Holds for" line ends inside the viewport and the
// box does not scroll sideways. At 1280 the six-column table is still a table.

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('claims rows fit the viewport', async ({ page }) => {
    await page.goto('/freshness?tab=claims')
    await expect(page.getByTestId('claims-table')).toBeVisible()
    const m = await page.evaluate(() => {
      const table = document.querySelector('[data-testid="claims-table"]') as HTMLElement
      const box = table.parentElement as HTMLElement
      const holds = [...document.querySelectorAll('[data-testid="claims-table"] div')].filter((d) => (d.textContent ?? '').startsWith('Holds for:'))
      return {
        scroll: box.scrollWidth,
        client: box.clientWidth,
        vw: window.innerWidth,
        holds: holds.length,
        maxRight: Math.max(...holds.map((d) => d.getBoundingClientRect().right)),
      }
    })
    expect(m.holds).toBeGreaterThan(0)
    expect(m.maxRight).toBeLessThanOrEqual(m.vw)
    expect(m.scroll).toBeLessThanOrEqual(m.client + 1)
  })
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })
  test('the six-column table still renders', async ({ page }) => {
    await page.goto('/freshness?tab=claims')
    await expect(page.getByTestId('claims-table')).toBeVisible()
    await expect(page.locator('[data-testid="claims-table"] thead th')).toHaveCount(6)
    expect(await page.locator('[data-testid="claims-table"] thead th').first().isVisible()).toBe(true)
  })
})
