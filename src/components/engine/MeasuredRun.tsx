/**
 * "Measured vs predicted" (docs/specs/wave-3.md §16.10, task 3s-13): you predict decode tok/s for Qwen3-0.6B q4 on this
 * device from its bytes and a memory bandwidth you choose, lock the prediction, run the real engine, and see what it
 * measured. The run is recorded as a `predict` and an `item` on `item:engine.measured-tps`, src `practice`, provenance
 * `field` (weight 0; a donation drops their value and truth, so your device's speed never leaves it).
 *
 * The download's consent (`DownloadConsent`) is asked by the panel that loads the model, before it fetches anything;
 * this section only needs the loaded generation function. The measurement and the recording are injectable (`env`), so a test stubs the measurement and reads the
 * events written. The numbers and the arithmetic are src/lib/real-engine.ts's.
 */
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Download, Gauge, Loader2, Minus, Play, Plus } from 'lucide-react'
import { ClaimValue } from '@/components/ClaimValue'
import { formatNumber } from '@/lib/items/units'
import type { ItemResponse } from '@/lib/ledger/types'
import { useProgress } from '@/lib/progress'
import {
  MAX_GBS,
  MAX_TPS,
  MEASURED_BYTES,
  MEASURE_CONTEXT_TOKENS,
  MEMORY_PRESETS,
  OK_FACTOR,
  compareRun,
  consentLine,
  gapReading,
  h100CeilingTps,
  kvBytesPerToken,
  measureDecodeTps,
  measuredRunItems,
  parsePositive,
  presetGBs,
  type DecodeMeasurement,
  type RealGenFn,
  type RunComparison,
} from '@/lib/real-engine'
import { cn } from '@/lib/utils'

/** What the section calls out to; tests replace both. */
export interface MeasuredRunEnv {
  measure: (gen: RealGenFn, onProgress: (done: number, total: number) => void) => Promise<DecodeMeasurement>
  record: (items: ItemResponse[]) => void
}

export interface MeasuredRunProps {
  /** The loaded model's generation function, or null while there is none. */
  gen: RealGenFn | null
  /** `webgpu` or `wasm`, once the model is ready. */
  device: string | null
  /** Whether the loader holds the model this run measures (Qwen3-0.6B); any other model is not measured. */
  isMeasuredModel: boolean
  /** Another run is using the one generation slot. */
  busy?: boolean
  onBusyChange?: (busy: boolean) => void
  env?: Partial<MeasuredRunEnv>
  className?: string
}

/** The stepper moves the bandwidth by this many GB/s (steppers instead of drags, WCAG 2.5.7). */
const BW_STEP = 5

/** The question asked before a model downloads: what, how big, where it goes. Focus lands on the yes. */
export function DownloadConsent({ name, mb, warning, onConfirm, onDecline }: { name: string; mb: number; warning: string | null; onConfirm: () => void; onDecline: () => void }) {
  const uid = useId()
  const yes = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    yes.current?.focus()
  }, [])
  return (
    <div role="group" aria-labelledby={`${uid}-h`} data-consent className="max-w-2xl rounded-lg border border-amber/40 bg-amber/5 p-4">
      <p id={`${uid}-h`} className="font-display text-h4 text-text-1">
        Download {name}?
      </p>
      <p className="mt-1 text-body-sm text-text-2">{consentLine(name, mb)}</p>
      {warning && <p className="mt-1 text-body-sm text-amber">{warning} The download is large; Wi-Fi is better.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button ref={yes} type="button" data-consent-yes onClick={onConfirm} className={cn(btn, 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/20')}>
          <Download className="h-4 w-4" aria-hidden="true" />
          {warning ? `download ~${mb} MB anyway` : `download ~${mb} MB`}
        </button>
        <button type="button" data-consent-no onClick={onDecline} className={btn}>
          not now
        </button>
      </div>
    </div>
  )
}

const btn =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-surface-1 px-4 font-mono text-sm text-text-2 transition-colors hover:border-accent/50 hover:text-text-1 disabled:opacity-50'
const field = 'min-h-11 w-32 rounded-md border border-line bg-surface-1 px-3 font-mono text-sm text-text-1 outline-none focus:border-accent/60 disabled:opacity-60'

type Phase = 'predict' | 'locked' | 'running' | 'done'

interface Locked {
  bandwidthGBs: number
  predicted: number
}

export default function MeasuredRun({ gen, device, isMeasuredModel, busy = false, onBusyChange, env, className }: MeasuredRunProps) {
  const uid = useId()
  const recordItems = useProgress((s) => s.recordItems)
  const measure = env?.measure ?? ((g: RealGenFn, onProgress: (done: number, total: number) => void) => measureDecodeTps(g, { onProgress }))
  const record = env?.record ?? recordItems

  const [bwText, setBwText] = useState('')
  const [tpsText, setTpsText] = useState('')
  const [phase, setPhase] = useState<Phase>('predict')
  const [locked, setLocked] = useState<Locked | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<RunComparison | null>(null)
  const [error, setError] = useState<string | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  // Focus follows the controls that come and go, so a keyboard walk never lands on <body>: the lock button is replaced
  // by the run button, which is replaced by the result, and "predict again" brings the prediction back.
  const runRef = useRef<HTMLButtonElement>(null)
  const lockedRef = useRef<HTMLParagraphElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const predictionRef = useRef<HTMLInputElement>(null)
  const moved = useRef<Phase>('predict')
  useEffect(() => {
    const from = moved.current
    moved.current = phase
    if (phase === from) return
    if (phase === 'locked') (runRef.current && !runRef.current.disabled ? runRef.current : lockedRef.current)?.focus()
    else if (phase === 'done') resultRef.current?.focus()
    else if (phase === 'predict') predictionRef.current?.focus()
  }, [phase])

  const bw = parsePositive(bwText, MAX_GBS)
  const tps = parsePositive(tpsText, MAX_TPS)
  const editing = phase === 'predict'
  const canRun = phase === 'locked' && gen !== null && isMeasuredModel && !busy

  const bump = (by: number) => setBwText(formatNumber(Math.min(MAX_GBS, Math.max(1, (bw ?? 0) + by)), 1).replace(/,/g, ''))

  const lock = () => {
    if (bw === null || tps === null) return
    setLocked({ bandwidthGBs: bw, predicted: tps })
    setPhase('locked')
    setError(null)
  }

  const run = async () => {
    if (!gen || !locked) return
    setPhase('running')
    setError(null)
    setProgress({ done: 0, total: 0 })
    onBusyChange?.(true)
    try {
      const m = await measure(gen, (done, total) => live.current && setProgress({ done, total }))
      if (!live.current) return
      const cmp = compareRun({ predicted: locked.predicted, bandwidthGBs: locked.bandwidthGBs, measured: m.tokPerSec })
      record(measuredRunItems(cmp))
      setResult(cmp)
      setPhase('done')
    } catch (e) {
      if (!live.current) return
      setError(e instanceof Error ? e.message : String(e))
      setPhase('locked')
    } finally {
      onBusyChange?.(false)
      if (live.current) setProgress(null)
    }
  }

  const again = () => {
    setPhase('predict')
    setLocked(null)
    setResult(null)
    setError(null)
    setTpsText('')
  }

  const mb = MEASURED_BYTES / 1e6

  return (
    <section aria-labelledby={`${uid}-h`} data-measured-run className={cn('rounded-lg border border-line bg-surface-1 p-4', className)}>
      <h3 id={`${uid}-h`} className="flex items-center gap-2 font-display text-h4 text-text-1">
        <Gauge className="h-4 w-4 text-accent" aria-hidden="true" />
        Measured vs predicted: decode speed on your device
      </h3>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-amber" data-your-device>
        your device, not an H100
      </p>
      <p className="mt-2 max-w-2xl text-body-sm text-text-2">
        Generating one token at a time, the engine reads about every weight from memory once per token. Qwen3-0.6B at q4 is about {mb} MB, so a token costs about {mb} MB of reading. Choose the
        memory bandwidth you think the engine gets on this device, then predict how many tokens per second it decodes. Lock your prediction, and the real model measures it.
      </p>

      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor={`${uid}-bw`} className="block font-mono text-[11px] text-text-3">
            1 · memory bandwidth you choose (GB/s)
          </label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button type="button" className={cn(btn, 'px-3')} onClick={() => bump(-BW_STEP)} disabled={!editing} aria-label={`lower the bandwidth by ${BW_STEP} GB/s`}>
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <input
              id={`${uid}-bw`}
              data-bandwidth
              inputMode="decimal"
              autoComplete="off"
              className={field}
              value={bwText}
              disabled={!editing}
              aria-invalid={bwText !== '' && bw === null}
              aria-describedby={`${uid}-bw-help`}
              onChange={(e) => setBwText(e.target.value)}
            />
            <button type="button" className={cn(btn, 'px-3')} onClick={() => bump(BW_STEP)} disabled={!editing} aria-label={`raise the bandwidth by ${BW_STEP} GB/s`}>
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="memory configurations to start from">
            {MEMORY_PRESETS.map((p) => {
              const v = presetGBs(p)
              return (
                <button key={p.id} type="button" data-preset={p.id} className={cn(btn, 'px-3 text-[11px]')} disabled={!editing} aria-pressed={bw === v} onClick={() => setBwText(String(v))}>
                  {p.label}: {v} GB/s
                </button>
              )
            })}
          </div>
          <p id={`${uid}-bw-help`} className="mt-2 max-w-2xl font-mono text-[10px] leading-relaxed text-text-3">
            Each preset is transfer rate × bus width ÷ 8 (6400 MT/s × 64 bit ÷ 8 = 51.2 GB/s). Look up your device&apos;s memory, or type your own number.
            {bwText !== '' && bw === null ? <span className="text-danger"> Enter a number from 0 to {formatNumber(MAX_GBS)}.</span> : null}
          </p>
        </div>

        <div>
          <label htmlFor={`${uid}-tps`} className="block font-mono text-[11px] text-text-3">
            2 · your prediction (decode tokens per second)
          </label>
          <input
            id={`${uid}-tps`}
            ref={predictionRef}
            data-prediction
            inputMode="decimal"
            autoComplete="off"
            className={cn(field, 'mt-1')}
            value={tpsText}
            disabled={!editing}
            aria-invalid={tpsText !== '' && tps === null}
            onChange={(e) => setTpsText(e.target.value)}
          />
          {tpsText !== '' && tps === null ? <p className="mt-1 font-mono text-[10px] text-danger">Enter a number from 0 to {formatNumber(MAX_TPS)}.</p> : null}
        </div>

        {editing ? (
          <button type="button" data-lock className={cn(btn, 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/20')} disabled={bw === null || tps === null} onClick={lock}>
            lock my prediction
          </button>
        ) : (
          <p ref={lockedRef} tabIndex={-1} className="font-mono text-[12px] text-text-2 outline-none" data-locked>
            Locked: {formatNumber(locked?.predicted ?? 0)} tok/s at {formatNumber(locked?.bandwidthGBs ?? 0)} GB/s.
          </p>
        )}

        {phase !== 'predict' && phase !== 'done' && (
          <div>
            <button ref={runRef} type="button" data-run className={cn(btn, 'border-accent/60 bg-accent/10 text-accent hover:bg-accent/20')} disabled={!canRun} onClick={() => void run()}>
              {phase === 'running' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              {phase === 'running' ? 'measuring…' : 'run the real engine'}
            </button>
            {!isMeasuredModel ? (
              <p className="mt-2 font-mono text-[11px] text-text-3">The run measures Qwen3-0.6B. Choose it in the loader above.</p>
            ) : gen === null ? (
              <p className="mt-2 font-mono text-[11px] text-text-3">The model is not loaded. Load it above (it asks before downloading), then run.</p>
            ) : busy && phase !== 'running' ? (
              <p className="mt-2 font-mono text-[11px] text-text-3">Another run is using the generation slot. Wait for it to finish.</p>
            ) : null}
          </div>
        )}
      </div>

      <div role="status" className="mt-3 font-mono text-[11px] text-text-3 empty:mt-0" data-measure-status>
        {phase === 'running' ? (
          progress && progress.total > 0 ? `timing round ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'warming the model up…'
        ) : result ? (
          <span className="text-sm text-text-1" data-verdict>
            {verdictOf(result)}
          </span>
        ) : null}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3 font-mono text-[12px] text-danger" data-measure-error>
          {error}
        </p>
      )}

      {result && <Comparison c={result} device={device} onAgain={again} resultRef={resultRef} />}
    </section>
  )
}

/* ------------------------------ the comparison ------------------------------ */

const tpsOf = (n: number): string => formatNumber(n, n >= 100 ? 0 : 1)

/** The sentence a result opens with; it goes in the section's live region, so it is announced when the run lands. */
function verdictOf(c: RunComparison): string {
  const gap = c.ok ? `Within ${OK_FACTOR}×: close enough.` : `Outside ${OK_FACTOR}×: ${c.ratio < 1 ? 'the device was slower than you expected' : 'the device was faster than you expected'}.`
  return `You predicted ${tpsOf(c.predicted)} tok/s; this device measured ${tpsOf(c.measured)} tok/s (${formatNumber(c.ratio, 2)}× your prediction). ${gap}`
}

function Comparison({ c, device, onAgain, resultRef }: { c: RunComparison; device: string | null; onAgain: () => void; resultRef: RefObject<HTMLDivElement | null> }) {
  const max = Math.max(c.predicted, c.measured, c.ceiling)
  const bars: { id: string; label: string; v: number; tone: string }[] = [
    { id: 'predicted', label: 'you predicted', v: c.predicted, tone: 'bg-info' },
    { id: 'measured', label: 'measured here', v: c.measured, tone: 'bg-accent' },
    { id: 'ceiling', label: `ceiling at ${formatNumber(c.bandwidthGBs)} GB/s`, v: c.ceiling, tone: 'bg-text-3' },
  ]
  const kv32 = MEASURE_CONTEXT_TOKENS * kvBytesPerToken(4)
  return (
    <div ref={resultRef} tabIndex={-1} aria-label="measured against predicted" role="group" className="mt-2 border-t border-line pt-4 outline-none" data-comparison>
      <div className="space-y-2" aria-hidden="true">
        {bars.map((b) => (
          <div key={b.id} className="flex items-center gap-2 font-mono text-[10px] text-text-3">
            <span className="w-32 shrink-0 sm:w-44">{b.label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded-sm bg-surface-2">
              <div className={cn('h-full', b.tone)} style={{ width: `${Math.max(1, (b.v / max) * 100)}%` }} />
            </div>
            <span className="w-14 shrink-0 text-right text-text-2">{tpsOf(b.v)}</span>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <table className="w-full border-collapse text-left font-mono text-[12px]">
          <caption className="sr-only">Predicted against measured decode speed, and what the measurement implies</caption>
          <tbody>
            <Row k="predicted" v={`${tpsOf(c.predicted)} tok/s`} />
            <Row k="measured on this device" v={`${tpsOf(c.measured)} tok/s`} />
            <Row k={`ceiling: ${formatNumber(c.bandwidthGBs)} GB/s ÷ ${formatNumber(c.bytes / 1e6)} MB`} v={`${tpsOf(c.ceiling)} tok/s`} />
            <Row k="bandwidth the measurement implies" v={`${formatNumber(c.effectiveGBs, 1)} GB/s (${Math.round(c.utilisation * 100)}% of the one you chose)`} />
          </tbody>
        </table>
      </div>

      <p className="mt-3 max-w-2xl text-body-sm text-text-2">{gapReading(c, device)}</p>
      <p className="mt-2 max-w-2xl font-mono text-[10px] leading-relaxed text-text-3">
        Your device, not an H100: an H100 SXM has <ClaimValue id="hw.h100-sxm.hbm-bw" /> of HBM bandwidth, a ceiling of {formatNumber(h100CeilingTps(c.bytes), 0)} tok/s for the same bytes. The KV cache
        adds at most about {formatNumber((kv32 / c.bytes) * 100, 1)}% to a token&apos;s bytes here ({MEASURE_CONTEXT_TOKENS} tokens of context at 229,376 B per token in fp32), so it is left out. The
        rate is the median of three rounds that time a 40-token against an 8-token generation of one prompt, so prefill cancels.
      </p>
      <p className="mt-2 font-mono text-[10px] text-text-3" data-recorded>
        Recorded on this device only (field, no credit): your numbers stay here.
      </p>
      <button type="button" className={cn(btn, 'mt-3')} onClick={onAgain} data-again>
        predict again
      </button>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal text-text-3">
        {k}
      </th>
      <td className="py-2 pl-3 text-right text-text-1">{v}</td>
    </tr>
  )
}
