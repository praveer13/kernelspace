import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of an active isomorphism block (docs/specs/wave-3.md §11.1, §17.2, 3b-07): /lesson/t2.l2 at 360 px, no
// pointer. No shipped lesson carries a break item until 3b-16, so the walk swaps t2.l2's isomorphism block for a fixture
// block (three pairs, a work pair for a background the profile does not have, a break item and a principle) in the one
// script chunk that holds the lessons. Tab reaches the first row, arrows move across a row's shuffled labels, Space
// chooses, Enter presses Check, "Now: where does it break?" and Submit, and the principle with the pairs follows.

const BLOCK = '[data-block="isomorphism"]'

const PAIRS = [
  { os: 'page table', osLine: 'Per-process map from virtual page to frame.', llm: 'block table', llmLine: 'Per-sequence map from logical block to KV block.', breaks: 'The MMU walks the table in hardware; the block table is plain software.' },
  { os: 'physical frame', osLine: 'A fixed unit of RAM that backs any page.', llm: 'KV block', llmLine: 'A fixed unit of GPU memory that backs any sequence.', breaks: 'A frame is 4 KiB; a block is a software choice.' },
  { os: 'swap out', osLine: 'Spill a cold page to disk and fault it back.', llm: 'preemption', llmLine: 'Free a sequence and recompute it on resume.', breaks: 'Swap keeps the bytes; preemption keeps nothing.' },
]
const ANSWER: Record<string, string> = Object.fromEntries(PAIRS.map((p) => [p.os, p.llm]))
const BREAK = {
  q: 'Where does this analogy break?',
  options: ['The MMU walks its table in hardware; the block table is software', 'Both maps are per owner', 'Both are filled lazily', 'Both let owners share entries'],
  correct: [0],
  why: ['A true break: only the OS side has hardware translation.', 'True on both sides, so not a break.', 'True on both sides, so not a break.', 'True on both sides, so not a break.'],
}
const PRINCIPLE = 'Same mechanism, different cost model: the idea carries over, the price of each step does not.'
const FIXTURE_TITLE = 'fixture block'

/** Swap t2.l2's isomorphism block for the fixture in whichever script holds the lesson data. The original pairs stay behind as an unused field. */
async function withFixture(page: Page) {
  await page.route('**/*.js', async (route) => {
    const res = await route.fetch()
    const body = await res.text()
    const head = 'type:"isomorphism",title:"virtual memory'
    const at = body.indexOf(head)
    if (at < 0) return route.fulfill({ response: res, body })
    const end = body.indexOf('pairs:[', at) + 'pairs:['.length
    const fixture = `type:"isomorphism",title:${JSON.stringify(FIXTURE_TITLE)},principle:${JSON.stringify(PRINCIPLE)},breakItem:${JSON.stringify(BREAK)},kcs:["t2.address-translation"],pairs:${JSON.stringify(PAIRS)},unused:[`
    return route.fulfill({ response: res, body: body.slice(0, at) + fixture + body.slice(end) })
  })
}

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
  await withFixture(page)
  await page.goto('/lesson/t2.l2')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  const block = page.locator(BLOCK)
  await expect(block).toHaveCount(1)
  await expect(block.locator('[data-row]')).toHaveCount(PAIRS.length)
  return block
}

test('/lesson/t2.l2: align, name the break and read the principle, by keyboard alone', async ({ page }) => {
  const block = await open(page)
  expect(await noSidewaysScroll(page)).toBe(true)
  await expect(block.getByText(FIXTURE_TITLE)).toBeVisible()
  // nothing of the answer is on screen before Check
  for (const hidden of [PRINCIPLE, PAIRS[0].breaks, PAIRS[0].llmLine, BREAK.q]) await expect(block.getByText(hidden)).toHaveCount(0)

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
    for (let k = 0; k < (want - a.at + a.labels.length) % a.labels.length; k++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')
    await expect(block.locator(`[data-row="p${i}"] [aria-pressed="true"]`)).toHaveText(ANSWER[a.os!])
  }
  expect(await noSidewaysScroll(page)).toBe(true)

  // Check is the next Tab stop; Enter grades, the live region reads the result and takes focus
  await tabUntil(page, (a) => a.name === 'Check', 1, 'Check')
  await page.keyboard.press('Enter')
  const status = block.locator('[data-align-status]')
  await expect(status).toHaveText('All 3 matched.')
  await expect(status).toHaveAttribute('aria-live', 'polite')
  await expect(block.locator('[data-verdict="right"]')).toHaveCount(PAIRS.length)
  for (const p of PAIRS) await expect(block.getByText(p.llmLine)).toBeVisible()
  expect((await active(page)).name).toBe('All 3 matched.')
  expect(await noSidewaysScroll(page)).toBe(true)

  // the break item takes focus at its heading
  await tabUntil(page, (a) => a.name === 'Now: where does it break?', 3, 'the break button')
  await page.keyboard.press('Enter')
  await expect(block.getByText(BREAK.q)).toBeVisible()
  await expect.poll(async () => (await active(page)).name).toContain('Name the break')
  await expect(block.getByText(PRINCIPLE)).toHaveCount(0)

  // Tab to the true break, Space to choose it, Enter to submit
  await tabUntil(page, (a) => a.name.includes('MMU walks its table'), 6, 'the true break option')
  await page.keyboard.press('Space')
  await page.keyboard.press('Enter')
  await expect(block.getByText(PRINCIPLE)).toBeVisible()
  for (const p of PAIRS) await expect(block.locator('[data-step="principle"]')).toContainText(p.breaks)
  await expect(block.getByText('A true break: only the OS side has hardware translation.')).toBeVisible()
  expect(await noSidewaysScroll(page)).toBe(true)
})

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
  await expect(block.locator('[data-align-status]')).toHaveText(right === PAIRS.length ? 'All 3 matched.' : `${right} of 3 matched.`)
  await expect(block.getByText(BREAK.q)).toHaveCount(0)
  if (right < PAIRS.length) {
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
