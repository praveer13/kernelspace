import { useMemo, useState } from 'react'
import ConfidencePicker from '@/components/learner/ConfidencePicker'
import { CHAT_TOKENS, fmt, guessMatchesAggregate } from '@/lib/boot/model'
import type { Confidence } from '@/lib/ledger/types'
import { freshSeed, shuffledOrder } from '@/lib/rng'
import { cn } from '@/lib/utils'
import { DerivedChip } from './Chip'
import { confidenceKey, useStepClock, type StepProps } from './session'
import { StepForm, StepTitle, Verdict } from './ui'
import { CORRECT, OPTIONS } from './whyBatching'

export default function Reveal({ model, guess, commit, next }: StepProps) {
  const clock = useStepClock()
  const [seed] = useState(freshSeed)
  const order = useMemo(() => shuffledOrder(OPTIONS.length, seed), [seed])
  const [pick, setPick] = useState<number | null>(null)
  const [conf, setConf] = useState<Confidence | undefined>()
  const [done, setDone] = useState(false)
  const wrongReason = guess !== null && guessMatchesAggregate(guess, model.aggregateTps)

  const check = () => {
    if (pick === null) return
    const ok = pick === CORRECT
    commit('why-batching', clock(), { kind: 'item', ok, score: ok ? 1 : 0, conf, seed, data: { src: 'boot', pick: [pick] } })
    setDone(true)
  }

  return (
    <section onKeyDown={done ? undefined : (e) => confidenceKey(e, setConf)} aria-labelledby="boot-step-title">
      <StepTitle kicker="0x05 — the reveal">
        {fmt.tpsRound(model.aggregateTps)} is what the GPU delivers across {fmt.chats(model.kvTokens / CHAT_TOKENS).replace('about ', '~')} users, not to one
      </StepTitle>

      <div className="mt-3 space-y-3 text-body text-text-2">
        <p>
          That <DerivedChip of="aggregateTps">{fmt.tpsRound(model.aggregateTps)}</DerivedChip> is what batching buys: <DerivedChip of="chats">{fmt.chats(model.kvTokens / CHAT_TOKENS)}</DerivedChip> chats, one token each per step of{' '}
          <DerivedChip of="stepSeconds">{fmt.ms(model.stepSeconds)}</DerivedChip>. Divided among them, each user gets about{' '}
          <DerivedChip of="perUserTps">{Math.round(model.perUserTps)} tok/s</DerivedChip>, less than the <DerivedChip of="decodeTps">{fmt.tps(model.decodeTps)}</DerivedChip> a
          lone user gets.
        </p>
        {wrongReason && guess !== null && (
          <p className="rounded-md border border-amber/50 bg-amber/5 p-3 text-body-sm">
            <strong className="text-text-1">Right number, wrong reason.</strong> You guessed {Math.round(guess).toLocaleString('en-US')} tok/s for one user. That
            is about what the whole GPU delivers to all of its users together; a single user tops out near {fmt.tps(model.decodeTps)}.
          </p>
        )}
      </div>

      <StepForm
        done={done}
        canCheck={pick !== null}
        onCheck={check}
        onNext={next}
        feedback={
          <Verdict tone={pick === CORRECT ? 'good' : 'miss'} lead={pick === CORRECT ? 'Yes.' : 'Not that one.'}>
            <ul className="space-y-2">
              {order.map((i, pos) => (
                <li key={i} className={cn(i === CORRECT && 'text-text-1')}>
                  <span className="font-mono text-text-3">{String.fromCharCode(65 + pos)}</span>{' '}
                  <strong>{i === CORRECT ? 'Correct.' : i === pick ? 'Your pick, not right.' : 'Not right.'}</strong> {OPTIONS[i].why(model)}
                </li>
              ))}
            </ul>
          </Verdict>
        }
      >
        <fieldset disabled={done} className="space-y-2 border-0 p-0">
          <legend className="mb-2 text-body text-text-1">Why does batching raise total tokens per second but not each user's speed?</legend>
          {order.map((i, pos) => (
            <label
              key={i}
              className={cn(
                'flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 text-body-sm text-text-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                pick === i ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line bg-surface-2',
                done && 'cursor-default',
              )}
            >
              <input
                type="radio"
                name="why-batching"
                checked={pick === i}
                onChange={() => setPick(i)}
                className="mt-1 size-4 shrink-0 accent-accent"
              />
              <span>
                <span className="mr-2 font-mono text-text-3">{String.fromCharCode(65 + pos)}</span>
                {OPTIONS[i].text}
              </span>
            </label>
          ))}
        </fieldset>
        <ConfidencePicker value={conf} onChange={setConf} disabled={done} />
      </StepForm>
    </section>
  )
}
