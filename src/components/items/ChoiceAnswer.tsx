/**
 * ChoiceAnswer: options as full-width buttons at least 44 px tall, lettered by display position (keys
 * A–D pick, handled by ItemCard). Toggle buttons in a labelled group, so a screen reader hears each
 * option's state. After grading the keyed options and the learner's wrong picks carry an icon and
 * text, never colour alone.
 */
import { Check, X } from 'lucide-react'
import { OPTION_LETTERS } from '@/lib/items/play'
import type { ChoiceOption } from '@/lib/items/types'
import { cn } from '@/lib/utils'

interface ChoiceAnswerProps {
  /** In display order. */
  options: readonly ChoiceOption[]
  picks: readonly string[]
  /** Set after grading: the keyed ids. */
  correct?: readonly string[]
  multi: boolean
  disabled: boolean
  onToggle: (id: string) => void
  /** Id of the element that names the question, for the group's accessible name. */
  labelledBy: string
}

export default function ChoiceAnswer({ options, picks, correct, multi, disabled, onToggle, labelledBy }: ChoiceAnswerProps) {
  const graded = correct !== undefined
  return (
    <div role="group" aria-labelledby={labelledBy} className="space-y-2">
      {multi && <p className="font-mono text-[11px] uppercase text-text-3">select all that apply</p>}
      {options.map((o, i) => {
        const picked = picks.includes(o.id)
        const keyed = graded && correct.includes(o.id)
        const wrongPick = graded && picked && !keyed
        return (
          <button
            key={o.id}
            type="button"
            data-ks-option
            aria-pressed={picked}
            aria-keyshortcuts={OPTION_LETTERS[i]}
            disabled={disabled}
            onClick={() => onToggle(o.id)}
            className={cn(
              'flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md border px-3.5 py-2.5 text-left text-body-sm',
              'motion-safe:transition-colors motion-safe:duration-150',
              keyed
                ? 'border-accent/50 bg-accent-dim/70 text-text-1'
                : wrongPick
                  ? 'border-danger/50 bg-danger/10 text-text-1'
                  : picked
                    ? 'border-line-bright bg-surface-3 text-text-1'
                    : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
              disabled && 'cursor-default',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-[11px]',
                keyed
                  ? 'border-accent bg-accent text-accent-foreground'
                  : wrongPick
                    ? 'border-danger bg-danger/10 text-danger'
                    : picked
                      ? 'border-line-bright bg-surface-1 text-text-1'
                      : 'border-line text-text-3',
              )}
            >
              {OPTION_LETTERS[i]}
            </span>
            <span className="min-w-0 flex-1 break-words">
              <span className="sr-only">Option {OPTION_LETTERS[i]}: </span>
              {o.text}
            </span>
            {wrongPick && <X size={14} className="shrink-0 text-danger" aria-hidden />}
            {keyed && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
            {graded && (keyed || wrongPick) && (
              <span className="sr-only">{keyed ? (picked ? ', your pick, correct' : ', the correct answer') : ', your pick, wrong'}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
