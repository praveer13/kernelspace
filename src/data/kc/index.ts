/**
 * The KC graph (docs/specs/wave-1.md §4 and wave-2.md §4; PLAN-100X V4): the 66 Wave 1 KCs over R, T0-T2 and
 * the T4/T5 KCs that Boot, the three generator families and the Wave 1 sims assess, plus the 31 Wave 2
 * contract KCs other PRs tag (task 2a-06). 2a-11 fills in the rest of T3-T7.
 *
 * Static content, CI-verified by `bun run verify:kc`. The learner model never stores KC state; it
 * derives it from the ledger through src/lib/kc/resolve.ts.
 */

import type { Kc, KcGraph, KcId } from '@/lib/kc/types'
import { R_KCS } from './r'
import { T0_KCS } from './t0'
import { T1_KCS } from './t1'
import { T2_KCS } from './t2'
import { T3_KCS } from './t3'
import { T4_KCS } from './t4'
import { T5_KCS } from './t5'
import { T6_KCS } from './t6'
import { T7_KCS } from './t7'
import { KC_MIGRATIONS } from './migrations'
import { NOTIONAL_MACHINES } from './notional'

export { KC, THRESHOLD_KCS, RUST_ANCHOR_KC, type ContractKcId } from './ids'
export { REF_KCS, BOOT_KCS } from './ref-map'
export { KC_MIGRATIONS } from './migrations'
export { NOTIONAL_MACHINES } from './notional'

/** Every KC, in track order (R, T0-T7), each track in lesson order. */
export const KCS: readonly Kc[] = [
  ...R_KCS,
  ...T0_KCS,
  ...T1_KCS,
  ...T2_KCS,
  ...T3_KCS,
  ...T4_KCS,
  ...T5_KCS,
  ...T6_KCS,
  ...T7_KCS,
]

export const KC_GRAPH: KcGraph = {
  version: 1,
  kcs: KCS,
  migrations: KC_MIGRATIONS,
  notional: NOTIONAL_MACHINES,
}

const byId = new Map<KcId, Kc>(KCS.map((k) => [k.id, k]))

/** The KC with this id, or undefined (ids are case-sensitive; migrate old ids first). */
export const kcById = (id: KcId): Kc | undefined => byId.get(id)
