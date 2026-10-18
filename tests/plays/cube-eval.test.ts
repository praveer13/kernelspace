/**
 * The cube's 3D evaluation (docs/specs/wave-3.md §16.1, task 3s-02; docs/prereg/tiling-cube-3d.md): the 3 + 3 split of a
 * learner's six levels by `armOf('cube-view', level, expSeed, 2)`, the views the play records, the two opt-in spatial puzzles
 * (no choice items: a count and an ordered id list), `selectCubeByView`, and the pre-registration, which stays unsigned.
 *
 * The owner's answer of 2026-10-15: the 3D view is a plain opt-in on every level, with no study, so the play runs the
 * evaluation only when `CUBE_VIEW_STUDY` is true, and it stays false until the draft is signed. The walks below play the
 * shipped state (nothing randomized or recorded, 3D on every level) and the switched-on one (the split as 3s-02 built it).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CUBE_VIEW_EXPERIMENT, CUBE_VIEW_STUDY, cubeViewsFor, withViews } from '../../src/lib/learner/cube-views'
import { armOf } from '../../src/lib/learner/experiments'
import { addDays } from '../../src/lib/learner/reentry'
import { ledgerOfDonation, redactForPartner } from '../../src/lib/learner/redact'
import {
  CUBE_VIEW_ERROR_CAP,
  CUBE_VIEW_MARGIN,
  CUBE_VIEW_MIN_LEARNERS,
  isPreregSigned,
  selectCubeByView,
} from '../../src/lib/learner/outcomes'
import { buildKcContent, kcsOfEvent } from '../../src/lib/kc/resolve'
import { ALL_LESSONS } from '../../src/data/lessons'
import { CUBE_LEVELS } from '../../src/lib/world/tiling'
import TilingCubePlay from '../../src/components/play/tiling-cube/Play'
import SpatialProxy, { SpatialFigure } from '../../src/components/play/tiling-cube/SpatialProxy'
import {
  COUNT_FIGURE,
  SPATIAL_GRP,
  SPATIAL_PREFIX,
  START_ORDER,
  VIEWS_FIGURE,
  VIEW_IDS,
  boundsOf,
  countCubes,
  countEvent,
  cubesOf,
  isStepped,
  orderEvent,
  orderIsRight,
  orderViews,
  parseCount,
  spatialRef,
  viewSquares,
  type Heights,
  type ViewId,
} from '../../src/components/play/tiling-cube/spatial'
import type { ItemResponse, LedgerEvent, LocalDay, PlayResult } from '../../src/lib/ledger/types'
import { practiceSession } from '../../src/components/play/tiling-cube/session'
import { useProgress } from '../../src/lib/progress'
import { Journal, START } from '../learner/ledger-gen'
import { installDom, type DomKit } from '../dom/mini-dom'
import { makeProfile, startTab } from '../ledger/env'

const ROOT = join(import.meta.dir, '..', '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')
const IDS = CUBE_LEVELS.map((l) => l.id)

/* ------------------------------------------------------------------ */
/* The split                                                           */
/* ------------------------------------------------------------------ */

describe('cubeViewsFor: six levels split 3 + 3 by armOf', () => {
  const seeds = Array.from({ length: 4000 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0)

  test('the levels are the six the play has, in order', () => {
    expect(IDS).toEqual(['count', 'smem', 'occupancy', 'raster', 'fp8', 'flash'])
  })

  test('every learner gets exactly three levels with 3D and three without', () => {
    for (const seed of seeds) {
      const v = cubeViewsFor(IDS, seed)
      expect(v).toHaveLength(6)
      expect(v.filter((x) => x === '3d')).toHaveLength(3)
      expect(v.filter((x) => x === '2d')).toHaveLength(3)
    }
  })

  test('it is the same on every call, and it is armOf’s coin whenever the coins already split 3 + 3', () => {
    let balanced = 0
    for (const seed of seeds) {
      expect(cubeViewsFor(IDS, seed)).toEqual(cubeViewsFor(IDS, seed))
      const coins = IDS.map((id) => armOf(CUBE_VIEW_EXPERIMENT, id, seed, 2))
      if (coins.reduce((n, c) => n + c, 0) === 3) {
        balanced++
        expect(cubeViewsFor(IDS, seed)).toEqual(coins.map((c) => (c === 1 ? '3d' : '2d')))
      }
    }
    // 20 of the 64 outcomes of six fair coins split 3 + 3 (31.25 %)
    expect(balanced / seeds.length).toBeGreaterThan(0.28)
    expect(balanced / seeds.length).toBeLessThan(0.34)
  })

  test('a repaired split flips the smallest tie-break keys of the larger side, nothing else', () => {
    let repaired = 0
    for (const seed of seeds.slice(0, 600)) {
      const coins = IDS.map((id) => armOf(CUBE_VIEW_EXPERIMENT, id, seed, 2))
      const ones = coins.reduce((n, c) => n + c, 0)
      if (ones === 3) continue
      repaired++
      const out = cubeViewsFor(IDS, seed).map((x) => (x === '3d' ? 1 : 0))
      const changed = IDS.filter((_, i) => out[i] !== coins[i])
      expect(changed).toHaveLength(Math.abs(ones - 3))
      // the flipped levels were on the larger side
      for (const id of changed) expect(coins[IDS.indexOf(id)]).toBe(ones > 3 ? 1 : 0)
      // and they have the smallest keys among that side
      const key = (id: string) => armOf(CUBE_VIEW_EXPERIMENT, `${id}:tie`, seed, 2 ** 30)
      const side = IDS.filter((_, i) => coins[i] === (ones > 3 ? 1 : 0))
      const kept = side.filter((id) => !changed.includes(id))
      for (const f of changed) for (const k of kept) expect(key(f)).toBeLessThanOrEqual(key(k))
    }
    expect(repaired).toBeGreaterThan(300)
  })

  test('each of the 20 balanced splits turns up, about equally often', () => {
    const count = new Map<string, number>()
    for (const seed of seeds) {
      const key = cubeViewsFor(IDS, seed).join('')
      count.set(key, (count.get(key) ?? 0) + 1)
    }
    expect(count.size).toBe(20)
    const expected = seeds.length / 20
    // 200 expected per split, sd about 13.8: eight sd is far past luck and well inside any real bias
    for (const n of count.values()) expect(Math.abs(n - expected)).toBeLessThan(8 * Math.sqrt(expected * (19 / 20)))
  })

  test('each level offers 3D to half of the learners, and the levels do not move together', () => {
    const n3 = Array<number>(6).fill(0)
    const pair = Array.from({ length: 6 }, () => Array<number>(6).fill(0))
    for (const seed of seeds) {
      const v = cubeViewsFor(IDS, seed)
      v.forEach((x, i) => {
        if (x === '3d') {
          n3[i]++
          v.forEach((y, j) => {
            if (y === '3d') pair[i][j]++
          })
        }
      })
    }
    for (const n of n3) expect(Math.abs(n / seeds.length - 0.5)).toBeLessThan(0.03)
    // two given levels are both 3D in a fraction C(4,1)/C(6,3) = 1/5 of the splits
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) expect(Math.abs(pair[i][j] / seeds.length - 0.2)).toBeLessThan(0.03)
  })

  test('the seed decides it: different learners differ, and an odd count gives the 2D side the extra level', () => {
    expect(new Set(seeds.slice(0, 200).map((s) => cubeViewsFor(IDS, s).join(''))).size).toBeGreaterThan(10)
    for (const seed of seeds.slice(0, 200)) {
      const v = cubeViewsFor(['a', 'b', 'c', 'd', 'e'], seed)
      expect(v.filter((x) => x === '3d')).toHaveLength(2)
    }
    expect(cubeViewsFor([], 1)).toEqual([])
  })
})

describe('withViews: a level keeps the view it was given, and a level with none keeps none', () => {
  test('the view is added by level id, and an unrecorded level is left bare', () => {
    const levels = [
      { id: 'count', ok: true, logErr: 0.1 },
      { id: 'smem', ok: false },
      { id: 'flash', ok: true },
    ]
    const out = withViews(levels, { count: '3d', smem: '2d' })
    expect(out).toEqual([
      { id: 'count', ok: true, logErr: 0.1, view: '3d' },
      { id: 'smem', ok: false, view: '2d' },
      { id: 'flash', ok: true },
    ])
    expect('view' in out[2]).toBe(false)
    expect(levels[0]).not.toHaveProperty('view')
    expect(withViews(levels, {}).every((l) => !('view' in l))).toBe(true)
    // the id 'constructor' is not an own key of the views
    expect(withViews([{ id: 'constructor', ok: true }], {})[0]).not.toHaveProperty('view')
  })
})

/* ------------------------------------------------------------------ */
/* The spatial proxy                                                   */
/* ------------------------------------------------------------------ */

describe('spatial puzzles: the figures and their answers', () => {
  test('both figures are solid stacks that step down toward the viewer', () => {
    expect(isStepped(COUNT_FIGURE)).toBe(true)
    expect(isStepped(VIEWS_FIGURE)).toBe(true)
    expect(isStepped([[1, 2]])).toBe(false) // a column taller than the one in front of it
    expect(isStepped([[2], [3]])).toBe(false)
    expect(isStepped([[0]])).toBe(false)
    expect(isStepped([[1, 1], [1]])).toBe(false)
    expect(isStepped([[1.5]])).toBe(false)
  })

  test('item 1 is a count of 15 cubes, summed column by column', () => {
    expect(countCubes(COUNT_FIGURE)).toBe(3 + 2 + 2 + 2 + 2 + 1 + 1 + 1 + 1)
    expect(countCubes(COUNT_FIGURE)).toBe(15)
    expect(cubesOf(COUNT_FIGURE)).toHaveLength(15)
  })

  test('the count needs the cubes that cannot be seen: 5 of the 15 have no face in view, so counting what shows gives 10', () => {
    // a cube shows a face unless the cell beside that face holds a cube: above (top), toward +b (left face), toward +a (right face)
    const has = (h: Heights, a: number, b: number, z: number) => (h[a]?.[b] ?? 0) > z
    const buried = cubesOf(COUNT_FIGURE).filter((c) => has(COUNT_FIGURE, c.a, c.b, c.z + 1) && has(COUNT_FIGURE, c.a, c.b + 1, c.z) && has(COUNT_FIGURE, c.a + 1, c.b, c.z))
    expect(buried).toHaveLength(5)
    expect(cubesOf(COUNT_FIGURE).length - buried.length).toBe(10)
  })

  test('item 2’s three views show 6, 8 and 10 squares, worked from the picture’s rules', () => {
    expect(viewSquares(VIEWS_FIGURE)).toEqual({ top: 6, left: 8, right: 10 })
    expect(orderViews(VIEWS_FIGURE)).toEqual(['top', 'left', 'right'])
    // top: the columns with a cube; left face: for each row a, the tallest column; right face: for each column b, the tallest row
    const h = VIEWS_FIGURE
    expect(h.flat().filter((v) => v > 0)).toHaveLength(6)
    expect(h.map((row) => Math.max(...row)).reduce((a, b) => a + b, 0)).toBe(4 + 3 + 1)
    expect([0, 1, 2].map((b) => Math.max(...h.map((row) => row[b]))).reduce((a, b) => a + b, 0)).toBe(4 + 3 + 3)
  })

  test('a view’s squares are the cubes’ shadow: counted from the cube list by brute force they agree', () => {
    for (const h of [COUNT_FIGURE, VIEWS_FIGURE]) {
      const cubes = cubesOf(h)
      const top = new Set(cubes.map((c) => `${c.a}.${c.b}`)).size
      const left = new Set(cubes.map((c) => `${c.a}.${c.z}`)).size // looking along b: the squares are (a, z)
      const right = new Set(cubes.map((c) => `${c.b}.${c.z}`)).size // looking along a: the squares are (b, z)
      expect(viewSquares(h)).toEqual({ top, left, right })
    }
  })

  test('the order has no tie, the start order is not the answer, and only the whole right list is right', () => {
    const answer = orderViews(VIEWS_FIGURE)
    expect([...START_ORDER]).not.toEqual(answer)
    expect(orderIsRight(answer)).toBe(true)
    expect(orderIsRight(START_ORDER)).toBe(false)
    const perms = (xs: ViewId[]): ViewId[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])))
    const all = perms([...VIEW_IDS])
    expect(all).toHaveLength(6)
    expect(all.filter((p) => orderIsRight(p))).toHaveLength(1)
    expect(orderIsRight(['top', 'left'])).toBe(false)
    expect(() => orderViews([[1, 1], [1, 1]])).toThrow('same number of squares')
  })

  test('a guesser that ignores the picture passes neither item: any fixed count but 15 fails, and one order in six passes', () => {
    const passes = Array.from({ length: 400 }, (_, n) => n).filter((n) => countEvent(n, 0).ok)
    expect(passes).toEqual([15])
  })

  test('the count field takes a whole number and nothing else', () => {
    expect(parseCount('15')).toBe(15)
    expect(parseCount(' 12 ')).toBe(12)
    for (const bad of ['', ' ', '1.5', '-3', '1e2', 'twelve', '15 cubes', '1000', '0x10']) expect([bad, parseCount(bad)]).toEqual([bad, null])
  })
})

describe('spatial puzzles: the drawing', () => {
  test('cubes are drawn back to front, so a nearer cube is painted over a farther one', () => {
    for (const h of [COUNT_FIGURE, VIEWS_FIGURE]) {
      const keys = cubesOf(h).map((c) => c.a + c.b + c.z)
      expect(keys).toEqual([...keys].sort((a, b) => a - b))
    }
  })

  test('it draws three faces for each cube and fits its box', () => {
    const html = renderToString(createElement(SpatialFigure, { heights: COUNT_FIGURE, label: 'x' }))
    expect(html.match(/<polygon/g)).toHaveLength(3 * 15)
    const [x, y, w, h] = boundsOf(COUNT_FIGURE)
    expect(html).toContain(`viewBox="${x} ${y} ${w} ${h}"`)
    expect(w).toBeGreaterThan(40)
    expect(h).toBeGreaterThan(40)
    const html2 = renderToString(createElement(SpatialFigure, { heights: VIEWS_FIGURE, label: 'x' }))
    expect(html2.match(/<polygon/g)).toHaveLength(3 * countCubes(VIEWS_FIGURE))
  })

  test('the picture is named as a picture and its name does not give the answer away', () => {
    const el = renderToString(createElement(SpatialProxy, { env: { history: async () => [], record: () => {}, now: () => 0 } }))
    // before the ledger answers, nothing is offered at all
    expect(el).toBe('')
    const src = read('src/components/play/tiling-cube/SpatialProxy.tsx')
    const label = /const FIGURE_LABEL = '([^']*)'/.exec(src)?.[1] ?? ''
    expect(label).toContain('isometric drawing')
    expect(label).not.toMatch(/\b15\b|\b6\b|\b8\b|\b10\b|top view|squares/)
  })
})

describe('spatial puzzles: the events', () => {
  test('item 1 is `item:cube.spatial.1`, src practice, no KC, a number graded against the figure’s count', () => {
    const right = countEvent(15, 1200)
    const wrong = countEvent(14, 800)
    expect(right).toMatchObject({ kind: 'item', ref: 'item:cube.spatial.1', ok: true, score: 1, provenance: 'practice', ms: 1200 })
    expect(right.data).toMatchObject({ src: 'practice', value: 15, truth: 15, unit: 'cubes', grp: SPATIAL_GRP })
    expect(wrong).toMatchObject({ ok: false, score: 0 })
    expect(wrong.data).toMatchObject({ value: 14, truth: 15 })
    expect(Object.keys(right.data)).not.toContain('kcs')
  })

  test('item 2 is `item:cube.spatial.2`, src practice, no KC, the ordered ids as `picks`', () => {
    const right = orderEvent(['top', 'left', 'right'], 3000)
    const wrong = orderEvent(['right', 'left', 'top'], 3000)
    expect(right).toMatchObject({ kind: 'item', ref: 'item:cube.spatial.2', ok: true, score: 1, provenance: 'practice' })
    expect(right.data).toMatchObject({ src: 'practice', picks: ['top', 'left', 'right'], grp: SPATIAL_GRP })
    expect(wrong).toMatchObject({ ok: false, score: 0 })
    expect(Object.keys(right.data)).not.toContain('kcs')
    // the ordering is an ordered list of ids, not a choice among options: no options, no pick indexes
    expect(Object.keys(right.data)).not.toContain('pick')
  })

  test('a real ledger takes both events, folds them without a KC, and credits nothing', async () => {
    const tab = startTab(makeProfile())
    const kcContent = buildKcContent({ lessons: ALL_LESSONS })
    tab.progress.getState().recordItems([countEvent(15, 1000), orderEvent(['top', 'left', 'right'], 1000)])
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.map((e) => e.ref)).toEqual([spatialRef(1), spatialRef(2)])
    for (const e of events) {
      expect(kcsOfEvent(e, kcContent)).toEqual([])
      expect((e.data as { src: string }).src).toBe('practice')
    }
    const picks = (events[1].data as { picks: string[] }).picks
    expect(picks).toEqual(['top', 'left', 'right'])
  })
})

describe('SpatialProxy, mounted: opt-in, two items, no feedback', () => {
  let dom: DomKit
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(() => dom.uninstall())

  const text = (m: { container: { textContent: string | null } }) => m.container.textContent ?? ''
  const fields = (m: { container: { querySelectorAll: (s: string) => unknown } }, sel: string) => Array.from(m.container.querySelectorAll(sel) as ArrayLike<never>) as never[]
  const buttonNamed = (m: { container: { querySelectorAll: (s: string) => unknown } }, name: string) =>
    fields(m, 'button').find((b) => (b as { textContent: string }).textContent.trim() === name || (b as { getAttribute(n: string): string | null }).getAttribute('aria-label') === name) as never

  function envOf(have: string[] = []) {
    const recorded: ItemResponse[] = []
    let t = 1000
    return {
      recorded,
      env: {
        history: async (prefix: string) => have.filter((r) => r.startsWith(prefix)).map((ref) => ({ ref }) as Pick<LedgerEvent, 'ref'>),
        record: (items: ItemResponse[]) => void recorded.push(...items),
        now: () => (t += 5000),
      },
    }
  }

  test('nothing is recorded until the learner opts in, and then each answer is one event', async () => {
    const { env, recorded } = envOf()
    const m = await dom.mount(createElement(SpatialProxy, { env }))
    await dom.until(() => text(m).includes('Take the two puzzles'))
    expect(recorded).toEqual([])
    expect(text(m)).toContain('Skipping them changes nothing')
    expect(fields(m, 'input')).toHaveLength(0)
    await dom.press(buttonNamed(m, 'Take the two puzzles'))
    expect(text(m)).toContain('Puzzle 1 of 2')
    expect(fields(m, 'svg[role="img"]')).toHaveLength(1)
    // a bad entry records nothing and says so
    await dom.press(buttonNamed(m, 'Record my answer'))
    expect(text(m)).toContain('Write a whole number of cubes')
    expect(recorded).toEqual([])
    // the order puzzle's controls are not reachable from the count puzzle
    expect(fields(m, 'ol')).toHaveLength(0)
    await m.unmount()
  })

  test('the order puzzle moves with buttons, announces the move, and records the ordered ids', async () => {
    const { env, recorded } = envOf()
    const m = await dom.mount(createElement(SpatialProxy, { env }))
    await dom.until(() => text(m).includes('Take the two puzzles'))
    await dom.press(buttonNamed(m, 'Take the two puzzles'))
    // answer the count through the field: set the value and submit the form
    const input = fields(m, 'input')[0] as { value: string; dispatchEvent(e: unknown): boolean; focus(): void }
    await dom.act(() => {
      const proto = Object.getPrototypeOf(input) as object
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(input, '15')
      else input.value = '15'
      input.dispatchEvent(new (dom.window.Event as new (t: string, i?: object) => unknown)('input', { bubbles: true }))
    })
    await dom.press(buttonNamed(m, 'Record my answer'))
    if (recorded.length === 0) {
      // the stand-in DOM did not carry the typed value into React: submit through the form's own handler instead
      throw new Error('the count was not recorded after typing 15')
    }
    expect(recorded[0]).toMatchObject({ ref: 'item:cube.spatial.1', ok: true })
    expect(text(m)).toContain('Puzzle 2 of 2')
    expect(fields(m, 'ol li')).toHaveLength(3)
    const order = () => fields(m, 'ol li').map((li) => (li as { textContent: string }).textContent.replace(/\s+/g, ' ').trim())
    expect(order()[0]).toContain('Right view')
    // first and last rows cannot move off the ends
    expect((buttonNamed(m, 'Move Right view up') as { disabled: boolean }).disabled).toBe(true)
    expect((buttonNamed(m, 'Move Left view down') as { disabled: boolean }).disabled).toBe(true)
    // right, top, left -> top, right, left -> top, left, right
    await dom.press(buttonNamed(m, 'Move Top view up'))
    expect(text(m)).toContain('Top view is now number 1 of 3')
    await dom.press(buttonNamed(m, 'Move Right view down'))
    expect(order().map((s) => s.replace(/^\d\. /, '').replace(/ ?(Up|Down)/g, '').trim())).toEqual(['Top view', 'Left view', 'Right view'])
    await dom.press(buttonNamed(m, 'Record my order'))
    expect(recorded).toHaveLength(2)
    expect(recorded[1]).toMatchObject({ ref: 'item:cube.spatial.2', ok: true })
    expect((recorded[1].data as { picks: string[] }).picks).toEqual(['top', 'left', 'right'])
    // no feedback on whether it was right, and nothing further to press
    expect(text(m)).toContain('Recorded')
    expect(text(m)).not.toMatch(/correct|incorrect|right answer|wrong/i)
    await m.unmount()
  })

  /** Opens the puzzles and answers the count, so the order puzzle is on screen. */
  async function toOrder(env: ReturnType<typeof envOf>['env']) {
    const m = await dom.mount(createElement(SpatialProxy, { env }))
    await dom.until(() => text(m).includes('Take the two puzzles'))
    await dom.press(buttonNamed(m, 'Take the two puzzles'))
    const input = fields(m, 'input')[0] as { value: string; dispatchEvent(e: unknown): boolean }
    await dom.act(() => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input) as object, 'value')?.set
      if (setter) setter.call(input, '15')
      else input.value = '15'
      input.dispatchEvent(new (dom.window.Event as new (t: string, i?: object) => unknown)('input', { bubbles: true }))
    })
    await dom.press(buttonNamed(m, 'Record my answer'))
    await dom.until(() => text(m).includes('Puzzle 2 of 2'))
    return m
  }

  const focusedName = () => (dom.document.activeElement as unknown as { getAttribute(n: string): string | null }).getAttribute('aria-label')

  test('a move keeps focus on the row that moved: on its other button when the press took it to an end, else on the button pressed', async () => {
    const m = await toOrder(envOf().env)
    // right, top, left. Up on row 2 takes Top to the top, which disables its Up: focus goes to its Down, not to the page
    await dom.press(buttonNamed(m, 'Move Top view up'))
    expect((buttonNamed(m, 'Move Top view up') as { disabled: boolean }).disabled).toBe(true)
    expect(focusedName()).toBe('Move Top view down')
    // top, right, left. Down on row 2 takes Right to the bottom, which disables its Down: focus goes to its Up
    await dom.press(buttonNamed(m, 'Move Right view down'))
    expect((buttonNamed(m, 'Move Right view down') as { disabled: boolean }).disabled).toBe(true)
    expect(focusedName()).toBe('Move Right view up')
    // top, left, right. Up on row 3 leaves Right on row 2 with both buttons live: focus stays on the button pressed
    await dom.press(buttonNamed(m, 'Move Right view up'))
    expect(focusedName()).toBe('Move Right view up')
    // top, right, left. Down on row 1 moves Top to row 2: focus stays on the button pressed, though its row moved
    await dom.press(buttonNamed(m, 'Move Top view down'))
    expect(focusedName()).toBe('Move Top view down')
    expect(fields(m, 'ol li').map((li) => (li as { textContent: string }).textContent.replace(/^\d\. /, '').replace(/ ?(Up|Down)/g, '').trim())).toEqual(['Right view', 'Top view', 'Left view'])
    await m.unmount()
  })

  test('a learner who answered both before is not asked again; one who answered a single item still is', async () => {
    const both = await dom.mount(createElement(SpatialProxy, { env: envOf([`${SPATIAL_PREFIX}1`, `${SPATIAL_PREFIX}2`]).env }))
    await dom.until(() => text(both).includes('not offered again'))
    expect(text(both)).not.toContain('Take the two puzzles')
    await both.unmount()
    const one = await dom.mount(createElement(SpatialProxy, { env: envOf([`${SPATIAL_PREFIX}1`]).env }))
    await dom.until(() => text(one).includes('Take the two puzzles'))
    await one.unmount()
  })
})

/* ------------------------------------------------------------------ */
/* selectCubeByView                                                    */
/* ------------------------------------------------------------------ */

const d = (n: number): LocalDay => addDays(START, n)

type Views = Partial<Record<string, '2d' | '3d'>>
const play = (j: Journal, day: number, views: Views, extra: object = {}) =>
  j.add('play', 'play:tiling-cube', d(day), {
    ok: true,
    score: 1,
    provenance: 'practice',
    data: { phase: 'play', levels: IDS.map((id) => ({ id, ok: true, ...(views[id] ? { view: views[id] } : {}) })), ...extra },
  })
/** A graded answer whose error is `err` orders of magnitude (log10 of answer ÷ truth). */
const answer = (j: Journal, ref: string, day: number, err: number, o: { src?: string; provenance?: string; value?: number; truth?: number } = {}) =>
  j.add('item', ref, d(day), {
    ok: true,
    score: 1,
    rev: 'r',
    provenance: o.provenance ?? 'unseen',
    data: { src: o.src ?? 'today', kcs: ['t4.tiling-intensity'], value: o.value ?? 100 * 10 ** err, truth: o.truth ?? 100 },
  })
const spatial = (j: Journal, day: number, n: 1 | 2, ok: boolean) => j.add('item', `item:cube.spatial.${n}`, d(day), { ok, score: ok ? 1 : 0, rev: 'sp1', provenance: 'practice', data: { src: 'practice' } })

/** A learner with raster in 3D and smem in 2D, answering each 30+ days later with the given errors. */
function learner(e3: number, e2: number, o: { spatial?: [boolean, boolean] } = {}): LedgerEvent[] {
  const j = new Journal()
  play(j, 0, { raster: '3d', smem: '2d' })
  if (o.spatial) {
    spatial(j, 0, 1, o.spatial[0])
    spatial(j, 0, 2, o.spatial[1])
  }
  answer(j, 'gen:tiling/raster-ai', 31, e3)
  answer(j, 'gen:tiling/smem-fit', 33, e2)
  return j.events
}

describe('selectCubeByView: 30-day fresh-item error by view', () => {
  test('a learner’s difference is the mean error on 3D levels’ items minus the mean on 2D levels’', () => {
    const j = new Journal()
    play(j, 0, { raster: '3d', fp8: '3d', smem: '2d', occupancy: '2d' })
    answer(j, 'gen:tiling/raster-ai', 31, 0.3)
    answer(j, 'gen:tiling/fp8-ridge', 32, 0.1)
    answer(j, 'gen:tiling/smem-fit', 33, 0.1)
    answer(j, 'gen:tiling/ctas-per-sm', 34, 0)
    answer(j, 'gen:tiling/ctas-per-sm', 35, 0.2)
    const r = selectCubeByView([j.events])
    expect(r.learners).toBe(1)
    expect(r.partners).toBe(1)
    expect(r.answers).toEqual({ '2d': 3, '3d': 2 })
    expect(r.mean['3d']).toBeCloseTo(0.2, 9)
    expect(r.mean['2d']).toBeCloseTo(0.1, 9)
    expect(r.diff.n).toBe(1)
    expect(r.diff.mean).toBeCloseTo(0.2 - 0.1, 9)
    expect(r.margin).toBe(CUBE_VIEW_MARGIN)
    expect(r.required).toBe(CUBE_VIEW_MIN_LEARNERS)
    expect(r.verdict).toBe('underpowered')
  })

  test('the learner is the unit: a learner with many answers counts once, and a learner with one view is no contrast', () => {
    const j = new Journal()
    play(j, 0, { raster: '3d', smem: '2d' })
    for (let i = 0; i < 6; i++) answer(j, 'gen:tiling/raster-ai', 31 + i, 0.5)
    const only3d = selectCubeByView([j.events])
    expect(only3d).toMatchObject({ learners: 0, partners: 1, answers: { '2d': 0, '3d': 6 } })
    expect(only3d.diff.mean).toBeNull()
    const both = selectCubeByView([j.events, learner(0.2, 0.1)])
    expect(both.learners).toBe(1)
    expect(both.partners).toBe(2)
  })

  test('answers before day 30, in a play, on seen seeds, in another family, without a log or on a level with no view are left out', () => {
    const j = new Journal()
    play(j, 0, { raster: '3d', smem: '2d' })
    answer(j, 'gen:tiling/raster-ai', 29, 0.3) // too soon
    answer(j, 'gen:tiling/raster-ai', 40, 0.3, { src: 'play' })
    answer(j, 'gen:tiling/raster-ai', 40, 0.3, { provenance: 'practice' })
    answer(j, 'gen:tiling/raster-ai', 40, 0.3, { provenance: 'field' })
    answer(j, 'gen:roofline/decode-b1', 40, 0.3) // another variant
    answer(j, 'gen:tiling/qblock-ai', 40, 0.3) // byte units
    answer(j, 'gen:tiling/fp8-ridge', 40, 0.3) // fp8 has no recorded view
    answer(j, 'gen:tiling/raster-ai', 40, 0, { value: 0 })
    answer(j, 'gen:tiling/raster-ai', 40, 0, { truth: 0 })
    j.add('item', 'gen:tiling/smem-fit', d(41), { ok: true, score: 1, rev: 'r', provenance: 'unseen', data: { src: 'today' } })
    expect(selectCubeByView([j.events])).toMatchObject({ learners: 0, partners: 0, answers: { '2d': 0, '3d': 0 }, mean: { '2d': null, '3d': null } })
  })

  test('a learner whose cube play recorded no view is in neither group, and a play before the views does not start the clock', () => {
    const none = new Journal()
    play(none, 0, {})
    answer(none, 'gen:tiling/raster-ai', 40, 0.3)
    expect(selectCubeByView([none.events]).partners).toBe(0)
    const late = new Journal()
    play(late, 0, {}) // no seed yet: no view recorded
    play(late, 10, { raster: '3d', smem: '2d' })
    answer(late, 'gen:tiling/raster-ai', 31, 0.3) // 31 days after the first play, 21 after the one with views
    answer(late, 'gen:tiling/smem-fit', 31, 0.1)
    expect(selectCubeByView([late.events]).partners).toBe(0)
    answer(late, 'gen:tiling/raster-ai', 41, 0.3)
    answer(late, 'gen:tiling/smem-fit', 41, 0.1)
    expect(selectCubeByView([late.events])).toMatchObject({ learners: 1, answers: { '2d': 1, '3d': 1 } })
  })

  test('the first view recorded for a level counts, so a later play cannot move it', () => {
    const j = new Journal()
    play(j, 0, { raster: '3d', smem: '2d' })
    play(j, 5, { raster: '2d', smem: '3d' })
    answer(j, 'gen:tiling/raster-ai', 40, 0.4)
    answer(j, 'gen:tiling/smem-fit', 40, 0.1)
    const r = selectCubeByView([j.events])
    expect(r.diff.mean).toBeCloseTo(0.4 - 0.1, 9)
  })

  test('one wild answer is capped at a factor of ten, and the view is read from the recorded play, never from the seed', () => {
    const j = new Journal()
    play(j, 0, { raster: '3d', smem: '2d' })
    answer(j, 'gen:tiling/raster-ai', 40, 0, { value: 1e9, truth: 100 })
    answer(j, 'gen:tiling/smem-fit', 40, 0.1)
    expect(CUBE_VIEW_ERROR_CAP).toBe(1)
    expect(selectCubeByView([j.events]).diff.mean).toBeCloseTo(CUBE_VIEW_ERROR_CAP - 0.1, 9)
  })

  test('the spatial proxy stratifies: both right is high, fewer is low, and not both answered is none', () => {
    const r = selectCubeByView([
      learner(0.2, 0.1, { spatial: [true, true] }),
      learner(0.3, 0.1, { spatial: [true, false] }),
      learner(0.1, 0.1, { spatial: [false, false] }),
      learner(0.4, 0.1),
      (() => {
        // one puzzle only: none
        const j = Journal.from(learner(0.5, 0.1))
        spatial(j, 1, 1, true)
        return j.events
      })(),
    ])
    expect(r.learners).toBe(5)
    expect(r.strata.high.n).toBe(1)
    expect(r.strata.high.mean).toBeCloseTo(0.1, 9)
    expect(r.strata.low.n).toBe(2)
    expect(r.strata.low.mean).toBeCloseTo((0.2 + 0) / 2, 9)
    expect(r.strata.none.n).toBe(2)
    expect(r.strata.none.mean).toBeCloseTo((0.3 + 0.4) / 2, 9)
    // a learner’s first answer to each puzzle is the one that counts
    const j = Journal.from(learner(0.2, 0.1, { spatial: [true, true] }))
    spatial(j, 9, 1, false)
    expect(selectCubeByView([j.events]).strata.high.n).toBe(1)
  })

  const many = (n: number, diffs: (i: number) => number) => Array.from({ length: n }, (_, i) => learner(0.2 + diffs(i), 0.2))

  test('with fewer learners than the power calculation needs the verdict is underpowered, whatever the numbers say', () => {
    expect(selectCubeByView(many(CUBE_VIEW_MIN_LEARNERS - 1, () => 0)).verdict).toBe('underpowered')
    expect(selectCubeByView(many(CUBE_VIEW_MIN_LEARNERS - 1, () => 0.9)).verdict).toBe('underpowered')
  })

  test('non-inferior needs the upper bound below the margin; inferior the lower bound at or above it; else inconclusive', () => {
    const level = selectCubeByView(many(CUBE_VIEW_MIN_LEARNERS, () => 0))
    expect(level.learners).toBe(CUBE_VIEW_MIN_LEARNERS)
    expect(level.diff.upper).toBeCloseTo(0, 9)
    expect(level.verdict).toBe('noninferior')
    // 3D much worse
    const worse = selectCubeByView(many(CUBE_VIEW_MIN_LEARNERS, () => 0.3))
    expect(worse.diff.lower).toBeGreaterThanOrEqual(CUBE_VIEW_MARGIN)
    expect(worse.verdict).toBe('inferior')
    // 3D better: still non-inferior
    expect(selectCubeByView(many(CUBE_VIEW_MIN_LEARNERS, () => -0.1)).verdict).toBe('noninferior')
    // a spread whose interval straddles the margin: mean 0.1, learners alternate -0.2 and 0.4
    const wide = selectCubeByView(many(CUBE_VIEW_MIN_LEARNERS + 1, (i) => (i % 2 === 0 ? -0.2 : 0.4)))
    expect(wide.diff.upper as number).toBeGreaterThanOrEqual(CUBE_VIEW_MARGIN)
    expect(wide.diff.lower as number).toBeLessThan(CUBE_VIEW_MARGIN)
    expect(wide.verdict).toBe('inconclusive')
  })

  test('the bootstrap is seeded, so a report reproduces', () => {
    const ledgers = many(80, (i) => ((i * 7) % 11) / 20 - 0.2)
    expect(selectCubeByView(ledgers)).toEqual(selectCubeByView(ledgers))
  })

  test('a donation reads like its export: the views, the numbers and the spatial stratum all survive', () => {
    const j = Journal.from(learner(0.3, 0.1, { spatial: [true, true] }))
    const donated = ledgerOfDonation(redactForPartner({ events: j.events, working: [] }))
    const a = selectCubeByView([j.events])
    const b = selectCubeByView([donated.events])
    expect(b).toMatchObject({ learners: 1, answers: { '2d': 1, '3d': 1 } })
    expect(b.diff.mean).toBeCloseTo(a.diff.mean as number, 9)
    expect(b.strata.high.n).toBe(1)
  })
})

/* ------------------------------------------------------------------ */
/* The pre-registration                                                */
/* ------------------------------------------------------------------ */

describe('docs/prereg/tiling-cube-3d.md: a draft the owner signs', () => {
  const text = read('docs/prereg/tiling-cube-3d.md')

  test('it is unsigned and undated, and nothing in the repo reads it as signed', () => {
    expect(isPreregSigned(text)).toBe(false)
    expect(text).toMatch(/^Signed: \(pending owner\)$/m)
    expect(text).toMatch(/DRAFT for the owner to sign/)
    expect(text).toMatch(/\| Owner \| *\|/)
    expect(text).toMatch(/\| Date signed \| *\|/)
    // a signed copy would be read as signed: the check is not vacuous
    expect(isPreregSigned(text.replace('Signed: (pending owner)', 'Signed: Someone 2026-10-15'))).toBe(true)
  })

  test('the study is off while the draft is unsigned: nothing randomizes without a signature', () => {
    // a signature allows the switch (cube-views.ts, one line); it never turns it on by itself
    if (!isPreregSigned(text)) expect(CUBE_VIEW_STUDY).toBe(false)
  })

  test('it sets the margin and the default, and the numbers are the code’s', () => {
    expect(CUBE_VIEW_MARGIN).toBe(0.1)
    expect(text).toContain('0.10 in *d*')
    expect(text).toMatch(/3D stays opt-in/)
    expect(text).toMatch(/The default applies: 3D stays opt-in/)
    // the power recipe: ((1.960 + 0.842) x sd / margin)^2 with an assumed sd of 0.30
    const n = Math.ceil(((1.96 + 0.842) * 0.3 / CUBE_VIEW_MARGIN) ** 2)
    expect(n).toBe(71)
    expect(CUBE_VIEW_MIN_LEARNERS).toBe(n)
    expect(text).toContain('**71**')
    expect(text).toContain('/ 0.10)^2 = 70.7')
  })

  test('it names the assignment, the outcome and the proxy as the code builds them', () => {
    expect(text).toContain("armOf('cube-view', <level id>, expSeed, 2)")
    for (const id of IDS) expect(text).toContain(id)
    for (const ref of ['roofline/tile-ai', 'tiling/smem-fit', 'tiling/ctas-per-sm', 'tiling/raster-ai', 'tiling/fp8-ridge']) expect(text).toContain(ref)
    expect(text).toContain('item:cube.spatial.1')
    expect(text).toContain('item:cube.spatial.2')
    expect(text).toMatch(/no choice items/)
    expect(text).toMatch(/intention to treat/)
    // it says what it does not measure
    expect(text).toMatch(/Time is not measured/)
  })
})

/* ------------------------------------------------------------------ */
/* The play                                                            */
/* ------------------------------------------------------------------ */

describe('the play, walked: with the study off 3D is a plain opt-in; switched on, the split decides where 3D is offered, and the record carries it', () => {
  let dom: DomKit
  const progress = useProgress
  const saved = {
    working: progress.getState().working,
    recordPlay: progress.getState().recordPlay,
    recordItems: progress.getState().recordItems,
    setWorking: progress.getState().setWorking,
    ledger: progress.getState().ledger,
    engine: progress.controls.engine,
  }
  beforeAll(async () => {
    dom = await installDom()
  })
  afterAll(async () => {
    await dom.uninstall()
    progress.setState({ working: saved.working, recordPlay: saved.recordPlay, recordItems: saved.recordItems, setWorking: saved.setWorking, ledger: saved.ledger } as never)
    ;(progress.controls as { engine: unknown }).engine = saved.engine
  })

  type El = { tagName: string; textContent: string; value: string; getAttribute(n: string): string | null; dispatchEvent(e: unknown): boolean }

  /**
   * Plays all six levels on the practice seed, answering with the truth, and says on which levels the 3D entry showed. The
   * ledger is loaded and writable, so a play that wanted an `exp:seed` would write one (`written` keeps the working keys).
   */
  async function walk(working: Record<string, unknown>, study?: boolean) {
    const plays: PlayResult[] = []
    const items: ItemResponse[] = []
    const written: string[] = []
    progress.setState({
      working,
      recordPlay: (r: PlayResult) => void plays.push(r),
      recordItems: (r: ItemResponse[]) => void items.push(...r),
      setWorking: (key: string) => void written.push(key),
      ledger: { ...saved.ledger, ready: true, readOnly: false },
    } as never)
    ;(progress.controls as { engine: unknown }).engine = async () => ({ events: async () => [] })
    const m = await dom.mount(createElement(MemoryRouter, null, createElement(TilingCubePlay, { mode: 'page', ...(study === undefined ? {} : { study }) })))
    const all = (sel: string) => Array.from(m.container.querySelectorAll(sel) as ArrayLike<never>) as El[]
    const btn = (name: string | RegExp) => all('button').find((b) => (typeof name === 'string' ? b.textContent.trim().startsWith(name) : name.test(b.textContent.trim())))
    const body = () => m.container.textContent ?? ''
    const type = async (v: string) => {
      const el = all('input').find((i) => i.getAttribute('type') === null) as El
      await dom.act(() => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
        if (setter) setter.call(el, v)
        else el.value = v
        el.dispatchEvent(new (dom.window.Event as new (t: string, i?: object) => unknown)('input', { bubbles: true }))
      })
    }
    const shown: boolean[] = []
    const noted: boolean[] = []
    const start = practiceSession()
    for (let n = 0; n < 6; n++) {
      const a = start.runs[n].inst.answer
      if (a.kind === 'choice') throw new Error('the cube asks numbers')
      await dom.until(() => body().includes('your prediction'))
      await type(String(a.truth))
      await dom.press(btn('Submit') as never)
      await dom.press(btn('Open the views') as never)
      await dom.until(() => btn('Answer it now') !== undefined)
      shown.push(body().includes('Show it in 3D'))
      noted.push(body().includes('picked at random for you'))
      await dom.press(btn('Answer it now') as never)
      await dom.until(() => body().includes('the same question, exact'))
      await type(String(a.truth))
      await dom.press(btn('Submit') as never)
      await dom.press(btn('See the debrief') as never)
      await dom.until(() => btn(/^(Level \d|See all six)/) !== undefined)
      await dom.press(btn(/^(Level \d|See all six)/) as never)
    }
    await dom.until(() => m.container.querySelector('[data-phase-now="debrief"]') !== null)
    return { m, plays, items, written, shown, noted, body, btn }
  }

  test('with the study off (CUBE_VIEW_STUDY while the draft is unsigned): every level offers 3D, and nothing is randomized, recorded or said about a study', async () => {
    for (const working of [{ 'exp:seed': 12345 }, {}]) {
      const r = await walk(working, false)
      expect(r.shown).toEqual([true, true, true, true, true, true])
      expect(r.noted).toEqual([false, false, false, false, false, false])
      // no exp:seed is made for the cube, even with the ledger loaded and writable and none there
      expect(r.written).not.toContain('exp:seed')
      expect(r.written).toEqual([])
      // the record carries no view
      expect(r.plays).toHaveLength(1)
      const levels = r.plays[0].data.levels ?? []
      expect(levels.map((l) => l.id)).toEqual(IDS)
      expect(levels.some((l) => 'view' in l)).toBe(false)
      // the closing screen says nothing about a random pick or a pre-registration, and offers no spatial puzzles
      expect(r.body()).not.toContain('picked at random')
      expect(r.body()).not.toContain('the rule for reading it was fixed')
      expect(r.body()).not.toContain('tiling-cube-3d.md')
      expect(r.body()).not.toContain('spatial puzzles')
      expect(r.m.container.querySelector('[data-spatial]')).toBeNull()
      expect(r.items.filter((i) => i.ref.startsWith('item:cube.spatial.'))).toEqual([])
      await r.m.unmount()
    }
  })

  test('every page mounts the play with the default, CUBE_VIEW_STUDY, so it is the one switch', () => {
    const walkSrc = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const f = join(dir, n)
        return statSync(f).isDirectory() ? walkSrc(f) : /\.(ts|tsx)$/.test(n) ? [f] : []
      })
    const mounts = walkSrc(join(ROOT, 'src'))
      .map((f) => ({ file: relative(ROOT, f), text: read(relative(ROOT, f)) }))
      .filter((f) => /<found\.entry\.Component\b/.test(f.text))
    expect(mounts.map((f) => f.file).sort()).toEqual(['src/components/blocks/PlayBlock.tsx', 'src/pages/Play.tsx'])
    for (const f of mounts) for (const tag of f.text.match(/<found\.entry\.Component\b[^>]*>/g) ?? []) expect(tag).toMatch(/^<found\.entry\.Component mode="(page|embed)" \/>$/)
    expect(read('src/components/play/tiling-cube/Play.tsx')).toContain('study = CUBE_VIEW_STUDY')
  })

  test('switched on, a learner with an exp:seed is offered 3D on exactly the levels the split gives it, three of six', async () => {
    const seed = 12345
    const want = cubeViewsFor(IDS, seed)
    const r = await walk({ 'exp:seed': seed }, true)
    expect(r.shown).toEqual(want.map((v) => v === '3d'))
    expect(r.shown.filter(Boolean)).toHaveLength(3)
    // the note that says why appears with the entry and nowhere else
    expect(r.noted).toEqual(r.shown)
    expect(r.plays).toHaveLength(1)
    const levels = r.plays[0].data.levels ?? []
    expect(levels.map((l) => l.id)).toEqual(IDS)
    expect(levels.map((l) => l.view)).toEqual(want)
    expect(r.plays[0].data.levels?.every((l) => l.ok)).toBe(true)
    // the closing screen explains the assignment and offers the optional puzzles, which record nothing until opted into
    await r.m.unmount()
  })

  test('switched on, the closing screen says the levels were picked at random and offers the puzzles, and no puzzle answer is recorded unasked', async () => {
    const r = await walk({ 'exp:seed': 777 }, true)
    await dom.until(() => r.body().includes('Take the two puzzles'))
    expect(r.body()).toContain('picked at random for you, to find out whether the 3D view helps')
    expect(r.items.filter((i) => i.ref.startsWith('item:cube.spatial.'))).toEqual([])
    await r.m.unmount()
  })

  test('switched on, a learner with no exp:seed yet gets one made, is offered no 3D until it is read, has no view recorded, is told nothing about an experiment and sees no puzzles', async () => {
    const r = await walk({}, true)
    // the play asks for the seed once the ledger is ready (this stand-in store keeps it, so the walk stays seedless)
    expect(r.written).toContain('exp:seed')
    expect(r.shown).toEqual([false, false, false, false, false, false])
    expect(r.noted).toEqual([false, false, false, false, false, false])
    expect(r.plays).toHaveLength(1)
    expect((r.plays[0].data.levels ?? []).some((l) => 'view' in l)).toBe(false)
    expect(r.body()).not.toContain('picked at random')
    expect(r.body()).not.toContain('Take the two puzzles')
    await r.m.unmount()
  })

  test('switched on, different learners get different splits through the same play', async () => {
    const seen = new Set<string>()
    for (const seed of [1, 2, 3]) {
      const r = await walk({ 'exp:seed': seed }, true)
      seen.add((r.plays[0].data.levels ?? []).map((l) => l.view).join(','))
      await r.m.unmount()
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  test('the proxy is a lazy import, so the closing chunk and the entry do not carry it', () => {
    const play = read('src/components/play/tiling-cube/Play.tsx')
    expect(play).toContain("lazy(() => import('./SpatialProxy'))")
    expect(play).not.toMatch(/^import .* from '\.\/SpatialProxy'/m)
    expect(play).not.toMatch(/^import .* from '\.\/spatial'/m)
  })
})
