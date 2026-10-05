/**
 * The block-placement play UI (docs/specs/wave-1.md §11; C11): the session model the components drive,
 * what the play screen shows before the debrief (never the ghost), the chips' touch size, Compose, the
 * In-production card, the ledger events for play and compose, and verify-plays's own checks.
 *
 * The rules live in src/data/plays.ts and run here without a DOM; the components are rendered to strings.
 * Pointer, keyboard and 360 px behaviour is checked in a real browser (the C11 report).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { join } from 'node:path'
import Compose from '../../src/components/play/block-placement/Compose'
import Debrief from '../../src/components/play/block-placement/Debrief'
import Grid from '../../src/components/play/block-placement/Grid'
import Mirror from '../../src/components/play/block-placement/Mirror'
import BlockPlacementPlay from '../../src/components/play/block-placement/Play'
import ProductionCard from '../../src/components/play/block-placement/ProductionCard'
import { CLAIMS } from '../../src/data/claims'
import { KC } from '../../src/data/kc/ids'
import {
  BLOCK_PLACEMENT,
  BUILD_THIS,
  COMPOSE_FRESH_SEEDS,
  DEFAULT_DIALS,
  PLAYS,
  PLAY_IDS,
  PRODUCTION_ROWS,
  applyFree,
  canSkip,
  composeRecord,
  composeReport,
  composeTraces,
  debrief,
  getPlay,
  giveUp,
  heapOf,
  newSession,
  placeAt,
  recordOf,
  skip,
  specOf,
  stageOf,
  type Dials,
  type Session,
} from '../../src/data/plays'
import { BLOCK_PLACEMENT_ID, SKIP_AFTER_TURNS } from '../../src/lib/world/play'
import { FIXED_SPEC, REFERENCE_SPEC } from '../../src/lib/world/policy'
import { PLAY_PRACTICE_SEED, checkPlacementBand, drawPlacementTrace, makePlacementTrace } from '../../src/lib/world/traces'
import { GATE_3D, checkPlay, checkView3D, closureOf, type PlayFacts, type PlayWorld } from '../../scripts/verify-plays'
import { makeProfile, startTab } from '../ledger/env'

const SRC = join(import.meta.dir, '..', '..', 'src')

/** Plays a session to its end with a rule for the chip to take: `pick` gets the fitting run starts. */
function playOut(s0: Session, pick: (starts: number[], s: Session) => number): Session {
  let s = s0
  for (let guard = 0; guard < 500; guard++) {
    const st = stageOf(s)
    if (st.kind === 'over') return s
    if (st.kind === 'free') s = applyFree(s)
    else if (st.kind === 'stuck') s = giveUp(s)
    else s = placeAt(s, pick(st.choices.filter((c) => c.fits).map((c) => c.start), s))
  }
  throw new Error('the play did not end')
}

const firstFitting = (starts: number[]) => starts[0]
/** Best fit by the chips the learner sees: the smallest fitting run, the lowest address on a tie. */
const smallestFitting = (_: number[], s: Session) => {
  const st = stageOf(s)
  if (st.kind !== 'ask') throw new Error('not asking')
  return st.choices.filter((c) => c.fits).reduce((a, b) => (b.size < a.size ? b : a)).start
}

const practiceSession = () => newSession(makePlacementTrace(PLAY_PRACTICE_SEED), 'practice')

describe('the registry', () => {
  test('block placement is the one play: T1.L4, 15 minutes, KCs from the contract', () => {
    expect(PLAY_IDS).toEqual(['block-placement'])
    expect(BLOCK_PLACEMENT.id).toBe(BLOCK_PLACEMENT_ID)
    expect(BLOCK_PLACEMENT.lessonId).toBe('t1.l4')
    expect(BLOCK_PLACEMENT.minutes).toBe(15)
    const known = new Set<string>(Object.values(KC))
    expect(BLOCK_PLACEMENT.kcs.length).toBeGreaterThan(0)
    for (const k of BLOCK_PLACEMENT.kcs) expect(known.has(k)).toBe(true)
  })

  test('getPlay answers own ids only', () => {
    expect(getPlay('block-placement')).toBe(BLOCK_PLACEMENT)
    for (const bad of ['', 'nope', '__proto__', 'constructor', 'toString']) expect(getPlay(bad)).toBeUndefined()
    expect(Object.keys(PLAYS)).toEqual(PLAY_IDS as string[])
  })

  test('the In-production card names the vLLM, glibc and jemalloc claims and every one exists', () => {
    const ids = new Set(CLAIMS.map((c) => c.id))
    expect(BLOCK_PLACEMENT.productionClaims).toEqual(PRODUCTION_ROWS.map((r) => r.claim))
    for (const id of BLOCK_PLACEMENT.productionClaims) expect(ids.has(id)).toBe(true)
    const names = BLOCK_PLACEMENT.productionClaims.join(' ')
    for (const needle of ['vllm.block-size', 'vllm.v1-preemption', 'glibc.bins', 'glibc.mmap-threshold', 'jemalloc']) expect(names).toContain(needle)
  })

  test('the practice seed is in band', () => {
    expect(checkPlacementBand(makePlacementTrace(PLAY_PRACTICE_SEED)).inBand).toBe(true)
  })
})

describe('a play session', () => {
  test('starts at op 0 asking for the first block, with one free run that fits', () => {
    const s = practiceSession()
    const st = stageOf(s)
    expect(st.kind).toBe('ask')
    if (st.kind !== 'ask') return
    expect(st.op).toBe(0)
    expect(st.choices).toHaveLength(1)
    expect(st.choices[0]).toMatchObject({ start: 0, size: 1024, fits: true, why: '' })
    expect(heapOf(s).totalFree).toBe(1024)
    expect(s.summary).toBeNull()
  })

  test('a tap lands the block at the run start; a run that does not fit is ignored', () => {
    const s = placeAt(practiceSession(), 0)
    expect(s.ps.turns).toBe(1)
    expect(s.line).toMatch(/^Placed \d+ cells? at cell 0\. Largest free run: \d+ cells?\.$/)
    // The heap holds the block at cell 0; tapping inside it, or anywhere that is not a fitting chip, does nothing.
    expect(placeAt(s, 0)).toBe(s)
    expect(placeAt(s, 7)).toBe(s)
  })

  test('frees apply by themselves, one per turn, and name the run they opened', () => {
    let s = practiceSession()
    let sawFree = false
    for (let i = 0; i < 200 && stageOf(s).kind !== 'over'; i++) {
      const st = stageOf(s)
      if (st.kind === 'free') {
        const before = s.ps.turns
        s = applyFree(s)
        expect(s.ps.turns).toBe(before + 1)
        expect(s.line).toMatch(/^Freed block \d+\. Largest free run: \d+ cells?\.$/)
        expect(s.freed).not.toBeNull()
        sawFree = true
      } else if (st.kind === 'ask') s = placeAt(s, smallestFitting([], s))
      else break
    }
    expect(sawFree).toBe(true)
  })

  test('first fit stops on the practice trace: the request that fits nowhere ends it, and the debrief names the first divergence', () => {
    const s = debrief(playOut(practiceSession(), firstFitting))
    expect(s.ps.mine.ended).toBe('failed')
    expect(s.summary).not.toBeNull()
    const sum = s.summary!
    expect(sum.survived).toBeLessThan(sum.ghostSurvived)
    expect(sum.ghostSurvived).toBe(40)
    expect(sum.divergence).not.toBeNull()
    expect(sum.divergence!.explanation).toMatch(/^At op \d+ you /)
    expect(sum.divergence!.op).toBeLessThanOrEqual(sum.divergence!.failedOp)
  })

  test('best fit by hand never diverges: the debrief says so', () => {
    const s = debrief(playOut(practiceSession(), smallestFitting))
    expect(s.ps.mine.ended).toBe('trace-end')
    expect(s.summary!.divergence).toBeNull()
    expect(s.summary!.survived).toBe(s.summary!.ghostSurvived)
  })

  test('no debrief before the run ends', () => {
    const s = placeAt(practiceSession(), 0)
    expect(debrief(s)).toBe(s)
    expect(s.summary).toBeNull()
    expect(recordOf(s)).toBeNull()
  })

  test('the expert skip is offered after five turns, and the reference finishes the run', () => {
    let s = practiceSession()
    expect(canSkip(s)).toBe(false)
    expect(skip(s)).toBe(s)
    while (s.ps.turns < SKIP_AFTER_TURNS) {
      const st = stageOf(s)
      s = st.kind === 'free' ? applyFree(s) : placeAt(s, firstFitting(st.kind === 'ask' ? st.choices.filter((c) => c.fits).map((c) => c.start) : []))
      if (stageOf(s).kind === 'over') break
    }
    expect(canSkip(s)).toBe(true)
    const done = debrief(skip(s))
    expect(done.ps.skipped).toBe(true)
    expect(done.ps.mine.ended).not.toBeNull()
    expect(done.summary!.skipped).toBe(true)
    // The reference policy finishing the run places like best fit: it reaches the end.
    expect(done.summary!.survived).toBe(done.summary!.ghostSurvived)
  })

  test('the same trace and the same taps give the same debrief (determinism)', () => {
    const a = debrief(playOut(practiceSession(), firstFitting)).summary
    const b = debrief(playOut(practiceSession(), firstFitting)).summary
    expect(a).toEqual(b)
  })
})

describe('the ghost stays hidden until the debrief', () => {
  test('the play screen shows no reference heap, score or debrief, and says so', () => {
    const html = renderToString(createElement(BlockPlacementPlay, { mode: 'embed' }))
    expect(html).toContain('data-phase-now="play"')
    expect(html).not.toContain('data-phase="debrief"')
    expect(html).not.toMatch(/reference&#x27;s heap|The reference got|ghost/i)
    // One grid only, and it is the learner's.
    expect(html.match(/data-grid/g)).toHaveLength(1)
    expect(html).toContain('Your heap')
  })

  test('the stage the play screen is built from carries the learner side only', () => {
    const s = practiceSession()
    const st = stageOf(s)
    expect(Object.keys(st).sort()).toEqual(['choices', 'kind', 'op', 'req', 'view'])
    expect(JSON.stringify(st)).not.toContain('ghost')
  })

  test('the debrief shows both heaps at the first divergence with the sentence', () => {
    const s = debrief(playOut(practiceSession(), firstFitting))
    const html = renderToString(createElement(Debrief, { session: s, onAgain: () => {} }))
    const div = s.summary!.divergence!
    expect(html).toContain('data-phase="debrief"')
    expect(html).toContain(`The first divergence is at op ${div.op + 1}`)
    expect(html).toContain(`Your heap after op ${div.op + 1}`)
    expect(html).toContain(`The reference&#x27;s heap after op ${div.op + 1}`)
    expect(html.match(/data-grid/g)).toHaveLength(2)
    expect(html.match(/data-play-mirror/g)).toHaveLength(2)
    expect(html).toContain(div.explanation.replace(/'/g, '&#x27;'))
    expect(html).toContain('Play again with new numbers')
  })

  test('a run with no divergence says so and shows no side-by-side', () => {
    const s = debrief(playOut(practiceSession(), smallestFitting))
    const html = renderToString(createElement(Debrief, { session: s, onAgain: () => {} }))
    expect(html).toContain('You kept pace with the reference')
    expect(html).not.toContain('data-grid')
  })

  test('a fresh draw is in band, unseen, and not the practice trace', () => {
    const draw = drawPlacementTrace(123456789)
    expect(draw.band.inBand).toBe(true)
    const s = newSession(draw.trace, 'unseen')
    expect(s.provenance).toBe('unseen')
    expect(s.trace.seed).not.toBe(PLAY_PRACTICE_SEED)
  })
})

describe('touch targets and the mirror (§11.2, §16.2)', () => {
  test('the chip is a full-width button at least 44 px tall (min-h-11)', () => {
    const html = renderToString(createElement(BlockPlacementPlay, { mode: 'page' }))
    const chips = html.match(/<button[^>]*data-chip[^>]*>/g) ?? []
    expect(chips.length).toBeGreaterThan(0)
    for (const c of chips) {
      expect(c).toContain('min-h-11')
      expect(c).toContain('w-full')
    }
  })

  test('the grid is one image described by the mirror, which lists every run', () => {
    const s = placeAt(practiceSession(), 0)
    const view = heapOf(s)
    const grid = renderToString(createElement(Grid, { view, label: 'Your heap', describedBy: 'm1' }))
    expect(grid).toContain('role="img"')
    expect(grid).toContain('aria-describedby="m1"')
    expect(grid.match(/data-cell=/g)).toHaveLength(64)
    const mirror = renderToString(createElement(Mirror, { id: 'm1', view, title: 'Your heap', line: s.line }))
    expect(mirror).toContain('id="m1"')
    expect(mirror).toContain('aria-expanded="false"')
    expect(mirror).toContain('aria-live="polite"')
    expect(mirror).toContain(s.line)
    expect(mirror.match(/<tr>/g)).toHaveLength(view.runs.length + 1)
  })

  test('an unpickable grid has no click target and a disabled chip says why', () => {
    // Fill the heap with first fit until a request fits nowhere, then read the chips.
    let s = practiceSession()
    for (let i = 0; i < 300; i++) {
      const st = stageOf(s)
      if (st.kind === 'stuck') {
        const bad = st.choices.filter((c) => !c.fits)
        expect(bad.length).toBeGreaterThan(0)
        for (const c of bad) expect(c.why).toMatch(/^\d+ cells free, needs \d+$/)
        return
      }
      if (st.kind === 'over') break
      s = st.kind === 'free' ? applyFree(s) : placeAt(s, st.choices.find((c) => c.fits)!.start)
    }
    throw new Error('first fit never got stuck')
  })
})

describe('Compose (§11.3)', () => {
  const traces = composeTraces(makePlacementTrace(PLAY_PRACTICE_SEED), 42)

  test('the play trace plus five fresh in-band traces, deterministic in the entropy', () => {
    expect(traces).toHaveLength(1 + COMPOSE_FRESH_SEEDS)
    expect(traces[0].seed).toBe(PLAY_PRACTICE_SEED)
    for (const t of traces) expect(checkPlacementBand(t).inBand).toBe(true)
    expect(composeTraces(makePlacementTrace(PLAY_PRACTICE_SEED), 42).map((t) => t.seed)).toEqual(traces.map((t) => t.seed))
    expect(composeTraces(makePlacementTrace(PLAY_PRACTICE_SEED), 43).map((t) => t.seed)).not.toEqual(traces.map((t) => t.seed))
  })

  test('the dials convert to the spec in bytes, and the defaults are a plain first-fit allocator', () => {
    expect(specOf(DEFAULT_DIALS)).toEqual({ fit: 'first', coalesce: 'eager', minSplit: 16, classes: 'none' })
    expect(specOf({ fit: 'best', coalesce: 'eager', minSplit: '1', classes: 'none' })).toEqual(REFERENCE_SPEC)
    expect(specOf({ fit: 'first', coalesce: 'eager', minSplit: '1', classes: 'fixed4' })).toEqual(FIXED_SPEC)
    expect(specOf({ ...DEFAULT_DIALS, minSplit: '3', classes: 'fixed2' })).toMatchObject({ minSplit: 48, classes: { fixed: 32 } })
  })

  test('the reference dials reproduce the ghost: ok and equivalent, with a ghost row beside every run', () => {
    const rep = composeReport(REFERENCE_SPEC, traces)
    expect(rep.equivalent).toBe(true)
    expect(rep.ok).toBe(true)
    expect(rep.mine).toHaveLength(traces.length)
    expect(rep.ghost).toHaveLength(traces.length)
    expect(rep.survived).toBe(rep.ghostSurvived)
    expect(rep.note).toContain('exactly where the reference does')
  })

  test('fixed 4-cell blocks survive everything with no external fragmentation: the PagedAttention move', () => {
    const rep = composeReport(FIXED_SPEC, traces)
    expect(rep.ok).toBe(true)
    expect(rep.fixed).toBe(true)
    expect(rep.survived).toBe(rep.total)
    for (const r of rep.mine) {
      expect(r.externalPermille).toBe(0)
      expect(r.internalWastePermille).toBeGreaterThanOrEqual(150)
      expect(r.internalWastePermille).toBeLessThanOrEqual(400)
    }
    expect(rep.note).toContain('PagedAttention')
    expect(rep.note).toContain('T2.L7')
  })

  test('the starting dials (first fit) lose on the practice trace and are not ok', () => {
    const rep = composeReport(specOf(DEFAULT_DIALS), traces.slice(0, 1))
    expect(rep.ok).toBe(false)
    expect(rep.survived).toBeLessThan(rep.total)
    expect(rep.note).toContain('Change a dial')
  })

  test('the panel renders four labelled dial groups of 44 px options and no result before the first run', () => {
    const html = renderToString(createElement(Compose, { trace: traces[0] }))
    expect(html.match(/<fieldset/g)).toHaveLength(4)
    for (const label of ['Fit', 'Coalesce', 'Minimum split', 'Size classes']) expect(html).toContain(`>${label}</legend>`)
    expect(html.match(/type="radio"/g)).toHaveLength(4 + 2 + 3 + 4)
    expect((html.match(/min-h-11/g) ?? []).length).toBeGreaterThanOrEqual(13)
    expect(html).not.toContain('data-compose-result')
  })
})

describe('the In-production card', () => {
  test('every number is a claim chip with a source button, and each row names its dial', () => {
    const html = renderToString(createElement(ProductionCard))
    expect(html.match(/Show source/g)).toHaveLength(PRODUCTION_ROWS.length)
    for (const r of PRODUCTION_ROWS) expect(html).toContain(r.dial)
    // Values come from the claims, not from the copy.
    expect(html).toContain('16 tokens/block')
    expect(html).toContain('128 KiB')
    expect(html).toContain('4 classes per doubling')
    expect(html).toContain('recompute')
    // Both fits are named, with a reason real allocators mix them.
    expect(html).toContain('first fit')
    expect(html).toContain('best fit')
  })

  test('no typed-in real-world number sits next to a chip: the card copy holds no digits (a lesson id or a version name is not a number)', () => {
    for (const r of PRODUCTION_ROWS) expect(`${r.lead} ${r.tail}`.replace(/\b[A-Z]\d(\.L\d)?\b/g, '')).not.toMatch(/\d/)
  })

  test('the Code step is lab 01', () => {
    expect(BUILD_THIS.to).toBe('/forge/rust-allocator')
    expect(BUILD_THIS.label).toBe('Build this: lab 01, stage 1 is a 2-minute win')
  })
})

describe('the ledger sees play and compose (recordPlay)', () => {
  test('a debriefed play is one `play` event, phase play, ok, scored against the ghost', async () => {
    const tab = startTab(makeProfile())
    const s = debrief(playOut(practiceSession(), firstFitting))
    const result = recordOf(s, 4200)!
    tab.progress.getState().recordPlay(result)
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'play')
    expect(events).toHaveLength(1)
    const sum = s.summary!
    expect(events[0]).toMatchObject({
      ref: 'play:block-placement',
      ok: true,
      provenance: 'practice',
      seed: PLAY_PRACTICE_SEED,
      ms: 4200,
      data: { phase: 'play', survived: sum.survived, ghostSurvived: sum.ghostSurvived, skipped: false, divergenceOp: sum.divergence!.op, kcs: BLOCK_PLACEMENT.kcs },
    })
    expect(events[0].score).toBeCloseTo(Math.min(1, sum.survived / sum.ghostSurvived), 10)
    expect(tab.progress.getState().aggregate.plays['block-placement']).toMatchObject({ done: true })
  })

  test('a fresh-seed play carries provenance unseen', async () => {
    const tab = startTab(makeProfile())
    const s = debrief(playOut(newSession(drawPlacementTrace(99).trace, 'unseen'), firstFitting))
    tab.progress.getState().recordPlay(recordOf(s)!)
    await tab.progress.controls.flush()
    const [e] = (await (await tab.engine()).events()).filter((x) => x.kind === 'play')
    expect(e).toMatchObject({ provenance: 'unseen', ok: true })
  })

  test('a compose run is a `play` event, phase compose, ok for the reference or fixed blocks and not for a losing spec', async () => {
    const tab = startTab(makeProfile())
    const base = makePlacementTrace(PLAY_PRACTICE_SEED)
    const traces = composeTraces(base, 7)
    const lose = specOf(DEFAULT_DIALS)
    const record = tab.progress.getState().recordPlay
    record(composeRecord(lose, composeReport(lose, traces), base, 1))
    record(composeRecord(FIXED_SPEC, composeReport(FIXED_SPEC, traces), base, 2))
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'play')
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ ok: false, data: { phase: 'compose', equivalent: false, turns: 1 } })
    expect(events[1]).toMatchObject({ ok: true, data: { phase: 'compose', equivalent: false, turns: 2, spec: { fit: 'first', coalesce: 'eager', minSplit: 1, classes: 'fixed:4' } } })
    expect(tab.progress.getState().aggregate.plays['block-placement']).toMatchObject({ composed: true })
  })

  test('a compose that reproduces the reference is equivalent', () => {
    const base = makePlacementTrace(PLAY_PRACTICE_SEED)
    const traces = composeTraces(base, 5)
    const dials: Dials = { fit: 'best', coalesce: 'eager', minSplit: '1', classes: 'none' }
    const r = composeRecord(specOf(dials), composeReport(specOf(dials), traces), base, 3)
    expect(r.ok).toBe(true)
    expect(r.score).toBe(1)
    expect(r.data).toMatchObject({ phase: 'compose', equivalent: true })
  })
})

describe('verify-plays: the play checks (§11.5)', () => {
  const world: PlayWorld = { kcIds: new Set<string>(Object.values(KC)), claimIds: new Set(CLAIMS.map((c) => c.id)), lessonIds: new Set(['t1.l4']) }
  const PLAY_SRC = 'export default () => <div><Mirror /><Debrief /></div>'
  const good: PlayFacts = {
    id: 'block-placement',
    lessonId: 't1.l4',
    kcs: [KC.externalFrag],
    productionClaims: ['production.vllm.block-size'],
    cardClaims: ['production.vllm.block-size'],
    play: PLAY_SRC,
    mirror: 'x',
    debrief: 'x',
    practiceInBand: true,
  }

  test('a complete play passes', () => {
    expect(checkPlay(good, world)).toEqual([])
  })

  test('the registered play passes with the real files', async () => {
    const { readFileSync } = await import('node:fs')
    const dir = join(SRC, 'components', 'play', 'block-placement')
    const facts: PlayFacts = {
      ...good,
      lessonId: BLOCK_PLACEMENT.lessonId,
      kcs: BLOCK_PLACEMENT.kcs,
      productionClaims: BLOCK_PLACEMENT.productionClaims,
      cardClaims: PRODUCTION_ROWS.map((r) => r.claim),
      play: readFileSync(join(dir, 'Play.tsx'), 'utf8'),
      mirror: readFileSync(join(dir, 'Mirror.tsx'), 'utf8'),
      debrief: readFileSync(join(dir, 'Debrief.tsx'), 'utf8'),
    }
    expect(checkPlay(facts, world)).toEqual([])
  })

  test.each([
    ['no mirror component', { mirror: undefined }, 'no mirror component'],
    ['a mirror the play never renders', { play: 'export default () => <Debrief />' }, 'never renders <Mirror>'],
    ['a mirror named only in a comment', { play: '// <Mirror />\nexport default () => <Debrief />' }, 'never renders <Mirror>'],
    ['no debrief component', { debrief: undefined }, 'no debrief component'],
    ['a debrief the play never renders', { play: 'export default () => <Mirror />' }, 'never renders <Debrief>'],
    ['no KCs', { kcs: [] }, 'no KCs'],
    ['an unknown KC', { kcs: ['t9.nope'] }, 'KC t9.nope is not in'],
    ['an unknown lesson', { lessonId: 't9.l9' }, 'lesson t9.l9 does not exist'],
    ['no claims', { productionClaims: [], cardClaims: [] }, 'no In-production claims'],
    ['a claim that does not exist', { productionClaims: ['production.nope'], cardClaims: ['production.nope'] }, 'claim production.nope does not exist'],
    ['a card row outside productionClaims', { cardClaims: ['production.vllm.block-size', 'production.glibc.bins'] }, 'productionClaims does not list'],
    ['a listed claim no row renders', { cardClaims: [] }, 'no In-production row renders'],
    ['a practice seed outside the band', { practiceInBand: false }, 'practice seed is outside the band'],
  ] as const)('fails %s', (_, patch, message) => {
    const problems = checkPlay({ ...good, ...patch } as PlayFacts, world)
    expect(problems.some((p) => p.includes(message))).toBe(true)
  })

  test('View3D is allowed only for GATE_3D ids', () => {
    expect(GATE_3D).toEqual(['tiling-cube', 'device-mesh'])
    const ok = [{ file: 'a.tsx', text: '<View3D id="tiling-cube" />' }, { file: 'b.tsx', text: "<View3D id={'device-mesh'} />" }]
    expect(checkView3D(ok)).toEqual([])
    const bad = [
      { file: 'c.tsx', text: '<View3D id="spinning-logo" />' },
      { file: 'd.tsx', text: '<View3D />' },
      { file: 'e.tsx', text: '// <View3D id="nope" />\nconst x = 1' },
    ]
    const out = checkView3D(bad)
    expect(out).toHaveLength(2)
    expect(out[0]).toContain('c.tsx')
    expect(out[1]).toContain('d.tsx')
  })

  test('the route closure reaches the play and its mirror and debrief, and not a worker or a sim', () => {
    const c = closureOf(join(SRC, 'pages', 'Play.tsx'), SRC)
    for (const f of ['Play.tsx', 'Grid.tsx', 'Mirror.tsx', 'Debrief.tsx', 'Compose.tsx', 'ProductionCard.tsx']) {
      expect(c.files).toContain(`src/components/play/block-placement/${f}`)
    }
    expect(c.files).toContain('src/data/plays.ts')
    expect(c.files).toContain('src/lib/world/heap.ts')
    expect(c.files.some((f) => f.includes('workers/') || f.includes('components/sims/RooflineSim'))).toBe(false)
    expect(c.packages).toContain('react')
    expect(c.lines).toBeGreaterThan(1000)
  })
})
