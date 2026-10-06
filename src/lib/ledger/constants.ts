import { FACT_UNITS } from '../economy'

/**
 * Logical data-model version (spec §3). Bump when event semantics or required fields change.
 * 4 = Wave 1 (wave-1.md §3.1): new refs, data shapes and lesson states. A Wave 0b bundle goes read-only on it.
 * 5 = Wave 2 (wave-2.md §3.1): incident and fleet-run refs and data, `packet:` acks, two item sources and four
 * working keys. A Wave 1 bundle would drop those at outbox recovery and cross-tab sync, so it goes read-only.
 */
export const SCHEMA_VERSION = 5

/**
 * Aggregate format version; an unknown one means "rebuild from the ledger". Versions 1 (Wave 0b) and 2 (Wave 1)
 * are upgraded in place at hydrate, so the first paint after a deploy is never empty (`upgradeAggregate`).
 */
export const AGGREGATE_VERSION = 3

/** Export file marker (spec §10.1). */
export const EXPORT_FORMAT = 'kernelspace-progress'

/** Import refuses anything larger (spec §10.2). */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024

/** `ok` threshold of a checkpoint submission. */
export const QUIZ_PASS_SCORE = 0.8

/**
 * Flat XP (nominal minutes) paid once per fact, keyed by the fact's prefix (spec §6.3, economy v2 in
 * wave-1.md §8.4). `labc`, `play`, `fw` and `cap` are priced from `economy-table.ts` by `factXp`.
 */
export const XP_UNITS = FACT_UNITS

/** Fault ids of the incident world (wave-2.md §3.2, §9.1). */
export const FAULT_IDS = ['pool-shrink', 'drain-stall', 'node-death', 'tenant-burst', 'straggler', 'admission-greedy'] as const

/** What a `fleet:<mode>` run was (wave-2.md §3.2). */
export const FLEET_RUN_MODES = ['engine', 'cluster', 'epd', 'act1', 'act2', 'daily'] as const

/** The slots of your engine that an installed component can fill (wave-2.md §10.2). */
export const ENGINE_SLOTS = ['scheduler', 'block-manager', 'intake', 'prefix-router', 'tokenizer', 'executor', 'grammar', 'allocator'] as const

export type XpUnitPrefix = keyof typeof XP_UNITS
