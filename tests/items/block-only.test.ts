/**
 * Block-only variants (docs/specs/serving-reading.md §3.4, SR-D5, SR-D27): a variant flagged `blockOnly` is drawn only by
 * a lesson block that names it. Today, `composeExtra`, tickets, the placement walk, forms and `resolveVariant` skip it;
 * `planItem` (the lesson block) serves it. A synthetic family carries the flag here, so the gates are shown to bite
 * before any real reading variant exists, and `genCovers` (verify-kc) is shown to ignore it.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { CLAIMS } from '../../src/data/claims/all'
import { KC, KC_GRAPH, REF_KCS, RUST_ANCHOR_KC, THRESHOLD_KCS } from '../../src/data/kc'
import { FORGE_LABS } from '../../src/data/labs'
import { ALL_LESSONS } from '../../src/data/lessons'
import { ERROR_CODES } from '../../src/data/rust-items/constants'
import { loadGroups } from '../../src/data/rust-items/groups'
import { blockOnlyFor, finishInstance, resolveVariant } from '../../src/lib/items/core'
import { GROUP_IDS, practiceInstance } from '../../src/lib/items/families/compile'
import { settle } from '../../src/lib/items/on-demand'
import { loadAllFamilies } from '../../src/lib/items/registry'
import type { Gen, Instance, Level, VariantSpec } from '../../src/lib/items/types'
import type { Kc } from '../../src/lib/kc/types'
import { composeExtra } from '../../src/lib/learner/composer'
import { formBlueprint } from '../../src/lib/learner/forms'
import { planItem } from '../../src/lib/learner/item-block'
import { makeGenPool } from '../../src/lib/learner/ticket'
import { buildPool, makeInstance } from '../../src/lib/learner/today'
import type { Card, CardSet } from '../../src/lib/learner/types'
import { addDays } from '../../src/lib/learner/reentry'
import { PENDING_FAMILIES, discoverAuthoredItems, discoverFamilies, verifyKc, type VerifyKcInput } from '../../scripts/verify-kc'
import { CONTENT, START } from '../learner/ledger-gen'

const ALL_LEVELS = [0, 1, 2, 3] as const

/** Three KCs of one track: forms need at least three covered KCs for a blueprint. */
const KC_A = 't5.synth-a'
const KC_B = 't5.synth-b'
const KC_C = 't5.synth-c'

const spec = (id: string, kc: string, blockOnly: boolean): VariantSpec => ({
  id,
  title: id,
  kcs: [kc],
  levels: ALL_LEVELS,
  nsec: 30,
  ...(blockOnly ? { blockOnly: true as const } : {}),
})

/** A family over the three KCs: `plain` variants are drawable everywhere, `read` ones are block-only when `readOnly`. */
function synth(id: string, variants: VariantSpec[]): Gen {
  const gen: Gen = {
    id,
    version: 1,
    title: id,
    kcs: [...new Set(variants.flatMap((v) => v.kcs))],
    variants,
    ratioRules: [],
    pins: [],
    make(seed: number, level: Level, variant?: string): Instance {
      const v = variants.find((x) => x.id === variant) ?? variants.find((x) => !x.blockOnly) ?? variants[0]
      return finishInstance(gen, {
        variant: v.id,
        seed,
        level,
        params: { seed },
        kcs: [...v.kcs],
        prompt: { stem: [{ t: 'text', text: v.id }] },
        answer: { kind: 'choice', options: [{ id: 'a', text: 'a', why: 'a' }], correct: ['a'] },
        nsec: v.nsec,
      })
    },
    grade: () => ({ ok: true, score: 1, feedback: '' }),
    solution: () => [],
  }
  return gen
}

const KC_IDS = [KC_A, KC_B, KC_C]
const kcRows = (family: string): Kc[] => KC_IDS.map((id) => ({ id, track: 't5', gen: [family] }) as unknown as Kc)

/** `mixed`: each KC has a plain and a block-only variant. `only`: each KC has block-only variants alone. */
const MIXED = synth('mixed', KC_IDS.flatMap((kc, i) => [spec(`plain${i}`, kc, false), spec(`read${i}`, kc, true)]))
const ONLY = synth('only', KC_IDS.map((kc, i) => spec(`read${i}`, kc, true)))
const NONE = synth('none', KC_IDS.map((kc, i) => spec(`plain${i}`, kc, false)))

const isRead = (inst: Instance | null | undefined) => inst?.variant.startsWith('read') === true

describe('blockOnlyFor', () => {
  test('true only when every variant teaching the KC is block-only and there is at least one', () => {
    for (const kc of KC_IDS) {
      expect(blockOnlyFor(ONLY, kc), kc).toBe(true)
      expect(blockOnlyFor(MIXED, kc), kc).toBe(false)
      expect(blockOnlyFor(NONE, kc), kc).toBe(false)
    }
  })

  test('a KC no variant teaches is not block-only (a family that lists a KC with no variant behaves as before)', () => {
    expect(blockOnlyFor(ONLY, 't5.nobody')).toBe(false)
  })
})

describe('resolveVariant', () => {
  test('a draw with no variant never lands on a block-only variant, at any level or seed', () => {
    for (const level of ALL_LEVELS) for (let seed = 0; seed < 200; seed++) expect(resolveVariant(MIXED, seed, level).blockOnly, `${level}/${seed}`).toBeUndefined()
  })

  test('naming the variant still resolves it: the lesson block asks for it by id', () => {
    expect(resolveVariant(MIXED, 1, 2, 'read0').id).toBe('read0')
  })

  test('a family with block-only variants alone offers nothing to a variant-less draw', () => {
    expect(() => resolveVariant(ONLY, 1, 2)).toThrow(RangeError)
  })
})

describe('Today: buildPool and makeInstance', () => {
  const poolOf = (gen: Gen) => buildPool({ kcs: kcRows(gen.id), gens: new Map([[gen.id, gen]]), stair: [], authored: new Map(), constructed: new Map(), recent: new Map() })

  test('a family that teaches a KC through block-only variants alone is not in the KC\'s families', () => {
    const p = poolOf(ONLY)
    for (const kc of KC_IDS) expect(p.families(kc), kc).toEqual([])
  })

  test('a family with a plain variant stays, and its draws are never block-only', () => {
    const p = poolOf(MIXED)
    for (const kc of KC_IDS) {
      expect(p.families(kc), kc).toEqual(['mixed'])
      for (let seed = 0; seed < 60; seed++) {
        const made = p.make('mixed', kc, 2, seed)
        expect(made && made.source === 'gen' && isRead(made.inst), `${kc}/${seed}`).toBe(false)
        expect(made, `${kc}/${seed}`).not.toBeNull()
      }
    }
  })

  test('makeInstance serves null for a KC with block-only variants alone, and a plain variant otherwise', () => {
    for (const level of ALL_LEVELS) {
      expect(makeInstance(ONLY, KC_A, level, 7), `only/${level}`).toBeNull()
      expect(isRead(makeInstance(MIXED, KC_A, level, 7)), `mixed/${level}`).toBe(false)
      expect(makeInstance(MIXED, KC_A, level, 7), `mixed/${level}`).not.toBeNull()
    }
  })
})

describe('composeExtra', () => {
  const NOW = addDays(START, 30)
  const card = (kc: string): Card => ({
    kc,
    origin: 'ticket',
    createdDay: addDays(START, 0),
    memory: { stability: 6, difficulty: 5 },
    lastReviewDay: addDays(START, 20),
    reps: 2,
    lapses: 0,
    dueDay: addDays(START, 40),
    priority: false,
  })
  const cards = (kcs: string[]): CardSet => ({ cards: Object.fromEntries(kcs.map((k) => [k, card(k)])), pending: [], offset: 0.02, paused: false })
  const contentOf = (gen: Gen) => ({
    ...CONTENT,
    pool: buildPool({ kcs: kcRows(gen.id), gens: new Map([[gen.id, gen]]), stair: [], authored: new Map(), constructed: new Map(), recent: new Map() }),
  })

  test('serves nothing for carded KCs whose only variants are block-only', () => {
    expect(composeExtra(cards(KC_IDS), contentOf(ONLY), NOW, 3)).toEqual([])
  })

  test('with a plain variant it serves, and never a block-only item', () => {
    const slots = composeExtra(cards(KC_IDS), contentOf(MIXED), NOW, 3)
    expect(slots.length).toBeGreaterThan(0)
    for (const s of slots) expect(s.item.source === 'gen' && isRead(s.item.inst)).toBe(false)
  })
})

describe('tickets and the placement walk: makeGenPool', () => {
  const poolOf = (gen: Gen) => makeGenPool(new Map([[gen.id, gen]]), () => [gen.id])

  test('families(kc) is empty when the family is block-only for the KC, and make serves null', () => {
    const p = poolOf(ONLY)
    const real = poolOf(NONE)
    for (const kc of KC_IDS) {
      expect(p.families(kc), kc).toEqual([])
      expect(real.families(kc), kc).toEqual(['none'])
    }
    expect(p.make('only', KC_A, 2, 5)).toBeNull()
  })

  test('with a plain variant, draws are never block-only', () => {
    const p = poolOf(MIXED)
    for (const kc of KC_IDS) {
      expect(p.families(kc), kc).toEqual(['mixed'])
      for (let seed = 0; seed < 60; seed++) {
        const made = p.make('mixed', kc, 2, seed)
        expect(made, `${kc}/${seed}`).not.toBeNull()
        expect(made && made.source === 'gen' && isRead(made.inst), `${kc}/${seed}`).toBe(false)
      }
    }
  })
})

describe('forms', () => {
  const blueprint = (gen: Gen) => formBlueprint('t5', { gens: new Map([[gen.id, gen]]), kcs: kcRows(gen.id) })

  test('a blueprint draws plain variants only', () => {
    const b = blueprint(MIXED)
    expect(b).not.toBeNull()
    for (const s of b ?? []) expect(s.variant.startsWith('plain'), `${s.kc}/${s.variant}`).toBe(true)
  })

  test('a track whose KCs are block-only has no form', () => {
    expect(blueprint(ONLY)).toBeNull()
  })

  test('the blueprint is the same as with the block-only variants removed', () => {
    const stripped = synth('mixed', MIXED.variants.filter((v) => !v.blockOnly))
    expect(blueprint(MIXED)).toEqual(blueprint(stripped))
  })
})

describe('the lesson block: planItem', () => {
  test('serves a block-only variant by id', () => {
    for (let draw = 0; draw < 6; draw++) {
      const planned = planItem(ONLY, { variants: ['read0', 'read1'] }, [], 12345, draw)
      expect(planned, `draw ${draw}`).not.toBeNull()
      expect(planned?.inst.variant, `draw ${draw}`).toBe(`read${draw % 2}`)
      expect(planned?.kc).toBe(draw % 2 === 0 ? KC_A : KC_B)
    }
  })
})

describe('verify-kc: genCovers', () => {
  let families: Awaited<ReturnType<typeof discoverFamilies>>
  let items: Awaited<ReturnType<typeof discoverAuthoredItems>>
  beforeAll(async () => {
    families = await discoverFamilies()
    items = await discoverAuthoredItems()
  })

  const input = (fams: VerifyKcInput['families']): VerifyKcInput => ({
    graph: structuredClone(KC_GRAPH),
    contract: Object.values(KC),
    thresholds: THRESHOLD_KCS,
    anchor: RUST_ANCHOR_KC,
    lessons: ALL_LESSONS,
    labs: FORGE_LABS,
    claims: new Set(CLAIMS.map((c) => c.id)),
    refMap: REF_KCS,
    families: fams,
    pendingFamilies: PENDING_FAMILIES,
    items,
  })
  const noGenerator = (errors: string[]) => errors.filter((e) => /no generator/.test(e))

  // The committed families as if no variant were block-only, so the figures do not depend on which KCs later tasks link.
  const plain = () => families.map((f) => ({ ...f, blockOnlyKcs: [] }))

  test('the committed families pass with every variant counted', () => {
    expect(verifyKc(input(plain())).errors).toEqual([])
  })

  test('a family that serves a KC through block-only variants alone covers nothing: a KC with fewer than 2 tagged items errors', () => {
    const bare = noGenerator(verifyKc(input(plain().map((f) => (f.id === 'compile' ? { ...f, blockOnlyKcs: f.kcs } : f)))).errors)
    // r.analyzer-limits has one tagged item and leans on the compile generator alone; a block-only compile family leaves it uncovered
    expect(bare.length).toBeGreaterThan(0)
    expect(bare.some((e) => e.startsWith('r.analyzer-limits:'))).toBe(true)
  })

  test('block-only for one KC leaves the family\'s other KCs covered', () => {
    const errs = noGenerator(verifyKc(input(plain().map((f) => (f.id === 'compile' ? { ...f, blockOnlyKcs: ['r.analyzer-limits'] } : f)))).errors)
    expect(errs.map((e) => e.split(':')[0])).toEqual(['r.analyzer-limits'])
  })

  test('discoverFamilies marks no committed KC block-only until a task links a reading variant', () => {
    // SR-04 changes this: the four reading KCs become block-only for compile, and each needs 2 tagged items
    for (const f of families) for (const kc of f.blockOnlyKcs ?? []) expect(f.kcs, `${f.id}/${kc}`).toContain(kc)
  })
})

describe('the compile family: the distractor filter and the legend', () => {
  let compile: Gen
  beforeAll(async () => {
    await loadGroups(GROUP_IDS)
    compile = (await loadAllFamilies()).find((g) => g.id === 'compile') as Gen
  })

  const typesCodes = Object.entries(ERROR_CODES)
    .filter(([, v]) => v.cluster === 'types')
    .map(([c]) => c)
  const textOf = (i: Instance) => i.prompt.stem.map((p) => (p.t === 'text' ? p.text : '')).join('')
  const optionIds = (i: Instance) => (i.answer.kind === 'choice' ? i.answer.options.map((o) => o.id) : [])

  test('the three type-error codes are in the table, in the types cluster', () => {
    expect(typesCodes.sort()).toEqual(['E0004', 'E0277', 'E0308'])
  })

  test('a legacy (not block-only) variant never offers a types code and never carries a legend', async () => {
    const legacy = compile.variants.filter((v) => !v.blockOnly)
    expect(legacy.length).toBeGreaterThan(0)
    for (const v of legacy) {
      for (let seed = 0; seed < 40; seed++) {
        const i = await settle(() => compile.make(seed, 2, v.id))
        for (const c of typesCodes) expect(optionIds(i), `${v.id}/${seed}`).not.toContain(c)
        expect(textOf(i), `${v.id}/${seed}`).not.toContain('Codes: ')
        expect(textOf(i), `${v.id}/${seed}`).not.toMatch(/rustc rejects this with E\d+ \(/)
      }
    }
  })

  test('the Museum\'s practice draw never carries a legend', async () => {
    for (const code of ['E0382', 'E0499', 'E0502', 'E0505']) {
      for (let seed = 1; seed <= 20; seed++) {
        const i = await settle(() => practiceInstance(code, seed))
        if (!i) continue
        expect(textOf(i), `${code}/${seed}`).not.toContain('Codes: ')
        expect(textOf(i), `${code}/${seed}`).not.toMatch(/rustc rejects this with E\d+ \(/)
      }
    }
  })

  test('a block-only variant carries the legend: verdict stems end with the codes among the options, fix stems gloss the code', async () => {
    for (const v of compile.variants.filter((x) => x.blockOnly)) {
      for (let seed = 0; seed < 20; seed++) {
        const i = await settle(() => compile.make(seed, 2, v.id))
        const text = textOf(i)
        if (v.id.startsWith('verdict.')) {
          const codes = optionIds(i).filter((o) => o !== 'compiles')
          expect(text, `${v.id}/${seed}`).toContain('Codes: ')
          for (const c of codes) expect(text, `${v.id}/${seed}`).toContain(`${c} is ${ERROR_CODES[c].means}`)
        } else {
          expect(text, `${v.id}/${seed}`).toMatch(/rustc rejects this with E\d+ \(/)
        }
      }
    }
  })
})
