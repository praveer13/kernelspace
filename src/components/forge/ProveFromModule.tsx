import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Lock, ShieldCheck } from 'lucide-react'
import { clsx as cn } from 'clsx'
import type { ForgeBundle, ProveV2Template } from '@/data/forge/types'
import type { ForgeLab } from '@/data/labs'
import { getLedgerClient } from '@/lib/ledger/client'
import { sha256Hex } from '@/lib/ledger/stable'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import { runLabCalls } from '@/lib/lab-worker'
import { eligibility, attemptsOf, pickTemplate, planQuestion, proveFromModule, readAnswer } from '@/lib/forge/prove2'
import type { GradedRun, Prove2Attempt, Prove2Plan, ProveAttemptResult, ProveEventLike } from '@/lib/forge/prove2'
import { opensLine, verdictFor } from '@/lib/forge/prove-return'
import type { PanelEnv, ProveEnv } from '@/lib/forge/prove-return'
import type { Credit } from '@/lib/forge/run'
import type { LabRunReport } from '@/lib/forge/types'

/**
 * Prove-it v2 on ForgeLab (docs/specs/wave-3.md §7.2-7.4, task 3b-04): after a run that passed every required check on
 * fresh seeds, "Close your agent: what will your module say?" draws a fresh seed, tells the trace in words, takes your
 * prediction, runs the calls on the module just graded (in the lab worker) and records the result through
 * `recordProve`. The simulator grades, not a model (prove2.ts); a miss shows what your module actually replied and when
 * the next credited attempt opens. Nothing locks (W8): attempts before then are practice, and say so.
 *
 * `ProveV2Session` is one question, and the 30-day return card on Today uses it too. ForgeLab mounts this panel with
 * the bundle and the run's values (the same ones InstallButton gets); a lab whose bundle has no `prove2` renders nothing.
 */
export interface ProveFromModuleProps {
  lab: ForgeLab
  bundle: ForgeBundle
  /** The module that produced `report`, as dropped. */
  bytes: ArrayBuffer
  report: LabRunReport
  credit: Credit
  /** The lab worker, the ledger and the clock; tests replace them. */
  env?: Partial<PanelEnv>
}

type GradedAttempt = Extract<ProveAttemptResult, { kind: 'graded' }>

const touch = 'min-h-6 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11'
const primaryBtn =
  'flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3 disabled:hover:translate-y-0'
const quietBtn =
  'flex items-center rounded-md border border-line bg-surface-3 px-3.5 py-2 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]'

/** Backticks mark code in the authored asks. */
export function Inline({ text }: { text: string }): ReactNode {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="rounded-xs bg-surface-3 px-1 font-mono text-[0.92em] text-text-1">
        {part}
      </code>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

/** The lab worker, the ledger façade, the clock and `sha256Hex`, unless the caller gave others. */
function withDefaults(env: Partial<ProveEnv> | undefined): ProveEnv {
  return {
    run: env?.run ?? runLabCalls,
    record: env?.record ?? ((r) => useProgress.getState().recordProve(r)),
    now: env?.now ?? (() => Date.now()),
    hash: env?.hash ?? sha256Hex,
  }
}

export interface ProveV2SessionProps {
  labId: string
  template: ProveV2Template
  plan: Prove2Plan
  /** The module to ask: the one ForgeLab just graded, or the installed component. */
  bytes: ArrayBuffer
  /** The run that graded this module; null when none did (then the answer is practice). */
  graded: GradedRun | null
  history: readonly Prove2Attempt[]
  /** The 30-day return (§7.5): recorded with `data.return`, and a miss starts no wait. */
  ret?: boolean
  env?: Partial<ProveEnv>
  /** Said above the input: whether this attempt can earn `proved`, and why not. */
  note?: string
  /** `verdict`: focus moves to the result when it arrives (the card); `none`: the caller moves it (the panel). */
  focus?: 'verdict' | 'none'
  onGraded?(out: GradedAttempt, answer: number | number[]): void
}

type Phase = { kind: 'ask' } | { kind: 'running' } | { kind: 'done'; out: GradedAttempt; answer: number | number[]; at: number } | { kind: 'refused'; message: string }

/**
 * One v2 question: the trace in words, the input, "Run my module", and the verdict. The input is read through
 * `readAnswer`, so text that is not an answer gets a message (an `aria-live` region) and nothing runs or is recorded;
 * `none` is the empty id list. The verdict is an `aria-live` region that is always mounted.
 */
export function ProveV2Session({ labId, template, plan, bytes, graded, history, ret, env, note, focus = 'none', onGraded }: ProveV2SessionProps) {
  const uid = useId()
  const e = useMemo(() => withDefaults(env), [env])
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' })
  const shownAt = useRef<number | null>(null)
  const busy = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const kind = plan.answer
  const hint =
    kind === 'number' ? 'One number, such as 12 or 2.5.' : 'The ids in order, separated by commas, such as 3, 7, 1. Type none if the list is empty.'

  useEffect(() => {
    if (focus === 'verdict' && (phase.kind === 'done' || phase.kind === 'refused')) resultRef.current?.focus({ preventScroll: false })
  }, [focus, phase.kind])

  const submit = async () => {
    if (busy.current || phase.kind === 'done') return
    const read = readAnswer(text, kind)
    if (!read.ok) {
      setMessage(read.message)
      inputRef.current?.focus()
      return
    }
    setMessage('')
    busy.current = true
    shownAt.current ??= e.now()
    setPhase({ kind: 'running' })
    try {
      const out = await proveFromModule({
        labId,
        template,
        plan,
        answer: read.answer,
        bytes,
        graded,
        history,
        now: e.now(),
        run: e.run,
        ...(e.hash === undefined ? {} : { hash: e.hash }),
        ms: Math.max(0, e.now() - shownAt.current),
        ...(ret ? { ret: true } : {}),
      })
      if (out.kind === 'refused') {
        setPhase({ kind: 'refused', message: out.message })
        return
      }
      e.record(out.result)
      setPhase({ kind: 'done', out, answer: read.answer, at: e.now() })
      onGraded?.(out, read.answer)
    } catch (err) {
      setPhase({ kind: 'ask' })
      setMessage(`Could not run your module: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      busy.current = false
    }
  }

  const verdict = phase.kind === 'done' ? verdictFor(phase.out, phase.answer, { now: phase.at, ...(ret ? { ret: true } : {}) }) : null
  const locked = phase.kind === 'running' || phase.kind === 'done'

  return (
    <div data-prove-v2={labId} data-qid={template.id} data-state={phase.kind}>
      <ol className="space-y-1 text-body-sm text-text-2" data-prove-story aria-label="The calls, in words">
        {plan.story.map((line, i) => (
          <li key={i} className="break-words">
            <span className="mr-1.5 font-mono text-[10px] text-text-3" aria-hidden>
              {i + 1}.
            </span>
            {line}
          </li>
        ))}
      </ol>
      <details className="mt-2 text-body-sm text-text-3">
        <summary className={cn('cursor-pointer', touch)}>The exact calls</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words rounded-xs bg-surface-3 p-2 font-mono text-[11px] text-text-2">{plan.calls.join('\n')}</pre>
      </details>

      {note !== undefined && (
        <p className="mt-2 text-body-sm text-text-3" data-prove-note>
          {note}
        </p>
      )}

      <form
        className="mt-3"
        onSubmit={(ev) => {
          ev.preventDefault()
          void submit()
        }}
      >
        <label htmlFor={`${uid}-a`} className="block text-body-sm font-medium text-text-1">
          <Inline text={plan.ask} />
        </label>
        <input
          ref={inputRef}
          id={`${uid}-a`}
          data-prove-answer
          type="text"
          inputMode={kind === 'number' ? 'decimal' : 'text'}
          autoComplete="off"
          spellCheck={false}
          value={text}
          readOnly={locked}
          onChange={(ev) => setText(ev.target.value)}
          aria-invalid={message !== ''}
          aria-describedby={`${uid}-hint ${uid}-msg`}
          className={cn('mt-1.5 w-full rounded-sm border bg-ink px-2 py-1.5 font-mono text-body-sm text-text-1', message === '' ? 'border-line' : 'border-warn', touch)}
        />
        <p id={`${uid}-hint`} className="mt-1 font-mono text-[10px] text-text-3">
          {hint}
        </p>
        {/* always mounted so a message is announced when it appears */}
        <p id={`${uid}-msg`} role="status" aria-live="polite" data-prove-message className={cn('text-body-sm text-warn', message !== '' && 'mt-1')}>
          {message}
        </p>
        {phase.kind !== 'done' && (
          <button type="submit" data-prove-run aria-disabled={phase.kind === 'running'} className={cn('mt-2', primaryBtn, touch, phase.kind === 'running' && 'opacity-70')}>
            {phase.kind === 'running' ? 'Running your module' : 'Run my module'}
          </button>
        )}
      </form>

      <div ref={resultRef} tabIndex={-1} role="group" aria-label="Result" data-prove-result className="outline-none">
        {/* always mounted so the verdict is announced when it appears */}
        <div role="status" aria-live="polite" data-prove-verdict data-tone={verdict?.tone ?? phase.kind}>
          {phase.kind === 'refused' && <p className="mt-3 text-body-sm text-warn">{phase.message} Nothing was recorded.</p>}
          {verdict !== null && (
            <div
              className={cn(
                'mt-3 space-y-1 rounded-sm border-l-2 px-2.5 py-2 text-body-sm text-text-2',
                verdict.tone === 'right' ? 'border-accent bg-accent-dim/30' : 'border-warn bg-surface-1',
              )}
            >
              <p className="font-medium text-text-1">{verdict.headline}</p>
              {verdict.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** The panel's own questions: the draw is a template and a seed. */
interface Question {
  template: ProveV2Template
  plan: Prove2Plan
}

/** The title and the honour line every state of the panel carries. */
function PanelHead({ id, children }: { id: string; children?: ReactNode }) {
  return (
    <header>
      <h3 id={id} className="flex items-center gap-1.5 text-body-sm font-medium text-text-1">
        <ShieldCheck size={13} strokeWidth={2} aria-hidden />
        Close your agent: what will your module say?
      </h3>
      <p className="mt-1 text-body-sm text-text-3">
        Close your agent; this is calibration, not a test. Your own module runs the calls below in the lab worker, and your prediction is compared with its reply. A
        right answer on this module earns <span className="font-medium text-text-2">proved</span>.
      </p>
      {children}
    </header>
  )
}

/** What this attempt will be recorded as, before it runs. */
function noteFor(el: ReturnType<typeof eligibility>, now: number): string {
  if (el.credited) return 'This attempt can earn proved: it is the module ForgeLab just graded on fresh seeds.'
  if (el.reason === 'retry') {
    return `A credited attempt ${el.opensAt === undefined ? 'opens later' : opensLine(el.opensAt, now)}. Until then your answers are practice, and say so.`
  }
  if (el.reason === 'module') return 'This is not the module ForgeLab just graded, so this attempt is practice.'
  return 'The run behind this module was not graded on fresh seeds, so this attempt is practice.'
}

interface AskingProps {
  lab: ForgeLab
  templates: readonly ProveV2Template[]
  bytes: ArrayBuffer
  sha: string
  env: Partial<PanelEnv> | undefined
}

/** The module is hashed, graded `unseen` and green: draw questions from the lab's templates, one after another. */
function Asking({ lab, templates, bytes, sha, env }: AskingProps) {
  const uid = useId()
  const e = useMemo(
    () => ({
      ...withDefaults(env),
      seed: env?.seed ?? freshSeed,
      history:
        env?.history ??
        (async (labId: string): Promise<Prove2Attempt[]> => {
          const client = await getLedgerClient()
          const [runs, proves] = await Promise.all([client.events({ kinds: ['lab-check'], refPrefix: `lab:${labId}` }), client.events({ kinds: ['prove'], refPrefix: `prove:${labId}` })])
          return attemptsOf([...runs, ...proves] as unknown as ProveEventLike[], labId)
        }),
    }),
    [env],
  )
  const [history, setHistory] = useState<Prove2Attempt[] | null>(null)
  const [q, setQ] = useState<Question | null>(null)
  const [error, setError] = useState('')
  const [last, setLast] = useState<GradedAttempt | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const graded = useMemo<GradedRun>(() => ({ sha256: sha, credit: 'unseen' }), [sha])

  // The next question: never-served templates first, on a fresh seed. A template that breaks its contract is reported, not shown.
  const draw = (h: readonly Prove2Attempt[]) => {
    try {
      const template = pickTemplate(templates, h)
      setQ({ template, plan: planQuestion(template, e.seed()) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    let live = true
    void e
      .history(lab.id)
      .catch(() => [] as Prove2Attempt[])
      .then((h) => {
        if (!live) return
        setHistory(h)
        draw(h)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawn once per mount, from the history as it was then
  }, [e, lab.id])

  // The pressed button unmounts when the question is graded: hand focus to what comes next.
  useEffect(() => {
    if (last !== null) nextRef.current?.focus({ preventScroll: true })
  }, [last])

  const now = e.now()
  const heading = `${uid}-h`
  if (error !== '') {
    return (
      <section aria-labelledby={heading} className="rounded-sm border border-line bg-surface-2 p-3" data-prove2="error">
        <PanelHead id={heading} />
        <p className="mt-2 text-body-sm text-warn">A question could not be drawn: {error}</p>
      </section>
    )
  }
  if (history === null || q === null) {
    return (
      <section aria-label="Prove it on your module" className="rounded-sm border border-line bg-surface-2 p-3" data-prove2="loading">
        <p className="font-mono text-[11px] text-text-3">loading</p>
      </section>
    )
  }
  return (
    <section aria-labelledby={heading} className="rounded-sm border border-line bg-surface-2 p-3" data-prove2={last === null ? 'active' : 'done'}>
      <PanelHead id={heading} />
      <div className="mt-3 rounded-sm border border-line bg-surface-1 p-3">
        <ProveV2Session
          key={`${q.template.id}:${q.plan.seed}`}
          labId={lab.id}
          template={q.template}
          plan={q.plan}
          bytes={bytes}
          graded={graded}
          history={history}
          note={noteFor(eligibility(graded, sha, history, now), now)}
          env={env}
          onGraded={(out) => {
            setLast(out)
            setHistory((h) => [
              ...(h ?? []),
              { at: new Date(e.now()).toISOString(), qid: q.template.id, right: out.result.ok, ...(out.eligibility.credited ? {} : { credited: false as const }) },
            ])
          }}
        />
      </div>
      {last !== null && (
        <button
          ref={nextRef}
          type="button"
          data-prove-next
          onClick={() => {
            setLast(null)
            draw(history)
          }}
          className={cn('mt-3', quietBtn, touch)}
        >
          Another question
        </button>
      )}
    </section>
  )
}

export default function ProveFromModule({ lab, bundle, bytes, report, credit, env }: ProveFromModuleProps) {
  // The hash is kept with the bytes it was made for, so a new run's module is never taken for the last one's.
  const [hashed, setHashed] = useState<{ bytes: ArrayBuffer; sha: string } | null>(null)
  const sha = hashed !== null && hashed.bytes === bytes ? hashed.sha : null
  const hash = env?.hash
  useEffect(() => {
    let live = true
    void (hash ?? sha256Hex)(bytes)
      .catch(() => '')
      .then((h) => {
        if (live) setHashed({ bytes, sha: h })
      })
    return () => {
      live = false
    }
  }, [bytes, hash])

  const spec = bundle.prove2
  // A lab without templates keeps v1; a reference build earns nothing and is not asked.
  if (spec === undefined || spec.templates.length === 0 || credit === null) return null
  const required = lab.checks.filter((c) => !c.optional)
  const green = required.length > 0 && required.every((c) => report.checks.some((r) => r.id === c.id && r.status === 'pass'))
  if (credit !== 'unseen' || !green) {
    return (
      <section aria-label="Prove it on your module" className="rounded-sm border border-line bg-surface-2 p-3" data-prove2="locked">
        <h3 className="flex items-center gap-1.5 text-body-sm font-medium text-text-1">
          <Lock size={13} strokeWidth={2} aria-hidden />
          Close your agent: what will your module say?
        </h3>
        <p className="mt-1 text-body-sm text-text-3">Opens after a run that passes every required check on fresh seeds: then your own module answers a seeded list of calls, and you predict its replies.</p>
      </section>
    )
  }
  // A module that could not be hashed cannot be named as the one that was graded, so it is not asked.
  if (sha === null || sha === '') return null
  return <Asking key={sha} lab={lab} templates={spec.templates} bytes={bytes} sha={sha} env={env} />
}
