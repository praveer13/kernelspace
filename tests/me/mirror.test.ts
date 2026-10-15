import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router'
import type { Kc } from '../../src/lib/kc/types'
import { wilson } from '../../src/lib/learner/calibration'
import { cardsContent, deriveCardsDetailed, learnOffset, OFFSET_DEFAULT, selectFirstReviewCalibration } from '../../src/lib/learner/cards'
import { buildMirror, plural, proportionText, type Mirror, type MirrorInput } from '../../src/lib/learner/mirror'
import { addDays } from '../../src/lib/learner/reentry'
import { proportionOf } from '../../src/lib/learner/vrk'
import type { LedgerEvent, LocalDay } from '../../src/lib/ledger/types'
import { installDom, type DomKit, type Mounted, type MiniElement } from '../dom/mini-dom'
import { CONTENT as GRAPH_CONTENT, Journal, resolveTag, simulate, START } from '../learner/ledger-gen'

/**
 * The Mirror at /me (wave-3.md §12.5, task 3b-06b): every figure states its n and an interval, or "not enough data"
 * below its minimum. `buildMirror` is checked on fixture ledgers, then the lazy section is mounted with
 * tests/dom/mini-dom.ts on the same ledgers (its `load` prop replaces the ledger read) and the page's figures are read
 * back from the DOM by their `data-figure` and `data-n`. What a browser alone can answer (reflow, contrast, the Tab
 * walk) stays with the a11y harness and e2e/me.spec.ts.
 */

const D = (n: number): LocalDay => addDays(START, n)
const src = (f: string) => readFileSync(join(import.meta.dir, '../../src', f), 'utf8')

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const kc = (id: string, track: Kc['track']): Kc => ({ id, title: id, can: `You can ${id}.`, track, kind: 'concept', lessons: ['x.l1'], requires: [], since: '2026-10-05' })
/** Eight KCs from one lesson: four in t5, two in t6, two in r. The creation cap releases them by day 5. */
const KCS: Kc[] = [
  ...['a5.k0', 'a5.k1', 'a5.k2', 'a5.k3'].map((id) => kc(id, 't5')),
  ...['a6.k0', 'a6.k1'].map((id) => kc(id, 't6')),
  ...['a0.k0', 'a0.k1'].map((id) => kc(id, 'r')),
]
const CONTENT = cardsContent({ kcs: KCS, lessons: [{ id: 'x.l1', kcs: KCS.map((k) => k.id) }], bootKcs: [], resolve: resolveTag })

let seedN = 9000
/** A graded answer; by default a fresh generated item on Today at full credit. */
function answer(j: Journal, day: LocalDay, kcs: string[], ok: boolean, o: { ref?: string; kind?: 'item' | 'probe'; provenance?: string; conf?: 'guess' | 'think' | 'sure'; data?: Record<string, unknown> } = {}) {
  return j.add(o.kind ?? 'item', o.ref ?? 'gen:memory/kv', day, {
    score: ok ? 1 : 0,
    ok,
    rev: 'r',
    provenance: o.provenance ?? 'unseen',
    seed: seedN++,
    ...(o.conf ? { conf: o.conf } : {}),
    data: { src: 'today', kcs, level: 2, ...o.data },
  })
}

/**
 * One learner, 61 days of ledger.
 * - VRK30: all eight cards exist by day 5; on day 40 six KCs are checked (a5.k0 to k3, a6.k0 right; a6.k1 wrong), so
 *   5 of 6 are retained. a0.k0 and a0.k1 are never checked.
 * - Competence: a5.k0 gets six more right answers on days 44 and 45 (7 in all, on 3 days), so it has a line. a5.k1 gets
 *   six right form items on the same days, which count for nothing.
 * - Cold checks (days 60; the KCs have no card, so VRK ignores them; a quiz ref, so competence does too): t5 has 12, 9
 *   right, 10 of them 30 days or more old (7 right); t6 has 3 (2 right), one 30 days or more old (a miss).
 * - Calibration (day 50, authored refs, so VRK and competence ignore them): 24 rated answers, guess 1 of 4 right, think
 *   so 7 of 10, sure 9 of 10.
 */
function ledger(): Journal {
  const j = new Journal()
  j.passLesson(D(0), 'x.l1', KCS.map((k) => k.id))
  for (const id of ['a5.k0', 'a5.k1', 'a5.k2', 'a5.k3', 'a6.k0']) answer(j, D(40), [id], true)
  answer(j, D(40), ['a6.k1'], false)
  for (let i = 0; i < 6; i++) {
    answer(j, D(i < 3 ? 44 : 45), ['a5.k0'], true)
    answer(j, D(i < 3 ? 44 : 45), ['a5.k1'], true, { data: { src: 'form' } })
  }
  const cal: [('guess' | 'think' | 'sure'), number, number][] = [['guess', 4, 1], ['think', 10, 7], ['sure', 10, 9]]
  for (const [conf, n, right] of cal) {
    for (let i = 0; i < n; i++) answer(j, D(50), ['x.cal'], i < right, { ref: 'quiz:x.l9#0', provenance: 'practice', conf })
  }
  const cold = (kcs: string[], since: number, ok: boolean) =>
    answer(j, D(60), kcs, ok, { kind: 'probe', ref: 'quiz:x.l9#1', data: { reason: 'probe', sinceDays: since } })
  for (let i = 0; i < 10; i++) cold(['t5.kv-bytes'], 30 + i, i < 7)
  cold(['t5.kv-bytes'], 8, true)
  cold(['t5.kv-bytes'], 20, true)
  cold(['t6.mla-kv'], 9, true)
  cold(['t6.mla-kv'], 12, true)
  cold(['t6.mla-kv'], 35, false)
  return j
}

const INPUT = (events: readonly LedgerEvent[], now: LocalDay = D(60)): MirrorInput => ({ events, content: CONTENT, now })
const mirrorOf = (events: readonly LedgerEvent[], now?: LocalDay): Mirror => buildMirror(INPUT(events, now))

const prop = (correct: number, n: number) => proportionOf(correct, n)

/* ------------------------------------------------------------------ */
/* The figures                                                         */
/* ------------------------------------------------------------------ */

describe('buildMirror: every figure carries its n and its interval', () => {
  const j = ledger()
  const m = mirrorOf(j.events)

  test('VRK30: 5 of 6 checked KCs retained, with the Wilson interval, per active month', () => {
    expect(m.vrk.checked).toEqual(['a5.k0', 'a5.k1', 'a5.k2', 'a5.k3', 'a6.k0', 'a6.k1'])
    expect(m.vrk.retained).toEqual(['a5.k0', 'a5.k1', 'a5.k2', 'a5.k3', 'a6.k0'])
    expect(m.vrk.share).toEqual(prop(5, 6))
    const w = wilson(5, 6)
    expect(m.vrk.share.ci95).toEqual([w.lo, w.hi])
    // October holds graded work on days 40, 44, 45, 50 and 60; September on day 0 alone
    expect(m.vrk.activeMonths).toBe(1)
    expect(m.vrk.perActiveMonth).toBe(5)
  })

  test('cold checks by track: n, accuracy and intervals at 7 and at 30 days', () => {
    expect(m.cold.overall).toEqual({ track: null, d7: prop(11, 15), d30: prop(7, 11) })
    expect(m.cold.tracks).toEqual([
      { track: 't5', d7: prop(9, 12), d30: prop(7, 10) },
      { track: 't6', d7: prop(2, 3), d30: prop(0, 1) },
    ])
  })

  test('calibration: Brier, reliability and sure-and-wrong by hand, and the offset with its n', () => {
    const c = m.calibration
    expect(c.n).toBe(24)
    expect(c.bins.map((b) => [b.n, b.correct])).toEqual([[4, 1], [10, 7], [10, 9]])
    const brier = (1 * (0.33 - 1) ** 2 + 3 * 0.33 ** 2 + 7 * (0.67 - 1) ** 2 + 3 * 0.67 ** 2 + 9 * (0.95 - 1) ** 2 + 1 * 0.95 ** 2) / 24
    expect(c.brier).toBeCloseTo(brier, 12)
    expect(c.brier).toBeCloseTo(0.1587, 4)
    expect(c.uncertainty).toBeCloseTo((17 / 24) * (7 / 24), 12)
    expect(c.sureWrong).toBe(1)
    // the identity the page quotes: Brier = reliability - resolution + uncertainty
    expect(c.reliability - c.resolution + c.uncertainty).toBeCloseTo(c.brier, 12)
    // the offset rests on the first spaced reviews of the cards, and the two selectors agree on how many
    expect(m.offset.n).toBe(selectFirstReviewCalibration(j.events, CONTENT, D(60)).n)
    expect(m.offset).toMatchObject({ learned: false, offset: OFFSET_DEFAULT })
  })

  test('competence: a5.k0 has its line; the form items on a5.k1 earn none (D34), and the ideas short of the bar are counted', () => {
    expect(m.competence.map((s) => [s.kc, s.n, s.days, s.right, s.of])).toEqual([['a5.k0', 7, 3, 6, 6]])
    expect(m.competence[0].text).toBe('You can a5.k0: 6 of your last 6, on new numbers each time.')
    // a5.k1..k3, a6.k0 and a6.k1 each have their one day-40 answer and no more
    expect(m.competenceUnmet).toBe(5)
  })

  test('the same in any order, with a repeated event, and later days wait for their day', () => {
    const shuffledTwice = [...j.events, ...j.events].reverse()
    expect(mirrorOf(shuffledTwice)).toEqual(m)
    // as of day 43 nothing from days 44 to 60 exists yet: no cold check, no rated answer, no line
    const early = mirrorOf(j.events, D(43))
    expect(early.cold.overall.d7.n).toBe(0)
    expect(early.calibration.n).toBe(0)
    expect(early.competence).toEqual([])
  })

  test('a ledger with nothing in it has n = 0 everywhere and no rate or interval', () => {
    const e = mirrorOf([])
    expect(e.vrk).toMatchObject({ retained: [], checked: [], activeMonths: 0, perActiveMonth: null, share: { n: 0, rate: null, ci95: null } })
    expect(e.cold.overall).toEqual({ track: null, d7: prop(0, 0), d30: prop(0, 0) })
    expect(e.cold.tracks).toEqual([])
    expect(e.calibration.n).toBe(0)
    expect(e.offset).toEqual({ offset: OFFSET_DEFAULT, n: 0, learned: false })
    expect(e.competence).toEqual([])
  })

  test('the learned offset, from a simulated learner over the real graph: n first reviews, and the offset scheduling uses', () => {
    const { events, end } = simulate(11, { days: 90 })
    const m2 = buildMirror({ events, content: GRAPH_CONTENT, now: end })
    const { firstReviews } = deriveCardsDetailed(events, GRAPH_CONTENT, end)
    expect(m2.offset.n).toBe(firstReviews.length)
    expect(m2.offset.n).toBeGreaterThanOrEqual(20)
    expect(m2.offset).toEqual({ offset: learnOffset(firstReviews), n: firstReviews.length, learned: true })
  })
})

describe('the figures\' wording', () => {
  test('below the minimum the text says "not enough data" with the n and prints no rate', () => {
    expect(proportionText(prop(3, 4), 10, 'checks')).toBe('not enough data (n = 4 checks, needs 10)')
    expect(proportionText(prop(0, 0), 5, 'checked ideas')).toBe('not enough data (n = 0 checked ideas, needs 5)')
  })

  test('at the minimum it states the count, the rate, the Wilson interval and n', () => {
    expect(proportionText(prop(9, 12), 10, 'checks')).toBe('9 of 12 right, 75 % (95 % interval 47 % to 91 %), n = 12')
    expect(proportionText(prop(5, 6), 5, 'checked ideas', 'retained')).toBe('5 of 6 retained, 83 % (95 % interval 44 % to 97 %), n = 6')
    expect(proportionText(prop(10, 10), 10, 'checks')).toMatch(/^10 of 10 right, 100 % \(95 % interval 72 % to 100 %\), n = 10$/)
  })

  test('plural', () => {
    expect([plural(1, 'day'), plural(2, 'day'), plural(0, 'more idea')]).toEqual(['1 day', '2 days', '0 more ideas'])
  })
})

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

let dom: DomKit
let MirrorSummary: React.ComponentType<{ load?: () => Promise<MirrorInput> }>
let Me: React.ComponentType
beforeAll(async () => {
  dom = await installDom()
  MirrorSummary = (await import('../../src/pages/me/MirrorSummary')).default
  Me = (await import('../../src/pages/Me')).default
})
afterAll(async () => {
  await dom.uninstall()
})

async function mountMirror(events: readonly LedgerEvent[], now?: LocalDay): Promise<Mounted> {
  const load = () => Promise.resolve(INPUT(events, now))
  const page = await dom.mount(createElement(MemoryRouter, null, createElement(MirrorSummary, { load })))
  await dom.until(() => page.container.querySelector('[data-mirror="summary"]') !== null)
  return page
}

const fig = (page: Mounted, name: string): MiniElement => {
  const el = page.container.querySelector(`[data-figure="${name}"]`)
  if (!el) throw new Error(`no figure ${name}`)
  return el
}
const textOf = (el: MiniElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('the lazy Mirror section on a fixture ledger', () => {
  test('VRK30: the count, the share with its interval, and per active month, each with its n', async () => {
    const page = await mountMirror(ledger().events)
    expect(textOf(fig(page, 'vrk-count'))).toBe('5retained of 6 checked')
    expect(fig(page, 'vrk-count').getAttribute('data-n')).toBe('6')
    expect(textOf(fig(page, 'vrk-share'))).toContain('5 of 6 retained, 83 % (95 % interval 44 % to 97 %), n = 6')
    expect(fig(page, 'vrk-share').getAttribute('data-enough')).toBe('true')
    expect(textOf(fig(page, 'vrk-month'))).toContain('5 retained per month, n = 1 active month')
    await page.unmount()
  })

  test('cold checks: a figure at 10 checks shows its interval, a track with 3 says not enough data', async () => {
    const page = await mountMirror(ledger().events)
    expect(textOf(fig(page, 'cold-t5-d7'))).toContain('9 of 12 right, 75 % (95 % interval 47 % to 91 %), n = 12')
    expect(textOf(fig(page, 'cold-t5-d30'))).toContain('7 of 10 right, 70 % (95 % interval 40 % to 89 %), n = 10')
    expect(textOf(fig(page, 'cold-t6-d7'))).toContain('not enough data (n = 3 checks, needs 10)')
    expect(textOf(fig(page, 'cold-t6-d30'))).toContain('not enough data (n = 1 checks, needs 10)')
    expect(fig(page, 'cold-t6-d7').getAttribute('data-enough')).toBe('false')
    // the overall row: 15 at 7 days, 11 at 30 days
    expect(fig(page, 'cold-all-d7').getAttribute('data-n')).toBe('15')
    expect(fig(page, 'cold-all-d30').getAttribute('data-n')).toBe('11')
    expect(textOf(fig(page, 'cold-all-d30'))).toContain('7 of 11 right')
    // a track with no cold check has no row
    expect(page.container.querySelector('[data-cold-row="r"]')).toBeNull()
    await page.unmount()
  })

  test('calibration: Brier, reliability, sure-and-wrong with n, bins with intervals, and the offset with its n', async () => {
    const page = await mountMirror(ledger().events)
    expect(textOf(fig(page, 'brier'))).toContain('0.159')
    expect(textOf(fig(page, 'brier'))).toContain('would score 0.207')
    expect(fig(page, 'brier').getAttribute('data-n')).toBe('24')
    expect(textOf(fig(page, 'reliability'))).toContain('0.002')
    expect(textOf(fig(page, 'sure-wrong'))).toContain('1 of 10')
    expect(fig(page, 'sure-wrong').getAttribute('data-n')).toBe('10')
    expect(textOf(fig(page, 'bin-sure'))).toContain('9 of 10 right, 90 % (95 % interval 60 % to 98 %), n = 10')
    expect(textOf(fig(page, 'bin-guess'))).toContain('1 of 4 right, 25 % (95 % interval 5 % to 70 %), n = 4')
    expect(textOf(fig(page, 'bias'))).toContain('claimed 73 % and were right 71 % of the time: overconfident.')
    const offset = fig(page, 'offset')
    expect(offset.getAttribute('data-n')).toBe(String(mirrorOf(ledger().events).offset.n))
    expect(textOf(offset)).toContain('0.02 (default) until 20 first reviews; n = ')
    await page.unmount()
  })

  test('calibration under 20 rated answers says not enough data and prints no score', async () => {
    const j = new Journal()
    for (let i = 0; i < 19; i++) answer(j, D(1), ['x.cal'], i % 2 === 0, { ref: 'quiz:x.l9#0', provenance: 'practice', conf: 'think' })
    const page = await mountMirror(j.events, D(1))
    expect(textOf(fig(page, 'calibration'))).toBe('Calibration: not enough data (n = 19 rated answers, needs 20).')
    expect(page.container.querySelector('[data-figure="brier"]')).toBeNull()
    answer(j, D(1), ['x.cal'], true, { ref: 'quiz:x.l9#0', provenance: 'practice', conf: 'think' })
    await page.unmount()
    const at20 = await mountMirror(j.events, D(1))
    expect(at20.container.querySelector('[data-figure="brier"]')?.getAttribute('data-n')).toBe('20')
    await at20.unmount()
  })

  test('competence: the line with its evidence; form items alone give none, and the same items as plain items do', async () => {
    const page = await mountMirror(ledger().events)
    const line = page.container.querySelector('[data-competence="a5.k0"]')!
    expect(line.querySelectorAll('p').map(textOf)).toEqual([
      'You can a5.k0: 6 of your last 6, on new numbers each time.',
      'n = 7 answers on new numbers · 3 days · last 2026-10-16',
    ])
    expect(page.container.querySelector('[data-competence="a5.k1"]')).toBeNull()
    await page.unmount()

    const formsOnly = new Journal()
    const plainOnly = new Journal()
    for (let i = 0; i < 6; i++) {
      answer(formsOnly, D(i % 2), ['a5.k0'], true, { data: { src: 'form', formId: 'f', track: 't5', formSlot: i, formSet: 0 } })
      answer(plainOnly, D(i % 2), ['a5.k0'], true, { data: { src: 'item' } })
    }
    const none = await mountMirror(formsOnly.events, D(1))
    expect(none.container.querySelector('[data-competence]')).toBeNull()
    expect(textOf(fig(none, 'competence'))).toContain('Not enough data yet (n = 0 ideas')
    await none.unmount()
    const some = await mountMirror(plainOnly.events, D(1))
    expect(textOf(some.container.querySelector('[data-competence="a5.k0"]')!)).toContain('You can a5.k0: 6 of your last 6')
    await some.unmount()
  })

  test('an empty ledger: every figure says not enough data with its n', async () => {
    const page = await mountMirror([])
    expect(textOf(fig(page, 'vrk-share'))).toContain('not enough data (n = 0 checked ideas, needs 5)')
    expect(textOf(fig(page, 'vrk-month'))).toContain('not enough data (n = 0 active months, needs 1)')
    expect(textOf(fig(page, 'cold-all-d7'))).toContain('not enough data (n = 0 checks, needs 10)')
    expect(textOf(fig(page, 'calibration'))).toContain('not enough data (n = 0 rated answers, needs 20)')
    expect(textOf(fig(page, 'offset'))).toContain('0.02 (default) until 20 first reviews; n = 0 so far.')
    expect(textOf(fig(page, 'competence'))).toContain('Not enough data yet (n = 0 ideas')
    await page.unmount()
  })

  test('a failed read shows a retry, not a page of zeros', async () => {
    let tries = 0
    const load = () => (++tries === 1 ? Promise.reject(new Error('no ledger')) : Promise.resolve(INPUT([])))
    const page = await dom.mount(createElement(MemoryRouter, null, createElement(MirrorSummary, { load })))
    await dom.until(() => page.container.querySelector('[role="alert"]') !== null)
    expect(page.container.querySelector('[data-mirror="summary"]')).toBeNull()
    await dom.press(page.container.querySelector('button')!)
    await dom.until(() => page.container.querySelector('[data-mirror="summary"]') !== null)
    await page.unmount()
  })
})

describe('/me: the Mirror reserves no height, and nothing below it moves when it resolves', () => {
  test('its loading state is one line (h-6), not a fixed 24 rem, and the section says when it has settled, in a figure or an error', async () => {
    let release: (i: MirrorInput) => void = () => undefined
    const load = () => new Promise<MirrorInput>((res) => (release = res))
    let settled = 0
    const onSettled = () => void settled++
    const page = await dom.mount(createElement(MemoryRouter, null, createElement(MirrorSummary, { load, onSettled })))
    const status = page.container.querySelector('[role="status"]')!
    expect(status.className).toContain('h-6')
    expect(status.className).not.toMatch(/min-h-/)
    expect(settled).toBe(0)
    await dom.act(() => release(INPUT([])))
    await dom.until(() => page.container.querySelector('[data-mirror="summary"]') !== null)
    expect(settled).toBe(1)
    await page.unmount()

    let failed = 0
    const bad = await dom.mount(createElement(MemoryRouter, null, createElement(MirrorSummary, { load: () => Promise.reject(new Error('no ledger')), onSettled: () => void failed++ })))
    await dom.until(() => bad.container.querySelector('[role="alert"]') !== null)
    expect(failed).toBe(1)
    await bad.unmount()
  })

  test('the page holds the sections below the Mirror back until it has settled, so none is on screen to be pushed down', async () => {
    const page = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/me'] }, createElement(Me)))
    let belowFirst = false
    await dom.until(() => {
      const below = page.container.querySelector('[data-ring-panel], [data-forms-card]') !== null
      const mirror = page.container.querySelector('[data-mirror="summary"], [role="alert"]') !== null
      if (below && !mirror) belowFirst = true
      return below && (page.container.textContent ?? '').includes('data ownership')
    })
    expect(belowFirst).toBe(false)
    await page.unmount()
  })

  test('the source: the Mirror carries no fixed min-h, and only the sections after it wait on mirrorSettled', () => {
    const me = src('pages/Me.tsx')
    // the fallback has the loading line's height, so the swap from one to the other moves nothing
    expect(me.slice(0, me.indexOf('<MirrorSummary'))).toContain('<SectionFallback tall="h-6" />')
    expect(src('pages/me/MirrorSummary.tsx')).not.toContain('min-h-[24rem]')
    // the sections wait for the Mirror and for the forms card's chunk, which has no placeholder (D47, 3c final review F8)
    const gate = me.indexOf('{mirrorSettled && forms && (')
    expect(gate).toBeGreaterThan(0)
    expect(me.indexOf('<MirrorSummary')).toBeLessThan(gate)
    for (const s of ['forms\\.Card', 'BackgroundPick', 'Journey', 'DataOwnership']) expect(me.search(new RegExp(`<${s} />`))).toBeGreaterThan(gate)
    // the card is the loaded module held in state, not a lazy component: no Suspense fallback to swap in
    expect(me).not.toContain("lazy(() => import('@/components/me/FormsCard'))")
  })
})

describe('/me: the order of the page, and what its sections import', () => {
  test('VRK30, cold checks, calibration, competence, the forms mount, then the journey and data ownership', async () => {
    const page = await dom.mount(createElement(MemoryRouter, { initialEntries: ['/me'] }, createElement(Me)))
    await dom.until(() => page.container.querySelector('[data-ring-panel]') !== null && (page.container.textContent ?? '').includes('data ownership'))
    await dom.until(() => page.container.querySelector('[data-mirror="summary"]') !== null || page.container.querySelector('[role="alert"]') !== null)
    const order = page.container
      .querySelectorAll('[data-mirror], [data-forms-card], [data-ring-panel]')
      .map((el) => el.getAttribute('data-mirror') ?? (el.hasAttribute('data-forms-card') ? 'forms' : 'journey'))
      .filter((x) => x !== 'summary')
    expect(order).toEqual(['vrk30', 'cold-checks', 'calibration', 'competence', 'forms', 'journey'])
    // data ownership comes last
    const text = page.container.textContent ?? ''
    expect(text.indexOf('Reset everything')).toBeGreaterThan(text.indexOf('What each ring needs'))
    await page.unmount()
  })

  test('the Mirror sections use no framer-motion, import no lesson content, and the stub is a lazy mount after competence', () => {
    for (const f of ['pages/me/MirrorSummary.tsx', 'pages/me/ColdChecks.tsx', 'pages/me/Calibration.tsx', 'pages/me/Competence.tsx', 'components/me/FormsCard.tsx', 'lib/learner/mirror.ts']) {
      // the imports only: the files' comments say why they need none
      const imports = src(f).split('\n').filter((l) => /^\s*(import|export) .*from '|^\s*import\(/.test(l) || /import\('/.test(l))
      expect(imports.filter((l) => /framer-motion|@\/data\/lessons|@\/lib\/motion/.test(l)), f).toEqual([])
    }
    const me = src('pages/Me.tsx')
    expect(me).toContain("const MirrorSummary = lazy(() => import('@/pages/me/MirrorSummary'))")
    expect(me).toContain("import('@/components/me/FormsCard')")
    // document order in the page: the Mirror, the forms mount, the journey, data ownership
    const at = (s: string) => me.search(new RegExp(`<${s}( [^>]*)? />`))
    const order = [at('MirrorSummary'), at('forms\\.Card'), at('BackgroundPick'), at('Journey'), at('DataOwnership')]
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i > 0)).toBe(true)
    expect(at('MirrorSummary')).toBeGreaterThan(0)
  })
})
