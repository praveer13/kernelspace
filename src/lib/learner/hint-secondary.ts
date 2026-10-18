/**
 * F2's secondary outputs (docs/prereg/hint-ladders.md §3 and §5, wave-3.md D65): every measure the signed
 * pre-registration promises besides the primary, reported and never decisive. Nothing here feeds `hintVerdict`, and
 * `selectHintArms` (outcomes.ts) is not touched: the primary reads what it read before.
 *
 * Every measure is read from events the app records, on the randomized labs (`RANDOMIZED_LABS`) only:
 *   - `lab-check lab:<labId>`, one per graded run (ForgeLab `toLabRun` → the façade's `recordLabRun`): `data.passed`
 *     (the required checks that passed in that run), `provenance` (`assisted` inside a bottom-out's window), `ms` (the
 *     run's recorded time), `ok` (the lab is all green, cumulative);
 *   - `ack hint:<labId>/<checkId>#<rung>` (HintLadder `openRung` → `acknowledge`, once per rung): `data.arm`, absent
 *     when the rung opened before the arm was known; R0 is acked when the check's help is first expanded;
 *   - `ack packet:lab/<labId>/<checkId>` (AskButtons → `recordHelp`, one per use): `data.arm`, `via`, `chars`;
 *   - `prove prove:<labId>` (ProveIt and ProveFromModule → `recordProve`);
 *   - `probe gen:<family>/<variant>` (Today's cold checks): the primary's outcome, read here by the primary's own rule.
 *
 * A check's standing is its recorded arm: `ladder` or `packet` when every armed ack names that one arm; `both` (prereg
 * §2, dropped from the primary); `unarmed` when any ack carries no arm (prereg §6.3, excluded from the primary); `none`
 * when no help was ever acked. The page records an arm only on a help ack, and neither a donation nor the report's
 * stripped export keeps `exp:seed`, so a red check that was never helped has no recorded arm, and the pre-registration
 * (§2) never recomputes one: it is in the intention-to-treat population and reported beside the arms, in neither.
 * Every per-arm line reads `ladder` and `packet` only, so §6.3's exclusion applies to each of them as to the primary;
 * the header counts what each line leaves out.
 *
 * The primary's window and bootstrap are handed in (`PrimaryRules`) rather than imported, so this module and
 * outcomes.ts do not import each other (D53's rule for the learner modules).
 *
 * Pure: no clock, no randomness (the bootstrap is seeded), so a report reproduces byte for byte.
 */

import { SYSTEMS_FORGE_LABS } from '@/data/labs'
import { KCS } from '@/data/kc'
import type { Kc } from '@/lib/kc/types'
import { compareEvents } from '@/lib/ledger/merge'
import { parseHintRef } from '@/lib/ledger/refs'
import type { LedgerEvent, LocalDay } from '@/lib/ledger/types'
import { hash32 } from '@/lib/rng'
import type { CardsContent } from './cards'
import { RANDOMIZED_LABS } from './experiments'
import type { MeanDifference } from './outcomes'
import { proportionOf, type Proportion } from './proportion'
import { daysBetween } from './reentry'

export const ARMS = ['ladder', 'packet'] as const
export type ArmName = (typeof ARMS)[number]
/** A check's recorded arm (see the file comment). */
export type Standing = ArmName | 'both' | 'unarmed' | 'none'

/** The rungs in the order a learner opens them; the bottom-out is the last. */
export const RUNG_ORDER = ['R0', 'R1', 'R2', 'R3', 'R4', 'bottom'] as const
export type RungName = (typeof RUNG_ORDER)[number]

/** What the primary fixes and this module reuses: outcomes.ts `HINT_WINDOW_DAYS`, `bootstrapDraws` and `percentile`. */
export interface PrimaryRules {
  window: readonly [number, number]
  bootstrapDraws(items: readonly number[], stat: (sample: readonly number[]) => number | null, seed: number): number[]
  percentile(ascending: readonly number[], p: number): number | null
}

/** A median with the number of values behind it. */
export interface MedianOf {
  n: number
  median: number | null
}

export interface ArmSecondary {
  /** Checks with this standing, and the learners who hold one. */
  checks: number
  learners: number
  /** (2) Attempts to green: recorded runs from a check's first red run to its first green after it, inclusive. */
  attempts: MedianOf
  /** Checks red in a run that no later run turned green. */
  notGreen: number
  /** (3) The unseen-seed gap: later runs, each on new seeds, in which a check that had gone green was red again. */
  gap: Proportion & { checks: number }
  /** (4) Minutes to green: the `ms` of the lab's runs from the first red run to the first green, and the whole days between them. */
  minutes: MedianOf
  days: MedianOf
  /** Checks whose span has a run with no recorded `ms` (written before runs carried it), left out of `minutes`. */
  untimed: number
  /** (6) and (10): packet uses, and the checks with at least one. */
  packetUses: number
  packetChecks: Proportion
  /** (7) The highest rung opened per check; `none` for a check helped by packets alone. */
  rungs: Record<RungName | 'none', number>
  /** (8) Bottom-outs, the 24 h windows they open (one each) and the runs credited `assisted` inside them. */
  bottomOuts: number
  assistedRuns: number
  /** (13) Help acks: rungs opened (R0 included) and packet uses. */
  hintAcks: number
}

/** (11) One cell of the lab-by-arm table. */
export interface LabArmCell {
  checks: number
  help: number
  /** The primary's outcome (first cold check), pooled over checks; n = 0 where no check has one. */
  accuracy: Proportion
}

export type ProveMix = ArmName | 'mixed' | 'none'
export const PROVE_MIXES: readonly ProveMix[] = ['ladder', 'packet', 'mixed', 'none']

export interface HintSecondary {
  /** Learners with a check of the randomized labs that was ever red. */
  partners: number
  /** Every check ever red: red in a recorded run, or helped (help shows only under a red check). */
  everRed: number
  standing: Record<Standing, number>
  /** Runs of the randomized labs with no `passed` list (a donation made before it was kept): no check is red or green in them. */
  runsWithoutDetail: number
  /** (1) The intention-to-treat population, by recorded arm: the primary's d, outcome and bootstrap over these checks. */
  itt: {
    learners: number
    partners: number
    checks: Record<ArmName, number>
    diff: MeanDifference
    /** The red checks never helped, which carry no arm: their outcome, pooled. */
    unhelped: Proportion
  }
  arms: Record<ArmName, ArmSecondary>
  /** (2) to (4) for the red checks never helped, beside the arms. */
  unhelped: Pick<ArmSecondary, 'checks' | 'learners' | 'attempts' | 'notGreen' | 'gap' | 'minutes' | 'days' | 'untimed'>
  /** (5) Checks red in a recorded run that got any help (a `hint:` or `packet:` ack), pooled: a check with no help has no arm. */
  helped: Proportion
  /** (8) Bottom-outs on checks with no known arm (§6.3 or both arms), out of the per-arm counts. */
  bottomOutsElsewhere: number
  /** (9) All-green randomized labs followed by a `prove:<lab>` event, by the recorded arms of the lab's checks. */
  prove: Record<ProveMix, Proportion> & { all: Proportion }
  /** (11) Lab by arm. */
  labs: { lab: string; arms: Record<ArmName, LabArmCell> }[]
  /** (12) The day both an armed hint ack and an armed packet ack of the lab were first seen, from full exports. */
  release: { lab: string; day: LocalDay | null }[]
  /** Ledgers that went into `release` (full exports), and donations, which carry no calendar day (wave-3.md §15.2). */
  releaseLedgers: number
  releaseDonations: number
}

type Ledger = readonly LedgerEvent[]
type Rec = Record<string, unknown>

const dataOf = (e: LedgerEvent): Rec => {
  const d = (e as { data?: unknown }).data
  return typeof d === 'object' && d !== null ? (d as Rec) : {}
}
const isOk = (e: LedgerEvent): boolean => (e as { ok?: boolean }).ok === true
const provenanceOf = (e: LedgerEvent): unknown => (e as { provenance?: unknown }).provenance
const msOf = (e: LedgerEvent): number | null => {
  const ms = (e as { ms?: unknown }).ms
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms : null
}
const meanOf = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length)
const medianOf = (xs: readonly number[]): MedianOf => {
  if (xs.length === 0) return { n: 0, median: null }
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return { n: s.length, median: s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2 }
}
/** `ledgerOfDonation` marks every event of a donation with this device; its days are offsets, not calendar days. */
const DONOR_DEVICE = 'donor'
const isDonated = (events: Ledger): boolean => events.some((e) => (e as { dev?: unknown }).dev === DONOR_DEVICE)

/** One graded run of a randomized lab, as the selector reads it. */
interface Run {
  at: number
  day: LocalDay
  passed: ReadonlySet<string> | null
  ms: number | null
  assisted: boolean
}

/** One check of one ledger, with everything the lines below read. */
interface CheckRow {
  learner: number
  lab: string
  check: string
  standing: Standing
  redInRun: boolean
  attempts: number | null
  notGreen: boolean
  laterRuns: number
  redAgain: number
  minutes: number | null
  days: number | null
  untimed: boolean
  hintAcks: number
  packetUses: number
  top: RungName | null
  outcome: boolean | null
}

function standingOf(arms: ReadonlySet<string>, unarmed: boolean, helped: boolean): Standing {
  if (!helped) return 'none'
  if (unarmed) return 'unarmed'
  if (arms.size > 1) return 'both'
  return [...arms][0] as ArmName
}

const emptyRungs = (): Record<RungName | 'none', number> => ({ R0: 0, R1: 0, R2: 0, R3: 0, R4: 0, bottom: 0, none: 0 })

/**
 * The secondary outputs over the partners' ledgers. `rules` carries the primary's window and bootstrap; `opts` names
 * the labs and the KC graph, as `selectHintArms` takes them.
 */
export function selectHintSecondary(
  ledgers: readonly { events: Ledger }[],
  content: CardsContent,
  rules: PrimaryRules,
  opts: { labs?: typeof SYSTEMS_FORGE_LABS; kcs?: readonly Kc[] } = {},
): HintSecondary {
  const labs = (opts.labs ?? SYSTEMS_FORGE_LABS).filter((l) => RANDOMIZED_LABS.includes(l.id))
  const labIds = new Set(labs.map((l) => l.id))
  const covered = new Set((opts.kcs ?? KCS).filter((k) => (k.gen?.length ?? 0) > 0).map((k) => k.id))
  const rows: CheckRow[] = []
  const armsOf = new Map<string, ArmName | 'both' | 'unarmed' | 'none'>()
  const bottom: Record<ArmName, { outs: number; runs: number }> = { ladder: { outs: 0, runs: 0 }, packet: { outs: 0, runs: 0 } }
  let bottomOutsElsewhere = 0
  let runsWithoutDetail = 0
  const proveCounts: Record<ProveMix, { n: number; done: number }> = { ladder: { n: 0, done: 0 }, packet: { n: 0, done: 0 }, mixed: { n: 0, done: 0 }, none: { n: 0, done: 0 } }
  const releaseHint = new Map<string, LocalDay>()
  const releasePacket = new Map<string, LocalDay>()
  let releaseLedgers = 0
  let releaseDonations = 0
  const ittDs: number[] = []
  let ittPartners = 0

  ledgers.forEach((ledger, learner) => {
    const list = [...ledger.events].sort(compareEvents)
    const donated = isDonated(list)
    if (donated) releaseDonations += 1
    else releaseLedgers += 1
    const runs = new Map<string, Run[]>()
    const labGreen = new Map<string, LocalDay>()
    const labGreenAt = new Map<string, number>()
    const proved = new Map<string, number[]>()
    const arms = new Map<string, Set<string>>()
    const unarmed = new Set<string>()
    const hintAcks = new Map<string, number>()
    const packetUses = new Map<string, number>()
    const top = new Map<string, number>()
    // the bottom-outs of each lab in ledger order, for the runs their windows credit `assisted`
    const bottoms = new Map<string, { at: number; key: string }[]>()
    const assistedRuns = new Map<string, number[]>()

    list.forEach((e, at) => {
      if (e.kind === 'ack') {
        const hint = parseHintRef(e.ref)
        const packet = e.ref.startsWith('packet:lab/') ? e.ref.slice('packet:lab/'.length).split('/') : null
        const lab = hint ? hint.labId : packet && packet.length === 2 ? packet[0] : null
        const check = hint ? hint.checkId : packet && packet.length === 2 ? packet[1] : null
        if (lab === null || check === null || !labIds.has(lab)) return
        const key = `${lab}/${check}`
        const arm = dataOf(e).arm
        if (arm === 'ladder' || arm === 'packet') {
          arms.set(key, (arms.get(key) ?? new Set()).add(arm))
          if (!donated) {
            const seen = hint ? releaseHint : releasePacket
            const first = seen.get(lab)
            if (first === undefined || e.day < first) seen.set(lab, e.day)
          }
        } else unarmed.add(key)
        if (hint) {
          hintAcks.set(key, (hintAcks.get(key) ?? 0) + 1)
          const rank = (RUNG_ORDER as readonly string[]).indexOf(hint.rung)
          if (rank >= 0) top.set(key, Math.max(top.get(key) ?? -1, rank))
          if (hint.rung === 'bottom') bottoms.set(lab, [...(bottoms.get(lab) ?? []), { at, key }])
        } else packetUses.set(key, (packetUses.get(key) ?? 0) + 1)
      } else if (e.kind === 'lab-check' && e.ref.startsWith('lab:')) {
        const lab = e.ref.slice('lab:'.length)
        if (!labIds.has(lab)) return
        const raw = dataOf(e).passed
        const passed = Array.isArray(raw) ? new Set(raw.filter((x): x is string => typeof x === 'string')) : null
        if (passed === null) runsWithoutDetail += 1
        const assisted = provenanceOf(e) === 'assisted'
        runs.set(lab, [...(runs.get(lab) ?? []), { at, day: e.day, passed, ms: msOf(e), assisted }])
        if (assisted) assistedRuns.set(lab, [...(assistedRuns.get(lab) ?? []), at])
        if (isOk(e) && !labGreen.has(lab)) {
          labGreen.set(lab, e.day)
          labGreenAt.set(lab, at)
        }
      } else if (e.kind === 'prove' && e.ref.startsWith('prove:')) {
        const lab = e.ref.slice('prove:'.length)
        if (labIds.has(lab)) proved.set(lab, [...(proved.get(lab) ?? []), at])
      }
    })

    const outcomes: Record<ArmName, number[]> = { ladder: [], packet: [] }
    for (const lab of labs) {
      const labRuns = runs.get(lab.id) ?? []
      const required = new Set(lab.checks.filter((c) => !c.optional).map((c) => c.id))
      for (const check of lab.checks) {
        const key = `${lab.id}/${check.id}`
        const helped = arms.has(key) || unarmed.has(key)
        const standing = standingOf(arms.get(key) ?? new Set(), unarmed.has(key), helped)
        armsOf.set(`${learner}:${key}`, standing)
        // only a required check is listed in `passed`, so only a required one can be red in a run
        const red = (r: Run) => r.passed !== null && required.has(check.id) && !r.passed.has(check.id)
        const green = (r: Run) => r.passed !== null && r.passed.has(check.id)
        const firstRed = labRuns.findIndex(red)
        if (firstRed < 0 && !helped) continue
        const after = labRuns.findIndex((r, i) => i > firstRed && green(r))
        const firstGreen = labRuns.findIndex(green)
        const later = firstGreen < 0 ? [] : labRuns.slice(firstGreen + 1).filter((r) => r.passed !== null)
        const span = firstRed >= 0 && after >= 0 ? labRuns.slice(firstRed, after + 1) : null
        const timed = span !== null && span.every((r) => r.ms !== null)
        // the primary's outcome, by its own rule: the first generated cold check on the check's covered KCs in the window
        const wanted = new Set((check.kcs ?? []).filter((kc) => covered.has(kc)))
        const anchor = labGreen.get(lab.id)
        const cold =
          anchor === undefined || wanted.size === 0
            ? undefined
            : list.find((e) => {
                if (e.kind !== 'probe' || !e.ref.startsWith('gen:') || typeof (e as { ok?: unknown }).ok !== 'boolean' || provenanceOf(e) === 'assisted') return false
                const gap = daysBetween(anchor, e.day)
                return gap >= rules.window[0] && gap <= rules.window[1] && content.resolve(e).some((kc) => wanted.has(kc))
              })
        const row: CheckRow = {
          learner,
          lab: lab.id,
          check: check.id,
          standing,
          redInRun: firstRed >= 0,
          attempts: span === null ? null : span.length,
          notGreen: after < 0,
          laterRuns: later.length,
          redAgain: later.filter(red).length,
          minutes: span !== null && timed ? span.reduce((s, r) => s + (r.ms as number), 0) / 60_000 : null,
          days: span === null ? null : daysBetween(span[0].day, span[span.length - 1].day),
          untimed: span !== null && !timed,
          hintAcks: hintAcks.get(key) ?? 0,
          packetUses: packetUses.get(key) ?? 0,
          top: top.has(key) ? RUNG_ORDER[top.get(key) as number] : null,
          outcome: cold === undefined ? null : isOk(cold),
        }
        rows.push(row)
        if ((standing === 'ladder' || standing === 'packet') && row.outcome !== null) outcomes[standing].push(row.outcome ? 1 : 0)
      }

      // (8) each bottom-out opens one 24 h window on its lab; a run credited `assisted` belongs to the latest one before it
      for (const b of bottoms.get(lab.id) ?? []) {
        const s = armsOf.get(`${learner}:${b.key}`)
        if (s === 'ladder' || s === 'packet') bottom[s].outs += 1
        else bottomOutsElsewhere += 1
      }
      for (const at of assistedRuns.get(lab.id) ?? []) {
        const opener = (bottoms.get(lab.id) ?? []).filter((b) => b.at < at).pop()
        const s = opener === undefined ? undefined : armsOf.get(`${learner}:${opener.key}`)
        if (s === 'ladder' || s === 'packet') bottom[s].runs += 1
      }

      // (9) the lab's first all-green run, then a Prove-it attempt, by the arms its checks were helped under
      const greenAt = labGreenAt.get(lab.id)
      if (greenAt !== undefined) {
        const held = new Set(lab.checks.map((c) => armsOf.get(`${learner}:${lab.id}/${c.id}`)).filter((s): s is ArmName => s === 'ladder' || s === 'packet'))
        const mix: ProveMix = held.size === 0 ? 'none' : held.size > 1 ? 'mixed' : [...held][0]
        proveCounts[mix].n += 1
        if ((proved.get(lab.id) ?? []).some((at) => at > greenAt)) proveCounts[mix].done += 1
      }
    }
    if (outcomes.ladder.length + outcomes.packet.length > 0) ittPartners += 1
    if (outcomes.ladder.length > 0 && outcomes.packet.length > 0) ittDs.push((meanOf(outcomes.ladder) as number) - (meanOf(outcomes.packet) as number))
  })

  const of = (s: Standing) => rows.filter((r) => r.standing === s)
  const armLine = (list: CheckRow[]) => {
    const gapRows = list.filter((r) => r.laterRuns > 0)
    const laterRuns = gapRows.reduce((n, r) => n + r.laterRuns, 0)
    const redAgain = gapRows.reduce((n, r) => n + r.redAgain, 0)
    return {
      checks: list.length,
      learners: new Set(list.map((r) => r.learner)).size,
      attempts: medianOf(list.flatMap((r) => (r.attempts === null ? [] : [r.attempts]))),
      notGreen: list.filter((r) => r.redInRun && r.notGreen).length,
      gap: { ...proportionOf(redAgain, laterRuns), checks: gapRows.length },
      minutes: medianOf(list.flatMap((r) => (r.minutes === null ? [] : [r.minutes]))),
      days: medianOf(list.flatMap((r) => (r.days === null ? [] : [r.days]))),
      untimed: list.filter((r) => r.untimed).length,
    }
  }
  const armSecondary = (arm: ArmName): ArmSecondary => {
    const list = of(arm)
    const rungs = emptyRungs()
    for (const r of list) rungs[r.top ?? 'none'] += 1
    return {
      ...armLine(list),
      packetUses: list.reduce((n, r) => n + r.packetUses, 0),
      packetChecks: proportionOf(list.filter((r) => r.packetUses > 0).length, list.length),
      rungs,
      bottomOuts: bottom[arm].outs,
      assistedRuns: bottom[arm].runs,
      hintAcks: list.reduce((n, r) => n + r.hintAcks, 0),
    }
  }

  const standing: Record<Standing, number> = { ladder: 0, packet: 0, both: 0, unarmed: 0, none: 0 }
  for (const r of rows) standing[r.standing] += 1
  const redInRun = rows.filter((r) => r.redInRun)
  const unhelpedRows = of('none')
  const unhelpedOutcomes = unhelpedRows.filter((r) => r.outcome !== null)
  const draws = rules.bootstrapDraws(ittDs, meanOf, hash32('hint-ladders:itt'))
  const lo = rules.percentile(draws, 0.025)
  const hi = rules.percentile(draws, 0.975)
  const diff: MeanDifference =
    ittDs.length === 0 ? { n: 0, mean: null, lower: null, upper: null, ci95: null } : { n: ittDs.length, mean: meanOf(ittDs), lower: lo, upper: hi, ci95: lo === null || hi === null ? null : [lo, hi] }

  const cell = (lab: string, arm: ArmName): LabArmCell => {
    const list = rows.filter((r) => r.lab === lab && r.standing === arm)
    const known = list.filter((r) => r.outcome !== null)
    return { checks: list.length, help: list.reduce((n, r) => n + r.hintAcks + r.packetUses, 0), accuracy: proportionOf(known.filter((r) => r.outcome).length, known.length) }
  }
  const proveOf = (m: ProveMix) => proportionOf(proveCounts[m].done, proveCounts[m].n)
  const release = labs
    .map((l, i) => {
      const h = releaseHint.get(l.id)
      const p = releasePacket.get(l.id)
      return { lab: l.id, day: h === undefined || p === undefined ? null : h > p ? h : p, i }
    })
    .sort((a, b) => (a.day === b.day ? a.i - b.i : a.day === null ? 1 : b.day === null ? -1 : a.day < b.day ? -1 : 1))
    .map(({ lab, day }) => ({ lab, day }))

  return {
    partners: new Set(rows.map((r) => r.learner)).size,
    everRed: rows.length,
    standing,
    runsWithoutDetail,
    itt: {
      learners: diff.n,
      partners: ittPartners,
      checks: { ladder: of('ladder').filter((r) => r.outcome !== null).length, packet: of('packet').filter((r) => r.outcome !== null).length },
      diff,
      unhelped: proportionOf(unhelpedOutcomes.filter((r) => r.outcome).length, unhelpedOutcomes.length),
    },
    arms: { ladder: armSecondary('ladder'), packet: armSecondary('packet') },
    unhelped: armLine(unhelpedRows),
    helped: proportionOf(redInRun.filter((r) => r.standing !== 'none').length, redInRun.length),
    bottomOutsElsewhere,
    prove: {
      ladder: proveOf('ladder'),
      packet: proveOf('packet'),
      mixed: proveOf('mixed'),
      none: proveOf('none'),
      all: proportionOf(PROVE_MIXES.reduce((n, m) => n + proveCounts[m].done, 0), PROVE_MIXES.reduce((n, m) => n + proveCounts[m].n, 0)),
    },
    labs: labs.map((l) => ({ lab: l.id, arms: { ladder: cell(l.id, 'ladder'), packet: cell(l.id, 'packet') } })),
    release,
    releaseLedgers,
    releaseDonations,
  }
}

/* ------------------------------------------------------------------ */
/* The report's lines                                                  */
/* ------------------------------------------------------------------ */

const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)} %`)
const share = (p: Proportion, noun = ''): string =>
  p.n === 0 ? 'n/a (n = 0)' : `${p.correct} of ${p.n}${noun === '' ? '' : ` ${noun}`} = ${pct(p.rate)}${p.ci95 === null ? '' : `, Wilson 95 % interval ${pct(p.ci95[0])} to ${pct(p.ci95[1])}`}`
const num = (x: number | null, digits = 1): string => (x === null ? 'n/a' : Number.isInteger(x) ? String(x) : x.toFixed(digits))
const points = (x: number | null): string => (x === null ? 'n/a' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)} points`)
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const byArm = (f: (arm: ArmName) => string): string => ARMS.map((a) => `${a} ${f(a)}`).join('; ')

/**
 * F2's secondary outputs as report lines, each named by the pre-registration's own words and section. Null (the file is
 * unsigned) prints that they are not read, as the primary does.
 */
export function formatHintSecondary(s: HintSecondary | null): string[] {
  if (s === null) return ['F2 secondary outputs (docs/prereg/hint-ladders.md §3 and §5): not read, the pre-registration is unsigned']
  const a = s.arms
  const u = s.unhelped
  const itt = s.itt
  const median = (m: MedianOf, unit = '', units = unit): string => (m.n === 0 ? 'n/a (n = 0)' : `median ${num(m.median)}${m.median === 1 ? unit : units} (n = ${m.n})`)
  const rungs = (arm: ArmName): string => `${[...RUNG_ORDER, 'none' as const].map((r) => `${r === 'bottom' ? 'bottom-out' : r === 'none' ? 'packet only' : r} ${a[arm].rungs[r]}`).join(', ')} (n = ${a[arm].checks})`
  const labCell = (c: LabArmCell): string => `${plural(c.checks, 'check')}, ${plural(c.help, 'help ack')}, accuracy ${c.accuracy.n === 0 ? 'no outcome' : share(c.accuracy)}`
  return [
    'F2 secondary outputs (docs/prereg/hint-ladders.md §3 and §5): reported, never decisive; by the recorded arm of the check, labs 01 to 03',
    `  population: ${plural(s.everRed, 'check')} ever red (red in a recorded run, or helped) over ${plural(s.partners, 'learner')}: ladder ${s.standing.ladder}, packet ${s.standing.packet}; in no arm: ${s.standing.none} never helped (the page records an arm only on a help ack), ${s.standing.unarmed} helped before the arm was known (§6.3) and ${s.standing.both} with both arms (§2), which every per-arm line leaves out as the primary does${s.runsWithoutDetail > 0 ? `; ${plural(s.runsWithoutDetail, 'run')} without per-check results (a donation made before it kept them) mark no check red or green` : ''}`,
    `  §3 intention to treat (secondary), every check that was ever red, by recorded arm: ladder − packet ${points(itt.diff.mean)}, one-sided 97.5 % bootstrap bounds ${points(itt.diff.lower)} and ${points(itt.diff.upper)} (10,000 resamples over learners); n = ${itt.learners} learners with a cold check in both arms, ${plural(itt.partners, 'learner')} with any; ${itt.checks.ladder} ladder and ${itt.checks.packet} packet checks. Its armed checks are the primary's; the ${plural(s.standing.none, 'red check')} never helped carry no arm and are in no d: their first cold check ${share(itt.unhelped)}`,
    `  §3 attempts to green (recorded runs from a check's first red run to its first green, inclusive): ${byArm((x) => `${median(a[x].attempts)}, ${a[x].notGreen} not green yet`)}; never helped ${median(u.attempts)}, ${u.notGreen} not green yet`,
    `  §3 the unseen-seed gap (of the runs after a check's first green, each on newly drawn seeds, those in which it was red again): ${byArm((x) => `${plural(a[x].gap.checks, 'check')}, red again in ${share(a[x].gap, 'later runs')}`)}; never helped ${plural(u.gap.checks, 'check')}, red again in ${share(u.gap, 'later runs')}`,
    `  §3 minutes to green (the recorded time of the lab's runs, their \`ms\`, from a check's first red run to its first green; no event records the coding time between runs) and whole days: ${byArm((x) => `${median(a[x].minutes, ' min')}, ${median(a[x].days, ' day', ' days')}${a[x].untimed > 0 ? `, ${a[x].untimed} without recorded time` : ''}`)}; never helped ${median(u.minutes, ' min')}, ${median(u.days, ' day', ' days')}${u.untimed > 0 ? `, ${u.untimed} without recorded time` : ''}`,
    `  §3 the share of red checks with any help (a \`hint:\` or \`packet:\` ack; pooled, since a check with no help records no arm): ${share(s.helped, 'red checks')}`,
    `  §3 packet use per red check by arm, which is also §5's contamination check (packet use per arm): ${byArm((x) => `${plural(a[x].packetUses, 'use')}, ${num(a[x].checks === 0 ? null : a[x].packetUses / a[x].checks, 2)} a check; ${share(a[x].packetChecks, 'checks')} with any`)}`,
    `  §3 rungs reached (the highest rung opened per check): ${byArm(rungs)}`,
    `  §3 bottom-outs and the 24 h "assisted" windows they open (one each; windows on one lab may overlap): ${byArm((x) => `${plural(a[x].bottomOuts, 'bottom-out')}, ${plural(a[x].assistedRuns, 'run')} credited assisted inside them`)}${s.bottomOutsElsewhere > 0 ? `; ${s.bottomOutsElsewhere} on checks in no arm` : ''}`,
    `  §3 Prove-it attempt rate (all-green randomized labs followed by a Prove-it attempt, by the arms of the lab's helped checks): ladder only ${share(s.prove.ladder, 'labs')}; packet only ${share(s.prove.packet, 'labs')}; both arms ${share(s.prove.mixed, 'labs')}; no armed help ${share(s.prove.none, 'labs')}; all ${share(s.prove.all, 'labs')}`,
    '  §5 lab-by-arm table, the carry-over check (checks; help acks, rungs opened and packet uses; first cold-check accuracy where there is an outcome):',
    ...s.labs.map((l) => `      ${l.lab}: ${byArm((x) => labCell(l.arms[x]))}`),
    `  §5 release order of the randomized labs (descriptive, never an instrument): the first day the full exports show an armed hint and an armed packet for the lab, ${s.release.map((r) => `${r.lab} ${r.day ?? 'not seen'}`).join(', ')} (from ${plural(s.releaseLedgers, 'full export')})${s.releaseDonations > 0 ? `; not available from donations: ${plural(s.releaseDonations, 'donation')} carry day offsets from the learner's first event and no calendar day (wave-3.md §15.2), so they are not in it` : ''}`,
    `  §5 help-seeking counts per arm, the safety read: ${byArm((x) => `${plural(a[x].hintAcks, 'rung')} opened and ${plural(a[x].packetUses, 'packet use')} on ${plural(a[x].checks, 'check')} of ${plural(a[x].learners, 'learner')}, ${a[x].notGreen} not green yet`)}; "ask a human" is a link and records nothing`,
  ]
}
