/**
 * A Fleet exercise inside a lesson (docs/specs/wave-3.md §5.3, §2.3). 3a-03 mounts this stub so ExerciseView
 * can route a `fleet` block here; it renders nothing until 3b-20 builds the panel, and its props are final.
 */

import type { FleetExerciseBlock } from '@/data/lessons/types'

export interface FleetExerciseProps {
  block: FleetExerciseBlock
  lessonId: string
  /** The block's index in the lesson, which keys its `grp` (`<lessonId>#<index>`). */
  index: number
}

export default function FleetExercise(props: FleetExerciseProps): null {
  void props
  return null
}
