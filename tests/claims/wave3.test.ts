import { describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { byId, claimNumber, getClaim, lazyGroupFor, pinProblems, type Claim } from '@/data/claims/all'
import { SGLANG_PIN, VLLM_PIN } from '@/data/claims/engines'
import { MOE_CLAIMS } from '@/data/claims/lazy/moe'
import { SERVING3_CLAIMS } from '@/data/claims/lazy/serving3'
import { TILING_CLAIMS } from '@/data/claims/lazy/tiling'
import { TWIN_CLAIMS } from '@/data/claims/lazy/twins'

/**
 * Wave 3's claims (spec wave-3 §4.4, 3a-08): every row of the §4.4 table exists, is quoted or pinned as its kind
 * requires, and the verify-claims gate bites on the new kinds of drift (a derived FP8 figure, a DeepSeek-V3 expert
 * count that no longer parses out of its quoted config line).
 */
const root = resolve(import.meta.dir, '../..')

const GROUPS: Record<string, { home: string; claims: Claim[] }> = {
  tiling: { home: 'lazy/tiling', claims: TILING_CLAIMS },
  moe: { home: 'lazy/moe', claims: MOE_CLAIMS },
  serving3: { home: 'lazy/serving3', claims: SERVING3_CLAIMS },
  twins: { home: 'lazy/twins', claims: TWIN_CLAIMS },
}

/** The §4.4 table, one id per row. `bench.checkpoint-engine.sync` is in because its sentence is quotable (README, v0.4.2). */
const TABLE = [
  'hw.h100-sxm.sm-count',
  'hw.h100-sxm.l2',
  'hw.h100-sxm.smem-per-sm',
  'hw.h100-sxm.smem-per-block',
  'hw.h100-sxm.registers-per-sm',
  'hw.h100-sxm.fp8-sparse',
  'hw.h100-sxm.fp8-dense',
  'production.triton.group-size-m',
  'model.deepseek-v3.routed-experts',
  'model.deepseek-v3.experts-per-token',
  'production.eplb.rebalance',
  'production.vllm.eplb',
  'production.sglang.eplb',
  'production.vllm.disagg',
  'production.sglang.disagg',
  'bench.checkpoint-engine.sync',
  'twin.sglang.treecore',
  'twin.vllm.scheduler',
]

const ENGINE_FLAGS = ['production.vllm.eplb', 'production.sglang.eplb', 'production.vllm.disagg', 'production.sglang.disagg']
const TWINS = ['twin.sglang.treecore', 'twin.vllm.scheduler']

describe('the §4.4 table', () => {
  test('every row exists in the full registry, once, in the group that holds it', () => {
    const held = Object.values(GROUPS).flatMap((g) => g.claims.map((c) => c.id))
    expect([...held].sort()).toEqual([...TABLE].sort())
    for (const id of TABLE) expect(getClaim(id).id).toBe(id)
  })

  test('an id that is not loaded names the group to import', () => {
    for (const { home, claims } of Object.values(GROUPS)) for (const c of claims) expect(lazyGroupFor(c.id)).toBe(home)
  })

  test('a spec or a benchmark has its source url, title and quote, and a real date', () => {
    for (const id of TABLE) {
      const c = byId[id]
      expect(c.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (c.kind === 'derived') continue
      expect(c.source?.url.startsWith('https://')).toBe(true)
      expect(c.source?.title.trim()).toBeTruthy()
      expect(c.source?.quote?.trim()).toBeTruthy()
    }
  })

  test('a pinned claim has a real ref its url contains, and the engine and twin claims are status claims of 60 days', () => {
    for (const id of TABLE) expect(pinProblems(byId[id])).toEqual([])
    for (const id of [...ENGINE_FLAGS, ...TWINS, 'production.eplb.rebalance', 'production.triton.group-size-m']) {
      const c = byId[id]
      expect(c.kind).toBe('status')
      expect(c.pin).toBeDefined()
      expect(c.source?.url).toContain(c.pin?.ref ?? 'no pin')
      expect(c.ttlDays).toBe(60)
    }
  })

  test('the engine claims are read at the releases the other In-production claims use', () => {
    for (const id of ['production.vllm.eplb', 'production.vllm.disagg', 'twin.vllm.scheduler']) expect(byId[id].pin).toEqual(VLLM_PIN)
    for (const id of ['production.sglang.eplb', 'production.sglang.disagg', 'twin.sglang.treecore']) expect(byId[id].pin).toEqual(SGLANG_PIN)
  })

  test('the checkpoint-engine line is a benchmark that carries no pin', () => {
    const c = byId['bench.checkpoint-engine.sync']
    expect(c.kind).toBe('benchmark')
    expect(c.pin).toBeUndefined()
    expect(c.value).toBe(20)
  })

  test('the figures are the ones the cube is built on', () => {
    expect(claimNumber('hw.h100-sxm.sm-count')).toBe(132)
    expect(claimNumber('hw.h100-sxm.smem-per-sm')).toBe(228)
    expect(claimNumber('hw.h100-sxm.smem-per-block')).toBe(227)
    expect(claimNumber('hw.h100-sxm.registers-per-sm')).toBe(64 * 1024)
    expect(claimNumber('hw.h100-sxm.l2')).toBe(50)
    expect(claimNumber('production.triton.group-size-m')).toBe(8)
  })
})

describe('H100 FP8', () => {
  test('the dense figure is derived from the sparse one, and is half of it rounded down', () => {
    const dense = byId['hw.h100-sxm.fp8-dense']
    expect(dense.kind).toBe('derived')
    expect(dense.derived?.from).toEqual(['hw.h100-sxm.fp8-sparse'])
    expect(dense.source).toBeUndefined()
    expect(claimNumber('hw.h100-sxm.fp8-sparse')).toBe(3958)
    expect(dense.value).toBe(Math.floor(3958 / 2))
  })

  test('is within 1 TFLOPS of twice BF16 dense, the rule the cube, the roofline family and RooflineSim share', () => {
    const rule = 2 * claimNumber('hw.h100-sxm.bf16-dense')
    expect(Math.abs(claimNumber('hw.h100-sxm.fp8-dense') - rule)).toBeLessThanOrEqual(1)
  })
})

describe('DeepSeek-V3', () => {
  const experts = ['model.deepseek-v3.routed-experts', 'model.deepseek-v3.experts-per-token']

  test('the expert counts are 256 and 8', () => {
    expect(claimNumber(experts[0])).toBe(256)
    expect(claimNumber(experts[1])).toBe(8)
  })

  test('are read from the zoo\'s pinned config revision, at the zoo\'s url', () => {
    const zoo = byId['zoo.deepseek-v3.layers']
    expect(zoo.pin).toBeDefined()
    for (const id of experts) {
      const c = byId[id]
      expect(c.pin).toEqual(zoo.pin)
      expect(c.source?.url).toBe(zoo.source?.url ?? 'no zoo url')
    }
  })

  test('each quote is a JSON line of that config, and parses to the claim\'s value', () => {
    for (const id of experts) {
      const c = byId[id]
      const row = c.source?.row ?? ''
      const members = JSON.parse(`{${(c.source?.quote ?? '').trim().replace(/,$/, '')}}`) as Record<string, unknown>
      expect(members[row]).toBe(c.value)
    }
  })
})

/** A copy of the claims registry and the gate in a scratch directory, with one source file edited, and the gate's exit code and output. */
function gateOn(file: string, edit: (text: string) => string): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'verify-claims-'))
  try {
    mkdirSync(join(dir, 'scripts'))
    mkdirSync(join(dir, 'public'))
    mkdirSync(join(dir, 'src/data'), { recursive: true })
    cpSync(join(root, 'scripts/verify-claims.ts'), join(dir, 'scripts/verify-claims.ts'))
    cpSync(join(root, 'src/data/claims'), join(dir, 'src/data/claims'), { recursive: true })
    cpSync(join(root, 'src/data/engine'), join(dir, 'src/data/engine'), { recursive: true }) // models.ts reads the token corpus
    cpSync(join(root, 'public/claims.json'), join(dir, 'public/claims.json'))
    const at = join(dir, file)
    writeFileSync(at, edit(readFileSync(at, 'utf8')))
    const run = Bun.spawnSync(['bun', 'scripts/verify-claims.ts', '--write'], { cwd: dir })
    return { code: run.exitCode, out: `${run.stdout.toString()}${run.stderr.toString()}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('verify-claims on the new claims', () => {
  test('passes on the committed registry', () => {
    const run = Bun.spawnSync(['bun', 'scripts/verify-claims.ts'], { cwd: root })
    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
    expect(run.stdout.toString()).toContain('verify-claims: ok')
  })

  test('a derived FP8 figure that drifts from half the sparse one fails', () => {
    const { code, out } = gateOn('src/data/claims/lazy/tiling.ts', (t) => t.replace("kind: 'derived',\n    value: 1979,", "kind: 'derived',\n    value: 1980,"))
    expect(code).toBe(1)
    expect(out).toContain('hw.h100-sxm.fp8-dense: drift')
  })

  test('an expert count that its quoted config line does not give fails', () => {
    const { code, out } = gateOn('src/data/claims/lazy/moe.ts', (t) => t.replace('value: 256,', 'value: 255,'))
    expect(code).toBe(1)
    expect(out).toContain('model.deepseek-v3.routed-experts')
    expect(out).toContain('the quote says "n_routed_experts": 256, the claim says 255')
  })

  test('an engine flag whose pin the url does not contain fails', () => {
    const { code, out } = gateOn('src/data/claims/lazy/twins.ts', (t) => t.replace('pin: VLLM_PIN,', "pin: { repo: 'vllm-project/vllm', ref: 'v0.0.1' },"))
    expect(code).toBe(1)
    expect(out).toContain('twin.vllm.scheduler: source.url does not contain pin.ref "v0.0.1"')
  })
})

describe('the search index', () => {
  test('has a row for every new claim', () => {
    const index = JSON.parse(readFileSync(join(root, 'src/data/search-index.json'), 'utf8')) as { claims: [string, string, number | string, string][] }
    const ids = new Set(index.claims.map((row) => row[0]))
    for (const id of TABLE) expect(ids.has(id)).toBe(true)
  })
})
