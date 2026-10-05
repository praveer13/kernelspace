/**
 * ConstructedAnswer: a self-checked constructed response (docs/specs/wave-1.md §8.1). Write an answer,
 * reveal the model answer, then tick which of its three ideas your answer covered. At least two ticked
 * is "correct": self-assessed, practice weight. The text never leaves the device; only the ticks are
 * recorded.
 */
import { useId } from 'react'
import type { ConstructedPrompt } from '@/lib/items/types'
import { cn } from '@/lib/utils'

interface ConstructedAnswerProps {
  cr: ConstructedPrompt
  text: string
  ideas: readonly [boolean, boolean, boolean]
  revealed: boolean
  onText: (text: string) => void
  onReveal: () => void
  onIdea: (index: number, on: boolean) => void
  /** After grading everything is locked. */
  disabled: boolean
}

export default function ConstructedAnswer({ cr, text, ideas, revealed, onText, onReveal, onIdea, disabled }: ConstructedAnswerProps) {
  const id = useId()
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-t`} className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
          Your answer, in a sentence or two
        </label>
        <textarea
          id={`${id}-t`}
          data-ks-field
          rows={4}
          value={text}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          className="block min-h-24 w-full min-w-0 resize-y rounded-md border border-line bg-surface-2 px-3 py-2.5 text-base text-text-1 placeholder:text-text-3 focus-visible:border-line-bright disabled:cursor-default disabled:opacity-70"
        />
        <p className="mt-1 font-mono text-[11px] text-text-3">stays on this device · Ctrl+Enter or ⌘+Enter to continue</p>
      </div>
      {!revealed ? (
        <button
          type="button"
          data-ks-reveal
          onClick={onReveal}
          className="min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
        >
          Show the model answer
        </button>
      ) : (
        <div className="space-y-3">
          <div data-ks-model tabIndex={-1} role="group" aria-label="Model answer" className="rounded-md border-l-2 border-info bg-surface-2 px-3.5 py-2.5">
            <p className="mb-1 font-mono text-[11px] uppercase text-text-3">Model answer</p>
            <p className="break-words text-body-sm text-text-1">{cr.model}</p>
          </div>
          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-body-sm text-text-2">Tick each idea your answer covered. Two of three is a pass.</legend>
            <div className="space-y-2">
              {cr.ideas.map((idea, i) => (
                <label
                  key={i}
                  className={cn(
                    'flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-md border px-3.5 py-2.5 text-body-sm',
                    ideas[i] ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line bg-surface-2 text-text-2',
                    disabled && 'cursor-default',
                  )}
                >
                  <input
                    type="checkbox"
                    data-ks-idea
                    checked={ideas[i]}
                    disabled={disabled}
                    onChange={(e) => onIdea(i, e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 break-words">{idea}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  )
}
