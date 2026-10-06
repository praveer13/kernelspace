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
  /**
   * For a fact that belongs to one release of one project (an engine's default, a model's config): the
   * repository and the exact release tag or commit it was read at. `source.url` must contain `ref`, so the
   * quote can be re-read at the same bytes. Required of status claims about engine settings (W13).
   */
  pin?: { repo: string; ref: string }
}

/** Refs that move, so they pin nothing. */
const MOVING_REFS = new Set(['main', 'master', 'head', 'latest', 'stable', 'nightly', 'dev', 'trunk'])

/** A status claim about an engine's settings: the In-production card's rows (`production.vllm.*`, `production.sglang.*`). */
export function isEngineSetting(claim: Pick<Claim, 'id' | 'kind'>): boolean {
  return claim.kind === 'status' && /^production\.(vllm|sglang)\./.test(claim.id)
}

/** What is wrong with a claim's pin, if anything: a pinned claim needs a real ref its source url contains, and an engine setting needs a pin. */
export function pinProblems(claim: Claim): string[] {
  const { pin } = claim
  if (!pin) return isEngineSetting(claim) ? ['a status claim about engine settings needs pin {repo, ref} (the release it was read at)'] : []
  const out: string[] = []
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin.repo)) out.push(`pin.repo "${pin.repo}" is not owner/name`)
  if (!pin.ref.trim()) out.push('pin.ref is empty')
  else if (MOVING_REFS.has(pin.ref.trim().toLowerCase())) out.push(`pin.ref "${pin.ref}" is a moving ref; use a release tag or a commit sha`)
  if (claim.kind === 'derived' || claim.kind === 'synthetic') out.push(`${claim.kind} claims have no source to pin`)
  else if (!claim.source) out.push('a pinned claim needs a source')
  else if (pin.ref.trim() && !claim.source.url.includes(pin.ref)) out.push(`source.url does not contain pin.ref "${pin.ref}": ${claim.source.url}`)
  return out
}
