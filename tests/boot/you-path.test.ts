/**
 * Boot's last step on a replay (src/pages/boot/You.tsx), mounted in a small DOM (tests/dom/mini-dom.ts): the stored
 * path shows as chosen and the line above "Go to Today" describes it, not the full ramp, until another is picked; with
 * nothing stored nothing is chosen and the line reads the full ramp, where Today sends a learner who skips the choice.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { useProgress } from '../../src/lib/progress'
import You from '../../src/pages/boot/You'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

const savedWorking = useProgress.getState().working
afterEach(() => useProgress.setState({ working: savedWorking }))

const PATH_NAMES = ['Full ramp', 'Serving first', 'Rust systems']
/** The path radios, by their labels (React sets an input's name as a property, which the small DOM does not reflect). */
const pathOf = (radio: MiniElement) => PATH_NAMES.find((n) => (radio.parentNode?.textContent ?? '').startsWith(n))
const chosen = (root: MiniElement) =>
  root
    .querySelectorAll('input')
    .filter((i) => i.getAttribute('type') === 'radio' && pathOf(i) && i.checked)
    .map(pathOf)

/** The line loads the lessons and the KC graph on demand: wait for it to show. */
async function lineOf(root: MiniElement): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const text = root.querySelector('[data-boot-first-lesson]')?.textContent.trim() ?? ''
    if (text) return text
    await dom.act(() => new Promise((r) => setTimeout(r, 10)))
  }
  throw new Error('the first-lesson line never showed')
}

describe('replaying Boot keeps the stored path in force', () => {
  test('a stored serving-first path shows as chosen, and the line names no Rust', async () => {
    useProgress.setState({ working: { ...savedWorking, 'boot:path': 'serving-first' } as never })
    const m = await dom.mount(createElement(MemoryRouter, null, createElement(You, { onFinish: () => {} })))
    expect(chosen(m.container)).toEqual(['Serving first'])
    const line = await lineOf(m.container)
    expect(line).toStartWith('Your first lesson is T0.L1 · ')
    expect(line).not.toContain('Rust')
    await m.unmount()
  })

  test('with nothing stored nothing is chosen, and the line reads the full ramp', async () => {
    useProgress.setState({ working: { ...savedWorking, 'boot:path': undefined } as never })
    const m = await dom.mount(createElement(MemoryRouter, null, createElement(You, { onFinish: () => {} })))
    expect(chosen(m.container)).toEqual([])
    expect(await lineOf(m.container)).toContain('Rust starts right after it, with R.L1 · ')
    await m.unmount()
  })
})
