/**
 * P4 protégé block (docs/specs/wave-3.md §16.9, task 3s-11): "Sam" explains an idea in 4-6 numbered sentences, exactly one
 * of them false, and the learner works three choice items on it, each unlocking the next:
 *   1. **Find** the false sentence (the options are sentence numbers; the passage stays on the page).
 *   2. **Tag** the mistaken idea behind it.
 *   3. **Fix** it: pick the sentence that repairs it, which then appears under the false one.
 * The shared item player plays every step (a why per option, optional confidence); a wrong answer offers "Try again" with a
 * fresh option order, and every attempt is recorded as `item:<lessonId>.protege.<n>.<step>` (src/lib/learner/protege.ts).
 * The plan's risk is that the false line sticks, so from the moment it is found it is shown struck through and tagged
 * "false" in words (a strike alone is not announced by every screen reader and is lost without colour), and it stays that way
 * through the fix. Nothing animates; the block is lazy, so a lesson without one pays nothing.
 *
 * A reload or a revisit reads the block back from the ledger, as the item block does: a step with a right answer to its
 * current version (same ref and rev) among the block's `item:<lessonId>.protege.<n>.*` events stays done, so the false line
 * is struck again and nothing already answered is asked twice. The passage waits for that read, so the false line never
 * shows unmarked first; if the ledger cannot be read the block starts fresh.
 */

import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import type { Lesson, ProtegeBlock as ProtegeBlockData } from '@/data/lessons/types'
import { revFor, type ItemResult } from '@/lib/items/play'
import type { LedgerEvent } from '@/lib/ledger/types'
import { correction, PROTEGE_STEPS, protegeNumber, sentenceLabel, stepItem, stepRef, stepResponse, type ProtegeStep } from '@/lib/learner/protege'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'

const ItemCard = lazy(() => import('@/components/items/ItemCard'))

export interface ProtegeBlockProps {
  block: ProtegeBlockData
  lesson: Pick<Lesson, 'id' | 'kcs' | 'blocks'>
  trackColor: string
}

const STEP_TITLE: Record<ProtegeStep, string> = { find: '1 · Find the false line', tag: '2 · Tag the mistaken idea', fix: '3 · Repair it' }

type Oks = Record<ProtegeStep, boolean | null>

/**
 * The steps the ledger already holds as answered right, in order: a step counts only once every step before it does, and
 * only for an answer to its current version (its ref and rev, which the KCs do not change), so a reworded question reads as new.
 */
function restored(events: readonly LedgerEvent[], lessonId: string, n: number, block: ProtegeBlockData): Oks {
  const oks: Oks = { find: null, tag: null, fix: null }
  for (const step of PROTEGE_STEPS) {
    const ref = stepRef(lessonId, n, step)
    const rev = revFor(stepItem(lessonId, n, block, step))
    if (!events.some((e) => e.kind === 'item' && e.ref === ref && e.rev === rev && e.ok === true)) break
    oks[step] = true
  }
  return oks
}

/** What a step answered on an earlier visit shows in place of its question. */
function earlier(block: ProtegeBlockData, step: ProtegeStep): string {
  if (step === 'find') return `Found earlier: ${sentenceLabel(block.falseAt)} is the false line.`
  if (step === 'tag') return `Tagged earlier: ${block.tag.options[block.tag.correct[0]] ?? ''}.`
  return 'Repaired earlier: the corrected line sits under the struck one.'
}

/** The passage: numbered sentences; after the find, the false one struck through and tagged, and after the fix its repair. */
function Passage({ block, found, fixed }: { block: ProtegeBlockData; found: boolean; fixed: boolean }) {
  return (
    <ol className="m-0 list-none space-y-2 p-0" aria-label="Sam's explanation">
      {block.sentences.map((s, i) => {
        const struck = found && i === block.falseAt
        return (
          <li key={i} data-sentence={i} data-false={struck ? 'true' : undefined} className="flex min-w-0 gap-3 rounded-md border border-line bg-surface-2 p-3">
            <span className="shrink-0 font-mono text-label uppercase text-text-3">{i + 1}</span>
            <div className="min-w-0 break-words text-body-sm text-text-1">
              {struck ? (
                <>
                  <span className="mr-2 inline-block rounded border border-danger/50 bg-danger/10 px-1.5 font-mono text-label uppercase text-text-1">false</span>
                  <del className="text-text-2 decoration-danger decoration-2" data-struck>
                    <span className="sr-only">Struck through, false: </span>
                    {s}
                  </del>
                  {fixed && (
                    <ins data-correction className="mt-2 block rounded-md border border-accent/40 bg-accent-dim/60 p-2 text-text-1 no-underline">
                      <span className="mr-2 font-mono text-label uppercase text-text-2">corrected</span>
                      {correction(block)}
                    </ins>
                  )}
                </>
              ) : (
                s
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

interface StepProps {
  step: ProtegeStep
  block: ProtegeBlockData
  lesson: Pick<Lesson, 'id' | 'kcs'>
  n: number
  /** The step's current attempt seed, fresh per attempt so a retry re-shuffles. */
  seed: number
  /** Null until answered; then whether the answer was right. */
  ok: boolean | null
  /** Answered right on an earlier visit: the step says so instead of asking again. */
  done: boolean
  onResult: (r: ItemResult) => void
  onRetry: () => void
  head: ReactNode
}

/** One step: its heading (focused when the step opens) and the item card, or what was answered on an earlier visit. */
function Step({ step, block, lesson, n, seed, ok, done, onResult, onRetry, head }: StepProps) {
  const item = useMemo(() => stepItem(lesson.id, n, block, step, lesson.kcs), [lesson.id, lesson.kcs, n, block, step])
  if (done) {
    return (
      <>
        {head}
        <p data-protege-earlier={step} className="break-words rounded-md border border-line bg-surface-2 p-3 text-body-sm text-text-2">
          {earlier(block, step)}
        </p>
      </>
    )
  }
  return (
    <>
      {head}
      <Suspense fallback={<p className="text-body-sm text-text-3">Loading the question…</p>}>
        <ItemCard key={seed} item={item} seed={seed} onResult={onResult} onNext={ok === false ? onRetry : undefined} nextLabel="Try again" eyebrow={`${step} · ${block.title}`} />
      </Suspense>
    </>
  )
}

export default function ProtegeBlock({ block, lesson, trackColor }: ProtegeBlockProps) {
  const uid = useId()
  const recordItems = useProgress((s) => s.recordItems)
  const n = protegeNumber(lesson, block)
  const [seeds, setSeeds] = useState<Record<ProtegeStep, number>>(() => ({ find: freshSeed(), tag: freshSeed(), fix: freshSeed() }))
  const [oks, setOks] = useState<Oks>({ find: null, tag: null, fix: null })
  /** The steps answered right on an earlier visit, for the block they were read for; stale or null while the ledger is read. */
  const [loaded, setLoaded] = useState<{ of: ProtegeBlockData; at: string; oks: Oks } | null>(null)
  const before = loaded && loaded.of === block && loaded.at === `${lesson.id}.${n}` ? loaded.oks : null
  /** The step an answer just opened, which takes focus; a step restored from the ledger does not. */
  const [opened, setOpened] = useState<ProtegeStep | null>(null)
  const found = oks.find === true
  const tagged = oks.tag === true
  const fixed = oks.fix === true
  const heads = useRef<Record<ProtegeStep, HTMLHeadingElement | null>>({ find: null, tag: null, fix: null })

  // What the ledger already holds for this block: a reload keeps the false line struck and asks nothing twice.
  useEffect(() => {
    let live = true
    ;(async () => {
      let got: Oks = { find: null, tag: null, fix: null }
      try {
        const engine = await useProgress.controls.engine()
        got = restored(await engine.events({ refPrefix: `item:${lesson.id}.protege.${n}.` }), lesson.id, n, block)
      } catch {
        // no ledger to read: start fresh, and the answers still go to recordItems
      }
      if (!live) return
      setOks(got)
      setLoaded({ of: block, at: `${lesson.id}.${n}`, oks: got })
    })()
    return () => {
      live = false
    }
  }, [lesson.id, n, block])

  // a step that opens takes focus on its heading, so the next Tab reaches its options (the first step does not: the learner is reading)
  useEffect(() => {
    if (opened) heads.current[opened]?.focus()
  }, [opened])

  const answer = (step: ProtegeStep) => (r: ItemResult) => {
    recordItems([stepResponse(lesson.id, r)])
    setOks((o) => ({ ...o, [step]: r.ok }))
    if (r.ok && step !== 'fix') setOpened(step === 'find' ? 'tag' : 'fix')
  }
  const retry = (step: ProtegeStep) => () => {
    setOks((o) => ({ ...o, [step]: null }))
    setSeeds((s) => ({ ...s, [step]: freshSeed() }))
  }
  const heading = (step: ProtegeStep, text: string) => (
    <h4
      ref={(el) => {
        heads.current[step] = el
      }}
      tabIndex={-1}
      id={`${uid}-${step}`}
      className="mb-2 mt-6 font-display text-[15px] font-semibold text-text-1 focus:outline-none"
    >
      {text}
    </h4>
  )
  const common = { block, lesson, n }
  const stepView = (s: ProtegeStep) => (
    <Step {...common} step={s} seed={seeds[s]} ok={oks[s]} done={before?.[s] === true} onResult={answer(s)} onRetry={retry(s)} head={heading(s, STEP_TITLE[s])} />
  )

  return (
    <section data-block="protege" data-lesson={lesson.id} data-protege={n} className="my-8 rounded-lg border border-line bg-surface-1 p-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-label uppercase" style={{ color: trackColor }}>
        <UserRound size={14} aria-hidden />
        Spot the slip
      </div>
      <h3 className="font-display text-body font-medium text-text-1">{block.title}</h3>
      {block.setup && <p className="mt-1 break-words text-body-sm text-text-2">{block.setup}</p>}
      <p className="mb-3 mt-3 text-body-sm text-text-2">One of Sam&apos;s sentences is false. Read all {block.sentences.length}, then find it.</p>
      {before === null ? (
        <p data-protege-loading className="text-body-sm text-text-3">
          Loading your earlier answers…
        </p>
      ) : (
        <>
          <Passage block={block} found={found} fixed={fixed} />
          {found && (
            <p data-protege-note className="mt-3 break-words text-body-sm text-text-2">
              {sentenceLabel(block.falseAt)} stays struck through and tagged false, so it cannot pass for a true line.
            </p>
          )}
          {stepView('find')}
          {found && stepView('tag')}
          {tagged && stepView('fix')}
        </>
      )}
      {fixed && (
        <p data-protege-done className="mt-6 rounded-md border border-line-bright bg-surface-2 p-3.5 text-body-sm text-text-1">
          Found, tagged and repaired: the corrected line sits under the struck one.
        </p>
      )}
    </section>
  )
}
