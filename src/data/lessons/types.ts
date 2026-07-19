/**
 * Kernelspace lesson content model (lesson.md §2 "The Block System").
 * Every lesson is a typed data file under src/data/lessons/<track>/<slug>.ts.
 */

import type { QuizQuestion } from '@/components/QuizBlock'
import type { CodeTab } from '@/components/CodeBlock'

export type TrackId = 't0' | 't1' | 't2' | 't3' | 't4' | 't5'

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

export interface DiagramBlock {
  type: 'diagram'
  /** mono figure caption, e.g. `fig 1 — stack growth` */
  caption: string
  nodes: DiagramNode[]
  edges?: DiagramEdge[]
  steps: DiagramStep[]
  /** viewBox height in arbitrary units (width fixed 100). default 60 */
  height?: number
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
  title: string
  /** guided tasks checklist (3–5 items) */
  tasks: string[]
  /** collapsed "what just happened" explanation */
  note?: string
}

/** OS ≡ LLM isomorphism panel (lesson.md §2.8). */
export interface IsomorphismPair {
  os: string
  osLine: string
  llm: string
  llmLine: string
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

/* ------------------------------ lesson ------------------------------ */

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
  blocks: ContentBlock[]
}

/** Heading extracted from blocks for the "ON THIS PAGE" rail. */
export interface LessonHeading {
  id: string
  text: string
  level: 2 | 3
}
