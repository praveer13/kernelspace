/**
 * Which of the Tiling Cube's levels offer the 3D view (docs/specs/wave-3.md §16.1, task 3s-02; docs/prereg/tiling-cube-3d.md):
 * each learner's six levels split 3 + 3 between "2D only" and "3D available", counterbalanced within the learner, so every
 * learner is compared with themselves and a strong or weak learner contributes to both views.
 *
 * The coin of one level is `armOf('cube-view', levelId, expSeed, 2)`: 0 is "2D only", 1 is "3D available". Six independent
 * coins split 3 + 3 only 20 times in 64, so a split that is off is repaired by flipping the surplus levels with the
 * smallest tie-break keys (a second `armOf` over the same level, with 2^30 arms): the six levels then take one of the
 * C(6,3) = 20 balanced splits, each equally often, since the coins and the keys treat the levels alike. Pure and
 * deterministic, so the same learner gets the same split on every visit and on every device that shares an `exp:seed`;
 * analysis reads the view the play recorded (`PlayLevel.view`) and never recomputes it, as the ladder experiment does.
 */

import { armOf } from './experiments'

/**
 * Whether the play runs the evaluation above. It stays false until the owner signs docs/prereg/tiling-cube-3d.md: the
 * owner's answer of 2026-10-15 makes the 3D view a plain opt-in on every level, with no study, so while it is false the
 * play creates no `exp:seed` for the cube, assigns and records no view (no `PlayLevel.view`), offers "Show it in 3D" on
 * all six levels and offers no spatial puzzles. A signature turns the study on here, in this one line;
 * tests/plays/cube-eval.test.ts fails if it is true while the draft is unsigned.
 */
export const CUBE_VIEW_STUDY: boolean = false

/** The experiment name `armOf` hashes with the level and the learner's seed. */
export const CUBE_VIEW_EXPERIMENT = 'cube-view'

/** What a level offers: the 2D faces alone, or the 2D faces with an opt-in 3D box (`PlayLevel.view`). */
export type CubeView = '2d' | '3d'

/** Arms of the tie-break key: far more than six levels, so ties are as likely as two draws of a 30-bit number being equal. */
const TIE_ARMS = 2 ** 30

/**
 * The view of each level, in the order of `levelIds`, for the learner whose `exp:seed` is `expSeed`. Half the levels (rounded
 * down) offer 3D, so six levels give exactly 3 + 3 and an odd count gives the 2D side the extra level.
 */
export function cubeViewsFor(levelIds: readonly string[], expSeed: number): CubeView[] {
  const coin = levelIds.map((id) => armOf(CUBE_VIEW_EXPERIMENT, id, expSeed, 2))
  const want3d = Math.floor(levelIds.length / 2)
  const have3d = coin.reduce((n, c) => n + c, 0)
  if (have3d !== want3d) {
    // flip the levels of the larger side, those with the smallest keys first; the stable sort breaks a tie by position
    const flip = have3d > want3d ? 1 : 0
    const key = levelIds.map((id) => armOf(CUBE_VIEW_EXPERIMENT, `${id}:tie`, expSeed, TIE_ARMS))
    const order = levelIds.map((_, i) => i).filter((i) => coin[i] === flip)
    order.sort((a, b) => key[a] - key[b] || a - b)
    for (const i of order.slice(0, Math.abs(have3d - want3d))) coin[i] = 1 - flip
  }
  return coin.map((c) => (c === 1 ? '3d' : '2d'))
}

/** A level's result with the view it was given, where one was recorded; a level with none keeps no `view`, so it is not in the comparison. */
export function withViews<L extends { id: string }>(levels: readonly L[], views: Readonly<Record<string, CubeView>>): (L & { view?: CubeView })[] {
  return levels.map((l) => (Object.hasOwn(views, l.id) ? { ...l, view: views[l.id] } : { ...l }))
}
