/**
 * KC-id migrations (docs/specs/wave-1.md §4.2, §4.6). Stored evidence is never rewritten: the
 * resolver maps old ids to new ones at read time.
 *
 * - A rename is one row with one target; a split is one row with several (evidence credits each).
 * - A merge is several rows that share a target.
 * - Chains resolve: a -> b, then b -> c, reads a as c.
 *
 * verify-kc fails when a row's `from` is still a KC, when a target is neither a KC nor the `from` of
 * a later row, when two rows share a `from`, or when a chain loops.
 *
 * Graph v1 has published no ids before today, so the table starts empty.
 */

import type { KcMigration } from '@/lib/kc/types'

export const KC_MIGRATIONS: readonly KcMigration[] = []
