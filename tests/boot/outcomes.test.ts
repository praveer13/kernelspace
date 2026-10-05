import { describe, expect, test } from 'bun:test'
import { BOOT, GRADED_STEPS, bootRev, gradeGuess, gradeNear, truthFor } from '../../src/lib/boot/model'
import { isActivated, selectBootOutcome } from '../../src/lib/boot/outcomes'
import type { LedgerEvent } from '../../src/lib/ledger/types'
import { makeProfile, startTab } from '../ledger/env'

let seq = 0
const base = (at: string, over: Record<string, unknown>): LedgerEvent => {
  seq++
  return { id: `e${seq}`, v: 1, tz: 0, day: at.slice(0, 10), dev: 'd', at, ...over } as unknown as LedgerEvent
}
const visit = (at: string) => base(at, { kind: 'visit', ref: 'boot' })
const step = (at: string, name: string, ok: boolean, kind: 'item' | 'predict' = 'item') =>
  base(at, { kind, ref: `boot:${name}`, rev: 'r', score: ok ? 1 : 0, ok, provenance: 'practice', data: { src: 'boot' } })
const complete = (at: string, data?: Record<string, unknown>) => base(at, { kind: 'complete', ref: 'boot', ...(data ? { data } : {}) })
const quiz = (at: string, ok = true) =>
  base(at, { kind: 'quiz', ref: 'lesson:t0.l1', score: ok ? 1 : 0, ok, provenance: 'practice' })

const T = (clock: string, day = '2026-10-04') => `${day}T${clock}.000Z`

describe('selectBootOutcome', () => {
  test('no Boot events: nothing measured', () => {
    expect(selectBootOutcome([])).toEqual({
      completedAt: null,
      correct: 0,
      graded: 0,
      firstSuccessMs: null,
      totalMs: null,
      returnedWithin7Days: null,
    })
    expect(selectBootOutcome([quiz(T('09:00:00'))]).graded).toBe(0)
  })

  test('counts correct of graded, and times first success from the first Boot event', () => {
    const events = [
      visit(T('09:00:00')),
      step(T('09:01:00'), 'guess-1user', false, 'predict'),
      step(T('09:03:30'), 'faded-decode', true),
      step(T('09:05:00'), 'ridge', true),
      step(T('09:06:00'), 'kv-tokens', false),
      step(T('09:07:00'), 'why-batching', true),
      complete(T('09:09:00')),
    ]
    const o = selectBootOutcome(events)
    expect(o.correct).toBe(3)
    expect(o.graded).toBe(5)
    expect(o.firstSuccessMs).toBe(3.5 * 60_000)
    expect(o.totalMs).toBe(9 * 60_000)
    expect(o.completedAt).toBe(T('09:09:00'))
    expect(o.returnedWithin7Days).toBeNull() // no return seen, and no `now` to say the week has passed
  })

  test('input order does not matter', () => {
    const events = [
      visit(T('09:00:00')),
      step(T('09:02:00'), 'guess-1user', true, 'predict'),
      step(T('09:03:00'), 'ridge', true),
      complete(T('09:04:00')),
    ]
    const a = selectBootOutcome(events)
    const b = selectBootOutcome([...events].reverse())
    expect(b).toEqual(a)
    expect(a.firstSuccessMs).toBe(2 * 60_000)
  })

  test('any iterable reads like an array, including one that can only be walked once', () => {
    const events = [
      visit(T('09:00:00')),
      step(T('09:01:00'), 'faded-decode', true),
      complete(T('09:02:00')),
      quiz(T('08:00:00', '2026-10-05')), // the return, on a later day
    ]
    // Without `now` a missed return reads null, and well after the week it reads false: an array says true either way.
    for (const opts of [{}, { now: T('09:00:00', '2026-10-20') }]) {
      const fromArray = selectBootOutcome(events, opts)
      expect(fromArray.returnedWithin7Days).toBe(true)
      // Map.values() and a generator are spent after one pass: the return check must not need a second one.
      expect(selectBootOutcome(new Map(events.map((e) => [e.id, e])).values(), opts)).toEqual(fromArray)
      expect(
        selectBootOutcome(
          (function* () {
            yield* events
          })(),
          opts,
        ),
      ).toEqual(fromArray)
      expect(selectBootOutcome(new Set(events), opts)).toEqual(fromArray)
    }
  })

  test('a step that was never answered is not counted as graded; an unfinished Boot has no completion', () => {
    const o = selectBootOutcome([visit(T('09:00:00')), step(T('09:01:00'), 'faded-decode', true)])
    expect(o).toMatchObject({ correct: 1, graded: 1, completedAt: null, totalMs: null, returnedWithin7Days: null })
    expect(o.firstSuccessMs).toBe(60_000)
  })

  test('no correct step: no first-success time', () => {
    const o = selectBootOutcome([visit(T('09:00:00')), step(T('09:01:00'), 'ridge', false), complete(T('09:02:00'))])
    expect(o.firstSuccessMs).toBeNull()
    expect(o.correct).toBe(0)
  })

  test('only the first session counts: a replay changes nothing', () => {
    const first = [
      visit(T('09:00:00')),
      step(T('09:01:00'), 'faded-decode', false),
      step(T('09:02:00'), 'ridge', false),
      complete(T('09:03:00')),
    ]
    const replay = [
      visit(T('09:00:00', '2026-10-06')),
      step(T('09:01:00', '2026-10-06'), 'faded-decode', true),
      step(T('09:02:00', '2026-10-06'), 'ridge', true),
      complete(T('09:03:00', '2026-10-06')),
    ]
    const alone = selectBootOutcome(first)
    const both = selectBootOutcome([...first, ...replay])
    expect(both).toEqual({ ...alone, returnedWithin7Days: both.returnedWithin7Days })
    expect(both.correct).toBe(0)
    expect(both.completedAt).toBe(T('09:03:00'))
  })

  test('an abandoned visit does not stretch the session: timing starts at the last visit before the first answer', () => {
    const o = selectBootOutcome([
      visit(T('09:00:00')), // opened /boot, left
      visit(T('09:00:00', '2026-10-09')), // came back five days later
      step(T('09:01:00', '2026-10-09'), 'faded-decode', true),
      step(T('09:02:00', '2026-10-09'), 'ridge', true),
      complete(T('09:04:00', '2026-10-09')),
    ])
    expect(o.firstSuccessMs).toBe(60_000)
    expect(o.totalMs).toBe(4 * 60_000)
    expect(o).toMatchObject({ correct: 2, graded: 2 })
  })

  test('the figures the page wrote on completion win over the event gaps', () => {
    const o = selectBootOutcome([
      visit(T('09:00:00')),
      visit(T('09:00:00', '2026-10-09')),
      step(T('09:01:00', '2026-10-09'), 'ridge', true),
      complete(T('09:05:00', '2026-10-09'), { totalMs: 270_000, firstSuccessMs: 55_000, correct: 1, graded: 5 }),
    ])
    expect(o.firstSuccessMs).toBe(55_000)
    expect(o.totalMs).toBe(270_000)
    // junk in the data falls back to the event times
    const junk = selectBootOutcome([visit(T('09:00:00')), step(T('09:01:00'), 'ridge', true), complete(T('09:05:00'), { totalMs: 'x', firstSuccessMs: -1 })])
    expect(junk.firstSuccessMs).toBe(60_000)
    expect(junk.totalMs).toBe(5 * 60_000)
  })

  test('a step answered twice in one session counts once, by its first answer', () => {
    const o = selectBootOutcome([
      visit(T('09:00:00')),
      step(T('09:01:00'), 'ridge', false),
      step(T('09:02:00'), 'ridge', true),
      complete(T('09:03:00')),
    ])
    expect(o).toMatchObject({ correct: 0, graded: 1 })
  })

  describe('the 7-day return', () => {
    const boot = [visit(T('09:00:00')), step(T('09:01:00'), 'faded-decode', true), complete(T('09:02:00'))]

    test('a graded event on a later day within a week is a return', () => {
      const o = selectBootOutcome([...boot, quiz(T('08:00:00', '2026-10-05'))])
      expect(o.returnedWithin7Days).toBe(true)
    })

    test('the same local day is not a return', () => {
      expect(selectBootOutcome([...boot, quiz(T('18:00:00'))]).returnedWithin7Days).toBeNull()
    })

    test('a visit or completion is not graded, and Boot itself is not a return', () => {
      const trace = base(T('08:00:00', '2026-10-05'), { kind: 'complete', ref: 'lesson:t0.l1' })
      const replay = step(T('08:00:00', '2026-10-05'), 'ridge', true)
      expect(selectBootOutcome([...boot, trace, replay]).returnedWithin7Days).toBeNull()
    })

    test('pending until the week has passed, then false', () => {
      expect(selectBootOutcome(boot, { now: T('09:00:00', '2026-10-08') }).returnedWithin7Days).toBeNull()
      expect(selectBootOutcome(boot, { now: T('09:00:00', '2026-10-12') }).returnedWithin7Days).toBe(false)
    })

    test('a return after the week is no return', () => {
      const late = quiz(T('09:00:00', '2026-10-12'))
      expect(selectBootOutcome([...boot, late], { now: T('10:00:00', '2026-10-13') }).returnedWithin7Days).toBe(false)
    })

    test('local days decide, not 24-hour gaps', () => {
      // 23:50 on one local day, 00:10 on the next: twenty minutes apart, a different day
      const night = [visit('2026-10-04T23:40:00.000Z'), step('2026-10-04T23:45:00.000Z', 'ridge', true), complete('2026-10-04T23:50:00.000Z')]
      const next = quiz('2026-10-05T00:10:00.000Z')
      expect(selectBootOutcome([...night, next]).returnedWithin7Days).toBe(true)
    })

    test('the activation lever: ≥3 correct and a return', () => {
      const good = [
        visit(T('09:00:00')),
        ...['guess-1user', 'faded-decode', 'ridge'].map((n, i) => step(T(`09:0${i + 1}:00`), n, true)),
        complete(T('09:05:00')),
        quiz(T('09:00:00', '2026-10-06')),
      ]
      expect(isActivated(selectBootOutcome(good))).toBe(true)
      expect(isActivated(selectBootOutcome(good.slice(0, 5)))).toBe(false) // no return yet
      const weak = [visit(T('09:00:00')), step(T('09:01:00'), 'ridge', true), complete(T('09:05:00')), quiz(T('09:00:00', '2026-10-06'))]
      expect(isActivated(selectBootOutcome(weak))).toBe(false) // returned, but 1 correct
    })
  })
})

describe('through the real façade', () => {
  test('a Boot run written the way the page writes it reads back as the same outcome', async () => {
    const p = makeProfile({ ms: Date.parse('2026-10-04T09:00:00.000Z') })
    const tab = startTab(p)
    const s = tab.progress.getState()

    s.recordVisit('boot')
    p.clock.advance(1)
    const guess = gradeGuess(5000, truthFor('guess-1user')) // the "right number, wrong reason" guess: 5,000 is not within 2× of 208.6
    s.recordItems([
      {
        kind: 'predict',
        ref: 'boot:guess-1user',
        rev: bootRev('guess-1user'),
        ...guess,
        conf: 'sure',
        ms: 60_000,
        data: { value: 5000, unit: 'tok/s', truth: Number(BOOT.decodeTps.toFixed(1)), src: 'boot' },
      },
    ])
    p.clock.advance(2)
    s.recordItems([
      {
        kind: 'item',
        ref: 'boot:faded-decode',
        rev: bootRev('faded-decode'),
        ...gradeNear(209, truthFor('faded-decode'), 0.05),
        ms: 120_000,
        data: { src: 'boot', value: 209 },
      },
    ])
    p.clock.advance(5)
    for (const name of GRADED_STEPS.slice(2)) {
      s.recordItems([
        {
          kind: 'item',
          ref: `boot:${name}`,
          rev: bootRev(name),
          ...gradeNear(truthFor(name), truthFor(name), 0.1),
          data: { src: 'boot', value: truthFor(name) },
        },
      ])
    }
    p.clock.advance(1)
    s.completeRef('boot', { totalMs: 9 * 60_000, firstSuccessMs: 3 * 60_000, correct: 4, graded: 5 })
    s.setWorking('boot:path', 'serving-first')
    await tab.progress.controls.flush()

    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'predict')).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'item')).toHaveLength(4)
    expect(events.every((e) => e.kind !== 'item' || e.rev.length > 0)).toBe(true)
    const outcome = selectBootOutcome(events)
    expect(outcome).toMatchObject({ correct: 4, graded: 5 })
    expect(outcome.firstSuccessMs).toBe(3 * 60_000) // 1 + 2 min after the visit
    expect(outcome.totalMs).toBe((1 + 2 + 5 + 1) * 60_000)

    // Boot pays no XP (spec §12.4, Addendum A3) and the flow marks completion without crediting a lesson
    expect(tab.progress.getState().xp).toBe(0)
    expect(tab.progress.getState().completions.boot).toBeDefined()
    expect(tab.progress.getState().working['boot:path']).toBe('serving-first')
    expect(Object.keys(tab.progress.getState().lessons)).toHaveLength(0)
  })
})
