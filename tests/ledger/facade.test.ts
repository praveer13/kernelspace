/**
 * The useProgress façade (spec §8): hydration, the existing actions, the additive actions, the write
 * path through the outbox, read-only mode, and P7 (optimistic agreement) through the real engine on a
 * MemoryStore. Start fresh (Addendum A1) is asserted throughout: `kernelspace:v1` is never touched.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { derive } from '../../src/lib/ledger/fold'
import { SCHEMA_VERSION } from '../../src/lib/ledger/constants'
import { MemoryStore } from '../../src/lib/ledger/memory-store'
import { OUTBOX_PREFIX, SNAPSHOT_KEY } from '../../src/lib/ledger/names'
import { outboxKey, readOutbox } from '../../src/lib/ledger/outbox'
import { stableStringify } from '../../src/lib/ledger/stable'
import type { SnapshotV2 } from '../../src/lib/ledger/types'
import { toProgressData, workingMap } from '../../src/lib/ledger/view'
import { parseImport } from '../../src/lib/ledger/codec'
import { createProgressStore, selectDoneLessons, selectStreak } from '../../src/lib/progress'
import { splitmix32 } from '../../src/lib/rng'
import { dataOf, makeProfile, startTab, tick } from './env'
import { ACTS, int, LABS, LESSONS, pick, SEEDS, SIM, SIM_TASKS, STEPS, chance, PROPERTY_TIMEOUT_MS } from './gen'

setDefaultTimeout(PROPERTY_TIMEOUT_MS)

const V1_VALUE = JSON.stringify({
  state: {
    version: 2,
    lessons: { 't0.l1': { status: 'done', completedAt: '2026-08-20T17:02:11.000Z', lastVisitedAt: '2026-08-20T17:02:11.000Z' } },
    sims: {},
    labs: {},
    fleetWeek: { actsDone: [], scores: {} },
    capstone: { step: 0, stepsDone: [] },
    xp: 4000,
    streakDays: ['2026-08-20'],
    achievements: ['fleet-week'],
    settings: {},
  },
  version: 3,
})

describe('hydration (§8.2)', () => {
  test('starts empty with no snapshot, synchronously, before any engine', () => {
    const p = makeProfile()
    const tab = startTab(p)
    const s = tab.progress.getState()
    expect(s.xp).toBe(0)
    expect(s.lessons).toEqual({})
    expect(s.streakDays).toEqual([])
    expect(s.ledger).toEqual({ ready: false, readOnly: false, backend: 'snapshot-only' })
    expect(tab.loads()).toBe(0)
  })

  test('hydrates from the kernelspace:v2 snapshot a previous load wrote', async () => {
    const p = makeProfile()
    const first = startTab(p)
    first.progress.getState().markLessonStatus('t0.l1', 'done')
    first.progress.getState().setSimConfig('sim-kv', { batch: 8 })
    await first.progress.controls.flush()
    expect(p.storage.data.has(SNAPSHOT_KEY)).toBe(true)

    const second = startTab(p) // a reload: new tab id, same storage
    const s = second.progress.getState()
    expect(s.lessons['t0.l1']?.status).toBe('done')
    expect(s.xp).toBe(100)
    expect(s.sims['sim-kv']?.lastConfig).toEqual({ batch: 8 })
    expect(second.loads()).toBe(0) // no engine needed for first paint
  })

  test('a corrupt or foreign-format snapshot is ignored', () => {
    for (const raw of ['not json', '{"schemaVersion":3,"aggregateVersion":99,"aggregate":{},"working":[]}', '[]', 'null']) {
      const p = makeProfile()
      p.storage.data.set(SNAPSHOT_KEY, raw)
      const tab = startTab(p)
      expect(tab.progress.getState().xp).toBe(0)
      expect(tab.progress.getState().ledger.readOnly).toBe(false)
    }
  })

  test('first load with an old kernelspace:v1 value starts an empty ledger and never reads or writes that key', async () => {
    const p = makeProfile()
    p.storage.data.set('kernelspace:v1', V1_VALUE)
    const tab = startTab(p)
    const s = tab.progress.getState()
    expect(s.xp).toBe(0)
    expect(s.lessons).toEqual({})
    expect(s.achievements).toEqual([])
    expect(s.streakDays).toEqual([])

    // A whole session: writes, engine boot, snapshot, flush.
    s.markLessonStatus('t0.l2', 'done')
    s.recordQuizScore('t0.l2', 1)
    await tab.progress.controls.flush()
    const engine = await tab.engine()
    await engine.exportV3()
    expect(tab.progress.getState().xp).toBe(140)
    expect(p.storage.touched('kernelspace:v1')).toBe(false)
    expect(p.storage.data.get('kernelspace:v1')).toBe(V1_VALUE)
    expect((await engine.events()).every((e) => e.dev !== 'legacy')).toBe(true)
  })

  test('reset removes only v3 state and never touches kernelspace:v1', async () => {
    const p = makeProfile()
    p.storage.data.set('kernelspace:v1', V1_VALUE)
    const tab = startTab(p)
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    await tab.progress.controls.flush()
    tab.progress.getState().resetProgress()
    await tab.progress.controls.flush()
    expect(tab.progress.getState().xp).toBe(0)
    expect(p.storage.touched('kernelspace:v1')).toBe(false)
    expect(p.storage.data.get('kernelspace:v1')).toBe(V1_VALUE)
  })
})

describe('existing actions (§8.3)', () => {
  test('markLessonStatus: done pays 100 XP synchronously, once; reading is one visit per day; unstarted never regresses', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'reading')
    expect(getState().lessons['t0.l1']?.status).toBe('reading')
    expect(getState().xp).toBe(0)

    getState().markLessonStatus('t0.l1', 'done')
    expect(getState().xp).toBe(100) // Lesson.tsx reads getState().xp right after
    expect(getState().lessons['t0.l1']?.status).toBe('done')
    expect(getState().lessons['t0.l1']?.completedAt).toBeDefined()
    expect(selectDoneLessons(getState())).toBe(1)

    getState().markLessonStatus('t0.l1', 'done')
    expect(getState().xp).toBe(100)
    getState().markLessonStatus('t0.l1', 'unstarted')
    getState().markLessonStatus('t0.l1', 'reading')
    expect(getState().lessons['t0.l1']?.status).toBe('done')
  })

  test('reading writes one visit per lesson per local day', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'reading')
    getState().markLessonStatus('t0.l1', 'reading')
    p.clock.advance(60)
    getState().markLessonStatus('t0.l1', 'reading')
    p.clock.advance(24 * 60)
    getState().markLessonStatus('t0.l1', 'reading')
    await tab.progress.controls.flush()
    const visits = (await (await tab.engine()).events({ kinds: ['visit'] })).length
    expect(visits).toBe(2)
  })

  test('the local day follows the clock zone', async () => {
    const p = makeProfile({ ms: Date.parse('2026-10-04T23:30:00.000Z'), tz: 120 }) // 01:30 on the 5th, UTC+2
    const tab = startTab(p)
    tab.progress.getState().recordSimTask('sim-kv', 'a')
    expect(tab.progress.getState().streakDays).toEqual(['2026-10-05'])
  })

  test('quiz: the pass pays 40 XP once however many passes; best score is kept', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().recordQuizScore('t0.l1', 0.6)
    expect(getState().xp).toBe(0)
    expect(getState().lessons['t0.l1']?.quizScore).toBe(0.6)
    getState().recordQuizScore('t0.l1', 0.8)
    expect(getState().xp).toBe(40)
    getState().recordQuizScore('t0.l1', 1)
    getState().recordQuizScore('t0.l1', 0.2)
    expect(getState().xp).toBe(40)
    expect(getState().lessons['t0.l1']?.quizScore).toBe(1)
    expect(getState().streakDays).toHaveLength(1)
  })

  test('exercise, sim visits and tasks, and their skip rules', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().markExerciseDone('t0.l1')
    getState().markExerciseDone('t0.l1')
    expect(getState().xp).toBe(60)
    expect(getState().lessons['t0.l1']?.exerciseDone).toBe(true)

    getState().recordSimVisit('sim-kv')
    getState().recordSimVisit('sim-kv')
    expect(getState().sims['sim-kv']?.visits).toBe(2)
    getState().recordSimTask('sim-kv', 'a')
    getState().recordSimTask('sim-kv', 'a')
    expect(getState().sims['sim-kv']?.tasksDone).toEqual(['a'])
    expect(getState().xp).toBe(120)
    await tab.progress.controls.flush()
    expect((await (await tab.engine()).events({ kinds: ['sim-task'] })).length).toBe(1)
  })

  test('labs: every run is evidence; done and 200 XP once; the streak needs a pass', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().recordLabResult('lab-a', [], 4)
    expect(getState().labs['lab-a']).toEqual({ done: false, checksDone: [] })
    expect(getState().streakDays).toEqual([]) // nothing passed: no streak day
    getState().recordLabResult('lab-a', ['c1', 'c2'], 4)
    expect(getState().streakDays).toHaveLength(1)
    getState().recordLabResult('lab-a', ['c3', 'c4'], 4, { wasmSha256: 'ab'.repeat(32), seed: 7 })
    expect(getState().labs['lab-a']?.done).toBe(true)
    expect(getState().labs['lab-a']?.checksDone).toEqual(['c1', 'c2', 'c3', 'c4'])
    expect(getState().labs['lab-a']?.completedAt).toBeDefined()
    expect(getState().xp).toBe(200)
    getState().recordLabResult('lab-a', ['c1'], 4)
    expect(getState().xp).toBe(200)
    expect(getState().labs['lab-a']?.done).toBe(true)

    await tab.progress.controls.flush()
    const runs = await (await tab.engine()).events({ kinds: ['lab-check'] })
    expect(runs).toHaveLength(4) // never skipped
    const withMeta = runs.find((e) => 'wasmSha256' in e)
    expect(withMeta).toMatchObject({ seed: 7, provenance: 'lab-green', ok: true, wasmSha256: 'ab'.repeat(32) })
    expect(runs.every((e) => e.kind === 'lab-check' && e.provenance === 'lab-green')).toBe(true)
  })

  test('Fleet Week: acts pay once, scores keep the max, the fourth act latches the achievement', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().completeFleetWeekAct('engine', 0.5)
    getState().completeFleetWeekAct('engine', 0.9)
    getState().completeFleetWeekAct('engine', 0.2)
    expect(getState().fleetWeek.scores.engine).toBe(0.9)
    expect(getState().xp).toBe(250)
    for (const act of ['fleet', 'business']) getState().completeFleetWeekAct(act, 1)
    expect(getState().achievements).toEqual([])
    getState().completeFleetWeekAct('incident', 1)
    expect(getState().achievements).toEqual(['fleet-week'])
    expect(getState().fleetWeek.actsDone).toEqual(['business', 'engine', 'fleet', 'incident'])
    getState().completeFleetWeekAct('incident', 1)
    expect(getState().achievements).toEqual(['fleet-week'])
    expect(getState().xp).toBe(1000)
  })

  test('Fleet Week notes: doc text and shallow-merged evidence', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().setFleetWeekDoc('draft')
    getState().setFleetWeekEvidence('engine', { analysis: 'why' })
    getState().setFleetWeekEvidence('engine', { screenshotName: 'a.png', screenshotBytes: 12 })
    expect(getState().fleetWeek.docText).toBe('draft')
    expect(getState().fleetWeek.measurementEvidence).toEqual({
      engine: { analysis: 'why', screenshotName: 'a.png', screenshotBytes: 12 },
    })
  })

  test('Capstone: steps pay once, step is the max index + 1, metrics are working state', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().completeCapstoneStep('s3', 2)
    getState().completeCapstoneStep('s3', 2)
    getState().completeCapstoneStep('s1', 0)
    expect(getState().capstone.stepsDone).toEqual(['s1', 's3'])
    expect(getState().capstone.step).toBe(3)
    expect(getState().xp).toBe(300)
    getState().setCapstoneMetrics({ ttft: 1, itl: 2, throughput: 3 })
    expect(getState().capstone.metrics).toEqual({ ttft: 1, itl: 2, throughput: 3 })
  })

  test('achievements latch once; settings merge per field', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().unlockAchievement('first-quiz')
    getState().unlockAchievement('first-quiz')
    expect(getState().achievements).toEqual(['first-quiz'])
    getState().updateSettings({ codeLang: 'rust' })
    getState().updateSettings({ reducedMotion: true })
    expect(getState().settings).toEqual({ codeLang: 'rust', reducedMotion: true })
  })

  test('scroll position needs an existing lesson record, as before', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().setLessonScroll('t0.l1', 40)
    expect(getState().lessons['t0.l1']).toBeUndefined()
    getState().markLessonStatus('t0.l1', 'reading')
    getState().setLessonScroll('t0.l1', 40)
    expect(getState().lessons['t0.l1']?.scrollPct).toBe(40)
  })

  test('selectStreak and the activity selectors work over the new data', () => {
    const tab = startTab(makeProfile())
    tab.progress.getState().recordSimTask('sim-kv', 'a')
    expect(selectStreak(tab.progress.getState())).toBeGreaterThan(-1)
    expect(tab.progress.getState().streakDays).toEqual(['2026-10-04'])
  })

  test('untouched parts of the view keep their object identity across actions', () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'done')
    const before = getState()
    getState().recordSimTask('sim-kv', 'a')
    const after = getState()
    expect(after.lessons).toBe(before.lessons)
    expect(after.labs).toBe(before.labs)
    expect(after.settings).toBe(before.settings)
    expect(after.sims).not.toBe(before.sims)
    expect(after.xp).toBe(160)
  })
})

describe('additive actions (§8.4)', () => {
  test('recordQuizAttempt writes n items and one quiz sharing a group', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().recordQuizAttempt({
      lessonId: 't0.l3',
      seed: 12345,
      ms: 9000,
      responses: [
        { qi: 0, rev: 'r0', pick: [1], ok: true, conf: 'sure' },
        { qi: 3, rev: 'r3', pick: [0, 2], ok: false, conf: 'guess' },
        { qi: 1, rev: 'r1', pick: [2], ok: true },
        { qi: 2, rev: 'r2', pick: [0], ok: true, conf: 'think' },
        { qi: 4, rev: 'r4', pick: [1], ok: true },
      ],
    })
    expect(getState().lessons['t0.l3']?.quizScore).toBe(0.8)
    expect(getState().xp).toBe(40)
    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    const items = events.filter((e) => e.kind === 'item')
    const quiz = events.filter((e) => e.kind === 'quiz')
    expect(items).toHaveLength(5)
    expect(quiz).toHaveLength(1)
    const grp = (quiz[0] as { data?: { grp?: string } }).data?.grp
    expect(grp).toBeTruthy()
    for (const e of items) expect((e as { data: { grp: string } }).data.grp).toBe(grp)
    expect(items.find((e) => e.ref === 'quiz:t0.l3#3')).toMatchObject({
      score: 0,
      ok: false,
      conf: 'guess',
      seed: 12345,
      rev: 'r3',
      provenance: 'practice',
      data: { src: 'quiz', pick: [0, 2], lessonId: 't0.l3' },
    })
    expect(quiz[0]).toMatchObject({ score: 0.8, ok: true, seed: 12345, ms: 9000, data: { n: 5 } })
    expect('conf' in items.find((e) => e.ref === 'quiz:t0.l3#1')!).toBe(false)
  })

  test('recordItems, acknowledge, completeRef, recordVisit and setWorking', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().recordItems([
      { kind: 'predict', ref: 'boot:guess-1user', rev: 'b1', score: 0.7, ok: true, conf: 'think', data: { value: 200, unit: 'tok/s', truth: 208.6, src: 'boot' } },
      { kind: 'item', ref: 'boot:ridge', rev: 'b2', score: 0, ok: false, provenance: 'assisted', data: { src: 'boot', value: 100 } },
    ])
    expect(getState().xp).toBe(0)
    expect(getState().streakDays).toHaveLength(1) // graded work earns the day

    getState().acknowledge('erratum:e1')
    getState().acknowledge('erratum:e1')
    expect(Object.keys(getState().acks)).toEqual(['erratum:e1'])

    getState().completeRef('boot', { totalMs: 5000 })
    expect(Object.keys(getState().completions)).toEqual(['boot'])
    getState().recordVisit('boot')
    getState().recordVisit('lesson:t0.l1')
    getState().recordVisit('lesson:t0.l1') // deduplicated per day
    getState().recordVisit('sim:sim-kv')
    getState().setWorking('boot:path', 'serving-first')
    getState().setWorking('boot:path', 'serving-first') // unchanged: no write
    expect(getState().working['boot:path']).toBe('serving-first')

    await tab.progress.controls.flush()
    const events = await (await tab.engine()).events()
    expect(events.filter((e) => e.kind === 'ack')).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'complete')).toHaveLength(1)
    expect(events.filter((e) => e.kind === 'visit')).toHaveLength(3)
    expect(events.find((e) => e.kind === 'item')).toMatchObject({ provenance: 'assisted' })
    expect(events.find((e) => e.kind === 'predict')).toMatchObject({ provenance: 'practice', conf: 'think' })
    const file = await (await tab.engine()).exportV3()
    expect(file.working.filter((w) => w.key === 'boot:path')).toHaveLength(1)
  })

  test('events written by every action pass the codec (an export of a full session re-imports)', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    runSession(tab.progress.getState())
    await tab.progress.controls.flush()
    const text = JSON.stringify(await (await tab.engine()).exportV3())
    const parsed = parseImport(text)
    expect(parsed.ok).toBe(true)
  })
})

describe('write path (§8.5, §8.6)', () => {
  test('an action reaches the outbox synchronously, before the engine commit, and leaves it once committed', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    // Nothing awaited yet: the engine has not even loaded.
    const box = readOutbox(p.storage, tab.tabId)
    expect(box?.events.map((e) => e.kind)).toEqual(['complete'])
    expect((await p.store.readAll()).events).toHaveLength(0)

    await tab.progress.controls.flush()
    expect((await p.store.readAll()).events.map((e) => e.kind)).toEqual(['complete'])
    expect(p.storage.data.has(outboxKey(tab.tabId))).toBe(false)
  })

  test('the first write loads the engine (once) and hands it everything written meanwhile', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'done')
    getState().recordSimTask('sim-kv', 'a')
    getState().setSimConfig('sim-kv', { batch: 2 })
    getState().recordQuizScore('t0.l1', 1)
    await tab.progress.controls.flush()
    expect(tab.loads()).toBe(1)
    const engine = await tab.engine()
    expect((await engine.events()).map((e) => e.kind).sort()).toEqual(['complete', 'quiz', 'sim-task'])
    const file = await engine.exportV3()
    expect(file.working.map((w) => w.key)).toEqual(['sim-config:sim-kv'])
    expect(tab.progress.getState().ledger.ready).toBe(true)
    expect(tab.progress.getState().ledger.backend).toBe('memory')
  })

  test('the snapshot is written debounced, and carries the derived aggregate', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    expect(p.storage.data.has(SNAPSHOT_KEY)).toBe(false) // not yet: debounced
    await tick(30)
    const snap = JSON.parse(p.storage.data.get(SNAPSHOT_KEY)!) as SnapshotV2
    expect(snap.schemaVersion).toBe(SCHEMA_VERSION)
    expect(snap.aggregateVersion).toBe(1)
    expect(snap.tab).toBe(tab.tabId)
    expect(snap.aggregate.events).toBe(1)
    expect(snap.aggregate.facts).toEqual({ 'lesson:t0.l1': true })
    await tab.progress.controls.flush()
  })

  test('scroll commits are deferred (2 s) while state updates at once; a flush sends them', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'reading')
    await tab.progress.controls.flush()
    getState().setLessonScroll('t0.l1', 10)
    getState().setLessonScroll('t0.l1', 55)
    expect(getState().lessons['t0.l1']?.scrollPct).toBe(55)
    expect(readOutbox(p.storage, tab.tabId)).toBeNull() // nothing durable yet
    await tab.progress.controls.flush()
    const file = await (await tab.engine()).exportV3()
    expect(file.working.find((w) => w.key === 'scroll:t0.l1')?.value).toBe(55)
  })

  test('a scroll write is not broadcast to other tabs (device-local)', async () => {
    const p = makeProfile()
    const a = startTab(p)
    const b = startTab(p)
    await a.engine()
    await b.engine()
    a.progress.getState().markLessonStatus('t0.l1', 'reading')
    await a.progress.controls.flush()
    await tick(5)
    p.bus.sent.length = 0
    a.progress.getState().setLessonScroll('t0.l1', 80)
    await a.progress.controls.flush()
    await tick(5)
    expect(p.bus.sent.filter((m) => (m as { t: string }).t === 'append')).toHaveLength(0)
    a.progress.getState().setSimConfig('sim-kv', { x: 1 })
    await a.progress.controls.flush()
    await tick(5)
    expect(p.bus.sent.filter((m) => (m as { t: string }).t === 'append')).toHaveLength(1)
  })

  test('quota errors on the outbox and snapshot never break an action', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    p.storage.failWrites = true
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    expect(tab.progress.getState().xp).toBe(100)
    await tab.progress.controls.flush()
    expect((await p.store.readAll()).events).toHaveLength(1) // IndexedDB still committed
  })

  test('with no localStorage at all the store still works and commits', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const env = { ...tab.env, storage: null }
    const bare = createProgressStore(env, { scheduleBoot: () => {} })
    bare.getState().markLessonStatus('t0.l1', 'done')
    expect(bare.getState().xp).toBe(100)
    await bare.controls.flush()
    expect((await p.store.readAll()).events).toHaveLength(1)
  })
})

describe('read-only mode (§8.7, P10)', () => {
  test('a snapshot from a newer schema hydrates read-only; actions are no-ops with zero writes', async () => {
    const p = makeProfile()
    const first = startTab(p)
    first.progress.getState().markLessonStatus('t0.l1', 'done')
    await first.progress.controls.flush()
    const snap = JSON.parse(p.storage.data.get(SNAPSHOT_KEY)!) as SnapshotV2
    snap.schemaVersion = SCHEMA_VERSION + 1
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify(snap))
    p.storage.log = []
    const outboxesBefore = [...p.storage.data.keys()].filter((k) => k.startsWith(OUTBOX_PREFIX))

    const tab = startTab(p)
    const { getState } = tab.progress
    expect(getState().ledger).toMatchObject({ readOnly: true, reason: 'snapshot-newer' })
    expect(getState().lessons['t0.l1']?.status).toBe('done') // still shows what it has

    getState().markLessonStatus('t0.l2', 'done')
    getState().recordQuizScore('t0.l2', 1)
    getState().setSimConfig('sim-kv', { a: 1 })
    getState().updateSettings({ codeLang: 'c' })
    getState().recordQuizAttempt({ lessonId: 't0.l2', seed: 1, responses: [{ qi: 0, rev: 'r', pick: [0], ok: true }] })
    expect(getState().importProgress('{}')).toBe(false)
    getState().resetProgress()
    await tab.progress.controls.flush()
    await tick(20)

    expect(getState().lessons['t0.l2']).toBeUndefined()
    expect(getState().xp).toBe(100)
    expect(p.storage.writes()).toEqual([])
    expect([...p.storage.data.keys()].filter((k) => k.startsWith(OUTBOX_PREFIX))).toEqual(outboxesBefore)
    expect(tab.loads()).toBe(0) // it does not even boot the engine
    expect(JSON.parse(p.storage.data.get(SNAPSHOT_KEY)!).schemaVersion).toBe(SCHEMA_VERSION + 1)
  })

  test('the engine finding a newer schema in the store makes the façade read-only', async () => {
    const p = makeProfile({ seed: { meta: { schema: { version: SCHEMA_VERSION + 1, at: '2026-10-04T00:00:00.000Z' } } } })
    let commits = 0
    const store = p.store
    const commit = store.commit.bind(store)
    store.commit = (...args) => {
      commits += 1
      return commit(...args)
    }
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'done') // loads the engine
    await tab.progress.controls.flush()
    const afterFirst = commits
    expect(getState().ledger).toMatchObject({ readOnly: true, reason: 'newer-schema', ready: true })
    getState().markLessonStatus('t0.l2', 'done')
    getState().setSimConfig('sim-kv', { a: 1 })
    getState().recordSimTask('sim-kv', 'a')
    await tab.progress.controls.flush()
    expect(commits).toBe(afterFirst) // no commits after read-only, and the engine boot committed nothing
    expect(commits).toBe(0)
    expect(getState().lessons['t0.l2']).toBeUndefined()
  })

  test('a newer bundle in another tab (channel hello) puts this tab read-only mid-session', async () => {
    const p = makeProfile()
    const old = startTab(p)
    await old.engine()
    old.progress.getState().markLessonStatus('t0.l1', 'done')
    await old.progress.controls.flush()
    expect(old.progress.getState().ledger.readOnly).toBe(false)

    const newer = startTab(p, { schemaVersion: SCHEMA_VERSION + 1 })
    await newer.engine() // announces hello with the newer schema
    await tick(10)
    expect(old.progress.getState().ledger).toMatchObject({ readOnly: true, reason: 'newer-schema' })

    p.storage.log = []
    old.progress.getState().markLessonStatus('t0.l2', 'done')
    old.progress.getState().recordSimTask('sim-kv', 'a')
    await old.progress.controls.flush()
    expect(old.progress.getState().lessons['t0.l2']).toBeUndefined()
    expect(p.storage.writes()).toEqual([])
    expect(await old.engine().then((e) => e.events())).toHaveLength(1)
  })

  test('a versionchange (another tab upgrading the database) makes the tab read-only', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    await tab.progress.controls.flush()
    p.store.simulateVersionChange()
    expect(tab.progress.getState().ledger).toMatchObject({ readOnly: true, reason: 'versionchange' })
    tab.progress.getState().markLessonStatus('t0.l2', 'done')
    expect(tab.progress.getState().lessons['t0.l2']).toBeUndefined()
  })

  test('a tab never overwrites a newer bundle snapshot (I6)', async () => {
    const p = makeProfile()
    const tab = startTab(p, { snapshotDelayMs: 1000 })
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    p.storage.data.set(SNAPSHOT_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, aggregateVersion: 1, aggregate: {}, working: [] }))
    p.storage.log = []
    await tab.progress.controls.flush()
    expect(JSON.parse(p.storage.data.get(SNAPSHOT_KEY)!).schemaVersion).toBe(SCHEMA_VERSION + 1)
    expect(p.storage.writes().includes(SNAPSHOT_KEY)).toBe(false)
    expect(tab.progress.getState().ledger.readOnly).toBe(true)
  })
})

describe('cross-tab sync (§9.4)', () => {
  test('a write in one tab appears in the other', async () => {
    const p = makeProfile()
    const a = startTab(p)
    const b = startTab(p)
    await a.engine()
    await b.engine()
    // Both façades are subscribed once they boot; boot b's subscription too.
    await b.progress.controls.engine()
    await a.progress.controls.engine()

    a.progress.getState().markLessonStatus('t0.l1', 'done')
    a.progress.getState().recordSimTask('sim-kv', 'a')
    a.progress.getState().updateSettings({ codeLang: 'rust' })
    await a.progress.controls.flush()
    await tick(10)
    const s = b.progress.getState()
    expect(s.lessons['t0.l1']?.status).toBe('done')
    expect(s.sims['sim-kv']?.tasksDone).toEqual(['a'])
    expect(s.settings.codeLang).toBe('rust')
    expect(s.xp).toBe(160)
    expect(dataOf(s)).toEqual(dataOf(a.progress.getState()))
  })

  test('both tabs writing at once converge', async () => {
    const p = makeProfile()
    const a = startTab(p)
    const b = startTab(p)
    await a.progress.controls.engine()
    await b.progress.controls.engine()
    a.progress.getState().markLessonStatus('t0.l1', 'done')
    b.progress.getState().markLessonStatus('t0.l2', 'done')
    b.progress.getState().recordQuizScore('t0.l2', 1)
    await a.progress.controls.flush()
    await b.progress.controls.flush()
    await tick(10)
    expect(dataOf(a.progress.getState())).toEqual(dataOf(b.progress.getState()))
    expect(a.progress.getState().xp).toBe(240)
  })

  test('a reset in one tab empties the other, and undo brings it back', async () => {
    const p = makeProfile()
    const a = startTab(p)
    const b = startTab(p)
    await a.progress.controls.engine()
    await b.progress.controls.engine()
    a.progress.getState().markLessonStatus('t0.l1', 'done')
    await a.progress.controls.flush()
    await tick(10)
    expect(b.progress.getState().xp).toBe(100)

    a.progress.getState().resetProgress()
    await a.progress.controls.flush()
    await tick(10)
    expect(a.progress.getState().xp).toBe(0)
    expect(b.progress.getState().xp).toBe(0)
    expect(b.progress.getState().ledger.undo).toMatchObject({ reason: 'reset' })

    expect(await (await a.engine()).undo()).toBe(true)
    await tick(10)
    expect(a.progress.getState().xp).toBe(100)
    expect(b.progress.getState().xp).toBe(100)
    expect(b.progress.getState().ledger.undo).toBeUndefined()
  })

  test('the façade takes an import done through the engine client in this tab', async () => {
    const src = makeProfile({ devicePrefix: 'src-' })
    const from = startTab(src)
    from.progress.getState().markLessonStatus('t0.l4', 'done')
    from.progress.getState().recordSimTask('sim-kv', 'b')
    await from.progress.controls.flush()
    const file = JSON.stringify(await (await from.engine()).exportV3())

    const dst = makeProfile({ devicePrefix: 'dst-' })
    const tab = startTab(dst)
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    await tab.progress.controls.flush()
    const engine = await tab.progress.controls.engine()
    expect(await engine.importFile(file, 'merge')).toMatchObject({ ok: true, added: 2 })
    const s = tab.progress.getState()
    expect(Object.keys(s.lessons).sort()).toEqual(['t0.l1', 't0.l4'])
    expect(s.xp).toBe(100 + 100 + 60)
    expect(s.ledger.undo).toMatchObject({ reason: 'import-merge' })
  })
})

describe('importProgress and resetProgress (§8.3)', () => {
  test('importProgress takes export v3 only, returns at once, and replaces with an undo checkpoint', async () => {
    const src = makeProfile({ devicePrefix: 'src-' })
    const from = startTab(src)
    from.progress.getState().markLessonStatus('t0.l4', 'done')
    await from.progress.controls.flush()
    const file = JSON.stringify(await (await from.engine()).exportV3())

    const dst = makeProfile({ devicePrefix: 'dst-' })
    const tab = startTab(dst)
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'done')
    getState().markLessonStatus('t0.l2', 'done')
    await tab.progress.controls.flush()

    expect(getState().importProgress('not json')).toBe(false)
    expect(getState().importProgress('{"version":2,"lessons":{},"xp":0}')).toBe(false) // an older export
    expect(getState().importProgress(JSON.stringify({ state: { version: 2 }, version: 3 }))).toBe(false)
    expect(getState().importProgress(file)).toBe(true)
    await tab.progress.controls.flush()
    expect(Object.keys(getState().lessons)).toEqual(['t0.l4'])
    expect(getState().xp).toBe(100)
    expect(getState().ledger.undo).toMatchObject({ reason: 'import-replace' })

    expect(await (await tab.engine()).undo()).toBe(true)
    expect(Object.keys(getState().lessons).sort()).toEqual(['t0.l1', 't0.l2'])
    expect(getState().xp).toBe(200)
  })

  test('an invalid v3 file passes the shape check but the engine refuses it and nothing changes', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    await tab.progress.controls.flush()
    const bad = JSON.stringify({ format: 'kernelspace-progress', version: 3, schemaVersion: 3, events: [{ id: 'x' }], working: [] })
    expect(tab.progress.getState().importProgress(bad)).toBe(true)
    await tab.progress.controls.flush()
    expect(tab.progress.getState().xp).toBe(100)
    expect((await (await tab.engine()).events()).length).toBe(1)
  })

  test('resetProgress empties state at once, clears the store, snapshot and outboxes, and can be undone', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const { getState } = tab.progress
    getState().markLessonStatus('t0.l1', 'done')
    getState().setSimConfig('sim-kv', { a: 1 })
    await tab.progress.controls.flush()
    getState().markLessonStatus('t0.l2', 'done') // still only in the outbox when reset runs
    getState().resetProgress()
    expect(getState().xp).toBe(0)
    expect(getState().lessons).toEqual({})
    expect(getState().sims).toEqual({})
    await tab.progress.controls.flush()
    await tick(20)
    const contents = await p.store.readAll()
    expect(contents.events).toHaveLength(0)
    expect(contents.working).toHaveLength(0)
    expect([...p.storage.data.keys()].filter((k) => k.startsWith(OUTBOX_PREFIX))).toEqual([])
    expect(getState().ledger.undo).toMatchObject({ reason: 'reset' })

    getState().markLessonStatus('t0.l3', 'done') // new work after the reset survives
    await tab.progress.controls.flush()
    expect(Object.keys(getState().lessons)).toEqual(['t0.l3'])
    expect(await (await tab.engine()).undo()).toBe(true)
    expect(Object.keys(getState().lessons).sort()).toEqual(['t0.l1', 't0.l2', 't0.l3'])
  })
})

describe('boot (§9.6) through the façade', () => {
  test('orphaned snapshot: IndexedDB came back empty while the snapshot held progress', async () => {
    const p = makeProfile()
    const first = startTab(p)
    first.progress.getState().markLessonStatus('t0.l1', 'done')
    first.progress.getState().recordQuizScore('t0.l1', 1)
    await first.progress.controls.flush()
    const raw = p.storage.data.get(SNAPSHOT_KEY)!
    // The browser evicted IndexedDB (a fresh store) but kept localStorage, including the snapshot.
    const evicted = makeProfile()
    evicted.storage.data.set(SNAPSHOT_KEY, raw)
    const tab = startTab(evicted)
    expect(tab.progress.getState().xp).toBe(140) // first paint from the snapshot
    await tab.progress.controls.engine()
    const { ledger } = tab.progress.getState()
    expect(ledger.cleared?.orphanKey).toBe('kernelspace:v2:orphaned:2026-10-04')
    expect(evicted.storage.data.get('kernelspace:v2:orphaned:2026-10-04')).toBe(raw)
    expect(tab.progress.getState().xp).toBe(0) // derived from the (empty) ledger
  })

  test('a very first session is not mistaken for eviction (the outbox holds what the snapshot counts)', async () => {
    const p = makeProfile()
    const tab = startTab(p, { snapshotDelayMs: 1 })
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    await tick(10) // snapshot written, engine not yet awaited
    const reload = startTab(p) // reload before the engine ever committed? the outbox still holds it
    await reload.progress.controls.engine()
    expect(reload.progress.getState().ledger.cleared).toBeUndefined()
    expect(reload.progress.getState().xp).toBe(100)
  })

  test('IndexedDB unavailable: falls back to memory, keeps the outbox as the durable copy', async () => {
    const p = makeProfile()
    class Broken extends MemoryStore {
      override async open(): Promise<never> {
        throw new Error('SecurityError: the operation is insecure')
      }
    }
    const tab = startTab(p, { store: new Broken(), engine: { fallbackStore: () => new MemoryStore() } })
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    await tab.progress.controls.flush()
    expect(tab.progress.getState().ledger).toMatchObject({ ready: true, readOnly: false, backend: 'memory' })
    expect(tab.progress.getState().xp).toBe(100)
    expect(p.storage.data.has(outboxKey(tab.tabId))).toBe(true) // never settled: it is the store
    // A later load commits the outbox into its fresh memory store.
    const again = startTab(p, { store: new Broken(), engine: { fallbackStore: () => new MemoryStore() } })
    await again.progress.controls.engine()
    expect(again.progress.getState().xp).toBe(100)
  })
})

/* ------------------------------------------------------------------ */
/* P7: optimistic agreement through the engine                          */
/* ------------------------------------------------------------------ */

type State = ReturnType<ReturnType<typeof startTab>['progress']['getState']>

/** One of every action; used for the codec round-trip. */
function runSession(s: State) {
  s.markLessonStatus('t0.l1', 'reading')
  s.markLessonStatus('t0.l1', 'done')
  s.setLessonScroll('t0.l1', 50)
  s.recordQuizScore('t0.l2', 0.9)
  s.markExerciseDone('t0.l1')
  s.recordSimVisit('sim-kv')
  s.recordSimTask('sim-kv', 'a')
  s.setSimConfig('sim-kv', { batch: 4 })
  s.recordLabResult('lab-a', ['c1'], 4, { wasmSha256: 'cd'.repeat(32) })
  s.completeFleetWeekAct('engine', 0.75)
  s.setFleetWeekDoc('notes')
  s.setFleetWeekEvidence('engine', { analysis: 'x' })
  s.completeCapstoneStep('s1', 0)
  s.setCapstoneMetrics({ ttft: 1, itl: 2, throughput: 3 })
  s.unlockAchievement('first-quiz')
  s.updateSettings({ codeLang: 'java', reducedMotion: false })
  s.recordQuizAttempt({ lessonId: 't0.l3', seed: 9, ms: 1000, responses: [{ qi: 0, rev: 'a', pick: [0], ok: true, conf: 'sure' }, { qi: 1, rev: 'b', pick: [1], ok: false }] })
  s.recordItems([{ kind: 'probe', ref: 'quiz:t0.l3#0', rev: 'a', score: 1, ok: true, data: { src: 'cold', lessonId: 't0.l3', sinceDays: 9 } }])
  s.acknowledge('erratum:e1', { via: 'got-it' })
  s.completeRef('boot', { totalMs: 1 })
  s.recordVisit('boot')
  s.setWorking('boot:week', { minutesPerWeek: 120, sessionMinutes: 30, phoneDays: [1], laptopDays: [3], slo: 0.9 })
}

function randomAction(rand: () => number, s: State, clockAdvance: (m: number) => void) {
  clockAdvance(int(rand, 1, 3000))
  const lesson = pick(rand, LESSONS)
  switch (int(rand, 0, 20)) {
    case 0:
      return s.markLessonStatus(lesson, 'reading')
    case 1:
      return s.markLessonStatus(lesson, 'done')
    case 2:
      return s.recordQuizScore(lesson, pick(rand, [0, 0.4, 0.8, 1]))
    case 3:
      return s.markExerciseDone(lesson)
    case 4:
      return s.recordSimVisit(SIM)
    case 5:
      return s.recordSimTask(SIM, pick(rand, SIM_TASKS))
    case 6:
      return s.setSimConfig(SIM, { batch: int(rand, 1, 64) })
    case 7: {
      const lab = pick(rand, Object.keys(LABS))
      const passed = LABS[lab].checks.filter(() => chance(rand, 0.5))
      return s.recordLabResult(lab, passed, LABS[lab].total)
    }
    case 8:
      return s.completeFleetWeekAct(pick(rand, ACTS), Math.round(rand() * 100) / 100)
    case 9:
      return s.setFleetWeekDoc(`doc ${int(rand, 0, 99)}`)
    case 10:
      return s.setFleetWeekEvidence(pick(rand, ACTS), { analysis: `a${int(rand, 0, 9)}` })
    case 11: {
      const i = int(rand, 0, STEPS.length - 1)
      return s.completeCapstoneStep(STEPS[i], i)
    }
    case 12:
      return s.setCapstoneMetrics({ ttft: int(rand, 1, 9), itl: int(rand, 1, 9), throughput: int(rand, 1, 99) })
    case 13:
      return s.unlockAchievement(pick(rand, ['first-quiz', 'night-owl', 'lab-rat']))
    case 14:
      return s.updateSettings({ codeLang: pick(rand, ['python', 'java', 'rust', 'c'] as const) })
    case 15:
      return s.setLessonScroll(lesson, int(rand, 0, 100))
    case 16:
      return s.recordQuizAttempt({
        lessonId: lesson,
        seed: int(rand, 0, 1e6),
        ms: int(rand, 1000, 60000),
        responses: Array.from({ length: int(rand, 1, 5) }, (_, qi) => ({
          qi,
          rev: `r${qi}`,
          pick: [int(rand, 0, 3)],
          ok: chance(rand, 0.7),
          ...(chance(rand, 0.6) ? { conf: pick(rand, ['guess', 'think', 'sure'] as const) } : {}),
        })),
      })
    case 17:
      return s.acknowledge(`erratum:${pick(rand, ['e1', 'e2'])}`)
    case 18:
      return s.completeRef('boot')
    case 19:
      return s.recordVisit(pick(rand, [`lesson:${lesson}`, `sim:${SIM}`, 'boot'] as const))
    default:
      return s.setWorking('boot:value', `v${int(rand, 0, 9)}`)
  }
}

describe('P7 optimistic agreement (I7)', () => {
  test('after every action, the façade data equals toProgressData(derive(ledger))', async () => {
    const seeds = SEEDS
    for (let seed = 1; seed <= seeds; seed++) {
      const rand = splitmix32(seed)
      const p = makeProfile({ tz: pick(rand, [-420, 0, 330, 540]) })
      const tab = startTab(p)
      await tab.progress.controls.engine()
      const engine = await tab.engine()
      let last: { agg: Parameters<Parameters<typeof engine.onAggregate>[0]>[0]; working: Parameters<Parameters<typeof engine.onAggregate>[0]>[1] } | null = null
      engine.onAggregate((agg, working) => {
        last = { agg, working }
      })
      const trace: string[] = []
      for (let i = 0; i < 40; i++) {
        const before = JSON.stringify(dataOf(tab.progress.getState()))
        randomAction(rand, tab.progress.getState(), (m) => p.clock.advance(m))
        trace.push(`#${i} ${before === JSON.stringify(dataOf(tab.progress.getState())) ? 'noop' : 'changed'}`)
        await tab.progress.controls.flush()
        const events = await engine.events()
        const expected = toProgressData(derive(events), workingMap(last!.working))
        if (stableStringify(dataOf(tab.progress.getState())) !== stableStringify(expected)) {
          throw new Error(`seed ${seed} diverged after op ${i}\n${trace.join('\n')}\nfaçade: ${JSON.stringify(dataOf(tab.progress.getState()))}\nledger: ${JSON.stringify(expected)}`)
        }
        expect(stableStringify(last!.agg)).toBe(stableStringify(derive(events)))
      }
    }
  })

  test('the same holds with writes made before the engine loads', async () => {
    const p = makeProfile()
    const tab = startTab(p)
    const rand = splitmix32(99)
    for (let i = 0; i < 25; i++) randomAction(rand, tab.progress.getState(), (m) => p.clock.advance(m))
    const optimistic = stableStringify(dataOf(tab.progress.getState()))
    await tab.progress.controls.flush()
    const engine = await tab.engine()
    const file = await engine.exportV3()
    expect(stableStringify(dataOf(tab.progress.getState()))).toBe(optimistic) // the engine's derive agrees
    expect(stableStringify(toProgressData(derive(file.events), workingMap(file.working)))).toBe(optimistic)
    // And a fresh tab hydrating from the snapshot sees the same thing before any engine.
    const reload = startTab(p)
    expect(stableStringify(dataOf(reload.progress.getState()))).toBe(optimistic)
  })

  test('the optimistic state stays correct while the engine is still loading', async () => {
    const p = makeProfile()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const tab = startTab(p, { engine: {} })
    const real = tab.env.loadEngine
    tab.env.loadEngine = async () => {
      await gate
      return real()
    }
    tab.progress.getState().markLessonStatus('t0.l1', 'done')
    tab.progress.getState().recordSimTask('sim-kv', 'a')
    expect(tab.progress.getState().xp).toBe(160)
    release()
    await tab.progress.controls.flush()
    await tick(5)
    tab.progress.getState().markLessonStatus('t0.l2', 'done')
    expect(tab.progress.getState().xp).toBe(260)
    await tab.progress.controls.flush()
    expect((await (await tab.engine()).events()).length).toBe(3)
    expect(stableStringify(tab.progress.getState().xp)).toBe('260')
  })
})
