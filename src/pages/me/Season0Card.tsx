import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { SEASON0_DAYS, SEASON0_START, season0Dates, season0Outcome, season0Rows, season0State, type Season0Row } from '@/data/season0'
import { localDateKey } from '@/lib/economy'
import { useProgress } from '@/lib/progress'
import type { LedgerEvent } from '@/lib/ledger/types'

/**
 * /me, Season 0 (wave-3.md §16.7, task 3s-09): the seven dated Dailies and what you did on each, read from this
 * browser's ledger. Nothing is fetched and nothing is ranked: the share strings are the Daily's own, recomputed from the
 * `incident` events (`season0Rows`), listed so you can copy one and send it to a person yourself. The card holds
 * what sits below it back until it has read the ledger (`onSettled`, as the Mirror does), so it grows into empty space.
 * No framer-motion, no lesson content.
 */

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: Season0Row[] }

const readIncidents = async (): Promise<LedgerEvent[]> => {
  const { getLedgerClient } = await import('@/lib/ledger/client')
  return (await getLedgerClient()).events({ kinds: ['incident'], refPrefix: 'inc:daily/' })
}

/** The rows from the ledger, read again when the aggregate changes. `read` replaces the ledger read (tests) and must be stable. */
function useRows(read: () => Promise<readonly LedgerEvent[]>): { state: Load; retry: () => void } {
  const events = useProgress((s) => s.aggregate.events)
  const [state, setState] = useState<Load>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    read().then(
      (all) => live && setState({ status: 'ready', rows: season0Rows(all) }),
      () => live && setState({ status: 'error' }),
    )
    return () => {
      live = false
    }
  }, [attempt, events, read])
  return {
    state,
    retry: () => {
      setState({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}

const STATE_LABEL = { played: 'Played', open: 'Open today', missed: 'Not played', upcoming: 'Not open yet' } as const

/** The seven days as a list; `today` is passed in, so the list is a function of its props. */
export function Season0List({ rows, today }: { rows: readonly Season0Row[]; today: string }) {
  return (
    <ol className="mt-4 divide-y divide-line" data-season0-list>
      {rows.map((row) => {
        const state = season0State(row, today)
        return (
          <li key={row.date} className="py-3 first:pt-0 last:pb-0" data-season0-row={row.day} data-state={state}>
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-body text-text-1">Day {row.day}</span>
              <span className="font-mono text-[12px] text-text-3">{row.date}</span>
              <span className="text-body-sm text-text-2">{STATE_LABEL[state]}</span>
            </p>
            {row.result && (
              <>
                <p className="mt-1 text-body-sm text-text-2">{season0Outcome(row.result)}</p>
                <p className="mt-2 select-all break-words rounded-md border border-line bg-ink p-3 font-mono text-[13px] text-text-1" data-season0-share>
                  {row.result.share}
                </p>
              </>
            )}
            {state === 'open' && (
              <Link to="/daily" className="inline-flex min-h-11 items-center text-body-sm text-info underline underline-offset-2">
                Play today&rsquo;s Daily
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export interface Season0CardProps {
  onSettled?: () => void
  /** replaces the ledger read, for tests; must be a stable function */
  read?: () => Promise<readonly LedgerEvent[]>
  /** replaces the clock, for tests */
  today?: string
}

export default function Season0Card({ onSettled, read = readIncidents, today = localDateKey() }: Season0CardProps) {
  const { state, retry } = useRows(read)
  const settled = state.status !== 'loading'
  useEffect(() => {
    if (settled) onSettled?.()
  }, [settled, onSettled])

  const dates = season0Dates()
  return (
    <section aria-labelledby="season0-heading" className="mt-14 rounded-lg border border-line bg-surface-1 p-6" data-season0-card>
      <h2 id="season0-heading" className="font-display text-h3 text-text-1">
        Season 0
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        The Dailies of {SEASON0_DAYS} days in a row, {SEASON0_START} to {dates[dates.length - 1]}. This is your own record, read from this browser: there is no
        board, and nothing here leaves your device unless you copy a string and send it yourself.
      </p>
      {state.status === 'loading' && (
        <p role="status" className="mt-4 h-6 font-mono text-body-sm leading-6 text-text-3">
          Reading your ledger…
        </p>
      )}
      {state.status === 'error' && (
        <div role="alert" className="mt-4">
          <p className="text-body-sm text-text-2">Could not read your ledger, so Season 0 has nothing to show yet.</p>
          <button type="button" onClick={retry} className="mt-2 min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright">
            Try again
          </button>
        </div>
      )}
      {state.status === 'ready' && <Season0List rows={state.rows} today={today} />}
    </section>
  )
}
