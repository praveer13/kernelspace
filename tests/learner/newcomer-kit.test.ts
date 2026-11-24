/**
 * The first-session kit (Wave 1 stage 0, task K1-0): the unsigned pre-registration, the script and the sheet, and the
 * fixture run of the Wave 1 partner report over a synthetic export.
 *
 * The kit watches today's t0.l1, r.l1 and t2.l1, so the prereg must read as UNSIGNED until the owner signs it, and the
 * fixture must stay reproducible: its export carries the marker device name and no learner's data, and the committed
 * report is exactly what `bun scripts/partner-report.ts --wave1` prints over it.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  buildOutcomeReport,
  formatOutcomeReport,
  isPreregSigned,
  stripFreeText,
  type DonatedLedger,
} from '../../src/lib/learner/outcomes'
import { parseImport } from '../../src/lib/ledger/codec'
import { loadTodayContent } from '../../src/lib/learner/today'
import { cardsContent } from '../../src/lib/learner/cards'

const ROOT = path.resolve(import.meta.dir, '../..')
const KIT = path.join(ROOT, 'docs/sessions/newcomer-before')
const PREREG = path.join(ROOT, 'docs/prereg/newcomer-before.md')
const EXPORT = path.join(KIT, 'fixture-export.json')
const REPORT = path.join(KIT, 'report-fixture.txt')
const SCRIPT = path.join(ROOT, 'scripts/partner-report.ts')

const read = (p: string): string => readFileSync(p, 'utf8')

describe('the pre-registration', () => {
  test('the committed draft reads as unsigned, and names the three lessons and the four predictions', () => {
    const text = read(PREREG)
    expect(isPreregSigned(text)).toBe(false)
    expect(text).toContain('Signed: (pending owner)')
    for (const lesson of ['t0.l1', 'r.l1', 't2.l1']) expect(text).toContain(lesson)
    for (const finding of ['L4', 'L5', 'L8', 'O11']) expect(text).toContain(finding)
    // The two signature forms the repository's reader accepts must be described, so the owner knows how to sign.
    expect(text).toContain('Date signed')
    expect(text).toContain('dated amendment')
  })
})

describe('the script and the sheet', () => {
  test('the script numbers its steps and names each lesson and the closing probes', () => {
    const text = read(path.join(KIT, 'script.md'))
    const steps = [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]))
    expect(steps.length).toBeGreaterThanOrEqual(30)
    expect(steps[0]).toBe(1)
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    for (const lesson of ['t0.l1', 'r.l1', 't2.l1']) expect(text).toContain(lesson)
    expect(text).toContain('Closing probes')
    expect(text).toContain('TTFT')
  })

  test('the sheet has a row per scripted step and one column per prediction', () => {
    const script = read(path.join(KIT, 'script.md'))
    const steps = [...script.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]))
    const sheet = read(path.join(KIT, 'sheet.md'))
    const rows = [...sheet.matchAll(/^\| (\d+) \| /gm)].map((m) => Number(m[1]))
    // The sheet groups some steps; every scripted step from 4 to 27 must have a row to write in.
    for (const n of steps.filter((n) => n >= 4 && n <= 27)) expect(rows).toContain(n)
    expect(sheet).toMatch(/^\| Learner \| First step needing help \| Minutes to first answer \| L4 \| L5 \| L8 \| O11 \|/m)
    expect(sheet).toContain('## Other observations')
    for (const finding of ['L4', 'L5', 'L8', 'O11']) expect(sheet).toContain(finding)
  })
})

describe('the fixture export and its report', () => {
  test('the fixture is synthetic and carries no personal or local data', () => {
    const text = read(EXPORT)
    expect(text).toContain('"device":"newcomer-kit-fixture"')
    expect(text).not.toContain('@')
    expect(text).not.toContain('/home/')
    expect(text).not.toContain('/tmp/')
  })

  test('the report over the fixture is exactly the committed report, in-process and through the script', async () => {
    const parsed = parseImport(read(EXPORT))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const stripped = stripFreeText(parsed.file)
    const ledgers: DonatedLedger[] = [{ exportedAt: parsed.file.exportedAt, events: stripped.events }]
    const content = await loadTodayContent()
    const cc = cardsContent({ kcs: content.kcs, lessons: content.lessons, bootKcs: content.bootKcs, resolve: content.resolve })
    const expected = formatOutcomeReport(buildOutcomeReport(ledgers, cc)) + '\n'
    expect(read(REPORT)).toBe(expected)

    const run = spawnSync('bun', [SCRIPT, '--wave1', EXPORT], { encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe(expected)
  })

  test('the report says what the ledger can and cannot give: a Today median, and empty loop gates', () => {
    const text = read(REPORT)
    expect(text).toContain('Wave 1 exit report over 1 export')
    expect(text).toMatch(/G7 {2}Today duration +median 8\.0 min/)
    expect(text).toContain('G1  loop completion   0 of 5 needed')
  })
})
