import { useState } from 'react'
import type { BootModel, BootStep } from '@/lib/boot/model'
import type { Confidence, ItemResponse } from '@/lib/ledger/types'

/** What a step hands the shell when the learner commits an answer. The shell stamps ref, rev and `ms`. */
export interface Commit {
  kind: 'item' | 'predict'
  ok: boolean
  score: number
  conf?: Confidence
  seed?: number
  data: ItemResponse['data']
}

/** What every step gets from the Boot shell. */
export interface StepProps {
  model: BootModel
  /** The step-1 guess in tok/s, once locked in. */
  guess: number | null
  /** Write one graded event for `step`; the step's time on task is measured by the step's own clock. */
  commit: (step: BootStep, ms: number, c: Commit) => void
  next: () => void
}

/** Milliseconds since the step mounted, for the `ms` on its events. */
export function useStepClock(): () => number {
  const [start] = useState(() => performance.now())
  return () => Math.round(performance.now() - start)
}

/** Keys 1 to 3 set confidence for the step that holds focus, unless the key is going into a text field. */
export function confidenceKey(e: React.KeyboardEvent, set: (c: Confidence) => void): void {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return
  const t = e.target as HTMLElement
  if (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && ['text', 'number', 'search'].includes((t as HTMLInputElement).type))) return
  const level = (['guess', 'think', 'sure'] as const)[Number(e.key) - 1]
  if (level) {
    e.preventDefault()
    set(level)
  }
}

/** "1,234", "1 234" and "1234.5" all read as numbers; anything else is null. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/[,\s_]/g, '')
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
