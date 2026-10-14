import { expect, test, type Page } from '@playwright/test'
import { lessonById } from '../src/data/lessons'
import { FLEET_EXERCISES } from '../src/lib/world/fleet-ex'

// Keyboard walk of a Fleet exercise block (docs/specs/wave-3.md §5.3, §17.2, 3c-06): /lesson/t7.l2's load knee at 360
// and 320 px, no pointer, against the real fleet worker. Tab reaches the block, Enter draws a fresh seed, the scene is
// read (the knee's offered rate and slot-hold time), the prediction is typed and sent with Enter, the verdict and the
// chart with its table follow, a line of eight words opens the model answer, Space ticks its three ideas and Enter
// saves. /lesson/t6.l3's P:D split is walked as far as its verdict. A last test locks a round, reloads the page and
// finds the round counted as a miss, because the lock was recorded and the save never was (D39, D48).
// The block's ids come from the lesson's own data, so a rewording there cannot break the walk.

const BLOCK = '[data-block="fleet-exercise"]'

const kneeBlock = lessonById('t7.l2')?.blocks.find((b) => b.type === 'exercise' && 'fleet' in b)
if (kneeBlock?.type !== 'exercise' || !('fleet' in kneeBlock) || kneeBlock.fleet !== 'knee') throw new Error('t7.l2 has no knee block')
const pdBlock = lessonById('t6.l3')?.blocks.find((b) => b.type === 'exercise' && 'fleet' in b)
if (pdBlock?.type !== 'exercise' || !('fleet' in pdBlock) || pdBlock.fleet !== 'pd-split') throw new Error('t6.l3 has no pd-split block')
const KNEE = FLEET_EXERCISES.knee
const PD = FLEET_EXERCISES['pd-split']
const LINE = 'goodput peaks where arrivals meet the rate the slots free at and then the queue pushes requests past the SLO'

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return {
      inBlock: !!el?.closest('[data-block="fleet-exercise"]'),
      name: (el?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60),
      tag: el?.tagName.toLowerCase() ?? '',
      attrs: el ? [...el.attributes].map((a) => a.name) : [],
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

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const focusIs = (page: Page, attr: string) => expect.poll(async () => (await active(page)).attrs.includes(attr), { message: `${attr} has focus`, timeout: 30_000 }).toBe(true)

async function open(page: Page, lesson: string, exercise: string) {
  await page.goto(`/lesson/${lesson}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const block = page.locator(`${BLOCK}[data-exercise="${exercise}"]`)
  await expect(block).toHaveCount(1)
  await expect(block.locator('[data-fleet-draw]')).toBeVisible()
  return block
}

/** Draws a seed with the keyboard, waits for its scene and for focus to land on the prediction field. */
async function drawByKeyboard(page: Page, block: ReturnType<Page['locator']>) {
  await tabUntil(page, (a) => a.inBlock, 400, 'the Fleet exercise block')
  expect((await active(page)).name).toBe('Draw a fresh seed')
  await page.keyboard.press('Enter')
  await focusIs(page, 'data-fleet-predict')
  await expect(block.locator('[data-fleet-scene]')).toBeVisible()
  // the outcome is hidden until the lock: no verdict, no chart, no table
  await expect(block.locator('[data-verdict]')).toHaveCount(0)
  await expect(block.locator('[data-sweep-chart]')).toHaveCount(0)
}

/** The knee's answer by the scene's own reading: the highest load whose offered rate stays within Little's-law capacity. */
async function kneeFromScene(block: ReturnType<Page['locator']>): Promise<number> {
  const text = (await block.textContent()) ?? ''
  const num = (re: RegExp): number => {
    const m = re.exec(text)
    if (!m) throw new Error(`${re} is not in the panel: ${text.slice(0, 300)}`)
    return Number(m[1].replace(/,/g, ''))
  }
  const slots = num(/The engine runs (\d+) sequences at once/)
  const held = num(/A request holds a slot for:\s*([\d,.]+) ticks/)
  const offered = num(/Offered at 1×:\s*([\d,.]+) requests per second/)
  const capacity = slots / (held * 0.05)
  const fits = KNEE.points.filter((m) => m * offered <= capacity)
  return fits.length > 0 ? Math.max(...fits) : KNEE.points[0]
}

for (const width of [360, 320]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } })

    test(`/lesson/t7.l2: predict, run and explain the knee, by keyboard alone`, async ({ page }) => {
      const block = await open(page, 't7.l2', 'knee')
      expect(await noSidewaysScroll(page)).toBe(true)
      await expect(block.getByText(kneeBlock.title, { exact: true }).first()).toBeVisible()
      await expect(block.locator('[data-fleet-progress]')).toHaveText('0/3 right in a row · 0/2 different answers')
      // the In-production rows come with the claims they read
      await expect(block.getByText('max_num_seqs').first()).toBeVisible()

      await drawByKeyboard(page, block)
      expect(await noSidewaysScroll(page)).toBe(true)
      const scene = (await block.locator('[data-fleet-scene]').textContent()) ?? ''
      expect(scene).toContain('Offered at 1×')
      expect(scene).toContain('A request holds a slot for')

      // the prediction: a number read off the scene, sent with Enter
      const guess = await kneeFromScene(block)
      await page.keyboard.type(String(guess))
      await page.keyboard.press('Enter')
      const verdict = block.locator('[data-verdict]')
      await expect(verdict).toBeVisible({ timeout: 30_000 })
      const right = (await verdict.getAttribute('data-verdict')) === 'right'
      // the chart is an image described by its table, which lists the six multipliers
      const chart = block.locator('[data-sweep-chart] svg[role="img"]')
      await expect(chart).toBeVisible()
      await expect(chart).toHaveAttribute('aria-describedby', /.+/)
      await expect(block.locator('[data-sweep-chart] table tbody tr')).toHaveCount(KNEE.points.length)
      expect(await noSidewaysScroll(page)).toBe(true)

      // explain: focus is on the line; eight words open the model answer
      await focusIs(page, 'data-fleet-explain')
      await page.keyboard.type(LINE)
      await tabUntil(page, (a) => a.name === 'Show the model answer', 2, 'Show the model answer')
      await page.keyboard.press('Enter')
      await expect(block.getByText('Model answer.')).toBeVisible()
      await focusIs(page, 'data-fleet-idea')
      const save = block.locator('[data-fleet-save]')
      await expect(save).toBeDisabled()
      for (let i = 0; i < 3; i++) {
        if (i > 0) await page.keyboard.press('Tab')
        await focusIs(page, 'data-fleet-idea')
        await page.keyboard.press('Space')
        await expect(block.locator(`[data-fleet-idea="${i}"]`)).toBeChecked()
      }
      await expect(save).toBeEnabled()
      expect(await noSidewaysScroll(page)).toBe(true)
      await tabUntil(page, (a) => a.name === 'Save result', 1, 'Save result')
      // every control walked is a target of at least 24 px (WCAG 2.2 target size)
      const heights = await block.locator('button:visible, input:visible, textarea:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
      expect(Math.min(...heights)).toBeGreaterThanOrEqual(24)
      await page.keyboard.press('Enter')

      // saved: focus on the saved line, the count moved once
      await expect(block.locator('[data-saved]')).toBeFocused()
      await expect(block.locator('[data-fleet-progress]')).toHaveText(right ? '1/3 right in a row · 1/2 different answers' : '0/3 right in a row · 0/2 different answers')
      await expect(block.locator('[data-fleet-played] li')).toHaveCount(1)
      expect(await noSidewaysScroll(page)).toBe(true)

      // another seed: one Tab from the saved line to the button, Enter, and a fresh scene and field
      await tabUntil(page, (a) => a.name === 'Try a new seed', 1, 'Try a new seed')
      await page.keyboard.press('Enter')
      await focusIs(page, 'data-fleet-predict')
      await expect(block.locator('[data-fleet-scene]')).toBeVisible()
      expect(await noSidewaysScroll(page)).toBe(true)
    })
  })
}

test('/lesson/t6.l3: the P:D split shows its scene, takes a worker count and shows the sweep', async ({ page }) => {
  const block = await open(page, 't6.l3', 'pd-split')
  expect(await noSidewaysScroll(page)).toBe(true)
  await expect(block.getByText(pdBlock.title, { exact: true }).first()).toBeVisible()
  await drawByKeyboard(page, block)
  const scene = (await block.locator('[data-fleet-scene]').textContent()) ?? ''
  expect(scene).toContain('Prompts')
  expect(scene).toContain('Outputs')
  // an answer that is not one of the seven splits is refused in words, and the field keeps what was typed
  await page.keyboard.type('9')
  await page.keyboard.press('Enter')
  await expect(block.getByRole('alert')).toContainText(`Enter one of the points the sweep runs: ${PD.points.join(', ')}.`)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('4')
  await page.keyboard.press('Enter')
  await expect(block.locator('[data-verdict]')).toBeVisible({ timeout: 30_000 })
  await expect(block.locator('[data-sweep-chart] table tbody tr')).toHaveCount(PD.points.length)
  await expect(block.locator('[data-sweep-chart] table thead')).toContainText('TPOT p95')
  await focusIs(page, 'data-fleet-explain')
  expect(await noSidewaysScroll(page)).toBe(true)
})

test('a round locked and left unsaved is a miss after a reload: the run of rights cannot be erased by leaving', async ({ page }) => {
  const block = await open(page, 't7.l2', 'knee')
  await drawByKeyboard(page, block)
  await page.keyboard.type(String(await kneeFromScene(block)))
  await page.keyboard.press('Enter')
  await expect(block.locator('[data-verdict]')).toBeVisible({ timeout: 30_000 })
  // the lock is in the ledger now; the page goes away before the explain step is saved
  await expect(block.locator('[data-fleet-progress]')).toHaveText('0/3 right in a row · 0/2 different answers')
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases()).length), { message: 'the ledger database exists' }).toBeGreaterThan(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const again = page.locator(`${BLOCK}[data-exercise="knee"]`)
  await expect(again.locator('[data-fleet-draw]')).toBeVisible()
  await expect(again.locator('[data-fleet-played] li')).toHaveCount(1)
  await expect(again.locator('[data-fleet-played]')).toContainText('left before saving, counts as off')
  await expect(again.locator('[data-fleet-progress]')).toHaveText('0/3 right in a row · 0/2 different answers')
})
