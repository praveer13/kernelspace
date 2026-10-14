/**
 * The wiring of ForgeLab v2 and the Forge index (docs/specs/wave-1.md §12.3, §13, §14.3; task C17). Most of the
 * contracts here are read from the page's source because they are one-line wirings that must not drift; the
 * Wave 3 mounts (task 3a-06) are the exception. They are checked by mounting the page in a small DOM
 * (tests/dom/mini-dom.ts), dropping a module, and reading the props the three panels were given. The panels are
 * replaced by probes for that test and put back afterwards, because bun runs every test file in one process.
 * The rendered layout is checked in the browser (axe at 360 and 1280 px, a real wasm through every provenance).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { FORGE_LABS } from '../../src/data/labs'
import { useProgress } from '../../src/lib/progress'
import { installDom, MiniEvent, type DomKit, type MiniElement } from '../dom/mini-dom'

const src = join(import.meta.dir, '../../src')
const read = (p: string) => readFileSync(join(src, p), 'utf8')
const page = read('pages/ForgeLab.tsx')
const index = read('pages/Forge.tsx')

describe('ForgeLab writes what the run earned, and a reference module nothing', () => {
  test('a run is graded on fresh seeds and written through recordLabRun with the provenance creditFor gave', () => {
    expect(page).toContain("seeds: 'fresh'")
    expect(page).toContain('creditFor(report')
    expect(page).toContain('recordLabRun(toLabRun(report, credit, required')
    expect(page).not.toContain('recordLabResult')
  })

  test('the write sits behind `credit !== null`, which is what a reference build gets', () => {
    const guard = page.indexOf('if (credit !== null)')
    const write = page.indexOf('recordLabRun(toLabRun(')
    expect(guard).toBeGreaterThan(0)
    expect(write).toBeGreaterThan(guard)
    // and nothing writes to the ledger before the guard
    expect(page.slice(0, guard)).not.toMatch(/recordLabRun\(|recordItems\(|unlockAchievement\(/)
  })

  test('the completion panel and the achievement are never shown for a credit of none', () => {
    expect(page).toContain('requiredReportPassed && run.credit !== null')
  })

  test('Prove it and the completion panel hang off a credited pass, so a green reference run opens neither', () => {
    expect(page).toContain("run.kind === 'report' && creditedRequiredPass(run.credit, counts)")
    expect(page).not.toMatch(/requiredReportPassed = report !== null/)
  })

  test('the credit sentence is told how many required checks this run failed', () => {
    expect(page).toContain('requiredFailed: requiredFailedCount(report, required)')
  })

  test('the credit sentence is shown under every result', () => {
    expect(page).toContain('<CreditLine note={run.note} />')
  })
})

describe('what ForgeLab mounts', () => {
  test('a lab with a bundle mounts the walk (with the drop zone in Make), the hint ladder and Prove it, each given the bundle', () => {
    expect(page).toContain("import('@/components/forge/PrimmPanel')")
    expect(page).toContain("import('@/components/forge/HintLadder')")
    expect(page).toContain("import('@/components/forge/ProveIt')")
    expect(page).toContain('<HintLadder bundle={bundle} reports={reports} />')
    expect(page).toMatch(/<ProveIt bundle=\{bundle\} unlocked=\{done \|\| requiredReportPassed\} \/>/)
    expect(page).toMatch(/<PrimmPanel\s+bundle=\{bundle\}[\s\S]*\{doing\}[\s\S]*<\/PrimmPanel>/)
  })

  test('the walk is a lazy chunk whose fallback is the walk-shaped placeholder, never the drop-zone content', () => {
    expect(page).toContain('<Suspense fallback={<WalkPlaceholder />}>')
    expect(page).not.toContain('<Suspense fallback={doing}>')
  })

  test('every lab mounts the discussion as a lab thread', () => {
    expect(page).toContain("import Discussion from '@/components/community/Discussion'")
    expect(page).toContain('<Discussion kind="lab" id={lab.id} />')
  })

  test('the per-check row shows the panic text and the trace', () => {
    expect(page).toContain('panic text and trace')
    expect(page).toContain('Panic text of ${row.id}')
    expect(page).toContain('Trace of ${row.id}')
  })

  test('the page is keyed by lab, so a run never carries across labs', () => {
    expect(page).toContain('<LabPage key={lab.id} lab={lab} />')
  })
})

describe('XP labels come from labXp', () => {
  test('ForgeLab and the Forge index print labXp, not the flat XP.lab', () => {
    for (const text of [page, index]) {
      expect(text).toContain("import { labXp } from '@/lib/economy'")
      expect(text).toContain('labXp(lab.id)')
      expect(text).not.toMatch(/XP\.lab\b/)
    }
  })
})

describe('reduced motion', () => {
  // App.tsx loads each page that reaches framer-motion through `lazyMotion`, which wraps it in MotionScope;
  // a second wrapper inside the page would only nest. Both pages import framer-motion, so both must be routed that way.
  test('Forge and ForgeLab are routed through lazyMotion', () => {
    const app = read('App.tsx')
    for (const name of ['Forge', 'ForgeLab']) expect(app).toMatch(new RegExp(`const ${name} = lazyMotion\\(`))
    expect(page).toContain("from 'framer-motion'")
    expect(index).toContain("from 'framer-motion'")
  })

  test('the spinner only turns when motion is allowed', () => {
    expect(page).toContain('motion-safe:animate-spin')
  })
})

describe('the discussion consent control', () => {
  test('"Always load on this device" has a label hit area of at least 44 x 44 px (min-h-11 min-w-11), still a native checkbox', () => {
    const d = read('components/community/Discussion.tsx')
    const label = /<label htmlFor=\{checkId\} className="([^"]+)"/.exec(d)?.[1] ?? ''
    expect(label).toContain('min-h-11')
    expect(label).toContain('min-w-11')
    expect(d).toContain('type="checkbox"')
    expect(d).toContain('Always load on this device')
  })
})

/* ---------------------------------- the Wave 3 mounts (3a-06) ---------------------------------- */

describe('ForgeLab mounts the twin, the race and Prove-it v2 with what InstallButton gets', () => {
  const lab = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
  const root = join(import.meta.dir, '../..')
  const panelPath = (name: string) => join(root, `src/components/forge/${name}.tsx`)
  const workerPath = join(root, 'src/lib/lab-worker.ts')
  const installPath = join(root, 'src/components/engine/InstallButton.tsx')

  /** What each probe was last rendered with: the props themselves, so identity can be compared. */
  const seen: Record<string, Record<string, unknown> | undefined> = {}
  // React's lazy keeps the component it first loaded, so after the restore a probe still on a page renders nothing,
  // as the stub it stood in for does.
  let probing = true
  const probe = (name: string) => (props: Record<string, unknown>) => {
    if (!probing) return null
    seen[name] = props
    return createElement('i', { 'data-probe': name })
  }
  const real: Record<string, unknown> = {}
  let dom: DomKit
  let restoreEnv = () => {}
  // the dropped module is credited, which writes the ledger: put the store back for the files that run after this one
  let ledger: ReturnType<typeof useProgress.getState>

  const green = { lab: lab.id, reference: false, abi: 2, version: 2, seeds: 'fresh', ms: 3, checks: lab.checks.map((c) => ({ id: c.id, label: c.label, status: 'pass', msg: '' })) }

  beforeAll(async () => {
    for (const p of [panelPath('TwinPanel'), panelPath('RaceReference'), panelPath('ProveFromModule'), workerPath, installPath]) real[p] = { ...(await import(p)) }
    mock.module(panelPath('TwinPanel'), () => ({ default: probe('twin') }))
    mock.module(panelPath('RaceReference'), () => ({ default: probe('race') }))
    mock.module(panelPath('ProveFromModule'), () => ({ default: probe('prove') }))
    mock.module(installPath, () => ({ default: probe('install') }))
    mock.module(workerPath, () => ({ ...(real[workerPath] as object), runLab: async () => green }))
    restoreEnv = () => {
      for (const p of [panelPath('TwinPanel'), panelPath('RaceReference'), panelPath('ProveFromModule'), workerPath, installPath]) mock.module(p, () => real[p] as object)
    }
    ledger = useProgress.getState()
    dom = await installDom()
  })
  afterAll(async () => {
    await dom.uninstall()
    useProgress.setState(ledger, true)
    probing = false
    restoreEnv()
  })

  test('the twin is mounted before any run, told the lab and that it is not done; race and Prove-it v2 wait for a run', async () => {
    const routes = createElement(Routes, null, createElement(Route, { path: '/forge/:labId', element: createElement((await import('../../src/pages/ForgeLab')).default) }))
    const page = await dom.mount(createElement(MemoryRouter, { initialEntries: [`/forge/${lab.id}`] }, routes))
    await dom.until(() => page.container.querySelector('[data-probe="twin"]') !== null && page.container.querySelector('[data-step-body="make"]') !== null)
    expect(seen.twin).toMatchObject({ lab, done: false })
    expect(page.container.querySelector('[data-probe="race"]')).toBeNull()
    expect(page.container.querySelector('[data-probe="prove"]')).toBeNull()

    // a module dropped on the page: the same bytes, report and credit reach InstallButton, the race and Prove-it v2
    const bytes = new Uint8Array([0, 97, 115, 109]).buffer
    const file = { name: 'lab.wasm', arrayBuffer: async () => bytes }
    // A lab completed shows a toast and clears it 3.5 s later through window.setTimeout; that timer must not fire
    // after this file's DOM is gone (bun runs the next file in the same process), so the page's timers are kept and cleared.
    const timers: ReturnType<typeof setTimeout>[] = []
    ;(window as unknown as { setTimeout: typeof setTimeout }).setTimeout = ((fn: () => void, ms?: number) => {
      const handle = setTimeout(fn, ms)
      timers.push(handle)
      return handle
    }) as typeof setTimeout
    const input = page.container.querySelector('input[type="file"]') as MiniElement
    // A finished run asks what has focus whether it is a field (`input:not([type=file])`); the small DOM has no :not().
    // Nothing has focus here, so the body answers "no" and the results heading takes focus, as it would in a browser.
    Object.defineProperty(dom.document.body, 'matches', { value: () => false, configurable: true })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await dom.act(() => input.dispatchEvent(new MiniEvent('change', { bubbles: true })))
    await dom.until(() => page.container.querySelector('[data-probe="prove"]') !== null && page.container.querySelector('[data-probe="race"]') !== null)

    const bundle = await (await import('../../src/data/forge')).loadForgeBundle(lab.id)
    expect(seen.race).toMatchObject({ lab, report: green })
    expect(seen.race!.bytes).toBe(bytes)
    expect(seen.prove).toMatchObject({ lab, report: green })
    expect(seen.prove!.bytes).toBe(bytes)
    expect((seen.prove!.bundle as { labId: string }).labId).toBe(bundle.labId)
    expect(seen.race!.credit).toBe(seen.install!.credit)
    expect(seen.prove!.credit).toBe(seen.install!.credit)
    expect(seen.race!.report).toBe(seen.install!.report)
    expect(seen.prove!.bytes).toBe(seen.install!.bytes)
    // the credited pass is written to the ledger, and the twin is told the lab is done
    await dom.until(() => seen.twin!.done === true)
    expect(seen.twin).toMatchObject({ lab, done: true })
    await page.unmount()
    for (const handle of timers) clearTimeout(handle)
  })
})
