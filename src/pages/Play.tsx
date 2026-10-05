import { useParams } from 'react-router'
import NotFound from '@/pages/NotFound'

/** Play ids with a route; C11 moves this table to src/data/plays.ts. */
const PLAY_IDS = ['block-placement']

/** /play/:playId (Wave 1, docs/specs/wave-1.md §11). Scaffold placeholder (B1); C11 lands the play. */
export default function Play() {
  const { playId } = useParams()
  if (!playId || !PLAY_IDS.includes(playId)) return <NotFound />
  return (
    <section className="mx-auto max-w-3xl px-6 py-16" data-page="play" data-play={playId}>
      <p className="section-label">0x00 — play</p>
      <h1 className="mt-3 font-display text-h2 text-text-1">Block placement</h1>
      <p className="mt-3 font-mono text-body-sm text-text-3">The play is coming soon.</p>
    </section>
  )
}
