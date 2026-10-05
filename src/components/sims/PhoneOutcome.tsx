/**
 * Phone mode for one outcome task (P2, docs/specs/wave-1.md §10.4): predict, then the canonical outcome
 * as an SVG chart plus a DOM table, graded and recorded with `data.phone`, then "queue the hands-on run
 * for my laptop" (working key `queue:laptop`, which Up Next surfaces on the next laptop day).
 *
 * The outcome comes from the sim's pure model (`src/lib/sims/models/<model>.ts`, extracted by C7–C9),
 * named by the task's `phone.canonical` as `<model>.<name>`. The run itself is not done here, so the
 * record is written `ok: false`: full completion still needs the laptop run (see buildPhoneOutcome).
 */

import { useEffect, useId, useState } from 'react'
import { CalendarClock, Check, Lock } from 'lucide-react'
import { useProgress } from '@/lib/progress'
import { clsx as cn } from 'clsx' // not twMerge: it drops `text-body-sm` next to a `text-text-*` colour
import {
  buildPhoneOutcome,
  checkPrediction,
  describePrediction,
  formatNumber,
  parseLaptopQueue,
  queueForLaptop,
  splitCanonical,
} from '@/lib/sims/host'
import type { CanonicalOutcome, Prediction } from '@/lib/sims/host'
import type { SimTaskDef } from '@/lib/sims/types'
import { MirrorTableView } from '@/components/sims/SimMirror'
import { PredictFields } from '@/components/sims/TaskPanel'
import type { PredictDraft } from '@/components/sims/TaskPanel'

const MODELS = import.meta.glob<{ PHONE_MODELS: Record<string, () => CanonicalOutcome> }>('/src/lib/sims/models/*.ts')

type Loaded = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; outcome: CanonicalOutcome }

/** Load `phone.canonical`'s model and run it once. */
function useCanonical(key: string | undefined): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  useEffect(() => {
    let live = true
    const parts = key === undefined ? null : splitCanonical(key)
    const load = parts === null ? undefined : MODELS[`/src/lib/sims/models/${parts.model}.ts`]
    const settle = (next: Loaded) => {
      if (live) setLoaded(next)
    }
    if (parts === null || load === undefined) {
      void Promise.resolve().then(() => settle({ state: 'missing' }))
    } else {
      load().then(
        (m) => {
          const make = m.PHONE_MODELS[parts.name]
          settle(make === undefined ? { state: 'missing' } : { state: 'ready', outcome: make() })
        },
        () => settle({ state: 'missing' }),
      )
    }
    return () => {
      live = false
    }
  }, [key])
  return loaded
}

export default function PhoneOutcome({ task }: { task: SimTaskDef }) {
  const spec = task.predict
  const uid = useId()
  const canonical = useCanonical(task.phone?.canonical)
  const recordOutcome = useProgress((s) => s.recordSimOutcome)
  const setWorking = useProgress((s) => s.setWorking)
  const queue = useProgress((s) => s.working['queue:laptop'])
  const [draft, setDraft] = useState<PredictDraft>({ text: '' })
  const [invalid, setInvalid] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; prediction: Prediction } | null>(null)
  const queued = parseLaptopQueue(queue).some((q) => q.simId === task.simId && q.taskId === task.id)

  if (spec === undefined) return null

  const submit = () => {
    if (canonical.state !== 'ready') return
    const prediction = checkPrediction(spec, draft)
    if (prediction === null) {
      setInvalid(true)
      return
    }
    const outcome = buildPhoneOutcome(task, prediction, draft.conf, canonical.outcome.actual)
    if (outcome === null) return
    recordOutcome(task.simId, outcome)
    setResult({ ok: outcome.score === 1, prediction })
  }

  const queueIt = () => {
    setWorking(
      'queue:laptop',
      queueForLaptop(queue, { simId: task.simId, taskId: task.id, at: new Date().toISOString() }),
    )
  }

  return (
    <article className="rounded-sm border border-line bg-surface-2 p-3" data-task-id={task.id} data-phone data-phase={result ? 'result' : 'predict'}>
      <h4 className="text-body-sm font-medium leading-snug text-text-1">{task.title}</h4>
      <p className="mt-1 text-body-sm text-text-2">{task.setup}</p>

      {canonical.state === 'missing' ? (
        <p className="mt-3 text-body-sm text-text-2">
          This task has no phone version yet. The hands-on run needs a laptop; queue it and it will show up in Up Next.
        </p>
      ) : (
        <>
          <PredictFields
            uid={uid}
            spec={spec}
            draft={draft}
            onDraft={(d) => {
              setDraft(d)
              setInvalid(false)
            }}
            invalid={invalid}
            locked={result !== null}
            lockedPrediction={result?.prediction}
            lockedConf={draft.conf}
            onSubmit={submit}
          />
          {result === null && (
            <button
              type="button"
              onClick={submit}
              disabled={canonical.state !== 'ready'}
              className="mt-3 flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-2 font-display text-[14px] font-semibold text-accent-foreground transition-all duration-150 active:scale-[.97] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3"
            >
              <Lock size={13} strokeWidth={2} aria-hidden />
              Lock in and show the outcome
            </button>
          )}
        </>
      )}

      {result !== null && canonical.state === 'ready' && (
        <div className="mt-3 space-y-3">
          <p
            role="status"
            className={cn(
              'rounded-sm border-l-2 px-2.5 py-2 text-body-sm text-text-1',
              result.ok ? 'border-accent bg-accent-dim/30' : 'border-amber bg-surface-3',
            )}
          >
            <span className="block font-medium">{result.ok ? 'Your prediction held.' : 'Your prediction was off.'}</span>
            <span className="block text-text-2">
              You said {describePrediction(spec, result.prediction)}. {canonical.outcome.summary}
            </span>
          </p>
          <OutcomeChart outcome={canonical.outcome} />
          <div className="overflow-x-auto rounded-sm border border-line bg-surface-1 p-2">
            <MirrorTableView table={canonical.outcome.table} />
          </div>
          {task.explain && (
            <p className="text-body-sm text-text-2">
              <span className="font-medium text-text-1">Why. </span>
              {task.explain.model}
            </p>
          )}
        </div>
      )}

      {(result !== null || canonical.state === 'missing') && (
        <div className="mt-3">
          {queued ? (
            <p role="status" className="flex items-center gap-1.5 text-body-sm text-text-2">
              <Check size={14} className="text-accent" aria-hidden />
              Queued for your laptop. Up Next will bring it back.
            </p>
          ) : (
            <button
              type="button"
              onClick={queueIt}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface-3 px-3 py-2 text-body-sm text-text-1 transition-colors duration-150 hover:border-line-bright active:scale-[.97]"
            >
              <CalendarClock size={14} strokeWidth={1.75} aria-hidden />
              Queue the hands-on run for my laptop
            </button>
          )}
          <p className="mt-1.5 font-mono text-[10px] text-text-3">The task counts as done after the run on a laptop.</p>
        </div>
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* The chart                                                           */
/* ------------------------------------------------------------------ */

const W = 320
const H = 190
const PAD = { l: 44, r: 12, t: 12, b: 34 }

/** Bars (a category per point) or a line (x numeric), with the marked point in the accent colour. */
function OutcomeChart({ outcome }: { outcome: CanonicalOutcome }) {
  const { chart } = outcome
  const pts = chart.points
  if (pts.length === 0) return null
  const ys = pts.map((p) => p.y)
  const logY = chart.logY === true && ys.every((y) => y > 0)
  const ty = (y: number) => (logY ? Math.log10(y) : y)
  const yMin = logY ? Math.floor(Math.log10(Math.min(...ys))) : 0
  const yMax = logY ? Math.ceil(Math.log10(Math.max(...ys))) : Math.max(...ys) * 1.1 || 1
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const py = (y: number) => PAD.t + ih - ((ty(y) - yMin) / (yMax - yMin || 1)) * ih
  const numericX = chart.kind === 'line' && pts.every((p) => typeof p.x === 'number' && (chart.logX !== true || p.x > 0))
  const tx = (x: number) => (chart.logX === true ? Math.log10(x) : x)
  const xs = numericX ? pts.map((p) => tx(p.x as number)) : []
  const xMin = numericX ? Math.min(...xs) : 0
  const xMax = numericX ? Math.max(...xs) : 1
  const px = (i: number) =>
    numericX ? PAD.l + ((xs[i] - xMin) / (xMax - xMin || 1)) * iw : PAD.l + ((i + 0.5) / pts.length) * iw
  const mark = chart.mark
  const bw = Math.min(36, (iw / pts.length) * 0.7)
  const yTicks = logY ? range(yMin, yMax).map((e) => 10 ** e) : [0, (yMax / 1.1) / 2, yMax / 1.1]
  const label = `${chart.yLabel} by ${chart.xLabel}. ${outcome.summary}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full text-text-3">
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + ih} className="stroke-line" />
      <line x1={PAD.l} y1={PAD.t + ih} x2={PAD.l + iw} y2={PAD.t + ih} className="stroke-line" />
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l - 3} y1={py(t)} x2={PAD.l} y2={py(t)} className="stroke-line" />
          <text x={PAD.l - 6} y={py(t) + 3} textAnchor="end" className="fill-current font-mono" fontSize="9">
            {formatNumber(t)}
          </text>
        </g>
      ))}
      {chart.kind === 'bars' ? (
        pts.map((p, i) => (
          <g key={i}>
            <rect
              x={px(i) - bw / 2}
              y={py(p.y)}
              width={bw}
              height={Math.max(1, PAD.t + ih - py(p.y))}
              className={i === mark ? 'fill-accent' : 'fill-text-3/50'}
            />
            <text x={px(i)} y={H - PAD.b + 12} textAnchor="middle" className="fill-current font-mono" fontSize="9">
              {p.label ?? String(p.x)}
            </text>
          </g>
        ))
      ) : (
        <>
          <polyline fill="none" strokeWidth="1.5" className="stroke-text-3" points={pts.map((p, i) => `${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(' ')} />
          {pts.map((p, i) => (
            <g key={i}>
              <circle cx={px(i)} cy={py(p.y)} r={i === mark ? 4 : 2} className={i === mark ? 'fill-accent' : 'fill-text-3'} />
              {(i === 0 || i === pts.length - 1 || i === mark) && (
                <text x={px(i)} y={H - PAD.b + 12} textAnchor="middle" className="fill-current font-mono" fontSize="9">
                  {p.label ?? String(p.x)}
                </text>
              )}
            </g>
          ))}
        </>
      )}
      <text x={PAD.l + iw / 2} y={H - 4} textAnchor="middle" className="fill-current font-mono" fontSize="9">
        {chart.xLabel}
      </text>
      <text x={10} y={PAD.t + ih / 2} textAnchor="middle" transform={`rotate(-90 10 ${PAD.t + ih / 2})`} className="fill-current font-mono" fontSize="9">
        {chart.yLabel}
      </text>
    </svg>
  )
}

const range = (from: number, to: number): number[] => Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i)
