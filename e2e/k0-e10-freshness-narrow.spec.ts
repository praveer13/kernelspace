import { expect, test, type Page } from '@playwright/test'

// /freshness?tab=claims at 390 x 844: the claims table stacks, so every "Holds for" line ends inside the viewport and the
// box does not scroll sideways, and each stacked field shows its column's name (value, kind, source, verified, status)
// where a sighted reader can see it. At 1280 the six-column table is still a table and those captions are hidden.
// Both measure after the lazy claim groups have landed (the table's status line is empty), not at first visibility.

async function openClaims(page: Page) {
  await page.goto('/freshness?tab=claims')
  const table = page.getByTestId('claims-table')
  await expect(table).toBeVisible()
  await expect(table.locator('xpath=..').getByRole('status')).toHaveText('', { timeout: 15_000 })
}

/** For every row, the visible text of each of cells 2 to 6 and the header of its column. */
function rowsAndHeaders(page: Page) {
  return page.evaluate(() => {
    const headers = [...document.querySelectorAll('[data-testid="claims-table"] thead th')].map((th) => (th.textContent ?? '').trim())
    const rows = [...document.querySelectorAll('[data-testid="claims-table"] tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.trim()),
    )
    return { headers, rows }
  })
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('claims rows fit the viewport', async ({ page }) => {
    await openClaims(page)
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
  test('each stacked field shows its column name', async ({ page }) => {
    await openClaims(page)
    const { headers, rows } = await rowsAndHeaders(page)
    expect(headers).toEqual(['claim', 'value', 'kind', 'source', 'verified', 'status'])
    expect(rows.length).toBeGreaterThan(0)
    const missing = rows.flatMap((cells, r) => [1, 2, 3, 4, 5].filter((i) => !cells[i].startsWith(headers[i])).map((i) => `row ${r} ${headers[i]}: "${cells[i]}"`))
    expect(missing.slice(0, 5)).toEqual([])
  })
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })
  test('the six-column table still renders, with no stacked captions', async ({ page }) => {
    await openClaims(page)
    await expect(page.locator('[data-testid="claims-table"] thead th')).toHaveCount(6)
    expect(await page.locator('[data-testid="claims-table"] thead th').first().isVisible()).toBe(true)
    const { headers, rows } = await rowsAndHeaders(page)
    const shown = rows.flatMap((cells, r) => [1, 2, 4, 5].filter((i) => cells[i].startsWith(headers[i])).map((i) => `row ${r} ${headers[i]}: "${cells[i]}"`))
    expect(shown).toEqual([])
  })
})
