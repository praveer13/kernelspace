/**
 * Storage names shared by the adapters, the outbox and the channel (docs/specs/ledger-v3.md §2, §3).
 * Constants only, so any module (including tests) can import it without pulling in the engine.
 *
 * Absent on purpose (Addendum A1, start fresh): the legacy `kernelspace:v1` key and the migration lock.
 * The v3 bundle never reads or writes either.
 */

export const DB_NAME = 'kernelspace'
/** Physical schema of the database. Bump only when stores or indexes change. */
export const IDB_VERSION = 1
/** Throwaway database used by `selfTestIdb()`. */
export const SELFTEST_DB_NAME = 'kernelspace-selftest'

export const STORE_EVENTS = 'events'
export const STORE_WORKING = 'working'
export const STORE_COMPONENTS = 'components'
export const STORE_META = 'meta'
export const STORE_CHECKPOINTS = 'checkpoints'

export const IDX_EVENTS_BY_AT = 'by_at'
export const IDX_EVENTS_BY_KIND_REF = 'by_kind_ref'
export const IDX_COMPONENTS_BY_LAB = 'by_lab'

/** Derived snapshot for first paint (spec §9.3). */
export const SNAPSHOT_KEY = 'kernelspace:v2'
/** Per-tab write-ahead log: `OUTBOX_PREFIX + tabId` (spec §8.6). */
export const OUTBOX_PREFIX = 'kernelspace:v2:outbox:'
export const CHANNEL_NAME = 'kernelspace:ledger'
