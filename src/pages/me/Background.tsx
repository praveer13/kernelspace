import { useId } from 'react'
import { BACKGROUNDS } from '@/lib/ledger/constants'
import type { Background } from '@/lib/ledger/types'
import { backgroundOf } from '@/lib/learner/iso'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

/**
 * "What do you work on?", the optional pick behind P3's work analogues (wave-3.md §11.3, Q13). It writes the working key
 * `profile:background`: local, broadcast to other tabs, never donated (the redaction keeps no working record but the
 * week plan's SLO). A panel shows a work row only for a matching background, so nothing here is required, and "something
 * else" matches none. Boot's last step holds the pick in state and writes it with the rest; /me writes it on the click.
 */
const LABELS: Record<Background, string> = {
  jvm: 'Java or Kotlin services',
  backend: 'Python, Go or Node services',
  sre: 'SRE or platform',
  ml: 'ML or data',
  student: 'Student',
  other: 'Something else',
}

interface ChoiceProps {
  value: Background | null
  onChange: (b: Background) => void
  /** Names the group for assistive tech; the visible heading differs between Boot and /me. */
  label?: string
}

/** The six radios, controlled; Boot's last step and /me's card both draw it. */
export function BackgroundChoice({ value, onChange, label = 'What you work on' }: ChoiceProps) {
  const name = useId()
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {BACKGROUNDS.map((b) => (
        <label
          key={b}
          className={cn(
            'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
            value === b ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line bg-surface-2 text-text-2',
          )}
        >
          <input type="radio" name={name} checked={value === b} onChange={() => onChange(b)} className="size-4 accent-accent" />
          {LABELS[b]}
        </label>
      ))}
    </div>
  )
}

/** /me's card: the pick is written as it is made. */
export default function BackgroundPick() {
  const value = backgroundOf(useProgress((s) => s.working['profile:background']))
  const setWorking = useProgress((s) => s.setWorking)
  return (
    <section aria-labelledby="me-background-heading" className="mt-14">
      <h2 id="me-background-heading" className="font-display text-h3 text-text-1">
        what you work on
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        Optional. Some lesson panels add one example from your own work beside the OS one. It stays in this browser and is never part of a
        donation.
      </p>
      <div className="mt-4">
        <BackgroundChoice value={value} onChange={(b) => setWorking('profile:background', b)} />
      </div>
    </section>
  )
}
