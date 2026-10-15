/**
 * The cube's two-item spatial proxy (docs/specs/wave-3.md §16.1, task 3s-02; docs/prereg/tiling-cube-3d.md section 3): a
 * short, opt-in measure of spatial visualisation, so the analysis of the 3D view can be stratified by it (Höffler 2010,
 * games-3d.md:407). Pure: the two figures, their answers, the isometric drawing's geometry and the ledger events.
 *
 * **No choice items, so no pool applies.** Item 1 asks for a number (how many unit cubes make the solid) and item 2 for an
 * ordered list of ids (the three flat views of another solid, fewest squares first). Neither has options to read a cue
 * from, and a blind guesser has a 1-in-6 chance on the ordering and next to none on the count. Both answers are computed
 * from the figure's heights (`countCubes`, `orderViews`), never typed in, and a test works the figures through.
 *
 * **Not a lesson item.** Each answer is an `item` event `item:cube.spatial.<n>` with src `practice` and no `kcs`, so no KC
 * resolves for it (`kcsOfEvent`), no card is made, and competence, VRK₃₀ and Today read nothing from it. The learner is not
 * told which answers were right: it is a measure of the learner, not a lesson.
 *
 * **The figures** are solid stacks of unit cubes in the corner of a room: every cube rests on the floor or on another
 * cube, and the stack steps down toward the viewer (a column is never taller than the column behind it), so every
 * column's top is in view, and a column's height is read off the picture by counting the steps down to the floor,
 * including the cubes a taller column in front would hide. A heights table `h[a][b]` holds the column at row `a`
 * (counted from the back-right) and column `b` (from the back-left); both indices run toward the viewer.
 */

import type { ItemResponse } from '@/lib/ledger/types'

/** The columns of a stack: `h[a][b]` cubes high. Never increasing in `a` or in `b`, so the stack steps down toward the viewer. */
export type Heights = readonly (readonly number[])[]

/** Item 1: 3 rows of 3 columns, 15 cubes; the back corner is 3 high and the cubes of the two front rows partly hide those behind. */
export const COUNT_FIGURE: Heights = [
  [3, 2, 2],
  [2, 2, 1],
  [1, 1, 1],
]

/** Item 2: 6 columns, 4 high at the back corner. Its three flat views show 6, 8 and 10 squares, so the order has no tie. */
export const VIEWS_FIGURE: Heights = [
  [4, 3, 3],
  [3, 2, 0],
  [1, 0, 0],
]

/** The three flat views of a stack: from straight above, and straight at its left-hand and right-hand faces in the drawing. */
export type ViewId = 'top' | 'left' | 'right'
export const VIEW_IDS: readonly ViewId[] = ['top', 'left', 'right']
export const VIEW_NAMES: Record<ViewId, string> = { top: 'Top view', left: 'Left view', right: 'Right view' }

/** Whether `h` is a stack the drawing can show unambiguously: whole non-negative heights, never rising toward the viewer, at least one cube. */
export function isStepped(h: Heights): boolean {
  if (h.length === 0 || h.some((row) => row.length !== h[0].length)) return false
  for (let a = 0; a < h.length; a++) {
    for (let b = 0; b < h[a].length; b++) {
      const v = h[a][b]
      if (!Number.isInteger(v) || v < 0) return false
      if (a > 0 && v > h[a - 1][b]) return false
      if (b > 0 && v > h[a][b - 1]) return false
    }
  }
  return h[0][0] > 0
}

/** The cubes in the stack. */
export const countCubes = (h: Heights): number => h.reduce((n, row) => n + row.reduce((m, v) => m + v, 0), 0)

/**
 * The squares in each flat view: a square shows when any cube lies behind it along the line of sight. From above that is
 * every column with a cube; at the left-hand face it is, for each row `a`, the tallest column in the row (the first, since
 * heights do not rise toward the viewer), and at the right-hand face, for each column `b`, the tallest in that column.
 */
export function viewSquares(h: Heights): Record<ViewId, number> {
  let top = 0
  let left = 0
  let right = 0
  for (let a = 0; a < h.length; a++) {
    left += Math.max(...h[a])
    for (let b = 0; b < h[a].length; b++) if (h[a][b] > 0) top++
  }
  for (let b = 0; b < h[0].length; b++) right += Math.max(...h.map((row) => row[b]))
  return { top, left, right }
}

/** The views from fewest squares to most. Throws on a tie, which would leave the order undetermined. */
export function orderViews(h: Heights): ViewId[] {
  const n = viewSquares(h)
  const order = [...VIEW_IDS].sort((x, y) => n[x] - n[y])
  if (n[order[0]] === n[order[1]] || n[order[1]] === n[order[2]]) throw new RangeError(`two views show the same number of squares: ${JSON.stringify(n)}`)
  return order
}

/** The order the ordering item starts in: not the answer, so pressing "Record" untouched is a wrong answer and not a free right one. */
export const START_ORDER: readonly ViewId[] = ['right', 'top', 'left']

/* ------------------------------------------------------------------ */
/* The isometric drawing                                               */
/* ------------------------------------------------------------------ */

/** The drawing's unit edge in SVG user units; an isometric edge is foreshortened to the same length on all three axes. */
export const EDGE = 22
const COS30 = Math.sqrt(3) / 2

/** Where a point of the stack's space lands in the drawing: `a` runs toward the lower right, `b` toward the lower left, `z` up. */
export const project = (a: number, b: number, z: number): [number, number] => [(a - b) * COS30 * EDGE, (a + b) * 0.5 * EDGE - z * EDGE]

export interface Cube {
  a: number
  b: number
  z: number
}

/** Every cube, back to front: the painter's order of a view from the (+a, +b, +z) corner, by a + b + z, so a nearer cube is drawn over a farther one. */
export function cubesOf(h: Heights): Cube[] {
  const out: Cube[] = []
  for (let a = 0; a < h.length; a++) for (let b = 0; b < h[a].length; b++) for (let z = 0; z < h[a][b]; z++) out.push({ a, b, z })
  return out.sort((p, q) => p.a + p.b + p.z - (q.a + q.b + q.z) || p.z - q.z || p.a - q.a)
}

export type FaceTone = 'top' | 'left' | 'right'

/** The four corners of one of a cube's three visible faces, as a polygon `points` string. */
export function facePoints(c: Cube, face: FaceTone): string {
  const { a, b, z } = c
  const corners: [number, number, number][] =
    face === 'top'
      ? [[a, b, z + 1], [a + 1, b, z + 1], [a + 1, b + 1, z + 1], [a, b + 1, z + 1]]
      : face === 'left'
        ? [[a, b + 1, z], [a + 1, b + 1, z], [a + 1, b + 1, z + 1], [a, b + 1, z + 1]]
        : [[a + 1, b, z], [a + 1, b + 1, z], [a + 1, b + 1, z + 1], [a + 1, b, z + 1]]
  return corners.map(([x, y, w]) => project(x, y, w).map((v) => Math.round(v * 100) / 100).join(',')).join(' ')
}

/** The drawing's bounds with a margin: `[minX, minY, width, height]` for the SVG's viewBox, from every corner of every cube. */
export function boundsOf(h: Heights, margin = 8): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const c of cubesOf(h)) {
    for (const [da, db, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) {
      const [x, y] = project(c.a + da, c.b + db, c.z + dz)
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
  }
  return [Math.floor(x0 - margin), Math.floor(y0 - margin), Math.ceil(x1 - x0 + 2 * margin), Math.ceil(y1 - y0 + 2 * margin)]
}

/* ------------------------------------------------------------------ */
/* The items and their ledger events                                   */
/* ------------------------------------------------------------------ */

export const SPATIAL_COUNT = 2
export const SPATIAL_PREFIX = 'item:cube.spatial.'
export const spatialRef = (n: 1 | 2): `item:${string}` => `${SPATIAL_PREFIX}${n}`
/** The attempt group of the two items. */
export const SPATIAL_GRP = 'play:tiling-cube#spatial'
/** The revision of the two items: the figures and the wording; change either and it changes. */
export const SPATIAL_REV = 'sp1'
/** Nominal seconds an item takes, for session sizing. */
export const SPATIAL_NSEC = 60

/** A whole number of cubes from the field's text, or null for anything else (empty, a fraction, negative, beyond the sanity cap). */
export function parseCount(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,3}$/.test(t)) return null
  return Number(t)
}

/** Whether `order` is the fewest-first order of `h`'s views (the whole list, in place). */
export const orderIsRight = (order: readonly ViewId[], h: Heights = VIEWS_FIGURE): boolean => {
  const truth = orderViews(h)
  return order.length === truth.length && order.every((v, i) => v === truth[i])
}

/**
 * Item 1's `item` event: src `practice`, no `kcs`. `value` and `truth` are numbers a donation may keep (§15.2: the
 * figure is the same for every learner, so the truth is no secret).
 */
export function countEvent(value: number, ms: number): ItemResponse {
  const truth = countCubes(COUNT_FIGURE)
  const ok = value === truth
  return {
    kind: 'item',
    ref: spatialRef(1),
    rev: SPATIAL_REV,
    score: ok ? 1 : 0,
    ok,
    ms,
    provenance: 'practice',
    data: { src: 'practice', value, truth, unit: 'cubes', grp: SPATIAL_GRP, nsec: SPATIAL_NSEC },
  }
}

/** Item 2's `item` event: the learner's order as `picks`, ids fewest squares first. */
export function orderEvent(order: readonly ViewId[], ms: number): ItemResponse {
  const ok = orderIsRight(order)
  return {
    kind: 'item',
    ref: spatialRef(2),
    rev: SPATIAL_REV,
    score: ok ? 1 : 0,
    ok,
    ms,
    provenance: 'practice',
    data: { src: 'practice', picks: [...order], grp: SPATIAL_GRP, nsec: SPATIAL_NSEC },
  }
}
