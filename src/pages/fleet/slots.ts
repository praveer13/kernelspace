/**
 * Shared upload-slot state for the Fleet and Fleet Week pages.
 * Slots hold the raw module BYTES, not instances: a wasm module's state
 * (FLEET_MANAGER etc.) is a singleton per instance, so every worker in a
 * cluster instantiates its own copy from the same bytes.
 *
 * Your engine persists (docs/specs/wave-2.md §10.2): `install` puts a module that passed a fresh-seed run into
 * the ledger's `components` store and `engine:slots`, and the store reads both back after a reload and when
 * another tab or an import changes them. `setSlot` is still the session upload the Fleet's buttons use: it
 * overrides the installed module until the page closes and is never saved.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { ENGINE_SLOTS } from '@/lib/engine/catalog'
import { KIND_SLOT, loadInstalled, readSlots, sameSlots, type InstalledModule, type InstalledSlots, type LabKind } from '@/lib/engine/slots'
import { installModule, type InstallOutcome, type ModuleToInstall } from '@/lib/engine/store'
import type { EngineSlot } from '@/lib/ledger/types'
import { useProgress, type ProgressStore } from '@/lib/progress'

export type { LabKind }

export interface SlotModule {
  bytes: ArrayBuffer
  fileName: string
  lab: string
}

export type SlotState = Record<LabKind, SlotModule | null>

export const EMPTY_SLOTS: SlotState = { sched: null, mgr: null, queue: null }

export const SLOT_WANT_LAB: Record<LabKind, string> = {
  sched: ENGINE_SLOTS[KIND_SLOT.sched].lab,
  mgr: ENGINE_SLOTS[KIND_SLOT.mgr].lab,
  queue: ENGINE_SLOTS[KIND_SLOT.queue].lab,
}

export const SLOT_LABEL: Record<LabKind, string> = {
  sched: ENGINE_SLOTS[KIND_SLOT.sched].label,
  mgr: ENGINE_SLOTS[KIND_SLOT.mgr].label,
  queue: ENGINE_SLOTS[KIND_SLOT.queue].label,
}

export interface SlotsStoreState {
  /** What the Fleet panels run: the session upload of each kind, else the installed module (bytes loaded). */
  slots: SlotState
  /** Every installed module, all eight slots, with its bytes once they are read. */
  installed: InstalledSlots
  /** The session uploads (`setSlot`); never persisted. */
  session: SlotState
  /** True once the installed modules named by `engine:slots` have been read (immediately when none is named). */
  ready: boolean
  /** The session upload for `kind`; null clears it and uninstalls the module of that slot (the bytes stay in the store). */
  setSlot: (k: LabKind, m: SlotModule | null) => void
  /** Checks the run (§10.2) and installs. A refusal comes back as a message and changes nothing. */
  install: (m: ModuleToInstall) => Promise<InstallOutcome>
  /** Empties a slot. The bytes stay in the store: installing the same module again is instant. */
  remove: (slot: EngineSlot) => void
  /** Re-reads `engine:slots` and the bytes now (the store does this itself when the record changes). */
  refresh: () => Promise<void>
}

export type SlotsStore = UseBoundStore<StoreApi<SlotsStoreState>>

const fileNameOf = (m: InstalledModule): string => m.name ?? `${m.labId}.wasm`

/** Session uploads over installed modules, for the three kinds the panels drive. */
function viewOf(session: SlotState, installed: InstalledSlots): SlotState {
  const out: SlotState = { ...EMPTY_SLOTS }
  for (const kind of Object.keys(KIND_SLOT) as LabKind[]) {
    const own = installed[KIND_SLOT[kind]]
    out[kind] = session[kind] ?? (own?.bytes ? { bytes: own.bytes, fileName: fileNameOf(own), lab: own.labId } : null)
  }
  return out
}

/**
 * A slots store on one ledger façade. The app has one (`useSlots`); tests build their own on a tab of the
 * memory-store profile and "reload" by building another on a new tab.
 */
export function createSlotsStore(progress: ProgressStore): SlotsStore {
  const cache = new Map<string, ArrayBuffer>()
  let generation = 0

  const store = create<SlotsStoreState>()((set, get) => {
    const commit = (patch: Partial<Pick<SlotsStoreState, 'installed' | 'session' | 'ready'>>) =>
      set((s) => {
        const installed = patch.installed ?? s.installed
        const session = patch.session ?? s.session
        return { ...patch, slots: patch.installed || patch.session ? viewOf(session, installed) : s.slots }
      })

    const refresh = async (): Promise<void> => {
      const mine = ++generation
      const entries = readSlots(progress.getState().working['engine:slots'])
      if (Object.keys(entries).length === 0) {
        commit({ installed: {}, ready: true })
        return
      }
      try {
        const engine = await progress.controls.engine()
        const installed = await loadInstalled(entries, {
          readBytes: (sha) => engine.componentBytes(sha),
          readMeta: () => engine.components(),
          cache,
        })
        if (mine === generation) commit({ installed, ready: true })
      } catch {
        // the engine could not load: the slots stay as they were and the next record change tries again
        if (mine === generation) commit({ ready: true })
      }
    }

    return {
      slots: EMPTY_SLOTS,
      installed: {},
      session: EMPTY_SLOTS,
      ready: false,
      setSlot: (kind, m) => {
        commit({ session: { ...get().session, [kind]: m } })
        if (m === null) get().remove(KIND_SLOT[kind])
      },
      install: async (m) => {
        const outcome = await installModule(progress.getState(), m)
        if (outcome.ok) {
          cache.set(outcome.sha256, m.bytes instanceof Uint8Array ? m.bytes.slice().buffer : m.bytes)
          await refresh()
        }
        return outcome
      },
      remove: (slot) => {
        const had = readSlots(progress.getState().working['engine:slots'])[slot] !== undefined
        progress.getState().removeComponent(slot)
        if (had) void refresh()
      },
      refresh,
    }
  })

  // The record changes under us: another tab installed, a file was imported, the ledger was reset.
  let seen = readSlots(progress.getState().working['engine:slots'])
  progress.subscribe((s) => {
    const next = readSlots(s.working['engine:slots'])
    if (sameSlots(seen, next)) return
    seen = next
    void store.getState().refresh()
  })
  void store.getState().refresh()
  return store
}

/** Shared across Fleet + Fleet Week: upload once, plug in everywhere; installed modules survive a reload. */
export const useSlots = createSlotsStore(useProgress)
