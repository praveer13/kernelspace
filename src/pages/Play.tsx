import { Suspense, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { PlayErrorCard } from '@/components/blocks/PlayBlock'
import { resolvePlay } from '@/components/play/registry'
import { getPlay } from '@/data/plays'

/**
 * /play/:playId (Wave 1, docs/specs/wave-1.md §11; registry: wave-2.md §2.3): the play full screen, for phones and
 * Up Next. The same component the lesson embeds, resolved through the play registry, so a play started here and
 * one started in its lesson write the same ledger events. A pending id (a play a later task ships) gets a short
 * note instead of a blank page, and an unknown id the error card.
 */
function Frame({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-page="play" data-play={id}>
      <p className="section-label">0x00 — play</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">{title}</h1>
      {children}
    </section>
  )
}

export default function Play() {
  const { playId = '' } = useParams()
  const found = resolvePlay(playId)

  if (found.kind === 'play') {
    const def = getPlay(playId)
    return (
      <Frame id={playId} title={def?.title ?? playId}>
        <p className="mt-3 text-body-sm text-text-2">
          {found.entry.intro}
          {def && (
            <>
              {' '}
              It lives in{' '}
              <Link to={`/lesson/${def.lessonId}`} className="text-info underline underline-offset-2">
                lesson {def.lessonId}
              </Link>
              .
            </>
          )}
        </p>
        <div className="mt-6">
          <Suspense fallback={<p className="font-mono text-body-sm text-text-3">Loading the play…</p>}>
            <found.entry.Component mode="page" />
          </Suspense>
        </div>
      </Frame>
    )
  }

  if (found.kind === 'pending') {
    return (
      <Frame id={playId} title="This play is not out yet">
        <p className="mt-3 text-body-sm text-text-2">
          It is part of a lesson that is still being written.{' '}
          <Link to="/curriculum" className="text-info underline underline-offset-2">
            Back to the curriculum
          </Link>
          .
        </p>
      </Frame>
    )
  }

  return (
    <Frame id={playId} title="No such play">
      <div className="mt-4">
        <PlayErrorCard playId={playId} />
      </div>
      <p className="mt-3 text-body-sm text-text-2">
        <Link to="/curriculum" className="text-info underline underline-offset-2">
          Back to the curriculum
        </Link>
      </p>
    </Frame>
  )
}
