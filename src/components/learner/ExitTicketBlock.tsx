/**
 * V5 exit ticket (Wave 1, docs/specs/wave-1.md §8.1). blocks.tsx routes a lesson's `quiz` block here
 * when `lesson.ticket` exists. Scaffold stub (B1): the props are final; until B19 lands the ticket it
 * renders the lesson's checkpoint, so a lesson that opts in early never loses its quiz.
 */

import QuizBlock from '@/components/QuizBlock'
import type { Lesson, QuizBlockData } from '@/data/lessons/types'

export interface ExitTicketBlockProps {
  /** The lesson, for `kcs` and `ticket`; the ticket draws on both. */
  lesson: Lesson
  /** The lesson's checkpoint block: the ticket's MCQs come from these questions. */
  block: QuizBlockData
  trackColor: string
}

export default function ExitTicketBlock({ lesson, block }: ExitTicketBlockProps) {
  return <QuizBlock lessonId={lesson.id} questions={block.questions} />
}
