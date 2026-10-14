/**
 * The production-twin panel and the twins registry (docs/specs/wave-3.md §9, task 3b-08):
 *  - the registry finds `src/data/twins/<lab>.ts` by readdir, ignores `index.ts` and `types.ts`, and every twin it
 *    finds passes `twinProblems` against its pinned claim;
 *  - a lab that is not done, or that has no twin module, renders nothing, and the twin is not even asked for until the
 *    lab is done;
 *  - a done lab shows the file at the claim's pinned ref, the claim's `verifiedAt` and, past the 60-day TTL, "stale
 *    since"; the "you just wrote" line; and three tracing questions played one at a time by ItemCard;
 *  - each answer is one `item` event `item:lab<NN>.twin.<n>`, src `practice`, with the authored pick and the question's KCs,
 *    and the refs equal the ones scripts/item-pools.ts collects for the same twin.
 * The panel is mounted in a small DOM (tests/dom/mini-dom.ts) with a fixture twin supplied through `find`; the fixture's
 * questions are a toy radix tree of its own and claim nothing about SGLang. Shipped twin content is tested by 3b-15.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import TwinPanel, { twinPlayable, twinResponse } from '../../src/components/forge/TwinPanel'
import { getClaim, staleSince } from '../../src/data/claims'
import '../../src/data/claims/lazy/twins'
import { FORGE_LABS } from '../../src/data/labs'
import { findTwin, loadTwin, twinFileUrl, twinItemId, twinLabIds, twinProblems, TWIN_ITEMS_PER_LAB, type TwinModule } from '../../src/data/twins'
import { gradeItem, playView, resultFor } from '../../src/lib/items/play'
import type { ItemResponse } from '../../src/lib/ledger/types'
import { useProgress } from '../../src/lib/progress'
import { collectTwinItems, TWIN_POOL } from '../../scripts/item-pools'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

const lab = FORGE_LABS.find((l) => l.id === 'radix-cache')!
const claim = getClaim('twin.sglang.treecore')

/** Three questions on a toy tree (insert [1,2,3,4] then [1,2,5]; edges [1,2], [3,4], [5]), each worked by hand. */
const FIXTURE: TwinModule = {
  labId: 'radix-cache',
  labNo: '07',
  claimId: 'twin.sglang.treecore',
  path: 'fixture/tree.rs',
  symbols: ['match_prefix', 'insert', 'evict'],
  youWrote: 'You just wrote the fixture structure.',
  items: [
    {
      id: 'lab07.twin.1',
      kcs: ['t5.prefix-cache-keys'],
      q: {
        q: 'The tree holds [1,2,3,4] and [1,2,5]. How many tokens of [1,2,3,9] does the longest cached prefix cover?',
        options: ['2', '3', '4', '0'],
        correct: [1],
        why: [
          'That stops at the shared edge [1,2]; the next edge [3,4] still matches its first token, 3.',
          'Right: [1,2] and then 3 match, and 9 differs from 4 at the second token of the edge.',
          'That counts the whole edge [3,4], but its second token is 4 and the query has 9.',
          'The root edge [1,2] matches the query from its first token, so something is cached.',
        ],
      },
    },
    {
      id: 'lab07.twin.2',
      kcs: ['t5.prefix-cache-keys'],
      q: {
        q: 'Now [1,2,3,7] is inserted into that tree. How many leaves does it have?',
        options: ['2', '3', '4', '5'],
        correct: [1],
        why: [
          'That is the count before the insert: leaves [3,4] and [5].',
          'Right: edge [3,4] splits after 3 into a node with children [4] and [7], and [5] stays: leaves [4], [7], [5].',
          'The split makes one new interior node, not a fourth leaf.',
          'Nothing is copied per token; the shared edges stay shared.',
        ],
      },
    },
    {
      id: 'lab07.twin.3',
      kcs: ['t5.prefix-cache-keys'],
      q: {
        q: 'Insert [1,2,3,4], then [1,2,5], then look up [1,2,3,4]. One leaf is evicted, least recently used first. Which?',
        options: ['the leaf [5]', 'the leaf [3,4]', 'the shared edge [1,2]', 'the root'],
        correct: [0],
        why: [
          'Right: [5] was last used by the second insert, before the lookup touched [3,4].',
          'The lookup just used it, so it is the most recent leaf.',
          'It has children, so it is not a leaf and cannot go first.',
          'The root is never evicted.',
        ],
      },
    },
  ],
}

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

/* ------------------------------ the registry ------------------------------ */

describe('the twins registry finds twin files by readdir', () => {
  test('index.ts and types.ts are not twins, and a lab without a file has no twin', async () => {
    const ids = await twinLabIds()
    expect(ids).not.toContain('index')
    expect(ids).not.toContain('types')
    expect(ids).toEqual([...ids].sort())
    expect(await findTwin('kv-block-manager')).toBeUndefined()
    expect(await findTwin('no-such-lab')).toBeUndefined()
    await expect(loadTwin('no-such-lab')).rejects.toThrow('no twin for lab: no-such-lab')
  })

  test('every twin found names its own lab, numbers it as the lab is numbered, and passes the rules against its pinned claim', async () => {
    for (const id of await twinLabIds()) {
      const twin = await loadTwin(id)
      const known = FORGE_LABS.find((l) => l.id === id)
      expect(known, `twins/${id}.ts is a file for a lab that exists`).toBeDefined()
      expect(twin.labId).toBe(id)
      expect(twin.labNo).toBe(String(known!.index).padStart(2, '0'))
      expect(twinProblems(twin, getClaim(twin.claimId)), id).toEqual([])
    }
  })

  test('the fixture is numbered as lab 07 is numbered', () => {
    expect(String(lab.index).padStart(2, '0')).toBe(FIXTURE.labNo)
  })
})

describe('twinProblems', () => {
  const copy = (): TwinModule => structuredClone(FIXTURE)

  test('the fixture is clean', () => {
    expect(TWIN_ITEMS_PER_LAB).toBe(3)
    expect(twinProblems(FIXTURE, claim)).toEqual([])
  })

  test('two questions, a wrong id, a missing why, no KC and an answer out of range are each named', () => {
    const two = copy()
    two.items.pop()
    expect(twinProblems(two, claim)).toEqual(['has 2 questions, not 3'])

    const wrongId = copy()
    wrongId.items[1].id = 'lab07.twin.9'
    expect(twinProblems(wrongId, claim)).toEqual(['question 2: id "lab07.twin.9" is not "lab07.twin.2"'])

    const noWhy = copy()
    noWhy.items[0].q.why = noWhy.items[0].q.why!.slice(0, 3)
    expect(twinProblems(noWhy, claim)).toEqual(['question 1: needs a why for every option'])
    const blankWhy = copy()
    blankWhy.items[0].q.why![2] = ' '
    expect(twinProblems(blankWhy, claim)).toEqual(['question 1: needs a why for every option'])

    const noKc = copy()
    noKc.items[2].kcs = []
    expect(twinProblems(noKc, claim)).toEqual(['question 3: names 0 KCs, not 1-3'])

    const range = copy()
    range.items[0].q.correct = [4]
    expect(twinProblems(range, claim)).toEqual(['question 1: correct is not an option'])
  })

  test('a claim that is not registered, or that pins nothing, is named', () => {
    expect(twinProblems(FIXTURE, undefined)).toEqual(['claim twin.sglang.treecore is not registered'])
    const unpinned = { ...claim, pin: undefined }
    expect(twinProblems(FIXTURE, unpinned)).toEqual(['claim twin.sglang.treecore has no pin {repo, ref}'])
  })

  test('the file link reads the claim’s pinned ref', () => {
    expect(twinFileUrl({ repo: 'sgl-project/sglang', ref: 'v0.5.21' }, 'a/b.rs')).toBe('https://github.com/sgl-project/sglang/blob/v0.5.21/a/b.rs')
    expect(claim.pin).toEqual({ repo: 'sgl-project/sglang', ref: 'v0.5.21' })
    expect(claim.ttlDays).toBe(60)
  })
})

/* ------------------------------ refs and events ------------------------------ */

describe('a twin question is the item `item:lab<NN>.twin.<n>`', () => {
  test('the ref the panel plays and records equals the ref item-pools collects for the same twin', () => {
    const pool = collectTwinItems([{ lab: 'radix-cache', labNo: FIXTURE.labNo, items: FIXTURE.items }])
    expect(pool.map((p) => p.pool)).toEqual([TWIN_POOL, TWIN_POOL, TWIN_POOL])
    expect(pool.map((p) => p.ref)).toEqual(['item:lab07.twin.1', 'item:lab07.twin.2', 'item:lab07.twin.3'])
    FIXTURE.items.forEach((_, i) => {
      const item = twinPlayable(FIXTURE, i + 1)
      expect(playView(item, 3).ref).toBe(pool[i].ref)
      expect(twinItemId(FIXTURE.labNo, i + 1)).toBe(FIXTURE.items[i].id)
    })
  })

  test('an answer is one item event: src practice, the authored pick, the question’s KCs, practice provenance', () => {
    const item = twinPlayable(FIXTURE, 1)
    const response = { kind: 'choice' as const, picks: ['1'] }
    const event = twinResponse(resultFor(item, response, gradeItem(item, response), { seed: 3, ms: 900 }))
    expect(event.kind).toBe('item')
    expect(event.ref).toBe('item:lab07.twin.1')
    expect(event.provenance).toBe('practice')
    expect(event.ok).toBe(true)
    expect(event.data).toMatchObject({ src: 'practice', kcs: ['t5.prefix-cache-keys'], nsec: 30 })
    expect((event.data as { pick: number[] }).pick).toHaveLength(1)
    expect(event.data).not.toHaveProperty('lessonId')
  })
})

/* ------------------------------ the panel, mounted ------------------------------ */

const buttonNamed = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.startsWith(text))
/** Lets loads and effects run, inside act, for as long as a panel that is going to appear would take. */
const quiet = () => dom.act(() => new Promise((resolve) => setTimeout(resolve, 60)))
const NOW = new Date('2026-11-01T00:00:00Z')

function spyOnWrites() {
  const writes: ItemResponse[] = []
  const original = useProgress.getState().recordItems
  useProgress.setState({ recordItems: ((items: ItemResponse[]) => void writes.push(...items)) as never })
  return { writes, restore: () => useProgress.setState({ recordItems: original }) }
}

function mountPanel(props: { done: boolean; find: (id: string) => Promise<TwinModule | undefined>; now?: Date }) {
  return dom.mount(createElement(TwinPanel, { lab, ...props }))
}

describe('a lab that is not done, or has no twin, renders nothing', () => {
  test('not done: nothing on the page, and the twin is not asked for', async () => {
    const asked: string[] = []
    const page = await mountPanel({ done: false, find: async (id) => (asked.push(id), FIXTURE) })
    await quiet()
    expect(page.container.innerHTML).toBe('')
    expect(asked).toEqual([])
    await page.unmount()
  })

  test('done, but the lab has no twin module: nothing', async () => {
    const asked: string[] = []
    const page = await mountPanel({ done: true, find: async (id) => void asked.push(id) })
    await dom.until(() => asked.length > 0)
    await quiet()
    expect(asked).toEqual(['radix-cache'])
    expect(page.container.innerHTML).toBe('')
    await page.unmount()
  })

  test('done, but the twin breaks a rule or fails to load: nothing, and no error', async () => {
    const broken: TwinModule = { ...FIXTURE, items: FIXTURE.items.slice(0, 2) }
    for (const find of [async () => broken, async () => Promise.reject(new Error('chunk failed')), async () => ({ ...FIXTURE, claimId: 'twin.no-such' })]) {
      const page = await mountPanel({ done: true, find })
      await quiet()
      expect(page.container.innerHTML).toBe('')
      await page.unmount()
    }
  })

  test('the panel appears when the lab becomes done', async () => {
    const page = await mountPanel({ done: false, find: async () => FIXTURE })
    expect(page.container.innerHTML).toBe('')
    await page.render(createElement(TwinPanel, { lab, done: true, find: async () => FIXTURE, now: NOW }))
    await dom.until(() => page.container.querySelector('[data-twin]') !== null)
    await page.unmount()
  })
})

describe('a done lab with a twin', () => {
  test('shows the line, the file at the pinned ref, when it was checked and the symbols; fresh inside the TTL', async () => {
    const page = await mountPanel({ done: true, find: async () => FIXTURE, now: NOW })
    await dom.until(() => page.container.querySelector('[data-twin]') !== null)
    const root = page.container
    expect(root.querySelector('h2')!.textContent).toBe('the production twin')
    expect(root.querySelector('[data-twin-line]')!.textContent).toBe(FIXTURE.youWrote)
    const link = root.querySelector('[data-twin-source] a')!
    expect(link.getAttribute('href')).toBe('https://github.com/sgl-project/sglang/blob/v0.5.21/fixture/tree.rs')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.textContent).toContain('fixture/tree.rs')
    expect(link.textContent).toContain('sgl-project/sglang@v0.5.21')
    expect(root.querySelector('[data-twin-pin]')!.textContent).toBe('pinned at sgl-project/sglang@v0.5.21')
    expect(root.querySelector('[data-twin-verified]')!.textContent).toBe(`checked ${claim.verifiedAt}`)
    expect(root.querySelector('[data-twin-stale]')).toBeNull()
    expect(root.textContent).toContain('match_prefix, insert and evict')
    await page.unmount()
  })

  test('past the claim’s 60-day TTL it says "stale since", on the day the TTL ended, and not a day earlier', () => {
    // verified 2026-10-14 + 60 days = 2026-12-13
    expect(staleSince(claim, new Date('2026-12-13T00:00:00Z'))).toBeNull()
    expect(staleSince(claim, new Date('2026-12-14T00:00:00Z'))).toBe('2026-12-13')
  })

  test('the badge is on the page once the clock is past it', async () => {
    const fresh = await mountPanel({ done: true, find: async () => FIXTURE, now: new Date('2026-12-13T00:00:00Z') })
    await dom.until(() => fresh.container.querySelector('[data-twin]') !== null)
    expect(fresh.container.querySelector('[data-twin-stale]')).toBeNull()
    await fresh.unmount()

    const page = await mountPanel({ done: true, find: async () => FIXTURE, now: new Date('2026-12-14T00:00:00Z') })
    await dom.until(() => page.container.querySelector('[data-twin]') !== null)
    expect(page.container.querySelector('[data-twin-stale]')!.textContent).toBe('stale since 2026-12-13')
    expect(page.container.querySelector('[data-twin-stale-note]')!.textContent).toContain('60 days')
    await page.unmount()
  })

  test('plays the three questions one at a time and records each as item:lab07.twin.<n>, src practice', async () => {
    const spy = spyOnWrites()
    try {
      const page = await mountPanel({ done: true, find: async () => FIXTURE, now: NOW })
      await dom.until(() => page.container.querySelector('[data-ks-option]') !== null)
      const root = page.container
      for (let n = 1; n <= 3; n++) {
        expect(root.querySelectorAll('form')).toHaveLength(1)
        expect(root.textContent).toContain(`trace ${n} of 3`)
        expect(root.textContent).toContain(FIXTURE.items[n - 1].q.q)
        await dom.press(root.querySelector('[data-ks-option]')!)
        await dom.press(buttonNamed(root, 'Submit')!)
        await dom.until(() => buttonNamed(root, n < 3 ? 'Next question' : 'Finish') !== undefined)
        expect(spy.writes).toHaveLength(n)
        // the verdict shows the why of the picked option
        expect(FIXTURE.items[n - 1].q.why!.some((w) => root.textContent.includes(w))).toBe(true)
        await dom.press(buttonNamed(root, n < 3 ? 'Next question' : 'Finish')!)
      }
      await dom.until(() => root.querySelector('[data-twin-done]') !== null)
      expect(spy.writes.map((w) => w.ref)).toEqual(['item:lab07.twin.1', 'item:lab07.twin.2', 'item:lab07.twin.3'])
      for (const w of spy.writes) {
        expect(w.kind).toBe('item')
        expect(w.provenance).toBe('practice')
        expect(w.data).toMatchObject({ src: 'practice', kcs: ['t5.prefix-cache-keys'] })
      }
      expect(root.querySelector('[data-twin-done]')!.textContent).toMatch(/\d of 3 traced right\./)
      // the Finish button unmounted with the item; the summary holds focus
      expect(dom.document.activeElement).toBe(root.querySelector('[data-twin-done]')!)

      // nothing locks: they can be played again, from the first
      await dom.press(buttonNamed(root, 'Trace them again')!)
      await dom.until(() => root.querySelector('[data-ks-option]') !== null)
      expect(root.textContent).toContain('trace 1 of 3')
      expect(spy.writes).toHaveLength(3)
      await page.unmount()
    } finally {
      spy.restore()
    }
  })
})
