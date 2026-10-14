/**
 * The Forge UI fixes of the 2c final review (task CF6): the walk keeps the Make step (and with it a running folder
 * watch) mounted across step switches, a check with no ladder gets its packet at once, "make it green" prints the
 * workspace target/ path, a lab with a bundle never shows the plain page first, the panel is named for the lab, /forge
 * does not fade its cards, and the Error Museum's chips move focus. Components render to markup for what they print;
 * what they do is checked on mounted pages in a small DOM (tests/dom/mini-dom.ts): the lab page, /forge and /errors
 * are mounted, buttons are pressed, and the test reads the DOM and `document.activeElement` a learner would meet. Only
 * a few one-line wirings are still read from source, and each says why. The real fade, the real tab and contrast are
 * checked in a browser (axe at 360 and 1280 px; Playwright).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AskPacketView } from '../../src/components/forge/AskPacket'
import { MakeGreen } from '../../src/components/forge/MakeGreen'
import { PrimmPanel } from '../../src/components/forge/PrimmPanel'
import { WalkPlaceholder } from '../../src/components/forge/WalkPlaceholder'
import { forgeBundleIds, hasForgeBundle, loadForgeBundle } from '../../src/data/forge'
import type { PrimmStepId } from '../../src/data/forge/types'
import { FORGE_LABS } from '../../src/data/labs'
import { artifactPaths } from '../../src/lib/forge/setup'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'
import { hintRef } from '../../src/lib/forge/ladder'
import { HINT_EXPERIMENT, armFor, hintUnit, type Arm } from '../../src/lib/learner/experiments'
import { isPlainClick, jumpToEntry, type EntryScope } from '../../src/lib/museum-jump'
import Errors from '../../src/pages/Errors'
import Forge from '../../src/pages/Forge'
import ForgeLab from '../../src/pages/ForgeLab'
import { effectiveOpacity, installDom, MiniElement, MiniEvent, type DomKit, type Mounted } from '../dom/mini-dom'

const src = join(import.meta.dir, '../../src')
const read = (p: string) => readFileSync(join(src, p), 'utf8')
const lab02 = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
const STEPS: PrimmStepId[] = ['predict', 'run', 'investigate', 'modify', 'make']
const STEP_NAMES: Record<PrimmStepId, string> = { predict: 'Predict', run: 'Run', investigate: 'Investigate', modify: 'Modify', make: 'Make' }

/** The lab page at /forge/<id>, mounted once its bundle has loaded and the walk is on screen. */
function labPage(dom: DomKit, id = 'kv-block-manager'): Promise<Mounted> {
  const routes = createElement(Routes, null, createElement(Route, { path: '/forge/:labId', element: createElement(ForgeLab) }))
  return dom.mount(createElement(MemoryRouter, { initialEntries: [`/forge/${id}`] }, routes))
}
const stepTab = (root: MiniElement, step: PrimmStepId) => root.querySelectorAll('button').find((b) => new RegExp(`^${STEPS.indexOf(step) + 1}\\s*${STEP_NAMES[step]}`).test(b.textContent))!

/* ---------------------------------- a step switch does not end a watch ---------------------------------- */

describe('the Make step stays mounted when another step is open', () => {
  const panel = (initial: PrimmStepId, extra: Record<string, unknown> = {}) =>
    loadForgeBundle('kv-block-manager').then((bundle) =>
      renderToStaticMarkup(
        createElement(PrimmPanel, { bundle, checks: lab02.checks, passed: new Set<string>(), initial, title: lab02.title, ...extra }, createElement('p', { id: 'watch-here' }, 'folder watch lives here')),
      ),
    )

  test('on every other step the children (where the folder watch lives) are in the page, hidden', async () => {
    for (const step of STEPS.filter((s) => s !== 'make')) {
      const html = await panel(step)
      expect(html).toContain('id="watch-here"')
      expect(html).toMatch(/<div class="space-y-3" data-step-body="make" hidden="">/)
    }
  })

  test('on the Make step they are the same element, no longer hidden', async () => {
    const html = await panel('make')
    expect(html).toContain('id="watch-here"')
    expect(html).toContain('data-step-body="make"')
    expect(html).not.toMatch(/data-step-body="make" hidden/)
  })

  test('the children are rendered whatever the step, so switching steps has nothing to unmount', async () => {
    const counts = await Promise.all(STEPS.map(async (s) => ((await panel(s)).match(/id="watch-here"/g) ?? []).length))
    expect(counts).toEqual([1, 1, 1, 1, 1])
  })

  test('the Make tab says "watching" while a watch runs, and nothing otherwise', async () => {
    expect(await panel('predict', { watching: true })).toContain('data-watching-note')
    expect(await panel('predict', { watching: true })).toContain('your build folder')
    expect(await panel('predict')).not.toContain('data-watching-note')
  })

})

describe('on the mounted lab page, switching PRIMM steps leaves a running watch alone', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  /** A picked folder that has no target/ yet: a watch that is running, with nothing to run. */
  const notFound = async () => {
    throw Object.assign(new Error('not found'), { name: 'NotFoundError' })
  }
  async function watching() {
    dom.window.showDirectoryPicker = async () => ({ name: 'unzipped', getDirectoryHandle: notFound, getFileHandle: notFound })
    const page = await labPage(dom)
    await dom.until(() => page.container.querySelector('[data-step-body="make"]') !== null && page.container.querySelector('[data-folder-watch]') !== null)
    const zone = page.container.querySelector('[data-folder-watch]')!
    const start = page.container.querySelectorAll('button').find((b) => b.textContent.includes('Watch my build folder'))!
    await dom.press(start)
    await dom.until(() => zone.getAttribute('data-watching') === 'on')
    return { page, zone }
  }

  test('the watch starts from the page, and the Make tab says so from any step', async () => {
    const { page, zone } = await watching()
    expect(zone.getAttribute('data-watching')).toBe('on')
    expect(zone.querySelector('[data-watch-status]')!.textContent).toContain('No target/ folder in "unzipped"')
    // the page handed `watching` to the walk: the tab names it on the step the learner is on (Predict)
    const note = page.container.querySelector('[data-watching-note]')
    expect(note, 'the Make tab shows a watching note').not.toBeNull()
    expect(stepTab(page.container, 'make').textContent).toContain('watching')
    await page.unmount()
  })

  test('every step switch keeps the same watch element, still on, still named on the Make tab', async () => {
    const { page, zone } = await watching()
    for (const step of [...STEPS, 'predict' as const]) {
      await dom.press(stepTab(page.container, step))
      expect(page.container.querySelector('[data-folder-watch]'), `after switching to ${step}`).toBe(zone)
      expect(zone.getAttribute('data-watching')).toBe('on')
      expect(page.container.querySelector('[data-watching-note]')).not.toBeNull()
      // the folder watch lives in the Make step: hidden unless it is the open one, but in the page either way
      const make = page.container.querySelector('[data-step-body="make"]')!
      expect(make.contains(zone)).toBe(true)
      expect(make.hidden).toBe(step !== 'make')
    }
    await page.unmount()
  })

  test('stopping the watch is what ends it: the note goes and the button offers to watch again', async () => {
    const { page, zone } = await watching()
    await dom.press(stepTab(page.container, 'run'))
    await dom.press(page.container.querySelectorAll('button').find((b) => b.textContent.includes('Stop watching'))!)
    await dom.until(() => zone.getAttribute('data-watching') === 'off')
    expect(page.container.querySelector('[data-watching-note]')).toBeNull()
    expect(page.container.querySelectorAll('button').some((b) => b.textContent.includes('Watch my build folder'))).toBe(true)
    await page.unmount()
  })
})

/* ---------------------------------- the panel is named for the lab ---------------------------------- */

describe('the walk is named from the lab, not from the discussions label', () => {
  test('"<lab title>, in five steps"', async () => {
    const bundle = await loadForgeBundle('kv-block-manager')
    const html = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks: lab02.checks, passed: new Set<string>(), title: lab02.title }))
    expect(html).toContain(`aria-label="${lab02.title}, in five steps"`)
    expect(html).not.toContain('Lab 02 in five steps')
  })

  test('without a title it still says what it is, and never a stripped "[lab 02]"', async () => {
    const bundle = await loadForgeBundle('kv-block-manager')
    const html = renderToStaticMarkup(createElement(PrimmPanel, { bundle, checks: lab02.checks, passed: new Set<string>() }))
    expect(html).toContain('aria-label="The lab, in five steps"')
    expect(html).not.toMatch(/aria-label="[^"]*\[/)
  })

  test('the lab page names its walk with the lab’s own title', async () => {
    const dom = await installDom()
    try {
      const page = await labPage(dom)
      await dom.until(() => page.container.querySelector('[data-step-body="make"]') !== null)
      expect(page.container.querySelector(`[aria-label="${lab02.title}, in five steps"]`)).not.toBeNull()
      expect(page.container.querySelector('[aria-label^="Lab 02 in five steps"]')).toBeNull()
      await page.unmount()
    } finally {
      await dom.uninstall()
    }
  })
})

/* ---------------------------------- a check with no ladder gets its packet ---------------------------------- */

describe('AskPacket for a check with no ladder', () => {
  const row = (id: string, status: CheckResult['status'] = 'fail'): CheckResult => ({ id, label: `label of ${id}`, status, msg: `${id} came back ${status}`, ms: 1 }) as CheckResult
  const run = (checks: CheckResult[]): LabRunReport => ({ lab: 'kv-block-manager', reference: false, abi: 2, version: 1, checks, seeds: 'fresh', ms: 1 }) as LabRunReport
  const seedFor = (check: string, arm: Arm): number => {
    for (let s = 1; ; s++) if (armFor(HINT_EXPERIMENT, hintUnit('kv-block-manager', check), s) === arm) return s
  }
  const view = (reports: LabRunReport[], ladderIds: readonly string[] | undefined, expSeed?: number, acks: Record<string, string> = {}) =>
    renderToStaticMarkup(createElement(AskPacketView, { lab: lab02, reports, ladderIds, acks, expSeed }))

  test('lab 02’s adapter_unified_paging is optional and no ladder covers it', async () => {
    const bundle = await loadForgeBundle('kv-block-manager')
    expect(lab02.checks.find((c) => c.id === 'adapter_unified_paging')?.optional).toBe(true)
    expect(bundle.ladder.map((l) => l.checkId)).not.toContain('adapter_unified_paging')
  })

  test('in the ladder arm it shows the buttons at once, with no waiting row and no arm recorded', async () => {
    const bundle = await loadForgeBundle('kv-block-manager')
    const ids = bundle.ladder.map((l) => l.checkId)
    const out = view([run([row('adapter_unified_paging')])], ids, seedFor('adapter_unified_paging', 'ladder'))
    expect(out).toContain('data-packet-check="adapter_unified_paging"')
    expect(out).toContain('ask claude')
    expect(out).toContain('copy packet')
    expect(out).toContain('data-arm="none"')
    expect(out).not.toContain('The packet opens after R2')
  })

  test('in the packet arm and with no seed it shows them too', async () => {
    const bundle = await loadForgeBundle('kv-block-manager')
    const ids = bundle.ladder.map((l) => l.checkId)
    for (const seed of [seedFor('adapter_unified_paging', 'packet'), undefined]) {
      const out = view([run([row('adapter_unified_paging')])], ids, seed)
      expect(out).toContain('ask chatgpt')
      expect(out).not.toContain('The packet opens after R2')
    }
  })

  test('a check that has a ladder still waits for R2 in the ladder arm, and gets it once R2 is open', async () => {
    const bundle = await loadForgeBundle('kv-block-manager')
    const ids = bundle.ladder.map((l) => l.checkId)
    const check = ids[0]
    const ladderSeed = seedFor(check, 'ladder')
    const waiting = view([run([row(check)])], ids, ladderSeed)
    expect(waiting).toContain('The packet opens after R2')
    expect(waiting).not.toContain('ask claude')
    const open = view([run([row(check)])], ids, ladderSeed, { [hintRef(check, 'R2', 'kv-block-manager')]: '2026-10-04T09:00:00.000Z' })
    expect(open).toContain('ask claude')
    expect(open).toContain('data-arm="ladder"')
  })

  test('both in one run: the ladderless check is open and the laddered one waits', async () => {
    const bundle = await loadForgeBundle('kv-block-manager')
    const ids = bundle.ladder.map((l) => l.checkId)
    const seed = seedFor(ids[0], 'ladder')
    const out = view([run([row(ids[0]), row('adapter_unified_paging')])], ids, seed)
    expect(out.match(/The packet opens after R2/g)).toHaveLength(1)
    expect(out.match(/ask claude/g)?.length).toBeGreaterThanOrEqual(1)
  })

  test('a lab whose ladder is empty has no rungs for any check: every packet is open', () => {
    const out = view([run([row('anything')])], [], seedFor('anything', 'ladder'))
    expect(out).not.toContain('The packet opens after R2')
    expect(out).toContain('ask claude')
  })

  test('ForgeLab hands AskPacket the ladder’s check ids', () => {
    expect(read('pages/ForgeLab.tsx')).toContain('ladderIds={bundle.ladder.map((l) => l.checkId)}')
  })
})

/* ---------------------------------- make it green prints the workspace path ---------------------------------- */

describe('"2 · make it green" names the workspace target/ path', () => {
  const html = (l = lab02) => renderToStaticMarkup(createElement(MakeGreen, { lab: l })).replaceAll('<!-- -->', '')

  test('both spellings SetupLanes shows: from the unpacked folder and from inside the crate', () => {
    const out = html()
    const paths = artifactPaths(lab02)
    expect(out).toContain(paths.fromWorkspace)
    expect(out).toContain(paths.fromCrate)
    expect(paths.fromCrate.startsWith('../target/')).toBe(true)
  })

  test('the bare lab.artifact is no longer what follows "the artifact to drop below"', () => {
    const out = html()
    expect(out).not.toMatch(/the artifact to drop below:\s*<span[^>]*>target\//)
  })

  test('a Rust Zero drill, whose crate is two folders deep, prints two levels up', () => {
    const drill = FORGE_LABS.find((l) => l.id === 'rust-zero-r1')!
    const out = html(drill)
    expect(out).toContain('../../target/wasm32-unknown-unknown/release/rust_zero_r1.wasm')
    expect(out).toContain(`cd ${drill.crateDir}`)
  })

  test('it keeps the loop and the check counts', () => {
    const out = html()
    expect(out).toContain('aria-labelledby="make-green"')
    expect(out).toContain('cargo build --release --target wasm32-unknown-unknown')
    expect(out).toContain('6 required + 1 advanced')
  })

  test('the lab page shows both spellings, once, and not the bare artifact after "the artifact to drop below"', async () => {
    const dom = await installDom()
    try {
      const page = await labPage(dom)
      await dom.until(() => page.container.querySelector('[data-step-body="make"]') !== null)
      const text = page.container.textContent
      const paths = artifactPaths(lab02)
      expect(text).toContain(paths.fromWorkspace)
      expect(text).toContain(paths.fromCrate)
      expect(page.container.querySelectorAll('[aria-labelledby="make-green"]')).toHaveLength(1)
      expect(text).not.toMatch(/the artifact to drop below:\s*target\//)
      await page.unmount()
    } finally {
      await dom.uninstall()
    }
  })
})

/* ---------------------------------- the lab page is stable while the bundle loads ---------------------------------- */

describe('a lab with a bundle never shows the plain page first', () => {
  test('hasForgeBundle answers at once and agrees with the registry for every lab', async () => {
    const ids = await forgeBundleIds()
    expect(ids).toContain('kv-block-manager')
    for (const l of FORGE_LABS) expect(hasForgeBundle(l.id)).toBe(ids.includes(l.id))
    expect(hasForgeBundle('rust-allocator')).toBe(true)
    expect(hasForgeBundle('no-such-lab')).toBe(false)
  })

  const firstRender = (id: string) =>
    renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [`/forge/${id}`] }, createElement(Routes, null, createElement(Route, { path: '/forge/:labId', element: createElement(ForgeLab) }))))

  test('the first render of a lab with a bundle is the placeholder, not the plain page', () => {
    const html = firstRender('kv-block-manager')
    expect(html).toContain('data-walk-placeholder')
    // the plain page (get the lab, make it green, the drop zone) is for a lab with no bundle, or one whose chunk failed
    expect(html).not.toContain('aria-labelledby="make-green"')
    expect(html).not.toContain('data-folder-watch')
    expect(html).not.toContain('data-step-body')
  })

  test('the walk and the drop zone mount once: the placeholder gives way to the walk, and neither leaves a second copy of the drop zone', async () => {
    const dom = await installDom()
    try {
      const page = await labPage(dom)
      await dom.until(() => page.container.querySelector('[data-step-body="make"]') !== null)
      expect(page.container.querySelector('[data-walk-placeholder]')).toBeNull()
      expect(page.container.querySelectorAll('[aria-labelledby="make-green"]')).toHaveLength(1)
      expect(page.container.querySelectorAll('input[type="file"]')).toHaveLength(1)
      await page.unmount()
    } finally {
      await dom.uninstall()
    }
  })

  test('the placeholder has the walk’s shape: a status line, five step tabs, a lead-in and a card', () => {
    const html = renderToStaticMarkup(createElement(WalkPlaceholder))
    expect(html).toContain('data-walk-placeholder')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('role="status"')
    expect(html.match(/<li /g)).toHaveLength(5)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('data-folder-watch')
  })
})

/* ---------------------------------- /forge does not fade its cards ---------------------------------- */

describe('/forge entrances', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  test('slide, never fade: no card, label or ancestor of one is faded when the page mounts', async () => {
    const page = await dom.mount(createElement(MemoryRouter, null, createElement(Forge)))
    // the small mono labels are what measured below 4.5:1 inside a half-faded card (text-text-3 on surface-1)
    const labels = page.container.querySelectorAll('.text-text-3')
    expect(labels.length).toBeGreaterThan(10)
    for (const el of labels) expect(effectiveOpacity(el), `"${el.textContent}" is faded`).toBe(1)
    // and the entrances are the sliding kind: the cards start offset, so the test is not passing on a page with no motion
    const cards = page.container.querySelectorAll('[data-lab-card], a[href^="/forge/"]')
    expect(cards.length).toBeGreaterThan(10)
    const sliding = page.container.querySelectorAll('div').filter((d) => /translate/.test(d.style.transform as string))
    expect(sliding.length).toBeGreaterThan(5)
    for (const el of sliding) expect(effectiveOpacity(el)).toBe(1)
    await page.unmount()
  })

  test('they are still unfaded a moment into the entrance', async () => {
    const page = await dom.mount(createElement(MemoryRouter, null, createElement(Forge)))
    await dom.act(() => new Promise((r) => setTimeout(r, 120)))
    for (const el of page.container.querySelectorAll('.text-text-3')) expect(effectiveOpacity(el), `"${el.textContent}" is faded`).toBe(1)
    await page.unmount()
  })
})

/* ---------------------------------- the Error Museum's chips move focus ---------------------------------- */

describe('jumping to an Error Museum entry', () => {
  function fake(withHeading = true) {
    const log: string[] = []
    const entry = {
      scrollIntoView: (o?: { behavior?: string }) => void log.push(`scroll ${o?.behavior}`),
      querySelector: (sel: string) => (withHeading && sel === 'h2' ? { focus: (o?: { preventScroll?: boolean }) => void log.push(`focus h2 preventScroll=${o?.preventScroll}`) } : null),
    }
    const scope: EntryScope = { getElementById: (id) => (id === 'E0597' ? entry : null) }
    return { log, scope }
  }

  test('scrolls to the entry, then focuses its heading without a second scroll', () => {
    const { log, scope } = fake()
    expect(jumpToEntry(scope, 'E0597', 'smooth')).toBe(true)
    expect(log).toEqual(['scroll smooth', 'focus h2 preventScroll=true'])
  })

  test('takes the scroll behaviour it is given: instant for a deep link, the motion preference for a click', () => {
    const a = fake()
    jumpToEntry(a.scope, 'E0597', 'instant')
    expect(a.log[0]).toBe('scroll instant')
    const b = fake()
    jumpToEntry(b.scope, 'E0597', 'auto')
    expect(b.log[0]).toBe('scroll auto')
  })

  test('an unknown code does nothing, and an entry without a heading still scrolls', () => {
    const { log, scope } = fake()
    expect(jumpToEntry(scope, 'E9999', 'auto')).toBe(false)
    expect(log).toEqual([])
    const bare = fake(false)
    expect(jumpToEntry(bare.scope, 'E0597', 'auto')).toBe(true)
    expect(bare.log).toEqual(['scroll auto'])
  })

  test('only a plain left click is taken over: a modified click keeps the link’s own behaviour', () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }
    expect(isPlainClick(base)).toBe(true)
    for (const over of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) expect(isPlainClick({ ...base, ...over })).toBe(false)
  })

})

describe('the Error Museum page: a chip click and a deep link both land on the entry', () => {
  let dom: DomKit
  let scrolls: Array<{ id: string; behavior: string | undefined }>
  const proto = MiniElement.prototype as unknown as { scrollIntoView(o?: { behavior?: string }): void }
  const original = proto.scrollIntoView
  beforeAll(async () => {
    dom = await installDom()
    proto.scrollIntoView = function (this: MiniElement, o) {
      scrolls.push({ id: this.id, behavior: o?.behavior })
    }
  })
  afterAll(async () => {
    proto.scrollIntoView = original
    await dom.uninstall()
  })

  const museum = (at = '/errors') => dom.mount(createElement(MemoryRouter, { initialEntries: [at] }, createElement(Errors)))
  const chip = (page: Mounted, code: string) => page.container.querySelector(`nav a[href="#${code}"]`)!
  const heading = (page: Mounted, code: string) => page.container.querySelector(`#${code} h2`)!
  const reduceMotion = (on: boolean) => {
    dom.window.matchMedia = (q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })
  }

  test('a deep link jumps at once (instant, as the browser’s own fragment scroll would) and focuses the heading', async () => {
    scrolls = []
    const page = await museum('/errors#E0597')
    await dom.until(() => scrolls.length > 0)
    expect(scrolls).toEqual([{ id: 'E0597', behavior: 'instant' }])
    expect(dom.document.activeElement).toBe(heading(page, 'E0597'))
    await page.unmount()
  })

  test('a plain click on a chip scrolls smoothly, focuses the heading, and scrolls once, not again for the new hash', async () => {
    scrolls = []
    reduceMotion(false)
    const page = await museum()
    await dom.press(chip(page, 'E0382'))
    await dom.act(() => new Promise((r) => setTimeout(r, 20)))
    expect(scrolls).toEqual([{ id: 'E0382', behavior: 'smooth' }])
    expect(dom.document.activeElement).toBe(heading(page, 'E0382'))
    await page.unmount()
  })

  test('under reduced motion the click does not animate', async () => {
    scrolls = []
    reduceMotion(true)
    const page = await museum()
    await dom.press(chip(page, 'E0499'))
    expect(scrolls).toEqual([{ id: 'E0499', behavior: 'auto' }])
    expect(dom.document.activeElement).toBe(heading(page, 'E0499'))
    reduceMotion(false)
    await page.unmount()
  })

  test('a modified click keeps the link’s own behaviour: no scroll, no focus move', async () => {
    scrolls = []
    const page = await museum()
    const link = chip(page, 'E0505')
    await dom.act(() => link.dispatchEvent(new MiniEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true })))
    expect(scrolls).toEqual([])
    expect(dom.document.activeElement).toBe(dom.document.body)
    await page.unmount()
  })
})
