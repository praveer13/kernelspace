/**
 * Lab 02's Prove-it v2 templates (docs/specs/wave-3.md §7.2, task 3a-22) against the template rule they set for labs
 * 04, 06 and 07: each question is answered from your own code and never from the story alone. For every template a
 * fake correct manager and a fake with the template's named bug answer differently, and one module's answer differs
 * across seeds. The fakes are this file's own: line-protocol block managers over the bridge's verbs, with the free-list
 * order and the bugs as options, checked against the app's reference manager (src/lib/fleet-model.ts).
 */
import { describe, expect, test } from 'bun:test'
import { loadForgeBundle } from '../../src/data/forge'
import bundle from '../../src/data/forge/kv-block-manager'
import { BLOCK, FREE_AFTER, POOL, PROVE2, SHARED_AFTER_APPEND, TRANSLATE } from '../../src/data/forge/kv-block-manager/prove2'
import type { ProveV2Template } from '../../src/data/forge/types'
import { KC } from '../../src/data/kc/ids'
import { RefBlockManager } from '../../src/lib/fleet-model'
import { gradeAnswer, PROVE2_MAX_CALLS, planQuestion, proveFromModule } from '../../src/lib/forge/prove2'
import { fakeBridge } from './fixtures'

/* ------------------------------ fake managers ------------------------------ */

/**
 * How a pool hands blocks out. `lifo`: a stack built 0..n-1 from the top, so a fresh pool gives 0, 1, 2 and a freed block
 * comes back first (the lab's reference). `fifo`: a queue, freed blocks go to the back. `top`: a stack built 0..n-1 from
 * the bottom, so a fresh pool gives 31, 30, … . `lowest`: always the smallest free id (an ordered set).
 */
type Order = 'lifo' | 'fifo' | 'top' | 'lowest'

interface Opts {
  order?: Order
  /** free-after's bug: a block goes back to the pool at its first owner's free, shared or not. */
  freeSharedAtFirstFree?: boolean
  /** shared-after-append's bug: fork copies every block instead of sharing the table. */
  copyOnFork?: boolean
  /** append writes through a shared partial tail (no copy-on-write). */
  noCow?: boolean
  /** append copies a shared tail even when it is full. */
  cowFullTail?: boolean
}

type Handler = (cmd: string) => string

function fakeManager(o: Opts = {}): () => Handler {
  const order = o.order ?? 'lifo'
  return () => {
    let bs = 0
    let pool: number[] = []
    const refs = new Map<number, number>()
    const seqs = new Map<number, { blocks: number[]; len: number }>()
    const take = (): number => {
      if (order === 'fifo') return pool.shift() as number
      if (order === 'lowest') {
        const b = Math.min(...pool)
        pool.splice(pool.indexOf(b), 1)
        return b
      }
      return pool.pop() as number
    }
    const fresh = (): number => {
      const b = take()
      refs.set(b, 1)
      return b
    }
    /** refcount--, back to the pool at 0; `byFree` is `free`'s call, where free-after's bug lives (a copy-on-write's is not). */
    const release = (b: number, byFree = false) => {
      const left = (refs.get(b) ?? 1) - 1
      refs.set(b, left)
      if ((left === 0 || (byFree && o.freeSharedAtFirstFree)) && !pool.includes(b)) pool.push(b)
    }
    return (cmd) => {
      const [op, ...a] = cmd.trim().split(/\s+/)
      const [x, y] = a.map(Number)
      switch (op) {
        case 'init':
          bs = y
          pool = Array.from({ length: x }, (_, i) => i)
          if (order === 'lifo') pool.reverse()
          refs.clear()
          seqs.clear()
          return 'ok'
        case 'allocate': {
          const need = Math.ceil(y / bs)
          if (y === 0 || seqs.has(x) || need > pool.length) return 'false'
          seqs.set(x, { blocks: Array.from({ length: need }, fresh), len: y })
          return 'true'
        }
        case 'fork': {
          const src = seqs.get(x)
          if (!src || seqs.has(y)) return 'false'
          if (o.copyOnFork) {
            seqs.set(y, { blocks: src.blocks.map(fresh), len: src.len })
          } else {
            for (const b of src.blocks) refs.set(b, (refs.get(b) ?? 1) + 1)
            seqs.set(y, { blocks: [...src.blocks], len: src.len })
          }
          return 'true'
        }
        case 'append': {
          const q = seqs.get(x)
          if (!q) return 'false'
          const tail = q.blocks.length - 1
          const partial = q.len % bs !== 0
          const shared = (refs.get(q.blocks[tail]) ?? 1) > 1
          const copy = !o.noCow && shared && (partial || o.cowFullTail === true)
          const extra = Math.ceil((q.len + y) / bs) - q.blocks.length
          if (extra + (copy ? 1 : 0) > pool.length) return 'false'
          if (copy) {
            const b = fresh()
            release(q.blocks[tail])
            q.blocks[tail] = b
          }
          for (let i = 0; i < extra; i++) q.blocks.push(fresh())
          q.len += y
          return 'true'
        }
        case 'free': {
          const q = seqs.get(x)
          seqs.delete(x)
          if (q) for (const b of q.blocks) release(b, true)
          return 'ok'
        }
        case 'translate': {
          const q = seqs.get(x)
          return q && y < q.len ? String(q.blocks[Math.floor(y / bs)]) : 'none'
        }
        case 'free_blocks':
          return String(pool.length)
        default:
          return `err unknown command '${cmd.slice(0, 20)}'`
      }
    }
  }
}

/** The app's reference manager (fleet-model.ts, the Fleet's conformance model) behind the same line protocol. */
function referenceManager(): () => Handler {
  return () => {
    let m: RefBlockManager | null = null
    let bs = 0
    return (cmd) => {
      const [op, ...a] = cmd.trim().split(/\s+/)
      const [x, y] = a.map(Number)
      if (op === 'init') {
        m = new RefBlockManager(x, y)
        bs = y
        return 'ok'
      }
      if (m === null) return 'err not initialized'
      if (op === 'allocate') return String(m.allocate(x, y))
      if (op === 'append') return String(m.append(x, y))
      if (op === 'fork') return String(m.fork(x, y))
      if (op === 'free') return (m.free(x), 'ok')
      if (op === 'free_blocks') return String(m.freeBlocks)
      if (op === 'translate') {
        const q = new Map(m.seqs()).get(x)
        return q && y < q.len ? String(q.blocks[Math.floor(y / bs)]) : 'none'
      }
      return 'err unknown command'
    }
  }
}

const answerOn = async (t: ProveV2Template, seed: number, module: () => Handler): Promise<number> => {
  const replies = await fakeBridge(module).run(new ArrayBuffer(0), planQuestion(t, seed).calls)
  return t.read(replies) as number
}

const SEEDS = [...Array.from({ length: 200 }, (_, i) => i), 4_000_000_000, 0xffffffff, 123_456_789]
const VERBS = ['init', 'allocate', 'append', 'fork', 'free', 'translate', 'free_blocks']
const MEASURE = new Set(['translate', 'free_blocks'])

/* ------------------------------ the bundle ------------------------------ */

describe('lab 02 exposes Prove-it v2', () => {
  test('the bundle carries the three templates, in the order the panel rotates them', async () => {
    expect(bundle.prove2).toBe(PROVE2)
    expect(PROVE2.templates.map((t) => t.id)).toEqual(['free-after', 'translate', 'shared-after-append'])
    expect((await loadForgeBundle('kv-block-manager')).prove2?.templates.map((t) => t.id)).toEqual(['free-after', 'translate', 'shared-after-append'])
  })

  test('each template names the KCs of the checks it exercises and the bug its test separates', () => {
    expect(FREE_AFTER.kcs).toEqual([KC.blockRefcounts])
    expect(TRANSLATE.kcs).toEqual([KC.blockTables, KC.kvCopyOnWrite])
    expect(SHARED_AFTER_APPEND.kcs).toEqual([KC.kvCopyOnWrite, KC.blockRefcounts])
    for (const t of PROVE2.templates) expect(t.bug.length).toBeGreaterThan(20)
  })
})

/* ------------------------------ the trace contract ------------------------------ */

describe('every trace is at most 12 calls of the bridge verbs, told in words, with a number to predict', () => {
  test('on every seed: 1 to 12 calls, an init of the 32-block pool first, only the seven verbs, a numeric answer', () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        expect(q.calls.length).toBeLessThanOrEqual(PROVE2_MAX_CALLS)
        expect(q.calls[0]).toBe(`init ${POOL} ${BLOCK}`)
        for (const c of q.calls) expect(VERBS).toContain(c.split(' ')[0])
        expect(q.answer).toBe('number')
        expect(q.ask.endsWith('?') || q.ask.endsWith(')')).toBe(true)
      }
    }
  })

  test('the story tells every call that changes state, in order, with its numbers; the ask names what is measured', () => {
    const verbOf: Record<string, RegExp> = { allocate: /^Allocate sequence (\d+) with (\d+) tokens?\.$/, append: /^Append (\d+) tokens? to sequence (\d+)\.$/, fork: /^Fork sequence (\d+) as sequence (\d+)\.$/, free: /^Free sequence (\d+)\.$/ }
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const told = q.calls.slice(1).filter((c) => !MEASURE.has(c.split(' ')[0]))
        expect(q.story).toHaveLength(told.length + 1)
        expect(q.story[0]).toContain(`${POOL} blocks of ${BLOCK} tokens`)
        told.forEach((c, i) => {
          const [op, ...args] = c.split(' ')
          const m = verbOf[op].exec(q.story[i + 1])
          expect(m).not.toBeNull()
          // The story says "append 5 tokens to sequence 2" for `append 2 5`: the same numbers, in either order.
          expect([...(m as RegExpExecArray).slice(1)].sort()).toEqual([...args].sort())
        })
        const measured = q.calls.filter((c) => MEASURE.has(c.split(' ')[0]))
        expect(measured.length).toBeGreaterThan(0)
        if (measured[0].startsWith('translate')) for (const c of measured) expect(q.ask).toContain(c.split(' ')[2])
        else expect(q.ask).toContain('free_blocks')
      }
    }
  })

  test('together the templates drive init, allocate, append, fork, free, translate and free_blocks', () => {
    const used = new Set(PROVE2.templates.flatMap((t) => SEEDS.flatMap((s) => planQuestion(t, s).calls.map((c) => c.split(' ')[0]))))
    expect([...used].sort()).toEqual([...VERBS].sort())
  })

  test('the same seed gives the same question', () => {
    for (const t of PROVE2.templates) expect(planQuestion(t, 77)).toEqual(planQuestion(t, 77))
  })

  test('no trace comes near the pool: every allocate, fork and append succeeds on a correct manager', async () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) {
        const q = planQuestion(t, seed)
        const replies = await fakeBridge(fakeManager()).run(new ArrayBuffer(0), q.calls)
        q.calls.forEach((c, i) => {
          if (/^(allocate|append|fork) /.test(c)) expect(replies[i]).toBe('true')
          if (c.startsWith('translate')) expect(replies[i]).toMatch(/^\d+$/)
        })
      }
    }
  })
})

/* ------------------------------ the rule: your code, not the story ------------------------------ */

describe('the fakes stand for real managers', () => {
  test('the default fake answers every template as the app\'s reference manager does', async () => {
    for (const t of PROVE2.templates) {
      for (const seed of SEEDS) expect(await answerOn(t, seed, fakeManager())).toBe(await answerOn(t, seed, referenceManager()))
    }
  })

  test('free-after and shared-after-append do not depend on the free-list order: any correct manager gives one answer', async () => {
    for (const t of [FREE_AFTER, SHARED_AFTER_APPEND]) {
      for (const seed of SEEDS.slice(0, 60)) {
        const answers = new Set<number>()
        for (const order of ['lifo', 'fifo', 'top', 'lowest'] as const) answers.add(await answerOn(t, seed, fakeManager({ order })))
        expect(answers.size).toBe(1)
      }
    }
  })
})

describe('a plausible bug changes the answer, and the answer differs across seeds', () => {
  const across = async (t: ProveV2Template, module: () => Handler) => {
    const answers = new Set<number>()
    for (const seed of SEEDS) answers.add(await answerOn(t, seed, module))
    return answers
  }

  test('free-after: freeing a shared block at its first owner\'s free answers more blocks free, on every seed', async () => {
    for (const seed of SEEDS) {
      const right = await answerOn(FREE_AFTER, seed, fakeManager())
      expect(await answerOn(FREE_AFTER, seed, fakeManager({ freeSharedAtFirstFree: true }))).toBeGreaterThan(right)
    }
    expect((await across(FREE_AFTER, fakeManager())).size).toBeGreaterThanOrEqual(5)
  })

  test('worked by hand: seed 1 of each template, its story and the answers', async () => {
    // Sequence 1 takes 3 blocks (43 tokens); the fork shares them; appending 14 to 2 copies the partial tail and adds a
    // block (4); 3 takes 1; appending 25 to 1 fills its own tail and adds 2 (5). Freeing 1 keeps the 2 blocks 2 still
    // shares and returns 3: 4 + 1 held, 27 free. Returning the shared 2 as well leaves 29.
    expect(planQuestion(FREE_AFTER, 1).story.slice(1)).toEqual([
      'Allocate sequence 1 with 43 tokens.',
      'Fork sequence 1 as sequence 2.',
      'Append 14 tokens to sequence 2.',
      'Allocate sequence 3 with 1 token.',
      'Append 25 tokens to sequence 1.',
      'Free sequence 1.',
    ])
    expect(await answerOn(FREE_AFTER, 1, fakeManager())).toBe(27)
    expect(await answerOn(FREE_AFTER, 1, fakeManager({ freeSharedAtFirstFree: true }))).toBe(29)
    // 1 takes 0, 1, 2 and 2 takes 3, 4; freeing 1 puts 0, 1, 2 back. Appending 30 to 3 copies its partial tail (17 tokens)
    // and adds one block, so token 26 sits in the copy. A stack hands out 2 (the last freed), a queue 5 (never used yet),
    // and a stack built from the top (31 first) 29.
    expect(planQuestion(TRANSLATE, 1).calls).toEqual(['init 32 16', 'allocate 1 35', 'allocate 2 17', 'free 1', 'fork 2 3', 'append 3 30', 'translate 3 26'])
    expect(await answerOn(TRANSLATE, 1, fakeManager({ order: 'lifo' }))).toBe(2)
    expect(await answerOn(TRANSLATE, 1, fakeManager({ order: 'fifo' }))).toBe(5)
    expect(await answerOn(TRANSLATE, 1, fakeManager({ order: 'top' }))).toBe(29)
    // 25 tokens is 2 blocks with a partial tail; the append to 2 copies the tail, so 1 block is still shared.
    expect(planQuestion(SHARED_AFTER_APPEND, 1).story.slice(1)).toEqual(['Allocate sequence 1 with 25 tokens.', 'Fork sequence 1 as sequence 2.', 'Append 10 tokens to sequence 2.'])
    expect(planQuestion(SHARED_AFTER_APPEND, 1).ask).toContain('tokens 0 and 16 of both')
    expect(await answerOn(SHARED_AFTER_APPEND, 1, fakeManager())).toBe(1)
    expect(await answerOn(SHARED_AFTER_APPEND, 1, fakeManager({ copyOnFork: true }))).toBe(0)
  })

  test('translate: the oldest free block (FIFO) and the newest freed (LIFO) answer differently on every seed', async () => {
    for (const seed of SEEDS) {
      expect(await answerOn(TRANSLATE, seed, fakeManager({ order: 'fifo' }))).not.toBe(await answerOn(TRANSLATE, seed, fakeManager({ order: 'lifo' })))
    }
    for (const order of ['lifo', 'fifo', 'top', 'lowest'] as const) expect((await across(TRANSLATE, fakeManager({ order }))).size).toBeGreaterThanOrEqual(4)
  })

  test('translate reads your own pool: every pair of the four orders disagrees on some seed', async () => {
    const orders = ['lifo', 'fifo', 'top', 'lowest'] as const
    const answers = await Promise.all(orders.map((order) => Promise.all(SEEDS.map((s) => answerOn(TRANSLATE, s, fakeManager({ order }))))))
    for (let i = 0; i < orders.length; i++) {
      for (let j = i + 1; j < orders.length; j++) expect(answers[i].some((a, k) => a !== answers[j][k])).toBe(true)
    }
  })

  test('translate asks for a block taken after the free, never one the story fixes', async () => {
    // The asked token's block belongs to sequence 3 alone (its copied tail or a new block), so it was taken from the pool
    // after the free and is never sequence 2's block for the same token: the answer is your pool's order, not the fork's.
    for (const seed of SEEDS) {
      const q = planQuestion(TRANSLATE, seed)
      const token = Number(q.calls[q.calls.length - 1].split(' ')[2])
      const calls = [...q.calls, `translate 2 ${token}`]
      const replies = await fakeBridge(fakeManager()).run(new ArrayBuffer(0), calls)
      expect(replies[replies.length - 1]).not.toBe(replies[replies.length - 2])
    }
  })

  test('shared-after-append: copying on fork shares nothing, on every seed; a copy on a full tail or none at all is off by one on some', async () => {
    const offBy = { cowFullTail: 0, noCow: 0 }
    for (const seed of SEEDS) {
      const q = planQuestion(SHARED_AFTER_APPEND, seed)
      const parent = Number(q.calls[1].split(' ')[2])
      const right = await answerOn(SHARED_AFTER_APPEND, seed, fakeManager())
      expect(right).toBe(Math.floor(parent / BLOCK))
      expect(await answerOn(SHARED_AFTER_APPEND, seed, fakeManager({ copyOnFork: true }))).toBe(0)
      if ((await answerOn(SHARED_AFTER_APPEND, seed, fakeManager({ cowFullTail: true }))) !== right) offBy.cowFullTail++
      if ((await answerOn(SHARED_AFTER_APPEND, seed, fakeManager({ noCow: true }))) !== right) offBy.noCow++
    }
    expect(offBy.cowFullTail).toBeGreaterThan(SEEDS.length / 5)
    expect(offBy.noCow).toBeGreaterThan(SEEDS.length / 5)
    expect([...(await across(SHARED_AFTER_APPEND, fakeManager()))].sort()).toEqual([1, 2, 3, 4])
  })
})

/* ------------------------------ through the core ------------------------------ */

describe('graded by the core against your module', () => {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 2]).buffer
  const hash = async () => 'ab'.repeat(32)

  test('the right answer on the module the unseen run graded is proved; the bug\'s answer is a miss that shows the module\'s', async () => {
    for (const t of PROVE2.templates) {
      const seed = 31
      const plan = planQuestion(t, seed)
      const right = await answerOn(t, seed, fakeManager())
      const bugged = t === TRANSLATE ? fakeManager({ order: 'fifo' }) : fakeManager(t === FREE_AFTER ? { freeSharedAtFirstFree: true } : { copyOnFork: true })
      const wrong = await answerOn(t, seed, bugged)
      expect(wrong).not.toBe(right)
      const go = (answer: number) =>
        proveFromModule({ labId: 'kv-block-manager', template: t, plan, answer, bytes, graded: { sha256: 'ab'.repeat(32), credit: 'unseen' }, history: [], now: 0, run: fakeBridge(fakeManager()).run, hash })
      const hit = await go(right)
      const miss = await go(wrong)
      if (hit.kind !== 'graded' || miss.kind !== 'graded') throw new Error('refused')
      expect(hit.result).toMatchObject({ provenance: 'proved', score: 1, seed, data: { v: 2, qid: t.id, answer: right, actual: right, calls: plan.calls.length } })
      expect(miss.result).toMatchObject({ provenance: 'practice', score: 0, data: { answer: wrong, actual: right } })
    }
  })

  test('a module that replies anything but a number fails the trace instead of being read as an answer', () => {
    for (const t of PROVE2.templates) {
      const plan = planQuestion(t, 9)
      const replies = plan.calls.map((c) => (c.startsWith('translate') ? 'none' : c === 'free_blocks' ? 'err not initialized' : 'true'))
      expect(gradeAnswer(t, 1, { kind: 'replied', replies })).toMatchObject({ right: false, actual: null, failed: 'error' })
    }
  })
})
