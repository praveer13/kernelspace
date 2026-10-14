/**
 * The shipped twin content (docs/specs/wave-3.md §9, task 3b-15): lab 07 against SGLang's Rust TreeCore at v0.5.21 and
 * lab 06 against vLLM's scheduler at v0.31.0. tests/forge/twin.test.ts holds the panel and the registry to a fixture;
 * this file holds the real questions to what the spec asks of them:
 *  - each twin names its file and symbols at its claim's pinned ref, and passes the registry's rules (`twinProblems`);
 *  - three questions each, a why per option, KCs that sit on the lab's own checks, the key never the longest option;
 *  - every answer is DERIVED here, not copied: the lab 07 answers from a small model of the Rust paths they trace
 *    (`match_prefix_helper_`, `split_node_`, `insert_walk_step_`, the evict heap), the lab 06 answers from the
 *    arithmetic of `Scheduler.schedule`. The key must be the one option the pinned rule produces, and every other option
 *    must be what a named wrong rule produces (the lab's own rule, a flipped default, a different phase model). The models
 *    were checked against the upstream crate's tests at the pinned tag (named in each describe).
 *  - `verify:items -- --subset item:lab07.twin.,item:lab06.twin.` selects exactly these six items.
 */
import { describe, expect, test } from 'bun:test'
import { getClaim } from '../../src/data/claims'
import '../../src/data/claims/lazy/twins'
import { FORGE_LABS } from '../../src/data/labs'
import { findTwin, loadTwin, twinFileUrl, twinItemId, twinLabIds, twinProblems, TWIN_ITEMS_PER_LAB, type TwinModule } from '../../src/data/twins'
import batchingScheduler, { TWIN_ITEMS as SCHEDULER_ITEMS } from '../../src/data/twins/batching-scheduler'
import radixCache, { TWIN_ITEMS as RADIX_ITEMS } from '../../src/data/twins/radix-cache'
import { collectTwinItems, discoverTwins } from '../../scripts/item-pools'

const TWINS: { twin: TwinModule; items: readonly TwinModule['items'][number][]; claimId: string; repo: string; ref: string; path: string }[] = [
  { twin: radixCache, items: RADIX_ITEMS, claimId: 'twin.sglang.treecore', repo: 'sgl-project/sglang', ref: 'v0.5.21', path: 'rust/sglang-radix-tree/src/unified_tree_core.rs' },
  { twin: batchingScheduler, items: SCHEDULER_ITEMS, claimId: 'twin.vllm.scheduler', repo: 'vllm-project/vllm', ref: 'v0.31.0', path: 'vllm/v1/core/sched/scheduler.py' },
]

/* ------------------------------ what each twin names ------------------------------ */

describe('each twin names its file and symbols at the pinned ref of its claim', () => {
  for (const { twin, items, claimId, repo, ref, path } of TWINS) {
    const lab = FORGE_LABS.find((l) => l.id === twin.labId)!

    test(`${twin.labId}: the registry finds it and it passes every rule against ${claimId}`, async () => {
      expect(await twinLabIds()).toContain(twin.labId)
      expect(await findTwin(twin.labId)).toBe(await loadTwin(twin.labId))
      expect(lab, `${twin.labId} is a lab`).toBeDefined()
      expect(twin.labNo).toBe(String(lab.index).padStart(2, '0'))
      expect(twin.claimId).toBe(claimId)
      expect(twinProblems(twin, getClaim(claimId))).toEqual([])
      expect(twin.items).toBe(items)
      expect(items).toHaveLength(TWIN_ITEMS_PER_LAB)
    })

    test(`${twin.labId}: the file is read at ${repo}@${ref}, the claim's pin, and the claim's source is a file of that tag`, () => {
      const claim = getClaim(claimId)
      expect(claim.kind).toBe('status')
      expect(claim.ttlDays).toBe(60)
      expect(claim.pin).toEqual({ repo, ref })
      expect(claim.source!.url).toContain(`/${repo}/${ref}/`)
      expect(twin.path).toBe(path)
      expect(twinFileUrl(claim.pin!, twin.path)).toBe(`https://github.com/${repo}/blob/${ref}/${path}`)
      expect(twin.symbols.length).toBeGreaterThanOrEqual(2)
      expect(new Set(twin.symbols).size).toBe(twin.symbols.length)
    })

    test(`${twin.labId}: the "you just wrote" line is there and names no date or number the claim does not carry`, () => {
      expect(twin.youWrote).toMatch(/^You just wrote /)
      if (twin.labId === 'radix-cache') {
        // 2026-09-29 is the merge date of sgl-project/sglang PR #39627 in the claim's boundary
        expect(getClaim(claimId).boundary).toContain('#39627, merged 2026-09-29')
        expect(twin.youWrote).toContain('2026-09-29')
      }
    })
  }
})

describe('the questions: ids, whys, KCs from the lab’s own checks', () => {
  for (const { twin, items } of TWINS) {
    const lab = FORGE_LABS.find((l) => l.id === twin.labId)!
    const labKcs = new Set(lab.checks.flatMap((c) => c.kcs))

    test(`${twin.labId}: ids lab${twin.labNo}.twin.1 to 3, every option has a why, exactly one right answer`, () => {
      items.forEach((item, i) => {
        expect(item.id).toBe(twinItemId(twin.labNo, i + 1))
        const { q } = item
        expect(q.options.length).toBe(4)
        expect(new Set(q.options).size).toBe(q.options.length)
        expect(q.multi).toBeUndefined()
        expect(q.correct).toHaveLength(1)
        expect(q.why).toHaveLength(q.options.length)
        for (const w of q.why!) expect(w.trim().length).toBeGreaterThan(40)
        // the key's why is the only one that says so, so a reordered options array cannot keep its whys silently
        q.why!.forEach((w, j) => expect(w.startsWith('Right.'), `${item.id} option ${j}`).toBe(j === q.correct[0]))
      })
    })

    test(`${twin.labId}: every question's KCs are KCs of ${twin.labId}'s checks`, () => {
      for (const item of items) {
        expect(item.kcs.length).toBeGreaterThanOrEqual(1)
        expect(item.kcs.length).toBeLessThanOrEqual(3)
        for (const kc of item.kcs) expect(labKcs.has(kc), `${item.id} ${kc}`).toBe(true)
      }
    })

    test(`${twin.labId}: the key is never the longest option, and the keys sit at more than one length rank`, () => {
      const ranks = items.map((item) => {
        const lens = item.q.options.map((o) => o.trim().length)
        const key = lens[item.q.correct[0]]
        expect(Math.max(...lens), item.id).toBeGreaterThan(key)
        return lens.filter((l) => l > key).length // 1..3 options longer than the key
      })
      expect(new Set(ranks).size).toBeGreaterThan(1)
    })
  }

  test('the six questions are the whole `twin` pool: refs item:lab06.twin.1-3 and item:lab07.twin.1-3', async () => {
    const dir = new URL('../../src/data/twins/', import.meta.url)
    const discovery = await discoverTwins(dir)
    expect(discovery.problems).toEqual([])
    const refs = collectTwinItems(discovery.found).map((p) => p.ref)
    expect(refs).toEqual(['item:lab06.twin.1', 'item:lab06.twin.2', 'item:lab06.twin.3', 'item:lab07.twin.1', 'item:lab07.twin.2', 'item:lab07.twin.3'])
  })

  test('verify:items --subset selects the six twin items and passes (n = 6 is below 12: it reports, the merged run decides)', () => {
    const run = Bun.spawnSync(['bun', 'scripts/verify-items.ts', '--subset', 'item:lab07.twin.,item:lab06.twin.'], { cwd: new URL('../../', import.meta.url).pathname })
    const out = run.stdout.toString()
    expect(run.exitCode, out + run.stderr.toString()).toBe(0)
    expect(out).toContain('6 item(s) selected, n = 6')
    expect(out).toContain('selected by pool: twin 6')
    expect(out).toContain('n < 12')
  })
})

/* ------------------------------ lab 07: the Rust tree core ------------------------------ */

/**
 * The Full-only paths of rust/sglang-radix-tree/src/unified_tree_core.rs at v0.5.21, as far as the three questions go:
 * `ChildKeyType::match_len` (page-quantised), `match_prefix_helper_` and `match_post_processor_` (split on a partial
 * edge, restamp the matched path newest leaf-ward), `insert_walk_step_` / `insert_commit_step_` (touch, split, duplicate
 * window, new leaf), `split_node_` (the remainder gets a new tick) and the evict heap (lowest `last_access_counter`
 * among nodes with no device-valued child). Ticks are `get_and_bump_access_counter`. Upstream tests that pin the same
 * behaviour: match_prefix_splits_on_a_partial_match, match_prefix_page_aligns_the_query,
 * match_prefix_restamps_the_matched_path_newest_first, insert_splits_on_a_partial_overlap,
 * insert_full_overlap_frees_the_duplicates, split_copies_stats_and_restamps_the_child, split_updates_the_leaf_sets.
 */
class TreeModel {
  private tick = 0
  readonly root: TreeNode
  constructor(readonly page: number) {
    this.root = { key: [], kv: [], parent: null, children: new Map(), last: this.bump() }
  }
  private bump(): number {
    return ++this.tick
  }
  private childOn(node: TreeNode, key: number[], at: number): TreeNode | undefined {
    return node.children.get(key.slice(at, at + this.page).join(','))
  }
  private matchLen(key: number[], start: number, other: number[]): number {
    let common = 0
    while (start + common < key.length && common < other.length && key[start + common] === other[common]) common++
    return Math.floor(common / this.page) * this.page
  }
  private split(child: TreeNode, at: number): TreeNode {
    if (at <= 0 || at % this.page !== 0) throw new Error('split_node_: split_len must be a nonzero page multiple')
    const parent = child.parent!
    const head: TreeNode = { key: child.key.slice(0, at), kv: child.kv.slice(0, at), parent, children: new Map(), last: this.bump() }
    child.parent = head
    child.key = child.key.slice(at)
    child.kv = child.kv.slice(at)
    head.children.set(child.key.slice(0, this.page).join(','), child)
    parent.children.set(head.key.slice(0, this.page).join(','), head)
    child.last = this.bump() // "A split does not access the suffix" is about the aux LRU lists; the counter is bumped
    return head
  }
  /** match_prefix: the KV indices of the longest page-aligned prefix, and the node the match ends at. */
  matchPrefix(tokens: number[]): { kv: number[]; ends: TreeNode } {
    const aligned = Math.floor(tokens.length / this.page) * this.page
    const key = tokens.slice(0, aligned)
    let node = this.root
    let best = this.root
    let at = 0
    const kv: number[] = []
    while (at < aligned) {
      const child = this.childOn(node, key, at)
      if (!child) break
      const n = this.matchLen(key, at, child.key)
      if (n < child.key.length) {
        const head = this.split(child, n)
        kv.push(...head.kv)
        best = head
        break
      }
      kv.push(...child.kv)
      node = best = child
      at += n
    }
    const path: TreeNode[] = []
    for (let cur: TreeNode | null = best; cur; cur = cur.parent) path.push(cur)
    this.tick += path.length
    path.forEach((p, i) => (p.last = this.tick - i))
    return { kv, ends: best }
  }
  /** insert: the slots the tree keeps for the request's tokens, and the duplicates it hands back (FreeDeviceKV). */
  insert(tokens: number[], slots: number[], prevPrefixLen = 0): { handedBack: number[]; prefixLen: number } {
    const aligned = Math.floor(tokens.length / this.page) * this.page
    const key = tokens.slice(0, aligned)
    const value = slots.slice(0, aligned)
    this.root.last = this.bump()
    let node = this.root
    let cursor = 0
    const handedBack: number[] = []
    while (cursor < aligned) {
      let child = this.childOn(node, key, cursor)
      if (!child) break
      child.last = this.bump() // touch_node_
      const n = this.matchLen(key, cursor, child.key)
      if (n < child.key.length) child = this.split(child, n)
      const dupStart = Math.max(prevPrefixLen - cursor, 0)
      if (dupStart < n) handedBack.push(...value.slice(cursor + dupStart, cursor + n))
      node = child
      cursor += n
    }
    if (cursor < aligned) {
      const leaf: TreeNode = { key: key.slice(cursor), kv: value.slice(cursor), parent: node, children: new Map(), last: this.bump() }
      node.children.set(leaf.key.slice(0, this.page).join(','), leaf)
    }
    return { handedBack, prefixLen: cursor }
  }
  /** All KV slots the tree holds, root order. */
  held(): number[] {
    const out: number[] = []
    const walk = (n: TreeNode) => {
      out.push(...n.kv)
      for (const c of n.children.values()) walk(c)
    }
    walk(this.root)
    return out.sort((a, b) => a - b)
  }
  /** The nodes the evict heap holds: no children (every child here has a device value), not the root. */
  evictableLeaves(): TreeNode[] {
    const out: TreeNode[] = []
    const walk = (n: TreeNode) => {
      if (n !== this.root && n.children.size === 0) out.push(n)
      for (const c of n.children.values()) walk(c)
    }
    walk(this.root)
    return out
  }
  /** evict_device_next_node: the lowest PriorityKey(last_access_counter, 0) in the heap, the first node the walk returns. */
  evictFirst(): TreeNode {
    return this.evictableLeaves().sort((a, b) => a.last - b.last)[0]
  }
  shape(n: TreeNode = this.root): string {
    const kids = [...n.children.values()].map((c) => this.shape(c))
    return `${n === this.root ? 'root' : `[${n.key.join(',')}]`}${kids.length ? `(${kids.join(' ')})` : ''}`
  }
}
interface TreeNode {
  key: number[]
  kv: number[]
  parent: TreeNode | null
  children: Map<string, TreeNode>
  last: number
}

/** The indices of the options whose text contains every given fragment. */
const optionsWith = (item: TwinModule['items'][number], ...fragments: string[]) => item.q.options.flatMap((o, i) => (fragments.every((f) => o.includes(f)) ? [i] : []))

describe('lab 07 question 1: match_prefix at page_size 2 splits the node at the page-aligned length', () => {
  const [item] = RADIX_ITEMS

  test('the model: tokens 1 and 2 come back, the node splits at 2, the match ends at the new [1,2] node', () => {
    const tree = new TreeModel(2)
    tree.insert([1, 2, 3, 4, 5, 6], [10, 11, 12, 13, 14, 15])
    expect(tree.shape()).toBe('root([1,2,3,4,5,6])')
    const { kv, ends } = tree.matchPrefix([1, 2, 3, 9])
    expect(kv).toEqual([10, 11]) // tokens 1 and 2; 3 equal tokens round down to the page multiple 2
    expect(ends.key).toEqual([1, 2])
    expect(tree.shape()).toBe('root([1,2]([3,4,5,6]))')
  })

  test('the key is the option that says so, and each wrong option is the output of one wrong rule', () => {
    expect(optionsWith(item, 'tokens 1 and 2,', 'splits the node at 2 into [1,2] and [3,4,5,6]', 'new [1,2] node')).toEqual([item.q.correct[0]])
    // token-granular matching: 3 tokens, split at 3
    const tokenWise = new TreeModel(1)
    tokenWise.insert([1, 2, 3, 4, 5, 6], [10, 11, 12, 13, 14, 15])
    expect(tokenWise.matchPrefix([1, 2, 3, 9]).kv).toEqual([10, 11, 12])
    expect(tokenWise.shape()).toBe('root([1,2,3]([4,5,6]))')
    expect(optionsWith(item, 'tokens 1, 2 and 3', 'splits the node at 3 into [1,2,3] and [4,5,6]', 'new [1,2,3] node')).toHaveLength(1)
    // a read-only lookup: right count, no split
    expect(optionsWith(item, 'tokens 1 and 2,', 'leaves the tree untouched', 'original [1,2,3,4,5,6] node')).toHaveLength(1)
    // whole-entry matching: nothing
    expect(optionsWith(item, 'returns nothing', 'leaves the tree untouched')).toHaveLength(1)
    // four different options: one index each
    const picked = [
      optionsWith(item, 'splits the node at 2 into [1,2] and [3,4,5,6]')[0],
      optionsWith(item, 'splits the node at 3')[0],
      optionsWith(item, 'tokens 1 and 2,', 'original [1,2,3,4,5,6] node')[0],
      optionsWith(item, 'returns nothing')[0],
    ]
    expect([...picked].sort()).toEqual([0, 1, 2, 3])
  })

  test('the ragged page: [1,2,3] at page_size 2 has an aligned length of 2 (the trailing token never enters the walk)', () => {
    const tree = new TreeModel(2)
    tree.insert([1, 2], [10, 11])
    expect(tree.matchPrefix([1, 2, 3]).kv).toEqual([10, 11])
  })
})

describe('lab 07 question 2: insert splits at the shared prefix and hands the request’s duplicate slots back', () => {
  const [, item] = RADIX_ITEMS

  test('the model: the tree holds 10-13 and 22-23, and 20 and 21 come back', () => {
    const tree = new TreeModel(1)
    tree.insert([1, 2, 3, 4], [10, 11, 12, 13])
    const { handedBack, prefixLen } = tree.insert([1, 2, 5, 6], [20, 21, 22, 23], 0)
    expect(prefixLen).toBe(2)
    expect(handedBack).toEqual([20, 21])
    expect(tree.held()).toEqual([10, 11, 12, 13, 22, 23])
    expect(tree.shape()).toBe('root([1,2]([3,4] [5,6]))')
  })

  test('a request that had matched [1,2] earlier (prev_prefix_len 2) hands nothing back: its slots 20 and 21 are the tree’s own', () => {
    const tree = new TreeModel(1)
    tree.insert([1, 2, 3, 4], [10, 11, 12, 13])
    expect(tree.insert([1, 2, 5, 6], [10, 11, 22, 23], 2).handedBack).toEqual([])
  })

  test('the key is the option that matches the model; the wrong ones are the lab’s refcount, "newer copy wins" and "no sharing"', () => {
    expect(optionsWith(item, 'holds 10, 11, 12, 13, 22 and 23', 'hands back 20 and 21')).toEqual([item.q.correct[0]])
    expect(optionsWith(item, 'holds 10, 11, 12, 13, 22 and 23', 'stay allocated to the request')).toHaveLength(1)
    expect(optionsWith(item, 'holds 20, 21, 22 and 23', 'hands back 10 and 11')).toHaveLength(1)
    expect(optionsWith(item, 'holds eight slots', 'nothing is shared or freed')).toHaveLength(1)
  })
})

describe('lab 07 question 3: the evict walk’s first node after a partial lookup', () => {
  const [, , item] = RADIX_ITEMS

  test('the model: insert [1,2,3,4], insert [7,8], match_prefix([1,2,9]) leaves [7,8] the coldest leaf', () => {
    const tree = new TreeModel(1)
    tree.insert([1, 2, 3, 4], [10, 11, 12, 13])
    tree.insert([7, 8], [30, 31])
    const { kv, ends } = tree.matchPrefix([1, 2, 9])
    expect(kv).toEqual([10, 11])
    expect(ends.key).toEqual([1, 2])
    expect(tree.shape()).toBe('root([1,2]([3,4]) [7,8])')
    expect(tree.evictableLeaves().map((n) => n.key.join(',')).sort()).toEqual(['3,4', '7,8']) // [1,2] has a child with KV
    expect(tree.evictFirst().key).toEqual([7, 8])
  })

  test('the stamp is what decides it: without the split’s restamp the remainder [3,4] would go first', () => {
    const tree = new TreeModel(1)
    tree.insert([1, 2, 3, 4], [10, 11, 12, 13])
    tree.insert([7, 8], [30, 31])
    const before = tree.evictableLeaves().find((n) => n.key.join(',') === '1,2,3,4')!.last
    const leaf78 = tree.evictableLeaves().find((n) => n.key.join(',') === '7,8')!
    expect(before).toBeLessThan(leaf78.last) // the first request is older than [7,8]
    tree.matchPrefix([1, 2, 9])
    const rest = tree.evictableLeaves().find((n) => n.key.join(',') === '3,4')!
    expect(rest.last).toBeGreaterThan(leaf78.last) // split_node_ gave the remainder a new tick
  })

  test('the key is the [7,8] option; the wrong ones are "coldest by reads", "oldest node" and "whole request"', () => {
    expect(optionsWith(item, 'The leaf [7,8]', "restamped newer by the lookup's split")).toEqual([item.q.correct[0]])
    expect(optionsWith(item, 'The leaf [3,4]')).toHaveLength(1)
    expect(optionsWith(item, 'The node [1,2]')).toHaveLength(1)
    expect(optionsWith(item, 'Both [1,2] and [3,4] together')).toHaveLength(1)
  })
})

/* ------------------------------ lab 06: the vLLM scheduler ------------------------------ */

const cdiv = (a: number, b: number) => Math.ceil(a / b)

/**
 * The waiting loop of `Scheduler.schedule` (vllm/v1/core/sched/scheduler.py at v0.31.0), full-attention model, no connector,
 * watermark 0 (vllm/config/scheduler.py): peek the head of the FCFS queue; `allocate_slots` with `full_sequence_must_fit`
 * (kv_cache_manager.py) needs cdiv(num_tokens, block_size) blocks for the whole sequence when scheduler_reserve_full_isl is
 * True (the default), else only the blocks of this step's chunk; `if new_blocks is None: break`.
 */
function admitWaiting(opts: { waiting: { id: string; tokens: number }[]; freeBlocks: number; blockSize: number; tokenBudget: number; reserveFullIsl: boolean; onFail: 'break' | 'skip'; order?: 'fcfs' | 'smallest-first' }) {
  const queue = opts.order === 'smallest-first' ? [...opts.waiting].sort((a, b) => a.tokens - b.tokens) : [...opts.waiting]
  let free = opts.freeBlocks
  let budget = opts.tokenBudget
  const admitted: { id: string; chunk: number }[] = []
  for (const req of queue) {
    if (budget <= 0) break
    const chunk = Math.min(req.tokens, budget)
    const needed = opts.reserveFullIsl ? cdiv(req.tokens, opts.blockSize) : cdiv(chunk, opts.blockSize)
    if (needed > free) {
      if (opts.onFail === 'break') break
      continue
    }
    free -= cdiv(chunk, opts.blockSize)
    budget -= chunk
    admitted.push({ id: req.id, chunk })
  }
  return admitted
}

describe('lab 06 question 1: the waiting loop breaks at the first request that fails the full-sequence check', () => {
  const [item] = SCHEDULER_ITEMS
  const base = {
    waiting: [
      { id: 'W1', tokens: 4000 },
      { id: 'W2', tokens: 300 },
      { id: 'W3', tokens: 200 },
    ],
    freeBlocks: 200,
    blockSize: 16,
    tokenBudget: 2048,
  }

  test('the numbers in the stem: 3,200 tokens free; W1 needs 250 blocks; its first chunk is 128 blocks', () => {
    expect(200 * 16).toBe(3200)
    expect(cdiv(4000, 16)).toBe(250)
    expect(cdiv(Math.min(4000, 2048), 16)).toBe(128)
    expect(cdiv(4000, 16)).toBeGreaterThan(200)
    expect(128).toBeLessThanOrEqual(200)
    expect(item.q.q).toContain('200 blocks (3,200 tokens)')
    expect(item.q.options.join(' ')).toContain('250 blocks')
    expect(item.q.options.join(' ')).toContain('128 blocks')
  })

  test('the pinned rule (full-sequence gate on by default, break on failure, fcfs) admits no one: the key', () => {
    expect(admitWaiting({ ...base, reserveFullIsl: true, onFail: 'break' })).toEqual([])
    expect(optionsWith(item, 'No request is admitted', '250 blocks', 'breaks at its failed allocate_slots')).toEqual([item.q.correct[0]])
  })

  test('each wrong option is one wrong rule: first-chunk-only check, skip-and-walk, smallest-first', () => {
    // --no-scheduler-reserve-full-isl: only the 2,048-token chunk (128 blocks) has to fit, so W1 goes in alone
    const chunkOnly = admitWaiting({ ...base, reserveFullIsl: false, onFail: 'break' })
    expect(chunkOnly[0]).toEqual({ id: 'W1', chunk: 2048 })
    expect(optionsWith(item, 'W1 alone', 'first chunk of 2,048 tokens or 128 blocks')).toHaveLength(1)
    // the lab's reference rule: skip what does not fit and keep walking
    expect(admitWaiting({ ...base, reserveFullIsl: true, onFail: 'skip' }).map((a) => a.id)).toEqual(['W2', 'W3'])
    expect(optionsWith(item, 'W2 and W3', 'skips it and keeps walking')).toHaveLength(1)
    // shortest prompt first
    expect(admitWaiting({ ...base, reserveFullIsl: true, onFail: 'break', order: 'smallest-first' }).map((a) => a.id)).toEqual(['W3', 'W2'])
    expect(optionsWith(item, 'W3 and then W2', 'smallest prompts first')).toHaveLength(1)
  })
})

describe('lab 06 question 2: the preemption victim is the last request in the running list', () => {
  const [, item] = SCHEDULER_ITEMS
  /** `self.running[-1]` under the fcfs policy; under the priority policy the max by (priority, arrival_time). */
  const victim = (running: { id: string; blocks: number; priority?: number; arrival?: number }[], policy: 'fcfs' | 'priority') =>
    policy === 'fcfs'
      ? running[running.length - 1]
      : running.reduce((a, b) => ((b.priority ?? 0) > (a.priority ?? 0) || ((b.priority ?? 0) === (a.priority ?? 0) && (b.arrival ?? 0) > (a.arrival ?? 0)) ? b : a))
  const running = [
    { id: 'R1', blocks: 12, priority: 0, arrival: 1 },
    { id: 'R2', blocks: 40, priority: 0, arrival: 2 },
    { id: 'R3', blocks: 5, priority: 0, arrival: 3 },
  ]

  test('fcfs preempts R3, not R2 (the most blocks) and not R1 (the one that asked); R3’s 5 blocks cover R1’s one new block', () => {
    expect(victim(running, 'fcfs').id).toBe('R3')
    const most = running.reduce((a, b) => (b.blocks > a.blocks ? b : a))
    expect(most.id).toBe('R2')
    expect(victim(running, 'fcfs').blocks).toBeGreaterThanOrEqual(1)
    // the stem's numbers
    expect(item.q.q).toContain('R2 holds 40 blocks (the most) and R3 holds 5')
  })

  test('the loop preempts R1 only when R1 is last in `running`', () => {
    expect(victim([running[1], running[2], running[0]], 'fcfs').id).toBe('R1')
  })

  test('the key is the R3 option that also frees, recomputes, queues first and admits nobody; the others are the three wrong rules', () => {
    expect(optionsWith(item, 'It preempts R3, the last request in the running list', 'resets its progress to 0', 'queues it first in waiting', 'admits nobody')).toEqual([item.q.correct[0]])
    expect(optionsWith(item, 'It preempts R2', 'holding the most blocks')).toHaveLength(1)
    expect(optionsWith(item, 'It preempts R1', 'asked for the block')).toHaveLength(1)
    expect(optionsWith(item, 'swaps its blocks to CPU memory')).toHaveLength(1)
  })
})

describe('lab 06 question 3: one token budget, spent on the running requests first', () => {
  const [, , item] = SCHEDULER_ITEMS
  const budget = 2048
  const decoding = 40
  const prompt = 6000

  /** The running loop takes 1 token per decode request; the waiting loop's chunk is min(num_new_tokens, request_token_budget). */
  const chunk = (o: { chunked: boolean; separateBudgets: boolean; capToBudget: boolean }) => {
    const left = o.separateBudgets ? budget : budget - decoding
    if (!o.chunked && prompt > left) return 0
    return o.capToBudget ? Math.min(prompt, left) : prompt
  }

  test('the pinned rule gives 2,008 tokens now and 3,992 in later steps; the whole sequence is 375 blocks', () => {
    const now = chunk({ chunked: true, separateBudgets: false, capToBudget: true })
    expect(now).toBe(2008)
    expect(prompt - now).toBe(3992)
    expect(cdiv(prompt, 16)).toBe(375)
    expect(optionsWith(item, '2,008 tokens', '40 running requests are served first')).toEqual([item.q.correct[0]])
    expect(item.q.why![item.q.correct[0]]).toContain('3,992')
  })

  test('each wrong option is one wrong rule: separate budgets, no cap, chunked prefill off', () => {
    expect(chunk({ chunked: true, separateBudgets: true, capToBudget: true })).toBe(2048)
    expect(optionsWith(item, '2,048 tokens', 'separate budgets')).toHaveLength(1)
    expect(chunk({ chunked: true, separateBudgets: false, capToBudget: false })).toBe(6000)
    expect(optionsWith(item, '6,000 tokens', 'the whole prompt in one step')).toHaveLength(1)
    expect(chunk({ chunked: false, separateBudgets: false, capToBudget: true })).toBe(0)
    expect(optionsWith(item, '0 tokens', 'waits until the running requests finish')).toHaveLength(1)
  })
})
