/**
 * /capstone links to /capstone/service (docs/specs/wave-3.md §16.8, task 3s-10; fix TF4): the page is mounted in a small
 * DOM (tests/dom/mini-dom.ts), the link is found by its text, and its href is read. The hero's links (free play, fleet week, your own
 * service) carry `min-h-11` (§17.2's 44 px house rule); the height itself is measured in a browser (Playwright at 360, 320 and
 * 1280 px), because the small DOM has no layout. Capstone.tsx imports its sandbox worker as a Vite `?worker&url`, which
 * bun cannot resolve, so the test stands in a URL for it.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { installDom, type DomKit, type Mounted } from '../dom/mini-dom'

mock.module('@/workers/capstone.worker?worker&url', () => ({ default: '/capstone.worker.js' }))

let dom: DomKit
let page: Mounted
beforeAll(async () => {
  dom = await installDom()
  const { default: Capstone } = await import('../../src/pages/Capstone')
  page = await dom.mount(createElement(MemoryRouter, null, createElement(Capstone)))
})
afterAll(async () => {
  await page.unmount()
  await dom.uninstall()
})

const link = (text: string) => page.container.querySelectorAll('a').find((a) => (a.textContent ?? '').trim() === text)

describe('the capstone page links to the other capstones', () => {
  test('"your own service: bring a trace →" goes to /capstone/service', () => {
    const a = link('your own service: bring a trace →')
    expect(a).toBeDefined()
    expect(a!.getAttribute('href')).toBe('/capstone/service')
  })

  test('"capstone 2.0: fleet week →" goes to /week', () => {
    expect(link('capstone 2.0: fleet week →')?.getAttribute('href')).toBe('/week')
  })

  test('all three hero links are at least 44 px tall: min-h-11, the text centred', () => {
    for (const text of ['open in free play ↗', 'your own service: bring a trace →', 'capstone 2.0: fleet week →']) {
      const classes = (link(text)?.className ?? '').split(/\s+/)
      expect(classes, text).toContain('min-h-11')
      expect(classes, text).toContain('items-center')
      expect(classes, text).toContain('justify-center')
      expect(classes, text).not.toContain('py-2')
    }
  })
})
