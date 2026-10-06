import { Link, useParams } from 'react-router'
import BlockPlacementPlay from '@/components/play/block-placement/Play'
import { getPlay } from '@/data/plays'
import NotFound from '@/pages/NotFound'

/**
 * /play/:playId (Wave 1, docs/specs/wave-1.md §11): the play full screen, for phones and Up Next. The same
 * component the lesson embeds, so a play started here and one started in T1.L4 write the same ledger events.
 */
export default function Play() {
  const { playId } = useParams()
  const def = playId ? getPlay(playId) : undefined
  if (!def) return <NotFound />
  return (
    <section className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16" data-page="play" data-play={def.id}>
      <p className="section-label">0x00 — play</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">{def.title}</h1>
      <p className="mt-3 text-body-sm text-text-2">
        Place memory blocks by hand against a hidden reference policy, then compose a policy of your own. It lives in{' '}
        <Link to={`/lesson/${def.lessonId}`} className="text-info underline underline-offset-2">
          lesson {def.lessonId}
        </Link>
        .
      </p>
      <div className="mt-6">
        <BlockPlacementPlay mode="page" />
      </div>
    </section>
  )
}
