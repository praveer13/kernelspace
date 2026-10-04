/**
 * Test support for the engine and façade (L3): a Map-backed localStorage that logs every key it is
 * asked about, a controllable clock, a fake BroadcastChannel bus, and helpers that stand up a browser
 * profile (one storage, one MemoryStore) with any number of tabs on it. Everything runs under plain
 * `bun test` with no browser globals.
 */
import type { ChannelLike } from '../../src/lib/ledger/channel'
import { createEngine, type BootedEngine, type EngineDeps } from '../../src/lib/ledger/engine'
import { loadDeviceId } from '../../src/lib/ledger/client'
import { MemoryStore, type MemoryStoreSeed } from '../../src/lib/ledger/memory-store'
import type { FacadeEnv, IdFactory, KeyValueStorage, LedgerClock, LedgerStore } from '../../src/lib/ledger/types'
import { createProgressStore, type ProgressStore } from '../../src/lib/progress'

/** localStorage stand-in. `log` records `get:`, `set:` and `remove:` per key, so tests can prove what was never touched. */
export class FakeStorage implements KeyValueStorage {
  data = new Map<string, string>()
  log: string[] = []
  failWrites = false
  get length() {
    return this.data.size
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null
  }
  getItem(k: string) {
    this.log.push(`get:${k}`)
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.log.push(`set:${k}`)
    if (this.failWrites) throw new Error('QuotaExceededError')
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.log.push(`remove:${k}`)
    this.data.delete(k)
  }
  /** Keys written or removed (never read-only access). */
  writes(): string[] {
    return this.log.filter((l) => !l.startsWith('get:')).map((l) => l.slice(l.indexOf(':') + 1))
  }
  touched(key: string): boolean {
    return this.log.some((l) => l.slice(l.indexOf(':') + 1) === key)
  }
}

export interface FakeClock extends LedgerClock {
  ms: number
  tz: number
  advance(minutes: number): void
}

export const T0 = Date.parse('2026-10-04T09:00:00.000Z')

export function fakeClock(ms = T0, tz = 0): FakeClock {
  return {
    ms,
    tz,
    nowIso() {
      return new Date(this.ms).toISOString()
    },
    tzOffsetMinutes() {
      return this.tz
    },
    advance(minutes) {
      this.ms += minutes * 60_000
    },
  }
}

/** Unique, deterministic ids; the prefix keeps tabs and devices apart. */
export function idStream(prefix: string): IdFactory {
  let n = 0
  return () => `${prefix}${(n++).toString(36)}`
}

/** A BroadcastChannel stand-in: a message reaches every other open instance on the bus, asynchronously, as a clone. */
export class ChannelBus {
  private members = new Set<{ deliver(data: unknown): void }>()
  /** Messages posted, for assertions. */
  sent: unknown[] = []

  factory = (): ((name: string) => ChannelLike) => {
    return () => {
      const listeners = new Set<(ev: { data: unknown }) => void>()
      const member = { deliver: (data: unknown) => listeners.forEach((l) => l({ data })) }
      this.members.add(member)
      return {
        postMessage: (message: unknown) => {
          const copy = structuredClone(message)
          this.sent.push(copy)
          for (const other of this.members) {
            if (other !== member) setTimeout(() => other.deliver(structuredClone(copy)), 0)
          }
        },
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener),
        close: () => {
          this.members.delete(member)
        },
      }
    }
  }
}

/** Let queued timers and microtasks (channel delivery, debounces) run. */
export const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** One browser profile: localStorage, IndexedDB (a MemoryStore), a channel bus and a clock shared by its tabs. */
export interface Profile {
  storage: FakeStorage
  store: MemoryStore
  bus: ChannelBus
  clock: FakeClock
  device: string
}

export function makeProfile(opts: { seed?: MemoryStoreSeed; ms?: number; tz?: number; devicePrefix?: string } = {}): Profile {
  const storage = new FakeStorage()
  const clock = fakeClock(opts.ms, opts.tz)
  const device = loadDeviceId(storage, idStream(opts.devicePrefix ?? 'device-'))
  storage.log = []
  return { storage, store: new MemoryStore(opts.seed), bus: new ChannelBus(), clock, device }
}

export interface Tab {
  tabId: string
  progress: ProgressStore
  env: FacadeEnv
  /** The tab's engine, booted on demand and exactly once. */
  engine(): Promise<BootedEngine>
  /** How many times the façade asked for the engine. */
  loads(): number
}

let tabCounter = 0

export interface TabOptions {
  tabId?: string
  /** Pretend to be a bundle with another `SCHEMA_VERSION`. */
  schemaVersion?: number
  store?: LedgerStore
  engine?: Partial<EngineDeps>
  snapshotDelayMs?: number
}

/** A tab on `profile`: its own façade, tab id and engine, sharing the profile's storage, store and channel bus. */
export function startTab(profile: Profile, opts: TabOptions = {}): Tab {
  const tabId = opts.tabId ?? `tab${++tabCounter}`
  const newId = idStream(`${tabId}:`)
  let booted: Promise<BootedEngine> | null = null
  let loads = 0
  const engine = () =>
    (booted ??= createEngine({
      store: opts.store ?? profile.store,
      storage: profile.storage,
      clock: profile.clock,
      tabId,
      device: profile.device,
      channelFactory: profile.bus.factory(),
      schemaVersion: opts.schemaVersion,
      ...opts.engine,
    }))
  const env: FacadeEnv = {
    storage: profile.storage,
    clock: profile.clock,
    newId,
    tabId,
    loadEngine: () => {
      loads += 1
      return engine()
    },
  }
  const progress = createProgressStore(env, { scheduleBoot: () => {}, snapshotDelayMs: opts.snapshotDelayMs ?? 5 })
  return { tabId, progress, env, engine, loads: () => loads }
}

/** The data fields of a state, as consumers see them. */
export function dataOf(s: ReturnType<ProgressStore['getState']>) {
  const { version, lessons, sims, labs, fleetWeek, capstone, xp, streakDays, achievements, settings } = s
  return { version, lessons, sims, labs, fleetWeek, capstone, xp, streakDays, achievements, settings }
}
