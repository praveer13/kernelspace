import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Gen, PlayableItem } from '@/lib/items/types'
import type { Kc } from '@/lib/kc/types'
import { ensureExpSeed, readExpSeed } from '@/lib/learner/experiments'
import {
  C_AFTER_B_DAYS,
  FORM_SLOTS,
  formItemResponse,
  formResults,
  formWindows,
  formsFor,
  tallyForms,
  trackShape,
  type Difference,
  type FormId,
  type FormWindow,
  type LessonMarks,
  type TrackForms,
  type TrackLesson,
  type TrackShape,
} from '@/lib/learner/forms'
import { pct, proportionText } from '@/lib/learner/mirror'
import { instanceKey, seenInstances } from '@/lib/learner/today'
import { dayOf } from '@/lib/ledger/time'
import type { ItemResponse, LedgerEvent, LocalDay } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { TRACKS, getTrack } from '@/lib/tracks'

/**
 * /me, the track forms (wave-3.md §12.6, task 3b-19): three parallel 12-question forms per track, A before the track's
 * first lesson, B after its spiral checkpoint, C at least 30 days after B. Opt-in and measurement only: a form is offered
 * while it is open and never gates a lesson, a card or anything else; its answers pay XP like any item and never
 * reschedule a card, count for VRK₃₀ or earn a line above (W18, D34).
 *
 * The card is closed until the learner opens it. Opening loads the KC graph, the lessons and the generator families, and
 * draws every track's three forms inside `settle()` (formsFor), as Today's start flow does, because the compile family's
 * bank loads in groups on demand. It shows k of 12 per form with its Wilson 95 % interval, B − A labelled "including the
 * pretest effect", and C beside B. Every figure states its n. No framer-motion; no lesson content in the static closure
 * (the lessons load when the card opens); the question player is a lazy chunk of its own.
 */

const ItemCard = lazy(() => import('@/components/items/ItemCard'))

/** What the card needs of the content: loaded when it opens. */
export interface FormsContent {
  kcs: readonly Kc[]
  gens: ReadonlyMap<string, Gen>
  lessons: readonly TrackLesson[]
}

/** What the card reads: the content, the ledger, the lesson marks, the day and the learner's `exp:seed` (undefined until made). */
export interface FormsData {
  content: FormsContent
  events: readonly LedgerEvent[]
  marks: LessonMarks
  now: LocalDay
  expSeed: number | undefined
}

/** The content the card draws from, as Today and the Mirror load it: the KC graph, the lessons in curriculum order and every generator family. */
async function loadFormsContent(): Promise<FormsContent> {
  const { loadTodayContent } = await import('@/lib/learner/today')
  const { kcs, lessons, gens } = await loadTodayContent()
  return { kcs, lessons, gens }
}

const localDay = (): LocalDay => {
  const at = new Date()
  return dayOf(at.toISOString(), -at.getTimezoneOffset())
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** A signed whole number of points: "+33", "−5" (a real minus sign), "0". */
const points = (x: number): string => {
  const n = Math.round(x * 100)
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0'
}

const differenceText = (d: Difference): string => `${points(d.diff)} points (95 % interval ${points(d.lo)} to ${points(d.hi)})`

const trackLabel = (id: string): string => {
  const t = getTrack(id)
  return t ? `${t.code} · ${t.name}` : id.toUpperCase()
}

type Drawn = { status: 'loading' } | { status: 'error' } | { status: 'ready'; plans: Record<string, TrackForms | null> }

/* ------------------------------------------------------------------ */
/* One form's state, in words                                          */
/* ------------------------------------------------------------------ */

function stateLine(w: FormWindow, shape: TrackShape): string {
  const { id, tally } = w
  if (w.state === 'taken') return 'Done.'
  const partial = tally.answered > 0 ? ` ${tally.answered} of ${FORM_SLOTS} answered so far.` : ''
  switch (w.why) {
    case 'pretest':
      return `Open: a pretest, ${FORM_SLOTS} questions before your first lesson in this track is done.${partial}`
    case 'lesson-done':
      return `Closed: a lesson in this track is done, so this is no longer a pretest.${tally.answered > 0 ? ` You stopped at ${tally.answered} of ${FORM_SLOTS}; those answers are kept and not scored.` : ''}`
    case 'spiral':
      return `Opens when you pass the spiral checkpoint (${shape.closing}).`
    case 'finish-track':
      return `Opens when you finish the last lesson (${shape.closing}).`
    case 'after-b':
      return `Opens ${C_AFTER_B_DAYS} days after you finish form B.`
    case 'wait':
      return `Opens on ${w.opensOn}, ${C_AFTER_B_DAYS} days after you finished form B.`
    case 'now':
      return id === 'B' ? `Open: you passed ${shape.closing}.${partial}` : `Open: it has been ${C_AFTER_B_DAYS} days or more since form B.${partial}`
    default:
      return ''
  }
}

/* ------------------------------------------------------------------ */
/* Taking a form                                                       */
/* ------------------------------------------------------------------ */

interface RunnerProps {
  forms: TrackForms
  formId: FormId
  /** Slots already in the ledger. */
  answered: ReadonlySet<number>
  gens: ReadonlyMap<string, Gen>
  seen: ReadonlySet<string>
  record(items: ItemResponse[]): void
  onExit(): void
}

function FormRunner({ forms, formId, answered, gens, seen, record, onExit }: RunnerProps) {
  const plan = forms.forms[formId]
  // the slots this visit has recorded, and the one on show: the first not answered when the form opened, then whichever Next moves to
  const [local, setLocal] = useState<ReadonlySet<number>>(() => new Set())
  const [shown, setShown] = useState<number>(() => plan.slots.findIndex((s) => !answered.has(s.slot)))
  const seenNow = useRef(new Set(seen))
  const heading = useRef<HTMLHeadingElement>(null)
  const done = (slot: number) => answered.has(slot) || local.has(slot)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  const slot = shown < 0 ? null : plan.slots[shown]
  const item: PlayableItem | null = slot ? { source: 'gen', inst: slot.inst } : null
  const last = slot !== null && plan.slots.every((s) => s.slot === slot.slot || done(s.slot))
  /** Next: the first slot after this one that is not answered yet, else the form is finished. */
  const next = () => setShown((at) => plan.slots.findIndex((s, i) => i > at && !done(s.slot)))

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4 sm:p-5" data-form-runner={formId} data-track={forms.track}>
      <h3 ref={heading} tabIndex={-1} className="font-display text-h3 text-text-1 focus:outline-none">
        Form {formId} &middot; {trackLabel(forms.track)}
      </h3>
      <p className="mt-1 max-w-[60ch] text-body-sm text-text-2">
        {FORM_SLOTS} questions, each on new numbers. Stop whenever you like: your answers are kept and you can carry on later. This changes no review
        schedule and locks nothing.
      </p>
      {slot && item ? (
        <div className="mt-4">
          <Suspense fallback={<p role="status" className="font-mono text-body-sm text-text-3">Loading the question&hellip;</p>}>
            <ItemCard
              key={`${forms.track}:${formId}:${slot.slot}`}
              item={item}
              seed={slot.inst.seed}
              gen={gens.get(slot.family)}
              autoFocus
              eyebrow={`form ${formId} \u00b7 question ${slot.slot + 1} of ${FORM_SLOTS}`}
              nextLabel={last ? 'Finish' : 'Next question'}
              onResult={(result) => {
                record([formItemResponse(result, item, { track: forms.track, formId, formSlot: slot.slot, formSet: plan.set }, seenNow.current)])
                seenNow.current.add(instanceKey(result.ref, result.level, result.seed))
                setLocal((s) => new Set(s).add(slot.slot))
              }}
              onNext={next}
            />
          </Suspense>
        </div>
      ) : (
        <p role="status" className="mt-4 text-body text-text-1" data-form-finished>
          Form {formId} is finished: all {FORM_SLOTS} questions are answered. The score is on the card.
        </p>
      )}
      <button
        type="button"
        onClick={onExit}
        className="mt-4 min-h-11 rounded-md border border-line bg-surface-1 px-4 text-body-sm text-text-1 hover:border-line-bright"
      >
        {slot ? 'Stop for now' : 'Back to the forms'}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

function TrackRow({
  forms,
  shape,
  data,
  marks,
  onStart,
}: {
  forms: TrackForms
  shape: TrackShape
  data: FormsData
  marks: LessonMarks
  onStart(formId: FormId): void
}) {
  const tallies = useMemo(() => tallyForms(data.events, forms.track, data.now), [data.events, forms.track, data.now])
  const windows = formWindows(shape, marks, tallies, data.now)
  const results = formResults(tallies)
  return (
    <li className="py-4 first:pt-0 last:pb-0" data-forms-track={forms.track}>
      <h3 className="text-body text-text-1">{trackLabel(forms.track)}</h3>
      <ul className="mt-2 space-y-3">
        {windows.map((w) => {
          const p = results.forms[w.id]
          return (
            <li key={w.id} data-form={w.id} data-state={w.state} data-n={w.tally.answered} className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <p className="min-w-0 font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Form {w.id}</p>
                {w.state === 'open' && (
                  <button
                    type="button"
                    onClick={() => onStart(w.id)}
                    aria-label={`${w.tally.answered > 0 ? 'Continue' : 'Start'} form ${w.id}, ${trackLabel(forms.track)}`}
                    className="min-h-11 rounded-md bg-accent px-4 font-display text-[15px] font-semibold text-accent-foreground"
                  >
                    {w.tally.answered > 0 ? 'Continue' : 'Start'}
                  </button>
                )}
              </div>
              {p ? (
                <p className="text-body-sm text-text-1" data-figure={`form-${forms.track}-${w.id}`} data-n={p.n} data-enough>
                  {proportionText(p, FORM_SLOTS, 'items', 'right')}
                </p>
              ) : (
                <p className="text-body-sm text-text-2">{stateLine(w, shape)}</p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-3 space-y-1 text-body-sm text-text-2">
        {results.bMinusA ? (
          <p data-figure={`forms-b-minus-a-${forms.track}`} data-n={FORM_SLOTS} data-enough>
            B &minus; A: {differenceText(results.bMinusA)}, including the pretest effect.
          </p>
        ) : (
          <p data-figure={`forms-b-minus-a-${forms.track}`} data-n={Math.min(tallies.A.answered, tallies.B.answered)} data-enough={false}>
            B &minus; A: not enough data (needs forms A and B, {FORM_SLOTS} answers each).
          </p>
        )}
        {results.forms.C ? (
          <p data-figure={`forms-c-beside-b-${forms.track}`} data-n={FORM_SLOTS} data-enough>
            C beside B: C {results.forms.C.correct} of {FORM_SLOTS}
            {results.forms.B ? `, B ${results.forms.B.correct} of ${FORM_SLOTS}` : ''}
            {results.cMinusB ? `; C − B ${differenceText(results.cMinusB)}` : ''}. {pct(results.forms.C.rate ?? 0)} against{' '}
            {results.forms.B ? pct(results.forms.B.rate ?? 0) : 'no form B'}.
          </p>
        ) : (
          <p data-figure={`forms-c-beside-b-${forms.track}`} data-n={tallies.C.answered} data-enough={false}>
            C beside B: not enough data (needs form C, {FORM_SLOTS} answers).
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * `load` replaces the ledger and content read, and `record` the ledger write (tests mount the card on a fixture). Both must
 * be stable functions, or the effects run on every render.
 */
export default function FormsCard({ load, record: recordProp }: { load?: () => Promise<FormsData>; record?: (items: ItemResponse[]) => void } = {}) {
  const headingId = useId()
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<FormsData | null>(null)
  const [failed, setFailed] = useState(false)
  const [drawn, setDrawn] = useState<Drawn>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [running, setRunning] = useState<{ track: string; formId: FormId } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const recorded = useRef(0)
  const baseline = useRef(0)

  const aggEvents = useProgress((s) => s.aggregate.events)
  const marks = useProgress((s) => s.aggregate.lessons)
  const seedRaw = useProgress((s) => s.working['exp:seed'])
  const ledgerReady = useProgress((s) => s.ledger.ready)
  const readOnly = useProgress((s) => s.ledger.readOnly)
  const recordItems = useProgress((s) => s.recordItems)
  const record = recordProp ?? recordItems

  // The learner's seed is made once, here, when the card opens (it waits for the ledger and never runs in a read-only tab).
  useEffect(() => {
    if (open && !load) ensureExpSeed(useProgress.getState(), Math.random)
  }, [open, load, ledgerReady, readOnly, seedRaw])

  // Read the content and the ledger once the card is open, and the ledger again when it changes.
  const content = useRef<Promise<FormsContent> | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    ;(async () => {
      try {
        if (load) {
          const got = await load()
          if (live) setData(got)
          return
        }
        content.current ??= loadFormsContent()
        const [{ getLedgerClient }, loaded] = await Promise.all([import('@/lib/ledger/client'), content.current])
        let events: LedgerEvent[] = []
        // a write is asynchronous: wait (a moment) for this visit's answers to be in the read
        for (let i = 0; i < 8; i++) {
          events = await (await getLedgerClient()).events()
          if (events.length >= baseline.current + recorded.current || i === 7) break
          await wait(60)
        }
        if (live) setData({ content: loaded, events, marks: useProgress.getState().aggregate.lessons, now: localDay(), expSeed: readExpSeed(useProgress.getState().working['exp:seed']) })
      } catch {
        content.current = null // a content chunk that failed to fetch may load on the next try
        if (live) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [open, load, aggEvents, seedRaw, attempt])

  // Draw every track's forms inside settle(), once the content and the seed are there.
  const expSeed = data?.expSeed
  const drawFrom = data?.content
  useEffect(() => {
    if (!drawFrom || expSeed === undefined) return
    let live = true
    setDrawn((d) => (d.status === 'ready' ? d : { status: 'loading' }))
    ;(async () => {
      try {
        const plans: Record<string, TrackForms | null> = {}
        for (const t of TRACKS) {
          plans[t.id] = await formsFor(t.id, { gens: drawFrom.gens, kcs: drawFrom.kcs, expSeed })
          await wait(0) // the draws of the heavier families take a few tens of ms: let the page breathe between tracks
          if (!live) return
        }
        setDrawn({ status: 'ready', plans })
      } catch {
        if (live) setDrawn({ status: 'error' })
      }
    })()
    return () => {
      live = false
    }
  }, [drawFrom, expSeed, attempt])

  const retry = useCallback(() => {
    setFailed(false)
    setDrawn({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  const seen = useMemo(() => (data ? seenInstances(data.events) : new Set<string>()), [data])
  const shapes = useMemo(() => {
    const out: Record<string, TrackShape | null> = {}
    if (data) for (const t of TRACKS) out[t.id] = trackShape(t.id, data.content.lessons)
    return out
  }, [data])

  const plans = drawn.status === 'ready' ? drawn.plans : {}
  const withForms = TRACKS.filter((t) => plans[t.id] && shapes[t.id])
  const without = TRACKS.filter((t) => drawn.status === 'ready' && !plans[t.id])
  // the lesson marks move as the learner works; a test's fixture brings its own
  const liveMarks: LessonMarks = load ? (data?.marks ?? {}) : marks

  const start = (track: string, formId: FormId) => {
    baseline.current = data?.events.length ?? 0
    recorded.current = 0
    setRunning({ track, formId })
  }
  const stop = () => {
    setRunning(null)
    window.setTimeout(() => headingRef.current?.focus(), 0)
  }
  const recordTracked = (items: ItemResponse[]) => {
    recorded.current += items.length
    record(items)
  }

  const runningForms = running ? plans[running.track] : null

  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 rounded-lg border border-line bg-surface-1 p-6"
      data-forms-card
      data-forms-open={open}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="font-display text-h3 text-text-1 focus:outline-none">
        Track forms
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        Optional. For tracks with enough generated questions, three forms of {FORM_SLOTS} questions each, on numbers you have not met: A before your first
        lesson in the track, B after its spiral checkpoint, C at least {C_AFTER_B_DAYS} days after B. They only measure. They never lock a lesson, never
        change when a card is due, and count for nothing in VRK₃₀ or the lines above. One question is 100 &divide; {FORM_SLOTS} = 8.3 points of a form&apos;s
        score, so read the interval, not the point.
      </p>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="mt-3 inline-flex min-h-11 items-center rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
      >
        {open ? 'Hide the forms' : 'Show the forms'}
      </button>

      <div id={panelId} hidden={!open}>
        {open && (
          <div className="mt-4">
            {failed || drawn.status === 'error' ? (
              <div role="alert" data-forms-error>
                <p className="text-body-sm text-text-2">Could not load the forms. Nothing was started.</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-2 min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
                >
                  Try again
                </button>
              </div>
            ) : data && data.expSeed === undefined ? (
              <p role="status" className="text-body-sm text-text-2" data-forms-waiting>
                {!load && readOnly
                  ? 'This tab is read-only, so forms cannot start here. Open the app in one tab.'
                  : 'Waiting for your ledger to finish loading…'}
              </p>
            ) : !data || drawn.status === 'loading' ? (
              <p role="status" className="font-mono text-body-sm text-text-3" data-forms-loading>
                Drawing your forms&hellip;
              </p>
            ) : (
              <>
                {withForms.length === 0 ? (
                  <p className="text-body-sm text-text-2">No track has enough generated questions for forms yet.</p>
                ) : (
                  <ul className="divide-y divide-line" data-forms-tracks>
                    {withForms.map((t) => (
                      <TrackRow
                        key={t.id}
                        forms={plans[t.id]!}
                        shape={shapes[t.id]!}
                        data={data}
                        marks={liveMarks}
                        onStart={(formId) => start(t.id, formId)}
                      />
                    ))}
                  </ul>
                )}
                {without.length > 0 && (
                  <p className="mt-4 text-body-sm text-text-3" data-forms-without>
                    {without.map((t) => t.code).join(', ')} {without.length === 1 ? 'has' : 'have'} too little generated coverage for forms (a form needs {FORM_SLOTS}{' '}
                    questions over at least 3 ideas), so {without.length === 1 ? 'it shows' : 'they show'} none.
                  </p>
                )}
                {running && runningForms && (
                  <FormRunner
                    key={`${running.track}:${running.formId}`}
                    forms={runningForms}
                    formId={running.formId}
                    answered={tallyForms(data.events, running.track, data.now)[running.formId].slots}
                    gens={data.content.gens}
                    seen={seen}
                    record={recordTracked}
                    onExit={stop}
                  />
                )}
              </>
            )}

            <details className="mt-4 text-body-sm text-text-2">
              <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-2 hover:text-accent">How to read this</summary>
              <div className="max-w-[60ch] space-y-2 pb-2">
                <p>
                  Each form has the same {FORM_SLOTS} kinds of question in the same order, on seeds drawn from your own random number, so the forms differ in
                  numbers and not in what they ask. Which of three seed sets is form A, B or C is shuffled per track, so a set that happens to be harder does
                  not look like learning. A score is k of {FORM_SLOTS} with its Wilson 95 % interval.
                </p>
                <p>
                  B &minus; A includes the pretest effect: taking A is itself practice, so the gap is the lessons and the pretest together, not the lessons
                  alone. Its interval is Newcombe&apos;s, which treats the two forms&apos; items as independent draws and is about 95 % wide in the long run
                  (it is wider than it needs to be, because you took both). C beside B shows whether the score held over {C_AFTER_B_DAYS} days or more. Across
                  learners the project asks whether C ÷ B is at least 0.8; for one person on {FORM_SLOTS} items that ratio is too noisy to show.
                </p>
                <p>A form you start can be left and finished later. A started form A closes when you finish a lesson in the track; its answers stay and are not scored.</p>
              </div>
            </details>
          </div>
        )}
      </div>
    </section>
  )
}
