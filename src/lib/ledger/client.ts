/**
 * The lazy door to the ledger engine (spec §2, §8.1). This module is small on purpose: it sits in
 * the entry chunk next to the façade and loads `engine.ts`, the store, the codec and the channel
 * only when something asks for them.
 *
 * - `browserEnv()` is the one environment the app uses: localStorage, the system clock, a tab id,
 *   and a `loadEngine` that boots a single engine on IndexedDB (falling back to memory, §9.8).
 * - `getLedgerClient()` is how pages that need the async API (L4's export and import, L5-L8's
 *   event reads) reach that same engine.
 */

import { systemClock } from './time'
import { uuidFactory } from './ids'
import type { DeviceId, FacadeEnv, IdFactory, KeyValueStorage, LedgerClient, LedgerEngine } from './types'

export type { LedgerClient, LedgerEngine }

/** This browser profile's device id. Kept in localStorage so the façade can stamp it before IndexedDB opens. */
export const DEVICE_KEY = 'kernelspace:v2:device'

/** Read the device id, creating and storing one on first use. Without storage it lives for this load only. */
export function loadDeviceId(storage: KeyValueStorage | null, newId: IdFactory): DeviceId {
  try {
    const existing = storage?.getItem(DEVICE_KEY)
    if (existing) return existing
  } catch {
    // blocked storage: fall through to an ephemeral id
  }
  const id = newId()
  try {
    storage?.setItem(DEVICE_KEY, id)
  } catch {
    // quota or blocked: the id is per-load then
  }
  return id
}

/**
 * `window.localStorage`, or null where merely touching it throws (blocked cookies). Reads are probed, not writes:
 * a full quota still reads fine, and every write below is wrapped in its own try/catch (spec §9.8).
 */
function browserStorage(): KeyValueStorage | null {
  try {
    const ls = globalThis.localStorage
    ls.getItem(DEVICE_KEY)
    return ls
  } catch {
    return null
  }
}

let shared: FacadeEnv | null = null

/** The app's environment, created once so the façade and every `getLedgerClient()` caller share one tab id and one engine. */
export function browserEnv(): FacadeEnv {
  if (shared) return shared
  const storage = browserStorage()
  const tabId = uuidFactory()
  let engine: Promise<LedgerEngine> | null = null
  shared = {
    storage,
    clock: systemClock,
    newId: uuidFactory,
    tabId,
    loadEngine() {
      engine ??= import('./engine')
        .then(({ createBrowserEngine }) =>
          createBrowserEngine({
            storage,
            clock: systemClock,
            tabId,
            device: loadDeviceId(storage, uuidFactory),
            storageEvents: typeof window === 'undefined' ? null : window,
            durability: typeof navigator === 'undefined' ? null : (navigator.storage ?? null),
          }),
        )
        .catch((err) => {
          engine = null // a failed chunk fetch can be retried
          throw err
        })
      return engine
    },
  }
  return shared
}

let beforeClient: (() => Promise<unknown>) | null = null

/**
 * The façade registers itself here, so that when a page asks for the client the façade has subscribed to
 * the engine first. Otherwise an import done through the client in the first idle seconds would not reach
 * `useProgress` until the façade's own idle boot.
 */
export function onLedgerClientRequest(hook: () => Promise<unknown>): void {
  beforeClient = hook
}

/** The async ledger API: export v3, import preview and apply, undo, reset, event reads, storage estimate. */
export async function getLedgerClient(): Promise<LedgerClient> {
  try {
    await beforeClient?.()
  } catch {
    // the façade could not subscribe; the client itself still works
  }
  return browserEnv().loadEngine()
}
