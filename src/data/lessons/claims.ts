/**
 * How a lesson module reads a claim (K0-Z2). Every page that lists lessons imports the lessons registry statically, so each
 * chunk the registry imports statically is named in the entry chunk's preload map, with its index again under every such
 * page. Imported statically from t1/fragmentation.ts, the claims registry, `claims/cite.ts` and `claims/lazy/kvpool.ts` grew
 * the entry by 109 raw bytes (K0-D14), which S5-D50 and wave-3.md D72 do not allow. Awaited here instead, they sit in
 * the lessons chunk's own preload map and the entry stays at its frozen count; a lesson's template literals still read
 * the registry's values when its module evaluates, so the page, the markdown export, llms.txt and the search index agree.
 *
 * A lesson imports its claim readers from this module, never from `@/data/claims` or a group under `claims/lazy/`;
 * a lazy group a lesson reads is added to the list below, once.
 */
const [{ claimNumber }, { claimCite, claimRelease }] = await Promise.all([
  import('@/data/claims'),
  import('@/data/claims/cite'),
  import('@/data/claims/lazy/kvpool'),
])

export { claimNumber, claimCite, claimRelease }
