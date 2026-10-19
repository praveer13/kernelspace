/**
 * The full claims registry for tooling (spec wave-3 §4.4): the eager groups of `index.ts` plus every group under
 * `lazy/`, each of which registers itself when imported, and the registration and homes modules that only lazy
 * consumers, tooling and tests load (`registry.ts`, `homes.ts`; the eager chunk carries neither, D19). verify-claims,
 * verify-search-index, the /freshness claims table, the search-index builder and public/claims.json read this file.
 * Nothing /boot or /today reaches may import it (tests/claims/lazy.test.ts walks their static imports); app code
 * imports `index.ts` and the lazy group it needs. A new file under `lazy/` needs an `import` line below, its list in
 * `ALL_CLAIMS` and a line in `homes.ts`, and the tests fail when any is missing.
 */
import { ENGINE_CLAIMS } from './engines'
import { HARDWARE_CLAIMS } from './hardware'
import { FIELD_CLAIMS } from './lazy/field'
import { IX_POINT_CLAIMS } from './lazy/ix-points'
import { MOE_CLAIMS } from './lazy/moe'
import { PHYSICS_CLAIMS } from './lazy/physics'
import { SERVING3_CLAIMS } from './lazy/serving3'
import { TILING_CLAIMS } from './lazy/tiling'
import { TWIN_CLAIMS } from './lazy/twins'
import { MODEL_CLAIMS } from './models'
import { PRICE_CLAIMS } from './prices'
import { PRODUCTION_CLAIMS } from './production'
import type { Claim } from './schema'
import { SERVING_CLAIMS } from './serving'
import { ZOO_CLAIMS } from './zoo'

export * from './index'
export * from './homes'
export * from './registry'

/** The eager groups, as `index.ts` lists them. */
const EAGER: readonly Claim[] = [...HARDWARE_CLAIMS, ...MODEL_CLAIMS, ...PRICE_CLAIMS, ...PRODUCTION_CLAIMS, ...ENGINE_CLAIMS, ...SERVING_CLAIMS, ...ZOO_CLAIMS]
/** The lazy groups, in the order they were added (a new group goes last, so the claims before it keep their place in claims.json). */
const LAZY: readonly Claim[] = [...MOE_CLAIMS, ...SERVING3_CLAIMS, ...TILING_CLAIMS, ...TWIN_CLAIMS, ...FIELD_CLAIMS, ...PHYSICS_CLAIMS, ...IX_POINT_CLAIMS]

/**
 * Every claim in one fixed order, the registry a fresh process builds: the eager groups, then each lazy group, with a
 * lazy claim an earlier group already holds skipped, as `registerClaims` skips it. The live `CLAIMS` lists the lazy
 * groups in the order they happened to register, which is whichever page, test file or script imported one first, so
 * anything written to disk or compared byte for byte (the search index, public/claims.json, the /freshness table)
 * reads this instead.
 */
export const ALL_CLAIMS: readonly Claim[] = (() => {
  const held = new Set(EAGER.map((c) => c.id))
  return [...EAGER, ...LAZY.filter((c) => !held.has(c.id) && Boolean(held.add(c.id)))]
})()
