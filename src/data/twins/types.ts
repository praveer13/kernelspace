import type { QuizQuestion } from '@/components/QuizBlock'
import type { KcId } from '@/lib/kc/types'

/**
 * A production twin (docs/specs/wave-3.md §9): the file in a production codebase that does what a lab's learner just
 * wrote, at the ref its claim pins. Each `src/data/twins/<labId>.ts` default-exports one and exports its questions as
 * `TWIN_ITEMS` (the `twin` pool of verify:items reads that list by readdir). The file name is the lab id.
 */
export interface TwinModule {
  labId: string
  /** The lab's number as its refs spell it: '07' (refs `item:lab07.twin.<n>`). */
  labNo: string
  /** The status claim that pins the upstream release (`pin {repo, ref}`, ttlDays 60); its `verifiedAt` and staleness show on the panel. */
  claimId: string
  /** The file at the claim's pinned ref, relative to the repository root. */
  path: string
  /** The functions the questions trace. */
  symbols: string[]
  /** The line shown above the questions: "You just wrote the structure SGLang made its default on 2026-09-29." */
  youWrote: string
  /** Exactly three, in the order they are played. */
  items: TwinItem[]
}

/** One tracing question (a why per option; pool `twin`). */
export interface TwinItem {
  /** The ref without its `item:` prefix: `lab07.twin.1`, counting from 1 in play order. */
  id: string
  q: QuizQuestion
  kcs: KcId[]
}
