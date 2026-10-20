/**
 * The serving-first reading groups (docs/specs/serving-reading.md §4, M1 item 2, task SR-04).
 *
 * Holds: the four `reading-*` groups list reading KCs only and carry no permission or focus label, and no other
 * group lists a reading KC (rule 1, so no legacy pool moves); no why uses R3's Read/Write/Own vocabulary (rule 3,
 * SR-D9); each reading pool meets SR-D10's floors (at least 24 verdict and 16 fix units, 20-27 % "compiles", every
 * fix pool's worst blind strategy at most chance + 10 points) and `bank.units` stays 16; and the Error Museum and
 * its practice items never return a reading unit (SR-D8).
 *
 * Rule 4 (no fix calls `.clone()` on an `Rc`, `Arc` or `Weak`) and rule 9 (one distinct rustc code per failing
 * variant and per wrong fix) are checked by the SR-04 implementer, by reading and by a rustc sweep: the banks
 * record only rustc's first error.
 */
import { describe, expect, test } from 'bun:test'
import { checkChoiceCues } from '../../scripts/verify-generators'
import { bankUnits, ERROR_CODES, isReadingSnippet, loadRustGroups, READING_KCS } from '../../src/data/rust-items'
import compile, { compileVariantId, POOLS, practiceInstance, REFS } from '../../src/lib/items/families/compile'
import type { Gen } from '../../src/lib/items/types'
import { museumEntries } from '../../src/lib/rust/museum'

const GROUPS = await loadRustGroups()
const READING_GROUPS = GROUPS.filter((g) => g.id.startsWith('reading-'))
const READING: readonly string[] = READING_KCS
const SNIPPETS = READING_GROUPS.flatMap((g) => g.snippets)
/** Every why a reading item can show: each variant's and each fix's. */
const WHYS = SNIPPETS.flatMap((s) => s.variants.flatMap((v) => [{ at: `${s.id}/${v.id}`, why: v.why }, ...(v.fixes ?? []).map((f) => ({ at: `${s.id}/${v.id}/${f.id}`, why: f.why }))]))
/** R3's labels (Crichton's permissions), which a learner who skipped Rust Zero never met. */
const RWO = /\b(R|W|O)\b|[Pp]ermission/

describe('the reading groups', () => {
  test('there are four, and every snippet in them is a reading snippet', () => {
    expect(READING_GROUPS.map((g) => g.id)).toEqual(['reading-closures', 'reading-enums', 'reading-iter', 'reading-pointers'])
    expect(SNIPPETS).toHaveLength(36)
    for (const s of SNIPPETS) expect({ id: s.id, reading: isReadingSnippet(s) }).toEqual({ id: s.id, reading: true })
  })

  test('they list reading KCs only, and no other group lists one, so no legacy pool moves', () => {
    for (const s of SNIPPETS) expect({ id: s.id, other: s.kcs.filter((k) => !READING.includes(k)) }).toEqual({ id: s.id, other: [] })
    for (const g of GROUPS.filter((x) => !READING_GROUPS.includes(x))) {
      for (const s of g.snippets) expect({ id: `${g.id}/${s.id}`, reading: s.kcs.filter((k) => READING.includes(k)) }).toEqual({ id: `${g.id}/${s.id}`, reading: [] })
    }
  })

  test('no variant carries a permission label or a focus', () => {
    for (const s of SNIPPETS) {
      for (const v of s.variants) expect({ at: `${s.id}/${v.id}`, permission: v.permission, focus: v.focus }).toEqual({ at: `${s.id}/${v.id}`, permission: undefined, focus: undefined })
    }
  })

  test('no why uses the Read/Write/Own vocabulary', () => {
    expect(WHYS.length).toBeGreaterThan(300)
    expect(WHYS.filter((w) => RWO.test(w.why)).map((w) => w.at)).toEqual([])
    // the check bites: a legacy why in R3's vocabulary is caught
    expect(RWO.test('`v` loses W while the borrow lives')).toBe(true)
  })
})

describe('the reading pools (SR-D10)', () => {
  test('each reading KC has at least 24 verdict units, 16 fix units and 20-27 % "compiles"', () => {
    for (const kc of READING) {
      const verdict = POOLS.get(compileVariantId('verdict', kc)) ?? []
      const fix = POOLS.get(compileVariantId('fix', kc)) ?? []
      const compiles = verdict.filter((r) => r.outcome === 'compiles').length / verdict.length
      expect({ kc, verdict: verdict.length >= 24, fix: fix.length >= 16, compiles: compiles >= 0.2 && compiles <= 0.27 }).toEqual({ kc, verdict: true, fix: true, compiles: true })
    }
  })

  test('bank.units stays 16, the smallest pool, so the distinct-instance gate is as strong as before', () => {
    expect(compile.bank!.units).toBe(16)
  })

  test("every reading fix pool's worst blind strategy is at most chance + 10 points", () => {
    const reading: Gen = { ...compile, variants: compile.variants.filter((v) => v.blockOnly) }
    expect(reading.variants.map((v) => v.id).sort()).toEqual(READING.flatMap((kc) => [compileVariantId('fix', kc), compileVariantId('verdict', kc)]).sort())
    const cues = checkChoiceCues(reading)
    expect(cues.problems).toEqual([])
    const pooled = cues.rows.filter((r) => !r.where.includes('@L') && r.where.startsWith('compile/fix.'))
    expect(pooled).toHaveLength(4)
    for (const r of pooled) expect({ where: r.where, over: r.worst.hit - r.chance <= 0.1 }).toEqual({ where: r.where, over: true })
  })
})

describe('the Error Museum leaves the reading groups out (SR-D8)', () => {
  const units = bankUnits(GROUPS).units
  const readingKeys = new Set(units.filter((u) => isReadingSnippet(u.snippet)).map((u) => u.key))

  test('museumEntries returns no reading unit, and nothing at all from the reading units alone', () => {
    expect(readingKeys.size).toBe(143)
    expect(museumEntries(units).filter((e) => readingKeys.has(e.key))).toEqual([])
    expect(museumEntries(units.filter((u) => readingKeys.has(u.key)))).toEqual([])
  })

  test('practiceInstance never draws a reading unit, and serves nothing for a code only the reading groups hold', () => {
    const codes = [...new Set(REFS.flatMap((r) => (r.outcome === 'compiles' ? [] : [r.outcome])))]
    for (const code of codes) {
      const legacy = REFS.some((r) => r.outcome === code && !isReadingSnippet(r))
      for (let seed = 0; seed < 60; seed++) {
        const i = practiceInstance(code, seed)
        if (!legacy) {
          expect({ code, seed, i }).toEqual({ code, seed, i: undefined })
          continue
        }
        expect({ code, seed, reading: readingKeys.has(String(i?.params.unit)) }).toEqual({ code, seed, reading: false })
      }
    }
    // the type codes are reading-only, so the Museum shows no `types` exhibit
    for (const code of ['E0004', 'E0277', 'E0308']) {
      expect(ERROR_CODES[code]?.cluster).toBe('types')
      expect(practiceInstance(code, 0)).toBeUndefined()
    }
  })
})
