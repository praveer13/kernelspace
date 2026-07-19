/**
 * Exercise-kind metadata (icon + label) shared by LessonRow and the lesson page.
 */

import { Activity, Terminal, HelpCircle, BookOpen } from 'lucide-react'
import type { ExerciseKind } from '@/data/lessons/types'

export const EXERCISE_META: Record<ExerciseKind, { icon: typeof Activity; label: string }> = {
  sim: { icon: Activity, label: 'simulator' },
  code: { icon: Terminal, label: 'code lab' },
  quiz: { icon: HelpCircle, label: 'quiz' },
  read: { icon: BookOpen, label: 'guided read' },
  'quiz+sim': { icon: Activity, label: 'quiz + sim' },
  'read+quiz': { icon: BookOpen, label: 'read + quiz' },
}
