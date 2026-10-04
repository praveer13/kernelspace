/**
 * lab.worker — runs untrusted learner wasm off the main thread.
 *
 * The module is instantiated and its self-check suite (and, for Fleet admission, its
 * ks_invoke bridge, whatever the checks say) executed here, so an
 * infinite loop or runaway allocation can only stall this worker — the page
 * stays responsive and lab-worker.ts terminates the worker after 2 s.
 */

import { instantiateLab, LabAbiError, LabTrapError, probeInvoke, runLabWasm } from '../lib/wasm-lab'
import type { LabWorkerReply, LabWorkerRequest } from './lab-protocol'

/* The app tsconfig has the DOM lib, not WebWorker — type just what we use. */
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<LabWorkerRequest>) => void) | null
  postMessage(msg: LabWorkerReply): void
}

scope.onmessage = async (ev) => {
  const { id, mode, bytes } = ev.data
  try {
    if (mode === 'grade') {
      scope.postMessage({ type: 'done', id, report: await runLabWasm(bytes), hasInvoke: false })
      return
    }
    const mod = await instantiateLab(bytes)
    const report = mod.hasInvoke ? mod.runChecks() : null
    if (report) {
      /* ks_run only exercises the suite; /fleet drives ks_invoke, so a spin there must be caught here.
         Red modules are probed too (pool mode and the leaderboard admit them): there only the 2 s timeout
         matters, and a trap or ABI error stays a failing check for the caller to report. */
      const green = report.checks.every((c) => c.pass)
      scope.postMessage({ type: 'phase', id, phase: 'invoke', checksPassed: green })
      try {
        probeInvoke(mod, report.lab)
      } catch (e) {
        if (green) {
          const kind = e instanceof LabTrapError ? 'trap' : e instanceof LabAbiError ? 'abi' : 'error'
          scope.postMessage({ type: 'failed', id, kind, message: e instanceof Error ? e.message : String(e), phase: 'invoke' })
          return
        }
      }
    }
    scope.postMessage({ type: 'done', id, report, hasInvoke: mod.hasInvoke })
  } catch (e) {
    const kind = e instanceof LabTrapError ? 'trap' : e instanceof LabAbiError ? 'abi' : 'error'
    scope.postMessage({ type: 'failed', id, kind, message: e instanceof Error ? e.message : String(e) })
  }
}

scope.postMessage({ type: 'ready' })
