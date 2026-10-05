/**
 * ExitTicket: one attempt at a lesson's exit ticket, spiral checkpoint or test-out (docs/specs/wave-1.md
 * §7.2, §8.1, §8.6). It loads what the plan needs (the learner's history for this lesson, the generator
 * families that cover the lesson's KCs, and for a spiral the predicted recall of earlier KCs), plans the
 * items with `planTicket`, plays them one at a time in the item player, and on the last answer writes
 * one `recordTicket`. The items are not recorded one by one: a ticket is one attempt, and an abandoned
 * one writes nothing.
 *
 * Nothing locks (W8). A miss always offers **New numbers** (a fresh seed and other questions) and
 * **Continue anyway** (`completeLesson(id, 'read')`: read, not passed) as two equal buttons. A test-out
 * is the exception that proves the rule: it is limited to one per lesson per local day, so its miss
 * offers the lesson instead, which was never closed.
 *
 * The root carries `id="exit-ticket"` and `data-ks-ticket` (a test-out: `test-out`, `data-ks-testout`), so the lesson page's "Exit ticket" button and
 * the `m` key can scroll to it and focus its first control. Keys inside a card are the item player's, the
 * same as Today. Every state names its verdict in words and an icon, never colour alone.
 */
import { Check, X } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ItemCard from '@/components/items/ItemCard'
import { BOOT_KCS, KCS, kcById } from '@/data/kc'
import type { Lesson } from '@/data/lessons/types'
import { loadFamily } from '@/lib/items/registry'
import { refFor, type ItemResult } from '@/lib/items/play'
import { seedFor } from '@/lib/items/core'
import type { Gen } from '@/lib/items/types'
import type { KcId } from '@/lib/kc/types'
import { getLedgerClient } from '@/lib/ledger/client'
import type { LedgerEvent, LocalDay, TicketForm } from '@/lib/ledger/types'
import { localDateKey } from '@/lib/economy'
import { freshSeed } from '@/lib/rng'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import {
  earlierKcsOf,
  isNonMcq,
  judgeTicket,
  makeGenPool,
  planTicket,
  ticketAttempt,
  type TicketContent,
  type TicketVerdict,
} from '@/lib/learner/ticket'
import type { TicketPlan } from '@/lib/learner/types'

export interface ExitTicketProps {
  lesson: Lesson
  /** Defaults to the lesson's `ticket.form`, else `ticket`. */
  form?: TicketForm
  /** A track colour for the header mark. */
  trackColor?: string
  /** Shown when the lesson cannot supply a valid ticket (too few questions, nothing to produce). */
  fallback?: ReactNode
  /** A test-out's way out (after a pass or a miss). A ticket has none: it sits in the lesson. */
  onClose?: () => void
  /** Called once per attempt, after `recordTicket`. */
  onResolved?: (verdict: TicketVerdict, form: TicketForm) => void
  className?: string
}

const LABEL: Record<TicketForm, string> = { ticket: 'Exit ticket', spiral: 'Spiral checkpoint', testout: 'Test out' }

/* ------------------------------ what a plan needs ------------------------------ */

/** The learner's events for this lesson, or nothing when the ledger cannot be read (the ticket still works). */
async function loadHistory(lessonId: string): Promise<LedgerEvent[]> {
  try {
    const client = await getLedgerClient()
    const [quiz, cr, lessonQuiz] = await Promise.all([
      client.events({ kinds: ['item'], refPrefix: `quiz:${lessonId}#` }),
      client.events({ kinds: ['item'], refPrefix: `cr:${lessonId}#` }),
      client.events({ kinds: ['quiz'], refPrefix: `lesson:${lessonId}` }),
    ])
    return [...quiz, ...cr, ...lessonQuiz]
  } catch {
    return []
  }
}

/** Lesson id → the KCs it introduces, by the graph's own record (the cards derivation reads these). */
function graphLessons(): { id: string; kcs: KcId[] }[] {
  const out = new Map<string, KcId[]>()
  for (const k of KCS) if (k.lessons[0]) out.set(k.lessons[0], [...(out.get(k.lessons[0]) ?? []), k.id])
  return [...out].map(([id, kcs]) => ({ id, kcs }))
}

/** Predicted recall of every carded KC now (spec §8.6), or undefined when it cannot be derived: the spiral then falls back to curriculum order. */
async function loadRecall(lesson: Lesson, gens: readonly Gen[]): Promise<TicketContent['recall']> {
  try {
    const [client, cards, resolve] = await Promise.all([getLedgerClient(), import('@/lib/learner/cards'), import('@/lib/kc/resolve')])
    const events = await client.events()
    const kcContent = resolve.buildKcContent({ lessons: [lesson], gens })
    const content = cards.cardsContent({
      kcs: KCS,
      lessons: graphLessons(),
      bootKcs: BOOT_KCS,
      resolve: (e) => resolve.kcsOfEvent(e, kcContent),
    })
    const today = localDateKey() as LocalDay
    const set = cards.deriveCards(events, content, today)
    return (kc) => {
      const card = set.cards[kc]
      return card ? cards.cardRetrievability(card, today) : null
    }
  } catch {
    return undefined
  }
}

async function loadContent(lesson: Lesson, form: TicketForm): Promise<TicketContent> {
  const spiral = form === 'spiral'
  const earlier = spiral ? earlierKcsOf(lesson.id, KCS) : []
  const kcs = [...(lesson.kcs ?? []), ...earlier]
  const ids = [...new Set(kcs.flatMap((kc) => kcById(kc)?.gen ?? []))]
  // a family that fails to load is left out: the ticket falls back to a constructed response
  const settled = await Promise.allSettled(ids.map((id) => loadFamily(id)))
  const gens = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
  const pool = makeGenPool(new Map(gens.map((g) => [g.id, g])), (kc) => kcById(kc)?.gen ?? [])
  const recall = spiral ? await loadRecall(lesson, gens) : undefined
  return { pool, ...(spiral ? { earlier } : {}), ...(recall ? { recall } : {}) }
}

/* ------------------------------ the component ------------------------------ */

type Load = { status: 'loading' } | { status: 'none' } | { status: 'ready'; plan: TicketPlan }

const BUTTON =
  'min-h-11 rounded-md border border-line-bright bg-surface-2 px-5 font-display text-[15px] font-semibold text-text-1 hover:border-accent'

/** The anchors the lesson page scrolls to: a test-out is not the exit ticket, and a page can show both. */
const marks = (form: TicketForm) => (form === 'testout' ? { id: 'test-out', 'data-ks-testout': '' } : { id: 'exit-ticket', 'data-ks-ticket': '' })

const NON_MCQ_WORD = (plan: TicketPlan): string => {
  const kinds = new Set(plan.items.filter(isNonMcq).map((it) => (it.source === 'cr' ? 'written' : 'numeric')))
  return kinds.size === 1 ? [...kinds][0] : 'written or numeric'
}

export default function ExitTicket({ lesson, form: formProp, trackColor, fallback, onClose, onResolved, className }: ExitTicketProps) {
  const form: TicketForm = formProp ?? lesson.ticket?.form ?? 'ticket'
  const headingId = useId()
  const recordTicket = useProgress((s) => s.recordTicket)
  const completeLesson = useProgress((s) => s.completeLesson)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [index, setIndex] = useState(0)
  const [verdict, setVerdict] = useState<TicketVerdict | null>(null)
  const [continued, setContinued] = useState(false)
  const results = useRef<ItemResult[]>([])
  const startedAt = useRef(0) // set when a plan lands (`reset`)
  const recorded = useRef(false)
  // refs shown in earlier plans of this visit, so "New numbers" meets other questions even before the ledger write lands
  const shown = useRef(new Set<string>())
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const plan = useCallback(async (): Promise<TicketPlan | null> => {
    const [events, content] = await Promise.all([loadHistory(lesson.id), loadContent(lesson, form)])
    return planTicket(lesson, content, events, freshSeed(), { form, avoid: new Set(shown.current) })
  }, [lesson, form])

  const reset = useCallback((p: TicketPlan | null) => {
    results.current = []
    recorded.current = false
    startedAt.current = Date.now()
    setIndex(0)
    setVerdict(null)
    setContinued(false)
    setLoad(p ? { status: 'ready', plan: p } : { status: 'none' })
  }, [])

  useEffect(() => {
    let alive = true
    plan()
      .then((p) => alive && reset(p))
      .catch(() => alive && reset(null))
    return () => {
      alive = false
    }
  }, [plan, reset])

  const newNumbers = () => {
    if (load.status === 'ready') for (const it of load.plan.items) shown.current.add(refFor(it))
    setLoad({ status: 'loading' })
    plan()
      .then((p) => live.current && reset(p))
      .catch(() => live.current && reset(null))
  }

  const finish = (p: TicketPlan) => {
    if (recorded.current) return
    recorded.current = true
    const rs = results.current
    recordTicket(ticketAttempt(p, rs, Date.now() - startedAt.current))
    const v = judgeTicket(p, rs.map((r) => r.ok))
    setVerdict(v)
    onResolved?.(v, p.form)
  }

  const continueAnyway = () => {
    completeLesson(lesson.id, 'read')
    setContinued(true)
  }

  const itemSeeds = useMemo(
    () => (load.status === 'ready' ? load.plan.items.map((it, i) => (it.source === 'gen' ? undefined : seedFor(load.plan.seed, i))) : []),
    [load],
  )

  if (load.status === 'loading') {
    return (
      <section {...marks(form)} aria-busy="true" aria-label={LABEL[form]} className={cn('rounded-lg border border-line bg-surface-1 p-5', className)}>
        <p className="font-mono text-label uppercase text-text-3">{LABEL[form]}</p>
        <p className="mt-2 text-body-sm text-text-2">Preparing your items.</p>
      </section>
    )
  }
  if (load.status === 'none') return <>{fallback ?? null}</>

  const { plan: p } = load
  const last = p.items.length - 1
  const rule =
    p.form === 'spiral'
      ? `${p.items.length} items · pass with ${p.passRule.minCorrect} right, at least one of them ${NON_MCQ_WORD(p)}`
      : `${p.items.length} items · pass with ${p.passRule.minCorrect} right, including the ${NON_MCQ_WORD(p)} one`

  return (
    <section
      {...marks(p.form)}
      aria-labelledby={headingId}
      className={cn('min-w-0 max-w-full rounded-lg border border-line bg-surface-1 p-4 sm:p-5', className)}
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={headingId} className="flex items-center gap-2 font-mono text-label uppercase text-text-3">
          {trackColor && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: trackColor }} />}
          {LABEL[p.form]}
        </h3>
        <p className="text-body-sm text-text-2">{rule}</p>
      </div>

      <ItemCard
        key={`${p.seed}:${index}`}
        item={p.items[index]}
        {...(itemSeeds[index] === undefined ? {} : { seed: itemSeeds[index] })}
        eyebrow={`Item ${index + 1} of ${p.items.length}`}
        autoFocus={index > 0}
        onResult={(r) => {
          results.current[index] = r
          if (index === last) finish(p)
        }}
        {...(index < last ? { onNext: () => setIndex(index + 1), nextLabel: 'Next item' } : {})}
      />

      {verdict && (
        <div className="mt-4 rounded-md border border-line bg-surface-2 p-4" role="status" aria-live="polite">
          <Verdict
            plan={p}
            verdict={verdict}
            continued={continued}
            onNewNumbers={newNumbers}
            onContinue={continueAnyway}
            {...(onClose ? { onClose } : {})}
          />
        </div>
      )}
    </section>
  )
}

function Verdict({
  plan,
  verdict,
  continued,
  onNewNumbers,
  onContinue,
  onClose,
}: {
  plan: TicketPlan
  verdict: TicketVerdict
  continued: boolean
  onNewNumbers: () => void
  onContinue: () => void
  onClose?: () => void
}) {
  const testout = plan.form === 'testout'
  const tally = `${verdict.correct} of ${verdict.of} right`
  const word = NON_MCQ_WORD(plan)
  if (verdict.ok) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-body text-text-1">
          <Check size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span>
            <strong>{testout ? 'Tested out' : 'Passed'}</strong> · {tally}, the {word} item included.
          </span>
        </p>
        <p className="text-body-sm text-text-2">
          {testout
            ? 'This lesson is marked done. A confirmation review comes up in 7 days, and the lesson stays open to read.'
            : 'This lesson is done. Its ideas join your review queue.'}
        </p>
        {onClose && (
          <button type="button" onClick={onClose} className={BUTTON}>
            Close
          </button>
        )}
      </div>
    )
  }
  const why =
    verdict.correct >= plan.passRule.minCorrect && !verdict.nonMcqOk
      ? `Enough were right, but a ${word} item has to be right to pass.`
      : `${plan.passRule.minCorrect} are needed.`
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-body text-text-1">
        <X size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
        <span>
          <strong>Not yet</strong> · {tally}. {why}
        </span>
      </p>
      {testout ? (
        <>
          <p className="text-body-sm text-text-2">Nothing is locked: the lesson is open. A new test-out opens tomorrow, and the exit ticket at the end of the lesson is open any time.</p>
          {onClose && (
            <button type="button" onClick={onClose} className={BUTTON}>
              Read the lesson
            </button>
          )}
        </>
      ) : (
        <>
          {continued ? (
            <p className="text-body-sm text-text-2">Marked as read, ticket not passed. The ticket stays here, so you can pass it later.</p>
          ) : (
            <p className="text-body-sm text-text-2">Nothing is locked. Try fresh items, or carry on and come back to this ticket later.</p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onNewNumbers} className={BUTTON}>
              New numbers
            </button>
            {!continued && (
              <button type="button" onClick={onContinue} className={BUTTON}>
                Continue anyway
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
