/**
 * The hint ladder under a failing lab 01 check (H3, docs/specs/wave-1.md §13.2): R0 to R4, unlocked in
 * order by the learner's own work and by red runs, then the bottom-out walkthrough and "ask a human".
 *
 * The rules and the authored text live in src/data/forge/rust-allocator/ladder.ts. This file owns the
 * clock and the ledger: a rung opened is one `ack hint:rust-allocator/<check>#R<n>`, the bottom-out is
 * `#bottom` (the ledger then credits the next 24 h of runs `assisted`), and nothing here ever grants credit.
 * A locked rung says what unlocks it; there are no hearts and no waits that cost anything.
 */

import { useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ExternalLink, Lock } from 'lucide-react'
import { clsx as cn } from 'clsx'
import { useProgress } from '@/lib/progress'
import type { HintRef } from '@/lib/ledger/types'
import type { CheckResult, LabRunReport } from '@/lib/forge/types'
import {
  AFTER_BREAK,
  ASSISTED_HOURS,
  LADDER,
  LADDER_CHECK_IDS,
  MIN_TEACHBACK_WORDS,
  RUNGS,
  askHumanUrl,
  assistedUntil,
  freshState,
  hintRef,
  ladderReduce,
  redRuns,
  restoreState,
  teachBackOk,
  unlockOf,
  walkthroughFor,
  wordCount,
} from '@/data/forge/rust-allocator/ladder'
import type { Ctx, LadderAction, LadderState, RungId, Walkthrough } from '@/data/forge/rust-allocator/ladder'

type States = Record<string, LadderState>
type Act = { check: string; ctx: Ctx; action: LadderAction }

const reduceStates = (s: States, a: Act): States => {
  const cur = s[a.check] ?? freshState()
  const next = ladderReduce(cur, a.action, a.ctx)
  return next === cur ? s : { ...s, [a.check]: next }
}

const BUTTON =
  'inline-flex min-h-9 items-center justify-center rounded-sm border border-line-bright bg-surface-3 px-3 py-1.5 text-body-sm text-text-1 transition-colors duration-150 hover:bg-surface-2 disabled:cursor-not-allowed disabled:border-line disabled:text-text-3 disabled:hover:bg-surface-3 [@media(pointer:coarse)]:min-h-11'

const RUNG_TITLE: Record<RungId, string> = {
  R0: 'R0 · say it first',
  R1: 'R1 · the concept',
  R2: 'R2 · where to look',
  R3: 'R3 · a fragment',
  R4: 'R4 · the design',
  bottom: 'Bottom-out · where yours first leaves the rules',
}

export interface HintLadderViewProps {
  /** The runs so far this session, oldest first. The newest one that is not a reference build decides which checks are red. */
  reports: readonly LabRunReport[]
  /** The ledger's acks (`ref -> instant`): rungs already opened are open again after a reload. */
  acks: Readonly<Record<string, string>>
  onAck(ref: HintRef): void
  /** The clock, for tests. Default: `Date.now`. */
  now?: () => number
}

/** The ladder for every red check of the latest run. Presentational: `HintLadder` wires it to the ledger. */
export function HintLadderView({ reports, acks, onAck, now = Date.now }: HintLadderViewProps) {
  const latest = [...reports].reverse().find((r) => r.reference !== true)
  const red = latest === undefined ? [] : latest.checks.filter((c) => c.status !== 'pass' && LADDER[c.id] !== undefined)
  const [t, setT] = useState(() => now())
  const [states, dispatch] = useReducer(reduceStates, undefined, (): States => {
    const at = now()
    return Object.fromEntries(LADDER_CHECK_IDS.map((id) => [id, restoreState(acks, id, { red: redRuns(reports, id), now: at })]))
  })

  // Only R2's 2-minute clock needs a tick: nothing else changes with time.
  const waiting = red.some((c) => states[c.id]?.opened.R1 !== undefined && states[c.id]?.opened.R2 === undefined)
  useEffect(() => {
    if (!waiting) return
    const id = setInterval(() => setT(now()), 1000)
    return () => clearInterval(id)
  }, [waiting, now])

  // Tell a screen reader when the next rung becomes available (it is not announced by the countdown).
  const unlockedKey = red
    .map((c) => {
      const s = states[c.id] ?? freshState()
      const next = RUNGS.find((r) => s.opened[r] === undefined)
      return next !== undefined && next !== 'R0' && unlockOf(s, next, { red: redRuns(reports, c.id), now: t }).ok ? `${c.id} ${next}` : ''
    })
    .filter((k) => k !== '')
    .join(', ')

  return (
    <section aria-label="Hints" data-hint-ladder className="space-y-3">
      <h3 className="font-mono text-label uppercase tracking-[0.10em] text-text-3">Stuck? Hints, one step at a time</h3>
      <div role="status" aria-live="polite" className="sr-only">
        {unlockedKey === '' ? '' : `Available now: ${unlockedKey}`}
      </div>
      {latest === undefined ? (
        <p className="text-body-sm text-text-2">Run your build first. The hints are for the checks that come back red.</p>
      ) : red.length === 0 ? (
        <p className="text-body-sm text-text-2">No red check has a ladder in this run, so there is nothing to unlock.</p>
      ) : (
        red.map((c) => (
          <CheckCard
            key={c.id}
            check={c}
            state={states[c.id] ?? freshState()}
            ctx={{ red: redRuns(reports, c.id), now: t }}
            acks={acks}
            clock={now}
            onAck={onAck}
            dispatch={(action, ctx) => dispatch({ check: c.id, ctx, action })}
          />
        ))
      )}
    </section>
  )
}

/** The ladder wired to the ledger: rungs opened are acks, and the acks restore them after a reload. */
export default function HintLadder({ reports }: { reports: readonly LabRunReport[] }) {
  const acks = useProgress((s) => s.acks)
  const acknowledge = useProgress((s) => s.acknowledge)
  return <HintLadderView reports={reports} acks={acks} onAck={(ref) => acknowledge(ref)} />
}

/* ------------------------------------------------------------------ */
/* One check                                                            */
/* ------------------------------------------------------------------ */

interface CardProps {
  check: CheckResult
  state: LadderState
  ctx: Ctx
  acks: Readonly<Record<string, string>>
  clock: () => number
  onAck(ref: HintRef): void
  dispatch(action: LadderAction, ctx: Ctx): void
}

function CheckCard({ check, state, ctx, acks, clock, onAck, dispatch }: CardProps) {
  const ladder = LADDER[check.id]
  const open = state.opened
  // A check whose rungs were opened before (acks restored after a reload) comes back expanded.
  const [expanded, setExpanded] = useState(open.R0 !== undefined)
  const focusAfter = useRef<string | null>(null)

  // Focus follows the rung just opened (the button that was pressed has gone), not the page top.
  useEffect(() => {
    const id = focusAfter.current
    if (id === null) return
    focusAfter.current = null
    document.getElementById(id)?.focus({ preventScroll: false })
  }, [open])

  const heading = (rung: RungId) => `hint-${check.id}-${rung}`
  const now = () => ({ red: ctx.red, now: clock() })
  const openRung = (rung: RungId) => {
    const at = now()
    if (open[rung] !== undefined || !unlockOf(state, rung, at).ok) return
    dispatch({ type: 'open', rung }, at)
    // `acknowledge` ignores a ref that is already in the ledger, so re-opening after a reload adds nothing.
    onAck(hintRef(check.id, rung))
    focusAfter.current = heading(rung)
  }
  const toggle = () => {
    if (!expanded && open.R0 === undefined) openRung('R0')
    setExpanded(!expanded)
  }

  const message = check.status === 'trap' && check.panic ? `${check.msg}\n${check.panic}` : check.msg
  const walk: Walkthrough | null = open.bottom === undefined ? null : walkthroughFor(check.id, check.trace)
  const until = acks[hintRef(check.id, 'bottom')]
  const bodyId = `hint-body-${check.id}`

  return (
    <article className="rounded-sm border border-line bg-surface-2" data-check={check.id} data-expanded={expanded}>
      <h4 className="m-0">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={toggle}
          className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-left"
        >
          <span className="font-mono text-body-sm text-text-1">{check.id}</span>
          <span className="text-body-sm text-text-2">{check.label}</span>
          <span className="font-mono text-[11px] text-text-3">
            {check.status === 'trap' ? 'not implemented yet' : check.status}, {ctx.red} red {ctx.red === 1 ? 'run' : 'runs'}
          </span>
        </button>
      </h4>
      {expanded && ladder !== undefined && (
        <div id={bodyId} className="space-y-4 border-t border-line px-3 py-3">
          <Rung id={heading('R0')} title={RUNG_TITLE.R0}>
            <p className="text-body-sm text-text-1">{ladder.r0.prompt}</p>
            <label className="mt-2 block text-[12px] text-text-3" htmlFor={`hint-r0-${check.id}`}>
              Your answer, in your own words
            </label>
            <textarea
              id={`hint-r0-${check.id}`}
              rows={3}
              maxLength={600}
              value={state.r0}
              readOnly={state.compared}
              onChange={(e) => dispatch({ type: 'draft', text: e.target.value }, now())}
              className="mt-1 w-full min-w-0 rounded-sm border border-line bg-ink px-2 py-1.5 text-body-sm text-text-1 read-only:opacity-80"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <button type="button" className={BUTTON} disabled={state.compared || !teachBackOk(state.r0)} onClick={() => dispatch({ type: 'compare' }, now())}>
                Compare with the ideas
              </button>
              <span className="font-mono text-[11px] text-text-3">
                {wordCount(state.r0)} / {MIN_TEACHBACK_WORDS} words
              </span>
            </div>
            {state.compared && (
              <fieldset className="mt-3 min-w-0">
                <legend className="mb-1 text-body-sm font-medium text-text-1">Tick the ideas your answer already had. This is for you; nothing is graded.</legend>
                <ul className="space-y-1.5">
                  {ladder.r0.ideas.map((idea, i) => (
                    <li key={idea}>
                      <label className="flex min-h-6 cursor-pointer items-start gap-2 text-body-sm text-text-2 [@media(pointer:coarse)]:min-h-11">
                        <input
                          type="checkbox"
                          checked={state.ticks[i] === true}
                          onChange={() => dispatch({ type: 'tick', index: i }, now())}
                          className="mt-1 h-4 w-4 shrink-0 accent-accent"
                        />
                        <span>{idea}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
          </Rung>

          {(['R1', 'R2', 'R3', 'R4'] as const).map((rung) => (
            <Rung key={rung} id={heading(rung)} title={RUNG_TITLE[rung]}>
              {open[rung] === undefined ? (
                <Gate rung={rung} state={state} ctx={ctx} onOpen={() => openRung(rung)} label={`Open ${rung}`} />
              ) : rung === 'R1' ? (
                <>
                  <p className="text-body-sm text-text-2">{ladder.r1.text}</p>
                  <p className="mt-1.5 text-body-sm">
                    <Link className="text-accent underline underline-offset-2" to={`/lesson/${ladder.r1.link.lessonId}#${ladder.r1.link.anchor}`}>
                      Lesson {ladder.r1.link.lessonId.toUpperCase()}: {ladder.r1.link.h2}
                    </Link>
                  </p>
                </>
              ) : rung === 'R2' ? (
                <>
                  <p className="text-body-sm text-text-2">{ladder.r2.text}</p>
                  <p className="mt-1.5 text-[12px] text-text-3">The check said:</p>
                  <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xs border border-line bg-ink p-2 font-mono text-[12px] text-text-2">{message}</pre>
                </>
              ) : rung === 'R3' ? (
                <>
                  <p className="text-[12px] text-text-3">Pseudo-code, not Rust.</p>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words rounded-xs border border-line bg-ink p-2 font-mono text-[12px] text-text-1">{ladder.r3}</pre>
                </>
              ) : (
                <p className="text-body-sm text-text-2">{ladder.r4}</p>
              )}
            </Rung>
          ))}

          <Rung id={heading('bottom')} title={RUNG_TITLE.bottom}>
            {walk === null ? (
              <>
                <Gate rung="bottom" state={state} ctx={ctx} onOpen={() => openRung('bottom')} label="Show the walkthrough" />
                <p className="mt-1.5 text-[12px] text-text-3">
                  This shows where your last run first breaks the rules. Runs for the next {ASSISTED_HOURS} hours then count as assisted, until you pass on seeds you have not seen.
                </p>
              </>
            ) : (
              <>
                <WalkthroughView walk={walk} />
                <p className="mt-3 text-body-sm font-medium text-text-1">{AFTER_BREAK.title}</p>
                <p className="text-body-sm text-text-2">{AFTER_BREAK.text}</p>
                {until !== undefined && (
                  <p className="mt-1 font-mono text-[11px] text-text-3" data-assisted-until>
                    assisted until {new Date(assistedUntil(until)).toLocaleString()}
                  </p>
                )}
              </>
            )}
          </Rung>

          <div className="border-t border-line pt-3">
            <a
              className={cn(BUTTON, 'no-underline')}
              href={askHumanUrl({ checkId: check.id, message, r0: state.r0 })}
              target="_blank"
              rel="noopener noreferrer"
              data-ask-human
            >
              Ask a human
              <ExternalLink size={13} className="ml-1.5" aria-hidden />
              <span className="sr-only"> (opens a GitHub Discussions post in a new tab)</span>
            </a>
            <p className="mt-1.5 text-[12px] text-text-3">
              Opens a prefilled post in the Q&amp;A discussions with this check&rsquo;s message and your R0 answer. It never includes your code. Read it before you post.
            </p>
          </div>
        </div>
      )}
    </article>
  )
}

function Rung({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h5 id={id} tabIndex={-1} className="mb-1.5 font-mono text-label uppercase tracking-[0.10em] text-text-3 outline-none focus-visible:text-text-1">
        {title}
      </h5>
      {children}
    </section>
  )
}

/** A locked or available rung: the reason it is locked is text on the page, never only a tooltip. */
function Gate({ rung, state, ctx, onOpen, label }: { rung: RungId; state: LadderState; ctx: Ctx; onOpen(): void; label: string }) {
  const u = unlockOf(state, rung, ctx)
  const why = `hint-why-${rung}-${label.replace(/\s+/g, '-')}`
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={BUTTON} disabled={!u.ok} aria-describedby={u.ok ? undefined : why} onClick={onOpen}>
        {!u.ok && <Lock size={13} className="mr-1.5" aria-hidden />}
        {label}
      </button>
      {!u.ok && (
        <span id={why} className="text-[12px] text-text-3">
          {u.reason}
        </span>
      )}
    </div>
  )
}

/** The check's op sequence beside the reference: yours on the left, the reference on the right, the first divergence marked. */
function WalkthroughView({ walk }: { walk: Walkthrough }) {
  return (
    <div data-walkthrough={walk.source}>
      <p className="text-body-sm text-text-2">{walk.headline}</p>
      {walk.skipped > 0 && <p className="mt-1 font-mono text-[11px] text-text-3">{walk.skipped} earlier ops agree with the reference.</p>}
      <ol className="mt-2 space-y-1.5">
        {walk.steps.map((s) => (
          <li
            key={s.n}
            data-diverges={s.diverges}
            className={cn('rounded-xs border px-2.5 py-1.5', s.diverges ? 'border-danger/60 bg-danger/10' : 'border-line')}
          >
            <p className="font-mono text-[12px] text-text-1">
              {s.n}. {s.op}
              {s.diverges && <strong className="ml-2 text-danger">first divergence</strong>}
            </p>
            <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-2 text-[12px] text-text-2">
              <dt className="text-text-3">yours</dt>
              <dd>{s.yours}</dd>
              <dt className="text-text-3">reference</dt>
              <dd>{s.reference}</dd>
            </dl>
            {s.note !== undefined && <p className="mt-0.5 text-[12px] text-text-3">{s.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}
