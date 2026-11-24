import { expect, test } from '@playwright/test'

// A sim embedded in a lesson sits in the lesson column, which is narrower than the viewport: the chart stacks above its
// controls and takes the column width, instead of a thin strip as tall as the control panel.
test.use({ viewport: { width: 1280, height: 900 } })

test('roofline canvas in the lesson is wide and not taller than the screen', async ({ page }) => {
  await page.goto('/lesson/t4.l3')
  const canvas = page.locator('[data-exercise="sim-roofline"] canvas').first()
  await canvas.scrollIntoViewIfNeeded()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(480)
  expect(box!.height).toBeLessThanOrEqual(720)
  // The controls sit under the chart, not beside it.
  const slider = page.locator('[data-exercise="sim-roofline"] [role="slider"]').first()
  const sb = await slider.boundingBox()
  expect(sb).not.toBeNull()
  expect(sb!.y).toBeGreaterThanOrEqual(box!.y + box!.height - 1)
})

// The other sims that stripped in a lesson at 1280 px (measured: 246 x 1106 and 242 x 1194): the first child of the
// sim's row takes the column and the controls sit below it.
for (const [lesson, sim] of [
  ['t1.l3', 'sim-allocator'],
  ['t1.l4', 'sim-allocator'],
  ['t5.l5', 'sim-kv'],
] as const) {
  test(`${sim} in ${lesson} stacks its stage above its controls`, async ({ page }) => {
    await page.goto(`/lesson/${lesson}`)
    const ex = page.locator(`[data-exercise="${sim}"][data-inline="embed"]`).first()
    await ex.scrollIntoViewIfNeeded()
    const row = ex.locator('aside').first().locator('xpath=..')
    await expect(row).toBeVisible()
    expect(await row.evaluate((el) => getComputedStyle(el).flexDirection)).toBe('column')
    const stage = row.locator(':scope > *').first()
    const aside = row.locator(':scope > aside').first()
    const sb = await stage.boundingBox()
    const ab = await aside.boundingBox()
    expect(sb).not.toBeNull()
    expect(ab).not.toBeNull()
    expect(sb!.width).toBeGreaterThanOrEqual(480)
    expect(ab!.y).toBeGreaterThanOrEqual(sb!.y + sb!.height - 1)
  })
}
