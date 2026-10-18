import type { ShiftNote } from '@/lib/world/shift'

/**
 * A handoff note or the shift summary: a heading and a line each. It says it is not saved, because it is not: it is
 * computed from the debrief on screen and lives in the page's memory (world/shift). `carried` is the note read again
 * while the next incident plays, folded away so it does not push the alert down a 360 px screen.
 */
export default function NoteCard({ note, carried = false, summary = false }: { note: ShiftNote; carried?: boolean; summary?: boolean }) {
  const lines = (
    <>
      <ul className="mt-2 space-y-1 text-body-sm text-text-2">
        {note.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-text-3">This is shown here only. It is not saved, and it is gone when you leave the page.</p>
    </>
  )
  if (carried) {
    return (
      <details className="rounded-lg border border-line bg-surface-1 p-4" data-handoff="carried">
        <summary className="min-h-11 cursor-pointer font-display text-[16px] text-text-1">{note.heading}</summary>
        {lines}
      </details>
    )
  }
  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" aria-label={note.heading} data-handoff={summary ? 'summary' : 'next'}>
      <h3 className="font-display text-[16px] text-text-1">{note.heading}</h3>
      {lines}
    </section>
  )
}
