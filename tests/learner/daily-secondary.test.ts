/**
 * F3's secondary outputs (docs/prereg/fleet-daily.md §3 and §5; wave-3.md D65, task XF2), on ledgers the app's own
 * recorders write: a Daily played through `recordDaily` (`dailyResult`), `sig` items served by the family, graded and turned
 * into Today's responses (`resultFor`, `itemResponseOf`, provenance from `seenInstances`), lesson passes through
 * `recordTicket`, all through the progress façade on a tab whose clock moves day by day.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { KCS } from '../../src/data/kc'
import { KC } from '../../src/data/kc/ids'
import sig from '../../src/lib/items/families/sig'
import { correctResponse, gradeResponse } from '../../src/lib/items/grade'
import { resultFor } from '../../src/lib/items/play'
import type { Instance, PlayableItem } from '../../src/lib/items/types'
import { DAILY_FAULT_KCS, formatDailySecondary, selectDailySecondary, type DailyCheck } from '../../src/lib/learner/daily-secondary'
import { buildWave3Report, DAILY_MIN_DAYS, DAILY_MIN_LEARNERS, formatWave3Report, selectDailyVsOther, type PartnerLedger } from '../../src/lib/learner/outcomes'
import { ledgerOfDonation, parseDonation, redactForPartner } from '../../src/lib/learner/redact'
import { addDays } from '../../src/lib/learner/reentry'
import { itemResponseOf, seenInstances } from '../../src/lib/learner/today'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import { dailyIncident, recordDaily, type FinishedIncident } from '../../src/lib/world/daily'
import type { IncidentFault } from '../../src/lib/world/incident-spec'
import { makeProfile, startTab } from '../ledger/env'
import { CONTENT, LESSONS, START } from './ledger-gen'

const d = (n: number) => addDays(START, n)
const noon = (n: number) => Date.parse(`${d(n)}T12:00:00.000Z`)

const KV = KC.kvCapacity
const ADMIT = KC.admissionScheduling
const CAP = KC.capacityPlanning
const PDI = KC.prefillDecodeInterference

/** What a finished Daily reports (the fleet protocol's `IncidentFinish`), for the day's own fault. */
const finished = (fault: IncidentFault): FinishedIncident => ({ fault, severity: 2, hypothesis: fault, probes: ['kv'], diagnosed: true, fixed: true, burn: 6, expertBurn: 4, streetlight: 0 })

/** The first Journal day from `from` whose Daily (`dailyIncident`, drawn from the date) has `fault`. */
function dailyDay(fault: IncidentFault, from: number): number {
  for (let n = from; n < from + 400; n++) if (dailyIncident(d(n)).fault === fault) return n
  throw new Error(`no ${fault} Daily within 400 days of day ${from}`)
}

/** A `name-fault` sig item on `kc`'s fault: the first seed from `from` whose instance carries the KC. */
function sigOn(kc: string, from: number): Instance {
  for (let seed = from; seed < from + 4000; seed++) {
    const inst = sig.make(seed, 1, 'name-fault')
    if (inst.kcs.includes(kc)) return inst
  }
  throw new Error(`no sig seed for ${kc}`)
}

type Step = { day: number; daily: IncidentFault } | { day: number; kc: string; ok: boolean; seed?: number }

/**
 * One learner as the app writes them. Day 0: an exit ticket passed for each lesson that introduces a fault KC (the cards).
 * Then each step on its day, in day order: a Daily of `daily`'s fault on the first day from `day` that serves it, or a
 * Today answer to a fresh `sig` item on `kc` (seeded from `seed`, so a step can serve a seed again, which is practice).
 */
async function learner(steps: readonly Step[]): Promise<LedgerEvent[]> {
  const profile = makeProfile({ ms: noon(0) })
  const tab = startTab(profile)
  const s = () => tab.progress.getState()
  for (const lesson of FAULT_LESSONS) {
    s().recordTicket({
      lessonId: lesson.id,
      form: 'ticket',
      seed: 1,
      ms: 60_000,
      ok: true,
      nonMcqOk: true,
      responses: lesson.kcs.map((kc, i) => ({ ref: `quiz:${lesson.id}#${i}` as const, rev: 'r', score: 1, ok: true, ms: 9000, provenance: 'practice' as const, data: { src: 'ticket' as const, kcs: [kc], nsec: 30 } })),
    })
  }
  const at = steps.map((st) => ('daily' in st ? { ...st, day: dailyDay(st.daily, st.day) } : st)).sort((a, b) => a.day - b.day)
  for (const [i, st] of at.entries()) {
    profile.clock.ms = noon(st.day) + i * 1000
    if ('daily' in st) {
      const date = d(st.day)
      expect(recordDaily(tab.progress, date, dailyIncident(date), finished(st.daily), [], 90_000)).toBe(true)
      continue
    }
    await tab.progress.controls.flush()
    const seen = seenInstances(await (await tab.engine()).events())
    const inst = sigOn(st.kc, st.seed ?? 1000 + i * 37)
    const item: PlayableItem = { source: 'gen', inst }
    const right = correctResponse(inst)
    const wrong = inst.answer.kind === 'choice' ? { kind: 'choice' as const, picks: [(inst.answer.options.find((o) => !(inst.answer as { correct: string[] }).correct.includes(o.id)) as { id: string }).id] } : right
    const response = st.ok ? right : wrong
    const result = resultFor(item, response, gradeResponse(inst, response), { seed: inst.seed, ms: 20_000 })
    const r: ItemResponse = itemResponseOf(result, item, { grp: `s${st.day}`, slot: 0, of: 1, reason: 'due', src: 'today' }, seen)
    expect(r.ok).toBe(st.ok)
    s().recordItems([r])
  }
  await tab.progress.controls.flush()
  return (await (await tab.engine()).events()) as LedgerEvent[]
}

/** The lessons that introduce the four fault KCs (each once). */
const FAULT_LESSONS = [...new Map(DAILY_FAULT_KCS.map((kc) => LESSONS.find((l) => l.kcs.includes(kc)) as (typeof LESSONS)[number]).map((l) => [l.id, l])).values()]

/** A redacted donation of a ledger, written to text and parsed back as `scripts/partner-report.ts` reads it. */
function donated(events: readonly LedgerEvent[]): PartnerLedger {
  const parsed = parseDonation(JSON.stringify(redactForPartner({ events: [...events], working: [] })))
  if (!parsed.ok) throw new Error(parsed.error)
  return ledgerOfDonation(parsed.donation)
}

/** Runs the primary with a sink, then the secondary on the checks it counted. */
function both(ledgers: readonly PartnerLedger[]) {
  const checks: DailyCheck[] = []
  const primary = selectDailyVsOther(ledgers, CONTENT, (c) => checks.push(c))
  return { primary, checks, secondary: selectDailySecondary(ledgers, checks, primary) }
}

/*
 * The archetypes, each a learner of its own:
 * - mixed: a pool-shrink Daily from day 31, then on day 60 KV right (Daily), ADMIT wrong, CAP right, PDI right (other);
 *   a drain-stall Daily from day 70, then on day 110 ADMIT right and KV wrong (both Daily). Also a day-5 answer (too
 *   soon after the card) and a served seed served again on day 61 (practice): neither is eligible.
 * - late: node-death and tenant-burst Dailies from day 31, then on day 80 CAP right, PDI wrong (Daily), KV right (other).
 * - never: no Daily; on day 60 every fault KC, KV and CAP right, ADMIT and PDI wrong (all other).
 * - devoted: a pool-shrink Daily from day 31, then on day 60 KV right (Daily only).
 * - after: answers on day 40, then a pool-shrink Daily from day 50: the Daily came after, so KV is other (other only).
 */
const ARCHETYPES: Record<string, Step[]> = {
  mixed: [
    { day: 5, kc: KV, ok: true },
    { day: 31, daily: 'pool-shrink' },
    { day: 60, kc: KV, ok: true, seed: 5000 },
    { day: 60, kc: ADMIT, ok: false },
    { day: 60, kc: CAP, ok: true },
    { day: 60, kc: PDI, ok: true },
    { day: 61, kc: KV, ok: true, seed: 5000 },
    { day: 70, daily: 'drain-stall' },
    { day: 110, kc: ADMIT, ok: true },
    { day: 110, kc: KV, ok: false },
  ],
  late: [
    { day: 31, daily: 'node-death' },
    { day: 31, daily: 'tenant-burst' },
    { day: 80, kc: CAP, ok: true },
    { day: 80, kc: PDI, ok: false },
    { day: 80, kc: KV, ok: true },
  ],
  never: [
    { day: 60, kc: KV, ok: true },
    { day: 60, kc: ADMIT, ok: false },
    { day: 60, kc: CAP, ok: true },
    { day: 60, kc: PDI, ok: false },
  ],
  devoted: [
    { day: 31, daily: 'pool-shrink' },
    { day: 60, kc: KV, ok: true },
  ],
  after: [
    { day: 40, kc: KV, ok: true },
    { day: 50, daily: 'pool-shrink' },
  ],
}

let own: Record<string, LedgerEvent[]>
/** One of each archetype, in ARCHETYPES order. */
let crew: PartnerLedger[]
/** Enough learners with both groups for the primary's minimum: the crew, then `mixed` and `late` alternately. */
let powered: PartnerLedger[]

beforeAll(async () => {
  own = {}
  for (const [name, steps] of Object.entries(ARCHETYPES)) own[name] = await learner(steps)
  crew = Object.values(own).map((events) => ({ events }))
  powered = [...crew, ...Array.from({ length: DAILY_MIN_LEARNERS - 1 }, (_, i) => ({ events: own[i % 2 === 0 ? 'mixed' : 'late'] }))]
})

describe('the fixture is what the recorders write', () => {
  test('the Daily event carries its fault KC in kcs, and sig answers carry the diagnosis skill and one fault KC', () => {
    const dailies = own.mixed.filter((e) => e.kind === 'incident')
    expect(dailies.map((e) => e.ref.startsWith('inc:daily/'))).toEqual([true, true])
    expect(dailies.map((e) => (e as { data: { kcs: string[] } }).data.kcs)).toEqual([[KC.incidentDiagnosis, KV], [KC.incidentDiagnosis, ADMIT]])
    const answers = own.mixed.filter((e) => e.ref.startsWith('gen:sig/'))
    expect(answers.map((e) => (e as { provenance: string }).provenance)).toEqual(['unseen', 'unseen', 'unseen', 'unseen', 'unseen', 'practice', 'unseen', 'unseen'])
    for (const e of answers) expect((e as { data: { kcs: string[] } }).data.kcs[0]).toBe(KC.incidentDiagnosis)
  })

  test('the four fault KCs are the primary\'s: the sig family\'s KCs besides the diagnosis skill, in the file\'s order', () => {
    const sigKcs = KCS.filter((k) => k.gen?.includes('sig') && k.id !== KC.incidentDiagnosis).map((k) => k.id)
    expect([...sigKcs].sort()).toEqual([...DAILY_FAULT_KCS].sort())
    const prereg = readFileSync(path.resolve(import.meta.dir, '../../docs/prereg/fleet-daily.md'), 'utf8')
    const named = DAILY_FAULT_KCS.map((kc) => prereg.indexOf(`\`${kc}\``))
    expect(named.every((i) => i > 0)).toBe(true)
    expect([...named].sort((a, b) => a - b)).toEqual(named)
  })
})

describe('the primary is unchanged (byte for byte, on the same ledgers)', () => {
  // selectDailyVsOther's result and F3's two lines on these ledgers, captured at wave-3x d31a770 before this task
  const CREW =
    '{"learners":2,"partners":5,"daily":{"n":6,"correct":4,"rate":0.6666666666666666,"ci95":[0.299993315138392,0.9032285888942195]},"other":{"n":9,"correct":6,"rate":0.6666666666666666,"ci95":[0.3542021355803963,0.879416181613089]},"diff":{"n":2,"mean":-0.25,"lower":-0.5,"upper":0,"ci95":[-0.5,0]},"required":197,"verdict":"underpowered"}'
  const POWERED =
    '{"learners":198,"partners":201,"daily":{"n":496,"correct":298,"rate":0.6008064516129032,"ci95":[0.5570917517382152,0.6429716848481295]},"other":{"n":401,"correct":300,"rate":0.7481296758104738,"ci95":[0.7034250942752525,0.7881253526075553]},"diff":{"n":198,"mean":-0.25,"lower":-0.2828282828282828,"upper":-0.21464646464646464,"ci95":[-0.2828282828282828,-0.21464646464646464]},"required":197,"verdict":"kill"}'
  const F3_CREW =
    'F3  Fleet Daily keep-or-kill → NOT ENOUGH DATA\n      not enough data (n = 2 of 197 learners with a 30-day sig check on a Daily KC and on another, 5 partners; 6 Daily and 9 other checks)'
  const F3_POWERED =
    'F3  Fleet Daily keep-or-kill → NOT MET\n      n = 198, 201 partners: Daily KCs 60.1 %, 95 % interval 55.7 % to 64.3 % (n = 496) against other KCs 74.8 %, 95 % interval 70.3 % to 78.8 % (n = 401); learner-level difference −25.0 points, one-sided 97.5 % bootstrap bound −28.3 points against −5 points, 95 % interval −28.3 points to −21.5 points'
  const f3Lines = (ledgers: readonly PartnerLedger[]) => {
    const lines = formatWave3Report(buildWave3Report(ledgers, { cards: CONTENT, signed: { hintLadders: false, fleetDaily: true } })).split('\n')
    const at = lines.findIndex((line) => line.startsWith('F3  '))
    return lines.slice(at, at + 2).join('\n')
  }

  test('with or without the sink, on exports and on their donations', () => {
    expect(JSON.stringify(selectDailyVsOther(crew, CONTENT))).toBe(CREW)
    expect(JSON.stringify(both(crew).primary)).toBe(CREW)
    expect(JSON.stringify(selectDailyVsOther(crew.map((l) => donated(l.events)), CONTENT))).toBe(CREW)
    expect(JSON.stringify(selectDailyVsOther(powered, CONTENT))).toBe(POWERED)
    expect(JSON.stringify(both(powered).primary)).toBe(POWERED)
  })

  test("F3's row in the report", () => {
    expect(f3Lines(crew)).toBe(F3_CREW)
    expect(f3Lines(powered)).toBe(F3_POWERED)
    const report = buildWave3Report(powered, { cards: CONTENT, signed: { hintLadders: false, fleetDaily: true } })
    expect(JSON.stringify(report.daily)).toBe(POWERED)
  })
})

describe('selectDailySecondary', () => {
  test("a check is in the same group in the primary and in every table: the sink is the primary's own count", () => {
    for (const ledgers of [crew, powered]) {
      const { primary, checks, secondary } = both(ledgers)
      const sum = (g: 'daily' | 'other') => secondary.perKc.reduce((a, r) => ({ n: a.n + r[g].n, correct: a.correct + r[g].correct }), { n: 0, correct: 0 })
      for (const g of ['daily', 'other'] as const) {
        expect(checks.filter((c) => c.group === g)).toHaveLength(primary[g].n)
        expect({ n: secondary[g].n, correct: secondary[g].correct, rate: secondary[g].rate, ci95: secondary[g].ci95 }).toEqual(primary[g])
        expect(sum(g)).toEqual({ n: primary[g].n, correct: primary[g].correct })
      }
      expect(secondary.both).toBe(primary.learners)
      expect(secondary.both + secondary.onlyDaily + secondary.onlyOther).toBe(primary.partners)
    }
  })

  test('each archetype lands where the primary puts it: KV is a Daily KC after a pool-shrink Daily and an other KC before one', () => {
    const { checks } = both(crew)
    const of = (learner: number) => checks.filter((c) => c.learner === learner).map((c) => `${c.kc}:${c.group}:${c.ok ? 1 : 0}`)
    // mixed: the day-5 answer and the re-served seed are not eligible
    expect(of(0)).toEqual([`${KV}:daily:1`, `${ADMIT}:other:0`, `${CAP}:other:1`, `${PDI}:other:1`, `${ADMIT}:daily:1`, `${KV}:daily:0`])
    expect(of(1)).toEqual([`${CAP}:daily:1`, `${PDI}:daily:0`, `${KV}:other:1`])
    expect(of(2)).toEqual([`${KV}:other:1`, `${ADMIT}:other:0`, `${CAP}:other:1`, `${PDI}:other:0`])
    expect(of(3)).toEqual([`${KV}:daily:1`])
    expect(of(4)).toEqual([`${KV}:other:1`])
  })

  test('the counts, the pooled groups, the one-group learners and the table per fault KC', () => {
    const s = both(crew).secondary
    expect(s).toMatchObject({ donors: 5, withDaily: 4, onlyDaily: 1, onlyOther: 2, both: 2, shown: false, learners: 2, required: DAILY_MIN_LEARNERS })
    expect(s.daily).toMatchObject({ n: 6, correct: 4, learners: 3 })
    expect(s.other).toMatchObject({ n: 9, correct: 6, learners: 4 })
    expect(s.perKc.map((r) => r.kc)).toEqual([...DAILY_FAULT_KCS])
    const cell = (kc: string, g: 'daily' | 'other') => {
      const c = s.perKc.find((r) => r.kc === kc)![g]
      return [c.n, c.correct, c.learners]
    }
    expect([cell(KV, 'daily'), cell(KV, 'other')]).toEqual([[3, 2, 2], [3, 3, 3]])
    expect([cell(ADMIT, 'daily'), cell(ADMIT, 'other')]).toEqual([[1, 1, 1], [2, 0, 2]])
    expect([cell(CAP, 'daily'), cell(CAP, 'other')]).toEqual([[1, 1, 1], [2, 2, 2]])
    expect([cell(PDI, 'daily'), cell(PDI, 'other')]).toEqual([[1, 0, 1], [2, 1, 2]])
    const kv = s.perKc[0].other
    expect(kv.rate).toBe(1)
    expect(kv.ci95![0]).toBeCloseTo(0.4385, 4)
  })

  test('a learner with no eligible check is in no group, and a Daily alone counts only as a learner with a Daily', () => {
    const s = both([{ events: [] }, ...crew, { events: own.mixed.filter((e) => !e.ref.startsWith('gen:sig/')) }]).secondary
    expect(s).toMatchObject({ donors: 7, withDaily: 5, onlyDaily: 1, onlyOther: 2, both: 2 })
  })

  test('a donation round trip gives the same checks and the same secondary outputs, line for line', () => {
    const a = both(powered)
    const b = both(powered.map((l) => donated(l.events)))
    expect(b.checks).toEqual(a.checks)
    expect(b.secondary).toEqual(a.secondary)
    expect(formatDailySecondary(b.secondary)).toEqual(formatDailySecondary(a.secondary))
    expect(both(crew.map((l) => donated(l.events))).secondary).toEqual(both(crew).secondary)
  })
})

describe('the report prints every line', () => {
  const report = (ledgers: readonly PartnerLedger[], fleetDaily = true) => formatWave3Report(buildWave3Report(ledgers, { cards: CONTENT, signed: { hintLadders: false, fleetDaily } }))
  const block = (text: string) => {
    const lines = text.split('\n')
    const at = lines.findIndex((line) => line.startsWith('F3  '))
    const end = lines.findIndex((line) => line.startsWith('F4  '))
    return lines.slice(at + 2, end)
  }

  test('powered: every secondary output with its accuracy, Wilson interval, n and learners, under F3', () => {
    expect(block(report(powered))).toEqual([
      '      secondary outputs, reported and not decisive (docs/prereg/fleet-daily.md §3 and §5), among 201 donors (self-selected; observational, no causal claim):',
      '        learners with a Daily: 200 of 201 donors',
      '        eligible checks per group: 496 checks on Daily KCs, 401 checks on other KCs',
      '        pooled accuracy of each group: Daily KCs 298 of 496 = 60.1 %, Wilson 95 % interval 55.7 % to 64.3 % (n = 496 checks, 199 learners); other KCs 300 of 401 = 74.8 %, Wilson 95 % interval 70.3 % to 78.8 % (n = 401 checks, 200 learners)',
      '        learners with a check in only one group: 1 with Daily-KC checks only, 2 with other-KC checks only (198 with both)',
      '        the table per fault KC (an answer counts once for each fault KC it carries)',
      '          t5.kv-capacity                  Daily KCs 100 of 199 = 50.3 %, Wilson 95 % interval 43.4 % to 57.1 % (n = 199 checks, 100 learners) | other KCs 101 of 101 = 100.0 %, Wilson 95 % interval 96.3 % to 100.0 % (n = 101 checks, 101 learners)',
      '          t2.admission-scheduling         Daily KCs 99 of 99 = 100.0 %, Wilson 95 % interval 96.3 % to 100.0 % (n = 99 checks, 99 learners) | other KCs 0 of 100 = 0.0 %, Wilson 95 % interval 0.0 % to 3.7 % (n = 100 checks, 100 learners)',
      '          t7.capacity-planning            Daily KCs 99 of 99 = 100.0 %, Wilson 95 % interval 96.3 % to 100.0 % (n = 99 checks, 99 learners) | other KCs 100 of 100 = 100.0 %, Wilson 95 % interval 96.3 % to 100.0 % (n = 100 checks, 100 learners)',
      '          t5.prefill-decode-interference  Daily KCs 0 of 99 = 0.0 %, Wilson 95 % interval 0.0 % to 3.7 % (n = 99 checks, 99 learners) | other KCs 99 of 100 = 99.0 %, Wilson 95 % interval 94.6 % to 99.8 % (n = 100 checks, 100 learners)',
    ])
  })

  test('underpowered: the counts, and "not enough data" in place of every accuracy', () => {
    const lines = block(report(crew))
    expect(lines).toEqual([
      '      secondary outputs, reported and not decisive (docs/prereg/fleet-daily.md §3 and §5), among 5 donors (self-selected; observational, no causal claim):',
      '        learners with a Daily: 4 of 5 donors',
      '        eligible checks per group: 6 checks on Daily KCs, 9 checks on other KCs',
      '        pooled accuracy of each group: not enough data (n = 2 of 197 learners with a check in both groups; fleet-daily.md §4 shows no accuracy below that, so only counts); Daily KCs n = 6 checks, 3 learners; other KCs n = 9 checks, 4 learners',
      '        learners with a check in only one group: 1 with Daily-KC checks only, 2 with other-KC checks only (2 with both)',
      '        the table per fault KC (an answer counts once for each fault KC it carries): not enough data (n = 2 of 197 learners with a check in both groups; fleet-daily.md §4 shows no accuracy below that, so only counts)',
      '          t5.kv-capacity                  Daily KCs n = 3 checks, 2 learners | other KCs n = 3 checks, 3 learners',
      '          t2.admission-scheduling         Daily KCs n = 1 check, 1 learner | other KCs n = 2 checks, 2 learners',
      '          t7.capacity-planning            Daily KCs n = 1 check, 1 learner | other KCs n = 2 checks, 2 learners',
      '          t5.prefill-decode-interference  Daily KCs n = 1 check, 1 learner | other KCs n = 2 checks, 2 learners',
    ])
    expect(lines.join('\n')).not.toMatch(/\d %/)
  })

  test('nothing while the file is unsigned; the block reproduces byte for byte, and a donation prints the same block', () => {
    expect(report(crew, false)).not.toContain('fleet-daily.md §3 and §5')
    expect(report(powered)).toBe(report(powered))
    for (const ledgers of [crew, powered]) expect(block(report(ledgers.map((l) => donated(l.events))))).toEqual(block(report(ledgers)))
  })
})

describe('the module graph', () => {
  test('daily-secondary.ts imports outcomes.ts for types only, so the two do not import each other', () => {
    const src = readFileSync(path.resolve(import.meta.dir, '../../src/lib/learner/daily-secondary.ts'), 'utf8')
    expect(src).toMatch(/^import type \{[^}]*\} from '\.\/outcomes'$/m)
    expect(src).not.toMatch(/^import \{[^}]*\} from '\.\/outcomes'$/m)
    expect(DAILY_MIN_DAYS).toBe(30)
  })
})
