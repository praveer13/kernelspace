/**
 * drivers — wasm↔TS adapters for the Fleet's pluggable components.
 * Separated from EnginePanel.tsx because React Fast Refresh requires
 * component files to export only components.
 */

import { LabAbiError, LabTimeoutError, LabTrapError, type LabModule } from '@/lib/wasm-lab'
import { validateLabInWorker } from '@/lib/lab-worker'
import {
  parseDump,
  type ManagerDriver,
  type QueueDriver,
} from '@/lib/fleet-model'
import type { FleetSlotBytes } from '@/workers/fleet-protocol'
import type { SlotState } from './slots'
export { makeWasmScheduler } from '@/lib/wasm-scheduler'

export type Mod = LabModule & { hasInvoke: boolean }

/** The slot bytes a fleet session instantiates inside its worker; null keeps the JS reference driver. */
export function slotBytes(slots: SlotState): FleetSlotBytes {
  return { sched: slots.sched?.bytes ?? null, mgr: slots.mgr?.bytes ?? null, queue: slots.queue?.bytes ?? null }
}

const DEFAULT_BLOCKS = 256
const DEFAULT_BLOCK_SIZE = 16

export function makeWasmManager(mod: Mod, numBlocks = DEFAULT_BLOCKS, blockSize = DEFAULT_BLOCK_SIZE): ManagerDriver {
  mod.invoke(`init ${numBlocks} ${blockSize}`)
  return {
    name: 'yours',
    allocate: (s, t) => mod.invoke(`allocate ${s} ${t}`).trim() === 'true',
    append: (s, n) => mod.invoke(`append ${s} ${n}`).trim() === 'true',
    free: (s) => {
      mod.invoke(`free ${s}`)
    },
    freeBlocks: () => Number(mod.invoke('free_blocks').trim()),
    dump: () => parseDump(mod.invoke('dump')),
  }
}

export function makeWasmQueue(mod: Mod, cap = 32): QueueDriver {
  mod.invoke(`init ${cap}`)
  return {
    name: 'yours',
    push: (v) => mod.invoke(`push ${v}`).trim() === 'ok',
    pop: () => {
      const r = mod.invoke('pop').trim()
      return r === 'empty' ? null : Number(r)
    },
  }
}

/**
 * Validate an uploaded module: loadable, has the bridge, a learner build of the right lab, green checks.
 * Runs in the lab worker with a timeout; the fleet worker only instantiates modules that passed
 * (and the panels never instantiate them on the main thread).
 */
export async function validateModule(bytes: ArrayBuffer, wantLab: string): Promise<{ ok: true } | { ok: false; title: string; detail: string }> {
  try {
    const { report, hasInvoke } = await validateLabInWorker(bytes)
    if (!hasInvoke || !report) {
      return { ok: false, title: 'module predates the fleet bridge', detail: 'rebuild with the latest lab template (adds ks_invoke).' }
    }
    if (report.lab.endsWith('@reference')) {
      return { ok: false, title: 'reference module: no credit', detail: `"${report.lab}" is a reference build. It earns no credit here; upload the module you built from your own code.` }
    }
    if (report.lab !== wantLab) {
      return { ok: false, title: 'wrong lab module', detail: `this slot wants ${wantLab}, got "${report.lab}".` }
    }
    const failed = report.checks.filter((c) => !c.pass)
    if (failed.length > 0) {
      return { ok: false, title: `lab checks not green (${report.checks.length - failed.length}/${report.checks.length})`, detail: 'finish the lab first — the fleet drives the same code the checks grade.' }
    }
    return { ok: true }
  } catch (e) {
    if (e instanceof LabTrapError) {
      return e.phase === 'invoke'
        ? { ok: false, title: 'ks_invoke trapped', detail: 'the self-checks passed, but the fleet bridge panicked on its first calls — check init and command handling.' }
        : { ok: false, title: 'module trapped', detail: 'a todo!() is still open in this crate.' }
    }
    if (e instanceof LabTimeoutError) return { ok: false, title: e.title, detail: e.message }
    if (e instanceof LabAbiError) return { ok: false, title: 'not a lab module', detail: e.message }
    return { ok: false, title: 'unexpected error', detail: String(e) }
  }
}
