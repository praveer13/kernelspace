/**
 * The lazy groups' address book, for the code that loads them on purpose: tooling, tests and the consumers of a
 * group (spec wave-3 §4.4). The eager `index.ts` does not import it (D19: the claims chunk /boot and /today load does
 * not grow), so `getClaim`'s unknown-id error points here instead of naming the group.
 */

/**
 * Where each lazy group lives: a claim id prefix to the module that holds it, relative to `src/data/claims/`.
 * `lazyGroupFor` reads it to name the group to import for an id that is not registered, since the group is not loaded
 * and `all.ts`, which imports every group, is not in the browser. Add a line with the group; tests/claims/lazy.test.ts
 * fails when a lazy claim's id has no line here or its line names another file.
 */
export const LAZY_GROUP_HOMES: Record<string, string> = {
  'hw.h100-sxm.sm': 'lazy/tiling',
  'hw.h100-sxm.l2': 'lazy/tiling',
  'hw.h100-sxm.reg': 'lazy/tiling',
  'hw.h100-sxm.fp8': 'lazy/tiling',
  'production.triton.': 'lazy/tiling',
  'model.deepseek-v3.routed': 'lazy/moe',
  'model.deepseek-v3.experts': 'lazy/moe',
  'production.eplb.': 'lazy/moe',
  'production.vllm.eplb': 'lazy/moe',
  'production.sglang.eplb': 'lazy/moe',
  'production.vllm.disagg': 'lazy/serving3',
  'production.sglang.disagg': 'lazy/serving3',
  'bench.checkpoint-engine.': 'lazy/serving3',
  'twin.': 'lazy/twins',
}

/** The module to import for an id that is not registered: the longest matching prefix of `LAZY_GROUP_HOMES`, or undefined. */
export function lazyGroupFor(id: string): string | undefined {
  let best: string | undefined
  for (const prefix of Object.keys(LAZY_GROUP_HOMES)) {
    if (id.startsWith(prefix) && (best === undefined || prefix.length > best.length)) best = prefix
  }
  return best === undefined ? undefined : LAZY_GROUP_HOMES[best]
}
