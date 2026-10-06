/**
 * A lab's PRIMM walk (docs/specs/wave-1.md §13.1; wave-2.md §13.1): Predict, Run, Investigate, Modify, Make, all of
 * it read from the lab's `ForgeBundle` (items, steps, reference run, stages); the panel holds no lab's data.
 *
 * It sits above the drop zone. Every answer writes one `item item:<the bundle's item id>` event through `recordItems`
 * (the Run step writes what the reference run observed, with no KCs). Nothing locks: the steps are buttons, and the
 * one soft gate (the Run strip would give away the first prediction) has a "show me anyway" after which the two
 * Predict questions stay open to read but take no answer and write nothing: a prediction made after seeing the run is
 * not evidence. Focus follows the learner (spec §15.3): a result, a run button or the step's lead-in takes it when
 * the control that was pressed unmounts.
 * The Make step is the stage list plus whatever the page puts below it (the drop zone), passed as `children`.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { clsx as cn } from 'clsx'
import type { ForgeLabCheck } from '@/data/labs'
import { useProgress } from '@/lib/progress'
import { freshSeed, hash32, shuffledOrder } from '@/lib/rng'
import type { ChoicePrimm, ForgeBundle, NumberPrimm, PrimmItem, PrimmStepId, RunResult } from '@/data/forge/types'
import {
  gradeChoice,
  gradeNumber,
  itemResponse,
  observationResponse,
  predictGraded,
  sameConfig,
  type PrimmAnswer,
  type PrimmGrade,
} from '@/lib/forge/primm'
import { renderInline } from '@/pages/lesson/markdown'
import { ReferenceRun } from '@/components/forge/ReferenceRun'
import { StagePanel } from '@/components/forge/StagePanel'

const COUNT_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

const parseNumber = (text: string): number | null => {
  const t = text.trim().replace(/,/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

/** When the item appeared (set after mount, so render stays pure): its `ms` is the time to an answer. */
function useShownAt() {
  const at = useRef(0)
  useEffect(() => {
    at.current = Date.now()
  }, [])
  return at
}

/** Whether this item's answer was just given (so its result takes focus), and claims the focus once. */
type TakeFocus = (id: string) => boolean

/**
 * The result of an answer (spec §15.3). The `role=status` region is always mounted and starts empty, so the verdict
 * is written into a live region that already exists. The verdict box takes focus once, after a fresh answer,
 * because the button that was pressed has just unmounted; it does not when the learner comes back to the step.
 */
function Feedback({ id, grade, takeFocus }: { id: string; grade?: PrimmGrade; takeFocus: TakeFocus }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (grade === undefined || el === null || !takeFocus(id)) return
    // Not from under a learner who has moved on: focus is only taken from the body or from inside this step.
    const at = document.activeElement
    if (at === null || at === document.body || el.closest('[data-step-body], [data-item]')?.contains(at)) el.focus()
  }, [id, grade, takeFocus])
  return (
    <>
      <p role="status" className="sr-only" data-verdict>
        {grade === undefined ? '' : grade.ok ? 'Right.' : 'Not quite.'}
      </p>
      {grade !== undefined && (
        <div
          ref={box}
          tabIndex={-1}
          className={cn('mt-2 rounded-sm border px-2.5 py-2 text-body-sm leading-snug', grade.ok ? 'border-accent/40 text-text-1' : 'border-line text-text-2')}
          data-feedback={grade.ok ? 'ok' : 'miss'}
        >
          <strong className="font-medium">{grade.ok ? 'Right. ' : 'Not quite. '}</strong>
          {renderInline(grade.feedback)}
        </div>
      )}
    </>
  )
}

interface ChoiceCardProps {
  item: ChoicePrimm
  seed: number
  answered?: PrimmAnswer
  onAnswer(a: PrimmAnswer): void
  takeFocus: TakeFocus
}

function ChoiceCard({ item, seed, answered, onAnswer, takeFocus }: ChoiceCardProps) {
  const uid = useId()
  const { q } = item.item
  const order = useMemo(() => shuffledOrder(q.options.length, (hash32(item.id) ^ seed) >>> 0), [q.options.length, item.id, seed])
  const [pick, setPick] = useState<number | null>(null)
  const shown = answered?.pick ?? pick
  const t0 = useShownAt()
  const submit = () => {
    if (pick === null || answered) return
    onAnswer({ item, grade: gradeChoice(item, pick), pick, ms: Date.now() - t0.current })
  }
  return (
    <fieldset className="min-w-0" disabled={answered !== undefined} data-item={item.id}>
      <legend className="mb-1.5 text-body-sm font-medium leading-snug text-text-1">{renderInline(q.q)}</legend>
      <div className="space-y-1.5">
        {order.map((authored) => {
          const on = shown === authored
          const key = answered !== undefined && q.correct.includes(authored)
          return (
            <label
              key={authored}
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-sm border px-2.5 py-2 text-body-sm [@media(pointer:coarse)]:min-h-11',
                on ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line text-text-2',
                answered && 'cursor-default',
                key && 'border-accent/50',
              )}
            >
              <input
                type="radio"
                name={`${uid}-pick`}
                checked={on}
                onChange={() => setPick(authored)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
              />
              <span>
                {renderInline(q.options[authored])}
                {answered !== undefined && key && <span className="ml-1.5 font-mono text-[10px] text-accent">(the answer)</span>}
              </span>
            </label>
          )
        })}
      </div>
      {answered === undefined && <SubmitButton disabled={pick === null} onClick={submit} />}
      <Feedback id={item.id} grade={answered?.grade} takeFocus={takeFocus} />
    </fieldset>
  )
}

function SubmitButton({ disabled, onClick, children = 'Check answer' }: { disabled?: boolean; onClick(): void; children?: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 font-display text-[13px] font-semibold text-accent-foreground transition-all duration-150 enabled:hover:-translate-y-px enabled:active:scale-[.97] disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
    >
      {children}
    </button>
  )
}

interface NumberFieldProps {
  prompt: string
  unit: string
  /** Locked (answered or committed): shows the value, takes no input. */
  locked: boolean
  value: string
  onValue(v: string): void
  onSubmit(): void
  invalid: boolean
  uid: string
}

function NumberField({ prompt, unit, locked, value, onValue, onSubmit, invalid, uid }: NumberFieldProps) {
  return (
    <fieldset className="min-w-0" disabled={locked}>
      <legend className="mb-1.5 text-body-sm font-medium leading-snug text-text-1">{renderInline(prompt)}</legend>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit()
            }
          }}
          aria-label={`Your answer in ${unit}`}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${uid}-err` : undefined}
          className="h-9 w-28 min-w-0 rounded-sm border border-line bg-ink px-2 font-mono text-body-sm text-text-1 disabled:opacity-70 [@media(pointer:coarse)]:h-11"
        />
        <span className="font-mono text-[11px] text-text-3">{unit}</span>
      </div>
      {invalid && (
        <p id={`${uid}-err`} role="alert" className="mt-1.5 text-[12px] text-danger">
          Enter a number of {unit}, zero or more.
        </p>
      )}
    </fieldset>
  )
}

interface NumberCardProps {
  item: NumberPrimm
  /** `estimate` items are graded against this (the page computes it); `numeric` items carry their own. */
  truth: number
  answered?: PrimmAnswer
  onAnswer(a: PrimmAnswer): void
  takeFocus: TakeFocus
}

function NumberCard({ item, truth, answered, onAnswer, takeFocus }: NumberCardProps) {
  const uid = useId()
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const t0 = useShownAt()
  const submit = () => {
    if (answered) return
    const value = parseNumber(text)
    if (value === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    onAnswer({ item, grade: gradeNumber(item, value, truth), value, truth, ms: Date.now() - t0.current })
  }
  return (
    <div data-item={item.id}>
      <NumberField
        prompt={item.prompt}
        unit={item.unit}
        locked={answered !== undefined}
        value={answered?.value !== undefined ? String(answered.value) : text}
        onValue={(v) => {
          setText(v)
          setInvalid(false)
        }}
        onSubmit={submit}
        invalid={invalid}
        uid={uid}
      />
      {answered === undefined && <SubmitButton onClick={submit} />}
      <Feedback id={item.id} grade={answered?.grade} takeFocus={takeFocus} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The Modify step                                                     */
/* ------------------------------------------------------------------ */

interface ModifyStepProps {
  bundle: ForgeBundle
  /** The bundle's modify item: a number the learner predicts, graded against the dial's run. */
  item: NumberPrimm
  answered?: PrimmAnswer
  onAnswer(a: PrimmAnswer): void
  takeFocus: TakeFocus
}

/** Pick one dial, predict what the changed run comes to, then run it. The grade comes with the run. */
function ModifyStep({ bundle, item: m1, answered, onAnswer, takeFocus }: ModifyStepProps) {
  const uid = useId()
  const spec = bundle.primm.run
  const dials = spec.modify?.dials ?? []
  const [dial, setDial] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [committed, setCommitted] = useState<{ dial: string; value: number; at: number } | null>(null)
  const chosen = dials.find((d) => d.id === (committed?.dial ?? dial))
  const total = useMemo(() => (chosen === undefined ? 0 : spec.run(chosen.config).total), [chosen, spec])

  const commit = () => {
    const value = parseNumber(text)
    if (dial === null || value === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setCommitted({ dial, value, at: Date.now() })
  }

  const finished = (run: RunResult) => {
    if (committed === null || answered) return
    const grade = gradeNumber(m1, committed.value, run.value)
    const note = `Your change: ${chosen?.label}. ${run.summary}`
    onAnswer({ item: m1, grade: { ...grade, feedback: `${note} ${grade.feedback}` }, value: committed.value, truth: run.value, ms: Date.now() - committed.at })
  }

  if (dials.length === 0) {
    return (
      <div data-step-body="modify" className="rounded-sm border border-line bg-surface-2 p-3 text-body-sm text-text-2">
        This lab has no dials to turn yet. Go on to Make.
      </div>
    )
  }

  return (
    <div data-step-body="modify">
      <fieldset disabled={committed !== null} className="min-w-0">
        <legend className="mb-1.5 text-body-sm font-medium leading-snug text-text-1">
          {spec.modify?.lead ?? 'Change one thing about the reference run.'}
        </legend>
        <div className="space-y-1.5">
          {dials.map((d) => (
            <label
              key={d.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-2 text-body-sm [@media(pointer:coarse)]:min-h-11',
                (committed?.dial ?? dial) === d.id ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line text-text-2',
              )}
            >
              <input
                type="radio"
                name={`${uid}-dial`}
                checked={(committed?.dial ?? dial) === d.id}
                onChange={() => setDial(d.id)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3">
        <NumberField
          prompt={m1.prompt}
          unit={m1.unit}
          locked={committed !== null}
          value={committed !== null ? String(committed.value) : text}
          onValue={(v) => {
            setText(v)
            setInvalid(false)
          }}
          onSubmit={commit}
          invalid={invalid}
          uid={uid}
        />
        {committed === null && (
          <SubmitButton onClick={commit} disabled={dial === null}>
            Lock my prediction
          </SubmitButton>
        )}
      </div>
      {committed !== null && chosen !== undefined && (
        <div className="mt-3 space-y-2">
          <p className="font-mono text-[10px] text-text-3">
            Prediction locked: {committed.value} of {total} ops. Now run it.
          </p>
          {/* The lock button has just unmounted: focus goes to the next control, the run button. */}
          <ReferenceRun key={chosen.id} bundle={bundle} config={chosen.config} title={`Your run: ${chosen.label}`} onFinished={finished} focusRun />
          <Feedback id={m1.id} grade={answered?.grade} takeFocus={takeFocus} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export interface PrimmPanelProps {
  /** The lab's bundle: its items, steps, reference run and stages. */
  bundle: ForgeBundle
  checks: readonly ForgeLabCheck[]
  /** Ids of the required checks the latest run passed. */
  passed: ReadonlySet<string>
  /** Passed check ids of every lab run so far (attempts-to-green). */
  runs?: readonly (readonly string[])[]
  /** The step to open first. Default `predict`. */
  initial?: PrimmStepId
  /** Below the stage list in the Make step: the drop zone. */
  children?: ReactNode
}

/** "[lab 02]" is "Lab 02". */
const labName = (label: string) => label.replace(/^\[|\]$/g, '').replace(/^./, (c) => c.toUpperCase())

export function PrimmPanel({ bundle, checks, passed, runs, initial = 'predict', children }: PrimmPanelProps) {
  const recordItems = useProgress((s) => s.recordItems)
  const { items, steps, run: spec } = bundle.primm
  const [active, setActive] = useState<PrimmStepId>(initial)
  const [answers, setAnswers] = useState<Record<string, PrimmAnswer>>({})
  const [seed] = useState(freshSeed)
  const [peek, setPeek] = useState(false)
  const [ran, setRan] = useState(false)
  const stepItems = (step: PrimmStepId) => items.filter((i) => i.step === step)
  const predictItems = stepItems('predict')
  const investigateItems = stepItems('investigate')
  const modifyItem = items.find((i): i is NumberPrimm => i.step === 'modify' && i.kind !== 'choice')
  // An estimate is graded against the run the Predict step asks about: the baseline when the spec has one, else the reference.
  const estimateTruth = useMemo(() => spec.run(spec.baseline ?? spec.reference).value, [spec])
  // Ids already written, checked synchronously so a double Enter or a double finish writes one event, not two.
  const sent = useRef(new Set<string>())
  // The item whose result should take focus once it renders; cleared when the learner changes step.
  const focusFor = useRef<string | null>(null)
  const takeFocus = useCallback<TakeFocus>((id) => {
    if (focusFor.current !== id) return false
    focusFor.current = null
    return true
  }, [])
  // After "Next" or "Go predict" the pressed button may unmount: the step's lead-in takes focus instead.
  const lead = useRef<HTMLParagraphElement>(null)
  const moved = useRef(false)
  const go = (step: PrimmStepId, fromButton = false) => {
    focusFor.current = null
    moved.current = fromButton
    setActive(step)
  }
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    lead.current?.focus()
  }, [active])

  const answer = (a: PrimmAnswer) => {
    const id = a.item.id
    if (sent.current.has(id) || answers[id] !== undefined) return
    // "Show me anyway" shows the answer to Predict: those two are no longer evidence, so they write nothing.
    if (a.item.step === 'predict' && !predictGraded(peek, false)) return
    sent.current.add(id)
    focusFor.current = id
    setAnswers((prev) => ({ ...prev, [id]: a }))
    recordItems([itemResponse(a)])
  }

  // Only the reference run is the Run step's evidence; the baseline beside it is for comparison.
  const observed = (run: RunResult) => {
    if (sent.current.has(spec.item.id) || !sameConfig(run.config, spec.reference)) return
    sent.current.add(spec.item.id)
    setRan(true)
    recordItems([observationResponse(spec.item, run)])
  }

  const predicted = predictItems.every((i) => answers[i.id] !== undefined)
  const done: Record<PrimmStepId, boolean> = {
    predict: predicted,
    run: ran,
    investigate: investigateItems.every((i) => answers[i.id] !== undefined),
    modify: modifyItem !== undefined && answers[modifyItem.id] !== undefined,
    make: false,
  }
  const index = steps.findIndex((s) => s.id === active)
  const next = steps[index + 1]

  const card = (i: PrimmItem) => {
    const a = answers[i.id]
    if (!predictGraded(peek, a !== undefined) && i.step === 'predict') {
      return (
        <div key={i.id} className="rounded-sm border border-line bg-surface-2 p-3 text-body-sm text-text-2" data-item={i.id} data-locked="peeked">
          <p className="font-medium text-text-1">{renderInline(i.kind === 'choice' ? i.item.q.q : i.prompt)}</p>
          <p className="mt-1.5">You saw the run first, so this question is not graded and nothing is recorded for it.</p>
        </div>
      )
    }
    return (
      <div key={i.id} className="rounded-sm border border-line bg-surface-2 p-3">
        {i.kind === 'choice' ? (
          <ChoiceCard item={i} seed={seed} answered={a} onAnswer={answer} takeFocus={takeFocus} />
        ) : (
          <NumberCard item={i} truth={i.kind === 'numeric' ? (i.truth ?? 0) : estimateTruth} answered={a} onAnswer={answer} takeFocus={takeFocus} />
        )}
      </div>
    )
  }

  return (
    <section aria-label={`${labName(bundle.discussionsLabel)} in five steps`} data-primm-panel data-step={active} className="space-y-3">
      <ol className="flex flex-wrap gap-1.5" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => go(s.id)}
              aria-current={s.id === active ? 'step' : undefined}
              data-step-tab={s.id}
              className={cn(
                'inline-flex items-center gap-1 rounded-xs border px-2 py-1 font-mono text-[10px] uppercase tracking-wide [@media(pointer:coarse)]:min-h-11',
                s.id === active ? 'border-line-bright bg-surface-3 text-text-1' : done[s.id] ? 'border-accent/40 text-accent' : 'border-line text-text-3 hover:text-text-1',
              )}
            >
              {done[s.id] ? <Check size={10} strokeWidth={3} aria-hidden /> : null}
              {i + 1} {s.title}
              <span className="sr-only">{done[s.id] ? ' (done)' : ''}</span>
            </button>
          </li>
        ))}
      </ol>
      <p ref={lead} tabIndex={-1} className="text-body-sm text-text-2" data-step-lead>
        <span className="sr-only">
          Step {index + 1} of {steps.length}, {steps[index].title}.{' '}
        </span>
        {steps[index].blurb}
      </p>

      {active === 'predict' && (
        <div className="space-y-3" data-step-body="predict">
          {predictItems.map(card)}
        </div>
      )}

      {active === 'run' && (
        <div className="space-y-3" data-step-body="run">
          {!predicted && !peek ? (
            <div className="rounded-sm border border-line bg-surface-2 p-3 text-body-sm text-text-2">
              <p>
                The first run gives away what you were asked to predict. Answer the {COUNT_WORD[predictItems.length] ?? predictItems.length}{' '}
                {predictItems.length === 1 ? 'question' : 'questions'} in step 1 first; it takes a minute.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => go('predict', true)}
                  className="rounded-sm border border-line px-3 py-1.5 font-mono text-[11px] text-text-1 [@media(pointer:coarse)]:min-h-11"
                >
                  Go predict
                </button>
                <button
                  type="button"
                  onClick={() => setPeek(true)}
                  className="rounded-sm border border-line px-3 py-1.5 font-mono text-[11px] text-text-3 hover:text-text-1 [@media(pointer:coarse)]:min-h-11"
                >
                  Show me anyway (Predict is then not graded)
                </button>
              </div>
            </div>
          ) : (
            <>
              <ReferenceRun bundle={bundle} config={spec.reference} onFinished={observed} />
              {spec.baseline !== undefined && <ReferenceRun bundle={bundle} config={spec.baseline} />}
            </>
          )}
        </div>
      )}

      {active === 'investigate' && (
        <div className="space-y-3" data-step-body="investigate">
          {investigateItems.map(card)}
        </div>
      )}

      {active === 'modify' &&
        (modifyItem === undefined ? (
          <div data-step-body="modify" className="rounded-sm border border-line bg-surface-2 p-3 text-body-sm text-text-2">
            This lab has no Modify question yet. Go on to Make.
          </div>
        ) : (
          <ModifyStep bundle={bundle} item={modifyItem} answered={answers[modifyItem.id]} onAnswer={answer} takeFocus={takeFocus} />
        ))}

      {active === 'make' && (
        <div className="space-y-3" data-step-body="make">
          <StagePanel bundle={bundle} checks={checks} passed={passed} runs={runs} />
          {children}
        </div>
      )}

      {next !== undefined && (
        <button
          type="button"
          onClick={() => go(next.id, true)}
          className="inline-flex items-center gap-1 rounded-sm border border-line px-3 py-1.5 font-mono text-[11px] text-text-2 hover:text-text-1 [@media(pointer:coarse)]:min-h-11"
          data-next-step
        >
          Next: {next.title} <ChevronRight size={12} aria-hidden />
        </button>
      )}
    </section>
  )
}
