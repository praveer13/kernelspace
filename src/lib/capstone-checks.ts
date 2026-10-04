/**
 * capstone-checks.ts — Capstone Zero step 5 (KV cache): template, reference
 * solution, harness and checks as a pure module. No React, no DOM, so
 * scripts/verify-capstone.ts can run the checks under bun against the
 * reference solution and against known mutants (PLAN-100X §5.5 F7).
 *
 * The learner writes the cache append. forwardStep computes a token's K/V
 * and logits but deliberately does not store the K/V; the harness meters
 * every call, so the checks inspect the learner's own cache and measure
 * speedup from the learner's own decodeCached.
 */

import {
  TOY_MODEL,
  TOKENIZER,
  EOS_ID,
  FLOPS_PER_MS,
  tokenize,
  detokenize,
  scriptIdsFor,
  greedyDecode,
  forwardAll,
  forwardCached,
  createCache,
  forwardFlops,
  cachedStepFlops,
  matvec,
  dot,
  softmax,
  geluVec,
  argmax,
  percentile,
  SAMPLE_PROMPTS,
} from '../components/sims/engine-core'
import type { KVCacheState, Model } from '../components/sims/engine-core'

export interface CheckSpec {
  id: string
  label: string
  /** null = pass, string = failure message */
  run: (api: Record<string, unknown>, code: string) => string | null
}

export const noTodo = (code: string) =>
  code.includes('TODO(you)') ? 'one or more // TODO(you) slots are still open' : null

export const eq = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

export const SAMPLE_SCRIPT_IDS = scriptIdsFor(SAMPLE_PROMPTS[0].script)
export const SAMPLE_PROMPT_IDS = tokenize(SAMPLE_PROMPTS[0].text)
export const REF_DECODE = greedyDecode(TOY_MODEL, SAMPLE_PROMPT_IDS, {
  useCache: false,
  scriptIds: SAMPLE_SCRIPT_IDS,
  maxTokens: SAMPLE_SCRIPT_IDS.length,
})

/** Minimum speedup over the naive decode for the step to pass. */
export const MIN_SPEEDUP = 10

/* ------------------------------------------------------------------ */
/* Metered harness                                                     */
/* ------------------------------------------------------------------ */

interface LayerKV {
  k: number[]
  v: number[]
}

interface StepCall {
  id: number
  cache: KVCacheState
  /** [k0, v0, k1, v1, ...] row counts the cache held when the call began */
  lens: number[]
  flops: number
}

interface Meter {
  caches: KVCacheState[]
  calls: StepCall[]
  /** calls.length at the first argmax: everything before it is prefill */
  decodeFrom: number | null
}

const cacheLens = (cache: KVCacheState) => cache.layers.flatMap((l) => [l.k.length, l.v.length])

/** Compute one token's K/V and logits over the cached prefix; storing is the learner's job. */
function forwardStep(model: Model, id: number, cache: KVCacheState) {
  const scratch: KVCacheState = {
    layers: cache.layers.map((l) => ({ k: [...l.k], v: [...l.v] })),
  }
  const { logits } = forwardCached(model, id, scratch)
  const kv: LayerKV[] = scratch.layers.map((l, li) => ({
    k: l.k[cache.layers[li].k.length],
    v: l.v[cache.layers[li].v.length],
  }))
  return { logits, kv }
}

const meters = new WeakMap<object, Meter>()

/** Run learner code with a lib that records caches, step calls and flops. */
export function runStep5Harness(code: string): Record<string, unknown> {
  const meter: Meter = { caches: [], calls: [], decodeFrom: null }
  const lib = {
    EOS_ID,
    model: TOY_MODEL,
    createCache: (model: Model) => {
      const cache = createCache(model)
      meter.caches.push(cache)
      return cache
    },
    forwardStep: (model: Model, id: number, cache: KVCacheState) => {
      meter.calls.push({
        id,
        cache,
        lens: cacheLens(cache),
        flops: cachedStepFlops(model, (cache.layers[0]?.k.length ?? 0) + 1),
      })
      return forwardStep(model, id, cache)
    },
    forwardAll: (model: Model, ids: number[]) => {
      meter.calls.push({
        id: -1,
        cache: createCache(model),
        lens: [],
        flops: forwardFlops(model, ids.length),
      })
      return forwardAll(model, ids)
    },
    argmax: (xs: number[]) => {
      meter.decodeFrom ??= meter.calls.length
      return argmax(xs)
    },
    scriptIds: SAMPLE_SCRIPT_IDS,
    promptIds: SAMPLE_PROMPT_IDS,
    // shared helpers, same as the other steps
    TOKENIZER,
    tokenize,
    detokenize,
    matvec,
    dot,
    softmax,
    geluVec,
    percentile,
  }
  const factory = new Function('lib', `"use strict";\n${code}`) as (
    lib: unknown,
  ) => Record<string, unknown>
  const api = factory(lib)
  if (typeof api === 'object' && api !== null) meters.set(api, meter)
  return api
}

interface Observation {
  out: number[]
  calls: StepCall[]
  /** the cache the learner built, or null if it never called forwardStep */
  cache: KVCacheState | null
  finalLens: number[]
  /** mean simulated ms per decode step, from the flops the learner's calls cost */
  decodeMs: number
}

/** Run the learner's decodeCached once and read back what it did to its cache. */
function observe(api: Record<string, unknown>, promptIds: number[], maxTokens: number): Observation {
  const meter = meters.get(api)
  if (!meter) throw new Error('harness must return { decodeCached } from runStep5Harness')
  const decodeCached = api.decodeCached as ((ids: number[], n: number) => number[]) | undefined
  if (typeof decodeCached !== 'function') throw new Error('your code must return { decodeCached }')
  meter.caches.length = 0
  meter.calls.length = 0
  meter.decodeFrom = null
  const out = decodeCached(promptIds, maxTokens)
  const calls = [...meter.calls]
  const cache = calls.find((c) => c.lens.length > 0)?.cache ?? null
  const decode = meter.decodeFrom == null ? [] : calls.slice(meter.decodeFrom)
  const decodeMs =
    decode.length === 0
      ? Infinity
      : decode.reduce((a, c) => a + c.flops, 0) / decode.length / FLOPS_PER_MS
  return { out, calls, cache, finalLens: cache ? cacheLens(cache) : [], decodeMs }
}

/** Rebuild the reference cache for the ids the learner fed through forwardStep. */
function referenceCache(ids: number[]): KVCacheState {
  const cache = createCache(TOY_MODEL)
  for (const id of ids) forwardCached(TOY_MODEL, id, cache)
  return cache
}

/** Mean naive inter-token latency from the reference naive decode. */
const naiveMs = REF_DECODE.tokens.reduce((a, t) => a + t.itlMs, 0) / REF_DECODE.tokens.length

/* ------------------------------------------------------------------ */
/* Template, reference solution, hint ladder                           */
/* ------------------------------------------------------------------ */

export const STEP5_TEMPLATE = `// STEP 5 — greedy decode with a KV cache
const { model, createCache, forwardStep, argmax, EOS_ID, scriptIds } = lib
// forwardStep(model, id, cache) attends over the cached prefix plus this token
// and returns { logits, kv }. kv[li] = { k, v } is the NEW token's K/V row for
// layer li. It does NOT store them: the cache append is yours to write.

function appendKV(cache, kv) {
  // TODO(you): push every layer's new k row and v row onto
  // cache.layers[li].k / cache.layers[li].v, one position per token.
}

function decodeCached(promptIds, maxTokens) {
  const cache = createCache(model)
  const out = []
  let logits = null
  for (const id of promptIds) {
    const step = forwardStep(model, id, cache) // prefill
    appendKV(cache, step.kv)
    logits = step.logits
  }
  for (let t = 0; t < maxTokens; t++) {
    const biased = [...logits]
    if (t < scriptIds.length) biased[scriptIds[t]] += 1000
    const next = argmax(biased)
    out.push(next)
    if (next === EOS_ID) break
    const step = forwardStep(model, next, cache)
    appendKV(cache, step.kv)
    logits = step.logits
  }
  return out
}
return { decodeCached }`

/** Reference solution: used by scripts/verify-capstone.ts only, never shown to the learner. */
export const STEP5_REFERENCE_SOLUTION = STEP5_TEMPLATE.replace(
  `  // TODO(you): push every layer's new k row and v row onto
  // cache.layers[li].k / cache.layers[li].v, one position per token.
`,
  `  kv.forEach((row, li) => {
    cache.layers[li].k.push(row.k)
    cache.layers[li].v.push(row.v)
  })
`,
)

/** Three rungs, each more specific; none is the full solution. */
export const STEP5_HINTS: [string, string, string] = [
  'Concept: a token\'s K and V never change once computed, and every later step attends over all of them. forwardStep computes the new row but does not keep it, so without your append the next step sees a cache that is one token short.',
  'Where to look: appendKV. forwardStep hands it one new key row and one new value row for every layer, and the cache keeps a growing list of each per layer. Prefill goes through appendKV too, so no layer may be skipped.',
  'Shape: per token, every layer\'s cache gets exactly one k entry and one v entry, during prefill too. Fewer leaves a layer short; more shifts every later position.',
]

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

export const STEP5_CHECKS: CheckSpec[] = [
  { id: 'todos', label: 'all TODO slots filled', run: (_api, code) => noTodo(code) },
  {
    id: 'bitwise',
    label: 'bitwise-identical output to the naive loop',
    run: (api) => {
      const o = observe(api, SAMPLE_PROMPT_IDS, SAMPLE_SCRIPT_IDS.length)
      const ref = REF_DECODE.tokens.map((t) => t.id)
      if (!eq(o.out, ref)) return 'cached output differs from naive — prefixes must be independent'
      // the scripted bias can mask a bad cache, so compare the stored K/V rows too
      if (!o.cache) return 'no cache was filled — call forwardStep and append its kv'
      const want = referenceCache(o.calls.map((c) => c.id))
      for (let li = 0; li < want.layers.length; li++) {
        for (const key of ['k', 'v'] as const) {
          const got = o.cache.layers[li][key]
          const exp = want.layers[li][key]
          if (got.length !== exp.length) {
            return `layer ${li} ${key}: ${got.length} cached positions, want ${exp.length}`
          }
          const bad = exp.findIndex((row, p) => !eq(got[p] ?? [], row))
          if (bad !== -1) return `layer ${li} ${key} row ${bad} differs from the reference`
        }
      }
      return null
    },
  },
  {
    id: 'accounting',
    label: `cache grows exactly 1 position per appended token`,
    run: (api) => {
      const o = observe(api, [2, 3, 4], 5)
      if (o.calls.length === 0 || !o.cache) return 'no forwardStep calls — nothing was cached'
      if (o.calls.some((c) => c.cache !== o.cache)) return 'use one cache for the whole sequence'
      const lens = [...o.calls.map((c) => c.lens), o.finalLens]
      if (lens[0].some((n) => n !== 0)) return 'the cache must start empty'
      for (let i = 0; i + 1 < lens.length; i++) {
        for (let j = 0; j < lens[i].length; j++) {
          if (lens[i + 1][j] - lens[i][j] !== 1) {
            return `after token ${i + 1}, layer ${j >> 1} ${j % 2 ? 'v' : 'k'} grew by ${lens[i + 1][j] - lens[i][j]}, want 1`
          }
        }
      }
      return null
    },
  },
  {
    id: 'speedup',
    label: `measured speedup ≥ ${MIN_SPEEDUP}× over the naive decode`,
    run: (api) => {
      const o = observe(api, SAMPLE_PROMPT_IDS, SAMPLE_SCRIPT_IDS.length)
      if (!Number.isFinite(o.decodeMs)) return 'no decode steps ran'
      const x = naiveMs / Math.max(1e-9, o.decodeMs)
      return x >= MIN_SPEEDUP ? null : `only ${x.toFixed(1)}× — your decodeCached must reuse the cache`
    },
  },
]
