import { useId } from 'react'
import { ReceiptText } from '@/components/fleetweek/ReceiptEditor'
import { EXEMPLARS, RUBRIC, RUBRIC_KEYS, RUBRIC_SCORES, exemplarTotal, type ExemplarAct, type RubricDraft } from '@/data/fleetweek/exemplars'

/**
 * Fleet Week's rubric self-review (docs/specs/wave-3.md §10.4). It is formative, so it is never scored: you read three
 * write-ups of one real run, each scored on the four criteria with a reason for every score, then you score your own.
 * The four self-scores go into the act's data, and the grading never reads them.
 */

const LABEL = ['strong', 'middling', 'thin'] as const

export function RubricReview({ act, value, onChange }: { act: ExemplarAct; value: RubricDraft; onChange(next: RubricDraft): void }) {
  const name = useId()
  const chosen = RUBRIC_KEYS.filter((k) => value[k] !== undefined).length
  return (
    <section aria-label="Self-review against scored examples" className="mt-4 rounded-md border border-line bg-ink p-4" data-rubric={act}>
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-1">self-review · never scored</p>
      <p className="mt-1 max-w-2xl text-body-sm text-text-2">
        Read the three examples first: each is a write-up of a real run, scored 0 to 3 on four criteria with a reason for every score. Then score your own analysis on the same four.
        Your scores are kept with the act and have no part in its score or its XP; the executed checks alone decide that.
      </p>

      <div className="mt-3 space-y-2">
        {EXEMPLARS[act].map((e, i) => (
          <details key={e.id} className="rounded-md border border-line bg-surface-1" data-exemplar={e.id}>
            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-body-sm text-text-1">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-text-2">
                Example {i + 1} of 3 · {LABEL[i]}
              </span>
              <span className="font-mono text-[11px] text-accent">{exemplarTotal(e)} of 12</span>
            </summary>
            <div className="border-t border-line px-3 pb-3 pt-2">
              <p className="text-body-sm text-text-2">{e.label}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-body-sm leading-7 text-text-1">
                <ReceiptText text={e.text} />
              </p>
              <ul className="mt-3 space-y-2" aria-label={`Scores for example ${i + 1}`}>
                {RUBRIC.map((c) => (
                  <li key={c.key} className="rounded-md border-l-2 border-line bg-surface-2 px-3 py-2 text-body-sm text-text-2">
                    <span className="font-mono text-[11px] text-text-1">
                      {c.title}: {e.scores[c.key]} of 3
                    </span>
                    <span className="mt-0.5 block">{e.why[c.key]}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {RUBRIC.map((c) => (
          <fieldset key={c.key} className="rounded-md border border-line bg-surface-1 p-3" data-criterion={c.key}>
            <legend className="px-1 font-display text-[15px] text-text-1">
              {c.title} <span className="font-sans text-body-sm text-text-2">· {c.ask}</span>
            </legend>
            <div className="mt-1 space-y-1.5">
              {RUBRIC_SCORES.map((s) => (
                <label
                  key={s}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-2 px-3 py-2 text-body-sm text-text-1 has-[:checked]:border-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-info"
                >
                  <input
                    type="radio"
                    name={`${name}-${c.key}`}
                    value={s}
                    checked={value[c.key] === s}
                    onChange={() => onChange({ ...value, [c.key]: s })}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
                  />
                  <span>
                    <span className="font-mono text-[12px]">{s}</span> {c.levels[s]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3" data-rubric-count>
        {chosen} of 4 scored{chosen === 4 ? ': kept with the act when you submit' : ': kept with the act once all four are scored'}
      </p>
    </section>
  )
}
