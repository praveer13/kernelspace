/**
 * SimHost and the sim-task registry v2 (P2): shared types (docs/specs/wave-1.md §10; PLAN-100X §5.3 P2, §7.3).
 *
 * Types only. SimHost hands a sim its config from props, and syncs it to `?cfg=` only on /lab/*.
 * Every task lives in one registry (src/lib/sims/registry.ts); outcome-graded tasks complete only
 * after predict → run → explain.
 */

import type { SimId } from '@/data/lessons/types'
import type { KcId } from '@/lib/kc/types'

/**
 * `lab`: the /lab/:simId page; config round-trips through `?cfg=` and `?machine=`.
 * `embed`: inline in a lesson; config from props, never written to the URL.
 * `phone`: inline below 640 px or on a coarse pointer when the learner keeps "phone mode" on:
 * predict, then the canonical outcome as an SVG chart plus a DOM table, then "queue for laptop".
 */
export type SimHostMode = 'lab' | 'embed' | 'phone'

export interface SimHostProps {
  simId: SimId
  /** Sub-machine (`?machine=` on /lab). */
  machine?: string
  mode: SimHostMode
  /** Initial config in embed and phone modes (the lesson block's `config`). Lab mode reads `?cfg=`. */
  config?: unknown
  /** Registry task ids to show; default: every task of the sim (and machine). */
  taskIds?: readonly string[]
  /** The lesson that embeds the sim (for `from`, ledger refs and the open-full-screen link). */
  lessonId?: string
}

/** What sims read from SimHost instead of useSearchParams (the context value). */
export interface SimHostContextValue {
  simId: SimId
  mode: SimHostMode
  machine: string | undefined
  /** Embed and phone: the prop config. Lab: the decoded `?cfg=` (or null). Read once at mount. */
  initialConfig: unknown
  /** Embed and phone keep the config in memory only. Lab mode: sims write `?cfg=` through the shell's `useWriteCfg`, so the host's own is a no-op. */
  writeConfig(cfg: unknown): void
  /** Embed and phone switch in memory. Lab mode: sims set `?machine=` through the shell's `useSimMachine`, so the host's own is a no-op. */
  selectMachine(machine: string): void
  /** Sims report what they measured; the task panel grades predictions against these. */
  observe(obs: Observation): void
}

/** One measured value a sim exposes for task grading. */
export interface Observation {
  /** Registry `observe` key, e.g. `roof.ridge-ai` or `alloc.frag-pct`. */
  key: string
  value: number | string
  unit?: string
  /**
   * Optional: the config the value was measured under (spec §10.3). Not used yet: the panel grades the
   * first observation of its key after the commit and does not compare hashes, so a sim must not re-emit
   * for a config it has already left.
   */
  configHash?: string
}

export type PredictSpec =
  /** `log: true` scores by |log10(pred/actual)| (orders of magnitude), else by relative error */
  | { kind: 'numeric'; prompt: string; unit: string; tolerance: { rel?: number; abs?: number }; log?: boolean }
  | { kind: 'choice'; prompt: string; options: readonly { id: string; text: string }[] }

/** One-line explanation, self-checked against three ideas (≥ 8 words to unlock the reveal). */
export interface ExplainSpec {
  prompt: string
  model: string
  ideas: [string, string, string]
}

export interface SimTaskDef {
  /** Stable registry id, e.g. `roof.b200-ridge`. The ledger ref is `sim:<simId>/<id>`. */
  id: string
  simId: SimId
  machine?: string
  /** `outcome`: predict → run → explain (P2). `legacy`: the old state-detected task, display only, 0 XP. */
  kind: 'outcome' | 'legacy'
  /** ≤ 80 characters. */
  title: string
  /** What to set up and run, in one or two sentences. */
  setup: string
  kcs: KcId[]
  predict?: PredictSpec
  /** The Observation key that answers the prediction. */
  observe?: string
  explain?: ExplainSpec
  /** "What just happened": hidden until the task is complete. */
  note?: string
  /** Phone mode: the pure-model key that yields the canonical outcome (chart + table). */
  phone?: { canonical: string }
  /** Lessons whose exercise blocks list this task. */
  lessons?: readonly string[]
  /** The pre-registry task id this replaces, so an earlier completion still shows. */
  legacyId?: string
}

/** A DOM mirror of a canvas or play (verify-plays checks one exists per canvas it lists). */
export interface MirrorTable {
  caption: string
  columns: readonly string[]
  rows: readonly (readonly (string | number)[])[]
  /** One short sentence announced through aria-live on a discrete change (never per frame, ≤ 1/s). */
  announce?: string
}
