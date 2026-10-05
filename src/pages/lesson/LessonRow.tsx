/**
 * LessonRow (design.md §9.6) — shared by /curriculum accordions and /tracks/:id.
 * 56px grid row: [32px status | 1fr title+desc | auto meta | 24px chevron].
 * Status: done = mint check · read = hollow check (finished, not passed: wave-1.md §8.3) ·
 * current = pulsing ring (track color) · todo = line outline · exam = amber graduation-cap.
 */

import { Link } from 'react-router'
import { motion } from 'framer-motion'
import { Check, ChevronRight, GraduationCap } from 'lucide-react'
import { useProgress } from '@/lib/progress'
import { lessonPath } from '@/data/lessons'
import type { Lesson } from '@/data/lessons/types'
import { EXERCISE_META } from '@/pages/lesson/exercise-meta'
import { cn } from '@/lib/utils'

interface LessonRowProps {
  lesson: Lesson
  trackColor: string
  /** highlight as the resume target */
  current?: boolean
  /** show the 1-line hook under the title (track page) */
  showDescription?: boolean
  className?: string
}

export default function LessonRow({
  lesson,
  trackColor,
  current = false,
  showDescription = false,
  className,
}: LessonRowProps) {
  const status = useProgress((s) => s.lessons[lesson.id]?.status ?? 'unstarted')
  const done = status === 'done'
  // finished without passing: a hollow check, named in words so colour and shape are not the only cue (§8.3)
  const read = status === 'read'
  const readLabel = lesson.ticket ? 'read, ticket not passed' : 'read, checkpoint not passed'
  // t2.l7 is no longer an exam with a gate: it is the spiral checkpoint (§8.6)
  const examLabel = lesson.ticket?.form === 'spiral' ? 'spiral checkpoint' : 'exam'
  const meta = EXERCISE_META[lesson.exercise]
  const ExIcon = meta.icon

  return (
    <motion.div whileHover="hover" className={className}>
      <Link
        to={lessonPath(lesson)}
        data-status={status}
        className={cn(
          'group grid min-h-14 grid-cols-[32px_1fr_auto_24px] items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2',
          current && 'border-l-2 bg-surface-2',
          lesson.exam && 'min-h-16',
        )}
        style={current ? { borderLeftColor: trackColor } : undefined}
        aria-current={current ? 'true' : undefined}
      >
        {/* status cell */}
        <span className="flex items-center justify-center">
          {lesson.exam ? (
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full border',
                done
                  ? 'border-accent bg-accent text-accent-foreground'
                  : read
                    ? 'border-text-3 text-text-2'
                    : 'border-amber/60 text-amber',
              )}
            >
              {done ? (
                <Check size={11} strokeWidth={3} />
              ) : read ? (
                <Check size={11} strokeWidth={2} aria-hidden />
              ) : (
                <GraduationCap size={12} strokeWidth={1.75} />
              )}
              {(done || read) && <span className="sr-only">{done ? 'done' : readLabel}</span>}
            </span>
          ) : done ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Check size={11} strokeWidth={3} />
              <span className="sr-only">done</span>
            </span>
          ) : read ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-text-3 text-text-2">
              <Check size={11} strokeWidth={2} aria-hidden />
              <span className="sr-only">{readLabel}</span>
            </span>
          ) : current ? (
            <span className="relative flex h-5 w-5 items-center justify-center">
              <span
                className="absolute inset-0 animate-ping rounded-full border opacity-60 [animation-duration:1.6s]"
                style={{ borderColor: trackColor }}
              />
              <span className="h-5 w-5 rounded-full border-2" style={{ borderColor: trackColor }} />
            </span>
          ) : (
            <span
              className={cn(
                'h-5 w-5 rounded-full border',
                status === 'reading' ? 'border-2' : 'border-line',
              )}
              style={status === 'reading' ? { borderColor: trackColor } : undefined}
            />
          )}
        </span>

        {/* title + description */}
        <span className="min-w-0">
          <motion.span
            variants={{ hover: { x: 4 } }}
            transition={{ duration: 0.15 }}
            className={cn(
              'block truncate text-body-sm font-medium transition-colors duration-150',
              done ? 'text-text-2 group-hover:text-text-1' : 'text-text-1',
            )}
          >
            <span className="mr-2 font-mono text-[11px] text-text-3">L{lesson.index}</span>
            {lesson.title}
            {lesson.exam && (
              <span className="ml-2 rounded-sm border border-amber/40 bg-amber/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber">
                ★ {examLabel}
              </span>
            )}
          </motion.span>
          {showDescription && (
            <span
              className={cn(
                'mt-0.5 hidden truncate text-body-sm text-text-3 sm:block',
                lesson.exam && 'italic',
              )}
            >
              {lesson.hook}
            </span>
          )}
        </span>

        {/* meta */}
        <span className="flex items-center gap-2.5">
          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2 py-0.5 font-mono text-[10px] text-text-3 md:flex">
            <ExIcon size={11} strokeWidth={1.75} />
            {meta.label}
          </span>
          <span className="font-mono text-[11px] text-text-3">{lesson.minutes}min</span>
        </span>

        {/* chevron */}
        <ChevronRight
          size={16}
          strokeWidth={1.75}
          className="text-text-3 transition-colors duration-150 group-hover:text-text-1"
        />
      </Link>
    </motion.div>
  )
}
