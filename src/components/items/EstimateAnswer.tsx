/**
 * EstimateAnswer: one estimate field, plus, when the item asks for a 90 % interval, an optional
 * low/high pair behind "add a 90 % range" (docs/specs/wave-1.md §5.2, §6.8). The range never gates
 * Submit; leaving it empty simply skips the interval score.
 */
import { useId } from 'react'
import type { AnswerSpec } from '@/lib/items/types'
import { cn } from '@/lib/utils'
import { FIELD } from './NumericAnswer'

interface EstimateAnswerProps {
  answer: Extract<AnswerSpec, { kind: 'estimate' }>
  text: string
  lo: string
  hi: string
  range: boolean
  onText: (text: string) => void
  onLo: (text: string) => void
  onHi: (text: string) => void
  onRange: (open: boolean) => void
  disabled: boolean
  problem?: string | null
}

export default function EstimateAnswer({ answer, text, lo, hi, range, onText, onLo, onHi, onRange, disabled, problem }: EstimateAnswerProps) {
  const id = useId()
  const props = { inputMode: 'decimal' as const, autoComplete: 'off', autoCapitalize: 'off', spellCheck: false, disabled }
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-v`} className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
          Your estimate
        </label>
        <div className="flex items-center gap-2">
          <input
            {...props}
            id={`${id}-v`}
            data-ks-field
            value={text}
            onChange={(e) => onText(e.target.value)}
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-p` : undefined}
            className={cn(FIELD, 'w-full flex-1 font-mono')}
          />
          <span className="shrink-0 font-mono text-body-sm text-text-2">{answer.unit}</span>
        </div>
      </div>
      {answer.interval && (
        <div>
          <button
            type="button"
            aria-expanded={range}
            aria-controls={`${id}-r`}
            disabled={disabled}
            onClick={() => onRange(!range)}
            className="min-h-11 rounded-md border border-line bg-surface-2 px-3.5 text-body-sm text-text-1 hover:border-line-bright disabled:cursor-default disabled:opacity-70"
          >
            {range ? 'Remove the 90 % range' : 'Add a 90 % range'}
          </button>
          {range && (
            <div id={`${id}-r`} className="mt-2 grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label htmlFor={`${id}-lo`} className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
                  Low (5 % chance below)
                </label>
                <input {...props} id={`${id}-lo`} value={lo} onChange={(e) => onLo(e.target.value)} className={cn(FIELD, 'w-full font-mono')} />
              </div>
              <div className="min-w-0">
                <label htmlFor={`${id}-hi`} className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
                  High (5 % chance above)
                </label>
                <input {...props} id={`${id}-hi`} value={hi} onChange={(e) => onHi(e.target.value)} className={cn(FIELD, 'w-full font-mono')} />
              </div>
            </div>
          )}
        </div>
      )}
      {problem && (
        <p id={`${id}-p`} role="alert" className="text-body-sm text-amber">
          {problem}
        </p>
      )}
    </div>
  )
}
