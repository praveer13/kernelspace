/**
 * Your installed modules as the Fleet reads them (docs/specs/wave-2.md §10.2). Pure and async-only through an
 * injected byte reader, so tests drive it with the memory store and the Fleet store (src/pages/fleet/slots.ts)
 * drives it with the ledger engine.
 *
 * The working record `engine:slots` says which hash fills each slot; the bytes live in the `components` store,
 * so a slot whose bytes are not on this device (an import without bytes) reads as `bytes: null`.
 */

import { ENGINE_SLOTS as ALL_SLOTS } from '@/lib/ledger/constants'
import type { ComponentMeta, EngineSlot, EngineSlotEntry, EngineSlots, Json } from '@/lib/ledger/types'

/** The three slots the Fleet panels drive today (their upload buttons). */
export type LabKind = 'sched' | 'mgr' | 'queue'

export const KIND_SLOT: Readonly<Record<LabKind, EngineSlot>> = { sched: 'scheduler', mgr: 'block-manager', queue: 'intake' }

export interface InstalledModule extends EngineSlotEntry {
  slot: EngineSlot
  /** The file name the learner dropped, from the component's metadata. */
  name?: string
  /** Null while loading, or when the hash is known but its bytes are not on this device. */
  bytes: ArrayBuffer | null
}

export type InstalledSlots = Partial<Record<EngineSlot, InstalledModule>>

const SLOT_IDS: readonly string[] = ALL_SLOTS
const HEX64 = /^[0-9a-f]{64}$/

/** The slot map a working value holds. Entries the codec would reject read as empty slots. */
export function readSlots(value: Json | undefined): EngineSlots {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Record<string, EngineSlotEntry> = {}
  for (const [slot, e] of Object.entries(value)) {
    if (!SLOT_IDS.includes(slot) || typeof e !== 'object' || e === null || Array.isArray(e)) continue
    const { sha256, labId, version, at } = e as Record<string, Json>
    if (typeof sha256 !== 'string' || !HEX64.test(sha256) || typeof labId !== 'string' || labId === '') continue
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || typeof at !== 'string') continue
    out[slot] = { sha256, labId, version, at }
  }
  return out as EngineSlots
}

/** Two slot maps name the same modules (hash, lab, version and instant per slot). */
export function sameSlots(a: EngineSlots, b: EngineSlots): boolean {
  return JSON.stringify(ALL_SLOTS.map((s) => a[s] ?? null)) === JSON.stringify(ALL_SLOTS.map((s) => b[s] ?? null))
}

export interface LoadSources {
  /** One hash's bytes, or null when the store holds only its metadata. */
  readBytes(sha256: string): Promise<ArrayBuffer | null>
  /** Metadata of the stored components, for file names. */
  readMeta?(): Promise<ComponentMeta[]>
  /** Bytes already read, by hash. `loadInstalled` adds what it reads. */
  cache?: Map<string, ArrayBuffer>
}

/** Resolves every filled slot to its bytes. Never calls a source when no slot is filled. */
export async function loadInstalled(slots: EngineSlots, src: LoadSources): Promise<InstalledSlots> {
  const filled = ALL_SLOTS.filter((s) => slots[s] !== undefined)
  if (filled.length === 0) return {}
  const names = new Map((await src.readMeta?.())?.map((m) => [m.sha256, m.name]) ?? [])
  const hashes = [...new Set(filled.map((s) => slots[s]!.sha256))]
  const bytes = new Map<string, ArrayBuffer | null>()
  await Promise.all(
    hashes.map(async (h) => {
      const hit = src.cache?.get(h)
      if (hit) return bytes.set(h, hit)
      const read = await src.readBytes(h)
      if (read) src.cache?.set(h, read)
      bytes.set(h, read)
    }),
  )
  const out: InstalledSlots = {}
  for (const slot of filled) {
    const e = slots[slot]!
    const name = names.get(e.sha256)
    out[slot] = { ...e, slot, bytes: bytes.get(e.sha256) ?? null, ...(name === undefined ? {} : { name }) }
  }
  return out
}
