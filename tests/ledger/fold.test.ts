import { describe, expect, test } from 'bun:test'
import { derive, emptyAggregate, fold } from '../../src/lib/ledger/fold'
import { refMatchesKind } from '../../src/lib/ledger/refs'
import { canonicalRef, parseQuizItemRef, parseSimTaskRef } from '../../src/lib/ledger/refs'
import { rev32, sha256Hex, stableStringify } from '../../src/lib/ledger/stable'
import { dayOf } from '../../src/lib/ledger/time'
import { factXp, summary, toProgressData, workingMap, xpOf } from '../../src/lib/ledger/view'
import type { LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { XP, nextRank, rankForXp } from '../../src/lib/economy'
import { evt, forSeeds, runOps, shuffle } from './gen'

const T1 = '2026-09-01T09:00:00.000Z'
const T2 = '2026-09-02T09:00:00.000Z'
const T3 = '2026-09-03T09:00:00.000Z'

describe('stable helpers', () => {
  test('stableStringify sorts keys and matches JSON for plain data', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: undefined }], e: null })).toBe('{"a":[2,{"d":1}],"b":1,"e":null}')
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }))
  })

  test('rev32 is stable and content-sensitive', () => {
    expect(rev32({ q: 'x', options: ['a', 'b'], correct: 1 })).toBe(rev32({ correct: 1, options: ['a', 'b'], q: 'x' }))
    expect(rev32({ q: 'x' })).not.toBe(rev32({ q: 'y' }))
  })

  test('sha256Hex matches the known empty-string digest', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  test('dayOf is the UTC date of at + tz', () => {
    expect(dayOf('2026-09-01T23:30:00.000Z', 0)).toBe('2026-09-01')
    expect(dayOf('2026-09-01T23:30:00.000Z', 60)).toBe('2026-09-02')
    expect(dayOf('2026-09-01T00:30:00.000Z', -60)).toBe('2026-08-31')
  })
})

describe('refs', () => {
  test('parsers', () => {
    expect(parseQuizItemRef('quiz:t5.l4#2')).toEqual({ lessonId: 't5.l4', qi: 2 })
    expect(parseQuizItemRef('quiz:t5.l4')).toBeNull()
    expect(parseSimTaskRef('sim:sim-kv/a')).toEqual({ simId: 'sim-kv', taskId: 'a' })
    expect(parseSimTaskRef('sim:sim-kv')).toBeNull()
    expect(canonicalRef('lesson:t1.l1')).toBe('lesson:t1.l1')
  })

  test('grammar per kind', () => {
    expect(refMatchesKind('quiz', 'lesson:t0.l1')).toBe(true)
    expect(refMatchesKind('quiz', 'quiz:t0.l1#0')).toBe(false)
    expect(refMatchesKind('item', 'boot:decode-tps')).toBe(true)
    expect(refMatchesKind('item', 'boot')).toBe(false)
    expect(refMatchesKind('complete', 'boot')).toBe(true)
    expect(refMatchesKind('visit', 'sim:sim-kv/a')).toBe(false)
    expect(refMatchesKind('lab-check', 'lab:lab-a')).toBe(true)
    expect(refMatchesKind('ack', 'screen:welcome')).toBe(true)
  })
})

describe('fold rules (spec §6.1)', () => {
  test('visit only touches lastAt, never status or XP', () => {
    const agg = derive([evt('visit', 'lesson:t0.l1', T1), evt('visit', 'lesson:t0.l1', T2)])
    expect(agg.lessons['t0.l1']).toEqual({ lastAt: T2 })
    expect(xpOf(agg)).toBe(0)
    expect(Object.keys(agg.days)).toEqual([])
  })

  test('complete: earliest completedAt, latest lastAt, pays once', () => {
    const agg = derive([
      evt('complete', 'lesson:t0.l1', T2),
      evt('complete', 'lesson:t0.l1', T1),
      evt('visit', 'lesson:t0.l1', T3),
    ])
    expect(agg.lessons['t0.l1']).toEqual({ done: true, completedAt: T1, lastAt: T3 })
    expect(xpOf(agg)).toBe(XP.lesson)
    expect(Object.keys(agg.days)).toEqual([]) // a click is not graded work
  })

  test('complete boot lands in completions with the earliest time', () => {
    const agg = derive([evt('complete', 'boot', T2), evt('complete', 'boot', T1)])
    expect(agg.completions).toEqual({ boot: T1 })
    expect(Object.keys(agg.lessons)).toEqual([])
  })

  test('quiz: best score, pass fact only when ok, streak day', () => {
    const agg = derive([
      evt('quiz', 'lesson:t0.l1', T1, { score: 0.6, ok: false }),
      evt('quiz', 'lesson:t0.l1', T2, { score: 0.9, ok: true }),
      evt('quiz', 'lesson:t0.l1', T3, { score: 1, ok: true }),
    ])
    expect(agg.lessons['t0.l1'].quizBest).toBe(1)
    expect(agg.facts).toEqual({ 'quiz-pass:t0.l1': true })
    expect(xpOf(agg)).toBe(XP.quiz)
    expect(Object.keys(agg.days).sort()).toEqual(['2026-09-01', '2026-09-02', '2026-09-03'])
  })

  test('item and probe on a quiz ref are exposure only', () => {
    const agg = derive([
      evt('item', 'quiz:t0.l2#1', T1, { rev: 'r', data: { src: 'quiz' } }),
      evt('probe', 'quiz:t0.l2#1', T2, { rev: 'r', data: { src: 'cold' } }),
    ])
    expect(agg.lessons['t0.l2']).toEqual({ lastAt: T2 })
    expect(agg.facts).toEqual({})
    expect(Object.keys(agg.days).length).toBe(2)
  })

  test('boot and card items, and predict, add only the streak day', () => {
    const agg = derive([
      evt('item', 'boot:decode-tps', T1, { rev: 'r', data: { src: 'boot' } }),
      evt('item', 'card:e#0', T1, { rev: 'r', data: { src: 'card' } }),
      evt('predict', 'boot:kv', T1, { rev: 'r', data: { value: 1, unit: 'x', truth: 2, src: 'boot' } }),
    ])
    expect(agg.lessons).toEqual({})
    expect(xpOf(agg)).toBe(0)
    expect(Object.keys(agg.days)).toEqual(['2026-09-01'])
  })

  test('sims: visits count, tasks pay once', () => {
    const agg = derive([
      evt('visit', 'sim:sim-kv', T1),
      evt('visit', 'sim:sim-kv', T2),
      evt('sim-task', 'sim:sim-kv/a', T1),
      evt('sim-task', 'sim:sim-kv/a', T2),
      evt('sim-task', 'sim:sim-kv/b', T2),
    ])
    expect(agg.sims['sim-kv']).toEqual({ visits: 2, tasks: { a: true, b: true } })
    expect(xpOf(agg)).toBe(2 * XP.exercise)
  })

  test('labs: checks union, total max, done and completedAt from ok runs, streak only with a pass', () => {
    const none = derive([evt('lab-check', 'lab:lab-a', T1, { score: 0, ok: false, data: { passed: [], total: 4 } })])
    expect(none.labs['lab-a']).toEqual({ checks: {}, total: 4 })
    expect(Object.keys(none.days)).toEqual([])

    const agg = derive([
      evt('lab-check', 'lab:lab-a', T1, { score: 0.5, ok: false, data: { passed: ['c1', 'c2'], total: 4 } }),
      evt('lab-check', 'lab:lab-a', T3, { score: 1, ok: true, data: { passed: ['c3', 'c4'], total: 4 } }),
      evt('lab-check', 'lab:lab-a', T2, { score: 1, ok: true, data: { passed: ['c1'], total: 4 } }),
    ])
    expect(agg.labs['lab-a']).toEqual({ checks: { c1: true, c2: true, c3: true, c4: true }, total: 4, done: true, completedAt: T2 })
    expect(xpOf(agg)).toBe(XP.lab)
    expect(Object.keys(agg.days).length).toBe(3)
  })

  test('fleet acts: best score always, act and XP only when ok', () => {
    const agg = derive([
      evt('fleet-act', 'fw:engine', T1, { score: 0.4, ok: false }),
      evt('fleet-act', 'fw:engine', T2, { score: 0.9, ok: true }),
      evt('fleet-act', 'fw:engine', T3, { score: 0.5, ok: true }),
    ])
    expect(agg.fleetWeek).toEqual({ acts: { engine: true }, scores: { engine: 0.9 } })
    expect(xpOf(agg)).toBe(XP.fleetWeekAct)
  })

  test('capstone: step is the highest index + 1, steps pay once', () => {
    const agg = derive([
      evt('capstone-step', 'cap:s3', T1, { data: { index: 2 } }),
      evt('capstone-step', 'cap:s1', T2, { data: { index: 0 } }),
      evt('capstone-step', 'cap:s3', T3, { data: { index: 2 } }),
    ])
    expect(agg.capstone).toEqual({ steps: { s3: true, s1: true }, step: 3 })
    expect(xpOf(agg)).toBe(2 * XP.capstoneStep)
  })

  test('exercise pays once; achievements and acks keep the earliest time', () => {
    const agg = derive([
      evt('exercise', 'lesson:t0.l1', T1),
      evt('exercise', 'lesson:t0.l1', T2),
      evt('achievement', 'ach:x', T2),
      evt('achievement', 'ach:x', T1),
      evt('ack', 'erratum:e1', T3),
      evt('ack', 'erratum:e1', T2),
    ])
    expect(agg.lessons['t0.l1'].exercise).toBe(true)
    expect(xpOf(agg)).toBe(XP.exercise)
    expect(agg.achievements).toEqual({ x: T1 })
    expect(agg.acks).toEqual({ 'erratum:e1': T2 })
  })

  test('XP facts: units per spec §6.3', () => {
    expect(factXp('lesson:t0.l1')).toBe(100)
    expect(factXp('quiz-pass:t0.l1')).toBe(40)
    expect(factXp('exercise:t0.l1')).toBe(60)
    expect(factXp('sim:s/t')).toBe(60)
    expect(factXp('lab:x')).toBe(200)
    expect(factXp('fw:engine')).toBe(250)
    expect(factXp('cap:s1')).toBe(150)
    expect(factXp('weird:thing')).toBe(0)
  })

  test('derive collapses duplicate ids by the canonical rule', () => {
    const a = evt('complete', 'lesson:t0.l1', T2)
    const later = { ...a, at: T3, day: dayOf(T3, 0) } as LedgerEvent
    const agg = derive([later, a, a])
    expect(agg.events).toBe(1)
    expect(agg.lessons['t0.l1'].completedAt).toBe(T2) // earliest at wins
  })
})

describe('view (spec §6.2)', () => {
  test('toProgressData reproduces the store shape', () => {
    const events: LedgerEvent[] = [
      evt('visit', 'lesson:t0.l1', T1),
      evt('complete', 'lesson:t0.l1', T1),
      evt('quiz', 'lesson:t0.l1', T1, { score: 0.85, ok: true }),
      evt('exercise', 'lesson:t0.l1', T2),
      evt('visit', 'lesson:t0.l2', T2),
      evt('visit', 'sim:sim-kv', T2),
      evt('sim-task', 'sim:sim-kv/b', T2),
      evt('sim-task', 'sim:sim-kv/a', T2),
      evt('lab-check', 'lab:lab-b', T2, { score: 1, ok: true, data: { passed: ['c2', 'c1'], total: 2 } }),
      evt('fleet-act', 'fw:fleet', T2, { score: 0.7 }),
      evt('capstone-step', 'cap:s2', T3, { data: { index: 1 } }),
      evt('achievement', 'ach:fleet-week', T3),
    ]
    const working: WorkingRecord[] = [
      { key: 'scroll:t0.l2', value: 42, at: T2, dev: 'x' },
      { key: 'sim-config:sim-kv', value: { batch: 8 }, at: T2, dev: 'x' },
      { key: 'sim-config:sim-other', value: 'cfg', at: T2, dev: 'x' },
      { key: 'fw:doc', value: 'notes', at: T2, dev: 'x' },
      { key: 'fw:evidence:fleet', value: { analysis: 'ok' }, at: T2, dev: 'x' },
      { key: 'capstone:metrics', value: { ttft: 1, itl: 2, throughput: 3 }, at: T2, dev: 'x' },
      { key: 'settings:codeLang', value: 'rust', at: T2, dev: 'x' },
      { key: 'boot:path', value: 'full-ramp', at: T2, dev: 'x' },
    ]
    const data = toProgressData(derive(events), workingMap(working))
    expect(data).toEqual({
      version: 2,
      lessons: {
        't0.l1': { status: 'done', completedAt: T1, lastVisitedAt: T2, quizScore: 0.85, exerciseDone: true },
        't0.l2': { status: 'reading', lastVisitedAt: T2, scrollPct: 42 },
      },
      sims: {
        'sim-kv': { visits: 1, tasksDone: ['a', 'b'], lastConfig: { batch: 8 } },
        'sim-other': { visits: 0, tasksDone: [], lastConfig: 'cfg' },
      },
      labs: { 'lab-b': { done: true, checksDone: ['c1', 'c2'], completedAt: T2 } },
      fleetWeek: {
        actsDone: ['fleet'],
        scores: { fleet: 0.7 },
        docText: 'notes',
        measurementEvidence: { fleet: { analysis: 'ok' } },
      },
      capstone: { step: 2, stepsDone: ['s2'], metrics: { ttft: 1, itl: 2, throughput: 3 } },
      xp: XP.lesson + XP.quiz + 3 * XP.exercise + XP.lab + XP.fleetWeekAct + XP.capstoneStep,
      streakDays: ['2026-09-01', '2026-09-02', '2026-09-03'],
      achievements: ['fleet-week'],
      settings: { codeLang: 'rust' },
    })
  })

  test('an empty ledger is today\'s initial data', () => {
    expect(toProgressData(emptyAggregate())).toEqual({
      version: 2,
      lessons: {},
      sims: {},
      labs: {},
      fleetWeek: { actsDone: [], scores: {} },
      capstone: { step: 0, stepsDone: [] },
      xp: 0,
      streakDays: [],
      achievements: [],
      settings: {},
    })
  })

  test('workingMap resolves repeated keys last-writer-wins', () => {
    const map = workingMap([
      { key: 'fw:doc', value: 'old', at: T1, dev: 'a' },
      { key: 'fw:doc', value: 'new', at: T2, dev: 'b' },
    ])
    expect(map['fw:doc']).toBe('new')
  })

  test('summary', () => {
    const agg = derive([
      evt('complete', 'lesson:t0.l1', T1),
      evt('lab-check', 'lab:lab-b', T2, { data: { passed: ['c1', 'c2'], total: 2 } }),
    ])
    expect(summary(agg)).toEqual({ lessonsDone: 1, xp: XP.lesson + XP.lab, activeDays: 1, labsDone: 1, events: 2 })
  })

  test('economy re-exports behave as before', () => {
    expect(rankForXp(0).name).toBe('RING 3')
    expect(rankForXp(500).name).toBe('RING 2')
    expect(rankForXp(5000).name).toBe('ROOT')
    expect(nextRank(0)?.name).toBe('RING 2')
    expect(nextRank(5000)).toBeNull()
  })
})

describe('fold properties', () => {
  test('P6 order-insensitivity: derive(shuffle(L)) = derive(L)', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      runOps(d, 40)
      const events = d.ledger().events
      expect(derive(shuffle(ctx.rand, events))).toEqual(derive(events))
      expect(derive([...events, ...shuffle(ctx.rand, events)])).toEqual(derive(events)) // repeats collapse
    })
  })

  test('I7 optimistic agreement: fold(derive(L), e) = derive(L + e) for every new event', () => {
    forSeeds((ctx) => {
      const d = ctx.device()
      let agg = derive([])
      for (let i = 0; i < 40; i++) {
        const before = new Set(d.events.keys())
        runOps(d, 1)
        for (const e of d.events.values()) if (!before.has(e.id)) agg = fold(agg, e)
        expect(agg).toEqual(derive(d.events.values()))
      }
    })
  })

  test('fold does not mutate its input', () => {
    const agg = derive([evt('complete', 'lesson:t0.l1', T1)])
    const frozen = structuredClone(agg)
    fold(agg, evt('quiz', 'lesson:t0.l1', T2, { score: 1 }))
    expect(agg).toEqual(frozen)
  })
})

describe('prototype-unsafe ids (fold and view cope even if validation is bypassed)', () => {
  const UNSAFE = ['__proto__', 'constructor', 'toString', 'hasOwnProperty']
  const clean = () => {
    for (const name of ['done', 'completedAt', 'visits', 'total', 'lastAt', 'tasks', 'checks', 'polluted']) {
      expect(({} as Record<string, unknown>)[name]).toBeUndefined()
      expect((Function.prototype as unknown as Record<string, unknown>)[name]).toBeUndefined()
    }
  }

  const events = (id: string): LedgerEvent[] => [
    evt('visit', `lesson:${id}`, T1),
    evt('complete', `lesson:${id}`, T1),
    evt('exercise', `lesson:${id}`, T1),
    evt('quiz', `lesson:${id}`, T1, { score: 1, ok: true }),
    evt('visit', `sim:${id}`, T1),
    evt('sim-task', `sim:${id}/a`, T1),
    evt('sim-task', `sim:s/${id}`, T1),
    evt('lab-check', `lab:${id}`, T1, { data: { passed: [id, 'c1'], total: 2 } }),
    evt('fleet-act', `fw:${id}`, T1),
    evt('capstone-step', `cap:${id}`, T1, { data: { index: 1 } }),
    evt('achievement', `ach:${id}`, T1),
    evt('ack', `erratum:${id}`, T1),
    evt('complete', `lesson:${id}`, T2),
  ]
  const working = (id: string): WorkingRecord[] =>
    [`settings:${id}`, `fw:evidence:${id}`, `scroll:${id}`, `sim-config:${id}`].map((key) => ({
      key,
      value: key.startsWith('scroll:') ? 0.5 : { polluted: true },
      at: T1,
      dev: 'hand',
    })) as WorkingRecord[]

  for (const id of UNSAFE) {
    test(`id ${id} stays an ordinary key`, () => {
      const agg = derive(events(id))
      clean()
      expect(Object.hasOwn(agg.lessons, id)).toBe(true)
      expect(agg.lessons[id].done).toBe(true)
      expect(agg.lessons[id].completedAt).toBe(T1)
      expect(Object.hasOwn(agg.sims, id)).toBe(true)
      expect(agg.sims[id].visits).toBe(1)
      expect(Object.hasOwn(agg.labs, id)).toBe(true)
      expect(agg.labs[id].total).toBe(2)
      expect(Object.hasOwn(agg.labs[id].checks, id)).toBe(true)
      expect(Object.hasOwn(agg.fleetWeek.acts, id)).toBe(true)
      expect(Object.hasOwn(agg.achievements, id)).toBe(true)
      expect(Object.hasOwn(agg.acks, `erratum:${id}`)).toBe(true)

      // The clone fold() makes keeps an own `__proto__` key as an own key.
      const next = fold(agg, evt('visit', `lesson:${id}`, T3))
      expect(Object.hasOwn(next.lessons, id)).toBe(true)
      expect(next.lessons[id].lastAt).toBe(T3)

      const data = toProgressData(agg, workingMap(working(id)))
      clean()
      expect(Object.hasOwn(data.lessons, id)).toBe(true)
      expect(Object.hasOwn(data.sims, id)).toBe(true)
      expect(Object.hasOwn(data.labs, id)).toBe(true)
      expect(Object.hasOwn(data.settings, id)).toBe(true)
      expect(Object.hasOwn(data.fleetWeek.measurementEvidence ?? {}, id)).toBe(true)
      expect(Object.getPrototypeOf(data.settings)).toBe(Object.prototype)
      expect(Object.getPrototypeOf(data.fleetWeek.measurementEvidence)).toBe(Object.prototype)
    })
  }
})
