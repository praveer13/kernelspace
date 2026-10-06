/**
 * Definitional constants and unit helpers for generators (docs/specs/wave-1.md §5.4).
 *
 * Only values that are true by definition live here: bytes per dtype, the binary and decimal byte
 * prefixes, and the K and V planes of a KV cache. Real-world numbers (a model's layer count, a GPU's
 * bandwidth) come from claims, and a scenario's numbers are declared synthetic in the family.
 * Number formatting is here too, because it must not depend on the runtime's locale.
 */

import type { UnitChoice } from './types'

/** Binary prefixes: KiB = 1024 B. */
export const KIB = 1024
export const MIB = KIB * KIB
export const GIB = MIB * KIB

/** Decimal prefixes: KB = 1000 B (datasheets and prices use these). */
export const KB = 1000
export const MB = KB * KB
export const GB = MB * KB
export const TB = GB * KB

/** A KV cache stores a K plane and a V plane. */
export const KV_PLANES = 2

/** Bits in a byte. */
export const BITS_PER_BYTE = 8

/** Bytes per value of each dtype the course prices (FP4 and INT4 pack two values per byte). */
export const DTYPE_BYTES = {
  fp32: 4,
  bf16: 2,
  fp16: 2,
  fp8: 1,
  int8: 1,
  fp4: 0.5,
  int4: 0.5,
} as const

export type Dtype = keyof typeof DTYPE_BYTES

export function dtypeBytes(dtype: Dtype): number {
  return DTYPE_BYTES[dtype]
}

/** Bytes per unit, for every unit a size answer may be written in. */
export const BYTE_UNITS: Readonly<Record<string, number>> = {
  B: 1,
  KB,
  MB,
  GB,
  TB,
  KiB: KIB,
  MiB: MIB,
  GiB: GIB,
}

/**
 * `UnitChoice`s for an answer whose canonical unit is `canonical`: each name's factor is
 * (bytes per name) / (bytes per canonical), so `value × factor` is in the canonical unit
 * (KiB → B = 1024). The canonical unit itself is always included first.
 */
export function byteUnitChoices(canonical: string, names: readonly string[]): UnitChoice[] {
  const base = BYTE_UNITS[canonical]
  if (base === undefined) throw new RangeError(`unknown byte unit: ${canonical}`)
  const out: UnitChoice[] = [{ unit: canonical, factor: 1 }]
  for (const unit of names) {
    if (unit === canonical) continue
    const per = BYTE_UNITS[unit]
    if (per === undefined) throw new RangeError(`unknown byte unit: ${unit}`)
    out.push({ unit, factor: per / base })
  }
  return out
}

/**
 * A learner's value in the answer's canonical unit. No unit, or the canonical one, passes through.
 * Returns null for a unit the item does not offer.
 */
export function toCanonical(
  value: number,
  unit: string | undefined,
  canonical: string,
  units: readonly UnitChoice[] | undefined,
): number | null {
  if (unit === undefined || unit === canonical) return value
  const choice = units?.find((u) => u.unit === unit)
  return choice ? value * choice.factor : null
}

/**
 * Locale-free number text: thousands separators, at most `digits` decimals (default: enough for 4
 * significant digits below 1000, none above), trailing zeros dropped. NaN and the infinities print
 * as themselves, so a prompt that renders one is caught by verify-generators.
 */
export function formatNumber(n: number, digits?: number): string {
  if (!Number.isFinite(n)) return String(n)
  const abs = Math.abs(n)
  // toFixed switches to exponent text from 1e21 on
  if (abs >= 1e21) return n.toExponential(3)
  const d = digits ?? (abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 10 ? 2 : abs >= 1 ? 3 : 4)
  let s = n.toFixed(d)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  if (s === '-0') s = '0'
  const neg = s.startsWith('-')
  const [int, frac] = (neg ? s.slice(1) : s).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}
