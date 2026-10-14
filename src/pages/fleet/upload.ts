/**
 * The Fleet's upload flow as a store, apart from the page that draws it so a test can drive it (docs/specs/wave-2.md §10.2).
 *
 * A drop is admitted (loadable, bridge, right lab), graded on fresh seeds in the lab worker, then installed through the
 * slots store: it survives a reload. `checking` is the kind being graded (a second drop waits), `error` is the one plain
 * message a refused drop leaves.
 *
 * `off` is "reference drivers for this visit": the slots the panels run on the reference after a module stopped
 * responding. It is the page's own state and touches no stored data: `engine:slots` and the module bytes stay as they are,
 * so a reload (or `restoreMine`) brings the saved modules back. Uninstalling is a separate, explicit button.
 */

import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { runLab } from '@/lib/lab-worker'
import { KIND_SLOT, type InstalledSlots } from '@/lib/engine/slots'
import type { InstallOutcome, ModuleToInstall } from '@/lib/engine/store'
import type { LabRunReport } from '@/lib/forge/types'
import { validateModule } from './drivers'
import { EMPTY_SLOTS, SLOT_LABEL, SLOT_WANT_LAB, type LabKind, type SlotState } from './slots'

/** The slots (and the prefix router, which has no upload button) the panels run on the reference this visit. */
export type Off = Record<LabKind | 'router', boolean>

export const NONE_OFF: Off = { sched: false, mgr: false, queue: false, router: false }
export const ALL_OFF: Off = { sched: true, mgr: true, queue: true, router: true }

/** What a drop needs from outside: the admission check, the fresh-seed run and the install. */
export interface UploadDeps {
  validate(bytes: ArrayBuffer, wantLab: string): ReturnType<typeof validateModule>
  run(bytes: ArrayBuffer): Promise<LabRunReport>
  install(m: ModuleToInstall): Promise<InstallOutcome>
}

/** The part of a `File` the flow reads. */
export interface DroppedFile {
  name: string
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface UploadState {
  /** the kind being checked on fresh seeds */
  checking: LabKind | null
  /** why the last drop was refused, or null */
  error: string | null
  off: Off
  pick(kind: LabKind, file: DroppedFile): Promise<void>
  /** Run the panels on the reference drivers for the rest of this visit. Stored modules are not touched. */
  resetToReference(): void
  /** Run on the saved modules again. */
  restoreMine(): void
}

export type UploadStore = UseBoundStore<StoreApi<UploadState>>

export function createUploadStore(deps: UploadDeps): UploadStore {
  return create<UploadState>()((set, get) => ({
    checking: null,
    error: null,
    off: NONE_OFF,
    pick: async (kind, file) => {
      if (get().checking !== null) return
      set({ error: null, checking: kind })
      const refuse = (message: string) => set({ error: `${SLOT_LABEL[kind]}: ${message}` })
      try {
        const bytes = await file.arrayBuffer()
        const res = await deps.validate(bytes, SLOT_WANT_LAB[kind])
        if (!res.ok) return refuse(`${res.title} — ${res.detail}`)
        const report = await deps.run(bytes)
        const out = await deps.install({ slot: KIND_SLOT[kind], report, bytes, name: file.name })
        if (!out.ok) return refuse(`${out.message}${out.detail ? ` — ${out.detail}` : ''}`)
        // the module the learner just brought is theirs to run, even after a reset to the reference
        set((s) => ({ off: { ...s.off, [kind]: false } }))
      } catch (e) {
        refuse(e instanceof Error ? e.message : String(e))
      } finally {
        set({ checking: null })
      }
    },
    resetToReference: () => set({ off: ALL_OFF, error: null }),
    restoreMine: () => set({ off: NONE_OFF }),
  }))
}

/** The drops the app makes: the lab worker's admission check, a fresh-seed run, and the slots store's install. */
export const realUploadDeps = (install: UploadDeps['install'], grade: typeof runLab = runLab): UploadDeps => ({
  validate: validateModule,
  run: (bytes) => grade(bytes, { seeds: 'fresh' }),
  install,
})

/** What the panels run: the slots, less the ones switched to the reference for this visit. */
export function panelSlots(slots: SlotState, off: Off): SlotState {
  return {
    sched: off.sched ? EMPTY_SLOTS.sched : slots.sched,
    mgr: off.mgr ? EMPTY_SLOTS.mgr : slots.mgr,
    queue: off.queue ? EMPTY_SLOTS.queue : slots.queue,
  }
}

/** How many saved modules the panels are not running this visit: the slots switched to the reference that hold one. */
export function parkedCount(saved: SlotState, installed: InstalledSlots, off: Off): number {
  return (['sched', 'mgr', 'queue'] as const).filter((k) => off[k] && saved[k] !== null).length + (off.router && installed['prefix-router'] ? 1 : 0)
}
