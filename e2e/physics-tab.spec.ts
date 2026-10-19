import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of the physics tab on /freshness (docs/specs/s5.md §5.8, §8.3; S5-11) at 360 px, no pointer: Tab
// reaches the tab list on the claims tab, the arrow key moves to Physics (the fourth tab), the panel loads its chunk and
// data, Tab reaches a claim chip and Enter opens its source, Escape closes it, a row's leave-one-out table opens from its
// summary and scrolls sideways inside its own region while the page itself never scrolls sideways.
//
// The layout claims of the s5b fix round (final review round 2, F5) are asserted at 320 and 360 px as well: the /freshness
// tab list sits on one row, every tab is a 44 x 44 px target, and no worked example's table scrolls sideways (the leave-one-out
// tables are the ones that do, and are meant to). The review measured 44 x 45.2 px tabs and 236/236 px regions at 320 px,
// 50.4 x 47 px and 276/276 px at 360 px.

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return {
      id: el?.id ?? '',
      tag: el?.tagName.toLowerCase() ?? '',
      chip: el?.closest('[data-claim]')?.getAttribute('data-claim') ?? null,
      region: el?.hasAttribute('data-scroll-region') ? el.getAttribute('aria-label') : null,
      summary: el?.tagName.toLowerCase() === 'summary' ? (el.textContent ?? '').trim() : null,
      inTab: !!el?.closest('[data-physics-tab]'),
    }
  })

async function tabUntil(page: Page, until: (a: Awaited<ReturnType<typeof active>>) => boolean, limit: number, what: string): Promise<number> {
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press('Tab')
    if (until(await active(page))) return i
  }
  throw new Error(`Tab never reached ${what} in ${limit} presses`)
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test.use({ viewport: { width: 360, height: 800 } })

test('/freshness?tab=physics: reach the tab by arrow key, open a claim chip, read a table that scrolls in its own region, by keyboard alone', async ({ page }) => {
  await page.goto('/freshness?tab=claims')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('claims-table')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  // the tab list has one Tab stop, the selected tab
  await tabUntil(page, (a) => a.id === 'changes-tab-claims', 200, 'the claims tab')
  await page.keyboard.press('ArrowRight')
  expect((await active(page)).id).toBe('changes-tab-physics')
  await expect(page).toHaveURL(/[?&]tab=physics\b/)
  await expect(page.getByRole('tab', { name: 'Physics' })).toHaveAttribute('aria-selected', 'true')
  const tab = page.locator('[data-physics-tab]')
  await expect(tab).toHaveAttribute('data-physics-tab', 'positive', { timeout: 15_000 })
  await page.waitForLoadState('networkidle')
  expect(await noSidewaysScroll(page)).toBe(true)
  await expect(tab.locator('[data-attribution]')).toContainText('InferenceX™ is a trademark of SemiAnalysis')
  await expect(tab.locator('[data-verdict="calibrated"]')).toHaveCount(3)

  // a claim chip: Enter opens its source, Escape closes it and gives focus back
  await tabUntil(page, (a) => a.chip !== null, 200, 'a claim chip')
  const chip = (await active(page)).chip!
  await page.keyboard.press('Enter')
  const popover = page.getByRole('dialog')
  await expect(popover).toBeVisible()
  await expect(popover).toContainText('Holds for:')
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  expect((await active(page)).chip).toBe(chip)

  // the first row's leave-one-out table: open its summary, then its region takes the keyboard and scrolls sideways
  await tabUntil(page, (a) => a.summary !== null && a.summary.startsWith('Leave-one-out'), 300, "a row's leave-one-out table")
  await page.keyboard.press('Enter')
  await tabUntil(page, (a) => a.region !== null, 5, 'the table region')
  const region = page.locator('[data-scroll-region]:focus')
  await expect(region).toBeVisible()
  const sizes = await region.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }))
  expect(sizes.scroll).toBeGreaterThan(sizes.client)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  await expect(region.locator('tbody tr').first()).toBeVisible()
  expect(await noSidewaysScroll(page)).toBe(true)
})

for (const width of [320, 360]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('/freshness?tab=physics: the tab list is one row of 44 px targets and no worked example scrolls sideways', async ({ page }) => {
      await page.goto('/freshness?tab=physics')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.locator('[data-physics-tab]')).toHaveAttribute('data-physics-tab', 'positive', { timeout: 15_000 })
      await page.waitForLoadState('networkidle')
      await page.evaluate(() => document.fonts.ready)

      // one row: every tab's top is the first tab's, within 1 px, and none is smaller than a 44 px target
      const tabs = await page.getByRole('tablist', { name: 'Changes' }).getByRole('tab').evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { name: (el.textContent ?? '').trim(), top: r.top, width: r.width, height: r.height }
        }),
      )
      expect(tabs.map((t) => t.name)).toEqual(['Errata', 'Field Notes', 'Claims', 'Physics'])
      for (const t of tabs) {
        expect(Math.abs(t.top - tabs[0].top), `${t.name} sits on the first tab's row`).toBeLessThanOrEqual(1)
        expect(t.width, `${t.name} is at least 44 px wide`).toBeGreaterThanOrEqual(44)
        expect(t.height, `${t.name} is at least 44 px tall`).toBeGreaterThanOrEqual(44)
      }

      // the worked examples' tables fit their regions; the leave-one-out tables elsewhere on the tab are the ones that scroll
      const regions = await page.locator('[data-example] [data-scroll-region]').evaluateAll((els) =>
        els.map((el) => ({ label: el.getAttribute('aria-label') ?? '', scroll: el.scrollWidth, client: el.clientWidth })),
      )
      expect(regions.length).toBeGreaterThan(0)
      test.info().annotations.push({
        type: 'measured',
        description: `tabs ${tabs.map((t) => `${t.width}x${t.height}`).join(', ')}; regions ${regions.map((r) => `${r.scroll}/${r.client}`).join(', ')}`,
      })
      for (const r of regions) expect(r.scroll, `${r.label}: scrollWidth ${r.scroll} against clientWidth ${r.client}`).toBeLessThanOrEqual(r.client)
      expect(await noSidewaysScroll(page)).toBe(true)
    })
  })
}
