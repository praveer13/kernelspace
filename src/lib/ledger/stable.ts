import { hash32 } from '../rng'

/**
 * JSON with object keys sorted, so equal values always serialise to the same string
 * (the canonical conflict rule, content fingerprints and "identical ledger" checks
 * all depend on it). Like JSON.stringify, it drops `undefined` object members and
 * turns non-finite numbers into null.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined || typeof v === 'function' ? 'null' : stableStringify(v))).join(',')}]`
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key]
      if (v === undefined || typeof v === 'function') continue
      parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`)
    }
    return `{${parts.join(',')}}`
  }
  return 'null'
}

/**
 * Record helpers for maps keyed by imported ids. A plain `rec[id]` reads or writes through the
 * prototype for `__proto__`, `constructor` and friends; these touch own properties only, and
 * `setOwn` defines the key as an own data property, so `__proto__` is just another id.
 * Own `__proto__` keys survive `structuredClone`, `Object.keys` and JSON.
 */
export const getOwn = <K extends string, T>(rec: Partial<Record<K, T>>, key: K): T | undefined =>
  Object.hasOwn(rec, key) ? rec[key] : undefined

export function setOwn<K extends string, T>(rec: Partial<Record<K, T>>, key: K, value: T): T {
  Object.defineProperty(rec, key, { value, enumerable: true, writable: true, configurable: true })
  return value
}

/** The own entry for `key`, created from `make()` when absent. */
export const ensureOwn = <K extends string, T>(rec: Partial<Record<K, T>>, key: K, make: () => T): T =>
  Object.hasOwn(rec, key) ? (rec[key] as T) : setOwn(rec, key, make())

/** Lowercase hex SHA-256 (async: `crypto.subtle` exists in browsers and Bun). */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Short synchronous content fingerprint (spec §4.5): FNV-1a of the stable JSON, base 36. */
export function rev32(value: unknown): string {
  return hash32(stableStringify(value)).toString(36)
}
