/**
 * The per-tab outbox: write-ahead for the write-ahead log (spec §8.6, invariant I9).
 *
 * An action's events reach localStorage synchronously, here, before the asynchronous IndexedDB
 * commit, so a crash between the two loses nothing. Everything takes the storage as an argument
 * (`null` when localStorage throws on access), so tests use a Map-backed fake.
 *
 * Rules (§8.6):
 * - Every function is quota-safe: a throwing `setItem` is swallowed and reported as `false`.
 *   The action proceeds and the commit still happens.
 * - At boot the engine commits every outbox it finds, then calls `settleOutboxes`. A tab removes
 *   its own committed entries. A *foreign* key is deleted only when its `updatedAt` is over 24 h
 *   old, which guards against racing a live tab that is mid-commit.
 * - When IndexedDB is unavailable (§9.8) the outbox is the store: nothing removes entries, so it
 *   keeps growing until IndexedDB returns.
 *
 * Shape checks only: the engine validates events through `codec.ts` (§4.9) before committing.
 */

import { OUTBOX_PREFIX } from './names'
import { sameJson } from './memory-store'
import type { EventId, IsoInstant, KeyValueStorage, LedgerEvent, Outbox, WorkingRecord } from './types'

/** A foreign outbox older than this is abandoned (its tab is gone) and may be deleted after commit. */
export const OUTBOX_STALE_MS = 24 * 60 * 60 * 1000

export function outboxKey(tabId: string): string {
  return OUTBOX_PREFIX + tabId
}

function isOutbox(v: unknown): v is Outbox {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.tab === 'string' &&
    typeof o.updatedAt === 'string' &&
    Array.isArray(o.events) &&
    Array.isArray(o.working) &&
    o.events.every((e) => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string') &&
    o.working.every((w) => !!w && typeof w === 'object' && typeof (w as { key?: unknown }).key === 'string')
  )
}

/** Parse one raw outbox value; null when missing or malformed. */
export function parseOutbox(raw: string | null): Outbox | null {
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    return isOutbox(v) ? v : null
  } catch {
    return null
  }
}

/** Read one tab's outbox. Null when absent, malformed or storage is unavailable. */
export function readOutbox(storage: KeyValueStorage | null, tabId: string): Outbox | null {
  if (!storage) return null
  try {
    return parseOutbox(storage.getItem(outboxKey(tabId)))
  } catch {
    return null
  }
}

function write(storage: KeyValueStorage, key: string, outbox: Outbox): boolean {
  try {
    storage.setItem(key, JSON.stringify(outbox))
    return true
  } catch {
    return false
  }
}

/**
 * Add events and working records to this tab's outbox (synchronously, before the commit).
 * Events dedupe by id (the first copy stays); a working record replaces an earlier one for its key.
 * Returns false when the write did not happen (no storage, quota); callers carry on regardless.
 */
export function appendToOutbox(
  storage: KeyValueStorage | null,
  tabId: string,
  events: LedgerEvent[],
  working: WorkingRecord[],
  now: IsoInstant,
): boolean {
  if (!storage) return false
  if (events.length === 0 && working.length === 0) return true
  const current = readOutbox(storage, tabId)
  const evs = current ? [...current.events] : []
  const known = new Set<EventId>(evs.map((e) => e.id))
  for (const e of events) {
    if (known.has(e.id)) continue
    known.add(e.id)
    evs.push(e)
  }
  const byKey = new Map<string, WorkingRecord>((current?.working ?? []).map((w) => [w.key, w]))
  for (const w of working) byKey.set(w.key, w)
  return write(storage, outboxKey(tabId), { tab: tabId, updatedAt: now, events: evs, working: [...byKey.values()] })
}

/**
 * Remove what a commit just made durable from this tab's outbox; delete the key when it empties.
 * A working record is removed only if the outbox still holds exactly the committed value, so a
 * newer write that arrived during the commit stays queued.
 */
export function removeFromOutbox(
  storage: KeyValueStorage | null,
  tabId: string,
  committedEvents: LedgerEvent[],
  committedWorking: WorkingRecord[],
  now?: IsoInstant,
): void {
  if (!storage) return
  const key = outboxKey(tabId)
  const current = readOutbox(storage, tabId)
  if (!current) return
  const done = new Set<EventId>(committedEvents.map((e) => e.id))
  const committed = new Map<string, WorkingRecord>(committedWorking.map((w) => [w.key, w]))
  const events = current.events.filter((e) => !done.has(e.id))
  const working = current.working.filter((w) => {
    const c = committed.get(w.key)
    return !(c && sameJson(c, w))
  })
  try {
    if (events.length === 0 && working.length === 0) storage.removeItem(key)
    else write(storage, key, { tab: tabId, updatedAt: now ?? current.updatedAt, events, working })
  } catch {
    // Leaving the entries in place is safe: the next boot commits them again, and commits are idempotent.
  }
}

export interface FoundOutbox {
  /** The full storage key. */
  key: string
  /** Null when the value is malformed. */
  outbox: Outbox | null
  /** True for this tab's own key. */
  own: boolean
}

/** Every outbox key in storage, parsed. Malformed values come back with `outbox: null`. */
export function collectOutboxes(storage: KeyValueStorage | null, tabId: string): FoundOutbox[] {
  if (!storage) return []
  const found: FoundOutbox[] = []
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k !== null && k.startsWith(OUTBOX_PREFIX)) keys.push(k)
    }
    keys.sort()
    for (const key of keys) {
      found.push({ key, outbox: parseOutbox(storage.getItem(key)), own: key === outboxKey(tabId) })
    }
  } catch {
    // storage became unavailable mid-scan: report what we have
  }
  return found
}

/** Everything the engine should commit at boot: the union of all readable outboxes. */
export function pendingFrom(found: FoundOutbox[]): { events: LedgerEvent[]; working: WorkingRecord[] } {
  const events: LedgerEvent[] = []
  const working: WorkingRecord[] = []
  for (const f of found) {
    if (!f.outbox) continue
    events.push(...f.outbox.events)
    working.push(...f.outbox.working)
  }
  return { events, working }
}

/**
 * After the boot commit succeeded, clean up. Own key: remove the committed entries. Foreign keys:
 * delete only when `updatedAt` is more than 24 h before `nowMs` (or unreadable); a live tab keeps its own entries
 * and removes them itself. Malformed values are deleted (setItem is atomic, so they are corrupt,
 * never mid-write). Returns the keys it deleted.
 *
 * Call this only after a successful commit. If the commit failed or IndexedDB is unavailable,
 * skip it: the outbox is then the only copy.
 */
export function settleOutboxes(
  storage: KeyValueStorage | null,
  tabId: string,
  found: FoundOutbox[],
  nowMs: number,
): string[] {
  if (!storage) return []
  const deleted: string[] = []
  for (const f of found) {
    try {
      if (!f.outbox) {
        storage.removeItem(f.key)
        deleted.push(f.key)
      } else if (f.own) {
        removeFromOutbox(storage, tabId, f.outbox.events, f.outbox.working)
        if (storage.getItem(f.key) === null) deleted.push(f.key)
      } else {
        const age = nowMs - Date.parse(f.outbox.updatedAt)
        // An unparseable updatedAt (NaN) is corrupt, so it counts as stale rather than sticking forever.
        if (!(age <= OUTBOX_STALE_MS)) {
          storage.removeItem(f.key)
          deleted.push(f.key)
        }
      }
    } catch {
      // keep it; the next boot retries
    }
  }
  return deleted
}
