import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { installDom, type DomKit, type MiniElement, type Mounted } from '../dom/mini-dom'

/**
 * Where Up Next sits on /me (wave-3.md §12.5, task 3b-06; BF7). Progress put it beside the rings for a learner with any
 * activity (a streak day or a lesson with a mark) and below the page for a learner with none, so a new learner met the
 * rings and their checklists before a recommendation. The fold into /me made it always first; this holds the rule back:
 * with activity it comes before the rings, without it after every section of the journey.
 */
let dom: DomKit
let Journey: React.ComponentType
let store: typeof import('../../src/lib/progress').useProgress
let saved: { streakDays: string[]; lessons: ReturnType<typeof store.getState>['lessons'] }

beforeAll(async () => {
  dom = await installDom()
  store = (await import('../../src/lib/progress')).useProgress
  Journey = (await import('../../src/pages/me/Journey')).default
  saved = { streakDays: store.getState().streakDays, lessons: store.getState().lessons }
})
afterEach(() => {
  store.setState(saved)
})
afterAll(async () => {
  await dom.uninstall()
})

async function mountJourney(): Promise<Mounted> {
  const page = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/me'] }, createElement(Journey)))
  await dom.until(() => page.container.querySelector('[data-ring-panel]') !== null && page.container.querySelector('[data-up-next-place]') !== null)
  return page
}

/** Document order of an element within the mounted page. */
const position = (page: Mounted, el: MiniElement): number => page.container.querySelectorAll('*').indexOf(el)

describe('Up Next on /me', () => {
  test('a learner with no activity sees the rings first and Up Next last, below every section of the journey', async () => {
    store.setState({ streakDays: [], lessons: {} })
    const page = await mountJourney()
    const up = page.container.querySelector('[data-up-next-place]')!
    expect(up.getAttribute('data-up-next-place')).toBe('last')
    expect(page.container.querySelectorAll('[data-up-next-place]')).toHaveLength(1)
    const rings = page.container.querySelector('[data-ring-panel]')!
    const lastSection = page.container.querySelectorAll('[title^="locked"]').at(-1)!
    expect(position(page, rings)).toBeLessThan(position(page, up))
    expect(position(page, lastSection)).toBeLessThan(position(page, up))
    await page.unmount()
  })

  test('a learner with a streak day has Up Next first, beside the rings', async () => {
    store.setState({ streakDays: ['2026-10-01'], lessons: {} })
    const page = await mountJourney()
    const up = page.container.querySelector('[data-up-next-place]')!
    expect(up.getAttribute('data-up-next-place')).toBe('first')
    expect(position(page, up)).toBeLessThan(position(page, page.container.querySelector('[data-ring-panel]')!))
    await page.unmount()
  })

  test('a learner with a lesson mark and no streak day has it first too', async () => {
    store.setState({ streakDays: [], lessons: { 'r.l1': { status: 'in-progress' } } as unknown as typeof saved.lessons })
    const page = await mountJourney()
    expect(page.container.querySelector('[data-up-next-place]')!.getAttribute('data-up-next-place')).toBe('first')
    await page.unmount()
  })
})
