/**
 * The generic forge panels (docs/specs/wave-2.md §13.1; task 2c-02): every panel takes a `ForgeBundle` and holds no
 * lab's data, ForgeLab mounts them for any lab whose bundle exists, and the three slots (SetupLanes, FolderWatch,
 * AskPacket) take their final props now. The panels are rendered here against a bundle of an invented lab, so
 * anything that still came from lab 01 would show; lab 01 through the same panels is checked to be what Wave 1 shipped.
 * There is no DOM in this suite, so interaction (focus, the run strip playing) is checked in a browser.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { AskPacket, type AskPacketProps } from '../../src/components/forge/AskPacket'
import { FolderWatch, type FolderWatchProps } from '../../src/components/forge/FolderWatch'
import { HintLadderView } from '../../src/components/forge/HintLadder'
import { PrimmPanel } from '../../src/components/forge/PrimmPanel'
import ProveIt from '../../src/components/forge/ProveIt'
import { ReferenceRun } from '../../src/components/forge/ReferenceRun'
import { SetupLanes, type SetupLanesProps } from '../../src/components/forge/SetupLanes'
import { StagePanel } from '../../src/components/forge/StagePanel'
import { findForgeBundle } from '../../src/data/forge'
import lab01 from '../../src/data/forge/rust-allocator'
import { REFERENCE, RUN_SPEC, runChurn, runResponse } from '../../src/data/forge/rust-allocator/primm'
import type { ForgeBundle } from '../../src/data/forge/types'
import { KC } from '../../src/data/kc/ids'
import { FORGE_LABS, type ForgeLabCheck } from '../../src/data/labs'
import { hintRef } from '../../src/lib/forge/ladder'
import { gradeNumber, observationResponse, sameConfig, stageRows } from '../../src/lib/forge/primm'
import type { CheckResult, LabRunReport } from '../../src/lib/forge/types'

const src = join(import.meta.dir, '../../src')
const read = (p: string) => readFileSync(join(src, p), 'utf8')

const PANELS = [
  'components/forge/PrimmPanel.tsx',
  'components/forge/StagePanel.tsx',
  'components/forge/ReferenceRun.tsx',
  'components/forge/HintLadder.tsx',
  'components/forge/ProveIt.tsx',
]
const SLOTS = ['components/forge/SetupLanes.tsx', 'components/forge/FolderWatch.tsx', 'components/forge/AskPacket.tsx']

/* ------------------------- a lab that is not lab 01 ------------------------- */

const quiz = (q: string, options: string[]) => ({
  q,
  options,
  correct: [1],
  why: options.map((o) => `because ${o}`),
  explanation: 'fake explanation',
  kcs: [KC.alignment],
})

const FAKE_CHECKS: ForgeLabCheck[] = [
  { id: 'frob', label: 'frobnicates', stage: 1 },
  { id: 'twiddle', label: 'twiddles', stage: 2 },
]

const FAKE: ForgeBundle = {
  labId: 'fake-lab',
  stages: [
    { n: 1, title: 'Frob', minutes: 3, goal: 'Get `frob` to answer.' },
    { n: 2, title: 'Twiddle', minutes: 12, goal: 'Twiddle without leaks.' },
  ],
  primm: {
    steps: [
      { id: 'predict', title: 'Predict', blurb: 'Guess how many gizmos fit.' },
      { id: 'run', title: 'Run', blurb: 'Watch the gizmo pool fill.' },
      { id: 'investigate', title: 'Investigate', blurb: 'One question about gizmos.' },
      { id: 'modify', title: 'Modify', blurb: 'Grow the pool, predict, run.' },
      { id: 'make', title: 'Make', blurb: 'Build it in two stages.' },
    ],
    items: [
      { kind: 'estimate', id: 'fake.primm.p1', step: 'predict', nsec: 30, kcs: [KC.alignment], prompt: 'How many gizmos fit in the fake pool?', unit: 'gizmos', factor: 2, explain: 'Fake estimate explained.' },
      { kind: 'choice', id: 'fake.primm.i1', step: 'investigate', nsec: 30, item: { id: 'fake.primm.i1', kcs: [KC.alignment], q: quiz('Which gizmo goes first?', ['the red one', 'the blue one', 'the green one', 'none of them']) } },
      { kind: 'estimate', id: 'fake.primm.m1', step: 'modify', nsec: 30, kcs: [KC.alignment], prompt: 'How many gizmos fit after the change?', unit: 'gizmos', factor: 2, explain: 'Fake modify explained.' },
    ],
    run: {
      item: { id: 'fake.primm.r1', nsec: 20 },
      title: (c) => `Fake pool of ${c.size}`,
      disclaimer: 'The fake pool is a stand-in, not the fake lab’s check.',
      reference: { size: 4 },
      baseline: { size: 2 },
      run: (c) => {
        const size = Number(c.size)
        return {
          config: c,
          total: 10,
          value: size * 2,
          truth: 10,
          clean: size >= 4,
          summary: `The fake pool of ${size} held ${size * 2} gizmos.`,
          frames: [0, 5, 10].map((op) => ({
            op,
            cells: [op * 10, 50, 100],
            stats: [{ label: 'gizmos held', value: String(op) }],
            alt: `Fake pool at op ${op}.`,
          })),
        }
      },
      modify: { lead: 'Change the fake pool (size 4).', dials: [{ id: 'big', label: 'make the pool bigger', config: { size: 8 } }] },
    },
  },
  ladder: [
    {
      checkId: 'frob',
      r0: { prompt: 'What does `frob` do to the fake pool?', ideas: ['idea one fake', 'idea two fake', 'idea three fake'] },
      r1: { text: 'Fake concept text for frob.', link: { lessonId: 't1.l3', h2: 'The two operations that matter', anchor: 'the-two-operations-that-matter' } },
      r2: { text: 'Look in the `frob` function.', fn: 'frob' },
      r3: 'fake pseudo-code\nline two',
      r4: 'Fake design prose.',
    },
  ],
  prove: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
    id: `fake-${id}`,
    prompt: `Fake question ${id}: what does your \`frob\` do?`,
    model: `Fake model answer ${id}.`,
    ideas: [`fake idea ${id}1`, `fake idea ${id}2`, `fake idea ${id}3`] as const,
    kcs: [KC.alignment],
  })),
  discussionsLabel: '[lab 09]',
}

const row = (id: string, status: CheckResult['status'] = 'fail', extra: Partial<CheckResult> = {}): CheckResult => ({ id, label: id, status, msg: `${id} says no`, ...extra })
const report = (lab: string, checks: CheckResult[]): LabRunReport => ({ lab, reference: false, abi: 2, version: 2, checks, seeds: 'fresh', ms: 5 })
const ISO = '2026-10-04T09:00:00.000Z'

/* ------------------------------ no lab 01 in the panels ------------------------------ */

describe('the panels hold no lab’s data', () => {
  test('no panel or slot imports a lab’s directory, or names lab 01 in code', () => {
    for (const file of [...PANELS, ...SLOTS]) {
      const text = read(file)
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1])
      for (const spec of imports) {
        expect(spec).not.toMatch(/forge\/rust-allocator/)
        // the only thing a panel takes from src/data/forge is the contract's types
        if (spec.startsWith('@/data/forge')) expect(spec).toBe('@/data/forge/types')
      }
      expect(text).not.toContain('rust-allocator')
      expect(text).not.toMatch(/lab01\./)
    }
  })

  test('the panels take the bundle as a prop', () => {
    for (const file of ['PrimmPanel', 'StagePanel', 'ReferenceRun', 'HintLadder', 'ProveIt']) {
      expect(read(`components/forge/${file}.tsx`)).toMatch(/bundle: ForgeBundle/)
    }
  })

  test('the logic they share sits in lab-neutral modules, which name no lab either', () => {
    for (const file of ['lib/forge/primm.ts', 'lib/forge/ladder.ts', 'lib/forge/prove.ts']) {
      const text = read(file)
      expect(text).not.toContain('rust-allocator')
      expect(text).not.toMatch(/forge\/rust-allocator/)
    }
  })
})

/* ------------------------------ the panels, on another lab ------------------------------ */

describe('StagePanel and ReferenceRun draw from the bundle', () => {
  test('the stages are the bundle’s, counted in words, with their checks and the next command', () => {
    const html = renderToStaticMarkup(createElement(StagePanel, { bundle: FAKE, checks: FAKE_CHECKS, passed: new Set(['frob']) }))
    expect(html).toContain('Build in two stages')
    expect(html).toContain('1/2 green')
    expect(html).toContain('Stage 1')
    expect(html).toContain('Frob')
    expect(html).toContain('Twiddle without leaks.')
    expect(html).toContain('data-stage="2"')
    expect(html).toContain('<code>cargo test twiddle</code>')
    expect(html).not.toContain('Coalesce')
  })

  test('the run is the spec’s: its title, strip, live numbers, disclaimer and an empty status line', () => {
    const html = renderToStaticMarkup(createElement(ReferenceRun, { bundle: FAKE, config: { size: 4 } }))
    expect(html).toContain('Fake pool of 4')
    expect(html).toContain('aria-label="Fake pool at op 0."')
    expect(html).toContain('gizmos held')
    expect(html).toContain('op 0 / 10')
    expect(html).toContain('The fake pool is a stand-in, not the fake lab’s check.')
    expect(html).toContain('data-reference-run="fake-lab"')
    expect(html).toMatch(/<p role="status" aria-live="polite"[^>]*data-caption="true"><\/p>/)
    expect(html.match(/<button/g)?.length).toBe(1)
    // a title the caller gives wins
    expect(renderToStaticMarkup(createElement(ReferenceRun, { bundle: FAKE, config: { size: 4 }, title: 'Your run' }))).toContain('Your run')
  })
})

describe('PrimmPanel walks the bundle’s steps, items and dials', () => {
  const panel = (initial: 'predict' | 'run' | 'investigate' | 'modify' | 'make', children?: string) =>
    renderToStaticMarkup(createElement(PrimmPanel, { bundle: FAKE, checks: FAKE_CHECKS, passed: new Set<string>(), initial, title: 'Gizmo Pools', children }))

  test('it is named for the lab and its blurbs and tabs are the bundle’s', () => {
    const html = panel('predict')
    expect(html).toContain('aria-label="Gizmo Pools, in five steps"')
    expect(html).toContain('Guess how many gizmos fit.')
    expect(html).toContain('data-step-tab="modify"')
    expect(html).toContain('How many gizmos fit in the fake pool?')
    expect(html).not.toContain('Which gizmo goes first?') // an Investigate item
    expect(html).not.toContain('allocator')
  })

  test('Investigate shows its choice item, shuffled but whole, each in a fieldset with a live region', () => {
    const html = panel('investigate')
    expect(html).toContain('Which gizmo goes first?')
    for (const o of ['the red one', 'the blue one', 'the green one', 'none of them']) expect(html).toContain(o)
    expect(html).toContain('data-item="fake.primm.i1"')
    expect(html).toMatch(/<p role="status" class="sr-only" data-verdict="true"><\/p>/)
  })

  test('the Run step is gated on the Predict items, counted from the bundle', () => {
    const html = panel('run')
    expect(html).toContain('Answer the one question in step 1 first')
    expect(html).toContain('Go predict')
    expect(html).not.toContain('data-reference-run')
  })

  test('the Modify step offers the spec’s lead and dials, and a locked prediction field', () => {
    const html = panel('modify')
    expect(html).toContain('Change the fake pool (size 4).')
    expect(html).toContain('make the pool bigger')
    expect(html).toContain('How many gizmos fit after the change?')
    expect(html).not.toContain('turn coalescing off')
  })

  test('the Make step is the bundle’s stage list with whatever the page puts below it', () => {
    const html = renderToStaticMarkup(
      createElement(PrimmPanel, { bundle: FAKE, checks: FAKE_CHECKS, passed: new Set<string>(), initial: 'make' }, createElement('p', { id: 'below' }, 'the drop zone')),
    )
    expect(html).toContain('Build in two stages')
    expect(html).toContain('Stage 2')
    expect(html).toContain('id="below"')
  })

  test('a lab with no dials or no Modify item says so instead of failing', () => {
    const noDials: ForgeBundle = { ...FAKE, primm: { ...FAKE.primm, run: { ...FAKE.primm.run, modify: undefined } } }
    expect(renderToStaticMarkup(createElement(PrimmPanel, { bundle: noDials, checks: FAKE_CHECKS, passed: new Set<string>(), initial: 'modify' }))).toContain('no dials to turn yet')
    const noItem: ForgeBundle = { ...FAKE, primm: { ...FAKE.primm, items: FAKE.primm.items.filter((i) => i.step !== 'modify') } }
    expect(renderToStaticMarkup(createElement(PrimmPanel, { bundle: noItem, checks: FAKE_CHECKS, passed: new Set<string>(), initial: 'modify' }))).toContain('no Modify question yet')
  })
})

describe('HintLadderView reads the ladder, the acks’ namespace, the walkthrough and the label from the bundle', () => {
  const html = (bundle: ForgeBundle, reports: LabRunReport[], acks: Record<string, string> = {}) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(HintLadderView, { bundle, reports, acks, onAck: () => {}, now: () => 0 })))
  const all = (labId: string, check: string) => Object.fromEntries((['R0', 'R1', 'R2', 'R3', 'R4', 'bottom'] as const).map((r) => [hintRef(check, r, labId), ISO]))

  test('only a check with a ladder in this bundle gets a card', () => {
    // `align` has a ladder in lab 01, not in the fake lab
    const out = html(FAKE, [report('fake-lab', [row('frob'), row('align')])])
    expect(out).toContain('data-check="frob"')
    expect(out).not.toContain('data-check="align"')
    expect(html(FAKE, [report('fake-lab', [row('align')])])).toContain('No red check has a ladder')
  })

  test('rungs acked under the bundle’s lab id come back open, with the bundle’s text', () => {
    const out = html(FAKE, [report('fake-lab', [row('frob')])], all('fake-lab', 'frob'))
    expect(out).toContain('What does `frob` do to the fake pool?')
    expect(out).toContain('Fake concept text for frob.')
    expect(out).toContain('Look in the `frob` function.')
    expect(out).toContain('fake pseudo-code')
    expect(out).toContain('Fake design prose.')
    expect(out).toContain('href="/lesson/t1.l3#the-two-operations-that-matter"')
    // acks written for another lab’s namespace restore nothing
    expect(html(FAKE, [report('fake-lab', [row('frob')])], all('rust-allocator', 'frob'))).not.toContain('R0 · say it first')
  })

  test('a bundle without a walkthrough has no bottom-out rung; with one, the bundle’s walkthrough is shown', () => {
    const acks = all('fake-lab', 'frob')
    const without = html(FAKE, [report('fake-lab', [row('frob')])], acks)
    expect(without).not.toContain('Bottom-out')
    expect(without).not.toContain('Show the walkthrough')
    const withWalk: ForgeBundle = {
      ...FAKE,
      walkthrough: (checkId, trace) => ({
        source: 'script',
        steps: [{ n: 1, op: `op of ${checkId}`, yours: '-', reference: `trace had ${trace.length} lines`, diverges: false }],
        divergedAt: null,
        headline: 'A fake headline.',
        skipped: 0,
      }),
    }
    const out = html(withWalk, [report('fake-lab', [row('frob', 'fail', { trace: 'one\ntwo' })])], acks)
    expect(out).toContain('Bottom-out')
    expect(out).toContain('A fake headline.')
    expect(out).toContain('op of frob')
    expect(out).toContain('trace had 2 lines')
    expect(out).toContain('assisted until')
  })

  test('Ask a human carries the bundle’s label', () => {
    const out = html(FAKE, [report('fake-lab', [row('frob', 'fail', { msg: 'frob refused' })])], { [hintRef('frob', 'R0', 'fake-lab')]: ISO })
    const href = /href="(https:\/\/github\.com\/[^"]*discussions\/new[^"]*)"/.exec(out)?.[1]
    expect(href).toBeDefined()
    expect(new URL((href ?? '').replace(/&amp;/g, '&')).searchParams.get('title')).toBe('[lab 09] frob: frob refused')
  })
})

describe('ProveIt draws its questions and its lab id from the bundle', () => {
  const render = (props: Partial<Parameters<typeof ProveIt>[0]>) => renderToString(createElement(ProveIt, { bundle: FAKE, ...props })).replaceAll('<!-- -->', '')

  test('three of the bundle’s questions, none of lab 01’s', () => {
    const html = render({ history: [], now: 0, seed: 3 })
    expect(html).toContain('data-prove="active"')
    expect(html).toContain('Close your agent: 3 questions about your code')
    const first = /data-qid="([a-z-]+)"/.exec(html)?.[1]
    expect(first).toMatch(/^fake-[a-f]$/)
    expect(html).toContain('Fake question')
    expect(html).not.toContain('allocator')
  })

  test('a retry inside 24 h waits, and a later one draws the questions not yet served', () => {
    const served = ['fake-a', 'fake-b', 'fake-c']
    expect(render({ history: [{ at: ISO, qids: served, score: 1 }], now: Date.parse(ISO) + 3_600_000 })).toContain('data-prove="wait"')
    const html = render({ history: [{ at: ISO, qids: served, score: 1 }], now: Date.parse(ISO) + 25 * 3_600_000, seed: 8 })
    const shown = [...html.matchAll(/data-qid="([a-z-]+)"/g)].map((m) => m[1])
    expect(shown).toHaveLength(1)
    expect(served).not.toContain(shown[0])
  })

  test('it says what unlocks it without naming a number of checks', () => {
    expect(render({ unlocked: false, history: [] })).toContain('Opens when every required check is green')
  })
})

/* ------------------------------ lab 01 through the generic panels ------------------------------ */

describe('lab 01 through the same panels is what Wave 1 shipped', () => {
  const lab = FORGE_LABS.find((l) => l.id === 'rust-allocator')!

  test('the bundle exists in the registry and the panels render it', async () => {
    expect(await findForgeBundle('rust-allocator')).toBe(lab01)
    const panel = renderToStaticMarkup(createElement(PrimmPanel, { bundle: lab01, checks: lab.checks, passed: new Set<string>(), initial: 'predict', title: lab.title }))
    expect(panel).toContain(`aria-label="${lab.title}, in five steps"`)
    expect(panel).toContain('data-item="lab01.primm.p1"')
    const stages = renderToStaticMarkup(createElement(StagePanel, { bundle: lab01, checks: lab.checks, passed: new Set<string>() }))
    expect(stages).toContain('Build in four stages')
    expect(stages).toContain('0/4 green')
  })

  test('the Modify step offers the four dials it always had, led by the same sentence', () => {
    const html = renderToStaticMarkup(createElement(PrimmPanel, { bundle: lab01, checks: lab.checks, passed: new Set<string>(), initial: 'modify' }))
    expect(html).toContain('Change one thing about the reference run (first-fit with coalescing, near 75%).')
    for (const label of ['turn coalescing off', 'first-fit becomes worst-fit', 'occupancy 75% becomes 45%', 'occupancy 75% becomes 90%']) expect(html).toContain(label)
  })

  test('the Run step writes the same observation as before: runResponse and the generic response agree', () => {
    const run = runChurn(REFERENCE)
    const viaSpec = RUN_SPEC.run({ ...REFERENCE })
    expect(observationResponse(RUN_SPEC.item, viaSpec, 1500)).toEqual(runResponse(run, 1500))
  })

  test('the Run step counts only the reference config as its evidence', () => {
    expect(sameConfig(RUN_SPEC.reference, { ...REFERENCE })).toBe(true)
    expect(sameConfig(RUN_SPEC.reference, RUN_SPEC.baseline!)).toBe(false)
    expect(sameConfig({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  test('the ladder acks stay under hint:rust-allocator/', () => {
    expect(hintRef('boot', 'R1', lab01.labId)).toBe('hint:rust-allocator/boot#R1')
  })
})

describe('what the neutral grading and stage code does with a lab’s own words', () => {
  test('an estimate’s verdict names the item’s unit, not ops', () => {
    const p1 = FAKE.primm.items.find((i) => i.id === 'fake.primm.p1')
    if (p1?.kind !== 'estimate') throw new Error('p1 missing')
    expect(gradeNumber(p1, 9, 10).feedback).toContain('Close enough: 10 gizmos, and you said 9.')
    expect(gradeNumber(p1, 100, 10).feedback).toContain('The run says 10 gizmos; you said 100')
  })

  test('stage rows take the stages as an argument: green needs every required check of the stage', () => {
    const rows = stageRows(FAKE.stages, [...FAKE_CHECKS, { id: 'extra', label: 'extra', stage: 2, optional: true }], new Set(['frob']))
    expect(rows.map((r) => [r.stage.n, r.green, r.checks.map((c) => c.id)])).toEqual([
      [1, true, ['frob']],
      [2, false, ['twiddle']],
    ])
  })
})

/* ------------------------------ the three slots ------------------------------ */

describe('SetupLanes, FolderWatch and AskPacket take their final props', () => {
  const lab = FORGE_LABS.find((l) => l.id === 'kv-block-manager')!
  const files = read('pages/ForgeLab.tsx')

  /** SetupLanes reads the page's origin, which a browser has and this suite does not. */
  function withWindow<T>(fn: () => T): T {
    const g = globalThis as { window?: unknown }
    const had = 'window' in g
    const before = g.window
    g.window = { location: { origin: 'https://example.test' } }
    try {
      return fn()
    } finally {
      if (had) g.window = before
      else delete g.window
    }
  }

  test('SetupLanes {lab} renders today’s setup copy: three lanes, the one-command workspace, the ZIP link', () => {
    const props: SetupLanesProps = { lab }
    const html = withWindow(() => renderToStaticMarkup(createElement(SetupLanes, props))).replaceAll('<!-- -->', '')
    expect(html).toContain('aria-labelledby="get-lab"')
    expect(html).toContain('1 · get the lab')
    for (const lane of ['lane A — your machine', 'lane B — dev container', 'lane C — codespaces']) expect(html).toContain(lane)
    expect(html).toContain('rustup target add wasm32-unknown-unknown')
    expect(html).toContain('one-command workspace')
    expect(html).toContain(`curl -fsSL https://example.test${lab.zip} -o ${lab.zip.split('/').pop()}`)
    expect(html).toContain(`cd ${lab.id}/${lab.crateDir ?? lab.id}`)
    expect(html).toContain('aria-label="Copy workspace setup command"')
    expect(html).toContain('download ZIP instead')
    expect(html).toContain('Creates a fresh folder and enters the exercise crate. It stops if that folder already exists.')
  })

  test('FolderWatch {lab, onModule} and AskPacket {lab, reports} show nothing but their marker until there is something to show', () => {
    const fw: FolderWatchProps = { lab, onModule: () => {} }
    const ap: AskPacketProps = { lab, reports: [] }
    expect(renderToStaticMarkup(createElement(FolderWatch, fw))).toBe(`<div hidden="" data-folder-watch="${lab.id}"></div>`)
    expect(renderToStaticMarkup(createElement(AskPacket, ap))).toBe(`<div hidden="" data-ask-packet="${lab.id}"></div>`)
  })

  test('ForgeLab mounts all three with those props, so 2c-06, 2c-07 and 2c-08 never edit it', () => {
    expect(files).toContain('<SetupLanes lab={lab} />')
    expect(files).toContain('<FolderWatch lab={lab} onModule={onFile} onWatching={setWatching} />')
    expect(files).toContain('<AskPacket lab={lab} reports={reports} ladderIds={bundle.ladder.map((l) => l.checkId)} />')
    expect(files).toContain("import('@/components/forge/FolderWatch')")
    expect(files).toContain("import('@/components/forge/AskPacket')")
  })

  test('onFile, the handler a drop calls, is the one FolderWatch gets', () => {
    expect(files).toMatch(/onDrop=\{[\s\S]*?void onFile\(f\)/)
  })
})

describe('ForgeLab mounts by bundle, and keeps the plain page for every other lab', () => {
  const page = read('pages/ForgeLab.tsx')

  test('the page names no lab: the walk is for whichever lab has a bundle', () => {
    expect(page).not.toContain('rust-allocator')
    expect(page).not.toMatch(/LAB01|isLab01/)
    expect(page).toContain('findForgeBundle(labId)')
    expect(page).toContain('hasForgeBundle(labId)')
  })

  test('every panel it mounts is given the bundle', () => {
    expect(page).toMatch(/<PrimmPanel\s+bundle=\{bundle\}/)
    expect(page).toContain('<HintLadder bundle={bundle} reports={reports} />')
    expect(page).toContain('<ProveIt bundle={bundle} unlocked={done || requiredReportPassed} />')
  })

  test('the plain page is still get-the-lab, make-it-green, the drop zone and the results', () => {
    expect(page).toMatch(/\? \(\s*<>\s*\{getTheLab\}\s*\{makeGreen\}\s*\{dropZone\}\s*\{results\}\s*<\/>\s*\) : \(/)
  })

  test('the InstallButton mount from 2a-02 stays, given the run’s bytes', () => {
    expect(page).toContain("import('@/components/engine/InstallButton')")
    expect(page).toContain('<InstallButton lab={lab} report={run.report} credit={run.credit} bytes={run.bytes} />')
  })

  test('a bundle that fails to load leaves the plain page rather than an error', () => {
    expect(page).toMatch(/findForgeBundle\(labId\)[\s\S]*\.catch\(\(\) => \{\s*if \(live\) setState\(\{ status: 'failed' \}\)/)
    expect(page).toContain("bundleState.status === 'none' || bundleState.status === 'failed'")
  })
})
