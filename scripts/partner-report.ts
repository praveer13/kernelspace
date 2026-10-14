/**
 * partner-report: the field gates of Wave 2 (docs/specs/wave-2.md §20.3, §23.2, task 2a-21) over exports
 * partners donated, plus the Wave 1 exit gates G1, G2, G3 and G7 with `--wave1` (docs/specs/wave-1.md §17, C19).
 *
 * Runs locally on files. Nothing is uploaded and nothing is stored. A file is either
 *   - a redacted donation (/me → data ownership → "Donate a redacted export": `kernelspace-donation-<n>.json`),
 *     read with day offsets only, or
 *   - a full export (/me → data ownership → "Export progress"), validated by the ledger's own import parser and stripped of
 *     free text (`explain`, `boot:value`, constructed-response text) before anything is counted.
 * One file per partner: a partner who donated a phone and a laptop export should be merged first (Import →
 * merge, then export once). The report prints the §23 field-gate table with each gate's n, the number of
 * partners behind it and Wilson 95 % intervals on its proportions; a gate with too little data prints
 * "not enough data", never a pass.
 *
 *   bun scripts/partner-report.ts [--json] [--wave1] <file.json>...
 *
 * `--wave1` prints the Wave 1 report instead; it reads lab stages, so it needs full exports.
 */
import { readFileSync } from 'node:fs'
import { cardsContent } from '../src/lib/learner/cards'
import {
  buildFieldReport,
  buildOutcomeReport,
  formatFieldReport,
  formatOutcomeReport,
  stripFreeText,
  type DonatedLedger,
  type PartnerLedger,
} from '../src/lib/learner/outcomes'
import { normalizeWeekPlan } from '../src/lib/learner/planner'
import { isDonationText, ledgerOfDonation, parseDonation } from '../src/lib/learner/redact'
import { placementOf } from '../src/lib/learner/summary'
import { loadTodayContent } from '../src/lib/learner/today'
import { parseImport } from '../src/lib/ledger/codec'

const FLAGS = new Set(['--json', '--wave1'])
const args = process.argv.slice(2)
const json = args.includes('--json')
const wave1 = args.includes('--wave1')
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0 || args.some((a) => a.startsWith('--') && !FLAGS.has(a))) {
  console.error('usage: bun scripts/partner-report.ts [--json] [--wave1] <file.json>...')
  process.exit(2)
}

const ledgers: (DonatedLedger | PartnerLedger)[] = []
const devices = new Set<string>()
let donations = 0
for (const file of files) {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    console.error(`${file}: ${(err as Error).message}`)
    process.exit(2)
  }
  if (isDonationText(text)) {
    if (wave1) {
      console.error(`${file}: a redacted donation has no lab stages or dates, so the Wave 1 report needs a full export`)
      process.exit(2)
    }
    const parsed = parseDonation(text)
    if (!parsed.ok) {
      console.error(`${file}: ${parsed.error}`)
      process.exit(2)
    }
    donations += 1
    ledgers.push(ledgerOfDonation(parsed.donation))
    continue
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
if (wave1) {
  const report = buildOutcomeReport(ledgers as DonatedLedger[], cc)
  console.log(json ? JSON.stringify(report, null, 2) : formatOutcomeReport(report))
} else {
  const report = buildFieldReport(ledgers, cc)
  console.log(json ? JSON.stringify(report, null, 2) : formatFieldReport(report))
  if (donations > 0 && !json) {
    console.log(
      `\n${donations} of ${ledgers.length} ${ledgers.length === 1 ? 'file is a' : 'files are'} redacted ${donations === 1 ? 'donation' : 'donations'}: session minutes count answer time only, and card days are replayed without item nominal times, so F1 and F4 can differ a little from a full export's.`,
    )
  }
}
