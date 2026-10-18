/**
 * The protégé block (docs/specs/wave-3.md §16.9; task 3s-11): the type's authoring rules, the question each step asks, the
 * `protege` item pool a fixture lesson passes, the markdown export that withholds the keys, and the block mounted in a
 * small DOM (tests/dom/mini-dom.ts): find, tag and fix unlock in order, the false line is struck through once found and stays
 * so, and every attempt is a ledger event. A real browser (focus ring, reflow at 360 px) is the a11y harness.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { blockToMd, lessonToMd } from '../../scripts/export-lessons-md'
import { checkPoolItems, collectProtegeItems, PROTEGE_POOL, protegeFailures } from '../../scripts/item-pools'
import { poolCueFailures } from '../../scripts/item-cues'
import ProtegeBlockView from '../../src/components/blocks/ProtegeBlock'
import { ALL_LESSONS, TRACK_IDS } from '../../src/data/lessons'
import type { Lesson, ProtegeBlock } from '../../src/data/lessons/types'
import { gradeItem, playView, resultFor } from '../../src/lib/items/play'
import {
  correction,
  findQuestion,
  protegeErrors,
  protegeKcs,
  protegeNumber,
  sentenceLabel,
  stepItem,
  stepQuestion,
  stepRef,
  stepResponse,
} from '../../src/lib/learner/protege'
import { validateEvent } from '../../src/lib/ledger/codec'
import { isPreregSigned } from '../../src/lib/learner/outcomes'
import type { ItemResponse } from '../../src/lib/ledger/types'
import { useProgress } from '../../src/lib/progress'
import { RenderBlock } from '../../src/pages/lesson/blocks'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

/** Sam explains the paged KV cache; sentence 4 (index 3) is false: a paged cache never compacts (wave-3.md D58). */
const SAM: ProtegeBlock = {
  type: 'protege',
  title: 'Sam explains the paged KV cache',
  setup: 'Sam is new on the serving team and wrote this for the wiki.',
  sentences: [
    "A paged KV cache cuts the GPU's KV memory into fixed-size blocks, for example 16 tokens each.",
    'Each sequence keeps a block table that maps its logical block numbers to physical blocks.',
    'When a sequence fills its last block, the engine hands it any free block from the pool, wherever that block sits.',
    'When free blocks end up scattered, the engine compacts the pool by copying live blocks together.',
    'A sequence therefore wastes at most the unused tail of its last block.',
  ],
  falseAt: 3,
  find: {
    offer: [1, 2, 3, 4],
    why: [
      'True: the block table is the per-sequence map from logical block numbers to physical blocks, which is why the blocks need not be adjacent.',
      'True: any free block will do, since the table records where each logical block went, so the engine never looks for a gap.',
      'False: no free-space hole in a paged pool is too small, because every block is the same size, so there is nothing to compact.',
      'True: blocks are taken on demand, so the only unfilled space a sequence holds is the tail of its last block.',
    ],
  },
  tag: {
    q: 'Which mistaken idea sits behind the false sentence?',
    options: [
      'Treating the KV pool like a heap whose free space must be contiguous',
      'Mixing up the block table with the CPU page table that hardware walks',
      'Assuming each token needs a block of its own, so blocks are scarce',
      'Believing a freed block must be wiped before another sequence reuses it',
    ],
    correct: [0],
    why: [
      'Right: compaction answers external fragmentation, which same-size blocks cannot have, so a paged pool has nothing to compact.',
      'A real mix-up, but not this one: the false sentence is about moving blocks, not about who walks the table.',
      'Not this one: a block holds many tokens, and the false sentence never says how many.',
      'Not this one: reuse and wiping are never mentioned; the false sentence is about copying blocks together.',
    ],
    miss: ['confuse.heap-compaction', '', '', ''],
  },
  fix: {
    q: 'Which sentence should replace sentence 4?',
    options: [
      'Free blocks can stay scattered across the pool, since a block table lets a sequence use any of them without a copy.',
      'The engine moves the blocks of a finished sequence together, so the pool is tidy for the next request to arrive at once.',
      'The engine reserves a maximum length for each sequence on arrival, so the pool never needs another block for it.',
      'The engine halves the block size when free blocks run out, so smaller holes can still be filled by a sequence.',
    ],
    correct: [0],
    why: [
      'Right: identical blocks leave no holes, so scattered free blocks cost nothing and nothing is copied to make room.',
      'Wrong: it still moves blocks to tidy the pool, which a block table makes pointless.',
      'Wrong: reserving the maximum up front is what paging replaced; it wastes the memory the block table saves.',
      'Wrong: the block size is fixed, and changing it would invalidate every block table.',
    ],
  },
  kcs: ['t5.block-tables'],
}

/** Sam explains batching a decode step; sentence 3 (index 2) is false: a decode step's cost does not grow with the batch while it is memory-bound. */
const SAM_BATCH: ProtegeBlock = {
  type: 'protege',
  title: 'Sam explains batching a decode step',
  setup: 'Sam sat in on a performance review and wrote this summary.',
  sentences: [
    'A decode step produces one new token for every sequence in the batch.',
    'A dense model reads its weights from HBM once per step and uses them for every sequence in the batch.',
    'So doubling the batch doubles the step time, and batching cannot raise throughput.',
    "Each sequence's own KV cache is also read, and that traffic does grow with the batch.",
    'Once the step is compute-bound, a larger batch no longer raises throughput.',
  ],
  falseAt: 2,
  find: {
    offer: [1, 2, 3, 4],
    why: [
      'True: the weight read is a fixed cost per step, shared by every sequence in the batch, which is where batching gets its gain.',
      'False: while the step is memory-bound the weight read dominates and does not grow with the batch, so the step time rises far less than the batch does.',
      'True: each sequence has its own KV cache, so that part of the traffic grows with the batch and eventually limits it.',
      'True: past the ridge point the step is limited by compute, so a larger batch adds time in proportion and throughput levels off.',
    ],
  },
  tag: {
    q: 'Which mistaken idea sits behind the false sentence?',
    options: [
      'Assuming decode stays compute-bound as the batch grows',
      'Believing each sequence needs its own copy of the weights in HBM',
      'Mixing up time to first token with time per output token',
      'Thinking the KV cache is read once per batch, not once per sequence',
    ],
    correct: [0],
    why: [
      'Right: if the step stayed compute-bound as the batch grows its time would grow with the batch; while it is memory-bound the shared weight read dominates instead.',
      'Not this one: the false sentence says nothing about how many copies of the weights exist, and one copy serves the whole batch.',
      'Not this one: both latencies are untouched by the false sentence, which is about the step time as the batch grows.',
      'Not this one: the sentence after it states the per-sequence KV read correctly, and it is not what makes the step time grow.',
    ],
  },
  fix: {
    q: 'Which sentence should replace sentence 3?',
    options: [
      'While the weight read dominates the step, doubling the batch adds little time so throughput nearly doubles.',
      'Doubling the batch halves the time of each step, because the work is split across the sequences and each does less.',
      'Doubling the batch leaves throughput unchanged, because the step must still read the weights for each sequence in turn.',
      'Doubling the batch doubles throughput at any size, because the step time stays fixed however large the batch becomes.',
    ],
    correct: [0],
    why: [
      'Right: the weight read is paid once per step, so a bigger batch adds little time until the step turns compute-bound.',
      'Wrong: splitting the work does not shorten a step, which still reads the same weights; a bigger batch makes it no faster.',
      'Wrong: the weights are read once per step for the whole batch, not once per sequence, so throughput does rise.',
      'Wrong: "at any size" fails once the step is compute-bound or the KV traffic dominates, where the step time grows with the batch.',
    ],
  },
  kcs: ['t4.roofline'],
}

/** Sam explains the prefix cache; sentence 3 (index 2) is false: a block's KV depends on every token before it. */
const SAM_PREFIX: ProtegeBlock = {
  type: 'protege',
  title: 'Sam explains the prefix cache',
  setup: 'Sam is writing up why two requests with one system prompt got faster.',
  sentences: [
    'Requests that open with the same system prompt compute the same KV for those tokens.',
    'A prefix cache keeps those blocks, so a later request can skip computing them during prefill.',
    'A cached block is reused for any request that contains the same tokens, at any position in its prompt.',
    'A hit shortens prefill only; the request still decodes every output token itself.',
    'A request that matches nothing prefills its whole prompt, as it would without the cache.',
  ],
  falseAt: 2,
  find: {
    offer: [1, 2, 3, 4],
    why: [
      'True: a block of KV can be kept after its request ends and found again, which is all a prefix cache does.',
      "False: a token's KV depends on every token before it, so the same tokens at another position, or after a different start, have different KV.",
      'True: a hit saves prefill compute only, and the request decodes its own output as usual.',
      'True: with no match there is nothing to reuse, so the prompt is prefilled in full as it would be without the cache.',
    ],
  },
  tag: {
    q: 'Which mistaken idea sits behind the false sentence?',
    options: [
      "Assuming a block's contents depend on its own tokens and nothing before them",
      'Believing a cached block is freed the moment its request ends and its slot is reused',
      'Thinking a prefix hit also lets the request skip decoding',
      'Mixing up the block size with the number of cached requests',
    ],
    correct: [0],
    why: [
      "Right: a block's KV also depends on the tokens before it, so the same tokens after a different start are a different block.",
      'Not this one: how long a block stays cached is not what the false sentence gets wrong.',
      'Not this one: the sentence after it states correctly that a hit saves prefill only.',
      'Not this one: the false sentence is about which blocks match, not about how many there are or how big.',
    ],
  },
  fix: {
    q: 'Which sentence should replace sentence 3?',
    options: [
      'A block is reused only when every token before it matches too, so a hit is a shared prefix from the start of the prompt.',
      'A block is reused when its tokens match and it sits at the same position, whatever tokens came before it in the same prompt.',
      'A block is reused only by the request that created it, so a hit means the same request is sent again to the engine once more.',
      'A block is reused when the hash of the whole prompt matches, so any change at all makes the lookup miss in full.',
    ],
    correct: [0],
    why: [
      'Right: the key of a block covers the tokens before it, so a match starts at the first token and runs until the first difference.',
      'Wrong: the same tokens at the same position after a different start still have different KV.',
      'Wrong: sharing across requests is the point of a prefix cache, and the blocks outlive the request that made them.',
      'Wrong: the lookup goes block by block along the prefix, so a change late in the prompt still leaves the earlier blocks to hit.',
    ],
  },
  kcs: ['t5.prefix-cache-keys'],
}

const prose = { type: 'prose', md: 'x' } as const
const lessonOf = (blocks: Lesson['blocks'], id = 't9.l1'): Lesson => ({ id, slug: 'x', trackId: 't5', index: 1, title: 'x', minutes: 5, hook: 'x', exercise: 'none', kcs: ['kc.lesson'], blocks }) as unknown as Lesson

describe('the type and its authoring rules', () => {
  test('the fixture is a valid block', () => {
    expect(protegeErrors(SAM)).toEqual([])
  })

  test('4 to 6 sentences', () => {
    for (const k of [0, 3, 7]) expect(protegeErrors({ ...SAM, sentences: Array.from({ length: k }, (_, i) => `s${i}`) })[0]).toContain(`${k} sentences`)
    const six = { ...SAM, sentences: [...SAM.sentences, 'Blocks of one sequence can be shared with another.'] }
    // a 6-sentence passage offers 4 sentences, the false one among them, and the offer needs a why per sentence
    expect(protegeErrors(six)).toEqual([])
    expect(protegeErrors({ ...six, find: { offer: [0, 2, 3, 5], why: ['a', 'b', 'c', 'd'] } })).toEqual([])
    expect(protegeErrors({ ...six, find: { offer: [3, 5], why: ['a', 'b'] } })).toContain('find.offer has 2 sentences; a 6-sentence passage offers 4')
  })

  test('exactly one false sentence, inside the passage and inside the offer', () => {
    expect(protegeErrors({ ...SAM, falseAt: 5 })[0]).toContain('falseAt 5')
    expect(protegeErrors({ ...SAM, falseAt: -1 })[0]).toContain('falseAt -1')
    expect(protegeErrors({ ...SAM, falseAt: 0 })).toContain('find.offer does not include the false sentence')
    expect(protegeErrors({ ...SAM, find: { ...SAM.find, offer: [1, 2, 3, 9] } })).toContain('find.offer must be distinct sentence indices')
    expect(protegeErrors({ ...SAM, find: { ...SAM.find, offer: [1, 3, 3, 4] } })).toContain('find.offer must be distinct sentence indices')
  })

  test('a 4-sentence passage offers all four; a longer one offers four', () => {
    const four = { ...SAM, sentences: SAM.sentences.slice(0, 4), find: { offer: [0, 1, 2, 3], why: ['a', 'b', 'c', 'd'] } }
    expect(protegeErrors(four)).toEqual([])
    expect(protegeErrors({ ...four, find: { offer: [0, 3], why: ['a', 'b'] } })).toContain('find.offer has 2 sentences; a 4-sentence passage offers 4')
  })

  test('a why per offered sentence, one key per authored question, and a fix that is not the false line', () => {
    expect(protegeErrors({ ...SAM, find: { ...SAM.find, why: ['only one'] } })).toContain('find.why has 1 entries for 4 offered sentences')
    expect(protegeErrors({ ...SAM, tag: { ...SAM.tag, correct: [0, 1], multi: true } })).toContain('tag must have exactly one correct option')
    expect(protegeErrors({ ...SAM, fix: { ...SAM.fix, correct: [] } })).toContain('fix must have exactly one correct option')
    const same = { ...SAM, fix: { ...SAM.fix, options: [SAM.sentences[3], ...SAM.fix.options.slice(1)] } }
    expect(protegeErrors(same)).toContain('the fix key is the false sentence itself')
    const dup = { ...SAM, fix: { ...SAM.fix, options: [SAM.sentences[1], ...SAM.fix.options.slice(1)] } }
    expect(protegeErrors(dup)).toContain('the fix key repeats one of the true sentences')
  })

  test('two identical sentences are refused', () => {
    expect(protegeErrors({ ...SAM, sentences: [SAM.sentences[0], SAM.sentences[0], ...SAM.sentences.slice(2)] })).toContain('two sentences are the same text')
  })
})

describe('the three questions', () => {
  test('find offers sentence numbers, the false one is the key, and each option has its why', () => {
    const q = findQuestion(SAM)
    expect(q.options).toEqual(['Sentence 2', 'Sentence 3', 'Sentence 4', 'Sentence 5'])
    expect(q.correct).toEqual([2])
    expect(q.options[q.correct[0]]).toBe(sentenceLabel(SAM.falseAt))
    expect(q.why).toEqual(SAM.find.why)
    expect(q.q).toContain(SAM.title)
    // the question never repeats the passage, so the passage is read where it is shown
    for (const s of SAM.sentences) expect(q.q + q.options.join(' ')).not.toContain(s)
  })

  test('the find key follows the offer order, not the sentence order', () => {
    expect(findQuestion({ ...SAM, find: { offer: [3, 1, 4, 2], why: ['a', 'b', 'c', 'd'] } }).correct).toEqual([0])
  })

  test('tag and fix are the authored questions, and the correction is the fix key', () => {
    expect(stepQuestion(SAM, 'tag')).toBe(SAM.tag)
    expect(stepQuestion(SAM, 'fix')).toBe(SAM.fix)
    expect(stepQuestion(SAM, 'find')).toEqual(findQuestion(SAM))
    expect(correction(SAM)).toBe(SAM.fix.options[0])
  })

  test('numbering counts the lesson\'s protégé blocks from 1; the ref is item:<lesson>.protege.<n>.<step>', () => {
    const second = { ...SAM, title: 'Sam again' }
    const lesson = lessonOf([prose, SAM, prose, second])
    expect(protegeNumber(lesson, SAM)).toBe(1)
    expect(protegeNumber(lesson, second)).toBe(2)
    expect(protegeNumber(lesson, { ...SAM })).toBe(0)
    expect(stepRef('t4.l3', 2, 'fix')).toBe('item:t4.l3.protege.2.fix')
  })

  test('the KCs are the block\'s, else the lesson\'s, at most six', () => {
    expect(protegeKcs(SAM, ['kc.lesson'])).toEqual(['t5.block-tables'])
    expect(protegeKcs({ ...SAM, kcs: undefined }, ['kc.lesson'])).toEqual(['kc.lesson'])
    expect(protegeKcs({ kcs: Array.from({ length: 9 }, (_, i) => `k${i}`) })).toHaveLength(6)
  })
})

describe('the protege pool: a fixture lesson passes verify:items\' pool gates', () => {
  const lesson = lessonOf([prose, SAM])

  test('three items per block, refs item:<lesson>.protege.<n>.<find|tag|fix>, the block\'s KCs', () => {
    const pool = collectProtegeItems([lesson])
    expect(pool.map((p) => p.ref)).toEqual(['item:t9.l1.protege.1.find', 'item:t9.l1.protege.1.tag', 'item:t9.l1.protege.1.fix'])
    expect(pool.every((p) => p.pool === PROTEGE_POOL && p.lessonId === 't9.l1' && p.kcs?.[0] === 't5.block-tables')).toBe(true)
    const two = collectProtegeItems([lessonOf([SAM, prose, SAM])])
    expect(two.map((p) => p.ref.replace('item:t9.l1.protege.', ''))).toEqual(['1.find', '1.tag', '1.fix', '2.find', '2.tag', '2.fix'])
  })

  // three blocks, nine items: a pool of three cannot be judged, because one strategy's full hit on one item is already 1.25 of 3 beside the find item's ties
  const fixture = lessonOf([prose, SAM, prose, SAM_BATCH, SAM_PREFIX], 't9.l2')

  test('every item has a why per option and passes the option structure', () => {
    const { valid, failures } = checkPoolItems(collectProtegeItems([lesson]))
    expect(failures).toEqual([])
    expect(valid).toHaveLength(3)
    expect(protegeFailures([lesson])).toEqual([])
    expect(checkPoolItems(collectProtegeItems([fixture])).failures).toEqual([])
    expect(protegeFailures([fixture])).toEqual([])
  })

  test('the fixture lesson passes the pool\'s cue gates: no blind strategy and no odd-one-out separates the key', () => {
    const pool = collectProtegeItems([fixture])
    expect(pool).toHaveLength(9)
    expect(poolCueFailures(PROTEGE_POOL, pool)).toEqual([])
  })

  test('an item without its whys, or a block with a defect, fails the gates', () => {
    const bare = { ...SAM, tag: { ...SAM.tag, why: undefined } }
    expect(checkPoolItems(collectProtegeItems([lessonOf([bare])])).failures).toEqual(['structure: item:t9.l1.protege.1.tag (protege): missing per-option why'])
    const short = { ...SAM, fix: { ...SAM.fix, why: ['one'] } }
    expect(checkPoolItems(collectProtegeItems([lessonOf([short])])).failures[0]).toContain('why has 1 entries for 4 options')
    expect(protegeFailures([lessonOf([{ ...SAM, falseAt: 8 }])])[0]).toBe('protege: item:t9.l1.protege.1 "Sam explains the paged KV cache": falseAt 8 is not a sentence index (0 to 4)')
  })

  test('the cue gates bind the pool: a fix whose key is always the longest is caught', () => {
    const lessons = Array.from({ length: 6 }, (_, i) => lessonOf([{ ...SAM, fix: { ...SAM.fix, options: [SAM.fix.options[0] + ' and then a long tail of words nobody needs', ...SAM.fix.options.slice(1)] } }], `t9.l${i}`))
    expect(poolCueFailures(PROTEGE_POOL, collectProtegeItems(lessons)).some((p) => p.includes('1st-longest'))).toBe(true)
  })

  test('the shipped lessons: every protégé block that exists is well-formed and numbered as the pool numbers it', () => {
    expect(protegeFailures(ALL_LESSONS)).toEqual([])
    expect(checkPoolItems(collectProtegeItems(ALL_LESSONS)).failures).toEqual([])
    for (const l of ALL_LESSONS) {
      const mine = l.blocks.filter((b): b is ProtegeBlock => b.type === 'protege')
      expect(collectProtegeItems([l]).map((p) => p.ref)).toEqual(mine.flatMap((b) => (['find', 'tag', 'fix'] as const).map((s) => stepRef(l.id, protegeNumber(l, b), s))))
    }
  })
})

describe('verify:items runs the fixture lesson through every gate', () => {
  const root = new URL('../../', import.meta.url).pathname
  const fixture = lessonOf([prose, SAM, prose, SAM_BATCH, SAM_PREFIX], 't9.l2')
  /** The shipped lessons' protégé items (3s-12: one block per track), which the pool holds beside the fixture's nine. */
  const shipped = collectProtegeItems(ALL_LESSONS).length

  /** Run scripts/verify-items.ts with `lessons` added to the protege pool (VERIFY_ITEMS_PROTEGE_FIXTURE: a module whose default export is a lesson list). */
  const run = (lessons: unknown[], ...args: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'protege-e2e-'))
    try {
      const file = join(dir, 'fixture.mjs')
      writeFileSync(file, `export default ${JSON.stringify(lessons)}\n`)
      const r = Bun.spawnSync(['bun', 'scripts/verify-items.ts', ...args], { cwd: root, env: { ...process.env, VERIFY_ITEMS_PROTEGE_FIXTURE: file } })
      return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test('a fixture lesson with three well-formed blocks passes the whole run; the protege row counts its nine items beside the shipped ones', () => {
    const r = run([fixture])
    expect(r.err).toBe('')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(new RegExp(`^ {2}protege\\s+${9 + shipped}\\s`, 'm'))
    expect(r.out.trimEnd().endsWith('verify-items: ok')).toBe(true)
    expect(r.out).not.toContain('FAIL')
  }, 60_000)

  test('--subset on the protege refs reports them, with n printed', () => {
    const r = run([fixture], '--subset', '/\\.protege\\./')
    expect(r.code).toBe(0)
    expect(r.out).toContain(`${9 + shipped} item(s) selected, n = ${9 + shipped} single-key`)
    expect(r.out).toContain(`selected by pool: protege ${9 + shipped}`)
    expect(r.out).toContain('verify-items --subset: ok')
  }, 60_000)

  test('the shipped tree alone: the protege row counts the shipped blocks, one or more in every track (3s-12)', () => {
    const none = Bun.spawnSync(['bun', 'scripts/verify-items.ts'], { cwd: root })
    expect(none.exitCode).toBe(0)
    const blocks = ALL_LESSONS.flatMap((l) => l.blocks).filter((b) => b.type === 'protege').length
    expect(blocks * 3).toBe(shipped)
    expect(new Set(ALL_LESSONS.filter((l) => l.blocks.some((b) => b.type === 'protege')).map((l) => l.trackId))).toEqual(new Set(TRACK_IDS))
    expect(none.stdout.toString()).toMatch(new RegExp(`^ {2}protege\\s+${shipped}\\b`, 'm'))
  }, 60_000)

  test('a defective block fails the run with a line naming it, and so does a pool whose key is always the longest', () => {
    const bad = run([lessonOf([{ ...SAM, falseAt: 9 }], 't9.l3')])
    expect(bad.code).toBe(1)
    expect(bad.err).toContain('protege: item:t9.l3.protege.1 "Sam explains the paged KV cache": falseAt 9 is not a sentence index')
    // the tag and fix keys (option 0 in each fixture) made the longest option, in enough copies that the shipped items,
    // which keep the pool near chance, cannot dilute the strategy under its limit
    const tail = (q: ProtegeBlock['fix']) => ({ ...q, options: [q.options[0] + ' and then a long tail of words nobody needs', ...q.options.slice(1)] })
    const longest = (b: ProtegeBlock): ProtegeBlock => ({ ...b, tag: tail(b.tag), fix: tail(b.fix) })
    const leaky = run(Array.from({ length: Math.max(4, Math.ceil(shipped / 9)) }, (_, i) => lessonOf([longest(SAM), longest(SAM_BATCH), longest(SAM_PREFIX)], `t9.m${i}`)))
    expect(leaky.code).toBe(1)
    expect(leaky.err).toContain("the strategy '1st-longest' hits")
    expect(leaky.err).toContain('protege items on their own')
  }, 60_000)
})

describe('the ledger events', () => {
  test('a step is played as item:<lesson>.protege.<n>.<step>, and its response records src lesson, the pick, the KCs and the miss id', () => {
    const item = stepItem('t9.l1', 1, SAM, 'tag', ['kc.lesson'])
    expect(item).toEqual({ source: 'item', item: { id: 't9.l1.protege.1.tag', q: SAM.tag, kcs: ['t5.block-tables'] } })
    expect(playView(item, 3).ref).toBe('item:t9.l1.protege.1.tag')
    const lure = { kind: 'choice' as const, picks: ['1'] }
    const wrong = stepResponse('t9.l1', resultFor(item, lure, gradeItem(item, lure), { seed: 3, ms: 900 }))
    expect(wrong).toMatchObject({ kind: 'item', ref: 'item:t9.l1.protege.1.tag', ok: false, score: 0, seed: 3, ms: 900 })
    expect(wrong.data).toMatchObject({ src: 'lesson', pick: [1], lessonId: 't9.l1', kcs: ['t5.block-tables'] })
    const named = { kind: 'choice' as const, picks: ['0'] }
    const right = stepResponse('t9.l1', resultFor(item, named, gradeItem(item, named), { seed: 3, ms: 900 }))
    expect(right).toMatchObject({ ok: true, score: 1 })
  })

  test('a wrong tag that picks a named lure records its miss id', () => {
    const named: ProtegeBlock = { ...SAM, tag: { ...SAM.tag, correct: [1], miss: ['confuse.heap-compaction', '', '', ''] } }
    const item = stepItem('t9.l1', 1, named, 'tag')
    const lure = { kind: 'choice' as const, picks: ['0'] }
    expect(stepResponse('t9.l1', resultFor(item, lure, gradeItem(item, lure), { seed: 1, ms: 1 })).data).toMatchObject({ miss: 'confuse.heap-compaction' })
  })

  test('the find step grades by the offer: the false sentence\'s option is the key', () => {
    const item = stepItem('t9.l1', 1, SAM, 'find')
    const key = { kind: 'choice' as const, picks: [String(findQuestion(SAM).correct[0])] }
    expect(gradeItem(item, key).ok).toBe(true)
    expect(gradeItem(item, { kind: 'choice', picks: ['0'] }).ok).toBe(false)
  })

  test('the codec accepts all three refs', () => {
    for (const step of ['find', 'tag', 'fix'] as const) {
      const item = stepItem('t4.l3', 1, SAM, step)
      const pick = { kind: 'choice' as const, picks: ['0'] }
      const e = stepResponse('t4.l3', resultFor(item, pick, gradeItem(item, pick), { seed: 5, ms: 800 }))
      const at = '2026-10-14T12:00:00.000Z'
      const ev = { id: `e-${step}`, v: 1, kind: e.kind, ref: e.ref, at, tz: 0, day: '2026-10-14', dev: 'd1', rev: e.rev, score: e.score, ok: e.ok, provenance: 'practice', seed: e.seed, ms: e.ms, data: e.data }
      const checked = validateEvent(ev)
      expect(checked.ok ? '' : checked.error).toBe('')
      expect(e.ref).toBe(`item:t4.l3.protege.1.${step}`)
    }
  })
})

describe('the markdown export withholds the keys', () => {
  test('the passage is numbered with nothing marking the false line, and each step\'s options carry no key', () => {
    const md = blockToMd(SAM, 't9.l1', 0, 0, 0, 0, 0)
    for (const [i, s] of SAM.sentences.entries()) expect(md).toContain(`${i + 1}. ${s}`)
    expect(md).toContain('One sentence above is false.')
    expect(md).toContain('**Find.')
    expect(md).toContain('**Tag.')
    expect(md).toContain('**Fix.')
    expect(md).toContain('Answers withheld')
    for (const o of [...findQuestion(SAM).options, ...SAM.tag.options, ...SAM.fix.options]) expect(md).toContain(`) ${o}`)
    // no why, no miss id, no marker of which sentence is false
    for (const leak of [...SAM.find.why, ...SAM.tag.why!, ...SAM.fix.why!, 'confuse.heap-compaction', 'falseAt', '~~']) expect(md).not.toContain(leak)
    expect(md.match(/\(o\d\)/g)).toHaveLength(12)
    // the authored fix stem names sentence 4, the find's answer, so the export asks a fixed stem instead
    expect(SAM.fix.q).toContain('sentence 4')
    expect(md).toContain('**Fix. Which sentence should replace the false one?**')
    expect(md).not.toContain(SAM.fix.q)
    expect(md.match(/Sentence 4/gi)).toHaveLength(1)
  })

  test('option order is a fixed permutation of its own, so it is stable and not the authored order', () => {
    expect(blockToMd(SAM, 't9.l1', 0, 0, 0, 0, 0)).toBe(blockToMd(SAM, 't9.l1', 0, 0, 0, 0, 0))
    const tagOrder = (md: string) => [...md.matchAll(/\(o\d\) (Treating the KV pool|Mixing up|Assuming each|Believing a freed)/g)].map((m) => m[1])
    const orders = new Set<string>()
    for (let k = 0; k < 6; k++) orders.add(tagOrder(blockToMd(SAM, 't9.l1', 0, 0, 0, 0, k)).join('|'))
    expect(orders.size).toBeGreaterThan(1)
  })

  test('lessonToMd numbers protégé blocks and renders one section per block', () => {
    const md = lessonToMd(lessonOf([SAM, prose, { ...SAM, title: 'Sam, again' }]))
    expect(md).toContain('**Sam explains the paged KV cache**')
    expect(md).toContain('**Sam, again**')
    // a second block salts its options differently from the first
    const [first, second] = md.split('**Sam, again**')
    const tagOpts = (s: string) => [...s.matchAll(/\(o(\d)\) Treating the KV pool/g)].map((m) => m[1])
    expect(tagOpts(first)).toHaveLength(1)
    expect(tagOpts(second)).toHaveLength(1)
  })
})

/* ------------------------------ the block in a DOM ------------------------------ */

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

let events: ItemResponse[]
const saved = useProgress.getState().recordItems
beforeEach(() => {
  events = []
  useProgress.setState({ recordItems: (items: ItemResponse[]) => void events.push(...items) })
})
afterEach(() => useProgress.setState({ recordItems: saved }))

const lesson = lessonOf([prose, SAM])
const buttonNamed = (root: MiniElement, text: string) => root.querySelectorAll('button').find((b) => b.textContent.trim().startsWith(text))
const options = (root: MiniElement) => root.querySelectorAll('[data-ks-option]')
const optionWith = (root: MiniElement, text: string) => options(root).find((o) => o.textContent.includes(text))!
const sentenceItems = (root: MiniElement) => root.querySelectorAll('[data-sentence]')

/** Pick an option by its text and Submit; resolves once the verdict is recorded. */
async function submit(root: MiniElement, text: string, recorded: number) {
  await dom.until(() => options(root).length > 0)
  await dom.press(optionWith(root, text))
  await dom.press(buttonNamed(root, 'Submit')!)
  await dom.until(() => events.length >= recorded)
}

const mountBlock = () => dom.mount(createElement(ProtegeBlockView, { block: SAM, lesson, trackColor: '#22D3EE' }))

describe('the block', () => {
  test('shows the title, the setup and every sentence numbered, strikes nothing, and asks the find question first', async () => {
    const m = await mountBlock()
    await dom.until(() => options(m.container).length > 0)
    const text = m.container.textContent
    expect(text).toContain(SAM.title)
    expect(text).toContain(SAM.setup!)
    expect(sentenceItems(m.container)).toHaveLength(5)
    SAM.sentences.forEach((s, i) => expect(sentenceItems(m.container)[i].textContent).toContain(s))
    expect(m.container.querySelector('del')).toBeNull()
    expect(options(m.container).map((o) => /Sentence \d/.exec(o.textContent)?.[0]).sort()).toEqual(['Sentence 2', 'Sentence 3', 'Sentence 4', 'Sentence 5'])
    // the later steps wait their turn, and the repair is not given away
    expect(text).toContain('1 · Find the false line')
    expect(text).not.toContain('2 · Tag the mistaken idea')
    expect(text).not.toContain('3 · Repair it')
    expect(text).not.toContain(correction(SAM))
    expect(events).toEqual([])
    await m.unmount()
  })

  test('a wrong find is recorded with its why, strikes nothing, opens no step and offers a retry', async () => {
    const m = await mountBlock()
    await submit(m.container, 'Sentence 2', 1)
    expect(events[0]).toMatchObject({ kind: 'item', ref: 'item:t9.l1.protege.1.find', ok: false, score: 0 })
    expect(m.container.textContent).toContain('which is why the blocks need not be adjacent')
    expect(m.container.querySelector('del')).toBeNull()
    expect(m.container.textContent).not.toContain('2 · Tag the mistaken idea')
    await dom.press(buttonNamed(m.container, 'Try again')!)
    await dom.until(() => options(m.container).length > 0)
    expect(buttonNamed(m.container, 'Submit')).toBeDefined()
    await m.unmount()
  })

  test('finding the false line strikes it through, tags it false in words, opens the tag step and moves focus there', async () => {
    const m = await mountBlock()
    await submit(m.container, 'Sentence 4', 1)
    expect(events[0]).toMatchObject({ ref: 'item:t9.l1.protege.1.find', ok: true, score: 1 })
    const struck = sentenceItems(m.container)[SAM.falseAt]
    expect(struck.getAttribute('data-false')).toBe('true')
    const del = struck.querySelector('del')!
    expect(del.textContent).toContain(SAM.sentences[SAM.falseAt])
    expect(del.textContent).toContain('Struck through, false')
    expect(struck.textContent).toContain('false')
    // the true sentences are not marked
    expect(sentenceItems(m.container).filter((s) => s.querySelector('del'))).toHaveLength(1)
    expect(m.container.querySelector('[data-protege-note]')!.textContent).toContain('Sentence 4 stays struck through')
    expect(m.container.textContent).toContain('2 · Tag the mistaken idea')
    expect(m.container.textContent).not.toContain('3 · Repair it')
    await dom.until(() => dom.document.activeElement.textContent.includes('Tag the mistaken idea'))
    await m.unmount()
  })

  test('the whole walk: find (after a miss), tag (after a miss), fix; five events in order, the false line struck and repaired at the end', async () => {
    const m = await mountBlock()
    await submit(m.container, 'Sentence 3', 1)
    await dom.press(buttonNamed(m.container, 'Try again')!)
    await submit(m.container, 'Sentence 4', 2)

    // tag: a lure first. Its why shows, the fix step stays shut
    await dom.until(() => m.container.textContent.includes(SAM.tag.q))
    const tagCard = () => m.container.querySelectorAll('form').find((f) => f.textContent.includes(SAM.tag.q))!
    await dom.until(() => options(tagCard()).length > 0)
    await dom.press(optionWith(tagCard(), 'Mixing up the block table'))
    await dom.press(buttonNamed(tagCard(), 'Submit')!)
    await dom.until(() => events.length >= 3)
    expect(events[2]).toMatchObject({ ref: 'item:t9.l1.protege.1.tag', ok: false })
    expect(m.container.textContent).not.toContain('3 · Repair it')
    await dom.press(buttonNamed(tagCard(), 'Try again')!)
    await dom.until(() => options(tagCard()).length > 0)
    await dom.press(optionWith(tagCard(), 'Treating the KV pool like a heap'))
    await dom.press(buttonNamed(tagCard(), 'Submit')!)
    await dom.until(() => events.length >= 4)
    expect(events[3]).toMatchObject({ ref: 'item:t9.l1.protege.1.tag', ok: true })

    // fix: the key is the corrected sentence, which then sits under the struck one
    await dom.until(() => m.container.textContent.includes(SAM.fix.q))
    const fixCard = () => m.container.querySelectorAll('form').find((f) => f.textContent.includes(SAM.fix.q))!
    await dom.until(() => options(fixCard()).length > 0)
    expect(m.container.querySelector('[data-correction]')).toBeNull()
    await dom.press(optionWith(fixCard(), 'Free blocks can stay scattered'))
    await dom.press(buttonNamed(fixCard(), 'Submit')!)
    await dom.until(() => events.length >= 5)
    expect(events.map((e) => [e.ref.replace('item:t9.l1.protege.1.', ''), e.ok])).toEqual([
      ['find', false],
      ['find', true],
      ['tag', false],
      ['tag', true],
      ['fix', true],
    ])
    for (const e of events) expect(e.data).toMatchObject({ src: 'lesson', lessonId: 't9.l1', kcs: ['t5.block-tables'] })
    expect((events[2].data as { miss?: string }).miss).toBeUndefined()

    const struck = sentenceItems(m.container)[SAM.falseAt]
    expect(struck.querySelector('del')!.textContent).toContain(SAM.sentences[SAM.falseAt])
    expect(struck.querySelector('[data-correction]')!.textContent).toContain(correction(SAM))
    expect(m.container.querySelector('[data-protege-done]')).not.toBeNull()
    await m.unmount()
  })

  test('the lesson dispatcher renders the block, and a block outside its lesson still mounts', async () => {
    const m = await dom.mount(createElement(RenderBlock, { block: SAM, lesson, trackColor: '#22D3EE', h2Start: 0 }))
    await dom.until(() => m.container.querySelector('[data-block="protege"]') !== null)
    expect(m.container.querySelector('[data-block="protege"]')!.getAttribute('data-protege')).toBe('1')
    await dom.until(() => options(m.container).length > 0)
    await m.unmount()
  })
})

describe('docs/prereg/protege.md', () => {
  const text = readFileSync(new URL('../../docs/prereg/protege.md', import.meta.url), 'utf8')

  test('is a draft: it carries no signature, so nothing that waits on one may read it', () => {
    expect(isPreregSigned(text)).toBe(false)
    expect(text).toContain('Signed: (pending owner)')
    expect(text).toContain('DRAFT')
  })

  test('fixes the within-learner comparison: protégé against reading the same correction, per block, randomized, 30-day cold check', () => {
    for (const part of ['Within-learner, per block, randomized', 'Protégé arm', 'Reading arm', 'armFor(', 'cold check', '25 to 45 days', 'intention to treat', 'one-sided 97.5 %', 'Wave 3 + 60 days', 'stay at one per track']) expect(text).toContain(part)
  })

  test('its sign-off, like the 3D draft\'s, says what isPreregSigned accepts: either form alone, and nothing less', () => {
    for (const file of ['protege.md', 'tiling-cube-3d.md']) {
      const draft = readFileSync(new URL(`../../docs/prereg/${file}`, import.meta.url), 'utf8')
      expect(draft, file).toContain('The owner signs in either of two ways, and either one alone is a signature')
      expect(draft, file).not.toContain('until both are in')
      expect(isPreregSigned(draft), file).toBe(false)
      // the two forms the text names, each alone, read as signed
      expect(isPreregSigned(draft.replace('Signed: (pending owner)', 'Signed: Someone 2026-11-02')), file).toBe(true)
      expect(isPreregSigned(draft.replace('| Owner | |', '| Owner | Someone |').replace('| Date signed | |', '| Date signed | 2026-11-02 |')), file).toBe(true)
      // and the half-forms it names do not
      expect(isPreregSigned(draft.replace('Signed: (pending owner)', 'Signed: Someone')), file).toBe(false)
      expect(isPreregSigned(draft.replace('Signed: (pending owner)', 'Signed: 2026-11-02')), file).toBe(false)
      expect(isPreregSigned(draft.replace('| Owner | |', '| Owner | Someone |')), file).toBe(false)
      expect(isPreregSigned(draft.replace('| Date signed | |', '| Date signed | 2026-11-02 |')), file).toBe(false)
    }
  })

  test('the required n follows the recipe of its siblings: ((1.960 + 0.842) x sd / effect)^2, rounded up', () => {
    expect(Math.ceil((((1.96 + 0.842) * 30) / 5) ** 2)).toBe(283)
    expect(text).toContain('so **283**')
  })
})
