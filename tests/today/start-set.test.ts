/**
 * Starting "Keep going" and "Practice with new numbers" on /today (task CF8). `start` became async when the compile
 * bank went to per-group loading; a group or family that failed to load ends `settle` in `NotReady`, and the rejection
 * went unhandled while the button did nothing. The hook and the status line the page runs are mounted in a small DOM
 * (tests/dom/mini-dom.ts) with a loader that rejects, and the test reads what the learner would: the status, the button
 * to press again, and that nothing was opened or written.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement, type ReactNode } from 'react'
import { NotReady, want } from '../../src/lib/items/on-demand'
import type { SessionSlot } from '../../src/lib/learner/types'
import { useProgress } from '../../src/lib/progress'
import { prepareSet, StartNote, startLine, useStartSet, type Prepared, type SetKind } from '../../src/pages/Today'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

const slot = { kc: 'kc.a', item: { source: 'gen' }, reason: 'due' } as unknown as SessionSlot

/** Work whose compile group never loads: the load rejects, and (as the loader does) is not asked for twice. */
function failingWork() {
  let asked = false
  return () => {
    if (!asked) {
      asked = true
      want('compile group 2', Promise.reject(new Error('chunk 404')))
    }
    throw new NotReady('compile group 2')
  }
}

/** The unhandled rejections the process sees while `fn` runs. */
async function unhandled(fn: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = []
  const onReject = (reason: unknown) => void seen.push(reason)
  process.on('unhandledRejection', onReject)
  try {
    await fn()
    await new Promise((r) => setTimeout(r, 20))
  } finally {
    process.off('unhandledRejection', onReject)
  }
  return seen
}

/* ---------------------------------- composing a set ---------------------------------- */

describe('prepareSet answers where settle used to throw', () => {
  test('a loader that rejects ends in "failed", not a rejection', async () => {
    const seen = await unhandled(async () => {
      expect(await prepareSet(failingWork())).toEqual({ status: 'failed' })
    })
    expect(seen).toEqual([])
  })

  test('work that composes slots is ready; work that composes none is empty', async () => {
    expect(await prepareSet(() => [slot])).toEqual({ status: 'ready', slots: [slot] })
    expect(await prepareSet(() => [])).toEqual({ status: 'empty' })
  })

  test('a group that loads on the first ask is waited for, then the set is composed', async () => {
    let loaded = false
    const work = () => {
      if (!loaded) want('compile group 1', Promise.resolve().then(() => void (loaded = true)))
      return [slot]
    }
    expect(await prepareSet(work)).toEqual({ status: 'ready', slots: [slot] })
  })

  test('the status lines name what is happening and what failed', () => {
    expect(startLine({ phase: 'idle' })).toBe('')
    expect(startLine({ phase: 'loading', kind: 'practice' })).toBe('Loading the practice set…')
    expect(startLine({ phase: 'failed', kind: 'extra' })).toBe('Could not load more items. Nothing was started.')
    expect(startLine({ phase: 'failed', kind: 'practice' })).toBe('Could not load the practice set. Nothing was started.')
    expect(startLine({ phase: 'empty', kind: 'extra' })).toBe('No items are ready for that set right now.')
  })
})

/* ---------------------------------- the buttons ---------------------------------- */

/** The page's wiring in miniature: the two buttons, the hook, and the note under them. */
function Probe({ prepare, begin }: { prepare: (kind: SetKind) => Promise<Prepared>; begin: (kind: SetKind, slots: readonly SessionSlot[]) => void }): ReactNode {
  const starter = useStartSet(prepare, begin)
  const press = (kind: SetKind) => void starter.go(kind)
  return createElement(
    'div',
    null,
    createElement('button', { type: 'button', onClick: () => press('practice') }, 'Practice with new numbers'),
    createElement('button', { type: 'button', onClick: () => press('extra') }, 'Keep going'),
    createElement(StartNote, { state: starter.state, onRetry: press }),
  )
}

const buttonNamed = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent === text)
const note = (root: MiniElement) => root.querySelector('[role="status"]')!.textContent

describe('a set that cannot be composed', () => {
  function setup() {
    const begun: Array<{ kind: SetKind; slots: readonly SessionSlot[] }> = []
    let compose: () => readonly SessionSlot[] = failingWork()
    const prepare = () => prepareSet(compose)
    const writes: unknown[] = []
    const original = useProgress.getState().recordItems
    useProgress.setState({ recordItems: ((items: unknown) => void writes.push(items)) as never })
    return {
      begun,
      writes,
      succeedNext: () => void (compose = () => [slot]),
      view: () => createElement(Probe, { prepare, begin: (kind, slots) => void begun.push({ kind, slots }) }),
      restore: () => useProgress.setState({ recordItems: original }),
    }
  }

  test('the learner reads what failed, the button works again, and nothing was started or written', async () => {
    const t = setup()
    const page = await dom.mount(t.view())
    const practice = buttonNamed(page.container, 'Practice with new numbers')!

    const seen = await unhandled(async () => {
      await dom.press(practice)
      await dom.until(() => note(page.container) !== 'Loading the practice set…')
    })

    expect(seen).toEqual([])
    expect(note(page.container)).toBe('Could not load the practice set. Nothing was started.')
    expect(practice.disabled).toBe(false)
    expect(practice.hasAttribute('aria-disabled')).toBe(false)
    expect(buttonNamed(page.container, 'Try again')).toBeDefined()
    expect(t.begun).toEqual([])
    expect(t.writes).toEqual([])
    await page.unmount()
    t.restore()
  })

  test('"Try again" composes the set again, and when it loads the set opens and the note clears', async () => {
    const t = setup()
    const page = await dom.mount(t.view())
    await dom.press(buttonNamed(page.container, 'Keep going')!)
    await dom.until(() => buttonNamed(page.container, 'Try again') !== undefined)
    expect(note(page.container)).toBe('Could not load more items. Nothing was started.')

    t.succeedNext()
    await dom.press(buttonNamed(page.container, 'Try again')!)
    await dom.until(() => t.begun.length === 1)
    expect(t.begun[0]).toEqual({ kind: 'extra', slots: [slot] })
    expect(note(page.container)).toBe('')
    expect(buttonNamed(page.container, 'Try again')).toBeUndefined()
    expect(t.writes).toEqual([])
    await page.unmount()
    t.restore()
  })

  test('a press while a set is loading is ignored, and a prepare that rejects is a failure too', async () => {
    const begun: SetKind[] = []
    let calls = 0
    let release!: () => void
    const prepare = (): Promise<Prepared> => {
      calls++
      return new Promise((_resolve, reject) => {
        release = () => reject(new Error('unexpected'))
      })
    }
    const page = await dom.mount(createElement(Probe, { prepare, begin: (kind) => void begun.push(kind) }))
    const practice = buttonNamed(page.container, 'Practice with new numbers')!
    await dom.press(practice)
    expect(note(page.container)).toBe('Loading the practice set…')
    await dom.press(practice)
    expect(calls).toBe(1)

    const seen = await unhandled(async () => {
      await dom.act(() => release())
      await dom.until(() => buttonNamed(page.container, 'Try again') !== undefined)
    })
    expect(seen).toEqual([])
    expect(begun).toEqual([])
    await page.unmount()
  })

  test('a set with nothing in it says so, without a retry button', async () => {
    const page = await dom.mount(createElement(Probe, { prepare: () => prepareSet(() => []), begin: () => {} }))
    await dom.press(buttonNamed(page.container, 'Keep going')!)
    await dom.until(() => note(page.container) === 'No items are ready for that set right now.')
    expect(buttonNamed(page.container, 'Try again')).toBeUndefined()
    await page.unmount()
  })
})
