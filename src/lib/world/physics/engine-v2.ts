/**
 * EngineV2 — the Fleet's step-time engine (docs/specs/s5.md §6.2-6.4; S5-D8 to S5-D14, S5-D26, S5-D53).
 *
 * One `step()` is one scheduler iteration of a vLLM-V1-like engine: FCFS admission up to `maxNumSeqs`, a per-step
 * token budget filled by decodes, then running prefills, then new ones (chunked), and a duration that is exactly the
 * step card's `us` for the step's load. Time is an integer-µs clock; a token is stamped at the end of the step that
 * made it; an engine with nothing to do jumps its clock to the next arrival without an iteration. There is no
 * pluggable scheduler, no fault and no cluster (S5-D26). The engine reads its row from the frozen table and never a
 * claim (I3); it is a separate class from v1's `Engine`, from which it imports types only (S5-D8, I1).
 *
 * The order inside `step()` is the contract that `ENGINE_V2_REV` names; the golden fixture
 * (tests/fixtures/physics/engine-v2-golden.json) pins it, so a change to scheduling or stamping must bump the rev.
 */

import type { ManagerDriver } from '../../fleet-model'
import { BOX_BLOCK_SIZE, defaultNumBlocks, exceeds, inBox } from './box'
import { stepCard } from './card'
import type { ClientDriver, Request } from './client'
import type { CalibratedRow, StepCard, StepLoad } from './types'

/** Bumped with any change to scheduling or stamping semantics; it enters `PHYS_ID` (§6.4). */
export const ENGINE_V2_REV = 'ev2-1'

/** A failed row, or a metric the row is not eligible for, run without `explore`. */
export class NotCalibrated extends Error {
  readonly row: string
  readonly metric: 'tpot' | 'ttft'
  constructor(row: string, metric: 'tpot' | 'ttft') {
    super(`physics row ${row} is not calibrated for ${metric}`)
    this.name = 'NotCalibrated'
    this.row = row
    this.metric = metric
  }
}

/** A configuration outside the row's coverage box (§6.3), run without `explore`. */
export class OutOfBox extends Error {
  readonly row: string
  readonly reason: string
  constructor(row: string, reason: string) {
    super(`out of the box of ${row}: ${reason}`)
    this.name = 'OutOfBox'
    this.row = row
    this.reason = reason
  }
}

export interface EngineV2Config {
  /** id = PHYS_ID */
  physics: { id: string; row: CalibratedRow; tp: number }
  /** vLLM max_num_seqs semantics */
  maxNumSeqs: number
  /** per-step token budget (box: 8,192) */
  batchTokens: number
  blockSize: typeof BOX_BLOCK_SIZE
  /** default ⌊(0.9·HBM·TP − W) ÷ (kv·16)⌋; the manager the caller builds must hold exactly this many blocks */
  numBlocks?: number
  /** what the caller will read; checked against the row's eligibility (default 'tpot') */
  metric?: 'tpot' | 'ttft'
  /** allow failed rows and out-of-box configurations, labelled (`extrapolated`); never graded */
  explore?: boolean
  /** called after the batch is formed, before clockUs advances; unset: no effect (S5-D53) */
  onStep?: (s: StepRecord) => void
  /** replaces stepCard for replays; only with explore (S5-D53) */
  card?: (load: StepLoad, tp: number) => StepCard
}

/** One step as the hook sees it: the load, the TP, and which request ids decoded, completed prefill or were admitted. */
export interface StepRecord {
  load: StepLoad
  tp: number
  decoded: readonly number[]
  prefillDone: readonly number[]
  admitted: readonly number[]
}

/** One completed request; every time is integer µs except `tpotUs`, a mean gap. */
export interface FinishedV2 {
  id: number
  arrivalUs: number
  /** first admission (a recompute preemption keeps it) */
  admitUs: number
  firstUs: number
  lastUs: number
  /** from arrival */
  ttftUs: number
  /** from admission: what the closed loop compares (S5-D9) */
  ttftAdmitUs: number
  /** (lastUs − firstUs) ÷ (output − 1); 0 for a one-token output */
  tpotUs: number
  queueUs: number
}

export interface EngineV2Stats {
  completed: number
  /** arithmetic mean over completed requests of tpotUs, in completion order */
  meanTpotUs: number
  /** median over completed requests of ttftAdmitUs, by the protocol's rule (`stats.median`) */
  medianTtftUs: number
  /** 1e6 ÷ meanTpotUs: what one user sees, tokens per second */
  tokPerSUser: number
  /** output tokens × 1e6 ÷ (clockUs × tp) */
  outputTokPerSGpu: number
  outputTokens: number
  /** the clock when the stats were read, µs */
  clockUs: number
  iterations: number
  outOfEnvelope: number
  preemptions: number
}

/** The protocol's median (`stats.median`, numpy's): the middle value for odd n, the mean of the two middle ones for even. */
export function medianOf(xs: readonly number[]): number {
  const n = xs.length
  if (n === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2
}

/** A request inside the engine. `target` is what its (re)prefill computes: the prompt, plus its outputs after a recompute. */
interface SeqV2 {
  req: Request
  admitUs: number
  /** tokens emitted so far */
  emitted: number
  target: number
  /** prefill tokens still to compute; 0 once decoding */
  left: number
  firstUs: number
  lastUs: number
  /** this step's prefill chunk (step-local) */
  chunk: number
}

const byArrival = (a: SeqV2, b: SeqV2): number => a.req.arrivalUs - b.req.arrivalUs || a.req.id - b.req.id

export class EngineV2 {
  private _clockUs = 0
  private _iterations = 0
  private _outOfEnvelope = 0
  private preemptionCount = 0
  /** the card of the last step run, so a panel can print it */
  lastCard?: StepCard
  /** per-completion hook */
  onFinish?: (r: FinishedV2) => void
  /** why this run is extrapolated (explore mode past a check); empty for a calibrated, in-box run */
  readonly extrapolated: readonly string[]

  private readonly cfg: EngineV2Config
  private readonly row: CalibratedRow
  private readonly tp: number
  private readonly mgr: ManagerDriver
  private readonly client: ClientDriver
  /** waiting requests, FCFS: preempted ones go back to the front */
  private waiting: SeqV2[] = []
  /** running requests in admission order */
  private running: SeqV2[] = []
  private tpots: number[] = []
  private ttftAdmits: number[] = []
  private outputTokens = 0

  constructor(cfg: EngineV2Config, mgr: ManagerDriver, client: ClientDriver) {
    const { row, tp } = cfg.physics
    const metric = cfg.metric ?? 'tpot'
    const explore = cfg.explore === true
    if (!Number.isInteger(cfg.maxNumSeqs) || cfg.maxNumSeqs < 1) throw new Error(`maxNumSeqs must be a positive integer: ${cfg.maxNumSeqs}`)
    if (!Number.isInteger(cfg.batchTokens) || cfg.batchTokens < 1) throw new Error(`batchTokens must be a positive integer: ${cfg.batchTokens}`)
    if (!Number.isInteger(tp) || tp < 1) throw new Error(`tp must be a positive integer: ${tp}`)
    if (cfg.card && !explore) throw new Error('a card override replaces the physics: it needs explore (S5-D53)')
    const why: string[] = []
    if (row.status !== 'calibrated' || !row.eligible[metric]) {
      if (!explore) throw new NotCalibrated(row.key, metric)
      why.push(row.status !== 'calibrated' ? `row ${row.key} failed its gate` : `row ${row.key} is not eligible for ${metric}`)
    }
    const numBlocks = cfg.numBlocks ?? defaultNumBlocks(row, tp, cfg.blockSize)
    if (!Number.isSafeInteger(numBlocks) || numBlocks < 0) throw new Error(`the KV pool must be a whole number of blocks: ${numBlocks}`)
    const box = inBox(row, { tp, maxNumSeqs: cfg.maxNumSeqs, batchTokens: cfg.batchTokens, blockSize: cfg.blockSize, numBlocks, shape: client.shape })
    if (!box.ok) {
      if (!explore) throw new OutOfBox(row.key, box.reason)
      why.push(box.reason)
    }
    if (mgr.freeBlocks() !== numBlocks) {
      const reason = `the block manager holds ${mgr.freeBlocks()} free blocks, not the ${numBlocks} configured`
      if (!explore) throw new OutOfBox(row.key, reason)
      why.push(reason)
    }
    if (cfg.card) why.push('the step card is overridden')
    this.cfg = cfg
    this.row = row
    this.tp = tp
    this.mgr = mgr
    this.client = client
    this.extrapolated = why
  }

  /** integer µs */
  get clockUs(): number {
    return this._clockUs
  }

  get iterations(): number {
    return this._iterations
  }

  get outOfEnvelope(): number {
    return this._outOfEnvelope
  }

  done(): boolean {
    return this.running.length === 0 && this.waiting.length === 0 && this.client.nextArrivalUs() === null
  }

  /** Steps until done. */
  run(): this {
    while (!this.done()) this.step()
    return this
  }

  /** Exactly one iteration, or an idle jump, which is not one. */
  step(): void {
    // 1. idle: jump to the next arrival; no step, no iteration
    if (this.running.length === 0 && this.waiting.length === 0) {
      const next = this.client.nextArrivalUs()
      if (next === null) return
      if (next > this._clockUs) {
        this._clockUs = next
        return
      }
    }
    const now = this._clockUs
    // 2. inject due arrivals
    for (const req of this.client.due(now)) {
      this.waiting.push({ req, admitUs: -1, emitted: 0, target: req.prompt, left: req.prompt, firstUs: -1, lastUs: -1, chunk: 0 })
    }
    // 3. admit FCFS while a slot is free and the prompt's blocks (plus outputs to recompute) allocate
    const hook = this.cfg.onStep
    const admitted: number[] = []
    const fresh: SeqV2[] = []
    while (this.waiting.length > 0 && this.running.length < this.cfg.maxNumSeqs) {
      const s = this.waiting[0]
      if (!this.mgr.allocate(s.req.id, s.target)) break
      this.waiting.shift()
      if (s.admitUs < 0) s.admitUs = now
      this.running.push(s)
      fresh.push(s)
      admitted.push(s.req.id)
    }
    if (this.running.length === 0) {
      throw new Error(`the KV pool cannot hold request ${this.waiting[0].req.id} (${this.waiting[0].target} tokens)`)
    }
    // 4. the batch: decodes first, one token each; then running prefills; then new prefills; each takes min(left, budget)
    let budget = this.cfg.batchTokens
    let seqs = 0
    let tokens = 0
    let kvTokens = 0
    let attnPairs = 0
    const decoders: SeqV2[] = []
    for (let i = 0; i < this.running.length && budget > 0; i++) {
      const s = this.running[i]
      if (s.left > 0) continue
      // the token computed now writes its KV; on a full pool, preempt the newest (recompute), possibly s itself
      let preemptedSelf = false
      while (!this.mgr.append(s.req.id, 1)) {
        const victim = this.running[this.running.length - 1]
        this.preempt(victim)
        if (victim === s) {
          preemptedSelf = true
          break
        }
      }
      if (preemptedSelf) break
      const context = s.req.prompt + s.emitted
      seqs += 1
      tokens += 1
      kvTokens += context
      attnPairs += context
      budget -= 1
      decoders.push(s)
    }
    const prefills: SeqV2[] = []
    const old: SeqV2[] = []
    const neu: SeqV2[] = []
    for (const s of this.running) if (s.left > 0) (fresh.includes(s) ? neu : old).push(s)
    if (old.length > 1) old.sort(byArrival)
    if (neu.length > 1) neu.sort(byArrival)
    for (const s of [...old, ...neu]) {
      if (budget === 0) break
      const p = s.left < budget ? s.left : budget
      const h = s.target - s.left
      s.chunk = p
      seqs += 1
      tokens += p
      kvTokens += h + p
      attnPairs += p * h + (p * (p + 1)) / 2
      budget -= p
      prefills.push(s)
    }
    if (tokens === 0) throw new Error('an iteration with no tokens: the KV pool cannot hold one running request')
    // 5. the load, the hook, the card
    const load: StepLoad = { seqs, tokens, kvTokens, attnPairs }
    if (hook) {
      hook({
        load,
        tp: this.tp,
        decoded: decoders.map((s) => s.req.id),
        prefillDone: prefills.filter((s) => s.chunk === s.left).map((s) => s.req.id),
        admitted,
      })
    }
    const card = this.cfg.card ? this.cfg.card(load, this.tp) : stepCard(this.row.spec, this.tp, load)
    if (!Number.isInteger(card.us) || card.us < 0) throw new Error(`a step must last a whole, non-negative number of µs: ${card.us}`)
    this.lastCard = card
    // 6. the clock
    const end = now + card.us
    this._clockUs = end
    // 7. stamps at the new clock: a completed prefill emits its first (or, after a recompute, its next) token
    const finished: SeqV2[] = []
    for (const s of prefills) {
      s.left -= s.chunk
      s.chunk = 0
      if (s.left > 0) continue
      if (s.emitted === 0) s.firstUs = end
      s.emitted += 1
      s.lastUs = end
      if (s.emitted >= s.req.output) finished.push(s)
    }
    for (const s of decoders) {
      s.emitted += 1
      s.lastUs = end
      if (s.emitted >= s.req.output) finished.push(s)
    }
    if (finished.length > 0) {
      finished.sort(byArrival)
      for (const s of finished) this.finish(s)
      this.running = this.running.filter((s) => s.emitted < s.req.output)
    }
    // 8. the envelope and the count
    if (exceeds(this.row.envelope, load, this.tp, decoders.length)) this._outOfEnvelope += 1
    this._iterations += 1
  }

  /** Recompute preemption (`production.vllm.v1-preemption`): blocks freed, outputs kept, back to the front of the queue. */
  private preempt(s: SeqV2): void {
    this.running.splice(this.running.indexOf(s), 1)
    this.mgr.free(s.req.id)
    s.target = s.req.prompt + s.emitted
    s.left = s.target
    s.chunk = 0
    this.waiting.unshift(s)
    this.preemptionCount += 1
  }

  private finish(s: SeqV2): void {
    this.mgr.free(s.req.id)
    const { id, arrivalUs, output } = s.req
    const tpotUs = output > 1 ? (s.lastUs - s.firstUs) / (output - 1) : 0
    const ttftAdmitUs = s.firstUs - s.admitUs
    this.tpots.push(tpotUs)
    this.ttftAdmits.push(ttftAdmitUs)
    this.outputTokens += output
    this.onFinish?.({
      id,
      arrivalUs,
      admitUs: s.admitUs,
      firstUs: s.firstUs,
      lastUs: s.lastUs,
      ttftUs: s.firstUs - arrivalUs,
      ttftAdmitUs,
      tpotUs,
      queueUs: s.admitUs - arrivalUs,
    })
  }

  /** µs throughout: mean TPOT, median TTFT (admission; the protocol's median rule), tok/s/user, output tok/s/GPU. */
  stats(): EngineV2Stats {
    let sum = 0
    for (const t of this.tpots) sum += t
    const meanTpotUs = this.tpots.length ? sum / this.tpots.length : 0
    return {
      completed: this.tpots.length,
      meanTpotUs,
      medianTtftUs: medianOf(this.ttftAdmits),
      tokPerSUser: meanTpotUs > 0 ? 1e6 / meanTpotUs : 0,
      outputTokPerSGpu: this._clockUs > 0 ? (this.outputTokens * 1e6) / (this._clockUs * this.tp) : 0,
      outputTokens: this.outputTokens,
      clockUs: this._clockUs,
      iterations: this._iterations,
      outOfEnvelope: this._outOfEnvelope,
      preemptions: this.preemptionCount,
    }
  }
}
