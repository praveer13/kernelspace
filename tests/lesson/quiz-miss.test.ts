/**
 * A lesson QuizBlock records the picked lure's misconception id (task EF1, the round-2 review's G4). Before EF1,
 * `recordQuizAttempt` kept the pick but not the lure's `miss` id, which Today's items do carry (`itemResponseOf`), so a
 * QuizBlock retake 30 or more days after the card sat in P3's confusion share (selectDiscrimination30) as a miss that could
 * never be a confusion.
 *
 * Here the real QuizBlock is mounted (tests/dom/mini-dom.ts) on t2.l2's quiz, the learner picks lures, and what it hands
 * the store goes through the real façade (`recordQuizAttempt`) into the selector, own and donated.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import QuizBlock, { type QuizQuestion } from '../../src/components/QuizBlock'
import { ALL_LESSONS } from '../../src/data/lessons'
import { DISCRIMINATION_KCS, discriminationLures, selectDiscrimination30 } from '../../src/lib/learner/outcomes'
import { ledgerOfDonation, redactForPartner } from '../../src/lib/learner/redact'
import type { LedgerEvent, QuizAttempt } from '../../src/lib/ledger/types'
import { useProgress } from '../../src/lib/progress'
import { addDays } from '../../src/lib/learner/reentry'
import { installDom, type DomKit, type MiniElement } from '../dom/mini-dom'
import { makeProfile, startTab } from '../ledger/env'
import { CONTENT, Journal, LESSONS, START } from '../learner/ledger-gen'

let dom: DomKit
beforeAll(async () => {
  dom = await installDom()
})
afterAll(() => dom.uninstall())

const LESSON = 't2.l2'
const QUESTIONS = ALL_LESSONS.find((l) => l.id === LESSON)!.blocks.flatMap((b) => (b.type === 'quiz' ? (b.questions as QuizQuestion[]) : []))

/** The option button of authored option `oi` on question `qi`: options are shuffled, so it is found by its text. */
function optionButton(root: MiniElement, qi: number, oi: number): MiniElement {
  const item = root.querySelectorAll('ol > li')[qi]
  const button = item.querySelectorAll('button').find((b) => b.querySelector('span.flex-1')?.textContent === QUESTIONS[qi].options[oi])
  if (!button) throw new Error(`no button for question ${qi}, option ${oi}`)
  return button
}

/** Mount the quiz, pick `picks[qi]` on each question, submit, and return what the block handed the store. */
async function take(picks: readonly number[]): Promise<QuizAttempt> {
  const attempts: QuizAttempt[] = []
  useProgress.setState({ recordQuizAttempt: (a: QuizAttempt) => void attempts.push(a) })
  const m = await dom.mount(createElement(QuizBlock, { lessonId: LESSON, questions: QUESTIONS }))
  for (const [qi, oi] of picks.entries()) await dom.press(optionButton(m.container, qi, oi))
  await dom.press(m.container.querySelector('[data-quiz-submit]')!)
  await m.unmount()
  expect(attempts).toHaveLength(1)
  return attempts[0]
}

const saved = useProgress.getState().recordQuizAttempt
afterEach(() => useProgress.setState({ recordQuizAttempt: saved }))

/** The first lure of a question whose miss id passes `test`. */
const lureOf = (qi: number, test: (miss: string) => boolean): number => (QUESTIONS[qi].miss ?? []).findIndex((m, oi) => !QUESTIONS[qi].correct.includes(oi) && test(m))

describe('QuizBlock hands the store the picked lure\'s misconception id', () => {
  test('t2.l2 holds what the test needs: a confuse lure on question 4 and a named Wave 1 lure on question 0', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(5)
    expect(QUESTIONS[4].kcs).toContain('t2.address-translation')
    expect(lureOf(4, (m) => m.startsWith('confuse.'))).toBeGreaterThanOrEqual(0)
    expect(lureOf(0, (m) => m !== '' && !m.startsWith('confuse.'))).toBeGreaterThanOrEqual(0)
  })

  test('a miss carries its lure\'s id, a right answer and a lure with no named slip carry none', async () => {
    const confuse = lureOf(4, (m) => m.startsWith('confuse.'))
    const named = lureOf(0, (m) => m !== '' && !m.startsWith('confuse.'))
    const picks = QUESTIONS.map((q, qi) => (qi === 4 ? confuse : qi === 0 ? named : q.correct[0]))
    const attempt = await take(picks)
    expect(attempt.responses.map((r) => [r.qi, r.ok, r.miss])).toEqual(
      QUESTIONS.map((q, qi) => (qi === 4 ? [4, false, q.miss![confuse]] : qi === 0 ? [0, false, q.miss![named]] : [qi, true, undefined])),
    )
    expect(attempt.responses[4].pick).toEqual([confuse])
  })
})

describe('the real recorders: the miss reaches the confusion share, own and donated', () => {
  /** A learner whose t2.address-translation card was made on day 0 and who retakes t2.l2's quiz on day 60 through the façade. */
  async function learner(attempt: QuizAttempt): Promise<{ events: LedgerEvent[] }> {
    const j = new Journal()
    const lesson = LESSONS.find((l) => l.kcs.includes(DISCRIMINATION_KCS[0]))!
    j.passLesson(START, lesson.id, lesson.kcs)
    const tab = startTab(makeProfile({ ms: Date.parse(`${addDays(START, 60)}T12:00:00.000Z`) }))
    tab.progress.getState().recordQuizAttempt(attempt)
    await tab.progress.controls.flush()
    return { events: [...j.events, ...((await (await tab.engine()).events()) as LedgerEvent[])] }
  }

  test('ten retakes that pick question 4\'s confuse lure are ten confusions of ten misses', async () => {
    const confuse = lureOf(4, (m) => m.startsWith('confuse.'))
    const attempt = await take(QUESTIONS.map((q, qi) => (qi === 4 ? confuse : q.correct[0])))
    const l = await learner(attempt)
    const item = l.events.find((e) => e.ref === `quiz:${LESSON}#4`)!
    expect(item.data).toMatchObject({ src: 'quiz', miss: QUESTIONS[4].miss![confuse], slot: 4, of: QUESTIONS.length })
    const lures = discriminationLures(ALL_LESSONS)
    for (const ledger of [l, ledgerOfDonation(redactForPartner({ events: l.events, working: [] }))]) {
      const r = selectDiscrimination30(Array.from({ length: 10 }, () => ledger), CONTENT, { lures })
      expect([r.misses, r.unattributed, r.confusionStatus, r.confusion.correct]).toEqual([10, 0, 'ok', 10])
    }
  })
})
