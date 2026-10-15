/**
 * The bring-your-own-service capstone's model (docs/specs/wave-3.md §16.8, task 3s-10; page: src/pages/ServiceCapstone.tsx).
 *
 * Three things the learner brings, all read on the device and none sent anywhere or kept:
 *   1. a trace: a JSON replay artifact through `parseTraceArtifact` (it must say `local-derived`: it is yours, not a
 *      recording the course ships), or a CSV converted here into that same artifact and put through the same parser;
 *   2. a model: a config.json through the zoo's reader (`parseConfig`), which gives the KV cache's bytes at a context;
 *   3. hardware: an atlas row (its HBM capacity), how many of the chips one replica uses, and what its weights take.
 *
 * What comes out:
 *   - KV per token: the zoo's stored bytes at a context t, divided by t. It is exact (a constant) for full attention, MLA
 *     and DSA, and a function of t for sliding-window, linear and compressed layers, so the page reads it at the sample's
 *     median and 95th-percentile final context (prompt + output).
 *   - A batching run: the first 400 requests of the trace (a window keeps the arrival rate and the bursts; a thinned
 *     sample would cut both) through the fleet worker's engine on the reference drivers. The engine charges every token the
 *     same, so the pool is the HBM left after the weights, divided by KV per token at the median context, in 16-token
 *     blocks. That is exact for full attention and MLA, a stated approximation for the other kinds.
 *   - $/Mtok at a dated price: the run's GPU-hours at the price the learner gives (or the atlas's dated median where a
 *     claim has one) over the input and output tokens the run delivered, the definition the Fleet dashboard uses
 *     (`makeServingMetrics`).
 *
 * The engine's tick is the course sim's flat 50 ms, so the run's speed is the sim's, not the hardware's: hardware changes
 * how many blocks fit and what an hour costs. The summary says so (`NOTES`), as Fleet Week's $/Mtok does
 * (`ACT3_COST_LABEL`).
 *
 * No fetch, no storage, no ledger, no clock and no randomness: the module reads strings and returns values.
 */

import { ATLAS, type HardwareRow } from '@/data/atlas'
import { getClaim, staleSince } from '@/data/claims'
import { DEFAULT_ELEMENT_BYTES, parseConfig, zooBytes, type ZooModel } from '@/lib/kv-zoo'
import { parseTraceArtifact, type TraceArtifact, type TraceRequest } from '@/lib/traces'
import type { EngineOpen, EngineSnapshot } from '@/workers/fleet-protocol'
import type { FleetSessionOptions } from '@/lib/fleet-session'

/* ------------------------------------------------------------------ */
/* Constants (copies of fleet-model's, held equal by the tests)         */
/* ------------------------------------------------------------------ */

/** The run's sample: the first this-many requests of the trace, by arrival. */
export const SAMPLE_SIZE = 400
/** Tokens per KV block, the course engine's. */
export const BLOCK_SIZE = 16
/** fleet-model's SIM_TICK_SECONDS: one engine iteration is 50 ms. Copied so the page does not load the engine. */
export const TICK_SECONDS = 0.05
/** fleet-model's HEADROOM_TOKENS: the reference scheduler holds this much growth room for each running request. */
export const HEADROOM_TOKENS = 48
/** Prompt tokens one prefill iteration takes in, the course's (`FLEET_TRAFFIC_PROFILES`). */
export const PREFILL_CHUNK = 128
/** Requests the intake queue hands the scheduler per tick, the engine's default. */
export const DRAIN_PER_TICK = 32
/** Ticks the run may take past the last arrival before it stops and says it did not finish (about 2.8 simulated hours). */
export const DRAIN_CAP_TICKS = 200_000
/** The largest file the page reads. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024
/** A price older than this is shown as stale: the atlas's rental prices carry a 90-day TTL. */
export const PRICE_TTL_DAYS = 90
/** The claim behind the dated default price of the atlas rows that have one (GetDeploying's on-demand median, $/GPU-hr). */
export const PRICE_CLAIMS: Readonly<Record<string, string>> = { h100: 'price.h100.median', b200: 'price.b200.median' }
/** The file the summary downloads as. */
export const SUMMARY_FILE = 'service-capstone-summary.json'

/** What the page owes the learner about the numbers, in the summary file as well as on screen. */
export const NOTES: readonly string[] = [
  'The engine is the course simulator: one iteration is a flat 50 ms and prefill takes in 128 tokens an iteration, whatever the GPU. Your hardware sets how many KV blocks fit and what an hour costs, not how fast a step runs. [derived, v1 flat-tick physics; not a real-world $/Mtok]',
  'KV per token is the zoo\'s stored bytes at a context divided by that context, at 2 bytes an element (a recurrent state keeps the dtype its config names). The engine charges every token the same, so the pool is exact for full-attention and MLA models and an approximation for sliding-window, linear and compressed layers, which store less per token as the context grows.',
  'The sample is the first 400 requests by arrival, moved to start at tick 0. A request that cannot fit the pool alone is counted as not served.',
  'Weights are the figure you gave; the config does not carry a parameter count. GB is 10^9 bytes for the hardware and the weights alike.',
]

/** A message written for the learner: what is wrong with what they brought, and what to bring instead. */
export class ByoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ByoError'
  }
}

/* ------------------------------------------------------------------ */
/* The trace                                                            */
/* ------------------------------------------------------------------ */

const textEncoder = new TextEncoder()

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** One CSV line into cells; a cell may be quoted, with "" for a quote. A line never spans rows. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      cells.push(cell)
      cell = ''
    } else cell += ch
  }
  cells.push(cell)
  return cells.map((c) => c.trim())
}

/** The arrival columns a CSV may carry, and how many ticks one unit of each is. Exactly one must be present. */
const ARRIVAL_COLUMNS: Readonly<Record<string, number>> = {
  arrival_s: 1 / TICK_SECONDS,
  arrival_ms: 1 / (TICK_SECONDS * 1000),
  t: 1,
}
const PROMPT_COLUMNS = ['prompt_tokens', 'input_tokens', 'p']
const OUTPUT_COLUMNS = ['output_tokens', 'completion_tokens', 'o']

export const CSV_HELP =
  'A header row, then one request per row: an arrival column (arrival_s in seconds, arrival_ms in milliseconds, or t in 50 ms ticks), a prompt column (prompt_tokens, input_tokens or p) and an output column (output_tokens, completion_tokens or o). Other columns are ignored.'

const MAX_ROWS = 50_000

/** Parses a plain number cell; the empty string and anything that is not finite is a problem. */
function numberCell(cell: string | undefined): number {
  if (cell === undefined || cell === '') return Number.NaN
  return Number(cell)
}

/**
 * Converts a CSV of requests into the replay artifact `parseTraceArtifact` reads, on the device: arrivals are moved to start
 * at tick 0 and sorted (the order of equal arrivals is the file's), and the artifact says `local-derived`. The artifact is
 * then put through `parseTraceArtifact` like a JSON file, so both ways in meet the same checks.
 */
export async function csvToTraceArtifact(fileName: string, text: string): Promise<TraceArtifact> {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n|\r/)
  const headerAt = lines.findIndex((l) => l.trim() !== '')
  if (headerAt < 0) throw new ByoError('this CSV is empty: ' + CSV_HELP)
  const header = splitCsvLine(lines[headerAt]).map((h) => h.toLowerCase())
  const arrivalNames = Object.keys(ARRIVAL_COLUMNS).filter((n) => header.includes(n))
  const prompt = PROMPT_COLUMNS.find((n) => header.includes(n))
  const output = OUTPUT_COLUMNS.find((n) => header.includes(n))
  if (arrivalNames.length !== 1 || prompt === undefined || output === undefined) {
    const found = header.join(', ') || 'none'
    throw new ByoError(
      arrivalNames.length > 1
        ? `this CSV has more than one arrival column (${arrivalNames.join(', ')}): keep one. ${CSV_HELP}`
        : `this CSV's header (${found}) needs one arrival column, one prompt column and one output column. ${CSV_HELP}`,
    )
  }
  const arrivalName = arrivalNames[0]
  const ticksPerUnit = ARRIVAL_COLUMNS[arrivalName]
  const at = { arrival: header.indexOf(arrivalName), prompt: header.indexOf(prompt), output: header.indexOf(output) }

  const rows: { arrival: number; p: number; o: number }[] = []
  for (let i = headerAt + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    const line = i + 1
    const cells = splitCsvLine(lines[i])
    const arrival = numberCell(cells[at.arrival])
    const p = numberCell(cells[at.prompt])
    const o = numberCell(cells[at.output])
    if (!Number.isFinite(arrival) || arrival < 0) throw new ByoError(`line ${line}: ${arrivalName} must be a number of at least 0, got "${cells[at.arrival] ?? ''}"`)
    if (!Number.isInteger(p) || p < 1) throw new ByoError(`line ${line}: ${prompt} must be a whole number of at least 1, got "${cells[at.prompt] ?? ''}"`)
    if (!Number.isInteger(o) || o < 1) throw new ByoError(`line ${line}: ${output} must be a whole number of at least 1, got "${cells[at.output] ?? ''}"`)
    rows.push({ arrival, p, o })
    if (rows.length > MAX_ROWS) throw new ByoError(`this CSV has more than ${MAX_ROWS.toLocaleString('en-US')} requests: cut it down to a window of the trace`)
  }
  if (rows.length === 0) throw new ByoError('this CSV has a header and no requests')

  const first = Math.min(...rows.map((r) => r.arrival))
  const requests: TraceRequest[] = rows
    .map((r, index) => ({ index, t: Math.round((r.arrival - first) * ticksPerUnit), p: r.p, o: r.o }))
    .sort((a, b) => a.t - b.t || a.index - b.index)
    .map(({ t, p, o }) => ({ t, p, o }))
  const requestSha256 = await sha256Hex(JSON.stringify(requests))
  return parseTraceArtifact({
    schemaVersion: 1,
    id: `local-${requestSha256.slice(0, 12)}`,
    name: fileName,
    kind: 'local-derived',
    source: 'your CSV file, converted on this device',
    sourceRevision: 'local',
    license: 'yours; never uploaded',
    attribution: 'you',
    note: 'Converted in your browser from a CSV. Nothing left the device.',
    sampling: { conversion: 'csv', arrivalColumn: arrivalName, rows: requests.length },
    requestCount: requests.length,
    requestSha256,
    requests,
  })
}

/** A trace file the learner picked: a `.json` replay artifact (kind `local-derived`) or a `.csv` converted here. */
export async function readTraceFile(fileName: string, text: string): Promise<TraceArtifact> {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv')) return csvToTraceArtifact(fileName, text)
  if (!lower.endsWith('.json')) throw new ByoError('pick a .json trace or a .csv file. ' + CSV_HELP)
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ByoError('this file is not JSON: pick a trace artifact (.json) or a .csv file')
  }
  let artifact: TraceArtifact
  try {
    artifact = await parseTraceArtifact(raw)
  } catch (e) {
    throw new ByoError(`this is not a trace artifact the course can read (${e instanceof Error ? e.message : String(e)}); a CSV converts without one. ${CSV_HELP}`)
  }
  if (artifact.kind !== 'local-derived') {
    throw new ByoError(`this trace says kind "${artifact.kind}": a trace you bring is "local-derived". The recorded and synthetic traces the course ships are on /fleet`)
  }
  return artifact
}

/** The first `size` requests by arrival, moved to start at tick 0. The artifact is already arrival-sorted. */
export function takeSample(artifact: TraceArtifact, size: number = SAMPLE_SIZE): TraceRequest[] {
  const window = artifact.requests.slice(0, size)
  const first = window[0]?.t ?? 0
  return window.map((r) => ({ t: r.t - first, p: r.p, o: r.o }))
}

/** Nearest-rank percentile (the engine's p95 rule) of a list of numbers; 0 for an empty list. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]
}

export interface SampleShape {
  requests: number
  /** The last arrival, in ticks from the first. */
  spanTicks: number
  promptMedian: number
  outputMedian: number
  /** Final context (prompt + output) at the 50th and 95th percentile, and the longest. */
  contextP50: number
  contextP95: number
  contextMax: number
}

export function sampleShape(sample: readonly TraceRequest[]): SampleShape {
  const finals = sample.map((r) => r.p + r.o)
  return {
    requests: sample.length,
    spanTicks: sample.length ? sample[sample.length - 1].t : 0,
    promptMedian: percentile(sample.map((r) => r.p), 0.5),
    outputMedian: percentile(sample.map((r) => r.o), 0.5),
    contextP50: percentile(finals, 0.5),
    contextP95: percentile(finals, 0.95),
    contextMax: finals.length ? Math.max(...finals) : 0,
  }
}

/* ------------------------------------------------------------------ */
/* The model: KV per token                                              */
/* ------------------------------------------------------------------ */

/** A config.json through the zoo's reader; a failure is the reader's own named error. */
export function readConfig(text: string, name: string): ZooModel {
  const parsed = parseConfig(text, name)
  if (!parsed.ok) throw new ByoError(parsed.error.message)
  return parsed.model
}

export interface KvReading {
  /** The context the reading is at, in tokens. */
  contextTokens: number
  /** Bytes the cache stores for one request at that context. */
  storedBytes: number
  /** storedBytes / contextTokens. */
  bytesPerToken: number
}

/** KV bytes per token at context t: the zoo's stored bytes over t. t is a whole number of at least 1. */
export function kvAt(model: ZooModel, t: number, b: number = DEFAULT_ELEMENT_BYTES): KvReading {
  if (!Number.isSafeInteger(t) || t < 1) throw new RangeError(`KV per token is read at a context of at least 1 token, got ${t}`)
  const storedBytes = zooBytes(model, t, b).stored
  return { contextTokens: t, storedBytes, bytesPerToken: storedBytes / t }
}

/* ------------------------------------------------------------------ */
/* Hardware, pool and price                                             */
/* ------------------------------------------------------------------ */

/** Atlas rows that carry a memory capacity: B300 and TPU7x do not, and the pool is built from it. */
export const SERVICE_HARDWARE: readonly HardwareRow[] = ATLAS.filter((r) => r.hbmGb !== undefined)

export interface DatedPrice {
  usdPerGpuHour: number
  /** YYYY-MM-DD */
  asOf: string
  claimId: string
  /** The day the claim went stale, or null while it is fresh. */
  staleSince: string | null
}

/** The atlas's dated median rental price for a row that has one, else null (the learner types a price and its date). */
export function defaultPrice(hardwareId: string, now: Date): DatedPrice | null {
  const claimId = PRICE_CLAIMS[hardwareId]
  if (claimId === undefined) return null
  const claim = getClaim(claimId)
  if (typeof claim.value !== 'number') return null
  return { usdPerGpuHour: claim.value, asOf: claim.verifiedAt, claimId, staleSince: staleSince(claim, now) }
}

const DAY_MS = 86_400_000

/** Parses a YYYY-MM-DD date to its UTC day number, or null when it is not a real calendar date. */
export function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const back = new Date(ms).toISOString().slice(0, 10)
  return back === date ? ms / DAY_MS : null
}

/** Days from `asOf` to `today` (both YYYY-MM-DD), or null when either is not a real date. */
export function priceAgeDays(asOf: string, today: string): number | null {
  const a = dayNumber(asOf)
  const b = dayNumber(today)
  return a === null || b === null ? null : b - a
}

/** What the form holds as text. */
export interface SettingsForm {
  hardwareId: string
  gpus: string
  weightsGb: string
  hbmShare: string
  maxRunning: string
  sloMs: string
  priceUsd: string
  priceDate: string
}

export interface Settings {
  hardware: HardwareRow & { hbmGb: number }
  gpus: number
  weightsGb: number
  hbmShare: number
  maxRunning: number
  sloMs: number
  sloTicks: number
  priceUsd: number
  priceDate: string
}

export type SettingsErrors = Partial<Record<keyof SettingsForm, string>>

function plainNumber(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text)
}

/** Reads the form: every field either becomes a value or gets one sentence saying what is wrong. `today` is YYYY-MM-DD. */
export function readSettings(form: SettingsForm, today: string): { ok: true; settings: Settings } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {}
  const hardware = SERVICE_HARDWARE.find((r) => r.id === form.hardwareId)
  if (!hardware || hardware.hbmGb === undefined) errors.hardwareId = 'pick a chip'
  const gpus = plainNumber(form.gpus)
  if (!Number.isInteger(gpus) || gpus < 1 || gpus > 72) errors.gpus = 'a whole number from 1 to 72'
  const weightsGb = plainNumber(form.weightsGb)
  if (!Number.isFinite(weightsGb) || weightsGb <= 0 || weightsGb > 100_000) errors.weightsGb = 'a number of GB above 0 (the weights on these chips)'
  const hbmShare = plainNumber(form.hbmShare)
  if (!Number.isFinite(hbmShare) || hbmShare <= 0 || hbmShare > 1) errors.hbmShare = 'a share above 0 and at most 1'
  const maxRunning = plainNumber(form.maxRunning)
  if (!Number.isInteger(maxRunning) || maxRunning < 1 || maxRunning > 1024) errors.maxRunning = 'a whole number from 1 to 1,024'
  const sloMs = plainNumber(form.sloMs)
  if (!Number.isFinite(sloMs) || sloMs < TICK_SECONDS * 1000 || sloMs > 600_000) errors.sloMs = 'milliseconds, from 50 (one tick) to 600,000'
  const priceUsd = plainNumber(form.priceUsd)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 1000) errors.priceUsd = 'dollars per GPU-hour above 0'
  const age = priceAgeDays(form.priceDate, today)
  if (age === null) errors.priceDate = 'the date the price was read, as YYYY-MM-DD'
  else if (age < 0) errors.priceDate = 'a date that is not in the future'
  if (Object.keys(errors).length > 0 || !hardware || hardware.hbmGb === undefined) return { ok: false, errors }
  return {
    ok: true,
    settings: {
      hardware: hardware as HardwareRow & { hbmGb: number },
      gpus,
      weightsGb,
      hbmShare,
      maxRunning,
      sloMs,
      sloTicks: Math.ceil(sloMs / (TICK_SECONDS * 1000)),
      priceUsd,
      priceDate: form.priceDate,
    },
  }
}

export interface PoolPlan {
  /** Bytes of HBM for the KV cache: share × chips × capacity − weights. */
  kvBudgetBytes: number
  kvBytesPerToken: number
  /** Blocks the hardware holds at that cost per token. */
  blocksCapacity: number
  /** Blocks the run opens: capped at what the whole sample could ever hold at once, which changes nothing about the run. */
  blocks: number
  poolCapped: boolean
  /** Tokens the opened pool holds. */
  poolTokens: number
  /** Requests of the sample that fit the pool alone, and how many do not. */
  kept: TraceRequest[]
  tooLong: number
}

/** A request fits the pool alone when its prompt plus its output (at least the scheduler's headroom) fit. */
export const fitsPool = (r: TraceRequest, poolTokens: number): boolean => r.p + Math.max(r.o, HEADROOM_TOKENS) <= poolTokens

/**
 * The pool for a run. `kvBytesPerToken` is the reading at the sample's median context. Throws a ByoError when the weights
 * leave no room for a cache, or when no request of the sample fits.
 */
export function planPool(sample: readonly TraceRequest[], settings: Settings, kvBytesPerToken: number): PoolPlan {
  const kvBudgetBytes = settings.hbmShare * settings.gpus * settings.hardware.hbmGb * 1e9 - settings.weightsGb * 1e9
  if (kvBudgetBytes <= 0) {
    throw new ByoError(
      `the weights (${settings.weightsGb} GB) leave no room for a KV cache in ${settings.hbmShare} of ${settings.gpus} × ${settings.hardware.hbmGb} GB: use more chips, or a larger share`,
    )
  }
  const blocksCapacity = Math.floor(kvBudgetBytes / (kvBytesPerToken * BLOCK_SIZE))
  const capacityTokens = blocksCapacity * BLOCK_SIZE
  const kept = sample.filter((r) => fitsPool(r, capacityTokens))
  if (kept.length === 0) {
    throw new ByoError(
      `no request of the sample fits the ${capacityTokens.toLocaleString('en-US')}-token cache these chips leave after the weights: use more chips or a smaller model`,
    )
  }
  // With this many blocks nothing is ever refused: every request resident at once, each with its output and the scheduler's
  // headroom, and a block of rounding apiece. A bigger pool would run the same, so the run opens no more than this.
  const cover = Math.ceil(kept.reduce((n, r) => n + r.p + r.o + HEADROOM_TOKENS, 0) / BLOCK_SIZE) + kept.length
  const blocks = Math.min(blocksCapacity, cover)
  return {
    kvBudgetBytes,
    kvBytesPerToken,
    blocksCapacity,
    blocks,
    poolCapped: blocks < blocksCapacity,
    poolTokens: blocks * BLOCK_SIZE,
    kept,
    tooLong: sample.length - kept.length,
  }
}

/* ------------------------------------------------------------------ */
/* The batching run                                                     */
/* ------------------------------------------------------------------ */

/** The engine open the fleet worker runs: the reference scheduler, block manager and intake, on the kept requests. */
export function engineOpen(plan: Pick<PoolPlan, 'blocks' | 'kept'>, settings: Pick<Settings, 'maxRunning' | 'sloTicks'>): EngineOpen {
  return {
    mode: 'engine',
    slots: { sched: null, mgr: null, queue: null },
    traffic: plan.kept.map((r, index) => ({ id: index + 1, arrival: r.t, prompt: r.p, output: r.o })),
    cfg: {
      engine: { numBlocks: plan.blocks, blockSize: BLOCK_SIZE, maxRunning: settings.maxRunning, sloTtft: settings.sloTicks, prefillChunk: PREFILL_CHUNK },
      // room for every request of the sample: the intake queue sheds when it is full, and a learner's burst is not the lesson here
      intakeCap: plan.kept.length,
      drainPerTick: DRAIN_PER_TICK,
    },
  }
}

export interface RunOptions extends FleetSessionOptions {
  signal?: AbortSignal
  onProgress?: (done: number, total: number, tick: number) => void
}

/**
 * Runs the plan's sample in a fleet worker until it drains or the tick cap passes, and returns the last snapshot. The fleet
 * session loads on demand, so the page's first paint does not carry it. Rejects with the session's own errors (a timeout
 * names the tick) and with an AbortError when `signal` fires.
 */
export async function runBatching(plan: Pick<PoolPlan, 'blocks' | 'kept'>, settings: Pick<Settings, 'maxRunning' | 'sloTicks'>, options: RunOptions = {}): Promise<EngineSnapshot> {
  const { openFleetSession } = await import('@/lib/fleet-session')
  const { signal, onProgress, ...session } = options
  const open = engineOpen(plan, settings)
  const lastArrival = open.traffic[open.traffic.length - 1]?.arrival ?? 0
  const maxTicks = lastArrival + DRAIN_CAP_TICKS
  // big enough that a sparse trace is a few hundred round trips, small enough that one stays well inside the 2 s step budget
  const stepTicks = Math.min(20_000, Math.max(1000, Math.ceil(lastArrival / 100)))
  const run = await openFleetSession(open, session)
  try {
    for (;;) {
      if (signal?.aborted) throw Object.assign(new Error('the run was cancelled'), { name: 'AbortError' })
      const snapshot = await run.step(stepTicks)
      onProgress?.(snapshot.mine.done, run.total, snapshot.tick)
      if (snapshot.done || snapshot.tick >= maxTicks) return snapshot
    }
  } finally {
    run.close()
  }
}

export interface BatchingResult {
  /** Requests in the sample, and how many were run (the rest could not fit the pool alone). */
  sample: number
  run: number
  tooLong: number
  finished: boolean
  ticks: number
  completed: number
  /** Requests whose first token came inside the TTFT SLO, as a percentage of the sample (not served counts as missed). */
  goodputPct: number
  sloMet: number
  ttftP95Ms: number
  tpotP95Ms: number
  queueP95Ms: number
  autoPreempts: number
  capacityMisses: number
  shed: number
  inputTokens: number
  outputTokens: number
}

const round = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits

export function batchingResult(snapshot: EngineSnapshot, plan: Pick<PoolPlan, 'kept' | 'tooLong'>): BatchingResult {
  const m = snapshot.mine
  const sample = plan.kept.length + plan.tooLong
  return {
    sample,
    run: plan.kept.length,
    tooLong: plan.tooLong,
    finished: snapshot.done,
    ticks: snapshot.tick,
    completed: m.done,
    goodputPct: sample ? round((m.met / sample) * 100, 1) : 0,
    sloMet: m.met,
    ttftP95Ms: round(m.p95 * TICK_SECONDS * 1000, 1),
    tpotP95Ms: round(m.tpotP95 * TICK_SECONDS * 1000, 1),
    queueP95Ms: round(m.queueP95 * TICK_SECONDS * 1000, 1),
    autoPreempts: m.autoPreempts,
    capacityMisses: m.capMisses,
    shed: m.shed,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
  }
}

/* ------------------------------------------------------------------ */
/* Cost                                                                 */
/* ------------------------------------------------------------------ */

export interface CostResult {
  gpuHours: number
  dollars: number
  /** $ per million tokens delivered, input + output (the Fleet dashboard's definition); null when nothing was delivered. */
  perMtok: number | null
  /** $ per million output tokens; null when none were delivered. */
  perMtokOutput: number | null
  usdPerGpuHour: number
  priceDate: string
  gpus: number
}

/** The run's GPU-hours at the learner's price, over the tokens it delivered. */
export function costOf(result: Pick<BatchingResult, 'ticks' | 'inputTokens' | 'outputTokens'>, settings: Pick<Settings, 'gpus' | 'priceUsd' | 'priceDate'>): CostResult {
  const gpuHours = (result.ticks * TICK_SECONDS * settings.gpus) / 3600
  const dollars = gpuHours * settings.priceUsd
  const delivered = result.inputTokens + result.outputTokens
  return {
    gpuHours,
    dollars,
    perMtok: delivered > 0 ? (dollars / delivered) * 1e6 : null,
    perMtokOutput: result.outputTokens > 0 ? (dollars / result.outputTokens) * 1e6 : null,
    usdPerGpuHour: settings.priceUsd,
    priceDate: settings.priceDate,
    gpus: settings.gpus,
  }
}

/* ------------------------------------------------------------------ */
/* The summary file                                                     */
/* ------------------------------------------------------------------ */

export interface SummaryInput {
  trace: Pick<TraceArtifact, 'name' | 'kind' | 'requestSha256' | 'requestCount'>
  shape: SampleShape
  model: ZooModel
  p50: KvReading
  p95: KvReading
  settings: Settings
  plan: PoolPlan
  batching: BatchingResult
  cost: CostResult
}

const num = (x: number | null, digits: number): number | null => (x === null ? null : round(x, digits))

/** The summary as a plain object: what the page shows, in a file the learner keeps. Nothing in it is read from a clock. */
export function buildSummary(i: SummaryInput) {
  return {
    kind: 'kernelspace.service-capstone',
    version: 1,
    trace: {
      name: i.trace.name,
      kind: i.trace.kind,
      requestSha256: i.trace.requestSha256,
      requestsInFile: i.trace.requestCount,
      sampledRequests: i.shape.requests,
      contextP50: i.shape.contextP50,
      contextP95: i.shape.contextP95,
    },
    model: { name: i.model.name, layers: i.model.groups.reduce((n, g) => n + g.count, 0), groups: i.model.groups.map((g) => ({ label: g.label, count: g.count })) },
    hardware: {
      id: i.settings.hardware.id,
      name: i.settings.hardware.name,
      hbmGb: i.settings.hardware.hbmGb,
      gpus: i.settings.gpus,
      weightsGb: i.settings.weightsGb,
      hbmShare: i.settings.hbmShare,
    },
    kvPerToken: {
      elementBytes: DEFAULT_ELEMENT_BYTES,
      atContextP50: { tokens: i.p50.contextTokens, bytesPerToken: round(i.p50.bytesPerToken, 2), storedBytes: i.p50.storedBytes },
      atContextP95: { tokens: i.p95.contextTokens, bytesPerToken: round(i.p95.bytesPerToken, 2), storedBytes: i.p95.storedBytes },
    },
    pool: { blockSize: BLOCK_SIZE, blocksCapacity: i.plan.blocksCapacity, blocksOpened: i.plan.blocks, kvBudgetBytes: round(i.plan.kvBudgetBytes, 0) },
    batching: { ...i.batching, maxRunning: i.settings.maxRunning, sloTtftMs: i.settings.sloTicks * TICK_SECONDS * 1000 },
    cost: {
      usdPerGpuHour: i.cost.usdPerGpuHour,
      priceDate: i.cost.priceDate,
      gpuHours: round(i.cost.gpuHours, 6),
      dollars: round(i.cost.dollars, 6),
      perMtok: num(i.cost.perMtok, 4),
      perMtokOutput: num(i.cost.perMtokOutput, 4),
    },
    notes: NOTES,
  }
}

export const summaryText = (i: SummaryInput): string => JSON.stringify(buildSummary(i), null, 2) + '\n'

/* ------------------------------------------------------------------ */
/* Small formatters                                                     */
/* ------------------------------------------------------------------ */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

/** Bytes in binary units, three significant figures: 343597383680 is "320 GiB". */
export function formatBytes(bytes: number): string {
  let v = bytes
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i += 1
  }
  const digits = i === 0 || v >= 100 || Number.isInteger(v) ? 0 : v >= 10 ? 1 : 2
  return `${v.toFixed(digits)} ${UNITS[i]}`
}
