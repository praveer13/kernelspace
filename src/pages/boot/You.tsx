import { useId, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/Button'
import type { LearningPath, WeekPlan } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import { StepBtn, StepTitle } from './ui'

const PATHS: { id: LearningPath; name: string; blurb: string }[] = [
  { id: 'full-ramp', name: 'Full ramp', blurb: 'Rust Zero, then Track 0 up through serving. Best if systems are new to you.' },
  { id: 'serving-first', name: 'Serving first', blurb: 'Straight to batching, the KV cache and engines (T5 to T7); Rust arrives as short reading items.' },
  { id: 'rust-systems', name: 'Rust systems', blurb: 'Rust Zero and the Forge labs first; serving later.' },
]

const DAYS = [
  ['S', 'Sunday'],
  ['M', 'Monday'],
  ['T', 'Tuesday'],
  ['W', 'Wednesday'],
  ['T', 'Thursday'],
  ['F', 'Friday'],
  ['S', 'Saturday'],
] as const

const DEFAULT_WEEK: WeekPlan = { minutesPerWeek: 180, sessionMinutes: 25, phoneDays: [], laptopDays: [], slo: 0.9 }
const SESSION_CHOICES = [10, 15, 25, 45]
const toggle = (days: number[], d: number) => (days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort())

/** iOS Safari, not yet on the Home Screen: the only place the install tip applies (PLAN-100X §4.A). */
function needsIosInstallTip(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && safari && !standalone
}

interface YouProps {
  onFinish: () => void
}

export default function You({ onFinish }: YouProps) {
  const navigate = useNavigate()
  const setWorking = useProgress((s) => s.setWorking)
  const installDismissed = useProgress((s) => s.working['boot:install-dismissed'] === true)
  const uid = useId()
  const [job, setJob] = useState<boolean | null>(null)
  const [valueText, setValueText] = useState('')
  const [path, setPath] = useState<LearningPath | null>(null)
  const [week, setWeek] = useState<WeekPlan>(DEFAULT_WEEK)
  const [weekTouched, setWeekTouched] = useState(false)
  const [showInstall] = useState(needsIosInstallTip)

  const editWeek = (patch: Partial<WeekPlan>) => {
    setWeek((w) => ({ ...w, ...patch }))
    setWeekTouched(true)
  }

  const finish = () => {
    if (valueText.trim() !== '') setWorking('boot:value', { variant: job === false ? 'no-job' : 'job', text: valueText.trim() })
    if (path) setWorking('boot:path', path)
    if (weekTouched) setWorking('boot:week', { ...week })
    onFinish()
    // Boot's last step ends in Today (wave-1.md §6.9): the first reviews and the week are there.
    navigate('/today')
  }

  return (
    <section aria-labelledby="boot-step-title">
      <StepTitle kicker="0x06 — you">Now, how do you want to use this?</StepTitle>

      <div className="mt-4 rounded-md border border-line bg-surface-1 p-4 text-body-sm text-text-2">
        <p className="font-semibold text-text-1">A 30-second heads-up: this will feel harder than reading.</p>
        <p className="mt-1">
          The course asks you to guess before it shows you, and to say how sure you are. That feels slower than reading a chapter. In a 2019
          classroom study (Deslauriers et al.), students taught with active methods felt they had learned less and scored higher. When it feels
          hard, that is usually the point.
        </p>
      </div>

      <form
        className="mt-6 space-y-8"
        onSubmit={(e) => {
          e.preventDefault()
          finish()
        }}
      >
        <fieldset className="space-y-3">
          <legend className="text-body text-text-1">What is this for? <span className="text-text-3">Optional. It stays in this browser unless you export it.</span></legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Your situation">
            {[
              { v: true, label: 'I work in software' },
              { v: false, label: "I'm not in a software job yet" },
            ].map((o) => (
              <label
                key={String(o.v)}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-body-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                  job === o.v ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line bg-surface-2 text-text-2',
                )}
              >
                <input type="radio" name={`${uid}-job`} checked={job === o.v} onChange={() => setJob(o.v)} className="size-4 accent-accent" />
                {o.label}
              </label>
            ))}
          </div>
          <div>
            <label htmlFor={`${uid}-value`} className="block text-body-sm text-text-1">
              {job === false ? 'What do you want to build, or be hired for?' : 'What problem at work would this help you with?'}
            </label>
            <textarea
              id={`${uid}-value`}
              rows={3}
              maxLength={500}
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              className="mt-2 w-full rounded-md border border-line bg-surface-2 p-3 text-body text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-body text-text-1">Your path <span className="text-text-3">You can change it later.</span></legend>
          {PATHS.map((p) => (
            <label
              key={p.id}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-body-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                path === p.id ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line bg-surface-2 text-text-2',
              )}
            >
              <input type="radio" name={`${uid}-path`} checked={path === p.id} onChange={() => setPath(p.id)} className="mt-1 size-4 shrink-0 accent-accent" />
              <span>
                <strong className="text-text-1">{p.name}.</strong> {p.blurb}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-body text-text-1">Set your week <span className="text-text-3">Optional. Today uses it to plan your sessions.</span></legend>

          <div>
            <p id={`${uid}-minutes`} className="text-body-sm text-text-1">
              Minutes per week
            </p>
            <div className="mt-2 flex items-center gap-2" role="group" aria-labelledby={`${uid}-minutes`}>
              <StepBtn aria-label="30 fewer minutes" disabled={week.minutesPerWeek <= 30} onClick={() => editWeek({ minutesPerWeek: week.minutesPerWeek - 30 })}>
                − 30
              </StepBtn>
              <output aria-live="polite" className="min-w-16 text-center font-mono text-body text-text-1">
                {week.minutesPerWeek}
              </output>
              <StepBtn aria-label="30 more minutes" disabled={week.minutesPerWeek >= 1200} onClick={() => editWeek({ minutesPerWeek: week.minutesPerWeek + 30 })}>
                + 30
              </StepBtn>
            </div>
          </div>

          <div>
            <p id={`${uid}-session`} className="text-body-sm text-text-1">
              Minutes per session
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-session`}>
              {SESSION_CHOICES.map((m) => (
                <StepBtn key={m} aria-pressed={week.sessionMinutes === m} className={cn(week.sessionMinutes === m && 'border-line-bright bg-surface-3')} onClick={() => editWeek({ sessionMinutes: m })}>
                  {m}
                </StepBtn>
              ))}
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
              <div className="mt-2 grid grid-cols-7 gap-0.5" role="group" aria-labelledby={`${uid}-${key}`}>
                {DAYS.map(([short, long], d) => (
                  <StepBtn
                    key={long}
                    aria-pressed={week[key].includes(d)}
                    aria-label={`${long}, ${device}`}
                    className={cn('px-0', week[key].includes(d) && 'border-line-bright bg-surface-3 text-accent')}
                    onClick={() => editWeek({ [key]: toggle(week[key], d) })}
                  >
                    {short}
                  </StepBtn>
                ))}
              </div>
            </div>
          ))}

          <div>
            <p id={`${uid}-slo`} className="text-body-sm text-text-1">
              How much of what you review should you remember?
            </p>
            <div className="mt-2 flex gap-2" role="group" aria-labelledby={`${uid}-slo`}>
              {([0.85, 0.9] as const).map((s) => (
                <StepBtn key={s} aria-pressed={week.slo === s} className={cn(week.slo === s && 'border-line-bright bg-surface-3')} onClick={() => editWeek({ slo: s })}>
                  {Math.round(s * 100)}%
                </StepBtn>
              ))}
            </div>
          </div>
        </fieldset>

        <div className="text-body-sm text-text-2">
          <Link to="/curriculum?placement=1" className="flex min-h-11 items-center text-info underline underline-offset-2">
            Optional: see where you would place on the curriculum
          </Link>
          <p className="text-[13px] text-text-3">It opens after Boot, so finish first if you want your answers saved.</p>
        </div>

        {showInstall && !installDismissed && (
          <div className="rounded-md border border-line bg-surface-1 p-4 text-body-sm text-text-2">
            <p className="font-semibold text-text-1">Keep it on your phone</p>
            <p className="mt-1">Browsers can clear a site's saved data when you stay away for a while. Tap Share, then Add to Home Screen, and your progress is safer.</p>
            <StepBtn className="mt-3" onClick={() => setWorking('boot:install-dismissed', true)}>
              Not now
            </StepBtn>
          </div>
        )}

        <Button type="submit" className="w-full sm:w-auto">
          Go to Today
        </Button>
      </form>
    </section>
  )
}
