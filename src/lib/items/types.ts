/**
 * Items and seeded generators (K1): shared types (docs/specs/wave-1.md §5; PLAN-100X §5.7 K1).
 *
 * Types only. One item model serves every graded surface in Wave 1: Today, exit tickets, test-out,
 * placement, prequestions and the change-card items. A generated item is an `Instance` of a `Gen`
 * family; an authored item (a lesson checkpoint question, a constructed response, a placement
 * anchor) is wrapped as a `PlayableItem` so one player renders and grades both.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { KcId } from '@/lib/kc/types'

/**
 * Fading (van Gog & Sweller 2015): 0 = worked example, the learner completes the last step;
 * 1 = faded, one middle step blanked; 2 = independent, single KC; 3 = transfer (two KCs, or a
 * changed surface such as a different unit or hardware row). A 3-up/1-down staircase per
 * (KC, family) keeps expected accuracy near 0.79 (spec §5.3).
 */
export type Level = 0 | 1 | 2 | 3

export type ParamValue = number | string | boolean
/** An instance's parameters. JSON-safe; the fingerprint and the replay both depend on them. */
export type Params = Readonly<Record<string, ParamValue>>

/** One run of prompt text. Values and claims render as chips, and the DOM always carries their text. */
export type PromptPart =
  | { t: 'text'; text: string }
  /** a scenario number (synthetic or derived): rendered with its unit */
  | { t: 'value'; value: number; unit?: string; digits?: number }
  /** a sourced number: rendered as a tappable claim chip (ClaimValue) */
  | { t: 'claim'; claim: string; scale?: number; unit?: string }
  | { t: 'code'; code: string; lang?: string }

export interface SolutionStep {
  text: PromptPart[]
  result?: { value: number; unit?: string }
  /** level 0-1: the step the learner fills in instead of reading */
  blank?: boolean
}

export interface Prompt {
  stem: PromptPart[]
  /** Givens, rendered as a definition list (also the screen-reader text of any chip row). */
  givens?: { label: string; value: PromptPart }[]
  /** Worked steps shown before the question at levels 0 and 1. */
  worked?: SolutionStep[]
}

/** Relative tolerance (0.02 = ±2 %), absolute tolerance, or both (either satisfies). */
export interface Tolerance {
  rel?: number
  abs?: number
}

/** A unit the learner may answer in, with its factor to the answer's canonical unit (KiB → bytes = 1024). */
export interface UnitChoice {
  unit: string
  factor: number
}

export interface ChoiceOption {
  /** Stable within the instance; never the display position. */
  id: string
  text: string
  /** Why this option is right, or which misconception it encodes. Shown after submit. */
  why: string
  /** Misconception id when the option is a lure (`kv.priced-fp16`). */
  miss?: string
}

export type AnswerSpec =
  /** an exact computation */
  | { kind: 'numeric'; truth: number; unit: string; tolerance: Tolerance; units?: UnitChoice[] }
  /** a Fermi estimate, log-scored; `interval` asks for a 90 % interval too */
  | { kind: 'estimate'; truth: number; unit: string; okWithinFactor: number; interval: boolean }
  /** one or more options; options are shuffled per seed by the player, graded by id */
  | { kind: 'choice'; options: ChoiceOption[]; correct: string[]; multi?: boolean }

export interface Instance {
  family: string
  /** The family's `version` when made; part of the fingerprint. */
  version: number
  variant: string
  /** uint32 */
  seed: number
  level: Level
  params: Params
  kcs: KcId[]
  prompt: Prompt
  answer: AnswerSpec
  /** Claims the instance used, as `id@verifiedAt`, so a claim update changes the fingerprint. */
  claims: string[]
  /** `rev32(stableStringify({family, version, variant, level, params, claims}))` (ledger stable.ts). */
  rev: string
  /** Nominal seconds: session sizing and XP (spec §8.4). */
  nsec: number
}

export type Response =
  | { kind: 'numeric'; value: number; unit?: string }
  /** `lo`/`hi` are the learner's 90 % interval, both or neither */
  | { kind: 'estimate'; value: number; lo?: number; hi?: number }
  | { kind: 'choice'; picks: string[] }

export interface Diagnosis {
  /** Misconception id, `<family>.<slug>`: `kv.priced-fp16`, `roofline.inverted-ridge`. */
  id: string
  /** response / truth when a ratio rule matched */
  ratio?: number
  /** One sentence, second person: "You priced FP16: this cache is FP8, 1 byte per value." */
  message: string
}

export interface Grade {
  ok: boolean
  /** In [0, 1]. Numeric: 1 or 0. Estimate: max(0, 1 − |log10(x/t)| / log10(okWithinFactor · 5)). Choice: 1 or 0. */
  score: number
  /** One or two sentences: the verdict, then the key step. Never the full solution (that is `solution`). */
  feedback: string
  diagnosis?: Diagnosis
  /** |log10(response / truth)| for numeric and estimate answers. */
  logErr?: number
  /** Present when the learner gave a 90 % interval: Winkler score in log10 space (α = 0.1). */
  interval?: { hit: boolean; score: number }
}

/** A ratio rule: when a wrong answer is `ratio` times the truth (within `tol`, default ±2 %), say why. */
export interface RatioRule {
  id: string
  /** A fixed ratio, or one computed from the instance (GQA: query heads / KV heads); null = rule does not apply. */
  ratio: number | ((inst: Instance) => number | null)
  tol?: number
  message: string | ((inst: Instance) => string)
}

export interface VariantSpec {
  id: string
  title: string
  kcs: KcId[]
  levels: readonly Level[]
  nsec: number
}

/** A lesson worked example the family must reproduce exactly (verify-generators fails on drift). */
export interface Pin {
  name: string
  /** Where the example is taught, e.g. `t5.l4` or `boot`. */
  source: string
  make: () => Instance
  truth: number
  tolerance?: Tolerance
}

/**
 * A seeded generator family. `make`, `grade` and `solution` are pure: no Math.random, no Date, no
 * DOM, no network. Real-world constants come only from src/data/claims (claimNumber, atlasRow);
 * scenario numbers are synthetic grids declared in the family (spec §5.4).
 */
export interface Gen {
  id: string
  version: number
  title: string
  /** Union of the variants' KCs. */
  kcs: readonly KcId[]
  variants: readonly VariantSpec[]
  ratioRules: readonly RatioRule[]
  /** Deterministic: the same (seed, level, variant) gives a deep-equal Instance in every runtime. */
  make(seed: number, level: Level, variant?: string): Instance
  grade(inst: Instance, response: Response): Grade
  solution(inst: Instance): SolutionStep[]
  pins: readonly Pin[]
}

/** A self-checked constructed response (V5, P1): write, reveal the model answer, tick the ideas you covered. */
export interface ConstructedPrompt {
  /** Unique within its lesson; the ledger ref is `cr:<lessonId>#<index>`. */
  prompt: string
  /** The model answer, ≤ 60 words. */
  model: string
  /** Exactly three key ideas; "correct" means at least two ticked. */
  ideas: [string, string, string]
  kcs: KcId[]
}

/** An authored item outside any lesson checkpoint (placement anchors, spiral items): ref `item:<id>`. */
export interface AuthoredItem {
  /** Globally unique, dotted: `r.anchor.e0502-1`. */
  id: string
  q: QuizQuestion
  kcs: KcId[]
}

/** What the item player accepts. */
export type PlayableItem =
  | { source: 'gen'; inst: Instance }
  | { source: 'quiz'; lessonId: string; qi: number; q: QuizQuestion; kcs: KcId[] }
  | { source: 'cr'; lessonId: string; index: number; cr: ConstructedPrompt }
  | { source: 'item'; item: AuthoredItem }
