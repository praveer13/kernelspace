/**
 * A prefix cache over a radix tree, in the browser (docs/specs/wave-3.md §8.2): the reference of lab 07's Run and Modify
 * steps.
 *
 * It is a compressed trie of token ids (each edge a run of tokens, split where two prompts part) with leaf-only LRU
 * eviction, on the lab's own refcounted block pool (labs/radix-cache/src/block_pool.rs): the same policy the lab's
 * private reference solution implements, written as a tree instead of a flat list. It answers exactly as that solution
 * does, so `probeLine` prints the harness's `probe <seed>` line character for character (tests/world/radix.test.ts holds
 * it to lines the real harness printed):
 *
 *   - `matchPrefix` returns the longest token prefix any cached prompt shares with the query, token for token (a query
 *     that parts from an edge halfway matches up to the part), plus the blocks that cover it. It touches one entry: the
 *     oldest-inserted one under the point where the match ends, as the lab's reference does.
 *   - `insert` shares every whole block an existing entry already holds, keeps a partial tail private, makes room first
 *     (evicting the coldest leaf at the entry limit), and retains the table exactly once. An exact duplicate is a touch.
 *   - `evictLru` takes the coldest terminal leaf. A prompt that is a proper prefix of another is an internal node and is
 *     never a candidate; a leaf with an outside owner would be skipped, and this page has none.
 *
 * Pure and deterministic: no DOM, no clock, no storage. The seeded trace uses the harness's own generator.
 */

import { HarnessRng } from './bpe'

/** Tokens per block in the lab's pool and in the bridge. */
export const BLOCK_SIZE = 16

/* ------------------------------------------------------------------ */
/* The block pool: lab 02's allocator, as the harness owns it           */
/* ------------------------------------------------------------------ */

/** Refcounted physical blocks. A fresh pool hands out block 0 first; a block freed last is handed out next. */
export class BlockPool {
  private readonly stack: number[]
  private readonly counts: number[]
  readonly size: number
  constructor(blocks: number) {
    this.size = blocks
    this.stack = Array.from({ length: blocks }, (_, i) => blocks - 1 - i)
    this.counts = new Array<number>(blocks).fill(0)
  }
  get freeBlocks(): number {
    return this.stack.length
  }
  get allocatedBlocks(): number {
    return this.counts.filter((c) => c > 0).length
  }
  refcount(block: number): number {
    return this.counts[block] ?? 0
  }
  /** Blocks for a completed prefill of `tokens`, each at one owner; null (and nothing taken) when the pool is short. */
  allocateForTokens(tokens: number): number[] | null {
    if (tokens === 0) return null
    const need = Math.ceil(tokens / BLOCK_SIZE)
    if (this.stack.length < need) return null
    const out: number[] = []
    for (let i = 0; i < need; i++) {
      const b = this.stack.pop() as number
      this.counts[b] = 1
      out.push(b)
    }
    return out
  }
  /** One more owner for every block; false (and no change) when a block is out of range or free. */
  retain(blocks: readonly number[]): boolean {
    if (blocks.some((b) => b < 0 || b >= this.size || this.counts[b] === 0)) return false
    for (const b of blocks) this.counts[b]++
    return true
  }
  /** One owner fewer for every block; a block that reaches 0 goes back. False (and no change) on a block out of range or free. */
  release(blocks: readonly number[]): boolean {
    if (blocks.some((b) => b < 0 || b >= this.size || this.counts[b] === 0)) return false
    for (const b of blocks) {
      this.counts[b]--
      if (this.counts[b] === 0) this.stack.push(b)
    }
    return true
  }
  /** Free plus allocated blocks equal the pool. */
  get conserved(): boolean {
    return this.freeBlocks + this.allocatedBlocks === this.size
  }
  /** Per block id: how many owners it has. */
  owners(): readonly number[] {
    return this.counts
  }
}

/* ------------------------------------------------------------------ */
/* The radix tree                                                       */
/* ------------------------------------------------------------------ */

interface Entry {
  /** The physical blocks of the whole prompt. */
  blocks: number[]
  /** Logical time of the last insert or hit. */
  used: number
  /** Order of first insertion: the tie-break among entries that match equally. */
  born: number
}

interface Node {
  /** The run of tokens on the edge into this node (empty at the root). */
  edge: number[]
  /** Children by the first token of their edge. */
  children: Map<number, Node>
  parent: Node | null
  /** Set when a whole cached prompt ends here. */
  entry: Entry | null
}

const node = (edge: number[], parent: Node | null): Node => ({ edge, children: new Map(), parent, entry: null })

/** Where a walk down the tree stopped. */
interface Walk {
  /** Tokens of the query that follow the tree. */
  len: number
  /** The node whose subtree holds every entry that shares exactly `len` tokens with the query: the node the walk stopped at, or the child of an edge it left halfway. */
  below: Node
  /** The edge the walk left halfway, or null when it stopped at a node. */
  split: { child: Node; at: number } | null
}

export interface PrefixMatch {
  len: number
  blocks: number[]
}

/** The cache the lab asks for: longest-prefix lookup, shared whole blocks, a private partial tail and leaf-only LRU. */
export class RadixCache {
  private readonly root = node([], null)
  private readonly pool: BlockPool
  private readonly maxEntries: number
  private clock = 0
  private births = 0
  private count = 0
  constructor(pool: BlockPool, maxEntries: number) {
    this.pool = pool
    this.maxEntries = maxEntries
  }

  get entryCount(): number {
    return this.count
  }

  private walk(tokens: readonly number[]): Walk {
    let at = this.root
    let depth = 0
    for (;;) {
      const child = depth < tokens.length ? at.children.get(tokens[depth]) : undefined
      if (child === undefined) return { len: depth, below: at, split: null }
      let j = 0
      while (j < child.edge.length && depth + j < tokens.length && child.edge[j] === tokens[depth + j]) j++
      if (j < child.edge.length) return { len: depth + j, below: child, split: { child, at: j } }
      depth += j
      at = child
    }
  }

  /** The oldest-inserted entry in a subtree, or null when it holds none. */
  private oldest(from: Node): Entry | null {
    let best: Entry | null = null
    const stack = [from]
    for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
      if (n.entry !== null && (best === null || n.entry.born < best.born)) best = n.entry
      for (const c of n.children.values()) stack.push(c)
    }
    return best
  }

  matchPrefix(tokens: readonly number[]): PrefixMatch {
    const w = this.walk(tokens)
    if (w.len === 0) return { len: 0, blocks: [] }
    const hit = this.oldest(w.below)
    if (hit === null) return { len: 0, blocks: [] }
    this.clock++
    hit.used = this.clock
    return { len: w.len, blocks: hit.blocks.slice(0, Math.ceil(w.len / BLOCK_SIZE)) }
  }

  /** The node a prompt ends at, when it ends exactly on one. */
  private exact(tokens: readonly number[]): Node | null {
    const w = this.walk(tokens)
    return w.split === null && w.len === tokens.length && w.below !== this.root ? w.below : null
  }

  /**
   * Inserts a completed prompt. `blocks` is the temporary prefill table (one owner each); the cache retains the
   * canonical table instead: a whole block an existing entry already holds, the prefill's own block otherwise.
   */
  insert(tokens: readonly number[], blocks: readonly number[]): boolean {
    if (tokens.length === 0 || blocks.length !== Math.ceil(tokens.length / BLOCK_SIZE)) return false
    this.clock++
    const same = this.exact(tokens)
    if (same?.entry != null) {
      same.entry.used = this.clock
      return true
    }
    const table = [...blocks]
    const shared = this.walk(tokens).len
    for (let k = 0; k < table.length; k++) {
      const end = (k + 1) * BLOCK_SIZE
      if (end > tokens.length) break
      if (shared >= end) {
        const holder = this.oldest(this.walk(tokens.slice(0, end)).below)
        if (holder !== null) table[k] = holder.blocks[k]
      }
    }
    while (this.count >= this.maxEntries) if (!this.evictLru()) return false
    if (!this.pool.retain(table)) return false
    this.attach(tokens, { blocks: table, used: this.clock, born: ++this.births })
    return true
  }

  /** Adds the entry's path, splitting the edge where the prompt parts from it. */
  private attach(tokens: readonly number[], entry: Entry): void {
    let at = this.root
    let depth = 0
    while (depth < tokens.length) {
      const child = at.children.get(tokens[depth])
      if (child === undefined) {
        const leaf = node(tokens.slice(depth), at)
        at.children.set(tokens[depth], leaf)
        at = leaf
        depth = tokens.length
        break
      }
      let j = 0
      while (j < child.edge.length && depth + j < tokens.length && child.edge[j] === tokens[depth + j]) j++
      if (j < child.edge.length) {
        // split: a middle node takes the shared run, and the old child keeps the rest of its edge
        const middle = node(child.edge.slice(0, j), at)
        at.children.set(tokens[depth], middle)
        child.edge = child.edge.slice(j)
        child.parent = middle
        middle.children.set(child.edge[0], child)
        at = middle
        depth += j
        if (depth < tokens.length) {
          const leaf = node(tokens.slice(depth), middle)
          middle.children.set(tokens[depth], leaf)
          at = leaf
          depth = tokens.length
        }
        break
      }
      depth += j
      at = child
    }
    at.entry = entry
    this.count++
  }

  /** Evicts the coldest terminal leaf and gives its blocks back. False when there is no leaf (an empty cache). */
  evictLru(): boolean {
    let victim: Node | null = null
    const stack = [this.root]
    for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
      if (n.entry !== null && n.children.size === 0 && (victim === null || n.entry.used < (victim.entry as Entry).used)) victim = n
      for (const c of n.children.values()) stack.push(c)
    }
    if (victim === null) return false
    const released = this.pool.release((victim.entry as Entry).blocks)
    victim.entry = null
    this.count--
    this.prune(victim)
    return released
  }

  /** Drops an emptied leaf, then merges a parent that is left with one child and holds no entry. */
  private prune(from: Node): void {
    let n: Node | null = from
    while (n !== null && n.parent !== null && n.entry === null && n.children.size === 0) {
      const up: Node = n.parent
      up.children.delete(n.edge[0])
      n = up
    }
    if (n !== null && n.parent !== null && n.entry === null && n.children.size === 1) {
      const [only] = [...n.children.values()]
      const up: Node = n.parent
      only.edge = [...n.edge, ...only.edge]
      only.parent = up
      up.children.set(only.edge[0], only)
    }
  }

  /** The cached prompts' lengths and recency, for tests and the page: oldest-inserted first. */
  entries(): { len: number; used: number; born: number; blocks: readonly number[] }[] {
    const out: { len: number; used: number; born: number; blocks: readonly number[] }[] = []
    const stack: [Node, number][] = [[this.root, 0]]
    for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
      const [n, depth] = top
      const len = depth + n.edge.length
      if (n.entry !== null) out.push({ len, used: n.entry.used, born: n.entry.born, blocks: n.entry.blocks })
      for (const c of n.children.values()) stack.push([c, len])
    }
    return out.sort((a, b) => a.born - b.born)
  }
}

/**
 * The harness's `store`: prefill a whole prompt (evicting leaves until the pool can hold it), insert it, then release the
 * temporary prefill owner. False when the cache could not make room or admit the prompt.
 */
export function store(cache: RadixCache, pool: BlockPool, prompt: readonly number[]): boolean {
  for (;;) {
    const fresh = pool.allocateForTokens(prompt.length)
    if (fresh !== null) {
      const inserted = cache.insert(prompt, fresh)
      const released = pool.release(fresh)
      return inserted && released
    }
    if (!cache.evictLru()) return false
  }
}

/* ------------------------------------------------------------------ */
/* The harness's chat replay and its `probe <seed>` line                */
/* ------------------------------------------------------------------ */

/** The shape of `probe`'s replay (labs/radix-cache/src/lib.rs): four system prompts, a user turn each, a small cache. */
export const REPLAY = {
  /** Requests in the replay. */
  requests: 48,
  /** System prompts the requests draw from. */
  families: 4,
  /** Tokens of a system prompt, shared by a family. */
  systemTokens: 32,
  /** Tokens of the user turn, unique to a request. */
  turnTokens: 16,
  /** Physical blocks in the pool. */
  blocks: 48,
  /** Entries the cache holds. */
  entries: 12,
} as const

/** What a replay varies: the draw of families, and the capacity of the cache. */
export interface ReplayConfig {
  seed: number
  /** The entry limit. */
  entries: number
  /** Physical blocks in the pool. */
  blocks: number
}

/** The practice replay: the seed `calibration.json` records, and the config the page's reference run uses. */
export const PRACTICE_SEED = 7
export const REFERENCE_REPLAY: ReplayConfig = { seed: PRACTICE_SEED, entries: REPLAY.entries, blocks: REPLAY.blocks }

/** A system prompt: 32 consecutive ids from 500,000 + 1,000 * family, as the harness builds it. */
export const systemPrompt = (family: number): number[] => Array.from({ length: REPLAY.systemTokens }, (_, i) => 500_000 + family * 1_000 + i)

/** A request's prompt: its family's system prompt, then 16 ids that no other request has. */
export function chatPrompt(family: number, turn: number): number[] {
  const prompt = systemPrompt(family)
  for (let i = 0; i < REPLAY.turnTokens; i++) prompt.push(800_000 + turn * 32 + i)
  return prompt
}

/** The family of each request, drawn as the harness draws them. */
export function families(seed: number): number[] {
  const rng = new HarnessRng(seed)
  return Array.from({ length: REPLAY.requests }, () => rng.below(REPLAY.families))
}

/** The state after one request. */
export interface ReplayStep {
  /** Requests served so far (0 for the empty cache). */
  request: number
  /** The family of the request just served (-1 before the first). */
  family: number
  /** Tokens the lookup reused for this request. */
  hit: number
  /** Tokens reused so far. */
  hitTokens: number
  /** Prompt tokens so far. */
  promptTokens: number
  entries: number
  freeBlocks: number
  /** Per block id: owners (0 free). */
  owners: readonly number[]
}

export interface Replay {
  config: ReplayConfig
  steps: readonly ReplayStep[]
  hitTokens: number
  promptTokens: number
  entries: number
  freeBlocks: number
  conserved: boolean
  /** Set when the cache could not admit a request: the harness's `err` text, and the run ends there. */
  error: string | null
  /** Requests whose lookup reused nothing. */
  misses: number
}

/** Runs the replay on `RadixCache`: for each request a lookup, then the harness's `store`. */
export function replay(config: ReplayConfig): Replay {
  const pool = new BlockPool(config.blocks)
  const cache = new RadixCache(pool, config.entries)
  const fam = families(config.seed)
  const steps: ReplayStep[] = []
  let hitTokens = 0
  let promptTokens = 0
  let misses = 0
  let error: string | null = null
  const snap = (request: number, family: number, hit: number) =>
    steps.push({ request, family, hit, hitTokens, promptTokens, entries: cache.entryCount, freeBlocks: pool.freeBlocks, owners: [...pool.owners()] })
  snap(0, -1, 0)
  for (let turn = 0; turn < fam.length; turn++) {
    const prompt = chatPrompt(fam[turn], turn)
    const hit = cache.matchPrefix(prompt).len
    hitTokens += hit
    promptTokens += prompt.length
    if (hit === 0) misses++
    if (!store(cache, pool, prompt)) {
      error = `err request ${turn}: the cache could not admit a ${prompt.length}-token prompt`
      break
    }
    snap(turn + 1, fam[turn], hit)
  }
  return { config, steps, hitTokens, promptTokens, entries: cache.entryCount, freeBlocks: pool.freeBlocks, conserved: pool.conserved, error, misses }
}

/** `hits / prompts` to three decimals as Rust's `{:.3}` prints it: an exact tie goes to the even digit, as it does there. */
export function rate3(hits: number, prompts: number): string {
  if (prompts === 0) return '0.000'
  const scaled = hits * 1000
  let q = Math.floor(scaled / prompts)
  const twice = (scaled % prompts) * 2
  if (twice > prompts || (twice === prompts && q % 2 === 1)) q++
  return `${Math.floor(q / 1000)}.${String(q % 1000).padStart(3, '0')}`
}

/** The line the harness's `probe <seed>` prints, character for character (for the default capacity; other caps print the same fields). */
export function probeLine(seed: number, caps: { entries: number; blocks: number } = { entries: REPLAY.entries, blocks: REPLAY.blocks }): string {
  const r = replay({ seed, ...caps })
  if (r.error !== null) return r.error
  return `requests=${REPLAY.requests} hit_tokens=${r.hitTokens} prompt_tokens=${r.promptTokens} hit_rate=${rate3(r.hitTokens, r.promptTokens)} entries=${r.entries} free_blocks=${r.freeBlocks} conserved=${r.conserved}`
}
