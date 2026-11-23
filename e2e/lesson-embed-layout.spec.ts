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
