/**
 * partner-report: the Wave 1 exit gates G1, G2, G3 and G7 over exports partners donated
 * (docs/specs/wave-1.md §17, task C19).
 *
 * Runs locally on export files (Settings → Export progress). Nothing is uploaded and nothing is stored.
 * Each file is validated by the ledger's own import parser, then stripped of free text (`explain`,
 * `boot:value`, constructed-response text) before anything is counted. One export per partner: a partner
 * who donated a phone and a laptop export should be merged first (Import → merge, then export once).
 *
 *   bun scripts/partner-report.ts [--json] <export.json>...
 */
import { readFileSync } from 'node:fs'
import { cardsContent } from '../src/lib/learner/cards'
import { buildOutcomeReport, formatOutcomeReport, stripFreeText, type DonatedLedger } from '../src/lib/learner/outcomes'
import { normalizeWeekPlan } from '../src/lib/learner/planner'
import { placementOf } from '../src/lib/learner/summary'
import { loadTodayContent } from '../src/lib/learner/today'
import { parseImport } from '../src/lib/ledger/codec'

const args = process.argv.slice(2)
const json = args.includes('--json')
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0 || args.some((a) => a.startsWith('--') && a !== '--json')) {
  console.error('usage: bun scripts/partner-report.ts [--json] <export.json>...')
  process.exit(2)
}

const ledgers: DonatedLedger[] = []
const devices = new Set<string>()
for (const file of files) {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    console.error(`${file}: ${(err as Error).message}`)
    process.exit(2)
  }
  const parsed = parseImport(text)
  if (!parsed.ok) {
    console.error(`${file}: ${parsed.error}: ${parsed.detail}`)
    process.exit(2)
  }
  const { events, working } = stripFreeText(parsed.file)
  const record = (key: string) => working.find((r) => r.key === key)?.value
  if (devices.has(parsed.file.device)) console.error(`${file}: this device already appeared in an earlier file; one export per partner keeps the counts honest`)
  devices.add(parsed.file.device)
  ledgers.push({
    exportedAt: parsed.file.exportedAt,
    events,
    plan: normalizeWeekPlan(record('boot:week')),
    placement: placementOf(record('placement:result')),
  })
}

const content = await loadTodayContent()
const cc = cardsContent({ kcs: content.kcs, lessons: content.lessons, bootKcs: content.bootKcs, resolve: content.resolve })
const report = buildOutcomeReport(ledgers, cc)
console.log(json ? JSON.stringify(report, null, 2) : formatOutcomeReport(report))
