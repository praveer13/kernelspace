/**
 * A sourced number (PLAN-100X §5.2 S2). Every spec, price and benchmark the course
 * shows should resolve to one of these, so staleness is visible instead of silent.
 */
export type ClaimKind = 'spec' | 'price' | 'benchmark' | 'status' | 'derived' | 'synthetic'

export interface Claim {
  /** Dotted id, e.g. `hw.h100-sxm.hbm-bw`. Stable once published. */
  id: string
  kind: ClaimKind
  value: number | string
  /** e.g. `TB/s`, `GB`, `USD/GPU-hr`. */
  unit?: string
  /** Short human label, e.g. "H100 SXM HBM bandwidth". */
  label: string
  /** Required unless `kind` is `derived` or `synthetic`. `quote` (the source's own words) is required for `spec` and `price` claims. */
  source?: { url: string; title: string; quote?: string; row?: string }
  /** Last time a person checked the value against the source, YYYY-MM-DD. */
  verifiedAt: string
  /** Shown as "stale since …" after this many days (status 60, price 90, benchmark 180, spec 365). */
  ttlDays: number
  /** For `derived`: the claim ids it is computed from and the formula, reproducible in CI. */
  derived?: { from: string[]; formula: string }
  /** Conditions under which the number holds (model, precision, batch, context…). */
  boundary?: string
  /** Conflicting official figures, explained. */
  discrepancy?: string
}
