/**
 * fetch-physics-points: the S5 points snapshot (docs/specs/s5.md §4.1, §4.4, §4.6; S5-04, S5-D30, S5-D37).
 *
 * The pinned InferenceX response (the query in docs/physics/protocol.md, 681 rows, 1,026,817 bytes) is too large and
 * carries too much to commit. This script reduces it to the extract the fit reads, and checks that reduction against
 * the live source. The extract is tooling data: no runtime module under `src/` imports it (tests/physics/points.test.ts).
 *
 *   bun scripts/fetch-physics-points.ts --from <saved response>   check the response's size, sha256 and row count against
 *                                                                the protocol, then write the extract (285 rows)
 *   bun scripts/fetch-physics-points.ts --nim <saved page.md>     check the NIM page's sha256, parse its tables, write the
 *                                                                478-row validation panel
 *   bun scripts/fetch-physics-points.ts --online                 re-fetch the pinned query and compare every kept member's raw
 *                                                                text (`"name":value`) with the response, row by row; print
 *                                                                whether the whole response's sha256 still matches (a changed
 *                                                                sha256 with every member equal is reported, not a failure);
 *                                                                re-fetch the NIM page and report its sha256 the same way
 *   bun scripts/fetch-physics-points.ts --claims                 write src/data/claims/lazy/ix-points.ts (S5-03 runs this for
 *                                                                real, once it has registered the model byte claims)
 *
 * Every constant of the selection, the filters and the split is read from the protocol through `readProtocol()` (S5-D46).
 * The pure functions below are exported for tests/physics/points.test.ts; the CLI runs only under `import.meta.main`.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readProtocol, type Protocol, type ProtocolRow } from './physics-protocol'

const path = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
export const EXTRACT_PATH = path('../src/data/physics/points/inferencex-l70-2025-10-29.json')
export const NIM_PATH = path('../src/data/physics/points/nim-llm-1.8.0.json')
export const CLAIMS_PATH = path('../src/data/claims/lazy/ix-points.ts')

/** The date this snapshot was fetched and checked (S5-D30); the claims' `verifiedAt`. */
export const FETCHED = '2026-10-18'

/* ------------------------------ the extract ------------------------------ */

/** One kept row: §4.6's fields, in this order, `mean_tpot` and `median_ttft` lifted from `metrics`. */
export interface PointRow {
  readonly id: string
  readonly hardware: string
  readonly framework: string
  readonly precision: string
  readonly spec_method: string
  readonly disagg: boolean
  readonly is_multinode: boolean
  readonly decode_tp: number
  readonly conc: number
  readonly isl: number
  readonly osl: number
  readonly mean_tpot: number
  readonly median_ttft: number
  readonly run_url: string
}

export const POINT_KEYS = [
  'id', 'hardware', 'framework', 'precision', 'spec_method', 'disagg', 'is_multinode',
  'decode_tp', 'conc', 'isl', 'osl', 'mean_tpot', 'median_ttft', 'run_url',
] as const satisfies readonly (keyof PointRow)[]

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A raw response row reduced to a `PointRow`. Throws, naming the row and the member, when a member is missing or of another type. */
export function toPointRow(raw: unknown): PointRow {
  if (!isRecord(raw) || !isRecord(raw.metrics)) throw new Error('a response row is not an object with metrics')
  const id = String(raw.id)
  const str = (v: unknown, name: string) => {
    if (typeof v !== 'string') throw new Error(`row ${id}: ${name} is not a string`)
    return v
  }
  const bool = (v: unknown, name: string) => {
    if (typeof v !== 'boolean') throw new Error(`row ${id}: ${name} is not a boolean`)
    return v
  }
  const int = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`row ${id}: ${name} is not an integer`)
    return v
  }
  const num = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`row ${id}: ${name} is not a finite number`)
    return v
  }
  if (!/^\d+$/.test(id) || typeof raw.id !== 'string') throw new Error(`row ${id}: the id is not a string of digits`)
  return {
    id,
    hardware: str(raw.hardware, 'hardware'),
    framework: str(raw.framework, 'framework'),
    precision: str(raw.precision, 'precision'),
    spec_method: str(raw.spec_method, 'spec_method'),
    disagg: bool(raw.disagg, 'disagg'),
    is_multinode: bool(raw.is_multinode, 'is_multinode'),
    decode_tp: int(raw.decode_tp, 'decode_tp'),
    conc: int(raw.conc, 'conc'),
    isl: int(raw.isl, 'isl'),
    osl: int(raw.osl, 'osl'),
    mean_tpot: num(raw.metrics.mean_tpot, 'metrics.mean_tpot'),
    median_ttft: num(raw.metrics.median_ttft, 'metrics.median_ttft'),
    run_url: str(raw.run_url, 'run_url'),
  }
}

/** Hardware and precision pairs the extract keeps: the protocol's three rows and its two controls (§4.1, §4.4). */
export function keptPopulations(protocol: Protocol): { hardware: string; precision: string }[] {
  return [...protocol.rows, ...protocol.controls].map((r) => ({ hardware: r.hardware, precision: r.precision }))
}

/** Whether a reduced row is kept: the protocol's selection fields, and one of the kept populations. */
export function isKept(row: PointRow, protocol: Protocol): boolean {
  const s = protocol.select
  return (
    row.framework === s.framework &&
    row.spec_method === s.spec_method &&
    row.disagg === s.disagg &&
    row.is_multinode === s.is_multinode &&
    keptPopulations(protocol).some((p) => p.hardware === row.hardware && p.precision === row.precision)
  )
}

/** The kept rows of a response, sorted by numeric id. Throws on a duplicate id. */
export function buildExtract(response: string, protocol: Protocol): PointRow[] {
  const parsed: unknown = JSON.parse(response)
  if (!Array.isArray(parsed)) throw new Error('the response is not a JSON array')
  const kept = parsed.map(toPointRow).filter((row) => isKept(row, protocol))
  kept.sort((a, b) => Number(a.id) - Number(b.id))
  for (let i = 1; i < kept.length; i++) if (kept[i].id === kept[i - 1].id) throw new Error(`duplicate id ${kept[i].id}`)
  return kept
}

/** The extract's file text: a JSON array, one row per line, each value written by `JSON.stringify` of the parsed value (§4.6). */
export function serializeExtract(rows: readonly PointRow[]): string {
  const line = (row: PointRow) => JSON.stringify(Object.fromEntries(POINT_KEYS.map((k) => [k, row[k]])))
  return `[\n${rows.map(line).join(',\n')}\n]\n`
}

/** The committed extract, validated (types and key order). */
export function readExtract(file: string = EXTRACT_PATH): PointRow[] {
  const text = readFileSync(file, 'utf8')
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error(`${file}: not a JSON array`)
  parsed.forEach((raw: unknown) => {
    if (!isRecord(raw) || Object.keys(raw).join() !== POINT_KEYS.join()) throw new Error(`${file}: a row does not have exactly the keys ${POINT_KEYS.join(', ')} in order`)
  })
  return parsed as PointRow[]
}

export const sha256Hex = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

/** Why a response is not the pinned one, as sentences; empty when its size, sha256 and row count match the protocol's snapshot. */
export function snapshotProblems(bytes: Uint8Array, protocol: Protocol): string[] {
  const s = protocol.snapshot
  const out: string[] = []
  if (bytes.length !== s.rawBytes) out.push(`the response is ${bytes.length} bytes, the protocol pins ${s.rawBytes}`)
  const sha = sha256Hex(bytes)
  if (sha !== s.rawSha256) out.push(`the response's sha256 is ${sha}, the protocol pins ${s.rawSha256}`)
  return out
}

/* ------------------------------ the raw text ------------------------------ */

/** Each response row's raw text, by id: a scan of the top-level array's objects (string-aware, so braces inside strings are safe). */
export function rawRows(response: string): Map<string, string> {
  const out = new Map<string, string>()
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < response.length; i++) {
    const c = response[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
    } else if (c === '{') {
      if (depth === 0) start = i
      depth++
    } else if (c === '}') {
      depth--
      if (depth === 0) {
        const text = response.slice(start, i + 1)
        const id = /^\{"id":"(\d+)"/.exec(text)?.[1]
        if (!id) throw new Error(`a response row does not open with "id":"<digits>": ${text.slice(0, 40)}`)
        if (out.has(id)) throw new Error(`duplicate id ${id} in the response`)
        out.set(id, text)
      }
    }
  }
  return out
}

/** How many times `"name":value` (value as `JSON.stringify` writes it) occurs in a row's raw text as a whole member, followed by `,` or `}`. */
export function memberCount(rowText: string, name: string, value: unknown): number {
  const needle = `"${name}":${JSON.stringify(value)}`
  let count = 0
  for (let at = rowText.indexOf(needle); at >= 0; at = rowText.indexOf(needle, at + 1)) {
    const next = rowText[at + needle.length]
    if (next === ',' || next === '}') count++
  }
  return count
}

export interface MemberCheck {
  readonly rows: number
  readonly members: number
  readonly problems: string[]
}

/** Compares every kept member of every extract row with the response's raw text for that row, byte for byte. */
export function checkMembers(rows: readonly PointRow[], response: string): MemberCheck {
  const raw = rawRows(response)
  const problems: string[] = []
  let members = 0
  for (const row of rows) {
    const text = raw.get(row.id)
    if (text === undefined) {
      problems.push(`row ${row.id}: not in the response`)
      continue
    }
    for (const key of POINT_KEYS) {
      members++
      const n = memberCount(text, key, row[key])
      if (n !== 1) problems.push(`row ${row.id}: "${key}":${JSON.stringify(row[key])} occurs ${n} times in the response (expected once)`)
    }
  }
  return { rows: rows.length, members, problems }
}

/* ------------------------------ the NIM panel ------------------------------ */

export const NIM_SOURCE = 'https://docs.nvidia.com/nim/benchmarking/llm/1.0.0/performance.html'
/** The page's clean Markdown (append .md to the page URL), the bytes the sha256 below covers. */
export const NIM_MARKDOWN = 'https://docs.nvidia.com/nim/benchmarking/llm/1.0.0/performance.md'
export const NIM_SHA256 = '4fe76cd9ae97afb0848970dbe4da44f61695c3b653bceb210742ad52635afc6e'
export const NIM_BYTES = 47226
export const NIM_ROWS = 478

/** One parsed row of a NIM table (units as the page prints them: TTFT and ITL in ms, throughput in tokens/s). */
export interface NimRow {
  readonly model: string
  readonly ver: string
  readonly gpus: number
  readonly gpu: string
  readonly prec: string
  readonly tp: number
  readonly isl: number
  readonly osl: number
  readonly conc: number
  readonly ttft: number
  readonly itl: number
  readonly tput: number
}

/** The results tables' header cells; the page pads them to the width of the widest value in the table, so lines compare by cell. */
const NIM_HEADER = 'Concurrency|TTFT (ms)|ITL (ms)|Throughput(Tokens/s)'
const headerOf = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim()).join('|')

/**
 * Every row of the page's results tables. A table is identified by the headings above it: the model (`## <name> Results`), the
 * release (`### Version: x`), the GPUs (`#### N x <gpu> <memory>`), the precision and TP (`#### fp8 TP2`) and the lengths.
 * Throws when a table sits under an incomplete set of headings or a cell is not a finite number.
 */
export function parseNim(markdown: string): NimRow[] {
  const out: NimRow[] = []
  let model: string | undefined
  let ver: string | undefined
  let gpus: { n: number; gpu: string } | undefined
  let cfg: { prec: string; tp: number } | undefined
  let lens: { isl: number; osl: number } | undefined
  let inTable = false
  for (const line of markdown.split('\n')) {
    let m: RegExpExecArray | null
    if ((m = /^## (.+) Results$/.exec(line))) {
      model = m[1]
      ver = gpus = cfg = lens = undefined
    } else if ((m = /^### Version: (\S+)$/.exec(line))) {
      ver = m[1]
      gpus = cfg = lens = undefined
    } else if ((m = /^#### (\d+) x (\S+) \d+GB?$/.exec(line))) {
      gpus = { n: Number(m[1]), gpu: m[2] }
      cfg = lens = undefined
    } else if ((m = /^#### ([a-z0-9]+) TP(\d+)$/.exec(line))) {
      cfg = { prec: m[1], tp: Number(m[2]) }
      lens = undefined
    } else if ((m = /^#### (\d+) Input Tokens \/ (\d+) Output Tokens$/.exec(line))) {
      lens = { isl: Number(m[1]), osl: Number(m[2]) }
    } else if (line.startsWith('|') && headerOf(line) === NIM_HEADER) {
      inTable = true
      if (!model || !ver || !gpus || !cfg || !lens) throw new Error('a NIM table sits under an incomplete set of headings')
    } else if (inTable && line.startsWith('|')) {
      if (/^\|[\s|-]+$/.test(line)) continue
      const cells = line.split('|').slice(1, -1).map((c) => Number(c.trim()))
      if (cells.length !== 4 || cells.some((c) => !Number.isFinite(c))) throw new Error(`a NIM table row is not four numbers: ${line}`)
      if (!model || !ver || !gpus || !cfg || !lens) throw new Error('a NIM table row has no headings')
      const [conc, ttft, itl, tput] = cells
      out.push({ model, ver, gpus: gpus.n, gpu: gpus.gpu, prec: cfg.prec, tp: cfg.tp, ...lens, conc, ttft, itl, tput })
    } else {
      inTable = false
    }
  }
  return out
}

/** The NIM file: the source, the checked page's sha256 and size, and one parsed row per line. */
export function serializeNim(rows: readonly NimRow[], sha256: string, bytes: number): string {
  const head = [
    `"source": ${JSON.stringify(NIM_SOURCE)}`,
    `"parsedFrom": ${JSON.stringify(NIM_MARKDOWN)}`,
    `"sha256": ${JSON.stringify(sha256)}`,
    `"bytes": ${bytes}`,
    `"fetched": ${JSON.stringify(FETCHED)}`,
    '"units": "ttft and itl in ms, tput in tokens/s, as the page prints them"',
  ]
  return `{\n${head.join(',\n')},\n"rows": [\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]\n}\n`
}

export interface NimFile {
  readonly source: string
  readonly parsedFrom: string
  readonly sha256: string
  readonly bytes: number
  readonly fetched: string
  readonly units: string
  readonly rows: readonly NimRow[]
}

export function readNim(file: string = NIM_PATH): NimFile {
  return JSON.parse(readFileSync(file, 'utf8')) as NimFile
}

/* ------------------------------ the point claims ------------------------------ */

/** The value of a claim in bytes (HBM capacity in B, the model byte claims in B), as the CLI's resolver reads it from the registry. */
export type ClaimResolver = (claimId: string) => number

/** What `--claims` reads from a claim, in bytes: GB and GiB capacities, and the byte claims as they are. Throws on any other unit. */
export function toBytes(value: number, unit: string | undefined): number {
  const factor: Record<string, number> = { B: 1, bytes: 1, 'B/token': 1, 'bytes/token': 1, GB: 1e9, GiB: 2 ** 30 }
  if (unit === undefined || !(unit in factor)) throw new Error(`cannot read a claim in unit ${String(unit)} as bytes`)
  return value * factor[unit]
}

/** The KV rule of the protocol: the most tokens (conc × (isl + osl)) a row's replica holds in its cache. */
export function kvTokenLimit(protocol: Protocol, prow: ProtocolRow, tp: number, resolve: ClaimResolver): number {
  const hbm = resolve(prow.hbm)
  const weights = resolve(prow.weightBytes)
  const kv = resolve(protocol.model.kvBytesPerToken)
  return Math.floor((protocol.filters.gpuMemUtil * hbm * tp - weights) / kv)
}

/** A point of the claims: an extract row with the protocol row it belongs to. */
export interface ClaimPoint {
  readonly prow: ProtocolRow
  readonly row: PointRow
}

/**
 * The points that get a `bench.ix-l70.*` claim: rows of a protocol row (not a control), at a fit concurrency and a box TP,
 * that survive the KV rule and the preemption rule. In protocol row order, then id order. (The protocol's drops are
 * asserted by S5-06; here they only decide which rows have a claim.)
 */
export function claimPoints(rows: readonly PointRow[], protocol: Protocol, resolve: ClaimResolver): ClaimPoint[] {
  const out: ClaimPoint[] = []
  for (const prow of protocol.rows) {
    for (const row of rows) {
      if (row.hardware !== prow.hardware || row.precision !== prow.precision) continue
      if (!prow.boxTp.includes(row.decode_tp) || !protocol.split.fitConc.includes(row.conc)) continue
      if (row.conc * (row.isl + row.osl) > kvTokenLimit(protocol, prow, row.decode_tp, resolve)) continue
      if (row.median_ttft >= protocol.filters.ttftMaxSeconds) continue
      out.push({ prow, row })
    }
  }
  return out
}

/** The id of a point's TPOT claim (§4.5). */
export const tpotClaimId = (p: ClaimPoint) =>
  `bench.ix-l70.${p.prow.key}.tp${p.row.decode_tp}.${p.row.isl}-${p.row.osl}.c${p.row.conc}.tpot`

/** The row that also gets a median-TTFT claim: example B (§3.7), B200 FP8 TP 1, 8192/1024, 4 users. */
export const TTFT_CLAIM_ROW = '40518'
export const ttftClaimId = (p: ClaimPoint) =>
  `bench.ix-l70.${p.prow.key}.tp${p.row.decode_tp}.${p.row.isl}-${p.row.osl}.c${p.row.conc}.ttft-median`

const HARDWARE_NAMES: Record<string, string> = { h100: 'H100 SXM', b200: 'B200' }
const PRECISION_NAMES: Record<string, string> = { fp8: 'FP8', fp4: 'NVFP4' }

/** Single-quoted TypeScript string literal. */
const lit = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

/** The text of one benchmark claim as `ix-points.ts` writes it. `member` is the raw member the claim quotes. */
function claimSource(p: ClaimPoint, protocol: Protocol, member: 'mean_tpot' | 'median_ttft'): string {
  const { row } = p
  const value = row[member]
  const hw = HARDWARE_NAMES[row.hardware] ?? row.hardware.toUpperCase()
  const prec = PRECISION_NAMES[row.precision] ?? row.precision.toUpperCase()
  const run = /\/actions\/runs\/(\d+)\/attempts\/(\d+)$/.exec(row.run_url)
  if (!run) throw new Error(`row ${row.id}: run_url is not a GitHub Actions run with an attempt: ${row.run_url}`)
  const what = member === 'mean_tpot' ? 'mean TPOT' : 'median TTFT'
  const id = member === 'mean_tpot' ? tpotClaimId(p) : ttftClaimId(p)
  const label = `InferenceX ${row.id}: ${hw} ${prec} TP ${row.decode_tp}, ${row.isl}/${row.osl} tokens, ${row.conc} users, ${what}`
  const r = protocol.replay
  const boundary =
    `InferenceX row ${row.id} (run ${run[1]}, attempt ${run[2]}): ${hw}, ${prec} weights, Llama-3.3-70B-Instruct-FP8, vLLM at the harness commit ` +
    `${protocol.snapshot.harness.ref.slice(0, 7)} (0.10.2), TP ${row.decode_tp}, one node, no speculative decoding. ${row.isl} tokens in and ${row.osl} out nominal ` +
    `(lengths drawn from ${r.rangeRatio} to 1 times nominal), ${row.conc} concurrent requests, ${r.promptsPerConc * row.conc} prompts; the ${what} of those requests. ` +
    `Copied unmodified from the pinned response (bench.inferencex.llama70b-2025-10-29 names it and the extract). Official InferenceX result as published 2025-10-29; the course's fit is its own.`
  return [
    '  {',
    `    id: ${lit(id)},`,
    "    kind: 'benchmark',",
    `    value: ${JSON.stringify(value)},`,
    "    unit: 's',",
    `    label: ${lit(label)},`,
    `    source: { ...IX_QUERY, quote: ${lit(`"${member}":${JSON.stringify(value)}`)}, row: ${lit(`id ${row.id}`)} },`,
    `    verifiedAt: ${lit(FETCHED)},`,
    '    ttlDays: 180,',
    `    boundary: ${lit(boundary)},`,
    '  },',
  ].join('\n')
}

/** The text of `src/data/claims/lazy/ix-points.ts`: one TPOT claim per claim point and the one median-TTFT claim (§4.5). */
export function generateClaims(rows: readonly PointRow[], protocol: Protocol, resolve: ClaimResolver, extractSha256: string): string {
  const points = claimPoints(rows, protocol, resolve)
  const ttft = points.find((p) => p.row.id === TTFT_CLAIM_ROW)
  if (!ttft) throw new Error(`row ${TTFT_CLAIM_ROW} (the median-TTFT claim) is not among the claim points`)
  const claims = [...points.map((p) => claimSource(p, protocol, 'mean_tpot')), claimSource(ttft, protocol, 'median_ttft')]
  return [
    "import { registerClaims } from '../registry'",
    "import type { Claim } from '../schema'",
    '',
    '/**',
    ' * GENERATED by `bun scripts/fetch-physics-points.ts --claims` from src/data/physics/points/inferencex-l70-2025-10-29.json',
    ` * (sha256 ${extractSha256}); do not edit. The measured points the physics v2 table is fitted on that a learner can see`,
    ` * (spec s5 §4.5, S5-D37): every fit-concurrency point inside the box of the protocol's three rows that survives its filters`,
    ` * (${points.length} mean TPOT claims) and example B's median TTFT. Each value is the response's raw member in seconds, and its quote`,
    ' * is that member as the response writes it. The pinned response is named by `bench.inferencex.llama70b-2025-10-29`.',
    ' */',
    'const IX_QUERY = {',
    `  url: ${lit(protocol.snapshot.url)},`,
    "  title: 'InferenceX API: Llama-3.3-70B-Instruct-FP8 benchmarks of 2025-10-29 (exact date)',",
    '}',
    '',
    'export const IX_POINT_CLAIMS: Claim[] = [',
    claims.join('\n'),
    ']',
    '',
    'registerClaims(IX_POINT_CLAIMS)',
    '',
  ].join('\n')
}

/* ------------------------------ the command line ------------------------------ */

function fail(message: string): never {
  console.error(`fetch-physics-points: ${message}`)
  process.exit(1)
}

function writeIfChanged(file: string, text: string): string {
  let before: string | undefined
  try {
    before = readFileSync(file, 'utf8')
  } catch {
    before = undefined
  }
  if (before === text) return 'unchanged'
  writeFileSync(file, text)
  return before === undefined ? 'created' : 'rewritten'
}

function runFrom(file: string): void {
  const protocol = readProtocol()
  const bytes = readFileSync(file)
  const problems = snapshotProblems(bytes, protocol)
  if (problems.length > 0) fail(`${file} is not the pinned response:\n  ${problems.join('\n  ')}`)
  const response = bytes.toString('utf8')
  const total = (JSON.parse(response) as unknown[]).length
  if (total !== protocol.snapshot.rawRows) fail(`the response has ${total} rows, the protocol pins ${protocol.snapshot.rawRows}`)
  const rows = buildExtract(response, protocol)
  const check = checkMembers(rows, response)
  if (check.problems.length > 0) fail(`the extract does not reproduce the response's members:\n  ${check.problems.join('\n  ')}`)
  const state = writeIfChanged(EXTRACT_PATH, serializeExtract(rows))
  console.log(`response ok: ${bytes.length} bytes, sha256 ${protocol.snapshot.rawSha256}, ${total} rows`)
  console.log(`extract ${state}: ${rows.length} rows (${rows.length - 120} selected + 120 control), ${check.members} members equal the response's raw text`)
  for (const pop of keptPopulations(protocol)) {
    console.log(`  ${pop.hardware} ${pop.precision}: ${rows.filter((r) => r.hardware === pop.hardware && r.precision === pop.precision).length}`)
  }
}

function runNim(file: string): void {
  const bytes = readFileSync(file)
  const sha = sha256Hex(bytes)
  if (sha !== NIM_SHA256 || bytes.length !== NIM_BYTES) fail(`${file} is ${bytes.length} bytes with sha256 ${sha}; expected ${NIM_BYTES} bytes, ${NIM_SHA256}`)
  const rows = parseNim(bytes.toString('utf8'))
  if (rows.length !== NIM_ROWS) fail(`the NIM page parses to ${rows.length} rows, expected ${NIM_ROWS}`)
  console.log(`nim ${writeIfChanged(NIM_PATH, serializeNim(rows, sha, bytes.length))}: ${rows.length} rows, sha256 ${sha}`)
}

async function runOnline(): Promise<void> {
  const protocol = readProtocol()
  const rows = readExtract()
  console.log(`GET ${protocol.snapshot.url}`)
  const res = await fetch(protocol.snapshot.url)
  if (!res.ok) fail(`the query returned HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const response = Buffer.from(bytes).toString('utf8')
  const sha = sha256Hex(bytes)
  const total = rawRows(response).size
  console.log(`  ${bytes.length} bytes, ${total} rows, sha256 ${sha}`)
  console.log(`  whole response vs the pin (${protocol.snapshot.rawBytes} bytes, ${protocol.snapshot.rawSha256}): ${sha === protocol.snapshot.rawSha256 && bytes.length === protocol.snapshot.rawBytes ? 'MATCHES' : 'DIFFERS'}`)
  const check = checkMembers(rows, response)
  console.log(`  kept members: ${check.members - check.problems.length} of ${check.members} equal the response's raw text, ${check.rows} extract rows`)
  const nim = readNim()
  console.log(`GET ${NIM_MARKDOWN}`)
  const nimRes = await fetch(NIM_MARKDOWN)
  if (nimRes.ok) {
    const nimBytes = new Uint8Array(await nimRes.arrayBuffer())
    const nimSha = sha256Hex(nimBytes)
    console.log(`  ${nimBytes.length} bytes, sha256 ${nimSha}: ${nimSha === nim.sha256 ? 'MATCHES' : 'DIFFERS from'} the extract's (${nim.sha256}); informational, the panel is never gated`)
  } else {
    console.log(`  HTTP ${nimRes.status}; informational, the panel is never gated`)
  }
  if (check.problems.length > 0) fail(`the extract no longer matches the source:\n  ${check.problems.join('\n  ')}`)
  console.log('online check ok')
}

/** The registry's claims as a resolver in bytes; S5-03 has registered the model byte claims by the time this runs for real. */
async function registryResolver(): Promise<ClaimResolver> {
  const { ALL_CLAIMS } = await import('../src/data/claims/all')
  return (id) => {
    const claim = ALL_CLAIMS.find((c) => c.id === id)
    if (!claim) throw new Error(`claim ${id} is not registered (S5-03 registers the model byte claims before this runs for real)`)
    if (typeof claim.value !== 'number') throw new Error(`claim ${id} is not a number`)
    return toBytes(claim.value, claim.unit)
  }
}

async function runClaims(): Promise<void> {
  const protocol = readProtocol()
  const rows = readExtract()
  let text: string
  try {
    text = generateClaims(rows, protocol, await registryResolver(), sha256Hex(readFileSync(EXTRACT_PATH)))
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
  console.log(`ix-points.ts ${writeIfChanged(CLAIMS_PATH, text)}`)
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const value = (flag: string) => {
    const at = args.indexOf(flag)
    return at >= 0 ? args[at + 1] : undefined
  }
  if (args.includes('--from')) {
    const file = value('--from')
    if (!file) fail('--from needs the saved response file')
    runFrom(file)
  } else if (args.includes('--nim')) {
    const file = value('--nim')
    if (!file) fail('--nim needs the saved NIM page (Markdown)')
    runNim(file)
  } else if (args.includes('--online')) {
    await runOnline()
  } else if (args.includes('--claims')) {
    await runClaims()
  } else {
    fail('usage: --from <saved response> | --nim <saved page.md> | --online | --claims')
  }
}
