/**
 * Kernelspace lesson content model (lesson.md §2 "The Block System").
 * Every lesson is a typed data file under src/data/lessons/<track>/<slug>.ts.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { CodeTab } from '@/components/CodeBlock'
import type { AuthoredItem, ConstructedPrompt } from '@/lib/items/types'

export type TrackId = 'r' | 't0' | 't1' | 't2' | 't3' | 't4' | 't5' | 't6' | 't7'

/** The nine simulator routes (lab/playground scope). */
export type SimId =
  | 'sim-memory'
  | 'sim-allocator'
  | 'sim-vm'
  | 'sim-roofline'
  | 'sim-wgsl'
  | 'sim-quant'
  | 'sim-kv'
  | 'sim-batching'
  | 'sim-engine'

/** Exercise type as enumerated in curriculum.md §3. */
export type ExerciseKind = 'quiz' | 'sim' | 'code' | 'read' | 'quiz+sim' | 'read+quiz'

/* ------------------------------ blocks ------------------------------ */

/**
 * `prose` — markdown-lite rendered by the lesson engine:
 *   `## H2` / `### H3`, paragraphs (blank-line separated),
 *   `- ` bullet lists, `1. ` ordered lists, GitHub-style pipe tables,
 *   inline **bold**, *em*, `code`, [label](https://url).
 */
export interface ProseBlock {
  type: 'prose'
  md: string
}

export interface CodeBlockData {
  type: 'code'
  filename?: string
  /** Compare tabs (Python | Java | C | Rust …) — defaults to single `code`/`lang`. */
  tabs?: CodeTab[]
  code?: string
  lang?: string
  highlightLines?: number[]
  /** Annotation chips under the header, e.g. `no GC` · `0 allocs`. */
  chips?: string[]
}

export type CalloutVariant = 'analogy' | 'info' | 'warning' | 'segfault' | 'isomorphism'

export interface CalloutBlock {
  type: 'callout'
  variant: CalloutVariant
  title?: string
  md: string
}

/** Step-through SVG diagram (lesson.md §2.4). */
export interface DiagramNode {
  id: string
  /** Grid coords on a 100×H viewBox canvas. */
  x: number
  y: number
  w?: number
  h?: number
  label: string
  sub?: string
  /** hex color override; defaults to track color for active, line for idle */
  color?: string
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
}

export interface DiagramStep {
  caption: string
  /** node ids highlighted in this step */
  active?: string[]
  /** edge keys `${from}->${to}` highlighted in this step */
  edges?: string[]
}

/**
 * P1 (Wave 1, docs/specs/wave-1.md §9.2): "what happens next?" before step `step`. The captions of
 * `step` and every later step stay hidden until the learner commits a choice (or skips, once the
 * KC is solid). Writes `item dia:<lessonId>#<blockIndex>` with `data.src: 'diagram'`.
 */
export interface DiagramPredict {
  /** 0-based index of the first step whose caption is withheld; ≥ 1. */
  step: number
  prompt: string
  /** 2-4 options with a parallel `why`; graded by authored index, shuffled per attempt. */
  options: string[]
  correct: number[]
  why: string[]
  kcs: string[]
}

export interface DiagramBlock {
  type: 'diagram'
  /** mono figure caption, e.g. `fig 1 — stack growth` */
  caption: string
  nodes: DiagramNode[]
  edges?: DiagramEdge[]
  steps: DiagramStep[]
  /** viewBox height in arbitrary units (width fixed 100). default 60 */
  height?: number
  /** P1: a prediction gate before a step (Wave 1, T0-T1). */
  predictAt?: DiagramPredict
}

export interface StatChipData {
  value: string
  label: string
  /** plain-English tooltip */
  hint?: string
}

export interface StatlineBlock {
  type: 'statline'
  stats: StatChipData[]
}

export interface QuizBlockData {
  type: 'quiz'
  questions: QuizQuestion[]
}

export interface ExerciseBlock {
  type: 'exercise'
  simId: SimId
  /** Initial simulator machine/mode selected when opening this exercise. */
  machine?: string
  title: string
  /** guided tasks checklist (3–5 items) */
  tasks: string[]
  /** collapsed "what just happened" explanation */
  note?: string
  /**
   * P2 (Wave 1, spec §10): registry task ids (src/lib/sims/registry.ts). When present the block
   * mounts the sim inline through SimHost and lists these live tasks instead of `tasks`.
   */
  taskIds?: string[]
  /** SimHost config for the inline mount (embed and phone modes never touch the URL). */
  config?: unknown
}

/**
 * P1 (Wave 1, spec §9.1): the two prequestions that open a core lesson. Answers are recorded but
 * not marked until the section that teaches them (`revealAt`) or the exit ticket.
 */
export type Prequestion =
  | {
      kind: 'choice'
      q: string
      options: string[]
      correct: number[]
      why: string[]
      /** Heading text of the H2 whose end reveals the answer. */
      revealAt: string
      kcs: string[]
    }
  | {
      kind: 'numeric'
      q: string
      unit: string
      truth: number
      /** Within this factor counts as close (log-scored, like Boot's guess). */
      okWithinFactor: number
      revealAt: string
      kcs: string[]
      /** Claim ids behind `truth`. */
      claims?: string[]
    }

/** P1: prequestions as the lesson's first block (one per lesson). Refs `pre:<lessonId>#<i>`. */
export interface PredictBlock {
  type: 'predict'
  items: Prequestion[]
}

/** W1 (Wave 1, spec §11): a Play → Compose → Code play mounted inline (`/play/<playId>` full screen). */
export interface PlayBlock {
  type: 'play'
  playId: string
  title: string
}

/** OS ≡ LLM isomorphism panel (lesson.md §2.8). */
export interface IsomorphismPair {
  os: string
  osLine: string
  llm: string
  llmLine: string
  /** Where the analogy stops holding — one sentence, shown under the pair. */
  breaks?: string
}

export interface IsomorphismBlock {
  type: 'isomorphism'
  title?: string
  pairs: IsomorphismPair[]
}

export interface DeepdiveBlock {
  type: 'deepdive'
  title: string
  md: string
}

/** Dated primary-source reading card used by the per-track paper spine. */
export interface FieldNoteBlock {
  type: 'field-note'
  title: string
  source: string
  href: string
  /** Publication label, e.g. `OSDI '22` or `arXiv 2024`. */
  published: string
  /** Last curriculum verification in YYYY-MM form. */
  verified: string
  /** One paragraph explaining why this source belongs at this exact point. */
  md: string
}

export type ContentBlock =
  | ProseBlock
  | CodeBlockData
  | CalloutBlock
  | DiagramBlock
  | StatlineBlock
  | QuizBlockData
  | ExerciseBlock
  | IsomorphismBlock
  | DeepdiveBlock
  | FieldNoteBlock
  | PredictBlock
  | PlayBlock

/* ------------------------------ lesson ------------------------------ */

/**
 * V5 (Wave 1, spec §8.1): what the exit ticket draws on besides the lesson's checkpoint items.
 * A lesson with `ticket` renders its `quiz` block as the exit ticket.
 */
export interface LessonTicket {
  /** `ticket` (3 items) or `spiral` (8 items, a track's last lesson: t2.l7 in Wave 1). */
  form: 'ticket' | 'spiral'
  /** Self-checked constructed responses: the non-MCQ item when no generator covers the lesson's KCs. ≥ 1. */
  cr: ConstructedPrompt[]
  /** Spiral only: authored items on earlier KCs of the track (refs `item:<id>`). */
  spiral?: AuthoredItem[]
}

export interface Lesson {
  /** Canonical id used by the progress store: `t1.l3`. */
  id: string
  /** Human slug from curriculum.md — also resolves at /lesson/:lessonId. */
  slug: string
  trackId: TrackId
  /** 1-based position within the track. */
  index: number
  title: string
  minutes: number
  /** One-line hook shown in lesson rows (curriculum.md §3). */
  hook: string
  exercise: ExerciseKind
  /** Simulator id when the exercise is sim-backed. */
  simId?: SimId
  /** T2.L7-style exam lesson (amber chip, quiz-gated completion). */
  exam?: boolean
  /** Landscape-sensitive lesson freshness marker, YYYY-MM. */
  verifiedAt?: string
  blocks: ContentBlock[]
  /** V4 (Wave 1): the KCs this lesson teaches, primary first (src/data/kc). The ticket draws on them. */
  kcs?: string[]
  /** V5 (Wave 1): present on T0-T2 lessons; turns the checkpoint into the exit ticket. */
  ticket?: LessonTicket
}

/** Heading extracted from blocks for the "ON THIS PAGE" rail. */
export interface LessonHeading {
  id: string
  text: string
  level: 2 | 3
}
