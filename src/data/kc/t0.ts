/**
 * T0 (Foundations) KCs: the memory-hierarchy machine (docs/specs/wave-1.md §4.9).
 *
 * Pairing edges into R (§4.3): `t0.cache-lines` requires `r.bindings-expressions` (r.l1),
 * `t0.stride-traversal` requires `r.loops-ranges` (r.l2), `t0.data-layout` requires `r.scalar-types`
 * (field widths set the struct size in layout.rs), and `t0.runtime-costs` requires `r.ownership-moves`
 * (r.l3: a managed runtime is "allocation without ownership decisions").
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T0_KCS: readonly Kc[] = [
  /* ---- t0.l1 ---- */
  {
    id: 't0.idea-reuse',
    title: 'Old systems ideas in serving',
    can: 'You can name the OS or runtime idea behind a serving mechanism: paging, eviction, scheduling or speculation.',
    track: 't0',
    kind: 'concept',
    lessons: ['t0.l1', 't0.l5'],
    requires: [],
    since,
  },

  /* ---- t0.l2 ---- */
  {
    id: 't0.latency-ladder',
    title: 'The latency ladder',
    can: 'You can place L1, L2, L3, DRAM and NVMe on the latency ladder to an order of magnitude.',
    track: 't0',
    kind: 'fact',
    lessons: ['t0.l2'],
    requires: [],
    since,
  },
  {
    id: KC.locality,
    title: 'Locality',
    can: 'You can predict a speedup or a slowdown from whether an access pattern reuses nearby or recent bytes.',
    track: 't0',
    kind: 'concept',
    lessons: ['t0.l2', 't0.l3', 't0.l4'],
    requires: ['t0.latency-ladder'],
    threshold: 'core',
    since,
  },
  {
    id: 't0.cache-lines',
    title: 'Cache lines',
    can: 'You can say that memory moves in 64-byte lines, and count the useful bytes in each line a loop fetches.',
    track: 't0',
    kind: 'concept',
    lessons: ['t0.l2', 't0.l4'],
    requires: [KC.locality, 'r.bindings-expressions'],
    confusable: ['t0.false-sharing'],
    since,
  },

  /* ---- t0.l3 ---- */
  {
    id: 't0.stride-traversal',
    title: 'Strided traversal',
    can: 'You can predict the row- versus column-major gap from the stride, the cache size and the prefetcher.',
    track: 't0',
    kind: 'procedure',
    lessons: ['t0.l3'],
    requires: ['t0.cache-lines', 'r.loops-ranges'],
    since,
  },

  /* ---- t0.l4 ---- */
  {
    id: 't0.data-layout',
    title: 'AoS versus SoA',
    can: 'You can choose array-of-structs or struct-of-arrays from which fields a hot loop reads together.',
    track: 't0',
    kind: 'concept',
    lessons: ['t0.l4'],
    requires: ['t0.cache-lines', 'r.scalar-types'],
    confusable: ['t0.false-sharing'],
    since,
  },
  {
    id: 't0.false-sharing',
    title: 'False sharing',
    can: 'You can diagnose false sharing between threads, and fix it by padding hot fields onto separate lines.',
    track: 't0',
    kind: 'concept',
    lessons: ['t0.l4'],
    requires: ['t0.cache-lines'],
    // "pack what is read together; pad what is written concurrently" (t0.l4) is the line between these
    confusable: ['t0.cache-lines', 't0.data-layout'],
    since,
  },

  /* ---- t0.l5 ---- */
  {
    id: 't0.runtime-costs',
    title: 'What a managed runtime costs',
    can: 'You can name what the JVM or CPython does for you (GC, JIT, GIL) and what each costs in latency or layout.',
    track: 't0',
    kind: 'concept',
    lessons: ['t0.l5'],
    requires: [KC.locality, KC.ownershipMoves],
    since,
  },

  /* ---- t0.l6 ---- */
  {
    id: 't0.flame-graphs',
    title: 'Reading a flame graph',
    can: 'You can read a flame graph: width is the share of samples, height is call depth, and left-to-right order is not time.',
    track: 't0',
    kind: 'skill',
    lessons: ['t0.l6'],
    requires: [],
    since,
  },
  {
    id: 't0.wait-bars',
    title: 'Wait bars and stragglers',
    can: 'You can tell a wide wait bar from slow work, and find the thread or rank everyone else is waiting on.',
    track: 't0',
    kind: 'skill',
    lessons: ['t0.l6'],
    requires: ['t0.flame-graphs'],
    since,
  },
]
