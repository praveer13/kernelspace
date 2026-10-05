/**
 * The debrief (docs/specs/wave-1.md §11.2): the first place the hidden reference appears. It stops at the
 * first divergence, says that op in one sentence, and shows both heaps at that op side by side, each
 * with its DOM mirror. Nothing here runs before the learner asks for it.
 */

import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/Button'
import Grid, { type GridMark } from '@/components/play/block-placement/Grid'
import Mirror from '@/components/play/block-placement/Mirror'
import { cellWord, type Session } from '@/data/plays'
import { endLine } from '@/lib/world/play'
import { cells } from '@/lib/world/placement'
import type { HeapOp } from '@/lib/world/types'

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export interface DebriefProps {
  /** A session with its summary set (`debrief(session)`). */
  session: Session
  onAgain: () => void
}

export default function Debrief({ session, onAgain }: DebriefProps) {
  const { summary, setup, trace } = session
  const uid = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  // The Debrief button that opened this has unmounted: hand focus to what comes next (spec §16.2).
  useEffect(() => heading.current?.focus(), [])
  if (!summary) return null
  const total = trace.ops.length
  const div = summary.divergence
  const op: HeapOp | undefined = div ? trace.ops[div.op] : undefined
  const size = op && op.op === 'alloc' ? cells(op.size) : 0
  const mineMarks: GridMark[] = []
  const refMarks: GridMark[] = []
  if (div) {
    if (div.mine.at !== undefined) mineMarks.push({ start: cells(div.mine.at), size, tone: 'you' })
    // Where the reference's policy would have put the block on the learner's own heap.
    if (div.alternative?.kind === 'place') mineMarks.push({ start: cells(div.alternative.start), size, tone: 'ref' })
    if (div.ghost.at !== undefined) refMarks.push({ start: cells(div.ghost.at), size, tone: 'ref' })
  }
  const opNo = div ? div.op + 1 : 0

  return (
    <section aria-labelledby={`${uid}-h`} data-phase="debrief" className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
      <p className="section-label">Debrief</p>
      <h3 ref={heading} id={`${uid}-h`} tabIndex={-1} className="mt-2 font-display text-h4 text-text-1 outline-none">
        {div ? `The first divergence is at op ${opNo}` : 'You kept pace with the reference'}
      </h3>
      <p className="mt-2 text-body-sm text-text-2">
        {capital(endLine(setup, session.ps))}.
        {summary.skipped && ' You skipped ahead, so the reference finished your run from where you stood.'} You got through {summary.survived} of{' '}
        {total} ops. The reference got through {summary.ghostSurvived}.
      </p>

      {div ? (
        <>
          <p className="mt-4 rounded-sm border-l-2 border-accent bg-surface-2 px-3 py-2 text-body-sm text-text-1">{div.explanation}</p>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <figure>
              <figcaption className="mb-1.5 font-mono text-[12px] text-text-2">Your heap after op {opNo}</figcaption>
              <Grid view={div.mine.view} label={`Your heap after op ${opNo}`} describedBy={`${uid}-mine`} marks={mineMarks} />
              <Mirror id={`${uid}-mine`} view={div.mine.view} title={`Your heap after op ${opNo}`} />
            </figure>
            <figure>
              <figcaption className="mb-1.5 font-mono text-[12px] text-text-2">The reference&apos;s heap after op {opNo}</figcaption>
              <Grid view={div.ghost.view} label={`The reference's heap after op ${opNo}`} describedBy={`${uid}-ref`} marks={refMarks} />
              <Mirror id={`${uid}-ref`} view={div.ghost.view} title={`The reference's heap after op ${opNo}`} />
            </figure>
          </div>
          <p className="mt-3 font-mono text-[11px] text-text-3">
            Amber outline: where you put the {cellWord(size)} block. Mint outline: where the reference put it (on your heap: where it would have put it).
          </p>
        </>
      ) : (
        <p className="mt-3 text-body-sm text-text-2">
          Nothing in your run put you behind the reference, so there is no divergence to chase. Compose a policy below and see what else holds up.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="secondary" onClick={onAgain}>
          Play again with new numbers
        </Button>
        <p className="font-mono text-[11px] text-text-3">
          seed {trace.seed} · {session.provenance === 'unseen' ? 'new numbers' : 'the shared practice trace'}
        </p>
      </div>
    </section>
  )
}
