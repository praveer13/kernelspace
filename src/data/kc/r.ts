/**
 * R (Rust Zero) KCs: the ownership machine, from bindings to atomics (docs/specs/wave-1.md §4.9).
 *
 * Two KCs are introduced per lesson; later lessons that revisit one list it after its introducer.
 * Every R lesson has at least one T0-T2 KC that `requires` a KC it introduces (§4.3, the braid's
 * pairing edges); those edges live on the T side, in t0.ts, t1.ts and t2.ts.
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const R_KCS: readonly Kc[] = [
  /* ---- r.l1 ---- */
  {
    id: 'r.bindings-expressions',
    title: 'Bindings, shadowing and block values',
    can: 'You can predict what let, mut, shadowing and a block\'s final expression evaluate to.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l1', 'r.l2'],
    requires: [],
    since,
  },
  {
    id: 'r.scalar-types',
    title: 'Scalar types and tuple patterns',
    can: 'You can pick an integer type for a job (usize for indexes, u64 for byte counts) and destructure a tuple.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l1'],
    requires: ['r.bindings-expressions'],
    since,
  },

  /* ---- r.l2 ---- */
  {
    id: 'r.control-flow-match',
    title: 'Exhaustive match and control flow',
    can: 'You can write a match that covers every case of an enum, and use if and match as expressions.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l2', 'r.l5'],
    requires: ['r.bindings-expressions'],
    since,
  },
  {
    id: 'r.loops-ranges',
    title: 'Loops, ranges and loop values',
    can: 'You can choose for, while or loop, read a half-open range, and return a value with break.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l2'],
    requires: ['r.bindings-expressions'],
    since,
  },

  /* ---- r.l3 ---- */
  {
    id: KC.ownershipMoves,
    title: 'Ownership and moves',
    can: 'You can say which binding owns a value after an assignment, a call or a return, and spot a use after move.',
    track: 'r',
    kind: 'concept',
    lessons: ['r.l3', 'r.l6', 'r.l7'],
    requires: ['r.bindings-expressions'],
    confusable: [KC.borrowRules],
    since,
  },
  {
    id: 'r.clone-copy-drop',
    title: 'Copy, Clone and Drop',
    can: 'You can tell a Copy type from one that needs clone(), and say exactly when Drop runs.',
    track: 'r',
    kind: 'concept',
    lessons: ['r.l3'],
    requires: [KC.ownershipMoves],
    since,
  },

  /* ---- r.l4 ---- */
  {
    id: KC.borrowRules,
    title: 'Borrow rules',
    can: 'You can predict E0499 and E0502 (many &T or one &mut T, never both) and fix the design rather than clone.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l4', 'r.l8', 'r.l9', 't1.l6'],
    requires: [KC.ownershipMoves],
    confusable: [KC.ownershipMoves, 'r.lifetimes'],
    threshold: 'anchor',
    since,
  },
  {
    id: 'r.slices',
    title: 'Slices and string views',
    can: 'You can pass &[T] and &str windows instead of owned collections, and say what a slice borrows.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l4', 'r.l9'],
    requires: [KC.borrowRules],
    since,
  },

  /* ---- r.l5 ---- */
  {
    id: KC.enumsOptionResult,
    title: 'Enums, Option and Result',
    can: 'You can model absence with Option and failure with Result, and match on both.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l5'],
    requires: ['r.control-flow-match'],
    labs: ['rust-allocator'],
    since,
  },
  {
    id: 'r.error-propagation',
    title: 'Error propagation with ?',
    can: 'You can propagate errors with ?, and choose Result over panic for input a caller can get wrong.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l5'],
    requires: [KC.enumsOptionResult],
    since,
  },

  /* ---- r.l6 ---- */
  {
    id: 'r.iterators-ownership',
    title: 'Iterators and ownership',
    can: 'You can choose iter, iter_mut or into_iter by what the loop must own, and say when lazy adapters run.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l6'],
    requires: [KC.ownershipMoves, KC.borrowRules],
    since,
  },
  {
    id: 'r.closures-collections',
    title: 'Closures and collections',
    can: 'You can say what a closure captures and why, and build maps and counters with HashMap::entry.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l6'],
    requires: [KC.ownershipMoves],
    since,
  },

  /* ---- r.l7 ---- */
  {
    id: 'r.smart-pointers',
    title: 'Box, Rc, Arc and Weak',
    can: 'You can choose Box, Rc or Arc, and know that cloning one copies a handle and bumps a count, not the data.',
    track: 'r',
    kind: 'concept',
    lessons: ['r.l7'],
    requires: [KC.ownershipMoves],
    confusable: ['r.interior-mutability'],
    since,
  },

  /* ---- r.l8 ---- */
  {
    id: 'r.interior-mutability',
    title: 'Interior mutability',
    can: 'You can change data behind a shared reference with Cell, RefCell or Mutex, and predict the runtime borrow panic.',
    track: 'r',
    kind: 'concept',
    lessons: ['r.l8'],
    requires: [KC.borrowRules, 'r.smart-pointers'],
    confusable: ['r.smart-pointers'],
    since,
  },

  /* ---- r.l9 ---- */
  {
    id: 'r.lifetimes',
    title: 'Practical lifetimes',
    can: 'You can read a lifetime annotation as a contract between inputs and outputs, and fix an escape with owned data.',
    track: 'r',
    kind: 'concept',
    lessons: ['r.l9'],
    requires: [KC.borrowRules, 'r.slices'],
    confusable: [KC.borrowRules],
    since,
  },

  /* ---- r.l10 ---- */
  {
    id: 'r.atomics-ordering',
    title: 'Atomics and memory ordering',
    can: 'You can choose Relaxed, Release or Acquire for a shared flag or counter, and say what each one guarantees.',
    track: 'r',
    kind: 'concept',
    lessons: ['r.l10', 't2.l5'],
    requires: ['r.smart-pointers', 'r.interior-mutability'],
    confusable: ['t2.mutex-atomics'],
    since,
  },
  {
    id: 'r.compare-exchange',
    title: 'Compare-and-exchange loops',
    can: 'You can write a compare_exchange retry loop and use the current value it returns on failure.',
    track: 'r',
    kind: 'skill',
    lessons: ['r.l10'],
    requires: ['r.atomics-ordering'],
    since,
  },
]
