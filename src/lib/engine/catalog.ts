/**
 * The eight slots of your engine and the lab that fills each (docs/specs/wave-2.md §10.1).
 *
 * Pure data: no zustand, no wasm. `ENGINE_SLOTS` is keyed by the ledger's `EngineSlot` ids (the keys of
 * the working record `engine:slots`); the catalog adds the lab, the oldest lab version that can serve the
 * slot, and where Wave 2 wires the module in.
 */

import type { EngineSlot } from '@/lib/ledger/types'

/** Where a slot's module runs in Wave 2. `schematic` slots only appear on the engine schematic (§10.4). */
export type SlotWiring = 'token-count' | 'prefix-router' | 'intake' | 'scheduler' | 'block-manager' | 'schematic'

export interface SlotSpec {
  slot: EngineSlot
  /** Plain name, as the schematic and the refusals say it. */
  label: string
  /** The Forge lab (`src/data/labs.ts`) whose module fills the slot. */
  lab: string
  /** The lab's number in the Forge (01-08). */
  labNo: number
  /**
   * The oldest `LAB.version` (the module's `list` reply) the slot accepts. Only radix-cache and bpe-tokenizer
   * gain verbs, so only they require the version that answers them (3); every other lab requires the version
   * it had when 2b-04 landed ("current", §10.1).
   */
  minVersion: number
  wiring: SlotWiring
  /** What the module does in Wave 2, one phrase. */
  wired: string
}

/** The slots in pipeline order (§10.4): the request path first, then the three that sit beside it. */
export const ENGINE_SLOT_ORDER: readonly EngineSlot[] = [
  'tokenizer',
  'prefix-router',
  'intake',
  'scheduler',
  'block-manager',
  'executor',
  'grammar',
  'allocator',
]

export const ENGINE_SLOTS: Readonly<Record<EngineSlot, SlotSpec>> = {
  tokenizer: { slot: 'tokenizer', label: 'tokenizer', lab: 'bpe-tokenizer', labNo: 3, minVersion: 3, wiring: 'token-count', wired: 'the token-count comparison' },
  'prefix-router': { slot: 'prefix-router', label: 'prefix router', lab: 'radix-cache', labNo: 7, minVersion: 3, wiring: 'prefix-router', wired: "the cluster's prefix router" },
  intake: { slot: 'intake', label: 'intake queue', lab: 'mpmc-queue', labNo: 4, minVersion: 2, wiring: 'intake', wired: 'the intake queue' },
  scheduler: { slot: 'scheduler', label: 'scheduler', lab: 'batching-scheduler', labNo: 6, minVersion: 3, wiring: 'scheduler', wired: 'the scheduler' },
  'block-manager': { slot: 'block-manager', label: 'block manager', lab: 'kv-block-manager', labNo: 2, minVersion: 3, wiring: 'block-manager', wired: 'the block manager' },
  executor: { slot: 'executor', label: 'executor', lab: 'toy-executor', labNo: 5, minVersion: 2, wiring: 'schematic', wired: 'the schematic only' },
  grammar: { slot: 'grammar', label: 'grammar', lab: 'xgrammar-lite', labNo: 8, minVersion: 2, wiring: 'schematic', wired: 'the schematic only' },
  allocator: { slot: 'allocator', label: 'allocator', lab: 'rust-allocator', labNo: 1, minVersion: 2, wiring: 'schematic', wired: 'the schematic only' },
}

/** The slot a lab's module fills, or undefined for a lab that is not part of your engine (the Rust Zero labs). */
export function slotForLab(labId: string): EngineSlot | undefined {
  return ENGINE_SLOT_ORDER.find((s) => ENGINE_SLOTS[s].lab === labId)
}
