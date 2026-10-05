/**
 * ItemCard: the one player for every `PlayableItem` (generated, checkpoint, constructed response,
 * authored; docs/specs/wave-1.md §5.1, §6.8, §8.1). A `<form>`, one item at a time, full width.
 *
 * Keys, while focus is in the card and not in a text field: A–D pick (E for a fifth option), 1–3 set
 * confidence once something is answered, Enter submits and, after the verdict, goes to the next item,
 * Escape closes the steps. In a field Enter submits too; in the constructed-response box it is a
 * newline, and Ctrl or ⌘ plus Enter continues. After Submit the verdict is announced through an
 * `aria-live` region and focus moves to Next (§15.3, §16.2).
 *
 * The card grades and reports (`onResult`); it records nothing. Today, tickets, test-out and placement own
 * the session and the ledger write. Key the card by item and seed (`key={`${ref}:${seed}`}`) so a new item
 * starts clean. Respects reduced motion: no transition runs on an item change.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'
import ConfidencePicker from '@/components/learner/ConfidencePicker'
import { loadFamily } from '@/lib/items/registry'
import {
  defaultSeed,
  emptyDraft,
  gradeItem,
  hasAnswer,
  keyAction,
  playView,
  resultFor,
  responseFor,
  togglePick,
  type Draft,
  type ItemResult,
  type KeyTarget,
  type PlayResponse,
} from '@/lib/items/play'
import type { Gen, Grade, PlayableItem, SolutionStep } from '@/lib/items/types'
import type { Confidence } from '@/lib/ledger/types'
import { cn } from '@/lib/utils'
import ChoiceAnswer from './ChoiceAnswer'
import ConstructedAnswer from './ConstructedAnswer'
import EstimateAnswer from './EstimateAnswer'
import Feedback from './Feedback'
import NumericAnswer from './NumericAnswer'
import PromptView from './PromptView'

export interface ItemCardProps {
  item: PlayableItem
  /** Shuffles the options. Fresh per attempt for a new order; the default is stable for the item. */
  seed?: number
  /** The generated item's family, for its ratio rules and solution steps. Loaded on demand when omitted. */
  gen?: Gen
  /** Called once, on Submit, with everything needed to write the ledger event. */
  onResult?: (result: ItemResult) => void
  /** Called by Next (or Enter after the verdict). Without it the card has no Next button. */
  onNext?: () => void
  nextLabel?: string
  /** Prequestions: keep the answer, show no verdict now (`onResult` still carries the grade). */
  deferVerdict?: boolean
  /** Show the optional confidence row (default true). Constructed responses never show it. */
  confidence?: boolean
  /** A line above the question, such as "item 3 of 9 · ~7 min left". */
  eyebrow?: ReactNode
  /** Focus the first control on mount. */
  autoFocus?: boolean
  className?: string
}

type Phase = { done: false } | { done: true; response: PlayResponse; grade: Grade }

export default function ItemCard({
  item,
  seed: seedProp,
  gen: genProp,
  onResult,
  onNext,
  nextLabel = 'Next',
  deferVerdict = false,
  confidence = true,
  eyebrow,
  autoFocus = false,
  className,
}: ItemCardProps) {
  const uid = useId()
  const seed = seedProp ?? defaultSeed(item)
  const view = useMemo(() => playView(item, seed), [item, seed])
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(view))
  const [conf, setConf] = useState<Confidence | undefined>()
  const [phase, setPhase] = useState<Phase>({ done: false })
  const [problem, setProblem] = useState<string | null>(null)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [loaded, setLoaded] = useState<Gen | null>(genProp ?? null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const startedAt = useRef<number | null>(null)

  const gen = genProp ?? loaded
  const isGen = item.source === 'gen'
  const family = item.source === 'gen' ? item.inst.family : ''

  // A generated item's checker (ratio rules, solution steps) loads lazily when the caller has not
  // already loaded the family to make the instance.
  useEffect(() => {
    if (!isGen || genProp) return
    let live = true
    loadFamily(family)
      .then((g) => {
        if (live) {
          setLoaded(g)
          setLoadError(false)
        }
      })
      .catch(() => {
        if (live) setLoadError(true)
      })
    return () => {
      live = false
    }
  }, [isGen, genProp, family, attempt])

  useEffect(() => {
    startedAt.current = Date.now()
    if (!autoFocus) return
    formRef.current?.querySelector<HTMLElement>('[data-ks-option], [data-ks-field]')?.focus()
  }, [autoFocus])

  // After the verdict the next control takes focus (the unmounted Submit button left it nowhere).
  const done = phase.done
  useEffect(() => {
    if (done) (nextRef.current ?? formRef.current)?.focus()
  }, [done])

  // Revealing the model answer unmounts the reveal button, which held focus: move it to the model answer.
  const revealed = draft.kind === 'cr' && draft.revealed
  useEffect(() => {
    if (revealed) formRef.current?.querySelector<HTMLElement>('[data-ks-model]')?.focus()
  }, [revealed])

  const steps: readonly SolutionStep[] | undefined = useMemo(
    () => (phase.done && item.source === 'gen' && gen ? gen.solution(item.inst) : undefined),
    [phase.done, item, gen],
  )

  const awaitingGen = isGen && !gen
  const primaryLabel = view.kind === 'cr' && draft.kind === 'cr' && !draft.revealed ? 'Show the model answer' : 'Submit'

  const submit = useCallback(() => {
    // when the family's checker cannot load, grade by the shared rules so the item is not stuck
    if (phase.done || (awaitingGen && !loadError)) return
    const built = responseFor(draft)
    if (!built.ok) {
      setProblem(built.problem)
      formRef.current?.querySelector<HTMLElement>('[data-ks-field]')?.focus()
      return
    }
    setProblem(null)
    const grade = gradeItem(item, built.response, gen ?? undefined)
    const ms = startedAt.current === null ? 0 : Date.now() - startedAt.current
    setPhase({ done: true, response: built.response, grade })
    onResult?.(resultFor(item, built.response, grade, { seed, ms, ...(conf ? { conf } : {}) }))
  }, [phase.done, awaitingGen, loadError, draft, item, gen, onResult, seed, conf])

  /** The card's primary action: reveal the model answer, submit, or (after the verdict) go on. */
  const act = useCallback(() => {
    if (phase.done) onNext?.()
    else if (draft.kind === 'cr' && !draft.revealed) setDraft({ ...draft, revealed: true })
    else submit()
  }, [phase.done, onNext, draft, submit])

  const toggleOption = (id: string) => {
    if (phase.done || view.kind !== 'choice') return
    setProblem(null)
    setDraft((d) => (d.kind === 'choice' ? { ...d, picks: togglePick(d.picks, id, view.multi) } : d))
  }

  const closeSteps = () => {
    setStepsOpen(false)
    toggleRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return
    const t = e.target as HTMLElement
    const target: KeyTarget = t.hasAttribute('data-ks-option')
      ? 'option'
      : t instanceof HTMLButtonElement
        ? 'button'
        : t instanceof HTMLInputElement
          ? 'input'
          : t instanceof HTMLTextAreaElement
            ? 'textarea'
            : t instanceof HTMLSelectElement
              ? 'select'
              : 'other'
    const action = keyAction(
      {
        stepsOpen,
        done: phase.done,
        kind: view.kind,
        optionCount: view.kind === 'choice' ? view.options.length : 0,
        answered: hasAnswer(draft),
        confidence,
      },
      { key: e.key, repeat: e.repeat, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, target },
    )
    if (action.type === 'none') return
    e.preventDefault()
    if (action.type === 'close-steps') {
      e.stopPropagation()
      closeSteps()
    } else if (action.type === 'act') act()
    else if (action.type === 'pick' && view.kind === 'choice') toggleOption(view.options[action.index].id)
    else if (action.type === 'confidence') setConf(action.conf)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    act()
  }

  const idBase = `${uid}-item`
  const grade = phase.done ? phase.grade : null
  const locked = phase.done
  // a deferred verdict (prequestions) shows neither the key nor the worked results yet
  const showKey = locked && !deferVerdict
  const showConf = confidence && view.kind !== 'cr' && (hasAnswer(draft) || conf !== undefined)

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onKeyDown={onKeyDown}
      noValidate
      tabIndex={-1}
      aria-label="Question"
      className={cn('min-w-0 max-w-full rounded-lg focus:outline-none border border-line bg-surface-1 p-4 sm:p-5', className)}
    >
      {eyebrow && <p className="mb-3 font-mono text-[11px] uppercase text-text-3">{eyebrow}</p>}
      <div id={`${idBase}-q`}>
        <PromptView prompt={view.prompt} revealed={showKey} />
      </div>

      <div className="mt-4">
        {view.kind === 'choice' && draft.kind === 'choice' && (
          <ChoiceAnswer
            options={view.options}
            picks={draft.picks}
            {...(showKey ? { correct: view.correct } : {})}
            multi={view.multi}
            disabled={locked}
            onToggle={toggleOption}
            labelledBy={`${idBase}-q`}
          />
        )}
        {view.kind === 'numeric' && draft.kind === 'numeric' && (
          <NumericAnswer
            answer={view.answer}
            text={draft.text}
            unit={draft.unit}
            onText={(text) => {
              setProblem(null)
              setDraft({ ...draft, text })
            }}
            onUnit={(unit) => setDraft({ ...draft, unit })}
            disabled={locked}
            problem={problem}
          />
        )}
        {view.kind === 'estimate' && draft.kind === 'estimate' && (
          <EstimateAnswer
            answer={view.answer}
            text={draft.text}
            lo={draft.lo}
            hi={draft.hi}
            range={draft.range}
            onText={(text) => {
              setProblem(null)
              setDraft({ ...draft, text })
            }}
            onLo={(lo) => setDraft({ ...draft, lo })}
            onHi={(hi) => setDraft({ ...draft, hi })}
            onRange={(range) => setDraft({ ...draft, range })}
            disabled={locked}
            problem={problem}
          />
        )}
        {view.kind === 'cr' && draft.kind === 'cr' && (
          <ConstructedAnswer
            cr={view.cr}
            text={draft.text}
            ideas={draft.ideas}
            revealed={draft.revealed}
            onText={(text) => setDraft({ ...draft, text })}
            onReveal={() => setDraft({ ...draft, revealed: true })}
            onIdea={(i, on) => setDraft({ ...draft, ideas: draft.ideas.map((v, j) => (j === i ? on : v)) as [boolean, boolean, boolean] })}
            disabled={locked}
          />
        )}
        {view.kind === 'choice' && problem && (
          <p role="alert" className="mt-2 text-body-sm text-amber">
            {problem}
          </p>
        )}
      </div>

      {showConf && <ConfidencePicker className="mt-3" value={conf} onChange={setConf} disabled={locked} />}

      {loadError && (
        <p role="alert" className="mt-3 text-body-sm text-amber">
          Could not load this question&apos;s checker, so Submit grades by the shared rules.{' '}
          <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!phase.done && (
          <button
            type="submit"
            disabled={awaitingGen && !loadError}
            className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground disabled:cursor-wait disabled:opacity-60 motion-safe:transition-transform motion-safe:duration-150 motion-safe:active:scale-[.97]"
          >
            {primaryLabel}
            <kbd className="ml-2 hidden rounded border border-accent-foreground/30 px-1 font-mono text-[10px] md:inline">Enter</kbd>
          </button>
        )}
      </div>

      <div className="mt-4">
        <Feedback
          view={view}
          grade={grade}
          picks={draft.kind === 'choice' ? draft.picks : []}
          deferred={deferVerdict}
          {...(steps ? { steps } : {})}
          stepsOpen={stepsOpen}
          onToggleSteps={() => setStepsOpen((o) => !o)}
          toggleRef={toggleRef}
          idBase={idBase}
        />
      </div>

      {phase.done && onNext && (
        <div className="mt-4">
          <button
            ref={nextRef}
            type="button"
            onClick={onNext}
            className="min-h-11 rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground"
          >
            {nextLabel}
            <kbd className="ml-2 hidden rounded border border-accent-foreground/30 px-1 font-mono text-[10px] md:inline">Enter</kbd>
          </button>
        </div>
      )}
    </form>
  )
}
