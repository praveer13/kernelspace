import { expect, test } from '@playwright/test'

// /glossary by keyboard: a flip card is a real button with the lesson link beside it (never inside it), and each
// flagship dot is at least 24 x 24 px (WCAG 2.2 2.5.8).

test.use({ viewport: { width: 360, height: 740 } })

test('a card flips with Enter and its lesson link opens the lesson', async ({ page }) => {
  await page.goto('/glossary')
  const card = page.locator('[id] > button[aria-expanded]').first()
  await expect(card).toBeVisible()
  await card.focus()
  await expect(card).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('[id] > a[href^="/lesson/"]')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Tab')
  const link = page.locator('[id] > a[href^="/lesson/"]').first()
  await expect(link).toBeFocused()
  const href = await link.getAttribute('href')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`${href}$`))
})

test('no interactive control sits inside another', async ({ page }) => {
  await page.goto('/glossary')
  await page.locator('[id] > button[aria-expanded]').first().click()
  expect(await page.locator('button a, a button, [role="button"] a, [role="button"] button').count()).toBe(0)
})

test('each flagship dot is at least 24 x 24 px', async ({ page }) => {
  await page.goto('/glossary')
  const dots = page.getByRole('button', { name: /Show flagship pair/ })
  await expect(dots.first()).toBeVisible()
  const n = await dots.count()
  expect(n).toBeGreaterThan(1)
  for (let i = 0; i < n; i++) {
    const box = await dots.nth(i).boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(24)
    expect(box!.height).toBeGreaterThanOrEqual(24)
  }
})
