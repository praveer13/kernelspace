import { expect, test } from '@playwright/test'

// An old link to a renamed t2.l7 heading lands on the new heading and the URL hash is replaced with the live slug.

test('an old PagedAttention heading link scrolls to the renamed heading and rewrites the hash', async ({ page }) => {
  await page.goto('/lesson/t2.l7#3-pagedattention-paging-verbatim')
  const heading = page.locator('[id="4-pagedattention-paging-verbatim"]')
  await expect(heading).toBeInViewport()
  await expect.poll(() => new URL(page.url()).hash).toBe('#4-pagedattention-paging-verbatim')
})
