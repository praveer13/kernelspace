import { useId, useMemo, useState } from 'react'
import { BOOT_CLAIMS, MAX_BATCH, ROOFLINE_BATCHES, TOLERANCE, bootInputs, fmt, gradeNear, rooflineAt } from '@/lib/boot/model'
import { ClaimChip, DerivedChip } from './Chip'
import { useStepClock, parseNumber, type StepProps } from './session'
import { NumberField, StepBtn, StepForm, StepTitle, Verdict } from './ui'

/* Plot geometry in viewBox units: x is log2(batch) over 1..1024, y is log10(TFLOPS) over 1..1000. */
const W = 360
const H = 226
const X0 = 46
const X1 = 346
const Y0 = 190
const Y1 = 12
const px = (batch: number) => X0 + (Math.log2(batch) / Math.log2(MAX_BATCH)) * (X1 - X0)
const py = (tflops: number) => Y0 - (Math.log10(tflops) / 3) * (Y0 - Y1)

const X_TICKS = [1, 4, 16, 64, 256, 1024]
const Y_TICKS = [1, 10, 100, 1000]

const pct = (f: number) => (f < 0.1 ? f * 100 : Math.round(f * 100)).toFixed(f < 0.1 ? 2 : 0)

export default function Roofline({ model, commit, next }: StepProps) {
  const clock = useStepClock()
  const sliderId = useId()
  const inputs = useMemo(() => bootInputs(), [])
  const [batch, setBatch] = useState(1)
  const [text, setText] = useState('')
  const [done, setDone] = useState<null | { ok: boolean }>(null)
  const value = parseNumber(text)
  const here = rooflineAt(batch, inputs)

  const setB = (b: number) => setBatch(Math.min(MAX_BATCH, Math.max(1, Math.round(b))))

  const roof = useMemo(() => {
    const pts: string[] = []
    for (let i = 0; i <= 80; i++) {
      const b = 2 ** ((i / 80) * Math.log2(MAX_BATCH))
      pts.push(`${px(b).toFixed(1)},${py(rooflineAt(b, inputs).tflops).toFixed(1)}`)
    }
    return pts.join(' ')
  }, [inputs])

  const check = () => {
    if (value === null) return
    const g = gradeNear(value, model.ridge, TOLERANCE.ridge)
    commit('ridge', clock(), { kind: 'item', ...g, data: { src: 'boot', value } })
    setDone({ ok: g.ok })
  }

  return (
    <section aria-labelledby="boot-step-title">
      <StepTitle kicker="0x03 — the roofline">Where does the roof flatten?</StepTitle>
      <p className="mt-3 text-body text-text-2">
        A BF16 weight is 2 bytes and each token does 2 FLOP on it, so a batch of <em>b</em> tokens does <em>b</em> FLOP for every byte read
        (weights only; the KV cache comes next). The math tops out at <ClaimChip id={BOOT_CLAIMS.flops} />, memory at{' '}
        <ClaimChip id={BOOT_CLAIMS.bandwidth} />. Move the batch and watch which one runs out first.
      </p>

      <div className="mt-5 rounded-md border border-line bg-surface-1 p-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Roofline for decode on one H100. At batch ${here.batch} the attainable math is ${here.tflops.toFixed(1)} TFLOPS, ${pct(here.busy)} percent of peak, limited by ${here.bound}. A table with every batch follows.`}
          className="mx-auto h-auto w-full max-w-lg"
        >
          {Y_TICKS.map((t) => (
            <g key={t}>
              <line x1={X0} x2={X1} y1={py(t)} y2={py(t)} className="stroke-line" strokeWidth={1} />
              <text x={X0 - 6} y={py(t) + 3} textAnchor="end" className="fill-text-3 font-mono" fontSize={10}>
                {t}
              </text>
            </g>
          ))}
          {X_TICKS.map((t) => (
            <g key={t}>
              <line x1={px(t)} x2={px(t)} y1={Y1} y2={Y0} className="stroke-line" strokeWidth={1} />
              <text x={px(t)} y={Y0 + 14} textAnchor="middle" className="fill-text-3 font-mono" fontSize={10}>
                {t}
              </text>
            </g>
          ))}
          <text x={(X0 + X1) / 2} y={H - 8} textAnchor="middle" className="fill-text-2 font-mono" fontSize={10}>
            batch = FLOP per byte of weights
          </text>
          <text x={10} y={(Y0 + Y1) / 2} textAnchor="middle" transform={`rotate(-90 10 ${(Y0 + Y1) / 2})`} className="fill-text-2 font-mono" fontSize={10}>
            attainable TFLOPS
          </text>
          <polyline points={roof} fill="none" className="stroke-accent" strokeWidth={2.5} strokeLinejoin="round" />
          {done && (
            <g>
              <line x1={px(model.ridge)} x2={px(model.ridge)} y1={Y1} y2={Y0} className="stroke-info" strokeWidth={1.5} strokeDasharray="4 3" />
              <text x={px(model.ridge) - 4} y={Y1 + 10} textAnchor="end" className="fill-info font-mono" fontSize={10}>
                ridge {fmt.ridge(model.ridge)}
              </text>
            </g>
          )}
          <line x1={px(here.batch)} x2={px(here.batch)} y1={py(here.tflops)} y2={Y0} className="stroke-amber" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={px(here.batch)} cy={py(here.tflops)} r={6} className="fill-amber stroke-ink" strokeWidth={2} />
        </svg>

        <div aria-live="polite" aria-atomic="true" className="mt-2 font-mono text-[13px] text-text-1">
          batch {here.batch}: <span className="text-amber">{here.tflops.toFixed(here.tflops < 10 ? 2 : 0)} TFLOPS</span> ·{' '}
          <span className="text-text-1">{pct(here.busy)}% of the math busy</span> ·{' '}
          <span className={here.bound === 'memory' ? 'text-amber' : 'text-accent'}>{here.bound}-bound</span>
          {batch === 1 && (
            <>
              {' '}
              <DerivedChip of="mathBusyBatch1">{fmt.pctSmall(model.mathBusyBatch1)}</DerivedChip>
            </>
          )}
        </div>

        <label htmlFor={sliderId} className="mt-3 block text-body-sm text-text-1">
          Batch size: {here.batch}
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={1000}
          step={1}
          value={Math.round((Math.log2(batch) / Math.log2(MAX_BATCH)) * 1000)}
          aria-valuetext={`batch ${here.batch}`}
          onChange={(e) => setB(2 ** ((Number(e.target.value) / 1000) * Math.log2(MAX_BATCH)))}
          className="h-11 w-full accent-accent"
        />
        <div className="flex flex-wrap gap-2">
          <StepBtn onClick={() => setB(batch / 2)} disabled={batch <= 1} aria-label="Halve the batch">
            ÷ 2
          </StepBtn>
          <StepBtn onClick={() => setB(batch - 1)} disabled={batch <= 1} aria-label="Batch minus one">
            − 1
          </StepBtn>
          <StepBtn onClick={() => setB(batch + 1)} disabled={batch >= MAX_BATCH} aria-label="Batch plus one">
            + 1
          </StepBtn>
          <StepBtn onClick={() => setB(batch * 2)} disabled={batch >= MAX_BATCH} aria-label="Double the batch">
            × 2
          </StepBtn>
        </div>

        <details className="group mt-3 text-body-sm text-text-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-text-1 before:mr-2 before:font-mono before:text-accent before:content-['+'] group-open:before:content-['−']">Show the chart as a table</summary>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[18rem] text-left font-mono text-[12px]">
              <caption className="sr-only">Attainable TFLOPS by batch size for decode on one H100, weights only</caption>
              <thead className="text-text-3">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-normal">batch</th>
                  <th scope="col" className="py-1 pr-3 font-normal">TFLOPS</th>
                  <th scope="col" className="py-1 pr-3 font-normal">math busy</th>
                  <th scope="col" className="py-1 font-normal">bound</th>
                </tr>
              </thead>
              <tbody>
                {ROOFLINE_BATCHES.map((b) => {
                  const r = rooflineAt(b, inputs)
                  return (
                    <tr key={b} className="border-t border-line">
                      <th scope="row" className="py-1 pr-3 font-normal text-text-1">{b}</th>
                      <td className="py-1 pr-3">{r.tflops.toFixed(r.tflops < 10 ? 2 : 0)}</td>
                      <td className="py-1 pr-3">{pct(r.busy)}%</td>
                      <td className="py-1">{r.bound}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      <StepForm
        done={done !== null}
        canCheck={value !== null}
        onCheck={check}
        onNext={next}
        checkLabel="Commit my ridge"
        feedback={
          done && (
            <Verdict tone={done.ok ? 'good' : 'miss'} lead={done.ok ? 'Yes.' : `Not quite: it is ${fmt.ridge(model.ridge)} FLOP/byte.`}>
              <p>
                The roof meets the slope at <DerivedChip of="ridge">{fmt.ridge(model.ridge)} FLOP/B</DerivedChip>: peak FLOPS divided by bandwidth. Below
                a batch of about that size the GPU waits on memory, which is why one user keeps only{' '}
                <DerivedChip of="mathBusyBatch1">{fmt.pctSmall(model.mathBusyBatch1)}</DerivedChip> of the math busy.
              </p>
              <p>To reach the roof you need a batch near the ridge. Can the GPU hold that many conversations? That is next.</p>
            </Verdict>
          )
        }
      >
        <NumberField
          label="At what batch (FLOP per byte) does the roof stop rising?"
          unit="FLOP/B"
          value={text}
          onChange={setText}
          disabled={done !== null}
          hint={`Slide until the TFLOPS stop growing, or divide the roof by the slope. Within ${TOLERANCE.ridge * 100}% counts.`}
        />
      </StepForm>
    </section>
  )
}
