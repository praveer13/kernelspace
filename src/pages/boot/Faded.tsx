import { useState } from 'react'
import { BOOT_CLAIMS, BYTES_PER_WEIGHT, TOLERANCE, fmt, gradeNear } from '@/lib/boot/model'
import { ClaimChip, DerivedChip } from './Chip'
import { useStepClock, parseNumber, type StepProps } from './session'
import { NumberField, StepForm, StepTitle, Verdict } from './ui'

/** Rounds a ratio for speech: "about 12×", "about 1.5×". */
const times = (r: number) => (r >= 10 ? Math.round(r) : Math.round(r * 10) / 10)

export default function Faded({ model, guess, commit, next }: StepProps) {
  const clock = useStepClock()
  const [text, setText] = useState('')
  const [done, setDone] = useState<null | { ok: boolean; value: number }>(null)
  const value = parseNumber(text)

  const check = () => {
    if (value === null) return
    const g = gradeNear(value, model.decodeTps, TOLERANCE.faded)
    commit('faded-decode', clock(), { kind: 'item', ...g, data: { src: 'boot', value } })
    setDone({ ok: g.ok, value })
  }

  const ratio = guess !== null && guess > 0 ? guess / model.decodeTps : null

  return (
    <section aria-labelledby="boot-step-title">
      <StepTitle kicker="0x02 — a worked example">Making a token means reading every weight once</StepTitle>
      <p className="mt-3 text-body text-text-2">
        To produce the next token for one user, the GPU streams the whole model out of its memory (HBM) and through the math units. So
        the question becomes: how long does one pass over the weights take?
      </p>

      <ol className="mt-5 space-y-3 rounded-md border border-line bg-surface-1 p-4 text-body-sm text-text-2">
        <li>
          <span className="font-mono text-text-3">1 · weights</span>
          <br />
          <ClaimChip id={BOOT_CLAIMS.params} /> × {BYTES_PER_WEIGHT} bytes per BF16 weight (scenario, not a claim) ={' '}
          <DerivedChip of="weightsBytes">{(model.weightsBytes / 1e9).toFixed(2)} GB</DerivedChip>
        </li>
        <li>
          <span className="font-mono text-text-3">2 · memory bandwidth</span>
          <br />
          The H100 SXM moves <ClaimChip id={BOOT_CLAIMS.bandwidth} /> out of its HBM.
        </li>
        <li>
          <span className="font-mono text-text-3">3 · time for one pass</span>
          <br />
          {(model.weightsBytes / 1e9).toFixed(2)} GB ÷ <ClaimChip id={BOOT_CLAIMS.bandwidth} /> = <DerivedChip of="tokenSeconds">{(model.tokenSeconds * 1000).toFixed(2)} ms</DerivedChip>{' '}
          per token.
        </li>
        <li className="font-semibold text-text-1">
          <span className="font-mono font-normal text-text-3">4 · your turn</span>
          <br />
          One token every {(model.tokenSeconds * 1000).toFixed(2)} ms is how many tokens per second?
        </li>
      </ol>

      <StepForm
        done={done !== null}
        canCheck={value !== null}
        onCheck={check}
        onNext={next}
        feedback={
          done && (
            <Verdict tone={done.ok ? 'good' : 'miss'} lead={done.ok ? 'Yes.' : `Not quite: it is ${fmt.tps(model.decodeTps)}.`}>
              <p>
                1 ÷ {(model.tokenSeconds * 1000).toFixed(2)} ms ={' '}
                <DerivedChip of="decodeTps">{fmt.tps(model.decodeTps)}</DerivedChip>. That is the ceiling for one user: batch-1 decode waits on
                memory, not on arithmetic.
              </p>
              {ratio !== null && (
                <p>
                  Your guess was {Math.round(guess ?? 0).toLocaleString('en-US')} tok/s,{' '}
                  {ratio >= 1.15
                    ? `about ${times(ratio)}× too high`
                    : ratio <= 1 / 1.15
                      ? `about ${times(1 / ratio)}× too low`
                      : 'within a few percent'}
                  .
                  {ratio > 3 && (
                    <>
                      {' '}
                      A guess from math alone lands near <DerivedChip of="computeCeilingTps">{Math.round(model.computeCeilingTps).toLocaleString('en-US')} tok/s</DerivedChip>
                      , because the arithmetic would allow that. The weights cannot arrive that fast.
                    </>
                  )}
                </p>
              )}
            </Verdict>
          )
        }
      >
        <NumberField label="Tokens per second" unit="tok/s" value={text} onChange={setText} disabled={done !== null} hint={`Within ${TOLERANCE.faded * 100}% counts.`} />
      </StepForm>
    </section>
  )
}
