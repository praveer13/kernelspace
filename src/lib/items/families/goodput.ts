/**
 * `goodput` (docs/specs/wave-2.md §5.3; KCs t7.goodput, t7.goodput-curve, t7.pareto-frontier,
 * t7.capacity-planning): count the requests that meet an SLO pair, turn the count into a rate, read
 * the knee off a concurrency sweep, pick an operating point on a throughput-versus-interactivity
 * frontier, and size a fleet from one replica's goodput.
 *
 * Every number here is a hypothetical scenario: latencies, sweeps, operating points and loads are
 * declared in SYNTHETIC and the prompts say "hypothetical", so no claim is read (W4). The one
 * course figure is level 0's SLO pair, TTFT under 2 s and TPOT under 100 ms, which is what t7.l1
 * teaches and what the pins reproduce.
 *
 * A table or a sweep is built from its answer: the draw fixes how many requests fail only TTFT,
 * only TPOT and both, so each slip of PLAN §4.A (counting one bound, counting everything, a rate per
 * minute, no headroom, rounding down) lands on a different count and the ratio rules can name it.
 */

import { KC } from '@/data/kc/ids'
import { finishInstance, resolveVariant, rngFor, type Rng } from '@/lib/items/core'
import { gradeResponse } from '@/lib/items/grade'
import type { AnswerSpec, ChoiceOption, Gen, Instance, Level, Params, PromptPart, RatioRule, SolutionStep, VariantSpec } from '@/lib/items/types'
import { formatNumber } from '@/lib/items/units'

const SYNTHETIC = {
  /** nominal seconds per variant */
  nsec: { 'slo-count': 60, 'goodput-rate': 75, knee: 60, frontier: 60, replicas: 75 },
  /** a count is whole, so only the exact count passes */
  countTol: 0.01,
  /** a rate is right within this share */
  relTol: 0.02,
  /**
   * A table or sweep is a random draw, not a bank, but its answers are small whole numbers (a count of 3 to 10
   * requests, a replica count), so "distinct truths" cannot hold for any family of counts. The gate's bank rule
   * (distinct fingerprints, not distinct truths) is the honest measure: this is a floor on the distinct instances
   * each variant can draw, far above 80 % of any seed budget, so the rule reduces to 50 % distinct fingerprints.
   */
  bankUnits: 1000000,
  /** requests in a table per level: [min, max] */
  rows: [[8, 8], [8, 10], [10, 12], [10, 12]],
  /** t7.l1's SLO pair, used at level 0 as written there: TTFT under 2 s and TPOT under 100 ms */
  plainTtftMs: 2000,
  plainTpotMs: 100,
  ttftBoundsMs: [300, 500, 1000, 1500, 2000, 2500, 3000],
  tpotBoundsMs: [25, 40, 50, 60, 80, 100, 120, 150],
  /** requests that fail only one bound: two distinct values, so the two one-bound slips give different counts */
  failOne: [1, 2, 3],
  /** requests that fail both bounds: at most this many */
  failBothMax: 2,
  /** a passing latency is this percentage of its bound, a failing one this percentage: never within 10 % of it, so rounding cannot flip a verdict */
  passPct: { min: 20, max: 90, step: 5 },
  failPct: { min: 110, max: 250, step: 5 },
  /** goodput-rate windows: seconds, then (level 3) minutes */
  windowsS: [5, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60],
  windowsMin: [1, 2, 3, 4, 5],

  /** concurrency ladders of a six-row sweep: powers of two at several scales, then linear ladders */
  ladders: [
    [1, 2, 4, 8, 16, 32],
    [2, 4, 8, 16, 32, 64],
    [4, 8, 16, 32, 64, 128],
    [8, 16, 32, 64, 128, 256],
    [16, 32, 64, 128, 256, 512],
    [32, 64, 128, 256, 512, 1024],
    [10, 20, 30, 40, 50, 60],
    [20, 40, 60, 80, 100, 120],
    [25, 50, 75, 100, 125, 150],
  ],
  /** the sweep's p95 TPOT limit in ms; level 3 states a per-user floor instead (tok/s whose period in ms is a whole number) */
  kneeTpotMs: [40, 50, 60, 80, 100, 120],
  interactiveTpotMs: [25, 40, 50, 100],
  /** the last row that meets the limit sits at this percentage of it, the first row past it at this one, per level (tighter later) */
  keyPct: [[60, 85], [60, 90], [70, 95], [80, 95]],
  nextPct: [[120, 160], [115, 160], [105, 140], [105, 125]],
  /** rows further from the knee: a step down by this percentage, or up by this one */
  downPct: { min: 70, max: 95 },
  upPct: { min: 110, max: 180 },
  /** a sweep's saturation throughput in tok/s, and which rung of the ladder has half of it */
  peakTps: { min: 1000, max: 8000, step: 500 },
  halfRungs: [1, 2, 3],

  /** operating points: tok/s/user values a point may have, the floors an SLO may set, and the floors whose period in ms is whole (level 3) */
  tuGrid: [4, 5, 6, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120],
  floors: [10, 15, 20, 25, 30, 40, 50, 60],
  floorsPeriod: [10, 20, 25, 40, 50],
  /** a point's tok/s/GPU: the first (lowest tok/s/user) point, then a drop of this percentage per step along the frontier */
  tgFirst: { min: 1500, max: 4000, step: 100 },
  tgDrop: { min: 55, max: 85 },
  /** the dominated point has this percentage of the key point's tok/s/GPU */
  domDrop: { min: 60, max: 90 },
  /** points on the frontier: level 0 draws a clean frontier of five, later levels four plus one dominated point */
  frontierPoints: [5, 4, 4, 4],
  /** how many points sit under the floor: 1 to this, at most (the rest must still leave two that meet it) */
  maxUnder: 3,

  /** replicas: peak load and one replica's goodput in req/s, headroom in %, all hypothetical */
  /** level 0 keeps to round peaks: two significant digits m, scaled by a decade */
  lambdaMantissa: { min: 10, max: 99 },
  lambdaScales: [1, 10, 100],
  goodputRange: { min: 4, max: 80 },
  headroom: [[10, 20, 25], [10, 20, 25, 30], [10, 15, 20, 25, 30, 35, 40], [10, 15, 20, 25, 30, 35, 40]],
  /** the unrounded replica count stays between these, so "rounded down" and "no headroom" are 3 % or more apart from the key and each other */
  replicasMin: 3,
  replicasMax: 28,
  /** redraws before the fixed fallback instance (a draw that cannot be told from a slip) */
  attempts: 60,
  fallback: { lambda: 95, goodput: 10, headroom: 20 },
}

const TRANSFER: Level = 3 // gen-literal-ok: level 3 of the staircase
const ALL_LEVELS = [0, 1, 2, TRANSFER] as const
const MS_PER_S = 1000 // gen-literal-ok: milliseconds per second
const S_PER_MIN = 60 // gen-literal-ok: seconds per minute
const SIX = 6 // gen-literal-ok: rows in a concurrency sweep

const VARIANTS: VariantSpec[] = [
  { id: 'slo-count', title: 'Requests that meet both bounds', kcs: [KC.goodput], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['slo-count'] },
  { id: 'goodput-rate', title: 'Goodput as a rate', kcs: [KC.goodput], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec['goodput-rate'] },
  { id: 'knee', title: 'The knee of a concurrency sweep', kcs: [KC.goodputCurve], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.knee },
  { id: 'frontier', title: 'The best point under an interactivity floor', kcs: [KC.paretoFrontier], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.frontier },
  { id: 'replicas', title: 'Replicas for a peak', kcs: [KC.capacityPlanning], levels: ALL_LEVELS, nsec: SYNTHETIC.nsec.replicas },
]
const spec = (id: string): VariantSpec => VARIANTS.find((x) => x.id === id)!

/* ------------------------------ params and small helpers ------------------------------ */

const num = (p: Params, k: string): number => Number(p[k])
/** A comma-separated integer list, the way a table or sweep rides in params (params are scalars). */
const list = (p: Params, k: string): number[] => String(p[k]).split(',').map(Number)
const join = (xs: readonly number[]): string => xs.join(',')
const fmt = (n: number, digits?: number): string => formatNumber(n, digits)
const range = (r: { min: number; max: number; step?: number }): number[] => {
  const out: number[] = []
  for (let x = r.min; x <= r.max; x += r.step ?? 1) out.push(x)
  return out
}
const ceilDiv = (a: number, b: number): number => (a - (a % b)) / b + (a % b === 0 ? 0 : 1)
const floorDiv = (a: number, b: number): number => (a - (a % b)) / b
const PASS_PCTS = range(SYNTHETIC.passPct)
const FAIL_PCTS = range(SYNTHETIC.failPct)
const TPS_PEAKS = range(SYNTHETIC.peakTps)
const TG_FIRST = range(SYNTHETIC.tgFirst)
const LETTERS = ['A', 'B', 'C', 'D', 'E']
/** Peaks of two significant digits, ascending: 10 to 99, 100 to 990, 1,000 to 9,900. */
const ROUND_LAMBDAS = SYNTHETIC.lambdaScales.flatMap((s) => range(SYNTHETIC.lambdaMantissa).map((m) => m * s))

const t = (text: string): PromptPart => ({ t: 'text', text })
const v = (value: number, unit?: string, digits?: number): PromptPart => ({ t: 'value', value, ...(unit ? { unit } : {}), ...(digits === undefined ? {} : { digits }) })

/* ------------------------------ the request table (slo-count, goodput-rate) ------------------------------ */

interface Tally {
  n: number
  /** meet both bounds */
  both: number
  /** meet TTFT, whatever TPOT says */
  ttft: number
  /** meet TPOT, whatever TTFT says */
  tpot: number
  okTtft: boolean[]
  okTpot: boolean[]
}

/** A request meets a bound when it is strictly under it. */
function tally(p: Params): Tally {
  const [ttft, tpot] = [list(p, 'ttft'), list(p, 'tpot')]
  const okTtft = ttft.map((x) => x < num(p, 'sloTtft'))
  const okTpot = tpot.map((x) => x < num(p, 'sloTpot'))
  const count = (xs: boolean[]): number => xs.filter(Boolean).length
  return { n: ttft.length, both: count(okTtft.map((x, i) => x && okTpot[i])), ttft: count(okTtft), tpot: count(okTpot), okTtft, okTpot }
}

/** The names of the requests whose flag is set: "R1, R4, R5". */
const names = (flags: readonly boolean[]): string => flags.flatMap((f, i) => (f ? [`R${i + 1}`] : [])).join(', ')

function drawTable(r: Rng, level: Level): Params {
  const [lo, hi] = SYNTHETIC.rows[level]
  const n = r.int(lo, hi)
  const sloTtft = level === 0 ? SYNTHETIC.plainTtftMs : r.pick(SYNTHETIC.ttftBoundsMs)
  const sloTpot = level === 0 ? SYNTHETIC.plainTpotMs : r.pick(SYNTHETIC.tpotBoundsMs)
  // a requests fail only TTFT, b only TPOT (a ≠ b), c both; the rest meet both
  const [a, b] = r.sample(SYNTHETIC.failOne, 2)
  const c = r.int(0, Math.min(SYNTHETIC.failBothMax, n - 2 - a - b))
  const kinds = r.shuffle([...Array<string>(n - a - b - c).fill('ok'), ...Array<string>(a).fill('ttft'), ...Array<string>(b).fill('tpot'), ...Array<string>(c).fill('both')])
  const under = (bound: number): number => Math.round((bound * r.pick(PASS_PCTS)) / 100)
  const over = (bound: number): number => Math.round((bound * r.pick(FAIL_PCTS)) / 100)
  const ttft = kinds.map((k) => (k === 'ttft' || k === 'both' ? over(sloTtft) : under(sloTtft)))
  const tpot = kinds.map((k) => (k === 'tpot' || k === 'both' ? over(sloTpot) : under(sloTpot)))
  const base = { sloTtft, sloTpot, ttft: join(ttft), tpot: join(tpot) }
  if (level !== TRANSFER) return { ...base, ttftUnit: 'ms' }
  // level 3: the table's TTFT is in seconds while the SLO is stated in milliseconds
  return { ...base, ttftUnit: 's' }
}

function tableParts(p: Params): PromptPart {
  const sec = p.ttftUnit === 's'
  const ttft = list(p, 'ttft')
  const tpot = list(p, 'tpot')
  return {
    t: 'table',
    caption: 'Requests a hypothetical engine served',
    columns: ['Request', sec ? 'TTFT (s)' : 'TTFT (ms)', 'TPOT (ms)'],
    rows: ttft.map((x, i) => [`R${i + 1}`, sec ? x / MS_PER_S : x, tpot[i]]),
  }
}

const sloText = (p: Params): string => `TTFT under ${fmt(num(p, 'sloTtft'))} ms and TPOT under ${fmt(num(p, 'sloTpot'))} ms`

/** goodput-rate: the window in seconds, from seconds or from minutes. */
const windowS = (p: Params): number => (p.winUnit === 'min' ? num(p, 'win') * S_PER_MIN : num(p, 'win'))

/* ------------------------------ the concurrency sweep (knee) ------------------------------ */

interface Sweep {
  conc: number[]
  tps: number[]
  tpot: number[]
  limit: number
  /** the last row that meets the limit: the knee */
  key: number
  /** level 3: the slowest 5 % of users' tok/s, and the floor that replaces the TPOT limit */
  rate: number[]
  floor: number
  interactive: boolean
}

function sweepOf(p: Params): Sweep {
  const [conc, tps, tpot] = [list(p, 'conc'), list(p, 'tps'), list(p, 'tpot')]
  const limit = num(p, 'limit')
  const key = tpot.filter((x) => x < limit).length - 1
  const interactive = p.surface === 'rate'
  // per-user tok/s of the slowest 5 %: 1,000 ÷ the TPOT in ms, floored (a TPOT under the limit gives at least the floor)
  return { conc, tps, tpot, limit, key, rate: tpot.map((x) => floorDiv(MS_PER_S, x)), floor: interactive ? MS_PER_S / limit : 0, interactive }
}

function drawKnee(r: Rng, level: Level): Params {
  const ladder = r.pick(SYNTHETIC.ladders)
  const limit = r.pick(level === TRANSFER ? SYNTHETIC.interactiveTpotMs : SYNTHETIC.kneeTpotMs)
  // the knee is never the last row, so some row is over the limit and the peak throughput is not an answer
  const key = r.int(0, SIX - 2)
  const [kLo, kHi] = SYNTHETIC.keyPct[level]
  const [nLo, nHi] = SYNTHETIC.nextPct[level]
  const tpot: number[] = []
  tpot[key] = Math.floor((limit * r.int(kLo, kHi)) / 100)
  tpot[key + 1] = Math.ceil((limit * r.int(nLo, nHi)) / 100)
  for (let i = key - 1; i >= 0; i--) tpot[i] = Math.max(1, Math.min(Math.floor((tpot[i + 1] * r.int(SYNTHETIC.downPct.min, SYNTHETIC.downPct.max)) / 100), tpot[i + 1] - 1))
  for (let i = key + 2; i < SIX; i++) tpot[i] = Math.max(Math.ceil((tpot[i - 1] * r.int(SYNTHETIC.upPct.min, SYNTHETIC.upPct.max)) / 100), tpot[i - 1] + 1)
  // throughput saturates: P · c / (c + c½), strictly rising so the largest concurrency always has the most tok/s
  const peak = r.pick(TPS_PEAKS)
  const half = ladder[r.pick(SYNTHETIC.halfRungs)]
  const tps: number[] = []
  ladder.forEach((c, i) => tps.push(Math.max(Math.floor((peak * c) / (c + half)), i === 0 ? 1 : tps[i - 1] + 1)))
  return { conc: join(ladder), tps: join(tps), tpot: join(tpot), limit, surface: level === TRANSFER ? 'rate' : 'tpot' }
}

/* ------------------------------ the operating points (frontier) ------------------------------ */

interface Point {
  label: string
  /** tok/s per GPU */
  tg: number
  /** tok/s per user */
  tu: number
}

function pointsOf(p: Params): Point[] {
  const [tg, tu] = [list(p, 'tg'), list(p, 'tu')]
  return tg.map((x, i) => ({ label: LETTERS[i], tg: x, tu: tu[i] }))
}

/** The floor in tok/s/user: stated directly, or as the TPOT whose period it is (level 3). */
const floorOf = (p: Params): number => (p.surface === 'period' ? MS_PER_S / num(p, 'periodMs') : num(p, 'floor'))

type Role = 'key' | 'max-throughput' | 'below-floor' | 'dominated' | 'max-interactivity' | 'feasible-not-best'

/** What each point is to the learner: the answer, or the slip that picks it. */
function roles(pts: readonly Point[], floor: number): Role[] {
  const feasible = pts.filter((q) => q.tu >= floor)
  const best = feasible.reduce((a, b) => (b.tg > a.tg ? b : a))
  const maxTg = pts.reduce((a, b) => (b.tg > a.tg ? b : a))
  const maxTu = pts.reduce((a, b) => (b.tu > a.tu ? b : a))
  const dominated = (q: Point): boolean => pts.some((o) => o !== q && o.tg >= q.tg && o.tu >= q.tu && (o.tg > q.tg || o.tu > q.tu))
  return pts.map((q) => {
    if (q === best) return 'key'
    if (q.tu < floor) return q === maxTg ? 'max-throughput' : 'below-floor'
    if (dominated(q)) return 'dominated'
    return q === maxTu ? 'max-interactivity' : 'feasible-not-best'
  })
}

function drawFrontier(r: Rng, level: Level): Params {
  const periodSurface = level === TRANSFER
  const floor = r.pick(periodSurface ? SYNTHETIC.floorsPeriod : SYNTHETIC.floors)
  const front = SYNTHETIC.frontierPoints[level]
  // `under` points sit below the floor and the rest (at least two) meet it; the key is the lowest of those, which has the most tok/s/GPU of the points that do
  const lows = SYNTHETIC.tuGrid.filter((x) => x < floor)
  const highs = SYNTHETIC.tuGrid.filter((x) => x >= floor + 2)
  const under = r.int(1, Math.min(SYNTHETIC.maxUnder, front - 2, lows.length))
  const tu = [...r.sample(lows, under).sort((a, b) => a - b), ...r.sample(highs, front - under).sort((a, b) => a - b)]
  const tg = [r.pick(TG_FIRST)]
  for (let i = 1; i < front; i++) tg.push(Math.min(Math.floor((tg[i - 1] * r.int(SYNTHETIC.tgDrop.min, SYNTHETIC.tgDrop.max)) / 100), tg[i - 1] - 1))
  const pts = tu.map((x, i) => ({ tg: tg[i], tu: x }))
  if (front < LETTERS.length) {
    // the dominated point meets the floor and is closer to it than the key, so a reader who takes the point nearest the floor takes this one;
    // the key beats it on both axes
    const key = pts[under]
    pts.push({ tu: r.int(floor + 1, key.tu - 1), tg: Math.floor((key.tg * r.int(SYNTHETIC.domDrop.min, SYNTHETIC.domDrop.max)) / 100) })
  }
  const order = r.shuffle(pts)
  const base = { tg: join(order.map((q) => q.tg)), tu: join(order.map((q) => q.tu)) }
  return periodSurface ? { ...base, surface: 'period', periodMs: MS_PER_S / floor } : { ...base, surface: 'floor', floor }
}

/* ------------------------------ replicas ------------------------------ */

/** Replicas for a peak: ceil(λ ÷ (g · (1 − h))), in integer arithmetic. */
const replicasOf = (lambda: number, g: number, h: number): { raw: number; need: number; floor: number } => {
  const [a, b] = [lambda * 100, g * (100 - h)]
  return { raw: a / b, need: ceilDiv(a, b), floor: floorDiv(a, b) }
}

/** A draw is usable when the key, the floored count and the no-headroom count are three different whole numbers. */
function usable(lambda: number, g: number, h: number): boolean {
  const { raw, need, floor } = replicasOf(lambda, g, h)
  const noHead = ceilDiv(lambda, g)
  return raw !== need && raw >= SYNTHETIC.replicasMin && need <= SYNTHETIC.replicasMax && floor !== noHead && need !== noHead
}

function drawReplicas(r: Rng, level: Level): Params {
  const draw = (): { lambda: number; g: number; h: number } => {
    const g = r.int(SYNTHETIC.goodputRange.min, SYNTHETIC.goodputRange.max)
    const h = r.pick(SYNTHETIC.headroom[level])
    // the unrounded count is between replicasMin and replicasMax, so λ is between these
    const lo = ceilDiv(SYNTHETIC.replicasMin * g * (100 - h), 100)
    const hi = floorDiv(SYNTHETIC.replicasMax * g * (100 - h), 100)
    const round = ROUND_LAMBDAS.filter((x) => x >= lo && x <= hi)
    // level 0 keeps to round peaks; later levels take any whole number in range
    return { lambda: level === 0 ? (round.length > 0 ? r.pick(round) : 0) : hi >= lo ? r.int(lo, hi) : 0, g, h }
  }
  for (let i = 0; i < SYNTHETIC.attempts; i++) {
    const d = draw()
    if (d.lambda > 0 && usable(d.lambda, d.g, d.h)) return replicaParams(d.lambda, d.g, d.h, level)
  }
  const f = SYNTHETIC.fallback
  return replicaParams(f.lambda, f.goodput, f.headroom, level)
}

function replicaParams(lambda: number, goodput: number, headroom: number, level: Level): Params {
  // level 3 states the peak per minute; lambda stays per second so the truth never changes
  return level === TRANSFER ? { lambda, goodput, headroom, peakUnit: 'min' } : { lambda, goodput, headroom, peakUnit: 's' }
}

const peakPerMinute = (p: Params): number => num(p, 'lambda') * S_PER_MIN

/* ------------------------------ truths ------------------------------ */

function truthOf(variant: string, p: Params): number {
  switch (variant) {
    case 'slo-count':
      return tally(p).both
    case 'goodput-rate':
      return tally(p).both / windowS(p)
    default:
      return replicasOf(num(p, 'lambda'), num(p, 'goodput'), num(p, 'headroom')).need
  }
}

/* ------------------------------ worked steps and solutions ------------------------------ */

/** A step before it is shown: the lead says what is computed, the detail how, the result what it came to. */
interface Draft {
  lead: PromptPart[]
  detail?: string
  result?: { value: number; unit?: string }
}

const full = (d: Draft): SolutionStep => ({ text: d.detail ? [...d.lead, t(`: ${d.detail}`)] : d.lead, ...(d.result ? { result: d.result } : {}) })
/** A blank step keeps its lead and drops its detail and result: the learner fills in what the step found. */
const gap = (d: Draft): SolutionStep => ({ text: d.lead, ...(d.result ? { result: d.result } : {}), blank: true })

/**
 * Level 0 shows every step with the last blanked (complete the last step). Level 1 shows every step but the
 * last, with the one before it blanked, so no visible step holds the final answer. Later levels show none.
 */
function worked(drafts: readonly Draft[], level: Level): SolutionStep[] | undefined {
  if (level === 0) return drafts.map((d, i) => (i === drafts.length - 1 ? gap(d) : full(d)))
  if (level === 1) return drafts.slice(0, -1).map((d, i, a) => (i === a.length - 1 ? gap(d) : full(d)))
  return undefined
}

function tableDrafts(variant: string, p: Params): Draft[] {
  const c = tally(p)
  const out: Draft[] = [
    { lead: [t('Requests with TTFT under '), v(num(p, 'sloTtft'), 'ms')], detail: p.ttftUnit === 's' ? `${names(c.okTtft)} (the table is in seconds: compare in milliseconds)` : names(c.okTtft), result: { value: c.ttft, unit: 'requests' } },
    { lead: [t('Requests with TPOT under '), v(num(p, 'sloTpot'), 'ms')], detail: names(c.okTpot), result: { value: c.tpot, unit: 'requests' } },
    { lead: [t('Requests in both lists')], detail: names(c.okTtft.map((x, i) => x && c.okTpot[i])), result: { value: c.both, unit: 'requests' } },
  ]
  if (variant === 'slo-count') return out
  const secs = windowS(p)
  if (p.winUnit === 'min') out.push({ lead: [t('The window in seconds = '), v(num(p, 'win'), 'min'), t(' × 60')], result: { value: secs, unit: 's' } })
  out.push({ lead: [t('Goodput = requests meeting both ÷ the '), v(secs, 's'), t(' window')], result: { value: c.both / secs, unit: 'req/s' } })
  return out
}

function kneeDrafts(p: Params): Draft[] {
  const s = sweepOf(p)
  const pass = s.conc.filter((_, i) => i <= s.key)
  const limit = s.interactive ? `a floor of ${fmt(s.floor)} tok/s per user for the slowest 5 %` : `a p95 TPOT limit of ${fmt(s.limit)} ms`
  const first = s.key + 1
  const after = s.interactive ? `${fmt(s.rate[first])} tok/s per user at ${fmt(s.conc[first])}` : `${fmt(s.tpot[first])} ms at ${fmt(s.conc[first])}`
  return [
    { lead: [t(`The SLO is ${limit}. Latency only rises with concurrency, so the rows that pass are the first few rows of the sweep`)] },
    { lead: [t('Rows that meet the SLO')], detail: `${pass.map((c) => fmt(c)).join(', ')} (the next row is over it: ${after})`, result: { value: pass.length, unit: 'rows' } },
    { lead: [t('The highest concurrency among them')], result: { value: s.conc[s.key], unit: 'concurrent requests' } },
  ]
}

function frontierDrafts(p: Params): Draft[] {
  const pts = pointsOf(p)
  const floor = floorOf(p)
  const feasible = pts.filter((q) => q.tu >= floor)
  const best = feasible.reduce((a, b) => (b.tg > a.tg ? b : a))
  const start: Draft =
    p.surface === 'period'
      ? { lead: [t('A TPOT of '), v(num(p, 'periodMs'), 'ms'), t(' is 1,000 ÷ '), v(num(p, 'periodMs')), t(' tok/s per user')], result: { value: floor, unit: 'tok/s/user' } }
      : { lead: [t('The floor: a point meets the SLO when its tok/s/user is at least '), v(floor)] }
  return [
    start,
    { lead: [t('Points that meet the floor')], detail: feasible.map((q) => `${q.label} (${fmt(q.tu)} tok/s/user)`).join(', '), result: { value: feasible.length, unit: 'points' } },
    { lead: [t('The most tok/s/GPU among those points')], detail: `point ${best.label}`, result: { value: best.tg, unit: 'tok/s/GPU' } },
  ]
}

function replicaDrafts(p: Params): Draft[] {
  const [lambda, g, h] = [num(p, 'lambda'), num(p, 'goodput'), num(p, 'headroom')]
  const { raw, need } = replicasOf(lambda, g, h)
  const usableG = (g * (100 - h)) / 100
  const out: Draft[] = []
  if (p.peakUnit === 'min') out.push({ lead: [t('The peak in req/s = '), v(peakPerMinute(p), 'req/min'), t(' ÷ 60')], result: { value: lambda, unit: 'req/s' } })
  out.push(
    { lead: [t('Usable goodput per replica = goodput × (1 − headroom) = '), v(g, 'req/s'), t(' × '), v(100 - h, '%')], result: { value: usableG, unit: 'req/s' } },
    { lead: [t('Replicas before rounding = peak ÷ usable goodput = '), v(lambda, 'req/s'), t(' ÷ '), v(usableG, 'req/s', 2)], result: { value: raw, unit: 'replicas' } },
    { lead: [t('Round up: part of a replica is a whole replica')], result: { value: need, unit: 'replicas' } },
  )
  return out
}

const draftsOf = (variant: string, p: Params): Draft[] => {
  switch (variant) {
    case 'slo-count':
    case 'goodput-rate':
      return tableDrafts(variant, p)
    case 'knee':
      return kneeDrafts(p)
    case 'frontier':
      return frontierDrafts(p)
    default:
      return replicaDrafts(p)
  }
}

/* ------------------------------ choice options ------------------------------ */

/** Every option's why says what is true of that option; the key's says why it wins. The text is the label alone, so no surface feature separates the key. */
function kneeAnswer(p: Params): AnswerSpec {
  const s = sweepOf(p)
  const peak = s.tps.reduce((a, x, i) => (x > s.tps[a] ? i : a), 0)
  const read = (i: number): string => (s.interactive ? `${fmt(s.rate[i])} tok/s per user for the slowest 5 %` : `p95 TPOT ${fmt(s.tpot[i])} ms`)
  const limit = s.interactive ? `the ${fmt(s.floor)} tok/s floor` : `the ${fmt(s.limit)} ms limit`
  const options: ChoiceOption[] = s.conc.map((c, i) => {
    const id = `c${i}`
    const text = `${fmt(c)} concurrent requests`
    if (i === s.key) return { id, text, why: `${fmt(c)} concurrent requests: ${read(i)} meets ${limit}, and the next row (${fmt(s.conc[i + 1])}) does not (${read(i + 1)}). It is the highest concurrency within the SLO: the knee.` }
    if (i < s.key) return { id, text, why: `${fmt(c)} concurrent requests: ${read(i)} meets ${limit}, but ${fmt(s.conc[s.key])} meets it too and serves more. The knee is the highest concurrency that passes.`, miss: 'goodput.below-knee' }
    if (i === peak) return { id, text, why: `${fmt(c)} concurrent requests has the most tok/s (${fmt(s.tps[i])}), but ${read(i)} is past ${limit}: its requests miss the SLO, so little of that throughput is goodput.`, miss: 'goodput.peak-throughput' }
    return { id, text, why: `${fmt(c)} concurrent requests: ${read(i)} is past ${limit}, so requests there miss the SLO. The knee is at ${fmt(s.conc[s.key])}.`, miss: 'goodput.past-knee' }
  })
  return { kind: 'choice', options, correct: [`c${s.key}`] }
}

function frontierAnswer(p: Params): AnswerSpec {
  const pts = pointsOf(p)
  const floor = floorOf(p)
  const rs = roles(pts, floor)
  const keyPt = pts[rs.indexOf('key')]
  const at = (q: Point): string => `${fmt(q.tg)} tok/s/GPU at ${fmt(q.tu)} tok/s/user`
  const options: ChoiceOption[] = pts.map((q, i) => {
    const id = q.label
    const text = `Point ${q.label}`
    switch (rs[i]) {
      case 'key':
        return { id, text, why: `Point ${q.label} (${at(q)}) meets the floor of ${fmt(floor)} tok/s/user and has the most tok/s/GPU of the points that do.` }
      case 'max-throughput':
        return { id, text, why: `Point ${q.label} has the most tok/s/GPU of all (${at(q)}), but ${fmt(q.tu)} is under the floor of ${fmt(floor)} tok/s/user: it breaks the SLO, so it delivers no goodput.`, miss: 'goodput.max-throughput' }
      case 'below-floor':
        return { id, text, why: `Point ${q.label} (${at(q)}) is under the floor of ${fmt(floor)} tok/s/user, so it breaks the SLO whatever its throughput.`, miss: 'goodput.below-floor' }
      case 'dominated':
        return { id, text, why: `Point ${q.label} (${at(q)}) meets the floor and is closer to it than point ${keyPt.label}, but point ${keyPt.label} beats it on both axes (${at(keyPt)}). A dominated point is never the best.`, miss: 'goodput.dominated' }
      case 'max-interactivity':
        return { id, text, why: `Point ${q.label} (${at(q)}) meets the floor and is the most interactive, but it gives up GPU throughput: point ${keyPt.label} also meets the floor with ${fmt(keyPt.tg)} tok/s/GPU.`, miss: 'goodput.max-interactivity' }
      default:
        return { id, text, why: `Point ${q.label} (${at(q)}) meets the floor, but point ${keyPt.label} meets it too with more tok/s/GPU (${fmt(keyPt.tg)}).`, miss: 'goodput.feasible-not-best' }
    }
  })
  return { kind: 'choice', options, correct: [keyPt.label] }
}

/* ------------------------------ building an instance ------------------------------ */

function build(vs: VariantSpec, level: Level, seed: number, p: Params): Instance {
  const truth = vs.id === 'knee' || vs.id === 'frontier' ? 0 : truthOf(vs.id, p)
  let stem: PromptPart[]
  let answer: AnswerSpec
  switch (vs.id) {
    case 'slo-count': {
      const n = list(p, 'ttft').length
      stem = [t(`A hypothetical engine served these ${n} requests. The SLO is ${sloText(p)}. `), tableParts(p), t(' How many requests meet both bounds?')]
      answer = { kind: 'numeric', truth, unit: 'requests', tolerance: { abs: SYNTHETIC.countTol } }
      break
    }
    case 'goodput-rate': {
      const n = list(p, 'ttft').length
      const win = p.winUnit === 'min' ? `${fmt(num(p, 'win'))} minutes` : `${fmt(num(p, 'win'))} seconds`
      stem = [t(`A hypothetical engine served these ${n} requests in a window of ${win}. The SLO is ${sloText(p)}. `), tableParts(p), t(' What was its goodput, in requests per second?')]
      answer = { kind: 'numeric', truth, unit: 'req/s', tolerance: { rel: SYNTHETIC.relTol } }
      break
    }
    case 'knee': {
      const s = sweepOf(p)
      const slo = s.interactive ? `the slowest 5 % of users get at least ${fmt(s.floor)} tok/s each` : `p95 TPOT stays under ${fmt(s.limit)} ms`
      const columns = s.interactive ? ['Concurrency', 'Throughput (tok/s)', 'Slowest 5 % (tok/s per user)'] : ['Concurrency', 'Throughput (tok/s)', 'p95 TPOT (ms)']
      const table: PromptPart = { t: 'table', caption: 'A hypothetical engine at six concurrency levels', columns, rows: s.conc.map((c, i) => [c, s.tps[i], s.interactive ? s.rate[i] : s.tpot[i]]) }
      stem = [t(`A hypothetical engine is swept over six concurrency levels. The SLO: ${slo}. `), table, t(' Which is the highest concurrency that still meets the SLO?')]
      answer = kneeAnswer(p)
      break
    }
    case 'frontier': {
      const pts = pointsOf(p)
      const need = p.surface === 'period' ? `TPOT under ${fmt(num(p, 'periodMs'))} ms` : `at least ${fmt(num(p, 'floor'))} tok/s per user`
      const table: PromptPart = { t: 'table', caption: 'Operating points of a hypothetical deployment', columns: ['Point', 'tok/s per GPU', 'tok/s per user'], rows: pts.map((q) => [q.label, q.tg, q.tu]) }
      stem = [t(`A hypothetical deployment can run at ${pts.length} operating points. The SLO needs ${need}. `), table, t(' Which point gives the most tok/s per GPU while meeting the SLO?')]
      answer = frontierAnswer(p)
      break
    }
    default: {
      const peak = p.peakUnit === 'min' ? `${fmt(peakPerMinute(p))} requests per minute` : `${fmt(num(p, 'lambda'))} requests per second`
      stem = [
        t(
          `A hypothetical service peaks at ${peak}. One replica sustains a goodput of ${fmt(num(p, 'goodput'))} requests per second within SLO. ` +
            `You keep ${fmt(num(p, 'headroom'))} % headroom: at the peak each replica may carry at most ${fmt(100 - num(p, 'headroom'))} % of its goodput. How many replicas does the peak need?`,
        ),
      ]
      answer = { kind: 'numeric', truth, unit: 'replicas', tolerance: { abs: SYNTHETIC.countTol } }
    }
  }
  const drafts = draftsOf(vs.id, p)
  const w = worked(drafts, level)
  return finishInstance(gen, {
    variant: vs.id,
    seed,
    level,
    params: p,
    kcs: [...vs.kcs],
    prompt: { stem, ...(w ? { worked: w } : {}) },
    answer,
    claims: [],
    nsec: vs.nsec,
  })
}

function draw(variant: string, level: Level, r: Rng): Params {
  switch (variant) {
    case 'slo-count':
      return drawTable(r, level)
    case 'goodput-rate': {
      const table = drawTable(r, level)
      return level === TRANSFER ? { ...table, win: r.pick(SYNTHETIC.windowsMin), winUnit: 'min' } : { ...table, win: r.pick(SYNTHETIC.windowsS), winUnit: 's' }
    }
    case 'knee':
      return drawKnee(r, level)
    case 'frontier':
      return drawFrontier(r, level)
    default:
      return drawReplicas(r, level)
  }
}

function make(seed: number, level: Level, variant?: string): Instance {
  const vs = resolveVariant(gen, seed, level, variant)
  return build(vs, level, seed, draw(vs.id, level, rngFor(gen.id, vs.id, level, seed)))
}

/* ------------------------------ grading ------------------------------ */

const isTable = (i: Instance): boolean => i.variant === 'slo-count' || i.variant === 'goodput-rate'
const isReplicas = (i: Instance): boolean => i.variant === 'replicas'

/** A count that is not the key, as a share of it: the slip's answer over the truth (a rate shares the window, so the ratio is the same). */
const countRatio = (pick: (c: Tally) => number) => (i: Instance): number | null => {
  if (!isTable(i)) return null
  const c = tally(i.params)
  return pick(c) === c.both ? null : pick(c) / c.both
}

/** Replica slips as a share of the key; null when a slip cannot be told from the key or from another slip. */
function replicaRatio(i: Instance, slip: 'no-headroom' | 'floor' | 'per-minute'): number | null {
  if (!isReplicas(i)) return null
  const [lambda, g, h] = [num(i.params, 'lambda'), num(i.params, 'goodput'), num(i.params, 'headroom')]
  const { need, floor } = replicasOf(lambda, g, h)
  const x = slip === 'no-headroom' ? ceilDiv(lambda, g) : slip === 'floor' ? floor : i.params.peakUnit === 'min' ? replicasOf(peakPerMinute(i.params), g, h).need : need
  return x === need ? null : x / need
}

const RATIO_RULES: RatioRule[] = [
  {
    id: 'goodput.one-bound',
    ratio: countRatio((c) => c.ttft),
    message: (i) =>
      `You counted only the TTFT bound. A request counts when TTFT and TPOT both meet their limits, and some of the requests you counted missed TPOT.${i.params.ttftUnit === 's' ? ' Mind the units: the table gives TTFT in seconds.' : ''}`,
  },
  {
    id: 'goodput.one-bound-tpot',
    ratio: countRatio((c) => c.tpot),
    message: (i) =>
      `You counted only the TPOT bound. A request counts when TTFT and TPOT both meet their limits, and some of the requests you counted missed TTFT.${i.params.ttftUnit === 's' ? ' Mind the units: the table gives TTFT in seconds and the limit is in milliseconds.' : ''}`,
  },
  {
    id: 'goodput.all-requests',
    ratio: countRatio((c) => c.n),
    message: 'You counted every request. Goodput counts only the requests that met the SLO; the others were served but missed a bound.',
  },
  {
    id: 'goodput.per-minute',
    ratio: (i) => (i.variant === 'goodput-rate' ? S_PER_MIN : replicaRatio(i, 'per-minute')),
    message: (i) =>
      isReplicas(i)
        ? 'You set a per-minute peak against a per-second goodput. Convert first: requests per minute ÷ 60 is requests per second.'
        : i.params.winUnit === 'min'
          ? 'You divided by the window in minutes. A rate in requests per second needs the window in seconds: minutes × 60.'
          : 'You gave a rate per minute. The window is in seconds and the answer is per second: do not multiply by 60.',
  },
  {
    id: 'goodput.no-headroom',
    ratio: (i) => replicaRatio(i, 'no-headroom'),
    message: 'You divided the peak by a replica\'s whole goodput. With headroom each replica carries only (1 − headroom) of it at the peak, so you need more replicas.',
  },
  {
    id: 'goodput.floor',
    ratio: (i) => replicaRatio(i, 'floor'),
    message: 'You rounded down. A fraction of a replica is a whole replica you still have to run, so always round up.',
  },
]

const pin = (name: string, source: string, variant: string, level: Level, p: Params, truth: number, abs: number) => ({
  name,
  source,
  make: () => build(spec(variant), level, 1, p),
  truth,
  tolerance: { abs },
})

/**
 * t7.l1's pair, TTFT under 2 s and TPOT under 100 ms, over eight requests: R2 and R6 miss only TTFT, R3 misses only TPOT,
 * R4 misses both, and the other four (R1, R5, R7, R8) meet both. Counting one bound gives 5 or 6, every request 8.
 */
const L1_TABLE: Params = {
  sloTtft: SYNTHETIC.plainTtftMs,
  sloTpot: SYNTHETIC.plainTpotMs,
  ttft: '800,2400,1200,2600,1000,3000,400,1600',
  tpot: '60,40,150,120,80,70,50,90',
  ttftUnit: 'ms',
}

const gen: Gen = {
  id: 'goodput',
  version: 1,
  title: 'Goodput: SLO counts, the knee, the frontier and replicas',
  kcs: [KC.goodput, KC.goodputCurve, KC.paretoFrontier, KC.capacityPlanning],
  variants: VARIANTS,
  ratioRules: RATIO_RULES,
  make,
  grade: (inst, response) => gradeResponse(inst, response, RATIO_RULES),
  solution: (inst) => draftsOf(inst.variant, inst.params).map(full),
  pins: [
    pin('Eight requests under TTFT < 2 s and TPOT < 100 ms: four meet both (t7.l1)', 't7.l1', 'slo-count', 0, L1_TABLE, 4, 0), // gen-literal-ok: pinned lesson pair, four of eight requests
    pin('The same eight over a 10 s window: 0.4 req/s of goodput (t7.l1)', 't7.l1', 'goodput-rate', 0, { ...L1_TABLE, win: 10, winUnit: 's' }, 0.4, 1e-9), // gen-literal-ok: pinned lesson pair, 4 requests in 10 s
  ],
  bank: { units: SYNTHETIC.bankUnits },
}

export default gen
