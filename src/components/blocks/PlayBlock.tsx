/**
 * W1 play block (Wave 1, docs/specs/wave-1.md §11.1): the inline mount of a Play → Debrief → Compose →
 * In-production → Code play inside a lesson. The play itself is lazy, so a lesson without one pays nothing;
 * the full-screen route is `/play/<playId>`.
 */

import { Suspense, lazy } from 'react'

const BlockPlacementPlay = lazy(() => import('@/components/play/block-placement/Play'))

export interface PlayBlockProps {
  lessonId: string
  /** Play id; the full-screen route is `/play/<playId>`. */
  playId: string
  title: string
  trackColor: string
}

export default function PlayBlock({ lessonId, playId, title, trackColor }: PlayBlockProps) {
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
        {playId === 'block-placement' ? (
          <Suspense fallback={<p className="font-mono text-body-sm text-text-3">Loading the play…</p>}>
            <BlockPlacementPlay mode="embed" />
          </Suspense>
        ) : (
          <p className="font-mono text-body-sm text-text-3">There is no play called {playId}.</p>
        )}
      </div>
    </section>
  )
}
