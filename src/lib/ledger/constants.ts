import { FACT_UNITS } from '../economy'

/**
 * Logical data-model version (spec §3). Bump when event semantics or required fields change.
 * 4 = Wave 1 (wave-1.md §3.1): new refs, data shapes and lesson states. A Wave 0b bundle goes read-only on it.
 * 5 = Wave 2 (wave-2.md §3.1): incident and fleet-run refs and data, `packet:` acks, two item sources and four
 * working keys. A Wave 1 bundle would drop those at outbox recovery and cross-tab sync, so it goes read-only.
 * 6 = Wave 3 (wave-3.md §3.1): Prove-it v2 and provenance `proved`, the item sources `form` and `play`, form keys,
 * play metrics and levels, Fleet Week receipts and the `fw:runs` and `profile:background` working keys. A Wave 2
 * bundle would drop those at outbox recovery and cross-tab sync, so it goes read-only.
 */
export const SCHEMA_VERSION = 6

/**
 * Aggregate format version; an unknown one means "rebuild from the ledger". Versions 1 (Wave 0b), 2 (Wave 1) and
 * 3 (Wave 2) are upgraded in place at hydrate, so the first paint after a deploy is never empty (`upgradeAggregate`).
 */
export const AGGREGATE_VERSION = 4

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

/** The learner's background, an optional local pick (wave-3.md §3.2; the `profile:background` working key). */
export const BACKGROUNDS = ['jvm', 'backend', 'sre', 'ml', 'student', 'other'] as const

/*
 * The codec's bounds on a Prove-it v2 event and a Fleet Week act's data (wave-3.md §3.2), in one place (D35, D48). The
 * codec refuses a whole event past them; the façade (progress.ts) holds what it writes to them without loading the
 * codec, and the donation (learner/redact.ts) and the partner report (learner/outcomes.ts) read them.
 */

/** A Prove-it v2 template id (`data.qid`) is 1 to this many characters. */
export const MAX_QID_LENGTH = 40
/** A Prove-it v2 `answer` or `actual` that is a list holds at most this many ids. */
export const MAX_PROVE_IDS = 12
/** A Prove-it v2 attempt makes 1 to this many verb calls (`data.calls`). */
export const MAX_PROVE_CALLS = 12
/** A Fleet Week act cites at most this many run records (`data.runs`). */
export const MAX_ACT_RUNS = 20
/** A Fleet Week act's self-review rubric: these four criteria, each a whole score 0 to 3 (`data.rubric`, §10.4). */
export const RUBRIC_KEYS = ['capacity', 'slo', 'cost', 'failure'] as const

export type XpUnitPrefix = keyof typeof XP_UNITS
