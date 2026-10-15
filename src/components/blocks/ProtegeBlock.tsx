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
 */

import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { UserRound } from 'lucide-react'
import type { Lesson, ProtegeBlock as ProtegeBlockData } from '@/data/lessons/types'
import type { ItemResult } from '@/lib/items/play'
import { correction, protegeNumber, sentenceLabel, stepItem, stepResponse, type ProtegeStep } from '@/lib/learner/protege'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'

const ItemCard = lazy(() => import('@/components/items/ItemCard'))

export interface ProtegeBlockProps {
  block: ProtegeBlockData
  lesson: Pick<Lesson, 'id' | 'kcs' | 'blocks'>
  trackColor: string
}

const STEP_TITLE: Record<ProtegeStep, string> = { find: '1 · Find the false line', tag: '2 · Tag the mistaken idea', fix: '3 · Repair it' }

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
  onResult: (r: ItemResult) => void
  onRetry: () => void
  head: ReactNode
}

/** One step: its heading (focused when the step opens) and the item card. */
function Step({ step, block, lesson, n, seed, ok, onResult, onRetry, head }: StepProps) {
  const item = useMemo(() => stepItem(lesson.id, n, block, step, lesson.kcs), [lesson.id, lesson.kcs, n, block, step])
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
  const [oks, setOks] = useState<Record<ProtegeStep, boolean | null>>({ find: null, tag: null, fix: null })
  const found = oks.find === true
  const tagged = oks.tag === true
  const fixed = oks.fix === true
  const heads = useRef<Record<ProtegeStep, HTMLHeadingElement | null>>({ find: null, tag: null, fix: null })

  // a step that opens takes focus on its heading, so the next Tab reaches its options (the first step does not: the learner is reading)
  useEffect(() => {
    if (found) heads.current.tag?.focus()
  }, [found])
  useEffect(() => {
    if (tagged) heads.current.fix?.focus()
  }, [tagged])

  const answer = (step: ProtegeStep) => (r: ItemResult) => {
    recordItems([stepResponse(lesson.id, r)])
    setOks((o) => ({ ...o, [step]: r.ok }))
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

  return (
    <section data-block="protege" data-lesson={lesson.id} data-protege={n} className="my-8 rounded-lg border border-line bg-surface-1 p-5">
      <div className="mb-3 flex items-center gap-2 font-mono text-label uppercase" style={{ color: trackColor }}>
        <UserRound size={14} aria-hidden />
        Spot the slip
      </div>
      <h3 className="font-display text-body font-medium text-text-1">{block.title}</h3>
      {block.setup && <p className="mt-1 break-words text-body-sm text-text-2">{block.setup}</p>}
      <p className="mb-3 mt-3 text-body-sm text-text-2">One of Sam&apos;s sentences is false. Read all {block.sentences.length}, then find it.</p>
      <Passage block={block} found={found} fixed={fixed} />
      {found && (
        <p data-protege-note className="mt-3 break-words text-body-sm text-text-2">
          {sentenceLabel(block.falseAt)} stays struck through and tagged false, so it cannot pass for a true line.
        </p>
      )}

      <Step {...common} step="find" seed={seeds.find} ok={oks.find} onResult={answer('find')} onRetry={retry('find')} head={heading('find', STEP_TITLE.find)} />
      {found && <Step {...common} step="tag" seed={seeds.tag} ok={oks.tag} onResult={answer('tag')} onRetry={retry('tag')} head={heading('tag', STEP_TITLE.tag)} />}
      {tagged && <Step {...common} step="fix" seed={seeds.fix} ok={oks.fix} onResult={answer('fix')} onRetry={retry('fix')} head={heading('fix', STEP_TITLE.fix)} />}
      {fixed && (
        <p data-protege-done className="mt-6 rounded-md border border-line-bright bg-surface-2 p-3.5 text-body-sm text-text-1">
          Found, tagged and repaired: the corrected line sits under the struck one.
        </p>
      )}
    </section>
  )
}
