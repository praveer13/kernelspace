import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of the EPLB play (docs/specs/wave-3.md §5.2, §17.2, 3b-02): /play/eplb at 360 px, the practice load to its
// debrief with the keyboard alone. Tab reaches the prediction field and Enter locks it in; the four replicate turns walk the
// expert grid with the arrow keys and copy with Enter; the twenty place turns press Enter on the focused free slot, which fills
// GPU 1 and then the next GPU with room, the slip the debrief names. The reference is not on the page until the debrief.
// Nothing here uses the pointer after the page has loaded.

const EPLB = '[data-play="eplb"][data-mode]'

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** The text of the focused element, one line. */
const focusedText = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)
  })

/** Press Tab until the focused element matches `selector`, or give up after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((sel) => !!document.activeElement?.matches(sel), selector)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${selector}; focus is on "${await focusedText(page)}"`)
}

/** The expert with the most load per copy right now, read off the buttons' names as a learner reads them. */
const heaviestPerCopy = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const per = [...document.querySelectorAll<HTMLElement>('[data-expert]')].map((b) => Number(/: ([\d.]+) ‰ per copy/.exec(b.getAttribute('aria-label') ?? '')?.[1]))
    return per.indexOf(Math.max(...per))
  })

/** Arrow keys until expert `e` has focus: Left and Right step one, Up and Down a row of four. */
async function focusExpert(page: Page, e: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const at = await page.evaluate(() => Number((document.activeElement as HTMLElement | null)?.dataset.expert ?? -1))
    if (at === e) return
    if (at < 0) throw new Error(`focus is not on an expert: "${await focusedText(page)}"`)
    const row = Math.trunc(e / 4) - Math.trunc(at / 4)
    await page.keyboard.press(row > 0 ? 'ArrowDown' : row < 0 ? 'ArrowUp' : e > at ? 'ArrowRight' : 'ArrowLeft')
  }
  throw new Error(`the arrows never reached expert ${e}`)
}

test('/play/eplb: the practice load is played to the debrief by keyboard alone at 360 px', async ({ page }) => {
  await page.goto('/play/eplb')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator(`${EPLB}[data-phase-now="predict"]`)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await noSidewaysScroll(page)).toBe(true)

  // The play opens with a prediction: no board and no reference yet, and nothing took focus on load.
  await expect(page.locator('[data-board]')).toHaveCount(0)
  await expect(page.locator('[data-debrief-side], [data-layer]')).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)

  // A bad entry is said, not guessed at; a number locks in with Enter.
  await tabTo(page, '[data-ks-field]')
  await page.keyboard.type('0.2')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-phase="predict"] [role="alert"]')).toContainText('at least the mean')
  await page.keyboard.press('Control+A')
  await page.keyboard.type('1.5')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-prediction-saved]')).toContainText('1.50×')
  await expect(page.locator('[data-board="replicate"]')).toBeVisible()
  await expect(page.locator(EPLB)).toHaveAttribute('data-phase-now', 'play')

  // The grid is one tab stop and focus is already on it; every expert is a button of at least 44 px.
  await expect(page.locator('[data-expert][data-stop]')).toBeFocused()
  const expertBox = await page.locator('[data-expert="14"]').boundingBox()
  expect(expertBox?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(expertBox?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(await noSidewaysScroll(page)).toBe(true)
  await expect(page.locator('[data-play-mirror] [role="status"]')).toContainText('Turn 1 of 24: copy an expert. 4 copies left to make.')

  // Four replicate turns: the arrows walk the grid, Enter copies the expert with the most load per copy.
  for (let t = 0; t < 4; t++) {
    const e = await heaviestPerCopy(page)
    await focusExpert(page, e)
    const before = await page.locator(`[data-expert="${e}"]`).innerText()
    await page.keyboard.press('Enter')
    // the fourth copy ends the replicate turns, and the grid gives way to the GPUs
    if (t < 3) {
      await expect(page.locator(`[data-expert="${e}"]`)).not.toHaveText(before)
      await expect(page.locator('[data-turn-line]')).toContainText(`Turn ${t + 2} of 24`)
    }
  }

  // Place turns: the board changes, the next copy is announced, focus lands on the first free slot, and Enter places it.
  await expect(page.locator('[data-board="place"]')).toBeVisible()
  await expect(page.locator('[data-slot="free"][data-stop]')).toBeFocused()
  await expect(page.locator('[data-next-copy]')).toContainText('Next copy: #')
  await expect(page.getByRole('button', { name: 'Skip to the debrief' })).toHaveCount(0)
  await expect(page.locator('[data-play-mirror] [role="status"]')).toContainText(/Turn 4: copied expert #\d+, now \d copies of .* ‰\. Turn 5 of 24: the next copy is #\d+, .* ‰\. Choose a GPU\./)
  const slot = await page.locator('[data-slot="free"]').first().boundingBox()
  expect(slot?.width ?? 0).toBeGreaterThanOrEqual(44)
  expect(slot?.height ?? 0).toBeGreaterThanOrEqual(44)
  // an arrow moves between GPUs, and Enter places the copy where focus is
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('[data-gpu="1"] [data-slot="free"]').first()).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('[data-gpu="0"] [data-slot="free"]').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-gpu="0"] [data-slot="filled"]')).toHaveCount(1)
  await expect(page.locator('[data-play-mirror] [role="status"]')).toContainText(/Turn 5: #\d+'s copy \(.* ‰\) on GPU 1, now .* ‰\. Busiest GPU \d\.\d\d× the mean\./)
  await expect(page.locator('[data-slot="free"][data-stop]')).toBeFocused()
  // the skip is offered once five turns are played
  await expect(page.getByRole('button', { name: 'Skip to the debrief' })).toHaveCount(1)
  expect(await noSidewaysScroll(page)).toBe(true)

  // The rest by Enter alone: GPU 1 fills, then focus moves on to the next GPU with room.
  for (let t = 5; t < 24; t++) {
    await expect(page.locator('[data-slot="free"][data-stop]')).toBeFocused()
    await page.keyboard.press('Enter')
  }
  await expect(page.getByRole('button', { name: 'See the debrief' })).toBeFocused()
  await expect(page.locator('[data-debrief-side]')).toHaveCount(0)
  expect(await noSidewaysScroll(page)).toBe(true)

  // Debrief: the heading takes focus, the prediction's error and the first divergence are there, and both layers are shown.
  await page.keyboard.press('Enter')
  const debrief = page.locator('[data-phase="debrief"]')
  await expect(debrief).toBeVisible()
  await expect(debrief.locator('h3')).toBeFocused()
  await expect(debrief.locator('h3')).toContainText('The first divergence is at turn')
  await expect(debrief.locator('[data-prediction-error]')).toContainText(/You predicted 1\.50× for round robin without replicas; it gives 1\.41×\./)
  await expect(debrief.locator('[data-debrief-explanation]')).toContainText(/At turn \d+ you put #\d+'s copy .* on GPU 1/)
  await expect(debrief.locator('[data-debrief-explanation]')).toContainText('the least loaded with a free slot')
  await expect(debrief.locator('[data-debrief-side]')).toHaveCount(2)
  await expect(debrief.locator('[data-tally]')).toContainText('practice load not yet')
  await page.evaluate(() => document.fonts.ready)
  expect(await noSidewaysScroll(page)).toBe(true)

  // Compose and the card arrive after the debrief, reachable by Tab; the dials are radios of at least 44 px.
  await expect(page.locator('[data-phase="compose"]')).toBeVisible()
  await expect(page.locator('[data-phase="production"]')).toBeVisible()
  const radio = await page.locator('[data-phase="compose"] label').first().boundingBox()
  expect(radio?.height ?? 0).toBeGreaterThanOrEqual(44)
  await tabTo(page, '[data-phase="compose"] input[type="radio"]', 120)
  await tabToText(page, 'Run my policy')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-compose-result]')).toContainText('Your spec was within 0.05 of the reference on')
  expect(await noSidewaysScroll(page)).toBe(true)
})

/** Press Tab until the focused element's name contains `text`, or give up after `limit` presses. */
async function tabToText(page: Page, text: string, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if ((await focusedText(page)).includes(text)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached "${text}"; focus is on "${await focusedText(page)}"`)
}
