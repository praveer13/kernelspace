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

// Every face's text fits inside its card at phone width, and no card is drawn over the next one.
for (const width of [360, 390]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 844 }, reducedMotion: 'reduce' })

    test('every card face holds its text and no card covers the next', async ({ page }) => {
      await page.goto('/glossary')
      const cards = page.locator('[id]:has(> button[aria-expanded])')
      await expect(cards.first()).toBeVisible()
      const found = await cards.evaluateAll((els) => {
        const spills: string[] = []
        const boxes = els.map((el) => el.getBoundingClientRect())
        els.forEach((el, i) => {
          const faces = el.querySelectorAll(':scope > div > div')
          faces.forEach((f, j) => {
            const over = f.scrollHeight - f.clientHeight
            if (over > 1) spills.push(`${el.id} face ${j} spills ${over} px`)
            const fb = f.getBoundingClientRect()
            if (fb.bottom > boxes[i]!.bottom + 1) spills.push(`${el.id} face ${j} ends below its card`)
          })
          const next = boxes[i + 1]
          if (next && next.left < boxes[i]!.right && next.top > boxes[i]!.top && next.top < boxes[i]!.bottom - 1)
            spills.push(`${el.id} is covered by the next card`)
        })
        return { n: els.length, spills }
      })
      expect(found.n).toBeGreaterThan(20)
      expect(found.spills).toEqual([])
    })
  })
}
