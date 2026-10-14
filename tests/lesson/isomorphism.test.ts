/**
 * The active isomorphism panel (docs/specs/wave-3.md §11.1; task 3b-07), mounted in a small DOM
 * (tests/dom/mini-dom.ts): align by keyboard and tap, the per-row feedback, the break item, then the principle and the
 * pairs; the two ledger events; the work row that is shown and never graded. A real browser (focus ring, tab order,
 * reflow at 360 px) is e2e/isomorphism.spec.ts and the a11y harness.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { IsomorphismView } from '../../src/components/lesson/Isomorphism'
import type { IsomorphismBlock, Lesson } from '../../src/data/lessons/types'
import { useProgress } from '../../src/lib/progress'
import type { ItemResponse } from '../../src/lib/ledger/types'
import { installDom, MiniEvent, type DomKit, type MiniElement } from '../dom/mini-dom'

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

const BREAK: QuizQuestion = {
  q: 'Where does this analogy break?',
  options: ['The table is walked by hardware', 'Both are per-owner maps', 'Both fill lazily', 'Both can be shared'],
  correct: [0],
  why: ['A true break: only one of them has an MMU.', 'Holds on both sides.', 'Holds on both sides.', 'Holds on both sides.'],
}

const block = (extra: Partial<IsomorphismBlock> = {}): IsomorphismBlock => ({
  type: 'isomorphism',
  title: 'fixture panel',
  pairs: [
    { os: 'page table', osLine: 'Per-process map to frames.', llm: 'block table', llmLine: 'Per-sequence map to blocks.', breaks: 'hardware walks one' },
    { os: 'frame', osLine: 'A physical unit of memory.', llm: 'KV block', llmLine: 'A physical unit of KV.', breaks: 'a frame is 4 KiB' },
    {
      os: 'swap',
      osLine: 'Spill cold pages to disk.',
      llm: 'preemption',
      llmLine: 'Free a sequence and recompute it.',
      breaks: 'swap keeps the bytes',
      work: { backgrounds: ['jvm'], os: 'connection pool', osLine: 'Reuse warm connections.', breaks: 'a connection returns whole' },
    },
  ],
  principle: 'Same mechanism, different cost model.',
  breakItem: BREAK,
  kcs: ['kc.a'],
  ...extra,
})

const lessonOf = (b: IsomorphismBlock, others: Lesson['blocks'] = []): Lesson => ({ id: 't9.l1', slug: 'x', trackId: 't2', index: 1, title: 'x', minutes: 5, hook: 'x', exercise: 'none', kcs: ['kc.lesson'], blocks: [...others, b] }) as unknown as Lesson

const RIGHT: Record<string, string> = { 'page table': 'block table', frame: 'KV block', swap: 'preemption', 'connection pool': 'preemption' }

let events: ItemResponse[]
const saved = useProgress.getState().recordItems
const savedWorking = useProgress.getState().working
beforeEach(() => {
  events = []
  useProgress.setState({ recordItems: (items: ItemResponse[]) => void events.push(...items) })
})
afterEach(() => useProgress.setState({ recordItems: saved, working: savedWorking }))

const rowsOf = (root: MiniElement) => root.querySelectorAll('[data-row]')
const labelsIn = (row: MiniElement) => row.querySelectorAll('[data-ks-label]')
const osOf = (row: MiniElement) => row.querySelector('[role="group"] > div')!.textContent.replace(' pairs with which LLM idea?', '').replace(/^at work/, '').trim()
const buttonNamed = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.trim().startsWith(text))
const labelButton = (row: MiniElement, label: string) => labelsIn(row).find((b) => b.textContent.trim().startsWith(label))!

/** Give every row the label that `answers` names for its OS element. */
async function answer(root: MiniElement, answers: Record<string, string>) {
  for (const row of rowsOf(root)) await dom.press(labelButton(row, answers[osOf(row)]))
}

describe('a block without a break item', () => {
  test('renders as it always has, with or without the lesson, and records nothing', async () => {
    const b = block({ breakItem: undefined })
    const bare = await dom.mount(createElement(IsomorphismView, { block: b }))
    const withLesson = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    expect(withLesson.container.innerHTML).toBe(bare.container.innerHTML)
    expect(withLesson.container.querySelectorAll('button')).toHaveLength(0)
    expect(withLesson.container.textContent).toContain('hardware walks one')
    expect(events).toEqual([])
    await bare.unmount()
    await withLesson.unmount()
  })
})

describe('step 1: align', () => {
  test('one row per OS element, every shuffled label a button of the row, and no answer shown yet', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    const rows = rowsOf(m.container)
    expect(rows.map(osOf)).toEqual(['page table', 'frame', 'swap'])
    for (const row of rows) {
      expect(labelsIn(row).map((l) => l.textContent.trim()).sort()).toEqual(['KV block', 'block table', 'preemption'])
      expect(labelsIn(row).every((l) => l.getAttribute('aria-pressed') === 'false')).toBe(true)
      expect(row.getAttribute('data-verdict')).toBeNull()
    }
    const text = m.container.textContent
    for (const hidden of [b.principle!, 'hardware walks one', ...b.pairs.flatMap((p) => [p.osLine, p.llmLine]), BREAK.q]) expect(text).not.toContain(hidden)
    await m.unmount()
  })

  test('a retry-free shuffle is never the authored order', async () => {
    const b = block()
    for (let i = 0; i < 6; i++) {
      const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
      const order = labelsIn(rowsOf(m.container)[0]).map((l) => l.textContent.trim())
      expect(order).not.toEqual(['block table', 'KV block', 'preemption'])
      await m.unmount()
    }
  })

  test('one Tab stop per row; arrows move focus across the labels without choosing; Space chooses', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    const row = rowsOf(m.container)[0]
    const btns = labelsIn(row)
    expect(btns.map((l) => l.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
    await dom.act(() => btns[0].focus())
    const key = (el: MiniElement, k: string) => dom.act(() => void el.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: k })))
    await key(btns[0], 'ArrowRight')
    expect(dom.document.activeElement).toBe(btns[1])
    expect(labelsIn(row).every((l) => l.getAttribute('aria-pressed') === 'false')).toBe(true)
    await key(btns[1], 'ArrowDown')
    expect(dom.document.activeElement).toBe(btns[2])
    await key(btns[2], 'ArrowRight')
    expect(dom.document.activeElement).toBe(btns[0])
    await key(btns[0], 'ArrowLeft')
    expect(dom.document.activeElement).toBe(btns[2])
    await key(btns[2], 'Home')
    expect(dom.document.activeElement).toBe(btns[0])
    await key(btns[0], 'End')
    expect(dom.document.activeElement).toBe(btns[2])
    // choosing is a click (Space and Enter click a native button); the chosen label becomes the row's Tab stop
    await dom.press(btns[1])
    const after = labelsIn(row)
    expect(after.map((l) => l.getAttribute('aria-pressed'))).toEqual(after.map((l) => (l === btns[1] ? 'true' : 'false')))
    expect(after.map((l) => l.getAttribute('tabindex'))).toEqual(after.map((l) => (l === btns[1] ? '0' : '-1')))
    await m.unmount()
  })

  test('the arrows never reach the lesson page, which binds them to the previous and next lesson on window', async () => {
    const b = block()
    const seen: string[] = []
    const onKey = (e: unknown) => void seen.push((e as { key: string }).key)
    const win = dom.window as unknown as { addEventListener(t: string, f: (e: unknown) => void): void; removeEventListener(t: string, f: (e: unknown) => void): void }
    win.addEventListener('keydown', onKey)
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    const btn = labelsIn(rowsOf(m.container)[0])[0]
    await dom.act(() => btn.focus())
    for (const k of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      await dom.act(() => void btn.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: k })))
    }
    expect(seen).toEqual([])
    // a key the row does not use still bubbles, so the page's other shortcuts and Tab are untouched
    await dom.act(() => void btn.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: 'j' })))
    expect(seen).toEqual(['j'])
    win.removeEventListener('keydown', onKey)
    await m.unmount()
  })

  test('Check with a row unanswered says so, records nothing and grades nothing', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    await dom.press(labelButton(rowsOf(m.container)[0], 'block table'))
    await dom.press(buttonNamed(m.container, 'Check')!)
    const status = m.container.querySelector('[data-align-status]')!
    expect(status.textContent).toContain('2 rows have none')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(events).toEqual([])
    expect(rowsOf(m.container).some((r) => r.querySelector('[data-verdict]'))).toBe(false)
    await m.unmount()
  })

  test('Check shows each row\'s verdict with the pair\'s own two lines, and records item:<lesson>.iso.<n>', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    await answer(m.container, { 'page table': 'block table', frame: 'preemption', swap: 'KV block' })
    await dom.press(buttonNamed(m.container, 'Check')!)

    const rows = rowsOf(m.container)
    expect(rows.map((r) => r.querySelector('[data-verdict]')!.getAttribute('data-verdict'))).toEqual(['right', 'wrong', 'wrong'])
    b.pairs.forEach((p, i) => {
      const text = rows[i].querySelector('[data-verdict]')!.textContent
      for (const part of [p.os, p.osLine, p.llm, p.llmLine]) expect(text).toContain(part)
    })
    expect(rows[1].querySelector('[data-verdict]')!.textContent).toContain('Not that one: frame pairs with KV block.')
    expect(m.container.querySelector('[data-align-status]')!.textContent).toBe('1 of 3 matched.')
    // the verdict is read out by the live region, and the labels are locked while it shows
    expect(labelsIn(rows[0]).every((l) => l.hasAttribute('disabled'))).toBe(true)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'item', ref: 'item:t9.l1.iso.1', ok: false })
    expect(events[0].score).toBeCloseTo(1 / 3, 12)
    expect(events[0].data).toMatchObject({ src: 'lesson', lessonId: 't9.l1', kcs: ['kc.a'], pick: [0, 2, 1] })
    // the break step waits for the learner
    expect(m.container.textContent).not.toContain(BREAK.q)
    await m.unmount()
  })

  test('Try again re-shuffles, clears every pick and records the next attempt; nothing locks', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    await answer(m.container, { 'page table': 'KV block', frame: 'KV block', swap: 'KV block' })
    await dom.press(buttonNamed(m.container, 'Check')!)
    await dom.press(buttonNamed(m.container, 'Try again')!)
    expect(rowsOf(m.container).every((r) => !r.querySelector('[data-verdict]') && labelsIn(r).every((l) => l.getAttribute('aria-pressed') === 'false' && !l.hasAttribute('disabled')))).toBe(true)
    await answer(m.container, RIGHT)
    await dom.press(buttonNamed(m.container, 'Check')!)
    expect(events.map((e) => [e.ref, e.ok, e.score])).toEqual([
      ['item:t9.l1.iso.1', false, 1 / 3],
      ['item:t9.l1.iso.1', true, 1],
    ])
    expect(m.container.querySelector('[data-align-status]')!.textContent).toBe('All 3 matched.')
    expect(buttonNamed(m.container, 'Try again')).toBeUndefined()
    await m.unmount()
  })

  test('the number n follows the lesson\'s isomorphism blocks, those without a break item counted', async () => {
    const first = block({ breakItem: undefined })
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b, [first]) }))
    await answer(m.container, RIGHT)
    await dom.press(buttonNamed(m.container, 'Check')!)
    expect(events[0].ref).toBe('item:t9.l1.iso.2')
    await m.unmount()
  })
})

describe('steps 2 and 3: the break, then the principle and the pairs', () => {
  test('the principle and the breaks wait for the break item; then they show, with the pairs', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    await answer(m.container, RIGHT)
    await dom.press(buttonNamed(m.container, 'Check')!)
    await dom.press(buttonNamed(m.container, 'Now: where does it break?')!)
    await dom.until(() => m.container.querySelector('[data-ks-option]') !== null)
    expect(m.container.textContent).toContain(BREAK.q)
    expect(m.container.textContent).not.toContain(b.principle!)
    expect(m.container.textContent).not.toContain('where it breaks:')
    expect(dom.document.activeElement.textContent).toContain('Name the break')

    // the true break, then Submit
    const options = m.container.querySelectorAll('[data-ks-option]')
    await dom.press(options.find((o) => o.textContent.includes('walked by hardware'))!)
    await dom.press(buttonNamed(m.container, 'Submit')!)
    await dom.until(() => m.container.textContent.includes(b.principle!))

    expect(events.map((e) => e.ref)).toEqual(['item:t9.l1.iso.1', 'item:t9.l1.iso.1.break'])
    expect(events[1]).toMatchObject({ kind: 'item', ok: true, score: 1 })
    expect(events[1].data).toMatchObject({ src: 'lesson', lessonId: 't9.l1', kcs: ['kc.a'], pick: [0] })
    const text = m.container.textContent
    for (const p of b.pairs) for (const part of [p.os, p.osLine, p.llm, p.llmLine, p.breaks!]) expect(text).toContain(part)
    expect(text.split('where it breaks:').length - 1).toBe(3)
    expect(text).toContain(b.principle!)
    await m.unmount()
  })

  test('a wrong break answer is recorded, shows the whys, offers a retry and still reveals the principle', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    await answer(m.container, RIGHT)
    await dom.press(buttonNamed(m.container, 'Check')!)
    await dom.press(buttonNamed(m.container, 'Now: where does it break?')!)
    await dom.until(() => m.container.querySelector('[data-ks-option]') !== null)
    await dom.press(m.container.querySelectorAll('[data-ks-option]').find((o) => o.textContent.includes('Both fill lazily'))!)
    await dom.press(buttonNamed(m.container, 'Submit')!)
    await dom.until(() => m.container.textContent.includes(b.principle!))
    expect(events[1]).toMatchObject({ ref: 'item:t9.l1.iso.1.break', ok: false, score: 0 })
    expect(m.container.textContent).toContain('Holds on both sides.')
    const retry = buttonNamed(m.container, 'Try again')!
    await dom.press(retry)
    await dom.until(() => m.container.querySelector('[data-ks-option]') !== null)
    // the principle stays: a retry does not take back what was shown
    expect(m.container.textContent).toContain(b.principle!)
    await dom.press(m.container.querySelectorAll('[data-ks-option]').find((o) => o.textContent.includes('walked by hardware'))!)
    await dom.press(buttonNamed(m.container, 'Submit')!)
    await dom.until(() => events.length === 3)
    expect(events[2]).toMatchObject({ ref: 'item:t9.l1.iso.1.break', ok: true })
    await m.unmount()
  })

  test('Match them again starts the block over with a new shuffle', async () => {
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    await answer(m.container, RIGHT)
    await dom.press(buttonNamed(m.container, 'Check')!)
    await dom.press(buttonNamed(m.container, 'Now: where does it break?')!)
    await dom.until(() => m.container.querySelector('[data-ks-option]') !== null)
    await dom.press(m.container.querySelectorAll('[data-ks-option]')[1])
    await dom.press(buttonNamed(m.container, 'Submit')!)
    await dom.until(() => m.container.textContent.includes(b.principle!))
    await dom.press(buttonNamed(m.container, 'Match them again')!)
    expect(m.container.textContent).not.toContain(b.principle!)
    expect(m.container.querySelector('[data-ks-option]')).toBeNull()
    expect(rowsOf(m.container)).toHaveLength(3)
    expect(buttonNamed(m.container, 'Check')).toBeDefined()
    await m.unmount()
  })
})

describe('the work row (§11.3): shown for a matching background, never graded', () => {
  const setBackground = (bg: string | undefined) => useProgress.setState({ working: { ...useProgress.getState().working, ...(bg ? { 'profile:background': bg } : {}) } as never })

  test('no background, or another one: no work row and no work line', async () => {
    const b = block()
    for (const bg of [undefined, 'sre']) {
      useProgress.setState({ working: {} as never })
      setBackground(bg)
      const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
      expect(rowsOf(m.container).map(osOf)).toEqual(['page table', 'frame', 'swap'])
      expect(m.container.textContent).not.toContain('connection pool')
      await m.unmount()
    }
  })

  test('a matching background adds one row after its pair; it gets its feedback and its break, and the event is the one without it', async () => {
    const b = block()
    const run = async (bg: string | undefined, work: string | null) => {
      useProgress.setState({ working: {} as never })
      setBackground(bg)
      events = []
      const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
      await answer(m.container, { ...RIGHT, ...(work ? { 'connection pool': work } : {}) })
      await dom.press(buttonNamed(m.container, 'Check')!)
      const out = { rows: rowsOf(m.container).map(osOf), verdicts: rowsOf(m.container).map((r) => r.querySelector('[data-verdict]')?.getAttribute('data-verdict')), text: m.container.textContent, status: m.container.querySelector('[data-align-status]')!.textContent, event: events[0] }
      await m.unmount()
      return out
    }
    const plain = await run(undefined, null)
    const rightWork = await run('jvm', 'preemption')
    const wrongWork = await run('jvm', 'KV block')

    expect(plain.rows).toEqual(['page table', 'frame', 'swap'])
    for (const r of [rightWork, wrongWork]) expect(r.rows).toEqual(['page table', 'frame', 'swap', 'connection pool'])
    expect(rightWork.verdicts).toEqual(['right', 'right', 'right', 'right'])
    expect(wrongWork.verdicts).toEqual(['right', 'right', 'right', 'wrong'])
    // feedback for the work row: its own line and the pair's llm line, marked as not scored
    for (const r of [rightWork, wrongWork]) {
      expect(r.text).toContain('Reuse warm connections.')
      expect(r.text).toContain('Free a sequence and recompute it.')
      expect(r.text).toContain('not scored')
      // the score line counts base rows only
      expect(r.status).toBe('All 3 matched.')
    }
    expect(wrongWork.event).toEqual({ ...plain.event, ms: wrongWork.event.ms, seed: wrongWork.event.seed })
    expect(rightWork.event).toEqual({ ...plain.event, ms: rightWork.event.ms, seed: rightWork.event.seed })
    expect(wrongWork.event.ok).toBe(true)
    expect(wrongWork.event.score).toBe(1)
  })

  test('the work pair and its break show with the others once the break is named', async () => {
    useProgress.setState({ working: { 'profile:background': 'jvm' } as never })
    const b = block()
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson: lessonOf(b) }))
    await answer(m.container, RIGHT)
    await dom.press(buttonNamed(m.container, 'Check')!)
    await dom.press(buttonNamed(m.container, 'Now: where does it break?')!)
    await dom.until(() => m.container.querySelector('[data-ks-option]') !== null)
    await dom.press(m.container.querySelectorAll('[data-ks-option]')[0])
    await dom.press(buttonNamed(m.container, 'Submit')!)
    await dom.until(() => m.container.querySelector('[data-work-pair]') !== null)
    expect(m.container.querySelector('[data-work-pair]')!.textContent).toContain('a connection returns whole')
    await m.unmount()
  })
})
