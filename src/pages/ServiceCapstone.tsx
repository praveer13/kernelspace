import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import { Link } from 'react-router'
import type { TraceArtifact } from '@/lib/traces'
import type { ZooModel } from '@/lib/kv-zoo'
import {
  ByoError,
  CSV_HELP,
  MAX_FILE_BYTES,
  NOTES,
  PRICE_TTL_DAYS,
  SAMPLE_SIZE,
  SERVICE_HARDWARE,
  SUMMARY_FILE,
  TICK_SECONDS,
  batchingResult,
  costOf,
  defaultPrice,
  formatBytes,
  kvAt,
  planPool,
  priceAgeDays,
  readConfig,
  readSettings,
  readTraceFile,
  runBatching,
  sampleShape,
  summaryText,
  takeSample,
  type BatchingResult,
  type CostResult,
  type PoolPlan,
  type Settings,
  type SettingsForm,
  type SummaryInput,
} from '@/lib/byo-service'

const BUTTON_PRIMARY =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-5 font-display text-[15px] font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50'
const BUTTON_QUIET =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-line bg-surface-2 px-4 text-body-sm text-text-1 hover:border-line-bright disabled:cursor-not-allowed disabled:opacity-50'
const CARD = 'rounded-lg border border-line bg-surface-1 p-4 sm:p-5'
const INPUT = 'min-h-11 w-full min-w-0 rounded-md border border-line bg-surface-2 px-3 text-body-sm text-text-1 aria-[invalid=true]:border-danger'
const LABEL = 'block text-body-sm font-medium text-text-1'
const HINT = 'mt-1 text-[13px] leading-snug text-text-2'
const ERROR = 'mt-1 text-[13px] leading-snug text-danger'

const fmtInt = (n: number): string => n.toLocaleString('en-US')
/** Three significant figures: 27.92 is "27.9", 0.01234 is "0.0123". */
const fmt3 = (n: number): string => Number(n.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 6 })
const usd = (n: number): string => `$${fmt3(n)}`

/** The local calendar date as YYYY-MM-DD, read once per visit: the price's age is counted to it. */
function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type Loaded<T> = { state: 'none' } | { state: 'reading'; name: string } | { state: 'ok'; name: string; value: T } | { state: 'error'; name: string; message: string }

interface Outcome {
  summary: SummaryInput
  batching: BatchingResult
  cost: CostResult
}

type Run =
  | { phase: 'idle' }
  | { phase: 'running'; done: number; total: number; tick: number }
  | { phase: 'failed'; title: string; detail: string }
  | { phase: 'done'; outcome: Outcome }

/** Reads a picked file as text, refusing a file too large to be a trace or a config. */
async function readText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) throw new ByoError(`this file is ${formatBytes(file.size)}; the page reads files up to ${formatBytes(MAX_FILE_BYTES)}. Cut a window of it`)
  return file.text()
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * /capstone/service (docs/specs/wave-3.md §16.8, task 3s-10): the bring-your-own-service capstone. You bring a trace (a
 * local-derived JSON artifact, or a CSV converted here), a model's config.json and a chip; the page gives KV per token, runs
 * the first 400 requests through the fleet worker's batching engine, and prices the run at a dated $/GPU-hour.
 *
 * Everything is read and run in this tab. The page has no network call, writes nothing to the ledger or to browser storage,
 * and keeps no copy of what you picked: reload and it is gone. The summary leaves as a file you download
 * (src/lib/byo-service.ts, tests/byo/service.test.ts; the page itself mounted: tests/byo/service-dom.test.ts). The page awards nothing and counts as no practice.
 */
export default function ServiceCapstone() {
  const [today] = useState(localToday)
  const [trace, setTrace] = useState<Loaded<TraceArtifact>>({ state: 'none' })
  const [configText, setConfigText] = useState('')
  const [configName, setConfigName] = useState('Pasted config')
  const [form, setForm] = useState<SettingsForm>(() => {
    const price = defaultPrice('h100', new Date())
    return {
      hardwareId: 'h100',
      gpus: '1',
      weightsGb: '',
      hbmShare: '0.9',
      maxRunning: '64',
      sloMs: '2000',
      priceUsd: price ? String(price.usdPerGpuHour) : '',
      priceDate: price ? price.asOf : '',
    }
  })
  const [run, setRun] = useState<Run>({ phase: 'idle' })
  const [announcement, setAnnouncement] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const [configFileError, setConfigFileError] = useState<string | null>(null)

  // a worker left running behind a page that is gone would be a leak: stop it on unmount
  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = run.phase === 'running'

  /**
   * Any change to an input retires the last result, so what is on screen always matches what is in the form. A run in
   * progress is not retired by an edit: the form is locked while it runs (every control below is `disabled={busy}`), so
   * there is no edit to answer, and the results that land describe the settings the form still holds.
   */
  const retire = useCallback(() => setRun((r) => (r.phase === 'running' ? r : { phase: 'idle' })), [])

  const onTraceFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    retire()
    setTrace({ state: 'reading', name: file.name })
    try {
      const artifact = await readTraceFile(file.name, await readText(file))
      setTrace({ state: 'ok', name: file.name, value: artifact })
    } catch (err) {
      setTrace({ state: 'error', name: file.name, message: messageOf(err) })
    }
  }

  const onConfigFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    retire()
    try {
      setConfigText(await readText(file))
      setConfigName(file.name)
      setConfigFileError(null)
    } catch (err) {
      setConfigName(file.name)
      setConfigText('')
      setConfigFileError(messageOf(err))
    }
  }

  const config = useMemo<Loaded<ZooModel>>(() => {
    if (configFileError !== null) return { state: 'error', name: configName, message: `${configName}: ${configFileError}` }
    if (configText.trim() === '') return { state: 'none' }
    try {
      return { state: 'ok', name: configName, value: readConfig(configText, configName) }
    } catch (err) {
      return { state: 'error', name: configName, message: messageOf(err) }
    }
  }, [configText, configName, configFileError])

  const settings = useMemo(() => readSettings(form, today), [form, today])
  const setField = (key: keyof SettingsForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    retire()
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }
  const onHardware = (e: ChangeEvent<HTMLSelectElement>) => {
    retire()
    const id = e.target.value
    const price = defaultPrice(id, new Date())
    // a chip with a dated median brings it; any other starts empty, because a price you did not read is not yours
    setForm((f) => ({ ...f, hardwareId: id, priceUsd: price ? String(price.usdPerGpuHour) : '', priceDate: price ? price.asOf : '' }))
  }

  const sample = useMemo(() => (trace.state === 'ok' ? takeSample(trace.value) : null), [trace])
  const shape = useMemo(() => (sample ? sampleShape(sample) : null), [sample])
  const kv = useMemo(() => {
    if (!shape || config.state !== 'ok') return null
    return { p50: kvAt(config.value, shape.contextP50), p95: kvAt(config.value, shape.contextP95) }
  }, [shape, config])

  // the pool the hardware leaves, as soon as the trace, the config and the form can say it
  const pool = useMemo<{ plan: PoolPlan } | { problem: string } | null>(() => {
    if (!sample || !kv || !settings.ok) return null
    try {
      return { plan: planPool(sample, settings.settings, kv.p50.bytesPerToken) }
    } catch (err) {
      return { problem: messageOf(err) }
    }
  }, [sample, kv, settings])

  const hardware = SERVICE_HARDWARE.find((r) => r.id === form.hardwareId)
  const claimDefault = defaultPrice(form.hardwareId, new Date())
  const priceIsClaim = claimDefault !== null && Number(form.priceUsd) === claimDefault.usdPerGpuHour && form.priceDate === claimDefault.asOf
  const priceAge = settings.ok || form.priceDate !== '' ? priceAgeDays(form.priceDate, today) : null
  const errors = settings.ok ? {} : settings.errors

  const ready = trace.state === 'ok' && config.state === 'ok' && settings.ok && pool !== null && 'plan' in pool && !busy

  const onRun = async () => {
    if (!sample || !shape || !kv || config.state !== 'ok' || trace.state !== 'ok' || !settings.ok || !pool || !('plan' in pool)) return
    const { plan } = pool
    const s: Settings = settings.settings
    const ctl = new AbortController()
    abortRef.current = ctl
    setRun({ phase: 'running', done: 0, total: plan.kept.length, tick: 0 })
    setAnnouncement('Running the sample in the fleet worker.')
    try {
      const snapshot = await runBatching(plan, s, {
        signal: ctl.signal,
        onProgress: (done, total, tick) => setRun({ phase: 'running', done, total, tick }),
      })
      const batching = batchingResult(snapshot, plan)
      const cost = costOf(batching, s)
      const summary: SummaryInput = { trace: trace.value, shape, model: config.value, p50: kv.p50, p95: kv.p95, settings: s, plan, batching, cost }
      setRun({ phase: 'done', outcome: { summary, batching, cost } })
      setAnnouncement(
        batching.finished
          ? `The run finished: ${fmtInt(batching.completed)} of ${fmtInt(batching.sample)} requests served${cost.perMtok === null ? '' : `, ${usd(cost.perMtok)} per million tokens`}.`
          : 'The run stopped at its tick limit before every request finished.',
      )
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setRun({ phase: 'idle' })
        setAnnouncement('The run was cancelled.')
        return
      }
      const { describeFleetError } = await import('@/lib/fleet-session')
      const d = describeFleetError(err, 'the run failed')
      setRun({ phase: 'failed', title: d.title, detail: d.detail })
      setAnnouncement(`The run failed: ${d.title}.`)
    } finally {
      if (abortRef.current === ctl) abortRef.current = null
    }
  }

  const download = (outcome: Outcome) => {
    const url = URL.createObjectURL(new Blob([summaryText(outcome.summary)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = SUMMARY_FILE
    document.body.appendChild(a)
    a.click()
    a.remove()
    // the click has started the save; the object URL is only needed until then
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12" data-page="service-capstone">
      <p className="section-label">0x00 — capstone / service</p>
      <h1 className="mt-3 font-display text-h3 text-text-1 sm:text-h2">Your service, on your device</h1>
      <p className="mt-2 text-body-sm text-text-2">
        Bring a request trace, a model&rsquo;s <code>config.json</code> and a GPU. The page works out the KV cache per token, runs the first {SAMPLE_SIZE} requests through
        the batching engine, and prices the run at a dated rental price. Files are read and the run happens in this tab: nothing is uploaded, nothing is saved, and the
        summary leaves as a file you download. This is the same engine as <Link className="underline underline-offset-2" to="/fleet">Fleet</Link>, so read the numbers the way its notes below say.
      </p>

      <p role="status" className="sr-only">
        {announcement}
      </p>

      <div className="mt-6 space-y-4">
        {/* ----------------------------- trace ----------------------------- */}
        <fieldset className={CARD}>
          <legend className="px-1 font-display text-h4 text-text-1">1 · Your trace</legend>
          <label htmlFor="byo-trace" className={LABEL}>
            Trace file (.json or .csv)
          </label>
          <input
            id="byo-trace"
            type="file"
            accept=".json,.csv,application/json,text/csv"
            onChange={(e) => void onTraceFile(e)}
            disabled={busy}
            aria-describedby="byo-trace-hint byo-trace-status"
            className={`${INPUT} py-2`}
          />
          <p id="byo-trace-hint" className={HINT}>
            A CSV is converted here. A JSON file must be a trace artifact that says <code>&quot;kind&quot;: &quot;local-derived&quot;</code> and passes the same checks as the
            course&rsquo;s own (rows sorted by arrival, a SHA-256 of the rows).
          </p>
          <details className="mt-2 text-[13px] text-text-2">
            <summary className="min-h-11 cursor-pointer py-2.5">What a CSV looks like</summary>
            <p className="pb-2">{CSV_HELP}</p>
            <pre className="whitespace-pre-wrap break-words rounded-md border border-line bg-surface-2 p-3 font-mono text-[12px] text-text-1">
              {'arrival_s,prompt_tokens,output_tokens\n0.00,812,64\n0.35,2210,180\n0.41,96,32'}
            </pre>
          </details>
          <div id="byo-trace-status" aria-live="polite" className="mt-2 text-body-sm">
            {trace.state === 'reading' && <p className="text-text-2">Reading {trace.name}…</p>}
            {trace.state === 'error' && (
              <p className="text-danger" data-error="trace">
                {trace.name}: {trace.message}
              </p>
            )}
            {trace.state === 'ok' && shape && (
              <p className="text-text-1" data-ok="trace">
                {trace.name} · {fmtInt(trace.value.requestCount)} requests · kind {trace.value.kind}. The run uses the first {fmtInt(shape.requests)}: they arrive over{' '}
                {fmtInt(Math.round(shape.spanTicks * TICK_SECONDS))} s, with a median prompt of {fmtInt(shape.promptMedian)} and output of {fmtInt(shape.outputMedian)} tokens.
                A request&rsquo;s final context (prompt + output) is {fmtInt(shape.contextP50)} tokens at the median and {fmtInt(shape.contextP95)} at the 95th percentile.
              </p>
            )}
          </div>
        </fieldset>

        {/* ----------------------------- model ----------------------------- */}
        <fieldset className={CARD}>
          <legend className="px-1 font-display text-h4 text-text-1">2 · Your model</legend>
          <label htmlFor="byo-config" className={LABEL}>
            config.json
          </label>
          <textarea
            id="byo-config"
            value={configText}
            onChange={(e) => {
              retire()
              setConfigText(e.target.value)
              setConfigName('Pasted config')
              setConfigFileError(null)
            }}
            rows={6}
            disabled={busy}
            spellCheck={false}
            aria-invalid={config.state === 'error'}
            aria-describedby="byo-config-hint byo-config-status"
            placeholder='{"num_hidden_layers": 32, "num_attention_heads": 32, "num_key_value_heads": 8, "head_dim": 128}'
            className={`${INPUT} py-2 font-mono text-[12px]`}
          />
          <p id="byo-config-hint" className={HINT}>
            Paste the model&rsquo;s whole <code>config.json</code>, or pick the file. The zoo&rsquo;s reader gives its attention layers; it names what it cannot read.
          </p>
          <div className="mt-2">
            <label htmlFor="byo-config-file" className="sr-only">
              Pick a config.json file
            </label>
            <input
              id="byo-config-file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void onConfigFile(e)}
              disabled={busy}
              className={`${INPUT} py-2`}
            />
          </div>
          <div id="byo-config-status" aria-live="polite" className="mt-2 text-body-sm">
            {config.state === 'error' && (
              <p className="text-danger" data-error="config">
                {config.message}
              </p>
            )}
            {config.state === 'ok' && (
              <p className="text-text-1" data-ok="config">
                {config.name} · {config.value.groups.reduce((n, g) => n + g.count, 0)} layers: {config.value.groups.map((g) => `${g.count} × ${g.label}`).join(', ')}.
              </p>
            )}
          </div>
        </fieldset>

        {/* ---------------------------- hardware ---------------------------- */}
        <fieldset className={CARD}>
          <legend className="px-1 font-display text-h4 text-text-1">3 · Your hardware and your price</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="byo-hw" className={LABEL}>
                Chip
              </label>
              <select id="byo-hw" value={form.hardwareId} onChange={onHardware} disabled={busy} className={INPUT}>
                {SERVICE_HARDWARE.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.hbmGb} GB
                  </option>
                ))}
              </select>
              <p className={HINT}>
                The atlas row: {hardware?.hbmGb} GB of memory a chip{hardware?.claims.hbmGb ? ` (claim ${hardware.claims.hbmGb})` : ''}. B300 and TPU7x are missing because the
                evidence has no capacity for them.
              </p>
            </div>
            <Field id="byo-gpus" label="Chips in one replica" value={form.gpus} onChange={setField('gpus')} error={errors.gpus} hint="The weights and the cache are spread across them." disabled={busy} mode="numeric" />
            <Field
              id="byo-weights"
              label="Weights on those chips (GB)"
              value={form.weightsGb}
              onChange={setField('weightsGb')}
              error={errors.weightsGb}
              hint="The config has no parameter count: give the size of the weights as you load them (16 for an 8B model in BF16). GB is 10^9 bytes."
              disabled={busy}
              mode="decimal"
            />
            <Field
              id="byo-share"
              label="Share of memory the engine may use"
              value={form.hbmShare}
              onChange={setField('hbmShare')}
              error={errors.hbmShare}
              hint="Weights and cache together. Set it to your engine's own setting."
              disabled={busy}
              mode="decimal"
            />
            <Field id="byo-running" label="Most requests running at once" value={form.maxRunning} onChange={setField('maxRunning')} error={errors.maxRunning} hint="The scheduler's cap." disabled={busy} mode="numeric" />
            <Field id="byo-slo" label="First-token deadline (ms)" value={form.sloMs} onChange={setField('sloMs')} error={errors.sloMs} hint="A request meets it when its first token lands inside. One tick is 50 ms." disabled={busy} mode="numeric" />
            <Field
              id="byo-price"
              label="Rental price ($ per GPU-hour)"
              value={form.priceUsd}
              onChange={setField('priceUsd')}
              error={errors.priceUsd}
              hint={
                priceIsClaim && claimDefault
                  ? `The atlas's median on-demand price (claim ${claimDefault.claimId}).`
                  : claimDefault
                    ? `Changed from the atlas's ${usd(claimDefault.usdPerGpuHour)}.`
                    : 'The atlas has no dated price for this chip: type one you read.'
              }
              disabled={busy}
              mode="decimal"
            />
            <Field id="byo-price-date" label="Price read on (YYYY-MM-DD)" value={form.priceDate} onChange={setField('priceDate')} error={errors.priceDate} hint="A price without a date is not a price." disabled={busy} mode="text" />
          </div>
          {priceAge !== null && priceAge > PRICE_TTL_DAYS && (
            <p className="mt-3 text-body-sm text-text-1" data-stale-price>
              This price is {fmtInt(priceAge)} days old; rental prices move, and the atlas treats one older than {PRICE_TTL_DAYS} days as stale. Read it again before you quote the result.
            </p>
          )}
          {pool && 'plan' in pool && (
            <p className="mt-3 text-body-sm text-text-1" data-pool>
              Cache: {formatBytes(pool.plan.kvBudgetBytes)} of memory after the weights holds {fmtInt(pool.plan.blocksCapacity)} blocks of 16 tokens ({fmtInt(pool.plan.blocksCapacity * 16)} tokens) at{' '}
              {fmtInt(Math.round(pool.plan.kvBytesPerToken))} bytes a token.
              {pool.plan.tooLong > 0 && ` ${pool.plan.tooLong} request${pool.plan.tooLong === 1 ? '' : 's'} of the sample cannot fit it alone and will count as not served.`}
            </p>
          )}
          {pool && 'problem' in pool && (
            <p className="mt-3 text-body-sm text-danger" data-error="pool">
              {pool.problem}
            </p>
          )}
        </fieldset>

        {/* ------------------------------ KV ------------------------------ */}
        {kv && (
          <section className={CARD} aria-labelledby="byo-kv" data-result="kv">
            <h2 id="byo-kv" className="font-display text-h4 text-text-1">
              KV per token
            </h2>
            <div className="mt-3">
              <table className="w-full border-collapse text-left text-body-sm">
                <caption className="sr-only">KV cache bytes per token of your model at your trace&rsquo;s median and 95th-percentile context</caption>
                <thead>
                  <tr className="border-b border-line text-text-2">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      At a context of
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Per token
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      One request stores
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['median', kv.p50],
                      ['95th percentile', kv.p95],
                    ] as const
                  ).map(([label, r]) => (
                    <tr key={label} className="border-b border-line/60">
                      <th scope="row" className="py-2 pr-3 text-left font-normal text-text-1">
                        {fmtInt(r.contextTokens)} tokens <span className="text-text-2">({label})</span>
                      </th>
                      <td className="py-2 pr-3 text-right font-mono text-text-1">{formatBytes(r.bytesPerToken)}</td>
                      <td className="py-2 text-right font-mono text-text-1">{formatBytes(r.storedBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={HINT}>
              {Math.abs(kv.p50.bytesPerToken - kv.p95.bytesPerToken) < 1e-6
                ? 'The same at both contexts: every token costs the same, so the pool below is exact.'
                : 'It differs between the contexts: some layers store a window or a fixed state, so a long request stores less per token than a short one. The pool charges every token the median’s price.'}
            </p>
          </section>
        )}

        {/* ------------------------------ run ------------------------------ */}
        <section className={CARD} aria-labelledby="byo-run">
          <h2 id="byo-run" className="font-display text-h4 text-text-1">
            The batching run
          </h2>
          <p className={HINT}>
            The first {SAMPLE_SIZE} requests, arrival by arrival, through the reference scheduler, block manager and intake queue in a fleet worker on this device.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={BUTTON_PRIMARY} disabled={!ready} onClick={() => void onRun()} data-action="run">
              Run the sample
            </button>
            {busy && (
              <button type="button" className={BUTTON_QUIET} onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
          {!ready && !busy && (
            <p className={HINT} data-needs>
              {needsText(trace, config, settings.ok, pool)}
            </p>
          )}
          {run.phase === 'running' && (
            <p className="mt-3 text-body-sm text-text-2" data-running>
              Tick {fmtInt(run.tick)} · {fmtInt(run.done)} of {fmtInt(run.total)} requests done. The form is locked until the run ends or you cancel it.
            </p>
          )}
          {run.phase === 'failed' && (
            <div role="alert" className="mt-3 rounded-md border border-danger/50 p-3 text-body-sm text-text-1" data-error="run">
              <p className="font-medium">{run.title}</p>
              <p className="mt-1 text-text-2">{run.detail}</p>
            </div>
          )}
        </section>

        {/* ---------------------------- results ---------------------------- */}
        {run.phase === 'done' && <Results outcome={run.outcome} onDownload={() => download(run.outcome)} />}

        <section className={CARD} aria-labelledby="byo-notes">
          <h2 id="byo-notes" className="font-display text-h4 text-text-1">
            How to read these numbers
          </h2>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-body-sm text-text-2">
            {NOTES.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  )
}

function needsText(trace: Loaded<unknown>, config: Loaded<unknown>, settingsOk: boolean, pool: { plan: PoolPlan } | { problem: string } | null): string {
  if (trace.state !== 'ok') return 'Pick a trace to run.'
  if (config.state !== 'ok') return 'Add a model config to run.'
  if (!settingsOk) return 'Fix the fields marked above to run.'
  if (pool === null || 'problem' in pool) return 'Fix the cache problem above to run.'
  return ''
}

function Field(props: {
  id: string
  label: string
  value: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  error: string | undefined
  hint: string
  mode: 'numeric' | 'decimal' | 'text'
  disabled: boolean
}): ReactNode {
  const { id, label, value, onChange, error, hint, mode, disabled } = props
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={mode}
        autoComplete="off"
        value={value}
        onChange={onChange}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        className={INPUT}
      />
      <p id={`${id}-hint`} className={HINT}>
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className={ERROR}>
          {error}
        </p>
      )}
    </div>
  )
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-line/60 py-2">
      <dt className="text-text-2">{term}</dt>
      <dd className="font-mono text-text-1">{children}</dd>
    </div>
  )
}

function Results({ outcome, onDownload }: { outcome: Outcome; onDownload: () => void }) {
  const { batching: b, cost: c, summary } = outcome
  return (
    <section className={CARD} aria-labelledby="byo-results" data-result="run">
      <h2 id="byo-results" className="font-display text-h4 text-text-1">
        What the run says
      </h2>
      {!b.finished && (
        <p className="mt-2 text-body-sm text-text-1" data-unfinished>
          The run stopped at its tick limit with {fmtInt(b.run - b.completed)} of {fmtInt(b.run)} requests unfinished. The cost counts to the stop.
        </p>
      )}
      <dl className="mt-3 text-body-sm">
        <Row term="Requests served">
          {fmtInt(b.completed)} of {fmtInt(b.sample)}
          {b.tooLong > 0 ? ` (${fmtInt(b.tooLong)} too long for the cache)` : ''}
        </Row>
        <Row term={`First token inside ${fmtInt(summary.settings.sloTicks * TICK_SECONDS * 1000)} ms`}>{b.goodputPct}%</Row>
        <Row term="First token, 95th percentile">{fmtInt(b.ttftP95Ms)} ms</Row>
        <Row term="Time per output token, 95th percentile">{fmtInt(b.tpotP95Ms)} ms</Row>
        <Row term="Waiting for a block or a slot, 95th percentile">{fmtInt(b.queueP95Ms)} ms</Row>
        <Row term="Preempted mid-decode">{fmtInt(b.autoPreempts)}</Row>
        <Row term="Time to drain the sample">{fmt3(b.ticks * TICK_SECONDS)} s of simulated time</Row>
        <Row term="Tokens delivered">
          {fmtInt(b.inputTokens)} in · {fmtInt(b.outputTokens)} out
        </Row>
        <Row term={`GPU-hours (${c.gpus} × the drain time)`}>{fmt3(c.gpuHours)}</Row>
        <Row term={`Cost at ${usd(c.usdPerGpuHour)} per GPU-hour, read ${c.priceDate}`}>{usd(c.dollars)}</Row>
      </dl>
      <p className="mt-4 font-display text-h4 text-text-1" data-per-mtok>
        {c.perMtok === null ? 'No tokens were delivered, so there is no price per token.' : `${usd(c.perMtok)} per million tokens`}
      </p>
      {c.perMtok !== null && c.perMtokOutput !== null && (
        <p className={HINT}>
          Input and output tokens delivered, the Fleet dashboard&rsquo;s definition. Counting output tokens alone it is {usd(c.perMtokOutput)} per million. The price is the simulated
          engine&rsquo;s, at your chips&rsquo; rental price on {c.priceDate}: not a market quote.
        </p>
      )}
      <div className="mt-4">
        <button type="button" className={BUTTON_PRIMARY} onClick={onDownload} data-action="download">
          Download the summary
        </button>
        <p className={HINT}>
          {SUMMARY_FILE}: the numbers above, the settings, and the sample&rsquo;s checksum. It holds none of your requests and none of your config.
        </p>
      </div>
    </section>
  )
}
