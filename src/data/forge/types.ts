/**
 * The per-lab data contract of the Forge (docs/specs/wave-2.md §13.1): everything a lab authors for PRIMM,
 * the hint ladder and Prove-it, as one `ForgeBundle` the panels take instead of importing a lab's modules.
 *
 * A lab is `src/data/forge/<labId>/index.ts` with a `default` export of type `ForgeBundle`; the directory name
 * is the lab id (`src/data/forge/index.ts` finds them). Types only: the shapes below used to live in lab 01's
 * `primm.ts`, `ladder.ts` and `prove.ts`, which re-export them so no import path changed.
 */

import type { AuthoredItem } from '@/lib/items/types'

/* ------------------------------------------------------------------ */
/* Stages and PRIMM                                                     */
/* ------------------------------------------------------------------ */

export interface StageInfo {
  /** 1-based; matches `stage` on the checks in labs.ts (and the module's `list` reply). */
  n: number
  title: string
  /** Nominal minutes; every stage is at most 25 (PLAN §5.0). */
  minutes: number
  /** What the stage builds, one line. */
  goal: string
}

export type PrimmStepId = 'predict' | 'run' | 'investigate' | 'modify' | 'make'

/** A step of the walk, in order. `run` has no item of its own: its evidence is the run's `item`. */
export interface PrimmStep {
  id: PrimmStepId
  title: string
  blurb: string
}

type KcList = AuthoredItem['kcs']

interface ItemBase {
  /** `lab01.primm.p1`; the ledger ref is `item:<id>`. */
  id: string
  step: 'predict' | 'investigate' | 'modify'
  /** Nominal seconds (XP and session sizing, spec §8.4). */
  nsec: number
}

/** A multiple-choice item. Options are shuffled per attempt by the panel; the answer is the authored index. */
export interface ChoicePrimm extends ItemBase {
  kind: 'choice'
  item: AuthoredItem
}

/** A numeric answer: `numeric` is exact (the truth is fixed), `estimate` is a Fermi guess against a computed truth. */
export interface NumberPrimm extends ItemBase {
  kind: 'numeric' | 'estimate'
  prompt: string
  unit: string
  kcs: KcList
  /** `numeric`: the exact answer. */
  truth?: number
  /** `estimate`: right when within this factor of the truth, either way. */
  factor?: number
  /** Wrong answers that name a mistake, `numeric` only. */
  lures?: { value: number; miss: string; message: string }[]
  /** Said after the answer, whatever it was. */
  explain: string
}

export type PrimmItem = ChoicePrimm | NumberPrimm

/* ------------------------------------------------------------------ */
/* The reference run                                                    */
/* ------------------------------------------------------------------ */

/** A run's knobs, JSON-safe: the Modify step changes one and runs again. */
export type RunConfig = Readonly<Record<string, string | number | boolean>>

/** One frame of a run's strip. */
export interface RunFrame {
  /** Ops (or steps) applied so far. */
  op: number
  /** Cells of the strip, each a fill in [0, 100]. */
  cells: readonly number[]
  /** The live numbers beside the strip, e.g. `{ label: 'live bytes', value: '12.4 KiB' }`. */
  stats: readonly { label: string; value: string }[]
  /** Spoken for the strip (its `aria-label`) at this frame. */
  alt: string
}

/** A finished run, computed whole; the panel only walks its frames. */
export interface RunResult {
  config: RunConfig
  /** Ops (or steps) in the run. */
  total: number
  /** What the Run step records as observed: ops completed, tokens, shared blocks at the peak, ... */
  value: number
  /** The most `value` could be (the Run step records both). */
  truth: number
  /** The run finished without the failure the lab teaches. */
  clean: boolean
  frames: readonly RunFrame[]
  /** One sentence for the caption and the Modify reveal. */
  summary: string
}

/**
 * The in-browser reference of the Run and Modify steps, as data: a labelled stand-in, never the lab's own check.
 * `run` is pure and deterministic in `config`.
 */
export interface ReferenceRunSpec {
  /** The Run step's own evidence item (`item:<id>`): an observation, no KCs. */
  item: { id: string; nsec: number }
  /** Names a run in the header, e.g. "Reference: first-fit with coalescing". */
  title: (config: RunConfig) => string
  /** The honest line under the strip: what this run is and is not. */
  disclaimer: string
  /** The config whose finished run counts as the Run step's evidence. */
  reference: RunConfig
  /** The Run step's second strip, and often the subject of the first prediction. */
  baseline?: RunConfig
  run: (config: RunConfig) => RunResult
}

/* ------------------------------------------------------------------ */
/* The hint ladder                                                      */
/* ------------------------------------------------------------------ */

export interface LessonLink {
  lessonId: string
  /** The H2's text, as written in the lesson. */
  h2: string
  /** The H2's id on the lesson page (the lesson's slugify of `h2`); `verify:mentor` checks it exists. */
  anchor: string
}

export interface CheckLadder {
  checkId: string
  r0: { prompt: string; ideas: readonly string[] }
  r1: { text: string; link: LessonLink }
  /** `fn` is the check's function in the zip's `src/lib.rs`; the text names it. */
  r2: { text: string; fn: string }
  /** Pseudo-code, one line per `\n`. */
  r3: string
  r4: string
}

export interface WalkStep {
  /** 1-based position in the trace (or script). */
  n: number
  op: string
  /** What the learner's code did; `-` when there is no trace of it. */
  yours: string
  /** What the reference says about that op. */
  reference: string
  /** The first op at which the learner's trace breaks the harness's rules. */
  diverges: boolean
  note?: string
}

export interface Walkthrough {
  /** `trace`: replayed from the learner's `ks_trace_drain` lines. `script`: the check's op sequence on the reference alone. */
  source: 'trace' | 'script'
  steps: WalkStep[]
  /** The step number of the first divergence, or null. */
  divergedAt: number | null
  headline: string
  /** Ops of the trace before the steps shown (they agree with the reference). */
  skipped: number
}

/* ------------------------------------------------------------------ */
/* Prove it                                                             */
/* ------------------------------------------------------------------ */

export interface ProveQuestion {
  /** Short id: what `ProveData.qids` records. The Today follow-up ref is `followUpRef(id)`. */
  id: string
  /** Markdown-lite: backticks mark code. */
  prompt: string
  /** What a good answer says. Shown after the learner has written their own. */
  model: string
  /** Three points to check the learner's answer against. */
  ideas: readonly [string, string, string]
  kcs: readonly string[]
}

/* ------------------------------------------------------------------ */
/* The bundle                                                           */
/* ------------------------------------------------------------------ */

export interface ForgeBundle {
  /** The lab's id in labs.ts, and the name of its directory under `src/data/forge/`. */
  labId: string
  /** The Make step's stages; `n` matches the checks' `stage` in labs.ts. */
  stages: StageInfo[]
  primm: {
    items: PrimmItem[]
    steps: PrimmStep[]
    run: ReferenceRunSpec
  }
  /** R0 to R4 for each required check, in the order the lab authors them; empty for a lab with no ladder yet. */
  ladder: CheckLadder[]
  /** At least 6; `PROVE_PICK` of them are drawn per attempt. */
  prove: ProveQuestion[]
  /** The bottom-out walkthrough. `trace` is the lines of the module's `ks_trace_drain`. Optional per lab. */
  walkthrough?: (checkId: string, trace: string[]) => Walkthrough
  /** The title prefix of an Ask-a-human post, e.g. "[lab 02]". */
  discussionsLabel: string
}
