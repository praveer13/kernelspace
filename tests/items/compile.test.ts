import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { firstError, formatBank, panicOutcome } from '../../scripts/build-rust-items'
import { checkFamily, genSeeds, lintLiterals } from '../../scripts/verify-generators'
import { checkBanks, checkSnippets, compareSnippet, COMPILE_KCS as GRAPH_COMPILE_KCS, phoneProblems, quotaProblems, snippetHash, verdictQuota } from '../../scripts/verify-rust-items'
import { addsClone, CLONE_MISS, ERROR_CODES, loadRustGroups, MAX_COLS, MAX_LINES, variantCode } from '../../src/data/rust-items'
import type { BankFile, BankSnippet, RustGroup, RustSnippet } from '../../src/data/rust-items/types'
import { rs } from '../../src/data/rust-items/types'
import { partsText } from '../../src/lib/items/core'
import compile, { COMPILE_KCS, compileVariantId, MIN_POOL, POOLS, STALE, UNITS, unitOf } from '../../src/lib/items/families/compile'
import { correctResponse, gradeResponse } from '../../src/lib/items/grade'
import type { Instance, Level } from '../../src/lib/items/types'

const SEEDS = genSeeds(200)
const LEVELS: Level[] = [0, 1, 2, 3]
const FILE = new URL('../../src/lib/items/families/compile.ts', import.meta.url)
const GROUPS = await loadRustGroups()
const SEED = GROUPS.find((g) => g.id === 'seed')!

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const choice = (i: Instance) => {
  if (i.answer.kind !== 'choice') throw new Error('not a choice item')
  return i.answer
}
/** Every instance of a variant over the seeds, at level 0. */
const instances = (variant: string): Instance[] => SEEDS.map((s) => compile.make(s, 0, variant))

/** A one-snippet group whose bank is what the authored outcomes say, for the checks to disagree with. */
function group(s: RustSnippet): RustGroup {
  const variants: BankSnippet['variants'] = {}
  for (const v of s.variants) {
    const result = v.expect === 'compiles' ? 'compiles' : { ...v.expect, message: 'm' }
    variants[v.id] = v.fixes ? { result, fixes: Object.fromEntries(v.fixes.map((f) => [f.id, f.ok || f.lure ? 'compiles' : { code: 'E0502', line: 1 }])) } : { result }
  }
  const bank: BankFile = { group: 'test', rustc: 'rustc 1.96.0 (ac68faa20 2026-05-25)', edition: '2024', snippets: { [s.id]: { hash: snippetHash(s), variants } } }
  return { id: 'test', snippets: [s], bank }
}

const SAMPLE: RustSnippet = {
  id: 'sample-push',
  kcs: ['r.borrow-rules'],
  title: 'Push while a slice is alive',
  domain: 'Request',
  base: rs`
    fn f(v: &mut Vec<u32>) {
        let first = v[0];
        v.push(1);
        println!("{first}");
    }
  `,
  variants: [
    { id: 'base', expect: 'compiles', why: 'A copy holds no borrow.' },
    {
      id: 'borrowed',
      edit: { line: 2, text: '    let first = &v[0];' },
      expect: { code: 'E0502', line: 3 },
      why: '`first` keeps `&` on `v` across the push, so `v` lacks W.',
      focus: { line: 3, path: 'v', needs: ['read', 'write'] },
      permission: 'write',
      fixes: [
        { id: 'copy', edit: { line: 2, text: '    let first = v[0];' }, ok: true, why: 'A copy holds no borrow.' },
        { id: 'clone', edit: { line: 3, text: '    v.clone().push(1);' }, ok: false, lure: 'clone', why: 'It pushes onto a copy.' },
        { id: 'mut', edit: { line: 2, text: '    let first = &mut v[0];' }, ok: false, why: 'A `&mut` borrow blocks the push too.' },
      ],
    },
  ],
}

describe('compile: the §5.6 suite', () => {
  test('passes at 100 seeds with no problems; the only warning is the deferred hash fixture', () => {
    const r = checkFamily(compile, { seeds: 100 })
    expect(r.problems).toEqual([])
    expect(r.warnings.every((w) => w.includes('deferred until the family'))).toBe(true)
  })

  test('its source passes the literal lint', () => {
    expect(lintLiterals(FILE.pathname, readFileSync(FILE, 'utf8'))).toEqual([])
  })

  test('is bank-backed with a deferred hash fixture until 2c-18 freezes the bank', () => {
    expect(compile.hashFixture).toBe('deferred')
    expect(compile.bank!.units).toBe(Math.min(...[...POOLS.values()].map((p) => p.length)))
    expect(compile.bank!.units).toBeGreaterThanOrEqual(MIN_POOL)
  })

  test("its KCs are exactly the graph's KCs whose gen lists compile", () => {
    expect([...COMPILE_KCS].sort()).toEqual([...GRAPH_COMPILE_KCS].sort())
    expect([...compile.kcs].sort()).toEqual([...GRAPH_COMPILE_KCS].sort())
  })

  test('make is a pure function of (seed, level, variant)', () => {
    for (const v of compile.variants) {
      for (const level of LEVELS) {
        const a = compile.make(SEEDS[3], level, v.id)
        expect(compile.make(SEEDS[3], level, v.id)).toEqual(a)
        expect(a.variant).toBe(v.id)
        expect(a.kcs).toEqual([...v.kcs])
      }
    }
  })

  test('every instance grades its own key ok', () => {
    for (const v of compile.variants) {
      for (const i of instances(v.id)) expect(compile.grade(i, correctResponse(i)).ok).toBe(true)
    }
  })
})

describe('compile: the bank', () => {
  test('the seed group holds 10 snippets, and every group passes the schema, bank and quota checks', () => {
    expect(SEED.snippets).toHaveLength(10)
    expect(checkSnippets(GROUPS)).toEqual([])
    expect(checkBanks(GROUPS)).toEqual([])
    expect(quotaProblems(verdictQuota(GROUPS))).toEqual([])
  })

  test('every authored variant is served: none is left out as stale', () => {
    expect(STALE).toEqual([])
    const variants = GROUPS.reduce((a, g) => a + g.snippets.reduce((b, s) => b + s.variants.length, 0), 0)
    expect(UNITS).toHaveLength(variants)
  })

  test('the seed group covers every compile KC but r.permissions, both build modes and every kind of item', () => {
    const kcs = new Set(SEED.snippets.flatMap((s) => s.kcs))
    expect([...kcs].sort()).toEqual(GRAPH_COMPILE_KCS.filter((k) => k !== 'r.permissions').sort())
    expect(SEED.snippets.some((s) => s.run)).toBe(true)
    expect(SEED.snippets.some((s) => !s.run)).toBe(true)
    const variants = SEED.snippets.flatMap((s) => s.variants)
    expect(variants.some((v) => v.permission)).toBe(true)
    expect(variants.some((v) => v.fixes)).toBe(true)
    // every snippet's base compiles, so each one is a working program first
    for (const s of SEED.snippets) expect(s.variants.find((v) => !v.edit)?.expect).toBe('compiles')
  })

  test('every group serves verdict, permission and fix items', () => {
    for (const g of GROUPS) {
      const served = new Set<string>()
      for (const [id, pool] of POOLS) if (pool.some((u) => u.key.startsWith(`${g.id}/`))) served.add(id.split('.')[0])
      expect([...served].sort()).toEqual(['fix', 'permission', 'verdict'])
    }
  })

  test('the hash changes with any part of a snippet, and a stale or wrong bank is reported', () => {
    const g = group(SAMPLE)
    expect(checkBanks([g])).toEqual([])
    const edited = clone(SAMPLE)
    edited.variants[1].fixes![0].why = 'A copy, so no borrow.'
    expect(snippetHash(edited)).not.toBe(snippetHash(SAMPLE))
    expect(compareSnippet(edited, g.bank!.snippets[SAMPLE.id], 'x').join('\n')).toContain('stale')

    const wrong = clone(g.bank!)
    wrong.snippets[SAMPLE.id].variants.borrowed.result = { code: 'E0499', line: 3, message: 'm' }
    expect(compareSnippet(SAMPLE, wrong.snippets[SAMPLE.id], 'x')).toEqual(['x/borrowed: authored E0502 at line 3, rustc gives E0499 at line 3'])

    const okFails = clone(g.bank!)
    okFails.snippets[SAMPLE.id].variants.borrowed.fixes!.copy = { code: 'E0502', line: 3 }
    expect(compareSnippet(SAMPLE, okFails.snippets[SAMPLE.id], 'x').join('\n')).toContain('the ok fix does not compile')

    const wrongCompiles = clone(g.bank!)
    wrongCompiles.snippets[SAMPLE.id].variants.borrowed.fixes!.mut = 'compiles'
    expect(compareSnippet(SAMPLE, wrongCompiles.snippets[SAMPLE.id], 'x').join('\n')).toContain('must be a labelled lure')

    expect(checkBanks([{ ...g, bank: { ...g.bank!, rustc: 'rustc 1.95.0 (x 2026-04-01)' } }]).join('\n')).toContain('not rustc 1.96.0')
    expect(checkBanks([{ ...g, bank: null }]).join('\n')).toContain('no bank/test.json')
  })

  test('the phone limits: 16 lines of 44 ASCII columns, no tabs', () => {
    expect(phoneProblems('x'.repeat(MAX_COLS))).toEqual([])
    expect(phoneProblems('x'.repeat(MAX_COLS + 1))).toEqual([`line 1 is ${MAX_COLS + 1} columns (max ${MAX_COLS})`])
    expect(phoneProblems(Array(MAX_LINES + 1).fill('x').join('\n'))).toEqual([`${MAX_LINES + 1} lines (max ${MAX_LINES})`])
    expect(phoneProblems('\tx')).toEqual(['line 1 has a tab'])
    expect(phoneProblems('let é = 1;')).toEqual(['line 1 has a non-ASCII character'])
    const wide = clone(SAMPLE)
    wide.variants[1].fixes![2].edit.text = `    let first = &mut v[0]; // ${'x'.repeat(30)}`
    expect(checkSnippets([group(wide)]).join('\n')).toContain('fix mut: line 2 is')
  })

  test('the permission labelling rule: a label is one of what the focus needs, on a code that lacks one permission', () => {
    const ok = checkSnippets([group(SAMPLE)])
    expect(ok).toEqual([])
    const notNeeded = clone(SAMPLE)
    notNeeded.variants[1].permission = 'own'
    expect(checkSnippets([group(notNeeded)]).join('\n')).toContain('permission own is not among what line 3 needs')
    const wrongCode = clone(SAMPLE)
    wrongCode.variants[1].expect = { code: 'E0499', line: 3 }
    expect(checkSnippets([group(wrongCode)]).join('\n')).toContain('E0499 takes no permission label')
    const ownOnWrite = clone(SAMPLE)
    ownOnWrite.variants[1].focus!.needs = ['read', 'own']
    ownOnWrite.variants[1].permission = 'own'
    expect(checkSnippets([group(ownOnWrite)]).join('\n')).toContain('E0502 labels read or write, not own')
    const noFocus = clone(SAMPLE)
    delete noFocus.variants[1].focus
    expect(checkSnippets([group(noFocus)]).join('\n')).toContain('a permission label needs a focus')
    const pathMissing = clone(SAMPLE)
    pathMissing.variants[1].focus!.path = 'w'
    expect(checkSnippets([group(pathMissing)]).join('\n')).toContain('does not appear on line 3')
    const permKc = clone(SAMPLE)
    permKc.kcs = ['r.permissions']
    expect(checkSnippets([group(permKc)]).join('\n')).toContain('assessed by permission items only')
  })

  test('the clone-lure rule: a fix that adds .clone() is a clone lure and never ok; Rc::clone is not a lure', () => {
    expect(addsClone('    v.push(1);', '    v.clone().push(1);')).toBe(true)
    expect(addsClone('    let a = x.clone();', '    let a = &x.clone();')).toBe(false)
    expect(addsClone('    let a = x;', '    let a = Rc::clone(&x);')).toBe(false)
    const okClone = clone(SAMPLE)
    okClone.variants[1].fixes![0] = { id: 'copy', edit: { line: 2, text: '    let first = v.clone()[0];' }, ok: true, why: 'A copy.' }
    expect(checkSnippets([group(okClone)]).join('\n')).toContain('never the ok fix')
    const unlabelled = clone(SAMPLE)
    delete unlabelled.variants[1].fixes![1].lure
    expect(checkSnippets([group(unlabelled)]).join('\n')).toContain("is marked lure: 'clone'")
    const twoOk = clone(SAMPLE)
    twoOk.variants[1].fixes![2].ok = true
    expect(checkSnippets([group(twoOk)]).join('\n')).toContain('exactly one fix is ok')
    // every authored clone fix in the bank follows the rule
    for (const g of GROUPS) {
      for (const s of g.snippets) {
        for (const v of s.variants) {
          for (const f of v.fixes ?? []) {
            const before = variantCode(s, v).split('\n')[f.edit.line - 1]
            expect(addsClone(before, f.edit.text)).toBe(f.lure === 'clone')
            if (f.lure) expect(f.ok).toBe(false)
          }
        }
      }
    }
  })

  test('the verdict quota: 20-30 % compile overall and at most 30 % in any KC pool', () => {
    const q = verdictQuota(GROUPS)
    expect(q.compiles / q.units).toBeGreaterThanOrEqual(0.2)
    expect(q.compiles / q.units).toBeLessThanOrEqual(0.3)
    expect(quotaProblems({ units: 10, compiles: 5, pools: {} })[0]).toContain('50.0 % of 10 verdict items')
    expect(quotaProblems({ units: 10, compiles: 2, pools: { 'r.slices': { units: 4, compiles: 2 } } })).toEqual(['verdict quota: 2 of the 4 verdict items on r.slices compile (max 30 %)'])
  })
})

describe('compile: rustc output', () => {
  const file = '/tmp/x/lib.rs'
  const diag = (o: object) => JSON.stringify(o)

  test('the first error: its code and primary line in the snippet, past warnings and the closing note', () => {
    const stderr = [
      diag({ message: 'unused variable', level: 'warning', code: { code: 'unused_variables' }, spans: [{ file_name: file, line_start: 2, is_primary: true }] }),
      diag({
        message: 'cannot borrow `v` as mutable because it is also borrowed as immutable',
        level: 'error',
        code: { code: 'E0502' },
        spans: [
          { file_name: file, line_start: 2, is_primary: false },
          { file_name: file, line_start: 3, is_primary: true },
        ],
      }),
      diag({ message: 'aborting due to 1 previous error', level: 'error', code: null, spans: [] }),
    ].join('\n')
    expect(firstError(stderr, file)).toEqual({ code: 'E0502', line: 3, message: 'cannot borrow `v` as mutable because it is also borrowed as immutable' })
  })

  test('an error inside a macro expansion is placed at the call site in the snippet', () => {
    const inner = { file_name: '/rustc/library/core/src/macros.rs', line_start: 900, is_primary: true, expansion: { span: { file_name: file, line_start: 7, is_primary: false } } }
    const stderr = diag({ message: 'borrow of moved value: `r`', level: 'error', code: { code: 'E0382' }, spans: [inner] })
    expect(firstError(stderr, file)).toEqual({ code: 'E0382', line: 7, message: 'borrow of moved value: `r`' })
    expect(firstError('', file)).toBeNull()
  })

  test("a RefCell panic is BorrowMutError or BorrowError at the snippet's line", () => {
    const main = '/tmp/x/main.rs'
    expect(panicOutcome("\nthread 'main' panicked at /tmp/x/main.rs:11:12:\nRefCell already borrowed\nnote: run with `RUST_BACKTRACE=1`", main)).toEqual({
      code: 'BorrowMutError',
      line: 11,
      message: 'RefCell already borrowed',
    })
    expect(panicOutcome("thread 'main' panicked at /tmp/x/main.rs:9:5:\nRefCell already mutably borrowed\n", main)?.code).toBe('BorrowError')
    expect(panicOutcome("thread 'main' panicked at /tmp/x/main.rs:4:5:\nindex out of bounds\n", main)?.code).toBe('panic')
  })

  test('the committed bank is byte-for-byte what formatBank writes, so --check can compare files', () => {
    const text = readFileSync(new URL('../../src/data/rust-items/bank/seed.json', import.meta.url), 'utf8')
    expect(formatBank(JSON.parse(text) as BankFile)).toBe(text)
  })
})

describe('compile: verdict items', () => {
  const verdicts = compile.variants.filter((v) => v.id.startsWith('verdict.'))

  test('a verdict variant per compile KC the bank covers, each drawing only snippets that list its KC', () => {
    expect(verdicts.length).toBeGreaterThanOrEqual(7)
    for (const v of verdicts) {
      const kc = v.kcs[0]
      expect(v.id).toBe(compileVariantId('verdict', kc))
      for (const i of instances(v.id)) expect(unitOf(i)!.snippet.kcs).toContain(kc)
    }
  })

  test('four distinct options: the key, "compiles" and codes the bank holds, each with a why', () => {
    const bankCodes = new Set(UNITS.flatMap((u) => (u.result === 'compiles' ? [] : [u.result.code])))
    for (const v of verdicts) {
      for (const i of instances(v.id)) {
        const a = choice(i)
        const u = unitOf(i)!
        expect(a.options).toHaveLength(4)
        expect(new Set(a.options.map((o) => o.id)).size).toBe(4)
        expect(a.correct).toEqual([u.result === 'compiles' ? 'compiles' : u.result.code])
        expect(a.options.map((o) => o.id)).toContain('compiles')
        for (const o of a.options) {
          expect(o.why.length).toBeGreaterThan(20)
          if (o.id !== 'compiles') expect(bankCodes.has(o.id) && o.id in ERROR_CODES).toBe(true)
        }
      }
    }
  })

  test('the code is shown with numbered lines, and the key why quotes rustc', () => {
    const i = compile.make(SEEDS[0], 0, 'verdict.borrow-rules')
    const code = i.prompt.stem.find((p) => p.t === 'code')
    expect(code).toMatchObject({ t: 'code', lang: 'rust', lines: true, code: unitOf(i)!.code })
    const u = UNITS.find((x) => x.key === 'seed/block-table-first-block/borrow-first')!
    const hit = SEEDS.map((s) => compile.make(s, 0, 'verdict.borrow-rules')).find((x) => x.params.unit === u.key)!
    const key = choice(hit).options.find((o) => o.id === 'E0502')!
    expect(key.why).toContain('rustc reports E0502 at line 7: "cannot borrow `table.blocks` as mutable')
  })

  test('a run snippet offers its panic and says the program runs', () => {
    const i = instances('verdict.interior-mutability').find((x) => unitOf(x)!.variant.id === 'hold-ref')!
    const a = choice(i)
    expect(a.correct).toEqual(['BorrowMutError'])
    expect(a.options.find((o) => o.id === 'BorrowMutError')!.text).toBe('0 errors, then BorrowMutError')
    expect(a.options.find((o) => o.id === 'compiles')!.text).toBe('0 errors, runs to the end')
    expect(partsText(i.prompt.stem)).toContain('Build and run this program')
  })
})

describe('compile: permission items', () => {
  test('Read, Write and Own, of equal length, keyed by the authored label at the marked line', () => {
    const all = instances('permission')
    const lens = new Set(choice(all[0]).options.map((o) => o.text.length))
    expect(lens.size).toBe(1)
    for (const i of all) {
      const u = unitOf(i)!
      const a = choice(i)
      expect(a.options.map((o) => o.id)).toEqual(['read', 'write', 'own'])
      expect(a.correct).toEqual([u.variant.permission!])
      expect(i.prompt.stem.find((p) => p.t === 'code')).toMatchObject({ mark: u.variant.focus!.line, lines: true })
      expect(partsText(i.prompt.stem)).toContain(`\`${u.variant.focus!.path}\``)
    }
    // the pool is exactly the labelled variants of the bank (each content group adds its own), and the seeds draw only from it
    const labelled = UNITS.filter((u) => u.variant.permission).map((u) => u.key)
    expect(new Set(POOLS.get('permission')!.map((u) => u.key))).toEqual(new Set(labelled))
    for (const i of all) expect(labelled).toContain(i.params.unit as string)
  })

  test('a wrong pick says what the path still holds, or that the line does not need it', () => {
    const i = instances('permission').find((x) => x.params.unit === 'seed/block-table-first-block/borrow-first')!
    const a = choice(i)
    expect(a.options.find((o) => o.id === 'read')!.why).toContain('still holds Read (R) at line 7; what it lacks is Write (W)')
    expect(a.options.find((o) => o.id === 'own')!.why).toContain('Line 7 does not need Own (O)')
  })
})

describe('compile: fix items', () => {
  const fixes = compile.variants.filter((v) => v.id.startsWith('fix.'))

  test('the authored fixes are the options, and the one ok fix is the key', () => {
    // a fix variant for every (kind, KC) pool the bank holds MIN_POOL units for; the content groups add pools
    expect(fixes.map((v) => v.id).sort()).toEqual([...POOLS.keys()].filter((id) => id.startsWith('fix.')).sort())
    expect(fixes.map((v) => v.id)).toEqual(expect.arrayContaining(['fix.borrow-rules', 'fix.ownership-moves']))
    for (const v of fixes) {
      for (const i of instances(v.id)) {
        const u = unitOf(i)!
        const a = choice(i)
        expect(a.options.map((o) => o.id)).toEqual(u.variant.fixes!.map((f) => f.id))
        expect(a.correct).toEqual([u.variant.fixes!.find((f) => f.ok)!.id])
        for (const o of a.options) expect(o.text).toMatch(/^line \d+: \S/)
      }
    }
  })

  test(`picking .clone() is diagnosed as ${CLONE_MISS}, and its why says what rustc did`, () => {
    const i = instances('fix.borrow-rules').find((x) => x.params.unit === 'seed/block-table-first-block/borrow-first')!
    const g = gradeResponse(i, { kind: 'choice', picks: ['clone-push'] })
    expect(g.ok).toBe(false)
    expect(g.diagnosis?.id).toBe(CLONE_MISS)
    expect(g.feedback).toContain('rustc accepts it, but it changes what the code does')
    const failing = gradeResponse(i, { kind: 'choice', picks: ['mut-first'] })
    expect(failing.feedback).toContain('It still fails: rustc reports E0499 at line 7')
    expect(failing.diagnosis).toBeUndefined()
  })
})
