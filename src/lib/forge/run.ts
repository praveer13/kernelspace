/**
 * Forge template v2 on the host: run each check in a fresh instance, keep the run going past a
 * trap or a spin, and decide what a run earns (docs/specs/wave-1.md §12.3–12.4).
 *
 * Three layers, so each can be tested without the next:
 * - the engine (`listChecks`, `runCheck`, `runChecks`) drives instances of one compiled module.
 *   It runs inside the lab worker, and in Bun for calibration;
 * - the driver (`driveLabRun`) runs on the main thread. It talks to a worker through a small
 *   port interface, gives every check a 2 s budget, and on expiry discards the worker, marks the
 *   check `timeout` and resumes with the next check in a new one;
 * - credit (`creditFor`) is pure: `@reference` earns nothing anywhere, and `unseen` needs ABI 2,
 *   fresh seeds and every required check passed on unseen runs.
 */

import { LabAbiError, LabTimeoutError, LabTrapError, type LabReport } from '../wasm-lab'
import type { LabCheckDetail, LabRunV2 } from '../ledger/types'
import type { LabWorkerReply, LabWorkerRequest, LabRunMode } from '../../workers/lab-protocol'
import { LIST_INPUT, onlyInput, parseListReply, parseOnlyReply, sameChecks, splitLabId, trapMessage } from './abi'
import type { CheckMeta, CheckResult, LabRunReport, ListReply } from './types'

/* --------------------------------- engine --------------------------------- */

/** What a lab module exports. Only `memory` and `ks_run` are required (v1). */
export interface LabExports {
  memory: WebAssembly.Memory
  ks_run: (inPtr: number, inLen: number) => bigint
  ks_alloc?: (len: number) => number
  ks_free?: (ptr: number, len: number) => void
  ks_abi_version?: () => number
  ks_panic_msg?: () => bigint
  ks_trace_drain?: () => bigint
  ks_invoke?: (inPtr: number, inLen: number) => bigint
}

/** Hands out a fresh instance of one compiled module per call. */
export type Instantiate = () => LabExports

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now())

/** Checks the exports every lab has; throws LabAbiError otherwise. */
export function exportsOf(instance: WebAssembly.Instance): LabExports {
  const ex = instance.exports as Record<string, unknown>
  if (!(ex.memory instanceof WebAssembly.Memory) || typeof ex.ks_run !== 'function') {
    throw new LabAbiError('wasm loaded, but it is not a kernelspace lab (missing memory/ks_run exports).')
  }
  return ex as unknown as LabExports
}

/** Fresh instances of `module` with zero imports (W5). A module that needs imports is not a lab. */
export function instantiator(module: WebAssembly.Module): Instantiate {
  return () => {
    let instance: WebAssembly.Instance
    try {
      instance = new WebAssembly.Instance(module, {})
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new LabAbiError(`not a loadable kernelspace lab module (${detail}). Drop the .wasm built from the lab template.`)
    }
    return exportsOf(instance)
  }
}

/** `ks_abi_version()`, or 1 when the export is absent. */
export function abiOf(ex: LabExports): number {
  if (typeof ex.ks_abi_version !== 'function') return 1
  try {
    return ex.ks_abi_version() >>> 0
  } catch (e) {
    throw new LabAbiError(`ks_abi_version trapped (${e instanceof Error ? e.message : String(e)}): ABI violation.`)
  }
}

/** Decode a `(ptr << 32) | len` reply. Read memory.buffer after the call: it may have grown. */
function unpack(ex: LabExports, packed: bigint): string {
  const ptr = Number(BigInt.asUintN(64, packed) >> 32n)
  const len = Number(BigInt.asUintN(64, packed) & 0xffff_ffffn)
  if (len === 0) return ''
  if (ptr + len > ex.memory.buffer.byteLength) {
    throw new LabAbiError('lab returned an out-of-bounds reply pointer: ABI violation.')
  }
  return decoder.decode(new Uint8Array(ex.memory.buffer, ptr, len))
}

/** Call `ks_run` with `input`. Throws LabTrapError when the module traps, LabAbiError on a bad reply. */
export function callRun(ex: LabExports, input: string): string {
  if (input === '') {
    try {
      return unpack(ex, ex.ks_run(0, 0))
    } catch (e) {
      if (e instanceof LabAbiError) throw e
      throw new LabTrapError(e)
    }
  }
  if (typeof ex.ks_alloc !== 'function' || typeof ex.ks_free !== 'function') {
    throw new LabAbiError('this module has no ks_alloc/ks_free, so it cannot take ABI v2 input.')
  }
  const data = encoder.encode(input)
  let ptr: number
  try {
    ptr = ex.ks_alloc(data.length)
  } catch (e) {
    throw new LabTrapError(e)
  }
  if (ptr + data.length > ex.memory.buffer.byteLength) throw new LabAbiError('ks_alloc returned an out-of-bounds buffer: ABI violation.')
  new Uint8Array(ex.memory.buffer, ptr, data.length).set(data)
  let packed: bigint
  try {
    packed = ex.ks_run(ptr, data.length)
  } catch (e) {
    throw new LabTrapError(e)
  }
  const reply = unpack(ex, packed)
  try {
    ex.ks_free(ptr, data.length)
  } catch {
    /* the reply is already decoded, and the instance is discarded after this call */
  }
  return reply
}

/** `ks_panic_msg()` or `ks_trace_drain()` after a check, on the same instance. Undefined when empty or unreadable. */
function pull(ex: LabExports, fn: 'ks_panic_msg' | 'ks_trace_drain'): string | undefined {
  const f = ex[fn]
  if (typeof f !== 'function') return undefined
  try {
    const text = unpack(ex, f())
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new LabAbiError(`lab returned invalid JSON for ${what}: ABI violation.`)
  }
}

/** `list` in a fresh instance. Runs no student code, so a trap here is an ABI violation, not a red check. */
export function listChecks(make: Instantiate): ListReply {
  let text: string
  try {
    text = callRun(make(), LIST_INPUT)
  } catch (e) {
    if (e instanceof LabTrapError) throw new LabAbiError('the module trapped answering `list`, which runs no student code: ABI violation.')
    throw e
  }
  const list = parseListReply(parseJson(text, '`list`'))
  if (typeof list === 'string') throw new LabAbiError(`${list}: ABI violation.`)
  return list
}

/** Undefined fields dropped, so results survive structured clone and JSON alike. */
function defined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

/**
 * One check in a fresh instance: `v 2\nonly <id>\n` plus `seed <s>` when `seed` is given (a seeded
 * check on a fresh seed). A trap becomes status `trap` with the panic text and the trace.
 */
export function runCheck(make: Instantiate, lab: string, meta: CheckMeta, seed?: number): CheckResult {
  const ex = make()
  const fresh = meta.seeded && seed !== undefined
  const t0 = now()
  let text: string
  try {
    text = callRun(ex, onlyInput(meta.id, fresh ? seed : undefined))
  } catch (e) {
    if (!(e instanceof LabTrapError)) throw e
    const panic = pull(ex, 'ks_panic_msg')
    return defined({
      id: meta.id,
      label: meta.label,
      status: 'trap',
      msg: trapMessage(panic),
      stage: meta.stage,
      seed: fresh ? seed : undefined,
      fresh: meta.seeded ? fresh : undefined,
      ms: now() - t0,
      panic,
      trace: pull(ex, 'ks_trace_drain'),
    })
  }
  const ms = now() - t0
  const verdict = parseOnlyReply(parseJson(text, `\`only ${meta.id}\``), meta.id, lab)
  if (typeof verdict === 'string') throw new LabAbiError(`${verdict}: ABI violation.`)
  if (fresh && verdict.seed !== seed) {
    throw new LabAbiError(`check "${meta.id}" ran on seed ${String(verdict.seed)}, not the ${seed} it was given: ABI violation.`)
  }
  return defined({
    id: meta.id,
    label: meta.label,
    status: verdict.pass ? 'pass' : 'fail',
    msg: verdict.msg,
    stage: meta.stage,
    seed: verdict.seed,
    fresh: meta.seeded ? fresh : undefined,
    ms,
    trace: pull(ex, 'ks_trace_drain'),
  })
}

/** A seed drawn at grade time (V6: unseen, not secret). */
export function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}

export interface RunChecksOptions {
  seeds: 'fresh' | 'default'
  /** First check index to run (a respawned worker resumes after a timed-out check). */
  startAt?: number
  draw?: () => number
  onStart?: (index: number, meta: CheckMeta, seed: number | undefined) => void
  onDone?: (index: number, result: CheckResult) => void
}

/** Every listed check from `startAt`, each in its own instance, in list order. */
export function runChecks(make: Instantiate, list: ListReply, opts: RunChecksOptions): CheckResult[] {
  const draw = opts.draw ?? freshSeed
  const out: CheckResult[] = []
  for (let i = opts.startAt ?? 0; i < list.checks.length; i++) {
    const meta = list.checks[i]
    const seed = opts.seeds === 'fresh' && meta.seeded ? draw() >>> 0 : undefined
    opts.onStart?.(i, meta, seed)
    const result = runCheck(make, list.lab, meta, seed)
    opts.onDone?.(i, result)
    out.push(result)
  }
  return out
}

/** A timed-out check's row. */
export function timeoutResult(meta: CheckMeta, budgetMs: number, seed?: number): CheckResult {
  const fresh = meta.seeded && seed !== undefined
  return defined({
    id: meta.id,
    label: meta.label,
    status: 'timeout',
    msg: new LabTimeoutError(budgetMs, 'checks', true, meta.id).message,
    stage: meta.stage,
    seed: fresh ? seed : undefined,
    fresh: meta.seeded ? fresh : undefined,
    ms: budgetMs,
  })
}

/* --------------------------------- reports --------------------------------- */

export function assembleReport(list: ListReply, results: CheckResult[], seeds: 'fresh' | 'default', ms: number): LabRunReport {
  const { lab, reference } = splitLabId(list.lab)
  return { lab, reference, abi: 2, version: list.version, checks: results, seeds, ms }
}

/** A v1 report in the v2 shape. v1 modules ignore seeds, so their runs are `default`. */
export function fromV1Report(report: LabReport, ms: number): LabRunReport {
  const { lab, reference } = splitLabId(report.lab)
  return {
    lab,
    reference,
    abi: 1,
    version: report.version,
    checks: report.checks.map((c) => ({ id: c.id, label: c.label, status: c.pass ? 'pass' : 'fail', msg: c.msg })),
    seeds: 'default',
    ms,
  }
}

/** Back to the v1 report every existing caller reads. A reference build keeps its suffix, so a lab-id match never credits it. */
export function toLegacyReport(r: LabRunReport): LabReport {
  return defined({
    lab: r.reference ? `${r.lab}@reference` : r.lab,
    version: r.version,
    abi: r.abi,
    reference: r.reference || undefined,
    seeds: r.abi === 2 ? r.seeds : undefined,
    checks: r.checks.map(({ status, ...c }) => defined({ ...c, pass: status === 'pass', status: r.abi === 2 ? status : undefined })),
  })
}

/* --------------------------------- credit ---------------------------------- */

export interface CreditHistory {
  /** `labs[l].unseen`: check ids already passed on earlier unseen runs. */
  unseen?: Readonly<Record<string, true>>
  /** `labs[l].assistedUntil`: the end of the H3 bottom-out window. */
  assistedUntil?: string
  /** The run's time, for the assisted window. Defaults to the clock. */
  at?: string
}

/** What a run earns. `null` is none: a reference build, everywhere (ForgeLab, Fleet, leaderboard). */
export type Credit = 'unseen' | 'lab-green' | 'assisted' | null

/** Ids that passed in this run on a seed drawn at grade time, or with no seed at all (unseeded checks). */
export function unseenPasses(report: LabRunReport): string[] {
  if (report.abi !== 2 || report.seeds !== 'fresh') return []
  return report.checks.filter((c) => c.status === 'pass' && (c.fresh === true || c.seed === undefined)).map((c) => c.id)
}

/**
 * The provenance a run's `lab-check` event carries (§12.3):
 * - `@reference` → none;
 * - inside the H3 bottom-out window → `assisted`;
 * - ABI 2 on fresh seeds, with every required check passed unseen in this run or an earlier unseen run → `unseen`;
 * - otherwise `lab-green`.
 * `required` defaults to every check in the report.
 */
export function creditFor(report: LabRunReport, history: CreditHistory = {}, required?: readonly string[]): Credit {
  if (report.reference) return null
  if (history.assistedUntil) {
    const at = Date.parse(history.at ?? new Date().toISOString())
    if (at < Date.parse(history.assistedUntil)) return 'assisted'
  }
  if (report.abi === 2 && report.seeds === 'fresh') {
    const ids = required ?? report.checks.map((c) => c.id)
    const passed = new Set(unseenPasses(report))
    if (ids.length > 0 && ids.every((id) => passed.has(id) || history.unseen?.[id] === true)) return 'unseen'
  }
  return 'lab-green'
}

/** The highest stage whose checks all passed in this run (0 when stage 1 is not green). */
export function stageReached(report: LabRunReport): number {
  const stages = [...new Set(report.checks.map((c) => c.stage).filter((s): s is number => s !== undefined))].sort((a, b) => a - b)
  let reached = 0
  for (const s of stages) {
    if (!report.checks.filter((c) => c.stage === s).every((c) => c.status === 'pass')) break
    reached = s
  }
  return reached
}

/** The `recordLabRun` payload for a credited run (`creditFor` ≠ null). */
export function toLabRun(
  report: LabRunReport,
  provenance: Exclude<Credit, null>,
  required: readonly string[],
  extra: { wasmSha256?: string } = {},
): LabRunV2 {
  const req = new Set(required)
  const checks: LabCheckDetail[] = report.checks.map((c) => defined({ id: c.id, status: c.status, seed: c.seed, fresh: c.fresh }))
  const stage = report.abi === 2 ? stageReached(report) : undefined
  return defined({
    labId: report.lab,
    passed: report.checks.filter((c) => c.status === 'pass' && req.has(c.id)).map((c) => c.id),
    total: req.size,
    abi: report.abi,
    checks,
    seeds: report.seeds,
    provenance,
    wasmSha256: extra.wasmSha256,
    stage: stage || undefined,
    ms: Math.round(report.ms),
  })
}

/* --------------------------------- driver ---------------------------------- */

/** One worker, as the driver sees it. */
export interface LabPort {
  post(req: LabWorkerRequest): void
  /** Returns the unsubscribe. `onCrash` fires when the worker itself dies. */
  subscribe(onMessage: (m: LabWorkerReply) => void, onCrash: (message: string) => void): () => void
}

/** Where ports come from: `acquire` spawns (or reuses) a ready worker; `discard` terminates it. */
export interface LabPool {
  acquire(): Promise<LabPort>
  discard(port: LabPort): void
}

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export type LabProgress =
  | { type: 'listed'; list: ListReply }
  | { type: 'check-start'; index: number; id: string; seed?: number }
  | { type: 'check-done'; index: number; result: CheckResult }

export interface DriveOptions {
  /** Per check (v2), or per run (v1, and a v2 run's setup and probe). */
  budgetMs: number
  nextId: () => number
  timers?: Timers
  onProgress?: (e: LabProgress) => void
}

export type DriveResult =
  | { abi: 1; report: LabReport | null; hasInvoke: boolean }
  /** `list` is null only in validate mode for a module without ks_invoke (checks not run). */
  | { abi: 2; list: ListReply | null; results: CheckResult[]; hasInvoke: boolean }

type Phase =
  | { kind: 'setup' }
  | { kind: 'check'; index: number; seed?: number }
  | { kind: 'between'; next: number }
  | { kind: 'invoke'; checksPassed: boolean }

type Segment = { kind: 'final'; result: DriveResult } | { kind: 'resume'; next: number }

/**
 * Run a module in workers from `pool`. v1: one request, one budget, as before. v2: the worker lists
 * the checks and runs them in order, posting `check-start` and `check-done`; each check gets
 * `budgetMs`. On expiry the worker is discarded, the check is marked `timeout`, and a new worker
 * resumes at the next check. Rejects with LabTimeoutError (setup or probe), LabTrapError, LabAbiError.
 */
export async function driveLabRun(
  pool: LabPool,
  req: { mode: LabRunMode; bytes: ArrayBuffer; seeds: 'fresh' | 'default' },
  opts: DriveOptions,
): Promise<DriveResult> {
  const timers = opts.timers ?? realTimers
  let list: ListReply | null = null
  const results: CheckResult[] = []

  const segment = (port: LabPort, startAt: number): Promise<Segment> =>
    new Promise((resolve, reject) => {
      const id = opts.nextId()
      let phase: Phase = { kind: 'setup' }
      let timer: unknown
      let unsubscribe = () => {}
      const arm = () => {
        timers.clear(timer)
        timer = timers.set(onTimeout, opts.budgetMs)
      }
      const settle = () => {
        timers.clear(timer)
        unsubscribe()
      }
      const v2Final = (hasInvoke: boolean): Segment => ({ kind: 'final', result: { abi: 2, list, results, hasInvoke } })

      function onMessage(m: LabWorkerReply) {
        if (m.type === 'ready' || m.id !== id) return
        switch (m.type) {
          case 'listed':
            if (list && !sameChecks(list, m.list)) {
              settle()
              pool.discard(port)
              reject(new LabAbiError('the module listed different checks after a restart: ABI violation.'))
              return
            }
            list ??= m.list
            phase = { kind: 'between', next: startAt }
            arm()
            opts.onProgress?.({ type: 'listed', list: m.list })
            return
          case 'check-start':
            phase = { kind: 'check', index: m.index, seed: m.seed }
            arm()
            opts.onProgress?.({ type: 'check-start', index: m.index, id: m.check, seed: m.seed })
            return
          case 'check-done':
            results[m.index] = m.result
            phase = { kind: 'between', next: m.index + 1 }
            arm()
            opts.onProgress?.({ type: 'check-done', index: m.index, result: m.result })
            return
          case 'phase':
            phase = { kind: 'invoke', checksPassed: m.checksPassed }
            /* v1 keeps today's single budget for checks and probe together; v2's probe gets its own */
            if (list) arm()
            return
          case 'done':
            settle()
            resolve(m.abi === 2 ? v2Final(m.hasInvoke) : { kind: 'final', result: { abi: 1, report: m.report, hasInvoke: m.hasInvoke } })
            return
          case 'failed':
            settle()
            if (m.kind === 'trap') reject(new LabTrapError(undefined, m.phase))
            else if (m.kind === 'abi') reject(new LabAbiError(m.message))
            else reject(new Error(m.message))
            return
        }
      }

      function onTimeout() {
        settle()
        pool.discard(port)
        const index = phase.kind === 'check' ? phase.index : phase.kind === 'between' ? phase.next : -1
        if (list && index >= 0 && index < list.checks.length) {
          const result = timeoutResult(list.checks[index], opts.budgetMs, phase.kind === 'check' ? phase.seed : undefined)
          results[index] = result
          opts.onProgress?.({ type: 'check-done', index, result })
          /* validate still owes the probe, which the next worker runs after the remaining checks */
          if (index + 1 < list.checks.length || req.mode === 'validate') resolve({ kind: 'resume', next: index + 1 })
          else resolve(v2Final(false))
        } else if (list && phase.kind === 'between' && req.mode === 'grade') {
          resolve(v2Final(false)) /* every check reported; the worker stalled on the way out */
        } else if (phase.kind === 'invoke') {
          reject(new LabTimeoutError(opts.budgetMs, 'invoke', phase.checksPassed))
        } else {
          reject(new LabTimeoutError(opts.budgetMs, 'checks'))
        }
      }

      function onCrash(message: string) {
        settle()
        pool.discard(port)
        reject(new Error(message || 'the lab worker crashed'))
      }

      unsubscribe = port.subscribe(onMessage, onCrash)
      arm()
      const priorGreen = results.slice(0, startAt).every((r) => r?.status === 'pass')
      port.post({ id, mode: req.mode, bytes: req.bytes, seeds: req.seeds, startAt, priorGreen })
    })

  let startAt = 0
  for (;;) {
    const port = await pool.acquire()
    const step = await segment(port, startAt)
    if (step.kind === 'final') return step.result
    startAt = step.next
  }
}
