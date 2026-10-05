/**
 * Forge template v2 (F1): the host side of the per-check ABI (docs/specs/wave-1.md §12; PLAN-100X §5.5 F1).
 *
 * Types only. labs/kit v2 exports `ks_abi_version`, `ks_run` (driven by a line-based input:
 * `v 2`, `list`, `only <id>`, `seed <u32>`), `ks_alloc`, `ks_free`, `ks_panic_msg` and
 * `ks_trace_drain`; systems labs also export `ks_invoke` with a `probe` verb. Zero imports stays
 * an invariant. The host runs every check in a fresh instance of one compiled Module, in the lab
 * worker, with a 2 s budget per check.
 */

export type AbiVersion = 1 | 2

/** One check as the module lists it (`list` runs no student code). */
export interface CheckMeta {
  id: string
  label: string
  /** F2 stage the check belongs to (1 = the two-minute win). */
  stage: number
  /** The check draws its inputs from the seed; false = fixed inputs (seed ignored). */
  seeded: boolean
}

/** Reply to `v 2\nlist\n`. */
export interface ListReply {
  /** `<labId>` or `<labId>@reference` (a reference build: never credited). */
  lab: string
  /** The lab's content version (the v1 report's `version`). */
  version: number
  abi: 2
  checks: CheckMeta[]
}

export type CheckStatus = 'pass' | 'fail' | 'trap' | 'timeout'

export interface CheckResult {
  id: string
  label: string
  status: CheckStatus
  /** The check's own message; for a trap, "not implemented yet" plus the panic message. */
  msg: string
  stage?: number
  /** The seed the check ran on (seeded checks). */
  seed?: number
  /** The seed was drawn at grade time (counts toward `unseen`). */
  fresh?: boolean
  /** Wall time in the worker, excluding instantiation. */
  ms?: number
  /** `ks_panic_msg()` after a trap, e.g. "not yet implemented: first-fit, align, split" (≤ 500 chars). */
  panic?: string
  /** `ks_trace_drain()` after the check (≤ 16 KiB). */
  trace?: string
}

/** What the host hands ForgeLab, Fleet admission and the leaderboard after a v1 or v2 run. */
export interface LabRunReport {
  /** The lab id without any `@reference` suffix. */
  lab: string
  /** Built with `--features reference`: the run is shown, never credited (ForgeLab, validateModule, leaderboard). */
  reference: boolean
  abi: AbiVersion
  version: number
  checks: CheckResult[]
  /** `fresh`: every seeded check ran on a seed drawn at grade time. `default`: the crate's fixed seeds (practice). */
  seeds: 'fresh' | 'default'
  /** Total wall time including instantiation. */
  ms: number
}

/** One row of the host compatibility table (src/lib/forge/abi.ts). */
export interface AbiCompat {
  abi: AbiVersion
  /** Per-check isolation: a trap or a spin costs one check, not the run. */
  perCheck: boolean
  seeds: boolean
  trace: boolean
  /** `ks_invoke probe <seed>` (systems labs). */
  probe: boolean
  /** Best provenance a run on this ABI can earn: v1 modules ignore seeds, so `lab-green` at most. */
  maxProvenance: 'lab-green' | 'unseen'
  /** Shown on the result panel, e.g. "built from the v1 template: rebuild for per-check results". */
  note: string
}
