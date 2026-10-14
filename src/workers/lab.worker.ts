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
 *
 * Prove-it v2 ('calls', wave-3.md §7.1): a v2, non-reference module with a ks_invoke bridge is instantiated once
 * and each entry of `calls` goes through ks_invoke in order, so the bridge keeps its state between entries.
 */

import { instantiateLab, LabAbiError, LabTrapError, probeInvoke, runLabWasm } from '../lib/wasm-lab'
import { compatFor, NEWER_TEMPLATE_NOTE, splitLabId } from '../lib/forge/abi'
import { abiOf, instantiator, listChecks, runChecks, type Instantiate, type LabExports } from '../lib/forge/run'
import { capReply, invokeCall, type LabWorkerReply, type LabWorkerRequest } from './lab-protocol'

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

/**
 * 'calls': the whole list in one fresh instance, one 2 s budget on the main thread. The reference check comes first
 * (`list` runs no student code) so a reference build answers nothing. A trap ends the list as a failed call. Replies are
 * read by `invokeCall`, so an empty reply is the empty string, not an ABI error.
 */
function runCalls({ id, calls }: LabWorkerRequest, make: Instantiate, first: LabExports, abi: number) {
  if (!Array.isArray(calls) || calls.length === 0 || !calls.every((c) => typeof c === 'string')) {
    throw new LabAbiError('a calls request needs a non-empty list of commands.')
  }
  if (abi === 1) throw new LabAbiError('this module was built from the v1 template, so it cannot say whether it is a reference build: rebuild with the latest template.')
  if (!compatFor(abi)) throw new LabAbiError(`this module speaks forge ABI ${abi}, and this page speaks 2: ${NEWER_TEMPLATE_NOTE}.`)
  const list = listChecks(() => first)
  if (splitLabId(list.lab).reference) throw new LabAbiError(`this is a reference build (${list.lab}): reference modules earn no credit, so Prove-it runs learner builds only.`)
  if (typeof first.ks_invoke !== 'function' || typeof first.ks_alloc !== 'function' || typeof first.ks_free !== 'function') {
    throw new LabAbiError('this module has no ks_invoke bridge: rebuild with the latest template.')
  }
  const ex = make()
  const replies = calls.map((cmd) => capReply(invokeCall(ex, cmd)))
  scope.postMessage({ type: 'replies', id, replies })
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
    if (mode === 'calls') {
      runCalls(req, make, first, abi)
      return
    }
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
