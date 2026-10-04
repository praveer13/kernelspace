import { useId, useState } from 'react'
import ConfidencePicker from '@/components/learner/ConfidencePicker'
import { BOOT_CLAIMS, gradeGuess } from '@/lib/boot/model'
import type { Confidence } from '@/lib/ledger/types'
import { ClaimChip } from './Chip'
import { confidenceKey, useStepClock, parseNumber, type StepProps } from './session'
import { NumberField, StepBtn, StepForm, StepTitle, Verdict } from './ui'

const LO = 10
const HI = 100_000
const SPAN = Math.log10(HI / LO)
/** Slider positions run 0..1000 along a log axis, so one arrow key is the same ratio everywhere. */
const toPos = (v: number) => Math.round((Math.log10(Math.min(HI, Math.max(LO, v)) / LO) / SPAN) * 1000)
const fromPos = (p: number) => LO * 10 ** ((p / 1000) * SPAN)
const roundNice = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10)

export default function Guess({ model, commit, next, onGuess }: StepProps & { onGuess: (v: number) => void }) {
  const clock = useStepClock()
  const sliderId = useId()
  const [text, setText] = useState('')
  const [conf, setConf] = useState<Confidence | undefined>()
  const [done, setDone] = useState(false)
  const value = parseNumber(text)

  const set = (v: number) => setText(String(roundNice(Math.min(HI, Math.max(LO, v)))))

  const lock = () => {
    if (value === null) return
    const g = gradeGuess(value, model.decodeTps)
    onGuess(value)
    commit('guess-1user', clock(), {
      kind: 'predict',
      ...g,
      conf,
      data: { value, unit: 'tok/s', truth: Math.round(model.decodeTps * 10) / 10, src: 'boot' },
    })
    setDone(true)
  }

  return (
    <section onKeyDown={done ? undefined : (e) => confidenceKey(e, setConf)} aria-labelledby="boot-step-title">
      <StepTitle kicker="0x01 — guess">One user, Llama-3-8B, one H100: how many tokens per second?</StepTitle>
      <p className="mt-3 text-body text-text-2">
        The model has <ClaimChip id={BOOT_CLAIMS.params} /> and runs in BF16. The chip can do{' '}
        <ClaimChip id={BOOT_CLAIMS.flops} /> of dense BF16 math. One person is chatting with it. Trust your gut, then say how sure you are.
      </p>

      <StepForm
        done={done}
        canCheck={value !== null && value > 0}
        onCheck={lock}
        onNext={next}
        checkLabel="Lock in my guess"
        feedback={
          <Verdict tone="info" lead="Locked in.">
            <p>
              You said {value !== null ? `${Math.round(value).toLocaleString('en-US')} tok/s` : 'a number'}. We will come back to it. First, let's
              build the number from the hardware.
            </p>
          </Verdict>
        }
      >
        <div>
          <label htmlFor={sliderId} className="block text-body-sm text-text-1">
            Slide, or type below ({LO.toLocaleString('en-US')} to {HI.toLocaleString('en-US')} tok/s, log scale)
          </label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={1000}
            step={1}
            value={value === null ? 500 : toPos(value)}
            disabled={done}
            aria-valuetext={value === null ? 'not set' : `${Math.round(value).toLocaleString('en-US')} tokens per second`}
            onChange={(e) => set(fromPos(Number(e.target.value)))}
            className="mt-3 h-11 w-full accent-accent"
          />
          <div className="mt-1 flex flex-wrap gap-2">
            <StepBtn disabled={done} onClick={() => set((value ?? 1000) / 2)} aria-label="Halve the guess">
              ÷ 2
            </StepBtn>
            <StepBtn disabled={done} onClick={() => set((value ?? 1000) * 2)} aria-label="Double the guess">
              × 2
            </StepBtn>
            <StepBtn disabled={done} onClick={() => set((value ?? 1000) / 10)} aria-label="Divide the guess by ten">
              ÷ 10
            </StepBtn>
            <StepBtn disabled={done} onClick={() => set((value ?? 1000) * 10)} aria-label="Multiply the guess by ten">
              × 10
            </StepBtn>
          </div>
        </div>

        <NumberField label="My guess" unit="tok/s" value={text} onChange={setText} disabled={done} />
        {value !== null && (value < LO || value > HI) && !done && (
          <p className="text-[13px] text-amber">Outside {LO} to {HI.toLocaleString('en-US')}: that is fine, we will grade it as typed.</p>
        )}

        <ConfidencePicker value={conf} onChange={setConf} disabled={done} />
        <p className="text-[13px] text-text-3">
          Guessing is the point: a wrong guess you committed to teaches more than a right answer you read.
        </p>
      </StepForm>
    </section>
  )
}
