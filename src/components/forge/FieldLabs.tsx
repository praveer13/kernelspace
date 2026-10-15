/* eslint-disable react-refresh/only-export-components -- the lab list and the number formatting are exported beside the
   component so the test checks exactly what the page prints */
/**
 * "Field labs" on /forge (docs/specs/wave-3.md §16.5, task 3s-07): two optional runs on a GPU the learner owns or rents.
 * Each lab shows its pinned commands (claims, with the release they were read at and "stale since" past their TTL),
 * the prediction worked from the claims Boot uses, and what the budget costs at the dated H100 price. The numbers the
 * learner reads off the run are checked against the prediction and written to the ledger as
 * `item:field.<lab>.<metric>` (src `practice`, provenance `field`: no credit, and a donation drops the value).
 *
 * Nothing here talks to a network: the commands are text to copy, the links open the sources the claims cite, and a
 * reading goes to the browser's own ledger. The page is loaded lazily by /forge, with the two lab modules and the
 * `field` claim group behind it, so no other route pays for any of it.
 */
import { useId, useState } from 'react'
import { Link } from 'react-router'
import { ClaimValue } from '@/components/ClaimValue'
import { formatClaimValue, getClaim, staleSince } from '@/data/claims'
import burstgptReplay from '@/data/field-labs/burstgpt-replay'
import decodeKv from '@/data/field-labs/decode-kv'
import {
  PRICE_CLAIM,
  costCents,
  dollars,
  fieldRef,
  fieldResponse,
  parseReading,
  predictedRow,
  verdictFor,
  type DerivedRow,
  type FieldLab,
  type FieldMetric,
  type FieldStep,
  type Verdict,
} from '@/data/field-labs/types'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'

/** The labs, in the order of the lessons they follow. */
export const FIELD_LABS: readonly FieldLab[] = [decodeKv, burstgptReplay]

/* an inline claim chip in a sentence: its hit area grows toward 44 px with an invisible pad, as Boot's chips do */
const CHIP_PAD = 'relative after:absolute after:-inset-y-3.5 after:inset-x-0 after:content-[""]'

const BUTTON = 'min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright'

/** "208.6", "15,321", "104.2", "0.21": enough digits to check by hand against what the tool prints, no more. */
export function showNumber(v: number): string {
  if (v >= 1000) return Math.round(v).toLocaleString('en-US')
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

/** A row's value as the page prints it: "≈209 tok/s". */
export const showRow = (r: DerivedRow): string => `≈${showNumber(r.value)} ${r.unit}`

export default function FieldLabs() {
  const lessons = useProgress((s) => s.lessons)
  return (
    <section aria-labelledby="field-labs-h" className="mt-16" data-field-labs>
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-3">Field labs · optional · your own GPU</p>
      <div className="mt-2 max-w-2xl">
        <h2 id="field-labs-h" className="font-display text-h3 text-text-1">
          Check the paper against a real server
        </h2>
        <p className="mt-2 text-body-sm text-text-2">
          Two runs on a GPU you own or rent, each inside {FIELD_LABS[0].gpuHours} GPU-hours. You predict first, from numbers the course already
          sourced; then you run pinned vLLM commands and type in what they print. Your numbers are saved in this browser only, count for no
          credit, and are left out of anything you donate.
        </p>
      </div>
      <div className="mt-5 space-y-6">
        {FIELD_LABS.map((lab) => (
          <LabCard key={lab.id} lab={lab} read={lessons[lab.after.lesson]?.status === 'done'} />
        ))}
      </div>
    </section>
  )
}

function LabCard({ lab, read }: { lab: FieldLab; read: boolean }) {
  const uid = useId()
  const cents = costCents(lab.gpuHours)
  const price = getClaim(PRICE_CLAIM)
  return (
    <article aria-labelledby={`${uid}-h`} className="rounded-lg border border-line bg-surface-1 p-5" data-field-lab={lab.id}>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-text-3">
        <span className="rounded border border-line px-1.5 py-0.5 uppercase tracking-wide">after {lab.after.lesson}</span>
        <Link to={`/lesson/${lab.after.lesson}`} className="inline-flex min-h-11 items-center text-info underline underline-offset-2">
          {lab.after.title}
        </Link>
        <span className={read ? 'text-accent' : undefined} data-lesson-state>
          {read ? 'finished' : 'not finished; nothing is locked'}
        </span>
      </div>
      <h3 id={`${uid}-h`} className="mt-1 font-display text-body-lg font-medium text-text-1">
        {lab.title}
      </h3>
      <p className="mt-2 max-w-2xl text-body-sm text-text-2">{lab.blurb}</p>

      {lab.ranBy === null && (
        <p className="mt-3 rounded-md border border-amber/35 bg-amber/5 px-3 py-2 text-body-sm text-text-2" data-unrun>
          <span className="text-amber">Not run on a GPU yet.</span> The commands are pinned to a release and each flag was looked up in that release&apos;s
          source, but nobody at the course has run them end to end. If one fails, the pinned release is the first suspect; the owner signs the
          commands off after running each once.
        </p>
      )}

      <div className="mt-4 rounded-md border border-line bg-surface-2 p-4" data-budget>
        <h4 className="section-label">What it costs</h4>
        <p className="mt-2 text-body-sm text-text-2">
          At most {lab.gpuHours} GPU-hours × <ClaimValue id={PRICE_CLAIM} format={(c) => `$${c.value}/GPU-hr`} className={`font-mono text-text-1 ${CHIP_PAD}`} /> ={' '}
          <span className="font-mono text-text-1" data-cost>
            {dollars(cents)}
          </span>{' '}
          <span className="font-mono text-[11px] text-amber">[derived]</span>
        </p>
        <p className="mt-1 font-mono text-[11px] text-text-3">
          hours × the median on-demand price ({price.verifiedAt}). A rented GPU bills until you stop it, so stop it when the last command is done.
        </p>
      </div>

      <div className="mt-4" data-prediction>
        <h4 className="section-label">Your prediction, before you run anything</h4>
        <dl className="mt-2 divide-y divide-line rounded-md border border-line">
          {lab.rows.map((row) => (
            <PredictionRow key={row.id} row={row} headline={lab.metrics.some((m) => m.predicted === row.id)} />
          ))}
        </dl>
      </div>

      <div className="mt-4" data-steps>
        <h4 className="section-label">The commands</h4>
        <ol className="mt-2 space-y-3">
          {lab.steps.map((step, i) => (
            <Step key={step.id} step={step} n={i + 1} />
          ))}
        </ol>
      </div>

      <div className="mt-4" data-readings>
        <h4 className="section-label">What you measured</h4>
        <div className="mt-2 space-y-3">
          {lab.metrics.map((metric) => (
            <Reading key={metric.id} lab={lab} metric={metric} />
          ))}
        </div>
      </div>

      <div className="mt-4 text-body-sm text-text-2" data-limits>
        <h4 className="section-label">What this does not measure</h4>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          {lab.limits.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </article>
  )
}

function PredictionRow({ row, headline }: { row: DerivedRow; headline: boolean }) {
  return (
    <div className={cn('px-3 py-2.5', headline && 'bg-surface-2')} data-row={row.id} data-headline={headline ? '' : undefined}>
      <dt className="text-body-sm text-text-1">{row.label}</dt>
      <dd className="mt-0.5">
        <span className={cn('font-mono text-body-sm', headline ? 'text-accent' : 'text-text-1')}>{showRow(row)}</span>{' '}
        <span className="font-mono text-[11px] text-amber">[derived]</span>
        <span className="mt-1 block font-mono text-[11px] leading-relaxed text-text-3">
          {row.formula}
          {row.scenario ? ` · ${row.scenario}` : ''}
        </span>
        <details className="mt-0.5" data-from>
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-mono text-[11px] text-info underline underline-offset-2">
            from {row.from.length} claim{row.from.length === 1 ? '' : 's'}
          </summary>
          <ul className="border-l border-line pl-2">
            {row.from.map((id) => (
              <li key={id}>
                <ClaimValue
                  id={id}
                  format={(c) => `${c.label}: ${formatClaimValue(c)}`}
                  className="inline-flex min-h-11 items-center text-left font-mono text-[11px] leading-snug text-text-2"
                />
              </li>
            ))}
          </ul>
        </details>
      </dd>
    </div>
  )
}

function Step({ step, n }: { step: FieldStep; n: number }) {
  const claim = getClaim(step.claim)
  const reads = step.reads ? getClaim(step.reads) : null
  const stale = staleSince(claim)
  const pin = claim.pin
  return (
    <li className="rounded-md border border-line bg-surface-2 p-4" data-step={step.id} data-claim={claim.id}>
      <p className="text-body-sm text-text-1">
        <span className="mr-2 font-mono text-[11px] text-text-3">{n}</span>
        {step.title}
      </p>
      <pre
        className="mt-2 whitespace-pre-wrap rounded-sm border border-line bg-ink p-3 font-mono text-[12px] leading-relaxed text-text-1 [overflow-wrap:anywhere] select-all"
        data-command
      >
        {formatClaimValue(claim)}
      </pre>
      <div className="mt-1 flex flex-wrap items-center gap-x-3">
        <CopyButton text={formatClaimValue(claim)} />
        <p className="font-mono text-[11px] text-text-3">
          {pin ? <span data-pin>pinned at {pin.repo}@{pin.ref}</span> : null} · checked {claim.verifiedAt}
          {stale !== null && (
            <>
              {' '}
              ·{' '}
              <span className="text-amber" data-stale>
                stale since {stale}
              </span>
            </>
          )}{' '}
          ·{' '}
          {claim.source && (
            <a href={claim.source.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-info underline underline-offset-2">
              source<span className="sr-only"> for {claim.label} at {pin?.ref} (opens in a new tab)</span>
            </a>
          )}
        </p>
      </div>
      {stale !== null && (
        <p className="mt-1 text-body-sm text-text-2" data-stale-note>
          Nobody has re-read this command since {claim.verifiedAt}, and a pinned command is good for {claim.ttlDays} days. Newer releases may have changed a flag or an output
          line.
        </p>
      )}
      {step.note && <p className="mt-2 text-body-sm text-text-2">{step.note}</p>}
      {reads && (
        <p className="mt-1 text-body-sm text-text-2" data-reads={reads.id}>
          Read: <span className="font-mono text-[13px] text-text-1">{reads.value}</span>{' '}
          <ClaimValue id={reads.id} format={() => 'its source'} className={`font-mono text-[11px] text-info ${CHIP_PAD}`} />
        </p>
      )}
    </li>
  )
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      // no clipboard (an insecure origin, a denied permission): the command is selectable text
      setState('failed')
    }
  }
  return (
    <>
      <button type="button" onClick={copy} className={BUTTON}>
        {state === 'copied' ? 'Copied' : 'Copy command'}
      </button>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Command copied.' : state === 'failed' ? 'Could not copy. Select the command and copy it by hand.' : ''}
      </span>
    </>
  )
}

interface Recorded {
  typed: number
  recorded: number
  verdict: Verdict
}

function Reading({ lab, metric }: { lab: FieldLab; metric: FieldMetric }) {
  const uid = useId()
  const recordItems = useProgress((s) => s.recordItems)
  const [text, setText] = useState('')
  const [result, setResult] = useState<Recorded | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const row = predictedRow(lab, metric)
  const ref = fieldRef(lab.id, metric.id)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const typed = parseReading(text)
    if (typed === null) {
      setResult(null)
      setProblem(`Type the number the tool printed, above zero, such as 12.5. "${text.trim()}" is not one.`)
      return
    }
    const recorded = metric.entry.toValue(typed)
    try {
      recordItems([fieldResponse(lab, metric, typed)])
      setProblem(null)
      setResult({ typed, recorded, verdict: verdictFor(metric, recorded, row.value) })
    } catch {
      setResult(null)
      setProblem('This browser could not save the reading (the ledger is read-only here), so nothing was recorded.')
    }
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-line bg-surface-2 p-4" data-reading={metric.id} noValidate>
      <label htmlFor={`${uid}-in`} className="block text-body-sm text-text-1">
        {metric.entry.label} ({metric.entry.unit})
      </label>
      <p id={`${uid}-hint`} className="mt-0.5 text-body-sm text-text-3">
        From {metric.entry.hint}. Predicted: <span className="font-mono text-accent">{showRow(row)}</span>
        {metric.entry.conversion ? <span>, as {metric.entry.conversion}</span> : null}.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id={`${uid}-in`}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setResult(null)
            setProblem(null)
          }}
          aria-describedby={`${uid}-hint`}
          aria-invalid={problem !== null && result === null ? true : undefined}
          className="min-h-11 w-40 rounded-md border border-line bg-ink px-3 font-mono text-body-sm text-text-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        />
        <button type="submit" className={BUTTON}>
          Record this reading
        </button>
      </div>
      <div role="status" aria-live="polite" className="mt-2 text-body-sm" data-verdict-region>
        {problem && <p className="text-amber">{problem}</p>}
        {result && (
          <>
            <p className="text-text-1" data-verdict={result.verdict.band}>
              {metric.entry.conversion ? `${result.typed} ${metric.entry.unit} is ${showNumber(result.recorded)} ${metric.unit}. ` : ''}
              {result.verdict.text}
            </p>
            <p className="mt-1 font-mono text-[11px] text-text-3" data-recorded>
              Saved on this device as {ref} · provenance field · no credit · left out of any donation.
            </p>
          </>
        )}
      </div>
    </form>
  )
}
