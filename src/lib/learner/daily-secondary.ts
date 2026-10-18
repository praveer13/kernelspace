/**
 * The Fleet Daily's secondary outputs (docs/prereg/fleet-daily.md §3 and §5; wave-3.md D65): what the signed file says is
 * reported beside F3's decision and never feeds it. `buildWave3Report` reads them only once the file is signed, as it reads
 * the primary.
 *
 * - **Learners with a Daily** (§5): ledgers with an `incident` event on an `inc:daily/` ref (`recordDaily` writes it
 *   through the façade's `recordIncident`; a donation turns the date into a day offset, `inc:daily/d<k>`).
 * - **Eligible checks per group** (§5) and **the pooled accuracy of each group with its Wilson interval and n** (§3): the
 *   checks the primary counts, as `selectDailyVsOther` classifies them, with the learners behind each group.
 * - **Learners with a check in only one group** (§3), each group separately: a learner with an eligible check whose checks
 *   all fall in one group. They are in no difference.
 * - **The table per fault KC** (§3, §5's difficulty check): for each of the four fault KCs, the Daily-group and other-group
 *   accuracy with Wilson intervals, n and the learners behind each.
 *
 * A check is never classified here. `selectDailyVsOther` hands each eligible check it counts to the sink it is given
 * (`DailyCheck`): an `item` or `probe` on a `gen:sig/` ref with `ok` and provenance `unseen` (Today's `itemResponseOf`),
 * one per fault KC that `content.resolve` gives it (its `data.kcs`), at least 30 local days after that KC's card (cards.ts),
 * in the Daily group when an earlier `inc:daily/` event carried the KC in its `data.kcs` (`dailyResult`, `kcsFor`). So a
 * check sits in the same group in the primary and in every table here. Every field it reads survives a donation (§15.2:
 * `kcs`, provenance, `ok` and day offsets are kept).
 *
 * §4 shows nothing before the minimum: below `DAILY_MIN_LEARNERS` learners with a check in both groups the primary prints
 * no difference, and §5 lets only counts be read before the decision. So below it the accuracies here are not shown
 * either (two groups' accuracies side by side are the difference), and the counts are: checks and learners per group and
 * per KC, learners with a Daily, learners in one group only.
 *
 * Pure: no clock, no randomness. This module imports outcomes.ts for types only, so the two do not import each other.
 */

import { KC } from '@/data/kc/ids'
import type { DailyVsOther, PartnerLedger } from './outcomes'
import { proportionOf, type Proportion } from './proportion'

/** The four fault KCs of fleet-daily.md §2, in its order (`kcsFor` in world/daily.ts; the `sig` family's KCs besides the diagnosis skill). */
export const DAILY_FAULT_KCS: readonly string[] = [KC.kvCapacity, KC.admissionScheduling, KC.capacityPlanning, KC.prefillDecodeInterference]

/** One eligible check as `selectDailyVsOther` counted it: the ledger's index, one fault KC of the answer, its group and whether it was right. */
export interface DailyCheck {
  learner: number
  kc: string
  group: 'daily' | 'other'
  ok: boolean
}

/** A group's checks with their Wilson 95 % interval, and the learners who have one. */
export interface DailyCell extends Proportion {
  learners: number
}

export interface DailyKcRow {
  kc: string
  daily: DailyCell
  other: DailyCell
}

export interface DailySecondary {
  /** Ledgers read: the donors the results are "among" (§5). */
  donors: number
  /** Learners with an `inc:daily/` incident (§5's safety count). */
  withDaily: number
  /** The pooled accuracy of each group (§3); its `n` is §5's eligible checks per group. */
  daily: DailyCell
  other: DailyCell
  /** Learners with an eligible check in one group only (§3), and in both (the primary's learners). */
  onlyDaily: number
  onlyOther: number
  both: number
  /** The table per fault KC (§3): the four fault KCs, then any other KC a check named, so the rows add up to the pooled groups. */
  perKc: DailyKcRow[]
  /** Whether accuracies are shown: the primary reached its minimum (§4). Below it only counts are. */
  shown: boolean
  /** The primary's learners with a check in both groups, and the minimum it needs. */
  learners: number
  required: number
}

function cellOf(checks: readonly DailyCheck[]): DailyCell {
  const correct = checks.filter((c) => c.ok).length
  return { ...proportionOf(correct, checks.length), learners: new Set(checks.map((c) => c.learner)).size }
}

/**
 * F3's secondary outputs over the checks `selectDailyVsOther` counted (`checks`, from its sink, on the same `ledgers`),
 * beside the primary it gave (`primary`).
 */
export function selectDailySecondary(ledgers: readonly PartnerLedger[], checks: readonly DailyCheck[], primary: DailyVsOther): DailySecondary {
  const withDaily = ledgers.filter((l) => l.events.some((e) => e.kind === 'incident' && e.ref.startsWith('inc:daily/'))).length
  const groups = new Map<number, Set<DailyCheck['group']>>()
  for (const c of checks) groups.set(c.learner, (groups.get(c.learner) ?? new Set()).add(c.group))
  let onlyDaily = 0
  let onlyOther = 0
  let both = 0
  for (const g of groups.values()) {
    if (g.size === 2) both += 1
    else if (g.has('daily')) onlyDaily += 1
    else onlyOther += 1
  }
  const extra = [...new Set(checks.map((c) => c.kc))].filter((kc) => !DAILY_FAULT_KCS.includes(kc)).sort()
  const perKc = [...DAILY_FAULT_KCS, ...extra].map((kc) => ({
    kc,
    daily: cellOf(checks.filter((c) => c.kc === kc && c.group === 'daily')),
    other: cellOf(checks.filter((c) => c.kc === kc && c.group === 'other')),
  }))
  return {
    donors: ledgers.length,
    withDaily,
    daily: cellOf(checks.filter((c) => c.group === 'daily')),
    other: cellOf(checks.filter((c) => c.group === 'other')),
    onlyDaily,
    onlyOther,
    both,
    perKc,
    shown: primary.verdict !== 'underpowered',
    learners: primary.learners,
    required: primary.required,
  }
}

/* ------------------------------------------------------------------ */
/* The report's lines                                                  */
/* ------------------------------------------------------------------ */

const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)} %`)
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const counted = (c: DailyCell): string => `n = ${plural(c.n, 'check')}, ${plural(c.learners, 'learner')}`
const accuracy = (c: DailyCell): string =>
  c.n === 0 ? `no check (${counted(c)})` : `${c.correct} of ${c.n} = ${pct(c.rate)}${c.ci95 ? `, Wilson 95 % interval ${pct(c.ci95[0])} to ${pct(c.ci95[1])}` : ''} (${counted(c)})`

/**
 * The secondary block `formatWave3Report` prints under F3's row, each line named by fleet-daily.md's own words. Below
 * the primary's minimum, the counts and "not enough data" in place of each accuracy.
 */
export function formatDailySecondary(s: DailySecondary): string[] {
  const cell = (c: DailyCell): string => (s.shown ? accuracy(c) : counted(c))
  const thin = `not enough data (n = ${s.learners} of ${s.required} learners with a check in both groups; fleet-daily.md §4 shows no accuracy below that, so only counts)`
  const width = Math.max(...s.perKc.map((r) => r.kc.length))
  return [
    `secondary outputs, reported and not decisive (docs/prereg/fleet-daily.md §3 and §5), among ${plural(s.donors, 'donor')} (self-selected; observational, no causal claim):`,
    `  learners with a Daily: ${s.withDaily} of ${plural(s.donors, 'donor')}`,
    `  eligible checks per group: ${plural(s.daily.n, 'check')} on Daily KCs, ${plural(s.other.n, 'check')} on other KCs`,
    s.shown
      ? `  pooled accuracy of each group: Daily KCs ${accuracy(s.daily)}; other KCs ${accuracy(s.other)}`
      : `  pooled accuracy of each group: ${thin}; Daily KCs ${counted(s.daily)}; other KCs ${counted(s.other)}`,
    `  learners with a check in only one group: ${s.onlyDaily} with Daily-KC checks only, ${s.onlyOther} with other-KC checks only (${s.both} with both)`,
    `  the table per fault KC (an answer counts once for each fault KC it carries)${s.shown ? '' : `: ${thin}`}`,
    ...s.perKc.map((r) => `    ${r.kc.padEnd(width)}  Daily KCs ${cell(r.daily)} | other KCs ${cell(r.other)}`),
  ]
}
