/**
 * Items are on-KC: the one redraw that Today (`makeInstance`), tickets and the placement walk (`makeGenPool`)
 * share, so every generated item a pool serves for a KC carries that KC.
 *
 * `Gen.make(seed, level, variant)` takes no KC. Most families pin their KCs per variant, but not all of them: a
 * `sig` instance carries `t7.incident-diagnosis` plus the KC of the fault its seed drew, so a pool serving
 * `t2.admission-scheduling` gets another fault three times in four. Some variants also teach a KC only at some
 * levels (kv's `t5.gqa-kv-heads` and memory's `t4.quantized-bytes` only at level 3). So the pool tries the seed
 * it was given first, then `hash32('<seed>:<kc>:<k>')` for k = 1 … `ON_KC_DRAWS - 1`, and keeps the first
 * instance whose `kcs` include the KC. When none does, it serves nothing, and the caller moves on to the KC's
 * other families and then its authored items: never an off-KC item.
 *
 * The first draw is the seed itself, so a family whose instance always carries the KC it is served for makes
 * exactly the instance it made before (same seed, same variant, same numbers). The redraw is pure: the same
 * (seed, KC) gives the same instance, and the instance's own `seed` is the one that made it, so the ledger
 * replays it. A `make` that throws is not a draw that missed: the error propagates unchanged.
 */

import type { Instance } from '@/lib/items/types'
import type { KcId } from '@/lib/kc/types'
import { hash32 } from '@/lib/rng'

/** Seeds tried per (family, KC, level) before the pool gives up on the family. With a 1-in-4 fault draw, about 1 % fall back. */
export const ON_KC_DRAWS = 16

/** The `k`-th seed of the redraw for `kc`: the seed itself first, then a hash of the seed, the KC and `k`. */
export function onKcSeed(seed: number, kc: KcId, k: number): number {
  return k === 0 ? seed : hash32(`${seed >>> 0}:${kc}:${k}`)
}

/**
 * The first instance `make` returns over the redraw seeds that carries `kc`, or null when no draw in `draws`
 * does (or `make` serves nothing). `make` picks the variant and calls `Gen.make` on the seed it is handed.
 */
export function drawOnKc(kc: KcId, seed: number, make: (seed: number) => Instance | null, draws: number = ON_KC_DRAWS): Instance | null {
  for (let k = 0; k < draws; k++) {
    const inst = make(onKcSeed(seed, kc, k))
    if (inst === null) return null
    if (inst.kcs.includes(kc)) return inst
  }
  return null
}
