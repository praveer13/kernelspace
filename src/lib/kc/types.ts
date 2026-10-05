/**
 * Knowledge-component (KC) graph v1: shared types (docs/specs/wave-1.md §4; PLAN-100X §5.1 V4).
 *
 * Types only. This module emits no runtime code, so every Wave 1 task can import it while the
 * graph data (src/data/kc/*), the resolver (src/lib/kc/resolve.ts) and verify-kc land in parallel.
 */

import type { TrackId } from '@/data/lessons/types'

/**
 * Dotted, lowercase, stable once published: `<track>.<slug>`, e.g. `t1.external-frag`, `r.borrow-rules`.
 * Pattern: /^(r|t[0-7])\.[a-z0-9]+(-[a-z0-9]+)*$/. Renames and splits go through `KcMigration`,
 * never an in-place edit.
 */
export type KcId = string

/** What kind of knowing the KC is. Drives which item shapes can assess it (spec §4.1). */
export type KcKind =
  /** a mechanism or a "why" (paging, admission control) */
  | 'concept'
  /** a computation the learner performs (KV bytes, ridge point, fragmentation %) */
  | 'procedure'
  /** a number that must be reflexive (the latency ladder); usually backed by claims */
  | 'fact'
  /** reading or writing code (Rust moves and borrows, alignment arithmetic) */
  | 'skill'

/**
 * `core`: one of the six threshold KCs the placement walk probes and Today serves first.
 * `anchor`: the Rust-reading anchor (placement's seventh probe; decides whether R is skipped).
 */
export type KcThreshold = 'core' | 'anchor'

export interface Kc {
  id: KcId
  /** Short noun phrase, ≤ 48 characters: "External fragmentation". */
  title: string
  /** Competence statement, ≤ 120 characters, starting "You can": shown by Today and /progress. */
  can: string
  /** Home track. A lab-only KC (`t1.alignment`) keeps its track, has `lessons: []` and names the lab in `labs`. */
  track: TrackId
  kind: KcKind
  /** Lessons that teach it, introducing lesson first. Every id must exist. Empty only for lab-only KCs. */
  lessons: string[]
  /** Prerequisites. The graph over `requires` is a DAG (verify-kc). */
  requires: KcId[]
  /** Composition: this KC is exercised whenever all of these are (implicit credit is untested; v1 stores, never credits). */
  contains?: KcId[]
  /** Symmetric; at most 3 per KC. Today interleaves only inside a confusable set (spec §6.3). */
  confusable?: KcId[]
  threshold?: KcThreshold
  /** Generator family ids whose items assess this KC (src/lib/items/families). */
  gen?: string[]
  /** Claim ids the KC's numbers rest on (src/data/claims), for change cards (S4) and staleness. */
  claims?: string[]
  /** Labs whose checks exercise it, e.g. `rust-allocator`. */
  labs?: string[]
  /** YYYY-MM-DD the KC entered the graph. */
  since: string
}

/** Read-time KC-id migration (renames, splits, merges). Stored evidence is never rewritten. */
export interface KcMigration {
  from: KcId
  /** One id = rename; several = split (evidence credits every target); a shared target across rows = merge. */
  to: KcId[]
  at: string
  why: string
}

/** One notional-machine card per track (V4): the rules the track's model obeys and what it ignores. */
export interface NotionalMachine {
  track: TrackId
  title: string
  /** 3-6 rules, one sentence each. */
  rules: string[]
  /** 2-4 things the model deliberately ignores, one sentence each. */
  ignores: string[]
}

/** The graph as the app consumes it (src/data/kc/index.ts exports one of these). */
export interface KcGraph {
  version: number
  kcs: readonly Kc[]
  migrations: readonly KcMigration[]
  notional: readonly NotionalMachine[]
}
