import { expect, test, type Page } from '@playwright/test'
import { partText } from '../src/lib/items/core'
import { hashFamily, readHashRows } from '../scripts/verify-generators'

// A calibrated `step` draw in the built app (docs/specs/s5.md §8.1, B10, S5-D73; s5b final review round 2, F5). The
// calibrated variants (`prefill-ms-v2`, `tp-speedup`) live in src/lib/items/families/lazy/step-calibrated.ts, which the
// Vite glob in src/lib/items/on-demand.ts (familyPart, loadFamilyPart, PART_LOADERS; S5-D79) turns into a chunk of its own. Under Bun the part loads at
// module evaluation, so tests/items/step.test.ts never takes that path; this is the one test that does, in the production
// build the Playwright config serves.
//
// The route is /today: a placement result that names t6.parallelism-composition earns that KC a card (`complete placement`
// plus the working record `placement:result`, written to IndexedDB as e2e/me.spec.ts writes its ledger), so the session is
// that one KC, and its only `step` variant is `tp-speedup`. The network log then shows what each page asks for:
//  - /today on an empty ledger loads the `step` family chunk but none of the part, `physics` and `ix-points`;
//  - with the card, the part's chunk is requested when the item is drawn, the item waits for it (the chunk is held in the
//    test), and the physics and ix-points chunks arrive with it;
//  - the stem on screen equals the one `step.make(seed, level, variant)` gives for the seed the ledger recorded. The spec
//    imports src/ (as daily.spec.ts does), so it first checks that this runtime's `hashFamily(step)` row for the variant is
//    the one tests/fixtures/items/hashes/step.json pins under Bun, and the expected text is then not a second opinion on
//    the family but the same pinned output.

const KC = 't6.parallelism-composition'
const VARIANT = 'tp-speedup'
const REF = `gen:step/${VARIANT}`

/** The chunks of the part and of the two claim groups it reads (Vite names a chunk by its module: `step-calibrated-<hash>.js`). */
const CHUNKS = { part: /\/assets\/step-calibrated-[\w-]+\.js$/, physics: /\/assets\/physics-[\w-]+\.js$/, ixPoints: /\/assets\/ix-points-[\w-]+\.js$/ } as const
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Every script the page requests, in order; `since(mark)` is what came after `mark` entries. */
function watchScripts(page: Page) {
  const log: string[] = []
  page.on('request', (r) => {
    const { pathname } = new URL(r.url())
    if (pathname.endsWith('.js')) log.push(pathname)
  })
  const hits = (re: RegExp, from = 0) => log.slice(from).filter((p) => re.test(p))
  return { log, hits, mark: () => log.length }
}

/** A placement result that makes `KC` the learner's one card, written as the ledger's own IndexedDB stores hold it. */
const seedCard = (page: Page) =>
  page.evaluate(
    (kc) =>
      new Promise<void>((resolve, reject) => {
        const day = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
        const at = `${day}T09:00:00.000Z`
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['events', 'working'], 'readwrite')
          tx.objectStore('events').put({ id: 'e2e-step-cal-0001', v: 1, kind: 'complete', ref: 'placement', at, tz: 0, day, dev: 'e2e' })
          tx.objectStore('working').put({ key: 'placement:result', value: { solidKcs: [kc] }, at, dev: 'e2e' })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    KC,
  )

/** The `item` events of the `step` family the ledger holds. */
const storedSteps = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ ref: string; seed?: number; data?: { level?: number; variant?: string } }[]>((resolve, reject) => {
        const open = indexedDB.open('kernelspace')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const all = db.transaction('events', 'readonly').objectStore('events').getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            db.close()
            resolve((all.result as { kind: string; ref: string; seed?: number; data?: { level?: number; variant?: string } }[]).filter((e) => e.kind === 'item' && e.ref.startsWith('gen:step/')))
          }
        }
      }),
  )

test('/today on an empty ledger requests neither physics claim group nor the calibrated part', async ({ page }) => {
  const net = watchScripts(page)
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(net.hits(CHUNKS.physics)).toEqual([])
  expect(net.hits(CHUNKS.ixPoints)).toEqual([])
  expect(net.hits(CHUNKS.part)).toEqual([])
})

test('a calibrated step draw loads its part on demand, renders, and reads as Bun generates it', async ({ page }) => {
  const net = watchScripts(page)

  // before the draw: /today with no card asks for none of the three chunks
  await page.goto('/today')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForLoadState('networkidle')
  for (const re of Object.values(CHUNKS)) expect(net.hits(re)).toEqual([])

  // the draw: hold the part's chunk, so the item's wait for it can be seen
  await seedCard(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route(CHUNKS.part, async (route) => {
    await held
    await route.continue()
  })
  const mark = net.mark()
  await page.reload()
  await expect.poll(() => net.hits(CHUNKS.part, mark).length, { message: 'the part is requested when the calibrated item is drawn' }).toBe(1)
  const stem = page.getByText('How many times shorter is this decode step')
  await expect(stem).toHaveCount(0)

  release()
  await expect(stem).toBeVisible({ timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  expect(net.hits(CHUNKS.part, mark)).toHaveLength(1)
  expect(net.hits(CHUNKS.physics, mark)).toHaveLength(1)
  expect(net.hits(CHUNKS.ixPoints, mark)).toHaveLength(1)

  // the item names the engine's numbers and carries its H4 label
  const shown = norm(await stem.innerText())
  expect(shown).toContain("The η, t and β below are the engine's numbers")
  expect(shown).toMatch(/\[v2 physics · [^\]]+ · vLLM 0\.10\.2 · [^\]]+ · fitted on \d+ InferenceX points \(2025-10-29\) · v2-[0-9a-z]+\]$/)

  // answer it, so the ledger records the seed and level the draw used
  await page.locator('[data-ks-field]').first().fill('1.5')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await storedSteps(page)).length).toBe(1)
  const [event] = await storedSteps(page)
  expect(event.ref).toBe(REF)
  expect(typeof event.seed).toBe('number')
  expect(event.data?.level).toBeDefined()

  // what Bun pins for this variant is what this runtime generates, and from it the stem of that seed and level
  const { default: step } = await import('../src/lib/items/families/step')
  expect(hashFamily(step)[VARIANT]).toBe(readHashRows('step').step[VARIANT])
  const inst = step.make(event.seed!, event.data!.level as 0 | 1 | 3, VARIANT)
  expect(shown).toBe(norm(inst.prompt.stem.map(partText).join('')))
})
