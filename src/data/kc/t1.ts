/**
 * T1 (C-level mental model) KCs: bytes, frames and a heap with a free list (docs/specs/wave-1.md §4.9).
 *
 * Pairing edges into R (§4.3): `t1.stack-vs-heap` requires `r.clone-copy-drop` (r.l3: Copy values are
 * stack-sized, Clone duplicates a heap buffer), `t1.pointers` requires `r.slices` (r.l4: a slice is a
 * checked pointer plus a length), `t1.allocator-contract` requires `r.enums-option-result` (r.l5: lab
 * 01's allocator answers Option), and `t1.ownership-answer` requires `r.ownership-moves` and
 * `r.borrow-rules`. Lab 01's check KCs (§4.5) name `rust-allocator` in `labs`; together their
 * prerequisites reach every readiness lesson r.l1-r.l5 (verify-kc checks this).
 */

import type { Kc } from '@/lib/kc/types'
import { KC } from './ids'

const since = '2026-10-05'

export const T1_KCS: readonly Kc[] = [
  /* ---- t1.l1 ---- */
  {
    id: 't1.stack-frames',
    title: 'Stack frames and calls',
    can: 'You can draw the frame a call pushes (return address, saved registers, locals) and say what ret pops.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l1', 't1.l5'],
    requires: [],
    since,
  },
  {
    id: 't1.stack-vs-heap',
    title: 'Stack versus heap lifetimes',
    can: 'You can place a value on the stack or the heap by how long it must live, and spot a pointer to a dead frame.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l1'],
    requires: ['t1.stack-frames', 'r.clone-copy-drop'],
    since,
  },

  /* ---- t1.l2 ---- */
  {
    id: 't1.pointers',
    title: 'Pointers and pointer arithmetic',
    can: 'You can compute where p + n points for a typed pointer, and say what dereferencing it reads.',
    track: 't1',
    kind: 'procedure',
    lessons: ['t1.l2'],
    requires: ['t1.stack-vs-heap', 'r.slices'],
    since,
  },
  {
    id: 't1.memory-errors',
    title: 'Memory-safety bugs',
    can: 'You can explain why a NULL dereference crashes while an out-of-bounds read or a use-after-free corrupts silently.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l2', 't1.l3', 't1.l6'],
    requires: ['t1.pointers'],
    since,
  },

  /* ---- t1.l3 ---- */
  {
    id: KC.allocatorContract,
    title: 'The allocator contract',
    can: 'You can state what malloc and free promise: aligned blocks that never overlap, reused after free, freed once.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l3'],
    requires: ['t1.pointers', KC.enumsOptionResult],
    labs: ['rust-allocator'],
    since,
  },
  {
    id: KC.splitCoalesce,
    title: 'Split and coalesce',
    can: 'You can trace a free list as malloc splits a block and free merges it with its free neighbours.',
    track: 't1',
    kind: 'procedure',
    lessons: ['t1.l3'],
    requires: [KC.allocatorContract],
    labs: ['rust-allocator'],
    since,
  },
  {
    id: KC.placementPolicy,
    title: 'Placement policy',
    can: 'You can predict where first, best and next fit place a request, and which policy fails first on a trace.',
    track: 't1',
    kind: 'procedure',
    lessons: ['t1.l3', 't1.l4'],
    requires: [KC.splitCoalesce],
    gen: ['frag'],
    claims: ['production.glibc.bins'],
    labs: ['rust-allocator'],
    since,
  },

  /* ---- t1.l4 ---- */
  {
    id: KC.internalFrag,
    title: 'Internal fragmentation',
    can: 'You can compute the waste inside allocated blocks from rounding, size classes and padding.',
    track: 't1',
    kind: 'procedure',
    lessons: ['t1.l4', 't1.l3'],
    requires: [KC.allocatorContract],
    confusable: [KC.externalFrag],
    gen: ['frag'],
    claims: ['production.jemalloc.max-internal-frag', 'production.jemalloc.classes-per-doubling'],
    since,
  },
  {
    id: KC.externalFrag,
    title: 'External fragmentation',
    can: 'You can show free memory that cannot serve a request, and measure it as 1 − largest free / total free.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l4', 't2.l7'],
    requires: [KC.splitCoalesce],
    confusable: [KC.internalFrag],
    threshold: 'core',
    gen: ['frag'],
    labs: ['rust-allocator'],
    since,
  },
  {
    id: KC.fixedBlocks,
    title: 'Fixed-size blocks',
    can: 'You can explain why same-size blocks end external fragmentation and bound the waste to one partial block.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l4', 't2.l7'],
    requires: [KC.internalFrag, KC.externalFrag],
    gen: ['frag'],
    claims: ['production.vllm.block-size'],
    since,
  },

  /* ---- lab-only: lab 01's `align` check ---- */
  {
    id: KC.alignment,
    title: 'Alignment',
    can: 'You can round an offset up to a power-of-two alignment, and say what the padding costs.',
    track: 't1',
    kind: 'procedure',
    lessons: [],
    requires: [KC.allocatorContract],
    labs: ['rust-allocator'],
    since,
  },

  /* ---- t1.l5 ---- */
  {
    id: 't1.compile-link',
    title: 'Compiling and linking',
    can: 'You can name the stage (compile, assemble, link or load) that produced an error such as undefined reference.',
    track: 't1',
    kind: 'procedure',
    lessons: ['t1.l5'],
    requires: ['t1.pointers'],
    since,
  },
  {
    id: 't1.abi',
    title: 'The ABI',
    can: 'You can say what a calling convention fixes (argument registers, who saves what) and why C is the interop ABI.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l5'],
    requires: ['t1.stack-frames', 't1.compile-link'],
    since,
  },

  /* ---- t1.l6 ---- */
  {
    id: 't1.ownership-answer',
    title: 'Ownership as the answer',
    can: 'You can map each T1 memory bug to the Rust rule that rules it out, and name what that rule costs.',
    track: 't1',
    kind: 'concept',
    lessons: ['t1.l6'],
    requires: ['t1.memory-errors', KC.allocatorContract, KC.ownershipMoves, KC.borrowRules],
    since,
  },
]
