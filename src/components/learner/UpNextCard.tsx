/**
 * Up Next (Wave 1, docs/specs/wave-1.md §7.3; PLAN-100X K3): the one recommendation and its why line.
 * Presentational: the mounting surface computes `recommend()` (src/lib/learner/recommend.ts) from the
 * façade and passes the result, so this file imports no lesson data and no framer-motion (entry diet,
 * §6.9). Mounted on Today's done card, the lesson footer, Home's Resume, Curriculum's "current" marker
 * and Progress (tasks B18, B25, B26).
 */

import { ArrowRight } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router'
import { PLACEMENT_ROUTE } from '@/lib/learner/recommend'
import type { Recommendation, RecommendationKind } from '@/lib/learner/types'
import { cn } from '@/lib/utils'

export interface UpNextCardProps {
  rec: Recommendation
  /** Show "Already know some of this?" with the placement walk (`offerPlacement(state)`, §7.1). */
  offerPlacement?: boolean
  /** Heading level of the card title inside its surface; defaults to h2. */
  as?: 'h2' | 'h3'
  className?: string
}

const KIND_LABEL: Record<RecommendationKind, string> = {
  boot: 'start here',
  today: 'review',
  lesson: 'lesson',
  lab: 'lab',
  play: 'play',
  placement: 'placement',
  week: 'your week',
}

const VERB: Record<RecommendationKind, string> = {
  boot: 'Start Boot',
  today: 'Open Today',
  lesson: 'Open lesson',
  lab: 'Open lab',
  play: 'Start play',
  placement: 'Start placement',
  week: 'Set your week',
}

/** Track accent for a lesson or lab, from the ref's track prefix (static class strings for Tailwind). */
const TRACK_BAR: Record<string, string> = {
  r: 'bg-[#E7A66A]',
  t0: 'bg-t0',
  t1: 'bg-t1',
  t2: 'bg-t2',
  t3: 'bg-t3',
  t4: 'bg-t4',
  t5: 'bg-t5',
  t6: 'bg-[#5CA8FF]',
  t7: 'bg-[#E879F9]',
}

function accentOf(rec: Recommendation): string {
  if (rec.kind === 'lesson') return TRACK_BAR[rec.ref.split('.')[0]] ?? 'bg-accent'
  if (rec.kind === 'lab') return rec.ref.startsWith('rust-zero-') ? TRACK_BAR.r : 'bg-accent'
  return 'bg-accent'
}

export default function UpNextCard({ rec, offerPlacement = false, as: Heading = 'h2', className }: UpNextCardProps) {
  const titleId = useId()
  const whyId = useId()
  return (
    <section
      aria-labelledby={titleId}
      data-up-next={rec.kind}
      className={cn('relative overflow-hidden rounded-lg border border-line bg-surface-1 p-5', className)}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', accentOf(rec))} />
      <p className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">
        up next · {KIND_LABEL[rec.kind]} · ~{rec.minutes} min
      </p>
      <Heading id={titleId} className="mt-2 font-display text-[18px] font-semibold leading-snug text-text-1 [overflow-wrap:anywhere]">
        {rec.title}
      </Heading>
      <p id={whyId} className="mt-1.5 text-body-sm text-text-2">
        {rec.why}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          to={rec.to}
          aria-describedby={whyId}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground transition-colors duration-150 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1"
        >
          {VERB[rec.kind]}
          <ArrowRight size={16} aria-hidden />
        </Link>
        {offerPlacement && (
          <Link
            to={PLACEMENT_ROUTE}
            className="inline-flex min-h-11 items-center text-body-sm text-text-2 underline decoration-line-bright underline-offset-4 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Already know some of this? Place yourself, about 15 min
          </Link>
        )}
      </div>
    </section>
  )
}
