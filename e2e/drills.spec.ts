import { expect, test, type Page } from '@playwright/test'
import { designItems, interviewRef, napkinItems, roundIncident, roundPlan } from '../src/lib/mentor/interview'
import { fixFor } from '../src/lib/world/incident-spec'
import type { Instance } from '../src/lib/items/types'

// Keyboard walk of Interview mode (docs/specs/wave-3.md §16.4, §17.2, 3s-06) at 360 px: a pinned date's first round, no
// pointer after the page loads. Three napkin items (Tab to the field, type, Enter to grade, Enter for the next), the
// drill-namespace incident (hypothesis, probe, the right fix, the debrief), the two design items and the sheet that joins
// them, then the interviewer packet: read, copied, and linked. Afterwards the ledger holds one practice incident event for
// the date and nothing else: no item, prediction or help event, and no text of the packet. The items' answers come from
// the same `roundPlan` the page draws, so the walk reads the right numbers and a rewording cannot break it.

const DATE = '2026-10-23'
const plan = roundPlan(DATE, 0)

test.use({ viewport: { width: 360, height: 740 }, permissions: ['clipboard-read', 'clipboard-write'] })

/** Press Tab until the focused element matches `selector`, or give up after `limit` presses. */
async function tabTo(page: Page, selector: string, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if (await page.evaluate((s) => !!document.activeElement?.matches(s), selector)) return
    await page.keyboard.press('Tab')
  }
  const at = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120) ?? 'nothing')
  throw new Error(`Tab never reached ${selector}; focus is on ${at}`)
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** The right answer in the unit the item's select starts on (the first unit of an item that takes several). */
function answerText(inst: Instance): string {
  if (inst.answer.kind === 'estimate') return String(inst.answer.truth)
  if (inst.answer.kind !== 'numeric') throw new Error('choice item')
  const first = inst.answer.units && inst.answer.units.length > 1 ? inst.answer.units[0] : null
  return String(first ? inst.answer.truth / first.factor : inst.answer.truth)
}

/** Answer the item on screen with `value` by keyboard, read the verdict, and go on with the Next button. */
async function answerItem(page: Page, value: string, next: string | RegExp): Promise<void> {
  // the parts already visited stay mounted but hidden, so the question on screen is the one in the part that is not
  const form = page.locator('[data-part]:not([hidden]) form[aria-label="Question"]')
  await expect(form).toBeVisible()
  await tabTo(page, '[data-ks-field]')
  await page.keyboard.type(value)
  await page.keyboard.press('Enter')
  const nextButton = form.getByRole('button', { name: next })
  await expect(nextButton).toBeFocused()
  await page.keyboard.press('Enter')
}

/** Every event the ledger holds, read from IndexedDB. */
async function storedEvents(page: Page): Promise<{ kind: string; ref: string; provenance?: string; data?: { src?: string } }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('events', 'readonly').objectStore('events').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve(all.result)
          }
        }
      }),
  )
}

test('/drills: a round is walked by keyboard alone at 360 px, and only the practice incident is recorded', async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${DATE}T12:00:00`))
  await page.goto('/drills')
  await expect(page.getByRole('heading', { level: 1, name: 'Interview mode' })).toBeVisible()
  await expect(page.locator('[data-page="drills"]')).toHaveAttribute('data-round', '1')
  await page.evaluate(() => document.fonts.ready)
  expect(await noSidewaysScroll(page)).toBe(true)

  // the four parts are 44 px buttons, in order, the first current
  const buttons = page.locator('[data-part-button]')
  await expect(buttons).toHaveCount(4)
  for (const h of await buttons.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44)
  await expect(page.locator('[data-part-button="napkin"]')).toHaveAttribute('aria-current', 'step')

  // 1. the napkin round: three generated items, each answered with the right number
  const napkin = await napkinItems(plan)
  expect(napkin).toHaveLength(3)
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('[data-napkin-index]')).toHaveAttribute('data-napkin-index', String(i + 1))
    await expect(page.locator('form[aria-label="Question"]')).toContainText(`Napkin ${i + 1} of 3`)
    expect(await noSidewaysScroll(page)).toBe(true)
    if (i < 2) await answerItem(page, answerText(napkin[i].inst), 'Next napkin')
    else {
      await answerItem(page, answerText(napkin[i].inst), 'On to the incident')
    }
  }

  // 2. the incident: the part's heading takes focus, the part is current, and the worker warms the fleet up to the alert
  await expect(page.locator('[data-part-button="incident"]')).toHaveAttribute('aria-current', 'step')
  await expect(page.getByRole('heading', { level: 2, name: 'The incident' })).toBeFocused()
  await expect(page.locator('[data-part="incident"] [data-phase="play"]')).toBeVisible({ timeout: 60_000 })
  const incident = roundIncident(plan)
  await expect(page.locator('[data-part="incident"] [data-flow="alert"]')).toContainText('Incident drill')
  // hypothesis: the true fault, then the first probe takes focus; probe, then the right fix
  await tabTo(page, 'input[type="radio"]')
  await page.locator(`input[value="${incident.spec.fault}"]`).check()
  await tabTo(page, '[data-flow="hypothesis"] button')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-part="incident"] [data-probe="intake"]')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-part="incident"] [data-reading="intake"]')).toBeVisible()
  await tabTo(page, `[data-fix="${fixFor(incident.spec.fault)}"]`)
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-part="incident"] [data-record-note]')).toContainText('Recorded as practice', { timeout: 30_000 })
  expect(await noSidewaysScroll(page)).toBe(true)
  await tabTo(page, '[data-part="incident"] [data-next-part]')
  await page.keyboard.press('Enter')

  // 3. the capacity design: replicas, then the price, then the sheet that joins them
  const design = await designItems(plan)
  await expect(page.getByRole('heading', { level: 2, name: 'Capacity design' })).toBeFocused()
  await expect(page.locator('[data-design-step="replicas"]')).toBeVisible()
  await answerItem(page, answerText(design.replicas.inst), 'On to the price')
  await expect(page.locator('[data-design-step="cost"]')).toBeVisible()
  await answerItem(page, answerText(design.cost.inst), 'See the design sheet')
  const sheet = page.locator('[data-design-sheet]')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'The design, joined' })).toBeFocused()
  await expect(sheet).toContainText(`Replicas: ${(design.replicas.inst.answer as { truth: number }).truth}`)
  await expect(sheet).toContainText('price per delivered token')
  expect(await noSidewaysScroll(page)).toBe(true)
  await tabTo(page, '[data-design-sheet] [data-next-part]')
  await page.keyboard.press('Enter')

  // 4. the interviewer: the packet is read, copied and linked, and it names the three objections code chose
  await expect(page.getByRole('heading', { level: 2, name: 'The skeptical interviewer' })).toBeFocused()
  const packet = page.locator('[data-packet]')
  await expect(packet).toContainText('of 6,000 at most')
  await tabTo(page, '[data-copy-packet]')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-copy-status]')).toContainText('Copied')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied.length).toBeLessThanOrEqual(6000)
  expect(copied).toContain('skeptical systems interviewer')
  for (const o of plan.objections) expect(copied).toContain(o.says)
  // what the learner did is in it as right or off, and the incident as facts
  expect(copied).toContain('Napkin 1: answered, close')
  expect(copied).toContain('Incident drill, fault')
  expect(copied).toContain('Design, price: answered, close')
  // the same text is there to read
  await packet.locator('summary').click()
  await expect(page.locator('#interview-packet')).toHaveValue(copied)
  expect(await noSidewaysScroll(page)).toBe(true)
  // the deep links open a new tab with a short instruction, and carry no packet
  for (const agent of ['claude', 'chatgpt']) {
    const href = await page.locator(`[data-open-agent="${agent}"]`).getAttribute('href')
    expect(href!.length).toBeLessThanOrEqual(2048)
    expect(decodeURIComponent(href!)).not.toContain('Napkin')
    expect(await page.locator(`[data-open-agent="${agent}"]`).getAttribute('target')).toBe('_blank')
  }

  // the ledger: one practice incident under the team ref, and no item, prediction, help or other event, and nothing of the packet
  await page.waitForTimeout(500)
  const events = await storedEvents(page)
  expect(events.map((e) => e.kind)).toEqual(['incident'])
  expect(events[0].ref).toBe(interviewRef(DATE))
  expect(events[0].provenance).toBe('practice')
  expect(events[0].data?.src).toBe('team')
  expect(JSON.stringify(events)).not.toContain('skeptical')

  // another round is a new set of items, with focus back at the top
  await page.locator('[data-another-round]').click()
  await expect(page.locator('[data-page="drills"]')).toHaveAttribute('data-round', '2')
  await expect(page.getByRole('heading', { level: 1, name: 'Interview mode' })).toBeFocused()
  await expect(page.locator('[data-part-button="napkin"]')).toHaveAttribute('aria-current', 'step')
})

for (const width of [360, 320]) {
  test(`/drills: every part reflows at ${width} px, with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 })
    await page.clock.setFixedTime(new Date(`${DATE}T12:00:00`))
    await page.goto('/drills')
    await expect(page.locator('form[aria-label="Question"]')).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    expect(await noSidewaysScroll(page)).toBe(true)
    for (const part of ['incident', 'design', 'interviewer']) {
      await page.locator(`[data-part-button="${part}"]`).click()
      await expect(page.locator(`[data-part-button="${part}"]`)).toHaveAttribute('aria-current', 'step')
      await expect(page.locator(`[data-part="${part}"]`)).toBeVisible()
      // wait for the part's own content: the alert (a worker warms up), the first design item, the packet
      if (part === 'incident') await expect(page.locator('[data-part="incident"] [data-flow="alert"]')).toBeVisible({ timeout: 60_000 })
      if (part === 'design') await expect(page.locator('[data-design-step="replicas"] form')).toBeVisible()
      if (part === 'interviewer') await expect(page.locator('[data-copy-packet]')).toBeVisible()
      expect(await noSidewaysScroll(page)).toBe(true)
    }
    // going back keeps the napkin part where it was, and the other parts are hidden from the page
    await page.locator('[data-part-button="napkin"]').click()
    await expect(page.locator('[data-part="napkin"]')).toBeVisible()
    await expect(page.locator('[data-part="interviewer"]')).toBeHidden()
  })
}
