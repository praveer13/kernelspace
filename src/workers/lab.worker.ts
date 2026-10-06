/**
 * lab.worker — runs untrusted learner wasm off the main thread.
 *
 * The module is instantiated and its self-check suite (and, for Fleet admission, its
 * ks_invoke bridge, whatever the checks say) executed here, so an
 * infinite loop or runaway allocation can only stall this worker — the page
 * stays responsive and lab-worker.ts terminates the worker after 2 s.
 *
 * Template v2 (docs/specs/wave-1.md §12.3): the module is compiled once, `list` runs in a fresh
 * instance, then every check runs in its own fresh instance, announced with `check-start` so the
 * main thread can give each one its own 2 s. A v1 module takes today's path unchanged.
 */

import { instantiateLab, LabAbiError, LabTrapError, probeInvoke, runLabWasm } from '../lib/wasm-lab'
import { compatFor, NEWER_TEMPLATE_NOTE, splitLabId } from '../lib/forge/abi'
import { abiOf, instantiator, listChecks, runChecks } from '../lib/forge/run'
import type { LabWorkerReply, LabWorkerRequest } from './lab-protocol'

/* The app tsconfig has the DOM lib, not WebWorker — type just what we use. */
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<LabWorkerRequest>) => void) | null
  postMessage(msg: LabWorkerReply): void
}

const failure = (id: number, e: unknown, phase?: 'invoke'): LabWorkerReply => ({
  type: 'failed',
  id,
  kind: e instanceof LabTrapError ? 'trap' : e instanceof LabAbiError ? 'abi' : 'error',
  message: e instanceof Error ? e.message : String(e),
  ...(phase ? { phase } : {}),
})

/** Today's path for a v1 module, byte for byte. */
async function runV1({ id, mode, bytes }: LabWorkerRequest) {
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
        scope.postMessage(failure(id, e, 'invoke'))
        return
      }
    }
  }
  scope.postMessage({ type: 'done', id, report, hasInvoke: mod.hasInvoke })
}

scope.onmessage = async (ev) => {
  const req = ev.data
  const { id, mode, bytes } = req
  try {
    let module: WebAssembly.Module
    try {
      module = await WebAssembly.compile(bytes)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      throw new LabAbiError(`not a loadable kernelspace lab module (${detail}). Drop the .wasm built from the lab template.`)
    }
    const make = instantiator(module)
    const first = make()
    const abi = abiOf(first)
    if (abi === 1) {
      await runV1(req)
      return
    }
    if (!compatFor(abi)) throw new LabAbiError(`this module speaks forge ABI ${abi}, and this page speaks 2: ${NEWER_TEMPLATE_NOTE}.`)

    const hasInvoke = typeof first.ks_invoke === 'function' && typeof first.ks_alloc === 'function' && typeof first.ks_free === 'function'
    /* `list` runs no student code, so it comes first: a reference build is refused before anything runs */
    const list = listChecks(() => first)
    if (mode === 'validate' && splitLabId(list.lab).reference) {
      throw new LabAbiError(`this is a reference build (${list.lab}): reference modules earn no credit, so the Fleet and the leaderboard admit learner builds only.`)
    }
    if (mode === 'validate' && !hasInvoke) {
      /* as for v1: no bridge, no checks — the caller reports "rebuild with the latest template" */
      scope.postMessage({ type: 'done', id, abi: 2, report: null, hasInvoke: false })
      return
    }
    scope.postMessage({ type: 'listed', id, list })

    let green = req.priorGreen ?? true
    runChecks(make, list, {
      seeds: req.seeds ?? 'default',
      startAt: req.startAt ?? 0,
      onStart: (index, meta, seed) => scope.postMessage({ type: 'check-start', id, index, check: meta.id, ...(seed === undefined ? {} : { seed }) }),
      onDone: (index, result) => {
        green &&= result.status === 'pass'
        scope.postMessage({ type: 'check-done', id, index, result })
      },
    })

    if (mode === 'validate') {
      scope.postMessage({ type: 'phase', id, phase: 'invoke', checksPassed: green })
      try {
        probeInvoke(await instantiateLab(module), splitLabId(list.lab).lab)
      } catch (e) {
        if (green) {
          scope.postMessage(failure(id, e, 'invoke'))
          return
        }
      }
    }
    scope.postMessage({ type: 'done', id, abi: 2, report: null, hasInvoke })
  } catch (e) {
    scope.postMessage(failure(id, e))
  }
}

scope.postMessage({ type: 'ready' })
