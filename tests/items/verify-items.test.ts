import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import { ALL_LESSONS } from '../../src/data/lessons'
import type { Lesson } from '../../src/data/lessons/types'
import {
  alwaysBBand,
  ALIGN_POOL,
  barFailures,
  barLine,
  checkPoolItems,
  collectAlignItems,
  collectIsoItems,
  collectTwinItems,
  discoverPrimm,
  discoverTwins,
  ISO_POOL,
  parseSubset,
  pseudoLessonFailures,
  structureErrors,
  SUBSET_MARGIN,
  SUBSET_MIN_N,
  subsetReport,
  TWIN_POOL,
  WAVE2_BAR,
} from '../../scripts/item-pools'
import { CUE_STRATEGIES, collectOwnPools, MAX_RANK_LESSON, passProbability, poolCueFailures, RANK_STRATEGIES, type CueQuestion } from '../../scripts/item-cues'

/**
 * verify-items v2 (spec §6.5, 2a-18): the pools it collects, the item rules per pool, the Wave 2 bar and the always-B band.
 * The pure code is scripts/item-pools.ts; the end-to-end checks run the script itself.
 */

const WHY = ['the key, and why', 'a lure: the slip it encodes', 'a lure: another slip', 'a lure: a third slip']
/** A four-option choice item whose option lengths follow `lens` and whose key sits at `key`. */
const item = (lens: number[], key: number, why: string[] | null = WHY): QuizQuestion => ({
  q: 'Which Rust line does the compiler reject, and which permission is missing?',
  options: lens.map((l, i) => `${String.fromCharCode(97 + i)}${'x'.repeat(l - 1)}`),
  correct: [key],
  ...(why ? { why } : {}),
})
/** A lesson with the given blocks, as far as the collectors read it. */
const lessonOf = (id: string, blocks: unknown[]): Lesson => ({ id, blocks }) as unknown as Lesson
const codeWith = (align: QuizQuestion[]) => ({ type: 'code', code: 'let a = 1', lang: 'rust', align })

describe('alignment items on code blocks (CodeBlockData.align, spec 17.2) are a pool of their own', () => {
  test('every align item of every code block is collected, with the ref item:<lesson>.align.<n>', () => {
    const lessons = [
      lessonOf('r.l3', [{ type: 'prose' }, codeWith([item([40, 50, 60, 70], 1), item([40, 50, 60, 70], 2)]), codeWith([item([40, 50, 60, 70], 0)])]),
      lessonOf('r.l4', [codeWith([]), { type: 'code', code: 'no align' }]),
      lessonOf('r.l8', [codeWith([item([40, 50, 60, 70], 3)])]),
    ]
    const pool = collectAlignItems(lessons)
    expect(pool.map((p) => p.ref)).toEqual(['item:r.l3.align.1', 'item:r.l3.align.2', 'item:r.l3.align.3', 'item:r.l8.align.1'])
    expect(pool.every((p) => p.pool === ALIGN_POOL)).toBe(true)
    expect(pool.map((p) => p.lessonId)).toEqual(['r.l3', 'r.l3', 'r.l3', 'r.l8'])
  })

  test('a fixture with an align item that has no why per option fails', () => {
    const lessons = [lessonOf('r.l3', [codeWith([item([40, 50, 60, 70], 1, null)])])]
    const { valid, failures } = checkPoolItems(collectAlignItems(lessons))
    expect(valid).toEqual([])
    expect(failures).toEqual(['structure: item:r.l3.align.1 (align): missing per-option why'])
  })

  test('a why that does not cover every option, or has an empty entry, fails', () => {
    const short = checkPoolItems(collectAlignItems([lessonOf('r.l3', [codeWith([item([40, 50, 60, 70], 1, ['only one'])])])]))
    expect(short.failures[0]).toContain('why has 1 entries for 4 options')
    const blank = checkPoolItems(collectAlignItems([lessonOf('r.l3', [codeWith([item([40, 50, 60, 70], 1, ['a', ' ', 'c', 'd'])])])]))
    expect(blank.failures[0]).toContain('why has an empty entry')
  })

  test('an align item with a why per option is valid', () => {
    const { valid, failures } = checkPoolItems(collectAlignItems([lessonOf('r.l3', [codeWith([item([40, 50, 60, 70], 1)])])]))
    expect(failures).toEqual([])
    expect(valid).toHaveLength(1)
  })

  test('the item-level cue rules apply to the pool: a key that is always the second-longest option fails, and an isolated key is named', () => {
    const lessons = [lessonOf('r.l3', [codeWith(Array.from({ length: 6 }, () => item([52, 46, 40, 34], 1)))])]
    const pool = collectAlignItems(lessons)
    const problems = poolCueFailures(ALIGN_POOL, pool)
    expect(problems.some((p) => p.includes("'2nd-longest' hits 100.0% of the 6 align items on their own"))).toBe(true)
    const isolated = item([52, 46, 40, 34], 0)
    isolated.options[0] += ' (see 3)'
    expect(poolCueFailures(ALIGN_POOL, [{ ref: 'item:r.l3.align.1', q: isolated }]).some((p) => p.startsWith('odd-one-out: align item:r.l3.align.1') && /parenthetical/.test(p))).toBe(true)
  })

  test('the shipped lessons have none until Wave 2c, and every one added later must carry a why', () => {
    const shipped = collectAlignItems(ALL_LESSONS)
    expect(checkPoolItems(shipped).failures).toEqual([])
    for (const e of shipped) expect(e.q.why?.length).toBe(e.q.options.length)
  })

  test('structureErrors still names the Wave 1 defects', () => {
    expect(structureErrors({ q: 's', options: ['a'], correct: [0] }, false)).toContain('fewer than 2 options')
    expect(structureErrors({ q: 's', options: ['a', 'a'], correct: [0] }, false)).toContain('duplicate option text')
    expect(structureErrors({ q: 's', options: ['a', 'b'], correct: [2] }, false)).toContain('correct index out of range')
    expect(structureErrors({ q: 's', options: ['a', 'b'], correct: [0] }, true)).toContain('missing or empty explanation')
  })
})

describe('every PRIMM_MC_ITEMS list under src/data/forge is found by readdir', () => {
  const forge = new URL('../../src/data/forge/', import.meta.url)

  test('lab 01 is found today, with its multiple-choice items', async () => {
    const { found: labs, problems } = await discoverPrimm(forge)
    expect(problems).toEqual([])
    const lab = labs.find((l) => l.lab === 'rust-allocator')
    expect(lab?.items.length).toBeGreaterThanOrEqual(5)
    for (const i of lab?.items ?? []) expect(i.q.why?.length).toBe(i.q.options.length)
  })

  test('a lab added later joins without a code change; a lab with no primm.ts or no list is not a pool', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-'))
    try {
      const body = (id: string) => `export const PRIMM_MC_ITEMS = [{ id: '${id}', q: { q: 's', options: ['a', 'b'], correct: [0], why: ['x', 'y'] } }]\n`
      for (const [dir, src] of [
        ['lab-b', body('b.1')],
        ['lab-a', body('a.1')],
        ['lab-none', 'export const OTHER = 1\n'],
      ] as const) {
        mkdirSync(join(root, dir))
        writeFileSync(join(root, dir, 'primm.ts'), src)
      }
      mkdirSync(join(root, 'lab-empty'))
      writeFileSync(join(root, 'lab-empty', 'ladder.ts'), 'export const X = 1\n')
      const { found: labs, problems } = await discoverPrimm(pathToFileURL(root))
      expect(problems).toEqual([])
      expect(labs.map((l) => l.lab)).toEqual(['lab-a', 'lab-b'])
      expect(labs.map((l) => l.items[0].id)).toEqual(['a.1', 'b.1'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a missing directory is no pool, not a crash', async () => {
    expect(await discoverPrimm(pathToFileURL(join(tmpdir(), 'no-such-forge-dir')))).toEqual({ found: [], problems: [] })
  })

  test('a primm.ts that throws on import, or exports a list that is not an array, is a reported problem, and the other labs still load', async () => {
    const root = mkdtempSync(join(tmpdir(), 'forge-'))
    try {
      for (const [dir, src] of [
        ['lab-ok', "export const PRIMM_MC_ITEMS = [{ id: 'ok.1', q: { q: 's', options: ['a', 'b'], correct: [0], why: ['x', 'y'] } }]\n"],
        ['lab-throws', 'throw new Error("primm boom")\n'],
        ['lab-syntax', 'export const PRIMM_MC_ITEMS = [\n'],
        ['lab-notlist', 'export const PRIMM_MC_ITEMS = 7\n'],
      ] as const) {
        mkdirSync(join(root, dir))
        writeFileSync(join(root, dir, 'primm.ts'), src)
      }
      const { found, problems } = await discoverPrimm(pathToFileURL(root))
      expect(found.map((l) => l.lab)).toEqual(['lab-ok'])
      expect(problems).toHaveLength(3)
      expect(problems.find((p) => p.includes('lab-throws/primm.ts'))).toContain('primm boom')
      expect(problems.find((p) => p.includes('lab-syntax/primm.ts'))).toContain('failed to import')
      expect(problems.find((p) => p.includes('lab-notlist/primm.ts'))).toContain('not an array')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const isoWith = (breakItem: QuizQuestion | undefined, kcs?: string[]) => ({ type: 'isomorphism', pairs: [], ...(breakItem ? { breakItem } : {}), ...(kcs ? { kcs } : {}) })

describe('P3 break items (IsomorphismBlock.breakItem) are the iso pool', () => {
  test('every break item is collected with the ref item:<lesson>.iso.<n>.break, n counting the lesson isomorphism blocks from 1', () => {
    const lessons = [
      { ...lessonOf('t2.l2', [isoWith(item([40, 50, 60, 70], 1)), { type: 'prose' }, isoWith(item([40, 50, 60, 70], 2))]), kcs: ['t2.paging'] },
      lessonOf('t2.l3', [isoWith(undefined), isoWith(item([40, 50, 60, 70], 0), ['t2.block-table'])]),
      lessonOf('t2.l4', [{ type: 'quiz', questions: [] }]),
    ] as Lesson[]
    const pool = collectIsoItems(lessons)
    // a block without a break item keeps its number: t2.l3's second block is iso.2, as the lesson records it
    expect(pool.map((p) => p.ref)).toEqual(['item:t2.l2.iso.1.break', 'item:t2.l2.iso.2.break', 'item:t2.l3.iso.2.break'])
    expect(pool.every((p) => p.pool === ISO_POOL)).toBe(true)
    expect(pool.map((p) => p.lessonId)).toEqual(['t2.l2', 't2.l2', 't2.l3'])
    // the block's KCs, else the lesson's
    expect(pool.map((p) => p.kcs)).toEqual([['t2.paging'], ['t2.paging'], ['t2.block-table']])
  })

  test('a break item without a why per option fails; with one it is valid', () => {
    const bad = checkPoolItems(collectIsoItems([lessonOf('t2.l2', [isoWith(item([40, 50, 60, 70], 1, null))])]))
    expect(bad.valid).toEqual([])
    expect(bad.failures).toEqual(['structure: item:t2.l2.iso.1.break (iso): missing per-option why'])
    const short = checkPoolItems(collectIsoItems([lessonOf('t2.l2', [isoWith(item([40, 50, 60, 70], 1, ['only one']))])]))
    expect(short.failures[0]).toContain('why has 1 entries for 4 options')
    const good = checkPoolItems(collectIsoItems([lessonOf('t2.l2', [isoWith(item([40, 50, 60, 70], 1))])]))
    expect(good.failures).toEqual([])
    expect(good.valid).toHaveLength(1)
  })

  test('the cue limits and the odd-one-out apply to the pool', () => {
    const pool = collectIsoItems([lessonOf('t2.l2', Array.from({ length: 6 }, () => isoWith(item([52, 46, 40, 34], 1))))])
    expect(poolCueFailures(ISO_POOL, pool).some((p) => p.includes("'2nd-longest' hits 100.0% of the 6 iso items on their own"))).toBe(true)
    const isolated = item([52, 46, 40, 34], 0)
    isolated.options[0] += ' (see 3)'
    expect(poolCueFailures(ISO_POOL, [{ ref: 'item:t2.l2.iso.1.break', q: isolated }]).some((p) => p.startsWith('odd-one-out: iso item:t2.l2.iso.1.break'))).toBe(true)
  })

  test('the shipped lessons: every break item that exists carries a why per option', () => {
    expect(checkPoolItems(collectIsoItems(ALL_LESSONS)).failures).toEqual([])
  })
})

describe('production twins (src/data/twins/<lab>.ts TWIN_ITEMS) are the twin pool, found by readdir', () => {
  const twinBody = (labNo: string | null, ids: string[]) =>
    `${labNo ? `export default { labNo: '${labNo}' }\n` : ''}export const TWIN_ITEMS = [${ids.map((id) => `{ id: '${id}', kcs: ['k'], q: { q: 's', options: ['a', 'b'], correct: [0], why: ['x', 'y'] } }`).join(', ')}]\n`

  test('a twin file joins without a code change; the registry, types and files with no list are not twins', async () => {
    const root = mkdtempSync(join(tmpdir(), 'twins-'))
    try {
      writeFileSync(join(root, 'radix-cache.ts'), twinBody('07', ['a', 'b', 'c']))
      writeFileSync(join(root, 'batching-scheduler.ts'), twinBody('06', ['d']))
      writeFileSync(join(root, 'unnumbered.ts'), twinBody(null, ['e']))
      writeFileSync(join(root, 'no-list.ts'), 'export const OTHER = 1\n')
      writeFileSync(join(root, 'broken.ts'), 'throw new Error("does not load")\n')
      writeFileSync(join(root, 'index.ts'), twinBody('99', ['registry']))
      writeFileSync(join(root, 'types.ts'), twinBody('98', ['types']))
      mkdirSync(join(root, 'sub'))
      writeFileSync(join(root, 'sub', 'nested.ts'), twinBody('97', ['nested']))
      const { found: twins, problems } = await discoverTwins(pathToFileURL(root))
      // broken.ts throws on import: it is a problem, not a silent skip
      expect(problems).toEqual([expect.stringContaining('twins/broken.ts failed to import')])
      expect(problems[0]).toContain('does not load')
      expect(twins.map((t) => [t.lab, t.labNo, t.items.length])).toEqual([
        ['batching-scheduler', '06', 1],
        ['radix-cache', '07', 3],
        ['unnumbered', 'unnumbered', 1],
      ])
      const pool = collectTwinItems(twins)
      expect(pool.map((p) => p.ref)).toEqual(['item:lab06.twin.1', 'item:lab07.twin.1', 'item:lab07.twin.2', 'item:lab07.twin.3', 'item:labunnumbered.twin.1'])
      expect(pool.every((p) => p.pool === TWIN_POOL && p.kcs?.[0] === 'k')).toBe(true)
      expect(pool.map((p) => p.lessonId).slice(1, 3)).toEqual(['radix-cache', 'radix-cache'])
      expect(checkPoolItems(pool).failures).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a missing directory is no pool, not a crash; a twin question without a why per option fails', async () => {
    expect(await discoverTwins(pathToFileURL(join(tmpdir(), 'no-such-twins-dir')))).toEqual({ found: [], problems: [] })
    const bare = collectTwinItems([{ lab: 'radix-cache', labNo: '07', items: [{ id: 'a', q: item([40, 50, 60, 70], 1, null) }] }])
    expect(checkPoolItems(bare).failures).toEqual(['structure: item:lab07.twin.1 (twin): missing per-option why'])
  })

  test('a twin module that throws on import, or exports a TWIN_ITEMS that is not an array, is a problem and never leaves the pool unseen', async () => {
    const root = mkdtempSync(join(tmpdir(), 'twins-'))
    try {
      writeFileSync(join(root, 'good.ts'), twinBody('01', ['a']))
      writeFileSync(join(root, 'throws.ts'), `${twinBody('02', ['b'])}throw new Error('twin boom')\n`)
      writeFileSync(join(root, 'not-list.ts'), 'export const TWIN_ITEMS = { id: "a" }\n')
      const { found, problems } = await discoverTwins(pathToFileURL(root))
      expect(found.map((t) => t.lab)).toEqual(['good'])
      expect(problems).toHaveLength(2)
      expect(problems.find((p) => p.includes('twins/throws.ts'))).toContain('twin boom')
      expect(problems.find((p) => p.includes('twins/not-list.ts'))).toContain('not an array')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the shipped twins load without a problem', async () => {
    expect((await discoverTwins(new URL('../../src/data/twins/', import.meta.url))).problems).toEqual([])
  })

  test('the cue limits apply to the pool', () => {
    const pool = collectTwinItems([{ lab: 'radix-cache', labNo: '07', items: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, q: item([52, 46, 40, 34], 1) })) }])
    expect(poolCueFailures(TWIN_POOL, pool).some((p) => p.includes("'2nd-longest' hits 100.0% of the 6 twin items on their own"))).toBe(true)
  })
})

describe('--subset: the selector', () => {
  const matching = (selector: string, refs: string[]) => {
    const parsed = parseSubset(selector)
    if ('error' in parsed) throw new Error(parsed.error)
    return refs.filter(parsed.matches)
  }
  const refs = ['t2.l2 q1', 't2.l3 q1', 'forge/kv-block-manager lab02.primm.p1', 'forge/kv-block-manager-2 x', 'item:lab07.twin.1', 'item:t2.l2.iso.1.break', 'item:t4.l6.iso.3.break', 'item:t10.l1.iso.1.break']

  test('a comma-separated list of ref prefixes', () => {
    expect(matching('t2.l2 q,item:lab07.twin.', refs)).toEqual(['t2.l2 q1', 'item:lab07.twin.1'])
    expect(matching('t2.l2 q, item:lab07.twin.', refs)).toEqual(['t2.l2 q1', 'item:lab07.twin.1'])
  })

  test('a trailing space is part of the prefix: the PRIMM selector of a lab does not select its neighbour', () => {
    expect(matching('forge/kv-block-manager ', refs)).toEqual(['forge/kv-block-manager lab02.primm.p1'])
    expect(matching('forge/kv-block-manager', refs)).toHaveLength(2)
  })

  test('one /regex/ is matched against the whole printed ref, and a regex over iso refs works', () => {
    expect(matching('/^item:t[0-2]\\.l[0-9]+\\.iso\\./', refs)).toEqual(['item:t2.l2.iso.1.break'])
    expect(matching('/^item:t[3-7]\\.l[0-9]+\\.iso\\./', refs)).toEqual(['item:t4.l6.iso.3.break'])
    expect(matching('/ISO\\.1/i', refs)).toEqual(['item:t2.l2.iso.1.break', 'item:t10.l1.iso.1.break'])
  })

  test('an empty selector and a regex that does not compile are errors, not an empty match', () => {
    expect(parseSubset('')).toHaveProperty('error')
    expect(parseSubset(' , ,')).toHaveProperty('error')
    expect(parseSubset('/(/')).toHaveProperty('error')
  })
})

describe('--subset: the margin report', () => {
  /** n items whose key is always the second-longest option: 2nd-longest hits every one. */
  const leaking = (n: number) => Array.from({ length: n }, (_, i) => ({ ref: `item:t2.l2.iso.${i + 1}.break`, q: item([52, 46, 40, 34], 1), adv: 0.25 }))
  const balanced = (n: number) => Array.from({ length: n }, (_, i) => ({ ref: `item:t2.l2.iso.${i + 1}.break`, q: item([52, 46, 40, 34], i % 4), adv: 0.25 }))

  test('an empty subset fails', () => {
    const r = subsetReport([], CUE_STRATEGIES)
    expect(r.selected).toBe(0)
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0]).toContain('matches no item')
  })

  test('below n = 12 the rates are reported and nothing fails, however far over', () => {
    const r = subsetReport(leaking(SUBSET_MIN_N - 1), CUE_STRATEGIES)
    expect(r.n).toBe(11)
    expect(r.judged).toBe(false)
    expect(r.failures).toEqual([])
    expect(r.rows.find((x) => x.name === '2nd-longest')?.hit).toBe(1)
    expect(r.rows).toHaveLength(CUE_STRATEGIES.length)
    expect(r.rows.some((x) => x.over)).toBe(false)
  })

  test('at n = 12 a strategy above chance + 10 points fails, and the failure names it', () => {
    const r = subsetReport(leaking(SUBSET_MIN_N), CUE_STRATEGIES)
    expect(r.judged).toBe(true)
    expect(r.failures.some((f) => f.includes("'2nd-longest' hits 100.0% of the 12 items (chance 25.0% + 10 points = 35.0%)"))).toBe(true)
    expect(r.rows.find((x) => x.name === '2nd-longest')?.over).toBe(true)
  })

  test('the adversary is held to the same margin', () => {
    const r = subsetReport(balanced(12).map((i) => ({ ...i, adv: 0.5 })), CUE_STRATEGIES)
    expect(r.adversary.over).toBe(true)
    expect(r.failures.filter((f) => f.includes("'adversary'"))).toHaveLength(1)
    expect(subsetReport(balanced(12), CUE_STRATEGIES).failures).toEqual([])
  })

  test('a hit rate at chance passes and one just over the margin fails (the comparison of the gates is strict)', () => {
    expect(subsetReport(balanced(12).map((i) => ({ ...i, adv: 0.25 })), []).adversary.over).toBe(false)
    expect(subsetReport(balanced(12).map((i) => ({ ...i, adv: 0.36 })), []).adversary.over).toBe(true)
    expect(SUBSET_MARGIN).toBe(0.1)
  })

  test('multi-select items are not single-key: they do not count toward n', () => {
    const multi = { ref: 'item:x', q: { ...item([52, 46, 40, 34], 1), correct: [0, 1], multi: true }, adv: 0 }
    const r = subsetReport([...leaking(SUBSET_MIN_N - 1), multi], CUE_STRATEGIES)
    expect(r.selected).toBe(12)
    expect(r.n).toBe(11)
    expect(r.judged).toBe(false)
  })

  test('the stem-overlap strategies skip items whose stem is telemetry', () => {
    const r = subsetReport(leaking(4).map((i) => ({ ...i, stemless: true })), CUE_STRATEGIES)
    expect(r.rows.find((x) => x.name === 'stem-overlap')?.n).toBe(0)
    expect(r.rows.find((x) => x.name === '2nd-longest')?.n).toBe(4)
  })
})

describe('verify-items --subset, end to end', () => {
  const root = new URL('../../', import.meta.url).pathname
  const run = (...args: string[]) => {
    const r = Bun.spawnSync(['bun', 'scripts/verify-items.ts', ...args], { cwd: root })
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }
  }

  test('a PRIMM subset selects at least one item and passes below n = 12', () => {
    const r = run('--subset', 'forge/kv-block-manager ')
    expect(r.code).toBe(0)
    const n = Number(/: (\d+) item\(s\) selected/.exec(r.out)?.[1])
    expect(n).toBeGreaterThanOrEqual(1)
    expect(r.out).toContain('selected by pool: forge')
    expect(r.out).toMatch(/^ {2}adversary\s+\d+/m)
    expect(r.out).toMatch(/^ {2}2nd-longest\s+\d+/m)
    expect(r.out.trimEnd().endsWith('verify-items --subset: ok')).toBe(true)
    // only the subset report is printed, never the full tables
    expect(r.out).not.toContain('verify-items report')
  }, 60_000)

  test('an empty subset exits 1 and says why', () => {
    const r = run('--subset', 'no-such-ref-prefix ')
    expect(r.code).toBe(1)
    expect(r.err).toContain('the selector matches no item')
  }, 60_000)

  test('a regex subset works end to end (alignment refs are 1-based in the pool)', () => {
    const r = run('--subset', '/^item:r\\.l[0-9]+\\.align\\.1$/')
    expect(r.code).toBe(0)
    expect(r.out).toContain('selected by pool: align')
    const lessons = ALL_LESSONS.filter((l) => l.id.startsWith('r.') && l.blocks.some((b) => b.type === 'code' && (b.align?.length ?? 0) > 0)).length
    expect(r.out).toContain(`${lessons} item(s) selected`)
  }, 60_000)

  test('a malformed regex, and --subset beside --update-baseline, exit 1', () => {
    expect(run('--subset', '/(/').code).toBe(1)
    expect(run('--subset', 'r.l', '--update-baseline').code).toBe(1)
  }, 60_000)

  /** Run a callback with a temporary twins directory holding `files`; the script reads it in place of src/data/twins (VERIFY_ITEMS_TWINS_DIR). */
  const withTwins = (files: Record<string, string>, fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), 'twins-e2e-'))
    try {
      for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src)
      fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const runIn = (dir: string, ...args: string[]) => {
    const r = Bun.spawnSync(['bun', 'scripts/verify-items.ts', ...args], { cwd: root, env: { ...process.env, VERIFY_ITEMS_TWINS_DIR: dir } })
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }
  }
  /** Lab 99's module: `n` twin questions over four options. `lengths(i)` gives the option lengths, the key is at `keyAt(i)`. */
  const twinFixture = (n: number, lengths: (i: number) => number[], keyAt: (i: number) => number) =>
    `export default { labNo: '99' }\nexport const TWIN_ITEMS = ${JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        id: `fix.${i}`,
        kcs: ['k'],
        q: {
          q: `Fixture question ${i}`,
          options: lengths(i).map((len, o) => `${'abcd'[o]}${'x'.repeat(len - 1)}`),
          correct: [keyAt(i)],
          why: ['the key', 'a lure', 'another lure', 'a third lure'],
        },
      })),
    )}\n`

  test('a subset of n >= 12 over the margin exits 1 (fixture: 14 twin items whose key is always the longest option)', () => {
    withTwins({ 'lab99.ts': twinFixture(14, () => [30, 22, 20, 18], () => 0) }, (dir) => {
      const r = runIn(dir, '--subset', 'item:lab99.twin.')
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/n = 14 single-key/)
      expect(r.out).toContain('FAIL')
      // the longest-option strategy hits 14 of 14 against 25 % chance: over the 35 % line, which the failure names
      expect(r.err).toContain("subset: '1st-longest' hits 100.0% of the 14 items (chance 25.0% + 10 points = 35.0%)")
    })
  }, 60_000)

  test('a subset of n >= 12 at chance passes (fixture: equal lengths, the key rotating over the four positions)', () => {
    withTwins({ 'lab99.ts': twinFixture(12, () => [20, 20, 20, 20], (i) => i % 4) }, (dir) => {
      const r = runIn(dir, '--subset', 'item:lab99.twin.')
      expect(r.out).toMatch(/n = 12 single-key/)
      expect(r.err).not.toContain('subset: ')
      expect(r.code).toBe(0)
    })
  }, 60_000)

  test('a twin module that throws on import fails the run and a --subset run, naming the file and the error', () => {
    withTwins({ 'lab99.ts': twinFixture(12, () => [20, 20, 20, 20], (i) => i % 4), 'broken.ts': 'throw new Error("twin boom")\n' }, (dir) => {
      for (const args of [[], ['--subset', 'item:lab99.twin.']]) {
        const r = runIn(dir, ...args)
        expect(r.code, args.join(' ') || 'full run').toBe(1)
        expect(r.err).toContain('twins/broken.ts failed to import')
        expect(r.err).toContain('twin boom')
      }
    })
  }, 120_000)
})

describe('pseudo-lessons (a spiral, a lab, an Act IV fault) are held to the per-lesson bar by every strategy', () => {
  test('eight items whose key is always the second-longest option are passed by 2nd-longest at p = 1', () => {
    const items: CueQuestion[] = Array.from({ length: 8 }, () => item([52, 46, 40, 34], 1))
    const problems = pseudoLessonFailures('t3.l7 spiral', items, CUE_STRATEGIES)
    expect(problems.some((p) => p.includes("t3.l7 spiral is passed with p=1.00 by the strategy '2nd-longest'"))).toBe(true)
  })

  test('keys spread over the ranks pass', () => {
    const items: CueQuestion[] = [0, 1, 2, 3, 0, 1, 2, 3].map((rank) => item([52, 46, 40, 34], rank))
    expect(pseudoLessonFailures('t3.l7 spiral', items, CUE_STRATEGIES)).toEqual([])
  })

  test('an empty pseudo-lesson says nothing', () => {
    expect(pseudoLessonFailures('x', [], CUE_STRATEGIES)).toEqual([])
  })
})

describe('the Wave 2 bar: every strategy passes at most 2 of the lesson pool in expectation', () => {
  test('the bar is 2, and the line reads "Wave 2 bar: ≤ 2 of 68"', () => {
    expect(WAVE2_BAR).toBe(2)
    expect(barLine(68)).toBe('Wave 2 bar: ≤ 2 of 68')
  })

  test('a strategy above the bar fails, one at the bar passes, whatever its family', () => {
    const failures = barFailures(
      [
        { family: 'surface', name: 'fewest-words', expected: 2.01 },
        { family: 'blind', name: 'always-B', expected: 2 },
        { family: 'length-rank', name: 'middle-length', expected: 1.49 },
      ],
      68,
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain("surface 'fewest-words' passes 2.01 of 68 lessons")
    expect(failures[0]).toContain('Wave 2 bar: ≤ 2 of 68')
  })

  test('a pool whose keys all sit at the middle ranks is over the bar at the lesson level (the rule is a gate, not a printed line)', () => {
    // 68 lessons of five items; in 50 of them every key sits at a middle length rank, so a learner who picks between the middle options passes about 0.19 of each
    const lessons: CueQuestion[][] = Array.from({ length: 68 }, (_, i) => Array.from({ length: 5 }, (_, k) => item([52, 46, 40, 34], i < 50 ? 1 + ((i + k) % 2) : (i + k) % 4 === 1 ? 0 : 3)))
    const rows = RANK_STRATEGIES.map((s) => ({
      family: 'length-rank',
      name: s.name,
      expected: lessons.reduce((a, qs) => a + (qs.length ? passProbability(qs.map(s.pick)) : 0), 0),
    }))
    const failures = barFailures(rows, lessons.length)
    expect(failures.some((f) => f.includes("'middle-length'"))).toBe(true)
    expect(failures.every((f) => f.includes('of 68 lessons'))).toBe(true)
  })

  test('the shipped lesson pool is inside the bar for every strategy', () => {
    const lessons = ALL_LESSONS.map((l) => l.blocks.flatMap((b) => (b.type === 'quiz' ? b.questions : []))).filter((qs) => qs.length > 0)
    expect(lessons).toHaveLength(68)
    for (const s of [...RANK_STRATEGIES, ...CUE_STRATEGIES]) {
      const expected = lessons.reduce((a, qs) => a + passProbability(qs.map(s.pick)), 0)
      expect({ name: s.name, ok: expected <= WAVE2_BAR }).toEqual({ name: s.name, ok: true })
    }
  })
})

describe('always-B stays inside its 2-SD band', () => {
  const lessons = ALL_LESSONS.map((l) => l.blocks.flatMap((b) => (b.type === 'quiz' ? b.questions : []))).filter((qs) => qs.length > 0)

  test('on the shipped quizzes, through the real shuffle', () => {
    const r = alwaysBBand(lessons)
    expect(r.inside).toBe(true)
    expect(r.expected).toBeLessThan(WAVE2_BAR)
    expect(Math.abs(r.simulated - r.expected)).toBeLessThanOrEqual(2 * r.se)
  })

  test('a shuffle that leaves the options in authored order is caught when keys sit at position B', () => {
    // 20 lessons of five items with every key authored at index 1: no shuffle passes them with p > 0.003, authored order passes them all
    const pinned: CueQuestion[][] = Array.from({ length: 20 }, () => Array.from({ length: 5 }, () => item([40, 52, 46, 34], 1)))
    const identity = (n: number) => Array.from({ length: n }, (_, i) => i)
    expect(alwaysBBand(pinned, 200, identity).inside).toBe(false)
    expect(alwaysBBand(pinned, 2000).inside).toBe(true)
  })

  test('it is deterministic', () => {
    expect(alwaysBBand(lessons.slice(0, 10), 100)).toEqual(alwaysBBand(lessons.slice(0, 10), 100))
  })
})

describe('verify-items collects every pool and prints the bar', () => {
  const src = readFileSync(new URL('../../scripts/verify-items.ts', import.meta.url), 'utf8')

  test('the script reads the pools through the shared collectors, and reads the PRIMM lists by readdir', () => {
    expect(src).toContain("from './item-pools'")
    expect(src).toContain('discoverPrimm(')
    expect(src).not.toContain("forge/rust-allocator/primm'")
    expect(src).toContain('collectAlignItems(ALL_LESSONS)')
    expect(src).toContain('collectOwnPools(ALL_LESSONS)')
    expect(src).toContain('barFailures(barRows')
    expect(src).toContain('alwaysBBand(')
    expect(src).toContain('pseudoLessonFailures(')
  })

  test('verify:items passes on this tree and prints the Wave 2 bar line, every pool and the always-B band', () => {
    const lessonsWithQuiz = ALL_LESSONS.filter((l) => l.blocks.some((b) => b.type === 'quiz')).length
    const run = Bun.spawnSync(['bun', 'scripts/verify-items.ts'], { cwd: new URL('../../', import.meta.url).pathname })
    const out = run.stdout.toString()
    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
    expect(out).toContain(barLine(lessonsWithQuiz))
    expect(out).toContain('always-B 2-SD band: exact')
    for (const pool of ['prequestion', 'predictAt', 'spiral', 'align', 'iso', 'twin', 'primm']) expect(out).toMatch(new RegExp(`^  ${pool}\\s+\\d+`, 'm'))
    expect(out.trimEnd().endsWith('verify-items: ok')).toBe(true)
    // a tree that passes every gate never prints FAIL in a table (F3: the own-pool row once did, by rounding at the limit)
    expect(out).not.toContain('FAIL')
  }, 60_000)

  test('the printed tables decide FAIL with the gate comparison (hit > chance + limit), never a difference', () => {
    // the rounding that made a passing PRIMM pool print FAIL: 40 % against 25 % chance and a 15-point limit
    expect(0.4 - 0.25 > 0.15).toBe(true)
    expect(0.4 > 0.25 + 0.15).toBe(false)
    expect(src).toContain('const overChance = (hit: number, chance: number): boolean => hit > chance + MAX_HIT_OVER_CHANCE')
    expect(src).not.toMatch(/\.hit - \w+\.chance > MAX_HIT_OVER_CHANCE/)
    expect(src).not.toContain('.some((d) => d > MAX_HIT_OVER_CHANCE)')
  })

  test('the own-pool lists of Wave 1 are unchanged: the alignment pool is added beside them, not inside item-cues', () => {
    expect(collectOwnPools(ALL_LESSONS).every((e) => ['prequestion', 'predictAt', 'spiral'].includes(e.pool))).toBe(true)
    expect(MAX_RANK_LESSON).toBe(0.5)
  })
})
