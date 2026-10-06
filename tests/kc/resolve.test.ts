import { describe, expect, test } from 'bun:test'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { KC, REF_KCS } from '../../src/data/kc'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson } from '../../src/data/lessons/types'
import type { AuthoredItem } from '../../src/lib/items/types'
import {
  MAX_EVENT_KCS,
  authoredItemRev,
  buildKcContent,
  constructedRev,
  diagramPredictRev,
  kcsOfEvent,
  prequestionRev,
  quizRev,
  rawKcsOfEvent,
  type KcContent,
} from '../../src/lib/kc/resolve'
import { rev32 } from '../../src/lib/ledger/stable'
import type { LedgerEvent } from '../../src/lib/ledger/types'

let seq = 0
const event = (over: Record<string, unknown>): LedgerEvent => {
  seq++
  return {
    id: `e${seq}`,
    v: 1,
    kind: 'item',
    at: '2026-10-05T10:00:00.000Z',
    tz: 0,
    day: '2026-10-05',
    dev: 'd',
    score: 1,
    ok: true,
    provenance: 'practice',
    ...over,
  } as unknown as LedgerEvent
}

const question = (kcs?: string[]): QuizQuestion => ({
  q: 'A heap is 60% free, but a 1 MB allocation fails. This is…',
  options: ['external fragmentation', 'internal fragmentation', 'a leak', 'a double free'],
  correct: [0],
  why: ['a', 'b', 'c', 'd'],
  ...(kcs ? { kcs } : {}),
})

const anchor: AuthoredItem = {
  id: 'r.anchor.e0502-1',
  q: { q: 'Which error does rustc give?', options: ['E0499', 'E0502', 'E0382', 'it compiles'], correct: [1] },
  kcs: [KC.borrowRules],
}

/** One lesson that exercises every item ref the resolver indexes. */
const fixture = (tag?: string[]): Lesson => ({
  id: 't1.l4',
  slug: 'fragmentation',
  trackId: 't1',
  index: 4,
  title: 'Fragmentation',
  minutes: 20,
  hook: 'hook',
  exercise: 'quiz',
  blocks: [
    {
      type: 'predict',
      items: [
        { kind: 'choice', q: 'Which waste?', options: ['inside', 'between'], correct: [1], why: ['x', 'y'], revealAt: 'H', kcs: [KC.externalFrag] },
        { kind: 'numeric', q: 'How many bytes?', unit: 'B', truth: 48, okWithinFactor: 2, revealAt: 'H', kcs: [KC.internalFrag] },
      ],
    },
    { type: 'prose', md: '## H' },
    {
      type: 'diagram',
      caption: 'fig 1',
      nodes: [],
      steps: [{ caption: 'a' }, { caption: 'b' }],
      predictAt: { step: 1, prompt: 'Next?', options: ['fits', 'fails'], correct: [1], why: ['x', 'y'], kcs: [KC.placementPolicy] },
    },
    { type: 'quiz', questions: [question(tag), question([KC.internalFrag])] },
  ],
  ticket: {
    form: 'ticket',
    cr: [{ prompt: 'Why fixed blocks?', model: 'Because…', ideas: ['a', 'b', 'c'], kcs: [KC.fixedBlocks] }],
    spiral: [{ id: 't1.spiral.1', q: question(), kcs: [KC.splitCoalesce] }],
  },
})

const content = (tag?: string[], extra: Partial<Parameters<typeof buildKcContent>[0]> = {}): KcContent =>
  buildKcContent({ lessons: [fixture(tag)], items: [anchor], ...extra })

describe('fingerprints', () => {
  test('quizRev is exactly what QuizBlock writes, and ignores tags and feedback', () => {
    const q = question([KC.externalFrag])
    expect(quizRev(q)).toBe(rev32({ q: q.q, options: q.options, correct: q.correct }))
    expect(quizRev({ ...q, kcs: [KC.internalFrag], why: ['changed', '', '', ''] })).toBe(quizRev(q))
    expect(quizRev({ ...q, correct: [1] })).not.toBe(quizRev(q))
  })

  test('the other item fingerprints ignore kcs and why, and change with what is graded', () => {
    const lesson = fixture()
    const predict = lesson.blocks[0]
    const diagram = lesson.blocks[2]
    if (predict.type !== 'predict' || diagram.type !== 'diagram' || !diagram.predictAt) throw new Error('fixture shape')
    const [choice, numeric] = predict.items
    expect(prequestionRev({ ...choice, kcs: [KC.locality], why: ['p', 'q'] })).toBe(prequestionRev(choice))
    if (numeric.kind !== 'numeric') throw new Error('fixture shape')
    expect(prequestionRev({ ...numeric, truth: 64 })).not.toBe(prequestionRev(numeric))
    const d = diagram.predictAt
    expect(diagramPredictRev({ ...d, kcs: [], why: ['p', 'q'] })).toBe(diagramPredictRev(d))
    expect(diagramPredictRev({ ...d, correct: [0] })).not.toBe(diagramPredictRev(d))
    const cr = lesson.ticket?.cr[0]
    if (!cr) throw new Error('fixture shape')
    expect(constructedRev({ ...cr, kcs: [] })).toBe(constructedRev(cr))
    expect(constructedRev({ ...cr, ideas: ['a', 'b', 'z'] })).not.toBe(constructedRev(cr))
    expect(authoredItemRev(anchor)).toBe(quizRev(anchor.q))
  })
})

describe('kcsOfEvent', () => {
  const quizRef = 'quiz:t1.l4#0'
  const rev = quizRev(question())

  test('rule 1: a rev-matched item takes its current tag, over the write-time tag', () => {
    const e = event({ ref: quizRef, rev, data: { src: 'quiz', kcs: [KC.internalFrag] } })
    expect(kcsOfEvent(e, content([KC.externalFrag, KC.fixedBlocks]))).toEqual([KC.externalFrag, KC.fixedBlocks])
  })

  test('rule 1 applies retroactively: an event written before the item was tagged picks up the new tag', () => {
    const e = event({ ref: quizRef, rev, data: { src: 'quiz' } })
    expect(kcsOfEvent(e, content())).toEqual([])
    expect(kcsOfEvent(e, content([KC.externalFrag]))).toEqual([KC.externalFrag])
  })

  test('rule 2: when the item changed since the event, the write-time tag stands', () => {
    const e = event({ ref: quizRef, rev: 'stale', data: { src: 'quiz', kcs: [KC.internalFrag] } })
    expect(kcsOfEvent(e, content([KC.externalFrag]))).toEqual([KC.internalFrag])
  })

  test('rule 2 also covers events with no rev, and non-item kinds that carry data.kcs', () => {
    expect(kcsOfEvent(event({ ref: quizRef, data: { kcs: [KC.internalFrag] } }), content([KC.externalFrag]))).toEqual([KC.internalFrag])
    const play = event({ kind: 'play', ref: 'play:block-placement', data: { phase: 'play', turns: 3, survived: 2, ghostSurvived: 1, kcs: [KC.placementPolicy, KC.externalFrag] } })
    expect(kcsOfEvent(play, content())).toEqual([KC.placementPolicy, KC.externalFrag])
  })

  test('a changed item with no write-time tag resolves to nothing', () => {
    expect(kcsOfEvent(event({ ref: quizRef, rev: 'stale', data: { src: 'quiz' } }), content([KC.externalFrag]))).toEqual([])
  })

  test('malformed write-time tags are ignored, and long ones capped', () => {
    expect(kcsOfEvent(event({ ref: 'quiz:x#0', data: { kcs: 't1.external-frag' } }), content())).toEqual([])
    expect(kcsOfEvent(event({ ref: 'quiz:x#0', data: { kcs: [7, null, '', KC.alignment] } }), content())).toEqual([KC.alignment])
    const many = Array.from({ length: 9 }, (_, i) => `t1.k${i}`)
    expect(rawKcsOfEvent(event({ ref: 'quiz:x#0', data: { kcs: many } }), content())).toHaveLength(MAX_EVENT_KCS)
  })

  test('pre:, dia:, cr: and item: refs resolve through their fingerprints', () => {
    const lesson = fixture()
    const predict = lesson.blocks[0]
    const diagram = lesson.blocks[2]
    if (predict.type !== 'predict' || diagram.type !== 'diagram' || !diagram.predictAt || !lesson.ticket) throw new Error('fixture shape')
    const c = content()
    const cases: [string, string, string[]][] = [
      ['pre:t1.l4#0', prequestionRev(predict.items[0]), [KC.externalFrag]],
      ['pre:t1.l4#1', prequestionRev(predict.items[1]), [KC.internalFrag]],
      ['dia:t1.l4#2', diagramPredictRev(diagram.predictAt), [KC.placementPolicy]],
      ['cr:t1.l4#0', constructedRev(lesson.ticket.cr[0]), [KC.fixedBlocks]],
      ['item:t1.spiral.1', quizRev(question()), [KC.splitCoalesce]],
      ['item:r.anchor.e0502-1', authoredItemRev(anchor), [KC.borrowRules]],
      ['quiz:t1.l4#1', quizRev(question()), [KC.internalFrag]],
    ]
    for (const [ref, r, want] of cases) expect({ ref, kcs: kcsOfEvent(event({ ref, rev: r, data: { src: 'ticket' } }), c) }).toEqual({ ref, kcs: want })
  })

  test('rule 3: Boot steps come from the ref map', () => {
    const c = content()
    expect(kcsOfEvent(event({ kind: 'predict', ref: 'boot:guess-1user', rev: 'r', data: { src: 'boot' } }), c)).toEqual([KC.decodeBandwidth])
    expect(kcsOfEvent(event({ ref: 'boot:ridge', rev: 'r', data: { src: 'boot' } }), c)).toEqual([KC.ridgePoint])
    expect(kcsOfEvent(event({ ref: 'boot:kv-tokens', rev: 'r', data: { src: 'boot' } }), c)).toEqual([KC.kvCapacity])
    expect(kcsOfEvent(event({ ref: 'boot:why-batching', rev: 'r', data: { src: 'boot' } }), c)).toEqual([KC.batchingThroughput])
    expect(kcsOfEvent(event({ ref: 'boot:faded-decode', rev: 'r', data: { src: 'boot' } }), c)).toEqual([KC.decodeBandwidth])
  })

  test('rule 3: extra refs (sim tasks) merge over the ref map; prototype keys never match', () => {
    const c = content(undefined, { refs: { 'sim:sim-allocator/frag-60': [KC.externalFrag] } })
    expect(c.refs['boot:ridge']).toEqual(REF_KCS['boot:ridge'])
    expect(kcsOfEvent(event({ kind: 'sim-task', ref: 'sim:sim-allocator/frag-60' }), c)).toEqual([KC.externalFrag])
    expect(kcsOfEvent(event({ ref: 'toString' }), c)).toEqual([])
    expect(kcsOfEvent(event({ ref: '__proto__' }), c)).toEqual([])
  })

  test('rule 3: gen refs take the variant\'s KCs, else the family\'s', () => {
    const gens = [
      {
        id: 'kv',
        kcs: [KC.kvBytesPerToken, KC.kvCapacity, KC.gqaKvHeads],
        variants: [
          { id: 'bytes-per-token', kcs: [KC.kvBytesPerToken] },
          { id: 'capacity-tokens', kcs: [KC.kvCapacity, KC.kvBytesPerToken] },
        ],
      },
    ]
    const c = content(undefined, { gens })
    expect(kcsOfEvent(event({ ref: 'gen:kv/capacity-tokens', rev: 'r', data: { src: 'today' } }), c)).toEqual([KC.kvCapacity, KC.kvBytesPerToken])
    expect(kcsOfEvent(event({ ref: 'gen:kv/retired-variant', rev: 'r', data: { src: 'today' } }), c)).toEqual([KC.kvBytesPerToken, KC.kvCapacity, KC.gqaKvHeads])
    expect(kcsOfEvent(event({ ref: 'gen:frag/internal-waste', rev: 'r', data: { src: 'today' } }), c)).toEqual([])
    // the write-time tag still beats the family default
    expect(kcsOfEvent(event({ ref: 'gen:kv/bytes-per-token', rev: 'r', data: { src: 'today', kcs: [KC.gqaKvHeads] } }), c)).toEqual([KC.gqaKvHeads])
  })

  test('rule 4: migrations apply to every rule\'s result, resolving chains and de-duplicating', () => {
    const at = '2026-10-05'
    const migrations = [
      { from: 't1.frag', to: [KC.internalFrag, KC.externalFrag], at, why: 'split' },
      { from: 't1.old-name', to: ['t1.frag'], at, why: 'renamed, then split' },
    ]
    const c = content(['t1.old-name', KC.externalFrag], { migrations, refs: { 'boot:legacy': ['t1.frag'] } })
    expect(kcsOfEvent(event({ ref: quizRef, rev, data: { src: 'quiz' } }), c)).toEqual([KC.internalFrag, KC.externalFrag])
    expect(kcsOfEvent(event({ ref: 'quiz:x#0', data: { kcs: ['t1.frag'] } }), c)).toEqual([KC.internalFrag, KC.externalFrag])
    expect(kcsOfEvent(event({ ref: 'boot:legacy' }), c)).toEqual([KC.internalFrag, KC.externalFrag])
  })

  test('events with nothing to go on still resolve, to no KCs', () => {
    const c = content()
    expect(kcsOfEvent(event({ kind: 'visit', ref: 'lesson:t1.l4' }), c)).toEqual([])
    expect(kcsOfEvent(event({ kind: 'complete', ref: 'placement' }), c)).toEqual([])
  })
})

describe('buildKcContent over the real lessons', () => {
  test('indexes exactly the tagged items, and defaults the ref map and migrations', () => {
    const c = buildKcContent({ lessons: ALL_LESSONS })
    let tagged = 0
    for (const l of ALL_LESSONS) for (const b of l.blocks) if (b.type === 'quiz') tagged += b.questions.filter((q) => q.kcs?.length).length
    expect([...c.tags.keys()].filter((k) => k.startsWith('quiz:')).length).toBe(tagged)
    expect(c.refs).toEqual({ ...REF_KCS })
    expect(c.migrations).toEqual([])
  })
})
