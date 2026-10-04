import { useState } from 'react'
import { BOOT_CLAIMS, CHAT_TOKENS, TOLERANCE, bootInputs, fmt, gradeNear } from '@/lib/boot/model'
import { ClaimChip, DerivedChip } from './Chip'
import { useStepClock, parseNumber, type StepProps } from './session'
import { NumberField, StepForm, StepTitle, Verdict } from './ui'

export default function Catch({ model, commit, next }: StepProps) {
  const clock = useStepClock()
  const [text, setText] = useState('')
  const [done, setDone] = useState<null | { ok: boolean }>(null)
  const value = parseNumber(text)
  const { capacity, kvPerToken } = bootInputs()
  const kib = fmt.kib(kvPerToken) // the claim restated in KiB, so a changed claim reaches the copy
  const weightsPct = Math.round((model.weightsBytes / capacity) * 100)

  const check = () => {
    if (value === null) return
    const g = gradeNear(value, model.kvTokens, TOLERANCE.kvTokens)
    commit('kv-tokens', clock(), { kind: 'item', ...g, data: { src: 'boot', value } })
    setDone({ ok: g.ok })
  }

  return (
    <section aria-labelledby="boot-step-title">
      <StepTitle kicker="0x04 — the catch">Why not just batch a thousand users?</StepTitle>
      <p className="mt-3 text-body text-text-2">
        Every conversation keeps a KV cache: the keys and values of every token so far, which the GPU re-reads on each step. The card has{' '}
        <ClaimChip id={BOOT_CLAIMS.capacity} />. The weights take <DerivedChip of="weightsBytes">{fmt.gb(model.weightsBytes)}</DerivedChip> of it, leaving
        roughly {fmt.gb(capacity - model.weightsBytes)} for caches. Llama-3-8B needs <ClaimChip id={BOOT_CLAIMS.kvPerToken} /> ({kib}) of cache for
        each token of context.
      </p>

      <StepForm
        done={done !== null}
        canCheck={value !== null}
        onCheck={check}
        onNext={next}
        feedback={
          done && (
            <Verdict tone={done.ok ? 'good' : 'miss'} lead={done.ok ? 'Yes.' : `Not quite: it is ${fmt.kTokens(model.kvTokens)} tokens.`}>
              <p>
                <DerivedChip of="kvTokens">{fmt.kTokens(model.kvTokens)} tokens</DerivedChip> fit. At {CHAT_TOKENS.toLocaleString('en-US')} tokens per chat
                (scenario, not a claim) that is <DerivedChip of="chats">{fmt.chats(model.kvTokens / CHAT_TOKENS)}</DerivedChip> chats, and then memory is full.
              </p>
              <div aria-hidden className="flex h-4 overflow-hidden rounded-sm border border-line">
                <div className="bg-info" style={{ width: `${weightsPct}%` }} />
                <div className="bg-accent" style={{ width: `${100 - weightsPct}%` }} />
              </div>
              <p className="text-[13px] text-text-3">
                Memory: weights {weightsPct}% (blue), KV caches {100 - weightsPct}% (green), nothing left.
              </p>
              <p>
                Now every step reads the weights <em>and</em> all those caches: <DerivedChip of="stepBytes">{fmt.gb(model.stepBytes)}</DerivedChip> per step, which at
                full bandwidth takes <DerivedChip of="stepSeconds">{fmt.ms(model.stepSeconds)}</DerivedChip>. Even so, the math is{' '}
                <DerivedChip of="mathIdleAtBatch">{fmt.pctTen(model.mathIdleAtBatch)}</DerivedChip> idle. The ridge needs a batch near{' '}
                <DerivedChip of="ridge">{fmt.ridge(model.ridge)}</DerivedChip>; memory runs out at {fmt.chats(model.kvTokens / CHAT_TOKENS).replace('about ', '~')}.
              </p>
            </Verdict>
          )
        }
      >
        <NumberField
          label={`${fmt.gb(capacity - model.weightsBytes)} left at ${kib} per token: how many tokens of context fit?`}
          unit="tokens"
          value={text}
          onChange={setText}
          disabled={done !== null}
          hint={`Within ${TOLERANCE.kvTokens * 100}% counts.`}
        />
      </StepForm>
    </section>
  )
}
