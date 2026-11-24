import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { installDom } from '../dom/mini-dom'
import { isLessonKeyTarget, isWidgetKeyTarget } from '../../src/lib/sims/host'

let dom: Awaited<ReturnType<typeof installDom>>
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

type Spec = [tag: string, attrs?: Record<string, string>, child?: Spec]

/** Build a chain of elements (each the child of the one before) and return the innermost one. */
function el(spec: Spec) {
  const d = dom.document
  const make = (s: Spec) => {
    const node = d.createElement(s[0])
    for (const [k, v] of Object.entries(s[1] ?? {})) node.setAttribute(k, v)
    if (s[2]) node.appendChild(make(s[2]))
    return node
  }
  const root = make(spec)
  d.body.appendChild(root)
  let leaf = root
  for (let n = spec; n[2]; n = n[2]) leaf = leaf.firstChild as typeof root
  return leaf
}

describe('isWidgetKeyTarget', () => {
  const yes: [string, Spec][] = [
    ['input', ['input']],
    ['textarea', ['textarea']],
    ['select', ['select']],
    ['contenteditable', ['div', { contenteditable: 'true' }]],
    ['slider thumb', ['span', { role: 'slider' }]],
    ['spinbutton', ['span', { role: 'spinbutton' }]],
    ['radio', ['span', { role: 'radio' }]],
    ['option', ['ul', { role: 'listbox' }, ['li', { role: 'option' }]]],
    ['tab', ['span', { role: 'tab' }]],
    ['inside an exercise', ['div', { 'data-exercise': 'sim-roofline' }, ['button']]],
    ['inside a play block', ['div', { 'data-block': 'play' }, ['button']]],
    ['inside a queue', ['div', { 'data-queue': '' }, ['button']]],
    ['a choice', ['button', { 'data-ks-option': '' }]],
  ]
  for (const [name, html] of yes) {
    test(`${name} owns its keys`, () => {
      expect(isWidgetKeyTarget(el(html))).toBe(true)
    })
  }

  test('a plain button, the body and null do not', () => {
    expect(isWidgetKeyTarget(el(['button']))).toBe(false)
    expect(isWidgetKeyTarget(dom.document.body)).toBe(false)
    expect(isWidgetKeyTarget(null)).toBe(false)
    expect(isWidgetKeyTarget({})).toBe(false)
  })

  test('contenteditable="false" is not a field', () => {
    expect(isWidgetKeyTarget(el(['div', { contenteditable: 'false' }]))).toBe(false)
  })
})

describe('isLessonKeyTarget', () => {
  test('a focused code block or table that scrolls sideways keeps its arrows', () => {
    expect(isLessonKeyTarget(el(['div', { role: 'region', tabindex: '0', 'aria-label': 'code, scrolls sideways' }]))).toBe(true)
    expect(isLessonKeyTarget(el(['div', { role: 'region', tabindex: '0', 'aria-label': 'table, scrolls sideways' }, ['table']]))).toBe(true)
  })
  test('every control that owns its keys still does', () => {
    expect(isLessonKeyTarget(el(['span', { role: 'slider' }]))).toBe(true)
    expect(isLessonKeyTarget(el(['div', { 'data-queue': '' }, ['button']]))).toBe(true)
  })
  test('a region that is not a tab stop, a plain button, the body and null do not', () => {
    expect(isLessonKeyTarget(el(['div', { role: 'region' }, ['button']]))).toBe(false)
    expect(isLessonKeyTarget(el(['div', { role: 'region', tabindex: '-1' }]))).toBe(false)
    expect(isLessonKeyTarget(el(['button']))).toBe(false)
    expect(isLessonKeyTarget(dom.document.body)).toBe(false)
    expect(isLessonKeyTarget(null)).toBe(false)
  })
  test('the lab transport is not affected: a sim view that scrolls is not a widget', () => {
    expect(isWidgetKeyTarget(el(['div', { role: 'region', tabindex: '0', 'aria-label': 'heap view' }]))).toBe(false)
  })
})
