/**
 * The replay and its weighted sums (docs/specs/s5.md §5.3 steps 2-3, §5.6; S5-D9, S5-D14, S5-D53).
 *
 * A published point is replayed once through `EngineV2`: its 10·c requests queued at t = 0 in id order, `maxNumSeqs = c`,
 * the harness's token budget and block size, and the row's KV pool. The loop is closed and the output lengths are fixed
 * (`--ignore-eos`), so which requests run in which step does not depend on how long a step takes: the replay records the
 * steps through the engine's `onStep` hook with a `card` override that makes every step 1 µs (S5-D53), and that one log
 * serves every parameter set. `engine-v2.ts` is not edited, and its scheduler is the one recorded.
 *
 * From the log, two observations are sums over steps:
 *  - mean TPOT, the mean over requests of (lastUs − firstUs) ÷ (osl_r − 1), is Σ_s w_s · stepS_s with the fixed weight
 *    w_s = Σ over the requests r decoding in step s of 1 ÷ ((osl_r − 1) · R), R the number of requests;
 *  - median TTFT is the median over requests of each request's admission-to-first-token window, the sum of stepS_s over
 *    the steps from the one that admitted it to the one that completed its prefill; the median is taken per parameter
 *    set, since which requests sit in the middle can change with it.
 * `predictTpot` and `predictMedianTtft` sum the card's float `stepS` step by step: the "weighted-sum prediction" the
 * consistency check (§5.6) holds a real `EngineV2` run to. The fit (`fit.ts`) uses the same weights and windows,
 * decomposed into a memoised kernel and linear features.
 *
 * Pure: no constant of the protocol is written here. The caller (scripts/fit-physics.ts) reads them from the protocol
 * block and the claims and passes them in (S5-D46).
 */

import { makeRefManager } from '../../fleet-model'
import { stepCard } from './card'
import { closedLoop, type ClientDriver } from './client'
import { EngineV2, medianOf } from './engine-v2'
import type { CalibratedRow, CardSpec, StepCard, StepLoad } from './types'

/** The settings every replay of a row shares (protocol `replay`, `filters.gpuMemUtil`; the harness claims). */
export interface ReplaySettings {
  /** requests per unit of concurrency (protocol `replay.promptsPerConc`) */
  promptsPerConc: number
  /** lengths drawn uniformly on the integers [⌊ratio·L⌋, L] (protocol `replay.rangeRatio`) */
  rangeRatio: number
  /** the harness's per-step token budget (`status.inferencex.harness.batch-tokens`) */
  batchTokens: number
  /** KV block size (`status.vllm-0-10-2.block-size`) */
  blockSize: number
  /** the share of HBM the weights and the KV pool may take (protocol `filters.gpuMemUtil`) */
  gpuMemUtil: number
}

/** One published configuration to replay. */
export interface ReplayPoint {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  /** the client's seed (protocol `replay.seed`: hash32('ix:' + id)) */
  seed: number
}

/** A replay's record: per step its load, per request its lengths and the steps that bound its windows. */
export interface StepLog {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  /** R, the requests in the run */
  requests: number
  steps: number
  /** per step (§3.1) */
  seqs: Float64Array
  tokens: Float64Array
  kvTokens: Float64Array
  attnPairs: Float64Array
  /** per step: the sequences that decoded (the envelope's count, §6.3) */
  decodeSeqs: Int32Array
  /** per step: w_s, the step's weight in the mean TPOT */
  weights: Float64Array
  /** per request, by id */
  prompt: Int32Array
  output: Int32Array
  /** the step that admitted the request */
  admitStep: Int32Array
  /** the step that completed its prefill and stamped its first token */
  firstStep: Int32Array
  /** the step that stamped its last token */
  lastStep: Int32Array
}

/** The KV pool in blocks: ⌊(gpuMemUtil · HBM · TP − W) ÷ (kv · blockSize)⌋, `box.ts`'s `defaultNumBlocks` order (§5.3). */
export function replayNumBlocks(spec: CardSpec, tp: number, s: ReplaySettings): number {
  const { chip, model } = spec
  return Math.max(0, Math.floor((s.gpuMemUtil * chip.hbmBytes * tp - model.weightBytes) / (model.kvBytesPerToken * s.blockSize)))
}

/** A step that lasts 1 µs and costs nothing: the recorder's card, so the clock counts steps (S5-D53). */
const RECORDING_CARD: StepCard = {
  memBytes: 0,
  flops: 0,
  linkBytes: 0,
  memS: 0,
  flopS: 0,
  fixedS: 0,
  linkS: 0,
  stepS: 0,
  bound: 'mem',
  us: 1,
}

/**
 * The engine row a replay or a consistency run uses: the spec, and a box that is exactly this configuration, so the
 * engine's checks pass whatever the protocol's boxes are. The envelope never counts a step out.
 */
export function replayRow(spec: CardSpec, p: Omit<ReplayPoint, 'seed' | 'id'>, s: ReplaySettings): CalibratedRow {
  return {
    key: 'replay',
    status: 'calibrated',
    spec,
    harnessMs: 0,
    box: { tp: [p.tp], maxNumSeqs: p.conc, shapes: [{ isl: p.isl, osl: p.osl }], batchTokens: s.batchTokens },
    envelope: { tokens: Infinity, decodeSeqs: Infinity, kvTokensPerGpu: Infinity, attnPairsPerGpu: Infinity },
    eligible: { tpot: true, ttft: true },
    label: { tpot: { p90: 0, n: 0 }, ttft: { mean: 0, p90: 0, n: 0 } },
  }
}

/** The closed-loop client of a point (§5.3 step 2), with a tap that records each request's lengths by id. */
function tappedClient(p: ReplayPoint, s: ReplaySettings, prompt: Int32Array, output: Int32Array): ClientDriver {
  const inner = closedLoop({ conc: p.conc, n: s.promptsPerConc * p.conc, isl: p.isl, osl: p.osl, ratio: s.rangeRatio, seed: p.seed })
  return {
    shape: inner.shape,
    nextArrivalUs: () => inner.nextArrivalUs(),
    due: (clockUs) => {
      const due = inner.due(clockUs)
      for (const r of due) {
        prompt[r.id] = r.prompt
        output[r.id] = r.output
      }
      return due
    },
  }
}

const checkBlockSize = (blockSize: number): 16 => {
  if (blockSize !== 16) throw new Error(`EngineV2 runs 16-token blocks; the replay settings say ${blockSize}`)
  return blockSize
}

/**
 * Replays one point through `EngineV2` and records its steps (§5.3 step 2). `spec` gives the row's chip and model (for
 * the KV pool); its parameters are never read, since the recording card replaces the physics. Throws when the replay
 * is not what the weights assume: a preemption, a request admitted or prefilled twice, or a request whose decode steps
 * are not exactly the osl_r − 1 steps after its first token.
 */
export function replayPoint(spec: CardSpec, p: ReplayPoint, s: ReplaySettings): StepLog {
  const R = s.promptsPerConc * p.conc
  const prompt = new Int32Array(R)
  const output = new Int32Array(R)
  const admitStep = new Int32Array(R).fill(-1)
  const firstStep = new Int32Array(R).fill(-1)
  const lastStep = new Int32Array(R).fill(-1)
  const seqs: number[] = []
  const tokens: number[] = []
  const kvTokens: number[] = []
  const attnPairs: number[] = []
  const decodeSeqs: number[] = []
  const weights: number[] = []
  const numBlocks = replayNumBlocks(spec, p.tp, s)
  const engine = new EngineV2(
    {
      physics: { id: 'replay', row: replayRow(spec, p, s), tp: p.tp },
      maxNumSeqs: p.conc,
      batchTokens: s.batchTokens,
      blockSize: checkBlockSize(s.blockSize),
      numBlocks,
      explore: true,
      card: () => RECORDING_CARD,
      onStep: (rec) => {
        const step = seqs.length
        const { load } = rec
        seqs.push(load.seqs)
        tokens.push(load.tokens)
        kvTokens.push(load.kvTokens)
        attnPairs.push(load.attnPairs)
        decodeSeqs.push(rec.decoded.length)
        let w = 0
        for (const id of rec.decoded) {
          // a decode stamps the next token: it must follow the first token or the previous decode, step by step
          const prev = lastStep[id] >= 0 ? lastStep[id] : firstStep[id]
          if (firstStep[id] < 0 || prev !== step - 1) throw new Error(`replay ${p.id}: request ${id} decoded in step ${step} out of order`)
          lastStep[id] = step
          w += 1 / ((output[id] - 1) * R)
        }
        weights.push(w)
        for (const id of rec.admitted) {
          if (admitStep[id] >= 0) throw new Error(`replay ${p.id}: request ${id} admitted twice (a preemption)`)
          admitStep[id] = step
        }
        for (const id of rec.prefillDone) {
          if (firstStep[id] >= 0) throw new Error(`replay ${p.id}: request ${id} prefilled twice (a preemption)`)
          firstStep[id] = step
        }
      },
    },
    makeRefManager(numBlocks, s.blockSize),
    tappedClient(p, s, prompt, output),
  )
  engine.run()
  const stats = engine.stats()
  if (stats.preemptions !== 0) throw new Error(`replay ${p.id}: ${stats.preemptions} preemptions; the KV rule should exclude them`)
  if (stats.completed !== R) throw new Error(`replay ${p.id}: ${stats.completed} of ${R} requests completed`)
  for (let r = 0; r < R; r++) {
    if (output[r] < 2) throw new Error(`replay ${p.id}: request ${r} has ${output[r]} output tokens; TPOT needs two`)
    const last = lastStep[r] >= 0 ? lastStep[r] : firstStep[r]
    if (admitStep[r] < 0 || firstStep[r] < admitStep[r] || last - firstStep[r] !== output[r] - 1) {
      throw new Error(`replay ${p.id}: request ${r}'s steps (admitted ${admitStep[r]}, first ${firstStep[r]}, last ${last}) do not fit its ${output[r]} tokens`)
    }
  }
  return {
    id: p.id,
    tp: p.tp,
    conc: p.conc,
    isl: p.isl,
    osl: p.osl,
    requests: R,
    steps: seqs.length,
    seqs: Float64Array.from(seqs),
    tokens: Float64Array.from(tokens),
    kvTokens: Float64Array.from(kvTokens),
    attnPairs: Float64Array.from(attnPairs),
    decodeSeqs: Int32Array.from(decodeSeqs),
    weights: Float64Array.from(weights),
    prompt,
    output,
    admitStep,
    firstStep,
    lastStep,
  }
}

/** Step s's load, as the card reads it. */
export const loadAt = (log: StepLog, s: number): StepLoad => ({
  seqs: log.seqs[s],
  tokens: log.tokens[s],
  kvTokens: log.kvTokens[s],
  attnPairs: log.attnPairs[s],
})

/** stepS of every step under `spec`, in float, as `stepCard` computes it. */
export function stepSeconds(log: StepLog, spec: CardSpec): Float64Array {
  const out = new Float64Array(log.steps)
  for (let s = 0; s < log.steps; s++) out[s] = stepCard(spec, log.tp, loadAt(log, s)).stepS
  return out
}

/** The weighted-sum mean TPOT, seconds: Σ_s w_s · stepS_s in step order (§5.3 step 3). */
export function predictTpot(log: StepLog, spec: CardSpec, stepS: Float64Array = stepSeconds(log, spec)): number {
  let sum = 0
  for (let s = 0; s < log.steps; s++) sum += log.weights[s] * stepS[s]
  return sum
}

/** Each request's admission-to-first-token window, seconds: Σ stepS_s from its admission step to its first-token step. */
export function ttftWindows(log: StepLog, spec: CardSpec, stepS: Float64Array = stepSeconds(log, spec)): Float64Array {
  const out = new Float64Array(log.requests)
  for (let r = 0; r < log.requests; r++) {
    let sum = 0
    for (let s = log.admitStep[r]; s <= log.firstStep[r]; s++) sum += stepS[s]
    out[r] = sum
  }
  return out
}

/** The weighted-sum median TTFT from admission, seconds, by the protocol's median rule (`stats.median`, `medianOf`). */
export function predictMedianTtft(log: StepLog, spec: CardSpec, stepS: Float64Array = stepSeconds(log, spec)): number {
  return medianOf(Array.from(ttftWindows(log, spec, stepS)))
}

/**
 * The steps in the median windows: the windows of the request or two requests whose TTFT the median takes (in the
 * prediction's order). The engine rounds each step to whole µs, so its median TTFT can differ from the float sum by at
 * most 0.5 µs per step in those windows (§5.6, protocol `consistency.ttftMaxAbsUs`).
 */
export function medianWindowSteps(log: StepLog, spec: CardSpec, stepS: Float64Array = stepSeconds(log, spec)): number {
  const win = ttftWindows(log, spec, stepS)
  const order = Array.from({ length: log.requests }, (_, r) => r).sort((a, b) => win[a] - win[b] || a - b)
  const n = order.length
  const steps = (r: number) => log.firstStep[r] - log.admitStep[r] + 1
  return n % 2 === 1 ? steps(order[(n - 1) / 2]) : steps(order[n / 2 - 1]) + steps(order[n / 2])
}

/** What a real `EngineV2` run gives for a point, µs: mean TPOT and median TTFT from admission (§5.6). */
export interface EngineRun {
  meanTpotUs: number
  medianTtftUs: number
  iterations: number
  preemptions: number
}

/**
 * Runs `EngineV2` with `row` (the written table's row, its real card and clock; no recorder, no override) on a point's
 * closed loop. `explore` is passed through: true only when the row or configuration sits outside the box.
 */
export function runEngine(row: CalibratedRow, p: ReplayPoint, s: ReplaySettings, explore = false): EngineRun {
  const numBlocks = replayNumBlocks(row.spec, p.tp, s)
  const client = closedLoop({ conc: p.conc, n: s.promptsPerConc * p.conc, isl: p.isl, osl: p.osl, ratio: s.rangeRatio, seed: p.seed })
  const engine = new EngineV2(
    { physics: { id: 'consistency', row, tp: p.tp }, maxNumSeqs: p.conc, batchTokens: s.batchTokens, blockSize: checkBlockSize(s.blockSize), numBlocks, explore },
    makeRefManager(numBlocks, s.blockSize),
    client,
  )
  engine.run()
  const st = engine.stats()
  return { meanTpotUs: st.meanTpotUs, medianTtftUs: st.medianTtftUs, iterations: st.iterations, preemptions: st.preemptions }
}
