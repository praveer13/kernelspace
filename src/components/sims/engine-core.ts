/**
 * engine-core.ts — a deterministic toy inference engine in pure TypeScript.
 *
 * Shared by ToyEngineSim (lab free play) and the Capstone wizard harness.
 * Everything is a pure function of (seed, inputs): no Math.random, no Date,
 * no DOM. The UI is a renderer over these state machines (playground.md §12).
 *
 * Pipeline: tokenize → embed → forward → greedy decode → KV cache →
 * continuous batching → TTFT/ITL measurement.
 */

/* ---------------- deterministic PRNG ---------------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------------- tokenizer (tiny BPE) ---------------- */

export const EOS_ID = 0
export const UNK_ID = 1
const CHAR_BASE = 2 // id = charCode - 32 + CHAR_BASE for printable ASCII 32..126

/** [left, right, merged] — resolved to ids at module init, order = priority. */
const MERGE_DEFS: [string, string, string][] = [
  ['t', 'h', 'th'],
  ['h', 'e', 'he'],
  ['i', 'n', 'in'],
  ['in', 'g', 'ing'],
  ['o', 'n', 'on'],
  ['i', 'on', 'ion'],
  ['e', 'r', 'er'],
  ['a', 'n', 'an'],
  ['an', 'd', 'and'],
  ['th', 'e', 'the'],
  [' ', 't', ' t'],
  [' t', 'h', ' th'],
  [' th', 'e', ' the'],
  ['l', 'l', 'll'],
  ['ll', 'o', 'llo'],
  ['he', 'llo', 'hello'],
  [' ', 'w', ' w'],
  ['w', 'o', 'wo'],
  ['wo', 'r', 'wor'],
  ['l', 'd', 'ld'],
  ['wor', 'ld', 'world'],
  ['c', 'a', 'ca'],
  ['c', 'he', 'che'],
  ['ca', 'che', 'cache'],
  [' ', 'c', ' c'],
  [' c', 'a', ' ca'],
  [' ca', 'che', ' cache'],
  ['k', 'v', 'kv'],
  [' ', 'k', ' k'],
  [' k', 'v', ' kv'],
  ['e', 'n', 'en'],
  ['k', 'en', 'ken'],
  ['t', 'o', 'to'],
  ['to', 'ken', 'token'],
  ['token', 's', 'tokens'],
  ['b', 'a', 'ba'],
  ['ba', 't', 'bat'],
  ['c', 'h', 'ch'],
  ['bat', 'ch', 'batch'],
  [' ', 'b', ' b'],
  [' b', 'a', ' ba'],
  [' ba', 't', ' bat'],
  [' bat', 'ch', ' batch'],
  ['p', 'r', 'pr'],
  ['pr', 'o', 'pro'],
  ['p', 't', 'pt'],
  ['m', 'pt', 'mpt'],
  ['pro', 'mpt', 'prompt'],
  [' ', 'p', ' p'],
  [' p', 'r', ' pr'],
  [' pr', 'o', ' pro'],
  [' pro', 'mpt', ' prompt'],
  ['p', 'u', 'pu'],
  ['g', 'pu', 'gpu'],
  [' ', 'g', ' g'],
  [' g', 'pu', ' gpu'],
  ['d', 'e', 'de'],
  ['c', 'o', 'co'],
  ['co', 'de', 'code'],
  ['de', 'code', 'decode'],
  [' ', 'd', ' d'],
  [' d', 'e', ' de'],
  [' de', 'code', ' decode'],
  ['s', ' ', 's '],
  ['e', ' ', 'e '],
  ['the', ' ', 'the '],
  ['a', ' ', 'a '],
  ['r', 'e', 're'],
  ['re', 'a', 'rea'],
]

export interface Merge {
  a: number
  b: number
  out: number
  str: string
}

export interface TokenizerTables {
  idToTok: string[]
  tokToId: Map<string, number>
  merges: Merge[]
}

function buildTokenizer(): TokenizerTables {
  const idToTok: string[] = ['<eos>', '<unk>']
  for (let c = 32; c <= 126; c++) idToTok.push(String.fromCharCode(c))
  const tokToId = new Map<string, number>(idToTok.map((t, i) => [t, i]))
  const merges: Merge[] = []
  for (const [a, b, out] of MERGE_DEFS) {
    const aId = tokToId.get(a)
    const bId = tokToId.get(b)
    if (aId == null || bId == null || tokToId.has(out)) continue
    const id = idToTok.length
    idToTok.push(out)
    tokToId.set(out, id)
    merges.push({ a: aId, b: bId, out: id, str: out })
  }
  return { idToTok, tokToId, merges }
}

export const TOKENIZER: TokenizerTables = buildTokenizer()
export const VOCAB_SIZE = TOKENIZER.idToTok.length

export function charId(ch: string): number {
  const code = ch.charCodeAt(0)
  return code >= 32 && code <= 126 ? code - 32 + CHAR_BASE : UNK_ID
}

export interface MergeEvent {
  a: number
  b: number
  out: number
  at: number
  idsAfter: number[]
}

/** Tokenize with a full merge trace so the UI can animate round-by-round. */
export function tokenizeWithTrace(text: string): { ids: number[]; events: MergeEvent[] } {
  let ids = [...text].map(charId)
  const events: MergeEvent[] = []
  for (const m of TOKENIZER.merges) {
    let i = 0
    while (i < ids.length - 1) {
      if (ids[i] === m.a && ids[i + 1] === m.b) {
        ids = [...ids.slice(0, i), m.out, ...ids.slice(i + 2)]
        if (events.length < 96) events.push({ a: m.a, b: m.b, out: m.out, at: i, idsAfter: ids })
      } else {
        i++
      }
    }
  }
  return { ids, events }
}

export function tokenize(text: string): number[] {
  return tokenizeWithTrace(text).ids
}

export function detokenize(ids: number[]): string {
  return ids
    .map((id) => {
      if (id === EOS_ID) return ''
      const t = TOKENIZER.idToTok[id]
      return t == null || id === UNK_ID ? '�' : t
    })
    .join('')
}

export function tokenLabel(id: number): string {
  return TOKENIZER.idToTok[id] ?? `?${id}`
}

/* ---------------- vector math helpers (exported for the harness) ---------------- */

export function dot(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

/** out[c] = Σ_r x[r] * W[r][c] */
export function matvec(x: number[], W: number[][]): number[] {
  const out = new Array<number>(W[0].length).fill(0)
  for (let r = 0; r < x.length; r++) {
    const xr = x[r]
    const row = W[r]
    for (let c = 0; c < out.length; c++) out[c] += xr * row[c]
  }
  return out
}

export function softmax(xs: number[]): number[] {
  let max = -Infinity
  for (const x of xs) if (x > max) max = x
  const exps = xs.map((x) => Math.exp(x - max))
  let sum = 0
  for (const e of exps) sum += e
  return exps.map((e) => e / sum)
}

export function gelu(x: number): number {
  return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)))
}

export function geluVec(xs: number[]): number[] {
  return xs.map(gelu)
}

export function argmax(xs: number[]): number {
  let best = 0
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i
  return best
}

/* ---------------- the toy transformer ---------------- */

export interface ModelLayer {
  Wq: number[][]
  Wk: number[][]
  Wv: number[][]
  Wo: number[][]
  W1: number[][]
  W2: number[][]
}

export interface Model {
  d: number
  nLayers: number
  vocab: number
  emb: number[][]
  layers: ModelLayer[]
}

export function makeModel(opts?: {
  d?: number
  layers?: number
  seed?: number
  vocab?: number
}): Model {
  const d = opts?.d ?? 32
  const nLayers = opts?.layers ?? 2
  const vocab = opts?.vocab ?? VOCAB_SIZE
  const rand = mulberry32(opts?.seed ?? 1337)
  const gauss = () => (rand() + rand() + rand() - 1.5) * 2
  const mat = (rows: number, cols: number, scale: number): number[][] =>
    Array.from({ length: rows }, () => Array.from({ length: cols }, () => gauss() * scale))
  const emb = mat(vocab, d, 0.4)
  const layers: ModelLayer[] = Array.from({ length: nLayers }, () => ({
    Wq: mat(d, d, 1 / Math.sqrt(d)),
    Wk: mat(d, d, 1 / Math.sqrt(d)),
    Wv: mat(d, d, 1 / Math.sqrt(d)),
    Wo: mat(d, d, 1 / Math.sqrt(d)),
    W1: mat(d, 4 * d, 1 / Math.sqrt(d)),
    W2: mat(4 * d, d, 1 / Math.sqrt(4 * d)),
  }))
  return { d, nLayers, vocab, emb, layers }
}

export interface LayerTrace {
  /** seq×seq attention weight matrix (zeros above the diagonal) */
  attn: number[][]
  k: number[][]
  v: number[][]
}

export interface ForwardTrace {
  layers: LayerTrace[]
  /** logits over vocab at the final position */
  logits: number[]
  /** final hidden states per position (post last block) */
  hidden: number[][]
}

/**
 * Full recompute forward pass (the "naive" path). Bitwise-identical to the
 * cached path because causal attention makes every prefix independent.
 */
export function forwardAll(model: Model, ids: number[]): ForwardTrace {
  let x = ids.map((id) => [...model.emb[id]])
  const traces: LayerTrace[] = []
  const scale = 1 / Math.sqrt(model.d)
  for (const layer of model.layers) {
    const q = x.map((xi) => matvec(xi, layer.Wq))
    const k = x.map((xi) => matvec(xi, layer.Wk))
    const v = x.map((xi) => matvec(xi, layer.Wv))
    const attn: number[][] = []
    const outs: number[][] = []
    for (let i = 0; i < ids.length; i++) {
      const scores: number[] = []
      for (let j = 0; j <= i; j++) scores.push(dot(q[i], k[j]) * scale)
      const p = softmax(scores)
      attn.push([...p, ...new Array<number>(ids.length - 1 - i).fill(0)])
      const o = new Array<number>(model.d).fill(0)
      for (let j = 0; j <= i; j++) {
        for (let c = 0; c < model.d; c++) o[c] += p[j] * v[j][c]
      }
      outs.push(o)
    }
    const proj = outs.map((o) => matvec(o, layer.Wo))
    const res1 = x.map((xi, i) => xi.map((val, c) => val + proj[i][c]))
    const ffn = res1.map((xi) => matvec(geluVec(matvec(xi, layer.W1)), layer.W2))
    x = res1.map((xi, i) => xi.map((val, c) => val + ffn[i][c]))
    traces.push({ attn, k, v })
  }
  const last = x[x.length - 1]
  const logits = model.emb.map((e) => dot(last, e))
  return { layers: traces, logits, hidden: x }
}

/* ---------------- KV cache ---------------- */

export interface KVCacheState {
  /** per layer, per position K/V rows */
  layers: { k: number[][]; v: number[][] }[]
}

export function createCache(model: Model): KVCacheState {
  return { layers: model.layers.map(() => ({ k: [], v: [] })) }
}

export interface StepTrace {
  logits: number[]
  /** attention row of the new token per layer (length = position count) */
  attnRows: number[][]
}

/** Append ONE token to the cache and compute logits for it. O(n) not O(n²). */
export function forwardCached(model: Model, id: number, cache: KVCacheState): StepTrace {
  let xi = [...model.emb[id]]
  const attnRows: number[][] = []
  const scale = 1 / Math.sqrt(model.d)
  model.layers.forEach((layer, li) => {
    const q = matvec(xi, layer.Wq)
    const slot = cache.layers[li]
    slot.k.push(matvec(xi, layer.Wk))
    slot.v.push(matvec(xi, layer.Wv))
    const scores = slot.k.map((kj) => dot(q, kj) * scale)
    const p = softmax(scores)
    attnRows.push(p)
    const o = new Array<number>(model.d).fill(0)
    for (let j = 0; j < slot.v.length; j++) {
      for (let c = 0; c < model.d; c++) o[c] += p[j] * slot.v[j][c]
    }
    const proj = matvec(o, layer.Wo)
    const res1 = xi.map((val, c) => val + proj[c])
    const ffn = matvec(geluVec(matvec(res1, layer.W1)), layer.W2)
    xi = res1.map((val, c) => val + ffn[c])
  })
  const logits = model.emb.map((e) => dot(xi, e))
  return { logits, attnRows }
}

/* ---------------- paged KV block allocator (16-token blocks) ---------------- */

export const KV_BLOCK_SIZE = 16

export interface BlockAllocator {
  totalBlocks: number
  freeList: number[]
  /** seqId -> ordered block ids (the "block table") */
  tables: Map<number, number[]>
}

export function createAllocator(totalBlocks: number): BlockAllocator {
  return {
    totalBlocks,
    freeList: Array.from({ length: totalBlocks }, (_, i) => totalBlocks - 1 - i),
    tables: new Map(),
  }
}

/** Ensure seq owns enough blocks to hold `tokens` tokens. Returns false on OOM. */
export function ensureCapacity(alloc: BlockAllocator, seqId: number, tokens: number): boolean {
  const need = Math.ceil(tokens / KV_BLOCK_SIZE)
  const table = alloc.tables.get(seqId) ?? []
  while (table.length < need) {
    const block = alloc.freeList.pop()
    if (block == null) {
      alloc.tables.set(seqId, table)
      return false
    }
    table.push(block)
  }
  alloc.tables.set(seqId, table)
  return true
}

export function freeSeq(alloc: BlockAllocator, seqId: number): void {
  const table = alloc.tables.get(seqId)
  if (!table) return
  for (const b of table) alloc.freeList.push(b)
  alloc.tables.delete(seqId)
}

export function blocksUsed(alloc: BlockAllocator): number {
  return alloc.totalBlocks - alloc.freeList.length
}

/** Tokens reserved by the naive "max-context per sequence" strategy. */
export function naiveReservedTokens(maxCtxPerSeq: number, seqs: number): number {
  return maxCtxPerSeq * seqs
}

/* ---------------- greedy decode (naive vs KV-cached) ---------------- */

/** Simulated hardware: flops → milliseconds. */
export const FLOPS_PER_MS = 6000

export function forwardFlops(model: Model, n: number): number {
  const d = model.d
  const L = model.nLayers
  return L * (4 * n * d * d + 2 * n * n * d + 8 * n * d * d) + n * d * model.vocab
}

export function cachedStepFlops(model: Model, n: number): number {
  const d = model.d
  const L = model.nLayers
  return L * (4 * d * d + 2 * n * d + 8 * d * d) + d * model.vocab
}

export interface DecodeToken {
  id: number
  text: string
  itlMs: number
  flops: number
  /** cumulative naive-minus-actual flops — the waste counter */
  wastedFlops: number
}

export interface DecodeResult {
  tokens: DecodeToken[]
  ttftMs: number
  totalMs: number
  stoppedByEos: boolean
  totalFlops: number
  naiveFlops: number
}

export interface DecodeConfig {
  maxTokens?: number
  useCache?: boolean
  /** scripted continuation (token ids) — biases greedy decode so output is readable */
  scriptIds?: number[]
  scriptBias?: number
}

export function greedyDecode(model: Model, promptIds: number[], cfg?: DecodeConfig): DecodeResult {
  const maxTokens = cfg?.maxTokens ?? 16
  const useCache = cfg?.useCache ?? false
  const bias = cfg?.scriptBias ?? 1000
  const script = cfg?.scriptIds ?? []
  const tokens: DecodeToken[] = []
  let ids = [...promptIds]

  const prefillFlops = forwardFlops(model, ids.length)
  let logits: number[]
  let cache: KVCacheState | null = null
  if (useCache) {
    cache = createCache(model)
    let last: StepTrace | null = null
    for (const id of ids) last = forwardCached(model, id, cache)
    logits = last!.logits
  } else {
    logits = forwardAll(model, ids).logits
  }
  const ttftMs = prefillFlops / FLOPS_PER_MS
  let cumActual = prefillFlops
  let cumNaive = prefillFlops
  let stoppedByEos = false

  for (let t = 0; t < maxTokens; t++) {
    const biased = [...logits]
    if (t < script.length) biased[script[t]] += bias
    const next = argmax(biased)
    const stepFlops = useCache
      ? cachedStepFlops(model, ids.length + 1)
      : forwardFlops(model, ids.length + 1)
    cumActual += stepFlops
    cumNaive += forwardFlops(model, ids.length + 1)
    tokens.push({
      id: next,
      text: detokenize([next]),
      itlMs: stepFlops / FLOPS_PER_MS,
      flops: stepFlops,
      wastedFlops: cumNaive - cumActual,
    })
    if (next === EOS_ID) {
      stoppedByEos = true
      break
    }
    ids = [...ids, next]
    logits = useCache
      ? forwardCached(model, next, cache!).logits
      : forwardAll(model, ids).logits
  }

  return {
    tokens,
    ttftMs,
    totalMs: cumActual / FLOPS_PER_MS,
    stoppedByEos,
    totalFlops: cumActual,
    naiveFlops: cumNaive,
  }
}

/* ---------------- scripted prompts ---------------- */

export interface SamplePrompt {
  text: string
  script: string
}

export const SAMPLE_PROMPTS: SamplePrompt[] = [
  { text: 'hello world', script: ' the cache warms the tokens' },
  { text: 'the gpu', script: ' decodes one token at a time' },
  { text: 'kv cache', script: ' trades memory for compute' },
  { text: 'the batch', script: ' never waits for stragglers' },
  { text: 'a prompt', script: ' arrives and the prefill begins' },
]

export function scriptIdsFor(script: string): number[] {
  return [...tokenize(script), EOS_ID]
}

/* ---------------- continuous batching scheduler ---------------- */

export type SeqState = 'waiting' | 'running' | 'preempted' | 'done'

export interface SchedRequest {
  id: number
  name: string
  promptText: string
  promptIds: number[]
  scriptIds: number[]
  state: SeqState
  admittedAt: number
  finishedAt: number
  generated: number[]
}

export interface IterSnapshot {
  iter: number
  running: number[]
  admitted: number[]
  finished: number[]
  preempted: number[]
  memBlocks: number
}

export interface ScheduleResult {
  snapshots: IterSnapshot[]
  requests: SchedRequest[]
  iters: number
  maxBatchRespected: boolean
  starvationFree: boolean
}

export function makeWorkload(): SchedRequest[] {
  const specs = [
    { name: 'req-a', prompt: 0, arrive: 0 },
    { name: 'req-b', prompt: 1, arrive: 1 },
    { name: 'req-c', prompt: 2, arrive: 2 },
    { name: 'req-d', prompt: 3, arrive: 4 },
  ]
  return specs.map((s, i) => {
    const p = SAMPLE_PROMPTS[s.prompt]
    return {
      id: i,
      name: s.name,
      promptText: p.text,
      promptIds: tokenize(p.text),
      scriptIds: scriptIdsFor(p.script),
      state: 'waiting' as SeqState,
      admittedAt: s.arrive,
      finishedAt: -1,
      generated: [],
    }
  })
}

export interface ScheduleConfig {
  maxBatch: number
  /** KV memory cap in 16-token blocks */
  memBlocks: number
  mode: 'continuous' | 'static'
  maxIters?: number
}

/**
 * Iteration-level scheduler. Each iteration every running sequence decodes
 * exactly one scripted token. Continuous mode admits at every iteration;
 * under memory pressure it preempts (swaps out) the most recent admission.
 */
export function simulateSchedule(requests: SchedRequest[], cfg: ScheduleConfig): ScheduleResult {
  const reqs = requests.map((r) => ({
    ...r,
    promptIds: [...r.promptIds],
    scriptIds: [...r.scriptIds],
    generated: [] as number[],
    state: 'waiting' as SeqState,
    finishedAt: -1,
  }))
  const alloc = createAllocator(cfg.memBlocks)
  const snapshots: IterSnapshot[] = []
  const maxIters = cfg.maxIters ?? 200
  let maxBatchRespected = true

  const tokensOf = (r: SchedRequest) => r.promptIds.length + r.generated.length

  for (let iter = 0; iter < maxIters; iter++) {
    const admitted: number[] = []
    const finished: number[] = []
    const preempted: number[] = []
    const running = reqs.filter((r) => r.state === 'running')
    const arrived = reqs.filter((r) => r.state === 'waiting' && r.admittedAt <= iter)

    const tryAdmit = (r: SchedRequest): boolean => {
      if (running.length >= cfg.maxBatch) return false
      if (!ensureCapacity(alloc, r.id, tokensOf(r) + 1)) return false
      r.state = 'running'
      running.push(r)
      admitted.push(r.id)
      return true
    }

    if (cfg.mode === 'static') {
      // Static: admit a full batch only when the engine is idle; run to completion.
      if (running.length === 0) {
        for (const r of arrived) if (!tryAdmit(r)) break
      }
    } else {
      // Continuous: iteration-level admission, oldest waiting first.
      for (const r of arrived) {
        if (r.state !== 'waiting') continue
        tryAdmit(r)
      }
    }

    // One decode step per running sequence.
    for (const r of [...running]) {
      const nextTok = r.scriptIds[r.generated.length] ?? EOS_ID
      if (!ensureCapacity(alloc, r.id, tokensOf(r) + 1)) {
        // Memory pressure: preempt (swap out) this sequence.
        freeSeq(alloc, r.id)
        r.state = 'preempted'
        r.generated = []
        r.admittedAt = iter + 2
        preempted.push(r.id)
        running.splice(running.indexOf(r), 1)
        continue
      }
      r.generated.push(nextTok)
      if (nextTok === EOS_ID || r.generated.length >= r.scriptIds.length) {
        r.state = 'done'
        r.finishedAt = iter
        freeSeq(alloc, r.id)
        finished.push(r.id)
        running.splice(running.indexOf(r), 1)
      }
    }

    // Preempted sequences rejoin the waiting queue.
    for (const r of reqs) {
      if (r.state === 'preempted' && r.admittedAt <= iter) r.state = 'waiting'
    }

    if (running.length > cfg.maxBatch) maxBatchRespected = false
    snapshots.push({
      iter,
      running: running.map((r) => r.id),
      admitted,
      finished,
      preempted,
      memBlocks: blocksUsed(alloc),
    })

    if (reqs.every((r) => r.state === 'done')) {
      return {
        snapshots,
        requests: reqs,
        iters: iter + 1,
        maxBatchRespected,
        starvationFree: true,
      }
    }
  }
  return {
    snapshots,
    requests: reqs,
    iters: maxIters,
    maxBatchRespected,
    starvationFree: reqs.every((r) => r.state === 'done'),
  }
}

/* ---------------- metrics ---------------- */

/** Nearest-rank percentile on a copy of the input. p in 0..100. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}

export interface EngineMetrics {
  ttft: number
  itl: number
  throughput: number
}

/** Measure the cached engine: TTFT + mean ITL + single-sequence throughput. */
export function measureEngine(model: Model, promptText: string, script: string): EngineMetrics {
  const promptIds = tokenize(promptText)
  const scriptIds = scriptIdsFor(script)
  const res = greedyDecode(model, promptIds, {
    useCache: true,
    scriptIds,
    maxTokens: scriptIds.length,
  })
  const itls = res.tokens.filter((t) => t.id !== EOS_ID).map((t) => t.itlMs)
  const itl = itls.length ? itls.reduce((a, b) => a + b, 0) / itls.length : 0
  return { ttft: res.ttftMs, itl, throughput: itl > 0 ? 1000 / itl : 0 }
}

/** Shared default model instance (deterministic seed). */
export const TOY_MODEL: Model = makeModel({ d: 32, layers: 2, seed: 1337 })
