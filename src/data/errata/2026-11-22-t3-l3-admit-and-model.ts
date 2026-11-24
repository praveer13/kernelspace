import type { Erratum } from './schema'

export default {
  id: '2026-11-22-t3-l3-admit-and-model',
  date: '2026-11-22',
  kind: 'error',
  lessons: ['t3.l3'],
  title: 'admit() no longer panics, counters are padded with CachePadded, and the sim is a model',
  before: "admit() used (n > 0).then_some(n - 1), which panics in a debug build; \"Crossbeam's sharded counters\"; the sim called a Rust measurement.",
  after: 'n.checked_sub(1) from 8 slots with a release(); counters padded with CachePadded; the sim is a model of three formulas.',
  why: 'then_some evaluates its argument eagerly, so n - 1 overflows at zero. crossbeam-utils has CachePadded, not a sharded counter. The sim draws three closed-form curves.',
  source: { url: 'https://docs.rs/crossbeam-utils/0.8.23/crossbeam_utils/struct.CachePadded.html', title: 'crossbeam_utils::CachePadded' },
} satisfies Erratum
