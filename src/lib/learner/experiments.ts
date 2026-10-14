/**
 * Within-learner randomization (docs/specs/wave-2.md §14.4, PLAN-100X §9): which kind of help a learner gets for one
 * check is decided by a coin that is fixed by the experiment's name, the unit and the learner's own seed, so it is the
 * same on every visit and needs no server.
 *
 * `exp:seed` is a working record (a uint32), created once on first use. Analysis never recomputes an arm: it reads
 * the arm recorded on the hint and packet acks (`data.arm`), so a second device that created its own seed before the
 * ledgers synced cannot corrupt the data. Pure: no clock, no randomness (the seed's source arrives as a parameter).
 *
 * `armOf` is the same coin for n arms: the track forms (forms.ts, wave-3.md §12.6) use it with 6 to pick which of three
 * seed sets is form A, B or C, and `armFor` is `armOf` with 2.
 */

import { hash32 } from '@/lib/rng'

export type Arm = 'ladder' | 'packet'

/** The hint-ladder experiment (docs/prereg/hint-ladders.md): ladder-first help against packet-only help, per check. */
export const HINT_EXPERIMENT = 'hint-ladders'

/** Labs 01 to 03 are randomized. Every other lab keeps the full ladder and records no arm. */
export const RANDOMIZED_LABS: readonly string[] = ['rust-allocator', 'kv-block-manager', 'bpe-tokenizer']

/** MurmurHash3's 32-bit finalizer: every input bit changes every output bit with probability near one half. */
function fmix32(h: number): number {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The arm of `unit` in `experiment`, one of `n` (a whole number, 1 or more) for the learner whose `exp:seed` is
 * `expSeed`: `fmix32(hash32(experiment + ':' + unit + ':' + expSeed)) % n`, so 0 to n - 1. FNV-1a's lowest bit is only
 * the parity of the number of bytes whose low bit is 1, so `hash32(...) % 2` would give every learner the same arm for
 * the same unit up to one global flip, and the arm would be confounded with the check; `fmix32` first makes every bit
 * of the 32 a fair coin. The remainder by n is unbiased to within n / 2^32 (6 / 2^32 for the track forms' six orders).
 */
export function armOf(experiment: string, unit: string, expSeed: number, n: number): number {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`armOf: n must be a whole number of 1 or more, not ${n}`)
  return fmix32(hash32(`${experiment}:${unit}:${expSeed}`)) % n
}

/**
 * The ladder-or-packet arm of `unit` in `experiment` for the learner whose `exp:seed` is `expSeed`: `armOf` with two
 * arms, 0 the ladder and 1 the packet. Generalizing to n arms left every hint-ladder arm as it was (the pinned values in
 * tests/mentor/experiments.test.ts).
 */
export function armFor(experiment: string, unit: string, expSeed: number): Arm {
  return armOf(experiment, unit, expSeed, 2) === 0 ? 'ladder' : 'packet'
}

/** The unit of the hint experiment: one check of one lab. */
export const hintUnit = (labId: string, checkId: string): string => `${labId}/${checkId}`

export const isRandomizedLab = (labId: string): boolean => RANDOMIZED_LABS.includes(labId)

/** The arm of one check of a randomized lab, or undefined (no seed yet, or a lab that is not randomized). */
export function hintArm(labId: string, checkId: string, expSeed: number | undefined): Arm | undefined {
  if (expSeed === undefined || !isRandomizedLab(labId)) return undefined
  return armFor(HINT_EXPERIMENT, hintUnit(labId, checkId), expSeed)
}

/** A stored `exp:seed` if it is a uint32, else undefined. */
export function readExpSeed(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : undefined
}

/** A fresh seed from `rand`, which returns a number in [0, 1). */
export const newExpSeed = (rand: () => number): number => Math.floor(rand() * 0x100000000) >>> 0

/** The slice of the progress store `ensureExpSeed` needs. */
export interface SeedStore {
  ledger: { ready: boolean; readOnly: boolean }
  working: Partial<Record<'exp:seed', unknown>>
  setWorking(key: 'exp:seed', value: number): void
}

/**
 * Create `exp:seed` once. It waits for the ledger to finish loading (a seed made from the first-paint snapshot could
 * replace the one IndexedDB holds) and does nothing in a read-only tab. Safe to call from several components.
 */
export function ensureExpSeed(state: SeedStore, rand: () => number): void {
  if (!state.ledger.ready || state.ledger.readOnly) return
  if (readExpSeed(state.working['exp:seed']) !== undefined) return
  state.setWorking('exp:seed', newExpSeed(rand))
}
