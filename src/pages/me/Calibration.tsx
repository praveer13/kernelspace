import { CONFIDENCE_LEVELS, type Calibration as CalibrationFigures } from '@/lib/learner/calibration'
import type { OptimismOffset } from '@/lib/learner/cards'
import { CALIBRATION_MIN_N, OFFSET_MIN_N, notEnough, pct, rateText } from '@/lib/learner/mirror'
import { proportionOf } from '@/lib/learner/vrk'

/**
 * /me, calibration (wave-3.md §12.3, §12.5): how well "guess", "think so" and "sure" predicted your answers, as
 * computed (Brier, reliability, sure-and-wrong), and the optimism offset the scheduler learned from your first spaced
 * reviews, with its n. Below 20 rated answers the page says "not enough data" and prints no score; the offset says
 * "0.02 (default) until 20 first reviews". No framer-motion; no lesson content.
 */

const WORD = { guess: 'guess', think: 'think so', sure: 'sure' } as const

const fixed = (x: number, digits: number): string => x.toFixed(digits)

function Offset({ offset }: { offset: OptimismOffset }) {
  return (
    <div data-figure="offset" data-n={offset.n} data-enough={offset.learned}>
      <h3 className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Optimism offset</h3>
      {offset.learned ? (
        <p className="mt-2 text-body text-text-1">
          {fixed(offset.offset, 2)}, learned from n = {offset.n} first reviews.
        </p>
      ) : (
        <p className="mt-2 text-body text-text-1">
          {fixed(offset.offset, 2)} (default) until {OFFSET_MIN_N} first reviews; n = {offset.n} so far.
        </p>
      )}
      <p className="mt-1 max-w-[60ch] text-body-sm text-text-2">
        A review is scheduled for when predicted recall falls to your recall target plus this offset. Once learned, it is the mean recall the model
        predicted for the first spaced review of each card minus the share you got right, kept between 0 and 0.08. Your schedule carries{' '}
        {fixed(offset.offset * 100, 0)} points of extra margin now.
      </p>
    </div>
  )
}

export default function Calibration({ calibration: cal, offset }: { calibration: CalibrationFigures; offset: OptimismOffset }) {
  const ok = cal.n >= CALIBRATION_MIN_N
  const correct = cal.bins.reduce((s, b) => s + b.correct, 0)
  const sure = cal.bins[2]
  return (
    <section aria-labelledby="mirror-calibration-heading" className="rounded-lg border border-line bg-surface-1 p-6" data-mirror="calibration">
      <h2 id="mirror-calibration-heading" className="font-display text-h3 text-text-1">
        Calibration
      </h2>
      <p className="mt-2 max-w-[60ch] text-body-sm text-text-2">
        When you say how sure you are, does it match how often you are right? Only answers where you picked a confidence count; the rest are left out,
        not counted as wrong.
      </p>

      <div className="mt-4 space-y-6">
        <div data-figure="calibration" data-n={cal.n} data-enough={ok}>
          {!ok ? (
            <p className="text-body-sm text-text-2">Calibration: {notEnough(cal.n, CALIBRATION_MIN_N, 'rated answers')}.</p>
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-3">
                <div data-figure="brier" data-n={cal.n} data-enough>
                  <dt className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Brier score</dt>
                  <dd className="text-body text-text-1">{fixed(cal.brier, 3)}</dd>
                  <dd className="text-body-sm text-text-2">
                    0 is perfect. Saying your own average every time would score {fixed(cal.uncertainty, 3)}. n = {cal.n}.
                  </dd>
                </div>
                <div data-figure="reliability" data-n={cal.n} data-enough>
                  <dt className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Reliability gap</dt>
                  <dd className="text-body text-text-1">{fixed(cal.reliability, 3)}</dd>
                  <dd className="text-body-sm text-text-2">0 means each level was right as often as it claimed. n = {cal.n}.</dd>
                </div>
                <div data-figure="sure-wrong" data-n={sure.n} data-enough={sure.n > 0}>
                  <dt className="font-mono text-[11px] uppercase tracking-[0.10em] text-text-3">Sure and wrong</dt>
                  <dd className="text-body text-text-1">
                    {cal.sureWrong} of {sure.n}
                  </dd>
                  <dd className="text-body-sm text-text-2">answers you were sure of were wrong. n = {sure.n}.</dd>
                </div>
              </dl>
              <p className="mt-3 text-body-sm text-text-2" data-figure="bias" data-n={cal.n} data-enough>
                On average you claimed {pct(correct / cal.n + cal.bias)} and were right {pct(correct / cal.n)} of the time
                {cal.bias > 0.005 ? ': overconfident.' : cal.bias < -0.005 ? ': underconfident.' : ': well matched.'}
              </p>
              <ul className="mt-3 divide-y divide-line" aria-label="Reliability by confidence level">
                {CONFIDENCE_LEVELS.map((level, i) => {
                  const b = cal.bins[i]
                  return (
                    <li key={level} className="py-2 first:pt-0 last:pb-0" data-figure={`bin-${level}`} data-n={b.n} data-enough={b.n > 0}>
                      <span className="text-body-sm text-text-1">
                        {WORD[level]} (counted as {pct(b.p)})
                      </span>
                      <span className="block text-body-sm text-text-2">
                        {b.n === 0
                          ? 'none rated, n = 0'
                          : `${b.correct} of ${b.n} right, ${rateText(proportionOf(b.correct, b.n))}, n = ${b.n}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <Offset offset={offset} />
      </div>

      <details className="mt-4 text-body-sm text-text-2">
        <summary className="flex min-h-11 cursor-pointer items-center underline underline-offset-2 hover:text-accent">How this is computed</summary>
        <p className="max-w-[60ch] pb-2">
          Each level stands for a probability: guess 33 %, think so 67 %, sure 95 %. The Brier score is the mean of (probability − outcome)² over the rated
          answers, outcome 1 for right and 0 for wrong. It splits exactly into the reliability gap, minus how well the levels separate right from wrong,
          plus p(1 − p) for p your own share right, which is the score of always saying that share. A score is printed only from {CALIBRATION_MIN_N} rated answers.
        </p>
      </details>
    </section>
  )
}
