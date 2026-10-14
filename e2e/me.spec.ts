import { expect, test, type Page } from '@playwright/test'

// Keyboard walk of /me (docs/specs/wave-3.md §12.5, §17.2; exit gate B4), at 360 px. Every control the page offers is
// reached by Tab alone, in document order, and none sits under the fixed header or the bottom tabs when it has focus.
// Two ledgers: an empty one (every Mirror figure says "not enough data") and one written into IndexedDB (a learner
// with cold checks, rated answers and seven competence lines, so the Mirror's own controls exist: its disclosures and
// "Show all"). Tab, Enter and Space only, after the page has loaded.

test.use({ viewport: { width: 360, height: 800 } })
test.setTimeout(120_000)

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** The page's content: everything /me renders between the shell's header and footer. */
const PAGE = 'main'

/** Tag every visible, focusable control inside the page with `data-e2e` = its document-order index; returns how many. */
async function tagControls(page: Page): Promise<number> {
  return page.evaluate((root) => {
    const scope = document.querySelector(root) ?? document.body
    const all = [...scope.querySelectorAll<HTMLElement>('a[href], button, summary, input, select, textarea, [tabindex]')]
    const visible = all.filter((el) => {
      if (el.tabIndex < 0 || (el as HTMLButtonElement).disabled) return false
      // checkVisibility also sees the content of a closed <details>, which keeps its box but cannot take focus
      return el.checkVisibility({ checkVisibilityCSS: true, contentVisibilityAuto: true }) && el.getBoundingClientRect().width > 0
    })
    visible.forEach((el, i) => el.setAttribute('data-e2e', String(i)))
    return visible.length
  }, PAGE)
}

/**
 * Wait for the scroll that focus caused to finish (the page scrolls smoothly), so the check reads where the control ends up.
 * The scroll starts a frame or more after focus moves, and later under load: a control that sits in the viewport but under
 * the bottom tabs (the first one, at 360 x 800) is scrolled up by a few pixels, by the bar's scroll-padding-bottom. Two
 * frames pass first, and three equal readings in a row end the wait, so "has not started yet" is not read as "has finished".
 */
async function scrollSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  let last = -1
  let same = 0
  for (let i = 0; i < 60 && same < 3; i++) {
    const y = await page.evaluate(() => Math.round(scrollY))
    same = y === last ? same + 1 : 0
    last = y
    if (same < 3) await page.waitForTimeout(40)
  }
}

/** Whether the focused element is the topmost thing at its own centre (fixed bars do not cover it). */
const focusUnobscured = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return false
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1))
    return !!top && (el === top || el.contains(top) || top.contains(el))
  })

/** Press Tab until every tagged control has had focus; returns the indices in the order they were reached. */
async function tabThrough(page: Page, count: number): Promise<number[]> {
  const reached: number[] = []
  for (let i = 0; i < count * 3 + 60 && new Set(reached).size < count; i++) {
    await page.keyboard.press('Tab')
    const idx = await page.evaluate(() => {
      const v = document.activeElement?.getAttribute('data-e2e')
      return v === null || v === undefined ? -1 : Number(v)
    })
    if (idx < 0) continue
    if (reached.at(-1) !== idx) reached.push(idx)
    await scrollSettled(page)
    // a few more frames of grace; a control that stays covered still fails
    for (let w = 0; w < 25 && !(await focusUnobscured(page)); w++) await page.waitForTimeout(40)
    expect(await focusUnobscured(page), `control ${idx} is covered when focused: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120))}`).toBe(true)
  }
  return reached
}

async function settled(page: Page) {
  await page.waitForSelector('[data-mirror="summary"]')
  await page.waitForSelector('[data-ring-panel]')
  await expect(page.getByText('Reset everything').first()).toBeVisible()
  // FormsCard is the lazy section with no placeholder: it joins the page after the Mirror, so wait for it too
  await page.waitForSelector('[data-forms-card]')
  await page.evaluate(() => document.fonts.ready)
}

test('/me with an empty ledger: every control is reached by Tab in order, and every Mirror figure says not enough data', async ({ page }) => {
  await page.goto('/me')
  await settled(page)
  expect(await noHorizontalScroll(page)).toBe(true)
  await expect(page.getByRole('heading', { level: 1, name: 'Me' })).toBeVisible()

  // the order of the page: VRK30, cold checks, calibration, competence, then what 3b-06 moved
  const headings = await page.locator(`${PAGE} h2`).allInnerTexts()
  expect(headings.slice(0, 4)).toEqual(['VRK₃₀', 'Cold checks', 'Calibration', 'What you have shown'])
  for (const name of ['vrk-share', 'vrk-month', 'cold-all-d7', 'calibration', 'offset', 'competence']) {
    await expect(page.locator(`[data-figure="${name}"]`)).toHaveAttribute('data-n', '0')
  }
  await expect(page.locator('[data-figure="vrk-share"]')).toContainText('not enough data (n = 0 checked ideas, needs 5)')
  await expect(page.locator('[data-figure="calibration"]')).toContainText('not enough data (n = 0 rated answers, needs 20)')
  await expect(page.locator('[data-figure="offset"]')).toContainText('0.02 (default) until 20 first reviews; n = 0 so far')

  const count = await tagControls(page)
  expect(count).toBeGreaterThan(8)
  const reached = await tabThrough(page, count)
  expect([...new Set(reached)].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i))
  // document order: the walk never goes back to an earlier control
  expect(reached).toEqual([...reached].sort((a, b) => a - b))
  expect(await noHorizontalScroll(page)).toBe(true)

  // a disclosure opens with Enter and closes with Space, and its text reads in place
  const first = page.locator('[data-mirror="vrk30"] summary')
  await first.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-mirror="vrk30"] details')).toHaveAttribute('open', '')
  await expect(page.locator('[data-mirror="vrk30"] details')).toContainText('Authored quiz questions are practice')
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.keyboard.press('Space')
  await expect(page.locator('[data-mirror="vrk30"] details')).not.toHaveAttribute('open', '')
})

// Seven KCs of track R (src/data/kc/r.ts), each with six fresh right answers over two days: seven competence lines.
const KCS = ['r.bindings-expressions', 'r.scalar-types', 'r.control-flow-match', 'r.loops-ranges', 'r.clone-copy-drop', 'r.slices', 'r.lifetimes']

test('/me with a written ledger: cold checks and calibration show their intervals, "Show all" opens, and every control is reached by Tab', async ({ page }) => {
  await page.goto('/me')
  await settled(page)

  const events = await page.evaluate((kcs) => {
    const out: Record<string, unknown>[] = []
    const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
    let n = 0
    const add = (kind: string, ref: string, back: number, ok: boolean, extra: Record<string, unknown>) => {
      n++
      out.push({ id: `e2e-me-${String(n).padStart(4, '0')}`, v: 1, kind, ref, at: `${day(back)}T09:${String(n % 60).padStart(2, '0')}:00.000Z`, tz: 0, day: day(back), dev: 'e2e', score: ok ? 1 : 0, ok, rev: 'r', ...extra })
    }
    for (const kc of kcs) for (let i = 0; i < 6; i++) add('item', 'gen:frag/v', i < 3 ? 3 : 2, true, { provenance: 'unseen', seed: 7000 + n, data: { src: 'today', kcs: [kc], level: 2 } })
    for (let i = 0; i < 12; i++) add('probe', 'gen:frag/v', 1, i < 9, { provenance: 'unseen', seed: 8000 + n, data: { src: 'today', reason: 'probe', kcs: ['r.error-propagation'], sinceDays: 8 + i * 3, level: 2 } })
    for (let i = 0; i < 24; i++) add('item', 'quiz:r.l1#0', 1, i % 4 !== 0, { provenance: 'practice', conf: ['guess', 'think', 'sure'][i % 3], data: { src: 'today', kcs: ['r.slices'] } })
    return out
  }, KCS)
  await page.evaluate(
    (evs) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('events', 'readwrite')
          for (const e of evs) tx.objectStore('events').put(e)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    events,
  )
  await page.reload()
  await settled(page)
  expect(await noHorizontalScroll(page)).toBe(true)

  // cold checks: 12 at 7 days or more, with an interval, in the R track row
  await expect(page.locator('[data-figure="cold-r-d7"]')).toHaveAttribute('data-n', '12')
  await expect(page.locator('[data-figure="cold-r-d7"]')).toContainText('9 of 12 right, 75 % (95 % interval 47 % to 91 %), n = 12')
  // calibration: 24 rated answers, so a score and the bins with n
  await expect(page.locator('[data-figure="calibration"]')).toHaveAttribute('data-n', '24')
  await expect(page.locator('[data-figure="brier"]')).toHaveAttribute('data-n', '24')
  await expect(page.locator('[data-figure="bin-sure"]')).toContainText('n = 8')

  // competence: seven lines, six shown, "Show all 7" opens the rest
  await expect(page.locator('[data-competence]')).toHaveCount(6)
  const all = page.getByRole('button', { name: 'Show all 7' })
  await all.focus()
  await expect(all).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-competence]')).toHaveCount(7)
  await expect(page.getByRole('button', { name: 'Show the first 6' })).toHaveAttribute('aria-expanded', 'true')
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.keyboard.press('Space')
  await expect(page.locator('[data-competence]')).toHaveCount(6)

  // every control, with the disclosures closed and then each opened (their text must not push anything past the edge)
  await page.locator(`${PAGE} details > summary`).evaluateAll((els) => els.forEach((el) => el.parentElement?.setAttribute('open', '')))
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.locator(`${PAGE} details`).evaluateAll((els) => els.forEach((el) => el.removeAttribute('open')))

  // a fresh load, so Tab starts at the top of the page (blur keeps the browser's place in the order)
  await page.reload()
  await settled(page)
  await expect(page.locator('[data-competence]')).toHaveCount(6)
  const count = await tagControls(page)
  const reached = await tabThrough(page, count)
  expect([...new Set(reached)].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i))
  expect(reached).toEqual([...reached].sort((a, b) => a - b))
})
