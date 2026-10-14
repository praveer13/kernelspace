import { useState } from 'react'
import { COMPETENCE_MIN_DAYS, COMPETENCE_MIN_ITEMS, COMPETENCE_MIN_RIGHT, COMPETENCE_WINDOW, type CompetenceStatement } from '@/lib/learner/competence'
import { plural } from '@/lib/learner/mirror'

/**
 * /me, competence statements (wave-3.md §12.4, §12.5): the "You can …" line of an idea you have shown on new numbers,
 * with the evidence beside it. Informational, never a badge: plain text, no icon, no count of lines earned. A line
 * needs 6 credited fresh items over 2 days with 5 of the last 6 right, and no form item counts (D34). No framer-motion;
 * no lesson content.
 */

/** Statements shown before "Show all". */
const SHOWN = 6

export default function Competence({ statements, unmet }: { statements: readonly CompetenceStatement[]; unmet: number }) {
  const [all, setAll] = useState(false)
  const shown = all ? statements : statements.slice(0, SHOWN)
  return (
    <section aria-labelledby="mirror-competence-heading" className="rounded-lg border border-line bg-surface-1 p-6" data-mirror="competence">
      <h2 id="mirror-competence-heading" className="font-display text-h3 text-text-1">
        What you have shown
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        A line appears when an idea has {COMPETENCE_MIN_ITEMS} full-credit answers on new numbers, on at least {COMPETENCE_MIN_DAYS} different days, with{' '}
        {COMPETENCE_MIN_RIGHT} of the last {COMPETENCE_WINDOW} right. It is a record of what happened, not a grade.
      </p>

      {statements.length === 0 ? (
        <p className="mt-4 text-body-sm text-text-2" data-figure="competence" data-n={unmet} data-enough={false}>
          Not enough data yet (n = {plural(unmet, 'idea')} with new-number answers). Today&apos;s generated questions and Prove-it build this up.
        </p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-line" data-figure="competence" data-n={statements.length} data-enough>
            {shown.map((s) => (
              <li key={s.kc} className="py-3 first:pt-0 last:pb-0" data-competence={s.kc}>
                <p className="text-body text-text-1">{s.text}</p>
                <p className="font-mono text-[12px] text-text-3">
                  n = {s.n} answers on new numbers · {plural(s.days, 'day')} · last {s.last}
                </p>
              </li>
            ))}
          </ul>
          {statements.length > SHOWN && (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll((v) => !v)}
              className="mt-2 inline-flex min-h-11 items-center text-body-sm text-text-2 underline underline-offset-2 hover:text-accent"
            >
              {all ? `Show the first ${SHOWN}` : `Show all ${statements.length}`}
            </button>
          )}
          {unmet > 0 && <p className="mt-2 text-body-sm text-text-3">{plural(unmet, 'more idea')} with new-number answers have not reached the bar yet.</p>}
        </>
      )}

      <details className="mt-4 text-body-sm text-text-2">
        <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-2 hover:text-accent">What counts</summary>
        <p className="max-w-[60ch] pb-2">
          Full credit is an answer on a seed you had not met (Today and cold-check questions) or a Prove-it prediction that your own module confirmed.
          Authored quiz questions, lab greens and answers after a hint count for less and are left out here. Track forms are measurement and count for
          nothing here, so taking a form never changes what this page says you can do.
        </p>
      </details>
    </section>
  )
}
