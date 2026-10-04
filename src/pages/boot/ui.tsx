/**
 * Boot's small shared pieces. A step is one form: Enter (or the one button) checks the answer, and the
 * same button, same DOM node, then reads "Continue", so keyboard focus never has to move and the
 * verdict arrives through the polite live region just above it.
 */
import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/Button'
import { cn } from '@/lib/utils'

export function StepTitle({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <header>
      <p className="section-label">{kicker}</p>
      <h2 id="boot-step-title" tabIndex={-1} className="mt-2 font-display text-h3 text-text-1 outline-none sm:text-h2">
        {children}
      </h2>
    </header>
  )
}

interface StepFormProps {
  /** An answer has been committed: the button now moves on. */
  done: boolean
  /** The answer is complete enough to check. */
  canCheck: boolean
  onCheck: () => void
  onNext: () => void
  checkLabel?: string
  nextLabel?: string
  /** What the learner reads after checking; announced politely. */
  feedback?: React.ReactNode
  children: React.ReactNode
}

export function StepForm({ done, canCheck, onCheck, onNext, checkLabel = 'Check', nextLabel = 'Continue', feedback, children }: StepFormProps) {
  const button = useRef<HTMLButtonElement>(null)
  // Locking the inputs can drop focus (a disabled radio or slider cannot keep it); the button takes it back, so Enter moves on.
  useEffect(() => {
    if (done && (document.activeElement === document.body || document.activeElement === null)) button.current?.focus()
  }, [done])
  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (done) onNext()
        else if (canCheck) onCheck()
      }}
    >
      {children}
      <div role="status" aria-live="polite" className="empty:hidden">
        {done && feedback}
      </div>
      <Button ref={button} type="submit" disabled={!done && !canCheck} className="w-full sm:w-auto">
        {done ? nextLabel : checkLabel}
      </Button>
    </form>
  )
}

/** A verdict panel. Tone is carried by the text and a leading word as well as colour. */
export function Verdict({ tone, lead, children }: { tone: 'good' | 'miss' | 'info'; lead?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-md border p-4 text-body-sm text-text-2',
        tone === 'good' && 'border-accent/50 bg-accent-dim/40',
        tone === 'miss' && 'border-amber/50 bg-amber/5',
        tone === 'info' && 'border-line bg-surface-2',
      )}
    >
      {lead && <p className="mb-1 font-semibold text-text-1">{lead}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  )
}

interface NumberFieldProps {
  label: React.ReactNode
  unit?: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  hint?: React.ReactNode
}

/** A decimal field. Typing is the stepper-free path; commas and spaces are forgiven when it is read. */
export function NumberField({ label, unit, value, onChange, disabled, hint }: NumberFieldProps) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="block text-body-sm text-text-1">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="go"
          value={value}
          readOnly={disabled}
          aria-readonly={disabled || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-11 w-full max-w-[12rem] rounded-md border border-line bg-surface-2 px-3 font-mono text-body text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent read-only:opacity-70"
        />
        {unit && <span className="font-mono text-body-sm text-text-3">{unit}</span>}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-text-3">
          {hint}
        </p>
      )}
    </div>
  )
}

/** A square-ish button for steppers and toggles: at least 44 px either way. */
export function StepBtn({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-surface-2 px-3 font-mono text-body-sm text-text-1 transition-colors',
        'hover:border-line-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50',
        className,
      )}
    />
  )
}
