import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { CORRECT, OPTIONS } from '../src/pages/boot/whyBatching'
import { BOOT, GRADED_STEPS } from '../src/lib/boot/model'
import { BACKGROUNDS } from '../src/lib/ledger/constants'

// Keyboard walk of Boot, intro to the last step, at 360 px (docs/specs/wave-3.md §17.2; 3c final review r2, G7). No
// automated sweep reached Boot's last step (scripts/a11y.mjs's /boot stops at the intro). Every field is reached with
// Tab, filled with the keys a learner presses, and sent with Enter. What each step asks for is read from the step's
// own data (BOOT, the Reveal's OPTIONS and CORRECT), so a reworded step or a changed claim cannot break the walk.
// The last step is then checked: axe (no serious or critical), no sideways scroll at 360 and 320 px, 'Full ramp'
// naming T0.L1 and then R.L1, a background picked and cleared by keyboard ('Clear my pick' is the next Tab stop after
// the group, which holds only its radios; focus goes back to the group), and Go to Today lands on /today. A second
// walk replays Boot with the stored serving-first path: it shows as chosen and its line names no Rust.

test.use({ viewport: { width: 360, height: 800 } })
test.setTimeout(180_000)

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const STEP = 'section[aria-labelledby="boot-step-title"]'

/** Press Tab until `target` has focus, or fail after `limit` presses. Returns the presses used. */
async function tabTo(page: Page, target: Locator, what: string, limit = 120): Promise<number> {
  await expect(target, `${what} is on the page`).toBeVisible()
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((el) => el === document.activeElement)) return i
  }
  throw new Error(`Tab never reached ${what} in ${limit} presses`)
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** The page at `width`: fonts loaded and two frames laid out, so the measure reads the page as it will be seen. */
async function atWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}

/** No sideways scroll at 360 and 320 px; leaves the page at 360. */
async function expectNoSidewaysScroll(page: Page, where: string): Promise<void> {
  for (const width of [320, 360]) {
    await atWidth(page, width)
    expect(await noSidewaysScroll(page), `${where} scrolls sideways at ${width} px`).toBe(true)
  }
}

async function expectAxeClean(page: Page, where: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const worst = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(worst.map((v) => `${v.impact} ${v.id}: ${v.nodes[0]?.target.join(' ')}`), `axe on ${where}`).toEqual([])
}

/** A record of the ledger's working store, or null when it is not there. */
const storedWorking = (page: Page, key: string) =>
  page.evaluate(
    (k) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const get = db.transaction('working', 'readonly').objectStore('working').get(k)
          get.onsuccess = () => {
            db.close()
            resolve((get.result as { value: unknown } | undefined)?.value ?? null)
          }
          get.onerror = () => reject(get.error)
        }
      }),
    key,
  )

/** The `ref` and `ok` of every Boot event in the ledger, in no particular order. */
const bootEvents = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ ref: string; ok: boolean }[]>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('events', 'readonly').objectStore('events').getAll()
          all.onsuccess = () => {
            db.close()
            resolve((all.result as { ref: string; ok: boolean }[]).filter((e) => typeof e.ref === 'string' && e.ref.startsWith('boot:')).map((e) => ({ ref: e.ref, ok: e.ok })))
          }
          all.onerror = () => reject(all.error)
        }
      }),
  )

/** The step the shell says it is on, with focus on that step's heading (steps 3 to 6 are lazy, so the heading arrives late). */
async function expectStep(page: Page, n: number): Promise<void> {
  await expect(page.getByText(new RegExp(`^Step ${n} of \\d+`))).toBeVisible()
  await expect(page.locator('#boot-step-title')).toBeFocused()
}

/** Send the step's one form: Tab to its button, Enter. */
async function send(page: Page): Promise<void> {
  const button = page.locator(`${STEP} form button[type="submit"]`)
  await tabTo(page, button, "the step's button")
  await page.keyboard.press('Enter')
}

/** Check an answer, read that the verdict arrived, and move on with a second Enter on the same button. */
async function checkThenContinue(page: Page): Promise<void> {
  await send(page)
  await expect(page.locator(`${STEP} form [role="status"]`)).toHaveText(/\S/)
  await page.keyboard.press('Enter')
}

/** Tab to the step's one text field and type the answer. */
async function typeAnswer(page: Page, value: string): Promise<void> {
  const field = page.locator(`${STEP} form input[type="text"]`)
  await tabTo(page, field, "the step's number field")
  await page.keyboard.type(value)
}

/**
 * Boot from the intro to the last step, answering as a learner who knows the material: the guess, the worked example,
 * the ridge, the KV tokens, and the reason batching helps. Ends with the last step shown and its heading focused.
 */
async function walkToYou(page: Page, replay = false): Promise<void> {
  await page.goto('/boot')
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('#boot-step-title')).toBeVisible()
  expect(await noSidewaysScroll(page)).toBe(true)

  // the intro's button starts Boot; on a replay it reads Replay Boot, and the ledger may hydrate a moment after the page
  if (replay) await expect(page.locator(`${STEP} form button[type="submit"]`)).toHaveText(/replay/i)
  await send(page)
  await expectStep(page, 1)

  await typeAnswer(page, String(Math.round(BOOT.decodeTps))) // Guess
  await checkThenContinue(page)
  await expectStep(page, 2)

  await typeAnswer(page, BOOT.decodeTps.toFixed(1)) // Example
  await checkThenContinue(page)
  await expectStep(page, 3)

  await typeAnswer(page, BOOT.ridge.toFixed(1)) // Roofline
  await checkThenContinue(page)
  await expectStep(page, 4)

  await typeAnswer(page, String(Math.round(BOOT.kvTokens))) // Catch
  await checkThenContinue(page)
  await expectStep(page, 5)

  // Reveal: the options are shuffled per visit, so find the right one by its text and arrow down to it
  const radios = page.locator(`${STEP} input[name="why-batching"]`)
  const labels = await radios.evaluateAll((els) => els.map((el) => el.closest('label')?.textContent ?? ''))
  const right = labels.findIndex((t) => t.includes(OPTIONS[CORRECT].text))
  expect(right, 'the right option is on the page').toBeGreaterThanOrEqual(0)
  await tabTo(page, radios.first(), "the Reveal's first option")
  // Tab lands on the first option without choosing it; an arrow key chooses the one it moves to, Space the one it is on
  if (right === 0) await page.keyboard.press('Space')
  for (let i = 0; i < right; i++) await page.keyboard.press('ArrowDown')
  await expect(radios.nth(right)).toBeChecked()
  await checkThenContinue(page)
  await expectStep(page, 6)
  await expect(page.locator('[data-boot-first-lesson]')).toHaveText(/\S/) // the line has loaded its lessons
}

/** The line above Go to Today, once it has text. */
async function firstLine(page: Page): Promise<string> {
  const line = page.locator('[data-boot-first-lesson]')
  await expect(line).toHaveText(/\S/)
  return ((await line.textContent()) ?? '').replace(/\s+/g, ' ').trim()
}

const BG_GROUP = 'What you work on'

test('Boot by keyboard: every step to the last, then the last step is clean, picks and clears a background, and lands on Today', async ({ page }) => {
  await walkToYou(page)

  // the last step as it first shows: axe, and no sideways scroll
  await expectAxeClean(page, 'Boot, last step')
  await expectNoSidewaysScroll(page, 'Boot, last step')

  // a background: the group holds only its radios, 'Clear my pick' is the next Tab stop after it, and clearing it
  // puts focus back on the group
  const group = page.getByRole('radiogroup', { name: BG_GROUP })
  const radios = group.getByRole('radio')
  await expect(radios).toHaveCount(BACKGROUNDS.length)
  await tabTo(page, radios.first(), 'the background group')
  await expect(group.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear my pick' })).toHaveCount(0) // nothing to clear yet
  await page.keyboard.press('Space')
  await expect(radios.first()).toBeChecked()
  const clear = page.getByRole('button', { name: 'Clear my pick' })
  await expect(clear).toBeVisible()
  expect(await clear.evaluate((el) => el.closest('[role="radiogroup"]') === null), 'the button sits outside the group').toBe(true)
  await expect(group.getByRole('button')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(clear, "'Clear my pick' is the next Tab stop after the group").toBeFocused()
  await expectAxeClean(page, 'Boot, last step, with a pick and its Clear button')
  await page.keyboard.press('Enter')
  await expect(clear).toHaveCount(0)
  for (let i = 0; i < BACKGROUNDS.length; i++) await expect(radios.nth(i)).not.toBeChecked()
  expect(await page.evaluate(() => document.activeElement?.closest('[role="radiogroup"]')?.getAttribute('aria-label')), 'focus returns to the group').toBe(BG_GROUP)
  expect(await page.evaluate(() => document.activeElement?.getAttribute('type'))).toBe('radio')
  // a pick made after the clear is the one Go to Today writes
  await page.keyboard.press('Space')
  await expect(radios.first()).toBeChecked()

  // 'Full ramp' by keyboard: the line above Go to Today names T0.L1, then R.L1 right after it
  const fullRamp = page.getByRole('radio', { name: /^Full ramp/ })
  await tabTo(page, fullRamp, "the 'Full ramp' choice")
  await page.keyboard.press('Space')
  await expect(fullRamp).toBeChecked()
  await expect(page.locator('[data-boot-first-lesson]')).toContainText('T0.L1')
  const line = await firstLine(page)
  expect(line.indexOf('T0.L1'), `the line names T0.L1: ${line}`).toBeGreaterThanOrEqual(0)
  expect(line.indexOf('R.L1'), `the line names R.L1 after it: ${line}`).toBeGreaterThan(line.indexOf('T0.L1'))
  expect(line).toContain('Rust starts right after it')

  // the whole step, with the pick, the Clear button and the longest line showing
  await expectAxeClean(page, 'Boot, last step, with a pick and the Full ramp line')
  await expectNoSidewaysScroll(page, 'Boot, last step, with a pick and the Full ramp line')

  // Go to Today: by keyboard, to /today, with the path and the pick written
  await send(page)
  await page.waitForURL('**/today')
  await expect.poll(() => storedWorking(page, 'boot:path')).toBe('full-ramp')
  await expect.poll(() => storedWorking(page, 'profile:background')).toBe(BACKGROUNDS[0])
  // every graded step was answered, and as a learner who knows the material answers it, right
  await expect.poll(async () => (await bootEvents(page)).map((e) => e.ref).sort()).toEqual(GRADED_STEPS.map((s) => `boot:${s}`).sort())
  expect((await bootEvents(page)).every((e) => e.ok)).toBe(true)
})

test('Boot replayed with a stored serving-first path: the path shows as chosen and the line names no Rust', async ({ page }) => {
  // a first run that picks 'Serving first' by keyboard
  await walkToYou(page)
  // an unchosen group is one Tab stop, its first radio ('Full ramp'); the arrow key moves to the next and chooses it
  const serving = page.getByRole('radio', { name: /^Serving first/ })
  await tabTo(page, page.getByRole('radio', { name: /^Full ramp/ }), "the path group")
  await page.keyboard.press('ArrowDown')
  await expect(serving).toBeChecked()
  await send(page)
  await page.waitForURL('**/today')
  await expect.poll(() => storedWorking(page, 'boot:path')).toBe('serving-first')

  // the replay: the intro offers it, and the last step shows the stored path without a pick this time
  await walkToYou(page, true)
  await expect(page.getByRole('radio', { name: /^Serving first/ })).toBeChecked()
  await expect(page.getByRole('radio', { name: /^Full ramp/ })).not.toBeChecked()
  await expect(page.getByRole('radio', { name: /^Rust systems/ })).not.toBeChecked()
  // the line is the stored path's: it names a first lesson, and no Rust
  await expect.poll(() => firstLine(page)).toMatch(/\bT\d+\.L\d+\b/)
  const line = await firstLine(page)
  expect(line, `the serving-first line names no Rust: ${line}`).not.toMatch(/Rust|\bR\.L\d+/)
  await expectAxeClean(page, 'the replayed last step')
  await expectNoSidewaysScroll(page, 'the replayed last step')

  // Go to Today without touching the path leaves it as it was
  await send(page)
  await page.waitForURL('**/today')
  expect(await storedWorking(page, 'boot:path')).toBe('serving-first')
})
