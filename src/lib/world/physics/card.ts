/**
 * The step card (docs/specs/s5.md §3.2): what one engine step costs, in four sums and one max.
 *
 *   step = layers·t_layer + seqs·t_seq + linkBytes ÷ β + max(memBytes ÷ (η_m·BW), FLOPs ÷ (η_f·F))
 *
 * The operation order below is the contract: the golden step vectors (tests/fixtures/physics/step-vectors.json)
 * pin it, and a later Rust port is tested against the same file (S5-D25). Plain `+ − × ÷`, one `Math.max` and one
 * `Math.round`, so the result is bit-identical in Bun and every browser (§8.4). Pure: no claims are read here (I3),
 * the caller builds the shapes (Boot's way: `claimNumber(id, 1e12)` for TB/s and TFLOP/s, `1e9` for GB and B params).
 */

import type { CardParams, CardSpec, ChipShape, ModelShape, StepCard, StepLoad } from './types'

/** "The datasheet bound": η = 1, no fixed terms, no link term. At tp 1 and no KV it is Boot's weights ÷ bandwidth. */
export const NAPKIN: CardParams = { etaMem: 1, etaFlop: 1, layerUs: 0, seqUs: 0, linkGBs: null }

/** The η = 1 card for a chip and a model. */
export const napkinSpec = (chip: ChipShape, model: ModelShape): CardSpec => ({ chip, model, params: NAPKIN })

const MICRO = 1e6
const GIGA = 1e9

export function stepCard(spec: CardSpec, tp: number, load: StepLoad): StepCard {
  const { chip, model, params } = spec
  const { seqs, tokens: T, kvTokens: K, attnPairs: A } = load
  const W = model.weightBytes
  const kv = model.kvBytesPerToken
  const memBytes = (W + kv * K) / tp
  const flops = (2 * model.params * T + 4 * model.layers * model.hidden * A) / tp
  // two ring all-reduces of BF16 activations per layer
  const linkBytes = tp > 1 ? (2 * model.layers * T * model.hidden * 2 * 2 * (tp - 1)) / tp : 0
  const memS = memBytes / (params.etaMem * chip.bwBps)
  const flopS = flops / (params.etaFlop * chip.peakFlops)
  const linkS = params.linkGBs === null || tp === 1 ? 0 : linkBytes / (params.linkGBs * GIGA)
  const fixedS = (model.layers * params.layerUs + seqs * params.seqUs) / MICRO
  const stepS = fixedS + linkS + Math.max(memS, flopS)
  return {
    memBytes,
    flops,
    linkBytes,
    memS,
    flopS,
    fixedS,
    linkS,
    stepS,
    bound: memS >= flopS ? 'mem' : 'flop',
    us: Math.round(stepS * MICRO),
  }
}
