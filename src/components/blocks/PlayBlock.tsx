/**
 * W1 play block (Wave 1, docs/specs/wave-1.md §11.1): the inline mount of a Play → Debrief → Compose →
 * In-production → Code play inside a lesson. The play itself is lazy, so a lesson without one pays nothing;
 * the full-screen route is `/play/<playId>`. Ids resolve through src/components/play/registry.ts (wave-2.md §2.3):
 * a pending id renders nothing and an unknown id renders an error card.
 */

import { Suspense } from 'react'
import { resolvePlay } from '@/components/play/registry'

export interface PlayBlockProps {
  lessonId: string
  /** Play id; the full-screen route is `/play/<playId>`. */
  playId: string
  title: string
  trackColor: string
}

/** The card for an id no registry entry answers to. Shared by the block and the page. */
export function PlayErrorCard({ playId }: { playId: string }) {
  return (
    <p className="rounded-md border border-line bg-surface-2 p-3 font-mono text-body-sm text-text-2" data-play-error={playId}>
      {`There is no play called ${playId}.`}
    </p>
  )
}

export default function PlayBlock({ lessonId, playId, title, trackColor }: PlayBlockProps) {
  const found = resolvePlay(playId)
  if (found.kind === 'pending') return null
  return (
    <section
      className="my-8 rounded-lg border border-line bg-surface-1 px-4 py-4 sm:px-5"
      data-block="play"
      data-lesson={lessonId}
      data-play={playId}
    >
      <p className="font-mono text-label uppercase" style={{ color: trackColor }}>
        Play
      </p>
      <h3 className="mt-2 font-display text-body font-medium text-text-1">{title}</h3>
      <div className="mt-3">
        {found.kind === 'play' ? (
          <Suspense fallback={<p className="font-mono text-body-sm text-text-3">Loading the play…</p>}>
            <found.entry.Component mode="embed" />
          </Suspense>
        ) : (
          <PlayErrorCard playId={playId} />
        )}
      </div>
    </section>
  )
}
