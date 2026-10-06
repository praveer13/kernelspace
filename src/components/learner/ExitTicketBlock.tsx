/**
 * V5 exit ticket as a lesson block (Wave 1, docs/specs/wave-1.md §8.1). blocks.tsx routes a lesson's `quiz`
 * block here when `lesson.ticket` exists. The ticket draws its two checkpoint questions from `block`, and
 * its non-MCQ from a generator family or the lesson's constructed responses (`ExitTicket`).
 *
 * - A lesson that cannot supply a valid ticket (too few questions, nothing to produce) keeps its
 *   checkpoint, so a lesson that opts in early never loses its quiz.
 * - A lesson that is already done shows a quiet "passed" line, with a way to try fresh items as review.
 *   The ticket itself is never hidden for a lesson that is merely *read*: it is the way to pass it later.
 */
import { Check } from 'lucide-react'
import { useState } from 'react'
import QuizBlock from '@/components/QuizBlock'
import type { Lesson, QuizBlockData } from '@/data/lessons/types'
import { useProgress } from '@/lib/progress'
import ExitTicket from './ExitTicket'

export interface ExitTicketBlockProps {
  /** The lesson, for `kcs` and `ticket`; the ticket draws on both. */
  lesson: Lesson
  /** The lesson's checkpoint block: the ticket's MCQs come from these questions. */
  block: QuizBlockData
  trackColor: string
}

export default function ExitTicketBlock({ lesson, block, trackColor }: ExitTicketBlockProps) {
  const status = useProgress((s) => s.lessons[lesson.id]?.status)
  // set once the learner has played a ticket here, so a pass made on this page keeps showing its verdict
  const [played, setPlayed] = useState(false)
  const [review, setReview] = useState(false)

  if (status === 'done' && !played && !review) {
    return (
      <section id="exit-ticket" data-ks-ticket aria-label="Exit ticket" className="my-8 rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <p className="flex items-center gap-2 text-body text-text-1">
          <Check size={18} className="shrink-0 text-accent" aria-hidden />
          <span>
            <strong>Exit ticket passed.</strong> This lesson is done.
          </span>
        </p>
        <button
          type="button"
          onClick={() => setReview(true)}
          className="mt-3 min-h-11 rounded-md border border-line-bright bg-surface-2 px-5 font-display text-[15px] font-semibold text-text-1 hover:border-accent"
        >
          Review with new numbers
        </button>
      </section>
    )
  }

  return (
    <div className="my-8">
      <ExitTicket
        lesson={lesson}
        trackColor={trackColor}
        onResolved={() => setPlayed(true)}
        fallback={<QuizBlock lessonId={lesson.id} questions={block.questions} />}
      />
    </div>
  )
}
