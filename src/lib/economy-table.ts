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

/** `play:<id>`: `PlayDef.minutes` (W1 declares the same number on the play def). A price lands before its play registers: the scheduler's before 2b, the tiling cube's and EPLB's before Wave 3. */
export const PLAY_MINUTES: Readonly<Record<string, number>> = {
  'block-placement': 15,
  scheduler: 20,
  'tiling-cube': 25,
  eplb: 15,
}

/** `inc:daily/<date>` and `inc:drill/<fault>` (wave-2.md §3.4): nominal [estimated]; a team run pays nothing. */
export const INCIDENT_MINUTES: Readonly<Record<string, number>> = {
  daily: 10,
  drill: 5,
}

/** `fleet:<mode>`: a run with an own component, nominal [estimated]. */
export const FLEET_RUN_MINUTES = 10

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

/** Lessons whose `ticket.form` is `spiral` (§8.6; wave-2.md §6.2): their `quiz-pass:` fact pays the spiral price. T2's plus the five track-end spirals of T3–T7. */
export const SPIRAL_LESSONS: readonly string[] = ['t2.l7', 't3.l7', 't4.l7', 't5.l10', 't6.l10', 't7.l5']

/* RING 1, RING 0 and ROOT (wave-2.md §6.4; PLAN-100X §5.1 V5). Each ring reads only these ids and the aggregate. */

/** RING 1: R6–R10 on unseen seeds. */
export const RING1_R_LABS: readonly string[] = ['rust-zero-r6', 'rust-zero-r7', 'rust-zero-r8', 'rust-zero-r9', 'rust-zero-r10']

/** RING 1: labs 04 (the intake ring) and 05 (the toy executor) on unseen seeds. */
export const RING1_LABS: readonly string[] = ['mpmc-queue', 'toy-executor']

/** RING 1: every T3 and T4 lesson *done*. */
export const RING1_LESSONS: readonly string[] = [
  't3.l1', 't3.l2', 't3.l3', 't3.l4', 't3.l5', 't3.l6', 't3.l7',
  't4.l1', 't4.l2', 't4.l3', 't4.l4', 't4.l5', 't4.l6', 't4.l7',
]

/** RING 0: labs 02, 03, 06 and 07 on unseen seeds. Lab 06's "within 3 points of the reference" is the separate race line below (D14, D25). */
export const RING0_LABS: readonly string[] = ['kv-block-manager', 'bpe-tokenizer', 'batching-scheduler', 'radix-cache']

/**
 * The labs whose race against the reference RING 0 needs: lab 06, within 3 points on an unseen engine run (`labFleetOk`,
 * wave-3.md §3.4). Empty in 3a (D25): the race did not exist yet, and rings are derived, so a live requirement nothing
 * could meet would have un-earned RING 0 for every learner who held it. 3b-09 ships "Race the reference" (ForgeLab,
 * `RaceReference`), so lab 06 is listed here and the ring's checklist shows the race row.
 */
export const RING0_RACE_LABS: readonly string[] = ['batching-scheduler']

/** RING 0: every T5 lesson *done*. */
export const RING0_LESSONS: readonly string[] = [
  't5.l1', 't5.l2', 't5.l3', 't5.l4', 't5.l5', 't5.l6', 't5.l7', 't5.l8', 't5.l9', 't5.l10',
]

/** ROOT: lab 08 on unseen seeds. */
export const ROOT_LAB: string = 'xgrammar-lite'

/** ROOT: Fleet Week acts I and II, run with own modules on unseen seeds (`fleetRuns[mode].unseenOk`). */
export const ROOT_FLEET_RUNS: readonly string[] = ['act1', 'act2']

/** ROOT: the Fleet Week acts that must be passed (`fleetWeek.acts`); the incident act is Act IV and not in the criteria. */
export const ROOT_ACTS: readonly string[] = ['engine', 'fleet', 'business']

/** ROOT: Daily incidents solved, on distinct local dates. */
export const ROOT_DAILIES = 5

/** ROOT: every T6 and T7 lesson *done*. */
export const ROOT_LESSONS: readonly string[] = [
  't6.l1', 't6.l2', 't6.l3', 't6.l4', 't6.l5', 't6.l6', 't6.l7', 't6.l8', 't6.l9', 't6.l10',
  't7.l1', 't7.l2', 't7.l3', 't7.l4', 't7.l5',
]

/** ROOT's cold checks: Today `probe`s on a KC last exposed at least `days` earlier, at least `n` of them, at least `rate` right. */
export const ROOT_COLD = { days: 30, n: 40, rate: 0.8 } as const
