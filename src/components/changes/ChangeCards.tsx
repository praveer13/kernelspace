import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Check, ExternalLink, X } from 'lucide-react'
import { ERRATA } from '@/data/errata'
import type { Erratum } from '@/data/errata/schema'
import type { QuizQuestion } from '@/components/QuizBlock'
import ConfidencePicker from '@/components/learner/ConfidencePicker'
import { lessonById, lessonPath } from '@/data/lessons'
import { rev32 } from '@/lib/ledger/stable'
import type { ChangeCard, Confidence } from '@/lib/ledger/types'
import { changeCardsFor } from '@/lib/learner/change-cards'
import { CONFIDENCE_CHOICES } from '@/lib/learner/calibration'
import { useProgress } from '@/lib/progress'
import { freshSeed, shuffledOrder } from '@/lib/rng'
import { cn } from '@/lib/utils'

const LETTERS = ['A', 'B', 'C', 'D', 'E']

const lessonLabel = (id: string) => id.toUpperCase()

function Badge({ kind }: { kind: Erratum['kind'] }) {
  return (
    <span
      className={cn(
        'rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]',
        kind === 'error' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-amber/40 bg-amber/10 text-amber',
      )}
    >
      {kind}
    </span>
  )
}

interface ItemProps {
  erratum: Erratum
  index: number
  item: QuizQuestion
  onAnswered: () => void
}

/**
 * One retrieval item. Pick, optionally say how sure, check: the verdict and the `why` for every option
 * show at once and one `item card:<id>#<i>` event is written. There is no retry, so the answer stays a
 * first-try retrieval. Options are shuffled per view; the pick is stored by authored index.
 *
 * Keyboard and screen reader (as in Boot's StepForm): the check button stays mounted and reads "Answer
 * checked", so focus never falls to <body>, and the verdict arrives through a polite live region that
 * was already in the page before the answer.
 */
function CardItem({ erratum, index, item, onAnswered }: ItemProps) {
  const recordItems = useProgress((s) => s.recordItems)
  const [pick, setPick] = useState<number | null>(null)
  const [conf, setConf] = useState<Confidence | undefined>()
  const [checked, setChecked] = useState(false)
  const [seed] = useState(freshSeed)
  const startedAt = useRef<number | null>(null)
  const order = useMemo(() => shuffledOrder(item.options.length, seed), [item.options.length, seed])
  const ok = pick !== null && item.correct.includes(pick)
  const rightLetters = order.flatMap((oi, di) => (item.correct.includes(oi) ? [LETTERS[di]] : []))

  const choose = (oi: number) => {
    if (checked) return
    startedAt.current ??= Date.now()
    setPick(oi)
  }

  const check = () => {
    if (pick === null || checked) return
    setChecked(true)
    recordItems([
      {
        kind: 'item',
        ref: `card:${erratum.id}#${index}`,
        rev: rev32({ erratumId: erratum.id, i: index, q: item.q, options: item.options, correct: item.correct }),
        score: ok ? 1 : 0,
        ok,
        seed,
        ...(conf ? { conf } : {}),
        ...(startedAt.current === null ? {} : { ms: Date.now() - startedAt.current }),
        data: { src: 'card', pick: [pick] },
      },
    ])
    onAnswered()
  }

  // Keys 1-3 rate the item once an option is picked. Digits are unbound on this page.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (checked || pick === null || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return
    const choice = CONFIDENCE_CHOICES[Number(e.key) - 1]
    if (!choice || e.key.length !== 1) return
    e.preventDefault()
    setConf(choice.value)
  }

  return (
    <div onKeyDown={onKeyDown} role="group" aria-label={`Question ${index + 1}`}>
      <p className="text-body-sm font-medium text-text-1">{item.q}</p>
      <div className="mt-3 space-y-2">
        {order.map((oi, di) => {
          const picked = pick === oi
          const right = item.correct.includes(oi)
          const wrongPick = checked && picked && !right
          const rightOpt = checked && right
          return (
            <button
              key={oi}
              type="button"
              onClick={() => choose(oi)}
              disabled={checked}
              aria-pressed={picked}
              className={cn(
                'flex w-full items-center gap-3 rounded-md border px-3.5 py-2.5 text-left text-body-sm transition-colors duration-150',
                rightOpt
                  ? 'border-accent/50 bg-accent-dim/70 text-text-1'
                  : wrongPick
                    ? 'border-danger/50 bg-danger/10 text-text-1'
                    : picked
                      ? 'border-line-bright bg-surface-3 text-text-1'
                      : 'border-line bg-surface-2 text-text-2 hover:border-line-bright hover:text-text-1',
                checked && 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[10px]',
                  rightOpt
                    ? 'border-accent bg-accent text-accent-foreground'
                    : wrongPick
                      ? 'border-danger bg-danger/10 text-danger'
                      : picked
                        ? 'border-line-bright bg-surface-1 text-text-1'
                        : 'border-line text-text-3',
                )}
              >
                {LETTERS[di]}
              </span>
              <span className="flex-1">{item.options[oi]}</span>
              {wrongPick && <X size={14} className="shrink-0 text-danger" aria-hidden />}
              {rightOpt && <Check size={14} className="shrink-0 text-accent" aria-hidden />}
              {checked && (rightOpt || wrongPick) && (
                <span className="sr-only">{rightOpt ? (picked ? 'your pick, correct' : 'correct answer') : 'your pick, wrong'}</span>
              )}
            </button>
          )
        })}
      </div>

      {pick !== null && !checked && <ConfidencePicker className="mt-3" value={conf} onChange={setConf} />}

      <button
        type="button"
        onClick={check}
        disabled={pick === null}
        aria-disabled={checked || undefined}
        tabIndex={checked ? -1 : undefined} // inert once checked: it holds focus for now, but is no stop on the next pass
        className={cn(
          'mt-4 rounded-md px-4 py-2 font-display text-[14px] font-semibold transition-all duration-150 active:scale-[.97]',
          checked
            ? 'cursor-default bg-surface-3 text-text-2 active:scale-100'
            : pick === null
              ? 'cursor-not-allowed bg-surface-3 text-text-3'
              : 'bg-accent text-accent-foreground hover:-translate-y-px',
        )}
      >
        {checked ? 'Answer checked' : 'Check answer'}
      </button>

      <div role="status" aria-live="polite">
        {checked && (
          <>
            <p className={cn('mt-3 text-body-sm font-semibold', ok ? 'text-accent' : 'text-text-1')}>
              {ok ? 'Correct.' : `Not quite. ${rightLetters.length === 1 ? 'Right answer' : 'Right answers'}: ${rightLetters.join(', ')}.`}
            </p>
            {item.why && item.why.length === item.options.length && (
              <ul className="mt-2 space-y-1.5" aria-label="Why each answer is right or wrong">
                {/* the wrong pick first (its misconception), then the key */}
                {[...order.filter((oi) => oi === pick && !item.correct.includes(oi)), ...order.filter((oi) => item.correct.includes(oi))].map((oi) => {
                  const right = item.correct.includes(oi)
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
                        {/* a trailing space, not a margin: a screen reader would otherwise run "wrong" into the why */}
                        <span className={cn('font-mono text-[10px] uppercase', right ? 'text-accent' : 'text-danger')}>
                          {LETTERS[order.indexOf(oi)]} · {right ? (oi === pick ? 'your pick, correct' : 'correct answer') : 'your pick, wrong'}{' '}
                        </span>
                        {item.why?.[oi]}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Card({ card, startedAcked }: { card: ChangeCard; startedAcked: boolean }) {
  const { erratum } = card
  const acknowledge = useProgress((s) => s.acknowledge)
  const [touched, setTouched] = useState(false)
  const [answered, setAnswered] = useState<ReadonlySet<number>>(new Set())
  const items = erratum.items ?? []

  const ack = (via: string) => {
    setTouched(true)
    acknowledge(`erratum:${erratum.id}`, { via })
  }

  const onAnswered = (index: number) => {
    setTouched(true)
    const next = new Set(answered).add(index)
    setAnswered(next)
    if (next.size === items.length) ack('items')
  }

  // A card seen in an earlier visit folds to one line. One acted on in this visit stays open so its feedback does not vanish.
  if (card.acked && startedAcked && !touched) {
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-1 px-4 py-3">
        <Badge kind={erratum.kind} />
        <time dateTime={erratum.date} className="font-mono text-[11px] text-text-3">
          {erratum.date}
        </time>
        <span className="text-body-sm text-text-2">{erratum.title}</span>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.1em] text-text-3">seen</span>
      </li>
    )
  }

  return (
    <li className="rounded-xl border border-line bg-surface-1 p-5 md:p-6" data-change-card={erratum.id}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge kind={erratum.kind} />
        <time dateTime={erratum.date} className="font-mono text-[11px] text-text-3">
          {erratum.date}
        </time>
        {card.acked && <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent">seen</span>}
      </div>
      <h3 className="mt-3 text-lg font-semibold leading-snug text-text-1">{erratum.title}</h3>
      <dl className="mt-4 space-y-3 text-body leading-relaxed">
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">before</dt>
          <dd className="mt-1 text-text-3">
            <del className="decoration-text-3/60">{erratum.before}</del>
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">after</dt>
          <dd className="mt-1 text-text-1">{erratum.after}</dd>
        </div>
        {erratum.why && (
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">why</dt>
            <dd className="mt-1 text-text-2">{erratum.why}</dd>
          </div>
        )}
      </dl>

      <p className="mt-4 text-body-sm text-text-2">
        You finished{' '}
        {card.lessonIds.map((id, i) => {
          const lesson = lessonById(id)
          return (
            <span key={id}>
              {i > 0 && ', '}
              {lesson ? (
                <Link to={lessonPath(lesson)} className="font-mono text-accent hover:underline" title={lesson.title}>
                  {lessonLabel(id)}
                </Link>
              ) : (
                <span className="font-mono">{lessonLabel(id)}</span>
              )}
            </span>
          )
        })}{' '}
        before this fix
        {erratum.source && (
          <>
            {' · '}
            <a
              href={erratum.source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-start gap-1 font-mono text-[11px] text-accent hover:underline"
            >
              <span>source · {erratum.source.title}</span>
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            </a>
          </>
        )}
      </p>

      {items.length > 0 && (
        <div className="mt-5 space-y-6 border-t border-line pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
            {items.length === 1 ? 'check it stuck' : `check it stuck · ${items.length} questions`}
          </p>
          {items.map((item, i) => (
            <CardItem key={i} erratum={erratum} index={i} item={item} onAnswered={() => onAnswered(i)} />
          ))}
        </div>
      )}

      <div className="mt-5">
        {/* One button for both states, so pressing Got it does not drop keyboard focus to <body>; once seen it is inert and out of the tab order. */}
        <button
          type="button"
          onClick={() => {
            if (!card.acked) ack('got-it')
          }}
          aria-disabled={card.acked || undefined}
          tabIndex={card.acked ? -1 : undefined}
          className={
            card.acked
              ? 'inline-flex cursor-default items-center gap-1.5 font-mono text-[11px] text-accent'
              : 'min-h-11 rounded-md border border-line bg-surface-2 px-4 py-2 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]'
          }
        >
          {card.acked ? (
            <>
              <Check size={12} aria-hidden /> marked as seen
            </>
          ) : (
            'Got it'
          )}
        </button>
      </div>
    </li>
  )
}

/**
 * S4 "For you" section (ledger spec §12.2): errata dated after the learner finished an affected lesson,
 * unacknowledged first. Answering every item, or "Got it", writes `ack erratum:<id>`. Renders nothing
 * until the learner has finished a lesson an erratum touches.
 */
export default function ChangeCards() {
  const lessons = useProgress((s) => s.lessons)
  const acks = useProgress((s) => s.acks)
  const cards = useMemo(() => changeCardsFor(lessons, acks, ERRATA), [lessons, acks])
  // Order is fixed by what was acknowledged when the page opened, so answering a card does not move it.
  const [ackedAtOpen] = useState<ReadonlySet<string>>(() => new Set(cards.filter((c) => c.acked).map((c) => c.erratum.id)))
  const ordered = useMemo(
    () =>
      [...cards].sort(
        (a, b) =>
          Number(ackedAtOpen.has(a.erratum.id)) - Number(ackedAtOpen.has(b.erratum.id)) ||
          b.erratum.date.localeCompare(a.erratum.date) ||
          a.erratum.id.localeCompare(b.erratum.id),
      ),
    [cards, ackedAtOpen],
  )

  if (cards.length === 0) return null

  const open = cards.filter((c) => !ackedAtOpen.has(c.erratum.id)).length
  const heading =
    open === 0
      ? `For you: ${cards.length} ${cards.length === 1 ? 'change' : 'changes'} reviewed`
      : `For you: ${open} ${open === 1 ? 'thing' : 'things'} you learned ${open === 1 ? 'has' : 'have'} changed`

  return (
    <section aria-labelledby="for-you-heading" className="mb-12 rounded-2xl border border-accent/30 bg-accent-dim/20 p-4 md:p-6">
      <h2 id="for-you-heading" className="text-xl font-semibold tracking-tight text-text-1">
        {heading}
      </h2>
      <p className="mt-2 max-w-2xl text-body-sm text-text-2">
        You finished these lessons before the fix shipped. Each card says what changed; answer the question to check it stuck, or tap Got it.
      </p>
      <ol className="mt-5 space-y-4">
        {ordered.map((card) => (
          <Card key={card.erratum.id} card={card} startedAcked={ackedAtOpen.has(card.erratum.id)} />
        ))}
      </ol>
    </section>
  )
}
