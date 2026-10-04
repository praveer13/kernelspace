import { stableStringify } from './stable'
import type { LedgerEvent, WorkingKey, WorkingRecord } from './types'

/** The mergeable part of a device's state: its events and working records. */
export interface Ledger {
  events: LedgerEvent[]
  working: WorkingRecord[]
}

/**
 * Canonical conflict rule (spec §4.8): of two records with the same id, keep the one whose
 * `stableStringify` is lexicographically smaller. A total order on content, so the rule
 * is commutative, associative and idempotent, and event merge is a join-semilattice.
 * `at` sorts first among the keys, so when only the times differ the earliest wins.
 */
export function canonicalEvent(a: LedgerEvent, b: LedgerEvent): LedgerEvent {
  if (a === b) return a
  return stableStringify(b) < stableStringify(a) ? b : a
}

/**
 * Working state is last-writer-wins (spec §5): later `at`, then larger `dev`, then the
 * larger canonical JSON. Total on content, so it is also a semilattice join.
 */
export function lwwWorking(a: WorkingRecord, b: WorkingRecord): WorkingRecord {
  if (a === b) return a
  if (a.at !== b.at) return a.at > b.at ? a : b
  if (a.dev !== b.dev) return a.dev > b.dev ? a : b
  return stableStringify(b) > stableStringify(a) ? b : a
}

/** Export order (spec §10.1): by (`at`, `id`). */
export function compareEvents(a: LedgerEvent, b: LedgerEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function compareWorking(a: WorkingRecord, b: WorkingRecord): number {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** Union by id with the canonical rule, in export order. */
export function mergeEvents(...lists: Iterable<LedgerEvent>[]): LedgerEvent[] {
  const byId = new Map<string, LedgerEvent>()
  for (const list of lists) {
    for (const e of list) {
      const prev = byId.get(e.id)
      byId.set(e.id, prev ? canonicalEvent(prev, e) : e)
    }
  }
  return [...byId.values()].sort(compareEvents)
}

/** Union by key with last-writer-wins, sorted by key. */
export function mergeWorking(...lists: Iterable<WorkingRecord>[]): WorkingRecord[] {
  const byKey = new Map<WorkingKey, WorkingRecord>()
  for (const list of lists) {
    for (const r of list) {
      const prev = byKey.get(r.key)
      byKey.set(r.key, prev ? lwwWorking(prev, r) : r)
    }
  }
  return [...byKey.values()].sort(compareWorking)
}

/**
 * Join of two ledgers. Commutative, associative and idempotent: the result depends only on
 * the two sets, and is normalised (de-duplicated, sorted), so equal ledgers serialise equally.
 */
export function mergeLedgers(a: Ledger, b: Ledger): Ledger {
  return { events: mergeEvents(a.events, b.events), working: mergeWorking(a.working, b.working) }
}

/** A ledger in normal form (what `mergeLedgers(l, l)` returns). */
export function normalizeLedger(l: Ledger): Ledger {
  return { events: mergeEvents(l.events), working: mergeWorking(l.working) }
}
