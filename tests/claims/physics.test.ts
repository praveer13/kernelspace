import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ALL_CLAIMS, byId, lazyGroupFor, pinProblems, type Claim } from '@/data/claims/all'
import { ENGINE_CLAIMS } from '@/data/claims/engines'
import { HARDWARE_CLAIMS } from '@/data/claims/hardware'
import { IX_POINT_CLAIMS } from '@/data/claims/lazy/ix-points'
import { EXTRACT_SHA256, INFERENCEX_PIN, LLAMA33_70B_PIN, PHYSICS_CLAIMS, RAW_SHA256, VLLM_0_10_2_PIN } from '@/data/claims/lazy/physics'
import { MODEL_CLAIMS } from '@/data/claims/models'
import { PRICE_CLAIMS } from '@/data/claims/prices'
import { PRODUCTION_CLAIMS } from '@/data/claims/production'
import { SERVING_CLAIMS } from '@/data/claims/serving'
import { ZOO_CLAIMS } from '@/data/claims/zoo'
import { buildSearchIndex, INDEX_PATH, serializeSearchIndex } from '../../scripts/build-search-index'
import {
  claimPoints,
  EXTRACT_PATH,
  generateClaims,
  readExtract,
  sha256Hex,
  toBytes,
  ttftClaimId,
  tpotClaimId,
  CLAIMS_PATH,
  TTFT_CLAIM_ROW,
} from '../../scripts/fetch-physics-points'
import { readProtocol } from '../../scripts/physics-protocol'
import { physProblems } from '../../scripts/verify-claims'

/**
 * The physics claims (docs/specs/s5.md §4.5, S5-03): the input claims of `lazy/physics.ts`, the generated point claims of
 * `lazy/ix-points.ts`, the reproducer rule of verify-claims and the exclusion of both groups from the ⌘K index. The quotes
 * were fetched on 2026-10-18 and are the owner's to sign (F1); nothing here can re-read them offline, so these tests hold the
 * structure, the arithmetic and the links between the claims, the protocol and the extract.
 */
const ROOT = resolve(import.meta.dir, '../..')
const protocol = readProtocol()
const rows = readExtract()
const claim = (id: string): Claim => {
  const c = byId[id]
  if (!c) throw new Error(`claim ${id} is not registered`)
  return c
}
const num = (id: string): number => {
  const v = claim(id).value
  if (typeof v !== 'number') throw new Error(`claim ${id} is not a number`)
  return v
}
const resolver = (id: string) => toBytes(num(id), claim(id).unit)

const HARNESS = ['vllm-version', 'batch-tokens', 'range-ratio', 'prompts-per-conc', 'gpu-mem-util', 'prefix-caching', 'kv-dtype', 'max-num-seqs'].map((s) => `status.inferencex.harness.${s}`)
const ZOO = ['layers', 'hidden', 'kv-heads', 'head-dim', 'heads', 'intermediate', 'vocab'].map((s) => `zoo.llama-3-3-70b.${s}`)
const BYTES = ['model.llama3-70b.kv-bytes-per-token-fp8', 'model.llama3-70b.weight-bytes-fp8', 'model.llama3-70b.weight-bytes-nvfp4']
const PEAKS = ['hw.hgx-b200.fp8-sparse-system', 'hw.hgx-b200.fp4-sparse-system', 'hw.b200.fp8-dense', 'hw.b200.fp4-dense']
const DATASET = 'bench.inferencex.llama70b-2025-10-29'

describe('the input claims (lazy/physics.ts)', () => {
  test('the group is the dataset, 8 harness settings, the block size, 4 peaks, 7 zoo fields and 3 byte claims', () => {
    expect(PHYSICS_CLAIMS.map((c) => c.id).sort()).toEqual([DATASET, ...HARNESS, 'status.vllm-0-10-2.block-size', ...PEAKS, ...ZOO, ...BYTES].sort())
    expect(new Set(PHYSICS_CLAIMS.map((c) => c.id)).size).toBe(PHYSICS_CLAIMS.length)
  })

  test('every claim has a source with a url and a quote, or is derived from claims, and a verifiedAt', () => {
    for (const c of PHYSICS_CLAIMS) {
      expect(c.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (c.kind === 'derived') {
        expect(c.derived?.from.length).toBeGreaterThan(0)
        for (const dep of c.derived?.from ?? []) expect(byId[dep]).toBeDefined()
      } else {
        expect(c.source?.url).toMatch(/^https:\/\//)
        expect(c.source?.quote?.trim()).toBeTruthy()
        expect(c.source?.row?.trim()).toBeTruthy()
      }
      expect(pinProblems(c)).toEqual([])
    }
  })

  test('the harness settings are status claims pinned to the harness commit of the protocol, and their urls contain it', () => {
    expect(INFERENCEX_PIN).toEqual(protocol.snapshot.harness)
    for (const id of HARNESS) {
      const c = claim(id)
      expect(c.kind).toBe('status')
      expect(c.pin).toEqual(INFERENCEX_PIN)
      expect(c.source?.url).toContain(INFERENCEX_PIN.ref)
      expect(c.source?.url.startsWith(`https://raw.githubusercontent.com/${INFERENCEX_PIN.repo}/${INFERENCEX_PIN.ref}/`)).toBe(true)
    }
  })

  test('the harness values are the ones the replay copies, and each quote carries its value', () => {
    expect(num('status.inferencex.harness.batch-tokens')).toBe(8192)
    expect(num('status.inferencex.harness.range-ratio')).toBe(protocol.replay.rangeRatio)
    expect(num('status.inferencex.harness.prompts-per-conc')).toBe(protocol.replay.promptsPerConc)
    expect(num('status.inferencex.harness.gpu-mem-util')).toBe(protocol.filters.gpuMemUtil)
    expect(claim('status.inferencex.harness.vllm-version').value).toBe('0.10.2')
    expect(claim('status.inferencex.harness.prefix-caching').value).toBe('off')
    expect(claim('status.inferencex.harness.kv-dtype').value).toBe('fp8')
    expect(claim('status.inferencex.harness.vllm-version').source?.quote).toContain('v0.10.2')
    expect(claim('status.inferencex.harness.batch-tokens').source?.quote).toContain('8192')
    expect(claim('status.inferencex.harness.range-ratio').source?.quote).toContain('0.8')
    expect(claim('status.inferencex.harness.prompts-per-conc').source?.quote).toContain('* 10')
    expect(claim('status.inferencex.harness.gpu-mem-util').source?.quote).toContain('0.9')
    expect(claim('status.inferencex.harness.kv-dtype').source?.quote).toContain('fp8')
    expect(claim('status.inferencex.harness.prefix-caching').source?.quote).toContain('no-enable-prefix-caching')
    // the B200 scripts pass 512, not the concurrency: the claim says so, and why it does not matter
    expect(claim('status.inferencex.harness.max-num-seqs').boundary).toContain('512')
  })

  test('the vLLM v0.10.2 block size is pinned to that tag, not to the release the In-production rows quote (S5-D34)', () => {
    const c = claim('status.vllm-0-10-2.block-size')
    expect(c.kind).toBe('status')
    expect(c.value).toBe(16)
    expect(c.pin).toEqual(VLLM_0_10_2_PIN)
    expect(VLLM_0_10_2_PIN.ref).toBe('v0.10.2')
    expect(c.source?.url).toContain('/v0.10.2/')
    expect(c.source?.quote).toContain('block_size = 16')
    // the replay's two vLLM settings come from this group, and the token budget is the harness's
    expect(protocol.replay.batchTokens).toBe('status.inferencex.harness.batch-tokens')
    expect(protocol.replay.blockSize).toBe(c.id)
    expect(claim(protocol.replay.batchTokens).source?.url).toContain(INFERENCEX_PIN.ref)
    expect(claim('status.vllm-0-10-2.block-size').pin?.ref).not.toBe(claim('production.vllm.block-size').pin?.ref)
  })

  test('the B200 peaks derive from the HGX system figures, and reproduce the numbers §3.3 expects', () => {
    expect(num('hw.hgx-b200.fp8-sparse-system')).toBe(72)
    expect(num('hw.hgx-b200.fp4-sparse-system')).toBe(144)
    expect(num('hw.b200.fp8-dense')).toBe((num('hw.hgx-b200.fp8-sparse-system') * 1000) / 8 / 2)
    expect(num('hw.b200.fp4-dense')).toBe((num('hw.hgx-b200.fp4-sparse-system') * 1000) / 8 / 2)
    expect(num('hw.b200.fp8-dense')).toBe(4500)
    expect(num('hw.b200.fp4-dense')).toBe(9000)
    // FP8 and FP4 are 2x and 4x the eager BF16 dense claim, the fallback §3.3 names
    expect(num('hw.b200.fp8-dense')).toBe(2 * num('hw.b200.bf16-dense'))
    expect(num('hw.b200.fp4-dense')).toBe(4 * num('hw.b200.bf16-dense'))
    for (const id of ['hw.hgx-b200.fp8-sparse-system', 'hw.hgx-b200.fp4-sparse-system']) {
      expect(claim(id).kind).toBe('spec')
      expect(claim(id).source?.url).toBe('https://www.nvidia.com/en-us/data-center/hgx/')
    }
    expect(claim('hw.b200.fp8-dense').kind).toBe('derived')
    expect(claim('hw.b200.fp4-dense').kind).toBe('derived')
  })

  test('the model byte claims are derived from the config claims and the NVFP4 bit width', () => {
    const kv = 2 * num('model.llama3-70b.layers') * num('model.llama3-70b.kv-heads') * num('model.llama3-70b.head-dim') * 1
    expect(kv).toBe(163_840)
    expect(num('model.llama3-70b.kv-bytes-per-token-fp8')).toBe(kv)
    expect(num('model.llama3-70b.weight-bytes-fp8')).toBe(num('model.llama3-70b.params') * 1e9)
    expect(num('model.llama3-70b.weight-bytes-fp8')).toBe(70.55e9)
    expect(num('model.llama3-70b.weight-bytes-nvfp4')).toBe((num('model.llama3-70b.params') * 1e9 * num('serving.nvfp4.bits-per-weight')) / 8)
    expect(num('model.llama3-70b.weight-bytes-nvfp4')).toBe(39_684_375_000)
    // 1.78x fewer weight bytes, the figure §5.8's finding uses
    expect(num('model.llama3-70b.weight-bytes-fp8') / num('model.llama3-70b.weight-bytes-nvfp4')).toBeCloseTo(1.7778, 4)
    expect(claim('model.llama3-70b.weight-bytes-fp8').boundary).toContain('1.05e9')
    // the units the point generator reads them in
    expect(resolver('model.llama3-70b.weight-bytes-fp8')).toBe(70.55e9)
    expect(resolver('model.llama3-70b.kv-bytes-per-token-fp8')).toBe(163_840)
  })

  test('every claim id the protocol names resolves', () => {
    const ids = [
      ...Object.values(protocol.model),
      ...protocol.rows.flatMap((r) => [r.bw, r.peak, r.hbm, r.weightBytes]),
      protocol.replay.batchTokens,
      protocol.replay.blockSize,
    ]
    for (const id of ids) expect(byId[id]).toBeDefined()
  })

  test('the Llama-3.3-70B config equals the model.llama3-70b fields the card reads', () => {
    const pairs: [string, string][] = [
      ['layers', 'layers'],
      ['hidden', 'hidden-size'],
      ['kv-heads', 'kv-heads'],
      ['head-dim', 'head-dim'],
      ['heads', 'attn-heads'],
      ['intermediate', 'ffn-size'],
      ['vocab', 'vocab'],
    ]
    expect(pairs.length).toBe(ZOO.length)
    for (const [zoo, model] of pairs) expect(num(`zoo.llama-3-3-70b.${zoo}`)).toBe(num(`model.llama3-70b.${model}`))
    // the protocol's model shape reads the same numbers
    expect(num(protocol.model.layers)).toBe(num('zoo.llama-3-3-70b.layers'))
    expect(num(protocol.model.hidden)).toBe(num('zoo.llama-3-3-70b.hidden'))
  })

  test('the zoo claims pin a full Hugging Face revision of the served checkpoint, and each quote is one JSON member of the claim\'s value', () => {
    expect(LLAMA33_70B_PIN.ref).toMatch(/^[0-9a-f]{40}$/)
    for (const id of ZOO) {
      const c = claim(id)
      expect(c.kind).toBe('spec')
      expect(c.pin).toEqual(LLAMA33_70B_PIN)
      expect(c.source?.url).toBe(`https://huggingface.co/${LLAMA33_70B_PIN.repo}/raw/${LLAMA33_70B_PIN.ref}/config.json`)
      const member = JSON.parse(`{${(c.source?.quote ?? '').replace(/,$/, '')}}`) as Record<string, unknown>
      expect(member[c.source?.row ?? '']).toBe(c.value)
    }
  })

  test('the dataset claim names the extract\'s sha256 and the raw response\'s size and sha256, and its count is the protocol\'s selection', () => {
    const c = claim(DATASET)
    expect(c.kind).toBe('benchmark')
    expect(c.source?.url).toBe(protocol.snapshot.url)
    expect(c.verifiedAt).toBe('2026-10-18')
    expect(c.ttlDays).toBe(180)
    const extractSha = sha256Hex(readFileSync(EXTRACT_PATH))
    expect(EXTRACT_SHA256).toBe(extractSha)
    expect(RAW_SHA256).toBe(protocol.snapshot.rawSha256)
    expect(c.boundary).toContain(extractSha)
    expect(c.boundary).toContain(protocol.snapshot.rawSha256)
    expect(c.boundary).toContain(protocol.snapshot.rawBytes.toLocaleString('en-US'))
    expect(c.boundary).toContain('unsigned')
    for (const id of protocol.filters.expectDropped) expect(c.boundary).toContain(id)
    const selected = rows.filter((r) => protocol.rows.some((p) => p.hardware === r.hardware && p.precision === r.precision))
    expect(c.value).toBe(selected.length)
    expect(c.value).toBe(165)
    expect(rows.length).toBe(285)
    // 681 rows in the response, 160 kept after the filters
    expect(c.boundary).toContain(`${protocol.snapshot.rawRows} rows`)
    expect(c.boundary).toContain(`${selected.length - protocol.filters.expectDropped.length}`)
    // the quote is a fragment of the first selected-looking row of the response, whose fields the selection reads
    expect(c.source?.quote).toContain('"framework":"vllm"')
    expect(c.source?.row).toContain('id 40518')
  })

  test('the group is stale-labelled from the snapshot: 180 days from 2026-10-18 is 2027-04-16', () => {
    const verified = Date.parse(`${claim(DATASET).verifiedAt}T00:00:00Z`)
    expect(new Date(verified + 180 * 86_400_000).toISOString().slice(0, 10)).toBe('2027-04-16')
  })
})

describe('the generated point claims (lazy/ix-points.ts)', () => {
  const byRow = (key: string) => IX_POINT_CLAIMS.filter((c) => c.id.startsWith(`bench.ix-l70.${key}.`) && c.id.endsWith('.tpot'))

  test('exactly the 87 claims of §4.5: 25 + 34 + 27 TPOT points and example B\'s median TTFT', () => {
    expect(IX_POINT_CLAIMS.length).toBe(87)
    expect(byRow('h100-vllm-0-10-2-fp8').length).toBe(25)
    expect(byRow('b200-vllm-0-10-2-fp8').length).toBe(34)
    expect(byRow('b200-vllm-0-10-2-nvfp4').length).toBe(27)
    expect(IX_POINT_CLAIMS.filter((c) => c.id.endsWith('.ttft-median')).map((c) => c.id)).toEqual(['bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.8192-1024.c4.ttft-median'])
    expect(new Set(IX_POINT_CLAIMS.map((c) => c.id)).size).toBe(87)
  })

  test('every bench.ix-l70 claim has a quote and a row, and the quote is the raw member of the value in seconds', () => {
    const extract = new Map(rows.map((r) => [r.id, r]))
    for (const c of IX_POINT_CLAIMS) {
      expect(c.id.startsWith('bench.ix-l70.')).toBe(true)
      expect(c.kind).toBe('benchmark')
      expect(c.unit).toBe('s')
      expect(c.source?.quote?.trim()).toBeTruthy()
      expect(c.source?.row?.trim()).toBeTruthy()
      expect(c.source?.url).toBe(protocol.snapshot.url)
      const id = /^id (\d+)$/.exec(c.source?.row ?? '')?.[1] ?? ''
      const point = extract.get(id)
      expect(point).toBeDefined()
      const member = c.id.endsWith('.ttft-median') ? 'median_ttft' : 'mean_tpot'
      expect(c.value).toBe(point?.[member])
      expect(c.source?.quote).toBe(`"${member}":${JSON.stringify(point?.[member])}`)
      expect(c.verifiedAt).toBe('2026-10-18')
      expect(c.boundary).toContain(`row ${id}`)
      // the checkpoint the row's job served (70b-tmpl.yml: bmk-*-fp8 serve the FP8 checkpoint, bmk-b200-fp4 the FP4 one)
      const model = point?.precision === 'fp4' ? 'nvidia/Llama-3.3-70B-Instruct-FP4' : 'nvidia/Llama-3.3-70B-Instruct-FP8'
      expect(c.boundary).toContain(`, ${model}, vLLM`)
      expect(c.boundary).not.toContain(point?.precision === 'fp4' ? 'Instruct-FP8' : 'Instruct-FP4')
      expect(c.boundary).toContain(point?.run_url.split('/runs/')[1].split('/')[0] ?? 'no run')
    }
  })

  test('the cited points are the ones the lessons and the worked examples name', () => {
    const at = (id: string) => IX_POINT_CLAIMS.find((c) => c.source?.row === `id ${id}`)
    expect(at('41187')?.value).toBe(0.011776147370379336)
    expect(at('41187')?.source?.quote).toBe('"mean_tpot":0.011776147370379336')
    const ttft = IX_POINT_CLAIMS.find((c) => c.id.endsWith('.ttft-median'))
    expect(ttft?.source?.row).toBe(`id ${TTFT_CLAIM_ROW}`)
    expect(ttft?.value).toBe(0.654017546446994)
    expect(ttft?.source?.quote).toBe('"median_ttft":0.654017546446994')
    for (const id of ['42017', '41625', '40624', '40085']) expect(at(id)).toBeDefined()
  })

  test('the committed file is exactly what --claims writes from the extract and the registry, so a second run makes no diff', () => {
    const text = generateClaims(rows, protocol, resolver, sha256Hex(readFileSync(EXTRACT_PATH)))
    expect(readFileSync(CLAIMS_PATH, 'utf8')).toBe(text)
    const points = claimPoints(rows, protocol, resolver)
    expect(points.length).toBe(86)
    expect(IX_POINT_CLAIMS.map((c) => c.id)).toEqual([...points.map(tpotClaimId), ttftClaimId(points.find((p) => p.row.id === TTFT_CLAIM_ROW) as (typeof points)[number])])
  })

  test('every point sits at a fit concurrency inside its row\'s box (no held-out concurrency, no TP 8 of NVFP4)', () => {
    const extract = new Map(rows.map((r) => [r.id, r]))
    for (const c of IX_POINT_CLAIMS) {
      const point = extract.get((c.source?.row ?? '').slice(3))
      const prow = protocol.rows.find((p) => p.hardware === point?.hardware && p.precision === point?.precision)
      expect(prow).toBeDefined()
      expect(protocol.split.fitConc).toContain(point?.conc as number)
      expect(prow?.boxTp).toContain(point?.decode_tp as number)
    }
  })
})

describe('homes, order and the ⌘K index', () => {
  const PHYSICS_PREFIXES = [
    'bench.inferencex.', 'status.inferencex.', 'status.vllm-0-10-2.', 'hw.hgx-b200.fp8', 'hw.hgx-b200.fp4', 'hw.b200.fp8-dense', 'hw.b200.fp4-dense',
    'zoo.llama-3-3-70b.', 'model.llama3-70b.kv-bytes', 'model.llama3-70b.weight-bytes', 'phys.', 'hw.mi325x.', 'hw.mi355x.',
  ]

  test('homes.ts gives every S5 prefix to lazy/physics and the point prefix to lazy/ix-points, before the claims that need them exist', () => {
    for (const prefix of PHYSICS_PREFIXES) expect(lazyGroupFor(`${prefix}x`)).toBe('lazy/physics')
    expect(lazyGroupFor('bench.ix-l70.h100-vllm-0-10-2-fp8.tp2.1024-1024.c4.tpot')).toBe('lazy/ix-points')
    // ids S5-07 and S5-08 will add
    for (const id of ['phys.h100-vllm-0-10-2-fp8.eta-mem', 'phys.finding.tp2-to-tp8', 'phys.control.mi325x.loo-tpot-p90', 'phys.nim.h100-tp2.itl-mean', 'hw.mi325x.hbm-bw', 'hw.mi355x.fp8-dense']) {
      expect(lazyGroupFor(id)).toBe('lazy/physics')
    }
  })

  test('each claim of a group is homed at its own file', () => {
    for (const c of PHYSICS_CLAIMS) expect(lazyGroupFor(c.id)).toBe('lazy/physics')
    for (const c of IX_POINT_CLAIMS) expect(lazyGroupFor(c.id)).toBe('lazy/ix-points')
  })

  test('both groups are in ALL_CLAIMS after the older lazy groups, and no eager file holds a claim of either', () => {
    const ids = ALL_CLAIMS.map((c) => c.id)
    const eager = new Set([...HARDWARE_CLAIMS, ...MODEL_CLAIMS, ...PRICE_CLAIMS, ...PRODUCTION_CLAIMS, ...ENGINE_CLAIMS, ...SERVING_CLAIMS, ...ZOO_CLAIMS].map((c) => c.id))
    for (const c of [...PHYSICS_CLAIMS, ...IX_POINT_CLAIMS]) {
      expect(ids).toContain(c.id)
      expect(eager.has(c.id)).toBe(false)
    }
    expect(ids.indexOf(PHYSICS_CLAIMS[0].id)).toBeGreaterThan(ids.indexOf('field.decode-kv.serve'))
    expect(ids.indexOf(IX_POINT_CLAIMS[0].id)).toBeGreaterThan(ids.indexOf(PHYSICS_CLAIMS[PHYSICS_CLAIMS.length - 1].id))
  })

  test('the ⌘K index leaves out both groups (S5-D36) and keeps every other claim; the committed file is the builder\'s output', () => {
    const left = new Set([...PHYSICS_CLAIMS, ...IX_POINT_CLAIMS].map((c) => c.id))
    const indexed = buildSearchIndex().claims.map((row) => row[0])
    for (const id of left) expect(indexed).not.toContain(id)
    expect(indexed).toEqual(ALL_CLAIMS.filter((c) => !left.has(c.id)).map((c) => c.id))
    expect(readFileSync(resolve(ROOT, INDEX_PATH), 'utf8')).toBe(serializeSearchIndex(buildSearchIndex()))
  })
})

describe('the phys.* reproducer rule (verify-claims)', () => {
  const phys = (id: string, value: number | string = 0.0512): Claim => ({
    id,
    kind: 'derived',
    value,
    label: `fixture ${id}`,
    verifiedAt: '2026-10-18',
    ttlDays: 180,
    derived: { from: [DATASET], formula: 'fixture' },
  })
  const other = (id: string): Claim => ({ id, kind: 'synthetic', value: 1, label: id, verifiedAt: '2026-10-18', ttlDays: 90 })

  test('no phys.* claim, no check: a registry without them passes with no report', () => {
    expect(physProblems([other('hw.x.y')], {})).toEqual([])
    expect(ALL_CLAIMS.filter((c) => c.id.startsWith('phys.'))).toEqual([])
    for (const name of ['report.json', 'decisions.json', 'controls.json']) expect(existsSync(resolve(ROOT, 'docs/physics', name))).toBe(false)
  })

  test('a phys.* claim no report carries fails, naming the three reports', () => {
    const problems = physProblems([phys('phys.row.eta-mem')], {})
    expect(problems.length).toBe(1)
    expect(problems[0]).toMatch(/phys\.row\.eta-mem: no reproducer/)
    for (const name of ['report.json', 'decisions.json', 'controls.json']) expect(problems[0]).toContain(`docs/physics/${name}`)
    expect(physProblems([phys('phys.row.eta-mem')], { 'report.json': { claimValues: {} } }).length).toBe(1)
    expect(physProblems([phys('phys.row.eta-mem')], { 'report.json': { other: 1 } }).length).toBe(1)
  })

  test('each of the three reports can reproduce a claim', () => {
    for (const name of ['report.json', 'decisions.json', 'controls.json'] as const) {
      expect(physProblems([phys('phys.a.b')], { [name]: { claimValues: { 'phys.a.b': 0.0512 } } })).toEqual([])
    }
  })

  test('a value that differs by more than 1e-9 relative is drift; one inside it passes', () => {
    expect(physProblems([phys('phys.a.b', 12.5)], { 'report.json': { claimValues: { 'phys.a.b': 12.5 * (1 + 5e-10) } } })).toEqual([])
    const drift = physProblems([phys('phys.a.b', 12.5)], { 'report.json': { claimValues: { 'phys.a.b': 12.5 * (1 + 2e-9) } } })
    expect(drift.length).toBe(1)
    expect(drift[0]).toMatch(/phys\.a\.b: drift/)
    expect(physProblems([phys('phys.a.b', 0.0512)], { 'report.json': { claimValues: { 'phys.a.b': 0.0513 } } }).length).toBe(1)
  })

  test('one report that matches is enough; every report that carries it disagreeing is drift', () => {
    const reports = { 'report.json': { claimValues: { 'phys.a.b': 1 } }, 'decisions.json': { claimValues: { 'phys.a.b': 2 } } }
    expect(physProblems([phys('phys.a.b', 2)], reports)).toEqual([])
    expect(physProblems([phys('phys.a.b', 3)], reports)[0]).toMatch(/drift.*report\.json gives 1.*decisions\.json gives 2/)
  })

  test('a malformed report is a problem, and a phys.* claim must be a number', () => {
    expect(physProblems([], { 'report.json': { claimValues: [1] } })[0]).toMatch(/claimValues is not an object/)
    expect(physProblems([], { 'report.json': { claimValues: { 'phys.a.b': 'x' } } })[0]).toMatch(/not a finite number/)
    expect(physProblems([phys('phys.a.b', 'text')], { 'report.json': { claimValues: { 'phys.a.b': 1 } } })[0]).toMatch(/is a number/)
  })

  test('only phys.* claims are held to it', () => {
    expect(physProblems([other('physics.other'), other('hw.phys.x')], {})).toEqual([])
  })

  test('verify-claims passes on the repository (no phys.* claim, no report) and checks the five new derivations', async () => {
    const run = Bun.spawn(['bun', 'scripts/verify-claims.ts'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    const [out, err, code] = await Promise.all([new Response(run.stdout).text(), new Response(run.stderr).text(), run.exited])
    expect(`${err}${out}`).toContain('verify-claims: ok')
    expect(code).toBe(0)
    // each derived claim of the group has a reproducer: the script lists the ones without
    expect(out).not.toMatch(/no reproducer for derived claim\(s\):[^\n]*(hw\.b200\.fp[48]-dense|model\.llama3-70b\.(kv-bytes|weight-bytes))/)
  })
})
