/**
 * Exercise embed card → /lab/:simId (lesson.md §2.7). Split out of blocks.tsx (Wave 1 scaffold B1) so
 * P2's inline SimHost mount (spec §10, `taskIds`) lands here without touching the dispatcher.
 *
 * A block without `taskIds` keeps the link card. A block with them mounts the sim inline through SimHost
 * (embed mode, or phone mode on a phone), lists those registry tasks with live state, and keeps "what just
 * happened" shut until every task is finished.
 */

import { Suspense, lazy, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ExternalLink, FlaskConical, Plus, Square } from 'lucide-react'
import { SIM_INFO } from '@/data/lessons'
import type { ExerciseBlock } from '@/data/lessons/types'
import { useProgress } from '@/lib/progress'
import { resolveInlineMode, usePhoneViewport } from '@/lib/sims/host'
import { ProseView } from './prose'
import { renderInline } from './markdown'

// The sim, the registry and the task panels load only for a block that mounts inline.
const SimHost = lazy(() => import('@/components/sims/SimHost'))

function labUrlFor(block: ExerciseBlock, lessonId: string): string {
  const labSearch = new URLSearchParams({ from: lessonId })
  if (block.machine) labSearch.set('machine', block.machine)
  return `/lab/${block.simId}?${labSearch.toString()}`
}

function ExerciseHeader({ block, trackColor, labUrl }: { block: ExerciseBlock; trackColor: string; labUrl: string }) {
  return (
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
  )
}

/** The collapsible "what just happened". `locked` keeps it shut and says why. */
function WhatJustHappened({ md, trackColor, locked }: { md: string; trackColor: string; locked?: boolean }) {
  const [noteOpen, setNoteOpen] = useState(false)
  if (locked) {
    return (
      <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-text-3" data-note-locked>
        what just happened · opens when you finish the tasks
      </p>
    )
  }
  return (
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
              <ProseView md={md} trackColor={trackColor} compact />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** An exercise block with `taskIds`: the sim inline, or the phone-mode tasks on a phone. */
function InlineExercise({ block, trackColor, lessonId }: { block: ExerciseBlock; trackColor: string; lessonId: string }) {
  const phoneViewport = usePhoneViewport()
  const prefs = useProgress((s) => s.working['today:prefs'])
  const [forceEmbed, setForceEmbed] = useState(false)
  const mode = forceEmbed ? 'embed' : resolveInlineMode(phoneViewport, prefs)
  const labUrl = labUrlFor(block, lessonId)

  return (
    <section className="my-8 overflow-hidden rounded-lg border border-line bg-surface-1" data-exercise={block.simId} data-inline={mode}>
      <ExerciseHeader block={block} trackColor={trackColor} labUrl={labUrl} />
      <Suspense fallback={<p role="status" className="px-5 py-10 font-mono text-body-sm text-text-3">loading simulator…</p>}>
        <SimHost
          key={mode}
          simId={block.simId}
          machine={block.machine}
          mode={mode}
          config={block.config}
          taskIds={block.taskIds}
          lessonId={lessonId}
          renderNote={(unlocked) =>
            block.note ? (
              <div className="px-5 pb-4">
                <WhatJustHappened md={block.note} trackColor={trackColor} locked={!unlocked} />
              </div>
            ) : null
          }
        />
      </Suspense>
      {mode === 'phone' && (
        <div className="border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={() => setForceEmbed(true)}
            className="inline-flex min-h-11 items-center font-mono text-[11px] text-text-3 transition-colors duration-150 hover:text-accent"
          >
            run the full simulator here instead
          </button>
        </div>
      )}
    </section>
  )
}

export function ExerciseView({
  block,
  trackColor,
  lessonId,
}: {
  block: ExerciseBlock
  trackColor: string
  lessonId: string
}) {
  if (block.taskIds && block.taskIds.length > 0) {
    return <InlineExercise block={block} trackColor={trackColor} lessonId={lessonId} />
  }
  return <ExerciseCard block={block} trackColor={trackColor} lessonId={lessonId} />
}

function ExerciseCard({ block, trackColor, lessonId }: { block: ExerciseBlock; trackColor: string; lessonId: string }) {
  const sim = SIM_INFO[block.simId]
  const Icon = sim?.icon ?? FlaskConical
  const labUrl = labUrlFor(block, lessonId)

  return (
    <section className="my-8 overflow-hidden rounded-lg border border-line bg-surface-1" data-exercise={block.simId}>
      <ExerciseHeader block={block} trackColor={trackColor} labUrl={labUrl} />

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
        {block.note && <WhatJustHappened md={block.note} trackColor={trackColor} />}
      </div>
    </section>
  )
}
