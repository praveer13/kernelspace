/**
 * capstone/steps.ts — Capstone Zero's seven steps as data: briefings, templates,
 * solutions, hints and the checks that grade them (spec wave-1 §14.1).
 *
 * Pure: no React, no DOM. The page imports it for labels and stages; the
 * sandboxed worker (src/workers/capstone.worker.ts) imports it to run learner
 * code, and scripts/verify-capstone.ts runs every step's checks under Bun.
 * Nothing here calls a harness on the main thread: runStepJob is for the worker
 * and for verify-capstone only, and the page's chunk never contains it (the
 * meta CSP has no 'unsafe-eval', §14.2).
 */

import {
  TOY_MODEL,
  TOKENIZER,
  EOS_ID,
  tokenize,
  detokenize,
  scriptIdsFor,
  greedyDecode,
  forwardAll,
  matvec,
  dot,
  softmax,
  geluVec,
  argmax,
  percentile,
  makeWorkload,
  simulateSchedule,
  SAMPLE_PROMPTS,
  KV_BLOCK_SIZE,
} from '../../components/sims/engine-core'
import {
  STEP5_CHECKS,
  STEP5_HINTS,
  STEP5_TEMPLATE,
  REF_DECODE,
  SAMPLE_PROMPT_IDS,
  SAMPLE_SCRIPT_IDS,
  eq,
  noTodo,
  runStep5Harness,
  step5Speedup,
} from '../capstone-checks'
import type { CheckSpec } from '../capstone-checks'

/* ------------------------------------------------------------------ */
/* Harness: run learner code against the reference engine              */
/* ------------------------------------------------------------------ */

const HARNESS_LIB = {
  TOKENIZER,
  EOS_ID,
  model: TOY_MODEL,
  tokenize,
  detokenize,
  matvec,
  dot,
  softmax,
  geluVec,
  argmax,
  forwardAll,
  // own copies: learner code may mutate lib, and the checks read SAMPLE_*_IDS
  scriptIds: scriptIdsFor(SAMPLE_PROMPTS[0].script),
  promptIds: tokenize(SAMPLE_PROMPTS[0].text),
  percentile,
}

/** Learner code becomes a function of `lib`. Only the sandbox worker and verify-capstone call this. */
function runHarness(code: string): Record<string, unknown> {
  const factory = new Function('lib', `"use strict";\n${code}`) as (
    lib: typeof HARNESS_LIB,
  ) => Record<string, unknown>
  return factory(HARNESS_LIB)
}

export type CheckDef = CheckSpec

export interface StepDef {
  id: string
  title: string
  /** nominal minutes; XP pays these for `cap:<step>` (spec §8.4, economy-table) */
  minutes: number
  briefing: string[]
  analogy: string
  iso: { os: string; llm: string; lesson: string }
  template: string
  /** full solution reveal; steps with `hints` use the ladder instead */
  solution?: string
  /** three rungs: concept, where to look, a pseudo-fragment; never the full solution */
  hints?: [string, string, string]
  /**
   * How runStepJob runs learner code: by default as a function of HARNESS_LIB;
   * 'metered' is step 5's harness, which records every cache and step call.
   * A tag, not a function, so importing STEPS never pulls `new Function` into the page.
   */
  harness?: 'metered'
  /** numbers measured from the learner's own code after the checks (step 5: speedup) */
  metrics?: (api: Record<string, unknown>) => Record<string, number>
  checks: CheckDef[]
}

export const REF_CACHED = greedyDecode(TOY_MODEL, SAMPLE_PROMPT_IDS, {
  useCache: true,
  scriptIds: SAMPLE_SCRIPT_IDS,
  maxTokens: SAMPLE_SCRIPT_IDS.length,
})

/** The reference engine's speedup, for the stage and dashboard only; step 5 grades the learner's own code. */
export function referenceSpeedup(): number {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const naive = mean(REF_DECODE.tokens.map((t) => t.itlMs))
  const cached = mean(REF_CACHED.tokens.map((t) => t.itlMs))
  return naive / Math.max(1e-9, cached)
}

/* ---------------- measured trace (deterministic, from the real engine) ---- */

export const TRACE = (() => {
  const ttft: number[] = []
  const itl: number[] = []
  for (const p of SAMPLE_PROMPTS) {
    const res = greedyDecode(TOY_MODEL, tokenize(p.text), {
      useCache: true,
      scriptIds: scriptIdsFor(p.script),
      maxTokens: scriptIdsFor(p.script).length,
    })
    ttft.push(res.ttftMs)
    for (const t of res.tokens) if (t.id !== EOS_ID) itl.push(t.itlMs)
  }
  return { ttft, itl }
})()

/* ---------------- step-6 harness: run the learner's admission policy ------- */

export interface PolicyWaiting {
  id: number
  promptTokens: number
  estBlocks: number
}
export type PolicyFn = (
  waiting: PolicyWaiting[],
  running: PolicyWaiting[],
  mem: { used: number; cap: number },
  maxBatch: number,
) => PolicyWaiting[]

export function simulateWithPolicy(
  admit: PolicyFn,
  cfg: { maxBatch: number; memBlocks: number },
): {
  maxBatchRespected: boolean
  memRespected: boolean
  allDone: boolean
  iters: number
  outputsMatchSolo: boolean
} {
  const reqs = makeWorkload().map((r) => ({
    id: r.id,
    promptTokens: r.promptIds.length,
    scriptIds: r.scriptIds,
    estBlocks: Math.ceil(r.promptIds.length / KV_BLOCK_SIZE) + 1,
    arrived: r.admittedAt,
    generated: 0,
    state: 'waiting' as 'waiting' | 'running' | 'done',
  }))
  let maxBatchRespected = true
  let memRespected = true
  const maxIters = 200
  let iter = 0
  for (iter = 0; iter < maxIters; iter++) {
    const running = reqs.filter((r) => r.state === 'running')
    const waiting = reqs.filter((r) => r.state === 'waiting' && r.arrived <= iter)
    const used = running.reduce((a, r) => a + r.estBlocks, 0)
    const chosen = admit(
      waiting.map((w) => ({ id: w.id, promptTokens: w.promptTokens, estBlocks: w.estBlocks })),
      running.map((r) => ({ id: r.id, promptTokens: r.promptTokens, estBlocks: r.estBlocks })),
      { used, cap: cfg.memBlocks },
      cfg.maxBatch,
    )
    let newUsed = used
    for (const c of chosen) {
      const req = reqs.find((r) => r.id === c.id && r.state === 'waiting')
      if (!req) continue
      req.state = 'running'
      running.push(req)
      newUsed += req.estBlocks
    }
    if (running.length > cfg.maxBatch) maxBatchRespected = false
    if (newUsed > cfg.memBlocks) memRespected = false
    for (const r of [...running]) {
      r.generated++
      if (r.generated >= r.scriptIds.length) {
        r.state = 'done'
        running.splice(running.indexOf(r), 1)
      }
    }
    if (reqs.every((r) => r.state === 'done')) break
  }
  const allDone = reqs.every((r) => r.state === 'done')
  // Outputs are the scripted continuations — identical to solo by construction
  // as long as every request completed its full script.
  const solo = simulateSchedule(makeWorkload(), {
    maxBatch: 4,
    memBlocks: 64,
    mode: 'continuous',
  })
  const outputsMatchSolo =
    allDone &&
    reqs.every((r) => {
      const s = solo.requests.find((x) => x.id === r.id)
      return s != null && eq(r.scriptIds, s.scriptIds)
    })
  return { maxBatchRespected, memRespected, allDone, iters: iter + 1, outputsMatchSolo }
}

/* ------------------------------------------------------------------ */
/* The 7 steps (capstone.md §3)                                        */
/* ------------------------------------------------------------------ */

export const STEPS: StepDef[] = [
  {
    id: 'tokenize',
    title: 'Tokenizer',
    minutes: 30,
    briefing: [
      'Before anything is a tensor, it is bytes. Your engine starts with a byte-pair tokenizer over a tiny trained vocab: 95 printable characters plus ~70 learned merges.',
      'The algorithm is a loop: walk the merge table in priority order; for each merge, scan the id stream left→right and fuse every adjacent pair. Rounds animate in the stage above — watch "hello world" collapse from 11 ids to 2.',
    ],
    analogy: "You've seen this in the JVM: javac turning source text into a token stream before anything becomes bytecode. BPE is the same front-end, except the 'keywords' were learned from data.",
    iso: { os: 'lexer / scanner', llm: 'BPE tokenizer', lesson: 't5.l2' },
    template: `// STEP 1 — tokenizer (BPE on a tiny trained vocab)
const { TOKENIZER } = lib
// TOKENIZER.merges = [{ a, b, out, str }] in priority order.

function encode(text) {
  let ids = []
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    ids.push(c >= 32 && c <= 126 ? c - 30 : 1) // id 1 = <unk>
  }
  // TODO(you): walk TOKENIZER.merges in order; for each merge,
  // scan ids left→right and fuse every adjacent (a, b) pair into \`out\`.
  return ids
}
return { encode }`,
    solution: `// STEP 1 — tokenizer (BPE on a tiny trained vocab)
const { TOKENIZER } = lib

function encode(text) {
  let ids = []
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    ids.push(c >= 32 && c <= 126 ? c - 30 : 1)
  }
  for (const m of TOKENIZER.merges) {
    let i = 0
    while (i < ids.length - 1) {
      if (ids[i] === m.a && ids[i + 1] === m.b) {
        ids = [...ids.slice(0, i), m.out, ...ids.slice(i + 2)]
      } else {
        i++
      }
    }
  }
  return ids
}
return { encode }`,
    checks: [
      { id: 'todos', label: 'all TODO slots filled', run: (_api, code) => noTodo(code) },
      {
        id: 'roundtrip',
        label: 'round-trips "hello world"',
        run: (api) => {
          const encode = api.encode as (t: string) => number[]
          const text = detokenize(encode('hello world'))
          return text === 'hello world' ? null : `got "${text}"`
        },
      },
      {
        id: 'stable',
        label: 'id stability — tokenize("the") matches reference',
        run: (api) => {
          const encode = api.encode as (t: string) => number[]
          return eq(encode('the'), tokenize('the'))
            ? null
            : `got [${encode('the').join(', ')}], want [${tokenize('the').join(', ')}]`
        },
      },
      {
        id: 'merges',
        label: 'merges applied — "the" fuses into 1 token',
        run: (api) => {
          const encode = api.encode as (t: string) => number[]
          return encode('the').length === 1 ? null : `got ${encode('the').length} tokens`
        },
      },
    ],
  },
  {
    id: 'embed',
    title: 'Embeddings',
    minutes: 25,
    briefing: [
      'Token ids are arbitrary integers; the model needs geometry. The embedding table is a vocab × d matrix — one learned row per token — and "embedding a sequence" is just a gather: one row lookup per id.',
      'No multiplication happens here. A lookup table is the cheapest layer in the whole engine, which is exactly why it maps to a concept you already know: a page table is also "just" an indexed gather.',
    ],
    analogy: 'This is HashMap#get with the hash precomputed. Same O(1), same cache behavior — a gather is a gather, whether it hits an L1 line or HBM.',
    iso: { os: 'indexed table lookup', llm: 'embedding gather', lesson: 't0.l3' },
    template: `// STEP 2 — embedding lookup (a gather, not a matmul)
const { model } = lib
// model.emb[vocab][d] — one learned row per token.

function embed(ids) {
  // TODO(you): return one row per id (copy the row, don't alias it).
  return []
}
return { embed }`,
    solution: `// STEP 2 — embedding lookup (a gather, not a matmul)
const { model } = lib

function embed(ids) {
  return ids.map((id) => [...model.emb[id]])
}
return { embed }`,
    checks: [
      { id: 'todos', label: 'all TODO slots filled', run: (_api, code) => noTodo(code) },
      {
        id: 'shape',
        label: `shape [n, ${TOY_MODEL.d}] for a 4-token input`,
        run: (api) => {
          const embed = api.embed as (ids: number[]) => number[][]
          const out = embed([2, 3, 4, 5])
          return out.length === 4 && out.every((r) => r.length === TOY_MODEL.d)
            ? null
            : `got ${out.length}×${out[0]?.length ?? 0}`
        },
      },
      {
        id: 'deterministic',
        label: 'deterministic lookup — same ids, same rows',
        run: (api) => {
          const embed = api.embed as (ids: number[]) => number[][]
          return JSON.stringify(embed([7, 8])) === JSON.stringify(embed([7, 8]))
            ? null
            : 'two calls returned different values'
        },
      },
      {
        id: 'table',
        label: 'row matches the embedding table exactly',
        run: (api) => {
          const embed = api.embed as (ids: number[]) => number[][]
          const row = embed([5])[0]
          return row && eq(row, TOY_MODEL.emb[5]) ? null : 'row 5 differs from model.emb[5]'
        },
      },
    ],
  },
  {
    id: 'forward',
    title: 'Forward pass',
    minutes: 45,
    briefing: [
      `Now the real machine: ${TOY_MODEL.nLayers} transformer blocks, d=${TOY_MODEL.d}, single-head causal attention, GELU FFN, logits tied to the embedding matrix. Every intermediate is visible — the stage shows the attention weight matrix as a heatmap.`,
      'The causal mask is the whole trick: position i may only attend to j ≤ i. That one inequality is what makes KV caching (step 5) bitwise-safe, because every prefix is independent of the future.',
    ],
    analogy: 'Tiling matmuls you met in T4 — this is the same arithmetic, just smaller: small enough that you can watch every weight land.',
    iso: { os: 'cache blocking', llm: 'attention over tiles', lesson: 't5.l1' },
    template: `// STEP 3 — forward pass: 2 blocks, single-head causal attention
const { model, matvec, dot, softmax, geluVec } = lib

function forward(ids) {
  let x = ids.map((id) => [...model.emb[id]])
  const d = model.d
  for (const layer of model.layers) {
    const q = x.map((xi) => matvec(xi, layer.Wq))
    const k = x.map((xi) => matvec(xi, layer.Wk))
    const v = x.map((xi) => matvec(xi, layer.Wv))
    const out = []
    for (let i = 0; i < ids.length; i++) {
      const scores = []
      for (let j = 0; j <= i; j++) {
        // TODO(you): scaled dot-product attention score —
        // push dot(q[i], k[j]) divided by Math.sqrt(d)
        scores.push(0)
      }
      const p = softmax(scores)
      const o = new Array(d).fill(0)
      for (let j = 0; j <= i; j++)
        for (let c = 0; c < d; c++) o[c] += p[j] * v[j][c]
      out.push(o)
    }
    const proj = out.map((o) => matvec(o, layer.Wo))
    const res = x.map((xi, i) => xi.map((val, c) => val + proj[i][c]))
    const ffn = res.map((xi) => matvec(geluVec(matvec(xi, layer.W1)), layer.W2))
    x = res.map((xi, i) => xi.map((val, c) => val + ffn[i][c]))
  }
  const last = x[x.length - 1]
  const logits = model.emb.map((e) => dot(last, e))
  return { logits }
}
return { forward }`,
    solution: `// STEP 3 — forward pass: 2 blocks, single-head causal attention
const { model, matvec, dot, softmax, geluVec } = lib

function forward(ids) {
  let x = ids.map((id) => [...model.emb[id]])
  const d = model.d
  for (const layer of model.layers) {
    const q = x.map((xi) => matvec(xi, layer.Wq))
    const k = x.map((xi) => matvec(xi, layer.Wk))
    const v = x.map((xi) => matvec(xi, layer.Wv))
    const out = []
    for (let i = 0; i < ids.length; i++) {
      const scores = []
      for (let j = 0; j <= i; j++) {
        scores.push(dot(q[i], k[j]) / Math.sqrt(d))
      }
      const p = softmax(scores)
      const o = new Array(d).fill(0)
      for (let j = 0; j <= i; j++)
        for (let c = 0; c < d; c++) o[c] += p[j] * v[j][c]
      out.push(o)
    }
    const proj = out.map((o) => matvec(o, layer.Wo))
    const res = x.map((xi, i) => xi.map((val, c) => val + proj[i][c]))
    const ffn = res.map((xi) => matvec(geluVec(matvec(xi, layer.W1)), layer.W2))
    x = res.map((xi, i) => xi.map((val, c) => val + ffn[i][c]))
  }
  const last = x[x.length - 1]
  const logits = model.emb.map((e) => dot(last, e))
  return { logits }
}
return { forward }`,
    checks: [
      {
        id: 'todos',
        label: 'all TODO slots filled',
        run: (_api, code) =>
          noTodo(code) ?? (code.includes('scores.push(0)') ? 'the attention score is still 0' : null),
      },
      {
        id: 'finite',
        label: `logits shape [${TOY_MODEL.vocab}], all finite`,
        run: (api) => {
          const forward = api.forward as (ids: number[]) => { logits: number[] }
          const { logits } = forward([10, 11, 12])
          return logits.length === TOY_MODEL.vocab && logits.every(Number.isFinite)
            ? null
            : 'logits missing or non-finite'
        },
      },
      {
        id: 'softmax',
        label: 'attention rows are valid distributions (argmax matches reference)',
        run: (api) => {
          const forward = api.forward as (ids: number[]) => { logits: number[] }
          const mine = argmax(forward([10, 11, 12]).logits)
          const ref = argmax(forwardAll(TOY_MODEL, [10, 11, 12]).logits)
          return mine === ref ? null : `argmax ${mine} ≠ reference ${ref} — check the 1/√d scale`
        },
      },
    ],
  },
  {
    id: 'decode',
    title: 'Greedy decode',
    minutes: 35,
    briefing: [
      'Generation is a loop, not a function: forward the whole sequence, take argmax of the last logits, append, repeat until <eos>. This naive version recomputes everything every step — watch the waste counter in the stage.',
      'Greedy decoding is deterministic: same prompt, same tokens, every time. That property is what lets step 5 prove the KV cache correct bitwise.',
    ],
    analogy: 'You already know this loop from every REPL you have used: evaluate, print, feed the output back in. The engine is a REPL where evaluation costs O(n²).',
    iso: { os: 'REPL loop', llm: 'autoregressive decode', lesson: 't5.l3' },
    template: `// STEP 4 — greedy decode loop (naive: full recompute per token)
const { model, forwardAll, argmax, EOS_ID, scriptIds } = lib
// scriptIds biases the toy model so output stays readable:
// add +1000 to logits[scriptIds[t]] before taking argmax.

function decode(promptIds, maxTokens) {
  const ids = [...promptIds]
  const out = []
  for (let t = 0; t < maxTokens; t++) {
    const { logits } = forwardAll(model, ids)
    // TODO(you): apply the script bias, take the argmax,
    // append it, stop on EOS_ID.
    const next = 0
    out.push(next)
    if (next === EOS_ID) break
    ids.push(next)
  }
  return out
}
return { decode }`,
    solution: `// STEP 4 — greedy decode loop (naive: full recompute per token)
const { model, forwardAll, argmax, EOS_ID, scriptIds } = lib

function decode(promptIds, maxTokens) {
  const ids = [...promptIds]
  const out = []
  for (let t = 0; t < maxTokens; t++) {
    const { logits } = forwardAll(model, ids)
    if (t < scriptIds.length) logits[scriptIds[t]] += 1000
    const next = argmax(logits)
    out.push(next)
    if (next === EOS_ID) break
    ids.push(next)
  }
  return out
}
return { decode }`,
    checks: [
      {
        id: 'todos',
        label: 'all TODO slots filled',
        run: (_api, code) =>
          noTodo(code) ?? (code.includes('const next = 0') ? 'next token is hard-coded to 0' : null),
      },
      {
        id: 'deterministic',
        label: 'deterministic — same seed, same tokens',
        run: (api) => {
          const decode = api.decode as (ids: number[], n: number) => number[]
          return eq(decode([2, 3], 8), decode([2, 3], 8)) ? null : 'two runs differ'
        },
      },
      {
        id: 'eos',
        label: 'stops at EOS (no tokens past the stop id)',
        run: (api) => {
          const decode = api.decode as (ids: number[], n: number) => number[]
          const out = decode(SAMPLE_PROMPT_IDS, SAMPLE_SCRIPT_IDS.length)
          const eosAt = out.indexOf(EOS_ID)
          return eosAt === -1 || eosAt === out.length - 1
            ? null
            : 'tokens generated after EOS'
        },
      },
      {
        id: 'refmatch',
        label: 'output matches the reference engine',
        run: (api) => {
          const decode = api.decode as (ids: number[], n: number) => number[]
          const out = decode(SAMPLE_PROMPT_IDS, SAMPLE_SCRIPT_IDS.length)
          const ref = REF_DECODE.tokens.map((t) => t.id)
          return eq(out, ref) ? null : `got [${out.join(',')}], want [${ref.join(',')}]`
        },
      },
    ],
  },
  {
    id: 'kv-cache',
    title: 'KV cache',
    minutes: 40,
    briefing: [
      'The payoff step. Bolt on a per-layer K/V store: each decode step computes K/V for the new token only and attends over the cached prefix. O(n²) recompute becomes O(n) append.',
      'Under the hood the cache is paged: 16-token blocks from a free-list allocator with a per-sequence block table — the allocator you built in T1, repurposed. This is PagedAttention, one toy-scale layer down.',
    ],
    analogy: 'You built this allocator in T1; now it holds KV blocks. malloc with fixed-size blocks never fragments — which is why vLLM wastes <4% instead of 60–80%.',
    iso: { os: 'page table + free list', llm: 'block table + KV allocator', lesson: 't5.l5' },
    template: STEP5_TEMPLATE,
    hints: STEP5_HINTS,
    harness: 'metered',
    metrics: (api) => ({ speedup: step5Speedup(api) }),
    checks: STEP5_CHECKS,
  },
  {
    id: 'batch',
    title: 'Continuous batching',
    minutes: 40,
    briefing: [
      'One sequence is a process; the engine is the OS. Four requests arrive at staggered times, and your admission policy decides who joins the running batch on each iteration — subject to a max batch size and a KV memory cap.',
      'Static batching locks the batch until every sequence finishes (the stragglers waste the GPU alone). Continuous batching refills a slot the iteration after it frees. Same hardware, same requests, very different utilization.',
    ],
    analogy: 'This is the 1962 runqueue with tokens instead of time slices. Admission control is just saying no early enough that the machine never thrashes.',
    iso: { os: 'scheduler / runqueue', llm: 'continuous batcher', lesson: 't5.l7' },
    template: `// STEP 6 — admission policy for the continuous batcher
// The harness calls YOUR function once per iteration:
//   waiting: sequences ready to run  { id, promptTokens, estBlocks }
//   running: sequences in the batch  { id, ... }
//   mem:     { used, cap } in 16-token KV blocks
// Return the array of waiting sequences to admit THIS iteration.

function admit(waiting, running, mem, maxBatch) {
  // TODO(you): admit oldest-first while a slot AND memory remain.
  return []
}
return { admit }`,
    solution: `// STEP 6 — admission policy for the continuous batcher
function admit(waiting, running, mem, maxBatch) {
  const chosen = []
  let used = mem.used
  for (const w of waiting) {
    if (running.length + chosen.length >= maxBatch) break
    if (used + w.estBlocks > mem.cap) break
    chosen.push(w)
    used += w.estBlocks
  }
  return chosen
}
return { admit }`,
    checks: [
      { id: 'todos', label: 'all TODO slots filled', run: (_api, code) => noTodo(code) },
      {
        id: 'maxbatch',
        label: 'max batch size respected on every iteration',
        run: (api) => {
          const admit = api.admit as PolicyFn
          const r = simulateWithPolicy(admit, { maxBatch: 2, memBlocks: 8 })
          return r.maxBatchRespected ? null : 'batch exceeded 2 running sequences'
        },
      },
      {
        id: 'memcap',
        label: 'KV memory cap respected (8 blocks)',
        run: (api) => {
          const admit = api.admit as PolicyFn
          const r = simulateWithPolicy(admit, { maxBatch: 2, memBlocks: 8 })
          return r.memRespected ? null : 'allocated beyond the 8-block cap'
        },
      },
      {
        id: 'starvation',
        label: 'no starvation — all 4 requests finish within 200 iterations',
        run: (api) => {
          const admit = api.admit as PolicyFn
          const r = simulateWithPolicy(admit, { maxBatch: 2, memBlocks: 8 })
          return r.allDone ? null : `stuck after ${r.iters} iterations — admit someone!`
        },
      },
      {
        id: 'identical',
        label: 'outputs identical to solo runs',
        run: (api) => {
          const admit = api.admit as PolicyFn
          const r = simulateWithPolicy(admit, { maxBatch: 2, memBlocks: 8 })
          return r.outputsMatchSolo ? null : 'batched output differs from solo output'
        },
      },
    ],
  },
  {
    id: 'measure',
    title: 'Measure TTFT/ITL',
    minutes: 30,
    briefing: [
      'Last step: instrumentation. The harness has already recorded real traces from your engine — prefill latencies (TTFT) and per-token decode latencies (ITL) across the sample prompts.',
      'Averages lie about tail latency, so you will write the aggregator yourself: nearest-rank percentiles. p50 is the experience most users get; p95 is the experience your SLO is actually about.',
    ],
    analogy: 'This is the latency histogram behind every Grafana panel you have ever squinted at — now you know exactly what the p95 line costs to compute.',
    iso: { os: 'perf / sar counters', llm: 'TTFT & ITL histograms', lesson: 't5.l3' },
    template: `// STEP 7 — percentile aggregation over real traces
// trace = { ttft: number[], itl: number[] } recorded from the engine (ms).

function pct(values, p) {
  // TODO(you): nearest-rank percentile —
  // sort ascending; rank = ceil(p/100 * n); return sorted[rank-1]
  // (clamp rank into [1, n]).
  return 0
}
return { pct }`,
    solution: `// STEP 7 — percentile aggregation over real traces
function pct(values, p) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}
return { pct }`,
    checks: [
      { id: 'todos', label: 'all TODO slots filled', run: (_api, code) => noTodo(code) },
      {
        id: 'p50',
        label: 'p50 of the ITL trace matches reference',
        run: (api) => {
          const pct = api.pct as (v: number[], p: number) => number
          return Math.abs(pct(TRACE.itl, 50) - percentile(TRACE.itl, 50)) < 1e-9
            ? null
            : `got ${pct(TRACE.itl, 50)}, want ${percentile(TRACE.itl, 50)}`
        },
      },
      {
        id: 'p95',
        label: 'p95 of the ITL trace matches reference',
        run: (api) => {
          const pct = api.pct as (v: number[], p: number) => number
          return Math.abs(pct(TRACE.itl, 95) - percentile(TRACE.itl, 95)) < 1e-9
            ? null
            : `got ${pct(TRACE.itl, 95)}, want ${percentile(TRACE.itl, 95)}`
        },
      },
      {
        id: 'edge',
        label: 'edge cases — p0 = min, p100 = max, empty = 0',
        run: (api) => {
          const pct = api.pct as (v: number[], p: number) => number
          const v = [3, 1, 2]
          const ok =
            pct(v, 0) === 1 && pct(v, 100) === 3 && pct([], 50) === 0
          return ok ? null : 'boundary behavior differs'
        },
      },
    ],
  },
]

export const stepById = (id: string): StepDef | undefined => STEPS.find((s) => s.id === id)

/* ------------------------------------------------------------------ */
/* One graded run: the sandbox worker's job, and verify-capstone's     */
/* ------------------------------------------------------------------ */

export interface CheckResult {
  pass: boolean
  msg: string
}

/** What a run sends back across the sandbox: structured-clone data only. */
export interface StepRunReply {
  stepId: string
  /** the harness itself failed: a syntax error, a top-level throw */
  error: string | null
  results: Record<string, CheckResult>
  /** finite numbers measured from the learner's own code (step 5: `speedup`) */
  metrics: Record<string, number>
}

/** A learner can throw anything, including objects whose toString throws. */
function describe(e: unknown): string {
  try {
    return String(e instanceof Error ? e.message : e)
  } catch {
    return 'threw a value that cannot be printed'
  }
}

/**
 * Run learner code for one step and grade it. This executes untrusted code, so
 * only the sandbox worker and verify-capstone (under Bun) call it.
 */
export function runStepJob(stepId: string, code: string): StepRunReply {
  const step = stepById(stepId)
  if (!step) return { stepId, error: `unknown step "${stepId}"`, results: {}, metrics: {} }
  let api: Record<string, unknown>
  try {
    api = step.harness === 'metered' ? runStep5Harness(code) : runHarness(code)
  } catch (e) {
    return { stepId, error: describe(e), results: {}, metrics: {} }
  }
  const results: Record<string, CheckResult> = {}
  for (const c of step.checks) {
    try {
      const msg = c.run(api, code)
      results[c.id] = msg == null ? { pass: true, msg: 'ok' } : { pass: false, msg: describe(msg) }
    } catch (e) {
      results[c.id] = { pass: false, msg: describe(e) }
    }
  }
  const metrics: Record<string, number> = {}
  if (step.metrics) {
    try {
      for (const [k, v] of Object.entries(step.metrics(api))) if (Number.isFinite(v)) metrics[k] = v
    } catch {
      // a number the learner's code cannot produce is left out
    }
  }
  return { stepId, error: null, results, metrics }
}
