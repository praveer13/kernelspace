import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import Feedback from '../../src/components/items/Feedback'
import { ALL_LESSONS } from '../../src/data/lessons'
import { R_ANCHORS } from '../../src/data/placement/anchors'
import { explanationRepeatsWhy, explanationToPrint, gradeItem, playView, sentenceRepeatsWhy, type PlayView } from '../../src/lib/items/play'
import type { Grade, PlayableItem } from '../../src/lib/items/types'

const KEY_WHY = 'Right: the tightest hole is found by size, so the structure decides the cost of the search.'

function question(explanation: string): QuizQuestion {
  return {
    q: 'Which free list structure makes best fit slow?',
    options: ['A sorted list by address', 'A list ordered by size', 'A bitmap of blocks', 'A single bump pointer'],
    correct: [1],
    why: ['Address order says nothing about which hole is tightest.', KEY_WHY, 'A bitmap finds a run, not the tightest one.', 'A bump pointer has no free list at all.'],
    explanation,
    kcs: ['t1.placement-policy'],
  }
}

function render(item: PlayableItem): { html: string; view: PlayView; grade: Grade } {
  const view = playView(item, 0)
  if (view.kind !== 'choice') throw new Error('choice only')
  const picks = view.correct
  const grade = gradeItem(item, { kind: 'choice', picks: [...picks] }, 0)
  const html = renderToStaticMarkup(
    createElement(Feedback, { view, grade, picks, stepsOpen: false, onToggleSteps: () => {}, toggleRef: { current: null }, idBase: 'x' }),
  )
  return { html, view, grade }
}

const quiz = (q: QuizQuestion): PlayableItem => ({ source: 'quiz', lessonId: 't1.l4', qi: 0, q, kcs: q.kcs ?? [] })
const text = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const count = (html: string, s: string) => text(html).split(s).length - 1

describe('Feedback prints the explanation once under Correct.', () => {
  test('an explanation equal to the key why minus its label prints once', () => {
    const e = KEY_WHY.replace('Right: ', '')
    const { html } = render(quiz(question(e)))
    expect(html).toContain('Correct.')
    expect(count(html, e)).toBe(1)
  })

  test('an explanation that only rearranges the key why prints once', () => {
    const e = 'Because the tightest hole is found by size, the structure decides the cost of the search.'
    expect(count(render(quiz(question(e))).html, 'decides the cost of the search')).toBe(1)
  })

  test('a different explanation prints with the why', () => {
    const e = 'Java analogue: a TreeMap keyed by size answers ceiling lookups in logarithmic time, where a list scans.'
    const { html } = render(quiz(question(e)))
    expect(count(html, 'the structure decides the cost')).toBe(1)
    expect(count(html, 'TreeMap keyed by size')).toBe(1)
  })

  test('an explanation that holds the why and goes on prints the rest once, not the sentence the why already has', () => {
    const e = 'The tightest hole is found by size, so the structure decides the cost of the search. A TreeMap keyed by size answers it in logarithmic time.'
    const { html } = render(quiz(question(e)))
    expect(count(html, 'the structure decides the cost of the search')).toBe(1)
    expect(count(html, 'A TreeMap keyed by size')).toBe(1)
  })

  test('an explanation that brings a number the why lacks still prints', () => {
    const e = 'The tightest hole is found by size, so the structure decides the cost of the search: 2048 holes take 2048 probes.'
    expect(render(quiz(question(e))).html).toContain('2048 probes')
  })

  test('an item without a why per option prints its explanation', () => {
    const q = question('Best fit needs the smallest hole that fits.')
    delete q.why
    expect(render(quiz(q)).html).toContain('Best fit needs the smallest hole that fits.')
  })

  test('the row-vs-column pair, which share only their first 54 characters, is one sentence', () => {
    expect(
      explanationRepeatsWhy(
        'double[][] is an array of references to row objects. Column access hops between row objects that may live anywhere on the heap — the pointer-chasing tax stacked on top of the stride tax.',
        'Right: double[][] is an array of references to row objects. A column walk hops between rows that may sit anywhere on the heap: the pointer-chasing tax stacked on top of the stride tax.',
      ),
    ).toBe(true)
  })
})

/** Every authored question that carries a why per option and an explanation. */
function authored(): { ref: string; item: PlayableItem }[] {
  const out: { ref: string; item: PlayableItem }[] = []
  for (const l of ALL_LESSONS) {
    let qi = 0
    for (const b of l.blocks) {
      if (b.type !== 'quiz') continue
      for (const q of b.questions) out.push({ ref: `${l.id}#${qi}`, item: { source: 'quiz', lessonId: l.id, qi: qi++, q, kcs: q.kcs ?? [] } })
    }
  }
  for (const a of R_ANCHORS) out.push({ ref: a.id, item: { source: 'item', item: a } })
  return out.filter(({ item }) => {
    const q = item.source === 'quiz' ? item.q : item.source === 'item' ? item.item.q : null
    return !!q?.explanation && q.why?.length === q.options.length
  })
}

/** Sentences of 40 normalised characters or more, to find one printed under two labels. */
const sentences = (t: string) =>
  t
    .replace(/^\s*(right|correct)\s*:\s*/i, '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
    .filter((s) => s.length >= 40)

describe('no authored question prints the same sentence twice', () => {
  const all = authored()
  const at = (ref: string) => {
    const found = all.find((a) => a.ref === ref)
    if (!found) throw new Error(`no authored question ${ref}`)
    return render(found.item)
  }
  test('the pool is the authored questions that carry both a why per option and an explanation', () => {
    expect(all.length).toBeGreaterThan(250)
  })
  test('the explanation is left out when it repeats the key why, and no sentence of it then appears twice', () => {
    const twice: string[] = []
    for (const { ref, item } of all) {
      const { html, view } = render(item)
      if (view.kind !== 'choice' || !view.explanation) continue
      const key = view.options.filter((o) => view.correct.includes(o.id)).map((o) => o.why)
      const printedExplanation = count(html, view.explanation) > 0
      if (!printedExplanation) continue
      const keySentences = new Set(key.flatMap(sentences))
      if (sentences(view.explanation).some((s) => keySentences.has(s))) twice.push(ref)
    }
    expect(twice).toEqual([])
  })
  test('no printed sentence of an explanation is a near-copy of the key why (the measure the page cuts by)', () => {
    const near: string[] = []
    for (const { ref, item } of all) {
      const { html, view } = render(item)
      if (view.kind !== 'choice' || !view.explanation) continue
      const key = view.options.filter((o) => view.correct.includes(o.id) && o.why !== '').map((o) => o.why)
      for (const s of view.explanation.split(/(?<=[.!?])\s+/)) {
        // printed as the explanation: on the page more often than the whys themselves hold it
        const inWhys = key.reduce((n, why) => n + why.split(s).length - 1, 0)
        if (count(html, s) > inWhys && key.some((why) => sentenceRepeatsWhy(s, why))) near.push(`${ref}: ${s}`)
      }
    }
    expect(near).toEqual([])
  })
  test('a near-copy with a word or two more is cut: t5.l8#3 reads "Engines gate speculation" once', () => {
    const { html } = at('t5.l8#3')
    expect(count(html, 'Engines gate speculation on occupancy')).toBe(1)
    expect(text(html)).not.toContain('for exactly this reason')
  })
  test('an explanation that adds something the key why lacks still prints it (t3.l1#2, t5.l10#0, t0.l2#0)', () => {
    expect(text(at('t3.l1#2').html)).toContain('and cycles still leak')
    expect(text(at('t5.l10#0').html)).toContain('beats hash-map sharing')
    expect(text(at('t0.l2#0').html)).toContain('about two orders of magnitude')
  })
  test('the number of questions whose explanation the page now leaves out', () => {
    const dropped = all.filter(({ item }) => {
      const { html, view } = render(item)
      return view.kind === 'choice' && !!view.explanation && count(html, view.explanation) === 0
    })
    const cut = all.filter(({ item }) => {
      const { html, view } = render(item)
      return view.kind === 'choice' && !!view.explanation && count(html, view.explanation) === 0 && explanationToPrint(view) !== null
    })
    console.log(`feedback-dedupe: of ${all.length} authored questions, ${dropped.length} no longer print their explanation (${dropped.length - cut.length} left out whole, ${cut.length} cut to what the key why lacks)`)
    expect(dropped.length).toBeGreaterThan(0)
  })
})
