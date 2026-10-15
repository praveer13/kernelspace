import { useId, useRef } from 'react'
import { BACKGROUNDS } from '@/lib/ledger/constants'
import type { Background } from '@/lib/ledger/types'
import { backgroundOf } from '@/lib/learner/background'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

/**
 * "What do you work on?", the optional pick behind P3's work analogues (wave-3.md §11.3, Q13). It writes the working key
 * `profile:background`: local, broadcast to other tabs, never donated (the redaction keeps no working record but the
 * week plan's SLO). A panel shows a work row only for a matching background, so nothing here is required, and "something
 * else" matches none. A radio group cannot go back to none, so "Clear my pick" deletes the record (3c final review, 3c-05
 * m2). Boot's last step holds the pick, or the clearing of it, in state and applies it with the rest at Go to Today; /me
 * applies it on the click.
 *
 * Where the pick goes is the same sentence in both places: this browser, and the progress file you export yourself
 * (a full export carries every working record), never a donation.
 */
export const BACKGROUND_STAYS = 'It stays on your devices: in this browser and in the progress files you export yourself. It is never part of a donation.'

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
  /** Goes back to none. The button shows only while a background is picked, and focus returns to the group. */
  onClear: () => void
  /** Names the group for assistive tech; the visible heading differs between Boot and /me. */
  label?: string
}

/** The six radios, controlled; Boot's last step and /me's card both draw it. */
export function BackgroundChoice({ value, onChange, onClear, label = 'What you work on' }: ChoiceProps) {
  const name = useId()
  const group = useRef<HTMLDivElement>(null)
  return (
    <div ref={group} className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={label}>
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
      {value !== null && (
        <button
          type="button"
          onClick={() => {
            onClear()
            // the button leaves with the pick: focus goes to the group's first radio, not to the page
            group.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus()
          }}
          className="min-h-11 rounded-md px-3 text-body-sm text-info underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Clear my pick
        </button>
      )}
    </div>
  )
}

/** /me's card: the pick is written as it is made. */
export default function BackgroundPick() {
  const value = backgroundOf(useProgress((s) => s.working['profile:background']))
  const setWorking = useProgress((s) => s.setWorking)
  const clearWorking = useProgress((s) => s.clearWorking)
  return (
    <section aria-labelledby="me-background-heading" className="mt-14">
      <h2 id="me-background-heading" className="font-display text-h3 text-text-1">
        what you work on
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        Optional. Some lesson panels add one example from your own work beside the OS one. {BACKGROUND_STAYS}
      </p>
      <div className="mt-4">
        <BackgroundChoice value={value} onChange={(b) => setWorking('profile:background', b)} onClear={() => clearWorking('profile:background')} />
      </div>
    </section>
  )
}
