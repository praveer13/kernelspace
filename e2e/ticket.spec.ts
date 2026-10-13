import { expect, test, type Page } from '@playwright/test'
import { lessonById } from '../src/data/lessons'

// Keyboard walk of an exit ticket (docs/specs/wave-2.md §22.2, 2a-32): /lesson/t3.l2 at 360 px, no pointer. Tab
// reaches the ticket, the letter keys pick, Enter submits and goes on, the constructed response opens its model
// answer by Ctrl+Enter and its ideas tick with Space. A pass is walked, then a miss, with New numbers and
// Continue anyway reached by Tab and Enter. The correct answers come from the lesson's own data, so the pass is
// deterministic whatever order the options are shuffled into.

const LESSON = 't3.l2'
const TICKET = '#exit-ticket'

const lesson = lessonById(LESSON)
const quiz = lesson?.blocks.find((b) => b.type === 'quiz')
const questions = quiz?.type === 'quiz' ? quiz.questions : []
/** Every correct option text of the checkpoint, and every wrong one: the ticket draws two of the questions. */
const RIGHT = new Set(questions.flatMap((q) => q.correct.map((i) => q.options[i])))
const WRONG = new Set(questions.flatMap((q) => q.options.filter((_, i) => !q.correct.includes(i))))

const active = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement
    return {
      inTicket: !!el?.closest('#exit-ticket'),
      option: el?.hasAttribute('data-ks-option') ?? false,
      field: el?.hasAttribute('data-ks-field') ?? false,
      model: el?.hasAttribute('data-ks-model') ?? false,
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

/** The option letters of the item on screen, with the text of each. */
const optionTexts = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(`#exit-ticket [data-ks-option]`)].map((b) => (b.textContent ?? '').replace(/^\s*[A-E]\s*Option [A-E]:\s*/, '').trim()))

const LETTERS = 'abcde'

/** Pick the first option whose text is in `from`, by its letter key, then Enter to submit. */
async function answerChoice(page: Page, from: ReadonlySet<string>): Promise<void> {
  const texts = await optionTexts(page)
  const at = texts.findIndex((t) => [...from].some((s) => t.startsWith(s) || s.startsWith(t) || t.includes(s)))
  expect(at, `no option of ${JSON.stringify(texts)} is in the wanted set`).toBeGreaterThanOrEqual(0)
  await page.keyboard.press(LETTERS[at])
  await page.keyboard.press('Enter')
  // the verdict is announced in the item's live region and Next takes focus
  await expect(page.locator(`${TICKET} [role="status"]`).filter({ hasText: /Correct|Not quite/ }).first()).toBeVisible()
}

/** The checkpoint item (Next item) or the constructed response, by what holds focus after the previous item. */
async function nextItem(page: Page): Promise<void> {
  expect((await active(page)).name).toContain('Next item')
  await page.keyboard.press('Enter')
  // the next card's first control takes focus
  await expect.poll(async () => (await active(page)).option || (await active(page)).field).toBe(true)
}

async function openTicket(page: Page): Promise<void> {
  await page.goto(`/lesson/${LESSON}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator(`${TICKET} h3`)).toHaveText(/Exit ticket/)
  await expect(page.locator(`${TICKET} [data-ks-option]`).first()).toBeVisible()
  // no sideways scroll at 360 px
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  // Tab alone reaches the ticket: the first option of item 1 is the first control inside it
  const presses = await tabUntil(page, (a) => a.inTicket, 300, 'the exit ticket')
  test.info().annotations.push({ type: 'tabs to ticket', description: String(presses) })
  expect((await active(page)).option).toBe(true)
}

/** The constructed response: type, Ctrl+Enter opens the model answer, Tab to the ideas, Space ticks `ideas` of them, Submit. */
async function answerWritten(page: Page, ideas: number): Promise<void> {
  expect((await active(page)).field).toBe(true)
  await page.keyboard.type('A slice is a pointer and a length, so it copies nothing.')
  await page.keyboard.press('Control+Enter')
  // focus moves to the model answer, then the three ideas are checkboxes in the tab order
  await expect.poll(async () => (await active(page)).model).toBe(true)
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type)).toBe('checkbox')
    if (i < ideas) await page.keyboard.press('Space')
  }
  await page.keyboard.press('Tab')
  expect((await active(page)).name).toContain('Submit')
  await page.keyboard.press('Enter')
}

test.describe('exit ticket on /lesson/t3.l2 (keyboard only)', () => {
  test('the lesson data has the checkpoint this walk reads', () => {
    expect(questions.length).toBeGreaterThanOrEqual(2)
    expect(RIGHT.size).toBeGreaterThanOrEqual(2)
    expect(WRONG.size).toBeGreaterThanOrEqual(2)
    expect(lesson?.ticket?.form).toBe('ticket')
  })

  test('a pass: two right answers and the written one, then the lesson is done', async ({ page }) => {
    await openTicket(page)
    await answerChoice(page, RIGHT)
    await nextItem(page)
    await answerChoice(page, RIGHT)
    await nextItem(page)
    await answerWritten(page, 3)

    const verdict = page.locator(`${TICKET} [role="status"]`).filter({ hasText: /^(Passed|Not yet) ·/ })
    await expect(verdict).toContainText('Passed')
    await expect(verdict).toContainText('3 of 3 right')
    await expect(verdict).toContainText('This lesson is done')
    // a pass offers no button to press: nothing is left that only a pointer could reach
    expect(await page.locator(`${TICKET} [role="status"] button`).count()).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  })

  test('a miss: Not yet, New numbers by Enter lands on a fresh item 1, Continue anyway marks it read', async ({ page }) => {
    await openTicket(page)
    await answerChoice(page, WRONG)
    await nextItem(page)
    await answerChoice(page, WRONG)
    await nextItem(page)
    await answerWritten(page, 0)

    const verdict = page.locator(`${TICKET} [role="status"]`).filter({ hasText: /^(Passed|Not yet) ·/ })
    await expect(verdict).toContainText('Not yet')
    // two equal buttons, both in the tab order, neither a trap
    const buttons = page.locator(`${TICKET} [role="status"] button`)
    await expect(buttons).toHaveText(['New numbers', 'Continue anyway'])
    const reached = await tabUntil(page, (a) => a.name === 'New numbers', 10, 'New numbers')
    expect(reached).toBeGreaterThan(0)
    await page.keyboard.press('Enter')

    // a fresh plan: item 1 again, and its first option has focus (the button that asked for it is gone)
    await expect(page.locator(`${TICKET} form`).getByText('Item 1 of 3')).toBeVisible()
    await expect.poll(async () => (await active(page)).option).toBe(true)

    // miss again quickly, then Continue anyway
    await answerChoice(page, WRONG)
    await nextItem(page)
    await answerChoice(page, WRONG)
    await nextItem(page)
    await answerWritten(page, 0)
    await expect(verdict).toContainText('Not yet')
    await tabUntil(page, (a) => a.name === 'Continue anyway', 10, 'Continue anyway')
    await page.keyboard.press('Enter')
    await expect(page.locator(`${TICKET} [role="status"]`).filter({ hasText: 'Marked as read' })).toBeVisible()
    // the ticket stays, so the page is not left without a focus target
    expect((await active(page)).tag).not.toBe('body')
  })
})
