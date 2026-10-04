/**
 * MemoryStore: the reference `LedgerStore` (spec §7). It backs the tests and the engine's
 * in-memory fallback. Every read and write goes through `structuredClone`, so a caller that
 * keeps a reference to something it stored (or got back) cannot change the store behind its back.
 *
 * No merge policy lives here: conflicts are settled by the injected `ConflictResolvers`.
 */

import { sameJson } from './stable'
import type {
  Checkpoint,
  CommitResult,
  ComponentMeta,
  ComponentRecord,
  ConflictResolvers,
  EventId,
  LedgerEvent,
  LedgerStore,
  MetaKey,
  MetaRecords,
  StoreContents,
  StoreInfo,
  StoreTx,
  WorkingKey,
  WorkingRecord,
} from './types'

/** A component record without its bytes. */
export function componentMeta(rec: ComponentRecord): ComponentMeta {
  const meta: ComponentRecord = { ...rec }
  delete meta.bytes
  return meta
}

export interface MemoryStoreSeed {
  events?: LedgerEvent[]
  working?: WorkingRecord[]
  components?: ComponentRecord[]
  meta?: Partial<MetaRecords>
  checkpoint?: Checkpoint
}

interface Data {
  events: Map<EventId, LedgerEvent>
  working: Map<WorkingKey, WorkingRecord>
  components: Map<string, ComponentRecord>
  meta: Map<MetaKey, unknown>
  checkpoint: Checkpoint | undefined
}

export class MemoryStore implements LedgerStore {
  readonly backend = 'memory' as const
  private data: Data
  private listeners = new Set<() => void>()
  private closed = false

  constructor(seed: MemoryStoreSeed = {}) {
    this.data = {
      events: new Map((seed.events ?? []).map((e) => [e.id, structuredClone(e)])),
      working: new Map((seed.working ?? []).map((w) => [w.key, structuredClone(w)])),
      components: new Map((seed.components ?? []).map((c) => [c.sha256, structuredClone(c)])),
      meta: new Map(
        (Object.entries(seed.meta ?? {}) as [MetaKey, unknown][]).map(([k, v]) => [k, structuredClone(v)]),
      ),
      checkpoint: seed.checkpoint ? structuredClone(seed.checkpoint) : undefined,
    }
  }

  async open(): Promise<StoreInfo> {
    this.closed = false
    const schema = this.data.meta.get('schema') as MetaRecords['schema'] | undefined
    return { backend: 'memory', schemaVersion: schema ? schema.version : null, readOnly: false }
  }

  async readAll(): Promise<StoreContents> {
    const meta: Partial<MetaRecords> = {}
    for (const [k, v] of this.data.meta) (meta as Record<string, unknown>)[k] = structuredClone(v)
    return {
      events: [...this.data.events.values()].map((e) => structuredClone(e)),
      working: [...this.data.working.values()].map((w) => structuredClone(w)),
      components: [...this.data.components.values()].map((c) => structuredClone(componentMeta(c))),
      meta,
    }
  }

  /** Applies `tx` to a copy and swaps it in only on success, so a throwing resolver leaves no partial write. */
  async commit(tx: StoreTx, resolve: ConflictResolvers): Promise<CommitResult> {
    if (this.closed) throw new Error('MemoryStore is closed')
    const next: Data = {
      events: new Map(this.data.events),
      working: new Map(this.data.working),
      components: new Map(this.data.components),
      meta: new Map(this.data.meta),
      checkpoint: this.data.checkpoint,
    }
    const result: CommitResult = { eventIds: [], workingKeys: [], metaClaimed: [] }

    // 1. clear
    for (const name of tx.clear ?? []) {
      if (name === 'events') next.events.clear()
      else if (name === 'working') next.working.clear()
      else if (name === 'components') next.components.clear()
      else if (name === 'checkpoints') next.checkpoint = undefined
    }
    // 2. deletes
    for (const id of tx.deleteEventIds ?? []) next.events.delete(id)
    for (const key of tx.deleteWorkingKeys ?? []) next.working.delete(key)
    for (const key of tx.deleteMeta ?? []) next.meta.delete(key)
    if (tx.deleteCheckpoint) next.checkpoint = undefined
    // 3. puts: events, working, working-if-absent, components, meta, meta-if-absent, checkpoint
    for (const incoming of tx.putEvents ?? []) {
      const existing = next.events.get(incoming.id)
      if (!existing) {
        next.events.set(incoming.id, structuredClone(incoming))
        result.eventIds.push(incoming.id)
        continue
      }
      const winner = resolve.event(structuredClone(existing), structuredClone(incoming))
      if (!sameJson(winner, existing)) {
        next.events.set(incoming.id, structuredClone(winner))
        if (!result.eventIds.includes(incoming.id)) result.eventIds.push(incoming.id)
      }
    }
    for (const incoming of tx.putWorking ?? []) {
      const existing = next.working.get(incoming.key)
      if (!existing) {
        next.working.set(incoming.key, structuredClone(incoming))
        result.workingKeys.push(incoming.key)
        continue
      }
      const winner = resolve.working(structuredClone(existing), structuredClone(incoming))
      if (!sameJson(winner, existing)) {
        next.working.set(incoming.key, structuredClone(winner))
        if (!result.workingKeys.includes(incoming.key)) result.workingKeys.push(incoming.key)
      }
    }
    for (const incoming of tx.putWorkingIfAbsent ?? []) {
      if (next.working.has(incoming.key)) continue
      next.working.set(incoming.key, structuredClone(incoming))
      result.workingKeys.push(incoming.key)
    }
    for (const rec of tx.putComponents ?? []) next.components.set(rec.sha256, structuredClone(rec))
    for (const [k, v] of Object.entries(tx.putMeta ?? {})) next.meta.set(k as MetaKey, structuredClone(v))
    for (const [k, v] of Object.entries(tx.putMetaIfAbsent ?? {})) {
      if (next.meta.has(k as MetaKey)) continue
      next.meta.set(k as MetaKey, structuredClone(v))
      result.metaClaimed.push(k as MetaKey)
    }
    if (tx.putCheckpoint) next.checkpoint = structuredClone(tx.putCheckpoint)

    this.data = next
    return result
  }

  async readCheckpoint(): Promise<Checkpoint | undefined> {
    return this.data.checkpoint ? structuredClone(this.data.checkpoint) : undefined
  }

  async readComponentBytes(sha256: string): Promise<ArrayBuffer | undefined> {
    const bytes = this.data.components.get(sha256)?.bytes
    return bytes ? structuredClone(bytes) : undefined
  }

  onVersionChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  close(): void {
    this.closed = true
  }

  /** Test hook: behave as if another context upgraded the database. */
  simulateVersionChange(): void {
    this.close()
    for (const cb of [...this.listeners]) cb()
  }
}
