/**
 * verify:physics — the gate's CI face (docs/specs/s5.md §5.2, §5.6, §5.7; S5-D14, S5-D19, S5-D23, S5-D54, S5-D63).
 *
 *   bun run verify:physics            fast: every CI and deploy run, after verify:claims, under 15 s
 *   bun run verify:physics --full     the replays, the fit, LOO, held-out and the reports, regenerated in memory and diffed
 *                                     with the committed files (its own workflow, .github/workflows/physics.yml; 120 s)
 *
 * Fast mode checks, and fails on any mismatch:
 *   - the protocol: protocol.md's sha256 is the last protocol-history.json entry's and report.json's; the block's `version`
 *     is that entry's; every history entry after version 1 has a dated `### <date>` heading under the Amendments;
 *   - the snapshot: the extract's sha256 is the one the dataset claim names and report.json records, the NIM extract's too;
 *   - the table: its input claims still hold the values and `verifiedAt` they were fitted with (a moved claim is "re-fit
 *     needed", never a silent re-grade), its input hash and `PHYS_ID` recompute, its rows equal report.json's and the
 *     chips and models its claims build, and `IX_INBOX` equals the extract's in-box F points;
 *   - the verdict: a `calibrated` row passes G1, G2, G4 and G5 recomputed from the report's own statistics, a `failed`
 *     row fails one, and eligibility follows (TPOT with `calibrated`, TTFT with G3 too);
 *   - consistency (§5.6): `EngineV2` with the written table equals the weighted-sum prediction on three configurations per row;
 *   - eligibility: every consumer `collectConsumers()` finds names only calibrated rows and eligible metrics (S5-D54);
 *   - the report's schema, its `claimValues` and the boundary text of the parameter claims (S5-D56).
 *
 * The checks are pure functions of plain data (exported), so tests/physics/verify-physics.test.ts runs each on fixtures. The
 * command runs only under `import.meta.main`.
 */
import { readFileSync } from 'node:fs'
import { getClaim } from '../src/data/claims/all'
import { stableStringify } from '../src/lib/ledger/stable'
import { checkEligibility, collectConsumers } from '../src/lib/world/physics/consumers'
import { ENGINE_V2_REV } from '../src/lib/world/physics/engine-v2'
import { predictMedianTtft, predictTpot, replayPoint, runEngine, stepSeconds, medianWindowSteps, type ReplaySettings } from '../src/lib/world/physics/replay'
import { INPUT_CLAIMS, INPUT_HASH, IX_INBOX, FIT_STATUS as TABLE_FIT_STATUS, PHYSICS_ROWS, PHYS_ID, type IxPoint } from '../src/lib/world/physics/table'
import type { CalibratedRow } from '../src/lib/world/physics/types'
import { NIM_BYTES, NIM_PATH, NIM_ROWS, NIM_SHA256, readNim } from './fetch-physics-points'
import {
  DATASET_CLAIM,
  FIT_STATUS,
  PARAM_CLAIMS,
  STAT_CLAIMS,
  claimValuesOf,
  consistencyPoints,
  inputClaimIds,
  inputHashOf,
  loadExtract,
  physClaimId,
  physIdOf,
  renderReport,
  renderTable,
  replayPointOf,
  replaySettings,
  rowShapes,
  runGate,
  seedOf,
  selectPoints,
  REPORT_PATH,
  TABLE_PATH,
  type InputClaim,
  type Report,
  type ReportRow,
  type RowSelection,
} from './fit-physics'
import { historyProblems, protocolSha256, readProtocol, readProtocolHistory, PROTOCOL_PATH, type HistoryEntry, type Protocol } from './physics-protocol'

/** The sentence every parameter claim's boundary must carry (S5-D56). */
export const SPLIT_CAVEAT = "this fit's split of one snapshot; not a hardware fact; other equally good forms split it differently"

/** The fast mode's time budget and `--full`'s, seconds (S5-D23). */
export const FAST_BUDGET_S = 15
export const FULL_BUDGET_S = 120

const same = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/* ------------------------------ the protocol (S5-D63) ------------------------------ */

/** The text under the protocol's Amendments heading (to the next `## ` heading), or '' when there is none. */
export function amendmentsSection(markdown: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => /^## (\d+\. )?Amendments\s*$/.test(l))
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((l) => /^## /.test(l))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

/** Every history entry after version 1 needs its own `### <date>` heading under the Amendments (a second entry of one day, a second heading). */
export function amendmentProblems(markdown: string, history: readonly HistoryEntry[]): string[] {
  const section = amendmentsSection(markdown)
  const headings = section.split('\n').filter((l) => /^### /.test(l))
  const out: string[] = []
  const wanted = new Map<string, number>()
  for (const e of history) {
    if (e.version <= 1) continue
    const n = (wanted.get(e.date) ?? 0) + 1
    wanted.set(e.date, n)
    const have = headings.filter((h) => h.slice(4).trim().startsWith(e.date)).length
    if (have < n) out.push(`protocol-history.json has version ${e.version} (${e.date}) but protocol.md's Amendments has no dated heading "### ${e.date}" for it`)
  }
  return out
}

/** Why the protocol cannot stand behind the report: sha256, version, history and amendments. */
export function protocolProblems(args: { markdown: string; protocol: Protocol; sha256: string; history: readonly HistoryEntry[]; report: Pick<Report, 'protocol'> }): string[] {
  const { markdown, protocol, sha256, history, report } = args
  const out = historyProblems(protocol, sha256, history)
  const last = history[history.length - 1]
  if (report.protocol.sha256 !== sha256) out.push(`report.json records protocol sha256 ${report.protocol.sha256}, protocol.md is ${sha256}: the protocol changed after the verdict; amend it (dated heading, history entry) and re-run the verdict`)
  if (last && report.protocol.sha256 !== last.sha256) out.push(`report.json's protocol sha256 ${report.protocol.sha256} is not the last history entry's ${last.sha256}`)
  if (report.protocol.version !== protocol.version) out.push(`report.json records protocol version ${report.protocol.version}, the block says ${protocol.version}`)
  out.push(...amendmentProblems(markdown, history))
  return out
}

/* ------------------------------ the snapshot ------------------------------ */

export function snapshotProblems(args: {
  extractSha256: string
  datasetBoundary: string
  protocol: Protocol
  report: Pick<Report, 'extract' | 'nim'>
  nim: { sha256: string; bytes: number; rows: number }
}): string[] {
  const { extractSha256, datasetBoundary, protocol, report, nim } = args
  const out: string[] = []
  if (!datasetBoundary.includes(extractSha256)) out.push(`the extract's sha256 ${extractSha256} is not the one the dataset claim ${DATASET_CLAIM} names`)
  if (report.extract.sha256 !== extractSha256) out.push(`report.json records extract sha256 ${report.extract.sha256}, the extract is ${extractSha256}`)
  if (report.extract.rawSha256 !== protocol.snapshot.rawSha256) out.push(`report.json records raw response sha256 ${report.extract.rawSha256}, the protocol pins ${protocol.snapshot.rawSha256}`)
  if (!datasetBoundary.includes(protocol.snapshot.rawSha256)) out.push(`the dataset claim does not name the raw response's sha256 ${protocol.snapshot.rawSha256}`)
  if (nim.sha256 !== NIM_SHA256) out.push(`the NIM extract records sha256 ${nim.sha256}, the page it was parsed from is ${NIM_SHA256}`)
  if (report.nim.sha256 !== nim.sha256) out.push(`report.json records NIM sha256 ${report.nim.sha256}, the NIM extract is ${nim.sha256}`)
  if (nim.bytes !== NIM_BYTES || nim.rows !== NIM_ROWS) out.push(`the NIM extract has ${nim.rows} rows from ${nim.bytes} bytes, expected ${NIM_ROWS} from ${NIM_BYTES}`)
  return out
}

/* ------------------------------ the table ------------------------------ */

/** The generated table's exports, as `verify:physics` reads them. */
export interface TableData {
  PHYSICS_ROWS: readonly CalibratedRow[]
  PHYS_ID: string
  INPUT_HASH: string
  IX_INBOX: Readonly<Record<string, readonly IxPoint[]>>
  INPUT_CLAIMS: readonly InputClaim[]
  FIT_STATUS: string
}

/** The committed table. */
export const committedTable = (): TableData => ({ PHYSICS_ROWS, PHYS_ID, INPUT_HASH, IX_INBOX, INPUT_CLAIMS, FIT_STATUS: TABLE_FIT_STATUS })

/** A claim that moved since the fit read it, and any input the table does not list: "re-fit needed" (§5.2), never a silent re-grade. */
export function inputProblems(table: Pick<TableData, 'INPUT_CLAIMS'>, protocol: Protocol, current: (id: string) => InputClaim | undefined): string[] {
  const out: string[] = []
  const wanted = inputClaimIds(protocol)
  const have = table.INPUT_CLAIMS.map((c) => c.id)
  if (!same(wanted, have)) out.push(`table.ts lists input claims ${have.join(', ')}; the protocol's rows read ${wanted.join(', ')}: re-fit needed`)
  for (const c of table.INPUT_CLAIMS) {
    const now = current(c.id)
    if (!now) out.push(`input claim ${c.id} is gone: re-fit needed`)
    else if (!same(now.value, c.value)) out.push(`input claim ${c.id} moved: the table was fitted at ${JSON.stringify(c.value)}, the registry says ${JSON.stringify(now.value)}: re-fit needed (bun scripts/fit-physics.ts --write)`)
    else if (now.verifiedAt !== c.verifiedAt) out.push(`input claim ${c.id} was re-verified on ${now.verifiedAt} (the table has ${c.verifiedAt}): regenerate the table (bun scripts/fit-physics.ts --write)`)
  }
  return out
}

/** The input hash, the content-addressed id, the engine rev and the status line, against the table and the report. */
export function hashProblems(table: TableData, report: Pick<Report, 'inputHash' | 'physId' | 'engineRev' | 'fitStatus'>, extractSha256: string, engineRev: string = ENGINE_V2_REV): string[] {
  const out: string[] = []
  const hash = inputHashOf(extractSha256, table.INPUT_CLAIMS)
  if (hash !== table.INPUT_HASH) out.push(`table.ts INPUT_HASH ${table.INPUT_HASH} is not the hash of the extract, the engine rev ${engineRev} and its input claims (${hash}): re-fit needed`)
  if (report.inputHash !== table.INPUT_HASH) out.push(`report.json records input hash ${report.inputHash}, table.ts has ${table.INPUT_HASH}`)
  const id = physIdOf(table.PHYSICS_ROWS)
  if (id !== table.PHYS_ID) out.push(`table.ts PHYS_ID ${table.PHYS_ID} is not the id of its rows under engine rev ${engineRev} (${id}): the engine or the rows changed; re-fit`)
  if (report.physId !== table.PHYS_ID) out.push(`report.json records ${report.physId}, table.ts has ${table.PHYS_ID}`)
  if (report.engineRev !== engineRev) out.push(`report.json was fitted under engine rev ${report.engineRev}, the engine is ${engineRev}: re-fit needed`)
  if (table.FIT_STATUS !== FIT_STATUS) out.push(`table.ts FIT_STATUS is "${table.FIT_STATUS}", it must read "${FIT_STATUS}" until the owner signs`)
  if (report.fitStatus !== table.FIT_STATUS) out.push(`report.json fitStatus is "${report.fitStatus}", table.ts says "${table.FIT_STATUS}"`)
  return out
}

/** The table's rows against the protocol's, the report's and the chips and models the claims build. */
export function rowProblems(args: {
  table: TableData
  report: Pick<Report, 'rows' | 'settings'>
  protocol: Protocol
  shapes: (prowKey: string) => Pick<CalibratedRow['spec'], 'chip' | 'model'>
}): string[] {
  const { table, report, protocol } = args
  const out: string[] = []
  const keys = protocol.rows.map((r) => r.key)
  if (!same(table.PHYSICS_ROWS.map((r) => r.key), keys)) out.push(`table.ts rows are ${table.PHYSICS_ROWS.map((r) => r.key).join(', ')}, the protocol's are ${keys.join(', ')}`)
  if (!same(report.rows.map((r) => r.key), keys)) out.push(`report.json rows are ${report.rows.map((r) => r.key).join(', ')}, the protocol's are ${keys.join(', ')}`)
  for (const prow of protocol.rows) {
    const t = table.PHYSICS_ROWS.find((r) => r.key === prow.key)
    const r = report.rows.find((x) => x.key === prow.key)
    if (!t || !r) continue
    const at = prow.key
    const shapes = args.shapes(prow.key)
    if (!same(t.spec.chip, shapes.chip)) out.push(`${at}: table.ts chip ${stableStringify(t.spec.chip)} is not what the claims build now (${stableStringify(shapes.chip)}): re-fit needed`)
    if (!same(t.spec.model, shapes.model)) out.push(`${at}: table.ts model ${stableStringify(t.spec.model)} is not what the claims build now (${stableStringify(shapes.model)}): re-fit needed`)
    if (t.status !== r.status) out.push(`${at}: table.ts says ${t.status}, report.json says ${r.status}`)
    const p = t.spec.params
    const rp = r.params
    if (p.etaMem !== rp.etaMem || p.etaFlop !== rp.etaFlop || p.layerUs !== rp.layerUs || p.seqUs !== rp.seqUs || t.harnessMs !== rp.harnessMs) out.push(`${at}: table.ts parameters differ from report.json's`)
    if (p.linkGBs !== rp.linkGBs) out.push(`${at}: table.ts link bandwidth ${p.linkGBs} differs from report.json's ${rp.linkGBs}`)
    if (!same(t.eligible, r.eligible)) out.push(`${at}: table.ts eligibility ${stableStringify(t.eligible)} differs from report.json's ${stableStringify(r.eligible)}`)
    if (!same(t.box, r.box) || !same(t.envelope, r.envelope) || !same(t.label, r.label)) out.push(`${at}: table.ts box, envelope or label figures differ from report.json's`)
    if (!same(t.box.tp, prow.boxTp)) out.push(`${at}: the box's TPs ${t.box.tp.join('/')} are not the protocol's ${prow.boxTp.join('/')}`)
    if (t.box.batchTokens !== report.settings.batchTokens) out.push(`${at}: the box's token budget ${t.box.batchTokens} is not the replay's ${report.settings.batchTokens}`)
  }
  return out
}

/** `IX_INBOX` is the extract's F points inside each row's box TPs, in id order (§5.8). */
export function inboxProblems(table: Pick<TableData, 'IX_INBOX'>, sel: readonly RowSelection[]): string[] {
  const want: Record<string, IxPoint[]> = {}
  for (const s of sel) {
    want[s.prow.key] = s.fit
      .filter((p) => s.prow.boxTp.includes(p.decode_tp))
      .map((p) => ({ id: p.id, tp: p.decode_tp, conc: p.conc, isl: p.isl, osl: p.osl, tpot: p.mean_tpot }))
      .sort((a, b) => Number(a.id) - Number(b.id))
  }
  return same(want, table.IX_INBOX) ? [] : ['table.ts IX_INBOX is not the extract\'s in-box F points: re-fit needed']
}

/* ------------------------------ the verdict (G1-G5) ------------------------------ */

const pct = (x: number): string => `${(100 * x).toFixed(1)} %`

/**
 * Recomputes G1, G2, G4 and G5 (and G3) from the report's own statistics, parameters and points against the protocol's
 * bounds; a stated `ok` that disagrees is a fault. Then the verdict: a `calibrated` row must pass G1, G2, G4 and G5, a
 * `failed` row must fail one of them, TPOT eligibility follows `calibrated` and TTFT eligibility needs G3 as well.
 */
export function gateProblems(report: Pick<Report, 'rows'>, protocol: Protocol): string[] {
  const out: string[] = []
  const g = protocol.gates
  for (const row of report.rows) {
    const at = row.key
    const s = row.stats
    const p = row.params
    const fitPts = row.points.filter((x) => x.subset === 'F')
    const g1 = s.g1.n > 0 && s.g1.mean <= g.G1.meanMax && s.g1.p90 <= g.G1.p90Max
    const g2 = s.g2.n > 0 && s.g2.mean <= g.G2.meanMax && s.g2.p90 <= g.G2.p90Max
    const g3 = s.g3.n > 0 && s.g3.mean <= g.G3.meanMax
    const g4 =
      p.etaMem >= g.G4.etaMem[0] && p.etaMem <= g.G4.etaMem[1] && p.etaFlop >= g.G4.etaFlop[0] && p.etaFlop <= g.G4.etaFlop[1] &&
      p.layerUs <= g.G4.layerUsMax && p.seqUs <= g.G4.seqUsMax && (p.linkGBs === null || p.linkGBs <= g.G4.linkGBsMax) && p.harnessMs <= g.G4.harnessMsMax
    const g5 =
      fitPts.length >= g.G5.fitPointsMin &&
      new Set(fitPts.map((x) => x.tp)).size >= g.G5.tpValuesMin &&
      new Set(fitPts.map((x) => x.conc)).size >= g.G5.concValuesMin &&
      new Set(fitPts.map((x) => `${x.isl}/${x.osl}`)).size >= g.G5.shapesMin &&
      fitPts.some((x) => x.isl === g.G5.shapeRequired[0] && x.osl === g.G5.shapeRequired[1])
    const calc = { G1: g1, G2: g2, G3: g3, G4: g4, G5: g5 }
    for (const k of ['G1', 'G2', 'G3', 'G4', 'G5'] as const) {
      if (row.gates[k].ok !== calc[k]) out.push(`${at}: report.json says ${k} ${row.gates[k].ok ? 'passes' : 'fails'}, its own figures say ${calc[k] ? 'pass' : 'fail'} (${row.gates[k].detail})`)
    }
    if (s.g1.n !== fitPts.length) out.push(`${at}: G1 counts ${s.g1.n} points, the per-point table has ${fitPts.length} fit points`)
    const buildGates = [['G1', g1, `TPOT leave-one-out mean ${pct(s.g1.mean)} (≤ ${pct(g.G1.meanMax)}), p90 ${pct(s.g1.p90)} (≤ ${pct(g.G1.p90Max)})`],
      ['G2', g2, `held-out TPOT mean ${pct(s.g2.mean)} (≤ ${pct(g.G2.meanMax)}), p90 ${pct(s.g2.p90)} (≤ ${pct(g.G2.p90Max)})`],
      ['G4', g4, row.gates.G4.detail], ['G5', g5, row.gates.G5.detail]] as const
    const failing = buildGates.filter(([, ok]) => !ok)
    if (row.status === 'calibrated') {
      for (const [k, , why] of failing) out.push(`${at} is marked calibrated but ${k} fails: ${why}`)
    } else if (failing.length === 0) {
      out.push(`${at} is marked failed but G1, G2, G4 and G5 all pass: it is calibrated`)
    }
    const ttft = row.status === 'calibrated' && g3
    if (row.eligible.tpot !== (row.status === 'calibrated')) out.push(`${at}: TPOT eligibility ${row.eligible.tpot} does not follow the verdict ${row.status}`)
    if (row.eligible.ttft !== ttft) out.push(`${at}: TTFT eligibility ${row.eligible.ttft} should be ${ttft} (calibrated and G3 ${g3 ? 'passes' : 'fails'})`)
    if (row.ttftEligible !== ttft) out.push(`${at}: ttftEligible ${row.ttftEligible} should be ${ttft}`)
  }
  return out
}

/* ------------------------------ the report ------------------------------ */

const NUM_PATHS = ['params.etaMem', 'params.etaFlop', 'params.layerUs', 'params.seqUs', 'params.harnessMs', 'stats.g1.mean', 'stats.g1.p90', 'stats.g1.max', 'stats.g2.mean', 'stats.g2.p90',
  'stats.g3.mean', 'stats.g3.p90', 'box.maxNumSeqs', 'box.batchTokens', 'envelope.tokens', 'envelope.decodeSeqs', 'envelope.kvTokensPerGpu', 'envelope.attnPairsPerGpu',
  'label.tpot.p90', 'label.tpot.n', 'label.ttft.mean', 'label.ttft.p90', 'label.ttft.n'] as const

const at = (v: unknown, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (isRecord(o) ? o[k] : undefined), v)

/** The report's shape: the fields every reader (verify, the claims, the tab) takes for granted, and the 36 claim values. */
export function reportProblems(report: unknown, protocol: Protocol): string[] {
  if (!isRecord(report)) return ['report.json is not an object']
  const out: string[] = []
  if (report.schema !== 1) out.push(`report.json schema is ${String(report.schema)}, expected 1`)
  for (const k of ['fitStatus', 'physId', 'engineRev', 'inputHash', 'claimRounding'] as const) if (typeof report[k] !== 'string' || report[k] === '') out.push(`report.json: ${k} is not a non-empty string`)
  const proto = report.protocol
  if (!isRecord(proto) || typeof proto.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(proto.sha256) || !Number.isInteger(proto.version) || proto.id !== protocol.id) out.push('report.json: protocol is not {id, version, sha256}')
  const ex = report.extract
  if (!isRecord(ex) || typeof ex.sha256 !== 'string' || typeof ex.rawSha256 !== 'string') out.push('report.json: extract is not {sha256, rawSha256}')
  if (!isRecord(report.nim) || typeof report.nim.sha256 !== 'string') out.push('report.json: nim is not {sha256}')
  const st = report.settings
  if (!isRecord(st) || ['batchTokens', 'blockSize', 'promptsPerConc', 'rangeRatio', 'gpuMemUtil'].some((k) => typeof st[k] !== 'number')) out.push('report.json: settings is not the replay settings')
  if (!Array.isArray(report.rows) || report.rows.length !== protocol.rows.length) {
    out.push(`report.json: rows is not an array of ${protocol.rows.length}`)
  } else {
    report.rows.forEach((r: unknown, i: number) => {
      const key = isRecord(r) && typeof r.key === 'string' ? r.key : `rows[${i}]`
      if (!isRecord(r)) return void out.push(`report.json: ${key} is not an object`)
      if (r.status !== 'calibrated' && r.status !== 'failed') out.push(`report.json: ${key}.status is ${String(r.status)}`)
      for (const p of NUM_PATHS) {
        const v = at(r, p)
        if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`report.json: ${key}.${p} is not a finite number`)
      }
      for (const g of ['G1', 'G2', 'G3', 'G4', 'G5']) {
        const gate = at(r, `gates.${g}`)
        if (!isRecord(gate) || typeof gate.ok !== 'boolean' || typeof gate.detail !== 'string') out.push(`report.json: ${key}.gates.${g} is not {ok, detail}`)
      }
      if (!isRecord(r.eligible) || typeof r.eligible.tpot !== 'boolean' || typeof r.eligible.ttft !== 'boolean') out.push(`report.json: ${key}.eligible is not {tpot, ttft}`)
      if (!Array.isArray(r.points) || r.points.length === 0) out.push(`report.json: ${key}.points is empty`)
      else {
        r.points.forEach((p: unknown, j: number) => {
          const ok = isRecord(p) && typeof p.id === 'string' && (p.subset === 'F' || p.subset === 'H') && typeof p.runUrl === 'string' && p.runUrl.startsWith('https://') &&
            ['tp', 'conc', 'isl', 'osl', 'measTpot', 'fullTpot', 'outTpot', 'tpotError', 'measTtft', 'fullTtft', 'outTtft', 'ttftError'].every((k) => typeof p[k] === 'number' && Number.isFinite(p[k]))
          if (!ok) out.push(`report.json: ${key}.points[${j}] is not a per-point record with a run_url`)
        })
        if (r.points.length !== (r.nFit as number) + (r.nHeldOut as number)) out.push(`report.json: ${key} has ${r.points.length} points for ${String(r.nFit)} fit and ${String(r.nHeldOut)} held out`)
      }
      if (!isRecord(r.r1) || !Array.isArray(r.r1.worst) || r.r1.worst.length !== 3) out.push(`report.json: ${key}.r1 does not list the worst three points`)
      if (!Array.isArray(r.consistency) || r.consistency.length !== protocol.consistency.configsPerRow) out.push(`report.json: ${key}.consistency does not hold ${protocol.consistency.configsPerRow} configurations`)
    })
  }
  if (!Array.isArray(report.workedExamples) || report.workedExamples.length !== 2 || !['41187', '40518'].every((id, i) => isRecord((report.workedExamples as unknown[])[i]) && ((report.workedExamples as { id: string }[])[i]).id === id)) {
    out.push('report.json: workedExamples is not [41187, 40518]')
  }
  const cv = report.claimValues
  if (!isRecord(cv)) out.push('report.json: claimValues is not an object')
  else {
    const want = protocol.rows.flatMap((r) => [...PARAM_CLAIMS, ...STAT_CLAIMS].map((n) => physClaimId(r.key, n))).sort()
    const have = Object.keys(cv).sort()
    if (!same(want, have)) out.push(`report.json: claimValues holds ${have.length} ids, expected the ${want.length} phys.<row>.* claims`)
    for (const [id, v] of Object.entries(cv)) if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`report.json: claimValues["${id}"] is not a finite number`)
  }
  return out
}

/** `claimValues` is what the rows' parameters and statistics give at the claim rounding. */
export function claimValueProblems(report: Pick<Report, 'rows' | 'claimValues'>): string[] {
  const want: Record<string, number> = {}
  for (const r of report.rows) Object.assign(want, claimValuesOf(r as ReportRow))
  return same(want, report.claimValues) ? [] : ['report.json claimValues is not what its rows give at the claim rounding: regenerate it (bun scripts/fit-physics.ts --write)']
}

/** Every parameter claim's boundary says the split caveat (S5-D56), and every `phys.<row>.*` claim carries the fit status. */
export function claimTextProblems(claims: readonly { id: string; boundary?: string }[]): string[] {
  const out: string[] = []
  for (const c of claims) {
    if (!c.id.startsWith('phys.') || c.id.startsWith('phys.finding.') || c.id.startsWith('phys.control.') || c.id.startsWith('phys.nim.')) continue
    const isParam = (PARAM_CLAIMS as readonly string[]).some((n) => c.id.endsWith(`.${n}`))
    if (isParam && !(c.boundary ?? '').includes(SPLIT_CAVEAT)) out.push(`${c.id}: boundary must say "${SPLIT_CAVEAT}" (S5-D56)`)
    if (!(c.boundary ?? '').includes(FIT_STATUS)) out.push(`${c.id}: boundary must carry the fit status "${FIT_STATUS}" (S5-D64)`)
  }
  return out
}

/* ------------------------------ consistency (§5.6) ------------------------------ */

export interface ConsistencyRun {
  row: string
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  tpotDeltaUs: number
  ttftDeltaUs: number
  ttftBoundUs: number
  /** why the engine could not run it (out of box, not calibrated), or '' */
  error: string
}

/**
 * §5.6 against the written table: three configurations per row, replayed, then `EngineV2` run with the table's own row
 * (its card, clock and box) and compared with the weighted-sum prediction. A failed row runs with `explore`.
 */
export function runConsistency(protocol: Protocol, sel: readonly RowSelection[], rows: readonly CalibratedRow[], settings: ReplaySettings): ConsistencyRun[] {
  const seed = seedOf(protocol)
  const out: ConsistencyRun[] = []
  for (const s of sel) {
    const row = rows.find((r) => r.key === s.prow.key)
    if (!row) continue
    for (const pt of consistencyPoints(protocol, s)) {
      const p = replayPointOf(pt, seed)
      const log = replayPoint(row.spec, p, settings)
      const stepS = stepSeconds(log, row.spec)
      const predTpotUs = predictTpot(log, row.spec, stepS) * 1e6
      const predTtftUs = predictMedianTtft(log, row.spec, stepS) * 1e6
      const ttftBoundUs = protocol.consistency.ttftMaxAbsUs === '0.5 * steps in the median windows' ? 0.5 * medianWindowSteps(log, row.spec, stepS) : Number.NaN
      const base = { row: row.key, id: pt.id, tp: pt.decode_tp, conc: pt.conc, isl: pt.isl, osl: pt.osl, ttftBoundUs }
      try {
        const run = runEngine(row, p, settings, row.status !== 'calibrated')
        out.push({ ...base, tpotDeltaUs: run.meanTpotUs - predTpotUs, ttftDeltaUs: run.medianTtftUs - predTtftUs, error: '' })
      } catch (e) {
        out.push({ ...base, tpotDeltaUs: Number.NaN, ttftDeltaUs: Number.NaN, ttftBoundUs, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  return out
}

export function consistencyProblems(runs: readonly ConsistencyRun[], protocol: Protocol): string[] {
  const out: string[] = []
  if (protocol.consistency.ttftMaxAbsUs !== '0.5 * steps in the median windows') out.push(`the protocol's ttftMaxAbsUs is "${protocol.consistency.ttftMaxAbsUs}", which verify-physics does not know`)
  for (const r of runs) {
    const where = `${r.row} ${r.id} (TP ${r.tp}, c ${r.conc}, ${r.isl}/${r.osl})`
    if (r.error) out.push(`${where}: EngineV2 would not run the written table: ${r.error}`)
    else {
      if (!(Math.abs(r.tpotDeltaUs) <= protocol.consistency.tpotMaxAbsUs)) out.push(`${where}: mean TPOT differs from the weighted sum by ${Math.abs(r.tpotDeltaUs).toFixed(4)} µs, the bound is ${protocol.consistency.tpotMaxAbsUs} µs`)
      if (!(Math.abs(r.ttftDeltaUs) <= r.ttftBoundUs)) out.push(`${where}: median TTFT differs from the weighted sum by ${Math.abs(r.ttftDeltaUs).toFixed(4)} µs, the bound is ${r.ttftBoundUs} µs`)
    }
  }
  const perRow = new Map<string, number>()
  for (const r of runs) perRow.set(r.row, (perRow.get(r.row) ?? 0) + 1)
  for (const [row, n] of perRow) if (n !== protocol.consistency.configsPerRow) out.push(`${row}: ${n} consistency configurations, the protocol says ${protocol.consistency.configsPerRow}`)
  return out
}

/* ------------------------------ the whole check ------------------------------ */

export interface Check {
  name: string
  problems: string[]
}

const currentClaim = (id: string): InputClaim | undefined => {
  try {
    const c = getClaim(id)
    return { id, value: c.value, verifiedAt: c.verifiedAt }
  } catch {
    return undefined
  }
}

/** Fast mode: every check, against the committed files. `table` and `report` are injectable for tests. */
export async function fastChecks(table: TableData = committedTable(), report: Report = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as Report): Promise<Check[]> {
  const protocol = readProtocol()
  const markdown = readFileSync(PROTOCOL_PATH, 'utf8')
  const checks: Check[] = []
  const add = (name: string, problems: string[]) => checks.push({ name, problems })
  add('report schema', reportProblems(report, protocol))
  if (checks[0].problems.length > 0) return checks
  add('protocol, history and amendments (S5-D63)', protocolProblems({ markdown, protocol, sha256: protocolSha256(), history: readProtocolHistory(), report }))
  const { rows: extract, sha256 } = loadExtract()
  const nim = readNim(NIM_PATH)
  add('snapshot shas', snapshotProblems({ extractSha256: sha256, datasetBoundary: getClaim(DATASET_CLAIM).boundary ?? '', protocol, report, nim: { sha256: nim.sha256, bytes: nim.bytes, rows: nim.rows.length } }))
  add('input claims (re-fit needed on drift)', inputProblems(table, protocol, currentClaim))
  add('input hash, PHYS_ID and fit status', hashProblems(table, report, sha256))
  add('table rows against the report, the protocol and the claims', rowProblems({ table, report, protocol, shapes: (key) => rowShapes(protocol, protocol.rows.find((r) => r.key === key) ?? protocol.rows[0]) }))
  const sel = selectPoints(protocol, extract)
  add('IX_INBOX', inboxProblems(table, sel))
  add('verdict: G1-G5 and eligibility of every row', gateProblems(report, protocol))
  add('claimValues', claimValueProblems(report))
  const { ALL_CLAIMS } = await import('../src/data/claims/all')
  add('phys.* claim text (S5-D56, S5-D64)', claimTextProblems(ALL_CLAIMS))
  add('consistency of EngineV2 with the written table (§5.6)', consistencyProblems(runConsistency(protocol, sel, table.PHYSICS_ROWS, replaySettings(protocol)), protocol))
  add('eligibility of every consumer (S5-D54)', checkEligibility(await collectConsumers(), table.PHYSICS_ROWS, table.PHYS_ID))
  return checks
}

/** The first line where two texts differ, for the failure message. */
export function firstDifference(committed: string, regenerated: string): string {
  const a = committed.split('\n')
  const b = regenerated.split('\n')
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1}: committed ${JSON.stringify((a[i] ?? '<end>').slice(0, 160))}, regenerated ${JSON.stringify((b[i] ?? '<end>').slice(0, 160))}`
  }
  return 'no line differs'
}

/** `--full`: regenerate the table and the report in memory and diff them with the committed files; fail a calibrated row that fails a gate. */
export function fullChecks(note: (line: string) => void): { checks: Check[]; seconds: number } {
  const t0 = performance.now()
  const run = runGate(readProtocol(), note)
  const checks: Check[] = []
  const diffs = (name: string, file: string, text: string): Check => {
    const committed = readFileSync(file, 'utf8')
    return { name, problems: committed === text ? [] : [`${name} differs from the regeneration (${firstDifference(committed, text)}); run bun scripts/fit-physics.ts --write and read the diff`] }
  }
  checks.push(diffs('table.ts regenerated in memory', TABLE_PATH, renderTable(run)))
  checks.push(diffs('report.json regenerated in memory', REPORT_PATH, renderReport(run)))
  const failing: string[] = []
  const committed = committedTable()
  for (const r of run.rows) {
    const t = committed.PHYSICS_ROWS.find((x) => x.key === r.sel.prow.key)
    if (t?.status === 'calibrated') {
      for (const k of ['G1', 'G2', 'G4', 'G5'] as const) if (!r.ev.gates[k].ok) failing.push(`${r.sel.prow.key} is calibrated but ${k} fails: ${r.ev.gates[k].detail}`)
    }
    for (const c of r.consistency) if (!c.tpotOk || !c.ttftOk) failing.push(`${r.sel.prow.key} ${c.id}: the fit's consistency check failed`)
  }
  checks.push({ name: 'G1-G5 of every calibrated row, recomputed', problems: failing })
  return { checks, seconds: (performance.now() - t0) / 1e3 }
}

function printChecks(checks: readonly Check[]): number {
  let bad = 0
  for (const c of checks) {
    if (c.problems.length === 0) console.log(`ok    ${c.name}`)
    else {
      console.error(`FAIL  ${c.name}`)
      for (const p of c.problems) console.error(`        ${p}`)
      bad += c.problems.length
    }
  }
  return bad
}

async function main(): Promise<void> {
  const full = process.argv.includes('--full')
  const t0 = performance.now()
  const checks = await fastChecks()
  const fast = (performance.now() - t0) / 1e3
  let bad = printChecks(checks)
  console.log(`verify-physics: fast checks in ${fast.toFixed(1)} s (budget ${FAST_BUDGET_S} s)`)
  if (fast > FAST_BUDGET_S) {
    console.error(`FAIL  the fast checks took ${fast.toFixed(1)} s, over the ${FAST_BUDGET_S} s budget (S5-D23)`)
    bad += 1
  }
  if (full) {
    const { checks: more, seconds } = fullChecks((line) => console.error(line))
    bad += printChecks(more)
    console.log(`verify-physics --full: ${seconds.toFixed(1)} s (budget ${FULL_BUDGET_S} s; over it, the job moves to nightly only, S5-D23)`)
  }
  if (bad > 0) {
    console.error(`verify-physics: ${bad} problem(s)`)
    process.exit(1)
  }
  console.log(`verify-physics: ok${full ? ' (fast and full)' : ' (fast)'}`)
}

if (import.meta.main) await main()
