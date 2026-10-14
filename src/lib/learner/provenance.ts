/**
 * Provenance weights (V6; wave-3.md §12.1). How much a graded answer counts as evidence that the learner can do
 * the thing, read off the provenance its writer stamped on it:
 *
 * - `proved` and `unseen` are 1.0: a fresh seed nobody could have memorized, or a prediction of the learner's own
 *   module that it then confirmed (H4 v2);
 * - `lab-green`, `practice` and `assisted` are 0.3: the work happened, but on numbers met before, an authored item,
 *   or with the hint ladder's help;
 * - `field` and anything unknown are 0.
 *
 * The weight is applied at read time and never stored (ledger-v3 §4.4), so a later change of weights rewrites no
 * history. It feeds VRK₃₀ (vrk.ts) and competence statements (competence.ts); rings keep their binary rules.
 */

import type { LedgerEvent, Provenance } from '@/lib/ledger/types'

/** Full credit: the only weight VRK₃₀ and competence statements count. */
export const FULL_CREDIT = 1
/** The weight of work that happened on seen numbers, authored items or with help. */
export const PARTIAL_CREDIT = 0.3

const WEIGHTS: Readonly<Record<Provenance, number>> = {
  proved: FULL_CREDIT,
  unseen: FULL_CREDIT,
  'lab-green': PARTIAL_CREDIT,
  practice: PARTIAL_CREDIT,
  assisted: PARTIAL_CREDIT,
  field: 0,
}

/** The credit weight of a provenance; 0 for `field` and for anything the ledger does not know. */
export function creditOf(provenance: unknown): number {
  return typeof provenance === 'string' && Object.hasOwn(WEIGHTS, provenance) ? WEIGHTS[provenance as Provenance] : 0
}

/** The credit weight of an event, from its provenance; 0 for an event that carries none. */
export const creditOfEvent = (e: LedgerEvent): number => creditOf((e as { provenance?: unknown }).provenance)

/** Credited at full weight: `unseen` or `proved`. */
export const isCredited = (e: LedgerEvent): boolean => creditOfEvent(e) === FULL_CREDIT
