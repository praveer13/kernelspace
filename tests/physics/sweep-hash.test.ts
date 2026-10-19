/**
 * The v2 sweep hash in Bun (docs/specs/s5.md §6.4, §8.4, S5-15, gate B9): `tests/physics/sweep-hash.ts` run on the six
 * golden `EngineV2` configurations equals `tests/fixtures/physics/v2-sweep-hash.json`, which `e2e/physics-hash.spec.ts`
 * recomputes in headless Chromium. The fixture is written only when the hash is meant to move (a bumped `ENGINE_V2_REV`):
 *   SWEEP_HASH_WRITE=1 bun test tests/physics/sweep-hash.test.ts
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { readProtocol } from '../../scripts/physics-protocol'
import { ENGINE_V2_REV } from '../../src/lib/world/physics/engine-v2'
import golden from '../fixtures/physics/engine-v2-golden.json'
import { BOX_TP, SWEEP_CONFIGS, sha256Hex, sweepHash, type SweepHash } from './sweep-hash'

const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/physics/v2-sweep-hash.json', import.meta.url))
const SOURCE_PATH = fileURLToPath(new URL('./sweep-hash.ts', import.meta.url))

interface Fixture extends SweepHash { header: string }

const computed = sweepHash()

if (process.env.SWEEP_HASH_WRITE === '1') {
  const fixture: Fixture = {
    header:
      'v2 sweep hash (docs/specs/s5.md §6.4, §8.4, S5-15): the sha256 of JSON.stringify of EngineV2 stats() on the six golden configurations, run with fixture parameters (the §3.6 and §3.7 [proto] sets), not the fitted table. Bun (tests/physics/sweep-hash.test.ts) and headless Chromium (e2e/physics-hash.spec.ts) both recompute it from tests/physics/sweep-hash.ts and compare with this file; Firefox and WebKit are checked by hand. It moves only with ENGINE_V2_REV: rewrite with SWEEP_HASH_WRITE=1 bun test tests/physics/sweep-hash.test.ts.',
    ...computed,
  }
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`)
}
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture

describe('the v2 sweep hash (B9)', () => {
  test('the six configurations are the ones §6.4 names', () => {
    expect(SWEEP_CONFIGS.map((g) => `${g.row} tp${g.tp} c${g.c} ${g.isl}/${g.osl}`)).toEqual([
      'h100-vllm-0-10-2-fp8 tp2 c4 1024/1024',
      'h100-vllm-0-10-2-fp8 tp8 c64 1024/1024',
      'h100-vllm-0-10-2-fp8 tp2 c4 8192/1024',
      'b200-vllm-0-10-2-fp8 tp1 c4 1024/1024',
      'b200-vllm-0-10-2-fp8 tp8 c64 1024/1024',
      'b200-vllm-0-10-2-fp8 tp1 c4 8192/1024',
    ])
  })

  test('the boxes repeated in the sweep file are the protocol\'s boxTp', () => {
    const rows = readProtocol().rows
    for (const [key, tp] of Object.entries(BOX_TP)) expect([...(rows.find((r) => r.key === key)?.boxTp ?? [])]).toEqual([...tp])
  })

  test('the fixture was written at this rev, and the sweep equals it', () => {
    expect(fixture.rev).toBe(ENGINE_V2_REV)
    expect(computed.rev).toBe(fixture.rev)
    expect(computed.configs).toEqual(fixture.configs)
    expect(computed.sha256).toBe(fixture.sha256)
  })

  test('it is the hash S5-05 pins: the same six runs, the same stats, the same bytes as engine-v2-golden.json', () => {
    expect(fixture.sha256).toBe(golden.sha256)
    expect(fixture.rev).toBe(golden.rev)
    expect(fixture.configs.map((c) => ({ row: c.row, tp: c.tp, c: c.c, isl: c.isl, osl: c.osl, seed: c.seed }))).toEqual(golden.configs)
    expect(fixture.configs.map((c) => c.sha256)).toEqual(golden.stats.map((s) => createHash('sha256').update(JSON.stringify(s)).digest('hex')))
  })

  test('two runs give the same hash (the sweep has no state)', () => {
    expect(sweepHash()).toEqual(computed)
  })
})

describe('the browser-safe sha256', () => {
  const lengths = [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000]
  test.each(lengths)('equals node:crypto on %i bytes of ASCII (padding boundaries 55, 56, 64)', (n) => {
    const text = 'abcdefghij'.repeat(Math.ceil(n / 10)).slice(0, n)
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text).digest('hex'))
  })

  test('equals node:crypto on multi-byte text, taken as UTF-8', () => {
    const text = 'µs · ÷ × − 秒 ≤'
    expect(sha256Hex(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'))
  })

  test('the empty string is the published digest', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('the file the browser runs', () => {
  test('bundles for a browser with no node module and gives the fixture\'s hash when evaluated', async () => {
    const out = await build({
      entryPoints: [SOURCE_PATH],
      bundle: true,
      format: 'iife',
      globalName: 'SweepHash',
      platform: 'browser',
      target: 'es2022',
      write: false,
      logLevel: 'silent',
    })
    expect(out.outputFiles).toHaveLength(1)
    const bundle = out.outputFiles[0].text
    expect(bundle).not.toContain('node:')
    const evaluated = new Function(`${bundle}\nreturn SweepHash.sweepHash()`)() as SweepHash
    expect(evaluated).toEqual({ rev: fixture.rev, sha256: fixture.sha256, configs: fixture.configs })
  })
})
