import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { BACKGROUNDS } from '../../src/lib/ledger/constants'
import { useProgress } from '../../src/lib/progress'
import You from '../../src/pages/boot/You'
import { installDom, type DomKit, type Mounted, type MiniElement } from '../dom/mini-dom'

/**
 * Boot's last step, the optional "What do you work on?" pick (wave-3.md §11.3; 3c final review, 3c-05 minor 1 and F8). The
 * claim under test: the pick is held in the step and written when the learner presses "Go to Today", and not before; a
 * pick cleared in the step deletes the record at the same moment; and the step follows the store until the learner
 * touches it, so a ledger that hydrates after the step mounted still shows its saved pick. Mounted with tests/dom/mini-dom.ts
 * against the real store with its write actions swapped for recorders.
 */
let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

const saved = useProgress.getState()
let calls: [string, ...unknown[]][]
let finished: number
let page: Mounted | null

beforeEach(() => {
  calls = []
  finished = 0
  page = null
  useProgress.setState({
    working: {} as never,
    setWorking: ((k: string, v: unknown) => void calls.push(['set', k, v])) as never,
    clearWorking: ((k: string) => void calls.push(['clear', k])) as never,
  })
})
afterEach(async () => {
  await page?.unmount()
  useProgress.setState({ working: saved.working, setWorking: saved.setWorking, clearWorking: saved.clearWorking })
})

const mountYou = async (): Promise<MiniElement> => {
  page = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/boot'] }, createElement(You, { onFinish: () => void (finished += 1) })))
  return page.container
}
const group = (root: MiniElement) => root.querySelector('[role="radiogroup"][aria-label="What you work on"]')!
const radios = (root: MiniElement) => group(root).querySelectorAll('input[type="radio"]')
const checkedOf = (root: MiniElement) => radios(root).map((r) => r.checked)
const only = (b: string) => BACKGROUNDS.map((x) => x === b)
// the button sits just outside the group (3c final review r2, G6), in the wrapper that holds the group and the button
const clearButton = (root: MiniElement) => group(root).parentNode!.querySelectorAll('button').find((b) => b.textContent.trim() === 'Clear my pick')
const goToToday = (root: MiniElement) => root.querySelectorAll('button').find((b) => b.textContent.trim() === 'Go to Today')!
const hydrate = (working: Record<string, unknown>) => dom.act(() => useProgress.setState({ working: working as never }))

describe('the step writes the pick at Go to Today and not before', () => {
  test('a pick is held while the learner is on the step, then written once, with the finish', async () => {
    const root = await mountYou()
    expect(radios(root)).toHaveLength(BACKGROUNDS.length)
    expect(checkedOf(root).some(Boolean)).toBe(false)
    await dom.press(radios(root)[2])
    expect(checkedOf(root)).toEqual(only(BACKGROUNDS[2]))
    await dom.press(radios(root)[4]) // changing her mind is still not a write
    expect(checkedOf(root)).toEqual(only(BACKGROUNDS[4]))
    expect(calls).toEqual([])
    expect(finished).toBe(0)
    await dom.press(goToToday(root))
    expect(calls).toEqual([['set', 'profile:background', BACKGROUNDS[4]]])
    expect(finished).toBe(1)
  })

  test('no pick writes nothing, and nothing deletes: skipping the question leaves the record alone', async () => {
    const root = await mountYou()
    await dom.press(goToToday(root))
    expect(calls).toEqual([])
    expect(finished).toBe(1)
  })

  test('a saved pick left alone, or chosen again, is not written again', async () => {
    useProgress.setState({ working: { 'profile:background': 'ml' } as never })
    const root = await mountYou()
    expect(checkedOf(root)).toEqual(only('ml'))
    await dom.press(radios(root)[BACKGROUNDS.indexOf('ml')])
    await dom.press(goToToday(root))
    expect(calls).toEqual([])
  })
})

describe('a pick can be cleared, and the clearing waits for Go to Today as well', () => {
  test('"Clear my pick" shows only with a pick, is a button the keyboard reaches, and unchecks the group', async () => {
    const root = await mountYou()
    expect(clearButton(root)).toBeUndefined()
    await dom.press(radios(root)[1])
    const clear = clearButton(root)!
    expect(clear.getAttribute('type')).toBe('button') // not a submit: it must not finish the step
    expect(clear.tabIndex).toBe(0)
    expect(group(root).querySelectorAll('button')).toHaveLength(0) // the group holds only its radios
    expect(clear.closest('[role="radiogroup"]')).toBeNull()
    await dom.press(clear)
    expect(checkedOf(root).some(Boolean)).toBe(false)
    expect(clearButton(root)).toBeUndefined()
    expect(finished).toBe(0)
    expect(dom.document.activeElement.getAttribute('type')).toBe('radio') // focus stays in the group
  })

  test('a saved pick that is cleared deletes the record at Go to Today, not at the click', async () => {
    useProgress.setState({ working: { 'profile:background': 'sre' } as never })
    const root = await mountYou()
    await dom.press(clearButton(root)!)
    expect(checkedOf(root).some(Boolean)).toBe(false)
    expect(calls).toEqual([])
    await dom.press(goToToday(root))
    expect(calls).toEqual([['clear', 'profile:background']])
  })

  test('a pick made and cleared with nothing saved writes nothing and deletes nothing', async () => {
    const root = await mountYou()
    await dom.press(radios(root)[0])
    await dom.press(clearButton(root)!)
    await dom.press(goToToday(root))
    expect(calls).toEqual([])
  })

  test('a saved pick replaced by another is one write', async () => {
    useProgress.setState({ working: { 'profile:background': 'sre' } as never })
    const root = await mountYou()
    await dom.press(radios(root)[BACKGROUNDS.indexOf('student')])
    await dom.press(goToToday(root))
    expect(calls).toEqual([['set', 'profile:background', 'student']])
  })
})

describe('the step follows the store until the learner touches the pick', () => {
  test('a ledger that hydrates after the step mounted shows its saved pick', async () => {
    const root = await mountYou()
    expect(checkedOf(root).some(Boolean)).toBe(false)
    expect(clearButton(root)).toBeUndefined()
    await hydrate({ 'profile:background': 'jvm' })
    expect(checkedOf(root)).toEqual(only('jvm'))
    expect(clearButton(root)).toBeDefined()
    // and finishing without a touch writes nothing: the pick is the store's own
    await dom.press(goToToday(root))
    expect(calls).toEqual([])
  })

  test('a hydration after the learner chose does not take the choice back', async () => {
    const root = await mountYou()
    await dom.press(radios(root)[BACKGROUNDS.indexOf('ml')])
    await hydrate({ 'profile:background': 'jvm' })
    expect(checkedOf(root)).toEqual(only('ml'))
    await dom.press(goToToday(root))
    expect(calls).toEqual([['set', 'profile:background', 'ml']])
  })

  test('a hydration after the learner cleared leaves it cleared, and the finish deletes the saved record', async () => {
    const root = await mountYou()
    await dom.press(radios(root)[0])
    await dom.press(clearButton(root)!)
    await hydrate({ 'profile:background': 'sre' })
    expect(checkedOf(root).some(Boolean)).toBe(false)
    await dom.press(goToToday(root))
    expect(calls).toEqual([['clear', 'profile:background']])
  })
})

describe('the copy says where the pick goes', () => {
  test('on your devices and in your own exports, never in a donation', async () => {
    const root = await mountYou()
    const text = root.textContent.replace(/\s+/g, ' ')
    expect(text).toContain('It stays on your devices: in this browser and in the progress files you export yourself.')
    expect(text).toContain('It is never part of a donation.')
    expect(text).not.toContain('It stays in this browser.')
  })
})
