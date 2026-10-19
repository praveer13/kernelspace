/**
 * verify:physics, the consumer contract, the generated table and report, and the phys.* claims
 * (docs/specs/s5.md §5.2, §5.7-5.9; S5-07, S5-D54, S5-D56, S5-D63, S5-D64).
 *
 * Every failure CI promises is shown on a fixture: drift (a moved input claim, a tampered hash or id), a G1-G5 failure of a
 * `calibrated` row, an ineligible consumer, a protocol whose sha256 is not the last history entry's or differs from the
 * report's, a block version that differs from that entry's, and a history entry after version 1 with no dated heading
 * under the Amendments. The committed files pass, and `--full` regenerates the table and the report with no diff.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { ALL_CLAIMS, getClaim } from '../../src/data/claims/all'
import { stableStringify } from '../../src/lib/ledger/stable'
import { checkEligibility, collectConsumers, exerciseConsumers, familyConsumers, type PhysicsConsumer } from '../../src/lib/world/physics/consumers'
import { ENGINE_V2_REV } from '../../src/lib/world/physics/engine-v2'
import { FIT_STATUS as TABLE_FIT_STATUS, INPUT_CLAIMS, IX_INBOX, PHYSICS_ROWS, PHYS_ID } from '../../src/lib/world/physics/table'
import type { CalibratedRow } from '../../src/lib/world/physics/types'
import { physProblems } from '../../scripts/verify-claims'
import {
  FIT_STATUS,
  PARAM_CLAIMS,
  STAT_CLAIMS,
  buildReport,
  claimValuesOf,
  inputClaimIds,
  inputHashOf,
  loadExtract,
  physClaimId,
  physIdOf,
  renderReport,
  renderTable,
  replaySettings,
  runGate,
  selectPoints,
  tableRows,
  workedExamples,
  type InputClaim,
  type Report,
} from '../../scripts/fit-physics'
import { readProtocol, protocolSha256, readProtocolHistory, PROTOCOL_PATH, type HistoryEntry } from '../../scripts/physics-protocol'
import {
  SPLIT_CAVEAT,
  amendmentProblems,
  amendmentsSection,
  claimTextProblems,
  claimValueProblems,
  committedTable,
  consistencyProblems,
  fastChecks,
  fullChecks,
  gateProblems,
  hashProblems,
  inboxProblems,
  inputProblems,
  protocolProblems,
  reportProblems,
  rowProblems,
  runConsistency,
  snapshotProblems,
  type ConsistencyRun,
  type TableData,
} from '../../scripts/verify-physics'
import { NIM_BYTES, NIM_ROWS, NIM_SHA256 } from '../../scripts/fetch-physics-points'
import { rowShapes } from '../../scripts/fit-physics'

const protocol = readProtocol()
const markdown = readFileSync(PROTOCOL_PATH, 'utf8')
const report = JSON.parse(readFileSync(new URL('../../docs/physics/report.json', import.meta.url), 'utf8')) as Report
const table: TableData = committedTable()
const clone = <T>(x: T): T => structuredClone(x)
const rowOf = (r: Report, key: string) => r.rows.find((x) => x.key === key) as Report['rows'][number]
const current = (id: string): InputClaim => {
  const c = getClaim(id)
  return { id, value: c.value, verifiedAt: c.verifiedAt }
}

describe('the committed files', () => {
  test('the fast checks pass: protocol, snapshot, table, verdict, claims, consistency and eligibility', async () => {
    const checks = await fastChecks()
    expect(checks.flatMap((c) => c.problems.map((p) => `${c.name}: ${p}`))).toEqual([])
    expect(checks.length).toBeGreaterThanOrEqual(12)
  })

  test('the report carries the status, the protocol and the ids the spec names (§5.8, S5-D64)', () => {
    expect(report.fitStatus).toBe('adopted by the build on 2026-10-18, unsigned')
    expect(FIT_STATUS).toBe(report.fitStatus)
    expect(TABLE_FIT_STATUS).toBe(report.fitStatus)
    expect(report.protocol).toEqual({ id: protocol.id, version: 1, sha256: protocolSha256() })
    expect(report.physId).toBe(PHYS_ID)
    expect(PHYS_ID).toMatch(/^v2-[0-9a-z]+$/)
    expect(report.engineRev).toBe(ENGINE_V2_REV)
    expect(report.rows.map((r) => r.key)).toEqual(protocol.rows.map((r) => r.key))
    expect(report.workedExamples.map((w) => w.id)).toEqual(['41187', '40518'])
  })

  test('every row of the table is a calibrated fit with the figures an H4 label prints, per metric (S5-D58)', () => {
    expect(PHYSICS_ROWS.map((r) => r.key)).toEqual(protocol.rows.map((r) => r.key))
    for (const row of PHYSICS_ROWS) {
      const r = rowOf(report, row.key)
      expect(row.status).toBe(r.status)
      expect(row.eligible).toEqual(r.eligible)
      // TPOT {p90, n} from G1; TTFT {mean, p90, n} from G3's population (F's 8,192-token points)
      expect(row.label.tpot).toEqual({ p90: r.stats.g1.p90, n: r.stats.g1.n })
      expect(row.label.ttft).toEqual({ mean: r.stats.g3.mean, p90: r.stats.g3.p90, n: r.stats.g3.n })
      expect(row.label.tpot.n).toBe(r.nFit)
      expect(row.box.batchTokens).toBe(8192)
      expect(row.harnessMs).toBe(r.params.harnessMs)
    }
    expect(PHYSICS_ROWS.find((r) => r.key === 'b200-vllm-0-10-2-nvfp4')?.box.tp).toEqual([1, 2, 4])
  })

  test('IX_INBOX holds the measured TPOT of each in-box F point, cited by id (H2)', () => {
    const p = IX_INBOX['h100-vllm-0-10-2-fp8'].find((x) => x.id === '41187')
    expect(p).toEqual({ id: '41187', tp: 4, conc: 4, isl: 1024, osl: 1024, tpot: 0.011776147370379336 })
    // NVFP4 is boxed to TP 1-4: no TP 8 option
    expect(IX_INBOX['b200-vllm-0-10-2-nvfp4'].every((x) => x.tp <= 4)).toBe(true)
    for (const row of PHYSICS_ROWS) expect(IX_INBOX[row.key].every((x) => row.box.tp.includes(x.tp) && [4, 16, 64].includes(x.conc))).toBe(true)
  })

  test('the input claims are the ones the fit read, with their values and verifiedAt', () => {
    expect(INPUT_CLAIMS.map((c) => c.id)).toEqual(inputClaimIds(protocol))
    expect(INPUT_CLAIMS.map((c) => c.id)).toContain('bench.inferencex.llama70b-2025-10-29')
    for (const c of INPUT_CLAIMS) expect(c.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('the worked examples (S5-D59, §3.6, §3.7)', () => {
  const [a, b] = report.workedExamples

  test('example A, id 41187: the loads and the napkin figure of §3.6, the card beside them', () => {
    expect(a.row).toBe('h100-vllm-0-10-2-fp8')
    expect(a.load).toEqual({ seqs: 4, tokens: 4, kvTokens: 5529, attnPairs: 5529 })
    // the napkin, from the claims: (70.55e9 + 163,840 x 5,529) / 4 / 3.35e12, memory-bound
    const memBytes = (70.55e9 + 163840 * 5529) / 4
    expect(a.napkin.memBytes).toBe(memBytes)
    expect(a.napkin.bound).toBe('mem')
    expect(a.napkinMs).toBeCloseTo((memBytes / 3.35e12) * 1e3, 9)
    expect(a.napkinMs).toBeCloseTo(5.33, 2)
    expect(a.error.napkin).toBeCloseTo(-0.547, 3)
    expect(a.v1Ms).toBe(50)
    expect(a.error.v1).toBeCloseTo(3.246, 3)
    expect(a.measuredMs).toBeCloseTo(11.776147370379336, 9)
    expect(a.metric).toBe('tpot')
    expect(a.harnessMs).toBe(0)
    expect(a.measuredClaim).toBe('bench.ix-l70.h100-vllm-0-10-2-fp8.tp4.1024-1024.c4.tpot')
    expect(a.runUrl).toBe('https://github.com/SemiAnalysisAI/InferenceX/actions/runs/18924448230/attempts/2')
    // the fitted card, through the table's own parameters
    expect(a.card.us).toBe(Math.round(a.card.stepS * 1e6))
    expect(a.cardMs).toBe(a.card.us / 1e3)
    expect(Math.abs(a.error.card)).toBeLessThan(0.1)
    expect(a.card.bound).toBe('mem')
  })

  test('example B, id 40518: the loads and the napkin figure of §3.7, the card plus the harness term beside them', () => {
    expect(b.row).toBe('b200-vllm-0-10-2-fp8')
    expect(b.load).toEqual({ seqs: 4, tokens: 7376, kvTokens: 30875, attnPairs: 27207753 })
    expect(b.napkin.flops).toBe((2 * 70.55e9 * 7376 + 4 * 80 * 8192 * 27207753) / 1)
    expect(b.napkin.bound).toBe('flop')
    expect(b.napkinMs).toBeCloseTo(247.13, 2)
    expect(b.error.napkin).toBeCloseTo(-0.622, 3)
    // v1: ceil(7,373 / 128) - 1 = 57 ticks of 50 ms
    expect(b.v1Ms).toBe(2850)
    expect(b.metric).toBe('ttft')
    expect(b.measuredMs).toBeCloseTo(654.017546446994, 9)
    expect(b.harnessMs).toBe(rowOf(report, b.row).params.harnessMs)
    expect(b.cardPlusHarnessMs).toBe(b.cardMs + b.harnessMs)
    expect(b.error.cardPlusHarness).toBe(b.cardPlusHarnessMs / b.measuredMs - 1)
    expect(b.measuredClaim).toBe('bench.ix-l70.b200-vllm-0-10-2-fp8.tp1.8192-1024.c4.ttft-median')
    expect(b.card.bound).toBe('flop')
  })

  test('both measured values are the claims the registry holds (the tab chips them)', () => {
    for (const w of report.workedExamples) expect(getClaim(w.measuredClaim).value).toBe(w.measuredMs / 1e3)
  })
})

describe('the phys.* claims (§4.5, S5-D18, S5-D56)', () => {
  const physClaims = ALL_CLAIMS.filter((c) => c.id.startsWith('phys.') && !/^phys\.(finding|control|nim)\.|\.frontier-sep-p90$/.test(c.id))

  test('18 parameters and 18 gate statistics, each carrying the report\'s value and reproduced by verify:claims', () => {
    expect(physClaims.length).toBe(36)
    const params = physClaims.filter((c) => (PARAM_CLAIMS as readonly string[]).some((n) => c.id.endsWith(`.${n}`)))
    const stats = physClaims.filter((c) => (STAT_CLAIMS as readonly string[]).some((n) => c.id.endsWith(`.${n}`)))
    expect([params.length, stats.length]).toEqual([18, 18])
    for (const c of physClaims) expect(c.value).toBe(report.claimValues[c.id])
    expect(physProblems(physClaims, { 'report.json': report })).toEqual([])
  })

  test('verify:claims fails a phys.* claim that drifts from the report, or that the report does not carry', () => {
    const claim = physClaims[0]
    const drifted = clone(report)
    drifted.claimValues[claim.id] = (report.claimValues[claim.id] as number) * 1.01
    expect(physProblems([claim], { 'report.json': drifted })[0]).toMatch(/drift/)
    const missing = clone(report)
    delete missing.claimValues[claim.id]
    expect(physProblems([claim], { 'report.json': missing })[0]).toMatch(/no reproducer/)
  })

  test('every parameter claim\'s boundary says the split is this fit\'s, not a hardware fact (S5-D56), and the fit status travels (S5-D64)', () => {
    for (const row of protocol.rows) {
      for (const n of PARAM_CLAIMS) {
        const c = getClaim(physClaimId(row.key, n))
        expect(c.boundary).toContain("this fit's split of one snapshot; not a hardware fact; other equally good forms split it differently")
        expect(c.boundary).toContain('adopted by the build on 2026-10-18, unsigned')
        expect(c.kind).toBe('derived')
        expect(c.derived?.from).toContain('bench.inferencex.llama70b-2025-10-29')
      }
      for (const n of STAT_CLAIMS) {
        expect(getClaim(physClaimId(row.key, n)).unit).toBe('%')
        expect(getClaim(physClaimId(row.key, n)).boundary).toContain('adopted by the build on 2026-10-18, unsigned')
      }
    }
    expect(claimTextProblems(physClaims)).toEqual([])
    const stripped = physClaims.map((c) => ({ id: c.id, boundary: (c.boundary ?? '').replace(SPLIT_CAVEAT, 'nothing') }))
    expect(claimTextProblems(stripped).length).toBe(18)
  })

  test('the counts in the boundary text are the report\'s (n_F, n_H, G3\'s 8k points)', () => {
    for (const r of report.rows) {
      expect(getClaim(physClaimId(r.key, 'loo-tpot-mean')).boundary).toContain(`over the ${r.nFit} fit points`)
      expect(getClaim(physClaimId(r.key, 'heldout-tpot-mean')).boundary).toContain(`over the ${r.nHeldOut} held-out points`)
      expect(getClaim(physClaimId(r.key, 'loo-ttft8k-mean')).boundary).toContain(`over the ${r.stats.g3.n} fit points with 8,192-token prompts`)
    }
  })

  test('claimValues is what the rows give at the claim rounding, and a tampered one is caught', () => {
    expect(claimValueProblems(report)).toEqual([])
    const bad = clone(report)
    bad.claimValues[physClaimId(bad.rows[0].key, 'eta-mem')] = 0.5
    expect(claimValueProblems(bad).length).toBe(1)
    expect(claimValuesOf(report.rows[0])[physClaimId(report.rows[0].key, 'loo-tpot-p90')]).toBe(Math.round(report.rows[0].stats.g1.p90 * 1000) / 10)
  })
})

describe('the protocol check (S5-D63)', () => {
  const history = readProtocolHistory()
  const sha = protocolSha256()
  const base = { markdown, protocol, sha256: sha, history, report }

  test('the committed protocol, history and report agree', () => {
    expect(protocolProblems(base)).toEqual([])
    expect(history[history.length - 1].sha256).toBe(sha)
  })

  test('a protocol whose sha256 is not the last history entry\'s fails', () => {
    const edited = protocolProblems({ ...base, sha256: 'f'.repeat(64) })
    expect(edited.some((p) => /last history entry/.test(p))).toBe(true)
    const stale: HistoryEntry[] = history.map((e, i) => (i === history.length - 1 ? { ...e, sha256: '0'.repeat(64) } : e))
    expect(protocolProblems({ ...base, history: stale }).some((p) => /last history entry/.test(p))).toBe(true)
  })

  test('a protocol whose sha256 differs from the report\'s fails: it changed after the verdict', () => {
    const r = clone(report)
    r.protocol.sha256 = '1'.repeat(64)
    const problems = protocolProblems({ ...base, report: r })
    expect(problems.some((p) => /changed after the verdict/.test(p))).toBe(true)
  })

  test('a block version that differs from the last history entry\'s fails, and so does the report\'s', () => {
    const v2 = { ...protocol, version: 2 }
    expect(protocolProblems({ ...base, protocol: v2 }).some((p) => /block's version is 2/.test(p))).toBe(true)
    const r = clone(report)
    r.protocol.version = 3
    expect(protocolProblems({ ...base, report: r }).some((p) => /protocol version 3/.test(p))).toBe(true)
  })

  test('a history entry after version 1 needs a matching dated heading under the Amendments', () => {
    const v2: HistoryEntry[] = [...history, { version: 2, date: '2026-11-02', sha256: 'a'.repeat(64) }]
    expect(amendmentProblems(markdown, v2)[0]).toMatch(/no dated heading "### 2026-11-02"/)
    const amended = markdown.replace(
      /## 10\. Amendments\n\nNone\./,
      '## 10. Amendments\n\n### 2026-11-02\n\nThe held-out set moved to concurrency 8, 32 and 48 because a fixture says so.\n\nNone.',
    )
    expect(amended).not.toBe(markdown)
    expect(amendmentProblems(amended, v2)).toEqual([])
    // the heading must be under Amendments, not elsewhere in the file
    const elsewhere = markdown.replace('## 9. Selection disclosure\n', '## 9. Selection disclosure\n\n### 2026-11-02\n')
    expect(amendmentProblems(elsewhere, v2).length).toBe(1)
    // version 1 alone needs none
    expect(amendmentProblems(markdown, history)).toEqual([])
    expect(amendmentsSection(markdown)).toContain('None.')
  })

  test('two entries of one day need two headings', () => {
    const two: HistoryEntry[] = [
      ...history,
      { version: 2, date: '2026-11-02', sha256: 'a'.repeat(64) },
      { version: 3, date: '2026-11-02', sha256: 'b'.repeat(64) },
    ]
    const one = markdown.replace(/## 10\. Amendments\n\nNone\./, '## 10. Amendments\n\n### 2026-11-02\n\nOne.')
    expect(amendmentProblems(one, two).length).toBe(1)
    const both = markdown.replace(/## 10\. Amendments\n\nNone\./, '## 10. Amendments\n\n### 2026-11-02\n\nOne.\n\n### 2026-11-02 (second)\n\nTwo.')
    expect(amendmentProblems(both, two)).toEqual([])
  })
})

describe('drift: a moved claim, a tampered hash or id, a changed engine (§5.2)', () => {
  const { rows: extract, sha256 } = loadExtract()

  test('an input claim that moved since the fit is "re-fit needed", never a silent re-grade', () => {
    expect(inputProblems(table, protocol, current)).toEqual([])
    const moved = (id: string): InputClaim | undefined => {
      const c = current(id)
      return id === 'hw.h100-sxm.hbm-bw' ? { ...c, value: 3.9 } : c
    }
    const problems = inputProblems(table, protocol, moved)
    expect(problems.length).toBe(1)
    expect(problems[0]).toMatch(/hw\.h100-sxm\.hbm-bw moved.*re-fit needed/)
    const reverified = (id: string): InputClaim => ({ ...current(id), verifiedAt: '2027-01-01' })
    expect(inputProblems(table, protocol, reverified).length).toBe(INPUT_CLAIMS.length)
    expect(inputProblems(table, protocol, () => undefined)[0]).toMatch(/is gone/)
    const fewer: TableData = { ...table, INPUT_CLAIMS: INPUT_CLAIMS.slice(1) }
    expect(inputProblems(fewer, protocol, current)[0]).toMatch(/lists input claims/)
  })

  test('the input hash and PHYS_ID recompute; a tampered table, a changed input or another engine rev fails', () => {
    expect(hashProblems(table, report, sha256)).toEqual([])
    expect(table.PHYS_ID).toBe(report.physId)
    expect(hashProblems({ ...table, INPUT_HASH: '0'.repeat(64) }, report, sha256).length).toBeGreaterThan(0)
    expect(hashProblems({ ...table, PHYS_ID: 'v2-zzzz' }, report, sha256).length).toBeGreaterThan(0)
    const edited = clone(table)
    ;(edited.PHYSICS_ROWS as CalibratedRow[])[0].spec.params.etaMem = 0.5
    expect(hashProblems(edited, report, sha256).some((p) => /PHYS_ID/.test(p))).toBe(true)
    expect(hashProblems(table, report, sha256, 'ev2-2').some((p) => /engine/.test(p))).toBe(true)
    expect(hashProblems(table, report, 'e'.repeat(64)).some((p) => /INPUT_HASH/.test(p))).toBe(true)
    // a changed input claim value changes the hash
    const claims = INPUT_CLAIMS.map((c) => (c.id === 'model.llama3-70b.params' ? { ...c, value: 71 } : c))
    expect(inputHashOf(sha256, claims)).not.toBe(table.INPUT_HASH)
    expect(inputHashOf(sha256, INPUT_CLAIMS)).toBe(table.INPUT_HASH)
    // the status line must read "adopted by the build ... unsigned" until the owner signs
    expect(hashProblems({ ...table, FIT_STATUS: 'signed by the owner' }, report, sha256).length).toBe(2)
  })

  test('the snapshot: the extract, the raw response and the NIM extract are held to the claim, the protocol and the report', () => {
    const boundary = getClaim('bench.inferencex.llama70b-2025-10-29').boundary ?? ''
    const nim = { sha256: NIM_SHA256, bytes: NIM_BYTES, rows: NIM_ROWS }
    expect(snapshotProblems({ extractSha256: sha256, datasetBoundary: boundary, protocol, report, nim })).toEqual([])
    expect(snapshotProblems({ extractSha256: 'c'.repeat(64), datasetBoundary: boundary, protocol, report, nim }).length).toBe(2)
    expect(snapshotProblems({ extractSha256: sha256, datasetBoundary: 'no shas here', protocol, report, nim }).length).toBe(2)
    expect(snapshotProblems({ extractSha256: sha256, datasetBoundary: boundary, protocol, report, nim: { ...nim, sha256: 'd'.repeat(64) } }).length).toBe(2)
    expect(snapshotProblems({ extractSha256: sha256, datasetBoundary: boundary, protocol, report, nim: { ...nim, rows: 477 } }).length).toBe(1)
  })

  test('the table\'s rows are held to the report, the protocol and the chips and models the claims build', () => {
    const shapes = (key: string) => rowShapes(protocol, protocol.rows.find((r) => r.key === key) ?? protocol.rows[0])
    expect(rowProblems({ table, report, protocol, shapes })).toEqual([])
    const bad = clone(table)
    const rows = bad.PHYSICS_ROWS as CalibratedRow[]
    rows[1].spec.chip.bwBps = 7e12
    rows[2].status = 'failed'
    rows[0].spec.params.layerUs += 1
    const problems = rowProblems({ table: bad, report, protocol, shapes })
    expect(problems.some((p) => /chip/.test(p))).toBe(true)
    expect(problems.some((p) => /table\.ts says failed/.test(p))).toBe(true)
    expect(problems.some((p) => /parameters differ/.test(p))).toBe(true)
  })

  test('IX_INBOX is the extract\'s in-box F points', () => {
    const { rows: extract2 } = loadExtract()
    const sel = selectPoints(protocol, extract2)
    expect(inboxProblems(table, sel)).toEqual([])
    const bad = clone(table)
    ;(bad.IX_INBOX['h100-vllm-0-10-2-fp8'] as unknown as { tpot: number }[])[0].tpot += 1e-3
    expect(inboxProblems(bad, sel).length).toBe(1)
    expect(extract.length).toBe(285)
  })
})

describe('the verdict: G1-G5 of a calibrated row (§5.4, §5.7)', () => {
  test('the committed rows are consistent', () => {
    expect(gateProblems(report, protocol)).toEqual([])
  })

  test('a calibrated row whose G1 fails is a build failure', () => {
    const bad = clone(report)
    const r = rowOf(bad, 'h100-vllm-0-10-2-fp8')
    r.stats.g1.mean = 0.12
    r.gates.G1.ok = false
    const problems = gateProblems(bad, protocol)
    expect(problems.some((p) => /h100-vllm-0-10-2-fp8 is marked calibrated but G1 fails/.test(p))).toBe(true)
  })

  test.each<[string, (r: Report['rows'][number]) => void]>([
    ['G2', (r: Report['rows'][number]) => { r.stats.g2.p90 = 0.2; r.gates.G2.ok = false }],
    ['G4', (r: Report['rows'][number]) => { r.params.etaMem = 0.97; r.gates.G4.ok = false }],
    ['G5', (r: Report['rows'][number]) => { for (const p of r.points) if (p.subset === 'F') p.conc = 4; r.gates.G5.ok = false }],
  ])('a calibrated row whose %s fails is a build failure', (gate, mutate) => {
    const bad = clone(report)
    mutate(rowOf(bad, 'b200-vllm-0-10-2-fp8'))
    expect(gateProblems(bad, protocol).some((p) => p.includes(`marked calibrated but ${gate} fails`) || p.includes(`says ${gate} passes`))).toBe(true)
  })

  test('a stated gate flag that its own figures contradict is caught, in both directions', () => {
    const lie = clone(report)
    rowOf(lie, 'b200-vllm-0-10-2-nvfp4').gates.G1.ok = false
    expect(gateProblems(lie, protocol).some((p) => /says G1 fails, its own figures say pass/.test(p))).toBe(true)
    const lie2 = clone(report)
    const r = rowOf(lie2, 'b200-vllm-0-10-2-nvfp4')
    r.stats.g1.p90 = 0.2
    expect(gateProblems(lie2, protocol).some((p) => /says G1 passes, its own figures say fail/.test(p))).toBe(true)
  })

  test('a failed row stays visible: it must fail a gate, and loses both eligibilities', () => {
    const failed = clone(report)
    const r = rowOf(failed, 'h100-vllm-0-10-2-fp8')
    r.status = 'failed'
    expect(gateProblems(failed, protocol).some((p) => /marked failed but G1, G2, G4 and G5 all pass/.test(p))).toBe(true)
    r.stats.g1.mean = 0.2
    r.gates.G1.ok = false
    r.eligible = { tpot: false, ttft: false }
    r.ttftEligible = false
    expect(gateProblems(failed, protocol)).toEqual([])
  })

  test('TTFT eligibility needs G3 as well as the verdict', () => {
    const bad = clone(report)
    const r = rowOf(bad, 'b200-vllm-0-10-2-nvfp4')
    r.stats.g3.mean = 0.16
    r.gates.G3.ok = false
    expect(gateProblems(bad, protocol).some((p) => /TTFT eligibility true should be false/.test(p))).toBe(true)
    r.eligible.ttft = false
    r.ttftEligible = false
    expect(gateProblems(bad, protocol)).toEqual([])
  })
})

describe('the consumer contract (S5-D54)', () => {
  const rows = PHYSICS_ROWS
  const ok: PhysicsConsumer = { id: 'step/decode-ms', rows: ['h100-vllm-0-10-2-fp8'], metric: 'tpot' }

  test('an eligible consumer passes; the table\'s own rows serve both metrics', () => {
    expect(checkEligibility([ok, { id: 'x', rows: rows.map((r) => r.key), metric: 'ttft' }], rows, PHYS_ID)).toEqual([])
  })

  test('a row that is not in the table, a failed row, an ineligible metric, no row, a bad metric and a stale PHYS_ID each fail', () => {
    const failed = clone([...rows]) as CalibratedRow[]
    failed[1].status = 'failed'
    failed[1].eligible = { tpot: false, ttft: false }
    failed[2].eligible = { tpot: true, ttft: false }
    expect(checkEligibility([{ id: 'a', rows: ['h200'], metric: 'tpot' }], rows)[0]).toMatch(/a: names row h200, which is not in the table/)
    expect(checkEligibility([{ id: 'b', rows: [failed[1].key], metric: 'tpot' }], failed)[0]).toMatch(/b: names row b200-vllm-0-10-2-fp8, which is failed/)
    expect(checkEligibility([{ id: 'c', rows: [failed[2].key], metric: 'ttft' }], failed)[0]).toMatch(/c: reads ttft on row b200-vllm-0-10-2-nvfp4, which is not eligible for ttft/)
    expect(checkEligibility([{ id: 'c2', rows: [failed[2].key], metric: 'tpot' }], failed)).toEqual([])
    expect(checkEligibility([{ id: 'd', rows: [], metric: 'tpot' }], rows)[0]).toMatch(/d: names no row/)
    expect(checkEligibility([{ id: 'e', rows: [rows[0].key], metric: 'itl' as 'tpot' }], rows)[0]).toMatch(/e: metric "itl"/)
    expect(checkEligibility([{ ...ok, id: 'f', phys: 'v2-old' }], rows, PHYS_ID)[0]).toMatch(/f: was banded on v2-old/)
    expect(checkEligibility([{ ...ok, id: 'g', phys: 'v2-old' }], rows)).toEqual([])
  })

  test('collectConsumers reads FLEET_EXERCISES entries with a phys key, duck-typed (§6.5)', () => {
    const exercises = {
      knee: { id: 'knee', title: 'a v1 def has no phys key' },
      frontier: { id: 'frontier', phys: PHYS_ID, rows: ['h100-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-fp8'], metric: 'tpot' },
      broken: { id: 'broken', phys: PHYS_ID, rows: 'not an array', metric: 'tpot' },
    }
    const found = exerciseConsumers(exercises)
    expect(found.map((c) => c.id)).toEqual(['fleet-ex/broken', 'fleet-ex/frontier'])
    expect(found[1]).toEqual({ id: 'fleet-ex/frontier', rows: ['h100-vllm-0-10-2-fp8', 'b200-vllm-0-10-2-fp8'], metric: 'tpot', phys: PHYS_ID })
    expect(checkEligibility(found, rows, PHYS_ID).map((p) => p.split(':')[0])).toEqual(['fleet-ex/broken'])
  })

  test('collectConsumers reads each items family\'s optional PHYSICS_CONSUMERS export', () => {
    expect(familyConsumers('roofline', { default: {} })).toEqual([])
    const mod = { PHYSICS_CONSUMERS: [{ id: 'step/quant-speedup', rows: ['b200-vllm-0-10-2-nvfp4'], metric: 'tpot' }] }
    expect(familyConsumers('step', mod)).toEqual([{ id: 'step/quant-speedup', rows: ['b200-vllm-0-10-2-nvfp4'], metric: 'tpot', phys: undefined }])
    expect(() => familyConsumers('step', { PHYSICS_CONSUMERS: 'x' })).toThrow(/not an array/)
    expect(() => familyConsumers('step', { PHYSICS_CONSUMERS: [{}] })).toThrow(/no id/)
    // a calibrated variant on a failed or ineligible row is rejected through the same contract
    const ttftOnly = { PHYSICS_CONSUMERS: [{ id: 'step/prefill-ms', rows: ['h100-vllm-0-10-2-fp8'], metric: 'ttft' }] }
    const ineligible = clone([...rows]) as CalibratedRow[]
    ineligible[0].eligible = { tpot: true, ttft: false }
    expect(checkEligibility(familyConsumers('step', ttftOnly), ineligible).length).toBe(1)
  })

  test('the repository\'s own consumers (none before S5-12 and S5-14) are all eligible', async () => {
    const found = await collectConsumers()
    expect(checkEligibility(found, rows, PHYS_ID)).toEqual([])
  })
})

describe('consistency of EngineV2 with the written table (§5.6, S5-D14)', () => {
  const protocolRows = protocol.rows
  const { rows: extract } = loadExtract()
  const sel = selectPoints(protocol, extract)
  const settings = replaySettings(protocol)

  test('three configurations per row agree within the rounding of the integer-µs clock', () => {
    const runs = runConsistency(protocol, sel, PHYSICS_ROWS, settings)
    expect(runs.length).toBe(3 * protocolRows.length)
    expect(consistencyProblems(runs, protocol)).toEqual([])
    for (const r of runs) {
      expect(Math.abs(r.tpotDeltaUs)).toBeLessThanOrEqual(protocol.consistency.tpotMaxAbsUs)
      expect(Math.abs(r.ttftDeltaUs)).toBeLessThanOrEqual(r.ttftBoundUs)
    }
  })

  test('a table the engine will not run (a box that excludes the configuration) fails, and so does a difference above the bound', () => {
    const narrow = clone([...PHYSICS_ROWS]) as CalibratedRow[]
    narrow[0].box.tp = [8]
    const runs = runConsistency(protocol, sel.slice(0, 1), narrow, settings)
    expect(runs.some((r) => r.error !== '')).toBe(true)
    expect(consistencyProblems(runs, protocol).some((p) => /would not run the written table/.test(p))).toBe(true)
    const off: ConsistencyRun = { row: 'r', id: '1', tp: 1, conc: 4, isl: 1024, osl: 1024, tpotDeltaUs: 0.6, ttftDeltaUs: 0.4, ttftBoundUs: 1, error: '' }
    const problems = consistencyProblems([off, off, { ...off, ttftDeltaUs: 2 }], protocol)
    expect(problems.filter((p) => /mean TPOT differs/.test(p)).length).toBe(3)
    expect(problems.filter((p) => /median TTFT differs/.test(p)).length).toBe(1)
    expect(consistencyProblems([off], protocol).some((p) => /1 consistency configurations/.test(p))).toBe(true)
  })
})

describe('the report\'s schema', () => {
  test('the committed report passes, and a missing or malformed field is named', () => {
    expect(reportProblems(report, protocol)).toEqual([])
    const bad = clone(report) as unknown as Record<string, unknown>
    delete bad.fitStatus
    expect(reportProblems(bad, protocol)[0]).toMatch(/fitStatus/)
    const rows = clone(report)
    rows.rows[0].points[0].runUrl = ''
    expect(reportProblems(rows, protocol).some((p) => /per-point record with a run_url/.test(p))).toBe(true)
    const nogate = clone(report) as unknown as { rows: { gates: Record<string, unknown> }[] }
    delete nogate.rows[1].gates.G3
    expect(reportProblems(nogate, protocol).some((p) => /gates\.G3/.test(p))).toBe(true)
    const claims = clone(report)
    delete claims.claimValues[physClaimId(claims.rows[0].key, 'eta-flop')]
    expect(reportProblems(claims, protocol).some((p) => /claimValues holds 35 ids/.test(p))).toBe(true)
    expect(reportProblems(null, protocol)).toEqual(['report.json is not an object'])
  })

  test('the stored per-point tables carry a run_url for every point and the worst three F points', () => {
    for (const r of report.rows) {
      expect(r.points.length).toBe(r.nFit + r.nHeldOut)
      expect(r.points.every((p) => p.runUrl.startsWith('https://github.com/SemiAnalysisAI/InferenceX/actions/runs/'))).toBe(true)
      expect(r.r1.worst.length).toBe(3)
      const f = r.points.filter((p) => p.subset === 'F')
      const top = [...f].sort((a, b) => b.tpotError - a.tpotError || a.id.localeCompare(b.id)).slice(0, 3).map((p) => p.id)
      expect(r.r1.worst.map((w) => w.id)).toEqual(top)
      expect(r.dropped.length).toBe(r.selected - r.kept)
    }
  })

  test('the verdict the PR states: all three rows calibrated, TTFT eligible, the dropped ids as the protocol expects', () => {
    expect(report.rows.map((r) => [r.key, r.status, r.ttftEligible])).toEqual([
      ['h100-vllm-0-10-2-fp8', 'calibrated', true],
      ['b200-vllm-0-10-2-fp8', 'calibrated', true],
      ['b200-vllm-0-10-2-nvfp4', 'calibrated', true],
    ])
    expect(report.rows.flatMap((r) => r.dropped.map((d) => d.id)).sort()).toEqual([...protocol.filters.expectDropped].sort())
    expect(report.rows.map((r) => [r.nFit, r.nHeldOut])).toEqual([[25, 17], [34, 24], [36, 24]])
  })
})

describe('the generated files: one row rendered twice is byte-identical, and the text reads back to what was rendered (§5.2, §5.8)', () => {
  // the h100 row alone (about 5 s): the committed files are held to the whole run by `verify:physics --full` (physics.yml)
  const one = {
    ...protocol,
    rows: [protocol.rows[0]],
    filters: { ...protocol.filters, expectDropped: ['41507', '42070', '44119'] },
  }
  const run = runGate(one)

  test('table.ts and report.json render the same twice, and the report parses to the report that was built', () => {
    expect(renderTable(run)).toBe(renderTable(run))
    const text = renderReport(run)
    expect(text).toBe(renderReport(run))
    expect(text.endsWith('}\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(buildReport(run))))
  }, 60_000)

  test('the rendered table is TypeScript that exports the rows, the id and the inputs it was built from', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'phys-table-'))
    try {
      const file = resolve(dir, 'table.ts')
      writeFileSync(file, renderTable(run))
      const mod = (await import(file)) as TableData & { PHYS_ID: string }
      const rows = tableRows(run)
      expect(mod.PHYSICS_ROWS).toEqual(rows)
      expect(mod.PHYS_ID).toBe(physIdOf(rows))
      expect(mod.FIT_STATUS).toBe('adopted by the build on 2026-10-18, unsigned')
      expect(mod.INPUT_HASH).toBe(inputHashOf(run.extractSha256, mod.INPUT_CLAIMS))
      expect(mod.INPUT_CLAIMS.map((c) => c.id)).toEqual(inputClaimIds(one))
      expect(Object.keys(mod.IX_INBOX)).toEqual([protocol.rows[0].key])
      expect(mod.IX_INBOX[protocol.rows[0].key].length).toBe(run.rows[0].sel.fit.length)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  test('a row that fails a gate is written `failed`, ineligible for both metrics, with its numbers', () => {
    const bad = { ...protocol, gates: { ...protocol.gates, G1: { ...protocol.gates.G1, meanMax: 0.01 } } }
    const failed = runGate({ ...bad, rows: [protocol.rows[1]], filters: { ...protocol.filters, expectDropped: ['40752', '42140'] } })
    const [row] = tableRows(failed)
    expect(row.status).toBe('failed')
    expect(row.eligible).toEqual({ tpot: false, ttft: false })
    expect(row.spec.params.etaMem).toBeGreaterThan(0)
    expect(buildReport(failed).rows[0].status).toBe('failed')
    expect(buildReport(failed).rows[0].gates.G1.ok).toBe(false)
    // the engine refuses it (NotCalibrated) and a consumer naming it is rejected through the contract
    expect(checkEligibility([{ id: 'fixture', rows: [row.key], metric: 'tpot' }], [row])[0]).toMatch(/which is failed/)
  }, 60_000)

  // `PHYSICS_FULL=1 bun test tests/physics/verify-physics.test.ts` runs the whole of `verify:physics --full` (about 22 s on the
  // dev host); CI runs it as `bun run verify:physics --full` in physics.yml, so it is not repeated in the unit suite.
  test.if(process.env.PHYSICS_FULL === '1')('the committed table.ts and report.json are exactly what the whole gate run writes', () => {
    const lines: string[] = []
    const { checks, seconds } = fullChecks((l) => lines.push(l))
    expect(checks.flatMap((c) => c.problems.map((p) => `${c.name}: ${p}`))).toEqual([])
    expect(checks.map((c) => c.name)).toEqual(['table.ts regenerated in memory', 'report.json regenerated in memory', 'G1-G5 of every calibrated row, recomputed'])
    expect(lines.length).toBe(3)
    expect(seconds).toBeLessThan(120)
  }, 180_000)

  test('the two worked-example loads are the spec\'s (§3.6, §3.7), independently of the generator', () => {
    const [a, b] = report.workedExamples
    expect([a.load.kvTokens, b.load.tokens, b.load.kvTokens, b.load.attnPairs]).toEqual([5529, 7376, 30875, 27207753])
    expect(stableStringify(a.load)).toBe(stableStringify({ seqs: 4, tokens: 4, kvTokens: 5529, attnPairs: 5529 }))
    // the generator derives them from the lengths: the h100-only run holds example A, with the stored loads and napkin
    const fromRun = workedExamples(run)
    expect(fromRun.map((w) => w.id)).toEqual(['41187'])
    expect(fromRun[0].load).toEqual(a.load)
    expect(fromRun[0].napkin).toEqual(a.napkin)
  }, 60_000)
})
