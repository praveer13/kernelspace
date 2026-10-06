/**
 * lab-worker — main-thread client for src/workers/lab.worker.ts.
 *
 * Untrusted learner wasm never runs on the main thread: grading and Fleet
 * admission post the bytes to a worker and get the same results (or the same
 * LabTrapError / LabAbiError) back. A run that exceeds LAB_TIMEOUT_MS has its
 * worker terminated and recreated, and surfaces as a LabTimeoutError.
 *
 * Template v2 (docs/specs/wave-1.md §12.3): the budget is per check. A check that spins is marked
 * `timeout`, its worker is terminated, and a fresh worker carries on with the next check
 * (src/lib/forge/run.ts, driveLabRun). runLabInWorker and validateLabInWorker keep their v1
 * signatures and return the v1 report shape; runLab returns the full v2 report.
 */

import { LabAbiError, LabTrapError, type LabReport } from './wasm-lab'
import { splitLabId } from './forge/abi'
import { assembleReport, driveLabRun, fromV1Report, toLegacyReport, type DriveResult, type LabPool, type LabPort, type LabProgress } from './forge/run'
import type { LabRunReport } from './forge/types'
import type { LabRunMode, LabWorkerReply } from '../workers/lab-protocol'

export const LAB_TIMEOUT_MS = 2000

interface Handle {
  worker: Worker
  /** resolves once the worker has loaded its module — keeps startup out of the run budget */
  ready: Promise<void>
  port: LabPort
}

let handle: Handle | null = null
let nextId = 0
/* One worker, one run at a time: a timeout terminates the worker, so runs must not overlap. */
let chain: Promise<unknown> = Promise.resolve()

function spawn(): Handle {
  const worker = new Worker(new URL('../workers/lab.worker.ts', import.meta.url), { type: 'module' })
  const ready = new Promise<void>((resolve, reject) => {
    const onMessage = (ev: MessageEvent<LabWorkerReply>) => {
      if (ev.data.type !== 'ready') return
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => reject(new Error('the lab worker failed to start'))
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
  })
  const port: LabPort = {
    /* no transfer list: callers keep their bytes (Fleet slots reuse them) */
    post: (req) => worker.postMessage(req),
    subscribe(onMessage, onCrash) {
      const message = (ev: MessageEvent<LabWorkerReply>) => onMessage(ev.data)
      const error = (ev: ErrorEvent) => onCrash(ev.message || 'the lab worker crashed')
      worker.addEventListener('message', message)
      worker.addEventListener('error', error)
      return () => {
        worker.removeEventListener('message', message)
        worker.removeEventListener('error', error)
      }
    },
  }
  return { worker, ready, port }
}

function discard(h: Handle) {
  h.worker.terminate()
  if (handle === h) handle = null
}

const pool: LabPool = {
  async acquire() {
    const h = (handle ??= spawn())
    try {
      await h.ready
    } catch (e) {
      discard(h)
      throw e
    }
    return h.port
  },
  discard(port) {
    if (handle?.port === port) discard(handle)
  },
}

function run(
  mode: LabRunMode,
  bytes: ArrayBuffer,
  seeds: 'fresh' | 'default' = 'default',
  onProgress?: (e: LabProgress) => void,
): Promise<DriveResult> {
  const result = chain.then(() => driveLabRun(pool, { mode, bytes, seeds }, { budgetMs: LAB_TIMEOUT_MS, nextId: () => nextId++, onProgress }))
  chain = result.catch(() => {})
  return result
}

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now())

export interface RunLabOptions {
  /** 'fresh' (grade time, counts toward `unseen`) or 'default' (the crate's own seeds, as in `cargo test`). Default 'default'. */
  seeds?: 'fresh' | 'default'
  /** Each check as it starts and finishes (v2), for live result rows. */
  onProgress?: (e: LabProgress) => void
  /** The lab and checks the page expects. A v1 module that traps then reports each check as `trap`, instead of throwing. */
  expected?: { lab: string; checks: readonly { id: string; label: string; stage?: number }[] }
}

/**
 * Grade a module, v1 or v2, and return the v2 report (per-check status, seeds, panic text, trace).
 * Throws LabAbiError, LabTimeoutError (v1, or a v2 module stuck before its checks), and
 * LabTrapError for a v1 module that traps when `expected` is not given.
 */
export async function runLab(bytes: ArrayBuffer, opts: RunLabOptions = {}): Promise<LabRunReport> {
  const t0 = now()
  const seeds = opts.seeds ?? 'default'
  let out: DriveResult
  try {
    out = await run('grade', bytes, seeds, opts.onProgress)
  } catch (e) {
    if (e instanceof LabTrapError && opts.expected) {
      return {
        lab: opts.expected.lab,
        reference: false,
        abi: 1,
        version: 0,
        checks: opts.expected.checks.map((c) => ({ id: c.id, label: c.label, status: 'trap', msg: e.message, ...(c.stage === undefined ? {} : { stage: c.stage }) })),
        seeds: 'default',
        ms: now() - t0,
      }
    }
    throw e
  }
  if (out.abi === 1) {
    if (!out.report) throw new LabAbiError('lab worker returned no report — ABI violation.')
    return fromV1Report(out.report, now() - t0)
  }
  if (!out.list) throw new LabAbiError('lab worker returned no check list — ABI violation.')
  return assembleReport(out.list, out.results, seeds, now() - t0)
}

/** Forge grading: runLabWasm in a worker. Throws LabAbiError, LabTrapError or LabTimeoutError. */
export async function runLabInWorker(bytes: ArrayBuffer): Promise<LabReport> {
  const out = await run('grade', bytes)
  if (out.abi === 2) {
    if (!out.list) throw new LabAbiError('lab worker returned no check list — ABI violation.')
    return toLegacyReport(assembleReport(out.list, out.results, 'default', 0))
  }
  if (!out.report) throw new LabAbiError('lab worker returned no report — ABI violation.')
  return out.report
}

/**
 * Fleet admission: instantiate, check for the ks_invoke bridge, run the suite, then exercise ks_invoke
 * with the lab's canned calls — all inside the one LAB_TIMEOUT_MS budget. A red module is probed too
 * (a spin is caught; a trap is left for the caller's own check handling); a green one that traps or
 * misanswers in the probe is rejected with a LabTrapError (phase 'invoke') or LabAbiError.
 * `report` is null (checks not run) when the module has no bridge. Throws like runLabInWorker.
 * Template v2 modules run per check, each with its own budget, and the probe keeps its 2 s.
 * A `--features reference` build is refused with a LabAbiError: it earns no credit, here or anywhere.
 */
export async function validateLabInWorker(bytes: ArrayBuffer): Promise<{ report: LabReport | null; hasInvoke: boolean }> {
  const out = await run('validate', bytes)
  const report = out.abi === 2 ? (out.list ? toLegacyReport(assembleReport(out.list, out.results, 'default', 0)) : null) : out.report
  if (report && splitLabId(report.lab).reference) {
    throw new LabAbiError(`this is a reference build (${report.lab}): reference modules earn no credit, so the Fleet and the leaderboard admit learner builds only.`)
  }
  return { report, hasInvoke: out.hasInvoke }
}

/**
 * Release the worker (scripts; the app keeps it for the page's lifetime).
 * Under bun, terminate() cannot interrupt a wasm infinite loop, so a script that saw a
 * LabTimeoutError must also call process.exit — the spinning worker thread keeps bun alive.
 */
export function disposeLabWorker() {
  if (handle) discard(handle)
}
