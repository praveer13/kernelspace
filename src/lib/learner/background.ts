/**
 * `profile:background` as the working record holds it (docs/specs/wave-3.md §11.3). Kept apart from iso.ts so Boot's last
 * step and /me read the pick without pulling the align and grading module with it (verify:bundle).
 */

import { BACKGROUNDS } from '@/lib/ledger/constants'
import type { Background } from '@/lib/ledger/types'

/** One of the six values, else none. */
export const backgroundOf = (value: unknown): Background | null =>
  typeof value === 'string' && (BACKGROUNDS as readonly string[]).includes(value) ? (value as Background) : null
