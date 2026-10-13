import { Check } from 'lucide-react'
import { Link } from 'react-router'
import { cn } from '@/lib/utils'
import type { RingRow, RingSection } from './ring-rows'

/** One line of a ring's checklist: what is done of what, and where to go to do more. */
function CheckRow({ row }: { row: RingRow }) {
  const { done, label, count, to, action } = row
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border',
          done ? 'border-accent bg-accent text-accent-foreground' : 'border-line-bright',
        )}
      >
        {done && <Check size={11} strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1 text-body-sm text-text-1">
        {label} <span className="font-mono text-[12px] text-text-2">{count}</span>
        <span className="sr-only">{done ? ', done' : ', not done'}</span>
      </span>
      <Link
        to={to}
        className="inline-flex min-h-11 shrink-0 items-center font-mono text-[12px] text-text-2 underline underline-offset-2 hover:text-accent"
      >
        {action}
        <span className="sr-only"> {label}</span>
      </Link>
    </li>
  )
}

/**
 * Each ring's checklist in a native disclosure, so the keyboard path is Tab to the ring, Enter to open it and
 * Tab through its links. The first ring that is not yet earned starts open; the rest stay shut until asked.
 */
export default function RingChecklists({ sections }: { sections: RingSection[] }) {
  const first = sections.find((s) => !s.earned)?.ring
  return (
    <div className="mt-5 space-y-2" data-ring-checklists>
      {sections.map((s) => {
        const done = s.rows.filter((r) => r.done).length
        return (
          <details key={s.ring} open={s.ring === first} data-ring-checklist={s.ring} className="group rounded-md border border-line">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 font-mono text-[11px] uppercase tracking-[0.10em] text-text-3 hover:text-text-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
              <span>
                {s.ring} {s.earned ? 'earned' : 'checklist'}
              </span>
              <span className="text-text-2">
                {done}/{s.rows.length} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
              </span>
            </summary>
            <ul className="space-y-0.5 px-3 pb-2">
              {s.rows.map((r) => (
                <CheckRow key={r.key} row={r} />
              ))}
            </ul>
          </details>
        )
      })}
    </div>
  )
}
