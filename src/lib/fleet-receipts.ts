/**
 * fleet-receipts — Fleet Week's receipts engine (docs/specs/wave-3.md §10.1-10.3, D14, W16).
 *
 * A number in an act's analysis counts when it cites a run and the page can reproduce it. A run record keeps what
 * a re-run needs: the act, the job with each module's bytes replaced by its slot and sha256, the entropy the
 * worker drew the graded seeds from, and the values the run reported. A receipt token, `[[r:7f3a9c21 goodput=41.2]]`,
 * names a record by its id and one of its values. Checking re-runs each cited record once, on the same entropy with
 * the same module bytes (from the components store, by sha256), and a cited value is verified when it equals the
 * re-run value rounded to the decimals written. The engine is deterministic, so no tolerance is needed.
 *
 * The rounding rule (the Opus check of 3a-12): a value is read as its shortest decimal form (what `String` prints,
 * which is what the acts display), and rounded half away from zero to the cited decimals, at most 2. A citation
 * with 3 or more decimals is never verified: it claims more than any act shows.
 *
 * This file is inside verify-determinism's `src/lib/fleet-*.ts` scope: no clock, no randomness. A record's `at` is
 * passed in by its caller, and re-running goes through an injected runner (the page passes `runSim`).
 */

import { KIND_SLOT, type LabKind } from '@/lib/engine/slots'
import type { Act2Choice, ModuleBytes } from '@/lib/fleet-week'
import type { RouterKind } from '@/lib/fleet-model'
import { sha256Hex, stableStringify } from '@/lib/ledger/stable'
import type { EngineSlot, IsoInstant, Json, JsonObject, RunRecord } from '@/lib/ledger/types'
import type { SimJob, SimResults } from '@/workers/sim-protocol'

/** A Fleet Week act that receipts cite. */
export type RunAct = RunRecord['act']

/** The sim job kind each act runs. */
export const ACT_JOB: Readonly<Record<RunAct, SimJob['kind']>> = { engine: 'act1', fleet: 'act2', business: 'act3' }

/** `fw:runs` holds at most this many records, newest last (§3.5). */
export const MAX_RUN_RECORDS = 50
/** A record holds at most this many values (the `fw:runs` codec). */
export const MAX_RUN_VALUES = 40
/** A cited value is compared at most to this many decimals (D14). */
export const MAX_CITED_DECIMALS = 2

const HEX64 = /^[0-9a-f]{64}$/
const ROUTERS: readonly RouterKind[] = ['rr', 'jsq', 'prefix']

/* ------------------------------ values ------------------------------ */

/** The receipt values of a sim job's result: Acts I and II carry them on the ActResult, Act III on its evaluation. */
export function valuesOf(result: SimResults[SimJob['kind']]): Record<string, number> {
  return result.values ?? {}
}

/* ------------------------------ run records ------------------------------ */

/** A module as a record keeps it: the slot it filled and the sha256 of its bytes. */
export interface ModuleRef {
  slot: EngineSlot
  sha256: string
}

/** The job with each module's bytes replaced by `{slot, sha256}`: what a record stores and a re-run rebuilds. */
export async function recordJob(job: SimJob): Promise<JsonObject> {
  if (job.kind === 'act3') return { kind: 'act3' }
  const modules: JsonObject = {}
  for (const kind of Object.keys(KIND_SLOT) as LabKind[]) {
    const bytes = job.modules[kind]
    modules[kind] = bytes === null ? null : { slot: KIND_SLOT[kind], sha256: await sha256Hex(bytes) }
  }
  return job.kind === 'act1' ? { kind: 'act1', modules } : { kind: 'act2', modules, choice: { workers: job.choice.workers, router: job.choice.router } }
}

/** A record's id: the first 8 hex digits of sha256(stableStringify(the record without `id` and `at`)). */
export async function runRecordId(record: Pick<RunRecord, 'act' | 'job' | 'entropy' | 'values'>): Promise<string> {
  const { act, job, entropy, values } = record
  return (await sha256Hex(stableStringify({ act, job, entropy, values }))).slice(0, 8)
}

/**
 * The run record of one act run (§10.2). `at` is the ISO instant the caller (FleetWeek.tsx) passes: this file reads
 * no clock. Throws a RangeError on what the `fw:runs` codec would refuse (a job of the wrong act, an entropy that is
 * not a uint32, a non-finite value or more than 40 values), so a record that is built always stores.
 */
export async function runRecord(act: RunAct, job: SimJob, entropy: number, values: Record<string, number>, at: IsoInstant): Promise<RunRecord> {
  if (ACT_JOB[act] !== job.kind) throw new RangeError(`act ${act} runs ${ACT_JOB[act]} jobs, not ${job.kind}`)
  if (!(Number.isInteger(entropy) && entropy >= 0 && entropy <= 0xffffffff)) throw new RangeError(`entropy must be a uint32, not ${entropy}`)
  const entries = Object.entries(values)
  if (entries.length > MAX_RUN_VALUES) throw new RangeError(`a run record holds at most ${MAX_RUN_VALUES} values, not ${entries.length}`)
  if (!entries.every(([, v]) => Number.isFinite(v))) throw new RangeError('a run record holds finite values only')
  const body = { act, job: await recordJob(job), entropy, values: { ...values } }
  return { id: await runRecordId(body), ...body, at }
}

/** `fw:runs` after a new record: newest last, a record with the same id replaced, at most 50 (the oldest drop). */
export function withRunRecord(records: readonly RunRecord[], record: RunRecord): RunRecord[] {
  return [...records.filter((r) => r.id !== record.id), record].slice(-MAX_RUN_RECORDS)
}

const isObj = (v: Json | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The module refs a stored job names, by kind, or null when the job is not a shape `recordJob` writes. */
function moduleRefs(job: JsonObject): Record<LabKind, ModuleRef | null> | null {
  const modules = job.modules
  if (!isObj(modules)) return null
  const out = {} as Record<LabKind, ModuleRef | null>
  for (const kind of Object.keys(KIND_SLOT) as LabKind[]) {
    const m = modules[kind]
    if (m === null) out[kind] = null
    else if (isObj(m) && m.slot === KIND_SLOT[kind] && typeof m.sha256 === 'string' && HEX64.test(m.sha256)) out[kind] = { slot: KIND_SLOT[kind], sha256: m.sha256 }
    else return null
  }
  return out
}

/** The act II topology a stored job names, or null. */
function choiceOf(job: JsonObject): Act2Choice | null {
  const c = job.choice
  if (!isObj(c) || (c.workers !== 2 && c.workers !== 4) || !ROUTERS.includes(c.router as RouterKind)) return null
  return { workers: c.workers, router: c.router as RouterKind }
}

/** What rebuilding a record's job found: the job, or the modules this device does not hold, or a record it cannot read. */
export type RebuiltJob = { job: SimJob } | { missing: EngineSlot[] } | { bad: true }

/**
 * Rebuild a record's job with the module bytes it names. `bytes` reads the components store by sha256
 * (`componentBytes`); bytes whose hash is not the one recorded count as missing, so only the same module re-runs.
 */
export async function rebuildJob(record: RunRecord, bytes: (sha256: string) => Promise<ArrayBuffer | null>): Promise<RebuiltJob> {
  const { job } = record
  if (!isObj(job) || job.kind !== ACT_JOB[record.act]) return { bad: true }
  if (job.kind === 'act3') return { job: { kind: 'act3' } }
  const refs = moduleRefs(job)
  const choice = job.kind === 'act2' ? choiceOf(job) : null
  if (!refs || (job.kind === 'act2' && !choice)) return { bad: true }
  const modules: ModuleBytes = { sched: null, mgr: null, queue: null }
  const missing: EngineSlot[] = []
  for (const kind of Object.keys(KIND_SLOT) as LabKind[]) {
    const ref = refs[kind]
    if (!ref) continue
    const found = await bytes(ref.sha256)
    if (found && (await sha256Hex(found)) === ref.sha256) modules[kind] = found
    else missing.push(ref.slot)
  }
  if (missing.length) return { missing }
  return { job: job.kind === 'act1' ? { kind: 'act1', modules } : { kind: 'act2', modules, choice: choice as Act2Choice } }
}

/* ------------------------------ receipt tokens ------------------------------ */

/** One receipt token in an analysis. */
export interface Receipt {
  /** The run record's id, 8 lowercase hex digits. */
  id: string
  /** The value key, e.g. `goodput` or `costPerMtok.h100`. */
  key: string
  /** The cited number as written, e.g. `41.20`. */
  text: string
  value: number
  /** Decimals written after the point (`41.20` has 2). */
  decimals: number
  /** Where the token starts in the analysis, and its length. */
  index: number
  length: number
}

/** `[[r:<8 hex> <key>=<number>]]`, with spaces tolerated inside the brackets and around `=`. */
const TOKEN = /\[\[\s*r:([0-9a-fA-F]{8})\s+([A-Za-z][\w.]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*\]\]/g

/** Every receipt token in `text`, in order. Anything else in double brackets is not a token. */
export function parseReceipts(text: string): Receipt[] {
  return Array.from(text.matchAll(TOKEN), (m) => {
    const written = m[3]
    const point = written.indexOf('.')
    return {
      id: m[1].toLowerCase(),
      key: m[2],
      text: written,
      value: Number(written),
      decimals: point < 0 ? 0 : written.length - point - 1,
      index: m.index,
      length: m[0].length,
    }
  })
}

/** The token a "cite" button inserts: the value rounded by the receipts rule, at most 2 decimals, so it verifies. */
export function citeToken(id: string, key: string, value: number, decimals?: number): string {
  const d = Math.min(MAX_CITED_DECIMALS, decimals ?? decimalsOf(value))
  return `[[r:${id} ${key}=${roundCited(value, d)}]]`
}

/** The decimals in a value's shortest decimal form. */
function decimalsOf(value: number): number {
  const s = String(Math.abs(value))
  if (s.includes('e')) return MAX_CITED_DECIMALS
  const point = s.indexOf('.')
  return point < 0 ? 0 : s.length - point - 1
}

/**
 * `value` rounded to `decimals` places as a decimal string: its shortest decimal form, rounded half away from zero
 * (so 1.005 is 1.01 and -0.125 is -0.13, as read off the screen). Values too small or too large for a plain
 * decimal form (below 1e-6 or from 1e21) fall back to `toFixed`.
 */
export function roundCited(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return String(value)
  const sign = value < 0 ? '-' : ''
  const plain = String(Math.abs(value))
  if (plain.includes('e')) return value.toFixed(decimals)
  const [int, frac = ''] = plain.split('.')
  if (frac.length <= decimals) return sign + int + (decimals > 0 ? `.${frac.padEnd(decimals, '0')}` : '')
  let digits = int + frac.slice(0, decimals)
  if (frac.charCodeAt(decimals) >= 53 /* '5' */) {
    // add one at the last kept digit, carrying left
    const out = digits.split('')
    let i = out.length - 1
    for (; i >= 0; i--) {
      if (out[i] === '9') out[i] = '0'
      else {
        out[i] = String(Number(out[i]) + 1)
        break
      }
    }
    digits = (i < 0 ? '1' : '') + out.join('')
  }
  const whole = digits.slice(0, digits.length - decimals)
  return sign + whole + (decimals > 0 ? `.${digits.slice(digits.length - decimals)}` : '')
}

/** Whether a cited number is the value rounded to the decimals written (D14). */
export function citedMatches(receipt: Pick<Receipt, 'value' | 'decimals'>, actual: number): boolean {
  if (receipt.decimals > MAX_CITED_DECIMALS || !Number.isFinite(actual)) return false
  return Number(roundCited(actual, receipt.decimals)) === receipt.value
}

/* ------------------------------ verification ------------------------------ */

/**
 * What checking one receipt found. Only `verified` counts.
 * - `mismatch`: the re-run gave another value at the decimals written;
 * - `too-precise`: more than 2 decimals were cited;
 * - `no-value`: the run has no value under that key;
 * - `no-record`: no run record on this device has that id;
 * - `tampered`: the record's contents no longer hash to its id;
 * - `bad-record`: the record's job is not one a run writes;
 * - `module-missing`: a module the run used is not on this device, so it cannot be re-run here;
 * - `run-failed`: the re-run threw (a trap, a timeout).
 */
export type ReceiptStatus = 'verified' | 'mismatch' | 'too-precise' | 'no-value' | 'no-record' | 'tampered' | 'bad-record' | 'module-missing' | 'run-failed'

export interface ReceiptCheck {
  receipt: Receipt
  status: ReceiptStatus
  /** The re-run's value under the cited key, when the run re-ran and has one. */
  actual?: number
  /** For `module-missing`: the slots whose modules are not on this device. */
  missing?: EngineSlot[]
}

/** How a check re-runs a record: the page passes `runSim` and `componentBytes`; tests run the acts in-process. */
export interface ReceiptRunner {
  /** Run a job on this entropy (the worker draws the graded seeds from it). */
  run(job: SimJob, entropy: number): Promise<SimResults[SimJob['kind']]>
  /** A module's bytes by sha256 from the components store, or null when this device does not hold them. */
  bytes(sha256: string): Promise<ArrayBuffer | null>
}

type Rerun = { values: Record<string, number> } | { status: Exclude<ReceiptStatus, 'verified' | 'mismatch' | 'too-precise' | 'no-value'>; missing?: EngineSlot[] }

/** Re-run one record once: same job, same entropy, same module bytes. */
async function rerun(id: string, records: readonly RunRecord[], runner: ReceiptRunner): Promise<Rerun> {
  // the newest record with that id (withRunRecord keeps one per id; an imported list may not)
  let record: RunRecord | undefined
  for (const r of records) if (r.id === id) record = r
  if (!record) return { status: 'no-record' }
  if ((await runRecordId(record)) !== id) return { status: 'tampered' }
  const rebuilt = await rebuildJob(record, (sha) => runner.bytes(sha))
  if ('bad' in rebuilt) return { status: 'bad-record' }
  if ('missing' in rebuilt) return { status: 'module-missing', missing: rebuilt.missing }
  try {
    return { values: valuesOf(await runner.run(rebuilt.job, record.entropy)) }
  } catch {
    return { status: 'run-failed' }
  }
}

/**
 * Check every receipt against `records` (`fw:runs`). Each distinct cited record is re-run once, in the order first
 * cited (the sim worker runs one job at a time), and a record no receipt can verify (every citation of it is too
 * precise) is not run at all. The checks come back in the receipts' order.
 */
export async function verifyReceipts(receipts: readonly Receipt[], records: readonly RunRecord[], runner: ReceiptRunner): Promise<ReceiptCheck[]> {
  const runs = new Map<string, Rerun>()
  for (const r of receipts) {
    if (r.decimals > MAX_CITED_DECIMALS || runs.has(r.id)) continue
    runs.set(r.id, await rerun(r.id, records, runner))
  }
  return receipts.map((receipt): ReceiptCheck => {
    if (receipt.decimals > MAX_CITED_DECIMALS) return { receipt, status: 'too-precise' }
    const run = runs.get(receipt.id) as Rerun
    if ('status' in run) return { receipt, status: run.status, ...(run.missing ? { missing: run.missing } : {}) }
    if (!Object.hasOwn(run.values, receipt.key)) return { receipt, status: 'no-value' }
    const actual = run.values[receipt.key]
    return { receipt, status: citedMatches(receipt, actual) ? 'verified' : 'mismatch', actual }
  })
}

/* ------------------------------ uncited figures ------------------------------ */

/** A figure with a unit outside every receipt token: "cite it or cut it". */
export interface Figure {
  text: string
  index: number
}

const NUM = String.raw`[-−]?\d[\d,]*(?:\.\d+)?`
/** A number then a unit (%, ms, s, iters, tok/s, req/s or $, with their spelled-out forms), or $ then a number. */
const FIGURE = new RegExp(
  String.raw`(?<![\w.$])(?:\$\s?${NUM}|${NUM}\s?(?:%|\$|(?:tok(?:ens)?|req(?:uests)?)\/s(?![\w/])|(?:ms|milliseconds?|s|secs?|seconds?|iters?|iterations?)(?![\w/])))`,
  'g',
)

/** Every %, ms, s, iters, tok/s, req/s or $ figure in `text` that sits outside a receipt token, in order (§10.3). */
export function uncitedFigures(text: string): Figure[] {
  // blank each token (same length, so indices hold) before looking for figures
  let blanked = text
  for (const r of parseReceipts(text)) blanked = blanked.slice(0, r.index) + ' '.repeat(r.length) + blanked.slice(r.index + r.length)
  return Array.from(blanked.matchAll(FIGURE), (m) => ({ text: m[0], index: m.index }))
}

/** The counts an act records in `FleetActData.receipts`: receipts cited, receipts verified, figures left uncited. */
export function receiptCounts(checks: readonly ReceiptCheck[], uncited: readonly Figure[]): { cited: number; verified: number; uncited: number } {
  return { cited: checks.length, verified: checks.filter((c) => c.status === 'verified').length, uncited: uncited.length }
}
