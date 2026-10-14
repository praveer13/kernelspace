/**
 * The full claims registry for tooling (spec wave-3 §4.4): the eager groups of `index.ts` plus every group under
 * `lazy/`, each of which registers itself when imported, and the registration and homes modules that only lazy
 * consumers, tooling and tests load (`registry.ts`, `homes.ts`; the eager chunk carries neither, D19). verify-claims,
 * verify-search-index, the /freshness claims table, the search-index builder and public/claims.json read this file.
 * Nothing /boot or /today reaches may import it (tests/claims/lazy.test.ts walks their static imports); app code
 * imports `index.ts` and the lazy group it needs. A new file under `lazy/` needs an `import` line below and a line in
 * `homes.ts`, and the test fails when either is missing.
 */
export * from './index'
export * from './homes'
export * from './registry'
import './lazy/moe'
import './lazy/serving3'
import './lazy/tiling'
import './lazy/twins'
