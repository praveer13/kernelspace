/**
 * The quantizer, WGSL, batching and engine task lists live in tasks files (wave-3.md §13, task 3a-21). The routes are
 * mounted in a small DOM (tests/dom/mini-dom.ts) and the checklist a learner sees is read back, so what is asserted is what
 * renders: the same ids' texts in the same order as before, the batching list only on the batching machine, and the
 * engine list with the extension tasks after its own. The registry is built from the same files with `buildRegistry`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import App from '../../src/App'
import { buildRegistry } from '../../src/lib/sims/registry'
import { MiniElement, installDom, type DomKit } from '../dom/mini-dom'

const SIMS_DIR = join(import.meta.dir, '..', '..', 'src', 'components', 'sims')

const modules: Record<string, Record<string, unknown>> = {}
for (const f of new Bun.Glob('*.tasks.ts').scanSync(SIMS_DIR)) {
  modules[`/src/components/sims/${f}`] = (await import(join(SIMS_DIR, f))) as Record<string, unknown>
}
const reg = buildRegistry(modules)

const QUANT = ['q-fp16', 'q-int4-max', 'q-group-compare', 'q-outlier']
const WGSL = ['wgsl-16m', 'wgsl-sweep', 'wgsl-barrier', 'wgsl-multipass']
const BATCHING = ['batch-trace-static', 'batch-trace-continuous', 'batch-overload', 'batch-policy']
const ENGINE_OWN = ['tokenize', 'forward', 'decode', 'kv', 'batch']
const ENGINE_EXT = ['t-eng-flops', 't-eng-ctx', 't-eng-gqa', 't-eng-tokcmp', 't-eng-words', 't-eng-exec']

describe('the registry holds the four lists, and no other machine\'s list grows', () => {
  test('the files contribute without a problem', () => {
    expect(reg.problems).toEqual([])
  })

  test('every id resolves, under the sim it always had, as a legacy task that earns nothing', () => {
    const want: [string, string[]][] = [
      ['sim-quant', QUANT],
      ['sim-wgsl', WGSL],
      ['sim-batching', BATCHING],
      ['sim-engine', ENGINE_OWN],
    ]
    for (const [simId, ids] of want) {
      for (const id of ids) {
        const t = reg.byId(id)
        expect(t, id).toBeDefined()
        expect(t!.simId, id).toBe(simId)
        expect(t!.kind, id).toBe('legacy')
        expect(t!.kcs, id).toEqual([])
      }
    }
  })

  test('the batching tasks belong to the batching machine alone', () => {
    const ids = (machine?: string) => reg.forSim('sim-batching', machine).map((t) => t.id)
    expect(ids('batching')).toEqual(BATCHING)
    expect(ids()).toEqual([])
    expect(ids('scheduler')).not.toContain('batch-policy')
    expect(ids('context-switch')).not.toContain('batch-policy')
    expect(ids('scheduler')).toHaveLength(5)
    expect(ids('context-switch').filter((id) => BATCHING.includes(id))).toEqual([])
  })

  test('the engine list is machine-less: its own tasks and the extension tasks show on every machine', () => {
    for (const machine of [undefined, 'executor']) {
      const ids = reg.forSim('sim-engine', machine).map((t) => t.id)
      expect([...ids].sort()).toEqual([...ENGINE_OWN, ...ENGINE_EXT].sort())
    }
  })

  test('the quantizer and WGSL lists are machine-less', () => {
    expect(reg.forSim('sim-quant').map((t) => t.id)).toEqual(QUANT)
    expect(reg.forSim('sim-wgsl').map((t) => t.id)).toEqual(WGSL)
  })
})

describe('the checklists render as they did', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
    // what the sims read and the mini DOM does not model: a canvas context (they draw nothing without one) and the
    // value setter of an input, which Radix's slider looks up on the prototype. Both are removed again below.
    ;(MiniElement.prototype as unknown as Record<string, unknown>).getContext = () => null
    Object.defineProperty(MiniElement.prototype, 'options', { configurable: true, get: () => [] })
    Object.defineProperty((globalThis as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement.prototype, 'value', {
      configurable: true,
      get: () => '',
      set: () => {},
    })
  })
  afterAll(async () => {
    delete (MiniElement.prototype as unknown as Record<string, unknown>).getContext
    delete (MiniElement.prototype as unknown as Record<string, unknown>).options
    await dom.uninstall()
  })

  /** The full text: a title is cut at 80 characters, the setup is not. */
  const texts = (ids: string[]) => ids.map((id) => reg.byId(id)!.setup)
  const list = (root: MiniElement) => root.querySelectorAll('ul').find((u) => u.getAttribute('aria-label') === 'exercise tasks')
  const rows = (root: MiniElement) => (list(root)?.querySelectorAll('li') ?? []).map((li) => li.textContent)

  async function open(path: string) {
    const page = await dom.mount(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App)))
    await dom.until(() => list(page.container) !== undefined, 5_000)
    return page
  }

  /** Each row starts with the task's text (an xp badge follows it). */
  const expectRows = (root: MiniElement, ids: string[]) => {
    const got = rows(root)
    expect(got).toHaveLength(ids.length)
    texts(ids).forEach((t, i) => expect(got[i].startsWith(t), t).toBe(true))
  }

  test('/lab/quantizer lists the four quantizer tasks', async () => {
    const page = await open('/lab/quantizer')
    expectRows(page.container, QUANT)
    await page.unmount()
  })

  test('/lab/wgsl lists the four WGSL tasks', async () => {
    const page = await open('/lab/wgsl')
    expectRows(page.container, WGSL)
    await page.unmount()
  })

  test('/lab/engine lists its five tasks, then the six extension tasks', async () => {
    const page = await open('/lab/engine')
    expectRows(page.container, [...ENGINE_OWN, ...ENGINE_EXT])
    await page.unmount()
  })

  test('/lab/batching lists the batching tasks on its machine, and each other machine its own', async () => {
    const page = await open('/lab/batching')
    expectRows(page.container, BATCHING)

    const tab = (label: string) => page.container.querySelectorAll('button').find((b) => b.textContent.includes(label))!
    await dom.press(tab('CPU scheduler'))
    await dom.until(() => rows(page.container)[0]?.startsWith(reg.byId('t-sched-fifo')!.setup) === true)
    const sched = rows(page.container)
    expect(sched).toHaveLength(5)
    for (const t of texts(BATCHING)) expect(sched.some((r) => r.startsWith(t))).toBe(false)

    await dom.press(tab('context switch'))
    await dom.until(() => rows(page.container).length !== 5 || !rows(page.container)[0]?.startsWith(reg.byId('t-sched-fifo')!.setup))
    for (const t of texts(BATCHING)) expect(rows(page.container).some((r) => r.startsWith(t))).toBe(false)

    await dom.press(tab('continuous batching'))
    await dom.until(() => rows(page.container).length === BATCHING.length)
    expectRows(page.container, BATCHING)
    await page.unmount()
  })
})
