import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx as cn } from 'clsx'
import { Inline, ProveV2Session } from '@/components/forge/ProveFromModule'
import ConstructedAnswer from '@/components/items/ConstructedAnswer'
import { findForgeBundle } from '@/data/forge'
import { FORGE_LABS } from '@/data/labs'
import { slotForLab } from '@/lib/engine/catalog'
import { readSlots } from '@/lib/engine/slots'
import { localDateKey } from '@/lib/economy'
import { followUpResponse, dueReturns, planReturn } from '@/lib/forge/prove-return'
import type { ReturnDue, ReturnEnv, ReturnPlan } from '@/lib/forge/prove-return'
import { getLedgerClient } from '@/lib/ledger/client'
import type { ProveEventLike } from '@/lib/forge/prove2'
import { daysBetween } from '@/lib/learner/reentry'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import { runLabCalls } from '@/lib/lab-worker'
import { sha256Hex } from '@/lib/ledger/stable'

/**
 * The 30-day return's card body (docs/specs/wave-3.md §7.5, task 3b-04): one question about a lab the learner first
 * proved a month ago. ProveReturnCard.tsx, the lazy mount on Today's done card and empty state, loads this only after
 * it has seen a prove event old enough to be due, so a learner with nothing due never fetches it and /today's static
 * closure does not grow.
 *
 * Which question (src/lib/forge/prove-return.ts): if the lab's component is installed on this device and its bundle has
 * `prove2`, a v2 question on a fresh seed, run against the installed bytes in the lab worker and recorded with
 * `data.return`; otherwise v1's follow-up item, a constructed response the learner checks themselves, recorded as an
 * `item` event with `data.return`. It never blocks Today: "Not today" hides it for the visit, and it renders nothing
 * when no lab can be asked.
 */
export interface ProveReturnBodyProps {
  variant: 'done' | 'empty'
  /** The ledger, the lab worker and the clock; tests replace them. */
  env?: Partial<ReturnEnv>
}

/** The ledger, the lab worker, the clock and the device's components, unless the caller gave others. */
function withDefaults(env: Partial<ReturnEnv> | undefined): ReturnEnv {
  return {
    run: env?.run ?? runLabCalls,
    record: env?.record ?? ((r) => useProgress.getState().recordProve(r)),
    now: env?.now ?? (() => Date.now()),
    hash: env?.hash ?? sha256Hex,
    seed: env?.seed ?? freshSeed,
    today: env?.today ?? (() => localDateKey()),
    events:
      env?.events ??
      (async () => {
        const client = await getLedgerClient()
        const [proves, items, runs] = await Promise.all([
          client.events({ kinds: ['prove'] }),
          client.events({ kinds: ['item'], refPrefix: 'item:lab' }),
          client.events({ kinds: ['lab-check'] }),
        ])
        return [...runs, ...proves, ...items] as unknown as ProveEventLike[]
      }),
    bundle: env?.bundle ?? ((labId) => findForgeBundle(labId)),
    installed:
      env?.installed ??
      (async (labId) => {
        const slot = slotForLab(labId)
        const entry = slot === undefined ? undefined : readSlots(useProgress.getState().working['engine:slots'])[slot]
        if (entry === undefined || entry.labId !== labId) return null
        const client = await getLedgerClient()
        return { sha256: entry.sha256, bytes: await client.componentBytes(entry.sha256) }
      }),
    recordItems: env?.recordItems ?? ((items) => useProgress.getState().recordItems(items)),
  }
}

interface Pending {
  due: ReturnDue
  plan: ReturnPlan
  today: string
}

/** The most overdue lab that can be asked; a lab whose bundle or question is missing is passed over, not dropped. */
async function findPending(e: ReturnEnv): Promise<Pending | null> {
  const events = await e.events()
  const today = e.today()
  for (const due of dueReturns(events, today)) {
    try {
      const bundle = await e.bundle(due.labId)
      if (bundle === undefined) continue
      const installed = await e.installed(due.labId).catch(() => null)
      const plan = planReturn({ labId: due.labId, prove2: bundle.prove2?.templates, prove: bundle.prove, installed, events, seed: e.seed() })
      if (plan !== undefined) return { due, plan, today }
    } catch {
      // a lab whose question cannot be drawn waits; the next one may be asked
    }
  }
  return null
}

const touch = 'min-h-6 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11'
const primaryBtn =
  'flex items-center rounded-md bg-accent px-3.5 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 active:scale-[.97] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3'
const quietBtn = 'flex items-center rounded-md border border-line bg-surface-3 px-3.5 py-2 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]'

export default function ProveReturnBody({ variant, env }: ProveReturnBodyProps) {
  const e = useMemo(() => withDefaults(env), [env])
  const [pending, setPending] = useState<Pending | null>(null)
  const [hidden, setHidden] = useState(false)
  const [answered, setAnswered] = useState(false)

  useEffect(() => {
    let live = true
    void findPending(e)
      .catch(() => null)
      .then((p) => {
        if (live) setPending(p)
      })
    return () => {
      live = false
    }
  }, [e])

  if (pending === null || hidden) return null
  const { due, plan } = pending
  const lab = FORGE_LABS.find((l) => l.id === due.labId)
  const heading = `prove-return-${variant}`
  const days = Math.max(0, daysBetween(due.firstDay, pending.today))
  return (
    <section aria-labelledby={heading} className="rounded-lg border border-line bg-surface-1 p-4" data-prove-return={variant} data-kind={plan.kind} data-lab={due.labId}>
      <p className="font-mono text-[11px] uppercase text-text-3">30-day check</p>
      <h2 id={heading} className="mt-1 font-display text-[17px] text-text-1">
        {lab === undefined ? due.labId : `Lab ${String(lab.index).padStart(2, '0')}, ${lab.title}`}: one question, {days} days on
      </h2>
      <p className="mt-1 text-body-sm text-text-2">
        {plan.kind === 'v2'
          ? 'You first proved this lab a month ago. Close your agent: your installed module answers a fresh list of calls, and you predict what it replies.'
          : 'You first answered questions on this lab a month ago. Close your agent: write your own answer to one of them, then check it against the model answer.'}
      </p>
      <div className="mt-3">
        {plan.kind === 'v2' ? (
          <ProveV2Session
            labId={plan.labId}
            template={plan.template}
            plan={plan.plan}
            bytes={plan.installed.bytes}
            graded={{ sha256: plan.installed.sha256, credit: 'unseen' }}
            history={plan.history}
            ret
            env={e}
            focus="verdict"
            note="This runs the module installed in your engine. A 30-day check starts no wait."
            onGraded={() => setAnswered(true)}
          />
        ) : (
          <FollowUp plan={plan} e={e} onSaved={() => setAnswered(true)} />
        )}
      </div>
      {!answered && (
        <button type="button" data-prove-return-skip onClick={() => setHidden(true)} className={cn('mt-3', quietBtn, touch)}>
          Not today
        </button>
      )}
    </section>
  )
}

/** v1's follow-up item: a constructed response, checked by the learner against three ideas (two of three is a pass). */
function FollowUp({ plan, e, onSaved }: { plan: Extract<ReturnPlan, { kind: 'v1' }>; e: ReturnEnv; onSaved: () => void }) {
  const { question } = plan
  const [text, setText] = useState('')
  const [ideas, setIdeas] = useState<[boolean, boolean, boolean]>([false, false, false])
  const [revealed, setRevealed] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  const shownAt = useRef<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const done = useRef<HTMLParagraphElement>(null)

  // Revealing unmounts the reveal button, which held focus: move it to the model answer, as an item card does.
  useEffect(() => {
    if (revealed) box.current?.querySelector<HTMLElement>('[data-ks-model]')?.focus()
  }, [revealed])
  useEffect(() => {
    if (saved !== null) done.current?.focus()
  }, [saved])

  const cr = { prompt: question.prompt, model: question.model, ideas: [...question.ideas] as [string, string, string], kcs: [...question.kcs] }
  const save = () => {
    if (saved !== null) return
    const start = shownAt.current ?? e.now()
    e.recordItems([followUpResponse({ ref: plan.ref, question, ideas, ms: e.now() - start })])
    setSaved(ideas.filter(Boolean).length)
    onSaved()
  }
  return (
    <div ref={box} data-prove-return-v1={question.id}>
      <p className="mb-3 text-body-sm font-medium text-text-1">
        <Inline text={question.prompt} />
      </p>
      <ConstructedAnswer
        cr={cr}
        text={text}
        ideas={ideas}
        revealed={revealed}
        onText={(t) => {
          shownAt.current ??= e.now()
          setText(t)
        }}
        onReveal={() => setRevealed(true)}
        onIdea={(i, on) => setIdeas((prev) => prev.map((v, j) => (j === i ? on : v)) as [boolean, boolean, boolean])}
        disabled={saved !== null}
      />
      {revealed && saved === null && (
        <button type="button" data-prove-return-save onClick={save} className={cn('mt-3', primaryBtn, touch)}>
          Save
        </button>
      )}
      {/* always mounted so the saved line is announced when it appears */}
      <div role="status" aria-live="polite">
        {saved !== null && (
          <p ref={done} tabIndex={-1} data-prove-return-saved className="mt-3 text-body-sm font-medium text-text-1 outline-none">
            Saved: you covered {saved} of 3 ideas{saved >= 2 ? '.' : '. Re-read the model answer once more.'}
          </p>
        )}
      </div>
    </div>
  )
}
