import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IncidentClientSession } from '@/lib/fleet-session'
import {
  BURN_BUDGET,
  CATEGORY_LABELS,
  FAULT_LABELS,
  FIXES,
  LIMIT_MINUTES,
  PROBES,
  burnPercent,
  fixFor,
  type Hypothesis,
} from '@/lib/world/incident-spec'
import {
  KC_NAMES,
  boxLines,
  burnMinutes,
  engineNote,
  kcsFor,
  sinceAlert,
  sourceTitle,
  streetlightOf,
  type DailyBox,
  type FlowRun,
  type FlowState,
  type IncidentSource,
} from '@/lib/world/daily'
import type { IncidentFinish } from '@/workers/fleet-protocol'

export interface DebriefProps {
  session: Pick<IncidentClientSession, 'finish'>
  source: IncidentSource
  /** the flow's state at the end: its log names the probes the learner took, in order */
  flow: Pick<FlowState, 'log' | 'alert'>
  busy: boolean
  run: FlowRun
  /**
   * The four boxes the incident ran on, whose they were (docs/specs/wave-2.md §9.7, 2b-21). Left out (Act IV's
   * drills, which run on reference components) the debrief says nothing about the engine.
   */
  boxes?: readonly DailyBox[]
  /** Called once with the scored incident, so the page can record it. Keep it stable (useCallback). */
  onResult: (result: IncidentFinish) => void
  /** Rendered under the debrief once the result is in (the share string, replay and back links). */
  children?: (result: IncidentFinish) => ReactNode
}

const hypothesisLabel = (h: Hypothesis | undefined): string => (h === undefined ? 'no hypothesis' : h === 'unsure' ? 'unsure' : `"${FAULT_LABELS[h]}"`)

/**
 * Steps 5 and 6 of the flow (docs/specs/wave-2.md §9.7): the replay and the debrief. The replay is `finish`: the
 * clock runs on to recovery or the limit, and the expert plays the same incident on the same modules, so a slower
 * module costs both sides the same (W11). Then it shows your burn against the expert's, each Streetlight probe
 * you took, the expert's probe order with one line per step, and the KCs the incident trains.
 */
export default function Debrief({ session, source, flow, busy, run, boxes, onResult, children }: DebriefProps) {
  const [result, setResult] = useState<IncidentFinish | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    let live = true
    void run(() => session.finish()).then((r) => {
      if (!live || !r) return
      setResult(r)
      onResult(r)
    })
    return () => {
      live = false
    }
  }, [session, run, onResult])
  useEffect(() => {
    if (result) heading.current?.focus()
  }, [result])

  if (!result) {
    return (
      <section className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" data-flow="debrief" data-debrief="pending" aria-busy={busy}>
        <h2 className="font-display text-h3 text-text-1">Replaying to the end</h2>
        <p role="status" className="mt-2 text-body-sm text-text-2">
          Running the clock on to recovery, then the expert plays the same incident…
        </p>
      </section>
    )
  }

  const probes = flow.log.flatMap((e) => (e.kind === 'probe' ? [e] : []))
  const flags = streetlightOf(flow)
  const percent = burnPercent(result.burn)
  const fixLine = result.fix ? FIXES[result.fix].label : null
  const expertFix = FIXES[fixFor(result.expert.named)].label
  return (
    <section className="space-y-4" data-flow="debrief" data-debrief="done" aria-labelledby="debrief-heading">
      <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <h2 id="debrief-heading" ref={heading} tabIndex={-1} className="font-display text-h3 text-text-1 outline-none">
          Debrief: {sourceTitle(source)}
        </h2>
        <p className="mt-2 text-body text-text-1" data-verdict>
          {result.recovered
            ? `You recovered the fleet with ${burnMinutes(result.burn)} burn-minutes (${percent}% of the ${BURN_BUDGET}-minute budget); the expert's ${burnMinutes(result.expertBurn)}.`
            : `The incident ran to the ${LIMIT_MINUTES}-minute limit without the right fix: ${burnMinutes(result.burn)} burn-minutes (${percent}% of the ${BURN_BUDGET}-minute budget); the expert's ${burnMinutes(result.expertBurn)}.`}
        </p>
        <ul className="mt-3 space-y-1 text-body-sm text-text-2">
          <li>
            The fault was &ldquo;{FAULT_LABELS[result.fault]}&rdquo;.{' '}
            {result.diagnosed ? 'You named it.' : `You held ${hypothesisLabel(result.hypothesis)}.`}
            {result.firstHypothesis !== undefined && result.firstHypothesis !== result.hypothesis && ` You started with ${hypothesisLabel(result.firstHypothesis)}.`}
          </li>
          <li>{fixLine ? `The last fix you applied: ${fixLine}${result.fixed ? ', which was right.' : ', which was not the fix for this fault.'}` : 'You applied no fix.'}</li>
        </ul>
      </div>

      <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <h3 className="font-display text-[16px] text-text-1">Your probes</h3>
        {probes.length === 0 ? (
          <p className="mt-1 text-body-sm text-text-2">You took no probes.</p>
        ) : (
          <ol className="mt-2 space-y-2 text-body-sm text-text-2" data-your-probes>
            {probes.map((p, i) => (
              <li key={`${p.probe}-${p.minute}-${i}`} data-streetlight={flags[i] ? 'yes' : 'no'}>
                <span className="text-text-1">
                  {PROBES[p.probe].label} at {sinceAlert(p.minute, flow.alert)}
                </span>
                : {CATEGORY_LABELS[p.category]}.
                {flags[i] && (
                  <span className="text-amber">
                    {' '}
                    Streetlight: every suspect still standing predicted the same reading here, so it could not tell them apart.
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
        {result.streetlight > 0 && (
          <p className="mt-2 text-[12px] text-text-3">The streetlight effect (Gregg&rsquo;s anti-method) is looking where it is easy rather than where the evidence points.</p>
        )}
      </div>

      <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5">
        <h3 className="font-display text-[16px] text-text-1">The expert&rsquo;s order</h3>
        <ol className="mt-2 space-y-2 text-body-sm text-text-2" data-expert-steps>
          {result.expert.steps.map((s, i) => (
            <li key={`${s.probe}-${i}`}>
              <span className="text-text-1">{PROBES[s.probe].label}</span> ({PROBES[s.probe].cost} min): {CATEGORY_LABELS[s.category]}.{' '}
              {s.candidates.length === 1
                ? `Only "${FAULT_LABELS[s.candidates[0]]}" fits.`
                : `${s.candidates.length} suspects left: ${s.candidates.map((c) => FAULT_LABELS[c]).join('; ')}.`}
            </li>
          ))}
          <li>
            Then it applied &ldquo;{expertFix}&rdquo;, the fix for &ldquo;{FAULT_LABELS[result.expert.named]}&rdquo;.
          </li>
        </ol>
        <p className="mt-2 text-[12px] text-text-3">The expert probes in USE order down the pipeline and skips any probe that cannot split the suspects.</p>
      </div>

      {boxes && (
        <div className="rounded-lg border border-line bg-surface-1 p-4 sm:p-5" data-engine={boxes.some((b) => b.own) ? 'yours' : 'reference'}>
          <h3 className="font-display text-[16px] text-text-1">Your engine</h3>
          <p className="mt-2 text-body-sm text-text-2" data-engine-note>
            {engineNote(boxes)}
          </p>
          <ul className="mt-2 space-y-1 text-body-sm text-text-2" aria-label="Which boxes were yours" data-boxes>
            {boxes.map((b, i) => (
              <li key={b.slot} data-box={b.slot} data-own={b.own ? 'yes' : 'no'}>
                {boxLines(boxes)[i]}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-body-sm text-text-2" data-kcs>
        This incident trains: {kcsFor(result.fault).map((k) => KC_NAMES[k] ?? k).join(' · ')}.
      </p>
      {children?.(result)}
    </section>
  )
}
