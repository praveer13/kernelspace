/**
 * The bank freeze and the Error Museum (docs/specs/wave-2.md §15.6, task 2c-18).
 *
 * Holds: the compile family's hash fixture (written, no longer deferred); the "at least 3 snippets per
 * error code" floor as a failure; one museum entry per code the bank holds, each built from a variant
 * rustc confirmed; each entry's permission diagram in src/data/aquascope/errors.json, hash-checked against
 * that entry's code like a lesson's; the R lessons each entry links; and the practice items the page serves.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { checkHashRows, readAllHashRows } from '../../scripts/verify-generators'
import { codeCounts, codeProblems, MIN_SNIPPETS_PER_CODE } from '../../scripts/verify-rust-items'
import ErrorEntry, { practiceResponse, traceFor, traceIsEmpty, traceRejects } from '../../src/components/rust/ErrorEntry'
import { traceProblems, type PermissionTraceFile } from '../../src/data/aquascope/types'
import { ALL_LESSONS } from '../../src/data/lessons'
import { loadRustGroups, PERMISSION_CODES } from '../../src/data/rust-items'
import type { RustGroup } from '../../src/data/rust-items/types'
import compile, { practiceInstance, UNITS, unitOf } from '../../src/lib/items/families/compile'
import { correctResponse, gradeResponse } from '../../src/lib/items/grade'
import { gradeItem, resultFor } from '../../src/lib/items/play'
import { validateEvent } from '../../src/lib/ledger/codec'
import { CORE_CODES, LESSON_TITLES, museumEntries, pickUnit, TAUGHT_IN, withLine } from '../../src/lib/rust/museum'
import { evt } from '../ledger/gen'

const ROOT = path.resolve(import.meta.dir, '../..')
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const ERRORS = JSON.parse(readFileSync(path.join(ROOT, 'src/data/aquascope/errors.json'), 'utf8')) as PermissionTraceFile
const GROUPS = await loadRustGroups()
const ENTRIES = museumEntries(UNITS)
const BANK_CODES = [...new Set(UNITS.flatMap((u) => (u.result === 'compiles' ? [] : [u.result.code])))].sort()

const lessonText = (id: string): string => JSON.stringify(ALL_LESSONS.find((l) => l.id === id)?.blocks ?? [])

describe('the compile family is frozen', () => {
  test("its hash fixture exists, covers every variant and matches the family's output", () => {
    expect(compile.hashFixture).toBeUndefined()
    const rows = readAllHashRows()
    expect(Object.keys(rows.compile ?? {}).sort()).toEqual(compile.variants.map((v) => v.id).sort())
    expect(checkHashRows(compile, rows)).toEqual({ problems: [], warnings: [] })
  })

  test('a family with no fixture row now fails, where a deferred one would only warn', () => {
    const r = checkHashRows(compile, {})
    expect(r.warnings).toEqual([])
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toContain('compile: no fixture')
  })

  test('a drifted row is a problem (the family version is bumped on purpose, then the fixture rewritten)', () => {
    const rows = readAllHashRows()
    const drifted = { compile: { ...rows.compile, permission: 'deadbeef' } }
    expect(checkHashRows(compile, drifted).problems.join('\n')).toContain('compile/permission: output drifted')
  })
})

describe('at least 3 snippets per error code is a failure', () => {
  test('the frozen bank meets it for every code', () => {
    expect(codeProblems(GROUPS)).toEqual([])
    for (const [code, ids] of codeCounts(GROUPS)) expect({ code, ok: ids.size >= MIN_SNIPPETS_PER_CODE }).toEqual({ code, ok: true })
  })

  test('a code held by fewer snippets is reported as a problem, not a warning', () => {
    const [first, ...rest] = GROUPS
    const keep = new Set<string>()
    // thin E0381 (3 snippets in the bank) down to two
    const thinned: RustGroup[] = [first, ...rest].map((g) => ({
      ...g,
      snippets: g.snippets.filter((s) => {
        const hits = s.variants.some((v) => v.expect !== 'compiles' && v.expect.code === 'E0381')
        if (!hits) return true
        keep.add(s.id)
        return keep.size <= 2
      }),
    }))
    const problems = codeProblems(thinned)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('E0381 has 2 snippet(s)')
    expect(problems[0]).toContain('at least 3 per error code')
  })

  test('the script exits 1 on it and 0 on the frozen bank', () => {
    const run = Bun.spawnSync(['bun', 'scripts/verify-rust-items.ts'], { cwd: ROOT })
    expect(run.exitCode).toBe(0)
    expect(run.stderr.toString()).not.toContain('warning')
    const src = readFileSync(path.join(ROOT, 'scripts/verify-rust-items.ts'), 'utf8')
    expect(src).toContain('problems.push(...codeProblems(groups))')
    expect(src).not.toContain('warnings.push')
  })
})

describe('the museum lists one entry per error code in the bank', () => {
  test('every code the bank holds, each once', () => {
    expect(ENTRIES.map((e) => e.code).sort()).toEqual(BANK_CODES)
    expect(new Set(ENTRIES.map((e) => e.code)).size).toBe(ENTRIES.length)
  })

  test('the spec\'s eight codes come first, in its order', () => {
    expect(ENTRIES.slice(0, CORE_CODES.length).map((e) => e.code)).toEqual([...CORE_CODES])
    expect(ENTRIES.at(-1)?.panic).toBe(true)
  })

  test('each entry is a variant rustc confirmed, at the line and code recorded', () => {
    for (const e of ENTRIES) {
      const u = UNITS.find((x) => x.key === e.key)!
      expect(u).toBeDefined()
      expect(u.result).not.toBe('compiles')
      if (u.result === 'compiles') continue
      expect({ code: e.code, key: e.key, ok: u.result.code === e.code && u.result.line === e.line && u.code === e.source }).toEqual({ code: e.code, key: e.key, ok: true })
      expect(e.message).toBe(u.result.message)
      expect(e.source.split('\n').length).toBeLessThanOrEqual(16)
    }
  })

  test('the pick is the smallest variant with a real fix, a permission label where the code has one, and a clone lure where the bank has one', () => {
    for (const e of ENTRIES) {
      const mine = UNITS.filter((u) => u.result !== 'compiles' && u.result.code === e.code)
      const picked = mine.find((u) => u.key === e.key)!
      expect(picked.variant.fixes?.some((f) => f.ok)).toBe(true)
      if (PERMISSION_CODES[e.code] && mine.some((u) => u.variant.permission && u.variant.focus && u.variant.fixes?.some((f) => f.ok))) expect(e.permission).toBeDefined()
      if (mine.some((u) => u.variant.fixes?.some((f) => f.lure === 'clone') && u.variant.fixes.some((f) => f.ok))) {
        expect({ code: e.code, clone: e.wrong?.clone }).toEqual({ code: e.code, clone: true })
      }
      expect(pickUnit(UNITS, e.code)?.key).toBe(e.key)
    }
  })

  test('the real fix compiles; a wrong fix says what rustc did with it; a clone lure adds .clone()', () => {
    for (const e of ENTRIES) {
      expect({ code: e.code, after: e.fix.after }).toEqual({ code: e.code, after: 'compiles' })
      expect(withLine(e.source, e.fix.line, e.fix.text)).not.toBe(e.source)
      if (!e.wrong) continue
      expect(e.wrong.compiles).toBe(e.wrong.after === 'compiles')
      expect(e.wrong.why.length).toBeGreaterThan(0)
      if (e.wrong.clone) expect(withLine(e.source, e.wrong.line, e.wrong.text)).toContain('.clone()')
    }
    // most codes have a clone to show
    expect(ENTRIES.filter((e) => e.wrong?.clone).length).toBeGreaterThanOrEqual(ENTRIES.length - 6)
  })

  test('the entry list for a bank with a code held fewer than 3 times leaves that code out', () => {
    const units = UNITS.filter((u) => !(u.result !== 'compiles' && u.result.code === 'E0521' && u.snippet.id !== 'worker-name-thread'))
    expect(museumEntries(units).map((e) => e.code)).not.toContain('E0521')
    expect(museumEntries(units).length).toBe(ENTRIES.length - 1)
  })
})

describe('each entry links the R lessons that teach it', () => {
  test('every code has at least one lesson, and each is an R lesson with the title the page shows', () => {
    for (const e of ENTRIES) {
      expect({ code: e.code, n: e.lessons.length > 0 }).toEqual({ code: e.code, n: true })
      for (const id of e.lessons) {
        const lesson = ALL_LESSONS.find((l) => l.id === id)
        expect({ code: e.code, id, found: Boolean(lesson) }).toEqual({ code: e.code, id, found: true })
        expect(id.startsWith('r.')).toBe(true)
        expect(LESSON_TITLES[id]).toBe(lesson?.title)
      }
    }
  })

  test('a lesson whose text names a code is one of its lessons', () => {
    const missing: string[] = []
    for (const l of ALL_LESSONS.filter((x) => x.id.startsWith('r.'))) {
      const text = lessonText(l.id)
      for (const code of BANK_CODES) if (text.includes(code) && !(TAUGHT_IN[code] ?? []).includes(l.id)) missing.push(`${l.id} names ${code}`)
    }
    expect(missing).toEqual([])
  })

  test('TAUGHT_IN names only codes the bank holds', () => {
    expect(Object.keys(TAUGHT_IN).sort()).toEqual(BANK_CODES)
  })
})

describe("each entry's permission diagram is in errors.json and hash-checked", () => {
  test('one trace per entry, no others, each hashing to its entry\'s code', () => {
    expect(Object.keys(ERRORS.traces).sort()).toEqual(ENTRIES.map((e) => e.code).sort())
    const problems = traceProblems(
      'errors',
      ENTRIES.map((e) => ({ key: e.code, code: e.source })),
      ERRORS,
      sha256,
    )
    expect(problems).toEqual([])
    for (const e of ENTRIES) expect(ERRORS.traces[e.code].code).toBe(e.source)
  })

  test('a trace is extracted by Aquascope or hand-drawn, never anything else', () => {
    for (const [code, t] of Object.entries(ERRORS.traces)) {
      expect({ code, source: t.source === 'aquascope' || t.source === 'hand' }).toEqual({ code, source: true })
      if (t.source === 'aquascope') expect(t.tool?.toolchain).toBe('nightly-2026-05-01')
    }
  })

  test('an entry whose code changes by one character fails the hash check', () => {
    const e = ENTRIES.find((x) => x.code === 'E0382')!
    const problems = traceProblems('errors', [{ key: e.code, code: e.source.replace('let v', 'let w') }], ERRORS, sha256)
    expect(problems.length).toBeGreaterThan(0)
    expect(problems[0]).toContain('errors/E0382: code hash')
    expect(problems[0]).toContain('re-extract the trace')
  })

  test('a code with no trace fails', () => {
    expect(traceProblems('errors', [{ key: 'E9999', code: 'fn f() {}' }], ERRORS, sha256)[0]).toContain("no trace 'E9999'")
  })

  test('the diagram of a code with a permission label marks the rejected line, or the page says Aquascope does not', () => {
    const unmarked: string[] = []
    for (const e of ENTRIES.filter((x) => x.permission)) {
      const out = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ErrorEntry, { entry: e })))
      const rejects = traceRejects(traceFor(e.code)!)
      expect({ code: e.code, note: out.includes('Aquascope does not mark line') }).toEqual({ code: e.code, note: !rejects })
      if (!rejects) unmarked.push(e.code)
    }
    // Aquascope reports no boundary for an assignment to a binding without W or a move out of an array element
    expect(unmarked).toEqual(['E0384', 'E0508'])
  })

  test('only a code rustc rejects before borrow checking has an empty trace, and the page says why', () => {
    const empty = ENTRIES.filter((e) => traceIsEmpty(traceFor(e.code)!)).map((e) => e.code)
    expect(empty.every((c) => ['E0106'].includes(c))).toBe(true)
    const e = ENTRIES.find((x) => x.code === 'E0106')!
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ErrorEntry, { entry: e })))
    expect(html).toContain('rustc rejects it before the borrow checker runs')
  })
})

describe('practice this error serves compile items on the code', () => {
  test('every entry has a practice item whose key is its code, deterministic in (code, seed)', () => {
    for (const e of ENTRIES) {
      for (const seed of [0, 1, 7, 42]) {
        const inst = practiceInstance(e.code, seed)!
        expect({ code: e.code, seed, made: Boolean(inst) }).toEqual({ code: e.code, seed, made: true })
        expect(practiceInstance(e.code, seed)).toEqual(inst)
        expect(inst.family).toBe('compile')
        expect(compile.variants.some((v) => v.id === inst.variant && v.kcs.every((k) => inst.kcs.includes(k)))).toBe(true)
        const u = unitOf(inst)!
        expect(u.result === 'compiles' ? '' : u.result.code).toBe(e.code)
      }
    }
  })

  test('each item grades its key ok and a wrong pick not ok, with a why for every option', () => {
    for (const e of ENTRIES) {
      for (let seed = 0; seed < 6; seed++) {
        const inst = practiceInstance(e.code, seed)!
        expect(gradeResponse(inst, correctResponse(inst), []).ok).toBe(true)
        if (inst.answer.kind !== 'choice') throw new Error('not a choice item')
        const { options, correct } = inst.answer
        for (const o of options) expect(o.why.length).toBeGreaterThan(0)
        const wrong = options.find((o) => !correct.includes(o.id))!
        expect(gradeResponse(inst, { kind: 'choice', picks: [wrong.id] }, []).ok).toBe(false)
      }
    }
  })

  test('the items cover verdict, permission and fix kinds across the entries', () => {
    const kinds = new Set<string>()
    for (const e of ENTRIES) for (let seed = 0; seed < 12; seed++) kinds.add(practiceInstance(e.code, seed)!.variant.split('.')[0])
    expect([...kinds].sort()).toEqual(['fix', 'permission', 'verdict'])
  })

  test('a code the bank does not hold has no practice item', () => {
    expect(practiceInstance('E9999', 3)).toBeUndefined()
  })

  test('an answered item is a valid ledger event with practice credit', () => {
    const inst = practiceInstance('E0382', 5)!
    const item = { source: 'gen', inst } as const
    const response = correctResponse(inst)
    const r = resultFor(item, response, gradeItem(item, response, compile), { seed: 5, ms: 2400 })
    const ir = practiceResponse(r)
    expect(ir).toMatchObject({ kind: 'item', ref: `gen:compile/${inst.variant}`, ok: true, provenance: 'practice', data: { src: 'practice', variant: inst.variant, level: inst.level } })
    const e = evt('item', ir.ref, '2026-10-13T09:00:00.000Z', { score: ir.score, ok: ir.ok, rev: ir.rev, data: ir.data, seed: ir.seed, ms: ir.ms, provenance: 'practice' })
    expect(validateEvent(e)).toMatchObject({ ok: true })
  })
})

describe('the entry renders', () => {
  const html = (code: string, extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ErrorEntry, { entry: ENTRIES.find((e) => e.code === code)!, practice: practiceInstance, gen: compile, ...extra })))

  test('an entry has its snippet, diagram, real fix, the .clone() and its lessons, as headings a screen reader can walk', () => {
    const out = html('E0382')
    for (const h of ['The smallest case', 'The permission diagram', 'The real fix', 'The fix that tempts: .clone()', 'Taught in', 'Practice this error']) expect(out).toContain(h)
    expect(out).toContain('id="E0382"')
    expect(out).toContain('Permissions, line by line')
    expect(out).toContain('href="/lesson/r.l3"')
    expect(out).toContain('(the line rustc reports)')
    expect(out).toContain('line 3 removed')
    expect(out).toContain('line 3 added')
  })

  test('the permission sentence names the path and the permission it lost', () => {
    const e = ENTRIES.find((x) => x.code === 'E0382')!
    const out = html('E0382')
    expect(out).toContain('Read (R)')
    expect(out).toContain(`<code class="font-mono">${e.focus!.path}</code>`)
  })

  test('a code with no clone lure says "the fix that tempts" without claiming a clone', () => {
    const e = ENTRIES.find((x) => x.wrong && !x.wrong.clone)!
    const out = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ErrorEntry, { entry: e })))
    expect(out).toContain('The fix that tempts<')
    expect(out).not.toContain('The fix that tempts: .clone()')
  })

  test('without a practice source the entry shows no practice section', () => {
    const out = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ErrorEntry, { entry: ENTRIES[0] })))
    expect(out).not.toContain('Practice this error')
  })

  test('every entry renders without throwing and holds its code exactly once as an id', () => {
    for (const e of ENTRIES) {
      const out = html(e.code)
      expect(out.split(`id="${e.code}"`).length - 1).toBe(1)
    }
  })
})
