import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of an item block (docs/specs/wave-2.md §5.2, §22.2, 2a-32): /lesson/t7.l1 at 360 px, no pointer.
// Tab reaches the block, the prediction is typed and sent with Enter, "Now solve it" and "New numbers" are
// pressed with Enter, and three correct answers on fresh numbers end at "3/3 · done". The answers are worked from
// the table on screen (the same arithmetic the lesson teaches), so the walk reaches done whatever seeds it meets.

const BLOCK = '[data-block="item"]'

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return {
      inBlock: !!el?.closest('[data-block="item"]'),
      field: el?.hasAttribute('data-ks-field') ?? false,
      name: (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
      tag: el?.tagName.toLowerCase() ?? '',
    }
  })

/** Press Tab until `until` holds for the focused element, or fail after `limit` presses. Returns the presses used. */
async function tabUntil(page: Page, until: (a: Awaited<ReturnType<typeof active>>) => boolean, limit: number, what: string): Promise<number> {
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press('Tab')
    if (until(await active(page))) return i
  }
  throw new Error(`Tab never reached ${what} in ${limit} presses`)
}

/** The answer to the item on screen, read from its table: requests meeting both bounds, or that count over the window. */
const solve = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const root = document.querySelector('[data-block="item"]')
    const text = root?.textContent ?? ''
    const num = (s: string) => Number(s.replace(/,/g, ''))
    const bounds = /TTFT under ([\d,]+) ms and TPOT under ([\d,]+) ms/.exec(text)
    if (!root || !bounds) throw new Error(`not a goodput table: ${text.slice(0, 200)}`)
    const rows = [...root.querySelectorAll('tbody tr')].map((r) => [...(r as HTMLTableRowElement).cells].map((c) => num(c.textContent ?? '')))
    const met = rows.filter((r) => r[1] < num(bounds[1]) && r[2] < num(bounds[2])).length
    const window = /window of ([\d,]+) seconds/.exec(text)
    if (/goodput, in requests per second/.test(text) && window) return String(Number((met / num(window[1])).toPrecision(5)))
    return String(met)
  })

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('/lesson/t7.l1: predict, solve three on fresh numbers and finish, by keyboard alone', async ({ page }) => {
  await page.goto('/lesson/t7.l1')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const block = page.locator(BLOCK)
  await expect(block).toHaveCount(1)
  await expect(block.locator('[data-ks-field]').first()).toBeVisible()
  expect(await noSidewaysScroll(page)).toBe(true)

  // Tab alone reaches the block (its request table is a focusable, scrollable region), then its answer field
  const toBlock = await tabUntil(page, (a) => a.inBlock, 300, 'the item block')
  const toField = await tabUntil(page, (a) => a.field, 12, 'the prediction field')
  test.info().annotations.push({ type: 'tabs', description: `${toBlock} to the block, ${toField} more to its field` })

  const progress = block.locator('[data-item-progress]')
  await expect(progress).toHaveText('0/3')

  // the prediction: no verdict, only "Saved", and Now solve it takes focus
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await expect(block.getByText('Saved.')).toBeVisible()
  expect((await active(page)).name).toContain('Now solve it')
  await page.keyboard.press('Enter')

  // three correct answers on fresh numbers: each lands focus on the field, then on New numbers after the verdict
  for (let n = 1; n <= 3; n++) {
    await expect.poll(async () => (await active(page)).field, { message: `answer field ${n} has focus` }).toBe(true)
    await page.keyboard.type(await solve(page))
    await page.keyboard.press('Enter')
    await expect(block.getByRole('status').filter({ hasText: 'Correct' })).toBeVisible()
    await expect(progress).toHaveText(n === 3 ? '3/3 · done' : `${n}/3`)
    expect((await active(page)).name).toContain('New numbers')
    expect(await noSidewaysScroll(page)).toBe(true)
    if (n < 3) await page.keyboard.press('Enter')
  }

  // done, and nothing locks: New numbers is still there and still works from the keyboard
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await active(page)).field).toBe(true)
  await expect(progress).toHaveText('3/3 · done')
})

test('/lesson/t7.l1: New numbers before answering draws another instance, reached by Tab from Submit', async ({ page }) => {
  await page.goto('/lesson/t7.l1')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const block = page.locator(BLOCK)
  await expect(block.locator('[data-ks-field]').first()).toBeVisible()

  await tabUntil(page, (a) => a.inBlock, 300, 'the item block')
  await tabUntil(page, (a) => a.field, 12, 'the prediction field')
  await page.keyboard.type('3')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await active(page)).field).toBe(true)

  // practice stage: field, then Submit, then New numbers, in that order and nothing else between
  const first = await block.locator('table').first().innerText()
  await page.keyboard.press('Tab')
  expect((await active(page)).name).toContain('Submit')
  await page.keyboard.press('Tab')
  expect((await active(page)).name).toBe('New numbers')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await block.locator('table').first().innerText()) !== first).toBe(true)
  await expect.poll(async () => (await active(page)).field).toBe(true)
})
