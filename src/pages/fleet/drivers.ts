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
  type SchedulerDriver,
} from '@/lib/fleet-model'

export type Mod = LabModule & { hasInvoke: boolean }

export function makeWasmScheduler(mod: Mod): SchedulerDriver {
  mod.invoke('init')
  return {
    name: 'yours',
    schedule(v) {
      const w = v.waiting.map((r) => `W ${r.id} ${r.arrival} ${r.prompt}`).join(' ; ')
      const r = v.running.map((x) => `R ${x.id} ${x.arrival} ${x.prompt} ${x.decoded} ${x.prefillLeft}`).join(' ; ')
      const reply = mod.invoke(`schedule ${v.iter} ${v.maxRunning} ${v.memCap} ${v.memUsed}\n${w}\n${r}`)
      const num = (s: string | undefined) =>
        s ? s.split(',').map(Number).filter((n) => Number.isFinite(n)) : []
      return { admit: num(/admit (.*)/.exec(reply)?.[1]), preempt: num(/preempt (.*)/.exec(reply)?.[1]) }
    },
  }
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
