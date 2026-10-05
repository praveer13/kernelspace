/**
 * Feedback: the verdict and what explains it (docs/specs/wave-1.md §6.8, §16.2). The verdict sits in an
 * `aria-live="polite"` region that is in the DOM before it has anything to say, so the change is
 * announced. Below it, the why of the picked option and of the key (choice), the diagnosis (numeric and
 * estimate), the explanation (authored questions) and the steps, collapsed. Every state carries an icon
 * and words, never colour alone.
 */
import { Check, ChevronDown, X } from 'lucide-react'
import type { RefObject } from 'react'
import { formatNumber } from '@/lib/items/units'
import { OPTION_LETTERS, type PlayView } from '@/lib/items/play'
import type { Grade, SolutionStep } from '@/lib/items/types'
import { cn } from '@/lib/utils'
import { StepList } from './PromptView'

interface FeedbackProps {
  view: PlayView
  /** Null until the item is graded. */
  grade: Grade | null
  /** The learner's picked option ids (choice). */
  picks: readonly string[]
  /** Prequestions: the answer is saved and the verdict shows later. */
  deferred?: boolean
  /** The family's solution steps, when it has them. */
  steps?: readonly SolutionStep[]
  stepsOpen: boolean
  onToggleSteps: () => void
  toggleRef: RefObject<HTMLButtonElement | null>
  /** Prefix for the ids this component owns. */
  idBase: string
}

function verdictLine(view: PlayView, grade: Grade): string {
  if (view.kind !== 'choice') return grade.feedback
  if (grade.ok) return 'Correct.'
  const letters = view.options.flatMap((o, i) => (view.correct.includes(o.id) ? [OPTION_LETTERS[i]] : []))
  return `Not quite. The answer is ${letters.join(' and ')}.`
}

export default function Feedback({ view, grade, picks, deferred, steps, stepsOpen, onToggleSteps, toggleRef, idBase }: FeedbackProps) {
  const hasSteps = grade !== null && !deferred && !!steps && steps.length > 0
  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" aria-atomic="true">
        {grade && deferred && <p className="text-body-sm text-text-2">Saved. The answer appears as you read.</p>}
        {grade && !deferred && (
          <p className={cn('flex items-start gap-2 rounded-md border-l-2 bg-surface-2 px-3.5 py-2.5 text-body-sm text-text-1', grade.ok ? 'border-accent' : 'border-danger')}>
            {grade.ok ? <Check size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <X size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
            <span className="min-w-0 break-words">{verdictLine(view, grade)}</span>
          </p>
        )}
      </div>

      {grade && !deferred && (
        <>
          {/* without a diagnosis the verdict line already ends with the answer */}
          {!grade.ok && grade.diagnosis && (view.kind === 'numeric' || view.kind === 'estimate') && (
            <p className="text-body-sm text-text-2">
              The answer is <span className="font-mono text-text-1">{formatNumber(view.answer.truth)} {view.answer.unit}</span>.
            </p>
          )}
          {grade.interval && (
            <p className="text-body-sm text-text-2">
              {grade.interval.hit ? 'Your 90 % range held the truth.' : 'Your 90 % range missed the truth.'}
            </p>
          )}
          {view.kind === 'choice' && <Whys view={view} picks={picks} />}
          {view.explanation && (
            <p className={cn('rounded-md border-l-2 bg-surface-2 px-3.5 py-2.5 text-body-sm text-text-2', grade.ok ? 'border-accent' : 'border-amber')}>{view.explanation}</p>
          )}
          {hasSteps && (
            <div>
              <button
                ref={toggleRef}
                type="button"
                aria-expanded={stepsOpen}
                aria-controls={`${idBase}-steps`}
                onClick={onToggleSteps}
                className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface-2 px-3.5 text-body-sm text-text-1 hover:border-line-bright"
              >
                <ChevronDown size={14} aria-hidden className={cn('motion-safe:transition-transform', stepsOpen && 'rotate-180')} />
                {stepsOpen ? 'Hide the steps' : 'Show the steps'}
                <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-text-3 md:inline">Esc</kbd>
              </button>
              <div id={`${idBase}-steps`} hidden={!stepsOpen} className="mt-3">
                {stepsOpen && <StepList steps={steps} reveal label="Solution steps" />}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** The why of each option that matters: the learner's wrong picks first (their misconception), then the key. */
function Whys({ view, picks }: { view: Extract<PlayView, { kind: 'choice' }>; picks: readonly string[] }) {
  const shown = [
    ...view.options.filter((o) => picks.includes(o.id) && !view.correct.includes(o.id)),
    ...view.options.filter((o) => view.correct.includes(o.id)),
  ].filter((o) => o.why !== '')
  if (shown.length === 0) return null
  return (
    <ul className="space-y-1.5" aria-label="Why each answer is right or wrong">
      {shown.map((o) => {
        const right = view.correct.includes(o.id)
        const picked = picks.includes(o.id)
        return (
          <li key={o.id} className={cn('flex items-start gap-2 rounded-md border-l-2 bg-surface-2 px-3.5 py-2.5 text-body-sm text-text-2', right ? 'border-accent' : 'border-danger')}>
            {right ? <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <X size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />}
            <span className="min-w-0 break-words">
              <span className={cn('mr-1.5 font-mono text-[10px] uppercase', right ? 'text-accent' : 'text-danger')}>
                {OPTION_LETTERS[view.options.indexOf(o)]} · {right ? (picked ? 'your pick, correct' : 'correct answer') : 'your pick, wrong'}
              </span>
              {o.why}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
