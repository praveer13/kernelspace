/**
 * The full claims registry for tooling (spec wave-3 §4.4): the eager groups of `index.ts` plus every group under
 * `lazy/`, each of which registers itself when imported. verify-claims, verify-search-index, the /freshness claims
 * table, the search-index builder and public/claims.json read this file. Nothing /boot or /today reaches may import
 * it (tests/claims/lazy.test.ts walks their static imports); app code imports `index.ts` and the lazy group it needs.
 * A new file under `lazy/` is imported below, and the test fails when one is missing.
 */
export * from './index'
import './lazy/moe'
import './lazy/serving3'
import './lazy/tiling'
import './lazy/twins'
