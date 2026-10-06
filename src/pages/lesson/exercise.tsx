/**
 * Exercise embed card → /lab/:simId (lesson.md §2.7). Split out of blocks.tsx (Wave 1 scaffold B1) so
 * P2's inline SimHost mount (spec §10, `taskIds`) can land here without touching the dispatcher.
 */

import { useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, FlaskConical, Plus, Square } from 'lucide-react'
import { SIM_INFO } from '@/data/lessons'
import type { ExerciseBlock } from '@/data/lessons/types'
import { ProseView } from './prose'
import { renderInline } from './markdown'

export function ExerciseView({
  block,
  trackColor,
  lessonId,
}: {
  block: ExerciseBlock
  trackColor: string
  lessonId: string
}) {
  const sim = SIM_INFO[block.simId]
  const Icon = sim?.icon ?? FlaskConical
  const [noteOpen, setNoteOpen] = useState(false)
  const labSearch = new URLSearchParams({ from: lessonId })
  if (block.machine) labSearch.set('machine', block.machine)
  const labUrl = `/lab/${block.simId}?${labSearch.toString()}`

  return (
    <section className="my-8 overflow-hidden rounded-lg border border-line bg-surface-1" data-exercise={block.simId}>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-label uppercase" style={{ color: trackColor }}>
            Exercise
          </span>
          <span className="font-display text-body-sm font-medium text-text-1">{block.title}</span>
        </div>
        <Link
          to={labUrl}
          className="flex items-center gap-1.5 font-mono text-[11px] text-text-3 transition-colors duration-150 hover:text-accent"
        >
          open full screen
          <ExternalLink size={12} />
        </Link>
      </div>

      {/* placeholder canvas (sim is mounted by the lab route) */}
      <div className="relative flex min-h-[240px] flex-col items-center justify-center gap-4 bg-blueprint px-6 py-10 text-center md:min-h-[300px]">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-lg border bg-surface-2"
          style={{ borderColor: `${trackColor}55`, color: trackColor }}
        >
          <Icon size={26} strokeWidth={1.5} />
        </span>
        <div>
          <p className="font-display text-h4 text-text-1">{sim?.name ?? block.title}</p>
          <p className="mt-1 max-w-md text-body-sm text-text-2">{sim?.hook}</p>
        </div>
        <p className="font-mono text-[11px] text-text-3">
          the live simulator runs at <span className="text-text-1">/lab/{block.simId}</span>
        </p>
        <Link
          to={labUrl}
          className="rounded-md bg-accent px-5 py-2.5 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97]"
        >
          Open the simulator
        </Link>
      </div>

      {/* guided tasks */}
      <div className="border-t border-line px-5 py-4">
        <p className="mb-3 font-mono text-label uppercase text-text-3">Guided tasks</p>
        <ul className="space-y-2">
          {block.tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-3 text-body-sm text-text-2">
              <Square size={14} className="mt-0.5 shrink-0 text-text-3" strokeWidth={1.75} />
              <span>
                <span className="mr-2 font-mono text-[11px] text-text-3">{String(i + 1).padStart(2, '0')}</span>
                {renderInline(t)}
              </span>
            </li>
          ))}
        </ul>
        {block.note && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setNoteOpen((v) => !v)}
              className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-text-3 transition-colors duration-150 hover:text-text-1"
              aria-expanded={noteOpen}
            >
              <motion.span animate={{ rotate: noteOpen ? 45 : 0 }} transition={{ duration: 0.2 }}>
                <Plus size={12} />
              </motion.span>
              what just happened
            </button>
            <AnimatePresence initial={false}>
              {noteOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="pt-3 [&_p]:!text-body-sm">
                    <ProseView md={block.note} trackColor={trackColor} compact />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </section>
  )
}
