import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { lessonById } from '../src/data/lessons'
import { FLEET_EXERCISES } from '../src/lib/world/fleet-ex'

// The stretch Fleet exercises of docs/specs/wave-3.md §16.3 (3s-04, 3s-05) in a real browser, against the real fleet worker:
// /lesson/t7.l2's broken benchmark (a free number of milliseconds, a table and no chart) and /lesson/t6.l6's push your
// luck (a draft length, a speedup chart), then /lesson/t6.l7's rollout straggler (an idle share in percent) and
// /lesson/t6.l10's prefix-cache timing oracle (the probe's gap in ms or the hit rate lost in points, as the seed asks), both a table and no chart. At 360 px the panel is in phone mode (the canonical seed, which earns
// nothing); "Run it on a fresh seed here instead" draws a fresh one, the learner predicts, reads the verdict, explains,
// ticks the three ideas and saves. Each walk ends with axe on the block and a check that nothing scrolls sideways.
// The right answer is the exercise's own `truth` on the seed the page shows, so a rewording of the scene cannot break it.

const BLOCK = '[data-block="fleet-exercise"]'
const LINE = 'the speedup comes from how many tokens are accepted against what the draft costs each round'

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function open(page: Page, lesson: string, exercise: string): Promise<Locator> {
  await page.goto(`/lesson/${lesson}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const block = page.locator(`${BLOCK}[data-exercise="${exercise}"]`)
  await expect(block).toHaveCount(1)
  await block.scrollIntoViewIfNeeded()
  return block
}

async function seedOf(block: Locator): Promise<number> {
  const seed = Number(/Seed (\d+)/.exec((await block.locator('[data-seed]').textContent()) ?? '')?.[1])
  expect(Number.isInteger(seed)).toBe(true)
  return seed
}

async function axeOn(page: Page, block: Locator) {
  const id = await block.getAttribute('data-exercise')
  const results = await new AxeBuilder({ page }).include(`${BLOCK}[data-exercise="${id}"]`).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

// `bad` is a value the exercise refuses, `wrong` a value it takes and marks a miss (a percentage must stay within 0 … 100)
const CASES = [
  { lesson: 't7.l2', id: 'broken-bench', chart: false, rows: 2, header: 'p95 TTFT (ms)', invalid: 'Enter the p95 time to first token as a number of milliseconds', bad: '0', wrong: (t: number) => Math.round(t * 3) },
  { lesson: 't6.l6', id: 'push-luck', chart: true, rows: 8, header: 'Speedup', invalid: 'Enter one of the points the sweep runs: 1, 2, 3, 4, 5, 6, 7, 8.', bad: '99', wrong: (t: number) => (t === 1 ? 2 : 1) },
  // 3s-05: the model-only straggler (a percentage, a table and no chart) and the timing oracle (ms or points as asked, a table and no chart)
  { lesson: 't6.l7', id: 'straggler', chart: false, rows: 7, header: 'Idle share (%)', invalid: 'Enter the idle share as a percentage from 0 to 100', bad: '-1', wrong: (t: number) => (t > 50 ? t - 30 : t + 30) },
  { lesson: 't6.l10', id: 'timing-oracle', chart: false, rows: 2, header: 'Probe gap (ms)', invalid: 'Enter the number asked for: the probe’s gap in milliseconds', bad: '-1', wrong: (t: number) => 2 * t + 20 },
] as const

for (const c of CASES) {
  const def = FLEET_EXERCISES[c.id]
  const lessonBlock = lessonById(c.lesson)?.blocks.find((b) => b.type === 'exercise' && 'fleet' in b && b.fleet === c.id)
  if (lessonBlock?.type !== 'exercise' || !('fleet' in lessonBlock)) throw new Error(`${c.lesson} has no ${c.id} block`)

  test(`/lesson/${c.lesson} (360 px): ${c.id} walks phone outcome → fresh seed → verdict → explain → saved`, async ({ page }) => {
    const block = await open(page, c.lesson, c.id)
    await expect(block).toHaveAttribute('data-mode', 'phone')
    await expect(block.getByText(lessonBlock.title, { exact: true }).first()).toBeVisible()
    await expect(block.locator('[data-fleet-scene]')).toBeVisible()
    expect(await noSidewaysScroll(page)).toBe(true)
    // the note states the answer rule, so it waits for the lock
    await expect(block.locator('[data-fleet-note]')).toHaveCount(0)

    // a value the exercise does not take is refused in words, and nothing is shown
    await block.locator('[data-fleet-predict]').fill(c.bad)
    await block.locator('[data-fleet-lock]').click()
    await expect(block.getByRole('alert')).toContainText(c.invalid)
    await expect(block.locator('[data-verdict]')).toHaveCount(0)

    // the canonical seed: lock the right answer and read the outcome, which earns nothing
    await block.locator('[data-fleet-predict]').fill(String(def.truth(def.phone.canonical)))
    await block.locator('[data-fleet-lock]').click()
    await expect(block.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'right')
    await expect(block.locator('[data-fleet-note]')).toBeVisible()
    await expect(block.locator('[data-sweep-chart] table tbody tr')).toHaveCount(c.rows)
    await expect(block.locator('[data-sweep-chart] svg[role="img"]')).toHaveCount(c.chart ? 1 : 0)
    await expect(block.locator('[data-fleet-progress]')).toHaveText('')
    expect(await noSidewaysScroll(page)).toBe(true)
    await axeOn(page, block)

    // a fresh seed here instead
    await block.getByRole('button', { name: 'Run it on a fresh seed here instead' }).click()
    await expect(block).toHaveAttribute('data-mode', 'embed')
    await expect(block.locator('[data-fleet-draw]')).toBeFocused()
    await block.locator('[data-fleet-draw]').click()
    await expect(block.locator('[data-fleet-scene]')).toBeVisible({ timeout: 30_000 })
    await expect(block.locator('[data-verdict]')).toHaveCount(0)
    await expect(block.locator('[data-sweep-chart]')).toHaveCount(0)
    const seed = await seedOf(block)
    expect(await noSidewaysScroll(page)).toBe(true)

    await block.locator('[data-fleet-predict]').fill(String(def.truth(def.sweep(seed))))
    await block.locator('[data-fleet-lock]').click()
    await expect(block.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'right', { timeout: 30_000 })
    await expect(block.locator('[data-sweep-chart] table thead')).toContainText(c.header)
    await expect(block.locator('[data-sweep-chart] table tbody tr')).toHaveCount(c.rows)
    await expect(block.locator('[data-sweep-chart] svg[role="img"]')).toHaveCount(c.chart ? 1 : 0)
    expect(await noSidewaysScroll(page)).toBe(true)

    await block.locator('[data-fleet-explain]').fill(LINE)
    await block.locator('[data-fleet-reveal]').click()
    await expect(block.getByText('Model answer.')).toBeVisible()
    for (const i of [0, 1, 2]) await block.locator(`[data-fleet-idea="${i}"]`).check()
    await block.locator('[data-fleet-save]').click()
    await expect(block.locator('[data-saved]')).toBeVisible()
    await expect(block.locator('[data-fleet-progress]')).toHaveText('1/3 right in a row · 1/2 different answers')
    expect(await noSidewaysScroll(page)).toBe(true)
    await axeOn(page, block)
  })

  test(`/lesson/${c.lesson} (1280 px): ${c.id} runs in the lesson, and a wrong answer is a miss`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const block = await open(page, c.lesson, c.id)
    await expect(block).toHaveAttribute('data-mode', 'embed')
    await block.locator('[data-fleet-draw]').click()
    await expect(block.locator('[data-fleet-scene]')).toBeVisible({ timeout: 30_000 })
    const seed = await seedOf(block)
    const truth = def.truth(def.sweep(seed))
    const wrong = c.wrong(truth)
    await block.locator('[data-fleet-predict]').fill(String(wrong))
    await block.locator('[data-fleet-lock]').click()
    await expect(block.locator('[data-verdict]')).toHaveAttribute('data-verdict', 'off', { timeout: 30_000 })
    await expect(block.locator('[data-verdict]')).toContainText('Your prediction was off.')
    await expect(block.locator('[data-sweep-chart] table tbody tr')).toHaveCount(c.rows)
    expect(await noSidewaysScroll(page)).toBe(true)
    await axeOn(page, block)
  })
}
