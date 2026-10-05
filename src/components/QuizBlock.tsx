import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, X, RotateCcw } from 'lucide-react'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import { freshSeed, shuffledOrder } from '@/lib/rng'
import { rev32 } from '@/lib/ledger/stable'
import { getLedgerClient } from '@/lib/ledger/client'
import type { Confidence, LedgerEvent } from '@/lib/ledger/types'
import { CONFIDENCE_CHOICES, selectCalibration, sureSummary } from '@/lib/learner/calibration'
import ConfidencePicker from '@/components/learner/ConfidencePicker'

export interface QuizQuestion {
  q: string
  options: string[]
  /** Indices of correct options (1+ for multi-select) */
  correct: number[]
  explanation?: string
  multi?: boolean
  /**
   * Per-option feedback, parallel to `options` (authored order): why this option is
   * right, or which misconception it encodes and why it is wrong. Shown after submit.
   */
  why?: string[]
  /**
   * V4 (Wave 1, docs/specs/wave-1.md §4.5): the KC ids this item assesses, 1-3, primary first.
   * verify-kc requires them in T0-T2 and R. Writers copy them into `data.kcs` on the item event.
   */
  kcs?: string[]
}

interface QuizBlockProps {
  lessonId: string
  questions: QuizQuestion[]
  className?: string
}

const LETTERS = ['A', 'B', 'C', 'D', 'E']

const isRight = (q: QuizQuestion, sel: Set<number>) =>
  sel.size === q.correct.length && q.correct.every((c) => sel.has(c))

interface RestoredAttempt {
  seed: number
  selected: Record<number, Set<number>>
  conf: Record<number, Confidence>
}

const newer = (a: LedgerEvent, b: LedgerEvent) => (a.at === b.at ? a.id > b.id : a.at > b.at)

/**
 * The lesson's latest checkpoint attempt, read back from its `quiz` event and the item events
 * of the same `grp` (wave-1.md §15.2). `none`: nothing to restore. `changed`: some item's `rev`
 * no longer matches the authored question (or the count differs), so the attempt is stale.
 * Exit-ticket quiz events (`data.form`) are not checkpoint attempts and are ignored here.
 */
function restoreAttempt(
  lessonId: string,
  questions: QuizQuestion[],
  quizzes: LedgerEvent[],
  items: LedgerEvent[],
): RestoredAttempt | 'none' | 'changed' {
  let latest: LedgerEvent | undefined
  for (const e of quizzes) {
    if (e.kind !== 'quiz' || e.ref !== `lesson:${lessonId}` || e.data?.form || !e.data?.grp) continue
    if (!latest || newer(e, latest)) latest = e
  }
  if (latest?.kind !== 'quiz' || !latest.data?.grp) return 'none'
  const grp = latest.data.grp
  const byQi = new Map<number, LedgerEvent>()
  for (const e of items) {
    if (e.kind !== 'item' || e.data.src !== 'quiz' || e.data.grp !== grp) continue
    const m = /^quiz:(.+)#(\d+)$/.exec(e.ref)
    if (m?.[1] === lessonId) byQi.set(Number(m[2]), e)
  }
  if (byQi.size !== questions.length) return 'changed'
  const selected: Record<number, Set<number>> = {}
  const conf: Record<number, Confidence> = {}
  let seed = latest.seed
  for (const [qi, q] of questions.entries()) {
    const e = byQi.get(qi)
    if (e?.kind !== 'item' || e.rev !== rev32({ q: q.q, options: q.options, correct: q.correct })) return 'changed'
    selected[qi] = new Set((e.data.pick ?? []).filter((oi) => Number.isInteger(oi) && oi >= 0 && oi < q.options.length))
    if (e.conf) conf[qi] = e.conf
    seed ??= e.seed
  }
  // No seed means the option order cannot be reproduced; start fresh without a note.
  return seed === undefined ? 'none' : { seed, selected, conf }
}

/**
 * QuizBlock — inline lesson checkpoint (design.md §9.10).
 * Submit → per-option feedback (mint wash + check / danger wash + shake, no shake under
 * reduced motion). The option letter stays visible after submit, beside the verdict icon,
 * so the per-option `why` list always resolves to a visible option.
 * explanation expands, score persists to the progress store. Pass ≥80%
 * lights the checkpoint mint. Retry resets with a staggered fade.
 * Options are shuffled per attempt (PLAN-100X §5.1 V1): letters label display
 * position, while selection and grading stay on authored indices.
 * Confidence (V2, ledger spec §12.1): after a pick, an optional guess / think so / sure row;
 * keys 1-3 set it on the question that holds focus. It never gates Submit. Answers rated
 * sure and wrong are summarised first after submit. Each submit writes one ledger item event per
 * question plus one quiz event (`recordQuizAttempt`), with the item fingerprint, shuffle seed and
 * the authored pick, and the question's `kcs`.
 * A reload after Submit restores that attempt (seed order, picks, confidence, verdicts) when every
 * item's rev still matches; otherwise it starts fresh with a note (wave-1.md §15.2). Submit moves
 * focus to the result header, whose verdict an aria-live region announces; Retry moves it to the
 * first option (§15.3).
 */
export default function QuizBlock({ lessonId, questions, className }: QuizBlockProps) {
  const recordQuizAttempt = useProgress((s) => s.recordQuizAttempt)
  const [selected, setSelected] = useState<Record<number, Set<number>>>({})
  const [conf, setConf] = useState<Record<number, Confidence>>({})
  const [sureLine, setSureLine] = useState<{ correct: number; n: number } | null>(null)
  const startedAt = useRef<number | null>(null)
  const questionRefs = useRef<(HTMLLIElement | null)[]>([])
  const uid = useId()
  const [submitted, setSubmitted] = useState(false)
  const [seed, setSeed] = useState(freshSeed)
  const [staleNote, setStaleNote] = useState(false)
  const [announce, setAnnounce] = useState('')
  const headerRef = useRef<HTMLDivElement>(null)
  // set by the user's own Submit or Retry; consumed after the render that follows, to place focus
  const pendingFocus = useRef<'result' | 'first' | null>(null)
  // true once the learner has touched this quiz, so a late ledger read never overwrites their picks
  const interacted = useRef(false)
  const reducedMotion = useReducedMotion()

  // order[qi][displayPosition] = authored option index; new seed → new order
  const orders = useMemo(
    () =>
      questions.map((q, qi) =>
        shuffledOrder(q.options.length, seed ^ Math.imul(qi + 1, 0x9e3779b9)),
      ),
    [questions, seed],
  )

  const correctCount = useMemo(() => {
    if (!submitted) return 0
    return questions.filter((q, qi) => isRight(q, selected[qi] ?? new Set<number>())).length
  }, [submitted, questions, selected])

  // sure and wrong, in authored question order (after submit only)
  const confidentMisses = useMemo(
    () =>
      submitted
        ? questions.flatMap((q, qi) =>
            conf[qi] === 'sure' && (selected[qi]?.size ?? 0) > 0 && !isRight(q, selected[qi]) ? [qi] : [],
          )
        : [],
    [submitted, questions, selected, conf],
  )

  const score = questions.length ? correctCount / questions.length : 0
  const passed = score >= 0.8

  const toggle = (qi: number, oi: number, multi?: boolean) => {
    if (submitted) return
    interacted.current = true
    startedAt.current ??= Date.now()
    setSelected((prev) => {
      const next = new Set(prev[qi] ?? [])
      if (multi) {
        if (next.has(oi)) next.delete(oi)
        else next.add(oi)
      } else {
        next.clear()
        next.add(oi)
      }
      return { ...prev, [qi]: next }
    })
  }

  const submit = () => {
    interacted.current = true
    pendingFocus.current = 'result'
    const right = questions.filter((q, qi) => isRight(q, selected[qi] ?? new Set<number>())).length
    setAnnounce(`${right} of ${questions.length} right, ${questions.length && right / questions.length >= 0.8 ? 'pass' : 'retry'}`)
    setStaleNote(false)
    setSubmitted(true)
    recordQuizAttempt({
      lessonId,
      seed,
      ...(startedAt.current === null ? {} : { ms: Date.now() - startedAt.current }),
      responses: questions.map((q, qi) => {
        const sel = selected[qi] ?? new Set<number>()
        return {
          qi,
          rev: rev32({ q: q.q, options: q.options, correct: q.correct }),
          pick: [...sel].sort((a, b) => a - b),
          ok: isRight(q, sel),
          ...(conf[qi] ? { conf: conf[qi] } : {}),
          ...(q.kcs?.length ? { kcs: q.kcs } : {}),
        }
      }),
    })
  }

  const retry = () => {
    interacted.current = true
    pendingFocus.current = 'first'
    setAnnounce('')
    setSubmitted(false)
    setSelected({})
    setConf({})
    setSureLine(null)
    startedAt.current = null
    setSeed(freshSeed())
  }

  // Keys 1-3 rate the question that holds focus. Digits are unbound on the lesson page.
  const onQuestionKey = (qi: number, e: React.KeyboardEvent) => {
    if (submitted || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return
    const choice = CONFIDENCE_CHOICES[Number(e.key) - 1]
    if (!choice || e.key.length !== 1 || (selected[qi]?.size ?? 0) === 0) return
    e.preventDefault()
    setConf((prev) => ({ ...prev, [qi]: choice.value }))
  }

  const setQuestionConf = (qi: number, value: Confidence | undefined) => {
    interacted.current = true
    setConf((prev) => {
      const next = { ...prev }
      if (value) next[qi] = value
      else delete next[qi]
      return next
    })
  }

  const jumpTo = (qi: number) => {
    const el = questionRefs.current[qi]
    if (!el) return
    el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }

  // Restore the latest attempt on mount; the ledger read is async and best-effort.
  useEffect(() => {
    let live = true
    getLedgerClient()
      .then((client) =>
        Promise.all([
          client.events({ kinds: ['quiz'], refPrefix: `lesson:${lessonId}` }),
          client.events({ kinds: ['item'], refPrefix: `quiz:${lessonId}#` }),
        ]),
      )
      .then(([quizzes, items]) => {
        if (!live || interacted.current) return
        const r = restoreAttempt(lessonId, questions, quizzes, items)
        if (r === 'none') return
        if (r === 'changed') {
          setStaleNote(true)
          return
        }
        setSeed(r.seed)
        setSelected(r.selected)
        setConf(r.conf)
        setSubmitted(true)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [lessonId, questions])

  // After the render that follows Submit or Retry, put focus where the unmounted button left it.
  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target === 'result') headerRef.current?.focus()
    else if (target === 'first') questionRefs.current[0]?.querySelector('button')?.focus()
  }, [submitted])

  // One quiet line once enough rated answers exist: the ledger read is async and best-effort.
  useEffect(() => {
    if (!submitted) return
    let live = true
    getLedgerClient()
      .then((client) => client.events({ kinds: ['item', 'probe', 'predict'] }))
      .then((events) => {
        if (live) setSureLine(sureSummary(selectCalibration(events)))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [submitted])

  const allAnswered = questions.every((_, qi) => (selected[qi]?.size ?? 0) > 0)

  return (
    <section
      className={cn('rounded-lg border border-line bg-surface-1 p-5 md:p-6', className)}
      aria-label="Checkpoint quiz"
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div ref={headerRef} tabIndex={-1} className="mb-5 flex items-center justify-between rounded-sm">
        <span className="font-mono text-label uppercase text-text-3">Checkpoint</span>
        {submitted && (
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-[11px]',
              passed
                ? 'border-accent/40 bg-accent-dim text-accent'
                : 'border-danger/40 bg-danger/10 text-danger',
            )}
          >
            {correctCount}/{questions.length} · {passed ? 'PASS' : 'RETRY'}
          </motion.span>
        )}
      </div>

      {staleNote && !submitted && (
        <p className="mb-5 font-mono text-[11px] text-text-3">this checkpoint changed since your last attempt</p>
      )}

      {confidentMisses.length > 0 && (
        <div
          role="region"
          aria-label="Confident misses"
          className="mb-6 rounded-md border-l-2 border-danger bg-danger/10 px-3.5 py-3 text-body-sm text-text-2"
        >
          <p className="font-medium text-text-1">
            Confident {confidentMisses.length === 1 ? 'miss' : 'misses'} · {confidentMisses.length}
          </p>
          <p className="mt-0.5">You were sure and wrong. These are the ones worth a second look first.</p>
          <ul className="mt-2 space-y-1">
            {confidentMisses.map((qi) => (
              <li key={qi}>
                <button
                  type="button"
                  onClick={() => jumpTo(qi)}
                  className="text-left underline decoration-danger/50 underline-offset-2 hover:text-text-1"
                >
                  <span className="mr-2 font-mono text-text-3">{String(qi + 1).padStart(2, '0')}</span>
                  {questions[qi].q}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-6">
        {questions.map((q, qi) => {
          const sel = selected[qi] ?? new Set<number>()
          const isCorrectQ = submitted && isRight(q, sel)
          const rated = conf[qi]
          return (
            <li
              key={qi}
              id={`${uid}-q${qi}`}
              ref={(el) => {
                questionRefs.current[qi] = el
              }}
              tabIndex={-1}
              onKeyDown={(e) => onQuestionKey(qi, e)}
              className="scroll-mt-24 focus:outline-none"
            >
              <p className="mb-3 text-body-sm font-medium text-text-1">
                <span className="mr-2 font-mono text-text-3">{String(qi + 1).padStart(2, '0')}</span>
                {q.q}
                {q.multi && (
                  <span className="ml-2 font-mono text-[10px] uppercase text-text-3">
                    select all
                  </span>
                )}
                {submitted && confidentMisses.includes(qi) && (
                  <span className="ml-2 font-mono text-[10px] uppercase text-danger">confident miss</span>
                )}
              </p>
              <div className="space-y-2" data-answered={sel.size > 0}>
                {orders[qi].map((oi, di) => {
                  const opt = q.options[oi]
                  const isSel = sel.has(oi)
                  const isCorrectOpt = q.correct.includes(oi)
                  const showVerdict = submitted
                  const wrongPick = showVerdict && isSel && !isCorrectOpt
                  const rightPick = showVerdict && isCorrectOpt
                  return (
                    <motion.button
                      key={oi}
                      type="button"
                      onClick={() => toggle(qi, oi, q.multi)}
                      disabled={submitted}
                      animate={wrongPick && !reducedMotion ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
                      transition={{ duration: 0.3 }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md border px-3.5 py-2.5 text-left text-body-sm transition-colors duration-150',
                        rightPick
                          ? 'border-accent/50 bg-accent-dim/70 text-text-1'
                          : wrongPick
                            ? 'border-danger/50 bg-danger/10 text-text-1'
                            : isSel
                              ? 'border-line-bright bg-surface-3 text-text-1'
                              : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
                        submitted && 'cursor-default',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[10px]',
                          rightPick
                            ? 'border-accent bg-accent text-accent-foreground'
                            : wrongPick
                              ? 'border-danger bg-danger/10 text-danger'
                              : isSel
                                ? 'border-line-bright bg-surface-1 text-text-1'
                                : 'border-line text-text-3',
                        )}
                      >
                        {LETTERS[di]}
                      </span>
                      <span className="flex-1">{opt}</span>
                      {wrongPick && <X size={14} className="shrink-0 text-danger" aria-hidden />}
                      {rightPick && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
                      {showVerdict && (rightPick || wrongPick) && (
                        <span className="sr-only">
                          {rightPick ? (isSel ? 'your pick, correct' : 'correct answer') : 'your pick, wrong'}
                        </span>
                      )}
                    </motion.button>
                  )
                })}
              </div>
              {sel.size > 0 && (!submitted || rated) && (
                <ConfidencePicker
                  className="mt-3"
                  value={rated}
                  onChange={(v) => setQuestionConf(qi, v)}
                  disabled={submitted}
                />
              )}
              {submitted && q.why && q.why.length === q.options.length && (
                <ul className="mt-2 space-y-1.5" aria-label="Why each answer is right or wrong">
                  {/* wrong picks first (their misconception), then the key(s) */}
                  {[
                    ...orders[qi].filter((oi) => sel.has(oi) && !q.correct.includes(oi)),
                    ...orders[qi].filter((oi) => q.correct.includes(oi)),
                  ].map((oi) => {
                    const right = q.correct.includes(oi)
                    const picked = sel.has(oi)
                    return (
                      <li
                        key={oi}
                        className={cn(
                          'flex items-start gap-2 rounded-md border-l-2 bg-surface-2 px-3.5 py-2.5 text-body-sm text-text-2',
                          right ? 'border-accent' : 'border-danger',
                        )}
                      >
                        {right ? (
                          <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                        ) : (
                          <X size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden />
                        )}
                        <span>
                          <span
                            className={cn(
                              'mr-1.5 font-mono text-[10px] uppercase',
                              right ? 'text-accent' : 'text-danger',
                            )}
                          >
                            {LETTERS[orders[qi].indexOf(oi)]} ·{' '}
                            {right ? (picked ? 'your pick, correct' : 'correct answer') : 'your pick, wrong'}
                          </span>
                          {q.why?.[oi]}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <AnimatePresence>
                {submitted && q.explanation && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p
                      className={cn(
                        'mt-2 rounded-md border-l-2 bg-surface-2 px-3.5 py-2.5 text-body-sm text-text-2',
                        isCorrectQ ? 'border-accent' : 'border-amber',
                      )}
                    >
                      {q.explanation}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </li>
          )
        })}
      </ol>

      <div className="mt-6 flex items-center gap-3">
        {!submitted ? (
          <button
            type="button"
            onClick={submit}
            data-quiz-submit
            disabled={!allAnswered}
            className={cn(
              'rounded-md px-5 py-2.5 font-display text-[15px] font-semibold transition-all duration-150 active:scale-[.97]',
              allAnswered
                ? 'bg-accent text-accent-foreground hover:-translate-y-px'
                : 'cursor-not-allowed bg-surface-3 text-text-3',
            )}
          >
            Submit
          </button>
        ) : (
          <motion.button
            type="button"
            onClick={retry}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-4 py-2.5 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]"
          >
            <RotateCcw size={14} strokeWidth={1.75} />
            Retry
          </motion.button>
        )}
        {!submitted && !allAnswered && (
          <span className="font-mono text-[11px] text-text-3">answer all questions to submit</span>
        )}
        {submitted && sureLine && (
          <span className="font-mono text-[11px] text-text-3">
            Your <em className="not-italic text-text-2">sure</em> answers: {sureLine.correct}/{sureLine.n} right
          </span>
        )}
      </div>
    </section>
  )
}
