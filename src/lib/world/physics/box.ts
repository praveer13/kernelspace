/**
 * The coverage box and the step envelope (docs/specs/s5.md §6.3, S5-D13).
 *
 *  - The box is configuration level: what a row was fitted on. `inBox` says whether an engine configuration and its
 *    client sit inside it, and why not. Out of box, `EngineV2` refuses to run unless it explores (labelled, never graded).
 *  - The envelope is step level: the largest step the replays of F ∪ H showed, per GPU where a division by TP applies.
 *    A step above any of its four maxima counts in `EngineV2.outOfEnvelope`; an exercise band rejects any seed with a
 *    count above zero.
 *
 * Two protocol constants live here because the engine runs in the fleet worker and cannot read the protocol: the KV
 * pool's `gpuMemUtil` and the range ratio. `tests/physics/box.test.ts` asserts both equal the protocol block's
 * (`filters.gpuMemUtil`, `replay.rangeRatio`), so the block stays their single source (S5-D46).
 */

import type { ClientShape } from './client'
import type { CalibratedRow, RowEnvelope, StepLoad } from './types'

/** `--gpu-memory-utilization` (protocol `filters.gpuMemUtil`): the share of HBM the KV pool and the weights may take. */
export const GPU_MEM_UTIL = 0.9
/** The harness's `--random-range-ratio` (protocol `replay.rangeRatio`): every box shape is nominal at this ratio. */
export const BOX_RANGE_RATIO = 0.8
/** vLLM 0.10.2's KV block size (`status.vllm-0-10-2.block-size`); `EngineV2Config.blockSize` is typed as this literal. */
export const BOX_BLOCK_SIZE = 16

/**
 * KV entries the pool holds at TP `tp`, in tokens: ⌊(gpuMemUtil · HBM · TP − W) ÷ kv⌋, the protocol's `filters.kvRule`
 * in its operation order. Zero when the weights alone overflow the pool.
 */
export function kvRoomTokens(row: CalibratedRow, tp: number): number {
  const { chip, model } = row.spec
  return Math.max(0, Math.floor((GPU_MEM_UTIL * chip.hbmBytes * tp - model.weightBytes) / model.kvBytesPerToken))
}

/** The engine's default pool: ⌊(gpuMemUtil · HBM · TP − W) ÷ (kv · blockSize)⌋ blocks (§6.2). */
export function defaultNumBlocks(row: CalibratedRow, tp: number, blockSize: number = BOX_BLOCK_SIZE): number {
  const { chip, model } = row.spec
  return Math.max(0, Math.floor((GPU_MEM_UTIL * chip.hbmBytes * tp - model.weightBytes) / (model.kvBytesPerToken * blockSize)))
}

/** What `inBox` reads: the engine's configuration and the client's shape. */
export interface BoxQuery {
  tp: number
  maxNumSeqs: number
  batchTokens: number
  blockSize: number
  /** the pool the engine runs with; unset means the default, which is in box */
  numBlocks?: number
  /** the client's shape; unset (a client that does not say) is out of box */
  shape?: ClientShape
}

export interface BoxVerdict {
  ok: boolean
  /** why not, in words; '' when ok */
  reason: string
}

/**
 * Inside the row's box (§6.3): tp ∈ boxTp; maxNumSeqs ≤ the box's; the box's token budget; block size 16; a box shape
 * at range ratio 0.8; the row's default KV pool; and maxNumSeqs · (isl + osl) within the KV room, so no in-box run
 * preempts. maxNumSeqs is the run's concurrency, since the closed loop queues every request at t = 0 (S5-D9). The
 * architecture and precisions are the row's own, so they need no check here; prefix caching does not exist in
 * `EngineV2`. The first failing rule is the reason.
 */
export function inBox(row: CalibratedRow, cfg: BoxQuery): BoxVerdict {
  const no = (reason: string): BoxVerdict => ({ ok: false, reason })
  const { box } = row
  if (!box.tp.includes(cfg.tp)) return no(`TP ${cfg.tp} is outside the row's TP ${box.tp.join('/')}`)
  if (!(cfg.maxNumSeqs >= 1 && cfg.maxNumSeqs <= box.maxNumSeqs)) return no(`maxNumSeqs ${cfg.maxNumSeqs} is outside 1–${box.maxNumSeqs}`)
  if (cfg.batchTokens !== box.batchTokens) return no(`token budget ${cfg.batchTokens} is not the box's ${box.batchTokens}`)
  if (cfg.blockSize !== BOX_BLOCK_SIZE) return no(`block size ${cfg.blockSize} is not ${BOX_BLOCK_SIZE}`)
  const shape = cfg.shape
  if (!shape) return no('the client does not state its shape')
  if (!box.shapes.some((s) => s.isl === shape.isl && s.osl === shape.osl)) return no(`shape ${shape.isl}/${shape.osl} is not a box shape`)
  if (shape.ratio !== BOX_RANGE_RATIO) return no(`range ratio ${shape.ratio} is not ${BOX_RANGE_RATIO}`)
  const pool = defaultNumBlocks(row, cfg.tp)
  if (cfg.numBlocks !== undefined && cfg.numBlocks !== pool) return no(`KV pool of ${cfg.numBlocks} blocks is not the row's ${pool}`)
  const room = kvRoomTokens(row, cfg.tp)
  const need = cfg.maxNumSeqs * (shape.isl + shape.osl)
  if (need > room) return no(`KV: ${cfg.maxNumSeqs} × (${shape.isl} + ${shape.osl}) = ${need} tokens exceeds the room of ${room}`)
  return { ok: true, reason: '' }
}

/** The row's envelope (§6.3), as `table.ts` stores it. */
export const envelopeOf = (row: CalibratedRow): RowEnvelope => row.envelope

/** One step's coordinates in envelope terms: decoding sequences are counted by the engine, the rest come from the load. */
export const stepEnvelope = (load: StepLoad, tp: number, decodeSeqs: number): RowEnvelope => ({
  tokens: load.tokens,
  decodeSeqs,
  kvTokensPerGpu: load.kvTokens / tp,
  attnPairsPerGpu: load.attnPairs / tp,
})

/** True when the step exceeds any of the envelope's four maxima. */
export function exceeds(env: RowEnvelope, load: StepLoad, tp: number, decodeSeqs: number): boolean {
  return (
    load.tokens > env.tokens ||
    decodeSeqs > env.decodeSeqs ||
    load.kvTokens / tp > env.kvTokensPerGpu ||
    load.attnPairs / tp > env.attnPairsPerGpu
  )
}

/** The smallest envelope holding both: fold `stepEnvelope` over a replay's steps to build a row's envelope (S5-07). */
export const widen = (a: RowEnvelope, b: RowEnvelope): RowEnvelope => ({
  tokens: Math.max(a.tokens, b.tokens),
  decodeSeqs: Math.max(a.decodeSeqs, b.decodeSeqs),
  kvTokensPerGpu: Math.max(a.kvTokensPerGpu, b.kvTokensPerGpu),
  attnPairsPerGpu: Math.max(a.attnPairsPerGpu, b.attnPairsPerGpu),
})

/** The envelope of no steps: every step exceeds it. `widen` it with each step's `stepEnvelope`. */
export const EMPTY_ENVELOPE: RowEnvelope = { tokens: 0, decodeSeqs: 0, kvTokensPerGpu: 0, attnPairsPerGpu: 0 }
