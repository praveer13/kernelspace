/**
 * KCs for refs with no authored home (docs/specs/wave-1.md §4.5): rule 3 of the resolver (§4.6).
 *
 * Boot's graded steps have no QuizQuestion to carry `kcs`, so their tags live here, keyed by the
 * exact ref the step writes (`boot:<step>`, src/lib/boot/model.ts GRADED_STEPS).
 */

import type { KcId } from '@/lib/kc/types'
import { KC } from './ids'

export const REF_KCS: Readonly<Record<string, readonly KcId[]>> = Object.freeze({
  'boot:guess-1user': [KC.decodeBandwidth],
  'boot:faded-decode': [KC.decodeBandwidth],
  'boot:ridge': [KC.ridgePoint],
  'boot:kv-tokens': [KC.kvCapacity],
  'boot:why-batching': [KC.batchingThroughput],
})

/** Boot's four KCs: completing Boot earns their cards (origin `boot`, spec §6.2). */
export const BOOT_KCS: readonly KcId[] = [KC.decodeBandwidth, KC.ridgePoint, KC.kvCapacity, KC.batchingThroughput]
