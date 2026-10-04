import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, X, RotateCcw } from 'lucide-react'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import { freshSeed, shuffledOrder } from '@/lib/rng'

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
}

interface QuizBlockProps {
  lessonId: string
  questions: QuizQuestion[]
  className?: string
}

const LETTERS = ['A', 'B', 'C', 'D', 'E']

/**
 * QuizBlock — inline lesson checkpoint (design.md §9.10).
 * Submit → per-option feedback (mint wash + check / danger wash + shake, no shake under
 * reduced motion). The option letter stays visible after submit, beside the verdict icon,
 * so the per-option `why` list always resolves to a visible option.
 * explanation expands, score persists to the progress store. Pass ≥80%
 * lights the checkpoint mint. Retry resets with a staggered fade.
 * Options are shuffled per attempt (PLAN-100X §5.1 V1): letters label display
 * position, while selection and grading stay on authored indices.
 */
export default function QuizBlock({ lessonId, questions, className }: QuizBlockProps) {
  const recordQuizScore = useProgress((s) => s.recordQuizScore)
  const [selected, setSelected] = useState<Record<number, Set<number>>>({})
  const [submitted, setSubmitted] = useState(false)
  const [seed, setSeed] = useState(freshSeed)
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
    return questions.filter((q, qi) => {
      const sel = selected[qi] ?? new Set<number>()
      return (
        sel.size === q.correct.length && q.correct.every((c) => sel.has(c))
      )
    }).length
  }, [submitted, questions, selected])

  const score = questions.length ? correctCount / questions.length : 0
  const passed = score >= 0.8

  const toggle = (qi: number, oi: number, multi?: boolean) => {
    if (submitted) return
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
    setSubmitted(true)
    recordQuizScore(lessonId, questions.length ? correctCountNow() / questions.length : 0)
  }

  // compute score at submit time (state may lag one render)
  const correctCountNow = () =>
    questions.filter((q, qi) => {
      const sel = selected[qi] ?? new Set<number>()
      return sel.size === q.correct.length && q.correct.every((c) => sel.has(c))
    }).length

  const retry = () => {
    setSubmitted(false)
    setSelected({})
    setSeed(freshSeed())
  }

  const allAnswered = questions.every((_, qi) => (selected[qi]?.size ?? 0) > 0)

  return (
    <section
      className={cn('rounded-lg border border-line bg-surface-1 p-5 md:p-6', className)}
      aria-label="Checkpoint quiz"
    >
      <div className="mb-5 flex items-center justify-between">
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

      <ol className="space-y-6">
        {questions.map((q, qi) => {
          const sel = selected[qi] ?? new Set<number>()
          const isCorrectQ =
            submitted && sel.size === q.correct.length && q.correct.every((c) => sel.has(c))
          return (
            <li key={qi}>
              <p className="mb-3 text-body-sm font-medium text-text-1">
                <span className="mr-2 font-mono text-text-3">{String(qi + 1).padStart(2, '0')}</span>
                {q.q}
                {q.multi && (
                  <span className="ml-2 font-mono text-[10px] uppercase text-text-3">
                    select all
                  </span>
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
      </div>
    </section>
  )
}
