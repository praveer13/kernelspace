/**
 * NumericAnswer: a decimal field (`inputmode="decimal"`, so phones open the number pad) and, when the
 * item accepts several units, a unit select. 16 px text keeps iOS from zooming on focus; controls are
 * 44 px tall. The field is never a `type="number"`: that rejects "1,024" and swallows "1e3" unevenly.
 */
import { useId } from 'react'
import type { AnswerSpec } from '@/lib/items/types'
import { cn } from '@/lib/utils'

export const FIELD =
  'min-h-11 min-w-0 rounded-md border border-line bg-surface-2 px-3 text-base text-text-1 placeholder:text-text-3 focus-visible:border-line-bright disabled:cursor-default disabled:opacity-70'

interface NumericAnswerProps {
  answer: Extract<AnswerSpec, { kind: 'numeric' }>
  text: string
  unit: string
  onText: (text: string) => void
  onUnit: (unit: string) => void
  disabled: boolean
  /** A parse problem to announce; the field is marked invalid while it shows. */
  problem?: string | null
}

export default function NumericAnswer({ answer, text, unit, onText, onUnit, disabled, problem }: NumericAnswerProps) {
  const id = useId()
  const units = answer.units && answer.units.length > 1 ? answer.units : null
  return (
    <div>
      <label htmlFor={`${id}-v`} className="mb-1.5 block font-mono text-[11px] uppercase text-text-3">
        Your answer
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`${id}-v`}
          data-ks-field
          inputMode="decimal"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          onChange={(e) => onText(e.target.value)}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-p` : undefined}
          className={cn(FIELD, 'w-full flex-1 font-mono')}
        />
        {units ? (
          <select
            aria-label="Unit"
            value={unit}
            disabled={disabled}
            onChange={(e) => onUnit(e.target.value)}
            className={cn(FIELD, 'w-auto shrink-0 font-mono')}
          >
            {units.map((u) => (
              <option key={u.unit} value={u.unit}>
                {u.unit}
              </option>
            ))}
          </select>
        ) : (
          <span className="shrink-0 font-mono text-body-sm text-text-2">{answer.unit}</span>
        )}
      </div>
      {problem && (
        <p id={`${id}-p`} role="alert" className="mt-1.5 text-body-sm text-amber">
          {problem}
        </p>
      )}
    </div>
  )
}
