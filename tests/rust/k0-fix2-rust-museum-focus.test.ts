/**
 * K0-FIX2-RUST: an Error Museum exhibit names the place its diagram shows losing the permission.
 *
 * The exhibit's sentence ("Line 3 needs Read (R) and Write (W) of `q` and the path has lost Write (W)") is built from
 * the bank variant's `focus.path`, and the compile family's permission item says the same ("`q` has lost Write (W)").
 * Under it, the diagram from src/data/aquascope/errors.json puts a use through a reference on the place behind it:
 * for `q.extend(ids)` with `q: &mut Vec<u64>` that is `*q`, which held R and W and lost W, while `q` itself (not
 * declared `mut`) held R and O and never had W. rustc names the same place: "cannot borrow `*q` as mutable".
 *
 * The rule held here: when the named path never held the permission in the trace but the place behind it (`*path`)
 * did, the sentence names the wrong place. The verify-rust-items focus check now accepts `*x` on a line where `x` is
 * a method receiver (auto-deref), which is how `*q` can be named on `q.extend(ids);`.
 */
import { describe, expect, test } from 'bun:test'
import museum from '../../src/data/rust-items/museum.json'
import errors from '../../src/data/aquascope/errors.json'
import type { PermissionTraceFile } from '../../src/data/aquascope/types'
import type { MuseumEntry } from '../../src/lib/rust/museum'
import type { RustGroup, RustSnippet } from '../../src/data/rust-items/types'
import { checkSnippets } from '../../scripts/verify-rust-items'

const LETTER = { read: 'R', write: 'W', own: 'O' } as const
const traces = (errors as unknown as PermissionTraceFile).traces
const exhibits = museum as unknown as MuseumEntry[]

/** Every state a path takes in a trace. */
const statesOf = (code: string, path: string): string[] =>
  traces[code].changes.filter((c) => c.path === path).flatMap((c) => [c.before, c.after])

describe('K0-FIX2-RUST: a museum exhibit names the place that lost the permission', () => {
  test('no exhibit names a reference variable for a permission only the place behind it ever held', () => {
    const wrong: string[] = []
    for (const e of exhibits) {
      if (!e.focus || !e.permission || !traces[e.code]) continue
      const letter = LETTER[e.permission]
      const named = statesOf(e.code, e.focus.path)
      const behind = statesOf(e.code, `*${e.focus.path}`)
      if (!named.some((s) => s.includes(letter)) && behind.some((s) => s.includes(letter))) {
        wrong.push(`${e.code}: \`${e.focus.path}\` never held ${letter}; \`*${e.focus.path}\` did`)
      }
    }
    expect(wrong).toEqual([])
  })

  test('E0502: the sentence and the diagram name `*q`, which held W and lost it at line 3', () => {
    const e = exhibits.find((x) => x.code === 'E0502')!
    expect(e.message).toContain('`*q`')
    expect(e.focus).toEqual({ line: 3, path: '*q', needs: ['read', 'write'] })
    expect(e.permission).toBe('write')
    expect(e.why).toContain('so `*q` lacks W when `extend` needs it')
    const use = traces.E0502.uses.find((u) => u.line === 3 && u.needs.includes('W'))!
    expect(use.path).toBe('*q')
    expect(use.has).not.toContain('W')
    expect(statesOf('E0502', '*q').some((s) => s.includes('W'))).toBe(true)
    expect(statesOf('E0502', 'q').some((s) => s.includes('W'))).toBe(false)
  })
})

describe('K0-FIX2-RUST: verify-rust-items accepts a focus on the place behind a method receiver', () => {
  const snippet = (path: string, line3: string): RustSnippet =>
    ({
      id: 'focus-deref',
      kcs: ['r.borrow-rules'],
      title: 'Append a copy of the queue to itself',
      domain: 'AdmissionQueue',
      base: 'fn mirror(q: &mut Vec<u64>) {\n    let ids = q.to_vec();\n    q.extend(ids);\n}',
      variants: [
        { id: 'base', expect: 'compiles', why: 'The copy owns its ids.' },
        {
          id: 'lazy',
          edit: { line: 2, text: '    let ids = q.iter().copied();' },
          expect: { code: 'E0502', line: 3 },
          why: 'The iterator still reads `*q`.',
          focus: { line: 3, path, needs: ['read', 'write'] },
          permission: 'write',
          fixes: [
            { id: 'to-vec', edit: { line: 2, text: '    let ids = q.to_vec();' }, ok: true, why: 'The copy owns its ids.' },
            { id: 'take', edit: { line: 2, text: '    let ids = q.iter().copied().take(2);' }, ok: false, why: 'Still a borrow.' },
            { id: 'clone', edit: { line: 3, text: line3 }, ok: false, lure: 'clone', why: 'It grows a copy.' },
          ],
        },
      ],
    }) as unknown as RustSnippet
  const group = (s: RustSnippet) => ({ id: 'borrows', snippets: [s] }) as unknown as RustGroup
  const focusProblems = (s: RustSnippet) => checkSnippets([group(s)]).filter((m) => m.includes('focus path'))

  test('`*q` on `q.extend(ids);` is accepted, and so is `q`', () => {
    expect(focusProblems(snippet('*q', '    q.clone().extend(ids);'))).toEqual([])
    expect(focusProblems(snippet('q', '    q.clone().extend(ids);'))).toEqual([])
  })

  test('`*w`, `**q` and `*ids` (not a receiver) are still refused on that line', () => {
    expect(focusProblems(snippet('*w', '    q.clone().extend(ids);')).join('\n')).toContain('does not appear on line 3')
    expect(focusProblems(snippet('**q', '    q.clone().extend(ids);')).join('\n')).toContain('does not appear on line 3')
    expect(focusProblems(snippet('*ids', '    q.clone().extend(ids);')).join('\n')).toContain('does not appear on line 3')
  })
})
