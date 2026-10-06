/**
 * W1 play block (Wave 1, docs/specs/wave-1.md §11.1): the inline mount of a Play → Compose → Code
 * play inside a lesson. Scaffold stub (B1): the props are final, the body is a placeholder until C11.
 */

import { Link } from 'react-router'

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
      className="my-8 rounded-lg border border-line bg-surface-1 px-5 py-4"
      data-block="play"
      data-lesson={lessonId}
      data-play={playId}
    >
      <p className="font-mono text-label uppercase" style={{ color: trackColor }}>
        Play
      </p>
      <p className="mt-2 font-display text-body-sm font-medium text-text-1">{title}</p>
      <p className="mt-1 font-mono text-body-sm text-text-3">The play is coming soon.</p>
      <Link
        to={`/play/${playId}`}
        className="mt-3 inline-block font-mono text-[11px] text-text-3 transition-colors duration-150 hover:text-accent"
      >
        open full screen
      </Link>
    </section>
  )
}
