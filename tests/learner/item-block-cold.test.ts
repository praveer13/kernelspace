/**
 * The item block on a cold load, and the reading block's seams (docs/specs/serving-reading.md §5.2; task SR-05).
 *
 * A family that loads data on demand (the compile bank's groups) makes no instance until its group has landed: a
 * synchronous `planItem` returns null, which the block used to show as "no question to show right now", and under
 * `settle` it returns the plan the warm tree gives. The block is mounted in a small DOM (tests/dom/mini-dom.ts) with the
 * ledger replaced, and legacy compile variants stand in for the reading ones (the reading groups are SR-04's). It
 * pins: "Try again" on a broken block; a slow `more` that never overwrites a newer stage; the compile copy only for the
 * compile family; the off-path collapse that writes nothing; and one load for two renders of the same reading block (SR-D22).
 *
 * Bun runs every test file in one process: the groups this file forgets are loaded again, and the compile family's
 * `make` is only wrapped while a test holds it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { blockToMd } from '../../scripts/export-lessons-md'
import { forgetGroups, loadGroups } from '../../src/data/rust-items/groups'
import type { ItemBlock as ItemBlockData, Lesson, ReadingBlock } from '../../src/data/lessons/types'
import ItemBlock from '../../src/components/blocks/ItemBlock'
import compile, { GROUP_IDS } from '../../src/lib/items/families/compile'
import { settle, want } from '../../src/lib/items/on-demand'
import { loadFamily } from '../../src/lib/items/registry'
import { planItem } from '../../src/lib/learner/item-block'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import { useProgress } from '../../src/lib/progress'
import { RenderBlock } from '../../src/pages/lesson/blocks'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

/** Legacy compile variants: the machinery under test is the family-independent one. */
const VARIANTS = ['verdict.borrow-rules', 'fix.borrow-rules']

describe('a cold planItem', () => {
  test('is null with the groups forgotten, and under settle equals the warm plan', async () => {
    const warm = [0, 1, 2, 3].map((d) => planItem(compile, { variants: VARIANTS }, [], 99, d))
    expect(warm.every((p) => p !== null)).toBe(true)
    forgetGroups()
    try {
      expect(planItem(compile, { variants: VARIANTS }, [], 99, 0)).toBeNull()
      forgetGroups()
      const settled = await Promise.all([0, 1, 2, 3].map((d) => settle(() => planItem(compile, { variants: VARIANTS }, [], 99, d))))
      expect(settled.map((p) => p?.inst.rev)).toEqual(warm.map((p) => p?.inst.rev))
      expect(settled.map((p) => p?.inst.seed)).toEqual(warm.map((p) => p?.inst.seed))
    } finally {
      await loadGroups(GROUP_IDS)
    }
  })
})

const prose = { type: 'prose', md: 'Some prose above the block.' } as const
const lessonOf = (blocks: Lesson['blocks']): Lesson =>
  ({ id: 't9.l1', slug: 'x', trackId: 't5', index: 1, title: 'x', minutes: 5, hook: 'x', exercise: 'none', kcs: ['kc.lesson'], blocks }) as unknown as Lesson

const reading = (variants = VARIANTS, count = 2): ReadingBlock => ({ type: 'reading', title: 'Read it in Rust: the test', lead: 'The lead, **bold**.', variants, count })
/** The block sits at index 1 of its lesson, as `RenderBlock` reads it. */
const mountReading = (dom: DomKit, block: ReadingBlock) => dom.mount(createElement(RenderBlock, { block, lesson: lessonOf([prose, block]), trackColor: '#22D3EE', h2Start: 0 }))

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

let written: ItemResponse[]
/** What the ledger engine holds when the block reads it back. */
let ledger: ItemResponse[]
/** `events({ refPrefix: 'gen:compile/' })` calls: one per load of the block. */
let loads: number
const saved = { recordItems: useProgress.getState().recordItems, engine: useProgress.controls.engine, working: useProgress.getState().working }
beforeEach(() => {
  written = []
  ledger = []
  loads = 0
  useProgress.setState({ recordItems: (items: ItemResponse[]) => void written.push(...items), working: { ...saved.working, 'boot:path': 'serving-first' } as never })
  ;(useProgress.controls as { engine: unknown }).engine = async () => ({
    events: async (f?: { refPrefix?: string }) => {
      if (f?.refPrefix === 'gen:compile/') loads += 1
      return ledger.filter((e) => e.ref.startsWith(f?.refPrefix ?? '')) as unknown as LedgerEvent[]
    },
  })
})
afterEach(() => {
  useProgress.setState({ recordItems: saved.recordItems, working: saved.working })
  ;(useProgress.controls as { engine: unknown }).engine = saved.engine
})

const buttonNamed = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.trim().startsWith(text))
const hasButton = (root: MiniElement, text: string) => () => buttonNamed(root, text) !== undefined
const options = (root: MiniElement) => root.querySelectorAll('[data-ks-option]')
const progress = (root: MiniElement) => root.querySelector('[data-item-progress]')!.textContent.trim()
/** The question on screen, to tell one item from another. */
const stemOf = (root: MiniElement) => root.querySelector('section')!.textContent

describe('the broken stage', () => {
  test('a block with no question says so and offers Try again, which loads the block again', async () => {
    const m = await mountReading(dom, reading(['verdict.no-such-variant']))
    await dom.until(hasButton(m.container, 'Try again'))
    expect(m.container.textContent).toContain('This block has no question to show right now.')
    expect(loads).toBe(1)
    await dom.press(buttonNamed(m.container, 'Try again')!)
    await dom.until(() => loads === 2)
    await dom.until(hasButton(m.container, 'Try again'))
    expect(written).toEqual([])
    await m.unmount()
  })

  test('a cold bank is not broken: the block plans under settle and shows a question', async () => {
    forgetGroups()
    try {
      const m = await mountReading(dom, reading())
      await dom.until(() => options(m.container).length > 0)
      expect(m.container.textContent).not.toContain('no question to show')
      expect(progress(m.container)).toBe('0/2')
      await m.unmount()
    } finally {
      await loadGroups(GROUP_IDS)
    }
  })
})

describe('a slow `more`', () => {
  const original = compile.make
  let held: Promise<unknown> | null = null
  beforeEach(() => {
    held = null
    // a make that waits for a gate the way a compile group does: `want` records the load and stops with NotReady
    compile.make = (seed, level, variant) => {
      if (held) want('a gated group', held)
      return original(seed, level, variant)
    }
  })
  afterEach(() => {
    compile.make = original
  })

  test('the registry serves the same family object this file wraps', async () => {
    expect(await loadFamily('compile')).toBe(compile)
  })

  test('a stale one never overwrites a newer stage', async () => {
    const m = await mountReading(dom, reading(VARIANTS, 3))
    await dom.until(() => options(m.container).length > 0)
    const first = stemOf(m.container)

    // press "Another snippet" twice, each waiting on its own load; the later press finishes first
    let openA = () => {}
    let openB = () => {}
    const gateA = new Promise<void>((r) => (openA = r))
    const gateB = new Promise<void>((r) => (openB = r))
    held = gateA
    await dom.press(buttonNamed(m.container, 'Another snippet')!)
    held = gateB
    await dom.press(buttonNamed(m.container, 'Another snippet')!)
    held = null
    expect(m.container.querySelector('section')!.getAttribute('aria-busy')).toBe('true')
    expect(stemOf(m.container)).toBe(first)

    openB()
    await dom.until(() => stemOf(m.container) !== first)
    const newer = stemOf(m.container)
    expect(m.container.querySelector('section')!.getAttribute('aria-busy')).toBe('false')

    // the earlier press lands late: it must not replace what the learner is now reading
    openA()
    await dom.act(() => new Promise((r) => setTimeout(r, 60)))
    expect(stemOf(m.container)).toBe(newer)
    expect(written).toEqual([])
    await m.unmount()
  })

  test('an answer given while a load is pending also outlives it', async () => {
    const m = await mountReading(dom, reading(VARIANTS, 3))
    await dom.until(() => options(m.container).length > 0)
    let open = () => {}
    const gate = new Promise<void>((r) => (open = r))
    held = gate
    await dom.press(buttonNamed(m.container, 'Another snippet')!)
    held = null
    await dom.press(options(m.container)[0])
    await dom.press(buttonNamed(m.container, 'Submit')!)
    await dom.until(() => written.length === 1)
    const answered = stemOf(m.container)
    open()
    await dom.act(() => new Promise((r) => setTimeout(r, 60)))
    expect(stemOf(m.container)).toBe(answered)
    expect(m.container.querySelector('section')!.getAttribute('aria-busy')).toBe('false')
    await m.unmount()
  })
})

describe('the compile copy', () => {
  test('a reading (compile) block says snippet, in the eyebrow, the button and the attribute', async () => {
    const m = await mountReading(dom, reading())
    await dom.until(() => options(m.container).length > 0)
    expect(m.container.querySelector('[data-block="reading"]')).not.toBeNull()
    expect(m.container.querySelector('[data-block="item"]')).toBeNull()
    expect(m.container.textContent).toContain('another snippet · 0/2')
    expect(hasButton(m.container, 'Another snippet')()).toBe(true)
    expect(m.container.textContent).not.toContain('New numbers')
    await m.unmount()
  })

  test('the lead renders above the block', async () => {
    const m = await mountReading(dom, reading())
    await dom.until(() => options(m.container).length > 0)
    expect(m.container.querySelector('strong')?.textContent).toBe('bold')
    expect(m.container.textContent).toContain('Read it in Rust: the test')
    await m.unmount()
  })

  test('another family keeps its own copy', async () => {
    const goodput = await loadFamily('goodput')
    const block: ItemBlockData = { type: 'item', title: 'Price it', family: 'goodput', variants: [goodput.variants[0].id], count: 1, predict: false }
    const m = await dom.mount(createElement(ItemBlock, { lessonId: 't9.l1', blockIndex: 1, block, trackColor: '#22D3EE' }))
    await dom.until(() => m.container.textContent.includes('new numbers · 0/1'))
    expect(m.container.querySelector('[data-block="item"]')).not.toBeNull()
    expect(hasButton(m.container, 'New numbers')()).toBe(true)
    expect(m.container.textContent).not.toContain('snippet')
    await m.unmount()
  })
})

describe('the off-path collapse', () => {
  test.each([['full-ramp'], ['rust-systems'], [undefined]])('on %p a fresh reading block asks first and writes nothing', async (path) => {
    useProgress.setState({ working: { ...saved.working, 'boot:path': path } as never })
    const m = await mountReading(dom, reading())
    await dom.until(hasButton(m.container, 'Practice anyway'))
    expect(m.container.textContent).toContain('Rust Zero covers this on your path. Practice anyway?')
    expect(options(m.container)).toHaveLength(0)
    // collapsed to one line: no progress in the header, as the expert collapse
    expect(progress(m.container)).toBe('')
    expect(written).toEqual([])

    await dom.press(buttonNamed(m.container, 'Practice anyway')!)
    await dom.until(() => options(m.container).length > 0)
    expect(progress(m.container)).toBe('0/2')
    // opening it is not an answer
    expect(written).toEqual([])
    await m.unmount()
  })

  test('a block the learner has begun does not collapse', async () => {
    useProgress.setState({ working: { ...saved.working, 'boot:path': 'full-ramp' } as never })
    ledger = [{ kind: 'item', ref: 'gen:compile/verdict.borrow-rules', at: '2026-10-19T10:00:00.000Z', ok: true, seed: 7, data: { src: 'lesson', grp: 't9.l1#1', level: 1 } } as unknown as ItemResponse]
    const m = await mountReading(dom, reading())
    await dom.until(() => options(m.container).length > 0)
    expect(buttonNamed(m.container, 'Practice anyway')).toBeUndefined()
    expect(progress(m.container)).toBe('1/2')
    await m.unmount()
  })

  test('on serving-first the block opens at once', async () => {
    const m = await mountReading(dom, reading())
    await dom.until(() => options(m.container).length > 0)
    expect(buttonNamed(m.container, 'Practice anyway')).toBeUndefined()
    await m.unmount()
  })

  test('an item block (not reading) never collapses for the path', async () => {
    useProgress.setState({ working: { ...saved.working, 'boot:path': 'full-ramp' } as never })
    const block: ItemBlockData = { type: 'item', title: 'Borrow it', family: 'compile', variants: VARIANTS, count: 1, predict: false }
    const m = await dom.mount(createElement(ItemBlock, { lessonId: 't9.l1', blockIndex: 1, block, trackColor: '#22D3EE' }))
    await dom.until(() => options(m.container).length > 0)
    expect(buttonNamed(m.container, 'Practice anyway')).toBeUndefined()
    await m.unmount()
  })
})

describe('a stable block object (SR-D22)', () => {
  test('two renders of the same reading block load once', async () => {
    const block = reading()
    const props = { block, lesson: lessonOf([prose, block]), trackColor: '#22D3EE', h2Start: 0 }
    const m = await dom.mount(createElement(RenderBlock, props))
    await dom.until(() => options(m.container).length > 0)
    expect(loads).toBe(1)
    await m.render(createElement(RenderBlock, { ...props }))
    await m.render(createElement(RenderBlock, { ...props }))
    await dom.act(() => new Promise((r) => setTimeout(r, 60)))
    expect(loads).toBe(1)
    expect(options(m.container).length).toBeGreaterThan(0)
    await m.unmount()
  })

  test('the control: an item spec rebuilt on each render reloads on each render', async () => {
    const spec = (): ItemBlockData => ({ type: 'item', title: 'Borrow it', family: 'compile', variants: VARIANTS, count: 2, predict: false })
    const el = () => createElement(ItemBlock, { lessonId: 't9.l1', blockIndex: 1, block: spec(), trackColor: '#22D3EE', reading: true })
    const m = await dom.mount(el())
    await dom.until(() => options(m.container).length > 0)
    expect(loads).toBe(1)
    await m.render(el())
    await dom.until(() => loads === 2)
    await m.unmount()
  })
})

describe('the markdown export', () => {
  test('a reading block exports its title and lead and names no answer', () => {
    const md = blockToMd(reading(), 't9.l1', 0, 0, 0)
    expect(md).toBe(
      "**Rust reading: Read it in Rust: the test**\n\nThe lead, **bold**.\n\n_Read short Rust in the lesson: name rustc's verdict or the one-line fix._",
    )
  })
})
