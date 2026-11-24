import { expect, test } from '@playwright/test'

// ⌘K in the browser (K0-Z3, docs/specs/k0.md K0-Z-D16). The index ships encoded and the palette decodes it on first open,
// so a concept still opens its lesson at the H2 it is introduced under, a number still carries its value and claim id, and
// a lesson still matches its headings. Ctrl+K opens the palette on every host the suite runs on.

const dialog = '[role="dialog"][aria-label="Command palette"]'

test('⌘K finds a concept at its heading, a number with its value, and a lesson, from the decoded index', async ({ page }) => {
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.keyboard.press('Control+k')
  const palette = page.locator(dialog)
  const input = palette.getByPlaceholder('Search lessons, concepts, numbers, terms…')
  await expect(input).toBeFocused()

  await input.fill('PagedAttention')
  await expect(palette.getByText('Numbers', { exact: true })).toBeVisible()
  const number = palette.getByRole('button').filter({ hasText: /serving\.pagedattention\.paper-block-size/ })
  await expect(number).toBeVisible()
  await expect(number).toContainText(/\d+ tokens\/block · serving\.pagedattention\.paper-block-size/)

  const concept = palette.getByRole('button').filter({ hasText: /concept · T2\.L7/ }).first()
  await expect(concept).toBeVisible()
  await concept.click()
  await expect(page).toHaveURL(/\/lesson\/t2\.l7#4-pagedattention-paging-verbatim$/)

  await page.keyboard.press('Control+k')
  await input.fill('ridge point')
  await expect(palette.getByRole('button').filter({ hasText: /^The Roofline Model/ }).first()).toBeVisible()
  await palette.getByRole('button').filter({ hasText: /^The ridge point/ }).first().click()
  await expect(page).toHaveURL(/\/lesson\/t4\.l3#the-three-numbers-and-one-division$/)
})
