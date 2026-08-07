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
 */

export interface LabCheckResult {
  id: string
  label: string
  pass: boolean
  msg: string
}

export interface LabReport {
  lab: string
  version: number
  checks: LabCheckResult[]
}

/** The module panicked (todo!(), unreachable!, assert) — expected while unfinished. */
export class LabTrapError extends Error {
  constructor(cause?: unknown) {
    super(
      'the module trapped while running — this usually means a todo!() or panic in your code. Finish the implementation and rebuild.',
    )
    this.name = 'LabTrapError'
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
 */
export async function instantiateLab(bytes: ArrayBuffer): Promise<LabModule & { hasInvoke: boolean }> {
  let instance: WebAssembly.Instance
  try {
    ;({ instance } = await WebAssembly.instantiate(bytes, {}))
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
