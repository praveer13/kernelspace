/**
 * Test doubles for the forge host (docs/specs/wave-1.md §16.4: fake module objects, no cargo needed).
 *
 * - `fakeLab` is a JS object with the exports of a template-v2 module, driven by plain functions:
 *   the engine in src/lib/forge/run.ts cannot tell it from wasm.
 * - `tinyLabWasm` hand-assembles a real, minimal wasm module with one check, for the worker path
 *   (runLabInWorker, validateLabInWorker) under Bun. With `invoke` it also has a ks_invoke bridge (Prove-it v2, runLabCalls).
 * - `fakeBridge` and `fakeBlockManager` are ks_invoke bridges as plain functions, for prove2.ts: the call runner
 *   is injected, so no worker is needed.
 */

import type { Instantiate, LabExports } from '../../src/lib/forge/run'
import { LabTimeoutError, LabTrapError } from '../../src/lib/wasm-lab'

/* -------------------------------- fake modules -------------------------------- */

export interface FakeCheck {
  id: string
  label?: string
  stage?: number
  seeded?: boolean
  defaultSeed?: number
  /** Return the verdict, or throw `trap(msg)` to make the instance trap after setting the panic text. */
  run: (seed: number, trace: (line: string) => void) => { pass: boolean; msg: string }
}

export class Trap extends Error {}
export const trap = (panic: string): never => {
  throw new Trap(panic)
}

export interface FakeLab {
  make: Instantiate
  /** Instances handed out so far. */
  instances: () => number
  /** Every input `ks_run` received, in order ('' for v1's (0, 0)). */
  inputs: string[]
  /** Check bodies run so far. */
  ran: string[]
}

/** A template-v2 module as a plain object (`abi: 1` drops ks_abi_version: a v1 module). */
export function fakeLab(lab: string, checks: FakeCheck[], opts: { abi?: number; version?: number } = {}): FakeLab {
  const inputs: string[] = []
  const ran: string[] = []
  let instances = 0
  const make: Instantiate = () => {
    instances++
    const memory = new WebAssembly.Memory({ initial: 1 })
    let top = 8
    let panic = ''
    let traceBuf = ''
    const put = (text: string): bigint => {
      if (text === '') return 0n
      const bytes = new TextEncoder().encode(text)
      const ptr = top
      top += bytes.length + 8
      new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes)
      return (BigInt(ptr) << 32n) | BigInt(bytes.length)
    }
    const respond = (input: string): string => {
      const lines = input.split('\n').map((l) => l.trim().split(/\s+/))
      const list = lines.some((l) => l[0] === 'list')
      const only = lines.filter((l) => l[0] === 'only').map((l) => l[1])
      const seedLine = lines.find((l) => l[0] === 'seed')
      const seed = seedLine ? Number(seedLine[1]) : undefined
      const head = { lab, version: opts.version ?? 1 }
      if (input === '') {
        return JSON.stringify({ ...head, checks: checks.map((c) => ({ id: c.id, label: c.label ?? c.id, ...exec(c, undefined) })) })
      }
      if (list) {
        return JSON.stringify({ ...head, abi: 2, checks: checks.map((c) => ({ id: c.id, label: c.label ?? c.id, stage: c.stage ?? 1, seeded: c.seeded ?? false })) })
      }
      const picked = only.length > 0 ? checks.filter((c) => only.includes(c.id)) : checks
      return JSON.stringify({
        ...head,
        abi: 2,
        checks: picked.map((c) => {
          const used = c.seeded ? seed ?? c.defaultSeed ?? 0 : undefined
          return { id: c.id, label: c.label ?? c.id, ...exec(c, seed), ...(used === undefined ? {} : { seed: used }) }
        }),
      })
    }
    const exec = (c: FakeCheck, seed: number | undefined) => {
      ran.push(c.id)
      try {
        return c.run(c.seeded ? seed ?? c.defaultSeed ?? 0 : 0, (line) => (traceBuf += `${line}\n`))
      } catch (e) {
        if (e instanceof Trap) {
          panic = e.message
          throw new WebAssembly.RuntimeError('unreachable')
        }
        throw e
      }
    }
    const ex: LabExports = {
      memory,
      ks_alloc: (len) => {
        const ptr = top
        top += len + 8
        return ptr
      },
      ks_free: () => {},
      ks_run: (ptr, len) => {
        const input = len === 0 ? '' : new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len))
        inputs.push(input)
        return put(respond(input))
      },
      ks_panic_msg: () => put(panic),
      ks_trace_drain: () => {
        const t = traceBuf
        traceBuf = ''
        return put(t)
      },
    }
    if ((opts.abi ?? 2) !== 1) ex.ks_abi_version = () => opts.abi ?? 2
    return ex
  }
  return { make, instances: () => instances, inputs, ran }
}

/* ------------------------------ fake ks_invoke bridges ------------------------------ */

/** Thrown by a bridge handler to stand for a module that never returns from ks_invoke. */
export class Spin extends Error {}

export interface FakeBridge {
  /** Same shape as `runLabCalls`: a fresh handler per run, state kept between the entries of one list. */
  run: (bytes: ArrayBuffer, calls: string[]) => Promise<string[]>
  /** The call list of every run, in order. */
  runs: string[][]
}

/** A bridge as a plain function. A `trap(...)` in the handler is a LabTrapError, a `Spin` a LabTimeoutError, as in lab-worker.ts. */
export function fakeBridge(make: () => (cmd: string) => string): FakeBridge {
  const runs: string[][] = []
  const run = async (_bytes: ArrayBuffer, calls: string[]): Promise<string[]> => {
    runs.push(calls)
    const handle = make()
    return calls.map((cmd) => {
      try {
        return handle(cmd)
      } catch (e) {
        if (e instanceof Trap) throw new LabTrapError(e)
        if (e instanceof Spin) throw new LabTimeoutError(2000, 'invoke', false)
        throw e
      }
    })
  }
  return { run, runs }
}

/**
 * Lab 02's line protocol (labs/kv-block-manager/src/lib.rs, "fleet bridge"): init, allocate, append, fork, free, translate,
 * free_blocks and dump, over refcounted blocks. `freeSharedAtFirstFree` is the plausible bug that gives a shared block
 * back when its first owner is freed; `lifo` hands blocks out newest-freed first (the free-list design the learner chose).
 */
export function fakeBlockManager(opts: { freeSharedAtFirstFree?: boolean; lifo?: boolean } = {}): () => (cmd: string) => string {
  return () => {
    let size = 0
    let free: number[] = []
    const refs = new Map<number, number>()
    const seqs = new Map<number, { blocks: number[]; tokens: number }>()
    const take = (): number | undefined => (opts.lifo ? free.pop() : free.shift())
    const give = (b: number) => {
      free.push(b)
    }
    const release = (b: number) => {
      const left = (refs.get(b) ?? 1) - 1
      refs.set(b, left)
      if (left === 0 || opts.freeSharedAtFirstFree) {
        if (!free.includes(b)) give(b)
      }
    }
    return (cmd) => {
      const [op, ...a] = cmd.trim().split(/\s+/)
      const n = a.map(Number)
      switch (op) {
        case 'init':
          size = n[1]
          free = Array.from({ length: n[0] }, (_, i) => i)
          refs.clear()
          seqs.clear()
          return 'ok'
        case 'allocate': {
          const need = Math.ceil(n[1] / size)
          if (need > free.length || seqs.has(n[0])) return 'false'
          const blocks = Array.from({ length: need }, () => take() as number)
          for (const b of blocks) refs.set(b, 1)
          seqs.set(n[0], { blocks, tokens: n[1] })
          return 'true'
        }
        case 'fork': {
          const src = seqs.get(n[0])
          if (!src || seqs.has(n[1])) return 'false'
          for (const b of src.blocks) refs.set(b, (refs.get(b) ?? 1) + 1)
          seqs.set(n[1], { blocks: [...src.blocks], tokens: src.tokens })
          return 'true'
        }
        case 'append': {
          const q = seqs.get(n[0])
          if (!q) return 'false'
          const need = Math.ceil((q.tokens + n[1]) / size) - q.blocks.length
          const last = q.blocks.length - 1
          const copy = last >= 0 && q.tokens % size !== 0 && (refs.get(q.blocks[last]) ?? 1) > 1
          if (need + (copy ? 1 : 0) > free.length) return 'false'
          if (copy) {
            const fresh = take() as number
            release(q.blocks[last])
            refs.set(fresh, 1)
            q.blocks[last] = fresh
          }
          for (let i = 0; i < need; i++) {
            const b = take() as number
            refs.set(b, 1)
            q.blocks.push(b)
          }
          q.tokens += n[1]
          return 'true'
        }
        case 'free': {
          const q = seqs.get(n[0])
          if (q) for (const b of q.blocks) release(b)
          seqs.delete(n[0])
          return 'ok'
        }
        case 'translate': {
          const q = seqs.get(n[0])
          return q && n[1] < q.tokens ? String(q.blocks[Math.floor(n[1] / size)]) : 'none'
        }
        case 'free_blocks':
          return String(free.length)
        case 'dump':
          return [...seqs].map(([s, q]) => `seq ${s}: ${q.blocks.join(',')}`).join('\n')
        default:
          return `err unknown command '${cmd.slice(0, 20)}'`
      }
    }
  }
}

/* -------------------------------- tiny real wasm -------------------------------- */

const uleb = (n: number): number[] => {
  const out: number[] = []
  do {
    let b = n & 0x7f
    n >>>= 7
    if (n !== 0) b |= 0x80
    out.push(b)
  } while (n !== 0)
  return out
}
const sleb = (v: bigint): number[] => {
  const out: number[] = []
  for (;;) {
    const b = Number(v & 0x7fn)
    v >>= 7n
    const done = (v === 0n && (b & 0x40) === 0) || (v === -1n && (b & 0x40) !== 0)
    out.push(done ? b : b | 0x80)
    if (done) return out
  }
}
const bytesOf = (s: string) => [...new TextEncoder().encode(s)]
const name = (s: string) => [...uleb(bytesOf(s).length), ...bytesOf(s)]
const vec = (items: number[][]) => [...uleb(items.length), ...items.flat()]
const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body]
const I32 = 0x7f
const I64 = 0x7e
const fnType = (params: number[], results: number[]) => [0x60, ...vec(params.map((p) => [p])), ...vec(results.map((r) => [r]))]
const body = (code: number[]) => {
  const b = [0x00, ...code, 0x0b] // no locals
  return [...uleb(b.length), ...b]
}

/**
 * A minimal lab module with one check, `c1`: `ks_run` answers by input length (0 → the v1
 * report, 9 → `list`, otherwise the `only` reply or a trap). Zero imports.
 *
 * With `invoke` it also exports `ks_invoke`, which counts its calls in a mutable global and answers by the command's first
 * byte: `t…` traps, `b…` replies 8,000 bytes of `x`, `c…` replies the letter for the call count so far ('a' on the first
 * call of an instance, 'b' on the second…, which shows state is kept between entries and starts fresh with a new
 * instance), and anything else is echoed back (newlines included, so a multi-line entry comes back whole).
 */
export function tinyLabWasm(opts: { lab: string; abi?: 1 | 2; checkPasses?: boolean; trapCheck?: boolean; panic?: string; invoke?: boolean }): ArrayBuffer {
  const pass = opts.checkPasses ?? true
  const v1 = JSON.stringify({ lab: opts.lab, version: 1, checks: [{ id: 'c1', label: 'one', pass, msg: 'v1' }] })
  const list = JSON.stringify({ lab: opts.lab, version: 1, abi: 2, checks: [{ id: 'c1', label: 'one', stage: 1, seeded: false }] })
  const only = JSON.stringify({ lab: opts.lab, version: 1, abi: 2, checks: [{ id: 'c1', label: 'one', pass, msg: 'v2' }] })
  const panic = opts.panic ?? ''
  const at = { v1: 2048, list: 4096, only: 6144, panic: 8192, big: 16384, letters: 32768 }
  const big = 'x'.repeat(8000)
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const packed = (ptr: number, text: string) => sleb((BigInt(ptr) << 32n) | BigInt(bytesOf(text).length))
  const trapV1 = (opts.abi ?? 2) === 1 && opts.trapCheck

  const types = [fnType([], [I32]), fnType([I32], [I32]), fnType([I32, I32], []), fnType([I32, I32], [I64]), fnType([], [I64])]
  const funcs: { name: string; type: number; code: number[] }[] = [
    { name: 'ks_alloc', type: 1, code: [0x41, ...sleb(1024n)] },
    { name: 'ks_free', type: 2, code: [] },
    {
      name: 'ks_run',
      type: 3,
      code: [
        0x20, 1, 0x45, 0x04, I64, // if in_len == 0
        ...(trapV1 ? [0x00] : [0x42, ...packed(at.v1, v1)]),
        0x05,
        0x20, 1, 0x41, 9, 0x46, 0x04, I64, // if in_len == 9 (`v 2\nlist\n`)
        0x42, ...packed(at.list, list),
        0x05,
        ...(opts.trapCheck ? [0x00] : [0x42, ...packed(at.only, only)]),
        0x0b,
        0x0b,
      ],
    },
    { name: 'ks_panic_msg', type: 4, code: [0x42, ...(panic ? packed(at.panic, panic) : sleb(0n))] },
    { name: 'ks_trace_drain', type: 4, code: [0x42, ...sleb(0n)] },
  ]
  if ((opts.abi ?? 2) === 2) funcs.push({ name: 'ks_abi_version', type: 0, code: [0x41, 2] })
  const firstByteIs = (c: string) => [0x20, 0, 0x2d, 0, 0, 0x41, ...sleb(BigInt(c.charCodeAt(0))), 0x46] // local.get 0; i32.load8_u; i32.const c; i32.eq
  if (opts.invoke) {
    funcs.push({
      name: 'ks_invoke',
      type: 3,
      code: [
        0x23, 0, 0x41, 1, 0x6a, 0x24, 0, // calls += 1
        ...firstByteIs('t'), 0x04, 0x40, 0x00, 0x0b, // if first byte is 't': unreachable
        ...firstByteIs('b'), 0x04, 0x40, 0x42, ...packed(at.big, big), 0x0f, 0x0b, // 'b': the big reply
        ...firstByteIs('c'), 0x04, 0x40, 0x23, 0, 0x41, ...sleb(BigInt(at.letters - 1)), 0x6a, 0xad, 0x42, ...sleb(32n), 0x86, 0x42, 1, 0x84, 0x0f, 0x0b, // 'c': the letter at letters + calls - 1
        0x20, 0, 0xad, 0x42, ...sleb(32n), 0x86, 0x20, 1, 0xad, 0x84, // echo: (ptr << 32) | len
      ],
    })
  }

  const data = (off: number, text: string) => [0x00, 0x41, ...sleb(BigInt(off)), 0x0b, ...vec(bytesOf(text).map((b) => [b]))]
  const mod = [
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, vec(types)),
    ...section(3, vec(funcs.map((f) => uleb(f.type)))),
    ...section(5, [0x01, 0x00, 0x01]),
    ...(opts.invoke ? section(6, vec([[I32, 0x01, 0x41, 0, 0x0b]])) : []), // (global $calls (mut i32) (i32.const 0))
    ...section(7, vec([[...name('memory'), 0x02, 0x00], ...funcs.map((f, i) => [...name(f.name), 0x00, ...uleb(i)])])),
    ...section(10, vec(funcs.map((f) => body(f.code)))),
    ...section(11, vec([data(at.v1, v1), data(at.list, list), data(at.only, only), data(at.panic, panic || ' '), ...(opts.invoke ? [data(at.big, big), data(at.letters, letters)] : [])])),
  ]
  return new Uint8Array(mod).buffer
}
