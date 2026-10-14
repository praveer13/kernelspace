import roofline from '@/lib/items/families/roofline'
import tiling from '@/lib/items/families/tiling'
import { correctResponse, ruleRatio } from '@/lib/items/grade'
import type { Gen, Instance, Level } from '@/lib/items/types'
import { BASE, CUBE_ITEM_LEVEL, CUBE_LEVELS, CUBE_PRACTICE_SEED, WAVE_GROUP, waveAI, type CubeLevel } from '../tiling'
import type { BandResult } from './types'

/**
 * The Tiling Cube's practice band (docs/specs/wave-3.md §6.3, task 3a-13). The practice instances are each level's
 * opening item on the pinned practice seed: `roofline/tile-ai` for level 1, the `tiling` variant for levels 2–6, at
 * the play's item level. The band holds when:
 *   1. every practice instance is gradable: its true answer and its solution's result both grade right;
 *   2. every diagnosis that applies to it differs from the truth by more than the tolerance, so a learner who made
 *      that slip is told so, never marked right (and at least one applies, so the level has a slip to name);
 *   3. level 4's wave differs at least 3× between the row and the grouped raster, so raster order visibly matters.
 * It reads no file.
 */

/** Level 4's row and grouped rasters must differ at least this many times. */
export const MIN_RASTER_RATIO = 3

const FAMILIES: Record<CubeLevel['family'], Gen> = { roofline, tiling }

/** The opening item of a cube level on a seed. */
export function levelInstance(level: CubeLevel, seed: number, itemLevel: Level = CUBE_ITEM_LEVEL as Level): Instance {
  return FAMILIES[level.family].make(seed, itemLevel, level.variant)
}

export interface CubeBandCheck {
  /** level number → the problems found with its practice instance (empty when sound) */
  problems: Record<number, string[]>
  /** level 4's grouped intensity over its row-major one */
  rasterRatio: number
  inBand: boolean
}

/** The three rules on one seed's practice instances. */
export function checkCubeBand(seed: number): CubeBandCheck {
  const problems: Record<number, string[]> = {}
  let rasterRatio = 0
  for (const level of CUBE_LEVELS) {
    const gen = FAMILIES[level.family]
    const inst = levelInstance(level, seed)
    const out: string[] = []
    const a = inst.answer
    if (a.kind === 'choice') out.push('the item is not numeric')
    else {
      if (!gen.grade(inst, correctResponse(inst)).ok) out.push('its true answer does not grade right')
      const last = [...gen.solution(inst)].reverse().find((s) => s.result)?.result
      if (!last || !gen.grade(inst, { kind: 'numeric', value: last.value, unit: last.unit ?? a.unit }).ok) out.push('its solution does not grade right')
      let slips = 0
      for (const rule of gen.ratioRules) {
        const rho = ruleRatio(rule, inst)
        if (rho === null) continue
        slips++
        if (gen.grade(inst, { kind: 'numeric', value: a.truth * rho, unit: a.unit }).ok) out.push(`the slip ${rule.id} is within the tolerance of the truth`)
      }
      if (slips === 0) out.push('no diagnosis applies to it')
    }
    if (level.id === 'raster') {
      const p = inst.params
      const base = { ...BASE, tm: Number(p.tm), tn: Number(p.tn), m: Number(p.m), n: Number(p.n), dtype: p.dtype === 'fp8' ? ('fp8' as const) : BASE.dtype }
      // a row-major instance names no group height, so its grouped side is the cube's 11
      const group = Number(p.group ?? WAVE_GROUP)
      const row = waveAI({ ...base, raster: 'row', group })
      const grouped = waveAI({ ...base, raster: 'grouped', group })
      rasterRatio = grouped.ai / row.ai
      if (rasterRatio < MIN_RASTER_RATIO) out.push(`its rasters differ ${rasterRatio.toFixed(2)}×, under ${MIN_RASTER_RATIO}×`)
    }
    problems[level.n] = out
  }
  const inBand = Object.values(problems).every((p) => p.length === 0)
  return { problems, rasterRatio, inBand }
}

/** The mapping from a check to the band's `{ok, detail}`: every rule must hold. */
export function cubeBandResult(check: CubeBandCheck): BandResult {
  const bad = Object.entries(check.problems).filter(([, p]) => p.length > 0)
  if (check.inBand && bad.length === 0) {
    return { ok: true, detail: `practice seed ${CUBE_PRACTICE_SEED} is in band: six levels gradable, every slip outside the tolerance, rasters ${check.rasterRatio.toFixed(1)}× apart` }
  }
  return { ok: false, detail: `practice seed ${CUBE_PRACTICE_SEED} is outside the band: ${bad.map(([n, p]) => `level ${n}: ${p.join('; ')}`).join(' / ') || 'not in band'}` }
}

/** The Tiling Cube's practice band: the pinned practice seed's six items; it reads no file. */
export async function band(): Promise<BandResult> {
  return cubeBandResult(checkCubeBand(CUBE_PRACTICE_SEED))
}
