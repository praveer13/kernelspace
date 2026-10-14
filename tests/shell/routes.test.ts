import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router'
import App from '../../src/App'
import { installDom, type DomKit } from '../dom/mini-dom'

/**
 * /me and /progress (wave-3.md §2.2, task 3a-02). The real App is mounted in a memory router with a probe beside it
 * that records where the router is and how it got there, so the test sees the redirect a learner's old link follows.
 */
let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

function mountAt(path: string) {
  const seen: { path: string; type: string }[] = []
  function Probe() {
    const { pathname, search } = useLocation()
    const type = useNavigationType()
    seen.push({ path: pathname + search, type })
    return null
  }
  const page = dom.mount(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Probe), createElement(App)))
  return { seen, page }
}

describe('the Me routes', () => {
  test('/progress redirects to /me, replacing the entry so Back does not return to it', async () => {
    const { seen, page } = mountAt('/progress')
    const mounted = await page
    await dom.until(() => seen.some((s) => s.path === '/me'))
    expect(seen[0]).toEqual({ path: '/progress', type: 'POP' })
    expect(seen.at(-1)).toEqual({ path: '/me', type: 'REPLACE' })
    await mounted.unmount()
  })

  test('/me stays at /me and is not redirected', async () => {
    const { seen, page } = mountAt('/me')
    const mounted = await page
    await dom.act(() => new Promise((r) => setTimeout(r, 300)))
    expect(seen.every((s) => s.path === '/me' && s.type === 'POP')).toBe(true)
    await mounted.unmount()
  })
})
