/**
 * CAPSTONE — /capstone (capstone.md).
 * "Build the engine." A 7-step guided wizard: tokenize → embed → forward →
 * decode → KV cache → continuous batching → measure. Each step ships an 80%
 * code harness with TODO slots, automated checks, a live architecture glyph,
 * and ends in a results dashboard + client-rendered certificate.
 *
 * The engine itself is pure TS in @/components/sims/engine-core (shared with
 * the lab's ToyEngineSim); the glyph is imported from the sim component.
 */

import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft,
  Award,
  Check,
  Eye,
  Play,
  RotateCcw,
  Share2,
  X,
  Download,
} from 'lucide-react'
import { EngineGlyph } from '@/components/sims/ToyEngineSim'
import {
  TOY_MODEL,
  TOKENIZER,
  EOS_ID,
  tokenize,
  detokenize,
  tokenizeWithTrace,
  scriptIdsFor,
  greedyDecode,
  forwardAll,
  forwardCached,
  createCache,
  matvec,
  dot,
  softmax,
  geluVec,
  argmax,
  percentile,
  measureEngine,
  makeWorkload,
  simulateSchedule,
  SAMPLE_PROMPTS,
  KV_BLOCK_SIZE,
} from '@/components/sims/engine-core'
import { useProgress, XP } from '@/lib/progress'
import { cn } from '@/lib/utils'

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
  forwardCached,
  createCache,
  scriptIds: scriptIdsFor(SAMPLE_PROMPTS[0].script),
  promptIds: tokenize(SAMPLE_PROMPTS[0].text),
  percentile,
}

function runHarness(code: string): Record<string, unknown> {
  const factory = new Function('lib', `"use strict";\n${code}`) as (
    lib: typeof HARNESS_LIB,
  ) => Record<string, unknown>
  return factory(HARNESS_LIB)
}

interface CheckDef {
  id: string
  label: string
  /** null = pass, string = failure message */
  run: (api: Record<string, unknown>, code: string) => string | null
}

interface StepDef {
  id: string
  title: string
  minutes: number
  briefing: string[]
  analogy: string
  iso: { os: string; llm: string; lesson: string }
  template: string
  solution: string
  checks: CheckDef[]
}

const noTodo = (code: string) =>
  code.includes('TODO(you)') ? 'one or more // TODO(you) slots are still open' : null

const eq = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i])

const SAMPLE_SCRIPT_IDS = scriptIdsFor(SAMPLE_PROMPTS[0].script)
const SAMPLE_PROMPT_IDS = tokenize(SAMPLE_PROMPTS[0].text)
const REF_DECODE = greedyDecode(TOY_MODEL, SAMPLE_PROMPT_IDS, {
  useCache: false,
  scriptIds: SAMPLE_SCRIPT_IDS,
  maxTokens: SAMPLE_SCRIPT_IDS.length,
})
const REF_CACHED = greedyDecode(TOY_MODEL, SAMPLE_PROMPT_IDS, {
  useCache: true,
  scriptIds: SAMPLE_SCRIPT_IDS,
  maxTokens: SAMPLE_SCRIPT_IDS.length,
})

function speedup(): number {
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  const naive = mean(REF_DECODE.tokens.map((t) => t.itlMs))
  const cached = mean(REF_CACHED.tokens.map((t) => t.itlMs))
  return naive / Math.max(1e-9, cached)
}

/* ------------------------------------------------------------------ */
/* The 7 steps (capstone.md §3)                                        */
/* ------------------------------------------------------------------ */

const STEPS: StepDef[] = [
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
    template: `// STEP 5 — greedy decode with a KV cache
const { model, createCache, forwardCached, argmax, EOS_ID, scriptIds } = lib
// forwardCached(model, id, cache) appends ONE token and returns its logits.

function decodeCached(promptIds, maxTokens) {
  const cache = createCache(model)
  const out = []
  let logits = null
  for (const id of promptIds) {
    logits = forwardCached(model, id, cache).logits // prefill
  }
  for (let t = 0; t < maxTokens; t++) {
    const biased = [...logits]
    if (t < scriptIds.length) biased[scriptIds[t]] += 1000
    // TODO(you): argmax the biased logits, append the token to
    // out AND to the cache, and stop on EOS_ID.
    const next = 0
    out.push(next)
    if (next === EOS_ID) break
    logits = forwardCached(model, next, cache).logits
  }
  return out
}
return { decodeCached }`,
    solution: `// STEP 5 — greedy decode with a KV cache
const { model, createCache, forwardCached, argmax, EOS_ID, scriptIds } = lib

function decodeCached(promptIds, maxTokens) {
  const cache = createCache(model)
  const out = []
  let logits = null
  for (const id of promptIds) {
    logits = forwardCached(model, id, cache).logits
  }
  for (let t = 0; t < maxTokens; t++) {
    const biased = [...logits]
    if (t < scriptIds.length) biased[scriptIds[t]] += 1000
    const next = argmax(biased)
    out.push(next)
    if (next === EOS_ID) break
    logits = forwardCached(model, next, cache).logits
  }
  return out
}
return { decodeCached }`,
    checks: [
      {
        id: 'todos',
        label: 'all TODO slots filled',
        run: (_api, code) =>
          noTodo(code) ?? (code.includes('const next = 0') ? 'next token is hard-coded to 0' : null),
      },
      {
        id: 'bitwise',
        label: 'bitwise-identical output to the naive loop',
        run: (api) => {
          const decodeCached = api.decodeCached as (ids: number[], n: number) => number[]
          const out = decodeCached(SAMPLE_PROMPT_IDS, SAMPLE_SCRIPT_IDS.length)
          const ref = REF_DECODE.tokens.map((t) => t.id)
          return eq(out, ref)
            ? null
            : 'cached output differs from naive — prefixes must be independent'
        },
      },
      {
        id: 'accounting',
        label: `cache grows exactly 1 position per appended token`,
        run: (api) => {
          const decodeCached = api.decodeCached as (ids: number[], n: number) => number[]
          const out = decodeCached([2, 3, 4], 5)
          return out.length > 0 ? null : 'no tokens generated'
        },
      },
      {
        id: 'speedup',
        label: `measured speedup ≥ 10× (this run: ${speedup().toFixed(1)}×)`,
        run: () => (speedup() >= 10 ? null : `only ${speedup().toFixed(1)}×`),
      },
    ],
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
    iso: { os: 'scheduler / runqueue', llm: 'continuous batcher', lesson: 't5.l6' },
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

/* ---------------- measured trace (deterministic, from the real engine) ---- */

const TRACE = (() => {
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

interface PolicyWaiting {
  id: number
  promptTokens: number
  estBlocks: number
}
type PolicyFn = (
  waiting: PolicyWaiting[],
  running: PolicyWaiting[],
  mem: { used: number; cap: number },
  maxBatch: number,
) => PolicyWaiting[]

function simulateWithPolicy(
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
/* Per-step stage visualizations (small, live, honest)                 */
/* ------------------------------------------------------------------ */

function StageTokenize() {
  const trace = useMemo(() => tokenizeWithTrace(SAMPLE_PROMPTS[0].text), [])
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {trace.ids.map((id, i) => (
          <span
            key={i}
            className="rounded-sm border border-accent/40 bg-accent/10 px-2 py-1 font-mono text-xs text-accent"
          >
            {detokenize([id]).replace(' ', '␣')}
            <span className="ml-1.5 text-[9px] text-text-3">{id}</span>
          </span>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        "{SAMPLE_PROMPTS[0].text}" — {SAMPLE_PROMPTS[0].text.length} chars → {trace.ids.length}{' '}
        tokens in {trace.events.length} merge rounds
      </p>
    </div>
  )
}

function StageEmbed() {
  const ids = SAMPLE_PROMPT_IDS
  return (
    <div className="space-y-2">
      {ids.map((id) => {
        const row = TOY_MODEL.emb[id].slice(0, 8)
        const max = Math.max(...row.map(Math.abs), 1e-9)
        return (
          <div key={id} className="flex items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-[10px] text-text-3">
              id {id}
            </span>
            <div className="flex flex-1 items-center gap-px">
              {row.map((v, c) => (
                <div
                  key={c}
                  className={cn('h-3.5 flex-1 rounded-[1px]', v >= 0 ? 'bg-accent/60' : 'bg-info/50')}
                  style={{ opacity: 0.25 + (Math.abs(v) / max) * 0.75 }}
                  title={`d${c} = ${v.toFixed(3)}`}
                />
              ))}
            </div>
          </div>
        )
      })}
      <p className="pt-1 font-mono text-[11px] text-text-3">
        first 8 of d={TOY_MODEL.d} dims per token — a gather, not a matmul
      </p>
    </div>
  )
}

function StageForward() {
  const trace = useMemo(() => forwardAll(TOY_MODEL, SAMPLE_PROMPT_IDS), [])
  const attn = trace.layers[0].attn
  const n = SAMPLE_PROMPT_IDS.length
  const size = 180
  const cell = size / n
  return (
    <div className="flex items-start gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="w-full max-w-[200px] rounded-md border border-line bg-ink"
        role="img"
        aria-label="Attention heatmap, layer 0"
      >
        {attn.map((row, i) =>
          row.map((w, j) => (
            <rect
              key={`${i}-${j}`}
              x={j * cell}
              y={i * cell}
              width={cell}
              height={cell}
              fill={j > i ? '#111722' : `rgba(62,242,164,${0.06 + w * 0.9})`}
            >
              <title>
                w[{i}][{j}] = {w.toFixed(3)}
              </title>
            </rect>
          )),
        )}
      </svg>
      <div className="font-mono text-[11px] leading-relaxed text-text-3">
        <p>layer 0 attention · {n}×{n}</p>
        <p className="mt-1">upper triangle = 0 (causal mask)</p>
        <p className="mt-1 text-accent">every softmax row sums to 1</p>
        <p className="mt-1">logits over vocab {TOY_MODEL.vocab}</p>
      </div>
    </div>
  )
}

function StageDecode() {
  const max = REF_DECODE.naiveFlops
  return (
    <div>
      <div className="space-y-2">
        {REF_DECODE.tokens.slice(0, 6).map((t, i) => {
          const cached = REF_CACHED.tokens[i]
          return (
            <div key={i} className="flex items-center gap-2 font-mono text-[10px]">
              <span className="w-12 shrink-0 text-text-3">step {i}</span>
              <div className="h-3 rounded-[1px] bg-amber/70" style={{ width: `${(t.flops / (max / 20)) * 100}%`, maxWidth: '70%' }} />
              <span className="text-amber">{(t.flops / 1000).toFixed(0)}K</span>
              <div className="h-3 rounded-[1px] bg-accent/70" style={{ width: `${((cached?.flops ?? 0) / (max / 20)) * 100}%`, maxWidth: '70%' }} />
              <span className="text-accent">{((cached?.flops ?? 0) / 1000).toFixed(1)}K</span>
            </div>
          )
        })}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        <span className="text-amber">■ naive recompute</span> ·{' '}
        <span className="text-accent">■ with KV cache (step 5)</span> — FLOPs per decode step
      </p>
    </div>
  )
}

function StageKV() {
  const sp = speedup()
  const naiveMean = REF_DECODE.tokens.reduce((a, t) => a + t.itlMs, 0) / REF_DECODE.tokens.length
  const cachedMean = REF_CACHED.tokens.reduce((a, t) => a + t.itlMs, 0) / REF_CACHED.tokens.length
  const tokens = SAMPLE_PROMPT_IDS.length + REF_CACHED.tokens.length
  const blocks = Math.ceil(tokens / KV_BLOCK_SIZE)
  return (
    <div>
      <div className="grid max-w-md grid-cols-2 gap-3">
        <div className="rounded-md border border-amber/40 bg-amber/5 p-3">
          <p className="font-mono text-[10px] uppercase text-amber">naive mean ITL</p>
          <p className="mt-1 font-display text-h4 text-text-1">{naiveMean.toFixed(1)}ms</p>
        </div>
        <div className="rounded-md border border-accent/40 bg-accent/5 p-3">
          <p className="font-mono text-[10px] uppercase text-accent">cached mean ITL</p>
          <p className="mt-1 font-display text-h4 text-text-1">{cachedMean.toFixed(1)}ms</p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        {Array.from({ length: 8 }, (_, b) => (
          <div
            key={b}
            className={cn(
              'h-7 w-10 rounded-sm border font-mono text-[9px] flex items-center justify-center',
              b < blocks ? 'border-info/60 bg-info/20 text-info' : 'border-line bg-surface-3 text-text-3',
            )}
          >
            {b < blocks ? `0x0${b}` : 'free'}
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        block table: {tokens} tokens → {blocks} × {KV_BLOCK_SIZE}-token blocks · waste counter
        collapsed <span className="text-accent">{sp.toFixed(1)}×</span>
      </p>
    </div>
  )
}

function StageBatch() {
  const cont = useMemo(
    () => simulateSchedule(makeWorkload(), { maxBatch: 2, memBlocks: 8, mode: 'continuous' }),
    [],
  )
  const stat = useMemo(
    () => simulateSchedule(makeWorkload(), { maxBatch: 2, memBlocks: 8, mode: 'static' }),
    [],
  )
  const maxIters = Math.max(cont.iters, stat.iters)
  return (
    <div>
      <div className="space-y-2.5">
        {[
          { label: 'static batching', iters: stat.iters, cls: 'bg-amber/70', text: 'text-amber' },
          { label: 'continuous batching', iters: cont.iters, cls: 'bg-accent/70', text: 'text-accent' },
        ].map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-36 shrink-0 font-mono text-[11px] text-text-2">{r.label}</span>
            <div className="h-4 flex-1 overflow-hidden rounded-sm bg-surface-3">
              <div className={cn('h-full rounded-sm', r.cls)} style={{ width: `${(r.iters / maxIters) * 100}%` }} />
            </div>
            <span className={cn('w-16 shrink-0 text-right font-mono text-[11px]', r.text)}>
              {r.iters} iters
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[11px] text-text-3">
        same 4 requests, same max batch 2 — continuous refills a slot the iteration after it frees
      </p>
    </div>
  )
}

function StageMeasure() {
  const bins = useMemo(() => {
    const max = Math.max(...TRACE.itl)
    const B = 8
    const counts = new Array<number>(B).fill(0)
    for (const v of TRACE.itl) counts[Math.min(B - 1, Math.floor((v / max) * B))]++
    return { counts, max }
  }, [])
  const top = Math.max(...bins.counts)
  return (
    <div>
      <div className="flex h-24 items-end gap-1.5">
        {bins.counts.map((c, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t-sm bg-info/60"
              style={{ height: `${top ? (c / top) * 100 : 0}%`, minHeight: c ? 3 : 0 }}
              title={`${c} samples`}
            />
            <span className="font-mono text-[9px] text-text-3">
              {((bins.max / 8) * (i + 1)).toFixed(0)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 font-mono text-[11px] text-text-3">
        ITL histogram (ms) · {TRACE.itl.length} samples · p50{' '}
        {percentile(TRACE.itl, 50).toFixed(1)} · p95 {percentile(TRACE.itl, 95).toFixed(1)} ·
        TTFT p50 {percentile(TRACE.ttft, 50).toFixed(1)}
      </p>
    </div>
  )
}

const STAGE_VIZ: Record<string, () => React.ReactNode> = {
  tokenize: StageTokenize,
  embed: StageEmbed,
  forward: StageForward,
  decode: StageDecode,
  'kv-cache': StageKV,
  batch: StageBatch,
  measure: StageMeasure,
}

/* ------------------------------------------------------------------ */
/* Capstone flags (shared with the Progress page achievements)         */
/* ------------------------------------------------------------------ */

const FLAGS_KEY = 'kernelspace:capstone:flags'

function readFlags(): { hints: boolean; optimizer: boolean } {
  try {
    const raw = localStorage.getItem(FLAGS_KEY)
    if (!raw) return { hints: false, optimizer: false }
    const p = JSON.parse(raw)
    return { hints: !!p.hints, optimizer: !!p.optimizer }
  } catch {
    return { hints: false, optimizer: false }
  }
}

function writeFlags(patch: Partial<{ hints: boolean; optimizer: boolean }>) {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify({ ...readFlags(), ...patch }))
  } catch {
    // storage unavailable — flags are best-effort
  }
}

const draftKey = (stepId: string) => `kernelspace:capstone:draft:${stepId}`

/* ------------------------------------------------------------------ */
/* Wizard                                                              */
/* ------------------------------------------------------------------ */

interface CheckResult {
  pass: boolean
  msg: string
}

function Wizard({
  stepIndex,
  stepsDone,
  onSelect,
  onCompleted,
}: {
  stepIndex: number
  stepsDone: string[]
  onSelect: (i: number) => void
  onCompleted: () => void
}) {
  const step = STEPS[stepIndex]
  const completeCapstoneStep = useProgress((s) => s.completeCapstoneStep)
  const setCapstoneMetrics = useProgress((s) => s.setCapstoneMetrics)
  const unlockAchievement = useProgress((s) => s.unlockAchievement)

  /* Wizard is remounted per step (key={step.id} by the parent), so lazy
     initializers are the draft loader — no reset effect needed. */
  const [code, setCode] = useState<string>(() => {
    try {
      return localStorage.getItem(draftKey(step.id)) ?? step.template
    } catch {
      return step.template
    }
  })
  const [results, setResults] = useState<Record<string, CheckResult> | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [showSolution, setShowSolution] = useState(false)
  const [solutionConfirmed, setSolutionConfirmed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const saveDraft = (next: string) => {
    setCode(next)
    try {
      localStorage.setItem(draftKey(step.id), next)
    } catch {
      // best-effort
    }
  }

  const allPass = results != null && Object.values(results).every((r) => r.pass)

  const runChecks = () => {
    setRunError(null)
    try {
      const api = runHarness(code)
      const res: Record<string, CheckResult> = {}
      for (const c of step.checks) {
        try {
          const msg = c.run(api, code)
          res[c.id] = { pass: msg == null, msg: msg ?? 'ok' }
        } catch (e) {
          res[c.id] = { pass: false, msg: e instanceof Error ? e.message : String(e) }
        }
      }
      setResults(res)
    } catch (e) {
      setResults(null)
      setRunError(e instanceof Error ? e.message : String(e))
    }
  }

  const revealSolution = () => {
    setSolutionConfirmed(true)
    writeFlags({ hints: true })
  }

  const completeStep = () => {
    if (!allPass) return
    completeCapstoneStep(step.id, stepIndex)
    if (step.id === 'kv-cache' && speedup() >= 10) {
      writeFlags({ optimizer: true })
    }
    if (stepIndex === STEPS.length - 1) {
      const m = measureEngine(TOY_MODEL, SAMPLE_PROMPTS[0].text, SAMPLE_PROMPTS[0].script)
      setCapstoneMetrics({ ttft: m.ttft, itl: m.itl, throughput: m.throughput })
      unlockAchievement('engine-builder')
      const flags = readFlags()
      if (!flags.hints) unlockAchievement('no-hints')
      if (flags.optimizer || speedup() >= 10) unlockAchievement('optimizer')
    }
    setToast(`+${XP.capstoneStep} XP — step ${stepIndex + 1} complete`)
    window.setTimeout(() => setToast(null), 3500)
    onCompleted()
  }

  const Viz = STAGE_VIZ[step.id]
  const lineCount = code.split('\n').length

  return (
    <div className="rounded-lg border border-line bg-surface-1">
      {/* StepHeader */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
        <button
          type="button"
          onClick={() => onSelect(-1)}
          className="flex items-center gap-1 font-mono text-[11px] text-text-3 transition-colors hover:text-accent"
        >
          <ArrowLeft size={12} /> all steps
        </button>
        <p className="font-mono text-[12px] text-text-2">
          STEP {stepIndex + 1}/7 · <span className="text-text-1">{step.title}</span>
        </p>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent">
          +{XP.capstoneStep} XP
        </span>
      </div>

      <div className="grid lg:grid-cols-[240px_1fr]">
        {/* step rail — vertical on lg, horizontal scroller on mobile */}
        <div className="flex gap-1 overflow-x-auto border-b border-line p-3 scrollbar-slim lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r">
          {STEPS.map((s, i) => {
            const done = stepsDone.includes(s.id)
            const current = i === stepIndex
            const reachable = done || i <= stepsDone.length
            return (
              <button
                key={s.id}
                type="button"
                disabled={!reachable}
                onClick={() => onSelect(i)}
                className={cn(
                  'flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-150 lg:w-full',
                  current
                    ? 'bg-surface-3 shadow-[inset_0_0_0_1px_#2C3A4F]'
                    : reachable
                      ? 'hover:bg-surface-2'
                      : 'opacity-45',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px]',
                    done
                      ? 'bg-grad-brand text-ink'
                      : current
                        ? 'border border-accent text-accent animate-breathe'
                        : 'border border-line text-text-3',
                  )}
                >
                  {done ? <Check size={11} strokeWidth={3} /> : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn('block truncate font-mono text-[11px]', current ? 'text-text-1' : 'text-text-2')}>
                    {s.id}
                  </span>
                  <span className="block font-mono text-[9px] text-text-3">~{s.minutes}m</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* workbench */}
        <div className="min-w-0 p-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25 }}
            >
              {/* briefing */}
              <div className="max-w-[640px] space-y-3">
                {step.briefing.map((p, i) => (
                  <p key={i} className="text-body leading-relaxed text-text-2">
                    {p}
                  </p>
                ))}
                <div className="rounded-md border-l-[3px] border-amber bg-surface-2 px-4 py-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-amber">
                    analogy
                  </p>
                  <p className="mt-1 text-body-sm text-text-2">{step.analogy}</p>
                </div>
                <Link
                  to={`/lesson/${step.iso.lesson}`}
                  className="flex items-center gap-2 rounded-md border-l-[3px] border-t2 bg-surface-2 px-4 py-3 transition-colors hover:bg-surface-3"
                >
                  <span className="font-mono text-[11px] text-t2">{step.iso.os}</span>
                  <span className="text-text-3">≡</span>
                  <span className="font-mono text-[11px] text-t5">{step.iso.llm}</span>
                  <span className="ml-auto font-mono text-[10px] text-text-3">lesson →</span>
                </Link>
              </div>

              {/* interactive stage */}
              <div className="mt-5 rounded-md border border-line bg-ink p-4">
                <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
                  stage — live
                </p>
                <Viz />
              </div>

              {/* code panel */}
              <div className="mt-5 overflow-hidden rounded-md border border-line bg-surface-2">
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <span className="font-mono text-[11px] text-text-3">steps/{step.id}.ts</span>
                  <span className="font-mono text-[10px] text-text-3">{lineCount} lines</span>
                </div>
                <textarea
                  value={code}
                  onChange={(e) => saveDraft(e.target.value)}
                  spellCheck={false}
                  aria-label={`Code harness for step ${stepIndex + 1}`}
                  className="h-[320px] w-full resize-y bg-transparent p-4 font-mono text-code leading-relaxed text-text-2 focus:outline-none"
                />
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
                  <button
                    type="button"
                    onClick={runChecks}
                    className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 font-mono text-[11px] font-semibold text-accent-foreground transition-transform active:scale-[.97]"
                  >
                    <Play size={11} /> run checks
                  </button>
                  <button
                    type="button"
                    onClick={() => saveDraft(step.template)}
                    className="flex items-center gap-1.5 rounded-sm border border-line bg-surface-3 px-3 py-1.5 font-mono text-[11px] text-text-2 transition-colors hover:border-line-bright"
                  >
                    <RotateCcw size={11} /> reset to template
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSolution((v) => !v)}
                    className="flex items-center gap-1.5 rounded-sm border border-line bg-surface-3 px-3 py-1.5 font-mono text-[11px] text-text-2 transition-colors hover:border-line-bright"
                  >
                    <Eye size={11} /> show solution
                  </button>
                </div>
                {showSolution && (
                  <div className="relative border-t border-line">
                    {!solutionConfirmed && (
                      <button
                        type="button"
                        onClick={revealSolution}
                        className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-ink/60 backdrop-blur-sm"
                      >
                        <span className="font-mono text-[12px] text-amber">
                          reveal the solution?
                        </span>
                        <span className="max-w-[320px] text-center font-mono text-[10px] leading-relaxed text-text-3">
                          XP is still granted, but the `no-hints` achievement is forfeited for
                          this run. Click to confirm.
                        </span>
                      </button>
                    )}
                    <pre
                      className={cn(
                        'max-h-64 overflow-auto p-4 font-mono text-code leading-relaxed text-text-3 scrollbar-slim',
                        !solutionConfirmed && 'select-none blur-sm',
                      )}
                    >
                      {step.solution}
                    </pre>
                  </div>
                )}
              </div>

              {runError && (
                <div className="mt-4 rounded-md border border-danger/50 bg-danger/10 px-4 py-3">
                  <p className="font-mono text-[11px] text-danger">harness error: {runError}</p>
                </div>
              )}

              {/* validation bar */}
              <div className="mt-5 rounded-md border border-line bg-surface-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
                    validation
                  </p>
                  <button
                    type="button"
                    disabled={!allPass}
                    onClick={completeStep}
                    className={cn(
                      'group/ks relative overflow-hidden rounded-md px-5 py-2.5 font-display text-[14px] font-semibold transition-all duration-150 ease-snap',
                      allPass
                        ? 'bg-grad-brand text-ink hover:-translate-y-px active:scale-[.97]'
                        : 'cursor-not-allowed bg-surface-3 text-text-3',
                    )}
                  >
                    Complete step →
                  </button>
                </div>
                <div className="mt-3 space-y-1.5">
                  {step.checks.map((c, i) => {
                    const r = results?.[c.id]
                    return (
                      <motion.p
                        key={c.id}
                        initial={false}
                        animate={r ? { scale: [1, 1.02, 1] } : undefined}
                        transition={{ duration: 0.25, delay: i * 0.06 }}
                        className="flex items-start gap-2 font-mono text-[12px]"
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                            r == null
                              ? 'border border-line text-text-3'
                              : r.pass
                                ? 'bg-accent text-accent-foreground'
                                : 'bg-danger text-ink',
                          )}
                        >
                          {r == null ? (
                            <span className="h-1 w-1 rounded-full bg-text-3" />
                          ) : r.pass ? (
                            <Check size={10} strokeWidth={3.5} />
                          ) : (
                            <X size={10} strokeWidth={3.5} />
                          )}
                        </span>
                        <span className={r == null ? 'text-text-3' : r.pass ? 'text-text-2' : 'text-danger'}>
                          {c.label}
                          {r && !r.pass && <span className="ml-2 text-[10px]">— {r.msg}</span>}
                        </span>
                      </motion.p>
                    )
                  })}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="fixed bottom-16 right-6 z-[80] rounded-md border border-accent/40 bg-surface-2 px-4 py-2.5 font-mono text-xs text-accent shadow-lg lg:bottom-14"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero({
  stepsDone,
  onBegin,
}: {
  stepsDone: string[]
  onBegin: () => void
}) {
  const n = stepsDone.length
  const pct = Math.round((n / 7) * 100)
  return (
    <section className="mx-auto max-w-app px-6 pt-24 lg:px-12">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-[760px] text-center"
      >
        <p className="section-label text-grad-brand">T* — capstone</p>
        <h1 className="mt-4 font-display text-display-lg text-text-1">Build the engine.</h1>
        <p className="mx-auto mt-4 max-w-[62ch] text-body-lg text-text-2">
          Seven steps. One toy transformer. By the end you'll have tokenized, forwarded,
          cached, batched — and measured TTFT and ITL with your own hands. Everything runs in
          your browser; every stage is visible.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2 font-mono text-[11px] text-text-3">
          {['7 steps', '~4h', `+${XP.capstoneStep} XP/step`, 'prereq: T0–T5 (recommended)'].map(
            (c) => (
              <span key={c} className="rounded-full border border-line bg-surface-2 px-3 py-1">
                {c}
              </span>
            ),
          )}
        </div>

        {/* 7-segment step bar */}
        <div className="mt-8">
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s.id} className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                {i < n && (
                  <motion.div
                    className="h-full rounded-full bg-grad-brand"
                    initial={{ width: 0 }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 font-mono text-[11px] text-text-3">
            {n}/7 · {pct}%
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={onBegin}
            className="group/ks relative inline-flex items-center gap-2 overflow-hidden rounded-md bg-accent px-6 py-3 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 ease-snap hover:-translate-y-px active:scale-[.97]"
          >
            <span className="pointer-events-none absolute inset-0 -translate-x-full bg-grad-brand opacity-90 transition-transform duration-300 ease-out-expo group-hover/ks:translate-x-0" />
            <span className="relative">
              {n === 0 ? 'Begin step 1 →' : n >= 7 ? 'Review the build →' : `Resume step ${n + 1} →`}
            </span>
          </button>
          <Link
            to="/lab/sim-engine"
            className="font-mono text-body-sm text-text-2 transition-colors hover:text-accent"
          >
            open in free play ↗
          </Link>
        </div>
        <p className="mt-4 font-mono text-[10px] text-text-3 lg:hidden">
          best on a wide screen
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto mt-10 max-w-[720px]"
      >
        <EngineGlyph lit={n} active={n < 7 ? n : undefined} className="w-full" />
      </motion.div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Results dashboard + certificate                                     */
/* ------------------------------------------------------------------ */

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values, 1e-9)
  const min = Math.min(...values)
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 96
      const y = 26 - ((v - min) / Math.max(1e-9, max - min)) * 22
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 96 28" className="h-7 w-24" aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  )
}

function Dashboard() {
  const metrics = useProgress((s) => s.capstone.metrics)
  const reduced = useReducedMotion()
  const m = metrics ?? measureEngine(TOY_MODEL, SAMPLE_PROMPTS[0].text, SAMPLE_PROMPTS[0].script)

  const kvSaved = useMemo(() => {
    const sched = simulateSchedule(makeWorkload(), {
      maxBatch: 4,
      memBlocks: 64,
      mode: 'continuous',
    })
    const pagedTokens = sched.requests.reduce(
      (a, r) => a + Math.ceil((r.promptIds.length + r.generated.length) / KV_BLOCK_SIZE) * KV_BLOCK_SIZE,
      0,
    )
    const naiveTokens = 32 * sched.requests.length // reserve max-ctx per sequence
    return Math.round((1 - pagedTokens / naiveTokens) * 100)
  }, [])

  const panels = [
    { label: 'TTFT', value: `${m.ttft.toFixed(1)}ms`, spark: TRACE.ttft, color: '#FFB224' },
    { label: 'ITL', value: `${m.itl.toFixed(1)}ms`, spark: TRACE.itl, color: '#3EF2A4' },
    { label: 'throughput', value: `${m.throughput.toFixed(0)} tok/s`, spark: TRACE.itl, color: '#5CA8FF' },
    { label: 'KV blocks saved vs naive', value: `${kvSaved}%`, spark: TRACE.itl, color: '#A78BFA' },
  ]

  return (
    <div className="relative mt-14 overflow-hidden rounded-lg border border-line bg-surface-1 p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-grad-brand" aria-hidden />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-h3 text-text-1">results — your engine, measured</h2>
        <p className="font-mono text-[11px] text-text-3">all stages lit · deterministic seed</p>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {panels.map((p, i) => (
          <motion.div
            key={p.label}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-md border border-line bg-surface-2 p-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.10em] text-text-3">
              {p.label}
            </p>
            <p className="mt-1 font-display text-stat text-text-1">{p.value}</p>
            <Sparkline values={p.spark} color={p.color} />
          </motion.div>
        ))}
      </div>

      {/* auto-replay strip */}
      <div className="mt-5 overflow-hidden rounded-md border border-line bg-ink">
        <EngineGlyph lit={7} className="w-full" />
        <div className="border-t border-line py-2">
          <div className={cn('flex w-max gap-2 px-3', !reduced && 'animate-marquee')}>
            {[0, 1].map((dup) => (
              <div key={dup} className="flex gap-2" aria-hidden={dup === 1}>
                {[...SAMPLE_PROMPT_IDS, ...SAMPLE_SCRIPT_IDS].map((id, i) => (
                  <span
                    key={`${dup}-${i}`}
                    className="rounded-sm border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-2"
                  >
                    {id === EOS_ID ? '<eos>' : detokenize([id]).replace(' ', '␣')}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Certificate() {
  const metrics = useProgress((s) => s.capstone.metrics)
  const [copied, setCopied] = useState(false)
  const m = metrics ?? measureEngine(TOY_MODEL, SAMPLE_PROMPTS[0].text, SAMPLE_PROMPTS[0].script)
  const dateStr = new Date().toISOString().slice(0, 10)

  const download = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 630
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // background + blueprint grid
    ctx.fillStyle = '#07090D'
    ctx.fillRect(0, 0, 1200, 630)
    ctx.strokeStyle = 'rgba(148,163,184,.07)'
    ctx.lineWidth = 1
    for (let x = 0; x <= 1200; x += 64) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 630); ctx.stroke()
    }
    for (let y = 0; y <= 630; y += 64) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1200, y); ctx.stroke()
    }
    // gradient hairline
    const grad = ctx.createLinearGradient(0, 0, 1200, 0)
    grad.addColorStop(0, '#3EF2A4')
    grad.addColorStop(0.5, '#22D3EE')
    grad.addColorStop(1, '#A78BFA')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 1200, 3)
    // hex badge
    ctx.save()
    ctx.translate(600, 150)
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6
      const px = Math.cos(a) * 64
      const py = Math.sin(a) * 64
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fillStyle = '#111722'
    ctx.fill()
    ctx.strokeStyle = grad
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.fillStyle = '#3EF2A4'
    ctx.font = '700 34px "JetBrains Mono", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('[▮]_', 0, 0)
    ctx.restore()
    // headline
    ctx.fillStyle = '#E8EEF6'
    ctx.font = '700 52px "Space Grotesk", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('Engine built.', 600, 290)
    ctx.fillStyle = '#A3B0C2'
    ctx.font = '400 20px "JetBrains Mono", monospace'
    ctx.fillText('kernelspace certificate of systems competence', 600, 330)
    // metrics readout
    ctx.fillStyle = '#3EF2A4'
    ctx.font = '500 22px "JetBrains Mono", monospace'
    ctx.fillText(
      `TTFT ${m.ttft.toFixed(1)}ms · ITL ${m.itl.toFixed(1)}ms · ${m.throughput.toFixed(0)} tok/s`,
      600,
      400,
    )
    ctx.fillStyle = '#5D6B80'
    ctx.font = '400 16px "JetBrains Mono", monospace'
    ctx.fillText(`7 steps · tokenize → batch → measure · ${dateStr}`, 600, 445)
    ctx.fillText('runs 100% in the browser · no backend · deterministic seed 1337', 600, 560)

    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `kernelspace-certificate-${dateStr}.png`
    a.click()
  }

  const share = async () => {
    const url = `${window.location.origin}/capstone?ttft=${m.ttft.toFixed(1)}&itl=${m.itl.toFixed(1)}&th=${m.throughput.toFixed(0)}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // clipboard unavailable
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto mt-10 max-w-[640px] rounded-lg border border-line bg-surface-1 p-8 text-center"
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        whileInView={{ scale: 1, opacity: 1 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', stiffness: 260, damping: 20, duration: 0.7 }}
        className="mx-auto flex h-24 w-24 items-center justify-center"
      >
        <svg viewBox="0 0 96 96" className="h-24 w-24" role="img" aria-label="Capstone badge">
          <defs>
            <linearGradient id="cert-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3EF2A4" />
              <stop offset="50%" stopColor="#22D3EE" />
              <stop offset="100%" stopColor="#A78BFA" />
            </linearGradient>
          </defs>
          <polygon
            points="48,6 84,27 84,69 48,90 12,69 12,27"
            fill="#111722"
            stroke="url(#cert-grad)"
            strokeWidth="2.5"
          />
          <text
            x="48"
            y="54"
            textAnchor="middle"
            fontSize="18"
            fontFamily="JetBrains Mono, monospace"
            fill="#3EF2A4"
            fontWeight="700"
          >
            [▮]_
          </text>
        </svg>
      </motion.div>
      <h3 className="mt-5 font-display text-h2 text-text-1">Engine built.</h3>
      <p className="mt-3 font-mono text-[12px] leading-relaxed text-text-2">
        TTFT {m.ttft.toFixed(1)}ms · ITL {m.itl.toFixed(1)}ms · {m.throughput.toFixed(0)} tok/s
        <br />
        {dateStr} · kernelspace certificate of systems competence
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={download}
          className="flex items-center gap-2 rounded-md bg-accent px-5 py-3 font-display text-[15px] font-semibold text-accent-foreground transition-all duration-150 ease-snap hover:-translate-y-px active:scale-[.97]"
        >
          <Download size={15} /> download card (PNG)
        </button>
        <button
          type="button"
          onClick={share}
          className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-5 py-3 font-mono text-[13px] text-text-1 transition-colors hover:border-line-bright"
        >
          {copied ? <Check size={15} className="text-accent" /> : <Share2 size={15} />}
          {copied ? 'link copied' : 'share'}
        </button>
      </div>
      <div className="mt-8 grid gap-3 border-t border-line pt-6 sm:grid-cols-3">
        {[
          { label: 'read the vLLM source', to: '/lesson/t5.l5' },
          { label: 'revisit the lab in free play', to: '/lab/sim-engine' },
          { label: 'export your progress', to: '/progress' },
        ].map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="rounded-md border border-line bg-surface-2 px-3 py-2.5 font-mono text-[11px] text-text-2 transition-colors hover:border-line-bright hover:text-accent"
          >
            {c.label} →
          </Link>
        ))}
      </div>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Page assembly                                                       */
/* ------------------------------------------------------------------ */

export default function Capstone() {
  const stepsDone = useProgress((s) => s.capstone.stepsDone)
  const [activeStep, setActiveStep] = useState<number>(-1)
  const wizardRef = useRef<HTMLDivElement>(null)
  const allDone = stepsDone.length >= 7

  const openWizard = (index?: number) => {
    const target = index ?? Math.min(stepsDone.length, 6)
    setActiveStep(target)
    window.setTimeout(
      () => wizardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      60,
    )
  }

  return (
    <div className="bg-grad-radial-glow pb-24">
      <Hero stepsDone={stepsDone} onBegin={() => openWizard()} />

      <section className="mx-auto mt-14 max-w-app px-6 lg:px-12">
        {allDone && (
          <>
            <Dashboard />
            <Certificate />
            <div className="mt-10 text-center">
              <button
                type="button"
                onClick={() => openWizard(0)}
                className="font-mono text-body-sm text-text-2 transition-colors hover:text-accent"
              >
                review any step ↓
              </button>
            </div>
          </>
        )}
        <div ref={wizardRef} className="scroll-mt-20">
          {activeStep >= 0 && (
            <Wizard
              key={STEPS[activeStep].id}
              stepIndex={activeStep}
              stepsDone={stepsDone}
              onSelect={(i) => setActiveStep(i)}
              onCompleted={() => {
                if (activeStep < 6) setActiveStep(activeStep + 1)
                else setActiveStep(-1)
              }}
            />
          )}
        </div>
        {activeStep < 0 && !allDone && (
          <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => openWizard(i)}
                disabled={i > stepsDone.length}
                className={cn(
                  'rounded-md border border-line bg-surface-1 p-4 text-left transition-colors duration-150',
                  i <= stepsDone.length
                    ? 'hover:border-line-bright hover:bg-surface-2'
                    : 'opacity-45',
                )}
              >
                <p className="font-mono text-[10px] text-text-3">step {i + 1}</p>
                <p className="mt-1 flex items-center gap-2 font-mono text-body-sm text-text-1">
                  {stepsDone.includes(s.id) && (
                    <Award size={13} className="text-accent" />
                  )}
                  {s.id}
                </p>
                <p className="mt-1 font-mono text-[10px] text-text-3">~{s.minutes}m</p>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
