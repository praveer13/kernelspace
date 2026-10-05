/**
 * H4 v1 Prove it, no AI, for lab 01 (docs/specs/wave-1.md §13.3). Three of six questions about the
 * learner's own allocator, one at a time:
 *
 *   write   at least 12 words, in the learner's own words
 *   reveal  the model answer and the three ideas it covers appear; the answer is locked
 *   grade   "got it" or "not yet", by the learner
 *
 * When the third is graded, one `prove` event is recorded: score = the fraction "got it", provenance
 * `practice` (self-graded, so outside rings and VRK30). A retry opens 24 h after the last attempt and
 * draws questions the learner has not been served. The state machine and the draw are in
 * src/data/forge/rust-allocator/prove.ts.
 */

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, CircleDashed, Lock } from 'lucide-react'
import { clsx as cn } from 'clsx'
import {
  MIN_ANSWER_WORDS,
  MAX_ANSWER_CHARS,
  PROVE_LAB_ID,
  PROVE_PICK,
  activeIndex,
  answerReady,
  buildProveResult,
  formatWait,
  freshCards,
  pickQuestions,
  proveDone,
  proveScore,
  reduceCards,
  retryOpensAt,
  wordCount,
} from '@/data/forge/rust-allocator/prove'
import type { ProveAction, ProveAttempt, ProveCard, ProveQuestion } from '@/data/forge/rust-allocator/prove'
import { getLedgerClient } from '@/lib/ledger/client'
import type { ProveResult } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'

export interface ProveItProps {
  /** Default `rust-allocator`. */
  labId?: string
  /** False until every required check is green; the panel then says what unlocks it. Default true. */
  unlocked?: boolean
  /** Past attempts. Left out, the panel reads them from the ledger. */
  history?: readonly ProveAttempt[]
  /** Epoch ms for the 24 h rule; default the mount time. */
  now?: number
  /** Seeds the draw among equally fresh questions; default random per mount. */
  seed?: number
  /** Called once with what was recorded. */
  onRecorded?: (result: ProveResult) => void
}

const touch = 'min-h-6 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11'
const primaryBtn =
  'flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3 disabled:hover:translate-y-0'
const quietBtn =
  'flex items-center rounded-md border border-line bg-surface-3 px-3.5 py-2 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]'

/** Wall clock for the time spent; read in handlers only. */
const clock = (): number => Date.now()

/** Backticks mark code in the authored prompts and model answers. */
function Inline({ text }: { text: string }): ReactNode {
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

/** Past `prove` events for one lab, oldest first. Anything malformed is skipped, never thrown. */
async function loadHistory(labId: string): Promise<ProveAttempt[]> {
  try {
    const client = await getLedgerClient()
    const events = await client.events({ kinds: ['prove'], refPrefix: `prove:${labId}` })
    const out: ProveAttempt[] = []
    for (const e of events) {
      if (e.kind !== 'prove' || e.ref !== `prove:${labId}`) continue
      out.push({ at: e.at, qids: e.data.qids, score: e.score })
    }
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  } catch {
    return []
  }
}

export default function ProveIt({ labId = PROVE_LAB_ID, unlocked = true, history, now, seed, onRecorded }: ProveItProps) {
  const recordProve = useProgress((s) => s.recordProve)
  const uid = useId()
  const [loaded, setLoaded] = useState<readonly ProveAttempt[] | null>(history ?? null)
  const [mountedAt] = useState(() => now ?? Date.now())
  const [drawSeed] = useState(() => seed ?? Math.floor(Math.random() * 0x1_0000_0000))
  const [cards, setCards] = useState<ProveCard[]>(() => freshCards())
  const [recorded, setRecorded] = useState<ProveResult | null>(null)
  const startedAt = useRef<number | null>(null)
  const saved = useRef(false)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (history !== undefined || !unlocked) return
    let live = true
    void loadHistory(labId).then((h) => {
      if (live) setLoaded(h)
    })
    return () => {
      live = false
    }
  }, [history, labId, unlocked])

  // Drawn once per mount, from the history as it was then: recording an attempt must not reshuffle the page.
  const questions = useMemo<ProveQuestion[] | null>(() => (loaded === null ? null : pickQuestions(loaded, drawSeed)), [loaded, drawSeed])
  const opensAt = loaded === null ? null : retryOpensAt(loaded, mountedAt)

  const active = activeIndex(cards)
  const card = active === -1 ? undefined : cards[active]
  const revealedNow = card?.revealed === true
  // Focus follows the step: the control that was pressed unmounts, so hand focus to what comes next.
  const prev = useRef({ active: 0, revealed: false })
  useEffect(() => {
    const was = prev.current
    prev.current = { active, revealed: revealedNow }
    if (was.active === active && was.revealed === revealedNow) return
    if (active === -1) doneRef.current?.focus({ preventScroll: true })
    else if (revealedNow) modelRef.current?.focus({ preventScroll: true })
    else answerRef.current?.focus({ preventScroll: true })
  }, [active, revealedNow])

  if (!unlocked) {
    return (
      <section aria-labelledby={`${uid}-h`} className="rounded-sm border border-line bg-surface-2 p-3" data-prove="locked">
        <h3 id={`${uid}-h`} className="flex items-center gap-1.5 text-body-sm font-medium text-text-1">
          <Lock size={13} strokeWidth={2} aria-hidden />
          Prove it, no AI
        </h3>
        <p className="mt-1 text-body-sm text-text-3">
          Opens when all six checks are green: {PROVE_PICK} questions about your own code, answered with your agent closed.
        </p>
      </section>
    )
  }
  if (questions === null) {
    return (
      <section aria-label="Prove it" className="rounded-sm border border-line bg-surface-2 p-3" data-prove="loading">
        <p className="font-mono text-[11px] text-text-3">loading</p>
      </section>
    )
  }

  // A retry inside 24 h of the last attempt: nothing to answer yet. Not shown after this session's own attempt (the summary is).
  if (opensAt !== null && recorded === null) {
    const last = (loaded ?? []).reduce<ProveAttempt | undefined>((a, b) => (a === undefined || Date.parse(b.at) > Date.parse(a.at) ? b : a), undefined)
    return (
      <section aria-labelledby={`${uid}-h`} className="rounded-sm border border-line bg-surface-2 p-3" data-prove="wait">
        <h3 id={`${uid}-h`} className="flex items-center gap-1.5 text-body-sm font-medium text-text-1">
          <Check size={13} strokeWidth={3} className="text-accent" aria-hidden />
          Prove it, no AI
        </h3>
        <p className="mt-1 text-body-sm text-text-2">
          {last?.score === undefined ? 'You answered a set today.' : `Last set: ${Math.round(last.score * last.qids.length)} of ${last.qids.length} got it.`}{' '}
          Fresh questions open in <span className="font-mono text-text-1">{formatWait(opensAt - mountedAt)}</span>. Until then, re-read your
          own code and the notes you wrote.
        </p>
      </section>
    )
  }

  const act = (a: ProveAction) => {
    const next = reduceCards(cards, a)
    if (a.type === 'write' && startedAt.current === null) startedAt.current = clock()
    setCards(next)
    if (saved.current || !proveDone(next)) return
    const result = buildProveResult(questions, next, {
      labId,
      ...(startedAt.current === null ? {} : { ms: clock() - startedAt.current }),
    })
    if (result === null) return
    saved.current = true
    recordProve(result)
    setRecorded(result)
    onRecorded?.(result)
  }

  const got = cards.filter((c) => c.self === 1).length
  const finished = recorded !== null

  return (
    <section aria-labelledby={`${uid}-h`} className="rounded-sm border border-line bg-surface-2 p-3" data-prove={finished ? 'done' : 'active'}>
      <header>
        <h3 id={`${uid}-h`} className="text-body-sm font-medium text-text-1">
          Close your agent: {questions.length} questions about your code
        </h3>
        <p className="mt-1 text-body-sm text-text-3">
          Answer in your own words ({MIN_ANSWER_WORDS} words or more), then compare with the model answer and grade yourself. You grade
          yourself, so this counts as practice and stays outside your rings.
        </p>
      </header>

      <ol className="mt-3 space-y-3">
        {questions.map((q, i) => {
          const c = cards[i]
          if (c === undefined || (active !== -1 && i > active)) return null
          const isActive = i === active
          return (
            <li key={q.id} data-qid={q.id} data-state={isActive ? (c.revealed ? 'reveal' : 'write') : c.self === 1 ? 'got' : 'not-yet'}>
              <QuestionCard
                uid={`${uid}-${q.id}`}
                n={i + 1}
                of={questions.length}
                q={q}
                card={c}
                isActive={isActive}
                answerRef={isActive ? answerRef : undefined}
                modelRef={isActive ? modelRef : undefined}
                onAct={(a) => act({ ...a, index: i } as ProveAction)}
              />
            </li>
          )
        })}
      </ol>

      {/* always mounted so the saved line is announced when it appears */}
      <div role="status" aria-live="polite" className="sr-only">
        {finished ? `Saved: ${got} of ${questions.length} got it.` : ''}
      </div>
      {finished && (
        <div className="mt-3 space-y-1 rounded-sm border-l-2 border-accent bg-accent-dim/30 px-2.5 py-2 text-body-sm text-text-2">
          <p ref={doneRef} tabIndex={-1} className="font-medium text-text-1 outline-none">
            {got} of {questions.length} got it, saved as practice.
          </p>
          <p>
            {proveScore(cards) < 1 ? 'Re-read the model answers marked "not yet", then come back. ' : ''}
            Fresh questions open in 24 h. One of these returns as a review item in 30 days.
          </p>
        </div>
      )}
    </section>
  )
}

interface QuestionCardProps {
  uid: string
  n: number
  of: number
  q: ProveQuestion
  card: ProveCard
  isActive: boolean
  answerRef?: React.RefObject<HTMLTextAreaElement | null>
  modelRef?: React.RefObject<HTMLDivElement | null>
  onAct(a: Omit<Extract<ProveAction, { type: 'write' }>, 'index'> | { type: 'reveal' } | { type: 'grade'; got: boolean }): void
}

function QuestionCard({ uid, n, of, q, card, isActive, answerRef, modelRef, onAct }: QuestionCardProps) {
  const words = wordCount(card.answer)
  const ready = answerReady(card.answer)
  const graded = card.self !== undefined
  return (
    <article className={cn('rounded-sm border bg-surface-1 p-3', card.self === 1 ? 'border-accent/40' : 'border-line')}>
      <h4 className="flex items-start gap-2 text-body-sm font-medium leading-snug text-text-1">
        <span
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
            card.self === 1 ? 'border-accent bg-accent text-accent-foreground' : 'border-line-bright',
          )}
          aria-hidden
        >
          {card.self === 1 ? <Check size={10} strokeWidth={3} /> : graded && <CircleDashed size={10} strokeWidth={2.5} className="text-text-3" />}
        </span>
        <span>
          <span className="block font-mono text-[10px] uppercase tracking-wide text-text-3">
            Question {n} of {of}
            {graded && <span className="sr-only">{card.self === 1 ? ' (got it)' : ' (not yet)'}</span>}
          </span>
          <Inline text={q.prompt} />
        </span>
      </h4>

      {!graded && !card.revealed && (
        <div className="mt-2">
          <label htmlFor={`${uid}-a`} className="sr-only">
            Your answer to question {n}
          </label>
          <textarea
            ref={answerRef}
            id={`${uid}-a`}
            value={card.answer}
            onChange={(e) => onAct({ type: 'write', text: e.target.value })}
            maxLength={MAX_ANSWER_CHARS}
            rows={4}
            aria-describedby={`${uid}-count`}
            className="w-full resize-y rounded-sm border border-line bg-ink px-2 py-1.5 text-body-sm text-text-1"
          />
          <p id={`${uid}-count`} className="mt-1 font-mono text-[10px] text-text-3">
            {words}/{MIN_ANSWER_WORDS} words {ready ? '· ready' : `· ${MIN_ANSWER_WORDS - words} more unlocks the model answer`}
          </p>
          <button
            type="button"
            disabled={!ready}
            onClick={() => onAct({ type: 'reveal' })}
            className={cn('mt-2', primaryBtn, touch)}
          >
            Show the model answer
          </button>
        </div>
      )}

      {(graded || card.revealed) && (
        <div className="mt-2 space-y-2 text-body-sm text-text-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">Your answer</p>
            <p className="whitespace-pre-wrap">{card.answer}</p>
          </div>
          <div ref={modelRef} tabIndex={-1} className="rounded-sm border-l-2 border-line-bright bg-surface-2 px-2.5 py-2 outline-none">
            <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">Model answer</p>
            <p>
              <Inline text={q.model} />
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-text-3">Did your answer cover</p>
            <ul className="list-disc space-y-0.5 pl-4">
              {q.ideas.map((idea) => (
                <li key={idea}>
                  <Inline text={idea} />
                </li>
              ))}
            </ul>
          </div>
          {isActive && !graded ? (
            <div role="group" aria-label={`Grade yourself on question ${n}`} className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onAct({ type: 'grade', got: true })} className={cn(primaryBtn, touch)}>
                Got it
              </button>
              <button type="button" onClick={() => onAct({ type: 'grade', got: false })} className={cn(quietBtn, touch)}>
                Not yet
              </button>
            </div>
          ) : (
            <p className="font-mono text-[11px] text-text-3">{card.self === 1 ? 'you graded: got it' : 'you graded: not yet'}</p>
          )}
        </div>
      )}
    </article>
  )
}
