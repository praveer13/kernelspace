import { useEffect, useState } from 'react'
import { useProgress } from '@/lib/progress'
import {
  VRK_SHARE_MIN_N,
  buildMirror,
  loadMirrorInput,
  notEnough,
  perMonth,
  plural,
  proportionText,
  type Mirror,
  type MirrorInput,
} from '@/lib/learner/mirror'
import { ACTIVE_MONTH_MIN_DAYS, VRK_MIN_DAYS, type Vrk30 } from '@/lib/learner/vrk'
import Calibration from './Calibration'
import ColdChecks from './ColdChecks'
import Competence from './Competence'

/**
 * /me, the Mirror (wave-3.md §12.5, task 3b-06b): VRK₃₀ first, then cold checks, calibration and the optimism offset,
 * and competence statements. One lazy section: it reads the ledger once (the engine, the lesson corpus and the review
 * model load on demand, as `useSummary` does), builds every figure with `buildMirror`, and hands each to its section.
 * Every figure states its n and says "not enough data" below its minimum. It uses no framer-motion, so it needs no
 * MotionScope, and its static imports reach no lesson content (tests/shell/nav.test.ts holds both).
 */

export type MirrorLoad = { status: 'loading' } | { status: 'error' } | { status: 'ready'; mirror: Mirror }

/**
 * The Mirror from the ledger, read again when the aggregate or the records cards replay from change. `load` replaces the
 * ledger read (tests); it must be a stable function, or the effect runs on every render.
 */
function useMirror(load?: () => Promise<MirrorInput>): { state: MirrorLoad; retry: () => void } {
  const events = useProgress((s) => s.aggregate.events)
  const week = useProgress((s) => s.working['boot:week'])
  const placement = useProgress((s) => s.working['placement:result'])
  const [state, setState] = useState<MirrorLoad>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    ;(load ? load() : loadMirrorInput({ week, placement }))
      .then((input) => live && setState({ status: 'ready', mirror: buildMirror(input) }))
      .catch(() => live && setState({ status: 'error' }))
    return () => {
      live = false
    }
  }, [attempt, events, week, placement, load])

  return {
    state,
    retry: () => {
      setState({ status: 'loading' })
      setAttempt((n) => n + 1)
    },
  }
}

function Vrk30Section({ vrk }: { vrk: Vrk30 }) {
  const checked = vrk.checked.length
  return (
    <section aria-labelledby="mirror-vrk-heading" className="rounded-lg border border-line bg-surface-1 p-6" data-mirror="vrk30">
      <h2 id="mirror-vrk-heading" className="font-display text-h3 text-text-1">
        VRK₃₀
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        The ideas you still get right {VRK_MIN_DAYS} days or more after you learned them, on new numbers and without help.
      </p>

      <p className="mt-4 flex flex-wrap items-baseline gap-x-3" data-figure="vrk-count" data-n={checked} data-enough={checked > 0}>
        <span className="font-display text-stat text-text-1">{vrk.retained.length}</span>
        <span className="text-body text-text-2">retained of {checked} checked</span>
      </p>

      <dl className="mt-4 space-y-3">
        <div data-figure="vrk-share" data-n={checked} data-enough={checked >= VRK_SHARE_MIN_N}>
          <dt className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Share retained</dt>
          <dd className="text-body text-text-1">{proportionText(vrk.share, VRK_SHARE_MIN_N, 'checked ideas', 'retained')}</dd>
        </div>
        <div data-figure="vrk-month" data-n={vrk.activeMonths} data-enough={vrk.perActiveMonth !== null}>
          <dt className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Per active study-month</dt>
          <dd className="text-body text-text-1">
            {vrk.perActiveMonth === null
              ? notEnough(0, 1, 'active months')
              : `${perMonth(vrk.perActiveMonth)} retained per month, n = ${plural(vrk.activeMonths, 'active month')}`}
          </dd>
        </div>
      </dl>

      <details className="mt-4 text-body-sm text-text-2">
        <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-2 hover:text-accent">How this is counted</summary>
        <div className="max-w-[60ch] space-y-2 pb-2">
          <p>
            An idea is checked when you answered a new-numbers question on it, or a Prove-it prediction that your module confirmed, at least{' '}
            {VRK_MIN_DAYS} days after its review card was made, without a hint. It is retained when the latest such answer was right. A miss followed by
            a right answer is retained; a right answer followed by a miss is not. Track forms never count.
          </p>
          <p>
            Authored quiz questions are practice and never count, so an idea no question generator covers can enter this number only through Prove-it.
            A month is active with graded work on {ACTIVE_MONTH_MIN_DAYS} or more days. The share needs {VRK_SHARE_MIN_N} checked ideas, and its interval is
            the Wilson 95 % interval.
          </p>
        </div>
      </details>
    </section>
  )
}

/**
 * `load` replaces the ledger read, for tests that mount the section on a fixture ledger. `onSettled` is called once the
 * read has ended, in a figure or in an error, and again after a retry ends: /me holds what sits below the Mirror back until
 * then, so the section grows into empty space instead of pushing content that is already on screen.
 *
 * The loading line is one line, the height of the Suspense fallback in Me.tsx (h-6): the ready content is as tall as the
 * ledger makes it (a few hundred pixels with an empty ledger, more with a full one, and taller again at 360 px), so no
 * placeholder height is right for both, and none is reserved.
 */
export default function MirrorSummary({ load, onSettled }: { load?: () => Promise<MirrorInput>; onSettled?: () => void }) {
  const { state, retry } = useMirror(load)
  const settled = state.status !== 'loading'
  useEffect(() => {
    if (settled) onSettled?.()
  }, [settled, onSettled])

  if (state.status === 'loading') {
    return (
      <p role="status" className="h-6 font-mono text-body-sm leading-6 text-text-3">
        Reading your ledger…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-line bg-surface-1 p-6">
        <p className="text-body-sm text-text-2">Could not read your ledger, so the Mirror has nothing to show yet.</p>
        <button
          type="button"
          onClick={retry}
          className="mt-2 min-h-11 rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright"
        >
          Try again
        </button>
      </div>
    )
  }
  const { mirror } = state
  return (
    <div className="space-y-6" data-mirror="summary" data-as-of={mirror.now}>
      <Vrk30Section vrk={mirror.vrk} />
      <ColdChecks cold={mirror.cold} />
      <Calibration calibration={mirror.calibration} offset={mirror.offset} />
      <Competence statements={mirror.competence} unmet={mirror.competenceUnmet} />
    </div>
  )
}
