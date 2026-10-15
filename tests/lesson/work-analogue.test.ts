/**
 * P3's work analogues by background (docs/specs/wave-3.md §11.3; task 3c-05): the four authored work pairs sit on the
 * pairs whose LLM side they share, a panel shows one only for a matching `profile:background`, the pick that writes the
 * key is offered on /me, and the work row is never graded, so two ledgers that differ only in the background donate
 * the same bytes (§11.1). The panel's own mechanics (keyboard, feedback, the event) are tests/lesson/isomorphism.test.ts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { IsomorphismView } from '../../src/components/lesson/Isomorphism'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { IsomorphismBlock, Lesson } from '../../src/data/lessons/types'
import { backgroundOf } from '../../src/lib/learner/background'
import { alignResponse, alignRows, breakRef, gradeAlign, isActive, isoNumber, workApplies } from '../../src/lib/learner/iso'
import { redactForPartner } from '../../src/lib/learner/redact'
import { validateEvent, validateWorkingRecord } from '../../src/lib/ledger/codec'
import { BACKGROUNDS } from '../../src/lib/ledger/constants'
import type { Background, ItemResponse, LedgerEvent, WorkingRecord } from '../../src/lib/ledger/types'
import { useProgress } from '../../src/lib/progress'
import BackgroundPick from '../../src/pages/me/Background'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

/** The four pairs of §11.3's table: lesson, the LLM label the work row shares, the work concept, backgrounds. */
const TABLE: { lesson: string; llm: string; os: string; backgrounds: Background[]; breakHas: string[] }[] = [
  { lesson: 't2.l7', llm: 'KV block', os: 'connection pool', backgrounds: ['backend', 'jvm'], breakHas: ['returns to the pool whole', 'reference count'] },
  { lesson: 't1.l3', llm: 'fixed 16-token blocks', os: 'G1 regions', backgrounds: ['jvm'], breakHas: ['evacuates', 'never moves'] },
  { lesson: 't2.l4', llm: 'waiting → running queue', os: 'backpressure', backgrounds: ['sre', 'backend'], breakHas: ['slows the producer', 'decode keeps running'] },
  { lesson: 't5.l6', llm: 'token-prefix key', os: 'CDN entry with a TTL', backgrounds: ['sre', 'backend'], breakHas: ['go stale', 'never be wrong', 're-prefill'] },
]

const lessonOf = (id: string): Lesson => ALL_LESSONS.find((l) => l.id === id)!
const blockWithWork = (id: string): IsomorphismBlock & { breakItem: NonNullable<IsomorphismBlock['breakItem']> } => {
  const b = lessonOf(id).blocks.find((x): x is IsomorphismBlock => x.type === 'isomorphism' && x.pairs.some((p) => p.work))!
  expect(isActive(b)).toBe(true)
  return b as never
}

describe('the four work pairs of §11.3', () => {
  test('they are the only work pairs in the course, each on the pair whose LLM side it shares', () => {
    const found = ALL_LESSONS.flatMap((l) =>
      l.blocks.flatMap((b) => (b.type === 'isomorphism' ? b.pairs.filter((p) => p.work).map((p) => ({ lesson: l.id, llm: p.llm, os: p.work!.os, backgrounds: [...p.work!.backgrounds].sort() })) : [])),
    )
    const want = TABLE.map((t) => ({ lesson: t.lesson, llm: t.llm, os: t.os, backgrounds: [...t.backgrounds].sort() }))
    const key = (x: { lesson: string }) => x.lesson
    expect(found.sort((a, b) => key(a).localeCompare(key(b)))).toEqual(want.sort((a, b) => key(a).localeCompare(key(b))))
  })

  test.each(TABLE)('$lesson: $os has a line, its own break (the table\'s) and a block that asks the break question', (t) => {
    const b = blockWithWork(t.lesson)
    const pair = b.pairs.find((p) => p.work)!
    const w = pair.work!
    expect(pair.llm).toBe(t.llm)
    expect(w.osLine.length).toBeGreaterThan(20)
    for (const needle of t.breakHas) expect(w.breaks).toContain(needle)
    expect(w.breaks).not.toBe(pair.breaks)
    // one work pair per block, so a work row never adds a second row to the same label
    expect(b.pairs.filter((p) => p.work)).toHaveLength(1)
  })

  test('the lessons keep their base pairs: the work pair adds nothing to a block\'s pairs', () => {
    expect(blockWithWork('t2.l4').pairs).toHaveLength(4)
    expect(blockWithWork('t2.l7').pairs).toHaveLength(4)
    expect(blockWithWork('t1.l3').pairs).toHaveLength(3)
    expect(blockWithWork('t5.l6').pairs).toHaveLength(3)
  })
})

describe('which background sees which row', () => {
  test.each(TABLE)('$lesson: a work row exactly for $backgrounds, right after its pair and with the pair\'s label as the answer', (t) => {
    const b = blockWithWork(t.lesson)
    const base = alignRows(b, null)
    expect(base.some((r) => r.work)).toBe(false)
    for (const bg of BACKGROUNDS) {
      const rows = alignRows(b, bg)
      const work = rows.filter((r) => r.work)
      if (!t.backgrounds.includes(bg)) {
        expect(work).toHaveLength(0)
        expect(rows).toEqual(base)
        continue
      }
      expect(work).toHaveLength(1)
      expect(work[0]).toMatchObject({ os: t.os, llm: t.llm })
      expect(rows.filter((r) => !r.work)).toEqual(base)
      const at = rows.indexOf(work[0])
      expect(rows[at - 1].llm).toBe(t.llm)
      expect(rows[at - 1].work).toBe(false)
    }
  })

  test('no pick, and a stored value that is not one of the six, show nothing', () => {
    for (const v of [undefined, null, '', 'Java', 'rust', 7]) {
      const bg = backgroundOf(v)
      expect(bg).toBeNull()
      for (const t of TABLE) expect(workApplies(blockWithWork(t.lesson).pairs.find((p) => p.work)!, bg)).toBe(false)
    }
  })

  test('ml, student and other see no work row on any panel', () => {
    for (const bg of ['ml', 'student', 'other'] as const) for (const t of TABLE) expect(alignRows(blockWithWork(t.lesson), bg).some((r) => r.work)).toBe(false)
  })
})

describe('the real panel (t2.l4)', () => {
  const saved = useProgress.getState().recordItems
  const savedWorking = useProgress.getState().working
  let events: ItemResponse[]
  beforeEach(() => {
    events = []
    useProgress.setState({ recordItems: (items: ItemResponse[]) => void events.push(...items) })
  })
  afterEach(() => useProgress.setState({ recordItems: saved, working: savedWorking }))

  const rowsOf = (root: MiniElement) => root.querySelectorAll('[data-row]')
  const osOf = (row: MiniElement) => row.querySelector('[role="group"] > div')!.textContent.replace(' pairs with which LLM idea?', '').replace(/^at work/, '').trim()
  const labelButton = (row: MiniElement, label: string) => row.querySelectorAll('[data-ks-label]').find((b) => b.textContent.trim().startsWith(label))!

  test('a matching background shows the work row; another one, or none, shows the four base rows only', async () => {
    const lesson = lessonOf('t2.l4')
    const b = blockWithWork('t2.l4')
    const shown = async (bg: string | undefined) => {
      useProgress.setState({ working: { ...(bg ? { 'profile:background': bg } : {}) } as never })
      const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson }))
      const rows = rowsOf(m.container).map(osOf)
      await m.unmount()
      return rows
    }
    const base = b.pairs.map((p) => p.os)
    expect(await shown(undefined)).toEqual(base)
    expect(await shown('jvm')).toEqual(base)
    expect(await shown('ml')).toEqual(base)
    for (const bg of ['sre', 'backend']) expect(await shown(bg)).toEqual([...base.slice(0, 2), 'backpressure', ...base.slice(2)])
  })

  test('the work row gets its feedback, "not scored", and no mark on the event', async () => {
    const lesson = lessonOf('t2.l4')
    const b = blockWithWork('t2.l4')
    useProgress.setState({ working: { 'profile:background': 'sre' } as never })
    const m = await dom.mount(createElement(IsomorphismView, { block: b, lesson }))
    const right: Record<string, string> = Object.fromEntries(b.pairs.map((p) => [p.os, p.llm]))
    // the work row is answered wrongly on purpose: its label is the 'time slice' one, not its own
    right.backpressure = b.pairs[0].llm
    for (const row of rowsOf(m.container)) await dom.press(labelButton(row, right[osOf(row)]))
    await dom.press(m.container.querySelectorAll('button').find((x) => x.textContent.trim().startsWith('Check'))!)
    const work = rowsOf(m.container).find((r) => osOf(r) === 'backpressure')!
    expect(work.querySelector('[data-verdict]')!.getAttribute('data-verdict')).toBe('wrong')
    expect(work.textContent).toContain('not scored')
    expect(work.textContent).toContain(b.pairs[1].work!.osLine)
    expect(work.textContent).toContain(b.pairs[1].llmLine)
    expect(m.container.querySelector('[data-align-status]')!.textContent).toBe('All 4 matched.')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ref: 'item:t2.l4.iso.1', ok: true, score: 1 })
    await m.unmount()
  })
})

describe('the pick', () => {
  const savedSet = useProgress.getState().setWorking
  const savedClear = useProgress.getState().clearWorking
  const savedWorking = useProgress.getState().working
  let writes: [string, unknown][]
  let clears: string[]
  beforeEach(() => {
    writes = []
    clears = []
    useProgress.setState({
      working: {} as never,
      setWorking: ((k: string, v: unknown) => void writes.push([k, v])) as never,
      clearWorking: ((k: string) => void clears.push(k)) as never,
    })
  })
  afterEach(() => useProgress.setState({ setWorking: savedSet, clearWorking: savedClear, working: savedWorking }))

  test('/me offers the six values, none chosen until one is, and a click writes profile:background', async () => {
    const m = await dom.mount(createElement(BackgroundPick))
    const radios = m.container.querySelectorAll('input[type="radio"]')
    expect(radios).toHaveLength(BACKGROUNDS.length)
    expect(radios.some((r) => r.checked)).toBe(false)
    expect(m.container.textContent).toContain('Optional')
    expect(writes).toEqual([])
    await dom.press(radios[2])
    expect(writes).toEqual([['profile:background', BACKGROUNDS[2]]])
    await m.unmount()
  })

  test('"Clear my pick" shows only with a pick, deletes the record on the click, and leaves focus in the group', async () => {
    const m = await dom.mount(createElement(BackgroundPick))
    const clearButton = () => m.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Clear my pick')
    expect(clearButton()).toBeUndefined() // nothing to clear yet
    await m.unmount()

    useProgress.setState({ working: { 'profile:background': 'student' } as never })
    const saved = await dom.mount(createElement(BackgroundPick))
    const button = saved.container.querySelectorAll('button').find((b) => b.textContent.trim() === 'Clear my pick')!
    expect(button.getAttribute('type')).toBe('button')
    expect(button.tabIndex).toBe(0) // a native button: Tab, Enter and Space reach it
    expect(clears).toEqual([])
    await dom.press(button)
    expect(clears).toEqual(['profile:background'])
    expect(writes).toEqual([]) // a delete, not a write of some value
    expect(dom.document.activeElement.getAttribute('type')).toBe('radio')
    await saved.unmount()
  })

  test('the copy says the pick stays on your devices and in your own exports, and never goes in a donation', async () => {
    const m = await dom.mount(createElement(BackgroundPick))
    const text = m.container.textContent.replace(/\s+/g, ' ')
    expect(text).toContain('It stays on your devices: in this browser and in the progress files you export yourself. It is never part of a donation.')
    expect(text).not.toContain('stays in this browser')
    await m.unmount()
  })

  test('a saved background is the one shown chosen', async () => {
    useProgress.setState({ working: { 'profile:background': 'ml' } as never })
    const m = await dom.mount(createElement(BackgroundPick))
    const radios = m.container.querySelectorAll('input[type="radio"]')
    expect(radios.map((r) => r.checked)).toEqual(BACKGROUNDS.map((b) => b === 'ml'))
    await m.unmount()
  })

  test('the codec takes each of the six as a working record and refuses anything else', () => {
    const rec = (value: unknown) => validateWorkingRecord({ key: 'profile:background', value, at: '2026-10-14T12:00:00.000Z', dev: 'd1' })
    for (const b of BACKGROUNDS) expect(rec(b).ok).toBe(true)
    for (const v of ['rust', '', null, 3]) expect(rec(v).ok).toBe(false)
  })
})

describe('a donation never reveals the background (§11.1, §3.5)', () => {
  const AT = '2026-10-14T12:00:00.000Z'
  const DAY = '2026-10-14'

  /** A ledger as the panel writes it: the align event and the break event for each work panel, then the week plan. */
  function ledger(bg: Background | null, workPicks: boolean): { events: LedgerEvent[]; working: WorkingRecord[] } {
    const events: LedgerEvent[] = []
    let n = 0
    for (const t of TABLE) {
      const lesson = lessonOf(t.lesson)
      const b = blockWithWork(t.lesson)
      const num = isoNumber(lesson, b)
      const rows = alignRows(b, bg)
      // the same answers on every base row (all right but the first); the work row, when there is one, is right or wrong by `workPicks`
      const picks: Record<string, string> = {}
      for (const r of rows) picks[r.id] = r.work ? (workPicks ? r.llm : b.pairs.find((p) => p.llm !== r.llm)!.llm) : r.id === 'p0' ? b.pairs[1].llm : r.llm
      const e = alignResponse(lesson.id, num, b, lesson.kcs, gradeAlign(rows, picks), { seed: 123456, ms: 4321 })
      const brk = { kind: 'item', ref: breakRef(lesson.id, num), rev: 'r1', score: 1, ok: true, seed: 99, ms: 8000, data: { src: 'lesson', pick: [0], lessonId: lesson.id, kcs: [...(b.kcs ?? lesson.kcs)].slice(0, 6), nsec: 30 } }
      for (const r of [e, brk]) {
        const ev = { id: `e${n++}`, v: 1, ...r, at: AT, tz: 0, day: DAY, dev: 'd1', provenance: 'practice' }
        const checked = validateEvent(ev)
        expect(checked.ok ? '' : checked.error).toBe('')
        events.push(ev as unknown as LedgerEvent)
      }
    }
    const working: WorkingRecord[] = [{ key: 'boot:week', value: { minutesPerWeek: 180, sessionMinutes: 25, phoneDays: [], laptopDays: [], slo: 0.9 }, at: AT, dev: 'd1' } as WorkingRecord]
    if (bg) working.push({ key: 'profile:background', value: bg, at: AT, dev: 'd1' })
    return { events, working }
  }

  test('two ledgers that differ only in profile:background, with the same base answers, give identical redacted donations', () => {
    const plain = ledger(null, false)
    const donation = JSON.stringify(redactForPartner(plain))
    for (const bg of BACKGROUNDS) {
      // whether the work row is answered right or wrong changes nothing either
      for (const workPicks of [true, false]) {
        const l = ledger(bg, workPicks)
        expect(l.working.length).toBe(plain.working.length + 1)
        expect(l.events).toEqual(plain.events)
        expect(JSON.stringify(redactForPartner(l))).toBe(donation)
      }
    }
  })

  test('the donation holds the align scores and none of the background or the work concepts', () => {
    const text = JSON.stringify(redactForPartner(ledger('jvm', true)))
    for (const t of TABLE) {
      expect(text).toContain(`item:${t.lesson}.iso.1`)
      expect(text).not.toContain(t.os)
    }
    expect(text).not.toContain('profile:background')
    for (const b of BACKGROUNDS) expect(text).not.toContain(`"${b}"`)
    // each align event scores k of the base rows, never of the base rows plus the work row
    const events = redactForPartner(ledger('jvm', true)).events.filter((e) => /\.iso\.\d+$/.test(e.ref))
    expect(events).toHaveLength(TABLE.length)
    for (const e of events) {
      const t = TABLE.find((x) => e.ref.includes(`item:${x.lesson}.`))!
      const base = blockWithWork(t.lesson).pairs.length
      expect(e.ok).toBe(false)
      expect(e.score).toBeCloseTo((base - 1) / base, 10)
    }
  })

  test('the control: the donation does change when a base answer does', () => {
    const a = JSON.stringify(redactForPartner(ledger('jvm', true)))
    const l = ledger('jvm', true)
    const first = l.events[0] as unknown as { score: number }
    first.score = 0.5
    expect(JSON.stringify(redactForPartner(l))).not.toBe(a)
  })
})
