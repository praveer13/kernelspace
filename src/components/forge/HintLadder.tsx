/**
 * The hint ladder under a failing check (H3, docs/specs/wave-1.md §13.2; wave-2.md §13.1): R0 to R4, unlocked in
 * order by the learner's own work and by red runs, then the bottom-out walkthrough and "ask a human".
 *
 * The authored rungs, the walkthrough and the discussion label come from the lab's `ForgeBundle`; the rules are
 * src/lib/forge/ladder.ts. This file owns the clock and the ledger: a rung opened is one
 * `ack hint:<lab>/<check>#R<n>`, the bottom-out is `#bottom` (the ledger then credits the next 24 h of runs
 * `assisted`), and nothing here ever grants credit. A lab whose bundle has no walkthrough has no bottom-out.
 * A locked rung says what unlocks it; there are no hearts and no waits that cost anything.
 *
 * Help is randomized per check in labs 01 to 03 (wave-2.md §14.4, docs/prereg/hint-ladders.md): in the packet arm R0's
 * teach-back stays and R1 to R4 and the bottom-out stay closed (the packet in AskPacket is the help); in the ladder arm
 * the ladder is whole. Every ack of a randomized check carries `data.arm`. A rung opened before the arm was known stays open.
 *
 * A faded bundle (`fade: 'r2'`, wave-3.md D13 and D26; labs 04 to 08) authors R0 to R2 only: no gate is rendered for a rung
 * the check's ladder lacks, there is no bottom-out, and the packet in AskPacket follows R2.
 */

import { useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ExternalLink, Lock } from 'lucide-react'
import { clsx as cn } from 'clsx'
import { useProgress } from '@/lib/progress'
import type { HintRef } from '@/lib/ledger/types'
import { ensureExpSeed, hintArm, isRandomizedLab, readExpSeed } from '@/lib/learner/experiments'
import type { Arm } from '@/lib/learner/experiments'
import type { CheckResult, LabRunReport } from '@/lib/forge/types'
import {
  AFTER_BREAK,
  ASSISTED_HOURS,
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
  wordCount,
} from '@/lib/forge/ladder'
import type { Ctx, LadderAction, LadderState, RungId } from '@/lib/forge/ladder'
import type { CheckLadder, ForgeBundle, Walkthrough } from '@/data/forge/types'

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

/** Said where R1 to R4 would be, in the packet arm. The assignment is random per check, and the page says so. */
const PACKET_ARM_NOTE =
  'For this check the help beyond R0 is your own agent: use "Ask with a packet" below. Which checks get hints and which get a packet is decided at random, to find out which helps you remember more. The pre-registration is docs/prereg/hint-ladders.md in the repository.'

const ladderOf = (bundle: ForgeBundle, checkId: string): CheckLadder | undefined => bundle.ladder.find((l) => l.checkId === checkId)

/** The rungs a check's ladder has, in order (D26): a faded bundle (`fade: 'r2'`) authors R0 to R2 only, so R3 and R4 get no gate. */
const rungsOf = (ladder: CheckLadder | undefined): readonly RungId[] =>
  RUNGS.filter((r) => (r === 'R3' ? ladder?.r3 !== undefined : r === 'R4' ? ladder?.r4 !== undefined : true))

export interface HintLadderViewProps {
  /** The lab's bundle: its ladder, walkthrough, discussion label and id (the acks' namespace). */
  bundle: ForgeBundle
  /** The runs so far this session, oldest first. The newest one that is not a reference build decides which checks are red. */
  reports: readonly LabRunReport[]
  /** The ledger's acks (`ref -> instant`): rungs already opened are open again after a reload. */
  acks: Readonly<Record<string, string>>
  onAck(ref: HintRef, data?: { arm: Arm }): void
  /** The learner's `exp:seed`; without it there is no arm and the ladder is whole. */
  expSeed?: number
  /** The clock, for tests. Default: `Date.now`. */
  now?: () => number
}

/** The ladder for every red check of the latest run. Presentational: `HintLadder` wires it to the ledger. */
export function HintLadderView({ bundle, reports, acks, onAck, expSeed, now = Date.now }: HintLadderViewProps) {
  const latest = [...reports].reverse().find((r) => r.reference !== true)
  const red = latest === undefined ? [] : latest.checks.filter((c) => c.status !== 'pass' && ladderOf(bundle, c.id) !== undefined)
  const [t, setT] = useState(() => now())
  const [states, dispatch] = useReducer(reduceStates, undefined, (): States => {
    const at = now()
    return Object.fromEntries(
      bundle.ladder.map(({ checkId: id }) => [id, restoreState(acks, id, { red: redRuns(reports, id), now: at, labId: bundle.labId })]),
    )
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
      const next = rungsOf(ladderOf(bundle, c.id)).find((r) => s.opened[r] === undefined)
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
            bundle={bundle}
            check={c}
            state={states[c.id] ?? freshState()}
            ctx={{ red: redRuns(reports, c.id), now: t }}
            arm={hintArm(bundle.labId, c.id, expSeed)}
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
export default function HintLadder({ bundle, reports }: { bundle: ForgeBundle; reports: readonly LabRunReport[] }) {
  const acks = useProgress((s) => s.acks)
  const acknowledge = useProgress((s) => s.acknowledge)
  const ready = useProgress((s) => s.ledger.ready)
  const expSeed = useProgress((s) => readExpSeed(s.working['exp:seed']))
  // `exp:seed` is created once, the first time a randomized lab shows help (AskPacket does the same; the first one wins).
  useEffect(() => {
    if (ready && expSeed === undefined && isRandomizedLab(bundle.labId)) ensureExpSeed(useProgress.getState(), Math.random)
  }, [ready, expSeed, bundle.labId])
  return <HintLadderView bundle={bundle} reports={reports} acks={acks} expSeed={expSeed} onAck={(ref, data) => acknowledge(ref, data)} />
}

/* ------------------------------------------------------------------ */
/* One check                                                            */
/* ------------------------------------------------------------------ */

interface CardProps {
  bundle: ForgeBundle
  check: CheckResult
  state: LadderState
  ctx: Ctx
  /** This check's arm of the help experiment, when its lab is randomized and the learner has a seed. */
  arm: Arm | undefined
  acks: Readonly<Record<string, string>>
  clock: () => number
  onAck(ref: HintRef, data?: { arm: Arm }): void
  dispatch(action: LadderAction, ctx: Ctx): void
}

function CheckCard({ bundle, check, state, ctx, arm, acks, clock, onAck, dispatch }: CardProps) {
  const ladder = ladderOf(bundle, check.id)
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

  const heading = (rung: RungId | 'closed') => `hint-${check.id}-${rung}`
  // In the packet arm R1 and later stay closed unless they were opened before the arm was known.
  // A faded ladder has no R3 or R4 and no bottom-out: the packet follows R2.
  const laterRungs = rungsOf(ladder).filter((r) => r !== 'R0')
  const lastRung = laterRungs[laterRungs.length - 1]
  const closedRungs = arm === 'packet' ? laterRungs.filter((r) => open[r] === undefined) : []
  const openRungs = laterRungs.filter((r) => !closedRungs.includes(r))
  const now = () => ({ red: ctx.red, now: clock() })
  const openRung = (rung: RungId) => {
    const at = now()
    if (open[rung] !== undefined || !unlockOf(state, rung, at).ok) return
    dispatch({ type: 'open', rung }, at)
    // `acknowledge` ignores a ref that is already in the ledger, so re-opening after a reload adds nothing.
    onAck(hintRef(check.id, rung, bundle.labId), arm === undefined ? undefined : { arm })
    focusAfter.current = heading(rung)
  }
  const toggle = () => {
    if (!expanded && open.R0 === undefined) openRung('R0')
    setExpanded(!expanded)
  }

  const message = check.status === 'trap' && check.panic ? `${check.msg}\n${check.panic}` : check.msg
  const walk: Walkthrough | null =
    open.bottom === undefined || bundle.walkthrough === undefined ? null : bundle.walkthrough(check.id, check.trace === undefined ? [] : check.trace.split('\n'))
  const until = acks[hintRef(check.id, 'bottom', bundle.labId)]
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

          {closedRungs.length > 0 && (
            <Rung id={heading('closed')} title={`${closedRungs[0]} to ${lastRung} · closed for this check`}>
              <p className="text-body-sm text-text-2" data-packet-arm>
                {PACKET_ARM_NOTE}
              </p>
            </Rung>
          )}

          {openRungs.map((rung) => (
            <Rung key={rung} id={heading(rung)} title={RUNG_TITLE[rung]}>
              {open[rung] === undefined ? (
                <Gate checkId={check.id} rung={rung} state={state} ctx={ctx} onOpen={() => openRung(rung)} label={`Open ${rung}`} />
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

          {bundle.walkthrough !== undefined && lastRung === 'R4' && (arm !== 'packet' || open.bottom !== undefined) && (
            <Rung id={heading('bottom')} title={RUNG_TITLE.bottom}>
              {walk === null ? (
                <>
                  <Gate checkId={check.id} rung="bottom" state={state} ctx={ctx} onOpen={() => openRung('bottom')} label="Show the walkthrough" />
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
          )}

          <div className="border-t border-line pt-3">
            <a
              className={cn(BUTTON, 'no-underline')}
              href={askHumanUrl({ label: bundle.discussionsLabel, checkId: check.id, message, r0: state.r0 })}
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
function Gate({ checkId, rung, state, ctx, onOpen, label }: { checkId: string; rung: RungId; state: LadderState; ctx: Ctx; onOpen(): void; label: string }) {
  const u = unlockOf(state, rung, ctx)
  // The check id is in the id: two expanded cards would otherwise share `hint-why-R1-Open-R1`.
  const why = `hint-why-${checkId}-${rung}-${label.replace(/\s+/g, '-')}`
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
