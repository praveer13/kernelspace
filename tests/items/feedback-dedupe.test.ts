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

  test('a formula with an operand the why lacks adds something, unless the why states a formula itself (K0-CLOSE-E)', () => {
    const why = 'Right: only k of N experts run per token. Decode is bandwidth-bound, so tokens/s rises while capacity stays large.'
    // BW and bytes are not in the why, and are too short or too plain for the content-word measure to weigh
    expect(sentenceRepeatsWhy('Decode is bandwidth-bound (T4): tokens/s ≈ BW ÷ bytes-per-token.', why)).toBe(false)
    expect(sentenceRepeatsWhy('Decode is bandwidth-bound (T4): tokens/s rises.', why)).toBe(true)
    // every operand named by the why: nothing new
    expect(sentenceRepeatsWhy('Decode is bandwidth-bound: tokens ≈ k × N per token.', why)).toBe(true)
    // the why has its own formula: the restated one is a near-copy
    expect(sentenceRepeatsWhy('Decode is bandwidth-bound: tokens/s ≈ BW ÷ bytes/token.', 'Right: tokens/s ≈ bandwidth ÷ bytes per token, so decode is bandwidth-bound.')).toBe(true)
  })

  test('a lesson reference (T2.L4, T4) is not a number, and a cache level (L2) still is', () => {
    const why = 'Right: the slow sibling holds the batch, the FIFO convoy with HBM as the held resource.'
    expect(sentenceRepeatsWhy('It is the FIFO convoy from T2.L4 with HBM as the held resource.', why)).toBe(true)
    expect(sentenceRepeatsWhy('It is the FIFO convoy (T2) with HBM as the held resource.', why)).toBe(true)
    expect(sentenceRepeatsWhy('The line already sits in L2, so both orders hit cache.', 'Right: the line already sits in L1, so both orders hit cache.')).toBe(false)
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
  test('a long near-copy with fewer than a quarter of its content words new is cut (t0.l4#3, t7.l3#1, t0.l6#3)', () => {
    expect(text(at('t0.l4#3').html)).not.toContain('Layout must match the access pattern')
    expect(text(at('t7.l3#1').html)).not.toContain('The frontier shifts only when the physics change')
    expect(text(at('t0.l6#3').html)).not.toContain('Three wide wait bars + one absent')
  })
  test('a lesson reference is not a new number: t5.l7#0 and t6.l5#1 are cut', () => {
    expect(text(at('t5.l7#0').html)).not.toContain('the FIFO convoy from T2.L4')
    expect(text(at('t6.l5#1').html)).not.toContain('T6.L4: only')
  })
  test('a formula the key why lacks prints: t6.l1#0 keeps "tokens/s ≈ BW ÷ bytes-per-token" once (K0-CLOSE-E)', () => {
    const html = text(at('t6.l1#0').html)
    expect(count(html, 'Decode is bandwidth-bound (T4): tokens/s ≈ BW ÷ bytes-per-token.')).toBe(1)
    // a why that states the formula itself still cuts the restated one (t6.l5#3), and "=" read as "means" is no formula (t0.l6#3)
    expect(text(at('t6.l5#3').html)).not.toContain('tokens/s ≈ BW ÷ bytes/token')
    expect(text(at('t0.l6#3').html)).not.toContain('Three wide wait bars + one absent')
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

/**
 * An independent lint (K0-CLOSE-E): a printed sentence of an explanation that shares a run of VERBATIM_RUN words, word
 * for word, with the key why. sentenceRepeatsWhy judges a whole sentence by its count of new words, so a copied clause
 * inside a longer sentence that adds a little ("GC pauses", "zero spatial locality") prints, and the learner reads the
 * clause twice. The fix is at the source: reword the explanation sentence in its lesson so it says only what the why
 * lacks (editing an explanation keeps saved answers), then take its question off the list below.
 */
const VERBATIM_RUN = 8
/** The questions that print such a sentence on the branch today. This list may only shrink. */
const VERBATIM_ALLOWED = [
  't0.l1#1',
  't0.l1#2',
  't0.l3#0',
  't0.l3#1',
  't2.l7#2',
  't3.l1#3',
  't5.l8#1',
  't5.l8#2',
  't5.l10#2',
  't6.l3#3',
  't7.l2#0',
  't7.l4#0',
  't7.l5#4',
  't7.l5#5',
]
/**
 * Two more print a paraphrase of the key why that neither measure can see (synonyms, not shared runs). Each entry is
 * the start of the printed sentence; when the sentence is reworded, the entry goes.
 */
const PARAPHRASE_KNOWN: Record<string, string> = {
  't5.l6#1': 'Evict an eligible leaf, drop its references',
  't5.l8#0': 'The speedup is a roofline conversion',
}
/** Today's count: 14 with a verbatim run and 2 paraphrases. */
const KNOWN_MAX = 16

const runWords = (t: string) =>
  t
    .replace(/^\s*(right|correct)\s*:\s*/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '')

/** True when `sentence` shares a run of `n` words, in order, with `why`. */
function sharesRun(sentence: string, why: string, n: number): boolean {
  const s = runWords(sentence)
  const w = ` ${runWords(why).join(' ')} `
  for (let i = 0; i + n <= s.length; i++) if (w.includes(` ${s.slice(i, i + n).join(' ')} `)) return true
  return false
}

describe(`no printed explanation sentence copies a ${VERBATIM_RUN}-word run of the key why (K0-CLOSE-E)`, () => {
  const all = authored()
  test('the run measure finds a copied clause inside a longer sentence, and not a sentence that only shares words', () => {
    const why = 'Right: the weight read dominates the step and happens once, so scoring k positions is nearly free.'
    expect(sharesRun('The weight read dominates the step and happens once regardless; the rest is compute.', why, VERBATIM_RUN)).toBe(true)
    expect(sharesRun('Once per step, the weight read dominates: scoring is nearly free.', why, VERBATIM_RUN)).toBe(false)
  })
  test('only the listed questions print a sentence that copies a run of the key why, and every listed one still does', () => {
    const found: string[] = []
    for (const { ref, item } of all) {
      const { html, view } = render(item)
      if (view.kind !== 'choice') continue
      const printed = explanationToPrint(view)
      if (!printed) continue
      const key = view.options.filter((o) => view.correct.includes(o.id) && o.why !== '').map((o) => o.why)
      const sentencesPrinted = printed.split(/(?<=[.!?])\s+/).filter((s) => count(html, s) > 0)
      if (sentencesPrinted.some((s) => key.some((why) => sharesRun(s, why, VERBATIM_RUN)))) found.push(ref)
    }
    // a new copy fails here; a reworded one fails too until its ref leaves the list, so the list only shrinks
    expect(found.sort()).toEqual([...VERBATIM_ALLOWED].sort())
  })
  test('each known paraphrase still prints, so a reworded one leaves the list', () => {
    for (const [ref, start] of Object.entries(PARAPHRASE_KNOWN)) {
      const found = all.find((a) => a.ref === ref)
      expect(found).toBeDefined()
      if (found) expect(text(render(found.item).html)).toContain(start)
    }
  })
  test(`the two lists hold at most today's ${KNOWN_MAX} questions`, () => {
    expect(VERBATIM_ALLOWED.length + Object.keys(PARAPHRASE_KNOWN).length).toBeLessThanOrEqual(KNOWN_MAX)
  })
})
