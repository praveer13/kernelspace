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
  discoverPrimm,
  pseudoLessonFailures,
  structureErrors,
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
    const labs = await discoverPrimm(forge)
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
      const labs = await discoverPrimm(pathToFileURL(root))
      expect(labs.map((l) => l.lab)).toEqual(['lab-a', 'lab-b'])
      expect(labs.map((l) => l.items[0].id)).toEqual(['a.1', 'b.1'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a missing directory is no pool, not a crash', async () => {
    expect(await discoverPrimm(pathToFileURL(join(tmpdir(), 'no-such-forge-dir')))).toEqual([])
  })
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
    for (const pool of ['prequestion', 'predictAt', 'spiral', 'align', 'primm']) expect(out).toMatch(new RegExp(`^  ${pool}\\s+\\d+`, 'm'))
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
