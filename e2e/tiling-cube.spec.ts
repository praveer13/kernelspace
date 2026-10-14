import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of the Tiling Cube (docs/specs/wave-3.md §6.3, §17.2, 3b-01): /play/tiling-cube at 360 px, level 1 to its
// debrief with the keyboard alone. The first session is the practice seed (CUBE_PRACTICE_SEED), so level 1 is the same tile
// every time; the walk reads its sizes off the screen and works the answer, as the learner does. Tab reaches the prediction
// field, Enter sends it, "Open the views" opens the faces, a stepper moves with Enter and Page Up, "Answer it now" opens the
// check, and its verdict leads to the level's debrief. Nothing uses the pointer after the page has loaded.

const CUBE = '[data-play="tiling-cube"]'

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** The text of the focused element, one line. */
const focusedText = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80)
  })

/** Press Tab until the focused element matches `selector`, or give up after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 80): Promise<number> {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((sel) => !!document.activeElement?.matches(sel), selector)) return i
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${selector}; focus is on "${await focusedText(page)}"`)
}

/** Press Tab until the focused element's name contains `text`, or give up after `limit` presses. */
async function tabToText(page: Page, text: string, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if ((await focusedText(page)).includes(text)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached "${text}"; focus is on "${await focusedText(page)}"`)
}

/** The intensity of the tile on screen: 2·Tm·Tn ÷ ((Tm + Tn)·b), from "a 150 × 60 output tile" and "(2 B per value)". */
const tileIntensity = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const text = document.querySelector('[data-level="1"]')?.textContent ?? ''
    const tile = /(\d+) × (\d+) output tile/.exec(text)
    const bytes = /\((\d+) B per value\)/.exec(text)
    if (!tile || !bytes) throw new Error(`not a tile question: ${text.slice(0, 200)}`)
    const [tm, tn, b] = [Number(tile[1]), Number(tile[2]), Number(bytes[1])]
    return (2 * tm * tn) / ((tm + tn) * b)
  })

test('/play/tiling-cube: level 1 is played to its debrief by keyboard alone at 360 px', async ({ page }) => {
  await page.goto('/play/tiling-cube')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator(`${CUBE}[data-phase-now="play"]`)).toBeVisible()
  await expect(page.locator('[data-level="1"][data-step="predict"]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await noSidewaysScroll(page)).toBe(true)

  // The first level opens with a prediction: no views and no table yet, and nothing took focus on load.
  await expect(page.locator('[data-views]')).toHaveCount(0)
  await expect(page.locator('[data-play-mirror]')).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)

  // Predict: Tab alone reaches the field; 64 is a guess, whatever the tile is. There is no verdict, only "Saved".
  await tabTo(page, '[data-ks-field]')
  await page.keyboard.type('64')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-phase="predict"]').getByText('Saved.')).toBeVisible()
  expect(await focusedText(page)).toContain('Open the views')
  await page.keyboard.press('Enter')

  // Explore: the heading takes focus, the three faces and the table are there, and the steppers are the only controls.
  await expect(page.locator('[data-level="1"][data-step="explore"]')).toBeVisible()
  await expect(page.locator('[data-level="1"] h3')).toBeFocused()
  await expect(page.locator('[data-views] svg[role="img"]')).toHaveCount(1)
  for (const face of ['A', 'B', 'C']) await expect(page.locator(`[data-views] [data-face="${face}"]`)).toHaveCount(1)
  await expect(page.locator('input[type="range"]')).toHaveCount(0)
  expect(await noSidewaysScroll(page)).toBe(true)

  // A stepper moves with Enter, and Page Up steps four notches; the value changes and the table follows.
  const tm = page.locator('[data-control="tm"]')
  const up = tm.locator('[data-step="up"]')
  const table = page.locator('[data-play-mirror] table')
  await tabTo(page, '[data-control="tm"] [data-step="down"]')
  await tabTo(page, '[data-control="tm"] [data-step="up"]')
  const before = Number(await tm.locator('[data-value]').innerText())
  const intensityBefore = await table.innerText()
  const box = await up.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  await page.keyboard.press('Enter')
  const once = Number(await tm.locator('[data-value]').innerText())
  expect(once).toBeGreaterThan(before)
  await page.keyboard.press('PageUp')
  const four = Number(await tm.locator('[data-value]').innerText())
  expect(four).toBeGreaterThan(once)
  expect(await table.innerText()).not.toBe(intensityBefore)
  expect(await focusedText(page)).toContain('Increase Tm') // focus stayed on the button
  await page.keyboard.press('PageDown')
  expect(Number(await tm.locator('[data-value]').innerText())).toBeLessThan(four)

  // The live line speaks the change (once a second at most), and the table is in the accessibility tree.
  await expect(page.locator('[data-play-mirror] [role="status"]')).toContainText(/Tile \d+ by \d+ FP\d+:/)
  expect(await noSidewaysScroll(page)).toBe(true)

  // Check: the same question, exact. Tab reaches the button, the field takes focus by itself, Enter sends the answer.
  await tabToText(page, 'Answer it now', 120)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-level="1"][data-step="check"]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute('data-ks-field') ?? false)).toBe(true)
  await page.keyboard.type(String(Number((await tileIntensity(page)).toPrecision(5))))
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-phase="check"]').getByRole('status').filter({ hasText: 'Correct' })).toBeVisible()
  expect(await focusedText(page)).toContain('See the debrief')
  expect(await noSidewaysScroll(page)).toBe(true)

  // Debrief: the heading takes focus, the prediction's error and the reference choice are there, and "Level 2" is next.
  await page.keyboard.press('Enter')
  const debrief = page.locator('[data-phase="debrief"]')
  await expect(debrief).toBeVisible()
  await expect(debrief.locator('h3')).toBeFocused()
  await expect(debrief.locator('[data-prediction-error]')).toContainText(/You predicted 64 FLOP\/B; the model gives [\d.]+ FLOP\/B\. You were off by a factor of/)
  await expect(debrief.locator('[data-reference]')).toContainText('2·128·128 FLOPs per step of K')
  await expect(debrief.locator('[data-principle]')).toContainText('Intensity is volume ÷ lit surface')
  await expect(debrief.getByRole('button', { name: /Level 2/ })).toBeVisible()
  expect(await noSidewaysScroll(page)).toBe(true)

  // The next level opens with its own prediction.
  await tabToText(page, 'Level 2')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-level="2"][data-step="predict"]')).toBeVisible()
  await expect(page.locator('[data-level="2"] h3')).toBeFocused()
})
