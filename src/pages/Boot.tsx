import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { LinkButton } from '@/components/Button'
import { BOOT, GRADED_STEPS, bootRev, type BootStep } from '@/lib/boot/model'
import { useProgress } from '@/lib/progress'
import { cn } from '@/lib/utils'
import Faded from '@/pages/boot/Faded'
import Guess from '@/pages/boot/Guess'
import type { Commit, StepProps } from '@/pages/boot/session'
import { StepForm, StepTitle } from '@/pages/boot/ui'

/**
 * K4 Boot (docs/specs/ledger-v3.md §12.4; PLAN-100X §4.A): about ten minutes, any device. The learner
 * guesses a decode speed, builds it from the hardware, finds the roofline and the KV catch, and then
 * says what the course is for. Every number is a claim or [derived] in `src/lib/boot/model.ts`.
 *
 * This page imports no lessons, sims, charts or the ledger engine; `verify:bundle` holds its closure
 * under 200 KB gzip. Boot pays no XP (Addendum A3).
 */

// Steps 3 to 6 load together, on demand, after an idle prefetch below, so they stay out of the /boot
// first-load closure that verify:bundle gates (spec §12.4: dynamic imports are not counted).
const loadLater = () => import('@/pages/boot/later')
const Roofline = lazy(() => loadLater().then((m) => ({ default: m.Roofline })))
const Catch = lazy(() => loadLater().then((m) => ({ default: m.Catch })))
const Reveal = lazy(() => loadLater().then((m) => ({ default: m.Reveal })))
const You = lazy(() => loadLater().then((m) => ({ default: m.You })))

const STEP_NAMES = ['Start', 'Guess', 'Example', 'Roofline', 'Catch', 'Reveal', 'You'] as const
const LAST = STEP_NAMES.length - 1

interface Session {
  /** Wall-clock start (performance.now) of this run, for totalMs and firstSuccessMs. */
  startedAt: number
  firstOkAt: number | null
  /** Set when the learner finishes. */
  endedAt: number | null
  correct: number
}

const clock = () => performance.now()

function Progress({ step }: { step: number }) {
  return (
    <div className="mb-6">
      <p className="font-mono text-[12px] text-text-3">
        Step {step} of {LAST} · {STEP_NAMES[step]}
      </p>
      <div aria-hidden className="mt-2 flex gap-1">
        {STEP_NAMES.slice(1).map((n, i) => (
          <span key={n} className={cn('h-1 flex-1 rounded-full', i < step ? 'bg-accent' : 'bg-line')} />
        ))}
      </div>
    </div>
  )
}

function Intro({ completedAt, onStart }: { completedAt: string | undefined; onStart: () => void }) {
  return (
    <section aria-labelledby="boot-step-title">
      <StepTitle kicker="0x00 — boot">Ten minutes, any device</StepTitle>
      <div className="mt-4 space-y-3 text-body text-text-2">
        {completedAt ? (
          <p>
            You finished Boot on {new Date(completedAt).toLocaleDateString()}. Replaying is fine: your first run is the one that counts as your
            starting point.
          </p>
        ) : (
          <>
            <p>
              You will guess how fast one H100 can talk to one person, check the guess against the hardware, and find out why the number you
              probably reached for is the wrong kind of number. Then you tell the course what you are here for.
            </p>
            <p>Nothing is graded against you. Boot pays no XP; it only records what you already knew, so the course can start in the right place.</p>
          </>
        )}
        <p className="text-body-sm text-text-3">
          Scenario: Llama-3-8B in BF16 (2 bytes per weight) on one H100 SXM, chats of 4,096 tokens. Every other number is a tappable chip with its source.
        </p>
      </div>
      <StepForm done={false} canCheck onCheck={onStart} onNext={onStart} checkLabel={completedAt ? 'Replay Boot' : 'Start'}>
        {completedAt ? (
          <p className="text-body-sm">
            <LinkButton to="/curriculum" variant="secondary">
              Go to the curriculum
            </LinkButton>
          </p>
        ) : null}
      </StepForm>
    </section>
  )
}

function Done({ session, onReplay }: { session: Session; onReplay: () => void }) {
  const total = Math.round((session.endedAt ?? session.startedAt) - session.startedAt)
  const first = session.firstOkAt === null ? null : Math.round(session.firstOkAt - session.startedAt)
  const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`
  return (
    <section aria-labelledby="boot-step-title">
      <StepTitle kicker="0x07 — booted">Boot is done</StepTitle>
      <div role="status" className="mt-4 space-y-3 text-body text-text-2">
        <p>
          You got {session.correct} of {GRADED_STEPS.length} graded steps right{first !== null ? `, the first after ${mmss(first)}` : ''}, in {mmss(total)}.
          Whatever the count, it is your starting point, not your score.
        </p>
        <p>
          The one idea to keep: a single user leaves almost all of the GPU's math idle, because decode waits on memory. Everything in the next
          tracks (batching, paging, quantization, KV cache) is a way to spend that idle math.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <LinkButton to="/tracks/r">Start Rust Zero</LinkButton>
        <LinkButton to="/curriculum" variant="secondary">
          Browse the curriculum
        </LinkButton>
      </div>
      <button
        type="button"
        onClick={onReplay}
        className="mt-4 inline-flex min-h-11 items-center text-body-sm text-text-2 underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Replay Boot
      </button>
    </section>
  )
}

export default function Boot() {
  const recordVisit = useProgress((s) => s.recordVisit)
  const recordItems = useProgress((s) => s.recordItems)
  const completeRef = useProgress((s) => s.completeRef)
  const completedAt = useProgress((s) => s.completions.boot)

  const [step, setStep] = useState(0)
  const [phase, setPhase] = useState<'flow' | 'done'>('flow')
  const [guess, setGuess] = useState<number | null>(null)
  const [run, setRun] = useState(0)
  const session = useRef<Session>({ startedAt: 0, firstOkAt: null, endedAt: null, correct: 0 })
  const visited = useRef(false)
  const mounted = useRef(false)

  // The first visit writes `visit boot` (step 0). A finished learner writes it only when they replay.
  useEffect(() => {
    if (visited.current || completedAt) return
    visited.current = true
    session.current.startedAt = clock()
    recordVisit('boot')
  }, [completedAt, recordVisit])

  // Fetch the later steps while the learner reads and guesses; a miss falls back to the Suspense below.
  useEffect(() => {
    const warm = () => void loadLater().catch(() => undefined)
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(warm, 1500)
    return () => window.clearTimeout(id)
  }, [])

  // Each step moves focus to its heading, so a screen reader starts at the top and a keyboard user is already inside the step.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    document.getElementById('boot-step-title')?.focus({ preventScroll: true })
  }, [step, phase, run])

  const start = () => {
    // A first run keeps the clock that began at the visit; a replay starts its own.
    if (completedAt) {
      session.current = { startedAt: clock(), firstOkAt: null, endedAt: null, correct: 0 }
      recordVisit('boot')
    }
    setGuess(null)
    setRun((r) => r + 1)
    setStep(1)
  }

  const commit = useCallback(
    (name: BootStep, ms: number, c: Commit) => {
      recordItems([
        {
          kind: c.kind,
          ref: `boot:${name}`,
          rev: bootRev(name),
          score: c.score,
          ok: c.ok,
          ms,
          ...(c.conf ? { conf: c.conf } : {}),
          ...(c.seed !== undefined ? { seed: c.seed } : {}),
          data: c.data,
        },
      ])
      if (c.ok) {
        session.current.correct += 1
        session.current.firstOkAt ??= clock()
      }
    },
    [recordItems],
  )

  const next = useCallback(() => setStep((s) => Math.min(LAST, s + 1)), [])

  const finish = () => {
    const s = session.current
    s.endedAt = clock()
    completeRef('boot', {
      totalMs: Math.round(s.endedAt - s.startedAt),
      firstSuccessMs: s.firstOkAt === null ? null : Math.round(s.firstOkAt - s.startedAt),
      correct: s.correct,
      graded: GRADED_STEPS.length,
    })
    setPhase('done')
  }

  const props: StepProps = { model: BOOT, guess, commit, next }

  return (
    <div className="mx-auto w-full max-w-prose px-3 pb-24 pt-8 sm:px-6">
      <h1 className="sr-only">Boot: your first ten minutes</h1>
      {phase === 'flow' && step > 0 && <Progress step={step} />}
      <Suspense fallback={<p role="status" className="font-mono text-body-sm text-text-3">loading the next step…</p>}>
      {phase === 'done' ? (
        <Done session={session.current} onReplay={() => { setPhase('flow'); start() }} />
      ) : step === 0 ? (
        <Intro completedAt={completedAt} onStart={start} />
      ) : step === 1 ? (
        <Guess key={`g${run}`} {...props} onGuess={setGuess} />
      ) : step === 2 ? (
        <Faded key={`f${run}`} {...props} />
      ) : step === 3 ? (
        <Roofline key={`r${run}`} {...props} />
      ) : step === 4 ? (
        <Catch key={`c${run}`} {...props} />
      ) : step === 5 ? (
        <Reveal key={`v${run}`} {...props} />
      ) : (
        <You key={`y${run}`} onFinish={finish} />
      )}
      </Suspense>
    </div>
  )
}
