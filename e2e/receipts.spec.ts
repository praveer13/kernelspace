import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of Fleet Week's receipts (docs/specs/wave-3.md §10, §17.2; exit gate B2), at 360 px. Act I runs the
// all-reference practice engine (no passing module is ever committed, and a receipt check compares values and needs no
// pass): its result rows are cited with the "cite" buttons, "Check my receipts" re-runs the record and marks each
// cited value verified, and the submit stays closed because the trace has not passed. Act III needs no module: it is
// executed, its B200 cost is cited, checked, the rubric is scored and the business case passes. Tab, Space, the arrow
// keys and Enter only after the page has loaded.

test.use({ viewport: { width: 360, height: 800 } })

/** Press Tab until the focused element matches `selector`, or give up after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 500): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return
    await page.keyboard.press('Tab')
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 140) ?? 'nothing')
  throw new Error(`Tab never reached ${selector}; focus is on ${at}`)
}

/** Press Tab until the focused button's text matches `pattern`. */
async function tabToButton(page: Page, pattern: RegExp, limit = 500): Promise<void> {
  for (let i = 0; i < limit; i++) {
    const hit = await page.evaluate(({ source, flags }) => {
      const el = document.activeElement
      return !!el && el.tagName === 'BUTTON' && new RegExp(source, flags).test(el.textContent ?? '')
    }, { source: pattern.source, flags: pattern.flags })
    if (hit) return
    await page.keyboard.press('Tab')
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 140) ?? 'nothing')
  throw new Error(`Tab never reached a button matching ${pattern}; focus is on ${at}`)
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** The `fleet-act` events of the ledger, read from IndexedDB (the aggregate keeps only the best score). */
async function storedActs(page: Page, ref: string) {
  return page.evaluate(
    (wanted) =>
      new Promise<{ provenance: string; seed?: number; score: number; data?: Record<string, unknown> }[]>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('events', 'readonly').objectStore('events').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve((all.result as { kind: string; ref: string; provenance: string; seed?: number; score: number; data?: Record<string, unknown> }[]).filter((e) => e.kind === 'fleet-act' && e.ref === wanted))
          }
        }
      }),
    ref,
  )
}

test('/week: receipts are cited and checked on an all-reference Act I run, and Act III passes, by keyboard at 360 px', async ({ page }) => {
  await page.goto('/week')
  await expect(page.getByRole('heading', { level: 1, name: 'Four acts. Everything executes.' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await noHorizontalScroll(page)).toBe(true)

  // the screenshot is gone: no file input anywhere on the page
  await expect(page.locator('input[type="file"]')).toHaveCount(0)

  const act1 = page.locator('section', { hasText: 'Act I — The Engine' })
  const act3 = page.locator('section', { hasText: 'Act III — The Business' })
  const editor1 = act1.locator('[data-workbench="engine"]')

  /* ---------------- Act I: an all-reference run is practice; its receipts verify all the same ---------------- */

  await tabToButton(page, /run the trace/)
  await page.keyboard.press('Enter')
  await expect(act1.getByText(/^PRACTICE — goodput/)).toBeVisible({ timeout: 90_000 })
  await expect(editor1).toBeVisible()
  expect(await noHorizontalScroll(page)).toBe(true)

  // every row that restates a value offers cite, and each is a 44 px target (to a sub-pixel: the panel is still easing in)
  const cites = act1.locator('[data-cite]')
  await expect(cites).toHaveCount(8)
  for (const box of await cites.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
    expect(box.height).toBeGreaterThanOrEqual(43.9)
    expect(box.width).toBeGreaterThanOrEqual(43.9)
  }

  // cite goodput and completed from the keyboard: the tokens land in the analysis, and the chips show them
  await tabTo(page, 'button[data-cite][aria-label^="cite your goodput"]')
  await page.keyboard.press('Enter')
  await tabTo(page, 'button[data-cite][aria-label^="cite completed"]')
  await page.keyboard.press('Enter')
  const text1 = editor1.locator('textarea')
  await expect(text1).toHaveValue(/^\[\[r:[0-9a-f]{8} goodput=[\d.]+\]\] \[\[r:[0-9a-f]{8} completed=\d+\]\] $/)
  await expect(act1.locator('[data-cite-live]')).toContainText(/^Cited completed \d+ in your analysis\.$/)
  const chips = editor1.locator('[data-receipt-preview] [data-receipt-chip]')
  await expect(chips).toHaveCount(2)
  await expect(chips.first()).toHaveAttribute('data-status', 'unchecked')

  // check them: each cited run is re-run in the worker, and each value verifies (a receipt check needs no pass)
  await tabTo(page, '[data-workbench="engine"] [data-check-receipts]')
  await page.keyboard.press('Enter')
  await expect(editor1.locator('[data-check-note]')).toHaveText('2 of 2 receipts verified by re-running.', { timeout: 90_000 })
  await expect(chips.first()).toHaveAttribute('data-status', 'verified')
  await expect(chips.nth(1)).toHaveAttribute('data-status', 'verified')
  await expect(editor1.locator('[data-receipt-checks] li[data-status="verified"]')).toHaveCount(2)
  expect(await noHorizontalScroll(page)).toBe(true)

  // an edit makes the check stale: the chips go back to unchecked until the next check
  await tabTo(page, '[data-workbench="engine"] textarea')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('Waiting, not eviction.')
  await expect(chips.first()).toHaveAttribute('data-status', 'unchecked')

  // the trace has not passed (no module of yours is in the engine), so the submit is closed and says why
  await expect(editor1.locator('[data-submit-writeup]')).toBeDisabled()
  await expect(editor1.locator('[data-blocked]')).toContainText('passes only with one of your own components')
  expect(await storedActs(page, 'fw:engine')).toHaveLength(0)

  /* ---------------- Act III: no module needed ---------------- */

  await tabToButton(page, /execute all three options/)
  await page.keyboard.press('Enter')
  const table = act3.locator('table')
  await expect(table).toBeVisible({ timeout: 90_000 })
  await expect(act3.locator('[data-workbench="business"]')).toBeVisible()
  // the table scrolls inside its own region, never the page
  expect(await noHorizontalScroll(page)).toBe(true)

  await tabTo(page, 'button[data-cite][aria-label^="cite b200 cost per Mtok"]')
  await page.keyboard.press('Enter')
  const text3 = act3.locator('[data-workbench="business"] textarea')
  await expect(text3).toHaveValue(/^\[\[r:[0-9a-f]{8} costPerMtok\.b200=\d+(\.\d+)?\]\] $/)
  await tabTo(page, '[data-workbench="business"] textarea')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('B200 clears the SLO bar.')

  await tabTo(page, '[data-workbench="business"] [data-check-receipts]')
  await page.keyboard.press('Enter')
  await expect(act3.locator('[data-check-note]')).toHaveText('1 of 1 receipts verified by re-running.', { timeout: 90_000 })
  await expect(act3.locator('[data-receipt-preview] [data-receipt-chip]').first()).toHaveAttribute('data-status', 'verified')

  // the three scored examples are read, then the four criteria are scored with the arrow keys
  await tabTo(page, '[data-workbench="business"] details[data-exemplar] summary')
  await page.keyboard.press('Enter')
  const example = act3.locator('details[data-exemplar]').first()
  await expect(example).toHaveAttribute('open', '')
  await expect(example.locator('[data-receipt-chip]').first()).toBeVisible()
  await expect(example.getByRole('list', { name: 'Scores for example 1' }).getByRole('listitem')).toHaveCount(4)
  await expect(act3.locator('details[data-exemplar]')).toHaveCount(3)
  const picks: Record<string, number> = { capacity: 2, slo: 1, cost: 3, failure: 0 }
  for (const [criterion, level] of Object.entries(picks)) {
    await tabTo(page, `[data-criterion="${criterion}"] input[type="radio"]`)
    for (let i = 0; i < level; i++) await page.keyboard.press('ArrowDown')
    if (level > 0) await expect(act3.locator(`[data-criterion="${criterion}"] input[value="${level}"]`)).toBeChecked()
    else await page.keyboard.press('Space')
  }
  await expect(act3.locator('[data-rubric-count]')).toContainText('4 of 4 scored')
  expect(await noHorizontalScroll(page)).toBe(true)

  // submit: the executed SLO check passes and the cost is a verified receipt
  await tabTo(page, '[data-workbench="business"] [data-submit-writeup]')
  await page.keyboard.press('Enter')
  await expect(act3.getByText(/^PASS — your b200 choice holds/)).toBeVisible({ timeout: 90_000 })
  await expect(act3.getByText('done', { exact: true })).toBeVisible()
  expect(await noHorizontalScroll(page)).toBe(true)

  // the act is recorded with its seed, provenance unseen, its receipts and the four self-scores, which are not in the score
  await expect.poll(async () => (await storedActs(page, 'fw:business')).length).toBe(1)
  const [event] = await storedActs(page, 'fw:business')
  expect(event.provenance).toBe('unseen')
  expect(Number.isInteger(event.seed)).toBe(true)
  expect(event.score).toBeCloseTo(1, 10)
  expect(event.data).toMatchObject({ receipts: { cited: 1, verified: 1, uncited: 0 }, rubric: { capacity: 2, slo: 1, cost: 3, failure: 0 } })
  expect((event.data?.runs as string[]).length).toBe(1)
})
