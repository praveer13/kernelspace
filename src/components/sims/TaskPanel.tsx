/**
 * Outcome-graded sim tasks: predict → run → explain (docs/specs/wave-1.md §10.3).
 *
 *   predict  the learner commits a number or a choice (and may say how sure); it is locked at once
 *   run      the sim reports `observe({key, value})`; the first one after the commit is graded
 *   explain  a line of 8+ words unlocks the model answer and its three ideas; saving writes the outcome
 *
 * The task completes when the explanation is saved, whatever the prediction's verdict, and never without
 * a committed prediction (`reduceRun` and `buildOutcome` in src/lib/sims/host.ts enforce that). The
 * task's "what just happened" note stays hidden until then.
 */

import { Suspense, lazy, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import { Check, CircleDashed, Lock } from 'lucide-react'
import { useProgress } from '@/lib/progress'
import { clsx as cn } from 'clsx' // not twMerge: it drops `text-body-sm` next to a `text-text-*` colour
import type { Confidence } from '@/lib/ledger/types'
import type { PredictSpec, SimTaskDef } from '@/lib/sims/types'
import {
  MAX_EXPLAIN_CHARS,
  MIN_EXPLAIN_WORDS,
  checkPrediction,
  completeTask,
  describePrediction,
  explainReady,
  formatNumber,
  freshRun,
  reduceRun,
  useSimHost,
  useTasksDone,
  wordCount,
} from '@/lib/sims/host'
import type { Prediction, RunAction, SimHostInternal, TaskRun } from '@/lib/sims/host'
import { resolveTasks } from '@/lib/sims/registry'

// Phone mode is its own chunk: a laptop reader never fetches it.
const PhoneOutcome = lazy(() => import('@/components/sims/PhoneOutcome'))

const CONFIDENCE: readonly { id: Confidence; label: string }[] = [
  { id: 'guess', label: 'guess' },
  { id: 'think', label: 'think so' },
  { id: 'sure', label: 'sure' },
]

const STEPS = ['Predict', 'Run', 'Explain'] as const

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

export interface TaskListProps {
  simId: string
  machine?: string | null
  /** Registry ids to show, in order; default: every task of the sim (and machine). */
  taskIds?: readonly string[]
  /** `outcome` leaves the legacy tasks to the shell's own list. Default `all`. */
  kinds?: 'all' | 'outcome'
}

/** The sim's tasks with live state: a panel per outcome task, a checklist row per legacy task. */
export function TaskList({ simId, machine, taskIds, kinds = 'all' }: TaskListProps) {
  const host = useSimHost()
  const tasks = useMemo(
    () => resolveTasks(simId, machine, taskIds).filter((t) => kinds === 'all' || t.kind === 'outcome'),
    [simId, machine, taskIds, kinds],
  )
  const done = useTasksDone(tasks)
  if (tasks.length === 0) return null
  const count = tasks.filter((t) => done[t.id]).length
  return (
    <section aria-label="Guided tasks" data-task-list={simId}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-mono text-label uppercase tracking-[0.10em] text-text-3">Guided tasks</h3>
        <span className="font-mono text-[10px] text-text-3">
          {count}/{tasks.length} done
        </span>
      </div>
      <ul className="space-y-3">
        {tasks.map((t) => (
          <li key={t.id}>
            {t.kind === 'legacy' ? (
              <LegacyRow task={t} done={done[t.id]} />
            ) : host === null ? null : host.mode === 'phone' ? (
              <Suspense fallback={<p className="font-mono text-[11px] text-text-3">loading</p>}>
                <PhoneOutcome task={t} />
              </Suspense>
            ) : (
              <TaskPanel task={t} host={host} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function LegacyRow({ task, done }: { task: SimTaskDef; done: boolean }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-sm border px-3 py-2.5',
        done ? 'border-accent/40 bg-accent-dim/30' : 'border-line bg-surface-2',
      )}
      data-task-id={task.id}
      data-done={done}
    >
      <span
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          done ? 'border-accent bg-accent text-accent-foreground' : 'border-line-bright',
        )}
        aria-hidden
      >
        {done && <Check size={10} strokeWidth={3} />}
      </span>
      <span className={cn('text-body-sm leading-snug', done ? 'text-text-3' : 'text-text-2')}>
        {task.title}
        <span className="sr-only">{done ? ' (done)' : ' (not done)'}</span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The prediction fields (shared with phone mode)                      */
/* ------------------------------------------------------------------ */

export interface PredictDraft {
  text: string
  choice?: string
  conf?: Confidence
}

export interface PredictFieldsProps {
  uid: string
  spec: PredictSpec
  draft: PredictDraft
  onDraft(draft: PredictDraft): void
  invalid: boolean
  /** After the commit: the fields show the locked prediction and cannot change. */
  locked: boolean
  lockedPrediction?: Prediction
  lockedConf?: Confidence
  onSubmit(): void
}

/** The prompt, the answer (a number with its unit, or one option) and the optional "how sure". */
export function PredictFields({ uid, spec, draft, onDraft, invalid, locked, lockedPrediction, lockedConf, onSubmit }: PredictFieldsProps) {
  const shownConf = locked ? lockedConf : draft.conf
  return (
    <fieldset className="mt-3 min-w-0" disabled={locked}>
      <legend className="mb-1.5 text-body-sm font-medium text-text-1">{spec.prompt}</legend>
      {spec.kind === 'numeric' ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={locked && lockedPrediction?.value !== undefined ? formatNumber(lockedPrediction.value) : draft.text}
            onChange={(e) => onDraft({ ...draft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSubmit()
              }
            }}
            aria-label={`Your prediction in ${spec.unit}`}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${uid}-err` : undefined}
            className="h-9 w-28 min-w-0 rounded-sm border border-line bg-ink px-2 font-mono text-body-sm text-text-1 disabled:opacity-70"
          />
          <span className="font-mono text-[11px] text-text-3">{spec.unit}</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {spec.options.map((o) => {
            const picked = (locked ? lockedPrediction?.choice : draft.choice) === o.id
            return (
              <label
                key={o.id}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-sm border px-2.5 py-2 text-body-sm',
                  picked ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line text-text-2',
                  locked && 'cursor-default',
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-choice`}
                  value={o.id}
                  checked={picked}
                  onChange={() => onDraft({ ...draft, choice: o.id })}
                  className="mt-1 accent-accent"
                />
                <span>{o.text}</span>
              </label>
            )
          })}
        </div>
      )}
      {invalid && (
        <p id={`${uid}-err`} role="alert" className="mt-1.5 text-[12px] text-danger">
          {spec.kind === 'numeric' ? `Enter ${spec.log === true ? 'a positive ' : 'a '}number in ${spec.unit}.` : 'Pick one answer.'}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="How sure are you? (optional)">
        <span className="mr-1 font-mono text-[10px] uppercase text-text-3">how sure</span>
        {CONFIDENCE.map((c) => {
          const on = shownConf === c.id
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onDraft({ ...draft, conf: on ? undefined : c.id })}
              className={cn(
                'rounded-xs border px-2 py-1 font-mono text-[10px] transition-colors duration-150 disabled:cursor-default',
                on ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line text-text-3 hover:text-text-1',
              )}
            >
              {c.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

/* ------------------------------------------------------------------ */
/* One outcome task                                                    */
/* ------------------------------------------------------------------ */

export function TaskPanel({ task, host }: { task: SimTaskDef; host: SimHostInternal }) {
  const spec = task.predict
  const recordOutcome = useProgress((s) => s.recordSimOutcome)
  const ledgerDone = useProgress((s) => s.aggregate.sims[task.simId]?.outcomes[task.id] === true)
  const earlierDone = useProgress((s) =>
    task.legacyId === undefined ? false : s.sims[task.simId]?.tasksDone.includes(task.legacyId) === true,
  )
  const [run, dispatch] = useReducer((s: TaskRun, a: RunAction) => reduceRun(task, s, a), undefined, freshRun)
  const [draft, setDraft] = useState<PredictDraft>({ text: '' })
  const [invalid, setInvalid] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const saved = useRef(false)
  const uid = useId()

  // The sim reports what it measured; the reducer ignores everything outside the run phase.
  useEffect(() => host.bus.subscribe((obs) => dispatch({ type: 'observe', obs })), [host.bus])

  if (spec === undefined || task.explain === undefined) return null

  const done = ledgerDone || run.phase === 'done'
  const locked = run.phase !== 'predict'
  const step = run.phase === 'predict' ? 0 : run.phase === 'run' ? 1 : 2
  const grade = run.observed?.grade

  const commit = () => {
    const prediction = checkPrediction(spec, draft)
    if (prediction === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    dispatch({ type: 'commit', prediction, conf: draft.conf, at: Date.now() })
  }

  const save = () => {
    if (saved.current) return
    const ms = run.committedAt === undefined ? undefined : Date.now() - run.committedAt
    if (!completeTask(recordOutcome, task, run, { ms })) return
    saved.current = true
    host.finished.add(task.id)
    dispatch({ type: 'finish' })
  }

  const retry = () => {
    setDraft({ text: '' })
    setRevealed(false)
    saved.current = false
    dispatch({ type: 'retry' })
  }

  return (
    <article
      className={cn('rounded-sm border bg-surface-2 p-3', done ? 'border-accent/40' : 'border-line')}
      data-task-id={task.id}
      data-phase={ledgerDone && run.phase === 'predict' ? 'done' : run.phase}
      data-done={done}
      aria-labelledby={`${uid}-title`}
    >
      <header className="flex items-start gap-2">
        <span
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
            done ? 'border-accent bg-accent text-accent-foreground' : 'border-line-bright',
          )}
          aria-hidden
        >
          {done && <Check size={10} strokeWidth={3} />}
        </span>
        <h4 id={`${uid}-title`} className="text-body-sm font-medium leading-snug text-text-1">
          {task.title}
          <span className="sr-only">{done ? ' (done)' : ''}</span>
        </h4>
      </header>

      {ledgerDone && run.phase === 'predict' ? (
        <div className="mt-2 space-y-2 text-body-sm text-text-2">
          <p>Done. You predicted, ran it and explained it.</p>
          {task.note && <Note text={task.note} />}
        </div>
      ) : (
        <>
          <ol className="mt-2 flex gap-1 font-mono text-[10px] uppercase tracking-wide" aria-label="Steps">
            {STEPS.map((label, i) => (
              <li
                key={label}
                aria-current={i === step && run.phase !== 'done' ? 'step' : undefined}
                className={cn(
                  'rounded-xs border px-1.5 py-0.5',
                  i < step || run.phase === 'done'
                    ? 'border-accent/40 text-accent'
                    : i === step
                      ? 'border-line-bright text-text-1'
                      : 'border-line text-text-3',
                )}
              >
                {i + 1} {label}
              </li>
            ))}
          </ol>

          <p className="mt-2 text-body-sm text-text-2">{task.setup}</p>
          {earlierDone && run.phase === 'predict' && (
            <p className="mt-1 font-mono text-[10px] text-text-3">
              You finished the old click-through of this task. This one grades a prediction.
            </p>
          )}

          {/* 1. predict */}
          <PredictFields
            uid={uid}
            spec={spec}
            draft={draft}
            onDraft={(d) => {
              setDraft(d)
              setInvalid(false)
            }}
            invalid={invalid}
            locked={locked}
            lockedPrediction={run.prediction}
            lockedConf={run.conf}
            onSubmit={commit}
          />

          {run.phase === 'predict' && (
            <button
              type="button"
              onClick={commit}
              className="mt-3 flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
            >
              <Lock size={13} strokeWidth={2} aria-hidden />
              Lock in my prediction
            </button>
          )}

          {/* 2. run */}
          {run.phase === 'run' && run.prediction !== undefined && (
            <p role="status" className="mt-3 flex items-start gap-2 text-body-sm text-text-2">
              <CircleDashed size={14} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
              <span>
                Locked: <span className="font-mono text-text-1">{describePrediction(spec, run.prediction)}</span>. Now run it in
                the simulator; the first result it reports is graded.
              </span>
            </p>
          )}

          {/* 3. explain */}
          {run.observed !== undefined && run.prediction !== undefined && grade !== undefined && (
            <div className="mt-3 space-y-3">
              <p
                role="status"
                className={cn(
                  'rounded-sm border-l-2 px-2.5 py-2 text-body-sm text-text-1',
                  grade.ok ? 'border-accent bg-accent-dim/30' : 'border-amber bg-surface-3',
                )}
              >
                <span className="block font-medium">{grade.ok ? 'Your prediction held.' : 'Your prediction was off.'}</span>
                <span className="block text-text-2">
                  You said {describePrediction(spec, run.prediction)}; the sim measured{' '}
                  {typeof run.observed.actual === 'number'
                    ? `${formatNumber(run.observed.actual)} ${run.observed.unit ?? (spec.kind === 'numeric' ? spec.unit : '')}`.trim()
                    : spec.kind === 'choice'
                      ? (spec.options.find((o) => o.id === run.observed?.actual)?.text ?? run.observed.actual)
                      : run.observed.actual}
                  {grade.logErr !== undefined && !grade.ok ? ` (a factor of ${formatNumber(10 ** Math.abs(grade.logErr))} ${grade.logErr > 0 ? 'too high' : 'too low'})` : ''}
                  .
                </span>
              </p>

              {run.phase === 'explain' && (
                <div>
                  <label htmlFor={`${uid}-explain`} className="mb-1.5 block text-body-sm font-medium text-text-1">
                    {task.explain.prompt}
                  </label>
                  <textarea
                    id={`${uid}-explain`}
                    value={run.explain}
                    onChange={(e) => dispatch({ type: 'explain', text: e.target.value })}
                    maxLength={MAX_EXPLAIN_CHARS}
                    rows={2}
                    aria-describedby={`${uid}-count`}
                    className="w-full resize-y rounded-sm border border-line bg-ink px-2 py-1.5 text-body-sm text-text-1"
                  />
                  <p id={`${uid}-count`} className="mt-1 font-mono text-[10px] text-text-3">
                    {wordCount(run.explain)}/{MIN_EXPLAIN_WORDS} words{' '}
                    {explainReady(run.explain) ? '· ready' : `· ${MIN_EXPLAIN_WORDS - wordCount(run.explain)} more unlocks the model answer`}
                  </p>
                  {!revealed && (
                    <button
                      type="button"
                      disabled={!explainReady(run.explain)}
                      onClick={() => setRevealed(true)}
                      className={cn(
                        'mt-2 rounded-md px-3.5 py-2 font-display text-[14px] font-semibold transition-all duration-150 active:scale-[.97]',
                        explainReady(run.explain)
                          ? 'bg-accent text-accent-foreground hover:-translate-y-px'
                          : 'cursor-not-allowed bg-surface-3 text-text-3',
                      )}
                    >
                      Show the model answer
                    </button>
                  )}
                </div>
              )}

              {revealed && run.phase === 'explain' && (
                <div className="space-y-2 text-body-sm text-text-2">
                  <p>
                    <span className="font-medium text-text-1">Model answer. </span>
                    {task.explain.model}
                  </p>
                  <fieldset>
                    <legend className="mb-1 font-mono text-[10px] uppercase text-text-3">Tick the ideas your line covered</legend>
                    <ul className="space-y-1">
                      {task.explain.ideas.map((idea, i) => (
                        <li key={i}>
                          <label className="flex cursor-pointer items-start gap-2">
                            <input
                              type="checkbox"
                              checked={run.ideas.includes(i)}
                              onChange={() => dispatch({ type: 'idea', index: i })}
                              className="mt-1"
                            />
                            <span>{idea}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!explainReady(run.explain)}
                    className="rounded-md bg-accent px-3.5 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3"
                  >
                    Save result
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 4. done */}
          {run.phase === 'done' && (
            <div className="mt-3 space-y-2 text-body-sm text-text-2">
              <p role="status" className="text-text-1">
                Saved{grade?.ok ? '.' : '. The prediction missed, and that still counts as a finished cycle.'}
              </p>
              {task.explain && (
                <p>
                  <span className="font-medium text-text-1">Model answer. </span>
                  {task.explain.model}
                </p>
              )}
              {task.note && <Note text={task.note} />}
              {!grade?.ok && (
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-md border border-line bg-surface-3 px-3 py-1.5 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]"
                >
                  Try again with a fresh prediction
                </button>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
}

/** "What just happened": only rendered once the task is complete, so it never spoils the discovery. */
export function Note({ text }: { text: string }) {
  return (
    <div className="rounded-sm border border-line bg-surface-1 px-2.5 py-2" data-task-note>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-text-3">What just happened</p>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className={i > 0 ? 'mt-1.5' : undefined}>
          {para}
        </p>
      ))}
    </div>
  )
}
