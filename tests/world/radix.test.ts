/**
 * world/radix.ts against the lab's harness (docs/specs/wave-3.md §8.2, task 3b-13).
 *
 * The fixtures below were printed by the real harness (labs/radix-cache/src/lib.rs: `probe`, with the capacity made a
 * parameter) running the lab's private reference solution, so a drift in the tree, the eviction order, the block
 * sharing or the xorshift stream here shows as a changed number. The replay's shape is also read out of lib.rs, and a
 * flat-list port of that reference solution (this file's `ListCache`) is held to the tree on random operation streams,
 * which is what pins the edge splits, the pruning and the oldest-inserted tie-break.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { HarnessRng } from '../../src/lib/world/bpe'
import {
  BLOCK_SIZE,
  BlockPool,
  PRACTICE_SEED,
  REFERENCE_REPLAY,
  REPLAY,
  RadixCache,
  chatPrompt,
  families,
  probeLine,
  rate3,
  replay,
  store,
  systemPrompt,
} from '../../src/lib/world/radix'

const LIB_RS = readFileSync(new URL('../../labs/radix-cache/src/lib.rs', import.meta.url), 'utf8')

/** `[seed, entry limit, blocks, hit_tokens, hit_rate, entries, free_blocks]`: `probe` at the default capacity (12 entries, 48 blocks) for 29 seeds, and at four other capacities for nine of them. */
const PROBES: [number, number, number, number, string, number, number][] = [
  [0, 12, 48, 1376, '0.597', 12, 28],
  [0, 6, 48, 992, '0.431', 6, 36],
  [0, 3, 48, 800, '0.347', 3, 41],
  [0, 24, 48, 1408, '0.611', 24, 16],
  [0, 6, 24, 992, '0.431', 6, 12],
  [1, 12, 48, 1312, '0.569', 12, 28],
  [1, 6, 48, 1152, '0.500', 6, 34],
  [1, 3, 48, 736, '0.319', 3, 39],
  [1, 24, 48, 1408, '0.611', 24, 16],
  [1, 6, 24, 1152, '0.500', 6, 10],
  [2, 12, 48, 1376, '0.597', 12, 32],
  [2, 6, 48, 1120, '0.486', 6, 38],
  [2, 3, 48, 928, '0.403', 3, 43],
  [2, 24, 48, 1408, '0.611', 24, 16],
  [2, 6, 24, 1120, '0.486', 6, 14],
  [3, 12, 48, 1312, '0.569', 12, 28],
  [3, 6, 48, 1120, '0.486', 6, 36],
  [3, 3, 48, 736, '0.319', 3, 41],
  [3, 24, 48, 1408, '0.611', 24, 16],
  [3, 6, 24, 1120, '0.486', 6, 12],
  [4, 12, 48, 1312, '0.569', 12, 28],
  [5, 12, 48, 1312, '0.569', 12, 28],
  [6, 12, 48, 1344, '0.583', 12, 30],
  [7, 12, 48, 1312, '0.569', 12, 30],
  [7, 6, 48, 1120, '0.486', 6, 36],
  [7, 3, 48, 768, '0.333', 3, 39],
  [7, 24, 48, 1408, '0.611', 24, 16],
  [7, 6, 24, 1120, '0.486', 6, 12],
  [8, 12, 48, 1280, '0.556', 12, 28],
  [9, 12, 48, 1344, '0.583', 12, 28],
  [10, 12, 48, 1376, '0.597', 12, 28],
  [11, 12, 48, 1376, '0.597', 12, 28],
  [12, 12, 48, 1312, '0.569', 12, 28],
  [13, 12, 48, 1344, '0.583', 12, 28],
  [14, 12, 48, 1312, '0.569', 12, 30],
  [15, 12, 48, 1312, '0.569', 12, 28],
  [16, 12, 48, 1280, '0.556', 12, 28],
  [17, 12, 48, 1376, '0.597', 12, 30],
  [18, 12, 48, 1344, '0.583', 12, 30],
  [19, 12, 48, 1408, '0.611', 12, 28],
  [20, 12, 48, 1376, '0.597', 12, 28],
  [21, 12, 48, 1344, '0.583', 12, 28],
  [22, 12, 48, 1344, '0.583', 12, 28],
  [23, 12, 48, 1376, '0.597', 12, 28],
  [0xc0ffee, 12, 48, 1312, '0.569', 12, 28],
  [0xc0ffee, 6, 48, 1088, '0.472', 6, 34],
  [0xc0ffee, 3, 48, 768, '0.333', 3, 39],
  [0xc0ffee, 24, 48, 1376, '0.597', 24, 16],
  [0xc0ffee, 6, 24, 1088, '0.472', 6, 10],
  [0xffffffff, 12, 48, 1376, '0.597', 12, 28],
  [0xffffffff, 6, 48, 992, '0.431', 6, 34],
  [0xffffffff, 3, 48, 640, '0.278', 3, 41],
  [0xffffffff, 24, 48, 1408, '0.611', 24, 16],
  [0xffffffff, 6, 24, 992, '0.431', 6, 10],
  [0x9e3779b9, 12, 48, 1376, '0.597', 12, 30],
  [0x9e3779b9, 6, 48, 1120, '0.486', 6, 38],
  [0x9e3779b9, 3, 48, 832, '0.361', 3, 43],
  [0x9e3779b9, 24, 48, 1408, '0.611', 24, 16],
  [0x9e3779b9, 6, 24, 1120, '0.486', 6, 14],
  [0xc4a7, 12, 48, 1344, '0.583', 12, 28],
  [0xc4a7, 6, 48, 1120, '0.486', 6, 34],
  [0xc4a7, 3, 48, 704, '0.306', 3, 39],
  [0xc4a7, 24, 48, 1376, '0.597', 24, 16],
  [0xc4a7, 6, 24, 1120, '0.486', 6, 10],
  [0xcac4e5, 12, 48, 1312, '0.569', 12, 28],
]

const line = (hit: number, rate: string, entries: number, free: number) =>
  `requests=48 hit_tokens=${hit} prompt_tokens=2304 hit_rate=${rate} entries=${entries} free_blocks=${free} conserved=true`

describe('the replay is the harness\'s `probe`', () => {
  test('its shape is read out of lib.rs: 48 requests, four 32-token system prompts, a 16-token turn, 12 entries over 48 blocks', () => {
    const probe = LIB_RS.slice(LIB_RS.indexOf('pub fn probe(seed: u32)'), LIB_RS.indexOf('/* ------------------------------ wasm ABI'))
    expect(LIB_RS).toContain(`const BS: usize = ${BLOCK_SIZE};`)
    expect(probe).toContain(`BlockAllocator::new(${REPLAY.blocks}, BS)`)
    expect(probe).toContain(`RadixCache::new(pool.clone(), ${REPLAY.entries})`)
    expect(probe).toContain(`for turn in 0..${REPLAY.requests}usize`)
    expect(probe).toContain(`tokens(500_000 + rng.below(${REPLAY.families}) as u32 * 1_000, ${REPLAY.systemTokens})`)
    expect(probe).toContain(`(0..${REPLAY.turnTokens}).map(|i| 800_000 + turn as u32 * 32 + i as u32)`)
    expect(probe).toContain(`requests=${REPLAY.requests}`)
  })

  test('the practice replay is the seed calibration.json records, and prints the line it records', () => {
    const cal = JSON.parse(readFileSync(new URL('../../labs/radix-cache/calibration.json', import.meta.url), 'utf8')) as { probe: { seed: number; reply: string } }
    expect(cal.probe.seed).toBe(PRACTICE_SEED)
    expect(REFERENCE_REPLAY).toEqual({ seed: PRACTICE_SEED, entries: 12, blocks: 48 })
    expect(probeLine(PRACTICE_SEED)).toBe(cal.probe.reply)
    expect(cal.probe.reply).toBe('requests=48 hit_tokens=1312 prompt_tokens=2304 hit_rate=0.569 entries=12 free_blocks=30 conserved=true')
  })

  test('probeLine prints what the real harness printed, for 29 seeds at the default capacity and nine of them at four more', () => {
    for (const [seed, entries, blocks, hit, rate, left, free] of PROBES) {
      expect(probeLine(seed, { entries, blocks })).toBe(line(hit, rate, left, free))
    }
  })

  test('every replay conserves the pool, and a request reuses its family\'s system prompt or nothing', () => {
    for (const [seed, entries, blocks] of PROBES) {
      const r = replay({ seed, entries, blocks })
      expect(r.error).toBeNull()
      expect(r.conserved).toBe(true)
      expect(r.steps).toHaveLength(REPLAY.requests + 1)
      for (const s of r.steps.slice(1)) expect([0, REPLAY.systemTokens]).toContain(s.hit)
      expect(r.hitTokens).toBe(r.steps.reduce((a, s) => a + s.hit, 0))
      expect(r.promptTokens).toBe(REPLAY.requests * (REPLAY.systemTokens + REPLAY.turnTokens))
      expect(r.steps[REPLAY.requests].owners.filter((o) => o > 0).length + r.freeBlocks).toBe(blocks)
    }
  })

  test('the first request of a family never hits, and the entry limit is never passed', () => {
    for (const [seed, entries, blocks] of PROBES) {
      const r = replay({ seed, entries, blocks })
      const seen = new Set<number>()
      families(seed).forEach((f, i) => {
        if (!seen.has(f)) expect(r.steps[i + 1].hit).toBe(0)
        seen.add(f)
      })
      for (const s of r.steps) expect(s.entries).toBeLessThanOrEqual(entries)
    }
  })

  test('the same config gives the same run', () => {
    expect(replay(REFERENCE_REPLAY)).toEqual(replay(REFERENCE_REPLAY))
    expect(replay({ ...REFERENCE_REPLAY, seed: 8 })).not.toEqual(replay(REFERENCE_REPLAY))
  })

  test('the practice run\'s numbers, as the PRIMM items quote them: 41 of 48 requests hit and 7 do not, 4 of them the first of a family', () => {
    const r = replay(REFERENCE_REPLAY)
    expect(r.hitTokens).toBe(1312)
    expect(r.misses).toBe(7)
    expect(r.hitTokens / REPLAY.systemTokens).toBe(41)
    // the ceiling: every request but the first of each family hits, 44 x 32 of 2,304 tokens
    const ceiling = replay({ ...REFERENCE_REPLAY, entries: 24 })
    expect(ceiling.misses).toBe(4)
    expect(ceiling.hitTokens).toBe(44 * REPLAY.systemTokens)
    expect(replay({ ...REFERENCE_REPLAY, entries: 6 }).misses).toBe(13)
    expect(replay({ ...REFERENCE_REPLAY, entries: 3 }).misses).toBe(24)
  })

  test('a cache that cannot admit a request ends the run with the harness\'s error text', () => {
    // one entry: the lookup touches the only entry of the family, which the insert needs as its canonical source and has to evict
    const r = replay({ seed: 7, entries: 1, blocks: 48 })
    expect(r.error).toMatch(/^err request \d+: the cache could not admit a 48-token prompt$/)
    expect(probeLine(7, { entries: 1, blocks: 48 })).toBe(r.error as string)
    // a pool smaller than one prompt
    expect(replay({ seed: 7, entries: 12, blocks: 2 }).error).not.toBeNull()
  })
})

describe('rate3 prints a ratio as Rust\'s {:.3} does', () => {
  test('round to nearest, an exact tie to the even digit', () => {
    expect(rate3(1312, 2304)).toBe('0.569')
    expect(rate3(0, 2304)).toBe('0.000')
    expect(rate3(2304, 2304)).toBe('1.000')
    expect(rate3(0, 0)).toBe('0.000')
    // 144 / 2304 = 0.0625 exactly: the tie goes to 0.062; 432 / 2304 = 0.1875 goes to 0.188
    expect(rate3(144, 2304)).toBe('0.062')
    expect(rate3(432, 2304)).toBe('0.188')
  })
})

describe('the harness generator', () => {
  test('families draw from the same stream the harness does', () => {
    const rng = new HarnessRng(7)
    expect(families(7)).toEqual(Array.from({ length: REPLAY.requests }, () => rng.below(REPLAY.families)))
  })

  test('prompts are the harness\'s: a family\'s system prompt, then ids no other request has', () => {
    expect(systemPrompt(2)).toHaveLength(32)
    expect(systemPrompt(2)[0]).toBe(502_000)
    expect(systemPrompt(2)[31]).toBe(502_031)
    const a = chatPrompt(1, 5)
    const b = chatPrompt(1, 6)
    expect(a).toHaveLength(48)
    expect(a.slice(0, 32)).toEqual(b.slice(0, 32))
    expect(a[32]).toBe(800_160)
    expect(a.slice(32).some((t) => b.includes(t))).toBe(false)
  })
})

/* ------------------------------ a flat-list cache: the reference solution's shape ------------------------------ */

interface ListEntry {
  tokens: number[]
  blocks: number[]
  used: number
}

/**
 * A port of the lab's private reference solution (a flat list scanned for common prefixes), written here from the
 * contract in cache.rs and checked against the real thing through the probe fixtures above. Slow and obviously right.
 */
class ListCache {
  entries: ListEntry[] = []
  clock = 0
  readonly pool: BlockPool
  readonly max: number
  constructor(pool: BlockPool, max: number) {
    this.pool = pool
    this.max = max
  }
  static common(a: readonly number[], b: readonly number[]): number {
    let n = 0
    while (n < a.length && n < b.length && a[n] === b[n]) n++
    return n
  }
  match(tokens: readonly number[]): { len: number; blocks: number[] } {
    let best = -1
    let bc = 0
    this.entries.forEach((e, i) => {
      const c = ListCache.common(e.tokens, tokens)
      if (c > bc) {
        best = i
        bc = c
      }
    })
    if (best < 0) return { len: 0, blocks: [] }
    this.clock++
    this.entries[best].used = this.clock
    return { len: bc, blocks: this.entries[best].blocks.slice(0, Math.ceil(bc / BLOCK_SIZE)) }
  }
  private leaf(i: number): boolean {
    const t = this.entries[i].tokens
    return !this.entries.some((e, j) => j !== i && e.tokens.length > t.length && ListCache.common(e.tokens, t) === t.length)
  }
  insert(tokens: readonly number[], blocks: readonly number[]): boolean {
    if (tokens.length === 0 || blocks.length !== Math.ceil(tokens.length / BLOCK_SIZE)) return false
    this.clock++
    const same = this.entries.find((e) => e.tokens.length === tokens.length && ListCache.common(e.tokens, tokens) === tokens.length)
    if (same) {
      same.used = this.clock
      return true
    }
    const table = [...blocks]
    for (let k = 0; k < table.length; k++) {
      if ((k + 1) * BLOCK_SIZE > tokens.length) break
      const e = this.entries.find((x) => ListCache.common(x.tokens, tokens) >= (k + 1) * BLOCK_SIZE)
      if (e) table[k] = e.blocks[k]
    }
    while (this.entries.length >= this.max) if (!this.evict()) return false
    if (!this.pool.retain(table)) return false
    this.entries.push({ tokens: [...tokens], blocks: table, used: this.clock })
    return true
  }
  evict(): boolean {
    let victim = -1
    this.entries.forEach((e, i) => {
      if (this.leaf(i) && (victim < 0 || e.used < this.entries[victim].used)) victim = i
    })
    if (victim < 0) return false
    const [gone] = this.entries.splice(victim, 1)
    return this.pool.release(gone.blocks)
  }
}

/** The harness's `store`, over the flat list. */
function storeList(cache: ListCache, prompt: readonly number[]): boolean {
  for (;;) {
    const fresh = cache.pool.allocateForTokens(prompt.length)
    if (fresh) {
      const ok = cache.insert(prompt, fresh)
      return cache.pool.release(fresh) && ok
    }
    if (!cache.evict()) return false
  }
}

describe('the tree answers as the flat list does', () => {
  /** Prompts from a small alphabet of segments, so they share runs, part mid-block, nest as prefixes and repeat. */
  function prompt(rng: HarnessRng): number[] {
    const out: number[] = []
    const segments = 1 + rng.below(4)
    for (let s = 0; s < segments; s++) {
      const kind = rng.below(3)
      const len = [3, 8, 16, 20, 32][rng.below(5)]
      const base = kind * 100 + rng.below(2) * 10
      for (let i = 0; i < len; i++) out.push(base + i)
    }
    return out
  }

  test('on 60 random streams of lookups, inserts and evictions: same lengths, blocks, entry counts and free blocks after every operation', () => {
    for (let seed = 0; seed < 60; seed++) {
      const rng = new HarnessRng(seed * 7919 + 1)
      const blocks = 8 + rng.below(40)
      const max = 1 + rng.below(8)
      const poolA = new BlockPool(blocks)
      const poolB = new BlockPool(blocks)
      const tree = new RadixCache(poolA, max)
      const list = new ListCache(poolB, max)
      for (let op = 0; op < 160; op++) {
        const p = prompt(rng)
        const what = rng.below(10)
        const at = `stream ${seed} op ${op}`
        if (what < 5) {
          expect(store(tree, poolA, p), at).toBe(storeList(list, p))
        } else if (what < 9) {
          expect(tree.matchPrefix(p), at).toEqual(list.match(p))
        } else {
          expect(tree.evictLru(), at).toBe(list.evict())
        }
        expect(tree.entryCount, at).toBe(list.entries.length)
        expect(poolA.freeBlocks, at).toBe(poolB.freeBlocks)
        expect(poolA.owners(), at).toEqual(poolB.owners())
        expect(poolA.conserved).toBe(true)
      }
      expect(tree.entries().map((e) => [e.len, e.used])).toEqual(list.entries.map((e) => [e.tokens.length, e.used]))
      // draining returns every block
      while (tree.evictLru());
      expect(poolA.freeBlocks).toBe(blocks)
    }
  })
})

/* ------------------------------ the lab's checks, on the tree ------------------------------ */

const ids = (start: number, len: number) => Array.from({ length: len }, (_, i) => start + i)

function fresh(blocks: number, max: number) {
  const pool = new BlockPool(blocks)
  return { pool, cache: new RadixCache(pool, max) }
}

describe('the tree passes the six checks\' scenarios (labs/radix-cache/src/lib.rs)', () => {
  test('exact_match: 40 tokens hit across the same 3 blocks at one owner each, and a duplicate is a touch', () => {
    const { pool, cache } = fresh(24, 8)
    const p = ids(100, 40)
    expect(store(cache, pool, p)).toBe(true)
    const first = cache.matchPrefix(p)
    expect(first.len).toBe(40)
    expect(first.blocks).toHaveLength(3)
    expect(cache.matchPrefix(p)).toEqual(first)
    expect(first.blocks.map((b) => pool.refcount(b))).toEqual([1, 1, 1])
    expect(store(cache, pool, p)).toBe(true)
    expect(cache.entryCount).toBe(1)
    expect(pool.allocatedBlocks).toBe(3)
  })

  test('longest_prefix: the 48-token document beats its 32-token ancestor and the other branch; an unrelated query misses', () => {
    const { pool, cache } = fresh(48, 12)
    const system = ids(1_000, 32)
    const doc = [...system, ...ids(2_000, 16)]
    const other = [...system, ...ids(3_000, 12)]
    for (const p of [system, doc, other]) expect(store(cache, pool, p)).toBe(true)
    const hit = cache.matchPrefix([...doc, ...ids(9_000, 11)])
    expect(hit.len).toBe(48)
    expect(hit.blocks).toHaveLength(3)
    expect(cache.matchPrefix(ids(77_000, 20))).toEqual({ len: 0, blocks: [] })
  })

  test('eviction_order: a hit makes an entry hot, the coldest leaf goes, an internal prefix outlives its descendant', () => {
    const a = fresh(32, 3)
    const [pa, pb, pc, pd] = [ids(10, 16), ids(100, 16), ids(200, 16), ids(300, 16)]
    for (const p of [pa, pb, pc]) store(a.cache, a.pool, p)
    a.cache.matchPrefix(pa)
    expect(store(a.cache, a.pool, pd)).toBe(true)
    expect(a.cache.matchPrefix(pb).len).toBe(0)
    for (const p of [pa, pc, pd]) expect(a.cache.matchPrefix(p).len).toBe(16)
    const t = fresh(32, 3)
    const base = ids(5_000, 32)
    const child = [...base, ...ids(6_000, 16)]
    const side = ids(7_000, 16)
    for (const p of [base, child, side]) store(t.cache, t.pool, p)
    t.cache.matchPrefix(child)
    expect(store(t.cache, t.pool, ids(8_000, 16))).toBe(true)
    expect(t.cache.matchPrefix(side).len).toBe(0)
    expect(t.cache.matchPrefix(child).len).toBe(48)
    expect(t.cache.evictLru()).toBe(true)
    expect(t.cache.matchPrefix(base).len).toBe(32)
    expect(t.cache.entryCount).toBe(2)
  })

  test('cow_divergence: a whole prefix block is shared, the partial tails are private: 3 blocks in all', () => {
    const { pool, cache } = fresh(24, 8)
    const base = ids(30_000, 20)
    const branch = [...base, ...ids(40_000, 7)]
    expect(store(cache, pool, base) && store(cache, pool, branch)).toBe(true)
    const x = cache.matchPrefix(base)
    const y = cache.matchPrefix(branch)
    expect(x.blocks[0]).toBe(y.blocks[0])
    expect(x.blocks[1]).not.toBe(y.blocks[1])
    expect(pool.allocatedBlocks).toBe(3)
  })

  test('block_conservation: 2,000 mixed operations and a drain return every block', () => {
    const { pool, cache } = fresh(128, 24)
    const rng = new HarnessRng(0xcac4e5)
    for (let op = 0; op < 2_000; op++) {
      const prompt = [...ids(10_000 + rng.below(12) * 1_000, 32), ...ids(100_000 + op * 64, 8 + rng.below(49))]
      const pick = rng.below(100)
      if (pick < 70) {
        cache.matchPrefix(prompt)
        expect(store(cache, pool, prompt)).toBe(true)
      } else if (pick < 90) cache.matchPrefix(prompt)
      else cache.evictLru()
      expect(cache.entryCount).toBeLessThanOrEqual(24)
      expect(pool.conserved).toBe(true)
    }
    while (cache.evictLru());
    expect(cache.entryCount).toBe(0)
    expect(pool.freeBlocks).toBe(128)
  })
})

describe('the tree\'s structure', () => {
  test('a lookup matches token for token: a query that parts from an edge halfway matches up to the part', () => {
    const { pool, cache } = fresh(24, 8)
    store(cache, pool, ids(100, 40))
    expect(cache.matchPrefix([...ids(100, 20), 9, 9, 9, 9, 9, 9, 9]).len).toBe(20)
    expect(cache.matchPrefix(ids(100, 3)).len).toBe(3)
    expect(cache.matchPrefix([...ids(100, 40), 5]).len).toBe(40)
    expect(cache.matchPrefix([]).len).toBe(0)
  })

  test('the blocks of a match cover its length, rounded up', () => {
    const { pool, cache } = fresh(24, 8)
    store(cache, pool, ids(100, 40))
    expect(cache.matchPrefix(ids(100, 16)).blocks).toHaveLength(1)
    expect(cache.matchPrefix(ids(100, 17)).blocks).toHaveLength(2)
    expect(cache.matchPrefix(ids(100, 40)).blocks).toHaveLength(3)
  })

  test('a prompt that is a proper prefix of an entry is an internal entry: it shares the longer entry\'s blocks and goes after it', () => {
    const { pool, cache } = fresh(24, 8)
    const longer = ids(100, 48)
    const prefix = ids(100, 32)
    store(cache, pool, longer)
    store(cache, pool, prefix)
    expect(cache.entryCount).toBe(2)
    // both blocks of the prefix are the longer entry's own blocks: shared, not copied
    const blocks = cache.matchPrefix(prefix).blocks
    expect(cache.matchPrefix(longer).blocks.slice(0, 2)).toEqual(blocks)
    expect(blocks.map((b) => pool.refcount(b))).toEqual([2, 2])
    // the prefix is the newer entry here, but it is internal anyway: eviction takes the longer one, the only leaf
    expect(cache.evictLru()).toBe(true)
    expect(cache.matchPrefix(prefix).len).toBe(32)
    expect(cache.matchPrefix(longer).len).toBe(32)
    expect(cache.entryCount).toBe(1)
  })

  test('evicting a leaf prunes the tree: the shared edge merges back into one when its second branch goes', () => {
    const { pool, cache } = fresh(24, 8)
    const system = ids(1_000, 32)
    store(cache, pool, [...system, ...ids(2_000, 16)])
    store(cache, pool, [...system, ...ids(3_000, 16)])
    expect(cache.entryCount).toBe(2)
    expect(pool.allocatedBlocks).toBe(4)
    cache.evictLru()
    expect(cache.entryCount).toBe(1)
    // the 32 shared tokens still match, now on the single entry that is left
    expect(cache.matchPrefix([...system, 5]).len).toBe(32)
    cache.evictLru()
    expect(cache.entryCount).toBe(0)
    expect(pool.freeBlocks).toBe(24)
  })

  test('a lookup touches one entry: the oldest-inserted under the point where the match ends', () => {
    const { pool, cache } = fresh(48, 8)
    const system = ids(1_000, 32)
    store(cache, pool, [...system, ...ids(2_000, 16)])
    store(cache, pool, [...system, ...ids(3_000, 16)])
    cache.matchPrefix([...system, 7])
    const used = new Map(cache.entries().map((e) => [e.born, e.used]))
    // the first entry was touched by the lookup, the second still has its insert time
    expect(used.get(1)).toBeGreaterThan(used.get(2) as number)
  })

  test('refusals change nothing: an empty prompt, a table of the wrong size, a block that is free', () => {
    const { pool, cache } = fresh(8, 4)
    expect(cache.insert([], [])).toBe(false)
    expect(cache.insert(ids(1, 20), [0])).toBe(false)
    expect(cache.insert(ids(1, 16), [3])).toBe(false)
    expect(cache.entryCount).toBe(0)
    expect(pool.freeBlocks).toBe(8)
    expect(cache.evictLru()).toBe(false)
    expect(pool.retain([99])).toBe(false)
    expect(pool.release([0])).toBe(false)
    expect(pool.allocateForTokens(0)).toBeNull()
    expect(pool.allocateForTokens(8 * 16 + 1)).toBeNull()
    expect(pool.freeBlocks).toBe(8)
  })

  test('a fresh pool hands out block 0 first, and the block freed last is handed out next', () => {
    const pool = new BlockPool(4)
    expect(pool.allocateForTokens(32)).toEqual([0, 1])
    pool.release([0])
    expect(pool.allocateForTokens(16)).toEqual([0])
  })
})
