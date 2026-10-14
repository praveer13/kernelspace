import { expect, test, type Page } from '@playwright/test'
import { lessonById } from '../src/data/lessons'

// Keyboard walk of an active isomorphism block (docs/specs/wave-3.md §11.1, §17.2, 3b-07): /lesson/t2.l2 at 360 and
// 320 px, no pointer. Since 3b-16 the lesson ships a real break item and principle, so the walk goes through the real
// block and reads what it needs (the pairs, each row's right label, the break item's question and right option, the
// principle) from the lesson's own data, so a rewording there cannot break it. Tab reaches the first row, arrows move
// across a row's shuffled labels, Space chooses, Enter presses Check, "Now: where does it break?" and Submit, and the
// principle with the pairs follows. A profile with a background would add a work row (never graded); the e2e profile
// has none, so the rows are the pairs.

const BLOCK = '[data-block="isomorphism"]'

const iso = lessonById('t2.l2')?.blocks.find((b) => b.type === 'isomorphism')
if (iso?.type !== 'isomorphism' || !iso.breakItem || !iso.principle) throw new Error('t2.l2 has no active isomorphism block')
const PAIRS = iso.pairs
const ANSWER: Record<string, string> = Object.fromEntries(PAIRS.map((p) => [p.os, p.llm]))
const TITLE = iso.title ?? ''
const PRINCIPLE = iso.principle
const BREAK_Q = iso.breakItem.q
/** The break option that is right, as the option button's accessible name begins (the name is cut at 60 characters). */
const RIGHT_OPTION = iso.breakItem.options[iso.breakItem.correct[0]].slice(0, 40)
const RIGHT_WHY = iso.breakItem.why[iso.breakItem.correct[0]]
const N = PAIRS.length

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    const row = el?.closest('[data-row]')
    const labels = row ? [...row.querySelectorAll('[data-ks-label]')] : []
    return {
      inBlock: !!el?.closest('[data-block="isomorphism"]'),
      row: row?.getAttribute('data-row') ?? null,
      os: row?.querySelector('[role="group"] > div')?.textContent?.replace(' pairs with which LLM idea?', '').trim() ?? null,
      labels: labels.map((l) => (l.textContent ?? '').trim()),
      at: labels.indexOf(el as Element),
      name: (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
      tag: el?.tagName.toLowerCase() ?? '',
    }
  })

async function tabUntil(page: Page, until: (a: Awaited<ReturnType<typeof active>>) => boolean, limit: number, what: string): Promise<number> {
  for (let i = 1; i <= limit; i++) {
    await page.keyboard.press('Tab')
    if (until(await active(page))) return i
  }
  throw new Error(`Tab never reached ${what} in ${limit} presses`)
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function open(page: Page) {
  await page.goto('/lesson/t2.l2')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const block = page.locator(BLOCK)
  await expect(block).toHaveCount(1)
  await expect(block.locator('[data-row]')).toHaveCount(N)
  return block
}

for (const width of [360, 320]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test(`/lesson/t2.l2: align, name the break and read the principle, by keyboard alone`, async ({ page }) => {
      const block = await open(page)
      expect(await noSidewaysScroll(page)).toBe(true)
      await expect(block.getByText(TITLE)).toBeVisible()
      // nothing of the answer is on screen before Check
      for (const hidden of [PRINCIPLE, PAIRS[0].breaks, PAIRS[0].llmLine, BREAK_Q]) await expect(block.getByText(hidden)).toHaveCount(0)

      // every label of every row is a tap target of at least 44 px
      const heights = await block.locator('[data-ks-label]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(44)

      // Tab reaches the first row; one Tab stop per row, so each Tab after a choice lands on the next row
      const toBlock = await tabUntil(page, (a) => a.inBlock, 400, 'the isomorphism block')
      expect((await active(page)).row).toBe('p0')
      test.info().annotations.push({ type: 'tabs', description: `${toBlock} Tabs to the block` })
      for (const [i] of PAIRS.entries()) {
        if (i > 0) await tabUntil(page, (a) => a.row === `p${i}`, 1, `row p${i}`)
        // already on the row: arrow to the label and press Space
        const a = await active(page)
        expect(a.row).toBe(`p${i}`)
        const want = a.labels.indexOf(ANSWER[a.os!])
        expect(want, `row ${a.os} offers its right label`).toBeGreaterThanOrEqual(0)
        for (let k = 0; k < (want - a.at + a.labels.length) % a.labels.length; k++) await page.keyboard.press('ArrowRight')
        await page.keyboard.press('Space')
        await expect(block.locator(`[data-row="p${i}"] [aria-pressed="true"]`)).toHaveText(ANSWER[a.os!])
      }
      expect(await noSidewaysScroll(page)).toBe(true)

      // Check is the next Tab stop; Enter grades, the live region reads the result and takes focus
      await tabUntil(page, (a) => a.name === 'Check', 1, 'Check')
      await page.keyboard.press('Enter')
      const status = block.locator('[data-align-status]')
      await expect(status).toHaveText(`All ${N} matched.`)
      await expect(status).toHaveAttribute('aria-live', 'polite')
      await expect(block.locator('[data-verdict="right"]')).toHaveCount(N)
      for (const p of PAIRS) await expect(block.getByText(p.llmLine)).toBeVisible()
      expect((await active(page)).name).toBe(`All ${N} matched.`)
      expect(await noSidewaysScroll(page)).toBe(true)

      // the break item takes focus at its heading
      await tabUntil(page, (a) => a.name === 'Now: where does it break?', 3, 'the break button')
      await page.keyboard.press('Enter')
      await expect(block.getByText(BREAK_Q)).toBeVisible()
      await expect.poll(async () => (await active(page)).name).toContain('Name the break')
      await expect(block.getByText(PRINCIPLE)).toHaveCount(0)
      expect(await noSidewaysScroll(page)).toBe(true)

      // Tab to the true break, Space to choose it, Enter to submit
      await tabUntil(page, (a) => a.name.includes(RIGHT_OPTION), 6, 'the true break option')
      await page.keyboard.press('Space')
      await page.keyboard.press('Enter')
      await expect(block.getByText(PRINCIPLE)).toBeVisible()
      for (const p of PAIRS) await expect(block.locator('[data-step="principle"]')).toContainText(p.breaks!)
      await expect(block.getByText(RIGHT_WHY)).toBeVisible()
      expect(await noSidewaysScroll(page)).toBe(true)
    })
  })
}

test('a wrong match is explained row by row, a retry re-shuffles and the break question waits for the learner', async ({ page }) => {
  const block = await open(page)
  await tabUntil(page, (a) => a.inBlock, 400, 'the isomorphism block')
  // choose the first label offered on every row, whatever it is
  for (const [i] of PAIRS.entries()) {
    if (i > 0) await tabUntil(page, (a) => a.row === `p${i}`, 1, `row p${i}`)
    await page.keyboard.press('Space')
  }
  await tabUntil(page, (a) => a.name === 'Check', 1, 'Check')
  await page.keyboard.press('Enter')
  const verdicts = await block.locator('[data-verdict]').evaluateAll((els) => els.map((e) => e.getAttribute('data-verdict')))
  const right = verdicts.filter((v) => v === 'right').length
  await expect(block.locator('[data-align-status]')).toHaveText(right === N ? `All ${N} matched.` : `${right} of ${N} matched.`)
  await expect(block.getByText(BREAK_Q)).toHaveCount(0)
  if (right < N) {
    await expect(block.getByText(/Not that one: .* pairs with .*\./).first()).toBeVisible()
    await tabUntil(page, (a) => a.name === 'Try again', 2, 'Try again')
    await page.keyboard.press('Enter')
    await expect(block.locator('[data-verdict]')).toHaveCount(0)
    await expect(block.locator('[aria-pressed="true"]')).toHaveCount(0)
  }
})

test('reduced motion: the label buttons do not animate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const block = await open(page)
  const durations = await block.locator('[data-ks-label]').evaluateAll((els) => els.map((e) => getComputedStyle(e).transitionDuration))
  for (const d of durations) expect(parseFloat(d.split(',')[0])).toBeLessThanOrEqual(0.001)
})
