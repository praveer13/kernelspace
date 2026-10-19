import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  buildExtract,
  checkMembers,
  claimPoints,
  EXTRACT_PATH,
  generateClaims,
  isKept,
  keptPopulations,
  kvTokenLimit,
  memberCount,
  NIM_BYTES,
  NIM_MARKDOWN,
  NIM_PATH,
  NIM_ROWS,
  NIM_SHA256,
  NIM_SOURCE,
  parseNim,
  POINT_KEYS,
  rawRows,
  readExtract,
  readNim,
  serializeExtract,
  serializeNim,
  sha256Hex,
  snapshotProblems,
  toBytes,
  toPointRow,
  ttftClaimId,
  tpotClaimId,
  type ClaimResolver,
  type PointRow,
} from '../../scripts/fetch-physics-points'
import { readProtocol } from '../../scripts/physics-protocol'
import type { Claim } from '../../src/data/claims/schema'

/**
 * The points snapshot (docs/specs/s5.md §4.1, §4.4, §4.6; S5-04). The extract and the NIM panel are read from the repo; the
 * script's functions run on small fixtures. The filters, the five drops and the F/H counts are S5-06's assertions (S5-D52),
 * so none of them is asserted here: this file checks the raw counts, the cited values, the files' form and their provenance.
 */
const ROOT = resolve(import.meta.dir, '../..')
const POINTS_DIR = resolve(ROOT, 'src/data/physics/points')
const protocol = readProtocol()
const rows = readExtract()
const byId = new Map(rows.map((r) => [r.id, r]))

/** The extract's own sha256: the pin S5-03 writes into the dataset claim's boundary. Regenerating the extract changes it. */
const EXTRACT_SHA256 = '541121788a076dab9df631321e6c692bf357523177c0f1425bcb11a018b74843'
const RUN = (n: string) => `https://github.com/SemiAnalysisAI/InferenceX/actions/runs/${n}`

describe('the extract', () => {
  test('has 285 rows, and its text is the serialisation of those rows (one row per line, sorted by numeric id)', () => {
    expect(rows).toHaveLength(285)
    const text = readFileSync(EXTRACT_PATH, 'utf8')
    expect(serializeExtract(rows)).toBe(text)
    expect(text.split('\n')).toHaveLength(285 + 3)
    const ids = rows.map((r) => Number(r.id))
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(285)
    expect(sha256Hex(text)).toBe(EXTRACT_SHA256)
  })

  test('every row has exactly §4.6\'s keys in order, with the types of the response', () => {
    for (const r of rows) {
      expect(Object.keys(r)).toEqual([...POINT_KEYS])
      expect(typeof r.id).toBe('string')
      expect(Number.isInteger(r.decode_tp) && Number.isInteger(r.conc) && Number.isInteger(r.isl) && Number.isInteger(r.osl)).toBe(true)
      expect(Number.isFinite(r.mean_tpot) && r.mean_tpot > 0).toBe(true)
      expect(Number.isFinite(r.median_ttft) && r.median_ttft > 0).toBe(true)
    }
  })

  test('the protocol\'s selection, read through readProtocol(), gives 45 / 60 / 60 = 165 rows, and the two controls 60 + 60', () => {
    const counts = protocol.rows.map((p) => rows.filter((r) => isKept(r, protocol) && r.hardware === p.hardware && r.precision === p.precision).length)
    expect(protocol.rows.map((p) => p.key)).toEqual(['h100-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-nvfp4'])
    expect(counts).toEqual([45, 60, 60])
    expect(counts.reduce((a, b) => a + b, 0)).toBe(165)
    const controls = protocol.controls.map((c) => rows.filter((r) => r.hardware === c.hardware && r.precision === c.precision).length)
    expect(protocol.controls.map((c) => `${c.hardware} ${c.precision}`)).toEqual(['mi325x fp8', 'mi355x fp8'])
    expect(controls).toEqual([60, 60])
    // nothing else is in the file, and every row meets the protocol's selection fields
    expect(rows.every((r) => isKept(r, protocol))).toBe(true)
    expect(keptPopulations(protocol)).toHaveLength(5)
    for (const r of rows) {
      expect([r.framework, r.spec_method, r.disagg, r.is_multinode]).toEqual([protocol.select.framework, protocol.select.spec_method, protocol.select.disagg, protocol.select.is_multinode])
    }
  })

  test('the values the spec cites are the response\'s raw members', () => {
    const cited: [string, Partial<PointRow>][] = [
      ['41187', { hardware: 'h100', precision: 'fp8', decode_tp: 4, conc: 4, isl: 1024, osl: 1024, mean_tpot: 0.011776147370379336, run_url: `${RUN('18924448230')}/attempts/2` }],
      ['40518', { hardware: 'b200', precision: 'fp8', decode_tp: 1, conc: 4, isl: 8192, osl: 1024, mean_tpot: 0.018341295891140703, median_ttft: 0.654017546446994, run_url: `${RUN('18924487526')}/attempts/3` }],
      ['42017', { hardware: 'h100', precision: 'fp8', decode_tp: 2, conc: 4, isl: 1024, osl: 1024, mean_tpot: 0.017407217876067922 }],
      ['41625', { hardware: 'h100', precision: 'fp8', decode_tp: 8, conc: 4, isl: 1024, osl: 1024, mean_tpot: 0.00911388713190063 }],
      ['40624', { hardware: 'b200', precision: 'fp8', decode_tp: 1, conc: 4, isl: 1024, osl: 1024, mean_tpot: 0.016336672415144134 }],
      ['40085', { hardware: 'b200', precision: 'fp4', decode_tp: 1, conc: 4, isl: 1024, osl: 1024, mean_tpot: 0.013071160093486068 }],
    ]
    for (const [id, want] of cited) {
      const row = byId.get(id)
      expect(row).toBeDefined()
      expect(row).toMatchObject(want)
    }
    // the spec's rounded figures
    expect(byId.get('41187')!.mean_tpot * 1000).toBeCloseTo(11.776, 3)
    expect(byId.get('40518')!.median_ttft * 1000).toBeCloseTo(654.02, 2)
    expect(byId.get('42017')!.mean_tpot * 1000).toBeCloseTo(17.41, 2)
    expect(byId.get('41625')!.mean_tpot * 1000).toBeCloseTo(9.11, 2)
    expect(byId.get('40624')!.mean_tpot * 1000).toBeCloseTo(16.34, 2)
    expect(byId.get('40085')!.mean_tpot * 1000).toBeCloseTo(13.07, 2)
  })

  test('the rows cite the three runs of §4.6, one per sequence shape', () => {
    const runs = new Map<string, Set<string>>()
    for (const r of rows) runs.set(r.run_url, (runs.get(r.run_url) ?? new Set()).add(`${r.isl}/${r.osl}`))
    expect(Object.fromEntries([...runs].map(([url, shapes]) => [url, [...shapes]]))).toEqual({
      [`${RUN('18924448230')}/attempts/2`]: ['1024/1024'],
      [`${RUN('18924487526')}/attempts/3`]: ['8192/1024'],
      [`${RUN('18924543242')}/attempts/2`]: ['1024/8192'],
    })
  })
})

/** Source files under a directory, with the extensions a bundler would read. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name)
    if (statSync(file).isDirectory()) return sourceFiles(file)
    return /\.(tsx?|jsx?|mjs|cjs|css|html)$/.test(name) ? [file] : []
  })
}

/** The module specifiers a file loads: `from '…'`, `import '…'`, `import('…')`, `require('…')`, `new URL('…')`, `import.meta.glob('…')`. */
function loadedSpecifiers(source: string): string[] {
  const re = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bnew URL\s*\(\s*|\bglob\s*\(\s*\[?\s*)(['"`])([^'"`\n]+)\1/g
  return [...source.matchAll(re)].map((m) => m[2])
}

describe('the extract is tooling data', () => {
  const touches = (spec: string) => /physics\/points|inferencex-l70|nim-llm-1\.8\.0/.test(spec)

  test('no file under src/ imports the extract, the NIM panel or the directory', () => {
    const files = sourceFiles(resolve(ROOT, 'src'))
    expect(files.length).toBeGreaterThan(100)
    const offenders = files.filter((f) => loadedSpecifiers(readFileSync(f, 'utf8')).some(touches)).map((f) => f.slice(ROOT.length + 1))
    expect(offenders).toEqual([])
  })

  test('the walker would find an import of it (so an empty result means something)', () => {
    const samples = [
      "import rows from '../../data/physics/points/inferencex-l70-2025-10-29.json'",
      "const rows = await import('@/data/physics/points/inferencex-l70-2025-10-29.json')",
      "const f = new URL('../physics/points/nim-llm-1.8.0.json', import.meta.url)",
      "const all = import.meta.glob('/src/data/physics/points/*.json')",
      "import x from './nim-llm-1.8.0.json'",
    ]
    for (const s of samples) expect(loadedSpecifiers(s).some(touches)).toBe(true)
    // a comment that names the file (as a generated claims header does) is no import
    expect(loadedSpecifiers("/** from src/data/physics/points/inferencex-l70-2025-10-29.json (sha256 …) */ import type { Claim } from '../schema'").some(touches)).toBe(false)
  })
})

describe('the NIM panel', () => {
  const nim = readNim()

  test('holds the 478 parsed rows with its source URL and the sha256 of the page they were parsed from', () => {
    expect(nim.rows).toHaveLength(NIM_ROWS)
    expect(NIM_ROWS).toBe(478)
    expect(nim.source).toBe('https://docs.nvidia.com/nim/benchmarking/llm/1.0.0/performance.html')
    expect(nim.source).toBe(NIM_SOURCE)
    expect(nim.parsedFrom).toBe(NIM_MARKDOWN)
    expect(nim.sha256).toBe(NIM_SHA256)
    expect(nim.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(nim.bytes).toBe(NIM_BYTES)
    expect(nim.fetched).toBe('2026-10-18')
    expect(serializeNim(nim.rows, nim.sha256, nim.bytes)).toBe(readFileSync(NIM_PATH, 'utf8'))
  })

  test('has the rows the spec\'s validation panel uses (§4.4): 70B FP8 TP 2 and TP 4 on H100, 8B FP8 TP 1 on H100', () => {
    const n = (f: (r: (typeof nim.rows)[number]) => boolean) => nim.rows.filter(f).length
    const h100 = (r: (typeof nim.rows)[number]) => r.gpu === 'H100' && r.prec === 'fp8'
    expect(n((r) => h100(r) && r.model === 'Llama-3.3-70b-instruct' && r.tp === 2)).toBe(39)
    expect(n((r) => h100(r) && r.model === 'Llama-3.3-70b-instruct' && r.tp === 4 && r.ver === '1.8.0')).toBe(40)
    expect(n((r) => h100(r) && r.model === 'Llama-3.1-8b-instruct' && r.tp === 1 && r.ver === '1.8.0')).toBe(40)
    expect(nim.rows.every((r) => r.conc >= 1 && r.ttft > 0 && r.itl > 0 && r.tput > 0)).toBe(true)
  })

  test('parseNim reads a table under its headings and refuses one without them', () => {
    const page = [
      '## Llama-3.3-70b-instruct Results',
      '### Version: 1.8.0',
      '#### 2 x H100 80G',
      '#### fp8 TP2',
      '#### 5000 Input Tokens / 500 Output Tokens',
      '| Concurrency | TTFT (ms)  | ITL (ms) | Throughput(Tokens/s) |',
      '| ----------- | ---------- | -------- | -------------------- |',
      '| 1           | 406.77     | 18.58    | 51.67                |',
      '| 250         | 88605.32   | 93.2     | 920.12               |',
      '',
      '#### 200 Input Tokens / 200 Output Tokens',
      '| Concurrency | TTFT (ms) | ITL (ms) | Throughput(Tokens/s) |',
      '| ----------- | --------- | -------- | -------------------- |',
      '| 5           | 88.7      | 18.83    | 260.67               |',
    ].join('\n')
    const head = { model: 'Llama-3.3-70b-instruct', ver: '1.8.0', gpus: 2, gpu: 'H100', prec: 'fp8', tp: 2 }
    expect(parseNim(page)).toEqual([
      { ...head, isl: 5000, osl: 500, conc: 1, ttft: 406.77, itl: 18.58, tput: 51.67 },
      { ...head, isl: 5000, osl: 500, conc: 250, ttft: 88605.32, itl: 93.2, tput: 920.12 },
      { ...head, isl: 200, osl: 200, conc: 5, ttft: 88.7, itl: 18.83, tput: 260.67 },
    ])
    expect(() => parseNim(page.split('\n').filter((l) => !l.startsWith('#### fp8')).join('\n'))).toThrow('incomplete set of headings')
    expect(() => parseNim(page.replace('406.77', 'n/a'))).toThrow('not four numbers')
  })
})

describe('the raw text of a response', () => {
  const response = (list: object[]) => JSON.stringify(list)
  const row = (id: string, conc: number, tpot: number, extra: object = {}) => ({
    id,
    hardware: 'h100',
    framework: 'vllm',
    model: 'a } tricky { "model" name',
    precision: 'fp8',
    spec_method: 'none',
    disagg: false,
    is_multinode: false,
    decode_tp: 2,
    isl: 1024,
    osl: 1024,
    conc,
    image: null,
    metrics: { mean_tpot: tpot, median_ttft: 0.25, p99_tpot: 0.5 },
    run_url: `${RUN('1')}/attempts/2`,
    ...extra,
  })

  test('rawRows splits the top-level objects, braces inside strings included, and rejects a duplicate id', () => {
    const text = response([row('10', 4, 0.01), row('11', 40, 0.02)])
    const raw = rawRows(text)
    expect([...raw.keys()]).toEqual(['10', '11'])
    expect(JSON.parse(raw.get('11')!).conc).toBe(40)
    expect(() => rawRows(response([row('10', 4, 0.01), row('10', 8, 0.02)]))).toThrow('duplicate id 10')
  })

  test('memberCount counts whole members only: "conc":4 is not inside "conc":40', () => {
    const text = rawRows(response([row('10', 40, 0.01)])).get('10')!
    expect(memberCount(text, 'conc', 40)).toBe(1)
    expect(memberCount(text, 'conc', 4)).toBe(0)
    expect(memberCount(text, 'mean_tpot', 0.01)).toBe(1)
    expect(memberCount(text, 'tpot', 0.01)).toBe(0)
    expect(memberCount(text, 'decode_tp', 2)).toBe(1)
  })

  test('buildExtract keeps the protocol\'s populations, lifts the metrics, sorts by numeric id and drops everything else', () => {
    const text = response([
      row('9', 4, 0.03),
      row('100', 4, 0.01),
      row('20', 4, 0.02, { hardware: 'mi325x' }),
      row('21', 4, 0.02, { hardware: 'mi355x', precision: 'fp4' }),
      row('22', 4, 0.02, { framework: 'trt' }),
      row('23', 4, 0.02, { disagg: true }),
      row('24', 4, 0.02, { hardware: 'h200' }),
    ])
    const out = buildExtract(text, protocol)
    expect(out.map((r) => r.id)).toEqual(['9', '20', '100'])
    expect(out[0]).toEqual({
      id: '9', hardware: 'h100', framework: 'vllm', precision: 'fp8', spec_method: 'none', disagg: false, is_multinode: false,
      decode_tp: 2, conc: 4, isl: 1024, osl: 1024, mean_tpot: 0.03, median_ttft: 0.25, run_url: `${RUN('1')}/attempts/2`,
    })
    expect(serializeExtract(out).split('\n')[1]).toBe(`{"id":"9","hardware":"h100","framework":"vllm","precision":"fp8","spec_method":"none","disagg":false,"is_multinode":false,"decode_tp":2,"conc":4,"isl":1024,"osl":1024,"mean_tpot":0.03,"median_ttft":0.25,"run_url":"${RUN('1')}/attempts/2"},`)
    expect(checkMembers(out, text)).toEqual({ rows: 3, members: 3 * POINT_KEYS.length, problems: [] })
  })

  test('checkMembers finds a changed value, a missing row and a value that only differs in how it is written', () => {
    const text = response([row('10', 4, 0.01), row('11', 8, 0.02)])
    const out = buildExtract(text, protocol)
    expect(checkMembers(out, text).problems).toEqual([])
    const changed = checkMembers(out, text.replace('"mean_tpot":0.02', '"mean_tpot":0.021'))
    expect(changed.problems).toEqual([expect.stringContaining('row 11: "mean_tpot":0.02 occurs 0 times')])
    expect(checkMembers(out, response([row('10', 4, 0.01)])).problems).toEqual(['row 11: not in the response'])
    // 1e-7 is how JavaScript writes 0.0000001; a response that writes it out does not match byte for byte
    const small = response([row('12', 4, 0.5, { metrics: { mean_tpot: 1e-7, median_ttft: 0.25 } })]).replace('1e-7', '0.0000001')
    expect(checkMembers([toPointRow(JSON.parse(small)[0])], small).problems).toHaveLength(1)
  })

  test('toPointRow names the row and the member when the response is not shaped as expected', () => {
    expect(() => toPointRow(row('10', 4, 0.01, { conc: '4' }))).toThrow('row 10: conc is not an integer')
    expect(() => toPointRow(row('10', 4, 0.01, { disagg: 0 }))).toThrow('row 10: disagg is not a boolean')
    expect(() => toPointRow(row('10', 4, 0.01, { metrics: { median_ttft: 0.1 } }))).toThrow('row 10: metrics.mean_tpot is not a finite number')
    expect(() => toPointRow({ ...row('10', 4, 0.01), id: 10 })).toThrow('the id is not a string of digits')
  })

  test('snapshotProblems checks the size and the sha256 against the protocol', () => {
    const bytes = new TextEncoder().encode('not the response')
    const problems = snapshotProblems(bytes, protocol)
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain(`pins ${protocol.snapshot.rawBytes}`)
    expect(problems[1]).toContain(protocol.snapshot.rawSha256)
  })
})

describe('--from and the command line', () => {
  const script = resolve(ROOT, 'scripts/fetch-physics-points.ts')
  const run = (...args: string[]) => Bun.spawnSync([process.execPath, script, ...args], { cwd: ROOT })

  test('--from refuses a file that is not the pinned response, and writes nothing', () => {
    const before = readFileSync(EXTRACT_PATH, 'utf8')
    const dir = mkdtempSync(join(tmpdir(), 'points-'))
    const file = join(dir, 'response.json')
    writeFileSync(file, '[]')
    const result = run('--from', file)
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('is not the pinned response')
    expect(result.stderr.toString()).toContain(protocol.snapshot.rawSha256)
    expect(readFileSync(EXTRACT_PATH, 'utf8')).toBe(before)
  })

  test('a flag without its file, and no flag, are usage errors', () => {
    expect(run('--from').exitCode).toBe(1)
    expect(run('--nim').exitCode).toBe(1)
    const none = run()
    expect(none.exitCode).toBe(1)
    expect(none.stderr.toString()).toContain('usage:')
  })
})

describe('--claims', () => {
  // Injected values, in bytes, as the registry's claims read (S5-03 registers the model byte claims).
  const injected: Record<string, number> = {
    'hw.h100-sxm.hbm-capacity': 80e9,
    'hw.b200.hbm-capacity': 180e9,
    'model.llama3-70b.weight-bytes-fp8': 70.55e9,
    'model.llama3-70b.weight-bytes-nvfp4': 39.684375e9,
    'model.llama3-70b.kv-bytes-per-token-fp8': 163_840,
  }
  const asked: string[] = []
  const resolver: ClaimResolver = (id) => {
    asked.push(id)
    if (!(id in injected)) throw new Error(`unexpected claim ${id}`)
    return injected[id]
  }
  const point = (over: Partial<PointRow>): PointRow => ({
    id: '1', hardware: 'h100', framework: 'vllm', precision: 'fp8', spec_method: 'none', disagg: false, is_multinode: false,
    decode_tp: 2, conc: 4, isl: 1024, osl: 1024, mean_tpot: 0.017407217876067922, median_ttft: 0.10812224494293332,
    run_url: `${RUN('18924448230')}/attempts/2`, ...over,
  })
  // the two-row fixture: an H100 FP8 point (id 42017's values) and example B (id 40518's)
  const fixture: PointRow[] = [
    point({ id: '40518', hardware: 'b200', decode_tp: 1, isl: 8192, osl: 1024, mean_tpot: 0.018341295891140703, median_ttft: 0.654017546446994, run_url: `${RUN('18924487526')}/attempts/3` }),
    point({ id: '42017' }),
  ]

  test('writes one TPOT claim per point, quoting the raw member, and example B\'s median TTFT', () => {
    const text = generateClaims(fixture, protocol, resolver, 'f'.repeat(64))
    expect(text).toContain("id: 'bench.ix-l70.h100-vllm-0-10-2-fp8.tp2.1024-1024.c4.tpot',")
    expect(text).toContain("id: 'bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.8192-1024.c4.tpot',")
    expect(text).toContain("id: 'bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.8192-1024.c4.ttft-median',")
    expect(text).toContain('value: 0.017407217876067922,')
    expect(text).toContain(`quote: '"mean_tpot":0.017407217876067922', row: 'id 42017'`)
    expect(text).toContain(`quote: '"median_ttft":0.654017546446994', row: 'id 40518'`)
    expect(text).toContain(`sha256 ${'f'.repeat(64)}`)
    expect(text.match(/kind: 'benchmark'/g)).toHaveLength(3)
    // the resolver is asked for the protocol's claim ids only: HBM and weights of each row, and the KV bytes
    expect(new Set(asked)).toEqual(new Set(Object.keys(injected).filter((id) => !id.includes('nvfp4'))))
    // a second run makes no diff
    expect(generateClaims(fixture, protocol, resolver, 'f'.repeat(64))).toBe(text)
  })

  test('the generated module registers claims whose quote is the member as written, with row and boundary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ix-points-'))
    mkdirSync(join(dir, 'lazy'))
    writeFileSync(join(dir, 'registry.ts'), 'export const registered: unknown[] = []\nexport function registerClaims(list: unknown[]) { registered.push(...list) }\n')
    writeFileSync(join(dir, 'lazy/ix-points.ts'), generateClaims(fixture, protocol, resolver, 'a'.repeat(64)))
    const mod = (await import(join(dir, 'lazy/ix-points.ts'))) as { IX_POINT_CLAIMS: Claim[] }
    const reg = (await import(join(dir, 'registry.ts'))) as { registered: unknown[] }
    expect(reg.registered).toEqual(mod.IX_POINT_CLAIMS)
    expect(mod.IX_POINT_CLAIMS).toHaveLength(3)
    for (const claim of mod.IX_POINT_CLAIMS) {
      const member = claim.id.endsWith('.tpot') ? 'mean_tpot' : 'median_ttft'
      const raw = fixture.find((r) => `id ${r.id}` === claim.source!.row)!
      expect(claim.kind).toBe('benchmark')
      expect(claim.unit).toBe('s')
      expect(claim.value).toBe(raw[member])
      expect(claim.source!.quote).toBe(`"${member}":${JSON.stringify(claim.value)}`)
      expect(claim.source!.url).toBe(protocol.snapshot.url)
      expect(claim.verifiedAt).toBe('2026-10-18')
      expect(claim.ttlDays).toBe(180)
      expect(claim.boundary).toContain(`InferenceX row ${raw.id}`)
      expect(claim.boundary).toContain(raw.run_url.split('/runs/')[1].split('/')[0])
    }
  })

  test('leaves out a control row, a TP outside the box, a concurrency outside F, a KV-dropped point and a preempted one', () => {
    const fits = (r: PointRow) => claimPoints([r], protocol, resolver).length === 1
    expect(fits(point({ id: '2' }))).toBe(true)
    expect(fits(point({ id: '3', hardware: 'mi325x' }))).toBe(false)
    expect(fits(point({ id: '4', hardware: 'b200', precision: 'fp4', decode_tp: 8 }))).toBe(false)
    expect(fits(point({ id: '5', hardware: 'b200', precision: 'fp4', decode_tp: 4 }))).toBe(true)
    expect(fits(point({ id: '6', conc: 8 }))).toBe(false)
    expect(fits(point({ id: '7', conc: 64, isl: 8192, osl: 1024 }))).toBe(false)
    expect(fits(point({ id: '8', median_ttft: 4.19 }))).toBe(false)
    // §4.1's worked limits: H100 TP 2 holds 448,303 tokens, B200 TP 1 holds 558,166, NVFP4 TP 1 holds 746,555
    expect(kvTokenLimit(protocol, protocol.rows[0], 2, resolver)).toBe(448_303)
    expect(kvTokenLimit(protocol, protocol.rows[1], 1, resolver)).toBe(558_166)
    expect(kvTokenLimit(protocol, protocol.rows[2], 1, resolver)).toBe(746_555)
  })

  test('claim ids follow §4.5, and a claim in an unknown unit is no byte count', () => {
    const p = { prow: protocol.rows[1], row: point({ id: '40518', hardware: 'b200', decode_tp: 1, isl: 8192, osl: 1024 }) }
    expect(tpotClaimId(p)).toBe('bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.8192-1024.c4.tpot')
    expect(ttftClaimId(p)).toBe('bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.8192-1024.c4.ttft-median')
    expect(toBytes(80, 'GB')).toBe(80e9)
    expect(toBytes(163_840, 'B')).toBe(163_840)
    expect(() => toBytes(80, 'TB/s')).toThrow('cannot read a claim in unit TB/s')
    expect(() => toBytes(80, undefined)).toThrow('cannot read a claim in unit undefined')
  })
})

describe('attribution and the licence', () => {
  const attribution = readFileSync(resolve(POINTS_DIR, 'ATTRIBUTION.md'), 'utf8')

  test('LICENSE-InferenceX.txt is the repo\'s LICENSE at the harness commit, byte for byte (the git blob and its size)', () => {
    const bytes = readFileSync(resolve(POINTS_DIR, 'LICENSE-InferenceX.txt'))
    expect(bytes.length).toBe(11_389)
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
    expect(blob).toBe('34b03e8cf3d38011cc0b0f28d88d70b06b2b7a67')
    expect(bytes.toString('utf8')).toContain('Apache License')
    expect(bytes.toString('utf8')).toContain('Version 2.0, January 2004')
    expect(attribution).toContain(blob)
    expect(attribution).toContain(protocol.snapshot.harness.ref)
    // the repo has no NOTICE at that commit, so none is kept beside it
    expect(readdirSync(POINTS_DIR).filter((f) => /notice/i.test(f))).toEqual([])
  })

  test('ATTRIBUTION.md carries S5-D30\'s text and names the grant each kind of material relies on', () => {
    for (const needle of [
      'InferenceX by SemiAnalysis, https://inferencex.semianalysis.com',
      protocol.snapshot.url,
      protocol.snapshot.rawSha256,
      `${RUN('18924448230')}/attempts/2`,
      `${RUN('18924543242')}/attempts/2`,
      `${RUN('18924487526')}/attempts/3`,
      'github.com/SemiAnalysisAI/InferenceX',
      'Apache-2.0',
      'InferenceX™ is a trademark of SemiAnalysis.',
      'official InferenceX results as published on 2025-10-29, copied unmodified for the selected fields',
      "The course's fitted model, its parameters and its predictions are this course's own work. They are not InferenceX results",
      'https://inferencex.semianalysis.com/about',
      'Yes. All data is freely available.',
      'Yes. Code, data, and dashboard are all open-source.',
      '**The data**',
      '**Material from the repository**',
      'the project owner confirms it against the InferenceX terms before this snapshot merges',
      '2026-10-18',
      NIM_SHA256,
    ]) {
      expect(attribution).toContain(needle)
    }
  })
})
