import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { localDateKey } from '@/lib/economy'
import { useProgress } from '@/lib/progress'
import { readSlots } from '@/lib/engine/slots'
import { DAILY_BOXES, DAILY_MINUTES, dailyNumber, dailyRef, engineLine, ownedBoxCount } from '@/lib/world/daily'

/**
 * The Fleet Daily card on Today (docs/specs/wave-2.md §9.7, §2.3): "Fleet Daily #47 · about 8 min". It sits under
 * the done card's result and in the empty state, loaded lazily so /today stays within its 200 KB closure, and it
 * imports only the Daily's pure module, never the engine. Once today's Daily has been played, the card says so and
 * offers a practice replay (replays write nothing).
 *
 * "your engine: N of 3 boxes" joins the line once a scheduler, block manager or intake queue is installed (2b-21): the
 * Daily runs on them. A box counts only when its bytes are on this device, since an import can name a slot without
 * them and the Daily then runs the reference; so the line appears after the ledger engine has been asked for the
 * bytes. The card reads the working record `engine:slots` and the ledger engine, not the Fleet's slots store, so it
 * stays light. The prefix router is not counted: incident clusters route by shortest queue, so it drives nothing.
 */
export interface DailyCardProps {
  /** Where it sits: under the done card's result, or in the empty state. */
  variant: 'done' | 'empty'
}

export default function DailyCard({ variant }: DailyCardProps) {
  // The date is read once per visit: a card left open past midnight offers yesterday's number until Today reloads.
  const [date] = useState(() => localDateKey())
  const played = useProgress((s) => (s.aggregate.incidents[dailyRef(date)]?.n ?? 0) > 0)
  const number = dailyNumber(date)
  /* the hash named in each driving slot, "-" for an empty one: a primitive, so the selector is stable */
  const named = useProgress((s) => {
    const slots = readSlots(s.working['engine:slots'])
    return DAILY_BOXES.map((slot) => slots[slot]?.sha256 ?? '-').join(' ')
  })
  /* the count for the hashes it was read for: a count read for older slots is not shown (and nothing is, until it is read) */
  const [counted, setCounted] = useState<{ named: string; count: number } | null>(null)
  useEffect(() => {
    const hashes = named.split(' ')
    if (hashes.every((h) => h === '-')) return
    let live = true
    useProgress.controls
      .engine()
      .then((engine) =>
        ownedBoxCount(
          Object.fromEntries(DAILY_BOXES.flatMap((slot, i) => (hashes[i] === '-' ? [] : [[slot, { sha256: hashes[i] }]]))),
          (sha256) => engine.componentBytes(sha256),
        ),
      )
      .catch(() => 0)
      .then((count) => live && setCounted({ named, count }))
    return () => {
      live = false
    }
  }, [named])
  const boxes = counted?.named === named ? counted.count : 0
  return (
    <section aria-labelledby={`daily-card-${variant}`} className="rounded-lg border border-line bg-surface-1 p-4" data-daily-card={variant} data-played={played}>
      <p className="font-mono text-[11px] uppercase text-text-3">Fleet Daily</p>
      <h2 id={`daily-card-${variant}`} className="mt-1 font-display text-[17px] text-text-1">
        Fleet Daily #{number} · about {DAILY_MINUTES} min{boxes > 0 ? ` · ${engineLine(boxes)}` : ''}
      </h2>
      <p className="mt-1 text-body-sm text-text-2">
        {played
          ? 'You have played today’s incident. Replay it as practice, or come back tomorrow for a new one.'
          : 'One new incident on a serving fleet, the same one for everybody on your date: read the alert, pick a suspect, probe, fix.'}
      </p>
      <Link
        to="/daily"
        className="mt-3 inline-flex min-h-11 items-center rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground"
      >
        {played ? 'Replay as practice' : 'Play today’s Daily'}
        <span className="sr-only"> (Fleet Daily #{number})</span>
      </Link>
    </section>
  )
}
