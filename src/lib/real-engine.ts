/**
 * real-engine — the flagship: a student's Rust scheduler (lab 06, compiled
 * to wasm) arbitrating a REAL model's token generation in the browser.
 *
 * The honest model: one GPU = one generation slot. The scheduler decides
 * admission AND order; every quantum we re-ask, and if the head changed,
 * the previous request is preempted and its partial output is REGENERATED
 * next time — recompute preemption with a real, felt cost (the prefill
 * time you watch tick by). TTFT/ITL are measured in wall-clock ms.
 *
 * The runtime is transformers.js from CDN (no build dependency): WebGPU
 * when the machine has one, wasm CPU otherwise. Model: Qwen3-0.6B q4
 * (Apache-2.0) by default.
 */

import type { SchedulerDriver, SchedView } from '@/lib/fleet-model'

export interface RealReq {
  id: number
  prompt: string
  estTokens: number
  maxNew: number
}

/** The canned workload: eight prompts, three size classes. */
export const REAL_WORKLOAD: RealReq[] = [
  { id: 1, prompt: 'Explain virtual memory to a backend engineer in two sentences.', estTokens: 16, maxNew: 48 },
  { id: 2, prompt: 'Write a haiku about a page fault.', estTokens: 10, maxNew: 32 },
  { id: 3, prompt: 'List three reasons decode is bandwidth-bound, one line each.', estTokens: 18, maxNew: 64 },
  { id: 4, prompt: 'What is copy-on-write? One paragraph.', estTokens: 12, maxNew: 48 },
  { id: 5, prompt: 'Summarize why continuous batching beats static batching, briefly.', estTokens: 16, maxNew: 56 },
  { id: 6, prompt: 'Give a one-line mental model for a TLB.', estTokens: 12, maxNew: 24 },
  { id: 7, prompt: 'Two sentences on why KV caches dominate long-context serving.', estTokens: 15, maxNew: 48 },
  { id: 8, prompt: 'Name the four questions for choosing a systems language.', estTokens: 13, maxNew: 40 },
]

export type ReqStatus = 'queued' | 'admitted' | 'generating' | 'done'

export interface RealReqState {
  spec: RealReq
  status: ReqStatus
  text: string
  tokens: number
  admittedAt?: number
  firstTokenAt?: number
  doneAt?: number
  preempted: number
}

export interface RealRunMetrics {
  avgTtftMs: number
  tokPerSec: number
  totalMs: number
  preemptions: number
}

type ProgressFn = (phase: string, frac: number) => void

export interface RealGenFn {
  (messages: { role: string; content: string }[], opts: Record<string, unknown>): Promise<
    { generated_text: { role: string; content: string }[] }[]
  >
}

/** A loaded model: the generation function plus the device it runs on. */
export interface LoadedModel {
  gen: RealGenFn
  device: string
}

/** Load the runtime + model in a WEB WORKER (main thread never blocks).
 *  webgpu when the machine has one, wasm otherwise. */
export async function loadRealModel(modelId: string, onProgress: ProgressFn): Promise<LoadedModel> {
  onProgress('spawning worker + loading transformers.js from CDN', 0)
  const worker = new Worker('/gen-worker.js')
  let seq = 0
  const pending = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>()
  let readyResolve: (device: string) => void = () => {}
  let readyReject: (e: Error) => void = () => {}
  worker.onmessage = (e) => {
    const m = e.data
    if (m.kind === 'progress') onProgress(m.phase, m.frac)
    else if (m.kind === 'ready') readyResolve(m.device)
    else if (m.kind === 'done') pending.get(m.id)?.resolve(m.text)
    else if (m.kind === 'error') {
      if (m.id === -1) readyReject(new Error(m.message))
      else pending.get(m.id)?.reject(new Error(m.message))
    }
  }
  const ready = new Promise<string>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  worker.postMessage({ kind: 'load', modelId })
  const device = await ready
  onProgress(`model ready (${device})`, 1)

  const gen: RealGenFn = async (messages, opts) => {
    const id = ++seq
    const prompt = messages.map((m) => m.content).join('\n')
    const maxNew = typeof opts.max_new_tokens === 'number' ? opts.max_new_tokens : 32
    const text = await new Promise<string>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      worker.postMessage({ kind: 'gen', id, prompt, maxNew })
    })
    return [{ generated_text: [{ role: 'assistant', content: text }] }]
  }
  return { gen, device }
}

const QUANTUM_TOKENS = 8

/**
 * Run the workload with the given scheduler driver. The scheduler sees the
 * exact lab-06 state shape (iter, max_running=1, mem_cap huge, waiting,
 * running) — its admission ORDER is the generation order, and changing the
 * head mid-flight costs a real recompute.
 */
export async function runRealEngine(
  gen: RealGenFn,
  scheduler: SchedulerDriver,
  onUpdate: (states: RealReqState[], note?: string) => void,
): Promise<RealRunMetrics> {
  const t0 = performance.now()
  const states: RealReqState[] = REAL_WORKLOAD.map((spec) => ({
    spec,
    status: 'queued',
    text: '',
    tokens: 0,
    preempted: 0,
  }))
  const byId = new Map(states.map((s) => [s.spec.id, s]))
  const admitted: number[] = []
  let iter = 0
  let preemptions = 0

  const view = (): SchedView => ({
    iter: iter++,
    maxRunning: 1,
    memCap: 1 << 30,
    memUsed: 0,
    waiting: states
      .filter((s) => s.status === 'queued')
      .map((s) => ({ id: s.spec.id, arrival: s.spec.id, prompt: s.spec.estTokens })),
    running: states
      .filter((s) => s.status === 'admitted' || s.status === 'generating')
      .map((s) => ({ id: s.spec.id, arrival: s.spec.id, prompt: s.spec.estTokens, decoded: s.tokens, prefillLeft: 0 })),
  })

  while (true) {
    const remaining = states.filter((s) => s.status !== 'done')
    if (remaining.length === 0) break

    // ask the scheduler who may occupy the slot
    const action = scheduler.schedule(view())
    // explicit preemption: evict back to the queue (progress lost — the tax)
    for (const id of action.preempt) {
      const s = byId.get(id)
      if (s && (s.status === 'generating' || s.status === 'admitted')) {
        s.status = 'queued'
        s.preempted++
        preemptions++
        onUpdate(states, `req ${id} preempted by scheduler — ${s.tokens} tokens of progress will be recomputed`)
      }
    }
    for (const id of action.admit) {
      const s = byId.get(id)
      if (s && s.status === 'queued') {
        s.status = 'admitted'
        s.admittedAt = performance.now()
        admitted.push(id)
      }
    }
    // run the OLDEST non-done admitted request (admission order = the policy's order)
    const active = admitted
      .map((id) => byId.get(id))
      .find((s): s is RealReqState => !!s && (s.status === 'admitted' || s.status === 'generating'))
    if (!active) {
      // scheduler admitted nothing new and nothing is in flight — nudge: admit the oldest queued
      const oldest = states.find((s) => s.status === 'queued')
      if (!oldest) break
      oldest.status = 'admitted'
      oldest.admittedAt = performance.now()
      admitted.push(oldest.spec.id)
      continue
    }

    const chosen = active
    const spec = chosen.spec
    chosen.status = 'generating'
    const want = Math.min(spec.maxNew, chosen.tokens + QUANTUM_TOKENS)
    const out = await gen([{ role: 'user', content: spec.prompt }], {
      max_new_tokens: want,
      do_sample: false,
    })
    const text = out?.[0]?.generated_text?.at(-1)?.content ?? ''
    const newTokens = Math.max(chosen.tokens, Math.min(spec.maxNew, want)) // regenerate = same target; tokens = want
    if (chosen.firstTokenAt === undefined && newTokens > 0) chosen.firstTokenAt = performance.now()
    chosen.tokens = newTokens
    chosen.text = text
    onUpdate(states)
    if (chosen.tokens >= spec.maxNew || /<\|im_end\|>/.test(text)) {
      chosen.status = 'done'
      chosen.doneAt = performance.now()
    }
  }

  const doneStates = states.filter((s) => s.doneAt !== undefined)
  const ttfts = doneStates.map((s) => (s.firstTokenAt ?? 0) - (s.admittedAt ?? 0))
  const totalMs = performance.now() - t0
  const totalTokens = doneStates.reduce((a, s) => a + s.tokens, 0)
  return {
    avgTtftMs: ttfts.length ? Math.round(ttfts.reduce((a, b) => a + b, 0) / ttfts.length) : 0,
    tokPerSec: Math.round((totalTokens / (totalMs / 1000)) * 10) / 10,
    totalMs: Math.round(totalMs),
    preemptions,
  }
}
