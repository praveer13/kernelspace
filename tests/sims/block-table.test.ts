/**
 * The block-table explorer's four outcome tasks (wave-3.md §13, task 3a-19): the pure pool model, the tasks'
 * numbers, and the explorer mounted in a small DOM (tests/dom/mini-dom.ts) inside a SimHost-shaped context. The test
 * presses the controls a learner presses and reads what the sim reports on the host's observation bus, and what a
 * prediction graded against it would score. Layout and the real focus ring stay with the a11y harness.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { ALLOCATOR_OUTCOME_TASKS } from '../../src/components/sims/allocator.tasks'
import BlockTableExplorer from '../../src/components/sims/BlockTableExplorer'
import { TaskPanel } from '../../src/components/sims/TaskPanel'
import { BLOCK_TABLE_EXPLORER_TASKS } from '../../src/components/sims/blockTableExplorer.tasks'
import { KC } from '../../src/data/kc/ids'
import { SimHostContext, createFinishedStore, createObservationBus, gradePrediction } from '../../src/lib/sims/host'
import type { SimHostInternal } from '../../src/lib/sims/host'
import {
  BLOCK_SIZE,
  INITIAL_POOL,
  NEW_REQUEST_BLOCKS,
  OBSERVE,
  PHONE_MODELS,
  SWEEP,
  SWEEP_SIZES,
  admit,
  divergeB,
  forkBeam,
  freeCount,
  freedBy,
  initialState,
  isStart,
  isStartPlusFork,
  logicalCount,
  physicalInUse,
  preemptVictim,
  pressured,
  resizePool,
  sweepRow,
} from '../../src/lib/sims/models/blocks'
import { useProgress } from '../../src/lib/progress'
import { buildRegistry } from '../../src/lib/sims/registry'
import type { Observation, SimTaskDef } from '../../src/lib/sims/types'
import { MiniEvent, installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

const task = (id: string): SimTaskDef => {
  const t = BLOCK_TABLE_EXPLORER_TASKS.find((x) => x.id === id)
  if (t === undefined) throw new Error(`no task ${id}`)
  return t
}

/** What a learner who typed `guess` would score against the number the sim reports. */
const grade = (id: string, guess: number, actual: number) => {
  const t = task(id)
  return t.predict === undefined ? null : gradePrediction(t.predict, { value: guess }, actual)
}

/* ------------------------------------------------------------------ */
/* The tasks                                                            */
/* ------------------------------------------------------------------ */

describe('the four outcome tasks', () => {
  test('ids, KCs and the click-through ids they replace', () => {
    expect(BLOCK_TABLE_EXPLORER_TASKS.map((t) => t.id)).toEqual(['blk.share', 'blk.cow', 'blk.preempt', 'blk.sweep'])
    expect(BLOCK_TABLE_EXPLORER_TASKS.map((t) => t.legacyId)).toEqual(['t-blk-share', 't-blk-cow', 't-blk-preempt', 't-blk-sweep'])
    expect(task('blk.share').kcs).toEqual([KC.blockRefcounts])
    expect(task('blk.cow').kcs).toEqual([KC.kvCopyOnWrite])
    expect(task('blk.preempt').kcs).toEqual([KC.blockRefcounts])
    expect(task('blk.sweep').kcs).toEqual([KC.blockTables])
    for (const t of BLOCK_TABLE_EXPLORER_TASKS) {
      expect(t.kind).toBe('outcome')
      expect(t.simId).toBe('sim-kv')
      expect(t.machine).toBe('blocks')
      expect(t.predict?.kind, 'numeric, Wave 1 rule for task predictions').toBe('numeric')
      expect(t.explain?.ideas).toHaveLength(3)
      expect(t.phone?.canonical).toBe(`blocks.${t.id.slice(4)}`)
    }
  })

  test('the registry accepts them on the blocks machine only, with no click-through task left beside them', () => {
    const r = buildRegistry({ '/src/components/sims/blockTableExplorer.tasks.ts': { BLOCK_TABLE_EXPLORER_TASKS } })
    expect(r.problems).toEqual([])
    expect(r.forSim('sim-kv', 'blocks').map((t) => t.id)).toEqual(['blk.share', 'blk.cow', 'blk.preempt', 'blk.sweep'])
    expect(r.forSim('sim-kv', 'calc')).toEqual([])
    expect(r.tasks.every((t) => t.kind === 'outcome')).toBe(true)
  })

  test('the observe keys written in the tasks file are the keys the model reports', () => {
    expect(task('blk.share').observe).toBe(OBSERVE.shareFree)
    expect(task('blk.cow').observe).toBe(OBSERVE.cowCopied)
    expect(task('blk.preempt').observe).toBe(OBSERVE.preemptFreed('A'))
    expect(task('blk.sweep').observe).toBe(OBSERVE.sweepTail(64))
    // a reading under another condition is another key, so it never grades this prediction
    expect(OBSERVE.preemptFreed('D')).not.toBe(OBSERVE.preemptFreed('A'))
    expect(OBSERVE.sweepTail(32)).not.toBe(OBSERVE.sweepTail(64))
  })

  test('each phone model gives the number the hands-on step reports, in the task\'s unit', () => {
    const fork = forkBeam(initialState())
    const cow = divergeB(fork.state, 1)
    expect(PHONE_MODELS.share().actual).toBe(freeCount(fork.state))
    expect(PHONE_MODELS.cow().actual).toBe(cow.kind === 'copied' ? cow.tokens : -1)
    expect(PHONE_MODELS.preempt().actual).toBe(preemptVictim(pressured(), 'A')?.freed)
    expect(PHONE_MODELS.sweep().actual).toBe(sweepRow(64).tailWaste)
    for (const t of BLOCK_TABLE_EXPLORER_TASKS) {
      const out = PHONE_MODELS[t.id.slice(4)]()
      expect(out.unit, t.id).toBe(t.predict?.kind === 'numeric' ? t.predict.unit : undefined)
      expect(out.chart.points.length).toBeGreaterThan(0)
      expect(out.table.rows.length).toBeGreaterThan(0)
      for (const row of out.table.rows) expect(row).toHaveLength(out.table.columns.length)
      expect(out.table.announce ?? '').not.toBe('')
    }
  })

  test('the answers are 7 blocks, 16 tokens, 0 blocks and 16 tokens, and the obvious wrong answers miss', () => {
    expect(grade('blk.share', 7, 7)?.ok).toBe(true)
    expect(grade('blk.share', 4, 7)?.ok).toBe(false) // thought the fork copies the prompt
    expect(grade('blk.cow', 16, 16)?.ok).toBe(true)
    expect(grade('blk.cow', 48, 16)?.ok).toBe(false) // thought the whole prefix is copied
    expect(grade('blk.cow', 1, 16)?.ok).toBe(false) // thought only the written token is copied
    expect(grade('blk.preempt', 0, 0)?.ok).toBe(true)
    expect(grade('blk.preempt', 3, 0)?.ok).toBe(false) // thought A's three blocks come back
    expect(grade('blk.sweep', 16, 16)?.ok).toBe(true)
    expect(grade('blk.sweep', 0, 16)?.ok).toBe(false) // 48 is a multiple of 16, not of 64
  })
})

/* ------------------------------------------------------------------ */
/* The pool model                                                       */
/* ------------------------------------------------------------------ */

describe('the pool model', () => {
  test('the starting pool: A and B map three blocks twice, so six mappings cost three blocks', () => {
    const s = initialState()
    expect(s.pool).toHaveLength(INITIAL_POOL)
    expect(logicalCount(s)).toBe(6)
    expect(physicalInUse(s)).toBe(3)
    expect(freeCount(s)).toBe(7)
    expect(s.pool.slice(0, 3).map((b) => b.refcount)).toEqual([2, 2, 2])
    expect(isStart(s)).toBe(true)
    expect(isStartPlusFork(s)).toBe(false)
  })

  test('a fork shares: three more references, no block leaves the free queue; a second fork changes nothing', () => {
    const out = forkBeam(initialState())
    expect(out.ok).toBe(true)
    expect(out.state.pool.slice(0, 3).map((b) => b.refcount)).toEqual([3, 3, 3])
    expect(freeCount(out.state)).toBe(7)
    expect(logicalCount(out.state)).toBe(9)
    expect(isStartPlusFork(out.state)).toBe(true)
    const again = forkBeam(out.state)
    expect(again).toMatchObject({ ok: false, reason: 'exists' })
    expect(again.state).toBe(out.state)
  })

  test('copy-on-write copies one block: B gets a private copy, the original goes from 3 owners to 2', () => {
    const forked = forkBeam(initialState()).state
    const out = divergeB(forked, 5)
    expect(out.kind).toBe('copied')
    if (out.kind !== 'copied') return
    expect(out.tokens).toBe(BLOCK_SIZE)
    expect([out.from, out.to]).toEqual([2, 3])
    expect(out.state.pool[2]).toMatchObject({ refcount: 2, seqs: ['A', 'C'] })
    expect(out.state.pool[3]).toMatchObject({ refcount: 1, seqs: ['B'], copiedFrom: 2, copiedAt: 5 })
    expect(out.state.seqs.find((q) => q.id === 'B')?.logicalBlocks).toEqual([0, 1, 3])
    expect(freeCount(out.state)).toBe(6)
    // the input is not touched, and a second write finds the block already private
    expect(forked.pool[2].refcount).toBe(3)
    expect(divergeB(out.state, 6)).toMatchObject({ kind: 'private', physical: 3 })
  })

  test('B cannot diverge before C exists, and not when no block is free', () => {
    expect(divergeB(initialState(), 1).kind).toBe('no-fork')
    // a pool of 6: A, B and C share 3 blocks, and a request that takes the other 3 leaves none for the copy
    const forked = forkBeam(resizePool(initialState(), 6).state).state
    const jammed = admit(forked, 3)?.state
    expect(jammed && freeCount(jammed)).toBe(0)
    expect(jammed && divergeB(jammed, 1).kind).toBe('no-free')
  })

  test('two 64-token requests: the first fits, the second finds 3 free blocks and needs 4', () => {
    const first = admit(initialState())
    expect(first?.id).toBe('D')
    const s = pressured()
    expect(freeCount(s)).toBe(10 - 3 - NEW_REQUEST_BLOCKS)
    expect(freeCount(s)).toBeLessThan(NEW_REQUEST_BLOCKS)
    expect(admit(s)).toBeNull()
  })

  test('preempting A frees nothing, because B holds every block A maps; preempting D frees its four', () => {
    const s = pressured()
    const a = preemptVictim(s, 'A')
    expect(a).toMatchObject({ freed: 0, admitted: null })
    expect(a?.state.pool.slice(0, 3).map((b) => b.refcount)).toEqual([1, 1, 1])
    expect(a?.state.seqs.map((q) => q.id)).toEqual(['B', 'D'])
    expect(freedBy(s, 'A')).toBe(0)
    expect(freedBy(s, 'B')).toBe(0)
    expect(freedBy(s, 'D')).toBe(4)
    const d = preemptVictim(s, 'D')
    expect(d).toMatchObject({ freed: 4, admitted: 'D' })
    expect(d && freeCount(d.state)).toBe(3) // 7 free, 4 taken by the new request
    expect(preemptVictim(s, 'Z')).toBeNull()
  })

  test('preempting A and then D admits the waiting request once the second victim lets go', () => {
    const afterA = preemptVictim(pressured(), 'A')?.state
    expect(afterA).toBeDefined()
    const afterD = preemptVictim(afterA as never, 'D')
    expect(afterD?.admitted).toBe('D')
  })

  test('a request never takes the id of one that is still running', () => {
    const s = initialState(14)
    const one = admit(s)
    const two = admit(one?.state as never)
    expect([one?.id, two?.id]).toEqual(['D', 'E'])
  })

  test('resizing the pool: growing adds free blocks, shrinking removes owned blocks from every table', () => {
    const grown = resizePool(initialState(), 14)
    expect(grown.state.pool).toHaveLength(14)
    expect(freeCount(grown.state)).toBe(11)
    const shrunk = resizePool(initialState(), 2)
    expect(shrunk.evicted).toEqual([{ id: 2, refcount: 2 }])
    expect(shrunk.state.seqs.every((q) => q.logicalBlocks.length === 2)).toBe(true)
    const same = initialState()
    expect(resizePool(same, INITIAL_POOL).state).toBe(same)
  })

  test('the sweep: 48 tokens leave no waste at 4, 8 and 16, and 16 slots unused at 32 and 64', () => {
    expect(SWEEP.map((r) => [r.size, r.entries, r.tailWaste])).toEqual([
      [4, 12, 0],
      [8, 6, 0],
      [16, 3, 0],
      [32, 2, 16],
      [64, 1, 16],
    ])
    expect(SWEEP_SIZES).toEqual(SWEEP.map((r) => r.size))
    expect(sweepRow(64)).toMatchObject({ wastePct: 33.3, overheadBytes: 8 })
    expect(sweepRow(4).overheadBytes).toBe(96)
  })
})

/* ------------------------------------------------------------------ */
/* The explorer, mounted                                                */
/* ------------------------------------------------------------------ */

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
  // Radix's slider reads the native `value` setter of an <input> to keep its hidden form field in step; the small DOM's
  // input class (made fresh by installDom, so nothing leaks to other files) has none, so give it the property.
  const input = (dom.window.HTMLInputElement as { prototype: object }).prototype
  Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: () => {} })
})
afterAll(() => dom.uninstall())

/** The explorer inside a host context, with every observation it reports collected in order. */
async function mountExplorer() {
  const bus = createObservationBus()
  const seen: Observation[] = []
  bus.subscribe((o) => seen.push(o))
  const host: SimHostInternal = {
    simId: 'sim-kv',
    mode: 'embed',
    machine: 'blocks',
    initialConfig: null,
    writeConfig: () => {},
    selectMachine: () => {},
    observe: bus.emit,
    taskIds: undefined,
    bus,
    finished: createFinishedStore(),
  }
  const page = await dom.mount(createElement(SimHostContext.Provider, { value: host }, createElement(BlockTableExplorer)))
  return { page, seen }
}

const button = (root: MiniElement, text: string): MiniElement => {
  const found = root.querySelectorAll('button').find((b) => b.textContent.includes(text))
  if (found === undefined) throw new Error(`no button "${text}"`)
  return found
}

/** The pool grid's block cards ("P3 rc=2 ..."), by physical id. */
const poolText = (root: MiniElement): string => root.textContent

describe('the explorer reports what each task asks about', () => {
  test('fork beam from B: 7 of 10 blocks stay free, and the pool says refcount 3', async () => {
    const { page, seen } = await mountExplorer()
    expect(seen).toEqual([])
    await dom.press(button(page.container, 'fork beam from B'))
    expect(seen).toEqual([{ key: 'blk.share-free', value: 7, unit: 'blocks' }])
    expect(poolText(page.container)).toContain('rc=3')
    expect(poolText(page.container)).toContain('free 7')
    // pressing it again is a no-op: the beam exists, and nothing more is reported
    await dom.press(button(page.container, 'fork beam from B'))
    expect(seen).toHaveLength(1)
    await page.unmount()
  })

  test('diverge B before forking reports nothing and says to fork first', async () => {
    const { page, seen } = await mountExplorer()
    await dom.press(button(page.container, 'diverge B at L2'))
    expect(seen).toEqual([])
    expect(page.container.textContent).toContain('fork beam C before diverging B')
    await page.unmount()
  })

  test('diverge B after the fork: one 16-token block is copied, once, and B\'s block is a copy of P2', async () => {
    const { page, seen } = await mountExplorer()
    await dom.press(button(page.container, 'fork beam from B'))
    await dom.press(button(page.container, 'diverge B at L2'))
    expect(seen.map((o) => o.key)).toEqual(['blk.share-free', 'blk.cow-copied'])
    expect(seen[1]).toEqual({ key: 'blk.cow-copied', value: 16, unit: 'tokens' })
    expect(page.container.textContent).toContain('copy of P2')
    // the second write finds the block private: no second reading
    await dom.press(button(page.container, 'diverge B at L2'))
    expect(seen).toHaveLength(2)
    await page.unmount()
  })

  test('a reading taken off a pool that is not the starting one is not reported, and the log says why', async () => {
    const { page, seen } = await mountExplorer()
    await dom.press(button(page.container, 'spawn 64-token request'))
    expect(seen).toEqual([])
    await dom.press(button(page.container, 'fork beam from B'))
    expect(seen).toEqual([])
    expect(page.container.textContent).toContain('reads from the starting pool')
    // reset gives the starting pool back, and the same step reports again
    await dom.press(button(page.container, 'reset shared A+B prompt'))
    await dom.press(button(page.container, 'fork beam from B'))
    expect(seen).toEqual([{ key: 'blk.share-free', value: 7, unit: 'blocks' }])
    await page.unmount()
  })

  test('spawn twice: the first request fits and reports nothing; the second finds 3 free blocks and opens the preemption flow', async () => {
    const { page, seen } = await mountExplorer()
    await dom.press(button(page.container, 'spawn 64-token request'))
    expect(page.container.textContent).toContain('new request D admitted')
    expect(page.container.textContent).toContain('free 3')
    await dom.press(button(page.container, 'spawn 64-token request'))
    expect(page.container.textContent).toContain('free queue exhausted')
    // Nothing is preempted until the learner picks a victim and a policy in the dialog, so nothing is reported yet.
    // The dialog itself is Radix's portal, which this small DOM cannot mount (Radix picks its layout-effect hook when
    // the module loads, before any test's DOM exists); the victim's effect is pinned on the model above, and the dialog
    // is walked in the browser (the a11y harness and the keyboard path on /lab/kv-calc?machine=blocks).
    expect(seen).toEqual([])
    await page.unmount()
  })

  test('the block-size slider reports the tail waste of the size it lands on', async () => {
    const { page, seen } = await mountExplorer()
    const thumb = page.container.querySelector('[role="slider"][aria-label="block size"]')
    expect(thumb, 'the block-size slider').not.toBeNull()
    expect(page.container.textContent).toContain('block size16 tokens')
    await dom.act(() => {
      thumb?.focus()
      thumb?.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: 'End' }))
    })
    expect(seen).toEqual([{ key: 'blk.sweep-tail-64', value: 16, unit: 'tokens' }])
    expect(page.container.textContent).toContain('64 tokens')
    await dom.act(() => thumb?.dispatchEvent(new MiniEvent('keydown', { bubbles: true, cancelable: true, key: 'Home' })))
    expect(seen.at(-1)).toEqual({ key: 'blk.sweep-tail-4', value: 0, unit: 'tokens' })
    await page.unmount()
  })
})

/* ------------------------------------------------------------------ */
/* Old completions                                                      */
/* ------------------------------------------------------------------ */

describe('an earlier click-through completion still shows (the nine tasks of sim-allocator and the block-table explorer)', () => {
  const NINE = [...ALLOCATOR_OUTCOME_TASKS, ...BLOCK_TABLE_EXPLORER_TASKS]
  const OLD = 'You finished the old click-through of this task'

  /** A host for one task, and the panel mounted in it. */
  const panel = async (task: SimTaskDef) => {
    const bus = createObservationBus()
    const host: SimHostInternal = {
      simId: task.simId,
      mode: 'embed',
      machine: task.machine,
      initialConfig: null,
      writeConfig: () => {},
      selectMachine: () => {},
      observe: bus.emit,
      taskIds: [task.id],
      bus,
      finished: createFinishedStore(),
    }
    return dom.mount(createElement(SimHostContext.Provider, { value: host }, createElement(TaskPanel, { task, host })))
  }

  /** Mark `ids` done in the progress store's view of the sim, and put the store back afterwards. */
  const withDone = async (simId: string, ids: string[], run: () => Promise<void>) => {
    const before = useProgress.getState().sims
    useProgress.setState({ sims: { ...before, [simId]: { visits: 0, tasksDone: ids } } })
    try {
      await run()
    } finally {
      useProgress.setState({ sims: before })
    }
  }

  test('each task names the id it replaced, and the panel says so when that id is in the progress store', async () => {
    for (const task of NINE) {
      expect(task.legacyId, task.id).toBeDefined()
      await withDone(task.simId, [task.legacyId as string], async () => {
        const page = await panel(task)
        expect(page.container.textContent, task.id).toContain(OLD)
        await page.unmount()
      })
    }
  })

  test('without the old completion, or with another task\'s, the line is not shown', async () => {
    const [first, second] = BLOCK_TABLE_EXPLORER_TASKS
    for (const done of [[], [second.legacyId as string], ['blk.share']]) {
      await withDone('sim-kv', done, async () => {
        const page = await panel(first)
        expect(page.container.textContent).not.toContain(OLD)
        await page.unmount()
      })
    }
  })

  test('the retired ids are not in any registry list, yet the completion is read from the store', async () => {
    const r = buildRegistry({
      '/src/components/sims/allocator.tasks.ts': { ALLOCATOR_OUTCOME_TASKS },
      '/src/components/sims/blockTableExplorer.tasks.ts': { BLOCK_TABLE_EXPLORER_TASKS },
    })
    for (const task of NINE) expect(r.byId(task.legacyId as string), task.legacyId).toBeUndefined()
  })
})
