/**
 * Outcome tasks, predict → run → explain (wave-1.md §10.3): completion requires a committed prediction, the
 * first observation after the commit is what gets graded, a miss still completes, and the ledger sees one
 * `sim-task` event with the v2 outcome. The reducer is the same one TaskPanel drives, so these walk the
 * actions the panel dispatches; the render checks run the panel itself.
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import PhoneOutcome, { OutcomeChart } from '../../src/components/sims/PhoneOutcome'
import SimMirror from '../../src/components/sims/SimMirror'
import { Note, TaskPanel } from '../../src/components/sims/TaskPanel'
import {
  MAX_EXPLAIN_CHARS,
  SimHostContext,
  buildOutcome,
  buildPhoneOutcome,
  completeTask,
  createFinishedStore,
  createObservationBus,
  explainReady,
  freshRun,
  reduceRun,
  wordCount,
} from '../../src/lib/sims/host'
import type { RunAction, SimHostInternal, TaskRun } from '../../src/lib/sims/host'
import type { CanonicalOutcome } from '../../src/lib/sims/host'
import type { SimTaskDef } from '../../src/lib/sims/types'
import { makeProfile, startTab } from '../ledger/env'

const LINE = 'The ridge is where compute and memory ceilings meet so decode at batch one sits far left'

const TASK: SimTaskDef = {
  id: 'roof.ridge',
  simId: 'sim-roofline',
  kind: 'outcome',
  title: 'Predict the B200 ridge point',
  setup: 'Pick B200 and read the ridge.',
  kcs: ['t4.ridge-point' as SimTaskDef['kcs'][number]],
  predict: { kind: 'numeric', prompt: 'Where is the ridge?', unit: 'FLOP/B', tolerance: { rel: 0.1 }, log: true },
  observe: 'roof.ridge',
  explain: { prompt: 'Why there?', model: 'The ridge is peak FLOPs over peak bandwidth.', ideas: ['peak FLOPs', 'peak bandwidth', 'their ratio'] },
  note: 'Below the ridge you wait on memory.',
  phone: { canonical: 'roofline.b200-ridge' },
}

const CHOICE_TASK: SimTaskDef = {
  ...TASK,
  id: 'roof.decode-bound',
  predict: { kind: 'choice', prompt: 'Bound by?', options: [{ id: 'mem', text: 'Memory' }, { id: 'math', text: 'Math' }] },
  observe: 'roof.bound',
}

/** Apply actions the way the panel dispatches them. */
const play = (task: SimTaskDef, actions: RunAction[], from: TaskRun = freshRun()): TaskRun =>
  actions.reduce((s, a) => reduceRun(task, s, a), from)

const commit = (value: number, conf?: 'guess' | 'think' | 'sure'): RunAction => ({ type: 'commit', prediction: { value }, conf, at: 1_000 })
const observe = (value: number | string, key = 'roof.ridge', extra: Partial<RunAction & { type: 'observe' }> = {}): RunAction => ({
  type: 'observe',
  obs: { key, value, ...(extra as object) },
})
const explain = (text: string): RunAction => ({ type: 'explain', text })

describe('completion requires a committed prediction', () => {
  test('nothing finishes from a fresh run, whatever else arrives', () => {
    const s = play(TASK, [observe(295), explain(LINE), { type: 'idea', index: 0 }, { type: 'finish' }])
    expect(s).toEqual(freshRun())
    expect(buildOutcome(TASK, s)).toBeNull()
    expect(buildOutcome(TASK, { ...freshRun(), observed: { actual: 295, grade: { ok: true, score: 1 } }, explain: LINE })).toBeNull()
  })

  test('an observation from before the commit is never graded; the first one after it is', () => {
    const early = play(TASK, [observe(100)])
    expect(early.phase).toBe('predict')
    const s = play(TASK, [commit(300), observe(295), observe(5)])
    expect(s.phase).toBe('explain')
    expect(s.observed?.actual).toBe(295) // not the later 5
    expect(s.observed?.grade.ok).toBe(true)
  })

  test('observations of another key are ignored while waiting', () => {
    const s = play(TASK, [commit(300), observe(1, 'alloc.frag-pct'), observe(295, 'roof.ridge')])
    expect(s.observed?.actual).toBe(295)
    expect(play(TASK, [commit(300), observe(1, 'alloc.frag-pct')]).phase).toBe('run')
  })

  test('a prediction that does not answer the spec is not a commit', () => {
    expect(play(TASK, [{ type: 'commit', prediction: { value: -5 }, at: 1 }]).phase).toBe('predict') // log needs > 0
    expect(play(TASK, [{ type: 'commit', prediction: { value: Number.NaN }, at: 1 }]).phase).toBe('predict')
    expect(play(TASK, [{ type: 'commit', prediction: { choice: 'mem' }, at: 1 }]).phase).toBe('predict') // wrong kind
    expect(play(CHOICE_TASK, [{ type: 'commit', prediction: { choice: 'nope' }, at: 1 }]).phase).toBe('predict')
  })

  test('the prediction is locked once committed: a second commit changes nothing', () => {
    const s = play(TASK, [commit(300, 'sure'), commit(10, 'guess')])
    expect(s.prediction).toEqual({ value: 300 })
    expect(s.conf).toBe('sure')
  })

  test('a numeric task cannot be graded by a non-numeric observation; it keeps waiting', () => {
    expect(play(TASK, [commit(300), observe('fast')]).phase).toBe('run')
    expect(play(TASK, [commit(300), observe('295')]).phase).toBe('explain') // a numeric string is fine
  })

  test('the explanation needs 8 words before the model answer, the ideas or Save', () => {
    expect(wordCount('')).toBe(0)
    expect(wordCount('  a  b\tc\nd ')).toBe(4)
    expect(explainReady('one two three four five six seven')).toBe(false)
    expect(explainReady('one two three four five six seven eight')).toBe(true)
    const short = play(TASK, [commit(300), observe(295), explain('too short'), { type: 'idea', index: 0 }, { type: 'finish' }])
    expect(short.phase).toBe('explain')
    expect(short.ideas).toEqual([])
    expect(buildOutcome(TASK, short)).toBeNull()
  })

  test('the full cycle reaches done with a v2 outcome', () => {
    const s = play(TASK, [commit(300, 'think'), observe(295, 'roof.ridge'), explain(LINE), { type: 'idea', index: 2 }, { type: 'idea', index: 0 }, { type: 'finish' }])
    expect(s.phase).toBe('done')
    const out = buildOutcome(TASK, s, { ms: 41_234.6 })!
    expect(out).toMatchObject({ taskId: 'roof.ridge', ok: true, score: 1, conf: 'think', ms: 41_235 })
    expect(out.data).toEqual({
      v: 2,
      outcome: true,
      predict: { value: 300, unit: 'FLOP/B' },
      actual: 295,
      logErr: 0.0073,
      explain: LINE,
      ideas: [0, 2],
      kcs: ['t4.ridge-point'],
    })
  })

  test('a choice task records the option id, not a number', () => {
    const s = play(CHOICE_TASK, [{ type: 'commit', prediction: { choice: 'mem' }, at: 1 }, observe('mem', 'roof.bound'), explain(LINE), { type: 'finish' }])
    expect(s.phase).toBe('done')
    expect(buildOutcome(CHOICE_TASK, s)).toMatchObject({ ok: true, score: 1, data: { predict: { choice: 'mem' }, actual: 'mem' } })
  })

  test('a miss still completes: ok is false, the score is partial, and the task is done', () => {
    const s = play(TASK, [commit(10), observe(295), explain(LINE), { type: 'finish' }])
    expect(s.phase).toBe('done')
    const out = buildOutcome(TASK, s)!
    expect(out.ok).toBe(false)
    expect(out.score).toBe(0) // more than a decade out
    expect(out.data.logErr).toBeCloseTo(-1.47, 2)
    const near = buildOutcome(TASK, play(TASK, [commit(600), observe(295), explain(LINE), { type: 'finish' }]))!
    expect(near.ok).toBe(false)
    expect(near.score).toBeGreaterThan(0.6)
    expect(near.score).toBeLessThan(1)
  })

  test('the explanation is capped at 280 characters, ideas toggle and stay sorted, a retry starts over', () => {
    const long = `${LINE} `.repeat(10)
    const s = play(TASK, [commit(300), observe(295), explain(long)])
    expect(s.explain).toHaveLength(MAX_EXPLAIN_CHARS)
    const ticked = play(TASK, [{ type: 'idea', index: 2 }, { type: 'idea', index: 1 }, { type: 'idea', index: 2 }, { type: 'idea', index: 7 }], s)
    expect(ticked.ideas).toEqual([1])
    const done = play(TASK, [{ type: 'finish' }], ticked)
    expect(done.phase).toBe('done')
    expect(buildOutcome(TASK, done)!.data.explain!.length).toBeLessThanOrEqual(MAX_EXPLAIN_CHARS)
    expect(play(TASK, [{ type: 'retry' }], done)).toEqual(freshRun())
    expect(play(TASK, [{ type: 'retry' }], s)).toBe(s) // only a finished task retries
  })

  test('a legacy task, or an outcome task with no predict, can never produce an outcome', () => {
    const legacy: SimTaskDef = { id: 't-old', simId: 'sim-vm', kind: 'legacy', title: 't', setup: 't', kcs: [] }
    expect(play(legacy, [commit(1), observe(1), explain(LINE), { type: 'finish' }]).phase).toBe('predict')
    const broken: SimTaskDef = { ...TASK, predict: undefined }
    expect(play(broken, [commit(1)]).phase).toBe('predict')
    expect(buildOutcome(legacy, freshRun())).toBeNull()
  })
})

describe('the ledger sees the outcome (completeTask → recordSimOutcome)', () => {
  const finished = (value: number): TaskRun => play(TASK, [commit(value), observe(295), explain(LINE), { type: 'finish' }])

  test('no commit, no event: completeTask refuses and writes nothing', async () => {
    const tab = startTab(makeProfile())
    const record = tab.progress.getState().recordSimOutcome
    expect(completeTask(record, TASK, freshRun())).toBe(false)
    expect(completeTask(record, TASK, play(TASK, [observe(295), explain(LINE)]))).toBe(false)
    await tab.progress.controls.flush()
    expect((await (await tab.engine()).events()).filter((e) => e.kind === 'sim-task')).toEqual([])
    expect(tab.progress.getState().aggregate.sims['sim-roofline']).toBeUndefined()
  })

  test('a finished cycle writes one sim-task event with data.v 2 and completes the task', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    expect(completeTask(getState().recordSimOutcome, TASK, finished(300), { ms: 9_000 })).toBe(true)
    expect(getState().aggregate.sims['sim-roofline'].outcomes).toEqual({ 'roof.ridge': true })
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'sim-task')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ref: 'sim:sim-roofline/roof.ridge', ok: true, score: 1, ms: 9000, data: { v: 2, outcome: true, actual: 295 } })
    expect(events[0].data).toMatchObject({ predict: { value: 300, unit: 'FLOP/B' }, ideas: [], explain: LINE })
  })

  test('a miss is evidence but not an ok outcome; a later hit completes it; further runs are skipped', async () => {
    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    completeTask(getState().recordSimOutcome, TASK, finished(10))
    expect(getState().aggregate.sims['sim-roofline'].outcomes).toEqual({})
    completeTask(getState().recordSimOutcome, TASK, finished(300))
    expect(getState().aggregate.sims['sim-roofline'].outcomes).toEqual({ 'roof.ridge': true })
    completeTask(getState().recordSimOutcome, TASK, finished(10)) // an ok outcome already counts
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'sim-task')
    expect(events.map((e) => e.ok)).toEqual([false, true])
  })

  test('phone mode records the prediction against the canonical outcome with ok false and data.phone', async () => {
    const pred = { value: 300 }
    const phone = buildPhoneOutcome(TASK, pred, 'sure', 295)!
    expect(phone).toMatchObject({ taskId: 'roof.ridge', score: 1, ok: false, conf: 'sure' })
    expect(phone.data).toEqual({ v: 2, outcome: true, predict: { value: 300, unit: 'FLOP/B' }, actual: 295, logErr: 0.0073, phone: true, kcs: ['t4.ridge-point'] })
    expect(buildPhoneOutcome(TASK, { choice: 'mem' }, undefined, 295)).toBeNull() // wrong kind of prediction
    expect(buildPhoneOutcome({ ...TASK, kind: 'legacy' }, pred, undefined, 295)).toBeNull()

    const tab = startTab(makeProfile())
    const { getState } = tab.progress
    getState().recordSimOutcome('sim-roofline', phone)
    // a phone prediction is not completion: the hands-on laptop run still counts, and is not skipped
    expect(getState().aggregate.sims['sim-roofline'].outcomes).toEqual({})
    completeTask(getState().recordSimOutcome, TASK, finished(300))
    expect(getState().aggregate.sims['sim-roofline'].outcomes).toEqual({ 'roof.ridge': true })
    await tab.progress.controls.flush()
    const events = (await (await tab.engine()).events()).filter((e) => e.kind === 'sim-task')
    expect(events.map((e) => [e.ok, (e.data as { phone?: boolean }).phone])).toEqual([[false, true], [true, undefined]])
  })
})

describe('the panel', () => {
  const host = (task: SimTaskDef): SimHostInternal => ({
    simId: task.simId,
    mode: 'embed',
    machine: undefined,
    initialConfig: null,
    writeConfig: () => {},
    selectMachine: () => {},
    observe: () => {},
    bus: createObservationBus(),
    finished: createFinishedStore(),
  })
  const render = (task: SimTaskDef) => {
    const h = host(task)
    return renderToString(createElement(SimHostContext.Provider, { value: h }, createElement(TaskPanel, { task, host: h })))
  }

  test('a fresh numeric task asks for the prediction first: its field and lock button, no explanation, answer or note', () => {
    const html = render(TASK)
    expect(html).toContain('data-phase="predict"')
    expect(html).toContain('Where is the ridge?')
    expect(html).toContain('Lock in my prediction')
    expect(html).toContain('FLOP/B')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain(TASK.explain!.model)
    expect(html).not.toContain('What just happened')
    expect(html).not.toContain(TASK.note!)
    expect(html).not.toContain('Save result')
  })

  test('a choice task renders its options as radios', () => {
    const html = render(CHOICE_TASK)
    expect(html.match(/type="radio"/g)).toHaveLength(2)
    expect(html).toContain('Memory')
    expect(html).toContain('Lock in my prediction')
  })

  test('the "how sure" chips are toggle buttons, not radios', () => {
    const html = render(TASK)
    expect(html).toContain('role="group" aria-label="How sure are you? (optional)"')
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3)
    expect(html).not.toContain('role="radio')
  })

  test('a task note goes through the markdown renderer', () => {
    const html = renderToString(createElement(Note, { text: 'The ridge is `295` FLOP/B.\n\nSecond **paragraph**.' }))
    expect(html).toContain('What just happened')
    expect(html).toContain('<code')
    expect(html).not.toContain('`295`')
    expect(html).not.toContain('**')
  })

  test('an outcome task with no predict or explain renders nothing', () => {
    expect(render({ ...TASK, predict: undefined })).toBe('')
    expect(render({ ...TASK, explain: undefined })).toBe('')
  })

  test('an always-mounted live region exists before any result, and the touch-size classes are on the controls', () => {
    const html = render(TASK)
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*class="sr-only"><\/div>/)
    expect(html).toContain('min-h-6')
    expect(html).toContain('[@media(pointer:coarse)]:min-h-11')
  })
})

describe('phone mode (§10.4, §16.2)', () => {
  test('a fresh phone panel: every control carries the 44 px hit area, and nothing is graded yet', () => {
    const html = renderToString(createElement(PhoneOutcome, { task: TASK }))
    expect(html).toContain('data-phone')
    expect(html).toContain('Lock in and show the outcome')
    expect(html).not.toContain('Queue the hands-on run')
    // the lock button, the three "how sure" chips and the numeric field
    expect(html.match(/min-h-11/g)!.length).toBeGreaterThanOrEqual(4)
    expect(html).not.toContain('min-h-6')
    expect(html).not.toContain('h-9')
    expect(html).not.toContain('role="status"')
  })

  test('a choice task in phone mode makes each radio row 44 px', () => {
    const html = renderToString(createElement(PhoneOutcome, { task: CHOICE_TASK }))
    expect(html.match(/type="radio"/g)).toHaveLength(2)
    expect(html.match(/<label[^>]*min-h-11/g)).toHaveLength(2)
  })

  const outcome = (over: Partial<CanonicalOutcome['chart']> = {}): CanonicalOutcome => ({
    actual: 295,
    unit: 'FLOP/B',
    summary: 'The ridge is 295 FLOP/B.',
    chart: { kind: 'bars', xLabel: 'batch', yLabel: 'FLOP/B', points: [{ x: 1, y: 2 }, { x: 8, y: 16 }, { x: 32, y: 64 }], mark: 2, ...over },
    table: { caption: 'Intensity by batch', columns: ['batch', 'FLOP/B'], rows: [['1', '2'], ['8', '16'], ['32', '64']] },
  })
  const barHeights = (svg: string) => [...svg.matchAll(/<rect [^>]*height="([\d.]+)"/g)].map((m) => Number(m[1]))
  const chart = (o: CanonicalOutcome) => renderToString(createElement(OutcomeChart, { outcome: o }))

  test('the chart is a labelled image with a mark, and an empty series draws nothing', () => {
    const svg = chart(outcome())
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="FLOP/B by batch. The ridge is 295 FLOP/B."')
    expect(svg.match(/fill-accent/g)).toHaveLength(1)
    expect(chart(outcome({ points: [] }))).toBe('')
  })

  test('a log-Y series on one power of ten still has bars with a height, and so does a line', () => {
    const flat = [{ x: 'a', y: 100 }, { x: 'b', y: 100 }]
    for (const heights of [barHeights(chart(outcome({ logY: true, points: flat, mark: 0 })))]) {
      expect(heights).toHaveLength(2)
      for (const h of heights) expect(h).toBeGreaterThan(20)
    }
    const line = chart(outcome({ kind: 'line', logY: true, points: [{ x: 1, y: 1000 }, { x: 2, y: 1000 }], mark: 1 }))
    expect(line).not.toContain('NaN')
    expect(line).not.toContain('Infinity')
  })
})

describe('SimMirror (§10.5)', () => {
  const table = { caption: 'Roofline points', columns: ['batch', 'FLOP/B'], rows: [['1', '2'], ['32', '64']], announce: 'bandwidth-bound' }
  const html = renderToString(createElement(SimMirror, { id: 'mirror-roof', table }))

  test('the table is in the document, visually hidden, and the toggle points at it', () => {
    expect(html).toMatch(/<div id="mirror-roof" class="sr-only"><table/)
    expect(html).toContain('<caption')
    expect(html).toContain('scope="col"')
    expect(html).toContain('scope="row"')
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="mirror-roof"|<button[^>]*aria-controls="mirror-roof"[^>]*aria-expanded="false"/)
    expect(html).toContain('Show data table')
    expect(html).toContain('min-h-6')
  })

  test('a polite, atomic live region is mounted, empty until the first throttled announcement', () => {
    expect(html).toMatch(/<div role="status" aria-live="polite" aria-atomic="true" class="sr-only"><\/div>/)
    expect(html).not.toContain('bandwidth-bound</div>')
  })
})
