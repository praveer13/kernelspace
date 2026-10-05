/**
 * T3 (Rust for systems) KCs that Wave 2's contract names (docs/specs/wave-2.md §4.2). The rest of T3
 * joins the graph with its tickets in 2a-11.
 *
 * `t3.unsafe-boundaries` is the T-side pairing edge for `r.analyzer-limits` (r.l4): unsafe is what a
 * programmer writes where the analyzer's limits bite, so the R lesson needs a T3 KC that requires it.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T3_KCS: readonly Kc[] = [
  {
    id: KC.unsafeBoundaries,
    title: 'Unsafe boundaries',
    can: 'You can say what an unsafe block promises, keep it small behind a safe API, and name the invariants it relies on.',
    track: 't3',
    kind: 'concept',
    lessons: ['t3.l2'],
    requires: [KC.analyzerLimits, 'r.slices'],
    since,
  },
]
