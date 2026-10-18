import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { derive } from '../src/lib/ledger/fold'
import type { LedgerEvent } from '../src/lib/ledger/types'
import { xpOf } from '../src/lib/ledger/view'
import { dailyRef } from '../src/lib/world/daily'
import { FAULT_SHORT, fixFor } from '../src/lib/world/incident-spec'
import { SHIFT_LENGTH, shiftIncidents, shiftRef } from '../src/lib/world/shift'

// Keyboard walk of the On-Call pilot's shift (docs/specs/wave-3.md §16.6, task 3s-08; the 3s final review's G8): on a pinned
// date, /daily?shift=3 is played from the first alert through incident 1's debrief and its handoff note, and on into
// incident 2 with the carried note opened, with the keyboard alone, at 360, 320 and 1280 px. Axe runs on every state
// (no serious or critical violation), the page must not scroll sideways, and the ledger is read back from IndexedDB:
// incident 1 is recorded once, as practice, under `inc:team/shift-1/<date>`, and it set no fact and paid no XP.
//
// Nothing here hard-codes the incident or the page's wording. The shift is a function of the date (world/shift), so the walk
// takes the first incident's fault and its fix from `shiftIncidents`, finds the fault's radio in the order the page shows it,
// and compares the note on the debrief with the note carried into incident 2 by reading both from the page.

const PINNED_DATE = '2026-10-23'
const PLAN = shiftIncidents(PINNED_DATE)
const FIRST = PLAN[0]
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Press Tab until the focused element matches `selector`, or give up after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return
    await page.keyboard.press('Tab')
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120) ?? 'nothing')
  throw new Error(`Tab never reached ${selector}; focus is on ${at}`)
}

/** The shift on the pinned date, with the first incident open and the fonts ready. */
async function openShift(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(`${PINNED_DATE}T12:00:00`))
  await page.goto('/daily?shift=3')
  await expect(page.getByRole('heading', { level: 1, name: 'On-call shift' })).toBeVisible()
  // the shift's code loads, then the fleet worker warms the incident up to its alert: a few seconds
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
}

/** One state of the page: no sideways scroll, and axe finds nothing serious or critical. */
async function check(page: Page, state: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${state}: the page scrolls sideways by ${overflow} px`).toBeLessThanOrEqual(0)
  const { violations, passes } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  // axe ran its rules on this state (a page it could not read would pass with nothing checked)
  expect(passes.length, `${state}: axe checked nothing`).toBeGreaterThan(10)
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    bad.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
    `${state}: axe`,
  ).toEqual([])
}

/** Every event the ledger holds, read from IndexedDB (the aggregate keeps scores, not the events). */
function storedEvents(page: Page): Promise<LedgerEvent[]> {
  return page.evaluate(
    () =>
      new Promise<LedgerEvent[]>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('events', 'readonly').objectStore('events').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve(all.result as LedgerEvent[])
          }
        }
      }),
  )
}

for (const width of [360, 320, 1280]) {
  test.describe(`${width} px`, () => {
    test.use({ viewport: { width, height: 740 } })

    test('/daily?shift=3: incident 1 by keyboard to its handoff note, then incident 2 with the carried note open', async ({ page }) => {
      test.setTimeout(240_000)
      await openShift(page)

      // The shift's own page: three incidents, the first one, on the pinned date.
      const root = page.locator('[data-page="daily"]')
      await expect(root).toHaveAttribute('data-daily-date', PINNED_DATE)
      await expect(root).toHaveAttribute('data-shift', String(SHIFT_LENGTH))
      await expect(root).toHaveAttribute('data-shift-step', '1')
      await expect(page.locator('[data-shift-head]')).toHaveText(`Incident 1 of ${SHIFT_LENGTH}`)
      await expect(page.locator('[data-shift-intro]')).toContainText(`${SHIFT_LENGTH} incidents in a row`)
      await expect(page.locator('[data-flow="alert"]')).toBeVisible()
      // an ordinary Daily's line and Season 0's are not on the shift
      await expect(page.locator('[data-season0]')).toHaveCount(0)
      await check(page, 'incident 1, alert')

      // Hypothesis: the radio group is walked by the arrow keys to the incident's fault, wherever the page put it.
      await tabTo(page, 'input[type="radio"]')
      const order = await page.locator('input[type="radio"]').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
      expect(order).toContain(FIRST.spec.fault)
      for (let i = 0; i < order.indexOf(FIRST.spec.fault); i++) await page.keyboard.press('ArrowDown')
      await expect(page.locator(`input[value="${FIRST.spec.fault}"]`)).toBeChecked()
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Log hypothesis' })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-flow="hypothesis"]')).toHaveAttribute('data-logged', FIRST.spec.fault)

      // One probe: focus is already on the first open one, and the reading takes focus.
      const firstProbe = await page.evaluate(() => document.activeElement?.getAttribute('data-probe') ?? null)
      expect(firstProbe).not.toBeNull()
      await page.keyboard.press('Enter')
      await expect(page.locator(`[data-reading="${firstProbe}"] [data-reading-heading]`)).toBeFocused()
      await check(page, 'incident 1, after a probe')

      // The fix for the fault goes in, the incident replays to recovery, and the debrief takes focus.
      await tabTo(page, `[data-fix="${fixFor(FIRST.spec.fault)}"]`)
      await page.keyboard.press('Enter')
      const debrief = page.locator('[data-flow="debrief"][data-debrief="done"]')
      await expect(debrief).toBeVisible({ timeout: 60_000 })
      await expect(debrief.getByRole('heading', { level: 2 })).toBeFocused()
      await expect(debrief.locator('[data-record-note]')).toHaveText(`Recorded as practice: incident 1 of ${SHIFT_LENGTH}.`)

      // The handoff note names the closed incident and the fault, and says what was held; it is read from the page.
      const note = debrief.locator('[data-handoff="next"]')
      await expect(note).toBeVisible()
      await expect(note.getByRole('heading', { level: 3 })).toHaveText('Handoff note: incident 1 to 2')
      const noteLines = await note.locator('li').allInnerTexts()
      expect(noteLines.length).toBeGreaterThanOrEqual(5)
      expect(noteLines[0]).toContain(`incident 1 of ${SHIFT_LENGTH}`)
      expect(noteLines[0]).toContain(FAULT_SHORT[FIRST.spec.fault])
      expect(noteLines.some((l) => l.startsWith('Diagnosis:'))).toBe(true)
      await expect(note).toContainText('not saved')
      await check(page, 'incident 1, debrief with the handoff note')

      // The ledger holds the incident once, as practice under the team ref, with no fact and no XP.
      await expect.poll(async () => (await storedEvents(page)).filter((e) => e.kind === 'incident').length).toBe(1)
      const afterOne = await storedEvents(page)
      const mine = afterOne.filter((e) => e.kind === 'incident' && e.ref === shiftRef(PINNED_DATE, 0))
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatchObject({ provenance: 'practice', data: { src: 'team', fault: FIRST.spec.fault } })
      expect(afterOne.some((e) => e.ref === dailyRef(PINNED_DATE))).toBe(false)
      const agg = derive(afterOne)
      expect(Object.keys(agg.facts).filter((k) => k.startsWith('inc:'))).toEqual([])
      expect(xpOf(agg)).toBe(0)

      // Incident 2 from the keyboard: focus moves to the new header, the alert opens, and the note comes along folded away.
      await tabTo(page, '[data-next-incident]')
      await page.keyboard.press('Enter')
      await expect(page.locator('[data-shift-head]')).toBeFocused()
      await expect(page.locator('[data-shift-head]')).toHaveText(`Incident 2 of ${SHIFT_LENGTH}`)
      await expect(root).toHaveAttribute('data-shift-step', '2')
      await expect(root).toHaveAttribute('data-phase', 'play', { timeout: 60_000 })
      await expect(page.locator('[data-live]')).toContainText('handoff note from incident 1')
      const carried = page.locator('[data-handoff="carried"]')
      await expect(carried).toBeVisible()
      await expect(carried).not.toHaveAttribute('open', '')
      await check(page, 'incident 2, carried note folded')

      // Open it from the keyboard: it is the note from the debrief, word for word, and it sits above the alert.
      await tabTo(page, '[data-handoff="carried"] summary')
      await page.keyboard.press('Enter')
      await expect(carried).toHaveAttribute('open', '')
      expect(await carried.locator('li').allInnerTexts()).toEqual(noteLines)
      const noteTop = (await carried.boundingBox())?.y ?? Number.NaN
      const alertTop = (await page.locator('[data-flow="alert"]').boundingBox())?.y ?? Number.NaN
      expect(noteTop).toBeLessThan(alertTop)
      await check(page, 'incident 2, carried note open')

      // Moving on wrote nothing: still incident 1 alone, and no Daily.
      const afterTwo = await storedEvents(page)
      expect(afterTwo.filter((e) => e.kind === 'incident').map((e) => e.ref)).toEqual([shiftRef(PINNED_DATE, 0)])
    })
  })
}

// The shift's code is a chunk of its own (D74). When it cannot be fetched (offline, or a deploy replaced the chunks), the page
// says so and its retry is a reload: the browser keeps a failed dynamic import for the life of the page, so a second
// import() would only get the failure back. main.tsx's preload handler may reload once on its own first; the card is what
// remains when that reload fails too.
test('the shift says when its code did not load, and a reload brings it', async ({ page }) => {
  let blocked = true
  await page.route(/\/assets\/shift-kit-[^/]+\.js$/, (route) => (blocked ? route.abort() : route.continue()))
  await page.clock.setFixedTime(new Date(`${PINNED_DATE}T12:00:00`))
  await page.goto('/daily?shift=3')
  const card = page.locator('[data-failure]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.getByRole('heading')).toHaveText('The shift did not load')
  // nothing of the shift was played, so nothing was written
  expect((await storedEvents(page)).filter((e) => e.kind === 'incident')).toEqual([])
  await check(page, 'the shift kit failed')
  blocked = false
  await card.getByRole('button', { name: 'Reload to try again' }).click()
  await expect(page.locator('[data-page="daily"][data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  await expect(card).toHaveCount(0)
})
