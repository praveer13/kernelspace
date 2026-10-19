/**
 * The step card's types (docs/specs/s5.md §3.2) and the shape of a calibrated row (§5.8, §6.3).
 *
 * Types only: nothing here runs, so importing it costs no bytes. The card itself is `card.ts`; the engine that
 * calls it per step is `engine-v2.ts` (S5-05), and the generated table that holds the rows is `table.ts` (S5-07).
 */

/** One chip at the weight precision of its row. */
export interface ChipShape {
  /** datasheet HBM bandwidth, B/s */
  bwBps: number
  /** dense peak at the row's weight precision, FLOP/s */
  peakFlops: number
  /** HBM capacity, bytes */
  hbmBytes: number
}

export interface ModelShape {
  /** parameters */
  params: number
  layers: number
  hidden: number
  /** KV bytes per token of one sequence, at the KV precision */
  kvBytesPerToken: number
  /** weight bytes streamed per step */
  weightBytes: number
}

export interface CardParams {
  /** share of the datasheet bandwidth reached reading weights and KV */
  etaMem: number
  /** share of the dense peak reached */
  etaFlop: number
  /** fixed cost per layer per step, µs */
  layerUs: number
  /** host work per running sequence per step, µs */
  seqUs: number
  /** effective all-reduce bandwidth at TP > 1, GB/s; null: no link term */
  linkGBs: number | null
}

export interface CardSpec {
  chip: ChipShape
  model: ModelShape
  params: CardParams
}

/** What one engine step carries (§3.1), each field summed over the batch. */
export interface StepLoad {
  /** sequences in the step */
  seqs: number
  /** tokens computed this step (T) */
  tokens: number
  /** KV entries read or written this step (K) */
  kvTokens: number
  /** causal attention token pairs (A) */
  attnPairs: number
}

export interface StepCard {
  /** bytes read per GPU */
  memBytes: number
  /** FLOP per GPU */
  flops: number
  /** all-reduce bytes per GPU */
  linkBytes: number
  memS: number
  flopS: number
  fixedS: number
  linkS: number
  stepS: number
  bound: 'mem' | 'flop'
  /** the step's duration, integer µs */
  us: number
}

/** A box: the configurations a row was fitted on (§6.3). */
export interface RowBox {
  /** tensor-parallel degrees the row serves */
  tp: readonly number[]
  maxNumSeqs: number
  /** nominal prompt and output lengths (range ratio 0.8) */
  shapes: readonly { isl: number; osl: number }[]
  batchTokens: number
}

/** The largest step the replays showed, per GPU where a division by TP applies (§6.3). */
export interface RowEnvelope {
  tokens: number
  decodeSeqs: number
  kvTokensPerGpu: number
  attnPairsPerGpu: number
}

/** The figures an H4 label prints, per metric (S5-D58). */
export interface LabelFigures {
  tpot: { p90: number; n: number }
  ttft: { mean: number; p90: number; n: number }
}

/** One row of the generated table: chip × engine release × weight precision on the Llama-3-70B architecture. */
export interface CalibratedRow {
  /** e.g. `h100-vllm-0-10-2-fp8` */
  key: string
  status: 'calibrated' | 'failed'
  spec: CardSpec
  /** the TTFT residual (fitted, not physics; S5-D11): used only against a published TTFT, never by the engine */
  harnessMs: number
  box: RowBox
  envelope: RowEnvelope
  eligible: { tpot: boolean; ttft: boolean }
  label: LabelFigures
}
