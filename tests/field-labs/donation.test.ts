/**
 * What a donation can reveal of a field reading (docs/specs/wave-3.md §15.2, refined for provenance `field`; the 3s
 * review's G13). A field item's score is Boot's `gradeWithin2x`, 1 − |log10(value ÷ prediction)|, and the real-engine
 * run's is the same rule (`estimateScore` at a factor of 2), and both predictions can be known: a field lab's is the page's
 * own, and the engine's a learner may share. So a donated score gave the measurement back up to the sign of the ratio.
 * A donation now keeps one bit of a field event, `ok`, and this file holds it to that:
 *
 * - the walk: every event the two field labs and the real-engine run write (`item:field.<lab>.<metric>`, and
 *   `item:engine.measured-tps`'s `predict` and `item`), written by their own recorders through the façade, donated, with
 *   each kept field named;
 * - the reconstruction: over readings spread across three decades around the public prediction, no guess built from a
 *   donated event lands within a factor of 1.5 of the measurement more often than the best guess that knows only `ok`;
 * - the selectors: the partner report reads every donated ledger the same whether or not a field event kept its score,
 *   value and truth, so none needed them.
 */
import { describe, expect, test } from 'bun:test'
import { FIELD_LABS } from '../../src/components/forge/FieldLabs'
import { fieldResponse, predictedRow, type FieldLab, type FieldMetric } from '../../src/data/field-labs/types'
import { compareEvents } from '../../src/lib/ledger/merge'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import { buildFieldReport, buildOutcomeReport, buildWave3Report, surfaceOf } from '../../src/lib/learner/outcomes'
import { FIELD_DATA_KEYS, FIELD_EVENT_KEYS, ledgerOfDonation, parseDonation, redactForPartner, type DonatedEvent, type Donation } from '../../src/lib/learner/redact'
import { addDays } from '../../src/lib/learner/reentry'
import { MEASURED_REF, compareRun, measuredRunItems } from '../../src/lib/real-engine'
import { makeProfile, startTab, tick } from '../ledger/env'
import { CONTENT, Journal, START, simulate } from '../learner/ledger-gen'

/* ------------------------------ the recorders ------------------------------ */

/** The number to type for a recorded value: `toValue` is monotone (the identity, or 1000 ÷ TPOT), so bisect its log. */
function typedFor(metric: FieldMetric, value: number): number {
  const rising = metric.entry.toValue(10) > metric.entry.toValue(1)
  let lo = -9
  let hi = 15
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2
    if (metric.entry.toValue(10 ** mid) < value === rising) lo = mid
    else hi = mid
  }
  return 10 ** ((lo + hi) / 2)
}

/** What a field lab's form records (FieldLabs.tsx: `recordItems([fieldResponse(lab, metric, typed)])`). */
const labReading = (lab: FieldLab, metric: FieldMetric, value: number): ItemResponse[] => [fieldResponse(lab, metric, typedFor(metric, value))]

/** What the measured run records (MeasuredRun.tsx: `record(measuredRunItems(compareRun(...)))`); the bandwidth only sets the ceiling shown. */
const engineRun = (predicted: number, measured: number): ItemResponse[] => measuredRunItems(compareRun({ predicted, bandwidthGBs: 51.2, measured }))

/** The engine prediction the reconstruction assumes known: the LPDDR5-6400 preset's ceiling, 51.2 GB/s ÷ 400 MB. */
const ENGINE_PREDICTION = 128

interface Source {
  ref: string
  prediction: number
  record: (value: number) => ItemResponse[]
}

const SOURCES: Source[] = [
  ...FIELD_LABS.flatMap((lab) =>
    lab.metrics.map((m) => ({ ref: `item:field.${lab.id}.${m.id}`, prediction: predictedRow(lab, m).value, record: (v: number) => labReading(lab, m, v) })),
  ),
  { ref: MEASURED_REF, prediction: ENGINE_PREDICTION, record: (v: number) => engineRun(ENGINE_PREDICTION, v) },
]

/** The measurement and the prediction a ledger event holds: a field item's value and truth, the engine's truth and value. */
function truthOf(e: LedgerEvent): { measured: number; prediction: number } {
  const d = (e as unknown as { data: { value: number; truth: number } }).data
  return e.ref === MEASURED_REF ? { measured: d.truth, prediction: d.value } : { measured: d.value, prediction: d.truth }
}

/** Write `items` through a real façade and read the ledger back, in ledger order. */
async function recorded(items: ItemResponse[]): Promise<LedgerEvent[]> {
  const tab = startTab(makeProfile())
  tab.progress.getState().recordItems(items)
  await tick(20)
  const events = await (await tab.engine()).events({ refPrefix: 'item:' })
  return [...events].sort(compareEvents)
}

/* ------------------------------ the walk ------------------------------ */

describe('every event the field labs and the real-engine run write, donated', () => {
  test('the sources are the two labs\' three metrics and the engine run', () => {
    expect(SOURCES.map((s) => s.ref)).toEqual(['item:field.decode-kv.tps', 'item:field.decode-kv.concurrency', 'item:field.burstgpt-replay.out-tps', 'item:engine.measured-tps'])
  })

  test('the ledger holds the reading; the donation keeps kind, ref, day, ok, provenance and src, and nothing else', async () => {
    const items = SOURCES.flatMap((s) => s.record(s.prediction * 1.37))
    const events = await recorded(items)
    expect(events.map((e) => `${e.kind} ${e.ref}`)).toEqual([
      'item item:field.decode-kv.tps',
      'item item:field.decode-kv.concurrency',
      'item item:field.burstgpt-replay.out-tps',
      'predict item:engine.measured-tps',
      'item item:engine.measured-tps',
    ])
    // what the recorders write: the score, the ok bit and the provenance on the event; src, the reading, the prediction (and
    // a field lab's unit and nsec) in its data. No conf, ms, seed, grp or kcs.
    for (const e of events) {
      const r = e as unknown as Record<string, unknown>
      expect(Object.keys(r).sort()).toEqual(['at', 'data', 'day', 'dev', 'id', 'kind', 'ok', 'provenance', 'ref', 'rev', 'score', 'tz', 'v'])
      expect(r.provenance).toBe('field')
      expect(Object.keys(r.data as object).sort()).toEqual(e.ref === MEASURED_REF ? ['src', 'truth', 'unit', 'value'] : ['nsec', 'src', 'truth', 'unit', 'value'])
    }
    const donated = redactForPartner({ events, working: [] })
    for (const [i, d] of donated.events.entries()) {
      expect(d).toEqual({ kind: events[i].kind, ref: events[i].ref, dayOffset: 0, ok: true, provenance: 'field', data: { src: 'practice' } })
      expect(Object.keys(d).every((k) => (FIELD_EVENT_KEYS as readonly string[]).includes(k) || k === 'data')).toBe(true)
      expect(Object.keys(d.data ?? {}).every((k) => (FIELD_DATA_KEYS as readonly string[]).includes(k))).toBe(true)
    }
    // and the file read back is the same file
    const back = parseDonation(JSON.stringify(donated))
    expect(back.ok && back.donation).toEqual(donated)
  })

  test('src is kept because the surface table needs it: without it a field reading would count as lesson time', async () => {
    const [e] = await recorded(SOURCES[0].record(SOURCES[0].prediction))
    const [d] = ledgerOfDonation(redactForPartner({ events: [e], working: [] })).events
    expect(surfaceOf(d)).toBeNull()
    const bare = { ...d, data: {} } as unknown as LedgerEvent
    expect(surfaceOf(bare)).toBe('lessons')
  })
})

/* ------------------------------ the reconstruction ------------------------------ */

/** Readings per source, spread evenly in log over three decades centred on the prediction. */
const N = 300
const SPREAD = 1.5
const offsets = Array.from({ length: N }, (_, i) => -SPREAD + (2 * SPREAD * (i + 0.5)) / N)
const WITHIN = Math.log10(1.5)

type Guess = (d: DonatedEvent, prediction: number) => number

const hit = (guess: number, measured: number): boolean => guess > 0 && Number.isFinite(guess) && Math.abs(Math.log10(guess / measured)) <= WITHIN

/** Every finite number in a donated event, by path. */
function numbers(x: unknown, path = ''): [string, number][] {
  if (typeof x === 'number' && Number.isFinite(x)) return [[path, x]]
  if (typeof x !== 'object' || x === null) return []
  return Object.entries(x).flatMap(([k, v]) => numbers(v, path === '' ? k : `${path}.${k}`))
}
const at = (d: DonatedEvent, path: string): number | undefined => numbers(d).find(([p]) => p === path)?.[1]

/**
 * The reconstructions tried: every number the event keeps, read as the value, as a ratio, as a log ratio or as a score
 * (1 − |log ratio|, either sign), each falling back to the prediction when the event lacks it; and guesses from `ok`.
 */
function guesses(paths: readonly string[]): [string, Guess][] {
  const transforms: [string, (x: number, p: number) => number][] = [
    ['as the value', (x) => x],
    ['× prediction', (x, p) => p * x],
    ['prediction ÷', (x, p) => p / x],
    ['prediction × 10^x', (x, p) => p * 10 ** x],
    ['prediction × 10^-x', (x, p) => p * 10 ** -x],
    ['a score, above', (x, p) => p * 10 ** (1 - x)],
    ['a score, below', (x, p) => p * 10 ** -(1 - x)],
  ]
  const fromFields: [string, Guess][] = paths.flatMap((path) =>
    transforms.map(([name, f]): [string, Guess] => [
      `${path} ${name}`,
      (d, p) => {
        const x = at(d, path)
        return x === undefined ? p : f(x, p)
      },
    ]),
  )
  const fromOk: [string, Guess][] = [-1, -0.6, -0.3, 0, 0.3, 0.6, 1].map((c): [string, Guess] => [`ok: the prediction, else × 10^${c}`, (d, p) => (d.ok ? p : p * 10 ** c)])
  return [['the prediction', (_d, p) => p], ...fromFields, ...fromOk]
}

/** The best any guess can do that sees only the ref, the kind and `ok`: the best single offset for each group, on a fine grid. */
function okOnlyBest(rows: { d: DonatedEvent; u: number }[]): number {
  const groups = new Map<string, number[]>()
  for (const { d, u } of rows) {
    const key = `${d.kind} ${d.ref} ${String(d.ok)}`
    groups.set(key, [...(groups.get(key) ?? []), u])
  }
  let hits = 0
  for (const us of groups.values()) {
    let best = 0
    for (let c = -2; c <= 2; c += 0.0005) best = Math.max(best, us.filter((u) => Math.abs(u - c) <= WITHIN).length)
    hits += best
  }
  return hits / rows.length
}

describe('no reconstruction from a donated field event beats the ok bit', () => {
  /** Every reading, recorded and donated: the donated event, the measurement, its public prediction, and log10(measured ÷ predicted). */
  async function donatedReadings() {
    const items = SOURCES.flatMap((s) => offsets.flatMap((u) => s.record(s.prediction * 10 ** u)))
    const events = await recorded(items)
    expect(events).toHaveLength(N * 5)
    const donation = redactForPartner({ events, working: [] })
    const parsed = parseDonation(JSON.stringify(donation))
    if (!parsed.ok) throw new Error(parsed.error)
    return parsed.donation.events.map((d, i) => {
      const { measured, prediction } = truthOf(events[i])
      expect(d.ref).toBe(events[i].ref)
      return { d, measured, prediction, u: Math.log10(measured / prediction), score: (events[i] as { score?: number }).score as number }
    })
  }

  test('readings with the same ok donate the same event, so the donation is a function of the one bit', async () => {
    const rows = await donatedReadings()
    const byGroup = new Map<string, Set<string>>()
    for (const { d } of rows) {
      const key = `${d.kind} ${d.ref} ${String(d.ok)}`
      byGroup.set(key, (byGroup.get(key) ?? new Set()).add(JSON.stringify(d)))
    }
    // four field items and the engine's predict and item, each right and wrong
    expect(byGroup.size).toBe(10)
    for (const forms of byGroup.values()) expect(forms.size).toBe(1)
  })

  test('over three decades, every guess lands within 1.5x at most as often as the best ok-only guess, about 23 %', async () => {
    const rows = await donatedReadings()
    // the measurements do span three decades, and about a fifth of them are within 2x (ok)
    const us = rows.map((r) => r.u)
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(2.98)
    expect(rows.filter((r) => r.d.ok).length / rows.length).toBeCloseTo((2 * Math.log10(2)) / 3, 2)
    // chance: knowing ok, the best guess is the prediction when ok (hits |u| ≤ log 1.5 of the 2 log 2 wide band) and any
    // point of the wide band otherwise; each covers 2 log10 1.5 of the 3 decades, 0.117, so 0.235 in all (0.24 on this
    // grid of readings 0.01 apart, where a window can hold one more reading at each end)
    const chance = okOnlyBest(rows)
    expect(Math.abs(chance - (4 * WITHIN) / 3)).toBeLessThan(0.01)
    const paths = [...new Set(rows.flatMap((r) => numbers(r.d).map(([p]) => p)))]
    expect(paths).toEqual(['dayOffset'])
    for (const [name, guess] of guesses(paths)) {
      const rate = rows.filter((r) => hit(guess(r.d, r.prediction), r.measured)).length / rows.length
      expect(rate, name).toBeLessThanOrEqual(chance + 1e-12)
    }
  })

  test('the same guesses on the score a donation used to keep beat chance, so the test can see a leak', async () => {
    const rows = await donatedReadings()
    const chance = okOnlyBest(rows)
    const leaky = rows.map((r) => ({ ...r, d: { ...r.d, score: r.score } }))
    const best = Math.max(
      ...guesses(['score']).map(([, guess]) => leaky.filter((r) => hit(guess(r.d, r.prediction), r.measured)).length / leaky.length),
    )
    // the score gives |log ratio| for |u| ≤ 1; one sign is right on [0, 1] and near 0, and a score of 0 points past a decade
    expect(best).toBeGreaterThan(0.4)
    expect(best).toBeGreaterThan(chance + 0.15)
  })
})

/* ------------------------------ the selectors ------------------------------ */

describe('the partner report never needed a field reading\'s score', () => {
  /** Three simulated learners, each with field-lab readings and engine runs on their own days, and their donations. */
  function donations(): Donation[] {
    return [11, 12, 13].map((seed, k) => {
      const j = Journal.from(simulate(seed, { days: 70 }).events)
      for (let r = 0; r < 6; r++) {
        const day = addDays(START, 5 + 11 * r + k)
        for (const s of SOURCES) {
          for (const e of s.record(s.prediction * 10 ** ((r - 2.5) / 3))) {
            j.add(e.kind, e.ref, day, { score: e.score, ok: e.ok, rev: e.rev, provenance: 'field', data: e.data })
          }
        }
      }
      return redactForPartner({ events: j.events, working: [] })
    })
  }

  /** A donation as it was before: each field event with its score, value and truth back. */
  function withNumbers(d: Donation): Donation {
    return {
      ...d,
      events: d.events.map((e) => (e.provenance === 'field' ? { ...e, score: 0.5, data: { ...e.data, value: 123.4, truth: 98.7 } } : e)),
    }
  }

  const ledgers = (ds: Donation[]) => ds.map((d) => ledgerOfDonation(d))

  test('the Wave 3, Wave 2 and Wave 1 reports read the same with and without the numbers', () => {
    const now = donations()
    const before = now.map(withNumbers)
    const fieldEvents = now.flatMap((d) => d.events.filter((e) => e.provenance === 'field'))
    expect(fieldEvents).toHaveLength(3 * 6 * 5)
    expect(fieldEvents.every((e) => e.score === undefined)).toBe(true)

    const w3 = (ds: Donation[]) => buildWave3Report(ledgers(ds), { cards: CONTENT })
    expect(w3(now).partners).toBe(3)
    expect(JSON.stringify(w3(now))).toBe(JSON.stringify(w3(before)))

    const w2 = (ds: Donation[]) => buildFieldReport(ledgers(ds), CONTENT)
    expect(JSON.stringify(w2(now))).toBe(JSON.stringify(w2(before)))

    const exportedAt = '2026-11-20T12:00:00.000Z'
    const w1 = (ds: Donation[]) => buildOutcomeReport(ledgers(ds).map((l) => ({ ...l, exportedAt })), CONTENT)
    expect(JSON.stringify(w1(now))).toBe(JSON.stringify(w1(before)))
  })
})
