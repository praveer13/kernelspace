import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ConstructedAnswer from '../../src/components/items/ConstructedAnswer'
import ItemCard from '../../src/components/items/ItemCard'
import { getClaim } from '../../src/data/claims'
import {
  confidenceForKey,
  defaultSeed,
  emptyDraft,
  gradeItem,
  hasAnswer,
  kcsFor,
  keyAction,
  optionIndexForKey,
  parseNumber,
  playView,
  refFor,
  responseFor,
  resultFor,
  revFor,
  togglePick,
  type CrResponse,
  type Draft,
  type KeyAction,
  type KeyInput,
  type KeyState,
} from '../../src/lib/items/play'
import type { AuthoredItem, ConstructedPrompt, Instance, PlayableItem } from '../../src/lib/items/types'
import { rev32 } from '../../src/lib/ledger/stable'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import demo from './fixture-family'

const Q: QuizQuestion = {
  q: 'Which free list structure makes best fit slow?',
  options: ['A sorted list by address', 'A list ordered by size', 'A bitmap of blocks', 'A single bump pointer'],
  correct: [1],
  why: ['Address order says nothing about which hole is tightest.', 'Right: the tightest hole is found by size, so the structure decides the cost.', 'A bitmap finds a run, not the tightest one.', 'A bump pointer has no free list at all.'],
  explanation: 'Best fit needs the smallest hole that fits.',
  kcs: ['t1.placement-policy'],
}
const MULTI: QuizQuestion = { q: 'Pick both.', options: ['one', 'two', 'three'], correct: [0, 2], multi: true }
const CR: ConstructedPrompt = {
  prompt: 'Why can a heap with plenty of free bytes still fail an allocation?',
  model: 'Free bytes can be scattered in runs smaller than the request, so no single run fits.',
  ideas: ['Free space is split into runs.', 'The request needs one contiguous run.', 'Total free is not the largest run.'],
  kcs: ['t1.external-frag'],
}
const AUTHORED: AuthoredItem = { id: 'r.anchor.demo-1', q: Q, kcs: ['r.borrow-rules'] }

const quiz = (q: QuizQuestion = Q): PlayableItem => ({ source: 'quiz', lessonId: 't1.l4', qi: 2, q, kcs: ['t1.placement-policy'] })
const cr: PlayableItem = { source: 'cr', lessonId: 't1.l4', index: 0, cr: CR }
const authored: PlayableItem = { source: 'item', item: AUTHORED }
const gen = (variant: string, level: 0 | 1 | 2 | 3 = 2, seed = 7): PlayableItem => ({ source: 'gen', inst: demo.make(seed, level, variant) })

const SOURCES: [string, PlayableItem][] = [
  ['gen numeric', gen('bytes-per-token')],
  ['gen estimate', gen('capacity')],
  ['gen choice', gen('which-plane')],
  ['quiz', quiz()],
  ['cr', cr],
  ['item', authored],
]

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const render = (item: PlayableItem, seed?: number) => renderToStaticMarkup(createElement(ItemCard, { item, ...(seed === undefined ? {} : { seed }), gen: demo, onNext: () => {} }))

/** A response that grades ok for the item. */
function correct(item: PlayableItem) {
  const v = playView(item, 1)
  if (v.kind === 'choice') return { kind: 'choice' as const, picks: [...v.correct] }
  if (v.kind === 'numeric') return { kind: 'numeric' as const, value: v.answer.truth, unit: v.answer.unit }
  if (v.kind === 'estimate') return { kind: 'estimate' as const, value: v.answer.truth }
  return { kind: 'cr' as const, text: 'free space is split', ideas: [true, true, false] as CrResponse['ideas'] }
}

describe('refs and fingerprints', () => {
  test('each source maps to its ledger ref', () => {
    expect(refFor(gen('bytes-per-token'))).toBe('gen:demo/bytes-per-token')
    expect(refFor(quiz())).toBe('quiz:t1.l4#2')
    expect(refFor(cr)).toBe('cr:t1.l4#0')
    expect(refFor(authored)).toBe('item:r.anchor.demo-1')
  })

  test('a checkpoint question keeps the rev QuizBlock writes', () => {
    expect(revFor(quiz())).toBe(rev32({ q: Q.q, options: Q.options, correct: Q.correct }))
    expect(revFor(authored)).toBe(revFor(quiz()))
  })

  test('a generated item carries its instance rev; a cr changes rev when its model answer changes', () => {
    const g = gen('bytes-per-token')
    expect(revFor(g)).toBe((g as { inst: Instance }).inst.rev)
    expect(revFor({ source: 'cr', lessonId: 'a', index: 0, cr: { ...CR, model: 'different' } })).not.toBe(revFor(cr))
  })

  test('kcs come from the item', () => {
    expect(kcsFor(quiz())).toEqual(['t1.placement-policy'])
    expect(kcsFor(cr)).toEqual(['t1.external-frag'])
    expect(kcsFor(authored)).toEqual(['r.borrow-rules'])
    expect(kcsFor(gen('capacity'))).toEqual(['t5.kv-capacity'])
  })
})

describe('the display model', () => {
  test('authored options shuffle by seed, keep ids as authored indices, and carry a why each', () => {
    const a = playView(quiz(), 11)
    const b = playView(quiz(), 11)
    expect(a).toEqual(b)
    if (a.kind !== 'choice') throw new Error('expected choice')
    expect(a.options.map((o) => o.id).sort()).toEqual(['0', '1', '2', '3'])
    expect(a.correct).toEqual(['1'])
    expect(a.options.find((o) => o.id === '1')?.text).toBe(Q.options[1])
    expect(a.options.find((o) => o.id === '1')?.why).toBe(Q.why?.[1])
    const orders = new Set<string>()
    for (let s = 0; s < 30; s++) orders.add((playView(quiz(), s) as { options: { id: string }[] }).options.map((o) => o.id).join(''))
    expect(orders.size).toBeGreaterThan(5)
  })

  test('a question without whys has empty whys and shows its explanation', () => {
    const v = playView(quiz({ q: 'x?', options: ['a', 'b'], correct: [0], explanation: 'because' }), 1)
    if (v.kind !== 'choice') throw new Error('expected choice')
    expect(v.options.every((o) => o.why === '')).toBe(true)
    expect(v.explanation).toBe('because')
  })

  test('multi follows the flag, or more than one key', () => {
    const v = (q: QuizQuestion) => playView(quiz(q), 1)
    expect(v(MULTI)).toMatchObject({ multi: true })
    expect(v({ ...Q, correct: [0, 1] })).toMatchObject({ multi: true })
    expect(v(Q)).toMatchObject({ multi: false })
  })

  test('a generated choice shuffles by seed and keeps ids; numeric and estimate pass the answer through', () => {
    const g = gen('which-plane')
    const orders = new Set<string>()
    for (let s = 0; s < 30; s++) {
      const v = playView(g, s)
      if (v.kind !== 'choice') throw new Error('expected choice')
      expect(v.correct).toEqual(['kv'])
      orders.add(v.options.map((o) => o.id).join())
    }
    expect(orders.size).toBeGreaterThan(2)
    expect(playView(gen('bytes-per-token')).kind).toBe('numeric')
    expect(playView(gen('capacity')).kind).toBe('estimate')
    expect(playView(cr).kind).toBe('cr')
  })

  test('the default seed is stable per item', () => {
    expect(defaultSeed(quiz())).toBe(defaultSeed(quiz()))
    expect(defaultSeed(gen('capacity', 2, 99))).toBe(99)
  })
})

describe('numbers from text', () => {
  test('digits, signs, decimals, exponents and thousands separators', () => {
    expect(parseNumber('131072')).toBe(131072)
    expect(parseNumber(' 131,072 ')).toBe(131072)
    expect(parseNumber('1,024.5')).toBe(1024.5)
    expect(parseNumber('0.5')).toBe(0.5)
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('3e5')).toBe(300000)
    expect(parseNumber('-2')).toBe(-2)
    expect(parseNumber('1 000')).toBe(1000)
  })

  test('a decimal comma, a unit, a percent sign and the empty string are refused, not misread', () => {
    for (const bad of ['0,5', '12,34', '1,00', '12 KiB', '12%', 'abc', '', ' ', '1.2.3', 'Infinity', 'NaN', '1e999']) expect(parseNumber(bad)).toBeNull()
  })
})

describe('drafts become responses', () => {
  const numeric = playView(gen('bytes-per-token'))
  const estimate = playView(gen('capacity'))

  test('an empty draft cannot be graded and says why', () => {
    for (const [, item] of SOURCES.filter(([n]) => n !== 'cr')) {
      const r = responseFor(emptyDraft(playView(item)))
      expect(r.ok).toBe(false)
    }
    expect(responseFor(emptyDraft(playView(cr))).ok).toBe(true)
  })

  test('numeric: value and the chosen unit', () => {
    const d: Draft = { ...emptyDraft(numeric), kind: 'numeric', text: '128', unit: 'KiB' }
    expect(responseFor(d)).toEqual({ ok: true, response: { kind: 'numeric', value: 128, unit: 'KiB' } })
    expect(responseFor({ ...d, text: '128 KiB' }).ok).toBe(false)
  })

  test('estimate: the range is both ends or neither, low before high', () => {
    const d: Draft = { ...emptyDraft(estimate), kind: 'estimate', text: '1e6', lo: '', hi: '', range: true }
    expect(responseFor(d)).toEqual({ ok: true, response: { kind: 'estimate', value: 1e6 } })
    expect(responseFor({ ...d, lo: '5e5', hi: '2e6' })).toEqual({ ok: true, response: { kind: 'estimate', value: 1e6, lo: 5e5, hi: 2e6 } })
    expect(responseFor({ ...d, lo: '5e5' }).ok).toBe(false)
    expect(responseFor({ ...d, lo: '2e6', hi: '5e5' }).ok).toBe(false)
    // a closed range is ignored even if its boxes still hold text
    expect(responseFor({ ...d, range: false, lo: 'junk', hi: '' })).toEqual({ ok: true, response: { kind: 'estimate', value: 1e6 } })
  })

  test('hasAnswer reveals the confidence row once something is chosen or typed', () => {
    expect(hasAnswer({ kind: 'choice', picks: [] })).toBe(false)
    expect(hasAnswer({ kind: 'choice', picks: ['1'] })).toBe(true)
    expect(hasAnswer({ kind: 'numeric', text: '  ', unit: 'B' })).toBe(false)
    expect(hasAnswer({ kind: 'numeric', text: '4', unit: 'B' })).toBe(true)
  })

  test('togglePick: single replaces, multi adds and removes', () => {
    expect(togglePick(['a'], 'b', false)).toEqual(['b'])
    expect(togglePick(['a'], 'a', false)).toEqual(['a'])
    expect(togglePick(['a'], 'b', true)).toEqual(['a', 'b'])
    expect(togglePick(['a', 'b'], 'a', true)).toEqual(['b'])
  })
})

describe('every source grades', () => {
  for (const [name, item] of SOURCES) {
    test(`${name}: the right answer is ok with score 1, a wrong kind is not ok`, () => {
      const g = gradeItem(item, correct(item), demo)
      expect(g.ok).toBe(true)
      expect(g.score).toBe(1)
      const wrongKind = item.source === 'cr' ? ({ kind: 'choice', picks: ['x'] } as const) : ({ kind: 'cr', text: '', ideas: [true, true, true] } as const)
      expect(gradeItem(item, wrongKind, demo).ok).toBe(false)
    })
  }

  test('a checkpoint answer is right only on the exact key set (multi)', () => {
    const m = quiz(MULTI)
    expect(gradeItem(m, { kind: 'choice', picks: ['0', '2'] }).ok).toBe(true)
    expect(gradeItem(m, { kind: 'choice', picks: ['2', '0'] }).ok).toBe(true)
    expect(gradeItem(m, { kind: 'choice', picks: ['0'] }).ok).toBe(false)
    expect(gradeItem(m, { kind: 'choice', picks: ['0', '1', '2'] }).ok).toBe(false)
    expect(gradeItem(m, { kind: 'choice', picks: [] }).ok).toBe(false)
  })

  test('a wrong lure carries its misconception id into the diagnosis', () => {
    const g = gen('which-plane')
    const wrong = gradeItem(g, { kind: 'choice', picks: ['k'] }, demo)
    expect(wrong.ok).toBe(false)
    expect(wrong.diagnosis?.id).toBe('demo.forgot-k-and-v')
  })

  test('a numeric slip is named by the family rule, and the shared rules apply without the family', () => {
    const g = gen('bytes-per-token')
    if (g.source !== 'gen' || g.inst.answer.kind !== 'numeric') throw new Error('expected numeric')
    const truth = g.inst.answer.truth
    expect(gradeItem(g, { kind: 'numeric', value: truth / 2, unit: 'B' }, demo).diagnosis?.id).toBe('demo.forgot-k-and-v')
    expect(gradeItem(g, { kind: 'numeric', value: truth / 2, unit: 'B' }).diagnosis?.id).not.toBe('demo.forgot-k-and-v')
    expect(gradeItem(g, { kind: 'numeric', value: truth * 1000, unit: 'B' }).diagnosis?.id).toBe('unit.kilo')
  })

  test('a constructed response passes at two ideas and not at one', () => {
    const at = (ideas: CrResponse['ideas']) => gradeItem(cr, { kind: 'cr', text: '', ideas })
    expect(at([true, true, true]).ok).toBe(true)
    expect(at([false, true, true]).ok).toBe(true)
    const one = at([true, false, false])
    expect(one.ok).toBe(false)
    expect(one.feedback).toContain(CR.ideas[1])
    expect(at([false, false, false]).score).toBe(0)
  })
})

describe('results', () => {
  test('a checkpoint result carries ref, rev, kcs, the authored pick and the seed', () => {
    const item = quiz()
    const r = resultFor(item, { kind: 'choice', picks: ['3', '1'] }, gradeItem(item, { kind: 'choice', picks: ['3', '1'] }), { seed: 5, ms: 1234.4, conf: 'sure' })
    expect(r).toMatchObject({ source: 'quiz', ref: 'quiz:t1.l4#2', rev: revFor(item), kcs: ['t1.placement-policy'], pick: [1, 3], seed: 5, ms: 1234, nsec: 30, conf: 'sure', ok: false })
  })

  test('a cr result lists the ticked ideas; a generated result carries level and variant', () => {
    const response = { kind: 'cr', text: 'x', ideas: [true, false, true] } as const
    expect(resultFor(cr, response, gradeItem(cr, response), { seed: 1, ms: 10 })).toMatchObject({ ideas: [0, 2], ok: true, nsec: 90 })
    const g = gen('capacity', 1)
    const r = resultFor(g, correct(g), gradeItem(g, correct(g), demo), { seed: 1, ms: -5 })
    expect(r).toMatchObject({ level: 1, variant: 'capacity', ref: 'gen:demo/capacity', ms: 0 })
    expect('pick' in r).toBe(false)
    expect('conf' in r).toBe(false)
  })
})

describe('keys', () => {
  test('letters A to D (and E) pick by display position, either case, only when the option exists', () => {
    expect(optionIndexForKey('a', 4)).toBe(0)
    expect(optionIndexForKey('D', 4)).toBe(3)
    expect(optionIndexForKey('e', 4)).toBeNull()
    expect(optionIndexForKey('e', 5)).toBe(4)
    expect(optionIndexForKey('c', 2)).toBeNull()
    expect(optionIndexForKey('Enter', 4)).toBeNull()
    expect(optionIndexForKey('1', 4)).toBeNull()
  })

  test('1, 2 and 3 are guess, think and sure', () => {
    expect([1, 2, 3, 4, 0].map((n) => confidenceForKey(String(n)))).toEqual(['guess', 'think', 'sure', null, null])
  })
})

describe('keyAction: what the card does with a key', () => {
  const state = (over: Partial<KeyState> = {}): KeyState => ({ stepsOpen: false, done: false, kind: 'choice', optionCount: 4, answered: false, confidence: true, ...over })
  const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({ key: k, repeat: false, shift: false, ctrl: false, meta: false, alt: false, target: 'other', ...over })
  const none: KeyAction = { type: 'none' }

  test('letters pick by position, only before the verdict and outside a field', () => {
    expect(keyAction(state(), key('b'))).toEqual({ type: 'pick', index: 1 })
    expect(keyAction(state(), key('E'))).toEqual(none)
    expect(keyAction(state({ optionCount: 5 }), key('e'))).toEqual({ type: 'pick', index: 4 })
    expect(keyAction(state({ done: true }), key('a'))).toEqual(none)
    expect(keyAction(state({ kind: 'numeric' }), key('a'))).toEqual(none)
    expect(keyAction(state(), key('a', { target: 'input' }))).toEqual(none)
    expect(keyAction(state(), key('a', { ctrl: true }))).toEqual(none)
    expect(keyAction(state(), key('a', { repeat: true }))).toEqual(none)
  })

  test('1, 2, 3 set confidence once something is answered, never for a constructed response or when off', () => {
    expect(keyAction(state(), key('2'))).toEqual(none)
    expect(keyAction(state({ answered: true }), key('1'))).toEqual({ type: 'confidence', conf: 'guess' })
    expect(keyAction(state({ answered: true }), key('3'))).toEqual({ type: 'confidence', conf: 'sure' })
    expect(keyAction(state({ answered: true, kind: 'numeric' }), key('2'))).toEqual({ type: 'confidence', conf: 'think' })
    expect(keyAction(state({ answered: true, kind: 'cr' }), key('2'))).toEqual(none)
    expect(keyAction(state({ answered: true, confidence: false }), key('2'))).toEqual(none)
    expect(keyAction(state({ answered: true }), key('2', { target: 'input' }))).toEqual(none)
  })

  test('Enter: an option selects until something is picked, then submits; a button keeps its own click', () => {
    expect(keyAction(state(), key('Enter', { target: 'option' }))).toEqual(none)
    expect(keyAction(state({ answered: true }), key('Enter', { target: 'option' }))).toEqual({ type: 'act' })
    expect(keyAction(state(), key('Enter', { target: 'button' }))).toEqual(none)
    expect(keyAction(state(), key('Enter', { target: 'input' }))).toEqual({ type: 'act' })
    expect(keyAction(state(), key('Enter'))).toEqual({ type: 'act' })
    expect(keyAction(state(), key('Enter', { shift: true }))).toEqual(none)
  })

  test('Enter after the verdict goes on, and a held Enter does not run through submit into Next', () => {
    expect(keyAction(state({ done: true }), key('Enter'))).toEqual({ type: 'act' })
    for (const target of ['option', 'button', 'input', 'other'] as const) {
      expect(keyAction(state({ answered: true }), key('Enter', { target, repeat: true }))).toEqual({ type: 'swallow' })
    }
    expect(keyAction(state({ done: true }), key('Enter', { target: 'button', repeat: true }))).toEqual({ type: 'swallow' })
  })

  test('in the constructed-response box Enter is a newline; Ctrl or Cmd plus Enter continues; a select keeps Enter', () => {
    const cr = state({ kind: 'cr' })
    expect(keyAction(cr, key('Enter', { target: 'textarea' }))).toEqual(none)
    expect(keyAction(cr, key('Enter', { target: 'textarea', ctrl: true }))).toEqual({ type: 'act' })
    expect(keyAction(cr, key('Enter', { target: 'textarea', meta: true }))).toEqual({ type: 'act' })
    expect(keyAction(cr, key('Enter', { target: 'textarea', repeat: true }))).toEqual(none)
    expect(keyAction(state(), key('Enter', { target: 'select' }))).toEqual(none)
  })

  test('Escape closes the steps when open, and is left alone otherwise', () => {
    expect(keyAction(state({ stepsOpen: true }), key('Escape', { target: 'button' }))).toEqual({ type: 'close-steps' })
    expect(keyAction(state({ stepsOpen: true, done: true }), key('Escape', { target: 'input' }))).toEqual({ type: 'close-steps' })
    expect(keyAction(state(), key('Escape'))).toEqual(none)
  })

  test('Alt chords are left to the browser', () => {
    expect(keyAction(state({ answered: true }), key('Enter', { alt: true }))).toEqual(none)
    expect(keyAction(state(), key('a', { alt: true }))).toEqual(none)
  })
})

describe('the constructed response after the reveal', () => {
  const props = { cr: CR, text: '', ideas: [false, false, false] as [boolean, boolean, boolean], onText: () => {}, onReveal: () => {}, onIdea: () => {}, disabled: false }

  test('the model answer is a focus target (the reveal button unmounts), and the ideas appear', () => {
    const before = renderToStaticMarkup(createElement(ConstructedAnswer, { ...props, revealed: false }))
    expect(before).toContain('data-ks-reveal')
    expect(before).not.toContain('data-ks-model')
    const after = renderToStaticMarkup(createElement(ConstructedAnswer, { ...props, revealed: true }))
    expect(after).not.toContain('data-ks-reveal')
    expect(after).toMatch(/data-ks-model="true" tabindex="-1"/)
    expect(after.match(/data-ks-idea/g)).toHaveLength(3)
  })
})

describe('the card renders every source', () => {
  for (const [name, item] of SOURCES) {
    test(`${name}: a form with the question, a 44 px submit, and an empty live region`, () => {
      const html = render(item)
      expect(html).toContain('<form')
      expect(html).toContain('min-h-11')
      expect(html).toMatch(/role="status"[^>]*aria-live="polite"/)
      expect(html).toContain('type="submit"')
      const text = textOf(html)
      const first = playView(item).prompt.stem[0]
      expect(first.t === 'text' && text).toContain(first.t === 'text' ? first.text.slice(0, 24) : '')
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('undefined')
    })
  }

  test('choice options are labelled A–D, toggle buttons, and carry no verdict before submit', () => {
    const html = render(quiz(), 3)
    for (const l of ['A', 'B', 'C', 'D']) expect(html).toContain(`aria-keyshortcuts="${l}"`)
    expect(html).toContain('aria-pressed="false"')
    expect(textOf(html)).not.toContain('the correct answer')
    expect(textOf(html)).not.toContain('Why each answer')
  })

  test('numeric asks for a decimal field and a unit; estimate offers the range behind a button', () => {
    const n = render(gen('bytes-per-token'))
    expect(n).toContain('inputMode="decimal"')
    expect(n).toContain('<select')
    const e = render(gen('capacity'))
    expect(e).toContain('Add a 90 % range')
    expect(e).not.toContain('Low (5 % chance below)')
  })

  test('a constructed response shows the textarea and "Show the model answer", not the model answer or the ideas', () => {
    const html = render(cr)
    expect(html).toContain('<textarea')
    expect(html).toContain('Show the model answer')
    expect(html).not.toContain(CR.model)
    expect(html).not.toContain(CR.ideas[0])
  })

  test('claims render as chips with their text in the DOM', () => {
    const base = demo.make(3, 2, 'bytes-per-token')
    const claim = getClaim('model.llama3-8b.layers')
    const inst: Instance = { ...base, prompt: { stem: [{ t: 'text', text: 'Llama-3-8B has ' }, { t: 'claim', claim: 'model.llama3-8b.layers' }, { t: 'text', text: ' layers.' }, { t: 'value', value: 4096, unit: 'B' }, { t: 'code', code: 'let x = 1' }], givens: [{ label: 'dtype', value: { t: 'text', text: 'bf16' } }] } }
    const html = render({ source: 'gen', inst })
    expect(html).toContain(`Show source`)
    expect(textOf(html)).toContain(String(claim.value))
    expect(html).toContain('4,096 B')
    expect(html).toContain('<dl')
    expect(html).toContain('<code')
  })

  test('worked steps at level 0 hide a blank step result until the answer', () => {
    const base = demo.make(3, 0, 'bytes-per-token')
    const inst: Instance = { ...base, prompt: { ...base.prompt, worked: [{ text: [{ t: 'text', text: 'multiply' }], result: { value: 4242, unit: 'B' }, blank: true }] } }
    const html = render({ source: 'gen', inst })
    expect(html).toContain('Worked so far')
    expect(html).toContain('blank step')
    expect(html).not.toContain('4,242')
  })

  test('a long unbroken token cannot widen the card: text containers can shrink', () => {
    const html = render(quiz({ ...Q, options: ['x'.repeat(200), 'b', 'c', 'd'], correct: [0], why: ['a', 'b', 'c', 'd'] }))
    expect(html).toContain('min-w-0')
    expect(html).toContain('break-words')
  })
})
