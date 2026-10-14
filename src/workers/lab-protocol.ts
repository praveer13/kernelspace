/**
 * Messages between the main thread and lab.worker.ts. Types, plus the pure helpers of a 'calls' run (the reply cap and
 * how a ks_invoke reply is read) — safe to import from both sides.
 */

import { LabAbiError, LabTrapError, type LabReport } from '../lib/wasm-lab'
import type { LabExports } from '../lib/forge/run'
import type { CheckResult, ListReply } from '../lib/forge/types'

export type LabRunMode =
  /** Forge grading: run the self-check suite and return its report */
  | 'grade'
  /** Fleet admission: check the ks_invoke bridge exists, run the suite, then exercise ks_invoke */
  | 'validate'
  /** Prove-it v2 (docs/specs/wave-3.md §7.1): send `calls` through ks_invoke in one instance and return the replies */
  | 'calls'

export interface LabWorkerRequest {
  id: number
  mode: LabRunMode
  bytes: ArrayBuffer
  /** Template v2: seeded checks run on seeds drawn now ('fresh') or on the crate's own ('default', the default). */
  seeds?: 'fresh' | 'default'
  /** Template v2: the first check to run. A worker respawned after a timed-out check resumes past it. */
  startAt?: number
  /** Template v2, 'validate': every check before `startAt` passed (names the probe's timeout correctly). */
  priorGreen?: boolean
  /** 'calls': the ks_invoke commands, in order. An entry may hold newlines (a `schedule` header and its W and R lines are one entry). */
  calls?: string[]
}

/** 'calls': a reply is cut to this many UTF-8 bytes. */
export const CALL_REPLY_MAX_BYTES = 4096

/** `text` cut to CALL_REPLY_MAX_BYTES bytes of UTF-8, never in the middle of a character. */
export function capReply(text: string): string {
  const bytes = new TextEncoder().encode(text)
  if (bytes.length <= CALL_REPLY_MAX_BYTES) return text
  return new TextDecoder().decode(bytes.subarray(0, CALL_REPLY_MAX_BYTES)).replace(/\uFFFD$/, '')
}

/**
 * A `(ptr << 32) | len` ks_invoke reply, read from `memory` (the buffer after the call: it may have grown). A reply of
 * length 0 is the empty string wherever it points: an empty reply is a reply (lab 06's preempt list when nothing is
 * preempted, say), and reads nothing. A reply that runs past the end of memory is an ABI violation.
 */
export function readCallReply(memory: ArrayBuffer, packed: bigint): string {
  const bits = BigInt.asUintN(64, packed)
  const ptr = Number(bits >> 32n)
  const len = Number(bits & 0xffff_ffffn)
  if (len === 0) return ''
  if (ptr + len > memory.byteLength) throw new LabAbiError('your module replied with a pointer past the end of its memory: ABI violation.')
  return new TextDecoder().decode(new Uint8Array(memory, ptr, len))
}

/**
 * One ks_invoke call on a live instance: the command goes in through ks_alloc, the reply comes out through
 * `readCallReply`, and the input buffer is freed. A trap anywhere in the module is a LabTrapError.
 */
export function invokeCall(ex: LabExports, cmd: string): string {
  const { ks_invoke: invoke, ks_alloc: alloc, ks_free: free } = ex
  if (typeof invoke !== 'function' || typeof alloc !== 'function' || typeof free !== 'function') {
    throw new LabAbiError('this module has no ks_invoke bridge: rebuild with the latest template.')
  }
  const data = new TextEncoder().encode(cmd)
  let ptr: number
  try {
    ptr = alloc(data.length) >>> 0 // an i32 comes back signed; an address is unsigned
  } catch (e) {
    throw new LabTrapError(e)
  }
  if (ptr + data.length > ex.memory.buffer.byteLength) throw new LabAbiError('ks_alloc returned a buffer past the end of memory: ABI violation.')
  new Uint8Array(ex.memory.buffer, ptr, data.length).set(data)
  let packed: bigint
  try {
    packed = invoke(ptr, data.length)
  } catch (e) {
    throw new LabTrapError(e)
  }
  const reply = readCallReply(ex.memory.buffer, packed)
  try {
    free(ptr, data.length)
  } catch (e) {
    throw new LabTrapError(e)
  }
  return reply
}

export type LabWorkerReply =
  | { type: 'ready' }
  /** Template v2: the module's `list` reply, before any check runs */
  | { type: 'listed'; id: number; list: ListReply }
  /** 'calls': one reply per entry of `calls`, each capped at CALL_REPLY_MAX_BYTES. A trap or a refusal is `failed` instead. */
  | { type: 'replies'; id: number; replies: string[] }
  /** Template v2: check `index` is starting; the main thread's 2 s timer for it starts here */
  | { type: 'check-start'; id: number; index: number; check: string; seed?: number }
  | { type: 'check-done'; id: number; index: number; result: CheckResult }
  /** 'validate' only: the ks_invoke probe is starting (names the stage a timeout hit; it runs even after failing checks) */
  | { type: 'phase'; id: number; phase: 'invoke'; checksPassed: boolean }
  | {
      type: 'done'
      id: number
      /** 2: the results came as check-done messages and `report` is null. Absent means 1. */
      abi?: 1 | 2
      /** null in 'validate' mode when the module has no ks_invoke bridge, and for every v2 run */
      report: LabReport | null
      hasInvoke: boolean
    }
  /** `phase: 'invoke'` marks a trap in the ks_invoke probe after green checks */
  | { type: 'failed'; id: number; kind: 'trap' | 'abi' | 'error'; message: string; phase?: 'invoke' }
