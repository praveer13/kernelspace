import { describe, expect, test } from 'bun:test'
import { pathOrder, pathParts, toTrace } from '../../scripts/aquascope/extract'

const sorted = (xs: string[]) => [...xs].sort(pathOrder)

describe('permission traces: rows read in a natural order', () => {
  test('a path is split into its base name, dereference depth and field', () => {
    expect(pathParts('r')).toEqual({ base: 'r', depth: 0, rest: '' })
    expect(pathParts('*r')).toEqual({ base: 'r', depth: 1, rest: '' })
    expect(pathParts('(*self).x')).toEqual({ base: 'self', depth: 1, rest: '.x' })
    expect(pathParts('**p')).toEqual({ base: 'p', depth: 2, rest: '' })
    expect(pathParts('(*v)[_]')).toEqual({ base: 'v', depth: 1, rest: '[_]' })
    expect(pathParts('@12')).toEqual({ base: '@12', depth: 0, rest: '' })
  })

  test('ties sort by base name first: `r` comes before `*r`, `self` before `(*self).x`', () => {
    expect(sorted(['*r', 'r'])).toEqual(['r', '*r'])
    expect(sorted(['(*self).x', 'self', '*self'])).toEqual(['self', '*self', '(*self).x'])
    // code-unit order put `(` and `*` before every letter, so a dereference led its own base
    expect(['*r', 'r', '(*c).hot', 'c'].sort()).toEqual(['(*c).hot', '*r', 'c', 'r'])
    expect(sorted(['*r', 'r', '(*c).hot', 'c'])).toEqual(['c', '(*c).hot', 'r', '*r'])
  })

  test('deeper dereferences follow shallower ones, then fields in code-unit order', () => {
    expect(sorted(['(*s).queue', '*s', 's.left', 's', '(*s).left', '**s'])).toEqual(['s', 's.left', '*s', '(*s).left', '(*s).queue', '**s'])
  })

  test('the rows do not depend on the order Aquascope lists a line in', () => {
    const step = (name: string) => [name, { permissions: { read: { type: 'High', value: true }, write: { type: 'None', value: false }, drop: { type: 'None', value: false } } }]
    const range = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }
    const body = (names: string[]) => [{ Ok: { boundaries: [], steps: [{ location: range, state: [{ from: range, to: range, state: names.map(step) }] }] } }]
    const code = 'let r = 1;'
    const a = toTrace(body(['*r', 'r']) as never, code, 0)
    const b = toTrace(body(['r', '*r']) as never, code, 0)
    expect(a.paths).toEqual(['r', '*r'])
    expect(b).toEqual(a)
  })
})
