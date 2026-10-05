/**
 * wasm-lab — browser client for the kernelspace forge ABI (labs/kit).
 *
 * A lab module is student Rust compiled to wasm32-unknown-unknown with zero
 * dependencies and three exports: `memory`, `ks_alloc`, `ks_free`, `ks_run`.
 * `ks_run` executes the lab's self-check suite (the same checks as
 * `cargo test`) and returns a JSON report in module memory, packed as
 * `(ptr << 32) | len` in a u64 → arrives in JS as a BigInt.
 *
 * No wasm-bindgen, no imports, no server: instantiation needs nothing.
 *
 * Template v2 (docs/specs/wave-1.md §12) runs each check in its own instance; that driver is
 * src/lib/forge/run.ts. The types below stay the v1 report, with optional v2 fields added, so
 * every v1 caller reads a v2 run unchanged.
 */

import type { CheckStatus } from './forge/types'

export interface LabCheckResult {
  id: string
  label: string
  pass: boolean
  msg: string
  /* v2 only (template v2, run per check) */
  status?: CheckStatus
  stage?: number
  seed?: number
  fresh?: boolean
  panic?: string
  trace?: string
  ms?: number
}

export interface LabReport {
  /** The module's lab id; a `--features reference` build keeps its `@reference` suffix here, so no v1 caller credits it. */
  lab: string
  version: number
  checks: LabCheckResult[]
  /* v2 only */
  abi?: 1 | 2
  reference?: boolean
  seeds?: 'fresh' | 'default'
}

/** The module panicked (todo!(), unreachable!, assert) — expected while unfinished. */
export class LabTrapError extends Error {
  /** 'invoke': the self-checks passed, then the ks_invoke bridge /fleet drives trapped */
  readonly phase: 'checks' | 'invoke'
  constructor(cause?: unknown, phase: 'checks' | 'invoke' = 'checks') {
    super(
      phase === 'invoke'
        ? 'the self-checks passed, but ks_invoke (the bridge /fleet drives) trapped on its first calls — check init and command handling for a panic, then rebuild.'
        : 'the module trapped while running — this usually means a todo!() or panic in your code. Finish the implementation and rebuild.',
    )
    this.name = 'LabTrapError'
    this.phase = phase
    this.cause = cause
  }
}

/** The file is not a kernelspace lab module (missing exports, bad imports, not wasm). */
export class LabAbiError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'LabAbiError'
  }
}

/** The module ran past the per-run budget (infinite loop); its worker was terminated. */
export class LabTimeoutError extends Error {
  /** short headline for result panels; the message is the detail beneath it */
  readonly title: string
  /** Template v2: the check that was running. The run goes on with the next check. */
  readonly check?: string
  constructor(ms: number, phase: 'checks' | 'invoke' = 'checks', checksPassed = true, check?: string) {
    super(
      phase === 'invoke'
        ? `${checksPassed ? 'the self-checks passed, but the' : 'the'} module never returned from ks_invoke (the bridge /fleet drives), so the grader stopped it. Look for an infinite loop in your init or command handling.`
        : check
          ? `check "${check}" was still running after ${ms / 1000} s, so the grader stopped it and went on with the next check. Look for an infinite loop in the code this check drives.`
          : 'the module was still running, so the grader stopped it. Look for an infinite loop in your code.',
    )
    this.name = 'LabTimeoutError'
    this.title = `timed out after ${ms / 1000} s`
    if (check !== undefined) this.check = check
  }
}

const decoder = new TextDecoder()

function isReport(x: unknown): x is LabReport {
  if (typeof x !== 'object' || x === null) return false
  const r = x as Record<string, unknown>
  if (typeof r.lab !== 'string' || typeof r.version !== 'number') return false
  if (!Array.isArray(r.checks)) return false
  return r.checks.every((c: unknown) => {
    if (typeof c !== 'object' || c === null) return false
    const k = c as Record<string, unknown>
    return (
      typeof k.id === 'string' &&
      typeof k.label === 'string' &&
      typeof k.pass === 'boolean' &&
      typeof k.msg === 'string'
    )
  })
}

/**
 * Instantiate a lab module and run its self-check suite.
 * Throws LabAbiError (wrong file) or LabTrapError (unfinished/panicking code).
 */
export async function runLabWasm(bytes: ArrayBuffer): Promise<LabReport> {
  let instance: WebAssembly.Instance
  try {
    ;({ instance } = await WebAssembly.instantiate(bytes, {}))
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new LabAbiError(
      `not a loadable kernelspace lab module (${detail}). Drop the .wasm built from the lab template.`,
    )
  }
  return runLabInstance(instance)
}

/** The v1 run on an existing instance: `ks_run(0, 0)`, every check, one report. Throws like runLabWasm. */
export function runLabInstance(instance: WebAssembly.Instance): LabReport {
  const ex = instance.exports as Record<string, unknown>
  const memory = ex.memory as WebAssembly.Memory | undefined
  const ksRun = ex.ks_run as ((inPtr: number, inLen: number) => bigint) | undefined
  if (!(memory instanceof WebAssembly.Memory) || typeof ksRun !== 'function') {
    throw new LabAbiError('wasm loaded, but it is not a kernelspace lab (missing memory/ks_run exports).')
  }

  let packed: bigint
  try {
    packed = ksRun(0, 0)
  } catch (e) {
    throw new LabTrapError(e)
  }

  const ptr = Number(packed >> 32n)
  const len = Number(packed & 0xffff_ffffn)
  /* Read memory.buffer AFTER the call — ks_run may have grown memory. */
  if (len === 0 || ptr + len > memory.buffer.byteLength) {
    throw new LabAbiError('lab returned an out-of-bounds report pointer — ABI violation.')
  }
  const json = decoder.decode(new Uint8Array(memory.buffer, ptr, len))

  let report: unknown
  try {
    report = JSON.parse(json)
  } catch {
    throw new LabAbiError('lab returned invalid JSON — ABI violation.')
  }
  if (!isReport(report)) {
    throw new LabAbiError('lab returned a malformed report — ABI violation.')
  }
  return report
}

/* ------------------------- runtime module handle ------------------------- */

/**
 * A live lab module: instantiate once, then drive it. Used by /fleet to
 * run a student's kv-block-manager against a live traffic stream.
 */
export interface LabModule {
  /** run the self-check suite (ks_run) */
  runChecks(): LabReport
  /** send a line-protocol command (ks_invoke), get the raw reply */
  invoke(cmd: string): string
  /** free all host-side refs; the module's own memory is GC'd with it */
  dispose(): void
}

const encoder = new TextEncoder()

/**
 * Instantiate a lab module for runtime use. Requires the ks_invoke bridge
 * (labs built before the bridge have only ks_run — hasInvoke is false).
 * Also takes an already compiled module (the lab worker compiles once per run).
 */
export async function instantiateLab(bytes: ArrayBuffer | WebAssembly.Module): Promise<LabModule & { hasInvoke: boolean }> {
  let instance: WebAssembly.Instance
  try {
    instance = bytes instanceof WebAssembly.Module
      ? await WebAssembly.instantiate(bytes, {})
      : (await WebAssembly.instantiate(bytes, {})).instance
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new LabAbiError(`not a loadable kernelspace lab module (${detail}).`)
  }
  const ex = instance.exports as Record<string, unknown>
  const memory = ex.memory as WebAssembly.Memory | undefined
  const ksRun = ex.ks_run as ((a: number, b: number) => bigint) | undefined
  const ksInvoke = ex.ks_invoke as ((a: number, b: number) => bigint) | undefined
  const ksAlloc = ex.ks_alloc as ((n: number) => number) | undefined
  const ksFree = ex.ks_free as ((p: number, n: number) => void) | undefined
  if (!(memory instanceof WebAssembly.Memory) || typeof ksRun !== 'function') {
    throw new LabAbiError('wasm loaded, but it is not a kernelspace lab (missing memory/ks_run exports).')
  }

  const readPacked = (packed: bigint): string => {
    const ptr = Number(packed >> 32n)
    const len = Number(packed & 0xffff_ffffn)
    /* memory.buffer read AFTER the call — it may have grown */
    if (len === 0 || ptr + len > memory.buffer.byteLength) {
      throw new LabAbiError('lab returned an out-of-bounds reply pointer — ABI violation.')
    }
    return decoder.decode(new Uint8Array(memory.buffer, ptr, len))
  }

  return {
    hasInvoke: typeof ksInvoke === 'function' && typeof ksAlloc === 'function' && typeof ksFree === 'function',
    runChecks() {
      let packed: bigint
      try {
        packed = (ksRun as (a: number, b: number) => bigint)(0, 0)
      } catch (e) {
        throw new LabTrapError(e)
      }
      const report: unknown = JSON.parse(readPacked(packed))
      if (!isReport(report)) throw new LabAbiError('lab returned a malformed report — ABI violation.')
      return report
    },
    invoke(cmd: string) {
      if (!ksInvoke || !ksAlloc || !ksFree) {
        throw new LabAbiError('this module predates the fleet bridge (no ks_invoke) — rebuild with the latest template.')
      }
      const data = encoder.encode(cmd)
      const ptr = ksAlloc(data.length)
      new Uint8Array(memory.buffer, ptr, data.length).set(data)
      let packed: bigint
      try {
        packed = ksInvoke(ptr, data.length)
      } catch (e) {
        throw new LabTrapError(e)
      } finally {
        ksFree(ptr, data.length)
      }
      return readPacked(packed)
    },
    dispose() {},
  }
}

/**
 * The ks_invoke calls /fleet makes first, one short canned exchange per lab. Fleet admission runs
 * them in the lab worker so a ks_invoke that spins or traps is caught there, not on the main thread.
 * A lab with no entry (not a Fleet slot) is not probed.
 */
const INVOKE_PROBES: Record<string, { init: string; then: string[] }> = {
  'mpmc-queue': { init: 'init 4', then: ['push 1', 'pop'] },
  'kv-block-manager': { init: 'init 16 4', then: ['allocate 1 6', 'free_blocks', 'dump', 'free 1'] },
  'batching-scheduler': { init: 'init', then: ['schedule 0 4 256 0\nW 1 0 16\n'] },
}

/** Run the canned ks_invoke exchange for `lab`. Throws LabTrapError (phase 'checks' — the caller relabels it) or LabAbiError; a spin is the caller's timeout. */
export function probeInvoke(mod: LabModule, lab: string): void {
  const probe = INVOKE_PROBES[lab]
  if (!probe) return
  const init = mod.invoke(probe.init).trim()
  if (init !== 'ok') throw new LabAbiError(`ks_invoke('${probe.init}') answered "${init.slice(0, 60)}", not "ok" — the fleet cannot drive this module.`)
  for (const cmd of probe.then) mod.invoke(cmd)
}
