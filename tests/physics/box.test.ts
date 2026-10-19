/**
 * The coverage box and the step envelope (docs/specs/s5.md §6.3, S5-05): the KV room by hand, every box rule with its
 * reason, the protocol's KV drops reproduced, the envelope functions, and the two constants the box holds for the
 * worker pinned to the protocol block (S5-D46).
 */
import { describe, expect, test } from 'bun:test'
import {
  BOX_BLOCK_SIZE,
  BOX_RANGE_RATIO,
  EMPTY_ENVELOPE,
  GPU_MEM_UTIL,
  defaultNumBlocks,
  envelopeOf,
  exceeds,
  inBox,
  kvRoomTokens,
  stepEnvelope,
  widen,
  type BoxQuery,
} from '../../src/lib/world/physics/box'
import type { CalibratedRow, CardSpec, RowEnvelope } from '../../src/lib/world/physics/types'
import { readProtocol } from '../../scripts/physics-protocol'
import vectors from '../fixtures/physics/step-vectors.json'

const protocol = readProtocol()
const SPECS = vectors.specs as Record<string, CardSpec>
const SHAPES = [
  { isl: 1024, osl: 1024 },
  { isl: 1024, osl: 8192 },
  { isl: 8192, osl: 1024 },
]
const ENV: RowEnvelope = { tokens: 8192, decodeSeqs: 64, kvTokensPerGpu: 100_000, attnPairsPerGpu: 30e6 }

const row = (key: string, spec: CardSpec): CalibratedRow => {
  const p = protocol.rows.find((r) => r.key === key)
  if (!p) throw new Error(`no protocol row ${key}`)
  return {
    key,
    status: 'calibrated',
    spec,
    harnessMs: 0,
    box: { tp: p.boxTp, maxNumSeqs: 64, shapes: SHAPES, batchTokens: 8192 },
    envelope: ENV,
    eligible: { tpot: true, ttft: true },
    label: { tpot: { p90: 0, n: 0 }, ttft: { mean: 0, p90: 0, n: 0 } },
  }
}
const H100 = row('h100-vllm-0-10-2-fp8', SPECS['h100-fp8-example-a'])
const B200 = row('b200-vllm-0-10-2-fp8', SPECS['b200-fp8-example-b'])
// NVFP4 weights: params × 4.5 / 8 B (§3.3)
const NVFP4 = row('b200-vllm-0-10-2-nvfp4', {
  ...SPECS['b200-fp8-example-b'],
  model: { ...SPECS['b200-fp8-example-b'].model, weightBytes: 39.684375e9 },
})

const q = (tp: number, maxNumSeqs: number, isl: number, osl: number, extra: Partial<BoxQuery> = {}): BoxQuery => ({
  tp,
  maxNumSeqs,
  batchTokens: 8192,
  blockSize: 16,
  shape: { isl, osl, ratio: 0.8 },
  ...extra,
})

describe('the constants the box holds for the worker equal the protocol block (S5-D46)', () => {
  test('gpuMemUtil 0.9 and range ratio 0.8; the block is 16, the type of EngineV2Config.blockSize', () => {
    expect(GPU_MEM_UTIL).toBe(protocol.filters.gpuMemUtil)
    expect(BOX_RANGE_RATIO).toBe(protocol.replay.rangeRatio)
    expect(BOX_BLOCK_SIZE).toBe(16)
  })
})

describe('the KV room (§4.1\'s rule, the protocol\'s filters.kvRule)', () => {
  test('by hand: ⌊(0.9 · HBM · TP − W) ÷ kv⌋ tokens and ⌊… ÷ (kv · 16)⌋ blocks', () => {
    // H100 TP 2: 0.9 × 80e9 × 2 − 70.55e9 = 73.45e9 B; ÷ 163,840 = 448,303.2 tokens; ÷ 16 more = 28,018.95 blocks
    expect(0.9 * 80e9 * 2 - 70.55e9).toBe(73.45e9)
    expect(kvRoomTokens(H100, 2)).toBe(448_303)
    expect(defaultNumBlocks(H100, 2)).toBe(28_018)
    // H100 TP 4 and 8: 217.45e9 B and 505.45e9 B
    expect(kvRoomTokens(H100, 4)).toBe(1_327_209)
    expect(kvRoomTokens(H100, 8)).toBe(3_085_021)
    // B200 TP 1: 0.9 × 180e9 − 70.55e9 = 91.45e9 B → 558,166.5 tokens, 34,885.4 blocks
    expect(kvRoomTokens(B200, 1)).toBe(558_166)
    expect(defaultNumBlocks(B200, 1)).toBe(34_885)
    // B200 NVFP4 TP 1: 162e9 − 39.684375e9 = 122.315625e9 B → 746,555.3 tokens
    expect(kvRoomTokens(NVFP4, 1)).toBe(746_555)
  })

  test('the weights alone overflowing the pool leave no room, never a negative one', () => {
    const tiny: CalibratedRow = { ...H100, spec: { ...H100.spec, chip: { ...H100.spec.chip, hbmBytes: 40e9 } } }
    expect(kvRoomTokens(tiny, 1)).toBe(0)
    expect(defaultNumBlocks(tiny, 1)).toBe(0)
  })

  test('it reproduces the protocol\'s four KV drops, and keeps 44119, which the TTFT filter drops', () => {
    // the ids' configurations, read from the pinned snapshot: hardware, TP, conc, isl/osl
    const kvDrops: [string, CalibratedRow, number, number, number, number][] = [
      ['42140', B200, 1, 64, 1024, 8192],
      ['40752', B200, 1, 64, 8192, 1024],
      ['41507', H100, 2, 64, 1024, 8192],
      ['42070', H100, 2, 64, 8192, 1024],
    ]
    expect([...kvDrops.map((d) => d[0]), '44119'].sort()).toEqual([...protocol.filters.expectDropped].sort())
    for (const [, r, tp, c, isl, osl] of kvDrops) {
      const v = inBox(r, q(tp, c, isl, osl))
      expect(v.ok).toBe(false)
      expect(v.reason).toMatch(/^KV: 64 × /)
    }
    // 44119: H100 TP 2, c 32, 8k/1k: 32 × 9,216 = 294,912 ≤ 448,303
    expect(32 * 9216).toBe(294_912)
    expect(inBox(H100, q(2, 32, 8192, 1024))).toEqual({ ok: true, reason: '' })
  })
})

describe('inBox (§6.3)', () => {
  test('the protocol\'s box TPs are in: H100 2/4/8, B200 FP8 1/2/4/8, NVFP4 1/2/4 (TP 8 is fitted, not boxed)', () => {
    for (const tp of [2, 4, 8]) expect(inBox(H100, q(tp, 4, 1024, 1024)).ok).toBe(true)
    for (const tp of [1, 2, 4, 8]) expect(inBox(B200, q(tp, 4, 1024, 1024)).ok).toBe(true)
    for (const tp of [1, 2, 4]) expect(inBox(NVFP4, q(tp, 4, 1024, 1024)).ok).toBe(true)
    expect(inBox(NVFP4, q(8, 4, 1024, 1024))).toEqual({ ok: false, reason: 'TP 8 is outside the row\'s TP 1/2/4' })
    expect(inBox(H100, q(1, 4, 1024, 1024))).toEqual({ ok: false, reason: 'TP 1 is outside the row\'s TP 2/4/8' })
  })

  test('every rule, with its reason', () => {
    expect(inBox(H100, q(4, 64, 1024, 1024)).ok).toBe(true)
    expect(inBox(H100, q(4, 65, 1024, 1024)).reason).toBe('maxNumSeqs 65 is outside 1–64')
    expect(inBox(H100, q(4, 0, 1024, 1024)).reason).toBe('maxNumSeqs 0 is outside 1–64')
    expect(inBox(H100, q(4, 4, 1024, 1024, { batchTokens: 16_384 })).reason).toBe('token budget 16384 is not the box\'s 8192')
    expect(inBox(H100, q(4, 4, 1024, 1024, { blockSize: 32 })).reason).toBe('block size 32 is not 16')
    expect(inBox(H100, q(4, 4, 1024, 1024, { shape: undefined })).reason).toBe('the client does not state its shape')
    expect(inBox(H100, q(4, 4, 8192, 8192)).reason).toBe('shape 8192/8192 is not a box shape')
    expect(inBox(H100, q(4, 4, 1024, 1024, { shape: { isl: 1024, osl: 1024, ratio: 1 } })).reason).toBe('range ratio 1 is not 0.8')
    expect(inBox(H100, q(4, 4, 1024, 1024, { numBlocks: 100 })).reason).toBe('KV pool of 100 blocks is not the row\'s 82950')
    expect(inBox(H100, q(4, 4, 1024, 1024, { numBlocks: defaultNumBlocks(H100, 4) })).ok).toBe(true)
    expect(inBox(H100, q(2, 64, 8192, 1024)).reason).toBe('KV: 64 × (8192 + 1024) = 589824 tokens exceeds the room of 448303')
  })

  test('an in-box pool holds every request at its longest, so an in-box run cannot preempt', () => {
    for (const r of [H100, B200, NVFP4]) {
      for (const tp of r.box.tp) {
        for (const s of SHAPES) {
          for (const c of [4, 8, 16, 32, 64]) {
            if (!inBox(r, q(tp, c, s.isl, s.osl)).ok) continue
            // a request holds at most isl + osl − 1 KV entries, in blocks of 16
            expect(c * Math.ceil((s.isl + s.osl - 1) / 16)).toBeLessThanOrEqual(defaultNumBlocks(r, tp))
          }
        }
      }
    }
  })
})

describe('the envelope (§6.3)', () => {
  test('envelopeOf is the row\'s; a step at the envelope is inside, one past any maximum is out', () => {
    expect(envelopeOf(H100)).toBe(ENV)
    const at = { seqs: 64, tokens: 8192, kvTokens: 200_000, attnPairs: 60e6 }
    expect(exceeds(ENV, at, 2, 64)).toBe(false)
    expect(exceeds(ENV, { ...at, tokens: 8193 }, 2, 64)).toBe(true)
    expect(exceeds(ENV, at, 2, 65)).toBe(true)
    expect(exceeds(ENV, { ...at, kvTokens: 200_002 }, 2, 64)).toBe(true)
    expect(exceeds(ENV, { ...at, attnPairs: 60e6 + 2 }, 2, 64)).toBe(true)
    // per GPU: the same load at a larger TP is inside
    expect(exceeds(ENV, { ...at, kvTokens: 400_000, attnPairs: 120e6 }, 4, 64)).toBe(false)
  })

  test('stepEnvelope and widen build an envelope that holds every step it was built from', () => {
    const steps = [
      { load: { seqs: 4, tokens: 7376, kvTokens: 30_875, attnPairs: 27_207_753 }, tp: 1, decodes: 3 },
      { load: { seqs: 64, tokens: 64, kvTokens: 120_000, attnPairs: 120_000 }, tp: 8, decodes: 64 },
      { load: { seqs: 2, tokens: 2809, kvTokens: 11_001, attnPairs: 10_104_973 }, tp: 2, decodes: 1 },
    ]
    let env = EMPTY_ENVELOPE
    for (const s of steps) env = widen(env, stepEnvelope(s.load, s.tp, s.decodes))
    expect(env).toEqual({ tokens: 7376, decodeSeqs: 64, kvTokensPerGpu: 30_875, attnPairsPerGpu: 27_207_753 })
    for (const s of steps) expect(exceeds(env, s.load, s.tp, s.decodes)).toBe(false)
    expect(exceeds(EMPTY_ENVELOPE, steps[0].load, 1, 3)).toBe(true)
  })
})
