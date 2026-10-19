/**
 * partner-report: the field gates of Wave 3 (docs/specs/wave-3.md §15, §18.2, task 3c-03) over exports partners
 * donated: F1 to F12, the journey re-cut beside PLAN §4.D, and the Fleet Week receipts. With `--wave2` it prints the
 * field gates of Wave 2 (docs/specs/wave-2.md §20.3, §23.2, task 2a-21), and with `--wave1` the Wave 1 exit gates G1,
 * G2, G3 and G7 (docs/specs/wave-1.md §17, C19).
 *
 * Runs locally on files. Nothing is uploaded and nothing is stored. A file is either
 *   - a redacted donation (/me → data ownership → "Donate a redacted export": `kernelspace-donation-<n>.json`),
 *     read with day offsets only, or
 *   - a full export (/me → data ownership → "Export progress"), validated by the ledger's own import parser and stripped of
 *     free text (`explain`, `boot:value`, constructed-response text) before anything is counted.
 * One file per partner: a partner who donated a phone and a laptop export should be merged first (Import →
 * merge, then export once). The report prints the field-gate table with each gate's n, the number of partners behind
 * it and Wilson or bootstrap 95 % intervals; a gate with too little data prints "not enough data", never a pass. The
 * two gates that read a pre-registration (F2 hint ladders, F3 the Fleet Daily) are not read until the owner has signed
 * docs/prereg/hint-ladders.md and docs/prereg/fleet-daily.md, and F4 is §14's rule over the watcher's files.
 *
 *   bun scripts/partner-report.ts [--json] [--wave1 | --wave2 | --after-decision] <file.json>...
 *
 * F2's and F3's secondary outputs hold back every outcome until the decision (each file's §5: no interim looks at
 * outcomes), in the text and in `--json`: until the primary reaches its required n, they print counts, help-seeking
 * measures and each held-back line's n. The owner passes `--after-decision` only once the F2 and F3 decisions are
 * recorded (the underpowered default included), and the report then shows them and says on F2's and F3's rows that it
 * was read after the decision.
 *
 * `--wave1` prints the Wave 1 report instead; it reads lab stages, so it needs full exports.
 */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { forgeBundleIds, loadForgeBundle } from '../src/data/forge'
import { cardsContent } from '../src/lib/learner/cards'
import {
  buildFieldReport,
  buildOutcomeReport,
  buildWave3Report,
  discriminationLures,
  formatFieldReport,
  formatOutcomeReport,
  formatWave3Report,
  isPreregSigned,
  stripFreeText,
  wave3ReportJson,
  type DonatedLedger,
  type PartnerLedger,
  type WatcherState,
} from '../src/lib/learner/outcomes'
import { normalizeWeekPlan } from '../src/lib/learner/planner'
import { isDonationText, ledgerOfDonation, parseDonation } from '../src/lib/learner/redact'
import { placementOf } from '../src/lib/learner/summary'
import { loadTodayContent } from '../src/lib/learner/today'
import { parseImport } from '../src/lib/ledger/codec'

const FLAGS = new Set(['--json', '--wave1', '--wave2', '--after-decision'])
const args = process.argv.slice(2)
const json = args.includes('--json')
const wave1 = args.includes('--wave1')
const wave2 = args.includes('--wave2')
const afterDecision = args.includes('--after-decision')
const files = args.filter((a) => !a.startsWith('--'))
if (files.length === 0 || [wave1, wave2, afterDecision].filter(Boolean).length > 1 || args.some((a) => a.startsWith('--') && !FLAGS.has(a))) {
  console.error('usage: bun scripts/partner-report.ts [--json] [--wave1 | --wave2 | --after-decision] <file.json>...')
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
/** A file of the repo, or '' when it is not there. */
const repoText = (path: string): string => {
  const file = fileURLToPath(new URL(`../${path}`, import.meta.url))
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

/** §14's rule over the watcher's files: signed pre-registration, an independent rating, and the report the scorer wrote. */
function watcherState(): WatcherState {
  if (!isPreregSigned(repoText('docs/prereg/watcher.md'))) return 'unsigned'
  const report = repoText('docs/backtest/report.json')
  if (repoText('docs/backtest/ratings.json') === '' || report === '') return 'unrated'
  try {
    const outcome = (JSON.parse(report) as { verdict?: { outcome?: unknown } }).verdict?.outcome
    return outcome === 'keep' || outcome === 'drop' || outcome === 'underpowered' ? outcome : 'unrated'
  } catch {
    return 'unrated'
  }
}

const donationNote = (about: string): string =>
  `\n${donations} of ${ledgers.length} ${ledgers.length === 1 ? 'file' : 'files'} ${donations === 1 ? 'is a redacted donation' : 'are redacted donations'}: ${about}`

if (wave1) {
  const report = buildOutcomeReport(ledgers as DonatedLedger[], cc)
  console.log(json ? JSON.stringify(report, null, 2) : formatOutcomeReport(report))
} else if (wave2) {
  const report = buildFieldReport(ledgers, cc)
  console.log(json ? JSON.stringify(report, null, 2) : formatFieldReport(report))
  if (donations > 0 && !json) {
    console.log(donationNote("session minutes count answer time only, and card days are replayed without item nominal times, so F1 and F4 can differ a little from a full export's."))
  }
} else {
  const v2Labs = new Set<string>()
  for (const id of await forgeBundleIds()) if ((await loadForgeBundle(id)).prove2) v2Labs.add(id)
  const report = buildWave3Report(ledgers, {
    cards: cc,
    lures: discriminationLures(content.lessons),
    v2Labs,
    signed: { hintLadders: isPreregSigned(repoText('docs/prereg/hint-ladders.md')), fleetDaily: isPreregSigned(repoText('docs/prereg/fleet-daily.md')) },
    watcher: watcherState(),
    afterDecision,
  })
  console.log(json ? JSON.stringify(wave3ReportJson(report), null, 2) : formatWave3Report(report))
  if (donations > 0 && !json) {
    console.log(donationNote("Today's session minutes count answer times only, and every time is rounded to a second; it keeps no unit, so F7 leaves out the cube's byte-unit question. F2 reads every ledger from the lab's first all-green run, so a donation and its export agree there."))
  }
}
