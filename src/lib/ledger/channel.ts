/**
 * BroadcastChannel wrapper for cross-tab sync (spec §9.4).
 *
 * It carries `ChannelMessage`s on `kernelspace:ledger`. The wrapper stamps `from` and
 * `schemaVersion` on every send, drops the tab's own echoes and malformed messages, and
 * degrades to a no-op where BroadcastChannel does not exist. What a receiver does with a
 * message (fold it in, rebuild, go read-only) is the engine's business; `guard.ts` decides
 * the read-only part.
 */

import { CHANNEL_NAME, SNAPSHOT_KEY } from './names'
import type { ChannelMessage, WorkingRecord } from './types'

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** What a caller passes to `post`: the message without the fields the channel stamps. */
export type OutgoingMessage = DistributiveOmit<ChannelMessage, 'from' | 'schemaVersion'>

/** The slice of BroadcastChannel this module uses (so tests can fake it). */
export interface ChannelLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void
  close(): void
}

export interface LedgerChannel {
  /** False where BroadcastChannel is missing; `post` then does nothing. */
  readonly available: boolean
  post(message: OutgoingMessage): void
  /** Receive messages from other tabs. Returns an unsubscribe. */
  subscribe(cb: (message: ChannelMessage) => void): () => void
  close(): void
}

export interface OpenChannelOptions {
  tabId: string
  /** This bundle's `SCHEMA_VERSION`, stamped on every message. */
  schemaVersion: number
  /** Defaults to `new BroadcastChannel(name)` when that exists. */
  factory?: (name: string) => ChannelLike
}

function defaultFactory(): ((name: string) => ChannelLike) | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined
  return (name) => new BroadcastChannel(name)
}

const RELOAD_REASONS = new Set(['import', 'undo', 'reset', 'migration', 'legacy-reproject'])

/** Structural check of an incoming message. Content of events is validated by the engine (codec). */
export function parseChannelMessage(data: unknown): ChannelMessage | null {
  if (!data || typeof data !== 'object') return null
  const m = data as Record<string, unknown>
  if (typeof m.from !== 'string' || typeof m.schemaVersion !== 'number' || !Number.isFinite(m.schemaVersion)) return null
  switch (m.t) {
    case 'hello':
      return data as ChannelMessage
    case 'reload':
      return typeof m.reason === 'string' && RELOAD_REASONS.has(m.reason) ? (data as ChannelMessage) : null
    case 'append':
      return Array.isArray(m.events) && Array.isArray(m.working) ? (data as ChannelMessage) : null
    default:
      return null
  }
}

export function openLedgerChannel(opts: OpenChannelOptions): LedgerChannel {
  const make = opts.factory ?? defaultFactory()
  let channel: ChannelLike | null = null
  try {
    channel = make ? make(CHANNEL_NAME) : null
  } catch {
    channel = null
  }
  if (!channel) {
    return { available: false, post() {}, subscribe: () => () => {}, close() {} }
  }
  const ch = channel
  const listeners = new Set<() => void>()
  return {
    available: true,
    post(message) {
      try {
        ch.postMessage({ ...message, from: opts.tabId, schemaVersion: opts.schemaVersion })
      } catch {
        // a closed channel or an unclonable payload must never break a write
      }
    },
    subscribe(cb) {
      const listener = (ev: { data: unknown }) => {
        const msg = parseChannelMessage(ev.data)
        if (!msg || msg.from === opts.tabId) return
        cb(msg)
      }
      ch.addEventListener('message', listener)
      const off = () => {
        ch.removeEventListener('message', listener)
        listeners.delete(off)
      }
      listeners.add(off)
      return off
    },
    close() {
      for (const off of [...listeners]) off()
      try {
        ch.close()
      } catch {
        // already closed
      }
    },
  }
}

/** Working records that go on the channel: `scroll:*` is device-local and never broadcast (§5). */
export function broadcastableWorking(working: WorkingRecord[]): WorkingRecord[] {
  return working.filter((w) => !w.key.startsWith('scroll:'))
}

/** The slice of `window` the storage fallback needs. */
export interface StorageEventTarget {
  addEventListener(type: 'storage', listener: (ev: { key: string | null }) => void): void
  removeEventListener(type: 'storage', listener: (ev: { key: string | null }) => void): void
}

/**
 * Fallback trigger (§9.4): a `storage` event on the snapshot key means another tab wrote it,
 * so the receiver should treat it as a `reload`. Only the writing tab writes the snapshot.
 */
export function watchSnapshotStorage(target: StorageEventTarget | null, cb: () => void): () => void {
  if (!target) return () => {}
  const listener = (ev: { key: string | null }) => {
    if (ev.key === SNAPSHOT_KEY) cb()
  }
  target.addEventListener('storage', listener)
  return () => target.removeEventListener('storage', listener)
}
