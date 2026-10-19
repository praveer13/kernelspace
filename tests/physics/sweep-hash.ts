/**
 * The v2 sweep hash (docs/specs/s5.md §6.4, §8.4, S5-15, gate B9): `EngineV2` run on the six golden configurations of
 * §6.4 with the fixture rows (the §3.6 and §3.7 [proto] parameter sets of step-vectors.json, not the fitted table), and
 * the sha256 of `JSON.stringify` of their `stats()`.
 *
 * This file is written to run unchanged in Bun and in a browser: it imports no `node:` module, reads no file, and its
 * sha256 is the plain FIPS 180-4 loop, since `crypto.subtle` is missing on an insecure origin such as `about:blank`.
 * `sweep-hash.test.ts` runs it in Bun against `tests/fixtures/physics/v2-sweep-hash.json`; `e2e/physics-hash.spec.ts`
 * bundles it with esbuild into an IIFE (global `SweepHash`), evaluates it in headless Chromium and compares with the same
 * fixture. Firefox and WebKit are checked by hand with the same bundle and recorded in the PR body.
 *
 * The configurations and the fixture rows repeat `tests/physics/engine-v2.test.ts` on purpose (that file is S5-05's and
 * is not a module to import from): the test here proves the two agree, since both hash the same stats.
 */
import { makeRefManager } from '../../src/lib/fleet-model'
import { hash32 } from '../../src/lib/rng'
import { defaultNumBlocks } from '../../src/lib/world/physics/box'
import { closedLoop } from '../../src/lib/world/physics/client'
import { ENGINE_V2_REV, EngineV2, type EngineV2Config, type EngineV2Stats } from '../../src/lib/world/physics/engine-v2'
import type { CalibratedRow, CardSpec } from '../../src/lib/world/physics/types'
import vectors from '../fixtures/physics/step-vectors.json'

const SPECS = vectors.specs as Record<string, CardSpec>
const SHAPES = [
  { isl: 1024, osl: 1024 },
  { isl: 1024, osl: 8192 },
  { isl: 8192, osl: 1024 },
] as const

/** The protocol's `boxTp` per FP8 row; `sweep-hash.test.ts` checks them against `docs/physics/protocol.md`. */
export const BOX_TP: Record<string, readonly number[]> = {
  'h100-vllm-0-10-2-fp8': [2, 4, 8],
  'b200-vllm-0-10-2-fp8': [1, 2, 4, 8],
}

/** A fixture row: in-box everywhere the protocol boxes it, with an envelope tight enough that 8k prefills leave it. */
const fixtureRow = (key: string, spec: CardSpec): CalibratedRow => ({
  key,
  status: 'calibrated',
  spec,
  harnessMs: 0,
  box: { tp: [...BOX_TP[key]], maxNumSeqs: 64, shapes: SHAPES, batchTokens: 8192 },
  envelope: { tokens: 8192, decodeSeqs: 64, kvTokensPerGpu: 65_536, attnPairsPerGpu: 8e6 },
  eligible: { tpot: true, ttft: true },
  label: { tpot: { p90: 0, n: 0 }, ttft: { mean: 0, p90: 0, n: 0 } },
})

const H100 = fixtureRow('h100-vllm-0-10-2-fp8', SPECS['h100-fp8-example-a'])
const B200 = fixtureRow('b200-vllm-0-10-2-fp8', SPECS['b200-fp8-example-b'])
const ROWS: Record<string, CalibratedRow> = { [H100.key]: H100, [B200.key]: B200 }

export interface SweepConfig { row: string; tp: number; c: number; isl: number; osl: number; seed: number }

/** Per FP8 row: its smallest TP at c 4, 1k/1k; its largest TP at c 64, 1k/1k; its smallest TP at c 4, 8k/1k (§6.4). */
export const SWEEP_CONFIGS: SweepConfig[] = [H100, B200].flatMap((row) => {
  const lo = Math.min(...row.box.tp)
  const hi = Math.max(...row.box.tp)
  return [
    { tp: lo, c: 4, isl: 1024, osl: 1024 },
    { tp: hi, c: 64, isl: 1024, osl: 1024 },
    { tp: lo, c: 4, isl: 8192, osl: 1024 },
  ].map((g) => ({ row: row.key, ...g, seed: hash32(`ev2-golden:${row.key}:${g.tp}:${g.c}:${g.isl}/${g.osl}`) }))
})

/** One configuration run as the replay builds it (§5.3): a closed loop of 10·c requests at range ratio 0.8, FCFS. */
export function runConfig(g: SweepConfig): EngineV2Stats {
  const row = ROWS[g.row]
  const cfg: EngineV2Config = { physics: { id: 'fixture', row, tp: g.tp }, maxNumSeqs: g.c, batchTokens: 8192, blockSize: 16 }
  const client = closedLoop({ conc: g.c, n: 10 * g.c, isl: g.isl, osl: g.osl, ratio: 0.8, seed: g.seed })
  return new EngineV2(cfg, makeRefManager(defaultNumBlocks(row, g.tp), 16), client).run().stats()
}

/* ------------------------------ sha256 (FIPS 180-4), with no crypto API ------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/** The sha256 of a string's UTF-8 bytes, as lowercase hex. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 2 ** 32))
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0)
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + 4 * i)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      hh = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('')
}

/* ------------------------------ the sweep ------------------------------ */

export interface SweepHash {
  rev: string
  /** The sha256 of `JSON.stringify` of the six `stats()` in order; it equals `engine-v2-golden.json`'s. */
  sha256: string
  /** One per configuration, in order, so a mismatch names the configuration that moved. */
  configs: (SweepConfig & { sha256: string })[]
}

export function sweepHash(): SweepHash {
  const stats = SWEEP_CONFIGS.map(runConfig)
  return {
    rev: ENGINE_V2_REV,
    sha256: sha256Hex(JSON.stringify(stats)),
    configs: SWEEP_CONFIGS.map((g, i) => ({ ...g, sha256: sha256Hex(JSON.stringify(stats[i])) })),
  }
}
