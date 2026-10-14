/**
 * One registry, part A (docs/specs/wave-3.md §13, task 3a-20): the guided-task lists of MemoryGridSim (grid, latency) and
 * VmPagingSim (paging) live in tasks files as legacy entries with a HOME, so the registry knows all of their ids. The
 * components import the lists and render them exactly as before: the mounted sims show each list in its order on its own
 * machine, and the registry gives each machine the same ids and no other machine any of them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import { GRID_TASKS } from '../../src/components/sims/memoryGrid.tasks'
import { LATENCY_TASKS } from '../../src/components/sims/latencyWalk.tasks'
import { PAGING_TASKS } from '../../src/components/sims/vmPaging.tasks'
import MemoryGridSim from '../../src/components/sims/MemoryGridSim'
import VmPagingSim from '../../src/components/sims/VmPagingSim'
import { buildRegistry } from '../../src/lib/sims/registry'
import { installDom, MiniElement, type DomKit } from '../dom/mini-dom'

const ROOT = join(import.meta.dir, '..', '..')
const SIMS_DIR = join(ROOT, 'src', 'components', 'sims')

/** Every tasks file, loaded with Bun the way `import.meta.glob` loads them in Vite. */
async function loadTaskModules(): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const f of new Bun.Glob('*.tasks.ts').scanSync(SIMS_DIR)) {
    out[`/src/components/sims/${f}`] = (await import(join(SIMS_DIR, f))) as Record<string, unknown>
  }
  return out
}

const reg = buildRegistry(await loadTaskModules())

const ids = (list: readonly { id: string }[]) => list.map((t) => t.id)

/** The lists, with the sim and machine each renders on. */
const LISTS = [
  { name: 'grid', list: GRID_TASKS, simId: 'sim-memory', machine: 'grid' },
  { name: 'latency', list: LATENCY_TASKS, simId: 'sim-memory', machine: 'latency' },
  { name: 'paging', list: PAGING_TASKS, simId: 'sim-vm', machine: 'paging' },
] as const

describe('the lists are in the registry', () => {
  test('nothing is wrong with what the new files contribute', () => {
    expect(reg.problems).toEqual([])
  })

  for (const { name, list, simId, machine } of LISTS) {
    test(`every ${name} id resolves, as a legacy task on ${simId} / ${machine} with its own text`, () => {
      expect(list.length).toBeGreaterThan(0)
      for (const t of list) {
        const def = reg.byId(t.id)
        expect(def, t.id).toBeDefined()
        expect(def!.kind).toBe('legacy')
        expect(def!.simId).toBe(simId)
        expect(def!.machine).toBe(machine)
        expect(def!.setup).toBe(t.text)
        expect(def!.kcs).toEqual([])
      }
    })

    test(`the ${name} machine's registry list is exactly its list`, () => {
      expect(ids(reg.forSim(simId, machine))).toEqual(expect.arrayContaining(ids(list)))
      expect(ids(reg.forSim(simId, machine).filter((t) => list.some((l) => l.id === t.id)))).toEqual(ids(list))
    })
  }

  test('no other machine, and no machine-less view, picks any of them up', () => {
    const all = new Set(LISTS.flatMap((l) => ids(l.list)))
    for (const { simId, machine } of LISTS) {
      for (const other of ['pointer', 'latency', 'grid', 'matrix', 'layout', 'frames', 'paging', 'contention', 'rust', 'scheduler', null]) {
        const mine = LISTS.filter((l) => l.simId === simId && l.machine === other).flatMap((l) => ids(l.list))
        const got = ids(reg.forSim(simId, other)).filter((id) => all.has(id))
        expect(got, `${simId} / ${String(other)}`).toEqual(mine)
      }
      expect(machine).toBeTruthy()
    }
    expect(ids(reg.forSim('sim-memory'))).toEqual([])
    expect(ids(reg.forSim('sim-vm', 'contention')).filter((id) => all.has(id))).toEqual([])
  })

  test('ids stay unique across the registry, and the three lists share none', () => {
    const flat = LISTS.flatMap((l) => ids(l.list))
    expect(new Set(flat).size).toBe(flat.length)
    expect(new Set(ids(reg.tasks)).size).toBe(reg.tasks.length)
  })
})

describe('the components render the lists as before', () => {
  let dom: DomKit
  // The sims draw Radix sliders and selects and a canvas chart, which read what mini-dom's elements do not have: an input
  // prototypes with `value` and `checked`, `options` on the native select, and a 2-d context. They are added for these tests
  // and removed after.
  const extras: Record<string, PropertyDescriptor> = {
    options: { configurable: true, get: () => [] },
    getContext: { configurable: true, value: () => new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true }) },
  }
  beforeAll(async () => {
    dom = await installDom()
    const g = globalThis as unknown as Record<'HTMLInputElement' | 'HTMLSelectElement', { prototype: object }>
    const slot = { configurable: true, get: () => '', set: () => {} }
    Object.defineProperties(g.HTMLInputElement.prototype, { value: slot, checked: slot })
    Object.defineProperty(g.HTMLSelectElement.prototype, 'value', slot)
    Object.defineProperties(MiniElement.prototype, extras)
  })
  afterAll(async () => {
    for (const k of Object.keys(extras)) delete (MiniElement.prototype as unknown as Record<string, unknown>)[k]
    await dom.uninstall()
  })

  const rows = (root: MiniElement): string[] =>
    (root.querySelector('[aria-label="exercise tasks"]')?.querySelectorAll('li') ?? []).map((li) => li.textContent)
  const chip = (root: MiniElement, label: string) => root.querySelectorAll('button').find((b) => b.textContent.trim() === label)!
  const view = (el: unknown, url: string) => createElement(MemoryRouter, { initialEntries: [url] }, el as never)

  test('MemoryGridSim lists the grid tasks, then the latency tasks once the machine is switched', async () => {
    const m = await dom.mount(view(createElement(MemoryGridSim), '/lab/memory-grid'))
    const grid = rows(m.container)
    expect(grid).toHaveLength(GRID_TASKS.length)
    GRID_TASKS.forEach((t, i) => expect(grid[i]).toContain(t.text))
    await dom.press(chip(m.container, 'latency walk'))
    await dom.until(() => rows(m.container).some((r) => r.includes(LATENCY_TASKS[0].text)))
    const lat = rows(m.container)
    expect(lat).toHaveLength(LATENCY_TASKS.length)
    LATENCY_TASKS.forEach((t, i) => expect(lat[i]).toContain(t.text))
    for (const t of GRID_TASKS) expect(m.container.textContent).not.toContain(t.text)
    await m.unmount()
  })

  test('VmPagingSim lists the paging tasks, and the contention tasks once the machine is switched', async () => {
    const m = await dom.mount(view(createElement(VmPagingSim), '/lab/paging'))
    const paging = rows(m.container)
    expect(paging).toHaveLength(PAGING_TASKS.length)
    PAGING_TASKS.forEach((t, i) => expect(paging[i]).toContain(t.text))
    await dom.press(chip(m.container, 'contention'))
    await dom.until(() => !rows(m.container).some((r) => r.includes(PAGING_TASKS[0].text)))
    const contention = reg.forSim('sim-vm', 'contention')
    expect(contention.length).toBeGreaterThan(0)
    expect(rows(m.container)).toHaveLength(contention.length)
    for (const t of PAGING_TASKS) expect(m.container.textContent).not.toContain(t.text)
    await m.unmount()
  })
})

describe('no task array is left inline', () => {
  // Acceptance names this check by source: a task is an `{ id: 't-…', text: … }` object, and none may be written in a component.
  for (const file of ['MemoryGridSim.tsx', 'VmPagingSim.tsx']) {
    test(`${file} writes no task literal`, () => {
      const src = readFileSync(join(SIMS_DIR, file), 'utf8')
      expect(src.match(/\{\s*id:\s*'t-[a-z0-9-]+'\s*,\s*text:/g) ?? []).toEqual([])
    })
  }
})
