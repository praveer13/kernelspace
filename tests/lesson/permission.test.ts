/**
 * F4 infrastructure (docs/specs/wave-2.md §17.1-17.2, task 2c-05): permission traces, the diagram, the
 * extraction script's conversion, and alignment items.
 *
 * The gate: every lesson code block with `permissions: {trace}` has a committed trace whose sha256 is
 * the block's code, so editing a traced snippet without re-running scripts/aquascope/extract.ts fails
 * here (CI never runs Aquascope). The negative cases prove the check bites on a one-character edit.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AlignItem, { alignItem, alignResponse } from '../../src/components/lesson/AlignItem'
import { PermissionTable } from '../../src/components/lesson/PermissionDiagram'
import type { QuizQuestion } from '../../src/components/QuizBlock'
import {
  codeLines,
  traceProblems,
  traceShapeProblems,
  traceTable,
  type PermissionTrace,
  type PermissionTraceFile,
  type TracedBlock,
} from '../../src/data/aquascope/types'
import { ALL_LESSONS } from '../../src/data/lessons'
import { validateEvent } from '../../src/lib/ledger/codec'
import { gradeItem, playView, resultFor } from '../../src/lib/items/play'
import { formatTraceFile, pathAt, prepare, toTrace } from '../../scripts/aquascope/extract'
import { evt } from '../ledger/gen'

const DIR = path.resolve(import.meta.dir, '../../src/data/aquascope')
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const readFile = (name: string): PermissionTraceFile | undefined => {
  const p = path.join(DIR, name)
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as PermissionTraceFile) : undefined
}
/** Trace files that hold no lesson's traces: the sample, and the Error Museum's (2c-18). */
const NOT_LESSONS = new Set(['sample', 'errors'])

const SAMPLE = readFile('sample.json') as PermissionTraceFile
const REJECTED = SAMPLE.traces['push-while-borrowed']
const ACCEPTED = SAMPLE.traces['push-after-last-use']
const MOVED = SAMPLE.traces['use-after-move']
const sampleBlock = (key: string): TracedBlock => ({ key, code: SAMPLE.traces[key].code ?? '' })

describe('lesson traces match their code blocks', () => {
  const traced = ALL_LESSONS.map((l) => ({
    lesson: l,
    blocks: l.blocks.flatMap((b) => (b.type === 'code' && b.permissions ? [b] : [])),
  })).filter((x) => x.blocks.length > 0)

  test('every traced block holds Rust in `code` (the trace hashes it), not tabs', () => {
    for (const { lesson, blocks } of traced) {
      for (const b of blocks) {
        expect({ lesson: lesson.id, key: b.permissions?.trace, hasCode: typeof b.code === 'string', lang: b.lang }).toEqual({
          lesson: lesson.id,
          key: b.permissions?.trace,
          hasCode: true,
          lang: 'rust',
        })
      }
    }
  })

  test("every traced block's code hashes to its trace's sha256", () => {
    const problems = traced.flatMap(({ lesson, blocks }) =>
      traceProblems(
        lesson.id,
        blocks.map((b) => ({ key: b.permissions?.trace ?? '', code: b.code ?? '' })),
        readFile(`${lesson.id}.json`),
        sha256,
      ),
    )
    expect(problems).toEqual([])
  })

  test('every trace file belongs to a lesson and every trace in it to one of its blocks', () => {
    const orphans: string[] = []
    for (const name of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
      const id = name.slice(0, -'.json'.length)
      if (NOT_LESSONS.has(id)) continue
      const lesson = ALL_LESSONS.find((l) => l.id === id)
      if (!lesson) {
        orphans.push(`${name}: no lesson ${id}`)
        continue
      }
      const keys = new Set(lesson.blocks.flatMap((b) => (b.type === 'code' && b.permissions ? [b.permissions.trace] : [])))
      for (const key of Object.keys(readFile(name)?.traces ?? {})) if (!keys.has(key)) orphans.push(`${name}: trace ${key} has no block`)
    }
    expect(orphans).toEqual([])
  })
})

describe('the hash check', () => {
  test('the sample traces match the code they carry and are well formed', () => {
    for (const key of Object.keys(SAMPLE.traces)) expect(traceProblems('sample', [sampleBlock(key)], SAMPLE, sha256)).toEqual([])
  })

  test('a diagram whose code differs from its block by one character fails', () => {
    const block = sampleBlock('push-while-borrowed')
    const edited = { ...block, code: block.code.replace('v.push(4)', 'v.push(5)') }
    const problems = traceProblems('r.l4', [edited], SAMPLE, sha256)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('r.l4/push-while-borrowed: code hash')
    expect(problems[0]).toContain('re-extract the trace')
  })

  test('an added line fails on the hash and on the line count', () => {
    const block = sampleBlock('push-after-last-use')
    const problems = traceProblems('r.l4', [{ ...block, code: `${block.code}\n// end` }], SAMPLE, sha256)
    expect(problems.some((p) => p.includes('code hash'))).toBe(true)
    expect(problems.some((p) => p.includes('trace has 6 lines, code has 7'))).toBe(true)
  })

  test('a missing file or a missing trace fails', () => {
    expect(traceProblems('r.l4', [sampleBlock('push-while-borrowed')], undefined, sha256)[0]).toContain('no trace file')
    expect(traceProblems('r.l4', [{ key: 'nope', code: 'fn main() {}' }], SAMPLE, sha256)).toEqual(["r.l4: no trace 'nope'"])
  })

  test('a lesson with no traced block needs no file', () => {
    expect(traceProblems('t0.l1', [], undefined, sha256)).toEqual([])
  })

  test('shape problems: permission strings, lines, paths, no-op changes, an extracted trace without its tool', () => {
    const bad: PermissionTrace = {
      ...REJECTED,
      source: 'aquascope',
      tool: undefined,
      paths: ['v'],
      changes: [
        { line: 2, path: 'v', before: '', after: 'WR' },
        { line: 9, path: 'v', before: 'R', after: '' },
        { line: 3, path: 'first', before: '', after: 'RO' },
        { line: 4, path: 'v', before: 'R', after: 'R' },
      ],
      uses: [{ line: 4, col: 4, path: 'v', needs: '', has: 'R' }],
    }
    const problems = traceShapeProblems('x', bad)
    for (const want of ['names its tool', "'WR' is not a subset", 'line 9 is outside 1…6', 'undeclared path first', 'changes nothing', 'needs nothing']) {
      expect(problems.some((p) => p.includes(want))).toBe(true)
    }
  })

  test('sample.json is in the canonical format extract.ts writes', () => {
    expect(readFileSync(path.join(DIR, 'sample.json'), 'utf8')).toBe(formatTraceFile(SAMPLE))
  })
})

describe('the table model', () => {
  const code = REJECTED.code ?? ''
  const rows = traceTable(REJECTED, code)
  const cell = (line: number, p: string) => rows.find((r) => r.line === line)?.cells.find((c) => c.path === p)
  const marks = (line: number, p: string) => cell(line, p)?.marks.map((m) => `${m.change === 'gained' ? '+' : m.change === 'lost' ? '-' : ''}${m.held || m.change ? m.letter : '.'}`).join(' ')

  test('rows are the lines where something changes or is used, in order', () => {
    // Aquascope stops stepping a rejected body at the error, so line 5 has no row
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4])
    expect(rows[1].text).toBe('    let first = &v[0];')
  })

  test('gained and lost marks, and state carried forward', () => {
    expect(marks(2, 'v')).toBe('+R +W +O')
    expect(cell(2, 'first')?.empty).toBe(true)
    expect(marks(3, 'v')).toBe('R -W -O')
    expect(marks(3, 'first')).toBe('+R . +O')
    expect(marks(3, '*first')).toBe('+R . .')
    // line 4 changes nothing: v keeps only R, and first keeps R O from line 3
    expect(cell(4, 'first')?.changed).toBe(false)
    expect(marks(4, 'first')).toBe('R . O')
    expect(marks(4, 'v')).toBe('R . .')
    // after first's last use, v gets W and O back and first loses everything
    const accepted = traceTable(ACCEPTED, ACCEPTED.code ?? '')
    const acc = (line: number, p: string) => accepted.find((r) => r.line === line)?.cells.find((c) => c.path === p)?.marks.map((m) => `${m.change === 'gained' ? '+' : m.change === 'lost' ? '-' : ''}${m.held || m.change ? m.letter : '.'}`).join(' ')
    expect(acc(4, 'v')).toBe('R +W +O')
    expect(acc(4, 'first')).toBe('-R . -O')
  })

  test('the use that lacks a permission marks its line rejected', () => {
    expect(rows.filter((r) => r.rejected).map((r) => r.line)).toEqual([4])
    expect(cell(4, 'v')?.uses).toEqual([{ needs: ['R', 'W'], missing: ['W'] }])
    expect(cell(3, 'v')?.uses).toEqual([{ needs: ['R'], missing: [] }])
    expect(traceTable(ACCEPTED, ACCEPTED.code ?? '').some((r) => r.rejected)).toBe(false)
  })

  test('a move takes R and O, so a later read is rejected for want of read', () => {
    const moved = traceTable(MOVED, MOVED.code ?? '')
    expect(moved.map((r) => [r.line, r.rejected])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ])
    expect(moved[1].cells.find((c) => c.path === 's')?.marks.map((m) => m.change)).toEqual(['lost', null, 'lost'])
    expect(moved[2].cells.find((c) => c.path === 's')?.uses).toEqual([{ needs: ['R'], missing: ['R'] }])
  })
})

describe('PermissionTable', () => {
  const html = renderToStaticMarkup(createElement(PermissionTable, { trace: REJECTED, code: REJECTED.code ?? '' })).replace(/<!-- -->/g, '')

  test('a table of lines × paths with row and column headers', () => {
    expect(html).toContain('<table')
    expect(html.match(/<th scope="col"/g)).toHaveLength(1 + REJECTED.paths.length)
    expect(html.match(/<th scope="row"/g)).toHaveLength(3)
    expect(html).toContain('L4')
  })

  test('text first: every mark and verdict reads without colour', () => {
    expect(html).toContain('gains read')
    expect(html).toContain('loses write')
    expect(html).toContain('missing write')
    expect(html).toContain('The compiler rejects line 4')
    expect(html).toContain(', rejected')
    expect(html).toContain('R read · W write · O own')
  })

  test('says where the trace came from: Aquascope, or drawn after its model (Q9)', () => {
    expect(html).toContain('from Aquascope (nightly-2026-05-01)')
    const hand = renderToStaticMarkup(createElement(PermissionTable, { trace: { ...REJECTED, source: 'hand', tool: undefined }, code: REJECTED.code ?? '' }))
    expect(hand).toContain('drawn after Aquascope&#x27;s model')
  })

  test('the table scrolls inside a focusable, labelled region (360 px)', () => {
    expect(html).toMatch(/role="region" aria-labelledby="[^"]+" tabindex="0"/)
  })
})

describe('extract.ts conversion', () => {
  const vs = (type: 'High' | 'Low' | 'None', value?: boolean) => (type === 'High' ? { type, value: true } : type === 'Low' ? { type } : value === undefined ? { type } : { type, value })
  const diff = (r: ReturnType<typeof vs>, w: ReturnType<typeof vs>, o: ReturnType<typeof vs>) => ({ permissions: { read: r, write: w, drop: o } })
  const at = (line: number, column = 0) => ({ start: { line, column }, end: { line, column: column + 1 } })
  const perms = (read: boolean, write: boolean, drop: boolean) => ({ read, write, drop })

  // The shape `cargo aquascope permissions` prints (crates/aquascope/src/analysis), for the snippet
  // without `fn main`, so line 0 is the wrapper and the snippet's line 1 is Aquascope's line 1.
  const snippet = 'let mut v = vec![1];\nlet r = &v;\nv.push(2);\nlet _ = r;'
  const output = [
    {
      Ok: {
        boundaries: [
          { location: { line: 2, column: 8 }, expected: perms(true, false, false), actual: perms(true, true, true) },
          { location: { line: 3, column: 1 }, expected: perms(true, true, false), actual: perms(true, false, false) },
          { location: { line: 5, column: 0 }, expected: perms(true, false, false), actual: perms(true, false, false) },
        ],
        steps: [
          { location: at(1, 20), state: [{ from: at(1), to: at(1), state: [['v', diff(vs('High'), vs('High'), vs('High'))]] }] },
          {
            location: at(2, 11),
            state: [
              { from: at(2), to: at(2), state: [['v', diff(vs('None', true), vs('Low'), vs('Low'))], ['r', diff(vs('High'), vs('None', false), vs('High'))]] },
              { from: at(2), to: at(2), state: [['*r', diff(vs('High'), vs('None'), vs('None', false))]] },
            ],
          },
          // two tables on one line for one path compose: the first before, the last after
          {
            location: at(4, 10),
            state: [
              { from: at(4), to: at(4), state: [['r', diff(vs('Low'), vs('None', false), vs('None', true))]] },
              { from: at(4), to: at(4), state: [['r', diff(vs('None', false), vs('None', false), vs('Low'))]] },
            ],
          },
          // the wrapper's closing line is dropped
          { location: at(5, 1), state: [{ from: at(5), to: at(5), state: [['v', diff(vs('Low'), vs('None', false), vs('None', false))]] }] },
        ],
      },
    },
  ]

  test('wraps a snippet without fn main, and leaves one with it alone', () => {
    expect(prepare(snippet)).toEqual({ source: `fn main() {\n${snippet}\n}\n`, offset: 1 })
    expect(prepare('fn main() {}\n')).toEqual({ source: 'fn main() {}\n', offset: 0 })
  })

  test('reads the place that starts at a boundary', () => {
    expect(pathAt('let r = &v;', 9)).toBe('v')
    expect(pathAt('    *z = y;', 4)).toBe('*z')
    expect(pathAt('v.push(2);', 0)).toBe('v')
    // a method call reports the dot after its receiver (Aquascope at nightly-2026-05-01 on sample.json)
    expect(pathAt('    v.push(4);', 5)).toBe('v')
    expect(pathAt('    *first = (*first).min(9);', 21)).toBe('*first')
    expect(pathAt('  ', 0)).toBe('@0')
  })

  test('maps steps and boundaries onto the snippet: before/after per path, needs/has per use', () => {
    const t = toTrace(output as never, snippet, 1)
    expect(t.sha256).toBe(sha256(snippet))
    expect(t.source).toBe('aquascope')
    expect(t.tool?.toolchain).toBe('nightly-2026-05-01')
    expect(t.lines).toBe(codeLines(snippet))
    expect(t.paths).toEqual(['v', 'r', '*r'])
    expect(t.changes).toEqual([
      { line: 1, path: 'v', before: '', after: 'RWO' },
      { line: 2, path: 'v', before: 'RWO', after: 'R' },
      { line: 2, path: 'r', before: '', after: 'RO' },
      { line: 2, path: '*r', before: '', after: 'R' },
      { line: 4, path: 'r', before: 'RO', after: '' },
    ])
    expect(t.uses).toEqual([
      { line: 2, col: 8, path: 'v', needs: 'R', has: 'RWO' },
      { line: 3, col: 1, path: 'v', needs: 'RW', has: 'R' },
    ])
    expect(traceShapeProblems('t', t)).toEqual([])
    expect(traceProblems('t', [{ key: 'k', code: snippet }], { v: 1, traces: { k: t } }, sha256)).toEqual([])
  })
})

describe('AlignItem', () => {
  const Q: QuizQuestion = {
    q: 'Here is the Java version. Which Rust line does the compiler reject, and which permission is missing?',
    options: ['Line 3: v lacks R', 'Line 4: v lacks W while first borrows it', 'Line 5: first lacks O', 'None: it compiles, as the Java does'],
    correct: [1],
    why: [
      'Borrowing &v[0] needs only R, and v has it.',
      'Right: first borrows v, which takes W and O away from v until first is last used on line 5, and push needs W.',
      'Printing through first needs only R; first never needs O here.',
      'Java lets the list grow while a reference into it lives; Rust rejects line 4 because the push could move the elements first points at.',
    ],
    kcs: ['r.borrow-rules'],
  }
  const item = alignItem('r.l4', 2, Q)

  test('plays as the authored item item:<lesson>.align.<n>', () => {
    expect(playView(item, 1).ref).toBe('item:r.l4.align.2')
    expect(item.source === 'item' && item.item.kcs).toEqual(['r.borrow-rules'])
  })

  test('grades the line that breaks by authored index, with a why per option', () => {
    const right = gradeItem(item, { kind: 'choice', picks: ['1'] })
    expect(right.ok).toBe(true)
    const wrong = gradeItem(item, { kind: 'choice', picks: ['3'] })
    expect(wrong.ok).toBe(false)
    const view = playView(item, 7)
    expect(view.kind === 'choice' && view.options.every((o) => o.why.length > 0)).toBe(true)
  })

  test("records src 'lesson' with the authored pick, and the event passes the ledger codec", () => {
    const response = { kind: 'choice' as const, picks: ['3'] }
    const r = resultFor(item, response, gradeItem(item, response), { seed: 11, ms: 4200, conf: 'sure' })
    const ir = alignResponse('r.l4', r)
    expect(ir).toMatchObject({ kind: 'item', ref: 'item:r.l4.align.2', ok: false, score: 0, conf: 'sure', seed: 11, data: { src: 'lesson', pick: [3], lessonId: 'r.l4', kcs: ['r.borrow-rules'] } })
    const e = evt('item', ir.ref, '2026-10-05T09:00:00.000Z', { score: ir.score, ok: ir.ok, rev: ir.rev, data: ir.data, seed: ir.seed, ms: ir.ms, conf: ir.conf })
    expect(validateEvent(e)).toMatchObject({ ok: true })
  })

  test('renders the question in the shared player with its alignment eyebrow', () => {
    const html = renderToStaticMarkup(createElement(AlignItem, { lessonId: 'r.l4', n: 0, q: Q, langLabel: 'Java', seed: 5 }))
    expect(html).toContain('aria-label="Alignment item 1"')
    expect(html).toContain('align · Java ↔ Rust')
    expect(html).toContain('Which Rust line does the compiler reject')
    for (const o of Q.options) expect(html).toContain(o.replace(/'/g, '&#x27;'))
  })
})
