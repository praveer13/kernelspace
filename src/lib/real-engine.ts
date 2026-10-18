/**
 * real-engine — the flagship: a student's Rust scheduler (lab 06, compiled
 * to wasm) arbitrating a REAL model's token generation in the browser.
 *
 * The honest model: one GPU = one generation slot. The scheduler decides
 * admission AND order; every quantum we re-ask, and if the head changed,
 * the previous request is preempted and its partial output is REGENERATED
 * next time — recompute preemption with a real, felt cost (the prefill
 * time you watch tick by). TTFT/ITL are measured in wall-clock ms.
 *
 * The runtime is transformers.js from CDN (no build dependency): WebGPU
 * when the machine has one, wasm CPU otherwise. Model: Qwen3-0.6B q4
 * (Apache-2.0) by default.
 */

import { claimNumber } from '@/data/claims'
import type { SchedulerDriver, SchedView } from '@/lib/fleet-model'
import { estimateScore, logError } from '@/lib/items/grade'
import { rev32 } from '@/lib/ledger/stable'
import type { ItemResponse } from '@/lib/ledger/types'
import { parseNumeric } from '@/lib/sims/host'

export interface RealReq {
  id: number
  prompt: string
  estTokens: number
  maxNew: number
}

/** The canned workload: eight prompts, three size classes. */
export const REAL_WORKLOAD: RealReq[] = [
  { id: 1, prompt: 'Explain virtual memory to a backend engineer in two sentences.', estTokens: 16, maxNew: 48 },
  { id: 2, prompt: 'Write a haiku about a page fault.', estTokens: 10, maxNew: 32 },
  { id: 3, prompt: 'List three reasons decode is bandwidth-bound, one line each.', estTokens: 18, maxNew: 64 },
  { id: 4, prompt: 'What is copy-on-write? One paragraph.', estTokens: 12, maxNew: 48 },
  { id: 5, prompt: 'Summarize why continuous batching beats static batching, briefly.', estTokens: 16, maxNew: 56 },
  { id: 6, prompt: 'Give a one-line mental model for a TLB.', estTokens: 12, maxNew: 24 },
  { id: 7, prompt: 'Two sentences on why KV caches dominate long-context serving.', estTokens: 15, maxNew: 48 },
  { id: 8, prompt: 'Name the four questions for choosing a systems language.', estTokens: 13, maxNew: 40 },
]

export type ReqStatus = 'queued' | 'admitted' | 'generating' | 'done'

export interface RealReqState {
  spec: RealReq
  status: ReqStatus
  text: string
  tokens: number
  admittedAt?: number
  firstTokenAt?: number
  doneAt?: number
  preempted: number
}

export interface RealRunMetrics {
  avgTtftMs: number
  tokPerSec: number
  totalMs: number
  preemptions: number
}

type ProgressFn = (phase: string, frac: number) => void

export interface RealGenFn {
  (messages: { role: string; content: string }[], opts: Record<string, unknown>): Promise<
    { generated_text: { role: string; content: string }[] }[]
  >
}

/** A loaded model: the generation function plus the device it runs on. */
export interface LoadedModel {
  gen: RealGenFn
  device: string
}

/** Load the runtime + model in a WEB WORKER (main thread never blocks).
 *  webgpu when the machine has one, wasm otherwise. */
export async function loadRealModel(modelId: string, onProgress: ProgressFn): Promise<LoadedModel> {
  onProgress('spawning worker + loading transformers.js from CDN', 0)
  const worker = new Worker('/gen-worker.js')
  let seq = 0
  const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()
  let readyResolve: (device: string) => void = () => {}
  let readyReject: (e: Error) => void = () => {}
  worker.onmessage = (e) => {
    const m = e.data
    if (m.kind === 'progress') onProgress(m.phase, m.frac)
    else if (m.kind === 'ready') readyResolve(m.device)
    else if (m.kind === 'done') pending.get(m.id)?.resolve(m.text)
    else if (m.kind === 'error') {
      if (m.id === -1) readyReject(new Error(m.message))
      else pending.get(m.id)?.reject(new Error(m.message))
    }
  }
  const ready = new Promise<string>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  worker.postMessage({ kind: 'load', modelId })
  const device = await ready
  onProgress(`model ready (${device})`, 1)

  const gen: RealGenFn = async (messages, opts) => {
    const id = ++seq
    const prompt = messages.map((m) => m.content).join('\n')
    const maxNew = typeof opts.max_new_tokens === 'number' ? opts.max_new_tokens : 32
    const text = await new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ kind: 'gen', id, prompt, maxNew })
    })
    return [{ generated_text: [{ role: 'assistant', content: text }] }]
  }
  return { gen, device }
}

const QUANTUM_TOKENS = 8

/**
 * Run the workload with the given scheduler driver. The scheduler sees the
 * exact lab-06 state shape (iter, max_running=1, mem_cap huge, waiting,
 * running) — its admission ORDER is the generation order, and changing the
 * head mid-flight costs a real recompute.
 */
export async function runRealEngine(
  gen: RealGenFn,
  scheduler: SchedulerDriver,
  onUpdate: (states: RealReqState[], note?: string) => void,
): Promise<RealRunMetrics> {
  const t0 = performance.now()
  const states: RealReqState[] = REAL_WORKLOAD.map((spec) => ({
    spec,
    status: 'queued',
    text: '',
    tokens: 0,
    preempted: 0,
  }))
  const byId = new Map(states.map((s) => [s.spec.id, s]))
  const admitted: number[] = []
  let iter = 0
  let preemptions = 0

  const view = (): SchedView => ({
    iter: iter++,
    maxRunning: 1,
    memCap: 1 << 30,
    memUsed: 0,
    waiting: states
      .filter((s) => s.status === 'queued')
      .map((s) => ({ id: s.spec.id, arrival: s.spec.id, prompt: s.spec.estTokens })),
    running: states
      .filter((s) => s.status === 'admitted' || s.status === 'generating')
      .map((s) => ({ id: s.spec.id, arrival: s.spec.id, prompt: s.spec.estTokens, decoded: s.tokens, prefillLeft: 0 })),
  })

  while (true) {
    const remaining = states.filter((s) => s.status !== 'done')
    if (remaining.length === 0) break

    // ask the scheduler who may occupy the slot
    const action = scheduler.schedule(view())
    // explicit preemption: evict back to the queue (progress lost — the tax)
    for (const id of action.preempt) {
      const s = byId.get(id)
      if (s && (s.status === 'generating' || s.status === 'admitted')) {
        s.status = 'queued'
        s.preempted++
        preemptions++
        onUpdate(states, `req ${id} preempted by scheduler — ${s.tokens} tokens of progress will be recomputed`)
      }
    }
    for (const id of action.admit) {
      const s = byId.get(id)
      if (s && s.status === 'queued') {
        s.status = 'admitted'
        s.admittedAt = performance.now()
        admitted.push(id)
      }
    }
    // run the OLDEST non-done admitted request (admission order = the policy's order)
    const active = admitted
      .map((id) => byId.get(id))
      .find((s): s is RealReqState => !!s && (s.status === 'admitted' || s.status === 'generating'))
    if (!active) {
      // scheduler admitted nothing new and nothing is in flight — nudge: admit the oldest queued
      const oldest = states.find((s) => s.status === 'queued')
      if (!oldest) break
      oldest.status = 'admitted'
      oldest.admittedAt = performance.now()
      admitted.push(oldest.spec.id)
      continue
    }

    const chosen = active
    const spec = chosen.spec
    chosen.status = 'generating'
    const want = Math.min(spec.maxNew, chosen.tokens + QUANTUM_TOKENS)
    const out = await gen([{ role: 'user', content: spec.prompt }], {
      max_new_tokens: want,
      do_sample: false,
    })
    const text = out?.[0]?.generated_text?.at(-1)?.content ?? ''
    const newTokens = Math.max(chosen.tokens, Math.min(spec.maxNew, want)) // regenerate = same target; tokens = want
    if (chosen.firstTokenAt === undefined && newTokens > 0) chosen.firstTokenAt = performance.now()
    chosen.tokens = newTokens
    chosen.text = text
    onUpdate(states)
    if (chosen.tokens >= spec.maxNew || /<\|im_end\|>/.test(text)) {
      chosen.status = 'done'
      chosen.doneAt = performance.now()
    }
  }

  const doneStates = states.filter((s) => s.doneAt !== undefined)
  const ttfts = doneStates.map((s) => (s.firstTokenAt ?? 0) - (s.admittedAt ?? 0))
  const totalMs = performance.now() - t0
  const totalTokens = doneStates.reduce((a, s) => a + s.tokens, 0)
  return {
    avgTtftMs: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : 0,
    tokPerSec: Math.round((totalTokens / (totalMs / 1000)) * 10) / 10,
    totalMs: Math.round(totalMs),
    preemptions,
  }
}

/* ------------------------------------------------------------------ */
/* The measured-versus-predicted run (docs/specs/wave-3.md §16.10)     */
/* ------------------------------------------------------------------ */

/** The one model the run measures: Qwen3-0.6B at q4, the panel's default. */
export const MEASURED_MODEL_ID = 'onnx-community/Qwen3-0.6B-ONNX'

/**
 * What the download holds, as the panel's own label says (~400 MB). Decode at batch 1 streams about every weight once
 * per token, so this is the bytes a token costs; it is a nominal figure, and the page says so.
 */
export const MEASURED_BYTES = 400e6

/** The ledger id of the run: its event ref is `item:engine.measured-tps`. */
export const MEASURED_ITEM_ID = 'engine.measured-tps'
export const MEASURED_REF = `item:${MEASURED_ITEM_ID}` as const
export const MEASURED_UNIT = 'tok/s'

/** A prediction is right within this factor of the measurement: software efficiency alone moves a device's rate that much. */
export const OK_FACTOR = 2

/** A memory a prediction might use: transfer rate (MT/s) times bus width (bits) over 8 is bytes per second. */
export interface MemoryPreset {
  id: string
  label: string
  /** Mega-transfers per second per pin. */
  rate: number
  /** Total bus width in bits. */
  bits: number
}

export const MEMORY_PRESETS: readonly MemoryPreset[] = [
  { id: 'lpddr5-64', label: 'LPDDR5-6400, 64-bit', rate: 6400, bits: 64 },
  { id: 'ddr5-128', label: 'DDR5-5600, 2 × 64-bit', rate: 5600, bits: 128 },
  { id: 'lpddr5x-128', label: 'LPDDR5X-8533, 128-bit', rate: 8533, bits: 128 },
  { id: 'gddr6-128', label: 'GDDR6 14 Gb/s, 128-bit', rate: 14000, bits: 128 },
]

/** GB/s (10^9 bytes) of a memory configuration, to one decimal: rate × bits / 8 is MB/s. */
export const presetGBs = (p: Pick<MemoryPreset, 'rate' | 'bits'>): number => Math.round((p.rate * p.bits) / 8 / 100) / 10

/** The roofline ceiling on decode: every byte of the weights crosses memory once per token. */
export const ceilingTps = (bytes: number, gbps: number): number => (gbps * 1e9) / bytes

/** The KV cache's bytes per token of context: K and V for every layer and KV head (claims `model.qwen3-0-6b.*`). */
export function kvBytesPerToken(bytesPerValue: number): number {
  return 2 * claimNumber('model.qwen3-0-6b.layers') * claimNumber('model.qwen3-0-6b.kv-heads') * claimNumber('model.qwen3-0-6b.head-dim') * bytesPerValue
}

/** The H100 SXM's ceiling for the same bytes, from its HBM bandwidth claim (3.35 TB/s): the number this run is not. */
export const h100CeilingTps = (bytes: number): number => ceilingTps(bytes, claimNumber('hw.h100-sxm.hbm-bw', 1000))

export const MAX_GBS = 10_000
export const MAX_TPS = 100_000

/** A typed positive number within `max`, or null. */
export function parsePositive(text: string, max: number): number | null {
  const n = parseNumeric(text)
  return n !== null && n > 0 && n <= max ? n : null
}

/* ------------------------------ consent ------------------------------ */

/** The slice of `navigator.connection` the consent line reads. */
export interface ConnectionInfo {
  saveData?: boolean
  type?: string
  effectiveType?: string
}

/** What the browser says about the connection that bears on a 400 MB download, or null when it says nothing worrying. */
export function connectionWarning(c: ConnectionInfo | undefined): string | null {
  if (!c) return null
  if (c.type === 'cellular') return 'Your browser reports a cellular connection.'
  if (c.saveData === true) return 'Your browser has data saver on.'
  if (c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g') return `Your browser reports a slow connection (${c.effectiveType}).`
  return null
}

/** What the consent asks: the model, its size, where it goes and that nothing is sent. */
export const consentLine = (label: string, mb: number): string =>
  `${label} downloads about ${mb} MB into this browser, once: the browser keeps it, and nothing is sent anywhere. Do it on Wi-Fi.`

/* ------------------------------ the measurement ------------------------------ */

/** Greedy decode of the same prompt at two lengths: the difference of their times is pure decode. */
export const MEASURE_LO = 8
export const MEASURE_HI = 40
export const MEASURE_ROUNDS = 3
/** The workload's third prompt, which a thinking model answers at length, so 40 tokens are never the whole answer. */
export const MEASURE_PROMPT = REAL_WORKLOAD[2].prompt
/** The longest context a timed step sees: the chat template, the prompt and the 40 new tokens, rounded up. */
export const MEASURE_CONTEXT_TOKENS = 70

export interface DecodeMeasurement {
  /** The median round, in decode tokens per second. */
  tokPerSec: number
  /** Every round's rate, in the order run. */
  rounds: number[]
  /** Decode tokens each round timed (HI − LO). */
  tokens: number
}

/** A measurement that cannot be trusted; the message says what to do. */
export class MeasureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MeasureError'
  }
}

export interface MeasureOptions {
  /** Defaults to `performance.now`; tests pass a fake clock. */
  now?: () => number
  rounds?: number
  lo?: number
  hi?: number
  onProgress?: (done: number, total: number) => void
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Decode tokens per second on this device. `gen` runs a prompt for `lo` and then `hi` new tokens; both runs pay the
 * same prefill, the same worker round trip and the same first-token cost, so (hi − lo) tokens over the difference of
 * the two times is the decode rate alone. The median of the rounds is reported, because one slow round (a garbage
 * collection, a throttled core) should not decide it.
 *
 * A run's tokens are the cap asked for, which holds only if the answer did not end before the cap. The engine cannot say
 * how many tokens it made: the worker (public/gen-worker.js) posts back the pipeline's decoded text and nothing else, so
 * no token count reaches this function. Characters are a poor stand-in: the first tokens of a Qwen3 answer are a
 * '<think>' tag and a newline, whose characters per token are not the prose's, and the old test (the long text at least
 * 4× the short one) could refuse a healthy run. So the run checks the cap itself. The untimed first run, which lets the
 * runtime compile and warm up, asks for hi + 1 tokens; the prompt is greedy, so every run is a prefix of the same
 * answer, and a long run whose text is shorter than the first run's stopped at its cap of `hi` tokens, while one whose
 * text is as long ended before it (asking for one token more gave nothing more). That is refused, as is every answer of
 * `hi` tokens or fewer, one that ends exactly at `hi` too; `MEASURE_PROMPT` is one a thinking model answers at length,
 * so a healthy run never ends that soon.
 */
export async function measureDecodeTps(gen: RealGenFn, options: MeasureOptions = {}): Promise<DecodeMeasurement> {
  const now = options.now ?? (() => performance.now())
  const rounds = options.rounds ?? MEASURE_ROUNDS
  const lo = options.lo ?? MEASURE_LO
  const hi = options.hi ?? MEASURE_HI
  const messages = [{ role: 'user', content: MEASURE_PROMPT }]
  const timed = async (n: number): Promise<{ ms: number; text: string }> => {
    const t0 = now()
    const out = await gen(messages, { max_new_tokens: n, do_sample: false })
    return { ms: now() - t0, text: out?.[0]?.generated_text?.at(-1)?.content ?? '' }
  }

  options.onProgress?.(0, rounds)
  // the warm-up, and the answer one token past the long run: what a long run that reached its cap falls short of
  const past = await timed(hi + 1)
  const rates: number[] = []
  for (let i = 0; i < rounds; i++) {
    const short = await timed(lo)
    const long = await timed(hi)
    if (long.text.length === 0 || long.text.length >= past.text.length || long.text.length <= short.text.length) {
      throw new MeasureError('The model stopped before the timed length, so its tokens cannot be counted. Run it again.')
    }
    const seconds = (long.ms - short.ms) / 1000
    if (!(seconds > 0)) throw new MeasureError('The longer run did not take longer than the shorter one, so the clock cannot separate them. Run it again.')
    rates.push((hi - lo) / seconds)
    options.onProgress?.(i + 1, rounds)
  }
  const round1 = (x: number): number => Math.round(x * 10) / 10
  return { tokPerSec: round1(median(rates)), rounds: rates.map(round1), tokens: hi - lo }
}

/* ------------------------------ the comparison ------------------------------ */

export interface RunInputs {
  /** Your prediction, tok/s. */
  predicted: number
  /** The bandwidth you chose, GB/s. */
  bandwidthGBs: number
  /** What the engine measured, tok/s. */
  measured: number
  /** Defaults to `MEASURED_BYTES`. */
  bytes?: number
}

export interface RunComparison extends RunInputs {
  bytes: number
  /** The roofline for your bandwidth and these bytes. */
  ceiling: number
  /** measured ÷ predicted. */
  ratio: number
  /** |log10(predicted ÷ measured)|. */
  logErr: number
  ok: boolean
  score: number
  /** The bandwidth the measured rate implies: measured × bytes, in GB/s. */
  effectiveGBs: number
  /** effective ÷ chosen bandwidth. Above 1 means the device delivers more than the bandwidth chosen. */
  utilisation: number
}

export function compareRun(inputs: RunInputs): RunComparison {
  const bytes = inputs.bytes ?? MEASURED_BYTES
  const { predicted, measured, bandwidthGBs } = inputs
  const logErr = logError(predicted, measured) ?? Infinity
  const effectiveGBs = (measured * bytes) / 1e9
  return {
    predicted,
    measured,
    bandwidthGBs,
    bytes,
    ceiling: ceilingTps(bytes, bandwidthGBs),
    ratio: measured / predicted,
    logErr,
    ok: logErr <= Math.log10(OK_FACTOR) + 1e-9,
    score: Number.isFinite(logErr) ? estimateScore(logErr, OK_FACTOR) : 0,
    effectiveGBs,
    utilisation: effectiveGBs / bandwidthGBs,
  }
}

/** Where the gap comes from, said for the device the run used and hedged where the page cannot know. */
export function gapReading(c: RunComparison, device: string | null): string {
  if (c.utilisation > 1.05) {
    return `The measured rate moves ${c.effectiveGBs.toFixed(1)} GB/s of weights, more than the ${c.bandwidthGBs} GB/s you chose. Either this device has more memory bandwidth than you gave it, or a token reads fewer bytes than the nominal 400 MB.`
  }
  const pct = Math.round(c.utilisation * 100)
  const where =
    device === 'webgpu'
      ? 'With WebGPU the rest is usually kernel launches and the browser, not DRAM.'
      : device === 'wasm'
        ? 'On the wasm CPU path the rest is usually compute and threading, not DRAM: a few cores rarely saturate the memory bus.'
        : 'The rest is software: kernels, scheduling and the browser.'
  return `The engine used ${pct}% of the ${c.bandwidthGBs} GB/s you chose (${c.effectiveGBs.toFixed(1)} GB/s of weights). ${where}`
}

/**
 * The two events of a run: a `predict` (what you said, against what was measured) and an `item` (the graded response).
 * Provenance `field` gives them weight 0, and a donation keeps of each only its ref, its day, `ok` and `src` (redact.ts
 * `fieldOnly`): no value, no truth and no score, which with the prediction would give the measurement back. Your device's
 * speed stays on it.
 */
export function measuredRunItems(c: RunComparison): ItemResponse[] {
  const rev = rev32({ id: MEASURED_ITEM_ID, model: MEASURED_MODEL_ID, unit: MEASURED_UNIT, okWithinFactor: OK_FACTOR })
  // No `kcs` tag: a field event resolves to no KC (`item:engine.measured-tps` is in no ref-map), because cards.ts counts any
  // event that resolves to a KC as a review of its card, and a miss on your own device's speed is not a lapse.
  const data = { src: 'practice' as const, value: c.predicted, unit: MEASURED_UNIT, truth: c.measured }
  const base = { ref: MEASURED_REF, rev, score: c.score, ok: c.ok, provenance: 'field' as const, data }
  return [
    { kind: 'predict', ...base },
    { kind: 'item', ...base },
  ]
}
