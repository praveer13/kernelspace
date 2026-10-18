/**
 * A Fleet exercise inside a lesson (docs/specs/wave-3.md §5.3, task 3b-20): draw a fresh seed, read what it gives the
 * engine, predict a number, see the sweep the fleet worker ran on it, explain what you saw, and repeat until three
 * predictions in a row are right on at least two different answers. `ExerciseView` mounts it for a `fleet` block
 * (3a-03), so only fleet blocks (3c-06) reach it.
 *
 * Each round is draw → predict → explain → saved (session.ts). The sweep runs on `freshSeed()` and is kept only if it
 * is a fair question; its outcome stays hidden while the learner reads the seed's scene and locks a prediction, and the
 * chart and its table follow the verdict. The explain step wants a line of 8 words or more, which opens the model
 * answer and its three ideas, and all three must be ticked before the round saves. The line is never stored. A saved
 * round writes one `item item:fleet.<id>` event; the first round of the block also writes its one `predict`. A reload
 * rebuilds the count from those events, so "3/3 · done" is never asked twice. Nothing locks: more seeds are always on
 * offer.
 *
 * On a phone (or with the phone preference) the predict step is the same, on the exercise's canonical seed and its
 * scene, and the outcome is that seed's, which earns nothing; the fresh-seed run is one tap away ("run it here instead").
 *
 * The block's note ("What just happened") states the answer rule, so it stays hidden until there is nothing left for it
 * to spoil, as a sim exercise's does: in embed mode until the exercise is done, in phone mode once the canonical seed is
 * locked and its outcome shown.
 *
 * The worker, the ledger, the clock and the seed come in through `env`, so tests replace them (as ProveFromModule's do).
 */

import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import { Check, CircleDashed, Lock } from 'lucide-react'
import { clsx as cn } from 'clsx' // not twMerge: it drops `text-body-sm` next to a `text-text-*` colour
import type { FleetExerciseBlock } from '@/data/lessons/types'
import type { Confidence, ItemResponse } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import { freshSeed } from '@/lib/rng'
import { hitArea, resolveInlineMode, usePhoneViewport } from '@/lib/sims/host'
import { FLEET_EXERCISES, type FleetExerciseDef, type SweepResult } from '@/lib/world/fleet-ex'
import { ProseView } from '@/pages/lesson/prose'
import ProductionRows from './ProductionRows'
import SweepChart from './SweepChart'
import {
  ANSWERS_NEEDED,
  IDEA_COUNT,
  MAX_EXPLAIN_CHARS,
  MIN_EXPLAIN_WORDS,
  NoFairSeed,
  PASSES_NEEDED,
  canSave,
  askFor,
  copyFor,
  drawFairSweep,
  entryText,
  exerciseEventOf,
  exerciseRef,
  explainReady,
  freshRound,
  itemEvent,
  parsePrediction,
  predictEvent,
  progressText,
  readExercise,
  reduceRound,
  sceneLine,
  sweepTable,
  verdictText,
  wordCount,
  type ExerciseCopy,
  type ExerciseEvent,
  type Round,
} from './session'

export interface FleetExerciseEnv {
  /** Runs the exercise's sweep in the fleet worker. */
  run(id: string, seed: number): Promise<SweepResult>
  /** A fresh uint32 seed. */
  seed(): number
  now(): number
  /** The ledger's events whose ref starts with the prefix. */
  history(refPrefix: string): Promise<ExerciseEvent[]>
  record(items: ItemResponse[]): void
  /** Forces the mode; by default the viewport and `today:prefs` decide, as for a sim exercise. */
  mode?: 'phone' | 'embed'
}

export interface FleetExerciseProps {
  block: FleetExerciseBlock
  lessonId: string
  /** The block's index in the lesson, which keys its `grp` (`<lessonId>#<index>`). */
  index: number
  /** The worker, the ledger, the clock and the seed; tests replace them. */
  env?: Partial<FleetExerciseEnv>
}

const liveEnv: FleetExerciseEnv = {
  // the worker client loads only when a sweep runs, through ./live (it says why it is not imported directly)
  run: async (id, seed) => (await import('./live')).runSweep(id, seed),
  seed: freshSeed,
  now: () => Date.now(),
  history: async (refPrefix) => (await useProgress.controls.engine()).events({ refPrefix }),
  record: (items) => useProgress.getState().recordItems(items),
}

const CONFIDENCE: readonly { id: Confidence; label: string }[] = [
  { id: 'guess', label: 'guess' },
  { id: 'think', label: 'think so' },
  { id: 'sure', label: 'sure' },
]

const primaryBtn =
  'flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 hover:-translate-y-px active:scale-[.97] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3 disabled:hover:translate-y-0'
const quietBtn =
  'flex items-center rounded-md border border-line bg-surface-3 px-3.5 py-2 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]'

export default function FleetExercise({ block, lessonId, index, env }: FleetExerciseProps) {
  const def = Object.hasOwn(FLEET_EXERCISES, block.fleet) ? FLEET_EXERCISES[block.fleet] : undefined
  const copy = def === undefined ? null : copyFor(def.id)
  // an id nothing registers (or registers without copy) draws nothing: the hands-on test and the exercise's own test catch it
  if (def === undefined || copy === null) return null
  return <Panel block={block} lessonId={lessonId} index={index} env={env} def={def} copy={copy} />
}

type Def = FleetExerciseDef

interface PanelProps extends FleetExerciseProps {
  def: Def
  copy: ExerciseCopy
}

type Load = 'loading' | 'ready' | 'error'
interface Failure {
  title: string
  detail: string
}

/** What a failed sweep says. A timeout is named by its class so the worker client stays out of this chunk until a sweep runs. */
function failureOf(e: unknown): Failure {
  if (e instanceof NoFairSeed) return { title: 'No fair seed turned up', detail: 'Sixteen fresh seeds in a row made a sweep that is not a fair question. That is a fault in the exercise, not in your prediction. Try again.' }
  if (e instanceof Error && e.name === 'FleetTimeoutError') return { title: 'The sweep took too long', detail: 'The fleet worker did not answer within its 10 s budget and was stopped. Nothing was asked yet. Run it again.' }
  return { title: 'The sweep did not run', detail: e instanceof Error ? e.message : String(e) }
}

function Panel({ block, lessonId, index, env: envIn, def, copy }: PanelProps) {
  const env = useMemo<FleetExerciseEnv>(() => ({ ...liveEnv, ...envIn }), [envIn])
  const at = useMemo(() => ({ id: def.id, lessonId, index, needs: PASSES_NEEDED }), [def.id, lessonId, index])
  const ctx = useMemo(() => ({ lessonId, index }), [lessonId, index])
  const uid = useId()
  const phoneViewport = usePhoneViewport()
  const prefs = useProgress((s) => s.working['today:prefs'])
  const [forceEmbed, setForceEmbed] = useState(false)
  // the phone prediction on the canonical seed, once locked: held here so the note follows it and a remount keeps it
  const [phoneLock, setPhoneLock] = useState<number | null>(null)
  const mode = env.mode ?? (forceEmbed ? 'embed' : resolveInlineMode(phoneViewport, prefs))

  const [load, setLoad] = useState<Load>('loading')
  const [attempt, setAttempt] = useState(0)
  const [events, setEvents] = useState<ExerciseEvent[]>([])

  const [round, dispatch] = useReducer((r: Round, a: Parameters<typeof reduceRound>[2]) => reduceRound(def, r, a), undefined, () => freshRound(env.now()))
  const [draft, setDraft] = useState('')
  const [conf, setConf] = useState<Confidence | undefined>()
  const [invalid, setInvalid] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [runs, setRuns] = useState(0)

  // the round still open in this tab is not yet a round left unsaved; one found in the ledger at mount is
  const state = useMemo(() => readExercise(events, at, round.phase === 'explain' ? round.seed : undefined), [events, at, round.phase, round.seed])

  const local = useRef(0)
  const predictedRef = useRef(false)
  const lockedRef = useRef<number | undefined>(undefined)
  const usedRef = useRef<ReadonlySet<number>>(new Set())

  const inputRef = useRef<HTMLInputElement>(null)
  const drawRef = useRef<HTMLButtonElement>(null)
  const drawingRef = useRef<HTMLParagraphElement>(null)
  const explainRef = useRef<HTMLTextAreaElement>(null)
  const ideaRef = useRef<HTMLInputElement>(null)
  const savedRef = useRef<HTMLParagraphElement>(null)
  const prevPhase = useRef(round.phase)

  // What the ledger already holds: a reload keeps the count.
  useEffect(() => {
    let live = true
    env.history(exerciseRef(def.id)).then(
      (evs) => {
        if (!live) return
        predictedRef.current = readExercise(evs, at).predicted
        setEvents(evs)
        setLoad('ready')
      },
      () => {
        if (live) setLoad('error')
      },
    )
    return () => {
      live = false
    }
  }, [env, def.id, at, attempt])

  const write = useCallback(
    (response: ItemResponse) => {
      env.record([response])
      local.current += 1
      setEvents((evs) => [...evs, exerciseEventOf(response, new Date(env.now()).toISOString(), `local:${local.current}`)])
    },
    [env],
  )

  // The draw: fair seeds until one sweeps in band, its outcome held back until the lock; "run it again" draws anew.
  const drawing = round.phase === 'draw'
  useEffect(() => {
    if (!drawing) return
    let live = true
    drawFairSweep(def, { used: usedRef.current, draw: env.seed, run: env.run }).then(
      ({ seed, result }) => {
        if (live) dispatch({ type: 'swept', seed, result, at: env.now() })
      },
      (e: unknown) => {
        if (live) setFailure(failureOf(e))
      },
    )
    return () => {
      live = false
    }
  }, [drawing, runs, def, env])

  useEffect(() => {
    usedRef.current = state.seeds
  }, [state.seeds])

  // A round's prediction event, as soon as its lock is graded and before anything is explained: a round that is locked
  // and never saved is then still on the record, and counts as a miss when the panel next restores (D39, D48).
  useEffect(() => {
    if (round.phase !== 'explain' || round.seed === undefined || lockedRef.current === round.seed) return
    lockedRef.current = round.seed
    const first = !predictedRef.current
    predictedRef.current = true
    write(predictEvent(def, ctx, round, first))
  }, [round, def, ctx, write])

  // Focus follows the step: the control that was pressed unmounts, so hand focus to what comes next.
  useEffect(() => {
    const was = prevPhase.current
    prevPhase.current = round.phase
    if (was === round.phase) return
    const next =
      round.phase === 'draw' ? drawingRef : round.phase === 'predict' ? inputRef : round.phase === 'explain' ? explainRef : round.phase === 'saved' ? savedRef : null
    next?.current?.focus({ preventScroll: true })
  }, [round.phase])
  useEffect(() => {
    if (revealed) ideaRef.current?.focus()
  }, [revealed])
  // "Run it on a fresh seed here instead" unmounts the phone outcome that held focus: the draw button is what comes next
  useEffect(() => {
    if (forceEmbed && load === 'ready') drawRef.current?.focus({ preventScroll: true })
  }, [forceEmbed, load])

  const commit = () => {
    const prediction = parsePrediction(def, draft)
    if (prediction === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    dispatch({ type: 'commit', prediction, conf, at: env.now() })
  }

  const save = () => {
    const savedAt = env.now()
    const next = reduceRound(def, round, { type: 'save', at: savedAt })
    if (next.phase !== 'saved') return
    dispatch({ type: 'save', at: savedAt })
    write(itemEvent(def, ctx, next))
  }

  const another = () => {
    setDraft('')
    setConf(undefined)
    setInvalid(false)
    setRevealed(false)
    setFailure(null)
    dispatch({ type: 'next', at: env.now() })
  }

  const entry = entryText(def, copy)
  const verdict = round.result !== undefined && round.prediction !== undefined ? verdictText(def, copy, round.prediction, round.result) : null
  const table = round.result !== undefined ? sweepTable(def, copy, round.result, round.prediction) : null
  const ready = explainReady(round.explain)

  return (
    <section
      className="my-8 overflow-hidden rounded-lg border border-line bg-surface-1"
      data-block="fleet-exercise"
      data-exercise={def.id}
      data-lesson={lessonId}
      data-block-index={index}
      data-mode={mode}
      data-phase={round.phase}
      aria-label={block.title}
      aria-busy={load === 'loading'}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-label uppercase text-accent">Exercise</span>
          <span className="font-display text-body-sm font-medium text-text-1">{block.title}</span>
        </div>
        <p role="status" aria-live="polite" data-fleet-progress className="font-mono text-body-sm text-text-2">
          {load === 'ready' && mode === 'embed' ? progressText(state, PASSES_NEEDED) : ''}
        </p>
      </div>

      <div className="px-5 py-4">
        <p className="text-body-sm text-text-2">{copy.setup}</p>

        {mode === 'phone' ? (
          <PhoneOutcome def={def} copy={copy} entry={entry} locked={phoneLock} onLock={setPhoneLock} onEmbed={() => setForceEmbed(true)} />
        ) : (
          <>
            {load === 'loading' && <p className="mt-3 min-h-11 font-mono text-body-sm text-text-3">loading…</p>}
            {load === 'error' && (
              <div role="alert" className="mt-3">
                <p className="text-body-sm text-text-1">Could not load your earlier rounds.</p>
                <button type="button" onClick={() => {
                    setLoad('loading')
                    setAttempt((n) => n + 1)
                  }}
                  className={cn(quietBtn, 'mt-3', hitArea(true))}>
                  Try again
                </button>
              </div>
            )}

            {load === 'ready' && (
              <>
                {state.played.length > 0 && round.phase !== 'draw' && round.phase !== 'explain' && <Played played={state.played} copy={copy} />}
                {state.done && round.phase !== 'explain' && round.phase !== 'saved' && (
                  <p className="mt-3 text-body-sm text-text-1" data-fleet-done>
                    {PASSES_NEEDED} right predictions in a row on new seeds, on at least {ANSWERS_NEEDED} different answers. Done. There are always more seeds.
                  </p>
                )}

                {/* 1. draw: a fresh seed whose sweep is a fair question; its outcome stays hidden */}
                {round.phase === 'start' && (
                  <div className="mt-4">
                    <p className="text-body-sm text-text-2">
                      Each round draws a fresh seed and shows what it gives the engine. You predict from that; the sweep&apos;s outcome stays hidden until you lock in.
                      Three right in a row, on at least {ANSWERS_NEEDED} different answers, finishes the exercise. A round you lock in and leave before saving counts as a miss.
                    </p>
                    <button type="button" ref={drawRef} data-fleet-draw onClick={() => dispatch({ type: 'draw' })} className={cn(primaryBtn, 'mt-3', hitArea(false))}>
                      Draw a fresh seed
                    </button>
                  </div>
                )}
                {round.phase === 'draw' && (
                  <div className="mt-3">
                    <p ref={drawingRef} tabIndex={-1} className="flex items-start gap-2 text-body-sm text-text-2 outline-none">
                      <CircleDashed size={14} className="mt-0.5 shrink-0 text-text-3" aria-hidden />
                      <span>{failure === null ? 'Drawing a fresh seed and running the sweep in the fleet worker. Its outcome stays hidden until you predict…' : 'The sweep stopped.'}</span>
                    </p>
                    {failure !== null && (
                      <div role="alert" className="mt-2 rounded-sm border-l-2 border-amber bg-surface-3 px-2.5 py-2 text-body-sm">
                        <p className="font-medium text-text-1">{failure.title}</p>
                        <p className="text-text-2">{failure.detail}</p>
                        <button
                          type="button"
                          data-fleet-retry
                          onClick={() => {
                            setFailure(null)
                            setRuns((n) => n + 1)
                          }}
                          className={cn(quietBtn, 'mt-2', hitArea(false))}
                        >
                          Run it again
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {round.seed !== undefined && <Scene id={`${uid}-scene`} def={def} seed={round.seed} fresh />}

                {/* 2. predict: a number, from the scene, before any outcome is shown */}
                {(round.phase === 'predict' || round.prediction !== undefined) && (
                  <fieldset className="mt-4 min-w-0" disabled={round.phase !== 'predict'}>
                    <legend className="mb-1.5 text-body-sm font-medium text-text-1">Predict {askFor(def, round.seed)}.</legend>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={inputRef}
                        data-fleet-predict
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={round.prediction !== undefined ? String(round.prediction) : draft}
                        onChange={(e) => {
                          setDraft(e.target.value)
                          setInvalid(false)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            commit()
                          }
                        }}
                        aria-label={`Your prediction: ${askFor(def, round.seed)}`}
                        aria-invalid={invalid}
                        aria-describedby={`${uid}-scene ${uid}-allowed${invalid ? ` ${uid}-err` : ''}`}
                        className={cn(hitArea(false), 'h-9 w-28 min-w-0 rounded-sm border border-line bg-ink px-2 font-mono text-body-sm text-text-1 disabled:opacity-70 [@media(pointer:coarse)]:h-11')}
                      />
                      <span id={`${uid}-allowed`} className="font-mono text-[11px] text-text-3">
                        {entry.hint}
                      </span>
                    </div>
                    {invalid && (
                      <p id={`${uid}-err`} role="alert" className="mt-1.5 text-[12px] text-danger">
                        {entry.error}
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="How sure are you? (optional)">
                      <span className="mr-1 font-mono text-[10px] uppercase text-text-3">how sure</span>
                      {CONFIDENCE.map((c) => {
                        const shown = round.phase === 'predict' ? conf : round.conf
                        const on = shown === c.id
                        return (
                          <button
                            key={c.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setConf(on ? undefined : c.id)}
                            className={cn(
                              'inline-flex items-center justify-center rounded-xs border px-2.5 py-1 font-mono text-[10px] transition-colors duration-150 disabled:cursor-default',
                              hitArea(false),
                              on ? 'border-line-bright bg-surface-3 text-text-1' : 'border-line text-text-3 hover:text-text-1',
                            )}
                          >
                            {c.label}
                          </button>
                        )
                      })}
                    </div>
                  </fieldset>
                )}

                {round.phase === 'predict' && (
                  <button type="button" data-fleet-lock onClick={commit} className={cn(primaryBtn, 'mt-3', hitArea(false))}>
                    <Lock size={13} strokeWidth={2} aria-hidden />
                    Lock in my prediction
                  </button>
                )}

                {/* the verdict is always mounted, so a result that arrives with its text already in place is still announced */}
                <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                  {verdict === null ? '' : `${verdict.headline} ${verdict.detail}`}
                </div>

                {/* 3. explain */}
                {verdict !== null && round.result !== undefined && table !== null && round.truth !== undefined && (
                  <div className="mt-4 space-y-4">
                    <p
                      className={cn('rounded-sm border-l-2 px-2.5 py-2 text-body-sm text-text-1', verdict.ok ? 'border-accent bg-accent-dim/30' : 'border-amber bg-surface-3')}
                      data-verdict={verdict.ok ? 'right' : 'off'}
                    >
                      <span className="block font-medium">{verdict.headline}</span>
                      <span className="block text-text-2">{verdict.detail}</span>
                    </p>
                    <SweepChart result={round.result} xLabel={copy.xLabel} tickLabel={copy.tickLabel} answer={round.truth} pick={round.prediction} table={table} y={copy.view?.plot} />

                    {round.phase === 'explain' && (
                      <div>
                        <label htmlFor={`${uid}-explain`} className="mb-1.5 block text-body-sm font-medium text-text-1">
                          {copy.explainPrompt}
                        </label>
                        <textarea
                          ref={explainRef}
                          data-fleet-explain
                          id={`${uid}-explain`}
                          value={round.explain}
                          onChange={(e) => dispatch({ type: 'explain', text: e.target.value })}
                          maxLength={MAX_EXPLAIN_CHARS}
                          rows={3}
                          aria-describedby={`${uid}-count`}
                          className="w-full resize-y rounded-sm border border-line bg-ink px-2 py-1.5 text-body-sm text-text-1"
                        />
                        <p id={`${uid}-count`} className="mt-1 font-mono text-[10px] text-text-3">
                          {wordCount(round.explain)}/{MIN_EXPLAIN_WORDS} words{' '}
                          {ready ? '· ready' : `· ${MIN_EXPLAIN_WORDS - wordCount(round.explain)} more opens the model answer`}. Your line stays in this tab and is never saved.
                        </p>
                        {!revealed && (
                          <button type="button" data-fleet-reveal disabled={!ready} onClick={() => setRevealed(true)} className={cn(primaryBtn, 'mt-2', hitArea(false))}>
                            Show the model answer
                          </button>
                        )}
                      </div>
                    )}

                    {revealed && round.phase === 'explain' && (
                      <div className="space-y-2 text-body-sm text-text-2">
                        <p>
                          <span className="font-medium text-text-1">Model answer. </span>
                          {copy.model}
                        </p>
                        <fieldset>
                          <legend className="mb-1 font-mono text-[10px] uppercase text-text-3">
                            Tick the {IDEA_COUNT} ideas your line covers. If it misses one, add it to your line first.
                          </legend>
                          <ul className="space-y-1">
                            {copy.ideas.map((idea, i) => (
                              <li key={i}>
                                <label className={cn('flex cursor-pointer items-center gap-2', hitArea(false))}>
                                  <input
                                    ref={i === 0 ? ideaRef : undefined}
                                    data-fleet-idea={i}
                                    type="checkbox"
                                    checked={round.ideas.includes(i)}
                                    disabled={!ready}
                                    onChange={() => dispatch({ type: 'idea', index: i })}
                                    className="h-4 w-4 shrink-0"
                                  />
                                  <span>{idea}</span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        </fieldset>
                        <button type="button" data-fleet-save onClick={save} disabled={!canSave(round)} className={cn(primaryBtn, hitArea(false))}>
                          Save result
                        </button>
                      </div>
                    )}

                    {/* 4. saved */}
                    {round.phase === 'saved' && (
                      <div className="space-y-2 text-body-sm text-text-2">
                        <p ref={savedRef} tabIndex={-1} className="flex items-center gap-2 text-text-1 outline-none" data-saved>
                          {round.ok === true && <Check size={14} className="text-accent" aria-hidden />}
                          {round.ok === true
                            ? `Saved. A right prediction on a new seed: ${progressText(state, PASSES_NEEDED)}.`
                            : `Saved. A miss starts the run again: ${PASSES_NEEDED} right in a row, on at least ${ANSWERS_NEEDED} different answers, finishes it.`}
                        </p>
                        <button type="button" data-fleet-another onClick={another} className={cn(quietBtn, hitArea(false))}>
                          {state.done ? 'Another seed' : 'Try a new seed'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {def.productionClaims.length > 0 && <ProductionRows claims={def.productionClaims} />}

        {/* the note states the answer rule: shown once the exercise is done, or on a phone once its one seed is locked */}
        {block.note && (state.done || (mode === 'phone' && phoneLock !== null)) && (
          <div className="mt-4 rounded-sm border border-line bg-surface-2 px-2.5 py-2" data-fleet-note>
            <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-text-3">What just happened</p>
            <div className="text-body-sm text-text-2 [&_p]:!text-body-sm">
              <ProseView md={block.note} trackColor="hsl(var(--primary))" compact />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/** The rounds already saved, oldest first: restored from the ledger after a reload. */
function Played({ played, copy }: { played: ReturnType<typeof readExercise>['played']; copy: ExerciseCopy }) {
  return (
    <div className="mt-3" data-fleet-played>
      <p className="font-mono text-[10px] uppercase tracking-wide text-text-3">Earlier rounds</p>
      <ol className="mt-1 space-y-0.5">
        {played.map((p, i) => (
          <li key={`${p.seed}:${i}`} className="font-mono text-[11px] text-text-2">
            {i + 1}. {copy.view !== undefined ? copy.view.played(p.value, p.truth) : `you said ${copy.pointLabel(p.value)}, the peak was ${copy.pointLabel(p.truth)}`}:{' '}
            <span className={p.ok ? 'text-accent' : 'text-text-3'}>{p.ok ? 'right' : p.unsaved ? 'left before saving, counts as off' : 'off'}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** What this seed gives the engine: the facts the answer follows from, and never the sweep's outcome. */
function Scene({ id, def, seed, fresh }: { id: string; def: Def; seed: number; fresh: boolean }) {
  const facts = useMemo(() => def.scene(seed), [def, seed])
  return (
    <div id={id} className="mt-4 rounded-sm border border-line bg-surface-2 px-2.5 py-2" data-fleet-scene>
      <p className="font-mono text-[10px] uppercase tracking-wide text-text-3" data-seed>
        Seed {seed}
        {fresh ? ', drawn fresh' : ', the same on every phone'}
      </p>
      <ul className="mt-1 space-y-0.5 text-body-sm text-text-1">
        {facts.map((f) => (
          <li key={f.label}>{sceneLine(f)}</li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Phone mode: the same prediction, then the exercise's canonical outcome, a fixed seed that earns nothing and writes
 * nothing, because the same answer every time is no evidence. The chart and its table sit open beside each other.
 */
function PhoneOutcome({
  def,
  copy,
  entry,
  locked,
  onLock,
  onEmbed,
}: {
  def: Def
  copy: ExerciseCopy
  entry: { hint: string; error: string }
  /** The locked prediction, or null before the lock. */
  locked: number | null
  onLock: (prediction: number) => void
  onEmbed: () => void
}) {
  const uid = useId()
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const resultRef = useRef<HTMLParagraphElement>(null)
  const canonical = def.phone.canonical
  const verdict = locked === null ? null : verdictText(def, copy, locked, canonical)
  // the lock button that held focus unmounts: hand it to the outcome, but only for a lock made here, not on a remount
  const lockedHere = useRef(false)
  useEffect(() => {
    if (locked === null || !lockedHere.current) return
    lockedHere.current = false
    resultRef.current?.focus({ preventScroll: true })
  }, [locked])

  const submit = () => {
    const prediction = parsePrediction(def, draft)
    if (prediction === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    lockedHere.current = true
    onLock(prediction)
  }

  return (
    <div className="mt-4" data-phone>
      <Scene id={`${uid}-scene`} def={def} seed={def.phone.seed} fresh={false} />
      <fieldset className="mt-4 min-w-0" disabled={locked !== null}>
        <legend className="mb-1.5 text-body-sm font-medium text-text-1">Predict {askFor(def, def.phone.seed)}.</legend>
        <div className="flex flex-wrap items-center gap-2">
          <input
            data-fleet-predict
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={locked !== null ? String(locked) : draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setInvalid(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            aria-label={`Your prediction: ${askFor(def, def.phone.seed)}`}
            aria-invalid={invalid}
            aria-describedby={`${uid}-scene ${uid}-allowed${invalid ? ` ${uid}-err` : ''}`}
            className="h-11 w-28 min-w-0 rounded-sm border border-line bg-ink px-2 font-mono text-body-sm text-text-1 disabled:opacity-70"
          />
          <span id={`${uid}-allowed`} className="font-mono text-[11px] text-text-3">
            {entry.hint}
          </span>
        </div>
        {invalid && (
          <p id={`${uid}-err`} role="alert" className="mt-1.5 text-[12px] text-danger">
            {entry.error}
          </p>
        )}
      </fieldset>
      {locked === null && (
        <button type="button" data-fleet-lock onClick={submit} className={cn(primaryBtn, 'mt-3', hitArea(true))}>
          <Lock size={13} strokeWidth={2} aria-hidden />
          Lock in and show the outcome
        </button>
      )}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {verdict === null ? '' : `${verdict.headline} ${verdict.detail}`}
      </div>
      {verdict !== null && locked !== null && (
        <div className="mt-3 space-y-3">
          <p
            ref={resultRef}
            tabIndex={-1}
            data-verdict={verdict.ok ? 'right' : 'off'}
            className={cn('rounded-sm border-l-2 px-2.5 py-2 text-body-sm text-text-1 outline-none', verdict.ok ? 'border-accent bg-accent-dim/30' : 'border-amber bg-surface-3')}
          >
            <span className="block font-medium">{verdict.headline}</span>
            <span className="block text-text-2">{verdict.detail}</span>
          </p>
          <SweepChart
            result={canonical}
            xLabel={copy.xLabel}
            tickLabel={copy.tickLabel}
            answer={def.truth(canonical)}
            pick={locked}
            table={sweepTable(def, copy, canonical, locked)}
            tableOpen
            y={copy.view?.plot}
          />
          <p className="text-body-sm text-text-2">
            This is one fixed seed, shown on a phone in place of a run, so it earns nothing: the same answer every time is no evidence. On a fresh seed it counts.
          </p>
          <button type="button" onClick={onEmbed} className={cn(quietBtn, hitArea(true))}>
            Run it on a fresh seed here instead
          </button>
        </div>
      )}
    </div>
  )
}
