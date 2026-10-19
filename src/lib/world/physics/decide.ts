/**
 * Decision-level H1 for `frontier`, its gradeable classes, the guesser bounds and the reader check (docs/specs/s5.md
 * §7.0-7.1; S5-D15, S5-D16, S5-D45, S5-D57, S5-D60; O7, O12), and the three measured findings of §5.8.
 *
 * `frontier` asks, for a row, a shape and a floor in tok/s per user: which option (TP × concurrency) gives the most output
 * tok/s per GPU among those whose tok/s per user meets the floor. The answer is the code 100·TP + c (protocol
 * `frontier.classesCount`). A scene (row, shape, floor) is gradeable when, on the published values:
 *  - at least two options qualify;
 *  - membership: every option's tok/s/user is at least δ_mem from the floor, relatively (δ_mem = the row's TPOT LOO p90 over
 *    the fit subset F, G1's);
 *  - separation: the winner's tok/s/GPU is at least 1 ÷ (1 − δ_sep) times the runner-up's (δ_sep = the p90 of the LOO error of
 *    the winner-to-runner-up ratio over every pair of the row's options of one shape);
 *  - LOO agreement: the answer from the leave-one-out predictions is the measured answer;
 *  - H2 and the band: the engine's answer (the `frontier` replays through the shipped table) is the measured answer, and the
 *    three margins above hold on the engine's values too.
 * Gradeable floors of one (row, shape, answer) form intervals on the protocol's floor grid; an interval narrower than the
 * width rule is dropped, and a (row, answer) class is kept when one of its intervals survives. Sampling is flattened (O12):
 * a class uniformly, then a (shape, floor) uniformly within its intervals. Under that sampling this file computes the share of
 * each answer code, the best scene-blind guesser's and the row-only guesser's chance to finish within 10 and 30 rounds (by
 * `ignoring()`, a pure copy of tests/fleet-ex/done-rule.test.ts:92-111, exact by dynamic programming over the done rule), and
 * the reader's (§3.8's two-card rule with the row's card parameters, the engine's numbers the scene shows). Kill rules 1, 1b,
 * 2 and 3 of §7.1 follow (S5-D45).
 *
 * The engine side comes from the `frontier` replays (S5-D60): one closed-loop replay per (shape, c), seeded by the protocol's
 * `frontier.replaySeed`, shared across TPs and rows. The step schedule does not depend on TP or row because in-box options
 * never preempt and the budget and `maxNumSeqs` are the same; `frontierReplay` checks it by replaying with the smallest and
 * the largest KV pool of the options it serves and requiring the same log.
 *
 * Pure and numeric-linted (§8.4): no constant of the protocol is written here; the caller (scripts/verify-physics.ts) reads
 * them from the protocol block and the claims and passes them in (S5-D46).
 */

import { stepCard } from './card'
import { predictTpot, replayNumBlocks, replayPoint, type ReplaySettings, type StepLog } from './replay'
import type { CardSpec, StepLoad } from './types'

/* ------------------------------ the done rule and the guessers ------------------------------ */

/** The done rule (protocol `fairness.doneRule`): `passes` right in a row on fresh seeds, on at least `answers` different answers. */
export interface DoneRule {
  passes: number
  answers: number
}

/** Reads "3 right in a row on fresh seeds with at least 2 distinct answers". */
export function parseDoneRule(text: string): DoneRule {
  const m = /^(\d+) right in a row on fresh seeds with at least (\d+) distinct answers$/.exec(text)
  if (!m) throw new Error(`fairness.doneRule is not "<n> right in a row on fresh seeds with at least <k> distinct answers": ${text}`)
  return { passes: Number(m[1]), answers: Number(m[2]) }
}

/** The truths of the run's last right rounds, at most `passes − 1` of them: all the rule needs to remember. */
export type Trail = readonly number[]

/**
 * One more round on a fresh seed, judged by the panel's rule (`runOf` in src/components/fleet-ex/session.ts): a miss starts
 * the run again; a right round extends it, and the run is done when its last `passes` answers hold `answers` distinct values.
 */
export function nextRound(rule: DoneRule, trail: Trail, guess: number, right: boolean): { trail: Trail; done: boolean } {
  if (!right) return { trail: [], done: false }
  const run = [...trail, guess]
  const done = run.length >= rule.passes && new Set(run.slice(-rule.passes)).size >= rule.answers
  return { trail: run.slice(-(rule.passes - 1)), done }
}

/**
 * P(done within `rounds`) for a guess that ignores the scene: `policy(round)` names the guess, or, without one, the best
 * guess given everything seen so far (the trail is all that matters to the rule; the seeds are independent). `p` maps each
 * answer to the share of seeds it is right on. A copy of `ignoring()` in tests/fleet-ex/done-rule.test.ts.
 */
export function ignoring(p: ReadonlyMap<number, number>, rounds: number, rule: DoneRule, policy?: (round: number) => number): number {
  const memo = new Map<string, number>()
  const f = (t: number, trail: Trail): number => {
    if (t === rounds) return 0
    const key = `${t}|${trail.join(',')}`
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let best = 0
    for (const g of policy ? [policy(t)] : [...p.keys()]) {
      const pg = p.get(g) ?? 0
      const right = nextRound(rule, trail, g, true)
      const wrong = nextRound(rule, trail, g, false)
      const v = pg * (right.done ? 1 : f(t + 1, right.trail)) + (1 - pg) * (wrong.done ? 1 : f(t + 1, wrong.trail))
      best = Math.max(best, v)
    }
    memo.set(key, best)
    return best
  }
  return f(0, [])
}

/** A row as a guesser that reads only the row sees it: how often it is drawn, and each answer's share given the row. */
export interface RowShares {
  weight: number
  shares: ReadonlyMap<number, number>
}

/**
 * P(done within `rounds`) for the best guesser that reads the scene's row and nothing else: each round the row is drawn by
 * its weight, then the guesser names the answer that maximises its chance given the row and the trail.
 */
export function rowOnly(rows: readonly RowShares[], rounds: number, rule: DoneRule): number {
  const codes = [...new Set(rows.flatMap((r) => [...r.shares.keys()]))].sort((a, b) => a - b)
  const memo = new Map<string, number>()
  const f = (t: number, trail: Trail): number => {
    if (t === rounds) return 0
    const key = `${t}|${trail.join(',')}`
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let total = 0
    for (const r of rows) {
      let best = 0
      for (const g of codes) {
        const pg = r.shares.get(g) ?? 0
        const right = nextRound(rule, trail, g, true)
        const v = pg * (right.done ? 1 : f(t + 1, right.trail)) + (1 - pg) * f(t + 1, [])
        best = Math.max(best, v)
      }
      total += r.weight * best
    }
    memo.set(key, total)
    return total
  }
  return f(0, [])
}

/** A class as the reader meets it: how often it is drawn, its answer, and the share of its scenes the reader gets right. */
export interface ReaderClass {
  weight: number
  answer: number
  right: number
}

/** P(done within `rounds`) for a reader of the scene, exactly: a class by its weight, then right with the class's share. */
export function readerDone(classes: readonly ReaderClass[], rounds: number, rule: DoneRule): number {
  const memo = new Map<string, number>()
  const f = (t: number, trail: Trail): number => {
    if (t === rounds) return 0
    const key = `${t}|${trail.join(',')}`
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let total = 0
    for (const k of classes) {
      const right = nextRound(rule, trail, k.answer, true)
      total += k.weight * (k.right * (right.done ? 1 : f(t + 1, right.trail)) + (1 - k.right) * f(t + 1, []))
    }
    memo.set(key, total)
    return total
  }
  return f(0, [])
}

/* ------------------------------ the replays (S5-D60) ------------------------------ */

/**
 * The seed rule of the `frontier` replays (protocol `frontier.replaySeed`), read as a template:
 * `hash32('<prefix>' + isl + '<a>' + osl + '<b>' + c)`. Returns the string the hash reads for (isl, osl, c).
 */
export function parseReplaySeed(rule: string): (isl: number, osl: number, conc: number) => string {
  const m = /^hash32\('([^']*)' \+ isl \+ '([^']*)' \+ osl \+ '([^']*)' \+ c\)$/.exec(rule)
  if (!m) throw new Error(`frontier.replaySeed is not hash32('<prefix>' + isl + '<sep>' + osl + '<sep>' + c): ${rule}`)
  const [, prefix, a, b] = m
  return (isl, osl, conc) => `${prefix}${isl}${a}${osl}${b}${conc}`
}

/** The multiplier of TP in an answer code ("distinct answer codes (100 * TP + c) across rows", protocol `frontier.classesCount`). */
export function parseCodeMultiplier(text: string): number {
  const m = /\((\d+) \* TP \+ c\)/.exec(text)
  if (!m) throw new Error(`frontier.classesCount names no "(<k> * TP + c)" code: ${text}`)
  return Number(m[1])
}

/** One option a replay serves: the row's card (for its KV pool and its step prices) and the TP. */
export interface ReplayUser {
  row: string
  spec: CardSpec
  tp: number
}

export interface FrontierReplay {
  isl: number
  osl: number
  conc: number
  seed: number
  log: StepLog
  /** the KV pools, in blocks, of the options it serves: the replay ran at the smallest and was checked at the largest */
  pools: { min: number; max: number }
  /** whether the largest pool's replay was run and found equal (false only when every pool is the same size) */
  checkedAtMax: boolean
  sequenceSteps: number
}

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Whether two replays scheduled the same steps for the same requests. */
export function sameSchedule(a: StepLog, b: StepLog): boolean {
  return (
    a.steps === b.steps &&
    a.requests === b.requests &&
    sameArray(a.seqs, b.seqs) &&
    sameArray(a.tokens, b.tokens) &&
    sameArray(a.kvTokens, b.kvTokens) &&
    sameArray(a.attnPairs, b.attnPairs) &&
    sameArray(a.decodeSeqs, b.decodeSeqs) &&
    sameArray(a.weights, b.weights) &&
    sameArray(a.prompt, b.prompt) &&
    sameArray(a.output, b.output) &&
    sameArray(a.admitStep, b.admitStep) &&
    sameArray(a.firstStep, b.firstStep) &&
    sameArray(a.lastStep, b.lastStep)
  )
}

/**
 * The one replay of (shape, c), shared by every option in `users` (S5-D60). It runs at the smallest KV pool among them and,
 * when the pools differ, again at the largest; the two logs must be equal, so no option's pool ever held an admission back
 * (by induction every pool in between schedules the same steps), and `replayPoint` already throws on any preemption.
 */
export function frontierReplay(shape: { isl: number; osl: number }, conc: number, seed: number, users: readonly ReplayUser[], s: ReplaySettings): FrontierReplay {
  if (users.length === 0) throw new Error(`frontier replay ${shape.isl}/${shape.osl} c ${conc}: no option uses it`)
  const pool = (u: ReplayUser) => replayNumBlocks(u.spec, u.tp, s)
  let lo = users[0]
  let hi = users[0]
  for (const u of users) {
    if (pool(u) < pool(lo)) lo = u
    if (pool(u) > pool(hi)) hi = u
  }
  const id = `frontier ${shape.isl}/${shape.osl} c ${conc}`
  const point = (u: ReplayUser) => ({ id, tp: u.tp, conc, isl: shape.isl, osl: shape.osl, seed })
  const log = replayPoint(lo.spec, point(lo), s)
  const checkedAtMax = pool(hi) > pool(lo)
  if (checkedAtMax && !sameSchedule(log, replayPoint(hi.spec, point(hi), s))) {
    throw new Error(`${id}: the replay at ${pool(lo)} blocks (${lo.row} TP ${lo.tp}) and at ${pool(hi)} blocks (${hi.row} TP ${hi.tp}) differ, so the schedule depends on the option (S5-D60)`)
  }
  let sequenceSteps = 0
  for (let i = 0; i < log.steps; i++) sequenceSteps += log.seqs[i]
  return { isl: shape.isl, osl: shape.osl, conc, seed, log, pools: { min: pool(lo), max: pool(hi) }, checkedAtMax, sequenceSteps }
}

/** The engine's mean TPOT for one option, seconds: the shared log priced through the row's card at the option's TP. */
export const engineTpot = (log: StepLog, spec: CardSpec, tp: number): number => predictTpot({ ...log, tp }, spec)

/* ------------------------------ the reader (§3.8) ------------------------------ */

/** Mean of the integers [⌊ratio·L⌋, L], the harness's uniform lengths. */
export const meanLength = (L: number, ratio: number): number => (Math.floor(ratio * L) + L) / 2

/** §3.6's decode step: c users decoding at the prompt mean plus half the output mean. */
export function decodeLoad(conc: number, isl: number, osl: number, ratio: number): StepLoad {
  const ctx = meanLength(isl, ratio) + meanLength(osl, ratio) / 2
  return { seqs: conc, tokens: conc, kvTokens: conc * ctx, attnPairs: conc * ctx }
}

/** §3.7's prefill step: one prompt of the mean length prefilling beside c − 1 decodes at its context plus half the output mean. */
export function prefillLoad(conc: number, isl: number, osl: number, ratio: number): StepLoad {
  const p = Math.round(meanLength(isl, ratio))
  const dctx = p + Math.round(meanLength(osl, ratio) / 2)
  const d = conc - 1
  return { seqs: conc, tokens: p + d, kvTokens: p + d * dctx, attnPairs: (p * (p + 1)) / 2 + d * dctx }
}

/**
 * §3.8's two-card rule, what a reader of the scene can work by hand with the engine's numbers: a long prompt arriving among c
 * running users makes one step of about t_pre instead of t_dec, and each user's OSL decode steps include about c − 1 of them,
 * so TPOT ≈ t_dec + (c − 1)(t_pre − t_dec) ÷ OSL. Seconds.
 */
export function twoCardTpot(spec: CardSpec, tp: number, conc: number, isl: number, osl: number, ratio: number): number {
  const tDec = stepCard(spec, tp, decodeLoad(conc, isl, osl, ratio)).stepS
  const tPre = stepCard(spec, tp, prefillLoad(conc, isl, osl, ratio)).stepS
  return tDec + ((conc - 1) * (tPre - tDec)) / meanLength(osl, ratio)
}

/* ------------------------------ H1 on published pairs ------------------------------ */

/** One option of a row's frontier: a published F point in the box, with its TPOT as each side sees it, seconds. */
export interface FrontierOption {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  /** published mean TPOT */
  meas: number
  /** the leave-one-out refit's prediction */
  loo: number
  /** the engine's: the shared replay through the shipped table */
  engine: number
  /** the reader's two-card estimate with the shipped table's parameters */
  reader: number
}

/** tok/s per GPU of an option at a TPOT: c ÷ (TPOT × TP). */
export const perGpu = (o: { tp: number; conc: number }, tpot: number): number => o.conc / (tpot * o.tp)

/** One pair of a row's options of one shape: the winner-to-runner-up kind of ratio, measured and from LOO predictions. */
export interface PairRatio {
  isl: number
  osl: number
  a: string
  b: string
  /** tok/s/GPU of a ÷ that of b */
  meas: number
  loo: number
  /** |loo ÷ meas − 1| */
  error: number
}

/** The δ_sep table (protocol `h1.separation`): every pair of options of one shape, in the options' order, a before b. */
export function pairRatios(options: readonly FrontierOption[]): PairRatio[] {
  const out: PairRatio[] = []
  for (const shape of shapesOf(options)) {
    const o = options.filter((x) => x.isl === shape.isl && x.osl === shape.osl)
    for (let i = 0; i < o.length; i++) {
      for (let j = i + 1; j < o.length; j++) {
        const meas = perGpu(o[i], o[i].meas) / perGpu(o[j], o[j].meas)
        const loo = perGpu(o[i], o[i].loo) / perGpu(o[j], o[j].loo)
        out.push({ isl: shape.isl, osl: shape.osl, a: o[i].id, b: o[j].id, meas, loo, error: Math.abs(loo / meas - 1) })
      }
    }
  }
  return out
}

/** The distinct shapes of a set of options, by (isl, osl). */
export function shapesOf(options: readonly { isl: number; osl: number }[]): { isl: number; osl: number }[] {
  const seen = new Map<string, { isl: number; osl: number }>()
  for (const o of options) seen.set(`${o.isl}/${o.osl}`, { isl: o.isl, osl: o.osl })
  return [...seen.values()].sort((a, b) => a.isl - b.isl || a.osl - b.osl)
}

/* ------------------------------ scenes ------------------------------ */

/** What one side of a scene says: how many options qualify, the winner and runner-up, their ratio, and the closest option to the floor. */
export interface Choice {
  qualifying: number
  answer: number | null
  runnerUp: number | null
  /** winner's tok/s/GPU ÷ runner-up's (0 with fewer than two qualifying) */
  ratio: number
  /** min over every option of |tok/s/user ÷ floor − 1| */
  minGap: number
}

/** The answer under one side's TPOTs: the most tok/s/GPU among options with 1 ÷ TPOT ≥ floor (ties to the lower code). */
export function choose(options: readonly FrontierOption[], tpotOf: (o: FrontierOption) => number, floor: number, mult: number): Choice {
  const q: { code: number; gpu: number }[] = []
  let minGap = Infinity
  for (const o of options) {
    const t = tpotOf(o)
    const user = 1 / t
    minGap = Math.min(minGap, Math.abs(user / floor - 1))
    if (user >= floor) q.push({ code: mult * o.tp + o.conc, gpu: perGpu(o, t) })
  }
  q.sort((a, b) => b.gpu - a.gpu || a.code - b.code)
  return {
    qualifying: q.length,
    answer: q.length > 0 ? q[0].code : null,
    runnerUp: q.length > 1 ? q[1].code : null,
    ratio: q.length > 1 ? q[0].gpu / q[1].gpu : 0,
    minGap,
  }
}

/**
 * Why a scene is or is not gradeable, in the order the checks run: on the published values too few options, membership or
 * separation; then LOO agreement; then H2 (the engine's answer) and the engine's own margins (the band).
 */
export type SceneVerdict = 'ok' | 'few' | 'membership' | 'separation' | 'loo' | 'h2' | 'engine-margins'

export const VERDICTS: readonly SceneVerdict[] = ['few', 'membership', 'separation', 'loo', 'h2', 'engine-margins', 'ok']

/** The H1 margins of a row (protocol `h1`): membership δ_mem and separation δ_sep, as fractions. */
export interface Margins {
  deltaMem: number
  deltaSep: number
}

export function sceneVerdict(options: readonly FrontierOption[], floor: number, m: Margins, mult: number): { verdict: SceneVerdict; answer: number | null } {
  const sepMin = 1 / (1 - m.deltaSep)
  const margins = (c: Choice): SceneVerdict | null => (c.qualifying < 2 ? 'few' : c.minGap < m.deltaMem ? 'membership' : c.ratio < sepMin ? 'separation' : null)
  const meas = choose(options, (o) => o.meas, floor, mult)
  const bad = margins(meas)
  if (bad) return { verdict: bad, answer: meas.answer }
  if (choose(options, (o) => o.loo, floor, mult).answer !== meas.answer) return { verdict: 'loo', answer: meas.answer }
  const eng = choose(options, (o) => o.engine, floor, mult)
  if (eng.answer !== meas.answer) return { verdict: 'h2', answer: meas.answer }
  if (margins(eng)) return { verdict: 'engine-margins', answer: meas.answer }
  return { verdict: 'ok', answer: meas.answer }
}

/* ------------------------------ classes and fairness ------------------------------ */

/** The floor grid (protocol `frontier.floorFrom`, `floorTo`, `floorStep`) as whole steps: floor k is k ÷ perUnit tok/s/user. */
export interface FloorGrid {
  first: number
  last: number
  perUnit: number
}

export function floorGrid(from: number, to: number, step: number): FloorGrid {
  const perUnit = Math.round(1 / step)
  if (1 / perUnit !== step) throw new Error(`floor step ${step} is not 1 ÷ a whole number`)
  const first = Math.round(from * perUnit)
  const last = Math.round(to * perUnit)
  if (first / perUnit !== from || last / perUnit !== to || last < first) throw new Error(`floors ${from}–${to} are not on the ${step} grid`)
  return { first, last, perUnit }
}

/** A run of consecutive gradeable floors of one (row, shape) with one answer: floors from ÷ perUnit to to ÷ perUnit. */
export interface FloorInterval {
  isl: number
  osl: number
  /** grid steps (floor = step ÷ perUnit) */
  from: number
  to: number
}

export interface FrontierRowInput {
  key: string
  margins: Margins
  options: readonly FrontierOption[]
}

export interface FrontierRules {
  grid: FloorGrid
  /** the narrowest interval kept, in grid steps (protocol `frontier.classWidthMin` × perUnit) */
  widthMin: number
  classesMin: number
  /** the TP multiplier of an answer code */
  mult: number
  rule: DoneRule
  answerShareMax: number
  blindWithin10Max: number
  blindWithin30Max: number
  readerWithin10Min: number
}

export interface FrontierClass {
  row: string
  answer: number
  tp: number
  conc: number
  intervals: FloorInterval[]
  /** gradeable floors in its intervals: the scenes flattened sampling draws from */
  scenes: number
  /** of those, the scenes the reader gets right */
  readerRight: number
}

export interface RowCounts {
  scenes: number
  /** pass measured H1 (two qualify, membership, separation) */
  measuredH1: number
  /** … and LOO agreement */
  looAgree: number
  /** … and H2 with the engine's margins: the band */
  band: number
  /** … and inside an interval the width rule keeps */
  classScenes: number
  verdicts: Record<SceneVerdict, number>
}

export interface Bounds {
  within10: number
  within30: number
}

export interface KillCheck {
  rule: '1' | '1b' | '2' | '3'
  trips: boolean
  detail: string
}

export interface FrontierResult {
  counts: Record<string, RowCounts>
  /** every interval of gradeable floors, kept or not */
  intervals: { row: string; answer: number; interval: FloorInterval; width: number; kept: boolean }[]
  classes: FrontierClass[]
  /** classes the width rule dropped entirely, with their widest interval in grid steps */
  narrowClasses: { row: string; answer: number; widest: number }[]
  distinctAnswers: number[]
  sampling: {
    shares: { answer: number; share: number }[]
    maxShare: number
    sceneBlind: Bounds
    rowOnly: Bounds
    reader: Bounds & { right: number; scenes: number }
  }
  kill: KillCheck[]
  killed: boolean
  /** the first rule that trips, in §7.1's order, or null */
  rule: string | null
}

const zeroVerdicts = (): Record<SceneVerdict, number> => ({ few: 0, membership: 0, separation: 0, loo: 0, h2: 0, 'engine-margins': 0, ok: 0 })

/** Decision-level H1 over every scene of every row, the classes, flattened sampling and kill rules 1, 1b, 2 and 3. */
export function buildFrontier(rows: readonly FrontierRowInput[], r: FrontierRules): FrontierResult {
  const counts: Record<string, RowCounts> = {}
  const intervals: FrontierResult['intervals'] = []
  const byClass = new Map<string, FrontierClass>()
  const order: string[] = []
  rows.forEach((row) => {
    const c: RowCounts = { scenes: 0, measuredH1: 0, looAgree: 0, band: 0, classScenes: 0, verdicts: zeroVerdicts() }
    for (const shape of shapesOf(row.options)) {
      const opts = row.options.filter((o) => o.isl === shape.isl && o.osl === shape.osl)
      let open: { answer: number; from: number; to: number } | null = null
      const close = () => {
        if (!open) return
        const interval: FloorInterval = { isl: shape.isl, osl: shape.osl, from: open.from, to: open.to }
        const width = open.to - open.from
        const kept = width >= r.widthMin
        intervals.push({ row: row.key, answer: open.answer, interval, width, kept })
        if (kept) {
          const key = `${row.key}|${open.answer}`
          let k = byClass.get(key)
          if (!k) {
            k = { row: row.key, answer: open.answer, tp: Math.floor(open.answer / r.mult), conc: open.answer % r.mult, intervals: [], scenes: 0, readerRight: 0 }
            byClass.set(key, k)
            order.push(key)
          }
          k.intervals.push(interval)
          for (let f = open.from; f <= open.to; f++) {
            k.scenes += 1
            if (choose(opts, (o) => o.reader, f / r.grid.perUnit, r.mult).answer === open.answer) k.readerRight += 1
          }
          c.classScenes += open.to - open.from + 1
        }
        open = null
      }
      for (let f = r.grid.first; f <= r.grid.last; f++) {
        const v = sceneVerdict(opts, f / r.grid.perUnit, row.margins, r.mult)
        c.scenes += 1
        c.verdicts[v.verdict] += 1
        if (v.verdict === 'loo' || v.verdict === 'h2' || v.verdict === 'engine-margins' || v.verdict === 'ok') c.measuredH1 += 1
        if (v.verdict === 'h2' || v.verdict === 'engine-margins' || v.verdict === 'ok') c.looAgree += 1
        if (v.verdict === 'ok' && v.answer !== null) {
          c.band += 1
          if (open && open.answer === v.answer && open.to === f - 1) open.to = f
          else {
            close()
            open = { answer: v.answer, from: f, to: f }
          }
        } else close()
      }
      close()
    }
    counts[row.key] = c
  })
  const rowIndex = new Map(rows.map((x, i) => [x.key, i]))
  const classes = order.map((k) => byClass.get(k) as FrontierClass).sort((a, b) => (rowIndex.get(a.row) ?? 0) - (rowIndex.get(b.row) ?? 0) || a.answer - b.answer)
  const narrow = new Map<string, { row: string; answer: number; widest: number }>()
  for (const x of intervals) {
    if (byClass.has(`${x.row}|${x.answer}`)) continue
    const key = `${x.row}|${x.answer}`
    const held = narrow.get(key)
    if (!held || x.width > held.widest) narrow.set(key, { row: x.row, answer: x.answer, widest: x.width })
  }
  const narrowClasses = [...narrow.values()].sort((a, b) => (rowIndex.get(a.row) ?? 0) - (rowIndex.get(b.row) ?? 0) || a.answer - b.answer)

  // flattened sampling (O12): a class uniformly, then a scene uniformly within it
  const n = classes.length
  const shareOf = new Map<number, number>()
  for (const k of classes) shareOf.set(k.answer, (shareOf.get(k.answer) ?? 0) + 1)
  const shares = [...shareOf].sort((a, b) => a[0] - b[0]).map(([answer, count]) => ({ answer, share: count / n }))
  const p = new Map(shares.map((s) => [s.answer, s.share]))
  const maxShare = shares.reduce((m, s) => Math.max(m, s.share), 0)
  const perRow: RowShares[] = rows
    .map((row) => {
      const own = classes.filter((k) => k.row === row.key)
      return { weight: own.length / n, shares: new Map(own.map((k) => [k.answer, 1 / own.length])) }
    })
    .filter((x) => x.weight > 0)
  const readerClasses = classes.map((k) => ({ weight: 1 / n, answer: k.answer, right: k.readerRight / k.scenes }))
  const bounds = (f: (rounds: number) => number): Bounds => (n === 0 ? { within10: 0, within30: 0 } : { within10: f(10), within30: f(30) })
  const sceneBlind = bounds((t) => ignoring(p, t, r.rule))
  const row = bounds((t) => rowOnly(perRow, t, r.rule))
  const reader = bounds((t) => readerDone(readerClasses, t, r.rule))
  const readerRight = classes.reduce((s, k) => s + k.readerRight, 0)
  const readerScenes = classes.reduce((s, k) => s + k.scenes, 0)
  const distinctAnswers = [...shareOf.keys()].sort((a, b) => a - b)
  const pc = (x: number) => `${(100 * x).toFixed(1)} %`
  const kill: KillCheck[] = [
    { rule: '1', trips: distinctAnswers.length < r.classesMin, detail: `${distinctAnswers.length} distinct answer codes survive H1, H2 and the width rule (at least ${r.classesMin}); ${n} (row, answer) classes` },
    { rule: '1b', trips: maxShare > r.answerShareMax, detail: `the largest answer share under flattened sampling is ${pc(maxShare)} (at most ${pc(r.answerShareMax)})` },
    {
      rule: '2',
      trips: !(n > 0) || sceneBlind.within10 > r.blindWithin10Max || sceneBlind.within30 > r.blindWithin30Max,
      detail: `the best scene-blind guesser finishes within 10 rounds ${pc(sceneBlind.within10)} (at most ${pc(r.blindWithin10Max)}) and within 30 ${pc(sceneBlind.within30)} (at most ${pc(r.blindWithin30Max)})`,
    },
    { rule: '3', trips: !(reader.within10 > r.readerWithin10Min), detail: `the reader finishes within 10 rounds ${pc(reader.within10)} (above ${pc(r.readerWithin10Min)}); right on ${readerRight} of ${readerScenes} class scenes` },
  ]
  const first = kill.find((k) => k.trips)
  return {
    counts,
    intervals,
    classes,
    narrowClasses,
    distinctAnswers,
    sampling: { shares, maxShare, sceneBlind, rowOnly: row, reader: { ...reader, right: readerRight, scenes: readerScenes } },
    kill,
    killed: first !== undefined,
    rule: first ? `kill rule ${first.rule}: ${first.detail}` : null,
  }
}

/* ------------------------------ the findings (§5.8) ------------------------------ */

/** A published point as the findings read it: TPOT in seconds. */
export interface MeasuredPoint {
  id: string
  tp: number
  conc: number
  isl: number
  osl: number
  tpot: number
}

/**
 * Finding 1: for every scene (shape, floor) where both rows have a qualifying published option, the cost per output token
 * of each row's frontier answer (price per GPU-hour ÷ its tok/s/GPU) and whether the second row is cheaper.
 */
export function cheaperPerToken(
  a: { options: readonly MeasuredPoint[]; pricePerHour: number },
  b: { options: readonly MeasuredPoint[]; pricePerHour: number },
  grid: FloorGrid,
  mult: number,
): { scenes: number; bCheaper: number; minAdvantage: number; maxAdvantage: number; atMin: { isl: number; osl: number; floor: number; a: number; b: number } | null } {
  const best = (opts: readonly MeasuredPoint[], floor: number) => {
    let top: { code: number; gpu: number } | null = null
    for (const o of opts) {
      if (!(1 / o.tpot >= floor)) continue
      const gpu = perGpu(o, o.tpot)
      const code = mult * o.tp + o.conc
      if (!top || gpu > top.gpu || (gpu === top.gpu && code < top.code)) top = { code, gpu }
    }
    return top
  }
  let scenes = 0
  let bCheaper = 0
  let minAdvantage = Infinity
  let maxAdvantage = 0
  let atMin: { isl: number; osl: number; floor: number; a: number; b: number } | null = null
  for (const shape of shapesOf([...a.options, ...b.options])) {
    const ao = a.options.filter((o) => o.isl === shape.isl && o.osl === shape.osl)
    const bo = b.options.filter((o) => o.isl === shape.isl && o.osl === shape.osl)
    for (let f = grid.first; f <= grid.last; f++) {
      const floor = f / grid.perUnit
      const x = best(ao, floor)
      const y = best(bo, floor)
      if (!x || !y) continue
      scenes += 1
      // cost per token ∝ price ÷ tok/s/GPU; the advantage is a's cost ÷ b's
      const adv = a.pricePerHour / x.gpu / (b.pricePerHour / y.gpu)
      if (adv > 1) bCheaper += 1
      if (adv < minAdvantage) {
        minAdvantage = adv
        atMin = { isl: shape.isl, osl: shape.osl, floor, a: x.code, b: y.code }
      }
      maxAdvantage = Math.max(maxAdvantage, adv)
    }
  }
  return { scenes, bCheaper, minAdvantage: scenes > 0 ? minAdvantage : 0, maxAdvantage, atMin }
}

/** Finding 2: TPOT(a) ÷ TPOT(b) over every configuration both rows publish, among `tps`. */
export function tpotRatios(a: readonly MeasuredPoint[], b: readonly MeasuredPoint[], tps: readonly number[]): { a: string; b: string; tp: number; conc: number; isl: number; osl: number; ratio: number }[] {
  const out: { a: string; b: string; tp: number; conc: number; isl: number; osl: number; ratio: number }[] = []
  for (const x of a) {
    if (!tps.includes(x.tp)) continue
    const y = b.find((o) => o.tp === x.tp && o.conc === x.conc && o.isl === x.isl && o.osl === x.osl)
    if (y) out.push({ a: x.id, b: y.id, tp: x.tp, conc: x.conc, isl: x.isl, osl: x.osl, ratio: x.tpot / y.tpot })
  }
  return out.sort((p, q) => p.tp - q.tp || p.conc - q.conc || p.isl - q.isl || p.osl - q.osl)
}
