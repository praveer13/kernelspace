/**
 * Focus in the Error Museum's "Try an item on <code>" (task CF8): pressing the button unmounts it, so focus used to drop
 * to <body> until the item mounted, and a failed load never gave it back. The entry is mounted in a small DOM
 * (tests/dom/mini-dom.ts) and the test watches `document.activeElement` through the load, the item and the failure.
 * The real focus ring and screen-reader announcement are checked in the browser (a11y harness on /errors).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import ErrorEntry, { type PracticeItem } from '../../src/components/rust/ErrorEntry'
import compile, { practiceInstance } from '../../src/lib/items/families/compile'
import exhibits from '../../src/data/rust-items/museum.json'
import type { MuseumEntry } from '../../src/lib/rust/museum'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

const CODE = 'E0382'
const entry = (exhibits as unknown as MuseumEntry[]).find((e) => e.code === CODE)!

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

/** A `practice` source the test settles by hand. */
function controlled() {
  const calls: Array<{ resolve(): void; reject(): void }> = []
  const practice = (code: string, seed: number) =>
    new Promise<PracticeItem | undefined>((resolve, reject) => {
      const inst = practiceInstance(code, seed)
      calls.push({ resolve: () => resolve(inst && { inst, gen: compile }), reject: () => reject(new Error('group did not load')) })
    })
  return { calls, practice }
}

const mountEntry = (practice: (code: string, seed: number) => Promise<PracticeItem | undefined>) =>
  dom.mount(createElement(MemoryRouter, null, createElement(ErrorEntry, { entry, practice, seed: 7 })))

const buttonNamed = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.includes(text))!
const active = () => dom.document.activeElement
const where = (el: MiniElement) => `${el.localName}${el.id ? `#${el.id}` : ''}[${el.getAttribute('role') ?? ''}] "${el.textContent.slice(0, 40)}"`

describe('Try an item on <code> keeps focus where the learner can find it', () => {
  test('while the item loads, focus is on a focusable status region, not on <body>', async () => {
    const { calls, practice } = controlled()
    const page = await mountEntry(practice)
    const button = buttonNamed(page.container, `Try an item on ${CODE}`)
    await dom.press(button)

    expect(button.isConnected).toBe(false)
    expect(active()).not.toBe(dom.document.body)
    expect(active().getAttribute('role')).toBe('status')
    expect(active().getAttribute('tabindex')).toBe('-1')
    expect(active().textContent).toContain(`Loading an item on ${CODE}`)
    expect(calls).toHaveLength(1)
    await page.unmount()
  })

  test('when the item is ready, focus moves into the item', async () => {
    const { calls, practice } = controlled()
    const page = await mountEntry(practice)
    await dom.press(buttonNamed(page.container, 'Try an item on'))
    const status = active()
    await dom.act(() => calls[0].resolve())
    await dom.until(() => page.container.querySelector('[data-ks-option], [data-ks-field]') !== null)

    const at = active()
    expect(at, where(at)).not.toBe(dom.document.body)
    expect(at).not.toBe(status)
    expect(page.container.querySelector('form')!.contains(at), where(at)).toBe(true)
    expect(at.hasAttribute('data-ks-option') || at.hasAttribute('data-ks-field')).toBe(true)
    await page.unmount()
  })

  test('when the load fails, the error shows and focus returns to a button that tries again', async () => {
    const { calls, practice } = controlled()
    const page = await mountEntry(practice)
    await dom.press(buttonNamed(page.container, 'Try an item on'))
    await dom.act(() => calls[0].reject())
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)

    const alert = page.container.querySelector('[role="alert"]')!
    expect(alert.textContent).toContain('The item could not load.')
    const at = active()
    expect(at.localName, where(at)).toBe('button')
    expect(at.textContent).toBe('Try again')
    expect(alert.contains(at)).toBe(true)

    // and it works: the retry loads again, holds focus on the status, then the item
    await dom.press(at)
    expect(active().getAttribute('role')).toBe('status')
    expect(calls).toHaveLength(2)
    await dom.act(() => calls[1].resolve())
    await dom.until(() => page.container.querySelector('[data-ks-option], [data-ks-field]') !== null)
    expect(page.container.querySelector('form')!.contains(active())).toBe(true)
    await page.unmount()
  })

  test('a code with no item says so in a status region that holds focus', async () => {
    const page = await mountEntry(async () => undefined)
    await dom.press(buttonNamed(page.container, 'Try an item on'))
    await dom.until(() => page.container.textContent.includes(`No item for ${CODE} yet.`))
    expect(active().getAttribute('role')).toBe('status')
    expect(active().textContent).toContain('No item for')
    await page.unmount()
  })

  test('"Another item" after an answer hands focus over the same way', async () => {
    const { calls, practice } = controlled()
    const page = await mountEntry(practice)
    await dom.press(buttonNamed(page.container, 'Try an item on'))
    await dom.act(() => calls[0].resolve())
    await dom.until(() => page.container.querySelector('[data-ks-option], [data-ks-field]') !== null)
    // answer: pick the first option (or fill the field), then submit
    const control = page.container.querySelector('[data-ks-option], [data-ks-field]')!
    if (control.hasAttribute('data-ks-field')) await dom.act(() => (control.value = 'x'))
    else await dom.press(control)
    await dom.press(buttonNamed(page.container, 'Submit'))
    await dom.until(() => page.container.querySelectorAll('button').some((b) => b.textContent.includes('Another item')))

    await dom.press(buttonNamed(page.container, 'Another item'))
    expect(calls).toHaveLength(2)
    expect(active().getAttribute('role'), where(active())).toBe('status')
    expect(active().textContent).toContain(`Loading an item on ${CODE}`)
    await dom.act(() => calls[1].reject())
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)
    expect(active().textContent).toBe('Try again')
    await page.unmount()
  })
})
