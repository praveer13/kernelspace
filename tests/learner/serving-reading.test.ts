/**
 * M2 of docs/specs/serving-reading.md (task SR-08): the pre-registration's draft form, the selector's figures over
 * fixture ledgers, and the partner report's "NOT READ" while docs/prereg/serving-reading.md is unsigned.
 *
 * The fixture is four learners, each built the way the report reads it:
 *   A  a full export on serving-first, through the codec and `stripFreeText` (never hand-built): eligible;
 *   B  a redacted donation, through `redactForPartner`, `parseDonation` and `ledgerOfDonation`: eligible by the off-R proxy;
 *   R  a donation that passed a host lesson and an R lesson: left out by the proxy;
 *   D  a full export on serving-first with no ok host quiz: "not yet at a host", left out of every figure.
 */
import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  buildWave3Report,
  formatServingReading,
  formatWave3Report,
  isPreregSigned,
  selectServingReading,
  servingReadingCounts,
  SERVING_READING_HOSTS,
  SERVING_READING_KCS,
  SERVING_READING_MIN_LEARNERS,
  SERVING_READING_NOT_READ,
  stripFreeText,
  wave3ReportJson,
  type PartnerLedger,
} from '../../src/lib/learner/outcomes'
import { pathOf } from '../../src/lib/learner/paths'
import { ledgerOfDonation, parseDonation, redactForPartner } from '../../src/lib/learner/redact'
import { buildExportV3, parseImport, serializeExport } from '../../src/lib/ledger/codec'
import type { LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { CONTENT } from './ledger-gen'

const PREREG = path.resolve(import.meta.dir, '../../docs/prereg/serving-reading.md')
const SCRIPT = path.resolve(import.meta.dir, '../../scripts/partner-report.ts')

/* ------------------------------------------------------------------ */
/* Fixture events                                                      */
/* ------------------------------------------------------------------ */

let counter = 0
const iso = (day: number, minute: number): string => `2026-09-${String(day).padStart(2, '0')}T10:${String(minute).padStart(2, '0')}:00.000Z`

function ev(kind: string, ref: string, at: string, extra: Record<string, unknown> = {}): LedgerEvent {
  return { id: `e${String(counter++).padStart(6, '0')}`, v: 1, kind, ref, at, tz: 0, day: at.slice(0, 10), dev: 'dev-1', ...extra } as unknown as LedgerEvent
}

const quiz = (at: string, lesson: string, ok = true) => ev('quiz', `lesson:${lesson}`, at, { score: ok ? 1 : 0.4, ok, provenance: 'practice', data: { grp: `q-${lesson}`, n: 5 } })
const visit = (at: string, lesson: string) => ev('visit', `lesson:${lesson}`, at)

interface Answer {
  ok: boolean
  ms: number
  /** `t5.l5#6`: the block's `grp`, `<lessonId>#<blockIndex>`. */
  grp: string
  provenance?: 'unseen' | 'practice'
  miss?: string
  src?: string
}

/** A reading answer as a block writes it (item-block.ts `lessonItemResponse`): ref `gen:compile/<variant>`, `src: 'lesson'`. */
function answer(at: string, variant: string, a: Answer): LedgerEvent {
  const kc = `r.${variant.slice(variant.indexOf('.') + 1)}`
  return ev('item', `gen:compile/${variant}`, at, {
    rev: 'rev-1',
    seed: 7,
    score: a.ok ? 1 : 0,
    ok: a.ok,
    ms: a.ms,
    provenance: a.provenance ?? 'unseen',
    data: { src: a.src ?? 'lesson', grp: a.grp, lessonId: a.grp.split('#')[0], kcs: [kc], nsec: 30, level: 1, variant, ...(a.miss ? { miss: a.miss } : {}) },
  })
}

const VE = 'verdict.enums-option-result'
const FE = 'fix.enums-option-result'
const VI = 'verdict.iterators-ownership'
const FS = 'fix.smart-pointers'
const CLONE = 'r.clone-to-silence'
const B2 = 't5.l5#6'
const B4 = 't5.l7#5'
const B7 = 't6.l9#8'

/** A: B2 (count 3) with 2 correct unseen answers, then B4 (count 2) with 2, a practice answer and a Today answer that is not a block's. */
const eventsA = (): LedgerEvent[] => [
  visit(iso(1, 0), 't5.l5'),
  answer(iso(1, 1), VE, { ok: true, ms: 40_000, grp: B2 }),
  answer(iso(1, 2), FS, { ok: false, ms: 80_000, grp: B2, miss: CLONE }),
  answer(iso(1, 3), VI, { ok: false, ms: 30_000, grp: B2 }),
  answer(iso(1, 4), FE, { ok: true, ms: 70_000, grp: B2 }),
  quiz(iso(1, 5), 't5.l5'),
  answer(iso(2, 1), VE, { ok: false, ms: 50_000, grp: B4 }),
  answer(iso(2, 2), FE, { ok: true, ms: 60_000, grp: B4 }),
  answer(iso(2, 3), VE, { ok: true, ms: 35_000, grp: B4 }),
  answer(iso(2, 4), FE, { ok: true, ms: 90_000, grp: B4, provenance: 'practice' }),
  quiz(iso(2, 5), 't5.l7'),
  // a compile item on a reading ref that no block wrote: not a reading answer
  answer(iso(3, 1), VE, { ok: false, ms: 5_000, grp: 'today-1', src: 'today' }),
]

/** B: B7 (count 2) with 2 correct unseen answers, and a clone pick that a donation keeps no miss for. */
const eventsB = (): LedgerEvent[] => [
  quiz(iso(1, 0), 't0.l1'),
  answer(iso(4, 1), FE, { ok: true, ms: 45_000, grp: B7 }),
  answer(iso(4, 2), VE, { ok: false, ms: 20_000, grp: B7 }),
  answer(iso(4, 3), VE, { ok: true, ms: 25_000, grp: B7 }),
  answer(iso(4, 4), FS, { ok: false, ms: 50_000, grp: B7, miss: CLONE }),
  quiz(iso(4, 5), 't6.l9'),
]

/** R: passed a host lesson and an R lesson, so the off-R proxy leaves the donation out. */
const eventsR = (): LedgerEvent[] => [quiz(iso(1, 0), 'r.l1'), answer(iso(2, 1), VE, { ok: true, ms: 10_000, grp: B2 }), quiz(iso(2, 2), 't5.l5')]

/** D: on serving-first, opened B1 and failed t5.l2's quiz; passed only t0.l1. */
const eventsD = (): LedgerEvent[] => [quiz(iso(1, 0), 't0.l1'), answer(iso(2, 1), VE, { ok: true, ms: 10_000, grp: 't5.l2#3' }), quiz(iso(2, 2), 't5.l2', false)]

const work = (key: string, value: unknown): WorkingRecord => ({ key, value, at: iso(1, 0), dev: 'dev-1' }) as unknown as WorkingRecord

/** A full export as `scripts/partner-report.ts` reads it: the codec's parser, then `stripFreeText`, then the working path. */
function fullExport(events: LedgerEvent[], working: WorkingRecord[]): { ledger: PartnerLedger; stripped: ReturnType<typeof stripFreeText>; text: string } {
  const text = serializeExport(buildExportV3({ events, working, device: `dev-${counter++}`, exportedAt: '2026-10-07T12:00:00.000Z' }))
  const parsed = parseImport(text)
  if (!parsed.ok) throw new Error(`${parsed.error}: ${parsed.detail}`)
  const stripped = stripFreeText(parsed.file)
  const record = (key: string) => stripped.working.find((r) => r.key === key)?.value
  return { ledger: { events: stripped.events, path: pathOf(record('boot:path')) }, stripped, text }
}

/** A donation as the report reads it: redacted, written, parsed back and replayed. */
function donation(events: LedgerEvent[]): { ledger: PartnerLedger; text: string } {
  const text = JSON.stringify(redactForPartner({ events, working: [work('boot:path', 'serving-first')] }))
  const parsed = parseDonation(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return { ledger: ledgerOfDonation(parsed.donation), text }
}

const COUNTS = { 't5.l2': 2, 't5.l5': 3, 't5.l6': 3, 't5.l7': 2, 't5.l10': 2, 't6.l8': 2, 't6.l9': 2 }

function fixture() {
  const a = fullExport(eventsA(), [work('boot:path', 'serving-first'), work('boot:value', 'I want to serve models at work'), work('boot:week', { slo: 0.85 })])
  const b = donation(eventsB())
  const r = donation(eventsR())
  const d = fullExport(eventsD(), [work('boot:path', 'serving-first')])
  return { a, b, r, d, ledgers: [a.ledger, b.ledger, r.ledger, d.ledger] }
}

/* ------------------------------------------------------------------ */
/* The pre-registration                                                */
/* ------------------------------------------------------------------ */

describe('docs/prereg/serving-reading.md', () => {
  const text = readFileSync(PREREG, 'utf8')

  test('is a draft in the form of protege.md: unsigned, and nothing waits on it is read', () => {
    expect(isPreregSigned(text)).toBe(false)
    expect(text).toContain('**Status:** DRAFT for the owner to sign.')
    expect(text).toContain('The drafter has not signed or dated it')
    expect(text).toContain('Signed: (pending owner)')
    expect(text).toContain('| Owner | |')
    expect(text).toContain('| Date signed | |')
    expect(text).toContain('| Amendments | none |')
    expect(text).toContain(SERVING_READING_NOT_READ)
    const sections = [...text.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`)
    expect(sections).toEqual(['1. Question', '2. Design', '3. Outcome', '4. Decision rule', '5. Data and limits', '6. Choices this draft makes for the owner', '7. Sign-off'])
    // the only Signed line is the pending one, so no other line can sign it by accident
    expect(text.match(/^Signed:.*$/gm)).toEqual(['Signed: (pending owner)'])
  })

  test('either signature form alone reads as signed, and a half form does not', () => {
    expect(text).toContain('The owner signs in either of two ways, and either one alone is a signature')
    expect(isPreregSigned(text.replace('Signed: (pending owner)', 'Signed: Someone 2026-11-02'))).toBe(true)
    expect(isPreregSigned(text.replace('| Owner | |', '| Owner | Someone |').replace('| Date signed | |', '| Date signed | 2026-11-02 |'))).toBe(true)
    expect(isPreregSigned(text.replace('Signed: (pending owner)', 'Signed: Someone'))).toBe(false)
    expect(isPreregSigned(text.replace('Signed: (pending owner)', 'Signed: 2026-11-02'))).toBe(false)
    expect(isPreregSigned(text.replace('| Owner | |', '| Owner | Someone |'))).toBe(false)
    expect(isPreregSigned(text.replace('| Date signed | |', '| Date signed | 2026-11-02 |'))).toBe(false)
  })

  test('holds §8 M2: the think-aloud decides, with its rubric and rules; the ledger figures and their thresholds inform', () => {
    for (const part of [
      'at least 2 ML-engineer partners',
      'After the partner has passed t6.l9',
      'Two unseen Rust files of 40 to 60 lines each',
      '15 minutes',
      'What does `alloc` return on an empty pool, and who decides what happens next? (E)',
      'Here `?` fails on the second call. What is undone? (E)',
      'When does this iterator chain run, and what does it borrow? (I)',
      'What does this closure capture, and why must it be `FnMut`? (C)',
      'What does `Arc::clone` cost here? (S)',
      'Why `Arc` and not `Rc` for this handle? (S)',
      '**Go:** every partner scores at least 4 of 6.',
      '**Revise:** more than half of the partners score 2 of 6 or less (with 2 partners, both).',
      '**the default is to keep.**',
      '"Serving-first reading items: think-aloud ≥ 4/6 per ML-engineer partner. Default if underpowered: keep."',
      '| Reach | the share of eligible learners with at least 1 reading answer | ≥ 0.80 |',
      '≥ 0.60',
      'outside 0.35 to 0.85 and n ≥ 20',
      '"not enough data" below 8 learners',
      'verdict ≤ 60 s, fix ≤ 90 s',
      '**full exports only**',
      '"not yet at a host"',
      'no event whose ref starts with `lesson:r.`',
      '`KEPT_WORKING` holds `boot:path`',
    ]) {
      expect(text).toContain(part)
    }
    for (const host of SERVING_READING_HOSTS) expect(text).toContain(`\`lesson:${host}\``)
    for (const kc of SERVING_READING_KCS) expect(text).toContain(`\`${kc}\``)
  })
})

/* ------------------------------------------------------------------ */
/* The literals and stripping                                          */
/* ------------------------------------------------------------------ */

describe('the literals and boot:path', () => {
  test('the four KCs and seven hosts are the spec\'s (§3.3, §5.3); SR-06 holds them to READING_KCS and the mounted blocks', () => {
    expect([...SERVING_READING_KCS]).toEqual(['r.enums-option-result', 'r.iterators-ownership', 'r.closures-collections', 'r.smart-pointers'])
    expect([...SERVING_READING_HOSTS]).toEqual(['t5.l2', 't5.l5', 't5.l6', 't5.l7', 't5.l10', 't6.l8', 't6.l9'])
    expect(SERVING_READING_MIN_LEARNERS).toBe(8)
  })

  test('stripFreeText keeps boot:path while it holds a path id, and still removes boot:value', () => {
    const { a } = fixture()
    expect(a.stripped.working.map((r) => r.key).sort()).toEqual(['boot:path', 'boot:week'])
    expect(a.stripped.removed).toMatchObject({ bootValue: 1, otherWorking: 0 })
    expect(a.ledger.path).toBe('serving-first')
    expect(JSON.stringify(a.stripped)).not.toContain('serve models')
    // a value that is not a path id is free text, so it goes
    const odd = stripFreeText({ events: [], working: [work('boot:path', 'my own words'), work('boot:path', 'rust-systems')] })
    expect(odd.working.map((r) => r.value)).toEqual(['rust-systems'])
    expect(odd.removed.otherWorking).toBe(1)
  })

  test('servingReadingCounts reads each host\'s reading block count from lesson content', () => {
    const lessons = [
      { id: 't5.l5', blocks: [{ type: 'prose' }, { type: 'reading', count: 3 }, { type: 'quiz' }] },
      { id: 't5.l7', blocks: [{ type: 'reading', count: 2 }] },
      { id: 't0.l1', blocks: [{ type: 'item', count: 4 }] },
      { id: 't6.l9', blocks: [{ type: 'reading', count: 0 }] },
    ]
    expect(servingReadingCounts(lessons)).toEqual({ 't5.l5': 3, 't5.l7': 2 })
  })
})

/* ------------------------------------------------------------------ */
/* The selector                                                        */
/* ------------------------------------------------------------------ */

describe('selectServingReading over the four fixture learners', () => {
  test('who is read: one eligible full export and one eligible donation; the R donation and the not-yet learner are counted and left out', () => {
    const r = selectServingReading(fixture().ledgers, COUNTS)
    expect(r.read).toBe(true)
    expect(r.inputs).toEqual({ exports: { files: 2, eligible: 1, notYetAtHost: 1, otherPath: 0 }, donations: { files: 2, eligible: 1, leftOut: 1 } })
    expect([r.pooled.learners, r.exports.learners, r.donations.learners]).toEqual([2, 1, 1])
  })

  test('reach, completion, band, later vs first, time and the clone lure are known figures', () => {
    const r = selectServingReading(fixture().ledgers, COUNTS)
    // reach: both eligible learners answered
    expect(r.pooled.reach).toMatchObject({ correct: 2, n: 2, rate: 1 })
    expect([r.exports.reach.correct, r.exports.reach.n, r.donations.reach.correct, r.donations.reach.n]).toEqual([1, 1, 1, 1])
    // completion: A's B2 holds 2 of its 3, B4 its 2 (the practice answer does not count); B's B7 holds 2 against "≥ 2 correct"
    expect(r.completion.exports).toMatchObject({ correct: 1, n: 2, rate: 0.5 })
    expect(r.completion.donations).toMatchObject({ correct: 1, n: 1, rate: 1 })
    // band: each learner's first unseen answer per variant, in a fixed KC-major order
    const band = Object.fromEntries(r.pooled.band.map((b) => [b.variant, [b.correct, b.n]]))
    expect(r.pooled.band.map((b) => b.variant)).toEqual([
      'verdict.enums-option-result',
      'fix.enums-option-result',
      'verdict.iterators-ownership',
      'fix.iterators-ownership',
      'verdict.closures-collections',
      'fix.closures-collections',
      'verdict.smart-pointers',
      'fix.smart-pointers',
    ])
    expect(band).toEqual({
      [VE]: [1, 2],
      [FE]: [2, 2],
      [VI]: [0, 1],
      'fix.iterators-ownership': [0, 0],
      'verdict.closures-collections': [0, 0],
      'fix.closures-collections': [0, 0],
      'verdict.smart-pointers': [0, 0],
      [FS]: [0, 2],
    })
    expect(r.pooled.band.some((b) => b.flagged)).toBe(false)
    expect(r.pooled.band[0].ci95).not.toBeNull()
    // later vs first: only A has two blocks on a KC (enums: right in B2, wrong first in B4, d = −1); below 8 learners it is not read
    expect(r.pooled.later).toEqual({ learners: 1, enough: false, mean: null })
    // time: every reading answer, by kind; the Today answer is not one
    expect(r.pooled.time.verdict).toEqual({ answers: 6, medianMs: 32_500, within: true })
    expect(r.pooled.time.fix).toEqual({ answers: 6, medianMs: 65_000, within: true })
    expect(r.exports.time.fix).toEqual({ answers: 4, medianMs: 75_000, within: true })
    // clone lure: A's fix answers only; B's clone pick is not in a donation
    expect(r.clone).toMatchObject({ correct: 1, n: 4, rate: 0.25 })
  })

  test('a full export reads its block counts; without them every block is held to 2', () => {
    const { ledgers } = fixture()
    expect(selectServingReading(ledgers).completion.exports).toMatchObject({ correct: 2, n: 2 })
  })

  test('a donation keeps no lessonId and no clone miss, and its grp comes back renumbered in order of first appearance', () => {
    const { b } = fixture()
    const reading = b.ledger.events.filter((e) => e.ref.startsWith('gen:compile/'))
    expect(reading.length).toBe(4)
    for (const e of reading) {
      const data = (e as unknown as { data: Record<string, unknown> }).data
      expect(data.lessonId).toBeUndefined()
      expect(data.miss).toBeUndefined()
      // the t0.l1 quiz's grp came first
      expect(data.grp).toBe('g2')
    }
  })

  test('the R learner and the not-yet learner change no figure', () => {
    const { a, b } = fixture()
    const all = selectServingReading(fixture().ledgers, COUNTS)
    const two = selectServingReading([a.ledger, b.ledger], COUNTS)
    expect({ ...all, inputs: null }).toEqual({ ...two, inputs: null })
  })

  test('a full export on another path is counted and left out', () => {
    const rust = fullExport(eventsA(), [work('boot:path', 'rust-systems')])
    const none = fullExport(eventsA(), [])
    const r = selectServingReading([rust.ledger, none.ledger], COUNTS)
    expect(none.ledger.path).toBe('full-ramp')
    expect(r.inputs.exports).toEqual({ files: 2, eligible: 0, notYetAtHost: 0, otherPath: 2 })
    expect(r.pooled.reach.n).toBe(0)
  })

  test('later vs first says "not enough data" below 8 learners and reads the mean from 8', () => {
    /** A learner wrong first on enums in B2 and right first on it in B4: d = +1. */
    const learner = (): PartnerLedger => ({
      path: 'serving-first',
      events: [quiz(iso(1, 0), 't5.l5'), answer(iso(1, 1), VE, { ok: false, ms: 1_000, grp: B2 }), answer(iso(2, 1), VE, { ok: true, ms: 1_000, grp: B4 }), answer(iso(2, 2), VE, { ok: false, ms: 1_000, grp: B4 })],
    })
    const seven = selectServingReading(Array.from({ length: 7 }, learner), COUNTS)
    expect(seven.pooled.later).toEqual({ learners: 7, enough: false, mean: null })
    expect(formatServingReading(seven).join('\n')).toContain('later vs first: not enough data (n = 7 of 8 learners with 2 or more blocks on a KC)')
    const eight = selectServingReading(Array.from({ length: 8 }, learner), COUNTS)
    expect(eight.pooled.later).toEqual({ learners: 8, enough: true, mean: 1 })
    expect(formatServingReading(eight).join('\n')).toContain('later vs first: mean d +100.0 points over 8 learners')
  })

  test('the grp order is ledger order, never the grp string', () => {
    // t5.l7#5 sorts before t5.l7#9 as a string but comes second here
    const ledger: PartnerLedger = {
      path: 'serving-first',
      events: [quiz(iso(1, 0), 't5.l7'), answer(iso(1, 1), VE, { ok: true, ms: 1_000, grp: 't5.l7#9' }), answer(iso(1, 2), VE, { ok: false, ms: 1_000, grp: B4 })],
    }
    const eight = selectServingReading(Array.from({ length: 8 }, () => ledger), COUNTS)
    expect(eight.pooled.later.mean).toBe(-1)
  })
})

/* ------------------------------------------------------------------ */
/* The report                                                          */
/* ------------------------------------------------------------------ */

describe('the Wave 3 report', () => {
  test('unsigned, it holds NOT READ in its text and its JSON and never calls the selector', () => {
    const r = buildWave3Report(fixture().ledgers, { cards: CONTENT, readingCounts: COUNTS })
    expect(r.servingReading).toEqual({ read: false, note: SERVING_READING_NOT_READ })
    expect(formatWave3Report(r)).toContain(`\n  ${SERVING_READING_NOT_READ}\n`)
    expect((wave3ReportJson(r) as { servingReading: unknown }).servingReading).toEqual({ read: false, note: 'NOT READ: docs/prereg/serving-reading.md is not signed' })
  })

  test('signed, it prints the selector\'s figures', () => {
    const { ledgers } = fixture()
    const r = buildWave3Report(ledgers, { cards: CONTENT, signed: { hintLadders: false, fleetDaily: false, servingReading: true }, readingCounts: COUNTS })
    expect(r.servingReading).toEqual(selectServingReading(ledgers, COUNTS))
    const text = formatWave3Report(r)
    expect(text).not.toContain(SERVING_READING_NOT_READ)
    for (const line of [
      'learners: 2 eligible; full exports 2 (1 eligible, 1 not yet at a host, 0 on another path); donations 2 (1 eligible, 1 left out: no host quiz or an R lesson)',
      'reach: 2 of 2 = 100.0 %',
      'at least 80 %: meets it',
      'full exports 1 of 2 = 50.0 %',
      'below it; donations, ≥ 2 correct, 1 of 1 = 100.0 %',
      '    verdict.enums-option-result: 1 of 2 = 50.0 %',
      '    fix.closures-collections: no answer',
      'later vs first: not enough data (n = 1 of 8 learners with 2 or more blocks on a KC)',
      'time, median per answer: verdict 32.5 s (n = 6; at most 60 s: within), fix 65 s (n = 6; at most 90 s: within)',
      'clone lure, full exports only (a donation keeps no such miss): 1 of 4 fix answers = 25.0 %',
    ]) {
      expect(text).toContain(line)
    }
  })
})

describe('scripts/partner-report.ts', () => {
  const run = (...args: string[]) => spawnSync('bun', [SCRIPT, ...args], { encoding: 'utf8' })

  test('while the committed prereg is unsigned it prints NOT READ for M2, in text and in --json', () => {
    expect(isPreregSigned(readFileSync(PREREG, 'utf8'))).toBe(false)
    const { a, b } = fixture()
    const dir = mkdtempSync(path.join(tmpdir(), 'serving-reading-'))
    try {
      const full = path.join(dir, 'export.json')
      const don = path.join(dir, 'donation.json')
      writeFileSync(full, a.text)
      writeFileSync(don, b.text)
      const text = run(full, don)
      expect(text.status).toBe(0)
      expect(text.stdout).toContain('M2  serving-first Rust reading (docs/prereg/serving-reading.md)')
      expect(text.stdout).toContain(`  ${SERVING_READING_NOT_READ}\n`)
      expect(text.stdout).not.toContain('reach:')
      const json = run('--json', full, don)
      expect(json.status).toBe(0)
      expect(JSON.parse(json.stdout).servingReading).toEqual({ read: false, note: SERVING_READING_NOT_READ })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
