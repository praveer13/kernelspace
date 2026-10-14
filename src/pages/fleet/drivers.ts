/**
 * drivers — wasm↔TS adapters for the Fleet's pluggable components.
 * Separated from EnginePanel.tsx because React Fast Refresh requires
 * component files to export only components.
 */

import { LabAbiError, LabTimeoutError, LabTrapError, type LabModule } from '@/lib/wasm-lab'
import { validateLabInWorker } from '@/lib/lab-worker'
import {
  choosePrefixWorker,
  parseDump,
  type ManagerDriver,
  type QueueDriver,
  type RouterDriver,
} from '@/lib/fleet-model'
import type { FleetSlotBytes } from '@/workers/fleet-protocol'
import type { SlotState } from './slots'
export { makeWasmScheduler } from '@/lib/wasm-scheduler'

export type Mod = LabModule & { hasInvoke: boolean }

/**
 * The slot bytes a fleet session instantiates inside its worker; null keeps the JS reference driver.
 * `router` is the installed radix-cache module (the prefix-router slot has no upload button of its own).
 */
export function slotBytes(slots: SlotState, router: ArrayBuffer | null = null): FleetSlotBytes {
  return { sched: slots.sched?.bytes ?? null, mgr: slots.mgr?.bytes ?? null, queue: slots.queue?.bytes ?? null, router }
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

/* ----------------------- your radix cache and tokenizer ----------------------- */

/**
 * A module built from a pre-3 zip answers a lab version 3 verb with "err unknown command". The install gate says
 * the same words (`REFUSALS['stale-version']`, lib/engine/store.ts; a test holds the two together), so a module
 * that reached a slot another way, an import or an older install, is told how to fix it too.
 */
export const REBUILD_MESSAGE = 'this module predates the router verbs: download the zip again and rebuild'

/** One reply from a lab version 3 verb, or the reason it cannot be used: a stale module, or an `err` line. */
function verbReply(reply: string, what: string): string {
  const text = reply.trim()
  if (text.startsWith('err unknown command')) throw new LabAbiError(REBUILD_MESSAGE)
  if (text.startsWith('err')) throw new Error(`${what}: ${text}`)
  return text
}

/** A count the module sent as text; anything but digits is a broken module and fails closed. */
function countReply(reply: string, what: string): number {
  const text = verbReply(reply, what)
  if (!/^\d+$/.test(text)) throw new Error(`${what}: the module answered "${text.slice(0, 40)}", not a count`)
  return Number(text)
}

/**
 * The prefix router over your radix-cache module (docs/specs/wave-2.md §10.3), one module instance per cluster
 * worker (a lab module's state is a singleton per instance). It routes through `choosePrefixWorker`, the same
 * choice the reference makes: the longest `match` among the workers inside the load guard, ties to the lighter
 * worker and then the lower index. The routed prompt is then `insert`ed into that worker's instance, so the
 * next request of its family finds it.
 */
export function makeWasmRouter(mods: readonly Mod[]): RouterDriver {
  const entries = mods.map(() => 0)
  const reset = (index: number) => {
    const mod = mods[index]
    if (!mod.hasInvoke) throw new Error('radix-cache module has no ks_invoke bridge')
    const reply = verbReply(mod.invoke('reset'), 'router reset')
    if (reply !== 'ok') throw new Error(`router reset: the module answered "${reply.slice(0, 40)}", not "ok"`)
    entries[index] = 0
  }
  mods.forEach((_, index) => reset(index))
  const matchOn = (index: number, tokens: readonly number[]): number => {
    const hit = countReply(mods[index].invoke(`match ${tokens.join(',')}`), 'router match')
    if (hit > tokens.length) throw new Error(`router match: the module reported ${hit} cached tokens for a ${tokens.length}-token prompt`)
    return hit
  }
  return {
    name: 'yours',
    route(tokens, candidates) {
      if (tokens.length === 0) return { index: candidates[0].index, hit: 0 }
      const chosen = choosePrefixWorker(candidates, (index) => matchOn(index, tokens))
      const reply = verbReply(mods[chosen.index].invoke(`insert ${tokens.join(',')}`), 'router insert')
      const kept = /^ok (\d+)$/.exec(reply)
      if (!kept) throw new Error(`router insert: the module answered "${reply.slice(0, 40)}", not "ok <entries>"`)
      entries[chosen.index] = Number(kept[1])
      return chosen
    },
    reset,
    size: (index) => entries[index] ?? 0,
  }
}

/** Counts the tokens of a text; throws when the module is stale, unfinished or broken. */
export type TokenCounter = (text: string) => number

const hexOf = (text: string): string => Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('')

/** The token-count check over your bpe-tokenizer module (§10.5): `count <hex>`, the UTF-8 text as hex. */
export function makeWasmTokenCounter(mod: Mod): TokenCounter {
  if (!mod.hasInvoke) throw new Error('bpe-tokenizer module has no ks_invoke bridge')
  return (text) => countReply(mod.invoke(text === '' ? 'count' : `count ${hexOf(text)}`), 'token count')
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
