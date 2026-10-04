import type { Erratum } from './schema'

// Date-prefixed modules only, so schema.ts (types, no default export) and this file are never picked up.
const modules = import.meta.glob<Erratum>('/src/data/errata/[0-9]*.ts', {
  eager: true,
  import: 'default',
})

/** Every published erratum, newest first (same-day fixes by id). */
export const ERRATA: readonly Erratum[] = Object.values(modules).sort(
  (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
)
