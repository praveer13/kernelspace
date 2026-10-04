/**
 * Schema guard (spec §9.3, invariant I6): when does a bundle stop writing?
 *
 * Pure checks that take the bundle's own `SCHEMA_VERSION` as an argument, so this module
 * imports nothing from L1. Each check returns the `ReadOnlyReason` or null:
 *
 * 1. `newer-schema`   meta `schema.version` in IndexedDB is newer than this bundle's;
 * 2. `newer-idb`      the database open failed with `VersionError` (the store reports it);
 * 3. `versionchange`  this bundle's connection received `versionchange`;
 * 4. `snapshot-newer` the `kernelspace:v2` snapshot's `schemaVersion` is newer;
 * 5. `newer-schema`   a channel message announces a newer `schemaVersion` (the spec's `hello`;
 *                     any message from a newer bundle counts, since its events may not be readable).
 *
 * `createGuard` adds a latch: once read-only, a bundle stays read-only until reload.
 */

import type { ChannelMessage, ReadOnlyReason, StoreInfo } from './types'

function isNewer(candidate: unknown, bundle: number): boolean {
  return typeof candidate === 'number' && Number.isFinite(candidate) && candidate > bundle
}

/** Reasons 1 and 2: what `store.open()` reported. */
export function checkStoreInfo(bundleSchema: number, info: StoreInfo): ReadOnlyReason | null {
  if (info.readOnly) return info.reason ?? 'newer-idb'
  if (isNewer(info.schemaVersion, bundleSchema)) return 'newer-schema'
  return null
}

/** Reason 4, from the parsed snapshot (any shape; a corrupt snapshot is ignored, §9.8). */
export function checkSnapshot(bundleSchema: number, snapshot: unknown): ReadOnlyReason | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  return isNewer((snapshot as { schemaVersion?: unknown }).schemaVersion, bundleSchema) ? 'snapshot-newer' : null
}

/** Reason 4 from the raw localStorage string. Unparseable input is not a reason. */
export function checkSnapshotRaw(bundleSchema: number, raw: string | null): ReadOnlyReason | null {
  if (raw === null) return null
  try {
    return checkSnapshot(bundleSchema, JSON.parse(raw))
  } catch {
    return null
  }
}

/** Reason 5: a channel message from a newer bundle. */
export function checkMessage(bundleSchema: number, message: Pick<ChannelMessage, 'schemaVersion'>): ReadOnlyReason | null {
  return isNewer(message.schemaVersion, bundleSchema) ? 'newer-schema' : null
}

/** Reason 3 is unconditional: the event itself is the evidence. */
export function checkVersionChange(): ReadOnlyReason {
  return 'versionchange'
}

export interface Guard {
  readonly readOnly: boolean
  readonly reason: ReadOnlyReason | undefined
  /** Each of these returns true when this call latched read-only or it already was. */
  storeInfo(info: StoreInfo): boolean
  snapshot(snapshot: unknown): boolean
  snapshotRaw(raw: string | null): boolean
  message(message: Pick<ChannelMessage, 'schemaVersion'>): boolean
  versionChange(): boolean
}

/**
 * A latch over the checks. The first reason sticks; `onReadOnly` fires once, when it latches.
 * Reload is the only way out, which matches §8.7 ("Reload to keep saving").
 */
export function createGuard(bundleSchema: number, onReadOnly?: (reason: ReadOnlyReason) => void): Guard {
  let latched: ReadOnlyReason | undefined
  const apply = (reason: ReadOnlyReason | null): boolean => {
    if (reason && !latched) {
      latched = reason
      onReadOnly?.(reason)
    }
    return latched !== undefined
  }
  return {
    get readOnly() {
      return latched !== undefined
    },
    get reason() {
      return latched
    },
    storeInfo: (info) => apply(checkStoreInfo(bundleSchema, info)),
    snapshot: (snapshot) => apply(checkSnapshot(bundleSchema, snapshot)),
    snapshotRaw: (raw) => apply(checkSnapshotRaw(bundleSchema, raw)),
    message: (message) => apply(checkMessage(bundleSchema, message)),
    versionChange: () => apply(checkVersionChange()),
  }
}
