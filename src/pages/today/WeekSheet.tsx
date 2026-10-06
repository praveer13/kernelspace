import { useEffect, useId, useRef, useState } from 'react'
import { SESSION_CHOICES, type TodayPrefs } from '@/lib/learner/today'
import { WEEK_MINUTES_MAX, WEEK_MINUTES_MIN } from '@/lib/learner/planner'
import { weekIcs } from '@/lib/learner/ics'
import type { LocalDay, WeekPlan } from '@/lib/ledger/types'
import { cn } from '@/lib/utils'

const DAYS = [
  ['S', 'Sunday'],
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
] as const

const toggle = (days: number[], d: number) => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())

const BTN =
  'min-h-11 min-w-11 rounded-md border border-line bg-surface-2 px-3 text-body-sm text-text-1 hover:border-line-bright aria-pressed:border-line-bright aria-pressed:bg-surface-3 aria-pressed:text-accent disabled:cursor-not-allowed disabled:opacity-50'

export interface WeekSheetProps {
  /** The plan in force (`normalizeWeekPlan` of `boot:week`). Every change writes it back through `onPlan`. */
  plan: WeekPlan
  prefs: TodayPrefs
  /** Today, the first day a calendar event may fall on. */
  day: LocalDay
  onPlan: (plan: WeekPlan) => void
  onPrefs: (prefs: TodayPrefs) => void
  onClose: () => void
}

/**
 * "Set your week" outside Boot (spec §6.5): minutes, phone and laptop days, the recall SLO, the length of a
 * review set and phone mode for sims. A modal `<dialog>`, a bottom sheet below 640 px: the browser traps focus,
 * Escape closes it and focus goes back to the button that opened it. Each change is written as it is made
 * (`boot:week` and `today:prefs`; last writer wins, as Boot's step does). It also exports the plan as a weekly
 * `.ics`, built here and downloaded: nothing is sent anywhere.
 */
export default function WeekSheet({ plan, prefs, day, onPlan, onPrefs, onClose }: WeekSheetProps) {
  const uid = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [time, setTime] = useState('18:00')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
  }, [])

  const edit = (patch: Partial<WeekPlan>) => onPlan({ ...plan, ...patch })

  const download = () => {
    try {
      const file = weekIcs({ plan, time, from: day, now: new Date().toISOString() })
      if (!file) {
        setNote('Pick at least one phone or laptop day first.')
        return
      }
      const url = URL.createObjectURL(new Blob([file.text], { type: 'text/calendar' }))
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setNote(`Saved ${file.filename}: ${file.events} weekly ${file.events === 1 ? 'event' : 'events'} at ${time}. Open it in your calendar app.`)
    } catch {
      setNote('Pick a time like 18:30.')
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${uid}-title`}
      onClose={onClose}
      onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-xl border border-line bg-surface-1 p-4 text-text-1 backdrop:bg-black/60 sm:m-auto sm:max-w-md sm:rounded-xl sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${uid}-title`} className="font-display text-h3 text-text-1">
          Set your week
        </h2>
        <button type="button" onClick={() => dialog.current?.close()} className={cn(BTN, 'shrink-0')}>
          Done
        </button>
      </div>
      <p className="mt-1 text-body-sm text-text-3">Today plans around this. It stays in this browser.</p>

      <div className="mt-5 space-y-5">
        <div>
          <p id={`${uid}-minutes`} className="text-body-sm text-text-1">
            Minutes per week
          </p>
          <div className="mt-2 flex items-center gap-2" role="group" aria-labelledby={`${uid}-minutes`}>
            <button type="button" className={BTN} aria-label="30 fewer minutes" disabled={plan.minutesPerWeek <= WEEK_MINUTES_MIN} onClick={() => edit({ minutesPerWeek: plan.minutesPerWeek - 30 })}>
              − 30
            </button>
            <output aria-live="polite" className="min-w-16 text-center font-mono text-body text-text-1">
              {plan.minutesPerWeek}
            </output>
            <button type="button" className={BTN} aria-label="30 more minutes" disabled={plan.minutesPerWeek >= WEEK_MINUTES_MAX} onClick={() => edit({ minutesPerWeek: plan.minutesPerWeek + 30 })}>
              + 30
            </button>
          </div>
        </div>

        {(
          [
            ['phoneDays', 'Phone days', 'phone'],
            ['laptopDays', 'Laptop days', 'laptop'],
          ] as const
        ).map(([key, title, device]) => (
          <div key={key}>
            <p id={`${uid}-${key}`} className="text-body-sm text-text-1">
              {title}
            </p>
            <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-labelledby={`${uid}-${key}`}>
              {DAYS.map(([short, long], d) => (
                <button
                  key={long}
                  type="button"
                  aria-pressed={plan[key].includes(d)}
                  aria-label={`${long}, ${device}`}
                  className={cn(BTN, 'min-w-0 px-0')}
                  onClick={() => {
                    const other = key === 'phoneDays' ? 'laptopDays' : 'phoneDays'
                    edit({ [key]: toggle(plan[key], d), [other]: plan[other].filter((x) => x !== d) })
                  }}
                >
                  {short}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div>
          <p id={`${uid}-slo`} className="text-body-sm text-text-1">
            How much of what you review should you remember?
          </p>
          <div className="mt-2 flex gap-2" role="group" aria-labelledby={`${uid}-slo`}>
            {([0.9, 0.85] as const).map((slo) => (
              <button key={slo} type="button" aria-pressed={plan.slo === slo} className={BTN} onClick={() => edit({ slo })}>
                {Math.round(slo * 100)} %
              </button>
            ))}
          </div>
        </div>

        <div>
          <p id={`${uid}-len`} className="text-body-sm text-text-1">
            Review set length, minutes
          </p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-len`}>
            {SESSION_CHOICES.map((m) => (
              <button key={m} type="button" aria-pressed={(prefs.sessionMinutes ?? 12) === m} className={BTN} onClick={() => onPrefs({ ...prefs, sessionMinutes: m })}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p id={`${uid}-phone`} className="text-body-sm text-text-1">
            Phone mode for sims on small screens
          </p>
          <div className="mt-2 flex gap-2" role="group" aria-labelledby={`${uid}-phone`}>
            <button type="button" aria-pressed={prefs.phoneMode !== false} className={BTN} onClick={() => onPrefs({ ...prefs, phoneMode: true })}>
              On
            </button>
            <button type="button" aria-pressed={prefs.phoneMode === false} className={BTN} onClick={() => onPrefs({ ...prefs, phoneMode: false })}>
              Off
            </button>
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-time`} className="block text-body-sm text-text-1">
            Add to my calendar, at
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id={`${uid}-time`}
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="min-h-11 rounded-md border border-line bg-surface-2 px-3 font-mono text-body-sm text-text-1"
            />
            <button type="button" className={BTN} onClick={download}>
              Download .ics
            </button>
          </div>
          <p role="status" aria-live="polite" className="mt-2 text-body-sm text-text-2 empty:hidden">
            {note}
          </p>
        </div>
      </div>
    </dialog>
  )
}
