/**
 * K5 track forms A, B and C (docs/specs/wave-3.md §12.6; task 3b-19): parallel 12-item forms on unseen seeds,
 * counterbalanced across the six orders of the three seed sets, opt-in and measurement only. The draws run under
 * `settle`, so the test that matters most withholds one compile bank group and gets the fully loaded result back.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { KCS } from '../../src/data/kc'
import type { Lesson } from '../../src/data/lessons/types'
import { forgetGroups, groupLoaded, loadGroups } from '../../src/data/rust-items/groups'
import { GROUP_IDS } from '../../src/lib/items/families/compile'
import { correctResponse, gradeResponse } from '../../src/lib/items/grade'
import { collect, NotReady, settle } from '../../src/lib/items/on-demand'
import { resultFor } from '../../src/lib/items/play'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Gen, PlayableItem } from '../../src/lib/items/types'
import { isFormItem, isReviewEvent } from '../../src/lib/learner/cards'
import { armOf } from '../../src/lib/learner/experiments'
import {
  C_AFTER_B_DAYS,
  FORM_ORDERS,
  FORM_SLOTS,
  FORMS_EXPERIMENT,
  buildForms,
  differenceOf,
  formBlueprint,
  formItemResponse,
  formOrder,
  formResults,
  formSeed,
  formWindows,
  formsFor,
  tallyForms,
  trackShape,
  type FormId,
  type FormsInput,
} from '../../src/lib/learner/forms'
import { addDays } from '../../src/lib/learner/reentry'
import { seenInstances } from '../../src/lib/learner/today'
import type { ItemResponse, LedgerEvent } from '../../src/lib/ledger/types'
import { proportionOf } from '../../src/lib/learner/vrk'
import { hash32 } from '../../src/lib/rng'
import type { FormsData } from '../../src/components/me/FormsCard'
import { installDom, type DomKit, type MiniElement, type Mounted } from '../dom/mini-dom'
import { makeProfile, startTab } from '../ledger/env'
import { Journal, START } from './ledger-gen'

let gens: ReadonlyMap<string, Gen>
beforeAll(async () => {
  gens = new Map((await loadAllFamilies()).map((g) => [g.id, g] as const))
})

const input = (expSeed: number): FormsInput => ({ gens, kcs: KCS, expSeed })
/** exp:seeds spread over the uint32 range. */
const seeds = (n: number): number[] => Array.from({ length: n }, (_, i) => hash32(`forms-test:${i}`))
const FORM_TRACKS = ['r', 't1', 't4', 't5', 't6', 't7']
const NO_FORM_TRACKS = ['t0', 't2', 't3']

describe('which tracks have forms', () => {
  test('R, T1, T4, T5, T6 and T7 have 12 slots over at least 3 KCs; T0, T2 and T3 have too little generator coverage', () => {
    for (const t of FORM_TRACKS) {
      const bp = formBlueprint(t, { gens, kcs: KCS })!
      expect(bp, t).not.toBeNull()
      expect(bp).toHaveLength(FORM_SLOTS)
      expect(new Set(bp.map((b) => b.kc)).size, t).toBeGreaterThanOrEqual(3)
      expect(bp.map((b) => b.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
      for (const b of bp) {
        // from loaded families, at level 2, on a KC of the track
        const gen = gens.get(b.family)!
        expect(gen.variants.find((v) => v.id === b.variant)!.levels).toContain(2)
        expect(KCS.find((k) => k.id === b.kc)!.track).toBe(t)
      }
    }
    for (const t of NO_FORM_TRACKS) expect(formBlueprint(t, { gens, kcs: KCS }), t).toBeNull()
  })

  test('the families are the ones the spec lists', () => {
    const familiesOf = (t: string) => [...new Set(formBlueprint(t, { gens, kcs: KCS })!.map((b) => b.family))].sort()
    expect(familiesOf('r')).toEqual(['compile'])
    expect(familiesOf('t1')).toEqual(['frag'])
    expect(familiesOf('t4')).toEqual(['memory', 'roofline', 'tiling'])
    expect(familiesOf('t5')).toEqual(['kv', 'sig', 'spec'])
    expect(familiesOf('t6')).toEqual(['cost', 'memory', 'prefill', 'rollout', 'spec'])
    expect(familiesOf('t7')).toEqual(['cost', 'goodput', 'sig'])
  })

  test('a KC a variant lists at level 2 but only teaches at level 3 is left out (t5.gqa-kv-heads)', () => {
    const kcs = formBlueprint('t5', { gens, kcs: KCS })!.map((b) => b.kc)
    expect(kcs).not.toContain('t5.gqa-kv-heads')
    expect(new Set(kcs).size).toBe(4)
  })

  test('with too few families loaded a track has no forms, and never fewer than 3 KCs', () => {
    const only = new Map([['frag', gens.get('frag')!]])
    expect(formBlueprint('t1', { gens: only, kcs: KCS })).not.toBeNull()
    expect(formBlueprint('t4', { gens: only, kcs: KCS })).toBeNull()
    // t4 with only tiling loaded: tiling covers 5 KCs, so it still has forms; with roofline only: 4 KCs
    expect(formBlueprint('t4', { gens: new Map([['roofline', gens.get('roofline')!]]), kcs: KCS })).not.toBeNull()
    expect(formBlueprint('t5', { gens: new Map([['spec', gens.get('spec')!]]), kcs: KCS })).toBeNull()
  })

  test('the blueprint does not depend on the learner: the same slots for every exp:seed', async () => {
    for (const t of FORM_TRACKS) {
      const bp = formBlueprint(t, { gens, kcs: KCS })!
      for (const s of seeds(5)) {
        const forms = (await formsFor(t, input(s)))!
        for (const id of ['A', 'B', 'C'] as const) {
          expect(forms.forms[id].slots.map((x) => `${x.kc}|${x.family}/${x.variant}`)).toEqual(bp.map((b) => `${b.kc}|${b.family}/${b.variant}`))
        }
      }
    }
  })
})

describe('the seeds and the order', () => {
  test('a slot seed is hash32("forms:" + track + ":" + set + ":" + i + ":" + expSeed)', () => {
    expect(formSeed('t4', 1, 7, 12345)).toBe(hash32('forms:t4:1:7:12345'))
    expect(formSeed('r', 0, 0, 0)).toBe(hash32('forms:r:0:0:0'))
    // a moved draw hashes a bump too, and differs
    expect(formSeed('t4', 1, 7, 12345, 2)).toBe(hash32('forms:t4:1:7:12345:2'))
    expect(formSeed('t4', 1, 7, 12345, 2)).not.toBe(formSeed('t4', 1, 7, 12345))
  })

  test('three disjoint seed sets per track, and different learners get different seeds', () => {
    for (const t of FORM_TRACKS) {
      for (const s of seeds(200)) {
        const all = [0, 1, 2].flatMap((set) => Array.from({ length: FORM_SLOTS }, (_, i) => formSeed(t, set as 0 | 1 | 2, i, s)))
        expect(new Set(all).size).toBe(36)
      }
    }
    const a = new Set(Array.from({ length: 12 }, (_, i) => formSeed('t4', 0, i, 1)))
    const b = new Set(Array.from({ length: 12 }, (_, i) => formSeed('t4', 0, i, 2)))
    expect([...a].filter((x) => b.has(x))).toEqual([])
  })

  test('the set-to-form order is armOf("forms", track, expSeed, 6), one of the 6 permutations of the three sets', () => {
    expect(FORM_ORDERS).toHaveLength(6)
    expect(new Set(FORM_ORDERS.map((o) => o.join(''))).size).toBe(6)
    for (const o of FORM_ORDERS) expect([...o].sort()).toEqual([0, 1, 2])
    for (const t of FORM_TRACKS)
      for (const s of seeds(60)) expect(formOrder(t, s)).toBe(FORM_ORDERS[armOf(FORMS_EXPERIMENT, t, s, 6)])
  })

  test('counterbalanced: over learners each order, and each set in each form, comes up equally often', () => {
    const N = 6000
    const byOrder = new Array<number>(6).fill(0)
    const bySetInForm = [0, 1, 2].map(() => [0, 0, 0])
    seeds(N).forEach((s) => {
      const o = formOrder('t5', s)
      byOrder[FORM_ORDERS.indexOf(o)]++
      o.forEach((set, form) => bySetInForm[form][set]++)
    })
    for (const n of byOrder) expect(Math.abs(n / N - 1 / 6)).toBeLessThan(0.02)
    for (const row of bySetInForm) for (const n of row) expect(Math.abs(n / N - 1 / 3)).toBeLessThan(0.025)
  })

  test("a learner's tracks are not tied to each other: two tracks share an order for about a sixth of learners", () => {
    let same = 0
    const N = 3000
    for (const s of seeds(N)) if (formOrder('t4', s) === formOrder('t5', s)) same++
    expect(Math.abs(same / N - 1 / 6)).toBeLessThan(0.03)
  })
})

describe('the forms', () => {
  test('every track: three forms of 12 slots, each instance at level 2 carrying its slot’s KC, deterministic per exp:seed', async () => {
    for (const t of FORM_TRACKS) {
      for (const s of seeds(12)) {
        const first = (await formsFor(t, input(s)))!
        expect(first, `${t} ${s}`).not.toBeNull()
        const again = (await formsFor(t, input(s)))!
        expect(again).toEqual(first)
        expect(first.kcs.length).toBeGreaterThanOrEqual(3)
        expect(first.order).toBe(formOrder(t, s))
        for (const id of ['A', 'B', 'C'] as const) {
          const plan = first.forms[id]
          expect(plan.slots).toHaveLength(FORM_SLOTS)
          expect(plan.set).toBe(first.order['ABC'.indexOf(id)])
          plan.slots.forEach((slot, i) => {
            expect(slot.slot).toBe(i)
            expect(slot.inst.kcs, `${t} ${id}${i}`).toContain(slot.kc)
            expect(slot.inst.level).toBe(2)
            expect(slot.inst.family).toBe(slot.family)
            expect(slot.inst.variant).toBe(slot.variant)
            // the instance replays from its own seed
            expect(gens.get(slot.family)!.make(slot.inst.seed, 2, slot.variant)).toEqual(slot.inst)
          })
        }
      }
    }
  })

  test('the first draw of a slot is the spec’s seed; a draw moves on only when the instance does not carry the KC or repeats an item', async () => {
    const forms = (await formsFor('t1', input(77)))!
    for (const id of ['A', 'B', 'C'] as const)
      forms.forms[id].slots.forEach((slot, i) => {
        const gen = gens.get(slot.family)!
        const planned = gen.make(formSeed('t1', forms.forms[id].set, i, 77), 2, slot.variant)
        if (planned.kcs.includes(slot.kc)) expect(slot.inst.seed).toBe(planned.seed)
      })
  })

  test('no two items of a track’s three forms share a fingerprint or a seed: a form never repeats an item of another', async () => {
    for (const t of FORM_TRACKS) {
      for (const s of seeds(30)) {
        const f = (await formsFor(t, input(s)))!
        const slots = (['A', 'B', 'C'] as const).flatMap((id) => f.forms[id].slots)
        expect(new Set(slots.map((x) => x.inst.rev)).size, `${t} ${s}`).toBe(36)
        expect(new Set(slots.map((x) => `${x.family}/${x.variant}#${x.inst.seed}`)).size).toBe(36)
      }
    }
  })

  test('parallel: A, B and C ask the same thing in the same place, on other numbers', async () => {
    for (const t of FORM_TRACKS) {
      const f = (await formsFor(t, input(4242)))!
      const shape = (id: FormId) => f.forms[id].slots.map((x) => `${x.kc}|${x.family}/${x.variant}`)
      expect(shape('B')).toEqual(shape('A'))
      expect(shape('C')).toEqual(shape('A'))
      const nums = (id: FormId) => f.forms[id].slots.map((x) => x.inst.seed)
      expect(nums('B')).not.toEqual(nums('A'))
    }
  })

  test('tracks without forms give null', async () => {
    for (const t of NO_FORM_TRACKS) expect(await formsFor(t, input(1))).toBeNull()
  })

  test('different learners get different items, the same learner the same ones', async () => {
    const a = (await formsFor('t6', input(1)))!
    const b = (await formsFor('t6', input(2)))!
    expect(b.forms.A.slots.map((x) => x.inst.seed)).not.toEqual(a.forms.A.slots.map((x) => x.inst.seed))
    expect(((await formsFor('t6', input(1)))!).forms.B.slots.map((x) => x.inst.seed)).toEqual(a.forms.B.slots.map((x) => x.inst.seed))
  })

  test('the blueprint covers a KC more than once only after every KC has been asked', () => {
    for (const t of FORM_TRACKS) {
      const bp = formBlueprint(t, { gens, kcs: KCS })!
      const distinct = new Set(bp.map((b) => b.kc)).size
      expect(new Set(bp.slice(0, distinct).map((b) => b.kc)).size).toBe(distinct)
    }
  })
})

describe('the compile family loads its bank on demand', () => {
  test('with one group withheld, formsFor under settle loads it and gives the fully loaded result, every slot on its KC', async () => {
    const full = (await formsFor('r', input(31337)))!
    const groupsUsed = new Set(
      (['A', 'B', 'C'] as const).flatMap((id) => full.forms[id].slots.map((s) => String(s.inst.params.unit).split('/')[0])),
    )
    expect(groupsUsed.size).toBeGreaterThanOrEqual(2)
    const withheld = [...groupsUsed].sort()[0]
    forgetGroups()
    try {
      await loadGroups(GROUP_IDS.filter((g) => g !== withheld))
      expect(groupLoaded(withheld)).toBe(false)

      // outside settle the draw stops on the missing group: a form that lost items or changed with load timing is never returned
      expect(() => buildForms('r', input(31337))).toThrow(NotReady)
      const stopped = collect(() => buildForms('r', input(31337)))
      expect(stopped.stopped).toBeInstanceOf(NotReady)
      expect(stopped.ready).not.toBeNull()
      await stopped.ready

      forgetGroups()
      await loadGroups(GROUP_IDS.filter((g) => g !== withheld))
      const got = await formsFor('r', input(31337))
      expect(groupLoaded(withheld)).toBe(true)
      expect(got).toEqual(full)
      for (const id of ['A', 'B', 'C'] as const) {
        expect(got!.forms[id].slots).toHaveLength(FORM_SLOTS)
        for (const slot of got!.forms[id].slots) expect(slot.inst.kcs).toContain(slot.kc)
      }
    } finally {
      await loadGroups(GROUP_IDS)
    }
  })

  test('with no group loaded, one settle loads what it needs and still gives the loaded result', async () => {
    const full = (await formsFor('r', input(5)))!
    forgetGroups()
    try {
      expect(await settle(() => buildForms('r', input(5)))).toEqual(full)
    } finally {
      await loadGroups(GROUP_IDS)
    }
  })

  test('a group that cannot load ends in NotReady, not in a form with items missing', async () => {
    forgetGroups()
    try {
      let calls = 0
      const work = () => {
        calls++
        throw new NotReady('a group')
      }
      await expect(settle(work)).rejects.toBeInstanceOf(NotReady)
      expect(calls).toBeGreaterThan(0)
    } finally {
      await loadGroups(GROUP_IDS)
    }
  })

  test('a family other than compile never asks for data, so one run is enough', () => {
    expect(collect(() => buildForms('t4', input(9))).ready).toBeNull()
    expect(collect(() => buildForms('t5', input(9))).ready).toBeNull()
  })
})

describe('recording', () => {
  const inst = async (t: string, id: FormId, slot: number, expSeed = 100) => {
    const forms = (await formsFor(t, input(expSeed)))!
    const s = forms.forms[id].slots[slot]
    const item: PlayableItem = { source: 'gen', inst: s.inst }
    return { forms, s, item }
  }

  test('a form item is src "form" with formId, track, formSlot and formSet, never data.form or data.slot', async () => {
    const { forms, s, item } = await inst('t5', 'B', 3)
    const gen = gens.get(s.family)!
    const grade = gen.grade(s.inst, correctResponse(s.inst))
    const result = resultFor(item, correctResponse(s.inst), grade, { seed: s.inst.seed, ms: 4000 })
    const r = formItemResponse(result, item, { track: 't5', formId: 'B', formSlot: 3, formSet: forms.forms.B.set }, new Set())
    expect(r.kind).toBe('item')
    expect(r.ref).toBe(`gen:${s.family}/${s.variant}`)
    expect(r.provenance).toBe('unseen')
    expect(r.seed).toBe(s.inst.seed)
    expect(r.data).toMatchObject({ src: 'form', formId: 'B', track: 't5', formSlot: 3, formSet: forms.forms.B.set, level: 2, kcs: [s.kc] })
    expect(r.data).not.toHaveProperty('form')
    expect(r.data).not.toHaveProperty('slot')
    expect(r.data).not.toHaveProperty('of')
    expect(r.data).not.toHaveProperty('reason')
  })

  test('an instance the learner has already seen is practice, not unseen', async () => {
    const { s, item } = await inst('t5', 'A', 0)
    const result = resultFor(item, correctResponse(s.inst), gradeResponse(s.inst, correctResponse(s.inst)), { seed: s.inst.seed, ms: 1000 })
    const seen = new Set([`gen:${s.family}/${s.variant}@2:${s.inst.seed}`])
    const r = formItemResponse(result, item, { track: 't5', formId: 'A', formSlot: 0, formSet: 0 }, seen)
    expect(r.provenance).toBe('practice')
  })

  test('through the ledger: the codec keeps all 12, they pay XP like items, and no card is reviewed by them', async () => {
    const tab = startTab(makeProfile())
    const engine = await tab.engine()
    const forms = (await formsFor('t4', input(2024)))!
    const plan = forms.forms.A
    const before = tab.progress.getState().xp
    plan.slots.forEach((s, i) => {
      const item: PlayableItem = { source: 'gen', inst: s.inst }
      const response = i % 3 === 0 ? { kind: 'numeric' as const, value: 0, unit: 'x' } : correctResponse(s.inst)
      const grade = gens.get(s.family)!.grade(s.inst, response)
      const result = resultFor(item, response, grade, { seed: s.inst.seed, ms: 3000 })
      tab.progress.getState().recordItems([formItemResponse(result, item, { track: 't4', formId: 'A', formSlot: i, formSet: plan.set }, new Set())])
    })
    await tab.progress.controls.flush()
    const events = await engine.events({ kinds: ['item'] })
    expect(events).toHaveLength(12)
    for (const e of events) {
      expect(isFormItem(e)).toBe(true)
      expect(isReviewEvent(e)).toBe(false)
      expect((e as { data: Record<string, unknown> }).data.src).toBe('form')
    }
    expect(tab.progress.getState().xp).toBeGreaterThan(before)
    const tally = tallyForms(events, 't4', '2099-01-01')
    expect(tally.A.answered).toBe(12)
    expect(tally.A.complete).toBe(true)
    expect(tally.A.set).toBe(plan.set)
    expect(tally.B.answered).toBe(0)
    // slots 0, 3, 6, 9 were answered wrong on purpose (a numeric answer of 0, or a numeric response to a choice item)
    const wrong = [0, 3, 6, 9].filter((i) => !gens.get(plan.slots[i].family)!.grade(plan.slots[i].inst, { kind: 'numeric', value: 0, unit: 'x' }).ok).length
    expect(tally.A.correct).toBe(12 - wrong)
  })

  test('seenInstances sees a form item, so the same instance is not unseen twice', async () => {
    const { s, item } = await inst('t1', 'C', 5)
    const result = resultFor(item, correctResponse(s.inst), gradeResponse(s.inst, correctResponse(s.inst)), { seed: s.inst.seed, ms: 1000 })
    const j = Journal.from([])
    const first = formItemResponse(result, item, { track: 't1', formId: 'C', formSlot: 5, formSet: 2 }, new Set())
    j.add('item', first.ref, START, { ...first, data: first.data })
    expect([...seenInstances(j.events)]).toEqual([`gen:${s.family}/${s.variant}@2:${s.inst.seed}`])
  })
})

/* ------------------------------------------------------------------ */
/* Timing, tallies and results                                         */
/* ------------------------------------------------------------------ */

const D = (n: number) => addDays(START, n)

/** One form's answers on `day`, `right` of them right. */
function take(j: Journal, track: string, id: FormId, day: string, right: number, set: 0 | 1 | 2 = 0, slots: number[] = Array.from({ length: 12 }, (_, i) => i)) {
  slots.forEach((slot, n) => {
    j.add('item', 'gen:kv/bytes-per-token', day, {
      score: n < right ? 1 : 0,
      ok: n < right,
      rev: 'r',
      provenance: 'unseen',
      seed: 1000 + slot,
      data: { src: 'form', formId: id, track, formSlot: slot, formSet: set, kcs: ['t5.kv-bytes-per-token'], nsec: 40 },
    })
  })
}

const lesson = (id: string, trackId: string, spiral = false): Pick<Lesson, 'id' | 'trackId' | 'ticket'> =>
  ({ id, trackId, ...(spiral ? { ticket: { form: 'spiral', cr: [] } } : {}) }) as Pick<Lesson, 'id' | 'trackId' | 'ticket'>

describe('track shapes', () => {
  test('a track with a spiral checkpoint closes on it; one without closes on its last lesson', () => {
    const lessons = [lesson('t5.l1', 't5'), lesson('t5.l10', 't5', true), lesson('t5.l11', 't5'), lesson('t6.l1', 't6'), lesson('t1.l1', 't1'), lesson('t1.l2', 't1')]
    expect(trackShape('t5', lessons)).toEqual({ track: 't5', lessons: ['t5.l1', 't5.l10', 't5.l11'], closing: 't5.l10', spiral: true })
    expect(trackShape('t1', lessons)).toEqual({ track: 't1', lessons: ['t1.l1', 't1.l2'], closing: 't1.l2', spiral: false })
    expect(trackShape('t3', lessons)).toBeNull()
  })

  test('against the real lessons: the spiral lessons of T4 to T7, and the last lessons of R and T1', async () => {
    const { ALL_LESSONS } = await import('../../src/data/lessons')
    expect(trackShape('t4', ALL_LESSONS)!.closing).toBe('t4.l7')
    expect(trackShape('t5', ALL_LESSONS)!.closing).toBe('t5.l10')
    expect(trackShape('t6', ALL_LESSONS)!.closing).toBe('t6.l10')
    expect(trackShape('t7', ALL_LESSONS)!.closing).toBe('t7.l5')
    for (const t of ['r', 't1']) {
      const shape = trackShape(t, ALL_LESSONS)!
      expect(shape.spiral).toBe(false)
      expect(shape.closing).toBe(shape.lessons[shape.lessons.length - 1])
    }
  })
})

describe('tallies', () => {
  test('the first answer to a slot counts, other tracks and other kinds of item are left out, and later days wait', () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 7)
    take(j, 't5', 'A', D(0), 12, 0, [0, 1]) // a second answer to slots 0 and 1: ignored
    take(j, 't4', 'A', D(0), 12) // another track
    j.add('item', 'gen:kv/bytes-per-token', D(0), { data: { src: 'today', formId: 'A', track: 't5', formSlot: 5, kcs: ['x'] } }) // not a form item
    take(j, 't5', 'B', D(9), 3, 1, [0, 1, 2, 3]) // a day that has not come yet at D(5)
    const at = tallyForms(j.events, 't5', D(5))
    expect(at.A).toMatchObject({ answered: 12, correct: 7, complete: true, set: 0 })
    expect(at.A.finishedDay).toBe(D(0))
    expect(at.B).toMatchObject({ answered: 0, correct: 0, complete: false, set: null })
    const later = tallyForms(j.events, 't5', D(9))
    expect(later.B).toMatchObject({ answered: 4, correct: 3, complete: false, set: 1 })
    expect([...later.B.slots]).toEqual([0, 1, 2, 3])
    expect(later.B.finishedDay).toBeUndefined()
  })

  test('a duplicated event (a merge delivers one twice) counts once', () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 12, 0, [0])
    const twice = [...j.events, ...j.events]
    expect(tallyForms(twice, 't5', D(1)).A.answered).toBe(1)
  })

  test('slots out of range and unknown form ids are ignored', () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 12, 0, [12, -1])
    j.add('item', 'gen:kv/bytes-per-token', D(0), { data: { src: 'form', formId: 'D', track: 't5', formSlot: 1, formSet: 0, kcs: [] } })
    const t = tallyForms(j.events, 't5', D(1))
    expect(t.A.answered + t.B.answered + t.C.answered).toBe(0)
  })
})

describe('when a form is offered', () => {
  const spiral = trackShape('t5', [lesson('t5.l1', 't5'), lesson('t5.l2', 't5'), lesson('t5.l3', 't5', true)])!
  const plain = trackShape('r', [lesson('r.l1', 'r'), lesson('r.l2', 'r')])!
  const states = (shape: typeof spiral, marks: Parameters<typeof formWindows>[1], j: Journal, now: string) =>
    formWindows(shape, marks, tallyForms(j.events, shape.track, now), now).map((w) => `${w.id}:${w.state}:${w.why}`)

  test('before any lesson: A is open, B and C wait', () => {
    expect(states(spiral, {}, new Journal(), D(0))).toEqual(['A:open:pretest', 'B:upcoming:spiral', 'C:upcoming:after-b'])
    expect(states(plain, {}, new Journal(), D(0))).toEqual(['A:open:pretest', 'B:upcoming:finish-track', 'C:upcoming:after-b'])
  })

  test('once a lesson of the track is done A closes, whether the learner passed it or clicked through', () => {
    for (const mark of [{ done: true as const }, { passedAt: `${D(1)}T10:00:00.000Z` }]) {
      expect(states(spiral, { 't5.l2': mark }, new Journal(), D(2))[0]).toBe('A:closed:lesson-done')
    }
    // a lesson of another track does not
    expect(states(spiral, { 't4.l1': { done: true } }, new Journal(), D(2))[0]).toBe('A:open:pretest')
  })

  test('a started A is still open until a lesson is done, and a finished A stays taken', () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 5, 0, [0, 1, 2, 3, 4])
    expect(states(spiral, {}, j, D(1))[0]).toBe('A:open:pretest')
    take(j, 't5', 'A', D(1), 5, 0, [5, 6, 7, 8, 9, 10, 11])
    expect(states(spiral, { 't5.l1': { done: true } }, j, D(2))[0]).toBe('A:taken:taken')
  })

  test('B opens when the spiral checkpoint is passed (a click-through is not a pass), or the last lesson is done', () => {
    expect(states(spiral, { 't5.l3': { done: true } }, new Journal(), D(3))[1]).toBe('B:upcoming:spiral')
    expect(states(spiral, { 't5.l3': { done: true, passedAt: `${D(3)}T10:00:00.000Z` } }, new Journal(), D(3))[1]).toBe('B:open:now')
    expect(states(plain, { 'r.l1': { done: true } }, new Journal(), D(3))[1]).toBe('B:upcoming:finish-track')
    expect(states(plain, { 'r.l2': { done: true } }, new Journal(), D(3))[1]).toBe('B:open:now')
  })

  test('C opens 30 days after B was finished, and not before; it never opens without B', () => {
    const j = new Journal()
    const marks = { 't5.l3': { passedAt: `${D(3)}T10:00:00.000Z` } }
    take(j, 't5', 'B', D(10), 9)
    const w = (now: string) => formWindows(spiral, marks, tallyForms(j.events, 't5', now), now)[2]
    expect(w(D(10))).toMatchObject({ state: 'upcoming', why: 'wait', opensOn: D(10 + C_AFTER_B_DAYS) })
    expect(w(D(10 + C_AFTER_B_DAYS - 1)).state).toBe('upcoming')
    expect(w(D(10 + C_AFTER_B_DAYS))).toMatchObject({ state: 'open', why: 'now' })
    expect(w(D(400)).state).toBe('open')
    const noB = formWindows(spiral, marks, tallyForms([], 't5', D(400)), D(400))[2]
    expect(noB).toMatchObject({ state: 'upcoming', why: 'after-b' })
    // a B that was started and not finished does not start the clock
    const half = new Journal()
    take(half, 't5', 'B', D(10), 4, 0, [0, 1, 2, 3])
    expect(formWindows(spiral, marks, tallyForms(half.events, 't5', D(400)), D(400))[2].why).toBe('after-b')
  })

  test('the module writes nothing and locks nothing: it imports no store, no engine and no lesson content', () => {
    const imports = readFileSync(join(import.meta.dir, '../../src/lib/learner/forms.ts'), 'utf8')
      .split('\n')
      .filter((l) => /^import /.test(l))
      .join('\n')
    expect(imports).not.toMatch(/@\/lib\/progress|@\/lib\/ledger\/(client|engine)|@\/data\/lessons'|@\/data\/kc/)
  })
})

describe('results', () => {
  test('a complete form scores k of 12 with its Wilson interval; an incomplete one has no score', () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 5)
    take(j, 't5', 'B', D(20), 9, 1, [0, 1, 2, 3, 4, 5])
    const r = formResults(tallyForms(j.events, 't5', D(30)))
    expect(r.forms.A).toEqual(proportionOf(5, 12))
    expect(r.forms.A!.ci95![0]).toBeCloseTo(0.1932, 3)
    expect(r.forms.A!.ci95![1]).toBeCloseTo(0.6805, 3)
    expect(r.forms.B).toBeNull()
    expect(r.forms.C).toBeNull()
    expect(r.bMinusA).toBeNull()
    expect(r.cMinusB).toBeNull()
  })

  test('B − A and C − B appear once both forms of the pair are complete', () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 5)
    take(j, 't5', 'B', D(20), 9, 1)
    take(j, 't5', 'C', D(51), 8, 2)
    const r = formResults(tallyForms(j.events, 't5', D(60)))
    expect(r.bMinusA!.diff).toBeCloseTo(4 / 12, 10)
    expect(r.cMinusB!.diff).toBeCloseTo(-1 / 12, 10)
    expect(r.cMinusB!.lo).toBeLessThan(r.cMinusB!.diff)
    expect(r.cMinusB!.hi).toBeGreaterThan(r.cMinusB!.diff)
  })

  test('the difference interval is Newcombe’s hybrid score interval, worked by hand for 5 of 12 against 9 of 12', () => {
    // Wilson 95 %: 5/12 -> [0.1932, 0.6805]; 9/12 -> [0.4677, 0.9110]
    // lo = 0.3333 - sqrt((0.75 - 0.4677)^2 + (0.6805 - 0.4167)^2) = 0.3333 - 0.3864 = -0.0531
    // hi = 0.3333 + sqrt((0.9110 - 0.75)^2 + (0.4167 - 0.1932)^2) = 0.3333 + 0.2755 = 0.6088
    const d = differenceOf(proportionOf(5, 12), proportionOf(9, 12))!
    expect(d.diff).toBeCloseTo(0.3333, 4)
    expect(d.lo).toBeCloseTo(-0.0531, 3)
    expect(d.hi).toBeCloseTo(0.6088, 3)
  })

  test('the interval is symmetric under swapping the forms, and never leaves [-1, 1]', () => {
    for (let a = 0; a <= 12; a++)
      for (let b = 0; b <= 12; b++) {
        const d = differenceOf(proportionOf(a, 12), proportionOf(b, 12))!
        const e = differenceOf(proportionOf(b, 12), proportionOf(a, 12))!
        expect(d.lo).toBeCloseTo(-e.hi, 10)
        expect(d.hi).toBeCloseTo(-e.lo, 10)
        expect(d.lo).toBeGreaterThanOrEqual(-1)
        expect(d.hi).toBeLessThanOrEqual(1)
        expect(d.lo).toBeLessThanOrEqual(d.diff + 1e-12)
        expect(d.hi).toBeGreaterThanOrEqual(d.diff - 1e-12)
      }
  })

  test('its exact coverage for 12 items against 12 items is about 95 % (checked by enumerating every outcome)', () => {
    const n = 12
    const pmf = (k: number, p: number) => {
      let c = 1
      for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i
      return c * p ** k * (1 - p) ** (n - k)
    }
    const cache = new Map<string, ReturnType<typeof differenceOf>>()
    const iv = (k1: number, k2: number) => {
      const key = `${k1}/${k2}`
      if (!cache.has(key)) cache.set(key, differenceOf(proportionOf(k1, n), proportionOf(k2, n)))
      return cache.get(key)!
    }
    let worst = 1
    let sum = 0
    let count = 0
    for (let a = 1; a <= 19; a++)
      for (let b = 1; b <= 19; b++) {
        const p1 = a / 20
        const p2 = b / 20
        let cover = 0
        for (let k1 = 0; k1 <= n; k1++)
          for (let k2 = 0; k2 <= n; k2++) {
            const d = iv(k1, k2)!
            if (d.lo <= p2 - p1 + 1e-12 && p2 - p1 - 1e-12 <= d.hi) cover += pmf(k1, p1) * pmf(k2, p2)
          }
        worst = Math.min(worst, cover)
        sum += cover
        count++
      }
    // over a 19 x 19 grid of true rates: mean 0.950, worst 0.903 (at rates near 0 or 1, where Wilson itself is at 0.91)
    expect(sum / count).toBeGreaterThan(0.94)
    expect(sum / count).toBeLessThan(0.96)
    expect(worst).toBeGreaterThan(0.9)
  })
})

/* ------------------------------------------------------------------ */
/* The card on /me                                                     */
/* ------------------------------------------------------------------ */

describe('the card on /me, mounted on a fixture', () => {
  let dom: DomKit
  let FormsCard: React.ComponentType<{ load?: () => Promise<FormsData>; record?: (items: ItemResponse[]) => void }>
  let lessons: FormsData['content']['lessons']
  beforeAll(async () => {
    dom = await installDom()
    FormsCard = (await import('../../src/components/me/FormsCard')).default
    lessons = (await import('../../src/data/lessons')).ALL_LESSONS
  })
  afterAll(async () => {
    await dom.uninstall()
  })

  const textOf = (el: MiniElement) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const fixture = (events: readonly LedgerEvent[], marks: FormsData['marks'] = {}, now = D(40), expSeed: number | undefined = 99): FormsData => ({
    content: { kcs: KCS, gens, lessons },
    events,
    marks,
    now,
    expSeed,
  })
  async function mountCard(data: FormsData, record: (items: ItemResponse[]) => void = () => undefined, load?: () => Promise<FormsData>) {
    const loader = load ?? (() => Promise.resolve(data))
    return dom.mount(createElement(FormsCard, { load: loader, record }))
  }
  async function openCard(page: Mounted) {
    await dom.press(page.container.querySelector('button')!)
    await dom.until(() => page.container.querySelector('[data-forms-tracks]') !== null)
  }
  const row = (page: Mounted, track: string) => page.container.querySelector(`[data-forms-track="${track}"]`)!
  const form = (page: Mounted, track: string, id: string) => row(page, track).querySelector(`[data-form="${id}"]`)!
  const fig = (page: Mounted, name: string) => textOf(page.container.querySelector(`[data-figure="${name}"]`)!)

  test('it is closed to begin with: a heading, the opt-in sentence, and nothing read or drawn until it opens', async () => {
    let loads = 0
    const page = await mountCard(fixture([]), undefined, () => {
      loads++
      return Promise.resolve(fixture([]))
    })
    const card = page.container.querySelector('[data-forms-card]')!
    expect(card.getAttribute('data-forms-open')).toBe('false')
    expect(textOf(card)).toContain('Optional.')
    expect(textOf(card)).toContain('They never lock a lesson')
    expect(textOf(card)).toContain('100 ÷ 12 = 8.3 points')
    const button = card.querySelector('button')!
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await new Promise((r) => setTimeout(r, 30))
    expect(loads).toBe(0)
    expect(card.querySelector('[data-forms-tracks]')).toBeNull()
    await page.unmount()
  })

  test('opened, it draws every track and lists the six with forms in curriculum order, and says which have none', async () => {
    const page = await mountCard(fixture([]))
    await openCard(page)
    expect(page.container.querySelectorAll('[data-forms-track]').map((e) => e.getAttribute('data-forms-track'))).toEqual(FORM_TRACKS)
    expect(textOf(page.container.querySelector('[data-forms-without]')!)).toContain('T0, T2, T3 have too little generated coverage')
    // nothing is done yet: A is open with a Start button, B and C say what they wait for
    expect(form(page, 't5', 'A').getAttribute('data-state')).toBe('open')
    expect(form(page, 't5', 'A').querySelector('button')!.textContent).toBe('Start')
    expect(textOf(form(page, 't5', 'B'))).toContain('Opens when you pass the spiral checkpoint (t5.l10).')
    expect(textOf(form(page, 'r', 'B'))).toContain('Opens when you finish the last lesson (r.l10).')
    expect(textOf(form(page, 't5', 'C'))).toContain('Opens 30 days after you finish form B.')
    expect(form(page, 't5', 'B').querySelector('button')).toBeNull()
    expect(form(page, 't5', 'C').querySelector('button')).toBeNull()
    await page.unmount()
  })

  test('scores: k of 12 with a Wilson interval, B − A "including the pretest effect", and C beside B', async () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 5, 0)
    take(j, 't5', 'B', D(20), 9, 1)
    take(j, 't5', 'C', D(52), 8, 2)
    const marks = { 't5.l10': { done: true as const, passedAt: `${D(19)}T10:00:00.000Z` } }
    const page = await mountCard(fixture(j.events, marks, D(60)))
    await openCard(page)
    expect(fig(page, 'form-t5-A')).toBe('5 of 12 right, 42 % (95 % interval 19 % to 68 %), n = 12')
    expect(fig(page, 'form-t5-B')).toBe('9 of 12 right, 75 % (95 % interval 47 % to 91 %), n = 12')
    expect(fig(page, 'form-t5-C')).toBe('8 of 12 right, 67 % (95 % interval 39 % to 86 %), n = 12')
    expect(fig(page, 'forms-b-minus-a-t5')).toBe('B − A: +33 points (95 % interval −5 to +61), including the pretest effect.')
    expect(fig(page, 'forms-c-beside-b-t5')).toContain('C beside B: C 8 of 12, B 9 of 12; C − B −8 points (95 % interval')
    expect(page.container.querySelector('[data-figure="forms-b-minus-a-t5"]')!.getAttribute('data-n')).toBe('12')
    // a taken form offers no button
    expect(form(page, 't5', 'A').querySelector('button')).toBeNull()
    // another track has nothing yet and says so with its n
    expect(fig(page, 'forms-b-minus-a-t4')).toBe('B − A: not enough data (needs forms A and B, 12 answers each).')
    expect(page.container.querySelector('[data-figure="forms-b-minus-a-t4"]')!.getAttribute('data-enough')).toBe('false')
    await page.unmount()
  })

  test('the timing: A closes once a lesson is done, B opens on the spiral pass, C waits for the 30 days', async () => {
    const j = new Journal()
    take(j, 't5', 'A', D(0), 6)
    take(j, 't5', 'B', D(20), 7, 1)
    const marks = { 't5.l1': { done: true as const }, 't5.l10': { done: true as const, passedAt: `${D(19)}T10:00:00.000Z` }, 't4.l1': { done: true as const } }
    const early = await mountCard(fixture(j.events, marks, D(40)))
    await openCard(early)
    expect(form(early, 't5', 'C').getAttribute('data-state')).toBe('upcoming')
    expect(textOf(form(early, 't5', 'C'))).toContain(`Opens on ${addDays(D(20), 30)}, 30 days after you finished form B.`)
    // T4 has a lesson done and no form A: closed, not offered
    expect(form(early, 't4', 'A').getAttribute('data-state')).toBe('closed')
    expect(textOf(form(early, 't4', 'A'))).toContain('Closed: a lesson in this track is done')
    expect(form(early, 't4', 'A').querySelector('button')).toBeNull()
    await early.unmount()
    const later = await mountCard(fixture(j.events, marks, D(50)))
    await openCard(later)
    expect(form(later, 't5', 'C').getAttribute('data-state')).toBe('open')
    expect(form(later, 't5', 'C').querySelector('button')!.textContent).toBe('Start')
    await later.unmount()
  })

  test('starting a form shows its first question, records src form on Submit, shows the verdict before Next, and a stopped form resumes', async () => {
    const recorded: ItemResponse[] = []
    const page = await mountCard(fixture([]), (items) => recorded.push(...items))
    await openCard(page)
    await dom.press(form(page, 'r', 'A').querySelector('button')!)
    await dom.until(() => page.container.querySelector('[data-form-runner="A"] form') !== null)
    const runner = page.container.querySelector('[data-form-runner="A"]')!
    expect(textOf(runner.querySelector('h3')!)).toContain('Form A')
    expect(textOf(runner)).toContain('form A · question 1 of 12')
    expect(textOf(runner)).toContain('This changes no review schedule and locks nothing.')
    // R's questions are all multiple choice: pick the first option and submit
    const q = runner.querySelector('form')!
    await dom.press(q.querySelector('[data-ks-option]')!)
    await dom.press(q.querySelector('button[type="submit"]')!)
    await dom.until(() => recorded.length === 1)
    expect(recorded[0].data).toMatchObject({ src: 'form', formId: 'A', track: 'r', formSlot: 0 })
    expect(recorded[0].data).not.toHaveProperty('form')
    expect(recorded[0].data).not.toHaveProperty('slot')
    // the verdict shows, still on question 1, until Next
    expect(textOf(runner)).toContain('question 1 of 12')
    const nextButton = runner.querySelectorAll('button').find((b) => textOf(b).startsWith('Next question'))!
    await dom.press(nextButton)
    await dom.until(() => textOf(runner).includes('question 2 of 12'))
    // stopping keeps the answer; the card offers Continue once the ledger has it
    await dom.press(runner.querySelectorAll('button').find((b) => textOf(b) === 'Stop for now')!)
    expect(page.container.querySelector('[data-form-runner]')).toBeNull()
    await page.unmount()
    const j = new Journal()
    j.add('item', recorded[0].ref, D(1), { ...recorded[0], data: recorded[0].data })
    const again = await mountCard(fixture(j.events))
    await openCard(again)
    expect(textOf(form(again, 'r', 'A'))).toContain('1 of 12 answered so far')
    expect(form(again, 'r', 'A').querySelector('button')!.textContent).toBe('Continue')
    await dom.press(form(again, 'r', 'A').querySelector('button')!)
    await dom.until(() => again.container.querySelector('[data-form-runner="A"] form') !== null)
    expect(textOf(again.container.querySelector('[data-form-runner="A"]')!)).toContain('question 2 of 12')
    await again.unmount()
  })

  test('a failed read shows a retry, not an empty card', async () => {
    let tries = 0
    const page = await mountCard(fixture([]), undefined, () => (++tries === 1 ? Promise.reject(new Error('no ledger')) : Promise.resolve(fixture([]))))
    await dom.press(page.container.querySelector('button')!)
    await dom.until(() => page.container.querySelector('[data-forms-error]') !== null)
    expect(page.container.querySelector('[data-forms-tracks]')).toBeNull()
    await dom.press(page.container.querySelector('[data-forms-error] button')!)
    await dom.until(() => page.container.querySelector('[data-forms-tracks]') !== null)
    await page.unmount()
  })

  test('without a seed yet the card waits for the ledger and draws nothing', async () => {
    const page = await mountCard({ ...fixture([], {}, D(1)), expSeed: undefined })
    await dom.press(page.container.querySelector('button')!)
    await dom.until(() => page.container.querySelector('[data-forms-waiting]') !== null)
    expect(page.container.querySelector('[data-forms-tracks]')).toBeNull()
    await page.unmount()
  })
})
