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
 * - A cleared working record (D50, "Clear my pick") leaves a tombstone, `{ key, at }`, in `cleared`. The clear strips
 *   the key's records written at or before it from every outbox and writes the tombstone to this tab's, synchronously,
 *   so a page that unloads before the IndexedDB delete still clears. Boot applies every outbox's tombstones by `at`: a
 *   tombstone beats a record written at or before it, in any outbox or in the store, and a later write beats the
 *   tombstone. A tombstone stays with its outbox (applying it again changes nothing) until a later write of the key in
 *   the same tab, an import or undo that writes the key, a reset, or the 24 h rule removes it.
 *
 * Shape checks only: the engine validates events through `codec.ts` (§4.9) before committing.
 */

import { OUTBOX_PREFIX } from './names'
import { sameJson } from './stable'
import { isIsoInstant } from './time'
import type { EventId, IsoInstant, KeyValueStorage, LedgerEvent, Outbox, WorkingKey, WorkingRecord } from './types'

/** A foreign outbox older than this is abandoned (its tab is gone) and may be deleted after commit. */
export const OUTBOX_STALE_MS = 24 * 60 * 60 * 1000

export function outboxKey(tabId: string): string {
  return OUTBOX_PREFIX + tabId
}

/** A tombstone: `key` was cleared at `at`. */
export interface Cleared {
  key: WorkingKey
  at: IsoInstant
}

/** An outbox as this bundle writes it: `Outbox` plus the tombstones of cleared working records (older bundles ignore them). */
export interface TabOutbox extends Outbox {
  cleared?: Cleared[]
}

const isCleared = (c: unknown): c is Cleared =>
  !!c && typeof c === 'object' && typeof (c as { key?: unknown }).key === 'string' && isIsoInstant((c as { at?: unknown }).at)

/** True when a tombstone for `w.key` is at or after `w.at`: the record was written before the clear, so it stays cleared. */
export function clearedBy(cleared: ReadonlyMap<WorkingKey, IsoInstant>, w: WorkingRecord): boolean {
  const at = cleared.get(w.key)
  return at !== undefined && w.at <= at
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

/** An outbox value, with `cleared` only when it holds a tombstone. */
function shape(tab: string, updatedAt: IsoInstant, events: LedgerEvent[], working: WorkingRecord[], cleared: Cleared[]): TabOutbox {
  return cleared.length > 0 ? { tab, updatedAt, events, working, cleared } : { tab, updatedAt, events, working }
}

const isEmpty = (o: TabOutbox): boolean => o.events.length === 0 && o.working.length === 0 && !o.cleared?.length

/**
 * Parse one raw outbox value; null when missing or malformed. A malformed tombstone is dropped rather than failing the
 * outbox, so a bad `cleared` entry never costs the events beside it.
 */
export function parseOutbox(raw: string | null): TabOutbox | null {
  if (raw === null) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (!isOutbox(v)) return null
    const o = v as TabOutbox
    if (o.cleared === undefined) return o
    return shape(o.tab, o.updatedAt, o.events, o.working, Array.isArray(o.cleared) ? o.cleared.filter(isCleared) : [])
  } catch {
    return null
  }
}

/** Read one tab's outbox. Null when absent, malformed or storage is unavailable. */
export function readOutbox(storage: KeyValueStorage | null, tabId: string): TabOutbox | null {
  if (!storage) return null
  try {
    return parseOutbox(storage.getItem(outboxKey(tabId)))
  } catch {
    return null
  }
}

function write(storage: KeyValueStorage, key: string, outbox: TabOutbox): boolean {
  try {
    storage.setItem(key, JSON.stringify(outbox))
    return true
  } catch {
    return false
  }
}

/** Write `outbox` under `key`, or remove the key when it holds nothing. */
function put(storage: KeyValueStorage, key: string, outbox: TabOutbox): boolean {
  if (!isEmpty(outbox)) return write(storage, key, outbox)
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * Add events and working records to this tab's outbox (synchronously, before the commit).
 * Events dedupe by id (the first copy stays); a working record replaces an earlier one for its key and drops this tab's
 * tombstone for that key: in this tab's own order the write came after the clear, so it wins even in the same millisecond.
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
  const written = new Set<string>(working.map((w) => w.key))
  const cleared = (current?.cleared ?? []).filter((c) => !written.has(c.key))
  return write(storage, outboxKey(tabId), shape(tabId, now, evs, [...byKey.values()], cleared))
}

/**
 * "Clear my pick" (D50), synchronously: strip `key`'s records written at or before `at` from every outbox, and write the
 * tombstone `{ key, at }` to this tab's. Every page load has a new tab id, so an outbox that a page left behind when it
 * unloaded before its IndexedDB commit belongs to no later page; without the strip its record would come back at every
 * boot for 24 h. A foreign outbox keeps its `updatedAt`, so the 24 h rule still counts from its own last write.
 * Returns false when this tab's tombstone could not be written (no storage, quota).
 */
export function clearInOutboxes(storage: KeyValueStorage | null, tabId: string, key: WorkingKey, at: IsoInstant): boolean {
  if (!storage) return false
  const keep = (w: WorkingRecord) => !(w.key === key && w.at <= at)
  for (const f of collectOutboxes(storage, tabId)) {
    const o = f.outbox
    if (f.own || !o || o.working.every(keep)) continue
    put(storage, f.key, shape(o.tab, o.updatedAt, o.events, o.working.filter(keep), o.cleared ?? []))
  }
  const current = readOutbox(storage, tabId)
  const cleared = [...(current?.cleared ?? []).filter((c) => c.key !== key), { key, at }]
  return write(storage, outboxKey(tabId), shape(tabId, at, current?.events ?? [], (current?.working ?? []).filter(keep), cleared))
}

/** Drop the tombstones of `keys` from every outbox: an import or an undo writes those keys anew, so an earlier clear no longer applies. */
export function dropCleared(storage: KeyValueStorage | null, tabId: string, keys: Iterable<WorkingKey>): void {
  if (!storage) return
  const drop = new Set<WorkingKey>(keys)
  if (drop.size === 0) return
  for (const f of collectOutboxes(storage, tabId)) {
    const o = f.outbox
    if (!o?.cleared?.some((c) => drop.has(c.key))) continue
    put(storage, f.key, shape(o.tab, o.updatedAt, o.events, o.working, o.cleared.filter((c) => !drop.has(c.key))))
  }
}

/**
 * Remove what a commit just made durable from this tab's outbox; delete the key when it empties.
 * A working record is removed only if the outbox still holds exactly the committed value, so a
 * newer write that arrived during the commit stays queued. Tombstones stay.
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
  // A failed write leaves the entries in place, which is safe: the next boot commits them again, and commits are idempotent.
  put(storage, key, shape(tabId, now ?? current.updatedAt, events, working, current.cleared ?? []))
}

export interface FoundOutbox {
  /** The full storage key. */
  key: string
  /** Null when the value is malformed. */
  outbox: TabOutbox | null
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

/**
 * Everything the engine should commit at boot: the union of all readable outboxes less the working records that a
 * tombstone clears, and the latest tombstone per key (which boot also applies to the store).
 */
export function pendingFrom(found: FoundOutbox[]): {
  events: LedgerEvent[]
  working: WorkingRecord[]
  cleared: Map<WorkingKey, IsoInstant>
} {
  const events: LedgerEvent[] = []
  const working: WorkingRecord[] = []
  const cleared = new Map<WorkingKey, IsoInstant>()
  for (const f of found) {
    if (!f.outbox) continue
    events.push(...f.outbox.events)
    working.push(...f.outbox.working)
    for (const c of f.outbox.cleared ?? []) {
      const prev = cleared.get(c.key)
      if (prev === undefined || c.at > prev) cleared.set(c.key, c.at)
    }
  }
  return { events, working: working.filter((w) => !clearedBy(cleared, w)), cleared }
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
