import { Link } from 'react-router'
import { motion } from 'framer-motion'
import type { TrackMeta } from '@/lib/tracks'
import { useProgress, selectTrackDone } from '@/lib/progress'
import { cn } from '@/lib/utils'

interface TrackCardProps {
  track: TrackMeta
  className?: string
}

/**
 * TrackCard (design.md §9.5) — surface-1 card with a 3px track-color bar on
 * the left edge (like a memory segment label). Hover: y -4, border brightens,
 * glyph rotates 6° with spring. Click → /tracks/:id.
 */
export default function TrackCard({ track, className }: TrackCardProps) {
  const done = useProgress(selectTrackDone(track.id))
  const pct = track.lessons > 0 ? Math.round((done / track.lessons) * 100) : 0
  const state = done === 0 ? 'not started' : done >= track.lessons ? 'done' : 'in progress'
  const Icon = track.glyph

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={cn('h-full', className)}
    >
      <Link
        to={track.id === 'capstone' ? '/capstone' : `/tracks/${track.id}`}
        className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface-1 p-6 pl-7 transition-colors duration-180 hover:border-line-bright hover:shadow-[0_12px_32px_rgba(0,0,0,.4)]"
      >
        {/* memory-segment edge bar */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ backgroundColor: track.color }}
        />

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-medium" style={{ color: track.color }}>
              {track.code}
            </span>
            <motion.span
              className="text-text-3 transition-colors duration-150 group-hover:text-text-1"
              whileHover={{ rotate: 6 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            >
              <Icon size={20} strokeWidth={1.75} style={{ color: track.color }} />
            </motion.span>
          </div>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide',
              state === 'done'
                ? 'border-accent/40 bg-accent-dim text-accent'
                : state === 'in progress'
                  ? 'border-amber/40 bg-amber/10 text-amber'
                  : 'border-line text-text-3',
            )}
          >
            {state === 'done' ? `done ${done}/${track.lessons}` : state}
          </span>
        </div>

        <h3 className="mt-4 font-display text-h4 text-text-1">{track.name}</h3>
        <p className="mt-1.5 text-body-sm text-text-2">{track.promise}</p>

        <p className="mt-4 font-mono text-[11px] text-text-3">
          {track.lessons} lessons · {track.exercises} exercises · ~{track.hours}h
        </p>

        {/* progress bar — animates width when scrolled into view */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            initial={{ width: 0 }}
            whileInView={{ width: `${pct}%` }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="h-full rounded-full"
            style={{ backgroundColor: track.color }}
          />
        </div>
      </Link>
    </motion.div>
  )
}
