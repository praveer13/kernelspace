/**
 * K0-FIX-RUST: a use in a permission trace sits on the path whose permissions it reports. Aquascope gives
 * a position and the permissions of the place it checks; where Rust auto-dereferences a reference
 * (`all.push(6)` with `all: &mut Vec`), that place is behind the reference (`*all`), and the extractor
 * used to put the use on the reference variable, whose own state (R and O, never W) contradicts the
 * "has RW" it shows. These tests hold the extractor and every committed trace to that.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { PermissionTraceFile } from '../../src/data/aquascope/types'
import { stateBefore, usePath } from '../../scripts/aquascope/extract'

const DIR = path.resolve(import.meta.dir, '../../src/data/aquascope')
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.json'))
const load = (f: string) => JSON.parse(readFileSync(path.join(DIR, f), 'utf8')) as PermissionTraceFile

describe('the extractor puts an auto-dereferenced use behind the reference', () => {
  const states: Record<string, string> = { all: 'RO', '*all': 'RW', scores: '' }
  test('r.l4 line 6: all.push(6) with all: &mut Vec needs RW on *all', () => {
    expect(usePath('all.push(6);', 3, 'RW', 'RW', (p) => states[p])).toBe('*all')
  })
  test('a field through a reference: &mut b.ids with b: &Table is (*b).ids', () => {
    const s: Record<string, string> = { b: 'RO', '*b': 'R', '(*b).ids': 'R' }
    expect(usePath('    std::mem::swap(&mut a.ids, &mut b.ids);', 36, 'RW', 'R', (p) => s[p])).toBe('(*b).ids')
  })
  test('a write that no state explains (a loan taken earlier on the line) still goes behind a reference that cannot be written', () => {
    const s: Record<string, string> = { v: 'RO', '*v': 'RW' }
    expect(usePath('    v.push(v.pop().unwrap());', 12, 'RW', '', (p) => s[p])).toBe('*v')
  })
  test('a place that is not auto-dereferenced keeps its name', () => {
    const s: Record<string, string> = { first: 'RO', '*first': 'R' }
    expect(usePath('println!("{first}");', 11, 'R', 'RO', (p) => s[p])).toBe('first')
    expect(usePath('    v.push(4);', 5, 'RW', 'RWO', (p) => ({ v: 'RWO' })[p])).toBe('v')
  })
  test('the state a use sees is the path state before its line changes', () => {
    const changes = [
      { line: 5, path: '*all', before: '', after: 'RW' },
      { line: 6, path: '*all', before: 'RW', after: '' },
    ]
    expect(stateBefore(changes, '*all', 6)).toBe('RW')
    expect(stateBefore(changes, '*all', 7)).toBe('')
    expect(stateBefore(changes, 'all', 6)).toBeUndefined()
  })
})

describe('every committed trace', () => {
  test('r.l4 shared-then-exclusive: the push on line 6 needs RW on *all, and nothing on all', () => {
    const t = load('r.l4.json').traces['shared-then-exclusive']
    const six = t.uses.filter((u) => u.line === 6)
    expect(six.map((u) => [u.path, u.needs, u.has])).toEqual([['*all', 'RW', 'RW']])
    expect(t.source).toBe('aquascope')
  })

  test('no use names a reference variable whose own state contradicts what the use has', () => {
    const bad: string[] = []
    for (const f of FILES) {
      for (const [key, t] of Object.entries(load(f).traces)) {
        for (const u of t.uses) {
          const isRef = t.paths.some((p) => p.startsWith(`*${u.path}`) || p.startsWith(`(*${u.path})`))
          if (!isRef) continue
          const st = stateBefore(t.changes, u.path, u.line)
          if (st !== undefined && st !== u.has) bad.push(`${f}/${key} line ${u.line} ${u.path}: has ${u.has || '-'}, state ${st || '-'}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  test('no write need sits on a reference variable that cannot be written while the place behind it is tracked', () => {
    const bad: string[] = []
    for (const f of FILES) {
      for (const [key, t] of Object.entries(load(f).traces)) {
        for (const u of t.uses) {
          if (!u.needs.includes('W')) continue
          const isRef = t.paths.some((p) => p.startsWith(`*${u.path}`) || p.startsWith(`(*${u.path})`))
          const st = stateBefore(t.changes, u.path, u.line)
          if (isRef && st !== undefined && !st.includes('W')) bad.push(`${f}/${key} line ${u.line} ${u.path}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})
