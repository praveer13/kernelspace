/**
 * Verb calls in the lab worker (docs/specs/wave-3.md §7.1): the 'calls' request runs a list of ks_invoke commands in
 * one instance and returns the replies. Two layers, as for run.test.ts: the real worker on a hand-assembled wasm module
 * (order, state, multi-line entries, the reply cap, refusals, a trap), and the main-thread driver on fake workers
 * and fake timers (the one budget for the whole list, which a real spin could not test: under Bun a worker stuck in
 * wasm cannot be terminated).
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { driveLabCalls, disposeLabWorker, runLabCalls } from '../../src/lib/lab-worker'
import { LabAbiError, LabTimeoutError, LabTrapError } from '../../src/lib/wasm-lab'
import type { LabExports, LabPool, LabPort, Timers } from '../../src/lib/forge/run'
import { CALL_REPLY_MAX_BYTES, capReply, invokeCall, readCallReply, type LabWorkerReply, type LabWorkerRequest } from '../../src/workers/lab-protocol'
import { tinyLabWasm } from './fixtures'

afterAll(() => disposeLabWorker())

const bridge = () => tinyLabWasm({ lab: 'kv-block-manager', invoke: true })

describe('the lab worker answers a list of calls', () => {
  test('each entry goes through ks_invoke in order, and the replies come back in that order', async () => {
    const calls = ['init 16 4', 'allocate 1 6', 'free_blocks', 'dump', 'free 1']
    expect(await runLabCalls(bridge(), calls)).toEqual(calls)
  })

  test('an entry with newlines is one call, never split (a batching-scheduler schedule is a header, then W and R lines)', async () => {
    const schedule = 'schedule 0 4 256 0\nW 1 0 16\nW 2 0 8\nR 3 40 2\n'
    const replies = await runLabCalls(bridge(), ['init', schedule, 'init'])
    expect(replies).toHaveLength(3)
    expect(replies[1]).toBe(schedule)
  })

  test('the module is instantiated once per list: state is kept between entries and a new list starts fresh', async () => {
    expect(await runLabCalls(bridge(), ['c', 'c', 'c'])).toEqual(['a', 'b', 'c'])
    expect(await runLabCalls(bridge(), ['c'])).toEqual(['a'])
  })

  test('a reply is cut at 4 KiB, whatever the module sends', async () => {
    const [short, long] = await runLabCalls(bridge(), ['hello', 'big'])
    expect(short).toBe('hello')
    expect(long).toHaveLength(CALL_REPLY_MAX_BYTES)
    expect(long).toBe('x'.repeat(CALL_REPLY_MAX_BYTES))
  })

  test('a trap is a failed call: the list ends and the caller gets a LabTrapError', async () => {
    await expect(runLabCalls(bridge(), ['init', 'trap now', 'init'])).rejects.toBeInstanceOf(LabTrapError)
    // the worker is still usable afterwards
    expect(await runLabCalls(bridge(), ['c'])).toEqual(['a'])
  })

  test('a reference build is refused, so it earns nothing', async () => {
    const err = await runLabCalls(tinyLabWasm({ lab: 'kv-block-manager@reference', invoke: true }), ['init']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LabAbiError)
    expect((err as Error).message).toContain('reference build')
  })

  test('a module without ks_invoke is refused with the missing-bridge message', async () => {
    const err = await runLabCalls(tinyLabWasm({ lab: 'kv-block-manager' }), ['init']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LabAbiError)
    expect((err as Error).message).toContain('this module has no ks_invoke bridge')
  })

  test('a v1 module is refused (it cannot say whether it is a reference build), and so is an empty list', async () => {
    await expect(runLabCalls(tinyLabWasm({ lab: 'kv-block-manager', abi: 1, invoke: true }), ['init'])).rejects.toBeInstanceOf(LabAbiError)
    await expect(runLabCalls(bridge(), [])).rejects.toBeInstanceOf(LabAbiError)
  })

  test('bytes that are not a lab are a LabAbiError', async () => {
    await expect(runLabCalls(new Uint8Array([1, 2, 3]).buffer, ['init'])).rejects.toBeInstanceOf(LabAbiError)
  })

  test('an empty reply is a reply: the empty string, graded like any other, never a refusal', async () => {
    // The bridge echoes its input, so an empty command gets a reply of length 0 (lab 06's preempt list when none is preempted).
    // 'c' answers the letter of its call count: the empty reply was the second call of the same instance, not a lost one.
    expect(await runLabCalls(bridge(), ['init', '', 'c'])).toEqual(['init', '', 'c'])
    expect(await runLabCalls(bridge(), [''])).toEqual([''])
  })
})

/* ------------------------------ reading a reply ------------------------------ */

describe('a ks_invoke reply, read from a fake module', () => {
  /** A module as plain exports: one page of memory, ks_invoke answering `packed` whatever it is sent. */
  const fake = (packed: bigint | (() => bigint)): LabExports & { freed: number } => {
    const memory = new WebAssembly.Memory({ initial: 1 })
    new Uint8Array(memory.buffer, 100, 5).set(new TextEncoder().encode('hello'))
    const ex = {
      freed: 0,
      memory,
      ks_run: () => 0n,
      ks_alloc: () => 1024,
      ks_free: () => {
        ex.freed++
      },
      ks_invoke: () => (typeof packed === 'function' ? packed() : packed),
    }
    return ex
  }
  const at = (ptr: number, len: number) => (BigInt(ptr) << 32n) | BigInt(len)
  const PAGE = 65536

  test('a reply of length 0 is the empty string, wherever it points, and the input is still freed', () => {
    for (const ptr of [0, 100, PAGE - 1, PAGE, PAGE * 4, 0xffff_ffff]) {
      const ex = fake(at(ptr, 0))
      expect(invokeCall(ex, 'preempt')).toBe('')
      expect(ex.freed).toBe(1)
    }
    expect(readCallReply(new ArrayBuffer(0), 0n)).toBe('')
  })

  test('a reply inside memory is read as UTF-8, up to the last byte', () => {
    expect(invokeCall(fake(at(100, 5)), 'x')).toBe('hello')
    const ex = fake(at(PAGE - 1, 1))
    new Uint8Array(ex.memory.buffer)[PAGE - 1] = 0x37
    expect(invokeCall(ex, 'x')).toBe('7')
  })

  test('a reply that runs past the end of memory is still an ABI violation', () => {
    for (const [ptr, len] of [[PAGE, 1], [PAGE - 1, 2], [0, PAGE + 1], [0xffff_ffff, 0xffff_ffff]]) {
      const err = (() => {
        try {
          invokeCall(fake(at(ptr, len)), 'x')
        } catch (e) {
          return e
        }
      })()
      expect(err).toBeInstanceOf(LabAbiError)
      expect((err as Error).message).toContain('past the end of its memory')
    }
  })

  test('a trap in ks_invoke is a LabTrapError, and a module without the bridge is refused', () => {
    expect(() => invokeCall(fake(() => { throw new WebAssembly.RuntimeError('unreachable') }), 'x')).toThrow(LabTrapError)
    const noBridge: LabExports = { ...fake(0n), ks_invoke: undefined }
    expect(() => invokeCall(noBridge, 'x')).toThrow(LabAbiError)
  })
})

describe('capReply', () => {
  test('leaves a short reply alone and counts bytes, not characters', () => {
    expect(capReply('ok')).toBe('ok')
    expect(capReply('é'.repeat(2048))).toBe('é'.repeat(2048)) // exactly 4096 bytes
    expect(capReply('é'.repeat(2049))).toBe('é'.repeat(2048))
  })

  test('never ends in half a character', () => {
    const cut = capReply('a' + '€'.repeat(2000)) // 3-byte characters: 1 + 3k bytes, the 4096-byte cut lands inside one
    expect(cut).toBe('a' + '€'.repeat(1365))
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(CALL_REPLY_MAX_BYTES)
  })
})

/* ------------------------------ the driver ------------------------------ */

type Script = (req: LabWorkerRequest, emit: (m: LabWorkerReply) => void) => void

/** Fake workers that follow `script` when posted to; `fire()` runs the one pending timer. */
function harness(script: Script) {
  const posts: LabWorkerRequest[] = []
  const discarded: number[] = []
  const pending = new Set<{ fn: () => void; ms: number }>()
  const ports: { crash(message: string): void }[] = []
  let armed = 0
  let spawned = 0
  const timers: Timers = {
    set: (fn, ms) => {
      armed++
      const h = { fn, ms }
      pending.add(h)
      return h
    },
    clear: (h) => pending.delete(h as { fn: () => void; ms: number }),
  }
  const pool: LabPool = {
    async acquire() {
      const n = spawned++
      let listener: ((m: LabWorkerReply) => void) | null = null
      let crash: ((message: string) => void) | null = null
      const port: LabPort & { n: number; crash(message: string): void } = {
        n,
        crash: (message) => crash?.(message),
        post(req) {
          posts.push(req)
          script(req, (m) => listener?.(m))
        },
        subscribe(onMessage, onCrash) {
          listener = onMessage
          crash = onCrash
          return () => {
            listener = null
            crash = null
          }
        },
      }
      ports.push(port)
      return port
    },
    discard(port) {
      discarded.push((port as LabPort & { n: number }).n)
    },
  }
  const fire = () => {
    expect(pending.size).toBe(1)
    const [h] = pending
    pending.delete(h)
    h.fn()
  }
  let id = 0
  return { pool, timers, posts, discarded, fire, pending, ports, armed: () => armed, nextId: () => id++ }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const bytes = new ArrayBuffer(0)

describe('driveLabCalls: one budget for the whole list', () => {
  test('posts one calls request, arms one 2 s timer, and clears it with the replies', async () => {
    const h = harness((req, emit) => emit({ type: 'replies', id: req.id, replies: (req.calls ?? []).map((c) => c.toUpperCase()) }))
    const out = await driveLabCalls(h.pool, { bytes, calls: ['a', 'b\nc', 'd'] }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    expect(out).toEqual(['A', 'B\nC', 'D'])
    expect(h.posts).toHaveLength(1)
    expect(h.posts[0]).toMatchObject({ mode: 'calls', calls: ['a', 'b\nc', 'd'] })
    expect(h.armed()).toBe(1)
    expect(h.pending.size).toBe(0)
    expect(h.discarded).toEqual([])
  })

  test('a list that never finishes is a LabTimeoutError at the budget, and its worker is discarded', async () => {
    const h = harness(() => {})
    const run = driveLabCalls(h.pool, { bytes, calls: ['init', 'spin'] }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    expect([...h.pending].map((p) => p.ms)).toEqual([2000])
    h.fire()
    const err = await run.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LabTimeoutError)
    expect((err as LabTimeoutError).title).toBe('timed out after 2 s')
    expect((err as LabTimeoutError).message).toBe('your module did not answer all 2 calls within 2 s, so the grader stopped it. Look for an infinite loop in the code that handles them.')
    expect(h.discarded).toEqual([0])
  })

  test('failed replies become the matching errors', async () => {
    for (const [kind, ctor] of [
      ['trap', LabTrapError],
      ['abi', LabAbiError],
      ['error', Error],
    ] as const) {
      const h = harness((req, emit) => emit({ type: 'failed', id: req.id, kind, message: 'no' }))
      const err = await driveLabCalls(h.pool, { bytes, calls: ['init'] }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ctor)
      expect(h.pending.size).toBe(0)
    }
  })

  test('a worker crash rejects with its message, clears the timer and discards the worker', async () => {
    const h = harness(() => {})
    const run = driveLabCalls(h.pool, { bytes, calls: ['init'] }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    h.ports[0].crash('boom')
    await expect(run).rejects.toThrow('boom')
    expect(h.pending.size).toBe(0)
    expect(h.discarded).toEqual([0])
  })

  test('a reply to another request is ignored', async () => {
    const h = harness((req, emit) => emit({ type: 'replies', id: req.id + 100, replies: ['stale'] }))
    const run = driveLabCalls(h.pool, { bytes, calls: ['init'] }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })
    await flush()
    expect(h.pending.size).toBe(1)
    h.fire()
    await expect(run).rejects.toBeInstanceOf(LabTimeoutError)
  })

  test('an empty list is refused before any worker is asked', async () => {
    const h = harness(() => {})
    await expect(driveLabCalls(h.pool, { bytes, calls: [] }, { budgetMs: 2000, nextId: h.nextId, timers: h.timers })).rejects.toBeInstanceOf(LabAbiError)
    expect(h.posts).toHaveLength(0)
  })
})
