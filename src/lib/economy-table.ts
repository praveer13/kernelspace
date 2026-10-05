/**
 * The facts XP v2 prices and the ids RING 2 reads (wave-1.md §8.4–8.5). Data only, because it ships in the
 * entry chunk: no import from `labs.ts`, `Capstone.tsx` or the lesson registry, all of which are large.
 *
 * Generated from those sources. `tests/economy/table.test.ts` rebuilds it and fails with a diff when
 * `labs.ts` (minutes, required checks), Capstone's STEPS, the Fleet Week acts or the T0–T2 lessons change:
 * copy the rebuilt values here.
 */

export interface LabEntry {
  /** `ForgeLab.minutes`: what a whole lab pays across its required checks. */
  minutes: number
  /** Required check ids (`ForgeLab.checks` without `optional`), in lab order. */
  checks: readonly string[]
}

/** Every Forge lab. A required check pays `minutes ÷ checks.length` the first time any run passes it. */
export const LABS: Readonly<Record<string, LabEntry>> = {
  'rust-zero-r1': { minutes: 20, checks: ['mut_accumulate', 'shadow_convert', 'typed_average', 'block_value', 'branch_value', 'destructure'] },
  'rust-zero-r2': { minutes: 20, checks: ['branch_expression', 'range_sum', 'while_search', 'loop_value', 'tuple_match', 'guarded_match'] },
  'rust-zero-r3': { minutes: 28, checks: ['copy_scalar', 'return_ownership', 'clone_independent', 'consume_vec', 'option_take', 'replace_field'] },
  'rust-zero-r4': { minutes: 30, checks: ['slice_sum', 'mutate_slice', 'split_mut', 'str_view', 'borrow_then_mutate', 'subslice'] },
  'rust-zero-r5': { minutes: 30, checks: ['block_method', 'state_match', 'option_lookup', 'result_validate', 'question_mark', 'nested_match'] },
  'rust-zero-r6': { minutes: 30, checks: ['filter_vec', 'stable_sort', 'frequency_map', 'grouped_sum', 'closure_capture', 'iterator_pipeline'] },
  'rust-zero-r7': { minutes: 30, checks: ['boxed_list', 'rc_counts', 'weak_edge', 'arc_share', 'handle_clone', 'unwrap_unique'] },
  'rust-zero-r8': { minutes: 32, checks: ['cell_counter', 'refcell_log', 'conflict_detection', 'scoped_borrow', 'mutex_update', 'lock_scope'] },
  'rust-zero-r9': { minutes: 30, checks: ['first_word', 'choose_longer', 'borrowed_block', 'separate_lifetimes', 'owned_escape', 'subslice_contract'] },
  'rust-zero-r10': { minutes: 40, checks: ['relaxed_ticket', 'publish_consume', 'compare_exchange', 'fetch_update', 'spin_lock', 'ordering_choice'] },
  'rust-allocator': { minutes: 90, checks: ['boot', 'align', 'no_overlap', 'coalesce', 'reuse', 'fragmentation'] },
  'kv-block-manager': { minutes: 120, checks: ['paging', 'capacity', 'fork_shares', 'cow', 'free_refcount', 'gauntlet'] },
  'bpe-tokenizer': { minutes: 90, checks: ['bytes_are_ids', 'merge_priority', 'leftmost_nonoverlap', 'roundtrip', 'robust_decode', 'contract'] },
  'mpmc-queue': { minutes: 120, checks: ['fifo', 'backpressure', 'wraparound', 'model_gauntlet', 'slot_conservation', 'burst_model'] },
  'toy-executor': { minutes: 120, checks: ['block_on', 'fifo_poll', 'pending_repoll', 'ping_pong', 'many_tasks', 'nested_spawn'] },
  'batching-scheduler': { minutes: 150, checks: ['runs_clean', 'slo_light', 'burst', 'convoy', 'starvation', 'goodput_score'] },
  'radix-cache': { minutes: 150, checks: ['exact_match', 'longest_prefix', 'eviction_order', 'block_conservation', 'cow_divergence', 'chat_hit_rate'] },
  'xgrammar-lite': { minutes: 180, checks: ['schema_compile', 'valid_acceptance', 'earliest_rejection', 'token_mask', 'mask_overhead', 'compile_cache'] },
}

/** `cap:<step>`: each Capstone step's `minutes` (`Capstone.tsx` STEPS). */
export const CAPSTONE_STEP_MINUTES: Readonly<Record<string, number>> = {
  tokenize: 30,
  embed: 25,
  forward: 45,
  decode: 35,
  'kv-cache': 40,
  batch: 40,
  measure: 30,
}

/** `fw:<act>`: nominal [estimated]. The incident act is shorter. */
export const FLEET_ACT_MINUTES: Readonly<Record<string, number>> = {
  engine: 30,
  fleet: 30,
  business: 30,
  incident: 20,
}

/** `play:<id>`: `PlayDef.minutes` (W1 declares the same number on the play def). */
export const PLAY_MINUTES: Readonly<Record<string, number>> = {
  'block-placement': 15,
}

/** The 19 lessons whose exit tickets RING 2 needs (T0 · T1 · T2). */
export const RING2_LESSONS: readonly string[] = [
  't0.l1', 't0.l2', 't0.l3', 't0.l4', 't0.l5', 't0.l6',
  't1.l1', 't1.l2', 't1.l3', 't1.l4', 't1.l5', 't1.l6',
  't2.l1', 't2.l2', 't2.l3', 't2.l4', 't2.l5', 't2.l6', 't2.l7',
]

/** R1–R5: the drills RING 2 needs on unseen seeds. */
export const RING2_R_LABS: readonly string[] = ['rust-zero-r1', 'rust-zero-r2', 'rust-zero-r3', 'rust-zero-r4', 'rust-zero-r5']

/** Lab 01, the allocator, on unseen seeds. */
export const RING2_LAB: string = 'rust-allocator'

/** Lessons whose `ticket.form` is `spiral` (§8.6): their `quiz-pass:` fact pays the spiral price. */
export const SPIRAL_LESSONS: readonly string[] = ['t2.l7']
