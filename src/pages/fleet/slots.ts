/**
 * Shared upload-slot state for the Fleet and Fleet Week pages.
 * Slots hold the raw module BYTES, not instances: a wasm module's state
 * (FLEET_MANAGER etc.) is a singleton per instance, so every worker in a
 * cluster instantiates its own copy from the same bytes.
 */

import { create } from 'zustand'

export type LabKind = 'sched' | 'mgr' | 'queue'

export interface SlotModule {
  bytes: ArrayBuffer
  fileName: string
  lab: string
}

export type SlotState = Record<LabKind, SlotModule | null>

export const EMPTY_SLOTS: SlotState = { sched: null, mgr: null, queue: null }

export const SLOT_WANT_LAB: Record<LabKind, string> = {
  sched: 'batching-scheduler',
  mgr: 'kv-block-manager',
  queue: 'mpmc-queue',
}

export const SLOT_LABEL: Record<LabKind, string> = {
  sched: 'scheduler',
  mgr: 'block manager',
  queue: 'intake queue',
}

/** Shared across Fleet + Fleet Week: upload once, plug in everywhere. */
export const useSlots = create<{ slots: SlotState; setSlot: (k: LabKind, m: SlotModule | null) => void }>()(
  (set) => ({
    slots: EMPTY_SLOTS,
    setSlot: (k, m) => set((s) => ({ slots: { ...s.slots, [k]: m } })),
  }),
)
