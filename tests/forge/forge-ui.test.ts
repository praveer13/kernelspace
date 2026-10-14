/**
 * The Forge UI fixes of the 2c final review (task CF6): the walk keeps the Make step (and with it a running folder
 * watch) mounted across step switches, a check with no ladder gets its packet at once, "make it green" prints the
 * workspace target/ path, a lab with a bundle never shows the plain page first, the panel is named for the lab, /forge
 * does not fade its cards, and the Error Museum's chips move focus. There is no DOM in this suite: components are
 * rendered to markup, pure helpers are called with fakes, and the page wiring is read from source, as forgelab-page
 * does. Focus, the real fade and the real tab are checked in a browser (axe at 360 and 1280 px; Playwright).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

const src = join(import.meta.dir, '../../src')
const read = (p: string) => readFileSync(join(src, p), 'utf8')
const lab02 = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
const STEPS: PrimmStepId[] = ['predict', 'run', 'investigate', 'modify', 'make']

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
    // and the source never renders them behind a step test
    expect(read('components/forge/PrimmPanel.tsx')).not.toMatch(/active === 'make'\s*&&/)
  })

  test('the Make tab says "watching" while a watch runs, and nothing otherwise', async () => {
    expect(await panel('predict', { watching: true })).toContain('data-watching-note')
    expect(await panel('predict', { watching: true })).toContain('your build folder')
    expect(await panel('predict')).not.toContain('data-watching-note')
  })

  test('FolderWatch tells its page when a watch starts and ends, and the page hands it to the walk', () => {
    const fw = read('components/forge/FolderWatch.tsx')
    expect(fw).toContain('told.current?.(watching)')
    const page = read('pages/ForgeLab.tsx')
    expect(page).toContain('onWatching={setWatching}')
    expect(page).toContain('watching={watching}')
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
    expect(read('components/forge/PrimmPanel.tsx')).not.toContain('labName')
  })

  test('ForgeLab passes the lab’s own title', () => {
    expect(read('pages/ForgeLab.tsx')).toContain('title={lab.title}')
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

  test('ForgeLab mounts it rather than printing lab.artifact itself', () => {
    const page = read('pages/ForgeLab.tsx')
    expect(page).toContain('<MakeGreen lab={lab} />')
    expect(page).not.toContain('the artifact to drop below')
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

  test('the page starts in `loading` for a lab with a bundle, and renders the placeholder, not the plain page', () => {
    const page = read('pages/ForgeLab.tsx')
    expect(page).toContain("useState<BundleState>({ status: expected ? 'loading' : 'none' })")
    // the plain page is for a lab with no bundle, or one whose chunk failed
    expect(page).toContain("bundleState.status === 'none' || bundleState.status === 'failed' ? (")
    expect(page).toContain('{bundle === undefined ? (')
    expect(page).toContain('<WalkPlaceholder />')
    expect(page).not.toMatch(/\bbundle !== undefined \? \(\s*<>\s*\{\/\* the walk/)
  })

  test('the walk and the drop zone mount once: the walk’s fallback is the placeholder, not a second copy of the drop zone', () => {
    const page = read('pages/ForgeLab.tsx')
    expect(page).not.toContain('fallback={doing}')
    expect((page.match(/\{doing\}/g) ?? []).length).toBe(1)
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
  test('slide, never fade: a half-faded card measured below 4.5:1 for its small labels', () => {
    const page = read('pages/Forge.tsx')
    expect(page).not.toMatch(/opacity:\s*[01]/)
    expect(page).toContain('initial={{ y: 16 }}')
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

  test('the page wires every chip to it, with the learner’s motion preference, and the deep link still jumps instantly', () => {
    const page = read('pages/Errors.tsx')
    expect(page).toContain('onClick={(ev) => goTo(ev, e.code)}')
    expect(page).toContain('jumpToEntry(document, code, scrollBehavior())')
    expect(page).toContain("'instant'")
    expect(page).toContain("import { scrollBehavior } from '@/lib/lesson-scroll'")
    // the click and the hash effect do not both scroll
    expect(page).toContain('handled.current = `#${code}`')
  })
})
