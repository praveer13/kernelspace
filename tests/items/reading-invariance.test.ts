/**
 * M0 of the serving-first reading spec (docs/specs/serving-reading.md §8, SR-D15, SR-D23): nothing else moved.
 *
 * Written at the base, before any reading item exists, so it is green there and stays green at every task's tip:
 * the reading groups, their KC links and the `reading` block must leave these figures alone.
 *
 * 1. the 15 legacy rows of `tests/fixtures/items/hashes/compile.json` as literals, and `VERSION === 2`;
 * 2. all 9 form blueprints against `tests/fixtures/forms/blueprints.json`;
 * 3. Error Museum practice draws (every `museum.json` code x 60 seeds) against
 *    `tests/fixtures/items/museum-practice.json`, and a sha256 of `museum.json`;
 * 4. Today's and the tickets' family lists for the four reading KCs are empty (a literal list, because `READING_KCS`
 *    lands with SR-03, which asserts that the literal equals it), and a legacy R KC keeps its pool and its draw;
 * 5. H3: `selectHintArms`, `selectHintSecondary` and `selectDailySecondary` over a fixture ledger equal literals
 *    captured at the base, and equal their own output with the reading-block `item` events removed.
 *
 * The literals and fixture files are captured from the base tree with the production functions, never computed from
 * the code under test at run time. A change to one is a deliberate act with a reason, not a re-baselining.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { KCS } from '../../src/data/kc'
import { SYSTEMS_FORGE_LABS } from '../../src/data/labs'
import museum from '../../src/data/rust-items/museum.json'
import { loadGroups } from '../../src/data/rust-items/groups'
import { GROUP_IDS, practiceInstance } from '../../src/lib/items/families/compile'
import { settle } from '../../src/lib/items/on-demand'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Gen } from '../../src/lib/items/types'
import { formBlueprint } from '../../src/lib/learner/forms'
import { DAILY_FAULT_KCS, selectDailySecondary, type DailyCheck } from '../../src/lib/learner/daily-secondary'
import { selectHintSecondary, type HintDecision, type PrimaryRules } from '../../src/lib/learner/hint-secondary'
import { HINT_WINDOW_DAYS, selectDailyVsOther, selectHintArms, type PartnerLedger } from '../../src/lib/learner/outcomes'
import { ledgerOfDonation, redactForPartner } from '../../src/lib/learner/redact'
import { addDays } from '../../src/lib/learner/reentry'
import { buildPool } from '../../src/lib/learner/today'
import { makeGenPool } from '../../src/lib/learner/ticket'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { stableStringify } from '../../src/lib/ledger/stable'
import { hashFamily } from '../../scripts/verify-generators'
import { CONTENT, Journal, LESSONS, START } from '../learner/ledger-gen'

const read = (rel: string): string => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8')
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

let gens: ReadonlyMap<string, Gen>
beforeAll(async () => {
  await loadGroups(GROUP_IDS)
  gens = new Map((await loadAllFamilies()).map((g) => [g.id, g] as const))
})

/* ------------------------------------------------------------------ */
/* 1. The compile family's legacy hash rows                            */
/* ------------------------------------------------------------------ */

/** The 15 rows of `tests/fixtures/items/hashes/compile.json` at the base (SR-D12: no `VERSION` bump, no legacy instance moves). */
const LEGACY_ROWS: Readonly<Record<string, string>> = {
  'fix.analyzer-limits': '54bc4244',
  'fix.borrow-rules': '9494a66d',
  'fix.clone-copy-drop': 'a1ca616f',
  'fix.interior-mutability': '15cd3b78',
  'fix.lifetimes': 'd4f3f813',
  'fix.ownership-moves': '423cd16f',
  'fix.slices': 'c5a39e15',
  permission: '80c550f7',
  'verdict.analyzer-limits': '123242b8',
  'verdict.borrow-rules': '528938db',
  'verdict.clone-copy-drop': 'c9601749',
  'verdict.interior-mutability': 'f345b9be',
  'verdict.lifetimes': '42269387',
  'verdict.ownership-moves': '42b6451d',
  'verdict.slices': 'c4286a55',
}

describe('I1: the compile family\'s legacy output', () => {
  test('VERSION is 2', () => {
    expect((gens.get('compile') as Gen).version).toBe(2)
  })

  test('the 15 legacy variants hash to the base\'s literals (SR-04 adds rows; it moves none of these)', () => {
    const now = hashFamily(gens.get('compile') as Gen)
    expect(Object.keys(LEGACY_ROWS)).toHaveLength(15)
    for (const [variant, h] of Object.entries(LEGACY_ROWS)) expect(now[variant], variant).toBe(h)
  })

  test('the fixture file still holds those 15 rows unchanged (a regenerated fixture cannot move a legacy row)', () => {
    const file = JSON.parse(read('tests/fixtures/items/hashes/compile.json')) as Record<string, string>
    for (const [variant, h] of Object.entries(LEGACY_ROWS)) expect(file[variant], variant).toBe(h)
  })
})

/* ------------------------------------------------------------------ */
/* 2. Form blueprints                                                  */
/* ------------------------------------------------------------------ */

const TRACKS = ['r', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7']

describe('I2: form blueprints', () => {
  test('all 9 tracks equal tests/fixtures/forms/blueprints.json', async () => {
    const fixture = JSON.parse(read('tests/fixtures/forms/blueprints.json')) as Record<string, string[] | null>
    expect(Object.keys(fixture)).toEqual(TRACKS)
    const now: Record<string, string[] | null> = {}
    for (const t of TRACKS) {
      const b = await settle(() => formBlueprint(t, { gens, kcs: KCS }))
      now[t] = b ? b.map((s) => `${s.kc}:${s.family}/${s.variant}`) : null
    }
    expect(now).toEqual(fixture)
  })

  test('the fixture has the shape the spec describes: 12 slots for R, T1 and T4 to T7, none for T0, T2 and T3', () => {
    const fixture = JSON.parse(read('tests/fixtures/forms/blueprints.json')) as Record<string, string[] | null>
    for (const t of ['r', 't1', 't4', 't5', 't6', 't7']) expect(fixture[t], t).toHaveLength(12)
    for (const t of ['t0', 't2', 't3']) expect(fixture[t], t).toBeNull()
    expect(fixture.r.every((s) => s.includes(':compile/'))).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/* 3. The Error Museum                                                 */
/* ------------------------------------------------------------------ */

/** sha256 of src/data/rust-items/museum.json at the base: 21 exhibits (SR-D8, I3). */
const MUSEUM_SHA256 = '51fd84878455aa13b07a94fb95a1f8b5006687cefef0796468df6a1c477b77c6'
const MUSEUM_SEEDS = 60

describe('I3: the Error Museum', () => {
  test('museum.json is byte-identical', () => {
    expect(sha(read('src/data/rust-items/museum.json'))).toBe(MUSEUM_SHA256)
    expect(museum).toHaveLength(21)
  })

  test('practice draws: every exhibit code x 60 seeds equal tests/fixtures/items/museum-practice.json (variant | unit | rev)', async () => {
    const fixture = JSON.parse(read('tests/fixtures/items/museum-practice.json')) as Record<string, string[]>
    expect(Object.keys(fixture)).toEqual(museum.map((e) => e.code))
    for (const e of museum) {
      const now: string[] = []
      for (let seed = 1; seed <= MUSEUM_SEEDS; seed++) {
        const i = await settle(() => practiceInstance(e.code, seed))
        now.push(i ? `${i.variant}|${i.params.unit}|${i.rev}` : '-')
      }
      expect(fixture[e.code], e.code).toHaveLength(MUSEUM_SEEDS)
      expect(now, e.code).toEqual(fixture[e.code])
    }
  })
})

/* ------------------------------------------------------------------ */
/* 4. Today and the tickets do not serve the reading KCs               */
/* ------------------------------------------------------------------ */

/** The four reading KCs (SR-D2). A literal: `READING_KCS` lands with SR-03, which asserts that it equals this list. */
const READING_KC_IDS = ['r.enums-option-result', 'r.iterators-ownership', 'r.closures-collections', 'r.smart-pointers']

/** A legacy R KC's pool and one draw of it, at the base (`level 2`, seed 12345): `variant|unit|rev`. */
const LEGACY_DRAWS: Readonly<Record<string, string>> = {
  'r.ownership-moves': 'fix.ownership-moves|lifetimes/rc-block-table/push-through-rc|6nm7lx',
  'r.clone-copy-drop': 'fix.clone-copy-drop|moves/plan-box-deref/ref-box|blifln',
  'r.permissions': 'permission|lifetimes/walk-radix-chain/frozen-cur|1jmmwi0',
  'r.borrow-rules': 'fix.borrow-rules|borrows/drop-idle-requests/iter-remove|1pszu4e',
  'r.slices': 'fix.slices|borrows/window-first-peak/ref-first|37z8ff',
  'r.analyzer-limits': 'fix.analyzer-limits|borrows/push-len-two-phase/push-pop|pg7vrh',
  'r.interior-mutability': 'fix.interior-mutability|lifetimes/cell-flag-shared/into-inner|17yhqz8',
  'r.lifetimes': 'fix.lifetimes|lifetimes/job-ref-thread/capture-ref|1oc42ht',
}

describe('I4: the reading KCs are not served by Today or tickets', () => {
  const pool = () =>
    buildPool({ kcs: KCS, gens, stair: [], authored: new Map(), constructed: new Map(), recent: new Map() })
  const tickets = () => makeGenPool(gens, (kc) => KCS.find((k) => k.id === kc)?.gen ?? [])

  test('the four ids are KCs of the graph', () => {
    for (const id of READING_KC_IDS) expect(KCS.some((k) => k.id === id), id).toBe(true)
  })

  test('buildPool(...).families(kc) is empty for each (Today, extra, cold checks)', () => {
    const p = pool()
    for (const id of READING_KC_IDS) expect(p.families(id), id).toEqual([])
  })

  test('makeGenPool(...).families(kc) is empty for each (tickets, spirals, the placement walk)', () => {
    const t = tickets()
    for (const id of READING_KC_IDS) expect(t.families(id), id).toEqual([])
  })

  test('control: legacy R KCs keep their family and their draw through both pools', async () => {
    const p = pool()
    const t = tickets()
    expect(Object.keys(LEGACY_DRAWS).length).toBeGreaterThan(0)
    for (const [kc, expected] of Object.entries(LEGACY_DRAWS)) {
      expect(p.families(kc), kc).toEqual(['compile'])
      expect(t.families(kc), kc).toEqual(['compile'])
      for (const made of [p.make('compile', kc, 2, 12345), t.make('compile', kc, 2, 12345)]) {
        const inst = made && made.source === 'gen' ? made.inst : null
        expect(inst ? `${inst.variant}|${inst.params.unit}|${inst.rev}` : null, kc).toBe(expected)
      }
    }
  })
})

/* ------------------------------------------------------------------ */
/* 5. H3 and #20's secondary analyses                                  */
/* ------------------------------------------------------------------ */

const d = (n: number) => addDays(START, n)
const ALLOC = 'rust-allocator'
const ALLOC_CHECKS = (SYSTEMS_FORGE_LABS.find((l) => l.id === ALLOC) as (typeof SYSTEMS_FORGE_LABS)[number]).checks.map((c) => c.id)
const ALLOC_LAB_DAY = 1
/** The lessons that introduce a fault KC of the Fleet Daily: their passed tickets make the cards the Daily contrast needs. */
const FAULT_LESSONS = LESSONS.filter((l) => l.kcs.some((kc) => DAILY_FAULT_KCS.includes(kc)))
const [KV, ADMIT, CAP] = DAILY_FAULT_KCS

const isReadingEvent = (e: LedgerEvent): boolean => e.ref.startsWith('gen:compile/') && (e as { data?: { src?: string } }).data?.src === 'lesson'

/**
 * One serving-first learner, as the app writes the events the three selectors read. Everything that moves H3:
 * - a `rust-allocator` run that is red, then one that is all green (day 1: the primary's anchor);
 * - armed acks on `boot` (whose KC list names `r.enums-option-result`, which SR-04 gives a generator), on `fragmentation`
 *   (KCs with a generator already), on `align`, and the shapes the primary drops: `coalesce` helped under both arms and
 *   `reuse` under an ack with no arm;
 * - Today cold `probe`s 29 to 31 days after the anchor, one of which resolves to the legacy KC `t1.external-frag`;
 * - a Fleet Daily and `sig` answers 40 to 42 days after the day-0 tickets (a card is created at most 7 days later, so the 30-day rule holds), in both of the Daily contrast's groups;
 * - `withReading` adds reading-block answers on the four reading KCs across the same window: `item` events, `src: 'lesson'`,
 *   unseen and graded, which is what the `reading` block writes (a Today probe is the one thing it cannot write).
 */
function weiLedger(withReading: boolean): LedgerEvent[] {
  const j = new Journal()
  for (const l of FAULT_LESSONS) j.passLesson(d(0), l.id, l.kcs)
  j.add('lab-check', `lab:${ALLOC}`, d(0), { ok: false, provenance: 'unseen', data: { passed: ['boot', 'no_overlap'], total: 6 } })
  j.add('ack', `hint:${ALLOC}/boot#R1`, d(0), { data: { arm: 'ladder' } })
  j.add('ack', `packet:lab/${ALLOC}/fragmentation`, d(0), { data: { arm: 'packet', via: 'copy', chars: 900 } })
  j.add('ack', `hint:${ALLOC}/align#R1`, d(0), { data: { arm: 'ladder' } })
  j.add('ack', `hint:${ALLOC}/coalesce#R1`, d(0), { data: { arm: 'ladder' } })
  j.add('ack', `packet:lab/${ALLOC}/coalesce`, d(0), { data: { arm: 'packet', via: 'claude', chars: 700 } })
  j.add('ack', `hint:${ALLOC}/reuse#R0`, d(0))
  j.add('lab-check', `lab:${ALLOC}`, d(ALLOC_LAB_DAY), { ok: true, provenance: 'unseen', ms: 90_000, data: { passed: ALLOC_CHECKS, total: 6 } })
  j.add('incident', 'inc:daily/2026-09-02', d(ALLOC_LAB_DAY), { ok: true, data: { kcs: [KV, ADMIT] } })
  const probe = (day: number, ref: string, kc: string, ok: boolean) =>
    j.add('probe', ref, d(day), { score: ok ? 1 : 0, ok, provenance: 'unseen', rev: 'r', data: { src: 'today', reason: 'probe', kcs: [kc], nsec: 40, sinceDays: day - ALLOC_LAB_DAY } })
  probe(ALLOC_LAB_DAY + 29, 'gen:frag/first-fit', 't1.external-frag', true)
  probe(ALLOC_LAB_DAY + 30, 'gen:frag/best-fit', 't1.alignment', false)
  probe(ALLOC_LAB_DAY + 31, 'gen:frag/first-fit', 't1.allocator-contract', true)
  const sig = (day: number, kc: string, ok: boolean) =>
    j.add('item', 'gen:sig/name-fault', d(day), { score: ok ? 1 : 0, ok, provenance: 'unseen', rev: 'r', data: { src: 'today', kcs: [kc], nsec: 40 } })
  sig(40, KV, true)
  sig(41, CAP, false)
  sig(42, ADMIT, true)
  if (withReading) {
    READING_KC_IDS.forEach((kc, i) => {
      for (const [n, kind] of (['verdict', 'fix'] as const).entries()) {
        const day = ALLOC_LAB_DAY + 27 + ((i * 2 + n) % 8)
        j.add('item', `gen:compile/${kind}.${kc.slice(2)}`, d(day), {
          score: n === 0 ? 1 : 0,
          ok: n === 0,
          provenance: 'unseen',
          rev: 'r',
          seed: 1000 + i * 2 + n,
          ms: 20_000,
          data: { src: 'lesson', lessonId: 't5.l5', grp: `t5.l5#${i}`, kcs: [kc], nsec: 40, level: 2 },
        })
      }
    })
  }
  return j.events
}

/** The real KC graph, the graph with the four reading KCs given `gen: ['compile']` (SR-04's change), and one where every KC has a generator. */
const REAL = KCS
const ARMED = KCS.map((k) => (READING_KC_IDS.includes(k.id) ? { ...k, gen: ['compile'] } : k))
const COVERED = KCS.map((k) => ({ ...k, gen: k.gen ?? ['frag'] }))

const RULES: PrimaryRules = { window: HINT_WINDOW_DAYS }
const DECISION = (hint: ReturnType<typeof selectHintArms>): HintDecision => hint

/** A full export, and the donation of it that a partner sends. */
const asExport = (events: LedgerEvent[]): PartnerLedger => ({ events })
const asDonation = (events: LedgerEvent[]): PartnerLedger => ledgerOfDonation(redactForPartner({ events, working: [] }))

/** What the three selectors say about a set of ledgers, as one comparable record. */
function analyses(ledgers: PartnerLedger[], kcs: typeof KCS) {
  const hint = selectHintArms(ledgers, CONTENT, { kcs })
  const secondary = selectHintSecondary(ledgers, CONTENT, RULES, DECISION(hint), { kcs })
  const checks: DailyCheck[] = []
  const daily = selectDailyVsOther(ledgers, CONTENT, (c) => checks.push(c))
  const dailySecondary = selectDailySecondary(ledgers, checks, daily)
  return { hint, secondary, daily, dailySecondary }
}

/** A short, stable digest of an analysis: its whole value, so no field can move unseen. */
const digest = (value: unknown): string => sha(stableStringify(value)).slice(0, 16)

/*
 * Captured at the base with the production selectors over `weiLedger(true)`; never recomputed from the code under test.
 * The figures are what a reader of the report would see; each digest is sha256 of `stableStringify` of the whole value, so
 * that a field nobody listed cannot move either.
 */

/** selectHintArms on the real graph: only `fragmentation` has a covered KC, so one packet-arm check is analysable. */
const HINT_ARMS_REAL = {
  learners: 0,
  partners: 1,
  checks: { ladder: 0, packet: 1 },
  both: 1,
  unarmed: 1,
  diff: { n: 0, mean: null, lower: null, upper: null, ci95: null },
  required: 126,
  verdict: 'underpowered',
  because: null,
}

/** selectHintArms where every KC has a generator: `align` (ladder) and `fragmentation` (packet) both have a first cold check. */
const HINT_ARMS_COVERED = {
  learners: 1,
  partners: 1,
  checks: { ladder: 2, packet: 1 },
  both: 1,
  unarmed: 1,
  diff: { n: 1, mean: -0.5, lower: -0.5, upper: -0.5, ci95: [-0.5, -0.5] },
  required: 126,
  verdict: 'underpowered',
  because: null,
}

const HINT_SECONDARY_REAL = {
  donors: 1,
  partners: 1,
  everRed: 5,
  standing: { ladder: 2, packet: 1, both: 1, unarmed: 1, none: 0 },
  runsWithoutDetail: 0,
  itt: { learners: 0, partners: 1, checks: { ladder: 0, packet: 1 } },
  helped: { n: 4, correct: 4, rate: 1 },
  shown: false,
}
const HINT_SECONDARY_REAL_DIGEST = 'c29106604486e8ef'
const HINT_SECONDARY_COVERED_DIGEST = '67c886447925df2a'

/** selectDailyVsOther: KV and ADMIT after a Daily that carried them (2 of 2), CAP without one (0 of 1). */
const DAILY_PRIMARY = {
  learners: 1,
  partners: 1,
  daily: { n: 2, correct: 2, rate: 1, ci95: [0.34238022750665303, 1] },
  other: { n: 1, correct: 0, rate: 0, ci95: [0, 0.7934506856227626] },
  diff: { n: 1, mean: 1, lower: 1, upper: 1, ci95: [1, 1] },
  required: 197,
  verdict: 'underpowered',
}
const DAILY_SECONDARY = {
  donors: 1,
  withDaily: 1,
  daily: { n: 2, correct: 2, learners: 1 },
  other: { n: 1, correct: 0, learners: 1 },
  onlyDaily: 0,
  onlyOther: 0,
  both: 1,
  perKc: [
    { kc: 't5.kv-capacity', daily: { n: 1, correct: 1 }, other: { n: 0 } },
    { kc: 't2.admission-scheduling', daily: { n: 1, correct: 1 }, other: { n: 0 } },
    { kc: 't7.capacity-planning', daily: { n: 0 }, other: { n: 1, correct: 0 } },
    { kc: 't5.prefill-decode-interference', daily: { n: 0 }, other: { n: 0 } },
  ],
  shown: false,
}
const DAILY_SECONDARY_DIGEST = 'f72904ff7dd27a3b'

describe('I5: H3\'s signed analysis and #20\'s secondary analyses', () => {
  test('the fixture ledger is a live one: the primary, the secondary and the Daily contrast each read it', () => {
    const a = analyses([asExport(weiLedger(true))], REAL)
    expect(a.hint.checks.ladder + a.hint.checks.packet).toBeGreaterThan(0)
    expect(a.hint.both).toBeGreaterThan(0)
    expect(a.hint.unarmed).toBeGreaterThan(0)
    expect(a.secondary.everRed).toBeGreaterThan(0)
    expect(a.dailySecondary.daily.n).toBeGreaterThan(0)
    expect(a.dailySecondary.other.n).toBeGreaterThan(0)
    expect(weiLedger(true).filter(isReadingEvent).length).toBe(8)
    expect(weiLedger(false).filter(isReadingEvent).length).toBe(0)
  })

  test('the reading events are in the primary\'s window, on a KC the boot check names, with a graded unseen answer', () => {
    const boot = (SYSTEMS_FORGE_LABS.find((l) => l.id === ALLOC) as (typeof SYSTEMS_FORGE_LABS)[number]).checks.find((c) => c.id === 'boot')
    expect(boot?.kcs).toContain('r.enums-option-result')
    for (const e of weiLedger(true).filter(isReadingEvent)) {
      const gap = Date.parse(e.day) / 86_400_000 - Date.parse(d(ALLOC_LAB_DAY)) / 86_400_000
      expect(gap).toBeGreaterThanOrEqual(HINT_WINDOW_DAYS[0])
      expect(gap).toBeLessThanOrEqual(HINT_WINDOW_DAYS[1])
      expect((e as { ok?: unknown }).ok).toBeDefined()
      expect((e as { provenance?: string }).provenance).toBe('unseen')
    }
  })

  for (const [name, make] of [['a full export', asExport], ['a donation', asDonation]] as const) {
    for (const [universe, kcs] of [['the real graph', REAL], ['the graph with the reading KCs armed', ARMED], ['a graph where every KC has a generator', COVERED]] as const) {
      test(`${name}, on ${universe}: reading-block events change none of the three analyses (SR-D16, SR-D23)`, () => {
        const withReading = analyses([make(weiLedger(true))], kcs)
        const without = analyses([make(weiLedger(false))], kcs)
        expect(withReading.hint).toEqual(without.hint)
        expect(withReading.secondary).toEqual(without.secondary)
        expect(withReading.daily).toEqual(without.daily)
        expect(withReading.dailySecondary).toEqual(without.dailySecondary)
      })
    }
  }
  test('captured at the base: selectHintArms', () => {
    const ledgers = [asExport(weiLedger(true))]
    expect(analyses(ledgers, REAL).hint).toEqual(HINT_ARMS_REAL)
    // arming the four KCs (SR-04) grows boot's covered set from nothing to r.enums-option-result, and no outcome appears
    expect(analyses(ledgers, ARMED).hint).toEqual(HINT_ARMS_REAL)
    expect(analyses(ledgers, COVERED).hint).toEqual(HINT_ARMS_COVERED)
  })

  test('captured at the base: selectHintSecondary (the figures that matter, then a digest of the whole value)', () => {
    const ledgers = [asExport(weiLedger(true))]
    const real = analyses(ledgers, REAL).secondary
    expect(real).toMatchObject(HINT_SECONDARY_REAL)
    expect(real.labs[0]).toMatchObject({ lab: 'rust-allocator', arms: { ladder: { checks: 2, help: 2, accuracy: { n: 0 } }, packet: { checks: 1, help: 1, accuracy: { n: 1, correct: 1 } } } })
    expect(real.release[0]).toEqual({ lab: 'rust-allocator', afterFirst: 0 })
    expect(digest(real)).toBe(HINT_SECONDARY_REAL_DIGEST)
    expect(digest(analyses(ledgers, ARMED).secondary)).toBe(HINT_SECONDARY_REAL_DIGEST)
    const covered = analyses(ledgers, COVERED).secondary
    expect(covered.itt).toEqual({ learners: 1, partners: 1, checks: { ladder: 2, packet: 1 }, unhelped: { n: 0, correct: 0, rate: null, ci95: null } })
    expect(digest(covered)).toBe(HINT_SECONDARY_COVERED_DIGEST)
  })

  test('captured at the base: selectDailyVsOther and selectDailySecondary', () => {
    const a = analyses([asExport(weiLedger(true))], REAL)
    expect(a.daily).toEqual(DAILY_PRIMARY)
    expect(a.dailySecondary).toMatchObject(DAILY_SECONDARY)
    expect(digest(a.dailySecondary)).toBe(DAILY_SECONDARY_DIGEST)
  })
})
