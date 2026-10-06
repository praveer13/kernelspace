import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of the scheduler play (docs/specs/wave-2.md §8.3, §22.2), at 360 px: the practice minute is played to
// the debrief with the keyboard alone. Tab finds the first chip, then at each turn Space admits the focused request,
// Enter runs the iteration, and focus lands on the next chip by itself. P preempts a focused running request, and the
// expert skip is a button Tab reaches. Nothing here uses the pointer after the page has loaded.

const SCHEDULER = '[data-play="scheduler"]'

/** What has focus, as the walk needs to tell it: a chip, a Preempt toggle, Run, the debrief button, the skip or something else. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return 'none'
    if (el.matches('[data-chip]')) return 'chip'
    if (el.matches('[data-preempt]')) return 'preempt'
    const text = (el.textContent ?? '').trim()
    if (el.tagName === 'BUTTON' && text.startsWith('Run iteration')) return 'run'
    if (el.tagName === 'BUTTON' && text === 'See the debrief') return 'debrief'
    if (el.tagName === 'BUTTON' && text === 'Skip to the debrief') return 'skip'
    return 'other'
  })
}

/** Press Tab until `want` has focus, or give up after `limit` presses. */
async function tabTo(page: Page, want: string, limit = 60): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if ((await focused(page)) === want) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab never reached ${want}; focus is on ${await focused(page)}`)
}

/** The page, with the play loaded and the fonts ready. */
async function open(page: Page): Promise<void> {
  await page.goto('/play/scheduler')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator(`${SCHEDULER}[data-phase-now="play"]`)).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/** One turn from a chip: Space admits it, Enter runs the iteration. Waits for the iteration to move on. */
async function playTurn(page: Page): Promise<void> {
  const before = await page.locator('[data-action-line]').innerText()
  await page.keyboard.press('Space')
  await expect(page.locator('[data-action-line]')).not.toHaveText(before)
  await page.keyboard.press('Enter')
}

test('/play/scheduler: the practice minute is played to the debrief by keyboard alone at 360 px', async ({ page }) => {
  await open(page)

  // One column at 360 px: no horizontal scroll, and every chip is a full-width target of at least 44 px.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  const chips = page.locator('[data-chip]')
  expect(await chips.count()).toBeGreaterThan(0)
  const box = await chips.first().boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  expect(box?.width ?? 0).toBeGreaterThan(280)

  // The reference is not on the screen before the debrief.
  await expect(page.locator('[data-debrief-side]')).toHaveCount(0)
  await expect(page.locator('[data-phase="debrief"]')).toHaveCount(0)

  await tabTo(page, 'chip')
  let turns = 0
  for (; turns < 80; turns++) {
    const at = await focused(page)
    if (at === 'debrief') break
    if (at === 'chip') await playTurn(page)
    else if (at === 'run') await page.keyboard.press('Enter')
    else await page.keyboard.press('Tab')
    // focus moves to the next chip, Run or the debrief button once the turn is applied
    await page.waitForFunction(() => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.matches('[data-chip], [data-preempt]') || /^(Run iteration|See the debrief)/.test((el.textContent ?? '').trim()))
    })
  }
  expect(await focused(page)).toBe('debrief')
  expect(turns).toBeGreaterThan(5)
  expect(turns).toBeLessThanOrEqual(60)

  // The live line spoke the last turn, and the mirror lists the requests for a screen reader.
  await expect(page.locator('[data-play-mirror] [role="status"]')).toContainText(/Iteration \d+: admitted/)

  await page.keyboard.press('Enter')
  const heading = page.locator('[data-phase="debrief"] h3')
  await expect(heading).toBeVisible()
  await expect(heading).toBeFocused()
  await expect(page.locator(`${SCHEDULER}[data-phase-now="debrief"]`)).toBeVisible()
  // The debrief says how the run went against the reference, and the Compose and In-production cards follow it.
  await expect(page.locator('[data-phase="debrief"]')).toContainText(/You served \d+ of \d+ requests/)
  await expect(page.locator('[data-phase="compose"]')).toBeVisible()
  await expect(page.locator('[data-phase="production"]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('/play/scheduler: P preempts a focused running request and clears again, and the skip is a keyboard button', async ({ page }) => {
  await open(page)
  await tabTo(page, 'chip')
  // Play until a request is running (a Preempt toggle exists), then walk to it with End.
  for (let i = 0; i < 12 && (await page.locator('[data-preempt]').count()) === 0; i++) {
    if ((await focused(page)) !== 'chip') await tabTo(page, 'chip')
    await playTurn(page)
    await page.waitForFunction(() => !!document.activeElement && document.activeElement !== document.body)
  }
  expect(await page.locator('[data-preempt]').count()).toBeGreaterThan(0)
  if ((await focused(page)) !== 'chip') await tabTo(page, 'chip')
  await page.keyboard.press('End')
  expect(await focused(page)).toBe('preempt')
  await page.keyboard.press('p')
  await expect(page.locator('[data-preempt]:focus')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-action-line]')).toContainText(/Preempt: #\d+/)
  await page.keyboard.press('P')
  await expect(page.locator('[data-preempt]:focus')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-action-line]')).not.toContainText('Preempt: ')

  // The skip appears after five turns and Tab reaches it.
  for (let i = 0; i < 8 && (await page.getByRole('button', { name: 'Skip to the debrief' }).count()) === 0; i++) {
    if ((await focused(page)) !== 'chip') await tabTo(page, 'chip')
    await playTurn(page)
    await page.waitForFunction(() => !!document.activeElement && document.activeElement !== document.body)
  }
  await tabTo(page, 'skip')
  await page.keyboard.press('Enter')
  const heading = page.locator('[data-phase="debrief"] h3')
  await expect(heading).toBeFocused()
  await expect(page.locator('[data-phase="debrief"]')).toContainText('You skipped ahead')
})

test('/play/scheduler: Compose runs from the keyboard and shows the table beside the reference', async ({ page }) => {
  await open(page)
  await tabTo(page, 'chip')
  for (let i = 0; i < 6; i++) {
    if ((await focused(page)) !== 'chip') await tabTo(page, 'chip')
    await playTurn(page)
    await page.waitForFunction(() => !!document.activeElement && document.activeElement !== document.body)
  }
  await tabTo(page, 'skip')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-phase="debrief"] h3')).toBeFocused()

  // Into the dials: the order radios, ArrowRight picks shortest prompt first, then the run button by Tab.
  await page.locator('[data-phase="compose"] input[type="radio"]').first().focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-phase="compose"] input[value="sjf"]')).toBeChecked()
  await page.getByRole('button', { name: 'Run my policy' }).focus()
  await page.keyboard.press('Enter')
  const result = page.locator('[data-compose-result]')
  await expect(result).toBeVisible()
  await expect(result.locator('tbody tr')).toHaveCount(12)
  await expect(result).toContainText('Reference · this minute')
})
