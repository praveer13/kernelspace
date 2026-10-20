import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// The serving-first Rust reading block on a phone (docs/specs/serving-reading.md §8 M1 item 4; PLAN's F3, "a graded Rust
// item on a phone"), at 360 and 320 px, by keyboard alone.
//
// With the serving-first path stored and a cold cache (every test is a fresh browser context), /lesson/t5.l5 shows a
// Rust item and never "no question to show right now". B2's first draws are a verdict and then a fix (its `variants`
// interleave the kinds), so one walk meets both: each is answered with letter keys and Enter, the verdict lands in an
// `aria-live` region, and with a verdict and then a fix on screen the page does not scroll sideways and axe reports
// nothing serious. With a stored full-ramp path the block is one collapsed line and no `gen:compile/` event is written
// until "Practice anyway" is pressed.

const BLOCK = '[data-block="reading"]'
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const WIDTHS = [360, 320]
const LESSON = '/lesson/t5.l5'

test.setTimeout(120_000)

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return {
      inBlock: !!el?.closest('[data-block="reading"]'),
      option: el?.hasAttribute('data-ks-option') ?? false,
      name: (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
    }
  })

/** Press Tab until `until` holds for the focused element, or fail after `limit` presses. */
async function tabUntil(page: Page, until: (a: Awaited<ReturnType<typeof active>>) => boolean, limit: number, what: string): Promise<number> {
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press('Tab')
    if (until(await active(page))) return i
  }
  throw new Error(`Tab never reached ${what} in ${limit} presses`)
}

/** The page at `width`: fonts loaded and two frames laid out, so the measure reads the page as it will be seen. */
async function atWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 800 })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function expectAxeClean(page: Page, where: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  const worst = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(worst.map((v) => `${v.impact} ${v.id}: ${v.nodes[0]?.target.join(' ')}`), `axe on ${where}`).toEqual([])
}

/** Store the learner's path as Boot would, then load `url`: the ledger exists after a first load, and the page reads it on the next. */
async function openWithPath(page: Page, path: 'serving-first' | 'full-ramp', url: string): Promise<void> {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('working', 'readwrite')
          tx.objectStore('working').put({ key: 'boot:path', value, at: new Date().toISOString(), dev: 'e2e' })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    path,
  )
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
}

/** The ref and data of every `gen:compile/` event in the ledger. */
const compileEvents = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ ref: string; ok: boolean; src: unknown; lessonId: unknown; grp: unknown }[]>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('events', 'readonly').objectStore('events').getAll()
          all.onsuccess = () => {
            db.close()
            resolve(
              (all.result as { ref: string; ok: boolean; data?: Record<string, unknown> }[])
                .filter((e) => typeof e.ref === 'string' && e.ref.startsWith('gen:compile/'))
                .map((e) => ({ ref: e.ref, ok: e.ok, src: e.data?.src, lessonId: e.data?.lessonId, grp: e.data?.grp })),
            )
          }
          all.onerror = () => reject(all.error)
        }
      }),
  )

for (const width of WIDTHS) {
  test(`${LESSON} at ${width} px: a cold load shows a Rust verdict and then a fix, answered by keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openWithPath(page, 'serving-first', LESSON)
    await atWidth(page, width)
    const block = page.locator(BLOCK)
    await expect(block).toHaveCount(1)
    await expect(block).toHaveAttribute('data-lesson', 't5.l5')
    await expect(block.getByText('This block has no question to show right now.')).toHaveCount(0)
    await expect(block.getByText('Could not load these questions.')).toHaveCount(0)

    // the verdict item: a code snippet and four options, one of them "compiles with 0 errors"
    const firstOption = block.locator('[data-ks-option]').first()
    await expect(firstOption).toBeVisible()
    await expect(block.locator('[data-ks-option]')).toHaveCount(4)
    await expect(block).toContainText('Which error does rustc report for this code, if any?')
    await expect(block).toContainText('compiles with 0 errors')
    await expect(block.locator('[data-item-progress]')).toHaveText('0/3')
    expect(await noSidewaysScroll(page), 'the verdict item scrolls sideways').toBe(true)

    // Tab alone reaches the first option; a letter picks it and Enter sends it
    const tabs = await tabUntil(page, (a) => a.inBlock && a.option, 400, 'the first option of the reading block')
    test.info().annotations.push({ type: 'tabs', description: `${tabs} to the first option` })
    await page.keyboard.press('a')
    await expect(block.locator('[data-ks-option][aria-pressed="true"]')).toHaveCount(1)
    await page.keyboard.press('Enter')

    // the verdict is announced: the polite live region holds it, and focus has moved on to "Another snippet"
    const live = block.locator('form [role="status"][aria-live="polite"]').first()
    await expect(live).toHaveText(/Correct\.|Not quite\. The answer is [A-D]\./)
    expect((await active(page)).name).toContain('Another snippet')
    await expect(block.locator('[data-ks-option]').first()).toBeDisabled()
    expect(await noSidewaysScroll(page), 'the answered verdict item scrolls sideways').toBe(true)
    await expectAxeClean(page, `${LESSON} at ${width} px, a verdict answered`)

    // the next draw is a fix: a stem that gives rustc's code and asks for the one-line change
    await page.keyboard.press('Enter')
    await expect(block).toContainText('Which one-line change makes it compile without changing what it does?')
    await expect(block.locator('[data-ks-option]').first()).toBeEnabled()
    await expect.poll(async () => (await active(page)).option, { message: 'the fix item takes focus on its first option' }).toBe(true)
    expect(await noSidewaysScroll(page), 'the fix item scrolls sideways').toBe(true)
    await page.keyboard.press('b')
    await page.keyboard.press('Enter')
    await expect(block.locator('form [role="status"][aria-live="polite"]').first()).toHaveText(/Correct\.|Not quite\. The answer is [A-D]\./)
    expect((await active(page)).name).toContain('Another snippet')
    await atWidth(page, width)
    expect(await noSidewaysScroll(page), 'the answered fix item scrolls sideways').toBe(true)
    await expectAxeClean(page, `${LESSON} at ${width} px, a fix answered`)

    // both answers reached the ledger as lesson items of this block, with the block's group
    await expect.poll(async () => (await compileEvents(page)).length).toBe(2)
    const events = await compileEvents(page)
    expect(events.map((e) => e.src)).toEqual(['lesson', 'lesson'])
    expect(events.map((e) => e.lessonId)).toEqual(['t5.l5', 't5.l5'])
    expect(events.map((e) => e.grp)).toEqual(['t5.l5#6', 't5.l5#6'])
    expect(events.map((e) => e.ref.split('/')[1].split('.')[0]).sort()).toEqual(['fix', 'verdict'])
  })
}

for (const width of WIDTHS) {
  test(`${LESSON} at ${width} px with the full ramp stored: one collapsed line, and nothing is written until "Practice anyway"`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openWithPath(page, 'full-ramp', LESSON)
    await atWidth(page, width)
    const block = page.locator(BLOCK)
    await expect(block).toHaveCount(1)
    await expect(block.getByText('Rust Zero covers this on your path. Practice anyway?')).toBeVisible()
    await expect(block.locator('[data-ks-option]')).toHaveCount(0)
    await expect(block.locator('[data-item-progress]')).toHaveText('')
    expect(await noSidewaysScroll(page), 'the collapsed block scrolls sideways').toBe(true)
    await expectAxeClean(page, `${LESSON} at ${width} px, collapsed`)
    expect(await compileEvents(page), 'nothing is written while the block is collapsed').toEqual([])

    // it opens from the keyboard, shows an item, and writes only once something is answered
    await tabUntil(page, (a) => a.inBlock && a.name === 'Practice anyway', 400, 'the Practice anyway button')
    await page.keyboard.press('Enter')
    await expect(block.locator('[data-ks-option]').first()).toBeVisible()
    expect(await compileEvents(page), 'opening the block writes nothing').toEqual([])
    expect(await noSidewaysScroll(page), 'the opened block scrolls sideways').toBe(true)
    await expectAxeClean(page, `${LESSON} at ${width} px, opened from the collapsed line`)
    await expect.poll(async () => (await active(page)).option, { message: 'the opened item takes focus on its first option' }).toBe(true)
    await page.keyboard.press('a')
    await page.keyboard.press('Enter')
    await expect(block.locator('form [role="status"][aria-live="polite"]').first()).toHaveText(/Correct\.|Not quite\. The answer is [A-D]\./)
    await expect.poll(async () => (await compileEvents(page)).length).toBe(1)
  })
}
