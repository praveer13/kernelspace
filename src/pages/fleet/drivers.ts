/**
 * drivers — wasm↔TS adapters for the Fleet's pluggable components.
 * Separated from EnginePanel.tsx because React Fast Refresh requires
 * component files to export only components.
 */

import { instantiateLab, LabAbiError, LabTrapError, type LabModule } from '@/lib/wasm-lab'
import {
  parseDump,
  type ManagerDriver,
  type QueueDriver,
} from '@/lib/fleet-model'
export { makeWasmScheduler } from '@/lib/wasm-scheduler'

export type Mod = LabModule & { hasInvoke: boolean }

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

/** Validate an uploaded module: loadable, has the bridge, right lab, green checks. */
export async function validateModule(bytes: ArrayBuffer, wantLab: string): Promise<{ ok: true } | { ok: false; title: string; detail: string }> {
  try {
    const mod = await instantiateLab(bytes)
    if (!mod.hasInvoke) {
      return { ok: false, title: 'module predates the fleet bridge', detail: 'rebuild with the latest lab template (adds ks_invoke).' }
    }
    const report = mod.runChecks()
    if (report.lab !== wantLab) {
      return { ok: false, title: 'wrong lab module', detail: `this slot wants ${wantLab}, got "${report.lab}".` }
    }
    const failed = report.checks.filter((c) => !c.pass)
    if (failed.length > 0) {
      return { ok: false, title: `lab checks not green (${report.checks.length - failed.length}/${report.checks.length})`, detail: 'finish the lab first — the fleet drives the same code the checks grade.' }
    }
    return { ok: true }
  } catch (e) {
    if (e instanceof LabTrapError) return { ok: false, title: 'module trapped', detail: 'a todo!() is still open in this crate.' }
    if (e instanceof LabAbiError) return { ok: false, title: 'not a lab module', detail: e.message }
    return { ok: false, title: 'unexpected error', detail: String(e) }
  }
}
