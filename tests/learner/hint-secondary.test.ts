import { describe, expect, test } from 'bun:test'
import { KCS } from '../../src/data/kc'
import { SYSTEMS_FORGE_LABS } from '../../src/data/labs'
import { ackVia, type AskResult } from '../../src/components/mentor/ask-flow'
import { hintRef } from '../../src/lib/forge/ladder'
import { buildProveResult } from '../../src/lib/forge/prove'
import { creditFor, toLabRun } from '../../src/lib/forge/run'
import type { LabRunReport } from '../../src/lib/forge/types'
import { hintArm } from '../../src/lib/learner/experiments'
import { formatHintSecondary, hintSecondaryJson, selectHintSecondary, type HintDecision, type HintSecondary, type PrimaryRules } from '../../src/lib/learner/hint-secondary'
import { buildWave3Report, formatWave3Report, HINT_MIN_LEARNERS, HINT_WINDOW_DAYS, selectHintArms, wave3ReportJson, type PartnerLedger } from '../../src/lib/learner/outcomes'
import { ledgerOfDonation, parseDonation, redactForPartner } from '../../src/lib/learner/redact'
import { addDays } from '../../src/lib/learner/reentry'
import type { RungId } from '../../src/lib/forge/ladder'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { makeProfile, startTab } from '../ledger/env'
import { CONTENT, START } from './ledger-gen'

/*
 * The fixture is two learners written by the real recorders: ForgeLab's run (`creditFor`, `toLabRun`, the façade's
 * `recordLabRun`), HintLadder's rung (`hintRef`, `hintArm`, `acknowledge`), AskButtons' packet (`ackVia`, `recordHelp`),
 * ProveIt's attempt (`buildProveResult`, `recordProve`) and Today's cold check (`recordItems` with a `probe`).
 */

const RULES: PrimaryRules = { window: HINT_WINDOW_DAYS }
const ALLOC = 'rust-allocator'
const KV = 'kv-block-manager'
const FRAG_KC = 't1.external-frag'
const COALESCE_KC = 't1.split-coalesce'
const CONTRACT_KC = 't1.allocator-contract'
/** Every KC covered by a generator, so that every check can have an outcome (as outcomes.test.ts's `selectHintArms` tests do). */
const COVERED = KCS.map((k) => ({ ...k, gen: k.gen ?? ['frag'] }))

const day = (n: number) => addDays(START, n)
const labOf = (id: string) => SYSTEMS_FORGE_LABS.find((l) => l.id === id) as (typeof SYSTEMS_FORGE_LABS)[number]

/** The lowest `exp:seed` that gives each named check its arm, so the page's own `hintArm` assigns what the fixture needs. */
function seedWhere(want: Record<string, 'ladder' | 'packet'>): number {
  for (let s = 1; ; s++) {
    if (Object.entries(want).every(([unit, arm]) => hintArm(unit.split('/')[0], unit.split('/')[1], s) === arm)) return s
  }
}
const SEED_1 = seedWhere({ [`${ALLOC}/fragmentation`]: 'ladder', [`${ALLOC}/coalesce`]: 'packet', [`${ALLOC}/align`]: 'ladder', [`${KV}/capacity`]: 'packet', [`${KV}/cow`]: 'ladder' })
const SEED_2 = seedWhere({ [`${ALLOC}/fragmentation`]: 'packet', [`${ALLOC}/coalesce`]: 'ladder' })

interface Walker {
  at(n: number, hhmm: string): void
  run(lab: string, passed: readonly string[]): void
  rung(lab: string, check: string, rung: RungId, seed: number | undefined): void
  packet(lab: string, check: string, seed: number): void
  prove(lab: string): void
  probe(kc: string, ok: boolean): void
}

/** One learner's ledger, written on one tab whose clock the script moves. */
async function learner(script: (w: Walker) => void): Promise<LedgerEvent[]> {
  const profile = makeProfile({ ms: Date.parse(`${day(0)}T09:00:00.000Z`) })
  const tab = startTab(profile)
  const s = () => tab.progress.getState()
  const w: Walker = {
    at: (n, hhmm) => {
      profile.clock.ms = Date.parse(`${day(n)}T${hhmm}:00.000Z`)
    },
    run: (labId, passed) => {
      // ForgeLab's onFile: every run draws fresh seeds, creditFor reads the ledger's window, and toLabRun is what is recorded
      const lab = labOf(labId)
      const report: LabRunReport = {
        lab: labId,
        reference: false,
        abi: 2,
        version: 1,
        seeds: 'fresh',
        ms: 2000,
        checks: lab.checks.map((c) => ({ id: c.id, label: c.label, status: passed.includes(c.id) ? 'pass' : 'fail', msg: '', stage: c.stage, seed: 7, fresh: true })),
      }
      const required = lab.checks.filter((c) => !c.optional).map((c) => c.id)
      const earlier = s().aggregate.labs[labId]
      const credit = creditFor(report, { unseen: earlier?.unseen, assistedUntil: earlier?.assistedUntil, at: profile.clock.nowIso() }, required)
      if (credit !== null) s().recordLabRun(toLabRun(report, credit, required))
    },
    rung: (lab, check, rung, seed) => {
      // HintLadder's openRung: the arm is the page's own `hintArm`, absent before the learner has a seed
      const arm = hintArm(lab, check, seed)
      s().acknowledge(hintRef(check, rung, lab), arm === undefined ? undefined : { arm })
    },
    packet: (lab, check, seed) => {
      // AskButtons' press: the ack records how the packet left (`ackVia`), its length and the arm that showed it
      const arm = hintArm(lab, check, seed)
      const result: Exclude<AskResult, { status: 'failed' }> = { status: 'opened', packet: { text: 'packet', chars: 900 } }
      s().recordHelp(`packet:lab/${lab}/${check}`, { via: ackVia(result, 'claude'), chars: result.packet.chars, ...(arm === undefined ? {} : { arm }) })
    },
    prove: (lab) => {
      const q = { id: 'q1', prompt: 'p', model: 'm', ideas: ['a', 'b', 'c'] as const, kcs: [FRAG_KC] }
      const result = buildProveResult([q], [{ answer: 'my answer', revealed: true, self: 1 }], { labId: lab, ms: 60_000 })
      if (result) s().recordProve(result)
    },
    probe: (kc, ok) =>
      s().recordItems([{ kind: 'probe', ref: 'gen:frag/first-fit', rev: 'r', score: ok ? 1 : 0, ok, provenance: 'unseen', ms: 20_000, data: { src: 'today', grp: 'g', slot: 0, of: 1, reason: 'probe', kcs: [kc], nsec: 40 } }]),
  }
  script(w)
  await tab.progress.controls.flush()
  return (await (await tab.engine()).events()) as LedgerEvent[]
}

const ALL_ALLOC = labOf(ALLOC).checks.map((c) => c.id)
const ALL_KV = labOf(KV).checks.filter((c) => !c.optional).map((c) => c.id)

/**
 * Learner 1, labs 01 and 02. `fragmentation` (ladder) climbs to the bottom-out, whose window credits the next run
 * `assisted`; `coalesce` (packet) takes two packets, goes green and is red again on later seeds; `align` (ladder) takes a
 * packet after R2; `no_overlap` goes green with no help; `reuse` was helped before the learner had a seed (§6.3).
 */
const learner1 = () =>
  learner((w) => {
    w.at(0, '10:00')
    w.run(ALLOC, ['boot'])
    w.at(0, '10:05')
    w.rung(ALLOC, 'reuse', 'R0', undefined)
    w.at(0, '10:10')
    for (const r of ['R0', 'R1', 'R2', 'R3', 'R4', 'bottom'] as const) w.rung(ALLOC, 'fragmentation', r, SEED_1)
    w.at(0, '10:15')
    w.rung(ALLOC, 'coalesce', 'R0', SEED_1)
    w.packet(ALLOC, 'coalesce', SEED_1)
    w.packet(ALLOC, 'coalesce', SEED_1)
    w.at(0, '10:20')
    for (const r of ['R0', 'R1', 'R2'] as const) w.rung(ALLOC, 'align', r, SEED_1)
    w.packet(ALLOC, 'align', SEED_1)
    w.at(0, '11:00')
    w.run(ALLOC, ['boot', 'align', 'no_overlap', 'coalesce', 'reuse'])
    w.at(2, '10:00')
    w.run(ALLOC, ALL_ALLOC)
    w.at(3, '10:00')
    w.run(ALLOC, ALL_ALLOC.filter((c) => c !== 'coalesce'))
    w.at(3, '12:00')
    w.prove(ALLOC)
    w.at(5, '10:00')
    w.run(KV, ['paging'])
    w.rung(KV, 'capacity', 'R0', SEED_1)
    w.packet(KV, 'capacity', SEED_1)
    w.rung(KV, 'cow', 'R0', SEED_1)
    w.rung(KV, 'cow', 'R1', SEED_1)
    w.at(6, '10:00')
    w.run(KV, ALL_KV)
    // Today's cold checks, 30 and 31 days after lab 01's first all-green run (day 2)
    w.at(32, '09:00')
    w.probe(FRAG_KC, true)
    w.probe(COALESCE_KC, false)
    w.probe(CONTRACT_KC, true)
  })

/** Learner 2, lab 01 only: `fragmentation` in the packet arm and `coalesce` in the ladder arm, green on the second run, no Prove-it, both cold checks right. */
const learner2 = () =>
  learner((w) => {
    w.at(0, '10:00')
    w.run(ALLOC, ['boot', 'align', 'no_overlap', 'reuse'])
    w.rung(ALLOC, 'fragmentation', 'R0', SEED_2)
    w.packet(ALLOC, 'fragmentation', SEED_2)
    w.rung(ALLOC, 'coalesce', 'R0', SEED_2)
    w.rung(ALLOC, 'coalesce', 'R1', SEED_2)
    w.at(1, '10:00')
    w.run(ALLOC, ALL_ALLOC)
    w.at(31, '09:00')
    w.probe(FRAG_KC, true)
    w.probe(COALESCE_KC, true)
  })

/**
 * Learner 3, lab 01 only, on two devices that each drew their own `exp:seed` before the ledgers synced (prereg §2):
 * `fragmentation` was helped under the ladder arm on one (SEED_1) and the packet arm on the other (SEED_2), so the check
 * has both arms recorded. It goes green on the second run and has a cold check on day 31.
 */
const learner3 = () =>
  learner((w) => {
    w.at(0, '10:00')
    w.run(ALLOC, ALL_ALLOC.filter((c) => c !== 'fragmentation'))
    w.rung(ALLOC, 'fragmentation', 'R0', SEED_1)
    w.rung(ALLOC, 'fragmentation', 'R1', SEED_1)
    w.packet(ALLOC, 'fragmentation', SEED_2)
    w.at(1, '10:00')
    w.run(ALLOC, ALL_ALLOC)
    w.at(32, '09:00')
    w.probe(FRAG_KC, true)
  })

let fixture: Promise<PartnerLedger[]> | null = null
const ledgers = () => (fixture ??= Promise.all([learner1(), learner2()]).then((ls) => ls.map((events) => ({ events }))))

/** The same ledgers as donations, through the whitelist and the parser, as the partner report reads them. */
async function donated(): Promise<PartnerLedger[]> {
  return (await ledgers()).map((l) => {
    const parsed = parseDonation(JSON.stringify(redactForPartner({ events: l.events, working: [] })))
    if (!parsed.ok) throw new Error(parsed.error)
    return ledgerOfDonation(parsed.donation)
  })
}

const report = async (ls: PartnerLedger[], signed = true, afterDecision = false) =>
  buildWave3Report(ls, { cards: CONTENT, signed: { hintLadders: signed, fleetDaily: false }, afterDecision })

type Opts = Parameters<typeof selectHintArms>[2]
/** The secondary outputs beside the primary's own decision on the same ledgers (as `buildWave3Report` reads them). */
const secondary = (ls: PartnerLedger[], opts: Opts = {}, afterDecision = false) => selectHintSecondary(ls, CONTENT, RULES, selectHintArms(ls, CONTENT, opts), { ...opts, afterDecision })
/** A primary that reached its required n, for the lines once the outcomes are shown. */
const POWERED: HintDecision = { learners: HINT_MIN_LEARNERS, required: HINT_MIN_LEARNERS, verdict: 'keep' }

/** Everything but the release order, which a donation cannot carry. */
const comparable = (s: HintSecondary) => ({ ...s, release: undefined, releaseLedgers: undefined, releaseDonations: undefined })

describe('the recorders write what the measures read', () => {
  test('lab runs carry passed, provenance and ms; acks carry the arm, or none before a seed; packets, Prove-it and probes are written', async () => {
    const [one] = await ledgers()
    const runs = one.events.filter((e) => e.kind === 'lab-check' && e.ref === `lab:${ALLOC}`)
    expect(runs.map((e) => (e as { data: { passed: string[] } }).data.passed.length)).toEqual([1, 5, 6, 5])
    expect(runs.map((e) => (e as { provenance: string }).provenance)).toEqual(['lab-green', 'assisted', 'unseen', 'unseen'])
    expect(runs.every((e) => (e as { ms?: number }).ms === 2000)).toBe(true)
    const acks = one.events.filter((e) => e.kind === 'ack')
    const arm = (ref: string) => (acks.find((e) => e.ref === ref) as { data?: { arm?: string } } | undefined)?.data?.arm
    expect(arm(`hint:${ALLOC}/fragmentation#bottom`)).toBe('ladder')
    expect(arm(`hint:${ALLOC}/coalesce#R0`)).toBe('packet')
    expect(arm(`hint:${ALLOC}/reuse#R0`)).toBeUndefined()
    expect(acks.filter((e) => e.ref === `packet:lab/${ALLOC}/coalesce`)).toHaveLength(2)
    expect((acks.find((e) => e.ref === `packet:lab/${ALLOC}/align`) as { data: unknown }).data).toEqual({ via: 'claude', chars: 900, arm: 'ladder' })
    expect(one.events.filter((e) => e.kind === 'prove' && e.ref === `prove:${ALLOC}`)).toHaveLength(1)
    expect(one.events.filter((e) => e.kind === 'probe')).toHaveLength(3)
  })
})

describe('selectHintSecondary', () => {
  test('the population: the checks ever red, by recorded arm, with what no arm holds', async () => {
    const s = secondary(await ledgers())
    expect(s.partners).toBe(2)
    // learner 1: frag, align, cow ladder; coalesce, capacity packet; reuse unarmed; no_overlap, fork_shares, free_refcount, gauntlet never helped
    // learner 2: coalesce ladder; fragmentation packet
    expect(s.standing).toEqual({ ladder: 4, packet: 3, both: 0, unarmed: 1, none: 4 })
    expect(s.everRed).toBe(12)
    expect(s.runsWithoutDetail).toBe(0)
  })

  test('(1) the intention-to-treat d is the primary\'s on the armed checks, and a check green without help is in the population but in no d', async () => {
    const ls = await ledgers()
    const s = secondary(ls, { kcs: COVERED })
    const p = selectHintArms(ls, CONTENT, { kcs: COVERED })
    // learner 1: ladder frag right (align and cow have no probe), packet coalesce wrong, d = 1; learner 2: both right, d = 0
    expect(p.diff.mean).toBe(0.5)
    // the same population (D80): its counts are the primary's, and its d is the primary's own, never bootstrapped again
    expect(s.itt.learners).toBe(2)
    expect([s.itt.learners, s.itt.partners, s.itt.checks]).toEqual([p.learners, p.partners, p.checks])
    expect(Object.keys(s.itt).sort()).toEqual(['checks', 'learners', 'partners', 'unhelped'])
    // `no_overlap` went green without help: in the population, out of the primary, its cold check reported alone
    expect(s.itt.unhelped).toMatchObject({ n: 1, correct: 1 })
    // `reuse` (§6.3) is excluded in both, as is the check with both arms
    expect(p.unarmed).toBe(1)
    expect(s.standing.unarmed).toBe(1)
  })

  test('(2) to (4): attempts, the unseen-seed gap and the time to green, by arm and for the checks never helped', async () => {
    const s = secondary(await ledgers())
    const { ladder, packet } = s.arms
    // ladder: frag (runs 1–3: 3), align (runs 1–2: 2), cow (2), learner 2's coalesce (2)
    expect(ladder.attempts).toEqual({ n: 4, median: 2 })
    // packet: coalesce (2), capacity (2), learner 2's frag (2)
    expect(packet.attempts).toEqual({ n: 3, median: 2 })
    expect([ladder.notGreen, packet.notGreen]).toEqual([0, 0])
    // after its first green (run 2) coalesce ran twice more and was red once; frag's first green is run 3, then one run
    expect(packet.gap).toMatchObject({ correct: 1, n: 2, checks: 1 })
    expect(ladder.gap).toMatchObject({ correct: 0, n: 3, checks: 2 })
    // each run records 2 s: frag's span is three runs, 0.1 minutes; the whole days from day 0 to day 2
    expect(ladder.minutes.median).toBeCloseTo(4000 / 60_000, 12)
    expect(ladder.days).toEqual({ n: 4, median: 1 })
    expect(s.unhelped).toMatchObject({ checks: 4, attempts: { n: 4, median: 2 }, notGreen: 0 })
    expect(ladder.untimed + packet.untimed).toBe(0)
  })

  test('(5) to (10) and (13): help, packets, rungs, bottom-outs, Prove-it and help-seeking', async () => {
    const s = secondary(await ledgers())
    const { ladder, packet } = s.arms
    // 12 checks red in a run: reuse (unarmed) is help too, and so are the 7 armed ones; no_overlap and three of lab 02 had none
    expect(s.helped).toMatchObject({ correct: 8, n: 12 })
    expect([ladder.packetUses, packet.packetUses]).toEqual([1, 4])
    expect(ladder.packetChecks).toMatchObject({ correct: 1, n: 4 })
    expect(packet.packetChecks).toMatchObject({ correct: 3, n: 3 })
    expect(ladder.rungs).toEqual({ R0: 0, R1: 2, R2: 1, R3: 0, R4: 0, bottom: 1, none: 0 })
    expect(packet.rungs).toEqual({ R0: 3, R1: 0, R2: 0, R3: 0, R4: 0, bottom: 0, none: 0 })
    expect([ladder.bottomOuts, ladder.assistedRuns, packet.bottomOuts, packet.assistedRuns]).toEqual([1, 1, 0, 0])
    expect(s.bottomOutsElsewhere).toBe(0)
    // learner 1's lab 01 (both arms) was proved; lab 02 (both arms) and learner 2's lab 01 (both arms) were not
    expect(s.prove.mixed).toMatchObject({ correct: 1, n: 3 })
    expect(s.prove.all).toMatchObject({ correct: 1, n: 3 })
    expect([ladder.hintAcks, packet.hintAcks]).toEqual([6 + 3 + 2 + 2, 3])
    expect([ladder.learners, packet.learners]).toEqual([2, 2])
  })

  test('(11) the lab-by-arm table and (12) the release order', async () => {
    const s = secondary(await ledgers())
    const alloc = s.labs.find((l) => l.lab === ALLOC)
    // the real graph: only `fragmentation` has a generator family, so only it has an outcome
    expect(alloc?.arms.ladder).toMatchObject({ checks: 3, help: 6 + 4 + 2, accuracy: { n: 1, correct: 1 } })
    expect(alloc?.arms.packet).toMatchObject({ checks: 2, help: 3 + 2, accuracy: { n: 1, correct: 1 } })
    expect(s.labs.find((l) => l.lab === KV)?.arms.ladder).toMatchObject({ checks: 1, help: 2, accuracy: { n: 0 } })
    expect(s.release).toEqual([
      { lab: ALLOC, day: day(0) },
      { lab: KV, day: day(5) },
      { lab: 'bpe-tokenizer', day: null },
    ])
    expect([s.releaseLedgers, s.releaseDonations]).toEqual([2, 0])
  })
})

describe('a donation', () => {
  test('reads every measure as its export does, except the release order, which it cannot carry', async () => {
    const own = secondary(await ledgers(), { kcs: COVERED })
    const gift = secondary(await donated(), { kcs: COVERED })
    expect(comparable(gift)).toEqual(comparable(own))
    expect(gift.release.every((r) => r.day === null)).toBe(true)
    expect([gift.releaseLedgers, gift.releaseDonations]).toEqual([0, 2])
    expect(formatHintSecondary(gift).join('\n')).toContain('not available from donations: 2 donations carry day offsets')
    // and its JSON view holds back the same values
    const view = (s: HintSecondary) => ({ ...hintSecondaryJson(s), release: undefined, releaseLedgers: undefined, releaseDonations: undefined })
    expect(view(gift)).toEqual(view(own))
  })

  test('without per-check results (a donation made before they were kept) no check is red or green, and the report says so', async () => {
    const stripped = (await donated()).map((l) => ({ events: l.events.map((e) => (e.kind === 'lab-check' ? ({ ...e, data: {} } as unknown as LedgerEvent) : e)) }))
    const s = secondary(stripped)
    expect(s.runsWithoutDetail).toBe(8)
    // only helped checks remain, and none has a run that turned it green
    expect(s.standing.none).toBe(0)
    expect(s.arms.ladder.attempts.n).toBe(0)
    expect(formatHintSecondary(s).join('\n')).toContain('8 runs without per-check results')
  })
})

describe('a check with both arms recorded (prereg §2)', () => {
  test('is counted in the population\'s `both`, in no per-arm line, and matches the primary\'s `both`', async () => {
    const two = await ledgers()
    const three = [...two, { events: await learner3() }]
    for (const opts of [{}, { kcs: COVERED }]) {
      const a = secondary(two, opts)
      const b = secondary(three, opts)
      const p = selectHintArms(three, CONTENT, opts)
      expect(b.standing).toEqual({ ...a.standing, both: 1 })
      expect(p.both).toBe(1)
      expect(b.standing.both).toBe(p.both)
      // every per-arm line reads what it read without the learner: arms, the lab-by-arm table, the ITT's armed checks
      expect(b.arms).toEqual(a.arms)
      expect(b.labs).toEqual(a.labs)
      expect(b.itt.checks).toEqual(a.itt.checks)
      expect(b.bottomOutsElsewhere).toBe(a.bottomOutsElsewhere)
      // its help is in the pooled share, and its lab, green with no single-arm check, is a Prove-it lab with no armed help
      expect(b.helped).toMatchObject({ correct: a.helped.correct + 1, n: a.helped.n + 1 })
      expect(b.prove.none.n).toBe(a.prove.none.n + 1)
      expect([b.prove.ladder, b.prove.packet, b.prove.mixed]).toEqual([a.prove.ladder, a.prove.packet, a.prove.mixed])
    }
    const text = formatHintSecondary(secondary(three))
    expect(text[1]).toContain('1 with both arms (§2)')
  })
})

describe('the Wave 3 report', () => {
  const NAMES = [
    'secondary outputs, reported and not decisive (docs/prereg/hint-ladders.md §3 and §5), among 2 donors',
    '§3 intention to treat (secondary), every check that was ever red, by recorded arm',
    '§3 attempts to green',
    '§3 the unseen-seed gap',
    '§3 minutes to green',
    '§3 the share of red checks with any help',
    "§3 packet use per red check by arm, which is also §5's contamination check (packet use per arm)",
    '§3 rungs reached',
    '§3 bottom-outs and the 24 h "assisted" windows they open',
    '§3 Prove-it attempt rate',
    '§5 lab-by-arm table, the carry-over check',
    '§5 release order of the randomized labs',
    '§5 help-seeking counts per arm, the safety read',
  ]
  /** F2's block: the lines between F2's two row lines and F3's row. */
  const block = (text: string) => {
    const lines = text.split('\n')
    return lines.slice(lines.findIndex((l) => l.startsWith('F2  ')) + 2, lines.findIndex((l) => l.startsWith('F3  ')))
  }
  /** The lines that read an outcome (§5 holds them back until the decision): the ITT's cold check, attempts, gap, minutes, Prove-it and the lab-by-arm table. */
  const HELD = ['§3 intention to treat', '§3 attempts to green', '§3 the unseen-seed gap', '§3 minutes to green', '§3 Prove-it attempt rate', '§5 lab-by-arm table', 'rust-allocator: ', 'kv-block-manager: ', 'bpe-tokenizer: ']
  const heldLines = (lines: string[]) => lines.filter((l) => HELD.some((h) => l.trimStart().startsWith(h)))

  test('prints every secondary line once, directly under F2\'s row, from exports and from donations', async () => {
    for (const ls of [await ledgers(), await donated()]) {
      const text = formatWave3Report(await report(ls))
      for (const name of NAMES) expect(text.split(name).length - 1, name).toBe(1)
      const lines = block(text)
      expect(lines[0]).toBe(`      ${NAMES[0]} (self-selected; no causal claim beyond the randomization within them), by the recorded arm of the check, labs 01 to 03:`)
      expect(lines).toHaveLength(formatHintSecondary(secondary(ls)).length)
      // §5's "among n donors": the population is counted from the donors, not "over N learners"
      expect(lines[1]).toContain('from 2 of the 2 donors')
      expect(text).not.toContain('over 2 learners')
      for (const lab of [ALLOC, KV, 'bpe-tokenizer']) expect(lines.filter((l) => l.startsWith(`            ${lab}: ladder`))).toHaveLength(1)
    }
  })

  test('below the minimum: counts and help-seeking only; each outcome line prints its name and n, held back until the decision', async () => {
    for (const opts of [{}, { kcs: COVERED }]) {
      const text = formatHintSecondary(secondary(await ledgers(), opts))
      const held = heldLines(text)
      expect(held).toHaveLength(HELD.length)
      for (const line of held) {
        expect(line).not.toMatch(/\d %/)
        expect(line).not.toMatch(/points|bound|median|Wilson|no outcome|\d of \d+( [a-z ]+)? = /)
      }
      for (const line of held.slice(0, 6)) expect(line).toContain('held back until the decision (§5: no interim looks at outcomes; n = ')
      expect(held[1]).toContain('ladder n = 4; packet n = 3; never helped n = 4')
      expect(held[3]).toContain('ladder n = 4; packet n = 3; never helped n = 4')
      expect(held[4]).toContain('both arms n = 3 labs; no armed help n = 0 labs; all n = 3 labs')
      expect(held[6]).toContain(`accuracy n = ${opts.kcs ? 2 : 1}; packet`)
      // the lines §5 lets be read: the population, help, packets, rungs, bottom-outs, release order and help-seeking
      const shown = text.filter((l) => !held.includes(l))
      expect(shown.join('\n')).toContain('8 of 12 red checks = 66.7 %')
      expect(shown.join('\n')).not.toContain('held back')
    }
    // with the real graph the primary has no learner in both arms; with every KC covered it has 2, still below 126
    expect(formatHintSecondary(secondary(await ledgers(), { kcs: COVERED })).join('\n')).toContain('n = 2 of 126 learners with a cold check in both arms')
  })

  test('shown once the primary reaches its n, and with --after-decision below it: the same readings', async () => {
    const ls = await ledgers()
    const powered = formatHintSecondary(selectHintSecondary(ls, CONTENT, RULES, POWERED, { kcs: COVERED }))
    const after = formatHintSecondary(secondary(ls, { kcs: COVERED }, true))
    expect(after).toEqual(powered)
    const held = heldLines(after)
    expect(held.join('\n')).not.toContain('held back')
    expect(held[0]).toContain('their first cold check 1 of 1 = 100.0 %')
    expect(held[1]).toContain('ladder median 2 (n = 4), 0 not green yet')
    expect(held[2]).toContain('red again in 1 of 2 later runs = 50.0 %')
    expect(held[4]).toContain('both arms 1 of 3 labs = 33.3 %')
    expect(held[6]).toContain('accuracy 2 of 2 = 100.0 %')
    // no line prints a d: the ITT's is the primary's (D80), so one d never prints with two sets of bounds
    expect(after.join('\n')).not.toMatch(/points|bootstrap/)
    // the report: F2's row says it was read after the decision, and its block shows the outcomes
    const text = formatWave3Report(await report(ls, true, true))
    expect(text).toContain('F2  hint ladders keep-or-kill → NOT ENOUGH DATA (read after the decision was recorded: --after-decision)\n')
    // (the report reads the real graph, on which only `fragmentation` has an outcome)
    expect(block(text)).toEqual(formatHintSecondary(secondary(ls, {}, true)).map((l) => `      ${l}`))
    expect(block(text).join('\n')).toContain('accuracy 1 of 1 = 100.0 %')
  })

  test('--json holds back what the text holds back, keeps each n and the verdict, and shows it all after the decision', async () => {
    for (const opts of [{}, { kcs: COVERED }]) {
      const s = secondary(await ledgers(), opts)
      const view = JSON.parse(JSON.stringify(hintSecondaryJson(s)))
      expect(view.itt.unhelped).toEqual({ n: s.itt.unhelped.n, held: true })
      expect(view.arms.ladder.attempts).toEqual({ n: 4, held: true })
      expect(view.arms.packet.gap).toEqual({ n: 2, checks: 1, held: true })
      expect(view.arms.ladder.minutes).toEqual({ n: 4, held: true })
      expect(view.unhelped.notGreen).toEqual({ held: true })
      expect(view.prove.mixed).toEqual({ n: 3, held: true })
      expect(view.labs[0].arms.ladder.accuracy).toEqual({ n: s.labs[0].arms.ladder.accuracy.n, held: true })
      expect(s.labs[0].arms.ladder.accuracy.n).toBe(opts.kcs ? 2 : 1)
      // the counts and help-seeking stay
      expect(view.helped).toEqual(s.helped)
      expect(view.arms.ladder.rungs).toEqual(s.arms.ladder.rungs)
      expect([view.arms.ladder.packetUses, view.arms.ladder.hintAcks, view.arms.ladder.notGreen]).toEqual([1, 13, 0])
      expect(view.labs[0].arms.ladder.help).toBe(12)
      // a held value carries nothing but its counts
      const heldValues: Record<string, unknown>[] = []
      const walk = (x: unknown) => {
        if (x === null || typeof x !== 'object') return
        if ((x as { held?: unknown }).held === true) heldValues.push(x as Record<string, unknown>)
        for (const v of Object.values(x)) walk(v)
      }
      walk(view)
      expect(heldValues.length).toBeGreaterThan(10)
      for (const v of heldValues) for (const k of Object.keys(v)) expect(['n', 'checks', 'held']).toContain(k)
      expect(hintSecondaryJson(secondary(await ledgers(), opts, true))).toEqual(secondary(await ledgers(), opts, true))
    }
    // the report's JSON: the primary's d is held below its minimum, its verdict and n stay; after the decision, all of it
    const r = await report(await ledgers())
    const view = JSON.parse(JSON.stringify(wave3ReportJson(r)))
    expect(view.hint).toEqual({ ...r.hint, diff: { n: 0, held: true } })
    expect(view.hint.verdict).toBe('underpowered')
    expect(view.hintSecondary.arms.ladder.attempts).toEqual({ n: 4, held: true })
    const after = await report(await ledgers(), true, true)
    expect(JSON.stringify(wave3ReportJson(after))).toBe(JSON.stringify(after))
  })

  test('nothing while the pre-registration is unsigned: no block, and the row says it is not read', async () => {
    const r = await report(await ledgers(), false)
    expect(r.hintSecondary).toBeNull()
    const text = formatWave3Report(r)
    expect(text).not.toContain('secondary outputs')
    expect(text).not.toContain('hint-ladders.md §3 and §5')
    expect(text).toContain('docs/prereg/hint-ladders.md is not signed')
    // --after-decision reads nothing either: the row says nothing about a decision it did not read
    expect(formatWave3Report(await report(await ledgers(), false, true))).toBe(text)
  })

  test('reproduces byte for byte from the same ledgers, and from the same learners written again on new tabs', async () => {
    const a = formatWave3Report(await report(await ledgers()))
    const b = formatWave3Report(await report(await donated()))
    expect(formatWave3Report(await report(await ledgers()))).toBe(a)
    expect(formatWave3Report(await report(await donated()))).toBe(b)
    const again = (await Promise.all([learner1(), learner2()])).map((events) => ({ events }))
    expect(formatWave3Report(await report(again))).toBe(a)
    expect(JSON.stringify(wave3ReportJson(await report(again)))).toBe(JSON.stringify(wave3ReportJson(await report(await ledgers()))))
  })

  test('the primary reads what it read before this task: its numbers and its lines, pinned', async () => {
    const ls = await ledgers()
    expect(JSON.stringify(selectHintArms(ls, CONTENT, { kcs: COVERED }))).toBe(PINNED_PRIMARY_COVERED)
    expect(JSON.stringify(selectHintArms(await donated(), CONTENT, { kcs: COVERED }))).toBe(PINNED_PRIMARY_COVERED)
    const r = await report(ls)
    expect(JSON.stringify(r.hint)).toBe(PINNED_PRIMARY_REPORT)
    const text = formatWave3Report(r).split('\n')
    const at = text.findIndex((l) => l.startsWith('F2  '))
    expect(text.slice(at, at + 2)).toEqual(PINNED_F2_LINES)
    expect(text.find((l) => l.startsWith('  hint ladders: '))).toBe(PINNED_KEEP_OR_KILL)
    // read after the decision, the row says so and its detail is the same line; the verdict is the same
    const after = await report(ls, true, true)
    expect(JSON.stringify(after.hint)).toBe(PINNED_PRIMARY_REPORT)
    const lines = formatWave3Report(after).split('\n')
    expect(lines.slice(at, at + 2)).toEqual([`${PINNED_F2_LINES[0]} (read after the decision was recorded: --after-decision)`, PINNED_F2_LINES[1]])
    expect(lines.find((l) => l.startsWith('  hint ladders: '))).toBe(PINNED_KEEP_OR_KILL)
  })
})

/* The primary's output on the fixture, recorded at the base (wave-3x d31a770) before this task changed outcomes.ts. */
const PINNED_PRIMARY_COVERED =
  '{"learners":2,"partners":2,"checks":{"ladder":2,"packet":2},"both":0,"unarmed":1,"diff":{"n":2,"mean":0.5,"lower":0,"upper":1,"ci95":[0,1]},"required":126,"verdict":"underpowered","because":null}'
const PINNED_PRIMARY_REPORT =
  '{"learners":0,"partners":2,"checks":{"ladder":1,"packet":1},"both":0,"unarmed":1,"diff":{"n":0,"mean":null,"lower":null,"upper":null,"ci95":null},"required":126,"verdict":"underpowered","because":null}'
const PINNED_F2_LINES = [
  'F2  hint ladders keep-or-kill → NOT ENOUGH DATA',
  '      not enough data (n = 0 of 126 learners with a cold check in both arms, 2 partners; 1 ladder and 1 packet checks)',
]
const PINNED_KEEP_OR_KILL = '  hint ladders: UNDERPOWERED, default: R0 to R2 only'
