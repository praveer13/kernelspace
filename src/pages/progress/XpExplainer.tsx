import { useMemo } from 'react'
import { MINUTES, XP_SOURCES, xpBySource, xpOf, type XpSource } from '@/lib/economy'
import { useProgress } from '@/lib/progress'

const SOURCE_LABEL: Record<XpSource, string> = {
  labs: 'Forge labs',
  practice: 'Practice and reviews',
  tickets: 'Exit tickets and checkpoints',
  fleet: 'Fleet Week',
  capstone: 'Capstone',
  onboarding: 'Boot and placement',
}

/** What each kind of graded work is worth (wave-1.md §8.4). Numbers that come from the economy are read from it. */
const PRICES: readonly [string, string][] = [
  ['A passed exit ticket or checkpoint', `${MINUTES.quiz} min (a spiral checkpoint ${MINUTES.spiral})`],
  ['A required lab check, the first time it passes', "the lab's minutes split across its required checks"],
  ['An outcome-graded simulator task', `${MINUTES.simOutcome} min`],
  ['A graded review or practice item', `its nominal seconds, up to ${MINUTES.itemDayCap} min a day`],
  ['Proving a lab to yourself', `${MINUTES.prove} min`],
  ['Boot, placement', `${MINUTES.boot} min each`],
  ['Reading a lesson, clicking, toggling a task', '0'],
]

/**
 * Where XP comes from (wave-1.md §8.4). XP counts minutes of graded work at nominal durations, one XP per
 * minute, each piece of work paid once. Time spent reading or clicking earns nothing, and XP no longer decides
 * your ring; rings come from what you have shown (the checklist above).
 */
export default function XpExplainer() {
  const aggregate = useProgress((s) => s.aggregate)
  const by = useMemo(() => xpBySource(aggregate), [aggregate])
  const total = useMemo(() => xpOf(aggregate), [aggregate])
  return (
    <section aria-labelledby="xp-heading" className="rounded-lg border border-line bg-surface-1 p-6" data-progress-xp>
      <h2 id="xp-heading" className="font-display text-h3 text-text-1">
        How XP works
      </h2>
      <p className="mt-2 text-body-sm text-text-2">
        1 XP is one nominal minute of graded work. Reading and clicking pay nothing, and each piece of work pays once, so XP measures what you
        did, not how long a tab stayed open. XP does not decide your ring.
      </p>

      <p className="mt-4 font-display text-stat text-text-1">
        {total} <span className="font-mono text-[12px] text-text-3">XP so far</span>
      </p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-mono text-[12px]">
        {XP_SOURCES.map((source) => (
          <div key={source} className="contents">
            <dt className="text-text-3">{SOURCE_LABEL[source]}</dt>
            <dd className="text-right text-text-1">{by[source]}</dd>
          </div>
        ))}
      </dl>

      <details className="mt-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-body-sm text-text-2 hover:text-accent">What is worth what</summary>
        <dl className="mt-2 space-y-2 text-body-sm">
          {PRICES.map(([what, worth]) => (
            <div key={what}>
              <dt className="text-text-1">{what}</dt>
              <dd className="font-mono text-[12px] text-text-3">{worth}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  )
}
