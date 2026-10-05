import { cn } from '@/lib/utils'
import type { Confidence } from '@/lib/ledger/types'
import { CONFIDENCE_CHOICES } from '@/lib/learner/calibration'

interface ConfidencePickerProps {
  value: Confidence | undefined
  /** `undefined` clears the pick: confidence is optional and never gates anything. */
  onChange: (value: Confidence | undefined) => void
  /** Locked after submit, still showing what was picked. */
  disabled?: boolean
  className?: string
}

/**
 * V2 confidence (spec §12.1, Addendum A3): three toggles under a question, "guess · think so · sure".
 * Optional: tapping the lit one again clears it, and an unrated answer is simply left out of calibration.
 * Targets are at least 44 px tall. Neutral colours only, so the row never hints at the verdict.
 */
export default function ConfidencePicker({ value, onChange, disabled, className }: ConfidencePickerProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="group" aria-label="How sure are you? Optional">
      <span className="mr-1 font-mono text-[11px] uppercase text-text-3">how sure?</span>
      {CONFIDENCE_CHOICES.map((o, i) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-keyshortcuts={String(i + 1)}
            disabled={disabled}
            onClick={() => onChange(on ? undefined : o.value)}
            className={cn(
              'flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border px-3.5 text-body-sm transition-colors duration-150',
              on
                ? 'border-line-bright bg-surface-3 text-text-1'
                : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
              disabled && 'cursor-default',
              disabled && !on && 'opacity-50',
            )}
          >
            {o.label}
            {!disabled && (
              <kbd className="hidden rounded border border-line px-1 font-mono text-[10px] text-text-3 md:inline">{i + 1}</kbd>
            )}
          </button>
        )
      })}
    </div>
  )
}
